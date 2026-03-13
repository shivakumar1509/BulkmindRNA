import React, { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE as DEFAULT_API_BASE } from "../api/client";
import "./p02_sample_metadata.css";

type MetadataRow = { [column: string]: any };
interface MetadataPayload {
  columns: string[];
  rows: MetadataRow[];
  source?: string;
  raw_proj_dir?: string;
  csv_path?: string | null;
}

type ValidateResponse = {
  errors: string[];
  warnings: string[];
  rows_saved?: number;
  csv_path?: string;
};

type Props = {
  apiBaseUrl?: string;
  sampleId?: string;
  currentUser?: string;
  authToken?: string | null;
};

const DEFAULT_SAMPLE_ID = "test";
const LS_SAMPLE_ID = "bulkmind.sampleId";

const CANON_EXT_RE = /\.(fastq|fq|ora|bam|cram)(\.gz)?$/i;

const OUTLIER_OPTIONS = [
  "Use all samples",
  "Auto-detect outliers",
  "Select outliers manually",
] as const;

type OutlierOption = (typeof OUTLIER_OPTIONS)[number];

// Grid columns (Excel-like selection/copy/paste)
// NOTE: SR. NO. and ACTIONS are not part of the copy/paste grid.
const GRID_COLS = [
  { key: "selected", kind: "bool" as const },
  { key: "File Name", kind: "text" as const },
  { key: "Sample Name", kind: "text" as const },
  { key: "group", kind: "text" as const },
  { key: "condition/treatment", kind: "text" as const },
  { key: "Sample of interest", kind: "text" as const },
  { key: "Respective Counter part", kind: "text" as const },
  { key: "Outliers", kind: "outliers" as const },
  { key: "Disease of Interest", kind: "text" as const },
] as const;

function canonicalPrefix(input: string): string {
  let x = (input || "").trim();
  if (!x) return "";

  x = x.split(/[\\/]/).pop() || x;
  x = x.replace(CANON_EXT_RE, "");

  x = x.replace(/(?:^|[._-])(trimmed|trim)(?:$|[._-])/gi, ".");
  x = x.replace(/[._-]{2,}/g, ".").replace(/^[._-]+|[._-]+$/g, "");

  x = x.replace(/(?:[._-]?)(?:R|read)([12])(?:[._-]?\d+)?$/i, "");
  x = x.replace(/(.+)[._-]([12])$/i, "$1");

  return x.trim();
}

function dedupeRowsByPrefix(rows: any[]): any[] {
  const out: any[] = [];
  const seen = new Set<string>();

  for (const r of rows || []) {
    const rawFile = String(r?.["File Name"] ?? "");
    const canon = canonicalPrefix(rawFile);
    if (!canon) continue;

    const key = canon.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const rawSample = String(r?.["Sample Name"] ?? "").trim();
    const sampleCanon = rawSample ? rawSample : canon;

    out.push({
      ...r,
      "File Name": canon,
      "Sample Name": sampleCanon || canon,
    });
  }
  return out;
}

function normalizeOutliersValue(v: any): OutlierOption {
  const s = String(v ?? "").trim();
  if ((OUTLIER_OPTIONS as readonly string[]).includes(s)) return s as OutlierOption;
  return "Use all samples";
}

/** ✅ Outliers only stored on first row */
function enforceOutliersFirstRowOnly(rows: MetadataRow[]): MetadataRow[] {
  return (rows || []).map((r, idx) => {
    const next = { ...r };
    if (idx === 0) next["Outliers"] = normalizeOutliersValue(next["Outliers"]);
    else next["Outliers"] = "";
    return next;
  });
}

// ✅ Sample Name rule: only letters, numbers, underscore
const SAMPLE_NAME_ALLOWED_RE = /^[A-Za-z0-9_]*$/;
function isValidSampleName(s: string): boolean {
  return SAMPLE_NAME_ALLOWED_RE.test(String(s ?? ""));
}

// ✅ Paste sanitizer (kept as requested): remove spaces, convert '-' to '_', replace anything else invalid with '_'
function sanitizeSampleNamePaste(s: string): { value: string; changed: boolean } {
  const incoming = String(s ?? "");
  const cleaned = incoming
    .trim()
    .replace(/\s+/g, "")
    .replace(/-/g, "_")
    .replace(/[^A-Za-z0-9_]/g, "_");
  return { value: cleaned, changed: cleaned !== incoming };
}

