import { evaluatePaperTrade } from '../risk-engine.js';
import { getContractSpec, isEquityContract } from '../config/contracts.js';

export const AI_OPERATION_MODES = Object.freeze({
  RULES_ONLY: 'RULES_ONLY',
  EXTERNAL_LLM: 'EXTERNAL_LLM',
});

/**
 * 1. Market Intelligence Agent
 * Analyzes market regime, trend, momentum, volatility, volume, entry, and invalidations.
 * Strictly uses Stock Benchmark (SPY) for Equities and Bitcoin for Crypto.
 */
export class MarketIntelligenceAgent {
  /**
   * Generates a structured trade thesis from quantitative market evidence.
   * @param {Object} proposal
   * @param {Object} [marketContext]
   * @returns {Object} validated thesis
   */
  generateThesis(proposal, marketContext = {}) {
    const { symbol, side, indicators = {}, rewardRisk = {}, reasons = [] } = proposal;
    const isEquity = isEquityContract(symbol) || proposal.assetClass === 'EQUITY';

    // 1. Regime Analysis
    let regime = 'RANGING_CONSOLIDATION';
    const isUptrend = indicators.price > indicators.ema50_15m && indicators.price > indicators.ema20_4h;
    const isDowntrend = indicators.price < indicators.ema50_15m && indicators.price < indicators.ema20_4h;

    if (isUptrend) {
      regime = indicators.isVolumeSpike ? 'BULLISH_EXPANSION' : 'TRENDING_BULLISH';
    } else if (isDowntrend) {
      regime = indicators.isVolumeSpike ? 'BEARISH_EXPANSION' : 'TRENDING_BEARISH';
    } else if (indicators.atr_15m && indicators.atr_15m / indicators.price > 0.01) {
      regime = 'HIGH_VOLATILITY_CHOP';
    }

    // 2. Trend & Structure
    const macroTrend = isEquity
      ? (marketContext.stockTrend || marketContext.spyTrend || 'NEUTRAL')
      : (marketContext.btcTrend || 'NEUTRAL');

    const trendAnalysis = {
      benchmark: isEquity ? 'S&P 500 (SPY)' : 'Bitcoin (BTC)',
      macroTrend,
      timeframe4hStructure: indicators.price > indicators.ema20_4h ? 'Bullish (Above 4h EMA20)' : 'Bearish (Below 4h EMA20)',
      timeframe15mStructure: indicators.price > indicators.ema50_15m ? 'Bullish (Above 15m EMA50)' : 'Bearish (Below 15m EMA50)',
      alignmentScore: isUptrend || isDowntrend ? 0.9 : 0.4,
    };

    // 3. Momentum & Volume
    const rsi = indicators.rsi_15m ?? 50;
    const rvol = indicators.rvol_5m ?? 1.0;
    const momentumAnalysis = {
      rsi15m: rsi,
      state: rsi > 65 ? 'OVERBOUGHT_STRETCH' : (rsi < 35 ? 'OVERSOLD_STRETCH' : 'HEALTHY_MOMENTUM'),
      volumeState: indicators.isVolumeSpike ? `Spike Detected (${rvol}x 20-candle average)` : `Nominal Volume (${rvol}x)`,
    };

    // 4. Volatility & Invalidation
    const volatilityAnalysis = {
      atr15m: indicators.atr_15m,
      atr4h: indicators.atr_4h,
      volatilityTier: (indicators.atr_15m / indicators.price) > 0.007 ? 'ELEVATED' : 'STABLE',
    };

    const invalidationCriteria = isEquity
      ? (side === 'LONG'
        ? [
            `Loss of proposed stop loss at ${proposal.stopLoss} invalidates directional bias.`,
            `15m candle close below 15m EMA50 (${indicators.ema50_15m?.toFixed(2)}) signals momentum exhaustion.`,
            `S&P 500 (SPY) macro benchmark turning bearish invalidates long equity continuation.`,
          ]
        : [
            `Reclaim of proposed stop loss at ${proposal.stopLoss} invalidates directional bias.`,
            `15m candle close above 15m EMA50 (${indicators.ema50_15m?.toFixed(2)}) signals short-covering recovery.`,
            `S&P 500 (SPY) macro benchmark turning bullish invalidates short equity continuation.`,
          ])
      : (side === 'LONG'
        ? [
            `Loss of proposed stop loss at ${proposal.stopLoss} invalidates directional bias.`,
            `15m candle close below 15m EMA50 (${indicators.ema50_15m?.toFixed(2)}) signals momentum exhaustion.`,
            `BTC macro trend turning bearish invalidates long crypto continuation.`,
          ]
        : [
            `Reclaim of proposed stop loss at ${proposal.stopLoss} invalidates directional bias.`,
            `15m candle close above 15m EMA50 (${indicators.ema50_15m?.toFixed(2)}) signals short-covering recovery.`,
            `BTC macro trend turning bullish invalidates short crypto continuation.`,
          ]);

    const supportingEvidence = [
      ...reasons,
      `Market Regime: ${regime}`,
      `Trend Structure: ${trendAnalysis.timeframe15mStructure} and ${trendAnalysis.timeframe4hStructure}`,
      `Benchmark: ${trendAnalysis.benchmark} trend is ${macroTrend}`,
      `Momentum State: RSI ${rsi} (${momentumAnalysis.state})`,
      `Volume Expansion: ${momentumAnalysis.volumeState}`,
    ];

    const confidence = side === 'LONG'
      ? Math.min(0.92, 0.60 + (rsi > 50 ? 0.15 : 0) + (indicators.isVolumeSpike ? 0.15 : 0))
      : Math.min(0.92, 0.60 + (rsi < 50 ? 0.15 : 0) + (indicators.isVolumeSpike ? 0.15 : 0));

    return {
      agent: 'MarketIntelligenceAgent',
      symbol,
      assetClass: isEquity ? 'EQUITY' : 'CRYPTO',
      side,
      regime,
      confidence: Number(confidence.toFixed(2)),
      analysisConfidence: Number(confidence.toFixed(2)),
      primaryHypothesis: `${side} continuation on ${symbol} within ${regime} regime backed by multi-timeframe moving average alignment and volume confirmation.`,
      supportingEvidence,
      trendAnalysis,
      momentumAnalysis,
      volatilityAnalysis,
      invalidationCriteria,
      proposedEntry: proposal.entryPrice,
      proposedStopLoss: proposal.stopLoss,
      proposedTakeProfit: proposal.takeProfit,
      netRewardRisk: rewardRisk.netRR || 0,
      generatedAt: Date.now(),
    };
  }
}

