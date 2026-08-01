/**
 * Orchestrator settings panel on 调度中枢 — independent CLI / model / reasoning.
 * Models and efforts are loaded live from the selected local CLI.
 */
import {
  getOrchestratorSettings,
  updateOrchestratorSettings,
} from "../../lib/api/settings";
import {
  bindModelCatalogPanel,
  selectedEffort,
} from "../cli-models";
import { showToast } from "../toast";

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

let reloadCatalog:
  | ((preferred?: {
      model?: string;
      effort?: string;
      keepUnavailable?: boolean;
    }) => Promise<void>)
  | null = null;

export async function loadOrchestratorSettings(): Promise<void> {
  try {
    const s = await getOrchestratorSettings();
    const cli = el<HTMLSelectElement>("orch-cli-select");
    if (cli) cli.value = s.cli_engine || "codex";

    if (reloadCatalog) {
      await reloadCatalog({
        model: s.model || "",
        effort: s.reasoning_effort || "",
        keepUnavailable: true,
      });
    }
  } catch (e) {
    showToast(
      `加载调度配置失败: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export async function saveOrchestratorSettings(): Promise<void> {
  const cli = el<HTMLSelectElement>("orch-cli-select")?.value.trim() || "codex";
  const model =
    el<HTMLSelectElement>("orch-model-select")?.value.trim() || "";
  const pills = el<HTMLElement>("orch-reasoning-pills");
  const reasoning = pills ? selectedEffort(pills) : "";

  if (!model) {
    showToast("请先选择可用模型");
    return;
  }

  try {
    const updated = await updateOrchestratorSettings({
      cli_engine: cli,
      model,
      reasoning_effort: reasoning,
    });
    if (reloadCatalog) {
      await reloadCatalog({
        model: updated.model,
        effort: updated.reasoning_effort,
        keepUnavailable: true,
      });
    }
    showToast("调度中枢配置已保存");
  } catch (e) {
    showToast(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function initOrchestratorSettings(): void {
  const cli = el<HTMLSelectElement>("orch-cli-select");
  const model = el<HTMLSelectElement>("orch-model-select");
  const pills = el<HTMLElement>("orch-reasoning-pills");
  if (!cli || !model || !pills) return;

  reloadCatalog = bindModelCatalogPanel({
    cliSelect: cli,
    modelSelect: model,
    pills,
    getPreferred: () => ({
      model: model.value.trim(),
      effort: selectedEffort(pills),
    }),
  });

  void loadOrchestratorSettings();

  document
    .getElementById("btn-save-orch-settings")
    ?.addEventListener("click", () => {
      void saveOrchestratorSettings();
    });
}
