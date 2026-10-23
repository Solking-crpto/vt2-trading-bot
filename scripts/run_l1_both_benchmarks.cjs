const fs = require('fs');
const path = require('path');

const btcRaw = JSON.parse(fs.readFileSync('data/history/BTCUSDT_1d_full.json', 'utf8')).candles;
const ethRaw = JSON.parse(fs.readFileSync('data/history/ETHUSDT_1d_full.json', 'utf8')).candles;

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

calculateSMA(btcRaw, 100);
calculateSMA(ethRaw, 100);
const btcDaily = btcRaw;
const ethDaily = ethRaw;

const TAKER_FEE_RATE = 0.0006;  // 0.06%
const SLIPPAGE_RATE = 0.0002;   // 0.02%
const DAILY_FUNDING_RATE = 0.000159; // 3 x 0.0053% = 0.0159% per day

const SPLIT_DATES = {
  dev: {
    start: '2019-11-17',
    end: '2023-12-31',
    label: 'Dev Split (2019-11-17 to 2023-12-31)'
  },
  validation: {
    start: '2024-01-01',
    end: '2025-12-31',
    label: 'Validation Split (2024-01-01 to 2025-12-31)'
  }
};

function runBenchmarkEvaluation(splitKey) {
  const split = SPLIT_DATES[splitKey];
  const btcMap = new Map(btcDaily.map(c => [c.date, c]));
  const ethMap = new Map(ethDaily.map(c => [c.date, c]));

  const dates = btcDaily
    .map(c => c.date)
    .filter(d => d >= split.start && d <= split.end && ethMap.has(d))
    .sort();

  // 1. Candidate L1 Simulation
  let l1Equity = 10000;
  let l1Peak = l1Equity;
  let l1MaxDdPct = 0;
  let btcPos = 0;
  let ethPos = 0;
  let l1Fees = 0, l1Slip = 0, l1Fund = 0;
  let l1TradeCount = 0;

  // 2. Benchmark A: Raw Buy-and-Hold (Zero Friction)
  const initialBtcPrice = btcMap.get(dates[0]).open;
  const initialEthPrice = ethMap.get(dates[0]).open;
  let rawBhBtcUnits = (5000) / initialBtcPrice;
  let rawBhEthUnits = (5000) / initialEthPrice;
  let rawBhPeak = 10000;
  let rawBhMaxDdPct = 0;

  // 3. Benchmark B: Cost-Adjusted Buy-and-Hold (Pays Entry Fee + Slippage + Continuous Funding + Exit Fee)
  const initialFriction = 10000 * (TAKER_FEE_RATE + SLIPPAGE_RATE); // $8 entry friction
  let costBhEquity = 10000 - initialFriction;
  let costBhBtcUnits = (costBhEquity * 0.5) / initialBtcPrice;
  let costBhEthUnits = (costBhEquity * 0.5) / initialEthPrice;
  let costBhPeak = costBhEquity;
  let costBhMaxDdPct = 0;
  let costBhFundingPaid = 0;

  for (let i = 0; i < dates.length - 1; i++) {
    const curDate = dates[i];
    const nextDate = dates[i + 1];

    const btcCur = btcMap.get(curDate);
    const ethCur = ethMap.get(curDate);
    const btcNext = btcMap.get(nextDate);
    const ethNext = ethMap.get(nextDate);

    // L1 Signal & Rebalance
    const btcLong = btcCur.close > btcCur.sma100;
    const ethLong = ethCur.close > ethCur.sma100;

    let targetBtcWeight = (btcLong && ethLong) ? 0.5 : (btcLong ? 0.5 : 0.0);
    let targetEthWeight = (btcLong && ethLong) ? 0.5 : (ethLong ? 0.5 : 0.0);

    const execBtcPrice = btcNext.open;
    const execEthPrice = ethNext.open;

    const curBtcVal = btcPos * execBtcPrice;
    const curEthVal = ethPos * execEthPrice;

    const targetBtcVal = l1Equity * targetBtcWeight;
    const targetEthVal = l1Equity * targetEthWeight;

    const deltaBtc = targetBtcVal - curBtcVal;
    const deltaEth = targetEthVal - curEthVal;

    const feeBtc = Math.abs(deltaBtc) * TAKER_FEE_RATE;
    const feeEth = Math.abs(deltaEth) * TAKER_FEE_RATE;
    const slipBtc = Math.abs(deltaBtc) * SLIPPAGE_RATE;
    const slipEth = Math.abs(deltaEth) * SLIPPAGE_RATE;

    l1Equity -= (feeBtc + feeEth + slipBtc + slipEth);
    l1Fees += (feeBtc + feeEth);
    l1Slip += (slipBtc + slipEth);

    const newBtcPos = targetBtcVal / execBtcPrice;
    const newEthPos = targetEthVal / execEthPrice;

    if (Math.abs(newBtcPos - btcPos) > 0.0001) l1TradeCount++;
    if (Math.abs(newEthPos - ethPos) > 0.0001) l1TradeCount++;

    btcPos = newBtcPos;
    ethPos = newEthPos;

    // Daily Holding & Funding
    const btcHoldVal = btcPos * btcNext.close;
    const ethHoldVal = ethPos * ethNext.close;
    const cashVal = l1Equity - (btcPos * execBtcPrice) - (ethPos * execEthPrice);

    const l1FundCost = (btcHoldVal + ethHoldVal) * DAILY_FUNDING_RATE;
    l1Equity = cashVal + btcHoldVal + ethHoldVal - l1FundCost;
    l1Fund += l1FundCost;

    if (l1Equity > l1Peak) l1Peak = l1Equity;
    const l1Dd = ((l1Peak - l1Equity) / l1Peak) * 100;
    if (l1Dd > l1MaxDdPct) l1MaxDdPct = l1Dd;

    // Benchmark A (Raw B&H)
    const rawBhEq = (rawBhBtcUnits * btcNext.close) + (rawBhEthUnits * ethNext.close);
    if (rawBhEq > rawBhPeak) rawBhPeak = rawBhEq;
    const rawBhDd = ((rawBhPeak - rawBhEq) / rawBhPeak) * 100;
    if (rawBhDd > rawBhMaxDdPct) rawBhMaxDdPct = rawBhDd;

    // Benchmark B (Cost-Adjusted B&H)
    const costBhPosVal = (costBhBtcUnits * btcNext.close) + (costBhEthUnits * ethNext.close);
    const dayFunding = costBhPosVal * DAILY_FUNDING_RATE;
    costBhFundingPaid += dayFunding;
    costBhEquity = costBhPosVal - costBhFundingPaid;
    if (costBhEquity > costBhPeak) costBhPeak = costBhEquity;
    const costBhDd = ((costBhPeak - costBhEquity) / costBhPeak) * 100;
    if (costBhDd > costBhMaxDdPct) costBhMaxDdPct = costBhDd;
  }

  // Final exit friction for cost-adjusted B&H
  const finalExitFriction = costBhEquity * (TAKER_FEE_RATE + SLIPPAGE_RATE);
  costBhEquity -= finalExitFriction;

  const lastDate = dates[dates.length - 1];
  const finalRawBhEquity = (rawBhBtcUnits * btcMap.get(lastDate).close) + (rawBhEthUnits * ethMap.get(lastDate).close);

  const l1ReturnPct = ((l1Equity - 10000) / 10000) * 100;
  const rawBhReturnPct = ((finalRawBhEquity - 10000) / 10000) * 100;
  const costBhReturnPct = ((costBhEquity - 10000) / 10000) * 100;

  const l1RetToDd = l1ReturnPct / l1MaxDdPct;
  const rawBhRetToDd = rawBhReturnPct / rawBhMaxDdPct;
  const costBhRetToDd = costBhReturnPct / costBhMaxDdPct;

  const ddRatioRaw = l1MaxDdPct / rawBhMaxDdPct;
  const ddRatioCost = l1MaxDdPct / costBhMaxDdPct;

  return {
    splitKey,
    label: split.label,
    days: dates.length,
    trades: l1TradeCount,
    l1: {
      equity: l1Equity,
      returnPct: l1ReturnPct,
      maxDdPct: l1MaxDdPct,
      retToDd: l1RetToDd,
      fees: l1Fees,
      slippage: l1Slip,
      funding: l1Fund,
      totalCosts: l1Fees + l1Slip + l1Fund
    },
    rawBh: {
      equity: finalRawBhEquity,
      returnPct: rawBhReturnPct,
      maxDdPct: rawBhMaxDdPct,
      retToDd: rawBhRetToDd,
      ddRatioVsL1: ddRatioRaw,
      passDdReduction: ddRatioRaw <= 0.60,
      passRetToDd: l1RetToDd > rawBhRetToDd
    },
    costBh: {
      equity: costBhEquity,
      returnPct: costBhReturnPct,
      maxDdPct: costBhMaxDdPct,
      retToDd: costBhRetToDd,
      fundingPaid: costBhFundingPaid,
      ddRatioVsL1: ddRatioCost,
      passDdReduction: ddRatioCost <= 0.60,
      passRetToDd: l1RetToDd > costBhRetToDd
    }
  };
}

