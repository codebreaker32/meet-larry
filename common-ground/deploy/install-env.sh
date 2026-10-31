#!/usr/bin/env bash
# Runs ON the VM as root; reads the new env on stdin (write-env.sh sends it). Never prints values.
# Keeps an existing MEET_SECRET, or makes one (64 characters). Refuses development-only switches.
set -euo pipefail
umask 077
new="$(mktemp)"
trap 'rm -f "$new"' EXIT
cat > "$new"

if grep -qE '^(LARRY_ALLOW_NO_CODE|E2E|NEXT_PUBLIC_E2E)=' "$new"; then
  echo "refusing: development-only switches must not be set in production"; exit 1
fi
secret=""
if [ -f /etc/larry/env ]; then
  secret="$(grep -E '^MEET_SECRET=' /etc/larry/env | tail -n 1 | cut -d= -f2- || true)"
fi
incoming="$(grep -E '^MEET_SECRET=' "$new" | tail -n 1 | cut -d= -f2- || true)"
[ -n "$incoming" ] && secret="$incoming"
[ "${#secret}" -ge 32 ] || secret="$(openssl rand -base64 48 | tr -d '\n')"
grep -vE '^MEET_SECRET=' "$new" > "$new.body" || true
{ cat "$new.body"; echo "MEET_SECRET=$secret"; } > "$new"
rm -f "$new.body"

# root-only: systemd reads EnvironmentFile as root; release.sh passes only the public lines to the build.
install -o root -g root -m 600 "$new" /etc/larry/env
echo "/etc/larry/env written: $(grep -cE '^[A-Z_]+=' /etc/larry/env) variables ($(grep -oE '^[A-Z_]+' /etc/larry/env | tr '\n' ' '))"
