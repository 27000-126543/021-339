const logger = require('../config/logger');

function errorHandler(err, req, res, next) {
  logger.error('未捕获的错误', {
    error: err.message,
    stack: err.stack,
    method: req.method,
    path: req.path,
    ip: req.ip
  });

  const statusCode = err.statusCode || err.status || 500;
  const errorCode = err.code || 'INTERNAL_ERROR';
  const message = err.message || '服务器内部错误';

  if (statusCode === 500 && process.env.NODE_ENV === 'production') {
    return res.status(500).json({
      success: false,
      message: '服务器内部错误',
      code: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString()
    });
  }

  res.status(statusCode).json({
    success: false,
    message,
    code: errorCode,
    details: process.env.NODE_ENV === 'development' ? {
      stack: err.stack,
      errors: err.errors
    } : undefined,
    timestamp: new Date().toISOString()
  });
}

function notFoundHandler(req, res, next) {
  logger.warn('请求的路由不存在', {
    method: req.method,
    path: req.path,
    ip: req.ip
  });

  res.status(404).json({
    success: false,
    message: `请求的路由 ${req.method} ${req.path} 不存在`,
    code: 'NOT_FOUND',
    timestamp: new Date().toISOString()
  });
}

function asyncHandler(fn) {
  return function(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

class AppError extends Error {
  constructor(message, statusCode = 400, code = 'BAD_REQUEST') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
  }
}

module.exports = {
  errorHandler,
  notFoundHandler,
  asyncHandler,
  AppError
};
