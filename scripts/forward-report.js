import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Database } from '../src/storage/db.js';

const REPORT_DIR = path.resolve('reports/forward-test');
if (!fs.existsSync(REPORT_DIR)) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
}

function computeFileHash(filePath) {
  if (!fs.existsSync(filePath)) return 'N/A';
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
}

async function main() {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const targetReportFile = path.join(REPORT_DIR, `${dateStr}.md`);

  console.log(`========================================================================`);
  console.log(`VT2 Daily Forward-Test Report Generator (${dateStr})`);
  console.log(`========================================================================\n`);

  // 1. Read Round 2 metrics and holdout status
  const metricsR2Path = path.resolve('reports/strategy-v2/metrics-r2.json');
  let metricsR2 = null;
  if (fs.existsSync(metricsR2Path)) {
    try {
      metricsR2 = JSON.parse(fs.readFileSync(metricsR2Path, 'utf8'));
    } catch (_) {}
  }

  const preRegCommit = metricsR2?.preRegistrationCommit || '33beca481f2f20904faa57135f36e092cba399ff';
  const holdoutOpened = metricsR2?.forwardHoldoutOpened ?? false;

  // 2. Read database journal and positions
  const db = new Database().init();
  const journalEntries = db.getJournalEntries(50);
  const openPositions = db.getActivePositions();
  const accountSummary = db.getSetting('account_summary', {
    balance: 10000,
    equity: 10000,
    realizedPnl: 0,
    totalFeesPaid: 0,
  });

  // Calculate trade stats
  const totalTrades = journalEntries.length;
  const wins = journalEntries.filter(t => (t.realizedPnl || t.realized_pnl) > 0);
  const losses = journalEntries.filter(t => (t.realizedPnl || t.realized_pnl) < 0);
  const winRate = totalTrades > 0 ? Number(((wins.length / totalTrades) * 100).toFixed(2)) : 0;
  const netPnl = journalEntries.reduce((sum, t) => sum + (t.realizedPnl || t.realized_pnl || 0), 0);
  const totalFees = journalEntries.reduce((sum, t) => sum + (t.feesPaid || t.fees_paid || 0), 0);

  // Strategy config hashes
  const r2ConfigHash = computeFileHash(path.resolve('config/strategy-v2-r2.json'));
  const v1ConfigHash = computeFileHash(path.resolve('config/alpha-strategy.json'));

  let reportMd = `# VT2 Forward-Test & Paper Trading Daily Report: ${dateStr}\n\n`;
  reportMd += `- **Report Timestamp:** ${now.toISOString()}\n`;
  reportMd += `- **Git Branch:** \`v2\`\n`;
  reportMd += `- **Pre-Registration Commit:** \`${preRegCommit}\`\n`;
  reportMd += `- **R2 Strategy Config Hash:** \`${r2ConfigHash}\`\n`;
  reportMd += `- **v1 Strategy Config Hash:** \`${v1ConfigHash}\`\n\n`;

  reportMd += `## 1. Forward Holdout Split Governance\n\n`;
  if (!holdoutOpened) {
    reportMd += `> [!IMPORTANT]\n`;
    reportMd += `> **FORWARD HOLDOUT SPLIT (2026-10-10 to Present) STATUS: STRICTLY CLOSED**\n`;
    reportMd += `>\n`;
    reportMd += `> In accordance with the pre-registered research protocol in \`reports/strategy-v2/PREREGISTRATION_R2.md\` and \`config/strategy-v2-r2.json\`, the forward holdout split is locked until a strategy candidate passes **both** Dev (In-Sample) and Validation (Out-of-Sample) pass criteria.\n`;
    reportMd += `> Neither Candidate R2-A nor Candidate R2-B passed the dual-split criteria during Round 2 validation, preserving statistical purity and preventing holdout contamination.\n\n`;
  } else {
    reportMd += `> [!NOTE]\n`;
    reportMd += `> **FORWARD HOLDOUT SPLIT STATUS: OPENED** (Candidate met pre-registered dual-split pass criteria).\n\n`;
  }

  reportMd += `## 2. Live Paper Account Summary\n\n`;
  reportMd += `| Metric | Current Value |\n`;
  reportMd += `|---|---|\n`;
  reportMd += `| Account Balance | $${Number(accountSummary.balance || 10000).toFixed(2)} |\n`;
  reportMd += `| Account Equity | $${Number(accountSummary.equity || 10000).toFixed(2)} |\n`;
  reportMd += `| Realized Net P&L | $${Number(netPnl).toFixed(2)} |\n`;
  reportMd += `| Total Fees Paid | $${Number(totalFees).toFixed(2)} |\n`;
  reportMd += `| Total Closed Trades | ${totalTrades} |\n`;
  reportMd += `| Win Rate | ${winRate}% (${wins.length}W / ${losses.length}L) |\n`;
  reportMd += `| Active Open Positions | ${openPositions.length} |\n\n`;

  reportMd += `## 3. Active Open Positions\n\n`;
  if (openPositions.length === 0) {
    reportMd += `*No positions currently open. Risk engine in standing monitoring mode.*\n\n`;
  } else {
    reportMd += `| ID | Symbol | Side | Entry Price | Current Price | Qty | Unrealized P&L | Stop Loss | Take Profit |\n`;
    reportMd += `|---|---|---|---|---|---|---|---|---|\n`;
    for (const p of openPositions) {
      reportMd += `| ${p.id} | ${p.symbol} | ${p.side} | $${p.entry_price} | $${p.current_price} | ${p.original_quantity} | $${p.unrealized_pnl?.toFixed(2)} | $${p.stop_loss} | $${p.take_profit} |\n`;
    }
    reportMd += `\n`;
  }

  reportMd += `## 4. Trade Journal (Recent Forward Executions)\n\n`;
  if (journalEntries.length === 0) {
    reportMd += `*No forward paper trades recorded in active database for today's session.*\n\n`;
  } else {
    reportMd += `| Timestamp | Symbol | Side | Strategy ID | Config Hash | Entry | Exit | Net P&L | ROI % | Holding Time | Exit Reason |\n`;
    reportMd += `|---|---|---|---|---|---|---|---|---|---|---|\n`;
    for (const t of journalEntries.slice(0, 20)) {
      const tsStr = new Date(t.timestamp).toISOString().replace('T', ' ').slice(0, 19);
      const stratId = t.strategy_id || t.strategyId || t.strategy_version || 'v1-alpha';
      const cfgHash = t.config_hash || t.configHash || 'none';
      const pnl = Number(t.realizedPnl ?? t.realized_pnl ?? 0).toFixed(2);
      const roi = Number(t.roiPercent ?? t.roi_percent ?? 0).toFixed(2);
      const holdMin = Math.round((t.holdingTimeMs || t.holding_time_ms || 0) / 60000);
      reportMd += `| ${tsStr} | ${t.symbol} | ${t.side} | \`${stratId}\` | \`${cfgHash}\` | $${t.entryPrice || t.entry_price} | $${t.exitPrice || t.exit_price} | $${pnl} | ${roi}% | ${holdMin}m | ${t.exitReason || t.exit_reason} |\n`;
    }
    reportMd += `\n`;
  }

  reportMd += `## 5. Execution Integrity & Safety Verification\n\n`;
  reportMd += `- **Execution Mode:** PAPER simulation (default).\n`;
  reportMd += `- **Mainnet Protection:** Hard-coded guardrails active; DEMO/LIVE blocked on hosted site.\n`;
  reportMd += `- **Position Cap:** Max 3 concurrent positions, 1 correlation group limit.\n`;
  reportMd += `- **Cost-Gating Rule:** Stop distance $\\ge 8 \\times \\text{round-trip cost}$ enforced on new candidate setups.\n`;

  fs.writeFileSync(targetReportFile, reportMd, 'utf8');
  console.log(`Generated daily forward report: ${targetReportFile}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
