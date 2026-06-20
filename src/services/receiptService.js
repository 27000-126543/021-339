const jwt = require('jsonwebtoken');
const { Op } = require('../config/database');
const { Receipt, Alert, Notification, Recipient, loadAssociations } = require('../models');
const { updateAlertReceiptStatus } = require('./notificationService');
const logger = require('../config/logger');
require('dotenv').config();

const RECEIPT_TYPE_NAMES = {
  'acknowledged': '已知晓',
  'processing': '正在处理',
  'false_alarm': '误报待核'
};

function validateReceiptToken(token) {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== 'receipt') {
      throw new Error('无效的token类型');
    }
    return { valid: true, data: decoded };
  } catch (error) {
    logger.error('回执token验证失败', { error: error.message });
    return { valid: false, error: error.message };
  }
}

function validateReceiptData(receiptData) {
  const validTypes = ['acknowledged', 'processing', 'false_alarm'];

  if (!receiptData.receiptType) {
    return { valid: false, message: '缺少回执类型' };
  }

  if (!validTypes.includes(receiptData.receiptType)) {
    return { valid: false, message: `无效的回执类型: ${receiptData.receiptType}，有效值为: ${validTypes.join(', ')}` };
  }

  if (!receiptData.siteContact) {
    return { valid: false, message: '请填写现场联系人' };
  }

  if (!receiptData.siteContactPhone) {
    return { valid: false, message: '请填写现场联系电话' };
  }

  const phoneRegex = /^1[3-9]\d{9}$/;
  if (!phoneRegex.test(receiptData.siteContactPhone)) {
    return { valid: false, message: '请输入有效的手机号码' };
  }

  return { valid: true };
}

async function submitReceipt(receiptData, token, req) {
  logger.info('提交回执', { receiptType: receiptData.receiptType });

  let tokenData = null;
  if (token) {
    const tokenValidation = validateReceiptToken(token);
    if (!tokenValidation.valid) {
      throw new Error(`回执链接无效: ${tokenValidation.error}`);
    }
    tokenData = tokenValidation.data;
  }

  const alertId = receiptData.alertId || (tokenData ? tokenData.alertId : null);
  const notificationId = receiptData.notificationId || (tokenData ? tokenData.notificationId : null);
  const recipientId = receiptData.recipientId || (tokenData ? tokenData.recipientId : null);

  if (!alertId) {
    throw new Error('缺少告警ID，请通过回执链接访问或提供alertId');
  }
  if (!recipientId) {
    throw new Error('缺少接收人ID，请通过回执链接访问或提供recipientId');
  }

  const validation = validateReceiptData(receiptData);
  if (!validation.valid) {
    throw new Error(validation.message);
  }

  const alert = await Alert.findByPk(alertId);
  if (!alert) {
    throw new Error(`告警不存在: ${alertId}`);
  }

  const recipient = await Recipient.findByPk(recipientId);
  if (!recipient) {
    throw new Error(`接收人不存在: ${recipientId}`);
  }

  let notification = null;
  if (notificationId) {
    notification = await Notification.findByPk(notificationId);
    if (!notification) {
      throw new Error(`通知不存在: ${notificationId}`);
    }
    if (notification.alertId !== alertId) {
      throw new Error('通知与告警不匹配');
    }
    if (notification.recipientId !== recipientId) {
      throw new Error('通知与接收人不匹配');
    }
  }

  const existingReceipts = await Receipt.count({
    where: { alertId, recipientId }
  });
  const isFirstReceipt = existingReceipts === 0;

  const receipt = await Receipt.create({
    alertId,
    notificationId,
    recipientId,
    recipientName: recipient.name,
    recipientPhone: recipient.phone,
    recipientRole: recipient.role,
    receiptType: receiptData.receiptType,
    receiptTypeName: RECEIPT_TYPE_NAMES[receiptData.receiptType],
    siteContact: receiptData.siteContact,
    siteContactPhone: receiptData.siteContactPhone,
    estimatedHandleTime: receiptData.estimatedHandleTime,
    remark: receiptData.remark,
    receiptTime: new Date(),
    receiptIp: req ? req.ip : null,
    receiptDevice: req ? (req.headers['user-agent'] || '') : '',
    isFirstReceipt
  });

  if (notification) {
    await Notification.update(notification.id, {
      receiptStatus: receiptData.receiptType,
      receiptTime: new Date(),
      receiptNote: receiptData.remark
    });
  }

  const alertUpdateData = {};

  if (!alert.firstAckTime) {
    alertUpdateData.firstAckTime = new Date();
  }

  switch (receiptData.receiptType) {
    case 'acknowledged':
      alertUpdateData.status = 'acknowledged';
      break;
    case 'processing':
      alertUpdateData.status = 'processing';
      alertUpdateData.siteContact = receiptData.siteContact;
      alertUpdateData.siteContactPhone = receiptData.siteContactPhone;
      break;
    case 'false_alarm':
      alertUpdateData.status = 'false_alarm';
      alertUpdateData.resolvedTime = new Date();
      alertUpdateData.resolutionNote = receiptData.remark || '误报';
      break;
  }

  await Alert.update(alertId, alertUpdateData);
  await updateAlertReceiptStatus(alertId);

  logger.info('回执提交成功', {
    receiptId: receipt.id,
    alertId,
    recipientId,
    receiptType: receiptData.receiptType,
    isFirstReceipt
  });

  return {
    success: true,
    receiptId: receipt.id,
    receiptType: receiptData.receiptType,
    receiptTypeName: RECEIPT_TYPE_NAMES[receiptData.receiptType],
    isFirstReceipt,
    alertStatus: alertUpdateData.status,
    message: '回执提交成功'
  };
}

