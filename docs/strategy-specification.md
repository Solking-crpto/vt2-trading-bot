# Quantitative Strategy Specification

**Status:** Configurable Research Strategy  
**Disclaimer:** Past performance does not guarantee future results.

## Strategy Architecture

The VT2 initial strategy is designed as a multi-timeframe quantitative trend-continuation system combining macro Bitcoin regime filtering, intermediate market structure, volume expansion, and momentum verification.

### 1. Instrument Universe

- Eligible, liquid Bitget USDT perpetual contracts:
  - `BTCUSDT`
  - `ETHUSDT`
  - `SOLUSDT`
  - `XRPUSDT`
  - `DOGEUSDT`

### 2. Timeframes & Indicators

| Timeframe | Role | Key Indicators |
|---|---|---|
| **4h** | Macro Trend & Regime | EMA 20, EMA 50, EMA 200, 4h ATR (14) |
| **15m** | Intermediate Setup & Stop | EMA 50, 15m RSI (14), 15m ATR (14) |
| **5m** | Execution Trigger & Volume | 5m EMA 20, Relative Volume (RVOL 20), 5m ATR (14) |

### 3. Rules & Filters

- **Bitcoin Macro Filter:**
  - Longs favored only when BTC 4h price is above 4h EMA 50 (or bullish).
  - Shorts favored only when BTC 4h price is below 4h EMA 50 (or bearish).
  - Neutral BTC regimes trigger caution and lower setup confidence.

- **Stop Placement:**
  - Placed using 15m ATR.
  - Constrained to research boundaries:
    - Minimum distance: 0.5% of entry price.
    - Upper bound: 0.8% of entry price.

- **Target Placement:**
  - Placed using 4h ATR with an initial 1.8x multiplier.
  - Constrained to research target range: 1.1% to 3.0%.

- **Net Reward-to-Risk Threshold:**
  - Must achieve a minimum net R:R of **1.5:1** after accounting for round-trip exchange fees (0.05% taker × 2) and modeled slippage (0.02% × 2). Total round-trip drag = 0.14%.

- **Position Automations:**
  - **Partial Take-Profit:** At +1.1% ROI, closes 50% of the position.
  - **Breakeven Stop:** Moves remaining stop loss to `entryPrice + 0.14% round-trip costs` immediately following partial exit.
  - **Trailing Stop:** Activates after +10.0% ROI, trailing behind the 5m EMA 20 with an ATR buffer:
    - Long: `max(stopLoss, ema20_5m - 0.5 * atr_5m)`
    - Short: `min(stopLoss, ema20_5m + 0.5 * atr_5m)`
  - **Early Exit Rule:** If 15m RSI reverses (crosses below 45 for longs or above 55 for shorts), closes position early to preserve capital.
