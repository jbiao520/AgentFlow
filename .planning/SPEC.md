# AgentMind 产品开发规格（v1.0）

> 本文件是开发用产品规格：定义「做什么 / 怎么构成 / 如何验收」。
> 执行节奏以 `.planning/ROADMAP.md` 与各 phase 的 `PLAN.md` 为准。
> UI 真源：`ai-agent-platform.html`。

## 1. 产品定位

**AgentMind** 是安装在 macOS 上的本地 App，定位为用户的「个人 AI 大脑与执行系统」。

- **大脑**：调度中枢理解目标，选择 Agent / Skill / 模型与 reasoning
- **执行**：在绑定的代码仓库工作区里，通过 CLI（cursor-agent / codex / opencode）落地任务
- **可见**：全局拓扑、任务 DAG、实时日志、产物与历史均可回溯（SQLite）

一句话价值：把散落的 Agent 仓库与多种 CLI，收成一个可调度、可观测的个人自动化控制台。

## 2. 核心概念

| 概念 | 定义 |
|------|------|
| **Agent** | 一个可调度单元，**1:1 绑定一个 Workspace（本地路径或 Git Repo）** |
| **Skill** | Workspace 内技能文档（默认 `.agent/skills/*.md`），可启用/禁用 |
| **CLI Engine** | 执行驱动：`cursor-agent` / `codex` / `opencode` |
| **Model Profile** | Preferred Model + Reasoning Effort +（可选）Temperature + 自动路由开关 |
| **Orchestrator** | 调度中枢专用配置（独立 CLI + Model + Reasoning），与业务 Agent 配置分离 |
| **Goal** | 用户在调度中枢输入的综合目标 |
| **Plan** | Orchestrator 产出的意图分析 + 子任务列表 + 路由矩阵（Dispatch 前可人工确认） |
| **Task Run** | 一次已分发的执行实例，含 DAG 节点、状态、日志、产物 |
| **Artifact** | 执行产物（如 `summary.md`、JSON），相对 Workspace 路径存储并在 UI 预览 |

## 3. 用户主流程

### 3.1 注册 Agent

1. 打开 Agent 矩阵 →「导入/新建 Agent 工作区」
2. 填写：标识名、Workspace 路径或 Git URL、默认 CLI
3. 系统校验路径/克隆（若 Git URL）→ 扫描 Skill → 写入 SQLite
4. 进入 Agent 详情，配置模型与 reasoning，可选跑沙盒测试

### 3.2 配置调度中枢

1. 设置（或调度中枢侧栏）配置 Orchestrator：CLI / Model / Reasoning
2. 该配置仅用于意图分析与拆解，不替代子任务上的 Agent 引擎

### 3.3 目标 → 执行

1. 调度中枢输入 Goal（或选快捷模版）→ Orchestrate
2. 展示：意图分析、子任务拆解、Agent/Skill/Model 路由表
3. 用户确认 → Dispatch
4. 运行时按 DAG 依赖在各 Workspace 调对应 CLI；任务中心实时更新
5. 节点失败可「重试」或「人工跳过」；全部完成后可查看产物

### 3.4 观测

- 总览：Agent 健康、运行中任务、今日完成、Token/Reasoning 粗指标、协同拓扑、队列
- 任务中心：历史列表、DAG、按 Agent 过滤的日志流、产物预览
- Cmd+K：快速跳转与触发常用动作

## 4. 信息架构（页面）

对齐原型 5 视图：

| 视图 | 职责 | 关键组件 |
|------|------|----------|
| **全局总览** | 系统健康与队列入口 | 指标条、协同拓扑、任务队列表 |
| **Agent 矩阵** | 发现与管理 Agent | 搜索/筛选、卡片网格、导入弹窗 |
| **Agent 详情** | 单 Agent 配置与 Skill | CLI/Model/Reasoning、Skill 列表与开关、沙盒终端 |
| **调度中枢** | Goal → Plan → Dispatch | Prompt 区、模版 Chip、拆解步骤卡、路由表 |
| **任务中心** | Run 观测与干预 | 历史列表、DAG、日志终端、产物、重试/跳过 |

侧栏常驻：**CLI Engines 状态**（探测本机 CLI 是否可用）。

## 5. 功能需求（v1 必须）

### 5.1 Agent 管理

