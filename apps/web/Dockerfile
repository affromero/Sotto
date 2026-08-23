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
COPY packages/groundcheck/package.json ./packages/groundcheck/
COPY packages/learning-model/package.json ./packages/learning-model/
COPY apps/web/prisma ./apps/web/prisma/

RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts
RUN npx prisma generate --schema=apps/web/prisma/schema.prisma

# ---- Stage 2: Build the application ----
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY packages/shared ./packages/shared/
COPY packages/groundcheck ./packages/groundcheck/
COPY packages/learning-model ./packages/learning-model/
COPY apps/web ./apps/web/
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY tsconfig.base.json ./

# Prisma 7's `prisma-client` generator writes the client to apps/web/src/generated,
# which is gitignored on the host (so the apps/web COPY above omitted it).
# Regenerate it here, against the schema + node_modules already present, so
# `next build` can resolve @/generated/prisma/client.
RUN npx prisma generate --schema=apps/web/prisma/schema.prisma

ARG COMMIT_SHA=dev
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV COMMIT_SHA=${COMMIT_SHA}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=${NEXT_PUBLIC_VAPID_PUBLIC_KEY}

WORKDIR /app/apps/web
RUN npm run build

# ---- Stage 3: Production runner ----
FROM node:22-alpine AS runner
RUN apk add --no-cache libc6-compat openssl openssh-client
# Pin executable tooling so rebuilding a release cannot silently change it.
ARG CLAUDE_CODE_VERSION=2.1.225
ARG CODEX_VERSION=0.144.6
RUN npm install -g \
    "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
    "@openai/codex@${CODEX_VERSION}"

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Create non-root user
RUN addgroup --system --gid 1001 sotto
RUN adduser --system --uid 1001 sotto
RUN mkdir -p /home/sotto/.codex /home/sotto/.claude /home/sotto/.ssh \
    && chown -R sotto:sotto /home/sotto

# Default local-storage root (STORAGE_PROVIDER=local). It must exist in the
# image and be owned by the runtime user: Docker seeds a fresh named volume
# from the image path it covers, so if the path is missing the volume is
# created root-owned and every write fails with EACCES.
RUN mkdir -p /app/apps/web/.sotto/storage && chown -R sotto:sotto /app/apps/web/.sotto

ENV HOME=/home/sotto

ARG COMMIT_SHA=dev
ENV COMMIT_SHA=${COMMIT_SHA}

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

# Copy Prisma schema and generated client for runtime
COPY --from=builder --chown=sotto:sotto /app/apps/web/prisma ./apps/web/prisma
COPY --from=builder --chown=sotto:sotto /app/apps/web/src/generated ./apps/web/src/generated
COPY --from=deps --chown=sotto:sotto /app/node_modules/@prisma ./node_modules/@prisma

USER sotto

WORKDIR /app/apps/web

EXPOSE 3000

CMD ["node", "server.js"]
