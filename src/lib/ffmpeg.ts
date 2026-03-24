import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let ffmpeg: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;

// Preload ffmpeg.wasm in the background so it's ready when needed
export function preload(): void {
	if (!ffmpeg && !loading) {
		loading = getFFmpeg().catch(() => {
			loading = null;
			return null as any;
		});
	}
}

export async function getFFmpeg(): Promise<FFmpeg> {
	if (ffmpeg && ffmpeg.loaded) return ffmpeg;
	if (loading && !ffmpeg) return loading;

	ffmpeg = new FFmpeg();
	ffmpeg.on('log', ({ message }) => {
		console.log('[ffmpeg]', message);
	});

	const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
	await ffmpeg.load({
		coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
		wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')
	});

	return ffmpeg;
}

export async function extractClip(
	videoBlob: Blob,
	startTime: number,
	endTime: number
): Promise<Blob> {
	const ff = await getFFmpeg();

	const inputData = await fetchFile(videoBlob);
	await ff.writeFile('input.mp4', inputData);

	const duration = endTime - startTime;
	// Fast-seek to near the start, then re-encode for frame accuracy
	// -ss before -i seeks by keyframe (fast), then the filter trims precisely
	const seekTo = Math.max(0, startTime - 1); // seek 1s before for safety
	const trimStart = startTime - seekTo;
	await ff.exec([
		'-ss', seekTo.toFixed(3),
		'-i', 'input.mp4',
		'-ss', trimStart.toFixed(3),
		'-t', duration.toFixed(3),
		'-c:v', 'libx264',
		'-preset', 'ultrafast',
		'-crf', '23',
		'-c:a', 'aac',
		'-b:a', '128k',
		'output.mp4'
	]);

	const outputData = await ff.readFile('output.mp4');
	const blob = new Blob([outputData], { type: 'video/mp4' });

	await ff.deleteFile('input.mp4');
	await ff.deleteFile('output.mp4');

	return blob;
}

export async function generateThumbnail(
	videoBlob: Blob,
	time: number
): Promise<Blob> {
	const ff = await getFFmpeg();

	const inputData = await fetchFile(videoBlob);
	await ff.writeFile('input.mp4', inputData);

	await ff.exec([
		'-ss', time.toFixed(3),
		'-i', 'input.mp4',
		'-frames:v', '1',
		'-q:v', '5',
		'thumb.jpg'
	]);

	const thumbData = await ff.readFile('thumb.jpg');
	const blob = new Blob([thumbData], { type: 'image/jpeg' });

	await ff.deleteFile('input.mp4');
	await ff.deleteFile('thumb.jpg');

	return blob;
}
