FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
ARG VITE_API_BASE_URL=http://localhost:3000
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN pnpm --filter @gr/web build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
# Run the master process as the existing non-root `nginx` user: drop the
# root-only `user` directive and move the pid file somewhere it can write.
RUN sed -i '/^user /d' /etc/nginx/nginx.conf \
  && sed -i 's#pid\s*/run/nginx.pid;#pid /tmp/nginx.pid;#' /etc/nginx/nginx.conf \
  && touch /tmp/nginx.pid \
  && chown -R nginx:nginx /usr/share/nginx/html /tmp/nginx.pid /var/cache/nginx
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
