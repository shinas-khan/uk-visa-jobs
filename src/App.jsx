import { useState, useCallback } from "react";

// ============================================================
// CONFIGURATION - Add your API keys here
// ============================================================
const CONFIG = {
  REED_API_KEY: "6a03366e-5212-49f8-944b-f1e9f070a072", // Get from: https://www.reed.co.uk/developers/jobseeker
  ADZUNA_APP_ID: "344e86d1", // Get from: https://developer.adzuna.com/
  ADZUNA_APP_KEY: "cbbf437557273d6afab7489f52225f9e",
};

// ============================================================
// VISA SPONSORSHIP INTELLIGENCE ENGINE
// ============================================================
const VISA_KEYWORDS = [
  "visa sponsorship", "sponsor visa", "skilled worker visa", "tier 2", "tier2",
  "certificate of sponsorship", "cos", "ukvi", "sponsorship available",
  "will sponsor", "visa support", "work permit", "sponsorship provided",
  "relocation package", "international applicants welcome", "right to work not required",
];

const FRESHER_KEYWORDS = [
  "graduate", "entry level", "junior", "trainee", "apprentice", "no experience",
  "0-1 year", "0-2 year", "fresh graduate", "new graduate", "school leaver",
  "recently graduated", "grad scheme", "graduate scheme", "placement",
  "internship", "associate", "assistant", "beginner",
];

const SPONSORSHIP_NEGATIVE_KEYWORDS = [
  "must have right to work", "must be eligible to work", "no sponsorship",
  "sponsorship not available", "cannot sponsor", "uk residents only",
  "british nationals only", "indefinite leave to remain",
];

// Employers known to sponsor visas regularly in the UK
const KNOWN_SPONSOR_EMPLOYERS = [
  "amazon", "google", "microsoft", "meta", "apple", "ibm", "accenture",
  "deloitte", "pwc", "kpmg", "ey", "ernst & young", "capgemini", "infosys",
  "tata consultancy", "tcs", "wipro", "cognizant", "hcl", "nhs",
  "barclays", "hsbc", "lloyds", "natwest", "jp morgan", "goldman sachs",
  "morgan stanley", "deutsche bank", "credit suisse", "standard chartered",
  "bp", "shell", "unilever", "rolls-royce", "bae systems", "airbus",
  "arm holdings", "bt group", "vodafone", "sky", "bbc", "channel 4",
  "astrazeneca", "gsk", "glaxosmithkline", "pfizer", "johnson & johnson",
  "siemens", "bosch", "samsung", "lg electronics", "sony", "fujitsu",
  "oracle", "salesforce", "adobe", "sap", "cisco", "intel", "nvidia",
];

function scoreJob(job) {
  const text = `${job.title} ${job.description} ${job.employer}`.toLowerCase();
  let score = 0;
  let signals = [];

  // Check for explicit visa keywords (+40 each, max 100)
  VISA_KEYWORDS.forEach(kw => {
    if (text.includes(kw)) {
      score += 40;
      signals.push({ type: "visa", label: kw });
    }
  });

  // Check for negative keywords (-200 = instant disqualify)
  for (const neg of SPONSORSHIP_NEGATIVE_KEYWORDS) {
    if (text.includes(neg)) {
      return { score: -1, signals: [{ type: "negative", label: neg }], fresherFriendly: false };
    }
  }

  // Known sponsor employer (+30)
  if (KNOWN_SPONSOR_EMPLOYERS.some(emp => text.includes(emp))) {
    score += 30;
    signals.push({ type: "known_sponsor", label: "Known visa sponsor" });
  }

  // Fresher friendly signals
  let fresherFriendly = false;
  FRESHER_KEYWORDS.forEach(kw => {
    if (text.includes(kw)) {
      fresherFriendly = true;
      signals.push({ type: "fresher", label: kw });
    }
  });

  // Salary present (UK standard = more legit listing)
  if (job.salary_min || job.salary_max) {
    score += 10;
    signals.push({ type: "salary", label: "Salary disclosed" });
  }

  // Clamp score 0–100
  score = Math.min(100, Math.max(0, score));

  return { score, signals, fresherFriendly };
}

