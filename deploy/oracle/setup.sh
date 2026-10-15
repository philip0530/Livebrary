#!/usr/bin/env bash
# Installs Livebrary on an Ubuntu VM (Oracle Cloud Always Free).
# Run from the project directory: sudo bash deploy/oracle/setup.sh
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/oracle/setup.sh"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE=/etc/livebrary.env
export DEBIAN_FRONTEND=noninteractive

if [[ ! -f "$ROOT/package.json" ]]; then
  echo "package.json not found at $ROOT"
  exit 1
fi

# The bot folder holds its .env, so move it out before the site user takes ownership of $ROOT.
if [[ -d "$ROOT/riyan-bot" ]]; then
  rm -rf /root/riyan-bot-src
  mv "$ROOT/riyan-bot" /root/riyan-bot-src
fi

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -z "${DOMAIN:-}" ]]; then
    read -r -p "Public hostname (example: livebrary.duckdns.org): " DOMAIN
  fi
  DOMAIN="${DOMAIN#https://}"
  DOMAIN="${DOMAIN#http://}"
  DOMAIN="${DOMAIN%%/*}"
  DOMAIN="${DOMAIN%.}"
  if [[ "$DOMAIN" != *.* || "$DOMAIN" == *" "* ]]; then
    echo "A DNS hostname is required. An IP address cannot get a free HTTPS certificate."
    exit 1
  fi
  if [[ -z "${ADMIN_EMAIL:-}" ]]; then
    read -r -p "Operator email: " ADMIN_EMAIL
  fi
  if [[ -z "${ADMIN_USERNAME:-}" ]]; then
    read -r -p "Operator username: " ADMIN_USERNAME
  fi
  if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
    read -r -s -p "Operator password (10+ chars, letters and digits): " ADMIN_PASSWORD
    echo
  fi
  if [[ "${#ADMIN_PASSWORD}" -lt 10 || ! "$ADMIN_PASSWORD" =~ [A-Za-z] || ! "$ADMIN_PASSWORD" =~ [0-9] ]]; then
    echo "Password must be 10 or more characters and include a letter and a digit."
    exit 1
  fi
  if [[ -z "${DUCKDNS_TOKEN:-}" ]]; then
    read -r -p "DuckDNS token (leave empty if DNS already points here): " DUCKDNS_TOKEN
  fi

  DB_PASSWORD="$(openssl rand -hex 24)"
  SESSION_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
  ENCRYPTION_KEY="$(openssl rand -base64 32 | tr -d '\n')"
  umask 077
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
SERVE_WEB=1
HOST=127.0.0.1
API_PORT=3001
COLLAB_PORT=1234
DATABASE_URL=postgresql://livebrary:${DB_PASSWORD}@127.0.0.1:5432/livebrary?schema=public
SESSION_SECRET=${SESSION_SECRET}
ADMIN_CODE_ENCRYPTION_KEY=${ENCRYPTION_KEY}
ADMIN_FALLBACK_CODE=Trust
PUBLIC_ORIGIN=https://${DOMAIN}
APP_ORIGIN=https://${DOMAIN}
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_USERNAME=${ADMIN_USERNAME}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
ADMIN_CODE_ROTATION_TIMEZONE=Asia/Seoul
DISCORD_LOG_ENABLED=false
DUCKDNS_TOKEN=${DUCKDNS_TOKEN}
DOMAIN=${DOMAIN}
EOF
  echo "Wrote $ENV_FILE"
else
  echo "Keeping existing $ENV_FILE"
fi
if ! grep -q '^RIYAN_SYNC_KEY=.' "$ENV_FILE"; then
  echo "RIYAN_SYNC_KEY=$(openssl rand -hex 32)" >> "$ENV_FILE"
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

if ! id livebrary >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin livebrary
fi
chown root:livebrary "$ENV_FILE"
chmod 640 "$ENV_FILE"

apt-get update
apt-get install -y ca-certificates curl gnupg build-essential python3 git postgresql postgresql-contrib debian-keyring debian-archive-keyring apt-transport-https

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

