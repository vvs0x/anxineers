// Same contract as /api/stt in server.js: raw audio in, { text } out. The key stays in Netlify's environment.
export default async (req) => {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return Response.json({ error: 'ELEVENLABS_API_KEY is not set' }, { status: 503 });
  if (req.method !== 'POST') return Response.json({ error: 'POST only' }, { status: 405 });
  const audio = await req.arrayBuffer();
  if (!audio.byteLength) return Response.json({ error: 'empty audio' }, { status: 400 });
  const mime = req.headers.get('content-type') || 'audio/webm';
  const form = new FormData();
  form.append('file', new Blob([audio], { type: mime }), 'speech.' + (mime.includes('mp4') ? 'm4a' : 'webm'));
  form.append('model_id', process.env.ELEVENLABS_STT_MODEL || 'scribe_v2');
  form.append('tag_audio_events', 'false');
  const lang = new URL(req.url).searchParams.get('lang');
  if (lang && /^[a-z]{2,3}$/i.test(lang)) form.append('language_code', lang);
  const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key }, body: form });
  const body = await r.text();
  if (!r.ok) return Response.json({ error: 'elevenlabs ' + r.status, detail: body.slice(0, 300) }, { status: 502 });
  return Response.json({ text: JSON.parse(body).text || '' });
};
export const config = { path: '/api/stt' };
