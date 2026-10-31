# Deploying Larry

One Google Cloud VM runs the web app. Caddy sits in front and handles HTTPS.

## Layout

| What | How |
|---|---|
| Settings | `deploy/config.sh`. Set `LARRY_PROJECT`, `LARRY_REGION` and `LARRY_ZONE` in your shell; every gcloud call passes `--project`, and the global gcloud config is never changed. |
| VM | e2-medium, Ubuntu 24.04, Node 22, swap for `next build`. Shielded VM. |
| Service account | A dedicated account with least-privilege roles: a custom role that can only delete (and read) one Firebase Auth user, Cloud Datastore User, log and metric writer. No key file: firebase-admin gets credentials from the metadata server. |
| Network | Only 80 and 443 are open to the internet. SSH goes through IAP TCP forwarding only (`--tunnel-through-iap`); root login and passwords are off. The app listens on 127.0.0.1 only, and Caddy's admin API is off. |
| Firestore | Native mode. `../firestore.rules` denies every client read and write; data goes through server routes. |
| Services | `larry-web` (`next start` on 127.0.0.1:3000), `larry-bot` (`npm run bot`) and `caddy`, all `Restart=always`, with systemd sandboxing (`ProtectSystem=strict`, one writable state folder). |
| Env | A root-only env file read by systemd before it drops privileges. The build gets only the public `NEXT_PUBLIC_*` lines. |
| Releases | One folder per git sha, a `current` symlink, the three newest kept. Releases are root-owned, so the app cannot rewrite its code. |

## Commands (run from `common-ground/`)

```bash
bash deploy/provision.sh          # create or repair the VM, IP, firewall and service account, then run vm-setup.sh (idempotent)
bash deploy/write-env.sh          # copy the secrets from ../.env to the VM over SSH stdin (never printed)
bash deploy/push.sh <git-ref>     # ship a committed ref (git archive), build on the VM, switch over, restart
bash deploy/go-public.sh          # serve publicly
npx -y tsx scripts/firebase-setup.ts --dry-run               # check the Firebase config, change nothing
npx -y tsx scripts/firebase-setup.ts --domain <host> --quiet # authorize your domain for phone sign-in
```

How `push.sh` works:
- It ships the code at the git ref, plus the working-tree `deploy/` scripts.
- `npm ci` runs with no secrets in its environment. Only `NEXT_PUBLIC_*` values are exported for `npm run build`, because they are inlined at build time. Server secrets reach the app at run time through systemd's `EnvironmentFile`.
- The old release keeps serving until the new build succeeds.

An optional private-preview mode (`caddy-config.sh preview`) puts the whole site behind a one-time login that sets a cookie; it needs `PREVIEW_USER` and `PREVIEW_SECRET_DIR`.

## Firebase (applied by `scripts/firebase-setup.ts`)

- Phone sign-in sends SMS only to the configured region, so an open sign-up page cannot be used for SMS pumping.
- One optional test number for a demo account, read from `DEMO_PHONE` and `DEMO_CODE` in `.env` (never in the repo).
- Authorized domains: `localhost`, the Firebase hosts and your deploy host.
- Firestore rules come from `firestore.rules` (deny all client access).
- No Analytics SDK. Restrict the browser API key to your own hosts with HTTP-referrer restrictions.
