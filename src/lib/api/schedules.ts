/**
 * Schedule IPC wrappers — timed template runs.
 */
import { invoke } from "@tauri-apps/api/core";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export type ScheduleMode = "once" | "interval";

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
};

export async function listSchedules(): Promise<Schedule[]> {
  if (!isTauri()) return [];
  return invoke<Schedule[]>("list_schedules");
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
}): Promise<Schedule> {
  if (!isTauri()) throw new Error("createSchedule requires Tauri runtime");
  return invoke<Schedule>("create_schedule", {
    args: {
      name: args.name,
      template_id: args.templateId,
      values_json: JSON.stringify(args.values ?? {}),
      mode: args.mode,
      interval_secs: args.intervalSecs ?? null,
      next_run_at: args.nextRunAt,
      enabled: args.enabled ?? true,
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
}): Promise<Schedule> {
  if (!isTauri()) throw new Error("updateSchedule requires Tauri runtime");
  return invoke<Schedule>("update_schedule", {
    args: {
      id: args.id,
      name: args.name ?? null,
      template_id: args.templateId ?? null,
      values_json: args.values ? JSON.stringify(args.values) : null,
      mode: args.mode ?? null,
      interval_secs: args.intervalSecs ?? null,
      clear_interval: args.mode === "once",
      next_run_at: args.nextRunAt ?? null,
      enabled: args.enabled ?? null,
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
