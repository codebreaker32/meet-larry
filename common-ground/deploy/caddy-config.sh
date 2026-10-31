#!/usr/bin/env bash
# Runs ON the VM as root. Renders /etc/caddy/Caddyfile and restarts Caddy.
#   sudo bash /opt/larry/deploy/caddy-config.sh preview|public
# preview: every page answers 401 unless the browser holds the preview cookie, which is set only
#          after a basic-auth login at https://<host>/__preview. Set PREVIEW_USER and
#          PREVIEW_SECRET_DIR (a root-only folder for the generated password and cookie). Cookie, not
#          plain basic auth on every request, because the app sends its own Bearer token header.
# public:  no gate.
# The secrets go straight into the rendered file (mode 640 root:caddy), never into Caddy's
# environment, because the packaged unit logs its environment at start (--environ).
set -euo pipefail
mode="${1:?usage: caddy-config.sh preview|public}"
host="$(cat /etc/larry/host)"
dir=/opt/larry/deploy
secret_dir="${PREVIEW_SECRET_DIR:-}"
export PREVIEW_USER="${PREVIEW_USER:-preview}"

if [ "$mode" = preview ]; then
  [ -n "$secret_dir" ] || { echo "set PREVIEW_SECRET_DIR (root-only folder) for preview mode"; exit 1; }
  install -d -m 700 "$secret_dir"
  if [ ! -s "$secret_dir/password" ]; then
    (umask 077; openssl rand -base64 18 | tr -d '\n=+/' > "$secret_dir/password")
  fi
  if [ ! -s "$secret_dir/cookie" ]; then
    (umask 077; openssl rand -hex 32 > "$secret_dir/cookie")
  fi
  # Password on stdin, never in argv (argv is readable by any local process via /proc). Without
  # --plaintext and with a non-terminal stdin, caddy reads one line and needs the newline, which the
  # file (written with tr -d '\n') lacks: hence the echo.
  hash="$({ cat "$secret_dir/password"; echo; } | caddy hash-password)"
  template="$dir/Caddyfile.preview"
else
  hash=""
  template="$dir/Caddyfile.public"
fi

HOST="$host" HASH="$hash" COOKIE="$( [ -n "$secret_dir" ] && cat "$secret_dir/cookie" 2>/dev/null || true)" python3 - "$template" > /etc/caddy/Caddyfile.new <<'PY'
import os, sys
text = open(sys.argv[1]).read()
for key in ("HOST", "HASH", "COOKIE", "PREVIEW_USER"):
    text = text.replace("@@" + key + "@@", os.environ[key])
sys.stdout.write(text)
PY
chown root:caddy /etc/caddy/Caddyfile.new
chmod 640 /etc/caddy/Caddyfile.new
caddy validate --config /etc/caddy/Caddyfile.new --adapter caddyfile >/dev/null 2>&1 \
  || { echo "Caddyfile did not validate"; caddy validate --config /etc/caddy/Caddyfile.new --adapter caddyfile 2>&1 | grep -v -i -e cookie -e '\$2a' | tail -5; exit 1; }
mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile
echo "$mode" > /etc/larry/mode
systemctl enable caddy >/dev/null 2>&1
# Restart, not reload: the Caddyfiles turn the admin API off, and `systemctl reload caddy` goes through it.
systemctl restart caddy
echo "Caddy: $mode mode on https://$host"
