const fs = require('fs');
const path = require('path');

const cryptoConfigPath = path.resolve('config/crypto-perps.json');
const cryptoConfig = JSON.parse(fs.readFileSync(cryptoConfigPath, 'utf8'));

console.log('=== Configured Crypto Symbols in config/crypto-perps.json ===');
console.log(cryptoConfig.map(c => `${c.rank}. ${c.symbol} (${c.description})`).join('\n'));

console.log('\n=== Checking data/history/ for 15m, 4h, 1d Files ===');
const historyDir = path.resolve('data/history');

const results = [];
for (const item of cryptoConfig) {
  const sym = item.symbol;
  const files15m = path.join(historyDir, `${sym}_15m.json`);
  const files4h = path.join(historyDir, `${sym}_4h.json`);
  const files1d = path.join(historyDir, `${sym}_1d.json`);

  const info = {
    symbol: sym,
    has15m: fs.existsSync(files15m),
    has4h: fs.existsSync(files4h),
    has1d: fs.existsSync(files1d),
    bars15m: 0,
    start15m: 'N/A',
    end15m: 'N/A',
    gaps15m: 'N/A'
  };

  if (info.has15m) {
    try {
      const content = JSON.parse(fs.readFileSync(files15m, 'utf8'));
      // Sort bars by timestamp
      const bars = Array.isArray(content) ? content : (content.candles || content.data || []);
      info.bars15m = bars.length;
      if (bars.length > 0) {
        // Find ts
        const getTs = b => Array.isArray(b) ? parseInt(b[0]) : (b.timestamp || b.ts || b.time);
        bars.sort((a, b) => getTs(a) - getTs(b));
        info.start15m = new Date(getTs(bars[0])).toISOString();
        info.end15m = new Date(getTs(bars[bars.length - 1])).toISOString();

        // Check 15m step (900000 ms)
        let gapCount = 0;
        for (let j = 1; j < bars.length; j++) {
          const diff = getTs(bars[j]) - getTs(bars[j - 1]);
          if (diff > 900000) gapCount++;
        }
        info.gaps15m = gapCount;
      }
    } catch (e) {
      info.bars15m = 'Error parsing: ' + e.message;
    }
  }

  results.push(info);
}

console.log('\nSymbol | Has 15m | 15m Bars | 15m Start | 15m End | 15m Gaps (>15m) | Has 4h | Has 1d');
console.log('---|---|---|---|---|---|---|---');
for (const r of results) {
  console.log(`${r.symbol} | ${r.has15m} | ${r.bars15m} | ${r.start15m} | ${r.end15m} | ${r.gaps15m} | ${r.has4h} | ${r.has1d}`);
}

// Also check all files in data/history that end with _15m.json
console.log('\n=== All _15m.json files in data/history ===');
const all15m = fs.readdirSync(historyDir).filter(f => f.endsWith('_15m.json'));
console.log(all15m.join(', '));
