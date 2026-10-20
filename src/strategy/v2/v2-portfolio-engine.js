import fs from 'node:fs';
import path from 'node:path';
import { computeIndicators } from '../../indicators/index.js';
import { roundToStep } from '../../utils/decimal.js';
import { getContractSpec, getCorrelationGroup } from '../../config/contracts.js';
import { CandidateC1 } from './candidate-c1.js';
import { CandidateC2 } from './candidate-c2.js';
import { CandidateR2A } from './candidate-r2a.js';
import { CandidateR2B } from './candidate-r2b.js';

export const SPLITS = {
  dev: {
    id: 'dev',
    name: 'Dev (In-Sample)',
    startTs: 1778520600000, // 2026-05-11T17:30:00.000Z
    endTs: 1789138800000,   // 2026-09-11T15:00:00.000Z
  },
  validation: {
    id: 'validation',
    name: 'Validation (Out-of-Sample)',
    startTs: 1789138800000, // 2026-09-11T15:00:00.000Z
    endTs: 1791660000000,   // 2026-10-10T00:00:00.000Z
  },
  forwardHoldout: {
    id: 'forwardHoldout',
    name: 'Forward Holdout',
    startTs: 1791660000000, // 2026-10-10T00:00:00.000Z
    endTs: 1792440000000,   // 2026-10-19 (Present)
  },
};

/**
 * Computes 1000-resample bootstrap 80% confidence interval for mean trade return.
 */
export function computeBootstrapCI(returns, numResamples = 1000, alpha = 0.20) {
  if (!returns || returns.length === 0) {
    return { mean: 0, lower80: 0, upper80: 0 };
  }
  const n = returns.length;
  const sampleMeans = new Float64Array(numResamples);

  // Simple LCG PRNG for determinism
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
    mean: Number(realMean.toFixed(4)),
    lower80: Number(sampleMeans[lowerIdx].toFixed(4)),
    upper80: Number(sampleMeans[upperIdx].toFixed(4)),
  };
}

/**
 * Synthesizes 1h candles from 15m candles deterministically (zero look-ahead).
 */
export function synthesize1hFrom15m(candles15m) {
  const c1h = [];
  const map1h = new Map();

  for (const c of candles15m) {
    // 1h bucket: round down to hour boundary
    const hTs = Math.floor(c.timestamp / (60 * 60 * 1000)) * (60 * 60 * 1000);
    if (!map1h.has(hTs)) {
      const bar = {
        timestamp: hTs,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        barsCount: 1,
      };
      map1h.set(hTs, bar);
      c1h.push(bar);
    } else {
      const bar = map1h.get(hTs);
      bar.high = Math.max(bar.high, c.high);
      bar.low = Math.min(bar.low, c.low);
      bar.close = c.close;
      bar.volume += c.volume;
      bar.barsCount++;
    }
  }

  return c1h;
}

/**
 * V2 Multi-Candidate Portfolio Backtest Engine
 */
export class V2PortfolioEngine {
  constructor(options = {}) {
    this.initialEquity = options.initialEquity || 10000;
    this.historyDir = options.historyDir || path.resolve('data/history');
    this.takerFeeRate = options.takerFeeRate ?? 0.0006;
    this.makerFeeRate = options.makerFeeRate ?? 0.0002;
    this.baseSlippageRate = options.slippageRate ?? 0.0002;
    this.fundingRate8h = 0.0001;

    // Risk Parameters
    this.riskPerTradePercent = options.riskPerTradePercent ?? 0.005; // 0.5%
    this.maxDailyLossPercent = options.maxDailyLossPercent ?? 0.02;  // 2.0%
    this.maxConsecutiveLosses = options.maxConsecutiveLosses ?? 3;
    this.maxAggregateOpenRiskPercent = options.maxAggregateOpenRiskPercent ?? 0.01; // 1.0%
    this.maxConcurrentPositions = options.maxConcurrentPositions ?? 3;
  }

