// Local server for the Anxineers WebXR app.
//  - HTTP  on :8080  -> use with `adb reverse tcp:8080 tcp:8080` (localhost counts as a secure context, WebXR works)
//  - HTTPS on :8443  -> use over Wi-Fi (self-signed certificate, accept the warning once on the headset)
//  - /api/stt        -> ElevenLabs speech-to-text proxy, the API key stays on this machine
import express from 'express';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTTP_PORT = Number(process.env.PORT || 8080);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 8443);

// Optional .env file (KEY=value per line), no extra dependency.
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const app = express();
app.disable('x-powered-by');
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three'), { maxAge: '1d' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0 }));

app.get('/api/status', (_req, res) => {
  res.json({ ok: true, stt: Boolean(process.env.ELEVENLABS_API_KEY) });
});

// Speech to text. The browser posts the raw audio blob, we forward it to ElevenLabs.
app.post('/api/stt', express.raw({ type: () => true, limit: '12mb' }), async (req, res) => {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return res.status(503).json({ error: 'ELEVENLABS_API_KEY is not set on the server' });
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'empty audio' });
  try {
    const form = new FormData();
    const mime = req.get('content-type') || 'audio/webm';
    form.append('file', new Blob([req.body], { type: mime }), 'speech.' + (mime.includes('mp4') ? 'm4a' : 'webm'));
    form.append('model_id', process.env.ELEVENLABS_STT_MODEL || 'scribe_v2');
    form.append('tag_audio_events', 'false');
    const lang = req.query.lang;
    if (typeof lang === 'string' && /^[a-z]{2,3}$/i.test(lang)) form.append('language_code', lang);
    const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST', headers: { 'xi-api-key': key }, body: form,
    });
    const body = await r.text();
    if (!r.ok) return res.status(502).json({ error: 'elevenlabs ' + r.status, detail: body.slice(0, 300) });
    const json = JSON.parse(body);
    res.json({ text: json.text || '' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  return out;
}

http.createServer(app).listen(HTTP_PORT, () => {
  console.log(`\nHTTP   http://localhost:${HTTP_PORT}   (USB: adb reverse tcp:${HTTP_PORT} tcp:${HTTP_PORT})`);
});

try {
  const certDir = path.join(__dirname, 'certs');
  const keyPath = path.join(certDir, 'key.pem');
  const certPath = path.join(certDir, 'cert.pem');
  if (!fs.existsSync(keyPath)) {
    const selfsigned = (await import('selfsigned')).default ?? (await import('selfsigned'));
    const ips = lanAddresses();
    const pems = await selfsigned.generate(
      [{ name: 'commonName', value: 'anxineers.local' }],
      {
        days: 365, keySize: 2048, algorithm: 'sha256',
        extensions: [{ name: 'subjectAltName', altNames: [
          { type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' },
          ...ips.map((ip) => ({ type: 7, ip })),
        ] }],
      });
    fs.mkdirSync(certDir, { recursive: true });
    fs.writeFileSync(keyPath, pems.private);
    fs.writeFileSync(certPath, pems.cert);
  }
  https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, app).listen(HTTPS_PORT, () => {
    for (const ip of lanAddresses()) console.log(`HTTPS  https://${ip}:${HTTPS_PORT}   (Wi-Fi, accept the certificate warning once)`);
    console.log(process.env.ELEVENLABS_API_KEY ? 'ElevenLabs key found.' : 'No ELEVENLABS_API_KEY set: voice input is disabled.');
  });
} catch (e) {
  console.warn('HTTPS disabled:', e.message);
}
