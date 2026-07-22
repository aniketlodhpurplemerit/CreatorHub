# CreatorHub

CreatorHub is a full-stack creator economy platform where creators can publish premium content, users can purchase/unlock content, and admins can manage the platform through analytics and moderation tools.

This repository contains:
- A Next.js frontend app with user, creator, admin, wallet, moderation, and support experiences.
- An Express + MongoDB backend API with JWT auth, Socket.IO, Cloudinary uploads, and role-based routes.

## 1) Product Vision

CreatorHub is designed to support a complete creator-to-fan ecosystem:
- Creators publish content, run subscriptions, and track performance.
- Fans discover creators, subscribe, buy content, and interact.
- Admins monitor platform health, revenue, moderation, and support workflows.

## 2) Core Feature Set

### User Features
- Authentication and profile management
- Creator discovery and profile browsing
- Content purchase and wallet flows
- Purchase history and notifications
- Messaging and interactions

### Creator Features
- Creator dashboard and analytics
- Content publishing and post performance
- Subscriber and earnings tracking
- Insights for audience and monetization

### Admin Features
- Platform dashboard and KPIs
- Creator analytics and revenue analytics
- User/admin management
- Platform settings and controls

### Platform/Ops Features
- Moderation module (reports, bans, notifications)
- Support tickets and user support workflows
- Real-time features via Socket.IO

## 3) High-Level Architecture

CreatorHub follows a modular monorepo-style structure with separated frontend and backend apps.

```mermaid
flowchart LR
  U[Web Browser] --> F[Next.js Frontend]
  F -->|HTTP API| B[Express Backend]
  F -->|Realtime| S[Socket.IO Server]
  B --> M[(MongoDB)]
  B --> C[Cloudinary]
  B --> E[SMTP Provider]
  S -. integrated .-> B
```

### 3.1 Container Architecture (Detailed)

```mermaid
flowchart TB
  subgraph Client Side
    BROWSER[Web Browser]
  end

  subgraph Frontend Service
    NEXT[Next.js App Router]
    UI[UI Components and Hooks]
    STORE[Client State
Zustand and React Query]
    SOCKET_CLIENT[Socket.IO Client]
  end

  subgraph Backend Service
    API[Express API]
    MW[Middleware Layer
Auth, Captcha, Feature Toggle]
    CTRL[Controllers Layer]
    RT[Socket.IO Server]
  end

  subgraph Data and External Services
    DB[(MongoDB)]
    MEDIA[Cloudinary]
    MAIL[SMTP Provider]
  end

  BROWSER --> NEXT
  NEXT --> UI
  UI --> STORE
  NEXT -->|REST| API
  SOCKET_CLIENT -->|Realtime Events| RT
  API --> MW --> CTRL
  CTRL --> DB
  CTRL --> MEDIA
  CTRL --> MAIL
  RT --> API
```

### 3.2 Backend Component Diagram

```mermaid
flowchart LR
  R[Routes] --> M[Middleware]
  M --> C[Controllers]
  C --> S[Services and Utils]
  C --> MD[Models]
  MD --> MDB[(MongoDB)]
  S --> CLD[Cloudinary]
  S --> SMTP[SMTP]
  C --> IO[Socket Events]
```

### Runtime Components
- Frontend: Next.js (App Router), React, TypeScript, component-driven UI
- Backend: Node.js, Express, Mongoose, JWT auth, Socket.IO
- Database: MongoDB
- Media: Cloudinary
- Email: SMTP (for auth and communication flows)

## 4) Repository Structure

```text
.
|- backend/
|  |- config/            # DB + socket config
|  |- controllers/       # API business logic by domain
|  |- middleware/        # auth/captcha/feature gating
|  |- models/            # Mongoose models
|  |- routes/            # API route groups
|  |- utils/             # cloudinary, tokens, security settings
|  \- server.js          # API + Socket.IO entrypoint
|
|- frontend/
|  |- app/               # Next.js app router pages
|  |- src/               # shared components, hooks, store, lib
|  |- AdminManagement/   # admin management domain module
|  |- Moderation/        # moderation domain module
|  |- SupportTickets/    # support ticket domain module
|  |- UserSupport/       # user support domain module
|  \- UserWallet/        # wallet domain module
|
\- opencode.json
```

