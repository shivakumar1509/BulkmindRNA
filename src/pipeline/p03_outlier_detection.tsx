import React, { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "../api/client";
import "./p03_outlier_detection.css";

type TableRow = { [column: string]: any };

interface TablePayload {
  columns: string[];
  rows: TableRow[];
  meta?: any;
}

type Mode = "all" | "ai" | "manual";
type PcaKind = "vsd" | "rld" | "consensus";

type Props = {
  sampleId?: string;
  currentUser?: string;
  authToken?: string | null;
};

const LS_SAMPLE = "bulkmind.sampleId";
const LS_OUT_SUGGESTED = "bulkmind.outliers.suggested";
const LS_OUT_SELECTED = "bulkmind.outliers.selected";
const LS_USERNAME = "bulkmind.username";

function safeGetLS(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function getEffectiveUsername(currentUser?: string): string {
  const u1 = (currentUser || "").trim();
  if (u1) return u1;
  const u2 = (safeGetLS(LS_USERNAME) || "").trim();
  return u2 || "shiv06";
}

function normalizeBool(v: any): boolean {
  if (typeof v === "boolean") return v;
  if (v === null || v === undefined) return false;
  const s = String(v).trim().toLowerCase();
  return ["true", "1", "yes", "y", "t"].includes(s);
}

function pickFirstExistingValue(row: any, keys: string[]): string {
  for (const k of keys) {
    if (row && row[k] !== undefined && row[k] !== null) {
      const val = String(row[k]).trim();
      if (val) return val;
    }
  }
  return "";
}

function buildUrl(
  base: string,
  path: string,
  username?: string,
  params?: Record<string, string | undefined>
) {
  let u = base.replace(/\/+$/, "") + path;

  const qp: string[] = [];
  if (username?.trim()) qp.push("username=" + encodeURIComponent(username.trim()));

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || String(v).trim() === "") continue;
      qp.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(v)));
    }
  }

  if (qp.length > 0) u += (u.includes("?") ? "&" : "?") + qp.join("&");
  return u;
}

/**
 * Keep this conservative: only treat as "not ready" when backend indicates that.
 * (Do NOT suppress generic errors that are real failures.)
 */
function isNotReadyYet(status: number, bodyText: string): boolean {
  if (status !== 404) return false;
  const t = (bodyText || "").toLowerCase();

  return (
    t.includes("analysis dir not found") ||
    t.includes("analysis directory not found") ||
    t.includes("pca table not ready") ||
    t.includes("outlier summary not ready") ||
    t.includes("not generated") ||
    t.includes("not ready")
  );
}

const FRIENDLY_NOTICE =
  "This step will populate automatically once PCA and outlier summary files are generated.";

