// Cataratas: one classic script (no ES modules) so it also runs when index.html is opened
// straight from disk (file://), where browsers block module scripts.
(() => {
'use strict';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ===== rng =====
// Seeded randomness and smooth 1D noise (procedural-gen skill: deterministic, seedable).

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash1(n) {
  n = Math.imul(n ^ 0x27d4eb2d, 0x165667b1);
  n ^= n >>> 15;
  n = Math.imul(n, 0x85ebca6b);
  n ^= n >>> 13;
  return (n >>> 0) / 4294967296;
}

// Value noise in [0, 1], smoothstep-interpolated between integer lattice points.
function valueNoise(x, seed) {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash1(i * 374761 + seed * 668265);
  const b = hash1((i + 1) * 374761 + seed * 668265);
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}

// ===== save =====
// Versioned save with validation and safe fallbacks (save-systems skill).
// localStorage can throw or be empty (private mode, blocked storage), so every access is guarded.

const KEY = 'cataratas.save';
const VERSION = 1;

function defaults(reducedMotion) {
  return { v: VERSION, best: 0, sound: true, music: true, shake: !reducedMotion, sens: 1, tilt: false };
}

function migrate(obj, d) {
  if (!obj || typeof obj !== 'object') return d;
  const out = { ...d };
  // v0 (no version field) had only "best"; every later field falls back to defaults.
  if (Number.isFinite(obj.best) && obj.best >= 0) out.best = Math.floor(obj.best);
  if (typeof obj.sound === 'boolean') out.sound = obj.sound;
  if (typeof obj.shake === 'boolean') out.shake = obj.shake;
  if (typeof obj.music === 'boolean') out.music = obj.music;
  if (typeof obj.tilt === 'boolean') out.tilt = obj.tilt;
  if (obj.sens === 0 || obj.sens === 1 || obj.sens === 2) out.sens = obj.sens;
  out.v = VERSION;
  return out;
}

function loadSave(reducedMotion) {
  const d = defaults(reducedMotion);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    return migrate(JSON.parse(raw), d);
  } catch {
    return d;
  }
}

function writeSave(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable: the game keeps working, the record just isn't kept */
  }
}

// ===== input =====
// Input layer (input-systems skill): gameplay reads one "steer" action in [-1, 1].
// Sources: phone tilt (primary), touch halves (fallback), arrow keys (desktop test mode).

const DEG = Math.PI / 180;
const DEAD = 0.07; // radial deadzone on the normalized tilt
const CURVE = 1.35; // response curve: finer control near the centre
// Lateral gravity fraction (sin of the roll angle) that counts as full steer, per sensitivity.
const SENS_FULL = [0.5, 0.36, 0.25];
const SENS_LABELS = ['BAIXA', 'MÉDIA', 'ALTA'];
// Tilt steering is opt-in from the menu ("SENSOR"), and the option only appears when the page
// is served over HTTPS, since browsers only deliver motion sensor events to secure pages.
const tiltAvailable = window.isSecureContext === true && 'DeviceOrientationEvent' in window;

class Input {
  constructor(target) {
    this.raw = 0; // lateral gravity component in device x, -1..1
    this.neutral = 0;
    this.hasSensor = false;
    this.calibratePending = false;
    this.filtered = 0;
    this.sens = 1;
    this.tiltOn = false; // steer with the motion sensor (menu option)
    this.pointers = new Map(); // pointerId -> -1 | 1, insertion order = press order
    this.keyL = false;
    this.keyR = false;

    window.addEventListener('deviceorientation', (e) => this.onOrient(e));

    const setPointer = (e) => {
      this.pointers.delete(e.pointerId);
      this.pointers.set(e.pointerId, e.clientX < window.innerWidth / 2 ? -1 : 1);
    };
    target.addEventListener('pointerdown', (e) => {
      setPointer(e);
      e.preventDefault();
    });
    target.addEventListener('pointermove', (e) => {
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, e.clientX < window.innerWidth / 2 ? -1 : 1);
    });
    const up = (e) => this.pointers.delete(e.pointerId);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
    target.addEventListener('pointerleave', up);

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
  }

  onKey(e, down) {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.keyL = down;
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') this.keyR = down;
  }

  onOrient(e) {
    if (e.beta == null || e.gamma == null) return;
    // Device-frame gravity from the Z-X'-Y'' Euler angles: x = cos(beta) * sin(gamma).
    // Unlike raw gamma this stays smooth when the phone is held close to upright.
    let x = Math.cos(e.beta * DEG) * Math.sin(e.gamma * DEG);
    const angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    if (angle === 180) x = -x; // upside-down portrait
    this.raw = x;
    this.hasSensor = true;
    if (this.calibratePending) {
      this.neutral = clamp(x, -0.35, 0.35);
      this.calibratePending = false;
    }
  }

  // iOS 13+ needs an explicit permission prompt, and only from inside a tap handler.
  requestPermission() {
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      return DOE.requestPermission()
        .then((r) => r === 'granted')
        .catch(() => false);
    }
    return Promise.resolve(true);
  }

  // Whatever angle the player holds the phone at when the run starts becomes "straight".
  calibrate() {
    if (this.hasSensor) this.neutral = clamp(this.raw, -0.35, 0.35);
    else this.calibratePending = true;
    this.filtered = 0;
  }

  touchDir() {
    let dir = 0;
    for (const d of this.pointers.values()) dir = d; // newest press wins
    return dir;
  }

  getSteer(dt) {
    let target = 0;
    const td = this.touchDir();
    if (td !== 0) target = td;
    else if (this.keyL !== this.keyR) target = this.keyL ? -1 : 1;
    else if (this.tiltOn && this.hasSensor) {
      const v = (this.raw - this.neutral) / SENS_FULL[this.sens];
      const m = Math.min(Math.abs(v), 1);
      target = m <= DEAD ? 0 : Math.sign(v) * Math.pow((m - DEAD) / (1 - DEAD), CURVE);
    }
    // Light low-pass so sensor noise doesn't jitter the barrel.
    this.filtered += (target - this.filtered) * (1 - Math.exp(-dt * 22));
    return this.filtered;
  }
}

// ===== audio =====
const sfx = (() => {
// Synthesized retro audio with Web Audio (audio-design skill): one master bus,
// looped water bed that rises with difficulty, pitch-varied SFX so repeats don't sound mechanical.

let ac = null;
let master = null;
let noiseBuf = null;
let water = null;
let enabled = true;

function setEnabled(on) {
  enabled = on;
  if (master) master.gain.setTargetAtTime(on ? 1 : 0, ac.currentTime, 0.02);
}

// Must run inside a user gesture (mobile browsers start the context suspended).
function unlock() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = enabled ? 1 : 0;
    master.connect(ac.destination);
    const len = ac.sampleRate * 2;
    noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ac.state === 'suspended') ac.resume();
}

function suspend() {
  if (ac && ac.state === 'running') ac.suspend();
}

function resume() {
  if (ac && ac.state === 'suspended') ac.resume();
}

function noiseSource() {
  const s = ac.createBufferSource();
  s.buffer = noiseBuf;
  return s;
}

function startWater() {
  if (!ac || water) return;
  const src = noiseSource();
  src.loop = true;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 650;
  lp.Q.value = 0.4;
  const g = ac.createGain();
  g.gain.value = 0;
  g.gain.setTargetAtTime(0.08, ac.currentTime, 0.4);
  src.connect(lp).connect(g).connect(master);
  src.start();
  water = { src, lp, g };
}

function setWater(d) {
  if (!water) return;
  const t = ac.currentTime;
  water.lp.frequency.setTargetAtTime(600 + 900 * d, t, 0.4);
  water.g.gain.setTargetAtTime(0.07 + 0.06 * d, t, 0.4);
}

function stopWater(fade = 0.3) {
  if (!water) return;
  const t = ac.currentTime;
  water.g.gain.setTargetAtTime(0, t, fade);
  water.src.stop(t + fade * 6);
  water = null;
}

function env(g, t, peak, dur) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

