import { CURRENT_ENVIRONMENT, isMainnetExecutionAllowed } from '../environment.js';
import { isEquityContract, isCryptoContract } from '../config/contracts.js';
import { getStrategyValidationStatus, getValidationWarningBlock } from '../strategy/registry.js';

export const BOT_STATUS = Object.freeze({
  OFF: 'OFF',
  RUNNING: 'RUNNING',
  WAITING: 'WAITING',
  PAUSED: 'PAUSED',
  STOPPED: 'STOPPED',
});

/**
 * Automated Paper Trading Engine for VT2
 * Operates strictly in PAPER mode with hard security guarantees,
 * dual-market candidate walking, account-level gate priority, and de-duplicated activity logging.
 */
export class AutoTrader {
  constructor({ db, paperEngine, bitget, strategy, coordinator, monitor, sseBroadcast }) {
    this.db = db;
    this.paperEngine = paperEngine;
    this.bitget = bitget;
    this.strategy = strategy;
    this.coordinator = coordinator;
    this.monitor = monitor;
    this.sseBroadcast = sseBroadcast || (() => {});

    this.status = BOT_STATUS.OFF;
    this.pauseReason = null;
    this.waitingReason = null;
    this.waitingResumesAt = null;
    this.cycleTimer = null;
    this.cycleIntervalMs = 60000; // 1-minute cycle check

    this.activityLog = []; // array of { id, timestamp, action, symbol, details, count }
    this.tradesToday = 0;
    this.lastDailyResetUtc = new Date().getUTCDate();

    // Map of symbol -> timestamp until which it is skipped
    this.skippedSymbols = new Map();
    this.lastWaitingStateKey = null;
    this.lastExhaustedLoggedMarket = null;

    // Load persisted configuration with explicit defaults
    const persistedConfig = this.db.getSetting('auto_trader_config', {});
    this.config = {
      botMarketMode: 'stocks', // 'stocks' | 'crypto' | 'both' (default Stocks)
      botCandidateOrder: 'equities_first', // 'equities_first' | 'best_score'
      maxTradesPerDay: 3,
      maxConcurrentPositions: 1,
      minScore: 70,
      minNetRR: 1.5,
      entryAllocationPercent: 10,
      candidateSkipMinutes: 5,
      cooldownAfterManualClose: true,
      ...persistedConfig,
    };
  }

  isSymbolSkipped(symbol) {
    const skipUntil = this.skippedSymbols.get(symbol);
    return Boolean(skipUntil && Date.now() < skipUntil);
  }

  checkDailyReset() {
    const currentUtcDay = new Date().getUTCDate();
    if (currentUtcDay !== this.lastDailyResetUtc) {
      this.tradesToday = 0;
      this.lastDailyResetUtc = currentUtcDay;
      this.skippedSymbols.clear();
      this.lastExhaustedLoggedMarket = null;
      this.logActivity('DAILY_RESET', 'SYSTEM', `Daily trade count reset to 0 at 00:00 UTC boundary.`);
    }
  }

  /**
   * Logs an activity event with automatic de-duplication of consecutive identical events.
   * e.g. "SOXLUSDT rejected: COOLDOWN_ACTIVE ×17"
   */
  logActivity(action, symbol, details) {
    const symbolKey = symbol || 'PORTFOLIO';
    const last = this.activityLog[0];

    const baseDetails = details.replace(/\s*×\d+$/, '');
    const lastBaseDetails = last ? (last.details || '').replace(/\s*×\d+$/, '') : '';

    if (last && last.action === action && last.symbol === symbolKey && lastBaseDetails === baseDetails) {
      last.count = (last.count || 1) + 1;
      last.timestamp = Date.now();
      last.details = `${baseDetails} ×${last.count}`;
    } else {
      const entry = {
        id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        action,
        symbol: symbolKey,
        details: baseDetails,
        count: 1,
      };
      this.activityLog.unshift(entry);
      if (this.activityLog.length > 200) this.activityLog.pop();
    }

    this.sseBroadcast({
      type: 'AUTO_ACTIVITY_LOG',
      activity: this.activityLog[0],
      botStatus: this.status,
      waitingReason: this.waitingReason,
      tradesToday: this.tradesToday,
    });
  }

