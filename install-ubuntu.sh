#!/usr/bin/env bash
# Instal BotLink dari folder source saat ini untuk Ubuntu/Debian.
# Jalankan: sudo bash install-ubuntu.sh
set -Eeuo pipefail
IFS=$'\n\t'

APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SERVICE_NAME="botlink"
SERVICE_USER="botlink"
ENV_FILE="$APP_DIR/.env"
NODE_MAJOR=22
BACKUP_ENV=""

fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }
cleanup() { unset ADMIN_PASSWORD NINE_ROUTER_API_KEY TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET TELEGRAM_VEO_ALLOWED_USER_IDS 2>/dev/null || true; }
trap cleanup EXIT

[[ "${EUID}" -eq 0 ]] || fail "Jalankan sebagai root: sudo bash install-ubuntu.sh"
[[ -f "$APP_DIR/package.json" && -f "$APP_DIR/src/index.js" ]] || fail "Installer harus berada di folder root source BotLink."
[[ -t 0 && -t 1 ]] || fail "Installer memerlukan terminal interaktif."

prompt_value() {
  local label="$1" default="${2:-}" value=""
  if [[ -n "$default" ]]; then
    read -r -p "$label [$default]: " value
    printf '%s' "${value:-$default}"
  else
    while [[ -z "$value" ]]; do read -r -p "$label: " value; done
    printf '%s' "$value"
  fi
}

