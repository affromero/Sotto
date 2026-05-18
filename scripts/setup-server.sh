#!/bin/bash
# Sotto — Server Setup Script
#
# Run as root on a fresh Ubuntu 24.04 VPS:
#   curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/sotto/main/scripts/setup-server.sh | bash
#
# Or after cloning:
#   sudo bash scripts/setup-server.sh

set -euo pipefail

echo "=== Sotto Server Setup ==="
echo ""

# Must run as root
if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: Run this script as root (sudo bash scripts/setup-server.sh)"
  exit 1
fi

echo "[1/6] Updating system..."
apt update && apt upgrade -y

echo "[2/6] Creating sotto user..."
if ! id -u sotto &>/dev/null; then
  adduser --disabled-password --gecos "Sotto" sotto
  usermod -aG sudo sotto
  # Allow sudo without password for sotto
  echo "sotto ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/sotto

  # Copy SSH keys from root
  mkdir -p /home/sotto/.ssh
  if [ -f /root/.ssh/authorized_keys ]; then
    cp /root/.ssh/authorized_keys /home/sotto/.ssh/
  fi
  chown -R sotto:sotto /home/sotto/.ssh
  chmod 700 /home/sotto/.ssh
  chmod 600 /home/sotto/.ssh/authorized_keys 2>/dev/null || true
  echo "  Created user 'sotto' with SSH keys"
else
  echo "  User 'sotto' already exists, skipping"
fi

echo "[3/6] Installing Docker..."
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
  usermod -aG docker sotto
  echo "  Docker installed"
else
  echo "  Docker already installed, skipping"
fi

echo "[4/6] Installing Caddy..."
if ! command -v caddy &>/dev/null; then
  apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt update && apt install -y caddy
  echo "  Caddy installed"
else
  echo "  Caddy already installed, skipping"
fi

echo "[5/6] Installing utilities..."
apt install -y git curl unzip htop

echo "[6/6] Configuring firewall and SSH..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
echo "  Firewall enabled (SSH, HTTP, HTTPS)"

# Disable password authentication
if grep -q "^PasswordAuthentication" /etc/ssh/sshd_config; then
  sed -i 's/^PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
else
  echo "PasswordAuthentication no" >> /etc/ssh/sshd_config
fi
# Disable root login
if grep -q "^PermitRootLogin" /etc/ssh/sshd_config; then
  sed -i 's/^PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
else
  echo "PermitRootLogin no" >> /etc/ssh/sshd_config
fi
systemctl reload ssh
echo "  SSH hardened (password auth disabled, root login disabled)"

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Log in as sotto:    ssh sotto@$(hostname -I | awk '{print $1}')"
echo "  2. Clone the repo:     git clone <repo-url> ~/sotto"
echo "  3. Create prod env:    cd ~/sotto && cp .env.example .env.production"
echo "  4. Fill required env:  NEXT_PUBLIC_APP_URL, NEXTAUTH_URL, AUTH_SECRET, database, Redis, storage, AI, and TTS keys"
echo "  5. Optional hosts:     set SOTTO_MAPS_DOMAIN and SOTTO_WWW_DOMAIN in .env.production if you want those Caddy blocks"
echo "  6. Enable Caddy import: ensure /etc/caddy/Caddyfile imports /etc/caddy/conf.d/*"
echo "  7. Deploy:            cd ~/sotto && SOTTO_ENV_FILE=~/sotto/.env.production bash scripts/deploy.sh"
echo "  8. Set up backups:    (crontab -l 2>/dev/null; echo \"0 3 * * * ~/sotto/scripts/backup.sh\") | crontab -"
echo ""
