import { redactSecrets } from '../environment.js';

export const ALERT_EVENTS = Object.freeze({
  BOT_HALT: 'BOT_HALT',
  KILL_SWITCH: 'KILL_SWITCH',
  DAILY_LOSS_LOCKOUT: 'DAILY_LOSS_LOCKOUT',
  FEED_OFFLINE: 'FEED_OFFLINE',
  RESTART: 'RESTART',
  SERVER_STARTED: 'SERVER_STARTED',
});

export class AlertDispatcher {
  constructor(options = {}) {
    this.webhookUrl = options.webhookUrl || process.env.ALERT_WEBHOOK_URL || null;
    this.telegramToken = options.telegramToken || process.env.TELEGRAM_BOT_TOKEN || null;
    this.telegramChatId = options.telegramChatId || process.env.TELEGRAM_CHAT_ID || null;
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.logger = options.logger || console;
    this.hasLoggedDisabled = false;

    if (!this.isConfigured() && !this.hasLoggedDisabled) {
      this.logger.log('[AlertDispatcher] Alerts disabled: ALERT_WEBHOOK_URL or TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not configured.');
      this.hasLoggedDisabled = true;
    }
  }

  isConfigured() {
    return Boolean(this.webhookUrl || (this.telegramToken && this.telegramChatId));
  }

  /**
   * Dispatches an alert message to configured destinations.
   * Never leaks secrets or throws unhandled errors.
   * @param {Object} alert
   * @param {string} alert.event - One of ALERT_EVENTS
   * @param {string} alert.message - Human-readable alert summary
   * @param {string} [alert.level='WARNING'] - INFO, WARNING, or CRITICAL
   * @param {Object} [alert.details={}] - Structured context metadata
   * @returns {Promise<{ delivered: boolean, destination?: string, error?: string }>}
   */
  async dispatchAlert({ event, message, level = 'WARNING', details = {} }) {
    if (!this.isConfigured()) {
      return { delivered: false, error: 'DISPATCHER_DISABLED' };
    }

    const sanitizedDetails = redactSecrets(details);
    const sanitizedMessage = typeof message === 'string' ? redactSecrets(message) : 'VT2 Alert';
    const timestamp = new Date().toISOString();

    const payload = {
      service: 'VT2-Trading-Bot',
      environment: process.env.CURRENT_ENVIRONMENT || 'PAPER',
      timestamp,
      level,
      event,
      message: sanitizedMessage,
      details: sanitizedDetails,
    };

    const results = [];

    // 1. Generic Webhook
    if (this.webhookUrl) {
      try {
        const res = await this.fetchFn(this.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(5000),
        });
        results.push({ destination: 'webhook', delivered: res.ok, status: res.status });
      } catch (err) {
        results.push({ destination: 'webhook', delivered: false, error: err.message });
      }
    }

    // 2. Telegram Bot
    if (this.telegramToken && this.telegramChatId) {
      try {
        const text = `🚨 *[VT2 ${level}] ${event}*\n${sanitizedMessage}\n_Time: ${timestamp}_`;
        const tgUrl = `https://api.telegram.org/bot${this.telegramToken}/sendMessage`;
        const res = await this.fetchFn(tgUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: this.telegramChatId,
            text,
            parse_mode: 'Markdown',
          }),
          signal: AbortSignal.timeout(5000),
        });
        results.push({ destination: 'telegram', delivered: res.ok, status: res.status });
      } catch (err) {
        results.push({ destination: 'telegram', delivered: false, error: err.message });
      }
    }

    const allSucceeded = results.length > 0 && results.every(r => r.delivered);
    return {
      delivered: allSucceeded,
      results,
    };
  }
}
