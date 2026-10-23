import fs from 'node:fs';
import path from 'node:path';

const BTC_FILE = path.resolve('data/history/BTCUSDT_1d_full.json');
const ETH_FILE = path.resolve('data/history/ETHUSDT_1d_full.json');
const OUTPUT_DIR = path.resolve('reports/strategy-v2');

// Costs per pre-registration
const TAKER_FEE_RATE = 0.0006;  // 0.06%
const SLIPPAGE_RATE = 0.0002;   // 0.02%
const DAILY_FUNDING_RATE = 0.000159; // 3 x 0.0053% empirical 8h funding = 0.0159% / day

// Splits
const SPLIT_DATES = {
  dev: {
    start: '2019-11-17', // 100 days after ETH started (Aug 9, 2019)
    end: '2023-12-31',
    label: 'Dev (In-Sample: 2019 - 2023)',
  },
  validation: {
    start: '2024-01-01',
    end: '2025-12-31',
    label: 'Validation (Out-of-Sample: 2024 - 2025)',
  },
  forward: {
    start: '2026-01-01',
    end: '2026-10-19',
    label: 'Forward Holdout (2026 to Present)',
  },
};

function computeBootstrapCI(returns, numResamples = 1000, alpha = 0.20) {
  if (!returns || returns.length === 0) return { mean: 0, lower80: 0, upper80: 0 };
  const n = returns.length;
  const sampleMeans = new Float64Array(numResamples);

  let seed = 42;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  for (let r = 0; r < numResamples; r++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(nextRand() * n);
      sum += returns[idx];
    }
    sampleMeans[r] = sum / n;
  }

  sampleMeans.sort();
  const lowerIdx = Math.floor((alpha / 2) * numResamples);
  const upperIdx = Math.floor((1 - alpha / 2) * numResamples);
  const realMean = returns.reduce((a, b) => a + b, 0) / n;

  return {
    mean: Number(realMean.toFixed(2)),
    lower80: Number(sampleMeans[lowerIdx].toFixed(2)),
    upper80: Number(sampleMeans[upperIdx].toFixed(2)),
  };
}