function crash() {
  if (!ac || !enabled) return;
  const t = ac.currentTime;
  // Splash/crunch: noise through a closing lowpass.
  const n = noiseSource();
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(2600, t);
  lp.frequency.exponentialRampToValueAtTime(250, t + 0.55);
  const ng = ac.createGain();
  env(ng, t, 0.7, 0.6);
  n.connect(lp).connect(ng).connect(master);
  n.start(t);
  n.stop(t + 0.65);
  // Thud.
  const o = ac.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(38, t + 0.35);
  const og = ac.createGain();
  env(og, t, 0.6, 0.4);
  o.connect(og).connect(master);
  o.start(t);
  o.stop(t + 0.45);
  // Wood crack.
  const c = ac.createOscillator();
  c.type = 'square';
  c.frequency.setValueAtTime(260 + Math.random() * 60, t);
  c.frequency.exponentialRampToValueAtTime(90, t + 0.09);
  const cg = ac.createGain();
  env(cg, t, 0.18, 0.1);
  c.connect(cg).connect(master);
  c.start(t);
  c.stop(t + 0.12);
}

function splash() {
  if (!ac || !enabled) return;
  const t = ac.currentTime;
  const n = noiseSource();
  const hp = ac.createBiquadFilter();
  hp.type = 'bandpass';
  hp.frequency.value = 1800;
  hp.Q.value = 0.7;
  const g = ac.createGain();
  env(g, t, 0.35, 0.35);
  n.connect(hp).connect(g).connect(master);
  n.start(t);
  n.stop(t + 0.4);
}

function blip(notes, step = 0.075, vol = 0.07) {
  if (!ac || !enabled) return;
  const t0 = ac.currentTime;
  notes.forEach((f, i) => {
    const t = t0 + i * step;
    const o = ac.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    const g = ac.createGain();
    env(g, t, vol, step * 0.95);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + step);
  });
}

function tick() {
  if (!ac || !enabled) return;
  const t = ac.currentTime;
  const o = ac.createOscillator();
  o.type = 'triangle';
  o.frequency.value = 1300 * (0.93 + Math.random() * 0.14); // pitch variation
  const g = ac.createGain();
  env(g, t, 0.06, 0.05);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + 0.06);
}

  // Crowd cheering "uooeeeee": two tracks of voices panned apart and staggered so it sounds
  // like a bigger crowd. Each track is a bank of vowel formant filters gliding u -> o -> long e.
  const VOWELS = {
    a: [800, 1250, 2600],
    u: [320, 800, 2300],
    o: [500, 880, 2500],
    e: [430, 1950, 2650],
  };
  let cheerBus = null;

  function cheerTrack(t, dur, out, pan, count, oAt, eAt, nodes) {
    const bus = ac.createGain();
    bus.gain.value = 0.9 / Math.sqrt(count);
    let dest = out;
    if (ac.createStereoPanner) {
      const p = ac.createStereoPanner();
      p.pan.value = pan;
      p.connect(out);
      dest = p;
    }
    const start = VOWELS.u;
    const mid = VOWELS.o;
    const end = VOWELS.e;
    const amps = [1.0, 0.55, 0.22];
    for (let i = 0; i < 3; i++) {
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = i === 0 ? 3.5 : 5;
      bp.frequency.setValueAtTime(start[i], t);
      bp.frequency.setTargetAtTime(mid[i], t + oAt, 0.06);
      bp.frequency.setTargetAtTime(end[i], t + eAt, 0.12);
      const g = ac.createGain();
      g.gain.value = amps[i] * 2.4;
      bus.connect(bp).connect(g).connect(dest);
    }
    for (let i = 0; i < count; i++) {
      const male = Math.random() < 0.55;
      const f0 = male ? 105 + Math.random() * 70 : 195 + Math.random() * 130;
      const s0 = t + Math.random() * 0.25; // people don't start together
      const o = ac.createOscillator();
      o.type = Math.random() < 0.5 ? 'sawtooth' : 'triangle';
      o.frequency.setValueAtTime(f0 * 0.82, s0);
      o.frequency.exponentialRampToValueAtTime(f0 * (1.05 + Math.random() * 0.08), s0 + 0.3 + Math.random() * 0.2);
      o.frequency.setValueAtTime(f0 * 1.08, t + dur - 0.7);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.8, t + dur);
      const lfo = ac.createOscillator();
      lfo.frequency.value = 4 + Math.random() * 3;
      const lg = ac.createGain();
      lg.gain.value = f0 * (0.015 + Math.random() * 0.025);
      lfo.connect(lg).connect(o.frequency);
      const vg = ac.createGain(); // each voice at its own loudness, fading in
      const v = 0.5 + Math.random() * 0.5;
      vg.gain.setValueAtTime(0.0001, s0);
      vg.gain.exponentialRampToValueAtTime(v, s0 + 0.15);
      vg.gain.setValueAtTime(v, t + dur - 0.6 - Math.random() * 0.4);
      vg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(vg).connect(bus);
      o.start(s0);
      lfo.start(s0);
      o.stop(t + dur + 0.05);
      lfo.stop(t + dur + 0.05);
      nodes.push(o, lfo);
    }
    // breath/roar through the same vowel filters
    const n = noiseSource();
    n.loop = true;
    const ng = ac.createGain();
    ng.gain.value = 0.35;
    n.connect(ng).connect(bus);
    n.start(t);
    n.stop(t + dur + 0.05);
    nodes.push(n);
  }

  function cheer(dur = 2.6) {
    if (!ac || !enabled) return;
    stopCheer();
    const t = ac.currentTime;
    const out = ac.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.55, t + 0.15);
    out.gain.setValueAtTime(0.55, t + dur - 0.5);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = ac.createBiquadFilter(); // soften the synthetic buzz
    lp.type = 'lowpass';
    lp.frequency.value = 3800;
    out.connect(lp).connect(master);
    const nodes = [];
    cheerTrack(t, dur, out, -0.45, 7, 0.12, 0.45, nodes); // "uooeeee", left
    cheerTrack(t + 0.06, dur - 0.06, out, 0.45, 7, 0.16, 0.52, nodes); // "uooeeee", right
    cheerBus = { out, nodes };
  }
  function stopCheer() {
    if (!cheerBus) return;
    const t = ac.currentTime;
    cheerBus.out.gain.cancelScheduledValues(t);
    cheerBus.out.gain.setTargetAtTime(0, t, 0.08);
    for (const nd of cheerBus.nodes) {
      try {
        nd.stop(t + 0.4);
      } catch {
        /* already stopped */
      }
    }
    cheerBus = null;
  }

  // ---------- music: chiptune loop scheduled ahead on the audio clock ----------
  // 8 bars (Am F C G, twice; second pass ends with a run back to A). Square lead, triangle
  // bass, soft kick and noise hats. The tempo rises a little with the difficulty.
  const BASS_ROOTS = [45, 41, 48, 43];
  const LEAD = [
    [69, 72, 76, 72, 74, 72, 69, 0],
    [69, 72, 77, 76, 74, 72, 74, 0],
    [72, 76, 79, 76, 77, 76, 74, 72],
    [71, 74, 79, 74, 71, 67, 69, 71],
    [76, 0, 76, 79, 81, 79, 76, 72],
    [77, 76, 77, 81, 79, 77, 76, 74],
    [72, 76, 79, 84, 83, 79, 76, 79],
    [79, 77, 76, 74, 72, 71, 69, 0],
  ];
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  let musicBus = null;
  let musicOn = true;
  let music = null; // { timer, next, step }
  let bpm = 138;
  const MUSIC_LEVEL = 0.55;

  function setMusicEnabled(on) {
    musicOn = on;
    if (musicBus) musicBus.gain.setTargetAtTime(on ? MUSIC_LEVEL : 0, ac.currentTime, 0.05);
  }
  function musicNote(type, f, t, dur, vol) {
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.setValueAtTime(vol, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(musicBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  function musicKick(t) {
    const o = ac.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = ac.createGain();
    env(g, t, 0.35, 0.14);
    o.connect(g).connect(musicBus);
    o.start(t);
    o.stop(t + 0.16);
  }
  function musicHat(t, vol) {
    const n = noiseSource();
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = ac.createGain();
    env(g, t, vol, 0.04);
    n.connect(hp).connect(g).connect(musicBus);
    n.start(t, Math.random() * 1.5);
    n.stop(t + 0.05);
  }
  function scheduleStep(i, t, e) {
    const bar = Math.floor(i / 8) % 8;
    const k = i % 8;
    const root = BASS_ROOTS[bar % 4];
    const bassOff = [0, 12, 0, 12, 0, 12, 7, 12][k];
    musicNote('triangle', mtof(root + bassOff), t, e * 0.9, 0.32);
    const m = LEAD[bar][k];
    if (m) musicNote('square', mtof(m), t, e * 0.85, 0.07);
    if (k % 2 === 0) musicKick(t);
    musicHat(t + (k % 2 ? 0 : e / 2), k % 2 ? 0.05 : 0.03);
  }
  function startMusic() {
    if (!ac || music) return;
    if (!musicBus) {
      musicBus = ac.createGain();
      musicBus.connect(master);
    }
    musicBus.gain.cancelScheduledValues(ac.currentTime);
    musicBus.gain.setValueAtTime(musicOn ? MUSIC_LEVEL : 0, ac.currentTime);
    bpm = 138;
    music = { next: ac.currentTime + 0.08, step: 0, timer: 0 };
    const tick = () => {
      const e = 60 / bpm / 2; // eighth note
      while (music.next < ac.currentTime + 0.15) {
        scheduleStep(music.step, music.next, e);
        music.next += e;
        music.step = (music.step + 1) % 64;
      }
    };
    tick();
    music.timer = setInterval(tick, 30);
  }
  function setMusicIntensity(d) {
    bpm = 138 + 22 * d;
  }
  function stopMusic(fade = 0.08) {
    if (!music) return;
    clearInterval(music.timer);
    music = null;
    // notes already scheduled are cut by fading the bus; a fresh bus is made for the next run
    const t = ac.currentTime;
    musicBus.gain.cancelScheduledValues(t);
    musicBus.gain.setTargetAtTime(0, t, fade);
    musicBus = null;
  }
  // duck the music under the crowd's yell
  function duckMusic(dur) {
    if (!musicBus || !musicOn) return;
    const t = ac.currentTime;
    musicBus.gain.setTargetAtTime(MUSIC_LEVEL * 0.3, t, 0.05);
    musicBus.gain.setTargetAtTime(MUSIC_LEVEL, t + dur, 0.2);
  }

  // ---------- lose: a sad "uaaa... uaaa... uauaaaa" ----------
  // A voice-like sawtooth through vowel formant filters opening from "u" to "a" on each note,
  // stepping down in pitch; the last note wobbles u-a-u-a and droops.
  let loseNodes = [];
  function loseNote(t, f0, dur, wobble) {
    const o = ac.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0 * 1.04, t);
    o.frequency.exponentialRampToValueAtTime(f0, t + 0.08);
    if (wobble) o.frequency.exponentialRampToValueAtTime(f0 * 0.82, t + dur);
    const vib = ac.createOscillator();
    vib.frequency.value = 5.5;
    const vg = ac.createGain();
    vg.gain.value = f0 * 0.02;
    vib.connect(vg).connect(o.frequency);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.05);
    g.gain.setValueAtTime(0.5, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const amps = [1, 0.5, 0.2];
    for (let i = 0; i < 3; i++) {
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = i === 0 ? 4 : 6;
      bp.frequency.setValueAtTime(VOWELS.u[i], t);
      if (wobble) {
        // u-a-u-a-a
        const marks = [0.12, 0.3, 0.48, 0.66];
        marks.forEach((m, k) => bp.frequency.setTargetAtTime((k % 2 ? VOWELS.u : VOWELS.a)[i], t + m, 0.05));
      } else bp.frequency.setTargetAtTime(VOWELS.a[i], t + 0.06, 0.07);
      const bg = ac.createGain();
      bg.gain.value = amps[i] * 2.2;
      o.connect(bp).connect(bg).connect(g);
    }
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    g.connect(lp).connect(master);
    o.start(t);
    vib.start(t);
    o.stop(t + dur + 0.05);
    vib.stop(t + dur + 0.05);
    loseNodes.push(o, vib);
  }
  function lose(delay = 0.35) {
    if (!ac || !enabled) return;
    stopLose();
    const t = ac.currentTime + delay;
    loseNote(t, 196, 0.42, false); // G3  "uaaa"
    loseNote(t + 0.5, 185, 0.42, false); // F#3 "uaaa"
    loseNote(t + 1.0, 175, 1.3, true); // F3  "uauaaaa"
  }
  function stopLose() {
    const t = ac ? ac.currentTime : 0;
    for (const nd of loseNodes) {
      try {
        nd.stop(t + 0.03);
      } catch {
        /* already stopped */
      }
    }
    loseNodes = [];
  }

  return {
    setEnabled, unlock, suspend, resume, startWater, setWater, stopWater, crash, splash, blip, tick, cheer, stopCheer,
    setMusicEnabled, startMusic, stopMusic, setMusicIntensity, duckMusic, lose, stopLose,
  };
})();

