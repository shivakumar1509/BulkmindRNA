import React, { useEffect, useMemo, useState } from "react";
import { API_BASE as DEFAULT_API_BASE } from "../api/client";

type ResultFile = {
  path: string; // relative to results/<sample>
  name: string;
  is_dir: boolean;
  size: number | null;
  mtime: number | null; // epoch seconds
};

type StepBadgeStatus = "completed" | "ready" | "error";

type hookupProps = {
  sampleId?: string;
  apiBaseUrl?: string;
  username?: string;
  volcanoComparisons?: string[] | null;
  diseaseOfInterest?: string | null;
  heatmapPathways?: string[] | null;
  onStatusChange?: (
    status: StepBadgeStatus,
    details: {
      qcOk: boolean;
      pathwayOk: boolean;
      volcanoOk: boolean;
      heatmapOk: boolean;
      wantsVolcano: boolean;
      wantsDisease: boolean;
      wantsHeatmap: boolean;
      totalFilesCount: number;
    }
  ) => void;
};

function humanSize(n: number | null | undefined): string {
  if (n == null || n < 0) return "";
  let val = n;
  const units = ["B", "KB", "MB", "GB", "TB"];
  for (let i = 0; i < units.length; i++) {
    if (val < 1024 || i === units.length - 1) {
      return `${val.toFixed(1)} ${units[i]}`;
    }
    val = val / 1024;
  }
  return `${val.toFixed(1)} TB`;
}

