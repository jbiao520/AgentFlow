/**
 * Task Center: history list, live DAG, logs, artifact preview, retry/skip.
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  cancelRun,
  clearTaskRuns,
  deleteTaskRun,
  getTaskRun,
  listTaskLogs,
  listTaskRuns,
  readWorkspaceFile,
  revealWorkspaceArtifact,
  retryNode,
  skipNode,
  type DeliveryReport,
  type TaskLog,
  type TaskLogEvent,
  type TaskNode,
  type TaskRun,
  type TaskRunUpdatedEvent,
} from "../../lib/api/tasks";
import { showView } from "../router";
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
import { confirmAction } from "../modals";
import {
  renderMarkdownInlineBlock,
  setFormattedContent,
} from "../format/content";

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
  artifactPaths: string[];
  selectedArtifactPath: string | null;
  artifactAgentId: string | null;
  artifactContent: string;
  artifactMissing: boolean;
  cancelling: boolean;
  /** Run ids deleted locally — ignore stale task-run-updated resurrection. */
  deletedRunIds: Set<string>;
  /** Monotonic generation used to ignore stale history list responses. */
  historyRefreshGeneration: number;
  historyBound: boolean;
  unsubs: UnlistenFn[];
};

const state: CenterState = {
  runs: [],
  selectedRunId: null,
  nodes: [],
  selectedNodeId: null,
  logFilter: "all",
  streamPaused: false,
  artifactPaths: [],
  selectedArtifactPath: null,
  artifactAgentId: null,
  artifactContent: "",
  artifactMissing: false,
  cancelling: false,
  deletedRunIds: new Set(),
  historyRefreshGeneration: 0,
  historyBound: false,
  unsubs: [],
};

