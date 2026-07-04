# Frontend / Backend Split

This repository is now the backend source of truth for SeeDance runtime behavior and API contracts. The new frontend should live in a separate repository and consume only `/api/v1/*` plus the exported TypeScript contract in `server/contract.ts`.

## Backend responsibilities

- Serve `/api/v1/*` for the new frontend.
- Keep legacy `/api/*` routes working while the current UI is still in use.
- Own task creation, polling, downloads, uploads, local files, manager settings, usage statistics, and provider credentials.
- Own API contract changes. Frontend changes should not require importing files from `server/lib/*`.

## Frontend responsibilities

- Render executor and manager UI.
- Use `createAPIClient` from the contract output or an equivalent copied/generated client.
- Set `VITE_API_BASE_URL` to the backend origin during development.
- Never call legacy `/api/*` endpoints from the new frontend.

## Local split development

Backend:

```bash
cp .env.example .env
# set CORS_ORIGIN to the frontend dev origin, for example:
# CORS_ORIGIN=http://127.0.0.1:5173
npm run dev:backend
```

Frontend:

```bash
VITE_API_BASE_URL=http://127.0.0.1:8787 npm run dev
```

## Contract policy

- New frontend-facing routes must be added under `/api/v1`.
- Keep request/response TypeScript types in `server/contract.ts`.
- Run `npm run contract:check` before handing API changes to the frontend team.
- Keep old `/api/*` routes until the legacy UI is fully retired.

## Deployment shape

Recommended company intranet deployment:

- Frontend static site served by Nginx or another static host.
- `/api/` reverse-proxied to the backend server.
- Backend still keeps legacy static serving enabled as a temporary fallback.

