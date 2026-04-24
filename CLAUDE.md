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
    practice/[id]/      # Practice session editor - drag-drop clip arrangement, sequential player, type filter, fullscreen
    mix/                # Jack & Jill Mix - random-shuffle audio practice player (songs or clips)
    song/               # Song Sections - single-song section editor + sequential looping player
    gallery/            # Gallery with filters (exists but not linked in nav)
    levels/             # Levels page
static/
  default-metadata.json # Fallback metadata (48 H.265 videos, synced with Bunny)
  manifest.json         # PWA manifest
  sw.js                 # Service worker (network-first for nav, cache-first for assets)
  opfs-worker.js        # [INACTIVE] Web Worker for chunked OPFS writes on Safari
  icon-192.svg          # App icon
  icon-512.svg          # App icon
api/
  bunny.ts              # Vercel serverless proxy for Bunny Storage writes (CORS)
scripts/
  upload-to-bunny.mjs   # Bulk upload videos to Bunny Storage
  migrate-h265.mjs      # H.265 migration + clip remapping script
```

## Data Model

**VideoMeta:** id, name, fingerprint, duration, lead, follow, dance, category, hidden, hiddenFromSearch, addedAt, cdnUrl, bpm?, sections?

**VideoSection:** id, name?, startTime, endTime, loopCount — stored inside `VideoMeta.sections[]`, used by `/song` for structured sequential playback.

**ClipMeta:** id, videoId, videoName, label, lead, follow, dance, style, mastery, clipType, startTime, endTime, tags[], parentClipId, links[], hidden, hiddenFromSearch, createdAt

**PracticeMeta:** id, name, clipIds[], loop, createdAt

Clips are metadata-only - no separate video files. Playback seeks into the source video via CDN URL. Sections are also metadata-only, living on `VideoMeta` rather than as top-level entities.

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
- Fullscreen button uses native `requestFullscreen()` with CSS fallback for iOS PWA

### Jack & Jill Mix (`/mix`)

Random-shuffle audio practice tool for training musical adaptation. All state lives in `src/routes/mix/+page.svelte`; settings persist to `localStorage` under `mix-config-v1`.

- **Audio-only playback**: hidden `<audio>` element pointed at existing `.mp4` CDN URLs. Browser decodes just the AAC track, so no video decode CPU — but **bandwidth is the same** as video playback (MP4 interleaves samples). True bandwidth reduction needs a separate `.m4a` extraction per video; not built yet.
- **Pool source**: toggle between Songs (full videos) and Clips (existing `ClipMeta` entries). In Clips mode, each segment is the clip's intrinsic `startTime`→`endTime` — segment duration / variance / start-mode settings are hidden because they don't apply.
- **Filters vs hand-pick**: dance / category / couple chips / clip-type chips, or a multi-select picker over videos or clips. Filter mode respects `hidden` / `hiddenFromSearch`; hand-pick shows everything.
- **Segment timing (songs mode)**: base duration 15–120s (default 20s) with optional variance (±5/10/15s).
- **Start of song mode**: `Trim edges` = random spot but never within N seconds of either end (slider sets N); `From start` = always 0:00; `Random` = anywhere including intro/outro.
- **Same-src seek quirk**: when the shuffle happens to pick the same video twice in a row (e.g. pool of 1), the `<audio>` element's `src` doesn't change, so `loadedmetadata` never fires. `loadNextItem()` detects same-URL and issues the seek directly instead of waiting for the event.
- **Shuffle**: no repeats until pool exhausted, then reset excluding the last-played item to avoid back-to-back dupes.
- **Repeat each N times**: number input (1–20, default 1). When > 1, the same segment replays from the same start offset N times before advancing. Manual Next still skips to the next item regardless of remaining loops.
- **Prev / forward history**: every played item (plus its exact start offset + duration) is pushed to an in-memory history with a cursor. Prev decrements the cursor and replays that entry at its original position; Next after a Prev walks forward through history before falling back to a fresh random pick when at the tip. History resets on `startSession`, does not persist across reloads, and is capped at 100 entries.
- **Non-overlapping re-picks**: when the shuffle happens to choose the same video as what's currently playing (pool of 1 being the common case), the new random start excludes the previous segment's range via `pickStartInWindow()` — picks from the union of `[windowStart, prevStart − dur]` and `[prevEnd, windowEnd − dur]`. Falls back to the opposite end if the song is too short for two non-overlapping segments.
- **Gap between items**: 0/1/3/5s optional silence (not applied between repeats of the same item).
- **Session cap**: optional 5/10/15/30 min auto-end.
- **Warning beep (default off)**: Web Audio API square wave at T-3/2/1 (880/990/1100 Hz, gain 0.6). AudioContext must be recreated if it was closed in `onDestroy` — the variable is reset to `null` there, and `ensureAudioCtx()` checks for `state === 'closed'` before reuse.
- **Seek / speed**: clickable segment progress bar seeks within the current segment; warningsFired is recomputed so only future-window beeps fire after a seek. Speed selector (`0.5× / 0.75× / 1× / 1.25× / 1.5×`) reapplies `playbackRate` every time a new audio source loads, so it persists across songs.

### Song Sections (`/song`)

Per-song structural playback: pick a single song, define a sequence of timed sections, loop each N times before advancing.

- **Storage**: sections live on the video itself (`VideoMeta.sections[]`), so they survive across sessions once set. `VideoMeta.bpm` also stored so the section editor remembers what BPM you used. UI settings (last-picked song, default loops, playback rate) persist to `localStorage` under `song-config-v1`.
- **Auto-distribute**: takes the song duration, computes total 8-counts using the configured BPM (default 130 — typical bachata), and divides them evenly across the requested section count. 8-count length = `(8 × 60) / bpm` seconds.
- **Draggable boundaries**: each inter-section handle is pointer-capture draggable; `setSectionBoundary()` snaps the new time to the nearest 8-count and clamps to adjacent section bounds. Sections always touch — moving a handle resizes the adjacent two, no gaps.
- **Deletion merges**: removing a section extends the previous section to absorb the deleted range (last-section case extends the first).
- **Playback**: plays section.start → section.end, replays `loopCount` times, then advances. Prev steps back a loop (or to the previous section if on loop 1). Speed selector and clickable seek within the current section, same pattern as `/mix`.
- **Same-src quirk applies here too**: because `/song` only touches one audio source, starting playback after a change to the same song seeks directly on the existing element rather than waiting for `loadedmetadata`.

## Key Behaviors

### Codec Detection & H.265 Requirements
- On import, MP4 files are checked for video codec via `stsd` atom parsing
- Only **H.264** (`avc1`/`avc3`) and **H.265** (`hvc1`/`hev1`) are allowed
- VP9, AV1, VP8 are rejected with an alert explaining how to re-encode
- All videos on Bunny are H.265 encoded
- **CRITICAL: H.265 must use `hvc1` tag, not `hev1`** — Safari only plays `hvc1`. Both are valid HEVC but differ in how codec parameters are stored in the MP4 container. `hvc1` puts params in the container header; `hev1` puts them inline with frames.
- `hevc_videotoolbox -tag:v hvc1` (hardware encoder) always produces `hvc1` — use this
- `libx265` (software encoder) defaults to `hev1` — must add `-tag:v hvc1` explicitly
- To fix an existing `hev1` file without re-encoding: `ffmpeg -i input.mp4 -c:v copy -tag:v hvc1 -c:a copy -movflags +faststart output.mp4`

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
- **Uploads video to Bunny Storage** via `/api/bunny` proxy (Vercel serverless function, needed for CORS)
- **Uploads thumbnail to Bunny Storage** via same proxy
- Sets `cdnUrl` on video metadata, syncs metadata to Bunny
- yt-dlp command generates a single command to download + re-encode to H.265 with `hevc_videotoolbox`

### YouTube → Bunny Workflow (end-to-end)

Two paths to go from a YouTube URL to a published, playable video in ClipIt:

**Path A: web UI (normal, single-video)**
1. Paste URL into the YouTube helper on the home page → click Generate → copy the command.
2. The generated command (see `generateYtdlp()` in `src/routes/+page.svelte`) is:
   ```
   yt-dlp -f "bestvideo+bestaudio/best" --merge-output-format mp4 \
     -o "%(title)s.%(ext)s" --restrict-filenames \
     --exec "ffmpeg -i {} -c:v hevc_videotoolbox -q:v 55 -tag:v hvc1 \
       -c:a aac -b:a 192k -movflags +faststart {}.h265.mp4 && rm {}" \
     "<URL>"
   ```
   - `bestvideo+bestaudio/best` downloads highest available video + audio separately and merges into MP4.
   - `hevc_videotoolbox` is the Apple Silicon hardware encoder → produces `hvc1` (Safari-compatible).
   - `-q:v 55` is a quality-based rate (lower = better, ~50–60 is a good sweet spot).
   - `-movflags +faststart` moves the `moov` atom to the start for progressive streaming over CDN.
   - The original merged MP4 is deleted after transcode; only `{title}.mp4.h265.mp4` remains.
   - For playlist URLs (`?list=...`), add `--no-playlist` or the helper will queue the whole playlist.
   - **PO-token / 403 workaround**: YouTube now blocks most formats without a GVS PO token. If yt-dlp errors with `HTTP Error 403: Forbidden` on every fragment, pass `--cookies-from-browser chrome` (or `safari`). Chrome cookies worked here; Safari cookies alone did not. This pulls from your logged-in Chrome profile on disk.
3. Drop the resulting `.h265.mp4` into the import area on the home page.
4. Fill in per-video metadata (couple, dance, category). Category options: `demo`, `jack-and-jill`, `workshop`, `social`.
5. On import the app: computes fingerprint → generates canvas thumbnail → PUTs video + thumbnail to Bunny Storage via `/api/bunny` proxy → sets `cdnUrl` → syncs `metadata.json`.

**Path B: CLI bulk upload (for batches or scripted one-offs)**
1. Download + encode as above, save to a directory.
2. Use `scripts/upload-to-bunny.mjs` as a template — it PUTs direct to `la.storage.bunnycdn.com` with the storage `AccessKey` (bypasses the Vercel proxy, since Node can make cross-origin requests freely).
3. Flow per file: UUID → fingerprint (file size + SHA-256 of first 1MB) → ffprobe duration → PUT `{uuid}.mp4` → append VideoMeta entry.
4. For a single ad-hoc upload, also: extract thumbnail (`ffmpeg -ss <t> -i in.mp4 -vframes 1 -q:v 2 thumb.jpg`), PUT as `{uuid}-thumb.jpg`, then fetch current `metadata.json` from the CDN, append the new entry, PUT it back to storage.

**Metadata update step (either path):**
- `metadata.json` is at `https://dance-videos.b-cdn.net/metadata.json` (read, CORS-enabled pull zone) and `https://la.storage.bunnycdn.com/dance-videos-ss/metadata.json` (write, with `AccessKey` header). Reads from the raw storage zone URL (`dance-videos-ss.b-cdn.net`) return 403 — always use the pull zone (`dance-videos.b-cdn.net`).
- Shape: `{ videos: VideoMeta[], clips: ClipMeta[], practices: PracticeMeta[] }`. Append to `videos[]`; leave other arrays untouched.
- Required VideoMeta fields: `id`, `name`, `fingerprint`, `duration`, `lead`, `follow`, `dance`, `category`, `hidden: false`, `hiddenFromSearch: false`, `addedAt` (ISO), `cdnUrl`.
- Always fetch `metadata.json` with `cache: 'no-store'` (or `?t=<timestamp>` busting) before edit — other clients may have written since.

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
- `vercel.json` sets `outputDirectory: "build"` and SPA rewrites (excluding `_app/` and `api/`)
- `svelte.config.js` uses `@sveltejs/adapter-static` with `fallback: 'index.html'` for SPA routing
- `api/bunny.ts` is a Vercel serverless function (outside SvelteKit, runs on Vercel natively)