  start(userConfig = {}) {
    // Hard Security Guarantee: Refuse if environment is not strictly PAPER
    if (CURRENT_ENVIRONMENT !== 'PAPER' || isMainnetExecutionAllowed()) {
      const err = new Error('SAFETY_VIOLATION: Automated execution strictly prohibited outside simulated PAPER mode.');
      err.statusCode = 403;
      err.code = 'AUTOMATED_TRADING_MAINNET_BLOCKED';
      throw err;
    }

    this.config = { ...this.config, ...userConfig };
    this.db.saveSetting('auto_trader_config', this.config);

    this.checkDailyReset();
    this.status = BOT_STATUS.RUNNING;
    this.pauseReason = null;
    this.waitingReason = null;
    this.waitingResumesAt = null;
    this.lastWaitingStateKey = null;

    this.logActivity(
      'BOT_STARTED',
      'SYSTEM',
      `Automated trading started. Market: ${this.config.botMarketMode.toUpperCase()}, Quota: ${this.config.maxTradesPerDay}/day, Max Concurrent: ${this.config.maxConcurrentPositions}`
    );

    if (this.cycleTimer) clearInterval(this.cycleTimer);
    this.cycleTimer = setInterval(() => this.runCycle(), this.cycleIntervalMs);
    if (this.cycleTimer?.unref) this.cycleTimer.unref();

    setImmediate(() => this.runCycle());
    return this.getStatus();
  }

  stop(reason = 'MANUAL_STOP') {
    this.status = BOT_STATUS.STOPPED;
    this.pauseReason = reason;
    this.waitingReason = null;
    this.waitingResumesAt = null;
    if (this.cycleTimer) {
      clearInterval(this.cycleTimer);
      this.cycleTimer = null;
    }
    this.logActivity('BOT_STOPPED', 'SYSTEM', `Automated trading stopped. Reason: ${reason}. Open positions preserved.`);
    return this.getStatus();
  }

  stopAndCloseAll(reason = 'MANUAL_STOP_CLOSE_ALL') {
    this.stop(reason);
    const closed = this.paperEngine.closeAllPositions('AUTO_STOP_CLOSE_ALL');
    this.db.saveAccountState(this.paperEngine.getAccountSummary());
    this.logActivity('CLOSE_ALL_EXECUTED', 'PORTFOLIO', `Closed ${closed.length} open position(s) upon Stop & Close All command.`);
    return {
      status: this.status,
      closedPositionsCount: closed.length,
      closed,
    };
  }

  killSwitch() {
    this.stop('GLOBAL_KILL_SWITCH_ENGAGED');
    const closed = this.paperEngine.closeAllPositions('EMERGENCY_KILL_SWITCH');
    this.db.saveAccountState(this.paperEngine.getAccountSummary());
    this.logActivity('KILL_SWITCH_FIRED', 'EMERGENCY', `Master Kill Switch engaged. Bot halted and all positions closed immediately.`);
    return {
      status: this.status,
      killedPositionsCount: closed.length,
      account: this.paperEngine.getAccountSummary(),
    };
  }

  pause(reason) {
    this.status = BOT_STATUS.PAUSED;
    this.pauseReason = reason;
    this.waitingReason = null;
    this.waitingResumesAt = null;
    this.logActivity('BOT_PAUSED', 'SYSTEM', `Bot paused: ${reason}`);
    this.sseBroadcast({
      type: 'BOT_PAUSED',
      reason,
      status: this.status,
    });
  }

  setWaiting(reason, resumesAtTimestamp = null, stateKey = null) {
    this.status = BOT_STATUS.WAITING;
    this.waitingReason = reason;
    this.waitingResumesAt = resumesAtTimestamp;

    // Only write a new log entry when the waiting condition changes
    if (stateKey !== this.lastWaitingStateKey) {
      this.lastWaitingStateKey = stateKey;
      this.logActivity('BOT_WAITING', 'SYSTEM', `Bot waiting: ${reason}`);
    }

    this.sseBroadcast({
      type: 'BOT_WAITING',
      reason,
      resumesAt: resumesAtTimestamp,
      status: this.status,
    });
  }

