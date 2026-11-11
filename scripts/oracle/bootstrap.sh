#!/usr/bin/env bash
# Dedicated Oracle Always Free host. Run as root after reviewing the host.
# All desktop/debugging listeners stay on loopback; reach them through SSH only.
set -euo pipefail
test "$(id -u)" = 0 || { echo 'Run with sudo.' >&2; exit 1; }
test "$(uname -m)" = aarch64 || { echo 'This installer targets ARM64.' >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl xz-utils xvfb x11vnc novnc websockify openbox dbus-x11 fonts-noto-core fonts-noto-color-emoji

if ! command -v node >/dev/null || [[ $(node -p 'process.versions.node.split(".")[0]') != 24 ]]; then
  stage=$(mktemp -d)
  trap 'rm -rf -- "$stage"' EXIT
  curl --fail --silent --show-error https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o "$stage/SHASUMS256.txt"
  node_archive=$(awk '$2 ~ /^node-v24\.[0-9]+\.[0-9]+-linux-arm64\.tar\.xz$/ {print $2}' "$stage/SHASUMS256.txt")
  test -n "$node_archive" && test "$(printf '%s\n' "$node_archive" | wc -l)" = 1
  curl --fail --silent --show-error "https://nodejs.org/dist/latest-v24.x/$node_archive" -o "$stage/$node_archive"
  (cd "$stage" && grep " $node_archive$" SHASUMS256.txt | sha256sum --check --strict)
  tar -xJf "$stage/$node_archive" -C /usr/local --strip-components=1 --no-same-owner
fi

id gemini-worker >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/ai-chat-gemini --shell /usr/sbin/nologin gemini-worker
install -d -o gemini-worker -g gemini-worker -m 700 /var/lib/ai-chat-gemini/profile /var/lib/ai-chat-gemini/downloads
install -d -m 755 /opt/ai-chat-gemini /opt/ai-chat-gemini/browsers
cd /opt/ai-chat-gemini
test -f package.json || printf '%s\n' '{"private":true,"type":"module"}' > package.json
npm install --omit=dev --save-exact playwright@1.64.0
PLAYWRIGHT_BROWSERS_PATH=/opt/ai-chat-gemini/browsers ./node_modules/.bin/playwright install --with-deps chromium

# Ubuntu 24.04 requires an explicit profile for a non-system Chromium binary.
# Permit user namespaces only for this root-owned executable, keeping the
# Chromium sandbox and Ubuntu's global user-namespace restriction enabled.
browser_executable=$(PLAYWRIGHT_BROWSERS_PATH=/opt/ai-chat-gemini/browsers node --input-type=module -e 'import {chromium} from "playwright"; console.log(chromium.executablePath())')
[[ "$browser_executable" =~ ^/opt/ai-chat-gemini/browsers/[A-Za-z0-9_./-]+$ ]]
test "$(stat -c %U "$browser_executable")" = root
test -z "$(find /opt/ai-chat-gemini/browsers -perm /022 -print -quit)"
cat > /etc/apparmor.d/ai-chat-chromium <<PROFILE
abi <abi/4.0>,
include <tunables/global>
profile ai-chat-chromium "$browser_executable" flags=(unconfined) {
  userns,
}
PROFILE
apparmor_parser -r /etc/apparmor.d/ai-chat-chromium

cat > /opt/ai-chat-gemini/browser.mjs <<'BROWSER'
import { chromium } from 'playwright';
const context = await chromium.launchPersistentContext('/var/lib/ai-chat-gemini/profile', {
  headless: false, chromiumSandbox: true,
  viewport: { width: 1280, height: 800 }, acceptDownloads: true,
  downloadsPath: '/var/lib/ai-chat-gemini/downloads',
  args: ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9222'],
});
const page = context.pages()[0] ?? await context.newPage();
if (page.url() === 'about:blank') await page.goto('https://gemini.google.com/app');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => context.close().finally(() => process.exit(0)));
await new Promise(resolve => context.once('close', resolve));
BROWSER

cat > /etc/systemd/system/ai-chat-display.service <<'UNIT'
[Unit]
Description=Private display for Gemini account
After=network.target
[Service]
User=gemini-worker
ExecStart=/usr/bin/Xvfb :99 -screen 0 1280x800x24 -nolisten tcp
Restart=on-failure
RestartSec=5
[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/ai-chat-browser.service <<'UNIT'
[Unit]
Description=Dedicated Gemini browser
Requires=ai-chat-display.service
After=ai-chat-display.service network-online.target
Wants=network-online.target
[Service]
User=gemini-worker
WorkingDirectory=/opt/ai-chat-gemini
Environment=DISPLAY=:99
Environment=HOME=/var/lib/ai-chat-gemini
Environment=PLAYWRIGHT_BROWSERS_PATH=/opt/ai-chat-gemini/browsers
ExecStart=/usr/local/bin/node /opt/ai-chat-gemini/browser.mjs
Restart=on-failure
RestartSec=15
UMask=0077
[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/ai-chat-desktop.service <<'UNIT'
[Unit]
Description=Private browser desktop over SSH
Requires=ai-chat-display.service
After=ai-chat-display.service
[Service]
User=gemini-worker
ExecStart=/usr/bin/x11vnc -display :99 -localhost -rfbport 5900 -forever -shared -nopw -noxdamage
Restart=on-failure
RestartSec=5
[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/ai-chat-login.service <<'UNIT'
[Unit]
Description=Private Gemini login viewer over SSH
Requires=ai-chat-desktop.service
After=ai-chat-desktop.service
[Service]
User=gemini-worker
ExecStart=/usr/bin/websockify --web=/usr/share/novnc/ 127.0.0.1:6080 127.0.0.1:5900
Restart=on-failure
RestartSec=5
[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now ai-chat-display ai-chat-browser ai-chat-desktop ai-chat-login
echo 'Browser host installed. Google sign-in and application worker still require configuration and verification.'
