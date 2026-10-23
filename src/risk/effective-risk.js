import { loadProfiles } from '../config/profiles.js';
import { loadLiveLimits } from '../config/live-limits.js';

export const RISK_PRESETS = [0.5, 1, 5, 10, 25, 50, 100];
export const DEFAULT_RISK_PERCENT = 0.5;

/**
 * Calculates position sizing and effective risk under leverage, margin, and live-limits caps.
 *
 * Sizing: size = balance * (risk% / 100) / stopDistancePercent
 * Capped so:
 *  1. Margin never exceeds 90% of balance (margin = notional / leverage <= 0.90 * balance)
 *  2. Leverage never exceeds per-asset-class cap in config/profiles.json (crypto: 5x, equity: 3x)
 *  3. In DEMO and LIVE, config/live-limits.json hard caps apply (maxNotional $50, maxRisk 0.25%)
 *
 * @param {Object} params
 * @param {number} params.balance - Account equity / balance
 * @param {number} [params.riskPercent=0.5] - Selected risk percent (e.g. 0.5, 1, 5, 10, 25, 50, 100)
 * @param {number} [params.stopDistancePercent=0.006] - Stop loss distance as decimal (e.g. 0.006 = 0.6%)
 * @param {string} [params.assetClass='crypto'] - 'crypto' or 'equity'
 * @param {number} [params.selectedLeverage] - Leverage multiplier (e.g. 1, 2, 3, 5)
 * @param {string} [params.mode='PAPER'] - 'PAPER', 'DEMO', or 'LIVE'
 * @returns {Object} Effective risk breakdown and readout
 */
