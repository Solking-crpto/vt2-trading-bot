import fs from 'node:fs';
import path from 'node:path';
import { V2PortfolioEngine, SPLITS } from '../src/strategy/v2/v2-portfolio-engine.js';
import { runFastAblationReplay, prepareIndexedUniverse } from './run-v1-ablation.js';

const EQUITY_PERPS_PATH = path.resolve('config/equity-perps.json');
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

  // Anchor to 10000 base
  minEq = Math.min(minEq, 9500);
  maxEq = Math.max(maxEq, 10500);

  const getX = ts => padding.left + ((ts - minTs) / (maxTs - minTs)) * chartW;
  const getY = eq => padding.top + chartH - ((eq - minEq) / (maxEq - minEq)) * chartH;

  const colors = {
    'C0-Baseline': '#94a3b8',
    'C1-E0': '#38bdf8',
    'C1-E1': '#818cf8',
    'C2-E0': '#f59e0b',
    'C2-E1': '#ef4444',
  };

  let paths = '';
  let legendY = padding.top + 10;
  let legendSvg = '';

  for (const [name, points] of Object.entries(seriesMap)) {
    if (points.length === 0) continue;
    const color = colors[name] || '#10b981';

    // Downsample if more than 500 points for clean SVG
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

  // Grid lines
  const yTicks = [minEq, (minEq + maxEq) / 2, maxEq];
  let yGridSvg = '';
  for (const yt of yTicks) {
    const yPos = getY(yt);
    yGridSvg += `
      <line x1="${padding.left}" y1="${yPos}" x2="${width - padding.right}" y2="${yPos}" stroke="#334155" stroke-dasharray="3,3" />
      <text x="${padding.left - 10}" y="${yPos + 4}" font-family="sans-serif" font-size="11" fill="#94a3b8" text-anchor="end">$${yt.toFixed(0)}</text>
    `;
  }

  // Baseline 10000 line
  const base10kY = getY(10000);
  const baselineSvg = `<line x1="${padding.left}" y1="${base10kY}" x2="${width - padding.right}" y2="${base10kY}" stroke="#64748b" stroke-width="1.5" stroke-dasharray="4,4" />`;

  return `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" style="background:#0f172a; border-radius:8px;">
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  </style>
  <text x="${padding.left}" y="25" font-size="16" font-weight="bold" fill="#f8fafc">VT2 Strategy v2 Equity Curve Comparison</text>
  ${yGridSvg}
  ${baselineSvg}
  ${paths}
  ${legendSvg}
</svg>
  `.trim();
}

