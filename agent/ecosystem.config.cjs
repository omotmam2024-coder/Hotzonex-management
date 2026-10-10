// PM2 process file. Usage (from the agent folder):
//   npm install && npm run build
//   pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
module.exports = {
  apps: [
    {
      name: 'hotzonex-agent',
      script: 'dist/index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      restart_delay: 5000,
      max_memory_restart: '300M',
      kill_timeout: 15000,
      time: true,
    },
  ],
};
