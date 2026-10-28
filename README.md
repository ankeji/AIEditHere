# AIEditHere · 网页版 opencode 控制台

在网页里输入需求 → 让 AI 拆解成可执行的任务清单 → 逐条交给 opencode 真正改代码 → 实时看到每个需求点的完成情况。

首页是**项目管理**：每个项目对应一个本地文件夹；点进项目后是三栏工作台（类似 `vue ui` 的可视化面板）：

| 第 1 栏 | 第 2 栏 | 第 3 栏 |
| --- | --- | --- |
| **需求**：输入框 + 需求列表，每条需求带「拆解 / 执行 / 中止」按钮 | **需求拆解**：AI 拆出的任务清单、进度条、实时执行日志 | **已完成**：执行完成的需求点、模型总结、失败项与重试 |

## 特性

- **项目化管理**：新建项目时支持一次勾选多个本地文件夹（不存在可自动创建），每个文件夹创建一个项目；项目下的所有需求都写在这个目录里，代码不会跑到别处
- **项目类型**：每个项目可以标记为「前端 / 后端」；前端项目可配置启动命令、预览地址和进入项目时自动启动
- **浏览器式预览页签**：进入前端项目会自动打开预览页签并启动服务；可以继续添加当前项目、其他前端项目或任意自定义网址的页签，页签可关闭、切换，预览地址随时可改
- **三栏可视化**：需求 → 拆解 → 完成，全流程一屏可见
- **AI 拆解**：用 opencode 的 `json_schema` 结构化输出，把一句话需求拆成 3~8 个可独立执行、可验收的任务
- **真执行**：每个任务都在同一个 opencode 会话里顺序执行，模型直接读代码、改代码、自检
- **实时日志**：订阅 opencode 的 SSE 事件流，工具调用、模型输出实时流式显示在任务卡片里；前端预览服务也有独立的运行日志
- **可恢复**：项目、需求、任务状态、日志持久化在 `server/data/state.json`，服务重启不丢
- **演示模式**：没装 opencode 也能先看界面（本地模拟拆解与执行，不改任何真实代码）
- **自动拉起**：检测不到 opencode 服务时，自动执行 `opencode serve`（需本机已安装 opencode）

## 目录结构

```
ai-auto-code/
├── server/                 # Node + Express 后端
│   └── src/
│       ├── index.js        # HTTP API、SSE、自动启动 opencode
│       ├── opencode.js     # opencode HTTP API 客户端（会话/消息/中止/事件流）
│       ├── executor.js     # 拆解 + 执行引擎
│       ├── runner.js       # 前端项目启动 / 停止 / 重启 / 运行日志
│       ├── projectProfile.js # 根据 package.json 推断项目类型和启动方式
│       ├── store.js        # 项目 / 需求 / 日志的持久化
│       ├── projectPath.js  # 项目本地目录解析（支持 ~、自动创建）
│       ├── config.js       # 全局配置（地址、模型、默认项目目录、演示模式）
│       ├── auth/           # 登录注册：MySQL、验证码、会话、鉴权中间件
│       └── data/           # 运行时数据（state.json / config.json）
└── web/                    # Vue 3 + Vite 前端
    └── src/
        ├── App.vue         # 顶栏、状态提示、路由
        ├── components/     # 项目页、工作台三栏、浏览器式页签、预览面板、各类弹窗
        └── lib/store.js    # 全局状态 + SSE 订阅 + 哈希路由 + 页签持久化
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 安装并配置 opencode（真实执行时必需）

```bash
npm i -g opencode-ai      # 或: curl -fsSL https://opencode.ai/install | bash
opencode auth login       # 配置模型（Claude / GPT / Gemini 等）
opencode serve            # 默认监听 http://127.0.0.1:4096
```

也可以不在终端启动：AIEditHere 会在检测不到服务时自动执行 `opencode serve`（需把 `opencode` 放进 PATH）。

### 3. 启动界面

```bash
npm run dev     # 开发模式：后端 4400 + 前端 5173（访问 http://localhost:5173）
```

生产方式：

```bash
npm run build   # 构建前端
npm start       # 单端口启动，访问 http://localhost:4400
```

## 使用流程

### 第一步：创建项目

1. 打开首页（项目列表），点 **新建项目**；
2. 点 **选择文件夹（可多选）**，在目录浏览器里勾选一个或多个本地文件夹；每个文件夹会生成一个项目，也可以手动输入路径追加；
3. 在项目卡片里为每个项目选择 **前端 / 后端**：
   - **前端**：必须填写启动命令（如 `npm run dev`）和预览地址（如 `http://localhost:8080/#/`），可以选择进入项目时自动启动；
   - **后端**：只用于需求开发，不自动启动预览服务；