/**
 * 2. Adversarial Review Agent
 * Actively stress-tests the trade thesis, identifying contradictory evidence,
 * conflicting timeframes, slippage hazards, stale signals, and false breakout risks.
 */
export class AdversarialReviewAgent {
  /**
   * Reviews and challenges a market intelligence thesis.
   * @param {Object} thesis
   * @param {Object} marketContext
   * @returns {Object} adversarial review report
   */
  challengeThesis(thesis, marketContext = {}) {
    const { symbol, side, indicators = {}, netRewardRisk } = thesis;
    const isEquity = isEquityContract(symbol) || thesis.assetClass === 'EQUITY';
    const counterEvidence = [];
    const invalidationConditions = [...(thesis.invalidationCriteria || [])];
    let riskScore = 0.2; // base skepticism

    // 1. Momentum & Mean-Reversion Risk
    const rsi = indicators.rsi_15m ?? 50;
    if (side === 'LONG' && rsi > 65) {
      counterEvidence.push(`15m RSI (${rsi}) approaching overbought threshold (>65). Elevated risk of mean-reverting pullback.`);
      riskScore += 0.25;
    } else if (side === 'SHORT' && rsi < 35) {
      counterEvidence.push(`15m RSI (${rsi}) approaching oversold threshold (<35). Elevated risk of short squeeze bounce.`);
      riskScore += 0.25;
    }

    // 2. Conflicting Macro & Benchmark Correlation Risk
    const macroTrend = isEquity
      ? (marketContext.stockTrend || marketContext.spyTrend || thesis.trendAnalysis?.macroTrend || 'NEUTRAL')
      : (marketContext.btcTrend || thesis.trendAnalysis?.macroTrend || 'NEUTRAL');

    if (isEquity) {
      if (macroTrend === 'NEUTRAL') {
        counterEvidence.push('S&P 500 (SPY) macro trend is NEUTRAL; elevated risk of choppy sector rotation and false breakouts.');
        riskScore += 0.15;
      } else if (side === 'LONG' && macroTrend === 'BEARISH') {
        counterEvidence.push('Severe divergence: Long equity candidate proposed while S&P 500 (SPY) macro trend is BEARISH.');
        riskScore += 0.40;
      } else if (side === 'SHORT' && macroTrend === 'BULLISH') {
        counterEvidence.push('Severe divergence: Short equity candidate proposed while S&P 500 (SPY) macro trend is BULLISH.');
        riskScore += 0.40;
      }
    } else {
      if (macroTrend === 'NEUTRAL') {
        counterEvidence.push('Bitcoin macro trend is NEUTRAL; high probability of choppy false breakouts across crypto markets.');
        riskScore += 0.15;
      } else if (side === 'LONG' && macroTrend === 'BEARISH') {
        counterEvidence.push('Severe divergence: Long crypto candidate proposed while Bitcoin macro trend is BEARISH.');
        riskScore += 0.40;
      } else if (side === 'SHORT' && macroTrend === 'BULLISH') {
        counterEvidence.push('Severe divergence: Short crypto candidate proposed while Bitcoin macro trend is BULLISH.');
        riskScore += 0.40;
      }
    }

    // 3. Stale Signal Check
    const signalAgeMs = Date.now() - (thesis.generatedAt || Date.now());
    if (signalAgeMs > 5 * 60 * 1000) {
      counterEvidence.push(`Signal age is ${Math.round(signalAgeMs / 1000)}s; market structure may have evolved.`);
      riskScore += 0.20;
    }

    // 4. Reward-to-Risk Margin of Safety
    if (netRewardRisk < 1.6) {
      counterEvidence.push(`Net R:R (${netRewardRisk}:1) offers slim buffer above the hard 1.5:1 floor.`);
      riskScore += 0.15;
    }

    // 5. Liquidity & Slippage Impact
    const contract = getContractSpec(thesis.symbol);
    const slippagePct = contract?.baseSlippage ?? 0.0002;
    if (slippagePct > 0.0003) {
      counterEvidence.push(`Higher baseline slippage (${(slippagePct * 100).toFixed(2)}%) for ${thesis.symbol}; taker execution cost is elevated.`);
      riskScore += 0.10;
    }

    const passedChallenge = riskScore < 0.65;
    const verdict = passedChallenge ? 'CHALLENGE_SURVIVED' : 'CHALLENGE_FLAGGED';

    return {
      agent: 'AdversarialReviewAgent',
      verdict,
      adversarialRiskScore: Number(riskScore.toFixed(2)),
      counterEvidence,
      invalidationConditions,
      uncertainty: {
        volatilityRegime: indicators.atr_15m ? 'MODERATE' : 'UNKNOWN',
        liquidityRisk: `Modeled for ${thesis.symbol} (Base slippage: ${(slippagePct * 100).toFixed(2)}%)`,
        executionRisk: 'Modeled for paper trading (0.02% slippage + 0.05% taker fee)',
      },
      reviewedAt: Date.now(),
    };
  }
}

