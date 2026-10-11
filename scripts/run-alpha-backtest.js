import fs from 'node:fs';
import path from 'node:path';
import { AlphaPortfolioEngine } from '../src/backtest/alpha-portfolio-engine.js';

const REPORTS_DIR = path.resolve('reports/alpha-factory');
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

// 19 headline contracts verified with >=90 days of continuous 15m/4h data
const HEADLINE_SYMBOLS = [
  'SPYUSDT', 'QQQUSDT', 'NVDAUSDT', 'TSLAUSDT', 'AAPLUSDT',
  'MSFTUSDT', 'AMZNUSDT', 'PLTRUSDT', 'SOXLUSDT', 'SQQQUSDT',
  'MUUSDT', 'AMDUSDT', 'SNDKUSDT', 'SMCIUSDT', 'AVGOUSDT',
  'QCOMUSDT', 'WMTUSDT', 'COSTUSDT', 'RKLBUSDT',
];

function generateSvgChart(equityCurve, spyReturnPct) {
  if (!equityCurve || equityCurve.length === 0) return '';
  const width = 800;
  const height = 300;
  const padding = 50;

  const equities = equityCurve.map(p => p.equity);
  const minEq = Math.min(...equities) * 0.99;
  const maxEq = Math.max(...equities) * 1.01;

  const points = equityCurve.map((pt, idx) => {
    const x = padding + (idx / (equityCurve.length - 1)) * (width - 2 * padding);
    const y = height - padding - ((pt.equity - minEq) / (maxEq - minEq)) * (height - 2 * padding);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const initialEq = equityCurve[0].equity;
  const finalEq = equityCurve[equityCurve.length - 1].equity;
  const totalReturn = (((finalEq - initialEq) / initialEq) * 100).toFixed(2);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">
  <rect width="${width}" height="${height}" fill="#0f172a" rx="8"/>
  <text x="${padding}" y="30" fill="#f8fafc" font-size="14" font-weight="bold">VT2 Alpha Factory Portfolio Equity Curve (${totalReturn}% Total Return vs SPY ${spyReturnPct}%)</text>
  <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#334155" stroke-width="1"/>
  <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="#334155" stroke-width="1"/>
  <polyline fill="none" stroke="#38bdf8" stroke-width="2.5" points="${points}"/>
  <text x="${padding}" y="${height - 15}" fill="#94a3b8" font-size="11">Start ($${initialEq})</text>
  <text x="${width - padding - 60}" y="${height - 15}" fill="#38bdf8" font-size="11">End ($${finalEq})</text>
</svg>`;
}

async function main() {
  console.log('================================================================================');
  console.log('VT2 ALPHA FACTORY — CHRONOLOGICAL PORTFOLIO BACKTEST');
  console.log('Track 1: Alpha Factory | Open Theme: Tokenized US Equity Perpetuals');
  console.log('================================================================================\n');

  const engine = new AlphaPortfolioEngine();
  const startTime = Date.now();
  const result = engine.runPortfolioReplay(HEADLINE_SYMBOLS);
  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);

  const m = result.metrics;
  const s = m.summary;

  // 1. Save metrics.json
  fs.writeFileSync(path.join(REPORTS_DIR, 'metrics.json'), JSON.stringify(m, null, 2));

  // 2. Save trades.csv
  const csvHeaders = 'tradeId,symbol,side,entryTime,entryDate,exitTime,exitDate,entryPrice,exitPrice,quantity,netPnl,roiPct,exitReason,equityAfter,isOos\n';
  const csvRows = result.trades.map(t =>
    `${t.tradeId},${t.symbol},${t.side},${t.entryTime},${t.entryDate},${t.exitTime},${t.exitDate},${t.entryPrice},${t.exitPrice},${t.quantity},${t.netPnl},${t.roiPct},${t.exitReason},${t.equityAfter},${t.isOos}`
  ).join('\n');
  fs.writeFileSync(path.join(REPORTS_DIR, 'trades.csv'), csvHeaders + csvRows);

  // 3. Save equity_curve.csv
  const eqHeaders = 'timestamp,date,equity,drawdown,drawdownPct,isOos\n';
  const eqRows = result.equityCurve.map(e =>
    `${e.timestamp},${e.date},${e.equity},${e.drawdown},${e.drawdownPct},${e.isOos}`
  ).join('\n');
  fs.writeFileSync(path.join(REPORTS_DIR, 'equity_curve.csv'), eqHeaders + eqRows);

  // 4. Save SVG Chart
  const svg = generateSvgChart(result.equityCurve, m.benchmarks.spyBuyAndHold.totalReturnPct);
  fs.writeFileSync(path.join(REPORTS_DIR, 'equity_curve.svg'), svg);

  // 5. Generate comprehensive report.md
  const reportMd = `# VT2 Alpha Factory: Quantitative Strategy Backtest Report

**Track 1:** Alpha Factory  
**Theme:** Open Theme (Execution-Aware, Risk-Budgeted Alpha on Tokenized US Equity Perpetuals)  
**Strategy Hash:** \`541c10ab1dcae7bbaaebe5d8c465730bd118747b\`  
**Simulation Period:** ${result.totalDays} Days (~${result.totalDays >= 90 ? '5 Months' : '3 Months'}, May 2026 – October 2026)  
**Universe:** 19 Verified Bitget Tokenized US Equity Perpetuals (\`isRwa === "YES"\`)  
**Operating Mode:** Paper Replay with Live Deterministic Risk Engine Constraints  

---

## 1. Executive Summary & Headline Results

| Metric | In-Sample (IS) [observed] | Out-of-Sample (OOS, Final 30d) [observed] | Total Replay [observed] |
| :--- | :--- | :--- | :--- |
| **Trade Count** | ${s.inSample.tradeCount} | ${s.outOfSample.tradeCount} | ${s.total.tradeCount} |
| **Win Rate** | ${s.inSample.winRate}% | ${s.outOfSample.winRate}% | ${s.total.winRate}% |
| **Net P&L ($)** | $${s.inSample.totalPnl} | $${s.outOfSample.totalPnl} | $${s.total.totalPnl} |
| **Total Return (%)** | ${s.inSample.totalReturnPct}% | ${s.outOfSample.totalReturnPct}% | ${s.total.totalReturnPct}% |
| **Annualized Sharpe (365d)** | ${s.inSample.annualizedSharpe} | ${s.outOfSample.annualizedSharpe} | ${s.total.annualizedSharpe} |
| **Annualized Sortino (365d)** | ${s.inSample.annualizedSortino} | ${s.outOfSample.annualizedSortino} | ${s.total.annualizedSortino} |
| **Max Drawdown ($ / %)** | $${s.inSample.maxDrawdownDollars} (${s.inSample.maxDrawdownPct}%) | $${s.outOfSample.maxDrawdownDollars} (${s.outOfSample.maxDrawdownPct}%) | $${s.total.maxDrawdownDollars} (${s.total.maxDrawdownPct}%) |
| **Average Win / Loss ($)** | $${s.inSample.avgWinDollars} / $${s.inSample.avgLossDollars} | $${s.outOfSample.avgWinDollars} / $${s.outOfSample.avgLossDollars} | $${s.total.avgWinDollars} / $${s.total.avgLossDollars} |
| **Profit Factor** | ${s.inSample.profitFactor} | ${s.outOfSample.profitFactor} | ${s.total.profitFactor} |
| **Portfolio Turnover** | ${s.inSample.turnover}x | ${s.outOfSample.turnover}x | ${s.total.turnover}x |

### Out-of-Sample Decay Analysis
- **In-Sample Annualized Sharpe:** ${s.sharpeDecay.isSharpe}
- **Out-of-Sample Annualized Sharpe:** ${s.sharpeDecay.oosSharpe}
- **OOS Sharpe Decay Ratio:** ${s.sharpeDecay.decayRatio} [observed]
- **Sharpe Decay Flag (< 0.5):** ${s.sharpeDecay.decayAlertFlag ? '⚠️ DECAY ALERT (< 0.5x IS)' : '✅ PASS (>= 0.5x IS)'}

---

## 2. Benchmark Comparisons

| Strategy / Asset | Total Return (%) [observed] | Max Drawdown (%) [observed] | Nature of Comparison |
| :--- | :--- | :--- | :--- |
| **VT2 Alpha Factory (Tokenized Equities)** | **${s.total.totalReturnPct}%** | **${s.total.maxDrawdownPct}%** | Execution-Aware Quantitative Bot |
| **SPYUSDT Buy-and-Hold** | **${m.benchmarks.spyBuyAndHold.totalReturnPct}%** | **${m.benchmarks.spyBuyAndHold.maxDrawdownPct}%** | S&P 500 Benchmark Asset |
| **Equal-Weight 19-Stock Basket** | **${m.benchmarks.equalWeightBasket.totalReturnPct}%** | N/A | Passive Equal-Weight Portfolio |

---

## 3. Real Execution Cost Modeling

All returns are net of institutional taker fees, realistic execution slippage, and continuous funding:
- **Total Taker Fees Paid:** $${m.costs.totalFeesPaid} [observed: 0.05% taker rate per fill]
- **Total Execution Slippage Paid:** $${m.costs.totalSlippagePaid} [observed: 0.02% slippage rate]
- **Total 8h Funding Rate Paid:** $${m.costs.totalFundingPaid} [observed / modeled: 0.01% / 8h]
- **Total Cumulative Friction:** $${m.costs.totalTradingCosts} [observed]
- **Market Exposure Time:** ${m.exposureTimePct}% of total timeline [observed]

---

## 4. Top Performing Contracts Breakdown

${m.perSymbol.map(s => `- **${s.symbol}:** ${s.trades} trades, ${s.winRate}% win rate, Net P&L: $${s.pnl}`).join('\n')}

---

## 5. Honest Methodological Disclosures

1. **Net Reward-to-Risk Design Filter:** Scans and proposals require net R:R >= 1.5. Target prices are calculated from ATR multiples subject to this minimum floor. The 1.5 ratio is a **strict design filter**, not evidence of market edge.
2. **Ambiguous Bar Resolution:** Ambiguous bars (where both SL and TP price levels are within the high-low bar range) are resolved with conservative **stop-loss first** execution.
3. **Zero Look-Ahead Bias:** Indicators at bar \`i\` evaluate exclusively bars \`0..i\`. 4h trend calculations strictly use closed 4h candles. Orders fill at the open of bar \`i+1\` plus slippage.
4. **Funding Rates:** Bitget's \`history-fund-rate\` for equity perpetuals shows zero rates in current history; a standard 0.01% per 8h funding cost was applied to model adverse carry.
`;

  fs.writeFileSync(path.join(REPORTS_DIR, 'report.md'), reportMd);

  console.log(`Simulation completed in ${durationSec}s across ${result.universe.length} symbols.\n`);
  console.log('--------------------------------------------------------------------------------');
  console.log('SUMMARY METRICS TABLE');
  console.log('--------------------------------------------------------------------------------');
  console.table([
    { Metric: 'Trade Count', IS: s.inSample.tradeCount, OOS: s.outOfSample.tradeCount, Total: s.total.tradeCount },
    { Metric: 'Win Rate (%)', IS: s.inSample.winRate, OOS: s.outOfSample.winRate, Total: s.total.winRate },
    { Metric: 'Net P&L ($)', IS: s.inSample.totalPnl, OOS: s.outOfSample.totalPnl, Total: s.total.totalPnl },
    { Metric: 'Return (%)', IS: s.inSample.totalReturnPct, OOS: s.outOfSample.totalReturnPct, Total: s.total.totalReturnPct },
    { Metric: 'Annualized Sharpe', IS: s.inSample.annualizedSharpe, OOS: s.outOfSample.annualizedSharpe, Total: s.total.annualizedSharpe },
    { Metric: 'Annualized Sortino', IS: s.inSample.annualizedSortino, OOS: s.outOfSample.annualizedSortino, Total: s.total.annualizedSortino },
    { Metric: 'Max Drawdown (%)', IS: s.inSample.maxDrawdownPct, OOS: s.outOfSample.maxDrawdownPct, Total: s.total.maxDrawdownPct },
    { Metric: 'Profit Factor', IS: s.inSample.profitFactor, OOS: s.outOfSample.profitFactor, Total: s.total.profitFactor },
    { Metric: 'Turnover (x)', IS: s.inSample.turnover, OOS: s.outOfSample.turnover, Total: s.total.turnover },
  ]);

  console.log(`\nOOS Sharpe Decay Ratio: ${s.sharpeDecay.decayRatio} (Flag: ${s.sharpeDecay.decayAlertFlag ? 'ALERT' : 'PASS'})`);
  console.log(`Benchmark SPY Buy-and-Hold Return: ${m.benchmarks.spyBuyAndHold.totalReturnPct}% (Max DD: ${m.benchmarks.spyBuyAndHold.maxDrawdownPct}%)`);
  console.log(`Benchmark Equal-Weight Basket Return: ${m.benchmarks.equalWeightBasket.totalReturnPct}%`);
  console.log(`Total Trading Costs (Fees + Slippage + Funding): $${m.costs.totalTradingCosts}`);
  console.log(`Outputs written to ${REPORTS_DIR}/:`);
  console.log(' - metrics.json');
  console.log(' - trades.csv');
  console.log(' - equity_curve.csv');
  console.log(' - report.md');
  console.log(' - equity_curve.svg');
}

main().catch(err => {
  console.error('Backtest error:', err);
  process.exit(1);
});
