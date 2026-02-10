# Deploying sotto.fm — Hetzner VPS + Early Access Gate

A detailed, step-by-step guide for deploying sotto.fm on a Hetzner VPS with password-protected early access. Every click, every command, every thing you need to check.

---

## Key Concepts (Read This First)

If you've only ever worked on code locally (`npm run dev`), deploying means making your app available on the internet so anyone with the URL can use it. Here's what each piece of the puzzle does:

### What is a VPS?

A **VPS (Virtual Private Server)** is a computer in a data center that you rent. It runs 24/7 and has a public IP address, meaning anyone on the internet can reach it. Think of it as your own Linux computer in the cloud — you get full control via SSH (remote terminal access), can install whatever you want, and it stays on even when your laptop is closed. Hetzner is the company renting us this computer. We chose them because they're significantly cheaper than AWS/GCP/Azure for equivalent hardware.

### What is Docker?

**Docker** packages your app and all its dependencies (Node.js, system libraries, etc.) into a self-contained unit called a **container**. Think of it like shipping a meal in a sealed lunchbox instead of giving someone a recipe — everything needed to run is already inside. Without Docker, you'd need to manually install the exact right version of Node.js, PostgreSQL, Redis, and dozens of libraries on the server, and pray nothing conflicts. Docker eliminates "works on my machine" problems.

Key terms:

- **Image** — A snapshot/blueprint of your app (like a frozen copy). Built from a `Dockerfile`.
- **Container** — A running instance of an image. You can start, stop, and restart containers.
- **Docker Compose** — A tool that runs multiple containers together (our app needs 4: the web server, the database, Redis, and background workers). Defined in `docker-compose.prod.yml`.
- **Volume** — Persistent storage that survives container restarts (used for database data).

### What is Caddy?

**Caddy** is a **reverse proxy** — a program that sits between the internet and your app. When someone visits `sotto.fm`, their browser talks to Caddy first, and Caddy forwards the request to your Next.js app running on port 3000.

Why not let Next.js handle traffic directly?

1. **HTTPS/SSL** — Browsers require HTTPS for security. Caddy automatically gets free SSL certificates from Let's Encrypt and renews them. Without this, browsers show a scary "Not Secure" warning.
2. **Security headers** — Caddy adds headers that protect against common web attacks (clickjacking, MIME sniffing, etc.).
3. **Compression** — Caddy compresses responses so pages load faster.
4. **Port hiding** — Your app runs on port 3000 internally, but users access port 443 (standard HTTPS). Caddy bridges this.

### What is DNS?

**DNS (Domain Name System)** translates human-readable names like `sotto.fm` into IP addresses like `46.225.110.252` that computers use. When you type `sotto.fm` in a browser, your computer asks DNS servers "what IP address is this?" and gets directed to our Hetzner server. We configure this by adding **records** at our domain registrar (Namecheap):

- **A Record** — Maps a domain name directly to an IP address (`sotto.fm` → `46.225.110.252`)
- **CNAME Record** — Maps a domain name to another domain name (`www.sotto.fm` → `sotto.fm`)

### What is SSH?

**SSH (Secure Shell)** is how you remotely control a server from your terminal. Instead of physically sitting at the Hetzner data center, you type `ssh sotto@SERVER_IP` and get a terminal on the remote machine. SSH uses **key pairs** for authentication (more secure than passwords):

