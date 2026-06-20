function generateAlertCode(eventType, projectCode) {
  const now = new Date();
  const dateStr = now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, '0') +
    now.getDate().toString().padStart(2, '0');
  const timeStr = now.getHours().toString().padStart(2, '0') +
    now.getMinutes().toString().padStart(2, '0') +
    now.getSeconds().toString().padStart(2, '0');
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  
  const eventPrefix = {
    'settlement_exceed': 'SET',
    'displacement_sudden': 'DIS',
    'sensor_offline': 'OFF',
    'sensor_fault': 'FLT',
    'threshold_exceed': 'THR',
    'other': 'OTH'
  };
  
  const prefix = eventPrefix[eventType] || 'ALT';
  const projPrefix = projectCode ? projectCode.substring(0, 6).toUpperCase() : 'SYS';
  
  return `${prefix}-${projPrefix}-${dateStr}-${timeStr}-${random}`;
}

module.exports = { generateAlertCode };
