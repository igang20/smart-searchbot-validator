module.exports = {
  apps: [
    {
      name: "search_bot_validator",
      script: "./src/index.js",

      // Логирование теперь пишется локально в папку проекта (крайне удобно при переносе)
      out_file: "./logs/validator-out.log",
      error_file: "./logs/validator-error.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",

      // Стабильность в проде
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 15,
      restart_delay: 2000,
      max_memory_restart: "250M",

      env: {
        NODE_ENV: "production",
        PORT: 3001,
      },
    },
  ],
};
