import "highlight.js/styles/github-dark.min.css";
import "tom-select/dist/css/tom-select.css";
import shellHtml from "./ui/app-shell.html?raw";
import { initDetailConfig } from "./ui/agents/detail-config";
import { initDetailSkills } from "./ui/agents/detail-skills";
import { initAgentMatrix } from "./ui/agents/matrix";
import { initSandbox } from "./ui/agents/sandbox";
import { initAppInfo } from "./ui/app-info";
import { initDemoActions } from "./ui/demo-actions";
import { bindCliSegments, enhanceSelectsIn } from "./ui/form";
import { bindModals } from "./ui/modals";
import { bindNav } from "./ui/nav";
import { initOrchestratorWorkbench } from "./ui/orchestrator/workbench";
import { initOverview } from "./ui/overview/page";
import { initAgentDetailNav } from "./ui/router";
import { initSchedules } from "./ui/schedules/page";
import { initNotifications } from "./ui/notifications";
import { initSettings } from "./ui/settings/page";
import { initTaskCenter } from "./ui/tasks/center";
import { initTemplateLibrary } from "./ui/templates/page";
import { initSaveTemplateWizard } from "./ui/templates/save-wizard";
import { initI18n } from "./ui/i18n";
import { initSplitResize } from "./ui/split-resize";

function mountApp(): void {
  const root = document.getElementById("app");
  if (!root) {
    throw new Error("#app root missing");
  }
  root.innerHTML = shellHtml;
  initI18n();
  // Upgrade static <select class="form-select"> controls (filters, settings, modals).
  enhanceSelectsIn(root);
  bindCliSegments(root);
  bindNav();
  bindModals();
  initDemoActions();
  initAgentDetailNav();
  initOverview();
  initAgentMatrix();
  initDetailSkills();
  initDetailConfig();
  initSandbox();
  initSettings();
  initOrchestratorWorkbench();
  initTaskCenter();
  initTemplateLibrary();
  initSaveTemplateWizard();
  initSchedules();
  initNotifications();
  initSplitResize();
  void initAppInfo();
}

window.addEventListener("DOMContentLoaded", () => {
  mountApp();
});
