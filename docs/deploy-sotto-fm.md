# Deploying sotto.fm — Hetzner VPS + Early Access Gate

A checklist for deploying sotto.fm on a Hetzner VPS with password-protected early access.

## Prerequisites

- [x] Domain `sotto.fm` purchased on Namecheap
- [x] Password gate code merged to `main` (middleware.ts, /access page, /api/access route)
- [ ] Hetzner Cloud account (https://console.hetzner.cloud)
- [ ] SSH key pair on your local machine (`~/.ssh/id_ed25519`)

## Step 1: Create Hetzner VPS

1. Go to Hetzner Cloud Console → New Project → "Sotto"
2. Create Server:
   - **Location**: Ashburn, VA (ash) — closest to US East users
   - **Image**: Ubuntu 24.04
   - **Type**: CPX31 (4 vCPU AMD, 8GB RAM, 160GB SSD) — ~€11.49/mo
   - **SSH Key**: Add your public key (`cat ~/.ssh/id_ed25519.pub`)
   - **Name**: `sotto-prod`
3. Note the server IP: `___________` (fill in)

## Step 2: Point DNS (Namecheap)

1. Go to Namecheap → Domain List → sotto.fm → **Advanced DNS**
2. Delete ALL existing records (parking page, etc.)
3. Add these records:

| Type | Host | Value | TTL |
|------|------|-------|-----|
| A | @ | `SERVER_IP` | Automatic |
| CNAME | www | `sotto.fm.` | Automatic |

4. DNS propagation takes 5-30 minutes. Check with:
```bash
dig sotto.fm +short
# Should return your server IP
```

## Step 3: Server Setup

SSH in as root and run the setup script:

```bash
ssh root@SERVER_IP "bash -s" < scripts/setup-server.sh
```

This installs Docker, Caddy, configures UFW firewall (SSH + 80 + 443), creates a `sotto` user, and hardens SSH (disables password auth + root login).

**IMPORTANT**: After this runs, root SSH is disabled. From now on:
```bash
ssh sotto@SERVER_IP
```

## Step 4: Clone & Configure

SSH in as the `sotto` user:

```bash
ssh sotto@SERVER_IP
```

Clone the repo:
```bash
git clone https://github.com/affromero/Sotto.git ~/sotto
cd ~/sotto
```

Create the environment file:
```bash
cp .env.example .env
nano .env
```

**Minimum .env for landing page + password gate:**
```env
# === REQUIRED ===
POSTGRES_USER=sotto
POSTGRES_PASSWORD=<generate: openssl rand -base64 24>
POSTGRES_DB=sotto
NEXTAUTH_SECRET=<generate: openssl rand -base64 32>
NEXTAUTH_URL=https://sotto.fm
NEXT_PUBLIC_APP_URL=https://sotto.fm

# === PASSWORD GATE ===
SITE_PASSWORD=<your-chosen-password>

# === OPTIONAL (not needed for landing page only) ===
# ANTHROPIC_API_KEY=sk-ant-...
# ELEVENLABS_API_KEY=...
# STRIPE_SECRET_KEY=sk_live_...
```

Generate secrets inline:
```bash
echo "POSTGRES_PASSWORD=$(openssl rand -base64 24)"
echo "NEXTAUTH_SECRET=$(openssl rand -base64 32)"
```

## Step 5: Build & Deploy

```bash
cd ~/sotto

# Build and start all containers (postgres, redis, web, workers)
docker compose -f docker-compose.prod.yml up -d --build

# Wait for postgres to be healthy, then push schema
docker compose -f docker-compose.prod.yml run --rm web npx prisma db push
```

Verify the app is running:
```bash
curl -s http://localhost:3000/api/health
# Should return {"status":"ok",...}
```

## Step 6: Configure Caddy (HTTPS)

```bash
sudo cp ~/sotto/Caddyfile /etc/caddy/Caddyfile
sudo mkdir -p /var/log/caddy
sudo systemctl reload caddy
```

Caddy automatically provisions Let's Encrypt SSL certificates for sotto.fm. This only works after DNS is pointing to this server.

Check Caddy status:
```bash
sudo systemctl status caddy
sudo journalctl -u caddy --no-pager -n 20
```

## Step 7: Verify Everything

Run these from your local machine:

```bash
# Should redirect to /access (307)
curl -I https://sotto.fm

# Health check bypasses password gate
curl https://sotto.fm/api/health

# Test password (should set cookie and return 200)
curl -X POST https://sotto.fm/api/access \
  -H "Content-Type: application/json" \
  -d '{"password":"YOUR_PASSWORD"}'
```

Then in browser:
1. Visit `sotto.fm` → should show password page
2. Enter wrong password → error message
3. Enter correct password → redirected to landing page
4. Refresh → stays on landing page (cookie persists 30 days)
5. Incognito → redirected to /access again

## Step 8: Enable CI/CD (Optional)

In GitHub → repo Settings → Secrets and variables → Actions, add:

| Secret | Value |
|--------|-------|
| `SERVER_IP` | Your Hetzner server IP |
| `SSH_KEY` | Contents of `~/.ssh/id_ed25519` (private key for `sotto` user) |

The existing `.github/workflows/deploy.yml` will auto-deploy on every push to `main`:
- Runs CI checks (lint, typecheck, test, build)
- SSHs into server, pulls code, rebuilds containers, runs migrations

## Step 9: Share with Friends

Send them:
- **URL**: sotto.fm
- **Password**: (whatever you set as SITE_PASSWORD)

They enter it once, cookie lasts 30 days.

---

## Quick Reference

| Command | What it does |
|---------|-------------|
| `ssh sotto@SERVER_IP` | Connect to server |
| `cd ~/sotto && docker compose -f docker-compose.prod.yml logs -f web` | Tail web logs |
| `cd ~/sotto && docker compose -f docker-compose.prod.yml logs -f workers` | Tail worker logs |
| `cd ~/sotto && docker compose -f docker-compose.prod.yml restart web` | Restart web |
| `cd ~/sotto && docker compose -f docker-compose.prod.yml down && docker compose -f docker-compose.prod.yml up -d` | Full restart |
| `cd ~/sotto && git pull && docker compose -f docker-compose.prod.yml up -d --build` | Manual deploy |
| `sudo journalctl -u caddy --no-pager -n 50` | Caddy logs |
| `sudo systemctl reload caddy` | Reload Caddy config |

## Troubleshooting

**Caddy won't get SSL cert**: DNS isn't pointing to this server yet, or port 80/443 is blocked. Check `sudo ufw status` and `dig sotto.fm`.

**Container won't start**: Check logs with `docker compose -f docker-compose.prod.yml logs web`. Common issue: missing env vars.

**Password gate not working**: Make sure `SITE_PASSWORD` is set in `.env` and the web container was restarted after changing it.

**Can't SSH after setup**: The setup script disables root login. Use `ssh sotto@SERVER_IP`. If locked out, use Hetzner's VNC console to fix.