function runSegmentReplay(btcDaily, ethDaily, splitKey) {
  const split = SPLIT_DATES[splitKey];
  const btcMap = new Map(btcDaily.map(c => [c.date, c]));
  const ethMap = new Map(ethDaily.map(c => [c.date, c]));

  // Find overlapping dates in split range
  const dates = btcDaily
    .map(c => c.date)
    .filter(d => d >= split.start && d <= split.end && ethMap.has(d))
    .sort();

  if (dates.length < 10) {
    throw new Error(`Insufficient dates for split ${splitKey}`);
  }

  let l1Equity = 10000;
  let bhEquity = 10000;

  let l1Peak = l1Equity;
  let bhPeak = bhEquity;
  let l1MaxDdDollars = 0;
  let bhMaxDdDollars = 0;
  let l1MaxDdPct = 0;
  let bhMaxDdPct = 0;

  let btcPos = 0; // units held
  let ethPos = 0;

  let bhBtcPos = (bhEquity * 0.5) / btcMap.get(dates[0]).open;
  let bhEthPos = (bhEquity * 0.5) / ethMap.get(dates[0]).open;

  let totalFees = 0;
  let totalSlippage = 0;
  let totalFunding = 0;

  const tradeRecords = [];
  let currentBtcTrade = null;
  let currentEthTrade = null;

  for (let i = 0; i < dates.length - 1; i++) {
    const curDate = dates[i];
    const nextDate = dates[i + 1];

    const btcCur = btcMap.get(curDate);
    const ethCur = ethMap.get(curDate);
    const btcNext = btcMap.get(nextDate);
    const ethNext = ethMap.get(nextDate);

    // 1. Evaluate Signals on Day t Close
    const btcSignalLong = btcCur.close > btcCur.sma100;
    const ethSignalLong = ethCur.close > ethCur.sma100;

    // Target weights for day t+1
    let targetBtcWeight = 0;
    let targetEthWeight = 0;
    if (btcSignalLong && ethSignalLong) {
      targetBtcWeight = 0.50;
      targetEthWeight = 0.50;
    } else if (btcSignalLong) {
      targetBtcWeight = 0.50;
      targetEthWeight = 0.00;
    } else if (ethSignalLong) {
      targetBtcWeight = 0.00;
      targetEthWeight = 0.50;
    }

    // 2. Execute on Day t+1 Open
    const execPriceBtc = btcNext.open;
    const execPriceEth = ethNext.open;

    // Current position values at Day t+1 Open
    const currentBtcVal = btcPos * execPriceBtc;
    const currentEthVal = ethPos * execPriceEth;
    const cashVal = l1Equity - currentBtcVal - currentEthVal;

    // Target position values
    const targetBtcVal = l1Equity * targetBtcWeight;
    const targetEthVal = l1Equity * targetEthWeight;

    const deltaBtcVal = targetBtcVal - currentBtcVal;
    const deltaEthVal = targetEthVal - currentEthVal;

    // Execution costs on deltas
    const btcTradedNotional = Math.abs(deltaBtcVal);
    const ethTradedNotional = Math.abs(deltaEthVal);

    const btcFee = btcTradedNotional * TAKER_FEE_RATE;
    const ethFee = ethTradedNotional * TAKER_FEE_RATE;
    const btcSlip = btcTradedNotional * SLIPPAGE_RATE;
    const ethSlip = ethTradedNotional * SLIPPAGE_RATE;

    const tradeCosts = btcFee + ethFee + btcSlip + ethSlip;
    l1Equity -= tradeCosts;
    totalFees += (btcFee + ethFee);
    totalSlippage += (btcSlip + ethSlip);

    // Update positions
    const newBtcPos = targetBtcVal / execPriceBtc;
    const newEthPos = targetEthVal / execPriceEth;

    // Log trades / position changes
    if (Math.abs(newBtcPos - btcPos) > 0.0001) {
      if (btcPos === 0 && newBtcPos > 0) {
        currentBtcTrade = { symbol: 'BTCUSDT', entryDate: nextDate, entryPrice: execPriceBtc, units: newBtcPos };
      } else if (btcPos > 0 && newBtcPos === 0 && currentBtcTrade) {
        const pnl = (execPriceBtc - currentBtcTrade.entryPrice) * currentBtcTrade.units - (btcFee + btcSlip);
        tradeRecords.push({
          symbol: 'BTCUSDT',
          entryDate: currentBtcTrade.entryDate,
          exitDate: nextDate,
          entryPrice: currentBtcTrade.entryPrice,
          exitPrice: execPriceBtc,
          netPnl: Number(pnl.toFixed(2)),
          roiPct: Number(((pnl / (currentBtcTrade.entryPrice * currentBtcTrade.units)) * 100).toFixed(2)),
        });
        currentBtcTrade = null;
      }
    }

    if (Math.abs(newEthPos - ethPos) > 0.0001) {
      if (ethPos === 0 && newEthPos > 0) {
        currentEthTrade = { symbol: 'ETHUSDT', entryDate: nextDate, entryPrice: execPriceEth, units: newEthPos };
      } else if (ethPos > 0 && newEthPos === 0 && currentEthTrade) {
        const pnl = (execPriceEth - currentEthTrade.entryPrice) * currentEthTrade.units - (ethFee + ethSlip);
        tradeRecords.push({
          symbol: 'ETHUSDT',
          entryDate: currentEthTrade.entryDate,
          exitDate: nextDate,
          entryPrice: currentEthTrade.entryPrice,
          exitPrice: execPriceEth,
          netPnl: Number(pnl.toFixed(2)),
          roiPct: Number(((pnl / (currentEthTrade.entryPrice * currentEthTrade.units)) * 100).toFixed(2)),
        });
        currentEthTrade = null;
      }
    }

    btcPos = newBtcPos;
    ethPos = newEthPos;

    // 3. Daily Funding Cost Deduction while Long
    const dailyFundingBtc = (btcPos * btcNext.close) * DAILY_FUNDING_RATE;
    const dailyFundingEth = (ethPos * ethNext.close) * DAILY_FUNDING_RATE;
    const fundingToday = dailyFundingBtc + dailyFundingEth;
    l1Equity -= fundingToday;
    totalFunding += fundingToday;

    // 4. Mark to Market at Day t+1 Close
    const btcCloseVal = btcPos * btcNext.close;
    const ethCloseVal = ethPos * btcNext.close > 0 ? ethPos * ethNext.close : 0;
    const remainingCash = l1Equity - (btcPos * execPriceBtc + ethPos * execPriceEth);
    l1Equity = btcCloseVal + ethCloseVal + remainingCash;

    // Buy and Hold Mark to Market
    bhEquity = bhBtcPos * btcNext.close + bhEthPos * ethNext.close;

    // Track Peak & Drawdown
    if (l1Equity > l1Peak) l1Peak = l1Equity;
    const l1Dd = l1Peak - l1Equity;
    const l1DdPct = (l1Dd / l1Peak) * 100;
    if (l1Dd > l1MaxDdDollars) l1MaxDdDollars = l1Dd;
    if (l1DdPct > l1MaxDdPct) l1MaxDdPct = l1DdPct;

    if (bhEquity > bhPeak) bhPeak = bhEquity;
    const bhDd = bhPeak - bhEquity;
    const bhDdPct = (bhDd / bhPeak) * 100;
    if (bhDd > bhMaxDdDollars) bhMaxDdDollars = bhDd;
    if (bhDdPct > bhMaxDdPct) bhMaxDdPct = bhDdPct;
  }

  const l1TotalReturnPct = ((l1Equity - 10000) / 10000) * 100;
  const bhTotalReturnPct = ((bhEquity - 10000) / 10000) * 100;

  const l1ReturnToDd = l1MaxDdPct > 0 ? Number((l1TotalReturnPct / l1MaxDdPct).toFixed(2)) : 0;
  const bhReturnToDd = bhMaxDdPct > 0 ? Number((bhTotalReturnPct / bhMaxDdPct).toFixed(2)) : 0;

  const ddReductionRatio = bhMaxDdPct > 0 ? Number((l1MaxDdPct / bhMaxDdPct).toFixed(2)) : 1.0;

  // Pass criteria
  const passNetProfit = l1TotalReturnPct > 0;
  const passDdReduction = l1MaxDdPct <= 0.60 * bhMaxDdPct;
  const passReturnToDd = l1ReturnToDd > bhReturnToDd;
  const isPassing = passNetProfit && passDdReduction && passReturnToDd;

  const roiList = tradeRecords.map(t => t.roiPct);
  const bootstrapCI = computeBootstrapCI(roiList, 1000, 0.20);

  return {
    splitKey,
    label: split.label,
    startDate: split.start,
    endDate: split.end,
    days: dates.length,
    tradesCount: tradeRecords.length,
    l1ReturnPct: Number(l1TotalReturnPct.toFixed(2)),
    bhReturnPct: Number(bhTotalReturnPct.toFixed(2)),
    l1MaxDdPct: Number(l1MaxDdPct.toFixed(2)),
    bhMaxDdPct: Number(bhMaxDdPct.toFixed(2)),
    l1ReturnToDd,
    bhReturnToDd,
    ddReductionRatio,
    totalFees: Number(totalFees.toFixed(2)),
    totalSlippage: Number(totalSlippage.toFixed(2)),
    totalFunding: Number(totalFunding.toFixed(2)),
    totalCosts: Number((totalFees + totalSlippage + totalFunding).toFixed(2)),
    bootstrapCI,
    passNetProfit,
    passDdReduction,
    passReturnToDd,
    isPassing,
    trades: tradeRecords,
  };
}

