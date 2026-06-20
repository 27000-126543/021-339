const { Model } = require('../config/database');

const Reminder = new Model('reminders');

module.exports = Reminder;
