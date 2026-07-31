/**
 * Task Center: history list, live DAG, logs, artifact preview, retry/skip.
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  getTaskRun,
  listTaskLogs,
  listTaskRuns,
  readWorkspaceFile,
  retryNode,
  skipNode,
  type TaskLog,
  type TaskLogEvent,
  type TaskNode,
  type TaskRun,
  type TaskRunUpdatedEvent,
} from "../../lib/api/tasks";
import { renderDag } from "./dag";
import {
  appendLogLine,
  applyLogFilter,
  clearLogBody,
  getVisibleLogText,
  renderLogHistory,
  renderLogTabs,
} from "./logs";
import { showToast } from "../toast";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

type CenterState = {
  runs: TaskRun[];
  selectedRunId: string | null;
  nodes: TaskNode[];
  selectedNodeId: string | null;
  logFilter: string;
  streamPaused: boolean;
  artifactContent: string;
  unsubs: UnlistenFn[];
};

const state: CenterState = {
  runs: [],
  selectedRunId: null,
  nodes: [],
  selectedNodeId: null,
  logFilter: "all",
  streamPaused: false,
  artifactContent: "",
  unsubs: [],
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statusMeta(run: TaskRun): { label: string; color: string } {
  const pct = Math.round((run.progress || 0) * 100);
  switch (run.status) {
    case "running":
    case "queued":
      return { label: `⚡ ${pct}% 执行中`, color: "var(--accent-amber)" };
    case "success":
      return { label: "已完成", color: "var(--accent-emerald)" };
    case "failed":
      return { label: "失败", color: "#dc2626" };
    case "cancelled":
      return { label: "已取消", color: "var(--fg-muted)" };
    default:
      return { label: run.status, color: "var(--fg-muted)" };
  }
}

function renderHistory(): void {
  const list = document.getElementById("task-history-list");
  const count = document.getElementById("task-history-count");
  if (count) count.textContent = `共 ${state.runs.length} 个`;
  if (!list) return;
  if (state.runs.length === 0) {
    list.innerHTML = `
      <div style="padding:16px 12px; font-size:12px; color:var(--fg-muted); text-align:center;">
        <div style="font-weight:600; color:var(--fg-primary); margin-bottom:6px;">暂无任务运行</div>
        <div style="margin-bottom:10px;">从调度中枢 Orchestrate → Dispatch 后，历史会出现在这里。</div>
        <button type="button" class="btn btn-secondary btn-sm" id="tasks-empty-cta">打开调度中枢</button>
      </div>`;
    list.querySelector("#tasks-empty-cta")?.addEventListener("click", () => {
      void import("../router").then((m) => m.showView("commander"));
    });
    return;
  }
  list.innerHTML = state.runs
    .map((run) => {
      const meta = statusMeta(run);
      const active = run.id === state.selectedRunId ? " active" : "";
      const title = `#${run.id.slice(0, 8)} · ${run.status}`;
      const started = run.started_at
        ? new Date(run.started_at).toLocaleString()
        : "—";
      return `<div class="task-item-card${active}" data-run-id="${escapeHtml(run.id)}">
        <div class="task-item-title">${escapeHtml(title)}</div>
        <div class="task-item-meta">
          <span style="color:${meta.color};">${escapeHtml(meta.label)}</span>
          <span>${escapeHtml(started)}</span>
        </div>
      </div>`;
    })
    .join("");

  list.querySelectorAll("[data-run-id]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = (el as HTMLElement).getAttribute("data-run-id");
      if (id) void selectRun(id);
    });
  });
}

function renderDagPanel(): void {
  const container = document.getElementById("task-dag-container");
  if (!container) return;
  renderDag(container, state.nodes, state.selectedNodeId, (nodeId) => {
    state.selectedNodeId = nodeId;
    renderDagPanel();
    void loadArtifactForNode(nodeId);
  });
}

async function loadArtifactForNode(nodeId: string): Promise<void> {
  const node = state.nodes.find((n) => n.id === nodeId);
  const label = document.getElementById("artifact-path-label");
  const box = document.getElementById("artifact-content-box");
  if (!node) return;

  let paths: string[] = [];
  try {
    paths = node.artifact_paths_json
      ? (JSON.parse(node.artifact_paths_json) as string[])
      : [];
  } catch {
    paths = [];
  }

  if (!paths.length || !node.agent_id) {
    if (label) label.textContent = "—";
    if (box) box.textContent = "该节点暂无产物路径";
    state.artifactContent = "";
    return;
  }

  const rel = paths[0];
  if (label) label.textContent = rel;
  try {
    const file = await readWorkspaceFile(node.agent_id, rel);
    state.artifactContent = file.content;
    if (box) box.textContent = file.content;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    state.artifactContent = "";
    if (box) box.textContent = `无法读取产物: ${msg}`;
  }
}

async function selectRun(runId: string): Promise<void> {
  state.selectedRunId = runId;
  state.logFilter = "all";
  renderHistory();
  try {
    const full = await getTaskRun(runId);
    if (!full) {
      showToast("Run 不存在");
      return;
    }
    state.nodes = full.nodes;
    const failed = full.nodes.find((n) => n.status === "failed");
    const running = full.nodes.find((n) => n.status === "running");
    state.selectedNodeId =
      failed?.id || running?.id || full.nodes[0]?.id || null;
    renderDagPanel();

    const logs = await listTaskLogs(runId);
    const agents = [
      ...new Set(
        logs
          .map((l) => l.agent_name)
          .filter((a): a is string => !!a && a.length > 0),
      ),
    ];
    const bindTabs = (): void => {
      renderLogTabs(agents, state.logFilter, (filter) => {
        state.logFilter = filter;
        bindTabs();
        applyLogFilter(filter);
      });
    };
    bindTabs();
    renderLogHistory(logs, state.logFilter);

    if (state.selectedNodeId) {
      await loadArtifactForNode(state.selectedNodeId);
    }
  } catch (e) {
    showToast(`加载 Run 失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function refreshTaskHistory(preferRunId?: string): Promise<void> {
  try {
    state.runs = await listTaskRuns(50);
    renderHistory();
    const pick =
      preferRunId ||
      state.selectedRunId ||
      state.runs[0]?.id ||
      null;
    if (pick) await selectRun(pick);
  } catch (e) {
    showToast(
      `加载任务历史失败: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

async function onRetry(): Promise<void> {
  if (!state.selectedRunId || !state.selectedNodeId) {
    showToast("请先选择失败节点");
    return;
  }
  try {
    await retryNode(state.selectedRunId, state.selectedNodeId);
    showToast("已重试失败节点");
    await selectRun(state.selectedRunId);
  } catch (e) {
    showToast(`重试失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function onSkip(): Promise<void> {
  if (!state.selectedRunId || !state.selectedNodeId) {
    showToast("请先选择要跳过的节点");
    return;
  }
  try {
    await skipNode(state.selectedRunId, state.selectedNodeId);
    showToast("已人工跳过节点");
    await selectRun(state.selectedRunId);
  } catch (e) {
    showToast(`跳过失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function subscribeEvents(): Promise<void> {
  if (!isTauri()) return;
  for (const u of state.unsubs) {
    try {
      u();
    } catch {
      /* ignore */
    }
  }
  state.unsubs = [];

  const u1 = await listen<TaskLogEvent>("task-log", (ev) => {
    if (state.streamPaused) return;
    if (ev.payload.run_id !== state.selectedRunId) return;
    const log: TaskLog = {
      id: crypto.randomUUID(),
      run_id: ev.payload.run_id,
      node_id: ev.payload.node_id,
      ts: ev.payload.ts,
      agent_name: ev.payload.agent_name,
      level: ev.payload.level,
      message: ev.payload.message,
    };
    appendLogLine(log, state.logFilter);
  });

  const u2 = await listen<TaskRunUpdatedEvent>("task-run-updated", (ev) => {
    const run = ev.payload.run;
    const idx = state.runs.findIndex((r) => r.id === run.id);
    if (idx >= 0) state.runs[idx] = run;
    else state.runs.unshift(run);
    renderHistory();
    if (run.id === state.selectedRunId) {
      state.nodes = ev.payload.nodes;
      renderDagPanel();
    }
  });

  state.unsubs.push(u1, u2);
}

