import { PUBLIC_BUNNY_CDN_BASE } from '$env/static/public';
import { fetchMetadata as fetchBunnyMetadata, saveMetadataToCloud, getCdnUrl, getThumbnailCdnUrl, getCachedMetadata, cacheMetadataLocally } from './bunny';
import type { VideoMeta, VideoSection, MusicalityClip, ClipMeta, PracticeMeta } from './storage';

const OFFLINE_MODE_KEY = 'clipit-offline-mode';

export function isOfflineMode(): boolean {
	if (typeof localStorage === 'undefined') return false;
	return localStorage.getItem(OFFLINE_MODE_KEY) === 'true';
}

export function setOfflineMode(v: boolean) {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(OFFLINE_MODE_KEY, String(v));
}

export type { VideoMeta, VideoSection, MusicalityClip, ClipMeta, PracticeMeta };

type StorageState = 'loading' | 'ready';

let state = $state<StorageState>('loading');
let videos = $state<VideoMeta[]>([]);
let clips = $state<ClipMeta[]>([]);
let practices = $state<PracticeMeta[]>([]);
let musicality = $state<MusicalityClip[]>([]);

export function getState() { return state; }
export function getVideos() { return videos; }
export function getClips() { return clips; }
export function getPractices() { return practices; }
export function getMusicality() { return musicality; }
export function getMusicalityForVideo(videoId: string): MusicalityClip[] {
	return musicality.filter(m => m.videoId === videoId);
}
export function getCdnUrlForVideo(videoId: string): string | null {
	const video = videos.find(v => v.id === videoId);
	if (video?.cdnUrl) return video.cdnUrl;
	return getCdnUrl(videoId);
}

function stripExt(name: string): string {
	return name.replace(/\.mp4$/i, '');
}

