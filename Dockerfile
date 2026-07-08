# syntax=docker/dockerfile:1.7
# Multi-stage build:
#   1. web-build  → produces web/dist/ (rust-embed needs this)
#   2. planner    → cargo-chef recipe for cached dep builds
#   3. builder    → cooks deps, copies SPA artifacts, compiles dochub
#   4. runtime    → small Debian image with just the binary
# See: https://github.com/LukeMathWalker/cargo-chef

# ─── Web: build the SPA bundle (needed by dochub-http rust-embed) ─────────
FROM node:22-bookworm-slim AS web-build
WORKDIR /web
# Optional build arg — bakes the doc-editor's collab gateway WS URL
# into the SPA bundle. When unset, the SPA ships in single-container
# mode (no co-edit). Set via `docker build --build-arg
# VITE_DRIVE_COLLAB_BACKEND_URL=ws://localhost:8082` or via the
# corresponding compose `build.args.VITE_DRIVE_COLLAB_BACKEND_URL`
# in docker-compose.coedit.yml.
ARG VITE_DRIVE_COLLAB_BACKEND_URL=""
ENV VITE_DRIVE_COLLAB_BACKEND_URL=${VITE_DRIVE_COLLAB_BACKEND_URL}
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY web/package.json web/pnpm-lock.yaml ./
# The vendored @univerjs/docs-mention-ui is a `file:./vendor/...` dependency, so
# it must be present BEFORE install resolves the lockfile (else ENOENT).
COPY web/vendor/ ./vendor/
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

# ─── Plan: extract a dependency-only recipe so deps cache independently ──
FROM rust:1.90-slim AS chef
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends pkg-config libssl-dev \
 && rm -rf /var/lib/apt/lists/* \
 && cargo install cargo-chef --locked --version 0.1.71

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

# ─── Build: cook deps from cache, then compile our code ───────────────────
FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json
COPY . .
COPY --from=web-build /web/dist ./web/dist
RUN cargo build --release --bin dochub

# ─── Runtime: small image, no toolchain ───────────────────────────────────
FROM debian:trixie-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 1000 --no-create-home --shell /usr/sbin/nologin dochub

COPY --from=builder /app/target/release/dochub /usr/local/bin/dochub

USER dochub
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/dochub"]
