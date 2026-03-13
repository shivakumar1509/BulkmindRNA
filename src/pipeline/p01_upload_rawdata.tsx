// src/pipeline/p01_upload_rawdata.tsx
import React, { useEffect, useRef, useState } from "react";
import "./p01_upload_rawdata.css";

type Props = {
  apiBaseUrl?: string; // e.g. "http://localhost:8000"
  initialSampleId?: string; // default "test"
  initialSpecies?:
    | "mouse"
    | "human"
    | "rat"
    | "pig"
    | "arabidopsis"
    | "wheat"
    | "zebrafish"
    | "chicken"
    | "cow"
    | "dog"
    | "rice";
  initialRelease?: "113" | "114" | "115";
  /**
   * Optional callback so the parent can keep global state:
   * sampleId / species / release are needed by other steps.
   */
  onStateChange?: (state: {
    sampleId: string;
    species: string;
    release: string;
    uploadedRawName?: string | null;
  }) => void;

  /** Logged-in username (e.g. "shiv06"); when undefined, we’re in guest mode */
  currentUser?: string;
  /** Token returned by /api/auth/login (for later use) */
  authToken?: string | null;
};

type SampleListResponse = {
  samples: string[];
};

const speciesOptions: Array<
  | "mouse"
  | "human"
  | "rat"
  | "pig"
  | "arabidopsis"
  | "wheat"
  | "zebrafish"
  | "chicken"
  | "cow"
  | "dog"
  | "rice"
> = ["mouse", "human", "rat", "pig", "arabidopsis", "wheat", "zebrafish", "chicken", "cow", "dog", "rice"];

const releaseOptions: Array<"113" | "114" | "115"> = ["113", "114", "115"];

// sentinel value for "new sample" option in the dropdown
const NEW_SAMPLE_VALUE = "__new__";

// ---- Local storage keys (no App.tsx wiring needed) ----
const LS_KEYS = {
  sampleId: "bulkmind.sampleId",
  species: "bulkmind.species",
  release: "bulkmind.release",
  uploadedRawName: "bulkmind.uploadedRawName",
  // NEW (frontend-only for now)
  uploadExpectedMode: "bulkmind.uploadExpectedMode", // "expected" | "unknown"
  uploadExpectedCount: "bulkmind.uploadExpectedCount", // string number
};

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
  } catch {
    // ignore
  }
}

