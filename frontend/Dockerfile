FROM node:22-alpine AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

# Build Vite bundle
FROM deps AS build
COPY . .
# Accept build-time env vars for Vite (prefixed VITE_)
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

# Serve with nginx — run as non-root (nginx image provides the 'nginx' user)
FROM nginx:1.27-alpine AS runner
# SPA fallback: all non-file routes serve index.html
RUN printf 'server {\n\
  listen 8080;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
  location / {\n\
    try_files $uri $uri/ /index.html;\n\
  }\n\
}\n' > /etc/nginx/conf.d/default.conf && \
    # Disable default port-80 listener so non-root nginx can bind port 8080
    sed -i '/listen.*80/d' /etc/nginx/nginx.conf || true
COPY --from=build /app/dist /usr/share/nginx/html
RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/log/nginx /etc/nginx/conf.d
USER nginx

EXPOSE 8080
