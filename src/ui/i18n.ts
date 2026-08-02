/** Lightweight application localization for the static shell and UI messages. */

export type AppLanguage = "zh" | "en";

const STORAGE_KEY = "agentflow.language";
const LANGUAGE_EVENT = "agentflow-language-change";

const TRANSLATIONS: Record<string, string> = {
  "更快，质量可能略低": "Faster, may trade quality",
  "（估算）": " (estimated)",
  "（含估算）": " (includes estimates)",
  "（请先在模版库创建模版）": "(Create a template in Templates first)",
  "（无描述）": " (no description)",
  "(已保存，当前不可用)": "(saved, currently unavailable)",
  "] 的全量配置": "]",
  "」？": "”?",
  "← Agent 矩阵": "← Agents",
  "← Agents": "← Agents",
  "⏸ 暂停日志流": "⏸ Pause log stream",
  "▶ 恢复日志流": "▶ Resume log stream",
  "0 运行": "0 running",
  "5 段：分 时 日 月 周，按本地时间（例如工作日 09:00）。下次执行时间由表达式自动计算。": "5 fields: minute hour day month weekday, in local time (e.g. weekdays at 09:00). Next run is computed from the expression.",
  "按 7 日调用排序": "Sorted by 7-day usage",
  按间隔重复: "Repeat on interval",
  "按引擎 / 模型汇总 · 累计全部任务": "By engine / model · across all tasks",
  版本: "Version",
  版本信息与本地数据目录: "Version information and local data directory",
  版本与数据目录: "Version and data directory",
  "绑定模版并设置触发方式后创建。": "Create after binding a template and setting the trigger.",
  保存: "Save",
  "保存 Agent 配置": "Save agent config",
  保存模版: "Save template",
  保存配置: "Save configuration",
  保存为模版: "Save as template",
  保存修改: "Save changes",
  "本次运行并行度；不写回 Plan": "Concurrency for this run only; not written back to the plan",
  必填: "Required",
  变量: "Variables",
  标签: "Label",
  并发: "Concurrency",
  "并写入 SQLite。": " and save the results to SQLite.",
  "补充说明（可选）": "Additional notes (optional)",
  不可用: "Unavailable",
  "查看 任务": "View Tasks",
  "查看 任务中心": "View Tasks",
  "查看 DAG、填写变量后一键执行，或编辑 Goal / Prompt 文案。": "Review the DAG, fill variables, then run — or edit Goal / Prompt text.",
  "查看 DAG、填写变量后一键执行。": "Review the DAG, fill variables, then run.",
  "查看 Diff": "View Diff",
  "查看 Token 消耗详情": "View token usage details",
  查看结果: "View results",
  查看任务: "View task",
  "查看任务 →": "View tasks →",
  "查看任务中心 →": "View tasks →",
  "查看下次执行时间、编辑调度策略，或点击「新建定时任务」。": "View the next run, edit the schedule, or choose New schedule.",
  拆解: "Breakdown",
  产物列表: "Artifact list",
  产物文件列表: "Artifact file list",
  "产物文件缺失，无法复制": "Artifact file missing — cannot copy",
  "产物文件缺失，无法预览": "Artifact file missing — cannot preview",
  "产物文件尚未生成或不存在。": "Artifact file has not been generated or does not exist.",
  产物预览: "Artifact preview",
  成功率: "Success rate",
  澄清问答: "Clarifying questions",
  "澄清问答 ·": "Clarifying questions ·",
  触发方式: "Trigger",
  触发时注入到模版: "Injected into the template when triggered",
  "窗口使用本地时间；留空表示全天允许": "Times use local timezone; leave empty to allow all day",
  创建: "Create",
  "此操作无法撤销。": "This cannot be undone.",
  "此模版无变量，可直接执行。": "This template has no variables — you can run it directly.",
  "此模版无变量。": "This template has no variables.",
  此模版暂无子任务节点: "This template has no subtask nodes",
  次数: "Runs",
  次执行: " runs",
  "从调度 Orchestrate → Dispatch 后，历史会出现在这里。": "After Orchestrate → Dispatch, history appears here.",
  "从调度中枢 Orchestrate → Dispatch 后，历史会出现在这里。": "After Orchestrate → Dispatch, history appears here.",
  "从任务或调度将已执行的 Plan「保存为模版」。": "Save a completed plan as a template from Tasks or Dispatch.",
  "从任务中心或调度中枢将已执行的 Plan「保存为模版」。": "Save a completed plan as a template from Tasks or Dispatch.",
  "打开 调度": "Open Dispatch",
  "打开 调度中枢": "Open Dispatch",
  "打开 定时调度": "Open Schedules",
  "打开 定时任务": "Open Schedules",
  "打开 模版库": "Open Templates",
  "打开 设置": "Open Settings",
  "打开 Agent 矩阵": "Open Agents",
  "打开 Agents": "Open Agents",
  打开调度: "Open Dispatch",
  打开调度中枢: "Open Dispatch",
  "单 Agent Prompt 沙盒测试": "Single-agent prompt sandbox",
  "单选 + 可选补充 · 提交后直接执行": "Single choice + optional note · runs after submission",
  "当前 Agent 的 CLI 引擎不可用": "This agent",
  "当前没有运行中的任务。": "There are no running tasks.",
  当前无运行任务: "No running tasks",
  导航: "Menu",
  "导入/新建 Agent 工作区": "Import / create agent workspace",
  "导入本地 Workspace 或 Git URL，系统会扫描": "Import a local workspace or Git URL. The app will scan ",
  "导入或新建 Agent 工作区": "Import or create an agent workspace",
  等待当前运行完成后再执行: "Wait for the current run to finish",
  等待开始: "Waiting to start",
  等待任务完成: "Waiting for task completion",
  "底层 CLI 执行引擎": "Underlying CLI engine",
  点击查看明细: "Click for details",
  点击查看详情: "Click to view details",
  点击记录查看任务详情: "Select a record to view task details",
  点击预览: "Click to preview",
  调度: "Dispatch",
  调度拆解失败: "Orchestration failed",
  "调度拆解失败 — 查看原始输出": "Orchestration failed — view raw output",
  调度流程: "Pipeline",
  调度中枢: "Dispatch",
  "调用 Skill": "Invoke skill",
  定时: "Scheduled",
  "定时·手动": "Schedule · manual",
  定时调度: "Schedules",
  定时任务: "Schedules",
  定时任务已保存: "Schedule saved",
  定时任务已创建: "Schedule created",
  "独立于 Worker Agent · 决定拆解与路由所用的 CLI / 模型": "Independent from worker agents · controls the CLI and model used for planning and routing",
  "读 / 写": "Read / Write",
  读取失败: "Read failed",
  发起调度: "Start orchestration",
  发起调度任务: "Start a task",
  "返回 Agent 矩阵": "Back to Agents",
  "返回 Agents": "Back to Agents",
  "放置 Markdown，然后同步。": " in the workspace, then sync.",
  费用: "Cost",
  "费用：OpenCode 等引擎上报真实 cost；Codex / Cursor 等仅有 token 时按内置单价启发式估算，仅供参考，非账单。": "Cost: engines like OpenCode report real cost; for Codex / Cursor and similar token-only engines, cost is a built-in heuristic estimate for reference only — not a bill.",
  "费用来自 CLI 上报的 cost 汇总。": "Cost is summed from CLI-reported cost.",
  "费用为启发式估算，非账单": "Costs are heuristic estimates, not billing",
  "分发并启动 DAG": "Dispatch and start DAG",
  分发执行: "Dispatch and run",
  "分配 Agent": "Assign agent",
  分钟: "Minutes",
  复制: "Copy",
  复制产物: "Copy artifact",
  复制当前产物内容: "Copy current artifact",
  复制日志: "Copy logs",
  复制失败: "Copy failed",
  该节点暂无产物路径: "This node has no artifact paths",
  "该历史任务尚未生成验收报告。重新执行后会自动补齐。": "This past run has no acceptance report yet. Re-run to generate one.",
  "该历史任务尚无最终产物清单。": "This past run has no final artifact list.",
  "改动文件 / Diff": "Changed files / Diff",
  概览: "Overview",
  刚刚: "Just now",
  个澄清问题: " clarifying questions",
  个关联子任务: " related subtasks",
  "个节点，开始执行": " nodes — execution started",
  "个模型 ·": " models ·",
  个失败: " failed",
  "更多模型… 点击查看": " more models… click to view",
  更新于: "Updated",
  "工作区 Skill 技能列表": "Workspace skills",
  "工作区 Workspace 路径 / Git URL": "Workspace path / Git URL",
  "共 0 个": "0 total",
  估算: "Estimated",
  关闭: "Close",
  "关闭 Esc": "Close Esc",
  关闭执行历史: "Close run history",
  关于: "About",
  "关于 AgentMind": "About AgentFlow",
  还没有定时任务: "No schedules yet",
  还没有模版: "No templates yet",
  "还没有注册任何 Agent": "No agents registered yet",
  含估算: "Includes estimates",
  耗时: "Duration",
  合计: "Total",
  基本信息: "Basics",
  技能描述: "Skill description",
  "技能描述。": "skill descriptions.",
  技能同步完成: "Skill sync completed",
  "加载模型中…": "Loading models…",
  "加载指令…": "Loading commands…",
  "加载中…": "Loading…",
  "间隔至少 1 分钟": "Interval must be at least 1 minute",
  "检查 Git URL / 网络，或改为绑定已有本地路径。": "Check the Git URL / network, or bind an existing local path instead.",
  "检查 Orchestrator 输出 JSON 格式（SPEC §7.4）。": "Check the Orchestrator JSON output format (SPEC §7.4).",
  简体中文: "Simplified Chinese",
  "将本地 Markdown 周报转换为适合微信公众号与小红书的排版草稿，整理发布清单并记录排期。": "Convert a local Markdown weekly report into WeChat Official Account and Xiaohongshu layout drafts, prepare a publish checklist, and record the schedule.",
  节点: "Node",
  "节点产物（按 DAG 选择）": "Node artifacts (select from DAG)",
  "结构（只读）": "structure (read-only)",
  结束: "End",
  界面语言: "Interface language",
  外观: "Appearance",
  "浅色 / 深色 / 跟随系统": "Light / Dark / System",
  外观主题: "Appearance theme",
  "选择浅色、深色，或跟随系统外观。默认跟随系统。":
    "Choose light, dark, or follow the system appearance. Defaults to system.",
  主题模式: "Theme mode",
  浅色: "Light",
  深色: "Dark",
  跟随系统: "System",
  "深色主题采用 Deep Slate，适合终端日志、DAG 与 Diff 预览。":
    "Dark theme uses Deep Slate — ideal for terminal logs, DAG, and Diff previews.",
  "外观主题：跟随系统": "Appearance: System",
  "外观主题：浅色": "Appearance: Light",
  "外观主题：深色": "Appearance: Dark",
  今日完成调度: "Tasks completed today",
  "尽量写清对象、频率与验收标准": "Include targets, frequency, and acceptance criteria",
  "近 30 天还没有 Agent 被调度。": "No agents were scheduled in the last 30 days.",
  "近 30 天无调用记录": "No usage in the last 30 days",
  开始: "Start",
  "可编辑文案；DAG 结构不可改": "Editable text; DAG structure is locked",
  "可尝试：安装 / 刷新 CLI · 确认已注册 Agent 名称匹配。": "Try installing/refreshing the CLI, and confirm the registered agent name matches.",
  "可尝试「Finder」打开对应 workspace 目录确认。": "Try Finder to open the workspace folder and confirm.",
  "可点「在 Finder 中显示」打开 workspace / artifacts 目录。": "Use “Reveal in Finder” to open the workspace / artifacts folder.",
  可验收: "Ready for review",
  可用: "Available",
  空表格: "Empty table",
  跨平台文章自动排版发布: "Cross-platform article formatting and publishing",
  快捷示例: "Quick examples",
  "快速搜索 Agent、Skill 或直接触发指令...": "Quick search agents, skills, or commands...",
  "来源节点:": "Source node:",
  来自调度: "From schedule",
  来自任务: "From task",
  立即执行: "Run now",
  "例如: 早间竞品简报": "e.g. Morning competitor brief",
  "例如: my-ops-agent": "e.g. my-ops-agent",
  "例如：每天 9 点巡检官网关键页与核心 API，失败时汇总截图并通知值班；或：监控三家竞品价格，发现降价 5% 以上时生成对比简报…": "e.g. Every day at 9am, check the homepage and core APIs; on failure, collect screenshots and notify on-call — or monitor three competitors and generate a brief when prices drop 5%+…",
  连通健康: "connectivity healthy",
  "路径:": "Path:",
  路由匹配: "Route matching",
  "没有可保存的 Plan": "No plan to save",
  没有可打开的数据库路径: "No database path to open",
  "没有可分发的 Plan — 请先 Orchestrate": "No plan to dispatch — orchestrate first",
  "没有可分发的有效 Plan": "No valid plan to dispatch",
  "没有可分发的有效 Plan — 请先 Orchestrate": "No valid plan to dispatch — orchestrate first",
  没有可预览的产物内容: "No artifact content to preview",
  每日网站巡检测试: "Daily website health check",
  描述: "Description",
  "描述（可选）": "Description (optional)",
  名称: "Name",
  模版: "Template",
  "模版 DAG 拓扑": "Template DAG topology",
  模版变量: "Template variables",
  模版库: "Templates",
  模版已保存: "Template saved",
  模版已更新: "Template updated",
  模版已启动执行: "Template run started",
  模版已删除: "Template deleted",
  模型: "Model",
  模型建议: "Suggested model",
  模型数: "Models",
  模型配置: "Model configuration",
  模型配置已保存: "Model configuration saved",
  "模型与 CLI 驱动配置": "Model & CLI configuration",
  引擎: "Engine",
  推理: "Reasoning",
  加速: "Speed",
  "搜索模型…": "Search models…",
  "默认 CLI 执行引擎": "Default CLI engine",
  默认值: "Default",
  排队中: "Queued",
  "启动无头浏览器，对主站与商城的核心页面执行 UI 巡检与断链检测；若发现加载时延超过 2 秒则记录告警。": "Launch a headless browser to inspect core pages on the main site and storefront for UI issues and broken links; alert if load time exceeds 2 seconds.",
  启动智能调度拆解: "Start smart orchestration",
  "启动中…": "Starting…",
  启用: "Enabled",
  启用中: "Enabled",
  清空: "Clear",
  清空全部执行历史: "Clear all run history",
  "请安装对应 CLI，或点击侧栏左下角状态刷新探测。": "Install the CLI, or refresh status from the lower-left sidebar.",
  "请尝试调整搜索关键词或重置筛选条件，或通过右上角按钮新建导入。": "Try adjusting your search or resetting the filters, or use the button above to import a workspace.",
  "请输入沙盒 Prompt": "Enter a sandbox prompt",
  "请填写 Agent 标识名称": "Enter an agent name",
  "请填写 Cron 表达式": "Enter a Cron expression",
  "请填写 Workspace 路径或 Git URL": "Enter a workspace path or Git URL",
  请填写名称: "Enter a name",
  请填写模版名称: "Enter a template name",
  "请先从 Agent 矩阵选择一个 Agent。": "Select an agent from Agents first.",
  "请先从 Agents 选择一个 Agent。": "Select an agent from Agents first.",
  "请先导入至少一个 Agent，再使用快捷模版": "Import at least one agent before using quick templates",
  "请先回答澄清问题，再提交并执行": "Answer clarifying questions before submitting",
  请先输入调度目标: "Enter an orchestration goal first",
  "请先选择 Agent": "Select an agent first",
  请先选择可用模型: "Select an available model first",
  请先选择失败节点: "Select a failed node first",
  请先选择要取消的任务: "Select a task to cancel first",
  请先选择要跳过的节点: "Select a node to skip first",
  "请先选择一个 Agent": "Select an agent first",
  请先选择一个定时任务: "Select a schedule first",
  请先选择一个任务: "Select a task first",
  请先选择有产物路径的节点: "Select a node with an artifact path first",
  请先在模版库创建模版: "Create a template in Templates first",
  "请先保存为模版，保存成功后可直接设为定时":
    "Save as a template first — then you can set a schedule",
  请先保存为模版以便带变量再跑: "Save as a template first to rerun with variables",
  请在模版库填写变量后执行: "Fill in variables in Templates, then run",
  定时触发的任务无需再保存模版: "Schedule-triggered runs do not need to be saved as templates",
  请选择模版: "Select a template",
  请选择执行时间: "Select a run time",
  取消: "Cancel",
  取消任务: "Cancel task",
  取消执行任务: "Cancel running task",
  "取消中…": "Cancelling…",
  全局总览: "Overview",
  全屏: "Fullscreen",
  全屏阅读产物: "Read artifact fullscreen",
  全网竞品价格监控: "Competitor price monitoring",
  缺失: "Missing",
  "确定删除此定时任务？此操作无法撤销。": "Delete this schedule? This cannot be undone.",
  确认: "Confirm",
  "确认 Workspace 路径存在且可读，或重新选择本地目录。": "Confirm the workspace path exists and is readable, or pick another local folder.",
  确认并保存模版: "Confirm and save template",
  设为定时: "Set schedule",
  再跑一次: "Run again",
  打开模版: "Open template",
  查看模版库: "View templates",
  已完成交付: "Delivery complete",
  部分完成: "Partially complete",
  未完成: "Incomplete",
  "这次跑通了。保存为模版后，下次只填变量即可复用；也可以设为定时自动跑。":
    "This run succeeded. Save as a template to reuse with variables, or set a schedule to run automatically.",
  "这次跑通了。保存为模版后可复用，也可设为定时。":
    "This run succeeded. Save as a template to reuse, or set a schedule.",
  "部分节点已成功。可保存为模版（结构含失败路径），建议先重试失败节点。":
    "Some nodes succeeded. You can save as a template (structure includes failed paths); retry failed nodes first.",
  "下次只需填写变量即可复用。可设为定时自动跑，或立即执行一次。":
    "Next time, just fill in the variables. Set a schedule, or run once now.",
  选择任务后显示交付结论: "Select a task to see the delivery summary",
  已再次启动: "Started again",
  确认并分发: "Confirm and dispatch",
  "确认并分发当前 Plan": "Confirm and dispatch this plan",
  确认并分发任务: "Confirm and dispatch",
  确认操作: "Confirm action",
  确认取消: "Confirm cancel",
  "确认取消任务「": "Cancel task “",
  人工跳过: "Skip manually",
  任务: "Tasks",
  任务拆解: "Task breakdown",
  "任务完成后，点上方产物即可在这里阅读 Markdown / 表格 / 代码。拖动右下角可调整高度，点「全屏」沉浸阅读。": "After the task finishes, select an artifact above to read Markdown, tables, or code here. Drag the lower-right corner to resize, or choose Fullscreen for focused reading.",
  "拖拽调整面板宽度": "Drag to resize panel",
  "拖拽调整宽度 · 双击复位": "Drag to resize · double-click to reset",
  "任务完成后，点左侧产物即可在这里阅读 Markdown / 表格 / 代码。": "After the task finishes, select an artifact on the left to read Markdown, tables, or code here.",
  "任务完成后自动汇总最终产物，并支持直接预览。": "Final artifacts are summarized after the task finishes and can be previewed here.",
  任务完成后自动生成: "Generated after the task finishes",
  任务依赖拓扑: "Task dependency graph",
  "任务依赖拓扑图 (Task DAG)": "Task dependency graph (Task DAG)",
  任务执行历史: "Task run history",
  "任务执行中；完成后会自动生成验收摘要、改动 Diff、最终产物、验证结果和风险说明。": "Task is running. When it finishes, the acceptance summary, diff, artifacts, checks, and risks will appear here.",
  任务中心: "Tasks",
  "任务中心与 DAG 协同": "Tasks",
  任务重叠时: "On overlap",
  任务子目标拆解: "Task sub-goal breakdown",
  沙盒测试完成: "Sandbox test completed",
  沙盒已在运行中: "Sandbox is already running",
  删: "Del",
  删除: "Delete",
  删除此任务: "Delete this task",
  删除定时任务: "Delete schedule",
  删除模版: "Delete template",
  "删除模版「": "Delete template “",
  "上次错误:": "Last error:",
  上限: "Cap",
  尚未探测: "Not probed yet",
  尚未选择产物: "No artifact selected",
  "尚无 Token 消耗数据。": "No token usage data yet.",
  尚无消耗记录: "No usage records yet",
  "尚无消耗数据 — 运行任务后自动统计": "No usage data yet — stats appear after you run tasks",
  设置: "Settings",
  设置分区: "Settings sections",
  生成中: "Generating",
  失败: "Failed",
  "失败 / 风险": "Failures / risks ",
  失败重试: "Retry failed task",
  "实例化变量 · 校验 Plan ·": "Instantiate variables · validate plan ·",
  实时终端日志流: "Live terminal logs",
  "使用的 CLI 引擎": "CLI engine",
  "使用模型的 Fast 变体（更快，质量可能略低）": "Use the model's Fast variant (faster, may trade quality)",
  视图工作区: "Menu",
  手动: "Manual",
  首次执行时间: "First run time",
  "输入要在当前 Agent 工作区执行的 Prompt…": "Enter a prompt to run in this agent workspace…",
  数据库: "Database",
  刷新: "Refresh",
  "搜索 Agent 或快捷指令 (⌘K)": "Search agents or commands (⌘K)",
  "搜索 Agent 或快捷指令...": "Search agents or commands...",
  "搜索 Agent、工作区或 Skill...": "Search agents, workspaces, or skills...",
  "所有 CLI 引擎": "All CLI engines",
  所有状态: "All statuses",
  探测本机已安装的执行引擎及其版本: "Detect installed execution engines and their versions",
  探测与可用性: "Detection and availability",
  "探测中…": "Probing…",
  提交并执行: "Submit and run",
  "提交并执行中…": "Submitting and running…",
  天: "Days",
  添加变量: "Add variable",
  条执行历史: " run history items",
  跳过本次: "Skip this run",
  跳转调度: "Go to Dispatch",
  跳转调度中枢: "Go to Dispatch",
  "跳转至 概览": "Go to Overview",
  "跳转至 全局总览": "Go to Overview",
  "跳转至 Agent 矩阵": "Go to Agents",
  "跳转至 Agents": "Go to Agents",
  "同步 Workspace Skill": "Sync workspace skills",
  同步失败: "Sync failed",
  "完成导入并感知 Skill": "Import and discover skills",
  未发现额外风险: "No additional risks found",
  未发现已登记产物: "No registered artifacts",
  "未检测到 Git 改动": "No git changes detected",
  未命名模版: "Untitled template",
  "未能生成可分发的 Plan": "Could not produce a dispatchable plan",
  "未找到匹配的 Agent 工作区": "No matching agent workspace found",
  未找到选中任务: "Selected task not found",
  未知: "Unknown",
  文件缺失: "File missing",
  无产物可复制: "No artifact to copy",
  无产物可预览: "No artifact to preview",
  无法读取: "Unreadable",
  "无法读取产物:": "Cannot read artifact:",
  "无法读取产物: 节点未绑定 Agent": "Cannot read artifact: node has no bound agent",
  "无法读取产物：节点未绑定 Agent。": "Cannot read artifact: node has no bound agent.",
  "无法生成可分发的 Plan": "Unable to produce a dispatchable plan",
  无可用模型: "No models available",
  无描述: "No description",
  无匹配结果: "No matching results",
  无匹配项: "No matches",
  无子任务: "No subtasks",
  "无子任务 Prompt": "No subtask prompt",
  系统就绪: "System ready",
  先预览: "Preview first",
  "相对路径:": "Relative path:",
  "详情 →": "Details →",
  "详情 ▴": "Details ▴",
  "详情 ▾": "Details ▾",
  项: " items",
  小时: "Hours",
  "协同 Agent": "Agents",
  新变量: "New variable",
  新建定时任务: "New schedule",
  需关注: "Needs attention",
  "选择 Agent": "Select an agent",
  "选择 DAG 节点查看产物": "Select a DAG node to view artifacts",
  "选择 DAG 节点查看该节点产物": "Select a DAG node to view its artifacts",
  选择任务查看产物: "Select a task to view artifacts",
  "选择任务后，最终产物会显示在这里，可直接阅读。": "Final artifacts appear here after you select a task.",
  选择任务后展示最终产物: "Select a task to view final artifacts",
  "选择上方 DAG 节点后，可在此查看该节点产物；任务级最终产物请看「验收交付物」。拖动右下角可调整高度。": "Select a DAG node above to view its artifacts here. For final task artifacts, see Acceptance deliverables. Drag the lower-right corner to resize.",
  选择一个定时任务: "Select a schedule",
  选择一个定时任务后查看执行记录: "Select a schedule to view run history",
  选择一个模版: "Select a template",
  "选择一个模版，设好时间后即可自动执行。": "Select a template, set a time, and it will run automatically.",
  "选择一个任务后，这里会自动汇总结果摘要、改动、产物、验证与风险。": "Select a task to see a summary of its results, changes, artifacts, checks, and risks.",
  "选择应用显示语言。": "Choose the language used by the app.",
  验收交付物: "Acceptance deliverables",
  验证结果: "Verification results ",
  "一句话说明 Agent 职责": "One-line agent role",
  一句话说明职责: "One-line role description",
  "已绑定 Workspace。打开详情可配置模型并同步 Skill。": "Workspace connected. Open details to configure the model and sync skills.",
  已绑定本地路径: "Bound to local path",
  已保存模版: "Saved templates",
  "已复制产物到剪贴板！": "Artifact copied to clipboard!",
  已复制模版: "Template duplicated",
  已恢复日志流: "Log stream resumed",
  已克隆并注册: "Cloned and registered",
  已启用: "Enabled",
  已请求取消任务: "Task cancellation requested",
  已请求取消沙盒: "Sandbox cancellation requested",
  已取消: "Cancelled",
  已人工跳过节点: "Node skipped manually",
  已删除: "Deleted",
  "已生成 Plan，请在调度确认后分发": "Plan ready — open Dispatch to confirm",
  "已生成 Plan，请在调度中枢确认后分发": "Plan ready — open Dispatch to confirm",
  已完成: "Completed",
  "已在 Finder 中定位产物文件": "Located artifact in Finder",
  "已在 Finder 中显示": "Revealed in Finder",
  "已载入 Agent [": "Loaded full config for agent [",
  "已载入模版，准备拆解": "Template loaded — ready to orchestrate",
  "已载入原文，可手动编辑": "Original text loaded — you can edit manually",
  已暂停: "Paused",
  已暂停日志流: "Log stream paused",
  已重试失败节点: "Failed node retried",
  "已重新探测 CLI 引擎": "CLI engines probed again",
  异常: "Error",
  意图分析: "Intent analysis",
  应用名称: "Application",
  语言: "Language",
  "预览中…": "Previewing…",
  允许并行: "Allow parallel",
  运行测试: "Run test",
  运行窗口需要同时填写开始和结束时间: "Fill both start and end times for the run window",
  运行窗口与重叠策略: "Run window & overlap policy",
  "运行前填入；不会改动模版本身": "Filled before run; does not modify the template",
  "运行任务后，CLI 上报的 usage 会自动汇总到这里。": "CLI-reported usage will be summarized here after you run a task.",
  "运行中…": "Running…",
  运行中自动化任务: "Running automations",
  "在 Agent Workspace 中运行沙盒 Prompt": "Run a sandbox prompt in the agent workspace",
  "在 Finder 中显示": "Reveal in Finder",
  "在 Finder 中显示当前产物": "Reveal current artifact in Finder",
  "在 Finder 中显示数据库": "Reveal database in Finder",
  "在 Workspace 的": "Place Markdown under ",
  暂停: "Paused",
  "暂无 DAG 节点": "No DAG nodes",
  "暂无 Skill": "No skills yet",
  暂无报告: "No report yet",
  "暂无变量 — 可在下方添加，或在文案中使用 {{snake_case}}": "No variables yet — add some below, or use {{snake_case}} in the text.",
  暂无结果摘要: "No result summary",
  暂无匹配结果: "No matching results",
  暂无任务运行: "No running tasks",
  暂无验证结果: "No verification results",
  暂无执行记录: "No run history yet",
  暂无执行历史: "No run history yet",
  暂无子任务: "No subtasks",
  "展开/折叠验收详情": "Expand/collapse acceptance details",
  正常: "Healthy",
  "正在分析意图与建图…": "Analyzing intent and building the graph…",
  "正在加载执行记录…": "Loading run history…",
  "正在启动模版执行…": "Starting template run…",
  "正在生成预览 Plan…": "Generating preview plan…",
  "正在执行的节点将被终止，未开始的节点将标记为跳过。": "Running nodes will be stopped; nodes that have not started will be marked skipped.",
  执行: "Run",
  执行变量: "Run variables",
  执行次数: "Run count",
  执行方式: "Schedule type",
  执行进度: "Progress",
  执行历史: "Run history",
  执行时间: "Run time",
  执行时间无效: "Invalid run time",
  执行一次: "Run once",
  "执行一次（指定时间）": "Run once (at a set time)",
  执行中: "Running",
  "直接在当前工作区上下文运行 CLI 调试命令：": "Run CLI debug commands in the current workspace context:",
  职责描述: "Role description",
  "只读 · 结构锁定": "Read-only · structure locked",
  只能取消排队中或执行中的任务: "Only queued or running tasks can be cancelled",
  "指定本地或远程工作区路径，系统将自动扫描": "Enter a local or remote workspace path. The app will scan ",
  "指定模型 (Preferred Model)": "Preferred model",
  智能调度拆解与路由方案: "Smart task breakdown and routing plan",
  "中文 / English": "中文 / English",
  "终端日志已复制到剪贴板！": "Terminal logs copied to clipboard!",
  终端日志已清空: "Terminal logs cleared",
  重复间隔: "Repeat interval",
  重试: "Retry",
  "重试间隔（分钟）": "Retry interval (minutes)",
  重新探测: "Probe again",
  "注册 Agent 矩阵": "Registered agents",
  "注册 Agents": "Registered agents",
  "抓取竞品 A/B/C 网站的最新产品价格与促销活动，提取结构化 JSON 并汇总对比，生成 Markdown 竞品简报，并发送到飞书工作群。": "Scrape latest product prices and promotions from competitors A/B/C, extract structured JSON, compare them, generate a Markdown brief, and send it to the Feishu work group.",
  "准备模版…": "Preparing template…",
  "准备中…": "Preparing…",
  子任务: "Subtasks",
  自动: "Automatic",
  自动化产生的数据与文档产物: "Generated data and document artifacts",
  自动化目标: "Automation goal",
  自动化任务队列: "Automation queue",
  "总 Token": "Total tokens",
  最多重试次数: "Max retries",
  "最近常用 Agent": "Recently used agents",
  最近调用: "Last used",
  最终产物: "Final artifacts",
  "Agent · Skill · Model 路由矩阵": "Agent · Skill · Model routing matrix",
  "Agent 标识名称": "Agent name",
  "Agent 参数与模型路由配置已保存": "Agent parameters and model routing saved",
  "Agent 矩阵": "Agents",
  "Agents": "Agents",
  "AI 正在润色模版…": "AI is polishing the template…",
  "Cache 读": "Cache read",
  "Cache 读 / 写": "Cache read / write",
  "Cache 写": "Cache write",
  "CLI / 模型 / Reasoning": "CLI / model / reasoning",
  "CLI / 模型 / Reasoning / Fast": "CLI / model / reasoning / Fast",
  "CLI 不可用": "CLI unavailable",
  "CLI 不可用：安装后点击侧栏左下角状态刷新探测。": "CLI unavailable: install it, then refresh status from the lower-left sidebar.",
  "CLI 引擎": "CLI engines",
  "CLI 引擎不可用": "CLI engine unavailable",
  "CLI 引擎不可用，无法运行沙盒": "CLI engine unavailable — cannot run sandbox",
  "CLI 引擎状态": "CLI engine status",
  "commander orchestrate dispatch 调度": "commander orchestrate dispatch",
  "Cron 表达式": "Cron expression",
  "DAG 并发": "DAG concurrency",
  "DAG 结构（只读）": "DAG structure (read-only)",
  "Dispatch 不可用": "Dispatch unavailable",
  "Fast 模式": "Fast mode",
  "Idle (就绪)": "Idle",
  "import new agent 导入 新建": "import new agent",
  "New import — 导入 / 新建 Agent": "New import — import / create agent",
  "Open commander — 调度工作台": "Open commander — Dispatch",
  "Open commander — 调度中枢工作台": "Open commander — Dispatch",
  "Plan 无效：至少需要一个子任务": "Invalid plan: at least one subtask is required",
  "Plan 无子任务，无法 Dispatch": "Plan has no subtasks — cannot dispatch",
  "probe cli engines 探测 设置": "probe cli engines settings",
  "Probe CLIs — 探测本机 CLI 引擎": "Probe CLIs — detect local CLI engines",
  "Reasoning Effort (推理深度)": "Reasoning effort",
  "Run 不存在": "Run not found",
  "SQLite 核心数据库与系统连通状态": "SQLite database and system connectivity",
  "Sync 全部 Agent": "Sync all agents",
  "Sync 中...": "Syncing...",
  "Task ID & 目标描述": "Task ID & goal",
  "Token 消耗 · 费用估算": "Token usage · estimated cost",
  "Token 消耗详情": "Token usage details",
  "Working (执行中)": "Working",
};

