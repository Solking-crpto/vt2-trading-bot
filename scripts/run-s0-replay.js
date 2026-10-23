import fs from 'node:fs';
import path from 'node:path';
import { StrategyEngine } from '../src/strategy/engine.js';
import { evaluatePaperTrade } from '../src/risk-engine.js';
import { synthesize5mFrom15m } from '../src/backtest/alpha-portfolio-engine.js';
import { getContractSpec } from '../src/config/contracts.js';
import { roundToStep } from '../src/utils/decimal.js';

const HEADLINE_SYMBOLS = [
  'SPYUSDT', 'QQQUSDT', 'NVDAUSDT', 'TSLAUSDT', 'AAPLUSDT',
  'MSFTUSDT', 'AMZNUSDT', 'PLTRUSDT', 'SOXLUSDT', 'SQQQUSDT',
  'MUUSDT', 'AMDUSDT', 'SNDKUSDT', 'SMCIUSDT', 'AVGOUSDT',
  'QCOMUSDT', 'WMTUSDT', 'COSTUSDT', 'RKLBUSDT',
];

const SPLITS = {
  dev: {
    name: 'Dev',
    startTs: 1778457600000, // 2026-05-11T00:00:00.000Z
    endTs: 1789138800000,   // 2026-09-11T15:00:00.000Z
  },
  val: {
    name: 'Validation',
    startTs: 1789138800000, // 2026-09-11T15:00:00.000Z
    endTs: 1791660600000,   // 2026-10-10T19:30:00.000Z
  },
};

// Load data up to 1791660600000
const historyDir = path.resolve('data/history');
const universe = {};
for (const sym of HEADLINE_SYMBOLS) {
  const f15m = path.join(historyDir, `${sym}_15m.json`);
  const f4h = path.join(historyDir, `${sym}_4h.json`);
  if (fs.existsSync(f15m) && fs.existsSync(f4h)) {
    const d15m = JSON.parse(fs.readFileSync(f15m, 'utf8'));
    const d4h = JSON.parse(fs.readFileSync(f4h, 'utf8'));
    const filtered15m = d15m.candles.filter(c => c.timestamp <= 1791660600000);
    universe[sym] = {
      symbol: sym,
      candles15m: filtered15m,
      candles4h: d4h.candles.filter(c => c.timestamp <= 1791660600000),
      candles5m: synthesize5mFrom15m(filtered15m),
      candleMap15m: new Map(filtered15m.map(c => [c.timestamp, c])),
    };
  }
}

// Build timeline of 15m bars
const allTimestampsSet = new Set();
for (const sym of HEADLINE_SYMBOLS) {
  if (universe[sym]) {
    for (const c of universe[sym].candles15m) {
      allTimestampsSet.add(c.timestamp);
    }
  }
}
const fullTimeline = Array.from(allTimestampsSet).sort((a, b) => a - b);

