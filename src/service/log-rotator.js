import fs from 'node:fs';
import path from 'node:path';

export const LOGS_DIR = path.resolve('logs');
export const DEFAULT_RETENTION_DAYS = 14;

/**
 * Ensures the logs directory exists.
 * @returns {string} Absolute path to logs directory
 */
export function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
  return LOGS_DIR;
}

/**
 * Returns the current date-stamped log file path.
 * Format: logs/vt2-YYYY-MM-DD.log
 * @param {Date} [date=new Date()]
 * @returns {string} Path to log file
 */
export function getDailyLogPath(date = new Date()) {
  ensureLogsDir();
  const dateStr = date.toISOString().split('T')[0];
  return path.join(LOGS_DIR, `vt2-${dateStr}.log`);
}

/**
 * Prunes log files older than the retention threshold.
 * @param {number} [retentionDays=14]
 * @returns {string[]} List of pruned file paths
 */
export function pruneOldLogs(retentionDays = DEFAULT_RETENTION_DAYS) {
  ensureLogsDir();
  const pruned = [];
  const now = Date.now();
  const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;

  try {
    const files = fs.readdirSync(LOGS_DIR);
    for (const file of files) {
      if (!file.startsWith('vt2-') || !file.endsWith('.log')) continue;
      const fullPath = path.join(LOGS_DIR, file);
      try {
        const stats = fs.statSync(fullPath);
        const ageMs = now - stats.mtimeMs;
        if (ageMs > maxAgeMs) {
          fs.unlinkSync(fullPath);
          pruned.push(fullPath);
        }
      } catch (_) {}
    }
  } catch (err) {
    console.warn(`[LogRotator] Error pruning logs: ${err.message}`);
  }

  return pruned;
}

/**
 * Schedules daily log pruning and returns timer.
 * @param {number} [retentionDays=14]
 * @returns {NodeJS.Timeout}
 */
export function setupDailyLogRotation(retentionDays = DEFAULT_RETENTION_DAYS) {
  ensureLogsDir();
  pruneOldLogs(retentionDays);

  // Run pruning every 24 hours
  const interval = setInterval(() => {
    pruneOldLogs(retentionDays);
  }, 24 * 60 * 60 * 1000);

  if (interval?.unref) interval.unref();
  return interval;
}
