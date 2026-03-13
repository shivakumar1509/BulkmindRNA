import React, { useEffect, useMemo, useState } from "react";

import BulkMindHeader from "./pipeline/00_BulkMindHeader";

// Step components (body-only)
import P01UploadRawdata from "./pipeline/p01_upload_rawdata";
import P02SampleMetadata from "./pipeline/p02_sample_metadata";
import P03OutlierDetection from "./pipeline/p03_outlier_detection";

// Step 4+ now shift up
import P04AiRankedPathways from "./pipeline/p04_ai_ranked_pathways";
import P05VolcanoPlots from "./pipeline/p05_volcano_plots";
import P06HeatmapGenerations from "./pipeline/p06_heatmap_generations";
import P07KeggPathview from "./pipeline/p07_kegg_pathview"; // <-- Reverted to match your actual filename
import P08ApplyAndRunPipeline from "./pipeline/p08_apply_and_run_pipeline";
import P09ResultsViewer from "./pipeline/p09_results_viewer";

import RunPipelineCard from "./pipeline/p10_run_pipeline_card";

// Status API
import { getStatusSummary, StatusSummary } from "./api/client";
import {
  StepState,
  aggregateStates,
  aggregateStepState,
  buildChecklistMap,
  buildServerStepsMap,
  getServerStepState,
  microOr,
} from "./pipeline/pipelineStatus";

const accent = "#1B427A";
const API_BASE_URL = "http://localhost:8000";

const HELP_URLS = {
  step1_tutorial: "https://example.com/tutorial-step1",
  step2_tutorial: "https://example.com/tutorial-step2",
  step3_learn_more: "https://example.com/learnmore-step3",
  step4_learn_more: "https://example.com/learnmore-step4",
  step9_tutorial: "https://example.com/tutorial-step9",
};

const ui = {
  pageBg: "#f8fafc",
  text: "#0f172a",
  muted: "#64748b",
  cardBg: "#ffffff",
  border: "#e5e7eb",
  divider: "#f1f5f9",
  shadow: "0 10px 30px rgba(15,23,42,0.06)",
  shadowHover: "0 14px 40px rgba(15,23,42,0.09)",
};

const LS_KEYS = {
  sampleId: "bulkmind.sampleId",
  species: "bulkmind.species",
  release: "bulkmind.release",
  uploadedRawName: "bulkmind.uploadedRawName",
};

function importJobLSKey(username: string, sampleId: string) {
  return `bulkmind.importJobId.${username}.${sampleId}`;
}

function applyStatusLSKey(username: string, sampleId: string) {
  return `bulkmind.applySelections.status.${username}.${sampleId}`;
}

function safeGetLS(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSetLS(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}
function safeRemoveLS(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {}
}

const STEP_STYLE: Record<
  StepState,
  { icon: string; bg: string; border: string; text: string }
> = {
  not_started: { icon: "⚪", bg: "#f8fafc", border: ui.border, text: ui.muted },
  queued: { icon: "🟡", bg: "#fffbeb", border: "#fde68a", text: "#92400e" },
  uploading: { icon: "🟠", bg: "#fff7ed", border: "#fdba74", text: "#9a3412" },
  ready: { icon: "🔵", bg: "#f0f9ff", border: "#bae6fd", text: "#0369a1" },
  running: { icon: "🟣", bg: "#f5f3ff", border: "#ddd6fe", text: "#6d28d9" },
  complete: { icon: "🟢", bg: "#ecfdf3", border: "#bbf7d0", text: "#166534" },
  error: { icon: "🔴", bg: "#fef2f2", border: "#fecaca", text: "#991b1b" },
};

const StatusChip: React.FC<{ state: StepState; title?: string }> = ({
  state,
  title,
}) => {
  const st = STEP_STYLE[state];

  const label =
    state === "not_started"
      ? "Not started"
      : state === "queued"
      ? "Queued"
      : state === "uploading"
      ? "Uploading"
      : state;

  return (
    <span
      title={title || label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        borderRadius: 9999,
        background: st.bg,
        border: `1px solid ${st.border}`,
        color: st.text,
        fontSize: 12,
        fontWeight: 900,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ fontSize: 14, lineHeight: 1 }}>{st.icon}</span>
      <span style={{ textTransform: "capitalize" }}>{label}</span>
    </span>
  );
};

