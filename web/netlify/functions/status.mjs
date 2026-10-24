export default async () => Response.json({ ok: true, stt: Boolean(process.env.ELEVENLABS_API_KEY) });
export const config = { path: '/api/status' };