const textSources = new WeakMap<Text, string>();
const attributeSources = new WeakMap<Element, Map<string, string>>();
let observer: MutationObserver | null = null;
let applying = false;

function readLanguage(): AppLanguage {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "zh";
  } catch {
    return "zh";
  }
}

export function getLanguage(): AppLanguage {
  return readLanguage();
}

/** Translate a Chinese UI string for the current language (pass-through in zh). */
export function t(source: string): string {
  return translateText(source, readLanguage());
}

function translateText(source: string, language: AppLanguage): string {
  if (language === "zh") return source;
  const exact = TRANSLATIONS[source.trim()];
  if (exact) {
    const leading = source.match(/^\s*/)?.[0] ?? "";
    const trailing = source.match(/\s*$/)?.[0] ?? "";
    return `${leading}${exact}${trailing}`;
  }

  // Full-sentence patterns with dynamic segments — apply before partial phrase
  // replacement so short CTAs like「设为定时」do not mangle whole copy.
  const patterned = source
    .replace(
      /^已保存为「(.+)」。可设为定时自动跑，或用同一模版再跑一次。$/,
      'Saved as "$1". Set a schedule, or run again with the same template.',
    )
    .replace(/^✓ 已保存「(.+)」$/, '✓ Saved "$1"')
    .replace(
      /^节点 (\d+)\/(\d+) 成功( · .+)?$/,
      (_m, a: string, b: string, rest: string | undefined) =>
        `Nodes ${a}/${b} succeeded${rest ?? ""}`,
    );
  if (patterned !== source) {
    // Continue partial/regex pass on any remaining Chinese in the tail (e.g. meta join).
    source = patterned;
    const again = TRANSLATIONS[source.trim()];
    if (again) return again;
  }

  let result = source;
  Object.entries(TRANSLATIONS)
    // Short labels (任务/调度/概览…) are nav exact-matches only — avoid mangling longer copy.
    .filter(([zh]) => zh.length >= 4 && source.includes(zh))
    .sort(([a], [b]) => b.length - a.length)
    .forEach(([zh, en]) => {
      result = result.split(zh).join(en);
    });

  result = result
    .replace(/^(\d+) 运行$/, "$1 running")
    .replace(/^共 (\d+) 个$/, "$1 total")
    .replace(/^(\d+) 个子任务$/, "$1 subtasks")
    .replace(/^(\d+) 个关联子任务$/, "$1 related subtasks")
    .replace(/^(\d+) 个变量$/, "$1 variables")
    .replace(/^(\d+) 节点$/, "$1 nodes")
    .replace(/^(\d+) DAG 节点$/, "$1 DAG nodes")
    .replace(/^澄清问答 · (\d+) 项$/, "Clarifying questions · $1 items")
    .replace(/^(\d+) 个子任务 · 路由矩阵已就绪$/, "$1 subtasks · routing matrix ready")
    .replace(/^(\d+) 个子任务 · 需回答 (\d+) 个澄清问题$/, "$1 subtasks · $2 clarifying questions to answer")
    .replace(/^调度拆解完成！包含 (\d+) 个子任务与路由矩阵$/, "Orchestration complete: $1 subtasks and routing matrix")
    .replace(/^调度拆解完成：(\d+) 个子任务，请回答 (\d+) 个澄清问题$/, "Orchestration complete: $1 subtasks — answer $2 clarifying questions")
    .replace(/^已分发 (\d+) 个节点，开始执行$/, "Dispatched $1 nodes — execution started")
    .replace(/^已清空 (\d+) 条执行历史$/, "Cleared $1 run history items")
    .replace(/^已删除 (.+)$/, "Deleted $1")
    .replace(/^已启用 (.+)$/, "Enabled $1")
    .replace(/^已禁用 (.+)$/, "Disabled $1")
    .replace(/^已立即触发，run (.+)$/, "Triggered immediately, run $1")
    .replace(/^Skill 同步完成：(.+)$/, "Skill sync complete: $1")
    .replace(/^Sync 完成：(.+)$/, "Sync complete: $1")
    .replace(/^Sync 失败: (.+)$/, "Sync failed: $1")
    .replace(/^沙盒退出码 (\d+)$/, "Sandbox exit code $1")
    .replace(/^沙盒失败: (.+)$/, "Sandbox failed: $1")
    .replace(/^推理深度已更新为: (.+)$/, "Reasoning effort updated to: $1")
    .replace(/^每 (\d+) 秒$/, "Every $1 seconds")
    .replace(/^每 (\d+) 分钟$/, "Every $1 minutes")
    .replace(/^每 (\d+) 小时$/, "Every $1 hours")
    .replace(/^每 (\d+) 天$/, "Every $1 days")
    .replace(/^(\d+) 分钟前$/, "$1 minutes ago")
    .replace(/^(\d+) 小时前$/, "$1 hours ago")
    .replace(/^(\d+) 天前$/, "$1 days ago")
    .replace(/^成功率 (\d+)%$/, "Success rate $1%")
    .replace(/^⚡ (\d+)% 执行中$/, "⚡ $1% running")
    .replace(/^(\d+)% 连通健康$/, "$1% connectivity healthy")
    .replace(/^打开 Agent · /, "Open agent · ")
    .replace(/^查看 Agent /, "View agent ")
    .replace(/ 详情$/, " details")
    .replace(/^未找到 Agent: /, "Agent not found: ")
    .replace(/^下次 /, "Next ")
    .replace(/^版本 /, "Version ")
    .replace(/^最近探测 /, "Last checked ")
    .replace(/^结束 /, "Finished ")
    .replace(/^更新于 /, "Updated ")
    .replace(/^上次错误: /, "Last error: ")
    .replace(/^文件尚不存在，已打开目录：/, "File does not exist yet — opened folder: ")
    .replace(/^打开 Finder 失败: /, "Failed to open Finder: ")
    .replace(/^加载 Run 失败: /, "Failed to load run: ")
    .replace(/^加载任务历史失败: /, "Failed to load task history: ")
    .replace(/^加载 Agent 失败: /, "Failed to load agent: ")
    .replace(/^加载模版失败: /, "Failed to load templates: ")
    .replace(/^加载定时任务失败: /, "Failed to load schedules: ")
    .replace(/^加载执行历史失败: /, "Failed to load run history: ")
    .replace(/^加载消耗详情失败: /, "Failed to load usage details: ")
    .replace(/^加载调度配置失败: /, "Failed to load orchestration settings: ")
    .replace(/^加载配置失败: /, "Failed to load settings: ")
    .replace(/^加载模型列表失败: /, "Failed to load models: ")
    .replace(/^总览加载失败: /, "Failed to load overview: ")
    .replace(/^删除失败: /, "Delete failed: ")
    .replace(/^清空失败: /, "Clear failed: ")
    .replace(/^取消失败: /, "Cancel failed: ")
    .replace(/^重试失败: /, "Retry failed: ")
    .replace(/^跳过失败: /, "Skip failed: ")
    .replace(/^保存失败: /, "Save failed: ")
    .replace(/^保存模版失败: /, "Failed to save template: ")
    .replace(/^复制失败: /, "Copy failed: ")
    .replace(/^更新失败: /, "Update failed: ")
    .replace(/^更新 Skill 失败: /, "Failed to update skill: ")
    .replace(/^同步失败: /, "Sync failed: ")
    .replace(/^导入失败: /, "Import failed: ")
    .replace(/^执行失败: /, "Run failed: ")
    .replace(/^分发失败: /, "Dispatch failed: ")
    .replace(/^提交失败: /, "Submit failed: ")
    .replace(/^调度失败: /, "Orchestration failed: ")
    .replace(/^准备失败: /, "Prepare failed: ")
    .replace(/^实例化失败: /, "Instantiation failed: ")
    .replace(/^读取失败: /, "Read failed: ")
    .replace(/^读取模版失败: /, "Failed to read template: ")
    .replace(/^打开失败: /, "Open failed: ")
    .replace(/^操作失败: /, "Action failed: ")
    .replace(/^AI 润色失败: /, "AI polish failed: ")
    .replace(/^无法准备模版: /, "Unable to prepare template: ")
    .replace(/^无法读取产物: /, "Cannot read artifact: ")
    .replace(/^按引擎 \/ 模型汇总 · 共 (\d+) 个模型 · (\d+) 次执行$/, "By engine / model · $1 models · $2 runs")
    .replace(/^Top (\d+) · 按 7 日调用排序$/, "Top $1 · sorted by 7-day usage")
    .replace(/^请选择：/, "Please select: ")
    .replace(/^已完成$/, "Completed")
    .replace(/^失败$/, "Failed")
    .replace(/^启用$/, "Enabled")
    .replace(/^暂停$/, "Paused")
    .replace(/节点 (\d+)\/(\d+) 成功/g, "Nodes $1/$2 succeeded")
    .replace(/(\d+) 失败/g, "$1 failed")
    .replace(/(\d+) 跳过/g, "$1 skipped")
    .replace(/耗时 /g, "Duration ")
    .replace(/ · 定时·手动/g, " · Schedule · manual")
    .replace(/ · 定时/g, " · Scheduled")
    .replace(/ · 手动/g, " · Manual")
    .replace(/^再跑失败: /, "Rerun failed: ")
    .replace(/ 定时$/, " schedule");
  return result;
}

