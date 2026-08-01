/**
 * Orchestrate IPC — live CLI or fixture JSON path.
 */
import { invoke } from "@tauri-apps/api/core";
import type { Goal, Plan, TaskNode, TaskRun } from "./tasks";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export type PlanIntent = {
  summary: string;
  tags: string[];
};

export type PlanSubtask = {
  id: string;
  title: string;
  agent: string;
  skills: string[];
  depends_on: string[];
  cli_engine?: string | null;
  model?: string | null;
  reasoning_effort?: string | null;
  prompt?: string | null;
  artifact_paths?: string[];
};

export type PlanQuestion = {
  id: string;
  prompt: string;
  options: string[];
};

export type PlanClarification = {
  question_id: string;
  option: string;
  note?: string | null;
};

export type PlanAnalysis = {
  intent: PlanIntent;
  subtasks: PlanSubtask[];
  questions?: PlanQuestion[];
  clarifications?: PlanClarification[];
};

export type OrchestrateResult = {
  ok: boolean;
  goal: Goal | null;
  plan_row: Plan | null;
  plan: PlanAnalysis | null;
  warnings: string[];
  raw_output: string | null;
  error: string | null;
};

export type ConfirmPlanAnswersResult = {
  plan: PlanAnalysis;
  dispatch: { run: TaskRun; nodes: TaskNode[] };
  started: boolean;
};

export async function orchestrate(
  goal: string,
  templateKey?: string | null,
): Promise<OrchestrateResult> {
  if (!isTauri()) {
    return {
      ok: false,
      goal: null,
      plan_row: null,
      plan: null,
      warnings: [],
      raw_output: null,
      error: "Orchestrate requires Tauri runtime",
    };
  }
  return invoke<OrchestrateResult>("orchestrate", {
    args: { goal, template_key: templateKey ?? null },
  });
}

export async function orchestrateFromJson(
  goal: string,
  planJson: string,
  templateKey?: string | null,
): Promise<OrchestrateResult> {
  if (!isTauri()) {
    return {
      ok: false,
      goal: null,
      plan_row: null,
      plan: null,
      warnings: [],
      raw_output: null,
      error: "Orchestrate requires Tauri runtime",
    };
  }
  return invoke<OrchestrateResult>("orchestrate_from_json", {
    args: {
      goal,
      plan_json: planJson,
      template_key: templateKey ?? null,
    },
  });
}

export async function confirmPlanAnswers(
  planId: string,
  answers: PlanClarification[],
): Promise<ConfirmPlanAnswersResult> {
  if (!isTauri()) {
    throw new Error("confirmPlanAnswers requires Tauri runtime");
  }
  return invoke<ConfirmPlanAnswersResult>("confirm_plan_answers", {
    args: { plan_id: planId, answers },
  });
}
