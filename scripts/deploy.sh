#!/usr/bin/env bash
# Publish app/dist to blue-murphy.noartem.ru (VPS, Caddy static root).
#
# Env: DEPLOY_KEY — path to the bm-deploy ed25519 private key.
# bm-deploy owns /srv/blue-murphy, so sudo is needed only for the Caddy reload
# (sudoers: /usr/bin/systemctl reload caddy). Swap is two renames on the same
# filesystem: stage -> .old, mv in, rm .old.
set -euo pipefail

: "${DEPLOY_KEY:?set DEPLOY_KEY to the path of the bm-deploy private key}"

HOST="bm-deploy@84.54.30.169"
ROOT="/srv/blue-murphy"
SSH_OPTS=(-i "$DEPLOY_KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new)

# 1. Stage the new tree on the same filesystem.
ssh "${SSH_OPTS[@]}" "$HOST" "rm -rf $ROOT/.staging && mkdir -p $ROOT/.staging"
rsync -az --delete --chmod=Du=rwx,go=rx,Fu=rw,go=r \
  -e "ssh ${SSH_OPTS[*]}" \
  app/dist/ "$HOST:$ROOT/.staging/"

# 2. Swap and prune, then reload Caddy.
ssh "${SSH_OPTS[@]}" "$HOST" "
  set -e
  cd $ROOT
  rm -rf .old
  mv http .old
  mv .staging http
  rm -rf .old
  sudo /usr/bin/systemctl reload caddy
"

echo "deployed: https://blue-murphy.noartem.ru/"
