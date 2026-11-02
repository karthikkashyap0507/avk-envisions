#!/usr/bin/env bash
#
# Deploys AVK Envisions on the VM. Safe to re-run for every release.
#
#   sudo bash /opt/avkvisions/deploy/deploy.sh
#
# Order matters: back up, install, migrate, build, then restart. The build runs
# BEFORE the restart so a compile failure leaves the previous version serving
# rather than taking the site down.
#
set -euo pipefail

APP_USER="avk"
APP_DIR="/opt/avkvisions"
DATA_DIR="/var/lib/avkvisions"

cd "$APP_DIR"

if [[ ! -f .env ]]; then
  echo "ERROR: $APP_DIR/.env is missing. Copy .env.production.example and fill it in." >&2
  exit 1
fi

# --- One-off: hand the data over to the new server ---------------------------
# The site moved to a new VM. This old VM holds the only copy of the database
# and nobody can log in to it, but it still deploys from GitHub. So this block
# stops the old app, packs the data directory and .env, and uploads them to the
# new project's private bucket through a write-only link that expires within
# the hour. It then turns off this VM's auto-deploy, so nothing more is written
# or rebuilt here. It never runs on the new VM, which carries the .new-server
# marker. Remove this block once the move is done.
if [[ ! -f "$DATA_DIR/.new-server" && -f "$DATA_DIR/production.db" ]]; then
  echo "==> Handing the data over to the new server"
  systemctl stop avkvisions || true
  /usr/local/bin/avk-backup
  STAGE="/tmp/avk-handover"
  rm -rf "$STAGE" && mkdir -p "$STAGE"
  cp -a "$(ls -t "$DATA_DIR"/backups/avk-*.db.gz | head -1)" "$STAGE/"
  cp -a "$APP_DIR/.env" "$STAGE/env"
  # The translation models are re-downloaded on the new VM, and the old
  # backups are not needed: the snapshot just taken is in the stage.
  tar czf /tmp/avk-handover.tgz \
    -C / --exclude=var/lib/avkvisions/backups --exclude=var/lib/avkvisions/models var/lib/avkvisions \
    -C /tmp avk-handover
  curl -fsS --retry 3 -X PUT --upload-file /tmp/avk-handover.tgz 'https://avk-backups-4f155b36.storage.googleapis.com/migration/old-server.tgz?x-goog-signature=1ee5855d6c449863cf718f6acb612a3bb969e5602790cdd862b35cc326cf1e28dd6ed61ad742558a33c209e5fc23c51938d8d955214e7f35712fe4d8680a3c5ae93eb8107f378d7b919f0252b5176764e83278bdbe0508d0ac64eead0137f2d3a53d2739afcf3f5f6bea9fdef8ed2a912317a83b375c6dcc723808f5e86c6173126aaf78dee369847b1f3124c0384744c443c41abf0a1bfe76c7428cafadfbf8d879dd6bcb5b50e34f3bea2f308e9898942dc72b4406645a6a1f200c6253f4cf6373a8a6ee6d07824f53432610389d890196d53aa256af44ced5bc998c373be1c309e10cef262953f58f7f144132e256628c3a8b99220280a5bb9972de71af89&x-goog-algorithm=GOOG4-RSA-SHA256&x-goog-credential=avk-migration%40project-4f155b36-4e1e-4682-879.iam.gserviceaccount.com%2F20261102%2Fasia-south1%2Fstorage%2Fgoog4_request&x-goog-date=20261102T075833Z&x-goog-expires=3600&x-goog-signedheaders=host'
  rm -rf "$STAGE" /tmp/avk-handover.tgz
  systemctl disable --now avk-auto-deploy.timer || true
  echo "==> Handed over. The old app is stopped and auto-deploy is off."
  exit 0
fi