// ===== sprites =====

// Fan in a yellow raincoat cheering with both arms up. Two frames (arms high / pumped down)
// for the waving loop. 9x14 px.
const FAN_FRAMES = [
  [
    's.......s',
    'Y.......Y',
    'Y..ooo..Y',
    'Y.oYhYo.Y',
    'YoYsssYoY',
    '.oYsmsYo.',
    '.oYYYYYo.',
    '..oYyYo..',
    '..oYyYo..',
    '..oyYyo..',
    '..oYyYo..',
    '..ooooo..',
    '...b.b...',
    '...b.b...',
  ],
  [
    '.........',
    's.......s',
    'Y..ooo..Y',
    'Y.oYhYo.Y',
    'YoYsssYoY',
    '.oYsmsYo.',
    '.oYYYYYo.',
    '..oYyYo..',
    '..oYyYo..',
    '..oyYyo..',
    '..oYyYo..',
    '..ooooo..',
    '...b.b...',
    '...b.b...',
  ],
];
function makeFan(skin, frame) {
  const pal = { s: skin, Y: '#ffd23f', y: '#d9a514', h: '#fff3a0', o: '#2a2108', m: '#3a0d0d', b: '#2b3a4a' };
  const rows = FAN_FRAMES[frame];
  return paint(9, rows.length, (i, j) => pal[rows[j][i]] || null);
}
// Rider inside the barrel: head in a yellow raincoat hood, 10x9 px. Only the rows above the
// barrel's rim show; "look" moves the eyes (-1 left, 0 ahead, 1 right).
const RIDER_ROWS = [
  '...oooo...',
  '..oYYYYo..',
  '.oYhhYYYo.',
  '.oYYYYYYo.',
  'oYssssssYo',
  'oYssssssYo',
  'oYssssssYo',
  '.oYYYYYYo.',
  'oYYyYYyYYo',
];
function makeRider(look) {
  const pal = { Y: '#ffd23f', y: '#d9a514', h: '#fff3a0', o: '#2a2108', s: '#f1c27d', E: '#1a1a1a' };
  const eyes = [3 + look, 6 + look];
  return paint(10, RIDER_ROWS.length, (i, j) => (j === 5 && eyes.includes(i) ? pal.E : pal[RIDER_ROWS[j][i]] || null));
}
// Pixel-art sprites generated once at load into offscreen canvases (no image files to fetch).

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function paint(w, h, colorAt) {
  const c = makeCanvas(w, h);
  const x = c.getContext('2d');
  const img = x.createImageData(w, h);
  const cache = {};
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const col = colorAt(i, j);
      if (!col) continue;
      const rgb = cache[col] || (cache[col] = hexToRgb(col));
      const k = (j * w + i) * 4;
      img.data[k] = rgb[0];
      img.data[k + 1] = rgb[1];
      img.data[k + 2] = rgb[2];
      img.data[k + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  return c;
}

// 20x24 side-view barrel: bulging staves, two iron hoops.
function makeBarrel() {
  const W = BARREL_W;
  const H = BARREL_H;
  return paint(W, H, (i, j) => {
    const hw = 7 + Math.round(3 * Math.sin((Math.PI * (j + 0.5)) / H));
    const x0 = W / 2 - hw;
    const x1 = W / 2 + hw - 1;
    if (i < x0 || i > x1) return null;
    const rel = i - x0;
    const span = x1 - x0;
    if (i === x0 || i === x1 || j === 0 || j === H - 1) return '#2a1606';
    if (j === 1) return '#5a3416';
    if (j === 4 || j === 5 || j === 18 || j === 19) return rel <= span * 0.35 ? '#c3cad4' : rel >= span * 0.8 ? '#555b66' : '#868d99';
    if (j === 6 || j === 20) return '#3e434c';
    if (rel % 3 === 0) return '#6e4420';
    if (rel === 2 || rel === 4 || rel === 5) return '#cf9a5c';
    if (rel >= span - 2) return '#74471f';
    return '#a66a31';
  });
}

// Round-ish boulder with a lit top-left, dark outline and a little moss.
function makeRock(r, seed) {
  const rnd = mulberry32(seed);
  const p1 = rnd() * 6.283;
  const p2 = rnd() * 6.283;
  const a1 = 0.06 + rnd() * 0.08;
  const a2 = 0.04 + rnd() * 0.06;
  const s = 2 * r + 3;
  const c = s / 2;
  const mask = new Uint8Array(s * s);
  for (let j = 0; j < s; j++) {
    for (let i = 0; i < s; i++) {
      const dx = i + 0.5 - c;
      const dy = j + 0.5 - c;
      const ang = Math.atan2(dy, dx);
      const rr = r * (0.9 + a1 * Math.sin(3 * ang + p1) + a2 * Math.sin(5 * ang + p2));
      mask[j * s + i] = dx * dx + dy * dy <= rr * rr ? 1 : 0;
    }
  }
  const at = (i, j) => (i < 0 || j < 0 || i >= s || j >= s ? 0 : mask[j * s + i]);
  return paint(s, s, (i, j) => {
    if (!at(i, j)) return null;
    if (!at(i - 1, j) || !at(i + 1, j) || !at(i, j - 1) || !at(i, j + 1)) return '#151821';
    const dx = i + 0.5 - c;
    const dy = j + 0.5 - c;
    const l = (-dx * 0.55 - dy * 0.85) / r + (rnd() - 0.5) * 0.3;
    if (dy < -r * 0.35 && rnd() < 0.14) return '#4e7d3a';
    if (l > 0.6) return '#b7bfcc';
    if (l > 0.2) return '#7c8393';
    if (l > -0.35) return '#555b69';
    return '#363a46';
  });
}

// Seamless cobblestone tile for the side walls.
function makeStoneTile(T, seed) {
  const rnd = mulberry32(seed);
  const id = new Int16Array(T * T).fill(-1);
  const stones = [];
  for (let k = 0; k < 80; k++) {
    const cx = Math.floor(rnd() * T);
    const cy = Math.floor(rnd() * T);
    const rx = 3 + rnd() * 6;
    const ry = 2.5 + rnd() * 4.5;
    stones.push({ tone: rnd(), moss: rnd() < 0.14 });
    const ix = Math.ceil(rx);
    const iy = Math.ceil(ry);
    for (let j = -iy; j <= iy; j++) {
      for (let i = -ix; i <= ix; i++) {
        if ((i * i) / (rx * rx) + (j * j) / (ry * ry) > 1) continue;
        const X = (((cx + i) % T) + T) % T;
        const Y = (((cy + j) % T) + T) % T;
        if (id[Y * T + X] === -1) id[Y * T + X] = k;
      }
    }
  }
  const get = (i, j) => id[(((j % T) + T) % T) * T + (((i % T) + T) % T)];
  return paint(T, T, (i, j) => {
    const k = get(i, j);
    if (k < 0) return '#1a1d25';
    if (get(i, j + 1) !== k || get(i + 1, j) !== k) return '#2a2e38';
    if (get(i, j - 1) !== k || get(i - 1, j) !== k) return stones[k].moss ? '#5d8a45' : '#8a92a3';
    if (stones[k].moss) return '#3f6236';
    const t = stones[k].tone;
    return t < 0.33 ? '#474d5a' : t < 0.66 ? '#525866' : '#5d6475';
  });
}

// Vertical water streaks, tiles seamlessly in Y.
function makeWaterTile(w, h, seed) {
  const rnd = mulberry32(seed);
  const c = makeCanvas(w, h);
  const x = c.getContext('2d');
  x.fillStyle = '#1f5fae';
  x.fillRect(0, 0, w, h);
  const cols = ['#2a6fc0', '#2a6fc0', '#3e88d6', '#17508f', '#17508f'];
  for (let i = 0; i < w; i++) {
    const n = 2 + Math.floor(rnd() * 4);
    for (let k = 0; k < n; k++) {
      x.fillStyle = cols[Math.floor(rnd() * cols.length)];
      const len = 4 + Math.floor(rnd() * 26);
      const y0 = Math.floor(rnd() * h);
      x.fillRect(i, y0, 1, Math.min(len, h - y0));
      if (y0 + len > h) x.fillRect(i, 0, 1, y0 + len - h);
    }
  }
  return c;
}

// Sparse white foam dashes on transparency (faster parallax layer).
function makeFoamTile(w, h, seed) {
  const rnd = mulberry32(seed);
  const c = makeCanvas(w, h);
  const x = c.getContext('2d');
  for (let k = 0; k < 90; k++) {
    x.fillStyle = rnd() < 0.6 ? '#d8eeff' : '#8cc6ff';
    const len = 2 + Math.floor(rnd() * 7);
    const xx = Math.floor(rnd() * w);
    const y0 = Math.floor(rnd() * h);
    x.fillRect(xx, y0, 1, Math.min(len, h - y0));
    if (y0 + len > h) x.fillRect(xx, 0, 1, y0 + len - h);
  }
  return c;
}

// ===== game =====

// ---------- constants ----------
const W = 180; // internal pixel width; height follows the screen's aspect
const STEP = 1 / 120; // fixed simulation step (physics-tuning skill)
const MAX_STEPS = 8; // clamp catch-up after a hitch
const BARREL_W = 20; // barrel sprite size (px)
const BARREL_H = 24;
const BARREL_R = 8.5;
const BARREL_POS = 0.45; // barrel's resting row, as a fraction of the screen height
const INTRO_DUR = 2.2; // seconds the barrel takes to float down from above the screen
const MAX_VX = 135; // px/s lateral
const PX_PER_M = 10;
const HIT_R = BARREL_R * 0.85; // forgiving hitboxes (game-feel: near misses should feel fair)

const lerp = (a, b, t) => a + (b - a) * t;
const easeOutBack = (k) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const m = k - 1;
  return 1 + c3 * m * m * m + c1 * m * m;
};

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d', { alpha: false });
const ui = {
  hud: $('hud'),
  score: $('score'),
  best: $('best'),
  pop: $('pop'),
  hint: $('hint'),
  title: $('title'),
  titleBest: $('titleBest'),
  over: $('over'),
  overScore: $('overScore'),
  overBest: $('overBest'),
  newRec: $('newRec'),
  pause: $('pause'),
  rotate: $('rotate'),
  desktop: $('desktop'),
  desktopUrl: $('desktopUrl'),
  soundBtn: $('soundBtn'),
  shakeBtn: $('shakeBtn'),
  musicBtn: $('musicBtn'),
  tiltBtn: $('tiltBtn'),
  sensBtn: $('sensBtn'),
  howTo: $('howTo'),
  aee: $('aee'),
};

