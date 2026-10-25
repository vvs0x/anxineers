// Adapted from the user-provided fear-viewer/source/soundscapes/engine.js.
import * as Tone from "tone";

// Original instruments, harmony, rhythms, and ranges:
// https://github.com/leonarda4/Atmospheric-Soundscapes
const TRANSPORT_BPM = 76;
const START_DELAY = "+0.05";

function ramp(signal, value, seconds = 0.2) {
  signal.rampTo(value, seconds);
}

function stopLoop(loop) {
  loop.stop(0);
}

function releaseVoice(voice) {
  if (typeof voice.releaseAll === "function") {
    voice.releaseAll();
  } else if (typeof voice.triggerRelease === "function") {
    voice.triggerRelease();
  }
}

function randomItem(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function createSession(destination, onDispose) {
  const context = destination.context;
  const output = new Tone.Gain({ context, gain: 0 }).connect(destination);
  const nodes = [output];
  const parts = new Map();
  const cleanup = [];
  let stopped = false;
  let disposed = false;
  let disposeTimer;

  const session = {
    output,
    add(node) {
      nodes.push(node);
      return node;
    },
    addCleanup(task) {
      cleanup.push(task);
    },
    createPart(id, destinationNode) {
      const gate = session.add(new Tone.Gain({ context, gain: 1 }).connect(destinationNode));
      const controls = new Map();
      const part = {
        id,
        gate,
        enabled: true,
        onDisable() {},
        bindControl(controlId, apply) {
          controls.set(controlId, apply);
          return this;
        },
        setControlValue(controlId, value) {
          controls.get(controlId)?.(value);
        },
      };
      parts.set(id, part);
      return part;
    },
    fadeIn() {
      ramp(output.gain, 1, 0.45);
    },
    setPartEnabled(id, enabled) {
      const part = parts.get(id);
      if (!part || stopped || disposed) return;
      if (part.enabled === enabled) return;
      part.enabled = enabled;
      ramp(part.gate.gain, enabled ? 1 : 0, 1.2);
      if (!enabled) part.onDisable();
    },
    setPartControlValue(id, controlId, value) {
      if (!stopped && !disposed) parts.get(id)?.setControlValue(controlId, value);
    },
    stop() {
      if (stopped || disposed) return;
      stopped = true;
      cleanup.forEach((task) => task());
      parts.forEach((part) => {
        part.enabled = false;
        part.onDisable();
      });
      ramp(output.gain, 0, 0.45);
      disposeTimer = setTimeout(() => session.dispose(), 900);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(disposeTimer);
      parts.forEach((part) => { part.enabled = false; });
      [...nodes].reverse().forEach((node) => node.dispose());
      onDispose(session);
    },
  };
  return session;
}

function setToneOptions(node, options) {
  node.set(options);
}

function bindEnvelopeControl(part, controlId, node, parameter) {
  part.bindControl(controlId, (value) => {
    setToneOptions(node, { envelope: { [parameter]: value } });
  });
}

function bindFilterEnvelopeControl(part, controlId, node, parameter) {
  part.bindControl(controlId, (value) => {
    setToneOptions(node, { filterEnvelope: { [parameter]: value } });
  });
}

function bindVolumeControl(part, controlId, node, seconds = 0.12) {
  part.bindControl(controlId, (value) => ramp(node.volume, value, seconds));
}

function bindSignalControl(part, controlId, signal, seconds = 0.12) {
  part.bindControl(controlId, (value) => ramp(signal, value, seconds));
}

function buildFearful(destination, makeSession) {
  const context = destination.context;
  const session = makeSession(destination);
  const reverb = session.add(new Tone.Reverb({ context, decay: 7.2, wet: 0.78 }).connect(session.output));
  const tremolo = session.add(new Tone.Tremolo({ context, frequency: 4, depth: 0.5 }).connect(reverb));
  tremolo.start();

  const clusterPart = session.createPart("cluster", tremolo);
  const subPart = session.createPart("sub", session.output);
  const stabsPart = session.createPart("stabs", reverb);

  const cluster = session.add(
    new Tone.PolySynth({ context, voice: Tone.Synth, options: {
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0.3, decay: 0.3, sustain: 0.45, release: 3.4 },
      volume: -24,
    } }).connect(clusterPart.gate),
  );

  const sub = session.add(
    new Tone.MonoSynth({ context,
      oscillator: { type: "sine" },
      envelope: { attack: 0.05, decay: 0.25, sustain: 0.75, release: 1.6 },
      filterEnvelope: {
        attack: 0.01,
        decay: 0.2,
        sustain: 0.2,
        release: 0.8,
        baseFrequency: 50,
        octaves: 1.5,
      },
      volume: -16,
    }).connect(subPart.gate),
  );

  const stabs = session.add(
    new Tone.Synth({ context,
      oscillator: { type: "triangle" },
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.05, release: 1.1 },
      volume: -20,
    }).connect(stabsPart.gate),
  );

  let stabChance = 0.65;

  bindEnvelopeControl(clusterPart, "attack", cluster, "attack");
  bindEnvelopeControl(clusterPart, "release", cluster, "release");
  bindSignalControl(clusterPart, "tremolo", tremolo.depth);
  bindEnvelopeControl(subPart, "attack", sub, "attack");
  bindFilterEnvelopeControl(subPart, "sweep", sub, "octaves");
  bindEnvelopeControl(subPart, "release", sub, "release");
  bindEnvelopeControl(stabsPart, "attack", stabs, "attack");
  bindEnvelopeControl(stabsPart, "release", stabs, "release");
  stabsPart.bindControl("chance", (value) => {
    stabChance = value;
  });

  const clusterChords = [
    ["C4", "Db4", "Gb4"],
    ["B3", "C4", "F4"],
    ["A3", "Bb3", "E4"],
    ["C4", "F#4", "B4"],
  ];

  const subNotes = ["C2", "Bb1", "Ab1", "B1"];
  const stabNotes = ["C5", "Db5", "F#5", "A4", "B4"];

  let clusterStep = 0;
  let subStep = 0;

  const clusterLoop = session.add(
    new Tone.Loop({ context, callback: (time) => {
      if (!clusterPart.enabled) {
        return;
      }

      cluster.triggerAttackRelease(clusterChords[clusterStep % clusterChords.length], "2m", time, 0.35);
      clusterStep += 1;
    }, interval: "1m" }),
  );

  const subLoop = session.add(
    new Tone.Loop({ context, callback: (time) => {
      if (!subPart.enabled) {
        return;
      }

      sub.triggerAttackRelease(subNotes[subStep % subNotes.length], "1m", time, 0.82);
      subStep += 1;
    }, interval: "1m" }),
  );

  const stabsLoop = session.add(
    new Tone.Loop({ context, callback: (time) => {
      if (!stabsPart.enabled || Math.random() > stabChance) {
        return;
      }

      stabs.triggerAttackRelease(randomItem(stabNotes), "8n", time, 0.52);
    }, interval: "2n" }),
  );

  clusterPart.onDisable = () => releaseVoice(cluster);
  subPart.onDisable = () => releaseVoice(sub);
  stabsPart.onDisable = () => releaseVoice(stabs);

  clusterLoop.start(START_DELAY);
  subLoop.start(START_DELAY);
  stabsLoop.start(START_DELAY);
  session.addCleanup(() => stopLoop(clusterLoop));
  session.addCleanup(() => stopLoop(subLoop));
  session.addCleanup(() => stopLoop(stabsLoop));

  return session;
}

