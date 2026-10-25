import { SETTLING_SECONDS } from './settling.js';
import { TEXTS } from './texts.js';
import { groundingResponse } from './voice.js';
import { GUIDE_LINES, GROUND_SENSES, GROUND_LABELS } from './guide-script.js';

/** Opening, observation, embodiment, anxiety, breathing, grounding, end. */
export class Session {
  constructor({ director, panel, voice, audio, guide, lang = 'en', onExitVR, observationSeconds = 10, embodimentSeconds = 4, anxietySeconds, povSeconds = 60, freeExplore = false }) {
    Object.assign(this, { director, panel, voice, audio, guide, onExitVR });
    this.setLang(lang);
    this.observationSeconds = Number.isFinite(observationSeconds) ? Math.max(0, observationSeconds) : 10;
    this.embodimentSeconds = Number.isFinite(embodimentSeconds) ? Math.max(0, embodimentSeconds) : 4;
    this.showcase = true; this.freeExplore = freeExplore;
    this.povSeconds = Number.isFinite(anxietySeconds) ? anxietySeconds : povSeconds;
    this.povElapsed = 0;
    this.assetsReady = true; this.loadFailed = false;
    this.phase = 'idle'; this.phaseTime = 0; this.phaseDuration = 0; this.mode = null; this.cap = 1; this.elapsed = 0; this.calmRequested = false;
    this.settlingSeconds = SETTLING_SECONDS;
    this.breathing = { count: 3, inhale: 2, exhale: 3 };
    this.groundIdx = 0; this.breathT = 0; this.gen = 0; this.narrating = false; this.narrationToken = 0; this.afterBreathing = false;
    this.resetGrounding();
    panel.onPick = (id) => this.pick(id);
    director.onChange(() => {
      if (this.phase === 'running' && director.state === 'Recovery' && !this.calmRequested) this.startBreathing(true);
    });
  }
  get anxietySeconds() { return this.povSeconds; }
  set anxietySeconds(seconds) { this.povSeconds = seconds; }

  setLang(l) { this.lang = TEXTS[l] ? l : 'en'; this.T = TEXTS[this.lang]; this.G = GUIDE_LINES[this.lang] || GUIDE_LINES.en; if (this.guide) this.guide.lang = this.lang; if (this.voice) this.voice.lang = this.lang; }

  _setPhase(phase, duration = 0) { this.phase = phase; this.phaseTime = 0; this.phaseDuration = duration; this.openingLine = null; this.openingLeadIn = 0; }

  cancelMedia(release = false) { this.gen++; this.narrationToken++; this.narrating = false; this.openingLine = null; this.guide?.cancel(); this.voice?.[release ? 'release' : 'cancel']?.(); if (this.audio) this.audio.listening = false; }

  async narrate(...ids) {
    if (!this.guide) return;
    const gen = this.gen, token = ++this.narrationToken; this.narrating = true;
    try { for (const id of ids) { if (gen !== this.gen || token !== this.narrationToken) break; await this.guide.speak(id); } }
    finally { if (token === this.narrationToken) this.narrating = false; }
  }

  begin() { this.cancelMedia(true); this.resetGrounding(); this.calmRequested = false; this.director.reset(); this.panel.placeInFront(); this.showConsent(); }

