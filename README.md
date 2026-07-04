# SeeDance Backend Workbench

Node backend plus legacy React UI for SeeDance video and image generation. The backend is the source of truth for task execution, local storage, manager settings, usage statistics, and the `/api/v1` contract used by the separate frontend repository.

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://127.0.0.1:5173`.

For backend-only development:

```bash
npm run dev:backend
```

Set `CORS_ORIGIN` in `.env` when a separate frontend dev server calls the backend directly.

## Credentials

The app keeps credentials on the server only.

- `VOLCENGINE_AK` / `VOLCENGINE_SK`: Assets API signed requests.
- `ARK_API_KEY`: video generation Bearer API key.
- `ARK_VIDEO_MODEL`: defaults to `ep-20260512140336-qdrjq`.
- `IMAGE2_API_KEY`: image generation Bearer API key.
- `CORS_ORIGIN`: optional separate frontend origin, for example `http://127.0.0.1:5173`.

## Flow

1. Create an `AIGC` Asset Group.
2. Create an Asset from a public HTTPS URL. Base64 and localhost URLs are rejected.
3. Poll `GetAsset` until the Asset reaches `Active`.
4. Submit a video task with selected Active assets as `asset://<asset_Id>` references.
5. Poll the video task serially to respect test API concurrency limits.
6. Download successful videos into `data/downloads/`.

## Scripts

```bash
npm test
npm run build
npm run contract:check
npm run server
```

## Frontend split

New frontend work should use `/api/v1/*` only and consume the contract from `server/contract.ts`. See `docs/frontend-backend-split.md`.
