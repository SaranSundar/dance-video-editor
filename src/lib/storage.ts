const DB_NAME = 'clipit-handle';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'root';

interface VideoSection {
	id: string;
	name?: string;
	startTime: number;
	endTime: number;
	loopCount: number;
}

interface VideoMeta {
	id: string;
	name: string;
	fingerprint: string;
	duration: number;
	lead: string;
	follow: string;
	dance: string;
	category?: 'demo' | 'jack-and-jill' | 'workshop' | 'social';
	hidden: boolean;
	hiddenFromSearch: boolean;
	addedAt: string;
	cdnUrl?: string;
	bpm?: number;
	sections?: VideoSection[];
}

interface ClipMeta {
	id: string;
	videoId: string;
	videoName: string;
	label: string;
	lead: string;
	follow: string;
	dance: string;
	style: string;
	mastery: string;
	clipType: string;
	startTime: number;
	endTime: number;
	tags: string[];
	parentClipId: string | null;
	links: { id: string; type: 'clip' | 'video'; label: string }[];
	hidden: boolean;
	hiddenFromSearch: boolean;
	createdAt: string;
}

interface PracticeMeta {
	id: string;
	name: string;
	clipIds: string[];
	loop: boolean;
	createdAt: string;
}

interface Metadata {
	videos: VideoMeta[];
	clips: ClipMeta[];
	practices?: PracticeMeta[];
}

export type { VideoMeta, VideoSection, ClipMeta, PracticeMeta, Metadata };

let dirHandle: FileSystemDirectoryHandle | null = null;

function openHandleDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => {
			req.result.createObjectStore(STORE_NAME);
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function storeHandle(handle: FileSystemDirectoryHandle): Promise<void> {
	const db = await openHandleDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readwrite');
		tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

async function loadHandle(): Promise<FileSystemDirectoryHandle | null> {
	const db = await openHandleDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readonly');
		const req = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
		req.onsuccess = () => resolve(req.result ?? null);
		req.onerror = () => reject(req.error);
	});
}

export async function hasStoredHandle(): Promise<boolean> {
	const handle = await loadHandle();
	return handle !== null;
}

export async function tryRestoreHandle(): Promise<boolean> {
	const handle = await loadHandle();
	if (!handle) return false;

	const perm = await (handle as any).queryPermission({ mode: 'readwrite' });
	if (perm === 'granted') {
		if (await verifyFolder(handle)) {
			dirHandle = handle;
			return true;
		}
		return false;
	}
	return false;
}

export async function requestPermission(): Promise<boolean> {
	const handle = await loadHandle();
	if (!handle) return false;

	try {
		const perm = await (handle as any).requestPermission({ mode: 'readwrite' });
		if (perm === 'granted') {
			dirHandle = handle;
			return true;
		}
		return false;
	} catch {
		// requestPermission can throw on Android Chrome with stale/invalid handles
		return false;
	}
}

async function verifyFolder(handle: FileSystemDirectoryHandle): Promise<boolean> {
	try {
		// Try to list entries to confirm the folder is accessible
		const iter = (handle as any).values();
		await iter.next();
		return true;
	} catch {
		return false;
	}
}

export function getFolderName(): string | null {
	return dirHandle?.name ?? null;
}

export async function pickFolder(): Promise<void> {
	const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
	dirHandle = handle;
	await storeHandle(handle);
	await ensureStructure();
}

async function ensureStructure(): Promise<void> {
	if (!dirHandle) throw new Error('No directory selected');
	await dirHandle.getDirectoryHandle('videos', { create: true });

	try {
		await dirHandle.getFileHandle('metadata.json');
	} catch {
		await saveMetadata({ videos: [], clips: [] });
	}
}

async function readMetadata(): Promise<Metadata> {
	if (!dirHandle) throw new Error('No directory selected');
	const fileHandle = await dirHandle.getFileHandle('metadata.json');
	const file = await fileHandle.getFile();
	const text = await file.text();
	return JSON.parse(text);
}

