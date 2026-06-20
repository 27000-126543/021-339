const { v4: uuidv4 } = require('uuid');
const { Reminder, Alert, Notification, Recipient, loadAssociations } = require('../models');
const { 
  sendSms, 
  sendVoiceCall, 
  generateNotificationContent,
  CHANNEL_NAMES,
  NOTIFICATION_STATUS_NAMES 
} = require('./notificationService');
const logger = require('../config/logger');

const REMINDER_CHANNEL_NAMES = {
  'sms': '短信催办',
  'voice': '语音催办'
};

const REMINDER_STATUS_NAMES = {
  'pending': '待发送',
  'sent': '已发送',
  'delivered': '已送达',
  'failed': '发送失败',
  'not_sent': '未发送'
};

async function submitReminder(reminderData, operatorId = null, operatorName = null) {
  const { alertId, recipientIds, channels = ['sms'], reason = null } = reminderData;

  if (!alertId) {
    throw new Error('缺少告警ID');
  }
  if (!recipientIds || !Array.isArray(recipientIds) || recipientIds.length === 0) {
    throw new Error('请选择至少一个待催办人员');
  }
  if (!channels || channels.length === 0) {
    throw new Error('请选择至少一个催办通道');
  }

  const alert = await Alert.findByPk(alertId);
  if (!alert) {
    throw new Error(`告警不存在: ${alertId}`);
  }

  const reminders = [];

  for (const recipientId of recipientIds) {
    const recipient = await Recipient.findByPk(recipientId);
    if (!recipient) {
      logger.warn('催办接收人不存在，跳过', { alertId, recipientId });
      continue;
    }

    for (const channel of channels) {
      const reminder = await createReminder({
        alertId,
        recipientId,
        recipientName: recipient.name,
        recipientPhone: recipient.phone,
        recipientRole: recipient.role,
        recipientRoleName: recipient.roleName,
        channel,
        channelName: REMINDER_CHANNEL_NAMES[channel] || channel,
        reason,
        operatorId,
        operatorName
      }, alert);

      reminders.push(reminder);

      (async () => {
        try {
          await sendReminder(reminder.id, alert, recipient, channel);
        } catch (error) {
          logger.error('催办发送失败', { reminderId: reminder.id, error: error.message });
        }
      })();
    }
  }

  logger.info('创建催办记录', { 
    alertId, 
    recipientCount: recipientIds.length, 
    channelCount: channels.length,
    reminderCount: reminders.length
  });

  return {
    success: true,
    total: reminders.length,
    reminders
  };
}

async function createReminder(data, alert = null) {
  const now = new Date();
  const { alertId, recipientId } = data;

  let receiptStatusBefore = 'pending';
  let receiptTimeBefore = null;
  let receiptTypeBefore = null;

  if (alert) {
    const { Receipt } = require('../models');
    const existingReceiptsResult = await Receipt.findAll({
      where: { alertId, recipientId },
      order: [['receiptTime', 'DESC']],
      limit: 1
    });
    if (existingReceiptsResult.rows && existingReceiptsResult.rows.length > 0) {
      const last = existingReceiptsResult.rows[0];
      receiptStatusBefore = last.receiptType;
      receiptTimeBefore = last.receiptTime;
      receiptTypeBefore = last.receiptType;
    }
  }

  return await Reminder.create({
    ...data,
    id: uuidv4(),
    status: 'pending',
    statusName: REMINDER_STATUS_NAMES.pending,
    receiptStatusBefore,
    receiptTimeBefore,
    receiptTypeBefore,
    receiptAfterReminder: receiptStatusBefore !== 'pending',
    receiptTimeAfterReminder: receiptTimeBefore,
    responseMinutesAfterReminder: null,
    createdAt: now,
    updatedAt: now
  });
}

async function sendReminder(reminderId, alert, recipient, channel) {
  const content = generateReminderContent(alert, recipient, channel);

  let sendResult;
  try {
    switch (channel) {
      case 'sms':
        sendResult = await sendSms(recipient.phone, content, reminderId);
        break;
      case 'voice':
        sendResult = await sendVoiceCall(recipient.phone, content, reminderId);
        break;
      default:
        throw new Error(`不支持的催办通道: ${channel}`);
    }
  } catch (error) {
    logger.error('催办发送异常', { reminderId, channel, error: error.message });
    sendResult = { success: false, error: error.message };
  }

  let finalStatus;
  let failReason = null;

  if (sendResult.status === 'not_sent') {
    finalStatus = 'not_sent';
    failReason = sendResult.failReason || sendResult.error;
  } else if (sendResult.success) {
    finalStatus = channel === 'sms' ? 'delivered' : 'sent';
  } else {
    finalStatus = 'failed';
    failReason = sendResult.error || '发送失败';
  }

  await Reminder.update(reminderId, {
    status: finalStatus,
    statusName: REMINDER_STATUS_NAMES[finalStatus],
    sendTime: new Date(),
    externalId: sendResult.externalId || null,
    failReason,
    isSimulated: sendResult.simulated || false
  });

  return { success: sendResult.success, status: finalStatus };
}

