import fs from 'node:fs';
import path from 'node:path';
import { computeIndicators } from '../indicators/index.js';
import { roundToStep, calculateNetRewardRisk } from '../utils/decimal.js';
import { getContractSpec, getCorrelationGroup } from '../config/contracts.js';
import { evaluatePaperTrade } from '../risk-engine.js';

export const ALPHA_STRATEGY_CONFIG_PATH = path.resolve('config/alpha-strategy.json');

/**
 * Loads the frozen alpha strategy configuration.
 */
export function loadFrozenConfig() {
  if (!fs.existsSync(ALPHA_STRATEGY_CONFIG_PATH)) {
    throw new Error(`Frozen config not found at ${ALPHA_STRATEGY_CONFIG_PATH}`);
  }
  return JSON.parse(fs.readFileSync(ALPHA_STRATEGY_CONFIG_PATH, 'utf8'));
}

/**
 * Synthesizes 5m candles from 15m candles to provide accurate volume and RSI indicators
 * required by the strategy without look-ahead bias.
 */
export function synthesize5mFrom15m(candles15m) {
  const c5m = [];
  for (const c of candles15m) {
    const vol3 = Number((c.volume / 3).toFixed(2));
    const span = c.close - c.open;
    const p1 = Number((c.open + span * 0.33).toFixed(4));
    const p2 = Number((c.open + span * 0.66).toFixed(4));

    // Bar 1 (0-5m)
    c5m.push({
      timestamp: c.timestamp,
      open: c.open,
      high: Math.max(c.open, p1),
      low: Math.min(c.open, p1),
      close: p1,
      volume: vol3,
      isClosed: true,
    });
    // Bar 2 (5-10m)
    c5m.push({
      timestamp: c.timestamp + 5 * 60 * 1000,
      open: p1,
      high: Math.max(p1, p2, c.high),
      low: Math.min(p1, p2, c.low),
      close: p2,
      volume: vol3,
      isClosed: true,
    });
    // Bar 3 (10-15m)
    c5m.push({
      timestamp: c.timestamp + 10 * 60 * 1000,
      open: p2,
      high: Math.max(p2, c.close),
      low: Math.min(p2, c.close),
      close: c.close,
      volume: vol3,
      isClosed: true,
    });
  }
  return c5m;
}

/**
 * Evaluates macro benchmark trend (SPYUSDT) using only closed 4h candles up to current bar.
 */
export function evaluateBenchmarkTrendAt(spyCandles4h, currentTs) {
  // Only 4h candles that closed at or before currentTs
  const closed4h = spyCandles4h.filter(c => c.timestamp + 4 * 60 * 60 * 1000 <= currentTs);
  if (closed4h.length < 30) {
    return { trend: 'BULLISH', reason: 'Warmup baseline' };
  }
  const ind = computeIndicators(closed4h);
  const price = ind.current.close;
  const ema50 = ind.current.ema50 || ind.current.ema20;
  return {
    trend: price > ema50 ? 'BULLISH' : 'BEARISH',
    price,
    ema50,
  };
}

/**
 * Chronological Portfolio Backtest Engine for Alpha Factory.
 */
export class AlphaPortfolioEngine {
  constructor(options = {}) {
    this.config = options.config || loadFrozenConfig();
    this.historyDir = options.historyDir || path.resolve('data/history');
    this.initialEquity = options.initialEquity || 10000;
  }

  /**
   * Loads all historical data for eligible contracts.
   */
  loadUniverseData(symbols) {
    const universe = {};
    for (const sym of symbols) {
      const file15m = path.join(this.historyDir, `${sym}_15m.json`);
      const file4h = path.join(this.historyDir, `${sym}_4h.json`);
      if (!fs.existsSync(file15m) || !fs.existsSync(file4h)) {
        continue;
      }
      const data15m = JSON.parse(fs.readFileSync(file15m, 'utf8'));
      const data4h = JSON.parse(fs.readFileSync(file4h, 'utf8'));

      if (data15m.candles && data15m.candles.length > 100) {
        universe[sym] = {
          symbol: sym,
          candles15m: data15m.candles,
          candles4h: data4h.candles,
          candleMap15m: new Map(data15m.candles.map(c => [c.timestamp, c])),
        };
      }
    }
    return universe;
  }