// ---------- platform ----------
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const save = loadSave(reducedMotion);
const params = new URLSearchParams(location.search);
const ua = navigator.userAgent;
const touchCapable = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
const mobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const coarse = matchMedia('(pointer: coarse)').matches;
const smallScreen = Math.min(screen.width, screen.height) <= 1024;
const isMobile = (mobileUA || (touchCapable && coarse)) && smallScreen;
const pcMode = params.has('pc'); // desktop test mode: arrow keys
const testGaps = params.has('test') ? [] : null; // guaranteed gaps, recorded for automated checks
const playable = isMobile || pcMode;

const input = new Input(canvas);
input.sens = save.sens;
if (!tiltAvailable) save.tilt = false;
input.tiltOn = save.tilt;
sfx.setEnabled(save.sound);
sfx.setMusicEnabled(save.music);

// ---------- sprites ----------
const barrelSpr = makeBarrel();
const riderSprs = { '-1': makeRider(-1), 0: makeRider(0), 1: makeRider(1) };
const RIDER_LOW = 3; // rows above the rim while ducked: just the top of the hood
const RIDER_HIGH = 8; // rows above the rim while peeking: hood, eyes and collar
const rockSprs = {};
for (let r = 4; r <= 9; r++) rockSprs[r] = [0, 1, 2].map((v) => makeRock(r, r * 131 + v * 17 + 5));
const wallPattern = ctx.createPattern(makeStoneTile(64, 1234), 'repeat');
const waterTile = makeWaterTile(W + 16, 128, 99);
const foamTile = makeFoamTile(W + 16, 160, 77);
const FAN_SKINS = ['#f1c27d', '#8d5524', '#ffdbac', '#c68642', '#e0ac69'];
const fanSprs = FAN_SKINS.map((s) => [makeFan(s, 0), makeFan(s, 1)]);
// Crowd on a stone staircase: step 0 is against the screen edge and highest, each next step
// is one riser lower towards the middle. One fan per step.
const STEP_W = 9;
const STEP_RISE = 4;
const CROWD = [
  { skin: 2, ph: 0.3 },
  { skin: 0, ph: 0.9 },
  { skin: 3, ph: 0 },
  { skin: 1, ph: 0.5 },
  { skin: 4, ph: 0.2 },
];
const STAIRS_TOP = CROWD.length * STEP_RISE; // height of the top step above the base line
const CHEER_DUR = 2.8;
const CHEER_EVERY = 1000;