// ============================================================
// API FETCHERS
// ============================================================
async function fetchReedJobs(query, location, page = 1) {
  const params = new URLSearchParams({
    keywords: `${query} visa sponsorship`,
    locationName: location || "United Kingdom",
    resultsToTake: 20,
    resultsToSkip: (page - 1) * 20,
    fullTime: false,
    permanent: false,
  });

  const response = await fetch(
    `https://www.reed.co.uk/api/1.0/search?${params}`,
    {
      headers: {
        Authorization: `Basic ${btoa(CONFIG.REED_API_KEY + ":")}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) throw new Error(`Reed API error: ${response.status}`);
  const data = await response.json();

  return (data.results || []).map(job => ({
    id: `reed_${job.jobId}`,
    source: "Reed",
    title: job.jobTitle,
    employer: job.employerName,
    location: job.locationName,
    salary_min: job.minimumSalary,
    salary_max: job.maximumSalary,
    description: job.jobDescription || "",
    url: job.jobUrl,
    posted: job.date,
    full_time: job.fullTime,
    contract_type: job.contractType,
  }));
}

async function fetchAdzunaJobs(query, location, page = 1) {
  const loc = location || "uk";
  const params = new URLSearchParams({
    app_id: CONFIG.ADZUNA_APP_ID,
    app_key: CONFIG.ADZUNA_APP_KEY,
    what: `${query} visa sponsorship`,
    where: loc,
    results_per_page: 20,
    page,
    content_type: "application/json",
  });

  const response = await fetch(
    `https://api.adzuna.com/v1/api/jobs/gb/search/${page}?${params}`
  );

  if (!response.ok) throw new Error(`Adzuna API error: ${response.status}`);
  const data = await response.json();

  return (data.results || []).map(job => ({
    id: `adzuna_${job.id}`,
    source: "Adzuna",
    title: job.title,
    employer: job.company?.display_name || "Unknown",
    location: job.location?.display_name || loc,
    salary_min: job.salary_min,
    salary_max: job.salary_max,
    description: job.description || "",
    url: job.redirect_url,
    posted: job.created,
    full_time: job.contract_time === "full_time",
    contract_type: job.contract_type,
  }));
}

async function fetchAllJobs(query, location, page) {
  const results = await Promise.allSettled([
    fetchReedJobs(query, location, page),
    fetchAdzunaJobs(query, location, page),
  ]);

  const combined = [];
  results.forEach(r => {
    if (r.status === "fulfilled") combined.push(...r.value);
  });

  // Score and filter
  return combined
    .map(job => ({ ...job, ...scoreJob(job) }))
    .filter(job => job.score > 0)
    .sort((a, b) => b.score - a.score);
}

// ============================================================
// COMPONENTS
// ============================================================

function ScoreBadge({ score }) {
  const color =
    score >= 80 ? "#00ff88" : score >= 50 ? "#ffcc00" : "#ff6b35";
  const label =
    score >= 80 ? "Very Likely" : score >= 50 ? "Likely" : "Possible";
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      background: color + "22", border: `1px solid ${color}`,
      borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 700,
      color, letterSpacing: 0.5, textTransform: "uppercase",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, display: "inline-block" }} />
      {label} Sponsored · {score}%
    </div>
  );
}

function SignalTags({ signals }) {
  const typeColors = {
    visa: "#4fc3f7",
    known_sponsor: "#ab47bc",
    fresher: "#66bb6a",
    salary: "#ffa726",
  };
  const unique = [...new Map(signals.map(s => [s.label, s])).values()].slice(0, 4);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
      {unique.map((s, i) => (
        <span key={i} style={{
          background: (typeColors[s.type] || "#888") + "20",
          border: `1px solid ${(typeColors[s.type] || "#888")}55`,
          color: typeColors[s.type] || "#aaa",
          borderRadius: 4, padding: "2px 7px", fontSize: 10, fontWeight: 600,
          textTransform: "capitalize",
        }}>
          {s.label}
        </span>
      ))}
    </div>
  );
}

