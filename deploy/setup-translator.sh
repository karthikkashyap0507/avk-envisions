#!/usr/bin/env bash
#
# Installs and starts the Kannada translation engine on the VM.
#
#   sudo bash /opt/avkvisions/deploy/setup-translator.sh
#
# Called by deploy.sh on every deploy, and safe to re-run by hand: each step
# checks before it acts, so a deploy that changes nothing here costs a few
# seconds. It never touches the website - deploy.sh treats a failure here as a
# warning, and the site shows tests in English until the engine is up.
#
# What it sets up:
#   uv           a single binary that builds the Python environment, so the
#                machine needs no pip or venv packages from apt
#   /opt/avk-translator/venv
#                Python packages from translator/requirements.txt, exactly
#   $DATA_DIR/models/indictrans2-en-indic-200m-int8
#                the open-source model (MIT), pinned to one revision and
#                checked file by file against known SHA-256 sums
#   avk-translator.service
#                the engine, on 127.0.0.1:8911 only, as the app user, with a
#                low CPU priority, a CPU cap and a memory ceiling so it can
#                never starve the website of the machine it shares
#
set -euo pipefail

APP_USER="${APP_USER:-avk}"
APP_DIR="${APP_DIR:-/opt/avkvisions}"
DATA_DIR="${DATA_DIR:-/var/lib/avkvisions}"
PORT=8911

BASE="/opt/avk-translator"
VENV="$BASE/venv"
MODEL_DIR="$DATA_DIR/models/indictrans2-en-indic-200m-int8"

UV_VERSION="0.12.20"
UV_SHA256="6590717592ace991ff83a63fef799e3ad9d33ecc8f96c5d6bdd732496e79337f"

MODEL_REPO="naklitechie/indictrans2-en-indic-dist-200M-ONNX-int8"
MODEL_REVISION="e88c4f837dfbf2abecf239b5c89169dfa31580bb"
MODEL_FILES=(
  "LICENSE 383258420065a19d9fef0daf00d10792d3f8a5ccf783d94a91f5d6755386615b"
  "NOTICE.md b0c54bfe0f7c0ec5e93a5936c897f6fb276395f37a67e65ad331875e84f8947c"
  "config.json 55b5ae65491a5e6121de80dca2c2f6c898ac0249407ab00f580632e8f249a756"
  "generation_config.json 4617c59e9ed1ed45cc5b1068771cb5f9a0c5454724a9d98d9a2a1b58a6a84a5d"
  "tokenizer_meta.json 9f18574a040d815695f98ac53e7d8ca18ae38b90a339eb59301690fccfc62437"
  "tokenizer_src.json 913a7fe797e866de46c805d237846ff6433387e77117c377fddeb28b221808da"
  "tokenizer_tgt.json 716189cf0415e97829257aaef34ed66b10fcdcb68def679ea01063fc5fc220d2"
  "encoder_model.onnx 65726fc70e7fe73bdec5ab922caf16fe92285efe2329965894ec8143a87153f0"
  "decoder_model.onnx 6925537cbce0576431343b33d0239b7ad442c3dd86aefe0521d8c71d60941c41"
  "decoder_with_past_model.onnx 73d114343b59fcaa53f0909baf9ab5f13e11c4b0ce98d48404dd8b72d18ebfa1"
)

mkdir -p "$BASE"

# --- uv ----------------------------------------------------------------------
if ! /usr/local/bin/uv --version 2>/dev/null | grep -q " $UV_VERSION"; then
  echo "    installing uv $UV_VERSION"
  tmp="$(mktemp -d)"
  curl -fsSL --retry 3 -o "$tmp/uv.tar.gz" \
    "https://github.com/astral-sh/uv/releases/download/$UV_VERSION/uv-x86_64-unknown-linux-gnu.tar.gz"
  echo "$UV_SHA256  $tmp/uv.tar.gz" | sha256sum -c --quiet -
  tar -xzf "$tmp/uv.tar.gz" -C "$tmp"
  install -m 0755 "$tmp/uv-x86_64-unknown-linux-gnu/uv" /usr/local/bin/uv
  rm -rf "$tmp"
