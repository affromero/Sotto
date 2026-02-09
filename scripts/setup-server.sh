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

echo "[1/7] Updating system..."
apt update && apt upgrade -y

echo "[2/7] Creating sotto user..."
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

echo "[3/7] Installing Docker..."
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
  usermod -aG docker sotto
  echo "  Docker installed"
else
  echo "  Docker already installed, skipping"
fi

echo "[4/7] Installing Caddy..."
if ! command -v caddy &>/dev/null; then
  apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt update && apt install -y caddy
  echo "  Caddy installed"
else
  echo "  Caddy already installed, skipping"
fi

echo "[5/7] Installing utilities..."
apt install -y git curl unzip htop

echo "[6/7] Configuring firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
echo "  Firewall enabled (SSH, HTTP, HTTPS)"

echo "[7/7] Hardening SSH..."
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
echo "  1. Log in as sotto:  ssh sotto@$(hostname -I | awk '{print $1}')"
echo "  2. Clone the repo:   git clone <repo-url> ~/sotto"
echo "  3. Create .env:      cp ~/sotto/.env.example ~/sotto/.env && nano ~/sotto/.env"
echo "  4. Deploy:           cd ~/sotto && docker compose -f docker-compose.prod.yml up -d --build"
echo "  5. Push schema:      docker compose -f docker-compose.prod.yml run --rm web npx prisma db push"
echo "  6. Set up Caddy:     sudo cp ~/sotto/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy"
echo "  7. Set up backups:   (crontab -l 2>/dev/null; echo \"0 3 * * * ~/sotto/scripts/backup.sh\") | crontab -"
echo ""
