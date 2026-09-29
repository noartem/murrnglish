#!/usr/bin/env bash
# One-shot VPS setup for murrnglish.noartem.ru, mirroring rm-deploy /
# red-murphy: a deploy user owning /srv/murrnglish, and a Caddy site block
# (Cloudflare origin cert, validated before the reload, restored on failure).
# Idempotent. Run from the repo root with an admin account on the VPS:
#
#   ssh weight-secret-bot 'bash -s -- "'"$(cat ~/.ssh/mg_deploy_key.pub)"'"' < scripts/setup-vps.sh
#
# then give CI the private half:  gh secret set DEPLOY_SSH_KEY < ~/.ssh/mg_deploy_key
set -euo pipefail
PUB="${1:?usage: setup-vps.sh '<mg-deploy public key>'}"

# 1. deploy user: home owned by root, .ssh owned by the user (like rm-deploy)
if ! getent passwd mg-deploy >/dev/null; then
  sudo useradd -M -d /home/mg-deploy -s /bin/bash mg-deploy
fi
sudo mkdir -p /home/mg-deploy/.ssh
sudo chown root:root /home/mg-deploy
sudo chmod 755 /home/mg-deploy
echo "$PUB" | sudo tee /home/mg-deploy/.ssh/authorized_keys >/dev/null
sudo chown -R mg-deploy:mg-deploy /home/mg-deploy/.ssh
sudo chmod 700 /home/mg-deploy/.ssh
sudo chmod 600 /home/mg-deploy/.ssh/authorized_keys

# 2. site root owned by the deploy user; http/ exists so the first swap works
sudo mkdir -p /srv/murrnglish/http
sudo chown -R mg-deploy:mg-deploy /srv/murrnglish
sudo chmod 755 /srv/murrnglish /srv/murrnglish/http

# 3. Caddy site block (same as red-murphy), validated before the reload
CF=/etc/caddy/Caddyfile
if ! sudo grep -q '^murrnglish.noartem.ru {' "$CF"; then
  BAK="$CF.bak-$(date -u +%Y%m%d-%H%M%S)"
  sudo cp -p "$CF" "$BAK"
  sudo tee -a "$CF" >/dev/null <<'EOF'
murrnglish.noartem.ru {
	tls /etc/caddy/origin/origin.crt /etc/caddy/origin/origin.key
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		X-Frame-Options "SAMEORIGIN"
		Referrer-Policy "strict-origin-when-cross-origin"
		Permissions-Policy "geolocation=(), microphone=(), camera=()"
		-Server
	}
	root * /srv/murrnglish/http
	try_files {path} /index.html
	file_server
}
EOF
  if ! sudo caddy validate --config "$CF" --adapter caddyfile >/tmp/mg-validate.log 2>&1; then
    sudo cp -p "$BAK" "$CF"
    echo "caddy validate failed, Caddyfile restored from $BAK" >&2
    tail -5 /tmp/mg-validate.log >&2
    exit 1
  fi
  echo "backup: $BAK"
  sudo systemctl reload caddy
  sleep 2
fi
echo "caddy: $(systemctl is-active caddy)"

# 4. every site still answers locally (SNI + Host through loopback)
for h in murrnglish blue-murphy red-murphy weight-secret git; do
  code=$(curl -sk -o /dev/null -w '%{http_code}' --resolve "$h.noartem.ru:443:127.0.0.1" "https://$h.noartem.ru/" || echo ERR)
  echo "$h.noartem.ru -> $code"
done
getent passwd mg-deploy
ls -la /srv/murrnglish
