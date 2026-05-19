# GoalZone WS Service - Standalone Docker
# Compatible with Railway, Fly.io, Koyeb, and any Docker-hosting platform
# Uses its own prisma/schema.prisma (PostgreSQL provider)

FROM oven/bun:1

WORKDIR /app

# Copy prisma schema (already set to PostgreSQL)
COPY prisma ./prisma/

# Copy package files
COPY package.json ./

# Install dependencies
RUN bun install

# Generate Prisma client
RUN bunx prisma generate

# Copy application code
COPY index.ts ./
COPY db.ts ./

# Cloud platforms provide PORT via environment variable
ENV PORT=10000

# Environment variables (configured by the cloud platform)
ENV DATABASE_URL=""
ENV DATA_MODE=mock
ENV FOOTBALL_API_KEY=""

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

# Start the service
CMD ["bun", "index.ts"]