4. 保存后点卡片上的 **进入并预览**，前端项目会自动打开预览页签并启动服务。

> 项目目录就是 opencode 干活的位置：项目下所有需求产生的代码、文件都会被写进这个文件夹，不会跑到别处。
> 后端通过 opencode 的 `x-opencode-directory` 机制把会话绑定到该目录，所以多个项目可以共用同一个 opencode 服务。

### 预览页签

- 进入前端项目后会自动切到预览页签；页签栏右侧的 **+** 可以继续添加：
  - 当前项目预览
  - 其他前端项目的预览
  - 任意自定义网址（如 `http://localhost:3000/`）
- 预览工具栏可以直接修改地址并回车打开，也可以刷新、在新窗口打开、启动 / 停止 / 重启服务、查看运行日志
- 启动命令的输出里如果检测到实际访问地址，会提示一键使用该地址
- 页签会自动保存在浏览器本地，再次进入项目时恢复

> 如果预览区域空白，可能是目标站点通过 `X-Frame-Options` 禁止被嵌入，点右上角 **新窗口** 直接打开即可。

### 第二步：写需求、拆解、执行

1. **第 1 栏**输入需求文本（`Ctrl`/`⌘` + `Enter` 快速提交），点「添加需求」。
2. 点需求卡片上的 **拆解** 只生成任务清单；点 **拆解并执行** 则拆完直接开跑。
3. **第 2 栏**显示任务清单与总体进度，任务执行时展开终端风格的实时日志（模型输出、工具调用）。
4. **第 3 栏**实时汇总已完成的需求点与模型总结；失败任务可以单独重试。
5. 顶栏左侧可随时 **返回项目列表**；「设置」里可以改 opencode 服务地址、模型（`provider/model`）、Agent、自动启动开关、演示模式。

> 规则：**已完成的需求不能再重新拆解**（前端不显示拆解按钮，后端也会拒绝该请求），
> 想继续做新内容请新建一条需求。

## API 速览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/state` | 全部项目 + 需求 + 配置 + opencode 连接状态 |
| `GET` | `/api/health` | opencode 健康检查（`?force=1` 跳过缓存） |
| `PUT` | `/api/config` | 修改配置（地址/模型/默认项目目录/演示模式…） |
| `POST` | `/api/opencode/reconnect` | 重新连接 / 拉起 opencode |
| `GET` | `/api/projects` | 项目列表 |
| `POST` | `/api/projects` | 新建项目 `{ name, path, description?, type?, startCommand?, previewUrl?, autoStart?, create? }` |
| `PATCH` | `/api/projects/:id` | 修改项目（名称 / 目录 / 描述 / 类型 / 启动命令 / 预览地址 / 自动启动） |
| `DELETE` | `/api/projects/:id` | 删除项目（连同项目下的需求，并停止预览服务） |
| `GET` | `/api/projects/:id/run` | 前端项目运行状态 + 日志 |
| `GET` | `/api/projects/:id/run/logs` | 前端项目运行日志 |
| `POST` | `/api/projects/:id/start` | 启动前端项目的启动命令 |
| `POST` | `/api/projects/:id/stop` | 停止前端项目的启动命令 |
| `POST` | `/api/projects/:id/restart` | 重启前端项目的启动命令 |
| `POST` | `/api/requirements` | 新建需求 `{ text, projectId? }` |
| `POST` | `/api/requirements/:id/split` | AI 拆解需求（已完成的需求会被拒绝） |
| `POST` | `/api/requirements/:id/execute` | 执行任务（可传 `{ taskIds }` 只跑部分） |
| `POST` | `/api/requirements/:id/abort` | 中止执行 |
| `POST` | `/api/requirements/:id/tasks/:taskId/retry` | 重试单个任务 |
| `DELETE` | `/api/requirements/:id` | 删除需求 |
| `GET` | `/api/events` | SSE：`state` / `log` / `health` / `toast` 事件 |

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `PORT` | 后端端口，默认 `4400` |
| `OPENCODE_URL` | opencode 服务地址，默认 `http://127.0.0.1:4096` |
| `OPENCODE_MODEL` | 模型，格式 `provider/model` |
| `OPENCODE_AGENT` | 使用的 agent，如 `build` / `plan` |
| `AIEDITHERE_PROJECT` | 默认项目目录（新建项目时的初始值，默认仓库根目录） |
| `AIEDITHERE_DATA` | 数据目录（默认 `server/data`） |
| `DEMO` | `1` 开启演示模式 |
| `MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` | MySQL 连接信息 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | 邮箱 SMTP 配置（可选） |

