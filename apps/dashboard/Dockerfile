# Development image for the DevGuard dashboard (docker compose): Vite build served by unprivileged nginx, which proxies
# /v1 and /health to the `api` service. Not a hardened production image.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY apps/dashboard/package.json apps/dashboard/
RUN pnpm install --frozen-lockfile --filter @devguard/dashboard...

COPY packages/config packages/config
COPY packages/shared packages/shared
COPY apps/dashboard apps/dashboard
RUN pnpm --filter @devguard/shared build && pnpm --filter @devguard/dashboard build

FROM nginxinc/nginx-unprivileged:alpine
COPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/dashboard/security-headers.inc /etc/nginx/conf.d/security-headers.inc
COPY --from=build /repo/apps/dashboard/dist /usr/share/nginx/html
EXPOSE 8080
