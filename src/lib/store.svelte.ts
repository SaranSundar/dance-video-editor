import * as storage from './storage';
import type { VideoMeta, ClipMeta } from './storage';

export type { VideoMeta, ClipMeta };

type StorageState = 'loading' | 'no-folder' | 'need-permission' | 'ready';

let state = $state<StorageState>('loading');
let folderName = $state<string | null>(null);
let videos = $state<VideoMeta[]>([]);
let clips = $state<ClipMeta[]>([]);

export function getState() { return state; }
export function getFolderName() { return folderName; }
export function getVideos() { return videos; }
export function getClips() { return clips; }

export async function init() {
	state = 'loading';

	const restored = await storage.tryRestoreHandle();
	if (restored) {
		folderName = storage.getFolderName();
		await refresh();
		state = 'ready';
		return;
	}

	const hasHandle = await storage.hasStoredHandle();
	if (hasHandle) {
		state = 'need-permission';
	} else {
		state = 'no-folder';
	}
}

export async function grantPermission() {
	const granted = await storage.requestPermission();
	if (granted) {
		folderName = storage.getFolderName();
		await refresh();
		state = 'ready';
	} else {
		// Permission granted but folder is gone
		state = 'no-folder';
	}
}

export async function pickFolder() {
	await storage.pickFolder();
	folderName = storage.getFolderName();
	await refresh();
	state = 'ready';
}

export async function refresh() {
	videos = await storage.getVideos();
	clips = await storage.getClips();
}

export async function addVideo(file: File, duration: number, thumbnailBlob: Blob | null, info: { lead: string; follow: string; dance: string } = { lead: '', follow: '', dance: '' }) {
	const video = await storage.addVideo(file, duration, thumbnailBlob, info);
	videos = [...videos, video];
	return video;
}

export async function updateVideo(videoId: string, updates: { name?: string; lead?: string; follow?: string; dance?: string }) {
	await storage.updateVideo(videoId, updates);
	videos = videos.map(v => v.id === videoId ? { ...v, ...updates } : v);
	if (updates.name !== undefined) {
		clips = clips.map(c => c.videoId === videoId ? { ...c, videoName: updates.name! } : c);
	}
}

export async function getVideoThumbnail(videoId: string) {
	return storage.getVideoThumbnail(videoId);
}

export async function deleteVideo(videoId: string) {
	await storage.deleteVideo(videoId);
	videos = videos.filter(v => v.id !== videoId);
	clips = clips.filter(c => c.videoId !== videoId);
}

export async function renameVideo(videoId: string, newName: string) {
	await storage.renameVideo(videoId, newName);
	videos = videos.map(v => v.id === videoId ? { ...v, name: newName } : v);
	clips = clips.map(c => c.videoId === videoId ? { ...c, videoName: newName } : c);
}

export async function getVideoBlob(videoId: string) {
	return storage.getVideoBlob(videoId);
}

export async function addClip(
	input: { videoId: string; videoName: string; label: string; lead: string; follow: string; dance: string; style: string; mastery: string; clipType: string; startTime: number; endTime: number; tags: string[] }
) {
	const clip = await storage.addClip(input);
	clips = [...clips, clip];
	return clip;
}

export async function updateClip(clipId: string, updates: { label?: string; lead?: string; follow?: string; dance?: string; style?: string; mastery?: string; clipType?: string; tags?: string[] }) {
	await storage.updateClip(clipId, updates);
	clips = clips.map(c => c.id === clipId ? { ...c, ...updates } : c);
}

export async function deleteClip(clipId: string) {
	await storage.deleteClip(clipId);
	clips = clips.filter(c => c.id !== clipId);
}

export async function exportData() {
	return storage.exportData();
}

export async function importData(zipBlob: Blob) {
	await storage.importData(zipBlob);
	await refresh();
}

export function getClipsByVideo(videoId: string): ClipMeta[] {
	return clips.filter(c => c.videoId === videoId);
}
