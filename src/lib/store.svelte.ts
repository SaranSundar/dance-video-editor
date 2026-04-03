import * as fsStorage from './storage';
import * as idbStorage from './storage-idb';
import type { VideoMeta, ClipMeta } from './storage';

export type { VideoMeta, ClipMeta };

type StorageType = 'filesystem' | 'indexeddb';
type StorageState = 'loading' | 'no-folder' | 'need-permission' | 'ready';

let storageType = $state<StorageType>('filesystem');
let state = $state<StorageState>('loading');
let folderName = $state<string | null>(null);
let videos = $state<VideoMeta[]>([]);
let clips = $state<ClipMeta[]>([]);
const DEFAULT_CDN_BASE_URL = 'https://dance-videos.b-cdn.net';
let cdnBaseUrl = $state<string>(typeof localStorage !== 'undefined' ? (localStorage.getItem('bunny_cdn_base_url') || DEFAULT_CDN_BASE_URL) : DEFAULT_CDN_BASE_URL);
let localVideoIds = $state<Set<string>>(new Set());

function isAndroidMobile(): boolean {
	return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
}

function hasFileSystemAccess(): boolean {
	return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

// Pick the right storage module based on detected type
function storage() {
	return storageType === 'filesystem' ? fsStorage : idbStorage;
}

export function getStorageType(): StorageType { return storageType; }
export function getState() { return state; }
export function getFolderName() { return folderName; }
export function getVideos() { return videos; }
export function getClips() { return clips; }
export function getCdnBaseUrl() { return cdnBaseUrl; }
export function isVideoLocal(videoId: string) { return localVideoIds.has(videoId); }
export function setCdnBaseUrl(url: string) {
	cdnBaseUrl = url.trim();
	localStorage.setItem('bunny_cdn_base_url', cdnBaseUrl);
}
export function getCdnUrlForVideo(videoId: string): string | null {
	const video = videos.find(v => v.id === videoId);
	if (video?.cdnUrl) return video.cdnUrl;
	if (cdnBaseUrl) return `${cdnBaseUrl.replace(/\/$/, '')}/${videoId}.mp4`;
	return null;
}

async function seedDefaultMetadata() {
	try {
		const res = await fetch('/default-metadata.json');
		if (!res.ok) return;
		const defaultData = await res.json();

		if (videos.length === 0) {
			// First launch: seed everything
			await storage().importMetadata(JSON.stringify(defaultData));
			await refresh();
			return;
		}

		// Already have data: only backfill missing cdnUrls (don't overwrite user data)
		const missing = videos.filter(v => !v.cdnUrl);
		if (missing.length === 0) return;

		const defaultById = new Map<string, string>(
			defaultData.videos
				.filter((v: { id: string; cdnUrl?: string }) => v.cdnUrl)
				.map((v: { id: string; cdnUrl: string }) => [v.id, v.cdnUrl])
		);

		let updated = false;
		for (const v of missing) {
			const cdnUrl = defaultById.get(v.id);
			if (cdnUrl) {
				await storage().updateVideo(v.id, { cdnUrl });
				updated = true;
			}
		}
		if (updated) await refresh();
	} catch { /* ignore */ }
}

async function checkLocalAvailability() {
	const ids = new Set<string>();
	await Promise.allSettled(
		videos.map(async v => {
			try {
				await storage().getVideoBlob(v.id);
				ids.add(v.id);
			} catch { /* not local */ }
		})
	);
	localVideoIds = ids;
}

export async function init() {
	state = 'loading';

	if (!hasFileSystemAccess()) {
		storageType = 'indexeddb';
		await refresh();
		await seedDefaultMetadata();
		state = 'ready';
		checkLocalAvailability();
		return;
	}

	storageType = 'filesystem';

	const restored = await fsStorage.tryRestoreHandle();
	if (restored) {
		folderName = fsStorage.getFolderName();
		await refresh();
		await seedDefaultMetadata();
		state = 'ready';
		checkLocalAvailability();
		return;
	}

	// No folder available — fall back to OPFS so CDN content loads immediately
	// without blocking on folder selection. storageType switches to 'filesystem'
	// when the user picks a folder (e.g. on first video upload).
	storageType = 'indexeddb';
	await refresh();
	await seedDefaultMetadata();
	state = 'ready';
	checkLocalAvailability();
}

export async function grantPermission() {
	try {
		const granted = await fsStorage.requestPermission();
		if (granted) {
			storageType = 'filesystem';
			folderName = fsStorage.getFolderName();
			await refresh();
			await seedDefaultMetadata();
			state = 'ready';
			checkLocalAvailability();
		} else {
			// requestPermission returned false (e.g. Android stale handle) — re-pick
			state = 'no-folder';
		}
	} catch {
		// handle.requestPermission() can throw on Android Chrome with stale handles
		state = 'no-folder';
	}
}

export async function pickFolder() {
	await fsStorage.pickFolder();
	storageType = 'filesystem';
	folderName = fsStorage.getFolderName();
	await refresh();
	await seedDefaultMetadata();
	state = 'ready';
	checkLocalAvailability();
}

function stripExt(name: string): string {
	return name.replace(/\.mp4$/i, '');
}

export async function refresh() {
	const allVideos = await storage().getVideos();
	const allClips = await storage().getClips();
	videos = allVideos.map(v => ({ ...v, name: stripExt(v.name) }));
	clips = allClips.filter(c => c.endTime > c.startTime).map(c => ({ ...c, videoName: stripExt(c.videoName) }));
}

export async function addVideo(file: File, duration: number, thumbnailBlob: Blob | null, info: { lead: string; follow: string; dance: string } = { lead: '', follow: '', dance: '' }, fingerprint: string = '') {
	const video = await storage().addVideo(file, duration, thumbnailBlob, info, fingerprint);
	const existingIdx = videos.findIndex(v => v.id === video.id);
	if (existingIdx >= 0) {
		videos = videos.map(v => v.id === video.id ? video : v);
	} else {
		videos = [...videos, video];
	}
	return video;
}

export async function updateVideo(videoId: string, updates: { name?: string; lead?: string; follow?: string; dance?: string; hidden?: boolean; hiddenFromSearch?: boolean; cdnUrl?: string }) {
	await storage().updateVideo(videoId, updates);
	videos = videos.map(v => v.id === videoId ? { ...v, ...updates } : v);
	if (updates.name !== undefined) {
		clips = clips.map(c => c.videoId === videoId ? { ...c, videoName: updates.name! } : c);
	}
}

export async function getVideoThumbnail(videoId: string) {
	return storage().getVideoThumbnail(videoId);
}

export async function deleteVideo(videoId: string) {
	await storage().deleteVideo(videoId);
	videos = videos.filter(v => v.id !== videoId);
	clips = clips.filter(c => c.videoId !== videoId);
}

export async function renameVideo(videoId: string, newName: string) {
	await storage().renameVideo(videoId, newName);
	videos = videos.map(v => v.id === videoId ? { ...v, name: newName } : v);
	clips = clips.map(c => c.videoId === videoId ? { ...c, videoName: newName } : c);
}

export async function getVideoBlob(videoId: string) {
	return storage().getVideoBlob(videoId);
}

export async function getVideoUrl(videoId: string): Promise<{ url: string; revoke: () => void; source: 'local' | 'cdn' }> {
	// Try local file first
	try {
		const blob = await storage().getVideoBlob(videoId);
		const url = URL.createObjectURL(blob);
		return { url, revoke: () => URL.revokeObjectURL(url), source: 'local' };
	} catch {
		// Fall back to CDN URL
		const cdnUrl = getCdnUrlForVideo(videoId);
		if (cdnUrl) {
			return { url: cdnUrl, revoke: () => {}, source: 'cdn' };
		}
		throw new Error('Video not available locally or via CDN. Upload to Bunny or import the file.');
	}
}

export async function addClip(
	input: { videoId: string; videoName: string; label: string; lead: string; follow: string; dance: string; style: string; mastery: string; clipType: string; startTime: number; endTime: number; tags: string[]; parentClipId?: string | null }
) {
	const clip = await storage().addClip(input);
	clips = [...clips, clip];
	return clip;
}

export async function updateClip(clipId: string, updates: { label?: string; lead?: string; follow?: string; dance?: string; style?: string; mastery?: string; clipType?: string; tags?: string[]; parentClipId?: string | null; links?: { id: string; type: 'clip' | 'video'; label: string }[]; hidden?: boolean; hiddenFromSearch?: boolean }) {
	await storage().updateClip(clipId, updates);
	clips = clips.map(c => c.id === clipId ? { ...c, ...updates } : c);
}

export async function deleteClip(clipId: string) {
	await storage().deleteClip(clipId);
	clips = clips.filter(c => c.id !== clipId);
}

export async function exportMetadata(): Promise<string> {
	return storage().exportMetadata();
}

export async function importMetadata(json: string): Promise<void> {
	await storage().importMetadata(json);
	await refresh();
}

export async function nukeAll() {
	await storage().nukeAll();
	await refresh();
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
	await storage().addLink(clipId, targetId, targetType, label);
	// Refresh in-memory state
	const allClips = await storage().getClips();
	clips = allClips.filter(c => c.endTime > c.startTime);
}

export async function removeLink(clipId: string, targetId: string) {
	await storage().removeLink(clipId, targetId);
	// Refresh in-memory state
	const allClips = await storage().getClips();
	clips = allClips.filter(c => c.endTime > c.startTime);
}
