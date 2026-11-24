// PM2 on the VM: `pm2 start ecosystem.config.cjs`, then `pm2 save` and `pm2 startup`.
// Settings come from .env in this folder, which is never committed.
module.exports = {
  apps: [
    {
      name: 'cooked-by-ugo-api',
      script: 'dist/server.js',
      node_args: '--env-file=.env',
      // One instance: rate limits and live order updates keep their state in memory.
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '400M',
      kill_timeout: 10000,
    },
  ],
}