function runSimulation({ costMultiplier = 1.0, splitStartTs, splitEndTs }) {
  const takerFeeRate = 0.0006 * costMultiplier;
  const slippageRate = 0.0002 * costMultiplier;
  const fundingRate8h = 0.0001 * costMultiplier;

  const strategyEngine = new StrategyEngine();

  // Filter timeline to split (with warmup before splitStartTs)
  const timeline = fullTimeline.filter(ts => ts <= splitEndTs);

  let equity = 10000;
  let peakEquity = 10000;
  let maxDrawdownPct = 0;

  let currentPosition = null;
  let pendingOrder = null;
  let lastTradeClosedAt = null;
  let consecutiveLosses = 0;
  let isDailyLossLocked = false;
  let currentDayStr = '';
  let startOfDayEquity = 10000;
  let dailyLoss = 0;

  let totalFeesPaid = 0;
  let totalSlippagePaid = 0;
  let totalFundingPaid = 0;

  const closedTrades = [];

  // Fast cursor tracking
  const cursors15m = {};
  const cursors4h = {};
  for (const sym of HEADLINE_SYMBOLS) {
    cursors15m[sym] = 0;
    cursors4h[sym] = 0;
  }

  let lastProgressTs = Date.now();

  for (let tIdx = 0; tIdx < timeline.length; tIdx++) {
    const currentTs = timeline[tIdx];
    const currentDate = new Date(currentTs);
    const dayStr = currentDate.toISOString().slice(0, 10);

    if (Date.now() - lastProgressTs >= 15000) {
      console.log(`[Progress ${new Date().toISOString()}] Cost x${costMultiplier} | Bar ${tIdx}/${timeline.length} (${((tIdx/timeline.length)*100).toFixed(1)}%) | Trades: ${closedTrades.length} | Equity: $${equity.toFixed(2)}`);
      lastProgressTs = Date.now();
    }

    // Update cursors
    for (const sym of HEADLINE_SYMBOLS) {
      const c15 = universe[sym].candles15m;
      while (cursors15m[sym] < c15.length && c15[cursors15m[sym]].timestamp <= currentTs) {
        cursors15m[sym]++;
      }
      const c4 = universe[sym].candles4h;
      while (cursors4h[sym] < c4.length && (c4[cursors4h[sym]].timestamp + 4 * 3600 * 1000) <= currentTs) {
        cursors4h[sym]++;
      }
    }

    if (dayStr !== currentDayStr) {
      currentDayStr = dayStr;
      startOfDayEquity = equity;
      dailyLoss = 0;
      isDailyLossLocked = false;
      consecutiveLosses = 0; // reset daily loss pause
    }

    // 1. Funding deduction (00:00, 08:00, 16:00 UTC)
    const hours = currentDate.getUTCHours();
    const minutes = currentDate.getUTCMinutes();
    if ((hours === 0 || hours === 8 || hours === 16) && minutes === 0 && currentPosition) {
      const notional = currentPosition.quantity * currentPosition.entryPrice;
      const fundingCost = notional * fundingRate8h;
      equity -= fundingCost;
      totalFundingPaid += fundingCost;
      currentPosition.fundingPaid = (currentPosition.fundingPaid || 0) + fundingCost;
    }

    // 2. Pending order fill at NEXT bar open
    if (pendingOrder && pendingOrder.fillAtTs === currentTs) {
      const symData = universe[pendingOrder.symbol];
      const bar = symData?.candleMap15m.get(currentTs);
      if (bar && !currentPosition && !isDailyLossLocked) {
        const rawOpen = bar.open;
        const fillPrice = pendingOrder.side === 'LONG'
          ? Number((rawOpen * (1 + slippageRate)).toFixed(4))
          : Number((rawOpen * (1 - slippageRate)).toFixed(4));

        const slippageCost = Math.abs(fillPrice - rawOpen) * pendingOrder.quantity;
        const entryFee = fillPrice * pendingOrder.quantity * takerFeeRate;

        equity -= entryFee;
        totalFeesPaid += entryFee;
        totalSlippagePaid += slippageCost;

        currentPosition = {
          id: `s0-trade-${closedTrades.length + 1}`,
          symbol: pendingOrder.symbol,
          side: pendingOrder.side,
          entryPrice: fillPrice,
          initialQuantity: pendingOrder.quantity,
          quantity: pendingOrder.quantity,
          stopLoss: pendingOrder.stopLoss,
          takeProfit: pendingOrder.takeProfit,
          partialTakeProfitPrice: pendingOrder.partialTakeProfitPrice,
          isPartialClosed: false,
          entryTime: currentTs,
          entryDate: currentDate.toISOString(),
          nominalEntryPrice: pendingOrder.requestedEntryPrice,
          stopDistancePercent: pendingOrder.stopDistancePercent,
          targetDistancePercent: pendingOrder.targetDistancePercent,
          plannedNetRR: pendingOrder.plannedNetRR,
          realizedPnl: 0,
          entryFee,
          partialFee: 0,
          exitFee: 0,
          fundingPaid: 0,
          slippagePaid: slippageCost,
        };
      }
      pendingOrder = null;
    }

    // 3. Manage open position
    if (currentPosition) {
      const symData = universe[currentPosition.symbol];
      const bar = symData?.candleMap15m.get(currentTs);

      if (bar) {
        const { side, entryPrice, stopLoss, takeProfit, quantity, partialTakeProfitPrice, isPartialClosed } = currentPosition;
        let isClosed = false;
        let exitPrice = 0;
        let exitReason = '';

        const hitLongStop = bar.low <= stopLoss;
        const hitLongTp = bar.high >= takeProfit;
        const hitShortStop = bar.high >= stopLoss;
        const hitShortTp = bar.low <= takeProfit;

        const isAmbiguous = (side === 'LONG' && hitLongStop && hitLongTp) ||
                            (side === 'SHORT' && hitShortStop && hitShortTp);

        if (side === 'LONG') {
          if (isAmbiguous || hitLongStop) {
            isClosed = true;
            exitPrice = Number((stopLoss * (1 - slippageRate)).toFixed(4));
            exitReason = isAmbiguous ? 'STOP_LOSS_AMBIGUOUS_WORST_CASE' : 'STOP_LOSS';
          } else if (hitLongTp) {
            isClosed = true;
            exitPrice = Number((takeProfit * (1 - slippageRate)).toFixed(4));
            exitReason = 'TAKE_PROFIT_FINAL';
          } else if (!isPartialClosed && bar.high >= partialTakeProfitPrice) {
            const partialQty = Number((quantity * 0.5).toFixed(4));
            const partialExitPrice = Number((partialTakeProfitPrice * (1 - slippageRate)).toFixed(4));
            const partialSlippage = Math.abs(partialExitPrice - partialTakeProfitPrice) * partialQty;
            const partialFee = partialQty * partialExitPrice * takerFeeRate;
            const partialPnl = (partialExitPrice - entryPrice) * partialQty - partialFee;

            equity += partialPnl;
            totalFeesPaid += partialFee;
            totalSlippagePaid += partialSlippage;
            currentPosition.realizedPnl += partialPnl;
            currentPosition.partialFee = partialFee;
            currentPosition.slippagePaid += partialSlippage;
            currentPosition.quantity -= partialQty;
            currentPosition.isPartialClosed = true;
            currentPosition.stopLoss = Number((entryPrice * 1.0005).toFixed(4)); // breakeven + offset
          }
        } else if (side === 'SHORT') {
          if (isAmbiguous || hitShortStop) {
            isClosed = true;
            exitPrice = Number((stopLoss * (1 + slippageRate)).toFixed(4));
            exitReason = isAmbiguous ? 'STOP_LOSS_AMBIGUOUS_WORST_CASE' : 'STOP_LOSS';
          } else if (hitShortTp) {
            isClosed = true;
            exitPrice = Number((takeProfit * (1 + slippageRate)).toFixed(4));
            exitReason = 'TAKE_PROFIT_FINAL';
          } else if (!isPartialClosed && bar.low <= partialTakeProfitPrice) {
            const partialQty = Number((quantity * 0.5).toFixed(4));
            const partialExitPrice = Number((partialTakeProfitPrice * (1 + slippageRate)).toFixed(4));
            const partialSlippage = Math.abs(partialExitPrice - partialTakeProfitPrice) * partialQty;
            const partialFee = partialQty * partialExitPrice * takerFeeRate;
            const partialPnl = (entryPrice - partialExitPrice) * partialQty - partialFee;

            equity += partialPnl;
            totalFeesPaid += partialFee;
            totalSlippagePaid += partialSlippage;
            currentPosition.realizedPnl += partialPnl;
            currentPosition.partialFee = partialFee;
            currentPosition.slippagePaid += partialSlippage;
            currentPosition.quantity -= partialQty;
            currentPosition.isPartialClosed = true;
            currentPosition.stopLoss = Number((entryPrice * 0.9995).toFixed(4)); // breakeven - offset
          }
        }

        if (isClosed) {
          const rawExitPrice = isAmbiguous || exitReason.startsWith('STOP_LOSS') ? currentPosition.stopLoss : currentPosition.takeProfit;
          const exitSlippage = Math.abs(exitPrice - rawExitPrice) * currentPosition.quantity;
          const exitFee = exitPrice * currentPosition.quantity * takerFeeRate;

          totalFeesPaid += exitFee;
          totalSlippagePaid += exitSlippage;
          currentPosition.exitFee = exitFee;
          currentPosition.slippagePaid += exitSlippage;

          const grossExitPnl = currentPosition.side === 'LONG'
            ? (exitPrice - currentPosition.entryPrice) * currentPosition.quantity
            : (currentPosition.entryPrice - exitPrice) * currentPosition.quantity;
          const finalExitPnl = grossExitPnl - exitFee;
          const netTradePnl = currentPosition.realizedPnl + finalExitPnl - (currentPosition.fundingPaid || 0);

          equity += grossExitPnl - exitFee;
          lastTradeClosedAt = currentTs;

          if (netTradePnl < 0) {
            consecutiveLosses++;
            dailyLoss += Math.abs(netTradePnl);
            if (dailyLoss >= startOfDayEquity * 0.02) {
              isDailyLossLocked = true;
            }
          } else {
            consecutiveLosses = 0;
          }

          closedTrades.push({
            tradeId: currentPosition.id,
            symbol: currentPosition.symbol,
            side: currentPosition.side,
            entryTime: currentPosition.entryTime,
            entryDate: currentPosition.entryDate,
            exitTime: currentTs,
            exitDate: currentDate.toISOString(),
            entryPrice: currentPosition.entryPrice,
            exitPrice,
            quantity: currentPosition.initialQuantity,
            netPnl: Number(netTradePnl.toFixed(2)),
            roiPct: Number(((netTradePnl / (currentPosition.entryPrice * currentPosition.initialQuantity)) * 100).toFixed(2)),
            exitReason,
            equityAfter: Number(equity.toFixed(2)),
            inSplit: currentPosition.entryTime >= splitStartTs && currentPosition.entryTime <= splitEndTs,
          });

          currentPosition = null;
        }
      }
    }

    // 4. Signal Scan & Generation (Strict Zero Look-Ahead)
    const inCooldown = lastTradeClosedAt && (currentTs - lastTradeClosedAt < 30 * 60 * 1000);
    const consecutiveLossBlocked = consecutiveLosses >= 3;

    if (!currentPosition && !pendingOrder && !inCooldown && !isDailyLossLocked && !consecutiveLossBlocked) {
      // Build markets dictionary for strategyEngine.scanUniverse
      const markets = {};
      let canScan = true;

      // SPYUSDT 4h context
      const spyC4h = universe['SPYUSDT'].candles4h.slice(0, cursors4h['SPYUSDT']);
      if (spyC4h.length < 30) canScan = false;
      markets['SPYUSDT'] = { '4h': spyC4h.slice(-100) };

      if (canScan) {
        for (const sym of HEADLINE_SYMBOLS) {
          const c15Slice = universe[sym].candles15m.slice(0, cursors15m[sym]);
          const c4Slice = universe[sym].candles4h.slice(0, cursors4h[sym]);
          if (c15Slice.length < 30 || c4Slice.length < 50) continue;

          // Rolling windows: last 300 15m, last 100 4h, last 300 5m
          const win15m = c15Slice.slice(-300);
          const win4h = c4Slice.slice(-100);
          const c5End = cursors15m[sym] * 3;
          const win5m = universe[sym].candles5m.slice(Math.max(0, c5End - 300), c5End);

          markets[sym] = {
            '4h': win4h,
            '15m': win15m,
            '5m': win5m,
          };
        }

        const scanResult = strategyEngine.scanUniverse(markets, currentTs);

        if (scanResult.qualified && scanResult.qualified.length > 0) {
          // Iterate qualified candidates in rank order
          for (const cand of scanResult.qualified) {
            // Validate via RiskEngine
            const riskEvaluation = evaluatePaperTrade({
              symbol: cand.symbol,
              side: cand.side,
              entryPrice: cand.entryPrice,
              stopLoss: cand.stopLoss,
              takeProfit: cand.takeProfit,
              equity,
              startOfDayEquity,
              currentEquity: equity,
              timestamp: currentTs,
              currentTime: currentTs,
              consecutiveLosses,
              openPositionsCount: 0,
              lastTradeClosedAt,
              enforceResearchConstraints: false,
              takerFeeRate,
              slippageRate,
            });

            if (riskEvaluation.allowed && riskEvaluation.quantity > 0) {
              const stopDist = Math.abs(cand.entryPrice - cand.stopLoss);
              const targetDist = Math.abs(cand.entryPrice - cand.takeProfit);

              pendingOrder = {
                symbol: cand.symbol,
                side: cand.side,
                requestedEntryPrice: cand.entryPrice,
                stopLoss: cand.stopLoss,
                takeProfit: cand.takeProfit,
                partialTakeProfitPrice: cand.partialTakeProfitPrice,
                quantity: riskEvaluation.quantity,
                stopDistancePercent: (stopDist / cand.entryPrice) * 100,
                targetDistancePercent: (targetDist / cand.entryPrice) * 100,
                plannedNetRR: cand.rewardRisk?.netRR || 0,
                fillAtTs: currentTs + 15 * 60 * 1000,
              };
              break; // Take highest ranked candidate
            }
          }
        }
      }
    }

    if (currentTs >= splitStartTs) {
      if (equity > peakEquity) peakEquity = equity;
      const dd = ((peakEquity - equity) / peakEquity) * 100;
      if (dd > maxDrawdownPct) maxDrawdownPct = dd;
    }
  }

  // Filter trades to split
  const splitTrades = closedTrades.filter(t => t.inSplit);

  let winCount = 0, lossCount = 0;
  let totalWinPnl = 0, totalLossPnl = 0;
  let netPnl = 0;

  for (const t of splitTrades) {
    netPnl += t.netPnl;
    if (t.netPnl > 0) {
      winCount++;
      totalWinPnl += t.netPnl;
    } else {
      lossCount++;
      totalLossPnl += Math.abs(t.netPnl);
    }
  }

  const profitFactor = totalLossPnl > 0 ? (totalWinPnl / totalLossPnl) : (totalWinPnl > 0 ? 999 : 0);
  const winRate = splitTrades.length > 0 ? (winCount / splitTrades.length) * 100 : 0;
  const avgWin = winCount > 0 ? (totalWinPnl / winCount) : 0;
  const avgLoss = lossCount > 0 ? (totalLossPnl / lossCount) : 0;
  const realizedNetRR = avgLoss > 0 ? (avgWin / avgLoss) : 0;
  const expectancy = splitTrades.length > 0 ? (netPnl / splitTrades.length) : 0;

  return {
    costMultiplier,
    tradeCount: splitTrades.length,
    winCount,
    lossCount,
    winRate: Number(winRate.toFixed(2)),
    netPnl: Number(netPnl.toFixed(2)),
    profitFactor: Number(profitFactor.toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    avgWin: Number(avgWin.toFixed(2)),
    avgLoss: Number(avgLoss.toFixed(2)),
    realizedNetRR: Number(realizedNetRR.toFixed(4)),
    expectancy: Number(expectancy.toFixed(2)),
    totalFeesPaid: Number(totalFeesPaid.toFixed(2)),
    totalSlippagePaid: Number(totalSlippagePaid.toFixed(2)),
    totalFundingPaid: Number(totalFundingPaid.toFixed(2)),
    trades: splitTrades,
  };
}

async function main() {
  console.log('Running Candidate S0 Replay on Dev and Validation...');

  const startTime = Date.now();

  // Run Dev
  console.log('Running Dev split (x1 baseline costs)...');
  const devX1 = runSimulation({
    costMultiplier: 1.0,
    splitStartTs: SPLITS.dev.startTs,
    splitEndTs: SPLITS.dev.endTs,
  });

  console.log('Running Dev split (x0 gross costs)...');
  const devX0 = runSimulation({
    costMultiplier: 0.0,
    splitStartTs: SPLITS.dev.startTs,
    splitEndTs: SPLITS.dev.endTs,
  });

  console.log('Running Dev split (x2 stress costs)...');
  const devX2 = runSimulation({
    costMultiplier: 2.0,
    splitStartTs: SPLITS.dev.startTs,
    splitEndTs: SPLITS.dev.endTs,
  });

  // Run Validation
  console.log('Running Validation split (x1 baseline costs)...');
  const valX1 = runSimulation({
    costMultiplier: 1.0,
    splitStartTs: SPLITS.val.startTs,
    splitEndTs: SPLITS.val.endTs,
  });

  console.log('Running Validation split (x0 gross costs)...');
  const valX0 = runSimulation({
    costMultiplier: 0.0,
    splitStartTs: SPLITS.val.startTs,
    splitEndTs: SPLITS.val.endTs,
  });

  console.log('Running Validation split (x2 stress costs)...');
  const valX2 = runSimulation({
    costMultiplier: 2.0,
    splitStartTs: SPLITS.val.startTs,
    splitEndTs: SPLITS.val.endTs,
  });

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`Simulation finished in ${durationSec}s`);

  // Print results
  let out = '';
  out += '================================================================================\n';
  out += 'VT2 CANDIDATE S0: AS-SHIPPED LIVE STRATEGY REPLAY RESULTS\n';
  out += 'Generated: ' + new Date().toISOString() + '\n';
  out += 'Pre-registration Commit: 877fa3e81610d9d39883fe2b6f23791b0d2233cb\n';
  out += '================================================================================\n\n';

  out += 'SPLIT 1: DEV (2026-05-11 00:00 UTC to 2026-09-11 15:00 UTC)\n';
  out += '--------------------------------------------------------------------------------\n';
  out += `Trades: ${devX1.tradeCount} (Wins: ${devX1.winCount}, Losses: ${devX1.lossCount})\n`;
  out += `Win Rate: ${devX1.winRate}%\n`;
  out += `Net P&L ($): ${devX1.netPnl.toFixed(2)}\n`;
  out += `Profit Factor: ${devX1.profitFactor}\n`;
  out += `Max Drawdown (%): ${devX1.maxDrawdownPct}%\n`;
  out += `Average Win ($): $${devX1.avgWin}\n`;
  out += `Average Loss ($): -$${devX1.avgLoss}\n`;
  out += `Realized Net R:R: ${devX1.realizedNetRR}:1\n`;
  out += `Expectancy per Trade ($): $${devX1.expectancy}\n`;
  out += `Cost Sensitivity (Dev):\n`;
  out += `  0x Costs (Gross): Net P&L $${devX0.netPnl.toFixed(2)}, PF ${devX0.profitFactor}\n`;
  out += `  1x Costs (Baseline): Net P&L $${devX1.netPnl.toFixed(2)}, PF ${devX1.profitFactor}\n`;
  out += `  2x Costs (Stress): Net P&L $${devX2.netPnl.toFixed(2)}, PF ${devX2.profitFactor}\n\n`;

  out += 'SPLIT 2: VALIDATION (2026-09-11 15:00 UTC to 2026-10-10 19:30 UTC)\n';
  out += '--------------------------------------------------------------------------------\n';
  out += `Trades: ${valX1.tradeCount} (Wins: ${valX1.winCount}, Losses: ${valX1.lossCount})\n`;
  out += `Win Rate: ${valX1.winRate}%\n`;
  out += `Net P&L ($): ${valX1.netPnl.toFixed(2)}\n`;
  out += `Profit Factor: ${valX1.profitFactor}\n`;
  out += `Max Drawdown (%): ${valX1.maxDrawdownPct}%\n`;
  out += `Average Win ($): $${valX1.avgWin}\n`;
  out += `Average Loss ($): -$${valX1.avgLoss}\n`;
  out += `Realized Net R:R: ${valX1.realizedNetRR}:1\n`;
  out += `Expectancy per Trade ($): $${valX1.expectancy}\n`;
  out += `Cost Sensitivity (Val):\n`;
  out += `  0x Costs (Gross): Net P&L $${valX0.netPnl.toFixed(2)}, PF ${valX0.profitFactor}\n`;
  out += `  1x Costs (Baseline): Net P&L $${valX1.netPnl.toFixed(2)}, PF ${valX1.profitFactor}\n`;
  out += `  2x Costs (Stress): Net P&L $${valX2.netPnl.toFixed(2)}, PF ${valX2.profitFactor}\n\n`;

  out += 'FORWARD HOLDOUT:\n';
  out += '--------------------------------------------------------------------------------\n';
  out += 'STATUS: STRICTLY CLOSED / UNOPENED (S0 did not pass Dev/Val criteria).\n\n';

  out += 'PASS / FAIL EVALUATION:\n';
  out += '--------------------------------------------------------------------------------\n';
  const passNetPnl = devX1.netPnl > 0 && valX1.netPnl > 0;
  const passPF = devX1.profitFactor >= 1.25 && valX1.profitFactor >= 1.25;
  const passTrades = devX1.tradeCount >= 30 && valX1.tradeCount >= 30;
  const passDD = devX1.maxDrawdownPct <= 15.0 && valX1.maxDrawdownPct <= 15.0;
  const passX2 = devX2.netPnl > 0 && valX2.netPnl > 0;
  const overallPass = passNetPnl && passPF && passTrades && passDD && passX2;

  out += `1. Net Return > 0: ${passNetPnl ? 'PASS' : 'FAIL'} (Dev: $${devX1.netPnl}, Val: $${valX1.netPnl})\n`;
  out += `2. Profit Factor >= 1.25: ${passPF ? 'PASS' : 'FAIL'} (Dev: ${devX1.profitFactor}, Val: ${valX1.profitFactor})\n`;
  out += `3. Trades >= 30: ${passTrades ? 'PASS' : 'FAIL'} (Dev: ${devX1.tradeCount}, Val: ${valX1.tradeCount})\n`;
  out += `4. Max Drawdown <= 15%: ${passDD ? 'PASS' : 'FAIL'} (Dev: ${devX1.maxDrawdownPct}%, Val: ${valX1.maxDrawdownPct}%)\n`;
  out += `5. Positive at 2x Costs: ${passX2 ? 'PASS' : 'FAIL'} (Dev: $${devX2.netPnl}, Val: $${valX2.netPnl})\n`;
  out += `OVERALL VERDICT: ${overallPass ? 'PASS' : 'FAIL'}\n\n`;

  out += 'CONCLUSION STATEMENT:\n';
  out += '--------------------------------------------------------------------------------\n';
  if (!overallPass) {
    out += 'The app as shipped has no demonstrated edge on this data.\n';
  } else {
    out += 'The app as shipped demonstrated an edge on this data.\n';
  }
  out += '================================================================================\n';

  fs.writeFileSync('reports/audit/s0_replay_results.txt', out, 'utf8');
  console.log('Saved reports/audit/s0_replay_results.txt');

  const metricsData = {
    candidate: 'S0',
    trial: 35,
    timestamp: new Date().toISOString(),
    preRegistrationCommit: '877fa3e81610d9d39883fe2b6f23791b0d2233cb',
    dev: {
      x1: devX1,
      x0: devX0,
      x2: devX2,
    },
    validation: {
      x1: valX1,
      x0: valX0,
      x2: valX2,
    },
    forward: 'UNOPENED',
    verdict: overallPass ? 'PASS' : 'FAIL',
  };
  fs.writeFileSync('reports/strategy-v2/metrics-s0.json', JSON.stringify(metricsData, null, 2), 'utf8');
  console.log('Saved reports/strategy-v2/metrics-s0.json');

  console.log('\n--- S0 Replay Summary ---');
  console.log(out);
}

main().catch(err => {
  console.error('Error in S0 replay:', err);
  process.exit(1);
});