export function initTaskCenter(): void {
  void refreshTaskHistory();
  void subscribeEvents();

  document.getElementById("btn-retry-node")?.addEventListener("click", () => {
    void onRetry();
  });
  document.getElementById("btn-skip-node")?.addEventListener("click", () => {
    void onSkip();
  });
  document.getElementById("clear-logs-btn")?.addEventListener("click", () => {
    clearLogBody();
    showToast("终端日志已清空");
  });
  document.getElementById("copy-logs-btn")?.addEventListener("click", () => {
    void navigator.clipboard.writeText(getVisibleLogText()).then(
      () => showToast("终端日志已复制到剪贴板！"),
      () => showToast("复制失败"),
    );
  });
  document.getElementById("btn-copy-artifact")?.addEventListener("click", () => {
    if (!state.artifactContent) {
      showToast("无产物可复制");
      return;
    }
    void navigator.clipboard.writeText(state.artifactContent).then(
      () => showToast("已复制产物到剪贴板！"),
      () => showToast("复制失败"),
    );
  });
  document.getElementById("toggle-stream-btn")?.addEventListener("click", () => {
    state.streamPaused = !state.streamPaused;
    const btn = document.getElementById("toggle-stream-btn");
    if (btn) {
      btn.textContent = state.streamPaused ? "▶ 恢复日志流" : "⏸ 暂停日志流";
    }
    showToast(state.streamPaused ? "已暂停日志流" : "已恢复日志流");
  });

  window.addEventListener("agentmind:run-started", ((ev: CustomEvent) => {
    const runId = (ev.detail as { runId?: string })?.runId;
    void refreshTaskHistory(runId);
  }) as EventListener);

  // When navigating to tasks view, refresh
  document.querySelectorAll('[data-view="tasks"]').forEach((nav) => {
    nav.addEventListener("click", () => {
      void refreshTaskHistory(state.selectedRunId || undefined);
    });
  });
}
