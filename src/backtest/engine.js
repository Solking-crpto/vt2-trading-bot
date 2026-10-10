import { computeIndicators } from '../indicators/index.js';
import { calculateNetRewardRisk, roundToStep } from '../utils/decimal.js';
import { getContractSpec } from '../config/contracts.js';

export const DEFAULT_BACKTEST_CONFIG = Object.freeze({
  initialEquity: 10000,
  riskPerTrade: 0.005, // 0.5%
  minNetRewardRisk: 1.5,
  takerFeeRate: 0.0005,
  slippageRate: 0.0002,
  fundingRate8h: 0.0001,
  partialTakeProfitPercent: 0.011,
  partialExitRatio: 0.5,
  trailingStopRoiThreshold: 0.10,
});

/**
 * Backtesting Engine for VT2
 * Chronological walk-forward simulator with strict zero look-ahead bias.
 * Conservatively assumes stop loss is touched first in ambiguous candles.
 */
export class BacktestEngine {
  constructor(config = DEFAULT_BACKTEST_CONFIG) {
    this.config = { ...DEFAULT_BACKTEST_CONFIG, ...config };
  }

  /**
   * Runs walk-forward backtest on chronological candle array.
   * @param {Object} params
   * @param {string} params.symbol
   * @param {Array} params.candles - chronological OHLCV candles
   * @param {Object} [params.customConfig]
   * @returns {Object} backtest report
   */
  run({ symbol, candles, customConfig = {} }) {
    const config = { ...this.config, ...customConfig };
    const contract = getContractSpec(symbol);

    if (!Array.isArray(candles) || candles.length < 50) {
      throw new Error(`Insufficient candle history for backtesting (${candles?.length || 0} candles)`);
    }

    let equity = config.initialEquity;
    let peakEquity = equity;
    let maxDrawdownUsd = 0;
    let maxDrawdownPercent = 0;

    const trades = [];
    let currentPosition = null;
    let consecutiveLosses = 0;
    let maxConsecutiveLosses = 0;
    let totalFees = 0;

    const minWarmup = 35; // candles needed to compute initial EMA / ATR / RSI

    for (let i = minWarmup; i < candles.length; i++) {
      const currentCandle = candles[i];
      const slice = candles.slice(0, i + 1); // Only historical data up to this point
      const ind = computeIndicators(slice);

      // 1. Manage open position if exists
      if (currentPosition) {
        const { side, entryPrice, stopLoss, takeProfit, quantity, partialTpPrice, isPartialClosed } = currentPosition;
        let isClosed = false;
        let exitPrice = 0;
        let exitReason = '';

        // Check ambiguous candle (both high and low breach stop and TP)
        const hitLongStop = currentCandle.low <= stopLoss;
        const hitLongTp = currentCandle.high >= takeProfit;
        const hitShortStop = currentCandle.high >= stopLoss;
        const hitShortTp = currentCandle.low <= takeProfit;

        const isAmbiguous = (side === 'LONG' && hitLongStop && hitLongTp) ||
                            (side === 'SHORT' && hitShortStop && hitShortTp);

        if (side === 'LONG') {
          if (isAmbiguous || hitLongStop) {
            // Worst-case conservative assumption: stop loss hit first
            isClosed = true;
            exitPrice = Number((stopLoss * (1 - config.slippageRate)).toFixed(4));
            exitReason = isAmbiguous ? 'STOP_LOSS_AMBIGUOUS_WORST_CASE' : 'STOP_LOSS';
          } else if (hitLongTp) {
            isClosed = true;
            exitPrice = Number((takeProfit * (1 - config.slippageRate)).toFixed(4));
            exitReason = 'TAKE_PROFIT_FINAL';
          } else if (!isPartialClosed && currentCandle.high >= partialTpPrice) {
            // Partial exit at +1.1%
            const partialQty = Number((quantity * config.partialExitRatio).toFixed(4));
            const partialExitPrice = Number((partialTpPrice * (1 - config.slippageRate)).toFixed(4));
            const partialFee = partialQty * partialExitPrice * config.takerFeeRate;
            const partialPnl = (partialExitPrice - entryPrice) * partialQty - partialFee;

            equity += partialPnl;
            totalFees += partialFee;
            currentPosition.realizedPnl += partialPnl;
            currentPosition.quantity -= partialQty;
            currentPosition.isPartialClosed = true;
            // Move stop to breakeven + costs
            currentPosition.stopLoss = Number((entryPrice * (1 + 0.0014)).toFixed(4));
          }
        } else if (side === 'SHORT') {
          if (isAmbiguous || hitShortStop) {
            isClosed = true;
            exitPrice = Number((stopLoss * (1 + config.slippageRate)).toFixed(4));
            exitReason = isAmbiguous ? 'STOP_LOSS_AMBIGUOUS_WORST_CASE' : 'STOP_LOSS';
          } else if (hitShortTp) {
            isClosed = true;
            exitPrice = Number((takeProfit * (1 + config.slippageRate)).toFixed(4));
            exitReason = 'TAKE_PROFIT_FINAL';
          } else if (!isPartialClosed && currentCandle.low <= partialTpPrice) {
            const partialQty = Number((quantity * config.partialExitRatio).toFixed(4));
            const partialExitPrice = Number((partialTpPrice * (1 + config.slippageRate)).toFixed(4));
            const partialFee = partialQty * partialExitPrice * config.takerFeeRate;
            const partialPnl = (entryPrice - partialExitPrice) * partialQty - partialFee;

            equity += partialPnl;
            totalFees += partialFee;
            currentPosition.realizedPnl += partialPnl;
            currentPosition.quantity -= partialQty;
            currentPosition.isPartialClosed = true;
            currentPosition.stopLoss = Number((entryPrice * (1 - 0.0014)).toFixed(4));
          }
        }

        if (isClosed) {
          const exitFee = currentPosition.quantity * exitPrice * config.takerFeeRate;
          const remainingPnl = (side === 'LONG' ? exitPrice - entryPrice : entryPrice - exitPrice) * currentPosition.quantity - exitFee;
          const totalTradePnl = currentPosition.realizedPnl + remainingPnl;

          equity += remainingPnl;
          totalFees += exitFee;

          trades.push({
            tradeNumber: trades.length + 1,
            symbol,
            side,
            entryPrice,
            exitPrice,
            entryTime: currentPosition.entryTime,
            exitTime: currentCandle.timestamp,
            holdingTimeMs: currentCandle.timestamp - currentPosition.entryTime,
            pnl: Number(totalTradePnl.toFixed(2)),
            roiPercent: Number(((totalTradePnl / (entryPrice * currentPosition.initialQuantity)) * 100).toFixed(2)),
            exitReason,
            equityAfterTrade: Number(equity.toFixed(2)),
          });

          if (totalTradePnl < 0) {
            consecutiveLosses++;
            if (consecutiveLosses > maxConsecutiveLosses) {
              maxConsecutiveLosses = consecutiveLosses;
            }
          } else {
            consecutiveLosses = 0;
          }

          currentPosition = null;
        }

        // Drawdown tracking
        if (equity > peakEquity) peakEquity = equity;
        const currentDdUsd = peakEquity - equity;
        const currentDdPct = (currentDdUsd / peakEquity) * 100;
        if (currentDdUsd > maxDrawdownUsd) maxDrawdownUsd = currentDdUsd;
        if (currentDdPct > maxDrawdownPercent) maxDrawdownPercent = currentDdPct;
      }

      // 2. Evaluate new entry if no active position
      if (!currentPosition && i < candles.length - 1) {
        const c = currentCandle.close;
        const ema20 = ind.current.ema20;
        const ema50 = ind.current.ema50;
        const atr = ind.current.atr;
        const rsi = ind.current.rsi;

        if (ema20 && ema50 && atr && rsi) {
          let side = null;
          if (c > ema20 && ema20 > ema50 && rsi > 52 && rsi < 68) {
            side = 'LONG';
          } else if (c < ema20 && ema20 < ema50 && rsi < 48 && rsi > 32) {
            side = 'SHORT';
          }

          if (side) {
            const entryPrice = side === 'LONG'
              ? Number((c * (1 + config.slippageRate)).toFixed(4))
              : Number((c * (1 - config.slippageRate)).toFixed(4));

            const stopDistance = Math.max(c * 0.005, Math.min(c * 0.008, atr * 1.0));
            const stopLoss = side === 'LONG' ? Number((c - stopDistance).toFixed(4)) : Number((c + stopDistance).toFixed(4));

            const targetDistance = Math.max(stopDistance * 2.2, Math.min(c * 0.035, atr * 2.2));
            const takeProfit = side === 'LONG' ? Number((c + targetDistance).toFixed(4)) : Number((c - targetDistance).toFixed(4));

            const rr = calculateNetRewardRisk({
              side,
              entryPrice,
              takeProfit,
              stopLoss,
              feeRate: config.takerFeeRate,
              slippage: config.slippageRate,
            });

            if (rr.netRR >= config.minNetRewardRisk) {
              const riskAmount = equity * config.riskPerTrade;
              const rawQuantity = riskAmount / stopDistance;
              const quantity = contract?.stepSize
                ? roundToStep(rawQuantity, contract.stepSize)
                : Number(rawQuantity.toFixed(4));

              const entryFee = quantity * entryPrice * config.takerFeeRate;
              equity -= entryFee;
              totalFees += entryFee;

              currentPosition = {
                side,
                entryPrice,
                stopLoss,
                takeProfit,
                partialTpPrice: side === 'LONG' ? Number((c * 1.011).toFixed(4)) : Number((c * 0.989).toFixed(4)),
                initialQuantity: quantity,
                quantity,
                entryTime: currentCandle.timestamp,
                isPartialClosed: false,
                realizedPnl: -entryFee,
              };
            }
          }
        }
      }
    }

    // Performance analytics calculation
    const totalTrades = trades.length;
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);

