# ClipIt - Dance Video Clip Editor

A SvelteKit PWA for clipping and organizing dance video moments (bachata, salsa). Clips are metadata-only (timestamps into source videos) - no video duplication.

**Currently running in cloud-only mode** — all metadata and videos stored on Bunny CDN/Storage. Local storage backends (`storage.ts`, `storage-idb.ts`) are preserved in the codebase for future use but not active.

**Live:** https://dance-video-editor.vercel.app

## Tech Stack

- **SvelteKit 5** with Svelte 5 runes (`$state`, `$derived`, `$effect`, `$bindable`)
- **Static adapter** (`@sveltejs/adapter-static`) with `fallback: 'index.html'` for SPA routing
- **Bunny CDN/Storage** — all videos, thumbnails, and metadata stored globally (see Bunny Storage section)
- **ffmpeg.wasm** (`@ffmpeg/ffmpeg` 0.12.x) - on-demand clip extraction for download only
- **Content fingerprinting** - SHA-256 of first 1MB + file size for video deduplication
- **MP4 header parsing** (`mp4-duration.ts`) - extracts duration and codec from moov/mvhd/stsd atoms without video element
- **PWA** - service worker, manifest, offline support, installable on all platforms

### Preserved but inactive (local storage)
These files are kept in the codebase for potential future re-enablement of local/offline storage:
- **File System Access API** (`storage.ts`) - reads/writes real files on Chrome/Edge
- **OPFS** (`storage-idb.ts`) - sandboxed storage for Safari/iOS/Firefox
- **Web Worker** (`opfs-worker.js`) - chunked writes to OPFS via `createSyncAccessHandle()`

## Bunny Storage (Cloud Backend)

All data flows through Bunny CDN/Storage. The app is personal-use, so the API key is embedded client-side.

**Configuration (`src/lib/bunny.ts`):**
- Storage zone: `dance-videos-ss`
- Storage host: `la.storage.bunnycdn.com`
- CDN base: `https://dance-videos-ss.b-cdn.net`

**What's stored on Bunny:**
```
dance-videos-ss/
  metadata.json         # { videos: VideoMeta[], clips: ClipMeta[], practices: PracticeMeta[] }
  {uuid}.mp4            # Video files (H.265 encoded)
  {uuid}-thumb.jpg      # Thumbnail images
```

**Data flow:**
- **Init**: fetch `metadata.json` from Bunny CDN (`cache: 'no-store'`) → load into memory → ready
- **Every mutation** (add/edit/delete videos, clips, practices, links): update in-memory state → fire-and-forget sync `metadata.json` back to Bunny Storage
- **Video playback**: always CDN URLs, no local blobs
- **Video upload**: files uploaded directly to Bunny Storage from browser (XHR with progress tracking), then `cdnUrl` set on metadata
- **Fallback**: if Bunny fetch fails on init, falls back to `static/default-metadata.json`

**Scripts (`scripts/`):**
- `upload-to-bunny.mjs` — bulk upload videos from a local directory to Bunny Storage
- `migrate-h265.mjs` — re-upload videos as H.265, remap clip videoIds, save updated metadata

## Project Structure

