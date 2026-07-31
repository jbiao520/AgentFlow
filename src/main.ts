import shellHtml from "./ui/app-shell.html?raw";
import { initDetailConfig } from "./ui/agents/detail-config";
import { initDetailSkills } from "./ui/agents/detail-skills";
import { initAgentMatrix } from "./ui/agents/matrix";
import { initSandbox } from "./ui/agents/sandbox";
import { initAppInfo } from "./ui/app-info";
import { initCliWidget } from "./ui/cli-widget";
import { initDemoActions } from "./ui/demo-actions";
import { bindModals } from "./ui/modals";
import { bindNav } from "./ui/nav";
import { initOrchestratorSettings } from "./ui/orchestrator/settings";
import { initOrchestratorWorkbench } from "./ui/orchestrator/workbench";
import { initOverview } from "./ui/overview/page";
import { initTaskCenter } from "./ui/tasks/center";

function mountApp(): void {
  const root = document.getElementById("app");
  if (!root) {
    throw new Error("#app root missing");
  }
  root.innerHTML = shellHtml;
  bindNav();
  bindModals();
  initDemoActions();
  initOverview();
  initAgentMatrix();
  initDetailSkills();
  initDetailConfig();
  initSandbox();
  initCliWidget();
  initOrchestratorSettings();
  initOrchestratorWorkbench();
  initTaskCenter();
  void initAppInfo();
}

window.addEventListener("DOMContentLoaded", () => {
  mountApp();
});