/** Exact Fear Viewer instruments, using the gallery's unlocked native context and bus. */
export function createFearSoundscape(audioContext, destination) {
  const context = new Tone.Context({ context: audioContext });
  const transport = context.transport;
  transport.bpm.value = TRANSPORT_BPM;
  const limiter = new Tone.Limiter({ context, threshold: -6 }).connect(destination);
  const output = new Tone.Gain({ context, gain: .9 }).connect(limiter);
  let session = null, generation = 0;
  let enabledParts = new Set(['cluster', 'sub']);
  const applyParts = () => { for (const id of ['cluster', 'sub', 'stabs']) session?.setPartEnabled(id, enabledParts.has(id)); };
  const fading = new Set();
  return {
    async start() {
      if (session) return;
      const request = ++generation;
      await context.resume();
      if (request !== generation) return;
      [...fading].forEach(s => s.dispose());
      session = buildFearful(output, target => {
        const created = createSession(target, ended => fading.delete(ended));
        fading.add(created); return created;
      });
      applyParts(); transport.start(); session.fadeIn();
    },
    stop() {
      generation++; session?.stop(); session = null; transport.stop();
    },
    setParts(parts) { enabledParts = new Set(parts); applyParts(); },
    get playing() { return Boolean(session); },
    dispose() {
      this.stop(); [...fading].forEach(s => s.dispose());
      output.dispose(); limiter.dispose();
      // The native context belongs to the whole gallery; never close it here.
    },
  };
}
