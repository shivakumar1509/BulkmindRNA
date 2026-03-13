import React from "react";
import "./00_BulkMindHeader.css";

type BulkMindHeaderProps = {
  /** later we’ll pass the logged-in username here (e.g. "shiv06") */
  currentUser?: string;
  onLoginClick?: () => void;
  onBuyTokensClick?: () => void;
};

const BulkMindHeader: React.FC<BulkMindHeaderProps> = ({
  currentUser,
  onLoginClick,
  onBuyTokensClick,
}) => {
  const isLoggedIn = !!currentUser;

  return (
    <header className="bm-wrapper">
      <div className="bm-wrapper-inner">
        {/* Top auth bar */}
        <div className="bm-authbar">
          <div className="bm-auth-status">
            {isLoggedIn ? (
              <span className="bm-auth-pill bm-auth-pill-ok">
                <span className="bm-auth-dot" />
                Logged in as{" "}
                <span className="bm-auth-user">{currentUser}</span>
              </span>
            ) : (
              <span className="bm-auth-pill bm-auth-pill-guest">
                <span className="bm-auth-dot" />
                Guest mode — please log in
              </span>
            )}
          </div>

          <div className="bm-auth-actions">
            <button
              type="button"
              className="bm-auth-btn"
              onClick={onLoginClick}
            >
              Login
            </button>
            <button
              type="button"
              className="bm-auth-btn"
              onClick={onBuyTokensClick}
            >
              Buy tokens
            </button>
          </div>
        </div>

        {/* Brand + tagline */}
        <div className="bm-brand">
          <h1>BulkMind AI</h1>
          <div className="bm-sub">
            AI-Enhanced RNA-Seq: From Data to Discovery — No Coding, No Server
            Setup Needed
          </div>
        </div>

        {/* Feature cards */}
        <div className="feature-grid">
          <a className="feature-anchor" href="#outlier">
            <div className="feature-card">
              <div className="feature-icon" title="Neural QC">
                🤖
              </div>
              <div className="feature-meta">
                <div className="feature-title">
                  Neural QC — AI-Assisted Outlier Detection
                </div>
                <div className="feature-desc">
                  Fast QC that flags suspect samples.
                </div>
              </div>
            </div>
          </a>

          <a className="feature-anchor" href="#pathways">
            <div className="feature-card">
              <div className="feature-icon" title="AI-Pathway Discovery™">
                🧠
              </div>
              <div className="feature-meta">
                <div className="feature-title">
                  AI-Pathway Discovery™ — Disease-Relevant Pathways
                </div>
                <div className="feature-desc">
                  Prioritized pathways — focus on what matters.
                </div>
              </div>
            </div>
          </a>

          <a className="feature-anchor" href="#figures">
            <div className="feature-card">
              <div className="feature-icon" title="AI-Figure Builder™">
                ✨
              </div>
              <div className="feature-meta">
                <div className="feature-title">
                  AI-Figure Builder™ — Publication-Ready Plots
                </div>
                <div className="feature-desc">
                  Export-ready visuals and suggested captions.
                </div>
              </div>
            </div>
          </a>
        </div>
      </div>
    </header>
  );
};

export default BulkMindHeader;