  // ---- screens ----
  showConsent() {
    this._setPhase('consent', .35); this.panel.setOrb('off'); this.openingStarted = false;
    this.panel.show({ opening: true, title: 'I am still here', body: '', buttons: [{ id: 'welcome', label: this.lang === 'de' ? 'Mit Ton beginnen' : 'Begin with sound' }] });
  }
  queueOpeningLine(id) {
    if (this.guide && this.guide.enabled !== false) { this.openingLine = id; this.openingLeadIn = .2; }
  }
  showIntro() {
    // Allow a short beat after speech, or enough reading time without a guide.
    this._setPhase('intro', this.guide && this.guide.enabled !== false ? .55 : 3);
    this.panel.show({ opening: true, warning: true, title: this.T.warningTitle, body: this.T.warningBody, buttons: [{ id: 'start', label: this.T.start }] });
    this.queueOpeningLine('warning');
  }
  showReady() {
    this._setPhase('ready'); this.queueOpeningLine('reminder');
    this.panel.show({ opening: true, title: '', body: this.T.headsetReminder, buttons: [{ id: 'start', label: this.T.start }] });
  }
  showEnd() {
    this.cancelMedia(true); this._setPhase('end'); const T = this.T; this.panel.setOrb('off');
    this.panel.show({ title: T.endTitle, body: T.endBody, buttons: [{ id: 'again', label: T.again }, { id: 'exit', label: T.exit }] });
    this.narrate('end');
  }

  pick(id) {
    switch (id) {
      case 'welcome': if (this.phase === 'consent' && !this.openingStarted) {
        this.openingStarted = true; this.guide?.unlock();
        this.panel.model.buttons = [{ id: 'start', label: this.T.start }]; this.panel._draw();
        this.narrate('welcome');
      } break;
      case 'mic': if (this.phase === 'grounding') this.toggleMicrophone(); break;
      case 'hint': if (this.phase === 'grounding') this.groundHint(); break;
      case 'start': if (['consent', 'intro', 'ready'].includes(this.phase)) {
        this.audio?.start?.(); this.mode = 'edu'; this.startRun();
      } break;
      case 'next': this.groundNext(); break;
      case 'skip': this.calmNow(); break;
      case 'again': this.begin(); break;
      case 'exit': this.cancelMedia(true); this.onExitVR?.(); break;
    }
  }

  setAssetsReady() {
    this.assetsReady = true;
    if(this.phase==='loading'&&!this.loadFailed)this.startRun();
  }

  startRun() {
    if(!this.assetsReady || this.loadFailed){
      this.cancelMedia(true);this._setPhase('loading');
      this.panel.show({opening:true,title:'',body:'',status:this.loadFailed
        ? (this.lang==='de'?'Der Raum konnte nicht geladen werden. Bitte neu laden.':'The room could not load. Please reload.')
        : (this.lang==='de'?'Der Raum wird geladen …':'Loading the room…'),buttons:[]});
      return;
    }
    this.audio?.resetSession?.();
    this._setPhase('observing', this.freeExplore ? 3 : this.observationSeconds);
    this.elapsed = 0; this.povElapsed = 0; this.calmRequested = false; this.cancelMedia(true);
    this.resetGrounding(); this.panel.hide();
    this.director.reset(); this.director.setCap(this.cap);
  }

  /** The camera journey reads phase/time; the anxiety starts only once embodiment finishes. */
  _updateJourney(dt) {
    let remaining = dt;
    while (this.phase === 'observing' || this.phase === 'embodying') {
      const step = Math.min(remaining, Math.max(0, this.phaseDuration - this.phaseTime));
      this.phaseTime += step; remaining -= step;
      if (this.phaseTime + 1e-9 < this.phaseDuration) return;
      if (this.phase === 'observing') this._setPhase(this.freeExplore ? 'exploring' : 'embodying', this.freeExplore ? 0 : this.embodimentSeconds);
      else {
        this._setPhase('running', this.anxietySeconds);
        this.director.sustain = true;
        this.director.startBuild();
      }
      if (remaining <= 0 && this.phaseDuration > 0) return;
    }
    this.phaseTime += remaining;
  }

