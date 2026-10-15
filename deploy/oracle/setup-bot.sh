#!/usr/bin/env bash
# Installs the Riyan Discord bot next to Livebrary on the same VM.
# setup.sh runs this automatically when the deploy archive contains riyan-bot/.
# Run again after uploading a new bot version: sudo bash deploy/oracle/setup-bot.sh
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/oracle/setup-bot.sh"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BOT_SRC="${BOT_SRC:-/root/riyan-bot-src}"
BOT_DIR=/opt/riyan-bot
BOT_ENV=/etc/riyan-bot.env
SITE_ENV=/etc/livebrary.env

if [[ -d "$ROOT/riyan-bot" ]]; then
  rm -rf "$BOT_SRC"
  mv "$ROOT/riyan-bot" "$BOT_SRC"
fi
if [[ ! -f "$BOT_SRC/package.json" && ! -f "$BOT_DIR/package.json" ]]; then
  echo "No riyan-bot found in the archive. Skipping the bot."
  exit 0
fi
if [[ ! -f "$SITE_ENV" ]]; then
  echo "$SITE_ENV is missing. Run deploy/oracle/setup.sh first."
  exit 1
fi

site_value() {
  sed -n "s/^$1=//p" "$SITE_ENV" | tail -n 1
}

if ! id riyan >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin riyan
fi

if [[ -f "$BOT_SRC/package.json" ]]; then
  mkdir -p "$BOT_DIR"
  rm -rf "$BOT_DIR/src" "$BOT_DIR/scripts" "$BOT_DIR/sql" "$BOT_DIR/templates"
  cp -a "$BOT_SRC/." "$BOT_DIR/"
  rm -f "$BOT_DIR/.env.upload" "$BOT_DIR/riyan-bot.sql"
fi

# The bot gets its own database and login, separate from the site's.
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='riyan'" | grep -q 1; then
  BOT_DB_PASSWORD="$(openssl rand -hex 24)"
  sudo -u postgres psql -c "CREATE USER riyan WITH PASSWORD '${BOT_DB_PASSWORD}'"
else
  BOT_DB_PASSWORD=""
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='riyan'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE DATABASE riyan OWNER riyan"
fi

if [[ ! -f "$BOT_ENV" ]]; then
  if [[ ! -f "$BOT_SRC/.env.upload" ]]; then
    echo "The bot settings were not in the archive (riyan-bot/.env.upload)."
    echo "Re-run pack.ps1 on the PC where the bot's .env lives, upload again, then run this script."
    exit 1
  fi
  if [[ -z "$BOT_DB_PASSWORD" ]]; then
    BOT_DB_PASSWORD="$(openssl rand -hex 24)"
    sudo -u postgres psql -c "ALTER USER riyan WITH PASSWORD '${BOT_DB_PASSWORD}'"
  fi
  SYNC_KEY="$(site_value RIYAN_SYNC_KEY)"
  DOMAIN="$(site_value DOMAIN)"
  umask 077
  # The upload comes from Windows (CRLF). Values that only make sense on the PC are replaced with server values.
  tr -d '\r' < "$BOT_SRC/.env.upload" \
    | grep -vE '^(DATABASE_URL|LIVEBRARY_SYNC_URLS|LIVEBRARY_SYNC_KEY|LIVEBRARY_CONNECT_URL|INTERNAL_HOST)=' \
    | grep -vE '^# .*(봇 데이터베이스 주소|연동할 사이트 주소|사이트 연동 키|가입 인증·가입 알림|/인증 실패 메시지|봇 내부 API 주소)' > "$BOT_ENV"
  cat >> "$BOT_ENV" <<EOF

# ===== Set by deploy/oracle/setup-bot.sh =====
# Bot database on this server
DATABASE_URL=postgresql://riyan:${BOT_DB_PASSWORD}@127.0.0.1:5432/riyan
# The site runs on the same server, so the bot talks to it directly
LIVEBRARY_SYNC_URLS=http://127.0.0.1:3001
# Same value as RIYAN_SYNC_KEY in ${SITE_ENV}
LIVEBRARY_SYNC_KEY=${SYNC_KEY}
LIVEBRARY_CONNECT_URL=https://${DOMAIN}
INTERNAL_HOST=127.0.0.1
EOF
  echo "Wrote $BOT_ENV"
else
  echo "Keeping existing $BOT_ENV"
fi
chown root:riyan "$BOT_ENV"
chmod 640 "$BOT_ENV"

chown -R riyan:riyan "$BOT_DIR"
if [[ -f "$BOT_DIR/package-lock.json" ]]; then
  sudo -u riyan npm ci --omit=dev --prefix "$BOT_DIR"
else
  sudo -u riyan npm install --omit=dev --prefix "$BOT_DIR"
fi

# Copy the bot's old data from the PC once (Discord links, weekly code, delivery queue).
HAS_BOT_TABLES="$(sudo -u postgres psql -d riyan -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'riyan\_%'")"
if [[ "$HAS_BOT_TABLES" == "0" && -f "$BOT_SRC/riyan-bot.sql" ]]; then
  echo "Importing the bot data from the PC"
  # The PC runs PostgreSQL 17; Ubuntu 24.04 ships 16, which does not know transaction_timeout.
  sed '/^SET transaction_timeout/d' "$BOT_SRC/riyan-bot.sql" > /tmp/riyan-bot.sql
  chmod 644 /tmp/riyan-bot.sql
  sudo -u postgres psql -q -d riyan -c 'SET ROLE riyan' -f /tmp/riyan-bot.sql || echo "Some lines of the bot data could not be imported. The bot still starts."
  rm -f /tmp/riyan-bot.sql
fi
sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d riyan -c 'SET ROLE riyan' -f "$BOT_DIR/sql/schema.sql"

sudo -u riyan bash -c "cd '$BOT_DIR' && node --env-file='$BOT_ENV' scripts/register.js" \
  || echo "Slash command registration failed. Check DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID and DISCORD_GUILD_ID in $BOT_ENV."

sed "s#/opt/riyan-bot#${BOT_DIR}#g" "$ROOT/deploy/oracle/riyan-bot.service" > /etc/systemd/system/riyan-bot.service
systemctl daemon-reload
systemctl enable riyan-bot
systemctl restart riyan-bot
rm -rf "$BOT_SRC"

echo
echo "Riyan bot is running. Logs: sudo journalctl -u riyan-bot -f"
echo "Turn off the bot on your PC now, or both copies will answer Discord commands."
