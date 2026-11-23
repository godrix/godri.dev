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
const VERSION = 2;

function defaults(reducedMotion) {
  return {
    v: VERSION, best: 0, sound: true, music: true, shake: !reducedMotion, sens: 1,
    // achievements: unlocked ids -> true, plus the lifetime stats some of them count
    ach: {}, runs: 0, totalM: 0, grazes: 0, badStreak: 0,
    // coins come from bubbles and achievement rewards; owned keys are "b:<id>" / "r:<id>"
    coins: 0, coinsTotal: 0, bubbles: 0, tightTotal: 0, lastM: -1, paid: {},
    owned: {}, barrel: 'classic', rider: 'classic',
  };
}

function migrate(obj, d) {
  if (!obj || typeof obj !== 'object') return d;
  const out = { ...d };
  // v0 (no version field) had only "best"; every later field falls back to defaults.
  if (Number.isFinite(obj.best) && obj.best >= 0) out.best = Math.floor(obj.best);
  if (typeof obj.sound === 'boolean') out.sound = obj.sound;
  if (typeof obj.shake === 'boolean') out.shake = obj.shake;
  if (typeof obj.music === 'boolean') out.music = obj.music;
  if (obj.sens === 0 || obj.sens === 1 || obj.sens === 2) out.sens = obj.sens;
  // v1 had a "tilt" toggle; steering is sensor-only since v2, so it's dropped.
  if (obj.ach && typeof obj.ach === 'object') {
    for (const k of Object.keys(obj.ach)) if (obj.ach[k] === true) out.ach[k] = true;
  }
  if (obj.owned && typeof obj.owned === 'object') {
    for (const k of Object.keys(obj.owned)) if (obj.owned[k] === true) out.owned[k] = true;
  }
  if (typeof obj.barrel === 'string') out.barrel = obj.barrel;
  if (typeof obj.rider === 'string') out.rider = obj.rider;
  for (const k of ['runs', 'totalM', 'grazes', 'badStreak', 'coins', 'coinsTotal', 'bubbles', 'tightTotal', 'lastM']) {
    if (Number.isFinite(obj[k]) && obj[k] >= 0) out[k] = Math.floor(obj[k]);
  }
  if (obj.paid && typeof obj.paid === 'object') {
    for (const k of Object.keys(obj.paid)) if (obj.paid[k] === true) out.paid[k] = true;
  }
  // The first shop used meters as money (totalM - spent): convert that balance, 20 m = 1 coin.
  if (!Number.isFinite(obj.coins) && Number.isFinite(obj.totalM)) {
    const spent = Number.isFinite(obj.spent) ? obj.spent : 0;
    out.coins = Math.floor(Math.max(0, obj.totalM - spent) / 20);
  }
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
// Sources: phone tilt (the only control on phones), arrow keys (?pc test mode) and
// screen halves (?tap=true test mode only).

const DEG = Math.PI / 180;
const DEAD = 0.07; // radial deadzone on the normalized tilt
const CURVE = 1.35; // response curve: finer control near the centre
// Lateral gravity fraction (sin of the roll angle) that counts as full steer, per sensitivity.
const SENS_FULL = [0.5, 0.36, 0.25];
const SENS_LABELS = ['BAIXA', 'MÉDIA', 'ALTA'];
// Browsers only deliver motion sensor events to secure (HTTPS) pages.
const tiltAvailable = window.isSecureContext === true && 'DeviceOrientationEvent' in window;

class Input {
  // tapTarget: element whose left/right halves steer when pressed (test mode); null = off.
  constructor(tapTarget) {
    this.raw = 0; // lateral gravity component in device x, -1..1
    this.neutral = 0;
    this.hasSensor = false;
    this.calibratePending = false;
    this.filtered = 0;
    this.sens = 1;
    this.keyL = false;
    this.keyR = false;

    this.pointers = new Map(); // pointerId -> -1 | 1, insertion order = press order

    window.addEventListener('deviceorientation', (e) => this.onOrient(e));
    if (tapTarget) {
      const side = (e) => (e.clientX < window.innerWidth / 2 ? -1 : 1);
      tapTarget.addEventListener('pointerdown', (e) => {
        this.pointers.delete(e.pointerId);
        this.pointers.set(e.pointerId, side(e));
        e.preventDefault();
      });
      tapTarget.addEventListener('pointermove', (e) => {
        if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, side(e));
      });
      const up = (e) => this.pointers.delete(e.pointerId);
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) tapTarget.addEventListener(ev, up);
    }
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

  getSteer(dt) {
    let target = 0;
    let tap = 0;
    for (const d of this.pointers.values()) tap = d; // newest press wins
    if (tap !== 0) target = tap;
    else if (this.keyL !== this.keyR) target = this.keyL ? -1 : 1;
    else if (this.hasSensor) {
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
  // Cartoon falling scream ("aaAAAaahh"): a voice through "a" formants, yelping up, then
  // dropping away as if the rider fell off. Synthesized in the style of the classic movie scream.
  function scream() {
    if (!ac || !enabled) return;
    const t = ac.currentTime + 0.03;
    const dur = 1.05;
    const o = ac.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(780, t + 0.1);
    o.frequency.exponentialRampToValueAtTime(640, t + 0.3);
    o.frequency.exponentialRampToValueAtTime(860, t + 0.45);
    o.frequency.exponentialRampToValueAtTime(240, t + dur);
    const vib = ac.createOscillator();
    vib.frequency.value = 7.5;
    const vg = ac.createGain();
    vg.gain.value = 22;
    vib.connect(vg).connect(o.frequency);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55, t + 0.04);
    g.gain.setValueAtTime(0.55, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const amps = [1, 0.7, 0.3];
    for (let i = 0; i < 3; i++) {
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = i === 0 ? 5 : 7;
      bp.frequency.setValueAtTime(VOWELS.e[i], t);
      bp.frequency.setTargetAtTime(VOWELS.a[i], t + 0.06, 0.05);
      bp.frequency.setTargetAtTime(VOWELS.o[i], t + 0.7, 0.1);
      const bg = ac.createGain();
      bg.gain.value = amps[i] * 2.6;
      o.connect(bp).connect(bg).connect(g);
    }
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4200;
    g.connect(lp).connect(master);
    o.start(t);
    vib.start(t);
    o.stop(t + dur + 0.05);
    vib.stop(t + dur + 0.05);
  }

  function coin(gold) {
    blip(gold ? [988, 1319, 1568, 2093] : [988, 1319], 0.05, 0.06);
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
    setMusicEnabled, startMusic, stopMusic, setMusicIntensity, duckMusic, lose, stopLose, scream, coin,
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

// ===== skins =====
// Cosmetic skins bought with the meters descended (wallet = save.totalM - save.spent).
// Every barrel sprite is BARREL_W x BARREL_H so hitboxes never change; riders are 10 px wide
// head sprites whose bottom row sits where the default rider's does (taller ones grow upwards).

const bulge = (j, base, amt) => base + Math.round(amt * Math.sin((Math.PI * (j + 0.5)) / BARREL_H));
const shade3 = (rel, span, light, mid, dark) => (rel <= span * 0.3 ? light : rel >= span * 0.75 ? dark : mid);

// The classic wooden barrel, recolourable (the gold skin reuses it).
function makeBarrel(p) {
  const W = BARREL_W;
  const H = BARREL_H;
  return paint(W, H, (i, j) => {
    const hw = bulge(j, 7, 3);
    const x0 = W / 2 - hw;
    const x1 = W / 2 + hw - 1;
    if (i < x0 || i > x1) return null;
    const rel = i - x0;
    const span = x1 - x0;
    if (p.spark && p.spark.some(([x, y]) => x === i && y === j)) return '#ffffff';
    if (i === x0 || i === x1 || j === 0 || j === H - 1) return p.out;
    if (j === 1) return p.rim;
    if (j === 4 || j === 5 || j === 18 || j === 19) return rel <= span * 0.35 ? p.hoopL : rel >= span * 0.8 ? p.hoopD : p.hoop;
    if (j === 6 || j === 20) return p.hoopS;
    if (rel % 3 === 0) return p.groove;
    if (rel === 2 || rel === 4 || rel === 5) return p.hi;
    if (rel >= span - 2) return p.dark;
    return p.base;
  });
}
const WOOD = {
  out: '#2a1606', rim: '#5a3416', hoopL: '#c3cad4', hoop: '#868d99', hoopD: '#555b66', hoopS: '#3e434c',
  groove: '#6e4420', hi: '#cf9a5c', dark: '#74471f', base: '#a66a31',
};
const GOLD = {
  out: '#4a3300', rim: '#8a6400', hoopL: '#ffffff', hoop: '#fff3a0', hoopD: '#c99a1a', hoopS: '#7a5a00',
  groove: '#c99a1a', hi: '#fff3a0', dark: '#d9a514', base: '#ffd23f', spark: [[6, 9], [13, 14], [8, 22], [14, 3]],
};

// A drum shape (straighter than the barrel) with outline, light/mid/dark columns and a callback
// for the details; the callback returns a colour or undefined to fall back to the body shade.
function drum(base, amt, out, light, mid, dark, detail) {
  const W = BARREL_W;
  const H = BARREL_H;
  return paint(W, H, (i, j) => {
    const hw = typeof base === 'function' ? base(j) : bulge(j, base, amt);
    const x0 = W / 2 - hw;
    const x1 = W / 2 + hw - 1;
    if (i < x0 || i > x1) return null;
    const rel = i - x0;
    const span = x1 - x0;
    const d = detail(i, j, rel, span, x0, x1);
    if (d !== undefined) return d;
    if (i === x0 || i === x1 || j === 0 || j === H - 1) return out;
    return shade3(rel, span, light, mid, dark);
  });
}

function makeRadioactive() {
  const drips = { 5: 4, 8: 2, 12: 5, 15: 3 };
  return drum(8, 1, '#2a2306', '#ffe066', '#f2c40f', '#b88d06', (i, j, rel, span, x0, x1) => {
    if (i === x0 || i === x1 || j === 0 || j === BARREL_H - 1) return undefined;
    if (j === 1) return '#9dff5c';
    if (drips[i] && j <= drips[i]) return j === drips[i] ? '#9dff5c' : '#62d93a';
    if (j === 3 || j === 20) return '#1d1a10';
    const dx = i + 0.5 - 10;
    const dy = j + 0.5 - 12;
    const dd = Math.hypot(dx, dy);
    if (dd < 1.4) return '#1d1a10';
    if (dd > 2.3 && dd < 5.3) {
      const a = ((Math.atan2(dy, dx) * 180) / Math.PI + 450) % 120;
      if (a < 60) return '#1d1a10';
    }
    return undefined;
  });
}

function makeKeg() {
  return drum(8, 1, '#3a4048', '#eef2f6', '#b5bec9', '#7d8794', (i, j, rel, span, x0, x1) => {
    if (j <= 2) {
      if (j === 0) return i > x0 && i < x1 && i % 3 !== 0 ? '#fffbe8' : null;
      return (i + j) % 4 === 0 ? '#f3e6b3' : '#fffbe8';
    }
    if (i === x0 || i === x1 || j === BARREL_H - 1) return undefined;
    if (j === 3 && (rel === 3 || rel === 4 || rel === span - 3 || rel === span - 4)) return '#3a4048';
    if (j === 6 || j === 17) return '#5d6670';
    if (j === 7 || j === 18) return '#dde3ea';
    if (j >= 10 && j <= 13) {
      if ((i * 7 + j * 3) % 11 === 0) return '#fff3c4';
      return rel <= span * 0.3 ? '#f7c548' : rel >= span * 0.75 ? '#b8790b' : '#e8a317';
    }
    return undefined;
  });
}

function makeFridge() {
  const W = BARREL_W;
  return paint(W, BARREL_H, (i, j) => {
    if (j === 23) return i === 3 || i === 4 || i === 15 || i === 16 ? '#2b3340' : null;
    if (i < 2 || i > 17) return null;
    const corner = (i === 2 || i === 17) && (j === 0 || j === 22);
    if (corner) return null;
    if (i === 2 || i === 17 || j === 0 || j === 22) return '#2b3340';
    if (j === 8) return '#8a96a6';
    if (i === 14 && ((j >= 3 && j <= 6) || (j >= 11 && j <= 18))) return '#6b7686';
    if (i === 5 && j === 12) return '#e84a4a';
    if (i === 6 && j === 15) return '#3d8fe0';
    if (i === 8 && j === 12) return '#ffd23f';
    if (j === 1 || i === 3) return '#ffffff';
    if (i >= 15) return '#c9d1db';
    return '#eef2f6';
  });
}

function makeMelon() {
  return drum(7, 3, '#12361a', '#3fa34d', '#2e8b3a', '#1f6b2a', (i, j, rel, span, x0, x1) => {
    if (i === x0 || i === x1 || j === 0 || j === BARREL_H - 1) return undefined;
    if (j === 1) return '#c9eea0';
    if (j === 2 || j === 3) return j === 3 && (rel === 3 || rel === 7 || rel === span - 4) ? '#1a1a1a' : '#ef4b5a';
    if (j === 4) return '#c9eea0';
    if ((i + Math.round(1.5 * Math.sin(j * 0.5))) % 4 === 0) return rel <= 1 ? '#8ad86a' : '#5fbf4a';
    return undefined;
  });
}

function makeOilDrum() {
  return drum(8, 1, '#0e2140', '#4a86e8', '#2f6fd1', '#1f4f9e', (i, j, rel, span, x0, x1) => {
    if (i === x0 || i === x1 || j === 0 || j === BARREL_H - 1) return undefined;
    if (j === 1) return '#9aa6b5';
    if (i === 6 && j >= 2 && j <= 5) return '#111111';
    if (i === 7 && j === 2) return '#111111';
    if (j === 7 || j === 16) return '#6ea4f2';
    if (j === 8 || j === 17) return '#1d4a91';
    if ((j === 11 || j === 12) && rel >= 3 && rel <= span - 3) return '#e8eef7';
    return undefined;
  });
}

function makeWaterTank() {
  const hw = (j) => (j <= 2 ? 10 : 9 - Math.floor((j - 3) / 8));
  return drum(hw, 0, '#0d2a52', '#6fb4f5', '#3d8fe0', '#2565b5', (i, j, rel, span, x0, x1) => {
    if (i === x0 || i === x1 || j === 0 || j === BARREL_H - 1) return undefined;
    if (j === 1) return '#5aa2ee';
    if (j === 2) return '#2c6fc0';
    if (j === 8 || j === 14 || j === 20) return '#2c6fc0';
    if (j === 9 || j === 15 || j === 21) return rel <= span * 0.3 ? '#a9d6ff' : undefined;
    return undefined;
  });
}

function makePressureCooker() {
  const W = BARREL_W;
  return paint(W, BARREL_H, (i, j) => {
    if (j >= 4 && j <= 5 && (i <= 2 || i >= 17)) return j === 4 ? '#3a3a3a' : '#1b1b1b';
    const lid = j <= 1;
    const x0 = lid ? 2 : 3;
    const x1 = lid ? 17 : 16;
    if (i < x0 || i > x1) return null;
    if (lid && (i === 14 || i === 15)) return j === 0 ? '#555555' : '#222222';
    if (i === x0 || i === x1 || j === 0 || j === BARREL_H - 1) return '#2b3038';
    if (lid) return '#8b949f';
    if (j === 2) return '#5d6670';
    if (j === 12) return '#9aa3ae';
    const rel = i - x0;
    return shade3(rel, x1 - x0, '#f2f5f8', '#c3cad4', '#7d8794');
  });
}

function makeTrashCan() {
  const hw = (j) => (j <= 1 ? 10 : 9 - Math.floor(j / 12));
  return drum(hw, 0, '#22262c', '#c3cad4', '#9aa3ae', '#6d7681', (i, j, rel, span, x0, x1) => {
    if (j === 0 && (i === 16 || i === 17)) return '#ffd23f'; // banana peel on the rim
    if (j === 1 && i === 17) return '#ffd23f';
    if (j === 0 || j === BARREL_H - 1 || i === x0 || i === x1) return undefined;
    if (j === 1) return '#e6ebf0';
    if (j === 6 || j === 18) return '#7d8794';
    if (rel % 3 === 0) return '#5d6670';
    return undefined;
  });
}

function makeDuck() {
  return drum(8, 2, '#5a4300', '#ffe98a', '#ffd23f', '#d9a514', (i, j, rel, span, x0) => {
    if ((i === 0 || i === 1 || i === x0) && (j === 5 || j === 6)) return '#ff8a1c'; // beak
    if (j === 0 || j === BARREL_H - 1 || i === x0 || rel === span) return undefined;
    if ((i === 4 || i === 5) && (j === 4 || j === 5)) return i === 4 && j === 4 ? '#ffffff' : '#1a1a1a'; // eye
    const hx = i + 0.5 - 5.5;
    const hy = j + 0.5 - 5.5;
    const h2 = hx * hx + hy * hy;
    if (h2 < 16 && h2 > 9) return hy > 0 ? '#a87a00' : '#ffe98a'; // head: lit top, shaded chin
    if ((i === 2 || i === 3) && (j === 5 || j === 6)) return '#ff8a1c';
    if (i === 2 && j === 7) return '#c25e00';
    const wx = (i + 0.5 - 12) / 3.5;
    const wy = (j + 0.5 - 14) / 3;
    const w = wx * wx + wy * wy;
    if (w < 1 && w > 0.55) return '#d9a514'; // wing
    return undefined;
  });
}

const BARREL_SKINS = [
  { id: 'classic', name: 'BARRIL CLÁSSICO', desc: 'Madeira de lei com cheirinho de vinho velho.', price: 0, make: () => makeBarrel(WOOD) },
  { id: 'radio', name: 'BARRIL RADIOATIVO', desc: 'Brilha no escuro. Por favor, não lamba.', price: 30, make: makeRadioactive, trail: 'radio' },
  { id: 'oil', name: 'TAMBOR DE ÓLEO', desc: 'Deixa um rastro bem suspeito na água.', price: 40, make: makeOilDrum, trail: 'oil' },
  { id: 'keg', name: 'BARRIL DE CHOPP', desc: 'Trincando de gelado, com dois dedos de espuma.', price: 50, make: makeKeg, trail: 'foam' },
  { id: 'melon', name: 'MELANCIA', desc: 'Oca por dentro, doce por fora. Cuidado com o caroço.', price: 60, make: makeMelon, trail: 'melon' },
  { id: 'tank', name: "CAIXA D'ÁGUA", desc: 'Mil litros de pura coragem. Tampa não inclusa.', price: 80, make: makeWaterTank },
  { id: 'trash', name: 'LATA DE LIXO', desc: 'Reciclar é bom. Descer cachoeira nela é melhor.', price: 100, make: makeTrashCan },
  { id: 'duck', name: 'PATINHO DE BORRACHA', desc: 'Quack. Só isso. Quack.', price: 120, make: makeDuck, trail: 'duck' },
  { id: 'fridge', name: 'GELADEIRA', desc: 'Tem um pote de sorvete lá dentro. É feijão.', price: 150, make: makeFridge },
  { id: 'cooker', name: 'PANELA DE PRESSÃO', desc: 'Psssssss! Feijão no ponto em 3 km.', price: 200, make: makePressureCooker, trail: 'steam' },
  { id: 'gold', name: 'BARRIL DE OURO', desc: 'Pura ostentação. Se afunda? Ninguém sabe.', price: 500, make: () => makeBarrel(GOLD), trail: 'gold' },
];

// Rider heads. rows: palette chars ('.' = clear); eyes: [x, y] pixels drawn in eyeC and shifted
// sideways by the "look" direction; hand: colour of the hands gripping the rim.
const RIDER_SKINS = [
  {
    id: 'classic', name: 'TURISTA DE CAPA', desc: 'Capa amarela de R$ 15 comprada na lojinha.', price: 0,
    rows: RIDER_ROWS,
    pal: { Y: '#ffd23f', y: '#d9a514', h: '#fff3a0', o: '#2a2108', s: '#f1c27d' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#f1c27d',
  },
  {
    id: 'cat', name: 'GATO LARANJA', desc: 'Odeia água. Ama adrenalina. Vai entender.', price: 25,
    rows: ['o........o', 'oPo....oPo', 'oPPooooPPo', 'oCCCCCCCCo', 'oCcCCCCcCo', 'oCCCCCCCCo', 'oCCCCCCCCo', 'oWCCnnCCWo', 'oCCCCCCCCo', '.oooooooo.'],
    pal: { o: '#3a1f08', P: '#ff9fb0', C: '#f08a24', c: '#b85c10', n: '#ff7a9a', W: '#ffffff' },
    eyes: [[3, 6], [6, 6]], eyeC: '#1a1a1a', hand: '#f08a24',
  },
  {
    id: 'pirate', name: 'PIRATA', desc: 'Perdeu o navio, sobrou o barril. Arrr!', price: 35,
    rows: ['...oooo...', '..oRRRRo..', '.oRRWRRRo.', 'oRRRRRRRRo', 'osssssssso', 'okksssssso', 'okksssssso', 'osssssssso', '.obbbbbbo.'],
    pal: { o: '#2a1606', R: '#c81e1e', W: '#ffffff', s: '#e0ac69', k: '#111111', b: '#5a3416' },
    eyes: [[6, 6]], eyeC: '#111111', hand: '#e0ac69',
  },
  {
    id: 'ninja', name: 'NINJA', desc: 'Tão silencioso que ninguém viu ele cair.', price: 45,
    rows: ['...oooo...', '..oNNNNo..', '.oNNNNNNo.', 'oRRRRRRRRo', 'oNNNNNNNNo', 'oNssssssNo', 'oNNNNNNNNo', 'oNNNNNNNNo', '.oNNNNNNo.'],
    pal: { o: '#0a0a0a', N: '#22252b', R: '#d62828', s: '#e0ac69' },
    eyes: [[3, 5], [6, 5]], eyeC: '#111111', hand: '#22252b',
  },
  {
    id: 'clown', name: 'PALHAÇO', desc: 'O circo pegou fogo e ele pulou na cachoeira.', price: 55,
    rows: ['.GGBBYYRR.', 'GGBBYYRRGG', 'GBoWWWWoRY', 'BoWWWWWWoR', 'BoWWWWWWoR', 'oWWbWWbWWo', 'oWWWWWWWWo', 'oWWWNNWWWo', 'oWRRRRRRWo', '.oWWWWWWo.'],
    pal: { G: '#3ddc5a', B: '#3d8fe0', Y: '#ffd23f', R: '#e8434f', o: '#2a2108', W: '#f8f4ec', b: '#3d8fe0', N: '#ff2a2a' },
    eyes: [[3, 6], [6, 6]], eyeC: '#1a1a1a', hand: '#f8f4ec',
  },
  {
    id: 'viking', name: 'VIKING', desc: 'Já desceu fiordes piores que isso aqui.', price: 70,
    rows: ['H........H', 'HH.oooo.HH', '.HoMMMMoH.', '.oMMLMMMo.', 'oMMMMMMMMo', 'oNNNNNNNNo', 'osssssssso', 'oOssssssOo', 'OOOOmmOOOO', '.OOOOOOOO.', '..O.OO.O..'],
    pal: { H: '#f3e6c8', o: '#22262c', M: '#9aa3ae', L: '#e6ebf0', N: '#5d6670', s: '#f1c27d', O: '#d9761c', m: '#7a1d1d' },
    eyes: [[3, 6], [6, 6]], eyeC: '#1a1a1a', hand: '#f1c27d',
  },
  {
    id: 'robot', name: 'ROBÔ', desc: 'À prova d’água? O manual diz que sim.', price: 90,
    rows: ['....RR....', '....kk....', 'oooooooooo', 'oLMMMMMMMo', 'oMMMMMMMMo', 'oMDDDDDDMo', 'oMDDDDDDMo', 'oMMMMMMMMo', 'oMkMkMkMMo', 'oMMMMMMMMo', 'oooooooooo'],
    pal: { R: '#ff3b3b', k: '#2b3038', o: '#1b1f26', L: '#e6ebf0', M: '#9aa3ae', D: '#1b2a33' },
    eyes: [[3, 6], [6, 6]], eyeC: '#3df2ff', hand: '#9aa3ae',
  },
  {
    id: 'astro', name: 'ASTRONAUTA', desc: 'Errou a órbita e caiu bem nas cataratas.', price: 110,
    rows: ['...oooo...', '..oWWWWo..', '.oWWWWWWo.', 'oWWWWWWWWo', 'oWVVVVVVWo', 'oWVLVVVVWo', 'oWVVVVVVWo', 'oWWWWWWWWo', 'oGWWWWWWRo'],
    pal: { o: '#2b3340', W: '#eef2f6', V: '#1b2a4a', L: '#9fd8ff', G: '#3dff6e', R: '#ff3b3b' },
    eyes: [[3, 6], [6, 6]], eyeC: '#7fd3ff', hand: '#eef2f6',
  },
  {
    id: 'dino', name: 'DINOSSAURO', desc: 'Sobreviveu ao meteoro. Agora quer emoção.', price: 130,
    rows: ['...S..S...', '..oSooSo..', '.oddddddo.', 'oddddddddo', 'odLddddddo', 'oddddddddo', 'oddddddddo', 'oddnddnddo', 'okkkkkkkko', '.oWdWdWdo.', '..oooooo..'],
    pal: { S: '#ff8a1c', o: '#163d12', d: '#4caf50', L: '#9be07a', n: '#163d12', k: '#3a0d0d', W: '#ffffff' },
    eyes: [[3, 5], [6, 5]], eyeC: '#111111', hand: '#4caf50',
  },
  {
    id: 'et', name: 'ET', desc: 'Atravessou a galáxia só pra descer essa cachoeira.', price: 160,
    rows: ['.a......a.', '..k....k..', '...oggo...', '..oggggo..', '.oggLgggo.', 'oggggggggo', 'oggggggggo', 'oggggggggo', '.oggmmggo.', '..oggggo..', '...oooo...'],
    pal: { a: '#c8ff8a', k: '#2f6b1f', o: '#1d3b12', g: '#7ed957', L: '#c8ff8a', m: '#2f6b1f' },
    eyes: [[2, 6], [3, 6], [6, 6], [7, 6], [3, 7], [6, 7]], eyeC: '#0a0a0a', hand: '#7ed957',
  },
  {
    id: 'santa', name: 'PAPAI NOEL', desc: 'Trenó na oficina, veio de barril mesmo. Ho ho ho!', price: 250,
    rows: ['.......WW.', '......rWW.', '....rrr...', '...rrrrr..', '..rrrrrrr.', '.WWWWWWWW.', '.WssssssW.', '.osssssso.', '.WssppssW.', 'WWWWWWWWWW', 'WWWWmmWWWW', '.WWWWWWWW.', '...WWWW...'],
    pal: { r: '#d62828', W: '#f4f4f4', s: '#f1c27d', o: '#2a2108', p: '#e8897a', m: '#7a1d1d' },
    eyes: [[3, 7], [6, 7]], eyeC: '#1a1a1a', hand: '#f4f4f4', trail: 'snow',
  },
  // ---- folklore & legends ----
  {
    id: 'witch', name: 'BRUXA', desc: 'Vassoura quebrou. Barril serve. Abracadabarril!', price: 60, monster: true,
    rows: ['......o...', '.....oKo..', '....oKKo..', '....oKKKo.', '...oKKKKo.', '...oPPPPo.', 'KKKKKKKKKK', 'Hogggggggo', 'Hogggggggo', 'HogggGGggo', 'Hogggggggo', '.oggmmggo.', '..oooooo..'],
    pal: { o: '#140b1c', K: '#2a1838', P: '#9b4dca', g: '#8fd16a', G: '#5e9e3e', m: '#3a0d0d', H: '#e8742a' },
    eyes: [[3, 8], [6, 8]], eyeC: '#1a1a1a', hand: '#8fd16a', trail: 'magic',
  },
  {
    id: 'unicorn', name: 'UNICÓRNIO', desc: 'Deixa um rastro de óleo arco-íris. Exclusivo, chique e poluente.', price: 300,
    rows: ['....y.....', '....Yy....', '...yYY....', '.ooWWWWoR.', 'oWWWWWWWRO', 'oWWWWWWWOY', 'oWWWWWWWYG', 'oWWWWWWWGB', 'oWWWWWWWBo', '.oPWWWWPo.', '..oooooo..'],
    pal: { o: '#4a3a5a', W: '#fbf7ff', Y: '#ffd23f', y: '#d9a514', R: '#ff4d6d', O: '#ff9f1c', G: '#3ddc5a', B: '#3d8fe0', P: '#ffb3c6' },
    eyes: [[3, 5], [6, 5]], eyeC: '#3a1f5a', hand: '#fbf7ff', trail: 'rainbow',
  },
  {
    id: 'vampire', name: 'VAMPIRO', desc: 'Só desce a cachoeira à noite. Protetor solar fator 1000.', price: 80, monster: true,
    rows: ['..oooooo..', '.oHHHHHHo.', 'oHHHHHHHHo', 'oHssHHssHo', 'oHssssssHo', 'osssssssso', 'osssssssso', 'osskkkksso', 'CosWssWsoC', 'CC.oooo.CC'],
    pal: { o: '#120d16', H: '#1b1422', s: '#e8e4f0', k: '#5a0d16', W: '#ffffff', C: '#b3122e' },
    eyes: [[3, 5], [6, 5]], eyeC: '#d61f1f', hand: '#e8e4f0',
  },
  {
    id: 'wolf', name: 'LOBISOMEM', desc: 'Sétimo filho, sexta-feira, lua cheia e um barril.', price: 90, monster: true,
    rows: ['o........o', 'oFo....oFo', 'oFFooooFFo', 'oFFFFFFFFo', 'oFfFFFFfFo', 'oFFFFFFFFo', 'oFFFFFFFFo', 'oFFLLLLFFo', 'oFFLkkLFFo', 'oFWLLLLWFo', '.oooooooo.'],
    pal: { o: '#1e1712', F: '#6b5a4a', f: '#4a3d31', L: '#a89482', k: '#111111', W: '#ffffff' },
    eyes: [[3, 5], [6, 5]], eyeC: '#ffd23f', hand: '#6b5a4a',
  },
  {
    id: 'zombie', name: 'ZUMBI', desc: 'Cééérebro... e cachoeira. Nessa ordem.', price: 50, monster: true,
    rows: ['..o.oo.o..', '.oHoHHoHo.', 'oHHHHHHHHo', 'oHHPPHHHHo', 'ozzzzzzzzo', 'ozzzzzzzzo', 'ozkzzzzzzo', 'ozzzzzzzzo', 'ozWkWkWzzo', '.ozzSzzzo.', '..oooooo..'],
    pal: { o: '#1a2216', H: '#3b2a1a', P: '#ff8fa8', z: '#8fae7a', k: '#4f6b45', W: '#e8e4c8', S: '#2a3324' },
    eyes: [[3, 5], [6, 5]], eyeC: '#f0f0d0', hand: '#8fae7a',
  },
  {
    id: 'yeti', name: 'ABOMINÁVEL', desc: 'Veio do Himalaia porque achou a água daqui quentinha.', price: 120,
    rows: ['..W.WW.W..', '.WWWWWWWW.', 'WWWWWWWWWW', 'WWbbbbbbWW', 'WbbbbbbbbW', 'WbbbbbbbbW', 'WbbbbbbbbW', 'WbbkkkkbbW', 'WWbWbbWbWW', '.WWWWWWWW.', '..W.WW.W..'],
    pal: { W: '#f4f8ff', b: '#7fa8d6', k: '#1b2a4a' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#f4f8ff', trail: 'snow',
  },
  {
    id: 'bigfoot', name: 'PÉ-GRANDE', desc: 'Calça 58. Por isso não usa prancha.', price: 100,
    rows: ['..oooooo..', '.oBBBBBBo.', 'oBBbBBbBBo', 'oBBBBBBBBo', 'oBddddddBo', 'oBddddddBo', 'oBddNNddBo', 'oBddddddBo', 'oBBdmmdBBo', 'oBBBBBBBBo', '.oBBBBBBo.'],
    pal: { o: '#1c120a', B: '#6b4423', b: '#8a5a30', d: '#3a2616', N: '#1c120a', m: '#140b06' },
    eyes: [[3, 5], [6, 5]], eyeC: '#f6e7c8', hand: '#6b4423',
  },
  {
    id: 'nessie', name: 'MONSTRO DO LAGO', desc: 'Saiu do lago pra conhecer as cataratas. Foto sempre sai borrada.', price: 150,
    rows: ['..oooo....', '.oGGGGoo..', 'oGGGGGGGo.', 'oGGGGGGGGo', 'oGGmmmmGGo', '.oGGGGGGo.', '..oGGLo...', '..oGGLo...', '..oGGLo...', '..oGGLo...', '..oGGLo...', '.oGGGLLo..', 'oGGGGGLLo.', 'oGGGGGGLLo'],
    pal: { o: '#123b22', G: '#3fa36a', L: '#9be0b0', m: '#123b22' },
    eyes: [[3, 3], [6, 3]], eyeC: '#111111', hand: '#3fa36a',
  },
  {
    id: 'skeleton', name: 'ESQUELETO', desc: 'Leve, arejado e sem medo de quebrar. Já quebrou tudo.', price: 70, monster: true,
    rows: ['..oooooo..', '.oWWWWWWo.', 'oWWWWWWWWo', 'oWWWWWWWWo', 'oWkkWWkkWo', 'oWkkWWkkWo', 'oWWWkkWWWo', '.oWWWWWWo.', '.okWkWkWo.', '..oWWWWo..'],
    pal: { o: '#2b2b33', W: '#f2efe6', k: '#1a1a1a' },
    eyes: [[3, 5], [6, 5]], eyeC: '#ff3b3b', hand: '#f2efe6',
  },
  {
    id: 'mummy', name: 'MÚMIA', desc: '3 mil anos enfaixada. Molhar as faixas? Primeira vez.', price: 75, monster: true,
    rows: ['..oooooo..', '.oWwWWwWo.', 'oWWWwwWWWo', 'owWWWWWwWo', 'oWWwWWWWwo', 'okkkkkkkko', 'oWwWWWwWWo', 'oWWWwWWWwo', 'owWWWWwWWo', '.oWWwWWWo.', '..oooooo..'],
    pal: { o: '#4a4030', W: '#efe6cc', w: '#c9bc96', k: '#1a1610' },
    eyes: [[3, 5], [6, 5]], eyeC: '#ffd23f', hand: '#efe6cc',
  },
  {
    id: 'creature', name: 'CRIATURA COSTURADA', desc: 'Feita de retalhos num laboratório. Os pontos aguentam água?', price: 85, monster: true,
    rows: ['..oooooo..', '.oHHoHHHo.', 'oHHHHHHHHo', 'oaaaaabbbo', 'oSSSSSSSSo', 'oaaaabbbbo', 'oaaaabbbbo', 'oaaaaSbbbo', 'oaakkkkbbo', '.oaaabbbo.', '..oooooo..'],
    pal: { o: '#151a14', H: '#1b1b1b', a: '#9bb08a', b: '#c9a08a', S: '#2a2a2a', k: '#3a0d0d' },
    eyes: [[3, 6], [6, 6]], eyeC: '#1a1a1a', hand: '#9bb08a',
  },
  // ---- Brasil ----
  {
    id: 'caramelo', name: 'VIRA-LATA CARAMELO', desc: 'Patrimônio nacional. Devia estar na nota de 200.', price: 40,
    rows: ['..oooooo..', '.oCCCCCCo.', 'oDCCCCCCDo', 'DDCCCCCCDD', 'DDCCCCCCDD', 'DDCCCCCCDD', 'DoCLLLLCoD', '.oLLkkLLo.', '.oLLLLLLo.', '..oLppLo..', '...oppo...'],
    pal: { o: '#3a220c', C: '#d08a3c', D: '#9a5a1f', L: '#f3d2a2', k: '#1a1a1a', p: '#ff6f8a' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#d08a3c',
  },
  {
    id: 'lapwing', name: 'QUERO-QUERO DE TOPETE', desc: 'Grita "quero-quero" e quer mesmo: quer descer de novo.', price: 65,
    rows: ['...RR.....', '..RRRR....', '..RRRRR...', '.oRRRRRRo.', 'oGGGGGGGGo', 'oGGGGGGGGo', 'oWWGGGGWWo', 'oGGGBBGGGo', 'oKKKBBKKKo', '.oKKKKKKo.', '..oooooo..'],
    pal: { R: '#e8342a', o: '#1a1a1a', G: '#8e939c', W: '#ffffff', B: '#ff8a1c', K: '#202020' },
    eyes: [[3, 5], [6, 5]], eyeC: '#e01e1e', hand: '#8e939c',
  },
  {
    id: 'pony', name: 'CAVALINHO DA SELEÇÃO', desc: 'Relincha a cada gol e a cada pedra que desvia.', price: 95,
    rows: ['..o....o..', '.oHo..oHo.', '.oHHooHHo.', 'oHHMMMMHHo', 'oHHHMHHHHo', 'oHHHHHHHHo', 'oHHHHHHHHo', 'oHLLLLLLHo', 'oHLkLLkLHo', 'YYGYYYYGYY', 'YYYYGGYYYY'],
    pal: { o: '#2a1606', H: '#8a5a30', M: '#2a1606', L: '#c49a6c', k: '#2a1606', Y: '#ffd23f', G: '#1f9a46' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#8a5a30', trail: 'brasil',
  },
  // ---- pop ----
  {
    id: 'castaway', name: 'NÁUFRAGO', desc: 'Ele e o Milson, sua bola de vôlei. Melhores amigos pra sempre.', price: 110, ox: 5,
    rows: [
      '..oooooo.......', '.oHHHHHHo......', 'oHHHHHHHHo.....', 'oHssssssHo.....', 'oHssssssHo.....', 'osssssssso.....',
      'oBssssssBo.ooo.', 'oBBsmmsBBooWWWo', 'oBBBBBBBBooWRWo', '.oBBBBBBo.oWWWo', '..oBBBBo...ooo.',
    ],
    pal: { o: '#2a1606', H: '#6b4423', s: '#e0ac69', B: '#8a5a30', m: '#3a0d0d', W: '#f4f4ec', R: '#d62828' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#e0ac69',
  },
  {
    id: 'scientist', name: 'CIENTISTA MALUCO', desc: 'Calculou tudo: a chance de dar certo é de 0,003%. Bora!', price: 100,
    rows: ['W.W..W.W.W', '.WWWWWWWW.', 'WWWWWWWWWW', 'WWssssssWW', 'WssssssssW', 'WoLLooLLoW', 'WssssssssW', 'WsssWWsssW', '.osssssso.', 'CCCCrrCCCC'],
    pal: { W: '#f4f4f4', s: '#f1c27d', o: '#1a1a1a', L: '#bfe3ff', C: '#e8eef7', r: '#d62828' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#f1c27d', trail: 'spark',
  },
  {
    id: 'angel', name: 'ANJINHO', desc: 'Nunca encostou numa pedra. Nem pensa nisso.', price: null, ach: 'angel', ox: 7,
    rows: ['...yyyyyyyy...', '..............', '....oooooo....', '...oCCCCCCo...', '..oCCcCCcCCo..', '..oCssssssCo..', 'WWossssssssoWW', 'WWWossssssoWWW', '.WWossmmssoWW.', '..W.oooooo.W..'],
    pal: { y: '#ffe066', o: '#2a2108', C: '#ffd23f', c: '#e8b400', s: '#ffdbac', W: '#ffffff', m: '#d65a5a' },
    eyes: [[5, 6], [8, 6]], eyeC: '#3a2a1a', hand: '#ffdbac', trail: 'holy',
  },
  {
    id: 'devil', name: 'DEMÔNIO', desc: 'Tá com o capeta no corpo. Literalmente.', price: null, ach: 'm666',
    rows: ['H........H', 'HH......HH', '.HooooooH.', 'oRRRRRRRRo', 'oRRRRRRRRo', 'okkRRRRkko', 'oRRRRRRRRo', 'oRRRRRRRRo', 'oRkWWWWkRo', '.oRRkkRRo.', '..oookoo..'],
    pal: { H: '#f3e6c8', o: '#2a0606', R: '#d62828', k: '#2a0606', W: '#ffffff' },
    eyes: [[3, 6], [6, 6]], eyeC: '#ffd23f', hand: '#d62828', trail: 'fire',
  },
  {
    id: 'sponge', name: 'BUCHINHA', desc: 'Esponja-do-mar rosinha e redonda. Não tem nada a ver com ninguém.', price: null, ach: 'bubbles300',
    rows: ['...oooo...', '.ooPPPPoo.', 'oPPpPPPPPo', 'oPPPPPpPPo', 'oPpPPPPPPo', 'oPPPPPPPPo', 'oPPPPPPpPo', 'oPpPmmPPPo', '.oPPPPPpo.', '..oooooo..'],
    pal: { o: '#7a2a4a', P: '#ff8fb3', p: '#c95a85', m: '#7a2a4a' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#ff8fb3', trail: 'bubbles',
  },
  // ---- holidays ----
  {
    id: 'bunny', name: 'COELHO DA PÁSCOA', desc: 'Escondeu os ovos e esqueceu onde. Tá procurando no rio.', price: 80,
    rows: ['.oo....oo.', 'oWWo..oWWo', 'oWPo..oPWo', 'oWPo..oPWo', 'oWPo..oPWo', '.oWooooWo.', '.oWWWWWWo.', 'oWWWWWWWWo', 'oWWWWWWWWo', 'oPWWkkWWPo', 'oWWWmmWWWo', '.oWWWWWWo.', '..oooooo..'],
    pal: { o: '#4a4a5a', W: '#fbfbff', P: '#ffb3c6', k: '#ff6f8a', m: '#4a4a5a' },
    eyes: [[3, 8], [6, 8]], eyeC: '#1a1a1a', hand: '#fbfbff', trail: 'easter',
  },
  {
    id: 'armadillo', name: 'TATU DO HANUKKAH', desc: 'Meio tatu, meio feriado. 100% casca grossa.', price: 90,
    rows: ['..oooooo..', '.oAaAaAao.', 'oaAaAaAaAo', 'oAaAaAaAao', 'oTTTTTTTTo', 'oTTTTTTTTo', '.oTTTTTTo.', '..oTTTTo..', '...oppo...', 'BWBWBWBWBW', 'WBWBWBWBWB'],
    pal: { o: '#2a2420', A: '#8a7a68', a: '#6a5c4e', T: '#c8a888', p: '#ff8fa8', B: '#2f6fd1', W: '#ffffff' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#c8a888',
  },
];

// Wake colours. The rider's trail wins over the barrel's (the unicorn's rainbow is rider-only).
// "seq" trails cycle through the colours in order so they draw bands instead of confetti.
const TRAILS = {
  radio: { c: ['#9dff5c', '#62d93a', '#c8ff8a'], s: 2 },
  oil: { c: ['#2b2b2b', '#4a3a5a', '#1a1a1a', '#3a5a4a'], s: 2 },
  foam: { c: ['#fffbe8', '#ffffff', '#f3e6b3'] },
  melon: { c: ['#ef4b5a', '#ef4b5a', '#1a1a1a'] },
  duck: { c: ['#ffe98a', '#ffd23f'] },
  steam: { c: ['#ffffff', '#e6ebf0'], s: 2 },
  gold: { c: ['#fff3a0', '#ffd23f', '#ffffff'] },
  rainbow: { c: ['#ff4d6d', '#ff9f1c', '#ffd23f', '#3ddc5a', '#3d8fe0', '#9b4dca'], s: 2, seq: true },
  fire: { c: ['#ff3b1f', '#ff8a1c', '#ffd23f'], s: 2 },
  holy: { c: ['#ffffff', '#fff3a0', '#ffe066'] },
  magic: { c: ['#9b4dca', '#c58cf0', '#8fd16a'] },
  snow: { c: ['#ffffff', '#e6f2ff'] },
  spark: { c: ['#3df2ff', '#ffffff', '#ffd23f'] },
  brasil: { c: ['#ffd23f', '#1f9a46', '#3d8fe0'], seq: true },
  bubbles: { c: ['#ffb3c6', '#bfe3ff', '#ffffff'] },
  easter: { c: ['#ffb3c6', '#bfe3ff', '#fff3a0', '#c8f7c5'] },
};
function trailColor(t) {
  const tr = TRAILS[riderSkin.trail] || TRAILS[barrelSkin.trail];
  if (!tr) return ['#7fbfff', 1];
  const c = tr.seq ? tr.c[Math.floor(t * 14) % tr.c.length] : tr.c[Math.floor(Math.random() * tr.c.length)];
  return [c, tr.s || 1];
}

function makeRiderSkin(skin, look) {
  const rows = skin.rows;
  const eyes = new Set(skin.eyes.map(([x, y]) => `${x},${y}`));
  return paint(rows[0].length, rows.length, (i, j) => (eyes.has(`${i - look},${j}`) ? skin.eyeC : skin.pal[rows[j][i]] || null));
}

// Rider sitting in the barrel, drawn with the barrel's rim at rimY. skin.ox: column of the head's
// centre when the sprite carries something beside it (the castaway's ball, the angel's wings).
function drawRiderInBarrel(c, cx, rimY, riderSpr, skin, barrel, lift) {
  c.drawImage(riderSpr, cx - (skin.ox ?? riderSpr.width >> 1), rimY - lift - (riderSpr.height - 9));
  c.drawImage(barrel, cx - (barrel.width >> 1), rimY);
  if (lift >= RIDER_HIGH - 1) {
    c.fillStyle = skin.hand; // hands gripping the rim
    c.fillRect(cx - 7, rimY - 1, 2, 2);
    c.fillRect(cx + 5, rimY - 1, 2, 2);
  }
}

// Coin bubble: light ring with a coin inside (gold variant: golden ring, worth more).
function makeBubble(gold) {
  const S = 13;
  const c = S / 2;
  return paint(S, S, (i, j) => {
    const dx = i + 0.5 - c;
    const dy = j + 0.5 - c;
    const d = Math.hypot(dx, dy);
    if (d > 6.3) return null;
    if (d > 5.2) return gold ? '#ffe066' : '#bfe3ff';
    if ((i === 3 && j === 3) || (i === 4 && j === 2) || (i === 2 && j === 4)) return '#ffffff';
    const cd = Math.hypot(dx, dy + 0.2);
    if (cd < 3.3) {
      if (cd > 2.4) return '#a0520f';
      if (i === 6 && j >= 5 && j <= 7) return '#d9a514';
      return dx < 0 && dy < 0 ? '#fff3a0' : '#ffd23f';
    }
    return null;
  });
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
  sensBtn: $('sensBtn'),
  achBtn: $('achBtn'),
  achCount: $('achCount'),
  ach: $('ach'),
  achSummary: $('achSummary'),
  achList: $('achList'),
  achBack: $('achBack'),
  overAch: $('overAch'),
  overAchBtn: $('overAchBtn'),
  overShopBtn: $('overShopBtn'),
  overCoins: $('overCoins'),
  shopBtn: $('shopBtn'),
  shop: $('shop'),
  wallet: $('wallet'),
  shopPreview: $('shopPreview'),
  shopName: $('shopName'),
  shopDesc: $('shopDesc'),
  shopAction: $('shopAction'),
  tabBarrel: $('tabBarrel'),
  tabRider: $('tabRider'),
  shopList: $('shopList'),
  shopBack: $('shopBack'),
  toast: $('toast'),
  hudCoins: $('hudCoins'),
  shopCoins: $('shopCoins'),
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
const tapMode = params.get('tap') === 'true'; // test mode: press the left/right half of the screen
const playable = isMobile || pcMode || tapMode;

const input = new Input(tapMode ? canvas : null);
input.sens = save.sens;
sfx.setEnabled(save.sound);
sfx.setMusicEnabled(save.music);

// ---------- sprites ----------
// equipped skins (validated: an unknown or unowned id falls back to the classic one)
const owns = (kind, skin) => skin.price === 0 || save.owned[`${kind}:${skin.id}`] === true;
// exclusive skins (price null) are only given by an achievement (skin.ach)
let barrelSkin = BARREL_SKINS[0];
let riderSkin = RIDER_SKINS[0];
let barrelSpr = null;
let riderSprs = null;
function applySkins() {
  barrelSkin = BARREL_SKINS.find((k) => k.id === save.barrel && owns('b', k)) || BARREL_SKINS[0];
  riderSkin = RIDER_SKINS.find((k) => k.id === save.rider && owns('r', k)) || RIDER_SKINS[0];
  save.barrel = barrelSkin.id;
  save.rider = riderSkin.id;
  barrelSpr = barrelSkin.make();
  riderSprs = { '-1': makeRiderSkin(riderSkin, -1), 0: makeRiderSkin(riderSkin, 0), 1: makeRiderSkin(riderSkin, 1) };
}
applySkins();
const RIDER_LOW = 3; // rows above the rim while ducked: just the top of the hood
const RIDER_HIGH = 8; // rows above the rim while peeking: hood, eyes and collar
const rockSprs = {};
for (let r = 4; r <= 9; r++) rockSprs[r] = [0, 1, 2].map((v) => makeRock(r, r * 131 + v * 17 + 5));
const wallPattern = ctx.createPattern(makeStoneTile(64, 1234), 'repeat');
const waterTile = makeWaterTile(W + 16, 128, 99);
const foamTile = makeFoamTile(W + 16, 160, 77);
const bubbleSprs = [makeBubble(false), makeBubble(true)];
const BUBBLE_R = 6;
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
  bubbles: [], // coin bubbles: { wy, x, v, gold, ph }
  debris: [], // barrel pieces after a crash
  flyer: null, // the rider thrown out of the barrel
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
  run: null, // per-run achievement counters, see newRunStats()
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
  // coin bubbles float in the guaranteed gap, so they never force an impossible move
  if (!teach && G.rng() < 0.42) {
    const gold = G.rng() < 0.08;
    G.bubbles.push({ wy: wy + (G.rng() * 2 - 1) * 4, x: g + (G.rng() * 2 - 1) * gapW * 0.18, v: gold ? 5 : 1, gold, ph: G.rng() * 6 });
  }
  G.prevGap = g;
  G.rowIndex++;
  const nd = diff(wy + 80 - G.startCam);
  G.curSpacing = lerp(108, 62, nd) * (isCalm(G.rowIndex) ? 1.7 : 1);
  G.nextRowY += G.curSpacing;
}

// ---------- achievements ----------
// Trophy room: every badge starts grey and lights up once earned. Unlocks are saved right away,
// so a crash or a closed tab never loses one. tier: 1 bronze, 2 silver, 3 gold, 4 special.
const ACHIEVEMENTS = [
  { id: 'm100', icon: '100', tier: 1, name: '100 METROS RASOS', desc: 'Usain Bolt ficaria orgulhoso. Ou não. Desça 100 m.' },
  { id: 'm300', icon: '300', tier: 1, name: 'ESQUENTANDO O BARRIL', desc: 'Já pegou o jeito da coisa. Desça 300 m.' },
  { id: 'm500', icon: '500', tier: 2, name: 'MEIO CAMINHO BOIADO', desc: 'Meio quilômetro sem ralar a madeira. Desça 500 m.' },
  { id: 'm1000', icon: '1K', tier: 3, name: 'UOOEEEEE!', desc: 'A torcida de capa amarela aprova. Desça 1000 m.' },
  { id: 'm2000', icon: '2K', tier: 3, name: 'PEIXE HONORÁRIO', desc: 'Os lambaris mandaram um abraço. Desça 2000 m.' },
  { id: 'm3000', icon: '3K', tier: 4, name: 'LENDA DAS CATARATAS', desc: 'Já contam histórias suas no quiosque. Desça 3000 m.' },
  { id: 'tight', icon: '>|<', tier: 2, name: 'SÓ PASSOU O BARRIL', desc: 'Nem uma folha de papel passava junto. Passe entre duas pedras coladinhas.' },
  { id: 'tight5', icon: '5x', tier: 3, name: 'COSTUREIRO', desc: 'Enfiou o barril na agulha 5 vezes numa descida só.' },
  { id: 'graze1', icon: '~', tier: 1, name: 'RASPOU A TINTA', desc: 'O verniz ficou na pedra. Passe raspando numa pedra.' },
  { id: 'graze10', icon: '10', tier: 2, name: 'BARBEIRO DE PEDRA', desc: 'Fez a barba de 10 pedras numa descida só.' },
  { id: 'graze100', icon: '100~', tier: 3, name: 'VIVENDO PERIGOSAMENTE', desc: '100 raspadas no total. Sua mãe não precisa saber.' },
  { id: 'die1', icon: 'X', tier: 1, name: 'LASCOU', desc: 'Literalmente. Quebre o barril pela primeira vez.' },
  { id: 'early', icon: ':(', tier: 1, name: 'MORREU NA PRAIA', desc: 'Nem deu tempo de molhar o cabelo. Quebre antes dos 30 m.' },
  { id: 'trave', icon: '-1', tier: 2, name: 'NA TRAVE', desc: 'Faltou ISSO aqui ó. Quebre a menos de 10 m do recorde.' },
  { id: 'record', icon: 'REC', tier: 2, name: 'SUPERA-TE', desc: 'Bata o seu próprio recorde. O seu eu do passado chora.' },
  { id: 'runs10', icon: '10x', tier: 1, name: 'TEIMOSO', desc: '10 barris quebrados. O marceneiro agradece.' },
  { id: 'runs50', icon: '50x', tier: 3, name: 'VICIADO EM BARRIL', desc: '50 descidas. Tá tudo bem aí em casa?' },
  { id: 'km5', icon: '5KM', tier: 2, name: 'QUILOMETRAGEM ALTA', desc: 'Some 5 km descendo, contando todas as descidas.' },
  { id: 'km20', icon: '20KM', tier: 3, name: 'HORA DA REVISÃO', desc: '20 km no total. Troca o óleo desse barril.' },
  { id: 'zen', icon: 'Zz', tier: 2, name: 'MODO PLANTA', desc: 'Fique 5 s sem inclinar o celular. Fotossíntese ativada.' },
  { id: 'wall', icon: '|o', tier: 2, name: 'ABRAÇA-PAREDE', desc: 'Fique colado no paredão por 2 s. Carente.' },
  { id: 'mute', icon: 'shh', tier: 2, name: 'MODO BIBLIOTECA', desc: 'Chegue a 300 m com o som desligado. Shhhh.' },
  { id: 'hard', icon: '!!!', tier: 3, name: 'NERVOS DE AÇO', desc: 'Chegue a 500 m com a inclinação ALTA. Café demais?' },
  { id: 'pause', icon: '||', tier: 1, name: 'PAUSA PRO CAFEZINHO', desc: 'Pause a descida. Ninguém é de ferro.' },
  { id: 'night', icon: '(o)', tier: 2, name: 'CORUJA DO RIO', desc: 'Jogue entre meia-noite e 5 da manhã. Vai dormir!' },
  { id: 'bad3', icon: '3:(', tier: 1, name: 'FASE RUIM', desc: '3 descidas seguidas abaixo de 50 m. Acontece com todo mundo.' },
  { id: 'm50', icon: '50', tier: 1, name: 'AQUECIMENTO', desc: 'Desça 50 m. Alongou antes, né?' },
  { id: 'm666', icon: '666', tier: 2, name: 'NÚMERO DA BESTA', desc: 'Passe dos 666 m. Libera o DEMÔNIO.', skin: 'r:devil' },
  { id: 'm750', icon: '750', tier: 2, name: 'QUASE UM QUILÔMETRO', desc: 'Desça 750 m. Quase lá, quase lá...' },
  { id: 'm5000', icon: '5K', tier: 4, name: 'NEM O GPS TE ACHA', desc: 'Desça 5000 m numa descida só. Isso é humanamente possível?' },
  { id: 'coin1', icon: 'o', tier: 1, name: 'ESTOURA-BOLHA', desc: 'Estoure sua primeira bolha de moeda. Ploc!' },
  { id: 'goldbub', icon: 'O', tier: 1, name: 'BOLHA DE OURO', desc: 'Pegue uma bolha dourada. Vale 5 moedas!' },
  { id: 'coin20', icon: '20', tier: 2, name: 'MÃO DE VACA', desc: 'Pegue 20 moedas numa descida só.' },
  { id: 'coin50', icon: '50$', tier: 3, name: 'BANCO CENTRAL', desc: 'Pegue 50 moedas numa descida só. Imprimindo dinheiro.' },
  { id: 'coins500', icon: '500$', tier: 2, name: 'POUPANÇA', desc: 'Junte 500 moedas no total. Rende mais que a poupança.' },
  { id: 'bubbles300', icon: 'ooo', tier: 3, name: 'PLOC PLOC PLOC', desc: 'Estoure 300 bolhas no total. Libera a BUCHINHA.', skin: 'r:sponge' },
  { id: 'rich', icon: '$$', tier: 3, name: 'OSTENTAÇÃO', desc: 'Tenha 1000 moedas guardadas ao mesmo tempo.' },
  { id: 'nocoin', icon: '0$', tier: 2, name: 'DESAPEGADO', desc: 'Chegue a 500 m sem pegar nenhuma moeda. Dinheiro não traz felicidade.' },
  { id: 'angel', icon: '(+)', tier: 3, name: 'ANJO DA GUARDA', desc: 'Chegue a 500 m sem raspar em nenhuma pedra. Libera o ANJINHO.', skin: 'r:angel' },
  { id: 'tight25', icon: '25', tier: 3, name: 'ALFAIATE', desc: 'Passe 25 vezes entre pedras coladinhas, somando todas as descidas.' },
  { id: 'pingpong', icon: '<>', tier: 2, name: 'PINGUE-PONGUE', desc: 'Raspe em 3 pedras em menos de 2 segundos.' },
  { id: 'zen10', icon: 'ZZZ', tier: 3, name: 'MONGE TIBETANO', desc: 'Fique 10 s sem inclinar o celular. Iluminação alcançada.' },
  { id: 'wall5', icon: '||o', tier: 3, name: 'GRUDE', desc: 'Fique 5 s colado no paredão. Larga a parede!' },
  { id: 'runs100', icon: '100x', tier: 3, name: 'CEMITÉRIO DE BARRIS', desc: '100 barris quebrados. O marceneiro comprou casa na praia.' },
  { id: 'scream', icon: 'AAH', tier: 1, name: 'AAAAAHHH!', desc: 'Ouça o grito do piloto voando do barril. Clássico do cinema.' },
  { id: 'dejavu', icon: '=', tier: 2, name: 'DÉJÀ VU', desc: 'Termine duas descidas seguidas com a mesma distância.' },
  { id: 'empate', icon: 'REC=', tier: 3, name: 'EMPATE TÉCNICO', desc: 'Termine exatamente no seu recorde. Nem um metro a mais.' },
  { id: 'skins5', icon: '5', tier: 2, name: 'FASHIONISTA', desc: 'Tenha 5 skins compradas na loja. Estilo é tudo.' },
  { id: 'cold', icon: '*', tier: 2, name: 'FRIO DE RACHAR', desc: 'Desça 100 m com o ABOMINÁVEL dentro da GELADEIRA.' },
  { id: 'horror', icon: '!?', tier: 2, name: 'NOITE DE TERROR', desc: 'Chegue a 300 m com um monstro: bruxa, vampiro, zumbi e cia.' },
  { id: 'milson', icon: 'MIL', tier: 1, name: 'MILSOOOON!', desc: 'Quebre o barril com o NÁUFRAGO. Alguém salva a bola!' },
  { id: 'rainbow', icon: '~~~', tier: 2, name: 'ÓLEO ARCO-ÍRIS', desc: 'Chegue a 500 m com o UNICÓRNIO. O IBAMA já foi avisado.' },
  { id: 'nessie', icon: 'S', tier: 2, name: 'FINALMENTE FOTOGRAFADO', desc: 'Chegue a 200 m com o MONSTRO DO LAGO. A foto saiu borrada.' },
  { id: 'eureka', icon: 'E!', tier: 3, name: 'EUREKA!', desc: 'Chegue a 1000 m com o CIENTISTA MALUCO. A ciência venceu.' },
  { id: 'caramelo', icon: 'AU', tier: 1, name: 'PATRIMÔNIO NACIONAL', desc: 'Desça com o VIRA-LATA CARAMELO. Ele merece.' },
  { id: 'holiday', icon: 'FER', tier: 3, name: 'FERIADÃO', desc: 'Tenha o PAPAI NOEL, o COELHO DA PÁSCOA e o TATU DO HANUKKAH.' },
  { id: 'sextou', icon: 'SEX', tier: 1, name: 'SEXTOU!', desc: 'Jogue numa sexta-feira. O fim de semana começa no barril.' },
  { id: 'shop1', icon: '$', tier: 1, name: 'CONSUMISTA', desc: 'Compre a primeira skin. O capitalismo agradece.' },
  { id: 'shopall', icon: '$$$', tier: 4, name: 'GUARDA-ROUPA COMPLETO', desc: 'Tenha todas as skins de barril e de piloto. Todas mesmo.' },
  { id: 'all', icon: '***', tier: 4, name: 'PLATINOU', desc: 'Libere todas as outras conquistas. Agora vai lá fora pegar um sol.', reward: 300 },
];
// Every achievement pays coins by tier; some also give an exclusive skin (a.skin).
const TIER_REWARD = [0, 10, 25, 50, 100];
const achReward = (a) => a.reward ?? TIER_REWARD[a.tier];
const skinByKey = (key) => (key[0] === 'b' ? BARREL_SKINS : RIDER_SKINS).find((k) => k.id === key.slice(2));
const MONSTERS = new Set(RIDER_SKINS.filter((k) => k.monster).map((k) => k.id));
const DIST_ACH = [
  [50, 'm50'], [100, 'm100'], [300, 'm300'], [500, 'm500'], [666, 'm666'], [750, 'm750'],
  [1000, 'm1000'], [2000, 'm2000'], [3000, 'm3000'], [5000, 'm5000'],
];
const TIGHT_GAP = 2 * HIT_R + 12; // free space between two rock hitboxes that counts as "só passou o barril"
const ZEN_SECS = 5;
const WALL_SECS = 2;
const WALL_NEAR = 3; // px between the barrel's edge and the wall
const unseenAch = new Set(); // unlocked since the trophy room was last opened
const toastQueue = [];
let toastTimer = 0;

function achUnlocked() {
  return ACHIEVEMENTS.filter((a) => save.ach[a.id]).length;
}

// Pays an unlocked achievement's reward once (also used at boot for badges earned before
// rewards existed).
function grant(a) {
  if (save.paid[a.id]) return;
  save.paid[a.id] = true;
  save.coins += achReward(a);
  if (a.skin) save.owned[a.skin] = true;
}

function unlock(id) {
  if (save.ach[id]) return;
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  if (!a) return;
  save.ach[id] = true;
  grant(a);
  unseenAch.add(id);
  G.run.newAch.push(id);
  writeSave(save);
  toastQueue.push(a);
  if (!toastTimer) nextToast();
  refreshAchCount();
  checkWallet();
  if (a.skin) checkOwned();
  if (id !== 'all' && ACHIEVEMENTS.every((x) => x.id === 'all' || save.ach[x.id])) unlock('all');
}

function checkWallet() {
  if (save.coins >= 1000) unlock('rich');
}

function checkOwned() {
  const has = (key) => owns(key[0], skinByKey(key));
  const bought = Object.keys(save.owned).filter((k) => save.owned[k] && skinByKey(k) && skinByKey(k).price > 0).length;
  if (bought >= 1) unlock('shop1');
  if (bought >= 5) unlock('skins5');
  if (has('r:santa') && has('r:bunny') && has('r:armadillo')) unlock('holiday');
  if (BARREL_SKINS.every((k) => owns('b', k)) && RIDER_SKINS.every((k) => owns('r', k))) unlock('shopall');
}

function nextToast() {
  const a = toastQueue.shift();
  if (!a) {
    toastTimer = 0;
    show(ui.toast, false);
    return;
  }
  const extra = a.skin ? ` + ${skinByKey(a.skin).name}` : '';
  ui.toast.innerHTML = `<b>CONQUISTA LIBERADA!</b>${a.name}<i>+${achReward(a)} MOEDAS${extra}</i>`;
  show(ui.toast, false);
  void ui.toast.offsetWidth; // restart the CSS animation
  show(ui.toast, true);
  sfx.blip([784, 988, 1175, 1568], 0.06, 0.06);
  toastTimer = setTimeout(nextToast, 2500);
}

function refreshAchCount() {
  ui.achCount.textContent = `${achUnlocked()}/${ACHIEVEMENTS.length}`;
  ui.shopCoins.textContent = save.coins;
}

function renderAch() {
  const n = achUnlocked();
  ui.achSummary.textContent = `${n}/${ACHIEVEMENTS.length} LIBERADAS`;
  ui.achList.textContent = '';
  for (const a of ACHIEVEMENTS) {
    const on = !!save.ach[a.id];
    const li = document.createElement('li');
    li.className = `ach t${a.tier}${on ? '' : ' locked'}${unseenAch.has(a.id) ? ' fresh' : ''}`;
    li.setAttribute('aria-label', `${a.name}: ${a.desc} ${on ? 'Liberada.' : 'Bloqueada.'}`);
    const medal = document.createElement('div');
    medal.className = on && a.icon.length > 3 ? 'medal long' : 'medal';
    medal.textContent = on ? a.icon : '?';
    const txt = document.createElement('div');
    txt.className = 'txt';
    const name = document.createElement('p');
    name.className = 'name';
    name.textContent = a.name;
    const desc = document.createElement('p');
    desc.className = 'desc';
    desc.textContent = a.desc;
    const reward = document.createElement('p');
    reward.className = 'reward';
    reward.textContent = `+${achReward(a)} MOEDAS${a.skin ? ` + ${skinByKey(a.skin).name}` : ''}`;
    txt.append(name, desc, reward);
    li.append(medal, txt);
    ui.achList.append(li);
  }
  unseenAch.clear();
}

let achFrom = null; // screen to go back to
function openAch(from) {
  achFrom = from;
  renderAch();
  show(from, false);
  show(ui.ach, true);
  ui.achList.scrollTop = 0;
}
function closeAch() {
  show(ui.ach, false);
  show(achFrom || ui.title, true);
  G.lockUntil = performance.now() + 300; // the "VOLTAR" tap must not also start a run
}

function newRunStats() {
  return { grazes: 0, grazeT: [], tight: 0, zenT: 0, wallT: 0, coins: 0, bubbles: 0, newAch: [] };
}

// Called when a rock scrolls past the barrel: was the barrel squeezed between this rock and a
// neighbour on the other side of the same row?
function checkTight(r) {
  let L = null;
  let R = null;
  for (const o of G.rocks) {
    if (Math.abs(o.wy - r.wy) > 12) continue;
    if (o.x < G.bx) {
      if (!L || o.x > L.x) L = o;
    } else if (!R || o.x < R.x) R = o;
  }
  if (!L || !R || (L !== r && R !== r) || L.tight || R.tight) return;
  const free = R.x - R.r * 0.82 - (L.x + L.r * 0.82);
  if (free >= TIGHT_GAP) return;
  L.tight = R.tight = true;
  G.run.tight++;
  save.tightTotal++;
  unlock('tight');
  if (G.run.tight >= 5) unlock('tight5');
  if (save.tightTotal >= 25) unlock('tight25');
}

function achOnGraze() {
  G.run.grazes++;
  save.grazes++;
  unlock('graze1');
  if (G.run.grazes >= 10) unlock('graze10');
  if (save.grazes >= 100) unlock('graze100');
  const ts = G.run.grazeT;
  ts.push(G.playT);
  if (ts.length > 3) ts.shift();
  if (ts.length === 3 && ts[2] - ts[0] <= 2) unlock('pingpong');
}

function achOnBubble(b) {
  unlock('coin1');
  if (b.gold) unlock('goldbub');
  if (G.run.coins >= 20) unlock('coin20');
  if (G.run.coins >= 50) unlock('coin50');
  if (save.coinsTotal >= 500) unlock('coins500');
  if (save.bubbles >= 300) unlock('bubbles300');
  checkWallet();
}

function achOnMeters(m) {
  for (const [d, id] of DIST_ACH) if (m >= d) unlock(id);
  if (m >= 300 && !save.sound) unlock('mute');
  if (m >= 500 && save.sens === 2) unlock('hard');
  if (m >= 500 && G.run.coins === 0) unlock('nocoin');
  if (m >= 500 && G.run.grazes === 0) unlock('angel');
  const r = riderSkin.id;
  if (m >= 100 && r === 'yeti' && barrelSkin.id === 'fridge') unlock('cold');
  if (m >= 300 && MONSTERS.has(r)) unlock('horror');
  if (m >= 200 && r === 'nessie') unlock('nessie');
  if (m >= 500 && r === 'unicorn') unlock('rainbow');
  if (m >= 1000 && r === 'scientist') unlock('eureka');
}

function achOnStep(dt, steer, by) {
  if (!G.landed) return;
  G.run.zenT = Math.abs(steer) < 0.05 ? G.run.zenT + dt : 0;
  if (G.run.zenT >= ZEN_SECS) unlock('zen');
  if (G.run.zenT >= 10) unlock('zen10');
  const margin = Math.min(G.bx - wallL(by), wallR(by) - G.bx) - HIT_R;
  G.run.wallT = margin < WALL_NEAR ? G.run.wallT + dt : 0;
  if (G.run.wallT >= WALL_SECS) unlock('wall');
  if (G.run.wallT >= 5) unlock('wall5');
}

function achOnDeath(m) {
  unlock('die1');
  if (m < 30) unlock('early');
  if (save.best >= 50 && m < save.best && save.best - m <= 10) unlock('trave');
  if (save.best >= 50 && m === save.best) unlock('empate');
  if (m > 0 && m === save.lastM) unlock('dejavu');
  save.lastM = m;
  if (save.sound) unlock('scream');
  if (riderSkin.id === 'castaway') unlock('milson');
  save.runs++;
  save.totalM += m;
  save.badStreak = m < 50 ? save.badStreak + 1 : 0;
  if (save.runs >= 10) unlock('runs10');
  if (save.runs >= 50) unlock('runs50');
  if (save.runs >= 100) unlock('runs100');
  if (save.totalM >= 5000) unlock('km5');
  if (save.totalM >= 20000) unlock('km20');
  if (save.badStreak >= 3) unlock('bad3');
  writeSave(save);
}

// ---------- shop ----------
const wallet = () => save.coins;
const COIN_ICON = '<i class="coin" aria-hidden="true"></i>';
const shop = { tab: 'b', sel: 'classic', from: null };
const shopSkins = () => (shop.tab === 'b' ? BARREL_SKINS : RIDER_SKINS);
const equippedId = () => (shop.tab === 'b' ? save.barrel : save.rider);
const pctx = ui.shopPreview.getContext('2d');

function drawShopPreview() {
  const b = shop.tab === 'b' ? BARREL_SKINS.find((k) => k.id === shop.sel) : barrelSkin;
  const r = shop.tab === 'r' ? RIDER_SKINS.find((k) => k.id === shop.sel) : riderSkin;
  const W2 = ui.shopPreview.width;
  const H2 = ui.shopPreview.height;
  pctx.imageSmoothingEnabled = false;
  pctx.fillStyle = '#1f5fae';
  pctx.fillRect(0, 0, W2, H2);
  pctx.fillStyle = '#3e88d6';
  for (let x = 1; x < W2; x += 4) pctx.fillRect(x, (x * 7) % H2, 1, 5);
  drawRiderInBarrel(pctx, W2 >> 1, H2 - BARREL_H - 1, makeRiderSkin(r, 0), r, b.make(), RIDER_HIGH);
}

function refreshShop() {
  ui.wallet.textContent = wallet();
  ui.tabBarrel.classList.toggle('on', shop.tab === 'b');
  ui.tabRider.classList.toggle('on', shop.tab === 'r');
  ui.tabBarrel.setAttribute('aria-selected', String(shop.tab === 'b'));
  ui.tabRider.setAttribute('aria-selected', String(shop.tab === 'r'));
  const skin = shopSkins().find((k) => k.id === shop.sel);
  const have = owns(shop.tab, skin);
  const using = equippedId() === skin.id;
  const exclusive = skin.price === null;
  const viaAch = exclusive ? ACHIEVEMENTS.find((a) => a.id === skin.ach) : null;
  ui.shopName.textContent = skin.name;
  ui.shopDesc.textContent = !have && viaAch ? `${skin.desc} Libera com a conquista ${viaAch.name}.` : skin.desc;
  const btn = ui.shopAction;
  btn.classList.remove('wait', 'using');
  if (using) {
    btn.textContent = 'EM USO';
    btn.classList.add('using');
  } else if (have) btn.textContent = 'USAR';
  else if (exclusive) {
    btn.textContent = 'EXCLUSIVO DE CONQUISTA';
    btn.classList.add('wait');
  } else if (wallet() >= skin.price) btn.innerHTML = `COMPRAR: ${COIN_ICON}${skin.price}`;
  else {
    btn.innerHTML = `FALTAM ${COIN_ICON}${skin.price - wallet()}`;
    btn.classList.add('wait');
  }
  drawShopPreview();

  ui.shopList.textContent = '';
  for (const k of shopSkins()) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    const mine = owns(shop.tab, k);
    const eq = equippedId() === k.id;
    b.className = `item${mine ? '' : ' locked'}${eq ? ' equipped' : ''}${k.id === shop.sel ? ' sel' : ''}`;
    b.dataset.id = k.id;
    const priceTxt = k.price === null ? ', exclusivo de conquista' : `, ${k.price} moedas`;
    b.setAttribute('aria-label', `${k.name}${mine ? '' : priceTxt}${eq ? ', em uso' : ''}`);
    const cv = shop.tab === 'b' ? k.make() : makeRiderSkin(k, 0);
    cv.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    if (eq) label.textContent = 'EM USO';
    else if (mine) label.textContent = 'SUA';
    else if (k.price === null) label.textContent = 'TROFÉU';
    else label.innerHTML = `${COIN_ICON}${k.price}`;
    b.append(cv, label);
    li.append(b);
    ui.shopList.append(li);
  }
}

function openShop(from) {
  shop.from = from;
  shop.sel = equippedId();
  show(from, false);
  show(ui.shop, true);
  refreshShop();
  ui.shopList.scrollTop = 0;
}
function closeShop() {
  show(ui.shop, false);
  show(shop.from || ui.title, true);
  G.lockUntil = performance.now() + 300;
}
function setShopTab(tab) {
  shop.tab = tab;
  shop.sel = equippedId();
  refreshShop();
  ui.shopList.scrollTop = 0;
}

function shopAct() {
  const skin = shopSkins().find((k) => k.id === shop.sel);
  if (equippedId() === skin.id) return;
  if (!owns(shop.tab, skin)) {
    if (skin.price === null || wallet() < skin.price) {
      sfx.blip([220, 180], 0.08, 0.05);
      return;
    }
    save.coins -= skin.price;
    save.owned[`${shop.tab}:${skin.id}`] = true;
    sfx.blip([523, 659, 784, 1047, 1319], 0.06, 0.06);
    checkOwned();
  } else sfx.blip([880, 1175], 0.05, 0.05);
  if (shop.tab === 'b') save.barrel = skin.id;
  else save.rider = skin.id;
  applySkins();
  writeSave(save);
  refreshAchCount();
  refreshShop();
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
  G.bubbles.length = 0;
  G.debris.length = 0;
  G.flyer = null;
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
  G.run = newRunStats();
  endCheer();
}

function start() {
  if (!playable || G.state === 'playing' || !ui.ach.hidden || !ui.shop.hidden) return;
  if (performance.now() < G.lockUntil) return;
  sfx.unlock();
  if (!pcMode && !tapMode) input.requestPermission(); // iOS prompt; must be called synchronously from the tap
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
  showHint(tapMode ? 'TOQUE À ESQUERDA<br>OU À DIREITA' : pcMode ? 'USE ← → NO TECLADO' : 'INCLINE O CELULAR');
  sfx.stopLose();
  sfx.startWater();
  sfx.startMusic();
  sfx.splash();
  requestWakeLock();
  const now = new Date();
  if (now.getHours() < 5) unlock('night');
  if (now.getDay() === 5) unlock('sextou');
  if (riderSkin.id === 'caramelo') unlock('caramelo');
  ui.hudCoins.textContent = '0';
  setTimeout(() => {
    if (G.state === 'playing' && !input.hasSensor && !pcMode && !tapMode) showHint('SENSOR DE MOVIMENTO<br>NÃO ENCONTRADO');
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
  achOnDeath(G.meters);
  sfx.crash();
  sfx.scream();
  sfx.stopWater(0.35);
  sfx.stopMusic();
  sfx.lose(1.15);
  endCheer();
  if (navigator.vibrate) navigator.vibrate([70, 40, 120]);
  const by = G.cam + curBY;
  breakBarrel(by);
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

// The barrel splits into a 3x2 grid of pieces that tumble off, and the rider is thrown upwards.
function breakBarrel(by) {
  G.debris.length = 0;
  const xs = [0, 7, 13, BARREL_W];
  const ys = [0, 12, BARREL_H];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      const sw = xs[c + 1] - xs[c];
      const sh = ys[r + 1] - ys[r];
      const ox = xs[c] + sw / 2 - BARREL_W / 2;
      const oy = ys[r] + sh / 2 - BARREL_H / 2;
      G.debris.push({
        sx: xs[c], sy: ys[r], sw, sh,
        x: G.bx + ox, y: by + oy,
        vx: ox * 9 + (Math.random() * 2 - 1) * 25, vy: -50 - Math.random() * 70 + oy * 4,
        rot: 0, vr: (Math.random() * 2 - 1) * 9,
      });
    }
  }
  G.flyer = { x: G.bx, y: by - 12, vx: (Math.random() * 2 - 1) * 35, vy: -170, rot: 0, vr: (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 4) };
}

function updateDebris(dt) {
  for (const p of G.debris) {
    p.vy += 320 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
  }
  const f = G.flyer;
  if (f) {
    f.vy += 300 * dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.rot += f.vr * dt;
    if (f.y - G.cam > H + 40) G.flyer = null;
  }
  if (G.debris.length && G.debris.every((p) => p.y - G.cam > H + 30)) G.debris.length = 0;
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
  const got = G.run.newAch.length;
  ui.overAch.textContent = got === 1 ? '+1 CONQUISTA NOVA!' : `+${got} CONQUISTAS NOVAS!`;
  show(ui.overAch, got > 0);
  ui.overCoins.innerHTML = `+${COIN_ICON}${G.run.coins} NESTA DESCIDA · SALDO ${COIN_ICON}${save.coins}`;
  refreshAchCount();
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
  unlock('pause');
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
        checkTight(r);
      }
      G.rocks[w++] = r;
    }
    G.rocks.length = w;

    // coin bubbles: despawn behind, pop when the barrel touches them
    let wb = 0;
    for (let k = 0; k < G.bubbles.length; k++) {
      const b = G.bubbles[k];
      if (b.wy < G.cam - 24) continue;
      const bx = b.x + Math.sin(G.t * 2 + b.ph) * 2;
      const dx = bx - G.bx;
      const dy = b.wy - by;
      const rr = HIT_R + BUBBLE_R;
      if (G.landed && dx * dx + dy * dy < rr * rr) {
        collectBubble(b, bx);
        continue;
      }
      G.bubbles[wb++] = b;
    }
    G.bubbles.length = wb;

    if (G.landed && collides(by)) {
      die();
      return;
    }
    achOnStep(dt, steer, by);

    // spray at the waterline and a wake trailing above the barrel
    if (curBY > 0 && Math.random() < dt * 40) {
      const side = Math.random() < 0.5 ? -1 : 1;
      emit(G.bx + side * 9, by + 6, side * (15 + Math.random() * 30), G.speed - 20 - Math.random() * 30, 0.35, '#e6f5ff', 1, 0);
    }
    if (curBY > 0 && Math.random() < dt * 30) {
      const [tc, ts] = trailColor(G.t);
      emit(G.bx + (Math.random() * 14 - 7), by - 12, 0, G.speed * 0.25, 0.5, tc, ts, 0);
    }

    const m = Math.floor(dist / PX_PER_M);
    if (m !== G.meters) {
      G.meters = m;
      ui.score.textContent = `${m} m`;
      achOnMeters(m);
      if (m >= G.nextMilestone) {
        milestone(G.nextMilestone);
        G.nextMilestone += 100;
      }
      if (!G.beatBest && save.best > 0 && m > save.best) {
        G.beatBest = true;
        ui.best.textContent = 'NOVO REC!';
        ui.best.classList.add('beat');
        sfx.blip([784, 1047, 1319], 0.07, 0.06);
        unlock('record');
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
    updateDebris(dt);
    G.speed *= Math.exp(-5 * dt);
    G.cam += G.speed * dt;
    G.deathT += dt;
    if (G.deathT > 1.0) gameOver();
  } else if (G.state === 'over') {
    updateDebris(dt);
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

function collectBubble(b, x) {
  G.run.coins += b.v;
  G.run.bubbles++;
  save.coins += b.v;
  save.coinsTotal += b.v;
  save.bubbles++;
  ui.hudCoins.textContent = G.run.coins;
  sfx.coin(b.gold);
  for (let k = 0; k < (b.gold ? 14 : 8); k++) {
    const a = (k / (b.gold ? 14 : 8)) * Math.PI * 2;
    emit(x, b.wy, Math.cos(a) * 45, Math.sin(a) * 45 + G.speed * 0.6, 0.35, k % 2 ? '#ffffff' : b.gold ? '#ffd23f' : '#bfe3ff', 1, 0);
  }
  achOnBubble(b);
}

function nearMiss(r) {
  sfx.tick();
  achOnGraze();
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

  // coin bubbles
  for (const b of G.bubbles) {
    const sy = Math.round(b.wy - cam + Math.sin(G.t * 3 + b.ph));
    if (sy < -10 || sy > H + 10) continue;
    const spr = bubbleSprs[b.gold ? 1 : 0];
    ctx.drawImage(spr, Math.round(b.x + Math.sin(G.t * 2 + b.ph) * 2) - (spr.width >> 1), sy - (spr.height >> 1));
  }

  // crash: barrel pieces and the rider flying out
  for (const p of G.debris) {
    ctx.save();
    ctx.translate(Math.round(p.x), Math.round(p.y - cam));
    ctx.rotate(p.rot);
    ctx.drawImage(barrelSpr, p.sx, p.sy, p.sw, p.sh, -p.sw / 2, -p.sh / 2, p.sw, p.sh);
    ctx.restore();
  }
  if (G.flyer) {
    const f = G.flyer;
    const spr = riderSprs[0];
    ctx.save();
    ctx.translate(Math.round(f.x), Math.round(f.y - cam));
    ctx.rotate(f.rot);
    ctx.drawImage(spr, -(riderSkin.ox ?? spr.width >> 1), -(spr.height >> 1));
    ctx.restore();
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
    drawRiderInBarrel(ctx, 0, -BARREL_H / 2, riderSprs[look], riderSkin, barrelSpr, lift);
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
  ui.sensBtn.hidden = !isMobile;
  ui.howTo.innerHTML = tapMode
    ? 'TOQUE À ESQUERDA OU À<br>DIREITA PARA DESVIAR'
    : pcMode
      ? 'USE ← → PARA<br>DESVIAR DAS PEDRAS'
      : tiltAvailable
        ? 'INCLINE O CELULAR PARA<br>DESVIAR DAS PEDRAS'
        : 'ABRA EM HTTPS PARA<br>USAR O SENSOR';
  for (const [btn, on, name] of [
    [ui.soundBtn, save.sound, 'Som'],
    [ui.musicBtn, save.music, 'Música'],
    [ui.shakeBtn, save.shake, 'Tremor'],
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
bindToggle(ui.shakeBtn, () => {
  save.shake = !save.shake;
});
bindToggle(ui.sensBtn, () => {
  save.sens = (save.sens + 1) % 3;
  input.sens = save.sens;
  input.requestPermission(); // also a good moment to get the iOS motion prompt out of the way
});

// ---------- wiring ----------
ui.title.addEventListener('click', start);
ui.over.addEventListener('click', (e) => {
  if (e.target.closest('#menuBtn')) toTitle();
  else if (e.target.closest('#overAchBtn')) {
    if (performance.now() >= G.lockUntil) openAch(ui.over);
  } else if (e.target.closest('#overShopBtn')) {
    if (performance.now() >= G.lockUntil) openShop(ui.over);
  } else start();
});
ui.achBtn.addEventListener('click', (e) => {
  e.stopPropagation(); // the title screen itself starts a run on tap
  sfx.unlock();
  sfx.blip([880], 0.05, 0.05);
  openAch(ui.title);
});
ui.shopBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  sfx.unlock();
  sfx.blip([880], 0.05, 0.05);
  openShop(ui.title);
});
ui.shopBack.addEventListener('click', () => {
  sfx.blip([660], 0.05, 0.05);
  closeShop();
});
ui.shopAction.addEventListener('click', shopAct);
ui.tabBarrel.addEventListener('click', () => setShopTab('b'));
ui.tabRider.addEventListener('click', () => setShopTab('r'));
ui.shopList.addEventListener('click', (e) => {
  const b = e.target.closest('.item');
  if (!b) return;
  shop.sel = b.dataset.id;
  sfx.blip([990], 0.04, 0.04);
  refreshShop();
});
ui.achBack.addEventListener('click', () => {
  sfx.blip([660], 0.05, 0.05);
  closeAch();
});
ui.pause.addEventListener('click', resume);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
document.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && !ui.ach.hidden) return closeAch();
  if (e.code === 'Escape' && !ui.shop.hidden) return closeShop();
  if (e.code !== 'Space' && e.code !== 'Enter') return;
  if (!ui.ach.hidden || !ui.shop.hidden) return;
  if (G.state === 'title' || G.state === 'over') start();
  else if (G.state === 'paused') resume();
});

ui.titleBest.textContent = save.best;
G.run = newRunStats();
// pay rewards for badges earned before achievements paid coins (and any skins they give)
for (const a of ACHIEVEMENTS) if (save.ach[a.id]) grant(a);
applySkins();
checkOwned();
checkWallet();
writeSave(save);
G.run = newRunStats(); // the boot checks above must not count as "new" for the first run
refreshToggles();
refreshAchCount();
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
    unlock: (id) => unlock(id),
    achievements: () => ({ ...save.ach }),
    give: (n) => {
      save.coins += n;
      writeSave(save);
      refreshAchCount();
    },
    bubbles: () => G.bubbles.map((b) => ({ wy: b.wy, x: b.x, v: b.v })),
    save: () => JSON.parse(JSON.stringify(save)),
    rockList: () => G.rocks.map((r) => ({ wy: r.wy, x: r.x, r: r.r })),
    gaps: () => testGaps.filter((g) => g.wy > G.cam - 30),
    walls: (wy) => [wallL(wy), wallR(wy)],
  };
}

})();
