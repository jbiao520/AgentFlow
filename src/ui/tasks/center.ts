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
  type DeliveryArtifact,
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
import { confirmNear, showToast } from "../toast";
import { confirmAction } from "../modals";
import {
  renderMarkdownInlineBlock,
  setFormattedContent,
} from "../format/content";
import {
  listTemplates,
  parseTemplateVariables,
  type Template,
} from "../../lib/api/templates";

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
  /** Run-level final artifacts from delivery report. */
  deliveryArtifacts: DeliveryArtifact[];
  selectedDeliveryKey: string | null;
  deliveryContent: string;
  deliveryMissing: boolean;
  deliveryAgentId: string | null;
  deliveryPath: string | null;
  /** Bump to ignore stale async preview loads. */
  deliveryPreviewGeneration: number;
  cancelling: boolean;
  /** Run ids deleted locally — ignore stale task-run-updated resurrection. */
  deletedRunIds: Set<string>;
  /** Monotonic generation used to ignore stale history list responses. */
  historyRefreshGeneration: number;
  /** Monotonic generation used to ignore stale selectRun detail loads. */
  selectionGeneration: number;
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
  deliveryArtifacts: [],
  selectedDeliveryKey: null,
  deliveryContent: "",
  deliveryMissing: false,
  deliveryAgentId: null,
  deliveryPath: null,
  deliveryPreviewGeneration: 0,
  cancelling: false,
  deletedRunIds: new Set(),
  historyRefreshGeneration: 0,
  selectionGeneration: 0,
  historyBound: false,
  unsubs: [],
};

function deliveryArtifactKey(artifact: Pick<DeliveryArtifact, "node_id" | "path">): string {
  return `${artifact.node_id}::${artifact.path}`;
}

function pathBasename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
}

function pathDirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx > 0 ? normalized.slice(0, idx) : "";
}

function pathExtBadge(path: string): string {
  const base = pathBasename(path);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "FILE";
  return base.slice(dot + 1).toUpperCase().slice(0, 8);
}

function syncDeliveryToolbar(): void {
  const has = Boolean(state.selectedDeliveryKey);
  const hasContent = Boolean(state.deliveryContent) && !state.deliveryMissing;
  const reveal = document.getElementById("btn-delivery-reveal") as HTMLButtonElement | null;
  const copy = document.getElementById("btn-delivery-copy") as HTMLButtonElement | null;
  const expand = document.getElementById("btn-delivery-expand") as HTMLButtonElement | null;
  if (reveal) reveal.disabled = !has || !state.deliveryAgentId;
  if (copy) copy.disabled = !hasContent;
  if (expand) expand.disabled = !hasContent;
}

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

function clearDeliveryReader(message: string): void {
  state.deliveryArtifacts = [];
  state.selectedDeliveryKey = null;
  state.deliveryContent = "";
  state.deliveryMissing = false;
  state.deliveryAgentId = null;
  state.deliveryPath = null;
  state.deliveryPreviewGeneration += 1;

  const list = document.getElementById("task-delivery-artifacts");
  const title = document.getElementById("task-delivery-reader-title");
  const pathEl = document.getElementById("task-delivery-reader-path");
  const body = document.getElementById("task-delivery-reader-body");
  if (list) list.innerHTML = `<div class="delivery-empty">${escapeHtml(message)}</div>`;
  if (title) title.textContent = "尚未选择产物";
  if (pathEl) pathEl.textContent = "—";
  if (body) {
    body.classList.add("fmt-host", "resizable-panel");
    body.dataset.fmtKind = "text";
    body.innerHTML = `<div class="fmt-empty">${escapeHtml(message)}</div>`;
  }
  syncDeliveryToolbar();
  closeArtifactExpand();
}

function renderDeliveryArtifactCards(artifacts: DeliveryArtifact[]): void {
  const list = document.getElementById("task-delivery-artifacts");
  if (!list) return;

  if (!artifacts.length) {
    list.innerHTML = '<div class="delivery-empty">未发现已登记产物</div>';
    return;
  }

  list.innerHTML = artifacts
    .map((artifact) => {
      const key = deliveryArtifactKey(artifact);
      const active = key === state.selectedDeliveryKey ? " active" : "";
      const missing = !artifact.exists ? " missing" : "";
      const base = pathBasename(artifact.path);
      const dir = pathDirname(artifact.path);
      const badge = pathExtBadge(artifact.path);
      return `<button type="button" class="delivery-artifact-card${active}${missing}" role="option" aria-selected="${key === state.selectedDeliveryKey}" data-delivery-key="${escapeHtml(key)}" data-delivery-node="${escapeHtml(artifact.node_id)}" data-delivery-path="${escapeHtml(artifact.path)}" data-delivery-agent="${escapeHtml(artifact.agent_id || "")}" title="${escapeHtml(artifact.path)}">
        <div class="delivery-artifact-card-top">
          <span class="delivery-artifact-ext">${escapeHtml(badge)}</span>
          <span class="delivery-check ${artifact.exists ? "passed" : "failed"}">${artifact.exists ? "✓" : "!"}</span>
        </div>
        <div class="delivery-artifact-name">${escapeHtml(base)}</div>
        <div class="delivery-artifact-meta">
          <span class="delivery-artifact-node">${escapeHtml(artifact.node_title || "节点")}</span>
          ${dir ? `<span class="delivery-artifact-dir" title="${escapeHtml(dir)}">${escapeHtml(dir)}</span>` : ""}
        </div>
      </button>`;
    })
    .join("");

  // Keep the active chip visible in the horizontal strip.
  const activeEl = list.querySelector(".delivery-artifact-card.active");
  if (activeEl instanceof HTMLElement) {
    activeEl.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }
}

