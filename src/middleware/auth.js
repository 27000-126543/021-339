const jwt = require('jsonwebtoken');
const logger = require('../config/logger');
require('dotenv').config();

const API_KEYS = {
  'monitoring_system': 'monitor_key_2024',
  'project_management': 'project_key_2024',
  'emergency_system': 'emergency_key_2024',
  'default': 'alert_system_key_2024'
};

function apiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;

  if (!apiKey) {
    logger.warn('缺少API Key', { ip: req.ip, path: req.path });
    return res.status(401).json({
      success: false,
      message: '缺少API Key认证',
      code: 'MISSING_API_KEY'
    });
  }

  const validKeys = Object.values(API_KEYS);
  if (!validKeys.includes(apiKey)) {
    logger.warn('无效的API Key', { ip: req.ip, apiKey: apiKey.substring(0, 5) + '...' });
    return res.status(401).json({
      success: false,
      message: '无效的API Key',
      code: 'INVALID_API_KEY'
    });
  }

  const systemName = Object.keys(API_KEYS).find(key => API_KEYS[key] === apiKey);
  req.apiSystem = systemName;
  logger.debug('API Key认证通过', { system: systemName, ip: req.ip });

  next();
}

function optionalApiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;

  if (apiKey) {
    const validKeys = Object.values(API_KEYS);
    if (validKeys.includes(apiKey)) {
      const systemName = Object.keys(API_KEYS).find(key => API_KEYS[key] === apiKey);
      req.apiSystem = systemName;
    }
  }

  next();
}

function jwtAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: '缺少Token认证',
      code: 'MISSING_TOKEN'
    });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    logger.warn('JWT认证失败', { error: error.message, ip: req.ip });
    return res.status(401).json({
      success: false,
      message: 'Token无效或已过期',
      code: 'INVALID_TOKEN'
    });
  }
}

module.exports = {
  apiKeyAuth,
  optionalApiKeyAuth,
  jwtAuth,
  API_KEYS
};
