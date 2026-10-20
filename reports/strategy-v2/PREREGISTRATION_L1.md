# VT2 Strategy v2: Long-History Pre-Registration Protocol (Candidate L1)

**Protocol Version:** 3.0.0-L1  
**Timestamp:** 2026-10-20T17:30:00.000Z  
**Author:** VT2 Engineering & Quantitative Research  
**Target Instruments:** `BTCUSDT`, `ETHUSDT` (USDT-Margined Perpetual Futures)  
**Timeframe:** 1D (Daily Candles, 00:00 UTC Close)  

---

## 1. Motivation & Context
Previous rounds tested intraday 15m and 4h trend/pullback rules on a 5-month window (May to October 2026), where high turnover relative to stop distance rendered exchange friction insurmountable. 

Candidate L1 tests a classical, low-turnover, multi-year trend filter across full crypto market cycles (bull runs, 70-80% bear markets, and distribution phases) spanning July 2019 to Present (>7 years).

---

## 2. Strategy Specification (Candidate L1)

### A. Position & Allocation Rules
- **Portfolio Construction:** 50/50 Equal-Weight between `BTCUSDT` and `ETHUSDT`.
  - When both assets qualify: 50% portfolio equity allocated to BTC Long, 50% to ETH Long.
  - When only one asset qualifies: 50% allocated to the qualifying asset, 50% held in cash.
  - When neither asset qualifies: 100% held in cash (flat).
- **Signal Logic:**
  - **LONG:** Daily close strictly above its 100-day Simple Moving Average:
    $$\text{Close}_{1\text{D}, t} > \text{SMA}_{100}(\text{Close}_{1\text{D}})$$
  - **FLAT:** Daily close at or below its 100-day SMA:
    $$\text{Close}_{1\text{D}, t} \le \text{SMA}_{100}(\text{Close}_{1\text{D}})$$
- **Execution Timing:** Signal evaluated on daily candle close at 00:00 UTC; orders executed at the open of the subsequent daily candle ($t+1$) with next-bar open fill. Zero look-ahead bias.

### B. Execution Costs & Friction
- **Taker Fee:** $0.06\%$ (`0.0006`) applied on every position entry and exit.
- **Execution Slippage:** $0.02\%$ (`0.0002`) applied on every position entry and exit.
- **Carry / Funding Cost:** Actual historical funding rate paid continuously while long positions are active. (Funding rate for USDT-FUTURES perps is charged/received every 8 hours).

### C. Benchmark
- **Equal-Weight Buy-and-Hold:** 50% `BTCUSDT` + 50% `ETHUSDT` held unconditionally across identical calendar dates.

---

## 3. Data Splits (By Calendar Date)

1. **Dev Split (In-Sample Training):**  
   From first available date (~August 2019, after 100-day SMA warmup) through **December 31, 2023** (4.4 years).
2. **Validation Split (Out-of-Sample Confirmation):**  
   **January 1, 2024** through **December 31, 2025** (2.0 years).
3. **Forward Holdout Split:**  
   **January 1, 2026** through Present (**October 20, 2026**).  
   *LOCK COMMITMENT:* Evaluated strictly ONCE, only if candidate passes all criteria on both Dev and Validation.

---

## 4. Pre-Declared Pass Criteria

A candidate is certified as **PASS** if and only if, in **Dev AND Validation separately**:
1. **Net Return After Costs > 0:** Strategy must be profitable net of taker fees, slippage, and cumulative funding.
2. **Drawdown Reduction:** Max Drawdown $\le 60\%$ of Buy-and-Hold's Max Drawdown over the identical period:
   $$\text{MaxDD}_{\text{L1}} \le 0.60 \times \text{MaxDD}_{\text{BuyHold}}$$
3. **Return-to-Drawdown Efficiency:** The ratio of Total Return to Max Drawdown must exceed that of Buy-and-Hold:
   $$\frac{\text{Return}_{\text{L1}}}{\text{MaxDD}_{\text{L1}}} > \frac{\text{Return}_{\text{BuyHold}}}{\text{MaxDD}_{\text{BuyHold}}}$$

### Expected Theoretical Profile:
A trend filter's primary economic benefit is **drawdown compression** (avoiding catastrophic bear market drawdowns of 70–80%), rather than maximizing raw upside during vertical bull runs.

---

## 5. Deployment Boundary
If Candidate L1 passes, it becomes eligible for **PAPER or DEMO forward testing only**. Under no circumstances does this authorization grant live mainnet execution.
