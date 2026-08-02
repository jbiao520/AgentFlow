/**
 * Overview page: live stats, recent agents usage, running queue from SQLite.
 */
import {
  getOverviewStats,
  listRecentAgents,
  listRunningQueue,
  type OverviewStats,
  type QueueItem,
  type RecentAgentUsage,
  type UsageBreakdown,
} from "../../lib/api/overview";
import { listTaskRuns, type TaskRun } from "../../lib/api/tasks";
import { listSchedules, type Schedule } from "../../lib/api/schedules";
import { listTemplates, type Template } from "../../lib/api/templates";
import { openUsageDetailModal } from "../modals";
import { updateNavCounts } from "../nav-counts";
import { selectAgentById, showView } from "../router";
import { openTaskRun } from "../tasks/center";
import { showToast } from "../toast";

/** Latest stats payload — used when opening the token detail modal. */
let lastOverviewStats: OverviewStats | null = null;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(s: string, n: number): string {
  const t = s.trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n - 1)}…`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}k`;
  return String(n);
}

function formatCost(cost: number): string {
  if (cost <= 0) return "$0";
  if (cost >= 100) return `$${cost.toFixed(2)}`;
  return `$${cost.toPrecision(3)}`;
}

function shortModel(model: string): string {
  // "deepseek/deepseek-v4-flash" → "deepseek·v4-flash"
  const [provider, ...rest] = model.split("/");
  if (rest.length === 0) return model;
  const name = rest.join("/");
  const shortName = name.length > 16 ? `${name.slice(0, 15)}…` : name;
  return `${provider}·${shortName}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/[\s\-_./]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function statusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "working" || s === "running") return "badge-working";
  if (s === "error") return "badge-error";
  return "badge-idle";
}

function statusLabel(status: string): string {
  const s = status.toLowerCase();
  if (s === "working" || s === "running") return "working";
  if (s === "error") return "error";
  return "idle";
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const t = iso.trim().replace(/Z$/, "");
  const ms = Date.parse(t.includes("T") ? `${t}Z` : t);
  if (Number.isNaN(ms)) return iso.slice(0, 16);
  const diff = Math.max(0, Date.now() - ms);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小时前`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} 天前`;
  return iso.slice(0, 10);
}

function callBarWidth(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.max(6, Math.round((value / max) * 100));
}

function sumField(rows: UsageBreakdown[], key: keyof UsageBreakdown): number {
  return rows.reduce((acc, r) => {
    const v = r[key];
    return acc + (typeof v === "number" ? v : 0);
  }, 0);
}

function renderUsageDetail(stats: OverviewStats): void {
  const summaryEl = document.getElementById("usage-detail-summary");
  const bodyEl = document.getElementById("usage-detail-body");
  const captionEl = document.getElementById("usage-detail-caption");
  if (!summaryEl || !bodyEl) return;

  const rows = stats.usage_breakdown;
  const totalRuns = sumField(rows, "runs");
  const anyEstimated = rows.some((b) => b.estimated);
  const costText =
    stats.tokens_cost != null
      ? `${formatCost(stats.tokens_cost)}${anyEstimated ? "（含估算）" : ""}`
      : "—";

  if (captionEl) {
    captionEl.textContent =
      rows.length === 0
        ? "尚无消耗记录"
        : `按引擎 / 模型汇总 · 共 ${rows.length} 个模型 · ${totalRuns} 次执行`;
  }

  summaryEl.innerHTML = `
    <div class="usage-summary-chip accent">
      <span class="chip-label">总 Token</span>
      <span class="chip-value">${escapeHtml(formatTokens(stats.tokens_total))}</span>
    </div>
    <div class="usage-summary-chip">
      <span class="chip-label">费用</span>
      <span class="chip-value">${escapeHtml(costText)}</span>
    </div>
    <div class="usage-summary-chip">
      <span class="chip-label">执行次数</span>
      <span class="chip-value">${totalRuns}</span>
    </div>
    <div class="usage-summary-chip">
      <span class="chip-label">模型数</span>
      <span class="chip-value">${rows.length}</span>
    </div>
    <div class="usage-summary-chip">
      <span class="chip-label">Input</span>
      <span class="chip-value">${escapeHtml(formatTokens(sumField(rows, "input_tokens")))}</span>
    </div>
    <div class="usage-summary-chip">
      <span class="chip-label">Output</span>
      <span class="chip-value">${escapeHtml(formatTokens(sumField(rows, "output_tokens")))}</span>
    </div>
    <div class="usage-summary-chip">
      <span class="chip-label">Reasoning</span>
      <span class="chip-value">${escapeHtml(formatTokens(sumField(rows, "reasoning_tokens")))}</span>
    </div>
    <div class="usage-summary-chip">
      <span class="chip-label">Cache 读 / 写</span>
      <span class="chip-value">${escapeHtml(formatTokens(sumField(rows, "cached_input_tokens")))} / ${escapeHtml(formatTokens(sumField(rows, "cache_write_input_tokens")))}</span>
    </div>
  `;

  const noteEl = document.getElementById("usage-detail-note");

  if (rows.length === 0) {
    bodyEl.innerHTML = `
      <div class="usage-detail-empty">
        尚无 Token 消耗数据。<br />
        <span style="font-size:12px;">运行任务后，CLI 上报的 usage 会自动汇总到这里。</span>
      </div>`;
    if (noteEl) {
      noteEl.hidden = true;
      noteEl.textContent = "";
    }
    return;
  }

  const tableRows = rows
    .map((b) => {
      const modelLabel = b.model === "unknown" ? "—" : b.model;
      const costCell =
        b.cost != null
          ? `${formatCost(b.cost)}${b.estimated ? `<span class="usage-est-tag">估算</span>` : ""}`
          : "—";
      return `
        <tr>
          <td>
            <div class="usage-model-cell">
              <span class="usage-model-name">${escapeHtml(modelLabel)}</span>
              <span class="usage-model-meta">${escapeHtml(b.engine)}${b.provider && b.provider !== b.engine ? ` · ${escapeHtml(b.provider)}` : ""}</span>
            </div>
          </td>
          <td class="num">${b.runs}</td>
          <td class="num">${escapeHtml(formatTokens(b.input_tokens))}</td>
          <td class="num">${escapeHtml(formatTokens(b.cached_input_tokens))}</td>
          <td class="num">${escapeHtml(formatTokens(b.cache_write_input_tokens))}</td>
          <td class="num">${escapeHtml(formatTokens(b.output_tokens))}</td>
          <td class="num">${escapeHtml(formatTokens(b.reasoning_tokens))}</td>
          <td class="num" style="font-weight:700; color:var(--accent-purple);">${escapeHtml(formatTokens(b.total_tokens))}</td>
          <td class="num">${costCell}</td>
        </tr>`;
    })
    .join("");

  const footerCost =
    stats.tokens_cost != null
      ? `${formatCost(stats.tokens_cost)}${anyEstimated ? `<span class="usage-est-tag">含估算</span>` : ""}`
      : "—";

  bodyEl.innerHTML = `
    <table class="usage-detail-table">
      <thead>
        <tr>
          <th>模型</th>
          <th class="num">次数</th>
          <th class="num">Input</th>
          <th class="num">Cache 读</th>
          <th class="num">Cache 写</th>
          <th class="num">Output</th>
          <th class="num">Reasoning</th>
          <th class="num">合计</th>
          <th class="num">费用</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
      <tfoot>
        <tr>
          <td>合计</td>
          <td class="num">${totalRuns}</td>
          <td class="num">${escapeHtml(formatTokens(sumField(rows, "input_tokens")))}</td>
          <td class="num">${escapeHtml(formatTokens(sumField(rows, "cached_input_tokens")))}</td>
          <td class="num">${escapeHtml(formatTokens(sumField(rows, "cache_write_input_tokens")))}</td>
          <td class="num">${escapeHtml(formatTokens(sumField(rows, "output_tokens")))}</td>
          <td class="num">${escapeHtml(formatTokens(sumField(rows, "reasoning_tokens")))}</td>
          <td class="num" style="color:var(--accent-purple);">${escapeHtml(formatTokens(stats.tokens_total))}</td>
          <td class="num">${footerCost}</td>
        </tr>
      </tfoot>
    </table>`;

  if (noteEl) {
    noteEl.hidden = false;
    noteEl.textContent = anyEstimated
      ? "费用：OpenCode 等引擎上报真实 cost；Codex / Cursor 等仅有 token 时按内置单价启发式估算，仅供参考，非账单。"
      : "费用来自 CLI 上报的 cost 汇总。";
  }
}

async function openTokenUsageDetail(): Promise<void> {
  let stats = lastOverviewStats;
  if (!stats) {
    try {
      stats = await getOverviewStats();
      lastOverviewStats = stats;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`加载消耗详情失败: ${msg}`);
      return;
    }
  }
  renderUsageDetail(stats);
  openUsageDetailModal();
}

function renderStats(stats: OverviewStats): void {
  lastOverviewStats = stats;
  const set = (id: string, text: string, color?: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    if (color) (el as HTMLElement).style.color = color;
  };

  set("overview-stat-agents", String(stats.agent_count));
  const healthyEl = document.getElementById("overview-stat-agents-sub");
  if (healthyEl) {
    const pct = Math.round(stats.agents_healthy_pct);
    const color =
      pct >= 90
        ? "var(--accent-emerald)"
        : pct >= 50
          ? "var(--accent-amber)"
          : "#dc2626";
    healthyEl.innerHTML = `<span class="status-dot" style="background:${color};"></span> ${pct}% 连通健康`;
  }

  const runningColor =
    stats.running_tasks > 0 ? "var(--accent-amber)" : "var(--fg-primary)";
  set("overview-stat-running", String(stats.running_tasks), runningColor);
  set(
    "overview-stat-running-sub",
    stats.running_tasks > 0 ? "queued / running" : "当前无运行任务",
  );

  set("overview-stat-completed", String(stats.completed_today));
  const rate = Math.round(stats.success_rate_today * 10) / 10;
  set(
    "overview-stat-completed-sub",
    `成功率 ${rate}%`,
    "var(--accent-emerald)",
  );

  set("overview-stat-tokens", formatTokens(stats.tokens_total));
  const tokensSub = document.getElementById("overview-stat-tokens-sub");
  if (tokensSub) {
    if (stats.tokens_total === 0 || stats.usage_breakdown.length === 0) {
      tokensSub.innerHTML = `<span style="color:var(--fg-muted);">尚无消耗数据 — 运行任务后自动统计</span>`;
    } else {
      const anyEstimated = stats.usage_breakdown.some((b) => b.estimated);
      const costText =
        stats.tokens_cost != null
          ? ` · ${formatCost(stats.tokens_cost)}${anyEstimated ? "（估算）" : ""}`
          : "";
      const totalLine = `${formatTokens(stats.tokens_total)} tok${costText}`;
      const rows = stats.usage_breakdown
        .slice(0, 3)
        .map((b) => {
          const costPart =
            b.cost != null
              ? ` · ${formatCost(b.cost)}${b.estimated ? "（估算）" : ""}`
              : "";
          const label =
            b.model === "unknown" ? b.engine : shortModel(b.model);
          return `<div>${escapeHtml(label)} ${formatTokens(b.total_tokens)}${escapeHtml(costPart)}</div>`;
        })
        .join("");
      const more =
        stats.usage_breakdown.length > 3
          ? `<div style="color:var(--fg-muted);">+${stats.usage_breakdown.length - 3} 更多模型… 点击查看</div>`
          : `<div style="color:var(--fg-muted); font-size:10px; margin-top:2px;">点击查看明细</div>`;
      const estimateNote = anyEstimated
        ? `<div style="color:var(--fg-muted); font-size:10px; margin-top:2px;">费用为启发式估算，非账单</div>`
        : "";
      tokensSub.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:2px; line-height:1.5; text-align:left; font-family:var(--font-mono);">
          <div style="color:var(--accent-purple); font-weight:700;">${escapeHtml(totalLine)}</div>
          ${rows}
          ${more}
          ${estimateNote}
        </div>`;
    }
  }
}