  /**
   * Loads and prepares indexed universe across 15m, 1h, and 4h.
   */
  loadUniverse(symbols) {
    const universe = {};

    for (const sym of symbols) {
      const f15m = path.join(this.historyDir, `${sym}_15m.json`);
      const f4h = path.join(this.historyDir, `${sym}_4h.json`);
      if (!fs.existsSync(f15m) || !fs.existsSync(f4h)) continue;

      const d15m = JSON.parse(fs.readFileSync(f15m, 'utf8'));
      const d4h = JSON.parse(fs.readFileSync(f4h, 'utf8'));

      const candles15m = d15m.candles || [];
      const candles4h = d4h.candles || [];
      if (candles15m.length < 100) continue;

      // Synthesize 1h candles from 15m
      const candles1h = synthesize1hFrom15m(candles15m);

      const ind15m = computeIndicators(candles15m);
      const ind1h = computeIndicators(candles1h);
      const ind4h = computeIndicators(candles4h);

      const map15m = new Map();
      const enriched15m = [];
      for (let i = 0; i < candles15m.length; i++) {
        const c = candles15m[i];
        const item = {
          candle: c,
          index: i,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          ema20: ind15m?.ema20[i] ?? null,
          ema50: ind15m?.ema50[i] ?? null,
          ema200: ind15m?.ema200[i] ?? null,
          atr: ind15m?.atr14[i] ?? null,
          rsi: ind15m?.rsi14[i] ?? null,
        };
        map15m.set(c.timestamp, item);
        enriched15m.push(item);
      }

      const list1h = [];
      for (let i = 0; i < candles1h.length; i++) {
        const c = candles1h[i];
        list1h.push({
          openTs: c.timestamp,
          closeTs: c.timestamp + 60 * 60 * 1000,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          ema20: ind1h?.ema20[i] ?? null,
          ema50: ind1h?.ema50[i] ?? null,
          ema200: ind1h?.ema200[i] ?? null,
          atr: ind1h?.atr14[i] ?? null,
        });
      }

      const list4h = [];
      for (let i = 0; i < candles4h.length; i++) {
        const c = candles4h[i];
        list4h.push({
          openTs: c.timestamp,
          closeTs: c.timestamp + 4 * 60 * 60 * 1000,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          ema20: ind4h?.ema20[i] ?? null,
          ema50: ind4h?.ema50[i] ?? null,
          ema200: ind4h?.ema200[i] ?? null,
          atr: ind4h?.atr14[i] ?? null,
        });
      }

      universe[sym] = {
        symbol: sym,
        assetClass: sym.startsWith('BTC') || sym.startsWith('ETH') || sym.startsWith('SOL') ? 'CRYPTO' : 'EQUITY',
        candles15m,
        candles1h,
        candles4h,
        map15m,
        enriched15m,
        list1h,
        list4h,
      };
    }

    return universe;
  }

  getClosedBar(list, currentTs) {
    let low = 0;
    let high = list.length - 1;
    let best = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (list[mid].closeTs <= currentTs) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return best >= 0 ? list[best] : null;
  }

  /**
   * Executes chronological replay for a candidate on a defined split.
   */
  runReplay(universe, symbols, candidateId, sessionMode = 'E0', splitId = 'dev', options = {}) {
    const split = SPLITS[splitId];
    if (!split) throw new Error(`Unknown split: ${splitId}`);

    const slippageRate = options.slippageRate ?? this.baseSlippageRate;
    const takerFeeRate = options.takerFeeRate ?? this.takerFeeRate;

    // Instantiate candidate strategy
    let strategy;
    if (candidateId === 'C1') {
      strategy = new CandidateC1({
        sessionMode,
        takerFeeRate,
        slippageRate,
      });
    } else if (candidateId === 'C2') {
      strategy = new CandidateC2({
        sessionMode,
        takerFeeRate,
        slippageRate,
      });
    } else if (candidateId === 'R2-A') {
      strategy = new CandidateR2A({
        sessionMode,
        takerFeeRate,
        slippageRate,
      });
    } else if (candidateId === 'R2-B') {
      strategy = new CandidateR2B({
        sessionMode,
        takerFeeRate,
        makerFeeRate: this.makerFeeRate,
        slippageRate,
      });
    } else {
      throw new Error(`Candidate ${candidateId} must be evaluated via v1 baseline engine`);
    }

    const availableSymbols = symbols.filter(s => universe[s]);

    // Build timeline of all 15m timestamps in split
    const allTs = new Set();
    for (const sym of availableSymbols) {
      for (const c of universe[sym].candles15m) {
        if (c.timestamp >= split.startTs && c.timestamp < split.endTs) {
          allTs.add(c.timestamp);
        }
      }
    }

    const timeline = Array.from(allTs).sort((a, b) => a - b);
    if (timeline.length === 0) {
      return this.emptyResult(candidateId, sessionMode, splitId);
    }

    let equity = this.initialEquity;
    let peakEquity = equity;
    let maxDrawdownDollars = 0;

    const openPositions = []; // up to maxConcurrentPositions (3)
    let pendingOrder = null;

    let consecutiveLosses = 0;
    let startOfDayEquity = equity;
    let currentUtcDay = new Date(timeline[0]).getUTCDate();
    let dailyLoss = 0;
    let isDailyLossLocked = false;

    let totalFeesPaid = 0;
    let totalSlippagePaid = 0;
    let totalFundingPaid = 0;
    let barsWithExposure = 0;

    const trades = [];
    const equityCurve = [];
    const dailyRecords = [];
    let lastRecordedDayEquity = equity;

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
        consecutiveLosses = 0;

        const dayStr = currentDate.toISOString().split('T')[0];
        const dayReturn = (equity - lastRecordedDayEquity) / lastRecordedDayEquity;
        dailyRecords.push({ date: dayStr, equity, returnPct: dayReturn });
        lastRecordedDayEquity = equity;
      }