const P02SampleMetadata: React.FC<Props> = ({
  apiBaseUrl,
  sampleId: sampleIdProp,
  currentUser,
  authToken,
}) => {
  const base = useMemo(() => {
    const raw = (apiBaseUrl || DEFAULT_API_BASE || "").toString();
    return raw.replace(/\/+$/, "");
  }, [apiBaseUrl]);

  const [sampleId, setSampleId] = useState<string>(sampleIdProp || DEFAULT_SAMPLE_ID);

  const [data, setData] = useState<MetadataPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // ✅ Paste warnings (one-line)
  const [uiWarnings, setUiWarnings] = useState<string[]>([]);

  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);

  // ✅ per-cell inline errors
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});

  const loggedIn = !!(currentUser && currentUser.trim().length > 0);

  useEffect(() => {
    if (sampleIdProp && sampleIdProp.trim()) {
      setSampleId(sampleIdProp.trim());
      return;
    }
    try {
      const saved = window.localStorage.getItem(LS_SAMPLE_ID);
      if (saved && saved.trim()) setSampleId(saved.trim());
    } catch {
      // ignore
    }
  }, [sampleIdProp]);

  useEffect(() => {
    const handler = (ev: any) => {
      const next = ev?.detail?.sampleId;
      if (next && String(next).trim()) setSampleId(String(next).trim());
    };
    window.addEventListener("bulkmind:state", handler as any);
    return () => window.removeEventListener("bulkmind:state", handler as any);
  }, []);

  const isBooleanColumn = (col: string) => col.toLowerCase() === "selected";

  const normalizeBoolean = (value: any): boolean => {
    if (typeof value === "boolean") return value;
    if (value === null || value === undefined) return false;
    const v = String(value).trim().toLowerCase();
    return ["true", "1", "yes", "y", "t"].includes(v);
  };

  const authHeaders = authToken ? { Authorization: `Bearer ${authToken}` } : undefined;

  const buildUrl = (path: string) => {
    if (!base) return "";
    const clean = path.startsWith("/") ? path : `/${path}`;
    const full = `${base}${clean}`;
    if (loggedIn) {
      const sep = full.includes("?") ? "&" : "?";
      return `${full}${sep}username=${encodeURIComponent(currentUser!.trim())}`;
    }
    return full;
  };

  const buildMetadataUrl = () =>
    buildUrl(`/api/samples/${encodeURIComponent(sampleId)}/metadata?force_generate=1`);
  const buildValidateUrl = () =>
    buildUrl(`/api/samples/${encodeURIComponent(sampleId)}/metadata/validate`);
  const buildUploadCsvUrl = () =>
    buildUrl(`/api/samples/${encodeURIComponent(sampleId)}/metadata/upload_csv`);

  // -----------------------------
  // ✅ Excel-like selection/copy/paste state
  // -----------------------------
  type CellPos = { r: number; c: number }; // c is GRID_COLS index (0..8)
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const [active, setActive] = useState<CellPos>({ r: 0, c: 0 });
  const [selA, setSelA] = useState<CellPos | null>(null);
  const [selB, setSelB] = useState<CellPos | null>(null);

  const tableRows = data?.rows || [];
  const rowCount = tableRows.length;
  const colCount = GRID_COLS.length;

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  function normRange(a: CellPos, b: CellPos) {
    const r1 = Math.min(a.r, b.r);
    const r2 = Math.max(a.r, b.r);
    const c1 = Math.min(a.c, b.c);
    const c2 = Math.max(a.c, b.c);
    return { r1, r2, c1, c2 };
  }

  const selection =
    selA && selB
      ? normRange(selA, selB)
      : { r1: active.r, r2: active.r, c1: active.c, c2: active.c };

  const isCellSelected = (r: number, c: number) =>
    r >= selection.r1 && r <= selection.r2 && c >= selection.c1 && c <= selection.c2;

  const isCellActive = (r: number, c: number) => r === active.r && c === active.c;

  const cellKey = (r: number, c: number) => `${r}-${c}`;
  const clearCellError = (r: number, c: number) => {
    const k = cellKey(r, c);
    setCellErrors((prev) => {
      if (!prev[k]) return prev;
      const next = { ...prev };
      delete next[k];
      return next;
    });
  };
  const setCellError = (r: number, c: number, msg: string) => {
    const k = cellKey(r, c);
    setCellErrors((prev) => ({ ...prev, [k]: msg }));
  };

  const getCellValue = (r: number, c: number) => {
    const colKey = GRID_COLS[c].key;
    const row = tableRows[r] || {};
    if (colKey === "Disease of Interest") return row["Disease of Interest"] ?? row["Disease"] ?? "";
    return row[colKey] ?? "";
  };

  const beginSelect = (r: number, c: number) => {
    setActive({ r, c });
    setSelA({ r, c });
    setSelB({ r, c });
    draggingRef.current = true;
    wrapperRef.current?.focus();
  };

  const extendSelect = (r: number, c: number) => {
    if (!draggingRef.current) return;
    setSelB({ r, c });
  };

  useEffect(() => {
    const up = () => (draggingRef.current = false);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  const onCopyCapture = (e: React.ClipboardEvent) => {
    if (!data || rowCount === 0) return;

    e.preventDefault();

    const { r1, r2, c1, c2 } = selection;
    const lines: string[] = [];

    for (let r = r1; r <= r2; r++) {
      const rowVals: string[] = [];
      for (let c = c1; c <= c2; c++) {
        rowVals.push(String(getCellValue(r, c) ?? ""));
      }
      lines.push(rowVals.join("\t"));
    }

    e.clipboardData.setData("text/plain", lines.join("\n"));
  };

  // ✅ Build dropdown combo list from live rows (instant, before Validate)
  const comboOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of tableRows) {
      const g = String(r?.["group"] ?? "").trim();
      const t = String(r?.["condition/treatment"] ?? "").trim();
      if (!g || !t) continue;
      set.add(`${g}-${t}`);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tableRows]);

  const makeOptionsWithCurrent = (current: string) => {
    const cur = String(current ?? "").trim();
    if (cur && !comboOptions.includes(cur)) return [cur, ...comboOptions];
    return comboOptions;
  };

  // ✅ Pure “set cell” logic used for bulk paste (no setState inside)
  const applyCellValueToRow = (
    row: MetadataRow,
    rowIndex: number,
    gridColIndex: number,
    rawValue: any,
    sampleNameSanitizedCount: { n: number }
  ) => {
    const colKey = GRID_COLS[gridColIndex].key;
    const newRow = { ...row };

    if (colKey === "File Name") {
      const v = canonicalPrefix(String(rawValue || ""));
      newRow["File Name"] = v;
      if (!String(newRow["Sample Name"] ?? "").trim()) newRow["Sample Name"] = v;
      return newRow;
    }

    if (colKey === "Sample Name") {
      const { value: cleaned, changed } = sanitizeSampleNamePaste(String(rawValue ?? ""));
      if (changed) sampleNameSanitizedCount.n += 1;
      newRow["Sample Name"] = cleaned;
      return newRow;
    }

    if (colKey === "Outliers") {
      if (rowIndex === 0) newRow["Outliers"] = normalizeOutliersValue(rawValue);
      return newRow;
    }

    if (colKey === "Disease of Interest") {
      newRow["Disease of Interest"] = String(rawValue ?? "");
      return newRow;
    }

    if (colKey === "Sample of interest") {
      newRow["Sample of interest"] = String(rawValue ?? "").trim();
      return newRow;
    }

    if (colKey === "Respective Counter part") {
      newRow["Respective Counter part"] = String(rawValue ?? "").trim();
      return newRow;
    }

    if (colKey.toLowerCase() === "selected") {
      const s = String(rawValue ?? "").trim().toLowerCase();
      newRow["selected"] = ["true", "1", "yes", "y", "t"].includes(s);
      return newRow;
    }

    newRow[colKey] = rawValue;
    return newRow;
  };

  // ✅ FIXED paste: batch update + paste starts at selection top-left (Excel behavior)
  const onPasteCapture = (e: React.ClipboardEvent) => {
    if (!data || rowCount === 0) return;

    const text = e.clipboardData.getData("text/plain");
    if (!text) return;

    e.preventDefault();
    setUiWarnings([]);

    const rows = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const matrix = rows.map((line) => line.split("\t"));

    const startR = clamp(selection.r1, 0, rowCount - 1);
    const startC = clamp(selection.c1, 0, colCount - 1);

    const newRows = [...data.rows];
    const sanitizedCount = { n: 0 };

    for (let i = 0; i < matrix.length; i++) {
      const rr = startR + i;
      if (rr >= rowCount) break;

      for (let j = 0; j < matrix[i].length; j++) {
        const cc = startC + j;
        if (cc >= colCount) break;

        clearCellError(rr, cc);
        newRows[rr] = applyCellValueToRow(newRows[rr] ?? {}, rr, cc, matrix[i][j], sanitizedCount);
      }
    }

    const enforced = enforceOutliersFirstRowOnly(newRows);
    setData({ ...data, rows: enforced });

    if (sanitizedCount.n > 0) {
      setUiWarnings([
        `Sample Name auto-corrected in ${sanitizedCount.n} row(s) (spaces removed, '-' → '_').`,
      ]);
      setMessage("Paste completed. Some Sample Name values were auto-corrected.");
    } else {
      setUiWarnings([]);
    }

    const endR = clamp(startR + matrix.length - 1, 0, rowCount - 1);
    const endC = clamp(startC + (matrix[0]?.length ?? 1) - 1, 0, colCount - 1);
    setSelA({ r: startR, c: startC });
    setSelB({ r: endR, c: endC });
    setActive({ r: startR, c: startC });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (rowCount === 0) return;

    const move = (dr: number, dc: number) => {
      const nr = clamp(active.r + dr, 0, rowCount - 1);
      const nc = clamp(active.c + dc, 0, colCount - 1);

      setActive({ r: nr, c: nc });

      if (e.shiftKey) {
        if (!selA) setSelA(active);
        setSelB({ r: nr, c: nc });
      } else {
        setSelA({ r: nr, c: nc });
        setSelB({ r: nr, c: nc });
      }
    };

    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        move(-1, 0);
        break;
      case "ArrowDown":
        e.preventDefault();
        move(1, 0);
        break;
      case "ArrowLeft":
        e.preventDefault();
        move(0, -1);
        break;
      case "ArrowRight":
        e.preventDefault();
        move(0, 1);
        break;
      default:
        break;
    }
  };

  const selectWholeColumn = (gridColIndex: number) => {
    if (rowCount === 0) return;
    const c = clamp(gridColIndex, 0, colCount - 1);
    setActive({ r: 0, c });
    setSelA({ r: 0, c });
    setSelB({ r: rowCount - 1, c });
    wrapperRef.current?.focus();
  };

  // -----------------------------
  // Existing fetch/validate/upload logic
  // -----------------------------
  const fetchMetadata = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    setUiWarnings([]);
    setValidationErrors([]);
    setValidationWarnings([]);
    setCellErrors({});

    const url = buildMetadataUrl();
    if (!url) {
      setLoading(false);
      setError("API base URL is not configured.");
      return;
    }
    if (!loggedIn) {
      setLoading(false);
      setError("Please log in first (username is required).");
      return;
    }

    try {
      const resp = await fetch(url, { headers: authHeaders });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Failed to load metadata (${resp.status}): ${text || resp.statusText}`);
      }

      const payload: MetadataPayload = await resp.json();

      let normalizedRows = (payload.rows || []).map((row) => {
        const newRow: MetadataRow = { ...row };
        (payload.columns || []).forEach((col) => {
          if (isBooleanColumn(col)) newRow[col] = normalizeBoolean(newRow[col]);
        });

        if (newRow["File Name"]) newRow["File Name"] = canonicalPrefix(String(newRow["File Name"]));
        // Sample Name: keep as-is (don’t canonicalPrefix)
        if (newRow["Sample Name"]) newRow["Sample Name"] = String(newRow["Sample Name"]);

        return newRow;
      });

      normalizedRows = dedupeRowsByPrefix(normalizedRows);
      normalizedRows = enforceOutliersFirstRowOnly(normalizedRows);

      setData({ columns: payload.columns || [], rows: normalizedRows });
      setMessage(`Generated metadata (${normalizedRows.length} rows).`);

      setActive({ r: 0, c: 0 });
      setSelA({ r: 0, c: 0 });
      setSelB({ r: 0, c: 0 });
    } catch (err: any) {
      setError(err?.message ?? String(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleCellChange = (rowIndex: number, column: string, value: any) => {
    if (!data) return;

    setError(null);

    // ✅ Sample Name typing is strict (allows "__") and DOES NOT canonicalPrefix
    if (column === "Sample Name") {
      const incoming = String(value ?? "");

      if (!isValidSampleName(incoming)) {
        setCellError(rowIndex, 2, "Only letters, numbers and _ allowed");
        setMessage(null);
        return; // reject typing
      }

      clearCellError(rowIndex, 2);

      const updatedRows = data.rows.map((row, idx) => {
        if (idx !== rowIndex) return row;
        return { ...row, "Sample Name": incoming }; // keep exactly as typed
      });

      const enforced = enforceOutliersFirstRowOnly(updatedRows);
      setData({ ...data, rows: enforced });
      return;
    }

    const updatedRows = data.rows.map((row, idx) => {
      if (idx !== rowIndex) return row;
      const newRow = { ...row };

      if (column === "File Name") {
        newRow[column] = canonicalPrefix(String(value || ""));
        if (!String(newRow["Sample Name"] ?? "").trim()) newRow["Sample Name"] = newRow[column];
      } else if (column === "Outliers") {
        if (rowIndex === 0) newRow[column] = normalizeOutliersValue(value);
      } else if (column === "Disease of Interest") {
        newRow[column] = value;
      } else if (column === "Sample of interest") {
        newRow[column] = String(value ?? "").trim();
      } else if (column === "Respective Counter part") {
        newRow[column] = String(value ?? "").trim();
      } else {
        newRow[column] = isBooleanColumn(column) ? Boolean(value) : value;
      }

      return newRow;
    });

    const enforced = enforceOutliersFirstRowOnly(updatedRows);
    setData({ ...data, rows: enforced });
  };

  const handleAddRow = () => {
    if (!data) return;

    const cols = data.columns || [];
    const emptyRow: MetadataRow = {};
    cols.forEach((c) => {
      if (c === "selected") emptyRow[c] = true;
      else if (c === "Outliers") emptyRow[c] = "";
      else emptyRow[c] = "";
    });

    const nextRows = [...data.rows, emptyRow];
    const enforced = enforceOutliersFirstRowOnly(nextRows);
    setData({ ...data, rows: enforced });
  };

  const handleDeleteRow = (rowIndex: number) => {
    if (!data) return;

    const updatedRows = data.rows.filter((_, idx) => idx !== rowIndex);
    const enforced = enforceOutliersFirstRowOnly(updatedRows);
    setData({ ...data, rows: enforced });

    // shift cell errors
    setCellErrors((prev) => {
      const next: Record<string, string> = {};
      for (const k of Object.keys(prev)) {
        const [rStr, cStr] = k.split("-");
        const r = Number(rStr);
        const c = Number(cStr);
        if (Number.isNaN(r) || Number.isNaN(c)) continue;
        if (r === rowIndex) continue;
        const newR = r > rowIndex ? r - 1 : r;
        next[`${newR}-${c}`] = prev[k];
      }
      return next;
    });

    const nextRowCount = enforced.length;
    if (nextRowCount > 0) {
      setActive((a) => ({ r: clamp(a.r, 0, nextRowCount - 1), c: a.c }));
      setSelA((a) => (a ? { r: clamp(a.r, 0, nextRowCount - 1), c: a.c } : a));
      setSelB((b) => (b ? { r: clamp(b.r, 0, nextRowCount - 1), c: b.c } : b));
    } else {
      setActive({ r: 0, c: 0 });
      setSelA(null);
      setSelB(null);
    }
  };

  const handleValidate = async () => {
    if (!data) return;

    setValidating(true);
    setError(null);
    setMessage(null);
    setUiWarnings([]);
    setValidationErrors([]);
    setValidationWarnings([]);

    const url = buildValidateUrl();
    if (!url) {
      setValidating(false);
      setError("API base URL is not configured.");
      return;
    }
    if (!loggedIn) {
      setValidating(false);
      setError("Please log in first (username is required).");
      return;
    }

    try {
      const enforcedRows = enforceOutliersFirstRowOnly(data.rows);

      const rowsForBackend = enforcedRows.map((row) => {
        const out: MetadataRow = { ...row };
        data.columns.forEach((col) => {
          if (isBooleanColumn(col)) out[col] = !!out[col];
        });

        if (out["File Name"]) out["File Name"] = canonicalPrefix(String(out["File Name"]));
        // Sample Name: keep as-is
        if (out["Sample Name"]) out["Sample Name"] = String(out["Sample Name"]);

        return out;
      });

      const payload = { columns: data.columns, rows: rowsForBackend };

      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Failed to validate (${resp.status}): ${text || resp.statusText}`);
      }

      const result: ValidateResponse = await resp.json();
      const errs = result.errors || [];
      const warns = result.warnings || [];

      setValidationErrors(errs);
      setValidationWarnings(warns);

      if (errs.length === 0 && warns.length === 0) {
        setMessage(`Validation passed and saved (${result.rows_saved ?? data.rows.length} rows).`);
      } else if (errs.length === 0) {
        setMessage(`Validation warnings, but saved (${result.rows_saved ?? data.rows.length} rows).`);
      } else {
        setMessage(`Validation found issues, but saved (${result.rows_saved ?? data.rows.length} rows).`);
      }

      setData({ ...data, rows: enforcedRows });
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setValidating(false);
    }
  };

  const handleUploadCsv = async (file: File) => {
    setError(null);
    setMessage(null);
    setUiWarnings([]);
    setValidationErrors([]);
    setValidationWarnings([]);
    setCellErrors({});

    const url = buildUploadCsvUrl();
    if (!url) {
      setError("API base URL is not configured.");
      return;
    }
    if (!loggedIn) {
      setError("Please log in first (username is required).");
      return;
    }

    try {
      const fd = new FormData();
      fd.append("file", file);

      const resp = await fetch(url, {
        method: "POST",
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        body: fd,
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Failed to upload CSV (${resp.status}): ${text || resp.statusText}`);
      }

      const payload: MetadataPayload = await resp.json();

      let normalizedRows = (payload.rows || []).map((row) => {
        const newRow: MetadataRow = { ...row };
        (payload.columns || []).forEach((col) => {
          if (isBooleanColumn(col)) newRow[col] = normalizeBoolean(newRow[col]);
        });
        return newRow;
      });

      normalizedRows = enforceOutliersFirstRowOnly(normalizedRows);

      setData({ columns: payload.columns || [], rows: normalizedRows });
      setMessage(`Uploaded CSV and saved (${normalizedRows.length} rows).`);

      setActive({ r: 0, c: 0 });
      setSelA({ r: 0, c: 0 });
      setSelB({ r: 0, c: 0 });
    } catch (err: any) {
      setError(err?.message ?? String(err));
    }
  };

  // Helper to build td class + mouse handlers for each grid cell
  const cellProps = (r: number, c: number) => {
    const k = cellKey(r, c);
    const hasErr = !!cellErrors[k];
    return {
      className: [
        "grid-cell",
        isCellSelected(r, c) ? "sel" : "",
        isCellActive(r, c) ? "active" : "",
        hasErr ? "cell-error" : "",
      ].join(" "),
      onMouseDown: () => beginSelect(r, c),
      onMouseEnter: () => extendSelect(r, c),
      title: hasErr ? cellErrors[k] : undefined,
    };
  };

  const sampleNameHeader = (
    <div className="th-wrap">
      <div className="th-title">SAMPLE NAME</div>
      <div className="th-sub">(Letters, numbers, and "_" only)</div>
    </div>
  );

  // ✅ YOU ASKED FOR THESE EXACT HEADERS
  const groupHeader = (
    <div className="th-wrap">
      <div className="th-title">GROUP*</div>
      <div className="th-sub">(NA = exclude from comparisons)</div>
    </div>
  );

  const conditionHeader = (
    <div className="th-wrap">
      <div className="th-title">CONDITION/<br />TREATMENT*</div>
      <div className="th-sub">(NA = exclude from comparisons)</div>
    </div>
  );

  const soiHeader = (
    <div className="th-wrap">
      <div className="th-title">SAMPLE OF INTEREST</div>
      <div className="th-sub">(Group-Condition)</div>
    </div>
  );

  const rcpHeader = (
    <div className="th-wrap">
      <div className="th-title">RESPECTIVE COUNTER PART</div>
      <div className="th-sub">(Group-Condition)</div>
    </div>
  );

  return (
    <div className="p02-metadata" style={{ marginTop: 8, marginBottom: 24 }}>
      {!loggedIn && (
        <div className="msg info" style={{ marginBottom: 10 }}>
          You’re in guest mode. Please log in first.
        </div>
      )}

      <div className="toolbar-top">
        <label className="btn bm-blue" title={!loggedIn ? "Login required" : "Upload sample metadata CSV"}>
          <span aria-hidden="true">⬆️</span>
          <span>Upload CSV</span>
          <input
            type="file"
            accept=".csv"
            disabled={!loggedIn}
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUploadCsv(f);
              e.currentTarget.value = "";
            }}
          />
        </label>

        <div className="or-block">OR</div>

        <div className="row-actions">
          <button
            type="button"
            className="btn bm-blue"
            onClick={fetchMetadata}
            disabled={!base || !loggedIn || loading}
            title={!loggedIn ? "Login required" : "Generate metadata from rawdata discovery"}
          >
            {loading ? "Generating..." : "Generate metadata"}
          </button>

          <button
            type="button"
            className="btn bm-ghost"
            onClick={handleAddRow}
            disabled={!data}
            title={!data ? "Generate or upload metadata first" : "Add a new row"}
          >
            + Add row
          </button>
        </div>
      </div>

      {error && <div className="msg error">{error}</div>}
      {message && <div className="msg success">{message}</div>}

      {uiWarnings.length > 0 && (
        <div className="msg warn">
          <b>Paste warnings:</b>
          <ul style={{ margin: "6px 0 0 18px" }}>
            {uiWarnings.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      )}

      {data && (
        <div
          className="metadata-table-wrapper"
          ref={wrapperRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onCopyCapture={onCopyCapture}
          onPasteCapture={onPasteCapture}
          title="Tip: drag to select, Ctrl+C/Ctrl+V to copy/paste like Excel"
        >
          <table className="excel-table">
            <colgroup>
              <col className="col-sr" />
              <col className="col-selected" />
              <col className="col-mid" />
              <col className="col-mid" />
              <col className="col-small" />
              <col className="col-mid" />
              <col className="col-mid" />
              <col className="col-mid" />
              <col className="col-small" />
              <col className="col-small" />
              <col className="col-actions" />
            </colgroup>

            <thead>
              <tr>
                <th rowSpan={2} className="center">SR. NO.</th>

                <th rowSpan={2} className="center th-click" onClick={() => selectWholeColumn(0)}>
                  SELECTED
                </th>

                <th rowSpan={2} className="center th-click" onClick={() => selectWholeColumn(1)}>
                  FILE NAME
                </th>

                <th rowSpan={2} className="center th-click" onClick={() => selectWholeColumn(2)}>
                  {sampleNameHeader}
                </th>

                <th rowSpan={2} className="center th-click" onClick={() => selectWholeColumn(3)}>
                  {groupHeader}
                </th>

                <th rowSpan={2} className="center th-click" onClick={() => selectWholeColumn(4)}>
                  {conditionHeader}
                </th>

                <th colSpan={2} className="center">Comparisons</th>

                <th rowSpan={2} className="center th-click" onClick={() => selectWholeColumn(7)}>
                  <div className="th-wrap">
                    <div className="th-title">OUTLIERS</div>
                    <div className="th-sub">(More details in Step 3)</div>
                  </div>
                </th>

                <th rowSpan={2} className="center th-click" onClick={() => selectWholeColumn(8)}>
                  <div className="th-wrap">
                    <div className="th-title">DISEASE OF INTEREST</div>
                    <div className="th-sub">(More details in Step 4)</div>
                  </div>
                </th>

                <th rowSpan={2} className="center">ACTIONS</th>
              </tr>

              <tr>
                <th className="center th-click" onClick={() => selectWholeColumn(5)}>
                  {soiHeader}
                </th>

                <th className="center th-click" onClick={() => selectWholeColumn(6)}>
                  {rcpHeader}
                </th>
              </tr>
            </thead>

            <tbody>
              {tableRows.map((row, idx) => {
                const soiVal = String(row["Sample of interest"] ?? "").trim();
                const rcpVal = String(row["Respective Counter part"] ?? "").trim();

                const soiOpts = makeOptionsWithCurrent(soiVal);
                const rcpOpts = makeOptionsWithCurrent(rcpVal);

                return (
                  <tr key={idx}>
                    <td className="center">{idx + 1}</td>

                    {/* selected (grid c=0) */}
                    <td {...cellProps(idx, 0)}>
                      <div className="cell-center">
                        <input
                          type="checkbox"
                          checked={!!row["selected"]}
                          onChange={(e) => handleCellChange(idx, "selected", e.target.checked)}
                          onFocus={() => {
                            setActive({ r: idx, c: 0 });
                            setSelA({ r: idx, c: 0 });
                            setSelB({ r: idx, c: 0 });
                          }}
                        />
                      </div>
                    </td>

                    {/* File Name (grid c=1) */}
                    <td {...cellProps(idx, 1)}>
                      <input
                        type="text"
                        value={row["File Name"] ?? ""}
                        onChange={(e) => handleCellChange(idx, "File Name", e.target.value)}
                        onFocus={() => {
                          setActive({ r: idx, c: 1 });
                          setSelA({ r: idx, c: 1 });
                          setSelB({ r: idx, c: 1 });
                        }}
                      />
                    </td>

                    {/* Sample Name (grid c=2) */}
                    <td {...cellProps(idx, 2)}>
                      <input
                        type="text"
                        value={row["Sample Name"] ?? ""}
                        onChange={(e) => handleCellChange(idx, "Sample Name", e.target.value)}
                        onFocus={() => {
                          setActive({ r: idx, c: 2 });
                          setSelA({ r: idx, c: 2 });
                          setSelB({ r: idx, c: 2 });
                        }}
                      />
                      {cellErrors[`${idx}-2`] && (
                        <div className="cell-error-text">{cellErrors[`${idx}-2`]}</div>
                      )}
                    </td>

                    {/* group (grid c=3) */}
                    <td {...cellProps(idx, 3)}>
                      <input
                        type="text"
                        value={row["group"] ?? ""}
                        onChange={(e) => handleCellChange(idx, "group", e.target.value)}
                        onFocus={() => {
                          setActive({ r: idx, c: 3 });
                          setSelA({ r: idx, c: 3 });
                          setSelB({ r: idx, c: 3 });
                        }}
                      />
                    </td>

                    {/* condition/treatment (grid c=4) */}
                    <td {...cellProps(idx, 4)}>
                      <input
                        type="text"
                        value={row["condition/treatment"] ?? ""}
                        onChange={(e) => handleCellChange(idx, "condition/treatment", e.target.value)}
                        onFocus={() => {
                          setActive({ r: idx, c: 4 });
                          setSelA({ r: idx, c: 4 });
                          setSelB({ r: idx, c: 4 });
                        }}
                      />
                    </td>

                    {/* Sample of interest (grid c=5) ✅ DROPDOWN */}
                    <td {...cellProps(idx, 5)}>
                      <select
                        className="excel-select"
                        value={soiVal}
                        onChange={(e) => handleCellChange(idx, "Sample of interest", e.target.value)}
                        onFocus={() => {
                          setActive({ r: idx, c: 5 });
                          setSelA({ r: idx, c: 5 });
                          setSelB({ r: idx, c: 5 });
                        }}
                      >
                        <option value="">(select)</option>
                        {soiOpts.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* Respective Counter part (grid c=6) ✅ DROPDOWN */}
                    <td {...cellProps(idx, 6)}>
                      <select
                        className="excel-select"
                        value={rcpVal}
                        onChange={(e) => handleCellChange(idx, "Respective Counter part", e.target.value)}
                        onFocus={() => {
                          setActive({ r: idx, c: 6 });
                          setSelA({ r: idx, c: 6 });
                          setSelB({ r: idx, c: 6 });
                        }}
                      >
                        <option value="">(select)</option>
                        {rcpOpts.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* Outliers (grid c=7) */}
                    <td {...cellProps(idx, 7)}>
                      {idx === 0 ? (
                        <select
                          className="excel-select"
                          value={normalizeOutliersValue(row["Outliers"])}
                          onChange={(e) => handleCellChange(idx, "Outliers", e.target.value)}
                          onFocus={() => {
                            setActive({ r: idx, c: 7 });
                            setSelA({ r: idx, c: 7 });
                            setSelB({ r: idx, c: 7 });
                          }}
                        >
                          {OUTLIER_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span style={{ display: "block", height: "100%" }} />
                      )}
                    </td>

                    {/* Disease of Interest (grid c=8) */}
                    <td {...cellProps(idx, 8)}>
                      <input
                        type="text"
                        value={row["Disease of Interest"] ?? row["Disease"] ?? ""}
                        onChange={(e) => handleCellChange(idx, "Disease of Interest", e.target.value)}
                        onFocus={() => {
                          setActive({ r: idx, c: 8 });
                          setSelA({ r: idx, c: 8 });
                          setSelB({ r: idx, c: 8 });
                        }}
                      />
                    </td>

                    <td className="actions-cell">
                      <button type="button" className="btn-delete" onClick={() => handleDeleteRow(idx)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}

              {tableRows.length === 0 && (
                <tr>
                  <td colSpan={11} className="empty">
                    No rows yet. Upload CSV or Generate metadata.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="bottom-bar">
        <button
          type="button"
          className="btn bm-validate"
          onClick={handleValidate}
          disabled={!data || validating || !loggedIn}
        >
          {validating ? "Validating..." : "✅ Validate metadata"}
        </button>
      </div>

      {validationErrors.length > 0 && (
        <div className="msg error">
          <b>Errors:</b>
          <ul style={{ margin: "6px 0 0 18px" }}>
            {validationErrors.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      )}
      {validationWarnings.length > 0 && (
        <div className="msg warn">
          <b>Warnings:</b>
          <ul style={{ margin: "6px 0 0 18px" }}>
            {validationWarnings.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default P02SampleMetadata;

