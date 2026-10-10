import crypto from 'node:crypto';
import { roundToStep, countDecimals } from '../utils/decimal.js';
import { getContractSpec } from '../config/contracts.js';

export const ORDER_STATUS = Object.freeze({
  PROPOSED: 'PROPOSED',
  ACCEPTED: 'ACCEPTED',
  FILLED: 'FILLED',
  PARTIALLY_CLOSED: 'PARTIALLY_CLOSED',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
  REJECTED: 'REJECTED',
});

export const EXIT_REASON = Object.freeze({
  STOP_LOSS: 'STOP_LOSS',
  TAKE_PROFIT_PARTIAL: 'TAKE_PROFIT_PARTIAL',
  TAKE_PROFIT_FINAL: 'TAKE_PROFIT_FINAL',
  TRAILING_STOP: 'TRAILING_STOP',
  EARLY_EXIT_RSI: 'EARLY_EXIT_RSI',
  MANUAL_CLOSE: 'MANUAL_CLOSE',
  DAILY_LOSS_LOCKOUT: 'DAILY_LOSS_LOCKOUT',
});

/**
 * Paper Execution Engine
 * Manages simulated account equity, orders, positions, and automated lifecycle rules.
 */
export class PaperExecutionEngine {
  constructor(initialEquity = 10000) {
    const equity = typeof initialEquity === 'object' && initialEquity !== null
      ? (initialEquity.initialEquity ?? 10000)
      : (typeof initialEquity === 'number' ? initialEquity : 10000);
    this.initialEquity = equity;
    this.currentEquity = equity;
    this.startOfDayEquity = equity;
    this.realizedPnl = 0;
    this.totalFeesPaid = 0;
    this.consecutiveLosses = 0;
    this.lastTradeClosedAt = null;

    this.positions = []; // Active positions
    this.orders = [];    // Order history
    this.tradeHistory = []; // Closed trade journal records
  }

  /**
   * Restores persisted account state and open positions from SQLite storage.
   * Ensures that restarting the application does not reset daily loss or forget open positions.
   * @param {Object} [savedState]
   * @param {Array} [savedPositions]
   */
  restoreState(savedState, savedPositions = []) {
    if (savedState) {
      if (Number.isFinite(savedState.initialEquity)) this.initialEquity = savedState.initialEquity;
      if (Number.isFinite(savedState.startOfDayEquity)) this.startOfDayEquity = savedState.startOfDayEquity;
      if (Number.isFinite(savedState.currentEquity)) this.currentEquity = savedState.currentEquity;
      if (Number.isFinite(savedState.realizedPnl)) this.realizedPnl = savedState.realizedPnl;
      if (Number.isFinite(savedState.totalFeesPaid)) this.totalFeesPaid = savedState.totalFeesPaid;
      if (Number.isFinite(savedState.consecutiveLosses)) this.consecutiveLosses = savedState.consecutiveLosses;
      if (savedState.lastTradeClosedAt) this.lastTradeClosedAt = savedState.lastTradeClosedAt;
    }

    if (Array.isArray(savedPositions) && savedPositions.length > 0) {
      this.positions = savedPositions.map(p => ({
        id: p.id,
        orderId: p.order_id || p.orderId,
        environment: p.environment || 'PAPER',
        symbol: p.symbol,
        side: p.side,
        entryPrice: p.entry_price ?? p.entryPrice,
        currentPrice: p.current_price ?? p.currentPrice,
        originalQuantity: p.original_quantity ?? p.originalQuantity,
        currentQuantity: p.current_quantity ?? p.currentQuantity,
        stopLoss: p.stop_loss ?? p.stopLoss,
        takeProfit: p.take_profit ?? p.takeProfit,
        partialTakeProfitPrice: p.partial_take_profit_price ?? p.partialTakeProfitPrice,
        isPartialClosed: Boolean(p.is_partial_closed ?? p.isPartialClosed),
        isBreakevenMoved: Boolean(p.is_breakeven_moved ?? p.isBreakevenMoved),
        isTrailingActive: Boolean(p.is_trailing_active ?? p.isTrailingActive),
        trailingStop: p.trailing_stop ?? p.trailingStop,
        unrealizedPnl: p.unrealized_pnl ?? p.unrealizedPnl ?? 0,
        realizedPnl: p.realized_pnl ?? p.realizedPnl ?? 0,
        feesPaid: p.fees_paid ?? p.feesPaid ?? 0,
        status: p.status || 'OPEN',
        openedAt: p.opened_at ?? p.openedAt ?? Date.now(),
        lastUpdatedAt: p.last_updated_at ?? p.lastUpdatedAt ?? Date.now(),
        isSimulated: true,
      }));
    }
  }

