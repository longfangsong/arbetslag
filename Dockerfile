# syntax=docker/dockerfile:1
# ponytail: single stage — telegram-bot runs via tsx at runtime, so the full
# dependency set (tsx, typescript) is needed in the image. No build-tool split.
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# Provision the workspace-pinned pnpm version.
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

# Install first so dependency layers cache independent of source changes.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages packages
COPY apps apps
RUN pnpm install --frozen-lockfile

# Playwright browser for the fetch_web_page tool. install-deps first (it can
# upgrade glibc), then chromium — binaries land in /root/.cache/ms-playwright.
# playwright is a dep of the arbetslag package, so exec from there.
# Cached on the lockfile, independent of source changes.
RUN pnpm --filter arbetslag exec playwright install-deps chromium \
	&& pnpm --filter arbetslag exec playwright install chromium

# Build workspace packages (arbetslag -> dist/) that telegram-bot imports.
RUN pnpm build

EXPOSE 3000

# telegram-bot reads config from env vars at runtime; pass secrets with
# `docker run --env-file .env` (or a registry/secret manager). .env is gitignored.
CMD ["pnpm", "--filter", "telegram-bot", "run", "start"]
