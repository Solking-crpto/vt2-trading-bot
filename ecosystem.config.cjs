/**
 * PM2 Application Configuration for VT2 Unattended Service Operation
 * Includes auto-restart, exponential backoff crash-loop guard, and date-formatted logging.
 *
 * NOTE FOR WINDOWS: PM2 does not automatically restart across Windows reboots without
 * a service wrapper (e.g., pm2-windows-service, NSSM) or a Windows Task Scheduler task.
 * See docs/RUNBOOK.md for auto-start setup instructions.
 */

module.exports = {
  apps: [
    {
      name: 'vt2-trading-bot',
      script: './start.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      max_restarts: 10,
      min_uptime: '15s',
      restart_delay: 5000,
      exp_backoff_restart_delay: 100,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        CURRENT_ENVIRONMENT: 'PAPER',
      },
      out_file: './logs/vt2-service-out.log',
      error_file: './logs/vt2-service-err.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      time: true,
    },
  ],
};