## 5) System Design Overview

### 5.0 Design Principles
- Domain-oriented module boundaries for scalability
- Backend as source of truth for transactional and analytics data
- Stateless API auth via JWT
- Realtime communication over Socket.IO for event-driven UX
- Clear separation between rendering layer, API layer, and persistence layer

### 5.1 API Layer
- REST-style endpoints mounted under `/api/*`.
- Main backend route groups:
  - `/api/auth`
  - `/api/user`
  - `/api/creator`
  - `/api/admin`
  - `/api/livestream`
  - `/api/moderation`
  - `/api/admin-management`
  - `/api/support`
  - `/api/support/user`

### 5.2 Domain Modeling (MongoDB)
- User/Creator identity and role models
- Monetization entities: Wallet, Post, subscription/payment metadata
- Social entities: Comment, Reaction, Message, Notification, Review
- Operational entities: moderation/admin/support models

### 5.3 Realtime Design
- Socket.IO server is attached to the same HTTP server in `backend/server.js`.
- Frontend connects via `NEXT_PUBLIC_SOCKET_URL`.
- Used for realtime communication scenarios (chat/livestream events/notifications depending on route usage).

### 5.4 Security Design
- JWT-based authentication middleware for protected APIs
- Role-based authorization (user/creator/admin)
- Captcha middleware (Turnstile variables supported)
- Centralized token generation and auth interceptors on frontend

### 5.5 Data and Media Flow
- App data is persisted in MongoDB through Mongoose models.
- User-uploaded media is managed via Cloudinary.
- Email actions (verification/reset flows) go through SMTP.

### 5.6 Data Flow Diagram

```mermaid
flowchart LR
  FE[Frontend Request] --> API[API Endpoint]
  API --> AUTH[Auth and Role Check]
  AUTH --> LOGIC[Business Logic]
  LOGIC --> DB[(MongoDB)]
  LOGIC --> CDN[Cloudinary]
  LOGIC --> EMAIL[SMTP]
  DB --> RESP[Response Builder]
  CDN --> RESP
  EMAIL --> RESP
  RESP --> FE
```

### 5.7 Key Domain Workflows
- User purchase flow: browse -> checkout -> wallet transaction -> unlock content
- Creator publishing flow: upload -> metadata persist -> visibility and monetization rules
- Admin analytics flow: aggregate metrics -> transform -> dashboard visualization

## 6) Tech Stack

### Frontend
- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- Axios
- React Query
- Zustand
- React Hook Form + Zod
- Recharts
- Socket.IO client

### Backend
- Node.js
- Express
- Mongoose
- JWT
- Socket.IO
- Cloudinary
- Nodemailer

### Infrastructure/Services
- MongoDB
- Cloudinary
- SMTP provider

## 7) Environment Variables

Create a root `.env` from `.env.example` (preferred). Package-level `backend/.env` and `frontend/.env.local` still work as overrides.

### Backend (root or `backend/.env`)

Required:
- `NEON_DB_URI` (or `DATABASE_URL`) — PostgreSQL / Neon
- `JWT_SECRET`

Common/Recommended:
- `PORT` (default in code: `5002`)
- `FRONTEND_URL` (for CORS and auth links)
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`
- `CONVERSATION_ENCRYPTION_SECRET`
- `TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`

### Frontend (root or `frontend/.env.local`)

Required:
- `NEXT_PUBLIC_API_URL` (example: `http://localhost:5002/api`)
- `NEON_DB_URI` (wallet API routes)
- `JWT_SECRET`

