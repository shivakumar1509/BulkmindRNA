import React, { useEffect, useMemo, useState } from "react";
import {
  startPipelineRun,
  RunInputs,
  getStatusSummary,
  StatusSummary,
  ChecklistItem as ChecklistItemT,
} from "../api/client";
import {
  ChipState,
  buildChecklistFromSummary,
  normalizeChecklistState,
} from "./pipelineStatus";

const accent = "#1B427A";

const ui = {
  pageBg: "#f8fafc",
  text: "#0f172a",
  muted: "#64748b",
  cardBg: "#ffffff",
  border: "#e5e7eb",
  shadow: "0 10px 30px rgba(15,23,42,0.06)",
  shadowHover: "0 14px 40px rgba(15,23,42,0.09)",
  dangerBg: "#fef2f2",
  dangerBorder: "#fecaca",
  dangerText: "#991b1b",
  successText: "#166534",
  infoBg: "#f9fafb",
  infoBorder: "#e5e7eb",
};

type Props = {
  currentUser: string | null;
  manualOutlierNote?: string | null;
};

const DEFAULT_CHECKLIST: ChecklistItemT[] = [
  { key: "fastqc", label: "FastQC", state: "not_started" },
  { key: "alignment", label: "Alignment", state: "not_started" },
  { key: "counting", label: "Counting", state: "not_started" },
  { key: "deseq2", label: "Differential analysis", state: "not_started" },

  { key: "outliers", label: "Outlier detection", state: "not_started" },
  { key: "rerun_deseq2", label: "Re-run differential analysis", state: "not_started" },
  { key: "deg", label: "Differential gene expression", state: "not_started" },
  { key: "enrichment", label: "Pathway enrichment", state: "not_started" },

  { key: "ai_ranking", label: "AI ranking", state: "not_started" },
  { key: "volcano", label: "Volcano plots", state: "not_started" },
  { key: "heatmaps", label: "Heatmaps", state: "not_started" },
];

function StatusShape({ state }: { state: ChipState }) {
  const s = normalizeChecklistState(state);

  const config: Record<
    ChipState,
    { bg: string; border?: string; radius: string }
  > = {
    not_started: {
      bg: "#ffffff",
      border: "2px solid #94a3b8",
      radius: "9999px",
    },
    ready: {
      bg: "#2563eb",
      radius: "9999px",
    },
    running: {
      bg: "#7c3aed",
      radius: "9999px",
    },
    complete: {
      bg: "#22c55e",
      radius: "9999px",
    },
    error: {
      bg: "#ef4444",
      radius: "9999px",
    },
    cached: {
      bg: "#2563eb",
      radius: "9999px",
    },
    na: {
      bg: "#2563eb",
      radius: "2px",
    },
  };

  const { bg, border, radius } = config[s];

  return (
    <span
      aria-hidden="true"
      style={{
        width: 16,
        height: 16,
        display: "inline-block",
        background: bg,
        border: border || "none",
        borderRadius: radius,
        flexShrink: 0,
        boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08)",
      }}
    />
  );
}

