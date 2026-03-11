FROM node:22-slim

# System dependencies: Chromium for Remotion, FFmpeg for media processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ffmpeg \
    fonts-noto-color-emoji \
    fontconfig \
    wget \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Inter and DM Serif Display fonts for FFmpeg drawtext overlays (best-effort)
RUN mkdir -p /usr/share/fonts/truetype/inter /usr/share/fonts/truetype/dm-serif \
    && (wget -q -O /tmp/Inter.zip "https://fonts.google.com/download?family=Inter" \
       && unzip -q /tmp/Inter.zip -d /tmp/inter \
       && cp /tmp/inter/static/Inter_18pt-Regular.ttf /usr/share/fonts/truetype/inter/Inter-Regular.ttf \
       && cp /tmp/inter/static/Inter_18pt-Bold.ttf /usr/share/fonts/truetype/inter/Inter-Bold.ttf \
       || echo "Inter font download skipped") \
    && (wget -q -O /tmp/DMSerif.zip "https://fonts.google.com/download?family=DM+Serif+Display" \
       && unzip -q /tmp/DMSerif.zip -d /tmp/dmserif \
       && cp /tmp/dmserif/DMSerifDisplay-Regular.ttf /usr/share/fonts/truetype/dm-serif/ \
       || echo "DM Serif font download skipped") \
    && fc-cache -f -v \
    && rm -rf /tmp/Inter.zip /tmp/inter /tmp/DMSerif.zip /tmp/dmserif 2>/dev/null; true

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
