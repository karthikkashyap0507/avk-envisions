#!/usr/bin/env bash
#
# Turns on automatic deployment. Run once, on the VM:
#
#   sudo bash /opt/avkvisions/deploy/install-auto-deploy.sh
#
# After this, pushing to main is the whole deploy process. A timer checks
# GitHub every minute and runs deploy/deploy.sh when the branch has moved.
#
set -euo pipefail

APP_USER="avk"
APP_DIR="/opt/avkvisions"
DATA_DIR="/var/lib/avkvisions"

# Start from where the repo already is, so the first tick does not rebuild a
# commit that is already serving.
cd "$APP_DIR"
sudo -u "$APP_USER" git fetch --quiet origin main
sudo -u "$APP_USER" git rev-parse origin/main > "$DATA_DIR/.last-deployed"
chown "$APP_USER:$APP_USER" "$DATA_DIR/.last-deployed"

cat > /etc/systemd/system/avk-auto-deploy.service <<'UNIT'
[Unit]
Description=Deploy AVK Envisions when origin/main moves
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/env bash /opt/avkvisions/deploy/auto-deploy.sh
# The deploy stops and starts avkvisions.service, and a build on this VM has
# taken over ten minutes on a cold npm cache. The content scripts after it
# take as long again — backfill-figures re-reads every previous-year PDF — and
# a 30-minute limit killed the 116a6c4 deploy part-way through them, with the
# site stopped, then retried into the same wall every half hour.
TimeoutStartSec=5400
UNIT

cat > /etc/systemd/system/avk-auto-deploy.timer <<'UNIT'
[Unit]
Description=Check GitHub for new commits every minute

[Timer]
# A minute after boot, then every minute. Persistent=false: if the VM was off,
# there is no backlog worth replaying — the next tick sees the newest commit
# anyway.
OnBootSec=60
OnUnitActiveSec=60
AccuracySec=10
Unit=avk-auto-deploy.service

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now avk-auto-deploy.timer

echo
echo "Automatic deployment is on."
echo "  Push to main and the site updates within about a minute plus build time."
echo
echo "  Watch it:    sudo journalctl -u avk-auto-deploy -f"
echo "  Next check:  systemctl list-timers avk-auto-deploy"
echo "  Turn it off: sudo systemctl disable --now avk-auto-deploy.timer"
