import { computeIndicators } from '../indicators/index.js';
import { calculateNetRewardRisk } from '../utils/decimal.js';
import { getContractSpec, classifyInstrument, isEquityContract, getLeveragedProductInfo } from '../config/contracts.js';
import { StockMarketProvider } from '../adapters/market-provider.js';

export const DEFAULT_STRATEGY_CONFIG = Object.freeze({
  timeframes: ['4h', '15m', '5m'],
  targetAtrMultiplier: 1.8,
  minTargetPercent: 0.011, // 1.1%
  maxTargetPercent: 0.030, // 3.0%
  minStopPercent: 0.005,   // 0.5%
  maxStopPercent: 0.008,   // 0.8%
  minNetRewardRisk: 1.5,
  partialTakeProfitPercent: 0.011, // 1.1%
  partialExitRatio: 0.5,           // 50%
  trailingStopRoiThreshold: 0.10,  // 10% ROI
  trailingStopAtrBuffer: 0.5,      // 0.5x 5m ATR buffer below 5m EMA 20
  earlyExitLongRsi: 45,
  earlyExitShortRsi: 55,
  volumeSpikeThreshold: 1.5,
  maxSignalAgeMs: 10 * 60 * 1000, // 10 minutes (strict freshness policy)
});

/**
 * Strategy Engine for VT2
 * Evaluates multi-timeframe candle datasets, applies asset-class-specific macro benchmarks
 * (SPY for Equities, BTC for Crypto), calculates entry/SL/TP levels, and ranks or rejects trade setups.
 */
export class StrategyEngine {
  constructor(config = DEFAULT_STRATEGY_CONFIG) {
    this.config = { ...DEFAULT_STRATEGY_CONFIG, ...config };
  }

  /**
   * Evaluates Bitcoin's macro trend context from 4h candles.
   * @param {Array} btcCandles4h
   * @returns {{ trend: 'BULLISH'|'BEARISH'|'NEUTRAL', btcPrice: number, ema50: number, ema200: number|null, reason: string }}
   */
  evaluateBtcTrend(btcCandles4h) {
    if (!btcCandles4h || btcCandles4h.length < 50) {
      return { trend: 'NEUTRAL', btcPrice: 0, ema50: 0, ema200: null, reason: 'INSUFFICIENT_BTC_CANDLES' };
    }

    const indicators = computeIndicators(btcCandles4h);
    const currentPrice = indicators.current.close;
    const ema50 = indicators.current.ema50;
    const ema200 = indicators.current.ema200;

    let trend = 'NEUTRAL';
    if (currentPrice > ema50) {
      trend = 'BULLISH';
    } else if (currentPrice < ema50) {
      trend = 'BEARISH';
    }

    return {
      trend,
      btcPrice: currentPrice,
      ema50,
      ema200,
      reason: `BTC 4h price $${currentPrice.toLocaleString()} vs EMA50 $${ema50?.toFixed(2)}`,
    };
  }

  /**
   * Evaluates Stock Market Benchmark (S&P 500 ETF SPYUSDT) macro trend context from 4h candles.
   * @param {Array} spyCandles4h
   * @returns {{ trend: 'BULLISH'|'BEARISH'|'NEUTRAL', benchmarkPrice: number, ema50: number, reason: string }}
   */
  evaluateStockBenchmark(spyCandles4h) {
    if (!spyCandles4h || spyCandles4h.length < 30) {
      return {
        trend: 'BULLISH', // Standard neutral/constructive baseline for equities
        benchmarkPrice: 0,
        ema50: 0,
        benchmark: 'SPY',
        reason: 'S&P 500 benchmark standing baseline',
      };
    }

    const indicators = computeIndicators(spyCandles4h);
    const currentPrice = indicators.current.close;
    const ema50 = indicators.current.ema50 || indicators.current.ema20;

    let trend = 'NEUTRAL';
    if (currentPrice > ema50) {
      trend = 'BULLISH';
    } else if (currentPrice < ema50) {
      trend = 'BEARISH';
    }

    return {
      trend,
      benchmarkPrice: currentPrice,
      ema50,
      benchmark: 'SPY',
      reason: `S&P 500 (SPY) 4h price $${currentPrice.toFixed(2)} vs EMA $${ema50?.toFixed(2)}`,
    };
  }

