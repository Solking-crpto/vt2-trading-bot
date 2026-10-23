import { AlphaPortfolioEngine } from '../src/backtest/alpha-portfolio-engine.js';
import fs from 'fs';

// Let's inspect the timeline and oosStartTs inside AlphaPortfolioEngine
const HEADLINE_SYMBOLS = [
  'SPYUSDT', 'QQQUSDT', 'NVDAUSDT', 'TSLAUSDT', 'AAPLUSDT',
  'MSFTUSDT', 'AMZNUSDT', 'PLTRUSDT', 'SOXLUSDT', 'SQQQUSDT',
  'MUUSDT', 'AMDUSDT', 'SNDKUSDT', 'SMCIUSDT', 'AVGOUSDT',
  'QCOMUSDT', 'WMTUSDT', 'COSTUSDT', 'RKLBUSDT',
];

// Subclass AlphaPortfolioEngine or run with accumulator
class InstrumentedEngine extends AlphaPortfolioEngine {
  runInstrumented(universeSymbols) {
    const universe = this.loadUniverseData(universeSymbols);
    const availableSymbols = Object.keys(universe);
    const allTimestampsSet = new Set();
    for (const sym of availableSymbols) {
      for (const c of universe[sym].candles15m) {
        allTimestampsSet.add(c.timestamp);
      }
    }
    const timeline = Array.from(allTimestampsSet).sort((a, b) => a - b);
    const startTs = timeline[0];
    const endTs = timeline[timeline.length - 1];
    const oosDurationMs = 30 * 24 * 60 * 60 * 1000;
    const oosStartTs = endTs - oosDurationMs;

    console.log('Start TS:', new Date(startTs).toISOString());
    console.log('End TS:', new Date(endTs).toISOString());
    console.log('OOS Start TS:', new Date(oosStartTs).toISOString());

    // We can run the original runPortfolioReplay and measure how costs accumulate
    let isFees = 0, oosFees = 0;
    let isSlip = 0, oosSlip = 0;
    let isFund = 0, oosFund = 0;

    const rules = this.config.rules;
    const takerFeeRate = rules.executionAndCosts.takerFeeRate;
    const slippageRate = rules.executionAndCosts.slippageRate;
    const fundingRate8h = 0.0001;

    let equity = this.initialEquity;
    let currentPosition = null;
    let pendingOrder = null;
    let lastTradeClosedAt = 0;
    let isDailyLossLocked = false;
    let dayStartEquity = equity;
    let currentDayStr = '';
    const trades = [];

    for (let barIdx = 0; barIdx < timeline.length; barIdx++) {
      const currentTs = timeline[barIdx];
      const currentDate = new Date(currentTs);
      const isOosBar = currentTs >= oosStartTs;

      const dayStr = currentDate.toISOString().split('T')[0];
      if (dayStr !== currentDayStr) {
        currentDayStr = dayStr;
        dayStartEquity = equity;
        isDailyLossLocked = false;
      }

      // 1. Funding
      const hours = currentDate.getUTCHours();
      const minutes = currentDate.getUTCMinutes();
      if ((hours === 0 || hours === 8 || hours === 16) && minutes === 0 && currentPosition) {
        const notional = currentPosition.quantity * currentPosition.currentPrice;
        const fundingCost = notional * fundingRate8h;
        equity -= fundingCost;
        if (isOosBar) oosFund += fundingCost;
        else isFund += fundingCost;
      }

      // 2. Pending order
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
          if (isOosBar) {
            oosFees += entryFee;
            oosSlip += slippageCost;
          } else {
            isFees += entryFee;
            isSlip += slippageCost;
          }

          currentPosition = {
            id: `trade-${trades.length + 1}`,
            symbol: pendingOrder.symbol,
            side: pendingOrder.side,
            entryPrice: fillPrice,
            quantity: pendingOrder.quantity,
            stopLoss: pendingOrder.stopLoss,
            takeProfit: pendingOrder.takeProfit,
            entryTime: currentTs,
            entryDate: currentDate.toISOString(),
            currentPrice: fillPrice,
            partialTpPrice: pendingOrder.side === 'LONG'
              ? Number((fillPrice * (1 + rules.lifecycleExits.partialTpPercent)).toFixed(4))
              : Number((fillPrice * (1 - rules.lifecycleExits.partialTpPercent)).toFixed(4)),
            isPartialClosed: false,
            realizedPnl: 0,
            entryFee: entryFee,
            partialFee: 0,
            exitFee: 0,
            fundingPaid: 0,
            slippagePaid: slippageCost,
            isOos: isOosBar,
          };
        }
        pendingOrder = null;
      }