async function saveMetadata(meta: Metadata): Promise<void> {
	if (!dirHandle) throw new Error('No directory selected');
	const fileHandle = await dirHandle.getFileHandle('metadata.json', { create: true });
	const writable = await fileHandle.createWritable();
	await writable.write(JSON.stringify(meta, null, 2));
	await writable.close();
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

export async function addVideo(file: File, duration: number, thumbnailBlob: Blob | null, info: { lead: string; follow: string; dance: string }, fingerprint: string = ''): Promise<VideoMeta> {
	if (!dirHandle) throw new Error('No directory selected');

	const meta = await readMetadata();

	// Check for existing video with same fingerprint
	const existing = fingerprint ? meta.videos.find(v => v.fingerprint === fingerprint) : null;
	const id = existing ? existing.id : crypto.randomUUID();
	const ext = file.name.split('.').pop() || 'mp4';
	const filename = `${id}.${ext}`;
	const thumbFilename = thumbnailBlob ? `${id}-thumb.jpg` : null;

	const videosDir = await dirHandle.getDirectoryHandle('videos');
	const fileHandle = await videosDir.getFileHandle(filename, { create: true });
	const writable = await fileHandle.createWritable();
	await writable.write(file);
	await writable.close();

	if (thumbnailBlob && thumbFilename) {
		const thumbHandle = await videosDir.getFileHandle(thumbFilename, { create: true });
		const thumbWritable = await thumbHandle.createWritable();
		await thumbWritable.write(thumbnailBlob);
		await thumbWritable.close();
	}

	if (existing) {
		// Update existing entry
		existing.name = file.name;
		existing.duration = duration || existing.duration;
		existing.fingerprint = fingerprint;
		await saveMetadata(meta);
		return existing;
	}

	const videoMeta: VideoMeta = {
		id,
		name: file.name,
		fingerprint,
		duration,
		lead: info.lead,
		follow: info.follow,
		dance: info.dance,
		hidden: false,
		hiddenFromSearch: false,
		addedAt: new Date().toISOString()
	};

	meta.videos.push(videoMeta);
	await saveMetadata(meta);

	return videoMeta;
}

// Cache metadata to avoid re-reading the JSON file on every call
let metaCache: Metadata | null = null;
let metaCacheTime = 0;

async function getCachedMetadata(): Promise<Metadata> {
	const now = Date.now();
	if (metaCache && now - metaCacheTime < 5000) return metaCache;
	metaCache = await readMetadata();
	metaCacheTime = now;
	return metaCache;
}

export function invalidateMetaCache() {
	metaCache = null;
}

export async function getVideoThumbnail(videoId: string): Promise<Blob | null> {
	if (!dirHandle) throw new Error('No directory selected');
	const meta = await getCachedMetadata();
	const video = meta.videos.find(v => v.id === videoId);
	if (!video) return null;

	const videosDir = await dirHandle.getDirectoryHandle('videos');
	try {
		const fileHandle = await videosDir.getFileHandle(`${videoId}-thumb.jpg`);
		return await fileHandle.getFile();
	} catch {
		return null;
	}
}

export async function getVideoBlob(videoId: string): Promise<Blob> {
	if (!dirHandle) throw new Error('No directory selected');
	const meta = await readMetadata();
	const video = meta.videos.find(v => v.id === videoId);
	if (!video) throw new Error('Video not found');

	const videosDir = await dirHandle.getDirectoryHandle('videos');
	// Try common extensions
	for (const ext of ['mp4', 'webm', 'mov']) {
		try {
			const fileHandle = await videosDir.getFileHandle(`${videoId}.${ext}`);
			return await fileHandle.getFile();
		} catch { /* try next */ }
	}
	throw new Error('Video file not found');
}

export async function deleteVideo(videoId: string): Promise<void> {
	if (!dirHandle) throw new Error('No directory selected');
	const meta = await readMetadata();
	const video = meta.videos.find(v => v.id === videoId);
	if (!video) return;

	const videosDir = await dirHandle.getDirectoryHandle('videos');
	// Try to remove video file with common extensions
	for (const ext of ['mp4', 'webm', 'mov']) {
		try { await videosDir.removeEntry(`${videoId}.${ext}`); } catch { /* skip */ }
	}
	try { await videosDir.removeEntry(`${videoId}-thumb.jpg`); } catch { /* skip */ }

	// Also delete associated clips (they depend on the source video)
	meta.clips = meta.clips.filter(c => c.videoId !== videoId);
	meta.videos = meta.videos.filter(v => v.id !== videoId);
	await saveMetadata(meta);
}

export async function updateVideo(videoId: string, updates: { name?: string; lead?: string; follow?: string; dance?: string; hidden?: boolean; hiddenFromSearch?: boolean; cdnUrl?: string }): Promise<void> {
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
	// Also update videoName on clips if name changed
	if (updates.name !== undefined) {
		for (const clip of meta.clips) {
			if (clip.videoId === videoId) clip.videoName = updates.name;
		}
	}
	await saveMetadata(meta);
}

export async function renameVideo(videoId: string, newName: string): Promise<void> {
	const meta = await readMetadata();
	const video = meta.videos.find(v => v.id === videoId);
	if (!video) return;
	video.name = newName;
	for (const clip of meta.clips) {
		if (clip.videoId === videoId) {
			clip.videoName = newName;
		}
	}
	await saveMetadata(meta);
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
		.map(c => ({ ...c, parentClipId: c.parentClipId ?? null, links: c.links ?? [] }));
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
		tags: input.tags,
		parentClipId: input.parentClipId ?? null,
		links: [],
		hidden: false,
		hiddenFromSearch: false,
		createdAt: new Date().toISOString()
	};

	const meta = await readMetadata();
	meta.clips.push(clipMeta);
	await saveMetadata(meta);

	return clipMeta;
}