- **Private key** — stays on your laptop (never share this)
- **Public key** — uploaded to the server (it's safe to share)

When you connect, the server checks if your private key matches a public key it knows. If yes, you're in.

### What is CI/CD?

**CI/CD (Continuous Integration / Continuous Deployment)** automates testing and deploying your code:

- **CI (Continuous Integration)** — Every time you push code to GitHub, automated checks run: linting (code style), type checking (TypeScript errors), tests (does it work?), and building (does it compile?). If any check fails, you know immediately.
- **CD (Continuous Deployment)** — If all CI checks pass, the code is automatically deployed to the server. No manual SSH, no manual `git pull`, no manual Docker rebuild. Push to `main` → tests pass → live on `sotto.fm` in minutes.

### What is a Firewall?

A **firewall** (we use **UFW** — Uncomplicated Firewall) controls which network traffic can reach your server. By default, we block everything and only allow:

- **Port 22** (SSH) — so you can remotely manage the server
- **Port 80** (HTTP) — needed for Let's Encrypt certificate verification
- **Port 443** (HTTPS) — the actual web traffic

This means if someone tries to access port 5432 (PostgreSQL) from the internet, the firewall blocks it — your database is only accessible from inside the server.

### What is PostgreSQL?

**PostgreSQL** (often just "Postgres") is a **relational database** — it stores your app's data in structured tables (users, podcasts, subscriptions, etc.). Think of it like a spreadsheet application that's extremely fast, can handle thousands of simultaneous reads/writes, and guarantees your data won't get corrupted. It runs as a separate program (in its own Docker container) and your app talks to it over a local network connection using SQL (Structured Query Language).

### What is Redis?

**Redis** is an **in-memory data store** — it keeps data in RAM instead of on disk, making it extremely fast (microseconds instead of milliseconds). We use it for two things:

1. **Job queue** — When a user creates a podcast, we don't generate it inside the web request (that would take minutes and the browser would time out). Instead, we add a "job" to a Redis queue, and a background worker picks it up.
2. **Caching** — Storing frequently-accessed data temporarily so we don't hit the database for every request.

### What is Prisma?

**Prisma** is an **ORM (Object-Relational Mapper)** — it lets you interact with the PostgreSQL database using TypeScript instead of writing raw SQL. You define your data model in `prisma/schema.prisma` (e.g., "a User has a name, email, and many Podcasts"), and Prisma generates:

- TypeScript types for every model
- A client library (`prisma.user.findMany()` instead of `SELECT * FROM users`)
- Migration tools to create/update database tables

`npx prisma db push` reads the schema file and creates/updates the actual database tables to match. If you add a new field to the User model, `db push` adds that column to the PostgreSQL table.

### What is Next.js?

**Next.js** is a **React framework** that adds server-side features. In plain React, your browser downloads JavaScript and renders everything client-side. Next.js can render pages on the server before sending them to the browser (faster initial load, better SEO). It also provides:

- **App Router** — file-based routing (`src/app/pricing/page.tsx` → `sotto.fm/pricing`)
- **API Routes** — backend endpoints in the same codebase (`src/app/api/health/route.ts` → `sotto.fm/api/health`)
- **Server Components** — components that run on the server and send only HTML to the browser (no JavaScript shipped)
- **Standalone mode** — for production, Next.js compiles into a self-contained Node.js server (what runs inside our Docker container)

### What is BullMQ / Workers?

**BullMQ** is a **job queue library** built on Redis. When a user clicks "Create Podcast," the API route doesn't generate the entire podcast synchronously (that would take 2-5 minutes and the HTTP request would time out). Instead:

1. The API route adds a **job** to a Redis queue: "generate podcast #123"
2. A **worker** process (running in a separate Docker container) picks up the job
3. The worker does the heavy lifting: AI script generation, text-to-speech, audio stitching
4. When done, the worker updates the database status to "READY"
5. The user gets a notification that their podcast is ready

We have 11 different worker types, each handling a different stage of the pipeline.

### What are Environment Variables?

**Environment variables** (the `.env` file) are configuration values that change between environments. Your local machine might use a test database, but the production server uses the real one. Instead of hardcoding `database_password = "abc123"` in your source code (which would be visible on GitHub), you put it in `.env` which is never committed to git. The app reads these values at startup using `process.env.DATABASE_URL`.

### What is Middleware?

**Middleware** (`src/middleware.ts`) is code that runs _before_ every request reaches your pages or API routes. Ours checks: "Does this visitor have a valid `sotto_access` cookie? If not, redirect them to the password entry page." It's like a bouncer at the door checking IDs before letting people into the club.

### What are Cookies?

**Cookies** are small pieces of data that a website stores in your browser. When you enter the correct password on `/access`, the server responds with a `Set-Cookie` header that tells your browser to store `sotto_access=granted`. On every subsequent request, your browser automatically sends this cookie back, so the middleware knows you've already authenticated. Our cookie expires after 30 days.

### What is npm vs npx?

**npm (Node Package Manager)** manages JavaScript packages (libraries) for your project:

- `npm install` — downloads all dependencies listed in `package.json` into a `node_modules/` folder
- `npm run dev` — runs a script defined in `package.json` (like a shortcut). `npm run build`, `npm run lint`, `npm test` are all defined there
- `npm run` is for running project scripts; `npm install` is for downloading packages

**npx** runs a package's binary without installing it globally. For example, `npx prisma db push` runs the `prisma` CLI that was installed as a project dependency. Without `npx`, you'd need to type the full path (`./node_modules/.bin/prisma db push`). Think of `npx` as "run this tool from my project's dependencies."

### What is Cloudflare R2?

**Cloudflare R2** is an object storage service — it stores files (audio files, PDFs, images) in the cloud. Think of it as a giant hard drive accessible via URLs. When a podcast is generated, the final MP3 file is uploaded to R2, and users download it from a URL like `https://pub-xxxxx.r2.dev/podcasts/abc123.mp3`.

Why R2 instead of storing files on our server?

- **CDN** — R2 serves files from Cloudflare's global network (300+ cities), so downloads are fast worldwide. Our server is in one location
- **Storage limits** — our server has 160GB. Audio files add up fast. R2 has essentially unlimited storage
- **Durability** — R2 has 99.999999999% durability (11 nines). Files won't be lost. A single server's disk could fail
- **S3-compatible** — R2 uses the same API as Amazon S3, the industry standard for object storage. This means we can swap to AWS S3 later without changing code

### What is Stripe?

**Stripe** is a payment processing platform. Instead of dealing with credit card numbers directly (which requires PCI compliance — a massive security burden), Stripe handles all the money stuff:

1. **Checkout** — When a user clicks "Subscribe to Starter ($9/mo)", we redirect them to a Stripe-hosted payment page. Stripe collects their credit card info (never touches our server), processes the payment, and redirects them back
2. **Subscriptions** — Stripe manages recurring billing automatically. Every month, it charges the card and sends us the money (minus their ~2.9% + $0.30 fee)
3. **Webhooks** — When something happens (payment succeeds, subscription cancels, card declines), Stripe sends an HTTP request to our `/api/webhooks/stripe` endpoint with the details. Our code then updates the database accordingly (e.g., downgrade user to Free tier)
4. **Customer Portal** — Stripe provides a pre-built page where users can update their credit card, cancel, or change plans. We just redirect them to it

Key Stripe concepts:

- **Secret Key** (`sk_live_...`) — used server-side to create charges and manage subscriptions. Never expose this publicly
- **Publishable Key** (`pk_live_...`) — used client-side (in the browser) to initialize Stripe's payment form. Safe to expose
- **Webhook Secret** (`whsec_...`) — used to verify that webhook requests actually came from Stripe, not an impersonator

### What is ElevenLabs?

**ElevenLabs** is a text-to-speech (TTS) API — we send text and a voice ID, and they return an audio file of that text spoken in that voice. Each podcast segment is converted to audio separately (one for the "host" voice, one for the "expert" voice), then our FFmpeg worker stitches them together into a single MP3.

### What is FFmpeg?

**FFmpeg** is an open-source command-line tool for manipulating audio and video. We use it to:

- **Concatenate** audio segments — join 20+ individual TTS clips into one continuous podcast file
- **Normalize** audio levels — ensure consistent volume throughout (so the host isn't louder than the expert)
- It's included in our workers Docker container

### What is the Anthropic Claude API?

**Claude** is Anthropic's AI model (like ChatGPT is OpenAI's). We use it for:

- **Discovery chat** — the conversational flow where users describe what podcast they want
- **Script generation** — turning the discovery metadata into a two-voice podcast script with citations
- **Script verification** — a "teacher" agent that fact-checks claims and validates sources
- **Q&A during playback** — when users interrupt to ask questions, Claude answers using the script context

We interact with it via HTTP API calls. Each call costs money based on the number of tokens (roughly words) sent and received.

### What is TypeScript?

**TypeScript** is JavaScript with **types** — annotations that describe what kind of data variables hold. Instead of `function add(a, b)`, you write `function add(a: number, b: number): number`. This catches bugs at compile time rather than runtime. For example, if you accidentally pass a string to `add("hello", 5)`, TypeScript flags it as an error before the code even runs. The `npx tsc --noEmit` command checks all types without producing output files.

### What is ESLint?

**ESLint** is a **linter** — a tool that analyzes your code for potential errors, style violations, and bad practices without running it. It catches things like unused variables, missing `await` on async functions, inconsistent formatting, and patterns that commonly lead to bugs. `npm run lint` runs it across the entire codebase.

### What is an API Route?

In Next.js, an **API route** is a backend endpoint defined as a file. `src/app/api/health/route.ts` becomes accessible at `sotto.fm/api/health`. When someone makes an HTTP request to that URL, the code in `route.ts` runs on the server and returns a response (usually JSON). This is how the frontend communicates with the backend — for example, when you submit the password on `/access`, the browser sends a POST request to `/api/access` which validates it server-side.

### What is a Webhook?

A **webhook** is a "reverse API call" — instead of _us_ calling Stripe to check if a payment went through, _Stripe calls us_ when it happens. Stripe sends an HTTP POST request to our `/api/webhooks/stripe` endpoint with details like "user X's subscription was renewed" or "user Y's card was declined." This is how we keep our database in sync with Stripe's records without polling.

### What is NextAuth?

**NextAuth.js** (v5) is an authentication library for Next.js. It handles the complex OAuth flows for "Sign in with Google/GitHub/Twitter/Apple" so we don't have to implement each one from scratch. It manages:

- **Sessions** — tracking who's logged in (stored in an encrypted cookie)
- **OAuth flows** — redirecting to Google, handling the callback, exchanging tokens
- **Database integration** — storing user records in PostgreSQL via Prisma

### What are Server Components vs Client Components?

In Next.js App Router:

- **Server Components** (default) — render on the server and send only HTML to the browser. No JavaScript is shipped. Great for static content, database queries, and faster page loads
- **Client Components** (marked with `'use client'`) — render in the browser. Required when you need interactivity: click handlers, form state, animations, browser APIs (like audio playback). They ship JavaScript to the browser

We use Server Components by default and only opt into Client Components when we need interactivity. This keeps the JavaScript bundle small and pages fast.

### What is CSS Modules?

**CSS Modules** is a styling approach where each component has its own `.module.css` file. Class names are automatically scoped — so `.button` in `Card.module.css` won't conflict with `.button` in `Header.module.css`. The build system transforms `.button` into something like `.Card_button_a3f2x` to guarantee uniqueness. We use this instead of Tailwind CSS (utility-first classes like `className="flex p-4 bg-blue-500"`) for more readable, maintainable styles.

### What is a PWA?

**PWA (Progressive Web App)** makes a website installable on phones — users can add it to their home screen and it behaves like a native app (full screen, offline support, push notifications). We use this as our mobile strategy instead of building a separate iOS/Android app. The `manifest.json` and `sw.js` (service worker) files make this possible.

---

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

> **What we're doing:** Renting a Linux computer (Ubuntu 24.04) from Hetzner's data center. After this step, you'll have a server with a public IP address running 24/7 that you can connect to from your terminal. This is where sotto.fm will live.

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

**Image (Operating System):**

- Click the **OS Images** tab
- Select **Ubuntu** → **24.04**
- Ubuntu is a Linux distribution (like macOS or Windows, but for servers). Version 24.04 is the latest long-term support release

**Type:**

- Click **Shared vCPU** tab (cheaper, fine for our workload). "Shared vCPU" means your server shares physical CPU cores with other customers — fine for a small app, much cheaper than dedicated cores
- Select **x86 (Intel/AMD)** architecture
- Select **CPX31**: 4 vCPU AMD, 8 GB RAM, 160 GB SSD NVMe
- Cost: ~€11.49/month (~$12.50/month)
- Why CPX31: Docker builds need RAM. The 4GB tier will OOM (Out Of Memory — the OS kills the process when RAM is exhausted) during `npm run build`. 8GB gives headroom for Postgres + Redis + Web + Workers running simultaneously

**Networking:**

- Leave **Public IPv4** checked (you need this). An IPv4 address is the `46.225.110.252`-style address that lets the internet reach your server
- **IPv6** is fine to leave checked (free). IPv6 is the newer address format — doesn't hurt to have it
- Skip **Private Networks** (not needed for a single server). Private networks are for connecting multiple servers securely — we only have one

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

Let's verify we can connect to the server. The "fingerprint" prompt appears the first time you connect to a new server — it's SSH asking you to confirm the server's identity (to prevent man-in-the-middle attacks). Type "yes" to trust it; this only happens once per server.

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

> **What we're doing:** Right now, the domain `sotto.fm` doesn't know where to send visitors. We need to tell the internet's phone book (DNS) that `sotto.fm` should point to our Hetzner server's IP address. After this step, when someone types `sotto.fm` in a browser, their request will reach our server.

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

An **A Record** ("Address Record") is the most basic DNS record — it directly maps a domain name to an IPv4 address. This is what tells the internet "when someone asks for `sotto.fm`, send them to IP address `46.225.110.252`."

1. Click **Add New Record**
2. Set:
   - **Type**: `A Record`
   - **Host**: `@` (the `@` symbol means the root domain itself — `sotto.fm` — as opposed to a subdomain like `blog.sotto.fm`)
   - **Value**: `SERVER_IP` (the IP from Step 1)
   - **TTL**: `Automatic` (TTL = "Time To Live" — how long DNS servers cache this record before checking for updates. "Automatic" is usually 5-30 minutes)
3. Click the green checkmark to save

### 2.5 Add the CNAME record (www subdomain)

A **CNAME Record** ("Canonical Name") maps one domain name to another. Instead of giving `www.sotto.fm` its own IP address, we say "www.sotto.fm is an alias for sotto.fm" — so it inherits whatever IP address the A record points to. If we later change the server IP, we only need to update one record.

1. Click **Add New Record** again
2. Set:
   - **Type**: `CNAME Record`
   - **Host**: `www`
   - **Value**: `sotto.fm.` (with trailing dot — this is a DNS convention meaning "this is a fully qualified domain name, not relative." Without it, some DNS providers would interpret it as `sotto.fm.sotto.fm`)
   - **TTL**: `Automatic`
3. Click the green checkmark to save

### 2.6 Final DNS record table

| Type         | Host | Value       | TTL       |
| ------------ | ---- | ----------- | --------- |
| A Record     | @    | `SERVER_IP` | Automatic |
| CNAME Record | www  | `sotto.fm.` | Automatic |

### 2.7 Wait for DNS propagation

**DNS propagation** is the time it takes for your DNS changes to spread across the internet's network of DNS servers. When you update a record at Namecheap, it doesn't instantly reach every DNS server worldwide — it ripples outward as servers' caches expire and they fetch the new record. This typically takes 5-30 minutes but can take up to 48 hours in rare cases.

`dig` (Domain Information Groper) is a command-line tool for querying DNS servers. It's useful for checking whether your DNS changes have propagated.

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

> **What we're doing:** The server we rented is a blank Ubuntu machine — it has nothing installed except the operating system. This step installs all the software we need (Docker for running our app, Caddy for handling HTTPS, a firewall for security) and locks down the server so only we can access it. Think of it as furnishing an empty apartment before you can live in it.

This step installs Docker, Caddy, configures the firewall, creates a `sotto` user, and hardens SSH. After this step, root login is permanently disabled.

### 3.1 What the setup script does

The script `scripts/setup-server.sh` performs 7 actions:

1. **Updates Ubuntu** packages to latest — like running Windows Update, ensures all system software has the latest security patches
2. **Creates `sotto` user** with sudo access and copies root's SSH keys — `root` is the all-powerful admin account on Linux. It's dangerous to use daily because any mistake (like `rm -rf /`) is irreversible. We create a regular user `sotto` that can temporarily elevate to admin with `sudo` (like "Run as Administrator" on Windows)
3. **Installs Docker** via the official install script and adds `sotto` to the docker group — the "docker group" lets the `sotto` user run Docker commands without `sudo`
4. **Installs Caddy** (reverse proxy with automatic HTTPS — see Key Concepts above)
5. **Installs utilities** — `git` (to clone code), `curl` (to make HTTP requests from the command line), `unzip` (to extract archives), `htop` (a visual process monitor, like Activity Monitor/Task Manager for the terminal)
6. **Configures UFW firewall** — allows SSH (port 22), HTTP (port 80), HTTPS (port 443), blocks everything else. A "port" is like an apartment number — the IP address gets you to the building, the port number gets you to the right service
7. **Hardens SSH** — disables password authentication (only SSH keys work, which are much harder to brute-force) and disables root login (forces using the `sotto` user)

### 3.2 Run the setup script

From your **local machine** (not SSH'd into the server):

```bash
# Navigate to the Sotto project
cd ~/Code/Sotto

# Run the script on the remote server via SSH
ssh root@SERVER_IP "bash -s" < scripts/setup-server.sh
```

This pipes the local script into a remote bash session. What's happening: `ssh root@SERVER_IP "bash -s"` opens a remote terminal, and `< scripts/setup-server.sh` sends the contents of that file as input. So the script runs on the remote server, not on your laptop. You'll see output like:

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

> **What we're doing:** Copying our code from GitHub onto the server and setting up the configuration file (`.env`) that tells the app its secrets — database passwords, encryption keys, and the password gate code. The app reads these values at startup. We generate random strings for passwords/secrets because predictable values are a security risk.

### 4.1 SSH into the server

```bash
ssh sotto@SERVER_IP
```

### 4.2 Clone the repository

`git clone` downloads a complete copy of the code from GitHub onto the server. `~/sotto` means it goes into a folder called `sotto` in the home directory of the `sotto` user.

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

`.env.example` is a template showing all the environment variables the app needs, with placeholder values. We copy it to `.env` (the actual file the app reads) and then fill in real values.

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
STRIPE_PRICE_ID_STARTER=price_...
STRIPE_PRICE_ID_PRO=price_...
STRIPE_PRICE_ID_STUDIO=price_...
STRIPE_PRICE_ID_CREDITS_3=price_...
STRIPE_PRICE_ID_CREDITS_10=price_...
STRIPE_PRICE_ID_CREDITS_25=price_...
```

---

## Step 5: Build & Deploy

> **What we're doing:** Docker reads our `Dockerfile` (a recipe for building the app) and creates **images** — frozen snapshots that contain our Next.js app, all its npm dependencies, and the compiled production build. Then Docker Compose starts 4 **containers** (running instances) from these images, plus PostgreSQL and Redis. This is the equivalent of running `npm run dev` locally, but in a production-optimized, isolated environment.
>
> **Why "build" takes so long:** Docker is doing everything from scratch the first time — downloading base images (Node.js, PostgreSQL, Redis), running `npm install` (downloading all dependencies), and running `npm run build` (compiling Next.js into optimized production files). Subsequent builds are much faster because Docker caches layers that haven't changed.

### 5.1 Understand the container architecture

`docker-compose.prod.yml` defines 4 services:

| Service    | Image                           | Purpose                                                                                                                       | Port             |
| ---------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `postgres` | `postgres:16-alpine`            | PostgreSQL database — stores all app data (users, podcasts, etc.)                                                             | Internal only    |
| `redis`    | `redis:7-alpine`                | Job queue + cache — stores temporary data in RAM for speed (512MB max, LRU eviction means oldest data gets deleted when full) | Internal only    |
| `web`      | Built from `Dockerfile`         | Next.js app (standalone mode) — serves the website and API                                                                    | `127.0.0.1:3000` |
| `workers`  | Built from `Dockerfile.workers` | Background job processors (11 types) + FFmpeg (audio/video tool) — handles podcast generation, TTS, stitching                 | Internal only    |

"Alpine" in the image names (e.g., `postgres:16-alpine`) means using Alpine Linux as the base — a tiny Linux distribution (~5MB vs ~100MB for regular Ubuntu). Smaller images = faster downloads and less disk usage.

The web container only binds to `127.0.0.1:3000` (localhost), not `0.0.0.0:3000`. `127.0.0.1` means "only accept connections from this same machine." `0.0.0.0` would mean "accept connections from anywhere." Since Caddy runs on the same machine and forwards traffic to port 3000, only local access is needed — this is a security best practice.

### 5.2 Build and start all containers

> **Important:** The build takes 3-5 minutes and runs in the **foreground** (it occupies your terminal). If your SSH connection drops mid-build (Wi-Fi hiccup, laptop sleep), the process gets killed and you have to start over. Use `tmux` to protect the session — `tmux` is a **terminal multiplexer** that keeps your session alive on the server even if your SSH connection drops:
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

# Build images and start all 4 services in detached mode (-d means "detached" —
# containers run in the background after starting, so you get your terminal back)
# --build forces Docker to rebuild images (picks up code changes)
# -f specifies which compose file to use (we have a separate prod config)
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

PostgreSQL is running, but it's an empty database — no tables exist yet. Prisma reads the schema file (`prisma/schema.prisma`) which defines all our models (User, Podcast, etc.) and creates the corresponding database tables, columns, and indexes. Think of it as setting up an empty spreadsheet with all the right column headers before you can start entering data.

```bash
# --profile migration: activates the one-off "migrate" service defined in docker-compose
# run --rm: starts a temporary container that's deleted after the command finishes
# npx prisma db push: the actual command that syncs the schema to the database
docker compose -f docker-compose.prod.yml --profile migration run --rm migrate npx prisma db push
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

`curl` is a command-line tool for making HTTP requests — like visiting a URL in your browser, but from the terminal. The `-s` flag means "silent" (don't show download progress). We're hitting the health endpoint which is a simple route that checks if the app, database, and Redis are all reachable.

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

> **What we're doing:** Our Next.js app is now running on the server, but it's only listening on `localhost:3000` — meaning only programs _on the server itself_ can reach it. We need Caddy to act as the front door: it listens on ports 80 (HTTP) and 443 (HTTPS), handles the SSL certificate (the thing that puts the padlock icon in the browser), and forwards requests to our app. After this step, `https://sotto.fm` will work in any browser.
>
> **How SSL/HTTPS works at a high level:** When your browser connects to `https://sotto.fm`, Caddy presents an SSL certificate that proves "I am the real sotto.fm." The browser and Caddy then establish an encrypted connection so nobody can eavesdrop on the traffic. Caddy gets this certificate for free from **Let's Encrypt**, a nonprofit certificate authority. Caddy handles the entire process automatically — requesting, installing, and renewing certificates every 90 days.

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

You should see the following. Here's what each line does:

```
sotto.fm {
    # Forward all requests to our Next.js app running on port 3000
    reverse_proxy localhost:3000

    # Compress responses with gzip or zstd (faster page loads, less bandwidth)
    encode gzip zstd

    # Add security headers to every response
    header {
        # Tell browsers to always use HTTPS for this site (for 1 year)
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        # Prevent MIME type sniffing (a security attack vector)
        X-Content-Type-Options nosniff
        # Prevent this site from being embedded in iframes (prevents clickjacking)
        X-Frame-Options DENY
        # Control what URL info is sent when clicking outbound links
        Referrer-Policy strict-origin-when-cross-origin
        # Restrict which browser features the site can use (no camera, no geolocation, microphone only for voice features)
        Permissions-Policy "camera=(), microphone=(self), geolocation=()"
        # Remove the "Server" header that would reveal we're using Caddy (security through obscurity)
        -Server
    }

    # For static assets (fonts, compiled JS, favicon, etc.), tell browsers to cache them for 1 year
    # "immutable" means "this file will never change" — Next.js uses content-hashed filenames
    # so a new build produces new filenames, and old cached files are simply never requested again
    @static path /fonts/* /_next/static/* /favicon.ico /manifest.json /sw.js
    header @static Cache-Control "public, max-age=31536000, immutable"

    # Write access logs to a file, rotating when it exceeds 50MB, keeping the last 5 files
    log {
        output file /var/log/caddy/sotto-access.log {
            roll_size 50MiB
            roll_keep 5
        }
    }
}

# Redirect www.sotto.fm → sotto.fm (permanent 301 redirect)
# {uri} preserves the path, so www.sotto.fm/pricing → sotto.fm/pricing
www.sotto.fm {
    redir https://sotto.fm{uri} permanent
}
```

### 6.3 Create the log directory

`sudo` means "run this command as the root/admin user" — needed because `/var/log/` is owned by root. `mkdir -p` creates the directory and any parent directories if they don't exist (the `-p` flag prevents errors if the directory already exists).

```bash
sudo mkdir -p /var/log/caddy
```

### 6.4 Reload Caddy

`systemctl` is the Linux service manager. It starts, stops, and restarts programs that run in the background (called "services" or "daemons"). `reload` tells Caddy to re-read its configuration file without fully restarting — meaning zero downtime.

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

> **What we're doing:** Running through a checklist to make sure every piece of the deployment is working: HTTPS, the password gate, security headers, redirects. These commands use `curl` (a command-line HTTP client) from your laptop to simulate what a browser does. `curl -I` fetches only the HTTP headers (metadata about the response, like status code and cookies) without downloading the full page body. The `2>&1 | head -5` part combines error output with regular output and shows only the first 5 lines.

Run all checks from your **local machine** (not the server).

### 7.1 Check HTTPS is working

```bash
curl -I https://sotto.fm 2>&1 | head -5
```

Expected: You should see a `200` response (the "Under Construction" page):

```
HTTP/2 200
```

Then test the password-gated alpha landing page:

```bash
curl -I https://sotto.fm/romero 2>&1 | head -5
```

Expected: `307` redirect to `/access` (password gate). A 307 is an HTTP status code meaning "Temporary Redirect" — the server is saying "go to `/access` instead." This is the middleware in action — it detected no `sotto_access` cookie and sent the visitor to the password page:

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

1. **Visit `sotto.fm`** → Should show the "Under Construction" page (public, no password)
2. **Visit `sotto.fm/romero`** → Should redirect to the password entry page (`/access`)
3. **Enter a wrong password** → Should show an error message, stay on the page
4. **Enter the correct password** (the `SITE_PASSWORD` you set in `.env`) → Should redirect to the alpha landing page (`/romero`)
5. **Refresh the page** → Should stay on the landing page (the `sotto_access` cookie persists for 30 days)
6. **Open an incognito/private window** → Visit `sotto.fm/romero` → Should redirect to `/access` again (no cookie in incognito)

### 7.6 Check security headers

These are HTTP response headers that Caddy adds to protect users. They're invisible to normal browsing but browsers read them to enforce security policies.

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

What each header does:

- **Strict-Transport-Security** — tells browsers "always use HTTPS for this site, even if someone types `http://`." The `max-age=31536000` (1 year) means the browser remembers this for a year
- **X-Content-Type-Options: nosniff** — prevents browsers from guessing file types (a security attack vector called MIME sniffing)
- **X-Frame-Options: DENY** — prevents other websites from embedding sotto.fm in an iframe (prevents clickjacking attacks)
- **Referrer-Policy** — controls how much URL info is shared when clicking links to other sites

---

## Step 8: Enable CI/CD (Optional)

> **What we're doing:** Without CI/CD, deploying code changes is manual: SSH into the server, `git pull`, rebuild Docker, restart. This gets tedious fast. CI/CD automates the entire process using **GitHub Actions** — GitHub's built-in automation platform. You define a **workflow** (a YAML file in `.github/workflows/`) that tells GitHub: "every time code is pushed to `main`, run these steps." GitHub provides free servers to run the CI checks, and our deploy step SSHes into our Hetzner server to apply the update.
>
> **Why CI before CD?** If someone pushes broken code, CI catches it before it reaches production. Without CI, a typo could take down the live site.

This configures automatic deployment on every push to `main`. The GitHub Actions workflow (`.github/workflows/deploy.yml`) runs CI checks first, then SSHes into the server to pull and rebuild.

### 8.1 What the workflow does

On every push to `main`:

1. **CI Job** (runs on GitHub's free servers — not our Hetzner server):
   - Installs Node.js 20 + npm dependencies
   - Generates Prisma client (TypeScript types for the database)
   - Runs `npm run lint` — **ESLint** checks code style and common mistakes (unused variables, missing imports, etc.)
   - Runs `npx tsc --noEmit` — **TypeScript compiler** checks all types are correct without producing output files. Catches bugs like passing a string where a number is expected
   - Runs `npm test` — **Vitest** runs the test suite (unit tests that verify individual functions work correctly)
   - Runs `npm run build` — compiles the entire Next.js app into production files. This catches import errors, missing dependencies, and build-time issues
2. **Deploy Job** (only runs if ALL CI checks pass):
   - SSHes into our Hetzner server as `sotto` (using the deploy key we set up)
   - `git pull origin main` — downloads the latest code from GitHub
   - `docker compose build` — rebuilds Docker images with the new code
   - `docker compose --profile migration run --rm migrate npx prisma db push` — applies any database schema changes (new tables, columns, etc.)
   - `docker compose up -d` — restarts containers with the new images
   - Health check — verifies the app is responding after deploy
   - Prunes old Docker images — cleans up disk space from previous builds

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

**GitHub Secrets** are encrypted environment variables stored in your repository settings. GitHub Actions can access them during workflow runs, but they're never visible in logs or to anyone browsing the repo. This is how we give GitHub Actions the server IP and SSH key without exposing them publicly.

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

- **URL**: `sotto.fm/romero` (the public root `sotto.fm` shows "Under Construction")
- **Password**: whatever you set as `SITE_PASSWORD` in `.env`

### 9.3 The DM to send

Don't just drop a link. Give them a specific action and a reason to try it. Send via whatever channel is natural (iMessage, WhatsApp, Instagram DM, etc.):

**Template (adapt to your voice):**

> Hey — I'm building something and would love your honest take. It turns any topic into a podcast you can interrupt with questions.
>
> sotto.fm/romero (password: `YOUR_PASSWORD`)
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

1. They visit `sotto.fm/romero` in their browser
2. They're redirected to the password entry page (`/access`)
3. They type the password and submit
4. A signed cookie (`sotto_access`) is set in their browser
5. They're redirected to the alpha landing page (`/romero`)
6. The cookie lasts **30 days** — they won't need to enter the password again for a month
7. On a different device or after clearing cookies, they'll need the password again
8. Visiting `sotto.fm` (root) shows the public "Under Construction" page — no password needed

### 9.5 What to ask after they try it

**Don't ask** "what do you think?" — you'll get polite, useless answers.

**Ask one specific question** at a time. Pick from these based on what you most need to learn:

| Question                                      | What it reveals                              |
| --------------------------------------------- | -------------------------------------------- |
| "What did you expect to happen that didn't?"  | UX gaps, broken mental models                |
| "Where did you get confused or stuck?"        | Friction points in the flow                  |
| "Would you use this again? Be honest."        | Core value signal                            |
| "Would you share this with someone? Who?"     | Organic growth potential                     |
| "Would you pay $9/month for this?"            | Willingness to pay                           |
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
docker compose -f docker-compose.prod.yml --profile migration run --rm migrate npx prisma db push
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