  /**
   * Scans an instrument across 4h, 15m, and 5m candles to generate or reject a trade proposal.
   * @param {Object} params
   * @param {string} params.symbol
   * @param {Object} params.timeframeCandles - { '4h': [...], '15m': [...], '5m': [...] }
   * @param {string} [params.macroTrend='NEUTRAL']
   * @param {string} [params.btcTrend='NEUTRAL']
   * @param {number} [params.currentTime=Date.now()]
   * @returns {Object} Scan proposal or rejection record
   */
  analyzeInstrument({ symbol, timeframeCandles, macroTrend = 'NEUTRAL', btcTrend = 'NEUTRAL', currentTime = Date.now() }) {
    const contract = getContractSpec(symbol);
    const assetClass = contract?.assetClass || classifyInstrument(symbol);
    const isEquity = assetClass === 'EQUITY';

    if (!contract) {
      return {
        symbol,
        assetClass,
        qualified: false,
        rejectionReason: 'INELIGIBLE_CONTRACT',
        explanation: `${symbol} is not on the verified eligible perpetual contract list.`,
      };
    }

    const leveragedInfo = getLeveragedProductInfo(symbol);
    let underlyingMarketClosed = false;
    let underlyingSession = '24/7 Continuous';
    if (isEquity) {
      try {
        const stockProvider = new StockMarketProvider();
        const underlyingState = stockProvider.getUnderlyingMarketState(new Date(currentTime));
        underlyingMarketClosed = !underlyingState.isOpen;
        underlyingSession = underlyingState.sessionName;
      } catch {}
    }

    const c4h = timeframeCandles['4h'];
    const c15m = timeframeCandles['15m'];
    const c5m = timeframeCandles['5m'];

    if (!c4h || c4h.length < 50 || !c15m || c15m.length < 30 || !c5m || c5m.length < 30) {
      return {
        symbol,
        assetClass,
        leveragedInfo,
        underlyingMarketClosed,
        underlyingSession,
        qualified: false,
        rejectionReason: 'INSUFFICIENT_CANDLE_DATA',
        explanation: 'One or more required timeframes has insufficient historical candles.',
      };
    }

    const ind4h = computeIndicators(c4h);
    const ind15m = computeIndicators(c15m);
    const ind5m = computeIndicators(c5m);

    const currentPrice = ind15m.current.close;
    const atr15m = ind15m.current.atr;
    const atr4h = ind4h.current.atr;

    // Check freshness of last candle
    const lastCandleTs = c15m[c15m.length - 1].timestamp;
    if (currentTime - lastCandleTs > this.config.maxSignalAgeMs) {
      return {
        symbol,
        assetClass,
        qualified: false,
        rejectionReason: 'SIGNAL_EXPIRED',
        explanation: `Candle data is stale (age: ${Math.round((currentTime - lastCandleTs) / 1000)}s). Max allowed: ${this.config.maxSignalAgeMs / 1000}s.`,
      };
    }

    // Determine Multi-Timeframe Alignment
    const is4hBullish = ind4h.current.close > ind4h.current.ema20;
    const is4hBearish = ind4h.current.close < ind4h.current.ema20;

    const is15mBullish = ind15m.current.close > ind15m.current.ema50;
    const is15mBearish = ind15m.current.close < ind15m.current.ema50;

    let bias = null;
    if (is4hBullish && is15mBullish) {
      bias = 'LONG';
    } else if (is4hBearish && is15mBearish) {
      bias = 'SHORT';
    } else {
      return {
        symbol,
        assetClass,
        qualified: false,
        rejectionReason: 'TIMEFRAME_ALIGNMENT_CONFLICT',
        explanation: `4h trend (${is4hBullish ? 'BULL' : 'BEAR'}) conflicts with 15m trend (${is15mBullish ? 'BULL' : 'BEAR'}).`,
      };
    }

    // Macro context filter: SPY for equities, BTC for crypto
    const activeMacroTrend = isEquity ? macroTrend : (btcTrend || macroTrend);
    if (bias === 'LONG' && activeMacroTrend === 'BEARISH') {
      return {
        symbol,
        assetClass,
        qualified: false,
        rejectionReason: isEquity ? 'STOCK_BENCHMARK_DIVERGENCE' : 'MACRO_BTC_DIVERGENCE',
        explanation: isEquity
          ? 'Cannot take Long equity setup while S&P 500 macro benchmark (SPY) is BEARISH.'
          : 'Cannot take Long crypto setup while Bitcoin macro trend is BEARISH.',
      };
    }
    if (bias === 'SHORT' && activeMacroTrend === 'BULLISH') {
      return {
        symbol,
        assetClass,
        qualified: false,
        rejectionReason: isEquity ? 'STOCK_BENCHMARK_DIVERGENCE' : 'MACRO_BTC_DIVERGENCE',
        explanation: isEquity
          ? 'Cannot take Short equity setup while S&P 500 macro benchmark (SPY) is BULLISH.'
          : 'Cannot take Short crypto setup while Bitcoin macro trend is BULLISH.',
      };
    }

    // Calculate Entry, Stop Loss, and Take Profit
    const entryPrice = currentPrice;
    let stopLoss;
    let takeProfit;

    if (bias === 'LONG') {
      const swingLow = Math.min(...c15m.slice(-10).map(c => c.low));
      const atrStop = entryPrice - (atr15m * 1.5);
      const rawStop = Math.max(swingLow, atrStop);

      const stopPct = (entryPrice - rawStop) / entryPrice;
      const boundedStopPct = Math.min(this.config.maxStopPercent, Math.max(this.config.minStopPercent, stopPct));
      stopLoss = Number((entryPrice * (1 - boundedStopPct)).toFixed(4));

      const targetPct = Math.min(
        this.config.maxTargetPercent,
        Math.max(this.config.minTargetPercent, (atr15m * this.config.targetAtrMultiplier) / entryPrice)
      );
      takeProfit = Number((entryPrice * (1 + targetPct)).toFixed(4));
    } else {
      const swingHigh = Math.max(...c15m.slice(-10).map(c => c.high));
      const atrStop = entryPrice + (atr15m * 1.5);
      const rawStop = Math.min(swingHigh, atrStop);

      const stopPct = (rawStop - entryPrice) / entryPrice;
      const boundedStopPct = Math.min(this.config.maxStopPercent, Math.max(this.config.minStopPercent, stopPct));
      stopLoss = Number((entryPrice * (1 + boundedStopPct)).toFixed(4));

      const targetPct = Math.min(
        this.config.maxTargetPercent,
        Math.max(this.config.minTargetPercent, (atr15m * this.config.targetAtrMultiplier) / entryPrice)
      );
      takeProfit = Number((entryPrice * (1 - targetPct)).toFixed(4));
    }

    // Enforce Net Reward-to-Risk >= minNetRewardRisk
    const rr = calculateNetRewardRisk({
      entryPrice,
      stopLoss,
      takeProfit,
      side: bias,
      takerFeeRate: contract.takerFeeRate ?? 0.0005,
      makerFeeRate: contract.makerFeeRate ?? 0.0002,
      baseSlippage: contract.baseSlippage ?? 0.0002,
    });

    if (rr.netRR < this.config.minNetRewardRisk) {
      return {
        symbol,
        assetClass,
        qualified: false,
        rejectionReason: 'INSUFFICIENT_NET_REWARD_RISK',
        explanation: `Proposed setup net R:R (${rr.netRR}) is below minimum requirement (${this.config.minNetRewardRisk}).`,
      };
    }

    // Volume Spike & RSI confirmation on 5m
    const hasVolumeActivity = ind5m.current.isVolumeSpike || (ind5m.current.rvol && ind5m.current.rvol >= 1.2);
    const rsi15m = ind15m.current.rsi;

    if (bias === 'LONG' && rsi15m > 72) {
      return {
        symbol,
        assetClass,
        qualified: false,
        rejectionReason: 'RSI_OVERBOUGHT',
        explanation: `15m RSI (${rsi15m}) is overbought (> 72); risk of pullback.`,
      };
    }
    if (bias === 'SHORT' && rsi15m < 28) {
      return {
        symbol,
        assetClass,
        qualified: false,
        rejectionReason: 'RSI_OVERSOLD',
        explanation: `15m RSI (${rsi15m}) is oversold (< 28); risk of short bounce.`,
      };
    }

    // Calculate setup score for ranking
    const score = Number((
      (rr.netRR * 30) +
      (hasVolumeActivity ? 25 : 10) +
      (bias === 'LONG' ? (70 - rsi15m) * 0.5 : (rsi15m - 30) * 0.5)
    ).toFixed(1));

    const macroReasonText = isEquity
      ? `S&P 500 macro benchmark (SPY) context is ${activeMacroTrend}`
      : `Bitcoin macro context is ${activeMacroTrend}`;

    return {
      symbol,
      underlyingTicker: contract.underlyingTicker || symbol.replace(/USDT$/, ''),
      assetClass,
      leveragedInfo,
      underlyingMarketClosed,
      underlyingSession,
      qualified: true,
      side: bias,
      score,
      entryPrice,
      stopLoss,
      takeProfit,
      partialTakeProfitPrice: bias === 'LONG'
        ? Number((entryPrice * (1 + this.config.partialTakeProfitPercent)).toFixed(4))
        : Number((entryPrice * (1 - this.config.partialTakeProfitPercent)).toFixed(4)),
      rewardRisk: rr,
      timestamp: currentTime,
      indicators: {
        price: currentPrice,
        ema20_4h: ind4h.current.ema20,
        ema50_15m: ind15m.current.ema50,
        rsi_15m: rsi15m,
        atr_15m: atr15m,
        atr_4h: atr4h,
        rvol_5m: ind5m.current.rvol,
        isVolumeSpike: ind5m.current.isVolumeSpike,
      },
      reasons: [
        `${bias} trend aligned across 4h and 15m timeframes`,
        macroReasonText,
        `Net Reward-to-Risk is ${rr.netRR}:1 after modeled exchange fees and slippage`,
        hasVolumeActivity ? 'Volume spike confirmed on 5m timeframe' : 'Standard volume condition',
      ],
    };
  }

