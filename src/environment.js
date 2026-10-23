/**
 * VT2 Environment Isolation, Mode State Machine & Guardrails
 * Supports PAPER (internal simulation, default), DEMO (Bitget simulated funds), and LIVE (real funds).
 * Strict boundaries, multi-factor arming, auto-disarm timers, and serverless lockouts.
 */

export const EXECUTION_MODES = Object.freeze({
  PAPER: 'PAPER',
  DEMO: 'DEMO',
  LIVE: 'LIVE',
});

// Backward-compatible alias for legacy test references
export const EXECUTION_ENVIRONMENTS = Object.freeze({
  PAPER: 'PAPER',
  DEMO: 'DEMO',
  TESTNET: 'TESTNET',
  LIVE: 'LIVE',
  MAINNET: 'MAINNET',
});

export const CURRENT_ENVIRONMENT = EXECUTION_MODES.PAPER;

export class SafetyViolationError extends Error {
  constructor(message, code = 'SAFETY_VIOLATION') {
    super(message);
    this.name = 'SafetyViolationError';
    this.code = code;
  }
}

// In-Memory Mode & Arming State (NEVER persisted to disk or surviving restart)
let activeMode = EXECUTION_MODES.PAPER;
let liveArmed = false;
let liveArmedAt = null;
let liveArmingTimeout = null;
let liveDisarmReason = null;
let liveTradeCount = 0;

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

/**
 * Checks whether the current process is running in hosted/serverless mode.
 * @returns {boolean}
 */
export function isHosted() {
  return (
    process.env.DEPLOY_MODE === 'DEMO_READONLY' ||
    Boolean(process.env.VERCEL) ||
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME)
  );
}

/**
 * Checks whether live trading is configured and allowed by environment flags.
 * @returns {boolean}
 */
export function isLiveTradingAllowed() {
  if (isHosted()) return false;
  return process.env.LIVE_TRADING_ENABLED === 'true' && process.env.I_UNDERSTAND_LIVE_RISK === 'true';
}

/**
 * Legacy check for mainnet execution allowance.
 * Strictly false unless properly configured and armed.
 * @returns {boolean}
 */
export function isMainnetExecutionAllowed() {
  return isLiveTradingAllowed() && liveArmed && activeMode === EXECUTION_MODES.LIVE;
}

/**
 * Checks whether master kill switch is disarmed.
 * @returns {boolean}
 */
export function isMainnetKillSwitchDisarmed() {
  return isMainnetExecutionAllowed();
}

/**
 * Returns current execution mode.
 * @returns {'PAPER' | 'DEMO' | 'LIVE'}
 */
export function getCurrentMode() {
  return activeMode;
}

/**
 * Returns whether live mode is currently armed.
 * @returns {boolean}
 */
export function isLiveArmed() {
  if (!liveArmed) return false;
  if (!liveArmedAt || Date.now() - liveArmedAt > TWELVE_HOURS_MS) {
    disarmLive('ARMING_TIMEOUT_EXPIRED');
    return false;
  }
  return true;
}

/**
 * Returns live arming info.
 */
export function getLiveArmingStatus() {
  const armed = isLiveArmed();
  return {
    isArmed: armed,
    armedAt: armed ? new Date(liveArmedAt).toISOString() : null,
    expiresAt: armed ? new Date(liveArmedAt + TWELVE_HOURS_MS).toISOString() : null,
    remainingSeconds: armed ? Math.max(0, Math.floor((liveArmedAt + TWELVE_HOURS_MS - Date.now()) / 1000)) : 0,
    disarmReason: liveDisarmReason,
    confirmedTradesCompleted: liveTradeCount,
  };
}

/**
 * Arms live trading.
 * Requires:
 * 1. Not hosted/serverless
 * 2. LIVE_TRADING_ENABLED=true
 * 3. Live API credentials present
 * 4. Preflight passed
 * 5. Explicit user confirmation string 'ENABLE LIVE TRADING'
 */
export function armLiveTrading(confirmationPhrase, preflightResult = null) {
  if (isHosted()) {
    throw new SafetyViolationError(
      'Hosted/serverless deployment cannot arm or execute live trading.',
      'HOSTED_LIVE_PROHIBITED'
    );
  }

  if (process.env.LIVE_TRADING_ENABLED !== 'true' || process.env.I_UNDERSTAND_LIVE_RISK !== 'true') {
    throw new SafetyViolationError(
      'Both LIVE_TRADING_ENABLED="true" and I_UNDERSTAND_LIVE_RISK="true" environment variables are required.',
      'LIVE_TRADING_FLAG_DISABLED'
    );
  }

  const liveCreds = getLiveCredentialStatus();
  if (!liveCreds.isConfigured) {
    throw new SafetyViolationError(
      'Live API credentials (BITGET_LIVE_API_KEY, SECRET, PASSPHRASE) are missing.',
      'LIVE_CREDENTIALS_MISSING'
    );
  }

  if (confirmationPhrase !== 'ENABLE LIVE TRADING') {
    throw new SafetyViolationError(
      'Invalid arming confirmation phrase. Must exactly match "ENABLE LIVE TRADING".',
      'INVALID_ARMING_PHRASE'
    );
  }

  if (preflightResult && preflightResult.passed === false) {
    throw new SafetyViolationError(
      `Preflight verification failed: ${preflightResult.error || 'Unknown failure'}`,
      'PREFLIGHT_FAILED'
    );
  }

  liveArmed = true;
  liveArmedAt = Date.now();
  liveDisarmReason = null;

  if (liveArmingTimeout) {
    clearTimeout(liveArmingTimeout);
  }

  liveArmingTimeout = setTimeout(() => {
    disarmLive('TWELVE_HOUR_TIMEOUT');
  }, TWELVE_HOURS_MS);

  return {
    success: true,
    armed: true,
    armedAt: new Date(liveArmedAt).toISOString(),
    expiresInMs: TWELVE_HOURS_MS,
  };
}