      // 1. Funding cost deduction (00:00, 08:00, 16:00 UTC)
      const hours = currentDate.getUTCHours();
      const minutes = currentDate.getUTCMinutes();
      if ((hours === 0 || hours === 8 || hours === 16) && minutes === 0 && openPositions.length > 0) {
        for (const pos of openPositions) {
          const notional = pos.quantity * pos.currentPrice;
          const fundingCost = notional * this.fundingRate8h;
          equity -= fundingCost;
          totalFundingPaid += fundingCost;
          pos.fundingPaid = (pos.fundingPaid || 0) + fundingCost;
        }
      }

      // 2. Execute Pending Order (Fill at NEXT bar open for taker, or through-tick for maker)
      if (pendingOrder) {
        if (!pendingOrder.isMaker) {
          // Taker order execution (fill at scheduled fillAtTs)
          if (pendingOrder.fillAtTs === currentTs) {
            const symData = universe[pendingOrder.symbol];
            const barData = symData?.map15m.get(currentTs);
            const canOpen = openPositions.length < this.maxConcurrentPositions && !isDailyLossLocked;

            // Check correlation group constraint
            const proposedGroup = getCorrelationGroup(pendingOrder.symbol)?.id;
            const groupOccupied = proposedGroup && openPositions.some(p => getCorrelationGroup(p.symbol)?.id === proposedGroup);

            if (barData && canOpen && !groupOccupied) {
              const rawOpen = barData.open;
              const fillPrice = pendingOrder.side === 'LONG'
                ? Number((rawOpen * (1 + slippageRate)).toFixed(4))
                : Number((rawOpen * (1 - slippageRate)).toFixed(4));

              const slippageCost = Math.abs(fillPrice - rawOpen) * pendingOrder.quantity;
              const entryFee = fillPrice * pendingOrder.quantity * takerFeeRate;

              equity -= entryFee;
              totalFeesPaid += entryFee;
              totalSlippagePaid += slippageCost;

              openPositions.push({
                id: `trade-${trades.length + openPositions.length + 1}`,
                candidateId,
                symbol: pendingOrder.symbol,
                side: pendingOrder.side,
                entryPrice: fillPrice,
                rawEntryPrice: rawOpen,
                isMakerEntry: false,
                currentPrice: fillPrice,
                bestClose: fillPrice,
                quantity: pendingOrder.quantity,
                initialQuantity: pendingOrder.quantity,
                stopLoss: pendingOrder.stopLoss,
                takeProfit: pendingOrder.takeProfit,
                breakevenLevel: pendingOrder.breakevenLevel,
                breakevenStop: pendingOrder.breakevenStop,
                trailingAtrDistance: pendingOrder.trailingAtrDistance,
                isBreakevenMoved: false,
                entryTime: currentTs,
                entryDate: currentDate.toISOString(),
                riskBudgetDollars: pendingOrder.riskBudgetDollars,
                stopDistance: pendingOrder.stopDistance,
                entryFee,
                exitFee: 0,
                fundingPaid: 0,
                slippagePaid: slippageCost,
              });
            }
            pendingOrder = null;
          }
        } else {
          // Maker Limit Order execution (through-tick fill on subsequent bars)
          if (currentTs > pendingOrder.placedAtTs) {
            const symData = universe[pendingOrder.symbol];
            const barData = symData?.map15m.get(currentTs);
            const canOpen = openPositions.length < this.maxConcurrentPositions && !isDailyLossLocked;
            const proposedGroup = getCorrelationGroup(pendingOrder.symbol)?.id;
            const groupOccupied = proposedGroup && openPositions.some(p => getCorrelationGroup(p.symbol)?.id === proposedGroup);

            pendingOrder.barsElapsed = (pendingOrder.barsElapsed || 0) + 1;

            if (barData && canOpen && !groupOccupied) {
              const throughTickFilled = pendingOrder.side === 'LONG'
                ? barData.low < pendingOrder.limitPrice
                : barData.high > pendingOrder.limitPrice;

              if (throughTickFilled) {
                const fillPrice = pendingOrder.limitPrice;
                const entryFee = fillPrice * pendingOrder.quantity * this.makerFeeRate;

                equity -= entryFee;
                totalFeesPaid += entryFee;
                // 0 slippage for maker order

                openPositions.push({
                  id: `trade-${trades.length + openPositions.length + 1}`,
                  candidateId,
                  symbol: pendingOrder.symbol,
                  side: pendingOrder.side,
                  entryPrice: fillPrice,
                  rawEntryPrice: fillPrice,
                  isMakerEntry: true,
                  currentPrice: fillPrice,
                  bestClose: fillPrice,
                  quantity: pendingOrder.quantity,
                  initialQuantity: pendingOrder.quantity,
                  stopLoss: pendingOrder.stopLoss,
                  takeProfit: pendingOrder.takeProfit,
                  breakevenLevel: null,
                  breakevenStop: null,
                  trailingAtrDistance: null,
                  isBreakevenMoved: false,
                  entryTime: currentTs,
                  entryDate: currentDate.toISOString(),
                  riskBudgetDollars: pendingOrder.riskBudgetDollars,
                  stopDistance: pendingOrder.stopDistance,
                  entryFee,
                  exitFee: 0,
                  fundingPaid: 0,
                  slippagePaid: 0,
                });
                pendingOrder = null;
              }
            }

            // Expiration check if not filled
            if (pendingOrder && pendingOrder.barsElapsed >= pendingOrder.orderExpiryBars) {
              pendingOrder = null;
            }
          }
        }
      }

