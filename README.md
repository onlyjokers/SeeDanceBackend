# SeeDance Video Workbench

React + Node workspace for the Assets API flow described in `Assets API 参考文档(1).docx`.

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://127.0.0.1:5173`.

## Credentials

The app keeps credentials on the server only.

- `VOLCENGINE_AK` / `VOLCENGINE_SK`: Assets API signed requests.
- `ARK_API_KEY`: video generation Bearer API key.
- `ARK_VIDEO_MODEL`: defaults to `ep-20260512140336-qdrjq`.

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
npm run server
```
