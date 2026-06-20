const { initDB } = require('../src/models');
const {
  Project,
  Area,
  Sensor,
  Recipient,
  NotificationRule,
  Notification,
  Receipt,
  Alert
} = require('../src/models');
const logger = require('../src/config/logger');

async function initDatabase() {
  logger.info('开始初始化数据库...');

  try {
    await initDB();
    logger.info('数据库连接成功');
    
    const { db } = require('../src/config/database');
    await db.read();
    db.data.projects = [];
    db.data.areas = [];
    db.data.sensors = [];
    db.data.recipients = [];
    db.data.notificationRules = [];
    db.data.notifications = [];
    db.data.receipts = [];
    db.data.alerts = [];
    await db.write();
    logger.info('数据库数据清理完成');

    const project = await Project.create({
      projectCode: 'GZM-2024-001',
      projectName: '广州某大型商业综合体项目',
      address: '广州市天河区珠江新城',
      generalContractor: '中建某局集团有限公司',
      supervisor: '广东某监理有限公司',
      status: 'active',
      pouringStatus: 'pouring',
      isNightPouring: true,
      pouringStartTime: new Date('2024-06-20T22:00:00'),
      remarks: '核心筒高支模区域，夜间浇筑作业中',
      createdBy: 'system'
    });
    logger.info(`创建项目: ${project.projectName}`);

    const area1 = await Area.create({
      areaCode: 'AREA-A-001',
      areaName: 'A区核心筒高支模',
      projectId: project.id,
      floor: '3-5层',
      riskLevel: 'critical',
      pouringStatus: 'pouring',
      isNightPouring: true,
      pouringStartTime: new Date('2024-06-20T22:00:00'),
      description: '核心筒高支模区域，高度12米，跨度18米'
    });

    const area2 = await Area.create({
      areaCode: 'AREA-B-001',
      areaName: 'B区裙楼高支模',
      projectId: project.id,
      floor: '2-3层',
      riskLevel: 'high',
      pouringStatus: 'not_started',
      description: '裙楼高支模区域，高度8米'
    });
    logger.info('创建2个区域');

    const sensor1 = await Sensor.create({
      sensorCode: 'SEN-SET-001',
      sensorName: 'A区沉降传感器1号',
      sensorType: 'settlement',
      areaId: area1.id,
      projectId: project.id,
      installLocation: 'A区核心筒3层西北立柱',
      status: 'online',
      warningThreshold: 10,
      alarmThreshold: 20,
      unit: 'mm',
      manufacturer: '某监测设备厂商',
      installDate: new Date('2024-06-01')
    });

    const sensor2 = await Sensor.create({
      sensorCode: 'SEN-DIS-001',
      sensorName: 'A区位移传感器1号',
      sensorType: 'displacement',
      areaId: area1.id,
      projectId: project.id,
      installLocation: 'A区核心筒3层主梁',
      status: 'online',
      warningThreshold: 8,
      alarmThreshold: 15,
      unit: 'mm',
      manufacturer: '某监测设备厂商',
      installDate: new Date('2024-06-01')
    });

    const sensor3 = await Sensor.create({
      sensorCode: 'SEN-SET-002',
      sensorName: 'B区沉降传感器1号',
      sensorType: 'settlement',
      areaId: area2.id,
      projectId: project.id,
      installLocation: 'B区裙楼2层立柱',
      status: 'online',
      warningThreshold: 10,
      alarmThreshold: 20,
      unit: 'mm',
      manufacturer: '某监测设备厂商',
      installDate: new Date('2024-06-05')
    });

    const sensor4 = await Sensor.create({
      sensorCode: 'SEN-INC-001',
      sensorName: 'A区倾角传感器1号',
      sensorType: 'inclination',
      areaId: area1.id,
      projectId: project.id,
      installLocation: 'A区核心筒3层立杆',
      status: 'online',
      warningThreshold: 0.5,
      alarmThreshold: 1.0,
      unit: '°',
      manufacturer: '某监测设备厂商',
      installDate: new Date('2024-06-01')
    });
    logger.info('创建4个传感器');

    const recipientsData = [
      {
        name: '张总包',
        phone: '13800138001',
        role: 'general_contractor',
        company: '中建某局集团有限公司',
        position: '项目总工',
        isOnDuty: true,
        notificationChannels: { sms: true, voice: true, wechat: true, email: false }
      },
      {
        name: '李监理',
        phone: '13800138002',
        role: 'supervisor',
        company: '广东某监理有限公司',
        position: '总监代表',
        isOnDuty: true,
        notificationChannels: { sms: true, voice: true, wechat: true, email: false }
      },
      {
        name: '王工头',
        phone: '13800138003',
        role: 'labor_team',
        company: '某劳务有限公司',
        position: '劳务班组长',
        isOnDuty: true,
        notificationChannels: { sms: true, voice: true, wechat: true, email: false }
      },
      {
        name: '刘经理',
        phone: '13800138004',
        role: 'project_manager',
        company: '中建某局集团有限公司',
        position: '项目经理',
        isOnDuty: false,
        notificationChannels: { sms: true, voice: true, wechat: true, email: true }
      },
      {
        name: '陈安全',
        phone: '13800138005',
        role: 'safety_officer',
        company: '中建某局集团有限公司',
        position: '安全总监',
        isOnDuty: true,
        notificationChannels: { sms: true, voice: true, wechat: true, email: false }
      },
      {
        name: '赵运维',
        phone: '13800138006',
        role: 'device_admin',
        company: '某科技有限公司',
        position: '设备管理员',
        isOnDuty: true,
        notificationChannels: { sms: false, voice: false, wechat: true, email: false }
      },
      {
        name: '孙值班',
        phone: '13800138007',
        role: 'duty_officer',
        company: '中建某局集团有限公司',
        position: '夜间值班员',
        isOnDuty: true,
        notificationChannels: { sms: true, voice: true, wechat: true, email: false }
      }
    ];

    for (const r of recipientsData) {
      await Recipient.create({
        ...r,
        projectId: project.id,
        isEnabled: true,
        roleName: {
          'general_contractor': '总包',
          'supervisor': '监理',
          'labor_team': '劳务班组',
          'project_manager': '项目经理',
          'safety_officer': '安全员',
          'device_admin': '设备管理员',
          'duty_officer': '值班员'
        }[r.role]
      });
    }
    logger.info('创建7个接收人');

    const defaultRules = [
      {
        ruleName: '一级告警-全员紧急通知',
        alertLevel: 'level1',
        alertLevelName: '一级告警',
        roles: ['general_contractor', 'supervisor', 'labor_team', 'project_manager', 'safety_officer', 'duty_officer'],
        channels: { sms: true, voice: true, wechat: true, email: false },
        priority: 100,
        description: '一级告警：电话语音+短信+企业群，通知所有相关人员'
      },
      {
        ruleName: '二级告警-总包监理安全员',
        alertLevel: 'level2',
        alertLevelName: '二级告警',
        roles: ['general_contractor', 'supervisor', 'safety_officer', 'duty_officer'],
        channels: { sms: true, voice: false, wechat: true, email: false },
        priority: 50,
        description: '二级告警：短信+企业群，通知总包、监理、安全员、值班员'
      },
      {
        ruleName: '提示类告警-仅设备管理员',
        alertLevel: 'notice',
        alertLevelName: '提示类告警',
        roles: ['device_admin'],
        channels: { sms: false, voice: false, wechat: true, email: false },
        priority: 10,
        description: '提示类告警：仅企业群通知设备管理员'
      }
    ];

    for (const rule of defaultRules) {
      await NotificationRule.create({
        ...rule,
        ruleType: 'project_level',
        projectId: project.id,
        escalationRules: {
          enabled: rule.alertLevel === 'level1',
          firstInterval: 10,
          secondInterval: 20,
          maxEscalations: 3,
          escalateToRoles: ['project_manager', 'safety_officer']
        },
        timeRules: {
          workHours: { start: '08:00', end: '18:00' },
          nightHours: { start: '18:00', end: '08:00' },
          nightEnhancement: rule.alertLevel === 'level1'
        },
        isEnabled: true,
        createdBy: 'system'
      });
    }
    logger.info('创建3条默认通知规则');

    logger.info('='.repeat(50));
    logger.info('数据库初始化完成！');
    logger.info('='.repeat(50));
    logger.info(`项目ID: ${project.id}`);
    logger.info(`项目编码: ${project.projectCode}`);
    logger.info(`API Key: alert_system_key_2024`);
    logger.info('='.repeat(50));

    process.exit(0);
  } catch (error) {
    logger.error('数据库初始化失败', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

initDatabase();