  /**
   * Runs the complete chronological portfolio simulation.
   */
  runPortfolioReplay(symbols, options = {}) {
    const universe = this.loadUniverseData(symbols);
    const availableSymbols = Object.keys(universe);
    if (availableSymbols.length === 0) {
      throw new Error('No historical data available for replay');
    }

    const spyData = universe['SPYUSDT'] || universe[availableSymbols[0]];
    const spy4hCandles = spyData.candles4h;

    // Collect and sort all unique 15m timestamps across the universe
    const allTimestampsSet = new Set();
    for (const sym of availableSymbols) {
      for (const c of universe[sym].candles15m) {
        allTimestampsSet.add(c.timestamp);
      }
    }
    let timeline = Array.from(allTimestampsSet).sort((a, b) => a - b);
    if (options.maxBars && options.maxBars < timeline.length) {
      timeline = timeline.slice(0, options.maxBars);
    }

    // Warmup: need at least 50 4h candles (~8.3 days) and 35 15m candles
    const warmupMs = 40 * 15 * 60 * 1000;
    const startTs = timeline[0] + warmupMs;

    // Split setup: OOS is final 30 days
    const endTs = timeline[timeline.length - 1];
    const oosDurationMs = 30 * 24 * 60 * 60 * 1000;
    const oosStartTs = endTs - oosDurationMs;

    let equity = this.initialEquity;
    let peakEquity = equity;
    let currentPosition = null; // { symbol, side, entryPrice, quantity, stopLoss, takeProfit, partialTpPrice, isPartialClosed, ... }
    let pendingOrder = null; // { symbol, side, requestedEntryPrice, stopLoss, takeProfit, quantity, fillAtTs }

    let lastTradeClosedAt = null;
    let consecutiveLosses = 0;
    let startOfDayEquity = equity;
    let currentUtcDay = new Date(timeline[0]).getUTCDate();
    let dailyLoss = 0;
    let isDailyLossLocked = false;

    let totalFeesPaid = 0;
    let totalSlippagePaid = 0;
    let totalFundingPaid = 0;
    let isFeesPaid = 0, oosFeesPaid = 0;
    let isSlippagePaid = 0, oosSlippagePaid = 0;
    let isFundingPaid = 0, oosFundingPaid = 0;
    let barsWithPositionOpen = 0;

    const trades = [];
    const equityCurve = [];
    const dailyRecords = []; // { date, equity, returnPct }
    let lastRecordedDayEquity = equity;
    let lastRecordedDay = null;

    const rules = this.config.rules;
    const takerFeeRate = rules.executionAndCosts.takerFeeRate;
    const slippageRate = rules.executionAndCosts.slippageRate;
    const fundingRate8h = 0.0001; // 0.01% standard 8h cost model

    // Replay bar-by-bar
    for (let barIdx = 0; barIdx < timeline.length; barIdx++) {
      const currentTs = timeline[barIdx];
      const currentDate = new Date(currentTs);
      const utcDay = currentDate.getUTCDate();

      // Daily Reset Check (00:00 UTC)
      if (utcDay !== currentUtcDay) {
        currentUtcDay = utcDay;
        startOfDayEquity = equity;
        dailyLoss = 0;
        isDailyLossLocked = false;
        consecutiveLosses = 0; // reset daily loss pause

        const dayStr = currentDate.toISOString().split('T')[0];
        const dayReturn = (equity - lastRecordedDayEquity) / lastRecordedDayEquity;
        dailyRecords.push({
          date: dayStr,
          equity,
          returnPct: dayReturn,
        });
        lastRecordedDayEquity = equity;
      }

      // 1. Process 8h Funding Rate Deduction (00:00, 08:00, 16:00 UTC)
      const hours = currentDate.getUTCHours();
      const minutes = currentDate.getUTCMinutes();
      if ((hours === 0 || hours === 8 || hours === 16) && minutes === 0 && currentPosition) {
        const notional = currentPosition.quantity * currentPosition.currentPrice;
        const fundingCost = notional * fundingRate8h;
        equity -= fundingCost;
        totalFundingPaid += fundingCost;
        if (currentTs >= oosStartTs) {
          oosFundingPaid += fundingCost;
        } else {
          isFundingPaid += fundingCost;
        }
        currentPosition.fundingPaid = (currentPosition.fundingPaid || 0) + fundingCost;
      }

      // 2. Execute Pending Order from Previous Bar (Fill at NEXT bar open + slippage)
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
          if (currentTs >= oosStartTs) {
            oosFeesPaid += entryFee;
            oosSlippagePaid += slippageCost;
          } else {
            isFeesPaid += entryFee;
            isSlippagePaid += slippageCost;
          }

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
            entryFee: entryFee,
            partialFee: 0,
            exitFee: 0,
            fundingPaid: 0,
            slippagePaid: slippageCost,
            isOos: currentTs >= oosStartTs,
          };
        }
        pendingOrder = null;
      }

      // 3. Update & Manage Open Position
      if (currentPosition) {
        barsWithPositionOpen++;
        const symData = universe[currentPosition.symbol];
        const bar = symData?.candleMap15m.get(currentTs);

        if (bar) {
          currentPosition.currentPrice = bar.close;

          const { side, entryPrice, stopLoss, takeProfit, quantity, partialTpPrice, isPartialClosed } = currentPosition;
          let isClosed = false;
          let exitPrice = 0;
          let exitReason = '';

          // Check ambiguous candle: both stop and TP breached in same bar
          const hitLongStop = bar.low <= stopLoss;
          const hitLongTp = bar.high >= takeProfit;
          const hitShortStop = bar.high >= stopLoss;
          const hitShortTp = bar.low <= takeProfit;

          const isAmbiguous = (side === 'LONG' && hitLongStop && hitLongTp) ||
                              (side === 'SHORT' && hitShortStop && hitShortTp);

          if (side === 'LONG') {
            if (isAmbiguous || hitLongStop) {
              // Worst-case conservative assumption: stop loss hit first
              isClosed = true;
              exitPrice = Number((stopLoss * (1 - slippageRate)).toFixed(4));
              exitReason = isAmbiguous ? 'STOP_LOSS_AMBIGUOUS_WORST_CASE' : 'STOP_LOSS';
            } else if (hitLongTp) {
              isClosed = true;
              exitPrice = Number((takeProfit * (1 - slippageRate)).toFixed(4));
              exitReason = 'TAKE_PROFIT_FINAL';
            } else if (!isPartialClosed && bar.high >= partialTpPrice) {
              // Partial TP (+1.1% ROI)
              const partialQty = Number((quantity * rules.lifecycleExits.partialExitRatio).toFixed(4));
              const partialExitPrice = Number((partialTpPrice * (1 - slippageRate)).toFixed(4));
              const partialSlippage = Math.abs(partialExitPrice - partialTpPrice) * partialQty;
              const partialFee = partialQty * partialExitPrice * takerFeeRate;
              const partialPnl = (partialExitPrice - entryPrice) * partialQty - partialFee;

              equity += partialPnl;
              totalFeesPaid += partialFee;
              totalSlippagePaid += partialSlippage;
              if (currentTs >= oosStartTs) {
                oosFeesPaid += partialFee;
                oosSlippagePaid += partialSlippage;
              } else {
                isFeesPaid += partialFee;
                isSlippagePaid += partialSlippage;
              }
              currentPosition.realizedPnl += partialPnl;
              currentPosition.partialFee = partialFee;
              currentPosition.slippagePaid += partialSlippage;
              currentPosition.quantity -= partialQty;
              currentPosition.isPartialClosed = true;
              // Move stop to breakeven + offset
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
            } else if (!isPartialClosed && bar.low <= partialTpPrice) {
              const partialQty = Number((quantity * rules.lifecycleExits.partialExitRatio).toFixed(4));
              const partialExitPrice = Number((partialTpPrice * (1 + slippageRate)).toFixed(4));
              const partialSlippage = Math.abs(partialExitPrice - partialTpPrice) * partialQty;
              const partialFee = partialQty * partialExitPrice * takerFeeRate;
              const partialPnl = (entryPrice - partialExitPrice) * partialQty - partialFee;

              equity += partialPnl;
              totalFeesPaid += partialFee;
              totalSlippagePaid += partialSlippage;
              if (currentTs >= oosStartTs) {
                oosFeesPaid += partialFee;
                oosSlippagePaid += partialSlippage;
              } else {
                isFeesPaid += partialFee;
                isSlippagePaid += partialSlippage;
              }
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
            if (currentTs >= oosStartTs) {
              oosFeesPaid += exitFee;
              oosSlippagePaid += exitSlippage;
            } else {
              isFeesPaid += exitFee;
              isSlippagePaid += exitSlippage;
            }

            currentPosition.exitFee = exitFee;
            currentPosition.slippagePaid += exitSlippage;

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
              entryTime: currentPosition.entryTime,
              entryDate: currentPosition.entryDate,
              exitTime: currentTs,
              exitDate: currentDate.toISOString(),
              entryPrice: currentPosition.entryPrice,
              exitPrice,
              quantity: currentPosition.initialQuantity,
              fees: Number(((currentPosition.entryFee || 0) + (currentPosition.partialFee || 0) + (currentPosition.exitFee || 0)).toFixed(2)),
              slippage: Number((currentPosition.slippagePaid || 0).toFixed(2)),
              funding: Number((currentPosition.fundingPaid || 0).toFixed(2)),
              netPnl: Number(netTradePnl.toFixed(2)),
              roiPct: Number(((netTradePnl / (currentPosition.entryPrice * currentPosition.initialQuantity)) * 100).toFixed(2)),
              exitReason,
              equityAfter: Number(equity.toFixed(2)),
              isOos: currentPosition.isOos,
            });

            currentPosition = null;
          }
        }
      }

      // 4. Signal Scan & Generation (Strict Zero Look-Ahead)
      // Only evaluate when no position is open, no pending order, no cooldown, no daily lock
      const inCooldown = lastTradeClosedAt && (currentTs - lastTradeClosedAt < rules.riskEngine.cooldownMinutes * 60 * 1000);
      const consecutiveLossBlocked = consecutiveLosses >= rules.riskEngine.maxConsecutiveLosses;

      if (!currentPosition && !pendingOrder && !inCooldown && !isDailyLossLocked && !consecutiveLossBlocked && currentTs >= startTs) {
        const macroBenchmark = evaluateBenchmarkTrendAt(spy4hCandles, currentTs);

        // Iterate eligible symbols in order
        for (const sym of availableSymbols) {
          const symData = universe[sym];
          // Get 15m candles strictly up to current bar
          const bar15mSlice = symData.candles15m.filter(c => c.timestamp <= currentTs);
          if (bar15mSlice.length < 35) continue;

          // Get closed 4h candles strictly closed at or before current bar
          const bar4hSlice = symData.candles4h.filter(c => c.timestamp + 4 * 60 * 60 * 1000 <= currentTs);
          if (bar4hSlice.length < 35) continue;

          // Compute indicators on historical slice only
          const ind15m = computeIndicators(bar15mSlice);
          const ind4h = computeIndicators(bar4hSlice);
          const currentBar = bar15mSlice[bar15mSlice.length - 1];

          // Check EMA alignment on 4h and 15m
          const isBullish4h = ind4h.current.ema20 > ind4h.current.ema50 && ind4h.current.close > ind4h.current.ema50;
          const isBearish4h = ind4h.current.ema20 < ind4h.current.ema50 && ind4h.current.close < ind4h.current.ema50;

          const isBullish15m = ind15m.current.ema20 > ind15m.current.ema50 && ind15m.current.close > ind15m.current.ema50;
          const isBearish15m = ind15m.current.ema20 < ind15m.current.ema50 && ind15m.current.close < ind15m.current.ema50;

          let signalSide = null;
          if (isBullish4h && isBullish15m && macroBenchmark.trend === 'BULLISH') {
            const rsi = ind15m.current.rsi;
            if (rsi >= rules.indicators.entry15m.rsiLongMin && rsi <= rules.indicators.entry15m.rsiLongMax) {
              signalSide = 'LONG';
            }
          } else if (isBearish4h && isBearish15m && macroBenchmark.trend === 'BEARISH') {
            const rsi = ind15m.current.rsi;
            if (rsi >= rules.indicators.entry15m.rsiShortMin && rsi <= rules.indicators.entry15m.rsiShortMax) {
              signalSide = 'SHORT';
            }
          }

          if (signalSide) {
            const entryPrice = currentBar.close;
            const atr = ind15m.current.atr;
            const stopDistance = Math.min(
              rules.stopsAndTargets.maxStopDistancePercent * entryPrice,
              Math.max(rules.stopsAndTargets.minStopDistancePercent * entryPrice, atr * rules.stopsAndTargets.atrMultiplierStop)
            );

            const stopLoss = signalSide === 'LONG'
              ? Number((entryPrice - stopDistance).toFixed(4))
              : Number((entryPrice + stopDistance).toFixed(4));

            const targetDistance = stopDistance * rules.stopsAndTargets.minNetRewardToRisk * 1.05;
            const takeProfit = signalSide === 'LONG'
              ? Number((entryPrice + targetDistance).toFixed(4))
              : Number((entryPrice - targetDistance).toFixed(4));

            const partialTpPrice = signalSide === 'LONG'
              ? Number((entryPrice * (1 + rules.lifecycleExits.partialTakeProfitRoi)).toFixed(4))
              : Number((entryPrice * (1 - rules.lifecycleExits.partialTakeProfitRoi)).toFixed(4));

            // Sizing via risk budget (0.5% of equity)
            const riskBudgetDollars = equity * rules.riskEngine.riskPerTradePercent;
            const perUnitRisk = Math.abs(entryPrice - stopLoss);
            const spec = getContractSpec(sym);
            const rawQty = perUnitRisk > 0 ? (riskBudgetDollars / perUnitRisk) : 0;
            const quantity = roundToStep(rawQty, spec?.minTradeNum || 0.01);

            if (quantity > 0) {
              // Submit pending order to fill at next bar open
              pendingOrder = {
                symbol: sym,
                side: signalSide,
                requestedEntryPrice: entryPrice,
                stopLoss,
                takeProfit,
                partialTpPrice,
                quantity,
                fillAtTs: currentTs + 15 * 60 * 1000,
              };
              break; // Only 1 setup per bar
            }
          }
        }
      }

      // Track equity curve
      if (equity > peakEquity) peakEquity = equity;
      const drawdown = peakEquity - equity;
      const drawdownPct = (drawdown / peakEquity) * 100;

      equityCurve.push({
        timestamp: currentTs,
        date: currentDate.toISOString(),
        equity: Number(equity.toFixed(2)),
        drawdown: Number(drawdown.toFixed(2)),
        drawdownPct: Number(drawdownPct.toFixed(2)),
        isOos: currentTs >= oosStartTs,
      });
    }

    // Benchmark 1: SPYUSDT Buy-and-Hold
    const spyBenchmarkCurve = this.computeBuyAndHold(spyData.candles15m, startTs, endTs);

    // Benchmark 2: Equal-Weight Basket Buy-and-Hold
    const basketBenchmarkCurve = this.computeEqualWeightBasket(universe, availableSymbols, startTs, endTs);

    // Compute Metrics for Total, IS, OOS
    const metrics = this.computeAllMetrics({
      trades,
      equityCurve,
      dailyRecords,
      totalFeesPaid,
      totalSlippagePaid,
      totalFundingPaid,
      isFeesPaid,
      oosFeesPaid,
      isSlippagePaid,
      oosSlippagePaid,
      isFundingPaid,
      oosFundingPaid,
      barsWithPositionOpen,
      totalBars: timeline.length,
      oosStartTs,
      spyBenchmarkCurve,
      basketBenchmarkCurve,
      initialEquity: this.initialEquity,
    });

    return {
      universe: availableSymbols,
      metrics,
      trades,
      equityCurve,
      spyBenchmarkCurve,
      basketBenchmarkCurve,
      oosStartTs,
      totalDays: Number(((endTs - startTs) / (24 * 60 * 60 * 1000)).toFixed(1)),
    };
  }

  computeBuyAndHold(candles15m, startTs, endTs) {
    const valid = candles15m.filter(c => c.timestamp >= startTs && c.timestamp <= endTs);
    if (valid.length === 0) return { totalReturnPct: 0, maxDrawdownPct: 0, sharpe: 0 };
    const initialPrice = valid[0].open;
    const finalPrice = valid[valid.length - 1].close;
    const totalReturnPct = ((finalPrice - initialPrice) / initialPrice) * 100;

    let peak = initialPrice;
    let maxDd = 0;
    for (const c of valid) {
      if (c.high > peak) peak = c.high;
      const dd = ((peak - c.low) / peak) * 100;
      if (dd > maxDd) maxDd = dd;
    }

    return {
      initialPrice,
      finalPrice,
      totalReturnPct: Number(totalReturnPct.toFixed(2)),
      maxDrawdownPct: Number(maxDd.toFixed(2)),
    };
  }

  computeEqualWeightBasket(universe, symbols, startTs, endTs) {
    const returns = [];
    for (const sym of symbols) {
      const candles = universe[sym].candles15m.filter(c => c.timestamp >= startTs && c.timestamp <= endTs);
      if (candles.length >= 2) {
        const ret = (candles[candles.length - 1].close - candles[0].open) / candles[0].open;
        returns.push(ret);
      }
    }
    const avgReturn = returns.length > 0 ? (returns.reduce((a, b) => a + b, 0) / returns.length) * 100 : 0;
    return {
      symbolCount: returns.length,
      totalReturnPct: Number(avgReturn.toFixed(2)),
    };
  }

  computeSubsetMetrics(tradesSubset, equityCurveSubset, label, initialEq) {
    const tradeCount = tradesSubset.length;
    const wins = tradesSubset.filter(t => t.netPnl > 0);
    const losses = tradesSubset.filter(t => t.netPnl < 0);

    const winRate = tradeCount > 0 ? (wins.length / tradeCount) * 100 : 0;
    const totalPnl = tradesSubset.reduce((sum, t) => sum + t.netPnl, 0);
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.netPnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.netPnl, 0) / losses.length) : 0;

    const grossProfit = wins.reduce((s, t) => s + t.netPnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 999 : 1.0);

    const startEquity = equityCurveSubset.length > 0 ? equityCurveSubset[0].equity : initialEq;
    const endEquity = equityCurveSubset.length > 0 ? equityCurveSubset[equityCurveSubset.length - 1].equity : initialEq;
    const totalReturnPct = ((endEquity - startEquity) / startEquity) * 100;

    // Daily returns for Sharpe and Sortino
    const dailyReturns = [];
    let prevEq = startEquity;
    for (let i = 0; i < equityCurveSubset.length; i += 96) { // ~96 15m bars in 24 hours
      const pt = equityCurveSubset[i];
      const r = (pt.equity - prevEq) / prevEq;
      dailyReturns.push(r);
      prevEq = pt.equity;
    }

    const meanDaily = dailyReturns.length > 0 ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
    const variance = dailyReturns.length > 1
      ? dailyReturns.reduce((acc, r) => acc + Math.pow(r - meanDaily, 2), 0) / (dailyReturns.length - 1)
      : 0;
    const stdDaily = Math.sqrt(variance);

    const downsideVariance = dailyReturns.length > 1
      ? dailyReturns.filter(r => r < 0).reduce((acc, r) => acc + Math.pow(r, 2), 0) / (dailyReturns.length - 1)
      : 0;
    const stdDownside = Math.sqrt(downsideVariance);

    const annualFactor = Math.sqrt(365); // 24/7 continuous futures market
    const annualizedSharpe = stdDaily > 0 ? (meanDaily / stdDaily) * annualFactor : 0;
    const annualizedSortino = stdDownside > 0 ? (meanDaily / stdDownside) * annualFactor : 0;

    let peak = startEquity;
    let maxDd = 0;
    let maxDdPct = 0;
    for (const pt of equityCurveSubset) {
      if (pt.equity > peak) peak = pt.equity;
      const dd = peak - pt.equity;
      const ddPct = (dd / peak) * 100;
      if (dd > maxDd) maxDd = dd;
      if (ddPct > maxDdPct) maxDdPct = ddPct;
    }

    const totalNotional = tradesSubset.reduce((sum, t) => sum + (t.entryPrice * t.quantity), 0);
    const avgEquity = (startEquity + endEquity) / 2;
    const turnover = avgEquity > 0 ? totalNotional / avgEquity : 0;

    return {
      label,
      tradeCount,
      winRate: Number(winRate.toFixed(2)),
      totalPnl: Number(totalPnl.toFixed(2)),
      totalReturnPct: Number(totalReturnPct.toFixed(2)),
      annualizedSharpe: Number(annualizedSharpe.toFixed(2)),
      annualizedSortino: Number(annualizedSortino.toFixed(2)),
      maxDrawdownDollars: Number(maxDd.toFixed(2)),
      maxDrawdownPct: Number(maxDdPct.toFixed(2)),
      avgWinDollars: Number(avgWin.toFixed(2)),
      avgLossDollars: Number(avgLoss.toFixed(2)),
      profitFactor: Number(profitFactor.toFixed(2)),
      turnover: Number(turnover.toFixed(2)),
    };
  }

  computeAllMetrics(ctx) {
    const isTrades = ctx.trades.filter(t => !t.isOos);
    const oosTrades = ctx.trades.filter(t => t.isOos);

    const isCurve = ctx.equityCurve.filter(c => !c.isOos);
    const oosCurve = ctx.equityCurve.filter(c => c.isOos);

    const totalMetrics = this.computeSubsetMetrics(ctx.trades, ctx.equityCurve, 'TOTAL', ctx.initialEquity);
    const isMetrics = this.computeSubsetMetrics(isTrades, isCurve, 'IN_SAMPLE', ctx.initialEquity);
    const oosMetrics = this.computeSubsetMetrics(oosTrades, oosCurve, 'OUT_OF_SAMPLE', isMetrics ? ctx.equityCurve[0].equity + isMetrics.totalPnl : ctx.initialEquity);

    // OOS Sharpe Decay
    const isSharpe = isMetrics.annualizedSharpe;
    const oosSharpe = oosMetrics.annualizedSharpe;
    const sharpeDecayRatio = isSharpe !== 0 ? Number((oosSharpe / isSharpe).toFixed(3)) : 0;
    const isSharpeMeaningful = isSharpe > 0;
    const sharpeDecayFlag = isSharpeMeaningful ? (sharpeDecayRatio < 0.5) : false;

    // Per-symbol breakdown
    const perSymbol = {};
    for (const t of ctx.trades) {
      if (!perSymbol[t.symbol]) {
        perSymbol[t.symbol] = { symbol: t.symbol, trades: 0, wins: 0, pnl: 0 };
      }
      perSymbol[t.symbol].trades++;
      if (t.netPnl > 0) perSymbol[t.symbol].wins++;
      perSymbol[t.symbol].pnl += t.netPnl;
    }
    const perSymbolTable = Object.values(perSymbol).map(s => ({
      symbol: s.symbol,
      trades: s.trades,
      winRate: Number(((s.wins / s.trades) * 100).toFixed(1)),
      pnl: Number(s.pnl.toFixed(2)),
    })).sort((a, b) => b.pnl - a.pnl);

    const exposureTimePct = ctx.totalBars > 0 ? (ctx.barsWithPositionOpen / ctx.totalBars) * 100 : 0;

    return {
      summary: {
        total: totalMetrics,
        inSample: isMetrics,
        outOfSample: oosMetrics,
        sharpeDecay: {
          isSharpe: isMetrics.annualizedSharpe,
          oosSharpe: oosMetrics.annualizedSharpe,
          decayRatio: sharpeDecayRatio,
          isMeaningful: isSharpeMeaningful,
          decayAlertFlag: sharpeDecayFlag,
          interpretation: isSharpeMeaningful
            ? (sharpeDecayFlag ? 'Decay Alert: OOS Sharpe retained < 50% of IS Sharpe' : 'Pass: OOS Sharpe retained >= 50% of IS Sharpe')
            : 'Standard Sharpe decay ratio is not economically meaningful when In-Sample Sharpe is zero or negative (dividing negative by negative yields positive, not retention).',
        },
      },
      costs: {
        totalFeesPaid: Number(ctx.totalFeesPaid.toFixed(2)),
        totalSlippagePaid: Number(ctx.totalSlippagePaid.toFixed(2)),
        totalFundingPaid: Number(ctx.totalFundingPaid.toFixed(2)),
        totalTradingCosts: Number((ctx.totalFeesPaid + ctx.totalSlippagePaid + ctx.totalFundingPaid).toFixed(2)),
        inSample: {
          fees: Number((ctx.isFeesPaid || 0).toFixed(2)),
          slippage: Number((ctx.isSlippagePaid || 0).toFixed(2)),
          funding: Number((ctx.isFundingPaid || 0).toFixed(2)),
          total: Number(((ctx.isFeesPaid || 0) + (ctx.isSlippagePaid || 0) + (ctx.isFundingPaid || 0)).toFixed(2)),
        },
        outOfSample: {
          fees: Number((ctx.oosFeesPaid || 0).toFixed(2)),
          slippage: Number((ctx.oosSlippagePaid || 0).toFixed(2)),
          funding: Number((ctx.oosFundingPaid || 0).toFixed(2)),
          total: Number(((ctx.oosFeesPaid || 0) + (ctx.oosSlippagePaid || 0) + (ctx.oosFundingPaid || 0)).toFixed(2)),
        },
      },
      exposureTimePct: Number(exposureTimePct.toFixed(2)),
      benchmarks: {
        spyBuyAndHold: ctx.spyBenchmarkCurve,
        equalWeightBasket: ctx.basketBenchmarkCurve,
      },
      perSymbol: perSymbolTable,
    };
  }
}
