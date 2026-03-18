const DB_NAME = 'clipit-handle';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'root';

interface VideoMeta {
	id: string;
	name: string;
	filename: string;
	thumbnailFilename: string | null;
	duration: number;
	lead: string;
	follow: string;
	dance: string;
	addedAt: string;
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
	createdAt: string;
}

interface Metadata {
	videos: VideoMeta[];
	clips: ClipMeta[];
}

export type { VideoMeta, ClipMeta, Metadata };

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

	const perm = await handle.queryPermission({ mode: 'readwrite' });
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

	const perm = await handle.requestPermission({ mode: 'readwrite' });
	if (perm === 'granted') {
		if (await verifyFolder(handle)) {
			dirHandle = handle;
			return true;
		}
		return false;
	}
	return false;
}

async function verifyFolder(handle: FileSystemDirectoryHandle): Promise<boolean> {
	try {
		// Try to list entries to confirm the folder is accessible
		const iter = handle.values();
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
	const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
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
}

// Videos

export async function getVideos(): Promise<VideoMeta[]> {
	const meta = await readMetadata();
	return meta.videos;
}

export async function addVideo(file: File, duration: number, thumbnailBlob: Blob | null, info: { lead: string; follow: string; dance: string }): Promise<VideoMeta> {
	if (!dirHandle) throw new Error('No directory selected');

	const id = crypto.randomUUID();
	const ext = file.name.split('.').pop() || 'mp4';
	const filename = `${id}.${ext}`;
	const thumbnailFilename = thumbnailBlob ? `${id}-thumb.jpg` : null;

	const videosDir = await dirHandle.getDirectoryHandle('videos');
	const fileHandle = await videosDir.getFileHandle(filename, { create: true });
	const writable = await fileHandle.createWritable();
	await writable.write(file);
	await writable.close();

	if (thumbnailBlob && thumbnailFilename) {
		const thumbHandle = await videosDir.getFileHandle(thumbnailFilename, { create: true });
		const thumbWritable = await thumbHandle.createWritable();
		await thumbWritable.write(thumbnailBlob);
		await thumbWritable.close();
	}

	const videoMeta: VideoMeta = {
		id,
		name: file.name,
		filename,
		thumbnailFilename,
		duration,
		lead: info.lead,
		follow: info.follow,
		dance: info.dance,
		addedAt: new Date().toISOString()
	};

	const meta = await readMetadata();
	meta.videos.push(videoMeta);
	await saveMetadata(meta);

	return videoMeta;
}

export async function getVideoThumbnail(videoId: string): Promise<Blob | null> {
	if (!dirHandle) throw new Error('No directory selected');
	const meta = await readMetadata();
	const video = meta.videos.find(v => v.id === videoId);
	if (!video || !video.thumbnailFilename) return null;

	const videosDir = await dirHandle.getDirectoryHandle('videos');
	try {
		const fileHandle = await videosDir.getFileHandle(video.thumbnailFilename);
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
	const fileHandle = await videosDir.getFileHandle(video.filename);
	return await fileHandle.getFile();
}

export async function deleteVideo(videoId: string): Promise<void> {
	if (!dirHandle) throw new Error('No directory selected');
	const meta = await readMetadata();
	const video = meta.videos.find(v => v.id === videoId);
	if (!video) return;

	const videosDir = await dirHandle.getDirectoryHandle('videos');
	try {
		await videosDir.removeEntry(video.filename);
	} catch { /* file may already be gone */ }

	// Also delete associated clips (they depend on the source video)
	meta.clips = meta.clips.filter(c => c.videoId !== videoId);
	meta.videos = meta.videos.filter(v => v.id !== videoId);
	await saveMetadata(meta);
}

export async function updateVideo(videoId: string, updates: { name?: string; lead?: string; follow?: string; dance?: string }): Promise<void> {
	const meta = await readMetadata();
	const video = meta.videos.find(v => v.id === videoId);
	if (!video) return;
	if (updates.name !== undefined) video.name = updates.name;
	if (updates.lead !== undefined) video.lead = updates.lead;
	if (updates.follow !== undefined) video.follow = updates.follow;
	if (updates.dance !== undefined) video.dance = updates.dance;
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
	return meta.clips;
}

export async function getClipsByVideo(videoId: string): Promise<ClipMeta[]> {
	const meta = await readMetadata();
	return meta.clips.filter(c => c.videoId === videoId);
}

export async function addClip(
	input: { videoId: string; videoName: string; label: string; lead: string; follow: string; dance: string; style: string; mastery: string; clipType: string; startTime: number; endTime: number; tags: string[] }
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
		createdAt: new Date().toISOString()
	};

	const meta = await readMetadata();
	meta.clips.push(clipMeta);
	await saveMetadata(meta);

	return clipMeta;
}

export async function updateClip(clipId: string, updates: { label?: string; lead?: string; follow?: string; dance?: string; style?: string; mastery?: string; clipType?: string; tags?: string[] }): Promise<void> {
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
	await saveMetadata(meta);
}

export async function deleteClip(clipId: string): Promise<void> {
	const meta = await readMetadata();
	meta.clips = meta.clips.filter(c => c.id !== clipId);
	await saveMetadata(meta);
}

export function isReady(): boolean {
	return dirHandle !== null;
}

// Export & Import

async function addDirToZip(zip: any, dirHandle: FileSystemDirectoryHandle, path: string) {
	for await (const [name, handle] of dirHandle.entries()) {
		const fullPath = path ? `${path}/${name}` : name;
		if (handle.kind === 'file') {
			const file = await (handle as FileSystemFileHandle).getFile();
			zip.file(fullPath, file);
		} else {
			const subDir = await dirHandle.getDirectoryHandle(name);
			await addDirToZip(zip, subDir, fullPath);
		}
	}
}

export async function exportData(): Promise<Blob> {
	if (!dirHandle) throw new Error('No directory selected');
	const JSZip = (await import('jszip')).default;
	const zip = new JSZip();
	await addDirToZip(zip, dirHandle, '');
	return await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
}

async function clearDir(dir: FileSystemDirectoryHandle) {
	const entries: [string, 'file' | 'directory'][] = [];
	for await (const [name, handle] of dir.entries()) {
		entries.push([name, handle.kind]);
	}
	for (const [name, kind] of entries) {
		try {
			if (kind === 'directory') {
				// Recursively clear subdirectory first, then remove it
				const subDir = await dir.getDirectoryHandle(name);
				await clearDir(subDir);
				await dir.removeEntry(name);
			} else {
				await dir.removeEntry(name);
			}
		} catch {
			// Some platforms may fail on certain entries, skip
		}
	}
}

export async function importData(zipBlob: Blob): Promise<void> {
	if (!dirHandle) throw new Error('No directory selected');
	const JSZip = (await import('jszip')).default;
	const zip = await JSZip.loadAsync(zipBlob);

	// Clear existing contents
	await clearDir(dirHandle);

	// Sort entries so directories come before files
	const entries = Object.entries(zip.files).sort(([a], [b]) => a.localeCompare(b));

	// Extract all files
	for (const [relativePath, zipEntry] of entries) {
		const entry = zipEntry as any;
		if (entry.dir) continue; // directories are created on demand below

		const parts = relativePath.split('/');
		const fileName = parts.pop()!;
		if (!fileName) continue; // skip empty names

		let current = dirHandle;
		for (const part of parts) {
			if (!part) continue;
			current = await current.getDirectoryHandle(part, { create: true });
		}
		const fileHandle = await current.getFileHandle(fileName, { create: true });
		const writable = await fileHandle.createWritable();
		const data = await entry.async('blob');
		await writable.write(data);
		await writable.close();
	}
}