function eventElement(ev: Event): Element | null {
  const t = ev.target;
  if (t instanceof Element) return t;
  if (t instanceof Text) return t.parentElement;
  return null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

/** Prefer goal prompt as display name; fall back to short run id. */
function runDisplayName(run: TaskRun | undefined, runId: string): string {
  const prompt = run?.goal_prompt?.trim();
  if (prompt) return truncate(prompt, 48);
  return `#${runId.slice(0, 8)}`;
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

function parseArtifactPaths(node: TaskNode | undefined): string[] {
  if (!node?.artifact_paths_json) return [];
  try {
    const parsed = JSON.parse(node.artifact_paths_json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p): p is string => typeof p === "string")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  } catch {
    return [];
  }
}

function parseDeliveryReport(run: TaskRun | null): DeliveryReport | null {
  if (!run?.delivery_report_json) return null;
  try {
    const raw = JSON.parse(run.delivery_report_json) as Partial<DeliveryReport>;
    return {
      generated_at: typeof raw.generated_at === "string" ? raw.generated_at : "",
      summary: typeof raw.summary === "string" ? raw.summary : "暂无结果摘要",
      changed_files: Array.isArray(raw.changed_files) ? raw.changed_files : [],
      diff: typeof raw.diff === "string" ? raw.diff : null,
      artifacts: Array.isArray(raw.artifacts) ? raw.artifacts : [],
      verification: Array.isArray(raw.verification) ? raw.verification : [],
      risks: Array.isArray(raw.risks)
        ? raw.risks.filter((risk): risk is string => typeof risk === "string")
        : [],
    };
  } catch {
    return null;
  }
}

function renderDeliveryReport(run: TaskRun | null): void {
  const summary = document.getElementById("task-delivery-summary");
  const status = document.getElementById("task-delivery-status");
  const files = document.getElementById("task-delivery-files");
  const artifacts = document.getElementById("task-delivery-artifacts");
  const verification = document.getElementById("task-delivery-verification");
  const risks = document.getElementById("task-delivery-risks");
  const diffDetails = document.getElementById("task-delivery-diff-details");
  const diff = document.getElementById("task-delivery-diff");
  const filesCount = document.getElementById("task-delivery-files-count");
  const artifactsCount = document.getElementById("task-delivery-artifacts-count");
  const verificationCount = document.getElementById("task-delivery-verification-count");
  const risksCount = document.getElementById("task-delivery-risks-count");
  if (!summary || !status || !files || !artifacts || !verification || !risks) return;

  const report = parseDeliveryReport(run);
  const active = run?.status === "running" || run?.status === "queued";
  status.className = "delivery-status-badge";
  if (active) {
    status.classList.add("delivery-status-pending");
    status.textContent = "生成中";
    summary.innerHTML = renderMarkdownInlineBlock(
      "任务执行中；完成后会自动生成验收摘要、改动 Diff、产物入口、验证结果和风险说明。",
    );
    files.innerHTML = artifacts.innerHTML = verification.innerHTML = risks.innerHTML =
      '<div>任务完成后自动生成</div>';
    if (filesCount) filesCount.textContent = "—";
    if (artifactsCount) artifactsCount.textContent = "—";
    if (verificationCount) verificationCount.textContent = "—";
    if (risksCount) risksCount.textContent = "—";
    if (diffDetails) diffDetails.style.display = "none";
    return;
  }
  if (!report) {
    status.classList.add("delivery-status-pending");
    status.textContent = run ? "暂无报告" : "等待任务完成";
    summary.innerHTML = renderMarkdownInlineBlock(
      run
        ? "该历史任务尚未生成验收报告。重新执行后会自动补齐。"
        : "选择一个任务后，这里会自动汇总结果摘要、改动、产物、验证与风险。",
    );
    files.innerHTML = artifacts.innerHTML = verification.innerHTML = risks.innerHTML = "<div>—</div>";
    if (filesCount) filesCount.textContent = "0";
    if (artifactsCount) artifactsCount.textContent = "0";
    if (verificationCount) verificationCount.textContent = "0";
    if (risksCount) risksCount.textContent = "0";
    if (diffDetails) diffDetails.style.display = "none";
    return;
  }

  const hasFailure = run?.status === "failed" || run?.status === "cancelled";
  status.classList.add(hasFailure ? "delivery-status-failed" : "delivery-status-ready");
  status.textContent = hasFailure ? "需关注" : "可验收";
  summary.innerHTML = renderMarkdownInlineBlock(report.summary);

  if (filesCount) filesCount.textContent = String(report.changed_files.length);
  files.innerHTML = report.changed_files.length
    ? report.changed_files
        .map(
          (file) =>
            `<div class="delivery-file-row"><span class="delivery-file-status">${escapeHtml(file.status)}</span><code>${escapeHtml(file.path)}</code><span style="color:var(--fg-muted);">· ${escapeHtml(file.workspace)}</span></div>`,
        )
        .join("")
    : "<div>未检测到 Git 改动</div>";
  if (diffDetails && diff) {
    diffDetails.style.display = report.diff ? "block" : "none";
    if (report.diff) {
      setFormattedContent(diff, report.diff, "changes.diff");
    } else {
      diff.textContent = "";
    }
  }

  if (artifactsCount) artifactsCount.textContent = String(report.artifacts.length);
  artifacts.innerHTML = report.artifacts.length
    ? report.artifacts
        .map(
          (artifact) =>
            `<div class="delivery-file-row"><span class="delivery-check ${artifact.exists ? "passed" : "failed"}">${artifact.exists ? "✓" : "!"}</span><button type="button" class="delivery-artifact-link" data-delivery-node="${escapeHtml(artifact.node_id)}" data-delivery-path="${escapeHtml(artifact.path)}">${escapeHtml(artifact.path)}</button><span style="color:var(--fg-muted);">· ${escapeHtml(artifact.node_title)}</span></div>`,
        )
        .join("")
    : "<div>未发现已登记产物</div>";

  if (verificationCount) verificationCount.textContent = String(report.verification.length);
  verification.innerHTML = report.verification.length
    ? report.verification
        .map(
          (item) =>
            `<div class="delivery-verification-row"><span class="delivery-check ${escapeHtml(item.status)}">${item.status === "passed" ? "✓" : item.status === "failed" ? "×" : "!"}</span><div class="delivery-verification-text"><div class="delivery-verification-label">${escapeHtml(item.label)}</div><div class="delivery-verification-detail">${renderMarkdownInlineBlock(item.detail)}</div></div></div>`,
        )
        .join("")
    : "<div>暂无验证结果</div>";

  if (risksCount) risksCount.textContent = String(report.risks.length);
  risks.innerHTML = report.risks.length
    ? report.risks
        .map(
          (risk) =>
            `<div class="delivery-risk-row"><span>⚠</span><div class="delivery-risk-text">${renderMarkdownInlineBlock(risk)}</div></div>`,
        )
        .join("")
    : '<div style="color:var(--accent-emerald);">未发现额外风险</div>';
}

function renderArtifactList(): void {
  const list = document.getElementById("artifact-path-list");
  if (!list) return;

  if (!state.artifactPaths.length) {
    list.innerHTML =
      '<div class="artifact-path-empty">该节点暂无产物路径</div>';
    return;
  }

  list.innerHTML = state.artifactPaths
    .map((path) => {
      const active = path === state.selectedArtifactPath ? " active" : "";
      const missing =
        path === state.selectedArtifactPath && state.artifactMissing
          ? " missing"
          : "";
      const missingTag =
        path === state.selectedArtifactPath && state.artifactMissing
          ? ' <span style="opacity:0.75;">(缺失)</span>'
          : "";
      return `<button type="button" class="artifact-path-item${active}${missing}" role="option" data-artifact-path="${escapeHtml(path)}" aria-selected="${path === state.selectedArtifactPath}">${escapeHtml(path)}${missingTag}</button>`;
    })
    .join("");

  list.querySelectorAll("[data-artifact-path]").forEach((el) => {
    el.addEventListener("click", () => {
      const path = (el as HTMLElement).getAttribute("data-artifact-path");
      if (path) void selectArtifactPath(path);
    });
  });
}

function clearArtifactPanel(message: string): void {
  state.artifactPaths = [];
  state.selectedArtifactPath = null;
  state.artifactAgentId = null;
  state.artifactContent = "";
  state.artifactMissing = false;
  const label = document.getElementById("artifact-path-label");
  const box = document.getElementById("artifact-content-box");
  const list = document.getElementById("artifact-path-list");
  if (label) label.textContent = "—";
  if (box) {
    box.classList.add("fmt-host");
    box.dataset.fmtKind = "text";
    box.innerHTML = `<div class="fmt-empty">${escapeHtml(message)}</div>`;
  }
  if (list) {
    list.innerHTML = `<div class="artifact-path-empty">${escapeHtml(message)}</div>`;
  }
}

async function selectArtifactPath(relPath: string): Promise<void> {
  state.selectedArtifactPath = relPath;
  state.artifactContent = "";
  state.artifactMissing = false;

  const label = document.getElementById("artifact-path-label");
  const box = document.getElementById("artifact-content-box");
  if (label) label.textContent = relPath;
  if (box) {
    box.classList.add("fmt-host");
    box.innerHTML = `<div style="padding:12px 0; display:flex; flex-direction:column; gap:8px;">
      <span class="skeleton-line" style="width:70%;"></span>
      <span class="skeleton-line" style="width:90%;"></span>
      <span class="skeleton-line" style="width:50%;"></span>
    </div>`;
  }
  renderArtifactList();

  if (!state.artifactAgentId) {
    state.artifactMissing = true;
    if (box) {
      box.innerHTML = `<div class="fmt-empty">无法读取产物: 节点未绑定 Agent</div>`;
    }
    renderArtifactList();
    return;
  }

  try {
    const file = await readWorkspaceFile(state.artifactAgentId, relPath);
    state.artifactContent = file.content;
    state.artifactMissing = false;
    setFormattedContent(box, file.content, relPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    state.artifactContent = "";
    state.artifactMissing = true;
    if (box) {
      box.classList.add("fmt-host");
      box.dataset.fmtKind = "text";
      box.innerHTML = `<div class="fmt-empty">${escapeHtml(
        `无法读取产物: ${msg}\n\n相对路径: ${relPath}\n可点「在 Finder 中显示」打开 workspace / artifacts 目录。`,
      )}</div>`;
    }
  }
  renderArtifactList();
}

async function loadArtifactForNode(nodeId: string): Promise<void> {
  const node = state.nodes.find((n) => n.id === nodeId);
  if (!node) {
    clearArtifactPanel("选择 DAG 节点查看产物");
    return;
  }

  const paths = parseArtifactPaths(node);
  state.artifactPaths = paths;
  state.artifactAgentId = node.agent_id;
  state.artifactContent = "";
  state.artifactMissing = false;

  if (!paths.length) {
    clearArtifactPanel("该节点暂无产物路径");
    state.artifactAgentId = node.agent_id;
    return;
  }

  await selectArtifactPath(paths[0]);
}

async function openDeliveryArtifact(nodeId: string, path: string): Promise<void> {
  state.selectedNodeId = nodeId;
  renderDagPanel();
  await loadArtifactForNode(nodeId);
  if (state.artifactPaths.includes(path)) {
    await selectArtifactPath(path);
  }
}

async function onRevealArtifact(): Promise<void> {
  if (!state.artifactAgentId || !state.selectedArtifactPath) {
    showToast("请先选择有产物路径的节点");
    return;
  }
  try {
    const result = await revealWorkspaceArtifact(
      state.artifactAgentId,
      state.selectedArtifactPath,
    );
    if (result.existed) {
      showToast("已在 Finder 中定位产物文件");
    } else if (result.fallback) {
      showToast(`文件尚不存在，已打开目录：${result.revealed_path}`);
    } else {
      showToast("已在 Finder 中显示");
    }
  } catch (e) {
    showToast(
      `打开 Finder 失败: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function renderHistory(): void {
  const list = document.getElementById("task-history-list");
  const count = document.getElementById("task-history-count");
  const clearBtn = document.getElementById(
    "btn-clear-task-history",
  ) as HTMLButtonElement | null;
  if (count) count.textContent = `共 ${state.runs.length} 个`;
  if (clearBtn) clearBtn.disabled = state.runs.length === 0;
  const running = state.runs.filter(
    (r) => r.status === "running" || r.status === "queued",
  ).length;
  // Agent count is owned by overview/matrix; only refresh the running badge here.
  const tasksBadge = document.getElementById("nav-count-tasks");
  if (tasksBadge) tasksBadge.textContent = `${running} 运行`;
  syncCancelButton();
  if (!list) return;
  bindHistoryListOnce(list);
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
      const title = runDisplayName(run, run.id);
      const started = run.started_at
        ? new Date(run.started_at).toLocaleString()
        : "—";
      return `<div class="task-item-card${active}" data-run-id="${escapeHtml(run.id)}" title="${escapeHtml((run.goal_prompt || "").trim() || run.id)}">
        <div class="task-item-top">
          <div class="task-item-title">${escapeHtml(title)}</div>
          <button type="button" class="task-item-delete" data-delete-run="${escapeHtml(run.id)}" title="删除此任务" aria-label="删除此任务">删除</button>
        </div>
        <div class="task-item-meta">
          <span style="color:${meta.color};">${escapeHtml(meta.label)}</span>
          <span>${escapeHtml(started)}</span>
        </div>
      </div>`;
    })
    .join("");
}

/** Stable delegation — survives innerHTML re-renders from task-run-updated. */
function bindHistoryListOnce(list: HTMLElement): void {
  if (state.historyBound) return;
  state.historyBound = true;

  list.addEventListener(
    "click",
    (ev) => {
      const el = eventElement(ev);
      if (!el || !list.contains(el)) return;

      const deleteBtn = el.closest("[data-delete-run]");
      if (deleteBtn instanceof HTMLElement && list.contains(deleteBtn)) {
        ev.preventDefault();
        ev.stopPropagation();
        const id = deleteBtn.getAttribute("data-delete-run");
        if (id) void onDeleteRun(id);
        return;
      }

      const card = el.closest("[data-run-id]");
      if (card instanceof HTMLElement && list.contains(card)) {
        if (el.closest("[data-delete-run]")) return;
        const id = card.getAttribute("data-run-id");
        if (id) void selectRun(id);
      }
    },
    true,
  );
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

async function selectRun(
  runId: string,
  expectedRefreshGeneration?: number,
): Promise<void> {
  const isCurrentRefresh = (): boolean =>
    expectedRefreshGeneration === undefined ||
    expectedRefreshGeneration === state.historyRefreshGeneration;

  if (!isCurrentRefresh()) return;
  state.selectedRunId = runId;
  state.logFilter = "all";
  if (state.cancelling) {
    // keep cancelling flag only while the same run is still active
  }
  renderHistory();
  renderDeliveryReport(state.runs.find((run) => run.id === runId) || null);
  syncCancelButton();
  try {
    const full = await getTaskRun(runId);
    if (!isCurrentRefresh()) return;
    if (!full) {
      showToast("Run 不存在");
      return;
    }
    const runIndex = state.runs.findIndex((run) => run.id === full.run.id);
    if (runIndex >= 0) state.runs[runIndex] = full.run;
    else state.runs.unshift(full.run);
    renderHistory();
    renderDeliveryReport(full.run);
    state.nodes = full.nodes;
    const failed = full.nodes.find((n) => n.status === "failed");
    const running = full.nodes.find((n) => n.status === "running");
    state.selectedNodeId =
      failed?.id || running?.id || full.nodes[0]?.id || null;
    renderDagPanel();

    const logs = await listTaskLogs(runId);
    if (!isCurrentRefresh()) return;
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
    } else {
      clearArtifactPanel("选择 DAG 节点查看产物");
    }
  } catch (e) {
    showToast(`加载 Run 失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function refreshTaskHistory(preferRunId?: string): Promise<void> {
  const generation = ++state.historyRefreshGeneration;
  try {
    const runs = await listTaskRuns(50);
    if (generation !== state.historyRefreshGeneration) return;
    state.runs = runs.filter((run) => !state.deletedRunIds.has(run.id));
    renderHistory();
    const pick =
      preferRunId ||
      state.selectedRunId ||
      state.runs[0]?.id ||
      null;
    if (pick && state.runs.some((r) => r.id === pick)) {
      await selectRun(pick, generation);
    } else if (state.runs[0]) {
      await selectRun(state.runs[0].id, generation);
    } else {
      clearRunDetail();
    }
  } catch (e) {
    if (generation !== state.historyRefreshGeneration) return;
    showToast(
      `加载任务历史失败: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function clearRunDetail(): void {
  state.selectedRunId = null;
  state.nodes = [];
  state.selectedNodeId = null;
  state.cancelling = false;
  renderHistory();
  renderDeliveryReport(null);
  renderDagPanel();
  clearLogBody();
  clearArtifactPanel("选择任务查看产物");
  syncCancelButton();
}

async function onDeleteRun(runId: string): Promise<void> {
  if (state.deletedRunIds.has(runId)) return;

  const run = state.runs.find((r) => r.id === runId);
  const label = runDisplayName(run, runId);
  const active =
    run && (run.status === "running" || run.status === "queued");
  const msg = active
    ? `任务「${label}」仍在执行，删除将取消并清除记录。确定？`
    : `确定删除任务「${label}」？节点与日志将一并清除。`;
  try {
    const confirmed = await confirmAction(msg, {
      title: "删除执行历史",
      confirmLabel: "删除",
    });
    if (!confirmed) return;
    const refreshGenerationAtDelete = state.historyRefreshGeneration;
    state.deletedRunIds.add(runId);
    await deleteTaskRun(runId);
    // Invalidate requests started before deletion, while preserving any
    // newer request that began while the delete IPC was in flight.
    if (state.historyRefreshGeneration === refreshGenerationAtDelete) {
      state.historyRefreshGeneration += 1;
    }
    const wasSelected = state.selectedRunId === runId;
    state.runs = state.runs.filter((r) => r.id !== runId);
    if (wasSelected) {
      const next = state.runs[0]?.id;
      if (next) await selectRun(next);
      else clearRunDetail();
    } else {
      renderHistory();
    }
    showToast(`已删除 ${label}`);
  } catch (e) {
    state.deletedRunIds.delete(runId);
    showToast(`删除失败: ${e instanceof Error ? e.message : String(e)}`, {
      kind: "error",
    });
  }
}

async function onClearHistory(): Promise<void> {
  if (state.runs.length === 0) {
    showToast("暂无执行历史");
    return;
  }
  const n = state.runs.length;
  let refreshGenerationAtClear: number | null = null;
  try {
    const confirmed = await confirmAction(
      `确定清空全部 ${n} 条执行历史？进行中的任务也会被取消并删除。`,
      { title: "清空执行历史", confirmLabel: "全部清空" },
    );
    if (!confirmed) return;
    refreshGenerationAtClear = state.historyRefreshGeneration;
    for (const r of state.runs) state.deletedRunIds.add(r.id);
    const deleted = await clearTaskRuns();
    if (
      refreshGenerationAtClear !== null &&
      state.historyRefreshGeneration === refreshGenerationAtClear
    ) {
      state.historyRefreshGeneration += 1;
    }
    state.runs = [];
    clearRunDetail();
    showToast(`已清空 ${deleted} 条执行历史`);
  } catch (e) {
    // Allow retries if clear failed.
    state.deletedRunIds.clear();
    if (state.historyRefreshGeneration === refreshGenerationAtClear) {
      await refreshTaskHistory(state.selectedRunId || undefined);
    }
    showToast(`清空失败: ${e instanceof Error ? e.message : String(e)}`, {
      kind: "error",
    });
  }
}

/** Navigate to Task Center and select a specific run (history + DAG + logs). */
export async function openTaskRun(runId: string): Promise<void> {
  showView("tasks");
  await refreshTaskHistory(runId);
}

function syncCancelButton(): void {
  const btn = document.getElementById(
    "btn-cancel-run",
  ) as HTMLButtonElement | null;
  if (!btn) return;
  const run = state.runs.find((r) => r.id === state.selectedRunId);
  const active =
    !!run && (run.status === "running" || run.status === "queued");
  if (state.cancelling && active) {
    btn.disabled = true;
    btn.textContent = "取消中…";
  } else if (state.cancelling && !active) {
    state.cancelling = false;
    btn.disabled = !active;
    btn.textContent = "取消任务";
  } else {
    btn.disabled = !active;
    btn.textContent = "取消任务";
  }
}

async function onCancelRun(): Promise<void> {
  if (!state.selectedRunId) {
    showToast("请先选择要取消的任务");
    return;
  }
  const run = state.runs.find((r) => r.id === state.selectedRunId);
  if (!run || (run.status !== "running" && run.status !== "queued")) {
    showToast("只能取消排队中或执行中的任务");
    return;
  }
  const runId = run.id;
  try {
    const confirmed = await confirmAction(
      `确认取消任务「${runDisplayName(run, runId)}」？\n正在执行的节点将被终止，未开始的节点将标记为跳过。`,
      {
        title: "取消执行任务",
        confirmLabel: "确认取消",
      },
    );
    if (!confirmed) return;
    state.cancelling = true;
    syncCancelButton();
    await cancelRun(runId);
    showToast("已请求取消任务");
    await selectRun(runId);
  } catch (e) {
    state.cancelling = false;
    syncCancelButton();
    showToast(`取消失败: ${e instanceof Error ? e.message : String(e)}`);
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
    // Deleting a live run cancels the runner; a late emit must not resurrect it.
    if (state.deletedRunIds.has(run.id)) return;

    const idx = state.runs.findIndex((r) => r.id === run.id);
    if (idx >= 0) state.runs[idx] = run;
    else state.runs.unshift(run);
    if (
      state.cancelling &&
      run.id === state.selectedRunId &&
      (run.status === "cancelled" ||
        run.status === "failed" ||
        run.status === "success")
    ) {
      state.cancelling = false;
    }
    renderHistory();
    if (run.id === state.selectedRunId) {
      renderDeliveryReport(run);
      state.nodes = ev.payload.nodes;
      renderDagPanel();
      if (state.selectedNodeId) {
        void loadArtifactForNode(state.selectedNodeId);
      }
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
  document.getElementById("btn-cancel-run")?.addEventListener("click", () => {
    void onCancelRun();
  });
  document
    .getElementById("btn-save-run-template")
    ?.addEventListener("click", () => {
      if (!state.selectedRunId) {
        showToast("请先选择一个任务", { kind: "error" });
        return;
      }
      const run = state.runs.find((r) => r.id === state.selectedRunId);
      if (!run) {
        showToast("未找到选中任务", { kind: "error" });
        return;
      }
      void import("../templates/save-wizard").then((m) =>
        m.openSaveTemplateWizard({
          runId: run.id,
          goalId: run.goal_id,
          planId: run.plan_id,
        }),
      );
    });
  document
    .getElementById("btn-clear-task-history")
    ?.addEventListener("click", () => {
      void onClearHistory();
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
      showToast(state.artifactMissing ? "产物文件缺失，无法复制" : "无产物可复制");
      return;
    }
    void navigator.clipboard.writeText(state.artifactContent).then(
      () => showToast("已复制产物到剪贴板！"),
      () => showToast("复制失败"),
    );
  });
  document.getElementById("task-delivery-panel")?.addEventListener("click", (ev) => {
    const target = eventElement(ev)?.closest("[data-delivery-node]");
    if (!(target instanceof HTMLElement)) return;
    const nodeId = target.getAttribute("data-delivery-node");
    const path = target.getAttribute("data-delivery-path");
    if (nodeId && path) void openDeliveryArtifact(nodeId, path);
  });
  document
    .getElementById("btn-reveal-artifact")
    ?.addEventListener("click", () => {
      void onRevealArtifact();
    });
  document.getElementById("toggle-stream-btn")?.addEventListener("click", () => {
    state.streamPaused = !state.streamPaused;
    const btn = document.getElementById("toggle-stream-btn");
    if (btn) {
      btn.textContent = state.streamPaused ? "▶ 恢复日志流" : "⏸ 暂停日志流";
    }
    showToast(state.streamPaused ? "已暂停日志流" : "已恢复日志流");
  });

  window.addEventListener("agentflow:run-started", ((ev: CustomEvent) => {
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
