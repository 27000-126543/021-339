const express = require('express');
const router = express.Router();
const { apiKeyAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const {
  triggerNotifications,
  getNotificationList
} = require('../services/notificationService');

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
