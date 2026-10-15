module.exports = {
  apps: [
    {
      name: "trioz",
      cwd: "/var/www/trioz",
      script: "npm",
      args: "start",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        UPLOADS_STRICT: "1",
        TRUSTED_PROXY_HOPS: "1",
        REDIS_URL: process.env.REDIS_URL,
      },
      max_memory_restart: "1500M",
      autorestart: true,
      time: true,
    },
  ],
};