  /**
   * Submits a paper order from an approved proposal.
   * @param {Object} proposal
   * @param {number} [timestamp=Date.now()]
   * @returns {Object} created order and position
   */
  submitOrder(proposal, timestamp = Date.now()) {
    const { symbol, side, entryPrice, stopLoss, takeProfit, quantity, partialTakeProfitPrice } = proposal;
    const contract = getContractSpec(symbol);

    const orderId = `paper-ord-${crypto.randomUUID().slice(0, 8)}`;
    const positionId = `paper-pos-${crypto.randomUUID().slice(0, 8)}`;

    const takerFeeRate = contract?.takerFeeRate ?? 0.0005;
    const slippage = contract?.baseSlippage ?? 0.0002;

    // Model realistic entry fill with slippage: long fills slightly higher, short slightly lower
    const fillPrice = side === 'LONG'
      ? Number((entryPrice * (1 + slippage)).toFixed(4))
      : Number((entryPrice * (1 - slippage)).toFixed(4));

    const notional = quantity * fillPrice;
    const entryFee = Number((notional * takerFeeRate).toFixed(4));

    this.currentEquity -= entryFee;
    this.totalFeesPaid += entryFee;

    const order = {
      id: orderId,
      positionId,
      environment: 'PAPER',
      symbol,
      side,
      requestedPrice: entryPrice,
      fillPrice,
      quantity,
      notional,
      fee: entryFee,
      status: ORDER_STATUS.FILLED,
      submittedAt: timestamp,
      filledAt: timestamp,
      isSimulated: true,
    };
    this.orders.push(order);

    const position = {
      id: positionId,
      orderId,
      environment: 'PAPER',
      symbol,
      side,
      entryPrice: fillPrice,
      currentPrice: fillPrice,
      originalQuantity: quantity,
      currentQuantity: quantity,
      stopLoss,
      takeProfit,
      partialTakeProfitPrice: partialTakeProfitPrice ?? (side === 'LONG' ? fillPrice * 1.011 : fillPrice * 0.989),
      isPartialClosed: false,
      isBreakevenMoved: false,
      isTrailingActive: false,
      trailingStop: null,
      peakRoi: 0,
      unrealizedPnl: 0,
      realizedPnl: 0,
      feesPaid: entryFee,
      status: 'OPEN',
      openedAt: timestamp,
      underlyingMarketState: proposal.underlyingMarketState || (proposal.underlyingMarketClosed ? 'CLOSED' : 'OPEN'),
      lastUpdatedAt: timestamp,
      isSimulated: true,
    };
    this.positions.push(position);

    return { order, position };
  }

