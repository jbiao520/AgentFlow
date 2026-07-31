import { importAgent } from "../../lib/api/agents";
import { closeImportModal } from "../modals";
import { showToast } from "../toast";
import { refreshAgentMatrix } from "./matrix";

function field<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

export async function submitImportModal(): Promise<void> {
  const name = field<HTMLInputElement>("import-agent-name")?.value.trim() || "";
  const pathOrGit =
    field<HTMLInputElement>("import-agent-path")?.value.trim() || "";
  const cli =
    field<HTMLSelectElement>("import-agent-cli")?.value.trim() || "codex";
  const description =
    field<HTMLInputElement>("import-agent-desc")?.value.trim() || null;

  if (!name) {
    showToast("请填写 Agent 标识名称");
    return;
  }
  if (!pathOrGit) {
    showToast("请填写 Workspace 路径或 Git URL");
    return;
  }

  const submitBtn = document.getElementById("import-agent-submit");
  if (submitBtn) {
    submitBtn.setAttribute("disabled", "true");
  }

  try {
    const result = await importAgent({
      name,
      workspace_path_or_git: pathOrGit,
      default_cli: cli,
      description,
    });
    closeImportModal();
    const nameEl = field<HTMLInputElement>("import-agent-name");
    const pathEl = field<HTMLInputElement>("import-agent-path");
    const descEl = field<HTMLInputElement>("import-agent-desc");
    if (nameEl) nameEl.value = "";
    if (pathEl) pathEl.value = "";
    if (descEl) descEl.value = "";

    await refreshAgentMatrix();
    const how = result.cloned ? "已克隆并注册" : "已绑定本地路径";
    showToast(`${how}: ${result.agent.name}`);
  } catch (e) {
    showToast(`导入失败: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    submitBtn?.removeAttribute("disabled");
  }
}
