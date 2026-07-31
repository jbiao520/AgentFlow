-- AgentMind schema v1 (SPEC §6)

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
  updated_at TEXT NOT NULL
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
  error TEXT
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