  /**
   * Scans a dictionary of market fixtures or live candle datasets.
   * Dynamically applies SPY benchmark for equities and BTC benchmark for crypto.
   * @param {Object} markets - map of symbol to timeframeCandles
   * @param {number} [currentTime=Date.now()]
   * @returns {{ qualified: Array, rejected: Array, btcContext: Object, stockContext: Object }}
   */
  scanUniverse(markets, currentTime = Date.now()) {
    const btcCandles = markets['BTCUSDT']?.candles?.['4h'] || markets['BTCUSDT']?.['4h'];
    const btcContext = this.evaluateBtcTrend(btcCandles);

    const spyCandles = markets['SPYUSDT']?.candles?.['4h'] || markets['SPYUSDT']?.['4h'];
    const stockContext = this.evaluateStockBenchmark(spyCandles);

    const qualified = [];
    const rejected = [];

    for (const [symbol, data] of Object.entries(markets)) {
      const timeframeCandles = data.candles || data;
      const isEq = isEquityContract(symbol);

      const result = this.analyzeInstrument({
        symbol,
        timeframeCandles,
        macroTrend: isEq ? stockContext.trend : btcContext.trend,
        btcTrend: btcContext.trend,
        currentTime,
      });

      if (result.qualified) {
        qualified.push(result);
      } else {
        rejected.push(result);
      }
    }

    // Rank qualified setups by score descending
    qualified.sort((a, b) => b.score - a.score);

    return {
      qualified,
      rejected,
      btcContext,
      stockContext,
      timestamp: currentTime,
    };
  }
}
