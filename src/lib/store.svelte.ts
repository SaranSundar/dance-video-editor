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

export async function init() {
	state = 'loading';

	if (!hasFileSystemAccess()) {
		// Use IndexedDB fallback - skip folder picker entirely
		storageType = 'indexeddb';
		await refresh();
		state = 'ready';
		return;
	}

	storageType = 'filesystem';

	const restored = await fsStorage.tryRestoreHandle();
	if (restored) {
		folderName = fsStorage.getFolderName();
		await refresh();
		state = 'ready';
		return;
	}

	const hasHandle = await fsStorage.hasStoredHandle();
	if (hasHandle) {
		state = 'need-permission';
	} else {
		state = 'no-folder';
	}
}

export async function grantPermission() {
	const granted = await fsStorage.requestPermission();
	if (granted) {
		folderName = fsStorage.getFolderName();
		await refresh();
		state = 'ready';
	} else {
		// Permission granted but folder is gone
		state = 'no-folder';
	}
}

export async function pickFolder() {
	await fsStorage.pickFolder();
	folderName = fsStorage.getFolderName();
	await refresh();
	state = 'ready';
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

export async function updateVideo(videoId: string, updates: { name?: string; lead?: string; follow?: string; dance?: string; hidden?: boolean; hiddenFromSearch?: boolean }) {
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

export async function getVideoUrl(videoId: string): Promise<{ url: string; revoke: () => void }> {
	const blob = await storage().getVideoBlob(videoId);
	const url = URL.createObjectURL(blob);
	return { url, revoke: () => URL.revokeObjectURL(url) };
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
