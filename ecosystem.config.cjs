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
        REDIS_URL: "redis://:769Ey76Oxr7Wc2Qw7DWyK8IM1Je13q0f@127.0.0.1:6379",
      },
      max_memory_restart: "1500M",
      autorestart: true,
      time: true,
    },
  ],
};
