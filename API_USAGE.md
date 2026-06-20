# 高支模预警短信与语音后端服务 - API使用手册

## 概述

本服务是面向大型施工企业的高支模预警系统，专门解决夜间浇筑、跨项目值班时消息漏接和责任不清的问题。服务不替代监测平台，而是提供专业的告警分级、多渠道通知和回执追踪能力。

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 初始化数据库（包含测试数据）

```bash
npm run init-db
```

### 3. 启动服务

```bash
npm start
# 或开发模式
npm run dev
```

### 4. 运行API测试

```bash
npm test
```

## 认证方式

### API Key 认证

所有需要认证的接口需要在请求头中携带 `x-api-key`：

```
x-api-key: alert_system_key_2024
```

**可用的API Key：**
- `monitor_key_2024` - 监测设备平台
- `project_key_2024` - 项目管理平台
- `emergency_key_2024` - 应急值班系统
- `alert_system_key_2024` - 通用默认key

## 核心接口

### 1. 接收告警

**接口：** `POST /api/alerts/receive`

**描述：** 接收外部系统推送的沉降超限、位移突变、传感器离线等事件

**请求体：**
```json
{
  "eventType": "settlement_exceed",
  "projectId": "项目UUID",
  "areaId": "区域UUID",
  "sensorId": "传感器UUID",
  "sensorCode": "SEN-SET-001",
  "sensorType": "settlement",
  "currentValue": 25.5,
  "thresholdValue": 10,
  "unit": "mm",
  "location": "A区核心筒3层西北立柱",
  "description": "沉降监测值超过预警阈值",
  "sourceSystem": "monitoring_system",
  "sourceEventId": "MON-20240621-0001",
  "occurTime": "2024-06-21T23:30:00.000Z"
}
```

**事件类型 (eventType)：**
- `settlement_exceed` - 沉降超限
- `displacement_sudden` - 位移突变
- `sensor_offline` - 传感器离线
- `sensor_fault` - 传感器故障
- `threshold_exceed` - 阈值超限
- `other` - 其他事件

**响应示例：**
```json
{
  "success": true,
  "data": {
    "success": true,
    "alertId": "alert-uuid",
    "alertCode": "SET-GZM-20-20240621-233000-001",
    "alertLevel": "level1",
    "alertLevelName": "一级告警",
    "reasons": ["夜间浇筑期间沉降严重超限，超限比例255%"],
    "context": {
      "isNight": true,
      "isPouring": true,
      "isNightPouring": true,
      "areaRiskLevel": "critical"
    }
  },
  "message": "告警接收成功"
}
```

**告警级别说明：**
- **level1 (一级告警)**：电话语音 + 短信 + 企业群，通知总包、监理、劳务班组、项目经理、安全员、值班员
- **level2 (二级告警)**：短信 + 企业群，通知总包、监理、安全员、值班员
- **notice (提示类)**：仅企业群，通知设备管理员

### 2. 批量接收告警

**接口：** `POST /api/alerts/batch`

**请求体：**
```json
{
  "events": [
    {
      "eventType": "settlement_exceed",
      "projectId": "项目UUID",
      "currentValue": 25.5,
      "thresholdValue": 10,
      "occurTime": "2024-06-21T23:30:00.000Z"
    },
    {
      "eventType": "sensor_offline",
      "projectId": "项目UUID",
      "occurTime": "2024-06-21T23:31:00.000Z"
    }
  ]
}
```

### 3. 提交回执

**接口：** `POST /api/receipt/submit`

**描述：** 接收人点击回执链接后提交处理状态

**方式一：通过回执链接（带token参数）**
```
POST /api/receipt/submit?token=xxx
```

**方式二：直接指定ID**
```json
{
  "alertId": "告警UUID",
  "recipientId": "接收人UUID",
  "notificationId": "通知UUID",
  "receiptType": "processing",
  "siteContact": "李现场",
  "siteContactPhone": "13900139000",
  "estimatedHandleTime": 30,
  "remark": "已安排人员前往现场检查"
}
```

**回执类型 (receiptType)：**
- `acknowledged` - 已知晓
- `processing` - 正在处理
- `false_alarm` - 误报待核

**响应示例：**
```json
{
  "success": true,
  "data": {
    "success": true,
    "receiptId": "回执UUID",
    "receiptType": "processing",
    "receiptTypeName": "正在处理",
    "isFirstReceipt": true,
    "alertStatus": "processing",
    "message": "回执提交成功"
  }
}
```

### 4. 查询告警列表

**接口：** `GET /api/alerts`

**查询参数：**
- `projectId` - 项目ID
- `alertLevel` - 告警级别 (level1/level2/notice)
- `status` - 告警状态
- `eventType` - 事件类型
- `startTime` - 开始时间
- `endTime` - 结束时间
- `page` - 页码，默认1
- `pageSize` - 每页条数，默认20

### 5. 查询告警详情

**接口：** `GET /api/alerts/:id`

**返回：** 包含告警信息、相关通知记录、回执记录等完整信息

### 6. 查询告警回执状态

**接口：** `GET /api/receipt/alert/:alertId`

**响应示例：**
```json
{
  "success": true,
  "data": {
    "alertId": "告警UUID",
    "alertCode": "SET-GZM-...",
    "alertStatus": "processing",
    "receiptStatus": {
      "total": 6,
      "acknowledged": 2,
      "processing": 1,
      "falseAlarm": 0,
      "pending": 3
    },
    "receipts": [...],
    "notifications": [...]
  }
}
```

