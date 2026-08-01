/**
 * Execution template IPC wrappers.
 */
import { invoke } from "@tauri-apps/api/core";
import type { OrchestrateResult } from "./orchestrate";
import type { TaskNode, TaskRun } from "./tasks";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export type TemplateVariable = {
  key: string;
  label: string;
  required: boolean;
  default?: string | null;
};

export type Template = {
  id: string;
  name: string;
  description: string | null;
  source_goal_id: string | null;
  source_plan_id: string | null;
  source_run_id: string | null;
  goal_prompt: string;
  plan_json: string;
  variables_json: string;
  created_at: string;
  updated_at: string;
};

export type PolishResult = {
  ok: boolean;
  name: string | null;
  description: string | null;
  goal_prompt: string | null;
  plan_json: string | null;
  variables: TemplateVariable[];
  raw_output: string | null;
  error: string | null;
};

export type PolishTemplateResult = {
  polish: PolishResult;
  source_goal_id: string | null;
  source_plan_id: string | null;
  source_run_id: string | null;
};

export type DispatchResult = {
  run: TaskRun;
  nodes: TaskNode[];
};

export type StartRunResult = {
  run_id: string;
  started: boolean;
};

export type InstantiateTemplateResult = {
  orchestrate: OrchestrateResult;
  dispatch: DispatchResult | null;
  started: StartRunResult | null;
};

export async function listTemplates(): Promise<Template[]> {
  if (!isTauri()) return [];
  return invoke<Template[]>("list_templates");
}

export async function getTemplate(id: string): Promise<Template | null> {
  if (!isTauri()) return null;
  return invoke<Template | null>("get_template", { id });
}

export async function polishTemplate(args: {
  goalId?: string | null;
  planId?: string | null;
  runId?: string | null;
  goalPrompt?: string | null;
  planJson?: string | null;
  skipAi?: boolean;
}): Promise<PolishTemplateResult> {
  if (!isTauri()) {
    throw new Error("polishTemplate requires Tauri runtime");
  }
  return invoke<PolishTemplateResult>("polish_template", {
    args: {
      goal_id: args.goalId ?? null,
      plan_id: args.planId ?? null,
      run_id: args.runId ?? null,
      goal_prompt: args.goalPrompt ?? null,
      plan_json: args.planJson ?? null,
      skip_ai: args.skipAi ?? false,
    },
  });
}

export async function createTemplate(args: {
  name: string;
  description?: string | null;
  sourceGoalId?: string | null;
  sourcePlanId?: string | null;
  sourceRunId?: string | null;
  goalPrompt: string;
  planJson: string;
  variablesJson?: string | null;
}): Promise<Template> {
  if (!isTauri()) {
    throw new Error("createTemplate requires Tauri runtime");
  }
  return invoke<Template>("create_template", {
    args: {
      name: args.name,
      description: args.description ?? null,
      source_goal_id: args.sourceGoalId ?? null,
      source_plan_id: args.sourcePlanId ?? null,
      source_run_id: args.sourceRunId ?? null,
      goal_prompt: args.goalPrompt,
      plan_json: args.planJson,
      variables_json: args.variablesJson ?? "[]",
    },
  });
}

export async function updateTemplate(args: {
  id: string;
  name?: string | null;
  description?: string | null;
  goalPrompt?: string | null;
  planJson?: string | null;
  variablesJson?: string | null;
}): Promise<Template> {
  if (!isTauri()) {
    throw new Error("updateTemplate requires Tauri runtime");
  }
  return invoke<Template>("update_template", {
    args: {
      id: args.id,
      name: args.name ?? null,
      description: args.description ?? null,
      goal_prompt: args.goalPrompt ?? null,
      plan_json: args.planJson ?? null,
      variables_json: args.variablesJson ?? null,
    },
  });
}

export async function deleteTemplate(id: string): Promise<void> {
  if (!isTauri()) {
    throw new Error("deleteTemplate requires Tauri runtime");
  }
  await invoke("delete_template", { id });
}

export async function duplicateTemplate(id: string): Promise<Template> {
  if (!isTauri()) {
    throw new Error("duplicateTemplate requires Tauri runtime");
  }
  return invoke<Template>("duplicate_template", { id });
}

export async function instantiateTemplate(args: {
  templateId: string;
  values: Record<string, string>;
  dispatch: boolean;
  concurrency?: number | null;
}): Promise<InstantiateTemplateResult> {
  if (!isTauri()) {
    throw new Error("instantiateTemplate requires Tauri runtime");
  }
  return invoke<InstantiateTemplateResult>("instantiate_template", {
    args: {
      template_id: args.templateId,
      values: args.values,
      dispatch: args.dispatch,
      concurrency: args.concurrency ?? null,
    },
  });
}

export function parseTemplateVariables(raw: string): TemplateVariable[] {
  try {
    const v = JSON.parse(raw) as TemplateVariable[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
