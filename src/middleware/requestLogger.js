const logger = require('../config/logger');

function requestLogger(req, res, next) {
  const startTime = Date.now();

  logger.info('请求开始', {
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    apiSystem: req.apiSystem || 'unknown'
  });

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const contentLength = res.getHeader('content-length') || 0;

    logger.info('请求完成', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      contentLength,
      ip: req.ip,
      apiSystem: req.apiSystem || 'unknown'
    });
  });

  res.on('close', () => {
    if (!res.headersSent) {
      const duration = Date.now() - startTime;
      logger.warn('请求被中断', {
        method: req.method,
        path: req.path,
        duration: `${duration}ms`,
        ip: req.ip
      });
    }
  });

  next();
}

module.exports = requestLogger;
