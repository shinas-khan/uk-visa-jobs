import { useState, useCallback } from "react";

// ============================================================
// CONFIGURATION - Add your API keys here
// ============================================================
const CONFIG = {
  REED_API_KEY: "6a03366e-5212-49f8-944b-f1e9f070a072",
  ADZUNA_APP_ID: "344e86d1",
  ADZUNA_APP_KEY: "039c47ae80bab92aef99751a471040fb",
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

  for (const neg of SPONSORSHIP_NEGATIVE_KEYWORDS) {
    if (text.includes(neg)) {
      return { score: -1, signals: [{ type: "negative", label: neg }], fresherFriendly: false };
    }
  }

  VISA_KEYWORDS.forEach(kw => {
    if (text.includes(kw)) {
      score += 40;
      signals.push({ type: "visa", label: kw });
    }
  });

  if (KNOWN_SPONSOR_EMPLOYERS.some(emp => text.includes(emp))) {
    score += 30;
    signals.push({ type: "known_sponsor", label: "Known visa sponsor" });
  }

  let fresherFriendly = false;
  FRESHER_KEYWORDS.forEach(kw => {
    if (text.includes(kw)) {
      fresherFriendly = true;
      signals.push({ type: "fresher", label: kw });
    }
  });

  if (job.salary_min || job.salary_max) {
    score += 10;
    signals.push({ type: "salary", label: "Salary disclosed" });
  }

  // If no explicit visa keywords matched but employer is known sponsor, still show
  if (score === 0 && signals.length === 0) score = 0;

  score = Math.min(100, Math.max(0, score));
  return { score, signals, fresherFriendly };
}

// ============================================================
// API FETCHERS — with CORS proxy fallback for Reed
// ============================================================
const CORS_PROXY = "https://corsproxy.io/?";

async function fetchReedJobs(query, location, page = 1) {
  const params = new URLSearchParams({
    keywords: `${query} visa sponsorship`,
    locationName: location || "United Kingdom",
    resultsToTake: 20,
    resultsToSkip: (page - 1) * 20,
  });

  const reedUrl = `https://www.reed.co.uk/api/1.0/search?${params}`;
  const credentials = btoa(CONFIG.REED_API_KEY + ":");

  // Try direct first, then CORS proxy
  let response;
  let data;
  try {
    response = await fetch(reedUrl, {
      headers: { Authorization: `Basic ${credentials}` },
    });
    if (!response.ok) throw new Error("direct blocked");
    data = await response.json();
  } catch {
    try {
      response = await fetch(`${CORS_PROXY}${encodeURIComponent(reedUrl)}`, {
        headers: { Authorization: `Basic ${credentials}` },
      });
      if (!response.ok) throw new Error(`Reed proxy error: ${response.status}`);
      data = await response.json();
    } catch (err) {
      throw new Error(`Reed failed: ${err.message}`);
    }
  }

  return (data.results || []).map(job => ({
    id: `reed_${job.jobId}`,
    source: "Reed",
    title: job.jobTitle || "",
    employer: job.employerName || "",
    location: job.locationName || "",
    salary_min: job.minimumSalary,
    salary_max: job.maximumSalary,
    description: job.jobDescription || "",
    url: job.jobUrl || "#",
    posted: job.date,
    full_time: job.fullTime,
    contract_type: job.contractType,
  }));
}

async function fetchAdzunaJobs(query, location, page = 1) {
  const where = location || "UK";
  const params = new URLSearchParams({
    app_id: CONFIG.ADZUNA_APP_ID,
    app_key: CONFIG.ADZUNA_APP_KEY,
    what: `${query} visa sponsorship`,
    where,
    results_per_page: 20,
  });

  const url = `https://api.adzuna.com/v1/api/jobs/gb/search/${page}?${params}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Adzuna error: ${response.status}`);
  const data = await response.json();

  return (data.results || []).map(job => ({
    id: `adzuna_${job.id}`,
    source: "Adzuna",
    title: job.title || "",
    employer: job.company?.display_name || "Unknown",
    location: job.location?.display_name || where,
    salary_min: job.salary_min,
    salary_max: job.salary_max,
    description: job.description || "",
    url: job.redirect_url || "#",
    posted: job.created,
    full_time: job.contract_time === "full_time",
    contract_type: job.contract_type,
  }));
}