// --- Sync hardening: per-section dirty flags + read-merge-write ---
// Prevents one tab from wiping a section it never touched. Each mutation
// flips the flag for the section it changed; on sync we fetch the live
// metadata and only overwrite the sections that are actually dirty,
// leaving everything else as the server has it.
const dirty = {
	videos: false,
	clips: false,
	practices: false,
	musicality: false,
};
function markDirty(...sections: (keyof typeof dirty)[]) {
	for (const s of sections) dirty[s] = true;
}
function markAllDirty() {
	dirty.videos = dirty.clips = dirty.practices = dirty.musicality = true;
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncInFlight: Promise<void> | null = null;
const SYNC_DEBOUNCE_MS = 500;

function syncToBunny() {
	if (syncTimer) clearTimeout(syncTimer);
	syncTimer = setTimeout(() => {
		syncTimer = null;
		// Chain after any in-flight sync so writes are serialized
		syncInFlight = (syncInFlight ?? Promise.resolve()).then(actuallySync, actuallySync);
	}, SYNC_DEBOUNCE_MS);
}

async function actuallySync() {
	// Snapshot which sections were dirty AT TIME OF SYNC, then clear flags so
	// any mutation during the in-flight network call sets a fresh dirty state.
	const wasDirty = { ...dirty };
	dirty.videos = dirty.clips = dirty.practices = dirty.musicality = false;
	if (!wasDirty.videos && !wasDirty.clips && !wasDirty.practices && !wasDirty.musicality) {
		return; // nothing to do
	}
	// In offline mode: snapshot to local cache instead of pushing to Bunny.
	// Mutations persist locally across reloads but won't reach the server until
	// the user toggles back online (where the next sync trigger will push).
	if (isOfflineMode()) {
		try {
			await cacheMetadataLocally({
				videos: videos.map(v => ({ ...v })),
				clips: clips.map(c => ({ ...c })),
				practices: practices.map(p => ({ ...p })),
				musicality: musicality.map(m => ({ ...m })),
			});
			// Re-mark dirty so the next online sync still pushes these edits to Bunny
			if (wasDirty.videos)     dirty.videos     = true;
			if (wasDirty.clips)      dirty.clips      = true;
			if (wasDirty.practices)  dirty.practices  = true;
			if (wasDirty.musicality) dirty.musicality = true;
		} catch (e) {
			console.warn('Offline sync to local cache failed:', e);
		}
		return;
	}
	try {
		// Fetch live so we can preserve sections we didn't touch.
		let live: any;
		try {
			live = await fetchBunnyMetadata();
		} catch (e) {
			console.warn('syncToBunny: live fetch failed, falling back to in-memory snapshot:', e);
			live = {
				videos: videos.map(v => ({ ...v })),
				clips: clips.map(c => ({ ...c })),
				practices: practices.map(p => ({ ...p })),
				musicality: musicality.map(m => ({ ...m })),
			};
		}
		const merged = {
			videos:     wasDirty.videos     ? videos.map(v => ({ ...v }))     : (live.videos     ?? []),
			clips:      wasDirty.clips      ? clips.map(c => ({ ...c }))      : (live.clips      ?? []),
			practices:  wasDirty.practices  ? practices.map(p => ({ ...p }))  : (live.practices  ?? []),
			musicality: wasDirty.musicality ? musicality.map(m => ({ ...m })) : (live.musicality ?? []),
		};
		await saveMetadataToCloud(JSON.stringify(merged, null, 2));
		// Refresh in-memory state for sections we pulled from live, so future
		// dirty edits diff against the latest server data instead of stale memory.
		if (!wasDirty.videos)     videos     = merged.videos;
		if (!wasDirty.clips)      clips      = merged.clips;
		if (!wasDirty.practices)  practices  = merged.practices;
		if (!wasDirty.musicality) musicality = merged.musicality;
	} catch (e) {
		console.error('Bunny metadata sync failed:', e);
		// Restore dirty flags so we'll retry on the next sync trigger
		if (wasDirty.videos)     dirty.videos     = true;
		if (wasDirty.clips)      dirty.clips      = true;
		if (wasDirty.practices)  dirty.practices  = true;
		if (wasDirty.musicality) dirty.musicality = true;
	}
}

function loadMeta(meta: any) {
	videos = (meta.videos ?? []).map((v: VideoMeta) => ({
		...v,
		name: stripExt(v.name),
		fingerprint: v.fingerprint ?? '',
		category: v.category ?? 'demo',
		hidden: v.hidden ?? false,
		hiddenFromSearch: v.hiddenFromSearch ?? false,
	}));
	clips = (meta.clips ?? [])
		.filter((c: ClipMeta) => c.endTime > c.startTime)
		.map((c: ClipMeta) => ({
			...c,
			videoName: stripExt(c.videoName),
			parentClipId: c.parentClipId ?? null,
			links: c.links ?? [],
			hidden: c.hidden ?? false,
			hiddenFromSearch: c.hiddenFromSearch ?? false,
		}));
	practices = (meta.practices ?? []).map((p: PracticeMeta) => ({ ...p }));
	musicality = (meta.musicality ?? []).map((m: MusicalityClip) => ({ ...m }));
}

export async function init() {
	state = 'loading';
	const offline = isOfflineMode();
	try {
		// Offline mode: never touch Bunny. Read from the local Cache API snapshot,
		// fall back to bundled default-metadata.json if there's no snapshot yet.
		if (offline) {
			const cached = await getCachedMetadata();
			if (cached) {
				loadMeta(cached);
			} else {
				const res = await fetch('/default-metadata.json');
				if (res.ok) loadMeta(await res.json());
			}
			return;
		}
		const meta = await fetchBunnyMetadata();
		const hasData = meta.videos?.length > 0 || meta.clips?.length > 0 || meta.practices?.length > 0;
		if (hasData) {
			loadMeta(meta);
		} else {
			// Fallback to default-metadata.json for first launch
			const res = await fetch('/default-metadata.json');
			if (res.ok) {
				const defaultData = await res.json();
				loadMeta(defaultData);
				markAllDirty(); // pushing defaults — overwrite empty server with everything
				syncToBunny();
			}
		}
	} catch (e) {
		console.error('Failed to load from Bunny, trying local cache:', e);
		// Online but Bunny unreachable — try the offline snapshot before giving up
		const cached = await getCachedMetadata();
		if (cached) {
			loadMeta(cached);
		} else {
			try {
				const res = await fetch('/default-metadata.json');
				if (res.ok) loadMeta(await res.json());
			} catch { /* truly offline with no caches, empty state */ }
		}
	} finally {
		state = 'ready';
	}
}

export async function addVideo(_file: File, duration: number, _thumbnailBlob: Blob | null, info: { lead: string; follow: string; dance: string } = { lead: '', follow: '', dance: '' }, fingerprint: string = '') {
	// Check for existing video with same fingerprint
	const existing = fingerprint ? videos.find(v => v.fingerprint === fingerprint) : null;
	const id = existing ? existing.id : crypto.randomUUID();

	if (existing) {
		existing.duration = duration || existing.duration;
		existing.fingerprint = fingerprint;
		videos = videos.map(v => v.id === id ? { ...existing } : v);
		markDirty('videos');
		syncToBunny();
		return existing;
	}

	const video: VideoMeta = {
		id,
		name: stripExt(_file.name),
		fingerprint,
		duration,
		lead: info.lead,
		follow: info.follow,
		dance: info.dance,
		hidden: false,
		hiddenFromSearch: false,
		addedAt: new Date().toISOString(),
	};

	videos = [...videos, video];
	markDirty('videos');
	syncToBunny();
	return video;
}

export async function updateVideo(videoId: string, updates: { name?: string; lead?: string; follow?: string; dance?: string; category?: 'demo' | 'jack-and-jill' | 'workshop' | 'social'; hidden?: boolean; hiddenFromSearch?: boolean; cdnUrl?: string; bpm?: number; sections?: VideoSection[] }) {
	videos = videos.map(v => v.id === videoId ? { ...v, ...updates } : v);
	markDirty('videos');
	if (updates.name !== undefined) {
		clips = clips.map(c => c.videoId === videoId ? { ...c, videoName: updates.name! } : c);
		markDirty('clips');
	}
	syncToBunny();
}

export async function getVideoThumbnail(videoId: string): Promise<string | null> {
	return getThumbnailCdnUrl(videoId);
}

export async function deleteVideo(videoId: string) {
	videos = videos.filter(v => v.id !== videoId);
	clips = clips.filter(c => c.videoId !== videoId);
	musicality = musicality.filter(m => m.videoId !== videoId);
	markDirty('videos', 'clips', 'musicality');
	syncToBunny();
}

export async function renameVideo(videoId: string, newName: string) {
	videos = videos.map(v => v.id === videoId ? { ...v, name: newName } : v);
	clips = clips.map(c => c.videoId === videoId ? { ...c, videoName: newName } : c);
	markDirty('videos', 'clips');
	syncToBunny();
}

export async function getVideoUrl(videoId: string): Promise<{ url: string; revoke: () => void; source: 'local' | 'cdn' }> {
	const cdnUrl = getCdnUrlForVideo(videoId);
	if (cdnUrl) {
		return { url: cdnUrl, revoke: () => {}, source: 'cdn' };
	}
	throw new Error('Video not available via CDN.');
}

export async function addClip(
	input: { videoId: string; videoName: string; label: string; lead: string; follow: string; dance: string; style: string; mastery: string; clipType: string; startTime: number; endTime: number; tags: string[]; parentClipId?: string | null }
) {
	const clip: ClipMeta = {
		id: crypto.randomUUID(),
		videoId: input.videoId,
		videoName: input.videoName,
		label: input.label,
		lead: input.lead,
		follow: input.follow,
		dance: input.dance,
		style: input.style,
		mastery: input.mastery,
		clipType: input.clipType,
		startTime: input.startTime,
		endTime: input.endTime,
		tags: [...input.tags],
		parentClipId: input.parentClipId ?? null,
		links: [],
		hidden: false,
		hiddenFromSearch: false,
		createdAt: new Date().toISOString(),
	};
	clips = [...clips, clip];
	markDirty('clips');
	syncToBunny();
	return clip;
}

export async function updateClip(clipId: string, updates: { label?: string; lead?: string; follow?: string; dance?: string; style?: string; mastery?: string; clipType?: string; tags?: string[]; parentClipId?: string | null; links?: { id: string; type: 'clip' | 'video'; label: string }[]; hidden?: boolean; hiddenFromSearch?: boolean }) {
	clips = clips.map(c => c.id === clipId ? { ...c, ...updates } : c);
	markDirty('clips');
	syncToBunny();
}

export async function deleteClip(clipId: string) {
	clips = clips.filter(c => c.id !== clipId);
	markDirty('clips');
	syncToBunny();
}

export async function exportMetadata(): Promise<string> {
	return JSON.stringify({ videos, clips, practices, musicality }, null, 2);
}

export async function importMetadata(json: string): Promise<void> {
	const imported = JSON.parse(json);
	loadMeta(imported);
	markAllDirty();
	syncToBunny();
}

export async function nukeAll() {
	videos = [];
	clips = [];
	practices = [];
	musicality = [];
	markAllDirty();
	syncToBunny();
}

export function getClipsByVideo(videoId: string): ClipMeta[] {
	return clips.filter(c => c.videoId === videoId);
}

export function getSubClips(clipId: string): ClipMeta[] {
	return clips.filter(c => c.parentClipId === clipId);
}

export function getLinksForClip(clipId: string): { id: string; type: 'clip' | 'video'; label: string }[] {
	const clip = clips.find(c => c.id === clipId);
	return clip?.links ?? [];
}

export async function addLink(clipId: string, targetId: string, targetType: 'clip' | 'video', label: string) {
	clips = clips.map(c => {
		if (c.id === clipId) {
			const links = c.links ?? [];
			if (!links.some(l => l.id === targetId)) {
				return { ...c, links: [...links, { id: targetId, type: targetType, label }] };
			}
		}
		// Bidirectional for clips
		if (targetType === 'clip' && c.id === targetId) {
			const links = c.links ?? [];
			if (!links.some(l => l.id === clipId)) {
				return { ...c, links: [...links, { id: clipId, type: 'clip' as const, label }] };
			}
		}
		return c;
	});
	markDirty('clips');
	syncToBunny();
}

export async function removeLink(clipId: string, targetId: string) {
	clips = clips.map(c => {
		if (c.id === clipId || c.id === targetId) {
			const otherId = c.id === clipId ? targetId : clipId;
			return { ...c, links: (c.links ?? []).filter(l => l.id !== otherId) };
		}
		return c;
	});
	markDirty('clips');
	syncToBunny();
}

// Practices

export async function addPractice(input: { name: string; clipIds: string[]; loop?: boolean }) {
	const practice: PracticeMeta = {
		id: crypto.randomUUID(),
		name: input.name,
		clipIds: [...input.clipIds],
		loop: input.loop ?? false,
		createdAt: new Date().toISOString(),
	};
	practices = [...practices, practice];
	markDirty('practices');
	syncToBunny();
	return practice;
}

export async function updatePractice(practiceId: string, updates: { name?: string; clipIds?: string[]; loop?: boolean }) {
	practices = practices.map(p => p.id === practiceId ? { ...p, ...updates } : p);
	markDirty('practices');
	syncToBunny();
}

export async function deletePractice(practiceId: string) {
	practices = practices.filter(p => p.id !== practiceId);
	markDirty('practices');
	syncToBunny();
}

// Musicality (audio-only practice clips, top-level — independent of video clips)

export async function addMusicalityClip(input: { videoId: string; name?: string; startTime: number; endTime: number; bufferBefore: number; bufferAfter: number; loopCount: number }) {
	const clip: MusicalityClip = {
		id: crypto.randomUUID(),
		videoId: input.videoId,
		name: input.name,
		startTime: input.startTime,
		endTime: input.endTime,
		bufferBefore: input.bufferBefore,
		bufferAfter: input.bufferAfter,
		loopCount: input.loopCount,
	};
	musicality = [...musicality, clip];
	markDirty('musicality');
	syncToBunny();
	return clip;
}

export async function updateMusicalityClip(clipId: string, updates: Partial<Omit<MusicalityClip, 'id' | 'videoId'>>) {
	musicality = musicality.map(m => m.id === clipId ? { ...m, ...updates } : m);
	markDirty('musicality');
	syncToBunny();
}

export async function deleteMusicalityClip(clipId: string) {
	musicality = musicality.filter(m => m.id !== clipId);
	markDirty('musicality');
	syncToBunny();
}

export async function setMusicalityForVideo(videoId: string, clips: MusicalityClip[]) {
	const others = musicality.filter(m => m.videoId !== videoId);
	musicality = [...others, ...clips];
	markDirty('musicality');
	syncToBunny();
}

export async function getVideoBlob(_videoId: string): Promise<Blob> {
	throw new Error('Local video blobs not available in cloud mode');
}

// Stubs for backward compatibility with UI components that reference these
export function getStorageType() { return 'cloud' as const; }
export function getFolderName() { return null; }
export function isVideoLocal() { return false; }
export function getCdnBaseUrl() { return PUBLIC_BUNNY_CDN_BASE; }
export async function pickFolder() { /* no-op */ }
export async function grantPermission() { /* no-op */ }
export async function refresh() {
	// Re-fetch from Bunny
	try {
		const meta = await fetchBunnyMetadata();
		loadMeta(meta);
	} catch (e) {
		console.error('Refresh from Bunny failed:', e);
	}
}
