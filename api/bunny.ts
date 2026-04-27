import type { VercelRequest, VercelResponse } from '@vercel/node';

const STORAGE_ZONE = process.env.BUNNY_STORAGE_ZONE;
const API_KEY = process.env.BUNNY_STORAGE_API_KEY;
const STORAGE_HOST = process.env.BUNNY_STORAGE_HOST ?? 'storage.bunnycdn.com';

export const config = {
	maxDuration: 300,
	api: {
		bodyParser: {
			sizeLimit: '700mb',
		},
	},
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
	if (!STORAGE_ZONE || !API_KEY) {
		return res.status(500).json({
			error: 'Server is missing BUNNY_STORAGE_ZONE or BUNNY_STORAGE_API_KEY env vars',
		});
	}

	if (req.method !== 'PUT') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	const filePath = req.query.path;
	if (!filePath || typeof filePath !== 'string') {
		return res.status(400).json({ error: 'Missing path query param' });
	}

	const url = `https://${STORAGE_HOST}/${STORAGE_ZONE}/${filePath}`;
	const contentType = req.headers['content-type'] || 'application/octet-stream';

	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
	}
	const body = Buffer.concat(chunks);

	const response = await fetch(url, {
		method: 'PUT',
		headers: {
			'AccessKey': API_KEY,
			'Content-Type': contentType,
		},
		body,
	});

	if (!response.ok) {
		const text = await response.text();
		return res.status(response.status).json({ error: text });
	}

	return res.status(200).json({ ok: true });
}
