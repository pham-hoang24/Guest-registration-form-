# ponytail: single-stage — the app runs from TS source via tsx (no compiled
# output to discard between stages), so a "build" stage would just duplicate
# this one. The web image below is genuinely multi-stage because its runtime
# (nginx) is a different image than its build toolchain (node).
FROM node:22-alpine

RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @gr/db exec prisma generate

RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

ENV NODE_ENV=production
EXPOSE 3000

# ponytail: migrate-on-start races if you ever run multiple API replicas;
# fine for this single-instance MVP, move to a one-shot migration job first.
CMD ["sh", "-c", "pnpm --filter @gr/db exec prisma migrate deploy && pnpm --filter @gr/api exec tsx src/server.ts"]
