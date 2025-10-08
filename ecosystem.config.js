/**
 * PM2 Ecosystem Configuration
 *
 * Production deployment configuration for IPODhan
 * Manages Next.js web application and IPO scraper service
 *
 * Server: Windows Server 2022 VPS (103.118.16.189)
 * PM2 Version: 5.3+
 */

module.exports = {
  apps: [
    // Next.js Web Application
    {
      name: 'ipodhan-web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      cwd: './web',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      max_memory_restart: '500M',
      error_file: './logs/web-error.log',
      out_file: './logs/web-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',
      listen_timeout: 3000,
      kill_timeout: 5000,
    },

    // IPO Scraper Service
    {
      name: 'ipodhan-scraper',
      script: 'node_modules/tsx/dist/cli.mjs',
      args: 'src/index.ts',
      cwd: './scraper',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '300M',
      error_file: './logs/scraper-error.log',
      out_file: './logs/scraper-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      cron_restart: '0 3 * * *', // Daily at 3 AM
      max_restarts: 5,
      min_uptime: '30s',
      kill_timeout: 10000,
    },
  ],
};
