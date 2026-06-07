/**
 * PM2: chạy 1 process fork (tránh cluster + cùng cổng gây EADDRINUSE).
 * Production load mặc định file `.env` (index.js — không cần ENV_FILE).
 */
module.exports = {
  apps: [
    {
      name: "serialcommander-api",
      script: "server.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
        PORT: 2999,
        HOST: "0.0.0.0",
      },
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
