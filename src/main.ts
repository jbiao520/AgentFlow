import shellHtml from "./ui/app-shell.html?raw";
import { initDetailConfig } from "./ui/agents/detail-config";
import { initDetailSkills } from "./ui/agents/detail-skills";
import { initAgentMatrix } from "./ui/agents/matrix";
import { initAppInfo } from "./ui/app-info";
import { initDemoActions } from "./ui/demo-actions";
import { bindModals } from "./ui/modals";
import { bindNav } from "./ui/nav";

function mountApp(): void {
  const root = document.getElementById("app");
  if (!root) {
    throw new Error("#app root missing");
  }
  root.innerHTML = shellHtml;
  bindNav();
  bindModals();
  initDemoActions();
  initAgentMatrix();
  initDetailSkills();
  initDetailConfig();
  void initAppInfo();
}

window.addEventListener("DOMContentLoaded", () => {
  mountApp();
});