function generateReminderContent(alert, recipient, channel) {
  const projectName = alert.project ? alert.project.projectName : '项目';
  const areaName = alert.area ? alert.area.areaName : '';
  const location = areaName ? `${projectName}-${areaName}` : projectName;

  const baseContent = `【催办通知】${alert.alertLevelName}: ${alert.eventTypeName}，地点: ${location}，告警编号: ${alert.alertCode}。请您尽快回执确认处理进展。`;

  if (channel === 'sms') {
    return `【高支模预警】${baseContent}`;
  } else if (channel === 'voice') {
    return `您好，这里是高支模预警系统催办通知。${alert.alertLevelName}，${alert.eventTypeName}，地点${location}。请您尽快回执确认处理进展。告警编号${alert.alertCode}。重复一遍，请尽快回执确认。`;
  }
  return baseContent;
}

async function getReminderList(params = {}) {
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
  if (startTime) where.createdAt = { ...where.createdAt, $gte: new Date(startTime) };
  if (endTime) where.createdAt = { ...where.createdAt, $lte: new Date(endTime) };

  const { count, rows } = await Reminder.findAll({
    where,
    order: [['createdAt', 'DESC']],
    limit: pageSize,
    offset: (page - 1) * pageSize
  });

  const listWithAssociations = await Promise.all(rows.map(async reminder => {
    return await loadAssociations(reminder, [
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

async function syncReminderEffect(reminder) {
  const { Receipt } = require('../models');
  const { alertId, recipientId, createdAt, receiptStatusBefore } = reminder;

  if (reminder.receiptAfterReminder && receiptStatusBefore !== 'pending') {
    return reminder;
  }

  const allReceiptsResult = await Receipt.findAll({
    where: { alertId, recipientId },
    order: [['receiptTime', 'ASC']]
  });
  const allReceipts = allReceiptsResult.rows || [];

  const reminderTime = new Date(createdAt).getTime();
  const receiptsAfter = allReceipts.filter(r => new Date(r.receiptTime).getTime() > reminderTime);

  if (receiptsAfter.length > 0) {
    const firstAfter = receiptsAfter[0];
    const receiptTime = new Date(firstAfter.receiptTime).getTime();
    const responseMinutes = (receiptTime - reminderTime) / (1000 * 60);

    await Reminder.update(reminder.id, {
      receiptAfterReminder: true,
      receiptTimeAfterReminder: firstAfter.receiptTime,
      receiptTypeAfterReminder: firstAfter.receiptType,
      responseMinutesAfterReminder: Number(responseMinutes.toFixed(2)),
      updatedAt: new Date()
    });

    return await Reminder.findByPk(reminder.id);
  }

  return reminder;
}

async function getAlertReminderSummary(alertId) {
  const result = await Reminder.findAll({ where: { alertId } });
  let reminders = result.rows;

  const syncedReminders = await Promise.all(reminders.map(r => syncReminderEffect(r)));
  reminders = syncedReminders;

  const byRecipient = {};
  reminders.forEach(r => {
    const rid = r.recipientId;
    if (!byRecipient[rid]) {
      byRecipient[rid] = {
        recipientId: rid,
        recipientName: r.recipientName,
        recipientRole: r.recipientRole,
        recipientPhone: r.recipientPhone,
        totalCount: 0,
        successCount: 0,
        lastReminderTime: null,
        lastReminderChannel: null,
        channels: {},
        receiptStatusBefore: null,
        receiptAfterReminder: false,
        receiptTimeAfterReminder: null,
        responseMinutesAfterReminder: null
      };
    }
    byRecipient[rid].totalCount++;
    if (r.status === 'sent' || r.status === 'delivered') {
      byRecipient[rid].successCount++;
    }
    const rTime = new Date(r.createdAt);
    if (!byRecipient[rid].lastReminderTime || rTime > new Date(byRecipient[rid].lastReminderTime)) {
      byRecipient[rid].lastReminderTime = r.createdAt;
      byRecipient[rid].lastReminderChannel = r.channel;
      byRecipient[rid].receiptStatusBefore = r.receiptStatusBefore;
      byRecipient[rid].receiptAfterReminder = r.receiptAfterReminder;
      byRecipient[rid].receiptTimeAfterReminder = r.receiptTimeAfterReminder;
      byRecipient[rid].responseMinutesAfterReminder = r.responseMinutesAfterReminder;
    }
    byRecipient[rid].channels[r.channel] = (byRecipient[rid].channels[r.channel] || 0) + 1;
  });

  const byChannel = {};
  reminders.forEach(r => {
    if (!byChannel[r.channel]) {
      byChannel[r.channel] = { total: 0, success: 0, failed: 0, not_sent: 0, responded: 0, avgResponseMinutes: null };
    }
    byChannel[r.channel].total++;
    if (r.status === 'sent' || r.status === 'delivered') byChannel[r.channel].success++;
    else if (r.status === 'failed') byChannel[r.channel].failed++;
    else if (r.status === 'not_sent') byChannel[r.channel].not_sent++;
    if (r.receiptAfterReminder && r.receiptStatusBefore === 'pending') byChannel[r.channel].responded++;
  });

  Object.keys(byChannel).forEach(ch => {
    const channelReminders = reminders.filter(r => r.channel === ch && r.receiptAfterReminder && r.receiptStatusBefore === 'pending' && r.responseMinutesAfterReminder !== null);
    if (channelReminders.length > 0) {
      const avg = channelReminders.reduce((sum, r) => sum + r.responseMinutesAfterReminder, 0) / channelReminders.length;
      byChannel[ch].avgResponseMinutes = Number(avg.toFixed(2));
    }
  });

  const pendingBefore = reminders.filter(r => r.receiptStatusBefore === 'pending');
  const respondedAfter = pendingBefore.filter(r => r.receiptAfterReminder);
  const responseTimes = respondedAfter.filter(r => r.responseMinutesAfterReminder !== null).map(r => r.responseMinutesAfterReminder);
  const avgResponse = responseTimes.length > 0 
    ? Number((responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length).toFixed(2))
    : null;

  const effectSummary = {
    totalReminded: pendingBefore.length,
    respondedAfterReminder: respondedAfter.length,
    responseRate: pendingBefore.length > 0 ? Math.round((respondedAfter.length / pendingBefore.length) * 100) : 0,
    avgResponseMinutes: avgResponse,
    medianResponseMinutes: responseTimes.length > 0 ? Number([...responseTimes].sort((a, b) => a - b)[Math.floor(responseTimes.length / 2)].toFixed(2)) : null
  };

  return {
    totalCount: reminders.length,
    successCount: reminders.filter(r => r.status === 'sent' || r.status === 'delivered').length,
    failedCount: reminders.filter(r => r.status === 'failed').length,
    notSentCount: reminders.filter(r => r.status === 'not_sent').length,
    recipientCount: Object.keys(byRecipient).length,
    byRecipient: Object.values(byRecipient),
    byChannel,
    effect: effectSummary
  };
}

async function getReminderStatistics(params = {}) {
  const { projectId, startTime, endTime, groupBy } = params;

  const reminderWhere = {};
  if (startTime) reminderWhere.createdAt = { ...reminderWhere.createdAt, $gte: new Date(startTime) };
  if (endTime) reminderWhere.createdAt = { ...reminderWhere.createdAt, $lte: new Date(endTime) };

  const remindersResult = await Reminder.findAll({ where: reminderWhere });
  let allReminders = remindersResult.rows;

  const syncedReminders = await Promise.all(allReminders.map(r => syncReminderEffect(r)));
  allReminders = syncedReminders;

  let alertsFilter = {};
  if (projectId) alertsFilter.projectId = projectId;

  const alertsResult = await Alert.findAll({ where: alertsFilter });
  const alertMap = {};
  alertsResult.rows.forEach(a => {
    alertMap[a.id] = a;
  });

  allReminders = allReminders.filter(r => alertMap[r.alertId]);

  const calculateStats = (reminders) => {
    const uniqueRecipients = new Set();
    const uniqueAlerts = new Set();
    const byChannel = { 
      sms: { total: 0, success: 0, failed: 0, not_sent: 0, responded: 0, avgResponseMinutes: null, medianResponseMinutes: null, responseRate: 0 }, 
      voice: { total: 0, success: 0, failed: 0, not_sent: 0, responded: 0, avgResponseMinutes: null, medianResponseMinutes: null, responseRate: 0 } 
    };
    const byStatus = { pending: 0, sent: 0, delivered: 0, failed: 0, not_sent: 0 };

    reminders.forEach(r => {
      uniqueRecipients.add(r.recipientId);
      uniqueAlerts.add(r.alertId);
      if (byChannel[r.channel]) {
        byChannel[r.channel].total++;
        if (r.status === 'sent' || r.status === 'delivered') byChannel[r.channel].success++;
        else if (r.status === 'failed') byChannel[r.channel].failed++;
        else if (r.status === 'not_sent') byChannel[r.channel].not_sent++;
        if (r.receiptAfterReminder && r.receiptStatusBefore === 'pending') byChannel[r.channel].responded++;
      }
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    });

    Object.keys(byChannel).forEach(ch => {
      const channelPendingBefore = reminders.filter(r => r.channel === ch && r.receiptStatusBefore === 'pending');
      const channelResponded = channelPendingBefore.filter(r => r.receiptAfterReminder);
      const responseTimes = channelResponded
        .filter(r => r.responseMinutesAfterReminder !== null)
        .map(r => r.responseMinutesAfterReminder);
      
      byChannel[ch].responseRate = channelPendingBefore.length > 0 
        ? Math.round((channelResponded.length / channelPendingBefore.length) * 100) 
        : 0;
      
      if (responseTimes.length > 0) {
        byChannel[ch].avgResponseMinutes = Number((responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length).toFixed(2));
        byChannel[ch].medianResponseMinutes = Number([...responseTimes].sort((a, b) => a - b)[Math.floor(responseTimes.length / 2)].toFixed(2));
      }
    });

    const pendingBeforeAll = reminders.filter(r => r.receiptStatusBefore === 'pending');
    const respondedAll = pendingBeforeAll.filter(r => r.receiptAfterReminder);
    const allResponseTimes = respondedAll.filter(r => r.responseMinutesAfterReminder !== null).map(r => r.responseMinutesAfterReminder);

    return {
      totalReminders: reminders.length,
      uniqueAlerts: uniqueAlerts.size,
      uniqueRecipients: uniqueRecipients.size,
      successCount: reminders.filter(r => r.status === 'sent' || r.status === 'delivered').length,
      failedCount: reminders.filter(r => r.status === 'failed').length,
      notSentCount: reminders.filter(r => r.status === 'not_sent').length,
      byChannel,
      byStatus,
      effect: {
        totalReminded: pendingBeforeAll.length,
        respondedAfterReminder: respondedAll.length,
        responseRate: pendingBeforeAll.length > 0 ? Math.round((respondedAll.length / pendingBeforeAll.length) * 100) : 0,
        avgResponseMinutes: allResponseTimes.length > 0 
          ? Number((allResponseTimes.reduce((a, b) => a + b, 0) / allResponseTimes.length).toFixed(2))
          : null,
        medianResponseMinutes: allResponseTimes.length > 0 
          ? Number([...allResponseTimes].sort((a, b) => a - b)[Math.floor(allResponseTimes.length / 2)].toFixed(2))
          : null,
        channelComparison: {
          smsResponseRate: byChannel.sms.responseRate,
          voiceResponseRate: byChannel.voice.responseRate,
          smsAvgResponseMinutes: byChannel.sms.avgResponseMinutes,
          voiceAvgResponseMinutes: byChannel.voice.avgResponseMinutes,
          moreEffectiveChannel: byChannel.sms.responseRate >= byChannel.voice.responseRate ? 'sms' : 'voice'
        }
      }
    };
  };

  const overallStats = calculateStats(allReminders);

  if (groupBy === 'project') {
    const byProject = {};
    allReminders.forEach(r => {
      const pid = alertMap[r.alertId]?.projectId;
      if (!byProject[pid]) byProject[pid] = [];
      byProject[pid].push(r);
    });

    const projectStats = [];
    for (const [pid, reminders] of Object.entries(byProject)) {
      projectStats.push({
        projectId: pid,
        projectName: alertMap[reminders[0].alertId]?.projectName || '未知项目',
        ...calculateStats(reminders)
      });
    }

    return { overall: overallStats, byProject: projectStats };
  }

  return { overall: overallStats };
}

module.exports = {
  REMINDER_CHANNEL_NAMES,
  REMINDER_STATUS_NAMES,
  submitReminder,
  syncReminderEffect,
  getReminderList,
  getAlertReminderSummary,
  getReminderStatistics
};
