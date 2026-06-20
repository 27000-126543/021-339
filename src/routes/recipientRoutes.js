const express = require('express');
const router = express.Router();
const { apiKeyAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const {
  createRecipient,
  getRecipientList,
  getRecipientDetail,
  updateRecipient,
  deleteRecipient,
  setDutyStatus,
  batchCreateRecipients,
  getRecipientsByRole
} = require('../services/recipientService');

router.post('/', apiKeyAuth, asyncHandler(async (req, res) => {
  const recipient = await createRecipient(req.body);

  res.status(201).json({
    success: true,
    data: recipient,
    message: '接收人创建成功'
  });
}));

router.post('/batch/:projectId', apiKeyAuth, asyncHandler(async (req, res) => {
  const { recipients } = req.body;

  if (!recipients || !Array.isArray(recipients)) {
    return res.status(400).json({
      success: false,
      message: 'recipients必须是数组'
    });
  }

  const result = await batchCreateRecipients(req.params.projectId, recipients);

  res.json({
    success: true,
    data: result,
    message: '批量创建完成'
  });
}));

router.get('/', apiKeyAuth, asyncHandler(async (req, res) => {
  const params = {
    page: parseInt(req.query.page) || 1,
    pageSize: parseInt(req.query.pageSize) || 20,
    projectId: req.query.projectId,
    areaId: req.query.areaId,
    role: req.query.role,
    isEnabled: req.query.isEnabled !== undefined ? req.query.isEnabled === 'true' : undefined,
    isOnDuty: req.query.isOnDuty !== undefined ? req.query.isOnDuty === 'true' : undefined,
    keyword: req.query.keyword
  };

  const result = await getRecipientList(params);

  res.json({
    success: true,
    data: result
  });
}));

router.get('/by-role', apiKeyAuth, asyncHandler(async (req, res) => {
  const { projectId, roles } = req.query;
  const roleArray = roles ? roles.split(',') : [];

  const recipients = await getRecipientsByRole(projectId, roleArray);

  res.json({
    success: true,
    data: recipients,
    count: recipients.length
  });
}));

router.get('/:id', apiKeyAuth, asyncHandler(async (req, res) => {
  const recipient = await getRecipientDetail(req.params.id);

  res.json({
    success: true,
    data: recipient
  });
}));

router.put('/:id', apiKeyAuth, asyncHandler(async (req, res) => {
  const recipient = await updateRecipient(req.params.id, req.body);

  res.json({
    success: true,
    data: recipient,
    message: '接收人更新成功'
  });
}));

router.delete('/:id', apiKeyAuth, asyncHandler(async (req, res) => {
  const result = await deleteRecipient(req.params.id);

  res.json({
    success: true,
    data: result,
    message: '接收人删除成功'
  });
}));

router.post('/:id/duty', apiKeyAuth, asyncHandler(async (req, res) => {
  const { isOnDuty, dutyStartTime, dutyEndTime } = req.body;

  if (isOnDuty === undefined) {
    return res.status(400).json({
      success: false,
      message: 'isOnDuty不能为空'
    });
  }

  const recipient = await setDutyStatus(
    req.params.id,
    isOnDuty,
    dutyStartTime,
    dutyEndTime
  );

  res.json({
    success: true,
    data: recipient,
    message: `值班状态已更新为${isOnDuty ? '值班中' : '已下班'}`
  });
}));

module.exports = router;
