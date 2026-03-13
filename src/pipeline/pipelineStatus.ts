import { StatusSummary, ChecklistItem as ChecklistItemT } from "../api/client";

export type StepState =
  | "not_started"
  | "queued"
  | "uploading"
  | "ready"
  | "running"
  | "complete"
  | "error";

export type ChipState =
  | "not_started"
  | "ready"
  | "running"
  | "complete"
  | "error"
  | "cached"
  | "na";

const LS_VOLCANO = "bulkmind.volcano.selectedComparisons";
const LS_VOLCANO_ALL = "bulkmind.volcano.isAll";
const LS_HEATMAP = "bulkmind.heatmaps.rows";
const LS_DISEASE = "bulkmind.disease.selected";
const LS_DISEASE_ALT_1 = "bulkmind.aiRanking.diseaseOfInterest";
const LS_DISEASE_ALT_2 = "bulkmind.diseaseOfInterest";

export function normalizeChecklistState(rawIn?: string): ChipState {
  const raw = String(rawIn || "not_started").toLowerCase().trim();

  const stateMap: Record<string, ChipState> = {
    not_started: "not_started",
    "not started": "not_started",
    pending: "not_started",

    queued: "running",
    submitted: "running",
    running: "running",
    in_progress: "running",
    "in progress": "running",
    processing: "running",

    ready: "ready",

    complete: "complete",
    completed: "complete",
    done: "complete",
    success: "complete",
    succeeded: "complete",

    error: "error",
    failed: "error",

    cached: "cached",
    skipped: "cached",
    existing: "cached",

    na: "na",
    "n/a": "na",
    not_applicable: "na",
    "not applicable": "na",
  };

  return stateMap[raw] || "not_started";
}

export function toStepStateFromChecklist(state?: string): StepState {
  const s = normalizeChecklistState(state);
  if (s === "complete") return "complete";
  if (s === "running") return "running";
  if (s === "error") return "error";
  if (s === "ready" || s === "cached") return "ready";
  return "not_started";
}

export function aggregateStepState(
  keys: string[],
  checklistMap: Map<string, string>
): StepState {
  const states = keys.map((k) => toStepStateFromChecklist(checklistMap.get(k)));
  if (states.some((s) => s === "error")) return "error";
  if (states.some((s) => s === "running")) return "running";
  if (states.length > 0 && states.every((s) => s === "complete")) return "complete";
  if (states.some((s) => s === "complete" || s === "ready")) return "ready";
  return "not_started";
}

export function aggregateStates(states: StepState[]): StepState {
  if (states.some((s) => s === "error")) return "error";
  if (states.some((s) => s === "running")) return "running";
  if (states.length > 0 && states.every((s) => s === "complete")) return "complete";
  if (states.some((s) => s === "complete" || s === "ready")) return "ready";
  return "not_started";
}

export function buildChecklistMap(summary: StatusSummary | null): Map<string, string> {
  const items = (summary?.checklist || []) as any[];
  const m = new Map<string, string>();
  for (const it of items) {
    if (it?.key) m.set(String(it.key), String(it.state || "not_started"));
  }
  return m;
}

export function buildServerStepsMap(
  summary: StatusSummary | null
): Map<number, { state: string; micro?: string }> {
  const map = new Map<number, { state: string; micro?: string }>();
  const ssteps = (summary as any)?.steps;

  if (Array.isArray(ssteps)) {
    for (const s of ssteps) {
      const n = Number(s.step);
      if (!Number.isNaN(n)) {
        map.set(n, {
          state: String(s.state || "not_started"),
          micro: s.microtext || s.micro || undefined,
        });
      }
    }
  }

  return map;
}

export function getServerStepState(
  serverStepsMap: Map<number, { state: string; micro?: string }>,
  stepNum: number
): { state: StepState; micro?: string } {
  const entry = serverStepsMap.get(stepNum);
  if (!entry) return { state: "not_started", micro: undefined };

  const s = String(entry.state || "").toLowerCase().trim();

  if (s === "complete") return { state: "complete", micro: entry.micro };
  if (s === "running") return { state: "running", micro: entry.micro };
  if (s === "error" || s === "failed") return { state: "error", micro: entry.micro };
  if (s === "ready" || s === "cached") return { state: "ready", micro: entry.micro };

  return { state: "not_started", micro: entry.micro };
}

export function microOr(a?: string, b?: string): string | undefined {
  return a || b || undefined;
}

