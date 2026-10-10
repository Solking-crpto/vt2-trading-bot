/**
 * Decimal and financial precision utilities for VT2 Trading Bot
 * Avoids binary floating point rounding artifacts.
 */

/**
 * Rounds a number to a specified number of decimal places or tick/step size.
 * @param {number} value
 * @param {number} step
 * @returns {number}
 */
export function roundToStep(value, step) {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) {
    return value;
  }
  const precision = countDecimals(step);
  const factor = 10 ** precision;
  const stepped = Math.round(value / step) * step;
  return Math.round(stepped * factor) / factor;
}

/**
 * Counts the number of decimal places in a number.
 * @param {number} num
 * @returns {number}
 */
export function countDecimals(num) {
  if (!Number.isFinite(num)) return 0;
  if (Math.floor(num) === num) return 0;
  const str = num.toString();
  if (str.includes('e-')) {
    const [, exp] = str.split('e-');
    return parseInt(exp, 10);
  }
  return str.split('.')[1]?.length || 0;
}

/**
 * Formats a currency number with fixed precision.
 * @param {number} value
 * @param {number} decimals
 * @returns {string}
 */
export function formatCurrency(value, decimals = 2) {
  if (!Number.isFinite(value)) return '0.00';
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Calculates net reward-to-risk ratio accounting for round-trip fees and slippage.
 * @param {Object} params
 * @param {string} params.side - 'LONG' | 'SHORT'
 * @param {number} params.entryPrice
 * @param {number} params.takeProfit
 * @param {number} params.stopLoss
 * @param {number} [params.feeRate=0.0005] - 0.05% taker fee per side
 * @param {number} [params.slippage=0.0002] - 0.02% slippage assumption
 * @returns {{ grossRR: number, netRR: number, totalCostPercent: number }}
 */
export function calculateNetRewardRisk({
  side,
  entryPrice,
  takeProfit,
  stopLoss,
  feeRate = 0.0005,
  slippage = 0.0002,
}) {
  if (!entryPrice || !takeProfit || !stopLoss) {
    return { grossRR: 0, netRR: 0, totalCostPercent: 0 };
  }

  const roundTripCostPercent = (feeRate * 2) + (slippage * 2); // e.g. 0.14% round-trip

  let grossRewardPercent = 0;
  let riskPercent = 0;

  if (side === 'LONG') {
    grossRewardPercent = (takeProfit - entryPrice) / entryPrice;
    riskPercent = (entryPrice - stopLoss) / entryPrice;
  } else if (side === 'SHORT') {
    grossRewardPercent = (entryPrice - takeProfit) / entryPrice;
    riskPercent = (stopLoss - entryPrice) / entryPrice;
  }

  if (grossRewardPercent <= 0 || riskPercent <= 0) {
    return { grossRR: 0, netRR: 0, totalCostPercent: roundTripCostPercent };
  }

  const netRewardPercent = grossRewardPercent - roundTripCostPercent;
  const netRiskPercent = riskPercent + roundTripCostPercent;

  const grossRR = grossRewardPercent / riskPercent;
  const netRR = netRewardPercent > 0 ? (netRewardPercent / netRiskPercent) : 0;

  return {
    grossRR: Number(grossRR.toFixed(4)),
    netRR: Number(netRR.toFixed(4)),
    totalCostPercent: roundTripCostPercent,
  };
}