Optional/Common:
- `NEXT_PUBLIC_SOCKET_URL` (example: `http://localhost:5002`)
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`

Additional module-specific values exist in domain modules (moderation/admin-wallet/support), for example:
- `ADMIN_ROLE`
- `BCRYPT_SALT_ROUNDS`
- custom collection names for moderation/support modules

### Docker host ports (Hostinger)

Do not reuse ports already taken by other stacks. CreatorHub defaults:

- Frontend `3030`, API `5030`, Postgres `5434`

## 8) Local Development Setup

### Prerequisites
- Node.js 20+
- npm 10+ **or** pnpm 9+ (both workspaces are supported)
- PostgreSQL (local Docker via `docker compose`, or Neon)

### Install Dependencies

From repository root (hoisted monorepo `node_modules`):

```bash
cp .env.example .env
# edit .env — set JWT_SECRET, NEON_DB_URI / Postgres, Cloudinary, SMTP, etc.

# with npm
npm install

# or with pnpm
pnpm install
```

Start Postgres only (published on host **5434** to avoid clashing with other stacks):

```bash
npm run db:up
# or: pnpm db:up
```

### Run Development Servers

Both apps in parallel from root:

```bash
npm run dev
# or: pnpm dev
```

Or individually:

```bash
npm run dev:backend
npm run dev:frontend
```

Default local URLs:
- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:5002`

Set `NEXT_PUBLIC_API_URL=http://localhost:5002/api` (already in root `.env.example`).

## 9) Build, Production, and Docker (Hostinger)

### Local production (no Docker)

```bash
npm run build
npm run start
# or: pnpm build && pnpm start
```

### Docker Compose (recommended on Hostinger)

Ports are chosen to avoid conflicts with existing containers on the host
(`3000–3002`, `3010`, `3020–3021`, `4000`, `5000`, `5020`, `8000`):

| Service | Host port | Container |
|---------|-----------|-----------|
| Frontend | **3030** | 3000 |
| API | **5030** | 5002 |
| Postgres | **5434** | 5432 |

```bash
cp .env.example .env
# set strong POSTGRES_PASSWORD, JWT_SECRET, Cloudinary, SMTP, FRONTEND_URL, etc.
# For public URLs behind your domain, set NEXT_PUBLIC_API_URL / FRONTEND_URL accordingly.

docker compose up -d --build
# or: npm run compose:up
```

Containers: `creatorhub-frontend`, `creatorhub-api`, `creatorhub-postgres`.

## 10) Seed and Bootstrapping

From repo root:
- `npm run seed` / `pnpm seed`
- `npm run seed:admin` / `pnpm seed:admin`

Use these to bootstrap initial datasets/admin records where required.

## 11) Request/Response Lifecycle (Simplified)

```mermaid
sequenceDiagram
  participant Browser
  participant Next as Next.js Frontend
  participant API as Express API
  participant DB as MongoDB

  Browser->>Next: Navigate / perform action
  Next->>API: Axios request to /api/*
  API->>API: Middleware (auth, validation, role checks)
  API->>DB: Query/update via Mongoose
  DB-->>API: Data result
  API-->>Next: JSON response
  Next-->>Browser: Render updated UI state
```

## 11.1 Workflow Diagrams

### A) User Purchase and Content Unlock Workflow

```mermaid
sequenceDiagram
  participant U as User
  participant FE as Frontend
  participant API as Backend API
  participant WAL as Wallet Model
  participant POST as Post Model

  U->>FE: Click Unlock or Subscribe
  FE->>API: POST purchase request
  API->>API: Validate JWT and role
  API->>WAL: Verify balance or payment credit
  WAL-->>API: Wallet status and transaction result
  API->>POST: Mark entitlement or unlock record
  POST-->>API: Access granted
  API-->>FE: Success response with updated access
  FE-->>U: Premium content available
```

### B) Creator Publish Workflow

```mermaid
sequenceDiagram
  participant C as Creator
  participant FE as Frontend
  participant API as Backend API
  participant CLD as Cloudinary
  participant DB as MongoDB

  C->>FE: Upload media and enter post details
  FE->>API: POST create content request
  API->>CLD: Upload media asset
  CLD-->>API: Media URL and metadata
  API->>DB: Save post and monetization settings
  DB-->>API: Persisted post
  API-->>FE: Post created successfully
  FE-->>C: Show post in creator dashboard
```

