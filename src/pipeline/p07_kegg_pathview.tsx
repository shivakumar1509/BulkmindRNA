// src/pipeline/p08_kegg_pathview.tsx
import React, { useEffect, useMemo, useState } from "react";

type Props = {
  apiBaseUrl?: string; // e.g. "http://localhost:8000"
  sampleId?: string; // pass from App.tsx
  currentUser?: string; // used for /users/<user>/rawdata/<sample>/
  authToken?: string | null;
};

// MUST match P01UploadRawdata LS key
const LS_SAMPLE_ID = "bulkmind.sampleId";

// Persist Step-8 comparison selections for final Apply step
const LS_VOLCANO_SELECTED = "bulkmind.volcano.selectedComparisons";
const LS_VOLCANO_IS_ALL = "bulkmind.volcano.isAll";

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

/**
 * Step 7/8 — Top enriched pathways
 * Always uses ALL comparisons already defined upstream (Step 2).
 * No dropdowns, no add/remove comparison UI.
 */
const P08KeggPathview: React.FC<Props> = ({
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
    return () =>
      window.removeEventListener("bulkmind:state", handler as EventListener);
  }, []);

  const base = useMemo(() => apiBaseUrl.replace(/\/+$/, ""), [apiBaseUrl]);

  const [comparisons, setComparisons] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Always persist ALL mode for downstream Apply step
  useEffect(() => {
    safeSetLS(LS_VOLCANO_IS_ALL, "1");
    safeSetLS(LS_VOLCANO_SELECTED, JSON.stringify([]));
    window.dispatchEvent(new CustomEvent("bulkmind:selections"));
  }, []);

  useEffect(() => {
    if (!base) {
      setComparisons([]);
      setError("API base URL not configured (missing apiBaseUrl).");
      setLoading(false);
      return;
    }

    const s = (sampleId || "").trim();
    if (!s) {
      setComparisons([]);
      setError("Sample ID is missing.");
      setLoading(false);
      return;
    }

    const abort = new AbortController();
    setLoading(true);
    setError(null);

    const url =
      currentUser && currentUser.trim()
        ? `${base}/api/volcano/${encodeURIComponent(
            s
          )}/comparisons?username=${encodeURIComponent(currentUser)}`
        : `${base}/api/volcano/${encodeURIComponent(s)}/comparisons`;

    const run = async () => {
      try {
        const res = await fetch(url, {
          signal: abort.signal,
          headers: authToken
            ? { Authorization: `Bearer ${authToken}` }
            : undefined,
        });

        const text = await res.text();
        if (!res.ok) {
          throw new Error(`${res.status} ${text || ""}`.trim());
        }

        let data: any = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          data = {};
        }

        let list: string[] = [];
        if (Array.isArray(data)) {
          list = data.map(String);
        } else if (data && Array.isArray(data.comparisons)) {
          list = data.comparisons.map(String);
        }

        const seen = new Set<string>();
        const cleaned: string[] = [];

        for (const v of list) {
          const x = String(v ?? "").trim();
          if (!x) continue;
          if (seen.has(x)) continue;
          seen.add(x);
          cleaned.push(x);
        }

        setComparisons(cleaned);
      } catch (e: any) {
        if (
          e?.name === "AbortError" ||
          String(e?.message || "")
            .toLowerCase()
            .includes("aborted")
        ) {
          return;
        }

        setComparisons([]);
        setError(e?.message || String(e));
      } finally {
        if (!abort.signal.aborted) {
          setLoading(false);
        }
      }
    };

    run();

    return () => abort.abort();
  }, [base, sampleId, currentUser, authToken]);

  return (
    <div style={{ marginTop: 8, marginBottom: 24 }}>
      <h3 style={{ margin: "0 0 6px 0", fontSize: 16 }}>
        Top 15 enriched pathways
      </h3>

      <p style={{ margin: "0 0 12px 0", fontSize: 13, color: "#4b5563" }}>
        Top 15 enriched pathways (ranked by Z-score and AI ranking) are
        generated for all comparisons selected in Step 2.
      </p>

      <div
        style={{
          padding: 12,
          borderRadius: 12,
          border: "1px solid #e5e7eb",
          background: "#f9fafb",
          fontSize: 13,
          color: "#374151",
        }}
      >
        {loading && <div>Loading comparisons…</div>}

        {!loading && error && (
          <div style={{ color: "#991b1b" }}>
            Failed to fetch comparisons: {error}
          </div>
        )}

        {!loading && !error && (
          <>
            <div style={{ fontWeight: 600, color: "#111827", marginBottom: 4 }}>
              Comparison source
            </div>
            <div>
              This step will run for all comparisons already selected in Step 2.
            </div>

            {comparisons.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
                Comparisons detected: <strong>{comparisons.length}</strong>
              </div>
            )}

            {comparisons.length === 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
                No comparisons were returned yet from the backend.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default P08KeggPathview;
