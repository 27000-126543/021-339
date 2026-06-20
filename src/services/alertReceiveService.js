const { Alert, Project, Area, Sensor, Notification, loadAssociations } = require('../models');
const { generateAlertCode } = require('../utils/alertCodeGenerator');
const { determineAlertLevel, isNightPouring, isPouringActive } = require('./alertLevelService');
const { triggerNotifications, getNotificationBatchOverview } = require('./notificationService');
const logger = require('../config/logger');

async function receiveAlert(eventData) {
  logger.info('接收到告警事件', { eventType: eventData.eventType, source: eventData.sourceSystem });

  const validationResult = validateEventData(eventData);
  if (!validationResult.valid) {
    throw new Error(`事件数据验证失败: ${validationResult.message}`);
  }

  let project = null;
  let area = null;
  let sensor = null;

  if (eventData.projectId) {
    project = await Project.findByPk(eventData.projectId);
  }
  if (eventData.areaId) {
    area = await Area.findByPk(eventData.areaId);
    if (!project && area) {
      project = await Project.findByPk(area.projectId);
    }
  }
  if (eventData.sensorId) {
    sensor = await Sensor.findByPk(eventData.sensorId);
    if (!area && sensor) {
      area = await Area.findByPk(sensor.areaId);
    }
    if (!project && sensor) {
      project = await Project.findByPk(sensor.projectId);
    }
  }

  if (!project) {
    throw new Error('无法确定关联项目，请检查projectId、areaId或sensorId');
  }

  const levelResult = await determineAlertLevel(eventData);

  const projectCode = project ? project.projectCode : 'UNKNOWN';
  const alertCode = generateAlertCode(eventData.eventType, projectCode);

  const pouringStatus = area && area.pouringStatus ? area.pouringStatus : 
                       (project && project.pouringStatus ? project.pouringStatus : 'not_started');

  const isNightPouringFlag = isNightPouring(project, area, eventData.occurTime ? new Date(eventData.occurTime) : new Date());

  const alert = await Alert.create({
    alertCode,
    eventType: eventData.eventType,
    eventTypeName: levelResult.eventTypeName,
    alertLevel: levelResult.alertLevel,
    alertLevelName: levelResult.alertLevelName,
    projectId: project.id,
    areaId: area ? area.id : null,
    sensorId: sensor ? sensor.id : null,
    sensorCode: sensor ? sensor.sensorCode : eventData.sensorCode,
    sensorType: sensor ? sensor.sensorType : eventData.sensorType,
    currentValue: eventData.currentValue,
    thresholdValue: eventData.thresholdValue,
    unit: eventData.unit || (sensor ? sensor.unit : null),
    location: eventData.location || 
              (sensor ? sensor.installLocation : 
               (area ? `${project.projectName}-${area.areaName}` : project.projectName)),
    description: eventData.description || levelResult.reasons.join('; '),
    sourceSystem: eventData.sourceSystem || 'unknown',
    sourceEventId: eventData.sourceEventId,
    occurTime: eventData.occurTime ? new Date(eventData.occurTime) : new Date(),
    receiveTime: new Date(),
    isNightPouring: isNightPouringFlag,
    pouringStatus,
    status: 'pending',
    receiptStatus: 'none'
  });

  logger.info('告警已保存', { 
    alertId: alert.id, 
    alertCode: alert.alertCode,
    alertLevel: alert.alertLevel 
  });

  const asyncNotify = eventData.asyncNotify === true;
  let notificationResult = null;
  
  if (asyncNotify) {
    (async () => {
      try {
        const notifyResult = await triggerNotifications(alert.id);
        logger.info('告警通知触发完成', { alertId: alert.id, ...notifyResult });
      } catch (error) {
        logger.error('触发通知失败', { alertId: alert.id, error: error.message });
      }
    })();
  } else {
    try {
      notificationResult = await triggerNotifications(alert.id);
      logger.info('告警通知同步发送完成', { 
        alertId: alert.id, 
        notificationCount: notificationResult.notificationCount,
        recipientCount: notificationResult.recipientCount 
      });
    } catch (error) {
      logger.error('同步发送通知失败', { alertId: alert.id, error: error.message });
    }
  }

  const result = {
    success: true,
    alertId: alert.id,
    alertCode: alert.alertCode,
    alertLevel: alert.alertLevel,
    alertLevelName: alert.alertLevelName,
    reasons: levelResult.reasons,
    context: levelResult.context
  };

  if (notificationResult) {
    result.notifications = {
      expectedRecipientCount: notificationResult.batchOverview?.expectedRecipientCount || notificationResult.recipientCount,
      actualRecipientCount: notificationResult.batchOverview?.actualRecipientCount,
      totalNotifications: notificationResult.batchOverview?.totalNotifications || notificationResult.notificationCount,
      successCount: notificationResult.batchOverview?.successCount || 0,
      notSentCount: notificationResult.batchOverview?.notSentCount || 0,
      failedCount: notificationResult.batchOverview?.failedCount || 0,
      notificationCount: notificationResult.notificationCount,
      byChannel: notificationResult.batchOverview?.byChannel,
      byRecipientList: notificationResult.batchOverview?.byRecipientList,
      missingRecipients: notificationResult.batchOverview?.missingRecipients || []
    };
    result.notificationBatch = notificationResult.batchOverview;
  }

  return result;
}

