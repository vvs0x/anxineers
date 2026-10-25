/** Opt-in transcription: ElevenLabs when configured, otherwise browser recognition. */
export class Voice {
  constructor(lang = 'en') { this.lang = lang; this.available = false; this.stream = null; this._cancel = false; this.ctx = null; this.generation = 0; }

  /** Explicit microphone opt-in only; recordings/transcripts are never stored here. */
  async init() {
    if (this.available) return true;
    const gen = ++this.generation;
    try {
      const st = await fetch('/api/status', { signal: AbortSignal.timeout(5000) }).then(r => r.json()).catch(() => ({}));
      this.Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
      const server = st.stt && typeof MediaRecorder !== 'undefined';
      if (!navigator.mediaDevices?.getUserMedia || (!server && !this.Recognition)) {
        this.reason = 'Speech recognition is unavailable in this browser.'; return false;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (gen !== this.generation) { stream.getTracks().forEach(t => t.stop()); return false; }
      this.backend = server ? 'server' : 'browser';
      if (this.backend === 'browser') stream.getTracks().forEach(t => t.stop());
      else { this.stream = stream; stream.getTracks().forEach(t => { t.enabled = false; }); }
      this.available = true; return true;
    } catch (e) { if (gen === this.generation) { this.reason = String(e.message || e); this.available = false; } return false; }
  }

  cancel() {
    this._cancel = true; this.generation++;
    this.finishRecognition?.(null);
    this.abortRequest?.abort();
    this.stream?.getTracks().forEach(t => { t.enabled = false; });
  }
  release() { this.cancel(); this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; this.available = false; }

  listenBrowser({ maxMs, silenceMs, onState }) {
    return new Promise(resolve => {
      let text = '', ended = false, silence;
      const rec = new this.Recognition(); this.recognition = rec;
      rec.lang = this.lang; rec.continuous = true; rec.interimResults = true;
      const done = value => {
        if (ended) return; ended = true; clearTimeout(timeout); clearTimeout(silence);
        rec.onend = rec.onerror = rec.onresult = null;
        try { rec.abort(); } catch { /* Already ended. */ }
        this.recognition = null; this.finishRecognition = null; resolve(value);
      };
      const timeout = setTimeout(() => done(text.trim()), maxMs);
      this.finishRecognition = done;
      rec.onresult = event => {
        clearTimeout(silence); onState?.('speech');
        text = Array.from(event.results).map(r => r[0].transcript).join(' ');
        silence = setTimeout(() => done(text.trim()), silenceMs);
      };
      rec.onend = () => done(text.trim());
      rec.onerror = e => {
        if (e.error === 'no-speech') done('');
        else { this.reason = e.error; done(null); }
      };
      try { rec.start(); } catch { done(null); }
    });
  }

  /** Resolves with the transcript, '' when nothing was said, null when cancelled or failed. */
  async listen({ maxMs = 22000, silenceMs = 2200, onState } = {}) {
    if (!this.available) return null;
    this._cancel = false;
    if (this.backend === 'browser') return this.listenBrowser({ maxMs, silenceMs, onState });
    const gen = this.generation;
    this.stream?.getTracks().forEach(t => { t.enabled = true; });
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = this.ctx || new AC();
    await this.ctx.resume();
    if (gen !== this.generation) return null;
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
        if (gen !== this.generation || this._cancel || now - t0 > maxMs) return resolve();
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
    if (gen === this.generation) this.stream?.getTracks().forEach(t => { t.enabled = false; });
    if (gen !== this.generation || this._cancel) return null;
    if (!speechStart) return '';
    onState?.('transcribing');
    try {
      const blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' });
      this.abortRequest = new AbortController();
      const r = await fetch('/api/stt?lang=' + encodeURIComponent(this.lang), { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob, signal: AbortSignal.any([this.abortRequest.signal, AbortSignal.timeout(15000)]) });
      if (gen !== this.generation || !r.ok) return null;
      return ((await r.json()).text || '').trim();
    } catch { return null; }
  }
}

/** Count spoken list entries, keeping descriptive phrases together. */
export function parseItems(text) {
  const listed = (text || '').replace(/\b(?:one|two|three|four|five|eins|zwei|drei|vier|fünf)\s+(?=(?:a|an|the|ein|eine|der|die|das)\b)/gi, ', ');
  const parts = listed.split(/[,;.!?\n]|\b(?:and|und|et|plus|first|second|third|fourth|fifth|erstens|zweitens|drittens|viertens|fünftens)\b|(?:^|\s)[1-5][.):]\s*/i)
    .map(s => s.trim().replace(/^(?:I (?:can )?(?:see|hear|smell|taste|touch|feel)|there (?:is|are)|ich (?:sehe|höre|rieche|schmecke|fühle))\s+/i, '').replace(/^(?:a|an|the|ein|eine|der|die|das)\s+/i, '').trim())
    .flatMap(part => {
      // STT sometimes omits commas: 'a chair a table a lamp'. A preposition
      // keeps descriptions such as 'a picture on the wall' as one item.
      const words = part.split(/\s+/), chunks = []; let phrase = [];
      for (const word of words) {
        if (/^(?:a|an|the|ein|eine|der|die|das)$/i.test(word) && phrase.length
          && !/^(?:on|of|in|at|with|under|above|by|near|behind|beside|from|to|auf|an|mit|von|neben|unter|über)$/i.test(phrase.at(-1))) {
          chunks.push(phrase.join(' ')); phrase = [];
        }
        phrase.push(word);
      }
      if (phrase.length) chunks.push(phrase.join(' '));
      return chunks.map(s => s.replace(/^(?:a|an|the|ein|eine|der|die|das)\s+/i, '').trim());
    })
    .filter(s => /[\p{L}\p{N}]/u.test(s) && !/^(?:[1-5]|one|two|three|four|five|um|uh|hmm|okay|ok|yes|yeah|no|thanks|thank you|i think|äh|ja|nein)$/i.test(s));
  return { count: parts.length, items: parts };
}