function renderRecentAgents(items: RecentAgentUsage[]): void {
  const caption = document.getElementById("overview-recent-caption");
  const body = document.getElementById("overview-recent-body");
  if (!body) return;

  if (items.length === 0) {
    if (caption) caption.textContent = "近 30 天无调用记录";
    body.innerHTML = `
      <div class="recent-agents-empty">
        <div style="color:var(--fg-muted); font-size:13px;">近 30 天还没有 Agent 被调度。</div>
        <div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap;">
          <button class="btn btn-primary btn-sm" data-od-id="overview-recent-empty-dispatch">发起调度</button>
          <button class="btn btn-secondary btn-sm" data-od-id="overview-recent-empty-agents">打开 Agents</button>
        </div>
      </div>`;
    body
      .querySelector("[data-od-id='overview-recent-empty-dispatch']")
      ?.addEventListener("click", () => showView("commander"));
    body
      .querySelector("[data-od-id='overview-recent-empty-agents']")
      ?.addEventListener("click", () => showView("agents"));
    return;
  }

  if (caption) {
    caption.textContent = `Top ${items.length} · 按 7 日调用排序`;
  }

  const max1 = Math.max(...items.map((i) => i.calls_1d), 1);
  const max7 = Math.max(...items.map((i) => i.calls_7d), 1);
  const max30 = Math.max(...items.map((i) => i.calls_30d), 1);

  body.innerHTML = `
    <div class="recent-agents-table-wrap">
      <table class="recent-agents-table">
        <thead>
          <tr>
            <th>Agent</th>
            <th class="num">1 日</th>
            <th class="num">7 日</th>
            <th class="num">30 日</th>
            <th class="muted">最近调用</th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map((item) => {
              const badge = statusBadgeClass(item.status);
              const label = statusLabel(item.status);
              return `
            <tr class="recent-agent-row" data-agent-id="${escapeHtml(item.agent_id)}" tabindex="0" role="button">
              <td>
                <div class="recent-agent-identity">
                  <div class="agent-avatar-badge">${escapeHtml(initials(item.name))}</div>
                  <div class="recent-agent-meta">
                    <div class="recent-agent-name">${escapeHtml(truncate(item.name, 28))}</div>
                    <div class="recent-agent-sub">
                      <span class="agent-status-badge ${badge}" style="padding:1px 7px; font-size:10px;">
                        <span class="status-dot" style="width:5px;height:5px;"></span>${escapeHtml(label)}
                      </span>
                      <span class="skill-tag" style="margin:0;">${escapeHtml(item.default_cli || "—")}</span>
                    </div>
                  </div>
                </div>
              </td>
              <td class="num">
                <div class="call-stat">
                  <span class="call-count">${item.calls_1d}</span>
                  <div class="call-bar"><div class="call-bar-fill call-bar-1d" style="width:${callBarWidth(item.calls_1d, max1)}%"></div></div>
                </div>
              </td>
              <td class="num">
                <div class="call-stat">
                  <span class="call-count">${item.calls_7d}</span>
                  <div class="call-bar"><div class="call-bar-fill call-bar-7d" style="width:${callBarWidth(item.calls_7d, max7)}%"></div></div>
                </div>
              </td>
              <td class="num">
                <div class="call-stat">
                  <span class="call-count">${item.calls_30d}</span>
                  <div class="call-bar"><div class="call-bar-fill call-bar-30d" style="width:${callBarWidth(item.calls_30d, max30)}%"></div></div>
                </div>
              </td>
              <td class="muted" style="font-family:var(--font-mono); font-size:11.5px;">${escapeHtml(formatRelative(item.last_used_at))}</td>
            </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>`;

  const openAgent = (el: Element) => {
    const id = el.getAttribute("data-agent-id");
    if (id) void selectAgentById(id);
  };

  body.querySelectorAll(".recent-agent-row").forEach((row) => {
    row.addEventListener("click", () => openAgent(row));
    row.addEventListener("keydown", (ev) => {
      const e = ev as KeyboardEvent;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openAgent(row);
      }
    });
  });
}

function renderQueue(items: QueueItem[]): void {
  const tbody = document.getElementById("overview-queue-body");
  if (!tbody) return;

  if (items.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="padding:20px 10px; color:var(--fg-muted); text-align:center;">
          当前没有运行中的任务。
          <button class="btn btn-secondary btn-sm" style="margin-left:8px;" data-od-id="overview-queue-empty-cta">发起调度</button>
        </td>
      </tr>`;
    tbody
      .querySelector("[data-od-id='overview-queue-empty-cta']")
      ?.addEventListener("click", () => showView("commander"));
    return;
  }

  tbody.innerHTML = items
    .map((item) => {
      const pct = Math.round((item.progress || 0) * 100);
      const agents = item.agent_names.length
        ? item.agent_names
            .map((n) => `<span class="skill-tag">${escapeHtml(n)}</span>`)
            .join(" ")
        : `<span style="color:var(--fg-muted);">—</span>`;
      const engines = item.cli_engines.length
        ? escapeHtml(item.cli_engines.join(", "))
        : "—";
      const shortId = item.run_id.slice(0, 8);
      return `
        <tr style="border-bottom:1px solid var(--border-color); cursor:pointer;" data-run-id="${escapeHtml(item.run_id)}">
          <td style="padding:10px;">
            <div style="font-weight:600; color:var(--fg-primary);">#${escapeHtml(shortId)} ${escapeHtml(truncate(item.goal_prompt, 48))}</div>
            <div style="font-size:11px; color:var(--fg-muted);">拆解 ${item.node_count} 个子任务 · ${escapeHtml(item.status)}</div>
          </td>
          <td style="padding:10px;">${agents}</td>
          <td style="padding:10px; font-family:var(--font-mono); font-size:11px; color:var(--accent-primary);">${engines}</td>
          <td style="padding:10px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <div style="flex:1; background:var(--bg-subtle); height:5px; border-radius:3px; overflow:hidden;">
                <div style="width:${pct}%; background:var(--accent-amber); height:100%;"></div>
              </div>
              <span style="font-size:11px; color:var(--accent-amber); font-family:var(--font-mono);">${pct}%</span>
            </div>
          </td>
          <td style="padding:10px; color:var(--fg-muted); font-family:var(--font-mono);">${escapeHtml(item.elapsed_label)}</td>
        </tr>`;
    })
    .join("");

  tbody.querySelectorAll("tr[data-run-id]").forEach((row) => {
    row.addEventListener("click", () => {
      const runId = (row as HTMLElement).dataset.runId;
      if (runId) void openTaskRun(runId);
      else showView("tasks");
    });
  });
}

