# syntax=docker/dockerfile:1

# ===== Build stage =====
FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Copy source code
COPY . .

# Build arguments
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG VITE_BASE_PATH=/
ARG GIT_COMMIT=unknown

# Set environment variables for build
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
ENV VITE_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
ENV VITE_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
ENV VITE_BASE_PATH=${VITE_BASE_PATH}

# Build the application
RUN npm run build

# Add git commit hash to build info
RUN echo "Git Commit: ${GIT_COMMIT}" > /app/dist/build-info.txt && \
    echo "Build Date: $(date -u)" >> /app/dist/build-info.txt

# ===== Runtime stage =====
FROM nginx:1.27-alpine

# Add labels for tracking
ARG GIT_COMMIT=unknown
ARG BUILD_DATE
LABEL git.commit=${GIT_COMMIT}
LABEL build.date=${BUILD_DATE}
LABEL maintainer="akshatpareek"

# NGINX config with security headers (HSTS belongs at TLS-terminating proxy)
RUN rm -f /etc/nginx/conf.d/default.conf && \
    printf '%s\n' \
    'server {' \
    '  listen 80;' \
    '  server_name _;' \
    '  root /usr/share/nginx/html;' \
    '  index index.html;' \
    '' \
    '  add_header X-Frame-Options "DENY" always;' \
    '  add_header X-Content-Type-Options "nosniff" always;' \
    '  add_header Referrer-Policy "strict-origin-when-cross-origin" always;' \
    '  add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;' \
    '  add_header Content-Security-Policy "default-src '\''self'\''; base-uri '\''self'\''; frame-ancestors '\''none'\''; object-src '\''none'\''; img-src '\''self'\'' data: https: blob:; script-src '\''self'\''; style-src '\''self'\'' '\''unsafe-inline'\''; font-src '\''self'\'' data:; connect-src '\''self'\'' https://*.supabase.co wss://*.supabase.co https://timeflowstorage.mechlintech.com; form-action '\''self'\''; https://*.supabase.co;" always;' \
    '' \
    '  # Desktop runtime config (publishable key — not shipped inside Electron builds)' \
    '  location = /desktop-config.json {' \
    '    add_header Cache-Control "no-store";' \
    '    add_header Content-Type application/json;' \
    '    try_files $uri =404;' \
    '  }' \
    '' \
    '  # Cache immutable build assets' \
    '  location /assets {' \
    '    try_files $uri =404;' \
    '    add_header Cache-Control "public, max-age=31536000, immutable";' \
    '  }' \
    '' \
    '  # Build info endpoint' \
    '  location /build-info.txt {' \
    '    add_header Content-Type text/plain;' \
    '  }' \
    '' \
    '  # Health check endpoint' \
    '  location /health {' \
    '    access_log off;' \
    '    return 200 "OK";' \
    '    add_header Content-Type text/plain;' \
    '  }' \
    '' \
    '  # SPA fallback' \
    '  location / {' \
    '    try_files $uri $uri/ /index.html;' \
    '  }' \
    '}' \
    > /etc/nginx/conf.d/app.conf

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]