// ---------- particles (pooled ring buffer: no per-hit allocation) ----------
const MAXP = 360;
const parts = Array.from({ length: MAXP }, () => ({ on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, c: '#fff', s: 1, g: 0 }));
let pIdx = 0;
function emit(x, y, vx, vy, life, c, s = 1, g = 0) {
  const p = parts[pIdx];
  pIdx = (pIdx + 1) % MAXP;
  p.on = true;
  p.x = x;
  p.y = y;
  p.vx = vx;
  p.vy = vy;
  p.life = life;
  p.c = c;
  p.s = s;
  p.g = g;
}

// ---------- state ----------
let H = 320;
let barrelY = 160; // barrel's resting screen row
let curBY = -BARREL_H; // barrel's current screen row (differs from barrelY during the drop-in)
const G = {
  state: 'title', // title | playing | paused | dying | over
  t: 0,
  cam: 0,
  prevCam: 0,
  startCam: 0,
  speed: 0,
  bx: W / 2,
  prevBx: W / 2,
  vx: 0,
  rocks: [],
  nextRowY: 0,
  curSpacing: 1e4,
  rowIndex: 0,
  prevGap: W / 2,
  rng: mulberry32(1),
  seedL: 17,
  seedR: 5023,
  hitStopUntil: 0,
  trauma: 0,
  shakeT: 0,
  flash: 0,
  deathT: 0,
  meters: 0,
  nextMilestone: 100,
  beatBest: false,
  lockUntil: 0,
  playT: 0,
  squash: 0,
  waterTimer: 0,
  hintShown: false,
  cheerT: -1, // >= 0 while the 1000 m easter egg is on screen
  cheerSide: 1,
  introT: 0,
  landed: false,
  peekWait: 1.5, // seconds until the rider next lifts their head
  peekAge: -1, // >= 0 while peeking
  peekDur: 1,
};

// ---------- world shape ----------
const diff = (dist) => 1 - Math.exp(-dist / 11000); // 0 -> 1, eased difficulty
const speedFor = (d) => lerp(72, 190, d);
function amp(wy) {
  const dist = Math.max(0, wy - G.startCam);
  return 4 + 20 * (1 - Math.exp(-dist / 14000));
}
function wallL(wy) {
  return 11 + amp(wy) * valueNoise(wy * 0.0055, G.seedL) + 2.5 * valueNoise(wy * 0.045, G.seedL + 11);
}
function wallR(wy) {
  return W - 11 - amp(wy) * valueNoise(wy * 0.0055, G.seedR) - 2.5 * valueNoise(wy * 0.045, G.seedR + 11);
}

// Pacing (level-design skill): teach rows first, then a sawtooth where every 16th-row cycle
// ends in 4 calmer rows so each harder stretch lands after a breather.
const isCalm = (i) => i >= 4 && i % 16 >= 12;

function fillSeg(a, b, wy, p) {
  let x = a;
  let n = 0;
  while (b - x >= 8) {
    let r = 4 + Math.floor(G.rng() * 6);
    if (2 * r > b - x) r = Math.floor((b - x) / 2);
    if (r < 4) break;
    if (G.rng() < p) {
      G.rocks.push({ wy: wy + (G.rng() * 2 - 1) * 5, x: x + r, r, spr: rockSprs[r][Math.floor(G.rng() * 3)], passed: false });
      n++;
    }
    x += 2 * r + 1 + Math.floor(G.rng() * 3);
  }
  return n;
}

// Every row keeps one guaranteed gap, and the gap only moves as far as the barrel can
// travel before the row arrives (procedural-gen: constrain generation to stay solvable).
function spawnRow() {
  const wy = G.nextRowY;
  const d = diff(wy - G.startCam);
  const i = G.rowIndex;
  const teach = i < 4;
  const calm = isCalm(i);
  const gapW = lerp(56, 37, d) + (calm ? 10 : 0) + (teach ? 14 : 0);
  const p = teach ? 0.3 : calm ? 0.3 : lerp(0.5, 0.95, d);
  const L = Math.max(wallL(wy - 14), wallL(wy), wallL(wy + 14));
  const R = Math.min(wallR(wy - 14), wallR(wy), wallR(wy + 14));
  const lo = L + gapW / 2 + 3;
  const hi = R - gapW / 2 - 3;
  const maxShift = MAX_VX * (G.curSpacing / speedFor(d)) * 0.55;
  let g = lo + G.rng() * (hi - lo);
  g = clamp(g, G.prevGap - maxShift, G.prevGap + maxShift);
  g = clamp(g, lo, hi);
  const left = g - gapW / 2;
  const right = g + gapW / 2;
  let placed = fillSeg(L - 7, left, wy, p) + fillSeg(right, R + 7, wy, p);
  if (!placed && !calm && !teach) {
    const r = 6;
    const x = G.rng() < 0.5 ? left - r - 1 : right + r + 1;
    G.rocks.push({ wy, x, r, spr: rockSprs[r][0], passed: false });
  }
  if (testGaps) testGaps.push({ wy, left, right });
  G.prevGap = g;
  G.rowIndex++;
  const nd = diff(wy + 80 - G.startCam);
  G.curSpacing = lerp(108, 62, nd) * (isCalm(G.rowIndex) ? 1.7 : 1);
  G.nextRowY += G.curSpacing;
}

// ---------- flow ----------
function show(el, on) {
  el.hidden = !on;
}

function resetRun() {
  const seed = (Math.random() * 2 ** 31) | 0;
  G.rng = mulberry32(seed);
  G.startCam = G.cam;
  G.nextRowY = G.cam + H + 30;
  G.curSpacing = 1e4;
  G.rowIndex = 0;
  G.prevGap = W / 2;
  G.rocks.length = 0;
  if (testGaps) testGaps.length = 0;
  G.bx = G.prevBx = W / 2;
  G.vx = 0;
  G.speed = speedFor(0);
  G.meters = 0;
  G.nextMilestone = 100;
  G.beatBest = false;
  G.playT = 0;
  G.squash = 0;
  G.introT = 0;
  G.landed = false;
  curBY = -BARREL_H;
  G.trauma = 0;
  G.flash = 0;
  G.hintShown = false;
  endCheer();
}

function start() {
  if (!playable || G.state === 'playing') return;
  if (performance.now() < G.lockUntil) return;
  sfx.unlock();
  if (input.tiltOn) input.requestPermission(); // iOS prompt; must be called synchronously from the tap
  input.calibrate();
  resetRun();
  G.state = 'playing';
  show(ui.title, false);
  show(ui.over, false);
  show(ui.pause, false);
  show(ui.hud, true);
  ui.score.textContent = '0 m';
  ui.best.textContent = `REC ${save.best} m`;
  ui.best.classList.remove('beat');
  showHint(pcMode ? 'USE ← → NO TECLADO' : input.tiltOn ? 'INCLINE O CELULAR' : 'TOQUE À ESQUERDA<br>OU À DIREITA');
  sfx.stopLose();
  sfx.startWater();
  sfx.startMusic();
  sfx.splash();
  requestWakeLock();
  setTimeout(() => {
    if (input.tiltOn && G.state === 'playing' && !input.hasSensor && !pcMode) showHint('SEGURE À ESQUERDA<br>OU À DIREITA');
  }, 1200);
}

function showHint(html) {
  ui.hint.innerHTML = html;
  show(ui.hint, true);
  G.hintShown = true;
}