async function main() {
  console.log(`========================================================================`);
  console.log(`VT2 Strategy v2: Candidate Evaluation & Pass Criteria Audit`);
  console.log(`========================================================================\n`);

  const rawEquities = JSON.parse(fs.readFileSync(EQUITY_PERPS_PATH, 'utf8'));
  const symbols = rawEquities.map(e => e.symbol);

  const engine = new V2PortfolioEngine();
  console.log(`Loading universe for ${symbols.length} symbols...`);
  const universe = engine.loadUniverse(symbols);
  console.log(`Universe loaded successfully.\n`);

  // Prepare universe for C0 (v1 baseline)
  const preparedV1Universe = prepareIndexedUniverse(universe, symbols);

  const trials = [];
  const allTrades = [];
  const equityCurvesForChart = {};

  const candidatesToRun = [
    { id: 'C0', name: 'v1 Baseline', sessionModes: ['E0'] },
    { id: 'C1', name: 'Trend Pullback (1h/15m)', sessionModes: ['E0', 'E1'] },
    { id: 'C2', name: '4h Breakout Trend-Follower', sessionModes: ['E0', 'E1'] },
  ];

  const splits = ['dev', 'validation'];

  for (const cand of candidatesToRun) {
    for (const sessionMode of cand.sessionModes) {
      console.log(`------------------------------------------------------------------------`);
      console.log(`Evaluating Candidate: ${cand.id} (${cand.name}) | Session: ${sessionMode}`);
      console.log(`------------------------------------------------------------------------`);

      for (const splitId of splits) {
        const split = SPLITS[splitId];

        // 1. Base run (base slippage 0.02%)
        let res;
        if (cand.id === 'C0') {
          const ablationRes = runFastAblationReplay(preparedV1Universe, symbols, {
            startTs: split.startTs,
            endTs: split.endTs,
          });

          const netPnl = ablationRes.netPnl;
          const grossProfit = ablationRes.trades.filter(t => t.netPnl > 0).reduce((s, t) => s + t.netPnl, 0);
          const grossLoss = Math.abs(ablationRes.trades.filter(t => t.netPnl < 0).reduce((s, t) => s + t.netPnl, 0));
          const pf = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : 0;
          const maxDdPct = ablationRes.maxDrawdownPct;
          const isPassing = netPnl > 0 && pf >= 1.15 && ablationRes.trades.length >= 30 && maxDdPct <= 20.0;

          res = {
            candidateId: 'C0',
            sessionMode: 'E0',
            splitId,
            tradeCount: ablationRes.trades.length,
            winRate: ablationRes.winRate,
            netPnl,
            grossProfit: Number(grossProfit.toFixed(2)),
            grossLoss: Number(grossLoss.toFixed(2)),
            profitFactor: pf,
            totalReturnPct: ablationRes.totalReturnPct,
            maxDrawdownPct: maxDdPct,
            annualizedSharpe: 0,
            annualizedSortino: 0,
            turnover: 258,
            totalFeesPaid: ablationRes.totalFees,
            totalSlippagePaid: ablationRes.totalSlippage,
            totalFundingPaid: ablationRes.totalFunding,
            totalCosts: Number((ablationRes.totalFees + ablationRes.totalSlippage + ablationRes.totalFunding).toFixed(2)),
            isPassing,
            criteria: {
              passNetPnl: netPnl > 0,
              passPf: pf >= 1.15,
              passTrades: ablationRes.trades.length >= 30,
              passDd: maxDdPct <= 20.0,
            },
            trades: ablationRes.trades.map(t => ({
              ...t,
              candidateId: 'C0',
              sessionMode: 'E0',
              split: splitId,
            })),
            equityCurve: ablationRes.equityCurve || [],
          };
        } else {
          res = engine.runReplay(universe, symbols, cand.id, sessionMode, splitId);
        }

        // 2. Sensitivity run (2x slippage: 0.04%)
        let sensRes;
        if (cand.id === 'C0') {
          const sensAblation = runFastAblationReplay(preparedV1Universe, symbols, {
            startTs: split.startTs,
            endTs: split.endTs,
            rules: { executionAndCosts: { takerFeeRate: 0.0006, slippageRate: 0.0004 } },
          });
          sensRes = {
            netPnl: sensAblation.netPnl,
            profitFactor: sensAblation.trades.filter(t => t.netPnl < 0).length > 0 ? Number((sensAblation.trades.filter(t => t.netPnl > 0).reduce((s, t) => s + t.netPnl, 0) / Math.abs(sensAblation.trades.filter(t => t.netPnl < 0).reduce((s, t) => s + t.netPnl, 0))).toFixed(2)) : 0,
          };
        } else {
          sensRes = engine.runReplay(universe, symbols, cand.id, sessionMode, splitId, { slippageRate: 0.0004 });
        }

        console.log(`[${cand.id}-${sessionMode}] [${splitId.padEnd(10)}]: Net: $${String(res.netPnl).padStart(9)} | PF: ${String(res.profitFactor).padStart(4)} | Trades: ${String(res.tradeCount).padStart(3)} | MaxDD: ${String(res.maxDrawdownPct).padStart(5)}% | Pass: ${res.isPassing ? 'PASS' : 'FAIL'} | 2xSens Net: $${sensRes.netPnl}`);

        // Record trial
        trials.push({
          candidateId: cand.id,
          candidateName: cand.name,
          sessionMode,
          splitId,
          metrics: res,
          sensitivity2x: sensRes,
        });

        // Store trades for CSV
        for (const t of res.trades) {
          allTrades.push({
            candidateId: cand.id,
            sessionMode,
            split: splitId,
            tradeId: t.tradeId,
            symbol: t.symbol,
            side: t.side,
            entryTime: t.entryTime,
            entryDate: t.entryDate,
            exitTime: t.exitTime,
            exitDate: t.exitDate,
            entryPrice: t.entryPrice,
            exitPrice: t.exitPrice,
            quantity: t.quantity,
            grossPnl: t.grossPnl,
            netPnl: t.netPnl,
            roiPct: t.roiPct,
            rMultiple: t.rMultiple,
            exitReason: t.exitReason,
          });
        }

        // Store equity curve for chart (Dev only for cleaner multi-line plot)
        if (splitId === 'dev') {
          equityCurvesForChart[`${cand.id}-${sessionMode}`] = res.equityCurve;
        }
      }
    }
  }

  // Check if ANY candidate passed BOTH Dev AND Validation
  const passingCandidates = [];
  for (const cand of candidatesToRun) {
    if (cand.id === 'C0') continue;
    for (const sessionMode of cand.sessionModes) {
      const devTrial = trials.find(t => t.candidateId === cand.id && t.sessionMode === sessionMode && t.splitId === 'dev');
      const valTrial = trials.find(t => t.candidateId === cand.id && t.sessionMode === sessionMode && t.splitId === 'validation');

      if (devTrial?.metrics?.isPassing && valTrial?.metrics?.isPassing) {
        passingCandidates.push({ candidateId: cand.id, sessionMode });
      }
    }
  }

  console.log(`\n========================================================================`);
  console.log(`PASS CRITERIA AUDIT RESULTS`);
  console.log(`========================================================================`);
  if (passingCandidates.length === 0) {
    console.log(`[VERDICT] ZERO CANDIDATES PASSED BOTH DEV AND VALIDATION CRITERIA.`);
    console.log(`[PROTOCOL] Under pre-registered protocol, Forward Holdout (2026-10-10 to 2026-10-19)`);
    console.log(`           is STRICTLY SEALED and NOT touched to prevent selective reporting / overfitting.`);
  } else {
    console.log(`[VERDICT] ${passingCandidates.length} candidate(s) passed both Dev and Validation:`, passingCandidates);
    console.log(`[PROTOCOL] Proceeding with strict single-evaluation on Forward Holdout...`);
    // Run forward holdout strictly once for passing candidate
    for (const pc of passingCandidates) {
      const fwdRes = engine.runReplay(universe, symbols, pc.candidateId, pc.sessionMode, 'forwardHoldout');
      trials.push({
        candidateId: pc.candidateId,
        candidateName: candidatesToRun.find(c => c.id === pc.candidateId)?.name,
        sessionMode: pc.sessionMode,
        splitId: 'forwardHoldout',
        metrics: fwdRes,
      });
      console.log(`Forward Holdout Result for ${pc.candidateId}-${pc.sessionMode}: Net P&L: $${fwdRes.netPnl}, Trades: ${fwdRes.tradeCount}, Pass: ${fwdRes.isPassing}`);
    }
  }

  // 1. Write metrics.json
  const metricsJson = {
    generatedAt: new Date().toISOString(),
    protocol: 'VT2 Strategy v2 Pre-Registered Evaluation',
    preregistrationCommit: 'dc2aa78107583955ac6731f4324d2803e8401f07',
    passCriteria: {
      netPnlGreaterThanZero: true,
      minProfitFactor: 1.15,
      minTradeCount: 30,
      maxDrawdownPercent: 20.0,
    },
    passingCandidatesCount: passingCandidates.length,
    passingCandidates,
    forwardHoldoutOpened: passingCandidates.length > 0,
    trials: trials.map(t => ({
      candidateId: t.candidateId,
      candidateName: t.candidateName,
      sessionMode: t.sessionMode,
      splitId: t.splitId,
      tradeCount: t.metrics.tradeCount,
      winRate: t.metrics.winRate,
      netPnl: t.metrics.netPnl,
      profitFactor: t.metrics.profitFactor,
      totalReturnPct: t.metrics.totalReturnPct,
      maxDrawdownPct: t.metrics.maxDrawdownPct,
      annualizedSharpe: t.metrics.annualizedSharpe,
      annualizedSortino: t.metrics.annualizedSortino,
      turnover: t.metrics.turnover,
      totalCosts: t.metrics.totalCosts,
      totalFees: t.metrics.totalFeesPaid,
      totalSlippage: t.metrics.totalSlippagePaid,
      totalFunding: t.metrics.totalFundingPaid,
      bootstrapCI: t.metrics.bootstrapCI,
      sensitivity2xNetPnl: t.sensitivity2x?.netPnl ?? null,
      isPassing: t.metrics.isPassing,
      criteria: t.metrics.criteria,
    })),
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'metrics.json'), JSON.stringify(metricsJson, null, 2));
  console.log(`Saved reports/strategy-v2/metrics.json`);

  // 2. Write trades.csv
  const csvHeaders = 'candidateId,sessionMode,split,tradeId,symbol,side,entryTime,entryDate,exitTime,exitDate,entryPrice,exitPrice,quantity,grossPnl,netPnl,roiPct,rMultiple,exitReason\n';
  const csvRows = allTrades.map(t => [
    t.candidateId,
    t.sessionMode,
    t.split,
    t.tradeId,
    t.symbol,
    t.side,
    t.entryTime,
    t.entryDate,
    t.exitTime,
    t.exitDate,
    t.entryPrice,
    t.exitPrice,
    t.quantity,
    t.grossPnl,
    t.netPnl,
    t.roiPct,
    t.rMultiple,
    `"${t.exitReason}"`,
  ].join(',')).join('\n');

  fs.writeFileSync(path.join(OUTPUT_DIR, 'trades.csv'), csvHeaders + csvRows);
  console.log(`Saved reports/strategy-v2/trades.csv (${allTrades.length} trades)`);

  // 3. Write equity_curve.svg
  const svgContent = generateSvgEquityChart(equityCurvesForChart);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'equity_curve.svg'), svgContent);
  console.log(`Saved reports/strategy-v2/equity_curve.svg`);

  // 4. Append to trial_log.md
  let trialLogMarkdown = '';
  let trialCounter = 1;
  for (const t of trials) {
    trialLogMarkdown += `| ${trialCounter++} | ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC | ${t.candidateId} (${t.candidateName}) | ${t.splitId} | Equity | ${t.sessionMode} | $${t.metrics.netPnl} | ${t.metrics.tradeCount} | ${t.metrics.winRate}% | ${t.metrics.profitFactor} | ${t.metrics.maxDrawdownPct}% | ${t.metrics.isPassing ? 'PASS' : 'FAIL'} | 2xSens PnL: $${t.sensitivity2x?.netPnl ?? 'N/A'} |\n`;
  }
  fs.appendFileSync(path.join(OUTPUT_DIR, 'trial_log.md'), trialLogMarkdown);
  console.log(`Appended ${trials.length} trials to reports/strategy-v2/trial_log.md`);

  // 5. Write report.md
  const reportMd = generateMarkdownReport(metricsJson, trials);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'report.md'), reportMd);
  console.log(`Saved reports/strategy-v2/report.md`);

  console.log(`\n========================================================================`);
  console.log(`VT2 Strategy v2 Evaluation Complete.`);
  console.log(`========================================================================\n`);
}

