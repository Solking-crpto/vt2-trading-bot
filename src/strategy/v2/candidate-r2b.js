import { isRegularTradingHours } from './session-filter.js';

/**
 * Candidate R2-B: 15m Pullback in 1h Trend (Maker-Only Execution)
 *
 * Pre-registered specifications:
 * - Timeframe: 15m pullback in 1h trend regime
 * - 1h Trend Regime:
 *   - BULLISH: 1h EMA20 > EMA50 && 1h close > EMA50
 *   - BEARISH: 1h EMA20 < EMA50 && 1h close < EMA50
 * - Pullback Setup:
 *   - In Bullish trend: place Buy Limit order at 15m EMA20
 *   - In Bearish trend: place Sell Limit order at 15m EMA20
 * - Execution:
 *   - Maker-only: 0 slippage on entry, maker fee applied (0.02%)
 *   - Through-tick fill: bar must trade strictly through limit price
 *   - Expiration: cancels after 4 bars (1 hour) if unfilled
 * - Risk & Exit:
 *   - Initial Stop: 2.0 x ATR(14)
 *   - Take Profit: 3.0 x Stop Distance (3R target)
 *   - Cost Gate: Stop distance in % >= 8 x round-trip cost in %
 */
export class CandidateR2B {
  constructor(options = {}) {
    this.id = 'R2-B';
    this.name = '15m Pullback in 1h Trend (Maker-Only)';
    this.sessionMode = options.sessionMode || 'E0'; // 'E0' (all-hours) or 'E1' (RTH)
    this.initialStopAtrMult = options.initialStopAtrMult ?? 2.0;
    this.targetRewardRisk = options.targetRewardRisk ?? 3.0;
    this.costGateMultiplier = options.costGateMultiplier ?? 8.0;
    this.makerFeeRate = options.makerFeeRate ?? 0.0002;
    this.takerFeeRate = options.takerFeeRate ?? 0.0006;
    this.slippageRate = options.slippageRate ?? 0.0002;
    this.orderExpiryBars = 4;
  }

  evaluate(context) {
    const {
      symbol,
      assetClass,
      currentTs,
      bar15m,
      closed1h,
    } = context;

    // 1. Session Filter
    if (this.sessionMode === 'E1') {
      if (!isRegularTradingHours(currentTs, assetClass)) {
        return null;
      }
    }

    // 2. Data sufficiency
    if (!bar15m || !closed1h) return null;
    if (bar15m.ema20 === null || bar15m.atr === null || bar15m.atr <= 0) return null;
    if (closed1h.ema20 === null || closed1h.ema50 === null) return null;

    // 3. 1h Trend Regime
    const isBullish1h = closed1h.ema20 > closed1h.ema50 && closed1h.close > closed1h.ema50;
    const isBearish1h = closed1h.ema20 < closed1h.ema50 && closed1h.close < closed1h.ema50;

    let signalSide = null;
    if (isBullish1h && bar15m.close >= bar15m.ema20) {
      signalSide = 'LONG';
    } else if (isBearish1h && bar15m.close <= bar15m.ema20) {
      signalSide = 'SHORT';
    }

    if (!signalSide) return null;

    // 4. Maker Limit Order at 15m EMA20
    const limitPrice = Number(bar15m.ema20.toFixed(4));
    const stopDistance = bar15m.atr * this.initialStopAtrMult;
    if (!Number.isFinite(stopDistance) || stopDistance <= 0) return null;

    const stopLoss = signalSide === 'LONG'
      ? Number((limitPrice - stopDistance).toFixed(4))
      : Number((limitPrice + stopDistance).toFixed(4));

    const takeProfitDistance = stopDistance * this.targetRewardRisk;
    const takeProfit = signalSide === 'LONG'
      ? Number((limitPrice + takeProfitDistance).toFixed(4))
      : Number((limitPrice - takeProfitDistance).toFixed(4));

    // 5. Cost Gate: Stop distance % >= 8 x round-trip cost %
    // Maker entry (0.02% fee, 0 slippage) + taker stop exit (0.06% fee + 0.02% slippage)
    const roundTripCostPercent = this.makerFeeRate + this.takerFeeRate + this.slippageRate;
    const minDistancePercent = roundTripCostPercent * this.costGateMultiplier;
    const actualStopDistancePercent = stopDistance / limitPrice;

    if (actualStopDistancePercent < minDistancePercent) {
      return null; // Reject: stop too narrow relative to friction
    }

    return {
      strategyId: this.id,
      symbol,
      side: signalSide,
      isMaker: true,
      limitPrice,
      stopLoss,
      takeProfit,
      stopDistance,
      orderExpiryBars: this.orderExpiryBars,
      atr: bar15m.atr,
    };
  }
}
