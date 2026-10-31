#!/usr/bin/env bash
# Runs ON the VM as root (push.sh calls it). Unpacks a release, builds it, switches to it.
#   sudo bash /opt/larry/deploy/release.sh <sha> <tarball>
# The live release keeps serving until the new build has succeeded. The release is built as larry,
# then handed to root:root so the running app cannot rewrite its own code. Next's run-time caches
# (.next/cache for images and fetches, .next/server/route-cache for prerendered routes) are symlinked
# to /var/lib/larry/next/<sha>, the one writable path in the hardened units.
set -euo pipefail
sha="${1:?usage: release.sh <sha> <tarball>}"
tarball="${2:?usage: release.sh <sha> <tarball>}"
[ -f /etc/larry/env ] || { echo "no /etc/larry/env yet: run deploy/write-env.sh first"; exit 1; }
dir="/opt/larry/releases/$sha"

rm -rf "$dir"
install -d -o larry -g larry "$dir"
tar -xzf "$tarball" -C "$dir"
# Access codes live outside the release, so they survive deploys.
ln -sfn /var/lib/larry/data "$dir/.data"
chown -R larry:larry "$dir"
rm -f "$tarball"

{ grep -E '^NEXT_PUBLIC_[A-Z0-9_]+=' /etc/larry/env || true; } | sudo -u larry -H bash /opt/larry/deploy/build.sh "$dir"

state="/var/lib/larry/next/$sha"
rm -rf "$state"
install -d -o larry -g larry -m 750 /var/lib/larry/next "$state" "$state/cache" "$state/route-cache"
rm -rf "$dir/.next/cache"   # build-time (Turbopack) cache, not needed to serve
if [ -d "$dir/.next/server/route-cache" ]; then
  cp -a "$dir/.next/server/route-cache/." "$state/route-cache/"
  rm -rf "$dir/.next/server/route-cache"
fi
ln -s "$state/cache" "$dir/.next/cache"
ln -s "$state/route-cache" "$dir/.next/server/route-cache"
chown -R larry:larry "$state"
chown -R root:root "$dir"
chmod -R go-w "$dir"

ln -sfn "$dir" /opt/larry/current.new
mv -Tf /opt/larry/current.new /opt/larry/current
echo "$sha" > /opt/larry/RELEASE
systemctl restart larry-web

# Keep the three newest releases.
for old in $(ls -1dt /opt/larry/releases/*/ | tail -n +4); do
  rm -rf "$old" "/var/lib/larry/next/$(basename "$old")"
done

for _ in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/ || true)"
  [ "$code" = 200 ] && break
  sleep 2
done
echo "release $sha live; local check: HTTP $code"