## 登录与注册

AIEditHere 现在要求登录后才能使用。注册使用**邮箱验证码**：服务端向邮箱发送 6 位数字验证码，验证码 10 分钟内有效，注册时再提交验证码完成账号创建。

用户数据、会话和验证码都保存在 **MySQL** 中，启动时会自动创建数据库与表，无需手动建表。

### 1. 准备 MySQL

确保本机 MySQL 服务已启动（默认端口 3306）。在根目录创建 `.env`（可复制 `.env.example`）并填写连接信息：

```bash
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=你的 MySQL 密码
MYSQL_DATABASE=aiedithere
```

### 2. 配置邮箱 SMTP（可选）

如果需要真实发送注册验证码，请配置 SMTP：

```bash
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=1
SMTP_USER=your@qq.com
SMTP_PASS=邮箱授权码
SMTP_FROM=your@qq.com
```

未配置 SMTP 时，验证码会打印到服务端控制台，并在本地登录页自动填入，方便开发调试。生产环境建议设置 `AUTH_ALLOW_DEV_CODE=0` 关闭该行为。

### 3. 登录相关环境变量

| 变量 | 说明 |
| --- | --- |
| `AUTH_SECRET` | 会话签名/验证码哈希使用的密钥，生产环境请改为随机长字符串 |
| `AUTH_SESSION_DAYS` | 登录有效期（天），默认 `14` |
| `AUTH_CODE_TTL_MINUTES` | 验证码有效期（分钟），默认 `10` |
| `AUTH_CODE_COOLDOWN_SECONDS` | 同一邮箱两次获取验证码的最小间隔（秒），默认 `60` |
| `AUTH_ALLOW_DEV_CODE` | 未配置 SMTP 时是否允许返回调试验证码，默认 `1` |
| `AUTH_COOKIE_SECURE` | 使用 HTTPS 时设为 `1`，让登录 Cookie 只走安全连接 |

### 4. 登录 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/auth/request-code` | 发送注册验证码 `{ email }` |
| `POST` | `/api/auth/register` | 注册并登录 `{ email, code, password, name? }` |
| `POST` | `/api/auth/login` | 登录 `{ email, password }` |
| `POST` | `/api/auth/logout` | 退出登录 |
| `GET` | `/api/auth/me` | 当前登录用户 |

除 `/api/health`、`/api/auth/*` 外，所有 `/api/*` 接口与 `/api/events` SSE 都需要登录。

## 实现要点后端调用 opencode 时带 `x-opencode-directory`（GET 走 `?directory=`），把会话绑定到该目录，opencode 的读写只发生在这个文件夹里；多个项目共用同一个 opencode 服务互不干扰。
- **拆解**：新建 opencode 会话 → 用 `json_schema` 结构化输出拿到 `tasks[]`（标题 + 描述 + 验收标准）→ 兼容纯 JSON 文本与 Markdown 列表兜底解析。
- **执行**：同一条需求共用一个 opencode 会话，任务按顺序串行执行（避免同时改同一批文件），每个任务的 prompt 都带整体需求与项目目录作为上下文；完成后提取模型总结写入第 3 栏。
- **实时性**：后端订阅 opencode `/event` SSE，按 `sessionID` 过滤出当前任务的文本增量与工具调用，转成 `log` 事件推给前端。
- **已完成保护**：需求状态为 `done` 时，前端隐藏拆解入口，后端 `POST /api/requirements/:id/split` 直接返回 400。
- **安全**：所有写操作只作用于各项目目录内的 opencode 会话；AIEditHere 自身不执行任何 shell 命令。