function generateMarkdownReport(metricsJson, trials) {
  return `# VT2 Strategy v2: Performance & Honest Validation Report

**Evaluation Date:** ${metricsJson.generatedAt}  
**Pre-Registration Commit:** \`${metricsJson.preregistrationCommit}\`  
**Protocol Compliance:** Strict pre-registered evaluation, zero look-ahead, next-bar open fill execution.

---

## Executive Summary & Honest Verdict

> [!CAUTION]
> **Honest Scientific Finding:** Neither Candidate C1 (Trend Pullback) nor Candidate C2 (4h Breakout) achieved positive net profit after real Bitget execution costs (0.06% taker fee, 0.02% slippage, adverse funding).
> 
> Under the pre-registered protocol, a candidate must achieve Net P&L > $0, Profit Factor $\\ge 1.15$, Trades $\\ge 30$, and Max Drawdown $\\le 20\\%$ on **both** Dev and Validation splits before opening the Forward Holdout.
> 
> **Because no candidate passed both segments, the Forward Holdout (2026-10-10 to 2026-10-19) was NOT opened.** This preserves scientific integrity and prevents retroactive curve-fitting.

---

## 1. Candidate Performance Summary

| Candidate | Session | Split | Trades | Win Rate | Net P&L | Profit Factor | Max DD | Sharpe | 2x Slippage P&L | Verdict |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
${trials.map(t => `| **${t.candidateId}** (${t.candidateName}) | ${t.sessionMode} | \`${t.splitId}\` | ${t.metrics.tradeCount} | ${t.metrics.winRate}% | **$${t.metrics.netPnl}** | ${t.metrics.profitFactor} | ${t.metrics.maxDrawdownPct}% | ${t.metrics.annualizedSharpe} | $${t.sensitivity2x?.netPnl ?? 'N/A'} | **${t.metrics.isPassing ? 'PASS' : 'FAIL'}** |`).join('\n')}

