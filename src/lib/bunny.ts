/**
 * Bunny CDN/Storage client.
 * Reads go directly to CDN. Writes go through /api/bunny proxy (CORS).
 */

const CDN_BASE = 'https://dance-videos.b-cdn.net';

// Metadata

export async function fetchMetadata(): Promise<any> {
	const res = await fetch(`${CDN_BASE}/metadata.json?t=${Date.now()}`);
	if (!res.ok) return { videos: [], clips: [], practices: [] };
	return res.json();
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