async function fetchAllJobs(query, location, page) {
  let reedJobs = [];
  let reedFailed = false;

  try {
    reedJobs = await fetchReedJobs(query, location, page);
  } catch (err) {
    console.warn("Reed failed:", err.message);
    reedFailed = true;
  }

  let adzunaJobs = [];
  try {
    adzunaJobs = await fetchAdzunaJobs(query, location, page);
  } catch (err) {
    console.warn("Adzuna failed:", err.message);
  }

  const scoredReed = reedJobs
    .map(job => ({ ...job, ...scoreJob(job), priority: 1 }))
    .filter(job => job.score >= 0);

  const scoredAdzuna = adzunaJobs
    .map(job => ({ ...job, ...scoreJob(job), priority: 2 }))
    .filter(job => job.score >= 0);

  const reedSignatures = new Set(
    scoredReed.map(j => `${j.title.toLowerCase()}|${j.employer.toLowerCase()}`)
  );

  const uniqueAdzuna = scoredAdzuna.filter(j => {
    const sig = `${j.title.toLowerCase()}|${j.employer.toLowerCase()}`;
    return !reedSignatures.has(sig);
  });

  const reedSorted = scoredReed.sort((a, b) => b.score - a.score);
  const adzunaSorted = uniqueAdzuna.sort((a, b) => b.score - a.score);

  return [...reedSorted, ...adzunaSorted];
}

// ============================================================
// COMPONENTS
// ============================================================
function ScoreBadge({ score }) {
  const color = score >= 80 ? "#00ff88" : score >= 40 ? "#ffcc00" : "#ff6b35";
  const label = score >= 80 ? "Very Likely" : score >= 40 ? "Likely" : "Possible";
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      background: color + "22", border: `1px solid ${color}`,
      borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 700,
      color, letterSpacing: 0.5, textTransform: "uppercase", whiteSpace: "nowrap",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, display: "inline-block" }} />
      {label} · {score}%
    </div>
  );
}

