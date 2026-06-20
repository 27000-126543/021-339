const { Op } = require('../config/database');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
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

const NOTIFICATION_STATUS_NAMES = {
  'not_sent': '未发送',
  'pending': '发送中',
  'sent': '已发送',
  'delivered': '已送达',
  'failed': '发送失败'
};

const RECEIPT_TYPE_NAMES = {
  'acknowledged': '已知晓',
  'processing': '正在处理',
  'false_alarm': '误报待核'
};

const NOTIFICATION_MODE = process.env.NOTIFICATION_MODE || 'simulate';

const CHANNEL_CONFIG = {
  sms: {
    enabled: process.env.SMS_ENABLED === 'true',
    apiUrl: process.env.SMS_API_URL,
    apiKey: process.env.SMS_API_KEY,
    signature: process.env.SMS_SIGNATURE || '【高支模预警】'
  },
  voice: {
    enabled: process.env.VOICE_ENABLED === 'true',
    apiUrl: process.env.VOICE_API_URL,
    apiKey: process.env.VOICE_API_KEY,
    templateId: process.env.VOICE_TEMPLATE_ID
  },
  wechat: {
    enabled: process.env.WECOM_ENABLED === 'true',
    webhookUrl: process.env.WECOM_WEBHOOK_URL,
    key: process.env.WECOM_KEY
  },
  email: {
    enabled: process.env.EMAIL_ENABLED === 'true',
    smtpHost: process.env.EMAIL_SMTP_HOST,
    smtpPort: process.env.EMAIL_SMTP_PORT,
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
};

function isChannelEnabled(channel) {
  if (NOTIFICATION_MODE === 'simulate') {
    return true;
  }
  return CHANNEL_CONFIG[channel]?.enabled || false;
}

function getChannelStatus(channel) {
  if (NOTIFICATION_MODE === 'simulate') {
    return 'simulated';
  }
  return CHANNEL_CONFIG[channel]?.enabled ? 'real' : 'disabled';
}

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

  const occurTimeStr = alert.occurTime ? 
    (typeof alert.occurTime === 'string' ? alert.occurTime : new Date(alert.occurTime).toLocaleString('zh-CN')) : 
    new Date().toLocaleString('zh-CN');

  const commonContent = `${pouringInfo}【${alert.alertLevelName}】${alert.eventTypeName}
项目: ${projectName}
区域: ${areaName || '全部'}
位置: ${alert.location || location}
时间: ${occurTimeStr}
${valueInfo ? valueInfo + '\n' : ''}
描述: ${alert.description || alert.eventTypeName}
告警编号: ${alert.alertCode}`;

  const receiptLink = generateReceiptLink(null, recipient.id, alert.id);

  switch (channel) {
    case 'sms':
      return `${CHANNEL_CONFIG.sms.signature}${pouringInfo}${alert.alertLevelName}: ${alert.eventTypeName}，${location}。${valueInfo ? valueInfo + '，' : ''}请及时处理。回执: ${receiptLink}`;
    
    case 'voice':
      return `您好，这里是高支模预警系统。${pouringInfo}发生${alert.alertLevelName}，${alert.eventTypeName}。项目位置${location}。${valueInfo ? valueInfo + '。' : ''}请立即前往处理。重复一遍，${pouringInfo}发生${alert.alertLevelName}，${alert.eventTypeName}，项目位置${location}。请立即处理。`;
    
    case 'wechat':
      return `# ${pouringInfo}${alert.alertLevelName}通知\n\n` +
             `> **事件类型**: ${alert.eventTypeName}\n` +
             `> **告警级别**: <font color=\"${alert.alertLevel === 'level1' ? 'warning' : 'info'}\">${alert.alertLevelName}</font>\n` +
             `> **项目**: ${projectName}\n` +
             `> **区域**: ${areaName || '全部'}\n` +
             `> **位置**: ${alert.location || location}\n` +
             `> **发生时间**: ${occurTimeStr}\n` +
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
  const channelStatus = getChannelStatus('sms');
  logger.info('发送短信', { phone, notificationId, mode: NOTIFICATION_MODE, channelStatus });

  if (NOTIFICATION_MODE === 'simulate') {
    return {
      success: true,
      simulated: true,
      channel: 'sms',
      externalId: `sim_${uuidv4()}`,
      message: '短信发送成功（模拟模式）'
    };
  }

  if (!CHANNEL_CONFIG.sms.enabled) {
    return {
      success: false,
      simulated: false,
      channel: 'sms',
      error: '短信通道未启用',
      status: 'not_sent'
    };
  }

  try {
    const response = await axios.post(CHANNEL_CONFIG.sms.apiUrl, {
      apiKey: CHANNEL_CONFIG.sms.apiKey,
      phone,
      content,
      notificationId
    }, { timeout: 10000 });

    if (response.data?.success) {
      return {
        success: true,
        simulated: false,
        channel: 'sms',
        externalId: response.data.id || uuidv4(),
        message: '短信发送成功'
      };
    } else {
      return {
        success: false,
        simulated: false,
        channel: 'sms',
        error: response.data?.message || '短信发送失败'
      };
    }
  } catch (error) {
    logger.error('短信发送失败', { phone, error: error.message });
    return {
      success: false,
      simulated: false,
      channel: 'sms',
      error: error.message
    };
  }
}

async function sendVoiceCall(phone, content, notificationId) {
  const channelStatus = getChannelStatus('voice');
  logger.info('发起语音呼叫', { phone, notificationId, mode: NOTIFICATION_MODE, channelStatus });

  if (NOTIFICATION_MODE === 'simulate') {
    return {
      success: true,
      simulated: true,
      channel: 'voice',
      externalId: `sim_${uuidv4()}`,
      message: '语音呼叫成功（模拟模式）'
    };
  }

  if (!CHANNEL_CONFIG.voice.enabled) {
    return {
      success: false,
      simulated: false,
      channel: 'voice',
      error: '语音通道未启用',
      status: 'not_sent'
    };
  }

  try {
    const response = await axios.post(CHANNEL_CONFIG.voice.apiUrl, {
      apiKey: CHANNEL_CONFIG.voice.apiKey,
      phone,
      templateId: CHANNEL_CONFIG.voice.templateId,
      content,
      notificationId
    }, { timeout: 15000 });

    if (response.data?.success) {
      return {
        success: true,
        simulated: false,
        channel: 'voice',
        externalId: response.data.id || uuidv4(),
        message: '语音呼叫成功'
      };
    } else {
      return {
        success: false,
        simulated: false,
        channel: 'voice',
        error: response.data?.message || '语音呼叫失败'
      };
    }
  } catch (error) {
    logger.error('语音呼叫失败', { phone, error: error.message });
    return {
      success: false,
      simulated: false,
      channel: 'voice',
      error: error.message
    };
  }
}

async function sendWechatMessage(recipient, content, notificationId) {
  const channelStatus = getChannelStatus('wechat');
  logger.info('发送企业微信消息', { recipient: recipient.name, notificationId, mode: NOTIFICATION_MODE, channelStatus });

  if (NOTIFICATION_MODE === 'simulate') {
    return {
      success: true,
      simulated: true,
      channel: 'wechat',
      externalId: `sim_${uuidv4()}`,
      message: '企业微信消息发送成功（模拟模式）'
    };
  }

  if (!CHANNEL_CONFIG.wechat.enabled) {
    return {
      success: false,
      simulated: false,
      channel: 'wechat',
      error: '企业微信通道未启用',
      status: 'not_sent'
    };
  }

  try {
    const webhookUrl = `${CHANNEL_CONFIG.wechat.webhookUrl}?key=${CHANNEL_CONFIG.wechat.key}`;
    const response = await axios.post(webhookUrl, {
      msgtype: 'markdown',
      markdown: {
        content: content
      }
    }, { timeout: 10000 });

    if (response.data?.errcode === 0) {
      return {
        success: true,
        simulated: false,
        channel: 'wechat',
        externalId: response.data?.msgid || uuidv4(),
        message: '企业微信消息发送成功'
      };
    } else {
      return {
        success: false,
        simulated: false,
        channel: 'wechat',
        error: response.data?.errmsg || '企业微信消息发送失败'
      };
    }
  } catch (error) {
    logger.error('企业微信消息发送失败', { recipient: recipient.name, error: error.message });
    return {
      success: false,
      simulated: false,
      channel: 'wechat',
      error: error.message
    };
  }
}

async function sendEmail(email, content, notificationId) {
  const channelStatus = getChannelStatus('email');
  logger.info('发送邮件', { email, notificationId, mode: NOTIFICATION_MODE, channelStatus });

  if (NOTIFICATION_MODE === 'simulate') {
    return {
      success: true,
      simulated: true,
      channel: 'email',
      externalId: `sim_${uuidv4()}`,
      message: '邮件发送成功（模拟模式）'
    };
  }

  if (!CHANNEL_CONFIG.email.enabled) {
    return {
      success: false,
      simulated: false,
      channel: 'email',
      error: '邮件通道未启用',
      status: 'not_sent'
    };
  }

  return {
    success: false,
    simulated: false,
    channel: 'email',
    error: '邮件功能待实现'
  };
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
  const channelEnabled = isChannelEnabled(channel);
  const isSimulated = NOTIFICATION_MODE === 'simulate';

  let initialStatus = 'pending';
  let failReason = null;

  if (!channelEnabled && !isSimulated) {
    initialStatus = 'not_sent';
    failReason = `${CHANNEL_NAMES[channel]}通道未启用`;
  }

  const notification = await Notification.create({
    alertId: alert.id,
    recipientId: recipient.id,
    recipientName: recipient.name,
    recipientPhone: recipient.phone,
    recipientRole: recipient.role,
    recipientRoleName: recipient.roleName || ROLE_NAMES[recipient.role] || recipient.role,
    channel,
    channelName: CHANNEL_NAMES[channel],
    content,
    receiptLink,
    status: initialStatus,
    statusName: NOTIFICATION_STATUS_NAMES[initialStatus],
    isSimulated,
    isEscalation,
    escalationLevel,
    failReason,
    receiptStatus: 'none'
  });

  const updatedReceiptLink = generateReceiptLink(notification.id, recipient.id, alert.id);
  await Notification.update(notification.id, { receiptLink: updatedReceiptLink });
  notification.receiptLink = updatedReceiptLink;

  if (initialStatus === 'not_sent') {
    return {
      notification,
      sendResult: { 
        success: false, 
        channel, 
        error: failReason,
        status: 'not_sent'
      }
    };
  }

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

  let finalStatus;
  if (sendResult.status === 'not_sent') {
    finalStatus = 'not_sent';
  } else if (sendResult.success) {
    finalStatus = channel === 'sms' ? 'delivered' : 'sent';
  } else {
    finalStatus = 'failed';
  }

  const updateData = {
    status: finalStatus,
    statusName: NOTIFICATION_STATUS_NAMES[finalStatus],
    sendTime: new Date(),
    externalId: sendResult.externalId,
    failReason: sendResult.error,
    isSimulated: sendResult.simulated || false
  };

  if (finalStatus === 'delivered') {
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
    return { sent: false, reason: 'already_sent', existingCount: existingNotifications };
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

  const receiptCount = notifications.filter(n => n.receiptStatus && n.receiptStatus !== 'none').length;
  
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
    order: [['createdAt', 'DESC']],
    limit: pageSize,
    offset: (page - 1) * pageSize
  });

  const listWithAssociations = await Promise.all(rows.map(async notification => {
    return await loadAssociations(notification, [
      { model: 'Alert', as: 'alert' },
      { model: 'Recipient', as: 'recipient' }
    ]);
  }));

  const summary = {
    total: count,
    byChannel: {},
    byStatus: {}
  };

  const allNotificationsResult = await Notification.findAll({ where });
  allNotificationsResult.rows.forEach(n => {
    summary.byChannel[n.channel] = (summary.byChannel[n.channel] || 0) + 1;
    summary.byStatus[n.status] = (summary.byStatus[n.status] || 0) + 1;
  });

  return {
    total: count,
    page,
    pageSize,
    list: listWithAssociations,
    summary
  };
}