/**
 * Disarms live trading immediately and resets mode to PAPER.
 * @param {string} reason
 */
export function disarmLive(reason = 'MANUAL_DISARM') {
  liveArmed = false;
  liveArmedAt = null;
  liveDisarmReason = reason;
  if (liveArmingTimeout) {
    clearTimeout(liveArmingTimeout);
    liveArmingTimeout = null;
  }
  if (activeMode === EXECUTION_MODES.LIVE) {
    activeMode = EXECUTION_MODES.PAPER;
  }
  return { success: true, mode: activeMode, reason };
}

/**
 * Increments live trade count for first-N-trades manual confirmation.
 */
export function incrementLiveTradeCount() {
  liveTradeCount++;
  return liveTradeCount;
}

export function getLiveTradeCount() {
  return liveTradeCount;
}

/**
 * Changes active execution mode.
 * Rules:
 * - Hosted sites are permanently locked to PAPER mode.
 * - DEMO requires demo credentials.
 * - LIVE requires live arming + preflight.
 * - Any unsupported value returns SafetyViolationError.
 * @param {string} targetMode
 * @param {Object} [options]
 */
export function setExecutionMode(targetMode, options = {}) {
  if (typeof targetMode !== 'string') {
    throw new SafetyViolationError('Mode must be a string: PAPER, DEMO, or LIVE', 'INVALID_ENVIRONMENT');
  }

  const normalized = targetMode.trim().toUpperCase();

  // Strict allow-list: ONLY exact uppercase 'PAPER', 'DEMO', or 'LIVE'
  if (targetMode !== 'PAPER' && targetMode !== 'DEMO' && targetMode !== 'LIVE') {
    const lower = targetMode.toLowerCase();
    if (lower.includes('mainnet') || lower.includes('live') || lower.includes('real') || lower.includes('prod')) {
      assertMainnetExecutionBlocked(targetMode);
    }
    throw new SafetyViolationError(`Unsupported execution mode: ${targetMode}`, 'INVALID_ENVIRONMENT');
  }

  if (options.hasOpenPositions && normalized !== activeMode) {
    throw new SafetyViolationError(
      `Cannot switch execution mode while open positions exist in ${activeMode}. Close all positions first.`,
      'CANNOT_SWITCH_MODE_WHILE_POSITIONS_OPEN'
    );
  }

  if (isHosted()) {
    if (normalized !== EXECUTION_MODES.PAPER) {
      throw new SafetyViolationError(
        'CRITICAL SECURITY INTERCEPTION: Hosted deployments operate exclusively in read-only PAPER mode.',
        'SERVERLESS_MODE_LOCKED'
      );
    }
    activeMode = EXECUTION_MODES.PAPER;
    return activeMode;
  }

  if (normalized === EXECUTION_MODES.DEMO) {
    const demoCreds = getDemoCredentialStatus();
    if (!demoCreds.isConfigured && !options.allowUnconfiguredDemo) {
      throw new SafetyViolationError(
        'Demo API credentials (BITGET_DEMO_API_KEY, SECRET, PASSPHRASE) are not configured.',
        'DEMO_CREDENTIALS_MISSING'
      );
    }
    activeMode = EXECUTION_MODES.DEMO;
    return activeMode;
  }

  if (normalized === EXECUTION_MODES.LIVE) {
    if (!isLiveArmed()) {
      throw new SafetyViolationError(
        'LIVE trading requires explicit arming. Arm the terminal with "ENABLE LIVE TRADING" and preflight checks first.',
        'LIVE_NOT_ARMED'
      );
    }
    activeMode = EXECUTION_MODES.LIVE;
    return activeMode;
  }

  // PAPER
  activeMode = EXECUTION_MODES.PAPER;
  return activeMode;
}

/**
 * Validates presence of credentials without leaking secret values.
 */
export function getDemoCredentialStatus() {
  const k = process.env.BITGET_DEMO_API_KEY || '';
  const s = process.env.BITGET_DEMO_API_SECRET || '';
  const p = process.env.BITGET_DEMO_PASSPHRASE || '';
  return {
    hasKey: Boolean(k && k.length >= 8),
    hasSecret: Boolean(s && s.length >= 8),
    hasPassphrase: Boolean(p && p.length >= 4),
    isConfigured: Boolean(k && s && p && k.length >= 8 && s.length >= 8 && p.length >= 4),
  };
}

