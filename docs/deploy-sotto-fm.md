# Deploying sotto.fm — Hetzner VPS + Early Access Gate

A detailed, step-by-step guide for deploying sotto.fm on a Hetzner VPS with password-protected early access. Every click, every command, every thing you need to check.

## Prerequisites

Before starting, make sure you have these ready:

### 1. Domain `sotto.fm` on Namecheap

- [x] Already purchased at [namecheap.com](https://www.namecheap.com/)
- You should be able to log in and see `sotto.fm` in your Domain List

### 2. Password gate code merged

- [x] `src/middleware.ts` — redirects unauthenticated visitors to `/access`
- [x] `src/app/access/page.tsx` — password entry UI
- [x] `src/app/api/access/route.ts` — validates password, sets `sotto_access` cookie (30-day TTL)
- Bypassed routes: `/access`, `/api/access`, `/api/health`

### 3. SSH key pair on your local machine

If you don't have one yet:

```bash
# Check if you already have one
ls -la ~/.ssh/id_ed25519

# If not, generate one (press Enter for all prompts)
ssh-keygen -t ed25519 -C "your@email.com"

# View your public key (you'll paste this into Hetzner)
cat ~/.ssh/id_ed25519.pub
```

Expected output format: `ssh-ed25519 AAAA...long-string... your@email.com`

### 4. Hetzner Cloud account

- Sign up at [console.hetzner.cloud](https://console.hetzner.cloud)
- Add a payment method (credit card or PayPal)
- Verify your email

### 5. GitHub repo access

- The repo is at `github.com/affromero/Sotto`
- The server will need to clone it (public repo, or set up a deploy key)

---

## Step 1: Create Hetzner VPS

### 1.1 Create a project

1. Go to [console.hetzner.cloud](https://console.hetzner.cloud)
2. Click **"+ New Project"** in the top right
3. Name it: **Sotto**
4. Click **"Create"**
5. You'll be taken into the empty project dashboard

### 1.2 Add your SSH key to Hetzner

1. In the left sidebar, click **Security** (under your project)
2. Click the **SSH Keys** tab
3. Click **Add SSH Key**
4. Paste your public key (the output of `cat ~/.ssh/id_ed25519.pub`)
5. Name it something recognizable (e.g., `macbook-pro` or `dev-machine`)
6. Click **Add SSH Key**

### 1.3 Create the server

1. In the left sidebar, click **Servers**
2. Click **Add Server** (big orange button)
3. Fill in each section:

**Location:**

- Select **Ashburn** (ash) — US East, closest to most US users
- If targeting EU users, choose Falkenstein (fsn1) or Helsinki (hel1)

**Image:**

- Click the **OS Images** tab
- Select **Ubuntu** → **24.04**

**Type:**

- Click **Shared vCPU** tab (cheaper, fine for our workload)
- Select **x86 (Intel/AMD)** architecture
- Select **CPX31**: 4 vCPU AMD, 8 GB RAM, 160 GB SSD NVMe
- Cost: ~€11.49/month (~$12.50/month)
- Why CPX31: Docker builds need RAM. The 4GB tier will OOM during `npm run build`. 8GB gives headroom for Postgres + Redis + Web + Workers running simultaneously

**Networking:**

- Leave **Public IPv4** checked (you need this)
- **IPv6** is fine to leave checked (free)
- Skip **Private Networks** (not needed for a single server)

**SSH Keys:**

- Check the box next to the SSH key you added in step 1.2

**Volumes:**

- Skip (the 160GB SSD is enough)

**Firewalls:**

- Skip (we'll use UFW on the server itself)

**Backups:**

- Optional but recommended: Enable **Backups** (+20% cost, ~€2.30/mo)
- This gives you automatic daily snapshots you can restore from

**Placement Groups:**

- Skip

**Labels:**

- Skip

**Cloud Config:**

- Skip (we'll configure manually)

**Name:**

- Enter: `sotto-prod`

4. Click **Create & Buy now**
5. Wait 30-60 seconds for the server to provision
6. **Copy the IP address** shown on the server page — you'll need this everywhere

```
Server IP: `46.225.110.252`  (write this down!)
```

### 1.4 Test SSH connection

From your local machine:

```bash
ssh root@SERVER_IP
# Type "yes" when asked about fingerprint
# You should see a root@sotto-prod prompt
exit
```

If this doesn't work, double-check that the SSH key you added to Hetzner matches `~/.ssh/id_ed25519.pub` on your local machine.

---

## Step 2: Point DNS (Namecheap)

### 2.1 Log into Namecheap

1. Go to [namecheap.com](https://www.namecheap.com) and log in
2. Click **Domain List** in the left sidebar
3. Find **sotto.fm** and click **Manage** on the right

### 2.2 Go to Advanced DNS

1. Click the **Advanced DNS** tab at the top
2. You'll see a list of existing DNS records (probably Namecheap parking page records)

### 2.3 Delete existing records

1. Delete **every** existing record by clicking the trash icon on each one
2. The parking page A record, the CNAME for `www`, the URL redirect — delete them all
3. You should have a completely empty record list

### 2.4 Add the A record (root domain)

1. Click **Add New Record**
2. Set:
   - **Type**: `A Record`
   - **Host**: `@` (this means the root domain `sotto.fm`)
   - **Value**: `SERVER_IP` (the IP from Step 1)
   - **TTL**: `Automatic`
3. Click the green checkmark to save

### 2.5 Add the CNAME record (www subdomain)

1. Click **Add New Record** again
2. Set:
   - **Type**: `CNAME Record`
   - **Host**: `www`
   - **Value**: `sotto.fm.` (with trailing dot — this is important!)
   - **TTL**: `Automatic`
3. Click the green checkmark to save

### 2.6 Final DNS record table

| Type         | Host | Value       | TTL       |
| ------------ | ---- | ----------- | --------- |
| A Record     | @    | `SERVER_IP` | Automatic |
| CNAME Record | www  | `sotto.fm.` | Automatic |

### 2.7 Wait for DNS propagation

DNS changes take 5-30 minutes to propagate. Check from your local machine:

```bash
# Check A record
dig sotto.fm +short
# Should return your SERVER_IP (e.g., 5.161.xxx.xxx)

# Check www CNAME
dig www.sotto.fm +short
# Should return "sotto.fm." followed by your SERVER_IP

# Alternative check using nslookup
nslookup sotto.fm
```

If `dig` returns nothing or the old IP, wait a few more minutes and try again.

**Still not propagating after 30 minutes?** Try flushing your local DNS cache:

```bash
# macOS
sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder

# Linux
sudo systemd-resolve --flush-caches
```

---

## Step 3: Server Setup

This step installs Docker, Caddy, configures the firewall, creates a `sotto` user, and hardens SSH. After this step, root login is permanently disabled.

### 3.1 What the setup script does

The script `scripts/setup-server.sh` performs 7 actions:

1. **Updates Ubuntu** packages to latest
2. **Creates `sotto` user** with sudo access and copies root's SSH keys
3. **Installs Docker** via the official install script and adds `sotto` to the docker group
4. **Installs Caddy** (reverse proxy with automatic HTTPS via Let's Encrypt)
5. **Installs utilities** (git, curl, unzip, htop)
6. **Configures UFW firewall** — allows SSH (22), HTTP (80), HTTPS (443), blocks everything else
7. **Hardens SSH** — disables password authentication and root login

### 3.2 Run the setup script

From your **local machine** (not SSH'd into the server):

```bash
# Navigate to the Sotto project
cd ~/Code/Sotto

# Run the script on the remote server via SSH
ssh root@SERVER_IP "bash -s" < scripts/setup-server.sh
```

This pipes the local script into a remote bash session. You'll see output like:

```
=== Sotto Server Setup ===
[1/7] Updating system...
[2/7] Creating sotto user...
  Created user 'sotto' with SSH keys
[3/7] Installing Docker...
  Docker installed
[4/7] Installing Caddy...
  Caddy installed
[5/7] Installing utilities...
[6/7] Configuring firewall...
  Firewall enabled (SSH, HTTP, HTTPS)
[7/7] Hardening SSH...
  SSH hardened (password auth disabled, root login disabled)
=== Setup Complete ===
```

### 3.3 Verify the setup

**Root login should now be blocked:**

```bash
ssh root@SERVER_IP
# Should say: Permission denied (publickey)
```

**Log in as the sotto user instead:**

```bash
ssh sotto@SERVER_IP
# Should work and show a sotto@sotto-prod prompt
```

**Verify Docker is installed:**

```bash
ssh sotto@SERVER_IP "docker --version"
# Docker version 27.x.x, build xxxxxxx
```

**Verify Caddy is installed and running:**

```bash
ssh sotto@SERVER_IP "caddy version"
# v2.x.x
ssh sotto@SERVER_IP "sudo systemctl status caddy --no-pager"
# Should show "active (running)"
```

**Verify firewall rules:**

```bash
ssh sotto@SERVER_IP "sudo ufw status"
# Status: active
# To                         Action      From
# --                         ------      ----
# OpenSSH                    ALLOW       Anywhere
# 80/tcp                     ALLOW       Anywhere
# 443/tcp                    ALLOW       Anywhere
```

---

## Step 4: Clone & Configure

### 4.1 SSH into the server

```bash
ssh sotto@SERVER_IP
```

### 4.2 Clone the repository

```bash
git clone https://github.com/affromero/Sotto.git ~/sotto
cd ~/sotto
```

Verify the clone worked:

```bash
ls ~/sotto
# Should show: Caddyfile  docker-compose.prod.yml  Dockerfile  package.json  src/  ...
```

### 4.3 Create the environment file

```bash
cp .env.example .env
```

### 4.4 Generate secrets

Before editing `.env`, generate the secrets you'll need:

```bash
# Generate a strong Postgres password
echo "POSTGRES_PASSWORD=$(openssl rand -base64 24)"
# Example output: POSTGRES_PASSWORD=a7Kd9F2xWp3mYbN1vR8sJhL6qT0cEiGo

# Generate a NextAuth secret
echo "NEXTAUTH_SECRET=$(openssl rand -base64 32)"
# Example output: NEXTAUTH_SECRET=xR4p2Km8Wd6nYq1sVbL9jHf3cTgA0eIo7uZmPwSyBnQ=
```

**Copy these values** — you'll paste them into `.env` in the next step.

### 4.5 Edit the environment file

```bash
nano .env
```

**Minimum configuration for landing page + password gate:**

Find and set these variables (some already exist from `.env.example`, others need uncommenting):

```env
# === DATABASE (auto-configured by docker-compose, but needed for Prisma) ===
POSTGRES_USER=sotto
POSTGRES_PASSWORD=<paste the generated password from 4.4>
POSTGRES_DB=sotto

# === AUTH ===
NEXTAUTH_SECRET=<paste the generated secret from 4.4>
NEXTAUTH_URL=https://sotto.fm

# === APP URL ===
NEXT_PUBLIC_APP_URL=https://sotto.fm

# === PASSWORD GATE ===
SITE_PASSWORD=<choose a password to share with friends>
```

**Nano editor basics:**

- Arrow keys to move around
- Type to edit
- `Ctrl+O` then `Enter` to save
- `Ctrl+X` to exit
- `Ctrl+W` to search for text

**Note:** `DATABASE_URL` and `REDIS_URL` are set automatically by `docker-compose.prod.yml` as environment variables, so you don't need them in `.env`. The compose file constructs them from `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB`.

### 4.6 Verify your .env

Double-check the critical values are set:

```bash
# These should all print non-empty values
grep "^POSTGRES_PASSWORD=" .env
grep "^NEXTAUTH_SECRET=" .env
grep "^NEXTAUTH_URL=" .env
grep "^SITE_PASSWORD=" .env
```

### 4.7 Optional: Add AI/TTS keys for full functionality

If you want podcast generation to work (not just the landing page), also set:

```env
# AI - get from https://console.anthropic.com/
ANTHROPIC_API_KEY=sk-ant-api03-...

# TTS - get from https://elevenlabs.io/
ELEVENLABS_API_KEY=...

# Storage - get from Cloudflare R2 dashboard
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=sotto-storage
R2_PUBLIC_URL=https://pub-xxxxx.r2.dev

# Payments - get from https://dashboard.stripe.com/
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

---

## Step 5: Build & Deploy

### 5.1 Understand the container architecture

`docker-compose.prod.yml` defines 4 services:

| Service    | Image                           | Purpose                                        | Port             |
| ---------- | ------------------------------- | ---------------------------------------------- | ---------------- |
| `postgres` | `postgres:16-alpine`            | PostgreSQL database                            | Internal only    |
| `redis`    | `redis:7-alpine`                | Queue broker + cache (512MB max, LRU eviction) | Internal only    |
| `web`      | Built from `Dockerfile`         | Next.js app (standalone mode)                  | `127.0.0.1:3000` |
| `workers`  | Built from `Dockerfile.workers` | BullMQ workers (11 types) + FFmpeg             | Internal only    |

The web container only binds to `127.0.0.1:3000` (localhost), not `0.0.0.0:3000`. This means it's not directly accessible from the internet — Caddy handles external traffic and proxies to it.

### 5.2 Build and start all containers

> **Important:** The build takes 3-5 minutes and runs in the foreground. If your SSH connection drops mid-build, it gets killed. Use `tmux` or `screen` to protect the session:
>
> ```bash
> # Start a tmux session (already installed by setup script)
> tmux new -s deploy
>
> # If disconnected, reconnect with:
> # ssh sotto@SERVER_IP
> # tmux attach -t deploy
> ```

```bash
cd ~/sotto

# Build images and start all 4 services in detached mode
# First build takes 3-5 minutes (downloads base images, installs deps, builds Next.js)
docker compose -f docker-compose.prod.yml up -d --build
```

Expected output:

```
[+] Building 180.5s (25/25) FINISHED
 => [web deps 1/4] FROM docker.io/library/node:20-alpine...
 => [web builder 3/3] RUN npm run build
 => ...
[+] Running 5/5
 ✔ Network sotto_sotto-network  Created
 ✔ Volume "sotto_sotto_postgres_data"  Created
 ✔ Volume "sotto_sotto_redis_data"  Created
 ✔ Container sotto-prod-postgres  Healthy
 ✔ Container sotto-prod-redis    Healthy
 ✔ Container sotto-prod-web      Started
 ✔ Container sotto-prod-workers  Started
```

### 5.3 Wait for containers to be healthy

Check that all containers are running:

```bash
docker compose -f docker-compose.prod.yml ps
```

Expected output:

```
NAME                   STATUS                   PORTS
sotto-prod-postgres    Up X minutes (healthy)
sotto-prod-redis       Up X minutes (healthy)
sotto-prod-web         Up X minutes (healthy)   127.0.0.1:3000->3000/tcp
sotto-prod-workers     Up X minutes
```

**If a container shows `Restarting` or `Exit`**, check its logs:

```bash
# Check web container logs
docker compose -f docker-compose.prod.yml logs web --tail 50

# Check workers container logs
docker compose -f docker-compose.prod.yml logs workers --tail 50

# Check postgres logs
docker compose -f docker-compose.prod.yml logs postgres --tail 50
```

### 5.4 Push the database schema

Prisma needs to create the tables in PostgreSQL:

```bash
docker compose -f docker-compose.prod.yml run --rm web ./node_modules/.bin/prisma db push
```

Expected output:

```
Environment variables loaded from .env
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "sotto", schema "public"...

🚀  Your database is now in sync with your Prisma schema.
```

**If this fails with a connection error**, postgres might not be healthy yet. Wait 10 seconds and retry.

### 5.5 Verify the app is responding

```bash
curl -s http://localhost:3000/api/health
```

Expected response:

```json
{"status":"ok",...}
```

If you get `curl: (7) Failed to connect`, the web container might still be starting. Check logs:

```bash
docker compose -f docker-compose.prod.yml logs web --tail 20
```

Look for `✓ Ready in Xms` — that means Next.js has started successfully.

---

## Step 6: Configure Caddy (HTTPS)

Caddy is the reverse proxy that sits between the internet and your Next.js app. It handles:

- **HTTPS** — automatically obtains and renews Let's Encrypt SSL certificates
- **Compression** — gzip/zstd for faster responses
- **Security headers** — HSTS, X-Content-Type-Options, X-Frame-Options, etc.
- **Static asset caching** — long-lived cache headers for fonts, JS, images
- **www redirect** — `www.sotto.fm` → `sotto.fm` (permanent redirect)

### 6.1 Copy the Caddyfile

```bash
sudo cp ~/sotto/Caddyfile /etc/caddy/Caddyfile
```

### 6.2 Verify the Caddyfile content

```bash
cat /etc/caddy/Caddyfile
```

You should see:

```
sotto.fm {
    reverse_proxy localhost:3000
    encode gzip zstd
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
        Permissions-Policy "camera=(), microphone=(self), geolocation=()"
        -Server
    }
    @static path /fonts/* /_next/static/* /favicon.ico /manifest.json /sw.js
    header @static Cache-Control "public, max-age=31536000, immutable"
    log {
        output file /var/log/caddy/sotto-access.log {
            roll_size 50MiB
            roll_keep 5
        }
    }
}

www.sotto.fm {
    redir https://sotto.fm{uri} permanent
}
```

### 6.3 Create the log directory

```bash
sudo mkdir -p /var/log/caddy
```

### 6.4 Reload Caddy

```bash
sudo systemctl reload caddy
```

### 6.5 Check Caddy status

```bash
sudo systemctl status caddy --no-pager
```

Look for `active (running)`. If it shows `failed`, check the logs:

```bash
sudo journalctl -u caddy --no-pager -n 30
```

### 6.6 Wait for SSL certificate

Caddy automatically contacts Let's Encrypt to get an SSL certificate. This requires:

- DNS is already pointing `sotto.fm` to this server's IP (from Step 2)
- Ports 80 and 443 are open (configured by UFW in Step 3)

Certificate provisioning takes 10-60 seconds. Check the logs:

```bash
sudo journalctl -u caddy --no-pager -n 20
```

Look for messages like:

```
certificate obtained successfully
```

If you see errors like `challenge failed` or `DNS not pointing`:

1. Verify DNS: `dig sotto.fm +short` should return your server IP
2. Verify ports: `sudo ufw status` should show 80 and 443 allowed
3. Wait for DNS propagation and try: `sudo systemctl restart caddy`

---

## Step 7: Verify Everything

Run all checks from your **local machine** (not the server).

### 7.1 Check HTTPS is working

```bash
curl -I https://sotto.fm 2>&1 | head -5
```

Expected: You should see a `307` redirect to `/access` (the password gate):

```
HTTP/2 307
location: /access
```

### 7.2 Check health endpoint (bypasses password gate)

```bash
curl -s https://sotto.fm/api/health | python3 -m json.tool
```

Expected:

```json
{
    "status": "ok",
    ...
}
```

### 7.3 Test the password gate API

```bash
# Test with WRONG password (should get 401)
curl -s -X POST https://sotto.fm/api/access \
  -H "Content-Type: application/json" \
  -d '{"password":"wrong-password"}'
# Expected: {"error":"Invalid password"}

# Test with CORRECT password (should get 200 + cookie)
curl -s -v -X POST https://sotto.fm/api/access \
  -H "Content-Type: application/json" \
  -d '{"password":"YOUR_ACTUAL_PASSWORD"}' 2>&1 | grep -E "(< HTTP|set-cookie|success)"
# Expected:
# < HTTP/2 200
# < set-cookie: sotto_access=granted; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000
# {"success":true}
```

### 7.4 Test www redirect

```bash
curl -I https://www.sotto.fm 2>&1 | head -3
```

Expected:

```
HTTP/2 301
location: https://sotto.fm/
```

### 7.5 Browser checks

Open a browser and verify each step:

1. **Visit `sotto.fm`** → Should redirect to the password entry page (`/access`)
2. **Enter a wrong password** → Should show an error message, stay on the page
3. **Enter the correct password** (the `SITE_PASSWORD` you set in `.env`) → Should redirect to the landing page (`/`)
4. **Refresh the page** → Should stay on the landing page (the `sotto_access` cookie persists for 30 days)
5. **Open an incognito/private window** → Visit `sotto.fm` → Should redirect to `/access` again (no cookie in incognito)

### 7.6 Check security headers

```bash
curl -s -I https://sotto.fm/access | grep -iE "(strict-transport|x-content-type|x-frame|referrer-policy)"
```

Expected:

```
strict-transport-security: max-age=31536000; includeSubDomains; preload
x-content-type-options: nosniff
x-frame-options: DENY
referrer-policy: strict-origin-when-cross-origin
```

---

## Step 8: Enable CI/CD (Optional)

This configures automatic deployment on every push to `main`. The GitHub Actions workflow (`.github/workflows/deploy.yml`) runs CI checks first, then SSHes into the server to pull and rebuild.

### 8.1 What the workflow does

On every push to `main`:

1. **CI Job** (runs on GitHub's servers):
   - Installs Node.js 20 + npm dependencies
   - Generates Prisma client
   - Runs `npm run lint` (ESLint)
   - Runs `npx tsc --noEmit` (TypeScript type checking)
   - Runs `npm test` (Vitest)
   - Runs `npm run build` (Next.js production build)
2. **Deploy Job** (only if CI passes):
   - SSHes into the server as `sotto`
   - `git pull origin main`
   - `docker compose build`
   - `./node_modules/.bin/prisma db push` (apply any schema changes)
   - `docker compose up -d` (restart with new images)
   - Health check
   - Prunes old Docker images

### 8.2 Generate a deploy SSH key

It's best to create a **dedicated** SSH key for CI/CD rather than using your personal key:

```bash
# On your local machine
ssh-keygen -t ed25519 -C "sotto-deploy" -f ~/.ssh/sotto_deploy
# Press Enter for no passphrase (GitHub Actions can't enter one)
```

Add the **public** key to the server's authorized keys:

```bash
# Copy the public key
cat ~/.ssh/sotto_deploy.pub

# SSH into the server and add it
ssh sotto@SERVER_IP
echo "ssh-ed25519 AAAA...the-key... sotto-deploy" >> ~/.ssh/authorized_keys
exit
```

### 8.3 Add GitHub secrets

1. Go to your repo on GitHub: `github.com/affromero/Sotto`
2. Click **Settings** (tab at the top of the repo)
3. In the left sidebar, click **Secrets and variables** → **Actions**
4. Click **New repository secret** for each:

| Secret Name | Value                                          | How to get it                                       |
| ----------- | ---------------------------------------------- | --------------------------------------------------- |
| `SERVER_IP` | Your Hetzner server IP (e.g., `5.161.xxx.xxx`) | From Step 1                                         |
| `SSH_KEY`   | Contents of the **private** key                | `cat ~/.ssh/sotto_deploy` (the file WITHOUT `.pub`) |

For `SSH_KEY`:

1. Click **New repository secret**
2. Name: `SSH_KEY`
3. Value: Paste the entire private key including the `-----BEGIN` and `-----END` lines
4. Click **Add secret**

### 8.4 Create the production environment

1. In repo Settings → **Environments**
2. Click **New environment**
3. Name: `production`
4. Click **Configure environment**
5. Optionally add protection rules (e.g., require approval before deploying)
6. Click **Save protection rules**

### 8.5 Test the pipeline

Push a small change to `main`:

```bash
# Make a trivial change
git commit --allow-empty -m "Test CI/CD pipeline"
git push origin main
```

Go to the **Actions** tab in your repo to watch the workflow run. You should see:

1. CI Checks job running (lint, typecheck, test, build)
2. Deploy job running after CI passes
3. Green checkmarks on both

### 8.6 Verify the deploy

After the workflow completes:

```bash
# Check the health endpoint
curl -s https://sotto.fm/api/health

# SSH in and check container status
ssh sotto@SERVER_IP "cd ~/sotto && docker compose -f docker-compose.prod.yml ps"
```

---

## Step 9: Share with Friends & Gather Feedback

### 9.1 Feedback strategy overview

You're optimizing for two different signals:

| What you're testing                        | How to test it                                 | Who to test with            |
| ------------------------------------------ | ---------------------------------------------- | --------------------------- |
| **Value** — do people _want_ this?         | Send the live app, let them create a podcast   | Close friends (5-10 people) |
| **Messaging** — do people _understand_ it? | Send the landing page only, see if they get it | Wider circle, acquaintances |

Start with value testing (the app itself). Friends will try it as a favor — strangers won't. Use that advantage.

### 9.2 What to send

Send your friends:

- **URL**: `sotto.fm`
- **Password**: whatever you set as `SITE_PASSWORD` in `.env`

### 9.3 The DM to send

Don't just drop a link. Give them a specific action and a reason to try it. Send via whatever channel is natural (iMessage, WhatsApp, Instagram DM, etc.):

**Template (adapt to your voice):**

> Hey — I'm building something and would love your honest take. It turns any topic into a podcast you can interrupt with questions.
>
> sotto.fm (password: `YOUR_PASSWORD`)
>
> Try making one about [something specific they'd care about]. Takes 2 min to start. Let me know what's confusing or if you'd actually use it.

**Why this works:**

- Gives a specific thing to do (not "check it out")
- Suggests a topic they'd personally find interesting
- Asks for confusion, not compliments
- Sets low time commitment ("2 min")

**Personalize the topic suggestion** for each person:

- Friend who's into cooking → "try making one about fermentation science"
- Friend who follows markets → "try making one about the Fed's rate decisions"
- Friend who's a new parent → "try making one about infant sleep research"

### 9.4 How the password gate works for them

1. They visit `sotto.fm` in their browser
2. They see a password entry page
3. They type the password and submit
4. A cookie (`sotto_access=granted`) is set in their browser
5. They're redirected to the landing page
6. The cookie lasts **30 days** — they won't need to enter the password again for a month
7. On a different device or after clearing cookies, they'll need the password again

### 9.5 What to ask after they try it

**Don't ask** "what do you think?" — you'll get polite, useless answers.

**Ask one specific question** at a time. Pick from these based on what you most need to learn:

| Question                                      | What it reveals                              |
| --------------------------------------------- | -------------------------------------------- |
| "What did you expect to happen that didn't?"  | UX gaps, broken mental models                |
| "Where did you get confused or stuck?"        | Friction points in the flow                  |
| "Would you use this again? Be honest."        | Core value signal                            |
| "Would you share this with someone? Who?"     | Organic growth potential                     |
| "Would you pay $14/month for this?"           | Willingness to pay                           |
| "What would you compare this to?"             | How they categorize you (competitor framing) |
| "What was the best part? What was the worst?" | Feature prioritization signal                |

**Timing matters:** Ask within 1-2 hours of them trying it. After that, the experience fades and you get vaguer answers.

### 9.6 What to watch for (not just what they say)

Actions speak louder than words:

| Signal                                 | What it means                        | How to check                                        |
| -------------------------------------- | ------------------------------------ | --------------------------------------------------- |
| They created a second podcast          | They found genuine value             | Check the database (see 9.8)                        |
| They shared it with someone unprompted | Strong product-market fit signal     | They'll tell you, or new users appear               |
| They interrupted during playback       | The core differentiator is working   | Check `Interaction` records                         |
| They never finished creating one       | The discovery chat flow has friction | Check `Discovery` records with no linked `Podcast`  |
| They said "cool" but never came back   | Polite but no real value delivered   | Check if they have only 1 podcast, created on day 1 |

### 9.7 Feedback rollout plan

Don't send it to everyone at once. Stagger it so you can fix things between batches:

**Batch 1 (Day 1): 3 close friends**

- People who'll give you honest, blunt feedback
- Fix the biggest UX issues they find before expanding

**Batch 2 (Day 3-5): 5-7 more friends**

- Mix of tech-savvy and non-technical people
- Non-technical feedback is more valuable — they'll hit the real friction

**Batch 3 (Day 7-10): Wider circle**

- Acquaintances, coworkers, Twitter mutuals
- These people won't be as forgiving — closer to real user behavior

**Batch 4 (Day 14+): Semi-public**

- Share on Twitter/LinkedIn without the password (remove the gate — see 9.11)
- This tests whether the landing page and product can stand on their own

### 9.8 Monitor usage on the server

Check who's actually using it (not just who said "looks cool"):

```bash
ssh sotto@SERVER_IP
cd ~/sotto

# How many users have signed up
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U sotto -d sotto -c 'SELECT count(*) FROM "User";'

# How many podcasts were created (and their status)
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U sotto -d sotto -c 'SELECT status, count(*) FROM "Podcast" GROUP BY status;'

# How many interactions (interrupts) happened
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U sotto -d sotto -c 'SELECT count(*) FROM "Interaction";'

# Most recent podcasts (who's creating what)
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U sotto -d sotto -c '
    SELECT u.name, p.title, p.status, p."createdAt"
    FROM "Podcast" p
    JOIN "User" u ON p."userId" = u.id
    ORDER BY p."createdAt" DESC
    LIMIT 10;
  '

# Users who came back and created more than one podcast (retention signal)
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U sotto -d sotto -c '
    SELECT u.name, count(p.id) as podcasts
    FROM "User" u
    JOIN "Podcast" p ON p."userId" = u.id
    GROUP BY u.id, u.name
    HAVING count(p.id) > 1
    ORDER BY podcasts DESC;
  '
```

### 9.9 Track what matters

Keep a simple log (a note on your phone is fine) for each tester:

```
Name: ___
Sent on: ___
Tried it: yes / no / unknown
Created a podcast: yes / no
Topic they chose: ___
Came back: yes / no
Key feedback: ___
Would pay: yes / no / maybe
```

After 10+ testers, patterns will emerge. The most common "where I got stuck" answer is your #1 priority fix.

### 9.10 Changing the password

If you need to change the password:

```bash
ssh sotto@SERVER_IP
cd ~/sotto
nano .env
# Change SITE_PASSWORD=new-password
# Save and exit (Ctrl+O, Enter, Ctrl+X)

# Restart the web container to pick up the new env var
docker compose -f docker-compose.prod.yml restart web
```

Existing cookies with the old password will still work (the cookie value is `granted`, not the password itself). To invalidate existing sessions, you'd need to change the cookie name in the source code.

### 9.11 Removing the password gate

To open the site to everyone:

```bash
ssh sotto@SERVER_IP
cd ~/sotto
nano .env
# Comment out or delete the SITE_PASSWORD line:
# SITE_PASSWORD=...
# Save and exit

docker compose -f docker-compose.prod.yml restart web
```

When `SITE_PASSWORD` is unset, the middleware skips the gate entirely.

---

## Quick Reference

### SSH Access

```bash
ssh sotto@SERVER_IP              # Connect to server
```

### Container Management

```bash
cd ~/sotto

# View status of all containers
docker compose -f docker-compose.prod.yml ps

# View logs (follow mode)
docker compose -f docker-compose.prod.yml logs -f web        # Web logs
docker compose -f docker-compose.prod.yml logs -f workers    # Worker logs
docker compose -f docker-compose.prod.yml logs -f postgres   # Database logs
docker compose -f docker-compose.prod.yml logs -f redis      # Redis logs

# View last N lines of logs
docker compose -f docker-compose.prod.yml logs web --tail 100

# Restart a single service
docker compose -f docker-compose.prod.yml restart web
docker compose -f docker-compose.prod.yml restart workers

# Full restart (all services)
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d

# Rebuild and restart (after code changes)
docker compose -f docker-compose.prod.yml up -d --build

# Manual deploy (pull latest code + rebuild)
cd ~/sotto && git pull origin main && docker compose -f docker-compose.prod.yml up -d --build

# Run database migrations after schema changes
docker compose -f docker-compose.prod.yml run --rm web ./node_modules/.bin/prisma db push
```

### Caddy (Reverse Proxy / HTTPS)

```bash
sudo systemctl status caddy --no-pager     # Check status
sudo systemctl reload caddy                 # Reload config (no downtime)
sudo systemctl restart caddy                # Full restart
sudo journalctl -u caddy --no-pager -n 50  # View logs
cat /var/log/caddy/sotto-access.log         # Access log
```

### System Monitoring

```bash
htop                                        # Interactive process viewer
df -h                                       # Disk usage
free -h                                     # Memory usage
docker stats --no-stream                    # Container resource usage
```

### Database Access

```bash
# Connect to Postgres inside the container
docker compose -f docker-compose.prod.yml exec postgres psql -U sotto -d sotto

# Common SQL queries
# \dt                    -- list tables
# SELECT count(*) FROM "User";
# \q                     -- quit
```

---

## Troubleshooting

### Caddy won't get SSL cert

**Symptoms**: `https://sotto.fm` shows a browser security warning or doesn't load.

**Check DNS**:

```bash
dig sotto.fm +short
# Must return your server IP
```

**Check ports**:

```bash
sudo ufw status
# Must show 80/tcp and 443/tcp ALLOW
```

**Check Caddy logs**:

```bash
sudo journalctl -u caddy --no-pager -n 30
```

**Common causes**:

- DNS not pointing to this server yet — wait for propagation
- Port 80 blocked — Let's Encrypt needs it for the ACME challenge
- Caddy config syntax error — run `caddy validate --config /etc/caddy/Caddyfile`

### Container won't start

**Check which container is failing**:

```bash
docker compose -f docker-compose.prod.yml ps
# Look for "Restarting" or "Exit" status
```

**Check its logs**:

```bash
docker compose -f docker-compose.prod.yml logs web --tail 50
```

**Common causes**:

- Missing required env vars — check `.env` has `POSTGRES_PASSWORD`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`
- Port 3000 already in use — `sudo lsof -i :3000`
- Out of disk space — `df -h`
- Out of memory during build — `free -h` (need at least 4GB free for `npm run build`)

### Password gate not working

**Symptoms**: Visiting `sotto.fm` shows the landing page instead of the password page, or the password doesn't work.

**Check `SITE_PASSWORD` is set**:

```bash
grep "^SITE_PASSWORD=" ~/sotto/.env
# Should print SITE_PASSWORD=your-password
```

**Restart the web container** (env changes need a restart):

```bash
cd ~/sotto && docker compose -f docker-compose.prod.yml restart web
```

**Test the API directly**:

```bash
curl -s -X POST http://localhost:3000/api/access \
  -H "Content-Type: application/json" \
  -d '{"password":"your-password"}'
# Should return {"success":true}
```

### Can't SSH after setup

**Symptoms**: `ssh sotto@SERVER_IP` says "Permission denied" or "Connection refused".

**Root login is intentionally disabled.** Use `sotto`:

```bash
ssh sotto@SERVER_IP
```

**If locked out completely:**

1. Go to [Hetzner Cloud Console](https://console.hetzner.cloud)
2. Click on the `sotto-prod` server
3. Click the **Console** button (top right) — this opens a VNC terminal
4. Log in as `root` (Hetzner sets this password during server creation, check your email)
5. Fix the SSH config or add your key back:

```bash
# Re-enable root login temporarily
sed -i 's/PermitRootLogin no/PermitRootLogin yes/' /etc/ssh/sshd_config
systemctl reload sshd
```

### Build runs out of memory

**Symptoms**: `docker compose up --build` fails with `ENOMEM` or `Killed`.

```bash
# Check available memory
free -h

# Create a swap file (temporary fix)
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Retry the build
cd ~/sotto && docker compose -f docker-compose.prod.yml up -d --build
```

### Docker disk space full

```bash
# Check disk usage
df -h

# Remove unused Docker resources (old images, stopped containers, build cache)
docker system prune -af

# Check what's using space
docker system df
```
