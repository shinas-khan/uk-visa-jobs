# 🇬🇧 UK Visa Sponsorship Job Finder

An AI-powered job search tool that finds UK jobs with visa sponsorship, scores them by likelihood, and filters for fresher-friendly roles.

---

## 🚀 Quick Setup (5 minutes)

### 1. Get Your API Keys

**Reed.co.uk API** (Free)
1. Go to https://www.reed.co.uk/developers/jobseeker
2. Sign up / log in
3. Your API key is shown in your account dashboard

**Adzuna API** (Free tier available)
1. Go to https://developer.adzuna.com/
2. Register for an account
3. Create an app to get your `app_id` and `app_key`

---

### 2. Add Keys to the App

Open `App.jsx` and find the CONFIG block at the top:

```js
const CONFIG = {
  REED_API_KEY: "YOUR_REED_API_KEY",      // ← paste here
  ADZUNA_APP_ID: "YOUR_ADZUNA_APP_ID",    // ← paste here
  ADZUNA_APP_KEY: "YOUR_ADZUNA_APP_KEY",  // ← paste here
};
```

---

### 3. Run Locally

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Open http://localhost:5173
```

---

### 4. Build for Production

```bash
npm run build
# Deploy the /dist folder to any static host
```

---

## 🌐 Free Deployment Options

| Platform | Steps |
|----------|-------|
| **Vercel** | `npx vercel` — instant deploy |
| **Netlify** | Drag `/dist` folder to netlify.com/drop |
| **GitHub Pages** | Push to repo, enable Pages from `/dist` |
| **Cloudflare Pages** | Connect GitHub repo in CF dashboard |

---

## 🧠 How the AI Scoring Works

Each job is scored 0–100% for visa sponsorship likelihood:

| Signal | Points |
|--------|--------|
| Explicit visa keywords ("visa sponsorship", "CoS", "Skilled Worker") | +40 each |
| Known UK visa-sponsoring employer | +30 |
| Salary disclosed (UK standard) | +10 |
| Negative keywords ("no sponsorship", "must have right to work") | Disqualified |

### Fresher Detection
Jobs containing: `graduate`, `entry level`, `junior`, `trainee`, `grad scheme`, `apprentice`, etc. are flagged as Fresher Friendly.

---

## ⚠️ CORS Note

Reed's API requires server-side requests (they block browser CORS). For production:
- Use a backend proxy (Express, Next.js API routes, Vercel serverless function)
- Or use a CORS proxy service temporarily for testing

The `vite.config.js` handles this in local development automatically.

### Simple Vercel Serverless Proxy (recommended for production)

Create `/api/reed.js`:
```js
export default async function handler(req, res) {
  const { keywords, locationName } = req.query;
  const response = await fetch(
    `https://www.reed.co.uk/api/1.0/search?keywords=${keywords}&locationName=${locationName}&resultsToTake=20`,
    { headers: { Authorization: `Basic ${Buffer.from(process.env.REED_API_KEY + ':').toString('base64')}` } }
  );
  const data = await response.json();
  res.json(data);
}
```

Then in App.jsx, change Reed fetch URL to `/api/reed?keywords=...`

---

## 📋 Features

- ✅ Dual API: Reed.co.uk + Adzuna combined results
- ✅ AI sponsorship scoring (0–100%)
- ✅ Fresher/graduate job detection
- ✅ Known sponsor employer database (50+ companies)
- ✅ Negative filter (removes "no sponsorship" jobs)
- ✅ Salary disclosure badge
- ✅ Pagination / load more
- ✅ Dark mode UI

---

## 📌 UK Visa Context

This tool targets **Skilled Worker Visa** (formerly Tier 2) jobs. Employers must be on the UK Home Office's Sponsor Register. Always verify sponsorship directly with the employer before applying.

Home Office Sponsor Register: https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers
