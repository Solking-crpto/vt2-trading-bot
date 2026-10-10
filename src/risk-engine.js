import { roundToStep, calculateNetRewardRisk } from './utils/decimal.js';
import { getContractSpec, isEligibleContract, getCorrelationGroup } from './config/contracts.js';

export const DEFAULT_RISK_CONFIG = Object.freeze({
  riskPerTrade: 0.005, // 0.5% default paper risk
  maxDailyLoss: 0.02,  // 2% SOD equity limit
  minNetRewardRisk: 1.5, // 1.5 net R:R target
  maxConsecutiveLosses: 3, // pause after 3 losses
  maxOpenPositions: 1, // initially 1 open position
  maxConcurrentPositions: 1, // configurable 1-5 (default 1)
  maxAggregateOpenRiskPercent: 0.01, // 1.0% aggregate equity risk cap (hard max 2.0%)
  correlationGuard: 'warn', // 'warn' | 'reject' | 'off'
  equityEntriesWhenUnderlyingClosed: 'ALLOW_WITH_WARNING', // 'ALLOW_WITH_WARNING' | 'BLOCK'
  cooldownPeriodMs: 30 * 60 * 1000, // 30 minutes
  maxSignalAgeMs: 10 * 60 * 1000, // 10 minutes
  minStopDistancePercent: 0.005, // 0.5% min stop distance
  maxStopDistancePercent: 0.008, // 0.8% upper-bound research constraint
  takerFeeRate: 0.0005, // 0.05%
  slippageRate: 0.0002, // 0.02%
  entryAllocationPercent: 100, // 100% default unconstrained allocation ceiling
});

/**
 * Deterministic Risk Engine for VT2
 * Evaluates trade proposals and returns strict, deterministic approval or rejection.
 *
 * @param {Object} input
 * @param {string} input.side - 'LONG' | 'SHORT'
 * @param {number} input.entryPrice
 * @param {number} input.stopLoss
 * @param {number} input.equity
 * @param {number} input.startOfDayEquity
 * @param {number} input.currentEquity
 * @param {number} [input.takeProfit]
 * @param {string} [input.symbol]
 * @param {number} [input.timestamp]
 * @param {number} [input.consecutiveLosses]
 * @param {number} [input.openPositionsCount]
 * @param {number} [input.lastTradeClosedAt]
 * @param {Array}  [input.existingOrders]
 * @param {boolean} [input.enforceResearchConstraints=false]
 * @param {Object} [config=DEFAULT_RISK_CONFIG]
 * @returns {Object} evaluation result
 */
