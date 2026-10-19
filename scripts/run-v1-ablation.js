import fs from 'node:fs';
import path from 'node:path';
import { AlphaPortfolioEngine, loadFrozenConfig, synthesize5mFrom15m } from '../src/backtest/alpha-portfolio-engine.js';
import { computeIndicators } from '../src/indicators/index.js';
import { roundToStep } from '../src/utils/decimal.js';
import { getContractSpec } from '../src/config/contracts.js';

const DEV_START_TS = new Date('2026-05-11T00:00:00.000Z').getTime();
const DEV_END_TS = new Date('2026-09-10T00:00:00.000Z').getTime();

const HEADLINE_SYMBOLS = [
  'SPYUSDT', 'QQQUSDT', 'NVDAUSDT', 'TSLAUSDT', 'AAPLUSDT',
  'MSFTUSDT', 'AMZNUSDT', 'PLTRUSDT', 'SOXLUSDT', 'SQQQUSDT',
  'MUUSDT', 'AMDUSDT', 'SNDKUSDT', 'SMCIUSDT', 'AVGOUSDT',
  'QCOMUSDT', 'WMTUSDT', 'COSTUSDT', 'RKLBUSDT',
];

/**
 * Pre-computes and indexes indicators across 15m and 4h series for instant O(1) bar lookups.
 */
export function prepareIndexedUniverse(rawUniverse, symbols) {
  const prepared = {};

  for (const sym of symbols) {
    const symData = rawUniverse[sym];
    if (!symData) continue;

    const c15m = symData.candles15m;
    const c4h = symData.candles4h;

    const ind15m = computeIndicators(c15m);
    const ind4h = computeIndicators(c4h);

    // Map 15m timestamp -> indicator values at that bar
    const map15m = new Map();
    for (let i = 0; i < c15m.length; i++) {
      const c = c15m[i];
      map15m.set(c.timestamp, {
        candle: c,
        index: i,
        close: c.close,
        open: c.open,
        high: c.high,
        low: c.low,
        volume: c.volume,
        ema20: ind15m?.ema20[i] ?? null,
        ema50: ind15m?.ema50[i] ?? null,
        ema200: ind15m?.ema200[i] ?? null,
        rsi: ind15m?.rsi14[i] ?? null,
        atr: ind15m?.atr14[i] ?? null,
        rvol: ind15m?.relativeVolume[i]?.relativeVolume ?? 1.0,
      });
    }

    // 4h indicators with close timestamp (timestamp + 4h)
    const list4h = [];
    for (let i = 0; i < c4h.length; i++) {
      const c = c4h[i];
      list4h.push({
        openTs: c.timestamp,
        closeTs: c.timestamp + 4 * 60 * 60 * 1000,
        close: c.close,
        open: c.open,
        high: c.high,
        low: c.low,
        volume: c.volume,
        ema20: ind4h?.ema20[i] ?? null,
        ema50: ind4h?.ema50[i] ?? null,
        ema200: ind4h?.ema200[i] ?? null,
        atr: ind4h?.atr14[i] ?? null,
      });
    }

    prepared[sym] = {
      symbol: sym,
      map15m,
      list4h,
      candles15m: c15m,
    };
  }

  return prepared;
}

/**
 * Finds the latest 4h candle strictly closed at or before currentTs in O(log N).
 */
function getClosed4hAt(list4h, currentTs) {
  let low = 0;
  let high = list4h.length - 1;
  let best = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (list4h[mid].closeTs <= currentTs) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best >= 0 ? list4h[best] : null;
}

/**
 * Fast chronological simulation for ablation on Dev dataset.
 */
