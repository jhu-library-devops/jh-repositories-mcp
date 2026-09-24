# syntax=docker/dockerfile:1
#
# jhu-repository-mcp — multi-stage production image
#
# Every stage uses the SAME pinned Bun release (.bun-version = 1.2.15),
# pinned by version AND digest so local, CI, and production builds use the
# same toolchain; the runtime stage additionally applies Debian security
# updates at build time. The final image contains only the Bun-targeted
# production bundle and required runtime files: no dev dependencies, no
# source tree, no repository credentials, and no Node.js runtime.
#
# Runtime security posture (paired with the ECS task definition):
#   - runs as the non-root `bun` user
#   - designed for a read-only root filesystem; TMPDIR is the only
#     writable path the process needs (mount a tmpfs at /tmp)
#   - dependency-free liveness/readiness endpoints for health checks
#   - SIGTERM triggers readiness-drain before exit (ECS stopTimeout >= 15s)
#
# Requirements: 12.6-12.8, 13.8-13.9, 14, 15.8, 17

ARG BUN_IMAGE=oven/bun:1.2.15@sha256:8b5e8d3b6a734ae438c7c6f1bdc23e54eb9c35a0e2e3099ea2ca0ef781aca23b

# ─── Stage 1: install ────────────────────────────────────────────────────────
FROM ${BUN_IMAGE} AS install
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

# ─── Stage 2: verify + build ─────────────────────────────────────────────────
FROM ${BUN_IMAGE} AS build
WORKDIR /app
COPY --from=install /app/node_modules ./node_modules
COPY package.json bun.lock bunfig.toml tsconfig.json biome.json ./
COPY src ./src
COPY config ./config
COPY test ./test
# Bun's bundler does not replace type-checking; both gate the image.
RUN bunx tsc --noEmit
RUN bun test
RUN bun build src/index.ts --target=bun --production --outdir=dist

# ─── Stage 3: runtime ────────────────────────────────────────────────────────
FROM ${BUN_IMAGE} AS runtime
ARG BUILD_VERSION=0.0.0-dev
ARG BUILD_COMMIT=unknown

# The pinned base lags Debian security fixes (e.g. libgnutls30), which the
# CRITICAL Trivy gate rejects, so apply them at build time. This layer depends
# on the build date; the Bun runtime and bundle stay pinned.
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

LABEL org.opencontainers.image.title="jhu-repository-mcp" \
      org.opencontainers.image.description="Read-only federated MCP server for JScholarship (DSpace) and JHRDR (Dataverse)" \
      org.opencontainers.image.source="https://github.com/jhu-library-devops/jh-repositories-mcp" \
      org.opencontainers.image.vendor="Johns Hopkins University Libraries" \
      org.opencontainers.image.version="${BUILD_VERSION}" \
      org.opencontainers.image.revision="${BUILD_COMMIT}"

ENV NODE_ENV=production \
    BUILD_VERSION=${BUILD_VERSION} \
    BUILD_COMMIT=${BUILD_COMMIT} \
    TMPDIR=/tmp

WORKDIR /app
COPY --from=build --chown=bun:bun /app/dist ./dist

USER bun

# Dependency-free liveness probe (no curl in the image; Bun ships fetch).
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD ["bun", "-e", "const r = await fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}/health/live`); if (!r.ok) process.exit(1);"]

EXPOSE 3000

ENTRYPOINT ["bun", "run", "dist/index.js"]
