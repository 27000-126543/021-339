const { Op } = require('../config/database');
const { Project, Area, Sensor } = require('../models');
const logger = require('../config/logger');

const ALERT_LEVELS = {
  LEVEL1: 'level1',
  LEVEL2: 'level2',
  NOTICE: 'notice'
};

const ALERT_LEVEL_NAMES = {
  'level1': '一级告警',
  'level2': '二级告警',
  'notice': '提示类告警'
};

const EVENT_TYPE_NAMES = {
  'settlement_exceed': '沉降超限',
  'displacement_sudden': '位移突变',
  'sensor_offline': '传感器离线',
  'sensor_fault': '传感器故障',
  'threshold_exceed': '阈值超限',
  'other': '其他事件'
};

function getEventTypeName(eventType) {
  return EVENT_TYPE_NAMES[eventType] || '未知事件';
}

function getAlertLevelName(alertLevel) {
  return ALERT_LEVEL_NAMES[alertLevel] || '未知级别';
}

function isNightTime(date = new Date()) {
  const hour = date.getHours();
  return hour >= 22 || hour < 6;
}

function isPouringActive(project, area) {
  if (area && area.pouringStatus === 'pouring') {
    return true;
  }
  if (project && project.pouringStatus === 'pouring') {
    return true;
  }
  return false;
}

function isNightPouring(project, area, date = new Date()) {
  return isPouringActive(project, area) && isNightTime(date);
}

function getExceedRatio(currentValue, thresholdValue) {
  if (!thresholdValue || thresholdValue === 0) return Infinity;
  return Math.abs(currentValue) / Math.abs(thresholdValue);
}

async function determineAlertLevel(eventData) {
  const {
    eventType,
    projectId,
    areaId,
    sensorId,
    currentValue,
    thresholdValue,
    occurTime
  } = eventData;

  const occurDate = occurTime ? new Date(occurTime) : new Date();

  let project = null;
  let area = null;
  let sensor = null;

  try {
    if (projectId) {
      project = await Project.findByPk(projectId);
    }
    if (areaId) {
      area = await Area.findByPk(areaId);
      if (!project && area) {
        project = await Project.findByPk(area.projectId);
      }
    }
    if (sensorId) {
      sensor = await Sensor.findByPk(sensorId);
      if (!area && sensor) {
        area = await Area.findByPk(sensor.areaId);
      }
      if (!project && sensor) {
        project = await Project.findByPk(sensor.projectId);
      }
    }
  } catch (error) {
    logger.error('查询关联数据失败', { error: error.message, eventData });
  }

  const isNight = isNightTime(occurDate);
  const isPouring = isPouringActive(project, area);
  const isNightPouringFlag = isNightPouring(project, area, occurDate);
  const areaRiskLevel = area ? area.riskLevel : 'medium';

  let alertLevel = ALERT_LEVELS.NOTICE;
  let reasons = [];

  switch (eventType) {
    case 'sensor_offline':
      if (isNightPouringFlag) {
        alertLevel = ALERT_LEVELS.LEVEL1;
        reasons.push('夜间浇筑期间传感器离线');
      } else if (isPouring) {
        alertLevel = ALERT_LEVELS.LEVEL2;
        reasons.push('浇筑期间传感器离线');
      } else if (areaRiskLevel === 'critical' || areaRiskLevel === 'high') {
        alertLevel = ALERT_LEVELS.LEVEL2;
        reasons.push('高风险区域传感器离线');
      } else {
        reasons.push('传感器离线');
      }
      break;

    case 'settlement_exceed':
    case 'displacement_sudden':
      const exceedRatio = getExceedRatio(currentValue, thresholdValue);
      
      if (exceedRatio >= 2.0 || (isNightPouringFlag && exceedRatio >= 1.2)) {
        alertLevel = ALERT_LEVELS.LEVEL1;
        reasons.push(`${isNightPouringFlag ? '夜间浇筑期间' : ''}${eventType === 'settlement_exceed' ? '沉降' : '位移'}严重超限，超限比例${(exceedRatio * 100).toFixed(0)}%`);
      } else if (exceedRatio >= 1.5 || isNightPouringFlag || areaRiskLevel === 'critical') {
        alertLevel = ALERT_LEVELS.LEVEL2;
        reasons.push(`${isNightPouringFlag ? '夜间浇筑期间' : ''}${eventType === 'settlement_exceed' ? '沉降' : '位移'}超限，超限比例${(exceedRatio * 100).toFixed(0)}%`);
      } else if (exceedRatio >= 1.2 || isPouring) {
        alertLevel = ALERT_LEVELS.LEVEL2;
        reasons.push(`${isPouring ? '浇筑期间' : ''}${eventType === 'settlement_exceed' ? '沉降' : '位移'}轻微超限，超限比例${(exceedRatio * 100).toFixed(0)}%`);
      } else {
        reasons.push(`${eventType === 'settlement_exceed' ? '沉降' : '位移'}数据异常`);
      }
      break;

    case 'threshold_exceed':
      const ratio = getExceedRatio(currentValue, thresholdValue);
      if (ratio >= 2.0 || (isNightPouringFlag && ratio >= 1.3)) {
        alertLevel = ALERT_LEVELS.LEVEL1;
        reasons.push('严重超限');
      } else if (ratio >= 1.5 || isNightPouringFlag) {
        alertLevel = ALERT_LEVELS.LEVEL2;
        reasons.push('超限');
      } else {
        reasons.push('数据接近阈值');
      }
      break;

    case 'sensor_fault':
      if (isNightPouringFlag || areaRiskLevel === 'critical') {
        alertLevel = ALERT_LEVELS.LEVEL2;
        reasons.push('高风险场景传感器故障');
      } else {
        reasons.push('传感器故障');
      }
      break;

    default:
      if (isNightPouringFlag) {
        alertLevel = ALERT_LEVELS.LEVEL2;
      }
      reasons.push('未知事件');
  }

  if (areaRiskLevel === 'critical' && alertLevel === ALERT_LEVELS.NOTICE) {
    alertLevel = ALERT_LEVELS.LEVEL2;
    reasons.push('关键区域事件升级');
  }

  if (isNight && isPouring && alertLevel === ALERT_LEVELS.LEVEL2) {
    alertLevel = ALERT_LEVELS.LEVEL1;
    reasons.push('夜间浇筑事件升级为一级');
  }

  logger.info('告警分级完成', {
    eventType,
    alertLevel,
    reasons,
    isNight,
    isPouring,
    isNightPouring: isNightPouringFlag,
    areaRiskLevel
  });

  return {
    alertLevel,
    alertLevelName: getAlertLevelName(alertLevel),
    eventTypeName: getEventTypeName(eventType),
    reasons,
    context: {
      isNight,
      isPouring,
      isNightPouring: isNightPouringFlag,
      areaRiskLevel,
      project: project ? { id: project.id, name: project.projectName, code: project.projectCode } : null,
      area: area ? { id: area.id, name: area.areaName, riskLevel: area.riskLevel } : null
    }
  };
}

module.exports = {
  ALERT_LEVELS,
  ALERT_LEVEL_NAMES,
  EVENT_TYPE_NAMES,
  getEventTypeName,
  getAlertLevelName,
  isNightTime,
  isPouringActive,
  isNightPouring,
  determineAlertLevel
};
