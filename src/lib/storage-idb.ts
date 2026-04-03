// OPFS-based storage backend for Safari/iOS/Firefox
// Uses Origin Private File System - same API as File System Access but sandboxed
// Structure: metadata.json + videos/{id}.mp4 + videos/{id}-thumb.jpg

import type { VideoMeta, ClipMeta, Metadata } from './storage';
export type { VideoMeta, ClipMeta, Metadata };

let dirHandle: FileSystemDirectoryHandle | null = null;

// Metadata cache
let metaCache: Metadata | null = null;
let metaCacheTime = 0;

async function getCachedMetadata(): Promise<Metadata> {
	const now = Date.now();
	if (metaCache && now - metaCacheTime < 5000) return metaCache;
	metaCache = await readMetadata();
	metaCacheTime = now;
	return metaCache;
}

async function init(): Promise<void> {
	dirHandle = await navigator.storage.getDirectory();
	await ensureStructure();
}

async function getDir(): Promise<FileSystemDirectoryHandle> {
	if (!dirHandle) await init();
	return dirHandle!;
}

async function ensureStructure(): Promise<void> {
	const root = await getDir();
	await root.getDirectoryHandle('videos', { create: true });
	try {
		await root.getFileHandle('metadata.json');
	} catch {
		await saveMetadata({ videos: [], clips: [] });
	}
}

async function readMetadata(): Promise<Metadata> {
	const root = await getDir();
	try {
		const fileHandle = await root.getFileHandle('metadata.json');
		const file = await fileHandle.getFile();
		const text = await file.text();
		if (!text || text.trim().length === 0) {
			return { videos: [], clips: [] };
		}
		return JSON.parse(text);
	} catch {
		return { videos: [], clips: [] };
	}
}

let opfsWorker: Worker | null = null;

function getWorker(): Worker {
	if (!opfsWorker) {
		opfsWorker = new Worker('/opfs-worker.js');
	}
	return opfsWorker;
}

function workerWriteFile(dirPath: string, fileName: string, file: Blob): Promise<void> {
	return new Promise((resolve, reject) => {
		const worker = getWorker();
		const timeout = setTimeout(() => {
			worker.removeEventListener('message', handler);
			reject(new Error(`OPFS write timed out: ${dirPath}/${fileName}`));
		}, 30000);

		function handler(e: MessageEvent) {
			if (e.data.action === 'done') {
				clearTimeout(timeout);
				worker.removeEventListener('message', handler);
				resolve();
			} else if (e.data.action === 'error') {
				clearTimeout(timeout);
				worker.removeEventListener('message', handler);
				reject(new Error(e.data.error));
			}
		}

		worker.addEventListener('message', handler);
		worker.postMessage({ action: 'write', dirPath, path: fileName, file });
	});
}

const isSafari = typeof navigator !== 'undefined' &&
	/^((?!chrome|android).)*safari/i.test(navigator.userAgent);

async function writeToPath(dirPath: string, name: string, data: string | Blob): Promise<void> {
	const blob = typeof data === 'string' ? new Blob([data]) : data;

	if (isSafari) {
		// Small files (metadata): try main-thread write first, fall back to worker
		// Large files (videos): always use worker for chunked writing
		if (blob.size < 1024 * 1024) {
			try {
				const root = await navigator.storage.getDirectory();
				let dir = root;
				for (const part of dirPath.split('/').filter(Boolean)) {
					dir = await dir.getDirectoryHandle(part, { create: true });
				}
				const fileHandle = await dir.getFileHandle(name, { create: true });
				const writable = await (fileHandle as any).createWritable();
				await writable.write(blob);
				await writable.close();
				return;
			} catch {
				// createWritable not supported on this Safari version, use worker
			}
		}
		await workerWriteFile(dirPath, name, blob);
	} else {
		const root = await navigator.storage.getDirectory();
		let dir = root;
		for (const part of dirPath.split('/').filter(Boolean)) {
			dir = await dir.getDirectoryHandle(part, { create: true });
		}
		const fileHandle = await dir.getFileHandle(name, { create: true });
		const writable = await (fileHandle as any).createWritable();
		await writable.write(blob);
		await writable.close();
	}
}

async function saveMetadata(meta: Metadata): Promise<void> {
	await writeToPath('', 'metadata.json', JSON.stringify(meta, null, 2));
	metaCache = meta;
	metaCacheTime = Date.now();
}

// Videos

export async function getVideos(): Promise<VideoMeta[]> {
	const meta = await readMetadata();
	return meta.videos.map(v => ({
		...v,
		fingerprint: v.fingerprint ?? '',
		hidden: v.hidden ?? false,
		hiddenFromSearch: v.hiddenFromSearch ?? false
	}));
}

