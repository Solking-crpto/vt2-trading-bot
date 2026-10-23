import { isRegularTradingHours } from './session-filter.js';

/**
 * Candidate C1: Trend Pullback (1h Trend, 15m Entry)
 *
 * Rules:
 * - 1h Trend: Long when 1h close > EMA50 AND 1h EMA20 > EMA50 (mirror for short).
 * - 15m Entry Trigger: 15m close crosses back above EMA20 after at least one 15m close below it
 *   within the last 6 bars (mirror for short).
 * - Stop Loss: 1.5 x ATR(14) on 15m.
 * - Take Profit: Fixed 2.5R target.
 * - Breakeven Stop: Move stop to breakeven + 0.05% once price reaches +1.0R.
 * - Cost Gate: Skip if target distance in % < 5 x round-trip cost in % (5 x 0.16% = 0.80%).
 */
export class CandidateC1 {
  constructor(options = {}) {
    this.id = 'C1';
    this.name = 'Trend Pullback (1h Trend, 15m Entry)';
    this.sessionMode = options.sessionMode || 'E0'; // 'E0' (all-hours) or 'E1' (RTH)
    this.stopAtrMultiplier = options.stopAtrMultiplier ?? 1.5;
    this.targetRMultiple = options.targetRMultiple ?? 2.5;
    this.breakevenRMultiple = options.breakevenRMultiple ?? 1.0;
    this.breakevenOffset = options.breakevenOffset ?? 0.0005;
    this.costGateMultiplier = options.costGateMultiplier ?? 5.0;
    this.takerFeeRate = options.takerFeeRate ?? 0.0006;
    this.slippageRate = options.slippageRate ?? 0.0002;
  }

  /**
   * Evaluates bar at currentTs for signal generation.
   * @param {Object} context
   * @returns {Object|null} signal specification or null
   */
  evaluate(context) {
    const {
      symbol,
      assetClass,
      currentTs,
      bar15m,
      history15m,
      closed1h,
    } = context;

    // 1. Session Filter Check
    if (this.sessionMode === 'E1') {
      if (!isRegularTradingHours(currentTs, assetClass)) {
        return null;
      }
    }

    // 2. Ensure enough data
    if (!bar15m || !closed1h || !history15m || history15m.length < 10) {
      return null;
    }

    if (closed1h.ema20 === null || closed1h.ema50 === null || bar15m.ema20 === null || bar15m.atr === null) {
      return null;
    }

    // 3. 1h Trend Filter
    const isBullish1h = closed1h.close > closed1h.ema50 && closed1h.ema20 > closed1h.ema50;
    const isBearish1h = closed1h.close < closed1h.ema50 && closed1h.ema20 < closed1h.ema50;

    if (!isBullish1h && !isBearish1h) {
      return null;
    }

    // 4. 15m Pullback Trigger Check (last 6 bars)
    // Long trigger: current close > EMA20 AND at least one of prior 6 closes was < EMA20
    // Short trigger: current close < EMA20 AND at least one of prior 6 closes was > EMA20
    const recentBars = history15m.slice(-7, -1); // 6 prior bars
    if (recentBars.length < 6) return null;

    let signalSide = null;

    if (isBullish1h) {
      const currentAbove = bar15m.close > bar15m.ema20;
      const hadBelow = recentBars.some(b => b.close < b.ema20);
      if (currentAbove && hadBelow) {
        signalSide = 'LONG';
      }
    } else if (isBearish1h) {
      const currentBelow = bar15m.close < bar15m.ema20;
      const hadAbove = recentBars.some(b => b.close > b.ema20);
      if (currentBelow && hadAbove) {
        signalSide = 'SHORT';
      }
    }

    if (!signalSide) return null;

    // 5. Compute Stop Loss & Target
    const entryPrice = bar15m.close;
    const stopDistance = bar15m.atr * this.stopAtrMultiplier;
    if (!Number.isFinite(stopDistance) || stopDistance <= 0) return null;

    const stopLoss = signalSide === 'LONG'
      ? Number((entryPrice - stopDistance).toFixed(4))
      : Number((entryPrice + stopDistance).toFixed(4));

    const targetDistance = stopDistance * this.targetRMultiple;
    const takeProfit = signalSide === 'LONG'
      ? Number((entryPrice + targetDistance).toFixed(4))
      : Number((entryPrice - targetDistance).toFixed(4));

    // 6. Cost Gate
    // Round-trip cost = 2 x taker fee + 2 x slippage
    const roundTripCostPercent = 2 * this.takerFeeRate + 2 * this.slippageRate;
    const minTargetDistancePercent = roundTripCostPercent * this.costGateMultiplier;
    const actualTargetDistancePercent = targetDistance / entryPrice;

    if (actualTargetDistancePercent < minTargetDistancePercent) {
      return null; // Target too small to overcome trading friction
    }

    // Breakeven target level (+1.0R)
    const beLevel = signalSide === 'LONG'
      ? entryPrice + stopDistance * this.breakevenRMultiple
      : entryPrice - stopDistance * this.breakevenRMultiple;

    return {
      strategyId: this.id,
      symbol,
      side: signalSide,
      entryPrice,
      stopLoss,
      takeProfit,
      stopDistance,
      targetDistance,
      breakevenLevel: Number(beLevel.toFixed(4)),
      breakevenStop: signalSide === 'LONG'
        ? Number((entryPrice * (1 + this.breakevenOffset)).toFixed(4))
        : Number((entryPrice * (1 - this.breakevenOffset)).toFixed(4)),
    };
  }
}