function safeRemoveLS(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function dispatchGlobalState(state: {
  sampleId: string;
  species: string;
  release: string;
  uploadedRawName?: string | null;
}) {
  try {
    window.dispatchEvent(
      new CustomEvent("bulkmind:state", {
        detail: state,
      })
    );
  } catch {
    // ignore
  }
}

/**
 * React version of 2_upload_rawdata.py
 */
const P01UploadRawdata: React.FC<Props> = ({
  apiBaseUrl = "",
  initialSampleId = "test",
  initialSpecies = "mouse",
  initialRelease = "113",
  onStateChange,
  currentUser,
  authToken,
}) => {
  const [availableSamples, setAvailableSamples] = useState<string[]>(["test"]);

  // existing sample chosen from dropdown
  const [sampleId, setSampleId] = useState<string>(initialSampleId);

  // whether the user is typing a new sample instead of using an existing one
  const [isCustomSample, setIsCustomSample] = useState<boolean>(false);
  const [customSampleName, setCustomSampleName] = useState<string>("");

  const [species, setSpecies] = useState<
    | "mouse"
    | "human"
    | "rat"
    | "pig"
    | "arabidopsis"
    | "wheat"
    | "zebrafish"
    | "chicken"
    | "cow"
    | "dog"
    | "rice"
  >(initialSpecies);
  const [release, setRelease] = useState<"113" | "114" | "115">(initialRelease);

  const [file, setFile] = useState<File | null>(null);
  const [uploadedName, setUploadedName] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<"info" | "error" | "success">("info");

  // ---- Upload mode + hidden file input ----
  const [uploadMode, setUploadMode] = useState<"file" | "link" | "none">("none");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ---- Link import UI state ----
  const [linkText, setLinkText] = useState<string>("");
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [linkUsername, setLinkUsername] = useState<string>("");
  const [linkPassword, setLinkPassword] = useState<string>("");
  const [checksum, setChecksum] = useState<string>("");

  // ---- NEW: expected count UI state (frontend-only for now) ----
  const [expectedMode, setExpectedMode] = useState<"expected" | "unknown">("unknown");
  const [expectedCountText, setExpectedCountText] = useState<string>("");

  const loggedIn = !!currentUser;

  // ---- Hydrate from localStorage ----
  useEffect(() => {
    const savedSample = safeGetLS(LS_KEYS.sampleId);
    const savedSpecies = safeGetLS(LS_KEYS.species);
    const savedRelease = safeGetLS(LS_KEYS.release);
    const savedUploaded = safeGetLS(LS_KEYS.uploadedRawName);

    // NEW
    const savedMode = safeGetLS(LS_KEYS.uploadExpectedMode);
    const savedCount = safeGetLS(LS_KEYS.uploadExpectedCount);

    if (savedSample && savedSample.trim()) {
      setSampleId(savedSample.trim());
      setIsCustomSample(false);
    }
    if (savedSpecies && (speciesOptions as string[]).includes(savedSpecies)) {
      setSpecies(savedSpecies as any);
    }
    if (savedRelease && (releaseOptions as string[]).includes(savedRelease)) {
      setRelease(savedRelease as any);
    }
    if (savedUploaded && savedUploaded.trim()) {
      setUploadedName(savedUploaded.trim());
    }

    // NEW
    if (savedMode === "expected" || savedMode === "unknown") {
      setExpectedMode(savedMode);
    }
    if (savedCount && savedCount.trim()) {
      setExpectedCountText(savedCount.trim());
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Fetch available samples list from backend for this user ---
  useEffect(() => {
    const base = apiBaseUrl.replace(/\/+$/, "");
    if (!base) return;

    const url =
      currentUser && currentUser.trim().length > 0
        ? `${base}/api/samples?username=${encodeURIComponent(currentUser)}`
        : `${base}/api/samples`;

    const abort = new AbortController();

    fetch(url, { signal: abort.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as SampleListResponse | string[] | null;

        let samples: string[] = ["test"];
        if (Array.isArray(data)) {
          samples = data;
        } else if (data && Array.isArray((data as any).samples)) {
          samples = (data as any).samples;
        }
        if (!samples || samples.length === 0) samples = ["test"];

        const selected = (isCustomSample ? customSampleName : sampleId).trim();
        if (selected && !samples.includes(selected)) {
          samples = [selected, ...samples];
        }

        setAvailableSamples(samples);

        if (!isCustomSample && !sampleId && samples.length > 0) {
          setSampleId(samples[0]);
        }
      })
      .catch(() => {
        setAvailableSamples((prev) => (prev.length ? prev : ["test"]));
      });

    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBaseUrl, currentUser]);

  // notify parent + persist global selection
  useEffect(() => {
    const effectiveSample = isCustomSample ? customSampleName : sampleId;
    const cleanSample = (effectiveSample || "").trim();

    if (cleanSample) safeSetLS(LS_KEYS.sampleId, cleanSample);
    if (species) safeSetLS(LS_KEYS.species, species);
    if (release) safeSetLS(LS_KEYS.release, release);
    if (uploadedName) safeSetLS(LS_KEYS.uploadedRawName, uploadedName);
    else safeRemoveLS(LS_KEYS.uploadedRawName);

    // NEW: persist upload expectations (frontend-only)
    safeSetLS(LS_KEYS.uploadExpectedMode, expectedMode);
    if (expectedMode === "expected") {
      if (expectedCountText.trim()) safeSetLS(LS_KEYS.uploadExpectedCount, expectedCountText.trim());
      else safeRemoveLS(LS_KEYS.uploadExpectedCount);
    } else {
      safeRemoveLS(LS_KEYS.uploadExpectedCount);
    }

    const state = {
      sampleId: cleanSample || initialSampleId,
      species,
      release,
      uploadedRawName: uploadedName || null,
    };

    if (onStateChange) onStateChange(state);
    dispatchGlobalState(state);
  }, [
    sampleId,
    customSampleName,
    isCustomSample,
    species,
    release,
    uploadedName,
    onStateChange,
    initialSampleId,
    expectedMode,
    expectedCountText,
  ]);

  const handleApplyUpload = async () => {
    setMessage(null);

    if (!loggedIn) {
      setMessageType("error");
      setMessage("Please log in before uploading rawdata.");
      return;
    }

    if (uploadMode === "none") {
      setMessageType("error");
      setMessage("Please choose Upload file or Upload via link first.");
      return;
    }

    // link import
    if (uploadMode === "link") {
      if (!linkText.trim()) {
        setMessageType("error");
        setMessage("Please paste at least one URL (one per line).");
        return;
      }

      const rawSampleName = isCustomSample ? customSampleName : sampleId;
      const sampleClean = rawSampleName.trim();

      if (!sampleClean) {
        setMessageType("error");
        setMessage("Sample name is required.");
        return;
      }
      if (!/^[A-Za-z0-9_]+$/.test(sampleClean)) {
        setMessageType("error");
        setMessage("Sample name can only contain letters, digits, and underscores (_). No spaces or special characters.");
        return;
      }

      const base = apiBaseUrl.replace(/\/+$/, "");
      if (!base) {
        setMessageType("error");
        setMessage("Upload endpoint not configured (missing apiBaseUrl). Please contact the administrator.");
        return;
      }

      setBusy(true);
      try {
        const res = await fetch(`${base}/api/uploads/import`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({
            sample_id: sampleClean,
            username: currentUser,
            species,
            release,
            urls_text: linkText,
            link_username: linkUsername || null,
            link_password: linkPassword || null,
            checksum: checksum || null,
          }),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `HTTP ${res.status}`);
        }

        const data = await res.json().catch(() => ({}));
        const jobId = (data && (data.job_id || data.id)) || null;
        const storedName = jobId ? `import_job:${jobId}` : "import_started";

        setUploadedName(storedName);

        if (isCustomSample) setCustomSampleName(sampleClean);
        else setSampleId(sampleClean);

        setAvailableSamples((prev) => {
          const next = Array.isArray(prev) ? [...prev] : [];
          if (!next.includes(sampleClean)) next.unshift(sampleClean);
          return next.length ? next : ["test"];
        });

        safeSetLS(LS_KEYS.sampleId, sampleClean);
        safeSetLS(LS_KEYS.species, species);
        safeSetLS(LS_KEYS.release, release);
        safeSetLS(LS_KEYS.uploadedRawName, storedName);

        dispatchGlobalState({ sampleId: sampleClean, species, release, uploadedRawName: storedName });

        setMessageType("success");
        setMessage(jobId ? `Import started. Job ID: ${jobId}.` : "Import started.");
      } catch (e: any) {
        setMessageType("error");
        setMessage(`Failed to start import: ${e?.message || String(e)}. Check the backend endpoint /api/uploads/import.`);
      } finally {
        setBusy(false);
      }
      return;
    }

    // file upload
    if (!file) {
      setMessageType("error");
      setMessage("No file selected. Click “Upload file” and choose a rawdata file first.");
      return;
    }

    const rawSampleName = isCustomSample ? customSampleName : sampleId;
    const sampleClean = rawSampleName.trim();

    if (!sampleClean) {
      setMessageType("error");
      setMessage("Sample name is required.");
      return;
    }
    if (!/^[A-Za-z0-9_]+$/.test(sampleClean)) {
      setMessageType("error");
      setMessage("Sample name can only contain letters, digits, and underscores (_). No spaces or special characters.");
      return;
    }

    const base = apiBaseUrl.replace(/\/+$/, "");
    if (!base) {
      setMessageType("error");
      setMessage("Upload endpoint not configured (missing apiBaseUrl). Please contact the administrator.");
      return;
    }

    const url = `${base}/api/uploads/raw`;

    const form = new FormData();
    form.append("file", file);
    form.append("sample_id", sampleClean);
    form.append("species", species);
    form.append("release", release);
    if (currentUser) form.append("username", currentUser);

    setBusy(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        body: form,
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = await res.json().catch(() => ({}));
      const storedName = (data && (data.uploaded_name || data.filename || data.name)) || file.name;

      setUploadedName(storedName);

      if (isCustomSample) setCustomSampleName(sampleClean);
      else setSampleId(sampleClean);

      setAvailableSamples((prev) => {
        const next = Array.isArray(prev) ? [...prev] : [];
        if (!next.includes(sampleClean)) next.unshift(sampleClean);
        return next.length ? next : ["test"];
      });

      safeSetLS(LS_KEYS.sampleId, sampleClean);
      safeSetLS(LS_KEYS.species, species);
      safeSetLS(LS_KEYS.release, release);
      safeSetLS(LS_KEYS.uploadedRawName, storedName);

      dispatchGlobalState({ sampleId: sampleClean, species, release, uploadedRawName: storedName });

      setMessageType("success");
      setMessage(`Uploaded rawdata "${storedName}" stored for sample "${sampleClean}".`);
    } catch (err: any) {
      setMessageType("error");
      setMessage(`Failed to upload rawdata: ${err?.message || String(err)}. Check the backend endpoint /api/uploads/raw.`);
    } finally {
      setBusy(false);
    }
  };

  const renderMessage = () => {
    if (!message) return null;
    let bg = "#eff6ff";
    let border = "#bfdbfe";
    let color = "#1e40af";
    if (messageType === "error") {
      bg = "#fef2f2";
      border = "#fecaca";
      color = "#991b1b";
    } else if (messageType === "success") {
      bg = "#ecfdf3";
      border = "#bbf7d0";
      color = "#166534";
    }

    return (
      <div
        style={{
          marginTop: 8,
          padding: "6px 10px",
          borderRadius: 8,
          background: bg,
          border: `1px solid ${border}`,
          color,
          fontSize: 12,
        }}
      >
        {message}
      </div>
    );
  };

  const disabledReason = !loggedIn ? "Log in to upload rawdata." : busy ? "Uploading…" : "";

  let genomeHint = "";
  if (species === "mouse") genomeHint = "Genome build: GRCm39 (mouse) — Ensembl release 113 / 114 / 115.";
  else if (species === "human") genomeHint = "Genome build: GRCh38 (human) — Ensembl release 113 / 114 / 115.";
  else if (species === "rat") genomeHint = "Genome build: Ensembl rat genome — releases 113 / 114 / 115.";
  else genomeHint = "Genome build: Sus scrofa (pig) — Ensembl release 113 / 114 / 115.";

  const effectiveSampleName = (isCustomSample ? customSampleName : sampleId).trim();

  const expectedCountNum =
    expectedMode === "expected" && expectedCountText.trim() ? parseInt(expectedCountText.trim(), 10) : NaN;
  const expectedCountValid = expectedMode === "unknown" ? true : Number.isFinite(expectedCountNum) && expectedCountNum > 0;

  return (
    <div style={{ marginTop: 8 }}>
      <p style={{ margin: "0 0 10px", fontSize: 13, color: "#4b5563" }}>
        Upload raw sequencing files, then choose sample name, species, and reference release. This does <strong>not</strong>{" "}
        run the pipeline; it just registers inputs on the server.
      </p>

      {!loggedIn && (
        <div
          style={{
            marginBottom: 10,
            padding: "6px 10px",
            borderRadius: 8,
            background: "#fef3c7",
            border: "1px solid #fed7aa",
            color: "#92400e",
            fontSize: 12,
          }}
        >
          You’re in guest mode. Please use the <strong>Login</strong> button above before uploading rawdata.
        </div>
      )}

      {/* Upload header */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
          Upload rawdata (.fq / .fq.gz / .fastq / .fastq.gz / .bam / .cram / .ora)
        </label>

        {/* Two identical choice buttons */}
        <div className="bm-upload-row">
          <div className="bm-upload-left">
            <button
              type="button"
              className={`bm-choice-btn ${uploadMode === "file" ? "is-active" : ""}`}
              onClick={() => {
                setUploadMode("file");
                setFile(null);
                setMessage(null);
                fileInputRef.current?.click();
              }}
              disabled={busy || !loggedIn}
              title={!loggedIn ? "Log in to upload rawdata." : ""}
            >
              Upload file
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".fq,.fastq,.gz,.bam,.cram,.ora"
              className="bm-hidden-file"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                setFile(f);
                setMessage(null);
              }}
              disabled={busy || !loggedIn}
            />

            <div className="bm-upload-subtext">Choose a local file to upload</div>

            {file && (
              <div className="bm-picked">
                Selected: <code>{file.name}</code>{" "}
                <span className="bm-picked-muted">({(file.size / (1024 * 1024)).toFixed(2)} MB)</span>
              </div>
            )}

            {uploadedName && (
              <div className="bm-picked bm-picked-ok">
                Stored on server as <code>{uploadedName}</code>
              </div>
            )}
          </div>

          <div className="bm-upload-or-wrap">
            <div className="bm-or-pill">OR</div>
          </div>

          <div className="bm-upload-right">
            <button
              type="button"
              className={`bm-choice-btn ${uploadMode === "link" ? "is-active" : ""}`}
              onClick={() => {
                setUploadMode("link");
                setMessage(null);
              }}
              disabled={busy || !loggedIn}
              title={!loggedIn ? "Log in to import via link." : ""}
            >
              Upload via link
            </button>

            <div className="bm-upload-subtext">Import from a provider link (HTTPS / FTP).</div>
          </div>
        </div>

        <p className="bm-global-help">
          After choosing a file, select an existing sample or type a new one, then click <strong>Upload rawdata</strong>{" "}
          to send it to the server.
        </p>
      </div>

      {/* Link import UI */}
      {uploadMode === "link" && (
        <div className="bm-link-import">
          <div className="bm-link-card">
            <div className="bm-link-card-head">
              <div>
                <div className="bm-link-title">Import via link</div>
                <div className="bm-link-sub">
                  We’ll download the files to our server and validate them. You can close this page — imports continue in the
                  background.
                </div>
              </div>
            </div>

            <label className="bm-link-label">File URL(s) (one per line)</label>
            <textarea
              className="bm-link-textarea"
              value={linkText}
              onChange={(e) => setLinkText(e.target.value)}
              rows={4}
              placeholder="sftp://user:pass@usftp22.novogene.com/path/to/run/  (or https://.../file.fastq.gz)"
            />

            <button type="button" className="bm-link-advanced-toggle" onClick={() => setShowAdvanced((s) => !s)}>
              {showAdvanced ? "Hide advanced" : "Show advanced"}
            </button>

            {showAdvanced && (
              <div className="bm-link-advanced">
                <div className="bm-link-row">
                  <div className="bm-link-col">
                    <label className="bm-link-label">Username (optional)</label>
                    <input
                      className="bm-link-input"
                      value={linkUsername}
                      onChange={(e) => setLinkUsername(e.target.value)}
                      placeholder="username"
                    />
                  </div>
                  <div className="bm-link-col">
                    <label className="bm-link-label">Password / Token (optional)</label>
                    <input
                      className="bm-link-input"
                      type="password"
                      value={linkPassword}
                      onChange={(e) => setLinkPassword(e.target.value)}
                      placeholder="password or token"
                    />
                  </div>
                </div>

                <label className="bm-link-label">Checksum (MD5/SHA256) (optional, recommended)</label>
                <input
                  className="bm-link-input"
                  value={checksum}
                  onChange={(e) => setChecksum(e.target.value)}
                  placeholder="md5:abcd... or sha256:abcd..."
                />
              </div>
            )}
          </div>
        </div>
      )}

      <hr style={{ margin: "12px 0", borderColor: "#e5e7eb" }} />

      {/* Sample name row */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Sample name</label>

        <select
          value={isCustomSample ? NEW_SAMPLE_VALUE : sampleId}
          onChange={(e) => {
            const v = e.target.value;
            if (v === NEW_SAMPLE_VALUE) {
              setIsCustomSample(true);
              setMessage(null);
            } else {
              setIsCustomSample(false);
              setSampleId(v);
              setMessage(null);
            }
          }}
          style={{
            width: "100%",
            padding: "6px 8px",
            fontSize: 13,
            borderRadius: 8,
            border: "1px solid #111827",
            marginBottom: isCustomSample ? 6 : 4,
          }}
        >
          {availableSamples.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
          <option value={NEW_SAMPLE_VALUE}>➕ Type a new sample name…</option>
        </select>

        {isCustomSample && (
          <input
            value={customSampleName}
            onChange={(e) => {
              setCustomSampleName(e.target.value);
              setMessage(null);
            }}
            placeholder="e.g. Bl6_M01_1"
            style={{
              width: "100%",
              marginTop: 4,
              padding: "6px 8px",
              fontSize: 13,
              borderRadius: 8,
              border: "1px solid #111827",
            }}
          />
        )}

        <p style={{ margin: "4px 0", fontSize: 11, color: "#6b7280" }}>
          Sample names may contain only letters, digits, and underscores (A–Z, 0–9, _) with no spaces. Folders from previous
          runs are listed in the dropdown above.
        </p>

        {effectiveSampleName && (
          <p style={{ margin: "2px 0", fontSize: 11, color: "#4b5563" }}>
            Current sample: <code>{effectiveSampleName}</code>{" "}
            <span style={{ color: "#6b7280" }}>(saved for other steps)</span>
          </p>
        )}
      </div>

      {/* Species + release row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <div>
          <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Your sample species</label>
          <select
            value={species}
            onChange={(e) => {
              const v = e.target.value as any;
              setSpecies(v);
              setMessage(null);
            }}
            style={{
              width: "100%",
              padding: "6px 8px",
              fontSize: 13,
              borderRadius: 8,
              border: "1px solid #111827",
            }}
          >
            {speciesOptions.map((sp) => (
              <option key={sp} value={sp}>
                {sp}
              </option>
            ))}
          </select>
          <p style={{ margin: "4px 0", fontSize: 11, color: "#6b7280" }}>Species not listed? Contact us.</p>
        </div>

        <div>
          <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
            Mapping to reference genome release
          </label>
          <select
            value={release}
            onChange={(e) => {
              const v = e.target.value as "113" | "114" | "115";
              setRelease(v);
              setMessage(null);
            }}
            style={{
              width: "100%",
              padding: "6px 8px",
              fontSize: 13,
              borderRadius: 8,
              border: "1px solid #111827",
            }}
          >
            {releaseOptions.map((rel) => (
              <option key={rel} value={rel}>
                {rel}
              </option>
            ))}
          </select>
          <p style={{ margin: "4px 0", fontSize: 11, color: "#6b7280" }}>{genomeHint}</p>
        </div>
      </div>

      {/* NEW: Expected upload count / unknown option (placed below species block, above upload button) */}
      <div style={{ marginTop: 12 }}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
          Upload progress (optional): Expected files
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <div>
            <input
              value={expectedMode === "expected" ? expectedCountText : ""}
              onChange={(e) => {
                // allow empty, digits only
                const v = e.target.value;
                if (v === "" || /^[0-9]+$/.test(v)) setExpectedCountText(v);
              }}
              onFocus={() => setExpectedMode("expected")}
              placeholder="e.g. 40"
              disabled={expectedMode === "unknown"}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "9px 10px",
                fontSize: 12,
                borderRadius: 12,
                border: "1px solid #cbd5e1",
                background: expectedMode === "unknown" ? "#f3f4f6" : "#fff",
                outline: "none",
              }}
            />
            <p style={{ margin: "6px 0 0", fontSize: 11, color: "#6b7280", lineHeight: 1.35 }}>
              If you know the total number of files you’ll upload, we can show progress like <code>20/40</code>.
            </p>
            {expectedMode === "expected" && !expectedCountValid && (
              <p style={{ margin: "6px 0 0", fontSize: 11, color: "#991b1b" }}>
                Please enter a number greater than 0, or choose “I don’t know”.
              </p>
            )}
          </div>

          <div>

            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "#0f172a" }}>
              <input
                type="checkbox"
                checked={expectedMode === "unknown"}
                onChange={(e) => {
                  const checked = e.target.checked;
                  if (checked) {
                    setExpectedMode("unknown");
                  } else {
                    setExpectedMode("expected");
                  }
                }}
              />
              Upload any number of files, then finalize when done.
            </label>

            <p style={{ margin: "6px 0 0", fontSize: 11, color: "#6b7280", lineHeight: 1.35 }}>
              Choose this if you’re not sure how many files you will upload.
            </p>
          </div>
        </div>
      </div>

      {/* Action button + status */}
      <div style={{ marginTop: 14 }}>
        <button
          type="button"
          onClick={handleApplyUpload}
          disabled={busy || !loggedIn}
          style={{
            padding: "10px 26px",
            fontSize: 15,
            fontWeight: 700,
            borderRadius: 9999,
            border: "none",
            background: busy || !loggedIn ? "#9ca3af" : "#1B427A",
            color: "#ffffff",
            cursor: busy || !loggedIn ? "default" : "pointer",
            boxShadow: "0 8px 20px rgba(27,66,122,0.22)",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
          title={disabledReason}
        >
          <span aria-hidden="true">⬆️</span>
          <span>Upload rawdata</span>
        </button>
        {renderMessage()}
      </div>
    </div>
  );
};

export default P01UploadRawdata;

