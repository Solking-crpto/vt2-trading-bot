import fs from 'node:fs';
import path from 'node:path';
import { getProfileForSymbol } from './profiles.js';

const LIVE_LIMITS_PATH = path.resolve('config/live-limits.json');

let cachedLimits = null;

export function loadLiveLimits() {
  if (!cachedLimits) {
    if (fs.existsSync(LIVE_LIMITS_PATH)) {
      cachedLimits = JSON.parse(fs.readFileSync(LIVE_LIMITS_PATH, 'utf8'));
    } else {
      cachedLimits = {
        maxNotionalPerOrderUsd: 50,
        maxTotalOpenNotionalUsd: 100,
        maxRiskPerTradePct: 0.0025,
        maxDailyLossUsd: 10,
        maxOpenPositions: 1,
        maxLeverage: { equity: 3, crypto: 5 },
        allowedSymbols: ['BTCUSDT', 'ETHUSDT', 'SPYUSDT', 'QQQUSDT', 'NVDAUSDT', 'AAPLUSDT', 'MSFTUSDT', 'AMZNUSDT'],
        confirmFirstNTrades: 3,
        enforceStrictestWins: true,
      };
    }
  }
  return cachedLimits;
}

/**
 * Validates an order proposal against the hard live limits caps.
 * Strictest rule always wins.
 * @param {Object} order
 * @param {Object} context
 * @returns {{ allowed: boolean, error?: string, reason?: string, requiresManualConfirm?: boolean }}
 */
export function validateLiveOrderCaps(order, context = {}) {
  const limits = loadLiveLimits();
  const profile = getProfileForSymbol(order.symbol);

  // 1. Symbol Allow-list check
  const allowed = (limits.allowedSymbols || []).map(s => s.toUpperCase());
  const cleanSym = (order.symbol || '').toUpperCase().replace(/^S/, ''); // normalize demo symbol if needed
  if (!allowed.includes(cleanSym) && !allowed.includes(order.symbol)) {
    return {
      allowed: false,
      error: 'SYMBOL_NOT_ALLOWED_IN_LIVE',
      reason: `Symbol "${order.symbol}" is not on the live trading allow-list (${allowed.join(', ')})`,
    };
  }

  // 2. Order Notional Cap ($50 default)
  const price = order.entryPrice || order.price || 0;
  const qty = order.quantity || order.size || 0;
  const notional = Number((price * qty).toFixed(2));
  if (notional > limits.maxNotionalPerOrderUsd) {
    return {
      allowed: false,
      error: 'MAX_NOTIONAL_PER_ORDER_EXCEEDED',
      reason: `Order notional ($${notional}) exceeds maxNotionalPerOrderUsd cap of $${limits.maxNotionalPerOrderUsd}`,
    };
  }

  // 3. Aggregate Open Notional Cap ($100 default)
  const currentOpenNotional = context.currentOpenNotional || 0;
  const totalOpenNotional = Number((currentOpenNotional + notional).toFixed(2));
  if (totalOpenNotional > limits.maxTotalOpenNotionalUsd) {
    return {
      allowed: false,
      error: 'MAX_TOTAL_OPEN_NOTIONAL_EXCEEDED',
      reason: `Projected total open notional ($${totalOpenNotional}) exceeds maxTotalOpenNotionalUsd cap of $${limits.maxTotalOpenNotionalUsd}`,
    };
  }

  // 4. Max Open Positions Cap (1 default)
  const openPositionsCount = context.openPositionsCount || 0;
  if (openPositionsCount >= limits.maxOpenPositions) {
    return {
      allowed: false,
      error: 'MAX_OPEN_POSITIONS_EXCEEDED',
      reason: `Current open positions count (${openPositionsCount}) reaches maxOpenPositions cap of ${limits.maxOpenPositions}`,
    };
  }

  // 5. Daily Loss Cap ($10 default)
  const todayRealizedLoss = context.todayRealizedLoss || 0;
  if (todayRealizedLoss >= limits.maxDailyLossUsd) {
    return {
      allowed: false,
      error: 'MAX_DAILY_LOSS_EXCEEDED',
      reason: `Realized daily loss ($${todayRealizedLoss.toFixed(2)}) has reached maxDailyLossUsd cap of $${limits.maxDailyLossUsd}`,
    };
  }

  // 6. Max Leverage Cap
  const isCrypto = profile.assetClass === 'CRYPTO';
  const leverageCap = isCrypto ? limits.maxLeverage.crypto : limits.maxLeverage.equity;
  const requestedLeverage = order.leverage || 1;
  if (requestedLeverage > leverageCap) {
    return {
      allowed: false,
      error: 'MAX_LEVERAGE_EXCEEDED',
      reason: `Requested leverage (${requestedLeverage}x) exceeds ${profile.name} cap of ${leverageCap}x`,
    };
  }

  // 7. Manual confirmation required for first N trades
  const completedTrades = context.completedLiveTradesCount || 0;
  const requiresManualConfirm = completedTrades < limits.confirmFirstNTrades;

  return {
    allowed: true,
    requiresManualConfirm,
    remainingConfirmations: Math.max(0, limits.confirmFirstNTrades - completedTrades),
    limitsApplied: {
      maxNotional: limits.maxNotionalPerOrderUsd,
      maxTotalNotional: limits.maxTotalOpenNotionalUsd,
      maxDailyLoss: limits.maxDailyLossUsd,
      leverageCap,
    },
  };
}