function safeGetLS(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function getSavedArray(key: string): string[] {
  try {
    const raw = safeGetLS(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((x) => String(x || "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function getSavedBooleanFlag(key: string): boolean {
  return safeGetLS(key) === "1";
}

function getSavedString(...keys: string[]): string {
  for (const key of keys) {
    const v = String(safeGetLS(key) || "").trim();
    if (v) return v;
  }
  return "";
}

function hasNonEmptyItems(arr: unknown): boolean {
  return (
    Array.isArray(arr) &&
    arr.some((x) => typeof x === "string" && x.trim().length > 0)
  );
}

function hasMeaningfulValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some((v) => hasMeaningfulValue(v));
  return value !== null && value !== undefined;
}

/**
 * Detailed checklist only:
 * - while pipeline is running, do not force NA
 * - when not running, optional unselected outputs become NA
 * - rerun_deseq2 stays NA when not running, per your current UI rule
 */
export function applySelectionAwareOverrides(
  checklist: ChecklistItemT[],
  summary: StatusSummary | null
): ChecklistItemT[] {
  const selections = (summary as any)?.selections || {};
  const isRunning = Boolean((summary as any)?.pipeline?.is_running);

  const wantsVolcanoFromSummary = hasNonEmptyItems(selections?.volcano_comparisons);
  const wantsHeatmapFromSummary = hasNonEmptyItems(selections?.heatmap_pathways);
  const wantsDiseaseFromSummary =
    hasMeaningfulValue(selections?.disease_of_interest) ||
    hasMeaningfulValue(selections?.disease) ||
    hasMeaningfulValue(selections?.disease_interest);

  const volcanoAll = getSavedBooleanFlag(LS_VOLCANO_ALL);
  const savedVolcano = getSavedArray(LS_VOLCANO);
  const savedHeatmapRows = getSavedArray(LS_HEATMAP);
  const savedDisease = getSavedString(LS_DISEASE, LS_DISEASE_ALT_1, LS_DISEASE_ALT_2);

  const wantsVolcano = wantsVolcanoFromSummary || volcanoAll || savedVolcano.length > 0;
  const wantsHeatmap = wantsHeatmapFromSummary || savedHeatmapRows.length > 0;
  const wantsDisease = wantsDiseaseFromSummary || savedDisease.length > 0;

  return checklist.map((item) => {
    if (isRunning) return item;

    if (item.key === "rerun_deseq2") {
      return { ...item, state: "na" };
    }

    if (item.key === "volcano" && !wantsVolcano) {
      return { ...item, state: "na" };
    }

    if (item.key === "heatmaps" && !wantsHeatmap) {
      return { ...item, state: "na" };
    }

    if (item.key === "ai_ranking" && !wantsDisease) {
      return { ...item, state: "na" };
    }

    return item;
  });
}

export function buildChecklistFromSummary(
  summary: StatusSummary | null,
  defaultChecklist: ChecklistItemT[]
): ChecklistItemT[] {
  let out = defaultChecklist.map((d) => ({ ...d }));

  if (!summary) return out;

  const apiList = Array.isArray(summary.checklist) ? summary.checklist : [];
  const steps = Array.isArray((summary as any).steps) ? (summary as any).steps : [];

  const apiKeyMap = new Map<string, any>();
  for (const it of apiList) {
    if (it?.key) apiKeyMap.set(String(it.key), it);
  }

  const apiLabelMap = new Map<string, any>();
  for (const it of apiList) {
    if (it?.label) apiLabelMap.set(String(it.label).toLowerCase(), it);
  }

  const stepMap = new Map<string, any>();
  for (const s of steps) {
    if (!s?.title) continue;
    stepMap.set(String(s.title).toLowerCase(), s);
  }

  out = out.map((d) => {
    const apiItem = apiKeyMap.get(d.key);
    if (apiItem?.state) {
      return { ...d, state: normalizeChecklistState(apiItem.state) };
    }

    const apiByLabel = apiLabelMap.get(d.label.toLowerCase());
    if (apiByLabel?.state) {
      return { ...d, state: normalizeChecklistState(apiByLabel.state) };
    }

    const labelLower = d.label.toLowerCase();

    for (const [title, stObj] of stepMap.entries()) {
      if (
        title.includes(labelLower.split(" ")[0]) ||
        labelLower.includes(title.split(" ")[0])
      ) {
        if (stObj?.state) {
          return { ...d, state: normalizeChecklistState(stObj.state) };
        }

        if (typeof stObj?.title === "string") {
          const stepTitle = stObj.title.toLowerCase();

          if (stepTitle.includes("complete")) return { ...d, state: "complete" };
          if (stepTitle.includes("running")) return { ...d, state: "running" };
          if (stepTitle.includes("failed")) return { ...d, state: "error" };
        }
      }
    }

    return d;
  });

  return applySelectionAwareOverrides(out, summary);
}
