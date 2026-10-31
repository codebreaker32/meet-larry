#!/usr/bin/env bash
# Writes /etc/larry/env on the VM (owner root, mode 600). Run from the dev machine; safe to re-run.
#   bash deploy/write-env.sh [path/to/.env]        (default: ../.env next to common-ground)
# Secrets are copied from the local .env over SSH stdin and are never printed. MEET_SECRET is
# generated on the VM once and kept on every later run (changing it breaks stored blocks).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
. "$here/config.sh"
src="${1:-$here/../../.env}"
[ -f "$src" ] || { echo "no env file at $src"; exit 1; }
grep -qE '^NEXT_PUBLIC_FIREBASE_PROJECT_ID=.+' "$src" || { echo "NEXT_PUBLIC_FIREBASE_* missing from $src"; exit 1; }
# Copied from the local .env when present.
# DEMO_PHONE: the one demo account (D19, server-only). AWS_LOCATION_*: hours, walking time, stop order (D22).
# AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION: the dedicated IAM user for Comprehend PII checks (D22).
copy_keys="QLOO_KEY QLOO_SERVER_URL ANTHROPIC_API_KEY ANTHROPIC_BUDGET_USD UPSTASH_REDIS_REST_URL UPSTASH_REDIS_REST_TOKEN DEMO_PHONE AWS_LOCATION_API_KEY AWS_LOCATION_REGION AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION"

{
  echo "# Larry production env. Written by deploy/write-env.sh; edit there, not here."
  for key in $copy_keys; do
    line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$src" | tail -n 1 | sed -E 's/^[[:space:]]*(export[[:space:]]+)?//')" || true
    [ -n "$line" ] && [ "${line#*=}" != "" ] && echo "$line"
  done
  cat <<FIXED
LARRY_DB=firestore
GOOGLE_CLOUD_PROJECT=$LARRY_PROJECT
PODIUM_MIN_PARTICIPANTS=3
PODIUM_DEFAULT_OPT_IN=false
MATCHDAY_EVENING=false
NUDGE_GAP_LINES=false
ANTHROPIC_SPEND_FILE=/var/lib/larry/anthropic-spend.json
ACCESS_CODES_FILE=/var/lib/larry/access-codes.json
FIXED
  # Public Firebase web config, needed at build time. Taken from the local .env (the repo keeps none).
  grep -E '^NEXT_PUBLIC_FIREBASE_[A-Z_]+=.+' "$src"
} | vm_ssh --command "sudo bash /opt/larry/deploy/install-env.sh"
