#!/usr/bin/env bash
# Publish app/dist (every book, one site) to the VPS (Caddy static root).
#
# Env: DEPLOY_KEY  — path to the deploy user's ed25519 private key.
#      DEPLOY_HOST, DEPLOY_ROOT, DEPLOY_URL — override the target below.
# The deploy user owns DEPLOY_ROOT, so no sudo is needed: the swap is two
# renames on one filesystem (http -> .old, .staging -> http).
#
# Serving: Caddy needs `root * <DEPLOY_ROOT>/http` + `file_server` for the
# site; the app is one hash-routed document, so no rewrite rules.
#
# No `systemctl reload caddy` here, deliberately. The Caddyfile points
# `root * <DEPLOY_ROOT>/http` at a fixed path and file_server reads from
# disk per request, so a file swap is live the moment the rename lands —
# nothing needs reloading. Reloading only ever bought two failures:
#   1. 2026-09-29: caddy 2.6.2 panicked inside its own reload
#      ("panic: context: internal error: missing cancel error") and, because
#      the packaged unit ships Restart=no, every site on the box stayed down.
#   2. It threw this site's deploy into the blast radius of a shared process,
#      so a push here could take down weight-secret.noartem.ru.
# The step below is the one that actually matters: asking the public URL for
# the build we just shipped. `systemctl reload` exiting 0 never meant the
# site was serving.
set -euo pipefail

: "${DEPLOY_KEY:?set DEPLOY_KEY to the path of the deploy user's private key}"

HOST="${DEPLOY_HOST:-mg-deploy@84.54.30.169}"
ROOT="${DEPLOY_ROOT:-/srv/murrnglish}"
URL="${DEPLOY_URL:-https://murrnglish.noartem.ru/}"
SSH_OPTS=(-i "$DEPLOY_KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new)

# 1. Stage the new tree on the same filesystem.
ssh "${SSH_OPTS[@]}" "$HOST" "rm -rf $ROOT/.staging && mkdir -p $ROOT/.staging"
rsync -az --delete --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r \
  -e "ssh ${SSH_OPTS[*]}" \
  app/dist/ "$HOST:$ROOT/.staging/"

# 2. Swap it in. .old is kept only across the two renames; if the second one
#    fails the previous tree is still there to put back.
ssh "${SSH_OPTS[@]}" "$HOST" "
  set -e
  cd $ROOT
  rm -rf .old
  mv http .old
  if ! mv .staging http; then
    mv .old http
    echo 'swap failed: rolled back to the previous tree' >&2
    exit 1
  fi
  rm -rf .old
"

# 3. Prove it: the served page must reference the bundle we just built.
#    A unique query plus Cache-Control: no-cache, so neither Cloudflare nor a
#    local cache can hand back the previous index.html and call it a success.
#    (Not curl --no-cache: that needs curl >= 7.76 and exits 2 on the older
#    builds, which would fail the check with an empty body.)
want="$(sed -n 's/.*src="\/\(assets\/index-[^"]*\.js\)".*/\1/p' app/dist/index.html | head -1)"
if [ -z "$want" ]; then
  echo "could not find the built bundle in app/dist/index.html" >&2
  exit 1
fi

for attempt in 1 2 3 4 5; do
  body="$(curl -fsS -H 'Cache-Control: no-cache' -m 20 "$URL?deploy=$RANDOM$attempt" 2>/dev/null || true)"
  if grep -q "$want" <<<"$body"; then
    echo "deployed: $URL (serving $want)"
    exit 0
  fi
  sleep "$((attempt * 3))"
done

echo "deploy verification failed: $URL is not serving $want" >&2
curl -sS -o /dev/null -w 'last response: HTTP %{http_code}\n' -m 20 "$URL" >&2 || true
exit 1