function shouldSkipText(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent) return true;
  if (["SCRIPT", "STYLE", "PRE", "CODE", "TEXTAREA"].includes(parent.tagName)) return true;
  return Boolean(parent.closest("[data-i18n-ignore]"));
}

function localizeTextNode(node: Text, language: AppLanguage): void {
  if (shouldSkipText(node)) return;
  let source = textSources.get(node);
  if (source === undefined) {
    source = node.data;
    textSources.set(node, source);
  } else if (!applying) {
    const expected = translateText(source, language);
    if (node.data !== expected && node.data !== source) {
      source = node.data;
      textSources.set(node, source);
    }
  }
  const translated = translateText(source, language);
  if (node.data !== translated) node.data = translated;
}

function localizeAttribute(el: Element, attr: string, language: AppLanguage): void {
  const value = el.getAttribute(attr);
  if (value == null || el.hasAttribute("data-i18n-ignore")) return;
  let sources = attributeSources.get(el);
  if (!sources) {
    sources = new Map();
    attributeSources.set(el, sources);
  }
  let source = sources.get(attr);
  if (source === undefined) {
    source = value;
    sources.set(attr, source);
  } else if (!applying) {
    const expected = translateText(source, language);
    if (value !== expected && value !== source) {
      source = value;
      sources.set(attr, source);
    }
  }
  const translated = translateText(source, language);
  if (value !== translated) el.setAttribute(attr, translated);
}

