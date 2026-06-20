const express = require('express');
const router = express.Router();
const { apiKeyAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { receiveAlert, batchReceiveAlerts, getAlertList, getAlertDetail } = require('../services/alertReceiveService');

router.post('/receive', apiKeyAuth, asyncHandler(async (req, res) => {
  const result = await receiveAlert({
    ...req.body,
    sourceSystem: req.apiSystem || req.body.sourceSystem
  });

  res.status(201).json({
    success: true,
    data: result,
    message: '告警接收成功'
  });
}));

router.post('/batch', apiKeyAuth, asyncHandler(async (req, res) => {
  const { events } = req.body;

  if (!events || !Array.isArray(events)) {
    return res.status(400).json({
      success: false,
      message: 'events必须是数组'
    });
  }

  const result = await batchReceiveAlerts(events.map(e => ({
    ...e,
    sourceSystem: req.apiSystem || e.sourceSystem
  })));

  res.json({
    success: true,
    data: result,
    message: '批量处理完成'
  });
}));

router.get('/', apiKeyAuth, asyncHandler(async (req, res) => {
  const params = {
    page: parseInt(req.query.page) || 1,
    pageSize: parseInt(req.query.pageSize) || 20,
    projectId: req.query.projectId,
    alertLevel: req.query.alertLevel,
    status: req.query.status,
    startTime: req.query.startTime,
    endTime: req.query.endTime,
    eventType: req.query.eventType
  };

  const result = await getAlertList(params);

  res.json({
    success: true,
    data: result
  });
}));

router.get('/:id', apiKeyAuth, asyncHandler(async (req, res) => {
  const alert = await getAlertDetail(req.params.id);

  res.json({
    success: true,
    data: alert
  });
}));

module.exports = router;
