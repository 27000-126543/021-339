const express = require('express');
const router = express.Router();
const { apiKeyAuth, optionalApiKeyAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const {
  submitReceipt,
  getReceiptList,
  getReceiptDetail,
  getAlertReceipts,
  getReceiptStatistics,
  validateReceiptToken
} = require('../services/receiptService');
const {
  submitReminder,
  getReminderList,
  getReminderStatistics
} = require('../services/reminderService');

router.get('/', optionalApiKeyAuth, asyncHandler(async (req, res) => {
  const token = req.query.token;

  if (token) {
    const validation = validateReceiptToken(token);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: `回执链接无效: ${validation.error}`,
        code: 'INVALID_RECEIPT_TOKEN'
      });
    }

    return res.json({
      success: true,
      data: {
        valid: true,
        alertId: validation.data.alertId,
        notificationId: validation.data.notificationId,
        recipientId: validation.data.recipientId,
        message: '请填写回执信息'
      }
    });
  }

  return res.json({
    success: true,
    message: '高支模预警回执系统',
    instructions: '请通过短信或微信中的回执链接访问此页面'
  });
}));

router.post('/submit', optionalApiKeyAuth, asyncHandler(async (req, res) => {
  const token = req.query.token || req.body.token;
  const result = await submitReceipt(req.body, token, req);

  res.json({
    success: true,
    data: result,
    message: result.message
  });
}));

router.get('/list', apiKeyAuth, asyncHandler(async (req, res) => {
  const params = {
    page: parseInt(req.query.page) || 1,
    pageSize: parseInt(req.query.pageSize) || 20,
    alertId: req.query.alertId,
    recipientId: req.query.recipientId,
    receiptType: req.query.receiptType,
    startTime: req.query.startTime,
    endTime: req.query.endTime
  };

  const result = await getReceiptList(params);

  res.json({
    success: true,
    data: result
  });
}));

router.get('/statistics/summary', apiKeyAuth, asyncHandler(async (req, res) => {
  const params = {
    projectId: req.query.projectId,
    startTime: req.query.startTime,
    endTime: req.query.endTime,
    groupBy: req.query.groupBy
  };

  const stats = await getReceiptStatistics(params);

  res.json({
    success: true,
    data: stats
  });
}));

router.get('/alert/:alertId', apiKeyAuth, asyncHandler(async (req, res) => {
  const result = await getAlertReceipts(req.params.alertId);

  res.json({
    success: true,
    data: result
  });
}));

router.post('/reminder', apiKeyAuth, asyncHandler(async (req, res) => {
  const operatorId = req.headers['x-operator-id'] || null;
  const operatorName = req.headers['x-operator-name'] || null;
  const result = await submitReminder(req.body, operatorId, operatorName);

  res.json({
    success: true,
    data: result,
    message: `催办指令已下发，共 ${result.total} 条`
  });
}));

router.get('/reminder/list', apiKeyAuth, asyncHandler(async (req, res) => {
  const params = {
    page: parseInt(req.query.page) || 1,
    pageSize: parseInt(req.query.pageSize) || 20,
    alertId: req.query.alertId,
    recipientId: req.query.recipientId,
    channel: req.query.channel,
    status: req.query.status,
    startTime: req.query.startTime,
    endTime: req.query.endTime
  };

  const result = await getReminderList(params);

  res.json({
    success: true,
    data: result
  });
}));

router.get('/reminder/statistics', apiKeyAuth, asyncHandler(async (req, res) => {
  const params = {
    projectId: req.query.projectId,
    startTime: req.query.startTime,
    endTime: req.query.endTime,
    groupBy: req.query.groupBy
  };

  const stats = await getReminderStatistics(params);

  res.json({
    success: true,
    data: stats
  });
}));

router.get('/:id', apiKeyAuth, asyncHandler(async (req, res) => {
  const receipt = await getReceiptDetail(req.params.id);

  res.json({
    success: true,
    data: receipt
  });
}));

module.exports = router;
