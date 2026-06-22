# 校园考勤异常分析工作台

本地部署的校园门禁考勤异常分析系统，支持刷卡/请假记录导入、自动识别异常、人工复核、规则配置和 CSV 导出。

## 技术栈

- 前端：React 18 + TypeScript + Vite + TailwindCSS + Zustand
- 后端：Express 4 + TypeScript
- 数据库：SQLite (better-sqlite3)
- 测试：vitest

## 目录结构

```
├── api/              # 后端 Express 服务
│   ├── routes/       # API 路由
│   ├── __tests__/    # 回归测试
│   ├── anomalyEngine.ts
│   ├── validators.ts
│   ├── repositories.ts
│   ├── sampleData.ts
│   └── server.ts
├── src/              # 前端 React 应用
│   ├── pages/        # 页面组件
│   ├── components/   # 通用组件
│   ├── store/        # Zustand 状态
│   └── lib/
├── shared/           # 前后端共享类型
├── data/             # SQLite 数据库文件
└── index.html
```

## 安装依赖

```bash
npm install
```

## 启动服务

```bash
npm run dev
```

启动后：
- 前端页面：http://localhost:5173
- 后端 API：http://localhost:3002

## 功能模块

| 页面 | 路径 | 说明 |
|------|------|------|
| 首页 | `/` | 系统概览和快捷入口 |
| 数据导入 | `/import` | 导入刷卡记录和请假记录 |
| 异常工作台 | `/anomalies` | 异常列表、筛选、复核、回退 |
| 规则配置 | `/rules` | 各年级迟到阈值、缺勤窗口等 |
| 统计分析 | `/statistics` | 异常分布图表 |

## 导入文件格式

### 刷卡记录

支持字段（兼容中英文列名）：

| 字段 | 中文列名 | 必填 | 说明 |
|------|---------|------|------|
| `student_id` | 学号 | 是 | 必须是系统中已存在的学号 |
| `swipe_time` | 刷卡时间 | 是 | 格式：`YYYY-MM-DD HH:mm:ss` 或 ISO 格式 |
| `device_location` | 设备位置 | 否 | 如：校门口、宿舍门口等 |

示例（CSV）：

```csv
学号,刷卡时间,设备位置
S00001,2026-06-22 07:30:00,校门口
S00002,2026-06-22 08:15:00,校门口
```

导入接口：
- 校验：`POST /api/import/validate/swipes`
- 提交：`POST /api/import/commit/swipes`

### 请假记录

支持字段（兼容中英文列名）：

| 字段 | 中文列名 | 必填 | 说明 |
|------|---------|------|------|
| `student_id` | 学号 | 是 | 必须是系统中已存在的学号 |
| `leave_type` | 请假类型 | 是 | sick / personal / official / other |
| `start_time` | 开始时间 | 是 | 格式：`YYYY-MM-DD HH:mm:ss` |
| `end_time` | 结束时间 | 是 | 格式：`YYYY-MM-DD HH:mm:ss` |
| `reason` | 请假原因 | 否 | 文本描述 |

导入接口：
- 校验：`POST /api/import/validate/leaves`
- 提交：`POST /api/import/commit/leaves`

### 数据校验规则

导入时系统会自动校验，错误会附带行号：
- **未知学生**：学号不在学生库中
- **非法时间**：格式错误或不在 05:00-23:00 范围内
- **重复记录**：同一学生同一时间已存在
- **缺字段**：缺少必填列

## 异常类型

系统自动识别 4 类异常：

1. **迟到**（late）：超过各年级上课时间 + 宽容分钟数
2. **缺勤**（absent）：超过缺勤窗口仍无刷卡记录
3. **重复刷卡**（duplicate_swipe）：同一时段多次刷卡
4. **请假例外**（leave_exception）：请假期间出现刷卡记录

异常状态：
- `pending` 待处理
- `confirmed` 已确认
- `dismissed` 已忽略
- `reverted` 已回退

## 用样例数据复现主流程

### 1. 加载样例数据

```bash
# 方式一：API 调用
curl -X POST http://localhost:3002/api/import/sample

# 方式二：页面操作
# 打开 http://localhost:5173/import，点击「加载样例数据」
```

样例数据包含：
- 3 个年级（高一/高二/高三）× 3 班 × 8 人 = 72 名学生
- 约 600+ 条刷卡记录（近一周工作日）
- 若干请假记录
- 约 600+ 条异常记录

### 2. 查询异常列表

```bash
# 查看所有待处理异常
curl "http://localhost:3002/api/anomalies?status=pending&page=1&page_size=20"

# 按班级筛选
curl "http://localhost:3002/api/anomalies?grade=高三&class_name=1班"

# 按日期范围筛选
curl "http://localhost:3002/api/anomalies?start_date=2026-06-20&end_date=2026-06-22"
```

### 3. 复核异常

```bash
# 确认异常
curl -X POST http://localhost:3002/api/anomalies/1/review \
  -H "Content-Type: application/json" \
  -d '{"action":"confirm","note":"迟到属实，已联系家长"}'

# 忽略异常
curl -X POST http://localhost:3002/api/anomalies/1/review \
  -H "Content-Type: application/json" \
  -d '{"action":"dismiss","note":"系统误判，学生已请假"}'

# 回退复核（恢复到上一状态）
curl -X POST http://localhost:3002/api/anomalies/1/review \
  -H "Content-Type: application/json" \
  -d '{"action":"revert","note":"复核有误，回退"}'
```

### 4. 导出 CSV

```bash
# 导出所有异常
curl "http://localhost:3002/api/export/anomalies" -o anomalies.csv

# 仅导出已确认
curl "http://localhost:3002/api/export/anomalies?status=confirmed" -o confirmed.csv

# 按班级导出
curl "http://localhost:3002/api/export/anomalies?grade=高三&class_name=1班" -o class1.csv
```

### 5. 配置规则

```bash
# 查看当前规则（返回数组）
curl http://localhost:3002/api/rules

# 查看规则版本历史
curl http://localhost:3002/api/rules/versions

# 保存规则（数组格式，第一条可用 __description 指定版本说明）
curl -X POST http://localhost:3002/api/rules \
  -H "Content-Type: application/json" \
  -d '[
    {"__description":"调整高三迟到阈值"},
    {"grade":"高一","morning_start_time":"07:40","late_tolerance_minutes":5,"afternoon_start_time":"14:00","absent_window_minutes":120},
    {"grade":"高二","morning_start_time":"07:30","late_tolerance_minutes":5,"afternoon_start_time":"14:00","absent_window_minutes":120},
    {"grade":"高三","morning_start_time":"07:20","late_tolerance_minutes":3,"afternoon_start_time":"13:50","absent_window_minutes":120}
  ]'

# 重新识别异常（规则调整后）
curl -X POST http://localhost:3002/api/anomalies/redetect
```

## 运行测试

```bash
# 运行所有测试
npm run test

# 仅运行回归测试
npm run test -- api/__tests__/regression.test.ts
```

## 数据库

数据库文件位于 `data/attendance.db`（SQLite 格式）。删除此文件即可重置所有数据。

持久化内容：
- 学生信息
- 刷卡记录
- 请假记录
- 异常记录及复核状态
- 复核历史
- 规则配置及版本