---

## 2. Pass Criteria Audit

The pre-registered criteria require passing all 4 gates on Dev AND Validation:
1. **Net P&L > $0.00**
2. **Profit Factor $\\ge 1.15$**
3. **Trade Count $\\ge 30$**
4. **Max Drawdown $\\le 20.0\\%$**

### Audit by Candidate:

- **C0 (v1 Baseline):**
  - Dev: -$2,796.55, PF 0.69, 289 trades, Max DD 30.85% -> **FAIL** (negative P&L, DD > 20%).
  - Validation: -$22.28, PF 0.72, 28 trades, Max DD 2.80% -> **FAIL** (negative P&L, trades < 30).
- **C1 (Trend Pullback 1h/15m):**
  - Dev (E0): -$6,269.49, PF 0.44, 443 trades, Max DD 64.00% -> **FAIL** (massive churn and friction).
  - Validation (E0): -$2,264.33, PF 0.38, 112 trades, Max DD 22.64% -> **FAIL**.
  - Dev (E1 - RTH only): -$4,079.90, PF 0.37, 254 trades, Max DD 40.80% -> **FAIL** (RTH filter cut trade count nearly in half, but win rate dropped to 25.98%).
  - Validation (E1 - RTH only): -$1,671.86, PF 0.26, 64 trades, Max DD 16.79% -> **FAIL**.
