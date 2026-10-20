import fs from 'node:fs';
import path from 'node:path';
import { V2PortfolioEngine, SPLITS } from '../src/strategy/v2/v2-portfolio-engine.js';

const EQUITY_PERPS_PATH = path.resolve('config/equity-perps.json');
const CRYPTO_PERPS_PATH = path.resolve('config/crypto-perps.json');
const OUTPUT_DIR = path.resolve('reports/strategy-v2');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function generateSvgEquityChart(seriesMap, width = 960, height = 480) {
  const padding = { top: 40, right: 180, bottom: 50, left: 80 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  let minTs = Infinity;
  let maxTs = -Infinity;
  let minEq = Infinity;
  let maxEq = -Infinity;

  for (const [, points] of Object.entries(seriesMap)) {
    for (const p of points) {
      if (p.timestamp < minTs) minTs = p.timestamp;
      if (p.timestamp > maxTs) maxTs = p.timestamp;
      if (p.equity < minEq) minEq = p.equity;
      if (p.equity > maxEq) maxEq = p.equity;
    }
  }

  minEq = Math.min(minEq, 9500);
  maxEq = Math.max(maxEq, 10500);

  const getX = ts => padding.left + ((ts - minTs) / (maxTs - minTs)) * chartW;
  const getY = eq => padding.top + chartH - ((eq - minEq) / (maxEq - minEq)) * chartH;

  const colors = {
    'R2-A (Equity-E0)': '#38bdf8',
    'R2-A (Equity-E1)': '#818cf8',
    'R2-A (Crypto-E0)': '#f59e0b',
    'R2-B (Equity-E0)': '#34d399',
    'R2-B (Equity-E1)': '#10b981',
    'R2-B (Crypto-E0)': '#ec4899',
  };

  let paths = '';
  let legendY = padding.top + 10;
  let legendSvg = '';

  for (const [name, points] of Object.entries(seriesMap)) {
    if (!points || points.length === 0) continue;
    const color = colors[name] || '#94a3b8';

    const step = Math.max(1, Math.floor(points.length / 400));
    const sampled = [];
    for (let i = 0; i < points.length; i += step) sampled.push(points[i]);
    if (sampled[sampled.length - 1] !== points[points.length - 1]) sampled.push(points[points.length - 1]);

    const d = sampled.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${getX(p.timestamp).toFixed(1)} ${getY(p.equity).toFixed(1)}`).join(' ');
    paths += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" />\n`;

    legendSvg += `
      <g transform="translate(${width - padding.right + 20}, ${legendY})">
        <line x1="0" y1="0" x2="20" y2="0" stroke="${color}" stroke-width="2" />
        <text x="28" y="4" font-family="sans-serif" font-size="12" fill="#e2e8f0">${name}</text>
      </g>
    `;
    legendY += 24;
  }

  const yTicks = [minEq, (minEq + maxEq) / 2, maxEq];
  let yGridSvg = '';
  for (const yt of yTicks) {
    const yPos = getY(yt);
    yGridSvg += `
      <line x1="${padding.left}" y1="${yPos}" x2="${width - padding.right}" y2="${yPos}" stroke="#334155" stroke-dasharray="3,3" />
      <text x="${padding.left - 10}" y="${yPos + 4}" font-family="sans-serif" font-size="11" fill="#94a3b8" text-anchor="end">$${yt.toFixed(0)}</text>
    `;
  }

  const base10kY = getY(10000);
  const baselineSvg = `<line x1="${padding.left}" y1="${base10kY}" x2="${width - padding.right}" y2="${base10kY}" stroke="#64748b" stroke-width="1.5" stroke-dasharray="4,4" />`;

  return `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" style="background:#0f172a; border-radius:8px;">
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  </style>
  <text x="${padding.left}" y="25" font-size="16" font-weight="bold" fill="#f8fafc">VT2 Round 2 Pre-Registered Strategy Equity Curves</text>
  ${yGridSvg}
  ${baselineSvg}
  ${paths}
  ${legendSvg}
</svg>
  `.trim();
}

async function main() {
  console.log(`========================================================================`);
  console.log(`VT2 Strategy v2: Round 2 Candidate Evaluation (Pre-Registered)`);
  console.log(`Commit: 33beca481f2f20904faa57135f36e092cba399ff`);
  console.log(`========================================================================\n`);

  const rawEquities = JSON.parse(fs.readFileSync(EQUITY_PERPS_PATH, 'utf8'));
  const equitySymbols = rawEquities.map(e => e.symbol);

  let cryptoSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
  if (fs.existsSync(CRYPTO_PERPS_PATH)) {
    const rawCrypto = JSON.parse(fs.readFileSync(CRYPTO_PERPS_PATH, 'utf8'));
    cryptoSymbols = rawCrypto.map(c => c.symbol).slice(0, 3); // top 3 crypto benchmarks
  }

  const engine = new V2PortfolioEngine();
  console.log(`Loading equity universe (${equitySymbols.length} symbols)...`);
  const equityUniverse = engine.loadUniverse(equitySymbols);

  console.log(`Loading crypto universe (${cryptoSymbols.length} symbols)...`);
  const cryptoUniverse = engine.loadUniverse(cryptoSymbols);

  const trials = [];
  const allResults = {};
  const chartSeriesDev = {};

  const candidates = [
    {
      id: 'R2-A',
      name: '4h Donchian Breakout Trend-Follower',
      universes: [
        { name: 'Equity', symbols: equitySymbols, universe: equityUniverse, sessions: ['E0', 'E1'] },
        { name: 'Crypto', symbols: cryptoSymbols, universe: cryptoUniverse, sessions: ['E0'] },
      ],
    },
    {
      id: 'R2-B',
      name: '15m Pullback in 1h Trend (Maker-Only)',
      universes: [
        { name: 'Equity', symbols: equitySymbols, universe: equityUniverse, sessions: ['E0', 'E1'] },
        { name: 'Crypto', symbols: cryptoSymbols, universe: cryptoUniverse, sessions: ['E0'] },
      ],
    },
  ];

  let anyPassedDevAndVal = false;

  for (const cand of candidates) {
    for (const u of cand.universes) {
      for (const sessionMode of u.sessions) {
        const runKey = `${cand.id}_${u.name}_${sessionMode}`;
        console.log(`\n========================================================================`);
        console.log(`Running: ${cand.id} (${cand.name}) | Universe: ${u.name} | Session: ${sessionMode}`);
        console.log(`========================================================================`);

        // 1. Run Dev Split (In-Sample)
        console.log(`--> Evaluating Split: Dev (In-Sample)...`);
        const devRes = engine.runReplay(u.universe, u.symbols, cand.id, sessionMode, 'dev');
        const devSens = engine.computeFixedTradeSensitivity(devRes.trades);

        console.log(`    Trades: ${devRes.tradeCount} | WinRate: ${devRes.winRate}% | Net P&L: $${devRes.netPnl.toFixed(2)} | PF: ${devRes.profitFactor} | Max DD: ${devRes.maxDrawdownPct}%`);
        console.log(`    Sensitivity (Fixed Trade List): x0=$${devSens.x0.netPnl.toFixed(2)} | x1=$${devSens.x1.netPnl.toFixed(2)} | x2=$${devSens.x2.netPnl.toFixed(2)}`);

        // Dev Pass Criteria Check
        const passDevNetPnl = devRes.netPnl > 0;
        const passDevPf = devRes.profitFactor >= 1.25;
        const passDevTrades = devRes.tradeCount >= 30;
        const passDevDd = devRes.maxDrawdownPct <= 15.0;
        const passDevSensX2 = devSens.x2.netPnl > 0;
        const passDevAll = passDevNetPnl && passDevPf && passDevTrades && passDevDd && passDevSensX2;

        console.log(`    Dev Criteria: NetPnl>0: ${passDevNetPnl} | PF>=1.25: ${passDevPf} | Trades>=30: ${passDevTrades} | MaxDD<=15%: ${passDevDd} | x2>0: ${passDevSensX2} => OVERALL: ${passDevAll ? 'PASS' : 'FAIL'}`);

        chartSeriesDev[`${cand.id} (${u.name}-${sessionMode})`] = devRes.equityCurve;

        trials.push({
          candidateId: cand.id,
          candidateName: cand.name,
          universe: u.name,
          sessionMode,
          splitId: 'dev',
          tradeCount: devRes.tradeCount,
          winRate: devRes.winRate,
          netPnl: devRes.netPnl,
          profitFactor: devRes.profitFactor,
          maxDrawdownPct: devRes.maxDrawdownPct,
          turnover: devRes.turnover,
          expectancyR: devRes.expectancyR,
          bootstrapCI: devRes.bootstrapCI,
          totalCosts: devRes.totalCosts,
          costsShareGross: devRes.costsShareGross,
          sensitivity: {
            x0: devSens.x0.netPnl,
            x1: devSens.x1.netPnl,
            x2: devSens.x2.netPnl,
          },
          passed: passDevAll,
        });

        // 2. Run Validation Split (Out-of-Sample)
        console.log(`--> Evaluating Split: Validation (Out-of-Sample)...`);
        const valRes = engine.runReplay(u.universe, u.symbols, cand.id, sessionMode, 'validation');
        const valSens = engine.computeFixedTradeSensitivity(valRes.trades);

        console.log(`    Trades: ${valRes.tradeCount} | WinRate: ${valRes.winRate}% | Net P&L: $${valRes.netPnl.toFixed(2)} | PF: ${valRes.profitFactor} | Max DD: ${valRes.maxDrawdownPct}%`);
        console.log(`    Sensitivity (Fixed Trade List): x0=$${valSens.x0.netPnl.toFixed(2)} | x1=$${valSens.x1.netPnl.toFixed(2)} | x2=$${valSens.x2.netPnl.toFixed(2)}`);

        // Validation Pass Criteria Check
        const passValNetPnl = valRes.netPnl > 0;
        const passValPf = valRes.profitFactor >= 1.15;
        const passValDd = valRes.maxDrawdownPct <= 20.0;
        const passValAll = passValNetPnl && passValPf && passValDd;

        console.log(`    Val Criteria: NetPnl>0: ${passValNetPnl} | PF>=1.15: ${passValPf} | MaxDD<=20%: ${passValDd} => OVERALL: ${passValAll ? 'PASS' : 'FAIL'}`);

        trials.push({
          candidateId: cand.id,
          candidateName: cand.name,
          universe: u.name,
          sessionMode,
          splitId: 'validation',
          tradeCount: valRes.tradeCount,
          winRate: valRes.winRate,
          netPnl: valRes.netPnl,
          profitFactor: valRes.profitFactor,
          maxDrawdownPct: valRes.maxDrawdownPct,
          turnover: valRes.turnover,
          expectancyR: valRes.expectancyR,
          bootstrapCI: valRes.bootstrapCI,
          totalCosts: valRes.totalCosts,
          costsShareGross: valRes.costsShareGross,
          sensitivity: {
            x0: valSens.x0.netPnl,
            x1: valSens.x1.netPnl,
            x2: valSens.x2.netPnl,
          },
          passed: passValAll,
        });

        allResults[runKey] = {
          candidateId: cand.id,
          candidateName: cand.name,
          universe: u.name,
          sessionMode,
          dev: devRes,
          devSensitivity: devSens,
          validation: valRes,
          valSensitivity: valSens,
          passDev: passDevAll,
          passVal: passValAll,
        };

        if (passDevAll && passValAll) {
          anyPassedDevAndVal = true;
          console.log(`\n*** CANDIDATE ${runKey} PASSED BOTH DEV AND VALIDATION! ***`);
        }
      }
    }
  }

  // Forward Holdout Check
  console.log(`\n========================================================================`);
  console.log(`Forward Holdout Status`);
  console.log(`========================================================================`);
  if (!anyPassedDevAndVal) {
    console.log(`DECISION: No candidate passed both Dev and Validation pass criteria.`);
    console.log(`In strict accordance with pre-registration and research integrity rules,`);
    console.log(`the Forward Holdout split (2026-10-10 to Present) remains STRICTLY CLOSED.`);
  } else {
    console.log(`DECISION: Passing candidate found. Running Forward Holdout...`);
    // If any passed, run holdout only for passing candidates
  }

  // Generate SVG Chart
  const svgChart = generateSvgEquityChart(chartSeriesDev);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'equity_curves_r2.svg'), svgChart, 'utf8');
  console.log(`Saved equity curve SVG to ${path.join(OUTPUT_DIR, 'equity_curves_r2.svg')}`);

  // Write metrics JSON
  const metricsJsonPath = path.join(OUTPUT_DIR, 'metrics-r2.json');
  fs.writeFileSync(metricsJsonPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    preRegistrationCommit: '33beca481f2f20904faa57135f36e092cba399ff',
    trials,
    forwardHoldoutOpened: anyPassedDevAndVal,
  }, null, 2), 'utf8');
  console.log(`Saved Round 2 metrics to ${metricsJsonPath}`);

  // Append trials to trial_log.md
  const trialLogPath = path.join(OUTPUT_DIR, 'trial_log.md');
  let logContent = `\n\n## Round 2 Pre-Registered Trials (Commit: 33beca481f2f20904faa57135f36e092cba399ff)\n\n`;
  logContent += `| Date | Candidate | Universe | Session | Split | Trades | Win Rate | Net P&L | PF | Max DD | Sens x0 | Sens x1 | Sens x2 | Status |\n`;
  logContent += `|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;

  for (const t of trials) {
    const status = t.passed ? '**PASS**' : 'FAIL';
    logContent += `| 2026-10-19 | ${t.candidateId} | ${t.universe} | ${t.sessionMode} | ${t.splitId} | ${t.tradeCount} | ${t.winRate}% | $${t.netPnl.toFixed(2)} | ${t.profitFactor} | ${t.maxDrawdownPct}% | $${t.sensitivity.x0.toFixed(2)} | $${t.sensitivity.x1.toFixed(2)} | $${t.sensitivity.x2.toFixed(2)} | ${status} |\n`;
  }

  logContent += `\n**Forward Holdout Split Status**: ${anyPassedDevAndVal ? 'Opened (passed pre-registration criteria)' : 'KEPT CLOSED (no candidate satisfied pre-registered pass criteria)'}\n`;

  fs.appendFileSync(trialLogPath, logContent, 'utf8');
  console.log(`Appended Round 2 results to ${trialLogPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
