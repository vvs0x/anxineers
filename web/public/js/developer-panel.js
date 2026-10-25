import { MAX_ROOM_DIMMING, MAX_WALL_CONTRACTION } from './profiles.js';

const STORAGE_KEY = 'signal.developer-settings.v1';
const get = (app, path) => path.split('.').reduce((object, key) => object[key], app);
const set = (app, path, value) => { const keys = path.split('.'), key = keys.pop(); get(app, keys.join('.'))[key] = value; };

/** Only real runtime controls are listed; obsolete shader knobs are deliberately absent. */
export function tuningControls(app) {
  const controls = [], add = (section, path, label, min, max, step, unit = '') => controls.push({ section, path, label, min, max, step, unit });
  const percent = (section, path, label, max = 1) => add(section, path, label, 0, max, .01, '%');
  percent('Session', 'director.cap', 'Intensity cap');
  percent('Session', 'director.profile.peak', 'Peak intensity');
  for (const [key, label, max] of [['build', 'Build duration', 180], ['recovery', 'Recovery duration', 180]]) add('Session', `director.profile.${key}`, label, 1, max, 1, 's');
  add('Session', 'session.observationSeconds', 'Overview and orbit', 0, 90, .5, 's');
  add('Session', 'session.povSeconds', 'Breathing after time in his POV', 1, 180, 1, 's');
  add('Session', 'session.embodimentSeconds', 'Enter the body', .5, 10, .5, 's');
  add('POV blackout', 'effects.blackout.afterSeconds', 'Seconds in POV before darkness', 0, 180, 1, 's');
  add('POV blackout', 'effects.blackout.durationSeconds', 'One dark / light wave', 0, 20, .1, 's');
  add('POV blackout', 'effects.blackout.count', 'Darkness waves', 0, 4, 1);
  add('Breathing', 'session.breathing.count', 'Breath cycles', 1, 6, 1);
  add('Breathing', 'session.breathing.inhale', 'Breathe in', 1, 6, .5, 's');
  add('Breathing', 'session.breathing.exhale', 'Breathe out', 1, 8, .5, 's');
  for (const [key, label, max] of [['chairGrowth', 'Chair growth', .6], ['tableGrowth', 'Table growth', .3], ['objectGrowth', 'Sculpture growth', .6]]) percent('Furniture & gaze', `effects.s.${key}`, label, max);
  add('Furniture & gaze', 'effects.s.gazeDwellIn', 'Gaze build time', .1, 5, .1, 's');
  add('Furniture & gaze', 'effects.s.gazeDwellOut', 'Gaze release time', .1, 5, .1, 's');
  add('Furniture & gaze', 'effects.s.scaleResponse', 'Scale response speed', .5, 10, .1);
  add('Furniture & gaze', 'effects.s.objDrift', 'Sculpture drift', 0, .4, .01, 'm');
  add('Furniture & gaze', 'effects.s.objApproach', 'Sculpture approach', 0, .8, .01, 'm');
  percent('Walls', 'effects.wallGaze.amplitude', 'Inward movement at full anxiety', MAX_WALL_CONTRACTION);
  add('Walls', 'effects.wallGaze.introPulseCycles', 'Pulses before the close hold', 0, 4, 1);
  add('Walls', 'effects.wallGaze.holdAfterBlackoutSeconds', 'Hold inward after blackouts', 0, 60, 1, 's');
  add('Walls', 'effects.wallGaze.halfCycleSeconds', 'In / out duration', 1, 10, .1, 's');
  add('Walls', 'effects.wallGaze.releaseSeconds', 'Return to rest', .5, 8, .1, 's');
  for (const [key, label] of [['vignetteMax', 'Dark edge strength'], ['vignetteInner', 'Clear center radius'], ['desaturateMax', 'Color drain'], ['coolShiftMax', 'Cool tint']]) percent('Vision', `effects.s.${key}`, label);
  percent('Light & audio', 'effects.s.flickerDepth', 'Light variation');
  percent('Light & audio', 'effects.s.ambientDim', 'Room dimming', MAX_ROOM_DIMMING);
  add('Light & audio', 'effects.s.flickerHz', 'Light variation speed', .1, 2, .1, 'Hz');
  percent('Light & audio', 'effects.s.audioGain', 'Audio volume');
  add('Light & audio', 'effects.s.lightFullAngle', 'Light gaze inner angle', 1, 30, 1, '°');
  add('Light & audio', 'effects.s.lightFalloffAngle', 'Light gaze outer angle', 31, 60, 1, '°');
  add('Light & audio', 'effects.s.lightDwellIn', 'Light gaze build', .1, 5, .1, 's');
  add('Light & audio', 'effects.s.lightDwellOut', 'Light gaze release', .1, 5, .1, 's');
  for (const kind of ['Vision', 'Audio', 'Light', 'Objects']) {
    const section = `${kind} channel`;
    percent(section, `director.settings.${kind}.maxValue`, 'Strength');
    percent(section, `director.settings.${kind}.gazeWeight`, 'Gaze influence');
    add(section, `director.settings.${kind}.exponent`, 'Response curve', .25, 3, .05);
    add(section, `director.settings.${kind}.riseSpeed`, 'Rise speed', .05, 2, .05);
    add(section, `director.settings.${kind}.fallSpeed`, 'Fall speed', .05, 2, .05);
  }
  add('VR input', 'panel.distance', 'Menu distance', .8, 2, .05, 'm');
  add('VR input', 'panel.xrInput.settings.rayLength', 'Ray reach', 2.5, 10, .25, 'm');
  add('VR input', 'panel.xrInput.settings.pinchDistance', 'Pinch threshold', .01, .04, .001, 'm');
  add('VR input', 'panel.xrInput.settings.pinchHysteresis', 'Pinch release margin', .005, .025, .001, 'm');
  add('Rendering & visitors', 'renderer.toneMappingExposure', 'Exposure', .3, 2, .05);
  for (const [i] of (app.visitors?.visitors || []).entries()) add('Rendering & visitors', `visitors.visitors.${i}.speed`, `Visitor ${i + 1} speed`, .1, 1, .005, 'm/s');
  return controls;
}