  /**
   * Updates open positions with current market tick and evaluates lifecycle rules:
   * 1. Stop loss hit
   * 2. Final take profit hit
   * 3. Partial take profit (at 1.1% ROI) -> close 50% and move SL to breakeven + costs
   * 4. Trailing stop (after 10% ROI) -> follow 5m EMA 20 with ATR buffer
   * 5. Early exit RSI check
   *
   * @param {Object} tick - { symbol, price, timestamp, ema20_5m, atr_5m, rsi_15m }
   * @returns {Array<Object>} events generated
   */
  updateMarketTick(tick) {
    const { symbol, price, timestamp = Date.now(), ema20_5m, atr_5m, rsi_15m } = tick;
    const events = [];

    for (let i = this.positions.length - 1; i >= 0; i--) {
      const pos = this.positions[i];
      if (pos.symbol !== symbol || pos.status !== 'OPEN') continue;

      pos.currentPrice = price;
      pos.lastUpdatedAt = timestamp;

      const contract = getContractSpec(symbol);
      const takerFeeRate = contract?.takerFeeRate ?? 0.0005;
      const slippage = contract?.baseSlippage ?? 0.0002;

      // Calculate current ROI and unrealized P&L
      const priceDiff = pos.side === 'LONG' ? (price - pos.entryPrice) : (pos.entryPrice - price);
      pos.unrealizedPnl = Number((priceDiff * pos.currentQuantity).toFixed(4));
      const currentRoi = priceDiff / pos.entryPrice;
      if (currentRoi > pos.peakRoi) {
        pos.peakRoi = currentRoi;
      }

      // 1. Check Stop Loss trigger (including trailing stop if active)
      const activeStop = pos.isTrailingActive && pos.trailingStop ? pos.trailingStop : pos.stopLoss;
      const isStopHit = pos.side === 'LONG' ? price <= activeStop : price >= activeStop;

      if (isStopHit) {
        const exitPrice = pos.side === 'LONG'
          ? Number((activeStop * (1 - slippage)).toFixed(4))
          : Number((activeStop * (1 + slippage)).toFixed(4));
        const exitNotional = pos.currentQuantity * exitPrice;
        const exitFee = Number((exitNotional * takerFeeRate).toFixed(4));
        const tradePnl = Number(((pos.side === 'LONG' ? exitPrice - pos.entryPrice : pos.entryPrice - exitPrice) * pos.currentQuantity - exitFee).toFixed(4));

        pos.status = 'CLOSED';
        pos.realizedPnl += tradePnl;
        pos.feesPaid += exitFee;
        pos.closedAt = timestamp;
        pos.exitReason = pos.isTrailingActive ? EXIT_REASON.TRAILING_STOP : EXIT_REASON.STOP_LOSS;
        pos.exitPrice = exitPrice;

        this.currentEquity += tradePnl;
        this.realizedPnl += tradePnl;
        this.totalFeesPaid += exitFee;
        this.lastTradeClosedAt = timestamp;

        if (pos.realizedPnl < 0) {
          this.consecutiveLosses += 1;
        } else {
          this.consecutiveLosses = 0;
        }

        this.tradeHistory.push({ ...pos });
        this.positions.splice(i, 1);

        events.push({
          type: 'POSITION_CLOSED',
          reason: pos.exitReason,
          positionId: pos.id,
          exitPrice,
          pnl: tradePnl,
          equity: this.currentEquity,
        });
        continue;
      }

      // 2. Check Final Take Profit
      const isFinalTpHit = pos.side === 'LONG' ? price >= pos.takeProfit : price <= pos.takeProfit;
      if (isFinalTpHit) {
        const exitPrice = pos.side === 'LONG'
          ? Number((pos.takeProfit * (1 - slippage)).toFixed(4))
          : Number((pos.takeProfit * (1 + slippage)).toFixed(4));
        const exitNotional = pos.currentQuantity * exitPrice;
        const exitFee = Number((exitNotional * takerFeeRate).toFixed(4));
        const tradePnl = Number(((pos.side === 'LONG' ? exitPrice - pos.entryPrice : pos.entryPrice - exitPrice) * pos.currentQuantity - exitFee).toFixed(4));

        pos.status = 'CLOSED';
        pos.realizedPnl += tradePnl;
        pos.feesPaid += exitFee;
        pos.closedAt = timestamp;
        pos.exitReason = EXIT_REASON.TAKE_PROFIT_FINAL;
        pos.exitPrice = exitPrice;

        this.currentEquity += tradePnl;
        this.realizedPnl += tradePnl;
        this.totalFeesPaid += exitFee;
        this.consecutiveLosses = 0;
        this.lastTradeClosedAt = timestamp;

        this.tradeHistory.push({ ...pos });
        this.positions.splice(i, 1);

        events.push({
          type: 'POSITION_CLOSED',
          reason: EXIT_REASON.TAKE_PROFIT_FINAL,
          positionId: pos.id,
          exitPrice,
          pnl: tradePnl,
          equity: this.currentEquity,
        });
        continue;
      }

      // 3. Check Partial Take Profit (at 1.1% ROI)
      const isPartialTpHit = !pos.isPartialClosed && (
        pos.side === 'LONG' ? price >= pos.partialTakeProfitPrice : price <= pos.partialTakeProfitPrice
      );

      if (isPartialTpHit) {
        const closedQty = contract?.stepSize
          ? roundToStep(pos.currentQuantity * 0.5, contract.stepSize)
          : Number((pos.currentQuantity * 0.5).toFixed(4));

        const exitPrice = pos.side === 'LONG'
          ? Number((pos.partialTakeProfitPrice * (1 - slippage)).toFixed(4))
          : Number((pos.partialTakeProfitPrice * (1 + slippage)).toFixed(4));

        const partialNotional = closedQty * exitPrice;
        const partialFee = Number((partialNotional * takerFeeRate).toFixed(4));
        const partialPnl = Number(((pos.side === 'LONG' ? exitPrice - pos.entryPrice : pos.entryPrice - exitPrice) * closedQty - partialFee).toFixed(4));

        pos.currentQuantity -= closedQty;
        pos.isPartialClosed = true;
        pos.realizedPnl += partialPnl;
        pos.feesPaid += partialFee;

        this.currentEquity += partialPnl;
        this.realizedPnl += partialPnl;
        this.totalFeesPaid += partialFee;

        // Move remaining Stop Loss to Breakeven + modeled round-trip costs (0.14%)
        const roundTripCostPct = (takerFeeRate * 2) + (slippage * 2);
        pos.stopLoss = pos.side === 'LONG'
          ? Number((pos.entryPrice * (1 + roundTripCostPct)).toFixed(4))
          : Number((pos.entryPrice * (1 - roundTripCostPct)).toFixed(4));
        pos.isBreakevenMoved = true;

        events.push({
          type: 'PARTIAL_TAKE_PROFIT_EXECUTED',
          positionId: pos.id,
          closedQuantity: closedQty,
          remainingQuantity: pos.currentQuantity,
          partialPnl,
          newStopLoss: pos.stopLoss,
        });
      }

      // 4. Check Trailing Stop Activation (after 10% ROI)
      if (currentRoi >= 0.10 && ema20_5m && atr_5m) {
        pos.isTrailingActive = true;
        const buffer = atr_5m * 0.5;
        const proposedTrailing = pos.side === 'LONG'
          ? Number((ema20_5m - buffer).toFixed(4))
          : Number((ema20_5m + buffer).toFixed(4));

        if (pos.side === 'LONG') {
          pos.trailingStop = pos.trailingStop ? Math.max(pos.trailingStop, proposedTrailing) : proposedTrailing;
        } else {
          pos.trailingStop = pos.trailingStop ? Math.min(pos.trailingStop, proposedTrailing) : proposedTrailing;
        }

        events.push({
          type: 'TRAILING_STOP_UPDATED',
          positionId: pos.id,
          trailingStop: pos.trailingStop,
        });
      }

      // 5. Early Exit RSI Check
      if (rsi_15m !== undefined) {
        const isRsiViolation = (pos.side === 'LONG' && rsi_15m < 45) || (pos.side === 'SHORT' && rsi_15m > 55);
        if (isRsiViolation && currentRoi > 0.005) { // Protect gains if momentum reverses
          const exitPrice = pos.side === 'LONG'
            ? Number((price * (1 - slippage)).toFixed(4))
            : Number((price * (1 + slippage)).toFixed(4));
          const exitNotional = pos.currentQuantity * exitPrice;
          const exitFee = Number((exitNotional * takerFeeRate).toFixed(4));
          const tradePnl = Number(((pos.side === 'LONG' ? exitPrice - pos.entryPrice : pos.entryPrice - exitPrice) * pos.currentQuantity - exitFee).toFixed(4));

          pos.status = 'CLOSED';
          pos.realizedPnl += tradePnl;
          pos.feesPaid += exitFee;
          pos.closedAt = timestamp;
          pos.exitReason = EXIT_REASON.EARLY_EXIT_RSI;
          pos.exitPrice = exitPrice;

          this.currentEquity += tradePnl;
          this.realizedPnl += tradePnl;
          this.totalFeesPaid += exitFee;
          this.lastTradeClosedAt = timestamp;

          this.tradeHistory.push({ ...pos });
          this.positions.splice(i, 1);

          events.push({
            type: 'POSITION_CLOSED',
            reason: EXIT_REASON.EARLY_EXIT_RSI,
            positionId: pos.id,
            exitPrice,
            pnl: tradePnl,
            equity: this.currentEquity,
          });
          continue;
        }
      }
    }

    return events;
  }

