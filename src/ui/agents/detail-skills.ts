import type { Skill } from "../../lib/api/agents";
import {
  listSkills,
  readSkillContent,
  setSkillEnabled,
  syncAgentSkills,
} from "../../lib/api/agents";
import { getSelectedAgentId } from "./state";
import { openSkillDetailModal } from "../modals";
import { formatActionableError, showToast } from "../toast";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function skillFileName(relativePath: string): string {
  const parts = relativePath.split("/");
  return parts[parts.length - 1] || relativePath;
}

function renderSkillRow(skill: Skill): string {
  const desc = skill.description || "（无描述）";
  const checked = skill.enabled ? "checked" : "";
  return `
    <div class="skill-item-row" data-skill-id="${escapeHtml(skill.id)}" data-skill-path="${escapeHtml(skill.relative_path)}">
      <div class="skill-info">
        <div class="skill-title">
          <span>${escapeHtml(skillFileName(skill.relative_path))}</span>
          <span style="font-size:10px; color:var(--accent-primary); background:rgba(37,99,235,0.08); padding:1px 5px; border-radius:3px;">点击预览</span>
        </div>
        <div class="skill-desc">${escapeHtml(desc)}</div>
      </div>
      <label class="switch" data-skill-toggle="${escapeHtml(skill.id)}">
        <input type="checkbox" ${checked} data-skill-enabled="${escapeHtml(skill.id)}" />
        <span class="slider"></span>
      </label>
    </div>
  `;
}

function skillListContainer(): HTMLElement | null {
  return document.getElementById("agent-skill-list");
}

async function previewSkill(agentId: string, skill: Skill): Promise<void> {
  const filename = skillFileName(skill.relative_path);
  const desc = skill.description || "";
  openSkillDetailModal(filename, desc);
  const body = document.getElementById("skill-modal-body");
  if (body) body.textContent = "加载中…";
  try {
    const content = await readSkillContent(agentId, skill.relative_path);
    if (body) body.textContent = content;
  } catch (e) {
    if (body) {
      body.textContent = `读取失败: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
}

function bindSkillRows(agentId: string, skills: Skill[]): void {
  const list = skillListContainer();
  if (!list) return;

  list.querySelectorAll(".skill-item-row").forEach((row) => {
    const el = row as HTMLElement;
    const path = el.getAttribute("data-skill-path") || "";
    const skill = skills.find((s) => s.relative_path === path);
    if (!skill) return;

    el.addEventListener("click", () => {
      void previewSkill(agentId, skill);
    });

    const toggle = el.querySelector(
      `input[data-skill-enabled="${skill.id}"]`,
    ) as HTMLInputElement | null;
    const toggleWrap = el.querySelector(
      `[data-skill-toggle="${skill.id}"]`,
    ) as HTMLElement | null;
    toggleWrap?.addEventListener("click", (e) => e.stopPropagation());
    toggle?.addEventListener("change", async () => {
      try {
        await setSkillEnabled(skill.id, toggle.checked);
        showToast(
          toggle.checked
            ? `已启用 ${skillFileName(skill.relative_path)}`
            : `已禁用 ${skillFileName(skill.relative_path)}`,
        );
      } catch (err) {
        toggle.checked = !toggle.checked;
        showToast(
          `更新 Skill 失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
  });
}

export async function refreshAgentSkills(agentId?: string | null): Promise<void> {
  const id = agentId ?? getSelectedAgentId();
  const list = skillListContainer();
  if (!list) return;
  if (!id) {
    list.innerHTML =
      '<div style="font-size:12px; color:var(--fg-muted); padding:8px 0;">请先从 Agents 选择一个 Agent。</div>';
    return;
  }

  try {
    const skills = await listSkills(id);
    if (skills.length === 0) {
      list.innerHTML = `
        <div style="font-size:12px; color:var(--fg-muted); padding:12px 0; text-align:center;">
          <div style="font-weight:600; color:var(--fg-primary); margin-bottom:6px;">暂无 Skill</div>
          <div style="margin-bottom:10px;">在 Workspace 的 <code>.agent/skills/</code> 放置 Markdown，然后同步。</div>
          <button type="button" class="btn btn-secondary btn-sm" id="skills-empty-sync-cta">同步 Workspace Skill</button>
        </div>`;
      list
        .querySelector("#skills-empty-sync-cta")
        ?.addEventListener("click", () => {
          void syncSelectedAgentSkills();
        });
      return;
    }
    list.innerHTML = skills.map(renderSkillRow).join("\n");
    bindSkillRows(id, skills);
  } catch (e) {
    list.innerHTML = `<div style="font-size:12px; color:#b91c1c; padding:8px 0;">加载 Skill 失败: ${escapeHtml(
      e instanceof Error ? e.message : String(e),
    )}</div>`;
  }
}

export async function syncSelectedAgentSkills(): Promise<void> {
  const id = getSelectedAgentId();
  if (!id) {
    showToast("请先选择一个 Agent");
    return;
  }
  try {
    const result = await syncAgentSkills(id);
    await refreshAgentSkills(id);
    showToast(
      `Skill 同步完成：+${result.added} / ~${result.updated} / -${result.removed}`,
    );
  } catch (e) {
    showToast(
      `同步失败: ${formatActionableError(e instanceof Error ? e.message : String(e))}`,
      { kind: "error" },
    );
  }
}

export function initDetailSkills(): void {
  document
    .getElementById("btn-sync-skills")
    ?.addEventListener("click", () => {
      void syncSelectedAgentSkills();
    });
}