fi
UV=/usr/local/bin/uv
# Anything uv downloads lives under $BASE, which the app user can read -
# never under root's home, which it cannot.
export UV_CACHE_DIR="$BASE/.uv-cache"
export UV_PYTHON_INSTALL_DIR="$BASE/python"

# --- Python environment ------------------------------------------------------
REQUIREMENTS="$APP_DIR/translator/requirements.txt"
STAMP="$VENV/.requirements.sha256"
WANT="$(sha256sum "$REQUIREMENTS" | cut -c1-64)"
if [[ ! -x "$VENV/bin/python" || "$(cat "$STAMP" 2>/dev/null)" != "$WANT" ]]; then
  echo "    building the Python environment"
  if [[ ! -x "$VENV/bin/python" ]]; then
    # The system Python (3.10 on Ubuntu 22.04) is what was tested; uv fetches
    # its own 3.10 only if the machine somehow has none.
    if [[ -x /usr/bin/python3 ]]; then
      "$UV" venv --python /usr/bin/python3 "$VENV"
    else
      "$UV" venv --python 3.10 "$VENV"
    fi
  fi
  "$UV" pip install --python "$VENV/bin/python" -r "$REQUIREMENTS"
  # Declared dependencies (pandas, sphinx) are for parts the engine never uses.
  "$UV" pip install --python "$VENV/bin/python" --no-deps "indic-nlp-library==0.92"
  echo "$WANT" > "$STAMP"
fi
chmod -R a+rX "$BASE"

# --- Model -------------------------------------------------------------------
mkdir -p "$MODEL_DIR"
for entry in "${MODEL_FILES[@]}"; do
  file="${entry%% *}"
  sum="${entry##* }"
  if [[ -f "$MODEL_DIR/$file" ]] && echo "$sum  $MODEL_DIR/$file" | sha256sum -c --quiet - 2>/dev/null; then
    continue
  fi
  echo "    downloading $file"
  curl -fsSL --retry 3 -o "$MODEL_DIR/$file.part" \
    "https://huggingface.co/$MODEL_REPO/resolve/$MODEL_REVISION/$file"
  echo "$sum  $MODEL_DIR/$file.part" | sha256sum -c --quiet -
  mv "$MODEL_DIR/$file.part" "$MODEL_DIR/$file"
done
chown -R "$APP_USER:$APP_USER" "$DATA_DIR/models"

# --- Service -----------------------------------------------------------------
UNIT=/etc/systemd/system/avk-translator.service
NEW_UNIT="$(cat <<UNIT
[Unit]
Description=AVK Envisions Kannada translation engine
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR/translator
Environment=TRANSLATOR_MODEL_DIR=$MODEL_DIR
Environment=TRANSLATOR_PORT=$PORT
Environment=TRANSLATOR_THREADS=1
Environment=TRANSLATOR_LOW_MEMORY=1
Environment=PYTHONUNBUFFERED=1
ExecStart=$VENV/bin/python server.py
Restart=always
RestartSec=10

# The website comes first. An e2-small sustains only half a vCPU in total,
# and exceeding that throttles the whole machine, so the engine is capped
# well under it and yields to everything else; it runs in the gaps.
Nice=15
CPUWeight=20
CPUQuota=30%
MemoryHigh=1100M
MemoryMax=1400M

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

StandardOutput=journal
StandardError=journal
SyslogIdentifier=avk-translator

[Install]
WantedBy=multi-user.target
UNIT
)"
if [[ "$(cat "$UNIT" 2>/dev/null)" != "$NEW_UNIT" ]]; then
  echo "$NEW_UNIT" > "$UNIT"
  systemctl daemon-reload
fi
systemctl enable avk-translator >/dev/null 2>&1
# Restarted every deploy, so it runs the engine code that was just deployed.
systemctl restart avk-translator

# --- Up? ---------------------------------------------------------------------
for i in $(seq 1 60); do
  if curl -fsS --max-time 3 "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q '"ok": true'; then
    echo "    translation engine is running"
    exit 0
  fi
  sleep 3
done
echo "    the engine did not answer within 3 minutes; recent logs:" >&2
journalctl -u avk-translator -n 20 --no-pager >&2 || true
exit 1
