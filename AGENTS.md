# VT2 Master Instruction v2

You are finishing an **existing** project, not rebuilding it. Audit first, change the minimum, prove everything with saved raw outputs. This replaces the earlier "Bitget Multi-Asset Bot" master prompt: use it as a requirements list, and follow the decisions below where they differ.

## Non-negotiables

1. **Do not rebuild infrastructure.** Do not replace the server, database layer, scanner, risk engine, paper engine, bot loop, or hosted browser-paper mode. Extend them.
2. **Do not change the Stocks | Crypto | Both market toggle** (behavior, position, or labels). The new mode control is a separate control.
3. **The target is the `main` app.** The work lands on `main`: first by merging the existing `v2` branch (it already holds the mode state machine, caps, strategy registry, analyst, service and CI), then by short-lived `feat/<name>` branches merged back to `main`. Never move or delete the `hackathon-submission` tag, and never edit `reports/alpha-factory/`, `config/alpha-strategy.json`, or any pre-registration file. Before the first merge create `backup/main-before-merge`. The hosted production site is public and **under judging: it must never be left broken.** After every push to `main`, run the production smoke test; if it fails, revert immediately.
4. **Evidence:** every number or claim in your report must come from a saved script output under `reports/launch/` (path given), otherwise write UNVERIFIED. No prose "everything works" summaries. If you hit repeated network or capacity errors, stop and say so.
5. **Safety:** never enable or start LIVE. Never place a real order. No secrets in code, logs, DB, browser, or git. Hosted/serverless mode can never enter DEMO or LIVE. The stricter limit always wins (`config/live-limits.json` caps override any selector).
6. **No profitability claims anywhere.** The shipped strategy (S0) is UNVALIDATED (failed its pre-registered replay, trial 35). Keep that status visible.
7. Run `npm test` once at the end (`node --test --test-force-exit --test-timeout=60000`). One task at a time; commit after each; do not start a task until the previous one's outputs are saved.

## Known state (verify each by command; do not trust this list)

Reported as built on the `v2` branch (not yet on `main`): PAPER/DEMO/LIVE state machine with arming, caps, kill switch, `BitgetTradeClient`, reconciliation, per-mode journal tags, strategy registry with "UNVALIDATED" status, control token plus `127.0.0.1` binding, PM2 service, CI workflow, advisory AI analyst (text only, disabled without key), hosted browser-paper mode on `main` (Vercel). Not done: the Demo round trip (needs my Demo key), long unattended runs.

## Task 0: Bring the `v2` work onto `main` safely (do this first)

1. `git branch backup/main-before-merge main`. Confirm the `hackathon-submission` tag still points where it did.
2. Merge `erratum` into `main` first (docs only), then merge `v2` with `--no-ff`. Resolve conflicts in `README.md`, `SUBMISSION.md` and `docs/ERRATA.md` by keeping the corrected, evidence-backed wording (the `v2` ERRATA cites raw source lines). Before committing the merge, save `git diff --stat main` to `reports/launch/00_merge_diffstat.txt` and list any research artifact folders being added (`reports/strategy-v2`, `reports/audit`, `scratch`); keep the honest research records, but confirm none contains secrets or absolute local paths.
3. **Hosted regression risk to fix before pushing:** the `v2` control-token check returns 401 for control endpoints (including `/api/demo/order`, `/api/demo/close`, `/api/orders/paper`, `/api/ai/*`), and the token is injected only into HTML served by the local Node server. On Vercel the HTML is served statically, so no token is injected and **the hosted demo's paper trading would break**. Fix: enforce the token only in the local server. In hosted/`DEMO_READONLY` mode the stateless `/api/demo/*` endpoints operate on browser-held paper state and have no real control surface, so they must not require it. Add tests that run the serverless handler with `VERCEL=1` and assert: `/api/demo/order`, `/api/demo/tick`, `/api/demo/close`, `/api/demo/close-all` return 200 (or a normal validation error) and never 401; `/api/mode` refuses DEMO and LIVE; AI endpoints report disabled; `/api/orders/live` and non-PAPER `/api/environment` still return 403. Also confirm that `127.0.0.1` binding and `HOST` do not affect the serverless build.
4. Run `npm test` and the local UI smoke test. Then push `main`, wait for the Vercel production deploy, and run the UI smoke test against the production URL. Save all raw outputs under `reports/launch/`. If anything fails: `git revert -m 1 <merge commit>`, push, confirm the production smoke test passes again, and report the failure. Never force-push. Vercel's dashboard also offers instant rollback to the previous deployment; say so in `docs/RUNBOOK.md`.
5. After the merge, do each remaining task on a short-lived `feat/<name>` branch from `main`: tests, local smoke test, merge, push, production smoke test.