PG_PASSWORD="$(printf '%s' "$DATABASE_URL" | sed -n 's#postgresql://livebrary:\([^@]*\)@.*#\1#p')"
if [[ -z "$PG_PASSWORD" ]]; then
  echo "DATABASE_URL in $ENV_FILE is missing the livebrary password."
  exit 1
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='livebrary'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE USER livebrary WITH PASSWORD '${PG_PASSWORD}'"
else
  sudo -u postgres psql -c "ALTER USER livebrary WITH PASSWORD '${PG_PASSWORD}'"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='livebrary'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE DATABASE livebrary OWNER livebrary"
fi

if [[ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 3000000 ]] && ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Copy users and projects from the Render database once, while this database is still empty.
TABLES="$(sudo -u postgres psql -d livebrary -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
if [[ "$TABLES" == "0" ]]; then
  if [[ -z "${RENDER_DATABASE_URL+x}" ]]; then
    read -r -p "Render External Database URL to copy existing data (empty = start fresh): " RENDER_DATABASE_URL
  fi
  if [[ -n "$RENDER_DATABASE_URL" ]]; then
    DUMP="$(mktemp /tmp/livebrary-render-XXXXXX.sql)"
    chmod 644 "$DUMP"
    if pg_dump --no-owner --no-acl "$RENDER_DATABASE_URL" > "$DUMP"; then
      sudo -u postgres psql -q -d livebrary -c 'SET ROLE livebrary' -f "$DUMP" || echo "Some lines of the Render data could not be imported."
      echo "Imported the Render database."
    else
      echo "Could not read the Render database. Continuing with an empty database."
    fi
    rm -f "$DUMP"
  fi
fi

chown -R livebrary:livebrary "$ROOT"
sudo -u livebrary npm ci --prefix "$ROOT"
sudo -u livebrary npm run build --prefix "$ROOT"
sudo -u livebrary bash -c "set -a; . /etc/livebrary.env; set +a; cd '$ROOT'; npm run db:migrate"
sudo -u livebrary bash -c "set -a; . /etc/livebrary.env; set +a; cd '$ROOT'; npm run db:seed"

cat > /etc/caddy/Caddyfile <<EOF
{
  email ${ADMIN_EMAIL}
}

${DOMAIN} {
  encode gzip
  reverse_proxy 127.0.0.1:3001 {
    header_up Host {host}
    header_up X-Forwarded-Host {host}
    header_up X-Forwarded-Proto {scheme}
  }
}
EOF

sed "s#/opt/livebrary#${ROOT}#g" "$ROOT/deploy/oracle/livebrary.service" > /etc/systemd/system/livebrary.service
systemctl daemon-reload
systemctl enable livebrary
systemctl restart livebrary
systemctl reload caddy || systemctl restart caddy

if ! iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null; then
  iptables -I INPUT -p tcp --dport 80 -j ACCEPT
fi
if ! iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null; then
  iptables -I INPUT -p tcp --dport 443 -j ACCEPT
fi
if command -v netfilter-persistent >/dev/null 2>&1; then
  netfilter-persistent save
else
  echo iptables-persistent iptables-persistent/autosave_v4 boolean true | debconf-set-selections
  echo iptables-persistent iptables-persistent/autosave_v6 boolean true | debconf-set-selections
  apt-get install -y iptables-persistent
fi

if [[ -n "${DUCKDNS_TOKEN:-}" ]]; then
  SUBDOMAIN="${DOMAIN%%.*}"
  cat > /usr/local/bin/livebrary-duckdns <<EOF
#!/bin/sh
curl -fsS "https://www.duckdns.org/update?domains=${SUBDOMAIN}&token=${DUCKDNS_TOKEN}&ip="
EOF
  chmod 700 /usr/local/bin/livebrary-duckdns
  /usr/local/bin/livebrary-duckdns || true
  echo "*/5 * * * * root /usr/local/bin/livebrary-duckdns >/var/log/livebrary-duckdns.log 2>&1" > /etc/cron.d/livebrary-duckdns
fi

if [[ -f /root/riyan-bot-src/package.json || -f /opt/riyan-bot/package.json ]]; then
  bash "$ROOT/deploy/oracle/setup-bot.sh"
fi

echo
echo "Livebrary is starting at https://${DOMAIN}"
echo "Oracle security list must allow TCP 80 and 443 from 0.0.0.0/0."
echo "DNS for ${DOMAIN} must point at this VM before the certificate is issued."
