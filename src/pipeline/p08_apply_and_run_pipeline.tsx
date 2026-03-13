import React, { useEffect, useMemo, useRef, useState } from "react";
import "./p08_apply_and_run_pipeline.css";

type HeatmapRow = { pathway: string; genes: string[] };

type Props = {
  apiBaseUrl?: string;
  sampleId?: string;
  currentUser?: string;
  authToken?: string | null;
};

const LS = {
  disease: "bulkmind.diseaseOfInterest",
  volcano: "bulkmind.volcano.selectedComparisons",
  heatmapRows: "bulkmind.heatmaps.rows",
  comparisonsAllFlag: "bulkmind.volcano.isAll",
  noVolcano: "bulkmind.apply.noVolcanoComparisons",
  noDisease: "bulkmind.apply.noDiseaseOfInterest",
  noHeatmap: "bulkmind.apply.noHeatmapPathways",
};

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

function safeGetJson<T>(key: string, fallback: T): T {
  const raw = safeGetLS(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function getBoolLS(key: string): boolean {
  return safeGetLS(key) === "1";
}

function setBoolLS(key: string, value: boolean) {
  safeSetLS(key, value ? "1" : "0");
}

function firstNonEmptyLS(keys: string[]): string {
  for (const key of keys) {
    const value = (safeGetLS(key) || "").trim();
    if (value) return value;
  }
  return "";
}

function getExpectedUploadCountFromLS(): number | null {
  const mode = (safeGetLS("bulkmind.uploadExpectedMode") || "").trim().toLowerCase();
  if (mode !== "expected") return null;

  const raw = (safeGetLS("bulkmind.uploadExpectedCount") || "").trim();
  if (!raw) return null;

  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function getRowValueByCandidates(row: Record<string, any>, candidates: string[]): string {
  const keys = Object.keys(row || {});
  for (const candidate of candidates) {
    const hit = keys.find((k) => k.trim().toLowerCase() === candidate);
    if (hit) {
      const v = String(row[hit] ?? "").trim();
      if (v) return v;
    }
  }
  return "";
}

function normalizeBoolCell(v: any): boolean {
  if (typeof v === "boolean") return v;
  if (v === null || v === undefined) return false;
  const s = String(v).trim().toLowerCase();
  return ["true", "1", "yes", "y", "t", "selected"].includes(s);
}

function getRemovedOutlierNames(outlierRows: Array<Record<string, any>>): Set<string> {
  const removed = new Set<string>();

  for (const row of outlierRows || []) {
    const name = getRowValueByCandidates(row, ["outliers selected"]);
    if (name) removed.add(name);
  }

  return removed;
}

function computeFinalSelectedSamplesFromMetadata(
  metadataRows: Array<Record<string, any>>,
  outlierRows: Array<Record<string, any>>
): number | null {
  if (!Array.isArray(metadataRows) || metadataRows.length === 0) return null;

  const removed = getRemovedOutlierNames(outlierRows);
  let count = 0;

  for (const row of metadataRows) {
    const selectedRaw = getRowValueByCandidates(row, ["selected"]);
    const isSelected = selectedRaw ? normalizeBoolCell(selectedRaw) : true;
    if (!isSelected) continue;

    const sampleName = getRowValueByCandidates(row, [
      "sample name",
      "sample",
      "samplename",
    ]);

    const fileName = getRowValueByCandidates(row, [
      "file name",
      "filename",
    ]);

    if (sampleName && removed.has(sampleName)) continue;
    if (fileName && removed.has(fileName)) continue;

    count += 1;
  }

  return count;
}

function isTruthyCell(value: any): boolean {
  const s = String(value ?? "").trim().toLowerCase();
  return ["true", "1", "yes", "y", "selected"].includes(s);
}

function isBlankishCell(value: any): boolean {
  const s = String(value ?? "").trim().toLowerCase();
  return !s || ["false", "0", "no", "none", "na", "n/a"].includes(s);
}

function findColumnValue(row: Record<string, any>, candidates: string[]): any {
  const keys = Object.keys(row || {});
  for (const candidate of candidates) {
    const hit = keys.find((k) => k.trim().toLowerCase() == candidate);
    if (hit) return row[hit];
  }
  return undefined;
}

function computeFinalSelectedSamples(rows: Array<Record<string, any>>): number | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  return rows.filter((row) => {
    const selectedValue = findColumnValue(row, ["selected"]);
    const outliersSelectedValue = findColumnValue(row, ["outliers selected"]);

    const isSelected = selectedValue === undefined ? true : isTruthyCell(selectedValue);
    const isRemovedAsOutlier =
      outliersSelectedValue === undefined ? false : !isBlankishCell(outliersSelectedValue);

    return isSelected && !isRemovedAsOutlier;
  }).length;
}

function setApplyStatus(
  username: string,
  sampleId: string,
  state: "idle" | "error" | "complete",
  message?: string
) {
  if (!username?.trim() || !sampleId?.trim()) return;

  const key = applyStatusLSKey(username.trim(), sampleId.trim());

  if (state === "idle") {
    safeRemoveLS(key);
  } else {
    safeSetLS(
      key,
      JSON.stringify({
        state,
        message: message || "",
        ts: Date.now(),
      })
    );
  }

  window.dispatchEvent(
    new CustomEvent("bulkmind:apply-status", {
      detail: {
        sampleId,
        username,
        state,
        message: message || "",
      },
    })
  );
}

function downloadFromServer(
  apiBaseUrl: string,
  sampleId: string,
  username: string,
  filename: string
) {
  const base = (apiBaseUrl || "").replace(/\/+$/, "");
  const sid = (sampleId || "").trim();
  const u = (username || "").trim();

  if (!base) {
    alert("Missing apiBaseUrl (cannot download).");
    return;
  }
  if (!sid) {
    alert("Missing sampleId (cannot download).");
    return;
  }
  if (!u) {
    alert("Login required (username missing).");
    return;
  }

  const url = `${base}/api/download/${encodeURIComponent(sid)}/${encodeURIComponent(
    filename
  )}?username=${encodeURIComponent(u)}`;

  window.location.assign(url);
}

function splitCsvLine(line: string): string[] {
  const parts = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
  return parts.map((x) => x.replace(/^"|"$/g, "").replace(/""/g, '"'));
}

type CsvTable = {
  headers: string[];
  rows: string[][];
  totalRows: number;
  shownRows: number;
};

function parseCsvTable(csv: string | null, maxRows = 250): CsvTable {
  if (!csv) return { headers: [], rows: [], totalRows: 0, shownRows: 0 };

  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { headers: [], rows: [], totalRows: 0, shownRows: 0 };

  const headers = splitCsvLine(lines[0]);
  const dataLines = lines.slice(1);

  const totalRows = dataLines.length;
  const shown = Math.min(totalRows, maxRows);

  const rows = dataLines.slice(0, shown).map((line) => splitCsvLine(line));
  return { headers, rows, totalRows, shownRows: shown };
}

function normHeader(s: string) {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

const HIDE_META_COLS = new Set<string>(["databases", "databases for"]);
const META_ONLY_TOP_ROW_COLS = new Set<string>(["disease of interest"]);

type OutliersPayload = {
  columns?: string[];
  rows?: Array<Record<string, any>>;
};

const P08ApplyAndRunPipeline: React.FC<Props> = ({
  apiBaseUrl = "",
  sampleId = "test",
  currentUser,
  authToken,
}) => {
  const base = useMemo(() => apiBaseUrl.replace(/\/+$/, ""), [apiBaseUrl]);

  const [diseaseOfInterest, setDiseaseOfInterest] = useState<string>(
    () => (safeGetLS(LS.disease) || "").trim()
  );
  const [volcanoComparisons, setVolcanoComparisons] = useState<string[]>(
    () => safeGetJson<string[]>(LS.volcano, [])
  );
  const [heatmapRows, setHeatmapRows] = useState<HeatmapRow[]>(
    () => safeGetJson<HeatmapRow[]>(LS.heatmapRows, [])
  );
  const [sampleSpecies, setSampleSpecies] = useState<string>(
    () =>
      firstNonEmptyLS([
        "bulkmind.species",
      ]) || "(none)"
  );
  const [referenceRelease, setReferenceRelease] = useState<string>(
    () =>
      firstNonEmptyLS([
        "bulkmind.release",
      ]) || "(none)"
  );
  const [uploadedFileCount, setUploadedFileCount] = useState<number | null>(
    () => getExpectedUploadCountFromLS()
  );

  const [noVolcanoComparisons, setNoVolcanoComparisons] = useState<boolean>(() => getBoolLS(LS.noVolcano));
  const [noDiseaseOfInterest, setNoDiseaseOfInterest] = useState<boolean>(() => getBoolLS(LS.noDisease));
  const [noHeatmapPathways, setNoHeatmapPathways] = useState<boolean>(() => getBoolLS(LS.noHeatmap));

  const [outlierMode, setOutlierMode] = useState<string>("");
  const [manualOutliersSaved, setManualOutliersSaved] = useState<boolean>(false);
  const [outlierRows, setOutlierRows] = useState<Array<Record<string, any>>>([]);
  const [metadataRows, setMetadataRows] = useState<Array<Record<string, any>>>([]);
  const [metadataRefreshKey, setMetadataRefreshKey] = useState(0);

  const [metaCsv, setMetaCsv] = useState<string | null>(null);
  const [heatCsv, setHeatCsv] = useState<string | null>(null);
  const [volCsv, setVolCsv] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<"info" | "success" | "error">("info");

  const didMountRef = useRef(false);

  useEffect(() => {
    const handler = () => {
      setDiseaseOfInterest((safeGetLS(LS.disease) || "").trim());
      setVolcanoComparisons(safeGetJson<string[]>(LS.volcano, []));
      setHeatmapRows(safeGetJson<HeatmapRow[]>(LS.heatmapRows, []));
      setSampleSpecies(
        firstNonEmptyLS([
          "bulkmind.species",
        ]) || "(none)"
      );
      setReferenceRelease(
        firstNonEmptyLS([
          "bulkmind.release",
        ]) || "(none)"
      );
      setUploadedFileCount(getExpectedUploadCountFromLS());
      setNoVolcanoComparisons(getBoolLS(LS.noVolcano));
      setNoDiseaseOfInterest(getBoolLS(LS.noDisease));
      setNoHeatmapPathways(getBoolLS(LS.noHeatmap));

      if (currentUser?.trim() && sampleId?.trim()) {
        setApplyStatus(currentUser, sampleId, "idle");
      }

      setMetadataRefreshKey((n) => n + 1);
      setStatus(null);
      setStatusType("info");
    };

    window.addEventListener("bulkmind:selections", handler as any);
    return () => window.removeEventListener("bulkmind:selections", handler as any);
  }, [currentUser, sampleId]);

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }

    if (currentUser?.trim() && sampleId?.trim()) {
      setApplyStatus(currentUser, sampleId, "idle");
    }
  }, [currentUser, sampleId]);


  useEffect(() => {
    const loadMetadataRows = async () => {
      const sid = (sampleId || "").trim();
      const user = (currentUser || "").trim();

      setMetadataRows([]);

      if (!base || !sid) return;

      const url = user
        ? `${base}/api/samples/${encodeURIComponent(sid)}/metadata?force_generate=1&username=${encodeURIComponent(user)}`
        : `${base}/api/samples/${encodeURIComponent(sid)}/metadata?force_generate=1`;

      try {
        const res = await fetch(url, {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        });

        if (!res.ok) return;

        const payload = await res.json();
        const rows = Array.isArray((payload as any)?.rows) ? (payload as any).rows : [];
        setMetadataRows(rows);
      } catch {
        setMetadataRows([]);
      }
    };

    loadMetadataRows();
  }, [base, sampleId, currentUser, authToken, metadataRefreshKey]);

  useEffect(() => {
    const loadOutlierState = async () => {
      const sid = (sampleId || "").trim();
      const user = (currentUser || "").trim();

      setOutlierMode("");
      setManualOutliersSaved(false);

      if (!base || !sid || !user) return;

      try {
        const modeUrl = `${base}/api/outliers/${encodeURIComponent(sid)}/mode?username=${encodeURIComponent(user)}`;
        const modeRes = await fetch(modeUrl, {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        });

        if (modeRes.ok) {
          const modeData = await modeRes.json();
          const mode = String((modeData as any)?.mode || "").trim();
          setOutlierMode(mode);
        }

        const outliersUrl = `${base}/api/outliers/${encodeURIComponent(sid)}?username=${encodeURIComponent(user)}`;
        const outliersRes = await fetch(outliersUrl, {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        });

        if (outliersRes.ok) {
          const payload = (await outliersRes.json()) as OutliersPayload;
          const cols = Array.isArray(payload?.columns) ? payload.columns.map(String) : [];
          const rows = Array.isArray(payload?.rows) ? payload.rows : [];
          setOutlierRows(rows);

          const outSelCol =
            cols.find((c) => c.toLowerCase() === "outliers selected") || "Outliers selected";
          const outSugCol =
            cols.find((c) => c.toLowerCase() === "outliers suggested") || "Outliers suggested";

          const hasSavedRows = rows.some((r) => {
            const selected = String((r as any)?.[outSelCol] ?? "").trim();
            const suggested = String((r as any)?.[outSugCol] ?? "").trim();
            return Boolean(selected || suggested);
          });

          setManualOutliersSaved(hasSavedRows);
        }
      } catch {
        setOutlierMode("");
        setManualOutliersSaved(false);
        setOutlierRows([]);
      }
    };

    loadOutlierState();
  }, [base, sampleId, currentUser, authToken]);

  function updateOverride(
    key: string,
    value: boolean,
    setter: React.Dispatch<React.SetStateAction<boolean>>
  ) {
    setter(value);
    setBoolLS(key, value);

    if (currentUser?.trim() && sampleId?.trim()) {
      setApplyStatus(currentUser, sampleId, "idle");
    }
    setStatus(null);
    setStatusType("info");

    window.dispatchEvent(new CustomEvent("bulkmind:selections"));
  }

  async function expandComparisonsIfAll(list: string[]): Promise<string[]> {
    const isAll = (safeGetLS(LS.comparisonsAllFlag) || "") === "1";
    if (!isAll) return list;

    if (!base) return list;
    if (!sampleId?.trim()) return list;

    const url =
      currentUser && currentUser.trim()
        ? `${base}/api/volcano/${encodeURIComponent(sampleId)}/comparisons?username=${encodeURIComponent(
            currentUser
          )}`
        : `${base}/api/volcano/${encodeURIComponent(sampleId)}/comparisons`;

    const res = await fetch(url, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
    });
    if (!res.ok) return list;

    const text = await res.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }

    const arr = Array.isArray(data)
      ? data
      : Array.isArray(data?.comparisons)
      ? data.comparisons
      : [];

    return arr.map(String).filter((x: string) => x && x !== "Select all the comparisons");
  }

  const diseaseIsProvided = useMemo(() => {
    const d = (diseaseOfInterest || "").trim().toLowerCase();
    return Boolean(d && d !== "na" && d !== "(none)");
  }, [diseaseOfInterest]);

  function getMissingSelections() {
    const missing: string[] = [];

    if (!noDiseaseOfInterest && !diseaseIsProvided) {
      missing.push("Missing disease of interest");
    }

    if (!noVolcanoComparisons && (!Array.isArray(volcanoComparisons) || volcanoComparisons.length === 0)) {
      missing.push("Missing volcano comparisons");
    }

    if (!noHeatmapPathways && (!Array.isArray(heatmapRows) || heatmapRows.length === 0)) {
      missing.push("Missing heatmap pathway selection");
    }

    const outMode = (outlierMode || "").trim().toLowerCase();
    if (!outMode) {
      missing.push("Missing outlier detection selection");
    } else if (outMode === "select outliers manually" && !manualOutliersSaved) {
      missing.push("Outlier detection is set to manual review, but the selection has not been saved yet");
    }

    return missing;
  }

  const handleApply = async () => {
    if (!base) {
      setStatusType("error");
      setStatus("Missing apiBaseUrl.");
      return;
    }

    if (!currentUser || !currentUser.trim()) {
      setStatusType("error");
      setStatus("Login first (currentUser missing).");
      return;
    }

    const missing = getMissingSelections();
    if (missing.length > 0) {
      const msg = missing.join(" • ");
      setStatusType("error");
      setStatus(msg);
      setApplyStatus(currentUser, sampleId, "error", msg);
      return;
    }

    setLoading(true);
    setStatus(null);

    setMetaCsv(null);
    setHeatCsv(null);
    setVolCsv(null);

    try {
      const comps = noVolcanoComparisons ? [] : await expandComparisonsIfAll(volcanoComparisons);

      const payload = {
        disease_of_interest: noDiseaseOfInterest ? "" : diseaseOfInterest || "",
        volcano_comparisons: comps || [],
        heatmap_rows: noHeatmapPathways
          ? []
          : (heatmapRows || []).map((r) => ({
              pathway: r.pathway || "",
              genes: Array.isArray(r.genes) ? r.genes : [],
            })),
      };

      const url = `${base}/api/apply-selections/${encodeURIComponent(
        sampleId
      )}?username=${encodeURIComponent(currentUser)}`;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      if (!res.ok) throw new Error(`${res.status} ${text || ""}`.trim());

      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {};
      }

      const previewMeta = String(data?.previews?.sample_metadata_csv || "");
      const previewHeat = String(data?.previews?.pathways_forheatmaps_csv || "");
      const previewVol = String(data?.previews?.volcanoplots_csv || "");

      setMetaCsv(previewMeta);
      setHeatCsv(previewHeat);
      setVolCsv(previewVol);

      const missingCsvs: string[] = [];
      if (!previewMeta.trim()) missingCsvs.push("sample_metadata.csv");
      if (!noHeatmapPathways && !previewHeat.trim()) missingCsvs.push("pathways_forheatmaps.csv");
      if (!noVolcanoComparisons && !previewVol.trim()) missingCsvs.push("volcanoplots.csv");

      if (missingCsvs.length > 0) {
        const msg = `Selections were sent, but these helper CSV files were not returned: ${missingCsvs.join(
          ", "
        )}`;
        setStatusType("error");
        setStatus(msg);
        setApplyStatus(currentUser, sampleId, "error", msg);
        return;
      }

      const okMsg =
        "Selections applied successfully. All required helper CSV files were created and previewed below.";
      setStatusType("success");
      setStatus(okMsg);
      setApplyStatus(currentUser, sampleId, "complete", okMsg);
    } catch (e: any) {
      const msg = e?.message || String(e) || "Could not apply selections.";
      setStatusType("error");
      setStatus(msg);
      setApplyStatus(currentUser, sampleId, "error", msg);
    } finally {
      setLoading(false);
    }
  };

  const metaTable = useMemo(() => parseCsvTable(metaCsv, 250), [metaCsv]);
  const heatTable = useMemo(() => parseCsvTable(heatCsv, 400), [heatCsv]);
  const volTable = useMemo(() => parseCsvTable(volCsv, 250), [volCsv]);

  const renderStandardTable = (
    table: CsvTable,
    tableKey: string,
    opts?: { hideCols?: Set<string>; onlyTopRowCols?: Set<string> }
  ) => {
    if (!table.headers.length) return <div className="empty">No data.</div>;

    const hideCols = opts?.hideCols ?? new Set<string>();
    const onlyTopRowCols = opts?.onlyTopRowCols ?? new Set<string>();

    const visibleColIdxs: number[] = [];
    const visibleHeaders: string[] = [];
    const visibleHeaderNorms: string[] = [];

    table.headers.forEach((h, idx) => {
      const nh = normHeader(h);
      if (hideCols.has(nh)) return;
      visibleColIdxs.push(idx);
      visibleHeaders.push(h);
      visibleHeaderNorms.push(nh);
    });

    return (
      <>
        {table.totalRows > table.shownRows && (
          <div className="note">
            Showing first <b>{table.shownRows}</b> of <b>{table.totalRows}</b> rows (preview).
          </div>
        )}

        <div className="metadata-table-wrapper" tabIndex={0}>
          <table className="excel-table">
            <colgroup>
              {visibleHeaders.map((_, i) => (
                <col key={`${tableKey}-col-${i}`} className="col-mid" />
              ))}
            </colgroup>

            <thead>
              <tr>
                {visibleHeaders.map((h, i) => (
                  <th key={`${tableKey}-h-${i}`}>
                    <div className="th-wrap">
                      <div className="th-title">{h}</div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {table.rows.map((row, ridx) => (
                <tr key={`${tableKey}-r-${ridx}`}>
                  {visibleColIdxs.map((origIdx, visIdx) => {
                    const hNorm = visibleHeaderNorms[visIdx];
                    let value = row?.[origIdx] ?? "";

                    if (onlyTopRowCols.has(hNorm) && ridx > 0) value = "";

                    return (
                      <td key={`${tableKey}-c-${ridx}-${visIdx}`} className="grid-cell">
                        <div className="cell-text">{value}</div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  };

  const renderMetaTable = (table: CsvTable) => {
    if (!table.headers.length) return <div className="empty">No data.</div>;

    const keepHeaders = table.headers.filter((h) => !HIDE_META_COLS.has(normHeader(h)));
    const headerIndexMap = new Map<string, number>();
    keepHeaders.forEach((h) => headerIndexMap.set(normHeader(h), table.headers.findIndex((x) => x === h)));

    const idxFor = (headerName: string) => headerIndexMap.get(normHeader(headerName)) ?? -1;

    const colIdx = {
      selected: idxFor("selected"),
      fileName: idxFor("file name"),
      sampleName: idxFor("sample name"),
      group: idxFor("group"),
      condition: idxFor("condition/treatment"),
      soi: idxFor("sample of interest"),
      rcp: idxFor("respective counter part"),
      outliers: idxFor("outliers"),
      disease: idxFor("disease of interest"),
      outSuggested: idxFor("outliers suggested"),
      outSelected: idxFor("outliers selected"),
    };

    const getVal = (row: string[], idx: number, ridx: number) => {
      if (idx < 0) return "";
      let value = row?.[idx] ?? "";
      const h = table.headers[idx];
      if (META_ONLY_TOP_ROW_COLS.has(normHeader(h)) && ridx > 0) value = "";
      return value;
    };

    return (
      <>
        {table.totalRows > table.shownRows && (
          <div className="note">
            Showing first <b>{table.shownRows}</b> of <b>{table.totalRows}</b> rows (preview).
          </div>
        )}

        <div className="metadata-table-wrapper" tabIndex={0}>
          <table className="excel-table meta-like-step2">
            <colgroup>
              <col className="col-selected" />
              <col className="col-mid" />
              <col className="col-mid" />
              <col className="col-small" />
              <col className="col-mid" />
              <col className="col-mid" />
              <col className="col-mid" />
              <col className="col-small" />
              <col className="col-small" />
              <col className="col-small" />
              <col className="col-small" />
            </colgroup>

            <thead>
              <tr>
                <th rowSpan={2} className="center">SELECTED</th>
                <th rowSpan={2} className="center">FILE NAME</th>

                <th rowSpan={2} className="center">
                  <div className="th-wrap">
                    <div className="th-title">SAMPLE NAME</div>
                    <div className="th-sub">(Letters, numbers, and "_" only)</div>
                  </div>
                </th>

                <th rowSpan={2} className="center">
                  <div className="th-wrap">
                    <div className="th-title">GROUP*</div>
                    <div className="th-sub">(NA = exclude from comparisons)</div>
                  </div>
                </th>

                <th rowSpan={2} className="center">
                  <div className="th-wrap">
                    <div
                      className="th-title"
                      dangerouslySetInnerHTML={{ __html: "CONDITION/<br />TREATMENT*" }}
                    />
                    <div className="th-sub">(NA = exclude from comparisons)</div>
                  </div>
                </th>

                <th colSpan={2} className="center">Comparisons</th>

                <th rowSpan={2} className="center">
                  <div className="th-wrap">
                    <div className="th-title">OUTLIERS</div>
                    <div className="th-sub">(More details in<br />Step 3)</div>
                  </div>
                </th>

                <th rowSpan={2} className="center">
                  <div className="th-wrap">
                    <div className="th-title">DISEASE OF INTEREST</div>
                    <div className="th-sub">(More details in<br />Step 4)</div>
                  </div>
                </th>

                <th rowSpan={2} className="center">
                  <div className="th-wrap">
                    <div className="th-title">OUTLIERS</div>
                    <div className="th-sub">SUGGESTED</div>
                  </div>
                </th>

                <th rowSpan={2} className="center">
                  <div className="th-wrap">
                    <div className="th-title">OUTLIERS</div>
                    <div className="th-sub">SELECTED</div>
                  </div>
                </th>
              </tr>

              <tr>
                <th className="center">
                  <div className="th-wrap">
                    <div className="th-title">SAMPLE OF INTEREST</div>
                    <div className="th-sub">(Group-Condition)</div>
                  </div>
                </th>

                <th className="center">
                  <div className="th-wrap">
                    <div className="th-title">RESPECTIVE COUNTER PART</div>
                    <div className="th-sub">(Group-Condition)</div>
                  </div>
                </th>
              </tr>
            </thead>

            <tbody>
              {table.rows.map((row, ridx) => (
                <tr key={`meta-r-${ridx}`}>
                  <td className="grid-cell"><div className="cell-text">{getVal(row, colIdx.selected, ridx)}</div></td>
                  <td className="grid-cell"><div className="cell-text">{getVal(row, colIdx.fileName, ridx)}</div></td>
                  <td className="grid-cell"><div className="cell-text">{getVal(row, colIdx.sampleName, ridx)}</div></td>
                  <td className="grid-cell"><div className="cell-text">{getVal(row, colIdx.group, ridx)}</div></td>
                  <td className="grid-cell"><div className="cell-text">{getVal(row, colIdx.condition, ridx)}</div></td>
                  <td className="grid-cell"><div className="cell-text">{getVal(row, colIdx.soi, ridx)}</div></td>
                  <td className="grid-cell"><div className="cell-text">{getVal(row, colIdx.rcp, ridx)}</div></td>
                  <td className="grid-cell"><div className="cell-text">{getVal(row, colIdx.outliers, ridx)}</div></td>
                  <td className="grid-cell"><div className="cell-text">{getVal(row, colIdx.disease, ridx)}</div></td>
                  <td className="grid-cell"><div className="cell-text">{getVal(row, colIdx.outSuggested, ridx)}</div></td>
                  <td className="grid-cell"><div className="cell-text">{getVal(row, colIdx.outSelected, ridx)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  };

  const diseaseSummaryValue = noDiseaseOfInterest
    ? "Skipped by user"
    : diseaseIsProvided
    ? diseaseOfInterest
    : "(none)";

  const volcanoSummaryValue = noVolcanoComparisons
    ? "Skipped by user"
    : volcanoComparisons.length
    ? volcanoComparisons.join("; ")
    : "(none)";

  const heatmapSummaryValue = noHeatmapPathways
    ? "Skipped by user"
    : heatmapRows.length
    ? `${heatmapRows.length} pathway row(s)`
    : "(none)";

  const fileCountSummaryValue =
    metadataRows.length > 0
      ? String(metadataRows.length)
      : uploadedFileCount !== null
      ? String(uploadedFileCount)
      : "(not specified)";

  const finalSelectedSamplesValue = (() => {
    const n = computeFinalSelectedSamplesFromMetadata(metadataRows, outlierRows);
    return n !== null ? String(n) : "(unknown)";
  })();

  return (
    <section className="p08-apply">
      <div className="card">
        <h3 className="title">Apply selections before final run</h3>
        <div className="summary-grid summary-grid--paired">
          <div className="summary-stack">
            <div className="summary-item">
              <div className="label">Sample</div>
              <div className="value">{sampleId}</div>
            </div>

            <div className="summary-item">
              <div className="label">Disease of interest</div>
              <div className="value">{diseaseSummaryValue}</div>
            </div>
          </div>

          <div className="summary-stack">
            <div className="summary-item">
              <div className="label">Sample species</div>
              <div className="value">{sampleSpecies}</div>
            </div>

            <div className="summary-item">
              <div className="label">Volcano comparisons</div>
              <div className="value">{volcanoSummaryValue}</div>
            </div>
          </div>

          <div className="summary-stack">
            <div className="summary-item">
              <div className="label">Mapping to reference genome release</div>
              <div className="value">{referenceRelease}</div>
            </div>

            <div className="summary-item">
              <div className="label">Heatmap pathways</div>
              <div className="value">{heatmapSummaryValue}</div>
            </div>
          </div>

          <div className="summary-stack">
            <div className="summary-item">
              <div className="label">Uploaded number of files</div>
              <div className="value">{fileCountSummaryValue}</div>
            </div>

            <div className="summary-item">
              <div className="label">Outlier detection</div>
              <div className="value">{outlierMode || "(none)"}</div>
            </div>
          </div>

          <div className="summary-stack">
            <div className="summary-item">
              <div className="label">Final selected samples</div>
              <div className="value">{finalSelectedSamplesValue}</div>
            </div>

            <div className="summary-item summary-item--empty" aria-hidden="true">
              <div className="label">&nbsp;</div>
              <div className="value">&nbsp;</div>
            </div>
          </div>
        </div>

        <div className="override-row">
          <label>
            <input
              type="checkbox"
              checked={noVolcanoComparisons}
              onChange={(e) => updateOverride(LS.noVolcano, e.target.checked, setNoVolcanoComparisons)}
            />
            <span>No volcano comparisons</span>
          </label>

          <label>
            <input
              type="checkbox"
              checked={noDiseaseOfInterest}
              onChange={(e) => updateOverride(LS.noDisease, e.target.checked, setNoDiseaseOfInterest)}
            />
            <span>No disease of interest</span>
          </label>

          <label>
            <input
              type="checkbox"
              checked={noHeatmapPathways}
              onChange={(e) => updateOverride(LS.noHeatmap, e.target.checked, setNoHeatmapPathways)}
            />
            <span>No heatmap pathways</span>
          </label>
        </div>

        <div className="actions">
          <button type="button" onClick={handleApply} disabled={loading} className="btn bm-blue">
            {loading ? "Applying…" : "Apply selections"}
          </button>
        </div>

        {status && <div className={`msg ${statusType}`}>{status}</div>}
      </div>

      {metaCsv && (
        <div className="block">
          <div className="block-head">
            <h4>Sample Metadata</h4>
            <button
              type="button"
              className="btn bm-ghost"
              onClick={() =>
                downloadFromServer(apiBaseUrl, sampleId || "", currentUser || "", "sample_metadata.csv")
              }
            >
              Download sample_metadata.csv
            </button>
          </div>

          {renderMetaTable(metaTable)}
        </div>
      )}

      {!noHeatmapPathways && heatCsv && (
        <div className="block">
          <div className="block-head">
            <h4>Pathways Forheatmaps</h4>
            <button
              type="button"
              className="btn bm-ghost"
              onClick={() =>
                downloadFromServer(apiBaseUrl, sampleId || "", currentUser || "", "pathways_forheatmaps.csv")
              }
            >
              Download pathways_forheatmaps.csv
            </button>
          </div>

          {renderStandardTable(heatTable, "heat")}
        </div>
      )}

      {!noVolcanoComparisons && volCsv && (
        <div className="block">
          <div className="block-head">
            <h4>Volcanoplots</h4>
            <button
              type="button"
              className="btn bm-ghost"
              onClick={() =>
                downloadFromServer(apiBaseUrl, sampleId || "", currentUser || "", "volcanoplots.csv")
              }
            >
              Download volcanoplots.csv
            </button>
          </div>

          {renderStandardTable(volTable, "vol")}
        </div>
      )}
    </section>
  );
};

export default P08ApplyAndRunPipeline;