    const winCount = wins.length;
    const lossCount = losses.length;
    const winRate = totalTrades > 0 ? Number(((winCount / totalTrades) * 100).toFixed(2)) : 0;

    const totalGrossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
    const totalGrossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
    const netPnl = Number((equity - config.initialEquity).toFixed(2));
    const profitFactor = totalGrossLoss > 0 ? Number((totalGrossProfit / totalGrossLoss).toFixed(2)) : (totalGrossProfit > 0 ? 999 : 0);

    const avgWin = winCount > 0 ? totalGrossProfit / winCount : 0;
    const avgLoss = lossCount > 0 ? totalGrossLoss / lossCount : 0;
    const expectancy = totalTrades > 0 ? Number((((winRate / 100) * avgWin) - ((lossCount / totalTrades) * avgLoss)).toFixed(2)) : 0;

    const totalHoldingTime = trades.reduce((sum, t) => sum + t.holdingTimeMs, 0);
    const avgHoldingTimeMs = totalTrades > 0 ? Math.round(totalHoldingTime / totalTrades) : 0;

    return {
      symbol,
      periodCandles: candles.length,
      initialEquity: config.initialEquity,
      finalEquity: Number(equity.toFixed(2)),
      netPnl,
      totalTrades,
      winCount,
      lossCount,
      winRate,
      profitFactor,
      maxDrawdownPercent: Number(maxDrawdownPercent.toFixed(2)),
      maxDrawdownUsd: Number(maxDrawdownUsd.toFixed(2)),
      expectancy,
      maxConsecutiveLosses,
      avgHoldingTimeMs,
      totalFees: Number(totalFees.toFixed(2)),
      trades,
      disclaimers: [
        'Historical simulation strictly avoids look-ahead bias.',
        'Ambiguous candles where both stop and target were breached assume worst-case stop loss first.',
        'Past performance does not guarantee future results.',
      ],
    };
  }
}