- CRUD：导入、编辑标识/路径/默认引擎、删除（软删或确认硬删）
- 展示：名称、职责摘要、仓库/路径、运行状态（Idle/Working/Error）、最近任务、Skill 标签、当前模型 pill
- 筛选：关键词、状态、CLI 引擎
- Git URL：v1 支持 clone 到用户选定本地目录后绑定；已有本地路径直接绑定

### 5.2 Skill 管理

- 来源：仅扫描绑定 Workspace 内 Skill 目录（默认 `.agent/skills/**/*.md`）
- 解析：文件名 + frontmatter/首段作为描述；原文可预览
- 启用开关：按 Agent 维度持久化（禁用则编排与执行不得选用）
- 「同步 Workspace Skill」：重新扫描并 diff 增删

### 5.3 Model / CLI 配置

- Agent 级：CLI Engine、Preferred Model、Reasoning（Low/Medium/High）、Temperature、自动按任务路由、引擎相关选项（如 Playwright headless）
- Orchestrator 级：独立 CLI / Model / Reasoning
- 自动路由：子任务 Dispatch 时可根据任务标签/复杂度覆盖 reasoning 或模型（规则可先做简单启发式，Orchestrator 输出优先）

### 5.4 调度中枢

- 输入 Goal + 快捷模版
- 调用 Orchestrator CLI，传入：Goal、当前 Agent 目录（职责、Skill、引擎、模型）、输出 schema（JSON）
- UI 渲染 Plan；允许用户在 Dispatch 前放弃或重新 Orchestrate
- Dispatch：创建 Task Run + DAG 节点，入队执行

### 5.5 任务中心

- 列表：状态、进度、耗时、关联 Agent
- DAG：节点状态（pending/running/success/failed/skipped）、依赖边
- 日志：合并流 + 按 Agent 过滤；可暂停/清空/复制
- 产物：节点声明的 artifact 路径，文本预览 + 复制
- 干预：失败节点重试；人工跳过（下游依赖策略：标记 skipped 并继续可运行节点）

### 5.6 全局总览

- 真实聚合 SQLite + 运行时状态（非写死数字）
- 拓扑：Orchestrator + Agent 节点；边可来自「近期任务协作」或静态能力关系（v1 优先：当前 Run 的协作边 + 已注册 Agent）

## 6. 领域数据模型（SQLite）

```text
agents
  id, name, description, workspace_path, git_url, default_cli,
  status, created_at, updated_at

agent_model_profiles
  agent_id, preferred_model, reasoning_effort, temperature,
  auto_route, engine_options_json

skills
  id, agent_id, relative_path, title, description, enabled, content_hash, scanned_at

orchestrator_settings
  id=1, cli_engine, model, reasoning_effort, updated_at

goals
  id, prompt, template_key, created_at

plans
  id, goal_id, analysis_json, created_at  -- 含 intent、subtasks、routing

task_runs
  id, goal_id, plan_id, status, progress, started_at, finished_at, error

task_nodes
  id, run_id, seq, title, agent_id, skill_ids_json, cli_engine, model,
  reasoning_effort, depends_on_json, status, started_at, finished_at,
  artifact_paths_json, retry_count

task_logs
  id, run_id, node_id, ts, agent_name, level, message

cli_engine_status  -- 可缓存探测结果
  engine, available, version, last_checked_at

templates  -- 可复用执行模版（参数化 Goal + Plan）
  id, name, description, source_goal_id, source_plan_id, source_run_id,
  goal_prompt, plan_json, variables_json, created_at, updated_at
```

说明：日志量大时可按 Run 分文件落盘（`~/Library/Application Support/AgentMind/logs/{run_id}.jsonl`），SQLite 只存索引与摘要。

## 7. 技术架构

```text
┌─────────────────────────────────────────────┐
│  Web UI (原型演进: HTML/CSS/TS)              │
│  总览 / Agents / Detail / Commander / Tasks │
└──────────────────┬──────────────────────────┘
                   │ Tauri IPC / commands
┌──────────────────▼──────────────────────────┐
│  Tauri Core (Rust)                          │
│  - Agent/Skill/Settings/Task services       │
│  - SQLite (rusqlite / sqlx)                 │
│  - Process supervisor (spawn CLI, pty/pipe) │
│  - FS: skill scan, artifact read            │
└──────────────────┬──────────────────────────┘
                   │ subprocess
        ┌──────────┼──────────┐
        ▼          ▼          ▼
   cursor-agent   codex    opencode
   (cwd=Agent workspace)
```

