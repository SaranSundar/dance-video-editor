# ClipIt - Dance Video Clip Editor

A SvelteKit PWA for clipping and organizing dance video moments (bachata, salsa). Clips are metadata-only (timestamps into source videos) - no video duplication. Dual storage: File System Access API on Chrome/Edge, IndexedDB fallback on Safari/iOS/Firefox.

**Live:** https://dance-video-editor.vercel.app

## Tech Stack

- **SvelteKit 5** with Svelte 5 runes (`$state`, `$derived`, `$effect`, `$bindable`)
- **Static adapter** (`@sveltejs/adapter-static`) with `fallback: 'index.html'` for SPA routing
- **File System Access API** - reads/writes real files on Chrome/Edge/Android Chrome 132+
- **IndexedDB via Dexie** - fallback storage for Safari/iOS/Firefox (auto-detected)
- **ffmpeg.wasm** (`@ffmpeg/ffmpeg` 0.12.x) - on-demand clip extraction for download only, preloaded on page load
- **JSZip** - batched export (200MB chunks)
- **Custom zip-stream reader** (`zip-stream.ts`) - streaming import that reads one file at a time from zip without loading entire file into memory. Supports STORE and DEFLATE (with zlib wrapper for Safari compatibility)
- **PWA** - service worker, manifest, offline support, installable on all platforms

## Project Structure

```
src/
  lib/
    storage.ts          # File System Access API storage (Chrome/Edge)
    storage-idb.ts      # IndexedDB fallback storage (Safari/iOS/Firefox)
    store.svelte.ts     # Reactive Svelte store, auto-detects storage backend
    ffmpeg.ts           # ffmpeg.wasm wrapper for on-demand clip extraction
    moves.ts            # Prepopulated bachata/salsa move lists
    zip-stream.ts       # Lightweight streaming zip reader (handles Zip64, DEFLATE)
    db.ts               # Dexie setup (used by storage-idb)
    components/
      VideoPlayer.svelte  # Custom video player with timeline, seeking, keyboard shortcuts, fullscreen
      ClipMarker.svelte   # Clip creation form (in/out points + metadata)
      ClipCard.svelte     # Clip display card with inline playback, loop, fullscreen
      Dropdown.svelte     # Custom styled dropdown component
      MultiSelect.svelte  # Searchable multi-select with chips
      TagFilter.svelte    # Search + tag filter bar
  routes/
    +layout.svelte      # Nav, folder picker gate, export/import, PWA service worker, progress bars
    +layout.ts          # SSR disabled, no prerender
    +page.svelte        # Home - filters, clips grid, yt-dlp helper, video import with per-video metadata
    videos/[id]/        # Video editor - player, video metadata editing, clip creation
    clips/[id]/         # Clip detail - player with speed/loop/fullscreen, all metadata editing
    gallery/            # Gallery with filters (exists but not linked in nav)
static/
  manifest.json         # PWA manifest
  sw.js                 # Service worker (network-first for nav, cache-first for assets)
  icon-192.svg          # App icon
  icon-512.svg          # App icon
```

## Data Model

**VideoMeta:** id, name, filename, thumbnailFilename, duration, lead, follow, dance, addedAt

**ClipMeta:** id, videoId, videoName, label, lead, follow, dance, style, mastery, clipType, startTime, endTime, tags[], createdAt

Clips are metadata-only - no separate video files. Playback seeks into the source video.

### Storage Formats

**File System Access API (Chrome/Edge):**
```
chosen-folder/
  metadata.json         # { videos: VideoMeta[], clips: ClipMeta[] }
  videos/               # Full video files + thumbnails
    {uuid}.mp4
    {uuid}-thumb.jpg
```

**IndexedDB (Safari/iOS/Firefox):**
- `videos` table: id, name, blob, thumbnailBlob, duration, lead, follow, dance, addedAt
- `clips` table: id, videoId, videoName, label, lead, follow, dance, style, mastery, clipType, startTime, endTime, tags, createdAt

## Key Behaviors

### Clip Creation
- Clips are just timestamps + metadata, created instantly (no ffmpeg)
- Video-level fields (lead, follow, dance) inherited at creation time
- Clip-level fields: label, style, mastery, type, moves/tags
- Defaults: style=moderna, mastery=seen, type=pattern
- Import defaults: lead=Irakli, follow=Maria, dance=bachata

### Video Import
- Multi-video import with per-video metadata and couple presets
- Auto-detects dancers from filename (fuzzy matching against known couples)
- Skips already-imported videos (by filename match)
- Generates thumbnail via canvas on import

