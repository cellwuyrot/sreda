#!/usr/bin/env bash
set -euo pipefail
# This installs a read-only collector. It never restarts a PM2 application.
REPO=/opt/trioz; AGENT_USER=""; NODE_BIN="$(command -v node || true)"; PM2_BIN="$(command -v pm2 || true)"; PM2_HOME_ARG=""
for arg in "$@";do case "$arg" in --repo=*) REPO="${arg#*=}";; --user=*) AGENT_USER="${arg#*=}";; --node=*) NODE_BIN="${arg#*=}";; --pm2=*) PM2_BIN="${arg#*=}";; --pm2-home=*) PM2_HOME_ARG="${arg#*=}";; *) echo "Unknown argument";exit 1;;esac;done
[[ $EUID == 0 ]] || { echo "Run as root to install systemd service";exit 1; }
[[ -n "$AGENT_USER" ]] && id "$AGENT_USER" >/dev/null || { echo "Specify --user=PM2_OWNER";exit 1; }
for value in "$REPO" "$NODE_BIN" "$PM2_BIN" "$AGENT_USER";do [[ "$value" =~ ^/[a-zA-Z0-9_./-]+$ || "$value" =~ ^[a-zA-Z0-9_-]+$ ]] || { echo "Unsupported path/user";exit 1; };done
[[ -x "$NODE_BIN" && -x "$PM2_BIN" && -f "$REPO/apps/monitor/src/index.mjs" ]] || { echo "Need node, pm2 and apps/monitor source";exit 1; }
[[ $("$NODE_BIN" -p 'Number(process.versions.node.split(".")[0])') -ge 20 ]] || { echo "Node >=20 required";exit 1; }
[[ -n "$PM2_HOME_ARG" ]] || PM2_HOME_ARG="$(getent passwd "$AGENT_USER" | cut -d: -f6)/.pm2"
[[ "$PM2_HOME_ARG" =~ ^/[a-zA-Z0-9_./-]+$ ]] || { echo "Unsupported PM2_HOME";exit 1; }
install -d -m 700 -o "$AGENT_USER" /etc/trioz-monitor
if [[ ! -e /etc/trioz-monitor/config.json ]];then
 read -r -s -p 'Agent token from TrioZ Servers (not for chat): ' TOKEN; echo
 [[ ${#TOKEN} -ge 20 ]] || { echo "Invalid token";exit 1; }
 TOKEN="$TOKEN" PM2_PATH="$PM2_BIN" PM2_HOME_VALUE="$PM2_HOME_ARG" "$NODE_BIN" -e 'const fs=require("fs");fs.writeFileSync("/etc/trioz-monitor/config.json",JSON.stringify({mainUrl:"https://trioz.ru",token:process.env.TOKEN,pm2Bin:process.env.PM2_PATH,pm2Home:process.env.PM2_HOME_VALUE,healthChecks:{},projectPaths:{},disks:[{path:"/",label:"rootfs"}]},null,2),{mode:0o600});'
 unset TOKEN
fi
chown "$AGENT_USER" /etc/trioz-monitor/config.json;chmod 600 /etc/trioz-monitor/config.json
cat > /etc/systemd/system/trioz-monitor.service <<EOF
[Unit]
Description=TrioZ read-only project monitor
After=network-online.target
Wants=network-online.target
[Service]
User=$AGENT_USER
WorkingDirectory=$REPO
ExecStart=$NODE_BIN $REPO/apps/monitor/src/index.mjs
Environment=TRIOZ_MONITOR_CONFIG=/etc/trioz-monitor/config.json
Environment=PM2_HOME=$PM2_HOME_ARG
Environment=PATH=$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin
Restart=always
RestartSec=10
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$PM2_HOME_ARG
PrivateTmp=yes
UMask=0077
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload;systemctl enable --now trioz-monitor
systemctl restart trioz-monitor
echo 'Installed. Add deployment IDs to healthChecks/projectPaths in /etc/trioz-monitor/config.json; restart only trioz-monitor afterwards. Never paste that file into chat.'
