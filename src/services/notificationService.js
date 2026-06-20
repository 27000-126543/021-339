const { Op } = require('../config/database');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { 
  Alert, 
  Recipient, 
  Notification, 
  Project, 
  Area,
  loadAssociations
} = require('../models');
const { matchNotificationRules, ROLE_NAMES } = require('./notificationRuleService');
const logger = require('../config/logger');
require('dotenv').config();

const CHANNEL_NAMES = {
  'sms': '短信',
  'voice': '电话语音',
  'wechat': '企业微信',
  'email': '邮件'
};

const RECEIPT_TYPE_NAMES = {
  'acknowledged': '已知晓',
  'processing': '正在处理',
  'false_alarm': '误报待核'
};

function generateReceiptToken(notificationId, recipientId, alertId) {
  return jwt.sign(
    { notificationId, recipientId, alertId, type: 'receipt' },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function generateReceiptLink(notificationId, recipientId, alertId) {
  const token = generateReceiptToken(notificationId, recipientId, alertId);
  const baseUrl = process.env.RECEIPT_BASE_URL || 'http://localhost:3000';
  return `${baseUrl}/api/receipt?token=${token}`;
}

function generateNotificationContent(alert, channel, recipient) {
  const projectName = alert.project ? alert.project.projectName : '项目';
  const areaName = alert.area ? alert.area.areaName : '';
  const location = areaName ? `${projectName}-${areaName}` : projectName;

  const valueInfo = alert.currentValue !== null && alert.currentValue !== undefined
    ? `当前值: ${alert.currentValue}${alert.unit || ''}, 阈值: ${alert.thresholdValue}${alert.unit || ''}`
    : '';

  const pouringInfo = alert.isNightPouring ? '【夜间浇筑期间】' : 
                      alert.pouringStatus === 'pouring' ? '【浇筑期间】' : '';

  const commonContent = `${pouringInfo}【${alert.alertLevelName}】${alert.eventTypeName}
项目: ${projectName}
区域: ${areaName || '全部'}
位置: ${alert.location || location}
时间: ${alert.occurTime.toLocaleString('zh-CN')}
${valueInfo ? valueInfo + '\n' : ''}
描述: ${alert.description || alert.eventTypeName}
告警编号: ${alert.alertCode}`;

  const receiptLink = generateReceiptLink(null, recipient.id, alert.id);

  switch (channel) {
    case 'sms':
      return `【高支模预警】${pouringInfo}${alert.alertLevelName}: ${alert.eventTypeName}，${location}。${valueInfo ? valueInfo + '，' : ''}请及时处理。回执: ${receiptLink}`;
    
    case 'voice':
      return `您好，这里是高支模预警系统。${pouringInfo}发生${alert.alertLevelName}，${alert.eventTypeName}。项目位置${location}。${valueInfo ? valueInfo + '。' : ''}请立即前往处理。重复一遍，${pouringInfo}发生${alert.alertLevelName}，${alert.eventTypeName}，项目位置${location}。请立即处理。`;
    
    case 'wechat':
      return `# ${pouringInfo}${alert.alertLevelName}通知\n\n` +
             `> **事件类型**: ${alert.eventTypeName}\n` +
             `> **告警级别**: <font color=\"${alert.alertLevel === 'level1' ? 'warning' : 'info'}\">${alert.alertLevelName}</font>\n` +
             `> **项目**: ${projectName}\n` +
             `> **区域**: ${areaName || '全部'}\n` +
             `> **位置**: ${alert.location || location}\n` +
             `> **发生时间**: ${alert.occurTime.toLocaleString('zh-CN')}\n` +
             (valueInfo ? `> **监测数据**: ${valueInfo}\n` : '') +
             `> **告警编号**: ${alert.alertCode}\n\n` +
             `**描述**: ${alert.description || alert.eventTypeName}\n\n` +
             `请相关人员立即处理！\n\n` +
             `[点击回执](${receiptLink})`;
    
    case 'email':
      return `${commonContent}\n\n请点击以下链接进行回执确认:\n${receiptLink}`;
    
    default:
      return `${commonContent}\n\n回执链接: ${receiptLink}`;
  }
}

async function getMatchedRecipients(rules, alert) {
  logger.info('获取匹配接收人', { alertId: alert.id, ruleCount: rules.length });

  const allRoles = new Set();
  const allChannels = { sms: false, voice: false, wechat: false, email: false };

  for (const rule of rules) {
    if (rule.roles && Array.isArray(rule.roles)) {
      rule.roles.forEach(role => allRoles.add(role));
    }
    if (rule.channels) {
      Object.keys(rule.channels).forEach(channel => {
        if (rule.channels[channel]) allChannels[channel] = true;
      });
    }
  }

  const rolesArray = Array.from(allRoles);
  if (rolesArray.length === 0) {
    logger.warn('未匹配到任何接收角色', { alertId: alert.id });
    return { recipients: [], channels: allChannels };
  }

  const allRecipients = await Recipient.findAll({
    where: {
      isEnabled: true
    },
    order: [['sortOrder', 'ASC'], ['createdAt', 'ASC']]
  });

  const recipients = allRecipients.rows.filter(r => {
    const roleMatch = rolesArray.includes(r.role);
    const scopeMatch = r.projectId === alert.projectId || 
                      r.areaId === alert.areaId || 
                      (r.projectId === null && r.areaId === null);
    return roleMatch && scopeMatch;
  });

  const uniqueRecipients = [];
  const phoneSet = new Set();

  for (const recipient of recipients) {
    if (!phoneSet.has(recipient.phone)) {
      phoneSet.add(recipient.phone);
      uniqueRecipients.push(recipient);
    }
  }

  const onDutyRecipients = uniqueRecipients.filter(r => r.isOnDuty);
  const finalRecipients = onDutyRecipients.length > 0 ? onDutyRecipients : uniqueRecipients;

  logger.info('匹配到接收人', { 
    alertId: alert.id, 
    recipientCount: finalRecipients.length,
    roles: rolesArray,
    channels: allChannels
  });

  return { recipients: finalRecipients, channels: allChannels };
}

async function sendSms(phone, content, notificationId) {
  logger.info('发送短信', { phone, notificationId, content: content.substring(0, 50) + '...' });
  
  try {
    return {
      success: true,
      channel: 'sms',
      externalId: uuidv4(),
      message: '短信发送成功（模拟）'
    };
  } catch (error) {
    logger.error('短信发送失败', { phone, error: error.message });
    return {
      success: false,
      channel: 'sms',
      error: error.message
    };
  }
}

async function sendVoiceCall(phone, content, notificationId) {
  logger.info('发起语音呼叫', { phone, notificationId, content: content.substring(0, 50) + '...' });
  
  try {
    return {
      success: true,
      channel: 'voice',
      externalId: uuidv4(),
      message: '语音呼叫成功（模拟）'
    };
  } catch (error) {
    logger.error('语音呼叫失败', { phone, error: error.message });
    return {
      success: false,
      channel: 'voice',
      error: error.message
    };
  }
}

async function sendWechatMessage(recipient, content, notificationId) {
  logger.info('发送企业微信消息', { recipient: recipient.name, notificationId });
  
  try {
    return {
      success: true,
      channel: 'wechat',
      externalId: uuidv4(),
      message: '企业微信消息发送成功（模拟）'
    };
  } catch (error) {
    logger.error('企业微信消息发送失败', { recipient: recipient.name, error: error.message });
    return {
      success: false,
      channel: 'wechat',
      error: error.message
    };
  }
}

async function sendEmail(email, content, notificationId) {
  logger.info('发送邮件', { email, notificationId });
  
  try {
    return {
      success: true,
      channel: 'email',
      externalId: uuidv4(),
      message: '邮件发送成功（模拟）'
    };
  } catch (error) {
    logger.error('邮件发送失败', { email, error: error.message });
    return {
      success: false,
      channel: 'email',
      error: error.message
    };
  }
}

async function sendNotification(alert, recipient, channel, isEscalation = false, escalationLevel = 0) {
  logger.info('创建并发送通知', { 
    alertId: alert.id, 
    recipientId: recipient.id, 
    channel,
    isEscalation 
  });

  const content = generateNotificationContent(alert, channel, recipient);
  const receiptLink = generateReceiptLink(null, recipient.id, alert.id);

  const notification = await Notification.create({
    alertId: alert.id,
    recipientId: recipient.id,
    recipientName: recipient.name,
    recipientPhone: recipient.phone,
    recipientRole: recipient.role,
    channel,
    channelName: CHANNEL_NAMES[channel],
    content,
    receiptLink,
    status: 'pending',
    isEscalation,
    escalationLevel
  });

  const updatedReceiptLink = generateReceiptLink(notification.id, recipient.id, alert.id);
  await Notification.update(notification.id, { receiptLink: updatedReceiptLink });
  notification.receiptLink = updatedReceiptLink;

  let sendResult;
  switch (channel) {
    case 'sms':
      sendResult = await sendSms(recipient.phone, content, notification.id);
      break;
    case 'voice':
      sendResult = await sendVoiceCall(recipient.phone, content, notification.id);
      break;
    case 'wechat':
      sendResult = await sendWechatMessage(recipient, content, notification.id);
      break;
    case 'email':
      sendResult = await sendEmail(recipient.email, content, notification.id);
      break;
    default:
      sendResult = { success: false, error: '未知渠道' };
  }

  const updateData = {
    status: sendResult.success ? 'sent' : 'failed',
    sendTime: new Date(),
    externalId: sendResult.externalId,
    failReason: sendResult.error
  };

  if (sendResult.success && channel === 'sms') {
    updateData.status = 'delivered';
    updateData.deliveredTime = new Date();
  }

  await Notification.update(notification.id, updateData);
  Object.assign(notification, updateData);

  return {
    notification,
    sendResult
  };
}

async function triggerNotifications(alertId) {
  logger.info('触发通知流程', { alertId });

  const alert = await Alert.findByPk(alertId);
  if (!alert) {
    throw new Error(`告警不存在: ${alertId}`);
  }

  const alertWithAssociations = await loadAssociations(alert, [
    { model: 'Project', as: 'project' },
    { model: 'Area', as: 'area' }
  ]);

  const existingNotifications = await Notification.count({ where: { alertId } });
  if (existingNotifications > 0) {
    logger.warn('该告警已有通知记录，跳过', { alertId });
    return { sent: false, reason: 'already_sent' };
  }

  const rules = await matchNotificationRules(alertWithAssociations);
  if (rules.length === 0) {
    logger.warn('未匹配到通知规则，使用默认规则', { alertId });
    
    const defaultChannels = {
      sms: alert.alertLevel !== 'notice',
      voice: alert.alertLevel === 'level1',
      wechat: true,
      email: false
    };

    const recipientsResult = await Recipient.findAll({
      where: {
        projectId: alert.projectId,
        isEnabled: true
      }
    });
    const recipients = recipientsResult.rows;

    const notifications = [];
    for (const recipient of recipients) {
      const recipientChannels = recipient.notificationChannels || {};
      
      for (const channel of Object.keys(defaultChannels)) {
        if (defaultChannels[channel] && recipientChannels[channel] !== false) {
          const result = await sendNotification(alertWithAssociations, recipient, channel);
          notifications.push(result);
        }
      }
    }

    await updateAlertReceiptStatus(alertId);
    
    return {
      sent: true,
      notificationCount: notifications.length,
      usingDefault: true,
      notifications
    };
  }

  const { recipients, channels } = await getMatchedRecipients(rules, alertWithAssociations);
  const notifications = [];

  for (const recipient of recipients) {
    const recipientChannels = recipient.notificationChannels || {};
    
    for (const channel of Object.keys(channels)) {
      if (channels[channel] && recipientChannels[channel] !== false) {
        try {
          const result = await sendNotification(alertWithAssociations, recipient, channel);
          notifications.push(result);
        } catch (error) {
          logger.error('发送单条通知失败', { 
            alertId, 
            recipientId: recipient.id, 
            channel, 
            error: error.message 
          });
        }
      }
    }
  }

  await updateAlertReceiptStatus(alertId);

  logger.info('通知发送完成', { 
    alertId, 
    recipientCount: recipients.length, 
    notificationCount: notifications.length 
  });

  return {
    sent: true,
    recipientCount: recipients.length,
    notificationCount: notifications.length,
    notifications
  };
}

async function updateAlertReceiptStatus(alertId) {
  const notificationsResult = await Notification.findAll({ where: { alertId } });
  const notifications = notificationsResult.rows;
  
  if (notifications.length === 0) {
    return;
  }

  const receiptCount = notifications.filter(n => n.receiptStatus !== 'none').length;
  
  let receiptStatus = 'none';
  if (receiptCount === notifications.length) {
    receiptStatus = 'all';
  } else if (receiptCount > 0) {
    receiptStatus = 'partial';
  }

  await Alert.update(alertId, { receiptStatus });
}

async function getNotificationList(params = {}) {
  const { 
    page = 1, 
    pageSize = 20, 
    alertId, 
    recipientId, 
    channel, 
    status,
    startTime,
    endTime
  } = params;

  const where = {};
  if (alertId) where.alertId = alertId;
  if (recipientId) where.recipientId = recipientId;
  if (channel) where.channel = channel;
  if (status) where.status = status;
  if (startTime) where.sendTime = { ...where.sendTime, $gte: new Date(startTime) };
  if (endTime) where.sendTime = { ...where.sendTime, $lte: new Date(endTime) };

  const { count, rows } = await Notification.findAll({
    where,
    order: [['sendTime', 'DESC']],
    limit: pageSize,
    offset: (page - 1) * pageSize
  });

  const listWithAssociations = await Promise.all(rows.map(async notification => {
    return await loadAssociations(notification, [
      { model: 'Alert', as: 'alert' },
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

module.exports = {
  CHANNEL_NAMES,
  RECEIPT_TYPE_NAMES,
  generateReceiptToken,
  generateReceiptLink,
  generateNotificationContent,
  getMatchedRecipients,
  sendSms,
  sendVoiceCall,
  sendWechatMessage,
  sendEmail,
  sendNotification,
  triggerNotifications,
  updateAlertReceiptStatus,
  getNotificationList
};