function getChannelConfig() {
  return {
    mode: NOTIFICATION_MODE,
    channels: {
      sms: {
        name: CHANNEL_NAMES.sms,
        enabled: CHANNEL_CONFIG.sms.enabled,
        configured: !!CHANNEL_CONFIG.sms.apiKey && CHANNEL_CONFIG.sms.apiKey !== 'your_sms_api_key',
        mode: NOTIFICATION_MODE === 'simulate' ? 'simulate' : (CHANNEL_CONFIG.sms.enabled ? 'real' : 'disabled')
      },
      voice: {
        name: CHANNEL_NAMES.voice,
        enabled: CHANNEL_CONFIG.voice.enabled,
        configured: !!CHANNEL_CONFIG.voice.apiKey && CHANNEL_CONFIG.voice.apiKey !== 'your_voice_api_key',
        mode: NOTIFICATION_MODE === 'simulate' ? 'simulate' : (CHANNEL_CONFIG.voice.enabled ? 'real' : 'disabled')
      },
      wechat: {
        name: CHANNEL_NAMES.wechat,
        enabled: CHANNEL_CONFIG.wechat.enabled,
        configured: !!CHANNEL_CONFIG.wechat.key && CHANNEL_CONFIG.wechat.key !== 'your_wecom_key',
        mode: NOTIFICATION_MODE === 'simulate' ? 'simulate' : (CHANNEL_CONFIG.wechat.enabled ? 'real' : 'disabled')
      },
      email: {
        name: CHANNEL_NAMES.email,
        enabled: CHANNEL_CONFIG.email.enabled,
        configured: !!CHANNEL_CONFIG.email.pass && CHANNEL_CONFIG.email.pass !== 'your_email_password',
        mode: NOTIFICATION_MODE === 'simulate' ? 'simulate' : (CHANNEL_CONFIG.email.enabled ? 'real' : 'disabled')
      }
    }
  };
}

module.exports = {
  CHANNEL_NAMES,
  NOTIFICATION_STATUS_NAMES,
  RECEIPT_TYPE_NAMES,
  NOTIFICATION_MODE,
  CHANNEL_CONFIG,
  isChannelEnabled,
  getChannelStatus,
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
  getNotificationList,
  getChannelConfig
};
