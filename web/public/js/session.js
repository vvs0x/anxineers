import { PROFILES } from './profiles.js';
import { TEXTS } from './texts.js';
import { parseItems } from './voice.js';

const MAX_SESSION_SECONDS = 20 * 60;
const BREATHS = 3, INHALE = 4, EXHALE = 6;

/** Consent, mode, cap, running, grounding, breathing, end. Drives the panel and the director. */
export class Session {
  constructor({ director, panel, voice, audio, lang = 'en', onExitVR }) {
    Object.assign(this, { director, panel, voice, audio, onExitVR });
    this.setLang(lang);
    this.phase = 'idle'; this.mode = null; this.cap = 0.5; this.elapsed = 0; this.calmRequested = false;
    this.groundIdx = 0; this.breathT = 0; this.gen = 0;
    panel.onPick = (id) => this.pick(id);
    director.onChange(() => {
      if (this.phase === 'running' && director.state === 'Recovery' && !this.calmRequested) this.startGrounding();
    });
  }
  setLang(l) { this.lang = TEXTS[l] ? l : 'en'; this.T = TEXTS[this.lang]; }

  begin() { this.director.reset(); this.panel.placeInFront(); this.showConsent(); }

  // ---- screens ----
  showConsent() { this.phase = 'consent'; const T = this.T; this.panel.setOrb('off'); this.panel.show({ title: T.consentTitle, body: T.consentBody, buttons: [{ id: 'agree', label: T.agree }, { id: 'decline', label: T.decline }] }); }
  showIntro() { this.phase = 'intro'; const T = this.T; this.panel.show({ title: T.introTitle, body: T.introBody, buttons: [{ id: 'continue', label: T.cont }] }); }
  showMode() { this.phase = 'mode'; const T = this.T; this.panel.show({ title: T.modeTitle, body: '', buttons: [{ id: 'edu', label: T.modeEdu }, { id: 'reg', label: T.modeReg }] }); }
  showCap() {
    this.phase = 'cap'; const T = this.T;
    this.panel.show({ title: T.capTitle, body: T.capBody, status: `${Math.round(this.cap * 100)} %`, buttons: [{ id: 'capdown', label: '−' }, { id: 'capup', label: '+' }, { id: 'start', label: T.start }] });
  }
  showEnd() {
    this.phase = 'end'; const T = this.T; this.panel.setOrb('off');
    this.panel.show({ title: T.endTitle, body: T.endBody, buttons: [{ id: 'again', label: T.again }, { id: 'exit', label: T.exit }] });
  }

  pick(id) {
    const g = this.director;
    switch (id) {
      case 'agree': this.voice?.init?.(); this.showIntro(); break;       // mic permission needs this click
      case 'decline': this.phase = 'declined'; this.panel.show({ title: '', body: this.T.declined, buttons: [] }); break;
      case 'continue': this.showMode(); break;
      case 'edu': this.mode = 'edu'; g.setProfile(PROFILES.Education_Light); this.cap = 0.5; this.showCap(); break;
      case 'reg': this.mode = 'reg'; g.setProfile(PROFILES.Regulation_Gentle); this.cap = 0.4; this.showCap(); break;
      case 'capdown': this.cap = Math.max(0.1, Math.round((this.cap - 0.1) * 10) / 10); this.showCap(); break;
      case 'capup': this.cap = Math.min(1, Math.round((this.cap + 0.1) * 10) / 10); this.showCap(); break;
      case 'start': this.startRun(); break;
      case 'next': this.groundNext(true); break;
      case 'skip': this.calmNow(); break;
      case 'again': this.begin(); break;
      case 'exit': this.onExitVR?.(); break;
    }
  }

  startRun() {
    this.phase = 'running'; this.elapsed = 0; this.calmRequested = false;
    this.panel.hide(); this.director.setCap(this.cap); this.director.startBuild();
  }

  // ---- grounding 5-4-3-2-1 ----
  startGrounding() {
    this.phase = 'grounding'; this.groundIdx = 0; this.gen++;
    this.panel.placeInFront(); this.groundShow();
  }
  groundShow() {
    const T = this.T, n = 5 - this.groundIdx, sense = T.senses[this.groundIdx];
    this.director.setTargetOverride(0.25 * (n / 5));
    this.panel.show({
      title: T.groundTitle, body: T.groundPrompt(n, sense),
      dots: { total: 5, done: this.groundIdx },
      status: this.voice?.available ? T.listening : T.speakOrNext,
      buttons: [{ id: 'next', label: T.next }, { id: 'skip', label: T.skip }],
    });
    if (this.voice?.available) { this.panel.setOrb('listen'); this.listenLoop(this.gen, this.groundIdx); } else this.panel.setOrb('off');
  }
  async listenLoop(gen, idx) {
    const text = await this.voice.listen({ onState: (s) => { if (gen === this.gen && idx === this.groundIdx) this.panel.setStatus(s === 'speech' ? '...' : s === 'transcribing' ? '...' : this.T.listening); } });
    if (gen !== this.gen || idx !== this.groundIdx || this.phase !== 'grounding') return;
    if (text == null) { this.panel.setStatus(this.T.speakOrNext); this.panel.setOrb('off'); return; }
    if (this.T.stopWords.test(text)) { this.calmNow(); return; }
    if (parseItems(text).count > 0) { this.audio?.chime(); this.panel.setStatus(this.T.heard); setTimeout(() => { if (gen === this.gen && idx === this.groundIdx) this.groundNext(false); }, 900); }
    else this.listenLoop(gen, idx);                                  // silence: keep listening, no pressure
  }
  groundNext(fromButton) {
    if (this.phase !== 'grounding') return;
    this.voice?.cancel?.(); this.groundIdx++; this.gen++;
    if (this.groundIdx >= 5) { this.director.setTargetOverride(null); this.startBreathing(); return; }
    this.groundShow();
  }

  // ---- breathing ----
  startBreathing() {
    this.voice?.cancel?.(); this.phase = 'breathing'; this.breathT = 0; this.gen++;
    this.director.setTargetOverride(0);
    this.panel.placeInFront(); this.panel.show({ title: this.T.breathTitle, body: this.T.breatheIn, buttons: [] }); this.panel.setOrb('breath');
  }

  /** A/X, space, voice "stop": always leads to breathing and then the end screen */
  calmNow() {
    if (['consent', 'intro', 'mode', 'cap', 'end', 'declined', 'idle'].includes(this.phase)) { this.director.calmNow(); return; }
    this.calmRequested = true; this.voice?.cancel?.(); this.gen++;
    this.director.setTargetOverride(null); this.director.calmNow(6);
    if (this.phase !== 'breathing') this.startBreathing();
  }

  update(dt) {
    if (this.phase === 'running' || this.phase === 'grounding') {
      this.elapsed += dt;
      if (this.elapsed > MAX_SESSION_SECONDS && !this.calmRequested) this.calmNow();
    }
    if (this.phase === 'breathing') {
      this.breathT += dt; const cycle = INHALE + EXHALE, t = this.breathT % cycle, n = Math.floor(this.breathT / cycle);
      if (n >= BREATHS) { this.director.setTargetOverride(null); this.showEnd(); return; }
      const inh = t < INHALE, k = inh ? t / INHALE : 1 - (t - INHALE) / EXHALE, e = k * k * (3 - 2 * k);
      this.panel.orbScale = 1 + 1.8 * e;
      const label = inh ? this.T.breatheIn : this.T.breatheOut;
      if (this.panel.model && this.panel.model.body !== label) { this.panel.model.body = label; this.panel._draw(); }
    }
  }
}