export function createDeveloperPanel(app, { open = false } = {}) {
  const controls = tuningControls(app), defaults = Object.fromEntries(controls.map(c => [c.path, get(app, c.path)]));
  const togglePaths = ['panel.xrInput.settings.debug', 'panel.xrInput.settings.showHands', 'cursor.dot.visible'];
  for (const path of togglePaths) defaults[path] = get(app, path);
  const controlsByPath = new Map(controls.map(control => [control.path, control]));
  function apply(path, value) {
    const control = controlsByPath.get(path);
    if (control) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return;
      value = Math.min(control.max, Math.max(control.min, value));
      value = Number((Math.round(value / control.step) * control.step).toFixed(4));
    } else if (!togglePaths.includes(path) || typeof value !== 'boolean') return;
    set(app, path, value);
    if (path === 'director.cap') { app.director.setCap(value); app.session.cap = value; }
    if (path === 'session.observationSeconds' && app.session.phase === 'observing') app.session.phaseDuration = value;
    if (path === 'session.embodimentSeconds' && app.session.phase === 'embodying') app.session.phaseDuration = value;
    if (path === 'panel.distance' && app.panel.mesh.visible) app.panel.placeInFront();
  }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    // Upgrade only choreography controls; preserve unrelated visual/accessibility tuning.
    if (![3, 4].includes(saved.journeyVersion)) {
      for (const path of ['director.cap', 'director.profile.peak', 'director.profile.build', 'director.profile.hold',
        'session.observationSeconds', 'session.embodimentSeconds', 'session.anxietySeconds', 'session.runSeconds',
        'effects.wallGaze.amplitude', 'effects.wallGaze.dwellSeconds', 'effects.wallGaze.halfCycleSeconds',
        'effects.blackout.afterSeconds', 'effects.blackout.durationSeconds', 'effects.blackout.count',
        ...['Space', 'Vision', 'Audio', 'Light', 'Objects'].map(kind => `director.settings.${kind}.maxValue`)]) delete saved[path];
    }
    if (saved.journeyVersion !== 4) delete saved['session.observationSeconds'];
    for (const [path, value] of Object.entries(saved)) apply(path, value);
  } catch { /* A blocked or invalid local store must never stop the experience. */ }
  const toggle = document.createElement('button'); toggle.id = 'developer-toggle'; toggle.textContent = 'Developer settings';
  toggle.setAttribute('aria-controls', 'developer-panel');
  const aside = document.createElement('aside'); aside.id = 'developer-panel'; aside.setAttribute('aria-label', 'Developer settings'); aside.hidden = !open;
  aside.innerHTML = `<header><div><small>LIVE TUNING</small><h2>Developer settings</h2></div><button type="button" data-close aria-label="Close developer settings">×</button></header>
    <p class="dev-note">Changes apply live and save in this browser. Breathing defaults to 3 cycles. Session timings apply to the current or next matching phase.</p>
    <div class="dev-actions"><button data-action="peak">Preview peak</button><button data-action="calm">Calm now</button><button data-action="restart">Restart</button><button data-action="recenter">Recenter menu</button></div>
    <section class="dev-diagnostics"><h3>VR input diagnostics</h3><pre aria-live="off"></pre><div class="dev-toggles"></div></section>
    <div class="dev-controls"></div><footer><button data-reset>Reset defaults</button><span role="status">Saved on this device</span></footer>`;
  document.body.append(toggle, aside);
  document.getElementById('look-actions')?.append(toggle);
  const status = aside.querySelector('footer span');
  const values = () => ({...Object.fromEntries(Object.keys(defaults).map(path => [path, get(app, path)])),journeyVersion:4});
  function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(values())); status.textContent = 'Saved on this device'; } catch { status.textContent = 'Applied for this session'; } }
  function show(visible) { aside.hidden = !visible; toggle.hidden = visible; toggle.setAttribute('aria-expanded', String(visible)); if (visible) aside.querySelector('[data-close]').focus(); }
  toggle.onclick = () => show(aside.hidden); aside.querySelector('[data-close]').onclick = () => { show(false); toggle.focus(); };
  toggle.setAttribute('aria-expanded', String(open));
  toggle.hidden = open;
  const refreshers = [], sections = new Map();
  for (const control of controls) {
    if (!sections.has(control.section)) {
      const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = control.section;
      details.open = ['Session', 'Furniture & gaze'].includes(control.section); details.append(summary);
      aside.querySelector('.dev-controls').append(details); sections.set(control.section, details);
    }
    const label = document.createElement('label'), title = document.createElement('span'), output = document.createElement('output'), input = document.createElement('input');
    title.textContent = control.label; input.type = 'range'; input.min = control.min; input.max = control.max; input.step = control.step; input.dataset.setting = control.path;
    input.setAttribute('aria-label', `${control.section}: ${control.label}`);
    const refresh = () => {
      const value = get(app, control.path); input.value = value;
      output.value = control.unit === '%' ? `${Math.round(value * 100)}%` : `${Number(value.toFixed(3))}${control.unit ? ' ' + control.unit : ''}`;
      input.setAttribute('aria-valuetext', output.value);
    };
    input.oninput = () => { apply(control.path, input.valueAsNumber); refresh(); save(); };
    label.append(title, output, input); sections.get(control.section).append(label); refreshers.push(refresh); refresh();
  }
  for (const [i, text] of ['Show diagnostics in headset', 'Show tracked hand joints', 'Show head gaze dot'].entries()) {
    const label = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox';
    const path = togglePaths[i]; input.dataset.setting = path; input.onchange = () => { apply(path, input.checked); save(); };
    const refresh = () => { input.checked = get(app, path); }; refresh(); refreshers.push(refresh);
    label.append(input, document.createTextNode(text)); aside.querySelector('.dev-toggles').append(label);
  }
  aside.querySelector('[data-reset]').onclick = () => { for (const [path, value] of Object.entries(defaults)) apply(path, value); refreshers.forEach(fn => fn()); save(); };
  aside.querySelector('[data-action="peak"]').onclick = () => {
    // Use the regular scene journey first, so testing also exercises camera handoff.
    app.session.startRun(); app.session.update(app.session.observationSeconds + app.session.embodimentSeconds);
    app.journey.update(0, app.session); app.director.intensity = app.director.profile.peak; app.director.setState('Peak');
  };
  aside.querySelector('[data-action="calm"]').onclick = () => app.session.calmNow();
  aside.querySelector('[data-action="restart"]').onclick = () => app.session.begin();
  aside.querySelector('[data-action="recenter"]').onclick = () => app.panel.placeInFront();
  addEventListener('keydown', event => {
    if (event.key === 'Escape' && !aside.hidden) { show(false); toggle.focus(); }
    if (!event.defaultPrevented && event.key.toLowerCase() === 'd' && !event.target.closest?.('input, textarea, select, button') && !event.metaKey && !event.ctrlKey) show(aside.hidden);
  });
  let elapsed = 0;
  return { apply, values, show, update(dt) {
    elapsed += dt;
    if (!aside.hidden && elapsed > .2) {
      elapsed = 0;
      aside.querySelector('.dev-diagnostics pre').textContent = `${app.session.phase} · ${app.director.state} · intensity ${app.director.level.toFixed(2)}\nPOV ${app.session.povElapsed.toFixed(1)}s · blackout ${app.effects.blackout.amount ? 'on' : 'off'}\nGaze: ${app.gaze.hitObject?.group.name || app.gaze.hitRole || '—'}\n${app.panel.xrInput.diagnostics()}`;
    }
  } };
}
