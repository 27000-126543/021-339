const express = require('express');
const router = express.Router();
const { apiKeyAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const {
  triggerNotifications,
  getNotificationList,
  getChannelConfig,
  getNotificationBatchOverview,
  getNotificationBatchLedger,
  getProjectDashboard,
  getChannelConfigImpactByProject
} = require('../services/notificationService');

router.get('/channels/config', apiKeyAuth, asyncHandler(async (req, res) => {
  const config = getChannelConfig();
  
  res.json({
    success: true,
    data: config
  });
}));

router.get('/batch/overview/:alertId', apiKeyAuth, asyncHandler(async (req, res) => {
  const overview = await getNotificationBatchOverview(req.params.alertId);

  res.json({
    success: true,
    data: overview
  });
}));

router.get('/batch/ledger', apiKeyAuth, asyncHandler(async (req, res) => {
  const params = {
    page: parseInt(req.query.page) || 1,
    pageSize: parseInt(req.query.pageSize) || 20,
    projectId: req.query.projectId,
    alertLevel: req.query.alertLevel,
    startTime: req.query.startTime,
    endTime: req.query.endTime
  };

  const result = await getNotificationBatchLedger(params);

  res.json({
    success: true,
    data: result
  });
}));

router.get('/dashboard', apiKeyAuth, asyncHandler(async (req, res) => {
  const params = {
    projectId: req.query.projectId,
    startTime: req.query.startTime,
    endTime: req.query.endTime,
    alertLevel: req.query.alertLevel
  };

  const result = await getProjectDashboard(params);

  res.json({
    success: true,
    data: result
  });
}));

router.get('/channel-impact', apiKeyAuth, asyncHandler(async (req, res) => {
  const params = {
    projectId: req.query.projectId,
    startTime: req.query.startTime,
    endTime: req.query.endTime
  };

  const result = await getChannelConfigImpactByProject(params);

  res.json({
    success: true,
    data: result
  });
}));

router.post('/trigger/:alertId', apiKeyAuth, asyncHandler(async (req, res) => {
  const result = await triggerNotifications(req.params.alertId);

  res.json({
    success: true,
    data: result,
    message: result.sent ? '通知触发成功' : '通知未发送'
  });
}));

router.get('/', apiKeyAuth, asyncHandler(async (req, res) => {
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

  const result = await getNotificationList(params);

  res.json({
    success: true,
    data: result
  });
}));

module.exports = router;