const SimpleChecklistLine: React.FC<{ item: ChecklistItemT }> = ({ item }) => {
  const s = normalizeChecklistState(item.state);

  return (
    <div
      title={`${item.label}: ${s}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "6px 8px",
        color: ui.text,
        fontSize: 14,
        fontWeight: 700,
        lineHeight: 1.1,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      <span
        style={{
          width: 22,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <StatusShape state={s} />
      </span>

      <span style={{ color: ui.text }}>{item.label}</span>
    </div>
  );
};

const RunPipelineCard: React.FC<Props> = ({ currentUser, manualOutlierNote }) => {
  const [hovered, setHovered] = useState(false);

  const [inputs, setInputs] = useState<RunInputs>(() => ({
    sample_id: localStorage.getItem("bulkmind.sampleId") || "test",
    species: localStorage.getItem("bulkmind.species") || "mouse",
    release: localStorage.getItem("bulkmind.release") || "113",
    fresh: false,
    analysis_only: false,
  }));

  useEffect(() => {
    const sync = () => {
      const sample_id = localStorage.getItem("bulkmind.sampleId") || "test";
      const species = localStorage.getItem("bulkmind.species") || "mouse";
      const release = localStorage.getItem("bulkmind.release") || "113";

      setInputs((prev) => ({
        ...prev,
        sample_id,
        species,
        release,
      }));
    };

    sync();
    window.addEventListener("bulkmind:state", sync);
    window.addEventListener("storage", sync);

    return () => {
      window.removeEventListener("bulkmind:state", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const [verified, setVerified] = useState(false);
  const [runResult, setRunResult] = useState<any | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<StatusSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const displayedChecklist = useMemo(
    () => buildChecklistFromSummary(summary, DEFAULT_CHECKLIST),
    [summary]
  );

  const isPipelineRunning = Boolean((summary as any)?.pipeline?.is_running);

  const pipelineFailed = displayedChecklist.some(
    (item) => normalizeChecklistState(item.state) === "error"
  );

  async function refreshSummary() {
    if (!currentUser) {
      setSummary(null);
      setSummaryError(null);
      return;
    }

    setSummaryLoading(true);
    setSummaryError(null);

    try {
      const s = await getStatusSummary(currentUser, inputs.sample_id);
      setSummary(s);
    } catch (e: any) {
      setSummaryError(e?.message || String(e));
    } finally {
      setSummaryLoading(false);
    }
  }

  useEffect(() => {
    refreshSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, inputs.sample_id]);

  useEffect(() => {
    if (!currentUser) return;
    const ms = isPipelineRunning ? 5000 : 30000;
    const t = window.setInterval(refreshSummary, ms);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, inputs.sample_id, isPipelineRunning]);

  async function handleRun() {
    if (!verified) {
      setError(
        "Please confirm you have reviewed the updated sample metadata and pathway/gene selections used for figures, and they are correct."
      );
      return;
    }

    setError(null);
    setRunResult(null);
    setRunLoading(true);

    try {
      const res = await startPipelineRun({
        ...inputs,
        user: currentUser || "unknown_user",
      });
      setRunResult(res);
      await refreshSummary();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setRunLoading(false);
    }
  }

  const jobId =
    (runResult &&
      (runResult.workflow_id ||
        runResult.id ||
        runResult.run_id ||
        runResult.job_record?.workflow_id)) ||
    null;

  const statusText =
    (runResult && (runResult.status || runResult.job_record?.status)) || null;

  return (
    <section
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: ui.cardBg,
        borderRadius: 18,
        padding: 16,
        boxShadow: hovered ? ui.shadowHover : ui.shadow,
        border: `1px solid ${ui.border}`,
        marginBottom: 16,
        transition: "box-shadow 140ms ease, transform 140ms ease",
        transform: hovered ? "translateY(-1px)" : "translateY(0px)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 10,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: accent }}>
          Run pipeline
        </h2>

        <button
          type="button"
          onClick={refreshSummary}
          disabled={!currentUser || summaryLoading}
          title={!currentUser ? "Login to load status" : "Refresh checklist"}
          style={{
            border: `1px solid ${ui.border}`,
            background: "#ffffff",
            borderRadius: 9999,
            padding: "8px 10px",
            fontSize: 12,
            fontWeight: 900,
            cursor: !currentUser || summaryLoading ? "default" : "pointer",
            color: accent,
            opacity: !currentUser ? 0.5 : 1,
          }}
        >
          ↻ Refresh
        </button>
      </div>

      <div
        style={{
          background: ui.pageBg,
          border: `1px solid ${ui.border}`,
          borderRadius: 14,
          padding: 12,
          marginBottom: 12,
        }}
      >
        <div style={{ marginBottom: 8, fontSize: 13, color: ui.text }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <input
              type="checkbox"
              checked={inputs.fresh}
              onChange={(e) => {
                const checked = e.target.checked;
                setInputs((prev) => ({
                  ...prev,
                  fresh: checked,
                  analysis_only: checked ? false : prev.analysis_only,
                }));
              }}
              style={{ marginTop: 2 }}
            />
            <span>
              <strong>Fresh run from raw reads</strong>{" "}
              <span style={{ color: ui.muted }}>
                (re-runs mapping, quantification, and analysis).
              </span>
            </span>
          </label>
        </div>

        <div style={{ marginBottom: 8, fontSize: 13, color: ui.text }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <input
              type="checkbox"
              checked={inputs.analysis_only}
              onChange={(e) => {
                const checked = e.target.checked;
                setInputs((prev) => ({
                  ...prev,
                  analysis_only: checked,
                  fresh: checked ? false : prev.fresh,
                }));
              }}
              style={{ marginTop: 2 }}
            />
            <span>
              <strong>Rerun analysis only</strong>{" "}
              <span style={{ color: ui.muted }}>
                (reuses existing count matrices).
              </span>
            </span>
          </label>
        </div>

        <div style={{ fontSize: 13, color: ui.text }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <input
              type="checkbox"
              checked={verified}
              onChange={(e) => setVerified(e.target.checked)}
              style={{ marginTop: 2 }}
            />
            <span>
              I have reviewed and verified sample metadata and pathway/gene
              selections.
            </span>
          </label>
        </div>
      </div>

      <button
        type="button"
        onClick={handleRun}
        disabled={runLoading}
        style={{
          padding: "12px 18px",
          borderRadius: 9999,
          border: "none",
          width: "100%",
          maxWidth: 520,
          background: runLoading ? "#94a3b8" : accent,
          color: "#ffffff",
          fontSize: 15,
          fontWeight: 800,
          cursor: runLoading ? "default" : "pointer",
          boxShadow: runLoading ? "none" : "0 10px 26px rgba(27,66,122,0.22)",
          letterSpacing: "-0.01em",
          marginBottom: 12,
        }}
      >
        {runLoading ? "Starting..." : "🚀 Run Pipeline (use top selections)"}
      </button>

      {manualOutlierNote ? (
        <div
          style={{
            marginTop: 12,
            marginBottom: 18,
            fontSize: 12.5,
            fontWeight: 800,
            color: "#92400e",
            maxWidth: 980,
          }}
        >
          {manualOutlierNote}
        </div>
      ) : null}

      <div style={{ marginTop: 12 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            marginBottom: 8,
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 900, color: ui.muted }}>
            Pipeline checklist
            {isPipelineRunning && (
              <span style={{ marginLeft: 8, color: "#6d28d9" }}>🟣 Running</span>
            )}
            {pipelineFailed && (
              <span style={{ marginLeft: 8, color: ui.dangerText }}>🔴 Failed</span>
            )}
          </div>

          {summary?.updated_at ? (
            <div style={{ fontSize: 11.5, color: ui.muted }}>
              Updated{" "}
              {new Date(summary.updated_at).toLocaleString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </div>
          ) : (
            <div style={{ fontSize: 11.5, color: ui.muted }}>
              {currentUser ? (summaryLoading ? "Loading…" : "—") : "Login to load status"}
            </div>
          )}
        </div>

        {summaryError && (
          <div
            style={{
              marginBottom: 10,
              padding: 10,
              borderRadius: 12,
              fontSize: 12,
              background: ui.dangerBg,
              border: `1px solid ${ui.dangerBorder}`,
              color: ui.dangerText,
            }}
          >
            <strong>Status error:</strong> {summaryError}
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 12,
          }}
        >
          {[0, 1, 2].map((colIdx) => {
            const start = colIdx * 4;
            const slice = displayedChecklist.slice(start, start + 4);

            return (
              <div
                key={colIdx}
                style={{ display: "flex", flexDirection: "column", gap: 6 }}
              >
                {slice.map((it) => (
                  <SimpleChecklistLine key={it.key} item={it} />
                ))}
              </div>
            );
          })}
        </div>

        <style>{`
          @media (max-width: 900px) {
            div[style*="grid-template-columns: repeat(3, 1fr)"] {
              grid-template-columns: repeat(2, 1fr) !important;
            }
          }
          @media (max-width: 520px) {
            div[style*="grid-template-columns: repeat(3, 1fr)"] {
              grid-template-columns: repeat(1, 1fr) !important;
            }
          }
        `}</style>
      </div>

      {error && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 14,
            fontSize: 12,
            background: ui.dangerBg,
            border: `1px solid ${ui.dangerBorder}`,
            color: ui.dangerText,
          }}
        >
          <strong>Error:</strong> {error}
        </div>
      )}

      {runResult && !error && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 14,
            background: ui.infoBg,
            border: `1px solid ${ui.infoBorder}`,
            fontSize: 13,
          }}
        >
          <div style={{ marginBottom: 6, fontWeight: 800, color: accent }}>
            Run submitted
          </div>

          <div>
            <strong>Status:</strong> {statusText || "Submitted"}
          </div>

          {jobId && (
            <div style={{ marginTop: 8 }}>
              <strong>Job ID:</strong>{" "}
              <code
                style={{
                  fontSize: 12,
                  background: "#ffffff",
                  border: `1px solid ${ui.border}`,
                  padding: "2px 8px",
                  borderRadius: 999,
                }}
              >
                {jobId}
              </code>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default RunPipelineCard;
