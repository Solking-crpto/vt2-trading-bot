import fs from 'node:fs';
import path from 'node:path';

const ignoreDirs = new Set(['node_modules', '.git', 'data']);
const findings = [];

function scanDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (ignoreDirs.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      scanDir(full);
    } else if (e.isFile()) {
      if (e.name.endsWith('.png') || e.name.endsWith('.db') || e.name.endsWith('.ico') || e.name.endsWith('.svg')) continue;
      const content = fs.readFileSync(full, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        // Skip user prompt reference files and reports
        if (full.includes('reports') || full.includes('user_prompt')) return;

        // Check for hardcoded local absolute paths
        if (/[A-Z]:[\\\/]Users/i.test(line)) {
          findings.push({ file: full, line: idx + 1, type: 'ABSOLUTE_PATH', match: line.trim() });
        }
        // Check for real secrets (skip mock/test fixtures)
        if (/(api[_-]?key|secret|password|passphrase|private[_-]?key)\s*[:=]\s*['"][a-zA-Z0-9_\/+=]{16,}['"]/i.test(line)) {
          if (!line.includes('test') && !line.includes('mock') && !line.includes('sample') && !line.includes('canonical')) {
            findings.push({ file: full, line: idx + 1, type: 'SUSPECTED_SECRET', match: line.trim() });
          }
        }
      });
    }
  }
}

scanDir('.');
console.log('HYGIENE SCAN COMPLETE:');
if (findings.length === 0) {
  console.log('✅ ZERO SECRETS FOUND. ZERO LOCAL ABSOLUTE PATHS FOUND.');
} else {
  console.log(`⚠️ FOUND ${findings.length} ISSUES:`, JSON.stringify(findings, null, 2));
}