function setDeliveryReaderMeta(artifact: DeliveryArtifact | null, statusNote?: string): void {
  const title = document.getElementById("task-delivery-reader-title");
  const pathEl = document.getElementById("task-delivery-reader-path");
  if (!artifact) {
    if (title) title.textContent = "尚未选择产物";
    if (pathEl) pathEl.textContent = "—";
    return;
  }
  const base = pathBasename(artifact.path);
  if (title) {
    title.textContent = statusNote ? `${base} · ${statusNote}` : base;
  }
  if (pathEl) {
    pathEl.textContent = `${artifact.path}  ·  ${artifact.node_title || "节点"}`;
  }
}

async function selectDeliveryArtifact(
  artifact: DeliveryArtifact,
  opts?: { syncNodePanel?: boolean },
): Promise<void> {
  const key = deliveryArtifactKey(artifact);
  state.selectedDeliveryKey = key;
  state.deliveryAgentId = artifact.agent_id;
  state.deliveryPath = artifact.path;
  state.deliveryContent = "";
  state.deliveryMissing = !artifact.exists;
  const generation = ++state.deliveryPreviewGeneration;

  renderDeliveryArtifactCards(state.deliveryArtifacts);
  setDeliveryReaderMeta(artifact, artifact.exists ? "加载中…" : "文件缺失");
  syncDeliveryToolbar();

  const body = document.getElementById("task-delivery-reader-body");
  if (body) {
    body.classList.add("fmt-host");
    body.innerHTML = `<div style="padding:14px 0; display:flex; flex-direction:column; gap:8px;">
      <span class="skeleton-line" style="width:62%;"></span>
      <span class="skeleton-line" style="width:88%;"></span>
      <span class="skeleton-line" style="width:48%;"></span>
      <span class="skeleton-line" style="width:74%;"></span>
    </div>`;
  }

  if (opts?.syncNodePanel !== false) {
    state.selectedNodeId = artifact.node_id;
    renderDagPanel();
    // Keep node panel in sync without stealing focus from the delivery reader.
    void loadArtifactForNode(artifact.node_id).then(() => {
      if (state.artifactPaths.includes(artifact.path)) {
        void selectArtifactPath(artifact.path);
      }
    });
  }

  if (!artifact.exists) {
    if (body) {
      body.innerHTML = `<div class="fmt-empty">产物文件尚未生成或不存在。\n\n路径: ${escapeHtml(artifact.path)}\n来源节点: ${escapeHtml(artifact.node_title || artifact.node_id)}\n\n可尝试「Finder」打开对应 workspace 目录确认。</div>`;
    }
    setDeliveryReaderMeta(artifact, "缺失");
    syncDeliveryToolbar();
    return;
  }

  if (!artifact.agent_id) {
    state.deliveryMissing = true;
    if (body) {
      body.innerHTML = `<div class="fmt-empty">无法读取产物：节点未绑定 Agent。\n\n路径: ${escapeHtml(artifact.path)}</div>`;
    }
    setDeliveryReaderMeta(artifact, "无法读取");
    syncDeliveryToolbar();
    return;
  }

  try {
    const file = await readWorkspaceFile(artifact.agent_id, artifact.path);
    if (generation !== state.deliveryPreviewGeneration) return;
    state.deliveryContent = file.content;
    state.deliveryMissing = false;
    setFormattedContent(body, file.content, artifact.path);
    setDeliveryReaderMeta(artifact);
    syncDeliveryToolbar();
    // If expand overlay is open, refresh it too.
    const overlay = document.getElementById("artifact-expand-overlay");
    if (overlay && !overlay.hidden) {
      openArtifactExpand({
        title: pathBasename(artifact.path),
        path: artifact.path,
        content: file.content,
      });
    }
  } catch (e) {
    if (generation !== state.deliveryPreviewGeneration) return;
    const msg = e instanceof Error ? e.message : String(e);
    state.deliveryContent = "";
    state.deliveryMissing = true;
    if (body) {
      body.innerHTML = `<div class="fmt-empty">无法读取产物: ${escapeHtml(msg)}\n\n相对路径: ${escapeHtml(artifact.path)}\n可点「Finder」打开 workspace / artifacts 目录。</div>`;
    }
    setDeliveryReaderMeta(artifact, "读取失败");
    syncDeliveryToolbar();
  }
}

