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

function getChannelConfigStatus(channel) {
  const config = CHANNEL_CONFIG[channel];
  if (!config) {
    return { enabled: false, complete: false, missing: ['通道配置不存在'] };
  }

  if (NOTIFICATION_MODE === 'simulate') {
    return { enabled: true, complete: true, missing: [], mode: 'simulate' };
  }

  const missing = [];

  switch (channel) {
    case 'sms':
      if (!config.enabled) missing.push('短信通道未启用(设置SMS_ENABLED=true)');
      if (!config.apiUrl || config.apiUrl === 'https://api.sms-provider.com/send') missing.push('缺少SMS_API_URL');
      if (!config.apiKey || config.apiKey === 'your_sms_api_key') missing.push('缺少SMS_API_KEY');
      break;
    case 'voice':
      if (!config.enabled) missing.push('语音通道未启用(设置VOICE_ENABLED=true)');
      if (!config.apiUrl || config.apiUrl === 'https://api.voice-provider.com/call') missing.push('缺少VOICE_API_URL');
      if (!config.apiKey || config.apiKey === 'your_voice_api_key') missing.push('缺少VOICE_API_KEY');
      if (!config.templateId || config.templateId === 'alert_template') missing.push('缺少VOICE_TEMPLATE_ID');
      break;
    case 'wechat':
      if (!config.enabled) missing.push('企业微信通道未启用(设置WECOM_ENABLED=true)');
      if (!config.webhookUrl || config.webhookUrl === 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send') missing.push('缺少WECOM_WEBHOOK_URL');
      if (!config.key || config.key === 'your_wecom_key') missing.push('缺少WECOM_KEY');
      break;
    case 'email':
      if (!config.enabled) missing.push('邮件通道未启用(设置EMAIL_ENABLED=true)');
      if (!config.smtpHost) missing.push('缺少EMAIL_SMTP_HOST');
      if (!config.smtpPort) missing.push('缺少EMAIL_SMTP_PORT');
      if (!config.user) missing.push('缺少EMAIL_USER');
      if (!config.pass || config.pass === 'your_email_password') missing.push('缺少EMAIL_PASS');
      break;
  }

  return {
    enabled: config.enabled,
    complete: missing.length === 0,
    missing,
    mode: NOTIFICATION_MODE
  };
}

function getChannelStatus(channel) {
  if (NOTIFICATION_MODE === 'simulate') {
    return 'simulated';
  }
  const status = getChannelConfigStatus(channel);
  if (!status.enabled) return 'disabled';
  if (!status.complete) return 'incomplete';
  return 'real';
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
  const configStatus = getChannelConfigStatus('sms');
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

  if (!configStatus.complete) {
    return {
      success: false,
      simulated: false,
      channel: 'sms',
      error: `短信通道配置不完整: ${configStatus.missing.join('; ')}`,
      status: 'not_sent',
      failReason: `短信通道配置不完整: ${configStatus.missing.join('; ')}`
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
  const configStatus = getChannelConfigStatus('voice');
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

  if (!configStatus.complete) {
    return {
      success: false,
      simulated: false,
      channel: 'voice',
      error: `语音通道配置不完整: ${configStatus.missing.join('; ')}`,
      status: 'not_sent',
      failReason: `语音通道配置不完整: ${configStatus.missing.join('; ')}`
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
  const configStatus = getChannelConfigStatus('wechat');
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

  if (!configStatus.complete) {
    return {
      success: false,
      simulated: false,
      channel: 'wechat',
      error: `企业微信通道配置不完整: ${configStatus.missing.join('; ')}`,
      status: 'not_sent',
      failReason: `企业微信通道配置不完整: ${configStatus.missing.join('; ')}`
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
  const configStatus = getChannelConfigStatus('email');
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

  if (!configStatus.complete) {
    return {
      success: false,
      simulated: false,
      channel: 'email',
      error: `邮件通道配置不完整: ${configStatus.missing.join('; ')}`,
      status: 'not_sent',
      failReason: `邮件通道配置不完整: ${configStatus.missing.join('; ')}`
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
  const channelConfigStatus = getChannelConfigStatus(channel);
  const isSimulated = NOTIFICATION_MODE === 'simulate';

  let initialStatus = 'pending';
  let failReason = null;

  if (NOTIFICATION_MODE === 'real') {
    if (!channelConfigStatus.complete) {
      initialStatus = 'not_sent';
      failReason = `${CHANNEL_NAMES[channel]}通道配置不完整: ${channelConfigStatus.missing.join('; ')}`;
    } else if (!channelConfigStatus.enabled) {
      initialStatus = 'not_sent';
      failReason = `${CHANNEL_NAMES[channel]}通道未启用`;
    }
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
    channelConfigStatus: NOTIFICATION_MODE === 'real' ? {
      complete: channelConfigStatus.complete,
      missing: channelConfigStatus.missing
    } : null,
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
    failReason: sendResult.failReason || sendResult.error,
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
          try {
            const result = await sendNotification(alertWithAssociations, recipient, channel);
            notifications.push(result);
          } catch (error) {
            logger.error('默认规则下发送单条通知失败', { 
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
    
    const batchOverview = buildNotificationBatchOverview(alertWithAssociations, recipients, notifications);

    logger.info('默认规则通知发送完成', { 
      alertId, 
      recipientCount: batchOverview.expectedRecipientCount, 
      notificationCount: batchOverview.totalNotifications,
      successCount: batchOverview.successCount,
      notSentCount: batchOverview.notSentCount
    });

    return {
      sent: true,
      recipientCount: recipients.length,
      notificationCount: notifications.length,
      usingDefault: true,
      notifications,
      batchOverview
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

  const batchOverview = buildNotificationBatchOverview(alertWithAssociations, recipients, notifications);

  logger.info('通知发送完成', { 
    alertId, 
    recipientCount: batchOverview.expectedRecipientCount, 
    notificationCount: batchOverview.totalNotifications,
    successCount: batchOverview.successCount,
    notSentCount: batchOverview.notSentCount
  });

  return {
    sent: true,
    recipientCount: recipients.length,
    notificationCount: notifications.length,
    notifications,
    batchOverview
  };
}

function buildNotificationBatchOverview(alert, expectedRecipients, sentResults) {
  const notifications = sentResults.map(r => r.notification);
  
  const byChannel = {
    sms: { total: 0, success: 0, not_sent: 0, failed: 0, recipients: [] },
    voice: { total: 0, success: 0, not_sent: 0, failed: 0, recipients: [] },
    wechat: { total: 0, success: 0, not_sent: 0, failed: 0, recipients: [] },
    email: { total: 0, success: 0, not_sent: 0, failed: 0, recipients: [] }
  };

  const byRecipient = {};

  notifications.forEach(n => {
    const channel = n.channel;
    if (byChannel[channel]) {
      byChannel[channel].total++;
      byChannel[channel].recipients.push({
        id: n.recipientId,
        name: n.recipientName,
        role: n.recipientRole,
        roleName: n.recipientRoleName,
        phone: n.recipientPhone,
        status: n.status,
        statusName: n.statusName,
        failReason: n.failReason,
        isSimulated: n.isSimulated,
        notificationId: n.id
      });

      if (n.status === 'delivered' || n.status === 'sent') {
        byChannel[channel].success++;
      } else if (n.status === 'not_sent') {
        byChannel[channel].not_sent++;
      } else if (n.status === 'failed') {
        byChannel[channel].failed++;
      }
    }

    if (!byRecipient[n.recipientId]) {
      byRecipient[n.recipientId] = {
        id: n.recipientId,
        name: n.recipientName,
        role: n.recipientRole,
        roleName: n.recipientRoleName,
        phone: n.recipientPhone,
        channels: {},
        allSuccess: true,
        anyNotSent: false,
        anyFailed: false
      };
    }

    byRecipient[n.recipientId].channels[channel] = {
      status: n.status,
      statusName: n.statusName,
      failReason: n.failReason,
      isSimulated: n.isSimulated,
      notificationId: n.id
    };

    if (n.status === 'not_sent') byRecipient[n.recipientId].anyNotSent = true;
    if (n.status === 'failed') byRecipient[n.recipientId].anyFailed = true;
    if (n.status !== 'delivered' && n.status !== 'sent') byRecipient[n.recipientId].allSuccess = false;
  });

  const expectedRecipientIds = new Set(expectedRecipients.map(r => r.id));
  const actualRecipientIds = new Set(notifications.map(n => n.recipientId));
  const missingRecipients = expectedRecipients
    .filter(r => !actualRecipientIds.has(r.id))
    .map(r => ({
      id: r.id,
      name: r.name,
      role: r.role,
      roleName: r.roleName || ROLE_NAMES[r.role] || r.role,
      phone: r.phone,
      reason: '未生成任何通知'
    }));

  let successCount = 0;
  let notSentCount = 0;
  let failedCount = 0;

  Object.values(byChannel).forEach(ch => {
    successCount += ch.success;
    notSentCount += ch.not_sent;
    failedCount += ch.failed;
  });

  const channelConfigSummary = {};
  ['sms', 'voice', 'wechat', 'email'].forEach(ch => {
    const configStatus = getChannelConfigStatus(ch);
    const channelData = byChannel[ch];
    channelConfigSummary[ch] = {
      name: CHANNEL_NAMES[ch],
      mode: configStatus.mode,
      enabled: configStatus.enabled,
      complete: configStatus.complete,
      missing: configStatus.missing,
      total: channelData.total,
      notSent: channelData.not_sent,
      failed: channelData.failed,
      allNotSent: channelData.total > 0 && channelData.not_sent === channelData.total
    };
  });

  return {
    alertId: alert.id,
    alertCode: alert.alertCode,
    alertLevel: alert.alertLevel,
    alertLevelName: alert.alertLevelName,
    expectedRecipientCount: expectedRecipients.length,
    actualRecipientCount: byRecipient ? Object.keys(byRecipient).length : 0,
    totalNotifications: notifications.length,
    successCount,
    notSentCount,
    failedCount,
    byChannel,
    byRecipient,
    byRecipientList: byRecipient ? Object.values(byRecipient) : [],
    missingRecipients,
    unhandledChannels: [],
    channelConfigSummary
  };
}

async function getNotificationBatchOverview(alertId) {
  const alert = await Alert.findByPk(alertId);
  if (!alert) {
    throw new Error(`告警不存在: ${alertId}`);
  }

  const notificationsResult = await Notification.findAll({
    where: { alertId },
    order: [['createdAt', 'ASC']]
  });

  const notifications = notificationsResult.rows.map(n => ({ notification: n }));

  const uniqueRecipientIds = new Set(notificationsResult.rows.map(n => n.recipientId));
  const expectedRecipientsResult = await Recipient.findAll({
    where: {
      isEnabled: true,
      projectId: alert.projectId
    }
  });
  const expectedRecipients = expectedRecipientsResult.rows.filter(r => uniqueRecipientIds.has(r.id));

  return buildNotificationBatchOverview(alert, expectedRecipients, notifications);
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
    byStatus: {},
    channelConfigSummary: {}
  };

  const allNotificationsResult = await Notification.findAll({ where });
  allNotificationsResult.rows.forEach(n => {
    summary.byChannel[n.channel] = (summary.byChannel[n.channel] || 0) + 1;
    summary.byStatus[n.status] = (summary.byStatus[n.status] || 0) + 1;
  });

  ['sms', 'voice', 'wechat', 'email'].forEach(ch => {
    const configStatus = getChannelConfigStatus(ch);
    const channelCount = summary.byChannel[ch] || 0;
    const notSentCount = allNotificationsResult.rows.filter(n => n.channel === ch && n.status === 'not_sent').length;
    const failedCount = allNotificationsResult.rows.filter(n => n.channel === ch && n.status === 'failed').length;
    summary.channelConfigSummary[ch] = {
      name: CHANNEL_NAMES[ch],
      mode: configStatus.mode,
      enabled: configStatus.enabled,
      complete: configStatus.complete,
      missing: configStatus.missing,
      total: channelCount,
      notSent: notSentCount,
      failed: failedCount,
      allNotSent: channelCount > 0 && notSentCount === channelCount
    };
  });

  return {
    total: count,
    page,
    pageSize,
    list: listWithAssociations,
    summary
  };
}

async function getNotificationBatchLedger(params = {}) {
  const {
    page = 1,
    pageSize = 20,
    projectId,
    alertLevel,
    startTime,
    endTime
  } = params;

  const alertWhere = {};
  if (projectId) alertWhere.projectId = projectId;
  if (alertLevel) alertWhere.alertLevel = alertLevel;
  if (startTime) alertWhere.occurTime = { ...alertWhere.occurTime, $gte: new Date(startTime) };
  if (endTime) alertWhere.occurTime = { ...alertWhere.occurTime, $lte: new Date(endTime) };

  const { count, rows: alertRows } = await Alert.findAll({
    where: alertWhere,
    order: [['occurTime', 'DESC']],
    limit: pageSize,
    offset: (page - 1) * pageSize
  });

  const alertIds = alertRows.map(a => a.id);

  const notificationsResult = alertIds.length > 0
    ? await Notification.findAll({ where: { alertId: { $in: alertIds } } })
    : { rows: [] };
  const notificationsByAlert = {};
  notificationsResult.rows.forEach(n => {
    if (!notificationsByAlert[n.alertId]) {
      notificationsByAlert[n.alertId] = [];
    }
    notificationsByAlert[n.alertId].push(n);
  });

  const { Receipt } = require('../models');
  const receiptsResult = alertIds.length > 0
    ? await Receipt.findAll({ where: { alertId: { $in: alertIds } } })
    : { rows: [] };
  const receiptsByAlert = {};
  receiptsResult.rows.forEach(r => {
    if (!receiptsByAlert[r.alertId]) {
      receiptsByAlert[r.alertId] = [];
    }
    receiptsByAlert[r.alertId].push(r);
  });

  const ledgerList = alertRows.map(alert => {
    const notifications = notificationsByAlert[alert.id] || [];
    const receipts = receiptsByAlert[alert.id] || [];

    const uniqueRecipientIds = new Set(notifications.map(n => n.recipientId));
    const totalRecipients = uniqueRecipientIds.size;

    const successNotifications = notifications.filter(n => n.status === 'delivered' || n.status === 'sent');
    const notSentNotifications = notifications.filter(n => n.status === 'not_sent');
    const failedNotifications = notifications.filter(n => n.status === 'failed');

    const notSentRecipientIds = new Set(notSentNotifications.map(n => n.recipientId));
    const allFailedRecipientIds = new Set([
      ...notSentNotifications.map(n => n.recipientId),
      ...failedNotifications.map(n => n.recipientId)
    ]);

    const fullyFailedRecipientCount = Array.from(allFailedRecipientIds).filter(rid => {
      const recipientNotifications = notifications.filter(n => n.recipientId === rid);
      return recipientNotifications.every(n => n.status === 'not_sent' || n.status === 'failed');
    }).length;

    const receiptedRecipientIds = new Set(receipts.map(r => r.recipientId));
    const receiptedCount = receiptedRecipientIds.size;
    const pendingCount = totalRecipients - receiptedCount;

    let firstReceiptTime = null;
    let lastReceiptTime = null;
    let firstResponseMinutes = null;
    if (receipts.length > 0) {
      const receiptTimes = receipts.map(r => new Date(r.receiptTime).getTime());
      firstReceiptTime = new Date(Math.min(...receiptTimes));
      lastReceiptTime = new Date(Math.max(...receiptTimes));
      if (alert.occurTime) {
        firstResponseMinutes = (firstReceiptTime - new Date(alert.occurTime)) / (1000 * 60);
        firstResponseMinutes = Number(firstResponseMinutes.toFixed(2));
      }
    }

    const byChannel = {};
    notifications.forEach(n => {
      if (!byChannel[n.channel]) {
        byChannel[n.channel] = { total: 0, success: 0, not_sent: 0, failed: 0 };
      }
      byChannel[n.channel].total++;
      if (n.status === 'delivered' || n.status === 'sent') byChannel[n.channel].success++;
      else if (n.status === 'not_sent') byChannel[n.channel].not_sent++;
      else if (n.status === 'failed') byChannel[n.channel].failed++;
    });

    return {
      alertId: alert.id,
      alertCode: alert.alertCode,
      alertLevel: alert.alertLevel,
      alertLevelName: alert.alertLevelName,
      eventType: alert.eventType,
      eventTypeName: alert.eventTypeName,
      occurTime: alert.occurTime,
      status: alert.status,
      areaId: alert.areaId,
      projectId: alert.projectId,
      notification: {
        expectedRecipientCount: totalRecipients,
        totalNotifications: notifications.length,
        successCount: successNotifications.length,
        notSentCount: notSentNotifications.length,
        failedCount: failedNotifications.length,
        fullyFailedRecipientCount,
        byChannel
      },
      receipt: {
        totalRecipients,
        receiptedCount,
        pendingCount,
        progress: totalRecipients > 0 ? Math.round((receiptedCount / totalRecipients) * 100) : 0,
        firstReceiptTime,
        lastReceiptTime,
        firstResponseMinutes
      },
      hasNotificationIssue: notSentNotifications.length > 0 || failedNotifications.length > 0,
      hasReceiptDelay: pendingCount > 0 && totalRecipients > 0
    };
  });

  return {
    total: count,
    page,
    pageSize,
    list: ledgerList
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
  getChannelConfigStatus,
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
  getNotificationBatchOverview,
  buildNotificationBatchOverview,
  getNotificationBatchLedger,
  getChannelConfig
};