      // 3. Manage Open Positions
      if (openPositions.length > 0) {
        barsWithExposure++;

        for (let pIdx = openPositions.length - 1; pIdx >= 0; pIdx--) {
          const pos = openPositions[pIdx];
          const symData = universe[pos.symbol];
          const barData = symData?.map15m.get(currentTs);
          if (!barData) continue;

          pos.currentPrice = barData.close;
          if (pos.side === 'LONG' && barData.close > pos.bestClose) pos.bestClose = barData.close;
          if (pos.side === 'SHORT' && barData.close < pos.bestClose) pos.bestClose = barData.close;

          let isClosed = false;
          let exitPrice = 0;
          let exitReason = '';

          // A. Breakeven check (C1)
          if (candidateId === 'C1' && !pos.isBreakevenMoved && pos.breakevenLevel) {
            const hitBreakeven = pos.side === 'LONG' ? barData.high >= pos.breakevenLevel : barData.low <= pos.breakevenLevel;
            if (hitBreakeven) {
              pos.stopLoss = pos.breakevenStop;
              pos.isBreakevenMoved = true;
            }
          }

          // B. Trailing ATR stop & EMA20 cross exit check (C2 & R2-A)
          if ((candidateId === 'C2' || candidateId === 'R2-A') && pos.trailingAtrDistance) {
            // Update trailing stop
            if (pos.side === 'LONG') {
              const newTrail = Number((pos.bestClose - pos.trailingAtrDistance).toFixed(4));
              if (newTrail > pos.stopLoss) pos.stopLoss = newTrail;
            } else {
              const newTrail = Number((pos.bestClose + pos.trailingAtrDistance).toFixed(4));
              if (newTrail < pos.stopLoss) pos.stopLoss = newTrail;
            }

            // Check 4h EMA20 cross exit at 4h bar boundaries (C2 only)
            if (candidateId === 'C2' && currentTs % (4 * 60 * 60 * 1000) === 0) {
              const closed4h = this.getClosedBar(symData.list4h, currentTs);
              if (closed4h && closed4h.ema20) {
                if (pos.side === 'LONG' && closed4h.close < closed4h.ema20) {
                  isClosed = true;
                  exitPrice = Number((barData.close * (1 - slippageRate)).toFixed(4));
                  exitReason = '4H_EMA20_CROSS_EXIT';
                } else if (pos.side === 'SHORT' && closed4h.close > closed4h.ema20) {
                  isClosed = true;
                  exitPrice = Number((barData.close * (1 + slippageRate)).toFixed(4));
                  exitReason = '4H_EMA20_CROSS_EXIT';
                }
              }
            }
          }

          // C. Price Breaches (Stop vs TP)
          const hitLongStop = barData.low <= pos.stopLoss;
          const hitLongTp = pos.takeProfit && barData.high >= pos.takeProfit;
          const hitShortStop = barData.high >= pos.stopLoss;
          const hitShortTp = pos.takeProfit && barData.low <= pos.takeProfit;

          const isAmbiguous = (pos.side === 'LONG' && hitLongStop && hitLongTp) ||
                              (pos.side === 'SHORT' && hitShortStop && hitShortTp);

          if (!isClosed) {
            if (pos.side === 'LONG') {
              if (isAmbiguous || hitLongStop) {
                isClosed = true;
                exitPrice = Number((pos.stopLoss * (1 - slippageRate)).toFixed(4));
                exitReason = isAmbiguous ? 'STOP_LOSS_AMBIGUOUS_WORST_CASE' : (pos.isBreakevenMoved ? 'BREAKEVEN_STOP' : 'STOP_LOSS');
              } else if (hitLongTp) {
                isClosed = true;
                exitPrice = Number((pos.takeProfit * (1 - slippageRate)).toFixed(4));
                exitReason = 'TAKE_PROFIT';
              }
            } else if (pos.side === 'SHORT') {
              if (isAmbiguous || hitShortStop) {
                isClosed = true;
                exitPrice = Number((pos.stopLoss * (1 + slippageRate)).toFixed(4));
                exitReason = isAmbiguous ? 'STOP_LOSS_AMBIGUOUS_WORST_CASE' : (pos.isBreakevenMoved ? 'BREAKEVEN_STOP' : 'STOP_LOSS');
              } else if (hitShortTp) {
                isClosed = true;
                exitPrice = Number((pos.takeProfit * (1 + slippageRate)).toFixed(4));
                exitReason = 'TAKE_PROFIT';
              }
            }
          }

          if (isClosed) {
            const rawExitPrice = exitReason.includes('STOP') ? pos.stopLoss : (pos.takeProfit || barData.close);
            const exitFee = pos.quantity * exitPrice * takerFeeRate;
            const exitSlippage = Math.abs(exitPrice - rawExitPrice) * pos.quantity;
            totalFeesPaid += exitFee;
            totalSlippagePaid += exitSlippage;
            pos.exitFee = exitFee;
            pos.slippagePaid += exitSlippage;

            const grossTradePnl = (pos.side === 'LONG' ? exitPrice - pos.entryPrice : pos.entryPrice - exitPrice) * pos.quantity;
            const netTradePnl = grossTradePnl - pos.entryFee - exitFee - pos.fundingPaid;

            equity += (grossTradePnl - exitFee);

            if (netTradePnl < 0) {
              consecutiveLosses++;
              dailyLoss += Math.abs(netTradePnl);
              if (dailyLoss >= startOfDayEquity * this.maxDailyLossPercent) {
                isDailyLossLocked = true;
              }
            } else {
              consecutiveLosses = 0;
            }

            const rMultiple = pos.riskBudgetDollars > 0 ? Number((netTradePnl / pos.riskBudgetDollars).toFixed(2)) : 0;
            const roiPct = Number(((netTradePnl / (pos.entryPrice * pos.initialQuantity)) * 100).toFixed(2));

            trades.push({
              tradeId: pos.id,
              candidateId,
              symbol: pos.symbol,
              side: pos.side,
              entryTime: pos.entryTime,
              entryDate: pos.entryDate,
              exitTime: currentTs,
              exitDate: currentDate.toISOString(),
              entryPrice: pos.entryPrice,
              exitPrice,
              rawEntryPrice: pos.rawEntryPrice || pos.entryPrice,
              rawExitPrice,
              quantity: pos.quantity,
              netPnl: Number(netTradePnl.toFixed(2)),
              grossPnl: Number(grossTradePnl.toFixed(2)),
              roiPct,
              rMultiple,
              entryFee: pos.entryFee,
              exitFee,
              fundingPaid: pos.fundingPaid,
              slippagePaid: pos.slippagePaid,
              isMakerEntry: !!pos.isMakerEntry,
              isMakerExit: !!pos.isMakerExit,
              exitReason,
              equityAfter: Number(equity.toFixed(2)),
            });

            openPositions.splice(pIdx, 1);
          }
        }
      }