function openArtifactExpand(opts: {
  title: string;
  path: string;
  content: string;
}): void {
  const overlay = document.getElementById("artifact-expand-overlay");
  const titleEl = document.getElementById("artifact-expand-title");
  const pathEl = document.getElementById("artifact-expand-path");
  const body = document.getElementById("artifact-expand-body");
  if (!overlay || !body) return;
  if (titleEl) titleEl.textContent = opts.title;
  if (pathEl) pathEl.textContent = opts.path;
  setFormattedContent(body, opts.content, opts.path);
  overlay.hidden = false;
  overlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("artifact-expand-open");
}

function closeArtifactExpand(): void {
  const overlay = document.getElementById("artifact-expand-overlay");
  if (!overlay) return;
  overlay.hidden = true;
  overlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("artifact-expand-open");
}

function isTerminalStatus(status: string | undefined): boolean {
  return status === "success" || status === "failed" || status === "cancelled";
}

function formatElapsed(
  started: string | null | undefined,
  finished: string | null | undefined,
): string {
  if (!started) return "—";
  const a = Date.parse(started.endsWith("Z") || started.includes("+") ? started : `${started}Z`);
  const b = finished
    ? Date.parse(finished.endsWith("Z") || finished.includes("+") ? finished : `${finished}Z`)
    : Date.now();
  if (Number.isNaN(a) || Number.isNaN(b)) return "—";
  const secs = Math.max(0, Math.round((b - a) / 1000));
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m < 60) return `${m}m ${s}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function runSourceLabel(run: TaskRun): string {
  if (run.schedule_id) return run.is_manual ? "定时·手动" : "定时";
  return "手动";
}

/** Runs created by a schedule already have a template + schedule — no flywheel CTAs. */
function isScheduleTriggered(run: TaskRun): boolean {
  return Boolean(run.schedule_id);
}

function nodeStats(nodes: TaskNode[]): { ok: number; failed: number; skipped: number; total: number } {
  const total = nodes.length;
  let ok = 0;
  let failed = 0;
  let skipped = 0;
  for (const n of nodes) {
    if (n.status === "success") ok += 1;
    else if (n.status === "failed") failed += 1;
    else if (n.status === "skipped") skipped += 1;
  }
  return { ok, failed, skipped, total };
}

function applyTerminalLayout(run: TaskRun | null): void {
  const col = document.getElementById("task-detail-column");
  const dagBody = document.getElementById("task-dag-container");
  const dagToggle = document.getElementById(
    "btn-toggle-dag-section",
  ) as HTMLButtonElement | null;
  const logTerm = document.getElementById("task-log-terminal");
  const details = document.getElementById("task-delivery-details");
  const foldBtn = document.getElementById(
    "btn-toggle-delivery-details",
  ) as HTMLButtonElement | null;
  const terminal = isTerminalStatus(run?.status);
  col?.classList.toggle("task-detail-terminal", terminal);
  logTerm?.classList.toggle("task-log-collapsed", terminal);

  if (terminal) {
    if (details) details.hidden = false;
    if (foldBtn) {
      foldBtn.setAttribute("aria-expanded", "true");
      foldBtn.textContent = "详情 ▴";
    }
    // Collapse DAG body by default on terminal (user can expand).
    if (dagBody && !dagBody.dataset.userExpanded) {
      dagBody.hidden = true;
      if (dagToggle) {
        dagToggle.setAttribute("aria-expanded", "false");
        dagToggle.textContent = "展开 ▾";
      }
    }
  } else {
    if (dagBody) {
      dagBody.hidden = false;
      delete dagBody.dataset.userExpanded;
    }
    if (dagToggle) {
      dagToggle.setAttribute("aria-expanded", "true");
      dagToggle.textContent = "折叠 ▴";
    }
  }
}

function renderConclusionBar(run: TaskRun | null, nodes: TaskNode[]): void {
  const card = document.getElementById("task-delivery-conclusion");
  const pill = document.getElementById("task-conclusion-pill");
  const summaryEl = document.getElementById("task-conclusion-summary");
  const metaEl = document.getElementById("task-conclusion-meta");
  if (!card || !pill || !summaryEl || !metaEl) return;

  if (!run || !isTerminalStatus(run.status)) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const stats = nodeStats(nodes);
  const partial = isPartialRun(run, nodes);

  let label = "已完成交付";
  let pillClass = "task-conclusion-pill is-success";
  if (run.status === "cancelled") {
    label = "已取消";
    pillClass = "task-conclusion-pill is-cancelled";
  } else if (partial) {
    label = "部分完成";
    pillClass = "task-conclusion-pill is-partial";
  } else if (run.status === "failed") {
    label = "未完成";
    pillClass = "task-conclusion-pill is-failed";
  }

  const report = parseDeliveryReport(run);
  const oneLiner =
    (report?.summary && sanitizeDeliveryText(report.summary).split("\n")[0]) ||
    (run.goal_prompt || "").trim() ||
    "任务已结束";

  pill.className = pillClass;
  pill.textContent = label;
  summaryEl.textContent =
    oneLiner.length > 160 ? `${oneLiner.slice(0, 159)}…` : oneLiner;
  // Keep Chinese source strings; i18n observer translates for en.
  metaEl.textContent = [
    `节点 ${stats.ok}/${stats.total} 成功`,
    stats.failed ? `${stats.failed} 失败` : null,
    stats.skipped ? `${stats.skipped} 跳过` : null,
    `耗时 ${formatElapsed(run.started_at, run.finished_at)}`,
    runSourceLabel(run),
  ]
    .filter(Boolean)
    .join(" · ");
}

async function findTemplateForRun(runId: string): Promise<Template | null> {
  try {
    const list = await listTemplates();
    const matches = list.filter((t) => t.source_run_id === runId);
    if (matches.length === 0) return null;
    matches.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
    return matches[0];
  } catch {
    return null;
  }
}

/** ≥1 success and ≥1 failed|skipped → partial (design Part A conclusion). */
function isPartialRun(_run: TaskRun, nodes: TaskNode[]): boolean {
  const stats = nodeStats(nodes);
  return stats.ok > 0 && stats.failed + stats.skipped > 0;
}

function selectFailedNode(nodes: TaskNode[]): TaskNode | null {
  return nodes.find((n) => n.status === "failed") || null;
}

function retryFailedNode(nodes: TaskNode[]): void {
  const failed = selectFailedNode(nodes);
  if (!failed) {
    showToast("没有失败节点可重试", { kind: "info" });
    return;
  }
  state.selectedNodeId = failed.id;
  renderDagPanel();
  void onRetry();
}

function syncSaveTemplateButton(run: TaskRun | null): void {
  const btn = document.getElementById(
    "btn-save-run-template",
  ) as HTMLButtonElement | null;
  if (!btn) return;
  // Schedule-triggered runs already come from a template; hide save CTA.
  const hide = !!run && isScheduleTriggered(run);
  btn.hidden = hide;
  btn.style.display = hide ? "none" : "";
}

async function renderReuseBar(run: TaskRun | null, nodes: TaskNode[]): Promise<void> {
  const bar = document.getElementById("run-reuse-bar");
  const copy = document.getElementById("run-reuse-copy");
  const actions = document.getElementById("run-reuse-actions");
  if (!bar || !copy || !actions) return;

  syncSaveTemplateButton(run);

  if (!run || !isTerminalStatus(run.status)) {
    bar.hidden = true;
    return;
  }

  // Already scheduled — do not push "save template" / "set schedule" again.
  if (isScheduleTriggered(run)) {
    bar.hidden = true;
    return;
  }

  const partial = isPartialRun(run, nodes);
  const stats = nodeStats(nodes);
  const failedOnly = run.status === "failed" && stats.ok === 0;
  const cancelled = run.status === "cancelled";

  bar.hidden = false;
  const linked = await findTemplateForRun(run.id);
  // Race: user may have switched run
  if (state.selectedRunId !== run.id) return;

  actions.innerHTML = "";
  const addBtn = (
    label: string,
    kind: "primary" | "secondary",
    onClick: () => void,
  ) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `btn btn-${kind} btn-sm`;
    b.textContent = label;
    b.addEventListener("click", onClick);
    actions.appendChild(b);
  };

  if (failedOnly || cancelled) {
    copy.textContent = cancelled
      ? "任务已取消。可重试失败节点，或回到调度重新编排。"
      : "任务未完成。可重试失败节点，或回到调度重新编排。";
    if (selectFailedNode(nodes)) {
      addBtn("重试失败节点", "primary", () => retryFailedNode(nodes));
    }
    addBtn("重新编排", "secondary", () => showView("commander"));
    return;
  }

  if (partial) {
    const hasFailed = stats.failed > 0;
    copy.textContent = hasFailed
      ? "部分完成，请查看失败节点。可保存为模版，但不建议直接设为定时。"
      : "部分节点被跳过。可保存为模版，建议确认跳过原因后再复用。";
    if (hasFailed) {
      addBtn("重试失败节点", "primary", () => retryFailedNode(nodes));
    }
    addBtn("保存为模版", "secondary", () => openSaveForRun(run));
    return;
  }

  if (linked) {
    copy.textContent = `已保存为「${linked.name}」。可设为定时自动跑，或用同一模版再跑一次。`;
    addBtn("设为定时", "primary", () => {
      void openScheduleForTemplate(linked);
    });
    addBtn("再跑一次", "secondary", () => {
      void rerunTemplate(linked);
    });
    addBtn("打开模版", "secondary", () => {
      void import("../templates/page").then((m) => m.openTemplate(linked.id));
    });
    return;
  }

  copy.textContent =
    "这次跑通了。保存为模版后，下次只填变量即可复用；也可以设为定时自动跑。";
  addBtn("保存为模版", "primary", () => openSaveForRun(run));
  addBtn("设为定时", "secondary", () => {
    showToast("请先保存为模版，保存成功后可直接设为定时", { kind: "info" });
    openSaveForRun(run);
  });
  addBtn("再跑一次", "secondary", () => {
    showToast("请先保存为模版以便带变量再跑", { kind: "info" });
    openSaveForRun(run);
  });
}

function openSaveForRun(run: TaskRun): void {
  void import("../templates/save-wizard").then((m) =>
    m.openSaveTemplateWizard({
      runId: run.id,
      goalId: run.goal_id,
      planId: run.plan_id,
    }),
  );
}

async function openScheduleForTemplate(t: Template): Promise<void> {
  const vars = parseTemplateVariables(t.variables_json);
  const values: Record<string, string> = {};
  for (const v of vars) {
    if (v.default) values[v.key] = v.default;
  }
  const m = await import("../schedules/create-modal");
  await m.openCreateScheduleModal({
    templateId: t.id,
    name: `${t.name} 定时`,
    values,
  });
}

async function rerunTemplate(t: Template): Promise<void> {
  const vars = parseTemplateVariables(t.variables_json);
  const values: Record<string, string> = {};
  let missing = false;
  for (const v of vars) {
    if (v.default) values[v.key] = v.default;
    else if (v.required) missing = true;
  }
  if (missing || vars.length > 0) {
    showView("templates");
    showToast("请在模版库填写变量后执行", { kind: "info" });
    return;
  }
  try {
    const { instantiateTemplate } = await import("../../lib/api/templates");
    const result = await instantiateTemplate({
      templateId: t.id,
      values,
      dispatch: true,
    });
    const runId =
      result.started?.run_id || result.dispatch?.run.id || null;
    if (runId) {
      showToast("已再次启动", { kind: "success" });
      await openTaskRun(runId);
    } else {
      showToast(result.orchestrate.error || "启动失败", { kind: "error" });
    }
  } catch (e) {
    showToast(`再跑失败: ${e instanceof Error ? e.message : String(e)}`, {
      kind: "error",
    });
  }
}

function refreshDeliveryChrome(run: TaskRun | null): void {
  applyTerminalLayout(run);
  renderConclusionBar(run, state.nodes);
  void renderReuseBar(run, state.nodes);
}

function renderDeliveryReport(run: TaskRun | null): void {
  refreshDeliveryChrome(run);

  const summary = document.getElementById("task-delivery-summary");
  const status = document.getElementById("task-delivery-status");
  const files = document.getElementById("task-delivery-files");
  const verification = document.getElementById("task-delivery-verification");
  const risks = document.getElementById("task-delivery-risks");
  const diffDetails = document.getElementById("task-delivery-diff-details");
  const diff = document.getElementById("task-delivery-diff");
  const filesCount = document.getElementById("task-delivery-files-count");
  const artifactsCount = document.getElementById("task-delivery-artifacts-count");
  const verificationCount = document.getElementById("task-delivery-verification-count");
  const risksCount = document.getElementById("task-delivery-risks-count");
  if (!summary || !status || !files || !verification || !risks) return;

  const report = parseDeliveryReport(run);
  const active = run?.status === "running" || run?.status === "queued";
  status.className = "delivery-status-badge";
  if (active) {
    status.classList.add("delivery-status-pending");
    status.textContent = "生成中";
    summary.innerHTML = renderMarkdownInlineBlock(
      "任务执行中；完成后会自动生成验收摘要、改动 Diff、最终产物、验证结果和风险说明。",
    );
    files.innerHTML = verification.innerHTML = risks.innerHTML =
      '<div class="delivery-empty">任务完成后自动生成</div>';
    if (filesCount) filesCount.textContent = "—";
    if (artifactsCount) artifactsCount.textContent = "—";
    if (verificationCount) verificationCount.textContent = "—";
    if (risksCount) risksCount.textContent = "—";
    if (diffDetails) diffDetails.style.display = "none";
    clearDeliveryReader("任务完成后自动汇总最终产物，并支持直接预览。");
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
    files.innerHTML = verification.innerHTML = risks.innerHTML =
      '<div class="delivery-empty">—</div>';
    if (filesCount) filesCount.textContent = "0";
    if (artifactsCount) artifactsCount.textContent = "0";
    if (verificationCount) verificationCount.textContent = "0";
    if (risksCount) risksCount.textContent = "0";
    if (diffDetails) diffDetails.style.display = "none";
    clearDeliveryReader(
      run
        ? "该历史任务尚无最终产物清单。"
        : "选择任务后，最终产物会显示在这里，可直接阅读。",
    );
    return;
  }

  const hasFailure = run?.status === "failed" || run?.status === "cancelled";
  status.classList.add(hasFailure ? "delivery-status-failed" : "delivery-status-ready");
  status.textContent = hasFailure ? "需关注" : "可验收";
  summary.innerHTML = renderDeliverySummary(report.summary);

  if (filesCount) filesCount.textContent = String(report.changed_files.length);
  files.innerHTML = report.changed_files.length
    ? report.changed_files
        .map(
          (file) =>
            `<div class="delivery-file-row"><span class="delivery-file-status">${escapeHtml(file.status)}</span><code>${escapeHtml(file.path)}</code><span class="delivery-meta">· ${escapeHtml(file.workspace)}</span></div>`,
        )
        .join("")
    : '<div class="delivery-empty">未检测到 Git 改动</div>';
  if (diffDetails && diff) {
    diffDetails.style.display = report.diff ? "block" : "none";
    if (report.diff) {
      setFormattedContent(diff, report.diff, "changes.diff");
    } else {
      diff.textContent = "";
    }
  }

  state.deliveryArtifacts = report.artifacts;
  if (artifactsCount) artifactsCount.textContent = String(report.artifacts.length);
  renderDeliveryArtifactCards(report.artifacts);

  // Prefer previously selected artifact if still present; else first existing; else first.
  const preferred =
    report.artifacts.find((a) => deliveryArtifactKey(a) === state.selectedDeliveryKey) ||
    report.artifacts.find((a) => a.exists) ||
    report.artifacts[0] ||
    null;
  if (preferred) {
    const key = deliveryArtifactKey(preferred);
    const alreadyLoaded =
      key === state.selectedDeliveryKey &&
      Boolean(state.deliveryContent) &&
      !state.deliveryMissing;
    if (alreadyLoaded) {
      setDeliveryReaderMeta(preferred);
      syncDeliveryToolbar();
    } else {
      void selectDeliveryArtifact(preferred, { syncNodePanel: false });
    }
  } else {
    clearDeliveryReader("未发现已登记产物");
    state.deliveryArtifacts = [];
  }

  if (verificationCount) verificationCount.textContent = String(report.verification.length);
  verification.innerHTML = report.verification.length
    ? report.verification
        .map(
          (item) =>
            `<div class="delivery-verification-row"><span class="delivery-check ${escapeHtml(item.status)}">${item.status === "passed" ? "✓" : item.status === "failed" ? "×" : "!"}</span><div class="delivery-verification-text"><div class="delivery-verification-label">${escapeHtml(item.label)}</div><div class="delivery-verification-detail">${renderMarkdownInlineBlock(sanitizeDeliveryText(item.detail))}</div></div></div>`,
        )
        .join("")
    : '<div class="delivery-empty">暂无验证结果</div>';

  if (risksCount) risksCount.textContent = String(report.risks.length);
  risks.innerHTML = report.risks.length
    ? report.risks
        .map(
          (risk) =>
            `<div class="delivery-risk-row"><span class="delivery-risk-icon">⚠</span><div class="delivery-risk-text">${renderMarkdownInlineBlock(sanitizeDeliveryText(risk))}</div></div>`,
        )
        .join("")
    : '<div class="delivery-empty delivery-empty-ok">未发现额外风险</div>';
}

/** Drop leftover prompt-template / marker noise from older stored reports. */
function sanitizeDeliveryText(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (/AGENT(?:FLOW|MIND)_(?:SUMMARY|VERIFY|RISK|ARTIFACT)\s*:/i.test(line)) {
        return false;
      }
      if (
        /<one-sentence|<check name>|<what you checked>|<remaining risk|<workspace-relative|or omit this line|Keep using AGENT/i.test(
          line,
        )
      ) {
        return false;
      }
      return true;
    })
    .join("\n")
    .trim();
}

function renderDeliverySummary(raw: string): string {
  const cleaned = sanitizeDeliveryText(raw);
  if (!cleaned) {
    return renderMarkdownInlineBlock("暂无结果摘要");
  }
  // Normalize plain multi-line dumps into a readable markdown list.
  const lines = cleaned
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length <= 1) {
    return renderMarkdownInlineBlock(lines[0] || cleaned);
  }
  const asList = lines
    .map((line) => (/^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line) ? line : `- ${line}`))
    .join("\n");
  return renderMarkdownInlineBlock(asList);
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
          ? '<span class="artifact-path-missing-tag">缺失</span>'
          : "";
      const base = pathBasename(path);
      const dir = pathDirname(path);
      const badge = pathExtBadge(path);
      return `<button type="button" class="artifact-path-item${active}${missing}" role="option" data-artifact-path="${escapeHtml(path)}" aria-selected="${path === state.selectedArtifactPath}" title="${escapeHtml(path)}">
        <span class="artifact-path-item-row">
          <span class="delivery-artifact-ext">${escapeHtml(badge)}</span>
          <span class="artifact-path-item-name">${escapeHtml(base)}</span>
          ${missingTag}
        </span>
        ${dir ? `<span class="artifact-path-item-dir">${escapeHtml(dir)}</span>` : ""}
      </button>`;
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
  const runId = state.selectedRunId;
  const agentId = state.artifactAgentId;
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

  if (!agentId) {
    state.artifactMissing = true;
    if (box) {
      box.innerHTML = `<div class="fmt-empty">无法读取产物: 节点未绑定 Agent</div>`;
    }
    renderArtifactList();
    return;
  }

  const stillCurrent = (): boolean =>
    state.selectedRunId === runId && state.selectedArtifactPath === relPath;

  try {
    const file = await readWorkspaceFile(agentId, relPath);
    if (!stillCurrent()) return;
    state.artifactContent = file.content;
    state.artifactMissing = false;
    setFormattedContent(box, file.content, relPath);
  } catch (e) {
    if (!stillCurrent()) return;
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
  if (!stillCurrent()) return;
  renderArtifactList();
}

async function loadArtifactForNode(nodeId: string): Promise<void> {
  const runId = state.selectedRunId;
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
    if (state.selectedRunId !== runId || state.selectedNodeId !== nodeId) return;
    clearArtifactPanel("该节点暂无产物路径");
    state.artifactAgentId = node.agent_id;
    return;
  }

  await selectArtifactPath(paths[0]);
}

async function openDeliveryArtifact(nodeId: string, path: string): Promise<void> {
  const fromReport = state.deliveryArtifacts.find(
    (a) => a.node_id === nodeId && a.path === path,
  );
  if (fromReport) {
    await selectDeliveryArtifact(fromReport, { syncNodePanel: true });
    return;
  }
  state.selectedNodeId = nodeId;
  renderDagPanel();
  await loadArtifactForNode(nodeId);
  if (state.artifactPaths.includes(path)) {
    await selectArtifactPath(path);
  }
}

async function revealArtifactAt(
  agentId: string | null,
  relativePath: string | null,
): Promise<void> {
  if (!agentId || !relativePath) {
    showToast("请先选择有产物路径的节点");
    return;
  }
  try {
    const result = await revealWorkspaceArtifact(agentId, relativePath);
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

async function onRevealArtifact(): Promise<void> {
  await revealArtifactAt(state.artifactAgentId, state.selectedArtifactPath);
}

async function onRevealDeliveryArtifact(): Promise<void> {
  await revealArtifactAt(state.deliveryAgentId, state.deliveryPath);
}

function copyText(content: string, emptyMsg: string): void {
  if (!content) {
    showToast(emptyMsg);
    return;
  }
  void navigator.clipboard.writeText(content).then(
    () => showToast("已复制产物到剪贴板！"),
    () => showToast("复制失败"),
  );
}

function expandCurrentDeliveryArtifact(): void {
  if (!state.deliveryContent || state.deliveryMissing) {
    showToast("没有可预览的产物内容");
    return;
  }
  openArtifactExpand({
    title: pathBasename(state.deliveryPath || "产物预览"),
    path: state.deliveryPath || "—",
    content: state.deliveryContent,
  });
}

function expandCurrentNodeArtifact(): void {
  if (!state.artifactContent || state.artifactMissing) {
    showToast(state.artifactMissing ? "产物文件缺失，无法预览" : "无产物可预览");
    return;
  }
  openArtifactExpand({
    title: pathBasename(state.selectedArtifactPath || "产物预览"),
    path: state.selectedArtifactPath || "—",
    content: state.artifactContent,
  });
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
        <div style="margin-bottom:10px;">从调度 Orchestrate → Dispatch 后，历史会出现在这里。</div>
        <button type="button" class="btn btn-secondary btn-sm" id="tasks-empty-cta">打开调度</button>
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
        if (id) void onDeleteRun(id, deleteBtn);
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

  const selectionToken = ++state.selectionGeneration;
  const isCurrentSelection = (): boolean =>
    isCurrentRefresh() &&
    state.selectionGeneration === selectionToken &&
    state.selectedRunId === runId;

  const runChanged = state.selectedRunId !== runId;
  state.selectedRunId = runId;
  state.logFilter = "all";
  if (runChanged) {
    // Avoid reusing previous run's preview content when keys collide.
    state.selectedDeliveryKey = null;
    state.deliveryContent = "";
    state.deliveryMissing = false;
    state.deliveryAgentId = null;
    state.deliveryPath = null;
    state.deliveryPreviewGeneration += 1;
    closeArtifactExpand();
  }
  if (state.cancelling) {
    // keep cancelling flag only while the same run is still active
  }
  renderHistory();
  renderDeliveryReport(state.runs.find((run) => run.id === runId) || null);
  syncCancelButton();
  try {
    const full = await getTaskRun(runId);
    if (!isCurrentSelection()) return;
    if (!full) {
      showToast("Run 不存在");
      return;
    }
    const runIndex = state.runs.findIndex((run) => run.id === full.run.id);
    if (runIndex >= 0) state.runs[runIndex] = full.run;
    else state.runs.unshift(full.run);
    renderHistory();
    state.nodes = full.nodes;
    renderDeliveryReport(full.run);
    const failed = full.nodes.find((n) => n.status === "failed");
    const running = full.nodes.find((n) => n.status === "running");
    state.selectedNodeId =
      failed?.id || running?.id || full.nodes[0]?.id || null;
    renderDagPanel();

    const logs = await listTaskLogs(runId);
    if (!isCurrentSelection()) return;
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
    if (!isCurrentSelection()) return;
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
  state.selectionGeneration += 1;
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

function isActiveRunStatus(status: string | undefined): boolean {
  return status === "running" || status === "queued";
}

async function onDeleteRun(
  runId: string,
  anchor?: HTMLElement,
): Promise<void> {
  if (state.deletedRunIds.has(runId)) return;

  const run = state.runs.find((r) => r.id === runId);
  const label = runDisplayName(run, runId);
  const active = isActiveRunStatus(run?.status);
  const confirmed = anchor
    ? await confirmNear(anchor, {
        message: active ? "仍在执行，终止并删除？" : "确认删除？",
        confirmLabel: active ? "终止并删除" : "删除",
      })
    : await confirmAction(
        active
          ? `任务「${label}」仍在执行中。删除会终止执行并移除记录，确定继续？`
          : `确认删除任务「${label}」？此操作不可撤销。`,
        {
          title: active ? "删除执行中的任务" : "删除任务",
          confirmLabel: active ? "终止并删除" : "删除",
        },
      );
  if (!confirmed) return;

  try {
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

async function onClearHistory(anchor?: HTMLElement): Promise<void> {
  if (state.runs.length === 0) {
    showToast("暂无执行历史");
    return;
  }
  const activeCount = state.runs.filter((r) =>
    isActiveRunStatus(r.status),
  ).length;
  const confirmed = anchor
    ? await confirmNear(anchor, {
        message:
          activeCount > 0
            ? `清空 ${state.runs.length} 条（含 ${activeCount} 条执行中）？`
            : `清空全部 ${state.runs.length} 条历史？`,
        confirmLabel: activeCount > 0 ? "终止并清空" : "清空",
      })
    : await confirmAction(
        activeCount > 0
          ? `将清空全部 ${state.runs.length} 条历史，其中 ${activeCount} 条仍在执行并将被终止。确定继续？`
          : `确认清空全部 ${state.runs.length} 条执行历史？此操作不可撤销。`,
        {
          title: "清空执行历史",
          confirmLabel: activeCount > 0 ? "终止并清空" : "清空",
        },
      );
  if (!confirmed) return;

  let refreshGenerationAtClear: number | null = null;
  try {
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
      state.nodes = ev.payload.nodes;
      renderDeliveryReport(run);
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

  document
    .getElementById("btn-toggle-dag-section")
    ?.addEventListener("click", () => {
      const dagBody = document.getElementById("task-dag-container");
      const btn = document.getElementById(
        "btn-toggle-dag-section",
      ) as HTMLButtonElement | null;
      if (!dagBody || !btn) return;
      const open = dagBody.hidden;
      dagBody.hidden = !open;
      if (open) dagBody.dataset.userExpanded = "1";
      else delete dagBody.dataset.userExpanded;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.textContent = open ? "折叠 ▴" : "展开 ▾";
    });

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
      if (isScheduleTriggered(run)) {
        showToast("定时触发的任务无需再保存模版", { kind: "info" });
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
    ?.addEventListener("click", (ev) => {
      const btn = ev.currentTarget;
      void onClearHistory(btn instanceof HTMLElement ? btn : undefined);
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
    copyText(
      state.artifactContent,
      state.artifactMissing ? "产物文件缺失，无法复制" : "无产物可复制",
    );
  });
  document.getElementById("btn-expand-node-artifact")?.addEventListener("click", () => {
    expandCurrentNodeArtifact();
  });
  document.getElementById("task-delivery-panel")?.addEventListener("click", (ev) => {
    const target = eventElement(ev)?.closest("[data-delivery-key], [data-delivery-node]");
    if (!(target instanceof HTMLElement)) return;
    // Ignore toolbar clicks inside the reader.
    if (target.closest(".delivery-artifacts-toolbar")) return;
    const nodeId = target.getAttribute("data-delivery-node");
    const path = target.getAttribute("data-delivery-path");
    if (nodeId && path) void openDeliveryArtifact(nodeId, path);
  });
  document.getElementById("btn-delivery-reveal")?.addEventListener("click", () => {
    void onRevealDeliveryArtifact();
  });
  document.getElementById("btn-delivery-copy")?.addEventListener("click", () => {
    copyText(
      state.deliveryContent,
      state.deliveryMissing ? "产物文件缺失，无法复制" : "无产物可复制",
    );
  });
  document.getElementById("btn-delivery-expand")?.addEventListener("click", () => {
    expandCurrentDeliveryArtifact();
  });
  document.getElementById("btn-expand-close")?.addEventListener("click", () => {
    closeArtifactExpand();
  });
  document.getElementById("btn-expand-copy")?.addEventListener("click", () => {
    const content = state.deliveryContent || state.artifactContent;
    copyText(content, "无产物可复制");
  });
  document.getElementById("btn-expand-reveal")?.addEventListener("click", () => {
    if (state.deliveryAgentId && state.deliveryPath) {
      void onRevealDeliveryArtifact();
      return;
    }
    void onRevealArtifact();
  });
  document.getElementById("artifact-expand-overlay")?.addEventListener("click", (ev) => {
    if (ev.target === ev.currentTarget) closeArtifactExpand();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeArtifactExpand();
  });
  document.getElementById("btn-toggle-delivery-details")?.addEventListener("click", () => {
    const body = document.getElementById("task-delivery-details");
    const btn = document.getElementById(
      "btn-toggle-delivery-details",
    ) as HTMLButtonElement | null;
    if (!body || !btn) return;
    const open = body.hasAttribute("hidden");
    if (open) {
      body.removeAttribute("hidden");
      btn.setAttribute("aria-expanded", "true");
      btn.textContent = "详情 ▴";
    } else {
      body.setAttribute("hidden", "");
      btn.setAttribute("aria-expanded", "false");
      btn.textContent = "详情 ▾";
    }
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
