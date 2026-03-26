# ClipIt - Dance Video Clip Editor

A SvelteKit PWA for clipping and organizing dance video moments (bachata, salsa). Clips are metadata-only (timestamps into source videos) - no video duplication. Dual storage: File System Access API on Chrome/Edge, OPFS on Safari/iOS/Firefox.

**Live:** https://dance-video-editor.vercel.app

## Tech Stack

- **SvelteKit 5** with Svelte 5 runes (`$state`, `$derived`, `$effect`, `$bindable`)
- **Static adapter** (`@sveltejs/adapter-static`) with `fallback: 'index.html'` for SPA routing
- **File System Access API** - reads/writes real files on Chrome/Edge/Android Chrome 132+
- **OPFS** (Origin Private File System) - sandboxed storage for Safari/iOS/Firefox (auto-detected)
- **Web Worker** (`opfs-worker.js`) - chunked writes to OPFS via `createSyncAccessHandle()` (required by Safari for large files)
- **ffmpeg.wasm** (`@ffmpeg/ffmpeg` 0.12.x) - on-demand clip extraction for download only
- **Content fingerprinting** - SHA-256 of first 1MB + file size for video deduplication
- **MP4 header parsing** (`mp4-duration.ts`) - extracts duration and codec from moov/mvhd/stsd atoms without video element
- **PWA** - service worker, manifest, offline support, installable on all platforms

## Project Structure

```
src/
  lib/
    storage.ts          # File System Access API storage (Chrome/Edge)
    storage-idb.ts      # OPFS storage (Safari/iOS/Firefox)
    store.svelte.ts     # Reactive Svelte store, auto-detects storage backend
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
    +layout.svelte      # Nav, folder picker gate, export/import, PWA service worker, console panel
    +layout.ts          # SSR disabled, no prerender
    +page.svelte        # Home - filters, clips grid, yt-dlp helper, video import with codec check
    videos/[id]/        # Video editor - player, video metadata editing, clip creation, visibility
    clips/[id]/         # Clip detail - player, all metadata editing, sub-clips, links, visibility
    gallery/            # Gallery with filters (exists but not linked in nav)
static/
  manifest.json         # PWA manifest
  sw.js                 # Service worker (network-first for nav, cache-first for assets)
  opfs-worker.js        # Web Worker for chunked OPFS writes on Safari
  icon-192.svg          # App icon
  icon-512.svg          # App icon
```

## Data Model

**VideoMeta:** id, name, fingerprint, duration, lead, follow, dance, hidden, hiddenFromSearch, addedAt

**ClipMeta:** id, videoId, videoName, label, lead, follow, dance, style, mastery, clipType, startTime, endTime, tags[], parentClipId, links[], hidden, hiddenFromSearch, createdAt

Clips are metadata-only - no separate video files. Playback seeks into the source video.

### Sub-clips and Links
- **Sub-clips**: clips with `parentClipId` pointing to a parent clip. Shown nested under the parent.
- **Links**: bidirectional connections between clips and/or videos. Each link has `{id, type: 'clip'|'video', label}`. Labels: breakdown, variation, tutorial, related.

### Visibility Settings
- `hidden: true` - excluded from home page browse, but findable via search
- `hiddenFromSearch: true` - excluded from both browse and search, only reachable via direct link
- Link picker always shows ALL videos/clips regardless of visibility

### Storage Formats

**File System Access API (Chrome/Edge):**
```
chosen-folder/
  metadata.json         # { videos: VideoMeta[], clips: ClipMeta[] }
  videos/               # Full video files + thumbnails
    {uuid}.mp4
    {uuid}-thumb.jpg
```

**OPFS (Safari/iOS/Firefox):**
```
(origin-private-filesystem)/
  metadata.json         # { videos: VideoMeta[], clips: ClipMeta[] }
  videos/               # Full video files + thumbnails
    {uuid}.mp4
    {uuid}-thumb.jpg
```
- Safari OPFS requires `createSyncAccessHandle()` in a Web Worker for writes
- Small files (< 1MB like metadata.json) try `createWritable()` on main thread first, fall back to worker
- Large files always use the worker with 4MB chunked writes
- Worker has 30s timeout to prevent hanging on stale locks

