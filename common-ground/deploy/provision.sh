#!/usr/bin/env bash
# Creates the production VM and everything around it. Run from the dev machine; safe to re-run.
#   bash deploy/provision.sh
# Makes: a service account with a custom "Larry auth user delete" role (firebaseauth.users.delete/get
# only; verifyIdToken needs no IAM) + Cloud Datastore User (+ logging/metrics), a static IP, firewall
# rules for 80/443 (everyone) and 22 (IAP range only) on the web tag, removes the open default
# SSH/RDP/ICMP rules, and an e2-medium Ubuntu 24.04 VM in $LARRY_REGION. Then copies deploy/ to the VM
# and runs vm-setup.sh there. seed-guests and other user-creating scripts run from the dev machine
# with the developer's own credentials, never as the VM.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
. "$here/config.sh"

echo "== service account"
if ! gc iam service-accounts describe "$LARRY_SA" >/dev/null 2>&1; then
  gc iam service-accounts create "$LARRY_SA_NAME" --display-name "Larry VM (web)"
fi
auth_role="projects/$LARRY_PROJECT/roles/larryAuthUserDelete"
if ! gc iam roles describe larryAuthUserDelete --project "$LARRY_PROJECT" >/dev/null 2>&1; then
  gc iam roles create larryAuthUserDelete --project "$LARRY_PROJECT" --title "Larry auth user delete" \
    --description "Account deletion only: delete (and read) one Firebase Auth user" \
    --permissions firebaseauth.users.delete,firebaseauth.users.get --stage GA --format=none
fi
for role in "$auth_role" roles/datastore.user roles/logging.logWriter roles/monitoring.metricWriter; do
  # A new service account takes a few seconds to become visible to IAM.
  for attempt in 1 2 3 4 5 6; do
    if gc projects add-iam-policy-binding "$LARRY_PROJECT" --member "serviceAccount:$LARRY_SA" --role "$role" \
      --condition=None --format=none 2>/dev/null; then break; fi
    [ "$attempt" = 6 ] && { echo "could not grant $role"; exit 1; }
    sleep 10
  done
  echo "granted $role"
done
# Firebase Auth Admin could list every user's phone number; the custom role above replaces it.
gc projects remove-iam-policy-binding "$LARRY_PROJECT" --member "serviceAccount:$LARRY_SA" \
  --role roles/firebaseauth.admin --condition=None --format=none >/dev/null 2>&1 || true
# Nothing runs as the default compute account; its project-wide Editor grant is pure risk.
default_sa="$(gc projects describe "$LARRY_PROJECT" --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
gc projects remove-iam-policy-binding "$LARRY_PROJECT" --member "serviceAccount:$default_sa" \
  --role roles/editor --condition=None --format=none >/dev/null 2>&1 || true

echo "== static IP"
if ! gc compute addresses describe "$LARRY_IP_NAME" --region "$LARRY_REGION" >/dev/null 2>&1; then
  gc compute addresses create "$LARRY_IP_NAME" --region "$LARRY_REGION"
fi
ip="$(larry_ip)"
echo "IP $ip  host $(larry_host)"

echo "== firewall (80/443 to the web tag; Caddy keeps the site behind the preview gate)"
if ! gc compute firewall-rules describe "$LARRY_FIREWALL" >/dev/null 2>&1; then
  gc compute firewall-rules create "$LARRY_FIREWALL" --network default --direction INGRESS \
    --allow tcp:80,tcp:443 --target-tags "$LARRY_TAG" --source-ranges 0.0.0.0/0
fi
echo "== firewall (22 from the IAP range only; deploy scripts use --tunnel-through-iap)"
gc services enable iap.googleapis.com
if ! gc compute firewall-rules describe "$LARRY_SSH_FIREWALL" >/dev/null 2>&1; then
  gc compute firewall-rules create "$LARRY_SSH_FIREWALL" --network default --direction INGRESS \
    --allow tcp:22 --target-tags "$LARRY_TAG" --source-ranges "$LARRY_IAP_RANGE" \
    --description "SSH only through IAP TCP forwarding"
fi
# The auto-created default rules open 22, 3389 and ICMP to the whole internet on every instance.
for rule in default-allow-ssh default-allow-rdp default-allow-icmp; do
  if gc compute firewall-rules describe "$rule" >/dev/null 2>&1; then
    gc compute firewall-rules delete "$rule"
  fi
done

echo "== VM"
if ! gc compute instances describe "$LARRY_VM" --zone "$LARRY_ZONE" >/dev/null 2>&1; then
  gc compute instances create "$LARRY_VM" --zone "$LARRY_ZONE" \
    --machine-type e2-medium \
    --image-family ubuntu-2404-lts-amd64 --image-project ubuntu-os-cloud \
    --boot-disk-size 30GB --boot-disk-type pd-balanced \
    --address "$ip" --tags "$LARRY_TAG" \
    --service-account "$LARRY_SA" --scopes cloud-platform \
    --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring
  echo "waiting for SSH"
  for _ in $(seq 1 30); do
    if vm_ssh --command true >/dev/null 2>&1; then break; fi
    sleep 10
  done
fi

echo "== VM setup"
vm_ssh --command "rm -rf /tmp/larry-deploy && mkdir -p /tmp/larry-deploy"
vm_scp "$here"/*.sh "$here"/*.service "$here"/Caddyfile.* "$LARRY_VM:/tmp/larry-deploy/"
vm_ssh --command "sudo bash /tmp/larry-deploy/vm-setup.sh '$(larry_host)'"
echo "done. Next: bash deploy/write-env.sh && bash deploy/push.sh <git-ref>"
