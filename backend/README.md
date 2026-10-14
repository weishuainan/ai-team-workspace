# AI 产运协作工作台

## 自托管账号

应用内置独立账号体系，无需连接任何企业身份服务。用户可以直接在登录页注册用户名、显示名称、邮箱和密码。密码使用带随机盐的 PBKDF2-SHA256 哈希保存，登录态使用 HttpOnly Cookie。

生产环境必须设置稳定、足够长的 `JWT_SECRET`；修改该值会使现有登录会话失效。

## Agent Runtime

阶段中的每个 Agent 任务通过统一模型网关调用用户选择的模型。网关原生支持 OpenAI Responses API、OpenAI Chat Completions、Azure OpenAI、Anthropic Messages、Google Gemini GenerateContent 和 Ollama Chat；同时提供 OpenAI-compatible 模式，可连接 DeepSeek、通义千问、Kimi、智谱 GLM、MiniMax、OpenRouter、Groq、Together、Mistral、xAI、SiliconFlow、vLLM 等兼容服务。每个 Agent 使用 `IDENTITY.md`、`SOUL.md`、`AGENT.md` 与有序挂载的 Skill 文件夹生成运行快照；运行记录会如实展示实际协议、模型、Token 用量与失败状态。

用户可以在「Agent 与 Skill → 模型连接」中选择接口协议，并保存自己的 Base URL、模型名、API 版本和 API Key；配置按登录用户隔离，API Key 加密存储且不会回传到浏览器。未设置个人配置时，系统使用 `MODEL_PROVIDER`、`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`MODEL_NAME` 和 `MODEL_API_VERSION` 环境变量。生产环境必须设置稳定的 `MODEL_CONFIG_ENCRYPTION_KEY`，否则服务重启并更换密钥后将无法解密已保存的凭证。

模型调用失败时任务会明确标记为失败，不会再用模板伪装为模型产出。本地联调可显式设置 `AGENT_TEST_MODE=1`，此时任务会跳过真实模型请求，直接使用带有 `local-test-template` 标识的确定性模板，便于快速完成端到端验收。

示例：

```bash
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1
MODEL_PROVIDER=openai_responses
MODEL_NAME=gpt-5-mini
MODEL_CONFIG_ENCRYPTION_KEY=replace-with-a-long-random-secret
```

比赛演示可设置 `AGENT_DEMO_MODE=1`。系统会优先调用真实模型，并在 `AGENT_MODEL_TIMEOUT_SECONDS`（默认 110 秒）后切换到带有 `demo-fallback-template` 标识的备用产出；界面会明确展示备用来源，不会冒充真实模型结果。正式线上环境不要开启该模式。

项目工作流保存为版本化的 `stage nodes + edges` DAG。每个阶段可以配置名称、说明、多个参与成员、零到多个审核人、多个 Agent 及 Agent 串并行模式；同一个 Agent 可以被多个阶段复用。前端拖拽会生成对应 DAG，后端负责依赖计算、环路拒绝、并行就绪和任务租约恢复。未设置审核人的阶段产出自动进入共享 Context；设置审核人后，仅被指定成员可以通过或驳回。

上传的 Skill 必须以 `SKILL.md` 为入口，可包含 `references/`、`scripts/` 和 `assets/`。当前只开放列目录与读取文本两个安全工具，不会直接执行用户上传脚本。

项目资料会在 Agent 任务创建时进入版本化输入快照。文本、Markdown、CSV、JSON、YAML、PDF、DOCX、PPTX 和 XLSX 会提取为只读证据，并记录文件名、提取状态与截断状态；资料中的提示词不会被视为系统指令。

所有业务接口都要求登录。项目数据仅对 Owner 与成员可见，项目设置、工作流、Context 变更和通知配置仅允许 Owner/Admin 修改。

## 数据持久化

线上环境必须设置 `DATABASE_URL`，使用 PostgreSQL 保存项目数据；未设置时仅用于本地开发，数据会写入当前目录的 `ai_team.db`，容器重新部署后可能丢失。

如需公开演示项目，可以设置 `PUBLIC_DEMO_PROJECT_ID`，向所有已登录用户开放该项目的负责人级权限。

示例：

```bash
DATABASE_URL=postgresql://user:password@host:5432/ai_team
```

## 项目数据恢复

`sync_projects.py` 会按 Owner 筛选本地项目，并恢复项目、消息、产出、Agent 任务、文件及审计记录。接口按原始 ID 幂等写入，重复执行不会重复创建。

```bash
SYNC_API_KEY=your-sync-key python3 sync_projects.py --owner-username your-username --owner-name 你的姓名
```

只检查本地待恢复数据：

```bash
python3 sync_projects.py --owner-username your-username --owner-name 你的姓名 --dry-run
```