function die() {
  G.state = 'dying';
  G.deathT = 0;
  const now = performance.now();
  G.hitStopUntil = now + 120; // hit-stop: freeze the impact frame
  G.trauma = Math.min(1, G.trauma + 0.9);
  G.flash = reducedMotion ? 0 : 0.07; // single flash, well under 3/s
  sfx.crash();
  sfx.stopWater(0.35);
  sfx.stopMusic();
  sfx.lose();
  endCheer();
  if (navigator.vibrate) navigator.vibrate([70, 40, 120]);
  const by = G.cam + curBY;
  for (let k = 0; k < 18; k++) {
    const a = Math.random() * Math.PI * 2;
    const v = 40 + Math.random() * 70;
    emit(G.bx, by, Math.cos(a) * v, Math.sin(a) * v, 0.8 + Math.random() * 0.6, k % 3 ? '#a66a31' : '#6e4420', 2, 160);
  }
  for (let k = 0; k < 5; k++) {
    const a = Math.random() * Math.PI * 2;
    emit(G.bx, by, Math.cos(a) * 60, Math.sin(a) * 60, 1, '#868d99', 2, 200);
  }
  for (let k = 0; k < 28; k++) {
    const a = Math.random() * Math.PI * 2;
    const v = 20 + Math.random() * 90;
    emit(G.bx, by, Math.cos(a) * v, Math.sin(a) * v - 30, 0.4 + Math.random() * 0.4, k % 2 ? '#ffffff' : '#bfe3ff', 1, 120);
  }
  show(ui.hint, false);
}

function gameOver() {
  G.state = 'over';
  const m = G.meters;
  const rec = m > save.best;
  if (rec) {
    save.best = m;
    writeSave(save);
  }
  ui.overScore.textContent = `${m} m`;
  ui.overBest.textContent = save.best;
  ui.titleBest.textContent = save.best;
  show(ui.newRec, rec);
  show(ui.hud, false);
  show(ui.over, true);
  G.lockUntil = performance.now() + 650; // avoid restarting with a stray tap
  if (rec) sfx.blip([523, 659, 784, 1047], 0.09);
  releaseWakeLock();
}

function toTitle() {
  if (performance.now() < G.lockUntil) return;
  G.state = 'title';
  show(ui.over, false);
  show(ui.title, true);
}

function pause() {
  if (G.state !== 'playing') return;
  G.state = 'paused';
  show(ui.pause, true);
  sfx.suspend();
}

function resume() {
  if (G.state !== 'paused') return;
  if (!ui.rotate.hidden) return;
  G.state = 'playing';
  show(ui.pause, false);
  sfx.resume();
  input.filtered = 0;
  acc = 0;
  last = performance.now();
  G.hitStopUntil = last + 350; // short beat to get your grip back
}

function milestone(m) {
  ui.pop.textContent = `${m} m!`;
  ui.pop.classList.remove('show');
  void ui.pop.offsetWidth; // restart the CSS animation
  ui.pop.classList.add('show');
  if (m % CHEER_EVERY === 0) startCheer();
  else sfx.blip([660, 990], 0.07, 0.06);
}

// Easter egg: every 1000 m a crowd in yellow raincoats pops up in a random bottom corner
// and yells "AEEEEEE!" while the screen shakes.
function startCheer() {
  G.cheerT = 0;
  G.cheerSide = Math.random() < 0.5 ? -1 : 1;
  sfx.cheer(CHEER_DUR);
  sfx.duckMusic(CHEER_DUR);
  if (navigator.vibrate) navigator.vibrate([40, 60, 40, 60, 40]);
  const scale = canvas.clientHeight / H;
  ui.aee.style.left = G.cheerSide < 0 ? '10px' : 'auto';
  ui.aee.style.right = G.cheerSide > 0 ? '10px' : 'auto';
  ui.aee.style.bottom = `calc(env(safe-area-inset-bottom, 0px) + ${Math.round((STAIRS_TOP + 18) * scale)}px)`;
  ui.aee.classList.toggle('right', G.cheerSide > 0);
  ui.aee.textContent = 'U';
  show(ui.aee, true);
}

function endCheer() {
  G.cheerT = -1;
  show(ui.aee, false);
  sfx.stopCheer();
}

function updateCheer(dt) {
  if (G.cheerT < 0) return;
  G.cheerT += dt;
  if (G.cheerT >= CHEER_DUR) {
    endCheer();
    return;
  }
  G.trauma = Math.max(G.trauma, 0.6); // keeps shaking for the whole yell
  // "U" -> "UOO" -> "UOOEEEEEEE!", following the vowels of the yell
  const t = G.cheerT;
  const txt = t < 0.12 ? 'U' : t < 0.3 ? 'UO' : t < 0.45 ? 'UOO' : `UOO${'E'.repeat(Math.min(8, 1 + Math.floor((t - 0.45) * 9)))}${t > 1.2 ? '!' : ''}`;
  if (ui.aee.textContent !== txt) ui.aee.textContent = txt;
}

function drawCrowd() {
  if (G.cheerT < 0) return;
  const t = G.cheerT;
  // slide up with overshoot, hold, slide back down
  let rise;
  if (t < 0.3) rise = easeOutBack(t / 0.3);
  else if (t > CHEER_DUR - 0.3) rise = (CHEER_DUR - t) / 0.3;
  else rise = 1;
  // base line = top of the lowest step's riser; hidden fully below the screen when rise = 0
  const baseY = Math.round(lerp(H + STAIRS_TOP + 20, H, rise));
  const n = CROWD.length;
  const stepX = (k) => (G.cheerSide < 0 ? k * STEP_W : W - (k + 1) * STEP_W);
  const stepTop = (k) => baseY - (n - k) * STEP_RISE;

  // stairs: stone blocks running off the bottom of the screen
  for (let k = 0; k < n; k++) {
    const x = stepX(k);
    const top = stepTop(k);
    const h = H + 40 - top;
    ctx.fillStyle = '#0f1117';
    ctx.fillRect(x - 1, top - 1, STEP_W + 2, h + 1); // outline
    ctx.fillStyle = '#555b69';
    ctx.fillRect(x, top, STEP_W, h);
    ctx.fillStyle = '#9aa2b3'; // lit tread
    ctx.fillRect(x, top, STEP_W, 1);
    ctx.fillStyle = '#6d7484';
    ctx.fillRect(x, top + 1, STEP_W, 1);
    ctx.fillStyle = '#2a2e38'; // mortar: courses every 4 px, staggered joints
    for (let y = top + STEP_RISE; y < H + 4; y += STEP_RISE) {
      ctx.fillRect(x, y, STEP_W, 1);
      const row = Math.round((y - top) / STEP_RISE);
      ctx.fillRect(x + (row & 1 ? 2 : 6), y - STEP_RISE + 1, 1, STEP_RISE - 1);
    }
    ctx.fillStyle = '#3a3f4b'; // shade on the side facing the lower step
    ctx.fillRect(G.cheerSide < 0 ? x + STEP_W - 1 : x, top + 2, 1, h);
  }

  // fans, one per step, feet on the tread
  for (let k = 0; k < n; k++) {
    const f = CROWD[k];
    const ph = t * 7 + f.ph * 6;
    const frame = Math.floor(ph) & 1;
    const hop = Math.round(Math.abs(Math.sin(ph * Math.PI * 0.5)) * 2);
    ctx.drawImage(fanSprs[f.skin][frame], stepX(k), stepTop(k) - 14 - hop);
  }
}

