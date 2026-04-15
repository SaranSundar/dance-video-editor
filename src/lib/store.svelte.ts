import { fetchMetadata as fetchBunnyMetadata, saveMetadataToCloud, getCdnUrl, getThumbnailCdnUrl } from './bunny';
import type { VideoMeta, ClipMeta, PracticeMeta } from './storage';

export type { VideoMeta, ClipMeta, PracticeMeta };

type StorageState = 'loading' | 'ready';

let state = $state<StorageState>('loading');
let videos = $state<VideoMeta[]>([]);
let clips = $state<ClipMeta[]>([]);
let practices = $state<PracticeMeta[]>([]);

export function getState() { return state; }
export function getVideos() { return videos; }
export function getClips() { return clips; }
export function getPractices() { return practices; }
export function getCdnUrlForVideo(videoId: string): string | null {
	const video = videos.find(v => v.id === videoId);
	if (video?.cdnUrl) return video.cdnUrl;
	return getCdnUrl(videoId);
}

function stripExt(name: string): string {
	return name.replace(/\.mp4$/i, '');
}

// Build metadata JSON from in-memory state and save to Bunny
async function syncToBunny() {
	try {
		// Use raw names (already stripped on load, addVideo strips too)
		const meta = {
			videos: videos.map(v => ({ ...v })),
			clips: clips.map(c => ({ ...c })),
			practices: practices.map(p => ({ ...p })),
		};
		await saveMetadataToCloud(JSON.stringify(meta, null, 2));
	} catch (e) {
		console.error('Bunny metadata sync failed:', e);
	}
}

function loadMeta(meta: any) {
	videos = (meta.videos ?? []).map((v: VideoMeta) => ({
		...v,
		name: stripExt(v.name),
		fingerprint: v.fingerprint ?? '',
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
}

export async function init() {
	state = 'loading';
	try {
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
				syncToBunny(); // push defaults to Bunny
			}
		}
	} catch (e) {
		console.error('Failed to load from Bunny:', e);
		try {
			const res = await fetch('/default-metadata.json');
			if (res.ok) loadMeta(await res.json());
		} catch { /* truly offline, empty state */ }
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
	syncToBunny();
	return video;
}

export async function updateVideo(videoId: string, updates: { name?: string; lead?: string; follow?: string; dance?: string; hidden?: boolean; hiddenFromSearch?: boolean; cdnUrl?: string }) {
	videos = videos.map(v => v.id === videoId ? { ...v, ...updates } : v);
	if (updates.name !== undefined) {
		clips = clips.map(c => c.videoId === videoId ? { ...c, videoName: updates.name! } : c);
	}
	syncToBunny();
}

export async function getVideoThumbnail(videoId: string): Promise<string | null> {
	return getThumbnailCdnUrl(videoId);
}

export async function deleteVideo(videoId: string) {
	videos = videos.filter(v => v.id !== videoId);
	clips = clips.filter(c => c.videoId !== videoId);
	syncToBunny();
}

export async function renameVideo(videoId: string, newName: string) {
	videos = videos.map(v => v.id === videoId ? { ...v, name: newName } : v);
	clips = clips.map(c => c.videoId === videoId ? { ...c, videoName: newName } : c);
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
	syncToBunny();
	return clip;
}

export async function updateClip(clipId: string, updates: { label?: string; lead?: string; follow?: string; dance?: string; style?: string; mastery?: string; clipType?: string; tags?: string[]; parentClipId?: string | null; links?: { id: string; type: 'clip' | 'video'; label: string }[]; hidden?: boolean; hiddenFromSearch?: boolean }) {
	clips = clips.map(c => c.id === clipId ? { ...c, ...updates } : c);
	syncToBunny();
}

export async function deleteClip(clipId: string) {
	clips = clips.filter(c => c.id !== clipId);
	syncToBunny();
}

export async function exportMetadata(): Promise<string> {
	return JSON.stringify({ videos, clips, practices }, null, 2);
}

export async function importMetadata(json: string): Promise<void> {
	const imported = JSON.parse(json);
	loadMeta(imported);
	syncToBunny();
}

export async function nukeAll() {
	videos = [];
	clips = [];
	practices = [];
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
	syncToBunny();
	return practice;
}

export async function updatePractice(practiceId: string, updates: { name?: string; clipIds?: string[]; loop?: boolean }) {
	practices = practices.map(p => p.id === practiceId ? { ...p, ...updates } : p);
	syncToBunny();
}

export async function deletePractice(practiceId: string) {
	practices = practices.filter(p => p.id !== practiceId);
	syncToBunny();
}

export async function getVideoBlob(_videoId: string): Promise<Blob> {
	throw new Error('Local video blobs not available in cloud mode');
}

// Stubs for backward compatibility with UI components that reference these
export function getStorageType() { return 'cloud' as const; }
export function getFolderName() { return null; }
export function isVideoLocal() { return false; }
export function getCdnBaseUrl() { return 'https://dance-videos.b-cdn.net'; }
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
