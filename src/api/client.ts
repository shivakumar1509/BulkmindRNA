// src/api/client.ts

const rawBase = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
export const API_BASE = rawBase.replace(/\/+$/, "");

export async function getCromwellStatus() {
  const url = `${API_BASE}/cromwell-status`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Status error ${res.status} at ${url}: ${text}`);
  }
  return res.json();
}

export interface RunInputs {
  sample_id: string;
  species: "mouse" | "human" | "rat";
  release: string;
  fresh: boolean;
  analysis_only: boolean; // analysis-only flag
  user?: string; // optional username from UI
}

export async function startPipelineRun(inputs: RunInputs) {
  // IMPORTANT:
  // Your backend curl that works expects:
  // {
  //   "username": "...",
  //   "inputs": { "sample_id": "...", "species": "...", ... }
  // }
  // NOT the WDL-style "bulk_run.*" keys.
  const payload = {
    username: inputs.user || "unknown_user",
    inputs: {
      sample_id: inputs.sample_id,
      species: inputs.species,
      release: inputs.release,
      fresh: Boolean(inputs.fresh),
      analysis_only: Boolean(inputs.analysis_only),
    },
  };

  const url = `${API_BASE}/run`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Run error ${res.status} at ${url}: ${text}`);
  }

  return res.json();
}

// -------------------- Checklist status --------------------

export type ChecklistItem = {
  key: string;
  label: string;
  state: "not_started" | "ready" | "running" | "complete" | "error" | "cached";
};

export type PipelineInfo = {
  workflow_id?: string | null;
  workflow_status?: string | null;
  is_running: boolean;
  is_failed: boolean;
};

export type StatusSummary = {
  username: string;
  sample_id: string;
  pipeline: PipelineInfo;
  checklist: ChecklistItem[];
  steps?: Array<{
    step: number;
    title: string;
    state: string;
    microtext?: string | null;
  }>;
  updated_at: number;
};

export async function getStatusSummary(username: string, sampleId: string) {
  const u = encodeURIComponent(username);
  const s = encodeURIComponent(sampleId);
  const url = `${API_BASE}/api/status/summary?username=${u}&sample_id=${s}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Status error ${res.status} at ${url}: ${text}`);
  }
  return (await res.json()) as StatusSummary;
}

