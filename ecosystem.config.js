module.exports = {
  apps: [
    {
      // Name of app
      name: 'PhilipPortfolio',
      // Script for pm2 run forever
      // If use static website, remove it
      script: 'server.js',

      // Options reference: https://pm2.io/doc/en/runtime/reference/ecosystem-file/

      // Args for script for pm2 run forever
      // If use static website, remove it
      //args: 'one two',
      // Current directory on server
      cwd: '/var/www/portfolio/current',
      // Config out file for web errors
      error_file: '/var/www/portfolio/logs/web.err.log',
      // Config out file for web logs
      out_file: '/var/www/portfolio/logs/web.out.log',
      // Number of instances to be started in cluster mode
      instances: 1,
      // Enable or disable auto restart after process failure
      autorestart: true,
      // Enable or disable the watch mode
      watch: false,
      // Restart the app if an amount of memory is exceeded (format: /0-9?/ K for KB, ‘M’ for MB, ‘G’ for GB, default to B)
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development'
      },
      // ^env_\S*$ => Specify environment variables to be injected when using –env
      env_production: {
        NODE_ENV: 'production'
      }
    }
  ],

  deploy: {
    production: {
      // SSH user
      user: 'phro',
      // SSH host
      host: '192.168.0.102',
      // SSH port
      port: '2222',
      // GIT remote/branch
      ref: 'origin/main',
      // GIT remote
      repo: 'git@github.com:Null-Cat/Portfolio.git',
      // Fetch all branches or fast
      fetch: 'all',
      // Path in the server
      path: '/var/www/portfolio',
      'post-setup': 'git submodule update --init && ls -la',
      // Command run after pull source code
      'post-deploy': 'sudo git submodule update && sudo npm install && sudo pm2 reload ecosystem.config.js --env production'
    }
  }
}
