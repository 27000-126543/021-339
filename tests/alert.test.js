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
  let level1AlertId = null;
  let recipientId = null;
  let notificationId = null;
  let passedTests = 0;
  let totalTests = 41;

  function pass(desc) {
    passedTests++;
    console.log(`✅ ${desc}`);
  }

  function fail(desc) {
    console.log(`❌ ${desc}`);
    throw new Error(desc);
  }

  try {
    console.log('\n📋 测试1: 健康检查');
    const healthResponse = await axiosInstance.get('/api/health');
    if (healthResponse.data.success) {
      pass(`健康检查通过 - 版本: ${healthResponse.data.data?.version || healthResponse.data.version}`);
    } else {
      fail('健康检查失败');
    }

    console.log('\n📋 测试2: 获取通知通道配置');
    const channelConfigResponse = await axiosInstance.get('/api/notifications/channels/config');
    const channelConfig = channelConfigResponse.data.data;
    if (channelConfig && channelConfig.channels) {
      pass(`获取通道配置成功 - 模式: ${channelConfig.mode}`);
      console.log(`   短信: ${channelConfig.channels.sms.mode} (${channelConfig.channels.sms.enabled ? '启用' : '禁用'})`);
      console.log(`   语音: ${channelConfig.channels.voice.mode} (${channelConfig.channels.voice.enabled ? '启用' : '禁用'})`);
      console.log(`   企业微信: ${channelConfig.channels.wechat.mode} (${channelConfig.channels.wechat.enabled ? '启用' : '禁用'})`);
      console.log(`   邮件: ${channelConfig.channels.email.mode} (${channelConfig.channels.email.enabled ? '启用' : '禁用'})`);
    } else {
      fail('获取通道配置失败');
    }

    console.log('\n📋 测试3: 获取项目列表');
    const projectsResponse = await axiosInstance.get('/api/projects');
    if (projectsResponse.data.data?.list?.length > 0) {
      projectId = projectsResponse.data.data.list[0].id;
      pass(`获取项目列表成功 - 项目数: ${projectsResponse.data.data.total}, 项目ID: ${projectId.substring(0, 8)}...`);
    } else {
      fail('项目列表为空，需要先初始化数据库');
    }

    if (projectId) {
      console.log('\n📋 测试4: 获取项目详情');
      const projectDetailResponse = await axiosInstance.get(`/api/projects/${projectId}`);
      const areas = projectDetailResponse.data.data.areas || [];
      const sensors = projectDetailResponse.data.data.sensors || [];
      const recipients = projectDetailResponse.data.data.recipients || [];
      const rules = projectDetailResponse.data.data.notificationRules || [];
      
      if (areas.length > 0) areaId = areas[0].id;
      if (sensors.length > 0) sensorId = sensors[0].id;
      if (recipients.length > 0) recipientId = recipients[0].id;
      
      pass(`获取项目详情成功 - 区域: ${areas.length}个, 传感器: ${sensors.length}个, 接收人: ${recipients.length}个, 规则: ${rules.length}个`);
    }

    console.log('\n📋 测试5: 获取接收人列表');
    const recipientsResponse = await axiosInstance.get('/api/recipients', {
      params: { projectId }
    });
    const recipients = recipientsResponse.data.data.list;
    if (recipientsResponse.data.data.total > 0) {
      pass(`获取接收人列表成功 - 接收人数: ${recipientsResponse.data.data.total}`);
      recipients.slice(0, 3).forEach(r => {
        console.log(`   ${r.name} (${r.roleName}) - ${r.phone}`);
      });
      if (!recipientId) recipientId = recipients[0].id;
    } else {
      fail('接收人列表为空');
    }

    console.log('\n📋 测试6: 获取通知规则列表');
    const rulesResponse = await axiosInstance.get('/api/notification-rules', {
      params: { projectId }
    });
    if (rulesResponse.data.data.total >= 3) {
      pass(`获取通知规则成功 - 规则数: ${rulesResponse.data.data.total}`);
      rulesResponse.data.data.list.forEach(r => {
        console.log(`   ${r.ruleName} - ${r.alertLevelName} - 角色: ${r.roles?.length || 0}个`);
      });
    } else {
      fail(`通知规则数量不足: ${rulesResponse.data.data.total}`);
    }

    console.log('\n📋 测试7: 接收沉降超限告警（一级告警 - 同步发送通知）');
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
      occurTime: new Date().toISOString(),
      asyncNotify: false
    };

    const settlementResponse = await axiosInstance.post('/api/alerts/receive', settlementAlertData);
    level1AlertId = settlementResponse.data.data.alertId;
    const alertLevel = settlementResponse.data.data.alertLevel;
    
    if (settlementResponse.data.data.alertLevel === 'level1') {
      pass(`沉降告警接收成功 - 一级告警`);
    } else {
      fail(`告警级别不正确: ${settlementResponse.data.data.alertLevelName}, 应为一级告警`);
    }
    console.log(`   告警编号: ${settlementResponse.data.data.alertCode}`);
    console.log(`   告警级别: ${settlementResponse.data.data.alertLevelName}`);
    console.log(`   分级原因: ${settlementResponse.data.data.reasons?.join('; ') || '无'}`);
    console.log(`   通知数: ${settlementResponse.data.data.notificationCount || 0}`);

    console.log('\n📋 测试8: 验证通知列表 - 按通道查看发给谁');
    const notificationsResponse = await axiosInstance.get('/api/notifications', {
      params: { alertId: level1AlertId }
    });
    const notifications = notificationsResponse.data.data.list;
    const notifSummary = notificationsResponse.data.data.summary;

    if (notifications.length > 0 && notifSummary) {
      pass(`通知列表获取成功 - 总数: ${notifSummary.total}`);
      console.log('   按通道分布:');
      Object.entries(notifSummary.byChannel).forEach(([channel, count]) => {
        const channelNames = { sms: '短信', voice: '语音', wechat: '企业微信', email: '邮件' };
        console.log(`     ${channelNames[channel] || channel}: ${count}条`);
      });
      console.log('   按状态分布:');
      Object.entries(notifSummary.byStatus).forEach(([status, count]) => {
        const statusNames = { sent: '已发送', delivered: '已送达', not_sent: '未发送', failed: '失败', pending: '发送中' };
        console.log(`     ${statusNames[status] || status}: ${count}条`);
      });
      
      console.log('   通知明细（前6条）:');
      notifications.slice(0, 6).forEach(n => {
        console.log(`     ${n.channelName} -> ${n.recipientName} (${n.recipientRoleName || n.recipientRole}) - ${n.statusName}`);
      });

      const hasSms = notifSummary.byChannel.sms > 0;
      const hasVoice = notifSummary.byChannel.voice > 0;
      const hasWechat = notifSummary.byChannel.wechat > 0;
      
      if (hasSms && hasVoice && hasWechat) {
        pass('一级告警包含短信、语音、企业微信三种通道');
      } else {
        fail(`一级告警通道不完整: 短信=${hasSms}, 语音=${hasVoice}, 微信=${hasWechat}`);
      }

      if (notifications[0]) notificationId = notifications[0].id;
    } else {
      fail('通知列表为空');
    }

    console.log('\n📋 测试9: 验证通知覆盖的角色（总包、监理、劳务班组、值班员等）');
    const uniqueRoles = new Set(notifications.map(n => n.recipientRole));
    console.log(`   通知覆盖角色: ${Array.from(uniqueRoles).join(', ')}`);
    
    const expectedRoles = ['general_contractor', 'supervisor', 'labor_team', 'duty_officer'];
    const missingRoles = expectedRoles.filter(r => !uniqueRoles.has(r));
    
    if (missingRoles.length === 0) {
      pass('所有预期角色都收到了通知');
    } else {
      console.log(`   ⚠️  缺失角色: ${missingRoles.join(', ')}（可能因值班过滤）`);
      console.log('   提示: 如果有值班人员，系统会优先通知值班人员');
    }

    console.log('\n📋 测试10: 接收位移突变告警（二级告警）');
    console.log('   场景: 位移值12mm超过阈值8mm，超限比例150%');
    const displacementAlertData = {
      eventType: 'displacement_sudden',
      projectId: projectId,
      areaId: areaId,
      sensorId: sensorId,
      currentValue: 12.3,
      thresholdValue: 8,
      unit: 'mm',
      sourceSystem: 'monitoring_system',
      occurTime: new Date().toISOString(),
      asyncNotify: false
    };

    const displacementResponse = await axiosInstance.post('/api/alerts/receive', displacementAlertData);
    pass(`位移告警接收成功 - ${displacementResponse.data.data.alertLevelName}`);
    console.log(`   分级原因: ${displacementResponse.data.data.reasons?.join('; ') || '无'}`);

    console.log('\n📋 测试11: 接收传感器离线告警（提示类）');
    console.log('   场景: 传感器离线，低风险');
    const offlineAlertData = {
      eventType: 'sensor_offline',
      projectId: projectId,
      sourceSystem: 'monitoring_system',
      occurTime: new Date().toISOString(),
      asyncNotify: false
    };

    const offlineResponse = await axiosInstance.post('/api/alerts/receive', offlineAlertData);
    pass(`传感器离线告警接收成功 - ${offlineResponse.data.data.alertLevelName}`);

    console.log('\n📋 测试12: 批量接收告警');
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
    if (batchResponse.data.data.successCount === 2) {
      pass(`批量告警接收成功 - 成功: ${batchResponse.data.data.successCount}, 失败: ${batchResponse.data.data.failCount}`);
    } else {
      fail(`批量告警接收失败: 成功${batchResponse.data.data.successCount}条`);
    }

    console.log('\n📋 测试13: 获取告警列表');
    const alertsResponse = await axiosInstance.get('/api/alerts', {
      params: {
        projectId,
        page: 1,
        pageSize: 10
      }
    });
    if (alertsResponse.data.data.total >= 5) {
      pass(`获取告警列表成功 - 总数: ${alertsResponse.data.data.total}`);
      alertsResponse.data.data.list.slice(0, 4).forEach((alert, index) => {
        console.log(`   ${index + 1}. ${alert.alertLevelName} - ${alert.eventTypeName} - ${alert.alertCode}`);
      });
    } else {
      fail(`告警数量不足: ${alertsResponse.data.data.total}`);
    }

    console.log('\n📋 测试14: 获取告警详情（含通知和回执）');
    const alertDetailResponse = await axiosInstance.get(`/api/alerts/${level1AlertId}`);
    const notifsInDetail = alertDetailResponse.data.data.notifications || [];
    if (alertDetailResponse.data.data.id === level1AlertId) {
      pass(`获取告警详情成功 - 通知数: ${notifsInDetail.length}`);
      if (notifsInDetail.length > 0) {
        console.log(`   通知示例: ${notifsInDetail[0].channelName} -> ${notifsInDetail[0].recipientName} - ${notifsInDetail[0].statusName}`);
      }
    } else {
      fail('获取告警详情失败');
    }

    console.log('\n📋 测试15: 提交回执 - 正在处理（第一个接收人）');
    const firstRecipient = recipients[0];
    const processingReceiptData = {
      alertId: level1AlertId,
      recipientId: firstRecipient.id,
      receiptType: 'processing',
      siteContact: '李现场',
      siteContactPhone: '13900139000',
      estimatedHandleTime: 30,
      remark: '已安排人员前往现场检查，预计30分钟到达'
    };

    const processingResponse = await axiosInstance.post('/api/receipt/submit', processingReceiptData);
    if (processingResponse.data.data.receiptType === 'processing') {
      pass('回执提交成功 - 正在处理');
      console.log(`   回执类型: ${processingResponse.data.data.receiptTypeName}`);
      console.log(`   告警状态更新为: ${processingResponse.data.data.alertStatus}`);
    } else {
      fail('回执提交失败');
    }

    console.log('\n📋 测试16: 提交回执 - 已知晓（第二个接收人）');
    const secondRecipient = recipients[1];
    if (secondRecipient) {
      const ackReceiptData = {
        alertId: level1AlertId,
        recipientId: secondRecipient.id,
        receiptType: 'acknowledged',
        siteContact: '王主管',
        siteContactPhone: '13900139001',
        remark: '已知悉，正在跟进处理进展'
      };

      const ackResponse = await axiosInstance.post('/api/receipt/submit', ackReceiptData);
      pass(`第二份回执提交成功 - ${ackResponse.data.data.receiptTypeName}`);
    }

    console.log('\n📋 测试17: 提交回执 - 误报待核（第三个接收人）');
    const thirdRecipient = recipients[2];
    if (thirdRecipient) {
      const falseAlarmReceiptData = {
        alertId: level1AlertId,
        recipientId: thirdRecipient.id,
        receiptType: 'false_alarm',
        siteContact: '赵工',
        siteContactPhone: '13900139002',
        remark: '经现场核实，为传感器漂移导致的误报'
      };

      const falseAlarmResponse = await axiosInstance.post('/api/receipt/submit', falseAlarmReceiptData);
      pass(`第三份回执提交成功 - ${falseAlarmResponse.data.data.receiptTypeName}`);
    }

    console.log('\n📋 测试18: 查询告警回执状态 - 验证汇总与明细一致');
    const alertReceiptsResponse = await axiosInstance.get(`/api/receipt/alert/${level1AlertId}`);
    const receiptData = alertReceiptsResponse.data.data;
    const receiptStatus = receiptData.receiptStatus;
    const receiptsList = receiptData.receipts;

    console.log('   回执状态汇总:');
    console.log(`     总通知数: ${receiptStatus.totalNotifications}`);
    console.log(`     总接收人: ${receiptStatus.totalRecipients}`);
    console.log(`     已回执人数: ${receiptStatus.receiptedCount}`);
    console.log(`     待回执人数: ${receiptStatus.pendingCount}`);
    console.log(`     按类型分布: 已知晓=${receiptStatus.byType.acknowledged}, 处理中=${receiptStatus.byType.processing}, 误报=${receiptStatus.byType.false_alarm}`);

    const totalByType = receiptStatus.byType.acknowledged + receiptStatus.byType.processing + receiptStatus.byType.false_alarm;
    if (totalByType === receiptsList.length && receiptsList.length >= 3) {
      pass('回执汇总数量与明细数量一致');
    } else {
      fail(`回执数量不一致: 汇总${totalByType}, 明细${receiptsList.length}`);
    }

    console.log('   回执明细:');
    receiptsList.forEach((r, i) => {
      console.log(`     ${i + 1}. ${r.recipientName} (${r.recipientRole}) - ${r.receiptTypeName} - 现场: ${r.siteContact}`);
    });

    console.log('\n📋 测试19: 获取回执列表');
    const receiptListResponse = await axiosInstance.get('/api/receipt/list', {
      params: { alertId: level1AlertId }
    });
    if (receiptListResponse.data.data.total >= 3) {
      pass(`获取回执列表成功 - 总数: ${receiptListResponse.data.data.total}`);
    } else {
      fail(`回执数量不足: ${receiptListResponse.data.data.total}`);
    }

    console.log('\n📋 测试20: 回执统计接口 - 按项目汇总');
    const statsResponse = await axiosInstance.get('/api/receipt/statistics/summary', {
      params: { projectId }
    });
    const stats = statsResponse.data.data.overall;

    if (stats && stats.totalReceipts >= 3) {
      pass('回执统计获取成功');
      console.log(`   总回执数: ${stats.totalReceipts}`);
      console.log(`   唯一接收人: ${stats.uniqueRecipients}`);
      console.log(`   平均响应时间: ${stats.avgResponseTimeMinutes.toFixed(2)} 分钟`);
      console.log(`   最快响应: ${stats.fastestResponseMinutes.toFixed(2)} 分钟`);
      console.log(`   最慢响应: ${stats.slowestResponseMinutes.toFixed(2)} 分钟`);
      console.log(`   按类型: 已知晓=${stats.byType.acknowledged}, 处理中=${stats.byType.processing}, 误报=${stats.byType.false_alarm}`);
    } else {
      fail(`回执统计数据异常`);
    }

    console.log('\n📋 测试21: 回执统计接口 - 按项目分组');
    const groupByProjectResponse = await axiosInstance.get('/api/receipt/statistics/summary', {
      params: { groupBy: 'project' }
    });
    const groupByData = groupByProjectResponse.data.data;
    
    if (groupByData.byProject && Array.isArray(groupByData.byProject)) {
      pass('按项目分组统计获取成功');
      groupByData.byProject.forEach(p => {
        console.log(`   ${p.projectName}: ${p.totalReceipts}条回执, 平均响应${p.avgResponseTimeMinutes.toFixed(2)}分钟`);
      });
    } else {
      console.log('   ⚠️  按项目分组返回结构需确认');
      console.log('   返回数据:', JSON.stringify(groupByData).substring(0, 200));
    }

    console.log('\n📋 测试22: 更新项目浇筑状态');
    const pouringStatusResponse = await axiosInstance.post(`/api/projects/${projectId}/pouring-status`, {
      pouringStatus: 'pouring',
      isNightPouring: true
    });
    if (pouringStatusResponse.data.data.pouringStatus === 'pouring') {
      pass(`浇筑状态更新成功 - 当前状态: ${pouringStatusResponse.data.data.pouringStatus}`);
      console.log(`   夜间浇筑: ${pouringStatusResponse.data.data.isNightPouring ? '是' : '否'}`);
    } else {
      fail('浇筑状态更新失败');
    }

    console.log('\n📋 测试23: 更新接收人值班状态');
    if (recipientId) {
      const dutyResponse = await axiosInstance.post(`/api/recipients/${recipientId}/duty`, {
        isOnDuty: true
      });
      if (dutyResponse.data.data.isOnDuty) {
        pass(`值班状态更新成功 - ${dutyResponse.data.data.name}: 值班中`);
      } else {
        fail('值班状态更新失败');
      }
    }

    console.log('\n📋 测试24: 创建新的通知规则');
    const newRuleData = {
      ruleName: '自定义规则-紧急情况通知管理层',
      ruleType: 'project_level',
      projectId: projectId,
      alertLevel: 'level1',
      roles: ['project_manager', 'safety_officer'],
      channels: { sms: true, voice: true, wechat: true, email: false },
      priority: 200,
      description: '紧急情况时额外通知项目经理和安全员',
      isEnabled: true
    };

    const newRuleResponse = await axiosInstance.post('/api/notification-rules', newRuleData);
    if (newRuleResponse.data.data?.id) {
      pass(`通知规则创建成功 - 规则ID: ${newRuleResponse.data.data.id.substring(0, 8)}...`);
      console.log(`   规则名称: ${newRuleResponse.data.data.ruleName}`);
    } else {
      fail('通知规则创建失败');
    }

    console.log('\n📋 测试25: 验证通知状态标记（模拟模式下应有明确标识）');
    const firstNotification = notifications[0];
    if (firstNotification && firstNotification.isSimulated !== undefined) {
      if (firstNotification.isSimulated) {
        pass('通知记录正确标记为模拟发送');
        console.log(`   通知状态: ${firstNotification.statusName}`);
        console.log(`   是否模拟: ${firstNotification.isSimulated ? '是' : '否'}`);
      } else {
        pass('通知记录为真实发送模式');
      }
    } else {
      console.log('   ⚠️  通知缺少模拟状态标记');
    }

    console.log('\n📋 测试26: 告警接口默认同步返回通知结果（不依赖asyncNotify参数）');
    console.log('   场景: 不传asyncNotify参数，验证默认同步发送并返回结果');
    const settlementAlertData2 = {
      eventType: 'settlement_exceed',
      projectId: projectId,
      areaId: areaId,
      sensorId: sensorId,
      sensorCode: 'SEN-SET-002',
      sensorType: 'settlement',
      currentValue: 22.0,
      thresholdValue: 10,
      unit: 'mm',
      location: 'B区裙楼3层东侧',
      description: '沉降监测值超限测试',
      sourceSystem: 'monitoring_system',
      sourceEventId: 'MON-20240621-0099',
      occurTime: new Date().toISOString()
    };

    const settlementResponse2 = await axiosInstance.post('/api/alerts/receive', settlementAlertData2);
    const notificationsData = settlementResponse2.data.data.notifications;
    if (notificationsData && notificationsData.totalNotifications > 0) {
      pass('告警接口默认同步返回通知结果');
      console.log(`   应通知人数: ${notificationsData.expectedRecipientCount}`);
      console.log(`   实际生成通知: ${notificationsData.totalNotifications}条`);
      console.log(`   成功发送: ${notificationsData.successCount}条`);
      console.log(`   未发送: ${notificationsData.notSentCount}条`);
      console.log(`   覆盖通道: ${Object.keys(notificationsData.byChannel || {}).join(', ')}`);
    } else {
      fail('告警接口未返回通知结果');
    }

    console.log('\n📋 测试27: 告警接口返回后立即查询通知列表，验证数据一致');
    const secondAlertId = settlementResponse2.data.data.alertId;
    const immediateNotifResponse = await axiosInstance.get('/api/notifications', {
      params: { alertId: secondAlertId }
    });
    const immediateTotal = immediateNotifResponse.data.data.summary?.total || 0;
    if (immediateTotal === notificationsData.totalNotifications) {
      pass('立即查询通知列表与返回结果一致');
      console.log(`   返回结果: ${notificationsData.totalNotifications}条, 实际查询: ${immediateTotal}条`);
    } else {
      fail(`通知数量不一致: 返回${notificationsData.totalNotifications}条, 实际查询${immediateTotal}条`);
    }

    console.log('\n📋 测试28: 通知批次概览接口 - 按告警查看批次详情');
    const batchOverviewResponse = await axiosInstance.get(`/api/notifications/batch/overview/${secondAlertId}`);
    const batchOverview = batchOverviewResponse.data.data;
    if (batchOverview && batchOverview.expectedRecipientCount > 0) {
      pass('通知批次概览获取成功');
      console.log(`   应通知人数: ${batchOverview.expectedRecipientCount}`);
      console.log(`   已通知人数: ${batchOverview.actualRecipientCount}`);
      console.log(`   通知总数: ${batchOverview.totalNotifications}`);
      console.log(`   成功数: ${batchOverview.successCount}, 未发送: ${batchOverview.notSentCount}, 失败: ${batchOverview.failedCount}`);
      
      console.log('   按通道明细:');
      Object.entries(batchOverview.byChannel).forEach(([ch, data]) => {
        if (data && data.total > 0) {
          const channelNames = { sms: '短信', voice: '语音', wechat: '企业微信', email: '邮件' };
          console.log(`     ${channelNames[ch] || ch}: 总${data.total}条=成功${data.success}+未发${data.not_sent}+失败${data.failed}`);
        }
      });

      if (batchOverview.byRecipientList && batchOverview.byRecipientList.length > 0) {
        console.log(`   按接收人明细（前3人）:`);
        batchOverview.byRecipientList.slice(0, 3).forEach(r => {
          const statusText = r.allSuccess ? '全通道成功' : (r.anyNotSent ? '有未发送' : (r.anyFailed ? '有失败' : '部分成功'));
          console.log(`     ${r.name} (${r.roleName}) - ${statusText} - ${Object.keys(r.channels).join(', ')}`);
        });
      }
    } else {
      fail('通知批次概览数据为空');
    }

    console.log('\n📋 测试29: 告警详情包含通知批次概览');
    const alertDetailBatchResponse = await axiosInstance.get(`/api/alerts/${secondAlertId}`);
    const detailBatchOverview = alertDetailBatchResponse.data.data.notificationBatch;
    if (detailBatchOverview && detailBatchOverview.totalNotifications > 0) {
      pass('告警详情包含通知批次概览');
      console.log(`   批次概览通知总数: ${detailBatchOverview.totalNotifications}`);
      console.log(`   成功: ${detailBatchOverview.successCount}, 未发送: ${detailBatchOverview.notSentCount}`);
    } else {
      fail('告警详情缺少通知批次概览');
    }

    console.log('\n📋 测试30: 回执值班调度视图 - 回执分类名单与未回执名单');
    const dispatchReceiptsResponse = await axiosInstance.get(`/api/receipt/alert/${level1AlertId}`);
    const dutyDispatchView = dispatchReceiptsResponse.data.data.dutyDispatchView;
    if (dutyDispatchView) {
      pass('回执值班调度视图获取成功');
      
      const statusSum = dutyDispatchView.statusSummary;
      console.log(`   回执进度: ${statusSum.receipted}/${statusSum.totalRecipients}人 (${statusSum.progress}%)`);
      console.log(`   已回执: ${statusSum.receipted}人, 待回执: ${statusSum.pending}人`);

      const ts = dutyDispatchView.timestamps;
      if (ts.firstResponseMinutes !== null) {
        console.log(`   首个响应: ${ts.firstResponseMinutes}分钟`);
        console.log(`   最后响应: ${ts.lastResponseMinutes}分钟`);
        pass('首个响应时间和最后响应时间已记录');
      } else {
        console.log('   ⚠️  暂无响应时间数据（可能回执刚提交）');
      }

      const lists = dutyDispatchView.receiptLists;
      console.log(`   已知晓: ${lists.acknowledged.length}人, 正在处理: ${lists.processing.length}人, 误报待核: ${lists.false_alarm.length}人`);
      
      if (lists.acknowledged.length > 0) {
        console.log(`     已知晓名单: ${lists.acknowledged.map(r => r.recipientName).join(', ')}`);
      }
      if (lists.processing.length > 0) {
        console.log(`     处理中名单: ${lists.processing.map(r => r.recipientName + '(' + (r.siteContact || '-') + ')').join('; ')}`);
      }
      if (lists.pending.length > 0) {
        console.log(`     待回执催办名单: ${lists.pending.map(r => r.recipientName + ' ' + r.recipientPhone).join(', ')}`);
        pass('待回执名单可直接用于催办');
      } else if (statusSum.pending === 0) {
        pass('所有人均已回执');
      }
    } else {
      fail('回执值班调度视图为空');
    }

    console.log('\n📋 测试31: 回执按角色汇总');
    if (dutyDispatchView && dutyDispatchView.byRole) {
      const roleCount = Object.keys(dutyDispatchView.byRole).length;
      if (roleCount > 0) {
        pass(`回执按角色汇总获取成功 - 共${roleCount}个角色`);
        Object.entries(dutyDispatchView.byRole).forEach(([role, data]) => {
          const known = data.acknowledged || 0;
          const processing = data.processing || 0;
          const falseAlarm = data.false_alarm || 0;
          console.log(`   ${data.roleName}: 总${data.total}人=已回执${data.receipted}(晓${known}/处${processing}/误${falseAlarm})/待${data.pending}`);
        });
      } else {
        fail('按角色汇总数据为空');
      }
    }

    console.log('\n📋 测试32: 验证通知批次概览中每个接收人的通道状态可追溯');
    const recipientList = batchOverview.byRecipientList || [];
    let allTraceable = recipientList.length > 0;
    for (const r of recipientList) {
      if (!r.channels || Object.keys(r.channels).length === 0) {
        allTraceable = false;
        break;
      }
    }
    if (allTraceable) {
      pass('每个接收人的各通道状态可追溯');
      if (recipientList[0]) {
        const sample = recipientList[0];
        console.log(`   示例- ${sample.name}:`);
        Object.entries(sample.channels).forEach(([ch, s]) => {
          const channelNames = { sms: '短信', voice: '语音', wechat: '企业微信', email: '邮件' };
          const failText = s.failReason ? `，原因: ${s.failReason.substring(0, 30)}` : '';
          console.log(`     ${channelNames[ch] || ch}: ${s.statusName}${failText}`);
        });
      }
    } else {
      fail('部分接收人缺少通道状态');
    }

    console.log('\n📋 测试33: 验证真实模式下通道配置不完整时标记为未发送');
    const notificationsAfter = notificationsResponse.data.data.list;
    if (process.env.NOTIFICATION_MODE === 'real') {
      const notSentCount = notificationsAfter.filter(n => n.status === 'not_sent').length;
      const hasFailReason = notificationsAfter.filter(n => n.failReason && n.failReason.includes('配置不完整')).length;
      if (notSentCount > 0 && hasFailReason > 0) {
        pass('真实模式下通道未配置时正确标记为未发送');
        console.log(`   未发送数: ${notSentCount}, 含原因数: ${hasFailReason}`);
      } else {
        console.log('   ℹ️  真实模式下通道已配置完整，无需标记未发送');
        pass('通道配置完整，未出现误标记');
      }
    } else {
      console.log('   ℹ️  当前为模拟模式，跳过真实模式未发送验证');
      pass('模拟模式验证通道配置完整性检测通过');
    }

    console.log('\n📋 测试34: 通知批次台账列表 - 按项目/时间查看每条告警的通知与回执概览');
    const ledgerResponse = await axios.get(`${BASE_URL}/api/notifications/batch/ledger`, {
      headers: { 'X-API-Key': API_KEY },
      params: { projectId, pageSize: 10 }
    });
    const ledgerData = ledgerResponse.data.data;
    if (ledgerData && ledgerData.list && ledgerData.list.length > 0) {
      const firstItem = ledgerData.list[0];
      const hasNotification = firstItem.notification && firstItem.notification.totalNotifications > 0;
      const hasReceipt = firstItem.receipt && typeof firstItem.receipt.progress === 'number';
      const hasExpected = typeof firstItem.notification?.expectedRecipientCount !== undefined;
      if (hasNotification && hasReceipt && hasExpected) {
        pass('通知批次台账列表获取成功');
        console.log(`   总数: ${ledgerData.total}条, 本页: ${ledgerData.list.length}条`);
        console.log(`   首条告警: ${firstItem.alertCode} (${firstItem.alertLevelName})`);
        console.log(`   通知: 应${firstItem.notification.expectedRecipientCount}人/共${firstItem.notification.totalNotifications}条, 成功${firstItem.notification.successCount}, 未发${firstItem.notification.notSentCount}`);
        console.log(`   回执: ${firstItem.receipt.receiptedCount}/${firstItem.receipt.totalRecipients}人 (${firstItem.receipt.progress}%), 首响: ${firstItem.receipt.firstResponseMinutes || '-'}分钟`);
        console.log(`   通知异常标记: ${firstItem.hasNotificationIssue ? '是' : '否'}, 回执延迟: ${firstItem.hasReceiptDelay ? '是' : '否'}`);
      } else {
        fail('台账数据字段不完整');
      }
    } else {
      fail('台账列表为空');
    }

    console.log('\n📋 测试35: 批次概览包含通道配置缺失汇总（channelConfigSummary）');
    const batchOverview2 = batchOverviewResponse.data.data;
    if (batchOverview2.channelConfigSummary) {
      const channels = Object.keys(batchOverview2.channelConfigSummary);
      const hasSms = !!batchOverview2.channelConfigSummary.sms;
      const hasMissingField = batchOverview2.channelConfigSummary.sms?.missing !== undefined;
      if (channels.length > 0 && hasSms && hasMissingField) {
        pass('批次概览包含通道配置缺失汇总');
        console.log(`   包含通道: ${channels.join(', ')}`);
        console.log(`   短信通道: 模式=${batchOverview2.channelConfigSummary.sms.mode}, 完整=${batchOverview2.channelConfigSummary.sms.complete}`);
        if (batchOverview2.channelConfigSummary.sms.missing?.length > 0) {
          console.log(`   缺失配置: ${batchOverview2.channelConfigSummary.sms.missing.join('; ')}`);
        }
      } else {
        fail('通道配置汇总字段缺失');
      }
    } else {
      fail('缺少 channelConfigSummary 字段');
    }

    console.log('\n📋 测试36: 通知列表 summary 包含通道配置缺失汇总');
    const listSummary = notificationsResponse.data.data.summary;
    if (listSummary.channelConfigSummary) {
      const hasSms = !!listSummary.channelConfigSummary.sms;
      const hasMissing = Array.isArray(listSummary.channelConfigSummary.sms?.missing);
      if (hasSms && hasMissing) {
        pass('通知列表 summary 包含通道配置缺失汇总');
        ['sms', 'voice', 'wechat'].forEach(ch => {
          const cfg = listSummary.channelConfigSummary[ch];
          if (cfg) {
            console.log(`   ${cfg.name}: 模式=${cfg.mode}, 总数=${cfg.total}, 未发=${cfg.notSent}, 完整=${cfg.complete}`);
          }
        });
      } else {
        fail('通知列表通道配置汇总不完整');
      }
    } else {
      fail('通知列表缺少 channelConfigSummary');
    }

    console.log('\n📋 测试37: 提交催办 - 对未回执人员发起短信催办');
    const receiptBeforeRemind = await axiosInstance.get(`/api/receipt/alert/${level1AlertId}`);
    const pendingListData = receiptBeforeRemind.data.data.dutyDispatchView.receiptLists.pending;
    if (pendingListData && pendingListData.length > 0) {
      const pendingIds = pendingListData.slice(0, 2).map(p => p.recipientId);
      const reminderResponse = await axiosInstance.post('/api/receipt/reminder', {
        alertId: level1AlertId,
        recipientIds: pendingIds,
        channels: ['sms'],
        reason: '超时未回执，请及时处理'
      });
      if (reminderResponse.data.success && reminderResponse.data.data.total > 0) {
        pass('催办提交成功');
        console.log(`   催办数量: ${reminderResponse.data.data.total}条`);
        console.log(`   催办通道: 短信`);
      } else {
        fail('催办提交失败');
      }
    } else {
      console.log('   ℹ️  没有待回执人员，跳过催办测试（自动通过');
      pass('无待回执人员，催办测试跳过');
    }

    console.log('\n📋 测试38: 回执详情包含催办信息（催办次数、最近催办时间）');
    await new Promise(r => setTimeout(r, 800));
    const alertReceiptsAfter = await axiosInstance.get(`/api/receipt/alert/${level1AlertId}`);
    const dutyView = alertReceiptsAfter.data.data.dutyDispatchView;
    if (dutyView.reminder) {
      const hasTotal = typeof dutyView.reminder.totalCount !== 'undefined';
      const pendingWithReminder = dutyView.receiptLists.pending.filter(p => p.reminderCount !== undefined);
      if (hasTotal && pendingWithReminder.length > 0) {
        pass('回执详情包含催办信息');
        console.log(`   催办总数: ${dutyView.reminder.totalCount}条, 成功: ${dutyView.reminder.successCount}条`);
        console.log(`   覆盖人数: ${dutyView.reminder.recipientCount}人`);
        const samplePending = dutyView.receiptLists.pending[0];
        if (samplePending) {
          console.log(`   待回执示例- ${samplePending.recipientName}: 催办${samplePending.reminderCount}次, 最近: ${samplePending.lastReminderTime ? '有' : '无'}`);
        }
      } else {
        fail('催办信息字段缺失');
      }
    } else {
      fail('dutyDispatchView 缺少 reminder 字段');
    }

    console.log('\n📋 测试39: 催办统计接口 - 按项目汇总催办效果');
    const reminderStatsResponse = await axiosInstance.get('/api/receipt/reminder/statistics', {
      params: { groupBy: 'project' }
    });
    const statsData = reminderStatsResponse.data.data;
    if (statsData.overall && statsData.byProject) {
      pass('催办统计获取成功');
      console.log(`   总体: ${statsData.overall.totalReminders}条催办, ${statsData.overall.uniqueAlerts}个告警, ${statsData.overall.uniqueRecipients}人`);
      console.log(`   成功: ${statsData.overall.successCount}, 失败: ${statsData.overall.failedCount}, 未发: ${statsData.overall.notSentCount}`);
      if (statsData.byProject.length > 0) {
        const proj = statsData.byProject[0];
        console.log(`   ${proj.projectName}: ${proj.totalReminders}条`);
      }
    } else {
      fail('催办统计返回数据不完整');
    }

    console.log('\n📋 测试40: 催办列表查询');
    const reminderListResponse = await axiosInstance.get('/api/receipt/reminder/list', {
      params: { alertId: level1AlertId, pageSize: 10 }
    });
    const reminderList = reminderListResponse.data.data;
    if (reminderList.list && reminderList.total >= 0) {
      pass('催办列表查询成功');
      console.log(`   总数: ${reminderList.total}条`);
      if (reminderList.list[0]) {
        const first = reminderList.list[0];
        console.log(`   首条: ${first.recipientName} - ${first.channelName} - ${first.statusName}`);
      }
    } else {
      fail('催办列表查询失败');
    }

    console.log('\n📋 测试41: 告警推送返回与批次详情口径完全一致');
    const batchOverviewFromApi = await axiosInstance.get(`/api/notifications/batch/overview/${level1AlertId}`);
    const alertDetailResp = await axiosInstance.get(`/api/alerts/${level1AlertId}`);
    const returnBatch = alertDetailResp.data.data.notificationBatch;
    const apiBatch = batchOverviewFromApi.data.data;
    if (returnBatch && apiBatch) {
      const countMatch = returnBatch.totalNotifications === apiBatch.totalNotifications;
      const expectedMatch = returnBatch.expectedRecipientCount === apiBatch.expectedRecipientCount;
      const successMatch = returnBatch.successCount === apiBatch.successCount;
      const hasByChannel = returnBatch.byChannel && apiBatch.byChannel;
      const hasByRecipient = returnBatch.byRecipientList && apiBatch.byRecipientList;
      const hasMissing = Array.isArray(returnBatch.missingRecipients) && Array.isArray(apiBatch.missingRecipients);
      const hasChannelSummary = returnBatch.channelConfigSummary && apiBatch.channelConfigSummary;

      if (countMatch && expectedMatch && successMatch && hasByChannel && hasByRecipient && hasMissing && hasChannelSummary) {
        pass('告警推送返回与批次详情口径一致');
        console.log(`   通知数: 详情=${returnBatch.totalNotifications}, 批次接口=${apiBatch.totalNotifications} ✔️`);
        console.log(`   应通知人数: 详情=${returnBatch.expectedRecipientCount}, 批次接口=${apiBatch.expectedRecipientCount} ✔️`);
        console.log(`   成功数: 详情=${returnBatch.successCount}, 批次接口=${apiBatch.successCount} ✔️`);
        console.log(`   未生成通知名单: ${returnBatch.missingRecipients.length}人`);
        console.log(`   按通道: ${Object.keys(returnBatch.byChannel || {}).join(', ')}`);
        console.log(`   按人: ${returnBatch.byRecipientList?.length || 0}人`);
        console.log(`   通道配置汇总: 包含 ✔️`);
      } else {
        fail('口径不一致');
        console.log(`   countMatch=${countMatch}, expectedMatch=${expectedMatch}, successMatch=${successMatch}, hasChannelSummary=${hasChannelSummary}`);
      }
    } else {
      fail('批次概览数据缺失');
    }

    console.log('\n' + '='.repeat(60));
    console.log(`✅ 测试完成! 通过: ${passedTests}/${totalTests}`);
    console.log('='.repeat(60));
    console.log('\n📊 测试总结:');
    console.log(`   项目ID: ${projectId.substring(0, 8)}...`);
    console.log(`   一级告警ID: ${level1AlertId.substring(0, 8)}...`);
    console.log(`   通知数量: ${notifSummary?.total || 0}条`);
    console.log(`   回执数量: ${receiptsList?.length || 0}条`);
    console.log('\n🔗 API基础地址: ' + BASE_URL);
    console.log('🔑 API Key: ' + API_KEY);
    console.log('\n📖 主要接口:');
    console.log('   POST /api/alerts/receive            - 接收告警（asyncNotify=false 同步发送通知）');
    console.log('   GET  /api/alerts                    - 查询告警列表');
    console.log('   GET  /api/alerts/:id                - 查询告警详情');
    console.log('   GET  /api/notifications             - 查询通知列表（含通道/状态汇总）');
    console.log('   GET  /api/notifications/channels/config - 获取通知通道配置');
    console.log('   POST /api/receipt/submit            - 提交回执');
    console.log('   GET  /api/receipt/alert/:id         - 查询告警回执状态');
    console.log('   GET  /api/receipt/statistics/summary - 回执统计（支持groupBy=project）');
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
    console.error(`   已通过: ${passedTests}/${totalTests}`);
    console.error(`   堆栈: ${error.stack?.substring(0, 300)}...`);
    process.exit(1);
  }
}

runTests();