### 7.1 前端

- 从 `ai-agent-platform.html` 拆分为可维护结构（建议 Vite + TS；可先单页模块化再组件化）
- 状态：UI 状态本地；权威数据经 IPC 读写后端
- 视觉：保留原型 macOS Light tokens（色板、侧栏、卡片、终端）

### 7.2 后端职责

- **Registry**：Agent / Skill / Profile CRUD
- **Scanner**：Skill 目录扫描与 hash
- **OrchestratorClient**：按 settings 调 CLI，解析 Plan JSON
- **Runner**：按 DAG 调度节点、并发策略（v1：同 Run 内按依赖串行就绪节点，默认同时最多 1–2 个 CLI）
- **LogBroker**：stdout/stderr → 前端事件流 + 持久化
- **CliProbe**：启动时/手动检测三引擎可用性

### 7.3 CLI 适配约定（v1）

统一抽象：

```text
run(engine, {
  cwd, prompt, model?, reasoning?, extra_args?, env?
}) -> AsyncIterator<LogEvent> + ExitCode
```

各引擎具体 flags 在 Phase 4 对照本机已装 CLI 文档落地；适配层隔离差异，UI 不直拼命令。

Orchestrator 调用须要求 **结构化输出**（JSON Plan）。解析失败：展示原始输出并允许重试，不自动 Dispatch。

### 7.4 Plan JSON Schema（约定）

```json
{
  "intent": { "summary": "...", "tags": ["web-automation"] },
  "subtasks": [
    {
      "id": "t1",
      "title": "...",
      "agent": "web-browser-ops",
      "skills": ["playwright-crawler.md"],
      "depends_on": [],
      "cli_engine": "cursor-agent",
      "model": "claude-3.7-sonnet",
      "reasoning_effort": "medium",
      "prompt": "给该 Agent 的具体执行指令"
    }
  ]
}
```

校验：agent 必须已注册；skills 必须存在且 enabled；未知字段忽略。

## 8. 非功能需求

- **本地优先**：无强制登录；密钥沿用各 CLI 自身配置（~/.config 等）
- **安全**：仅在用户授权的 Workspace 路径执行；不任意扩大 FS 访问；展示将执行的命令摘要
- **性能**：Skill 扫描 < 2s（百级 md）；日志 UI 虚拟化或截断（保留最近 N 行 + 全量落盘）
- **可观测**：每个节点保留 exit code、时长、重试次数
- **打包**：`tauri build` 产出 `.app`；开发用 `tauri dev`

## 9. 与原型的映射

| 原型交互 | v1 行为 |
|----------|---------|
| Toast / 假数据 | 改为真实 IPC 结果 |
| `startOrchestration` | 调 Orchestrator CLI + 渲染 Plan |
| `dispatchCommanderTask` | 持久化 Run 并启动 Runner |
| `runSandboxTest` | 单 Agent 单次 CLI |
| 日志模拟定时器 | 真实 process stream |
| CLI widget 3/3 Active | CliProbe 结果 |
| 统计数字 | SQL 聚合 |

## 10. 验收标准（v1.0 发布门禁）

1. 冷启动后可看到上次导入的 Agents、Skills 开关、Orchestrator 设置、历史 Runs
2. 至少用 **两种** 不同 CLI 引擎各跑通一次沙盒或节点任务（本机已安装的前提下）
3. 一条跨 2+ Agent 的 Goal：Orchestrate → 确认 → DAG 执行 → 日志可见 → 至少 1 个产物可预览
4. 人为制造节点失败：重试可恢复，或跳过后下游按策略继续
5. 五个主视图无死链；Cmd+K 可跳转；macOS `.app` 可启动

## 11. 后续（明确不进 v1）

- 定时 Cron 触发 Goal、Webhook 入站
- 更复杂的并发/优先级队列
- 云端 Agent 目录同步
- Windows/Linux
- 可视化拖拽编辑 DAG

## 12. 文档与代码索引

| 路径 | 用途 |
|------|------|
| `.planning/BRIEF.md` | 愿景与成功标准 |
| `.planning/ROADMAP.md` | 阶段与进度 |
| `.planning/SPEC.md` | 本规格（产品+技术） |
| `.planning/phases/*` | 可执行 PLAN / SUMMARY |
| `ai-agent-platform.html` | UI 原型真源 |