export function applyLanguage(root: ParentNode = document): void {
  if (applying) return;
  applying = true;
  const language = readLanguage();
  document.documentElement.lang = language === "en" ? "en" : "zh-CN";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) localizeTextNode(node as Text, language);
  root.querySelectorAll<HTMLElement>("[title], [aria-label], [placeholder]").forEach((el) => {
    localizeAttribute(el, "title", language);
    localizeAttribute(el, "aria-label", language);
    localizeAttribute(el, "placeholder", language);
  });
  const languageSelect = document.getElementById("language-select") as HTMLSelectElement | null;
  if (languageSelect && languageSelect.value !== language) languageSelect.value = language;
  applying = false;
}

export function setLanguage(language: AppLanguage): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Storage can be unavailable in restricted WebViews; the current session still works.
  }
  applyLanguage(document);
  window.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: language }));
}

export function onLanguageChange(listener: (language: AppLanguage) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<AppLanguage>).detail);
  window.addEventListener(LANGUAGE_EVENT, handler);
  return () => window.removeEventListener(LANGUAGE_EVENT, handler);
}

export function initI18n(): void {
  const languageSelect = document.getElementById("language-select") as HTMLSelectElement | null;
  if (languageSelect) {
    languageSelect.value = readLanguage();
    languageSelect.addEventListener("change", () => {
      const next = languageSelect.value === "en" ? "en" : "zh";
      setLanguage(next);
    });
  }
  applyLanguage(document);
  observer?.disconnect();
  observer = new MutationObserver((records) => {
    if (applying) return;
    for (const record of records) {
      if (record.type === "characterData") localizeTextNode(record.target as Text, readLanguage());
      record.addedNodes.forEach((added) => {
        if (added.nodeType === Node.TEXT_NODE) localizeTextNode(added as Text, readLanguage());
        else if (added.nodeType === Node.ELEMENT_NODE) applyLanguage(added as Element);
      });
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
}