  /**
   * Closes an active position at a specified or current price.
   * @param {string} positionId
   * @param {number} [exitPrice]
   * @param {string} [exitReason='MANUAL_CLOSE']
   * @param {number} [timestamp=Date.now()]
   */
  closePosition(positionId, exitPrice = null, exitReason = 'MANUAL_CLOSE', timestamp = Date.now()) {
    const posIndex = this.positions.findIndex(p => p.id === positionId);
    if (posIndex === -1) return null;

    const pos = this.positions[posIndex];
    const contract = getContractSpec(pos.symbol);
    const takerFeeRate = contract?.takerFeeRate ?? 0.0005;
    const slippage = contract?.baseSlippage ?? 0.0002;

    const actualExitPrice = exitPrice !== null ? exitPrice : (
      pos.side === 'LONG'
        ? Number((pos.currentPrice * (1 - slippage)).toFixed(4))
        : Number((pos.currentPrice * (1 + slippage)).toFixed(4))
    );

    const exitNotional = pos.currentQuantity * actualExitPrice;
    const exitFee = Number((exitNotional * takerFeeRate).toFixed(4));
    const tradePnl = Number(((pos.side === 'LONG' ? actualExitPrice - pos.entryPrice : pos.entryPrice - actualExitPrice) * pos.currentQuantity - exitFee).toFixed(4));

    pos.status = 'CLOSED';
    pos.realizedPnl += tradePnl;
    pos.feesPaid += exitFee;
    pos.closedAt = timestamp;
    pos.exitReason = exitReason;
    pos.exitPrice = actualExitPrice;

    this.currentEquity += tradePnl;
    this.realizedPnl += tradePnl;
    this.totalFeesPaid += exitFee;

    if (tradePnl < 0) {
      this.consecutiveLosses += 1;
    } else {
      this.consecutiveLosses = 0;
    }
    this.lastTradeClosedAt = timestamp;

    const closedPos = {
      ...pos,
      id: pos.id,
      positionId: pos.id,
      symbol: pos.symbol,
      type: 'POSITION_CLOSED',
      exitReason,
      exitPrice: actualExitPrice,
      pnl: tradePnl,
      equity: this.currentEquity,
    };

    this.tradeHistory.push(closedPos);
    this.positions.splice(posIndex, 1);

    return closedPos;
  }

