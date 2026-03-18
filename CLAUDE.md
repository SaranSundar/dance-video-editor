# ClipIt - Dance Video Clip Editor

A SvelteKit app for clipping and organizing dance video moments (bachata, salsa). Uses the File System Access API for real file storage. Clips are metadata-only (timestamps) - no video duplication.

**Live:** https://dance-video-editor.vercel.app

## Tech Stack

- **SvelteKit 5** with Svelte 5 runes (`$state`, `$derived`, `$effect`, `$bindable`)
- **Vercel adapter** (`@sveltejs/adapter-vercel`) - supports server routes for YouTube download
- **File System Access API** - reads/writes real files to a user-chosen folder
- **ffmpeg.wasm** (`@ffmpeg/ffmpeg` 0.12.x) - on-demand clip extraction for download only
- **IndexedDB** - stores the directory handle for session persistence
- **JSZip** - export/import data backups
- **YouTube innertube API** - server-side video download proxy (pre-muxed MP4, up to 720p)

## Project Structure

```
src/
  lib/
    storage.ts          # File System Access API wrapper (all file I/O)
    store.svelte.ts     # Reactive Svelte store wrapping storage
    ffmpeg.ts           # ffmpeg.wasm wrapper for clip extraction
    moves.ts            # Prepopulated bachata/salsa move lists
    components/
      VideoPlayer.svelte  # Custom video player with timeline, seeking, keyboard shortcuts
      ClipMarker.svelte   # Clip creation form (in/out points + metadata)
      ClipCard.svelte     # Clip display card with inline playback
      Dropdown.svelte     # Custom styled dropdown component
      MultiSelect.svelte  # Searchable multi-select with chips
      TagFilter.svelte    # Search + tag filter bar (used in gallery)
  routes/
    +layout.svelte      # Nav, folder picker gate, export/import
    +layout.ts          # SSR disabled, no prerender
    +page.svelte        # Home - clips grid + YouTube download + video import
    api/youtube/        # Server route - YouTube video download proxy
    videos/[id]/        # Video editor - player + clip creation
    clips/[id]/         # Clip detail - player + metadata editing
    gallery/            # Gallery with filters (still exists, not linked in nav)
```

## Data Model

Stored as `metadata.json` + files in the user's chosen folder:

```
chosen-folder/
  metadata.json         # { videos: VideoMeta[], clips: ClipMeta[] }
  videos/               # Full video files + thumbnails
    {uuid}.mp4
    {uuid}-thumb.jpg
```

**VideoMeta:** id, name, filename, thumbnailFilename, duration, lead, follow, dance, addedAt

**ClipMeta:** id, videoId, videoName, label, lead, follow, dance, style, difficulty, clipType, startTime, endTime, tags[], createdAt (metadata-only, no separate files)

## Key Behaviors

- **Video-level fields** (set at import): lead, follow, dance. Inherited by clips at creation time.
- **Clip-level fields** (set per clip): label, style, difficulty, type, moves/tags
- **Clips are metadata-only** - stored as timestamps, played by seeking into the source video. No separate clip files.
- **On-demand extraction** via ffmpeg.wasm only when user clicks "Download" on a clip
- **Thumbnails** generated on-the-fly via canvas by seeking a hidden video element
- **YouTube download** - paste URL, server route proxies the stream, feeds into import flow
- **Deleting a video** also deletes all its clips (clips depend on the source video)
- **Folder verification** on app load - if the folder is gone, prompts to pick a new one
- **Export** creates a zip of the entire folder; **Import** overwrites the folder from a zip

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
- `vercel.json` sets the COOP/COEP headers needed for SharedArrayBuffer (ffmpeg.wasm)
- `svelte.config.js` uses `@sveltejs/adapter-vercel` for server route support (YouTube download API)

## Known Couples (Presets)

Cornel & Rithika, Emilien & Tehina, Gero & Migle, Irakli & Maria, Luis & Andrea, Marcus & Bianca. Favian as extra lead (no fixed partner).

## Notes

- File System Access API works on Chrome/Edge desktop and Android Chrome 132+. Does not work on Firefox, Safari, or iOS.
- ffmpeg.wasm re-encoding is slow for long clips. The `-ss` before `-i` approach fast-seeks to near the start to minimize decode time.
- The gallery page at `/gallery` still exists with full filtering (dance, style, difficulty, type, tags, search) but is not linked in the nav. Could be re-added or removed.
