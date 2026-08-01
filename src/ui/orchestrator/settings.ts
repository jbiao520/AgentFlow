/**
 * Orchestrator model settings (CLI / model / reasoning / fast).
 * Mounted under Settings → 模型; models/efforts load from the selected local CLI.
 */
import {
  getOrchestratorSettings,
  updateOrchestratorSettings,
} from "../../lib/api/settings";
import {
  bindModelCatalogPanel,
  isFastChecked,
  selectedEffort,
} from "../cli-models";
import { setSelectValue } from "../form";
import { showToast } from "../toast";

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

let reloadCatalog:
  | ((preferred?: {
      model?: string;
      effort?: string;
      fast?: boolean;
      keepUnavailable?: boolean;
    }) => Promise<void>)
  | null = null;

export async function loadOrchestratorSettings(): Promise<void> {
  try {
    const s = await getOrchestratorSettings();
    const cli = el<HTMLSelectElement>("orch-cli-select");
    if (cli) setSelectValue(cli, s.cli_engine || "codex", true);

    if (reloadCatalog) {
      await reloadCatalog({
        model: s.model || "",
        effort: s.reasoning_effort || "",
        fast: !!s.use_fast,
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
  const use_fast = isFastChecked(el<HTMLInputElement>("orch-fast-toggle"));

  if (!model) {
    showToast("请先选择可用模型");
    return;
  }

  try {
    const updated = await updateOrchestratorSettings({
      cli_engine: cli,
      model,
      reasoning_effort: reasoning,
      use_fast,
    });
    if (reloadCatalog) {
      await reloadCatalog({
        model: updated.model,
        effort: updated.reasoning_effort,
        fast: !!updated.use_fast,
        keepUnavailable: true,
      });
    }
    showToast("模型配置已保存");
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
    fastWrap: el<HTMLElement>("orch-fast-wrap"),
    fastToggle: el<HTMLInputElement>("orch-fast-toggle"),
    getPreferred: () => ({
      model: model.value.trim(),
      effort: selectedEffort(pills),
      fast: isFastChecked(el<HTMLInputElement>("orch-fast-toggle")),
    }),
  });

  void loadOrchestratorSettings();

  document
    .getElementById("btn-save-orch-settings")
    ?.addEventListener("click", () => {
      void saveOrchestratorSettings();
    });
}