  // ---- grounding 5-4-3-2-1 ----
  resetGrounding() {
    this.groundIdx = 0;
    this.groundProgress = GROUND_SENSES.map((sense, idx) => ({ sense, target: 5 - idx, items: new Set() }));
    this.groundItems = this.groundProgress[0].items;
  }
  groundRemaining(idx = this.groundIdx) {
    const step = this.groundProgress[idx];
    return step ? Math.max(0, step.target - step.items.size) : 0;
  }
  startGrounding() {
    if (this.phase === 'grounding') return;
    this.cancelMedia(); this.resetGrounding(); this._setPhase('grounding');
    this.director.sustain = false; this.director.setTargetOverride(0);
    this.panel.placeInFront(); this.groundShow(true);
  }
  groundButtons() { return [{ id: 'next', label: this.lang === 'de' ? 'Weiter' : 'Continue' }]; }
  groundShow(intro = false) {
    const step = this.groundProgress[this.groundIdx];
    this.groundItems = step.items; this.silenceRounds = 0;
    const { sense, target } = step;
    this.panel.setOrb('off');
    this.panel.show({ groundOnly: true, groundCount: target, groundLabel: GROUND_LABELS[this.lang][sense],
      title: '', body: '', status: '', buttons: this.groundButtons() });
    const gen = this.gen, idx = this.groundIdx;
    // A redraw must not restart the list or interrupt an active listening turn.
    if (this.listeningGen === gen || this.narrating) return;
    const ready = () => { if (this.currentGround(gen, idx)) this.enableGroundListening(gen, idx); };
    const prompts = step.items.size ? [`more${this.groundRemaining()}`] : [sense, ...(intro ? ['sayOutLoud'] : [])];
    if (this.guide) this.narrate(...prompts).then(ready);
    else ready();
  }
  micNotice() { return this.G.micUnavailable; }
  currentGround(gen, idx) { return gen === this.gen && idx === this.groundIdx && this.phase === 'grounding'; }
  async enableGroundListening(gen = this.gen, idx = this.groundIdx) {
    if (this.listeningGen === gen || !this.currentGround(gen, idx)) return;
    if (this.micPending) {
      await this.micPending;
      if (this.currentGround(gen, idx)) return this.enableGroundListening(gen, idx);
      return;
    }
    if (!this.voice?.available) {
      this.micPending = Promise.resolve().then(() => this.voice?.init()).catch(() => false);
      await this.micPending; this.micPending = null;
      if (!this.currentGround(gen, idx)) return;
    }
    if (!this.voice?.available) {
      this.panel.setStatus(this.micNotice()); await this.narrate('micUnavailable'); return;
    }
    this.listenLoop(gen, idx);
  }
  async toggleMicrophone() {
    if (this.phase !== 'grounding' || this.narrating || this.micPending || this.listeningGen === this.gen) return;
    await this.enableGroundListening();
  }
  async groundHint() {
    this.cancelMedia();
    const gen = this.gen, idx = this.groundIdx;
    await this.narrate('sayOutLoud');
    if (this.currentGround(gen, idx)) this.enableGroundListening(gen, idx);
  }
  async listenLoop(gen, idx) {
    if (this.listeningGen === gen) return;
    this.listeningGen = gen;
    const step = this.groundProgress[idx];
    try {
      while (this.currentGround(gen, idx) && this.voice?.available) {
        this.panel.setStatus(this.T.listening);
        if (this.audio) this.audio.listening = true;
        let text = null;
        try { text = await this.voice.listen(); } catch { /* A failed capture can be retried. */ }
        if (!this.currentGround(gen, idx)) return;
        if (this.audio) this.audio.listening = false;
        if (text == null) {
          this.voice.release?.(); this.panel.setStatus(this.micNotice());
          await this.narrate('micUnavailable'); return;
        }
        const response = groundingResponse(text);
        if (response.type === 'stop') { this.calmNow(); return; }
        if (response.type === 'items') {
          for (const item of response.items) {
            const key = item.toLocaleLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
            if (key) step.items.add(key);
          }
          const remaining = this.groundRemaining(idx);
          if (!remaining) { this.groundNext(); return; }
          if (remaining < 5) await this.narrate(`more${remaining}`);
          else await this.narrate('sayOutLoud');
        } else if (response.type === 'silence') {
          // Stay listening after silence; one short reminder, no forced advance.
          if (this.silenceRounds++ === 0) await this.narrate('sayOutLoud');
        } else {
          const remaining = this.groundRemaining(idx);
          await this.narrate(remaining < 5 ? `more${remaining}` : 'sayOutLoud');
        }
      }
    } finally {
      if (this.listeningGen === gen) { this.listeningGen = null; if (this.audio) this.audio.listening = false; }
    }
  }
  groundNext() {
    if (this.phase !== 'grounding') return;
    this.cancelMedia(); this.groundIdx++;
    if (this.groundIdx >= 5) { this.director.setTargetOverride(null); this.showEnd(); return; }
    this.groundShow();
  }

