#!/usr/bin/env bash
# Runs ON the VM as root (provision.sh calls it). Safe to re-run.
#   sudo bash vm-setup.sh <host>
# Installs swap, Node 22, Caddy, the larry user, the systemd units and the preview Caddyfile.
set -euo pipefail
host="${1:?usage: vm-setup.sh <host>}"
src="$(cd "$(dirname "$0")" && pwd)"
export DEBIAN_FRONTEND=noninteractive

echo "== swap (next build can run out of memory on 4 GB)"
if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
  [ -f /swapfile ] || fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== packages"
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg debian-keyring debian-archive-keyring apt-transport-https python3 openssl
if ! command -v node >/dev/null || ! node -v | grep -q '^v22\.'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -y -q caddy
fi

echo "== user and folders"
id larry >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/larry --shell /usr/sbin/nologin larry
install -d -o larry -g larry -m 750 /var/lib/larry /var/lib/larry/data
# Code is root-owned: the app user can read it but not rewrite it (release.sh chowns each build).
install -d -o root -g root -m 755 /opt/larry /opt/larry/releases
install -d -o larry -g larry -m 750 /var/lib/larry/next
[ -f /etc/larry/env ] && chown root:root /etc/larry/env && chmod 600 /etc/larry/env
install -d -o root -g root -m 755 /opt/larry/deploy /etc/larry
install -m 755 "$src"/*.sh /opt/larry/deploy/
install -m 644 "$src"/Caddyfile.* /opt/larry/deploy/
echo "$host" > /etc/larry/host

echo "== sshd (10- sorts first, and the first value wins; port 22 is reachable from the IAP range only; no root login at all)"
printf 'PermitRootLogin no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\n' > /etc/ssh/sshd_config.d/10-larry.conf
sshd -t && systemctl reload ssh

echo "== systemd units"
install -m 644 "$src"/larry-web.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable larry-web >/dev/null 2>&1

echo "== Caddy (preview mode unless already public)"
if [ "$(cat /etc/larry/mode 2>/dev/null || echo preview)" = public ]; then
  bash /opt/larry/deploy/caddy-config.sh public
else
  bash /opt/larry/deploy/caddy-config.sh preview
fi
echo "vm-setup done for $host"
