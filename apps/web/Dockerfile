# ============================================
# Sotto — Production Web Container
# Multi-stage build: deps → builder → runner
# ============================================

# ---- Stage 1: Install dependencies ----
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY package.json package-lock.json* ./
COPY prisma ./prisma/

RUN npm ci --ignore-scripts
RUN npx prisma generate

# ---- Stage 2: Build the application ----
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG COMMIT_SHA=dev
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV COMMIT_SHA=${COMMIT_SHA}

RUN npm run build

# ---- Stage 3: Production runner ----
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

ARG COMMIT_SHA=dev
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV COMMIT_SHA=${COMMIT_SHA}
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Create non-root user
RUN addgroup --system --gid 1001 sotto
RUN adduser --system --uid 1001 sotto

# Copy public assets
COPY --from=builder /app/public ./public

# Copy standalone build output
COPY --from=builder --chown=sotto:sotto /app/.next/standalone ./
COPY --from=builder --chown=sotto:sotto /app/.next/static ./.next/static

# Copy Prisma schema and generated client for runtime
COPY --from=builder --chown=sotto:sotto /app/prisma ./prisma
COPY --from=deps --chown=sotto:sotto /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=deps --chown=sotto:sotto /app/node_modules/@prisma ./node_modules/@prisma

USER sotto

EXPOSE 3000

CMD ["node", "server.js"]
