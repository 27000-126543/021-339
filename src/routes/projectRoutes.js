const express = require('express');
const router = express.Router();
const { apiKeyAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const {
  createProject,
  getProjectList,
  getProjectDetail,
  updateProject,
  updatePouringStatus,
  createArea,
  createSensor,
  updateSensorStatus
} = require('../services/projectService');

router.post('/', apiKeyAuth, asyncHandler(async (req, res) => {
  const project = await createProject({
    ...req.body,
    createdBy: req.apiSystem || req.body.createdBy
  });

  res.status(201).json({
    success: true,
    data: project,
    message: '项目创建成功'
  });
}));

router.get('/', apiKeyAuth, asyncHandler(async (req, res) => {
  const params = {
    page: parseInt(req.query.page) || 1,
    pageSize: parseInt(req.query.pageSize) || 20,
    status: req.query.status,
    keyword: req.query.keyword
  };

  const result = await getProjectList(params);

  res.json({
    success: true,
    data: result
  });
}));

router.get('/:id', apiKeyAuth, asyncHandler(async (req, res) => {
  const project = await getProjectDetail(req.params.id);

  res.json({
    success: true,
    data: project
  });
}));

router.put('/:id', apiKeyAuth, asyncHandler(async (req, res) => {
  const project = await updateProject(req.params.id, req.body);

  res.json({
    success: true,
    data: project,
    message: '项目更新成功'
  });
}));

router.post('/:id/pouring-status', apiKeyAuth, asyncHandler(async (req, res) => {
  const { pouringStatus, isNightPouring } = req.body;

  if (!pouringStatus) {
    return res.status(400).json({
      success: false,
      message: 'pouringStatus不能为空'
    });
  }

  const validStatuses = ['not_started', 'pouring', 'completed', 'curing'];
  if (!validStatuses.includes(pouringStatus)) {
    return res.status(400).json({
      success: false,
      message: `无效的pouringStatus，有效值为: ${validStatuses.join(', ')}`
    });
  }

  const project = await updatePouringStatus(req.params.id, pouringStatus, isNightPouring);

  res.json({
    success: true,
    data: {
      id: project.id,
      pouringStatus: project.pouringStatus,
      isNightPouring: project.isNightPouring,
      pouringStartTime: project.pouringStartTime,
      pouringEndTime: project.pouringEndTime
    },
    message: '浇筑状态更新成功'
  });
}));

router.post('/area', apiKeyAuth, asyncHandler(async (req, res) => {
  const area = await createArea(req.body);

  res.status(201).json({
    success: true,
    data: area,
    message: '区域创建成功'
  });
}));

router.post('/sensor', apiKeyAuth, asyncHandler(async (req, res) => {
  const sensor = await createSensor(req.body);

  res.status(201).json({
    success: true,
    data: sensor,
    message: '传感器创建成功'
  });
}));

router.post('/sensor/:id/status', apiKeyAuth, asyncHandler(async (req, res) => {
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({
      success: false,
      message: 'status不能为空'
    });
  }

  const validStatuses = ['online', 'offline', 'fault', 'maintenance'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message: `无效的status，有效值为: ${validStatuses.join(', ')}`
    });
  }

  const sensor = await updateSensorStatus(req.params.id, status);

  res.json({
    success: true,
    data: {
      id: sensor.id,
      sensorCode: sensor.sensorCode,
      status: sensor.status,
      lastOnlineTime: sensor.lastOnlineTime
    },
    message: '传感器状态更新成功'
  });
}));

module.exports = router;