  /**
   * Main autonomous trading cycle.
   * Step 1: Evaluates account-level gates first (halts and sets WAITING without candidate iteration).
   * Step 2: Walks ranked candidates for bot market mode, applying symbol-specific filters and skipping rejected symbols.
   */
  async runCycle() {
    if (this.status !== BOT_STATUS.RUNNING && this.status !== BOT_STATUS.WAITING) return;

    this.checkDailyReset();
    const acc = this.paperEngine.getAccountSummary();
    const savedSettings = this.db.getAllSettings();
    const cooldownMins = Number(savedSettings.cooldownMinutes ?? 30);
    const maxTrades = Number(this.config.maxTradesPerDay ?? 3);
    const maxConcurrent = Number(this.config.maxConcurrentPositions ?? savedSettings.maxConcurrentPositions ?? 1);

    // ==========================================
    // STEP 1: ACCOUNT-LEVEL GATES FIRST
    // ==========================================

    // 1a. Daily Loss Lockout (Hard Stop)
    if (acc.isDailyLossLocked) {
      return this.pause(`Daily loss limit reached ($${acc.dailyLoss.toFixed(2)} / $${acc.dailyLossLimit.toFixed(2)})`);
    }

    // 1b. Consecutive Losses Pause
    const maxLosses = Number(savedSettings.maxConsecutiveLosses ?? 3);
    if (acc.consecutiveLosses >= maxLosses) {
      return this.pause(`Consecutive loss limit reached (${acc.consecutiveLosses} consecutive losses)`);
    }

    // 1c. Cooldown Timer Check
    if (acc.lastTradeClosedAt) {
      const cooldownMs = cooldownMins * 60 * 1000;
      const elapsed = Date.now() - acc.lastTradeClosedAt;
      if (elapsed < cooldownMs) {
        const remainingMs = cooldownMs - elapsed;
        const minutesLeft = Math.ceil(remainingMs / 60000);
        const resumeTime = new Date(acc.lastTradeClosedAt + cooldownMs);
        const timeStr = resumeTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        this.setWaiting(
          `Cooldown active, resumes at ${timeStr} (${minutesLeft} min left)`,
          acc.lastTradeClosedAt + cooldownMs,
          `cooldown-${acc.lastTradeClosedAt}`
        );
        return; // HALT IMMEDIATELY — Do NOT iterate candidates
      }
    }

    // 1d. Daily Trade Quota Check
    if (this.tradesToday >= maxTrades) {
      return this.pause(`Daily trade quota reached (${this.tradesToday}/${maxTrades} trades today). Resets at 00:00 UTC.`);
    }

    // 1e. Max Concurrent Positions Capacity Check
    const openCount = acc.openPositionsCount ?? this.paperEngine.positions.filter(p => p.status === 'OPEN').length;
    if (openCount >= maxConcurrent) {
      this.setWaiting(
        `Max concurrent positions active (${openCount}/${maxConcurrent}). Awaiting position exit.`,
        null,
        `capacity-${openCount}`
      );
      return; // HALT IMMEDIATELY
    }

    // 1f. Exchange Feed Health Check
    if (typeof this.bitget?.checkHealth === 'function') {
      const health = await this.bitget.checkHealth();
      if (!health?.isLive && !this.bitget.forceFixtureMode) {
        return this.pause('Exchange market feed offline or unreachable');
      }
    }

    // All account gates passed — clear waiting state and restore RUNNING
    this.status = BOT_STATUS.RUNNING;
    this.waitingReason = null;
    this.waitingResumesAt = null;
    this.lastWaitingStateKey = null;

    // ==========================================
    // STEP 2: DUAL-MARKET CANDIDATE WALK
    // ==========================================
    const botMarket = this.config.botMarketMode || 'stocks';

    try {
      const liveMarkets = await this.bitget.getLiveUniverseCandles({
        forceFresh: true,
        limit: Number(savedSettings.scanUniverseSize || 30),
        marketMode: botMarket,
      });

      const scan = this.strategy.scanUniverse(liveMarkets);
      let qualified = scan.qualified || [];

      // Filter by bot market class
      if (botMarket === 'stocks') {
        qualified = qualified.filter(q => isEquityContract(q.symbol));
      } else if (botMarket === 'crypto') {
        qualified = qualified.filter(q => isCryptoContract(q.symbol));
      }

      // Filter by minScore and minNetRR
      const minScore = Number(this.config.minScore || 70);
      const minRR = Number(this.config.minNetRR || 1.5);
      let candidates = qualified.filter(q => (q.score >= minScore) && (q.rewardRisk?.netRR >= minRR));

      // In Both mode: order according to botCandidateOrder (equities first by default)
      if (botMarket === 'both') {
        if (this.config.botCandidateOrder === 'best_score') {
          candidates.sort((a, b) => b.score - a.score);
        } else {
          // Equities first, then crypto
          const equities = candidates.filter(c => isEquityContract(c.symbol)).sort((a, b) => b.score - a.score);
          const cryptos = candidates.filter(c => isCryptoContract(c.symbol)).sort((a, b) => b.score - a.score);
          candidates = [...equities, ...cryptos];
        }
      }

      if (candidates.length === 0) {
        if (this.lastExhaustedLoggedMarket !== botMarket) {
          this.lastExhaustedLoggedMarket = botMarket;
          this.logActivity('CYCLE_EVALUATED', 'SCANNER', `No qualifying setups currently in ${botMarket.toUpperCase()} market.`);
        }
        return;
      }

      const skipDurationMs = (Number(this.config.candidateSkipMinutes) || 5) * 60 * 1000;
      let slotsAvailable = maxConcurrent - openCount;
      let openedCountThisCycle = 0;

      // Walk candidates in order
      for (const candidate of candidates) {
        if (slotsAvailable <= 0 || this.tradesToday >= maxTrades) break;

        // Check if candidate is temporarily skipped
        const skipUntil = this.skippedSymbols.get(candidate.symbol);
        if (skipUntil && Date.now() < skipUntil) {
          continue;
        }

        // Run full multi-agent deliberation pipeline
        const deliberateFn = this.coordinator.deliberate || this.coordinator.deliberateSetup;
        const deliberation = await deliberateFn.call(this.coordinator, {
          proposal: candidate,
          accountState: {
            equity: acc.equity,
            startOfDayEquity: acc.startOfDayEquity,
            currentEquity: acc.currentEquity,
            openPositionsCount: openCount + openedCountThisCycle,
            consecutiveLosses: acc.consecutiveLosses,
            lastTradeClosedAt: acc.lastTradeClosedAt,
            existingOrders: this.paperEngine.orders,
            existingPositions: this.paperEngine.positions,
          },
          riskConfig: {
            entryAllocationPercent: this.config.entryAllocationPercent || 10,
            maxConcurrentPositions: maxConcurrent,
            maxAggregateOpenRiskPercent: Number(savedSettings.maxAggregateOpenRiskPercent || 1.0),
          },
        });

        if (!deliberation.isApproved || (deliberation.riskResult && deliberation.riskResult.allowed === false)) {
          const reason = deliberation.riskResult?.reason || deliberation.coordinatorReason || 'RISK_REJECTION';
          this.skippedSymbols.set(candidate.symbol, Date.now() + skipDurationMs);
          this.logActivity('CANDIDATE_SKIPPED', candidate.symbol, `${reason} (skipped ${this.config.candidateSkipMinutes || 5}m)`);

          this.db.saveRejectedSetup({
            symbol: candidate.symbol,
            rejectionReason: reason,
            explanation: `Automated candidate walk rejected: ${deliberation.coordinatorVerdict || reason}`,
            netRR: candidate.rewardRisk?.netRR,
            score: candidate.score,
            details: { deliberation },
          });

          // Move to NEXT candidate
          continue;
        }

        // Passed all gates and deliberation! Open Paper Trade
        const orderPayload = {
          symbol: candidate.symbol,
          side: candidate.side,
          entryPrice: candidate.entryPrice,
          stopLoss: candidate.stopLoss,
          takeProfit: candidate.takeProfit,
          quantity: deliberation.riskResult.quantity,
          partialTakeProfitPrice: candidate.partialTakeProfitPrice,
        };

        const result = this.paperEngine.submitOrder(orderPayload);
        if (result && result.position) {
          result.position.mode = 'AUTO';
          result.position.assetClass = isEquityContract(candidate.symbol) ? 'EQUITY' : 'CRYPTO';
          this.tradesToday += 1;
          openedCountThisCycle += 1;
          slotsAvailable -= 1;
          this.lastExhaustedLoggedMarket = null;

          this.db.saveOrder(result.order);
          this.db.savePosition(result.position);
          this.db.saveAccountState(this.paperEngine.getAccountSummary());

          this.logActivity(
            'AUTO_ENTRY_FILLED',
            candidate.symbol,
            `Entered ${candidate.side} ${deliberation.riskResult.quantity} @ $${result.order.fillPrice} (SL: $${candidate.stopLoss}, TP: $${candidate.takeProfit}). Daily trade #${this.tradesToday}`
          );
        }
      }

      if (openedCountThisCycle === 0 && candidates.length > 0) {
        if (this.lastExhaustedLoggedMarket !== botMarket) {
          this.lastExhaustedLoggedMarket = botMarket;
          this.logActivity('CYCLE_EVALUATED', 'FILTERS', `All candidates in ${botMarket.toUpperCase()} skipped due to symbol-specific risk bounds.`);
        }
      }
    } catch (err) {
      console.warn('[AutoTrader] Cycle execution error:', err.message);
      this.logActivity('CYCLE_ERROR', 'ERROR', err.message);
    }
  }

