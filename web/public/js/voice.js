/** Microphone capture with simple silence detection, transcription through the local server (ElevenLabs). */
export class Voice {
  constructor(lang = 'en') { this.lang = lang; this.available = false; this.stream = null; this._cancel = false; this.ctx = null; }

  /** call after a user gesture (the permission prompt needs it). Safe to call repeatedly. */
  async init() {
    if (this.available) return true;
    try {
      const st = await (await fetch('/api/status')).json();
      if (!st.stt) { this.reason = 'no key on server'; return false; }
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { this.reason = 'no microphone API'; return false; }
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      this.available = true; return true;
    } catch (e) { this.reason = String(e.message || e); this.available = false; return false; }
  }

  cancel() { this._cancel = true; }

  /** Resolves with the transcript, '' when nothing was said, null when cancelled or failed. */
  async listen({ maxMs = 14000, silenceMs = 1600, onState } = {}) {
    if (!this.available) return null;
    this._cancel = false;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = this.ctx || new AC();
    const src = this.ctx.createMediaStreamSource(this.stream);
    const an = this.ctx.createAnalyser(); an.fftSize = 1024; src.connect(an);
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported?.(m)) || '';
    const rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise((r) => { rec.onstop = r; });
    rec.start(250);
    const buf = new Float32Array(an.fftSize);
    const t0 = performance.now(); let speechStart = 0, lastSpeech = 0, noise = 0, noiseN = 0;
    await new Promise((resolve) => {
      const tick = () => {
        const now = performance.now();
        if (this._cancel || now - t0 > maxMs) return resolve();
        an.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; const rms = Math.sqrt(s / buf.length);
        if (now - t0 < 500) { noise += rms; noiseN++; }
        else {
          const thr = Math.max(0.015, (noise / Math.max(1, noiseN)) * 3);
          if (rms > thr) { if (!speechStart) { speechStart = now; onState?.('speech'); } lastSpeech = now; }
          if (speechStart && lastSpeech - speechStart > 300 && now - lastSpeech > silenceMs) return resolve();
        }
        setTimeout(tick, 60);
      }; tick();
    });
    rec.state !== 'inactive' && rec.stop(); await stopped; src.disconnect();
    if (this._cancel) return null;
    if (!speechStart) return '';
    onState?.('transcribing');
    try {
      const blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' });
      const r = await fetch('/api/stt?lang=' + encodeURIComponent(this.lang), { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
      if (!r.ok) return null;
      return ((await r.json()).text || '').trim();
    } catch { return null; }
  }
}

/** Lenient counting: any separator splits, count is informational, never blocks the flow. */
export function parseItems(text) {
  const parts = (text || '').split(/[,;.\n]|\b(?:and|und|et|y|e|plus)\b/i).map((s) => s.trim()).filter((s) => /[\p{L}\p{N}]/u.test(s));
  return { count: parts.length, items: parts };
}
