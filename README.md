# My AI Consultant App

这是一个基于 Cloudflare Workers 构建的 AI 顾问应用程序。它提供了一个平台，用户可以与 AI 进行实时聊天，获取咨询服务。该应用还包括用户认证、聊天记录、反馈收集和管理后台等功能。

## 主要功能

*   **用户认证**: 支持用户注册和登录，使用 `bcryptjs` 进行密码加密，使用 JWT (JSON Web Tokens) 进行会话管理。
*   **实时 AI 聊天**: 用户登录后可以与 AI 进行实时对话。聊天会话状态通过 Cloudflare Durable Objects 进行持久化。
*   **聊天记录**: 用户可以查看自己的历史聊天记录。
*   **反馈系统**: 提供一个反馈小部件，允许用户提交反馈。
*   **管理后台**: 提供一个管理员面板，用于监控和管理应用。
*   **数据保留策略**: 自动清理过期的聊天数据。
*   **性能监控和日志**: 集成了基本的性能跟踪和日志记录功能。

## 技术栈

*   **后端**:
    *   [Cloudflare Workers](https://workers.cloudflare.com/): 用于部署无服务器后端逻辑。
    *   [Cloudflare Durable Objects](https://developers.cloudflare.com/workers/learning/using-durable-objects/): 用于维护实时聊天会话的状态。
    *   [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/): 用于开发和部署 Cloudflare Workers 应用。
*   **前端**:
    *   原生 HTML, CSS, 和 JavaScript。
*   **主要依赖**:
    *   `bcryptjs`: 用于密码哈希。
    *   `@tsndr/cloudflare-worker-jwt`: 用于处理 JWT 认证。
    *   `vitest`: 用于单元测试。

## 项目结构

```
.
├── docs/                  # 项目文档
├── public/                # 存放前端静态文件
│   ├── admin-login.html   # 管理员登录页
│   ├── admin.html         # 管理员面板
│   ├── chat.html          # 聊天页面
│   ├── index.html         # 首页
│   ├── login.html         # 用户登录页
│   ├── register.html      # 用户注册页
│   └── ...
├── src/                   # 后端源代码
│   ├── api/               # API 路由处理
│   │   ├── admin.js
│   │   ├── feedback.js
│   │   ├── history.js
│   │   ├── login.js
│   │   └── register.js
│   ├── durable-objects/   # Durable Objects 实现
│   │   └── ChatSession.js
│   ├── utils/             # 工具函数
│   │   ├── dataRetention.js
│   │   ├── errorHandler.js
│   │   ├── logger.js
│   │   └── ...
│   ├── config.js          # 后端配置
│   ├── index.js           # Worker 入口文件
│   └── scheduled.js       # 定时任务处理
├── jsconfig.json          # JavaScript 项目配置
├── package.json           # 项目依赖和脚本
├── schema.sql             # 数据库表结构定义
└── wrangler.jsonc         # Wrangler 配置文件
```

## 安装与设置

1.  **克隆仓库**
    ```bash
    git clone <your-repository-url>
    cd my-ai-consultant-app
    ```

2.  **安装依赖**
    确保您已安装 [Node.js](https://nodejs.org/) 和 npm。
    ```bash
    npm install
    ```

3.  **配置 Cloudflare**
    *   登录到您的 Cloudflare 账户。
    *   根据 `wrangler.jsonc` 文件中的配置，创建 D1 数据库和 Durable Object 命名空间。
    *   在 Cloudflare Dashboard 中设置环境变量和密钥 (例如 `JWT_SECRET`)。

## 本地开发

使用 Wrangler CLI 在本地运行开发服务器。这会自动重新加载代码更改。

```bash
npm run dev
```

或者

```bash
npm run start
```

开发服务器将在 `http://localhost:8787` 上启动。

## 测试

项目使用 `vitest` 进行单元测试。运行以下命令来执行测试：

```bash
npm run test
```

## 部署

将应用程序部署到 Cloudflare Workers。

```bash
npm run deploy
```

该命令会打包并上传您的 Worker 代码、静态资源和配置到 Cloudflare 网络。
