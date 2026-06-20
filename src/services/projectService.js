const { Op } = require('../config/database');
const { Project, Area, Sensor, loadAssociations } = require('../models');
const { createDefaultRules } = require('./notificationRuleService');
const { batchCreateRecipients } = require('./recipientService');
const logger = require('../config/logger');

async function createProject(projectData) {
  logger.info('创建项目', { projectCode: projectData.projectCode, projectName: projectData.projectName });

  if (!projectData.projectCode) {
    throw new Error('项目编号不能为空');
  }
  if (!projectData.projectName) {
    throw new Error('项目名称不能为空');
  }

  const existing = await Project.findOne({ where: { projectCode: projectData.projectCode } });
  if (existing) {
    throw new Error('项目编号已存在');
  }

  const project = await Project.create({
    projectCode: projectData.projectCode,
    projectName: projectData.projectName,
    address: projectData.address,
    generalContractor: projectData.generalContractor,
    supervisor: projectData.supervisor,
    status: projectData.status || 'active',
    pouringStatus: projectData.pouringStatus || 'not_started',
    pouringStartTime: projectData.pouringStartTime,
    pouringEndTime: projectData.pouringEndTime,
    isNightPouring: projectData.isNightPouring || false,
    remarks: projectData.remarks,
    createdBy: projectData.createdBy
  });

  try {
    await createDefaultRules(project.id, projectData.createdBy || 'system');
    logger.info('已为项目创建默认通知规则', { projectId: project.id });
  } catch (error) {
    logger.error('创建默认规则失败', { projectId: project.id, error: error.message });
  }

  if (projectData.recipients && projectData.recipients.length > 0) {
    try {
      await batchCreateRecipients(project.id, projectData.recipients);
      logger.info('已为项目创建默认接收人', { projectId: project.id, count: projectData.recipients.length });
    } catch (error) {
      logger.error('创建默认接收人失败', { projectId: project.id, error: error.message });
    }
  }

  return project;
}

async function getProjectList(params = {}) {
  const {
    page = 1,
    pageSize = 20,
    status,
    keyword
  } = params;

  const where = {};
  if (status) where.status = status;

  const { count, rows } = await Project.findAll({
    where,
    order: [['createdAt', 'DESC']],
    limit: pageSize,
    offset: (page - 1) * pageSize
  });

  let filteredRows = rows;
  if (keyword) {
    const lowerKeyword = keyword.toLowerCase();
    filteredRows = rows.filter(p => 
      (p.projectCode && p.projectCode.toLowerCase().includes(lowerKeyword)) ||
      (p.projectName && p.projectName.toLowerCase().includes(lowerKeyword))
    );
  }

  const listWithAssociations = await Promise.all(filteredRows.map(async project => {
    return await loadAssociations(project, [
      { model: 'Area', as: 'areas', foreignKey: 'projectId' },
      { model: 'Sensor', as: 'sensors', foreignKey: 'projectId' }
    ]);
  }));

  return {
    total: keyword ? filteredRows.length : count,
    page,
    pageSize,
    list: listWithAssociations
  };
}

async function getProjectDetail(projectId) {
  const project = await Project.findByPk(projectId);

  if (!project) {
    throw new Error(`项目不存在: ${projectId}`);
  }

  return await loadAssociations(project, [
    { model: 'Area', as: 'areas', foreignKey: 'projectId' },
    { model: 'Sensor', as: 'sensors', foreignKey: 'projectId' },
    { model: 'Recipient', as: 'recipients', foreignKey: 'projectId' },
    { model: 'NotificationRule', as: 'notificationRules', foreignKey: 'projectId' }
  ]);
}

async function updateProject(projectId, updateData) {
  const project = await Project.findByPk(projectId);
  if (!project) {
    throw new Error(`项目不存在: ${projectId}`);
  }

  if (updateData.projectCode && updateData.projectCode !== project.projectCode) {
    const existingResult = await Project.findAll({
      where: { projectCode: updateData.projectCode }
    });
    const existing = existingResult.rows.find(p => p.id !== projectId);
    if (existing) {
      throw new Error('项目编号已存在');
    }
  }

  return await Project.update(projectId, updateData);
}