console.log('================================================================================');
console.log('CANDIDATE L1: EVALUATION AGAINST RAW VS COST-ADJUSTED BUY-AND-HOLD');
console.log('================================================================================\n');

for (const s of ['dev', 'validation']) {
  const res = runBenchmarkEvaluation(s);
  console.log(`### ${res.label} (${res.days} days, ${res.trades} position adjustments)`);
  console.log(`- Candidate L1 Net Return: +${res.l1.returnPct.toFixed(2)}% | Max DD: ${res.l1.maxDdPct.toFixed(2)}% | Ret/DD: ${res.l1.retToDd.toFixed(2)}`);
  console.log(`  (L1 Friction Paid: Fees $${res.l1.fees.toFixed(2)}, Slippage $${res.l1.slippage.toFixed(2)}, Funding $${res.l1.funding.toFixed(2)} | Total: $${res.l1.totalCosts.toFixed(2)})\n`);

  console.log(`1. Against Benchmark A: Raw Buy-and-Hold (0% friction)`);
  console.log(`   - Raw B&H Return: +${res.rawBh.returnPct.toFixed(2)}% | Max DD: ${res.rawBh.maxDdPct.toFixed(2)}% | Ret/DD: ${res.rawBh.retToDd.toFixed(2)}`);
  console.log(`   - Drawdown Ratio (L1 / B&H): ${res.rawBh.ddRatioVsL1.toFixed(2)}x (Pass <= 0.60x: ${res.rawBh.passDdReduction})`);
  console.log(`   - Return/Drawdown Higher: ${res.rawBh.passRetToDd}`);
  console.log(`   - Verdict vs Raw B&H: ${res.rawBh.passDdReduction && res.rawBh.passRetToDd ? 'PASS' : 'FAIL'}\n`);

  console.log(`2. Against Benchmark B: Cost-Adjusted Buy-and-Hold (Entry Fee + Carry Funding + Exit Fee)`);
  console.log(`   - Cost-Adjusted B&H Return: +${res.costBh.returnPct.toFixed(2)}% | Max DD: ${res.costBh.maxDdPct.toFixed(2)}% | Ret/DD: ${res.costBh.retToDd.toFixed(2)}`);
  console.log(`   - Cumulative Carry Funding Paid by B&H: $${res.costBh.fundingPaid.toFixed(2)}`);
  console.log(`   - Drawdown Ratio (L1 / Cost B&H): ${res.costBh.ddRatioVsL1.toFixed(2)}x (Pass <= 0.60x: ${res.costBh.passDdReduction})`);
  console.log(`   - Return/Drawdown Higher: ${res.costBh.passRetToDd}`);
  console.log(`   - Verdict vs Cost B&H: ${res.costBh.passDdReduction && res.costBh.passRetToDd ? 'PASS' : 'FAIL'}\n`);
}
