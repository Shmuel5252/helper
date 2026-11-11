#!/usr/bin/env bash
# Interactive sign-in in Canonical's normal, sandboxed Chromium snap.
# No automation launcher, debugging port, imported cookies, or security bypass.
set -euo pipefail
test "$(id -u)" = 0 || { echo 'Run with sudo.' >&2; exit 1; }
snap list chromium >/dev/null
id gemini-browser >/dev/null 2>&1 || useradd --create-home --home-dir /home/gemini-browser --shell /usr/sbin/nologin gemini-browser
browser_uid=$(id -u gemini-browser)
install -d -o gemini-browser -g gemini-browser -m 700 /home/gemini-browser/.config/systemd/user /home/gemini-browser/snap/chromium/common/profile
chown -R gemini-browser:gemini-browser /home/gemini-browser/.config /home/gemini-browser/snap
cat > /home/gemini-browser/.config/systemd/user/ai-chat-regular-browser.service <<'UNIT'
[Unit]
Description=Normal interactive Chromium for Gemini sign-in
[Service]
Environment=DISPLAY=:99
ExecStart=/snap/bin/chromium --user-data-dir=/home/gemini-browser/snap/chromium/common/profile --no-first-run --window-size=1280,800 https://gemini.google.com/app
Restart=on-failure
RestartSec=20
UMask=0077
[Install]
WantedBy=default.target
UNIT
chown gemini-browser:gemini-browser /home/gemini-browser/.config/systemd/user/ai-chat-regular-browser.service
loginctl enable-linger gemini-browser
systemctl start "user@$browser_uid.service"
systemctl disable --now ai-chat-browser.service
runuser -u gemini-browser -- env XDG_RUNTIME_DIR="/run/user/$browser_uid" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$browser_uid/bus" systemctl --user daemon-reload
runuser -u gemini-browser -- env XDG_RUNTIME_DIR="/run/user/$browser_uid" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$browser_uid/bus" systemctl --user enable --now ai-chat-regular-browser.service
echo 'Normal browser launched; Google sign-in must still be verified by the owner.'
