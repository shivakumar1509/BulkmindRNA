// src/pipeline/p06_heatmap_generations.tsx
import React, { useEffect, useMemo, useState } from "react";

type PathwayOption = { key: string; name: string };

type HeatmapRow = {
  id: number;
  pathwayKey: string | null; // GMT key
  pathwayName: string | null; // clean name
  allGenes: boolean;

  // multi-select state in the right list (temporary selection)
  pendingGenes: string[];

  // confirmed genes (after clicking "Add genes")
  selectedGenes: string[];
};

type Props = {
  apiBaseUrl?: string;
  sampleId?: string;
  species?: string;
  currentUser?: string;
  authToken?: string | null;
};

const MAX_ROWS = 10;

function safeGetLS(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

// Step-8 selection storage key
const LS_HEATMAP_ROWS = "bulkmind.heatmaps.rows";

function safeSetLS(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

// MUST match App.tsx / P01UploadRawdata keys
const LS_KEYS = {
  sampleId: "bulkmind.sampleId",
  species: "bulkmind.species",
};

const P06HeatmapGenerations: React.FC<Props> = ({
  apiBaseUrl = "",
  sampleId,
  species,
  authToken,
}) => {
  const base = apiBaseUrl.replace(/\/+$/, "");

  const effectiveSampleId =
    (sampleId || safeGetLS(LS_KEYS.sampleId) || "test").trim() || "test";
  const effectiveSpecies =
    (species || safeGetLS(LS_KEYS.species) || "mouse").trim() || "mouse";

  const [pathways, setPathways] = useState<PathwayOption[]>([]);
  const [loadingPathways, setLoadingPathways] = useState(false);
  const [pathwayError, setPathwayError] = useState<string | null>(null);

  // pathwayKey -> genes
  const [geneCache, setGeneCache] = useState<Record<string, string[]>>({});

  const [rows, setRows] = useState<HeatmapRow[]>([
    {
      id: 1,
      pathwayKey: null,
      pathwayName: null,
      allGenes: false,
      pendingGenes: [],
      selectedGenes: [],
    },
  ]);

  const [showFullLists, setShowFullLists] = useState(false);

  // Persist selection for Step 8 whenever confirmed genes change
  useEffect(() => {
    try {
      const payload = (rows || [])
        .filter(
          (r) =>
            (r.pathwayName || r.pathwayKey) &&
            (r.selectedGenes || []).length > 0
        )
        .map((r) => ({
          pathway: String(r.pathwayName || r.pathwayKey || "").trim(),
          genes: (r.selectedGenes || [])
            .map((g) => String(g || "").trim())
            .filter(Boolean),
        }))
        .filter((r) => r.pathway);

      safeSetLS(LS_HEATMAP_ROWS, JSON.stringify(payload));
    } catch {}

    window.dispatchEvent(new CustomEvent("bulkmind:selections"));
  }, [rows]);

  const pathwayNameByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of pathways) m.set(p.key, p.name);
    return m;
  }, [pathways]);

  // Fetch pathways list (Reactome GMT via backend)
  useEffect(() => {
    setPathwayError(null);

    if (!base) {
      setPathwayError("API base URL not configured (missing apiBaseUrl).");
      setPathways([]);
      setLoadingPathways(false);
      return;
    }

    const abort = new AbortController();
    setLoadingPathways(true);

    const run = async () => {
      try {
        const res = await fetch(
          `${base}/api/reactome/pathways?species=${encodeURIComponent(
            effectiveSpecies
          )}`,
          {
            signal: abort.signal,
            headers: authToken
              ? { Authorization: `Bearer ${authToken}` }
              : undefined,
          }
        );

        const txt = await res.text();

        if (!res.ok) {
          throw new Error(txt || `HTTP ${res.status}`);
        }

        const data = JSON.parse(txt);
        const list: PathwayOption[] = Array.isArray(data?.pathways)
          ? data.pathways
          : [];

        setPathways(
          list
            .map((x) => ({
              key: String(x?.key || "").trim(),
              name: String(x?.name || "").trim(),
            }))
            .filter((x) => x.key && x.name)
        );
      } catch (err: any) {
        if (
          err?.name === "AbortError" ||
          String(err?.message || "").toLowerCase().includes("aborted")
        ) {
          return;
        }

        setPathways([]);
        setPathwayError(
          `Failed to load pathways: ${err?.message || String(err)}`
        );
      } finally {
        if (!abort.signal.aborted) {
          setLoadingPathways(false);
        }
      }
    };

    run();

    return () => abort.abort();
  }, [base, effectiveSpecies, authToken]);

  const fetchGenesIfNeeded = async (pathwayKey: string) => {
    if (!base) return;
    if (geneCache[pathwayKey]) return;

    const res = await fetch(
      `${base}/api/reactome/genes?species=${encodeURIComponent(
        effectiveSpecies
      )}&key=${encodeURIComponent(pathwayKey)}`,
      {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      }
    );

    const txt = await res.text();
    if (!res.ok) throw new Error(txt || `HTTP ${res.status}`);

    const data = JSON.parse(txt);
    const genes: string[] = Array.isArray(data?.genes)
      ? data.genes.map((g: any) => String(g))
      : [];

    setGeneCache((prev) => ({ ...prev, [pathwayKey]: genes }));
  };

  // Row helpers
  const updateRow = (id: number, patch: Partial<HeatmapRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const handleAddRow = () => {
    if (rows.length >= MAX_ROWS) return;

    const nextId =
      rows.length > 0 ? Math.max(...rows.map((r) => r.id)) + 1 : 1;

    setRows((prev) => [
      ...prev,
      {
        id: nextId,
        pathwayKey: null,
        pathwayName: null,
        allGenes: false,
        pendingGenes: [],
        selectedGenes: [],
      },
    ]);
  };

  const handleRemoveRow = () => {
    if (rows.length <= 1) return;
    setRows((prev) => prev.slice(0, prev.length - 1));
  };

  const handleClearAll = () => {
    setRows([
      {
        id: 1,
        pathwayKey: null,
        pathwayName: null,
        allGenes: false,
        pendingGenes: [],
        selectedGenes: [],
      },
    ]);
  };

  // Add genes button behavior:
  // - if "All genes" checked: selectedGenes becomes full gene list
  // - else: merge pendingGenes into selectedGenes (dedupe), then clear pendingGenes
  const handleAddGenes = (row: HeatmapRow) => {
    if (!row.pathwayKey) return;

    const allGenes = geneCache[row.pathwayKey] || [];
    if (!allGenes.length) return;

    if (row.allGenes) {
      updateRow(row.id, { selectedGenes: allGenes, pendingGenes: [] });
      return;
    }

    const merged = new Set<string>();
    (row.selectedGenes || []).forEach((g) => merged.add(String(g)));
    (row.pendingGenes || []).forEach((g) => merged.add(String(g)));

    updateRow(row.id, {
      selectedGenes: Array.from(merged),
      pendingGenes: [],
    });
  };

  const renderSelectedGenesPanel = (row: HeatmapRow) => {
    if (!row.pathwayKey || !row.pathwayName) return null;
    if (!row.selectedGenes || row.selectedGenes.length === 0) return null;

    return (
      <div
        style={{
          marginTop: 10,
          padding: 10,
          borderRadius: 12,
          border: "1px solid #e5e7eb",
          background: "#f9fafb",
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 800,
            color: "#111827",
            marginBottom: 6,
          }}
        >
          Selected genes (for: {row.pathwayName})
        </div>

        <div
          style={{
            maxHeight: 150,
            overflow: "auto",
            padding: 8,
            borderRadius: 10,
            background: "#ffffff",
            border: "1px solid #e5e7eb",
            fontFamily: "monospace",
            fontSize: 12,
            color: "#334155",
          }}
        >
          {row.selectedGenes.join(", ")}
        </div>
      </div>
    );
  };

  return (
    <div style={{ marginTop: 8, marginBottom: 24 }}>
      <div style={{ marginBottom: 10 }}>
        <h3 style={{ margin: "0 0 6px 0", fontSize: 16 }}>
          Select pathway→gene rows for heatmap
        </h3>

        <div style={{ fontSize: 12, color: "#6b7280" }}>
          Sample: <code>{effectiveSampleId}</code> &nbsp;•&nbsp; Species:{" "}
          <code>{effectiveSpecies}</code>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          marginTop: 8,
          marginBottom: 8,
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={handleAddRow}
          style={{
            padding: "6px 10px",
            borderRadius: 9999,
            border: "1px solid #d1d5db",
            background: "#f3f4f6",
            fontSize: 13,
          }}
        >
          + Add pathway
        </button>

        <button
          type="button"
          onClick={handleRemoveRow}
          style={{
            padding: "6px 10px",
            borderRadius: 9999,
            border: "1px solid #d1d5db",
            background: "#f9fafb",
            fontSize: 13,
          }}
        >
          − Remove pathway
        </button>

        <button
          type="button"
          onClick={handleClearAll}
          style={{
            padding: "6px 10px",
            borderRadius: 9999,
            border: "1px solid #d1d5db",
            background: "#ffffff",
            fontSize: 13,
          }}
        >
          Clear all rows
        </button>

        <span style={{ fontSize: 13, color: "#4b5563" }}>
          <strong>Rows currently shown:</strong> {rows.length} (max {MAX_ROWS})
        </span>
      </div>

      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          color: "#4b5563",
        }}
      >
        <input
          type="checkbox"
          checked={showFullLists}
          onChange={(e) => setShowFullLists(e.target.checked)}
        />
        Show full gene lists by default in gene dropdowns
      </label>

      <p style={{ marginTop: 4, fontSize: 12, color: "#6b7280" }}>
        If unchecked, we show only the first 200 genes per pathway for
        responsiveness.
      </p>

      <div style={{ marginTop: 8, marginBottom: 10, fontSize: 12, color: "#6b7280" }}>
        {loadingPathways && <div>Loading pathways…</div>}
        {pathwayError && <div style={{ color: "#991b1b" }}>{pathwayError}</div>}
        {!loadingPathways && !pathwayError && pathways.length > 0 && (
          <div>
            Available pathways: <strong>{pathways.length}</strong>
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {rows.map((row, idx) => {
          const key = row.pathwayKey || "";
          const genesForPathway = key ? geneCache[key] || [] : [];
          const genesShown =
            !showFullLists && genesForPathway.length > 200
              ? genesForPathway.slice(0, 200)
              : genesForPathway;
          const tooMany =
            !showFullLists && genesForPathway.length > genesShown.length;

          return (
            <div
              key={row.id}
              style={{
                borderRadius: 14,
                border: "1px solid #e5e7eb",
                padding: 14,
                maxWidth: 980,
                width: "100%",
                minHeight: 360,
                background: "#ffffff",
              }}
            >
              <div
                style={{
                  marginBottom: 10,
                  fontSize: 13,
                  fontWeight: 800,
                  color: "#111827",
                }}
              >
                Row {idx + 1}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.35fr)",
                  gap: 14,
                  alignItems: "start",
                }}
              >
                <div>
                  <label
                    style={{
                      display: "block",
                      marginBottom: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#111827",
                    }}
                  >
                    Select pathway (row {idx + 1})
                  </label>

                  <select
                    value={row.pathwayKey ?? ""}
                    onChange={async (e) => {
                      const newKey = e.target.value || null;
                      const newName = newKey
                        ? pathwayNameByKey.get(newKey) || null
                        : null;

                      updateRow(row.id, {
                        pathwayKey: newKey,
                        pathwayName: newName,
                        allGenes: false,
                        pendingGenes: [],
                        selectedGenes: [],
                      });

                      if (newKey) {
                        try {
                          await fetchGenesIfNeeded(newKey);
                        } catch (err: any) {
                          console.error(
                            "Failed to load genes:",
                            err?.message || String(err)
                          );
                        }
                      }
                    }}
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      fontSize: 13,
                      borderRadius: 8,
                      border: "1px solid #111827",
                    }}
                    disabled={
                      loadingPathways || !!pathwayError || pathways.length === 0
                    }
                  >
                    <option value="">— Select pathway —</option>
                    {pathways.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.name}
                      </option>
                    ))}
                  </select>

                  {renderSelectedGenesPanel(row)}
                </div>

                <div>
                  {key ? (
                    <>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          flexWrap: "wrap",
                          marginBottom: 8,
                        }}
                      >
                        <label
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                            fontSize: 13,
                            fontWeight: 600,
                            color: "#111827",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={row.allGenes}
                            onChange={(e) => {
                              updateRow(row.id, {
                                allGenes: e.target.checked,
                              });
                            }}
                            disabled={!geneCache[key]}
                          />
                          All genes from this pathway
                        </label>

                        <button
                          type="button"
                          onClick={() => handleAddGenes(row)}
                          disabled={
                            !geneCache[key] ||
                            (!row.allGenes && row.pendingGenes.length === 0)
                          }
                          style={{
                            padding: "6px 10px",
                            borderRadius: 9999,
                            border: "1px solid #d1d5db",
                            background:
                              !geneCache[key] ||
                              (!row.allGenes && row.pendingGenes.length === 0)
                                ? "#f3f4f6"
                                : "#111827",
                            color:
                              !geneCache[key] ||
                              (!row.allGenes && row.pendingGenes.length === 0)
                                ? "#6b7280"
                                : "#ffffff",
                            fontSize: 13,
                            fontWeight: 700,
                            cursor:
                              !geneCache[key] ||
                              (!row.allGenes && row.pendingGenes.length === 0)
                                ? "default"
                                : "pointer",
                          }}
                          title={
                            row.allGenes
                              ? "Add all genes for this pathway"
                              : row.pendingGenes.length === 0
                              ? "Select genes first, then click Add genes"
                              : "Add selected genes"
                          }
                        >
                          Add genes
                        </button>
                      </div>

                      <label
                        style={{
                          display: "block",
                          marginBottom: 6,
                          fontSize: 13,
                          color: "#4b5563",
                        }}
                      >
                        Genes (row {idx + 1})
                      </label>

                      <select
                        multiple
                        disabled={!geneCache[key] || row.allGenes}
                        value={row.pendingGenes}
                        onChange={(e) => {
                          const opts = Array.from(e.target.selectedOptions).map(
                            (o) => o.value
                          );
                          updateRow(row.id, { pendingGenes: opts });
                        }}
                        style={{
                          width: "100%",
                          minHeight: 240,
                          padding: 8,
                          borderRadius: 12,
                          border: "1px solid #d1d5db",
                          fontSize: 13,
                        }}
                      >
                        {genesShown.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>

                      {tooMany && (
                        <p
                          style={{
                            marginTop: 6,
                            fontSize: 11,
                            color: "#6b7280",
                          }}
                        >
                          Showing first {genesShown.length} of{" "}
                          {genesForPathway.length} genes. Toggle{" "}
                          <strong>Show full gene lists</strong> above to view
                          all.
                        </p>
                      )}

                      {!row.allGenes && (
                        <p
                          style={{
                            marginTop: 6,
                            fontSize: 11,
                            color: "#6b7280",
                          }}
                        >
                          Select genes in the list, then click{" "}
                          <strong>Add genes</strong>. (You can add multiple
                          times.)
                        </p>
                      )}

                      {row.allGenes && geneCache[key] && (
                        <p
                          style={{
                            marginTop: 6,
                            fontSize: 11,
                            color: "#6b7280",
                          }}
                        >
                          <strong>All genes</strong> mode: click{" "}
                          <strong>Add genes</strong> to store all{" "}
                          {genesForPathway.length} genes under this pathway.
                        </p>
                      )}
                    </>
                  ) : (
                    <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 8 }}>
                      No pathway selected yet. Choose a pathway on the left to
                      see genes.
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default P06HeatmapGenerations;