// ---------- simulation ----------
function step(dt) {
  G.t += dt;
  G.prevCam = G.cam;
  G.prevBx = G.bx;
  if (G.squash > 0) G.squash = Math.max(0, G.squash - dt / 0.28);
  updateCheer(dt);
  if (G.peekAge >= 0) {
    G.peekAge += dt;
    if (G.peekAge >= G.peekDur) {
      G.peekAge = -1;
      G.peekWait = 1.8 + Math.random() * 2.5;
    }
  } else if ((G.peekWait -= dt) <= 0) {
    G.peekAge = 0;
    G.peekDur = 1 + Math.random() * 0.8;
  }

  if (G.state === 'title') {
    G.cam += 38 * dt;
    G.bx += (W / 2 - G.bx) * (1 - Math.exp(-3 * dt));
  } else if (G.state === 'playing') {
    const dist = G.cam - G.startCam;
    const d = diff(dist);
    G.speed = speedFor(d);
    G.cam += G.speed * dt;
    G.playT += dt;

    const steer = input.getSteer(dt);
    G.vx += (steer * MAX_VX - G.vx) * (1 - Math.exp(-14 * dt));
    G.bx += G.vx * dt;

    while (G.nextRowY < G.cam + H + 30) spawnRow();

    // entrance: the barrel floats down from above the screen with the current and
    // slows gently to a stop at its resting row (ease-out, no impact)
    if (!G.landed) {
      G.introT += dt;
      const k = Math.min(1, G.introT / INTRO_DUR);
      curBY = lerp(-BARREL_H, barrelY, 1 - (1 - k) * (1 - k) * (1 - k));
      if (k >= 1) land();
    } else curBY = barrelY;

    const by = G.cam + curBY;
    // despawn + near-miss
    let w = 0;
    for (let k = 0; k < G.rocks.length; k++) {
      const r = G.rocks[k];
      if (r.wy < G.cam - 24) continue;
      if (!r.passed && r.wy < by - 2) {
        r.passed = true;
        const gap = Math.abs(r.x - G.bx) - r.r * 0.82 - HIT_R;
        if (gap < 4 && gap >= 0) nearMiss(r);
      }
      G.rocks[w++] = r;
    }
    G.rocks.length = w;

    if (G.landed && collides(by)) {
      die();
      return;
    }

    // spray at the waterline and a wake trailing above the barrel
    if (curBY > 0 && Math.random() < dt * 40) {
      const side = Math.random() < 0.5 ? -1 : 1;
      emit(G.bx + side * 9, by + 6, side * (15 + Math.random() * 30), G.speed - 20 - Math.random() * 30, 0.35, '#e6f5ff', 1, 0);
    }
    if (curBY > 0 && Math.random() < dt * 30) {
      emit(G.bx + (Math.random() * 14 - 7), by - 12, 0, G.speed * 0.25, 0.5, '#7fbfff', 1, 0);
    }

    const m = Math.floor(dist / PX_PER_M);
    if (m !== G.meters) {
      G.meters = m;
      ui.score.textContent = `${m} m`;
      if (m >= G.nextMilestone) {
        milestone(G.nextMilestone);
        G.nextMilestone += 100;
      }
      if (!G.beatBest && save.best > 0 && m > save.best) {
        G.beatBest = true;
        ui.best.textContent = 'NOVO REC!';
        ui.best.classList.add('beat');
        sfx.blip([784, 1047, 1319], 0.07, 0.06);
      }
    }
    if (G.hintShown && G.playT > 3.5) {
      show(ui.hint, false);
      G.hintShown = false;
    }
    G.waterTimer -= dt;
    if (G.waterTimer <= 0) {
      sfx.setWater(d);
      sfx.setMusicIntensity(d);
      G.waterTimer = 0.5;
    }
  } else if (G.state === 'dying') {
    G.speed *= Math.exp(-5 * dt);
    G.cam += G.speed * dt;
    G.deathT += dt;
    if (G.deathT > 1.0) gameOver();
  } else if (G.state === 'over') {
    G.cam += 14 * dt;
  }

  for (let k = 0; k < MAXP; k++) {
    const p = parts[k];
    if (!p.on) continue;
    p.life -= dt;
    if (p.life <= 0) {
      p.on = false;
      continue;
    }
    p.vy += p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}

function land() {
  G.landed = true;
  curBY = barrelY;
}

function collides(by) {
  // Walls: sample the barrel's top, middle and bottom (it's taller than wide).
  for (const dy of [-9, 0, 9]) {
    const hw = (dy === 0 ? HIT_R : HIT_R * 0.75) - 1; // a graze is not a crash
    const wy = by + dy;
    if (G.bx - hw < wallL(wy) || G.bx + hw > wallR(wy)) return true;
  }
  for (const r of G.rocks) {
    const dx = r.x - G.bx;
    const dy = r.wy - by;
    const rr = r.r * 0.82 + HIT_R;
    if (dx * dx + dy * dy < rr * rr) return true;
  }
  return false;
}

function nearMiss(r) {
  sfx.tick();
  for (let k = 0; k < 6; k++) {
    emit(r.x + (Math.random() * 2 - 1) * r.r, r.wy - r.r, (Math.random() * 2 - 1) * 30, G.speed - 40 - Math.random() * 40, 0.35, '#fff6b0', 1, 0);
  }
}

// ---------- rendering ----------
const wallLx = new Int16Array(1024);
const wallRx = new Int16Array(1024);
const ROW = 2;

function render(alpha) {
  const cam = Math.round(lerp(G.prevCam, G.cam, alpha));
  const bx = lerp(G.prevBx, G.bx, alpha);
  let ox = 0;
  let oy = 0;
  if (G.trauma > 0 && save.shake) {
    // trauma^2 with summed sines: smooth, never per-frame random buzz (game-feel skill)
    const s = G.trauma * G.trauma;
    ox = Math.round(6 * s * Math.sin(G.shakeT * 1.7));
    oy = Math.round(5 * s * Math.sin(G.shakeT * 2.3 + 1));
  }
  ctx.setTransform(1, 0, 0, 1, ox, oy);

  // water
  ctx.fillStyle = '#1f5fae';
  ctx.fillRect(-8, -8, W + 16, H + 16);
  const o1 = Math.floor(cam * 0.45) % 128;
  for (let y = -o1; y < H + 8; y += 128) ctx.drawImage(waterTile, -8, y);
  const o2 = Math.floor(cam * 0.8) % 160;
  for (let y = -o2; y < H + 8; y += 160) ctx.drawImage(foamTile, -8, y);

  // rocks with foam crest (upstream) and wake (downstream)
  const flick = Math.floor(G.t * 10);
  for (const r of G.rocks) {
    const sy = Math.round(r.wy - cam);
    if (sy < -20 || sy > H + 20) continue;
    const s = r.spr;
    const x0 = Math.round(r.x) - (s.width >> 1);
    const y0 = sy - (s.height >> 1);
    const wl = 3 + r.r + ((flick + r.r) % 3);
    ctx.fillStyle = '#6fb2f0';
    ctx.fillRect(x0 + 1, y0 + s.height - 2, 1, wl);
    ctx.fillRect(x0 + s.width - 2, y0 + s.height - 2, 1, wl - 2);
    ctx.fillStyle = '#a9d6ff';
    ctx.fillRect(x0 + (s.width >> 1), y0 + s.height - 1, 1, 2 + ((flick + 1) % 3));
    ctx.drawImage(s, x0, y0);
    ctx.fillStyle = '#eaf7ff';
    const f = (flick + r.r) & 1;
    ctx.fillRect(x0 + 2, y0 - f, s.width - 4, 1);
    ctx.fillRect(x0 + 3 + f, y0 - 1 - f, s.width - 7, 1);
  }

  // barrel
  if (G.state === 'playing' || G.state === 'paused') {
    const by = Math.round(curBY) + Math.round(Math.sin(G.t * 4));
    const rot = (G.vx / MAX_VX) * 0.35 + Math.sin(G.t * 5.3) * 0.05;
    let sx = 1;
    let sy = 1;
    if (G.squash > 0) {
      const e = easeOutBack(1 - G.squash);
      sx = lerp(1.35, 1, e);
      sy = lerp(0.65, 1, e);
    }
    ctx.save();
    ctx.translate(Math.round(bx), by);
    ctx.rotate(rot);
    ctx.scale(sx, sy);
    // rider: drawn first so the barrel hides everything below the rim
    let up = 0;
    let look = 0;
    if (G.cheerT >= 0) up = 1; // stands up for the crowd
    else if (G.peekAge >= 0) {
      const a = G.peekAge;
      const e = 0.16;
      up = a < e ? a / e : a > G.peekDur - e ? (G.peekDur - a) / e : 1;
      if (a > e) look = [0, -1, 0, 1][Math.floor((a - e) / 0.3) % 4]; // glance around
    }
    const lift = Math.round(lerp(RIDER_LOW, RIDER_HIGH, clamp(up, 0, 1)));
    const rimY = -BARREL_H / 2;
    ctx.drawImage(riderSprs[look], -5, rimY - lift);
    ctx.drawImage(barrelSpr, -BARREL_W / 2, -BARREL_H / 2);
    if (lift >= RIDER_HIGH - 1) {
      ctx.fillStyle = '#f1c27d'; // hands gripping the rim
      ctx.fillRect(-7, rimY - 1, 2, 2);
      ctx.fillRect(5, rimY - 1, 2, 2);
    }
    ctx.restore();
    ctx.fillStyle = '#eaf7ff';
    const wob = flick & 1;
    ctx.fillRect(Math.round(bx) - 11 - wob, by + 9, 4, 1);
    ctx.fillRect(Math.round(bx) + 7 + wob, by + 9, 4, 1);
  }

  // walls: pattern fill scrolled with the world, lit inner edge, foam where water hits
  const rows = Math.ceil((H + 16) / ROW);
  for (let k = 0; k < rows; k++) {
    const wy = cam - 8 + k * ROW;
    wallLx[k] = Math.round(wallL(wy));
    wallRx[k] = Math.round(wallR(wy));
  }
  if (wallPattern.setTransform) wallPattern.setTransform(new DOMMatrix([1, 0, 0, 1, 0, -(cam % 64)]));
  ctx.fillStyle = wallPattern;
  for (let k = 0; k < rows; k++) {
    const y = -8 + k * ROW;
    ctx.fillRect(-8, y, wallLx[k] + 8, ROW);
    ctx.fillRect(wallRx[k], y, W + 8 - wallRx[k], ROW);
  }
  ctx.fillStyle = '#0f1117';
  for (let k = 0; k < rows; k++) {
    const y = -8 + k * ROW;
    ctx.fillRect(wallLx[k], y, 1, ROW);
    ctx.fillRect(wallRx[k] - 1, y, 1, ROW);
  }
  ctx.fillStyle = '#9aa2b3';
  for (let k = 0; k < rows; k++) {
    const y = -8 + k * ROW;
    ctx.fillRect(wallLx[k] - 1, y, 1, ROW);
    ctx.fillRect(wallRx[k], y, 1, ROW);
  }
  ctx.fillStyle = '#eaf7ff';
  const ft = Math.floor(G.t * 8);
  const base = Math.floor((cam - 8) / ROW);
  for (let k = 0; k < rows; k++) {
    const y = -8 + k * ROW;
    const hsh = hash1((base + k) * 7 + ft * 131);
    if (hsh < 0.35) ctx.fillRect(wallLx[k] + 1, y, 1 + (hsh < 0.12 ? 1 : 0), 1);
    else if (hsh > 0.65) ctx.fillRect(wallRx[k] - 2 - (hsh > 0.88 ? 1 : 0), y, 1 + (hsh > 0.88 ? 1 : 0), 1);
  }

  // particles
  for (let k = 0; k < MAXP; k++) {
    const p = parts[k];
    if (!p.on) continue;
    ctx.fillStyle = p.c;
    ctx.fillRect(Math.round(p.x), Math.round(p.y - cam), p.s, p.s);
  }

  // mist band at the top edge (dithered, pixel style)
  ctx.fillStyle = 'rgba(220,240,255,0.18)';
  ctx.fillRect(-8, -8, W + 16, 14);
  ctx.fillStyle = 'rgba(220,240,255,0.10)';
  ctx.fillRect(-8, 6, W + 16, 8);

  drawCrowd();

  if (G.flash > 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(-8, -8, W + 16, H + 16);
  }
}

// ---------- loop ----------
let last = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const rdt = Math.min((now - last) / 1000, 0.1);
  last = now;
  // Shake and flash decay in real time so they keep moving during hit-stop.
  if (G.trauma > 0) {
    G.trauma = Math.max(0, G.trauma - 1.3 * rdt);
    G.shakeT += rdt * 30;
  }
  if (G.flash > 0) G.flash -= rdt;
  if (G.state !== 'paused') {
    const scale = now < G.hitStopUntil ? 0 : 1;
    acc += rdt * scale;
    let n = 0;
    while (acc >= STEP && n < MAX_STEPS) {
      step(STEP);
      acc -= STEP;
      n++;
    }
    if (n === MAX_STEPS) acc = 0;
  }
  render(G.state === 'paused' ? 1 : acc / STEP);
}