function SignalTags({ signals }) {
  const typeColors = {
    visa: "#4fc3f7", known_sponsor: "#ab47bc", fresher: "#66bb6a", salary: "#ffa726",
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
      background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 12, padding: "18px 20px", transition: "border-color 0.2s, transform 0.2s",
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(79,195,247,0.4)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.transform = "translateY(0)"; }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            <span style={{
              background: job.source === "Reed" ? "#e8534222" : "#7c4dff22",
              border: `1px solid ${job.source === "Reed" ? "#e8534255" : "#7c4dff55"}`,
              color: job.source === "Reed" ? "#ff8a65" : "#b39ddb",
              borderRadius: 4, padding: "1px 7px", fontSize: 10, fontWeight: 700,
            }}>{job.source}</span>
            {job.fresherFriendly && (
              <span style={{
                background: "#66bb6a22", border: "1px solid #66bb6a55",
                color: "#66bb6a", borderRadius: 4, padding: "1px 7px", fontSize: 10, fontWeight: 700,
              }}>🎓 Fresher Friendly</span>
            )}
          </div>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#f0f4ff", lineHeight: 1.3 }}>{job.title}</h3>
          <div style={{ color: "#90a4c8", fontSize: 13, marginTop: 3 }}>{job.employer} · {job.location}</div>
        </div>
        <ScoreBadge score={job.score} />
      </div>

      <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 12, color: "#78909c", flexWrap: "wrap" }}>
        <span>💷 {salary}</span>
        {posted && <span>📅 {posted}</span>}
        {job.full_time !== undefined && <span>{job.full_time ? "⏱ Full-time" : "⏱ Part-time"}</span>}
      </div>

      <SignalTags signals={job.signals} />

      {job.description && (
        <>
          <button onClick={() => setExpanded(!expanded)} style={{
            background: "none", border: "none", color: "#4fc3f7",
            fontSize: 12, cursor: "pointer", marginTop: 10, padding: 0,
          }}>
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

      <a href={job.url} target="_blank" rel="noopener noreferrer" style={{
        display: "inline-block", marginTop: 12,
        background: "linear-gradient(135deg, #0d47a1, #1565c0)",
        color: "#fff", borderRadius: 6, padding: "7px 16px",
        fontSize: 12, fontWeight: 600, textDecoration: "none",
      }}>
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
  const [minScore, setMinScore] = useState(0);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [apiError, setApiError] = useState({ reed: "", adzuna: "" });
  const [searched, setSearched] = useState(false);
  const [page, setPage] = useState(1);

  const handleSearch = useCallback(async (p = 1) => {
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    setApiError({ reed: "", adzuna: "" });
    setPage(p);

    try {
      // Run both APIs and track individual errors
      let reedJobs = [], adzunaJobs = [];
      let reedErr = "", adzunaErr = "";

      await Promise.all([
        fetchReedJobs(query, location, p)
          .then(r => { reedJobs = r; })
          .catch(e => { reedErr = e.message; }),
        fetchAdzunaJobs(query, location, p)
          .then(r => { adzunaJobs = r; })
          .catch(e => { adzunaErr = e.message; }),
      ]);

      setApiError({ reed: reedErr, adzuna: adzunaErr });

      if (reedErr && adzunaErr) {
        setError("Both APIs failed. Check your internet connection and API keys.");
        setLoading(false);
        return;
      }

      // Score jobs
      const scoredReed = reedJobs
        .map(job => ({ ...job, ...scoreJob(job), priority: 1 }))
        .filter(j => j.score >= 0);

      const scoredAdzuna = adzunaJobs
        .map(job => ({ ...job, ...scoreJob(job), priority: 2 }))
        .filter(j => j.score >= 0);

      // Deduplicate
      const reedSigs = new Set(scoredReed.map(j => `${j.title.toLowerCase()}|${j.employer.toLowerCase()}`));
      const uniqueAdzuna = scoredAdzuna.filter(j =>
        !reedSigs.has(`${j.title.toLowerCase()}|${j.employer.toLowerCase()}`)
      );

      // Combine: Reed first, Adzuna second
      let combined = [
        ...scoredReed.sort((a, b) => b.score - a.score),
        ...uniqueAdzuna.sort((a, b) => b.score - a.score),
      ];

      // Apply filters
      if (minScore > 0) combined = combined.filter(j => j.score >= minScore);
      if (fresherOnly) combined = combined.filter(j => j.fresherFriendly);

      setJobs(p === 1 ? combined : prev => [...prev, ...combined]);
      setSearched(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [query, location, fresherOnly, minScore]);

  const stats = {
    total: jobs.length,
    fresher: jobs.filter(j => j.fresherFriendly).length,
    highConfidence: jobs.filter(j => j.score >= 80).length,
    fromReed: jobs.filter(j => j.source === "Reed").length,
  };

  return (
    <div style={{ minHeight: "100vh", background: "#080d1a", fontFamily: "'Sora', 'DM Sans', system-ui, sans-serif", color: "#e8eaf6" }}>
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
        option { background: #0d1526; color: #e8eaf6; }
      `}</style>

      {/* Header */}
      <div style={{
        background: "linear-gradient(180deg, #0a1628 0%, #080d1a 100%)",
        borderBottom: "1px solid rgba(79,195,247,0.15)",
        padding: "40px 20px 32px", textAlign: "center", position: "relative", overflow: "hidden",
      }}>
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
        }}>🇬🇧 UK VISA SPONSORSHIP FINDER</div>
        <h1 style={{
          margin: "0 0 8px", fontSize: "clamp(26px, 5vw, 42px)", fontWeight: 800,
          background: "linear-gradient(135deg, #e8eaf6 30%, #4fc3f7)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", lineHeight: 1.15,
        }}>Find Visa-Sponsored Jobs<br />in the UK</h1>
        <p style={{ color: "#90a4c8", fontSize: 14, margin: "0 auto", maxWidth: 480, lineHeight: 1.6 }}>
          Reed (primary) + Adzuna (backup) · AI scored · Fresher-friendly filters
        </p>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "28px 20px" }}>

        {/* API status indicators */}
        {searched && (apiError.reed || apiError.adzuna) && (
          <div style={{
            background: "rgba(255,152,0,0.08)", border: "1px solid rgba(255,152,0,0.3)",
            borderRadius: 10, padding: "10px 16px", marginBottom: 16, fontSize: 12, color: "#ffb74d",
          }}>
            {apiError.reed && <div>⚠️ Reed: {apiError.reed} — showing Adzuna results only</div>}
            {apiError.adzuna && <div>⚠️ Adzuna: {apiError.adzuna} — showing Reed results only</div>}
          </div>
        )}

        {/* Search Panel */}
        <div style={{
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 16, padding: "24px", marginBottom: 24,
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            {[
              { label: "Job Title / Role", value: query, onChange: setQuery, placeholder: "e.g. Software Engineer, Nurse, Accountant" },
              { label: "Location (optional)", value: location, onChange: setLocation, placeholder: "e.g. London, Manchester, Remote" },
            ].map(field => (
              <div key={field.label}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#78909c", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.8 }}>
                  {field.label}
                </label>
                <input
                  value={field.value}
                  onChange={e => field.onChange(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSearch(1)}
                  placeholder={field.placeholder}
                  style={{
                    width: "100%", background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8,
                    padding: "10px 14px", color: "#e8eaf6", fontSize: 14, transition: "border-color 0.2s",
                  }}
                  onFocus={e => e.target.style.borderColor = "rgba(79,195,247,0.6)"}
                  onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.12)"}
                />
              </div>
            ))}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "center", marginBottom: 18 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#78909c", textTransform: "uppercase", letterSpacing: 0.8, display: "block", marginBottom: 6 }}>
                Min Sponsor Score: {minScore === 0 ? "Show All" : `${minScore}%+`}
              </label>
              <input
                type="range" min={0} max={80} step={10} value={minScore}
                onChange={e => setMinScore(Number(e.target.value))}
                style={{ accentColor: "#4fc3f7", width: 140 }}
              />
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}>
              <div onClick={() => setFresherOnly(!fresherOnly)} style={{
                width: 40, height: 22, borderRadius: 11,
                background: fresherOnly ? "#4fc3f7" : "rgba(255,255,255,0.1)",
                border: "1px solid rgba(255,255,255,0.2)",
                position: "relative", transition: "background 0.2s", cursor: "pointer",
              }}>
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

          <button
            onClick={() => handleSearch(1)}
            disabled={loading || !query.trim()}
            style={{
              background: loading ? "rgba(79,195,247,0.3)" : "linear-gradient(135deg, #0d47a1 0%, #1976d2 100%)",
              color: "#fff", border: "none", borderRadius: 8,
              padding: "12px 32px", fontSize: 14, fontWeight: 700,
              cursor: loading || !query.trim() ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", gap: 8,
              opacity: loading || !query.trim() ? 0.7 : 1,
            }}
          >
            {loading ? <><span style={{ animation: "pulse 1s infinite" }}>⏳</span> Searching…</> : "🔍 Search Sponsored Jobs"}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            background: "rgba(244,67,54,0.1)", border: "1px solid rgba(244,67,54,0.4)",
            borderRadius: 10, padding: "12px 16px", marginBottom: 16, color: "#ef9a9a", fontSize: 13,
          }}>❌ {error}</div>
        )}

        {/* Stats */}
        {searched && jobs.length > 0 && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 12, flexWrap: "wrap" }}>
              <span style={{
                background: "rgba(232,83,66,0.15)", border: "1px solid rgba(232,83,66,0.4)",
                borderRadius: 4, padding: "2px 8px", color: "#ff8a65", fontWeight: 700, fontSize: 11,
              }}>Reed</span>
              <span style={{ color: "#546e7a" }}>{stats.fromReed} results · shown first</span>
              {jobs.some(j => j.source === "Adzuna") && (
                <>
                  <span style={{ color: "#37474f" }}>·</span>
                  <span style={{
                    background: "rgba(124,77,255,0.15)", border: "1px solid rgba(124,77,255,0.4)",
                    borderRadius: 4, padding: "2px 8px", color: "#b39ddb", fontWeight: 700, fontSize: 11,
                  }}>Adzuna</span>
                  <span style={{ color: "#546e7a" }}>{jobs.filter(j => j.source === "Adzuna").length} supplementary</span>
                </>
              )}
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
              {[
                { label: "Total Found", value: stats.total, color: "#4fc3f7" },
                { label: "Fresher Friendly", value: stats.fresher, color: "#66bb6a" },
                { label: "High Confidence", value: stats.highConfidence, color: "#00ff88" },
                { label: "From Reed", value: stats.fromReed, color: "#ff8a65" },
              ].map(s => (
                <div key={s.label} style={{
                  background: "rgba(255,255,255,0.03)", border: `1px solid ${s.color}33`,
                  borderRadius: 10, padding: "10px 16px", display: "flex", flexDirection: "column", gap: 2,
                }}>
                  <span style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</span>
                  <span style={{ fontSize: 11, color: "#78909c", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6 }}>{s.label}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Results */}
        {jobs.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {jobs.map((job, i) => (
              <div key={job.id} className="job-animate" style={{ animationDelay: `${Math.min(i, 10) * 0.05}s` }}>
                <JobCard job={job} />
              </div>
            ))}
            <button
              onClick={() => handleSearch(page + 1)}
              disabled={loading}
              style={{
                background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 8, padding: "12px", color: "#90a4c8", fontSize: 13, fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer", marginTop: 4,
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
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No jobs found</div>
            <div style={{ fontSize: 13, marginBottom: 16 }}>
              Try a broader search term, set Min Score to "Show All", or remove the fresher filter.
            </div>
            {(apiError.reed || apiError.adzuna) && (
              <div style={{ fontSize: 12, color: "#ff8a65", marginTop: 8 }}>
                ⚠️ One or both APIs had errors — check the warning above for details.
              </div>
            )}
          </div>
        )}

        {/* How it works — shown before first search */}
        {!searched && (
          <div style={{ marginTop: 8 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: "#546e7a", textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>
              How the AI scoring works
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              {[
                { icon: "🔑", title: "Visa Keywords", desc: "Detects 'visa sponsorship', 'CoS', 'Skilled Worker' and 15+ related phrases" },
                { icon: "🏢", title: "Known Sponsors", desc: "Flags 50+ UK employers known to regularly sponsor international workers" },
                { icon: "🎓", title: "Fresher Filter", desc: "Identifies graduate schemes, entry level and trainee roles" },
                { icon: "🚫", title: "Negative Filter", desc: "Auto-removes jobs saying 'must have right to work' or 'no sponsorship'" },
              ].map(item => (
                <div key={item.title} style={{
                  background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
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
          Data from Reed.co.uk & Adzuna · Always verify visa sponsorship directly with the employer
        </div>
      </div>
    </div>
  );
}
