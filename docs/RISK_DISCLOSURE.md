# Risk Disclosure and Plain-Language Limits

**IMPORTANT:** Read this document carefully before operating the VT2 trading bot or deploying simulated or real capital.

---

## 1. No Demonstrated Edge or Profitability

The VT2 software and its strategies are experimental quantitative research tools. **No strategy in this codebase has demonstrated a validated, statistically significant profitable edge after transaction costs.**

In audited pre-registered replay (trial 35), the as-shipped strategy (**S0**) produced:
- **Dev Period (2026-05-11 to 2026-09-11):** -$154.41 Net P&L (Profit Factor 0.99, 348 trades)
- **Validation Period (2026-09-11 to 2026-10-10):** -$647.91 Net P&L (Profit Factor 0.48, 34 trades)

Past backtest results, forward paper trading outcomes, and multi-agent deliberation commentary do not guarantee, promise, or predict future performance.

---

## 2. Transaction Costs Drag (Fees, Slippage, Funding)

Frequent trading models suffer severe performance drag from cumulative market frictions:
- **Taker Fees:** Bitget contract taker fees (0.05% per execution, 0.10% round-trip) consume a significant portion of small expected returns. Over 287 trades in the baseline backtest, taker fees consumed $2,541.
- **Slippage:** In fast-moving markets, order fills occur worse than the observed mid-price. Slippage of 0.02% per leg adds 0.04% round-trip friction.
- **Funding Carry:** Perpetuals accrue funding payments every 8 hours. Holding leveraged positions overnight or during high basis periods can generate adverse funding carry.
- **Tight Stops Multiply Drag:** When stop distances are tight (0.5%–0.8%), round-trip friction of ~0.14% represents **20% to 30% of the entire risk budget**, making profitable expectancy mathematically difficult without high win rates.

---

## 3. Tokenized Equities & Off-Hours Market Risk

Tokenized US equity perpetuals trade 24 hours a day, 7 days a week on Bitget. However, the underlying US stock markets (NYSE and NASDAQ) trade strictly from 09:30 to 16:00 ET, Monday through Friday.
- When underlying stock exchanges are closed, tokenized perpetuals trade with **reduced liquidity, wider bid-ask spreads, and potential basis dislocations**.
- Overnight and weekend news events in the underlying company can cause abrupt, unhedgeable price gaps when official markets open.

---

## 4. Leverage, Margin, and Liquidation Risk

Trading futures and perpetual contracts involves high risk:
- **Leveraged Losses:** Leverage multiplies both profits and losses. A 5x leveraged position loses 100% of allocated margin on a 20% adverse price move.
- **Liquidation:** If account margin falls below maintenance margin requirements, the exchange will forcefully liquidate the position, incurring additional liquidation penalties.
- **Isolated Margin:** VT2 strictly enforces isolated margin mode, but position losses remain real and irreversible.

---

## 5. Exchange and Counterparty Risk

- All orders routed to an external exchange depend on the exchange's matching engine, API reliability, server clocks, and regulatory standing.
- Network latency, rate limit throttling, exchange downtime, or maintenance windows can delay order routing, stop-loss execution, or position closures.
- Cryptocurrency and derivative exchanges carry custodial and solvency risks.

---

## 6. Software and Infrastructure Risk

- Algorithmic trading software contains inherent risks of programming bugs, logic flaws, connection dropouts, operating system updates, and clock skew.
- While VT2 contains extensive defensive programming (129 regression tests, kill switches, dollar-loss caps, and reconciliation monitors), no software is immune to failure.
- Never operate automated execution with funds you cannot afford to lose completely.

---

## 7. No Financial or Investment Advice

VT2 and all associated documentation, code, reports, and AI deliberation outputs are provided strictly for educational, informational, and research purposes. Nothing in this repository constitutes financial, investment, legal, or tax advice. You are solely responsible for evaluating your own financial situation and risk tolerance before engaging in trading.
