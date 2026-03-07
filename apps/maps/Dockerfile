FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/maps/package.json apps/maps/
COPY packages/maps/package.json packages/maps/
COPY packages/shared/package.json packages/shared/
RUN npm ci --workspace=@sotto/maps-app --workspace=@sotto/maps --workspace=@sotto/shared --include-workspace-root

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/maps/ apps/maps/
COPY packages/maps/ packages/maps/
COPY packages/shared/ packages/shared/
ARG NEXT_PUBLIC_MAPBOX_TOKEN
ENV NEXT_PUBLIC_MAPBOX_TOKEN=$NEXT_PUBLIC_MAPBOX_TOKEN
RUN npm run build --workspace=@sotto/maps-app

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/apps/maps/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/maps/.next/static ./apps/maps/.next/static
USER nextjs
EXPOSE 3001
ENV PORT=3001
CMD ["node", "apps/maps/server.js"]