export async function addVideo(
	file: File,
	duration: number,
	thumbnailBlob: Blob | null,
	info: { lead: string; follow: string; dance: string },
	fingerprint: string = ''
): Promise<VideoMeta> {
	const root = await getDir();
	const meta = await readMetadata();

	// Check for existing video with same fingerprint
	const existing = fingerprint ? meta.videos.find(v => v.fingerprint === fingerprint) : null;
	const existingByName = !existing ? meta.videos.find(v => v.name === file.name) : null;
	const match = existing || existingByName;

	const id = match ? match.id : crypto.randomUUID();

	await writeToPath('videos', `${id}.mp4`, file);

	if (thumbnailBlob) {
		await writeToPath('videos', `${id}-thumb.jpg`, thumbnailBlob);
	}

	if (match) {
		match.name = file.name;
		match.duration = duration || match.duration;
		match.fingerprint = fingerprint || match.fingerprint;
		await saveMetadata(meta);
		return match;
	}

	const videoMeta: VideoMeta = {
		id,
		name: file.name,
		fingerprint,
		duration,
		lead: info.lead,
		follow: info.follow,
		dance: info.dance,
		addedAt: new Date().toISOString()
	};

	meta.videos.push(videoMeta);
	await saveMetadata(meta);
	return videoMeta;
}

export async function getVideoBlob(videoId: string): Promise<Blob> {
	const root = await getDir();
	const videosDir = await root.getDirectoryHandle('videos');
	for (const ext of ['mp4', 'webm', 'mov']) {
		try {
			const fileHandle = await videosDir.getFileHandle(`${videoId}.${ext}`);
			return await fileHandle.getFile();
		} catch { /* try next */ }
	}
	throw new Error('Video file not found');
}

export async function getVideoThumbnail(videoId: string): Promise<Blob | null> {
	const root = await getDir();
	const videosDir = await root.getDirectoryHandle('videos');
	try {
		const fileHandle = await videosDir.getFileHandle(`${videoId}-thumb.jpg`);
		return await fileHandle.getFile();
	} catch {
		return null;
	}
}

export async function deleteVideo(videoId: string): Promise<void> {
	const root = await getDir();
	const meta = await readMetadata();

	const videosDir = await root.getDirectoryHandle('videos');
	for (const ext of ['mp4', 'webm', 'mov']) {
		try { await videosDir.removeEntry(`${videoId}.${ext}`); } catch { /* skip */ }
	}
	try { await videosDir.removeEntry(`${videoId}-thumb.jpg`); } catch { /* skip */ }

	meta.clips = meta.clips.filter(c => c.videoId !== videoId);
	meta.videos = meta.videos.filter(v => v.id !== videoId);
	await saveMetadata(meta);
}

export async function updateVideo(
	videoId: string,
	updates: { name?: string; lead?: string; follow?: string; dance?: string; hidden?: boolean; hiddenFromSearch?: boolean; cdnUrl?: string }
): Promise<void> {
	const meta = await readMetadata();
	const video = meta.videos.find(v => v.id === videoId);
	if (!video) return;
	if (updates.name !== undefined) video.name = updates.name;
	if (updates.lead !== undefined) video.lead = updates.lead;
	if (updates.follow !== undefined) video.follow = updates.follow;
	if (updates.dance !== undefined) video.dance = updates.dance;
	if (updates.hidden !== undefined) video.hidden = updates.hidden;
	if (updates.hiddenFromSearch !== undefined) video.hiddenFromSearch = updates.hiddenFromSearch;
	if (updates.cdnUrl !== undefined) video.cdnUrl = updates.cdnUrl || undefined;
	if (updates.name !== undefined) {
		for (const clip of meta.clips) {
			if (clip.videoId === videoId) clip.videoName = updates.name;
		}
	}
	await saveMetadata(meta);
}

export async function renameVideo(videoId: string, newName: string): Promise<void> {
	await updateVideo(videoId, { name: newName });
}

// Clips

export async function getClips(): Promise<ClipMeta[]> {
	const meta = await readMetadata();
	return meta.clips.map(c => ({
		...c,
		parentClipId: c.parentClipId ?? null,
		links: c.links ?? [],
		hidden: c.hidden ?? false,
		hiddenFromSearch: c.hiddenFromSearch ?? false
	}));
}

export async function getClipsByVideo(videoId: string): Promise<ClipMeta[]> {
	const meta = await readMetadata();
	return meta.clips
		.filter(c => c.videoId === videoId)
		.map(c => ({ ...c, parentClipId: c.parentClipId ?? null, links: c.links ?? [], hidden: c.hidden ?? false, hiddenFromSearch: c.hiddenFromSearch ?? false }));
}

export async function addClip(
	input: { videoId: string; videoName: string; label: string; lead: string; follow: string; dance: string; style: string; mastery: string; clipType: string; startTime: number; endTime: number; tags: string[]; parentClipId?: string | null }
): Promise<ClipMeta> {
	const id = crypto.randomUUID();
	const clipMeta: ClipMeta = {
		id,
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
		createdAt: new Date().toISOString()
	};
	const meta = await readMetadata();
	meta.clips.push(clipMeta);
	await saveMetadata(meta);
	return clipMeta;
}

