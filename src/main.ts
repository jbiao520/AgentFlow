import shellHtml from "./ui/app-shell.html?raw";
import { initPrototypeActions } from "./ui/prototype-actions";

function mountApp() {
  const root = document.getElementById("app");
  if (!root) {
    throw new Error("#app root missing");
  }
  root.innerHTML = shellHtml;
  initPrototypeActions();
}

window.addEventListener("DOMContentLoaded", () => {
  mountApp();
});