### C) Admin Analytics Workflow

```mermaid
sequenceDiagram
  participant A as Admin
  participant FE as Admin Frontend
  participant API as Admin API
  participant DB as MongoDB

  A->>FE: Open analytics dashboard
  FE->>API: GET analytics endpoints
  API->>DB: Fetch creators, wallets, posts, users
  DB-->>API: Raw data sets
  API->>API: Aggregate and transform metrics
  API-->>FE: KPI cards, charts, and table payload
  FE-->>A: Render analytics views
```

## 12) Module Boundaries and Ownership Ideas

The codebase is organized by business domains. This makes it easier to assign ownership:
- Auth/User domain
- Creator domain
- Admin analytics/operations domain
- Moderation and Trust/Safety domain
- Support and ticketing domain
- Wallet/payments domain

Recommended ownership model:
- One maintainer or squad per domain folder
- Shared frontend platform squad for `frontend/src/*`
- Shared backend platform squad for `backend/config`, `backend/middleware`, and security utilities

## 13) Architecture Decisions (Current)

- Monorepo with separate deployment units (`frontend` + `backend`)
- Backend is source of truth for analytics/transactional data
- JWT for stateless auth on API routes
- Socket server colocated with API server for simpler local/early-stage deployment
- Domain modules in frontend include their own MVC-like structures for scalability

## 14) Non-Functional Considerations

### Scalability
- Separate frontend/backend services already enable independent scaling.
- Mongo collections and analytics endpoints should be indexed/optimized as data grows.
- Socket.IO can be moved to a dedicated realtime service when load increases.

### Reliability
- Add centralized error monitoring and request tracing in production.
- Add health endpoints and startup readiness checks.

### Security
- Enforce strong JWT secret in production.
- Restrict CORS to trusted frontend origins.
- Keep Cloudinary/SMTP credentials in secret manager, never commit env files.

### Observability
- Add structured logging and correlation IDs.
- Add metrics for auth failures, API latency, websocket connections, and payment flows.

## 15) Testing and Quality Strategy (Recommended)

Current scripts are focused on lint/build and runtime. For robust quality gates, add:
- Backend unit and integration tests (controllers/routes/middleware)
- Frontend component and page tests
- API contract tests for key endpoints (`/auth`, `/wallet`, `/creator`, `/admin`)
- End-to-end smoke tests for auth, purchase, and dashboard flows

## 16) Deployment Blueprint (Recommended)

- Deploy frontend and backend as separate services.
- Set environment variables per environment (dev/stage/prod).
- Use managed MongoDB.
- Serve media via Cloudinary CDN.
- Configure SMTP and domain-level email sender policies (SPF/DKIM/DMARC).

## 17) Roadmap Ideas

- Payment gateway abstraction for multiple providers
- Event-driven analytics pipeline for heavy dashboard workloads
- Fine-grained role/permission matrix
- Audit logs and admin action trails across all modules
- Multi-tenant support for creator organizations
- Recommendation engine for creator discovery

## 18) Contribution Guide

1. Create a feature branch.
2. Keep changes scoped to a domain/module.
3. Validate local runs for both backend and frontend.
4. Open a pull request with:
   - Problem statement
   - Change summary
   - Screenshots for UI updates
   - Notes on env/config changes

## 19) Troubleshooting

### Frontend cannot reach backend
- Verify backend is running.
- Check `NEXT_PUBLIC_API_URL` points to backend port (default backend here is `5002`).

### Auth seems unstable on client
- Confirm JWT secret consistency in backend env.
- Clear local storage token and re-login.

### Upload issues
- Verify Cloudinary env values are set correctly.

### Email not sending
- Validate SMTP host/port/user/pass and sender configuration.

## 20) Project Naming

Project name for documentation and product identity is set to:

**CreatorHub**