      // 4. Signal Scan & Generation (Strict Zero Look-Ahead)
      const consecutiveLossBlocked = consecutiveLosses >= this.maxConsecutiveLosses;
      const canScan = openPositions.length < this.maxConcurrentPositions && !pendingOrder && !isDailyLossLocked && !consecutiveLossBlocked;

      // Check current aggregate open risk
      let currentOpenRiskDollars = 0;
      for (const pos of openPositions) {
        currentOpenRiskDollars += pos.riskBudgetDollars;
      }
      const maxAggregateDollarRisk = equity * this.maxAggregateOpenRiskPercent;

      if (canScan && currentOpenRiskDollars < maxAggregateDollarRisk) {
        for (const sym of availableSymbols) {
          const symData = universe[sym];
          const barData = symData.map15m.get(currentTs);
          if (!barData || barData.index < 34) continue;

          // Check if symbol already in active positions
          if (openPositions.some(p => p.symbol === sym)) continue;

          // Check correlation group
          const group = getCorrelationGroup(sym)?.id;
          if (group && openPositions.some(p => getCorrelationGroup(p.symbol)?.id === group)) continue;

          let signal = null;

          if (candidateId === 'C1') {
            const closed1h = this.getClosedBar(symData.list1h, currentTs);
            const history15m = symData.enriched15m.slice(Math.max(0, barData.index - 10), barData.index + 1);

            signal = strategy.evaluate({
              symbol: sym,
              assetClass: symData.assetClass,
              currentTs,
              bar15m: barData,
              history15m,
              closed1h,
            });
          } else if (candidateId === 'C2' || candidateId === 'R2-A') {
            // Evaluated at 4h bar boundaries
            if (currentTs % (4 * 60 * 60 * 1000) === 0) {
              const closed4h = this.getClosedBar(symData.list4h, currentTs);
              const history4h = symData.candles4h.filter(c => c.timestamp + 4 * 60 * 60 * 1000 <= currentTs);

              signal = strategy.evaluate({
                symbol: sym,
                assetClass: symData.assetClass,
                currentTs,
                closed4h,
                history4h,
              });
            }
          } else if (candidateId === 'R2-B') {
            const closed1h = this.getClosedBar(symData.list1h, currentTs);
            signal = strategy.evaluate({
              symbol: sym,
              assetClass: symData.assetClass,
              currentTs,
              bar15m: barData,
              closed1h,
            });
          }

          if (signal) {
            const riskBudgetDollars = equity * this.riskPerTradePercent;
            const perUnitRisk = signal.stopDistance;
            const spec = getContractSpec(sym);
            const rawQty = perUnitRisk > 0 ? (riskBudgetDollars / perUnitRisk) : 0;
            const quantity = roundToStep(rawQty, spec?.minTradeNum || 0.01);

            if (quantity > 0 && (currentOpenRiskDollars + riskBudgetDollars <= maxAggregateDollarRisk + 0.01)) {
              if (signal.isMaker) {
                pendingOrder = {
                  symbol: sym,
                  side: signal.side,
                  isMaker: true,
                  limitPrice: signal.limitPrice,
                  stopLoss: signal.stopLoss,
                  takeProfit: signal.takeProfit,
                  orderExpiryBars: signal.orderExpiryBars || 4,
                  stopDistance: signal.stopDistance,
                  riskBudgetDollars,
                  quantity,
                  placedAtTs: currentTs,
                  barsElapsed: 0,
                };
              } else {
                pendingOrder = {
                  symbol: sym,
                  side: signal.side,
                  isMaker: false,
                  requestedEntryPrice: signal.entryPrice,
                  stopLoss: signal.stopLoss,
                  takeProfit: signal.takeProfit,
                  breakevenLevel: signal.breakevenLevel,
                  breakevenStop: signal.breakevenStop,
                  trailingAtrDistance: signal.trailingAtrDistance,
                  stopDistance: signal.stopDistance,
                  riskBudgetDollars,
                  quantity,
                  fillAtTs: currentTs + 15 * 60 * 1000,
                };
              }
              break;
            }
          }
        }
      }