```
src/
  lib/
    bunny.ts            # Bunny CDN/Storage: upload videos/thumbnails, fetch/save metadata
    storage.ts          # [INACTIVE] File System Access API storage (Chrome/Edge)
    storage-idb.ts      # [INACTIVE] OPFS storage (Safari/iOS/Firefox)
    store.svelte.ts     # Reactive Svelte store — cloud-only, in-memory + Bunny sync
    ffmpeg.ts           # ffmpeg.wasm wrapper for on-demand clip extraction
    fingerprint.ts      # Content fingerprinting (file size + SHA-256 of first 1MB)
    mp4-duration.ts     # MP4 header parser for duration + codec detection
    moves.ts            # Prepopulated bachata/salsa move lists
    components/
      VideoPlayer.svelte  # Custom video player with timeline, seeking, keyboard shortcuts, fullscreen
      ClipMarker.svelte   # Clip creation form (in/out points + metadata)
      ClipCard.svelte     # Clip display card with inline playback, loop, fullscreen
      Dropdown.svelte     # Custom styled dropdown component
      MultiSelect.svelte  # Searchable multi-select with chips
      TagFilter.svelte    # Search + tag filter bar
  routes/
    +layout.svelte      # Nav, export/import, PWA service worker, console panel
    +layout.ts          # SSR disabled, no prerender
    +page.svelte        # Home - filters, clips grid, yt-dlp helper, video import with codec check + Bunny upload
    videos/[id]/        # Video editor - player, video metadata editing, clip creation, visibility
    clips/[id]/         # Clip detail - player, all metadata editing, sub-clips, links, visibility
    practice/           # Practice sessions list - create/delete sessions
    practice/[id]/      # Practice session editor - drag-drop clip arrangement, sequential player, type filter
    gallery/            # Gallery with filters (exists but not linked in nav)
    levels/             # Levels page
static/
  default-metadata.json # Fallback metadata (48 H.265 videos, synced with Bunny)
  manifest.json         # PWA manifest
  sw.js                 # Service worker (network-first for nav, cache-first for assets)
  opfs-worker.js        # [INACTIVE] Web Worker for chunked OPFS writes on Safari
  icon-192.svg          # App icon
  icon-512.svg          # App icon
scripts/
  upload-to-bunny.mjs   # Bulk upload videos to Bunny Storage
  migrate-h265.mjs      # H.265 migration + clip remapping script
```

## Data Model

**VideoMeta:** id, name, fingerprint, duration, lead, follow, dance, hidden, hiddenFromSearch, addedAt, cdnUrl

**ClipMeta:** id, videoId, videoName, label, lead, follow, dance, style, mastery, clipType, startTime, endTime, tags[], parentClipId, links[], hidden, hiddenFromSearch, createdAt

**PracticeMeta:** id, name, clipIds[], loop, createdAt

Clips are metadata-only - no separate video files. Playback seeks into the source video via CDN URL.

### Clip Types
move, pattern, styling, footwork, musicality

### Sub-clips and Links
- **Sub-clips**: clips with `parentClipId` pointing to a parent clip. Shown nested under the parent.
- **Links**: bidirectional connections between clips and/or videos. Each link has `{id, type: 'clip'|'video', label}`. Labels: breakdown, variation, tutorial, related.

### Visibility Settings
- `hidden: true` - excluded from home page browse, but findable via search
- `hiddenFromSearch: true` - excluded from both browse and search, only reachable via direct link
- Link picker always shows ALL videos/clips regardless of visibility

### Practice Sessions
- Ordered list of clip IDs that play back-to-back sequentially
- Drag-and-drop reorder (HTML5 drag API + touch swipe for mobile)
- Clip picker with search and type filter dropdown
- Loop toggle for repeating the entire session
- Player auto-advances through clips, shows current position

## Key Behaviors

### Codec Detection
- On import, MP4 files are checked for video codec via `stsd` atom parsing
- Only **H.264** (`avc1`/`avc3`) and **H.265** (`hvc1`/`hev1`) are allowed
- VP9, AV1, VP8 are rejected with an alert explaining how to re-encode
- All videos on Bunny are H.265 encoded

### Clip Creation
- Clips are just timestamps + metadata, created instantly (no ffmpeg)
- Video-level fields (lead, follow, dance) inherited at creation time
- Clip-level fields: label, style, mastery, type, moves/tags
- Defaults: style=moderna, mastery=seen, type=pattern

### Video Import (Cloud Upload)
- Multi-video import with per-video metadata and couple presets
- Auto-detects dancers from filename (Unicode NFKD normalization for accent-insensitive matching)
- Skips already-imported videos (by fingerprint match, then filename match)
- Generates thumbnail via canvas on import
- Computes content fingerprint (file size + SHA-256 of first 1MB)
- **Uploads video to Bunny Storage** with XHR progress tracking
- **Uploads thumbnail to Bunny Storage**
- Sets `cdnUrl` on video metadata, syncs metadata to Bunny

