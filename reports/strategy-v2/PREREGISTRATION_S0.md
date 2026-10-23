# VT2 Pre-Registration: Candidate S0 (As-Shipped Live Strategy Replay)

**Registration Date:** 2026-10-21T11:50:00.000Z  
**Branch:** `v2`  
**Base Commit / Tag:** `hackathon-submission`  
**Candidate Identifier:** `S0` (Trial #35)  
**Status:** Pre-registered before execution.

---

## 1. Motivation & Purpose

Audit finding from `reports/audit/rules_applied.txt` and `reports/audit/rules_source_lines.txt` established that the published v1 backtest engine (`AlphaPortfolioEngine`) and the live trading scanner (`StrategyEngine.scanUniverse`) applied substantially different rules:
1. **Target Calculation:** Backtest used a static target of `stopDistance * 1.5 * 1.05`, while live scanner uses ATR-based targets (`targetAtrMultiplier: 1.8`, clamped to 1.1%–3.0%).
2. **4h Alignment:** Backtest required `ema20 > ema50 && close > ema50`, while live scanner requires `close > ema20`.
3. **RSI Filtering:** Backtest required bounded corridor (42–68 Long / 32–58 Short), while live scanner only filters overbought/oversold (>72 Long / <28 Short).
4. **Reward-to-Risk Gate:** Live scanner filters setups using `calculateNetRewardRisk` with `minNetRewardRisk >= 1.5`, which was never evaluated in the v1 backtest engine.

The strategy that the application actually executes when running has **never been backtested**. Candidate S0 evaluates this exact as-shipped strategy under rigorous zero-lookahead chronological simulation.

---

## 2. Candidate S0 Specifications

Candidate S0 executes the exact logic from `StrategyEngine.scanUniverse` paired with deterministic `RiskEngine` validation and `PaperExecutionEngine` lifecycle management.

### Timeframes & Lookback Windows
- 15m candles: 300 rolling closed bars.
- 4h candles: 100 rolling closed bars (strictly closed at or before current bar timestamp).
- 5m candles: 300 rolling closed bars (synthesized from 15m bars to guarantee zero look-ahead).

### Entry Qualification (Live `StrategyEngine`)
- **4h Alignment:** Long requires `ind4h.current.close > ind4h.current.ema20`; Short requires `ind4h.current.close < ind4h.current.ema20`.
- **15m Alignment:** Long requires `ind15m.current.close > ind15m.current.ema50`; Short requires `ind15m.current.close < ind15m.current.ema50`.
- **Benchmark Filter:** SPYUSDT 4h trend (`price > ema50`). Long allowed only if BULLISH; Short allowed only if BEARISH.
- **Stop Loss:** Max of 10-bar swing and `1.5 * ATR15m`, clamped strictly between `0.5%` and `0.8%` of entry price.
- **Take Profit:** ATR target `1.8 * ATR15m`, clamped strictly between `1.1%` and `3.0%` of entry price.
- **Net Reward-to-Risk Gate:** Net R:R after modeled taker fee (0.06%) and slippage (0.02%) must be `>= 1.5:1`.
- **RSI Filter:** Long rejected if `15m RSI > 72`; Short rejected if `15m RSI < 28`.
- **Setup Ranking:** Qualified candidates ranked by composite score (`netRR * 30 + volumeBonus + rsiBonus`). Top setup taken.

### Risk & Execution Management (`RiskEngine` & `PaperExecutionEngine`)
- **Risk Budget:** 0.5% of current equity per trade ($50 on $10,000 equity).
- **Execution Timing:** Fill at NEXT bar open + slippage.
- **Ambiguous Candle Resolution:** Worst-case assumption: stop-loss hit first.
- **Cooldown:** 30 minutes after trade exit.
- **Max Consecutive Losses:** 3 (locks trading until reset).
- **Max Daily Loss:** 2.0% of starting-day equity.
- **Max Open Positions:** 1 concurrent position.
- **Lifecycle Exits:**
  - Partial Take-Profit: At `+1.1%` ROI, close 50% position, move stop to entry `+ 0.05%` (breakeven).
  - Trailing Stop: At `+10%` ROI, trail 5m EMA20 with `0.5x ATR` buffer.
  - Early Exit: RSI reversal (>75 Long / <25 Short).

---

## 3. Data Splits & Cost Assumptions

### Data Splits
- **Universe:** 19 tokenized US equity perpetual contracts.
- **Dev Split:** 2026-05-11 00:00:00 UTC to 2026-09-11 15:00:00 UTC (~123 days).
- **Validation Split:** 2026-09-11 15:00:00 UTC to 2026-10-10 19:30:00 UTC (~29 days).
- **Forward Holdout:** STRICTLY UNOPENED / CLOSED.

### Cost Parameters (Standard Round 2 Hardened Costs)
- **Taker Fee:** 0.06% (0.0006) per execution.
- **Slippage:** 0.02% (0.0002) per execution.
- **Funding Rate:** 0.01% per 8 hours (0.0001).
- **Cost Sensitivity:** Evaluated at 0x costs (gross), 1x costs (baseline), and 2x costs (stress test).

---

## 4. Immutable Pass Criteria

Candidate S0 will be declared PASS only if ALL of the following criteria are met:
1. **Net P&L:** Net return after costs > $0 on Dev AND Validation splits.
2. **Profit Factor:** PF >= 1.25 on both splits.
3. **Statistical Sample:** Trade count >= 30 on both splits.
4. **Drawdown:** Maximum portfolio drawdown <= 15.0%.
5. **Cost Resilience:** Net P&L remains > $0 under 2x cost sensitivity stress test.

If Candidate S0 fails any of these criteria, the verdict in `CONCLUSION.md` will record:
*"The app as shipped has no demonstrated edge on this data."*
