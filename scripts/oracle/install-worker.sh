#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0
test -f /home/ubuntu/gemini-worker.env
install -d -m 755 /opt/ai-chat-gemini/worker
install -m 644 /home/ubuntu/gemini-worker/*.mjs /opt/ai-chat-gemini/worker/
install -o root -g gemini-browser -m 640 /home/ubuntu/gemini-worker.env /etc/ai-chat-gemini-worker.env
rm /home/ubuntu/gemini-worker.env
# Keep the existing manually authenticated profile and standard sandbox.
sed -i 's|--no-first-run --window-size|--no-first-run --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --window-size|' /home/gemini-browser/.config/systemd/user/ai-chat-regular-browser.service
browser_uid=$(id -u gemini-browser)
runuser -u gemini-browser -- env XDG_RUNTIME_DIR="/run/user/$browser_uid" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$browser_uid/bus" systemctl --user daemon-reload
runuser -u gemini-browser -- env XDG_RUNTIME_DIR="/run/user/$browser_uid" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$browser_uid/bus" systemctl --user restart ai-chat-regular-browser
cat > /etc/systemd/system/ai-chat-worker.service <<'UNIT'
[Unit]
Description=Gemini account archive worker
After=network-online.target ai-chat-display.service
Wants=network-online.target
[Service]
User=gemini-browser
WorkingDirectory=/opt/ai-chat-gemini
EnvironmentFile=/etc/ai-chat-gemini-worker.env
ExecStart=/usr/local/bin/node /opt/ai-chat-gemini/worker/worker.mjs
Restart=on-failure
RestartSec=15
UMask=0077
NoNewPrivileges=true
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now ai-chat-worker