## Known Couples (Presets)

Anthony & Katie, Cornel & Rithika, Daniel & Desiree, Emilien & Tehina, Gero & Migle, Irakli & Maria, Jes & Jenny, Luis & Andrea, Marcus & Bianca, Melvin & Gatica, Micka & Laura, Miguel & Sunsire, Ofir & Ofri, Victor & Monika. Favian as extra lead (no fixed partner).

Home page couple profiles are sorted by video count (most videos first). Couples without photos get CSS gradient avatars with initials.

**Couples are defined in 3 files** - update all when adding new ones:
1. `src/routes/+page.svelte` (home page import form + filters)
2. `src/routes/clips/[id]/+page.svelte` (clip edit page)
3. `src/routes/videos/[id]/+page.svelte` (video editor page)

## Platform Notes

- **H.265 playback**: works on Safari/Chrome but **not Firefox**. All videos on Bunny are H.265 with `hvc1` tag.
- **Safari autoplay**: Safari blocks programmatic `play()` outside user gesture context. Practice player uses `autoplay` attribute on `<video>` + `onloadedmetadata` for seeking (matches ClipCard pattern). Don't call `play()` from async callbacks — it will silently fail on Safari.
- **CORS**: Bunny CDN reads go direct (CORS headers enabled on pull zone with `json` in extension list). Bunny Storage writes go through `/api/bunny` Vercel serverless proxy (Storage API doesn't support browser CORS). The pull zone is `dance-videos.b-cdn.net` (NOT `dance-videos-ss.b-cdn.net` which is the raw storage zone URL without CORS).
- **iOS PWA**: No native fullscreen API (CSS fallback), no programmatic file input click (label wrapper)
- **ffmpeg.wasm**: Uses `-ss` before `-i` for fast seeking, `-preset ultrafast` for re-encoding. Only used for on-demand clip download, not clip creation. Requires SharedArrayBuffer (COOP/COEP headers) which are currently disabled.
- **Gallery page** at `/gallery` exists with full filtering but is not linked in nav
- **`<audio>` with MP4 source**: `/mix` points an `HTMLAudioElement` at existing `.mp4` CDN URLs. Browsers decode only the AAC track (no video decode) — saves CPU, not bandwidth. Format is fine on all major browsers.
- **Killing stray Playwright browsers**: MCP Playwright leaves Chrome processes behind. Kill them safely with `pkill -f "playwright_chromiumdev_profile"` — that flag only appears in Playwright-spawned processes, never in the user's real Chrome.
- **UI delete buttons disabled**: every destructive button in the app (delete video / clip / practice session / clip-from-session / link / section, plus clear-all sections) is currently `disabled` with a tooltip explaining why. Underlying store functions (`deleteVideo`, `deleteClip`, `deletePractice`, `removeLink`, `nukeAll`, `updateVideo({sections: ...})`) still exist and work — deletes happen either via Claude session, terminal + direct PUT to `metadata.json`, or by importing a pruned JSON via the home-page Import button. This is a temporary guardrail; remove the `disabled` attributes if re-enabling.

## Re-enabling Local Storage

The local storage backends are preserved in the codebase (`storage.ts`, `storage-idb.ts`, `opfs-worker.js`). To re-enable:
1. Restore `store.svelte.ts` to use `storage()` function that picks between `fsStorage` and `idbStorage`
2. Restore `init()` to detect File System Access API / OPFS
3. Restore folder picker and storage badge in `+layout.svelte`
4. Restore local file writes in `addVideo()` and local blob reads in `getVideoUrl()`
5. Keep Bunny sync as an additional layer (hybrid local + cloud)