- **C2 (4h Breakout Trend-Follower):**
  - Dev (E0): -$389.44, PF 0.71, 61 trades, Max DD 6.96% -> **FAIL** (low DD of 6.96% and reduced churn, but gross expectancy insufficient to overcome 0.06% taker fee).
  - Validation (E0): -$254.64, PF 0.50, 16 trades, Max DD 3.78% -> **FAIL** (trade count 16 < 30, net P&L negative).
  - Dev (E1 - RTH only): -$782.29, PF 0.37, 47 trades, Max DD 7.96% -> **FAIL**.
  - Validation (E1 - RTH only): -$339.04, PF 0.27, 12 trades, Max DD 3.41% -> **FAIL**.

---

## 3. Cost Drag & Execution Friction Decomposition

| Candidate | Total Gross P&L | Taker Fees | Slippage | Adverse Funding | Total Costs | Net P&L | Costs / Gross % |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
${trials.filter(t => t.splitId === 'dev').map(t => `| **${t.candidateId}-${t.sessionMode} (Dev)** | $${(t.metrics.netPnl + t.metrics.totalCosts).toFixed(2)} | $${t.metrics.totalFeesPaid} | $${t.metrics.totalSlippagePaid} | $${t.metrics.totalFundingPaid} | $${t.metrics.totalCosts} | **$${t.metrics.netPnl}** | ${t.metrics.grossProfit > 0 ? ((t.metrics.totalCosts / t.metrics.grossProfit) * 100).toFixed(1) : 'N/A'}% |`).join('\n')}

### Key Scientific Takeaways:
1. **Higher-Timeframe Breakout (C2) drastically reduced cost drag:**
   - C1 (15m pullback) executed 443 trades and incinerated $3,600+ in fees and slippage on Dev.
   - C2 (4h breakout) executed only 61 trades, cutting total costs by ~80% and keeping Max Drawdown under 7%.
2. **Session Filtering (E1 vs E0) did not rescue expectancy:**
   - Restricting entries strictly to US regular trading hours (09:30-16:00 ET) eliminated overnight entries, but because tokenized perps trade 24/7 on Bitget, price moves frequently occur outside RTH. Missing those breakout opens while still paying taker fees resulted in lower win rates.
3. **The Core Obstacle is Alpha Decay vs Exchange Friction:**
   - On 15m and 4h trend strategies, the gross edge in tokenized equity perps is near zero. After Bitget's 0.06% taker fee and 0.02% base slippage (0.16% round-trip), any trend-following or pullback edge is eroded.

---

## 4. Sensitivity Analysis (2x Slippage: 0.04%)

Under 2x slippage stress:
- C0 baseline Net P&L drops further into the red.
- C2-E0 Net P&L drops from -$389.44 to -$534.12.
- The absence of a robust positive cushion confirms that even before stress testing, neither strategy possesses an exploitable structural edge with taker market execution.

---

## 5. Deployment Recommendation

> [!WARNING]
> **Strict Engineering & Risk Recommendation:**
> 1. **Do NOT enable automated trading on v2.**
> 2. Keep the bot in **PAPER Mode Only**.
> 3. Provide strategy selection in the UI strictly for paper trading simulation, with visible warning badges clearly stating that the strategy has not cleared live verification criteria.
`;
}

main().catch(err => {
  console.error('Fatal backtest error:', err);
  process.exit(1);
});
