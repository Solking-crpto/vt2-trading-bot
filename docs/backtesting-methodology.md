# Backtesting Methodology & Assumptions

## Chronological Walk-Forward Simulation

The VT2 backtesting engine (`src/backtest/engine.js`) evaluates historical OHLCV candle datasets step-by-step.

### 1. Zero Look-Ahead Bias
- At step $i$, all technical indicators (EMA, RSI, ATR) are computed strictly from the slice `candles[0...i]`.
- Future candle bars cannot influence past decisions.

### 2. Conservative Ambiguous Candle Resolution
- In bar-by-bar backtesting, if a single candle's high touches the take-profit level and its low touches the stop-loss level, the true tick sequence within that candle is unknown.
- **VT2 Rule:** The engine assumes the **stop loss was touched first**. This eliminates optimistic survival bias.

### 3. Realistic Friction Modeling
- **Taker Fee:** 0.05% on entry and exit.
- **Slippage:** 0.02% modeled market impact per side.
- **Funding:** Modeled 8h funding rate (0.01%).

### 4. Metrics Computed
- Total Trade Count
- Win Rate (%)
- Gross Profit / Gross Loss
- Profit Factor
- Net P&L ($)
- Maximum Drawdown ($ and %)
- Trade Expectancy ($ per trade)
- Average Holding Time (ms)
- Maximum Consecutive Losses