      // Track equity curve
      if (equity > peakEquity) peakEquity = equity;
      const dd = peakEquity - equity;
      if (dd > maxDrawdownDollars) maxDrawdownDollars = dd;

      equityCurve.push({
        timestamp: currentTs,
        equity: Number(equity.toFixed(2)),
        drawdownPct: peakEquity > 0 ? Number(((dd / peakEquity) * 100).toFixed(2)) : 0,
      });
    }

    return this.calculateMetrics({
      candidateId,
      sessionMode,
      splitId,
      trades,
      equityCurve,
      dailyRecords,
      totalFeesPaid,
      totalSlippagePaid,
      totalFundingPaid,
      barsWithExposure,
      totalBars: timeline.length,
      initialEquity: this.initialEquity,
      peakEquity,
      maxDrawdownDollars,
    });
  }

  calculateMetrics(data) {
    const {
      candidateId,
      sessionMode,
      splitId,
      trades,
      equityCurve,
      dailyRecords,
      totalFeesPaid,
      totalSlippagePaid,
      totalFundingPaid,
      barsWithExposure,
      totalBars,
      initialEquity,
      peakEquity,
      maxDrawdownDollars,
    } = data;

    const wins = trades.filter(t => t.netPnl > 0);
    const losses = trades.filter(t => t.netPnl < 0);
    const winCount = wins.length;
    const lossCount = losses.length;

    const grossProfit = wins.reduce((s, t) => s + t.netPnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
    const netPnl = trades.reduce((s, t) => s + t.netPnl, 0);

    const winRate = trades.length > 0 ? Number(((winCount / trades.length) * 100).toFixed(2)) : 0;
    const profitFactor = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : (grossProfit > 0 ? 99.0 : 0);
    const totalReturnPct = Number(((netPnl / initialEquity) * 100).toFixed(2));
    const maxDrawdownPct = peakEquity > 0 ? Number(((maxDrawdownDollars / peakEquity) * 100).toFixed(2)) : 0;

    const avgWinDollars = winCount > 0 ? Number((grossProfit / winCount).toFixed(2)) : 0;
    const avgLossDollars = lossCount > 0 ? Number((grossLoss / lossCount).toFixed(2)) : 0;

    // Expectancy
    const rMultiples = trades.map(t => t.rMultiple);
    const expectancyR = trades.length > 0 ? Number((rMultiples.reduce((a, b) => a + b, 0) / trades.length).toFixed(2)) : 0;
    const roiReturns = trades.map(t => t.roiPct);
    const expectancyPct = trades.length > 0 ? Number((roiReturns.reduce((a, b) => a + b, 0) / trades.length).toFixed(2)) : 0;

    // Bootstrap 80% CI for mean trade return %
    const bootstrapCI = computeBootstrapCI(roiReturns, 1000, 0.20);

    // Turnover
    let totalNotional = 0;
    for (const t of trades) {
      totalNotional += t.entryPrice * t.quantity * 2;
    }
    const turnover = Number((totalNotional / initialEquity).toFixed(2));

    // Sharpe & Sortino from daily returns
    const dailyReturns = dailyRecords.map(d => d.returnPct);
    let annualizedSharpe = 0;
    let annualizedSortino = 0;

    if (dailyReturns.length > 5) {
      const meanRet = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
      const variance = dailyReturns.reduce((s, r) => s + Math.pow(r - meanRet, 2), 0) / (dailyReturns.length - 1);
      const stdDev = Math.sqrt(variance);

      const downDevVariance = dailyReturns.reduce((s, r) => s + Math.pow(Math.min(0, r), 2), 0) / (dailyReturns.length - 1);
      const downDev = Math.sqrt(downDevVariance);

      annualizedSharpe = stdDev > 0 ? Number(((meanRet / stdDev) * Math.sqrt(365)).toFixed(2)) : 0;
      annualizedSortino = downDev > 0 ? Number(((meanRet / downDev) * Math.sqrt(365)).toFixed(2)) : 0;
    }

    const totalCosts = totalFeesPaid + totalSlippagePaid + totalFundingPaid;
    const costsShareGross = grossProfit > 0 ? Number(((totalCosts / grossProfit) * 100).toFixed(2)) : 0;
    const exposurePct = totalBars > 0 ? Number(((barsWithExposure / totalBars) * 100).toFixed(2)) : 0;

    const isStatisticallyWeak = trades.length < 30;

    // Pass criteria evaluation
    const passNetPnl = netPnl > 0;
    const passPf = profitFactor >= 1.15;
    const passTrades = trades.length >= 30;
    const passDd = maxDrawdownPct <= 20.0;
    const isPassing = passNetPnl && passPf && passTrades && passDd;

    return {
      candidateId,
      sessionMode,
      splitId,
      tradeCount: trades.length,
      winRate,
      winCount,
      lossCount,
      netPnl: Number(netPnl.toFixed(2)),
      grossProfit: Number(grossProfit.toFixed(2)),
      grossLoss: Number(grossLoss.toFixed(2)),
      profitFactor,
      totalReturnPct,
      avgWinDollars,
      avgLossDollars,
      expectancyR,
      expectancyPct,
      bootstrapCI,
      annualizedSharpe,
      annualizedSortino,
      maxDrawdownDollars: Number(maxDrawdownDollars.toFixed(2)),
      maxDrawdownPct,
      turnover,
      totalFeesPaid: Number(totalFeesPaid.toFixed(2)),
      totalSlippagePaid: Number(totalSlippagePaid.toFixed(2)),
      totalFundingPaid: Number(totalFundingPaid.toFixed(2)),
      totalCosts: Number(totalCosts.toFixed(2)),
      costsShareGross,
      exposurePct,
      isStatisticallyWeak,
      isPassing,
      criteria: {
        passNetPnl,
        passPf,
        passTrades,
        passDd,
      },
      trades,
      equityCurve,
    };
  }

  emptyResult(candidateId, sessionMode, splitId) {
    return {
      candidateId,
      sessionMode,
      splitId,
      tradeCount: 0,
      winRate: 0,
      netPnl: 0,
      profitFactor: 0,
      totalReturnPct: 0,
      maxDrawdownPct: 0,
      annualizedSharpe: 0,
      isStatisticallyWeak: true,
      isPassing: false,
      trades: [],
      equityCurve: [],
    };
  }

  computeFixedTradeSensitivity(trades, options = {}) {
    return computeFixedTradeListSensitivity(trades, {
      baseSlippageRate: this.baseSlippageRate,
      baseTakerFeeRate: this.takerFeeRate,
      baseMakerFeeRate: this.makerFeeRate,
      ...options,
    });
  }
}

