const jwt = require('jsonwebtoken');
const { Op } = require('../config/database');
const { Receipt, Alert, Notification, Recipient, Project, loadAssociations } = require('../models');
const { updateAlertReceiptStatus } = require('./notificationService');
const { getAlertReminderSummary } = require('./reminderService');
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
    where: { alertId },
    order: [['createdAt', 'ASC']]
  });
  const notifications = notificationsResult.rows;

  const notificationSummary = {
    total: notifications.length,
    byChannel: {},
    byStatus: {}
  };
  notifications.forEach(n => {
    notificationSummary.byChannel[n.channel] = (notificationSummary.byChannel[n.channel] || 0) + 1;
    notificationSummary.byStatus[n.status] = (notificationSummary.byStatus[n.status] || 0) + 1;
  });

  const uniqueRecipientsMap = {};
  notifications.forEach(n => {
    if (!uniqueRecipientsMap[n.recipientId]) {
      uniqueRecipientsMap[n.recipientId] = {
        id: n.recipientId,
        name: n.recipientName,
        role: n.recipientRole,
        roleName: n.recipientRoleName,
        phone: n.recipientPhone
      };
    }
  });
  const uniqueRecipients = Object.values(uniqueRecipientsMap);

  const receiptedRecipientsMap = {};
  receipts.forEach(r => {
    receiptedRecipientsMap[r.recipientId] = r;
  });
  const receiptedRecipientIds = Object.keys(receiptedRecipientsMap);

  const acknowledgedList = [];
  const processingList = [];
  const falseAlarmList = [];
  const receiptByRecipientLatest = {};

  receipts.forEach(r => {
    const rid = r.recipientId;
    if (!receiptByRecipientLatest[rid] || new Date(r.receiptTime) > new Date(receiptByRecipientLatest[rid].receiptTime)) {
      receiptByRecipientLatest[rid] = r;
    }
  });

  Object.values(receiptByRecipientLatest).forEach(r => {
    const entry = {
      recipientId: r.recipientId,
      recipientName: r.recipientName,
      recipientRole: r.recipientRole,
      recipientRoleName: r.recipientRoleName,
      recipientPhone: r.recipientPhone,
      receiptType: r.receiptType,
      receiptTypeName: r.receiptTypeName,
      receiptTime: r.receiptTime,
      siteContact: r.siteContact,
      siteContactPhone: r.siteContactPhone,
      remark: r.remark,
      receiptId: r.id
    };

    switch (r.receiptType) {
      case 'acknowledged':
        acknowledgedList.push(entry);
        break;
      case 'processing':
        processingList.push(entry);
        break;
      case 'false_alarm':
        falseAlarmList.push(entry);
        break;
    }
  });

  const pendingList = uniqueRecipients
    .filter(r => !receiptedRecipientIds.includes(r.id))
    .map(r => ({
      recipientId: r.id,
      recipientName: r.name,
      recipientRole: r.role,
      recipientRoleName: r.roleName,
      recipientPhone: r.phone,
      reminderCount: 0,
      lastReminderTime: null
    }));

  const byRoleSummary = {};
  uniqueRecipients.forEach(r => {
    const role = r.role;
    if (!byRoleSummary[role]) {
      byRoleSummary[role] = {
        role,
        roleName: r.roleName,
        total: 0,
        receipted: 0,
        pending: 0,
        acknowledged: 0,
        processing: 0,
        false_alarm: 0,
        recipients: []
      };
    }
    byRoleSummary[role].total++;

    const rid = r.id;
    const latestReceipt = receiptByRecipientLatest[rid];
    if (latestReceipt) {
      byRoleSummary[role].receipted++;
      byRoleSummary[role][latestReceipt.receiptType] = (byRoleSummary[role][latestReceipt.receiptType] || 0) + 1;
    } else {
      byRoleSummary[role].pending++;
    }

    byRoleSummary[role].recipients.push({
      id: r.id,
      name: r.name,
      phone: r.phone,
      receiptStatus: latestReceipt ? latestReceipt.receiptType : 'pending',
      receiptStatusName: latestReceipt ? latestReceipt.receiptTypeName : '待回执',
      receiptTime: latestReceipt ? latestReceipt.receiptTime : null
    });
  });

  const receiptTimes = receipts.map(r => new Date(r.receiptTime).getTime());
  const firstReceiptTime = receiptTimes.length > 0 ? new Date(Math.min(...receiptTimes)) : null;
  const lastReceiptTime = receiptTimes.length > 0 ? new Date(Math.max(...receiptTimes)) : null;

  let firstResponseMinutes = null;
  let lastResponseMinutes = null;
  if (firstReceiptTime && alert.occurTime) {
    firstResponseMinutes = (firstReceiptTime - new Date(alert.occurTime)) / (1000 * 60);
  }
  if (lastReceiptTime && alert.occurTime) {
    lastResponseMinutes = (lastReceiptTime - new Date(alert.occurTime)) / (1000 * 60);
  }

  const receiptStatus = {
    totalRecipients: uniqueRecipients.length,
    totalNotifications: notifications.length,
    receiptedCount: receiptedRecipientIds.length,
    pendingCount: uniqueRecipients.length - receiptedRecipientIds.length,
    byType: {
      acknowledged: acknowledgedList.length,
      processing: processingList.length,
      false_alarm: falseAlarmList.length
    },
    byTypeNames: {
      acknowledged: '已知晓',
      processing: '正在处理',
      false_alarm: '误报待核'
    }
  };

  const receiptDetailByRecipient = {};
  receipts.forEach(r => {
    if (!receiptDetailByRecipient[r.recipientId]) {
      receiptDetailByRecipient[r.recipientId] = {
        recipientId: r.recipientId,
        recipientName: r.recipientName,
        recipientRole: r.recipientRole,
        latestReceipt: receiptByRecipientLatest[r.recipientId],
        receiptCount: 0,
        receipts: []
      };
    }
    receiptDetailByRecipient[r.recipientId].receiptCount++;
    receiptDetailByRecipient[r.recipientId].receipts.push(r);
  });

  const reminderSummary = await getAlertReminderSummary(alertId);

  const reminderByRecipient = {};
  reminderSummary.byRecipient.forEach(r => {
    reminderByRecipient[r.recipientId] = r;
  });

  pendingList.forEach(p => {
    const reminderInfo = reminderByRecipient[p.recipientId];
    if (reminderInfo) {
      p.reminderCount = reminderInfo.totalCount;
      p.lastReminderTime = reminderInfo.lastReminderTime;
      p.lastReminderChannel = reminderInfo.lastReminderChannel;
    } else {
      p.reminderCount = 0;
      p.lastReminderTime = null;
      p.lastReminderChannel = null;
    }
  });

  const acknowledgedListWithReminder = acknowledgedList.map(a => {
    const reminderInfo = reminderByRecipient[a.recipientId];
    return {
      ...a,
      reminderCount: reminderInfo ? reminderInfo.totalCount : 0,
      lastReminderTime: reminderInfo ? reminderInfo.lastReminderTime : null
    };
  });
  const processingListWithReminder = processingList.map(a => {
    const reminderInfo = reminderByRecipient[a.recipientId];
    return {
      ...a,
      reminderCount: reminderInfo ? reminderInfo.totalCount : 0,
      lastReminderTime: reminderInfo ? reminderInfo.lastReminderTime : null
    };
  });
  const falseAlarmListWithReminder = falseAlarmList.map(a => {
    const reminderInfo = reminderByRecipient[a.recipientId];
    return {
      ...a,
      reminderCount: reminderInfo ? reminderInfo.totalCount : 0,
      lastReminderTime: reminderInfo ? reminderInfo.lastReminderTime : null
    };
  });

  Object.keys(byRoleSummary).forEach(role => {
    byRoleSummary[role].recipients = byRoleSummary[role].recipients.map(r => {
      const reminderInfo = reminderByRecipient[r.id];
      return {
        ...r,
        reminderCount: reminderInfo ? reminderInfo.totalCount : 0,
        lastReminderTime: reminderInfo ? reminderInfo.lastReminderTime : null
      };
    });
  });

  const dutyDispatchView = {
    statusSummary: {
      totalRecipients: uniqueRecipients.length,
      receipted: receiptedRecipientIds.length,
      pending: pendingList.length,
      progress: uniqueRecipients.length > 0 
        ? Math.round((receiptedRecipientIds.length / uniqueRecipients.length) * 100) 
        : 0
    },
    timestamps: {
      alertOccurTime: alert.occurTime,
      firstReceiptTime,
      lastReceiptTime,
      firstResponseMinutes: firstResponseMinutes !== null ? Number(firstResponseMinutes.toFixed(2)) : null,
      lastResponseMinutes: lastResponseMinutes !== null ? Number(lastResponseMinutes.toFixed(2)) : null
    },
    receiptLists: {
      acknowledged: acknowledgedListWithReminder,
      processing: processingListWithReminder,
      false_alarm: falseAlarmListWithReminder,
      pending: pendingList
    },
    byRole: byRoleSummary,
    reminder: {
      totalCount: reminderSummary.totalCount,
      successCount: reminderSummary.successCount,
      recipientCount: reminderSummary.recipientCount,
      byChannel: reminderSummary.byChannel
    }
  };

  return {
    alertId,
    alertCode: alert.alertCode,
    alertLevel: alert.alertLevel,
    alertLevelName: alert.alertLevelName,
    alertStatus: alert.status,
    receiptStatus,
    notificationSummary,
    dutyDispatchView,
    reminderSummary,
    receiptDetailByRecipient,
    receipts,
    notifications
  };
}