export function groundingResponse(text) {
  const value = (text || '').trim().replace(/[.!?]+$/g, '');
  if (!value) return { type: 'silence', items: [] };
  const readiness = /(?:^|[,.;]\s*|\band\s+)(?:i'm ready|i am ready|that's all|that is all|i'm done|i am done|ich bin fertig|ich bin bereit)$/i;
  if (readiness.test(value)) {
    const items = parseItems(value.replace(readiness, '')).items;
    return { type: items.length ? 'items' : 'ready', items };
  }
  if (/^(?:i (?:want|need) to stop|please stop the exercise)$/i.test(value)) return { type: 'stop', items: [] };
  if (/^(?:(?:please|bitte) )?(?:stop|stop now|stop listening|calm now|enough|halt|stopp)(?: please)?$/i.test(value)) return { type: 'stop', items: [] };
  if (/^(?:(?:okay|ok)[, ]+)?(?:(?:i am|i'm|ich bin) )?(?:ready|done|finished|next|continue|skip|that's all|that is all|bereit|fertig|weiter|überspringen)(?: now| please| bitte)?$/i.test(value)) return { type: 'ready', items: [] };
  if (/\b(?:help|hint|don't know|do not know|not sure|can't think|cannot think|what (?:do|should)|hilfe|weiß nicht|weiss nicht|unsicher)\b/i.test(value)) return { type: 'help', items: [] };
  if (/^(?:i (?:can't|cannot|don't|do not) (?:see|hear|smell|taste|touch|notice)|nothing|no (?:smell|taste)|ich (?:kann|rieche|schmecke).*nicht)/i.test(value)) return { type: 'unavailable', items: [] };
  return { type: 'items', items: parseItems(value).items };
}
