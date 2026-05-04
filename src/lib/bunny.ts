/**
 * Bunny CDN/Storage client.
 * Reads go directly to CDN. Writes go through /api/bunny proxy (CORS).
 */

import { PUBLIC_BUNNY_CDN_BASE } from '$env/static/public';

const CDN_BASE = PUBLIC_BUNNY_CDN_BASE;

if (!CDN_BASE) {
	throw new Error(
		'Missing PUBLIC_BUNNY_CDN_BASE env var. Set it to your Bunny pull-zone URL (e.g. https://your-zone.b-cdn.net).'
	);
}

// Metadata

const META_CACHE_NAME = 'clipit-metadata-v1';
const META_CACHE_URL = 'https://cache.local/metadata.json';

export async function fetchMetadata(): Promise<any> {
	const res = await fetch(`${CDN_BASE}/metadata.json?t=${Date.now()}`);
	if (!res.ok) return { videos: [], clips: [], practices: [] };
	const meta = await res.json();
	// Snapshot for offline / fallback use
	cacheMetadataLocally(meta).catch(e => console.warn('cacheMetadata failed:', e));
	return meta;
}

export async function cacheMetadataLocally(meta: any): Promise<void> {
	if (typeof caches === 'undefined') return;
	const cache = await caches.open(META_CACHE_NAME);
	const response = new Response(JSON.stringify(meta), {
		headers: { 'Content-Type': 'application/json' },
	});
	await cache.put(META_CACHE_URL, response);
}

export async function getCachedMetadata(): Promise<any | null> {
	if (typeof caches === 'undefined') return null;
	try {
		const cache = await caches.open(META_CACHE_NAME);
		const hit = await cache.match(META_CACHE_URL);
		if (!hit) return null;
		return await hit.json();
	} catch (e) {
		console.warn('getCachedMetadata failed:', e);
		return null;
	}
}

export async function saveMetadataToCloud(json: string): Promise<void> {
	const response = await fetch(`/api/bunny?path=metadata.json`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: json,
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Bunny metadata save failed: HTTP ${response.status} — ${text}`);
	}
}

// Videos

export function getCdnUrl(videoId: string): string {
	return `${CDN_BASE}/${videoId}.mp4`;
}

export function getThumbnailCdnUrl(videoId: string): string {
	return `${CDN_BASE}/${videoId}-thumb.jpg`;
}

export async function uploadVideo(
	videoId: string,
	file: File,
	onProgress?: (loaded: number, total: number) => void
): Promise<string> {
	const remoteName = `${videoId}.mp4`;
	const proxyUrl = `/api/bunny?path=${encodeURIComponent(remoteName)}`;

	if (onProgress) {
		return new Promise((resolve, reject) => {
			const xhr = new XMLHttpRequest();
			xhr.open('PUT', proxyUrl);
			xhr.setRequestHeader('Content-Type', 'video/mp4');

			xhr.upload.onprogress = (e) => {
				if (e.lengthComputable) onProgress(e.loaded, e.total);
			};

			xhr.onload = () => {
				if (xhr.status >= 200 && xhr.status < 300) {
					resolve(getCdnUrl(videoId));
				} else {
					reject(new Error(`Bunny upload failed: HTTP ${xhr.status}`));
				}
			};

			xhr.onerror = () => reject(new Error('Bunny upload failed: network error'));
			xhr.send(file);
		});
	}

	const response = await fetch(proxyUrl, {
		method: 'PUT',
		headers: { 'Content-Type': 'video/mp4' },
		body: file,
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Bunny upload failed: HTTP ${response.status} — ${text}`);
	}

	return getCdnUrl(videoId);
}

export async function uploadThumbnail(
	videoId: string,
	blob: Blob
): Promise<string> {
	const remoteName = `${videoId}-thumb.jpg`;
	const response = await fetch(`/api/bunny?path=${encodeURIComponent(remoteName)}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'image/jpeg' },
		body: blob,
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Bunny thumbnail upload failed: HTTP ${response.status} — ${text}`);
	}

	return getThumbnailCdnUrl(videoId);
}
