# AI Psychology（Cloudflare Workers 全栈应用）

本项目是一个部署在 Cloudflare Workers 上的 AI 心理陪伴应用，包含用户端聊天、管理员后台、反馈收集、日志与性能统计、数据保留清理等完整能力。

---

## 1. 项目架构

### 1.1 架构总览

- **前端层（`public/`）**  
  原生 HTML/CSS/JS 页面（首页、登录、注册、聊天、管理后台），通过 Workers Assets 直接托管。

- **网关层（`src/index.js`）**  
  Worker 主入口，负责：
  - API 路由分发（`/api/*`）
  - JWT 鉴权（用户/管理员）
  - WebSocket 接入转发到 Durable Object
  - 请求性能埋点
  - 非 API 请求回落到静态资源

- **会话层（`src/durable-objects/ChatSession.js`）**  
  基于 **Durable Objects + WebSocket** 维护实时聊天会话，处理：
  - 实时消息收发
  - 历史上下文加载
  - 调用 DeepSeek 聊天模型
  - 消息持久化到 D1
  - 心跳/连接状态管理

- **数据层（Cloudflare D1）**  
  核心表在 `schema.sql`：
  - `users`：用户
  - `chat_logs`：对话记录
  - `registration_codes`：注册码
  - `error_logs`：错误/告警日志
  - `performance_metrics`：性能指标

- **运维层（定时任务）**  
  `src/scheduled.js` 配合 `wrangler.jsonc` 的 cron，每天自动执行数据保留清理任务。

### 1.2 技术栈

- Cloudflare Workers
- Cloudflare Durable Objects
- Cloudflare D1
- Wrangler CLI
- 原生前端（无框架）
- `bcryptjs`（密码哈希）
- `@tsndr/cloudflare-worker-jwt`（JWT）

---

## 2. 功能说明

### 2.1 用户侧功能

- 注册（需要注册码）
- 登录（JWT）
- WebSocket 实时聊天
- 历史聊天查询（`/api/history`）
- 反馈提交（登录/匿名均可）

### 2.2 管理侧功能

- 管理员登录
- 用户列表/用户历史查看
- 用户历史导出（CSV）
- 删除用户、重置用户密码
- 注册码增删改查与启停
- 错误日志查询、统计、删除、批量清理
- 性能指标统计与清理
- 触发数据保留清理
- 清空数据库与按用户清理聊天记录

### 2.3 安全与治理能力

- 用户密码 bcrypt 加密
- JWT 鉴权与角色校验（`user` / `admin`）
- 统一错误处理与日志记录
- 数据保留策略（聊天/日志/指标清理）
- 基础性能监控（API、WebSocket、AI 调用、Token 用量）

---

## 3. 目录结构

```text
.
├── public/                    # 前端静态页面与脚本
│   ├── index.html
│   ├── login.html
│   ├── register.html
│   ├── chat.html
│   ├── admin-login.html
│   ├── admin.html
│   ├── config.js
│   └── feedback-widget.js
├── src/
│   ├── index.js               # Worker 入口与路由
│   ├── config.js              # 应用与安全配置
│   ├── scheduled.js           # 定时任务入口
│   ├── api/                   # HTTP API 处理
│   │   ├── register.js
│   │   ├── login.js
│   │   ├── history.js
│   │   ├── feedback.js
│   │   └── admin.js
│   ├── durable-objects/
│   │   └── ChatSession.js     # WebSocket 会话与 AI 调用
│   └── utils/
│       ├── errorHandler.js
│       ├── logger.js
│       ├── dataRetention.js
│       └── performanceTracker.js
├── schema.sql                 # D1 数据库结构
├── wrangler.jsonc             # Workers / D1 / DO / Cron 配置
├── package.json
└── README.md
```

---

## 4. 部署与运行方法

### 4.1 前置要求

- Node.js 18+（建议 LTS）
- npm
- Cloudflare 账号
- Wrangler CLI（项目内已通过 `devDependencies` 提供）

### 4.2 安装依赖

```bash
npm install
```

### 4.3 Cloudflare 资源配置

1. **D1 数据库**  
   在 Cloudflare 创建 D1，并确保 `wrangler.jsonc` 中 `d1_databases` 的 `database_name / database_id` 与实际一致。

2. **Durable Object**  
   本项目已在 `wrangler.jsonc` 中声明 `CHAT_SESSION -> ChatSession`，部署时会按迁移配置生效。

3. **Secrets（必须）**

```bash
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put JWT_SECRET
npx wrangler secret put ADMIN_PASSWORD
```

### 4.4 初始化数据库

使用 `schema.sql` 初始化 D1：

```bash
npx wrangler d1 execute ai-psychology-db --file=schema.sql
```

> 如使用本地 D1，可附加 `--local`。

### 4.5 本地开发

```bash
npm run dev
```

默认本地地址：`http://localhost:8787`

### 4.6 运行测试

```bash
npm run test
```

当前仓库已配置 Vitest，但默认没有测试文件；执行后会提示 `No test files found`。

### 4.7 部署到 Cloudflare

```bash
npm run deploy
```

该命令会将 Worker 代码、静态资源、Durable Object 绑定、D1 绑定及 Cron 配置一起发布。

---

## 5. 关键配置说明

### `wrangler.jsonc`

- `main: "src/index.js"`：Worker 入口
- `assets.directory: "./public"`：静态资源目录
- `d1_databases`：D1 绑定名为 `ai_psychology_db`
- `durable_objects.bindings`：`CHAT_SESSION`
- `triggers.crons`: `0 2 * * *`（UTC 每日 2 点）

### `src/config.js`

- AI 模型与 API 配置（DeepSeek）
- JWT 与密码策略
- WebSocket 与限流参数
- 数据保留策略参数

---

## 6. 典型调用流程（简版）

1. 用户登录获取 JWT（`/api/login`）  
2. 前端携带 token 建立 WebSocket（`/api/chat/ws?token=...`）  
3. Worker 校验 token 后转发到用户对应 Durable Object  
4. Durable Object 读取历史、调用 AI、写入 `chat_logs`、回推消息  
5. 管理后台可通过 `/api/admin/*` 查看与治理数据

---

## 7. 维护建议

- 生产环境将 `ENVIRONMENT` 设为 `production`
- 定期清理日志与性能指标（已提供定时任务和后台手动触发）
- 部署前确认 Secret 完整、D1 绑定正确、Cron 已启用
