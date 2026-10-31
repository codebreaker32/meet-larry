#!/usr/bin/env bash
# Opens Larry to everyone (only when the user says so). Run from the dev machine.
#   bash deploy/go-public.sh            remove the preview gate
#   bash deploy/go-public.sh --private  put the preview gate back
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
. "$here/config.sh"
if [ "${1:-}" = "--private" ]; then
  vm_ssh --command "sudo bash /opt/larry/deploy/caddy-config.sh preview"
else
  vm_ssh --command "sudo bash /opt/larry/deploy/caddy-config.sh public && systemctl is-active larry-web caddy"
fi
