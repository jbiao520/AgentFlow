/**
 * Settings → About: app version, DB path, reveal in Finder.
 */
import { dbHealth, getAppInfo, revealInFinder } from "../../lib/tauri";
import { showToast } from "../toast";

function setText(id: string, value: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

export async function refreshSettingsAbout(): Promise<void> {
  try {
    const info = await getAppInfo();
    setText("settings-about-name", info.name || "AgentMind");
    setText("settings-about-version", info.version || "—");
    setText("settings-about-tauri", info.tauri_version || "—");
  } catch (err) {
    console.warn("refreshSettingsAbout app_info failed", err);
    setText("settings-about-name", "AgentMind");
    setText("settings-about-version", "—");
    setText("settings-about-tauri", "—");
  }

  const revealBtn = document.getElementById(
    "btn-reveal-db-path",
  ) as HTMLButtonElement | null;
  try {
    const health = await dbHealth();
    setText("settings-about-db-path", health.path || "—");
    const badge = document.getElementById("settings-about-db-ok");
    if (badge) {
      badge.textContent = health.ok ? "正常" : "异常";
      badge.className = health.ok
        ? "settings-db-badge ok"
        : "settings-db-badge bad";
    }
    if (revealBtn) {
      const canReveal =
        !!health.path &&
        health.path !== "(browser)" &&
        !health.path.startsWith("(");
      revealBtn.disabled = !canReveal;
      revealBtn.dataset.path = canReveal ? health.path : "";
    }
  } catch (err) {
    console.warn("refreshSettingsAbout db_health failed", err);
    setText("settings-about-db-path", "无法读取");
    const badge = document.getElementById("settings-about-db-ok");
    if (badge) {
      badge.textContent = "未知";
      badge.className = "settings-db-badge";
    }
    if (revealBtn) {
      revealBtn.disabled = true;
      revealBtn.dataset.path = "";
    }
  }
}

export function initSettingsAbout(): void {
  document
    .getElementById("btn-reveal-db-path")
    ?.addEventListener("click", async () => {
      const btn = document.getElementById(
        "btn-reveal-db-path",
      ) as HTMLButtonElement | null;
      const path = btn?.dataset.path?.trim();
      if (!path) {
        showToast("没有可打开的数据库路径");
        return;
      }
      try {
        await revealInFinder(path);
        showToast("已在 Finder 中显示");
      } catch (e) {
        showToast(
          `打开失败: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    });
}