## Key Behaviors

### Codec Detection
- On import, MP4 files are checked for video codec via `stsd` atom parsing
- Only **H.264** (`avc1`/`avc3`) and **H.265** (`hvc1`/`hev1`) are allowed
- VP9, AV1, VP8 are rejected with an alert explaining how to re-encode
- For downloading: `yt-dlp -f "bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/best"` ensures H.264

### Clip Creation
- Clips are just timestamps + metadata, created instantly (no ffmpeg)
- Video-level fields (lead, follow, dance) inherited at creation time
- Clip-level fields: label, style, mastery, type, moves/tags
- Defaults: style=moderna, mastery=seen, type=pattern

### Video Import
- Multi-video import with per-video metadata and couple presets
- Auto-detects dancers from filename (Unicode NFKD normalization for accent-insensitive matching)
- Skips already-imported videos (by fingerprint match, then filename match)
- Generates thumbnail via canvas on import
- Computes content fingerprint (file size + SHA-256 of first 1MB)

### Storage Auto-Detection
- Checks `window.showDirectoryPicker` on init
- If available: File System Access API with folder picker flow
- If not: OPFS, skips directly to ready state
- `store.getStorageType()` returns `'filesystem' | 'indexeddb'`

### Export/Import
- **Export** is JSON metadata only (no video files) - tiny file
- **Import** reads JSON, merges by fingerprint matching, then ID matching, then adds new entries
- Videos matched by content fingerprint across devices (same video file = same fingerprint)
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
- Blob URLs created from OPFS/filesystem File objects via `URL.createObjectURL()`

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

Uses the Vercel CLI. The project is linked to `saransundars-projects/video-editor` on Vercel with alias `dance-video-editor.vercel.app`.

```bash
# Login (first time only - opens browser)
vercel login

# Always build first, then deploy
npm run build && vercel --prod
```

**Important config:**
- `.npmrc` has `registry=https://registry.npmjs.org/` - required because the default npm wrapper on this machine points to a private registry that Vercel can't access
- `vercel.json` sets `outputDirectory: "build"` and SPA rewrites (excluding `_app/`)
- `svelte.config.js` uses `@sveltejs/adapter-static` with `fallback: 'index.html'` for SPA routing

## Known Couples (Presets)

Anthony & Katie, Cornel & Rithika, Emilien & Tehina, Gero & Migle, Irakli & Maria, Luis & Andrea, Marcus & Bianca, Melvin & Gatica, Miguel & Sunsire, Ofir & Ofri. Favian as extra lead (no fixed partner).

**Couples are defined in 3 files** - update all when adding new ones:
1. `src/routes/+page.svelte` (home page import form + filters)
2. `src/routes/clips/[id]/+page.svelte` (clip edit page)
3. `src/routes/videos/[id]/+page.svelte` (video editor page)

## iPad/iOS Transfer Guide

1. **Laptop**: Export JSON metadata from the app
2. **iPad**: Import the JSON file - creates placeholder video entries with all metadata/clips
3. **iPad**: Add video files via upload area on home page - auto-matches by content fingerprint

## Platform Notes

- **Chrome/Edge desktop + Android Chrome 132+**: Full File System Access API, real files on disk
- **Safari (macOS + iOS) / Firefox**: OPFS storage, no folder picker, "Browser storage" badge in nav
- **iOS PWA**: No native fullscreen API (CSS fallback), no programmatic file input click (label wrapper), separate OPFS from Safari browser
- **Video codecs**: Only H.264 and H.265 are universally supported. VP9 works on Chrome/Android/Firefox but NOT on Safari/iPadOS. AV1 is too new for older devices. Always use H.264 for maximum compatibility.
- **ffmpeg.wasm**: Uses `-ss` before `-i` for fast seeking, `-preset ultrafast` for re-encoding. Only used for on-demand clip download, not clip creation. Requires SharedArrayBuffer (COOP/COEP headers) which are currently disabled.
- **Gallery page** at `/gallery` exists with full filtering but is not linked in nav
