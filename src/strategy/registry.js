/**
 * Strategy Registry
 * Immutably tracks strategy validation statuses, empirical performance metrics from
 * pre-registered trial replays, and safety disclosure banners.
 */

export const REQUIRED_VALIDATION_PHRASE = 'I UNDERSTAND THIS STRATEGY HAS NOT PASSED VALIDATION';

export const STRATEGY_REGISTRY = Object.freeze({
  S0: Object.freeze({
    id: 'S0',
    code: 'S0',
    name: 'VT2 As-Shipped Strategy (S0)',
    description: 'Multi-timeframe momentum and trend-pullback scanner with ATR targets, 0.5%-0.8% stops, and SPY macro gating.',
    status: 'UNVALIDATED: failed pre-registered replay (trial 35)',
    isValidated: false,
    trialNumber: 35,
    verdict: 'FAIL',
    conclusionStatement: 'The app as shipped has no demonstrated edge on this data.',
    metrics: Object.freeze({
      dev: Object.freeze({
        window: '2026-05-11 to 2026-09-11',
        trades: 348,
        winRate: '40.80%',
        netPnl: -154.41,
        profitFactor: 0.99,
        maxDrawdown: '19.69%',
        realizedNetRR: '1.4305:1',
      }),
      validation: Object.freeze({
        window: '2026-09-11 to 2026-10-10',
        trades: 34,
        winRate: '23.53%',
        netPnl: -647.91,
        profitFactor: 0.48,
        maxDrawdown: '25.07%',
        realizedNetRR: '1.5597:1',
      }),
    }),
    advisoryNotice: 'UNVALIDATED: failed pre-registered replay (trial 35). S0 produced -$154.41 (PF 0.99) on Dev and -$647.91 (PF 0.48) on Validation. No tested candidate demonstrated an edge after costs.',
    requiresValidationAcknowledgment: true,
  }),
});

/**
 * Returns the currently active strategy metadata and validation status.
 * @param {string} [strategyId='S0']
 * @returns {Object} Strategy metadata
 */
export function getActiveStrategy(strategyId = 'S0') {
  return STRATEGY_REGISTRY[strategyId] || STRATEGY_REGISTRY.S0;
}

/**
 * Returns the validation status text for display across the terminal.
 * @param {string} [strategyId='S0']
 * @returns {string} Status string
 */
export function getStrategyValidationStatus(strategyId = 'S0') {
  const strat = getActiveStrategy(strategyId);
  return strat.status;
}

/**
 * Returns the complete validation warning block for orders, arming dialogs, and monitors.
 * @param {string} [strategyId='S0']
 * @returns {Object} Warning block
 */
export function getValidationWarningBlock(strategyId = 'S0') {
  const strat = getActiveStrategy(strategyId);
  return {
    status: strat.status,
    isValidated: strat.isValidated,
    trial: strat.trialNumber,
    verdict: strat.verdict,
    message: strat.advisoryNotice,
    conclusion: strat.conclusionStatement,
    requiredAcknowledgment: REQUIRED_VALIDATION_PHRASE,
  };
}
