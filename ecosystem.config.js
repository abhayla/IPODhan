/**
 * PM2 Ecosystem Configuration — RETIRED / HISTORICAL (T-252, 2026-08-21).
 *
 * DEAD CONFIG on the live path: scripts/deploy-linux.sh starts both PM2 apps
 * with explicit `pm2 start ... --name ... -- ...` command-line flags (see its
 * restart_pm2()/resume_scraper() functions) — it never reads this file, and
 * nothing on the Linux VPS invokes `pm2 start ecosystem.config.js`. Every
 * value below (including `TZ: 'UTC'`) is therefore inert; it documents the
 * Windows-era shape this repo migrated away from, per
 * .claude/rules/pm2-scheduled-one-shot-scraper.md and
 * .claude/rules/self-hosted-windows-vps-deploy.md (both marked RETIRED).
 *
 * T-327 P2-7 note: TZ is now made explicit on the REAL path instead — every
 * `pm2 start` call in scripts/deploy-linux.sh is prefixed `TZ=UTC`, and
 * scripts/assert-env-keys.sh requires a `TZ` key in both env files. This
 * file is kept (not deleted) only as a historical record of the retired
 * Windows deploy shape — do not "fix" it expecting it to take effect.
 *
 * Production deployment configuration for IPODhan (historical — see above)
 * Manages Next.js web application and IPO scraper service
 *
 * Server (historical): Windows Server 2022 VPS (103.118.16.189)
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
        TZ: 'UTC',
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
      // Log rotation handled by pm2-logrotate module
      // Install: pm2 install pm2-logrotate
      // Configure: See scripts/setup-log-rotation.ps1
    },

    // IPO Scraper Service — scheduled ONE-SHOT scrape.
    // CRITICAL: autorestart MUST be false. src/index.ts scrapes once and exits;
    // under autorestart:true PM2 restarts it instantly = a ~4s infinite loop
    // (GitHub #2). With autorestart:false it exits cleanly and stays stopped;
    // cron_restart fires it again on schedule (PM2 scheduled-one-shot pattern).
    {
      name: 'ipodhan-scraper',
      script: 'node_modules/tsx/dist/cli.mjs',
      args: 'src/index.ts --source=all',
      cwd: './scraper',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        SCRAPER_INTERVAL_MODE: 'prod',
        TZ: 'UTC',
        // Data-coverage workstream (#6/#8/#16): match GMP/subscription to IPOs by
        // normalized company name + persist Moneycontrol subscription %s.
        ENABLE_GMP_NAME_MATCH: 'true',
        ENABLE_MONEYCONTROL_SUBSCRIPTION: 'true',
        // BSE source rebuilt on the JSON API (SPA broke the HTML scraper). Switches
        // the BSE orchestrator to scrapeBSEViaAPI (current board: detail + subscription). PR #26.
        ENABLE_BSE_API: 'true',
        // Primary-source document discovery (NSE/BSE/SEBI RHP+anchor, incl. SME). PR #59 (foolproof pipeline).
        ENABLE_PRIMARY_SOURCE_DISCOVERY: 'true',
      },
      max_memory_restart: '500M',
      error_file: './logs/scraper-error.log',
      out_file: './logs/scraper-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: false,
      watch: false,
      cron_restart: '*/30 * * * *',
      kill_timeout: 10000,
      // Log rotation handled by pm2-logrotate module
      // Install: pm2 install pm2-logrotate
      // Configure: See scripts/setup-log-rotation.ps1
    },
  ],
};