### Storage Auto-Detection
- Checks `window.showDirectoryPicker` on init
- If available: File System Access API with folder picker flow
- If not: IndexedDB, skips directly to ready state
- `store.getStorageType()` returns `'filesystem' | 'indexeddb'`

### Export/Import
- **Export** creates ~200MB batched zips (STORE, no compression - videos are already compressed)
- On iPad: one download per tap (batch banner with "Download part X" button)
- **Import** uses streaming zip reader (`zip-stream.ts`) - reads zip central directory only, then `blob.slice()` for each file. Handles Zip64 and DEFLATE
- Skips failed files instead of aborting (iPad memory limits)
- 2 second pause between video writes for iPad GC
- **JSON import** creates placeholder video entries (empty blob) that match by filename when videos are added later via upload
- **Import button** uses `<label>` wrapping `<input type="file">` (not programmatic `.click()`) for iOS PWA compatibility

### PWA
- Service worker: network-first for navigation, cache-first for `_app/` assets
- ffmpeg.wasm preloaded on page load and cached by service worker
- Fullscreen uses CSS fallback (`position: fixed`) in iOS PWA (native fullscreen API disabled in standalone mode)
- "Update" button (PWA only) clears cache and reloads
- Safe area insets for iPadOS notch/status bar
- 44px minimum touch targets on nav buttons

### Playback
- Click video to play/pause
- Clips play segment from source video (startTime to endTime), loop by default
- Frame-accurate in/out points read directly from `videoEl.currentTime`
- Vertical video handled with `object-fit: contain` + `max-height/max-width: 100vh/100vw` in fullscreen

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

Dev server needs COOP/COEP headers for ffmpeg.wasm (configured in `vite.config.ts`).

## Deploying to Vercel

Uses the Vercel CLI. The project is linked to `saransundars-projects/video-editor` on Vercel with alias `dance-video-editor.vercel.app`.

```bash
# Login (first time only - opens browser)
vercel login

# Always build first, then deploy
npm run build && vercel --prod --yes

# After deploying, update the alias (until project is renamed in Vercel dashboard)
vercel alias set $(vercel ls --json 2>/dev/null | head -1) dance-video-editor.vercel.app
```

To avoid the manual alias step, rename the project to `dance-video-editor` in the Vercel dashboard at https://vercel.com/saransundars-projects/video-editor/settings

**Important config:**
- `.npmrc` has `registry=https://registry.npmjs.org/` - required because the default npm wrapper on this machine points to a private registry that Vercel can't access
- `vercel.json` sets `outputDirectory: "build"`, SPA rewrites (excluding `_app/`), and COOP/COEP headers for SharedArrayBuffer (ffmpeg.wasm)
- `svelte.config.js` uses `@sveltejs/adapter-static` with `fallback: 'index.html'` for SPA routing

## Known Couples (Presets)

Anthony & Katie, Cornel & Rithika, Emilien & Tehina, Gero & Migle, Irakli & Maria, Luis & Andrea, Marcus & Bianca, Melvin & Gatica, Miguel & Sunsire, Ofir & Ofri. Favian as extra lead (no fixed partner).

**Couples are defined in 3 files** - update all when adding new ones:
1. `src/routes/+page.svelte` (home page import form + filters)
2. `src/routes/clips/[id]/+page.svelte` (clip edit page)
3. `src/routes/videos/[id]/+page.svelte` (video editor page)

## iPad/iOS Transfer Guide

Large libraries (3GB+) can't be zipped on iPad. Recommended flow:

1. **Laptop**: Export - downloads metadata JSON + batched zip files
2. **iPad**: Import the JSON file via "JSON" button - creates placeholder video entries with all metadata/clips
3. **iPad**: Add video files one at a time via upload area on home page - auto-matches by filename to existing metadata

## Platform Notes

- **Chrome/Edge desktop + Android Chrome 132+**: Full File System Access API, real files on disk
- **Safari (macOS + iOS) / Firefox**: IndexedDB storage, no folder picker, "Browser storage" badge in nav
- **iOS PWA**: No native fullscreen API (CSS fallback), no programmatic file input click (label wrapper), separate IndexedDB from Safari browser
- **ffmpeg.wasm**: Preloaded on page load. Uses `-ss` before `-i` for fast seeking, `-preset ultrafast` for re-encoding. Only used for on-demand clip download, not clip creation
- **Gallery page** at `/gallery` exists with full filtering but is not linked in nav
