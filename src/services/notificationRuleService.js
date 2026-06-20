const { Op } = require('../config/database');
const { NotificationRule, Project, Area, loadAssociations } = require('../models');
const logger = require('../config/logger');

const ROLE_NAMES = {
  'general_contractor': '总包',
  'supervisor': '监理',
  'labor_team': '劳务班组',
  'device_admin': '设备管理员',
  'project_manager': '项目经理',
  'safety_officer': '安全员',
  'duty_officer': '值班员'
};

const ALERT_LEVEL_NAMES = {
  'level1': '一级告警',
  'level2': '二级告警',
  'notice': '提示类告警'
};

async function createNotificationRule(ruleData) {
  logger.info('创建通知规则', { ruleName: ruleData.ruleName, alertLevel: ruleData.alertLevel });

  if (!ruleData.ruleName) {
    throw new Error('规则名称不能为空');
  }
  if (!ruleData.alertLevel) {
    throw new Error('告警级别不能为空');
  }
  if (!ruleData.roles || ruleData.roles.length === 0) {
    throw new Error('接收角色不能为空');
  }

  const rule = await NotificationRule.create({
    ruleName: ruleData.ruleName,
    ruleType: ruleData.ruleType || 'project_level',
    projectId: ruleData.projectId,
    areaId: ruleData.areaId,
    alertLevel: ruleData.alertLevel,
    alertLevelName: ALERT_LEVEL_NAMES[ruleData.alertLevel] || ruleData.alertLevel,
    roles: ruleData.roles,
    channels: ruleData.channels || {
      sms: ruleData.alertLevel === 'level1',
      voice: ruleData.alertLevel === 'level1',
      wechat: true,
      email: false
    },
    escalationRules: ruleData.escalationRules || {
      enabled: ruleData.alertLevel === 'level1',
      firstInterval: 10,
      secondInterval: 20,
      maxEscalations: 3,
      escalateToRoles: ['project_manager', 'safety_officer']
    },
    timeRules: ruleData.timeRules || {
      workHours: { start: '08:00', end: '18:00' },
      nightHours: { start: '18:00', end: '08:00' },
      nightEnhancement: ruleData.alertLevel === 'level1'
    },
    notifyDuringPouringOnly: ruleData.notifyDuringPouringOnly || false,
    isEnabled: ruleData.isEnabled !== undefined ? ruleData.isEnabled : true,
    priority: ruleData.priority || 0,
    description: ruleData.description,
    createdBy: ruleData.createdBy
  });

  return rule;
}

async function getNotificationRuleList(params = {}) {
  const { page = 1, pageSize = 20, projectId, alertLevel, isEnabled, ruleType } = params;

  const where = {};
  if (projectId) where.projectId = projectId;
  if (alertLevel) where.alertLevel = alertLevel;
  if (isEnabled !== undefined) where.isEnabled = isEnabled;
  if (ruleType) where.ruleType = ruleType;

  const { count, rows } = await NotificationRule.findAll({
    where,
    order: [['priority', 'DESC'], ['createdAt', 'DESC']],
    limit: pageSize,
    offset: (page - 1) * pageSize
  });

  const listWithAssociations = await Promise.all(rows.map(async rule => {
    return await loadAssociations(rule, [
      { model: 'Project', as: 'project' },
      { model: 'Area', as: 'area' }
    ]);
  }));

  return {
    total: count,
    page,
    pageSize,
    list: listWithAssociations
  };
}

async function getNotificationRuleDetail(ruleId) {
  const rule = await NotificationRule.findByPk(ruleId);

  if (!rule) {
    throw new Error(`通知规则不存在: ${ruleId}`);
  }

  return await loadAssociations(rule, [
    { model: 'Project', as: 'project' },
    { model: 'Area', as: 'area' }
  ]);
}

async function updateNotificationRule(ruleId, updateData) {
  if (updateData.alertLevel) {
    updateData.alertLevelName = ALERT_LEVEL_NAMES[updateData.alertLevel] || updateData.alertLevel;
  }

  const updated = await NotificationRule.update(ruleId, updateData);
  if (!updated) {
    throw new Error(`通知规则不存在: ${ruleId}`);
  }
  return updated;
}

async function deleteNotificationRule(ruleId) {
  const result = await NotificationRule.destroy(ruleId);
  if (!result) {
    throw new Error(`通知规则不存在: ${ruleId}`);
  }
  return { success: true, message: '规则已删除' };
}

async function matchNotificationRules(alert) {
  logger.info('匹配通知规则', { alertId: alert.id, alertLevel: alert.alertLevel });

  const allRules = await NotificationRule.findAll({
    where: {
      alertLevel: alert.alertLevel,
      isEnabled: true
    },
    order: [['priority', 'DESC'], ['ruleType', 'ASC']]
  });

  const filteredRules = allRules.rows.filter(rule => {
    return rule.ruleType === 'global' || 
           rule.projectId === alert.projectId || 
           rule.areaId === alert.areaId;
  });

  const matchedRules = [];

  for (const rule of filteredRules) {
    if (rule.notifyDuringPouringOnly && !alert.isNightPouring && 
        alert.pouringStatus !== 'pouring') {
      continue;
    }

    matchedRules.push(rule);
  }

  logger.info('匹配到通知规则', { 
    alertId: alert.id, 
    ruleCount: matchedRules.length,
    rules: matchedRules.map(r => ({ id: r.id, name: r.ruleName }))
  });

  return matchedRules;
}

async function createDefaultRules(projectId, createdBy = 'system') {
  logger.info('为项目创建默认通知规则', { projectId });

  const defaultRules = [
    {
      ruleName: '一级告警-总包监理班组全员通知',
      alertLevel: 'level1',
      roles: ['general_contractor', 'supervisor', 'labor_team', 'project_manager', 'safety_officer'],
      channels: { sms: true, voice: true, wechat: true, email: false },
      priority: 100,
      description: '一级告警：电话语音+短信+企业群，通知总包、监理、劳务班组、项目经理、安全员'
    },
    {
      ruleName: '二级告警-总包监理通知',
      alertLevel: 'level2',
      roles: ['general_contractor', 'supervisor', 'safety_officer'],
      channels: { sms: true, voice: false, wechat: true, email: false },
      priority: 50,
      description: '二级告警：短信+企业群，通知总包、监理、安全员'
    },
    {
      ruleName: '提示类告警-仅设备管理员',
      alertLevel: 'notice',
      roles: ['device_admin'],
      channels: { sms: false, voice: false, wechat: true, email: false },
      priority: 10,
      description: '提示类告警：仅企业群通知设备管理员'
    }
  ];

  const createdRules = [];
  for (const ruleData of defaultRules) {
    try {
      const rule = await createNotificationRule({
        ...ruleData,
        ruleType: 'project_level',
        projectId,
        createdBy,
        escalationRules: {
          enabled: ruleData.alertLevel === 'level1',
          firstInterval: 10,
          secondInterval: 20,
          maxEscalations: 3,
          escalateToRoles: ['project_manager', 'safety_officer']
        }
      });
      createdRules.push(rule);
    } catch (error) {
      logger.error('创建默认规则失败', { projectId, error: error.message });
    }
  }

  return createdRules;
}

module.exports = {
  ROLE_NAMES,
  ALERT_LEVEL_NAMES,
  createNotificationRule,
  getNotificationRuleList,
  getNotificationRuleDetail,
  updateNotificationRule,
  deleteNotificationRule,
  matchNotificationRules,
  createDefaultRules
};