function JobCard({ job }) {
  const [expanded, setExpanded] = useState(false);
  const salary = job.salary_min || job.salary_max
    ? `£${job.salary_min?.toLocaleString() || "?"}${job.salary_max ? ` – £${job.salary_max.toLocaleString()}` : "+"}`
    : "Salary not disclosed";

  const posted = job.posted
    ? new Date(job.posted).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "";

  return (
    <div style={{
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 12,
      padding: "18px 20px",
      transition: "border-color 0.2s, transform 0.2s",
      cursor: "default",
    }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = "rgba(79,195,247,0.4)";
        e.currentTarget.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{
              background: job.source === "Reed" ? "#e8534222" : "#7c4dff22",
              border: `1px solid ${job.source === "Reed" ? "#e8534255" : "#7c4dff55"}`,
              color: job.source === "Reed" ? "#ff8a65" : "#b39ddb",
              borderRadius: 4, padding: "1px 7px", fontSize: 10, fontWeight: 700,
            }}>
              {job.source}
            </span>
            {job.fresherFriendly && (
              <span style={{
                background: "#66bb6a22", border: "1px solid #66bb6a55",
                color: "#66bb6a", borderRadius: 4, padding: "1px 7px",
                fontSize: 10, fontWeight: 700,
              }}>
                🎓 Fresher Friendly
              </span>
            )}
          </div>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#f0f4ff", lineHeight: 1.3 }}>
            {job.title}
          </h3>
          <div style={{ color: "#90a4c8", fontSize: 13, marginTop: 3 }}>
            {job.employer} · {job.location}
          </div>
        </div>
        <ScoreBadge score={job.score} />
      </div>

      {/* Salary + meta */}
      <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 12, color: "#78909c" }}>
        <span>💷 {salary}</span>
        {posted && <span>📅 {posted}</span>}
        {job.full_time !== undefined && <span>{job.full_time ? "⏱ Full-time" : "⏱ Part-time"}</span>}
      </div>

      <SignalTags signals={job.signals} />

      {/* Description toggle */}
      {job.description && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              background: "none", border: "none", color: "#4fc3f7",
              fontSize: 12, cursor: "pointer", marginTop: 10, padding: 0,
              display: "flex", alignItems: "center", gap: 4,
            }}
          >
            {expanded ? "▲ Hide details" : "▼ Show description"}
          </button>
          {expanded && (
            <p style={{
              margin: "10px 0 0", fontSize: 12, color: "#90a4c8",
              lineHeight: 1.6, maxHeight: 150, overflow: "auto",
              borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 10,
            }}>
              {job.description.replace(/<[^>]*>/g, "").slice(0, 600)}
              {job.description.length > 600 ? "…" : ""}
            </p>
          )}
        </>
      )}

      {/* CTA */}
      <a
        href={job.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "inline-block", marginTop: 12,
          background: "linear-gradient(135deg, #0d47a1, #1565c0)",
          color: "#fff", borderRadius: 6, padding: "7px 16px",
          fontSize: 12, fontWeight: 600, textDecoration: "none",
          transition: "opacity 0.2s",
        }}
        onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
        onMouseLeave={e => e.currentTarget.style.opacity = "1"}
      >
        View Job →
      </a>
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================
export default function App() {
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [fresherOnly, setFresherOnly] = useState(false);
  const [minScore, setMinScore] = useState(40);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [page, setPage] = useState(1);
  const [apiMode, setApiMode] = useState("both"); // "both" | "reed" | "adzuna"

  const handleSearch = useCallback(async (p = 1) => {
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    setPage(p);

    try {
      let results = [];

      if (apiMode === "both") {
        results = await fetchAllJobs(query, location, p);
      } else if (apiMode === "reed") {
        const raw = await fetchReedJobs(query, location, p);
        results = raw.map(j => ({ ...j, ...scoreJob(j) })).filter(j => j.score > 0).sort((a, b) => b.score - a.score);
      } else {
        const raw = await fetchAdzunaJobs(query, location, p);
        results = raw.map(j => ({ ...j, ...scoreJob(j) })).filter(j => j.score > 0).sort((a, b) => b.score - a.score);
      }

      const filtered = results
        .filter(j => j.score >= minScore)
        .filter(j => !fresherOnly || j.fresherFriendly);

      setJobs(p === 1 ? filtered : prev => [...prev, ...filtered]);
      setSearched(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [query, location, fresherOnly, minScore, apiMode]);

  const stats = {
    total: jobs.length,
    fresher: jobs.filter(j => j.fresherFriendly).length,
    highConfidence: jobs.filter(j => j.score >= 80).length,
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#080d1a",
      fontFamily: "'Sora', 'DM Sans', system-ui, sans-serif",
      color: "#e8eaf6",
    }}>
      {/* Import fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;600;700;800&family=DM+Sans:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #0d1526; }
        ::-webkit-scrollbar-thumb { background: #1e3a5f; border-radius: 3px; }
        input, select, button { font-family: inherit; }
        input:focus, select:focus { outline: none; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes slideIn { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        .job-animate { animation: slideIn 0.3s ease forwards; }
      `}</style>

      {/* Hero Header */}
      <div style={{
        background: "linear-gradient(180deg, #0a1628 0%, #080d1a 100%)",
        borderBottom: "1px solid rgba(79,195,247,0.15)",
        padding: "40px 20px 32px",
        textAlign: "center",
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Background glow */}
        <div style={{
          position: "absolute", top: -60, left: "50%", transform: "translateX(-50%)",
          width: 500, height: 200,
          background: "radial-gradient(ellipse, rgba(79,195,247,0.12) 0%, transparent 70%)",
          pointerEvents: "none",
        }} />

        <div style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          background: "rgba(79,195,247,0.1)", border: "1px solid rgba(79,195,247,0.3)",
          borderRadius: 20, padding: "4px 14px", fontSize: 11, fontWeight: 600,
          color: "#4fc3f7", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 16,
        }}>
          🇬🇧 UK VISA SPONSORSHIP FINDER
        </div>

        <h1 style={{
          margin: "0 0 8px",
          fontSize: "clamp(26px, 5vw, 42px)",
          fontWeight: 800,
          background: "linear-gradient(135deg, #e8eaf6 30%, #4fc3f7)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          lineHeight: 1.15,
        }}>
          Find Visa-Sponsored Jobs<br />in the UK
        </h1>
        <p style={{ color: "#90a4c8", fontSize: 14, margin: "0 auto", maxWidth: 480, lineHeight: 1.6 }}>
          AI-powered scoring using Reed & Adzuna APIs · Fresher-friendly filters · UK immigration aligned
        </p>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "28px 20px" }}>

        {/* Config warning */}
        {(CONFIG.REED_API_KEY === "YOUR_REED_API_KEY" || CONFIG.ADZUNA_APP_ID === "YOUR_ADZUNA_APP_ID") && (
          <div style={{
            background: "rgba(255,152,0,0.1)", border: "1px solid rgba(255,152,0,0.4)",
            borderRadius: 10, padding: "12px 16px", marginBottom: 20,
            fontSize: 13, color: "#ffb74d", lineHeight: 1.6,
          }}>
            ⚠️ <strong>Setup required:</strong> Add your API keys in the <code style={{ background: "rgba(255,255,255,0.1)", padding: "1px 5px", borderRadius: 3 }}>CONFIG</code> object at the top of <code>App.jsx</code>.
            Get Reed key at <strong>reed.co.uk/developers</strong> · Adzuna key at <strong>developer.adzuna.com</strong>
          </div>
        )}

        {/* Search Panel */}
        <div style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 16, padding: "24px",
          marginBottom: 24,
        }}>
          {/* Main search inputs */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#78909c", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.8 }}>
                Job Title / Role
              </label>
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch(1)}
                placeholder="e.g. Software Engineer, Nurse, Data Analyst"
                style={{
                  width: "100%", background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8,
                  padding: "10px 14px", color: "#e8eaf6", fontSize: 14,
                  transition: "border-color 0.2s",
                }}
                onFocus={e => e.target.style.borderColor = "rgba(79,195,247,0.6)"}
                onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.12)"}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#78909c", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.8 }}>
                Location (optional)
              </label>
              <input
                value={location}
                onChange={e => setLocation(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch(1)}
                placeholder="e.g. London, Manchester, Remote"
                style={{
                  width: "100%", background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8,
                  padding: "10px 14px", color: "#e8eaf6", fontSize: 14,
                  transition: "border-color 0.2s",
                }}
                onFocus={e => e.target.style.borderColor = "rgba(79,195,247,0.6)"}
                onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.12)"}
              />
            </div>
          </div>

          {/* Filters row */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#78909c", textTransform: "uppercase", letterSpacing: 0.8, display: "block", marginBottom: 6 }}>
                API Source
              </label>
              <select
                value={apiMode}
                onChange={e => setApiMode(e.target.value)}
                style={{
                  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 8, padding: "8px 12px", color: "#e8eaf6", fontSize: 13,
                }}
              >
                <option value="both">Reed + Adzuna</option>
                <option value="reed">Reed only</option>
                <option value="adzuna">Adzuna only</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#78909c", textTransform: "uppercase", letterSpacing: 0.8, display: "block", marginBottom: 6 }}>
                Min Sponsor Score: {minScore}%
              </label>
              <input
                type="range" min={0} max={80} step={10} value={minScore}
                onChange={e => setMinScore(Number(e.target.value))}
                style={{ accentColor: "#4fc3f7", width: 120 }}
              />
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}>
              <div
                onClick={() => setFresherOnly(!fresherOnly)}
                style={{
                  width: 40, height: 22, borderRadius: 11,
                  background: fresherOnly ? "#4fc3f7" : "rgba(255,255,255,0.1)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  position: "relative", transition: "background 0.2s", cursor: "pointer",
                }}
              >
                <div style={{
                  position: "absolute", top: 3, left: fresherOnly ? 20 : 3,
                  width: 14, height: 14, borderRadius: "50%",
                  background: "#fff", transition: "left 0.2s",
                }} />
              </div>
              <span style={{ fontSize: 13, color: fresherOnly ? "#4fc3f7" : "#90a4c8", fontWeight: 600 }}>
                🎓 Fresher-friendly only
              </span>
            </label>
          </div>

          {/* Search button */}
          <button
            onClick={() => handleSearch(1)}
            disabled={loading || !query.trim()}
            style={{
              background: loading ? "rgba(79,195,247,0.3)" : "linear-gradient(135deg, #0d47a1 0%, #1976d2 100%)",
              color: "#fff", border: "none", borderRadius: 8,
              padding: "11px 28px", fontSize: 14, fontWeight: 700,
              cursor: loading || !query.trim() ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", gap: 8,
              transition: "opacity 0.2s",
              opacity: loading || !query.trim() ? 0.7 : 1,
            }}
          >
            {loading ? (
              <>
                <span style={{ animation: "pulse 1s infinite" }}>⏳</span>
                Searching…
              </>
            ) : "🔍 Search Sponsored Jobs"}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            background: "rgba(244,67,54,0.1)", border: "1px solid rgba(244,67,54,0.4)",
            borderRadius: 10, padding: "12px 16px", marginBottom: 16,
            color: "#ef9a9a", fontSize: 13,
          }}>
            ❌ {error}
          </div>
        )}

        {/* Stats bar */}
        {searched && jobs.length > 0 && (
          <div style={{
            display: "flex", gap: 16, flexWrap: "wrap",
            marginBottom: 20,
          }}>
            {[
              { label: "Total Found", value: stats.total, color: "#4fc3f7" },
              { label: "Fresher Friendly", value: stats.fresher, color: "#66bb6a" },
              { label: "High Confidence", value: stats.highConfidence, color: "#00ff88" },
            ].map(stat => (
              <div key={stat.label} style={{
                background: "rgba(255,255,255,0.03)",
                border: `1px solid ${stat.color}33`,
                borderRadius: 10, padding: "10px 16px",
                display: "flex", flexDirection: "column", gap: 2,
              }}>
                <span style={{ fontSize: 22, fontWeight: 800, color: stat.color }}>{stat.value}</span>
                <span style={{ fontSize: 11, color: "#78909c", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6 }}>{stat.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Results */}
        {jobs.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {jobs.map((job, i) => (
              <div key={job.id} className="job-animate" style={{ animationDelay: `${Math.min(i, 10) * 0.05}s` }}>
                <JobCard job={job} />
              </div>
            ))}

            {/* Load more */}
            <button
              onClick={() => handleSearch(page + 1)}
              disabled={loading}
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 8, padding: "12px",
                color: "#90a4c8", fontSize: 13, fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer",
                marginTop: 4, transition: "background 0.2s",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(79,195,247,0.1)"}
              onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
            >
              {loading ? "Loading…" : "Load more results →"}
            </button>
          </div>
        )}

        {/* Empty state */}
        {searched && jobs.length === 0 && !loading && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#546e7a" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔎</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No sponsored jobs found</div>
            <div style={{ fontSize: 13 }}>
              Try a broader search, lower the minimum score, or remove the fresher filter.
            </div>
          </div>
        )}

        {/* How it works */}
        {!searched && (
          <div style={{ marginTop: 8 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: "#546e7a", textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>
              How the AI scoring works
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              {[
                { icon: "🔑", title: "Visa Keywords", desc: "Detects 'visa sponsorship', 'CoS', 'Skilled Worker' and 15+ related phrases in job text" },
                { icon: "🏢", title: "Known Sponsors", desc: "Flags 50+ UK employers known to regularly sponsor international workers" },
                { icon: "🎓", title: "Fresher Filter", desc: "Identifies 'graduate scheme', 'entry level', 'trainee' roles for those new to the field" },
                { icon: "🚫", title: "Negative Filter", desc: "Auto-removes jobs saying 'must have right to work' or 'no sponsorship'" },
              ].map(item => (
                <div key={item.title} style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 10, padding: "14px",
                }}>
                  <div style={{ fontSize: 20, marginBottom: 6 }}>{item.icon}</div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#c5cae9", marginBottom: 4 }}>{item.title}</div>
                  <div style={{ fontSize: 12, color: "#546e7a", lineHeight: 1.5 }}>{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ textAlign: "center", marginTop: 40, fontSize: 11, color: "#37474f" }}>
          Data sourced from Reed.co.uk & Adzuna · For informational purposes only · Always verify visa sponsorship directly with the employer
        </div>
      </div>
    </div>
  );
}
