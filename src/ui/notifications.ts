import { listen } from "@tauri-apps/api/event";
import { retryRun } from "../lib/api/tasks";
import { runScheduleNow } from "../lib/api/schedules";
import { openTaskRun } from "./tasks/center";
import { showView } from "./router";
import { showActionToast } from "./toast";

type TaskNotificationEvent = {
  kind: "run_failed" | "schedule_failed" | string;
  title: string;
  message: string;
  run_id: string | null;
  schedule_id: string | null;
  can_retry: boolean;
};

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function initNotifications(): void {
  if (!isTauri()) return;
  void listen<TaskNotificationEvent>("task-notification", (event) => {
    const payload = event.payload;
    const message = `${payload.title}: ${payload.message}`;
    if (payload.kind === "run_failed" && payload.run_id) {
      const runId = payload.run_id;
      showActionToast(message, [
        { label: "查看结果", onClick: () => openTaskRun(runId) },
        {
          label: "重试",
          onClick: async () => {
            await retryRun(runId);
            await openTaskRun(runId);
          },
        },
      ]);
      return;
    }
    if (payload.kind === "schedule_failed" && payload.schedule_id) {
      const scheduleId = payload.schedule_id;
      showActionToast(message, [
        { label: "查看任务", onClick: () => showView("schedules") },
        {
          label: "重试",
          onClick: async () => {
            const result = await runScheduleNow(scheduleId);
            await openTaskRun(result.run_id);
          },
        },
      ]);
    }
  });
}