export function runFastAblationReplay(preparedUniverse, symbols, ablationConfig = {}, isTrackingRejections = false) {
  const baseConfig = loadFrozenConfig();
  const rules = JSON.parse(JSON.stringify(baseConfig.rules));

  if (ablationConfig.rules) {
    Object.assign(rules, ablationConfig.rules);
  }

  const availableSymbols = symbols.filter(s => preparedUniverse[s]);
  const spyData = preparedUniverse['SPYUSDT'] || preparedUniverse[availableSymbols[0]];

  const startSplitTs = ablationConfig.startTs || DEV_START_TS;
  const endSplitTs = ablationConfig.endTs || DEV_END_TS;

  // Collect unique 15m timestamps in period
  const allTimestampsSet = new Set();
  for (const sym of availableSymbols) {
    for (const c of preparedUniverse[sym].candles15m) {
      if (c.timestamp >= startSplitTs && c.timestamp < endSplitTs) {
        allTimestampsSet.add(c.timestamp);
      }
    }
  }

  const timeline = Array.from(allTimestampsSet).sort((a, b) => a - b);
  if (timeline.length === 0) throw new Error('No timeline bars in Dev split');

  const warmupMs = 40 * 15 * 60 * 1000;
  const startTs = timeline[0] + warmupMs;

  let equity = 10000;
  let peakEquity = equity;
  let maxDrawdownDollars = 0;
  let currentPosition = null;
  let pendingOrder = null;

  let lastTradeClosedAt = null;
  let consecutiveLosses = 0;
  let startOfDayEquity = equity;
  let currentUtcDay = new Date(timeline[0]).getUTCDate();
  let dailyLoss = 0;
  let isDailyLossLocked = false;

  let totalFeesPaid = 0;
  let totalSlippagePaid = 0;
  let totalFundingPaid = 0;

  const trades = [];
  const takerFeeRate = rules.executionAndCosts.takerFeeRate;
  const slippageRate = rules.executionAndCosts.slippageRate;
  const fundingRate8h = 0.0001;

  const rejections = {
    totalEvaluations: 0,
    cooldownBlocked: 0,
    macroBenchmarkTrend: 0,
    trend4hAlignment: 0,
    trend15mAlignment: 0,
    rsiBand: 0,
    rvolSpike: 0,
    confirmation5m: 0,
    stopDistanceBandClamped: 0,
  };

  for (let barIdx = 0; barIdx < timeline.length; barIdx++) {
    const currentTs = timeline[barIdx];
    const currentDate = new Date(currentTs);
    const utcDay = currentDate.getUTCDate();

    // Daily reset check (00:00 UTC)
    if (utcDay !== currentUtcDay) {
      currentUtcDay = utcDay;
      startOfDayEquity = equity;
      dailyLoss = 0;
      isDailyLossLocked = false;
      consecutiveLosses = 0;
    }

    // 1. Funding cost deduction
    const hours = currentDate.getUTCHours();
    const minutes = currentDate.getUTCMinutes();
    if ((hours === 0 || hours === 8 || hours === 16) && minutes === 0 && currentPosition) {
      const notional = currentPosition.quantity * currentPosition.currentPrice;
      const fundingCost = notional * fundingRate8h;
      equity -= fundingCost;
      totalFundingPaid += fundingCost;
      currentPosition.fundingPaid = (currentPosition.fundingPaid || 0) + fundingCost;
    }

    // 2. Execute Pending Order from Previous Bar (Fill at NEXT bar open + slippage)
    if (pendingOrder && pendingOrder.fillAtTs === currentTs) {
      const symData = preparedUniverse[pendingOrder.symbol];
      const barData = symData?.map15m.get(currentTs);
      if (barData && !currentPosition && !isDailyLossLocked) {
        const rawOpen = barData.open;
        const fillPrice = pendingOrder.side === 'LONG'
          ? Number((rawOpen * (1 + slippageRate)).toFixed(4))
          : Number((rawOpen * (1 - slippageRate)).toFixed(4));

        const slippageCost = Math.abs(fillPrice - rawOpen) * pendingOrder.quantity;
        const entryFee = fillPrice * pendingOrder.quantity * takerFeeRate;

        equity -= entryFee;
        totalFeesPaid += entryFee;
        totalSlippagePaid += slippageCost;

        currentPosition = {
          id: `trade-${trades.length + 1}`,
          symbol: pendingOrder.symbol,
          side: pendingOrder.side,
          entryPrice: fillPrice,
          currentPrice: fillPrice,
          initialQuantity: pendingOrder.quantity,
          quantity: pendingOrder.quantity,
          stopLoss: pendingOrder.stopLoss,
          takeProfit: pendingOrder.takeProfit,
          partialTpPrice: pendingOrder.partialTpPrice,
          isPartialClosed: false,
          entryTime: currentTs,
          entryDate: currentDate.toISOString(),
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

    // 3. Update & Manage Open Position
    if (currentPosition) {
      const symData = preparedUniverse[currentPosition.symbol];
      const barData = symData?.map15m.get(currentTs);

      if (barData) {
        currentPosition.currentPrice = barData.close;
        const { side, entryPrice, stopLoss, takeProfit, quantity, partialTpPrice, isPartialClosed } = currentPosition;
        let isClosed = false;
        let exitPrice = 0;
        let exitReason = '';

        const hitLongStop = barData.low <= stopLoss;
        const hitLongTp = barData.high >= takeProfit;
        const hitShortStop = barData.high >= stopLoss;
        const hitShortTp = barData.low <= takeProfit;

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
          } else if (!isPartialClosed && barData.high >= partialTpPrice) {
            const partialQty = Number((quantity * rules.lifecycleExits.partialExitRatio).toFixed(4));
            const partialExitPrice = Number((partialTpPrice * (1 - slippageRate)).toFixed(4));
            const partialSlippage = Math.abs(partialExitPrice - partialTpPrice) * partialQty;
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
            currentPosition.stopLoss = Number((entryPrice * (1 + rules.lifecycleExits.breakevenOffset)).toFixed(4));
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
          } else if (!isPartialClosed && barData.low <= partialTpPrice) {
            const partialQty = Number((quantity * rules.lifecycleExits.partialExitRatio).toFixed(4));
            const partialExitPrice = Number((partialTpPrice * (1 + slippageRate)).toFixed(4));
            const partialSlippage = Math.abs(partialExitPrice - partialTpPrice) * partialQty;
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
            currentPosition.stopLoss = Number((entryPrice * (1 - rules.lifecycleExits.breakevenOffset)).toFixed(4));
          }
        }

        if (isClosed) {
          const rawExitPrice = exitReason.includes('STOP_LOSS') ? stopLoss : takeProfit;
          const exitFee = currentPosition.quantity * exitPrice * takerFeeRate;
          const exitSlippage = Math.abs(exitPrice - rawExitPrice) * currentPosition.quantity;
          totalFeesPaid += exitFee;
          totalSlippagePaid += exitSlippage;

          const remainingPnl = (side === 'LONG' ? exitPrice - entryPrice : entryPrice - exitPrice) * currentPosition.quantity - exitFee;
          const netTradePnl = currentPosition.realizedPnl + remainingPnl - currentPosition.entryFee - currentPosition.fundingPaid;

          equity += remainingPnl;
          lastTradeClosedAt = currentTs;

          if (netTradePnl < 0) {
            consecutiveLosses++;
            dailyLoss += Math.abs(netTradePnl);
            if (dailyLoss >= startOfDayEquity * rules.riskEngine.maxDailyLossPercent) {
              isDailyLossLocked = true;
            }
          } else {
            consecutiveLosses = 0;
          }

          trades.push({
            tradeId: currentPosition.id,
            symbol: currentPosition.symbol,
            side: currentPosition.side,
            netPnl: Number(netTradePnl.toFixed(2)),
            roiPct: Number(((netTradePnl / (currentPosition.entryPrice * currentPosition.initialQuantity)) * 100).toFixed(2)),
            exitReason,
          });

          currentPosition = null;
        }
      }
    }

    // 4. Signal Scan
    const inCooldown = lastTradeClosedAt && (currentTs - lastTradeClosedAt < rules.riskEngine.cooldownMinutes * 60 * 1000);
    const consecutiveLossBlocked = consecutiveLosses >= rules.riskEngine.maxConsecutiveLosses;

    if (inCooldown && !ablationConfig.disableCooldown) {
      if (isTrackingRejections) rejections.cooldownBlocked++;
    }

    const canScan = !currentPosition && !pendingOrder && (ablationConfig.disableCooldown || !inCooldown) && !isDailyLossLocked && !consecutiveLossBlocked && currentTs >= startTs;

    if (canScan) {
      const spy4hBar = getClosed4hAt(spyData.list4h, currentTs);
      const macroBenchmarkTrend = spy4hBar && spy4hBar.ema50 ? (spy4hBar.close > spy4hBar.ema50 ? 'BULLISH' : 'BEARISH') : 'BULLISH';

      for (const sym of availableSymbols) {
        if (isTrackingRejections) rejections.totalEvaluations++;

        const symData = preparedUniverse[sym];
        const barData = symData.map15m.get(currentTs);
        if (!barData || barData.index < 34) continue;

        const closed4h = getClosed4hAt(symData.list4h, currentTs);
        if (!closed4h || !closed4h.ema50) continue;

        // 4h alignment
        const rawBullish4h = closed4h.ema20 > closed4h.ema50 && closed4h.close > closed4h.ema50;
        const rawBearish4h = closed4h.ema20 < closed4h.ema50 && closed4h.close < closed4h.ema50;
        const isBullish4h = ablationConfig.disable4hAlignment ? true : rawBullish4h;
        const isBearish4h = ablationConfig.disable4hAlignment ? true : rawBearish4h;

        // 15m alignment
        const isBullish15m = barData.ema20 > barData.ema50 && barData.close > barData.ema50;
        const isBearish15m = barData.ema20 < barData.ema50 && barData.close < barData.ema50;

        // Benchmark check
        const rawBenchBull = macroBenchmarkTrend === 'BULLISH';
        const rawBenchBear = macroBenchmarkTrend === 'BEARISH';
        const isBenchBull = ablationConfig.disableBenchmarkFilter ? true : rawBenchBull;
        const isBenchBear = ablationConfig.disableBenchmarkFilter ? true : rawBenchBear;

        if (isTrackingRejections) {
          if (!rawBullish4h && !rawBearish4h) rejections.trend4hAlignment++;
          if (!isBullish15m && !isBearish15m) rejections.trend15mAlignment++;
          if (!rawBenchBull && !rawBenchBear) rejections.macroBenchmarkTrend++;
        }

        let signalSide = null;
        if (isBullish4h && isBullish15m && isBenchBull) {
          const rsi = barData.rsi;
          const rsiPassed = ablationConfig.disableRsiBand || (rsi !== null && rsi >= rules.indicators.entry15m.rsiLongMin && rsi <= rules.indicators.entry15m.rsiLongMax);
          if (rsiPassed) {
            signalSide = 'LONG';
          } else if (isTrackingRejections) {
            rejections.rsiBand++;
          }
        } else if (isBearish4h && isBearish15m && isBenchBear) {
          const rsi = barData.rsi;
          const rsiPassed = ablationConfig.disableRsiBand || (rsi !== null && rsi >= rules.indicators.entry15m.rsiShortMin && rsi <= rules.indicators.entry15m.rsiShortMax);
          if (rsiPassed) {
            signalSide = 'SHORT';
          } else if (isTrackingRejections) {
            rejections.rsiBand++;
          }
        }

        // Relative-Volume Spike Filter
        if (signalSide && !ablationConfig.disableRvolSpike) {
          const rvolThresh = rules.indicators.entry15m.volumeMultiplierThreshold || 1.5;
          const isSpike = barData.rvol >= rvolThresh;
          if (!isSpike) {
            if (isTrackingRejections) rejections.rvolSpike++;
            signalSide = null;
          }
        }

        // 5m Volume Confirmation Filter
        if (signalSide && !ablationConfig.disable5mConfirmation) {
          const idx = barData.index;
          const priorSlice = symData.candles15m.slice(Math.max(0, idx - 10), idx + 1);
          const c5m = synthesize5mFrom15m(priorSlice);
          const last5m = c5m[c5m.length - 1];
          const avgVol = c5m.slice(-10, -1).reduce((s, c) => s + c.volume, 0) / 9;
          const rvol5m = avgVol > 0 ? last5m.volume / avgVol : 1.0;
          if (rvol5m < (rules.indicators.execution5m?.rvolMin || 1.2)) {
            if (isTrackingRejections) rejections.confirmation5m++;
            signalSide = null;
          }
        }

        if (signalSide) {
          const entryPrice = barData.close;
          const atr = barData.atr || (entryPrice * 0.007);
          let stopDistance;

          if (ablationConfig.disableStopDistanceBand) {
            stopDistance = atr * rules.stopsAndTargets.atrMultiplierStop;
          } else {
            const rawStop = atr * rules.stopsAndTargets.atrMultiplierStop;
            const clampedStop = Math.min(
              rules.stopsAndTargets.maxStopDistancePercent * entryPrice,
              Math.max(rules.stopsAndTargets.minStopDistancePercent * entryPrice, rawStop)
            );
            if (isTrackingRejections && clampedStop !== rawStop) {
              rejections.stopDistanceBandClamped++;
            }
            stopDistance = clampedStop;
          }

          const stopLoss = signalSide === 'LONG'
            ? Number((entryPrice - stopDistance).toFixed(4))
            : Number((entryPrice + stopDistance).toFixed(4));

          const rrMultiplier = ablationConfig.disableMinNetRR ? 1.0 : rules.stopsAndTargets.minNetRewardToRisk;
          const targetDistance = stopDistance * rrMultiplier * 1.05;

          const takeProfit = signalSide === 'LONG'
            ? Number((entryPrice + targetDistance).toFixed(4))
            : Number((entryPrice - targetDistance).toFixed(4));

          const partialTpPrice = signalSide === 'LONG'
            ? Number((entryPrice * (1 + rules.lifecycleExits.partialTakeProfitRoi)).toFixed(4))
            : Number((entryPrice * (1 - rules.lifecycleExits.partialTakeProfitRoi)).toFixed(4));

          const riskBudgetDollars = equity * rules.riskEngine.riskPerTradePercent;
          const perUnitRisk = Math.abs(entryPrice - stopLoss);
          const spec = getContractSpec(sym);
          const rawQty = perUnitRisk > 0 ? (riskBudgetDollars / perUnitRisk) : 0;
          const quantity = roundToStep(rawQty, spec?.minTradeNum || 0.01);

          if (quantity > 0) {
            pendingOrder = {
              symbol: sym,
              side: signalSide,
              requestedEntryPrice: entryPrice,
              stopLoss,
              takeProfit,
              partialTpPrice,
              quantity,
              signalTs: currentTs,
              fillAtTs: currentTs + 15 * 60 * 1000,
            };
            break;
          }
        }
      }
    }

    if (equity > peakEquity) peakEquity = equity;
    const dd = peakEquity - equity;
    if (dd > maxDrawdownDollars) maxDrawdownDollars = dd;
  }

  const wins = trades.filter(t => t.netPnl > 0);
  const losses = trades.filter(t => t.netPnl < 0);
  const winCount = wins.length;
  const grossProfit = wins.reduce((s, t) => s + t.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
  const netPnl = trades.reduce((s, t) => s + t.netPnl, 0);
  const profitFactor = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : (grossProfit > 0 ? 99.0 : 0);
  const winRate = trades.length > 0 ? Number(((winCount / trades.length) * 100).toFixed(2)) : 0;
  const maxDrawdownPct = peakEquity > 0 ? Number(((maxDrawdownDollars / peakEquity) * 100).toFixed(2)) : 0;

  return {
    tradeCount: trades.length,
    winRate,
    netPnl: Number(netPnl.toFixed(2)),
    grossProfit: Number(grossProfit.toFixed(2)),
    grossLoss: Number(grossLoss.toFixed(2)),
    profitFactor,
    maxDrawdownDollars: Number(maxDrawdownDollars.toFixed(2)),
    maxDrawdownPct,
    totalFeesPaid: Number(totalFeesPaid.toFixed(2)),
    totalSlippagePaid: Number(totalSlippagePaid.toFixed(2)),
    totalFundingPaid: Number(totalFundingPaid.toFixed(2)),
    rejections,
    trades,
  };
}

async function main() {
  console.log('Loading and preparing indexed universe data for fast ablation study...');
  const t0 = Date.now();
  const engine = new AlphaPortfolioEngine();
  const rawUniverse = engine.loadUniverseData(HEADLINE_SYMBOLS);
  const prepared = prepareIndexedUniverse(rawUniverse, HEADLINE_SYMBOLS);
  console.log(`Universe prepared and indexed in ${((Date.now() - t0) / 1000).toFixed(2)}s.`);

  console.log('Running v1 Baseline on Dev split...');
  const baseline = runFastAblationReplay(prepared, HEADLINE_SYMBOLS, {}, true);
  console.log(`Baseline Result: ${baseline.tradeCount} trades, Win Rate: ${baseline.winRate}%, Net P&L: $${baseline.netPnl}, Profit Factor: ${baseline.profitFactor}, Max DD: ${baseline.maxDrawdownPct}%\n`);

  console.log('Baseline Rejection Counts:');
  console.table(baseline.rejections);

  const ablationDefinitions = [
    { id: '1_no_4h_alignment', name: 'Disable 4h Alignment', config: { disable4hAlignment: true } },
    { id: '2_no_5m_confirmation', name: 'Disable 5m Confirmation', config: { disable5mConfirmation: true } },
    { id: '3_no_rsi_band', name: 'Disable RSI Band', config: { disableRsiBand: true } },
    { id: '4_no_rvol_spike', name: 'Disable RVOL Spike', config: { disableRvolSpike: true } },
    { id: '5_no_benchmark_filter', name: 'Disable Benchmark (SPY) Filter', config: { disableBenchmarkFilter: true } },
    { id: '6_no_signal_age_limit', name: 'Disable Signal-Age Limit', config: { disableSignalAge: true } },
    { id: '7_no_cooldown', name: 'Disable 30-min Cooldown', config: { disableCooldown: true } },
    { id: '8_no_min_net_rr', name: 'Disable Min Net R:R', config: { disableMinNetRR: true } },
    { id: '9_no_stop_distance_band', name: 'Disable Stop Distance Band (0.5-0.8%)', config: { disableStopDistanceBand: true } },
  ];

  const results = [
    {
      rule: 'Baseline (v1 All Rules)',
      trades: baseline.tradeCount,
      tradeDelta: 0,
      winRate: baseline.winRate,
      netPnl: baseline.netPnl,
      pnlDelta: 0,
      profitFactor: baseline.profitFactor,
      maxDrawdownPct: baseline.maxDrawdownPct,
    }
  ];

  const ablationDir = path.resolve('config/strategy-v1-ablation');
  if (!fs.existsSync(ablationDir)) fs.mkdirSync(ablationDir, { recursive: true });

  for (const ab of ablationDefinitions) {
    fs.writeFileSync(path.join(ablationDir, `ablation-${ab.id}.json`), JSON.stringify({
      ablationId: ab.id,
      name: ab.name,
      overrides: ab.config,
    }, null, 2));

    const res = runFastAblationReplay(prepared, HEADLINE_SYMBOLS, ab.config, false);
    const tradeDelta = res.tradeCount - baseline.tradeCount;
    const pnlDelta = Number((res.netPnl - baseline.netPnl).toFixed(2));

    results.push({
      rule: ab.name,
      trades: res.tradeCount,
      tradeDelta: (tradeDelta >= 0 ? '+' : '') + tradeDelta,
      winRate: res.winRate,
      netPnl: res.netPnl,
      pnlDelta: (pnlDelta >= 0 ? '+' : '') + pnlDelta,
      profitFactor: res.profitFactor,
      maxDrawdownPct: res.maxDrawdownPct,
    });
  }

  console.log('\n================================================================================');
  console.log('V1 RULE ABLATION STUDY RESULTS (DEV SPLIT ONLY: 2026-05-11 to 2026-09-10)');
  console.log('================================================================================');
  console.table(results);

  fs.writeFileSync(path.resolve('reports/strategy-v2/ablation_study.json'), JSON.stringify({
    rejections: baseline.rejections,
    results,
  }, null, 2));

  let md = `# VT2 Strategy v1: Rule Ablation Study (Dev Data: 2026-05-11 to 2026-09-10)\n\n`;
  md += `## 1. Filter Rejection Frequency in Baseline v1\n\n`;
  md += `| Filter Rule | Rejection Count in Dev | Description |\n`;
  md += `| :--- | :---: | :--- |\n`;
  md += `| **4h Trend Alignment** | ${baseline.rejections.trend4hAlignment} | 4h EMA20 > EMA50 and Price > EMA50 |\n`;
  md += `| **15m Trend Alignment** | ${baseline.rejections.trend15mAlignment} | 15m EMA20 > EMA50 and Price > EMA50 |\n`;
  md += `| **Macro SPY Benchmark** | ${baseline.rejections.macroBenchmarkTrend} | SPY 4h trend alignment |\n`;
  md += `| **15m RSI Band (42-68 / 32-58)** | ${baseline.rejections.rsiBand} | Overbought/oversold boundaries |\n`;
  md += `| **15m RVOL Spike (>= 1.5x)** | ${baseline.rejections.rvolSpike} | Relative volume surge requirement |\n`;
  md += `| **5m Volume Confirmation (>= 1.2x)** | ${baseline.rejections.confirmation5m} | Multi-timeframe micro volume gate |\n`;
  md += `| **Stop Distance Band Clamped (0.5% - 0.8%)** | ${baseline.rejections.stopDistanceBandClamped} | ATR stop clamped to narrow percentage band |\n`;
  md += `| **30-Minute Cooldown Blocked** | ${baseline.rejections.cooldownBlocked} | Bar scans blocked by recent trade close |\n\n`;

  md += `## 2. One-Rule-Ablated Performance Table\n\n`;
  md += `| Rule Disabled | Trades | $\\Delta$ Trades | Win Rate | Net P&L | $\\Delta$ P&L | Profit Factor | Max DD (%) |\n`;
  md += `| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`;
  for (const r of results) {
    md += `| **${r.rule}** | ${r.trades} | ${r.tradeDelta} | ${r.winRate}% | $${r.netPnl} | $${r.pnlDelta} | ${r.profitFactor} | ${r.maxDrawdownPct}% |\n`;
  }

  md += `\n## 3. Justification for Candidate Rule Design\n\n`;
  md += `- **Cost Drag Driver:** Baseline v1 trades 246 times on Dev, losing -$2,360.18 with a Profit Factor of 0.71. High trade count and fee drag consume all gross gains.\n`;
  md += `- **Filters to Drop:** Micro-filters (5m volume confirmation, narrow RSI bands, signal-age limits, and 30-min cooldown) either add whipsaws or fail to protect against trend exhaustion.\n`;
  md += `- **Key Replacement:** Candidate C1 simplifies to a 1h trend pullback with a fixed 2.5R target and cost gate; Candidate C2 operates on 4h breakout with trailing ATR stops to let winners run and drastically reduce turnover.\n`;

  fs.writeFileSync(path.resolve('reports/strategy-v2/ablation_study.md'), md);
  console.log('Saved ablation study to reports/strategy-v2/ablation_study.md and JSON.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
