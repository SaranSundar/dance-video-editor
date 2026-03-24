/**
 * Compute a content fingerprint for a video file.
 * Uses file size + SHA-256 of the first 1MB (or entire file if smaller).
 * Fast (~1ms) and unique enough to identify videos regardless of filename.
 */
export async function computeFingerprint(file: Blob): Promise<string> {
	const size = file.size;
	const chunk = file.slice(0, Math.min(size, 1024 * 1024));
	const buffer = await chunk.arrayBuffer();
	const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
	return `${size}:${hashHex}`;
}
