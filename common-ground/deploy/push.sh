#!/usr/bin/env bash
# Deploys a committed git ref of common-ground to the VM. Run from the dev machine.
#   bash deploy/push.sh [git-ref]        (default HEAD; e.g. pre-final-build, v1.0-hackathon)
# Ships `git archive <ref>:common-ground` (committed code only, no .env, no node_modules) plus the
# working-tree deploy/ scripts, then builds on the VM and switches over.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
. "$here/config.sh"
ref="${1:-HEAD}"
repo="$(git -C "$here" rev-parse --show-toplevel)"
sha="$(git -C "$repo" rev-parse --short=12 "$ref^{commit}")"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

prefix="$(git -C "$here/.." rev-parse --show-prefix)"   # e.g. common-ground/
git -C "$repo" archive --format=tar.gz -o "$tmp/larry-$sha.tgz" "$sha:${prefix%/}"
echo "shipping $ref ($sha), $(du -h "$tmp/larry-$sha.tgz" | cut -f1)"

vm_ssh --command "rm -rf /tmp/larry-deploy && mkdir -p /tmp/larry-deploy"
vm_scp "$tmp/larry-$sha.tgz" "$here"/*.sh "$here"/*.service "$here"/Caddyfile.* "$LARRY_VM:/tmp/larry-deploy/"
vm_ssh --command "sudo install -m 755 /tmp/larry-deploy/*.sh /opt/larry/deploy/ && sudo install -m 644 /tmp/larry-deploy/Caddyfile.* /opt/larry/deploy/ && sudo bash /opt/larry/deploy/release.sh '$sha' '/tmp/larry-deploy/larry-$sha.tgz'"
