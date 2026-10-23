# VT2 Strategy v2: Pre-Registration Document

**Registration Date:** 2026-10-19T11:45:00.000Z  
**Branch:** `v2`  
**Base Commit / Tag:** `hackathon-submission`  
**Purpose:** Pre-registering hypothesis, candidates C1 & C2, ablation plan on v1, split boundaries, and immutable pass criteria before any backtest execution.

---

## 1. Problem Statement & Motivation

The VT2 v1 baseline strategy (`reports/alpha-factory/metrics.json`) operated with complex multi-timeframe confluence (4h alignment, 15m RSI bounds, 5m volume confirmation, benchmark SPY filter, 30m cooldown, strict stop distance bounds). Across 151.7 days on 19 tokenized US equity perpetual contracts, v1 produced:
- **Net P&L:** -$2,818.83 (-28.25% on $10,000 initial equity)
- **Trade Count:** 287 trades (turnover: 258.5x)
- **Win Rate:** 41.11%
- **Profit Factor:** 0.70
- **Cost Drag:** $2,223.72 in taker fees, $317.42 in funding carry, $889.52 in slippage.

Total trading costs totaled ~$3,430.70, indicating that the strategy was roughly flat gross before execution friction. **Over-trading and cost drag are the primary impediments to profitability.**

---

## 2. Pre-Registered Hypotheses & Design Goals

1. **Rule Simplification:** Reducing arbitrary indicator gates (e.g., tight RSI bounds, multi-timeframe 5m micro-confirmations) allows catching sustained momentum without generating frequent whipsaw entries.
2. **Cost Gate Protection:** No trade should be taken unless the expected target distance (in %) is at least $5\times$ the estimated round-trip execution cost ($2\times \text{taker fee} + 2\times \text{slippage}$).
3. **Session Filtering (E1):** Tokenized US equities trade 24/7 on Bitget, but price discovery predominantly occurs during US Regular Trading Hours (RTH: 09:30–16:00 ET). Filtering entries to RTH may reduce overnight spread and fakeout friction.
4. **Honest Validation:** We acknowledge that the validation period (2026-09-10 to 2026-10-10) was already inspected during v1 development ("contaminated validation"). A true forward holdout (2026-10-10 to 2026-10-19) is downloaded from Bitget and evaluated strictly **once**.

---

## 3. Data Splits

| Split | Start Date (UTC) | End Date (UTC) | Duration | Role in Protocol |
| :--- | :--- | :--- | :--- | :--- |
| **Dev (In-Sample)** | 2026-05-11 00:00 | 2026-09-10 00:00 | 122 days | Rule ablation, parameter verification |
| **Validation** | 2026-09-10 00:00 | 2026-10-10 00:00 | 30 days | Confirmation segment (contaminated validation) |
| **Forward Holdout** | 2026-10-10 00:00 | 2026-10-19 11:00 | ~9.5 days | Single-evaluation holdout for passing candidates |

---

## 4. Candidate Strategy Specifications

### C0: Baseline v1
- Preserved identically for direct comparison.

### C1: Trend Pullback (1h Trend, 15m Entry)
- **1h Trend Filter:** Long when $1\text{h close} > \text{EMA50}$ and $1\text{h EMA20} > \text{EMA50}$. Short when $1\text{h close} < \text{EMA50}$ and $1\text{h EMA20} < \text{EMA50}$.
- **15m Entry Trigger:** 15m close crosses back above EMA20 after at least one 15m close below EMA20 within the prior 6 bars (mirror for Short).
- **Stop Loss:** $1.5 \times \text{ATR}(14)$ on 15m.
- **Take Profit:** Fixed $2.5R$ target.
- **Breakeven Trigger:** Move stop to entry $+ 0.05\%$ once unrealized gain hits $+1.0R$.
- **Cost Gate:** Target distance in $\%$ must be $\ge 5 \times$ round-trip cost $\%$.

### C2: 4h Breakout Trend-Follower
- **4h Regime & Breakout:** Long when $4\text{h close} > \text{EMA50}$ and $4\text{h close} > \max(\text{High}_{20})$ of the prior 20 bars, with $4\text{h volume} \ge 1.0 \times \text{SMA}(20)$ volume (mirror for Short).
- **Stop Loss:** $2.0 \times \text{ATR}(14)$ on 4h.
- **Exit Rules:** Trailing stop at $3.0 \times \text{ATR}$ from highest close since entry, OR a 4h close beyond EMA20 (Long: close < EMA20; Short: close > EMA20). No fixed target.
- **Cost Gate:** Expected gain/stop distance must be $\ge 5 \times$ round-trip cost $\%$.

### Session Variants
- **E0:** 24/7 continuous entries.
- **E1:** Entries restricted to US Regular Trading Hours (09:30–16:00 ET, `America/New_York`), accounting for NYSE holidays and weekends.

---

## 5. Execution & Cost Parameters

- **Taker Fee Rate:** 0.06% (0.0006) per fill (verified against Bitget contracts API).
- **Maker Fee Rate:** 0.02% (0.0002) per fill.
- **Base Slippage:** 0.02% (0.0002) per fill.
- **Slippage Sensitivity Test:** 2x sensitivity (0.04% per fill).
- **Funding Rate:** 0.01% per 8-hour period adverse carry.
- **Fill Timing:** Strictly `NEXT_BAR_OPEN` with closed bars only (zero look-ahead).
- **Ambiguous Bars:** Resolved conservatively as `STOP_FIRST`.
- **Limit (Maker) Fills:** Counted as filled only if subsequent price trades strictly through the limit price.

---

## 6. Immutable Pass Criteria

A candidate passes if and only if, on **Dev** AND **Validation** separately:
1. **Net P&L after all costs:** $> \$0.00$
2. **Profit Factor:** $\ge 1.15$
3. **Trade Count:** $\ge 30$ trades
4. **Max Drawdown:** $\le 20.0\%$

**Forward Holdout Evaluation Protocol:**
- Only a candidate meeting all four criteria on BOTH Dev and Validation is evaluated on the Forward Holdout.
- The Forward Holdout is executed strictly **once**.
- If no candidate passes, this will be stated explicitly with appropriate risk recommendations.
- Multiple hypothesis testing penalty: acknowledge that testing multiple candidates inflates type I error rate.
