# ============================================
# Sotto Maps — Production Container
# Multi-stage build: deps → builder → runner
# Build context: repo root (.)
# ============================================

# ---- Stage 1: Install dependencies ----
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/maps/package.json ./apps/maps/
COPY apps/web/package.json ./apps/web/
COPY packages/maps/package.json ./packages/maps/
COPY packages/shared/package.json ./packages/shared/
COPY packages/video/package.json ./packages/video/
COPY packages/verification-standard/package.json ./packages/verification-standard/

RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts

# ---- Stage 2: Build the application ----
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/maps/node_modules ./apps/maps/node_modules
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/maps/ apps/maps/
COPY packages/maps/ packages/maps/
COPY packages/shared/ packages/shared/
ARG NEXT_PUBLIC_MAPBOX_TOKEN
ENV NEXT_PUBLIC_MAPBOX_TOKEN=$NEXT_PUBLIC_MAPBOX_TOKEN
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app/apps/maps
RUN npm run build

# ---- Stage 3: Production runner ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/apps/maps/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/maps/.next/static ./apps/maps/.next/static
USER nextjs
EXPOSE 3001
ENV PORT=3001
CMD ["node", "apps/maps/server.js"]
