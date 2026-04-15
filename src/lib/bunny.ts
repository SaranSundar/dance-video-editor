/**
 * Client-side upload to Bunny Storage.
 * Personal app — API key is safe to embed.
 */

const STORAGE_ZONE = 'dance-videos-ss';
const API_KEY = 'e23def33-c1e6-4b94-b7ffa764825a-b295-44be';
const STORAGE_HOST = 'la.storage.bunnycdn.com';
const CDN_BASE = 'https://dance-videos-ss.b-cdn.net';

// Metadata

export async function fetchMetadata(): Promise<any> {
	const res = await fetch(`${CDN_BASE}/metadata.json`, { cache: 'no-store' });
	if (!res.ok) return { videos: [], clips: [], practices: [] };
	return res.json();
}

export async function saveMetadataToCloud(json: string): Promise<void> {
	const url = `https://${STORAGE_HOST}/${STORAGE_ZONE}/metadata.json`;
	const response = await fetch(url, {
		method: 'PUT',
		headers: {
			'AccessKey': API_KEY,
			'Content-Type': 'application/json',
		},
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
	const url = `https://${STORAGE_HOST}/${STORAGE_ZONE}/${remoteName}`;

	if (onProgress) {
		// Use XMLHttpRequest for progress tracking
		return new Promise((resolve, reject) => {
			const xhr = new XMLHttpRequest();
			xhr.open('PUT', url);
			xhr.setRequestHeader('AccessKey', API_KEY);
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

	// Simple fetch path (no progress)
	const response = await fetch(url, {
		method: 'PUT',
		headers: {
			'AccessKey': API_KEY,
			'Content-Type': 'video/mp4',
		},
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
	const url = `https://${STORAGE_HOST}/${STORAGE_ZONE}/${remoteName}`;

	const response = await fetch(url, {
		method: 'PUT',
		headers: {
			'AccessKey': API_KEY,
			'Content-Type': 'image/jpeg',
		},
		body: blob,
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Bunny thumbnail upload failed: HTTP ${response.status} — ${text}`);
	}

	return getThumbnailCdnUrl(videoId);
}
