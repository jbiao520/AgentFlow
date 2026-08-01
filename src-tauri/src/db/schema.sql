-- AgentFlow schema v7 (SPEC §6 + templates + schedules)
-- v6: schedule expressions, execution windows, overlap policy and retries.
-- v7: task_runs.is_manual distinguishes ticker fires from manual run-now.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  workspace_path TEXT NOT NULL,
  git_url TEXT,
  default_cli TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS agent_model_profiles (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  preferred_model TEXT,
  reasoning_effort TEXT,
  temperature REAL,
  auto_route INTEGER NOT NULL DEFAULT 0,
  engine_options_json TEXT
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL,
  title TEXT,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  content_hash TEXT,
  scanned_at TEXT,
  UNIQUE(agent_id, relative_path)
);

CREATE TABLE IF NOT EXISTS orchestrator_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cli_engine TEXT NOT NULL,
  model TEXT NOT NULL,
  reasoning_effort TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  template_key TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  analysis_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_runs (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id),
  plan_id TEXT NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  started_at TEXT,
  finished_at TEXT,
  error TEXT,
  delivery_report_json TEXT,
  schedule_id TEXT REFERENCES schedules(id) ON DELETE SET NULL,
  is_manual INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS task_nodes (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  title TEXT NOT NULL,
  agent_id TEXT,
  skill_ids_json TEXT,
  cli_engine TEXT,
  model TEXT,
  reasoning_effort TEXT,
  depends_on_json TEXT,
  status TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  artifact_paths_json TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS task_logs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  node_id TEXT,
  ts TEXT NOT NULL,
  agent_name TEXT,
  level TEXT NOT NULL,
  message TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cli_engine_status (
  engine TEXT PRIMARY KEY,
  available INTEGER NOT NULL DEFAULT 0,
  version TEXT,
  last_checked_at TEXT
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  source_goal_id TEXT,
  source_plan_id TEXT,
  source_run_id TEXT,
  goal_prompt TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  variables_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  values_json TEXT NOT NULL DEFAULT '{}',
  mode TEXT NOT NULL,
  interval_secs INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at TEXT NOT NULL,
  last_run_at TEXT,
  last_run_id TEXT,
  last_error TEXT,
  run_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cron_expr TEXT,
  window_start TEXT,
  window_end TEXT,
  overlap_policy TEXT NOT NULL DEFAULT 'queue',
  max_retries INTEGER NOT NULL DEFAULT 0,
  retry_delay_secs INTEGER NOT NULL DEFAULT 300,
  retry_attempt INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_schedules_due
  ON schedules(enabled, next_run_at);

-- idx_task_runs_schedule_active is created in migrate_v6 after schedule_id
-- is ensured (CREATE TABLE IF NOT EXISTS does not add columns on upgrades).

-- Per-execution token usage captured from CLI JSONL streams (codex/opencode).
CREATE TABLE IF NOT EXISTS node_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES task_nodes(id) ON DELETE CASCADE,
  engine TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  cost REAL,
  estimated INTEGER NOT NULL DEFAULT 0,
  recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_node_usage_run
  ON node_usage(run_id);
