/**
 * Orchestrator settings panel on 调度中枢 — independent CLI / model / reasoning.
 */
import {
  getOrchestratorSettings,
  updateOrchestratorSettings,
  type OrchestratorSettings,
} from "../../lib/api/settings";
import { showToast } from "../toast";

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function selectedReasoning(): string {
  const active = document.querySelector(
    "#orch-reasoning-pills .reasoning-pill.active",
  );
  return (active?.getAttribute("data-reasoning") || "medium").toLowerCase();
}

function setReasoningActive(effort: string): void {
  const target = effort.toLowerCase();
  document
    .querySelectorAll("#orch-reasoning-pills .reasoning-pill")
    .forEach((p) => {
      const v = (p.getAttribute("data-reasoning") || "").toLowerCase();
      p.classList.toggle("active", v === target);
    });
}

export function applyOrchSettingsToForm(s: OrchestratorSettings): void {
  const cli = el<HTMLSelectElement>("orch-cli-select");
  if (cli) cli.value = s.cli_engine || "codex";

  const model = el<HTMLSelectElement>("orch-model-select");
  if (model) {
    const preferred = s.model || "sol";
    if (![...model.options].some((o) => o.value === preferred)) {
      const opt = document.createElement("option");
      opt.value = preferred;
      opt.textContent = preferred;
      model.appendChild(opt);
    }
    model.value = preferred;
  }

  setReasoningActive(s.reasoning_effort || "medium");
}

export async function loadOrchestratorSettings(): Promise<void> {
  try {
    const s = await getOrchestratorSettings();
    applyOrchSettingsToForm(s);
  } catch (e) {
    showToast(
      `加载调度配置失败: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export async function saveOrchestratorSettings(): Promise<void> {
  const cli = el<HTMLSelectElement>("orch-cli-select")?.value.trim() || "codex";
  const model = el<HTMLSelectElement>("orch-model-select")?.value.trim() || "sol";
  const reasoning = selectedReasoning();
  try {
    const updated = await updateOrchestratorSettings({
      cli_engine: cli,
      model,
      reasoning_effort: reasoning,
    });
    applyOrchSettingsToForm(updated);
    showToast("调度中枢配置已保存");
  } catch (e) {
    showToast(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function initOrchestratorSettings(): void {
  void loadOrchestratorSettings();

  document
    .getElementById("btn-save-orch-settings")
    ?.addEventListener("click", () => {
      void saveOrchestratorSettings();
    });

  document
    .querySelectorAll("#orch-reasoning-pills .reasoning-pill")
    .forEach((pill) => {
      pill.addEventListener("click", () => {
        document
          .querySelectorAll("#orch-reasoning-pills .reasoning-pill")
          .forEach((p) => p.classList.remove("active"));
        pill.classList.add("active");
      });
    });
}
