const express = require('express');
const router = express.Router();
const { apiKeyAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const {
  createNotificationRule,
  getNotificationRuleList,
  getNotificationRuleDetail,
  updateNotificationRule,
  deleteNotificationRule,
  createDefaultRules
} = require('../services/notificationRuleService');

router.post('/', apiKeyAuth, asyncHandler(async (req, res) => {
  const rule = await createNotificationRule({
    ...req.body,
    createdBy: req.apiSystem || req.body.createdBy
  });

  res.status(201).json({
    success: true,
    data: rule,
    message: '通知规则创建成功'
  });
}));

router.get('/', apiKeyAuth, asyncHandler(async (req, res) => {
  const params = {
    page: parseInt(req.query.page) || 1,
    pageSize: parseInt(req.query.pageSize) || 20,
    projectId: req.query.projectId,
    alertLevel: req.query.alertLevel,
    isEnabled: req.query.isEnabled !== undefined ? req.query.isEnabled === 'true' : undefined,
    ruleType: req.query.ruleType
  };

  const result = await getNotificationRuleList(params);

  res.json({
    success: true,
    data: result
  });
}));

router.get('/:id', apiKeyAuth, asyncHandler(async (req, res) => {
  const rule = await getNotificationRuleDetail(req.params.id);

  res.json({
    success: true,
    data: rule
  });
}));

router.put('/:id', apiKeyAuth, asyncHandler(async (req, res) => {
  const rule = await updateNotificationRule(req.params.id, req.body);

  res.json({
    success: true,
    data: rule,
    message: '通知规则更新成功'
  });
}));

router.delete('/:id', apiKeyAuth, asyncHandler(async (req, res) => {
  const result = await deleteNotificationRule(req.params.id);

  res.json({
    success: true,
    data: result,
    message: '通知规则删除成功'
  });
}));

router.post('/default/:projectId', apiKeyAuth, asyncHandler(async (req, res) => {
  const rules = await createDefaultRules(
    req.params.projectId,
    req.apiSystem || req.body.createdBy
  );

  res.json({
    success: true,
    data: rules,
    message: '默认规则创建成功',
    count: rules.length
  });
}));

module.exports = router;
