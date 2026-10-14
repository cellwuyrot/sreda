// Dedicated PM2 process; does not replace ecosystem.config.js or restart other apps.
// Set TZ_ID_NODE to a Node >=22.12 executable BEFORE pm2 start.
if (!process.env.TZ_ID_NODE) throw new Error("Set TZ_ID_NODE to the absolute Node >=22.12 executable");
module.exports = { apps: [{ name: "tz-id", cwd: "/var/www/trioz/apps/id",
 script: "/var/www/trioz/node_modules/tsx/dist/cli.mjs", args: "--tsconfig ../web/tsconfig.json src/server.ts",
 interpreter: process.env.TZ_ID_NODE, env: { NODE_ENV: "production", PORT: 3100 },
 instances: 1, exec_mode: "fork", autorestart: true, max_memory_restart: "512M", time: true,
 kill_timeout: 5000, restart_delay: 3000 }] };
