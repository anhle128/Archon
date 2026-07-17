const path = require('path');

const rootDir = __dirname;

module.exports = {
  apps: [
    {
      name: process.env.ARCHON_PM2_NAME || 'archon',
      cwd: rootDir,
      script: path.join(rootDir, 'scripts', 'pm2-start.sh'),
      interpreter: '/bin/bash',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 1000,
      time: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
