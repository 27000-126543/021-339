const { db, initDB, sync, authenticate } = require('../config/database');

const Project = require('./Project');
const Area = require('./Area');
const Sensor = require('./Sensor');
const Alert = require('./Alert');
const Recipient = require('./Recipient');
const NotificationRule = require('./NotificationRule');
const Notification = require('./Notification');
const Receipt = require('./Receipt');
const Reminder = require('./Reminder');

async function loadAssociations(item, includes) {
  if (!item || !includes) return item;
  
  const result = { ...item };
  
  for (const include of includes) {
    const modelName = include.model || include;
    const as = include.as || modelName.toLowerCase();
    const foreignKey = include.foreignKey || `${modelName.toLowerCase()}Id`;
    const where = include.where || {};
    
    let relatedData = [];
    
    switch (modelName) {
      case 'Project':
        relatedData = await Project.findAll({ where: { id: item[foreignKey], ...where } });
        break;
      case 'Area':
        if (foreignKey === 'projectId') {
          relatedData = await Area.findAll({ where: { projectId: item.id, ...where } });
        } else {
          relatedData = await Area.findAll({ where: { id: item[foreignKey], ...where } });
        }
        break;
      case 'Sensor':
        if (foreignKey === 'projectId') {
          relatedData = await Sensor.findAll({ where: { projectId: item.id, ...where } });
        } else if (foreignKey === 'areaId') {
          relatedData = await Sensor.findAll({ where: { areaId: item.id, ...where } });
        } else {
          relatedData = await Sensor.findAll({ where: { id: item[foreignKey], ...where } });
        }
        break;
      case 'Alert':
        if (foreignKey === 'projectId') {
          relatedData = await Alert.findAll({ where: { projectId: item.id, ...where } });
        } else if (foreignKey === 'areaId') {
          relatedData = await Alert.findAll({ where: { areaId: item.id, ...where } });
        } else if (foreignKey === 'sensorId') {
          relatedData = await Alert.findAll({ where: { sensorId: item.id, ...where } });
        } else {
          relatedData = await Alert.findAll({ where: { id: item[foreignKey], ...where } });
        }
        break;
      case 'Recipient':
        if (foreignKey === 'projectId') {
          relatedData = await Recipient.findAll({ where: { projectId: item.id, ...where } });
        } else if (foreignKey === 'areaId') {
          relatedData = await Recipient.findAll({ where: { areaId: item.id, ...where } });
        } else {
          relatedData = await Recipient.findAll({ where: { id: item[foreignKey], ...where } });
        }
        break;
      case 'NotificationRule':
        if (foreignKey === 'projectId') {
          relatedData = await NotificationRule.findAll({ where: { projectId: item.id, ...where } });
        } else if (foreignKey === 'areaId') {
          relatedData = await NotificationRule.findAll({ where: { areaId: item.id, ...where } });
        } else {
          relatedData = await NotificationRule.findAll({ where: { id: item[foreignKey], ...where } });
        }
        break;
      case 'Notification':
        if (foreignKey === 'alertId') {
          relatedData = await Notification.findAll({ where: { alertId: item.id, ...where } });
        } else if (foreignKey === 'recipientId') {
          relatedData = await Notification.findAll({ where: { recipientId: item.id, ...where } });
        } else {
          relatedData = await Notification.findAll({ where: { id: item[foreignKey], ...where } });
        }
        break;
      case 'Receipt':
        if (foreignKey === 'alertId') {
          relatedData = await Receipt.findAll({ where: { alertId: item.id, ...where } });
        } else if (foreignKey === 'notificationId') {
          relatedData = await Receipt.findAll({ where: { notificationId: item.id, ...where } });
        } else if (foreignKey === 'recipientId') {
          relatedData = await Receipt.findAll({ where: { recipientId: item.id, ...where } });
        } else {
          relatedData = await Receipt.findAll({ where: { id: item[foreignKey], ...where } });
        }
        break;
      case 'Reminder':
        if (foreignKey === 'alertId') {
          relatedData = await Reminder.findAll({ where: { alertId: item.id, ...where } });
        } else if (foreignKey === 'recipientId') {
          relatedData = await Reminder.findAll({ where: { recipientId: item.id, ...where } });
        } else {
          relatedData = await Reminder.findAll({ where: { id: item[foreignKey], ...where } });
        }
        break;
    }
    
    if (include.include) {
      result[as] = await Promise.all(relatedData.rows.map(r => loadAssociations(r, include.include)));
    } else {
      result[as] = relatedData.rows;
    }
    
    if (result[as] && result[as].length === 0 && foreignKey !== 'projectId' && foreignKey !== 'areaId' && foreignKey !== 'sensorId') {
      result[as] = null;
    } else if (result[as] && foreignKey !== 'projectId' && foreignKey !== 'areaId' && foreignKey !== 'sensorId' && foreignKey !== 'alertId' && foreignKey !== 'recipientId' && foreignKey !== 'notificationId') {
      result[as] = result[as][0] || null;
    }
  }
  
  return result;
}

module.exports = {
  db,
  initDB,
  sync,
  authenticate,
  loadAssociations,
  Project,
  Area,
  Sensor,
  Alert,
  Recipient,
  NotificationRule,
  Notification,
  Receipt,
  Reminder
};