## Task 1: Audit against the requirements list (no code changes)

Create `reports/launch/00_audit.md` **generated by a script** that inspects the repo and, for each numbered requirement below, prints: `IMPLEMENTED (file:line)`, `PARTIAL`, `MISSING`, or `CONFLICTS`, with evidence. Requirements to check: separate stats/journal per mode; mode banner colors; switching blocked unless flat; LIVE gating (env flag, valid live keys, preflight incl. clock drift under 1s, typed confirmation, starts armed-but-paused); kill switch; SL placement failure closes the position; restart recovery that reconciles with exchange state; fees read from the API (not hard-coded); symbols, tick sizes and trading hours from the API (not hard-coded); timeouts, retries with backoff, rate-limit handling on every external call; secrets only in env; isolated margin only; effective-risk readout; risk selector; live-readiness gate; auto-disable buckets; Telegram/webhook alerts; trade CSV export. Also compare the entry rules actually implemented in code to the crypto rules in the old master prompt (volume spike 1.5x of 20 candles, 4h close > EMA200, 15m RSI 45-68, 5m EMA20, BTC filter, signal freshness) and list every difference. Also list the stock rules in code versus the old prompt (session-only, VWAP, SPY/QQQ filter, force-flat before close, earnings skip) as MISSING or PARTIAL.

## Task 2: PAPER / DEMO / LIVE toggle (extend what exists)

- Add a **mode dropdown** (a styled select or custom dropdown, not buttons) in the top bar as its own control, next to (not replacing or restyling) the existing Stocks | Crypto | Both control. Options: `PAPER (simulated)`, `DEMO (Bitget demo funds)`, `LIVE (real money)`. The closed control shows the active mode in its color (PAPER blue, DEMO amber, LIVE red), plus a persistent banner on every tab. Choosing DEMO or LIVE runs the existing checks and dialogs; if a check fails or I cancel, the dropdown reverts to the previous mode and shows the reason. It must be keyboard accessible and usable at mobile widths.
- Local app: the toggle must follow the rules already implemented (never persisted as LIVE; hard caps; arming; typed phrase; validation-status acknowledgement). Add whatever Task 1 found MISSING from: switching blocked unless flat in the current mode, `I_UNDERSTAND_LIVE_RISK=true` as an additional required env flag (keep `LIVE_TRADING_ENABLED` and our stricter typed phrase), and "armed but paused" until the user presses Start.
- **Hosted site (`DEMO_READONLY`)**: the same dropdown is visible with PAPER selected and the DEMO and LIVE options `disabled`, labeled "DEMO (local app only)" and "LIVE (local app only)", with a note "Needs your own Bitget keys. The hosted demo is paper-only by design." Add a test that hosted mode cannot switch, even by calling the API directly.
- DEMO covers only the contracts Bitget lists in demo (3 crypto contracts at last check; read the list from the API). Equities in DEMO or LIVE mode must say "PAPER only: no Bitget demo contracts" for DEMO.
- Stats, journal and equity curve are shown per mode and per asset class and never mixed (verify the endpoints filter by mode).

## Task 3: Risk selector with effective-risk readout (PAPER and DEMO only)

