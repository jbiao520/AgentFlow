/**
 * Schedule IPC wrappers — timed template runs.
 */
import { invoke } from "@tauri-apps/api/core";
import type { TaskRun } from "./tasks";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export type ScheduleMode = "once" | "interval" | "cron";
export type OverlapPolicy = "allow" | "skip" | "queue";

export type Schedule = {
  id: string;
  name: string;
  template_id: string;
  values_json: string;
  mode: ScheduleMode | string;
  interval_secs: number | null;
  enabled: boolean;
  next_run_at: string;
  last_run_at: string | null;
  last_run_id: string | null;
  last_error: string | null;
  run_count: number;
  created_at: string;
  updated_at: string;
  cron_expr: string | null;
  window_start: string | null;
  window_end: string | null;
  overlap_policy: OverlapPolicy | string;
  max_retries: number;
  retry_delay_secs: number;
  retry_attempt: number;
  consecutive_failures?: number;
};

export async function listSchedules(): Promise<Schedule[]> {
  if (!isTauri()) return [];
  return invoke<Schedule[]>("list_schedules");
}

export async function listScheduleRuns(
  scheduleId: string,
  limit = 20,
  offset = 0,
): Promise<TaskRun[]> {
  if (!isTauri()) return [];
  return invoke<TaskRun[]>("list_schedule_runs", {
    scheduleId,
    limit,
    offset,
  });
}

export async function getSchedule(id: string): Promise<Schedule | null> {
  if (!isTauri()) return null;
  return invoke<Schedule | null>("get_schedule", { id });
}

export async function createSchedule(args: {
  name: string;
  templateId: string;
  values: Record<string, string>;
  mode: ScheduleMode;
  intervalSecs?: number | null;
  nextRunAt: string;
  enabled?: boolean;
  cronExpr?: string | null;
  windowStart?: string | null;
  windowEnd?: string | null;
  overlapPolicy?: OverlapPolicy;
  maxRetries?: number;
  retryDelaySecs?: number;
}): Promise<Schedule> {
  if (!isTauri()) throw new Error("createSchedule requires Tauri runtime");
  const mode = args.mode;
  return invoke<Schedule>("create_schedule", {
    args: {
      name: args.name,
      template_id: args.templateId,
      values_json: JSON.stringify(args.values ?? {}),
      mode,
      interval_secs: mode === "interval" ? (args.intervalSecs ?? null) : null,
      next_run_at: args.nextRunAt,
      enabled: args.enabled ?? true,
      cron_expr:
        mode === "cron" && args.cronExpr ? args.cronExpr : null,
      window_start: args.windowStart || null,
      window_end: args.windowEnd || null,
      overlap_policy: args.overlapPolicy ?? "queue",
      max_retries: args.maxRetries ?? 0,
      retry_delay_secs: args.retryDelaySecs ?? 300,
    },
  });
}

export async function updateSchedule(args: {
  id: string;
  name?: string | null;
  templateId?: string | null;
  values?: Record<string, string> | null;
  mode?: ScheduleMode | null;
  intervalSecs?: number | null;
  nextRunAt?: string | null;
  enabled?: boolean | null;
  cronExpr?: string | null;
  windowStart?: string | null;
  windowEnd?: string | null;
  overlapPolicy?: OverlapPolicy | null;
  maxRetries?: number | null;
  retryDelaySecs?: number | null;
}): Promise<Schedule> {
  if (!isTauri()) throw new Error("updateSchedule requires Tauri runtime");
  const mode = args.mode ?? null;
  // Drop fields that do not apply to the selected mode so the UI never shows
  // stale interval/cron data after a mode switch.
  const clearInterval =
    mode === "once" || mode === "cron" || args.intervalSecs == null;
  const clearCron =
    mode === "once" ||
    mode === "interval" ||
    args.cronExpr === "" ||
    args.cronExpr == null;

  return invoke<Schedule>("update_schedule", {
    args: {
      id: args.id,
      name: args.name ?? null,
      template_id: args.templateId ?? null,
      values_json: args.values ? JSON.stringify(args.values) : null,
      mode,
      interval_secs: clearInterval ? null : (args.intervalSecs ?? null),
      clear_interval: clearInterval,
      next_run_at: args.nextRunAt ?? null,
      enabled: args.enabled ?? null,
      cron_expr: clearCron ? null : (args.cronExpr ?? null),
      clear_cron_expr: clearCron,
      window_start: args.windowStart ?? null,
      clear_window_start: args.windowStart === "",
      window_end: args.windowEnd ?? null,
      clear_window_end: args.windowEnd === "",
      overlap_policy: args.overlapPolicy ?? null,
      max_retries: args.maxRetries ?? null,
      retry_delay_secs: args.retryDelaySecs ?? null,
    },
  });
}

export async function deleteSchedule(id: string): Promise<void> {
  if (!isTauri()) {
    throw new Error("deleteSchedule requires Tauri runtime");
  }
  await invoke("delete_schedule", { id });
}

export async function setScheduleEnabled(
  id: string,
  enabled: boolean,
): Promise<Schedule> {
  if (!isTauri()) throw new Error("setScheduleEnabled requires Tauri runtime");
  return invoke<Schedule>("set_schedule_enabled", { id, enabled });
}

export async function runScheduleNow(id: string): Promise<{ run_id: string }> {
  if (!isTauri()) throw new Error("runScheduleNow requires Tauri runtime");
  return invoke<{ run_id: string }>("run_schedule_now", { id });
}

/** Convert datetime-local value (local wall clock) to UTC ISO-8601 Z. */
export function localDatetimeToUtcIso(localValue: string): string {
  if (!localValue) return "";
  const d = new Date(localValue);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Convert UTC ISO to datetime-local input value. */
export function utcIsoToLocalDatetime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Convert a local daily HH:MM value to the UTC value used by the scheduler. */
export function localTimeToUtc(time: string | null | undefined): string {
  if (!time) return "";
  const [hour, minute] = time.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return "";
  const now = new Date();
  now.setHours(hour, minute, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;
}

/** Convert a scheduler UTC HH:MM value to the user's local daily time. */
export function utcTimeToLocal(time: string | null | undefined): string {
  if (!time) return "";
  const [hour, minute] = time.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return "";
  const utc = new Date(Date.UTC(2020, 0, 1, hour, minute, 0, 0));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(utc.getHours())}:${pad(utc.getMinutes())}`;
}

export function parseScheduleValues(raw: string): Record<string, string> {
  try {
    const v = JSON.parse(raw) as Record<string, string>;
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export function formatInterval(secs: number | null | undefined): string {
  if (!secs || secs <= 0) return "—";
  if (secs % 86400 === 0) return `每 ${secs / 86400} 天`;
  if (secs % 3600 === 0) return `每 ${secs / 3600} 小时`;
  if (secs % 60 === 0) return `每 ${secs / 60} 分钟`;
  return `每 ${secs} 秒`;
}
