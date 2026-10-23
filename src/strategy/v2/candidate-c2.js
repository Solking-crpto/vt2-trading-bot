import { isRegularTradingHours } from './session-filter.js';

/**
 * Candidate C2: 4h Breakout Trend-Follower
 *
 * Rules:
 * - 4h Regime & Breakout:
 *   - Long: 4h close > EMA50 AND 4h close > max(High of prior 20 bars) AND 4h volume >= 1.0x 20-bar SMA volume.
 *   - Short: 4h close < EMA50 AND 4h close < min(Low of prior 20 bars) AND 4h volume >= 1.0x 20-bar SMA volume.
 * - Initial Stop: 2.0 x ATR(14) on 4h.
 * - Exit Rules:
 *   - Trailing stop at 3.0 x ATR from highest close reached since entry (mirror for Short).
 *   - OR an opposite 4h close beyond EMA20 (Long: 4h close < EMA20; Short: 4h close > EMA20).
 * - Cost Gate: Stop distance in % >= 5 x round-trip cost in % (ensures substantial trend expectancy).
 * - No fixed take-profit target (lets winners run).
 */
export class CandidateC2 {
  constructor(options = {}) {
    this.id = 'C2';
    this.name = '4h Breakout Trend-Follower';
    this.sessionMode = options.sessionMode || 'E0'; // 'E0' (all-hours) or 'E1' (RTH)
    this.breakoutLookback = options.breakoutLookback || 20;
    this.stopAtrMultiplier = options.stopAtrMultiplier ?? 2.0;
    this.trailingAtrMultiplier = options.trailingAtrMultiplier ?? 3.0;
    this.costGateMultiplier = options.costGateMultiplier ?? 5.0;
    this.takerFeeRate = options.takerFeeRate ?? 0.0006;
    this.slippageRate = options.slippageRate ?? 0.0002;
  }

  /**
   * Evaluates closed 4h candle at currentTs for signal generation.
   * @param {Object} context
   * @returns {Object|null}
   */
  evaluate(context) {
    const {
      symbol,
      assetClass,
      currentTs,
      closed4h,
      history4h,
    } = context;

    // 1. Session Filter
    if (this.sessionMode === 'E1') {
      if (!isRegularTradingHours(currentTs, assetClass)) {
        return null;
      }
    }

    // 2. Data sufficiency
    if (!closed4h || !history4h || history4h.length < this.breakoutLookback + 5) {
      return null;
    }

    if (closed4h.ema50 === null || closed4h.ema20 === null || closed4h.atr === null) {
      return null;
    }

    // 3. Breakout Lookback (prior 20 bars excluding current bar)
    const priorBars = history4h.slice(-this.breakoutLookback - 1, -1);
    if (priorBars.length < this.breakoutLookback) {
      return null;
    }

    const highestHigh20 = Math.max(...priorBars.map(b => b.high));
    const lowestLow20 = Math.min(...priorBars.map(b => b.low));

    // 20-bar average volume
    const sumVol = priorBars.reduce((s, b) => s + b.volume, 0);
    const avgVol20 = sumVol / this.breakoutLookback;
    const hasVolume = avgVol20 > 0 ? (closed4h.volume >= 1.0 * avgVol20) : true;

    if (!hasVolume) {
      return null;
    }

    let signalSide = null;

    // Long breakout
    if (closed4h.close > closed4h.ema50 && closed4h.close > highestHigh20) {
      signalSide = 'LONG';
    } else if (closed4h.close < closed4h.ema50 && closed4h.close < lowestLow20) {
      signalSide = 'SHORT';
    }

    if (!signalSide) {
      return null;
    }

    // 4. Initial Stop Loss
    const entryPrice = closed4h.close;
    const stopDistance = closed4h.atr * this.stopAtrMultiplier;
    if (!Number.isFinite(stopDistance) || stopDistance <= 0) return null;

    const stopLoss = signalSide === 'LONG'
      ? Number((entryPrice - stopDistance).toFixed(4))
      : Number((entryPrice + stopDistance).toFixed(4));

    // 5. Cost Gate
    const roundTripCostPercent = 2 * this.takerFeeRate + 2 * this.slippageRate;
    const minDistancePercent = roundTripCostPercent * this.costGateMultiplier;
    const actualStopDistancePercent = stopDistance / entryPrice;

    if (actualStopDistancePercent < minDistancePercent) {
      return null; // Skip setups where ATR is too compressed relative to costs
    }

    return {
      strategyId: this.id,
      symbol,
      side: signalSide,
      entryPrice,
      stopLoss,
      takeProfit: null, // No fixed target; trailing stop & EMA cross exit
      stopDistance,
      trailingAtrDistance: closed4h.atr * this.trailingAtrMultiplier,
      atr4h: closed4h.atr,
    };
  }
}