  /**
   * Closes all active open paper positions.
   * @param {string} [exitReason='MANUAL_CLOSE_ALL']
   */
  closeAllPositions(exitReason = 'MANUAL_CLOSE_ALL') {
    const results = [];
    while (this.positions.length > 0) {
      const pos = this.positions[0];
      const res = this.closePosition(pos.id, pos.currentPrice, exitReason);
      if (res) results.push(res);
    }
    return results;
  }

  /**
   * Returns current account balance and risk summary.
   */
  getAccountSummary() {
    let totalUnrealizedPnl = 0;
    let totalExposureNotional = 0;

    for (const pos of this.positions) {
      totalUnrealizedPnl += pos.unrealizedPnl;
      totalExposureNotional += pos.currentQuantity * pos.currentPrice;
    }

    const equity = Number((this.currentEquity + totalUnrealizedPnl).toFixed(2));
    const dailyLoss = Math.max(0, this.startOfDayEquity - equity);

    return {
      environment: 'PAPER',
      initialEquity: this.initialEquity,
      startOfDayEquity: this.startOfDayEquity,
      currentEquity: Number(this.currentEquity.toFixed(2)),
      equity,
      unrealizedPnl: Number(totalUnrealizedPnl.toFixed(2)),
      realizedPnl: Number(this.realizedPnl.toFixed(2)),
      dailyLoss: Number(dailyLoss.toFixed(2)),
      dailyLossLimit: Number((this.startOfDayEquity * 0.02).toFixed(2)),
      isDailyLossLocked: dailyLoss >= (this.startOfDayEquity * 0.02),
      consecutiveLosses: this.consecutiveLosses,
      openPositionsCount: this.positions.length,
      totalExposureNotional: Number(totalExposureNotional.toFixed(2)),
      totalFeesPaid: Number(this.totalFeesPaid.toFixed(2)),
      lastTradeClosedAt: this.lastTradeClosedAt,
      isSimulated: true,
    };
  }
}