## 告警分级逻辑

### 分级判定因素
1. **事件类型**：沉降超限、位移突变的严重程度高于传感器离线
2. **超限比例**：超过阈值200%以上为严重
3. **夜间时段**：22:00 - 06:00 定义为夜间
4. **浇筑状态**：浇筑期间事件升级
5. **区域风险等级**：critical > high > medium > low

### 升级规则
- **夜间浇筑期间**：所有事件自动升级一级
- **critical风险区域**：提示类自动升级为二级
- **夜间+浇筑+二级**：自动升级为一级

## 通知规则配置

### 默认规则

创建项目时自动创建以下规则：

| 告警级别 | 通知对象 | 通知渠道 |
|---------|---------|---------|
| 一级告警 | 总包、监理、劳务班组、项目经理、安全员、值班员 | 电话语音 + 短信 + 企业群 |
| 二级告警 | 总包、监理、安全员、值班员 | 短信 + 企业群 |
| 提示类 | 设备管理员 | 企业群 |

### 自定义规则

**接口：** `POST /api/notification-rules`

```json
{
  "ruleName": "夜间浇筑增强通知",
  "ruleType": "project_level",
  "projectId": "项目UUID",
  "alertLevel": "level1",
  "roles": ["general_contractor", "supervisor", "project_manager"],
  "channels": {
    "sms": true,
    "voice": true,
    "wechat": true,
    "email": false
  },
  "priority": 100,
  "notifyDuringPouringOnly": false
}
```

**角色类型 (roles)：**
- `general_contractor` - 总包
- `supervisor` - 监理
- `labor_team` - 劳务班组
- `device_admin` - 设备管理员
- `project_manager` - 项目经理
- `safety_officer` - 安全员
- `duty_officer` - 值班员

## 接收人管理

### 角色配置

**接口：** `POST /api/recipients`

```json
{
  "name": "张总包",
  "phone": "13800138001",
  "role": "general_contractor",
  "projectId": "项目UUID",
  "company": "中建某局",
  "position": "项目总工",
  "isOnDuty": true,
  "notificationChannels": {
    "sms": true,
    "voice": true,
    "wechat": true,
    "email": false
  }
}
```

### 值班状态切换

**接口：** `POST /api/recipients/:id/duty`

```json
{
  "isOnDuty": true
}
```

**说明：** 系统优先通知值班中的接收人，如果无人值班，则通知所有启用的接收人。

## 项目和浇筑状态管理

### 设置浇筑状态

**接口：** `POST /api/projects/:id/pouring-status`

```json
{
  "pouringStatus": "pouring",
  "isNightPouring": true
}
```

**浇筑状态：**
- `not_started` - 未开始
- `pouring` - 浇筑中
- `completed` - 已完成
- `curing` - 养护中

## 通知内容示例

### 短信
```
【高支模预警】【夜间浇筑期间】一级告警: 沉降超限，广州某商业综合体-A区核心筒。当前值: 25.5mm, 阈值: 10mm，请及时处理。回执: http://localhost:3000/api/receipt?token=xxx
```

### 电话语音
```
您好，这里是高支模预警系统。【夜间浇筑期间】发生一级告警，沉降超限。项目位置广州某商业综合体-A区核心筒。当前值: 25.5mm, 阈值: 10mm。请立即前往处理。重复一遍...
```

### 企业微信
```
# 【夜间浇筑期间】一级告警通知

> **事件类型**: 沉降超限
> **告警级别**: 一级告警
> **项目**: 广州某大型商业综合体项目
> **区域**: A区核心筒高支模
> **位置**: A区核心筒3层西北立柱
> **发生时间**: 2024-06-21 23:30:00
> **监测数据**: 当前值: 25.5mm, 阈值: 10mm
> **告警编号**: SET-GZM-20-20240621-233000-001

**描述**: 沉降监测值超过预警阈值，需立即关注

请相关人员立即处理！

[点击回执](http://localhost:3000/api/receipt?token=xxx)
```

## 数据库结构

### 核心表
- `projects` - 项目信息
- `areas` - 区域信息
- `sensors` - 传感器信息
- `alerts` - 告警记录
- `recipients` - 接收人信息
- `notification_rules` - 通知规则
- `notifications` - 通知发送记录
- `receipts` - 回执记录

## 日志和监控

### 日志文件
- `logs/app.log` - 应用日志
- `logs/error.log` - 错误日志

### 健康检查
**接口：** `GET /api/health`

```json
{
  "success": true,
  "message": "高支模预警短信与语音后端服务运行正常",
  "timestamp": "2024-06-21T23:30:00.000Z",
  "version": "1.0.0",
  "uptime": 3600.123
}
```

## 常见问题

### Q: 如何集成短信/语音服务商？
A: 修改 `src/services/notificationService.js` 中的 `sendSms` 和 `sendVoiceCall` 函数，填入真实的第三方API调用。

### Q: 如何对接企业微信？
A: 配置 `.env` 中的 `WECOM_WEBHOOK_URL` 和 `WECOM_KEY`，然后修改 `sendWechatMessage` 函数。

### Q: 如何调整告警分级逻辑？
A: 修改 `src/services/alertLevelService.js` 中的 `determineAlertLevel` 函数。

### Q: 如何配置跨项目值班？
A: 创建接收人时不指定 `projectId`，该接收人将作为全局值班人员接收所有项目的告警。