prompt_password() {
  local first="" second=""
  while true; do
    read -r -s -p "Password admin (minimal 12 karakter): " first; echo
    read -r -s -p "Ulangi password admin: " second; echo
    if [[ ${#first} -lt 12 ]]; then
      echo "Password minimal 12 karakter." >&2
    elif [[ "$first" != "$second" ]]; then
      echo "Password tidak sama." >&2
    else
      printf '%s' "$first"
      return
    fi
  done
}

valid_https_url() {
  [[ "$1" =~ ^https://[A-Za-z0-9._~:/?#\[\]@!$\&\(\)*+,\;=%-]+$ ]] && [[ "$1" != *"@"* ]]
}

env_quote() {
  local value="$1"
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//\$/\\$}
  value=${value//\`/\\\`}
  printf '"%s"' "$value"
}

APT_UPDATED=false
apt_update_once() {
  if [[ "$APT_UPDATED" != true ]]; then
    apt-get update
    APT_UPDATED=true
  fi
}

install_missing_packages() {
  local package missing=()
  for package in "$@"; do
    if ! dpkg-query -W -f='${db:Status-Abbrev}' "$package" 2>/dev/null | grep -q '^ii '; then
      missing+=("$package")
    fi
  done

  if (( ${#missing[@]} > 0 )); then
    printf 'Memasang paket yang belum tersedia: %s\n' "${missing[*]}"
    apt_update_once
    apt-get install -y --no-install-recommends "${missing[@]}"
  else
    printf 'Semua paket sistem yang dibutuhkan sudah tersedia.\n'
  fi
}

if [[ -e "$ENV_FILE" ]]; then
  read -r -p ".env sudah ada. Backup lalu ganti? [y/N]: " replace_env
  [[ "$replace_env" =~ ^[Yy]$ ]] || fail "Instalasi dibatalkan; .env tidak diubah."
  BACKUP_ENV="${ENV_FILE}.backup.$(date +%Y%m%d-%H%M%S)"
  cp --preserve=mode,timestamps "$ENV_FILE" "$BACKUP_ENV"
  chmod 600 "$BACKUP_ENV"
fi

APP_NAME="$(prompt_value 'Nama aplikasi' 'BotLink')"
[[ "$APP_NAME" != *$'\n'* && "$APP_NAME" != *$'\r'* ]] || fail "Nama aplikasi tidak valid."
ADMIN_USERNAME="$(prompt_value 'Username admin' 'admin')"
[[ "$ADMIN_USERNAME" =~ ^[A-Za-z0-9._-]{3,64}$ ]] || fail "Username hanya boleh huruf, angka, titik, garis bawah, atau minus (3-64 karakter)."
ADMIN_PASSWORD="$(prompt_password)"
NINE_ROUTER_API_URL="$(prompt_value 'Base URL API 9Router OpenAI-compatible' 'https://api.example.com/v1')"
NINE_ROUTER_API_URL="${NINE_ROUTER_API_URL%/}"
valid_https_url "$NINE_ROUTER_API_URL" || fail "Base URL harus HTTPS tanpa credential atau spasi."
read -r -s -p "API key 9Router: " NINE_ROUTER_API_KEY; echo
[[ -n "$NINE_ROUTER_API_KEY" && "$NINE_ROUTER_API_KEY" != *$'\n'* && "$NINE_ROUTER_API_KEY" != *$'\r'* ]] || fail "API key 9Router wajib diisi dan tidak boleh berisi baris baru."
NINE_ROUTER_VIDEO_ENDPOINT="$(prompt_value 'Endpoint video 9Router relatif ke base URL' 'videos')"
NINE_ROUTER_VIDEO_ENDPOINT="${NINE_ROUTER_VIDEO_ENDPOINT#/}"
NINE_ROUTER_VIDEO_ENDPOINT="${NINE_ROUTER_VIDEO_ENDPOINT%/}"
[[ -n "$NINE_ROUTER_VIDEO_ENDPOINT" && "$NINE_ROUTER_VIDEO_ENDPOINT" != *..* && "$NINE_ROUTER_VIDEO_ENDPOINT" != *' '* && "$NINE_ROUTER_VIDEO_ENDPOINT" != *$'\n'* && "$NINE_ROUTER_VIDEO_ENDPOINT" != *'?'* && "$NINE_ROUTER_VIDEO_ENDPOINT" != *'#'* ]] || fail "Endpoint video tidak valid."
PORT="$(prompt_value 'Port aplikasi' '3100')"
[[ "$PORT" =~ ^[0-9]{2,5}$ ]] && (( PORT >= 1024 && PORT <= 65535 )) || fail "Port harus antara 1024 dan 65535."
APP_URL="$(prompt_value 'URL publik aplikasi' "https://$(hostname -f 2>/dev/null || hostname)")"
APP_URL="${APP_URL%/}"
valid_https_url "$APP_URL" || fail "URL publik harus HTTPS tanpa credential atau spasi."
TELEGRAM_BOT_TOKEN=""
if [[ -n "$BACKUP_ENV" ]]; then
  read -r -p "Pertahankan TELEGRAM_BOT_TOKEN dari .env lama? [Y/n]: " keep_bot_token
  if [[ ! "$keep_bot_token" =~ ^[Nn]$ ]]; then
    TELEGRAM_BOT_TOKEN="$(sed -n 's/^TELEGRAM_BOT_TOKEN=//p' "$BACKUP_ENV" | tail -n 1)"
    [[ "$TELEGRAM_BOT_TOKEN" == \"*\" ]] && TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:1:${#TELEGRAM_BOT_TOKEN}-2}"
  fi
fi
if [[ -z "$TELEGRAM_BOT_TOKEN" ]]; then
  read -r -s -p "Token bot Telegram dari BotFather (kosongkan untuk nonaktif): " TELEGRAM_BOT_TOKEN; echo
fi
[[ "$TELEGRAM_BOT_TOKEN" != *$'\n'* && "$TELEGRAM_BOT_TOKEN" != *$'\r'* ]] || fail "Token Telegram tidak valid."
TELEGRAM_VEO_ALLOWED_USER_IDS=""
if [[ -n "$TELEGRAM_BOT_TOKEN" ]]; then
  TELEGRAM_MODE="$(prompt_value 'Mode Telegram: polling atau webhook' 'webhook')"
  [[ "$TELEGRAM_MODE" =~ ^(polling|webhook)$ ]] || fail "Mode Telegram harus polling atau webhook."
  if [[ -n "$BACKUP_ENV" ]]; then
    TELEGRAM_VEO_ALLOWED_USER_IDS="$(sed -n 's/^TELEGRAM_VEO_ALLOWED_USER_IDS=//p' "$BACKUP_ENV" | tail -n 1)"
    [[ "$TELEGRAM_VEO_ALLOWED_USER_IDS" == \"*\" ]] && TELEGRAM_VEO_ALLOWED_USER_IDS="${TELEGRAM_VEO_ALLOWED_USER_IDS:1:${#TELEGRAM_VEO_ALLOWED_USER_IDS}-2}"
  fi
  read -r -p "ID pengguna Telegram yang boleh memakai Veo, pisahkan koma (kosong=nonaktif) [${TELEGRAM_VEO_ALLOWED_USER_IDS}]: " veo_ids
  TELEGRAM_VEO_ALLOWED_USER_IDS="${veo_ids:-$TELEGRAM_VEO_ALLOWED_USER_IDS}"
  [[ -z "$TELEGRAM_VEO_ALLOWED_USER_IDS" || "$TELEGRAM_VEO_ALLOWED_USER_IDS" =~ ^[1-9][0-9]{0,19}(,[1-9][0-9]{0,19})*$ ]] || fail "Daftar ID Telegram Veo tidak valid. Gunakan ID numerik tanpa spasi, dipisahkan koma."
  if [[ -n "$TELEGRAM_VEO_ALLOWED_USER_IDS" ]]; then
    [[ "$(tr ',' '\n' <<< "$TELEGRAM_VEO_ALLOWED_USER_IDS" | sort -u | wc -l)" -eq "$(tr ',' '\n' <<< "$TELEGRAM_VEO_ALLOWED_USER_IDS" | wc -l)" ]] || fail "ID Telegram Veo tidak boleh duplikat."
  fi
else
  TELEGRAM_MODE="disabled"
fi
TELEGRAM_WEBHOOK_PATH=""
TELEGRAM_WEBHOOK_SECRET=""
if [[ "$TELEGRAM_MODE" == "webhook" ]]; then
  valid_https_url "$APP_URL" || fail "Mode webhook membutuhkan APP_URL HTTPS."
  TELEGRAM_WEBHOOK_PATH="/telegram/webhook/$(openssl rand -hex 24)"
  TELEGRAM_WEBHOOK_SECRET="$(openssl rand -hex 32)"
fi
TELEGRAM_WEBHOOK_MAX_CONNECTIONS=20
TELEGRAM_COOLDOWN_SECONDS=30
TELEGRAM_VEO_MAX_ACTIVE_PER_USER=1
TELEGRAM_VEO_DAILY_LIMIT=3
TELEGRAM_VEO_STATUS_COOLDOWN_SECONDS=15

export DEBIAN_FRONTEND=noninteractive
install_missing_packages ca-certificates curl gnupg openssl ffmpeg python3 python3-pip

if command -v node >/dev/null 2>&1; then
  INSTALLED_NODE_VERSION="$(node --version)"
  INSTALLED_NODE_MAJOR="$(node -p 'Number(process.versions.node.split(`.`)[0])' 2>/dev/null || true)"
else
  INSTALLED_NODE_VERSION="tidak tersedia"
  INSTALLED_NODE_MAJOR=0
fi

if ! [[ "$INSTALLED_NODE_MAJOR" =~ ^[0-9]+$ ]] || (( INSTALLED_NODE_MAJOR < NODE_MAJOR )); then
  printf 'Node.js %s terdeteksi; memasang Node.js %s.x.\n' "$INSTALLED_NODE_VERSION" "$NODE_MAJOR"
  install -m 0755 -d /etc/apt/keyrings
  NODE_SOURCE_KEYRING='/etc/apt/keyrings/nodesource.gpg'
  NODE_SOURCE_LIST='/etc/apt/sources.list.d/nodesource.list'
  if [[ ! -s "$NODE_SOURCE_KEYRING" ]]; then
    curl -fsSL --proto '=https' --tlsv1.2 https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o "$NODE_SOURCE_KEYRING"
  fi
  printf 'deb [signed-by=%s] https://deb.nodesource.com/node_%s.x nodistro main\n' "$NODE_SOURCE_KEYRING" "$NODE_MAJOR" > "$NODE_SOURCE_LIST"
  APT_UPDATED=false
  apt_update_once
  apt-get install -y --no-install-recommends nodejs
else
  printf 'Node.js %s sudah memenuhi kebutuhan (>= %s).\n' "$INSTALLED_NODE_VERSION" "$NODE_MAJOR"
fi

FINAL_NODE_MAJOR="$(node -p 'Number(process.versions.node.split(`.`)[0])' 2>/dev/null || true)"
[[ "$FINAL_NODE_MAJOR" =~ ^[0-9]+$ ]] && (( FINAL_NODE_MAJOR >= NODE_MAJOR )) || fail "Node.js ${NODE_MAJOR} atau lebih baru gagal dipasang."
command -v npm >/dev/null 2>&1 || fail "npm tidak tersedia setelah instalasi Node.js."

id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
cd "$APP_DIR"
npm ci --omit=dev
ADMIN_PASSWORD_HASH="$(printf '%s' "$ADMIN_PASSWORD" | node scripts/hash-password.js --stdin)"
unset ADMIN_PASSWORD
SESSION_SECRET="$(openssl rand -hex 32)"
ENCRYPTION_KEY="$(openssl rand -hex 32)"

install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0750 "$APP_DIR/data" "$APP_DIR/storage" "$APP_DIR/storage/tmp"
install -d -o root -g "$SERVICE_USER" -m 0750 "$APP_DIR/bin"
YTDLP_VERSION="2025.06.30"
YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp"
YTDLP_SHA_URL="https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/SHA2-256SUMS"
YTDLP_TMP="$(mktemp /tmp/botlink-yt-dlp.XXXXXX)"
curl -fL --proto '=https' --tlsv1.2 "$YTDLP_URL" -o "$YTDLP_TMP"
EXPECTED_SHA="$(curl -fsSL --proto '=https' --tlsv1.2 "$YTDLP_SHA_URL" | tr -d '\r' | awk '$2 == "yt-dlp" {print $1; exit}')"
[[ "$EXPECTED_SHA" =~ ^[a-fA-F0-9]{64}$ ]] || fail "Checksum yt-dlp tidak dapat diverifikasi."
printf '%s  %s\n' "$EXPECTED_SHA" "$YTDLP_TMP" | sha256sum -c - >/dev/null || fail "Checksum yt-dlp tidak cocok."
install -o root -g "$SERVICE_USER" -m 0550 "$YTDLP_TMP" "$APP_DIR/bin/yt-dlp"
rm -f "$YTDLP_TMP"
umask 077
TEMP_ENV="$(mktemp "$APP_DIR/.env.tmp.XXXXXX")"
cat > "$TEMP_ENV" <<EOF
APP_NAME=$(env_quote "$APP_NAME")
NODE_ENV=production
PORT=$PORT
APP_URL=$(env_quote "$APP_URL")
TELEGRAM_BOT_TOKEN=$(env_quote "$TELEGRAM_BOT_TOKEN")
TELEGRAM_MODE=$(env_quote "$TELEGRAM_MODE")
TELEGRAM_WEBHOOK_PATH=$(env_quote "$TELEGRAM_WEBHOOK_PATH")
TELEGRAM_WEBHOOK_SECRET=$(env_quote "$TELEGRAM_WEBHOOK_SECRET")
TELEGRAM_WEBHOOK_MAX_CONNECTIONS=$TELEGRAM_WEBHOOK_MAX_CONNECTIONS
TELEGRAM_COOLDOWN_SECONDS=$TELEGRAM_COOLDOWN_SECONDS
TELEGRAM_VEO_ALLOWED_USER_IDS=$(env_quote "$TELEGRAM_VEO_ALLOWED_USER_IDS")
TELEGRAM_VEO_MAX_ACTIVE_PER_USER=$TELEGRAM_VEO_MAX_ACTIVE_PER_USER
TELEGRAM_VEO_DAILY_LIMIT=$TELEGRAM_VEO_DAILY_LIMIT
TELEGRAM_VEO_STATUS_COOLDOWN_SECONDS=$TELEGRAM_VEO_STATUS_COOLDOWN_SECONDS
ADMIN_USERNAME=$(env_quote "$ADMIN_USERNAME")
ADMIN_PASSWORD_HASH=$(env_quote "$ADMIN_PASSWORD_HASH")
SESSION_SECRET=$(env_quote "$SESSION_SECRET")
SETTINGS_ENCRYPTION_KEY=$(env_quote "$ENCRYPTION_KEY")
NINE_ROUTER_API_URL=$(env_quote "$NINE_ROUTER_API_URL")
NINE_ROUTER_API_KEY=$(env_quote "$NINE_ROUTER_API_KEY")
NINE_ROUTER_VIDEO_ENDPOINT=$(env_quote "$NINE_ROUTER_VIDEO_ENDPOINT")
MAX_FILE_SIZE_MB=45
DOWNLOAD_TIMEOUT_SECONDS=180
CLEANUP_AFTER_MINUTES=30
DOWNLOAD_CONCURRENCY=2
DOWNLOAD_QUEUE_LIMIT=20
YTDLP_BINARY=$(env_quote "$APP_DIR/bin/yt-dlp")
EOF
unset NINE_ROUTER_API_KEY TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET TELEGRAM_VEO_ALLOWED_USER_IDS
chown root:"$SERVICE_USER" "$TEMP_ENV"
chmod 640 "$TEMP_ENV"
mv -f "$TEMP_ENV" "$ENV_FILE"
chown root:"$SERVICE_USER" "$ENV_FILE"
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR/data" "$APP_DIR/storage"
chown -R root:"$SERVICE_USER" "$APP_DIR/bin"
chmod 0750 "$APP_DIR/bin"
chmod 0550 "$APP_DIR/bin/yt-dlp"

NODE_BIN="$(command -v node)"
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=BotLink media downloader and AI video service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN src/index.js
Restart=on-failure
RestartSec=5
UMask=0027
MemoryMax=1G
CPUQuota=200%
TasksMax=128
LimitNOFILE=4096
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
ReadWritePaths=$APP_DIR/data $APP_DIR/storage

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
if ! systemctl restart "$SERVICE_NAME"; then
  journalctl -u "$SERVICE_NAME" -n 50 --no-pager >&2 || true
  fail "Service gagal dimulai."
fi
systemctl is-active --quiet "$SERVICE_NAME" || { journalctl -u "$SERVICE_NAME" -n 50 --no-pager >&2 || true; fail "Service tidak aktif."; }
printf '\nInstalasi selesai. Akses aplikasi: %s\n' "$APP_URL"
[[ -n "$BACKUP_ENV" ]] && printf 'Backup konfigurasi lama: %s\n' "$BACKUP_ENV"
printf 'Status: systemctl status %s\nLog: journalctl -u %s -f\n' "$SERVICE_NAME" "$SERVICE_NAME"
