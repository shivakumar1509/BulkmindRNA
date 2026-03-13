#!/usr/bin/env bash
set -euo pipefail

FILE="p08_apply_and_run_pipeline.tsx"

[[ -f "$FILE" ]] || { echo "Missing $FILE"; exit 1; }

cp "$FILE" "${FILE}.bak.counts.$(date +%Y%m%d_%H%M%S)"

python3 <<'PY'
from pathlib import Path
import sys

p = Path("p08_apply_and_run_pipeline.tsx")
tsx = p.read_text()

helper_anchor = """function getExpectedUploadCountFromLS(): number | null {
  const mode = (safeGetLS("bulkmind.uploadExpectedMode") || "").trim().toLowerCase();
  if (mode !== "expected") return null;

  const raw = (safeGetLS("bulkmind.uploadExpectedCount") || "").trim();
  if (!raw) return null;

  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
"""

helper_block = """
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
""".strip("\n") + "\n"

if "function computeFinalSelectedSamplesFromMetadata(" not in tsx:
    if helper_anchor not in tsx:
        sys.exit("Could not find getExpectedUploadCountFromLS() block.")
    tsx = tsx.replace(helper_anchor, helper_anchor + "\n" + helper_block, 1)

state_anchor = """  const [outlierMode, setOutlierMode] = useState<string>("");
  const [manualOutliersSaved, setManualOutliersSaved] = useState<boolean>(false);
  const [outlierRows, setOutlierRows] = useState<Array<Record<string, any>>>([]);

  const [metaCsv, setMetaCsv] = useState<string | null>(null);
"""

state_block = """  const [outlierMode, setOutlierMode] = useState<string>("");
  const [manualOutliersSaved, setManualOutliersSaved] = useState<boolean>(false);
  const [outlierRows, setOutlierRows] = useState<Array<Record<string, any>>>([]);
  const [metadataRows, setMetadataRows] = useState<Array<Record<string, any>>>([]);
  const [metadataRefreshKey, setMetadataRefreshKey] = useState(0);

  const [metaCsv, setMetaCsv] = useState<string | null>(null);
"""

if "const [metadataRows, setMetadataRows]" not in tsx:
    if state_anchor not in tsx:
        sys.exit("Could not find outlierRows state block.")
    tsx = tsx.replace(state_anchor, state_block, 1)

handler_old = """      if (currentUser?.trim() && sampleId?.trim()) {
        setApplyStatus(currentUser, sampleId, "idle");
      }

      setStatus(null);
      setStatusType("info");
"""

handler_new = """      if (currentUser?.trim() && sampleId?.trim()) {
        setApplyStatus(currentUser, sampleId, "idle");
      }

      setMetadataRefreshKey((n) => n + 1);
      setStatus(null);
      setStatusType("info");
"""

if "setMetadataRefreshKey((n) => n + 1);" not in tsx:
    if handler_old not in tsx:
        sys.exit("Could not find selections handler block.")
    tsx = tsx.replace(handler_old, handler_new, 1)

effect_anchor = """  useEffect(() => {
    const loadOutlierState = async () => {
"""

metadata_effect = """
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

"""

if "const loadMetadataRows = async () => {" not in tsx:
    if effect_anchor not in tsx:
        sys.exit("Could not find outlier effect insertion point.")
    tsx = tsx.replace(effect_anchor, metadata_effect + effect_anchor, 1)

old_file_count = """  const fileCountSummaryValue =
    uploadedFileCount !== null
      ? String(uploadedFileCount)
      : "(not specified)";
"""

new_file_count = """  const fileCountSummaryValue =
    metadataRows.length > 0
      ? String(metadataRows.length)
      : uploadedFileCount !== null
      ? String(uploadedFileCount)
      : "(not specified)";
"""

if old_file_count not in tsx:
    sys.exit("Could not find fileCountSummaryValue block.")
tsx = tsx.replace(old_file_count, new_file_count, 1)

old_final_selected = """  const finalSelectedSamplesValue = (() => {
    const n = computeFinalSelectedSamples(outlierRows);
    return n !== null ? String(n) : "(unknown)";
  })();
"""

new_final_selected = """  const finalSelectedSamplesValue = (() => {
    const n = computeFinalSelectedSamplesFromMetadata(metadataRows, outlierRows);
    return n !== null ? String(n) : "(unknown)";
  })();
"""

if old_final_selected not in tsx:
    sys.exit("Could not find finalSelectedSamplesValue block.")
tsx = tsx.replace(old_final_selected, new_final_selected, 1)

p.write_text(tsx)
print("Updated backend-backed uploaded count and final selected samples.")
PY
