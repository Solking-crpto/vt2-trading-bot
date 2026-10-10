# Environment Isolation & Mainnet Denial Policy

## Environment Tiers

VT2 enforces three distinct environment tiers:

1. **PAPER (Active Development & Current Build)**:
   - Completely simulated orders and positions.
   - Initial virtual balance of $10,000 USDT.
   - Modeled taker/maker fees (0.05% / 0.02%), slippage (0.02%), and 8h funding (0.01%).
   - All results, metrics, and balances are explicitly marked `SIMULATED`.

2. **TESTNET / DEMO**:
   - Requires verified Bitget Demo API credentials.
   - Separate configuration and credentials.
   - Not enabled by default.

3. **MAINNET (Strictly Blocked)**:
   - Live order execution is architecturally denied on both client and server.
   - No live trading API secrets or keys are accepted or stored.
   - Any order directed to `/api/orders/live` or `/api/orders/mainnet` triggers a security alert and HTTP 403 Forbidden.

## Security Safeguards

- **Client-Side Interception:** No UI button or toggle can place live orders.
- **Server-Side Enforcement:** `validateExecutionMode()` and `assertMainnetExecutionBlocked()` throw `SafetyViolationError` if mainnet is targeted.
- **Audit Logging:** Every attempt to access mainnet is logged with a timestamped security audit record.
- **Zero Fallback:** A failed testnet or live request will never fall back to a simulated success, and simulated orders never touch exchange gateways.
