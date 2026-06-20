const { Op } = require('../config/database');
const { Recipient, Project, Area, loadAssociations } = require('../models');
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

async function createRecipient(recipientData) {
  logger.info('创建接收人', { name: recipientData.name, role: recipientData.role });

  if (!recipientData.name) {
    throw new Error('姓名不能为空');
  }
  if (!recipientData.phone) {
    throw new Error('手机号不能为空');
  }
  if (!recipientData.role) {
    throw new Error('角色不能为空');
  }

  const phoneRegex = /^1[3-9]\d{9}$/;
  if (!phoneRegex.test(recipientData.phone)) {
    throw new Error('请输入有效的手机号码');
  }

  const allRecipients = await Recipient.findAll({
    where: {
      phone: recipientData.phone
    }
  });

  const existing = allRecipients.rows.find(r => 
    r.projectId === (recipientData.projectId || null) || r.projectId === null
  );

  if (existing) {
    throw new Error('该手机号已在当前项目中存在');
  }

  const recipient = await Recipient.create({
    name: recipientData.name,
    phone: recipientData.phone,
    role: recipientData.role,
    roleName: ROLE_NAMES[recipientData.role] || recipientData.role,
    projectId: recipientData.projectId,
    areaId: recipientData.areaId,
    company: recipientData.company,
    position: recipientData.position,
    email: recipientData.email,
    wechatId: recipientData.wechatId,
    isOnDuty: recipientData.isOnDuty || false,
    notificationChannels: recipientData.notificationChannels || {
      sms: true,
      voice: recipientData.role === 'general_contractor' || recipientData.role === 'project_manager',
      wechat: true,
      email: false
    },
    isEnabled: recipientData.isEnabled !== undefined ? recipientData.isEnabled : true,
    sortOrder: recipientData.sortOrder || 0,
    remarks: recipientData.remarks
  });

  return recipient;
}

async function getRecipientList(params = {}) {
  const {
    page = 1,
    pageSize = 20,
    projectId,
    areaId,
    role,
    isEnabled,
    isOnDuty,
    keyword
  } = params;

  const where = {};
  if (projectId) where.projectId = projectId;
  if (areaId) where.areaId = areaId;
  if (role) where.role = role;
  if (isEnabled !== undefined) where.isEnabled = isEnabled;
  if (isOnDuty !== undefined) where.isOnDuty = isOnDuty;

  const { count, rows } = await Recipient.findAll({
    where,
    order: [['sortOrder', 'ASC'], ['role', 'ASC'], ['createdAt', 'DESC']],
    limit: pageSize,
    offset: (page - 1) * pageSize
  });

  let filteredRows = rows;
  if (keyword) {
    const lowerKeyword = keyword.toLowerCase();
    filteredRows = rows.filter(r => 
      (r.name && r.name.toLowerCase().includes(lowerKeyword)) ||
      (r.phone && r.phone.includes(keyword)) ||
      (r.company && r.company.toLowerCase().includes(lowerKeyword))
    );
  }

  const listWithAssociations = await Promise.all(filteredRows.map(async recipient => {
    return await loadAssociations(recipient, [
      { model: 'Project', as: 'project' },
      { model: 'Area', as: 'area' }
    ]);
  }));

  return {
    total: keyword ? filteredRows.length : count,
    page,
    pageSize,
    list: listWithAssociations
  };
}

async function getRecipientDetail(recipientId) {
  const recipient = await Recipient.findByPk(recipientId);

  if (!recipient) {
    throw new Error(`接收人不存在: ${recipientId}`);
  }

  return await loadAssociations(recipient, [
    { model: 'Project', as: 'project' },
    { model: 'Area', as: 'area' }
  ]);
}

async function updateRecipient(recipientId, updateData) {
  const recipient = await Recipient.findByPk(recipientId);
  if (!recipient) {
    throw new Error(`接收人不存在: ${recipientId}`);
  }

  if (updateData.phone && updateData.phone !== recipient.phone) {
    const phoneRegex = /^1[3-9]\d{9}$/;
    if (!phoneRegex.test(updateData.phone)) {
      throw new Error('请输入有效的手机号码');
    }

    const existingResult = await Recipient.findAll({
      where: { phone: updateData.phone }
    });
    
    const existing = existingResult.rows.find(r => 
      r.id !== recipientId && (
        r.projectId === (updateData.projectId || recipient.projectId || null) || 
        r.projectId === null
      )
    );

    if (existing) {
      throw new Error('该手机号已在当前项目中存在');
    }
  }

  if (updateData.role) {
    updateData.roleName = ROLE_NAMES[updateData.role] || updateData.role;
  }

  return await Recipient.update(recipientId, updateData);
}

async function deleteRecipient(recipientId) {
  const result = await Recipient.destroy(recipientId);
  if (!result) {
    throw new Error(`接收人不存在: ${recipientId}`);
  }
  return { success: true, message: '接收人已删除' };
}

async function setDutyStatus(recipientId, isOnDuty, dutyStartTime, dutyEndTime) {
  const recipient = await Recipient.findByPk(recipientId);
  if (!recipient) {
    throw new Error(`接收人不存在: ${recipientId}`);
  }

  const updateData = { isOnDuty };
  if (isOnDuty) {
    updateData.dutyStartTime = dutyStartTime || new Date();
    updateData.dutyEndTime = dutyEndTime;
  }

  const updated = await Recipient.update(recipientId, updateData);

  logger.info('更新值班状态', { recipientId, name: recipient.name, isOnDuty });

  return updated;
}

async function batchCreateRecipients(projectId, recipients) {
  logger.info('批量创建接收人', { projectId, count: recipients.length });

  const results = [];
  for (const recipientData of recipients) {
    try {
      const recipient = await createRecipient({
        ...recipientData,
        projectId
      });
      results.push({ success: true, recipient });
    } catch (error) {
      results.push({
        success: false,
        error: error.message,
        recipientData
      });
    }
  }

  return {
    total: recipients.length,
    successCount: results.filter(r => r.success).length,
    failCount: results.filter(r => !r.success).length,
    results
  };
}

async function getRecipientsByRole(projectId, roles) {
  const where = {
    isEnabled: true
  };

  const allRecipients = await Recipient.findAll({
    where,
    order: [['sortOrder', 'ASC'], ['createdAt', 'ASC']]
  });

  let recipients = allRecipients.rows.filter(r => 
    r.projectId === projectId || r.projectId === null
  );

  if (roles && roles.length > 0) {
    recipients = recipients.filter(r => roles.includes(r.role));
  }

  return recipients;
}

module.exports = {
  ROLE_NAMES,
  createRecipient,
  getRecipientList,
  getRecipientDetail,
  updateRecipient,
  deleteRecipient,
  setDutyStatus,
  batchCreateRecipients,
  getRecipientsByRole
};