### Export/Import
- **Export** is JSON metadata only (no video files) - tiny file
- **Import** reads JSON and replaces in-memory state, then syncs to Bunny
- **Import button** uses `<label>` wrapping `<input type="file">` (not programmatic `.click()`) for iOS PWA compatibility

### PWA
- Service worker: network-first for navigation, cache-first for `_app/` assets
- Pre-caches `/`, `/opfs-worker.js`, `/manifest.json` on install
- Fullscreen uses CSS fallback (`position: fixed`) in iOS PWA (native fullscreen API disabled in standalone mode)
- "Update" button (PWA only) clears cache and reloads
- Safe area insets for iPadOS notch/status bar
- 44px minimum touch targets on nav buttons
- Console panel (bottom-right button) captures console.log/error/warn for iPad debugging

### Playback
- Click video to play/pause
- Clips play segment from source video (startTime to endTime), loop by default
- Frame-accurate in/out points read directly from `videoEl.currentTime`
- Vertical video handled with `object-fit: contain` + `max-height/max-width: 100vh/100vw` in fullscreen
- Video URLs are always CDN URLs from Bunny

## Keyboard Shortcuts (Video/Clip Player)

- `Space` - play/pause
- `i` / `o` - set in/out points (video editor only)
- `Arrow Left/Right` - seek 1s (hold Shift for 5s)
- `,` / `.` - frame step
- `f` - fullscreen

## Development

```bash
# Requires nvm with Node 22
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 22

npm install
npm run dev -- --host --port 5180
```

## Deploying to Vercel

Deployments are triggered automatically by pushing to GitHub. Vercel is connected to `SaranSundar/dance-video-editor` and deploys `main` to production.

```bash
# Deploy to production
git push origin main
```

**GitHub repo:** https://github.com/SaranSundar/dance-video-editor
**Live:** https://dance-video-editor.vercel.app

**Important config:**
- `vercel.json` sets `outputDirectory: "build"` and SPA rewrites (excluding `_app/`)
- `svelte.config.js` uses `@sveltejs/adapter-static` with `fallback: 'index.html'` for SPA routing

## Known Couples (Presets)

Anthony & Katie, Cornel & Rithika, Emilien & Tehina, Gero & Migle, Irakli & Maria, Luis & Andrea, Marcus & Bianca, Melvin & Gatica, Miguel & Sunsire, Ofir & Ofri. Favian as extra lead (no fixed partner).

**Couples are defined in 3 files** - update all when adding new ones:
1. `src/routes/+page.svelte` (home page import form + filters)
2. `src/routes/clips/[id]/+page.svelte` (clip edit page)
3. `src/routes/videos/[id]/+page.svelte` (video editor page)

## Platform Notes

- **H.265 playback**: works on Safari/Chrome but **not Firefox**. All videos on Bunny are H.265.
- **iOS PWA**: No native fullscreen API (CSS fallback), no programmatic file input click (label wrapper)
- **ffmpeg.wasm**: Uses `-ss` before `-i` for fast seeking, `-preset ultrafast` for re-encoding. Only used for on-demand clip download, not clip creation. Requires SharedArrayBuffer (COOP/COEP headers) which are currently disabled.
- **Gallery page** at `/gallery` exists with full filtering but is not linked in nav

## Re-enabling Local Storage

The local storage backends are preserved in the codebase (`storage.ts`, `storage-idb.ts`, `opfs-worker.js`). To re-enable:
1. Restore `store.svelte.ts` to use `storage()` function that picks between `fsStorage` and `idbStorage`
2. Restore `init()` to detect File System Access API / OPFS
3. Restore folder picker and storage badge in `+layout.svelte`
4. Restore local file writes in `addVideo()` and local blob reads in `getVideoUrl()`
5. Keep Bunny sync as an additional layer (hybrid local + cloud)