async function getReceiptList(params = {}) {
  const {
    page = 1,
    pageSize = 20,
    alertId,
    recipientId,
    receiptType,
    startTime,
    endTime
  } = params;

  const where = {};
  if (alertId) where.alertId = alertId;
  if (recipientId) where.recipientId = recipientId;
  if (receiptType) where.receiptType = receiptType;
  if (startTime) where.receiptTime = { ...where.receiptTime, $gte: new Date(startTime) };
  if (endTime) where.receiptTime = { ...where.receiptTime, $lte: new Date(endTime) };

  const { count, rows } = await Receipt.findAll({
    where,
    order: [['receiptTime', 'DESC']],
    limit: pageSize,
    offset: (page - 1) * pageSize
  });

  const listWithAssociations = await Promise.all(rows.map(async receipt => {
    return await loadAssociations(receipt, [
      { model: 'Alert', as: 'alert' },
      { model: 'Notification', as: 'notification' },
      { model: 'Recipient', as: 'recipient' }
    ]);
  }));

  return {
    total: count,
    page,
    pageSize,
    list: listWithAssociations
  };
}

async function getReceiptDetail(receiptId) {
  const receipt = await Receipt.findByPk(receiptId);

  if (!receipt) {
    throw new Error(`回执不存在: ${receiptId}`);
  }

  return await loadAssociations(receipt, [
    { model: 'Alert', as: 'alert', include: [
      { model: 'Project', as: 'project' },
      { model: 'Area', as: 'area' }
    ]},
    { model: 'Notification', as: 'notification' },
    { model: 'Recipient', as: 'recipient' }
  ]);
}

async function getAlertReceipts(alertId) {
  const alert = await Alert.findByPk(alertId);
  if (!alert) {
    throw new Error(`告警不存在: ${alertId}`);
  }

  const receiptsResult = await Receipt.findAll({
    where: { alertId },
    order: [['receiptTime', 'ASC']]
  });
  
  const receipts = await Promise.all(receiptsResult.rows.map(async receipt => {
    return await loadAssociations(receipt, [
      { model: 'Recipient', as: 'recipient' },
      { model: 'Notification', as: 'notification' }
    ]);
  }));

  const notificationsResult = await Notification.findAll({
    where: { alertId }
  });
  const notifications = notificationsResult.rows;

  const receiptStatus = {
    total: notifications.length,
    acknowledged: notifications.filter(n => n.receiptStatus === 'acknowledged').length,
    processing: notifications.filter(n => n.receiptStatus === 'processing').length,
    falseAlarm: notifications.filter(n => n.receiptStatus === 'false_alarm').length,
    pending: notifications.filter(n => n.receiptStatus === 'none').length
  };

  return {
    alertId,
    alertCode: alert.alertCode,
    alertStatus: alert.status,
    receiptStatus,
    receipts,
    notifications
  };
}

async function getReceiptStatistics(params = {}) {
  const { projectId, startTime, endTime } = params;

  const where = {};
  if (startTime) where.receiptTime = { ...where.receiptTime, $gte: new Date(startTime) };
  if (endTime) where.receiptTime = { ...where.receiptTime, $lte: new Date(endTime) };

  const receiptsResult = await Receipt.findAll({ where });
  let receipts = receiptsResult.rows;

  if (projectId) {
    const alertResult = await Alert.findAll({ where: { projectId } });
    const alertIds = alertResult.rows.map(a => a.id);
    receipts = receipts.filter(r => alertIds.includes(r.alertId));
  }

  const receiptsWithAlerts = await Promise.all(receipts.map(async receipt => {
    return await loadAssociations(receipt, [
      { model: 'Alert', as: 'alert' }
    ]);
  }));

  const stats = {
    total: receiptsWithAlerts.length,
    byType: {
      acknowledged: receiptsWithAlerts.filter(r => r.receiptType === 'acknowledged').length,
      processing: receiptsWithAlerts.filter(r => r.receiptType === 'processing').length,
      false_alarm: receiptsWithAlerts.filter(r => r.receiptType === 'false_alarm').length
    },
    byRole: {},
    avgResponseTime: 0
  };

  const roleCounts = {};
  receiptsWithAlerts.forEach(r => {
    const role = r.recipientRole || 'unknown';
    roleCounts[role] = (roleCounts[role] || 0) + 1;
  });
  stats.byRole = roleCounts;

  const responseTimes = [];
  for (const receipt of receiptsWithAlerts) {
    if (receipt.alert && receipt.alert.occurTime) {
      const occurTime = new Date(receipt.alert.occurTime);
      const receiptTime = new Date(receipt.receiptTime);
      const diff = (receiptTime - occurTime) / (1000 * 60);
      if (diff > 0) {
        responseTimes.push(diff);
      }
    }
  }
  if (responseTimes.length > 0) {
    stats.avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
  }

  return stats;
}

module.exports = {
  RECEIPT_TYPE_NAMES,
  validateReceiptToken,
  validateReceiptData,
  submitReceipt,
  getReceiptList,
  getReceiptDetail,
  getAlertReceipts,
  getReceiptStatistics
};
