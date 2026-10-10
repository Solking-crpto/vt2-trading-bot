# VT2 Deployment & Operational Guide

## Local Installation & Startup

### Prerequisites
- Node.js ≥ 20.0.0 (Node.js v26 LTS recommended)
- npm ≥ 10.0.0

### Quick Start
```bash
# 1. Install / Verify
git clone <repo-url>
cd VT2-Trading-Bot

# 2. Run automated test suite
npm test

# 3. Start VT2 Trading Platform
npm start
```
The terminal will launch on `http://localhost:3000`.

### Environment Variables
Optionally configure `.env`:
```env
PORT=3000
BITGET_API_BASE_URL=https://api.bitget.com
DATABASE_PATH=data/vt2.db
```

## Cloud / Production Hosting

### Hosting Architecture Options

1. **Docker Container / Node.js VPS (DigitalOcean / AWS EC2 / Railway / Render):**
   - **Recommended:** VT2 maintains long-lived Server-Sent Events (SSE) connections and an active background ticker interval for position tracking and simulated fills.
   - Run via Dockerfile or `npm start` with persistent volume mounted at `/app/data` for the SQLite database.

2. **Serverless (Vercel / Cloudflare Pages):**
   - Note on Serverless: Vercel serverless functions have execution timeouts and do not support standing background intervals. For serverless deployment, SSE streaming should be replaced with periodic client-side polling, and SQLite should be backed by Turso or Cloudflare D1.

## Operational Verification

- **Verify Paper Mode:**
  - Call `GET http://localhost:3000/api/health`.
  - Check that `environment` is `"PAPER"` and `mainnetExecutionAllowed` is `false`.
- **Verify Live Mainnet Interception:**
  - Call `POST http://localhost:3000/api/orders/live`.
  - Check that the server returns HTTP 403 Forbidden with `MAINNET_EXECUTION_BLOCKED`.