export async function updateClip(clipId: string, updates: { label?: string; lead?: string; follow?: string; dance?: string; style?: string; mastery?: string; clipType?: string; tags?: string[]; parentClipId?: string | null; links?: { id: string; type: 'clip' | 'video'; label: string }[]; hidden?: boolean; hiddenFromSearch?: boolean }): Promise<void> {
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
	if (updates.tags !== undefined) clip.tags = updates.tags;
	if (updates.parentClipId !== undefined) clip.parentClipId = updates.parentClipId;
	if (updates.links !== undefined) clip.links = updates.links;
	if (updates.hidden !== undefined) clip.hidden = updates.hidden;
	if (updates.hiddenFromSearch !== undefined) clip.hiddenFromSearch = updates.hiddenFromSearch;
	await saveMetadata(meta);
}

export async function addLink(clipId: string, targetId: string, targetType: 'clip' | 'video', label: string): Promise<void> {
	const meta = await readMetadata();
	const clip = meta.clips.find(c => c.id === clipId);
	if (!clip) return;

	// Initialize links if missing (backward compat)
	if (!clip.links) clip.links = [];

	// Avoid duplicates
	if (!clip.links.some(l => l.id === targetId)) {
		clip.links.push({ id: targetId, type: targetType, label });
	}

	// Bidirectional: if target is a clip, add reverse link
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

	// Remove reverse link if target is a clip
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

// Practices

export async function getPractices(): Promise<PracticeMeta[]> {
	const meta = await readMetadata();
	return (meta.practices ?? []).map(p => ({ ...p }));
}

export async function addPractice(input: { name: string; clipIds: string[]; loop?: boolean }): Promise<PracticeMeta> {
	const id = crypto.randomUUID();
	const practice: PracticeMeta = {
		id,
		name: input.name,
		clipIds: [...input.clipIds],
		loop: input.loop ?? false,
		createdAt: new Date().toISOString()
	};
	const meta = await readMetadata();
	if (!meta.practices) meta.practices = [];
	meta.practices.push(practice);
	await saveMetadata(meta);
	return practice;
}

export async function updatePractice(practiceId: string, updates: { name?: string; clipIds?: string[]; loop?: boolean }): Promise<void> {
	const meta = await readMetadata();
	if (!meta.practices) return;
	const practice = meta.practices.find(p => p.id === practiceId);
	if (!practice) return;
	if (updates.name !== undefined) practice.name = updates.name;
	if (updates.clipIds !== undefined) practice.clipIds = [...updates.clipIds];
	if (updates.loop !== undefined) practice.loop = updates.loop;
	await saveMetadata(meta);
}

export async function deletePractice(practiceId: string): Promise<void> {
	const meta = await readMetadata();
	if (!meta.practices) return;
	meta.practices = meta.practices.filter(p => p.id !== practiceId);
	await saveMetadata(meta);
}

export function isReady(): boolean {
	return dirHandle !== null;
}

export async function nukeAll(): Promise<void> {
	if (!dirHandle) throw new Error('No directory selected');
	// Clear all entries in the directory
	const entries: [string, 'file' | 'directory'][] = [];
	for await (const [name, handle] of (dirHandle as any).entries()) {
		entries.push([name, handle.kind]);
	}
	for (const [name, kind] of entries) {
		try {
			if (kind === 'directory') {
				await dirHandle.removeEntry(name, { recursive: true });
			} else {
				await dirHandle.removeEntry(name);
			}
		} catch { /* skip */ }
	}
	await ensureStructure();
}

// Export & Import

export async function exportMetadata(): Promise<string> {
	if (!dirHandle) throw new Error('No directory selected');
	const meta = await readMetadata();
	return JSON.stringify(meta, null, 2);
}

export async function importMetadata(json: string): Promise<void> {
	if (!dirHandle) throw new Error('No directory selected');
	const imported: Metadata = JSON.parse(json);
	const meta = await readMetadata();

	// Clear clips
	meta.clips = [];

	// Build fingerprint map of existing videos
	const existingByFingerprint = new Map<string, VideoMeta>();
	for (const v of meta.videos) {
		if (v.fingerprint) existingByFingerprint.set(v.fingerprint, v);
	}
	const existingById = new Map(meta.videos.map(v => [v.id, v]));

	// Merge imported videos
	for (const importedVideo of imported.videos) {
		const fp = (importedVideo as any).fingerprint ?? '';
		const matchByFp = fp ? existingByFingerprint.get(fp) : null;
		const matchById = existingById.get(importedVideo.id);

		if (matchByFp) {
			// Update existing entry matched by fingerprint
			matchByFp.name = importedVideo.name;
			matchByFp.duration = importedVideo.duration || matchByFp.duration;
			matchByFp.lead = importedVideo.lead;
			matchByFp.follow = importedVideo.follow;
			matchByFp.dance = importedVideo.dance;
			if (importedVideo.cdnUrl) matchByFp.cdnUrl = importedVideo.cdnUrl;
		} else if (matchById) {
			// Update existing entry matched by id
			matchById.name = importedVideo.name;
			matchById.fingerprint = fp;
			matchById.duration = importedVideo.duration || matchById.duration;
			matchById.lead = importedVideo.lead;
			matchById.follow = importedVideo.follow;
			matchById.dance = importedVideo.dance;
			if (importedVideo.cdnUrl) matchById.cdnUrl = importedVideo.cdnUrl;
		} else {
			// Create placeholder
			meta.videos.push({
				id: importedVideo.id,
				name: importedVideo.name,
				fingerprint: fp,
				duration: importedVideo.duration,
				lead: importedVideo.lead,
				follow: importedVideo.follow,
				dance: importedVideo.dance,
				hidden: importedVideo.hidden ?? false,
				hiddenFromSearch: importedVideo.hiddenFromSearch ?? false,
				cdnUrl: importedVideo.cdnUrl,
				addedAt: importedVideo.addedAt
			});
		}
	}

	// Import all clips
	for (const clip of imported.clips) {
		meta.clips.push({
			...clip,
			parentClipId: clip.parentClipId ?? null,
			links: clip.links ?? []
		});
	}

	// Import practices
	if ((imported as any).practices) {
		meta.practices = (imported as any).practices;
	}

	await saveMetadata(meta);
}