const HelpChip: React.FC<{ label: string; url: string; title?: string }> = ({
  label,
  url,
  title,
}) => {
  const [hover, setHover] = useState(false);

  return (
    <button
      type="button"
      title={title || "Opens a short guide in a new tab"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        window.open(url, "_blank", "noopener,noreferrer");
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        borderRadius: 9999,
        background: hover ? "#DCFCE7" : "#ECFDF3",
        border: `1px solid ${hover ? "#86EFAC" : "#BBF7D0"}`,
        color: "#166534",
        fontSize: 12,
        fontWeight: 900,
        lineHeight: 1,
        whiteSpace: "nowrap",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
};

type PipelineStepProps = {
  title: string;
  defaultOpen?: boolean;
  statusState?: StepState;
  statusTitle?: string;
  helpChip?: React.ReactNode;
  blockedReason?: string | null;
  children: React.ReactNode;
};

const PipelineStep: React.FC<PipelineStepProps> = ({
  title,
  defaultOpen = false,
  statusState = "not_started",
  statusTitle,
  helpChip,
  blockedReason,
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const [hovered, setHovered] = useState(false);

  return (
    <section
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: ui.cardBg,
        borderRadius: 18,
        padding: 0,
        boxShadow: hovered ? ui.shadowHover : ui.shadow,
        border: `1px solid ${ui.border}`,
        marginBottom: 16,
        overflow: "hidden",
        transition: "box-shadow 140ms ease, transform 140ms ease",
        transform: hovered ? "translateY(-1px)" : "translateY(0px)",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 18px",
          border: "none",
          outline: "none",
          boxShadow: "none",
          background: ui.cardBg,
          cursor: "pointer",
        }}
      >
        <span
          style={{
            fontSize: 16,
            fontWeight: 800,
            color: accent,
            letterSpacing: "-0.01em",
          }}
        >
          {title}
        </span>

        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          {helpChip}
          <StatusChip state={statusState} title={statusTitle} />

          <span
            aria-hidden="true"
            style={{
              width: 28,
              height: 28,
              borderRadius: 999,
              display: "grid",
              placeItems: "center",
              background: open ? "#eef2ff" : "#f3f4f6",
              color: "#334155",
              fontSize: 16,
              fontWeight: 900,
              border: `1px solid ${ui.border}`,
              transition: "background 140ms ease",
              flex: "0 0 auto",
            }}
          >
            {open ? "▾" : "▸"}
          </span>
        </span>
      </button>

      <div
        style={{
          padding: 18,
          background: ui.cardBg,
          borderTop: `1px solid ${ui.divider}`,
          display: open ? "block" : "none",
        }}
      >
        {blockedReason ? (
          <div
            style={{
              marginBottom: 12,
              padding: "10px 12px",
              borderRadius: 12,
              background: "#fffbeb",
              border: "1px solid #fde68a",
              color: "#92400e",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {blockedReason}
            <div
              style={{
                marginTop: 6,
                fontSize: 12,
                fontWeight: 600,
                color: "#a16207",
              }}
            >
              This step is view-only until the prerequisite step completes.
            </div>
          </div>
        ) : null}

        <div
          // @ts-ignore
          inert={blockedReason ? "" : undefined}
          aria-disabled={blockedReason ? "true" : "false"}
          style={{
            opacity: blockedReason ? 0.65 : 1,
          }}
        >
          {children}
        </div>
      </div>
    </section>
  );
};

type ImportJobStatus = {
  status?: string;
  progress?: { done?: number; total?: number };
  errors?: any[];
  results?: any[];
};

type MetadataStatus = {
  exists: boolean;
  rows?: number | null;
  mtime?: number | null;
  csv_path?: string;
};

function App() {
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [sampleId, setSampleId] = useState<string>(() => {
    return (safeGetLS(LS_KEYS.sampleId) || "test").trim() || "test";
  });

  const [species, setSpecies] = useState<string>(() => {
    return (safeGetLS(LS_KEYS.species) || "mouse").trim() || "mouse";
  });

  const [summary, setSummary] = useState<StatusSummary | null>(null);

  const [importJobId, setImportJobId] = useState<string | null>(null);
  const [importJob, setImportJob] = useState<ImportJobStatus | null>(null);

  const [metaStatus, setMetaStatus] = useState<MetadataStatus | null>(null);

  const [outlierMode, setOutlierMode] = useState<string>("");

  const [applySelectionsState, setApplySelectionsState] = useState<
    "idle" | "error" | "complete"
  >("idle");
  const [applySelectionsMessage, setApplySelectionsMessage] =
    useState<string>("");

  const [step9ViewerState, setStep9ViewerState] = useState<StepState | null>(null);
  const [step9ViewerTitle, setStep9ViewerTitle] = useState<string>("");

  useEffect(() => {
    const u = (safeGetLS("bulkmind.username") || "").trim();
    if (u && !currentUser) setCurrentUser(u);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = (ev: Event) => {
      const e = ev as CustomEvent<any>;

      const s = String(e?.detail?.sampleId || "").trim();
      if (s) setSampleId(s);

      const sp = String(e?.detail?.species || "").trim();
      if (sp) setSpecies(sp);

      const up = String(e?.detail?.uploadedRawName || "").trim();
      if (up && currentUser && s) {
        const m = up.match(/^import_job:([a-f0-9]{6,})$/i);
        if (m?.[1]) {
          const jid = m[1];
          safeSetLS(importJobLSKey(currentUser, s), jid);
          setImportJobId(jid);
        }
      }
    };

    window.addEventListener("bulkmind:state", handler as any);
    return () => window.removeEventListener("bulkmind:state", handler as any);
  }, [currentUser]);

  async function refreshSummary() {
    if (!currentUser) {
      setSummary(null);
      return;
    }
    try {
      const s = await getStatusSummary(currentUser, sampleId);
      setSummary(s);
    } catch {
      setSummary(null);
    }
  }

  useEffect(() => {
    refreshSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, sampleId]);

  useEffect(() => {
    if (!currentUser) return;
    const isRunning = Boolean(summary?.pipeline?.is_running);
    const ms = isRunning ? 5000 : 30000;

    const t = window.setInterval(() => {
      refreshSummary();
    }, ms);

    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, sampleId, summary?.pipeline?.is_running]);

  useEffect(() => {
    if (!currentUser || !sampleId) {
      setApplySelectionsState("idle");
      setApplySelectionsMessage("");
      return;
    }

    const key = applyStatusLSKey(currentUser, sampleId);
    const raw = safeGetLS(key);

    if (!raw) {
      setApplySelectionsState("idle");
      setApplySelectionsMessage("");
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      const st = String(parsed?.state || "idle") as "idle" | "error" | "complete";
      const msg = String(parsed?.message || "");
      setApplySelectionsState(st);
      setApplySelectionsMessage(msg);
    } catch {
      setApplySelectionsState("idle");
      setApplySelectionsMessage("");
    }
  }, [currentUser, sampleId]);

  useEffect(() => {
    const handler = (ev: Event) => {
      const e = ev as CustomEvent<any>;
      const sid = String(e?.detail?.sampleId || "").trim();
      const user = String(e?.detail?.username || "").trim();

      if (sid !== String(sampleId || "").trim()) return;
      if (user !== String(currentUser || "").trim()) return;

      const st = String(e?.detail?.state || "idle") as
        | "idle"
        | "error"
        | "complete";
      const msg = String(e?.detail?.message || "");

      setApplySelectionsState(st);
      setApplySelectionsMessage(msg);
    };

    window.addEventListener("bulkmind:apply-status", handler as any);
    return () =>
      window.removeEventListener("bulkmind:apply-status", handler as any);
  }, [currentUser, sampleId]);

  useEffect(() => {
    setImportJob(null);
    if (!currentUser || !sampleId) {
      setImportJobId(null);
      return;
    }

    const key = importJobLSKey(currentUser, sampleId);
    const jid = (safeGetLS(key) || "").trim() || null;

    const up = (safeGetLS(LS_KEYS.uploadedRawName) || "").trim();
    const m = up.match(/^import_job:([a-f0-9]{6,})$/i);
    const derived = m?.[1] || null;

    setImportJobId(jid || derived);
  }, [currentUser, sampleId]);

  useEffect(() => {
    if (!currentUser || !importJobId) return;

    let stopped = false;

    async function tick() {
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/uploads/import/${encodeURIComponent(
            importJobId
          )}?username=${encodeURIComponent(currentUser)}`
        );

        if (!res.ok) {
          if (res.status === 404) {
            safeRemoveLS(importJobLSKey(currentUser, sampleId));
            setImportJobId(null);
            setImportJob(null);
            return;
          }
          throw new Error(`HTTP ${res.status}`);
        }

        const data = (await res.json()) as ImportJobStatus;
        if (stopped) return;
        setImportJob(data);

        const st = String((data as any)?.status || "").toLowerCase();
        if (st === "failed") {
          safeRemoveLS(importJobLSKey(currentUser, sampleId));
          setImportJobId(null);
        }
      } catch {}
    }

    tick();
    const t = window.setInterval(tick, 2000);

    return () => {
      stopped = true;
      window.clearInterval(t);
    };
  }, [currentUser, sampleId, importJobId]);

  useEffect(() => {
    if (!currentUser || !sampleId) {
      setMetaStatus(null);
      return;
    }

    let stopped = false;

    async function tick() {
      try {
        const url = `${API_BASE_URL}/api/samples/${encodeURIComponent(
          sampleId
        )}/metadata/status?username=${encodeURIComponent(currentUser)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as MetadataStatus;
        if (stopped) return;
        setMetaStatus(data);
      } catch {
        if (!stopped) setMetaStatus(null);
      }
    }

    tick();

    const ms = metaStatus?.exists ? 30000 : 4000;
    const t = window.setInterval(tick, ms);

    return () => {
      stopped = true;
      window.clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, sampleId, metaStatus?.exists]);

  useEffect(() => {
    if (!currentUser || !sampleId) {
      setOutlierMode("");
      return;
    }

    let stopped = false;

    async function tick() {
      try {
        const url = `${API_BASE_URL}/api/outliers/${encodeURIComponent(
          sampleId
        )}/mode?username=${encodeURIComponent(currentUser)}`;

        const res = await fetch(url, {
          headers: authToken
            ? { Authorization: `Bearer ${authToken}` }
            : undefined,
        });

        if (!res.ok) {
          if (!stopped) setOutlierMode("");
          return;
        }

        const data = await res.json();
        const mode = String((data as any)?.mode || "").trim();
        if (!stopped) setOutlierMode(mode);
      } catch {
        if (!stopped) setOutlierMode("");
      }
    }

    tick();
    const t = window.setInterval(tick, 5000);

    return () => {
      stopped = true;
      window.clearInterval(t);
    };
  }, [currentUser, sampleId, authToken]);

  const checklistMap = useMemo(() => buildChecklistMap(summary), [summary]);

  const pipelineRunning = Boolean(summary?.pipeline?.is_running);
  const pipelineFailed = Boolean(summary?.pipeline?.is_failed);

  const serverStepsMap = useMemo(() => buildServerStepsMap(summary), [summary]);

  const serverState = (stepNum: number) => getServerStepState(serverStepsMap, stepNum);

  const s1 = serverState(1);
  const serverStep1State = s1.state;
  const serverStep1Micro = s1.micro;

  const uploadedRawName = (safeGetLS(LS_KEYS.uploadedRawName) || "").trim();
  const uploadedLooksLikeImport = /^import_job:[a-f0-9]{6,}$/i.test(
    uploadedRawName
  );

  const importStatus = String((importJob as any)?.status || "").toLowerCase();
  const backendEvidenceSampleExists = Boolean(metaStatus?.exists);

  let step1State: StepState = "not_started";
  let step1Title: string | undefined = undefined;

  if (!currentUser) {
    step1State = "not_started";
    step1Title = "Log in to upload rawdata.";
  } else if (serverStep1State === "complete") {
    step1State = "complete";
    step1Title = serverStep1Micro || "Upload complete.";
  } else if (serverStep1State === "running") {
    step1State = "uploading";
    step1Title = serverStep1Micro || "Uploading…";
  } else if (serverStep1State === "error") {
    step1State = "error";
    step1Title = serverStep1Micro || "Upload error.";
  } else if (backendEvidenceSampleExists) {
    step1State = "complete";
    step1Title = "Sample already present on server.";
  } else if (importJobId || uploadedLooksLikeImport) {
    if (importStatus === "queued" || (!importStatus && importJobId)) {
      step1State = "queued";
      step1Title = "Import job is queued on the server.";
    } else if (importStatus === "running") {
      step1State = "uploading";
      const done = Number((importJob as any)?.progress?.done || 0);
      const total = Number((importJob as any)?.progress?.total || 0);
      step1Title = total > 0 ? `Downloading… (${done}/${total})` : "Downloading…";
    } else if (importStatus === "completed") {
      step1State = "complete";
      step1Title = "Import completed.";
    } else if (importStatus === "failed") {
      step1State = "not_started";
      step1Title = "Import failed. Please retry Step 1.";
    } else if (uploadedRawName && !uploadedLooksLikeImport) {
      step1State = "complete";
      step1Title = "Rawdata uploaded.";
    } else {
      step1State = "queued";
      step1Title = "Import started.";
    }
  } else if (uploadedRawName) {
    step1State = "complete";
    step1Title = "Rawdata uploaded.";
  } else {
    step1State = "not_started";
    step1Title = "No rawdata uploaded yet.";
  }

  const metaExists = Boolean(metaStatus?.exists);
  const metaRows = metaStatus?.rows ?? null;

  const step2State: StepState = metaExists ? "complete" : "not_started";
  const step2Title = metaExists
    ? `Validated metadata found${
        typeof metaRows === "number" ? ` (${metaRows} rows)` : ""
      }.`
    : "Sample metadata not validated yet.";

  const step3ModeOk = Boolean(String(outlierMode || "").trim());

  const gateStep2 = step1State !== "complete";
  const gateStep3 = step1State !== "complete" || step2State !== "complete";
  const gateStep4Plus =
    step1State !== "complete" || step2State !== "complete" || !step3ModeOk;

  const blockedBecauseUpload =
    step1State !== "complete"
      ? "Step 1 upload/import is not complete yet. Please wait until Step 1 shows “Complete” before continuing."
      : null;

  const blockedBecauseMetadata =
    step1State === "complete" && step2State !== "complete"
      ? "Sample metadata is not validated yet. Go to Step 2 and click “Validate metadata” (or upload CSV + validate) before continuing."
      : null;

  const blockedBecauseOutliers =
    step1State === "complete" && step2State === "complete" && !step3ModeOk
      ? "Step 3 is not complete yet. Please open Step 3 and choose one option (Use all samples / Auto removal / Manual removal)."
      : null;

  const blockReasonStep2 = blockedBecauseUpload;
  const blockReasonStep3 = blockedBecauseUpload || blockedBecauseMetadata;
  const blockReasonStep4Plus =
    blockedBecauseUpload || blockedBecauseMetadata || blockedBecauseOutliers;

  const step3Server = serverState(3);
  const step4Server = serverState(4);
  const step5Server = serverState(5);
  const step6Server = serverState(6);
  const step7Server = serverState(7);
  const step8Server = serverState(8);
  const step10Server = serverState(10);

  const step3Raw =
    step3Server.state !== "not_started"
      ? step3Server.state
      : aggregateStepState(["outliers"], checklistMap);

  const enrichmentState =
    step4Server.state !== "not_started"
      ? step4Server.state
      : aggregateStepState(["enrichment"], checklistMap);

  const aiRankingState =
    step5Server.state !== "not_started"
      ? step5Server.state
      : aggregateStepState(["ai_ranking"], checklistMap);

  const step4Raw = aggregateStates([enrichmentState, aiRankingState]);
  const step4Micro = microOr(step5Server.micro, step4Server.micro);

  const step5Raw =
    step6Server.state !== "not_started"
      ? step6Server.state
      : aggregateStepState(["volcano"], checklistMap);

  const step6Raw =
    step7Server.state !== "not_started"
      ? step7Server.state
      : aggregateStepState(["heatmaps"], checklistMap);

  const step7Raw =
    step7Server.state !== "not_started"
      ? step7Server.state
      : aggregateStepState(["bar_plots"], checklistMap); // <-- Keep looking for the new JSON key your backend gives it

  const step8Raw: StepState =
    applySelectionsState === "complete"
      ? "complete"
      : applySelectionsState === "error"
      ? "error"
      : "ready";

  const allChecklistStates = Array.from(checklistMap.values());
  const allComplete =
    allChecklistStates.length > 0 &&
    allChecklistStates.every((s) => s === "complete");

  const step9Raw: StepState =
    step10Server.state !== "not_started"
      ? step10Server.state
      : step9ViewerState
      ? step9ViewerState
      : pipelineRunning
      ? "running"
      : pipelineFailed
      ? "error"
      : allComplete
      ? "complete"
      : "ready";

  const step3 = gateStep3 ? "not_started" : step3Raw;
  const step4 = gateStep4Plus ? "not_started" : step4Raw;
  const step5 = gateStep4Plus ? "not_started" : step5Raw;
  const step6 = gateStep4Plus ? "not_started" : step6Raw;
  const step7 = gateStep4Plus ? "not_started" : step7Raw;
  const step8 = gateStep4Plus ? "not_started" : step8Raw;
  const step9 = gateStep4Plus ? "not_started" : step9Raw;

  const manualOutlierNote =
    String(outlierMode || "").trim().toLowerCase() ===
    "select outliers manually"
      ? 'You chose Manual outlier removal. When the run completes, go back to Step 3 to review and select outliers, then rerun using “Rerun analysis only”.'
      : null;

  const handleLoginClick = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);

    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "shiv06" }),
      });

      if (!res.ok) {
        const text = await res.text();
        window.alert(`Login failed: ${res.status} ${text}`);
        return;
      }

      const data = await res.json();
      setCurrentUser(data.username || "shiv06");
      try {
        localStorage.setItem("bulkmind.username", data.username || "shiv06");
      } catch {}

      setAuthToken(data.token || null);
    } catch (err: any) {
      window.alert(`Login failed: ${err?.message || String(err)}`);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleBuyTokensClick = () => {
    window.alert(
      "In a real deployment, this would take you to a checkout page to buy BulkMind AI pipeline credits."
    );
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: ui.pageBg,
        color: ui.text,
        fontFamily:
          'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      }}
    >
      <BulkMindHeader
        currentUser={currentUser}
        onLoginClick={handleLoginClick}
        onBuyTokensClick={handleBuyTokensClick}
      />

      <main
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "18px 24px 56px 24px",
        }}
      >
        <PipelineStep
          title="1. Upload rawdata"
          defaultOpen
          statusState={step1State}
          statusTitle={step1Title}
          helpChip={
            <HelpChip
              label="Watch tutorial ▶️"
              url={HELP_URLS.step1_tutorial}
              title="Opens the Step 1 video tutorial in a new tab"
            />
          }
        >
          <P01UploadRawdata
            apiBaseUrl={API_BASE_URL}
            currentUser={currentUser || undefined}
            authToken={authToken}
          />
        </PipelineStep>

        <PipelineStep
          title="2. Sample metadata (create / upload / edit)"
          helpChip={
            <HelpChip
              label="Watch tutorial ▶️"
              url={HELP_URLS.step2_tutorial}
              title="Opens the Step 2 video tutorial in a new tab"
            />
          }
          statusState={gateStep2 ? "not_started" : step2State}
          statusTitle={step2Title}
          blockedReason={blockReasonStep2}
        >
          <P02SampleMetadata
            apiBaseUrl={API_BASE_URL}
            sampleId={sampleId}
            currentUser={currentUser || undefined}
            authToken={authToken}
          />
        </PipelineStep>

        <PipelineStep
          title="3. Outlier detection (AI-assisted)"
          statusState={step3}
          statusTitle={step3Server.micro}
          helpChip={
            <HelpChip
              label="Learn more ℹ️"
              url={HELP_URLS.step3_learn_more}
              title="Opens outlier detection explanation in a new tab"
            />
          }
          blockedReason={blockReasonStep3}
        >
          <P03OutlierDetection
            sampleId={sampleId}
            currentUser={currentUser || undefined}
            authToken={authToken}
          />
        </PipelineStep>

        <PipelineStep
          title="4. AI-ranked pathway enrichment"
          statusState={step4}
          statusTitle={step4Micro}
          helpChip={
            <HelpChip
              label="Learn more ℹ️"
              url={HELP_URLS.step4_learn_more}
              title="Opens pathway enrichment + AI ranking explanation in a new tab"
            />
          }
          blockedReason={blockReasonStep4Plus}
        >
          <P04AiRankedPathways apiBaseUrl={API_BASE_URL} species={species} />
        </PipelineStep>

        <PipelineStep
          title="5. Volcano plots"
          statusState={step5}
          statusTitle={step6Server.micro}
          blockedReason={blockReasonStep4Plus}
        >
          <P05VolcanoPlots
            apiBaseUrl={API_BASE_URL}
            sampleId={sampleId}
            currentUser={currentUser || undefined}
            authToken={authToken}
          />
        </PipelineStep>

        <PipelineStep
          title="6. Heatmap generations"
          statusState={step6}
          statusTitle={step7Server.micro}
          blockedReason={blockReasonStep4Plus}
        >
          <P06HeatmapGenerations
            apiBaseUrl={API_BASE_URL}
            sampleId={sampleId}
            species={species}
            currentUser={currentUser || undefined}
            authToken={authToken}
          />
        </PipelineStep>

        <PipelineStep
          title="7. Top enriched pathways"
          statusState={step7}
          statusTitle={step7Server.micro} // <-- Fixed to grab Step 7's message instead of Step 8's
          blockedReason={blockReasonStep4Plus}
        >
          <P07KeggPathview // <-- Reverted the component tag to match your file system name
            apiBaseUrl={API_BASE_URL}
            sampleId={sampleId}
            currentUser={currentUser || undefined}
            authToken={authToken}
          />
        </PipelineStep>

        <PipelineStep
          title="8. Apply settings & run pipeline"
          statusState={step8}
          statusTitle={
            applySelectionsState === "complete"
              ? "Selections applied and required helper CSV files were created."
              : applySelectionsState === "error"
              ? applySelectionsMessage ||
                "Required selections are missing or helper CSV creation failed."
              : "Ready to validate selections and create helper CSV files."
          }
          blockedReason={blockReasonStep4Plus}
        >
          <P08ApplyAndRunPipeline
            apiBaseUrl={API_BASE_URL}
            sampleId={sampleId}
            currentUser={currentUser || undefined}
            authToken={authToken}
          />
        </PipelineStep>

        <div style={{ opacity: gateStep4Plus ? 0.65 : 1 }}>
          <RunPipelineCard
            currentUser={currentUser}
            manualOutlierNote={manualOutlierNote}
          />
        </div>

        <PipelineStep
          title="9. Results viewer & QC"
          statusState={step9}
          statusTitle={step10Server.micro || step9ViewerTitle}
          helpChip={
            <HelpChip
              label="Watch tutorial ▶️"
              url={HELP_URLS.step9_tutorial}
              title="Opens the Step 9 results tutorial in a new tab"
            />
          }
          blockedReason={blockReasonStep4Plus}
        >
          <P09ResultsViewer
            sampleId={sampleId}
            apiBaseUrl={API_BASE_URL}
            username={currentUser || undefined}
            volcanoComparisons={
              ((summary as any)?.selections?.volcano_comparisons as string[]) ||
              []
            }
            diseaseOfInterest={
              String((summary as any)?.selections?.disease_of_interest || "")
            }
            heatmapPathways={
              ((summary as any)?.selections?.heatmap_pathways as string[]) || []
            }
            onStatusChange={(status, details) => {
              const mapped: StepState =
                status === "completed"
                  ? "complete"
                  : status === "error"
                  ? "error"
                  : "ready";

              setStep9ViewerState(mapped);

              const parts: string[] = [];

              parts.push(details.qcOk ? "QC plots found" : "QC plots missing");
              parts.push(
                details.pathwayOk
                  ? "pathway outputs ready"
                  : "pathway outputs missing"
              );

              if (details.wantsVolcano) {
                parts.push(
                  details.volcanoOk
                    ? "volcano plots found"
                    : "volcano plots missing"
                );
              } else {
                parts.push("volcano plots not requested");
              }

              if (details.wantsHeatmap) {
                parts.push(
                  details.heatmapOk ? "heatmaps found" : "heatmaps missing"
                );
              } else {
                parts.push("heatmaps not requested");
              }

              if (!details.wantsDisease) {
                parts.push("disease-dependent outputs not requested");
              }

              setStep9ViewerTitle(parts.join(" • "));
            }}
          />
        </PipelineStep>
      </main>
    </div>
  );
}

export default App;