- A **dropdown** with presets 1%, 5%, 10%, 25%, 50%, 100%, plus "Custom" (which reveals a numeric field), with a red warning dialog above 10%. Leverage per asset class is also a dropdown limited to the cap in `config/profiles.json`. **The default stays at the existing 0.5%.** (A default of 50% is not acceptable for a strategy with no demonstrated edge; I may change it in config.)
- Sizing: `size = balance x risk% / stop distance`, then capped so margin never exceeds 90% of balance and leverage never exceeds the per-asset-class cap in `config/profiles.json`. Show the **effective risk** next to the selector, for example "Selected 50% -> effective X% (capped by leverage 3x, stop 0.6%)". In DEMO/LIVE also apply `config/live-limits.json` caps and show which cap bound.
- Tests: effective risk is correct under the leverage cap, under the margin cap, and under the live-limits cap; custom values above the cap are rejected or clamped with the reason shown.

## Task 4: "Bot Playbook" (working instructions for the bot, inside the app)

- `GET /api/bot/playbook` returns a JSON description **generated from the actual config and code constants** (not hand-written text): what the bot does each cycle, the account gates, entry rules as implemented, exit rules, limits (trades per day, concurrent positions, risk, daily loss, loss streak pause, cooldown), the market and mode in use, the strategy status (UNVALIDATED), and how to start, pause, stop and kill. A "Bot Playbook" panel in the Automated Trading tab renders it, and `npm run docs:bot` writes `docs/BOT_INSTRUCTIONS.md` from the same source so docs cannot drift from the code.
- Each skipped symbol shows a reason code. The top 5 ranked candidates show why the winner won (log this).
- Add a plain "How to run the bot" section: PAPER first, what the bot will and will not do, and the kill switch.

## Task 5: Live-readiness badge (informational only)

Show per mode and per asset class: trade count, net expectancy after real fees, max drawdown, errors in the last 7 days. The badge is green only if PAPER **and** DEMO each have at least 200 trades, positive net expectancy after fees, drawdown within limits, and zero unhandled errors in 7 days; otherwise it shows exactly what is missing ("0/200 trades"). Equities can never be green for DEMO (no demo contracts); say so. This badge never enables or blocks anything.

## Task 6: Items from the old prompt that are NOT built now

Do not implement these new trading rules now (they are untested and each adds a trial): stock session-only and force-flat rules, VWAP, SPY/QQQ filter, time stop, ADX/chop filter, chase filter, funding filter, crypto session filter, daily profit lock, auto-disable. Write them to `docs/BACKLOG.md` with the exact old-prompt wording, current status from Task 1, and the note "must be pre-registered and backtested before use; do not tune on past results". The existing `equityEntriesWhenUnderlyingClosed` setting may be set to `BLOCK` in config if I ask.

## Task 7: Launch verification

- Local: `npm start`, then run `npm run ui-smoke` against `http://localhost:3000` (extend it to click the mode toggle, assert hosted-only locks via a hosted-mode run, and assert the Stocks/Crypto/Both control still behaves as before). Save raw output.
- Hosted: after each push to `main` and its Vercel production deploy, run `npm run ui-smoke` against the production URL, and also check the dropdown (PAPER selected, DEMO and LIVE disabled) and a paper order from the scanner. Save raw output. If it fails, revert per Task 0.
- A judge-facing top section in `README.md` (on `main`): what the app is, what works, what is demo-only, the honest strategy status, how to run locally in 5 commands, and links to `docs/ERRATA.md`, `docs/RUNBOOK.md`, `docs/BOT_INSTRUCTIONS.md`.
- `docs/CHANGELOG_POST_SUBMISSION.md`: every change since the `hackathon-submission` tag, from `git diff --stat` and `git log`, no embellishment.

## Final report format

Per task: files changed (paths), saved raw outputs (paths), tests added, and anything UNVERIFIED or not done. End with the `npm test` count and `git log --oneline -10`.
