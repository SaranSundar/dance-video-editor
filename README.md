# ClipIt — Dance Video Clip Editor

SvelteKit PWA for clipping and organizing dance video moments. Clips are
metadata-only (timestamps into source videos) — no video duplication. All
videos, thumbnails, and metadata live on Bunny CDN/Storage.

See [`CLAUDE.md`](./CLAUDE.md) for the full architecture, data model, and
quirks.

## Quick start (local dev)

Requires Node 22.

```bash
nvm use 22
npm install
cp .env.example .env
# Fill in .env with your Bunny credentials (see below)
npm run dev -- --host --port 5180
```

Note: the `/api/bunny` proxy that handles uploads is a Vercel serverless
function. `vite dev` does **not** run it. For local upload testing, run the
app under `vercel dev` instead of `npm run dev`. Reads (browsing existing
content from the CDN) work fine under plain `vite dev`.

## Environment variables

Copy `.env.example` to `.env` and fill in:

| Variable | Where it's used | What it is |
| --- | --- | --- |
| `BUNNY_STORAGE_API_KEY` | Server (`/api/bunny`, scripts) | Bunny Storage Zone password — **secret, never expose to browser** |
| `BUNNY_STORAGE_ZONE` | Server | Storage Zone name (e.g. `my-zone`) |
| `BUNNY_STORAGE_HOST` | Server | Regional storage endpoint. Default `storage.bunnycdn.com`. Override with `la.storage.bunnycdn.com`, `ny.storage.bunnycdn.com`, `sg.storage.bunnycdn.com`, etc. |
| `PUBLIC_BUNNY_CDN_BASE` | Browser + scripts | Pull Zone URL, e.g. `https://my-zone.b-cdn.net`. The `PUBLIC_` prefix is required by SvelteKit so the build inlines it into the client bundle. |

The Vercel serverless function reads its env vars at runtime via
`process.env`. The browser bundle reads `PUBLIC_BUNNY_CDN_BASE` at build
time via `$env/static/public`, so changing it requires a rebuild/redeploy.

## Setting up Bunny

1. Create a Bunny account: https://dash.bunny.net
2. **Create a Storage Zone** (Storage → Add Storage Zone). Pick a region —
   the host you'll use is e.g. `la.storage.bunnycdn.com` for LA. Note the
   zone name → goes in `BUNNY_STORAGE_ZONE`. Copy the password from FTP &
   API Access → goes in `BUNNY_STORAGE_API_KEY`.
3. **Create a Pull Zone** (CDN → Add Pull Zone) linked to that storage
   zone. The Pull Zone hostname (e.g. `https://my-zone.b-cdn.net`) goes in
   `PUBLIC_BUNNY_CDN_BASE`.
4. **Enable CORS on the Pull Zone**: Pull Zone → Headers → enable
   "CORS Wildcard" and add `json` to the list of allowed file extensions
   so `metadata.json` fetches succeed from the browser. Without this the
   app loads but is empty.
5. Optional: upload an initial `metadata.json` to the storage zone so the
   app has something to load. Minimal shape:
   ```json
   { "videos": [], "clips": [], "practices": [] }
   ```
   PUT it to `https://<host>/<zone>/metadata.json` with header
   `AccessKey: <BUNNY_STORAGE_API_KEY>`. Without this, the app falls back
   to `static/default-metadata.json` which points at the original author's
   CDN content — replace or empty it before going live.

## Deploying to Vercel

The app is a static SPA (`@sveltejs/adapter-static` with
`fallback: 'index.html'`) plus one Vercel serverless function at
`/api/bunny` for the CORS-bypassing upload proxy.

### One-time setup

1. Push the repo to GitHub.
2. Go to https://vercel.com → New Project → import the repo.
3. Vercel auto-detects SvelteKit; leave build/output settings as-is.
   `vercel.json` already sets `outputDirectory: "build"` and the SPA
   rewrite rule.
4. Under **Settings → Environment Variables**, add the four vars from
   `.env.example` (`BUNNY_STORAGE_API_KEY`, `BUNNY_STORAGE_ZONE`,
   `BUNNY_STORAGE_HOST`, `PUBLIC_BUNNY_CDN_BASE`) — apply to all three
   environments (Production, Preview, Development).
5. Click Deploy.

Or via CLI:

```bash
npm i -g vercel
vercel link
vercel env add BUNNY_STORAGE_API_KEY      # paste, select all envs
vercel env add BUNNY_STORAGE_ZONE
vercel env add BUNNY_STORAGE_HOST
vercel env add PUBLIC_BUNNY_CDN_BASE
vercel --prod
```

Pull env vars to local `.env` after that with:

```bash
vercel env pull .env
```

### Subsequent deploys

After import, Vercel watches the connected GitHub branch:

```bash
git push origin main   # → triggers production deploy
```

Pushes to other branches create preview deployments at
`https://<branch>--<project>.vercel.app`.

### Important Vercel-side gotchas

- The `/api/bunny` function uploads files up to 700 MB
  (`bodyParser.sizeLimit: '700mb'` in `api/bunny.ts`) and runs for up to
  300s (`maxDuration: 300`). Both require **Vercel Pro** to take effect
  — on the Hobby plan, the limit caps at 4.5 MB body / 60s. If you stay
  on Hobby, use `scripts/upload-to-bunny.mjs` from your machine for big
  uploads instead of the in-app uploader.
- `PUBLIC_*` vars are baked in at build time. After changing
  `PUBLIC_BUNNY_CDN_BASE`, redeploy — `vercel --prod` or push.
- The app is fully client-side; there's no SSR. SvelteKit's static
  adapter prerenders into `build/`, and `api/bunny.ts` runs separately
  as a Node Vercel Function.

## Bulk upload from CLI (optional)

`scripts/upload-to-bunny.mjs` and `scripts/migrate-h265.mjs` PUT directly
to Bunny Storage from Node, skipping the Vercel proxy. Useful for first-
time imports or large batches.

```bash
# Re-encode source MP4s to H.265 with hvc1 tag (Safari-compatible) first:
ffmpeg -i input.mp4 -c:v hevc_videotoolbox -q:v 55 -tag:v hvc1 \
  -c:a aac -b:a 192k -movflags +faststart output.mp4

# Then upload an entire directory of H.265 .mp4 files:
node --env-file=.env scripts/upload-to-bunny.mjs /path/to/videos

# Or migrate existing videos to H.265 (re-uploads + remaps clip videoIds):
node --env-file=.env scripts/migrate-h265.mjs /path/to/h265-videos
```

H.265 must use the `hvc1` tag (not `hev1`) for Safari compatibility — see
the codec section in `CLAUDE.md`.

## Available scripts

```bash
npm run dev          # Vite dev server (no /api/bunny)
npm run build        # Build static SPA into ./build
npm run preview      # Preview the production build
npm run check        # svelte-check type-checking
```

## Tech stack

- SvelteKit 5 + Svelte 5 runes, static adapter (SPA)
- Bunny CDN + Bunny Storage for video/metadata persistence
- ffmpeg.wasm (on-demand clip extraction for downloads only)
- PWA: service worker, manifest, offline-capable

## Live demo

The author's instance: https://dance-video-editor.vercel.app

## Security note when forking

The original `api/bunny.ts` had the storage password hardcoded — anyone
forking from a pre-cleanup commit can read it from git history. **Rotate
the Bunny Storage Zone password** before you trust the new env-var
setup. (Bunny dashboard → Storage Zone → FTP & API Access → Reset
Password.)
