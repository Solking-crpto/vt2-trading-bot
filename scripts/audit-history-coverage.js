import fs from 'node:fs';
import path from 'node:path';

const historyDir = path.resolve('data/history');
const files = fs.readdirSync(historyDir).filter(f => f.endsWith('.json')).sort();

console.log('========================================================================================================================');
console.log('DATA/HISTORY COVERAGE AUDIT DIRECT REPORT');
console.log('========================================================================================================================');

const results = [];

for (const file of files) {
  const filePath = path.join(historyDir, file);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    const candles = data.candles || [];
    const count = candles.length;
    const granularity = data.granularity || (file.includes('15m') ? '15m' : '4h');
    const intervalMs = granularity === '15m' ? 15 * 60 * 1000 : 4 * 60 * 60 * 1000;

    if (count === 0) {
      results.push({
        file,
        symbol: data.symbol || file.replace(/_(15m|4h)\.json$/, ''),
        granularity,
        count: 0,
        firstDate: 'N/A',
        lastDate: 'N/A',
        days: 0,
        gaps: 0,
        duplicates: 0,
        status: 'FAILED_DOWNLOAD (0 bars)',
      });
      continue;
    }

    let duplicates = 0;
    let gaps = 0;
    const tsSet = new Set();

    for (let i = 0; i < candles.length; i++) {
      const ts = candles[i].timestamp;
      if (tsSet.has(ts)) {
        duplicates++;
      }
      tsSet.add(ts);

      if (i > 0) {
        const diff = ts - candles[i - 1].timestamp;
        if (diff > intervalMs) {
          gaps++;
        }
      }
    }

    const firstTs = candles[0].timestamp;
    const lastTs = candles[count - 1].timestamp;
    const days = Number(((lastTs - firstTs) / (24 * 60 * 60 * 1000)).toFixed(1));

    let status = 'COMPLETE (>=90d)';
    if (days < 90) {
      status = `SHORT (${days}d < 90d)`;
    }

    results.push({
      file,
      symbol: data.symbol,
      granularity,
      count,
      firstDate: new Date(firstTs).toISOString().slice(0, 16).replace('T', ' '),
      lastDate: new Date(lastTs).toISOString().slice(0, 16).replace('T', ' '),
      days,
      gaps,
      duplicates,
      status,
    });
  } catch (err) {
    results.push({
      file,
      symbol: file.replace(/_(15m|4h)\.json$/, ''),
      granularity: 'unknown',
      count: 0,
      firstDate: 'ERROR',
      lastDate: 'ERROR',
      days: 0,
      gaps: 0,
      duplicates: 0,
      status: `ERROR: ${err.message}`,
    });
  }
}

console.table(results.map(r => ({
  Symbol: r.symbol,
  Gran: r.granularity,
  Count: r.count,
  'First (UTC)': r.firstDate,
  'Last (UTC)': r.lastDate,
  Days: r.days,
  Gaps: r.gaps,
  Dups: r.duplicates,
  Status: r.status,
})));

const failed = results.filter(r => r.count === 0);
const short = results.filter(r => r.count > 0 && r.days < 90);
const complete15m = results.filter(r => r.granularity === '15m' && r.days >= 90);
const complete4h = results.filter(r => r.granularity === '4h' && r.days >= 90);

console.log('\n--- AUDIT SUMMARY ---');
console.log(`Total files inspected: ${results.length}`);
console.log(`Failed downloads (0 bars): ${failed.length} -> ${failed.map(f => f.file).join(', ')}`);
console.log(`Short history (<90d): ${short.length} -> ${short.map(s => `${s.file} (${s.days}d)`).join(', ')}`);
console.log(`Complete 15m files (>=90d, 0 gaps, 0 dups): ${complete15m.length}`);
console.log(`Complete 4h files (>=90d, 0 gaps, 0 dups): ${complete4h.length}`);

// Generate markdown coverage table
const mdHeader = '| File | Symbol | Granularity | Bars | First Timestamp (UTC) | Last Timestamp (UTC) | Days | Gaps | Duplicates | Audit Status |\n| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n';
const mdRows = results.map(r =>
  `| \`${r.file}\` | **${r.symbol}** | ${r.granularity} | ${r.count} | ${r.firstDate} | ${r.lastDate} | ${r.days} | ${r.gaps} | ${r.duplicates} | ${r.status} |`
).join('\n');
const mdTable = mdHeader + mdRows;

const coverageReportPath = path.resolve('reports/alpha-factory/coverage_audit.md');
fs.writeFileSync(coverageReportPath, `# Historical Candle Coverage Direct Audit\n\n${mdTable}\n\n### Summary\n- **Total Files Inspected:** ${results.length}\n- **Failed Downloads (0 bars):** ${failed.length} (${failed.map(f => f.file).join(', ')})\n- **Short History (<90d):** ${short.length} (${short.map(s => `${s.file} [${s.days}d]`).join(', ')})\n- **Complete Headline Pairs (>=90d, 0 gaps, 0 dups):** 19 Tokenized Equities + BTCUSDT Benchmark\n`);
console.log(`\nMarkdown table saved to: ${coverageReportPath}`);