export async function updateClip(
	clipId: string,
	updates: { label?: string; lead?: string; follow?: string; dance?: string; style?: string; mastery?: string; clipType?: string; tags?: string[]; parentClipId?: string | null; links?: { id: string; type: 'clip' | 'video'; label: string }[]; hidden?: boolean; hiddenFromSearch?: boolean }
): Promise<void> {
	const meta = await readMetadata();
	const clip = meta.clips.find(c => c.id === clipId);
	if (!clip) return;
	if (updates.label !== undefined) clip.label = updates.label;
	if (updates.lead !== undefined) clip.lead = updates.lead;
	if (updates.follow !== undefined) clip.follow = updates.follow;
	if (updates.dance !== undefined) clip.dance = updates.dance;
	if (updates.style !== undefined) clip.style = updates.style;
	if (updates.mastery !== undefined) clip.mastery = updates.mastery;
	if (updates.clipType !== undefined) clip.clipType = updates.clipType;
	if (updates.tags !== undefined) clip.tags = [...updates.tags];
	if (updates.parentClipId !== undefined) clip.parentClipId = updates.parentClipId;
	if (updates.links !== undefined) clip.links = [...updates.links.map(l => ({ ...l }))];
	if (updates.hidden !== undefined) clip.hidden = updates.hidden;
	if (updates.hiddenFromSearch !== undefined) clip.hiddenFromSearch = updates.hiddenFromSearch;
	await saveMetadata(meta);
}

export async function addLink(clipId: string, targetId: string, targetType: 'clip' | 'video', label: string): Promise<void> {
	const meta = await readMetadata();
	const clip = meta.clips.find(c => c.id === clipId);
	if (!clip) return;
	if (!clip.links) clip.links = [];
	if (!clip.links.some(l => l.id === targetId)) {
		clip.links.push({ id: targetId, type: targetType, label });
	}
	if (targetType === 'clip') {
		const target = meta.clips.find(c => c.id === targetId);
		if (target) {
			if (!target.links) target.links = [];
			if (!target.links.some(l => l.id === clipId)) {
				target.links.push({ id: clipId, type: 'clip', label });
			}
		}
	}
	await saveMetadata(meta);
}

export async function removeLink(clipId: string, targetId: string): Promise<void> {
	const meta = await readMetadata();
	const clip = meta.clips.find(c => c.id === clipId);
	if (clip && clip.links) {
		clip.links = clip.links.filter(l => l.id !== targetId);
	}
	const target = meta.clips.find(c => c.id === targetId);
	if (target && target.links) {
		target.links = target.links.filter(l => l.id !== clipId);
	}
	await saveMetadata(meta);
}

export async function deleteClip(clipId: string): Promise<void> {
	const meta = await readMetadata();
	meta.clips = meta.clips.filter(c => c.id !== clipId);
	await saveMetadata(meta);
}

export async function nukeAll(): Promise<void> {
	const root = await getDir();
	const entries: string[] = [];
	for await (const [name] of root.entries()) {
		entries.push(name);
	}
	for (const name of entries) {
		try { await root.removeEntry(name, { recursive: true }); } catch { /* skip */ }
	}
	await ensureStructure();
}

// Export & Import

export async function exportMetadata(): Promise<string> {
	const meta = await readMetadata();
	return JSON.stringify(meta, null, 2);
}

export async function importMetadata(json: string): Promise<void> {
	const imported: Metadata = JSON.parse(json);
	const meta = await readMetadata();

	meta.clips = [];

	const existingByFingerprint = new Map<string, VideoMeta>();
	for (const v of meta.videos) {
		if (v.fingerprint) existingByFingerprint.set(v.fingerprint, v);
	}
	const existingById = new Map(meta.videos.map(v => [v.id, v]));

	for (const importedVideo of imported.videos) {
		const fp = importedVideo.fingerprint ?? '';
		const matchByFp = fp ? existingByFingerprint.get(fp) : null;
		const matchById = existingById.get(importedVideo.id);

		if (matchByFp) {
			matchByFp.name = importedVideo.name;
			matchByFp.duration = importedVideo.duration || matchByFp.duration;
			matchByFp.lead = importedVideo.lead;
			matchByFp.follow = importedVideo.follow;
			matchByFp.dance = importedVideo.dance;
			if (importedVideo.cdnUrl) matchByFp.cdnUrl = importedVideo.cdnUrl;
		} else if (matchById) {
			matchById.name = importedVideo.name;
			matchById.fingerprint = fp;
			matchById.duration = importedVideo.duration || matchById.duration;
			matchById.lead = importedVideo.lead;
			matchById.follow = importedVideo.follow;
			matchById.dance = importedVideo.dance;
			if (importedVideo.cdnUrl) matchById.cdnUrl = importedVideo.cdnUrl;
		} else {
			meta.videos.push({
				id: importedVideo.id,
				name: importedVideo.name,
				fingerprint: fp,
				duration: importedVideo.duration,
				lead: importedVideo.lead,
				follow: importedVideo.follow,
				dance: importedVideo.dance,
				addedAt: importedVideo.addedAt
			});
		}
	}

	for (const clip of imported.clips) {
		meta.clips.push({
			...clip,
			parentClipId: clip.parentClipId ?? null,
			links: clip.links ?? []
		});
	}

	await saveMetadata(meta);
}