/**
 * Computes fixed-trade-list cost sensitivity across slippage/fee multipliers (e.g. x0, x1, x2).
 * On a fixed trade list, entry/exit timing and quantities are frozen, guaranteeing that
 * higher slippage strictly and monotonically degrades net trade P&L by construction.
 */
export function computeFixedTradeListSensitivity(trades, options = {}) {
  const baseSlippageRate = options.baseSlippageRate ?? 0.0002;
  const baseTakerFeeRate = options.baseTakerFeeRate ?? 0.0006;
  const baseMakerFeeRate = options.baseMakerFeeRate ?? 0.0002;
  const multipliers = options.multipliers ?? [0, 1, 2];
  const scaleFees = options.scaleFees ?? false;

  const results = {};

  for (const m of multipliers) {
    let totalGross = 0;
    let totalFees = 0;
    let totalSlippage = 0;
    let totalFunding = 0;
    let totalNet = 0;
    const repricedTrades = [];

    for (const t of trades) {
      const rawEntry = t.rawEntryPrice || (t.side === 'LONG' ? t.entryPrice / (1 + baseSlippageRate) : t.entryPrice / (1 - baseSlippageRate));
      const rawExit = t.rawExitPrice || (t.side === 'LONG' ? t.exitPrice / (1 - baseSlippageRate) : t.exitPrice / (1 + baseSlippageRate));

      const entrySlip = t.isMakerEntry ? 0 : rawEntry * baseSlippageRate * m;
      const exitSlip = t.isMakerExit ? 0 : rawExit * baseSlippageRate * m;

      const fillEntry = t.side === 'LONG' ? rawEntry + entrySlip : rawEntry - entrySlip;
      const fillExit = t.side === 'LONG' ? rawExit - exitSlip : rawExit + exitSlip;

      const entryFeeRate = t.isMakerEntry ? baseMakerFeeRate : baseTakerFeeRate;
      const exitFeeRate = t.isMakerExit ? baseMakerFeeRate : baseTakerFeeRate;

      const tradeSlippageCost = (entrySlip + exitSlip) * t.quantity;
      const feeMult = scaleFees ? m : 1;
      const tradeFees = (fillEntry * entryFeeRate + fillExit * exitFeeRate) * t.quantity * feeMult;
      const grossPnl = (t.side === 'LONG' ? fillExit - fillEntry : fillEntry - fillExit) * t.quantity;
      const funding = t.fundingPaid || 0;
      const netPnl = grossPnl - tradeFees - funding;

      totalGross += grossPnl;
      totalFees += tradeFees;
      totalSlippage += tradeSlippageCost;
      totalFunding += funding;
      totalNet += netPnl;

      repricedTrades.push({
        tradeId: t.tradeId,
        symbol: t.symbol,
        side: t.side,
        quantity: t.quantity,
        rawEntry,
        rawExit,
        fillEntry,
        fillExit,
        grossPnl: Number(grossPnl.toFixed(4)),
        fees: Number(tradeFees.toFixed(4)),
        slippage: Number(tradeSlippageCost.toFixed(4)),
        funding: Number(funding.toFixed(4)),
        netPnl: Number(netTradePnl(netPnl)),
      });
    }

    const wins = repricedTrades.filter(t => t.netPnl > 0);
    const losses = repricedTrades.filter(t => t.netPnl < 0);
    const grossProfit = wins.reduce((s, t) => s + t.netPnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
    const pf = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : (grossProfit > 0 ? 99 : 0);

    results[`x${m}`] = {
      multiplier: m,
      tradeCount: trades.length,
      netPnl: Number(totalNet.toFixed(2)),
      grossPnl: Number(totalGross.toFixed(2)),
      fees: Number(totalFees.toFixed(2)),
      slippage: Number(totalSlippage.toFixed(2)),
      funding: Number(totalFunding.toFixed(2)),
      profitFactor: pf,
      winRate: trades.length > 0 ? Number(((wins.length / trades.length) * 100).toFixed(2)) : 0,
      trades: repricedTrades,
    };
  }

  return results;
}

function netTradePnl(val) {
  return Number(val.toFixed(4));
}

