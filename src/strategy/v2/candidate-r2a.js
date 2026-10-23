import { isRegularTradingHours } from './session-filter.js';

/**
 * Candidate R2-A: 4h Donchian Breakout Trend-Follower
 *
 * Pre-registered specifications:
 * - Timeframe: 4h continuous candles
 * - Channel Lookback: 55 bars (Donchian upper/lower channel)
 * - Breakout:
 *   - LONG: 4h close > highest high of prior 55 bars
 *   - SHORT: 4h close < lowest low of prior 55 bars
 * - Initial Stop Loss: 3.0 x ATR(14) on 4h
 * - Trailing Stop: 3.0 x ATR(14) following the extreme close reached since entry
 * - Cost Gate: Stop distance in % >= 8 x round-trip cost in %
 * - Take Profit: None (pure trend following until trailing stop exit)
 */
export class CandidateR2A {
  constructor(options = {}) {
    this.id = 'R2-A';
    this.name = '4h Donchian Breakout Trend-Follower';
    this.sessionMode = options.sessionMode || 'E0'; // 'E0' (all-hours) or 'E1' (RTH)
    this.channelPeriod = options.channelPeriod || 55;
    this.initialStopAtrMult = options.initialStopAtrMult ?? 3.0;
    this.trailingStopAtrMult = options.trailingStopAtrMult ?? 3.0;
    this.costGateMultiplier = options.costGateMultiplier ?? 8.0;
    this.takerFeeRate = options.takerFeeRate ?? 0.0006;
    this.slippageRate = options.slippageRate ?? 0.0002;
  }

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
    if (!closed4h || !history4h || history4h.length < this.channelPeriod + 5) {
      return null;
    }

    if (closed4h.atr === null || closed4h.atr <= 0) {
      return null;
    }

    // 3. 55-Bar Donchian Channel on prior closed bars (excluding current bar)
    const priorBars = history4h.slice(-this.channelPeriod - 1, -1);
    if (priorBars.length < this.channelPeriod) {
      return null;
    }

    const highestHigh55 = Math.max(...priorBars.map(b => b.high));
    const lowestLow55 = Math.min(...priorBars.map(b => b.low));

    let signalSide = null;
    if (closed4h.close > highestHigh55) {
      signalSide = 'LONG';
    } else if (closed4h.close < lowestLow55) {
      signalSide = 'SHORT';
    }

    if (!signalSide) {
      return null;
    }

    // 4. Initial Stop Loss (3x ATR)
    const entryPrice = closed4h.close;
    const stopDistance = closed4h.atr * this.initialStopAtrMult;
    if (!Number.isFinite(stopDistance) || stopDistance <= 0) return null;

    const stopLoss = signalSide === 'LONG'
      ? Number((entryPrice - stopDistance).toFixed(4))
      : Number((entryPrice + stopDistance).toFixed(4));

    // 5. Cost Gate: Stop distance % >= 8 x round-trip cost %
    const roundTripCostPercent = 2 * (this.takerFeeRate + this.slippageRate);
    const minDistancePercent = roundTripCostPercent * this.costGateMultiplier;
    const actualStopDistancePercent = stopDistance / entryPrice;

    if (actualStopDistancePercent < minDistancePercent) {
      return null; // Reject: stop too narrow relative to friction
    }

    return {
      strategyId: this.id,
      symbol,
      side: signalSide,
      entryPrice,
      stopLoss,
      takeProfit: null,
      stopDistance,
      trailingAtrDistance: closed4h.atr * this.trailingStopAtrMult,
      atr: closed4h.atr,
      isMaker: false,
    };
  }
}
