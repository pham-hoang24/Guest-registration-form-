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

# True production entrypoint: consumes PDF jobs from Azure Service Bus
# (requires AZURE_SERVICE_BUS_CONNECTION_STRING). The local/compose stack
# uses QUEUE_PROVIDER=in-process instead (the API generates PDFs inline), so
# docker-compose.yml overrides this command with the retention-only loop —
# see the comment there for why.
CMD ["pnpm", "--filter", "@gr/worker", "exec", "tsx", "src/main.ts"]