export function evaluatePaperTrade(input, userConfig = DEFAULT_RISK_CONFIG) {
  if (!input || typeof input !== 'object') {
    return { allowed: false, reason: 'INVALID_INPUT' };
  }

  const config = { ...DEFAULT_RISK_CONFIG, ...userConfig };

  const {
    side,
    entryPrice,
    stopLoss,
    equity,
    startOfDayEquity,
    currentEquity,
    takeProfit,
    symbol,
    timestamp,
    consecutiveLosses = 0,
    openPositionsCount = 0,
    lastTradeClosedAt,
    existingOrders = [],
    enforceResearchConstraints = false,
  } = input;

  // 1. Direction validation
  if (!['LONG', 'SHORT'].includes(side)) {
    return { allowed: false, reason: 'INVALID_SIDE' };
  }

  // 2. Base positive finite values validation
  const positiveValues = [
    entryPrice,
    stopLoss,
    equity,
    startOfDayEquity,
    currentEquity,
    config.riskPerTrade,
    config.maxDailyLoss,
  ];

  if (!positiveValues.every(
    value => typeof value === 'number' && Number.isFinite(value) && value > 0
  )) {
    return { allowed: false, reason: 'INVALID_INPUT' };
  }

  // 3. Risk configuration limits
  if (config.riskPerTrade > 0.01 || config.maxDailyLoss > 0.02) {
    return { allowed: false, reason: 'RISK_CONFIG_EXCEEDS_LIMIT' };
  }

  // 3b. Entry allocation percentage validation (1% to 100%)
  const allocationPercent = input.entryAllocationPercent !== undefined
    ? input.entryAllocationPercent
    : (input.entrySizePercent !== undefined
      ? input.entrySizePercent
      : (config.entryAllocationPercent !== undefined ? config.entryAllocationPercent : (config.entrySizePercent !== undefined ? config.entrySizePercent : 100)));
  if (
    typeof allocationPercent !== 'number' ||
    !Number.isFinite(allocationPercent) ||
    allocationPercent < 1 ||
    allocationPercent > 100
  ) {
    return {
      allowed: false,
      reason: 'INVALID_ENTRY_ALLOCATION',
      details: `Entry allocation percentage must be between 1% and 100% (received: ${allocationPercent})`,
    };
  }

  // 4. Directional stop placement
  if (side === 'LONG' && stopLoss >= entryPrice) {
    return { allowed: false, reason: 'INVALID_STOP_LOSS' };
  }
  if (side === 'SHORT' && stopLoss <= entryPrice) {
    return { allowed: false, reason: 'INVALID_STOP_LOSS' };
  }

  // 5. Daily loss lockout check
  const dailyLoss = Math.max(0, startOfDayEquity - currentEquity);
  const dailyLossLimit = startOfDayEquity * config.maxDailyLoss;

  if (dailyLoss >= dailyLossLimit) {
    return { allowed: false, reason: 'DAILY_LOSS_LIMIT_REACHED' };
  }

  // 6. Consecutive loss pause check
  const maxConsecutive = config.maxConsecutiveLosses ?? 3;
  if (consecutiveLosses >= maxConsecutive) {
    return {
      allowed: false,
      reason: 'CONSECUTIVE_LOSS_PAUSE',
      details: `${consecutiveLosses} consecutive losses reached maximum of ${maxConsecutive}`,
    };
  }

  // 7. Max concurrent open positions check (1-5, default 1)
  const maxOpen = Math.min(5, Math.max(1, config.maxConcurrentPositions ?? (config.maxOpenPositions ?? 1)));
  const openPositionsList = Array.isArray(input.openPositions)
    ? input.openPositions
    : (Array.isArray(input.existingPositions) ? input.existingPositions : []);
  const activePositions = openPositionsList.filter(p => p.status === 'OPEN' || !p.status);
  const currentOpenCount = activePositions.length > 0 ? activePositions.length : openPositionsCount;

  if (currentOpenCount >= maxOpen) {
    return {
      allowed: false,
      reason: 'MAX_OPEN_POSITIONS_EXCEEDED',
      details: `${currentOpenCount} open positions active (max allowed: ${maxOpen})`,
    };
  }

  // 7b. Symbol uniqueness guard (No two positions in the same symbol by default)
  if (symbol && activePositions.some(p => p.symbol === symbol)) {
    return {
      allowed: false,
      reason: 'DUPLICATE_SYMBOL_POSITION',
      details: `An open position already exists for ${symbol}. Simultaneous positions in the same symbol are disabled.`,
    };
  }

  // 7c. Correlation group & Leveraged/Inverse product exposure guard
  const correlationGroup = symbol ? getCorrelationGroup(symbol) : null;
  if (correlationGroup && activePositions.length > 0) {
    const proposedInst = correlationGroup.instrumentInfo;
    const proposedNetDirection = proposedInst.direction === 'SHORT'
      ? (side === 'LONG' ? 'BEARISH' : 'BULLISH')
      : (side === 'LONG' ? 'BULLISH' : 'BEARISH');

    for (const pos of activePositions) {
      const posGroup = getCorrelationGroup(pos.symbol);
      if (posGroup && posGroup.groupId === correlationGroup.groupId) {
        const posInst = posGroup.instrumentInfo;
        const posNetDirection = posInst.direction === 'SHORT'
          ? (pos.side === 'LONG' ? 'BEARISH' : 'BULLISH')
          : (pos.side === 'LONG' ? 'BULLISH' : 'BEARISH');

        if (posNetDirection !== proposedNetDirection) {
          return {
            allowed: false,
            reason: 'CORRELATED_OPPOSITE_EXPOSURE',
            details: `Conflicting opposite exposure in correlation group ${correlationGroup.groupId}: Existing position on ${pos.symbol} is ${posNetDirection} while proposed ${side} on ${symbol} is ${proposedNetDirection}.`,
            correlationGroup: correlationGroup.groupId,
            conflictingSymbol: pos.symbol,
          };
        }
      }
    }
  }

  // Calculate existing open risk in dollars across active positions
  let existingOpenRiskDollars = 0;
  for (const pos of activePositions) {
    const pEntry = Number(pos.entryPrice || pos.entry_price || 0);
    const pStop = Number(pos.stopLoss || pos.stop_loss || 0);
    const pQty = Number(pos.currentQuantity || pos.current_quantity || pos.quantity || 0);
    if (pEntry > 0 && pStop > 0 && pQty > 0) {
      existingOpenRiskDollars += Math.abs(pEntry - pStop) * pQty;
    }
  }

  // 8. Cooldown check
  if (lastTradeClosedAt && timestamp) {
    const cooldownPeriod = config.cooldownPeriodMs ?? 30 * 60 * 1000;
    const elapsedSinceClose = timestamp - lastTradeClosedAt;
    if (elapsedSinceClose < cooldownPeriod) {
      const remainingMs = cooldownPeriod - elapsedSinceClose;
      return {
        allowed: false,
        reason: 'COOLDOWN_ACTIVE',
        remainingSeconds: Math.ceil(remainingMs / 1000),
      };
    }
  }

  // 9. Signal freshness check
  if (timestamp) {
    const currentEvaluationTime = input.currentTime ?? Date.now();
    const maxSignalAge = config.maxSignalAgeMs ?? 10 * 60 * 1000;
    if (Math.abs(currentEvaluationTime - timestamp) > maxSignalAge) {
      return {
        allowed: false,
        reason: 'SIGNAL_EXPIRED',
        ageMinutes: Math.round(Math.abs(currentEvaluationTime - timestamp) / 60000),
      };
    }
  }

  // 10. Duplicate order check
  if (symbol && Array.isArray(existingOrders) && existingOrders.length > 0) {
    const duplicate = existingOrders.find(
      o => o.symbol === symbol && o.side === side && (o.status === 'PENDING' || o.status === 'OPEN')
    );
    if (duplicate) {
      return {
        allowed: false,
        reason: 'DUPLICATE_ORDER_DETECTED',
        existingOrderId: duplicate.id,
      };
    }
  }

  // 11. Instrument eligibility check (if symbol provided)
  let contractSpec = null;
  if (symbol) {
    if (!isEligibleContract(symbol)) {
      return {
        allowed: false,
        reason: 'INELIGIBLE_INSTRUMENT',
        symbol,
      };
    }
    contractSpec = getContractSpec(symbol);
    if (input.sessionStatus === 'STALE/CLOSED' || (contractSpec && contractSpec.sessionStatus === 'STALE/CLOSED') || (contractSpec && contractSpec.isActive === false)) {
      return {
        allowed: false,
        reason: 'SESSION_STALE_OR_CLOSED',
        details: `Trading session for ${symbol} is stale or closed. Entries blocked.`,
        symbol,
      };
    }
  }

  // 11b. Underlying market session gating for tokenized US equities
  const warnings = [];
  if (contractSpec && contractSpec.assetClass === 'EQUITY') {
    const isUnderlyingClosed = Boolean(input.underlyingMarketClosed ?? input.underlyingClosed);
    if (isUnderlyingClosed) {
      const policy = config.equityEntriesWhenUnderlyingClosed || 'ALLOW_WITH_WARNING';
      if (policy === 'BLOCK') {
        return {
          allowed: false,
          reason: 'UNDERLYING_MARKET_CLOSED',
          details: `Order rejected: Underlying US stock market is currently closed and equityEntriesWhenUnderlyingClosed is set to BLOCK.`,
          symbol,
          underlyingMarketClosed: true,
        };
      } else {
        warnings.push(`Warning: Underlying US market is closed (weekend/holiday/overnight). Order permitted under ALLOW_WITH_WARNING policy.`);
      }
    }
  }

  // 12. Stop distance constraints
  const stopDistance = Math.abs(entryPrice - stopLoss);
  const stopDistancePercent = stopDistance / entryPrice;

  if (enforceResearchConstraints) {
    const minDistance = config.minStopDistancePercent ?? 0.005;
    const maxDistance = config.maxStopDistancePercent ?? 0.008;

    if (stopDistancePercent < minDistance) {
      return {
        allowed: false,
        reason: 'STOP_TOO_CLOSE',
        details: `Stop distance ${(stopDistancePercent * 100).toFixed(2)}% is below research minimum ${(minDistance * 100).toFixed(2)}%`,
      };
    }
    if (stopDistancePercent > maxDistance) {
      return {
        allowed: false,
        reason: 'STOP_TOO_FAR',
        details: `Stop distance ${(stopDistancePercent * 100).toFixed(2)}% exceeds research maximum ${(maxDistance * 100).toFixed(2)}%`,
      };
    }
  }

  // 13. Net Reward-to-Risk check (if takeProfit provided)
  let rrMetrics = null;
  if (takeProfit !== undefined) {
    if (typeof takeProfit !== 'number' || !Number.isFinite(takeProfit) || takeProfit <= 0) {
      return { allowed: false, reason: 'INVALID_TAKE_PROFIT' };
    }
    if (side === 'LONG' && takeProfit <= entryPrice) {
      return { allowed: false, reason: 'INVALID_TAKE_PROFIT_DIRECTION' };
    }
    if (side === 'SHORT' && takeProfit >= entryPrice) {
      return { allowed: false, reason: 'INVALID_TAKE_PROFIT_DIRECTION' };
    }

    const feeRate = contractSpec?.takerFeeRate ?? config.takerFeeRate ?? 0.0005;
    const slippage = contractSpec?.baseSlippage ?? config.slippageRate ?? 0.0002;

    rrMetrics = calculateNetRewardRisk({
      side,
      entryPrice,
      takeProfit,
      stopLoss,
      feeRate,
      slippage,
    });

    const minNetRR = config.minNetRewardRisk ?? 1.5;
    if (rrMetrics.netRR < minNetRR) {
      return {
        allowed: false,
        reason: 'INSUFFICIENT_NET_REWARD_RISK',
        netRR: rrMetrics.netRR,
        grossRR: rrMetrics.grossRR,
        requiredNetRR: minNetRR,
      };
    }
  }

  // 14. Position sizing calculation
  // Entry allocation percentage scales the portion of trading allocation used (1% to 100%).
  // Note: Risk per trade remains strictly governed by config.riskPerTrade (0.5% default).
  // 100% entry allocation uses 100% of the standard risk-budgeted allocation;
  // it is NEVER interpreted as risking 100% of account equity.
  const allocationFactor = allocationPercent / 100;
  const maxRiskAmount = equity * config.riskPerTrade;
  const riskAmount = maxRiskAmount * allocationFactor;

  // 14b. Aggregate open-risk cap check (default 1.0% equity, hard max 2.0%)
  const maxAggregateRiskPercent = Math.min(0.02, Number(config.maxAggregateOpenRiskPercent) || 0.01);
  const maxAggregateDollarRisk = equity * maxAggregateRiskPercent;
  const totalOpenRiskDollars = existingOpenRiskDollars + riskAmount;

  if (totalOpenRiskDollars > maxAggregateDollarRisk + 0.001) {
    return {
      allowed: false,
      reason: 'AGGREGATE_OPEN_RISK_EXCEEDED',
      details: `Proposed total open risk ($${totalOpenRiskDollars.toFixed(2)}, ${(totalOpenRiskDollars / equity * 100).toFixed(2)}%) exceeds aggregate open-risk cap of ${(maxAggregateRiskPercent * 100).toFixed(2)}% ($${maxAggregateDollarRisk.toFixed(2)})`,
      existingOpenRiskDollars,
      proposedRiskDollars: riskAmount,
      maxAggregateDollarRisk,
    };
  }

  // 14c. Directional correlation guard
  const correlationGuard = config.correlationGuard || 'warn';
  if (correlationGuard !== 'off' && activePositions.length > 0 && input.isBtcCorrelated) {
    const hasCorrelatedExposure = activePositions.some(p => p.side === side && p.symbol !== symbol);
    if (hasCorrelatedExposure) {
      if (correlationGuard === 'reject') {
        return {
          allowed: false,
          reason: 'CORRELATION_GUARD_REJECTION',
          details: `Setup rejected: high correlation with existing open ${side} exposure while market is trend-correlated.`,
        };
      } else {
        warnings.push(`Market correlation alert: adding second ${side} position with correlated directional exposure.`);
      }
    }
  }

  const riskPerUnit = stopDistance;
  let rawQuantity = riskAmount / riskPerUnit;

  if (
    !Number.isFinite(rawQuantity) ||
    rawQuantity <= 0 ||
    !Number.isFinite(rawQuantity * entryPrice)
  ) {
    return { allowed: false, reason: 'INVALID_POSITION_SIZE' };
  }

  // Step size & contract precision adjustment
  let quantity = rawQuantity;
  if (contractSpec?.stepSize) {
    quantity = roundToStep(rawQuantity, contractSpec.stepSize);
    if (contractSpec.minOrderQty && quantity < contractSpec.minOrderQty) {
      return {
        allowed: false,
        reason: 'ORDER_QUANTITY_BELOW_MINIMUM',
        quantity,
        minOrderQty: contractSpec.minOrderQty,
      };
    }
  }

  const estimatedNotional = quantity * entryPrice;

  // Notional constraints
  if (contractSpec?.minNotional && estimatedNotional < contractSpec.minNotional) {
    return {
      allowed: false,
      reason: 'NOTIONAL_BELOW_MINIMUM',
      estimatedNotional,
      minNotional: contractSpec.minNotional,
    };
  }

  return {
    allowed: true,
    reason: 'RISK_CHECKS_PASSED',
    riskAmount,
    riskPerUnit,
    quantity,
    estimatedNotional,
    entryAllocationPercent: allocationPercent,
    allocatedTradingEquity: equity * allocationFactor,
    maxEquityRiskPercent: Number((config.riskPerTrade * 100).toFixed(2)),
    actualEquityRiskPercent: Number(((riskAmount / equity) * 100).toFixed(4)),
    maxConcurrentPositions: maxOpen,
    existingOpenRiskDollars,
    totalOpenRiskDollars,
    maxAggregateRiskPercent,
    warnings,
    dailyLoss,
    dailyLossLimit,
    stopDistancePercent,
    rewardRisk: rrMetrics,
  };
}
