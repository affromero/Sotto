# ============================================
# Sotto — Production Web Container
# Multi-stage build: deps → builder → runner
# Build context: repo root (.)
# ============================================

# ---- Stage 1: Install dependencies ----
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/prisma ./apps/web/prisma/

RUN npm ci --ignore-scripts
RUN npx prisma generate --schema=apps/web/prisma/schema.prisma

# ---- Stage 2: Build the application ----
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY packages/shared ./packages/shared/
COPY apps/web ./apps/web/
COPY tsconfig.base.json ./

ARG COMMIT_SHA=dev
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV COMMIT_SHA=${COMMIT_SHA}

WORKDIR /app/apps/web
RUN npm run build

# ---- Stage 3: Production runner ----
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat openssl

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

# Copy Prisma schema and generated client for runtime
COPY --from=builder --chown=sotto:sotto /app/apps/web/prisma ./apps/web/prisma
COPY --from=deps --chown=sotto:sotto /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=deps --chown=sotto:sotto /app/node_modules/@prisma ./node_modules/@prisma

USER sotto

WORKDIR /app/apps/web

EXPOSE 3000

CMD ["node", "server.js"]