/**
 * 3. Multi-Agent Synthesis Coordinator
 * Orchestrates Market Intelligence, Adversarial Review, Deterministic Risk Engine,
 * and Execution Coordinator into a verified decision pipeline.
 */
export class MultiAgentCoordinator {
  constructor(options = {}) {
    this.intelligenceAgent = new MarketIntelligenceAgent();
    this.adversarialAgent = new AdversarialReviewAgent();
    this.mode = options.mode || (process.env.AI_API_KEY ? AI_OPERATION_MODES.EXTERNAL_LLM : AI_OPERATION_MODES.RULES_ONLY);
  }

  /**
   * Conducts full multi-agent deliberation on a candidate setup.
   * Checks account-level gates before allowing execution approval.
   * @param {Object} params
   * @param {Object} params.proposal - candidate setup from strategy scanner
   * @param {Object} params.accountState - { equity, startOfDayEquity, currentEquity, consecutiveLosses, openPositionsCount, lastTradeClosedAt }
   * @param {Object} [params.riskConfig]
   * @returns {Object} synthesized deliberation record
   */
  async deliberate({ proposal, accountState, riskConfig = {} }) {
    const isEquity = isEquityContract(proposal.symbol) || proposal.assetClass === 'EQUITY';
    const marketContext = {
      stockTrend: proposal.reasons?.[1]?.includes('SPY') ? (proposal.reasons[1].split('is ')[1] || 'BULLISH') : 'BULLISH',
      btcTrend: proposal.reasons?.[1]?.includes('Bitcoin') ? (proposal.reasons[1].split('is ')[1] || 'NEUTRAL') : 'NEUTRAL',
    };

    // Step 1: Market Intelligence Thesis
    const thesis = this.intelligenceAgent.generateThesis(proposal, marketContext);

    // Step 2: Adversarial Review
    const review = this.adversarialAgent.challengeThesis({
      ...thesis,
      indicators: proposal.indicators,
    }, marketContext);

    // Step 3: Account-Level Gate Check (Veto and Cooldown Clarity)
    const cooldownMins = Number(riskConfig.cooldownMinutes ?? 30);
    const cooldownMs = cooldownMins * 60 * 1000;
    let accountGateBlocked = false;
    let accountGateReason = null;
    let accountGateMessage = null;
    let cooldownResumesAt = null;
    let cooldownRemainingMinutes = 0;

    if (accountState.isDailyLossLocked) {
      accountGateBlocked = true;
      accountGateReason = 'DAILY_LOSS_LIMIT_REACHED';
      accountGateMessage = 'Trading blocked: Daily loss limit lockout active.';
    } else if (accountState.consecutiveLosses >= (riskConfig.maxConsecutiveLosses ?? 3)) {
      accountGateBlocked = true;
      accountGateReason = 'CONSECUTIVE_LOSS_PAUSE';
      accountGateMessage = `Trading blocked: ${accountState.consecutiveLosses} consecutive losses pause active.`;
    } else if (accountState.lastTradeClosedAt && (Date.now() - accountState.lastTradeClosedAt < cooldownMs)) {
      const elapsed = Date.now() - accountState.lastTradeClosedAt;
      const remainingMs = cooldownMs - elapsed;
      cooldownRemainingMinutes = Math.ceil(remainingMs / 60000);
      cooldownResumesAt = accountState.lastTradeClosedAt + cooldownMs;
      const timeStr = new Date(cooldownResumesAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      accountGateBlocked = true;
      accountGateReason = 'COOLDOWN_ACTIVE';
      accountGateMessage = `Trading blocked: Cooldown active, resumes at ${timeStr} (${cooldownRemainingMinutes} min left).`;
    }

    // Step 4: Deterministic Risk Engine Evaluation (Authority)
    const riskCheckInput = {
      symbol: proposal.symbol,
      side: proposal.side,
      entryPrice: proposal.entryPrice,
      stopLoss: proposal.stopLoss,
      takeProfit: proposal.takeProfit,
      equity: accountState.equity,
      startOfDayEquity: accountState.startOfDayEquity,
      currentEquity: accountState.currentEquity,
      consecutiveLosses: accountState.consecutiveLosses,
      openPositionsCount: accountState.openPositionsCount,
      lastTradeClosedAt: accountState.lastTradeClosedAt,
      existingOrders: accountState.existingOrders,
      existingPositions: accountState.existingPositions,
      timestamp: proposal.timestamp,
      entryAllocationPercent: proposal.entryAllocationPercent ?? riskConfig?.entryAllocationPercent ?? 10,
    };

    const riskResult = evaluatePaperTrade(riskCheckInput, riskConfig);

    // Step 5: Execution Coordinator Decision
    const isApproved = !accountGateBlocked && riskResult.allowed && review.verdict === 'CHALLENGE_SURVIVED';

    let coordinatorVerdict = 'REJECTED';
    let coordinatorReason = '';

    if (accountGateBlocked) {
      coordinatorVerdict = `VETOED_BY_RISK_ENGINE: ${accountGateReason}`;
      coordinatorReason = accountGateMessage;
    } else if (!riskResult.allowed) {
      coordinatorVerdict = 'VETOED_BY_RISK_ENGINE';
      coordinatorReason = `Deterministic Risk Engine rejected trade: ${riskResult.reason}`;
    } else if (review.verdict !== 'CHALLENGE_SURVIVED') {
      coordinatorVerdict = 'FLAGGED_BY_ADVERSARIAL_AGENT';
      coordinatorReason = `Adversarial review flagged excessive setup risks (score: ${review.adversarialRiskScore})`;
    } else {
      coordinatorVerdict = 'APPROVED_FOR_PAPER_EXECUTION';
      coordinatorReason = 'Thesis survived adversarial review and passed all deterministic risk constraints.';
    }

    return {
      mode: this.mode,
      modeLabel: this.mode === AI_OPERATION_MODES.RULES_ONLY
        ? 'Rules-Only Multi-Agent Mode — No External AI Configured'
        : 'External AI LLM Deliberation Engine',
      isApproved,
      accountGateBlocked,
      accountGateReason,
      accountGateMessage,
      cooldownResumesAt,
      cooldownRemainingMinutes,
      analysisConfidence: thesis.analysisConfidence,
      coordinatorVerdict,
      coordinatorReason,
      thesis,
      review,
      riskResult,
      contract: getContractSpec(proposal.symbol),
      deliberatedAt: Date.now(),
    };
  }

  async deliberateSetup(params) {
    return this.deliberate(params);
  }
}