function validateEventData(eventData) {
  if (!eventData.eventType) {
    return { valid: false, message: '缺少eventType字段' };
  }

  const validEventTypes = [
    'settlement_exceed', 'displacement_sudden', 
    'sensor_offline', 'sensor_fault', 
    'threshold_exceed', 'other'
  ];

  if (!validEventTypes.includes(eventData.eventType)) {
    return { valid: false, message: `无效的eventType: ${eventData.eventType}` };
  }

  if (!eventData.projectId && !eventData.areaId && !eventData.sensorId) {
    return { valid: false, message: '必须提供projectId、areaId或sensorId之一' };
  }

  if (['settlement_exceed', 'displacement_sudden', 'threshold_exceed'].includes(eventData.eventType)) {
    if (eventData.currentValue === undefined || eventData.currentValue === null) {
      return { valid: false, message: '超限类事件必须提供currentValue' };
    }
    if (eventData.thresholdValue === undefined || eventData.thresholdValue === null) {
      return { valid: false, message: '超限类事件必须提供thresholdValue' };
    }
  }

  if (!eventData.occurTime) {
    eventData.occurTime = new Date().toISOString();
  }

  return { valid: true };
}

async function batchReceiveAlerts(events) {
  const results = [];
  
  for (const event of events) {
    try {
      const result = await receiveAlert(event);
      results.push({ ...result, eventData: event });
    } catch (error) {
      results.push({
        success: false,
        error: error.message,
        eventData: event
      });
    }
  }

  return {
    total: events.length,
    successCount: results.filter(r => r.success).length,
    failCount: results.filter(r => !r.success).length,
    results
  };
}

async function getAlertList(params = {}) {
  const { 
    page = 1, 
    pageSize = 20, 
    projectId, 
    alertLevel, 
    status, 
    startTime, 
    endTime,
    eventType
  } = params;

  const where = {};

  if (projectId) where.projectId = projectId;
  if (alertLevel) where.alertLevel = alertLevel;
  if (status) where.status = status;
  if (eventType) where.eventType = eventType;
  if (startTime) where.occurTime = { ...where.occurTime, $gte: new Date(startTime) };
  if (endTime) where.occurTime = { ...where.occurTime, $lte: new Date(endTime) };

  const { count, rows } = await Alert.findAll({
    where,
    order: [['occurTime', 'DESC']],
    limit: pageSize,
    offset: (page - 1) * pageSize
  });

  const listWithAssociations = await Promise.all(rows.map(async alert => {
    return await loadAssociations(alert, [
      { model: 'Project', as: 'project' },
      { model: 'Area', as: 'area' },
      { model: 'Sensor', as: 'sensor' }
    ]);
  }));

  return {
    total: count,
    page,
    pageSize,
    list: listWithAssociations
  };
}

async function getAlertDetail(alertId) {
  const alert = await Alert.findByPk(alertId);

  if (!alert) {
    throw new Error(`告警不存在: ${alertId}`);
  }

  const alertWithAssociations = await loadAssociations(alert, [
    { model: 'Project', as: 'project' },
    { model: 'Area', as: 'area' },
    { model: 'Sensor', as: 'sensor' },
    { model: 'Notification', as: 'notifications', foreignKey: 'alertId', include: [{ model: 'Recipient', as: 'recipient' }] },
    { model: 'Receipt', as: 'receipts', foreignKey: 'alertId', include: [{ model: 'Recipient', as: 'recipient' }] }
  ]);

  const notificationBatch = await getNotificationBatchOverview(alertId);
  alertWithAssociations.notificationBatch = notificationBatch;

  return alertWithAssociations;
}

module.exports = {
  receiveAlert,
  batchReceiveAlerts,
  getAlertList,
  getAlertDetail,
  validateEventData
};