async function getReceiptStatistics(params = {}) {
  const { projectId, startTime, endTime, groupBy } = params;

  const receiptWhere = {};
  if (startTime) receiptWhere.receiptTime = { ...receiptWhere.receiptTime, $gte: new Date(startTime) };
  if (endTime) receiptWhere.receiptTime = { ...receiptWhere.receiptTime, $lte: new Date(endTime) };

  const receiptsResult = await Receipt.findAll({ where: receiptWhere });
  let allReceipts = receiptsResult.rows;

  let alertsFilter = {};
  if (projectId) alertsFilter.projectId = projectId;

  const alertsResult = await Alert.findAll({ where: alertsFilter });
  const alertMap = {};
  alertsResult.rows.forEach(a => {
    alertMap[a.id] = a;
  });

  const projectMap = {};
  if (!projectId) {
    const projectsResult = await Project.findAll({});
    projectsResult.rows.forEach(p => {
      projectMap[p.id] = p;
    });
  }

  allReceipts = allReceipts.filter(r => alertMap[r.alertId]);

  const receiptsWithAlerts = allReceipts.map(receipt => ({
    ...receipt,
    alert: alertMap[receipt.alertId]
  }));

  const calculateStats = (receipts) => {
    const uniqueRecipients = new Set();
    const responseTimes = [];
    const byType = {
      acknowledged: 0,
      processing: 0,
      false_alarm: 0
    };
    const byRole = {};

    receipts.forEach(r => {
      uniqueRecipients.add(r.recipientId);
      byType[r.receiptType] = (byType[r.receiptType] || 0) + 1;
      
      const role = r.recipientRole || 'unknown';
      byRole[role] = (byRole[role] || 0) + 1;

      if (r.alert && r.alert.occurTime) {
        const occurTime = new Date(r.alert.occurTime);
        const receiptTime = new Date(r.receiptTime);
        const diff = (receiptTime - occurTime) / (1000 * 60);
        if (diff > 0) {
          responseTimes.push(diff);
        }
      }
    });

    return {
      totalReceipts: receipts.length,
      uniqueRecipients: uniqueRecipients.size,
      byType,
      byTypeNames: {
        acknowledged: '已知晓',
        processing: '正在处理',
        false_alarm: '误报待核'
      },
      byRole,
      avgResponseTimeMinutes: responseTimes.length > 0 
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length 
        : 0,
      fastestResponseMinutes: responseTimes.length > 0 ? Math.min(...responseTimes) : 0,
      slowestResponseMinutes: responseTimes.length > 0 ? Math.max(...responseTimes) : 0
    };
  };

  const overallStats = calculateStats(receiptsWithAlerts);

  if (groupBy === 'project') {
    const byProject = {};
    
    receiptsWithAlerts.forEach(r => {
      const pid = r.alert.projectId;
      if (!byProject[pid]) {
        byProject[pid] = [];
      }
      byProject[pid].push(r);
    });

    const projectStats = [];
    for (const [pid, receipts] of Object.entries(byProject)) {
      projectStats.push({
        projectId: pid,
        projectName: alertMap[receipts[0].alertId]?.projectName || (projectMap[pid]?.projectName || '未知项目'),
        ...calculateStats(receipts)
      });
    }

    return {
      overall: overallStats,
      byProject: projectStats
    };
  }

  return {
    overall: overallStats
  };
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
