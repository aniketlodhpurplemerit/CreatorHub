# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV CI=true
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

# ---------- API (Express) ----------
FROM base AS api-deps
COPY package.json pnpm-lock.yaml* package-lock.json* pnpm-workspace.yaml .npmrc ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
# Full workspace install: backend loads route modules from frontend/*,
# and those files resolve deps from /app/frontend (not /app/backend).
RUN if [ -f pnpm-lock.yaml ]; then \
      pnpm install --frozen-lockfile ; \
    elif [ -f package-lock.json ]; then \
      npm ci ; \
    else \
      pnpm install ; \
    fi

FROM base AS api
ENV NODE_ENV=production \
    NODE_PATH=/app/node_modules:/app/backend/node_modules:/app/frontend/node_modules
COPY --from=api-deps /app/node_modules ./node_modules
COPY --from=api-deps /app/backend /tmp/backend-pkg
COPY --from=api-deps /app/frontend /tmp/frontend-pkg
RUN mkdir -p backend frontend && \
    if [ -d /tmp/backend-pkg/node_modules ]; then \
      cp -a /tmp/backend-pkg/node_modules backend/node_modules; \
    fi && \
    if [ -d /tmp/frontend-pkg/node_modules ]; then \
      cp -a /tmp/frontend-pkg/node_modules frontend/node_modules; \
    fi && \
    rm -rf /tmp/backend-pkg /tmp/frontend-pkg
COPY package.json pnpm-workspace.yaml .npmrc load-root-env.mjs ./
COPY backend backend/
# Backend requires modular routes from sibling frontend packages
COPY frontend/Moderation frontend/Moderation
COPY frontend/AdminManagement frontend/AdminManagement
COPY frontend/UserSupport frontend/UserSupport
COPY frontend/SupportTickets frontend/SupportTickets
COPY frontend/CreatorSubscription frontend/CreatorSubscription
COPY frontend/UserWallet frontend/UserWallet
COPY frontend/package.json frontend/package.json
WORKDIR /app/backend
EXPOSE 5002
CMD ["node", "server.js"]

# ---------- Frontend (Next.js) ----------
FROM base AS frontend-deps
COPY package.json pnpm-lock.yaml* package-lock.json* pnpm-workspace.yaml .npmrc ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN if [ -f pnpm-lock.yaml ]; then \
      pnpm install --frozen-lockfile --filter frontend... ; \
    elif [ -f package-lock.json ]; then \
      npm ci ; \
    else \
      pnpm install --filter frontend... ; \
    fi

FROM base AS frontend-build
ARG NEXT_PUBLIC_API_URL=http://localhost:5030/api
ARG NEXT_PUBLIC_SOCKET_URL=http://localhost:5030
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_SOCKET_URL=$NEXT_PUBLIC_SOCKET_URL \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY \
    DOCKER_BUILD=1 \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=frontend-deps /app/node_modules ./node_modules
COPY --from=frontend-deps /app/frontend /tmp/frontend-pkg
RUN mkdir -p frontend && \
    if [ -d /tmp/frontend-pkg/node_modules ]; then \
      cp -a /tmp/frontend-pkg/node_modules frontend/node_modules; \
    fi && \
    rm -rf /tmp/frontend-pkg
COPY package.json pnpm-workspace.yaml .npmrc load-root-env.mjs ./
COPY frontend frontend/
# Wallet / moderation models import backend pool helpers at build/runtime
COPY backend/db backend/db
COPY backend/utils backend/utils
COPY backend/package.json backend/package.json
WORKDIR /app/frontend
RUN if [ -f /app/pnpm-lock.yaml ]; then \
      pnpm run build ; \
    else \
      npm run build ; \
    fi

FROM base AS frontend
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=frontend-build /app/frontend/public ./frontend/public
COPY --from=frontend-build /app/frontend/.next/standalone ./
COPY --from=frontend-build /app/frontend/.next/static ./frontend/.next/static
EXPOSE 3000
CMD ["node", "frontend/server.js"]
