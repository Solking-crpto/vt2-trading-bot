# Security Checklist & Recovery Procedures

## Security Verification Checklist

- [x] **No Secrets in Code:** Zero API secrets, private keys, or passphrases in frontend or backend code.
- [x] **No Secrets in Git:** `.env` and `.env.*` ignored in `.gitignore`. Only sanitized `.env.example` committed.
- [x] **Strict Paper Enforcement:** `CURRENT_ENVIRONMENT = 'PAPER'`. Mainnet execution architecturally denied.
- [x] **Server-Side Validation:** `validateExecutionMode()` and `assertMainnetExecutionBlocked()` guard all endpoints.
- [x] **Fail-Closed Risk Engine:** Missing, non-finite, or contradictory inputs immediately reject orders.
- [x] **AI Containment:** AI agents can only propose structured JSON. They cannot directly invoke orders or bypass risk rules.
- [x] **No Testnet-to-Mainnet Fallback:** Separate, isolated adapter boundaries.
- [x] **Audit Trail:** Unauthorized execution attempts trigger timestamped `[SECURITY AUDIT]` console warnings.

## Incident & Recovery Procedures

1. **Unexpected Live Order Call Attempt:**
   - Any attempt to access `/api/orders/live` is instantly intercepted by `assertMainnetExecutionBlocked()` returning HTTP 403 Forbidden.
   - Server writes a `[SECURITY AUDIT]` message with IP, timestamp, and payload.

2. **Database Corruption / Recovery:**
   - Database is local SQLite (`data/vt2.db`).
   - Backup: Simply copy `data/vt2.db` or use SQLite backup.
   - Reset: Deleting `data/vt2.db` re-creates a clean, valid database on server restart.

3. **Feed Failure or Rate Limiting:**
   - Adapter catches connection errors and seamlessly switches to verified simulated fixtures with clear user alerts.
