const fs = require('fs');
const path = require('path');

console.log('=== Contents of config/alpha-strategy.json ===');
const alphaConfigPath = path.resolve('config/alpha-strategy.json');
const alphaConfig = JSON.parse(fs.readFileSync(alphaConfigPath, 'utf8'));
console.log(JSON.stringify(alphaConfig, null, 2));

console.log('\n=== Key Fields in config/alpha-strategy.json ===');
console.log('cooldownMinutes:', alphaConfig.cooldownMinutes);
console.log('minStopDistancePercent:', alphaConfig.minStopDistancePercent);
console.log('maxStopDistancePercent:', alphaConfig.maxStopDistancePercent);
console.log('stopLossAtrMultiple:', alphaConfig.stopLossAtrMultiple);
console.log('takeProfitRMultiple:', alphaConfig.takeProfitRMultiple);
console.log('riskPerTradePercent:', alphaConfig.riskPerTradePercent);
console.log('maxDailyLossPercent:', alphaConfig.maxDailyLossPercent);
console.log('maxDrawdownPercent:', alphaConfig.maxDrawdownPercent);
console.log('maxOpenPositions:', alphaConfig.maxOpenPositions);
console.log('maxSignalAgeMinutes:', alphaConfig.maxSignalAgeMinutes);
console.log('minNetRewardToRisk:', alphaConfig.minNetRewardToRisk);

console.log('\n=== Searching src/ for Cooldown and Stop Band Constants ===');

function searchDir(dir, pattern) {
  const files = fs.readdirSync(dir, { withFileTypes: true });
  for (const f of files) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) {
      searchDir(full, pattern);
    } else if (f.isFile() && (f.name.endsWith('.ts') || f.name.endsWith('.js'))) {
      const content = fs.readFileSync(full, 'utf8');
      const lines = content.split('\n');
      lines.forEach((l, idx) => {
        if (pattern.test(l)) {
          console.log(`${path.relative(process.cwd(), full)}:${idx + 1}: ${l.trim()}`);
        }
      });
    }
  }
}

console.log('\n-- Cooldown references in src/ --');
searchDir(path.resolve('src'), /cooldown/i);

console.log('\n-- Stop band (minStop / maxStop / stopLoss / 0.5 / 0.8 / 3.0) in src/ --');
searchDir(path.resolve('src'), /stop.*(?:distance|percent|band|min|max)|0\.8|0\.008|0\.03|3\.0/i);
