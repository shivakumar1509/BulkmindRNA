import React, { useEffect, useMemo, useState } from "react";

type Props = {
  apiBaseUrl?: string; // e.g. "http://localhost:8000"
  sampleId?: string; // pass from App.tsx
  currentUser?: string; // used for /users/<user>/rawdata/<sample>/
  authToken?: string | null;
};

const NONE_OPTION = "None";
const FIRST_OPTION = "Select all the comparisons";

// MUST match P01UploadRawdata LS key
const LS_SAMPLE_ID = "bulkmind.sampleId";

// Step-8 selection storage keys
const LS_VOLCANO = "bulkmind.volcano.selectedComparisons";
const LS_VOLCANO_ALL = "bulkmind.volcano.isAll";

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

function isAbortError(err: any): boolean {
  const name = String(err?.name || "");
  const message = String(err?.message || "").toLowerCase();
  return name === "AbortError" || message.includes("aborted");
}

const P05VolcanoPlots: React.FC<Props> = ({
  apiBaseUrl = "",
  sampleId: sampleIdProp,
  currentUser,
  authToken,
}) => {
  const [sampleId, setSampleId] = useState<string>(() => {
    const fromProp = (sampleIdProp || "").trim();
    if (fromProp) return fromProp;

    const fromLS = (safeGetLS(LS_SAMPLE_ID) || "").trim();
    if (fromLS) return fromLS;

    return "test";
  });

  useEffect(() => {
    const s = (sampleIdProp || "").trim();
    if (s) setSampleId(s);
  }, [sampleIdProp]);

  useEffect(() => {
    const handler = (ev: Event) => {
      const e = ev as CustomEvent<any>;
      const s = String(e?.detail?.sampleId || "").trim();
      if (s) setSampleId(s);
    };

    window.addEventListener("bulkmind:state", handler as EventListener);
    return () => window.removeEventListener("bulkmind:state", handler as EventListener);
  }, []);

  const base = useMemo(() => apiBaseUrl.replace(/\/+$/, ""), [apiBaseUrl]);

  const [comparisons, setComparisons] = useState<string[]>([NONE_OPTION, FIRST_OPTION]);

  // [] = none selected
  // ["Select all the comparisons"] = all selected
  // ["A_vs_B", "C_vs_D"] = specific comparisons
  const [selectedRows, setSelectedRows] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const comparisonsWithoutSpecial = useMemo(
    () => comparisons.filter((c) => c !== NONE_OPTION && c !== FIRST_OPTION),
    [comparisons]
  );

  const pickFirstReal = (list: string[]) => {
    const x = list.find((v) => v && v !== NONE_OPTION && v !== FIRST_OPTION);
    return x || "";
  };

  const pickNextUnused = (list: string[], used: string[]) => {
    const usedSet = new Set(used.map((v) => String(v || "").trim()));
    const candidate = list.find((v) => v && !usedSet.has(v));
    return candidate || (list[0] || "");
  };

  useEffect(() => {
    try {
      const isAll = selectedRows.length === 1 && selectedRows[0] === FIRST_OPTION;
      const valuesToSave = isAll
        ? [FIRST_OPTION]
        : selectedRows
            .map((x) => String(x || "").trim())
            .filter((x) => x && x !== NONE_OPTION && x !== FIRST_OPTION);

      safeSetLS(LS_VOLCANO_ALL, isAll ? "1" : "0");
      safeSetLS(LS_VOLCANO, JSON.stringify(valuesToSave));
    } catch {}

    window.dispatchEvent(new CustomEvent("bulkmind:selections"));
  }, [selectedRows]);

  useEffect(() => {
    try {
      const raw = safeGetLS(LS_VOLCANO);
      const isAll = safeGetLS(LS_VOLCANO_ALL) === "1";

      if (isAll) {
        setSelectedRows([FIRST_OPTION]);
        return;
      }

      if (!raw) {
        setSelectedRows([]);
        return;
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setSelectedRows([]);
        return;
      }

      const cleaned = parsed.map((x) => String(x || "").trim()).filter(Boolean);
      setSelectedRows(cleaned);
    } catch {
      setSelectedRows([]);
    }
  }, []);

  useEffect(() => {
    if (!base) return;

    const s = (sampleId || "").trim();
    if (!s) return;

    const abort = new AbortController();
    let isActive = true;

    setLoading(true);
    setError(null);

    const url =
      currentUser && currentUser.trim()
        ? `${base}/api/volcano/${encodeURIComponent(s)}/comparisons?username=${encodeURIComponent(
            currentUser
          )}`
        : `${base}/api/volcano/${encodeURIComponent(s)}/comparisons`;

    fetch(url, {
      signal: abort.signal,
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
    })
      .then(async (res) => {
        const text = await res.text();
        if (!res.ok) throw new Error(`${res.status} ${text || ""}`.trim());

        let data: any = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          data = {};
        }

        let list: string[] = [];
        if (Array.isArray(data)) list = data.map(String);
        else if (data && Array.isArray(data.comparisons)) list = data.comparisons.map(String);

        const seen = new Set<string>();
        const cleaned: string[] = [];

        for (const v of list) {
          const x = String(v ?? "").trim();
          if (!x) continue;
          if (x === NONE_OPTION || x === FIRST_OPTION) continue;
          if (seen.has(x)) continue;
          seen.add(x);
          cleaned.push(x);
        }

        if (!isActive) return;

        setComparisons([NONE_OPTION, FIRST_OPTION, ...cleaned]);

        setSelectedRows((prev) => {
          if (cleaned.length === 0) return [];

          if (prev.length === 1 && prev[0] === FIRST_OPTION) {
            return [FIRST_OPTION];
          }

          const valid = prev
            .map((v) => String(v || "").trim())
            .filter(
              (v) => v && v !== NONE_OPTION && v !== FIRST_OPTION && cleaned.includes(v)
            );

          return valid;
        });
      })
      .catch((e: any) => {
        if (!isActive || isAbortError(e)) return;

        setComparisons([NONE_OPTION, FIRST_OPTION]);
        setSelectedRows([]);
        setError(e?.message || String(e));
      })
      .finally(() => {
        if (!isActive) return;
        setLoading(false);
      });

    return () => {
      isActive = false;
      abort.abort();
    };
  }, [base, sampleId, currentUser, authToken]);

  const setRowValue = (rowIndex: number, value: string) => {
    const v = String(value || "").trim();

    if (v === NONE_OPTION) {
      setSelectedRows([]);
      return;
    }

    if (v === FIRST_OPTION) {
      setSelectedRows([FIRST_OPTION]);
      return;
    }

    setSelectedRows((prev) => {
      if (prev.length === 1 && prev[0] === FIRST_OPTION) return [v];

      const next = [...prev];
      next[rowIndex] = v;

      const cleaned = next
        .map((x) => String(x || "").trim())
        .filter((x) => x && x !== NONE_OPTION && x !== FIRST_OPTION);

      const seen = new Set<string>();
      return cleaned.filter((x) => {
        if (seen.has(x)) return false;
        seen.add(x);
        return true;
      });
    });
  };

  const handleAddComparison = () => {
    if (loading) return;
    if (comparisonsWithoutSpecial.length === 0) return;

    setSelectedRows((prev) => {
      if (prev.length === 0) {
        const first = pickFirstReal(comparisonsWithoutSpecial);
        return first ? [first] : [];
      }

      if (prev.length === 1 && prev[0] === FIRST_OPTION) {
        const first = pickFirstReal(comparisonsWithoutSpecial);
        const second = pickNextUnused(comparisonsWithoutSpecial, [first]) || first;
        return [first, second].filter(Boolean);
      }

      const used = prev.filter((x) => x && x !== NONE_OPTION && x !== FIRST_OPTION);
      const nextVal =
        pickNextUnused(comparisonsWithoutSpecial, used) ||
        pickFirstReal(comparisonsWithoutSpecial);

      if (!nextVal) return used;
      return [...used, nextVal];
    });
  };

  const firstRowValue =
    selectedRows.length === 0
      ? NONE_OPTION
      : selectedRows.length === 1 && selectedRows[0] === FIRST_OPTION
      ? FIRST_OPTION
      : selectedRows[0];

  const extraRows =
    selectedRows.length <= 1 || (selectedRows.length === 1 && selectedRows[0] === FIRST_OPTION)
      ? []
      : selectedRows.slice(1);

  return (
    <div style={{ marginTop: 8, marginBottom: 24 }}>
      <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
        Select comparison
      </label>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <select
          value={firstRowValue}
          onChange={(e) => setRowValue(0, e.target.value)}
          style={{
            width: "100%",
            padding: "6px 8px",
            fontSize: 13,
            borderRadius: 8,
            border: "1px solid #111827",
          }}
        >
          {comparisons.map((c) => (
            <option key={`row0-${c}`} value={c}>
              {c}
            </option>
          ))}
        </select>

        {extraRows.map((val, idx) => (
          <select
            key={`comp-row-${idx + 1}`}
            value={val}
            onChange={(e) => setRowValue(idx + 1, e.target.value)}
            style={{
              width: "100%",
              padding: "6px 8px",
              fontSize: 13,
              borderRadius: 8,
              border: "1px solid #111827",
            }}
          >
            {comparisonsWithoutSpecial.map((c) => (
              <option key={`${idx + 1}-${c}`} value={c}>
                {c}
              </option>
            ))}
          </select>
        ))}
      </div>

      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          onClick={handleAddComparison}
          disabled={loading || comparisonsWithoutSpecial.length === 0}
          style={{
            padding: "6px 10px",
            borderRadius: 9999,
            border: "1px solid #d1d5db",
            background: "#f3f4f6",
            fontSize: 13,
            cursor: loading || comparisonsWithoutSpecial.length === 0 ? "default" : "pointer",
            opacity: loading || comparisonsWithoutSpecial.length === 0 ? 0.7 : 1,
          }}
          title={
            comparisonsWithoutSpecial.length === 0
              ? "No comparisons available yet."
              : loading
              ? "Loading comparisons…"
              : "Add another comparison"
          }
        >
          + Add comparison
        </button>
      </div>

      {(loading || error) && (
        <p style={{ margin: "4px 0 0", fontSize: 11, color: error ? "#991b1b" : "#6b7280" }}>
          {loading ? "Loading comparisons…" : `Failed to fetch comparisons: ${error}`}
        </p>
      )}
    </div>
  );
};

export default P05VolcanoPlots;