      // 3. Update position
      if (currentPosition) {
        const symData = universe[currentPosition.symbol];
        const bar = symData?.candleMap15m.get(currentTs);
        if (bar) {
          currentPosition.currentPrice = bar.close;
          const { side, entryPrice, quantity, stopLoss, takeProfit, partialTpPrice, isPartialClosed } = currentPosition;
          let isClosed = false;
          let exitPrice = 0;
          let exitReason = '';

          if (side === 'LONG') {
            const hitLongStop = bar.low <= stopLoss;
            const hitLongTp = bar.high >= takeProfit;
            const isAmbiguous = hitLongStop && hitLongTp;

            if (isAmbiguous || hitLongStop) {
              isClosed = true;
              exitPrice = Number((stopLoss * (1 - slippageRate)).toFixed(4));
              exitReason = isAmbiguous ? 'STOP_LOSS_AMBIGUOUS_WORST_CASE' : 'STOP_LOSS';
            } else if (hitLongTp) {
              isClosed = true;
              exitPrice = Number((takeProfit * (1 - slippageRate)).toFixed(4));
              exitReason = 'TAKE_PROFIT_FINAL';
            } else if (!isPartialClosed && bar.high >= partialTpPrice) {
              const partialQty = Number((quantity * rules.lifecycleExits.partialExitRatio).toFixed(4));
              const partialExitPrice = Number((partialTpPrice * (1 - slippageRate)).toFixed(4));
              const partialSlippage = Math.abs(partialExitPrice - partialTpPrice) * partialQty;
              const partialFee = partialQty * partialExitPrice * takerFeeRate;
              const partialPnl = (partialExitPrice - entryPrice) * partialQty - partialFee;

              equity += partialPnl;
              if (isOosBar) {
                oosFees += partialFee;
                oosSlip += partialSlippage;
              } else {
                isFees += partialFee;
                isSlip += partialSlippage;
              }

              currentPosition.realizedPnl += partialPnl;
              currentPosition.partialFee = partialFee;
              currentPosition.slippagePaid += partialSlippage;
              currentPosition.quantity -= partialQty;
              currentPosition.isPartialClosed = true;
              currentPosition.stopLoss = Number((entryPrice * (1 + rules.lifecycleExits.breakevenOffset)).toFixed(4));
            }
          } else {
            const hitShortStop = bar.high >= stopLoss;
            const hitShortTp = bar.low <= takeProfit;
            const isAmbiguous = hitShortStop && hitShortTp;

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
              if (isOosBar) {
                oosFees += partialFee;
                oosSlip += partialSlippage;
              } else {
                isFees += partialFee;
                isSlip += partialSlippage;
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

            if (isOosBar) {
              oosFees += exitFee;
              oosSlip += exitSlippage;
            } else {
              isFees += exitFee;
              isSlip += exitSlippage;
            }

            const remainingPnl = (side === 'LONG' ? exitPrice - entryPrice : entryPrice - exitPrice) * currentPosition.quantity - exitFee;
            const netTradePnl = currentPosition.realizedPnl + remainingPnl - currentPosition.entryFee - currentPosition.fundingPaid;
            equity += remainingPnl;
            lastTradeClosedAt = currentTs;

            trades.push({
              id: currentPosition.id,
              isOos: currentPosition.isOos,
              netPnl: netTradePnl,
            });
            currentPosition = null;
          }
        }
      }

      // Check daily loss lock
      const dailyLoss = (dayStartEquity - equity) / dayStartEquity;
      if (dailyLoss >= rules.riskManagement.maxDailyLossPercent) {
        isDailyLossLocked = true;
      }

      // Generate signal
      if (!currentPosition && !pendingOrder && !isDailyLossLocked && (currentTs - lastTradeClosedAt >= 30 * 60 * 1000)) {
        for (const sym of universeSymbols) {
          const sData = universe[sym];
          const b15 = sData.candleMap15m.get(currentTs);
          if (!b15) continue;
          const sig = this.evaluateRules(sData, currentTs, rules);
          if (sig) {
            const riskAmt = equity * rules.riskManagement.riskPerTradePercent;
            const stopDist = Math.abs(sig.entryPrice - sig.stopLoss);
            if (stopDist > 0) {
              const qty = Number((riskAmt / stopDist).toFixed(4));
              if (qty > 0) {
                pendingOrder = {
                  symbol: sym,
                  side: sig.side,
                  quantity: qty,
                  stopLoss: sig.stopLoss,
                  takeProfit: sig.takeProfit,
                  fillAtTs: currentTs + 15 * 60 * 1000,
                };
                break;
              }
            }
          }
        }
      }
    }

    return {
      tradesCount: trades.length,
      isCount: trades.filter(t => !t.isOos).length,
      oosCount: trades.filter(t => t.isOos).length,
      isFees, oosFees,
      isSlip, oosSlip,
      isFund, oosFund,
    };
  }
}

const instEngine = new InstrumentedEngine();
const auditRes = instEngine.runInstrumented(HEADLINE_SYMBOLS);
console.log('\n=== REAL V1 IS vs OOS COST DECOMPOSITION (Split Date: 2026-09-11T15:00:00.000Z) ===');
console.log('Trades: Total =', auditRes.tradesCount, 'IS =', auditRes.isCount, 'OOS =', auditRes.oosCount);
console.log('Fees: IS = $' + auditRes.isFees.toFixed(2), 'OOS = $' + auditRes.oosFees.toFixed(2), 'Total = $' + (auditRes.isFees + auditRes.oosFees).toFixed(2));
console.log('Slippage: IS = $' + auditRes.isSlip.toFixed(2), 'OOS = $' + auditRes.oosSlip.toFixed(2), 'Total = $' + (auditRes.isSlip + auditRes.oosSlip).toFixed(2));
console.log('Funding: IS = $' + auditRes.isFund.toFixed(2), 'OOS = $' + auditRes.oosFund.toFixed(2), 'Total = $' + (auditRes.isFund + auditRes.oosFund).toFixed(2));
console.log('Total Drag: IS = $' + (auditRes.isFees + auditRes.isSlip + auditRes.isFund).toFixed(2),
  'OOS = $' + (auditRes.oosFees + auditRes.oosSlip + auditRes.oosFund).toFixed(2),
  'Total = $' + (auditRes.isFees + auditRes.oosFees + auditRes.isSlip + auditRes.oosSlip + auditRes.isFund + auditRes.oosFund).toFixed(2));
