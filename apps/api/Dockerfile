# Development image for the DevGuard API (docker compose). Not a hardened production image:
# it keeps dev dependencies because the Prisma CLI runs `migrate deploy` at start.
FROM node:22-alpine
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @devguard/api...

COPY packages/config packages/config
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @devguard/shared build && pnpm --filter @devguard/api build

USER node
EXPOSE 3000
CMD ["sh", "-c", "pnpm --filter @devguard/api prisma:deploy && node apps/api/dist/main.js"]
