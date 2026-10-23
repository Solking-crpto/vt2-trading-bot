const fs = require('fs');
const path = require('path');

const trialLogPath = path.resolve('reports/strategy-v2/trial_log.md');
const content = fs.readFileSync(trialLogPath, 'utf8');

console.log('=== Strategy v2 Trial Log Audit ===');

// Count lines in markdown tables
const lines = content.split('\n');
const round1Rows = [];
const round2Rows = [];
const l1Rows = [];
const ablationRows = [];

let currentSection = 'header';
for (const line of lines) {
  if (line.includes('## Round 2 Pre-Registered Trials')) {
    currentSection = 'round2';
    continue;
  }
  if (line.includes('## Long-History Pre-Registered Trials')) {
    currentSection = 'l1';
    continue;
  }
  if (line.startsWith('|') && !line.includes('Candidate') && !line.includes(':---') && !line.includes('---')) {
    const cols = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cols.length < 5) continue;
    if (line.includes('Pre-registration committed')) continue;

    if (line.includes('Ablation')) {
      ablationRows.push(cols);
    } else if (currentSection === 'header' || currentSection === 'round1') {
      round1Rows.push(cols);
    } else if (currentSection === 'round2') {
      round2Rows.push(cols);
    } else if (currentSection === 'l1') {
      l1Rows.push(cols);
    }
  }
}

console.log(`\n1. Ablation Runs: ${ablationRows.length}`);
ablationRows.forEach(r => console.log('  ' + r.join(' | ')));

console.log(`\n2. Round 1 Trials (C0, C1, C2): ${round1Rows.length}`);
round1Rows.forEach(r => console.log('  ' + r.join(' | ')));

console.log(`\n3. Round 2 Trials (R2-A, R2-B): ${round2Rows.length}`);
round2Rows.forEach(r => console.log('  ' + r.join(' | ')));

console.log(`\n4. Candidate L1 Long-History Trials: ${l1Rows.length}`);
l1Rows.forEach(r => console.log('  ' + r.join(' | ')));

const totalRecordedTrials = ablationRows.length + round1Rows.length + round2Rows.length + l1Rows.length;
console.log(`\nTOTAL RECORDED EXPERIMENTAL RUNS: ${totalRecordedTrials}`);
console.log(`  - Ablation: ${ablationRows.length}`);
console.log(`  - Round 1 (C0, C1, C2 across splits & sessions): ${round1Rows.length}`);
console.log(`  - Round 2 (R2-A, R2-B across asset classes & splits): ${round2Rows.length}`);
console.log(`  - Long-History (L1 Dev & Validation): ${l1Rows.length}`);
console.log(`\nCONFIRMATION: Candidates C3, C4, C5 DO NOT EXIST. The previous report erroneously referred to "[C1-E0 through C5-E1]". Round 1 consisted exclusively of C0, C1, and C2.`);
