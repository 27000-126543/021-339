const axios = require('axios');
require('dotenv').config();

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const API_KEY = process.env.API_KEY || 'alert_system_key_2024';

const axiosInstance = axios.create({
  baseURL: BASE_URL,
  headers: {
    'x-api-key': API_KEY,
    'Content-Type': 'application/json'
  },
  timeout: 10000
});

async function runTests() {
  console.log('='.repeat(60));
  console.log('高支模预警系统 API 测试');
  console.log('='.repeat(60));
  console.log(`测试地址: ${BASE_URL}`);
  console.log(`API Key: ${API_KEY.substring(0, 5)}...`);
  console.log('='.repeat(60));

  let projectId = null;
  let areaId = null;
  let sensorId = null;
  let alertId = null;
  let recipientId = null;
  let notificationId = null;

  try {
    console.log('\n📋 测试1: 健康检查');
    const healthResponse = await axiosInstance.get('/api/health');
    console.log(`✅ 健康检查通过 - 版本: ${healthResponse.data.data?.version || healthResponse.data.version}`);

    console.log('\n📋 测试2: 获取项目列表');
    const projectsResponse = await axiosInstance.get('/api/projects');
    if (projectsResponse.data.data?.list?.length > 0) {
      projectId = projectsResponse.data.data.list[0].id;
      console.log(`✅ 获取项目列表成功 - 项目数: ${projectsResponse.data.data.total}, 项目ID: ${projectId}`);
    } else {
      console.log('⚠️  项目列表为空，需要先初始化数据库');
    }

    if (projectId) {
      console.log('\n📋 测试3: 获取项目详情');
      const projectDetailResponse = await axiosInstance.get(`/api/projects/${projectId}`);
      const areas = projectDetailResponse.data.data.areas || [];
      const sensors = projectDetailResponse.data.data.sensors || [];
      const recipients = projectDetailResponse.data.data.recipients || [];
      
      if (areas.length > 0) areaId = areas[0].id;
      if (sensors.length > 0) sensorId = sensors[0].id;
      if (recipients.length > 0) recipientId = recipients[0].id;
      
      console.log(`✅ 获取项目详情成功 - 区域: ${areas.length}个, 传感器: ${sensors.length}个, 接收人: ${recipients.length}个`);
    }

    console.log('\n📋 测试4: 获取接收人列表');
    const recipientsResponse = await axiosInstance.get('/api/recipients', {
      params: { projectId }
    });
    console.log(`✅ 获取接收人列表成功 - 接收人数: ${recipientsResponse.data.data.total}`);
    if (!recipientId && recipientsResponse.data.data.list.length > 0) {
      recipientId = recipientsResponse.data.data.list[0].id;
    }

    console.log('\n📋 测试5: 获取通知规则列表');
    const rulesResponse = await axiosInstance.get('/api/notification-rules', {
      params: { projectId }
    });
    console.log(`✅ 获取通知规则成功 - 规则数: ${rulesResponse.data.data.total}`);

    console.log('\n📋 测试6: 接收沉降超限告警（一级告警场景）');
    console.log('   场景: 夜间浇筑期间，沉降值25mm超过阈值10mm，超限比例250%');
    const settlementAlertData = {
      eventType: 'settlement_exceed',
      projectId: projectId,
      areaId: areaId,
      sensorId: sensorId,
      sensorCode: 'SEN-SET-001',
      sensorType: 'settlement',
      currentValue: 25.5,
      thresholdValue: 10,
      unit: 'mm',
      location: 'A区核心筒3层西北立柱',
      description: '沉降监测值超过预警阈值，需立即关注',
      sourceSystem: 'monitoring_system',
      sourceEventId: 'MON-20240621-0001',
      occurTime: new Date().toISOString()
    };

    const settlementResponse = await axiosInstance.post('/api/alerts/receive', settlementAlertData);
    alertId = settlementResponse.data.data.alertId;
    console.log(`✅ 沉降告警接收成功`);
    console.log(`   告警编号: ${settlementResponse.data.data.alertCode}`);
    console.log(`   告警级别: ${settlementResponse.data.data.alertLevelName} (${settlementResponse.data.data.alertLevel})`);
    console.log(`   分级原因: ${settlementResponse.data.data.reasons?.join('; ') || '无'}`);

    console.log('\n📋 测试7: 接收位移突变告警');
    console.log('   场景: 夜间浇筑期间，位移值12mm超过阈值8mm，超限比例150%');
    const displacementAlertData = {
      eventType: 'displacement_sudden',
      projectId: projectId,
      areaId: areaId,
      sensorId: sensorId,
      currentValue: 12.3,
      thresholdValue: 8,
      unit: 'mm',
      sourceSystem: 'monitoring_system',
      occurTime: new Date().toISOString()
    };

    const displacementResponse = await axiosInstance.post('/api/alerts/receive', displacementAlertData);
    console.log(`✅ 位移告警接收成功`);
    console.log(`   告警级别: ${displacementResponse.data.data.alertLevelName}`);
    console.log(`   分级原因: ${displacementResponse.data.data.reasons?.join('; ') || '无'}`);

    console.log('\n📋 测试8: 接收传感器离线告警（提示类）');
    console.log('   场景: 非高风险区域传感器离线');
    const offlineAlertData = {
      eventType: 'sensor_offline',
      projectId: projectId,
      sourceSystem: 'monitoring_system',
      occurTime: new Date().toISOString()
    };

    const offlineResponse = await axiosInstance.post('/api/alerts/receive', offlineAlertData);
    console.log(`✅ 传感器离线告警接收成功`);
    console.log(`   告警级别: ${offlineResponse.data.data.alertLevelName}`);

    console.log('\n📋 测试9: 批量接收告警');
    const batchEvents = [
      {
        eventType: 'threshold_exceed',
        projectId: projectId,
        sensorId: sensorId,
        currentValue: 18,
        thresholdValue: 15,
        unit: 'mm',
        sourceSystem: 'monitoring_system',
        occurTime: new Date().toISOString()
      },
      {
        eventType: 'sensor_fault',
        projectId: projectId,
        sensorId: sensorId,
        sourceSystem: 'monitoring_system',
        occurTime: new Date().toISOString()
      }
    ];

    const batchResponse = await axiosInstance.post('/api/alerts/batch', { events: batchEvents });
    console.log(`✅ 批量告警接收成功 - 成功: ${batchResponse.data.data.successCount}, 失败: ${batchResponse.data.data.failCount}`);

    console.log('\n📋 测试10: 获取告警列表');
    const alertsResponse = await axiosInstance.get('/api/alerts', {
      params: {
        projectId,
        page: 1,
        pageSize: 10
      }
    });
    console.log(`✅ 获取告警列表成功 - 总数: ${alertsResponse.data.data.total}`);
    alertsResponse.data.data.list.forEach((alert, index) => {
      console.log(`   ${index + 1}. ${alert.alertLevelName} - ${alert.eventTypeName} - ${alert.alertCode}`);
    });

    if (alertId) {
      console.log('\n📋 测试11: 获取告警详情');
      const alertDetailResponse = await axiosInstance.get(`/api/alerts/${alertId}`);
      const notifications = alertDetailResponse.data.data.notifications || [];
      console.log(`✅ 获取告警详情成功 - 通知数: ${notifications.length}`);
      
      if (notifications.length > 0) {
        notificationId = notifications[0].id;
        console.log(`   通知示例: ${notifications[0].channelName} -> ${notifications[0].recipientName}`);
        console.log(`   通知状态: ${notifications[0].status}`);
        console.log(`   回执链接: ${notifications[0].receiptLink?.substring(0, 60)}...`);
      }
    }

    console.log('\n📋 测试12: 获取通知列表');
    const notificationsResponse = await axiosInstance.get('/api/notifications', {
      params: { alertId }
    });
    console.log(`✅ 获取通知列表成功 - 总数: ${notificationsResponse.data.data.total}`);

    if (alertId && recipientId) {
      console.log('\n📋 测试13: 提交回执 - 正在处理');
      const receiptData = {
        alertId: alertId,
        recipientId: recipientId,
        notificationId: notificationId,
        receiptType: 'processing',
        siteContact: '李现场',
        siteContactPhone: '13900139000',
        estimatedHandleTime: 30,
        remark: '已安排人员前往现场检查，预计30分钟到达'
      };

      const receiptResponse = await axiosInstance.post('/api/receipt/submit', receiptData);
      console.log(`✅ 回执提交成功`);
      console.log(`   回执类型: ${receiptResponse.data.data.receiptTypeName}`);
      console.log(`   告警状态更新为: ${receiptResponse.data.data.alertStatus}`);
      console.log(`   现场联系人: ${receiptData.siteContact} (${receiptData.siteContactPhone})`);

      console.log('\n📋 测试14: 提交回执 - 已知晓（第二个接收人）');
      const recipient2 = recipientsResponse.data.data.list[1];
      if (recipient2) {
        const receiptData2 = {
          alertId: alertId,
          recipientId: recipient2.id,
          receiptType: 'acknowledged',
          siteContact: '王主管',
          siteContactPhone: '13900139001',
          remark: '已知悉，正在跟进处理进展'
        };

        const receiptResponse2 = await axiosInstance.post('/api/receipt/submit', receiptData2);
        console.log(`✅ 第二份回执提交成功 - 类型: ${receiptResponse2.data.data.receiptTypeName}`);
      }
    }

    console.log('\n📋 测试15: 获取告警回执状态');
    const alertReceiptsResponse = await axiosInstance.get(`/api/receipt/alert/${alertId}`);
    const receiptStatus = alertReceiptsResponse.data.data.receiptStatus;
    console.log(`✅ 获取回执状态成功`);
    console.log(`   总通知数: ${receiptStatus.total}`);
    console.log(`   已回执: ${receiptStatus.acknowledged + receiptStatus.processing + receiptStatus.falseAlarm}`);
    console.log(`   待回执: ${receiptStatus.pending}`);
    console.log(`   已知晓: ${receiptStatus.acknowledged}, 处理中: ${receiptStatus.processing}, 误报: ${receiptStatus.falseAlarm}`);

    console.log('\n📋 测试16: 获取回执列表');
    const receiptListResponse = await axiosInstance.get('/api/receipt/list', {
      params: { alertId }
    });
    console.log(`✅ 获取回执列表成功 - 总数: ${receiptListResponse.data.data.total}`);
    receiptListResponse.data.data.list.forEach((receipt, index) => {
      console.log(`   ${index + 1}. ${receipt.recipientName} (${receipt.recipientRole}) - ${receipt.receiptTypeName}`);
    });

    console.log('\n📋 测试17: 获取回执统计');
    const statsResponse = await axiosInstance.get('/api/receipt/statistics/summary', {
      params: { projectId }
    });
    console.log(`✅ 获取回执统计成功`);
    console.log(`   总回执数: ${statsResponse.data.data.total}`);
    console.log(`   平均响应时间: ${statsResponse.data.data.avgResponseTime.toFixed(2)} 分钟`);
    console.log(`   按类型分布: 已知晓=${statsResponse.data.data.byType.acknowledged}, 处理中=${statsResponse.data.data.byType.processing}, 误报=${statsResponse.data.data.byType.false_alarm}`);

    console.log('\n📋 测试18: 更新项目浇筑状态');
    const pouringStatusResponse = await axiosInstance.post(`/api/projects/${projectId}/pouring-status`, {
      pouringStatus: 'pouring',
      isNightPouring: true
    });
    console.log(`✅ 浇筑状态更新成功 - 当前状态: ${pouringStatusResponse.data.data.pouringStatus}`);
    console.log(`   夜间浇筑: ${pouringStatusResponse.data.data.isNightPouring ? '是' : '否'}`);

    console.log('\n📋 测试19: 更新接收人值班状态');
    if (recipientId) {
      const dutyResponse = await axiosInstance.post(`/api/recipients/${recipientId}/duty`, {
        isOnDuty: true
      });
      console.log(`✅ 值班状态更新成功 - ${dutyResponse.data.data.name}: ${dutyResponse.data.data.isOnDuty ? '值班中' : '已下班'}`);
    }

    console.log('\n📋 测试20: 创建新的通知规则');
    const newRuleData = {
      ruleName: '自定义规则-紧急情况通知管理层',
      ruleType: 'project_level',
      projectId: projectId,
      alertLevel: 'level1',
      roles: ['project_manager', 'safety_officer'],
      channels: { sms: true, voice: true, wechat: true, email: true },
      priority: 200,
      description: '紧急情况时额外通知项目经理和安全员'
    };

    const newRuleResponse = await axiosInstance.post('/api/notification-rules', newRuleData);
    console.log(`✅ 通知规则创建成功 - 规则ID: ${newRuleResponse.data.data.id}`);
    console.log(`   规则名称: ${newRuleResponse.data.data.ruleName}`);

    console.log('\n' + '='.repeat(60));
    console.log('✅ 所有测试完成！');
    console.log('='.repeat(60));
    console.log('\n📊 测试总结:');
    console.log(`   项目ID: ${projectId}`);
    console.log(`   区域ID: ${areaId}`);
    console.log(`   传感器ID: ${sensorId}`);
    console.log(`   接收人ID: ${recipientId}`);
    console.log(`   告警ID: ${alertId}`);
    console.log(`   通知ID: ${notificationId}`);
    console.log('\n🔗 API基础地址: ' + BASE_URL);
    console.log('🔑 API Key: ' + API_KEY);
    console.log('\n📖 主要接口:');
    console.log('   POST /api/alerts/receive      - 接收告警');
    console.log('   POST /api/alerts/batch        - 批量接收告警');
    console.log('   GET  /api/alerts              - 查询告警列表');
    console.log('   GET  /api/alerts/:id          - 查询告警详情');
    console.log('   POST /api/receipt/submit      - 提交回执');
    console.log('   GET  /api/receipt/alert/:id   - 查询告警回执状态');
    console.log('   GET  /api/notifications       - 查询通知列表');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n❌ 测试失败');
    if (error.response) {
      console.error(`   状态码: ${error.response.status}`);
      console.error(`   错误信息: ${error.response.data?.message || error.message}`);
      console.error(`   错误代码: ${error.response.data?.code || 'UNKNOWN'}`);
      if (error.response.data?.details) {
        console.error(`   详细信息:`, error.response.data.details);
      }
    } else {
      console.error(`   错误: ${error.message}`);
    }
    console.error(`   堆栈: ${error.stack?.substring(0, 200)}...`);
    process.exit(1);
  }
}

runTests();