# --- Refuse to deploy with a broken database path ----------------------------
# A relative DATABASE_URL resolves inside $APP_DIR, which this script replaces
# on every deploy. That would silently delete every student account.
DB_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"' || true)"
if [[ "$DB_URL" != file:/* ]]; then
  echo "ERROR: DATABASE_URL must be an ABSOLUTE path, e.g." >&2
  echo "       DATABASE_URL=\"file:$DATA_DIR/production.db\"" >&2
  echo "       Got: $DB_URL" >&2
  exit 1
fi

# --- Back up before touching anything ----------------------------------------
if [[ -f "$DATA_DIR/production.db" ]]; then
  echo "==> Backing up the database"
  /usr/local/bin/avk-backup
fi

# The translation engine holds most of a gigabyte. The build below needs it
# more, on a 2 GB machine; the engine is started again once the site is up.
systemctl stop avk-translator 2>/dev/null || true

echo "==> Installing dependencies"
# `npm ci` not `npm install`: installs exactly what the lockfile says, so a
# transitive dependency cannot change between your machine and production.
sudo -u "$APP_USER" npm ci --omit=dev --ignore-scripts
# Prisma's postinstall is skipped by --ignore-scripts, so generate explicitly.
sudo -u "$APP_USER" npx prisma generate

# --- Stop the app before touching the schema ---------------------------------
# SQLite gives the running process a lock that blocks the exclusive lock the
# migration engine needs, so migrating against a live app fails with
# "database is locked". Stopping first costs the build's worth of downtime and
# is the only reliable order on a single-file database.
echo "==> Stopping the app for migration"
systemctl stop avkvisions || true

echo "==> Applying database migrations"
# `migrate deploy`, never `migrate dev`. The dev command can reset the database
# when it sees drift; deploy only ever applies pending migrations forward.
sudo -u "$APP_USER" npx prisma migrate deploy

echo "==> Building"
# Dev dependencies are needed to build, so install them, build, then prune.
sudo -u "$APP_USER" npm ci --ignore-scripts
sudo -u "$APP_USER" npx prisma generate
# Stamp the build with the commit it came from, so /api/version can report what
# is actually serving. Deploys are unattended now, and this is how you tell a
# change has landed without opening a terminal here.
BUILD_COMMIT="$(sudo -u "$APP_USER" git rev-parse --short HEAD)"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# 3072, not 2048: the build ran out of heap on the smaller setting and retried
# itself into a half-written .next, which serves a 502 with no obvious cause.
sudo -u "$APP_USER" env NODE_OPTIONS=--max-old-space-size=3072 NEXT_PUBLIC_BUILD_COMMIT="$BUILD_COMMIT" NEXT_PUBLIC_BUILD_TIME="$BUILD_TIME" npm run build

# --- Content maintenance ------------------------------------------------------
# Runs here, before the prune, because these are TypeScript and need `tsx` —
# which the prune removes. Running them afterwards fails with a missing esbuild
# binary, which is exactly what happened the first time these were handed over
# as manual steps.
#
# Each is safe to re-run and safe to skip: a failure here leaves the deploy
# alone rather than taking the site down for a content job.
# --- Uploads must stay readable by the web server -----------------------------
# Caddy serves /uploads/* off disk as its own user. A fresh upload inherits the
# app user's umask and can land unreadable, and the data directory itself was
# mode 750 — so diagrams returned 403 and an uploaded image simply never
# appeared. Re-applied on every deploy because a new file can reintroduce it.
# The database and backups stay private: 751 lets caddy traverse without
# listing, and backups are explicitly closed off.
echo "==> Fixing upload permissions"
chmod 751 "$DATA_DIR"
mkdir -p "$DATA_DIR/uploads/figures"
chown -R "$APP_USER:$APP_USER" "$DATA_DIR/uploads"
chmod -R 755 "$DATA_DIR/uploads"
chmod 700 "$DATA_DIR/backups" 2>/dev/null || true

echo "==> Refreshing content"
# Order is load-bearing, and getting it wrong is what put "Coming Soon" on the
# pricing page twice:
#
#   seed-catalogue  creates the series and their tests. It no longer touches
#                   the price of a series that already exists — it used to, and
#                   that is what set up the failure below.
#   set-pricing     owns every price. It runs AFTER the seed so nothing can
#                   overwrite what it sets.
#   hide-empty      publishes and hides based on what is actually there. It
#                   runs LAST, so it judges the finished state: a priced series
#                   is never hidden, and a paper that has since been filled is
#                   published.
#
# These used to be manual steps run after the deploy, which meant every deploy
# briefly reverted the site and someone had to notice and put it back.
for script in \
  prisma/backfill-figures.ts \
  prisma/build-free-tests.ts \
  prisma/seed-catalogue.ts \
  prisma/create-combo.ts \
  prisma/seed-staff-admin.ts \
  prisma/set-pricing.ts \
  prisma/trim-free-test-2.ts \
  prisma/apply-50-days-schedule.ts \
  prisma/import-paid-schedule.ts \
  prisma/rebuild-subject-papers.ts \
  prisma/import-current-affairs.ts \
  prisma/set-pyq-subject-durations.ts \
  prisma/fix-test-modes.ts \
  prisma/set-offline-enrolments.ts \
  prisma/seed-translation-memory.ts \
  prisma/hide-empty-tests.ts
do
  if ! sudo -u "$APP_USER" npx tsx "$script"; then
    echo "    WARNING: $script failed; continuing." >&2
  fi
done

# Dev dependencies go, but `tsx` stays: the content scripts in prisma/ are
# TypeScript and are run by hand after a deploy — importing a paper, fixing a
# catalogue. Pruning it away meant every one of those sessions began with a
# two-minute `npm ci` to put back what this line had just removed.
sudo -u "$APP_USER" npm prune --omit=dev
sudo -u "$APP_USER" npm install --no-save --no-audit --no-fund tsx >/dev/null 2>&1 ||
  echo "    WARNING: tsx could not be reinstalled; prisma/ scripts will need 'npm ci' first." >&2

echo "==> Starting"
systemctl start avkvisions

# --- Health check -------------------------------------------------------------
echo "==> Waiting for the app to answer"
for i in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:3000/ >/dev/null 2>&1; then
    echo
    echo "Deployed. The site is live."
    echo "  Logs:   sudo journalctl -u avkvisions -f"
    echo "  Status: sudo systemctl status avkvisions"

    # Last, and never fatal: the site is already serving. If the engine
    # cannot be set up, tests stay readable in English and the next deploy
    # tries again.
    echo "==> Kannada translation engine"
    if ! bash "$APP_DIR/deploy/setup-translator.sh"; then
      echo "    WARNING: the translation engine is not running; tests show in English." >&2
      echo "    Logs: sudo journalctl -u avk-translator -n 50" >&2
    fi
    exit 0
  fi
  sleep 2
done

echo >&2
echo "ERROR: the app did not start within 60 seconds." >&2
echo "Recent logs:" >&2
journalctl -u avkvisions -n 40 --no-pager >&2
exit 1