  // ---- breathing: the circle stays still until the spoken invitation ends ----
  startBreathing(thenGrounding = false) {
    this.cancelMedia(true); this._setPhase('breathing', this.breathing.count * (this.breathing.inhale + this.breathing.exhale));
    this.breathT = 0; this.afterBreathing = thenGrounding;
    this.director.sustain = false; this.director.setTargetOverride(null);
    this.director.calmNow(this.settlingSeconds);
    this.panel.placeInFront(); this.panel.orbScale = 1;
    this.panel.show({ breathOnly: true, title: '', body: '', buttons: [] }); this.panel.setOrb('breath');
    this.narrate('breathe');
  }

  /** Calm Now begins breathing; during recovery it also skips the remaining grounding. */
  calmNow() {
    if (['consent', 'intro', 'ready', 'end', 'declined', 'idle'].includes(this.phase)) { this.director.calmNow(); return; }
    this.director.sustain = false;
    this.calmRequested = true; this.cancelMedia();
    if (this.phase === 'breathing') { this.afterBreathing = false; return; }
    this.startBreathing(this.phase !== 'grounding');
  }

  update(dt, { inPerspective } = {}) {
    if (typeof document !== 'undefined' && document.hidden) return;
    // Hold the reminder indefinitely; the experience only begins on Start.
    if (['consent', 'intro', 'ready'].includes(this.phase)) {
      if (this.phase === 'consent' && !this.openingStarted) return;
      // Put the new text on screen before its matching line starts.
      if (this.openingLine) {
        this.openingLeadIn -= dt;
        if (this.openingLeadIn <= 0) { const line = this.openingLine; this.openingLine = null; this.narrate(line); }
        return;
      }
      if (this.narrating) return;
      if (this.phase === 'ready') return;
      this.phaseTime += dt;
      if (this.phaseTime >= this.phaseDuration) {
        if (this.phase === 'consent') this.showIntro(); else this.showReady();
      }
      return;
    }
    if (this.phase === 'observing' || this.phase === 'embodying') this._updateJourney(dt);
    else this.phaseTime += dt;
    if (['observing', 'embodying', 'running', 'grounding'].includes(this.phase)) {
      this.elapsed += dt;
    }
    // Only time actually spent in his view counts, after its transition ends.
    // Exploration, camera travel, hidden tabs, and returning to floating do not.
    if (this.phase === 'running' && (inPerspective ?? true) && !this.calmRequested) {
      this.povElapsed += Math.min(dt, this.phaseTime);
      if (this.povElapsed + 1e-9 >= this.povSeconds) { this.calmNow(); return; }
    }
    if (this.phase === 'breathing' && !this.narrating) {
      const { count: BREATHS, inhale: INHALE, exhale: EXHALE } = this.breathing;
      this.phaseDuration = BREATHS * (INHALE + EXHALE);
      this.breathT += dt; const cycle = INHALE + EXHALE, t = this.breathT % cycle, n = Math.floor(this.breathT / cycle);
      if (n >= BREATHS) { this.director.setTargetOverride(null); if (this.afterBreathing) this.startGrounding(); else this.showEnd(); return; }
      const inh = t < INHALE, k = inh ? t / INHALE : 1 - (t - INHALE) / EXHALE, e = k * k * (3 - 2 * k);
      this.panel.orbScale = 1 + 1.8 * e;

    }
  }
}