  getStatus() {
    this.checkDailyReset();
    const acc = this.paperEngine.getAccountSummary();
    const savedSettings = this.db.getAllSettings();
    return {
      status: this.status,
      strategyStatus: getStrategyValidationStatus(),
      validationWarning: getValidationWarningBlock(),
      pauseReason: this.pauseReason,
      waitingReason: this.waitingReason,
      waitingResumesAt: this.waitingResumesAt,
      tradesToday: this.tradesToday,
      maxTradesPerDay: Number(this.config.maxTradesPerDay ?? 3),
      maxConcurrentPositions: Number(this.config.maxConcurrentPositions ?? savedSettings.maxConcurrentPositions ?? 1),
      openPositionsCount: acc.openPositionsCount ?? this.paperEngine.positions.filter(p => p.status === 'OPEN').length,
      dailyLoss: acc.dailyLoss,
      dailyLossLimit: acc.dailyLossLimit,
      isDailyLossLocked: acc.isDailyLossLocked,
      config: this.config,
      recentActivity: this.activityLog.slice(0, 50),
    };
  }

  /**
   * Exports serializable state of the automated trading engine.
   * @returns {Object}
   */
  exportState() {
    return {
      status: this.status,
      pauseReason: this.pauseReason,
      waitingReason: this.waitingReason,
      waitingResumesAt: this.waitingResumesAt,
      tradesToday: this.tradesToday,
      lastDailyResetUtc: this.lastDailyResetUtc,
      activityLog: JSON.parse(JSON.stringify(this.activityLog)),
      config: { ...this.config },
      skippedSymbols: Array.from(this.skippedSymbols.entries()),
    };
  }

  /**
   * Hydrates automated trader from external state.
   * @param {Object} state
   */
  importState(state = {}) {
    if (!state || typeof state !== 'object') return;
    if (state.status !== undefined) this.status = state.status;
    if (state.pauseReason !== undefined) this.pauseReason = state.pauseReason;
    if (state.waitingReason !== undefined) this.waitingReason = state.waitingReason;
    if (state.waitingResumesAt !== undefined) this.waitingResumesAt = state.waitingResumesAt;
    if (typeof state.tradesToday === 'number') this.tradesToday = state.tradesToday;
    if (typeof state.lastDailyResetUtc === 'number') this.lastDailyResetUtc = state.lastDailyResetUtc;
    if (Array.isArray(state.activityLog)) this.activityLog = JSON.parse(JSON.stringify(state.activityLog));
    if (state.config && typeof state.config === 'object') this.config = { ...this.config, ...state.config };
    if (Array.isArray(state.skippedSymbols)) {
      this.skippedSymbols = new Map(state.skippedSymbols);
    }
  }
}
