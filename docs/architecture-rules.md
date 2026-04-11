# Architecture Rules

## Roles

- `apps/admin` is the admin gateway.
  It owns authentication, browser-facing admin endpoints, and proxying to internal APIs.
- `apps/generator` is the generation domain API.
  It owns workflows, scenarios, runs, and generation-specific infrastructure.
- `apps/persons` is the persons domain API.
  It owns persons, imported generations, and persons-specific persistence.
- `apps/*-web` and `apps/studio` are delivery surfaces.
  They compose screens and call APIs, but do not define shared transport or contracts.

## Package Boundaries

- `packages/contracts` is the source of truth for cross-app DTOs and serialized API shapes.
  Put types here when they cross an app boundary or are consumed by more than one app.
- `packages/http` owns shared fetch helpers and URL normalization.
  Put generic transport code here, not domain-specific endpoint logic.
- `packages/auth-client` owns the web Better Auth client.
  Web apps must import auth from here instead of creating local clients.
- `packages/ui` owns reusable UI primitives.
  Screens, page composition, and app-specific view models stay in apps.
- `packages/auth` is server-only auth setup.
- `packages/db` and `packages/env` are infrastructure packages.

## Extraction Rules

- If code is used by 2+ apps, move it to `packages/*`.
- If a type describes an HTTP boundary, move it to `packages/contracts` even if there is only one consumer today.
- If code needs `next/headers`, `server-only`, or browser globals, keep the package entrypoint split by runtime.
- Do not create app-to-app imports.
  Apps may depend on packages, never on another app's source files.
- Do not put DB, Hono, or Better Auth server code into web packages.
- Do not put view-specific formatting or component state into `packages/contracts`.

## Runtime Rules

- Browser apps talk to public backends only through shared HTTP helpers.
- Server components and route handlers forward auth headers through `packages/http/server`.
- Browser clients use `packages/http/client` for base URL normalization and JSON requests.
- Shared contracts must use serialized values.
  Dates crossing an app boundary are ISO strings, not `Date` objects.

## Monorepo Rules

- New reusable code starts in the smallest package that matches its boundary.
- Root scripts delegate to package scripts through `turbo run`.
- Each shared package must provide its own `check-types` script.
- Keep packages narrow.
  Prefer `contracts`, `http`, `auth-client` over a single catch-all shared package.