// ---------- layout ----------
function resize() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  H = clamp(Math.round((W * vh) / vw), 240, 460);
  canvas.width = W;
  canvas.height = H;
  ctx.imageSmoothingEnabled = false;
  barrelY = Math.round(H * BARREL_POS);
  if (G.landed) curBY = barrelY;
  const landscape = isMobile && vw > vh;
  show(ui.rotate, landscape);
  if (landscape) pause();
}

// ---------- wake lock ----------
let wakeLock = null;
async function requestWakeLock() {
  try {
    wakeLock = navigator.wakeLock ? await navigator.wakeLock.request('screen') : null;
  } catch {
    wakeLock = null;
  }
}
function releaseWakeLock() {
  try {
    if (wakeLock) wakeLock.release();
  } catch {
    /* ignore */
  }
  wakeLock = null;
}

// ---------- settings ----------
function refreshToggles() {
  ui.tiltBtn.hidden = !tiltAvailable || !isMobile;
  ui.sensBtn.hidden = ui.tiltBtn.hidden || !save.tilt;
  ui.howTo.innerHTML = pcMode
    ? 'USE ← → PARA<br>DESVIAR DAS PEDRAS'
    : save.tilt
      ? 'INCLINE O CELULAR PARA<br>DESVIAR DAS PEDRAS'
      : 'TOQUE À ESQUERDA OU À<br>DIREITA PARA DESVIAR';
  for (const [btn, on, name] of [
    [ui.soundBtn, save.sound, 'Som'],
    [ui.musicBtn, save.music, 'Música'],
    [ui.shakeBtn, save.shake, 'Tremor'],
    [ui.tiltBtn, save.tilt, 'Sensor'],
  ]) {
    btn.classList.toggle('off', !on);
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', `${name}: ${on ? 'ligado' : 'desligado'}`);
  }
  ui.sensBtn.textContent = `INCLINAÇÃO: ${SENS_LABELS[save.sens]}`;
}
function bindToggle(btn, fn) {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    fn();
    writeSave(save);
    refreshToggles();
    sfx.unlock();
    sfx.blip([880], 0.05, 0.05);
  });
}
bindToggle(ui.soundBtn, () => {
  save.sound = !save.sound;
  sfx.setEnabled(save.sound);
});
bindToggle(ui.musicBtn, () => {
  save.music = !save.music;
  sfx.setMusicEnabled(save.music);
});
bindToggle(ui.tiltBtn, () => {
  save.tilt = !save.tilt;
  input.tiltOn = save.tilt;
  if (!save.tilt) return;
  // ask for motion access right away (iOS needs it from this tap); turn back off if refused
  input.requestPermission().then((ok) => {
    if (ok) return;
    save.tilt = false;
    input.tiltOn = false;
    writeSave(save);
    refreshToggles();
  });
});
bindToggle(ui.shakeBtn, () => {
  save.shake = !save.shake;
});
bindToggle(ui.sensBtn, () => {
  save.sens = (save.sens + 1) % 3;
  input.sens = save.sens;
});

// ---------- wiring ----------
ui.title.addEventListener('click', start);
ui.over.addEventListener('click', (e) => {
  if (e.target.closest('#menuBtn')) toTitle();
  else start();
});
ui.pause.addEventListener('click', resume);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
document.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' && e.code !== 'Enter') return;
  if (G.state === 'title' || G.state === 'over') start();
  else if (G.state === 'paused') resume();
});

ui.titleBest.textContent = save.best;
refreshToggles();
if (!playable) {
  show(ui.title, false);
  show(ui.desktop, true);
  ui.desktopUrl.textContent = location.href.replace(/[?#].*$/, '');
}
resize();
requestAnimationFrame((t) => {
  last = t;
  frame(t);
});

// Test hook for automated checks (only with ?test in the URL).
if (params.has('test')) {
  window.__cataratas = {
    get state() {
      return { ...G, rocks: G.rocks.length, H, barrelY, curBY };
    },
    // Advance the simulation by `sec` seconds of game time, then draw one frame.
    advance(sec, onStep) {
      for (let k = 0; k < Math.round(sec / STEP); k++) {
        if (onStep) onStep(G);
        step(STEP);
      }
      render(1);
      return G.state;
    },
    cheer: () => startCheer(),
    rockList: () => G.rocks.map((r) => ({ wy: r.wy, x: r.x, r: r.r })),
    gaps: () => testGaps.filter((g) => g.wy > G.cam - 30),
    walls: (wy) => [wallL(wy), wallR(wy)],
  };
}

})();