const P03OutlierDetection: React.FC<Props> = ({ sampleId: sampleIdProp, currentUser, authToken }) => {
  const [mode, setMode] = useState<Mode>("all");
  const [pcaKind, setPcaKind] = useState<PcaKind>("vsd");
  const [sampleId, setSampleId] = useState<string>(() =>
    (sampleIdProp || safeGetLS(LS_SAMPLE) || "test").trim()
  );

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(FRIENDLY_NOTICE);
  const [error, setError] = useState<string | null>(null);

  const [pcaTable, setPcaTable] = useState<TablePayload | null>(null);
  const [outlierSummary, setOutlierSummary] = useState<TablePayload | null>(null);

  const [diagOpen, setDiagOpen] = useState(false);
  const [diagTable, setDiagTable] = useState<TablePayload | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);

  const [pcaFigureSrc, setPcaFigureSrc] = useState<string | null>(null);
  const figureObjectUrlRef = useRef<string | null>(null);
  const [figureNonce, setFigureNonce] = useState(0);

  const [removeSet, setRemoveSet] = useState<Set<string>>(new Set());

  const abortDataRef = useRef<AbortController | null>(null);
  const abortFigureRef = useRef<AbortController | null>(null);

  const revokeFigureObjectUrl = () => {
    if (figureObjectUrlRef.current) {
      URL.revokeObjectURL(figureObjectUrlRef.current);
      figureObjectUrlRef.current = null;
    }
  };

  const clearFigure = () => {
    setPcaFigureSrc(null);
    revokeFigureObjectUrl();
  };

  useEffect(() => {
    return () => {
      revokeFigureObjectUrl();
      abortDataRef.current?.abort();
      abortFigureRef.current?.abort();
    };
  }, []);

  // sync from prop
  useEffect(() => {
    const incoming = (sampleIdProp || "").trim();
    if (incoming && incoming !== sampleId) setSampleId(incoming);
  }, [sampleIdProp]);

  // sync from global event
  useEffect(() => {
    const handler = (ev: any) => {
      const sid = String(ev?.detail?.sampleId || "").trim();
      if (sid) setSampleId(sid);
    };
    window.addEventListener("bulkmind:state", handler as any);
    return () => window.removeEventListener("bulkmind:state", handler as any);
  }, []);

  // ✅ save outlier MODE into sample_metadata.csv (first row only)
  const saveOutlierModeToMetadata = async (modeValue: string) => {
    const sid = (sampleId || "").trim();
    if (!sid) return;

    const url = buildUrl(
      API_BASE,
      `/api/outliers/${encodeURIComponent(sid)}/mode`,
      getEffectiveUsername(currentUser)
    );

    try {
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ mode: modeValue }),
      });
    } catch {
      // keep UI working even if mode-save fails
    }
  };

  // ✅ create outliers.csv with ONLY the two columns (header only)
  const ensureOutliersCsvHeaderOnly = async () => {
    const sid = (sampleId || "").trim();
    if (!sid) return;

    const url = buildUrl(
      API_BASE,
      `/api/outliers/${encodeURIComponent(sid)}`,
      getEffectiveUsername(currentUser)
    );

    try {
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          columns: ["Outliers suggested", "Outliers selected"],
          rows: [], // header only
        }),
      });
    } catch {
      // ignore
    }
  };

  // reset when "all"
  useEffect(() => {
    if (mode === "all") {
      setError(null);
      setNotice(FRIENDLY_NOTICE);
      setPcaTable(null);
      setOutlierSummary(null);
      setRemoveSet(new Set());
      setDiagOpen(false);
      setDiagTable(null);
      clearFigure();

      try {
        localStorage.setItem(LS_OUT_SUGGESTED, "[]");
        localStorage.setItem(LS_OUT_SELECTED, "[]");
      } catch {}
      window.dispatchEvent(new CustomEvent("bulkmind:selections"));
    }
  }, [mode]);

  const loadExistingSelections = async (sid: string) => {
    const url = buildUrl(API_BASE, `/api/outliers/${encodeURIComponent(sid)}`, getEffectiveUsername(currentUser));
    const resp = await fetch(url, { headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined });
    if (!resp.ok) return;

    const payload = (await resp.json()) as TablePayload;
    const s = new Set<string>();

    const cols = (payload.columns || []).map((c) => String(c));
    const colsLower = cols.map((c) => c.toLowerCase());

    // old format: rows with "Sample"
    const hasSampleCol =
      colsLower.includes("sample") || colsLower.includes("samplename") || colsLower.includes("file name");

    if (hasSampleCol) {
      for (const r of payload.rows || []) {
        const v = pickFirstExistingValue(r, ["Sample", "sample", "sampleName", "outlier"]) || "";
        if (v) s.add(v);
      }
      setRemoveSet(s);
      return;
    }

    // ✅ new format: many rows, column "Outliers selected"
    const outSelIdx = colsLower.findIndex((c) => c === "outliers selected");
    const outSelCol = outSelIdx >= 0 ? cols[outSelIdx] : null;

    if (outSelCol) {
      for (const r of payload.rows || []) {
        const v = String((r as any)[outSelCol] ?? "").trim();
        if (v) s.add(v);
      }
    }

    setRemoveSet(s);
  };

  const loadPcaFigure = async (sid: string, kind: PcaKind) => {
    const effectiveUser = getEffectiveUsername(currentUser);

    abortFigureRef.current?.abort();
    const ac = new AbortController();
    abortFigureRef.current = ac;

    clearFigure();

    const figUrl = buildUrl(API_BASE, "/api/analysis/" + encodeURIComponent(sid) + "/pca-figure", effectiveUser, {
      kind,
      format: "png",
      v: String(Date.now()),
      _ts: String(Date.now()),
    });

    try {
      const resp = await fetch(figUrl, {
        signal: ac.signal,
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        cache: "no-store",
      });

      if (!resp.ok) {
        setPcaFigureSrc(figUrl);
        setFigureNonce((n) => n + 1);
        return;
      }

      const blob = await resp.blob();
      if (ac.signal.aborted) return;

      const objUrl = URL.createObjectURL(blob);
      figureObjectUrlRef.current = objUrl;

      setPcaFigureSrc(objUrl);
      setFigureNonce((n) => n + 1);
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        setPcaFigureSrc(figUrl);
        setFigureNonce((n) => n + 1);
      }
    }
  };

  const fetchPcaAndSuggestions = async (requestedMode: Mode, kindOverride?: PcaKind) => {
    const sid = (sampleId || "").trim();
    if (!sid) {
      setError("Sample ID is required.");
      return;
    }

    const kind = kindOverride || pcaKind;

    abortDataRef.current?.abort();
    const ac = new AbortController();
    abortDataRef.current = ac;

    setLoading(true);
    setSaving(false);
    setError(null);
    setNotice(FRIENDLY_NOTICE);

    try {
      // Always load PCA fig + PCA table
      await loadPcaFigure(sid, kind);

      const pcaUrl = buildUrl(
        API_BASE,
        `/api/analysis/${encodeURIComponent(sid)}/pca-table`,
        getEffectiveUsername(currentUser),
        { kind }
      );

      const pcaResp = await fetch(pcaUrl, {
        signal: ac.signal,
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      });

      if (!pcaResp.ok) {
        const text = await pcaResp.text();
        if (isNotReadyYet(pcaResp.status, text)) {
          setPcaTable(null);
          setOutlierSummary(null);
          setNotice(FRIENDLY_NOTICE);
          return;
        }
        throw new Error(`Failed to load PCA table. (${pcaResp.status}) ${text || ""}`.trim());
      }

      const pcaPayload: TablePayload = await pcaResp.json();
      setPcaTable(pcaPayload);

      await loadExistingSelections(sid);

      // ✅ KEY: BOTH ai + manual should show the SAME table
      if (requestedMode === "ai" || requestedMode === "manual") {
        const outUrl = buildUrl(
          API_BASE,
          `/api/analysis/${encodeURIComponent(sid)}/pca-outliers`,
          getEffectiveUsername(currentUser),
          { kind: "consensus" }
        );

        const outResp = await fetch(outUrl, {
          signal: ac.signal,
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        });

        if (outResp.ok) {
          setOutlierSummary(await outResp.json());
          setNotice(null);
        } else {
          const text = await outResp.text();

          // If not ready, fall back to showing sample list
          if (isNotReadyYet(outResp.status, text)) {
            const cols = (pcaPayload.columns || []).map((c) => String(c));
            const sampleCol =
              cols.find((c) => c.toLowerCase() === "sample") ||
              cols.find((c) => c.toLowerCase() === "samplename") ||
              cols.find((c) => c.toLowerCase() === "sample_name") ||
              cols.find((c) => c.toLowerCase() === "name") ||
              cols.find((c) => c.toLowerCase() === "file name") ||
              cols.find((c) => c.toLowerCase() === "filename") ||
              "sampleName";

            const uniq = new Set<string>();
            for (const r of pcaPayload.rows || []) {
              const v1 = String((r as any)[sampleCol] ?? "").trim();
              const v2 = pickFirstExistingValue(r, [
                "Sample",
                "sample",
                "sampleName",
                "SampleName",
                "samplename",
                "name",
                "File name",
                "filename",
              ]);
              const s = (v1 || v2 || "").trim();
              if (s) uniq.add(s);
            }

            const rows = Array.from(uniq).map((s) => ({ Sample: s, Suggested: "false" }));
            setOutlierSummary({ columns: ["Sample", "Suggested"], rows });
            setNotice(null);
          } else {
            throw new Error(`Failed to load outlier summary. (${outResp.status}) ${text || ""}`.trim());
          }
        }
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const toggleRemove = (sample: string, checked: boolean) => {
    const s = (sample || "").trim();
    if (!s) return;

    setRemoveSet((prev) => {
      const next = new Set(prev);
      if (checked) next.add(s);
      else next.delete(s);
      return next;
    });
  };

  const saveSelectedOutliers = async () => {
    setSaving(true);
    setError(null);

    try {
      const sid = (sampleId || "").trim();
      const url = buildUrl(API_BASE, `/api/outliers/${encodeURIComponent(sid)}`, getEffectiveUsername(currentUser));

      const suggestedList = suggestionRows.filter((r) => r.Suggested).map((r) => r.Sample);
      const selectedList = Array.from(removeSet);

      const n = Math.max(suggestedList.length, selectedList.length);

      const rows = Array.from({ length: n }, (_, i) => ({
        "Outliers suggested": suggestedList[i] || "",
        "Outliers selected": selectedList[i] || "",
      }));

      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          columns: ["Outliers suggested", "Outliers selected"],
          rows,
        }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Save failed (${resp.status}): ${text || resp.statusText}`);
      }

      setNotice("Saved successfully.");
      window.dispatchEvent(new CustomEvent("bulkmind:selections"));
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const suggestionRows = useMemo(() => {
    if (!outlierSummary) return [];
    return (outlierSummary.rows || [])
      .map((r) => ({
        Sample: pickFirstExistingValue(r, ["Sample", "sample", "sampleName", "SampleName", "samplename", "name"]) || "",
        Suggested: normalizeBool(r["Suggested"] ?? r["suggested"]),
      }))
      .filter((x) => x.Sample);
  }, [outlierSummary]);

  // persist suggestions + selections
  useEffect(() => {
    const suggested = suggestionRows.filter((r) => r.Suggested).map((r) => r.Sample);
    const selected = Array.from(removeSet);

    try {
      localStorage.setItem(LS_OUT_SUGGESTED, JSON.stringify(suggested));
      localStorage.setItem(LS_OUT_SELECTED, JSON.stringify(selected));
    } catch {}

    window.dispatchEvent(new CustomEvent("bulkmind:selections"));
  }, [suggestionRows, removeSet]);

  const ensureDiagnostics = async () => {
    if (diagTable || diagLoading) return;

    const sid = (sampleId || "").trim();
    if (!sid) return;

    setDiagLoading(true);
    try {
      const url = buildUrl(
        API_BASE,
        `/api/analysis/${encodeURIComponent(sid)}/pca-table`,
        getEffectiveUsername(currentUser),
        { kind: "consensus" }
      );

      const resp = await fetch(url, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      });

      if (resp.ok) setDiagTable(await resp.json());
      else setDiagTable(null);
    } catch {
      setDiagTable(null);
    } finally {
      setDiagLoading(false);
    }
  };

  // when PCA kind changes, reload if in ai/manual
  useEffect(() => {
    if (mode === "ai" || mode === "manual") {
      fetchPcaAndSuggestions(mode, pcaKind).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pcaKind]);

  const openPngUrl = buildUrl(
    API_BASE,
    `/api/analysis/${encodeURIComponent(sampleId)}/pca-figure`,
    getEffectiveUsername(currentUser),
    { kind: pcaKind, format: "png" }
  );

  const openPdfUrl =
    pcaKind !== "consensus"
      ? buildUrl(API_BASE, `/api/analysis/${encodeURIComponent(sampleId)}/pca-figure`, getEffectiveUsername(currentUser), {
          kind: pcaKind,
          format: "pdf",
        })
      : null;

  return (
    <div className="p03-wrap">
      <div className="p03-mode-row">
        <button
          className={`p03-pill ${mode === "all" ? "active" : ""}`}
          onClick={async () => {
            await saveOutlierModeToMetadata("Use all samples");
            await ensureOutliersCsvHeaderOnly();
            setMode("all");
          }}
        >
          Use all samples
        </button>

        <span className="p03-or">OR</span>

        <button
          className={`p03-pill ${mode === "ai" ? "active" : ""}`}
          onClick={async () => {
            await saveOutlierModeToMetadata("auto detect outliers");
            setMode("ai");
            fetchPcaAndSuggestions("ai");
          }}
        >
          AI-detect: Auto removal
        </button>

        <span className="p03-or">OR</span>

        <button
          className={`p03-pill ${mode === "manual" ? "active" : ""}`}
          onClick={async () => {
            await saveOutlierModeToMetadata("Select outliers manually");
            setMode("manual");
            fetchPcaAndSuggestions("manual");
          }}
        >
          AI-detect: Manual removal
        </button>
      </div>

      {(notice || error) && (
        <div className="p03-notice">{error ? <div className="p03-error">{error}</div> : notice}</div>
      )}

      <div className="p03-savebar">
        <button className="p03-pill p03-save" onClick={saveSelectedOutliers} disabled={loading || saving || removeSet.size === 0}>
          ✅ Save Outliers
        </button>
        <div className="p03-selected">
          Selected: <span className="p03-selected-value">{removeSet.size}</span>
        </div>

        {(mode === "ai" || mode === "manual") && removeSet.size === 0 && (
          <div className="p03-muted p03-suggestions-footer">
            No outliers selected — click ‘Use all samples’ to continue.
          </div>
        )}
      </div>

      {(mode === "ai" || mode === "manual") && (
        <div id="p03-outlier-content" className="p03-content">
          <div className="p03-grid">
            <div className="p03-card p03-card-left">
              <div className="p03-card-title p03-card-title-row">
                <span>PCA preview</span>
                <div className="p03-pca-actions">
                  <div className="p03-kind-toggle">
                    {(["vsd", "rld", "consensus"] as PcaKind[]).map((k) => (
                      <button key={k} className={`p03-kind-btn ${pcaKind === k ? "on" : ""}`} onClick={() => setPcaKind(k)}>
                        {k.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <div className="p03-open-row">
                    <a className="p03-open-btn" href={openPngUrl} target="_blank" rel="noreferrer">
                      PNG ↗
                    </a>
                    {openPdfUrl && (
                      <a className="p03-open-btn" href={openPdfUrl} target="_blank" rel="noreferrer">
                        PDF ↗
                      </a>
                    )}
                  </div>
                </div>
              </div>

              <div className="p03-figure-wrap">
                {pcaFigureSrc ? (
                  <img key={`${pcaKind}-${figureNonce}`} className="p03-figure" src={pcaFigureSrc} alt="PCA" />
                ) : (
                  <div className="p03-muted">{loading ? "Loading..." : FRIENDLY_NOTICE}</div>
                )}
              </div>
            </div>

            <div className="p03-card p03-card-right">
              <div className="p03-card-title">{mode === "ai" ? "AI Suggestions" : "AI Suggestions/ Manual Review"}</div>

              <div className="p03-table-wrap p03-suggestions-table-wrap">
                <table className="p03-table">
                  <thead>
                    <tr>
                      <th>Sample</th>
                      <th>Suggested</th>
                      <th>Remove</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suggestionRows.map((r) => (
                      <tr key={r.Sample} className={removeSet.has(r.Sample) ? "row-remove" : ""}>
                        <td>{r.Sample}</td>
                        <td>{r.Suggested ? "true" : ""}</td>
                        <td>
                          <input
                            type="checkbox"
                            checked={removeSet.has(r.Sample)}
                            onChange={(e) => toggleRemove(r.Sample, e.target.checked)}
                          />
                        </td>
                      </tr>
                    ))}

                    {suggestionRows.length === 0 && (
                      <tr>
                        <td colSpan={3} className="p03-muted">
                          {FRIENDLY_NOTICE}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="p03-muted p03-suggestions-footer">
                <strong>Note:</strong> true = outlier{mode === "ai" ? ". Samples marked as true will be removed." : ""}
              </div>
            </div>

            <div className="p03-diag-row">
              <button
                className="p03-diag-toggle"
                onClick={async () => {
                  const next = !diagOpen;
                  setDiagOpen(next);
                  if (next) await ensureDiagnostics();
                }}
              >
                <span className="p03-diag-left">
                  <span className="p03-diag-title">Outlier diagnostics</span>
                  <span className="p03-diag-sub">
                    Expanded view shows which methods flagged each sample (ISO / LOF / DBSCAN / Mahalanobis / AE).
                  </span>
                  <span className="p03-diag-src">Source: PCA_with_outliers.csv</span>
                </span>

                <span className="p03-diag-caret" aria-hidden="true">
                  {diagOpen ? "▾" : "▸"}
                </span>
              </button>

              {diagOpen && (
                <div className="p03-diag-panel">
                  {diagLoading ? (
                    <div className="p03-muted">Loading...</div>
                  ) : (
                    <div className="p03-table-wrap p03-diag-table-wrap">
                      <table className="p03-table">
                        <thead>
                          <tr>{(diagTable?.columns || []).map((c) => <th key={c}>{c}</th>)}</tr>
                        </thead>
                        <tbody>
                          {(diagTable?.rows || []).map((r, i) => (
                            <tr key={i}>
                              {(diagTable?.columns || []).map((c) => (
                                <td key={c}>{String(r[c] ?? "")}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default P03OutlierDetection;

