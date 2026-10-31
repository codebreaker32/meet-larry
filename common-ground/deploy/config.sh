# Shared settings for the deploy scripts. Sourced, never run.
# Set LARRY_PROJECT, LARRY_REGION and LARRY_ZONE in your shell; the other names have neutral defaults.
# Every gcloud call passes --project explicitly; the global gcloud config is never changed.
LARRY_PROJECT="${LARRY_PROJECT:?set LARRY_PROJECT to your GCP project id}"
LARRY_REGION="${LARRY_REGION:?set LARRY_REGION, e.g. us-central1}"
LARRY_ZONE="${LARRY_ZONE:?set LARRY_ZONE, e.g. us-central1-a}"
LARRY_VM="${LARRY_VM:-app-vm}"
LARRY_IP_NAME="${LARRY_IP_NAME:-app-ip}"
LARRY_SA_NAME="${LARRY_SA_NAME:-app-vm}"
LARRY_SA="${LARRY_SA_NAME}@${LARRY_PROJECT}.iam.gserviceaccount.com"
LARRY_FIREWALL="${LARRY_FIREWALL:-app-allow-web}"
LARRY_TAG="${LARRY_TAG:-app-web}"

LARRY_SSH_FIREWALL="${LARRY_SSH_FIREWALL:-app-allow-ssh-iap}"
# Google's IAP TCP-forwarding range. Port 22 is open to this range only (no public SSH), so every
# ssh/scp goes through `--tunnel-through-iap` (needs iap.googleapis.com and IAP-tunnel rights).
LARRY_IAP_RANGE="35.235.240.0/20"

gc() { gcloud --project "$LARRY_PROJECT" --quiet "$@"; }
vm_ssh() { gc compute ssh "$LARRY_VM" --zone "$LARRY_ZONE" --tunnel-through-iap "$@"; }
vm_scp() { gc compute scp --zone "$LARRY_ZONE" --tunnel-through-iap "$@"; }
larry_ip() { gc compute addresses describe "$LARRY_IP_NAME" --region "$LARRY_REGION" --format='value(address)'; }
larry_host() { if [ -n "${LARRY_HOST:-}" ]; then echo "$LARRY_HOST"; else echo "$(larry_ip | tr . -).sslip.io"; fi; }
