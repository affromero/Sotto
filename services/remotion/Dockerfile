FROM node:22-slim

# System dependencies: Chromium for Remotion, FFmpeg for media processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ffmpeg \
    fonts-noto-color-emoji \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Tell Remotion to use system Chromium
ENV REMOTION_CHROME_EXECUTABLE=/usr/bin/chromium

# Install Playwright Chromium for browser recording
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install chromium --with-deps

WORKDIR /app

# Copy root workspace files
COPY package.json package-lock.json ./
COPY packages/video/package.json packages/video/
COPY packages/shared/package.json packages/shared/
COPY packages/maps/package.json packages/maps/
COPY services/remotion/package.json services/remotion/

# Install dependencies
RUN npm ci --workspace=@sotto/video --workspace=@sotto/maps --workspace=@sotto/remotion-server --include-workspace-root

# Copy source
COPY packages/shared/ packages/shared/
COPY packages/video/ packages/video/
COPY packages/maps/ packages/maps/
COPY services/remotion/ services/remotion/
COPY tsconfig.base.json ./

EXPOSE 3100

CMD ["npx", "tsx", "services/remotion/src/server.ts"]
