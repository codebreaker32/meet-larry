#!/usr/bin/env bash
# Builds one release. Runs ON the VM as the larry user (release.sh calls it), with the public
# NEXT_PUBLIC_* lines of /etc/larry/env on stdin:
#   grep -E '^NEXT_PUBLIC_' /etc/larry/env | sudo -u larry -H bash /opt/larry/deploy/build.sh <dir>
# /etc/larry/env is root-only (the app user must not be able to read it outside systemd or rewrite
# its own secrets), so root filters it and hands over only the public lines.
# Secrets stay out of the build: `npm ci` (which runs dependency install scripts) sees no env file
# at all, and `next build` gets only the public NEXT_PUBLIC_* lines, because those are inlined at
# BUILD time and systemd's EnvironmentFile only applies at run time. Every server secret reaches
# the app at run time through EnvironmentFile=/etc/larry/env.
set -euo pipefail
cd "${1:?usage: build.sh <release dir> (public env on stdin)}"
public_env="$(grep -E '^NEXT_PUBLIC_[A-Z0-9_]+=' || true)"
exec </dev/null
export NEXT_TELEMETRY_DISABLED=1
# Dev dependencies (TypeScript, Tailwind) are needed to build.
npm ci --include=dev --no-audit --no-fund --loglevel=error
set -a
# shellcheck disable=SC1090
. <(printf '%s\n' "$public_env")
set +a
NODE_OPTIONS=--max-old-space-size=3072 npm run build
