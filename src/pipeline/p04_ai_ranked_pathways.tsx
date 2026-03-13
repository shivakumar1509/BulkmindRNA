// src/pipeline/p04_ai_ranked_pathways.tsx
import React, { useEffect, useMemo, useState } from "react";

const FALLBACK_DISEASES: string[] = [
  "Alzheimer's disease",
  "Breast cancer",
  "Diabetes mellitus",
  "Parkinson's disease",
  "Inflammatory bowel disease",
  "Rheumatoid arthritis",
  "Cardiomyopathy",
];

const OTHER_LABEL = "Other (specify)";
const NA_LABEL = "NA";

// ✅ Step-8 selection storage key
const LS_DISEASE = "bulkmind.diseaseOfInterest";

type Props = {
  apiBaseUrl: string;
  species?: string;

  initialDisease?: string;
  initialSourceChoice?: string;

  onDiseaseChange?: (disease: string) => void;
  onSourceChoiceChange?: (source: string) => void;
};

const P04AiRankedPathways: React.FC<Props> = ({
  apiBaseUrl,
  species = "mouse",
  initialDisease,
  initialSourceChoice,
  onDiseaseChange,
  onSourceChoiceChange,
}) => {
  // ---- Disease state ----
  const [diseaseOptions, setDiseaseOptions] = useState<string[]>([]);
  const [selectedDisease, setSelectedDisease] = useState<string>(initialDisease || "");
  const [customDisease, setCustomDisease] = useState<string>("");
  const [diseaseLoading, setDiseaseLoading] = useState<boolean>(false);
  const [diseaseError, setDiseaseError] = useState<string>("");

  // ---- Multi-letter typeahead for <select> ----
  const [typeBuffer, setTypeBuffer] = useState<string>("");
  const [typeBufferTimer, setTypeBufferTimer] = useState<number | null>(null);

  // ---- DB source state (Reactome only) ----
  const sourceChoice = "Reactome";

  // Still notify parent (if it uses it)
  useEffect(() => {
    onSourceChoiceChange?.(sourceChoice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSourceChoiceChange]);

  // Load disease options when species changes (backend-driven)
  useEffect(() => {
    let cancelled = false;

    async function loadDiseases() {
      setDiseaseLoading(true);
      setDiseaseError("");

      try {
        const base = String(apiBaseUrl || "").trim().replace(/\/$/, "");
        if (!base) throw new Error("apiBaseUrl not set");

        const sp = String(species || "mouse").trim().toLowerCase();
        const url = `${base}/api/pathways/diseases?species=${encodeURIComponent(sp)}`;

        const res = await fetch(url, { method: "GET" });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Failed (${res.status}) ${text}`.trim());
        }

        const json = await res.json();
        const fromBackend: string[] = Array.isArray(json?.diseases) ? json.diseases : [];

        let opts: string[];
        if (!fromBackend.length) {
          opts = [...FALLBACK_DISEASES];
        } else {
          opts = fromBackend.map((x) => String(x).trim()).filter(Boolean);
        }

        // Ensure NA is first and Other is last
        opts = opts.filter((x) => x !== NA_LABEL && x !== OTHER_LABEL);
        opts.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
        opts.unshift(NA_LABEL);
        opts.push(OTHER_LABEL);

        if (!cancelled) setDiseaseOptions(opts);
      } catch (e: any) {
        const msg = e?.message ? String(e.message) : "Failed to load diseases";
        if (!cancelled) setDiseaseError(msg);

        let opts = [...FALLBACK_DISEASES];
        opts = opts.filter((x) => x !== NA_LABEL && x !== OTHER_LABEL);
        opts.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
        opts.unshift(NA_LABEL);
        opts.push(OTHER_LABEL);

        if (!cancelled) setDiseaseOptions(opts);
      } finally {
        if (!cancelled) setDiseaseLoading(false);
      }
    }

    loadDiseases();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, species]);

  // Initialize/keep selection once options arrive
  useEffect(() => {
    if (diseaseOptions.length === 0) return;

    // Keep current selection if still valid
    if (selectedDisease && diseaseOptions.includes(selectedDisease)) return;

    const init = (initialDisease || "").trim();

    // If initialDisease matches option, select it
    if (init && diseaseOptions.includes(init)) {
      setSelectedDisease(init);
      return;
    }

    // If initialDisease provided but not in list, treat as Other custom
    if (init && !diseaseOptions.includes(init) && init.toLowerCase() !== OTHER_LABEL.toLowerCase()) {
      setSelectedDisease(OTHER_LABEL);
      setCustomDisease(init);
      return;
    }

    // Default to NA (first)
    setSelectedDisease(NA_LABEL);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diseaseOptions]);

  const isOther = selectedDisease === OTHER_LABEL;
  const isNA = selectedDisease === NA_LABEL;

  const effectiveDisease = (isOther ? customDisease : selectedDisease).trim();

  // Notify parent
  useEffect(() => {
    onDiseaseChange?.(effectiveDisease);
  }, [effectiveDisease, onDiseaseChange]);

  // ✅ Persist disease-of-interest for Step 8 + notify
  useEffect(() => {
    try {
      const v = (effectiveDisease || "").trim();
      localStorage.setItem(LS_DISEASE, v);
    } catch {}
    window.dispatchEvent(new CustomEvent("bulkmind:selections"));
  }, [effectiveDisease]);

  // Custom multi-letter typeahead for <select>
  function handleDiseaseKeyDown(e: React.KeyboardEvent<HTMLSelectElement>) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const key = e.key;

    const navKeys = [
      "ArrowUp",
      "ArrowDown",
      "PageUp",
      "PageDown",
      "Home",
      "End",
      "Tab",
      "Enter",
      "Escape",
    ];
    if (navKeys.includes(key)) return;

    if (key === "Backspace") {
      e.preventDefault();
      const next = typeBuffer.slice(0, -1);
      setTypeBuffer(next);
      if (typeBufferTimer) window.clearTimeout(typeBufferTimer);
      const t = window.setTimeout(() => setTypeBuffer(""), 900);
      setTypeBufferTimer(t);
      return;
    }

    if (key.length !== 1) return;

    e.preventDefault();

    const next = (typeBuffer + key).toLowerCase();
    setTypeBuffer(next);

    if (typeBufferTimer) window.clearTimeout(typeBufferTimer);
    const t = window.setTimeout(() => setTypeBuffer(""), 900);
    setTypeBufferTimer(t);

    const match =
      diseaseOptions.find((opt) => opt.toLowerCase().startsWith(next)) ||
      diseaseOptions.find((opt) => opt.toLowerCase().includes(next));

    if (match) setSelectedDisease(match);
  }

  return (
    <div style={{ marginTop: 8, marginBottom: 24 }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 14, color: "#374151", lineHeight: 1.4 }}>
          We train on millions of database entries and publications to intelligently rank pathways by disease relevance —
          delivering clear, auditable, and clinically meaningful pathway candidates.
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: 14,
          maxWidth: 560,
        }}
      >
        {/* Disease */}
        <div>
          <label
            style={{
              display: "block",
              marginBottom: 6,
              fontSize: 14,
              fontWeight: 600,
              color: "#111827",
            }}
          >
            Disease of Interest
          </label>

          <select
            value={selectedDisease}
            onChange={(e) => setSelectedDisease(e.target.value)}
            onKeyDown={handleDiseaseKeyDown}
            disabled={diseaseLoading}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid #d1d5db",
              fontSize: 14,
              background: diseaseLoading ? "#f9fafb" : "#ffffff",
            }}
          >
            {diseaseOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>

          {isOther && (
            <input
              type="text"
              value={customDisease}
              onChange={(e) => setCustomDisease(e.target.value)}
              placeholder="Specify disease of interest"
              style={{
                marginTop: 10,
                width: "100%",
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid #d1d5db",
                fontSize: 14,
                background: "#ffffff",
              }}
            />
          )}

          <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
            <div>The selected disease will be used to prioritize AI-ranked pathway discovery.</div>
            <div style={{ marginTop: 4 }}>
              If no disease applies, choose NA. When NA is selected, AI-ranked pathway discovery uses statistical signals
              only (no disease prior).
            </div>
            {diseaseError && (
              <div style={{ marginTop: 6, color: "#b45309" }}>
                Using fallback list (API error: {diseaseError})
              </div>
            )}
            {typeBuffer && (
              <div style={{ marginTop: 6, color: "#6b7280" }}>
                Typing: <span style={{ fontWeight: 700 }}>{typeBuffer}</span>
              </div>
            )}
          </div>
        </div>

        {/* Source (Reactome default, no dropdown) */}
        <div>
          <label
            style={{
              display: "block",
              marginBottom: 6,
              fontSize: 14,
              fontWeight: 600,
              color: "#111827",
            }}
          >
            Source database to use
          </label>

          <div
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid #d1d5db",
              fontSize: 14,
              background: "#f9fafb",
              color: "#111827",
            }}
            title="Default source for AI-ranked pathway discovery"
          >
            Reactome
          </div>

          <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
            Defaulting to Reactome for AI-ranked pathway discovery.
          </div>
        </div>
      </div>
    </div>
  );
};

export default P04AiRankedPathways;

