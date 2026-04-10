# ── Stage 1: Base ───────────────────────────────────────
FROM node:24-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ── Stage 2: Build ──────────────────────────────────────
FROM base AS build
WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/cli/package.json apps/cli/
COPY packages/crypto/package.json packages/crypto/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm build

# ── Stage 3: Production ────────────────────────────────
FROM base AS deploy
WORKDIR /app

# Copy workspace config for pnpm install --prod
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-lock.yaml ./
COPY --from=build /app/pnpm-workspace.yaml ./

# Copy built artifacts
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/package.json ./apps/server/
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/apps/web/package.json ./apps/web/
COPY --from=build /app/apps/cli/dist ./apps/cli/dist
COPY --from=build /app/apps/cli/package.json ./apps/cli/
COPY --from=build /app/packages/crypto/dist ./packages/crypto/dist
COPY --from=build /app/packages/crypto/package.json ./packages/crypto/

# Install production dependencies only
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile

# Make CLI available as 'skysend-cli' command
RUN ln -s /app/apps/cli/dist/index.js /usr/local/bin/skysend-cli && \
    chmod +x /app/apps/cli/dist/index.js

# Install su-exec for runtime UID/GID switching
RUN apk add --no-cache su-exec

# Create non-root user with default UID/GID
RUN addgroup -g 1001 skysend && \
    adduser -u 1001 -G skysend -s /bin/sh -D skysend

# Create data and uploads directories
RUN mkdir -p /data/db /uploads && \
    chown -R skysend:skysend /data /uploads

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Environment defaults for Docker
ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV UPLOADS_DIR=/uploads
ENV HOST=0.0.0.0
ENV PORT=3000
ENV PUID=1001
ENV PGID=1001

VOLUME ["/data", "/uploads"]
EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "apps/server/dist/index.js"]
