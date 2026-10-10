/**
 * VT2 Environment Isolation and Safety Safeguards
 * Enforces strict boundaries between PAPER, TESTNET, and MAINNET.
 * Mainnet execution is strictly prohibited and architecturally denied.
 */

export const EXECUTION_ENVIRONMENTS = Object.freeze({
  PAPER: 'PAPER',
  TESTNET: 'TESTNET',
  MAINNET: 'MAINNET',
});

export const CURRENT_ENVIRONMENT = EXECUTION_ENVIRONMENTS.PAPER;

export class SafetyViolationError extends Error {
  constructor(message, code = 'SAFETY_VIOLATION') {
    super(message);
    this.name = 'SafetyViolationError';
    this.code = code;
  }
}

/**
 * Validates that an environment string is supported.
 * @param {string} env
 * @returns {boolean}
 */
export function isValidEnvironment(env) {
  return Object.values(EXECUTION_ENVIRONMENTS).includes(env);
}

/**
 * Checks whether live mainnet execution is allowed.
 * Returns false unless master kill switch is explicitly enabled.
 * @returns {boolean}
 */
export function isMainnetExecutionAllowed() {
  return process.env.MAINNET_LIVE_ENABLED === 'true';
}

/**
 * Checks whether master kill switch is disarmed.
 * @returns {boolean}
 */
export function isMainnetKillSwitchDisarmed() {
  return process.env.MAINNET_LIVE_ENABLED === 'true';
}

/**
 * Validates deliberate user activation gates before allowing live execution.
 * @param {Object} options
 * @param {boolean} options.acknowledgedRisk
 * @param {boolean} options.confirmedRealFunds
 */
export function assertLiveExecutionGates(options = {}) {
  if (!isMainnetExecutionAllowed()) {
    throw new SafetyViolationError(
      'CRITICAL SECURITY INTERCEPTION: Live Mainnet execution is strictly disabled. Master kill switch is ACTIVE.',
      'MAINNET_EXECUTION_BLOCKED'
    );
  }

  if (!options.acknowledgedRisk || !options.confirmedRealFunds) {
    throw new SafetyViolationError(
      'LIVE ACTIVATION REJECTED: User must explicitly confirm that real capital is at risk.',
      'LIVE_ACTIVATION_ACKNOWLEDGEMENT_REQUIRED'
    );
  }
}

/**
 * Strict server-side gatekeeper asserting that any mainnet execution request is blocked.
 * Throws a SafetyViolationError immediately.
 * @param {string} targetEnvironment
 */
export function assertMainnetExecutionBlocked(targetEnvironment) {
  if (targetEnvironment === EXECUTION_ENVIRONMENTS.MAINNET || !targetEnvironment) {
    console.error(`[SECURITY AUDIT] Blocked attempted MAINNET order execution at ${new Date().toISOString()}`);
    throw new SafetyViolationError(
      'CRITICAL SECURITY INTERCEPTION: Live Mainnet execution is strictly disabled. VT2 operates exclusively in verifiable PAPER TRADING mode.',
      'MAINNET_EXECUTION_BLOCKED'
    );
  }
}

/**
 * Verifies that paper trading requests never accidentally fall through to live exchange APIs.
 * @param {Object} orderRequest
 */
export function validateExecutionMode(orderRequest) {
  if (!orderRequest || typeof orderRequest !== 'object') {
    throw new SafetyViolationError('Malformed order request', 'INVALID_ORDER_REQUEST');
  }

  const env = orderRequest.environment || EXECUTION_ENVIRONMENTS.PAPER;

  if (env === EXECUTION_ENVIRONMENTS.MAINNET) {
    assertMainnetExecutionBlocked(env);
  }

  if (env === EXECUTION_ENVIRONMENTS.TESTNET) {
    throw new SafetyViolationError(
      'Testnet execution requires verified demo API credentials and is not enabled in this paper-trading instance.',
      'TESTNET_UNCONFIGURED'
    );
  }

  if (env !== EXECUTION_ENVIRONMENTS.PAPER) {
    throw new SafetyViolationError(`Unsupported execution environment: ${env}`, 'UNSUPPORTED_ENVIRONMENT');
  }

  return true;
}
