const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { authenticate, sync } = require('./config/database');
const logger = require('./config/logger');
const requestLogger = require('./middleware/requestLogger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const alertRoutes = require('./routes/alertRoutes');
const receiptRoutes = require('./routes/receiptRoutes');
const notificationRuleRoutes = require('./routes/notificationRuleRoutes');
const recipientRoutes = require('./routes/recipientRoutes');
const projectRoutes = require('./routes/projectRoutes');
const notificationRoutes = require('./routes/notificationRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: '请求过于频繁，请稍后再试',
    code: 'RATE_LIMIT_EXCEEDED'
  }
});

app.use('/api/', apiLimiter);
app.use(requestLogger);

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: '高支模预警短信与语音后端服务运行正常',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    uptime: process.uptime()
  });
});

app.use('/api/alerts', alertRoutes);
app.use('/api/receipt', receiptRoutes);
app.use('/api/notification-rules', notificationRuleRoutes);
app.use('/api/recipients', recipientRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/notifications', notificationRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

async function startServer() {
  try {
    await authenticate();
    logger.info('数据库连接成功');

    await sync();
    logger.info('数据库同步完成');

    const fs = require('fs');
    const path = require('path');
    const dataDir = path.join(__dirname, '../data');
    const logsDir = path.join(__dirname, '../logs');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

    app.listen(PORT, () => {
      logger.info(`服务启动成功，监听端口: ${PORT}`);
      logger.info(`API文档: http://localhost:${PORT}/api/health`);
      logger.info(`环境: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    logger.error('服务启动失败', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

startServer();

process.on('unhandledRejection', (reason, promise) => {
  logger.error('未处理的Promise拒绝', { reason: reason?.message, stack: reason?.stack });
});

process.on('uncaughtException', (error) => {
  logger.error('未捕获的异常', { error: error.message, stack: error.stack });
  process.exit(1);
});

module.exports = app;