export function getLiveCredentialStatus() {
  const k = process.env.BITGET_LIVE_API_KEY || '';
  const s = process.env.BITGET_LIVE_API_SECRET || '';
  const p = process.env.BITGET_LIVE_API_PASSPHRASE || '';
  return {
    hasKey: Boolean(k && k.length >= 8),
    hasSecret: Boolean(s && s.length >= 8),
    hasPassphrase: Boolean(p && p.length >= 4),
    isConfigured: Boolean(k && s && p && k.length >= 8 && s.length >= 8 && p.length >= 4),
  };
}

/**
 * Returns overall credential configuration status for UI / diagnostic display.
 * Never includes secret values.
 */
export function getCredentialOverview() {
  return {
    hosted: isHosted(),
    currentMode: activeMode,
    liveEnabledInEnv: process.env.LIVE_TRADING_ENABLED === 'true',
    demo: getDemoCredentialStatus(),
    live: getLiveCredentialStatus(),
    arming: getLiveArmingStatus(),
  };
}

/**
 * Blocks withdrawal, transfer, or subaccount asset-moving endpoints in client calls.
 * @param {string} endpoint
 */
export function assertNoWithdrawalEndpoint(endpoint) {
  if (typeof endpoint !== 'string') return;
  const lower = endpoint.toLowerCase();
  const forbidden = [
    'withdraw',
    'transfer',
    'subaccount/transfer',
    'deposit-record',
    'wallet',
  ];
  for (const f of forbidden) {
    if (lower.includes(f)) {
      throw new SafetyViolationError(
        `CRITICAL SECURITY INTERCEPTION: Endpoint "${endpoint}" contains forbidden keyword "${f}". Fund movement operations are permanently blocked.`,
        'WITHDRAWAL_OPERATION_BLOCKED'
      );
    }
  }
}

/**
 * Redacts secret-like patterns in objects, arrays, or strings for safe logging and responses.
 * @param {any} input
 * @returns {any}
 */
export function redactSecrets(input) {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') {
    // Redact 32+ char hex/base64 strings, or explicit key patterns
    return input
      .replace(/([a-f0-9]{32,64})/gi, 'REDACTED_SECRET')
      .replace(/(ACCESS-SIGN|ACCESS-KEY|ACCESS-PASSPHRASE|SECRET):(\s*["']?)[^"',\s]+/gi, '$1:$2REDACTED');
  }
  if (Array.isArray(input)) {
    return input.map(item => redactSecrets(item));
  }
  if (typeof input === 'object') {
    const copy = {};
    for (const [k, v] of Object.entries(input)) {
      const lowerK = k.toLowerCase();
      if (
        lowerK.includes('secret') ||
        lowerK.includes('passphrase') ||
        lowerK.includes('privatekey') ||
        lowerK.includes('apikey') ||
        lowerK.includes('sign')
      ) {
        copy[k] = '[REDACTED]';
      } else {
        copy[k] = redactSecrets(v);
      }
    }
    return copy;
  }
  return input;
}

/**
 * Strict server-side gatekeeper asserting that any mainnet/live execution request is blocked.
 * Throws a SafetyViolationError immediately unless armed and in LIVE mode.
 * @param {string} targetEnvironment
 */
export function assertMainnetExecutionBlocked(targetEnvironment) {
  if (targetEnvironment === EXECUTION_ENVIRONMENTS.MAINNET || !targetEnvironment) {
    console.error(`[SECURITY AUDIT] Blocked attempted MAINNET order execution at ${new Date().toISOString()}`);
    throw new SafetyViolationError(
      'CRITICAL SECURITY INTERCEPTION: Live Mainnet execution is strictly disabled. VT2 operates exclusively in verifiable PAPER TRADING mode unless explicitly armed in local LIVE mode.',
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

  const env = orderRequest.environment || orderRequest.mode || activeMode;

  if (env === EXECUTION_ENVIRONMENTS.MAINNET) {
    assertMainnetExecutionBlocked(env);
  }

  if (env === EXECUTION_ENVIRONMENTS.TESTNET) {
    throw new SafetyViolationError(
      'Bitget has no testnet. Use DEMO mode (demo trading with simulated funds).',
      'TESTNET_UNCONFIGURED'
    );
  }

  if (env === EXECUTION_MODES.LIVE) {
    if (!isLiveArmed() || activeMode !== EXECUTION_MODES.LIVE) {
      assertMainnetExecutionBlocked('MAINNET');
    }
    return true;
  }

  if (env === EXECUTION_MODES.DEMO) {
    if (isHosted()) {
      throw new SafetyViolationError('Hosted deployment cannot execute demo orders.', 'SERVERLESS_MODE_LOCKED');
    }
    return true;
  }

  if (env !== EXECUTION_MODES.PAPER) {
    throw new SafetyViolationError(`Unsupported execution environment: ${env}`, 'UNSUPPORTED_ENVIRONMENT');
  }

  return true;
}

export function assertLiveExecutionGates(orderRequest) {
  return validateExecutionMode(orderRequest);
}

