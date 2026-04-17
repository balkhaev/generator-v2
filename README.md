# generator

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines Next.js, Hono, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **Next.js** - Full-stack React framework
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **Hono** - Lightweight, performant server framework
- **Bun** - Runtime environment
- **Drizzle** - TypeScript-first ORM
- **PostgreSQL** - Database engine
- **Authentication** - Better-Auth
- **Turborepo** - Optimized monorepo build system
- **Biome** - Linting and formatting

## Getting Started

First, install the dependencies:

```bash
bun install
```

## Database Setup

This project uses PostgreSQL with Drizzle ORM, Redis for BullMQ queues, and Kafka as the cross-service event bus.

1. Start local infrastructure:

```bash
bun run infra:start
```

2. Make sure your service env files use the local infrastructure URLs:
   `DATABASE_URL=postgresql://postgres:password@localhost:5435/generator`,
   `REDIS_URL=redis://localhost:6381`, and `KAFKA_BROKERS=localhost:9092`.

3. Apply the schema to your database:

```bash
bun run db:push
```

Then, run the development server:

```bash
bun run dev
```

Open [http://localhost:3001](http://localhost:3001) for the admin web app and [http://localhost:3002](http://localhost:3002) for the studio web app.
The admin gateway runs at [http://localhost:3000](http://localhost:3000), the studio backend runs at [http://localhost:3006](http://localhost:3006), and the generator API runs at [http://localhost:3005](http://localhost:3005).

## MCP

The repo now includes project-level MCP configuration so coding agents can attach to the deployed debug server and the Balkhaev Coolify MCP without extra local setup.

- `.mcp.json` exposes the shared `generator-debug` and `balkhaev-coolify` MCP servers for agents that read root MCP config.
- `.vscode/mcp.json` exposes the same servers for VS Code-compatible agent tooling.
- Set `GENERATOR_DEBUG_MCP_TOKEN`, `BALKHAEV_COOLIFY_BASE_URL`, and `BALKHAEV_COOLIFY_ACCESS_TOKEN` in your local environment before starting your agent/editor.

Current endpoints:

```text
https://mcp.gen.balkhaev.com/mcp
https://deploy.balkhaev.com
```

Example:

```bash
export GENERATOR_DEBUG_MCP_TOKEN="your-token-here"
export BALKHAEV_COOLIFY_BASE_URL="https://deploy.balkhaev.com"
export BALKHAEV_COOLIFY_ACCESS_TOKEN="your-token-here"
```

If an MCP auth token is rotated, update the local environment variable value instead of committing secrets into the repo.

## UI Customization

React web apps in this stack share shadcn/ui primitives through `packages/ui`.

- Change design tokens and global styles in `packages/ui/src/styles/globals.css`
- Update shared primitives in `packages/ui/src/components/*`
- Adjust shadcn aliases or style config in `packages/ui/components.json` and `apps/admin-web/components.json`

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components like this:

```tsx
import { Button } from "@generator/ui/components/button";
```

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from `apps/admin-web`.

## Architecture

Architecture rules for package boundaries and cross-app sharing live in
`docs/architecture-rules.md`.

Target service topology and data ownership live in
`docs/target-architecture.md`.

## Git Hooks and Formatting

- Format and lint fix: `bun run check`

## Project Structure

```
generator/
├── apps/
│   ├── admin-web/   # Admin frontend (Next.js)
│   ├── admin/       # Admin gateway + Better Auth (Hono)
│   ├── generator/   # Generation API (Hono)
│   ├── studio/      # Studio backend + Better Auth (Hono)
│   └── studio-web/  # Studio frontend (Next.js)
├── packages/
│   ├── ui/          # Shared shadcn/ui components and styles
│   ├── auth/        # Authentication configuration & logic
│   └── db/          # Database schema & queries
```

## Available Scripts

- `bun run dev`: Start all applications in development mode
- `bun run build`: Build all applications
- `bun run dev:admin-web`: Start only the admin web application
- `bun run dev:admin`: Start only the admin gateway
- `bun run dev:generator`: Start only the generator API
- `bun run dev:studio`: Start only the studio backend
- `bun run dev:studio-web`: Start only the studio web application
- `bun run check-types`: Check TypeScript types across all apps
- `bun run db:push`: Push schema changes to database
- `bun run db:generate`: Generate database client/types
- `bun run db:migrate`: Run database migrations
- `bun run db:studio`: Open database studio UI
- `bun run check`: Run Biome formatting and linting
