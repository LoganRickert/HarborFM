const path = require('path');

const repoRoot = path.resolve(__dirname);
const serverDir = path.join(repoRoot, 'server');

/** PM2 ecosystem config for HarborFM. Use with: pm2 start ecosystem.config.cjs */
module.exports = {
  apps: [
    {
      name: 'harborfm',
      cwd: serverDir,
      script: 'dist/app.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      // Load server/.env if present (PM2 5.2+). Otherwise set env in the shell or here.
      env_file: path.join(serverDir, '.env'),
      out_file: path.join(repoRoot, 'logs', 'harborfm-out.log'),
      error_file: path.join(repoRoot, 'logs', 'harborfm-err.log'),
      merge_logs: true,
      time: true,
    },
  ],
};
