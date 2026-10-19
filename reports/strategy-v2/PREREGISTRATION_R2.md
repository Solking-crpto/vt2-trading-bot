# VT2 Strategy v2: Round 2 Pre-Registration Protocol

- **Protocol Version:** 2.0.0-R2
- **Timestamp:** 2026-10-19T21:45:00.000Z
- **Author:** VT2 Engineering & Quantitative Research
- **Git Branch:** `v2`
- **Config Hash Target:** `config/strategy-v2-r2.json`

---

## 1. Context and Diagnosis from Round 1 and Harness Reconciliation

### A. The Core Mathematical Barrier in Round 1
The Round 1 audit and cost decomposition proved that **cost drag relative to stop distance is the single dominant driver of trading bot failure**:
1. **Friction-to-Stop Ratio:** Candidate C1 used tight ATR stops (~0.70% of notional). With taker fees of 0.06% entry + 0.06% exit + 0.02% slippage entry + 0.02% slippage exit (total 0.16% round-trip), execution drag consumed **23% of the entire stop distance** on every single trade (`0.21R` to `0.23R` per trade).
2. **Win Rate Impossibility:** At a 0.23R cost tax, break-even win rate rose from 24% to over 35%, while actual realized win rate was only 10.6% - 13.9%, driving a 64% drawdown across 445 trades.
3. **C2 Structural Advantage:** Candidate C2 (4h Donchian Trend Follower) achieved positive gross P&L (+$39.59) and only $378 in costs over 57 trades because wider stops (holding ~62.4 hours) reduced fee drag to `0.12R`.

### B. Non-Negotiable Architectural Requirements for Round 2
1. **Mandatory Cost Gating:** No trade may ever be taken unless the stop distance is wide enough to render exchange friction negligible:
   $$\text{Stop Distance \%} \ge 8 \times \text{Round-Trip Cost \%}$$
2. **Maker-Only Execution for Intraday Trades:** Eliminate entry slippage entirely and reduce entry fees from 0.06% to 0.02% by using limit orders filled strictly through-tick.
3. **Higher Timeframe Regime:** Shift primary trend capture to 4h and 1h intervals to let winners run and suppress turnover.

---

## 2. Round 2 Candidate Specifications

### Candidate R2-A: 4h Donchian Breakout Trend-Follower
- **Target Universe:** Tokenized US Equity Perps & Major Crypto Perps (BTC, ETH, SOL).
- **Timeframe:** 4-Hour (4H) continuous candles.
- **Entry Logic:**
  - **LONG:** Current bar breaks strictly above the highest high of the prior 55 4h bars:
    $$\text{Price} > \max(\text{High}_{t-55 \dots t-1})$$
  - **SHORT:** Current bar breaks strictly below the lowest low of the prior 55 4h bars:
    $$\text{Price} < \min(\text{Low}_{t-55 \dots t-1})$$
- **Order Execution:** Stop-market order filled at next bar open with 0.02% slippage and 0.06% taker fee.
- **Cost Gate:** Stop distance $\ge 8 \times (2 \times (0.0006 + 0.0002)) = 1.28\%$.
- **Risk & Stop Loss:**
  - Initial Stop: $3.0 \times \text{ATR}(14)$ from entry.
  - Trailing Stop: Follows the extreme close since entry at distance $3.0 \times \text{ATR}(14)$. Stop strictly ratchets in the trade direction and never moves backwards.
- **Take Profit:** None (pure trend following until trailing stop is breached).

---

### Candidate R2-B: 15m Pullback in 1h Trend (Maker-Only)
- **Target Universe:** Tokenized US Equity Perps & Major Crypto Perps (BTC, ETH, SOL).
- **Timeframe:** 15-Minute execution within 1-Hour trend regime.
- **Trend Regime (1H):**
  - **BULLISH:** 1h $\text{EMA}(20) > \text{EMA}(50)$ AND 1h $\text{Close} > \text{EMA}(50)$.
  - **BEARISH:** 1h $\text{EMA}(20) < \text{EMA}(50)$ AND 1h $\text{Close} < \text{EMA}(50)$.
- **Pullback & Maker Entry Logic:**
  - In a Bullish 1h regime, if 15m price pulls back, place a **Limit Buy order** at the 15m $\text{EMA}(20)$.
  - In a Bearish 1h regime, if 15m price rallies, place a **Limit Sell order** at the 15m $\text{EMA}(20)$.
- **Strict Fill & Expiration Rules:**
  - **Through-Tick Fill Condition:** The order is filled **only** if the subsequent bar trades strictly through the limit price:
    - Long Fill: $\text{Bar Low} < \text{Limit Price}$.
    - Short Fill: $\text{Bar High} > \text{Limit Price}$.
  - **Zero Slippage on Entry:** Fills at limit price.
  - **Maker Fee Rate:** $0.02\%$ applied on entry.
  - **Time-in-Force Expiration:** Limit order cancels automatically after 4 bars (1 hour) if unfilled.
- **Cost Gate:** Stop distance $\ge 8 \times (0.0002 + 0.0006 + 0.0002) = 0.80\%$.
- **Risk & Stop Loss:** Initial stop at $2.0 \times \text{ATR}(14)$.
- **Take Profit Target:** Fixed $3.0\text{R}$ target ($3 \times \text{Stop Distance}$).

---

## 3. Universal Risk & Execution Rules

- **Account Base:** $\$10,000$ initial capital.
- **Risk Budget:** $0.5\%$ of equity per trade ($\$50$ base).
- **Max Concurrent Positions:** 3 positions across the entire portfolio.
- **Correlation Cap:** Maximum 1 open position per sector / correlation group.
- **Daily Loss Lockout:** 2.0% of day's starting equity locks new entries until 00:00 UTC.
- **Consecutive Loss Pause:** 3 consecutive losses pause trading until 00:00 UTC reset.

---

## 4. Evaluation Splits & Holdout Integrity

1. **Dev Split (In-Sample):** 2026-05-11T17:30:00Z to 2026-09-11T15:00:00Z (122.9 days).
2. **Validation Split (Out-of-Sample):** 2026-09-11T15:00:00Z to 2026-10-10T00:00:00Z (28.4 days).
3. **Forward Holdout Split:** 2026-10-10T00:00:00Z to 2026-10-19 (Present).
   - **LOCK COMMITMENT:** The forward holdout remains **strictly unopened and locked**. It will NOT be run unless a candidate passes all criteria on both Dev and Validation splits.

---

## 5. Frozen Pass / Fail Criteria

A candidate is certified as **PASS** only if it simultaneously satisfies all five criteria on both Dev and Validation splits:
1. **Net P&L:** $> \$0.00$ (strictly positive after all fees, slippage, and funding).
2. **Profit Factor:** $\ge 1.25$.
3. **Statistical Significance:** $\ge 30$ realized closed trades.
4. **Drawdown Risk:** $\le 15.0\%$ peak-to-trough equity drawdown.
5. **Cost Robustness:** Fixed-trade-list cost sensitivity at $2\times$ costs remains positive ($\text{Net P\&L}_{2\times} > \$0.00$).

If neither candidate passes all five criteria, **failure will be stated plainly and honestly**, the forward holdout will remain closed, and no claims of profitability will be made.
