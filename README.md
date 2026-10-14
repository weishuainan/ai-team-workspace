# AI Team Workspace

一个可自托管、支持多模型的 AI 产品协作工作台。把需求澄清、用户洞察、MRD、方案设计、UX、PRD 和质量评审组织成可编排的多 Agent 工作流。

![AI Team Workspace](frontend/public/ai-team-logo.png)

## 特性

- **独立账号体系**：用户可直接注册、登录和退出，无需企业 SSO。
- **多模型网关**：支持 OpenAI Responses、OpenAI Chat Completions、Azure OpenAI、Anthropic、Gemini、Ollama，以及 OpenAI-compatible 服务。
- **广泛模型兼容**：可连接 DeepSeek、通义千问、Kimi、智谱 GLM、MiniMax、OpenRouter、Groq、Together、Mistral、xAI、SiliconFlow、vLLM、LM Studio 等。
- **多 Agent 工作流**：内置需求澄清、洞察、MRD、方案、UX、PRD、评审 Agent，也可以创建自定义 Agent。
- **可视化 DAG 编排**：支持阶段依赖、并行任务、成员和审核人配置。
- **Skill 资产库**：以 `SKILL.md` 为入口上传和复用 Skill 文件夹。
- **项目知识上下文**：支持文本、Markdown、CSV、JSON、YAML、PDF、DOCX、PPTX、XLSX 文件。
- **用户级模型配置**：每个用户可独立设置模型、接口地址和 API Key；密钥在服务端加密保存。
- **完全自托管**：支持 SQLite、PostgreSQL 和 MySQL，不依赖内部服务。

## 界面与架构

```text
Browser (React + Vite)
        │
        ▼
FastAPI ── Account / Project / Workflow / Skill APIs
        │
        ├── Model Gateway
        │   ├── OpenAI Responses / Chat Completions
        │   ├── Azure OpenAI
        │   ├── Anthropic Messages
        │   ├── Gemini GenerateContent
        │   ├── Ollama Chat
        │   └── OpenAI-compatible providers
        │
        └── SQLite / PostgreSQL / MySQL
```

## 快速开始

### 环境要求

- Python 3.11+
- Node.js 18+
- npm 9+

### 1. 启动后端

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

至少修改以下密钥：

```dotenv
JWT_SECRET=replace-with-a-long-random-secret
MODEL_CONFIG_ENCRYPTION_KEY=replace-with-another-long-random-secret
```

启动服务：

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

后端健康检查：<http://localhost:8000/health>
API 文档：<http://localhost:8000/docs>

### 2. 启动前端

```bash
cd frontend
npm install
VITE_API_BASE_URL=http://localhost:8000/api/v1 npm run dev
```

打开 <http://localhost:5173>，注册账号后即可使用。

### 3. 配置模型

登录后进入：

```text
Agent 与 Skill → 模型连接
```

选择接口协议，填写 Base URL、模型名称和 API Key，然后点击“测试连接”。API Key 不会返回给浏览器。

也可以通过后端环境变量提供默认模型：

```dotenv
MODEL_PROVIDER=openai_responses
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=sk-...
MODEL_NAME=gpt-5-mini
MODEL_API_VERSION=
```

`MODEL_PROVIDER` 可选值：

| 值 | 协议 |
| --- | --- |
| `openai_responses` | OpenAI Responses API |
| `openai_chat` | OpenAI Chat Completions |
| `openai_compatible` | OpenAI-compatible Chat Completions |
| `azure_openai` | Azure OpenAI |
| `anthropic` | Anthropic Messages API |
| `gemini` | Google Gemini GenerateContent |
| `ollama` | Ollama Chat API |

## 数据库

未设置 `DATABASE_URL` 时使用本地 SQLite。生产环境建议使用 PostgreSQL：

```dotenv
DATABASE_URL=postgresql://user:password@localhost:5432/ai_team
```

MySQL 示例：

```dotenv
DATABASE_URL=mysql://user:password@localhost:3306/ai_team
```

启动时会自动创建表，并兼容升级已有数据库字段。

## 测试与构建

后端：

```bash
cd backend
python3 -m unittest discover -s tests -v
```

前端：

```bash
cd frontend
npm run lint
npm run build
```

## 目录结构

```text
.
├── backend/
│   ├── app/main.py           # FastAPI、账号、项目与工作流
│   ├── app/model_gateway.py  # 多模型协议适配层
│   ├── data/                 # 内置 Agent 与 Skill
│   └── tests/                # 后端测试
├── frontend/
│   ├── src/main.tsx          # React 应用
│   └── src/*.css             # 界面样式
└── README.md
```

## 安全说明

- 生产环境必须设置稳定且不同的 `JWT_SECRET` 与 `MODEL_CONFIG_ENCRYPTION_KEY`。
- 不要提交 `.env`、数据库文件、模型密钥或构建产物。
- 面向公网部署时，建议在反向代理层启用 HTTPS、请求限流和安全响应头。
- 用户提供的模型 Base URL 会由后端访问；多租户部署应额外配置网络出口和 SSRF 防护策略。

## 贡献

欢迎提交 Issue 和 Pull Request。建议在提交前运行后端测试、前端类型检查和生产构建。

## License

[MIT](LICENSE)