function formatMtime(epoch: number | null | undefined): string {
  if (!epoch || epoch <= 0) return "";
  const d = new Date(epoch * 1000);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function getExt(name: string): string {
  const m = name.toLowerCase().match(/(\.[^./]+)$/);
  return m ? m[1] : "";
}

function normalizePath(p: string): string {
  return (p || "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/^\.\/+/, "");
}

function isNonEmptyString(x: unknown): boolean {
  return typeof x === "string" && x.trim().length > 0;
}

function hasNonEmptyItems(arr: string[] | null | undefined): boolean {
  return Array.isArray(arr) && arr.some((x) => isNonEmptyString(x));
}

function makeDownloadUrl(base: string, sampleId: string, relPath: string, username: string) {
  return `${base}/api/results/${encodeURIComponent(sampleId)}/download?path=${encodeURIComponent(relPath)}&username=${encodeURIComponent(username)}`;
}

function makeZipDownloadUrl(base: string, sampleId: string, relPath: string, username: string) {
  return `${base}/api/results/${encodeURIComponent(sampleId)}/download_zip?path=${encodeURIComponent(relPath || "")}&username=${encodeURIComponent(username)}`;
}

type FileCategoryItem = ResultFile;
type FigureCategory = {
  label: string;
  key: string;
  icon: string;
  files: ResultFile[];
  folderPath: string;
  downloadLabel: string;
};

type FileBuckets = {
  fastqc: FileCategoryItem[];
  htseqRaw: FileCategoryItem[];
  htseqNorm: FileCategoryItem[];
  degRoot: FileCategoryItem[];
  degSubdirs: { subdir: string; label: string; files: FileCategoryItem[] }[];
  pathwayTables: FileCategoryItem[];
  logsSnapshots: FileCategoryItem[];
  qcFigures: FileCategoryItem[];
  pathwayFigures: FileCategoryItem[];
  volcanoFigures: FileCategoryItem[];
  heatmapFigures: FileCategoryItem[];
  figureCategories: FigureCategory[];
};

function cleanDegLabel(name: string): string {
  let newName = name.replace(/^[0-9]+[a-zA-Z]*[_\-\s]+/, "");
  newName = newName.replace(/^[0-9a-zA-Z]+[._\-\s]*/, "");
  return newName.trim() || name;
}

function buildBuckets(files: ResultFile[]): FileBuckets {
  const fastqc: FileCategoryItem[] = [];
  const htseqRaw: FileCategoryItem[] = [];
  const htseqNorm: FileCategoryItem[] = [];
  const degRoot: FileCategoryItem[] = [];
  const degSubMap: Record<string, FileCategoryItem[]> = {};
  const pathwayTables: FileCategoryItem[] = [];
  const logsSnapshots: FileCategoryItem[] = [];
  const qcFigures: FileCategoryItem[] = [];
  const pathwayFigures: FileCategoryItem[] = [];
  const volcanoFigures: FileCategoryItem[] = [];
  const heatmapFigures: FileCategoryItem[] = [];

  for (const f of files) {
    if (f.is_dir) continue;
    const p = normalizePath(f.path || "");
    const ext = getExt(f.name);

    if ((p.startsWith("1_fastqc/") || p.startsWith("1a_fastqc_trimmed/")) && [".html", ".zip"].includes(ext)) {
      fastqc.push(f);
      continue;
    }
    if (p.startsWith("3_htseq_count/") && [".txt", ".tsv", ".csv"].includes(ext)) {
      htseqRaw.push(f);
      continue;
    }
    if ((p.startsWith("4_analysis/") || p.startsWith("4a_analysis_outlier_removed/")) && [".csv", ".tsv"].includes(ext)) {
      htseqNorm.push(f);
      continue;
    }
    if (p.startsWith("5_DEGs/")) {
      const subPath = p.substring("5_DEGs/".length);
      const slashIdx = subPath.indexOf("/");
      if (slashIdx === -1) {
        degRoot.push(f);
      } else {
        const d = subPath.substring(0, slashIdx);
        if (!degSubMap[d]) degSubMap[d] = [];
        degSubMap[d].push(f);
      }
    }
    if (p.startsWith("6_AI_enrichment/") && [".csv", ".tsv", ".xlsx"].includes(ext)) {
      pathwayTables.push(f);
      continue;
    }
    if (!p.includes("/") && [".log", ".txt", ".csv"].includes(ext)) {
      logsSnapshots.push(f);
      continue;
    }

    const isFigure = [".png", ".jpg", ".jpeg", ".svg", ".pdf"].includes(ext);
    if (!isFigure) continue;

    if (p.startsWith("5_DEGs/8_Volcano_and_QC_Plots/QC_Plots/")) {
      qcFigures.push(f);
      continue;
    }
    if (p.startsWith("7_Final_figures/Barplots/")) {
      pathwayFigures.push(f);
      continue;
    }
    if (p.startsWith("7_Final_figures/volcano_plots/")) {
      volcanoFigures.push(f);
      continue;
    }
    if (p.startsWith("7_Final_figures/Heatmaps/")) {
      heatmapFigures.push(f);
      continue;
    }
  }

  const degSubdirs = Object.entries(degSubMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([subdir, list]) => ({
      subdir,
      label: `${cleanDegLabel(subdir)} — ${list.length}`,
      files: list.sort((a, b) => a.name.localeCompare(b.name)),
    }));

  const figureCategories: FigureCategory[] = [
    { 
      label: "QC Plots (PCA, dispersion, sample distances)", 
      key: "qc_plots", 
      icon: "📈", 
      files: qcFigures.sort((a, b) => a.name.localeCompare(b.name)),
      folderPath: "5_DEGs/8_Volcano_and_QC_Plots/QC_Plots",
      downloadLabel: "Download QC Plots"
    },
    { 
      label: "Pathway enrichment plots", 
      key: "pathway_plots", 
      icon: "🧠", 
      files: pathwayFigures.sort((a, b) => a.name.localeCompare(b.name)),
      folderPath: "7_Final_figures/Barplots",
      downloadLabel: "Download Pathway Plots"
    },
    { 
      label: "Volcano plots", 
      key: "volcano_plots", 
      icon: "🌋", 
      files: volcanoFigures.sort((a, b) => a.name.localeCompare(b.name)),
      folderPath: "7_Final_figures/volcano_plots",
      downloadLabel: "Download Volcano Plots"
    },
    { 
      label: "Heatmaps", 
      key: "heatmaps", 
      icon: "🔥", 
      files: heatmapFigures.sort((a, b) => a.name.localeCompare(b.name)),
      folderPath: "7_Final_figures/Heatmaps",
      downloadLabel: "Download Heatmaps"
    },
  ];

  return {
    fastqc: fastqc.sort((a, b) => a.name.localeCompare(b.name)),
    htseqRaw: htseqRaw.sort((a, b) => a.name.localeCompare(b.name)),
    htseqNorm: htseqNorm.sort((a, b) => a.name.localeCompare(b.name)),
    degRoot: degRoot.sort((a, b) => a.name.localeCompare(b.name)),
    degSubdirs,
    pathwayTables: pathwayTables.sort((a, b) => a.name.localeCompare(b.name)),
    logsSnapshots: logsSnapshots.sort((a, b) => a.name.localeCompare(b.name)),
    qcFigures,
    pathwayFigures,
    volcanoFigures,
    heatmapFigures,
    figureCategories,
  };
}

export function getResultsViewerStepStatus(args: {
  files: ResultFile[]; buckets: FileBuckets; loading: boolean; loadError: string | null; volcanoComparisons?: string[] | null; diseaseOfInterest?: string | null; heatmapPathways?: string[] | null;
}): {
  badge: StepBadgeStatus; qcOk: boolean; pathwayOk: boolean; volcanoOk: boolean; heatmapOk: boolean; wantsVolcano: boolean; wantsDisease: boolean; wantsHeatmap: boolean;
} {
  const { files, buckets, loading, loadError, volcanoComparisons, diseaseOfInterest, heatmapPathways } = args;

  if (loading || loadError) {
    return { badge: loadError ? "error" : "ready", qcOk: false, pathwayOk: false, volcanoOk: false, heatmapOk: false, wantsVolcano: false, wantsDisease: false, wantsHeatmap: false };
  }

  const wantsVolcano = hasNonEmptyItems(volcanoComparisons);
  const wantsDisease = isNonEmptyString(diseaseOfInterest);
  const wantsHeatmap = hasNonEmptyItems(heatmapPathways);
  const hasAnyFiles = files.some((f) => !f.is_dir);

  const qcOk = buckets.qcFigures.length > 0;
  const pathwayOk = buckets.pathwayTables.length > 0;
  const volcanoOk = !wantsVolcano || buckets.volcanoFigures.length > 0;
  const diseaseOk = !wantsDisease || buckets.pathwayTables.length > 0 || buckets.pathwayFigures.length > 0;
  const heatmapOk = !wantsHeatmap || buckets.heatmapFigures.length > 0;

  if (!hasAnyFiles) {
    return { badge: "ready", qcOk, pathwayOk, volcanoOk, heatmapOk, wantsVolcano, wantsDisease, wantsHeatmap };
  }

  const allOk = qcOk && pathwayOk && volcanoOk && diseaseOk && heatmapOk;
  return { badge: allOk ? "completed" : "error", qcOk, pathwayOk: pathwayOk && diseaseOk, volcanoOk, heatmapOk, wantsVolcano, wantsDisease, wantsHeatmap };
}

const Section: React.FC<{
  title: string;
  defaultOpen?: boolean;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, defaultOpen = false, headerRight, children }) => {
  const [open, setOpen] = useState<boolean>(defaultOpen);
  return (
    <div style={{ borderRadius: 12, border: "1px solid #e5e7eb", marginBottom: 12, overflow: "hidden", background: "#ffffff" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{ width: "100%", textAlign: "left", padding: "8px 12px", border: "none", background: open ? "#f3f4f6" : "#f9fafb", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14, fontWeight: 600 }}
      >
        <span>{title}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {headerRight && <div onClick={(e) => e.stopPropagation()}>{headerRight}</div>}
          <span style={{ fontSize: 18 }}>{open ? "▾" : "▸"}</span>
        </div>
      </button>
      {open && <div style={{ padding: 10, borderTop: "1px solid #e5e7eb" }}>{children}</div>}
    </div>
  );
};

const P09ResultsViewer: React.FC<hookupProps> = ({ sampleId = "test", apiBaseUrl, username, volcanoComparisons, diseaseOfInterest, heatmapPathways, onStatusChange }) => {
  const base = useMemo(() => {
    const raw = (apiBaseUrl || DEFAULT_API_BASE || "").toString();
    return raw.replace(/\/+$/, "");
  }, [apiBaseUrl]);

  const [files, setFiles] = useState<ResultFile[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enlargedFigure, setEnlargedFigure] = useState<ResultFile | null>(null);

  const THUMB_LIMIT = 12;
  const safeUsername = (username || "").trim();

  useEffect(() => {
    if (!base) { setFiles([]); setLoading(false); setLoadError("API base URL is not configured."); return; }
    if (!safeUsername) { setFiles([]); setLoading(false); setLoadError("Username is required."); return; }

    const abort = new AbortController();
    const url = `${base}/api/results/${encodeURIComponent(sampleId)}/files?username=${encodeURIComponent(safeUsername)}`;

    setLoading(true); setLoadError(null);
    fetch(url, { signal: abort.signal })
      .then(async (res) => {
        if (!res.ok) { const text = await res.text().catch(() => ""); throw new Error(`${res.status} ${text || res.statusText}`); }
        const data = (await res.json()) as ResultFile[];
        setFiles(data || []);
      })
      .catch((err) => {
        if (abort.signal.aborted) return;
        setLoadError(`Failed to load results: ${err?.message || String(err)}`);
      })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });

    return () => abort.abort();
  }, [sampleId, base, safeUsername]);

  const buckets = useMemo(() => buildBuckets(files), [files]);
  const totalFilesCount = useMemo(() => files.filter((f) => !f.is_dir).length, [files]);
  const hasAnyResults = files.length > 0;

  const stepStatus = useMemo(() => getResultsViewerStepStatus({ files, buckets, loading, loadError, volcanoComparisons, diseaseOfInterest, heatmapPathways }), [files, buckets, loading, loadError, volcanoComparisons, diseaseOfInterest, heatmapPathways]);

  useEffect(() => {
    if (onStatusChange) {
      onStatusChange(stepStatus.badge, { qcOk: stepStatus.qcOk, pathwayOk: stepStatus.pathwayOk, volcanoOk: stepStatus.volcanoOk, heatmapOk: stepStatus.heatmapOk, wantsVolcano: stepStatus.wantsVolcano, wantsDisease: stepStatus.wantsDisease, wantsHeatmap: stepStatus.wantsHeatmap, totalFilesCount });
    }
  }, [onStatusChange, stepStatus, totalFilesCount]);

  const renderFolderZipButton = (path: string, label: string = "Download") => (
    <a
      href={makeZipDownloadUrl(base, sampleId, path, safeUsername)}
      title={`Download ${path || "all"} as ZIP`}
      style={{ fontSize: 12, padding: "4px 12px", borderRadius: 6, background: "#16a34a", color: "#ffffff", textDecoration: "none", fontWeight: 600, border: "1px solid #15803d", boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}
    >
      📦 {label}
    </a>
  );

  return (
    <div style={{ marginTop: 8, marginBottom: 24 }}>
      <p style={{ margin: "0 0 8px 0", fontSize: 13, color: "#4b5563" }}>
        Preview processed outputs, figures, and helper CSVs for sample <code>{sampleId}</code>.
      </p>

      {loading && <div style={{ padding: 10, borderRadius: 10, background: "#eff6ff", border: "1px solid #bfdbfe", fontSize: 13, marginBottom: 10 }}>Loading results listing…</div>}
      {loadError && <div style={{ padding: 10, borderRadius: 10, background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", fontSize: 13, marginBottom: 10 }}>{loadError}</div>}

      {hasAnyResults && !loading && !loadError && (
        <div style={{ fontSize: 13, marginBottom: 10 }}>
          <strong>{totalFilesCount}</strong> files generated
        </div>
      )}

      {/* FILES SECTION */}
      <Section 
        title="📁  FILES" 
        defaultOpen={true}
        headerRight={renderFolderZipButton("", "Download Files")}
      >
        <Section 
          title="📄  FASTQC reports (trimmed + untrimmed)"
          headerRight={renderFolderZipButton("1_fastqc", "Download FASTQC")}
        >
          {buckets.fastqc.length === 0 ? <p style={{ fontSize: 13, color: "#6b7280" }}>No FASTQC files found.</p> : (
            <>
              <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>Combined content from <code>1_fastqc</code> and <code>1a_fastqc_trimmed</code>.</p>
              <ul style={{ listStyle: "none", paddingLeft: 0, margin: 0 }}>
                {buckets.fastqc.map((f) => (
                  <li key={f.path} style={{ borderBottom: "1px solid #e5e7eb", padding: "6px 0", display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, wordBreak: "break-all" }}>{f.name}</div>
                      <div style={{ fontSize: 11, color: "#6b7280" }}>{humanSize(f.size)} {f.mtime && ` • ${formatMtime(f.mtime)}`}</div>
                      <div style={{ fontSize: 11, color: "#9ca3af" }}><code>{f.path}</code></div>
                    </div>
                    <a href={makeDownloadUrl(base, sampleId, f.path, safeUsername)} style={{ fontSize: 12, padding: "4px 8px", borderRadius: 9999, border: "1px solid #d1d5db", background: "#ffffff", textDecoration: "none" }}>Download</a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>

        <Section title="🧾  HTSeq counts" headerRight={renderFolderZipButton("3_htseq_count", "Download Counts")}>
          <Section title="Raw counts (3_htseq_count)">
            {buckets.htseqRaw.length === 0 ? <p style={{ fontSize: 13, color: "#6b7280" }}>No files found.</p> : (
              <ul style={{ listStyle: "none", paddingLeft: 0, margin: 0 }}>
                {buckets.htseqRaw.map((f) => (
                  <li key={f.path} style={{ borderBottom: "1px solid #e5e7eb", padding: "6px 0", display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 13 }}>{f.name}</div><div style={{ fontSize: 11, color: "#6b7280" }}>{humanSize(f.size)}</div></div>
                    <a href={makeDownloadUrl(base, sampleId, f.path, safeUsername)} style={{ fontSize: 12, padding: "4px 8px", borderRadius: 9999, border: "1px solid #d1d5db", background: "#ffffff", textDecoration: "none" }}>Download</a>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Normalized counts (4_analysis / 4a_analysis_outlier_removed)">
            {buckets.htseqNorm.length === 0 ? <p style={{ fontSize: 13, color: "#6b7280" }}>No files found.</p> : (
              <ul style={{ listStyle: "none", paddingLeft: 0, margin: 0 }}>
                {buckets.htseqNorm.map((f) => (
                  <li key={f.path} style={{ borderBottom: "1px solid #e5e7eb", padding: "6px 0", display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 13 }}>{f.name}</div><div style={{ fontSize: 11, color: "#6b7280" }}>{humanSize(f.size)}</div></div>
                    <a href={makeDownloadUrl(base, sampleId, f.path, safeUsername)} style={{ fontSize: 12, padding: "4px 8px", borderRadius: 9999, border: "1px solid #d1d5db", background: "#ffffff", textDecoration: "none" }}>Download</a>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </Section>

        <Section title="🧬  Differentially Expressed Genes (DEG)" headerRight={renderFolderZipButton("5_DEGs", "Download DEG")}>
          {buckets.degRoot.length === 0 && buckets.degSubdirs.length === 0 ? <p style={{ fontSize: 13, color: "#6b7280" }}>No files found.</p> : (
            <>
              {buckets.degRoot.length > 0 && (
                <ul style={{ listStyle: "none", paddingLeft: 0, margin: 0 }}>
                  {buckets.degRoot.map((f) => (
                    <li key={f.path} style={{ borderBottom: "1px solid #e5e7eb", padding: "6px 0", display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 13 }}>{f.name}</div><div style={{ fontSize: 11, color: "#6b7280" }}>{humanSize(f.size)}</div></div>
                      <a href={makeDownloadUrl(base, sampleId, f.path, safeUsername)} style={{ fontSize: 12, padding: "4px 8px", borderRadius: 9999, border: "1px solid #d1d5db", background: "#ffffff", textDecoration: "none" }}>Download</a>
                    </li>
                  ))}
                </ul>
              )}
              {buckets.degSubdirs.map((sub) => (
                <Section key={sub.subdir} title={sub.label}>
                  <ul style={{ listStyle: "none", paddingLeft: 0, margin: 0 }}>
                    {sub.files.map((f) => (
                      <li key={f.path} style={{ borderBottom: "1px solid #e5e7eb", padding: "6px 0", display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 13 }}>{f.name}</div><div style={{ fontSize: 11, color: "#6b7280" }}>{humanSize(f.size)}</div></div>
                        <a href={makeDownloadUrl(base, sampleId, f.path, safeUsername)} style={{ fontSize: 12, padding: "4px 8px", borderRadius: 9999, border: "1px solid #d1d5db", background: "#ffffff", textDecoration: "none" }}>Download</a>
                      </li>
                    ))}
                  </ul>
                </Section>
              ))}
            </>
          )}
        </Section>

        <Section title="🧭  Pathway enrichment tables (AI Enrichment)" headerRight={renderFolderZipButton("6_AI_enrichment", "Download AI Enrichment")}>
          {buckets.pathwayTables.length === 0 ? <p style={{ fontSize: 13, color: "#6b7280" }}>No files found.</p> : (
            <ul style={{ listStyle: "none", paddingLeft: 0, margin: 0 }}>
              {buckets.pathwayTables.map((f) => (
                <li key={f.path} style={{ borderBottom: "1px solid #e5e7eb", padding: "6px 0", display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 13 }}>{f.name}</div><div style={{ fontSize: 11, color: "#6b7280" }}>{humanSize(f.size)}</div></div>
                  <a href={makeDownloadUrl(base, sampleId, f.path, safeUsername)} style={{ fontSize: 12, padding: "4px 8px", borderRadius: 9999, border: "1px solid #d1d5db", background: "#ffffff", textDecoration: "none" }}>Download</a>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="📂  Logs & metadata snapshots (top-level)">
          {buckets.logsSnapshots.length === 0 ? <p style={{ fontSize: 13, color: "#6b7280" }}>No files found.</p> : (
            <ul style={{ listStyle: "none", paddingLeft: 0, margin: 0 }}>
              {buckets.logsSnapshots.map((f) => (
                <li key={f.path} style={{ borderBottom: "1px solid #e5e7eb", padding: "6px 0", display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 13 }}>{f.name}</div><div style={{ fontSize: 11, color: "#6b7280" }}>{humanSize(f.size)}</div></div>
                  <a href={makeDownloadUrl(base, sampleId, f.path, safeUsername)} style={{ fontSize: 12, padding: "4px 8px", borderRadius: 9999, border: "1px solid #d1d5db", background: "#ffffff", textDecoration: "none" }}>Download</a>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </Section>

      {/* FIGURES SECTION */}
      <Section 
        title="📊  Final Figures" 
        defaultOpen={true}
        headerRight={renderFolderZipButton("7_Final_figures", "Download Final Figures")}
      >
        <p style={{ fontSize: 12, color: "#4b5563", marginTop: 0 }}>
          Thumbnails are capped to {THUMB_LIMIT} per category for responsiveness. Use the Download buttons to get all files.
        </p>

        {buckets.figureCategories.map((cat) => {
          const total = cat.files.length;
          const limited = cat.files.slice(0, THUMB_LIMIT);
          const hasMore = total > THUMB_LIMIT;

          return (
            <Section 
              key={cat.key} 
              title={`${cat.icon}  ${cat.label} — ${total}`}
              headerRight={renderFolderZipButton(cat.folderPath, cat.downloadLabel)}
            >
              {total === 0 ? <p style={{ fontSize: 13, color: "#6b7280" }}>No figures found.</p> : (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
                    {limited.map((f) => {
                      const ext = getExt(f.name);
                      const isPdf = ext === ".pdf";
                      const href = makeDownloadUrl(base, sampleId, f.path, safeUsername);
                      return (
                        <div key={f.path} style={{ borderRadius: 12, border: "1px solid #e5e7eb", padding: 8, background: "#ffffff", display: "flex", flexDirection: "column", gap: 4 }}>
                          <div style={{ fontWeight: 600, fontSize: 12, wordBreak: "break-all" }}>{f.name}</div>
                          <div style={{ fontSize: 11, color: "#6b7280" }}>{humanSize(f.size)}</div>
                          <div style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {!isPdf && (
                              <button type="button" onClick={() => setEnlargedFigure(f)} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 9999, border: "1px solid #d1d5db", background: "#f9fafb", cursor: "pointer" }}>Enlarge</button>
                            )}
                            <a href={href} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 9999, border: "1px solid #d1d5db", background: "#ffffff", textDecoration: "none" }}>{isPdf ? "Download PDF" : "Download"}</a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {hasMore && <p style={{ marginTop: 8, fontSize: 11, color: "#6b7280" }}>Showing first {THUMB_LIMIT} of {total} files. Use the Download button to get all.</p>}
                </>
              )}
            </Section>
          );
        })}

        {enlargedFigure && (
          <div style={{ marginTop: 16, padding: 12, borderRadius: 12, border: "1px solid #e5e7eb", background: "#ffffff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Enlarged preview — {enlargedFigure.name}</div>
              <button type="button" onClick={() => setEnlargedFigure(null)} style={{ border: "none", background: "transparent", fontSize: 18, cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ textAlign: "center" }}>
              <img src={makeDownloadUrl(base, sampleId, enlargedFigure.path, safeUsername)} alt={enlargedFigure.name} style={{ maxWidth: "100%", maxHeight: 600 }} />
            </div>
          </div>
        )}
      </Section>

      {/* BIG DOWNLOAD ALL BANNER */}
      {hasAnyResults && (
        <div style={{ 
          marginTop: 24, 
          padding: "20px 24px", 
          background: "#f0fdf4", 
          border: "1px solid #bbf7d0", 
          borderRadius: 12, 
          display: "flex", 
          flexWrap: "wrap",
          justifyContent: "space-between", 
          alignItems: "center",
          gap: 16
        }}>
          <div>
            <h3 style={{ margin: "0 0 4px 0", color: "#166534", fontSize: 18 }}>Download All Results</h3>
            <p style={{ margin: 0, fontSize: 14, color: "#15803d" }}>Get a complete archive of all outputs, figures, logs, and tables for this sample.</p>
          </div>
          <a 
            href={makeZipDownloadUrl(base, sampleId, "", safeUsername)} 
            style={{ 
              background: "#16a34a", 
              color: "#fff", 
              padding: "12px 24px", 
              borderRadius: 8, 
              textDecoration: "none", 
              fontWeight: 600, 
              fontSize: 15,
              whiteSpace: "nowrap",
              boxShadow: "0 4px 6px -1px rgba(22, 163, 74, 0.2)"
            }}
          >
            Download Full Results
          </a>
        </div>
      )}

      <p style={{ marginTop: 16, fontSize: 11, color: "#6b7280" }}>
        If a file you expect isn&apos;t listed, confirm the pipeline wrote outputs
        into the correct results folder and that FastAPI can read them.
      </p>
    </div>
  );
};

export default P09ResultsViewer;