async function updatePouringStatus(projectId, pouringStatus, isNightPouring) {
  const project = await Project.findByPk(projectId);
  if (!project) {
    throw new Error(`项目不存在: ${projectId}`);
  }

  const updateData = { pouringStatus };
  if (pouringStatus === 'pouring') {
    updateData.pouringStartTime = new Date();
    if (isNightPouring !== undefined) {
      updateData.isNightPouring = isNightPouring;
    }
  } else if (pouringStatus === 'completed' || pouringStatus === 'curing') {
    updateData.pouringEndTime = new Date();
    updateData.isNightPouring = false;
  }

  const updated = await Project.update(projectId, updateData);

  logger.info('更新项目浇筑状态', {
    projectId,
    projectCode: project.projectCode,
    pouringStatus,
    isNightPouring: updateData.isNightPouring
  });

  return updated;
}

async function createArea(areaData) {
  logger.info('创建区域', { areaCode: areaData.areaCode, areaName: areaData.areaName });

  if (!areaData.areaCode) {
    throw new Error('区域编号不能为空');
  }
  if (!areaData.areaName) {
    throw new Error('区域名称不能为空');
  }
  if (!areaData.projectId) {
    throw new Error('项目ID不能为空');
  }

  const project = await Project.findByPk(areaData.projectId);
  if (!project) {
    throw new Error('项目不存在');
  }

  const existing = await Area.findOne({
    where: {
      projectId: areaData.projectId,
      areaCode: areaData.areaCode
    }
  });
  if (existing) {
    throw new Error('区域编号在该项目中已存在');
  }

  const area = await Area.create({
    areaCode: areaData.areaCode,
    areaName: areaData.areaName,
    projectId: areaData.projectId,
    floor: areaData.floor,
    riskLevel: areaData.riskLevel || 'medium',
    pouringStatus: areaData.pouringStatus || 'not_started',
    pouringStartTime: areaData.pouringStartTime,
    isNightPouring: areaData.isNightPouring || false,
    description: areaData.description
  });

  return area;
}

async function createSensor(sensorData) {
  logger.info('创建传感器', { sensorCode: sensorData.sensorCode, sensorType: sensorData.sensorType });

  if (!sensorData.sensorCode) {
    throw new Error('传感器编号不能为空');
  }
  if (!sensorData.sensorType) {
    throw new Error('传感器类型不能为空');
  }
  if (!sensorData.areaId) {
    throw new Error('区域ID不能为空');
  }
  if (!sensorData.projectId) {
    throw new Error('项目ID不能为空');
  }

  const existing = await Sensor.findOne({ where: { sensorCode: sensorData.sensorCode } });
  if (existing) {
    throw new Error('传感器编号已存在');
  }

  const sensor = await Sensor.create({
    sensorCode: sensorData.sensorCode,
    sensorName: sensorData.sensorName,
    sensorType: sensorData.sensorType,
    areaId: sensorData.areaId,
    projectId: sensorData.projectId,
    installLocation: sensorData.installLocation,
    status: sensorData.status || 'online',
    lastOnlineTime: new Date(),
    warningThreshold: sensorData.warningThreshold,
    alarmThreshold: sensorData.alarmThreshold,
    unit: sensorData.unit,
    manufacturer: sensorData.manufacturer,
    installDate: sensorData.installDate
  });

  return sensor;
}

async function updateSensorStatus(sensorId, status) {
  const sensor = await Sensor.findByPk(sensorId);
  if (!sensor) {
    throw new Error(`传感器不存在: ${sensorId}`);
  }

  const updateData = { status };
  if (status === 'online') {
    updateData.lastOnlineTime = new Date();
  }

  const updated = await Sensor.update(sensorId, updateData);

  logger.info('更新传感器状态', { sensorId, sensorCode: sensor.sensorCode, status });

  return updated;
}

module.exports = {
  createProject,
  getProjectList,
  getProjectDetail,
  updateProject,
  updatePouringStatus,
  createArea,
  createSensor,
  updateSensorStatus
};