function runStatusShort(status: string): string {
  if (status === "success") return "成功";
  if (status === "failed") return "失败";
  if (status === "cancelled") return "取消";
  if (status === "running" || status === "queued") return "进行中";
  return status;
}

function renderAutomationPulse(
  deliveries: TaskRun[],
  schedules: Schedule[],
  templates: Template[],
): void {
  const cap = document.getElementById("overview-automation-caption");
  const delEl = document.getElementById("overview-recent-deliveries");
  const schEl = document.getElementById("overview-upcoming-schedules");
  const tplEl = document.getElementById("overview-recent-templates");
  if (!delEl || !schEl || !tplEl) return;

  const paused = schedules.filter(
    (s) =>
      !s.enabled &&
      (s.last_error ||
        (typeof (s as Schedule & { consecutive_failures?: number })
          .consecutive_failures === "number" &&
          ((s as Schedule & { consecutive_failures?: number })
            .consecutive_failures ?? 0) >= 3)),
  );
  if (cap) {
    cap.textContent =
      paused.length > 0
        ? `${paused.length} 个定时已暂停`
        : `交付 ${deliveries.length} · 定时 ${schedules.filter((s) => s.enabled).length} · 模版 ${templates.length}`;
  }

  const terminal = deliveries.filter((r) =>
    ["success", "failed", "cancelled"].includes(r.status),
  );
  if (terminal.length === 0) {
    delEl.innerHTML = `<div class="overview-automation-empty">暂无交付记录<br/><button type="button" class="btn btn-secondary btn-sm" data-ov-go="commander">发起调度</button></div>`;
  } else {
    delEl.innerHTML = terminal
      .slice(0, 5)
      .map((r) => {
        const title = truncate((r.goal_prompt || "").trim() || r.id, 36);
        return `<button type="button" class="overview-automation-row" data-ov-run="${escapeHtml(r.id)}">
          <span class="overview-automation-row-title">${escapeHtml(title)}</span>
          <span class="overview-automation-row-meta">${escapeHtml(runStatusShort(r.status))} · ${escapeHtml(formatRelative(r.finished_at || r.started_at))}</span>
        </button>`;
      })
      .join("");
  }

  const upcoming = [...schedules]
    .filter((s) => s.enabled)
    .sort((a, b) => a.next_run_at.localeCompare(b.next_run_at))
    .slice(0, 5);
  if (upcoming.length === 0) {
    const errNote =
      paused.length > 0
        ? `<div class="overview-automation-empty warn">${paused.length} 个定时因失败已暂停</div>`
        : "";
    schEl.innerHTML = `${errNote}<div class="overview-automation-empty">暂无即将运行的定时<br/><button type="button" class="btn btn-secondary btn-sm" data-ov-go="schedules">打开定时</button></div>`;
  } else {
    schEl.innerHTML =
      (paused.length > 0
        ? `<div class="overview-automation-banner">${paused.length} 个定时已暂停 · 见定时任务页</div>`
        : "") +
      upcoming
        .map(
          (s) => `<button type="button" class="overview-automation-row" data-ov-go="schedules">
          <span class="overview-automation-row-title">${escapeHtml(s.name)}</span>
          <span class="overview-automation-row-meta">下次 ${escapeHtml(formatRelative(s.next_run_at))}${s.last_error ? " · ⚠" : ""}</span>
        </button>`,
        )
        .join("");
  }

  const recentTpl = [...templates]
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
    .slice(0, 5);
  if (recentTpl.length === 0) {
    tplEl.innerHTML = `<div class="overview-automation-empty">暂无模版<br/><button type="button" class="btn btn-secondary btn-sm" data-ov-go="templates">打开模版库</button></div>`;
  } else {
    tplEl.innerHTML = recentTpl
      .map(
        (t) => `<button type="button" class="overview-automation-row" data-ov-go="templates">
        <span class="overview-automation-row-title">${escapeHtml(t.name)}</span>
        <span class="overview-automation-row-meta">${escapeHtml(formatRelative(t.updated_at))}</span>
      </button>`,
      )
      .join("");
  }

  const root = document.getElementById("overview-automation-pulse");
  root?.querySelectorAll("[data-ov-run]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = (el as HTMLElement).getAttribute("data-ov-run");
      if (id) void openTaskRun(id);
    });
  });
  root?.querySelectorAll("[data-ov-go]").forEach((el) => {
    el.addEventListener("click", () => {
      const v = (el as HTMLElement).getAttribute("data-ov-go");
      if (v) showView(v as "commander" | "schedules" | "templates" | "tasks");
    });
  });
}

export async function refreshOverview(): Promise<void> {
  try {
    const [stats, recent, queue, runs, schedules, templates] =
      await Promise.all([
        getOverviewStats(),
        listRecentAgents(),
        listRunningQueue(),
        listTaskRuns(30).catch(() => [] as TaskRun[]),
        listSchedules().catch(() => [] as Schedule[]),
        listTemplates().catch(() => [] as Template[]),
      ]);
    renderStats(stats);
    renderRecentAgents(recent);
    renderQueue(queue);
    renderAutomationPulse(runs, schedules, templates);
    updateNavCounts(stats.agent_count, stats.running_tasks);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    showToast(`总览加载失败: ${msg}`);
  }
}

export function initOverview(): void {
  const tokensCard = document.getElementById("overview-stat-tokens-card");
  if (tokensCard) {
    tokensCard.addEventListener("click", () => {
      void openTokenUsageDetail();
    });
    tokensCard.addEventListener("keydown", (ev) => {
      const e = ev as KeyboardEvent;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        void openTokenUsageDetail();
      }
    });
  }
  void refreshOverview();
}
