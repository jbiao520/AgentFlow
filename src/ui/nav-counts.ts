/**
 * Shared sidebar nav count updates.
 */
export function updateNavCounts(agentCount: number, runningTasks: number): void {
  const overview = document.getElementById("nav-count-overview");
  const agents = document.getElementById("nav-count-agents");
  const tasks = document.getElementById("nav-count-tasks");
  if (overview) overview.textContent = String(agentCount);
  if (agents) agents.textContent = String(agentCount);
  if (tasks) tasks.textContent = `${runningTasks} 运行`;
}

export function updateTemplateNavCount(count: number): void {
  const el = document.getElementById("nav-count-templates");
  if (el) el.textContent = String(count);
}

export function updateScheduleNavCount(count: number): void {
  const el = document.getElementById("nav-count-schedules");
  if (el) el.textContent = String(count);
}
