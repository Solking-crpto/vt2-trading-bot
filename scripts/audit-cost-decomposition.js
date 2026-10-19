import fs from 'node:fs';
import path from 'node:path';
import { AlphaPortfolioEngine } from '../src/backtest/alpha-portfolio-engine.js';
import { V2PortfolioEngine, SPLITS } from '../src/strategy/v2/v2-portfolio-engine.js';
import { prepareIndexedUniverse, runFastAblationReplay } from './run-v1-ablation.js';

const HEADLINE_SYMBOLS = [
  'SPYUSDT', 'QQQUSDT', 'NVDAUSDT', 'TSLAUSDT', 'AAPLUSDT',
  'MSFTUSDT', 'AMZNUSDT', 'PLTRUSDT', 'SOXLUSDT', 'SQQQUSDT',
  'MUUSDT', 'AMDUSDT', 'SNDKUSDT', 'SMCIUSDT', 'AVGOUSDT',
  'QCOMUSDT', 'WMTUSDT', 'COSTUSDT', 'RKLBUSDT',
];

async function runAudit() {
  console.log('Loading universe for cost decomposition and risk-sizing audit...');
  const v2Engine = new V2PortfolioEngine();
  const universe = v2Engine.loadUniverse(HEADLINE_SYMBOLS);
  const preparedV1 = prepareIndexedUniverse(universe, HEADLINE_SYMBOLS);

  const DEV_START_TS = 1778520600000;
  const DEV_END_TS = 1789138800000;

  // 1. Published v1 In-Sample
  const alphaEngine = new AlphaPortfolioEngine();
  const v1Full = alphaEngine.runPortfolioReplay(HEADLINE_SYMBOLS, { maxBars: 14679 });
  const v1DevTrades = v1Full.trades.filter(t => !t.isOos);

  // 2. C0 on Dev
  const c0Res = runFastAblationReplay(preparedV1, HEADLINE_SYMBOLS, {
    startTs: DEV_START_TS,
    endTs: DEV_END_TS,
  });

  // 3. C1-E0 on Dev
  const c1e0Res = v2Engine.runReplay(universe, HEADLINE_SYMBOLS, 'C1', 'E0', 'dev');

  // 4. C1-E1 on Dev
  const c1e1Res = v2Engine.runReplay(universe, HEADLINE_SYMBOLS, 'C1', 'E1', 'dev');

  // 5. C2-E0 on Dev
  const c2e0Res = v2Engine.runReplay(universe, HEADLINE_SYMBOLS, 'C2', 'E0', 'dev');

  // 6. C2-E1 on Dev
  const c2e1Res = v2Engine.runReplay(universe, HEADLINE_SYMBOLS, 'C2', 'E1', 'dev');

  const candidates = [
    { name: 'v1 on Dev (Published)', trades: v1DevTrades, riskDollarBase: 50 },
    { name: 'C0 (v1 Baseline Dev)', trades: c0Res.trades, riskDollarBase: 50 },
    { name: 'C1-E0 (1h/15m Pullback 24/7)', trades: c1e0Res.trades, riskDollarBase: 50 },
    { name: 'C1-E1 (1h/15m Pullback RTH)', trades: c1e1Res.trades, riskDollarBase: 50 },
    { name: 'C2-E0 (4h Breakout 24/7)', trades: c2e0Res.trades, riskDollarBase: 50 },
    { name: 'C2-E1 (4h Breakout RTH)', trades: c2e1Res.trades, riskDollarBase: 50 },
  ];

  console.log('\n========================================================================================================');
  console.log('PART A3: COST DECOMPOSITION TABLE (DEV DATA)');
  console.log('========================================================================================================');

  const decompRows = [];

  for (const cand of candidates) {
    const ts = cand.trades;
    const n = ts.length;
    if (n === 0) continue;

    let totalGross = 0;
    let totalFees = 0;
    let totalSlippage = 0;
    let totalFunding = 0;
    let totalNet = 0;
    let totalCostInR = 0;
    let totalCostPctNotional = 0;
    let totalStopDistPct = 0;
    let totalHoldingHours = 0;
    let wins = 0;
    let sumWinPnl = 0;
    let sumLossPnl = 0;
    let totalR = 0;

    for (const t of ts) {
      const net = t.netPnl;
      const fee = (t.entryFee || 0) + (t.exitFee || 0) + (t.partialFee || 0);
      const slip = t.slippagePaid || (Math.abs(t.entryPrice - (t.rawEntryPrice || t.entryPrice)) + Math.abs(t.exitPrice - (t.rawExitPrice || t.exitPrice))) * t.quantity;
      const funding = t.fundingPaid || 0;
      const totalCost = fee + slip + funding;
      const gross = t.grossPnl !== undefined ? t.grossPnl : (net + totalCost);

      const notional = (t.entryPrice * t.quantity);
      const riskBudget = t.riskBudgetDollars || 50; // default 0.5% of $10,000

      totalGross += gross;
      totalFees += fee;
      totalSlippage += slip;
      totalFunding += funding;
      totalNet += net;

      totalCostInR += (totalCost / riskBudget);
      if (notional > 0) totalCostPctNotional += ((totalCost / notional) * 100);

      const stopDist = t.stopDistance || Math.abs(t.entryPrice - (t.stopLoss || t.entryPrice * 0.993));
      if (t.entryPrice > 0) totalStopDistPct += ((stopDist / t.entryPrice) * 100);

      if (t.exitTime && t.entryTime) {
        totalHoldingHours += (t.exitTime - t.entryTime) / (3600 * 1000);
      }

      const rMult = t.rMultiple !== undefined ? t.rMultiple : (net / riskBudget);
      totalR += rMult;

      if (net > 0) {
        wins++;
        sumWinPnl += net;
      } else {
        sumLossPnl += Math.abs(net);
      }
    }

    const winRate = (wins / n) * 100;
    const avgWin = wins > 0 ? sumWinPnl / wins : 0;
    const avgLoss = (n - wins) > 0 ? sumLossPnl / (n - wins) : 1;
    const avgRR = avgLoss > 0 ? avgWin / avgLoss : 0;
    const beWinRate = (1 / (1 + avgRR)) * 100;
    const expectancyR = totalR / n;

    decompRows.push({
      Candidate: cand.name,
      Trades: n,
      Gross_Pnl: `$${totalGross.toFixed(2)}`,
      Fees: `$${totalFees.toFixed(2)}`,
      Slippage: `$${totalSlippage.toFixed(2)}`,
      Funding: `$${totalFunding.toFixed(2)}`,
      Net_Pnl: `$${totalNet.toFixed(2)}`,
      Avg_Cost_R: `${(totalCostInR / n).toFixed(2)}R`,
      Avg_Cost_Pct: `${(totalCostPctNotional / n).toFixed(2)}%`,
      Avg_Stop_Dist: `${(totalStopDistPct / n).toFixed(2)}%`,
      Avg_Hold_Hr: `${(totalHoldingHours / n).toFixed(1)}h`,
      Actual_WR: `${winRate.toFixed(1)}%`,
      BE_WR: `${beWinRate.toFixed(1)}%`,
      Expectancy_R: `${expectancyR.toFixed(2)}R`,
    });
  }

  console.table(decompRows);

  console.log('\n========================================================================================================');
  console.log('PART A4: RISK-SIZING AUDIT (C1 ON DEV)');
  console.log('========================================================================================================');

  const c1Trades = c1e0Res.trades;
  console.log(`Total Trades for C1-E0: ${c1Trades.length}`);
  console.log(`Stated Risk Per Trade: 0.5% ($50 base on $10k equity)`);

  // Distribution of realized loss in R
  const rDistribution = {
    'Gains (> 0R)': 0,
    'Mild Loss (0R to -0.5R)': 0,
    'Standard Loss (-0.5R to -1.0R)': 0,
    'Slippage Loss (-1.0R to -1.5R)': 0,
    'Severe Overshoot (< -1.5R)': 0,
  };

  let maxLossR = 0;
  let maxLossTrade = null;

  for (const t of c1Trades) {
    const riskBudget = t.riskBudgetDollars || 50;
    const r = t.netPnl / riskBudget;
    if (r > 0) {
      rDistribution['Gains (> 0R)']++;
    } else if (r >= -0.5) {
      rDistribution['Mild Loss (0R to -0.5R)']++;
    } else if (r >= -1.0) {
      rDistribution['Standard Loss (-0.5R to -1.0R)']++;
    } else if (r >= -1.5) {
      rDistribution['Slippage Loss (-1.0R to -1.5R)']++;
    } else {
      rDistribution['Severe Overshoot (< -1.5R)']++;
    }

    if (r < maxLossR) {
      maxLossR = r;
      maxLossTrade = t;
    }
  }

  console.log('\nRealized Loss Distribution in R (Multiples of Risk Budget):');
  console.table(rDistribution);
  console.log(`Largest single loss: ${maxLossR.toFixed(2)}R ($${maxLossTrade?.netPnl} on ${maxLossTrade?.symbol} ${maxLossTrade?.side})`);

  // Top 10 worst trades for C1
  const sortedWorst = [...c1Trades].sort((a, b) => a.netPnl - b.netPnl).slice(0, 10);

  const top10Rows = sortedWorst.map((t, idx) => {
    const stopDist = t.stopDistance || Math.abs(t.entryPrice - t.stopLoss);
    const stopDistPct = ((stopDist / t.entryPrice) * 100).toFixed(2);
    const fee = (t.entryFee || 0) + (t.exitFee || 0);
    const slip = t.slippagePaid || 0;
    const gross = t.grossPnl !== undefined ? t.grossPnl : (t.netPnl + fee + slip);
    return {
      Rank: idx + 1,
      Symbol: t.symbol,
      Side: t.side,
      EntryDate: t.entryDate?.split('T')[0] || t.entryTime,
      EntryPrice: t.entryPrice.toFixed(2),
      ExitPrice: t.exitPrice.toFixed(2),
      Qty: t.quantity,
      StopDist: `$${stopDist.toFixed(2)} (${stopDistPct}%)`,
      Gross_Pnl: `$${gross.toFixed(2)}`,
      Fee: `$${fee.toFixed(2)}`,
      Slippage: `$${slip.toFixed(2)}`,
      Net_Pnl: `$${t.netPnl.toFixed(2)}`,
      R_Loss: `${(t.netPnl / (t.riskBudgetDollars || 50)).toFixed(2)}R`,
    };
  });

  console.log('\nTop 10 Worst Trades for C1:');
  console.table(top10Rows);
}

runAudit().catch(err => {
  console.error(err);
  process.exit(1);
});
