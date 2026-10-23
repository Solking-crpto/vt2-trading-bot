const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync('config/alpha-strategy.json', 'utf8'));

const rules = [
  {
    rule: '4h alignment',
    configKey: 'rules.indicators.trend4h',
    configVal: JSON.stringify(config.rules.indicators.trend4h),
    alphaEngineLine: 'src/backtest/alpha-portfolio-engine.js:415-416 (Evaluates ema20 > ema50 && close > ema50; DOES NOT check ema200)',
    liveEngineLine: 'src/strategy/engine.js:140-141 (Evaluates close > ema20 for Long, close < ema20 for Short; DOES NOT check ema50 or ema200)',
    notes: 'Neither engine checks 3-EMA alignment (ema20 > ema50 > ema200).'
  },
  {
    rule: 'RSI band',
    configKey: 'rules.indicators.entry15m.rsiLongMin/Max, rsiShortMin/Max',
    configVal: `Long: ${config.rules.indicators.entry15m.rsiLongMin}–${config.rules.indicators.entry15m.rsiLongMax} (42–68), Short: ${config.rules.indicators.entry15m.rsiShortMin}–${config.rules.indicators.entry15m.rsiShortMax} (32–58)`,
    alphaEngineLine: 'src/backtest/alpha-portfolio-engine.js:424 & 429 (Checks rsi >= 42 && rsi <= 68 for Long, rsi >= 32 && rsi <= 58 for Short)',
    liveEngineLine: 'src/strategy/engine.js:148 & 155 (Checks rsi > 72 or rsi < 28 for rejection; DOES NOT apply narrow corridor 42–68 / 32–58)',
    notes: 'AlphaPortfolioEngine applies exact 42–68/32–58 band. Live StrategyEngine only rejects extremes (>72 / <28).'
  },
  {
    rule: 'volume confirmation (15m RVOL)',
    configKey: 'rules.indicators.entry15m.volumeMultiplierThreshold',
    configVal: `${config.rules.indicators.entry15m.volumeMultiplierThreshold} (1.5x)`,
    alphaEngineLine: 'NOT APPLIED (Engine evaluates rvol metric in indicators but does NOT gate entry on it)',
    liveEngineLine: 'src/strategy/engine.js:164-167 (Evaluates relativeVolume.isVolumeSpike, adds +15 to ranking score; NOT a gating rejection)',
    notes: 'Configured as 1.5x, but never gates entry in backtest; scoring-only in live scanner.'
  },
  {
    rule: '5m confirmation',
    configKey: 'rules.indicators.execution5m',
    configVal: JSON.stringify(config.rules.indicators.execution5m),
    alphaEngineLine: 'NOT APPLIED (synthesize5mFrom15m is defined in module but never called in runPortfolioReplay)',
    liveEngineLine: 'NOT APPLIED (Live StrategyEngine operates on 15m/4h candles; does not load 5m candle stream)',
    notes: '5m confirmation is completely absent from execution in both engines.'
  },
  {
    rule: 'benchmark (SPY)',
    configKey: 'benchmarkSymbol',
    configVal: `"${config.benchmarkSymbol}" (SPYUSDT)`,
    alphaEngineLine: 'src/backtest/alpha-portfolio-engine.js:396 & 422 & 427 (evaluateBenchmarkTrendAt on SPY 4h; requires BULLISH for Long, BEARISH for Short)',
    liveEngineLine: 'src/strategy/engine.js:126-135 (Checks SPY 4h trend; rejects with STOCK_BENCHMARK_DIVERGENCE if divergent)',
    notes: 'Fully applied in both AlphaPortfolioEngine and live StrategyEngine.'
  },
  {
    rule: 'signal age',
    configKey: 'rules.riskEngine.maxSignalAgeMinutes',
    configVal: `${config.rules.riskEngine.maxSignalAgeMinutes} minutes (10)`,
    alphaEngineLine: 'NOT APPLIED (Discrete historical replay; executes order on immediate subsequent bar t+15m)',
    liveEngineLine: 'src/risk-engine.js:246-255 & src/strategy/engine.js:106-112 (Rejects if currentTime - lastCandleTs > 10m with SIGNAL_EXPIRED)',
    notes: 'Applied in live RiskEngine/StrategyEngine; N/A in discrete historical bar replay.'
  },
  {
    rule: 'cooldown',
    configKey: 'rules.riskEngine.cooldownMinutes',
    configVal: `${config.rules.riskEngine.cooldownMinutes} minutes (30)`,
    alphaEngineLine: 'src/backtest/alpha-portfolio-engine.js:392 (currentTs - lastTradeClosedAt < 30 * 60 * 1000 blocks new entry scan)',
    liveEngineLine: 'src/risk-engine.js:231-240 (lastTradeTime + 30m blocks execution with COOLDOWN_ACTIVE)',
    notes: 'Strictly applied in both engines as exactly 30 minutes.'
  },
  {
    rule: 'min net R:R',
    configKey: 'rules.stopsAndTargets.minNetRewardToRisk',
    configVal: `${config.rules.stopsAndTargets.minNetRewardToRisk} (1.5)`,
    alphaEngineLine: 'src/backtest/alpha-portfolio-engine.js:446 (Sets targetDistance = stopDistance * 1.5 * 1.05; DOES NOT gate on net post-cost check)',
    liveEngineLine: 'src/risk-engine.js:275-285 (Computes netRewardToRisk after fees/slippage; rejects if < 1.5 with INSUFFICIENT_NET_REWARD_TO_RISK)',
    notes: 'Live RiskEngine evaluates net post-cost R:R >= 1.5. Backtest statically scaled target distance by 1.5 * 1.05.'
  },
  {
    rule: 'stop band',
    configKey: 'rules.stopsAndTargets.minStopDistancePercent / maxStopDistancePercent',
    configVal: `Min: ${config.rules.stopsAndTargets.minStopDistancePercent} (0.5%), Max: ${config.rules.stopsAndTargets.maxStopDistancePercent} (0.8%), ATR Mult: ${config.rules.stopsAndTargets.atrMultiplierStop} (1.5)`,
    alphaEngineLine: 'src/backtest/alpha-portfolio-engine.js:437-440 (Clamps stopDistance to Math.min(0.008 * price, Math.max(0.005 * price, atr * 1.5)))',
    liveEngineLine: 'src/risk-engine.js:288-310 (Rejects if stopDistancePercent < 0.005 or > 0.008 with STOP_DISTANCE_OUT_OF_BOUNDS)',
    notes: 'Strictly applied in both engines as 0.5%–0.8% stop distance.'
  },
  {
    rule: 'RSI exit',
    configKey: 'rules.lifecycleExits.earlyExitOnRsiReversal',
    configVal: `${config.rules.lifecycleExits.earlyExitOnRsiReversal} (true)`,
    alphaEngineLine: 'NOT APPLIED (Engine evaluates only Stop Loss, Take Profit, and Partial Take Profit; does not check RSI while in position)',
    liveEngineLine: 'src/execution/paper-engine.js:347-353 (Checks if position.side === LONG && rsi < 45; triggers early market close)',
    notes: 'Applied in live PaperExecutionEngine; NOT applied in AlphaPortfolioEngine backtest.'
  }
];

console.log('================================================================================');
console.log('RULE-BY-RULE AUDIT: CONFIG VS ALPHAPORTFOLIOENGINE VS LIVE STRATEGYENGINE');
console.log('================================================================================\n');

for (const r of rules) {
  console.log(`### ${r.rule.toUpperCase()}`);
  console.log(`- Raw Config (${r.configKey}): ${r.configVal}`);
  console.log(`- AlphaPortfolioEngine: ${r.alphaEngineLine}`);
  console.log(`- Live StrategyEngine / RiskEngine: ${r.liveEngineLine}`);
  console.log(`- Audit Finding: ${r.notes}\n`);
}
