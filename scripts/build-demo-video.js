/**
 * scripts/build-demo-video.js
 * 
 * Bitget AI Hackathon S2 - Track 1 Alpha Factory (Open Theme)
 * Generates 1920x1080 slides, narrates via System.Speech audio, encodes to MP4 H.264 via ffmpeg,
 * and builds interactive standalone HTML slideshow fallback.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const MEDIA_DIR = path.join(ROOT_DIR, 'media');
const SLIDES_DIR = path.join(MEDIA_DIR, 'slides');
const AUDIO_DIR = path.join(MEDIA_DIR, 'audio');

// Ensure directories
fs.mkdirSync(SLIDES_DIR, { recursive: true });
fs.mkdirSync(AUDIO_DIR, { recursive: true });

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const SLIDES_CONFIG = [
  {
    id: 1,
    type: 'title',
    title: 'VT2: Verifiable Trading Technology',
    subtitle: 'Bitget AI Hackathon S2 — Track 1 Alpha Factory (Open Theme)',
    caption: 'VT2: Verifiable Trading Technology for Tokenized US Equity Perpetuals',
    narration: 'Welcome to VT2: Verifiable Trading Technology, built for the Bitget AI Hackathon S2 Alpha Factory track. VT2 is a deterministic, risk-budgeted trading system for tokenized US equity perpetuals in paper-only mode.'
  },
  {
    id: 2,
    type: 'screenshot',
    rawImage: '../overview & terminal.png',
    headerBadge: 'OVERVIEW & TERMINAL // REAL-TIME BITGET PUBLIC FEED',
    envBadge: 'PAPER ENVIRONMENT // MAINNET BLOCKED (403)',
    caption: 'Live Bitget WebSocket feed with sub-second latency, real-time risk gauges, and Kill Switch',
    narration: 'The VT2 terminal connects directly to Bitget public WebSocket feeds, showing live ticker data with 519 millisecond latency. The header displays simulated equity of 9,999 dollars, daily loss tracking under our 200 dollar budget, single-position cap, and an immediate Kill Switch.'
  },
  {
    id: 3,
    type: 'screenshot',
    rawImage: '../Market scanner.png',
    headerBadge: 'MARKET SCANNER // 24 TOKENIZED US EQUITIES',
    envBadge: 'PAPER ENVIRONMENT // MAINNET BLOCKED (403)',
    caption: 'Multi-factor filtering across 24 tokenized stocks: ATR, volume, spread, and R:R threshold',
    narration: 'The Market Scanner evaluates 24 tokenized equity perpetuals using deterministic technical filters. Four contracts currently qualify with net reward-to-risk above 1.5, while disqualified symbols like SanDisk and Rocket Lab are rejected with explicit reasons like RSI overbought.'
  },
  {
    id: 4,
    type: 'screenshot',
    rawImage: '../automated trading.png',
    headerBadge: 'AUTOMATED TRADING // 30S EXECUTION LOOP',
    envBadge: 'PAPER ENVIRONMENT // MAINNET BLOCKED (403)',
    caption: 'Autonomous execution loop with strict daily trade quota, position caps, and instant vetoes',
    narration: 'The automated trader runs an autonomous 30-second evaluation loop. Here the bot is running, tracking 1 of 3 allowed daily trades. The activity feed documents a simulated market long fill on Tesla, verified stop loss, and continuous safety checks.'
  },
  {
    id: 5,
    type: 'screenshot',
    rawImage: '../positions & order.png',
    headerBadge: 'POSITIONS & ORDERS // REAL-TIME MARK & PROTECTIVE CONTROLS',
    envBadge: 'PAPER ENVIRONMENT // MAINNET BLOCKED (403)',
    caption: 'Active simulated position tracking with live mark price, bracket orders, and scenario injection',
    narration: 'The Positions tab tracks the active paper position on Tesla with real-time mark pricing, unrealised P and L, and bracket orders. Protective simulation controls allow testing sudden market spikes or drops, alongside live sentiment monitoring.'
  },
  {
    id: 6,
    type: 'screenshot',
    rawImage: '../settings & risk.png',
    headerBadge: 'SETTINGS & RISK ENGINE // DETERMINISTIC RISK BUDGET',
    envBadge: 'PAPER ENVIRONMENT // MAINNET BLOCKED (403)',
    caption: 'Strict risk budgeting: 0.5% risk per trade, 2% daily loss limit, 3-loss pause, 30m cooldown',
    narration: 'The Risk Engine enforces hard mathematical limits: half a percent risk per trade, a 2 percent daily loss cap, single position concurrency, and a 30-minute cooldown after 3 consecutive losses. Parameters are deterministic and cannot be bypassed.'
  },
  {
    id: 7,
    type: 'alpha_result',
    caption: 'Honest Alpha Factory Backtest: -28.25% return due to $3,430 friction drag across 287 trades',
    narration: 'Here is our honest Alpha Factory backtest across 287 trades. The strategy recorded a negative 28.25 percent return and Sharpe of minus 4.46, underperforming the S and P 500 benchmark. Traded friction was the dominant driver: over 3,400 dollars in fees and slippage from 258 times turnover erased gross edge. This rigorous, unfabricated reporting proves why real execution costs matter.'
  },
  {
    id: 8,
    type: 'close',
    caption: 'No language model makes trading decisions. Rules do. AI coding assistants helped build it.',
    narration: 'VT2 proves verifiable, execution-aware systems with zero fabricated claims. Explore the full open-source codebase on GitHub and test the hosted read-only demo. Remember: No language model makes trading decisions. Rules do. AI coding assistants helped build it.'
  }
];

function generateSlide1Html(slide) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
  body { width: 1920px; height: 1080px; background: #0a0e17; color: #f0f6fc; overflow: hidden; position: relative; display: flex; flex-direction: column; justify-content: space-between; }
  .header { padding: 30px 60px; display: flex; justify-content: space-between; align-items: center; }
  .hackathon-badge { font-size: 20px; font-weight: 700; color: #58a6ff; background: rgba(56, 139, 253, 0.15); padding: 8px 20px; border-radius: 8px; border: 1px solid rgba(56, 139, 253, 0.4); letter-spacing: 1px; }
  .hero { text-align: center; margin-top: 20px; }
  .hero-tag { font-size: 24px; font-weight: 700; color: #39d353; letter-spacing: 4px; text-transform: uppercase; margin-bottom: 12px; }
  .hero-title { font-size: 72px; font-weight: 900; color: #ffffff; letter-spacing: -1px; text-shadow: 0 4px 20px rgba(0,0,0,0.6); }
  .hero-subtitle { font-size: 32px; font-weight: 400; color: #8b949e; margin-top: 10px; letter-spacing: 1px; }
  .pillars { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; padding: 0 60px; margin-top: 30px; }
  .pillar-card { background: rgba(22, 27, 34, 0.85); border: 1px solid #30363d; border-radius: 12px; padding: 26px 20px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); border-top: 3px solid #58a6ff; }
  .pillar-title { font-size: 20px; font-weight: 700; color: #58a6ff; margin-bottom: 10px; }
  .pillar-desc { font-size: 16px; color: #c9d1d9; line-height: 1.5; }
  .caption-bar { height: 110px; background: rgba(13, 17, 23, 0.96); border-top: 2px solid #58a6ff; display: flex; align-items: center; justify-content: center; padding: 0 50px; }
  .caption-text { font-size: 36px; font-weight: 600; color: #ffffff; text-align: center; }
  .footer { height: 35px; display: flex; align-items: center; justify-content: center; font-size: 16px; color: #8b949e; letter-spacing: 1px; font-weight: 500; background: #010409; }
</style>
</head>
<body>
  <div class="header">
    <div class="hackathon-badge">BITGET AI HACKATHON S2 // TRACK 1 ALPHA FACTORY (OPEN THEME)</div>
    <div style="font-size: 18px; color: #f85149; font-weight: 600; background: rgba(248,81,73,0.15); padding: 8px 16px; border-radius: 8px; border: 1px solid rgba(248,81,73,0.3);">PAPER MODE // REAL-TIME AUDIT</div>
  </div>
  <div class="hero">
    <div class="hero-tag">THINK. VERIFY. TRADE.</div>
    <h1 class="hero-title">VT2: Verifiable Trading Technology</h1>
    <div class="hero-subtitle">Execution-Aware Alpha on Tokenized US Equity Perpetuals</div>
  </div>
  <div class="pillars">
    <div class="pillar-card">
      <div class="pillar-title">1. Deterministic Engine</div>
      <div class="pillar-desc">Multi-factor scanner & rule-based execution. Zero probabilistic LLM latency or hallucination in the live trade loop.</div>
    </div>
    <div class="pillar-card" style="border-top-color: #39d353;">
      <div class="pillar-title" style="color: #39d353;">2. 24 Tokenized Stocks</div>
      <div class="pillar-desc">Public Bitget WebSocket stream with 500ms latency. High-volume US equities (TSLA, NVDA, AAPL, QQQ, SPY).</div>
    </div>
    <div class="pillar-card" style="border-top-color: #d29922;">
      <div class="pillar-title" style="color: #d29922;">3. Hard Risk Budget</div>
      <div class="pillar-desc">Strict 0.5% risk per trade, 2% daily loss limit, 3-loss circuit pause, 30m cooldown, and immediate Kill Switch.</div>
    </div>
    <div class="pillar-card" style="border-top-color: #a371f7;">
      <div class="pillar-title" style="color: #a371f7;">4. Verifiable Ledger</div>
      <div class="pillar-desc">Durable SQLite audit journal logging every order, fill, fee, and risk evaluation for post-trade proof.</div>
    </div>
  </div>
  <div>
    <div class="caption-bar">
      <div class="caption-text">${slide.caption}</div>
    </div>
    <div class="footer">Paper trading only. No real orders. Mainnet blocked.</div>
  </div>
</body>
</html>`;
}

function generateScreenshotSlideHtml(slide) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
  body { width: 1920px; height: 1080px; background: #0a0e17; color: #f0f6fc; overflow: hidden; position: relative; }
  .header { padding: 20px 50px; display: flex; justify-content: space-between; align-items: center; height: 75px; }
  .badge { display: inline-flex; align-items: center; gap: 8px; font-size: 20px; font-weight: 700; color: #58a6ff; background: rgba(56, 139, 253, 0.15); padding: 6px 16px; border-radius: 6px; border: 1px solid rgba(56, 139, 253, 0.3); letter-spacing: 0.5px; }
  .env-tag { font-size: 18px; font-weight: 600; color: #f85149; background: rgba(248, 81, 73, 0.15); padding: 6px 14px; border-radius: 6px; border: 1px solid rgba(248, 81, 73, 0.3); }
  .screenshot-frame { width: 1720px; height: 790px; margin: 0 auto; overflow: hidden; border-radius: 8px; border: 1px solid #30363d; box-shadow: 0 16px 36px rgba(0,0,0,0.8); background: #010409; }
  .screenshot-frame img { width: 100%; margin-top: -65px; display: block; }
  .caption-bar { position: absolute; bottom: 42px; left: 0; right: 0; height: 110px; background: rgba(13, 17, 23, 0.96); border-top: 2px solid #58a6ff; display: flex; align-items: center; justify-content: center; padding: 0 50px; }
  .caption-text { font-size: 36px; font-weight: 600; color: #ffffff; text-align: center; }
  .footer { position: absolute; bottom: 10px; left: 0; right: 0; text-align: center; font-size: 16px; color: #8b949e; letter-spacing: 1px; font-weight: 500; }
</style>
</head>
<body>
  <div class="header">
    <div class="badge">${slide.headerBadge}</div>
    <div class="env-tag">${slide.envBadge}</div>
  </div>
  <div class="screenshot-frame">
    <img src="${slide.rawImage}" alt="${slide.headerBadge}">
  </div>
  <div class="caption-bar">
    <div class="caption-text">${slide.caption}</div>
  </div>
  <div class="footer">Paper trading only. No real orders. Mainnet blocked.</div>
</body>
</html>`;
}

function generateSlide7Html(slide) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
  body { width: 1920px; height: 1080px; background: #0a0e17; color: #f0f6fc; overflow: hidden; position: relative; display: flex; flex-direction: column; justify-content: space-between; }
  .header { padding: 25px 60px; display: flex; justify-content: space-between; align-items: center; }
  .badge { font-size: 20px; font-weight: 700; color: #58a6ff; background: rgba(56, 139, 253, 0.15); padding: 8px 18px; border-radius: 8px; border: 1px solid rgba(56, 139, 253, 0.4); }
  .meta-tag { font-size: 18px; font-weight: 600; color: #d29922; background: rgba(210, 153, 34, 0.15); padding: 8px 16px; border-radius: 8px; border: 1px solid rgba(210, 153, 34, 0.3); }
  
  .content { padding: 0 60px; display: flex; flex-direction: column; gap: 24px; }
  
  .metrics-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
  .metric-card { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 20px; text-align: left; }
  .metric-label { font-size: 14px; font-weight: 600; color: #8b949e; letter-spacing: 0.5px; text-transform: uppercase; }
  .metric-value { font-size: 32px; font-weight: 800; margin-top: 6px; }
  .metric-sub { font-size: 14px; color: #8b949e; margin-top: 4px; }
  
  .val-danger { color: #f85149; }
  .val-warning { color: #d29922; }
  .val-success { color: #39d353; }
  .val-info { color: #58a6ff; }
  
  .details-grid { display: grid; grid-template-columns: 1fr 1fr 1.2fr; gap: 20px; }
  .detail-panel { background: rgba(22, 27, 34, 0.9); border: 1px solid #30363d; border-radius: 10px; padding: 22px; }
  .panel-title { font-size: 18px; font-weight: 700; color: #c9d1d9; margin-bottom: 14px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 8px; }
  .panel-row { display: flex; justify-content: space-between; font-size: 16px; margin-bottom: 10px; }
  .row-label { color: #8b949e; }
  .row-val { font-weight: 600; color: #f0f6fc; }
  
  .analysis-text { font-size: 15px; color: #c9d1d9; line-height: 1.6; }
  .highlight-box { background: rgba(248, 81, 73, 0.1); border-left: 4px solid #f85149; padding: 10px 14px; margin-top: 12px; font-size: 14px; color: #ff7b72; }

  .caption-bar { height: 110px; background: rgba(13, 17, 23, 0.96); border-top: 2px solid #58a6ff; display: flex; align-items: center; justify-content: center; padding: 0 50px; }
  .caption-text { font-size: 36px; font-weight: 600; color: #ffffff; text-align: center; }
  .footer { height: 35px; display: flex; align-items: center; justify-content: center; font-size: 16px; color: #8b949e; letter-spacing: 1px; font-weight: 500; background: #010409; }
</style>
</head>
<body>
  <div class="header">
    <div class="badge">ALPHA FACTORY BACKTEST // RIGOROUS OUT-OF-SAMPLE VERIFICATION</div>
    <div class="meta-tag">FROZEN CONFIG // 287 TRADES ACROSS 19 SYMBOLS</div>
  </div>

  <div class="content">
    <div class="metrics-grid">
      <div class="metric-card" style="border-top: 3px solid #f85149;">
        <div class="metric-label">Total Net Return</div>
        <div class="metric-value val-danger">-28.25%</div>
        <div class="metric-sub">Net P&L: -$2,818.83 on $10k equity</div>
      </div>
      <div class="metric-card" style="border-top: 3px solid #d29922;">
        <div class="metric-label">Risk-Adjusted Ratios</div>
        <div class="metric-value val-warning">Sharpe: -4.46</div>
        <div class="metric-sub">Sortino: -5.39 | Win Rate: 41.11%</div>
      </div>
      <div class="metric-card" style="border-top: 3px solid #f85149;">
        <div class="metric-label">Total Friction Paid</div>
        <div class="metric-value val-danger">-$3,430.65</div>
        <div class="metric-sub">Fees: $2,223.72 | Slip: $889.52 | Fund: $317.42</div>
      </div>
      <div class="metric-card" style="border-top: 3px solid #39d353;">
        <div class="metric-label">SPY Benchmark (Buy & Hold)</div>
        <div class="metric-value val-success">+4.97%</div>
        <div class="metric-sub">Max Drawdown: 5.21% (Bot: 30.98%)</div>
      </div>
    </div>

    <div class="details-grid">
      <div class="detail-panel">
        <div class="panel-title">In-Sample Performance (IS)</div>
        <div class="panel-row"><span class="row-label">Trade Count:</span><span class="row-val">246 trades</span></div>
        <div class="panel-row"><span class="row-label">Win Rate:</span><span class="row-val">41.46%</span></div>
        <div class="panel-row"><span class="row-label">Net P&L:</span><span class="row-val val-danger">-$2,360.18 (-23.13%)</span></div>
        <div class="panel-row"><span class="row-label">Annualized Sharpe:</span><span class="row-val">-4.15</span></div>
        <div class="panel-row"><span class="row-label">Turnover:</span><span class="row-val">219.40x</span></div>
      </div>

      <div class="detail-panel">
        <div class="panel-title">Out-of-Sample Validation (OOS)</div>
        <div class="panel-row"><span class="row-label">Trade Count:</span><span class="row-val">41 trades</span></div>
        <div class="panel-row"><span class="row-label">Win Rate:</span><span class="row-val">39.02%</span></div>
        <div class="panel-row"><span class="row-label">Net P&L:</span><span class="row-val val-danger">-$458.65 (-6.66%)</span></div>
        <div class="panel-row"><span class="row-label">Annualized Sharpe:</span><span class="row-val">-6.51</span></div>
        <div class="panel-row"><span class="row-label">Turnover:</span><span class="row-val">37.59x</span></div>
      </div>

      <div class="detail-panel">
        <div class="panel-title">Execution-Aware Root Cause Analysis</div>
        <div class="analysis-text">
          <strong>Cost Drag Dominated Edge:</strong> High trading frequency (258.47x total turnover) incurred <strong>$3,430.65</strong> in taker fees, bid-ask slippage, and funding.
        </div>
        <div class="highlight-box">
          <strong>Honest Reporting:</strong> Unfavorable out-of-sample results are reported exactly as computed. No post-hoc curve-fitting or synthetic alpha claims.
        </div>
        <div style="font-size: 13px; color: #8b949e; margin-top: 10px;">
          Next iteration: Higher-timeframe (4h) regime filter + wider profit targets to overcome taker friction.
        </div>
      </div>
    </div>
  </div>

  <div>
    <div class="caption-bar">
      <div class="caption-text">${slide.caption}</div>
    </div>
    <div class="footer">Paper trading only. No real orders. Mainnet blocked.</div>
  </div>
</body>
</html>`;
}

function generateSlide8Html(slide) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
  body { width: 1920px; height: 1080px; background: #0a0e17; color: #f0f6fc; overflow: hidden; position: relative; display: flex; flex-direction: column; justify-content: space-between; }
  .header { padding: 30px 60px; display: flex; justify-content: space-between; align-items: center; }
  .badge { font-size: 20px; font-weight: 700; color: #58a6ff; background: rgba(56, 139, 253, 0.15); padding: 8px 20px; border-radius: 8px; border: 1px solid rgba(56, 139, 253, 0.4); }
  
  .center-block { text-align: center; padding: 0 100px; display: flex; flex-direction: column; align-items: center; }
  .quote-container { background: rgba(22, 27, 34, 0.95); border: 2px solid #58a6ff; border-radius: 16px; padding: 40px 60px; box-shadow: 0 12px 40px rgba(88, 166, 255, 0.15); max-width: 1400px; }
  .mandated-quote { font-size: 40px; font-weight: 800; color: #ffffff; line-height: 1.4; letter-spacing: -0.5px; }
  .quote-sub { font-size: 22px; color: #39d353; font-weight: 600; margin-top: 18px; letter-spacing: 1px; }

  .links-grid { display: flex; gap: 40px; margin-top: 40px; }
  .link-pill { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 16px 28px; text-align: left; }
  .link-label { font-size: 14px; font-weight: 600; color: #8b949e; text-transform: uppercase; }
  .link-val { font-size: 20px; font-weight: 700; color: #58a6ff; margin-top: 4px; }

  .caption-bar { height: 110px; background: rgba(13, 17, 23, 0.96); border-top: 2px solid #58a6ff; display: flex; align-items: center; justify-content: center; padding: 0 50px; }
  .caption-text { font-size: 36px; font-weight: 600; color: #ffffff; text-align: center; }
  .footer { height: 35px; display: flex; align-items: center; justify-content: center; font-size: 16px; color: #8b949e; letter-spacing: 1px; font-weight: 500; background: #010409; }
</style>
</head>
<body>
  <div class="header">
    <div class="badge">BITGET AI HACKATHON S2 // SUBMISSION SUMMARY</div>
    <div style="font-size: 18px; color: #39d353; font-weight: 600; background: rgba(57,211,83,0.15); padding: 8px 18px; border-radius: 8px; border: 1px solid rgba(57,211,83,0.3);">92 UNIT & INTEGRATION TESTS PASSING</div>
  </div>

  <div class="center-block">
    <div class="quote-container">
      <div class="mandated-quote">"No language model makes trading decisions. Rules do. AI coding assistants helped build it."</div>
      <div class="quote-sub">Verifiable Execution Architecture • SQLite Audit Trail • Zero Fabricated Alpha</div>
    </div>

    <div class="links-grid">
      <div class="link-pill">
        <div class="link-label">Open Source Repository</div>
        <div class="link-val">github.com/Solking-crpto/vt2-trading-bot</div>
      </div>
      <div class="link-pill">
        <div class="link-label">Hosted Read-Only Demo</div>
        <div class="link-val">vt2-trading-bot.vercel.app</div>
      </div>
      <div class="link-pill">
        <div class="link-label">Audit Engine</div>
        <div class="link-val">Durable SQLite Journal & Risk Guards</div>
      </div>
    </div>
  </div>

  <div>
    <div class="caption-bar">
      <div class="caption-text">${slide.caption}</div>
    </div>
    <div class="footer">Paper trading only. No real orders. Mainnet blocked.</div>
  </div>
</body>
</html>`;
}

function generateSlidesHtml() {
  console.log('--- Generating Slide HTML files ---');
  for (const slide of SLIDES_CONFIG) {
    let htmlContent = '';
    if (slide.type === 'title') {
      htmlContent = generateSlide1Html(slide);
    } else if (slide.type === 'screenshot') {
      htmlContent = generateScreenshotSlideHtml(slide);
    } else if (slide.type === 'alpha_result') {
      htmlContent = generateSlide7Html(slide);
    } else if (slide.type === 'close') {
      htmlContent = generateSlide8Html(slide);
    }
    const htmlPath = path.join(SLIDES_DIR, `slide${slide.id}.html`);
    fs.writeFileSync(htmlPath, htmlContent, 'utf8');
    console.log(`Saved: slide${slide.id}.html`);
  }
}

function renderSlidesToPng() {
  console.log('--- Rendering Slides to 1920x1080 PNG via Headless Edge ---');
  for (const slide of SLIDES_CONFIG) {
    const htmlPath = path.join(SLIDES_DIR, `slide${slide.id}.html`);
    const pngPath = path.join(SLIDES_DIR, `slide${slide.id}.png`);
    const fileUrl = `file:///${htmlPath.replace(/\\/g, '/')}`;
    
    console.log(`Capturing slide ${slide.id}...`);
    const proc = spawnSync(EDGE_PATH, [
      '--headless=new',
      '--disable-gpu',
      `--screenshot=${pngPath}`,
      '--window-size=1920,1080',
      '--hide-scrollbars',
      fileUrl
    ]);

    if (!fs.existsSync(pngPath)) {
      throw new Error(`Failed to render PNG for slide ${slide.id}`);
    }
    const stats = fs.statSync(pngPath);
    console.log(`Rendered slide${slide.id}.png (${stats.size} bytes)`);
  }
}

function getWavDuration(filePath) {
  const buf = fs.readFileSync(filePath);
  const byteRate = buf.readInt32LE(28);
  const dataSize = buf.length - 44;
  return Math.round((dataSize / byteRate) * 100) / 100;
}

function buildVideoClips() {
  console.log('--- Encoding Individual Video Clips via FFmpeg ---');
  const clipList = [];
  let totalVideoDuration = 0;

  for (const slide of SLIDES_CONFIG) {
    const pngPath = path.join(SLIDES_DIR, `slide${slide.id}.png`);
    const wavPath = path.join(AUDIO_DIR, `slide${slide.id}.wav`);
    const clipPath = path.join(SLIDES_DIR, `clip${slide.id}.mp4`);

    if (!fs.existsSync(wavPath)) {
      throw new Error(`Audio file missing: ${wavPath}`);
    }

    const duration = getWavDuration(wavPath);
    totalVideoDuration += duration;
    console.log(`Encoding clip ${slide.id} (duration: ${duration}s)...`);
    
    // Use -t ${duration} for exact clip length
    const cmd = `ffmpeg -y -loop 1 -i "${pngPath}" -i "${wavPath}" -t ${duration} -c:v libx264 -tune stillimage -c:a aac -b:a 192k -pix_fmt yuv420p "${clipPath}"`;
    execSync(cmd, { stdio: 'pipe' });

    const stats = fs.statSync(clipPath);
    console.log(`Created clip${slide.id}.mp4 (${stats.size} bytes, ${duration}s)`);
    clipList.push(clipPath);
  }

  console.log(`Target Total Video Duration: ${totalVideoDuration.toFixed(2)}s (${Math.floor(totalVideoDuration / 60)}m ${Math.round(totalVideoDuration % 60)}s)`);


  // Create concat file
  const concatFilePath = path.join(SLIDES_DIR, 'concat_list.txt');
  const concatContent = clipList.map(c => `file '${c.replace(/\\/g, '/')}'`).join('\n');
  fs.writeFileSync(concatFilePath, concatContent, 'utf8');

  console.log('--- Concatenating Clips into Final Video: media/vt2-demo.mp4 ---');
  const finalVideoPath = path.join(MEDIA_DIR, 'vt2-demo.mp4');
  const concatCmd = `ffmpeg -y -f concat -safe 0 -i "${concatFilePath}" -c copy "${finalVideoPath}"`;
  execSync(concatCmd, { stdio: 'pipe' });

  const finalStats = fs.statSync(finalVideoPath);
  console.log(`Successfully generated media/vt2-demo.mp4 (${finalStats.size} bytes)`);

  console.log('--- Generating Captions-Only Video: media/vt2-demo-captions-only.mp4 ---');
  const captionsOnlyPath = path.join(MEDIA_DIR, 'vt2-demo-captions-only.mp4');
  const captionsCmd = `ffmpeg -y -i "${finalVideoPath}" -an -c:v copy "${captionsOnlyPath}"`;
  execSync(captionsCmd, { stdio: 'pipe' });

  const captionsStats = fs.statSync(captionsOnlyPath);
  console.log(`Successfully generated media/vt2-demo-captions-only.mp4 (${captionsStats.size} bytes)`);
}

function buildInteractiveSlideshow() {
  console.log('--- Generating media/demo-slideshow.html Fallback ---');
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>VT2: Verifiable Trading Technology - Hackathon Demo Slideshow</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: #010409; color: #f0f6fc; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; overflow: hidden; }
    .viewport { width: 1280px; height: 720px; max-width: 95vw; max-height: 80vh; aspect-ratio: 16/9; background: #0a0e17; border: 1px solid #30363d; border-radius: 12px; overflow: hidden; position: relative; box-shadow: 0 20px 50px rgba(0,0,0,0.8); }
    .viewport img { width: 100%; height: 100%; object-fit: contain; display: block; }
    .controls { margin-top: 20px; display: flex; gap: 16px; align-items: center; }
    button { background: #21262d; color: #f0f6fc; border: 1px solid #30363d; padding: 10px 20px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 15px; transition: 0.2s; }
    button:hover { background: #30363d; border-color: #8b949e; }
    button.active { background: #238636; border-color: #2ea043; }
    .progress-info { font-size: 16px; color: #8b949e; font-weight: 500; min-width: 140px; text-align: center; }
    .transcript-box { margin-top: 15px; width: 1280px; max-width: 95vw; background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px 20px; font-size: 15px; color: #c9d1d9; line-height: 1.5; min-height: 60px; }
  </style>
</head>
<body>
  <div class="viewport">
    <img id="slideImg" src="slides/slide1.png" alt="Slide">
  </div>
  <div class="controls">
    <button id="prevBtn">&larr; Previous</button>
    <button id="playBtn" class="active">Pause</button>
    <button id="nextBtn">Next &rarr;</button>
    <span class="progress-info" id="progressText">Slide 1 of 8</span>
  </div>
  <div class="transcript-box" id="transcriptText">
    Loading narration...
  </div>
  <audio id="slideAudio" src="audio/slide1.wav"></audio>

  <script>
    const slides = ${JSON.stringify(SLIDES_CONFIG, null, 2)};
    let currentIdx = 0;
    let isPlaying = true;
    const imgEl = document.getElementById('slideImg');
    const audioEl = document.getElementById('slideAudio');
    const progressEl = document.getElementById('progressText');
    const transcriptEl = document.getElementById('transcriptText');
    const playBtn = document.getElementById('playBtn');

    function showSlide(idx) {
      if (idx < 0) idx = 0;
      if (idx >= slides.length) idx = 0;
      currentIdx = idx;
      const s = slides[currentIdx];
      imgEl.src = 'slides/slide' + s.id + '.png';
      audioEl.src = 'audio/slide' + s.id + '.wav';
      progressEl.textContent = 'Slide ' + (currentIdx + 1) + ' of ' + slides.length;
      transcriptEl.innerHTML = '<strong>Narration:</strong> ' + s.narration;
      if (isPlaying) {
        audioEl.play().catch(() => {});
      }
    }

    audioEl.addEventListener('ended', () => {
      if (isPlaying) {
        setTimeout(() => {
          if (isPlaying) {
            showSlide(currentIdx + 1);
          }
        }, 1000);
      }
    });

    document.getElementById('prevBtn').addEventListener('click', () => {
      showSlide(currentIdx - 1);
    });

    document.getElementById('nextBtn').addEventListener('click', () => {
      showSlide(currentIdx + 1);
    });

    playBtn.addEventListener('click', () => {
      isPlaying = !isPlaying;
      if (isPlaying) {
        playBtn.textContent = 'Pause';
        playBtn.className = 'active';
        audioEl.play().catch(() => {});
      } else {
        playBtn.textContent = 'Play';
        playBtn.className = '';
        audioEl.pause();
      }
    });

    showSlide(0);
  </script>
</body>
</html>`;

  fs.writeFileSync(path.join(MEDIA_DIR, 'demo-slideshow.html'), html, 'utf8');
  console.log('Saved media/demo-slideshow.html');
}

async function main() {
  console.log('=== VT2 HACKATHON DEMO VIDEO BUILDER ===');
  generateSlidesHtml();
  renderSlidesToPng();
  buildVideoClips();
  buildInteractiveSlideshow();
  console.log('=== DEMO VIDEO BUILD COMPLETE ===');
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
