# ============================================
# Sotto — Production Web Container
# Multi-stage build: deps → builder → runner
# Build context: repo root (.)
# ============================================

# ---- Stage 1: Install dependencies ----
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/verification-standard/package.json ./packages/verification-standard/
COPY apps/web/prisma ./apps/web/prisma/

RUN npm ci --ignore-scripts
RUN npx prisma generate --schema=apps/web/prisma/schema.prisma

# ---- Stage 2: Build the application ----
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY packages/shared ./packages/shared/
COPY packages/verification-standard ./packages/verification-standard/
COPY apps/web ./apps/web/
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY tsconfig.base.json ./

ARG COMMIT_SHA=dev
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV COMMIT_SHA=${COMMIT_SHA}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY}
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=${NEXT_PUBLIC_VAPID_PUBLIC_KEY}

WORKDIR /app/apps/web
RUN npm run build

# ---- Stage 3: Production runner ----
FROM node:22-alpine AS runner
RUN apk add --no-cache libc6-compat openssl
# Install Claude Code CLI so claude-code:* models can spawn the claude binary
RUN npm install -g @anthropic-ai/claude-code

ARG COMMIT_SHA=dev
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV COMMIT_SHA=${COMMIT_SHA}
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Create non-root user
RUN addgroup --system --gid 1001 sotto
RUN adduser --system --uid 1001 sotto

# Standalone output mirrors monorepo structure (apps/web/server.js + node_modules/)
# Copy it to /app so paths resolve correctly
WORKDIR /app

# Copy public assets
COPY --from=builder /app/apps/web/public ./apps/web/public

# Copy standalone build output
COPY --from=builder --chown=sotto:sotto /app/apps/web/.next/standalone ./
COPY --from=builder --chown=sotto:sotto /app/apps/web/.next/static ./apps/web/.next/static

# Copy speaker recognition model
COPY --chown=sotto:sotto apps/web/models ./apps/web/models/

# Copy prompt templates (loaded at runtime by prompt-loader.ts)
COPY --chown=sotto:sotto apps/web/prompts ./apps/web/prompts/

# Copy accounting ledger for expenses dashboard
COPY --chown=sotto:sotto accounting/ledger ./accounting/ledger/

# Copy Prisma schema and generated client for runtime
COPY --from=builder --chown=sotto:sotto /app/apps/web/prisma ./apps/web/prisma
COPY --from=deps --chown=sotto:sotto /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=deps --chown=sotto:sotto /app/node_modules/@prisma ./node_modules/@prisma

USER sotto

WORKDIR /app/apps/web

EXPOSE 3000

CMD ["node", "server.js"]