export function calculateEffectiveRisk({
  balance = 10000,
  riskPercent = DEFAULT_RISK_PERCENT,
  stopDistancePercent = 0.006,
  assetClass = 'crypto',
  selectedLeverage,
  mode = 'PAPER',
} = {}) {
  const normAssetClass = (assetClass || 'crypto').toLowerCase() === 'equity' ? 'equity' : 'crypto';
  const profiles = loadProfiles();
  const profileCap = normAssetClass === 'equity' ? profiles.equity.maxLeverage : profiles.crypto.maxLeverage;

  // Selected leverage clamped to asset class profile cap
  const effectiveLeverage = Math.min(
    Math.max(1, Number(selectedLeverage) || profileCap),
    profileCap
  );

  const cleanBalance = Math.max(0, Number(balance) || 0);
  const cleanRiskPercent = Math.max(0, Number(riskPercent) || DEFAULT_RISK_PERCENT);
  const cleanStopDistance = Math.max(0.0001, Number(stopDistancePercent) || 0.006);

  // Raw theoretical target risk and unconstrained notional
  const targetRiskDollars = cleanBalance * (cleanRiskPercent / 100);
  const rawNotional = targetRiskDollars / cleanStopDistance;

  // 1. Leverage Cap (Notional <= balance * leverage)
  const maxNotionalLeverage = cleanBalance * effectiveLeverage;

  // 2. Margin Cap (Margin = notional / leverage <= 0.90 * balance => Notional <= 0.90 * balance * leverage)
  const maxNotionalMargin = 0.90 * cleanBalance * effectiveLeverage;

  let cappedNotional = rawNotional;
  let bindingCap = null;
  let boundBy = null;

  // Apply Leverage Cap check
  if (cappedNotional > maxNotionalLeverage) {
    cappedNotional = maxNotionalLeverage;
    boundBy = 'LEVERAGE';
    bindingCap = `leverage ${effectiveLeverage}x`;
  }

  // Apply Margin Cap (90% of balance)
  if (cappedNotional > maxNotionalMargin) {
    cappedNotional = maxNotionalMargin;
    boundBy = 'MARGIN';
    bindingCap = `leverage ${effectiveLeverage}x, margin 90%`;
  }

  // 3. In DEMO and LIVE: Apply config/live-limits.json hard caps
  const isDemoOrLive = mode === 'DEMO' || mode === 'LIVE';
  if (isDemoOrLive) {
    const liveLimits = loadLiveLimits();

    // Live order notional limit ($50)
    if (liveLimits?.maxNotionalPerOrderUsd && cappedNotional > liveLimits.maxNotionalPerOrderUsd) {
      cappedNotional = liveLimits.maxNotionalPerOrderUsd;
      boundBy = 'LIVE_LIMITS_NOTIONAL';
      bindingCap = `live-limits notional $${liveLimits.maxNotionalPerOrderUsd}`;
    }

    // Live max risk per trade limit (0.0025 = 0.25%)
    if (liveLimits?.maxRiskPerTradePct) {
      const liveMaxDollarRisk = cleanBalance * liveLimits.maxRiskPerTradePct;
      const liveMaxRiskNotional = liveMaxDollarRisk / cleanStopDistance;
      if (cappedNotional > liveMaxRiskNotional) {
        cappedNotional = liveMaxRiskNotional;
        boundBy = 'LIVE_LIMITS_RISK';
        bindingCap = `live-limits risk ${(liveLimits.maxRiskPerTradePct * 100).toFixed(2)}%`;
      }
    }
  }

  // Calculate effective dollar risk and effective risk percentage
  const effectiveRiskDollars = cappedNotional * cleanStopDistance;
  const effectiveRiskPercent = cleanBalance > 0
    ? Number(((effectiveRiskDollars / cleanBalance) * 100).toFixed(2))
    : 0;

  const stopPercentStr = `${(cleanStopDistance * 100).toFixed(1)}%`;

  let readout = '';
  if (cappedNotional < rawNotional - 0.001) {
    readout = `Selected ${cleanRiskPercent}% -> effective ${effectiveRiskPercent}% (capped by ${bindingCap}, stop ${stopPercentStr})`;
  } else {
    readout = `Selected ${cleanRiskPercent}% -> effective ${effectiveRiskPercent}% (uncapped, stop ${stopPercentStr})`;
  }

  return {
    selectedRiskPercent: cleanRiskPercent,
    effectiveRiskPercent,
    effectiveRiskDollars: Number(effectiveRiskDollars.toFixed(2)),
    targetRiskDollars: Number(targetRiskDollars.toFixed(2)),
    rawNotional: Number(rawNotional.toFixed(2)),
    cappedNotional: Number(cappedNotional.toFixed(2)),
    maxNotionalMargin: Number(maxNotionalMargin.toFixed(2)),
    maxNotionalLeverage: Number(maxNotionalLeverage.toFixed(2)),
    effectiveLeverage,
    profileMaxLeverage: profileCap,
    isCapped: cappedNotional < rawNotional - 0.001,
    boundBy,
    bindingCap,
    stopDistancePercent: cleanStopDistance,
    readout,
  };
}

/**
 * Validates a custom risk percentage input.
 * Clamps or rejects values that exceed logical or live caps.
 *
 * @param {number|string} val - Input risk percentage
 * @param {string} [mode='PAPER'] - Execution mode
 * @returns {{ valid: boolean, value: number, isClamped: boolean, reason?: string, requiresWarning: boolean }}
 */
export function validateCustomRisk(val, mode = 'PAPER') {
  const num = parseFloat(val);
  if (isNaN(num) || !isFinite(num) || num <= 0) {
    return {
      valid: false,
      value: DEFAULT_RISK_PERCENT,
      isClamped: true,
      reason: 'Risk percentage must be a positive number greater than 0',
      requiresWarning: false,
    };
  }

  if (mode === 'LIVE') {
    const liveLimits = loadLiveLimits();
    const liveCapPct = (liveLimits?.maxRiskPerTradePct || 0.0025) * 100;
    if (num > liveCapPct) {
      return {
        valid: false,
        value: liveCapPct,
        isClamped: true,
        reason: `LIVE mode strictly enforces config/live-limits.json cap of ${liveCapPct}% risk per trade`,
        requiresWarning: false,
      };
    }
  }

  // Maximum allowed risk is 100%
  if (num > 100) {
    return {
      valid: false,
      value: 100,
      isClamped: true,
      reason: 'Risk cannot exceed 100% of account equity',
      requiresWarning: true,
    };
  }

  return {
    valid: true,
    value: Number(num.toFixed(2)),
    isClamped: false,
    requiresWarning: num > 10,
  };
}
