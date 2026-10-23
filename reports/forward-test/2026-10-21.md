# VT2 Forward-Test & Paper Trading Daily Report: 2026-10-21

- **Report Timestamp:** 2026-10-21T22:46:00.569Z
- **Git Branch:** `v2`
- **Pre-Registration Commit:** `33beca481f2f20904faa57135f36e092cba399ff`
- **R2 Strategy Config Hash:** `ef534fcd2801`
- **v1 Strategy Config Hash:** `97d12ccea9b5`

## 1. Forward Holdout Split Governance

> [!IMPORTANT]
> **FORWARD HOLDOUT SPLIT (2026-10-10 to Present) STATUS: STRICTLY CLOSED**
>
> In accordance with the pre-registered research protocol in `reports/strategy-v2/PREREGISTRATION_R2.md` and `config/strategy-v2-r2.json`, the forward holdout split is locked until a strategy candidate passes **both** Dev (In-Sample) and Validation (Out-of-Sample) pass criteria.
> Neither Candidate R2-A nor Candidate R2-B passed the dual-split criteria during Round 2 validation, preserving statistical purity and preventing holdout contamination.

## 2. Live Paper Account Summary

| Metric | Current Value |
|---|---|
| Account Balance | $10000.00 |
| Account Equity | $10000.00 |
| Realized Net P&L | $10.82 |
| Total Fees Paid | $2.01 |
| Total Closed Trades | 2 |
| Win Rate | 100% (2W / 0L) |
| Active Open Positions | 2 |

## 3. Active Open Positions

| ID | Symbol | Side | Entry Price | Current Price | Qty | Unrealized P&L | Stop Loss | Take Profit |
|---|---|---|---|---|---|---|---|---|
| paper-pos-0c5df597 | FILUSDT | LONG | $1.2489 | $1.2389 | 500.18 | $-5.00 | $1.2385 | $1.2716 |
| paper-pos-8fe9e8bd | TSLAUSDT | LONG | $383.7367 | $383.8006 | 2.61 | $0.17 | $381.7417 | $387.8803 |

## 4. Trade Journal (Recent Forward Executions)

| Timestamp | Symbol | Side | Strategy ID | Config Hash | Entry | Exit | Net P&L | ROI % | Holding Time | Exit Reason |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-12 12:07:25 | COSTUSDT | LONG | `v1.0.0` | `none` | $946.6093 | $956.6392 | $10.12 | 1.01% | 1099m | TAKE_PROFIT_FINAL |
| 2026-10-12 09:50:23 | MSFTUSDT | LONG | `v1.0.0` | `none` | $535.4971 | $536.1396 | $0.70 | 0.07% | 956m | STOP_LOSS |

## 5. Execution Integrity & Safety Verification

- **Execution Mode:** PAPER simulation (default).
- **Mainnet Protection:** Hard-coded guardrails active; DEMO/LIVE blocked on hosted site.
- **Position Cap:** Max 3 concurrent positions, 1 correlation group limit.
- **Cost-Gating Rule:** Stop distance $\ge 8 \times \text{round-trip cost}$ enforced on new candidate setups.