function calculateSMA(candles, period = 100) {
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      candles[i].sma100 = null;
    } else {
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += candles[i - j].close;
      }
      candles[i].sma100 = sum / period;
    }
  }
}

async function main() {
  console.log(`========================================================================`);
  console.log(`VT2 Strategy v2: Candidate L1 Long-History Trend Strategy Replay`);
  console.log(`Pre-Registration: reports/strategy-v2/PREREGISTRATION_L1.md (Commit: 49bc92f)`);
  console.log(`========================================================================\n`);

  const btcData = JSON.parse(fs.readFileSync(BTC_FILE, 'utf8')).candles;
  const ethData = JSON.parse(fs.readFileSync(ETH_FILE, 'utf8')).candles;

  calculateSMA(btcData, 100);
  calculateSMA(ethData, 100);

  // 1. Run Dev Split (2019 - 2023)
  console.log(`Evaluating Segment: Dev Split (2019-11-17 to 2023-12-31)...`);
  const devRes = runSegmentReplay(btcData, ethData, 'dev');
  console.log(`  L1 Net Return: +${devRes.l1ReturnPct}% (vs Buy&Hold: +${devRes.bhReturnPct}%)`);
  console.log(`  L1 Max Drawdown: ${devRes.l1MaxDdPct}% (vs Buy&Hold: ${devRes.bhMaxDdPct}%) [Ratio: ${devRes.ddReductionRatio}x <= 0.60x: ${devRes.passDdReduction}]`);
  console.log(`  Return / MaxDD: L1=${devRes.l1ReturnToDd} vs B&H=${devRes.bhReturnToDd} [Higher: ${devRes.passReturnToDd}]`);
  console.log(`  Total Trades: ${devRes.tradesCount} | Friction Paid: $${devRes.totalCosts} (Fees $${devRes.totalFees}, Slip $${devRes.totalSlippage}, Fund $${devRes.totalFunding})`);
  console.log(`  Mean Trade Return 80% CI: [${devRes.bootstrapCI.lower80}%, ${devRes.bootstrapCI.upper80}%]`);
  console.log(`  DEV RESULT: ${devRes.isPassing ? 'PASS' : 'FAIL'}\n`);

  // 2. Run Validation Split (2024-01-01 to 2025-12-31)
  console.log(`Evaluating Segment: Validation Split (2024-01-01 to 2025-12-31)...`);
  const valRes = runSegmentReplay(btcData, ethData, 'validation');
  console.log(`  L1 Net Return: ${valRes.l1ReturnPct > 0 ? '+' : ''}${valRes.l1ReturnPct}% (vs Buy&Hold: +${valRes.bhReturnPct}%)`);
  console.log(`  L1 Max Drawdown: ${valRes.l1MaxDdPct}% (vs Buy&Hold: ${valRes.bhMaxDdPct}%) [Ratio: ${valRes.ddReductionRatio}x <= 0.60x: ${valRes.passDdReduction}]`);
  console.log(`  Return / MaxDD: L1=${valRes.l1ReturnToDd} vs B&H=${valRes.bhReturnToDd} [Higher: ${valRes.passReturnToDd}]`);
  console.log(`  Total Trades: ${valRes.tradesCount} | Friction Paid: $${valRes.totalCosts} (Fees $${valRes.totalFees}, Slip $${valRes.totalSlippage}, Fund $${valRes.totalFunding})`);
  console.log(`  Mean Trade Return 80% CI: [${valRes.bootstrapCI.lower80}%, ${valRes.bootstrapCI.upper80}%]`);
  console.log(`  VALIDATION RESULT: ${valRes.isPassing ? 'PASS' : 'FAIL'}\n`);

  const passedBoth = devRes.isPassing && valRes.isPassing;
  let fwdRes = null;

  console.log(`========================================================================`);
  console.log(`Forward Holdout Status (2026-01-01 to 2026-10-19)`);
  console.log(`========================================================================`);
  if (!passedBoth) {
    console.log(`DECISION: Candidate L1 did NOT pass both Dev and Validation pass criteria.`);
    console.log(`In strict accordance with pre-registration, the Forward Holdout split remains LOCKED.`);
  } else {
    console.log(`DECISION: Candidate L1 PASSED both Dev and Validation! Opening Forward Holdout strictly once.`);
    fwdRes = runSegmentReplay(btcData, ethData, 'forward');
    console.log(`  Forward Net Return: +${fwdRes.l1ReturnPct}% (vs Buy&Hold: +${fwdRes.bhReturnPct}%)`);
    console.log(`  Forward Max Drawdown: ${fwdRes.l1MaxDdPct}% (vs Buy&Hold: ${fwdRes.bhMaxDdPct}%)`);
    console.log(`  Return / MaxDD: L1=${fwdRes.l1ReturnToDd} vs B&H=${fwdRes.bhReturnToDd}`);
    console.log(`  Forward Result: ${fwdRes.isPassing ? 'PASS' : 'FAIL'}\n`);
  }

  // Save metrics
  const outMetricsPath = path.join(OUTPUT_DIR, 'metrics-l1.json');
  fs.writeFileSync(outMetricsPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    preRegistrationCommit: '49bc92f',
    candidate: 'L1',
    description: '100-Day SMA Trend Filtered Equal-Weight BTC/ETH Long-Only Portfolio',
    dev: devRes,
    validation: valRes,
    forward: fwdRes,
    holdoutOpened: passedBoth,
    finalVerdict: passedBoth && (fwdRes?.isPassing ?? false) ? 'PASS_FOR_PAPER_DEMO' : 'FAIL',
  }, null, 2), 'utf8');

  console.log(`Saved L1 results to ${outMetricsPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
