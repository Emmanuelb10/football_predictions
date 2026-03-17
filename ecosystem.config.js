module.exports = {
  apps: [
    {
      name: 'football-api',
      script: 'server/dist/index.js',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      max_memory_restart: '500M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
    },
  ],
};
