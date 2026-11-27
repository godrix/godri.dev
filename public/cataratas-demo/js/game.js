// Cataratas: one classic script (no ES modules) so it also runs when index.html is opened
// straight from disk (file://), where browsers block module scripts.
(() => {
'use strict';

// ---------- language ----------
// The game is written in Portuguese; js/lang.js maps each Portuguese text to English and Spanish
// ([pt, en, es] rows). tr(pt) gives the text in the player's language, falling back to Portuguese
// when a row is missing; trf(pt, ...args) fills {0}, {1}... Data (skins, badges) is translated as
// it's defined, so switching language reloads the page.
const LANGS = ['pt', 'en', 'es'];
const LANG_KEY = 'cataratas.lang';
const LANG = (() => {
  let l = '';
  try {
    l = localStorage.getItem(LANG_KEY) || '';
  } catch {
    /* no storage */
  }
  const q = new URLSearchParams(location.search).get('lang');
  if (LANGS.includes(q)) l = q;
  if (!LANGS.includes(l)) {
    const nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'pt';
    l = nav.slice(0, 2).toLowerCase();
  }
  return LANGS.includes(l) ? l : 'en'; // other languages: English
})();
const LOCALE = { pt: 'pt-BR', en: 'en-US', es: 'es' }[LANG];
const DICT = new Map();
if (LANG !== 'pt') {
  const col = LANGS.indexOf(LANG);
  for (const row of window.CATARATAS_LANG || []) if (row[col]) DICT.set(row[0], row[col]);
}
const tr = (pt) => DICT.get(pt) ?? pt;
const trf = (pt, ...args) => tr(pt).replace(/\{(\d)\}/g, (_, i) => args[i] ?? '');
document.documentElement.lang = LOCALE;
// The page's fixed texts (index.html): text nodes and a few attributes, keyed by their
// whitespace-collapsed Portuguese text. htmlKeys lists them (for the translation table).
const htmlKeys = new Set();
const HTML_ATTRS = ['aria-label', 'placeholder', 'title', 'alt'];
function translateDom(root) {
  const key = (t) => t.replace(/\s+/g, ' ').trim();
  const worth = (k) => /[A-Za-zÀ-ü]{2,}/.test(k);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement.closest('script, style, svg, [data-lang]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const k = key(n.nodeValue);
    if (!worth(k)) continue;
    htmlKeys.add(k);
    const t = tr(k);
    if (t !== k) n.nodeValue = n.nodeValue.replace(/^(\s*)[\s\S]*?(\s*)$/, (_, a, b) => a + t + b);
  }
  for (const el of root.querySelectorAll(HTML_ATTRS.map((a) => `[${a}]`).join(','))) {
    for (const a of HTML_ATTRS) {
      const v = el.getAttribute(a);
      if (!v || !worth(key(v))) continue;
      htmlKeys.add(key(v));
      el.setAttribute(a, tr(key(v)));
    }
  }
  document.title = tr(document.title);
  htmlKeys.add(document.title);
}
translateDom(document.body);
// AJUSTES: the language buttons (the page reloads in the new language)
for (const b of document.querySelectorAll('#langTabs [data-lang]')) {
  b.classList.toggle('on', b.dataset.lang === LANG);
  b.setAttribute('aria-pressed', String(b.dataset.lang === LANG));
  b.addEventListener('click', () => {
    if (b.dataset.lang === LANG) return;
    try {
      localStorage.setItem(LANG_KEY, b.dataset.lang);
    } catch {
      /* no storage: stays for this visit only */
    }
    const u = new URL(location.href);
    u.searchParams.delete('lang');
    location.replace(u);
  });
}

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

// DEMO: the playable demo on the site (godri.dev/cataratas-demo, built by npm run publish:demo,
// or ?demo here): one run up to DEMO_M, no shop, trophies, ranking, challenges or network, its
// own save, and a screen with the store buttons at the end.
const DEMO = !!window.CATARATAS_DEMO || new URLSearchParams(location.search).has('demo');
const DEMO_M = 800;
const KEY = DEMO ? 'cataratas.demo' : 'cataratas.save';
// BETA: everyone who opens the game while this is true gets the BETA TESTER rider and the BARRIL
// BETA for good. At launch, set it to false: whoever got them keeps them; for everyone else they
// show up grey in the shop, unavailable.
const BETA = true;
const VERSION = 2;
// App version shown on SOBRE; scripts/check.mjs makes sure it matches android/app/build.gradle.
const APP_VERSION = '0.9.5';

// Random id of this install: it keys this device's coin ledger (see recalcCoins).
const newDeviceId = () => Math.random().toString(36).slice(2, 12).padEnd(10, '0');
const DEV_RE = /^[a-z0-9]{8,16}$/;

function defaults(reducedMotion) {
  return {
    v: VERSION, best: 0, sound: true, music: true, shake: !reducedMotion, diff: 1,
    // achievements: unlocked ids -> true, plus the lifetime stats some of them count
    ach: {}, runs: 0, tutDone: false, totalM: 0, grazes: 0, badStreak: 0,
    // coins come from bubbles and achievement rewards; owned keys are "b:<id>" / "r:<id>"
    coins: 0, gems: 0, coinsTotal: 0, bubbles: 0, tightTotal: 0, repairs: 0, lastM: -1, paid: {}, powers: {},
    owned: {}, barrel: 'classic', rider: 'classic',
    // coin ledger per install { [dev]: { e: earned, s: spent } } (bubbles, daily challenges and the
    // shop). "coins" is derived: sum(e) - sum(s) + rewards of the paid achievements. Each install
    // only ever grows its own entry, so two phones' saves merge without losing or doubling coins.
    dev: newDeviceId(), ledger: {},
    // ranking: what this player has sent (or will send) to the online board. best/total are
    // points (metres x difficulty weight), easy/normal/hard the best run in metres per mode.
    rank: { name: '', best: 0, total: 0, easy: 0, normal: 0, hard: 0, runs: 0, pos: 0, dirty: false, week: -1, wbest: 0, pweek: -1, pwbest: 0 },
    weekPrize: -1, // last week whose SEMANA prize was checked
    // challenges of the day: key = local date "YYYY-MM-DD"; done/prog = the main one (prog: what
    // earlier runs that day added up), mini = the 2 minis, wk = the 3 weekend ones (Sat/Sun only).
    // wkKey/wkDone: weekend ones done in the weekend that starts on day number wkKey.
    daily: { key: '', done: false, prog: 0, mini: [], wk: [], extra: [] }, dailyCount: 0, miniCount: 0, wkKey: -1, wkDone: 0,
    // shares that reached the share sheet's end, and the apps picked (Android tells which)
    shares: 0, shareApps: {},
    // riders that went 300 m in their matching barrel (DESFILE DE MODA)
    pairs: {},
    // DIÁRIO: when and how each badge ("a:<id>") and skin ("b:<id>" / "r:<id>") was earned:
    // [time ms, how (0 run, 1 shop, 2 menu, 3 code, 4 gift), rider, barrel, metres (-1 off a run),
    // weather, difficulty]. Only from this version on; older items show as "before the diary".
    diary: {},
    // DIAMANTES: earned/spent live in the ledger (g / gs); gemDay = Brasília day whose first-run
    // bonus was paid; gemGoogle = linking Google already paid its diamonds
    gemDay: '', gemGoogle: false,
    // OFICINA levels (bought with diamonds) and whether runs use them (tuned runs skip the ranking)
    tune: { hull: 0, magnet: 0, shield: 0 }, tuneOn: true,
    // purchases: noAds = REMOVER ANÚNCIOS bought; iap = transactions already credited
    noAds: false, iap: {},
    // promo codes already redeemed (RESGATAR CÓDIGO)
    codes: {},
    // NFC lab: slot (1-6) -> hash of the chip that made that creature
    nfc: {},
    // step counter (PASSOS in AJUSTES; stays on this phone, never in the cloud backup)
    steps: false, stepLast: -1, stepBoot: 0, stepsTotal: 0,
    // reminders (local notifications, Android app): on by default, the permission asked once
    notify: true, notifAsked: false,
    // invites: who invited this player (their account id), if this player was new then, and
    // whether that still has to reach Firestore; invitesOk/New: friends who accepted this
    // player's invite (any / new players), as last read from Firestore
    invitedBy: '', inviteFresh: false, invitePending: false, invitesOk: 0, invitesNew: 0,
    // device tricks: upside-down world (flip the phone on the title), microphone opt-in,
    // latest clock reading seen (a clock that goes back in time is not trusted)
    upside: false, mic: false, lastTime: 0, weekendSat: false, weekendSun: false,
  };
}

const TUNE_IDS = ['hull', 'magnet', 'shield'];
const DIARY_MAX = 900;
const DIARY_KEY = /^[abr]:[A-Za-z0-9_]{1,40}$/;
function migrate(obj, d) {
  if (!obj || typeof obj !== 'object') return d;
  const out = { ...d };
  // v0 (no version field) had only "best"; every later field falls back to defaults.
  if (Number.isFinite(obj.best) && obj.best >= 0) out.best = Math.floor(obj.best);
  if (typeof obj.sound === 'boolean') out.sound = obj.sound;
  if (typeof obj.shake === 'boolean') out.shake = obj.shake;
  if (typeof obj.music === 'boolean') out.music = obj.music;
  if (typeof obj.upside === 'boolean') out.upside = obj.upside;
  if (typeof obj.mic === 'boolean') out.mic = obj.mic;
  if (obj.weekendSat === true) out.weekendSat = true;
  if (obj.tutDone === true) out.tutDone = true;
  if (Number.isFinite(obj.weekPrize)) out.weekPrize = Math.floor(obj.weekPrize);
  if (obj.weekendSun === true) out.weekendSun = true;
  if (Number.isFinite(obj.lastTime) && obj.lastTime > 0) out.lastTime = obj.lastTime;
  // "sens" (tilt sensitivity) became the difficulty, which sets the sensitivity; everyone starts on NORMAL.
  if (obj.diff === 0 || obj.diff === 1 || obj.diff === 2) out.diff = obj.diff;
  // v1 had a "tilt" toggle; steering is sensor-only since v2, so it's dropped.
  if (obj.ach && typeof obj.ach === 'object') {
    for (const k of Object.keys(obj.ach)) if (obj.ach[k] === true) out.ach[k] = true;
  }
  if (obj.owned && typeof obj.owned === 'object') {
    for (const k of Object.keys(obj.owned)) if (obj.owned[k] === true) out.owned[k] = true;
  }
  if (typeof obj.dev === 'string' && DEV_RE.test(obj.dev)) out.dev = obj.dev;
  if (obj.ledger && typeof obj.ledger === 'object') {
    for (const [k, l] of Object.entries(obj.ledger)) {
      if (!DEV_RE.test(k) || !l || typeof l !== 'object') continue;
      const e = Number.isFinite(l.e) && l.e >= 0 ? Math.floor(l.e) : 0;
      const sp = Number.isFinite(l.s) && l.s >= 0 ? Math.floor(l.s) : 0;
      const g = Number.isFinite(l.g) && l.g >= 0 ? Math.floor(l.g) : 0;
      const gs = Number.isFinite(l.gs) && l.gs >= 0 ? Math.floor(l.gs) : 0;
      out.ledger[k] = { e, s: sp, g, gs };
    }
  }
  if (typeof obj.barrel === 'string') out.barrel = obj.barrel;
  if (typeof obj.rider === 'string') out.rider = obj.rider;
  for (const k of ['runs', 'totalM', 'grazes', 'badStreak', 'coins', 'coinsTotal', 'bubbles', 'tightTotal', 'repairs', 'lastM', 'dailyCount', 'miniCount', 'wkDone', 'shares', 'invitesOk', 'invitesNew']) {
    if (Number.isFinite(obj[k]) && obj[k] >= 0) out[k] = Math.floor(obj[k]);
  }
  if (obj.powers && typeof obj.powers === 'object') {
    for (const k of Object.keys(obj.powers)) if (obj.powers[k] === true) out.powers[k] = true;
  }
  if (obj.paid && typeof obj.paid === 'object') {
    // true: paid before the rewards were cut (worth the old amount); a number: the coins it paid
    for (const [k, v] of Object.entries(obj.paid)) if (v === true || (Number.isInteger(v) && v >= 0 && v <= 1000)) out.paid[k] = v;
  }
  const dy = obj.daily && typeof obj.daily === 'object' ? obj.daily : null;
  if (dy && typeof dy.key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dy.key)) {
    const slot = (x) => ({
      done: !!x && x.done === true,
      prog: x && Number.isFinite(x.prog) && x.prog >= 0 ? Math.floor(x.prog) : 0,
      t: x && typeof x.t === 'string' ? x.t.slice(0, 80) : '',
    });
    const slots = (arr, n) => Array.from({ length: n }, (_, i) => slot(Array.isArray(arr) ? arr[i] : null));
    const dow = new Date(`${dy.key}T12:00:00`).getDay();
    out.daily = { ...slot(dy), key: dy.key, mini: slots(dy.mini, 2), wk: slots(dy.wk, dow === 0 || dow === 6 ? 3 : 0), extra: slots(dy.extra, 3) };
  }
  if (Number.isInteger(obj.wkKey)) out.wkKey = obj.wkKey;
  for (const k of ['notify', 'notifAsked', 'inviteFresh', 'invitePending']) if (typeof obj[k] === 'boolean') out[k] = obj[k];
  if (typeof obj.invitedBy === 'string' && /^[A-Za-z0-9]{10,64}$/.test(obj.invitedBy)) out.invitedBy = obj.invitedBy;
  if (obj.shareApps && typeof obj.shareApps === 'object') {
    for (const k of Object.keys(obj.shareApps).slice(0, 60)) if (obj.shareApps[k] === true && k.length <= 80) out.shareApps[k] = true;
  }
  if (obj.pairs && typeof obj.pairs === 'object') {
    for (const k of Object.keys(obj.pairs).slice(0, 200)) if (obj.pairs[k] === true && k.length <= 40) out.pairs[k] = true;
  }
  out.diary = {};
  if (obj.diary && typeof obj.diary === 'object') {
    for (const [k, e] of Object.entries(obj.diary).slice(0, DIARY_MAX)) {
      if (!DIARY_KEY.test(k) || !Array.isArray(e) || e.length !== 7) continue;
      const [t, how, r, b, m, w, d] = e;
      if (!(Number.isFinite(t) && t > 0) || ![0, 1, 2, 3, 4].includes(how)) continue;
      if (typeof r !== 'string' || r.length > 40 || typeof b !== 'string' || b.length > 40 || typeof w !== 'string' || w.length > 12) continue;
      if (!Number.isInteger(m) || m < -1 || ![-1, 0, 1, 2].includes(d)) continue;
      out.diary[k] = [Math.floor(t), how, r, b, m, w, d];
    }
  }
  if (typeof obj.gemDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.gemDay)) out.gemDay = obj.gemDay;
  for (const k of ['gemGoogle', 'tuneOn', 'noAds']) if (typeof obj[k] === 'boolean') out[k] = obj[k];
  out.tune = { hull: 0, magnet: 0, shield: 0 };
  if (obj.tune && typeof obj.tune === 'object') for (const t of TUNE_IDS) if (Number.isInteger(obj.tune[t]) && obj.tune[t] >= 0) out.tune[t] = Math.min(obj.tune[t], 3);
  out.nfc = {};
  if (obj.nfc && typeof obj.nfc === 'object') for (const k of ['1', '2', '3', '4', '5', '6']) if (typeof obj.nfc[k] === 'string' && /^[0-9a-f]{16}$/.test(obj.nfc[k])) out.nfc[k] = obj.nfc[k];
  if (typeof obj.steps === 'boolean') out.steps = obj.steps;
  for (const k of ['stepLast', 'stepBoot', 'stepsTotal']) if (Number.isFinite(obj[k])) out[k] = Math.floor(obj[k]);
  out.codes = {};
  if (obj.codes && typeof obj.codes === 'object') for (const k of Object.keys(obj.codes).slice(0, 300)) if (obj.codes[k] === true && /^[A-Z0-9_-]{3,24}$/.test(k)) out.codes[k] = true;
  out.iap = {};
  if (obj.iap && typeof obj.iap === 'object') for (const k of Object.keys(obj.iap).slice(0, 500)) if (obj.iap[k] === true && k.length <= 120) out.iap[k] = true;
  const rk = obj.rank && typeof obj.rank === 'object' ? obj.rank : null;
  if (rk) {
    if (typeof rk.name === 'string') out.rank.name = rk.name.slice(0, 12);
    for (const k of ['best', 'total', 'easy', 'normal', 'hard', 'runs', 'pos', 'week', 'wbest', 'pweek', 'pwbest']) {
      if (Number.isFinite(rk[k]) && rk[k] >= 0) out.rank[k] = Math.floor(rk[k]);
    }
    out.rank.dirty = rk.dirty === true;
  } else {
    // saves from before the ranking: every old run counts as NORMAL (weight 1)
    out.rank.best = out.rank.normal = out.best;
    out.rank.total = Math.max(out.totalM, out.best);
    out.rank.runs = out.runs;
    out.rank.dirty = out.best > 0;
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

let cloudDirty = false; // the local save changed since the last cloud backup
function writeSave(data) {
  cloudDirty = true;
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable: the game keeps working, the record just isn't kept */
  }
}

// ===== input =====
// Input layer (input-systems skill): gameplay reads one "steer" action in [-1, 1].
// Sources: phone tilt (the only control on phones), arrow keys (?pc test mode) and
// screen halves (FÁCIL mode, and the ?tap=true test mode).

const DEG = Math.PI / 180;
const DEAD = 0.07; // radial deadzone on the normalized tilt
const CURVE = 1.35; // response curve: finer control near the centre
// Lateral gravity fraction (sin of the roll angle) that counts as full steer, per sensitivity.
const SENS_FULL = [0.5, 0.36, 0.25];
// Browsers only deliver motion sensor events to secure (HTTPS) pages.
const tiltAvailable = window.isSecureContext === true && 'DeviceOrientationEvent' in window;

class Input {
  // tapTarget: element whose left/right halves steer when pressed, while tapOn (FÁCIL / ?tap).
  constructor(tapTarget) {
    this.tapOn = false;
    this.raw = 0; // lateral gravity component in device x, -1..1
    this.neutral = 0;
    this.hasSensor = false;
    this.cal = null; // calibration in progress: { from, settle, samples: [[t, x]] }
    this.filtered = 0;
    this.sens = 1;
    this.keyL = false;
    this.keyR = false;

    this.pointers = new Map(); // pointerId -> -1 | 1, insertion order = press order

    window.addEventListener('deviceorientation', (e) => this.onOrient(e));
    if (tapTarget) {
      const side = (e) => (e.clientX < window.innerWidth / 2 ? -1 : 1);
      tapTarget.addEventListener('pointerdown', (e) => {
        if (!this.tapOn) return;
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

  // Touch steering replaces the tilt (FÁCIL): holding the phone at any angle is fine.
  setTap(on) {
    this.tapOn = on;
    this.pointers.clear();
  }

  onKey(e, down) {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.keyL = down;
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') this.keyR = down;
  }

  onOrient(e) {
    if (e.beta == null || e.gamma == null) return;
    this.beta = e.beta;
    // Device-frame gravity from the Z-X'-Y'' Euler angles: x = cos(beta) * sin(gamma).
    // Unlike raw gamma this stays smooth when the phone is held close to upright.
    let x = Math.cos(e.beta * DEG) * Math.sin(e.gamma * DEG);
    const angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    if (angle === 180) x = -x; // upside-down portrait
    this.raw = x;
    this.hasSensor = true;
    const c = this.cal;
    if (c) {
      const now = performance.now();
      c.samples.push([now, x]);
      if (now - c.samples[0][0] >= c.settle && c.samples.length >= 3) {
        // the average of the last quarter second, once the grip has settled
        const last = c.samples.filter(([t]) => t >= now - 250);
        this.neutral = clamp(last.reduce((a, [, v]) => a + v, 0) / last.length, -0.35, 0.35);
        this.cal = null;
      }
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

  // Whatever angle the player holds the phone at when the run starts becomes "straight". Only
  // readings that arrive from now on count: while an ad (or another app) covered the game the
  // sensor stopped, and its last reading is from whatever angle the phone had back then.
  // settle: ms of fresh readings to wait for (longer after an ad, while the grip settles).
  calibrate(settle = 450) {
    this.cal = { settle, samples: [] };
    this.filtered = 0;
  }

  getSteer(dt) {
    let target = 0;
    let tap = 0;
    for (const d of this.pointers.values()) tap = d; // newest press wins
    if (tap !== 0) target = tap;
    else if (this.keyL !== this.keyR) target = this.keyL ? -1 : 1;
    else if (this.hasSensor && !this.cal && !this.tapOn) {
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

// Lightning: a sharp crack, then a long low rumble.
function thunder() {
  if (!ac || !enabled) return;
  const t = ac.currentTime;
  const n = noiseSource();
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(4000, t);
  lp.frequency.exponentialRampToValueAtTime(90, t + 1.4);
  const ng = ac.createGain();
  env(ng, t, 0.8, 1.6);
  n.connect(lp).connect(ng).connect(master);
  n.start(t);
  n.stop(t + 1.7);
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
    setEnabled, unlock, suspend, resume, startWater, setWater, stopWater, crash, thunder, splash, blip, tick, cheer, stopCheer,
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

// Offscreen canvases stay in CPU memory (willReadFrequently). On Android WebView the 180 px game
// canvas is a software canvas, so GPU-backed sprites forced a GPU readback on every drawImage
// (~25 ms per frame on a Galaxy A54: the game ran at 40 fps with 1.5 ms of JS).
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d', { willReadFrequently: true });
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

// Steel plates with rivets (exclusive: INTOCÁVEL).
function makeArmor() {
  return drum(8, 1, '#1e232b', '#c3cad4', '#868d99', '#555b66', (i, j, rel, span, x0, x1) => {
    if (i === x0 || i === x1 || j === 0 || j === BARREL_H - 1) return undefined;
    if (j === 1) return '#9aa2b3';
    if (j === 5 || j === 18) return rel % 3 === 1 ? '#f4f6f8' : '#3e434c';
    if (j === 6 || j === 19) return '#2b3038';
    if (rel === Math.round(span / 2) && j > 6 && j < 18) return '#3e434c';
    if (rel === Math.round(span / 2) + 1 && j > 6 && j < 18) return '#dde3ea';
    return undefined;
  });
}

// Obsidian with glowing lava veins (exclusive: LENDA DA CACHOEIRA, 1000 m on DIFÍCIL).
function makeLava() {
  const wob = [0, 1, 1, 2, 1, 0];
  return drum(8, 1, '#0d0606', '#4a3a3a', '#2e2424', '#1c1414', (i, j, rel, span, x0, x1) => {
    if (i === x0 || i === x1 || j === 0 || j === BARREL_H - 1) return undefined;
    if (j === 1) return '#ff3b1f';
    const v1 = 6 + wob[j % 6];
    const v2 = 13 - wob[(j + 3) % 6];
    if (i === v1 || (i === v2 && j > 8)) return (i + j) % 5 === 0 ? '#ffd23f' : '#ff8a1c';
    if (j === 12 && i > v1 && i < v2) return i % 3 === 0 ? '#ffd23f' : '#ff3b1f';
    return undefined;
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

// ---- vehicles that are not barrels at all ----
// Red phone box (the blue one is for time travel).
function makePhoneBox() {
  const O = '#3a0505';
  return paint(BARREL_W, BARREL_H, (i, j) => {
    if (j === 0) return i >= 4 && i <= 15 ? O : null;
    if (j === 1) return i >= 3 && i <= 16 ? (i === 3 || i === 16 ? O : '#c41e1e') : null;
    if (j === 2) return i >= 1 && i <= 18 ? (i === 1 || i === 18 ? O : '#a51515') : null;
    if (i < 2 || i > 17) return null;
    if (i === 2 || i === 17 || j === 23) return O;
    if ((j === 3 || j === 4) && i >= 4 && i <= 15) return j === 3 && i % 2 === 0 ? '#ffffff' : '#1a1a1a';
    if (j >= 6 && j <= 19 && i >= 4 && i <= 15) {
      if (i === 4 || i === 9 || i === 10 || i === 15 || j === 6 || j === 10 || j === 14 || j === 19) return '#a51515';
      if (i === 5 || i === 11 || j === 7 || j === 11 || j === 15) return '#e6f5ff';
      return '#8fc3ee';
    }
    if (i === 16 && j === 13) return '#ffd23f';
    if (i === 3) return '#ff5252';
    if (i === 16) return '#a51515';
    return '#d62828';
  });
}

// Brazilian street payphone shell ("orelhão") on its pole.
function makeOrelhao() {
  return paint(BARREL_W, BARREL_H, (i, j) => {
    if (j >= 20) return i === 9 || i === 10 ? (i === 9 ? '#9aa3ae' : '#5d6670') : null;
    const dx = (i + 0.5 - 10) / 9.6;
    const dy = (j + 0.5 - 10.5) / 10.6;
    const d = dx * dx + dy * dy;
    if (d > 1) return null;
    if (d > 0.8) return '#3a1a02';
    const ix = (i + 0.5 - 10) / 6;
    const iy = (j + 0.5 - 12.5) / 7;
    if (ix * ix + iy * iy < 1) {
      if (i >= 9 && i <= 11 && j >= 9 && j <= 14) {
        if (j === 9) return '#1a1a1a';
        return (i + j) % 2 ? '#c3cad4' : '#5d6670';
      }
      return '#7a3a06';
    }
    return dx < -0.3 && dy < 0 ? '#ffb35c' : dx > 0.45 ? '#c45f0a' : '#ff8a1c';
  });
}

// Cardboard box with open flaps: the secret agent's favourite hiding spot.
function makeCardboard() {
  const O = '#5a3a10';
  return paint(BARREL_W, BARREL_H, (i, j) => {
    if (j <= 2) {
      if (i >= 1 && i <= 8 && j >= 1) return j === 1 ? O : '#d9b070';
      if (i >= 11 && i <= 18) return j === 0 ? O : '#b8894a';
      return null;
    }
    if (i < 1 || i > 18) return null;
    if (i === 1 || i === 18 || j === 3 || j === 23) return O;
    if (i === 9 || i === 10) return '#e8d2a0';
    if (j >= 12 && j <= 14 && i >= 3 && i <= 7) return j === 13 && i % 2 === 0 ? '#ffffff' : '#d62828';
    if (i >= 15) return '#a87c40';
    return '#c69a5a';
  });
}

// Toilet: tank at the back, bowl in front, narrow base.
function makeToilet() {
  const O = '#4a5260';
  return paint(BARREL_W, BARREL_H, (i, j) => {
    if (j <= 7) {
      if (i < 3 || i > 16) return null;
      if (i === 3 || i === 16 || j === 0) return O;
      if (j === 2 && (i === 13 || i === 14)) return '#9aa3ae';
      return i >= 14 ? '#c9d1db' : j === 1 ? '#ffffff' : '#f4f6f8';
    }
    if (j <= 17) {
      const dx = (i + 0.5 - 10) / 9.5;
      const dy = (j + 0.5 - 12.5) / 5.2;
      const d = dx * dx + dy * dy;
      if (d > 1) return null;
      if (d > 0.82) return O;
      if (j === 8 || j === 9) return '#e6ebf0';
      return dx > 0.5 ? '#c9d1db' : '#f4f6f8';
    }
    if (i < 6 || i > 13) return null;
    if (i === 6 || i === 13 || j === 23) return O;
    return i >= 12 ? '#c9d1db' : '#f4f6f8';
  });
}

// Beach cooler: white styrofoam body, blue lid.

// ---- barrels from device tricks, holidays and the new shop items ----
const isEdge = (i, j, x0, x1) => i === x0 || i === x1 || j === 0 || j === BARREL_H - 1;

// Blender (shake the phone): glass jar with a pink smoothie on a motor base.
function makeBlender() {
  const hw = (j) => (j <= 1 ? 7 : j <= 17 ? 9 - Math.floor((j - 2) / 6) : 8);
  return drum(hw, 0, '#22262c', '#e6f2ff', '#bfe3ff', '#8fb8d8', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#3a4152';
    if (j >= 18) {
      if (j === 18) return '#22262c';
      if (j === 21 && (i === 7 || i === 10 || i === 13)) return ['#3ddc5a', '#ffd23f', '#ff3b3b'][(i - 7) / 3];
      return rel >= span - 2 ? '#3a4152' : '#5d6670';
    }
    if (j >= 9) return (i + j * 2) % 7 === 0 ? '#ffb3c6' : rel >= span - 2 ? '#b02a5a' : '#e0457b';
    if (rel === 2 && j > 2) return '#ffffff';
    return undefined;
  });
}

// 14-BARRIL (offline): beige canvas on a bamboo frame, tiny flag.
function makeDumont() {
  return drum(8, 1, '#4a3a1a', '#fff6e0', '#eadcbc', '#c8b890', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1 || j === 7 || j === 16) return '#8a6a3a';
    if (j >= 10 && j <= 13 && rel >= 6 && rel <= 9) return j === 10 || j === 13 ? '#1f9a46' : rel === 7 || rel === 8 ? '#3d8fe0' : '#ffd23f';
    if (rel % 5 === 0) return '#a07a40';
    return undefined;
  });
}

// Charcoal (blew the fire out): burnt wood with embers.
function makeCharcoal() {
  return drum(7, 3, '#050505', '#3a3a3a', '#262626', '#161616', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#1a1a1a';
    if (j === 4 || j === 5 || j === 18 || j === 19) return '#4a4a4a';
    const h = (i * 7 + j * 13) % 23;
    if (h === 0) return '#ff6a1c';
    if (h === 1) return '#ffd23f';
    if (rel % 3 === 0) return '#0e0e0e';
    return undefined;
  });
}

function makeChampagne() {
  const hw = (j) => (j <= 5 ? 3 : j <= 8 ? 3 + (j - 5) * 2 : 9);
  return drum(hw, 0, '#0e2a16', '#3a8a4a', '#2a6a3a', '#1a4a2a', (i, j, rel, span, x0, x1) => {
    if (j <= 5) return i === x0 || i === x1 || j === 0 ? '#8a6a00' : j === 1 ? '#fff3a0' : '#ffd23f';
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j >= 11 && j <= 17 && rel >= 2 && rel <= span - 2) return j === 11 || j === 17 ? '#ffd23f' : j === 14 && rel % 2 ? '#8a6a00' : '#fff6e0';
    if (rel === 2 && j > 8) return '#7ad08a';
    return undefined;
  });
}

function makeConfetti() {
  const cs = ['#ff4d6d', '#ffd23f', '#3ddc5a', '#3d8fe0', '#ff9f1c', '#ffffff'];
  return drum(7, 3, '#2a0a3a', '#b06ad8', '#8a3ab8', '#5a1a8a', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1 || j === 4 || j === 19) return '#ffd23f';
    if ((i * 11 + j * 7) % 9 === 0) return cs[(i + j) % cs.length];
    return undefined;
  });
}

function makeEgg() {
  const HW = [4, 5, 6, 7, 8, 8, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 8, 8, 7, 6, 5, 4];
  return drum((j) => HW[j], 0, '#5a1a3a', '#ffc0d8', '#ff8ab0', '#d0507a', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 8 || j === 9) return (rel + j) % 2 === 0 ? '#ffd23f' : '#fff3a0';
    if (j === 15 || j === 16) return (rel + j) % 2 === 0 ? '#3d8fe0' : '#bfe3ff';
    if ((i * 5 + j * 3) % 13 === 0) return '#ffffff';
    return undefined;
  });
}

const HEART = ['.xx.xx.', 'xxxxxxx', 'xxxxxxx', '.xxxxx.', '..xxx..', '...x...'];
function makeBonbon() {
  return drum(() => 9, 0, '#3a0a10', '#e8342a', '#c01818', '#8a0a10', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j <= 3) return j === 3 ? '#5a0a10' : '#ff5a5a';
    const hx = i - 6;
    const hy = j - 10;
    if (hy >= 0 && hy < HEART.length && hx >= 0 && hx < 7 && HEART[hy][hx] === 'x') return hy === 1 && hx === 1 ? '#ffffff' : '#ffb3c6';
    if (i === 9 || i === 10 || j === 7) return '#ffd23f';
    return undefined;
  });
}

function makeCorn() {
  const HW = [3, 4, 5, 6, 6, 7, 7, 7, 7, 8, 8, 8, 8, 8, 8, 8, 8, 7, 7, 7, 6, 6, 5, 4];
  return drum((j) => HW[j], 0, '#6a4a00', '#fff3a0', '#ffd23f', '#d9a514', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j >= 12 && (rel <= (j - 12) / 2 || rel >= span - (j - 12) / 2)) return rel < span / 2 ? '#5aa83a' : '#3a7a2a';
    if (j % 2 === 0 && rel % 2 === 0) return '#c99a1a';
    return undefined;
  });
}

function makeGrito() {
  return drum(8, 1, '#0a3a1a', '#3ddc5a', '#1f9a46', '#147a36', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    const dx = Math.abs(i - 9.5);
    const dy = Math.abs(j - 12);
    if (dx * dx + dy * dy <= 10) return j === 12 ? '#ffffff' : '#2a4ab0';
    if (dx / 7.5 + dy / 8 <= 1) return '#ffd23f';
    return undefined;
  });
}

const LETTERS = {
  A: ['.x.', 'x.x', 'xxx', 'x.x', 'x.x'],
  B: ['xx.', 'x.x', 'xx.', 'x.x', 'xx.'],
  C: ['.xx', 'x..', 'x..', 'x..', '.xx'],
};
function makeToybox() {
  const cs = ['#e8342a', '#3d8fe0', '#3ddc5a'];
  return drum(() => 9, 0, '#3a2210', '#e8b070', '#cf9a5c', '#a0703a', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1 || j === 2) return '#e8342a';
    if (j >= 9 && j <= 15 && i >= 2 && i <= 16) {
      const b = Math.floor((i - 2) / 5);
      const lx = (i - 2) % 5;
      if (lx === 0 || lx === 4 || j === 9 || j === 15) return '#3a2210';
      const L = LETTERS['ABC'[b]];
      return L[j - 10][lx - 1] === 'x' ? '#ffffff' : cs[b];
    }
    if (j === 20) return '#a0703a';
    return undefined;
  });
}

function makePumpkin() {
  const HW = [1, 1, 6, 8, 9, 9, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 9, 9, 8, 7, 6, 4];
  return drum((j) => HW[j], 0, '#5a2a00', '#ffb04a', '#ff8a1c', '#c96a0a', (i, j, rel, span, x0, x1) => {
    if (j <= 1) return '#3a7a2a';
    if (i === x0 || i === x1 || j === 2 || j === BARREL_H - 1) return '#5a2a00';
    if (j >= 8 && j <= 10 && ((Math.abs(i - 6) <= j - 8) || (Math.abs(i - 13) <= j - 8))) return '#ffd23f';
    if (j === 15 && i >= 5 && i <= 14) return '#ffd23f';
    if ((j === 16 && i >= 6 && i <= 13 && i % 2 === 0) || (j === 14 && i >= 6 && i <= 13 && i % 2 === 1)) return '#ffd23f';
    if (rel % 4 === 0) return '#c96a0a';
    return undefined;
  });
}

function makeGift() {
  return drum((j) => (j <= 4 ? 9 : 8), 0, '#0a3a1a', '#3ddc5a', '#1f9a46', '#147a36', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1) || j === 5) return '#0a3a1a';
    if (i === 9 || i === 10 || j === 2 || j === 14) return '#e8342a';
    if ((i + j) % 6 === 0) return '#ffffff';
    return undefined;
  });
}

// Stacked toy bricks with studs on top.
function makeBricks() {
  const cs = [['#e8342a', '#a01a1a', '#ff7a6a'], ['#3d8fe0', '#1f5fae', '#8fc3ff'], ['#ffd23f', '#c99a1a', '#fff3a0'], ['#3ddc5a', '#1f9a46', '#9df0a8']];
  return paint(BARREL_W, BARREL_H, (i, j) => {
    if (i < 1 || i > 18) return null;
    if (j === 0) return i % 4 === 1 || i % 4 === 2 ? '#ff7a6a' : null;
    const row = Math.floor((j - 1) / 4);
    const off = row % 2 ? 4 : 0;
    const col = Math.floor((i - 1 + off) / 8);
    const [base, dark, light] = cs[(row + col * 3) % 4];
    const ly = (j - 1) % 4;
    const lx = (i - 1 + off) % 8;
    if (i === 1 || i === 18 || ly === 3 || lx === 7) return dark;
    return ly === 0 ? light : base;
  });
}

// Developer's mug: coffee, handle and a "</>" print.
const CODE_ROWS = ['..x...x.x..', '.x....x..x.', 'x....x....x', '.x..x....x.', '..x.x...x..'];
function makeMug() {
  return paint(BARREL_W, BARREL_H, (i, j) => {
    if (i >= 15 && i <= 19 && j >= 7 && j <= 16) {
      if (i <= 16 && j > 7 && j < 16) return i === 15 ? '#22262c' : null;
      if (i === 19 || j === 7 || j === 16 || (i === 17 && j > 8 && j < 15)) return '#22262c';
      if (j > 8 && j < 15) return null;
      return '#e6e6dc';
    }
    if (i < 1 || i > 15) return null;
    if (i === 1 || i === 15 || j === 0 || j === BARREL_H - 1) return '#22262c';
    if (j === 1) return '#a0703a';
    if (j === 2) return '#5a3416';
    const cx = i - 3;
    if (j >= 10 && j <= 14 && cx >= 0 && cx < 11 && CODE_ROWS[j - 10][cx] === 'x') return '#3d8fe0';
    return i >= 12 ? '#d8d8cc' : '#f2f2ec';
  });
}

// Pocket guide to the galaxy: red gadget with "42" on its screen and big friendly buttons.
const GUIDE_42 = ['x.x.xxx', 'x.x...x', 'xxx.xxx', '..x.x..', '..x.xxx'];
function makeGuide() {
  return paint(BARREL_W, BARREL_H, (i, j) => {
    if (i < 2 || i > 17) return null;
    const corner = (i === 2 || i === 17) && (j === 0 || j === BARREL_H - 1);
    if (corner) return null;
    if (i === 2 || i === 17 || j === 0 || j === BARREL_H - 1) return '#3a0a0a';
    if (j === 1) return '#ff6a5a';
    if (i >= 4 && i <= 15 && j >= 4 && j <= 12) {
      if (i === 4 || i === 15 || j === 4 || j === 12) return '#1a1a1a';
      const gx = i - 6;
      const gy = j - 6;
      if (gx >= 0 && gx < 7 && gy >= 0 && gy < 5 && GUIDE_42[gy][gx] === 'x') return '#7dff6a';
      return '#14301a';
    }
    if (j >= 15 && j <= 16 && (i === 5 || i === 9 || i === 13)) return '#ffd23f';
    if (j >= 15 && j <= 16 && (i === 6 || i === 10 || i === 14)) return '#c99a1a';
    if (j === 19 && i >= 5 && i <= 14) return '#7a1a1a';
    return i >= 15 ? '#9a1e1e' : i <= 3 ? '#e8524a' : '#c42a2a';
  });
}

// Half barrel, half machine: the wood was torn off the right side, chrome and a red light below.
function makeCyborgBarrel() {
  const tear = [9, 10, 10, 9, 8, 9, 10, 11, 10, 9, 9, 10, 11, 11, 10, 9, 8, 9, 10, 10, 9, 10, 11, 10];
  const wood = makeBarrel(WOOD).getContext('2d').getImageData(0, 0, BARREL_W, BARREL_H).data;
  return drum((j) => bulge(j, 7, 3), 0, '#1e232b', '#f4f6f8', '#aab2bd', '#5d6670', (i, j, rel, span, x0, x1) => {
    const t = tear[j];
    if (i < t) {
      const k = (j * BARREL_W + i) * 4;
      return wood[k + 3] ? `#${((1 << 24) | (wood[k] << 16) | (wood[k + 1] << 8) | wood[k + 2]).toString(16).slice(1)}` : null;
    }
    if (i === t) return '#3a2410'; // splintered edge
    if (i === x1 || j === 0 || j === BARREL_H - 1) return undefined;
    if (j === 5 || j === 18) return '#3e434c'; // steel ribs where the hoops were
    if ((j === 9 || j === 15) && i % 2 === 0) return '#2b3038';
    if (i >= 13 && i <= 14 && j >= 11 && j <= 12) return i === 13 && j === 11 ? '#ffb0b0' : '#ff2a2a';
    if ((i === 12 || i === 15) && j >= 11 && j <= 12) return '#7a0a0a';
    return undefined;
  });
}

// Green warp-style pipe: a wide lip on top, a narrower tube below, lit from the left.
function makePipe() {
  return paint(BARREL_W, BARREL_H, (i, j) => {
    const lip = j <= 6;
    const x0 = lip ? 0 : 2;
    const x1 = lip ? BARREL_W - 1 : BARREL_W - 3;
    if (i < x0 || i > x1) return null;
    if (i === x0 || i === x1 || j === 0 || j === 6 || j === BARREL_H - 1) return '#0a2a0a';
    if (j === 1) return '#0f3d14'; // the dark mouth of the pipe
    const rel = i - x0;
    const span = x1 - x0;
    if (rel === 2 || rel === 3) return '#d8ffd0';
    if (rel === 5) return '#9af58e';
    if (rel >= span - 2) return '#13601f';
    if (rel >= span - 5) return '#22903a';
    return '#3fc24f';
  });
}

// ---- historical figures ----
// Starry night: deep blue, swirling wind, a crescent moon, glowing stars and a dark cypress.
function makeStarry() {
  const STARS = [[12, 6], [6, 9], [15, 14], [9, 16], [4, 13]];
  return drum(8, 1, '#0a1430', '#3d6fd0', '#2a52a8', '#1a3a7a', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#14224a';
    if ((i === 15 || i === 16) && (j === 3 || j === 4)) return '#ffe14d'; // moon
    if (i === 14 && j === 3) return '#ffe14d';
    for (const [x, y] of STARS) {
      if (x === i && y === j) return '#fff6b8';
      if (Math.abs(x - i) + Math.abs(y - j) === 1) return '#ffd23f';
    }
    if (rel <= 3 && j >= 8 && j <= 22 && rel >= Math.round((22 - j) / 6)) return rel === 3 ? '#2a5a2a' : '#163a1a'; // cypress
    const sw = 11 + 2 * Math.sin(i * 0.9);
    if (Math.abs(j - sw) < 0.6) return '#9fc4ff';
    if (Math.abs(j - sw - 7) < 0.6 && i > 6) return '#7fa8f0';
    return undefined;
  });
}

// Cubist patchwork: tilted blocks in loud colours with black seams, and one eye looking at you.
function makeCubist() {
  const COLS = ['#e04a3a', '#f2c94c', '#3d6fd0', '#2a9a6a', '#e8dcc0', '#c97a3a'];
  const cell = (i, j) => {
    const a = Math.floor((i + j * 0.5) / 5);
    const b = Math.floor((j - i * 0.4 + 8) / 6);
    return (a * 7 + b * 3) % COLS.length;
  };
  return drum(8, 1, '#1a1a1a', '#000', '#000', '#000', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#3a2a1a';
    if (i === 10 && j === 11) return '#1a1a1a';
    if ((i === 9 || i === 11) && j === 11) return '#ffffff';
    const k = cell(i, j);
    if (cell(i + 1, j) !== k || cell(i, j + 1) !== k) return '#1a1a1a';
    return COLS[k];
  });
}

// Grand piano lacquer with a keyboard across the belly.
function makePiano() {
  return drum(8, 1, '#000000', '#4a4a4a', '#1a1a1a', '#0a0a0a', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#2a2a2a';
    if (j >= 14 && j <= 19) {
      if (j <= 16 && i % 3 === 0 && i % 21 !== 0 && i !== 9) return '#111111'; // black keys
      if (i % 3 === 1 && j > 16) return '#9a9a9a';
      return j === 19 ? '#c8c8c8' : '#f4f4f4';
    }
    if (j === 8 && (i === 9 || i === 10)) return '#d9a514';
    if (rel === 3 && j > 2 && j < 13) return '#7a7a7a';
    return undefined;
  });
}

// The most famous smile, in a gilded frame on a walnut barrel.
function makeMonaLisa() {
  return drum(8, 1, '#2a1608', '#a66a31', '#8a5226', '#5e3618', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#5a3416';
    if (j < 4 || j > 20 || rel < 2 || rel > span - 2) return undefined;
    if (j === 4 || j === 20 || rel === 2 || rel === span - 2) return (i + j) % 2 ? '#ffd23f' : '#d9a514';
    const dx = i - 9.5;
    const face = (dx * dx) / 5 + ((j - 10.5) * (j - 10.5)) / 8;
    const hair = (dx * dx) / 11 + ((j - 11) * (j - 11)) / 16;
    if (face <= 1) {
      if (j === 12 && (i === 9 || i === 10)) return '#8a4a2a'; // the smile. Or not.
      if (j === 10 && (i === 8 || i === 11)) return '#3a2410';
      return '#d8b070';
    }
    if (j >= 15) return Math.abs(dx) < 4 ? (j === 15 && Math.abs(dx) < 1.5 ? '#c89860' : '#2a2214') : '#4a5a3a';
    if (hair <= 1) return '#2a1a10';
    return j < 9 ? '#8a9a6a' : '#5a6a42';
  });
}

// ---- rescue and professions ----
// Civil defence inflatable: orange hull, grey tubes, a rope around and the blue triangle.
function makeRaft() {
  return drum(8, 2, '#3a1400', '#ffa040', '#ff7a00', '#c85400', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#2a2a2a';
    if (j >= 3 && j <= 5) return j === 3 ? '#8a9098' : j === 4 ? '#5a6068' : '#3a3f46';
    if (j >= 19 && j <= 21) return j === 19 ? '#8a9098' : j === 20 ? '#5a6068' : '#3a3f46';
    if (j === 8 && rel % 3 === 0) return '#ffffff';
    if (j === 7 || j === 9) return rel % 3 === 1 || rel % 3 === 2 ? undefined : '#ffffff';
    const dy = j - 11;
    if (dy >= 0 && dy <= 5 && Math.abs(i - 9.5) <= dy * 0.8 + 0.5) return dy === 5 || Math.abs(i - 9.5) > dy * 0.8 - 0.6 ? '#1f3a8a' : '#ffffff';
    return undefined;
  });
}

// 3x5 pixel digits for painted numbers.
const DIGITS = {
  0: ['###', '#.#', '#.#', '#.#', '###'],
  1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['###', '..#', '###', '#..', '###'],
  3: ['###', '..#', '.##', '..#', '###'],
  4: ['#.#', '#.#', '###', '..#', '..#'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  '=': ['...', '###', '...', '###', '...'],
  9: ['###', '#.#', '###', '..#', '###'],
};

// Camp barrel (ELE SEMPRE VOLTA): weathered dark planks, moss, and a 13 painted in red.
function makeCampBarrel() {
  return drum(8, 1, '#0f0a05', '#5a4a32', '#463a26', '#2a2216', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#2a2216';
    if (j === 4 || j === 19) return '#3a3f46';
    if (digitAt('13', 6, 9, i, j)) return '#b01010';
    if (j === 14 && (i === 7 || i === 11)) return '#7a0a0a'; // drips
    if (j >= 20 && (i * 5 + j * 3) % 7 === 0) return '#3a5a2a';
    if (rel % 3 === 0) return '#2a2216';
    return undefined;
  });
}
const digitAt = (txt, x0, y0, i, j) => {
  const k = Math.floor((i - x0) / 4);
  const col = (i - x0) % 4;
  if (i < x0 || j < y0 || j > y0 + 4 || k >= txt.length || col === 3) return false;
  return DIGITS[txt[k]][j - y0][col] === '#';
};

// Police car: black top, white doors, light bar on the rim and the emergency number.
function makePolice() {
  return drum(8, 1, '#0a0a0a', '#ffffff', '#e6ebf0', '#b8c0cc', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return rel < span / 2 ? '#ff2a2a' : '#2a6aff';
    if (j === 2) return '#1a1a1a';
    if (j <= 9) return shade3(rel, span, '#4a4a4a', '#2a2a2a', '#151515');
    if (j === 11 || j === 12) return '#1f3a8a';
    if (digitAt('190', 4, 15, i, j)) return '#1a1a1a';
    return undefined;
  });
}

// Fire hydrant: domed yellow cap, two side outlets, bolted base.
function makeHydrant() {
  const HW = [3, 4, 5, 6, 6, 6, 6, 6, 6, 9, 9, 9, 9, 6, 6, 6, 6, 6, 6, 6, 6, 8, 8, 8];
  return drum((j) => HW[j], 0, '#3a0a0a', '#ff5a4a', '#d62020', '#8a1010', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j <= 2) return j === 1 && rel <= 2 ? '#fff3a0' : '#ffd23f';
    if (j === 3 || j === 20) return '#8a1010';
    if (j >= 9 && j <= 12 && (rel <= 2 || rel >= span - 2)) return rel === 0 || rel === span ? '#3a0a0a' : j === 10 || j === 11 ? '#ffd23f' : '#b81818';
    if (j === 22 && rel % 4 === 1) return '#ffd23f';
    return undefined;
  });
}

// Ambulance: white with orange bands, siren on the rim and a blue star of life.
function makeAmbulance() {
  return drum(8, 1, '#3a3a4a', '#ffffff', '#eef2f6', '#c8d0dc', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return rel % 4 < 2 ? '#ff2a2a' : '#ffffff';
    if (j === 5 || j === 6 || j === 18 || j === 19) return '#ff6a00';
    const dx = i - 9.5;
    const dy = j - 12;
    const star = Math.abs(dx) <= 4 && Math.abs(dy) <= 4 && (Math.abs(dx) < 1 || Math.abs(dy - 0.6 * dx) < 0.9 || Math.abs(dy + 0.6 * dx) < 0.9);
    if (star) return '#2a6aff';
    return undefined;
  });
}

// Arcade cabinet: marquee, a screen with an invader, a joystick and two buttons.
function makeArcade() {
  const INV = ['.#...#.', '..###..', '.#####.', '##.#.##', '#######', '#.#.#.#'];
  return drum(9, 0, '#05050f', '#6a3ad0', '#4a24a8', '#2a0a6a', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j <= 3) return (i + j) % 3 === 0 ? '#fff3a0' : '#ffd23f';
    if (j >= 5 && j <= 13 && rel >= 3 && rel <= span - 3) {
      const row = INV[j - 7];
      if (row && i - 6 >= 0 && row[i - 6] === '#') return '#3df27a';
      return j === 13 ? '#0a3a3a' : '#0a1a2a';
    }
    if (j >= 15 && j <= 17) {
      if (i === 6 && j <= 16) return j === 15 ? '#ff3b3b' : '#3a3a3a';
      if (j === 16 && (i === 12 || i === 14)) return i === 12 ? '#ff3b3b' : '#3d8fe0';
      return '#1a1a2a';
    }
    if ((j === 20 || j === 21) && (i === 9 || i === 10)) return '#ffd23f';
    return undefined;
  });
}

// Delivery backpack: a red thermal box with a zipper and a reflective band.
function makeDeliveryBag() {
  return drum(9, 0, '#3a0a0a', '#ff4a3a', '#e02a2a', '#a01a1a', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j <= 2) return '#b81a1a';
    if (j === 3) return rel % 2 ? '#d8d8d8' : '#6a6a6a';
    if (j === 18 || j === 19) return j === 18 ? '#f4f8f8' : '#b8c4c8';
    if (j >= 8 && j <= 14 && rel >= 5 && rel <= span - 5) {
      if (j === 8 || j === 14 || rel === 5 || rel === span - 5) return '#ffffff';
      if (j === 10) return '#ffffff';
      return undefined;
    }
    return undefined;
  });
}

// ---- TV ----
// Prize chest: wooden chest, gold straps and lock, coins spilling over the lid.
function makePrizeChest() {
  return drum(9, 0, '#2a1608', '#b8783a', '#9a5e2a', '#6a3e18', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j <= 2) return (i * 3 + j) % 4 === 0 ? '#fff3a0' : '#ffd23f';
    if (j === 3 || j === 20) return '#d9a514';
    if (j === 8) return '#3a2210';
    if (rel === 3 || rel === span - 3) return '#d9a514';
    if (j >= 9 && j <= 12 && (i === 9 || i === 10)) return j === 10 || j === 11 ? '#1a1a1a' : '#ffd23f';
    if (j >= 9 && j <= 12 && (i === 8 || i === 11)) return '#ffd23f';
    return undefined;
  });
}

// Coffin: wide shoulders tapering to the feet, dark wood with silver handles.
function makeCoffin() {
  const HW = [4, 5, 6, 7, 8, 9, 9, 9, 9, 9, 8, 8, 8, 8, 7, 7, 7, 7, 7, 6, 6, 6, 6, 6];
  return drum((j) => HW[j], 0, '#0a0505', '#6a3a2a', '#4a2a1a', '#2a1610', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#3a1a10';
    if ((j === 7 || j === 15) && (rel <= 1 || rel >= span - 1)) return '#c3cad4';
    if (i >= 9 && i <= 10 && j >= 6 && j <= 14) return '#9aa3ae';
    if (j === 9 && i >= 7 && i <= 12) return '#9aa3ae';
    if (rel === 2 && j > 2) return '#8a5a3a';
    return undefined;
  });
}

// ---- explorers, inventors and teachers ----
// Lost temple: mossy stone blocks around a little golden idol.
function makeTemple() {
  return drum(8, 1, '#1a1a14', '#a8a08a', '#8a826c', '#5a5442', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#5a5442';
    if (i >= 9 && i <= 10 && j >= 10 && j <= 15) return j === 10 ? '#fff3a0' : j === 12 ? '#d9a514' : '#ffd23f';
    if ((i === 8 || i === 11) && j >= 12 && j <= 14) return '#d9a514';
    if (j <= 4 && (i * 7 + j * 3) % 5 === 0) return '#5d8a45';
    if (j % 5 === 0 || (i + (Math.floor(j / 5) % 2) * 3) % 6 === 0) return '#4a4436';
    return undefined;
  });
}

// Electric coil: copper windings on a post, a silver ring on top crackling with sparks.
function makeCoil() {
  const HW = [6, 8, 9, 9, 8, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 6, 8, 8, 8];
  return drum((j) => HW[j], 0, '#1a0e05', '#e6ebf0', '#c3cad4', '#868d99', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j <= 4) return (i + j * 3) % 7 === 0 ? '#3df2ff' : undefined;
    if (j >= 20) return j === 20 ? '#3a3a3a' : '#2a2a2a';
    return j % 2 ? (rel <= 2 ? '#ffb070' : '#e08a3a') : '#a0521a';
  });
}

// Analytical engine: brass drum with two gears and a band of punched cards.
function makeAnalytical() {
  const gear = (i, j, cx, cy, r) => {
    const d = Math.hypot(i - cx, j - cy);
    const a = Math.atan2(j - cy, i - cx);
    return d <= r + (Math.cos(a * 6) > 0.3 ? 1 : 0) && d > 1;
  };
  return drum(8, 1, '#2a1a08', '#e0b850', '#c09030', '#8a6418', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#6a4a10';
    if (j >= 18 && j <= 20) return j === 19 && i % 2 ? '#3a2a10' : '#f0e6c8';
    if (gear(i, j, 6.5, 8, 2.6)) return '#5a4010';
    if (gear(i, j, 13, 13, 2.6)) return '#6a4a14';
    return undefined;
  });
}

// Giant tortoise shell: domed, olive scutes with dark seams, a pale belly at the bottom.
function makeTortoise() {
  const HW = [4, 6, 7, 8, 8, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 8, 8, 8, 7, 6];
  return drum((j) => HW[j], 0, '#1a2010', '#8a9a4a', '#6a7a3a', '#4a5428', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j >= 20) return j === 20 ? '#3a4420' : '#c8b070';
    if (j % 6 === 1 || (i + 3 * (Math.floor(j / 6) % 2)) % 6 === 0) return '#3a4420';
    return undefined;
  });
}

// Chalkboard in a wooden frame: a sum that even the barrel can do.
function makeChalkboard() {
  return drum(9, 0, '#2a1608', '#a66a31', '#8a5226', '#5e3618', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j < 3 || j > 20 || rel < 2 || rel > span - 2) return j === 21 && rel > 3 && rel < span - 3 ? '#e8e0d0' : undefined;
    if (digitAt('2+2', 4, 5, i, j) || digitAt('=4', 7, 12, i, j)) return '#f4f4ec';
    if ((i * 5 + j * 7) % 23 === 0) return '#4a6a5a'; // smudges
    return '#2a4a3a';
  });
}

// ---- weekend challenges ----
// Barbecue grill: black drum with a grate on top, embers and a little meat on the grill.
function makeGrill() {
  return drum(8, 1, '#050505', '#5a5a5a', '#3a3a3a', '#1a1a1a', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return i % 2 ? '#9a9a9a' : (i % 4 === 0 ? '#a0401a' : '#c86a3a');
    if (j === 2) return i % 2 ? '#9a9a9a' : '#2a2a2a';
    if (j === 3 || j === 4) return (i * 3 + j) % 4 === 0 ? '#ffd23f' : '#ff6a1c';
    if (j === 12 && rel % 4 === 1) return '#ff8a1c';
    if (j === 20) return '#6a6a6a';
    return undefined;
  });
}

// Inflatable flamingo: pink body, long neck and a head with a black-tipped beak.
function makeFlamingo() {
  const HW = [2, 2, 1, 1, 1, 1, 6, 8, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 8, 8, 7, 6];
  return drum((j) => HW[j], 0, '#7a1a4a', '#ffb3d0', '#ff7aae', '#d84a88', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1 && rel === span - 1) return '#1a1a1a';
    if (j >= 9 && j <= 12 && rel >= 3 && rel <= 4) return '#ffe0ee';
    if (j >= 14 && j <= 17 && rel >= span - 6 && rel <= span - 3 && (j + rel) % 2 === 0) return '#c83a78'; // folded wing
    return undefined;
  });
}

// Debug barrel (MODO DESENVOLVEDOR): dark editor theme, line numbers, green code and a breakpoint.
function makeDebugBarrel() {
  return drum(8, 1, '#05050a', '#2a2a38', '#1e1e2a', '#14141c', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#3a3a4a';
    if (rel <= 2) return j % 3 === 0 ? '#5a5a6a' : '#16161f';
    if (rel === 3 && j === 9) return '#ff3b3b'; // breakpoint
    if (j % 3 === 0) {
      const start = 4 + ((j * 7) % 3);
      const end = span - 1 - ((j * 5) % 6);
      if (rel >= start && rel <= end) return (rel + j) % 7 === 0 ? '#ffd23f' : j % 2 ? '#3df27a' : '#7fd3ff';
    }
    return undefined;
  });
}

// ---- sharing in the popular apps ----
// Chat bubble: green message balloon with lines of text and two blue ticks.
function makeChatBubble() {
  return drum(8, 1, '#0a3a1a', '#7ae08a', '#3dbf5a', '#2a8a3a', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#2a8a3a';
    if ((j === 6 || j === 9 || j === 12) && rel >= 3 && rel <= span - 3 - (j % 4) * 2) return '#ffffff';
    const tick = [[9, 17], [10, 18], [11, 17], [12, 16], [12, 17], [13, 18], [14, 17], [15, 16]]; // ✓✓
    if (tick.some(([x, y]) => x === i && y === j)) return '#2a6aff';
    return undefined;
  });
}
// The classic barrel run through a vintage filter: sepia tones and dark corners.
const SEPIA = {
  out: '#2a1e12', rim: '#5a4630', hoopL: '#d8cdb8', hoop: '#a8987c', hoopD: '#786a52', hoopS: '#5a4e3c',
  groove: '#7a6040', hi: '#e8cfa0', dark: '#86683e', base: '#b8935a',
};
function makeFilterBarrel() {
  const base = makeBarrel(SEPIA);
  const c = makeCanvas(BARREL_W, BARREL_H);
  const x = c.getContext('2d');
  x.drawImage(base, 0, 0);
  x.globalCompositeOperation = 'source-atop';
  x.fillStyle = 'rgba(40, 20, 0, 0.35)';
  for (const [px, py] of [[0, 0], [BARREL_W - 5, 0], [0, BARREL_H - 5], [BARREL_W - 5, BARREL_H - 5]]) x.fillRect(px, py, 5, 5);
  x.fillStyle = '#ff4d6d'; // a little heart: like!
  for (const [px, py] of [[8, 10], [11, 10], [7, 11], [8, 11], [9, 11], [10, 11], [11, 11], [12, 11], [8, 12], [9, 12], [10, 12], [11, 12], [9, 13], [10, 13]]) x.fillRect(px, py, 1, 1);
  return c;
}
// Paper airplane: folded white paper with diagonal creases.
function makePaperPlane() {
  return drum(8, 1, '#3a4a5a', '#ffffff', '#eef2f6', '#c8d0dc', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#9aa8b8';
    if ((i + j) % 10 === 0 || (i - j + 40) % 10 === 0) return '#9aa8b8';
    if (j >= 10 && j <= 13 && Math.abs(i - 9.5) <= (j - 9) * 1.2) return '#3d8fe0';
    return undefined;
  });
}
// Giant smartphone: black frame, a screen full of app icons, the notch and the home bar.
function makePhoneBarrel() {
  const ICONS = ['#3dbf5a', '#ff4d6d', '#3d8fe0', '#ffd23f', '#9b4dca', '#ff8a1c'];
  return drum(9, 0, '#000000', '#2a2a2a', '#1a1a1a', '#0a0a0a', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (rel < 2 || rel > span - 2 || j < 2 || j > 21) return undefined;
    if (j === 2 && rel >= 7 && rel <= span - 7) return '#000000';
    if (j === 20 && rel >= 6 && rel <= span - 6) return '#e6ebf0';
    const gx = rel - 3;
    const gy = j - 5;
    if (gx >= 0 && gy >= 0 && gx % 4 < 2 && gy % 4 < 2 && gx < 12 && gy < 12) return ICONS[(Math.floor(gx / 4) + Math.floor(gy / 4) * 3) % ICONS.length];
    return j < 8 ? '#2a6fc0' : '#1f5fae';
  });
}

// ---- reminders and invites ----
// Envelope (CONVITE ACEITO): cream paper, the flap's folds and a red wax seal.
function makeEnvelope() {
  return drum(9, 0, '#5a4a2a', '#fffbe8', '#f3e6c8', '#d8c8a0', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#d8c8a0';
    const mid = (x0 + x1) / 2;
    if (j >= 3 && j <= 12 && Math.abs(Math.abs(i - mid) - (12 - j) * 0.9) < 0.6) return '#a8987c';
    if (j >= 13 && j <= 21 && Math.abs(Math.abs(i - mid) - (j - 13) * 0.9) < 0.6) return '#c8b890';
    if (Math.hypot(i - mid, j - 12.5) <= 2.2) return Math.hypot(i - mid + 0.6, j - 12) <= 0.8 ? '#ff6a6a' : '#c01818';
    return undefined;
  });
}
// Welcome basket (CHEGUEI PELO CONVITE): fruit and flowers on top, wicker below, a big pink bow.
function makeWelcomeBasket() {
  const HW = [4, 6, 7, 8, 8, 9, 9, 9, 9, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 7, 7, 7, 6];
  return drum((j) => HW[j], 0, '#3a2408', '#d8a868', '#b8884a', '#8a6030', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j <= 6) {
      const k = (i * 5 + j * 3) % 7;
      return ['#ff4d6d', '#ffd23f', '#3ddc5a', '#ff8a1c', '#c83a78', '#ffd23f', '#3ddc5a'][k];
    }
    if (j === 7 || j === 8) return Math.abs(i - 9.5) < 1 ? '#ff7aae' : Math.abs(i - 9.5) < 4 && j === 7 ? '#ffb3d0' : '#7a5020';
    if (j >= 9 && (i + j) % 4 === 0) return '#7a5020';
    if (j >= 9 && (i - j + 40) % 4 === 0) return '#e8c088';
    return undefined;
  });
}

function makeIceberg() {
  const HW = [3, 4, 5, 6, 7, 7, 8, 8, 8, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9];
  return drum((j) => HW[j], 0, '#2a5a7a', '#ffffff', '#dff2ff', '#a8d8f0', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j >= 19) return (i + j) % 3 === 0 ? '#8fd0f0' : '#5ab0e0';
    if ((i + j) % 9 === 0 || (i - j + 30) % 11 === 0) return '#9ccfe8';
    return undefined;
  });
}

// Flag barrels: fill(i, j) paints the flag, the drum adds the outline, rim and hoops.
function makeFlag(fill) {
  return drum(8, 1, '#1a1a1a', '#000', '#000', '#000', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#5a3416';
    if (j === 4 || j === 19) return '#868d99';
    return fill(i, j);
  });
}
const flagDist = (i, j, cx, cy) => Math.hypot(i - cx, j - cy);
const FLAGS = {
  argentina: (i, j) => (j >= 9 && j < 16 ? (flagDist(i, j, 9.5, 12) <= 2 ? '#f6b40e' : '#ffffff') : '#74acdf'),
  portugal: (i, j) => (flagDist(i, j, 8, 12) <= 1.6 ? '#ffffff' : flagDist(i, j, 8, 12) <= 3.2 ? '#ffd23f' : i < 8 ? '#006600' : '#ff0000'),
  japan: (i, j) => (flagDist(i, j, 9.5, 12) <= 4.5 ? '#bc002d' : '#ffffff'),
  italy: (i, j) => (i < 7 ? '#009246' : i < 13 ? '#ffffff' : '#ce2b37'),
  france: (i, j) => (i < 7 ? '#0055a4' : i < 13 ? '#ffffff' : '#ef4135'),
  germany: (i, j) => (j < 10 ? '#1a1a1a' : j < 15 ? '#dd0000' : '#ffce00'),
  mexico: (i, j) => (flagDist(i, j, 9.5, 12) <= 1.6 ? '#8a5a2a' : i < 7 ? '#006847' : i < 13 ? '#ffffff' : '#ce1126'),
  usa: (i, j) => (i < 10 && j < 12 ? ((i + j) % 3 === 0 && i % 2 ? '#ffffff' : '#3c3b6e') : Math.floor(j / 2) % 2 ? '#ffffff' : '#b22234'),
};

// Beta testers' barrel: hazard stripes and a "BETA" stamp.
LETTERS.E = ['xxx', 'x..', 'xx.', 'x..', 'xxx'];
LETTERS.T = ['xxx', '.x.', '.x.', '.x.', '.x.'];
function makeBetaBarrel() {
  return drum(7, 3, '#1a1a1a', '#ffe066', '#ffd23f', '#c99a1a', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#3a3a3a';
    if (j >= 9 && j <= 15) {
      if (j === 9 || j === 15) return '#ffd23f';
      const k = Math.floor((i - 3) / 4);
      const lx = (i - 3) % 4;
      if (i >= 3 && k < 4 && lx < 3 && LETTERS['BETA'[k]][j - 10][lx] === 'x') return '#ffffff';
      return '#1a1a1a';
    }
    return ((i + j) >> 2) % 2 ? '#1a1a1a' : undefined;
  });
}

// Portable generator: tubular frame, orange body, a lightning bolt and a panel with outlets.
function makeGenerator() {
  const F = '#2b2b2b';
  const bolt = new Set(['10,5', '11,5', '9,6', '10,6', '8,7', '9,7', '10,7', '11,7', '10,8', '9,9', '8,10']);
  return paint(BARREL_W, BARREL_H, (i, j) => {
    if (j <= 1) return i >= 4 && i <= 5 ? '#5d6670' : null; // exhaust
    if (i === 1 || i === 18) return j >= 2 ? F : null;
    if (j === 2) return i >= 1 && i <= 18 ? F : null;
    if (j >= 21 && ((i >= 3 && i <= 5) || (i >= 14 && i <= 16))) return j === 22 && (i === 4 || i === 15) ? '#5d6670' : '#111111';
    if (j >= 21) return j === 22 && i > 1 && i < 18 ? F : null;
    if (i < 3 || i > 16 || j < 4) return null;
    if (bolt.has(`${i},${j}`)) return '#ffd23f';
    if (j >= 12 && j <= 18 && i >= 5 && i <= 14) {
      if (j === 12 || j === 18 || i === 5 || i === 14) return '#5d6670';
      if (j === 15 && (i === 7 || i === 8 || i === 11 || i === 12)) return '#111111';
      if (j === 13 && i === 13) return '#3ddc5a'; // "on" light
      return '#3a4152';
    }
    if (j === 4) return '#ffb04a';
    return i >= 14 ? '#c96a0a' : '#f28c18';
  });
}

function makeCooler() {
  const O = '#22324a';
  return paint(BARREL_W, BARREL_H, (i, j) => {
    if (j <= 4) {
      if (i < 1 || i > 18) return null;
      if (i === 1 || i === 18 || j === 0 || j === 4) return O;
      if (j === 1 && i >= 7 && i <= 12) return '#9aa3ae';
      return j === 1 ? '#5a9ff0' : '#2f6fd1';
    }
    if (i < 2 || i > 17) return null;
    if (i === 2 || i === 17 || j === 23) return O;
    if ((i === 3 || i === 16) && (j === 9 || j === 10)) return '#5d6670';
    if (j >= 13 && j <= 15 && i >= 6 && i <= 13) return j === 14 && i % 2 ? '#ffffff' : '#d62828';
    if ((i * 5 + j * 3) % 7 === 0) return '#d8d8cc';
    return i >= 15 ? '#d8d8cc' : '#f2f2ec';
  });
}

// 20 L water jug standing up.
function makeWaterJug() {
  return drum((j) => (j <= 2 ? 3 : j <= 4 ? 6 : 9), 0, '#123a6b', '#a9d6ff', '#5aa2ee', '#2565b5', (i, j, rel, span, x0, x1) => {
    if (j <= 1) return i === x0 || i === x1 ? '#123a6b' : '#f4f6f8';
    if (i === x0 || i === x1 || j === BARREL_H - 1) return undefined;
    if (j === 10 || j === 16 || j === 21) return '#3d8fe0';
    if ((j === 13 || j === 14) && rel >= 3 && rel <= span - 3) return '#ffffff';
    return undefined;
  });
}

// Shopping cart: wire basket (see-through holes), red handle, wheels.
function makeCart() {
  const W2 = '#b5bec9';
  return paint(BARREL_W, BARREL_H, (i, j) => {
    if (j <= 1 && i >= 16) return '#d62828';
    if (j <= 15) {
      const x0 = 1 + Math.floor(j / 6);
      const x1 = 18 - Math.floor(j / 6);
      if (i < x0 || i > x1) return null;
      if (i === x0 || i === x1 || j === 0 || j === 15) return '#5d6670';
      return (i - x0) % 3 === 0 || j % 3 === 0 ? W2 : null;
    }
    if (j <= 19) return (i === 4 || i === 15 || j === 17) && i >= 3 && i <= 16 ? '#7d8794' : null;
    if ((i >= 3 && i <= 5) || (i >= 14 && i <= 16)) return j === 20 || j === 23 ? '#1a1a1a' : i === 4 || i === 15 ? '#5d6670' : '#1a1a1a';
    return null;
  });
}

// Front-loading washing machine with a round porthole.
function makeWasher() {
  const O = '#4a5260';
  return paint(BARREL_W, BARREL_H, (i, j) => {
    if (i < 1 || i > 18) return null;
    if ((i === 1 || i === 18) && (j === 0 || j === 23)) return null;
    if (i === 1 || i === 18 || j === 0 || j === 23) return O;
    if (j >= 1 && j <= 4) {
      if (j === 4) return '#9aa3ae';
      if (i >= 13 && i <= 15 && j >= 2 && j <= 3) return '#5d6670';
      if (j === 2 && (i === 4 || i === 6)) return i === 4 ? '#3ddc5a' : '#ff3b3b';
      return '#dde3ea';
    }
    const dx = i + 0.5 - 10;
    const dy = j + 0.5 - 14;
    const d = Math.hypot(dx, dy);
    if (d < 7.2) {
      if (d > 5.8) return '#9aa3ae';
      if (d > 5) return '#5d6670';
      const swirl = Math.sin(Math.atan2(dy, dx) * 2 + d * 0.9);
      if ((i === 8 && j === 12) || (i === 12 && j === 16)) return '#ffffff';
      return swirl > 0.3 ? '#a9d6ff' : '#3d8fe0';
    }
    return i >= 16 ? '#c9d1db' : '#f4f6f8';
  });
}

// ---- power-up icons (9x9) ----
const POWER_ICONS = {
  shield: { rows: ['.SSSSSSS.', 'SSWWWWWSS', 'SWWWWWWWS', 'SWWWWWWWS', 'SWWWWWWWS', '.SWWWWWS.', '..SWWWS..', '...SWS...', '....S....'], pal: { S: '#3d8fe0', W: '#bfe3ff' } },
  magnet: { rows: ['GG.....GG', 'GG.....GG', 'RR.....RR', 'RR.....RR', 'RR.....RR', 'RR.....RR', '.RR...RR.', '..RRRRR..', '...RRR...'], pal: { G: '#e6ebf0', R: '#e8342a' } },
  slow: { rows: ['..ooooo..', '.oWWWWWo.', 'oWWWkWWWo', 'oWWWkWWWo', 'oWWWkkkWo', 'oWWWWWWWo', 'oWWWWWWWo', '.oWWWWWo.', '..ooooo..'], pal: { o: '#ffd23f', W: '#ffffff', k: '#1a1a1a' } },
  mini: { rows: ['k.......k', '.k.....k.', '..BBBBB..', '..BbBbB..', '..BBBBB..', '..BbBbB..', '..BBBBB..', '.k.....k.', 'k.......k'], pal: { B: '#cf9a5c', b: '#6e4420', k: '#ffffff' } },
  double: { rows: ['.........', 'Y...Y.YYY', '.Y.Y....Y', '..Y...YYY', '.Y.Y..Y..', 'Y...Y.YYY', '.........', '.ccccccc.', '.........'], pal: { Y: '#ffd23f', c: '#a0520f' } },
  invert: { rows: ['......P..', '......PP.', 'PPPPPPPPP', '......PP.', '......P..', '..P......', '.PP......', 'PPPPPPPPP', '.PP......'], pal: { P: '#ff7ad9' } },
  fog: { rows: ['.........', '...WWW...', '..WWWWW..', '.WWWWWWWW', 'WWWWWWWWW', 'WWWWWWWWW', '.WWWWWWW.', '.........', 'g.g.g.g.g'], pal: { W: '#e6ebf0', g: '#9aa3ae' } },
  mystery: { rows: ['..YYYYY..', '.YY...YY.', '.YY...YY.', '.....YY..', '....YY...', '....YY...', '.........', '....YY...', '....YY...'], pal: { Y: '#ffd23f' } },
  fire: { rows: ['....R....', '...RR....', '...RYR...', '..RYYR.R.', '..RYYRRR.', '.RYYWYYR.', '.RYWWWYR.', '.RYYWYYR.', '..RRRRR..'], pal: { R: '#ff3b1f', Y: '#ffd23f', W: '#fff3a0' } },
  big: { rows: ['kk.....kk', 'k.......k', '..BBBBB..', '.BBbBbBB.', '.BBBBBBB.', '.BBbBbBB.', '..BBBBB..', 'k.......k', 'kk.....kk'], pal: { B: '#cf9a5c', b: '#6e4420', k: '#ff3b3b' } },
};
const makeIcon = (ic) => paint(9, 9, (i, j) => ic.pal[ic.rows[j][i]] || null);
// Capsule around an icon: green ring for power-ups, red for power-downs, purple for the
// mystery one (good === null).
function makeCapsule(ic, good) {
  const ring = good === null ? '#b16cff' : good ? '#3ddc5a' : '#ff3b3b';
  const fill = good === null ? '#2a1450' : good ? '#123b73' : '#3a0a1a';
  const S = 15;
  const icon = makeIcon(ic);
  const c = paint(S, S, (i, j) => {
    const dx = i + 0.5 - S / 2;
    const dy = j + 0.5 - S / 2;
    const d = Math.max(Math.abs(dx), Math.abs(dy)) * 0.6 + Math.hypot(dx, dy) * 0.4;
    if (d > 7.3) return null;
    if (d > 6.3) return '#0f1117';
    if (d > 5.3) return ring;
    return fill;
  });
  c.getContext('2d').drawImage(icon, 3, 3);
  return c;
}

// ---- matching barrels for riders that had none ----
// Blue screen (BILL PORTÕES): a monitor with the sad face of a crash and a stand.
function makeBlueScreen() {
  const SAD = new Set(['5,5', '5,8', '9,4', '8,5', '8,6', '8,7', '8,8', '9,9']); // ":("
  return drum(9, 0, '#1a1a1a', '#c8ccd2', '#a0a6ae', '#6a7078', (i, j, rel, span, x0, x1) => {
    if (j >= 20) return j === 20 && rel > 6 && rel < span - 6 ? '#6a7078' : j >= 21 && rel > 3 && rel < span - 3 ? (isEdge(i, j, x0, x1) ? '#1a1a1a' : '#4a4e56') : null;
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j < 2 || j > 18 || rel < 2 || rel > span - 2) return undefined;
    if (SAD.has(`${i},${j}`)) return '#ffffff';
    if ((j === 12 || j === 14) && rel >= 3 && rel <= span - 3 - (j % 4)) return '#9ab8ff';
    if (j === 16 && rel >= 3 && rel <= 6) return '#ffffff';
    return '#0a3aa8';
  });
}
// Pear barrel (ESTIVE TRABALHOS): glossy white, no buttons at all, a green pear in the middle.
function makePear() {
  const PEAR = ['....l.', '...lK.', '..KK..', '.KKKK.', '.KKKK.', 'KKKKKK', 'KKKKKK', 'KKKKKK', '.KKKK.'];
  return drum(9, 0, '#8a8e94', '#ffffff', '#f2f3f5', '#d6d9de', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#e6e8eb';
    if (rel === 2 && j > 2 && j < 20) return '#ffffff';
    const row = PEAR[j - 7];
    const c = row && row[i - 7];
    if (c === 'K') return (i + j) % 5 === 0 ? '#a8e060' : '#7ac03a';
    if (c === 'l') return '#3a8a2a';
    return undefined;
  });
}
// Rocket (ASTRONAUTA): red nose cone, white body with a porthole, red fins and a flame.
function makeRocket() {
  const HW = [1, 2, 3, 4, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 7, 8, 9, 9, 9, 4, 3, 2];
  return drum((j) => HW[j], 0, '#2a2a3a', '#ffffff', '#e4e8ee', '#b8c0cc', (i, j, rel, span, x0, x1) => {
    if (j >= 21) return (i + j) % 2 ? '#ffd23f' : '#ff6a1c';
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j <= 5) return rel <= span * 0.3 ? '#ff6a6a' : '#d62828';
    if (Math.hypot(i - 9.5, j - 10) <= 2.3) return Math.hypot(i - 9, j - 9.5) <= 1 ? '#bfe3ff' : Math.hypot(i - 9.5, j - 10) <= 1.6 ? '#3d8fe0' : '#555b66';
    if (j >= 16 && (rel <= 2 || rel >= span - 2)) return '#d62828';
    if (j === 15) return '#868d99';
    return undefined;
  });
}
// Bamboo (NINJA): a thick green bamboo stalk with nodes and a leaf.
function makeBamboo() {
  return drum(8, 0, '#123a12', '#a8e070', '#6ab83a', '#3a7a22', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#d8f0a8';
    if (j === 8 || j === 16) return '#2a5a18';
    if (j === 7 || j === 15) return '#c8e890';
    if (j >= 10 && j <= 12 && rel >= span - 4 && rel - (span - 4) === j - 10) return '#2a5a18'; // leaf
    if (rel % 5 === 3 && j > 1) return '#5aa82e';
    return undefined;
  });
}
// Cloud (ANJINHO): a white puffy cloud with a golden halo on top.
function makeCloud() {
  const HW = [3, 5, 6, 7, 8, 9, 9, 8, 8, 9, 9, 9, 9, 8, 8, 9, 9, 9, 9, 8, 7, 6, 5, 4];
  return drum((j) => HW[j], 0, '#7a9ac0', '#ffffff', '#f0f6ff', '#c8daf0', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1 && rel > 1 && rel < span - 1) return '#ffd23f';
    if ((j === 7 || j === 13) && (rel <= 1 || rel >= span - 1)) return '#c8daf0';
    if ((i * 7 + j * 3) % 17 === 0) return '#e0ecff';
    return undefined;
  });
}
// Hollow log (PÉ-GRANDE): rough bark, moss and growth rings on top.
function makeLog() {
  return drum(8, 1, '#1e1206', '#8a6a42', '#6a4a2a', '#4a3018', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j <= 2) return Math.abs(Math.hypot(i - 9.5, (j - 1) * 4) % 3 - 1) < 0.6 ? '#a8865a' : '#d8b886';
    if ((i * 3 + j * 5) % 11 === 0) return '#2e1e0c';
    if (rel % 4 === 1 && j % 7 !== 0) return '#5a3c20';
    if (j >= 18 && (i + j) % 3 === 0) return '#4a8a3a'; // moss
    return undefined;
  });
}
// Rum barrel (PIRATA): dark wood with a white skull and crossbones.
const DARKWOOD = {
  out: '#120804', rim: '#2a1608', hoopL: '#a0a6ae', hoop: '#6a7078', hoopD: '#3e434c', hoopS: '#2a2e34',
  groove: '#3a2210', hi: '#7a4a24', dark: '#3a2210', base: '#5a3618',
};
function makeRum() {
  const SKULL = ['..xxxx..', '.xxxxxx.', '.x.xx.x.', '.xxxxxx.', '..xxxx..', '..x.x...', 'x......x', '.x....x.', '..x..x..', '...xx...', '..x..x..', '.x....x.', 'x......x'];
  const c = makeBarrel(DARKWOOD);
  const x = c.getContext('2d');
  x.fillStyle = '#f4f0e6';
  SKULL.forEach((row, y) => [...row].forEach((ch, k) => ch === 'x' && x.fillRect(6 + k, 7 + y, 1, 1)));
  return c;
}
// ---- Chaplolin and the slimming pen ----
// Bionic mallet (CHAPLOLIN): a squeaky hammer head, yellow ends and a red band.
function makeMallet() {
  return drum(9, 0, '#3a0a0a', '#fff07a', '#ffd23f', '#d9a514', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#fff3a0';
    if (j >= 7 && j <= 16) return rel <= span * 0.3 ? '#ff5a5a' : rel >= span * 0.75 ? '#a01a1a' : '#e02a2a';
    if (j === 6 || j === 17) return '#3a0a0a';
    return undefined;
  });
}
// Slimming pen (CANETA MOUNJA-RIO): white injector pen, blue cap, a dose window and a dial.
function makePen() {
  const HW = [5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 5, 5, 4, 4];
  return drum((j) => HW[j], 0, '#2a3a5a', '#ffffff', '#eef2f8', '#c8d2e0', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j <= 5) return rel <= span * 0.3 ? '#7ab8ff' : rel >= span * 0.75 ? '#1a4a9a' : '#3d7ae0';
    if (j === 6) return '#1a2a4a';
    if (j >= 9 && j <= 13 && rel >= 3 && rel <= span - 3) return j >= 11 ? '#9ae0ff' : '#e8f8ff';
    if (j === 16 && rel % 2 === 1) return '#3d7ae0';
    if (j >= 20) return (rel + j) % 2 ? '#3d7ae0' : '#1a4a9a';
    return undefined;
  });
}
// ---- football: barrels in the colours of Brazil's big clubs (colours only, no crests) ----
const vStripes = (i, w, a, b) => (Math.floor((i - 1) / w) % 2 ? b : a);
const TEAMS = {
  mengao: (i, j) => (Math.floor((j - 2) / 3) % 2 ? '#111111' : '#c8102e'),
  flu: (i, j) => ['#7a0a2a', '#7a0a2a', '#ffffff', '#0a6a3a', '#0a6a3a', '#ffffff'][(i + 1) % 6],
  colina: (i, j) => (Math.abs(i - (j * 0.8 - 1)) < 1.6 ? '#ffffff' : '#111111'),
  estrela: (i, j) => {
    const STAR = new Set(['9,9', '10,9', '8,10', '9,10', '10,10', '11,10', '7,11', '8,11', '9,11', '10,11', '11,11', '12,11', '9,12', '10,12', '8,13', '11,13']);
    if (Math.hypot(i - 9.5, j - 11) <= 4) return STAR.has(`${i},${j}`) ? '#ffffff' : '#111111';
    return vStripes(i, 2, '#ffffff', '#111111');
  },
  timao: (i, j) => (j <= 3 || j >= 21 || (j >= 11 && j <= 13 && i % 3) ? '#111111' : '#ffffff'),
  verdao: (i, j) => (j === 2 || j === 3 ? '#ffffff' : i % 4 === 0 ? '#005a30' : '#006b3a'),
  tricolorsp: (i, j) => (j === 9 || j === 10 ? '#d0021b' : j === 12 || j === 13 ? '#111111' : '#ffffff'),
  peixe: (i, j) => {
    const FISH = ['.xxx..x', 'xxxxxxx', 'x.xxx.x', 'xxxxxxx', '.xxx..x'];
    const row = FISH[j - 10];
    return row && row[i - 6] === 'x' ? '#111111' : '#ffffff';
  },
  imortal: (i, j) => ['#0d80bf', '#0d80bf', '#111111', '#111111', '#ffffff'][(i + 4) % 5],
  colorado: (i, j) => (j === 2 || j === 3 || j === 11 || j === 12 ? '#ffffff' : '#e30613'),
  raposa: (i, j) => {
    const STARS = new Set(['9,6', '9,16', '5,11', '14,10', '11,13']);
    return STARS.has(`${i},${j}`) ? '#ffffff' : '#003a9c';
  },
  galo: (i, j) => vStripes(i, 3, '#111111', '#ffffff'),
  esquadrao: (i, j) => (j < 9 ? '#0057a8' : j <= 10 || j >= 14 ? '#ffffff' : j <= 12 ? '#d0021b' : '#0057a8'),
};

// ---- diamond-only skins (BANCO) ----
// Diamond barrel: a cut crystal, cyan facets and white glints.
function makeDiamondBarrel() {
  return drum(8, 1, '#0a3a5a', '#e8fbff', '#7fe0ff', '#2aa8e0', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#ffffff';
    if ((i + j * 2) % 9 === 0 || (i - j * 2 + 60) % 9 === 0) return '#ffffff';
    if ((i * 3 + j) % 13 === 0) return '#1a7ac0';
    if (j === 12 && rel >= 2 && rel <= span - 2) return '#bff4ff';
    return undefined;
  });
}
// Neon barrel: black drum with glowing magenta and cyan hoops.
function makeNeonBarrel() {
  return drum(8, 1, '#000000', '#2a1a3a', '#1a0f26', '#0a0612', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return (j === 0 || j === BARREL_H - 1) ? '#ff3bd4' : '#3bf0ff';
    if (j === 1) return '#ff3bd4';
    if (j === 5 || j === 18) return '#3bf0ff';
    if (j === 6 || j === 19) return '#1a6a7a';
    if (j === 4 || j === 17) return '#7a1a6a';
    if (j >= 9 && j <= 13 && Math.abs(i - 9.5) <= 13 - j && Math.abs(i - 9.5) >= 12 - j) return '#ffd23f'; // a little neon arrow
    return undefined;
  });
}

// ---- sensor, lightning and label barrels ----
// Spinning top (PIÃO DA CASA PRÓPRIA): a wooden stem, rainbow bands and a metal tip.
function makeTop() {
  const BANDS = [['#ff6a6a', '#e8202a', '#a01018'], ['#ffe066', '#ffd23f', '#c99a1a'], ['#7fbfff', '#3d8fe0', '#1f5fae'], ['#8fe08a', '#3ddc5a', '#1f9a46']];
  const hw = (j) => (j <= 2 ? 2 : j === 3 ? 6 : j <= 13 ? 9 : Math.max(1, 9 - Math.round((j - 13) * 0.85)));
  return drum(hw, 0, '#2a1606', '#cf9a5c', '#a66a31', '#74471f', (i, j, rel, span, x0, x1) => {
    if (j <= 2) return i === x0 || i === x1 || j === 0 ? '#2a1606' : '#cf9a5c';
    if (j >= 21) return i === x0 || i === x1 ? '#3e434c' : '#c3cad4';
    if (i === x0 || i === x1 || j === BARREL_H - 1) return undefined;
    if (j === 3) return '#2a1606';
    const b = BANDS[Math.floor((j - 4) / 2) % BANDS.length];
    return shade3(rel, span, b[0], b[1], b[2]);
  });
}

// BARRIL CLASSE A: white appliance body with the energy label, A (green, longest) to G (red).
function makeClassA() {
  const BARS = ['#1f9a46', '#4cc04a', '#bfe13a', '#ffe63a', '#ffb02a', '#ff6a2a', '#e8202a'];
  return drum(8, 1, '#3a4048', '#ffffff', '#e6ebf0', '#b5bec9', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1 || j === 22) return '#868d99';
    const k = (j - 4) >> 1;
    if (k >= 0 && k < 7 && (j - 4) % 2 === 0) {
      const len = 10 - k;
      if (i >= x0 + 2 && i < x0 + 2 + len) return BARS[k];
      if (k === 0 && i >= x1 - 3 && i < x1) return '#1a1a1a'; // the arrow on A
    }
    if (j === 5 && i === x1 - 4) return '#1a1a1a';
    return undefined;
  });
}

// PILHA FRACA: an AA battery with only the last bar of charge left, in red.
function makeBattery() {
  const hw = (j) => (j <= 1 ? 3 : 8);
  return drum(hw, 0, '#111111', '#4a4a4a', '#2a2a2a', '#1a1a1a', (i, j, rel, span, x0, x1) => {
    if (j <= 1) return i === x0 || i === x1 || j === 0 ? '#3e434c' : '#c3cad4';
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 2 || j === 3) return shade3(rel, span, '#ffc078', '#d98a3a', '#9a5a1a');
    const seg = [6, 10, 14, 18].find((y) => j >= y && j <= y + 2);
    if (seg !== undefined && i >= x0 + 3 && i <= x1 - 3) {
      if (seg === 18) return '#e8202a';
      if (j === seg || j === seg + 2 || i === x0 + 3 || i === x1 - 3) return '#6a6a6a';
    }
    return undefined;
  });
}

// FAROL: a red and white lighthouse with its lamp lit.
function makeLighthouse() {
  const hw = (j) => (j <= 2 ? 4 : j <= 6 ? 6 : 6 + Math.round((j - 6) * 0.18));
  return drum(hw, 0, '#1a1010', '#f4f6f8', '#d8dde4', '#a8b0bc', (i, j, rel, span, x0, x1) => {
    if (j <= 2) return i === x0 || i === x1 || j === 0 ? '#1a1010' : '#3a2a2a';
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j <= 6) return i === 10 || i === 7 || i === 13 ? '#3a2a2a' : j === 4 ? '#ffffff' : '#ffe066';
    if (j === 7) return '#3a2a2a';
    if (j >= 19 && i >= 9 && i <= 10) return '#5a3416'; // door
    if (Math.floor((j - 8) / 4) % 2 === 0) return shade3(rel, span, '#ff6a6a', '#d62828', '#8a1010');
    return undefined;
  });
}

// CHUVEIRO ELÉTRICO: the white shower head on its pipe, a temperature knob and a lightning bolt.
function makeShower() {
  const hw = (j) => (j <= 3 ? 1 : j <= 5 ? 3 : Math.max(4, Math.round(9 * Math.sin((Math.PI * (j - 4.5)) / 19.5))));
  const BOLT = ['..Y', '.Y.', 'YYY', '.Y.', 'Y..'];
  return drum(hw, 0, '#3a4048', '#ffffff', '#e6ebf0', '#b5bec9', (i, j, rel, span, x0, x1) => {
    if (j <= 5) return i === x0 || i === x1 || j === 0 ? '#3e434c' : j <= 3 ? '#c3cad4' : '#f4f6f8';
    if (isEdge(i, j, x0, x1)) return undefined;
    const e = emblem(BOLT, { Y: '#ffd23f' }, 9, 10, i, j);
    if (e) return e;
    if (j >= 9 && j <= 11 && i >= x1 - 3 && i <= x1 - 1) return j === 10 && i === x1 - 2 ? '#e8202a' : '#868d99'; // the knob
    if (j === 8 && i === x0 + 3) return '#3d8fe0';
    if (j === 8 && i === x0 + 5) return '#e8202a';
    if (j >= 19 && (i + j) % 2 === 0) return '#5a6a7a'; // the holes
    return undefined;
  });
}

// BARRIL CERTIFICADO: wood covered in quality-test stickers: an APROVADO seal, a lot tag and a
// yellow and black test stripe.
function makeCertified() {
  const SEAL = ['..GGG..', '.GgggG.', 'GggggWG', 'GgWgWgG', 'GggWggG', '.GgggG.', '..GGG..'];
  const TAG = ['WWWW', 'WKKW', 'WWWW', 'WKWW', 'WWWW'];
  return drum(8, 1, '#2a1606', '#cf9a5c', '#a66a31', '#74471f', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#5a3416';
    if (j === 4 || j === 19) return rel <= span * 0.35 ? '#c3cad4' : rel >= span * 0.8 ? '#555b66' : '#868d99';
    const e = emblem(SEAL, { G: '#0f6a2a', g: '#1f9a46', W: '#ffffff' }, 3, 6, i, j) || emblem(TAG, { W: '#f4f6f8', K: '#1a1a1a' }, 12, 7, i, j);
    if (e) return e;
    if (j === 15 || j === 16) return ((i + j) >> 1) % 2 === 0 ? '#ffd23f' : '#1a1a1a';
    if (rel % 3 === 0) return '#6e4420';
    return undefined;
  });
}

// BARRIL ALTO EM: food packaging with the black front-of-pack label and its magnifying glass.
function makeHighIn() {
  return drum(8, 1, '#3a2a1a', '#fffbf0', '#f4f0e8', '#c8c0b0', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j <= 3) return shade3(rel, span, '#ff6a6a', '#e8202a', '#a01018');
    if (j >= 21) return shade3(rel, span, '#ff6a6a', '#e8202a', '#a01018');
    if (j >= 7 && j <= 18 && i >= x0 + 2 && i <= x1 - 2) {
      // magnifying glass at the top left of the label
      const d = Math.hypot(i + 0.5 - (x0 + 5), j + 0.5 - 9.5);
      if (d > 1.1 && d < 2.3) return '#ffffff';
      if ((i === x0 + 7 && j === 11) || (i === x0 + 8 && j === 12)) return '#ffffff';
      // three "ALTO EM" lines of text
      if ((j === 9 || j === 13 || j === 16) && i >= x0 + 9 && i <= x1 - 3 && (i - x0) % 4 !== 0) return '#ffffff';
      if (j === 15 || j === 12) return i >= x0 + 3 && i <= x1 - 3 ? '#3a3a3a' : '#1a1a1a';
      return '#1a1a1a';
    }
    return undefined;
  });
}

// CHUVA DE CÓDIGO: a black barrel with green characters falling down every other column.
function makeCodeRain() {
  return drum(8, 1, '#000000', '#0a140a', '#050a05', '#020402', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return i === x0 || i === x1 ? '#1a6a2a' : '#000000';
    if (i % 2 === 1) return undefined;
    const k = (j + ((i * 7) % 11)) % 12;
    if (k === 0) return '#c8ffc8';
    if (k <= 5) return (i * 3 + j) % 3 ? '#3ddc5a' : undefined;
    if (k <= 8) return (i + j) % 2 ? '#1a6a2a' : undefined;
    return undefined;
  });
}

// CÂMERA LAMBE-LAMBE: a wooden box camera with brass lens and a flash bulb on top.
function makeOldCamera() {
  return drum((j) => (j <= 3 ? 3 : 9), 0, '#1e1006', '#a66a31', '#8a5428', '#5a3416', (i, j, rel, span, x0, x1) => {
    if (j <= 3) return i === x0 || i === x1 || j === 0 ? '#3e434c' : j === 1 ? '#ffffff' : '#c3cad4'; // flash bulb
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 4 || j === 22) return '#3a2010';
    const d = Math.hypot(i + 0.5 - 10, j + 0.5 - 13);
    if (d < 2) return d < 1 ? '#ffffff' : '#3d8fe0';
    if (d < 3.2) return '#1a1a1a';
    if (d < 4.6) return (i + j) % 2 ? '#ffd23f' : '#c99a1a'; // brass ring
    if (j === 6 && i >= x1 - 3) return '#1a1a1a'; // viewfinder
    if (j >= 19 && (i - x0) % 3 === 0) return '#3a2010'; // bellows folds
    return undefined;
  });
}

// DISCO VOADOR: a glass dome over a wide silver disc with lights, and a faint tractor beam.
function makeSaucer() {
  const hw = (j) => (j <= 1 ? 2 : j <= 8 ? Math.min(5, 2 + j) : j <= 15 ? 10 : j <= 17 ? 6 : 3 + ((j - 18) >> 1));
  return drum(hw, 0, '#1e232b', '#dde3ea', '#a8b0bc', '#6a7280', (i, j, rel, span, x0, x1) => {
    if (j <= 8) return i === x0 || i === x1 || j === 0 ? '#1e5a6a' : (i + j) % 5 === 0 ? '#ffffff' : '#7fe3ff'; // dome
    if (j >= 18) return (i + j) % 2 ? '#ffe066' : '#fff6b0'; // beam
    if (i === x0 || i === x1 || j === 9 || j === 17) return '#1e232b';
    if (j === 12 && rel % 3 === 1) return ['#ff4d6d', '#ffd23f', '#3ddc5a'][(i >> 1) % 3]; // lights
    return undefined;
  });
}

// ---- movie and cartoon parodies: barrels ----
// MALETA DE PERÍCIA: an aluminium forensics case with a water-drop label and evidence tape.
function makeForensicCase() {
  const DROP = ['..B..', '.BBB.', 'BBBBB', 'BBWBB', '.BBB.'];
  return drum((j) => (j <= 2 ? 3 : 9), 0, '#2a3038', '#eef2f6', '#c3cad4', '#868d99', (i, j, rel, span, x0, x1) => {
    if (j <= 2) return i === x0 || i === x1 || j === 0 ? '#1a1a1a' : '#3e434c'; // handle
    if (isEdge(i, j, x0, x1)) return undefined;
    const e = emblem(DROP, { B: '#3d8fe0', W: '#ffffff' }, 8, 6, i, j);
    if (e) return e;
    if (j === 12) return '#5a6270'; // the lid's seam
    if (j === 16 || j === 17) return (i >> 1) % 2 ? '#1a1a1a' : '#ffd23f'; // evidence tape
    if ((j === 4 || j === 21) && (i === x0 + 2 || i === x1 - 2)) return '#3e434c'; // latches
    return undefined;
  });
}

// BARRIL BIOLUMINESCENTE: night-blue wood with glowing vines and spots (the blue giant's pair).
function makeGlowBarrel() {
  return drum(8, 1, '#05081a', '#1a2a5a', '#121d42', '#0a1030', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#3df2ff';
    const vine = Math.round(10 + 4 * Math.sin(j * 0.55));
    if (i === vine) return j % 4 === 0 ? '#ffffff' : '#3df2ff';
    if (i === vine - 6 && j % 3 !== 0) return '#2ab8a0';
    const h = (i * 31 + j * 17) % 23;
    if (h === 0) return '#ff4da6';
    if (h === 7) return '#b8ff6a';
    return undefined;
  });
}

// ESFERA DO DRAGÃO: an orange crystal ball with four red stars.
function makeDragonBall() {
  const STAR = ['.R.', 'RRR', '.R.'];
  return paint(BARREL_W, BARREL_H, (i, j) => {
    const dx = i + 0.5 - BARREL_W / 2;
    const dy = j + 0.5 - BARREL_H / 2;
    const d = Math.hypot(dx * 1.05, dy * 0.88);
    if (d > 10) return null;
    if (d > 9.1) return '#7a3a00';
    if (Math.hypot(dx + 4, dy + 5) < 1.6) return '#ffffff';
    for (const [sx, sy] of [[6, 7], [11, 7], [6, 13], [11, 13]]) {
      const e = emblem(STAR, { R: '#d62828' }, sx, sy, i, j);
      if (e) return e;
    }
    return d < 4 ? '#ffc078' : d < 7 ? '#ff9f1c' : '#e8780a';
  });
}

// PORTAL VERDE: a swirling green portal.
function makePortal() {
  const C = ['#1f9a46', '#8fe08a', '#3ddc5a'];
  return paint(BARREL_W, BARREL_H, (i, j) => {
    const dx = i + 0.5 - BARREL_W / 2;
    const dy = j + 0.5 - BARREL_H / 2;
    const d = Math.hypot(dx * 1.05, dy * 0.85);
    if (d > 10) return null;
    if (d > 9.2) return '#0f4a22';
    if (d < 1.6) return '#ffffff';
    const k = Math.floor(d * 0.9 + (Math.atan2(dy, dx) * 3) / Math.PI + 30) % 3;
    return C[k];
  });
}

// AZEITE DA FAMÍLIA: a green olive-oil tin with a yellow label and an olive branch.
function makeOliveTin() {
  const BRANCH = ['..g.g..', '.gGgGg.', 'gGoGoGg', '.gGgGg.', '..g.g..'];
  return drum((j) => (j <= 1 ? 3 : 8), 0, '#0f2a12', '#3a8a3a', '#2a6a2a', '#1a4a1a', (i, j, rel, span, x0, x1) => {
    if (j <= 1) return i === x0 || i === x1 || j === 0 ? '#3e434c' : '#c3cad4'; // cap
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 2 || j === 22) return '#c99a1a';
    if (j >= 7 && j <= 17) {
      const e = emblem(BRANCH, { g: '#2a6a2a', G: '#4cc04a', o: '#3a2a4a' }, 6, 10, i, j);
      if (e) return e;
      if (j === 7 || j === 17) return '#c99a1a';
      return '#ffe9a8';
    }
    return undefined;
  });
}

// BARRIL DOS ELFOS: the river-escape barrel, oak with silver hoops and an elven leaf.
function makeElvenBarrel() {
  const LEAF = ['..G..', '.GgG.', 'GgGgG', '.GgG.', '..G..', '..b..'];
  return drum(8, 1, '#2a1606', '#cf9a5c', '#a66a31', '#74471f', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#5a3416';
    if (j === 4 || j === 19) return rel <= span * 0.35 ? '#ffffff' : rel >= span * 0.8 ? '#868d99' : '#dde3ea';
    const e = emblem(LEAF, { G: '#1f9a46', g: '#8fe08a', b: '#5a3416' }, 8, 9, i, j);
    if (e) return e;
    if (rel % 3 === 0) return '#6e4420';
    return undefined;
  });
}

// SABONETE: a pink bar of soap with stamped letters and a few bubbles.
function makeSoapBar() {
  return paint(BARREL_W, BARREL_H, (i, j) => {
    const bub = [[4, 2, 1.6], [14, 1.5, 1.2], [9, 1, 0.9]].find(([x, y, r]) => Math.hypot(i + 0.5 - x, j + 0.5 - y) < r);
    if (bub) return Math.hypot(i + 0.5 - bub[0], j + 0.5 - bub[1]) < bub[2] - 0.7 ? '#ffffff' : '#bfe3ff';
    if (i < 1 || i > 18 || j < 4 || j > 23) return null;
    const corner = (i < 3 || i > 16) && (j < 6 || j > 21);
    if (corner && Math.hypot(i < 3 ? 3 - i : i - 16, j < 6 ? 6 - j : j - 21) > 2.2) return null;
    if (i === 1 || i === 18 || j === 4 || j === 23) return '#a8506a';
    if ((j === 11 || j === 14) && i >= 5 && i <= 14 && i % 3 !== 2) return '#e88aa8'; // stamped name
    return i <= 4 ? '#ffd0dc' : i >= 15 ? '#e88aa8' : '#ffb3c6';
  });
}

// VERME DA AREIA: a giant sand worm rising, ringed body and a round mouth full of teeth.
function makeSandworm() {
  return drum(8, 1, '#3a2a10', '#e8c890', '#c8a060', '#8a6a3a', (i, j, rel, span, x0, x1) => {
    if (i === x0 || i === x1 || j === BARREL_H - 1) return undefined;
    if (j <= 6) {
      const d = Math.hypot(i + 0.5 - 10, (j + 0.5 - 3.5) * 1.6);
      if (j === 0) return '#3a2a10';
      if (d < 2.4) return '#3a0a0a';
      if (d < 4.5) return (i + j) % 2 ? '#ffffff' : '#5a1a1a'; // teeth
      return '#c8a060';
    }
    if (j % 3 === 0) return '#8a6a3a'; // rings
    return undefined;
  });
}

// BARRIL GALÁCTICO (LENDÁRIO): deep-space nebula, stars, a ringed planet and gold hoops.
function makeGalaxy() {
  return drum(8, 1, '#05030f', '#3a2a7a', '#2a1a5a', '#150a33', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#ffd23f';
    if (j === 4 || j === 19) return rel <= span * 0.35 ? '#fff3a0' : rel >= span * 0.8 ? '#c99a1a' : '#ffd23f';
    if (j === 5 || j === 20) return '#7a5a00';
    const dx = i + 0.5 - 10;
    const dy = j + 0.5 - 12;
    if (Math.abs(dy + dx * 0.35) < 0.6 && Math.abs(dx) < 5.5 && Math.hypot(dx, dy) > 2.2) return '#ffe066'; // the ring
    const d = Math.hypot(dx, dy);
    if (d < 2.6) return dx + dy < -1 ? '#ffc078' : '#ff9f1c';
    const h = (i * 37 + j * 91) % 53;
    if (h === 0 || h === 17) return '#ffffff';
    if (h === 31) return '#3df2ff';
    const neb = Math.sin(i * 0.7 + j * 0.45) + Math.sin(j * 0.31 - i * 0.2);
    if (neb > 1.3) return '#ff4da6';
    if (neb > 0.9) return '#9b4dca';
    if (neb < -1.4) return '#1f5fae';
    return undefined;
  });
}

// Rainbow stripes with pearly white hoops and a sparkle (the UNICÓRNIO's pair).
function makeRainbowBarrel() {
  const BANDS = ['#ff4d6d', '#ff9f1c', '#ffd23f', '#3ddc5a', '#3d8fe0', '#9b4dca'];
  const DARK = ['#c22f4d', '#c9760c', '#d9a514', '#25a03e', '#2a63a8', '#6e3191'];
  return drum(8, 1, '#4a3a5a', '#fbf7ff', '#e6dcf2', '#c9b8de', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#ffb3c6';
    if (j === 4 || j === 19) return rel <= span * 0.35 ? '#ffffff' : '#e6dcf2';
    if (j === 5 || j === 20) return '#c9b8de';
    if ((i === 6 && j === 9) || (i === 13 && j === 15) || (i === 8 && j === 21)) return '#ffffff';
    if (j >= 7 && j <= 18) {
      const b = Math.floor((j - 7) / 2);
      return rel >= span - 2 ? DARK[b] : BANDS[b];
    }
    return undefined;
  });
}

// ---- backlog skins: barrels ----
// Char-art overlay for barrel details: the colour at (i, j) of `rows` drawn from (ox, oy), if any.
function emblem(rows, pal, ox, oy, i, j) {
  const r = rows[j - oy];
  const ch = r && i >= ox ? r[i - ox] : undefined;
  return ch && ch !== '.' ? pal[ch] : undefined;
}
const DIGITS3 = {
  0: ['xxx', 'x.x', 'x.x', 'x.x', 'xxx'], 1: ['.x.', 'xx.', '.x.', '.x.', 'xxx'], 8: ['xxx', 'x.x', 'xxx', 'x.x', 'xxx'],
};
const digitRows = (s) => DIGITS3[0].map((_, r) => [...s].map((c) => DIGITS3[c][r]).join('.'));

// Dark oak with iron hoops and a leather strap: the 1901 barrel of the first person down the falls.
function makeBarrel1901() {
  return drum(8, 1, '#1e1006', '#8a5a2e', '#6a4220', '#4a2c14', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#3a2410';
    if (j === 4 || j === 19) return rel <= span * 0.35 ? '#7a7a82' : '#4a4a50';
    if (j === 5 || j === 20) return '#2a2a30';
    if ((i === 9 || i === 10) && j > 5 && j < 19) {
      if (j === 11 || j === 12) return i === 9 ? '#f0d070' : '#c9a43a';
      return i === 9 ? '#5a3418' : '#3a2010';
    }
    if (rel % 3 === 0) return '#3e2612';
    return undefined;
  });
}

// Brown houndstooth tweed with a brass magnifying glass (SHERLOCK's pair).
function makeTweed() {
  const LUPA = ['.ooo..', 'oWWWo.', 'oWwWo.', 'oWWWo.', '.ooo..', '....B.', '.....B'];
  const pal = { o: '#c9a43a', W: '#cfe8ff', w: '#ffffff', B: '#3a2010' };
  return drum(8, 1, '#1e140a', '#a08a68', '#8a7458', '#5a4a38', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#3a2a1a';
    if (j === 4 || j === 19) return '#4a2a14';
    const e = emblem(LUPA, pal, 7, 9, i, j);
    if (e) return e;
    const dark = ((i >> 1) + (j >> 1)) % 2 === 0 && (i + j) % 2 === 0;
    if (dark) return rel >= span - 2 ? '#2e2418' : '#4a3a2a';
    return undefined;
  });
}

// A round yellow ball with a blue band and a red star (the toy sheriff's pair).
function makeStarBall() {
  const STAR = ['..R..', '.RRR.', 'RRRRR', '.RRR.', '.R.R.'];
  return paint(BARREL_W, BARREL_H, (i, j) => {
    const dx = i + 0.5 - BARREL_W / 2;
    const dy = j + 0.5 - BARREL_H / 2;
    const d = Math.hypot(dx, dy);
    if (d > 9.6) return null;
    if (d > 8.7) return '#3a2a00';
    const s = emblem(STAR, { R: '#d62828' }, 8, 4, i, j);
    if (s) return s;
    if (Math.abs(dy) <= 2) return dx > 4 ? '#1e3f86' : '#2a5ab8';
    if (dx + dy < -9) return '#fff3a0';
    return dx > 4 || dy > 6 ? '#d9a514' : '#ffd23f';
  });
}

// Navy barrel with a yellow umbrella (the architect's pair).
function makeUmbrellaBarrel() {
  const UMB = ['...YY...', '.YYYYYY.', 'YYYYYYYY', 'y.y..y.y', '...K....', '...K....', '.K.K....', '..K.....'];
  return drum(8, 1, '#0a1020', '#3a4a7a', '#2a3a6a', '#1a2448', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#ffd23f';
    if (j === 4 || j === 19) return '#c3cad4';
    if (j === 5 || j === 20) return '#555b66';
    return emblem(UMB, { Y: '#ffd23f', y: '#d9a514', K: '#1a1a1a' }, 6, 8, i, j);
  });
}

// Beige motorhome with a brown stripe and two wheels (the chemistry teacher's pair).
function makeMotorhome() {
  const O = '#2a1e10';
  return paint(BARREL_W, BARREL_H, (i, j) => {
    if (j >= 19) {
      for (const cx of [5, 14]) {
        const d = Math.hypot(i - cx, j - 20.5);
        if (d <= 2.6) return d <= 1 ? '#9aa3ae' : '#1a1a1a';
      }
      if (j > 19) return null;
    }
    if (i < 1 || i > 18 || j < 3) return null;
    if (j === 3 && (i === 1 || i === 18)) return null;
    if (i === 1 || i === 18 || j === 3 || j === 19) return O;
    if (j >= 6 && j <= 9 && ((i >= 3 && i <= 6) || (i >= 13 && i <= 16))) return j === 6 || i === 3 || i === 13 ? '#d8f0ff' : '#8fc3ee';
    if (i >= 9 && i <= 10 && j >= 7 && j <= 18) return i === 9 ? '#c9bc96' : '#b0a37e';
    if (j === 13 || j === 14) return '#8a5a2e';
    if (j === 15) return '#c98a3a';
    return i >= 16 ? '#c9bc96' : '#e8dcb8';
  });
}

// Steel hatch with a locking wheel and "108" (the flight survivor's pair).
function makeHatch() {
  const WHEEL = ['..ooooo..', '.o.....o.', 'o...o...o', 'o...o...o', 'ooooooooo', 'o...o...o', 'o...o...o', '.o.....o.', '..ooooo..'];
  const NUM = digitRows('108');
  return drum(8, 1, '#141820', '#9aa3ae', '#6d7580', '#4a5058', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#3a3f46';
    if (j === 3 && rel % 2 === 0) return '#3a3f46';
    return emblem(WHEEL, { o: '#2a2e34' }, 5, 5, i, j) || emblem(NUM, { x: '#ffd23f' }, 4, 16, i, j);
  });
}

// Pink barrel with ○ △ □ (the player 456's pair).
function makeGameBarrel() {
  const SHAPES = [
    '.WWW.', 'W...W', 'W...W', 'W...W', '.WWW.', '.....',
    '..W..', '.W.W.', '.W.W.', 'W...W', 'WWWWW', '.....',
    'WWWWW', 'W...W', 'W...W', 'W...W', 'WWWWW',
  ];
  return drum(8, 1, '#3a0a1a', '#ff7aa0', '#ff4d80', '#c22f5c', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1 || j === 22) return '#1a1a1a';
    return emblem(SHAPES, { W: '#ffffff' }, 8, 3, i, j);
  });
}

// Steel vault with a dial and banknotes sticking out of the lid (the heist's pair).
function makeVault() {
  const DIAL = ['..ccccc..', '.cKKKKKc.', 'cKKcKcKKc', 'cKKKcKKKc', 'cKccRccKc', 'cKKKcKKKc', 'cKKcKcKKc', '.cKKKKKc.', '..ccccc..'];
  return drum(9, 0, '#141820', '#7a8088', '#5a6068', '#3e434c', (i, j, rel, span, x0, x1) => {
    if (j === 0 && i % 3 !== 1 && i > x0 + 1 && i < x1 - 1) return '#3ddc5a';
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return i % 3 === 1 ? '#25a03e' : '#3ddc5a';
    if (j === 3 || j === 20) return '#2a2e34';
    if ((j === 6 || j === 17) && (rel === 1 || rel === span - 1)) return '#c3cad4';
    return emblem(DIAL, { c: '#c3cad4', K: '#2a2e34', R: '#d62828' }, 5, 7, i, j);
  });
}

// A barrel bristling with swords on top and a red velvet seat (the king of the north's pair).
function makeThrone() {
  const tops = { 3: 3, 5: 1, 7: 4, 8: 0, 11: 0, 12: 4, 14: 1, 16: 3 };
  return drum(8, 1, '#0d0f12', '#6d7580', '#4a5058', '#2a2e34', (i, j, rel, span, x0, x1) => {
    if (j < 6) {
      const t = tops[i];
      if (t === undefined || j < t) return null;
      return j === t ? '#ffffff' : i % 2 ? '#9aa3ae' : '#c3cad4';
    }
    if (j === 6) return i % 3 === 0 ? '#5a3418' : '#c9a43a';
    if (isEdge(i, j, x0, x1)) return undefined;
    if (i >= 6 && i <= 13 && j >= 9 && j <= 17) return i === 6 || j === 9 ? '#b82a2a' : '#8a1d1d';
    if (j === 20) return '#c9a43a';
    return undefined;
  });
}

// Navy barrel with an atom (the physicist's pair).
function makeQuantum() {
  const ATOM = ['.ccc...ccc.', 'c...c.c...c', 'c....c....c', '.c..cYc..c.', '..c.YYY.c..', '.c..cYc..c.', 'c....c....c', 'c...c.c...c', '.ccc...ccc.'];
  return drum(8, 1, '#060a18', '#2a3a6a', '#1e2a4e', '#121a30', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#7fd8ff';
    if (j === 4 || j === 19) return '#7fd8ff';
    return emblem(ATOM, { c: '#7fd8ff', Y: '#ff5252' }, 4, 7, i, j);
  });
}

// Terracotta flower pot with a heart and flowers on top (MÃE's pair, Mother's Day).
function makeFlowerPot() {
  const HEART = ['.R.R.', 'RRRRR', 'RRRRR', '.RRR.', '..R..'];
  const FLOWERS = [
    '.........Y..........', '....P...YyY.........', '...PpP...Y.....R....', '....P....G....RrR...',
    '....G..L.G.....R....', '....GL...G..L..G....', '....G....GL....G....', '...LG....G....GL....',
  ];
  return paint(BARREL_W, BARREL_H, (i, j) => {
    if (j < 8) return emblem(FLOWERS, { Y: '#ffd23f', y: '#ff9f1c', P: '#ff7aa0', p: '#ffffff', R: '#d62828', r: '#ffd23f', G: '#25a03e', L: '#3ddc5a' }, 0, 0, i, j) || null;
    const hw = j <= 10 ? 9 : 8 - Math.floor((j - 11) / 5);
    const x0 = 10 - hw;
    const x1 = 9 + hw;
    if (i < x0 || i > x1) return null;
    if (i === x0 || i === x1 || j === 8 || j === BARREL_H - 1 || j === 11) return '#3a1a0a';
    if (j <= 10) return j === 9 ? '#e8905a' : '#c8643a';
    const h = emblem(HEART, { R: '#ff4d80' }, 8, 14, i, j);
    if (h) return h;
    return i - x0 <= 2 ? '#d8774a' : x1 - i <= 2 ? '#7a3418' : '#a04a28';
  });
}

// Red toolbox with a handle and a latch (PAI's pair, Father's Day).
function makeToolbox() {
  const O = '#3a0505';
  return paint(BARREL_W, BARREL_H, (i, j) => {
    if (j <= 4) {
      if ((j === 1 || j === 2) && i >= 6 && i <= 13) return j === 1 ? '#3e434c' : '#868d99';
      if (j >= 3 && (i === 6 || i === 13)) return '#3e434c';
      return null;
    }
    if (i < 1 || i > 18) return null;
    if (i === 1 || i === 18 || j === 5 || j === BARREL_H - 1) return O;
    if (j === 10) return '#8a1414';
    if ((i === 9 || i === 10) && (j === 9 || j === 11)) return '#c3cad4';
    if (j === 6) return '#ff5252';
    if (j >= 14 && j <= 16 && i >= 4 && i <= 15) return j === 15 ? '#c3cad4' : '#868d99';
    return i >= 16 ? '#a51515' : i <= 3 ? '#ff5252' : '#d62828';
  });
}

// ---- skins from codes (hidden: only in the shop once redeemed) ----
// Codecon barrel: the community's dark drum with "<con>" in white, lavender hoops, lime rim.
function makeCodeconBarrel() {
  const GLYPH = {
    '<': ['.x', 'x.', 'x.', '.x'], '>': ['x.', '.x', '.x', 'x.'],
    c: ['xxx', 'x..', 'x..', 'xxx'], o: ['xxx', 'x.x', 'x.x', 'xxx'], n: ['xx.', 'x.x', 'x.x', 'x.x'],
  };
  const text = [['<', 3], ['c', 5], ['o', 9], ['n', 13], ['>', 16]]; // [glyph, x]
  return drum(9, 0, '#000000', '#2a2e36', '#22262c', '#0e1014', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#b1ff37';
    if (j === 4 || j === 19) return '#d1bcfb';
    if (j === 5 || j === 20) return '#8a76c0';
    if (j >= 10 && j <= 13) {
      for (const [g, gx] of text) {
        const row = GLYPH[g][j - 10];
        if (i >= gx && i < gx + row.length && row[i - gx] === 'x') return g === '<' || g === '>' ? '#d1bcfb' : '#ffffff';
      }
    }
    if (j === 15 && rel >= 4 && rel <= span - 4) return '#b1ff37'; // the cursor under the logo
    return undefined;
  });
}

// ---- heroes and the atomic physicist ----
// Web barrel (HOMEM-ARRANHA): red with a black spider web, blue at the bottom.
function makeWebBarrel() {
  return drum(9, 0, '#2a0606', '#ff4a4a', '#d62828', '#9a1a1a', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j >= 18) return j === 18 ? '#0a1a5a' : (rel <= 3 ? '#4a7aff' : '#1a4ad0');
    const dx = i - 9.5;
    const dy = j - 9;
    const d = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx) / (Math.PI / 4);
    if (Math.abs(ang - Math.round(ang)) < 0.09 * (6 / Math.max(d, 1))) return '#1a1a1a';
    if (d > 1 && Math.abs(d % 3.5 - 1.75) < 0.38) return '#1a1a1a';
    return undefined;
  });
}
// Bati-barril (BATIMÁ): black armour, a yellow utility belt with pouches.
function makeBatBarrel() {
  return drum(8, 1, '#000000', '#3a3a4a', '#22222e', '#101018', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return '#4a4a5a';
    if (j === 14 || j === 15) return (rel % 4 === 1 && j === 15) ? '#c99a1a' : '#ffd23f';
    if (j === 16 && rel % 4 === 1) return '#a07a10';
    if ((j === 5 || j === 9) && rel % 5 === 2) return '#5a5a6a'; // rivets
    return undefined;
  });
}
// O Dispositivo (FECHAHAIMER): a round metal device covered in bolts and cables.
function makeDevice() {
  const HW = [3, 5, 6, 7, 8, 8, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 8, 8, 7, 6, 5, 4, 3];
  return drum((j) => HW[j], 0, '#14161a', '#9aa2ae', '#6a727e', '#3e444e', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if ((i * 7 + j * 3) % 19 === 0) return '#d8dde4'; // bolts
    if (Math.abs(j - (6 + Math.round(Math.sin(i * 0.9) * 2))) < 1) return '#e8342a'; // red cable
    if (Math.abs(j - (16 + Math.round(Math.cos(i * 0.8) * 2))) < 1) return '#ffd23f'; // yellow cable
    if (j >= 10 && j <= 13 && Math.abs(i - 9.5) <= 3) return j === 10 || j === 13 ? '#2a2e34' : (i + j) % 2 ? '#3df27a' : '#1a3a2a'; // panel
    return undefined;
  });
}

// ---- TV hosts of the 80s/90s (parodies) ----
// Nave dos Baixinhos (CHACHU): pink spaceship with a glass dome, portholes and blinking lights.
function makeShip() {
  const HW = [3, 4, 5, 6, 6, 7, 7, 8, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 8, 8, 7, 6, 5, 4];
  return drum((j) => HW[j], 0, '#3a0a24', '#ffb3d9', '#ff6fb5', '#c83a84', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return j <= 6 ? '#5a7aa0' : undefined;
    if (j <= 6) return rel <= 2 && j > 1 ? '#ffffff' : (i + j) % 5 === 0 ? '#e8f6ff' : '#a8dcff'; // glass dome
    if (j === 7 || j === 15) return '#ffffff';
    if (j >= 9 && j <= 12) {
      for (const cx of [5, 9.5, 14]) if (Math.hypot(i - cx, j - 10.5) < 1.6) return Math.hypot(i - cx + 0.5, j - 10) < 0.7 ? '#ffffff' : '#3d8fe0';
    }
    if (j === 17 && rel % 3 === 1) return (rel >> 1) % 2 ? '#ffd23f' : '#3bf0ff'; // lights
    if (j >= 20) return j === 23 ? undefined : '#e8e8ea';
    return undefined;
  });
}
// Vou de Táxi (ANJÉLICA): yellow cab with the roof sign, windows and the checkered stripe.
function makeTaxi() {
  const HW = [2, 3, 3, 3, 8, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 8, 7];
  return drum((j) => HW[j], 0, '#2a1a00', '#ffe066', '#ffd23f', '#d9a800', (i, j, rel, span, x0, x1) => {
    if (j <= 3) return isEdge(i, j, x0, x1) || j === 3 ? '#1a1a1a' : (j === 1 || j === 2) && rel > 0 && rel < span ? '#fff6c0' : '#1a1a1a'; // roof sign
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j >= 6 && j <= 10) return Math.abs(i - 9.5) < 1 ? '#d9a800' : rel <= 1 || rel >= span - 1 ? undefined : (i + j) % 6 === 0 ? '#e8f6ff' : '#5a8ac0'; // windows
    if (j === 13 || j === 14) return (Math.floor(rel / 2) + j) % 2 ? '#1a1a1a' : '#ffffff'; // checkered stripe
    if (j === 18 && (rel === 1 || rel === span - 1)) return '#ff3a2a'; // lights
    if (j >= 20) return (i % 6 === 2 || i % 6 === 3) && j >= 21 ? '#1a1a1a' : '#2a2a2a';
    return undefined;
  });
}

// ---- myths: Greek gods and Brazilian folklore ----
// Heart (CUPIDO): a red heart pierced by a golden arrow.
function makeHeart() {
  const HW = [7, 9, 9, 10, 10, 10, 10, 10, 10, 9, 9, 8, 8, 7, 7, 6, 6, 5, 4, 4, 3, 2, 2, 1];
  return drum((j) => HW[j], 0, '#4a0a1a', '#ff6f8f', '#e8344a', '#a01a2a', (i, j, rel, span, x0, x1) => {
    const c = Math.abs(i - 9.5);
    if (j <= 3 && c < 3.5 - j) return null; // the dip between the two lobes
    if (j === 0 && c > 5) return null;
    const a = 17 - ((j - 4) * 15) / 14; // arrow from bottom-left to top-right
    if (j >= 3 && j <= 19 && Math.abs(i - a) < 0.8) return j <= 5 ? '#ffffff' : '#ffd23f';
    if (j >= 16 && j <= 18 && Math.abs(i - a) < 2 && i > a) return '#ffffff'; // feathers
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j >= 3 && j <= 5 && rel >= 2 && rel <= 3) return '#ffd0da'; // shine
    return undefined;
  });
}
// Olympus (ZEUS): a white marble column with a golden lightning bolt.
function makeOlympus() {
  return drum(8, 0, '#2a2e36', '#ffffff', '#e6e8ee', '#b8bcc8', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j <= 2 || j >= 21) return j === 2 || j === 21 ? '#c99a1a' : '#f4f4f8'; // capital and base
    const zig = [0, 1, 2, 3, 2, 1, 0, -1, -2, -1, 0, 1, 2, 3, 2, 1, 0, -1];
    const bx = 9.5 + (zig[j - 3] || 0);
    if (Math.abs(i - bx) < 1.2) return Math.abs(i - bx) < 0.5 ? '#fff6a0' : '#ffd23f';
    if (rel % 3 === 0) return '#b8bcc8'; // fluting
    return undefined;
  });
}
// Shell (POSEIDON): a peach scallop shell with ribs fanning out from the bottom.
function makeShell() {
  const HW = [5, 7, 8, 9, 9, 10, 10, 10, 10, 10, 9, 9, 9, 8, 8, 7, 6, 6, 5, 4, 4, 4, 5, 5];
  return drum((j) => HW[j], 0, '#5a2a1a', '#ffe0c8', '#ffb894', '#e88a6a', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j >= 20) return j === 20 ? '#c86a4a' : '#ffb894';
    const k = Math.floor(((Math.atan2(22 - j, i - 9.5) / Math.PI) * 11));
    if (Math.abs(((Math.atan2(22 - j, i - 9.5) / Math.PI) * 11) - k - 0.5) > 0.38) return '#c86a4a'; // ribs
    return k % 2 ? '#ffd0b8' : undefined;
  });
}
// Statue (MEDUSA): grey stone, cracked, with a carved snake winding up.
function makeStatue() {
  return drum(8, 1, '#1a1c20', '#b8bcc0', '#8e9298', '#62666c', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    const sx = 9.5 + Math.round(Math.sin(j * 0.55) * 4);
    if (j >= 4 && j <= 20 && Math.abs(i - sx) < 1) return '#4caf3a';
    if (j === 3 && Math.abs(i - (9.5 + Math.round(Math.sin(3 * 0.55) * 4))) < 1.5) return '#2e7a22'; // the snake's head
    if ((i * 5 + j * 11) % 23 === 0 || (j === 9 && rel > 2 && rel < 6) || (i === 13 && j > 13 && j < 18)) return '#3a3e44'; // cracks
    return undefined;
  });
}
// Whirlwind (SACI): a grey-brown dust devil spinning, with leaves caught in it.
function makeWhirl() {
  const HW = [10, 10, 9, 9, 9, 8, 8, 8, 7, 7, 7, 6, 6, 6, 5, 5, 5, 4, 4, 4, 3, 3, 3, 2];
  return drum((j) => HW[j], 0, '#3a3020', '#e8dcc0', '#c8b890', '#9a8a68', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if ((rel + j * 2) % 6 === 0) return '#7a6a4a'; // spiral bands
    if ((i * 7 + j * 5) % 29 === 0) return '#4caf3a'; // leaves
    if (j === 4 && rel === Math.round(span / 2)) return '#e8342a'; // the red cap flying around
    return undefined;
  });
}
// Water lily (IARA): a giant green pad with veins and a pink flower on top.
function makeLily() {
  return drum(9, 0, '#0a2a10', '#7acc4a', '#4caf3a', '#2e7a22', (i, j, rel, span, x0, x1) => {
    const c = Math.abs(i - 9.5);
    if (j <= 6) {
      if (j <= 1) return c < 1 ? '#ffe680' : null;
      if (c < 1 && j <= 3) return '#ffe680';
      if (c < 7 - j * 0.6) return (i + j) % 3 ? '#ff7aae' : '#ffd0e0'; // petals
      return isEdge(i, j, x0, x1) || j === 6 ? '#2e7a22' : null;
    }
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 7 || j === 22) return '#a8e870'; // the pad's raised rim
    const a = Math.atan2(j - 14, i - 9.5) / (Math.PI / 5);
    if (Math.abs(a - Math.round(a)) < 0.12) return '#2a6a1e'; // veins
    return undefined;
  });
}
// Boitatá (CURUPIRA): a coiled fire snake, dark body with flames and two glowing eyes.
function makeBoitata() {
  return drum(8, 1, '#1a0800', '#5a2a10', '#3a1a08', '#220e04', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if ((j - 2) % 5 <= 1 && j < 22) return (rel + j) % 3 === 0 ? '#ffd23f' : (j - 2) % 5 === 0 ? '#ff8a1c' : '#e8342a'; // coils of fire
    if (j === 4 && (i === 7 || i === 12)) return '#fff6a0'; // eyes
    return undefined;
  });
}

// ---- phone extras: steps, light, headphones ----
// Squeeze bottle (DEZ MIL PASSOS): orange cap, see-through blue body half full of water.
function makeSqueeze() {
  const HW = [2, 2, 3, 3, 5, 6, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 6];
  return drum((j) => HW[j], 0, '#1a3a5a', '#d8f2ff', '#b8e4ff', '#7fc0e8', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j <= 3) return j <= 1 ? '#ffb35a' : '#ff8a1c';
    if (j >= 14 && j <= 16) return j === 15 && rel > 2 && rel < span - 2 ? '#ff8a1c' : '#ffffff';
    if (j >= 10) return rel <= 2 ? '#7fd3ff' : (i + j) % 7 === 0 ? '#bfe3ff' : '#3d8fe0';
    return undefined;
  });
}
// Firefly (NO ESCURINHO): dark body, see-through wings, a glowing tail.
function makeFirefly() {
  return drum(8, 1, '#0a140a', '#3a4a2a', '#2a3a1e', '#1a2412', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return j >= 13 ? '#6a8a10' : undefined;
    if (j <= 8 && (rel <= 4 || rel >= span - 4)) return (i + j) % 3 ? '#c8e8ff' : '#9ac8e8'; // wings
    if (j >= 13) return Math.hypot(i - 9.5, j - 18) < 3 ? '#fbffb0' : '#d8ff5a';
    if (j === 12) return '#8ab020';
    return undefined;
  });
}
// Beach umbrella (SOL NA CARA): red and white canopy wedges, a fringe and the pole.
function makeUmbrella() {
  return drum(9, 0, '#3a0a0a', '#fff', '#fff', '#fff', (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j >= 19) return Math.abs(i - 9.5) < 1 ? '#c8c8c8' : j === 19 && i % 2 ? '#d62828' : '#f4e2b0';
    const k = Math.floor(((Math.atan2(j + 4, i - 9.5) / Math.PI) * 9)) % 2;
    const c = k ? '#d62828' : '#ffffff';
    return rel <= 2 ? (k ? '#ff5a5a' : '#ffffff') : rel >= span - 2 ? (k ? '#a01a1a' : '#d8d8d8') : c;
  });
}

// ---- NFC creatures: a monster made from a chip's serial number (hashed) ----
// Each of the 6 lab slots is a hidden rider (nfc1..6) and its barrel (nfcb1..6), rebuilt from
// the seed stored in save.nfc whenever it changes. The same object always makes the same creature.
const CR_COLORS = [['#4caf3a', '#2e7a22'], ['#e8342a', '#a01a1a'], ['#3d8fe0', '#1a4ad0'], ['#9b4dca', '#6a2a9a'], ['#ff8a1c', '#c05a0a'], ['#ffd23f', '#c99a1a'], ['#ff7aae', '#c83a78'], ['#3bf0ff', '#1a9aaa'], ['#e8e8ea', '#9aa2ae'], ['#8a5a2a', '#5a3416'], ['#3a3a4a', '#1a1a24'], ['#7dff9a', '#2a8a3a']];
const CR_SYL = ['GLO', 'BRU', 'ZAN', 'KRO', 'FI', 'MO', 'TUK', 'PLI', 'ZOR', 'BA', 'NHO', 'XU', 'LEP', 'DRA', 'GUM', 'BIL', 'TO', 'QUA', 'RIM', 'POC'];
const CR_DESC = [
  tr('Nasceu de um chip e já quer descer a cachoeira. Ninguém sabe se morde.'),
  tr('Saiu do cartão meio tonto. Come bits no café da manhã.'),
  tr('Criatura de silício com coração de barril. Rara, única e meio barulhenta.'),
  tr('Escaneado, compilado e pronto pra descer. Às vezes pisca sozinho.'),
  tr('Morava num chip apertado. A cachoeira, pra ele, é férias.'),
  tr('Tem o número de série tatuado na alma. Gosta de pedras redondas.'),
];
function creatureOf(seed) {
  const rnd = mulberry32((parseInt(seed.slice(0, 8), 16) ^ parseInt(seed.slice(8, 16), 16)) >>> 0);
  const pick = (l) => l[Math.floor(rnd() * l.length)];
  const [B, b] = pick(CR_COLORS);
  const A = pick(CR_COLORS.filter((c) => c[0] !== B))[0];
  const eyeC = pick(['#111111', '#e8342a', '#1a4ad0', '#2a8a3a']);
  // head shapes (half-width per row, 1-5), then a little noise on top
  const SHAPES = [[3, 4, 5, 5, 5, 5, 5, 5, 4, 5], [1, 2, 3, 4, 5, 5, 5, 5, 5, 5], [5, 5, 5, 5, 5, 5, 5, 5, 5, 5], [2, 4, 5, 4, 5, 5, 4, 5, 4, 5], [4, 5, 5, 5, 5, 4, 4, 5, 5, 5]];
  const width = pick(SHAPES).map((w, j) => (j < 2 ? clamp(w + Math.floor(rnd() * 3) - 1, 1, 5) : w));
  const g = width.map((w) => [0, 1, 2, 3, 4].map((i) => (4 - i < w ? 'B' : '.')));
  const body = (j, i) => j >= 0 && j < 10 && i >= 0 && i < 5 && g[j][i] !== '.';
  for (let j = 0; j < 10; j++) for (let i = 0; i < 5; i++) if (g[j][i] === 'B' && (!body(j - 1, i) || !body(j + 1, i) || !body(j, i - 1))) g[j][i] = 'o';
  for (let j = 1; j < 9; j++) for (let i = 1; i < 5; i++) if (g[j][i] === 'B' && rnd() < 0.12) g[j][i] = 'b';
  const deco = pick(['horns', 'antenna', 'ears', 'none']);
  const top = width.findIndex((w) => w >= 2);
  if (deco === 'horns' && top >= 1) g[top - 1][4 - width[top] + 1] = 'A';
  if (deco === 'antenna') { g[0][3] = 'A'; if (width[0] < 2) g[0][4] = '.'; }
  if (deco === 'ears' && width[3] === 5) { g[2][0] = 'A'; g[3][0] = 'A'; }
  // eyes: whites 2 px tall, the pupil (eyes) on the lower one
  const n = pick([1, 2, 2, 2, 3]);
  const eyes = n === 1 ? [[4, 4], [5, 4]] : n === 2 ? [[2, 4], [7, 4]] : [[1, 4], [8, 4], [4, 3], [5, 3]];
  for (const [x, y] of eyes) if (x < 5) { g[y][x] = 'W'; g[y - 1][x] = 'W'; }
  if (n === 2 && rnd() < 0.5) { g[3][3] = 'W'; g[4][3] = 'W'; } // big eyes
  const mouth = pick(['smile', 'teeth', 'open']);
  if (mouth === 'smile') { g[7][3] = 'M'; g[7][4] = 'M'; g[6][2] = 'M'; }
  else if (mouth === 'teeth') for (let i = 2; i < 5; i++) g[7][i] = i % 2 ? 'W' : 'M';
  else { g[6][3] = 'M'; g[6][4] = 'M'; g[7][3] = 'M'; g[7][4] = 'W'; }
  const rows = g.map((r) => r.join('') + [...r].reverse().join(''));
  const name = (pick(CR_SYL) + pick(CR_SYL) + (rnd() < 0.5 ? pick(CR_SYL) : '')).slice(0, 10);
  const pattern = Math.floor(rnd() * 4);
  return { name, rows, pal: { o: '#111111', B, b, A, W: '#ffffff', M: '#2a0a0a' }, eyes: eyes.filter(([, y]) => y === 4 || n === 3), eyeC, B, b, A, pattern, desc: pick(CR_DESC) };
}
function makeCreatureBarrel(c) {
  return drum(8, 1, '#111111', c.B, c.B, c.b, (i, j, rel, span, x0, x1) => {
    if (isEdge(i, j, x0, x1)) return undefined;
    if (j === 1) return c.b;
    const on = c.pattern === 0 ? Math.floor(j / 3) % 2 === 0 // stripes
      : c.pattern === 1 ? (i * 7 + j * 5) % 9 === 0 // spots
        : c.pattern === 2 ? Math.abs(((i + j) % 6) - 3) === j % 2 // zigzag
          : ((i >> 1) + (j >> 1)) % 2 === 0; // checks
    return on ? c.A : undefined;
  });
}

const BARREL_SKINS = [
  { id: 'classic', name: tr('BARRIL CLÁSSICO'), desc: tr('Madeira de lei com cheirinho de vinho velho.'), price: 0, make: () => makeBarrel(WOOD) },
  { id: 'radio', name: tr('BARRIL RADIOATIVO'), desc: tr('Brilha no escuro. Por favor, não lamba.'), price: null, ach: 'dark500', make: makeRadioactive, trail: 'radio' },
  { id: 'oil', name: tr('TAMBOR DE ÓLEO'), desc: tr('Deixa um rastro bem suspeito na água.'), price: null, ach: 'km20', make: makeOilDrum, trail: 'oil' },
  { id: 'keg', name: tr('BARRIL DE CHOPP'), desc: tr('Trincando de gelado, com dois dedos de espuma.'), price: null, ach: 'sextou', make: makeKeg, trail: 'foam' },
  { id: 'melon', name: tr('MELANCIA'), desc: tr('Oca por dentro, doce por fora. Cuidado com o caroço.'), price: 75, make: makeMelon, trail: 'melon' },
  { id: 'tank', name: tr('CAIXA D\'ÁGUA'), desc: tr('Mil litros de pura coragem. Tampa não inclusa.'), price: 120, make: makeWaterTank },
  { id: 'trash', name: tr('LATA DE LIXO'), desc: tr('Reciclar é bom. Descer cachoeira nela é melhor.'), price: 150, make: makeTrashCan },
  { id: 'duck', name: tr('PATINHO DE BORRACHA'), desc: tr('Quack. Só isso. Quack.'), price: 240, make: makeDuck, trail: 'duck' },
  { id: 'fridge', name: tr('GELADEIRA'), desc: tr('Tem um pote de sorvete lá dentro. É feijão.'), price: 300, make: makeFridge },
  { id: 'cooker', name: tr('PANELA DE PRESSÃO'), desc: tr('Psssssss! Feijão no ponto em 3 km.'), price: 400, make: makePressureCooker, trail: 'steam' },
  { id: 'box', name: tr('CAIXA DE PAPELÃO'), desc: tr('Esconderijo perfeito de agente secreto. Ninguém desconfia.'), price: 45, make: makeCardboard },
  { id: 'jug', name: tr('GALÃO DE ÁGUA'), desc: tr('20 litros de água mineral e um passageiro clandestino.'), price: 55, make: makeWaterJug },
  { id: 'cooler', name: tr('CAIXA DE ISOPOR'), desc: tr('Gelo, refri e um piloto. O kit praia completo.'), price: 70, make: makeCooler, trail: 'snow' },
  { id: 'toilet', name: tr('PRIVADA'), desc: tr('Deu descarga e veio parar aqui. Não pergunte.'), price: 105, make: makeToilet, trail: 'foam' },
  { id: 'orelhao', name: tr('ORELHÃO'), desc: tr('Liga a cobrar direto da cachoeira. Alô, mãe?'), price: 135, make: makeOrelhao },
  { id: 'cart', name: tr('CARRINHO DE MERCADO'), desc: tr('Saiu do estacionamento e ninguém mais segurou.'), price: 165, make: makeCart },
  { id: 'washer', name: tr('MÁQUINA DE LAVAR'), desc: tr('Centrifugação máxima: 1200 rpm de pura adrenalina.'), price: 320, make: makeWasher, trail: 'bubbles' },
  { id: 'phone', name: tr('CABINE TELEFÔNICA'), desc: tr('Vermelha, porque a azul é pra viajar no tempo.'), price: 360, make: makePhoneBox },
  { id: 'gold', name: tr('BARRIL DE OURO'), desc: tr('Pura ostentação. Se afunda? Ninguém sabe.'), price: null, ach: 'rich', make: () => makeBarrel(GOLD), trail: 'gold' },
  { id: 'armor', name: tr('BARRIL BLINDADO'), desc: tr('Chapa de aço e rebite. Pedra? Que pedra?'), price: null, ach: 'nohit500', make: makeArmor, trail: 'steam' },
  { id: 'generator', name: tr('GERADOR'), desc: tr('Carregou o celular e ganhou um gerador. A física não explica.'), price: null, ach: 'plugged', alt: 500, make: makeGenerator, trail: 'spark' },
  { id: 'bricks', name: tr('BARRIL DE BLOQUINHOS'), desc: tr('Montado peça por peça. Pisar descalço é proibido.'), price: 240, make: makeBricks, trail: 'rainbow' },
  { id: 'guide', name: tr('GUIA DE BOLSO DA GALÁXIA'), desc: tr('Na capa, letras grandes e amigáveis: NÃO ENTRE EM PÂNICO. Verbete "cachoeira": praticamente inofensiva.'), price: 42, make: makeGuide, trail: 'spark' },
  { id: 'cyborgb', name: tr('BARRIL EXTERMINADO'), desc: tr('Liga metálica de 2029 por baixo da madeira. Quebrou? Ele volta.'), price: 360, make: makeCyborgBarrel, trail: 'spark' },
  { id: 'mug', name: tr('CANECA DE CAFÉ'), desc: tr('Combustível oficial de quem programa. Já tá no terceiro refil.'), price: null, ach: 'daily30', make: makeMug, trail: 'steam' },
  { id: 'iceberg', name: tr('ICEBERG'), desc: tr('Só a pontinha aparece. O resto tá lá embaixo, esperando um navio.'), price: 135, make: makeIceberg, trail: 'snow' },
  { id: 'argentina', name: tr('BARRIL ARGENTINO'), desc: tr('Dizem que é o melhor barril do mundo. Quem diz são os argentinos.'), price: 100, make: () => makeFlag(FLAGS.argentina) },
  { id: 'portugal', name: tr('BARRIL PORTUGUÊS'), desc: tr('Descobriu a cachoeira em 1500 e chamou de sua. Ó pá!'), price: 100, make: () => makeFlag(FLAGS.portugal) },
  { id: 'japan', name: tr('BARRIL JAPONÊS'), desc: tr('Pontual: chega no fundo da cachoeira no segundo exato.'), price: 100, make: () => makeFlag(FLAGS.japan) },
  { id: 'italy', name: tr('BARRIL ITALIANO'), desc: tr('Mamma mia! Cheio de molho de tomate. Não pergunte.'), price: 100, make: () => makeFlag(FLAGS.italy) },
  { id: 'france', name: tr('BARRIL FRANCÊS'), desc: tr('Oui, oui. Vem com uma baguete escondida lá dentro.'), price: 100, make: () => makeFlag(FLAGS.france) },
  { id: 'germany', name: tr('BARRIL ALEMÃO'), desc: tr('Engenharia de precisão. Desce a cachoeira com manual de 400 páginas.'), price: 100, make: () => makeFlag(FLAGS.germany) },
  { id: 'mexico', name: tr('BARRIL MEXICANO'), desc: tr('Picante! A água ferve só de encostar.'), price: 100, make: () => makeFlag(FLAGS.mexico), trail: 'fire' },
  { id: 'usa', name: tr('BARRIL AMERICANO'), desc: tr('Tamanho família, com refil grátis de água da cachoeira.'), price: 100, make: () => makeFlag(FLAGS.usa) },
  { id: 'beta', name: tr('BARRIL BETA'), desc: tr('Versão 0.9: pode conter bugs, farpas e pedaços de pedra. Presente pra quem testou o jogo antes do lançamento.'), price: null, beta: true, make: makeBetaBarrel, trail: 'spark' },
  { id: 'blender', name: tr('LIQUIDIFICADOR'), desc: tr('Vitamina de banana batida na cachoeira. Chacoalha que fica melhor.'), price: null, ach: 'shake', alt: 360, make: makeBlender, trail: 'bubbles' },
  { id: 'dumont', name: tr('14-BARRIL'), desc: tr('Mais leve que o ar? Não. Mas voa baixinho até o fundo da cachoeira.'), price: null, ach: 'airplane', make: makeDumont, trail: 'steam' },
  { id: 'charcoal', name: tr('BARRIL DE CARVÃO'), desc: tr('Pegou fogo, você soprou, sobrou isso. Cheirinho de churrasco.'), price: null, ach: 'blowout', alt: 400, make: makeCharcoal, trail: 'smoke' },
  { id: 'champagne', name: tr('ESPUMANTE'), desc: tr('Pula sete ondas? Pula sete pedras. Feliz ano novo!'), price: null, ach: 'anonovo', make: makeChampagne, trail: 'gold' },
  { id: 'confetti', name: tr('BARRIL DE CONFETE'), desc: tr('Ô abre alas que o barril quer passar!'), price: null, ach: 'carnaval', make: makeConfetti, trail: 'rainbow' },
  { id: 'egg', name: tr('OVO DE PÁSCOA'), desc: tr('Chocolate ao leite com recheio de piloto. 300 g de puro risco.'), price: null, ach: 'pascoa', make: makeEgg, trail: 'easter' },
  { id: 'bonbon', name: tr('CAIXA DE BOMBOM'), desc: tr('Pra dar pro crush. Se sobrar algum depois da cachoeira.'), price: null, ach: 'namorados', make: makeBonbon, trail: 'hearts' },
  { id: 'corn', name: tr('ESPIGA DE MILHO'), desc: tr('Olha a cobra! É mentira! Olha a pedra! É verdade!'), price: null, ach: 'junina', make: makeCorn, trail: 'gold' },
  { id: 'grito', name: tr('BARRIL DO GRITO'), desc: tr('Às margens plácidas da cachoeira, um grito retumbante: AAAAAH!'), price: null, ach: 'sete', make: makeGrito, trail: 'brasil' },
  { id: 'toybox', name: tr('CAIXA DE BRINQUEDOS'), desc: tr('Guarda tudo menos o piloto. Esse foi passear.'), price: null, ach: 'criancas', make: makeToybox, trail: 'rainbow' },
  { id: 'pumpkin', name: tr('ABÓBORA'), desc: tr('Doces ou travessuras? Travessuras. Na cachoeira.'), price: null, ach: 'halloween', make: makePumpkin, trail: 'fire' },
  { id: 'gift', name: tr('PRESENTE'), desc: tr('Não abra antes do Natal. Nem depois, tem um piloto dentro.'), price: null, ach: 'natal', make: makeGift, trail: 'snow' },
  { id: 'pipe', name: tr('TUBO VERDE'), desc: tr('Dizem que quem entra por um cano desses sai em outra fase. Aqui sai na cachoeira mesmo.'), price: null, ach: 'coin100', make: makePipe, trail: 'gold' },
  // historical figures, rescue and professions
  { id: 'starry', name: tr('BARRIL ESTRELADO'), desc: tr('Pintado numa noite só, de um quarto com vista pra cachoeira. Vale milhões. Não molha.'), price: null, ach: 'vangogh', make: makeStarry, trail: 'gold' },
  { id: 'cubist', name: tr('BARRIL CUBISTA'), desc: tr('Visto de frente, de lado e de cima ao mesmo tempo. Qual lado vai pra baixo? Sim.'), price: null, ach: 'picasso', make: makeCubist, trail: 'rainbow' },
  { id: 'piano', name: tr('PIANO DE CAUDA'), desc: tr('Afinado em dó maior. Depois da cachoeira, afinado em dó de mim.'), price: null, ach: 'mozart', make: makePiano, trail: 'notes' },
  { id: 'monalisa', name: tr('MONA LISA'), desc: tr('Ela sorri? Ela tá com medo? Ninguém sabe. Ela olha pra você em qualquer pedra.'), price: null, ach: 'davinci', make: makeMonaLisa },
  { id: 'raft', name: tr('BOTE INFLÁVEL'), desc: tr('Bote de resgate da Defesa Civil. Colete obrigatório, juízo opcional.'), price: null, ach: 'stormsafe', make: makeRaft, trail: 'foam' },
  { id: 'police', name: tr('VIATURA'), desc: tr('Giroflex ligado e sirene no talo. Encosta a cachoeira aí!'), price: null, ach: 'cleanrec', make: makePolice, trail: 'siren' },
  { id: 'hydrant', name: tr('HIDRANTE'), desc: tr('Água é o que não falta por aqui. Mesmo assim, ele veio.'), price: null, ach: 'firefight', make: makeHydrant, trail: 'foam' },
  { id: 'ambulance', name: tr('AMBULÂNCIA'), desc: tr('Sirene, maca e uma prancheta. Pede pro piloto dizer "aaa".'), price: null, ach: 'doctor', make: makeAmbulance, trail: 'siren' },
  { id: 'arcade', name: tr('FLIPERAMA'), desc: tr('Uma ficha, uma vida, nenhum continue. Igual à cachoeira.'), price: null, ach: 'nopause', make: makeArcade, trail: 'spark' },
  { id: 'bag', name: tr('BAG DE ENTREGA'), desc: tr('Pedido saiu pra entrega. Previsão: depois da cachoeira.'), price: 105, make: makeDeliveryBag },
  { id: 'chest', name: tr('BAÚ DE PRÊMIOS'), desc: tr('Abre a porta da esperança! Dentro tem moedas, um carnê e um piloto.'), price: null, ach: 'milton', make: makePrizeChest, trail: 'gold' },
  { id: 'coffin', name: tr('CAIXÃO'), desc: tr('Todo vilão tem um. Esse aqui boia, e tem estofado de veludo.'), price: 260, make: makeCoffin, trail: 'ghost' },
  { id: 'camp', name: tr('BARRIL DO ACAMPAMENTO'), desc: tr('Achado no fundo do lago do acampamento. Tem um 13 pintado. Ninguém sabe quem pintou.'), price: null, ach: 'jackson', make: makeCampBarrel, trail: 'smoke' },
  { id: 'temple', name: tr('TEMPLO PERDIDO'), desc: tr('Pedra milenar com um ídolo de ouro. Se alguém trocar o ídolo por um saco de areia, corre.'), price: 240, make: makeTemple, trail: 'gold' },
  { id: 'coil', name: tr('BOBINA ELÉTRICA'), desc: tr('Energia sem fio pra cachoeira inteira. Não encoste. Sério.'), price: null, ach: 'tesla', make: makeCoil, trail: 'spark' },
  { id: 'analytic', name: tr('MÁQUINA ANALÍTICA'), desc: tr('Engrenagens de latão e cartões perfurados. O primeiro computador também desce cachoeira.'), price: null, ach: 'ada', make: makeAnalytical, trail: 'gold' },
  { id: 'tortoise', name: tr('CASCO DE TARTARUGA'), desc: tr('Veio de uma ilha bem longe. Devagar e sempre, até o fundo da cachoeira.'), price: null, ach: 'darwin', make: makeTortoise },
  { id: 'chalkboard', name: tr('QUADRO NEGRO'), desc: tr('Moldura de madeira e uma conta no giz. Vai cair na prova.'), price: null, ach: 'professor', make: makeChalkboard },
  { id: 'grill', name: tr('CHURRASQUEIRA'), desc: tr('Brasa acesa, picanha no ponto e fumaça pro rio inteiro. Sábado é sábado.'), price: null, ach: 'wkday', make: makeGrill, trail: 'smoke' },
  { id: 'flamingo', name: tr('BOIA DE FLAMINGO'), desc: tr('Rosa, inflável e totalmente inadequada pra uma cachoeira. Perfeita.'), price: null, ach: 'wkfull', make: makeFlamingo, trail: 'hearts' },
  { id: 'debug', name: tr('BARRIL DE DEBUG'), desc: tr('Tem um breakpoint na linha 9. Se travar, é feature.'), price: null, ach: 'devmode', make: makeDebugBarrel, trail: 'spark' },
  { id: 'chatbubble', name: tr('BALÃO DE MENSAGEM'), desc: tr('Visualizou e não respondeu. Desceu a cachoeira pra fugir do grupo da família.'), price: null, ach: 'share_zap', alt: 240, make: makeChatBubble, trail: 'hearts' },
  { id: 'filter', name: tr('BARRIL COM FILTRO'), desc: tr('Sem filtro ninguém posta. Com filtro, até barril fica bonito.'), price: null, ach: 'share_ig', alt: 240, make: makeFilterBarrel, trail: 'hearts' },
  { id: 'paperplane', name: tr('AVIÃO DE PAPEL'), desc: tr('Dobrado na aula de matemática e lançado direto na cachoeira.'), price: null, ach: 'share_tg', alt: 240, make: makePaperPlane, trail: 'snow' },
  { id: 'phonebarrel', name: tr('CELULAR GIGANTE'), desc: tr('Notificação de 47 apps e 3% de bateria. Ainda bem que é à prova d’água.'), price: null, ach: 'share3', alt: 300, make: makePhoneBarrel, trail: 'spark' },
  { id: 'envelope', name: tr('ENVELOPE'), desc: tr('Convite selado com cera. Seu amigo abriu, e agora vocês descem juntos.'), price: null, ach: 'invite1', make: makeEnvelope, trail: 'hearts' },
  { id: 'welcome', name: tr('CESTA DE BOAS-VINDAS'), desc: tr('Presente de quem te convidou: fruta, flor e um laço. Bem-vindo à cachoeira!'), price: null, ach: 'invited', make: makeWelcomeBasket, trail: 'easter' },
  { id: 'lava', name: tr('BARRIL VULCÂNICO'), desc: tr('Forjado no fundo da cachoeira por quem desceu 1000 m no DIFÍCIL.'), price: null, ach: 'hard1000', make: makeLava, trail: 'fire' },
  // matching barrels for riders that had none
  { id: 'bluescreen', name: tr('TELA AZUL'), desc: tr('Ocorreu um problema e o barril precisa ser reiniciado. 17% concluído. Não desligue a cachoeira.'), price: 300, make: makeBlueScreen, trail: 'spark' },
  { id: 'pear', name: tr('BARRIL DA PERA'), desc: tr('Branco, liso e sem botão nenhum. Na tampa, uma pera. Maçã era muito óbvio.'), price: 300, make: makePear },
  { id: 'rocket', name: tr('FOGUETE'), desc: tr('3, 2, 1... cachoeira! Era pra ir pra Lua, mas o GPS mandou descer.'), price: 165, make: makeRocket, trail: 'fire' },
  { id: 'bamboo', name: tr('TRONCO DE BAMBU'), desc: tr('Oco, leve e silencioso. Ninguém repara num bambu descendo o rio.'), price: 75, make: makeBamboo },
  { id: 'cloud', name: tr('NUVEM'), desc: tr('Fofinha, com uma auréola em cima. Chove um pouquinho quando bate na pedra.'), price: 150, make: makeCloud, trail: 'snow' },
  { id: 'log', name: tr('TRONCO OCO'), desc: tr('Achado no meio da mata, com musgo e tudo. A foto dele também sai borrada.'), price: 135, make: makeLog },
  { id: 'rum', name: tr('BARRIL DE RUM'), desc: tr('Madeira escura e uma caveira na frente. Por que o rum sempre acaba? Caiu na cachoeira.'), price: 120, make: makeRum },
  // Chaplolin and the slimming pen
  { id: 'mallet', name: tr('MARRETA BIÔNICA'), desc: tr('Faz pó-pó-pó em cada pedra. Não machuca, mas a pedra fica ofendida.'), price: null, ach: 'astucia', make: makeMallet, trail: 'hearts' },
  { id: 'pen', name: tr('CANETA MOUNJA-RIO'), desc: tr('A canetinha da moda, tamanho barril. Uma dose por semana e uma cachoeira por dia.'), price: null, ach: 'mounja', make: makePen, trail: 'bubbles' },
  // football: club colours
  { id: 'mengao', name: tr('BARRIL MENGÃO'), desc: tr('Listras vermelhas e pretas. A maior torcida da cachoeira canta em cada pedra desviada.'), price: 120, make: () => makeFlag(TEAMS.mengao) },
  { id: 'flu', name: tr('BARRIL TRICOLOR CARIOCA'), desc: tr('Grená, verde e branco. Elegância até na hora de bater na pedra.'), price: 120, make: () => makeFlag(TEAMS.flu) },
  { id: 'colina', name: tr('BARRIL GIGANTE DA COLINA'), desc: tr('Preto com a faixa diagonal. Gigante na colina, gigante na cachoeira.'), price: 120, make: () => makeFlag(TEAMS.colina) },
  { id: 'estrela', name: tr('BARRIL DA ESTRELA SOLITÁRIA'), desc: tr('Listras alvinegras e uma estrela pra guiar a descida no escuro.'), price: 120, make: () => makeFlag(TEAMS.estrela) },
  { id: 'timao', name: tr('BARRIL TIMÃO'), desc: tr('Branco e preto, com o bando de loucos cantando na margem. Vai, barril!'), price: 120, make: () => makeFlag(TEAMS.timao) },
  { id: 'verdao', name: tr('BARRIL VERDÃO'), desc: tr('Verde da tampa ao fundo, que nem o mato da beira do rio. Avanti, barril!'), price: 120, make: () => makeFlag(TEAMS.verdao) },
  { id: 'tricolorsp', name: tr('BARRIL TRICOLOR PAULISTA'), desc: tr('Branco com a faixa vermelha e preta. Soberano até na correnteza.'), price: 120, make: () => makeFlag(TEAMS.tricolorsp) },
  { id: 'peixe', name: tr('BARRIL PEIXE'), desc: tr('Branquinho, com um peixe no meio. Na cachoeira, o peixe nada de braçada.'), price: 120, make: () => makeFlag(TEAMS.peixe) },
  { id: 'imortal', name: tr('BARRIL IMORTAL TRICOLOR'), desc: tr('Azul, preto e branco. Quebra o barril e continua torcendo.'), price: 120, make: () => makeFlag(TEAMS.imortal) },
  { id: 'colorado', name: tr('BARRIL COLORADO'), desc: tr('Vermelho dos pés à tampa. Colorado de coração, molhado da cabeça aos pés.'), price: 120, make: () => makeFlag(TEAMS.colorado) },
  { id: 'raposa', name: tr('BARRIL DA RAPOSA'), desc: tr('Azul com as estrelas do Cruzeiro do Sul, pra não se perder no rio.'), price: 120, make: () => makeFlag(TEAMS.raposa) },
  { id: 'galo', name: tr('BARRIL DO GALO'), desc: tr('Listras pretas e brancas e um grito de GALO a cada pedra desviada.'), price: 120, make: () => makeFlag(TEAMS.galo) },
  { id: 'esquadrao', name: tr('BARRIL ESQUADRÃO DE AÇO'), desc: tr('Azul, vermelho e branco. Barril de aço que não enferruja nem na cachoeira.'), price: 120, make: () => makeFlag(TEAMS.esquadrao) },
  // diamond-only (BANCO)
  { id: 'diamondb', name: tr('BARRIL DE DIAMANTE'), desc: tr('Lapidado à mão, brilha até debaixo da cachoeira. Quebra? Diamante não quebra. Lasca.'), price: null, gems: 15, make: makeDiamondBarrel, trail: 'spark' },
  { id: 'rainbowb', name: tr('BARRIL ARCO-ÍRIS'), desc: tr('Pintado com o óleo que o unicórnio deixa no rio. Brilha mais que a cachoeira.'), price: null, ach: 'rainbow', make: makeRainbowBarrel, trail: 'rainbow' },
  { id: 'b1901', name: tr('BARRIL DE 1901'), desc: tr('Carvalho, cintas de ferro e um colchão dentro, igual ao da primeira descida da história. Só faltou a gata.'), price: null, ach: 'annie', make: makeBarrel1901, trail: 'foam' },
  { id: 'tweed', name: tr('BARRIL DE TWEED'), desc: tr('Xadrez inglês, lupa de latão e cheiro de cachimbo. Elementar.'), price: null, gems: 6, make: makeTweed, trail: 'smoke' },
  { id: 'starball', name: tr('BOLA DE ESTRELA'), desc: tr('Amarela, faixa azul, estrela vermelha. Quica nas pedras e ninguém sabe de quem é.'), price: 135, make: makeStarBall, trail: 'spark' },
  { id: 'umbrella', name: tr('BARRIL DO GUARDA-CHUVA'), desc: tr('Crianças, essa é a história de como eu desci a cachoeira. Vai levar nove temporadas.'), price: 150, make: makeUmbrellaBarrel, trail: 'bubbles' },
  { id: 'motorhome', name: tr('MOTORHOME'), desc: tr('Velho, bege e com cheiro de laboratório. Ninguém pergunta o que tem lá dentro.'), price: null, gems: 8, make: makeMotorhome, trail: 'steam' },
  { id: 'hatch', name: tr('ESCOTILHA'), desc: tr('Achou no meio da ilha. Aperta o botão a cada 108 minutos, senão a cachoeira acaba.'), price: null, ach: 'numeros', make: makeHatch, trail: 'smoke' },
  { id: 'gamebarrel', name: tr('BARRIL DO JOGO'), desc: tr('Rosa, com ○ △ □. Se mexer na hora errada... é só um barril, relaxa.'), price: 240, make: makeGameBarrel, trail: 'spark' },
  { id: 'vault', name: tr('COFRE'), desc: tr('Lá dentro tem moeda de cachoeira até o teto. O plano é perfeito, só falta o barril não quebrar.'), price: null, gems: 10, make: makeVault, trail: 'gold' },
  { id: 'throne', name: tr('TRONO DE ESPADAS'), desc: tr('Feito com as espadas dos inimigos. Confortável? Não. Imponente? Muito.'), price: null, ach: 'inverno', make: makeThrone, trail: 'snow' },
  { id: 'quantum', name: tr('BARRIL QUÂNTICO'), desc: tr('Está inteiro e quebrado ao mesmo tempo, até alguém olhar. Bazin... barril!'), price: 150, make: makeQuantum, trail: 'magic' },
  { id: 'vaso', name: tr('VASO DE FLORES'), desc: tr('Toda mãe tem um. Esse desce a cachoeira e ainda chega regado.'), price: null, ach: 'maes', make: makeFlowerPot, trail: 'easter' },
  { id: 'toolbox', name: tr('CAIXA DE FERRAMENTAS'), desc: tr('Tem chave de tudo, menos a que você precisa. Pavê ou pacaixa?'), price: null, ach: 'pais', make: makeToolbox, trail: 'spark' },
  { id: 'neon', name: tr('BARRIL NEON'), desc: tr('Pisca em rosa e azul, a noite inteira. A cachoeira virou balada.'), price: null, gems: 10, make: makeNeonBarrel, trail: 'rainbow' },
  // from codes (hidden until redeemed)
  // heroes and the atomic physicist
  { id: 'teia', name: tr('BARRIL DE TEIA'), desc: tr('Vermelho, azul e todo enrolado em teia. Gruda em tudo, menos na água.'), price: null, ach: 'aranha', make: makeWebBarrel },
  { id: 'batbarril', name: tr('BATI-BARRIL'), desc: tr('Preto, blindado e com cinto de utilidades. Tem até um gancho, que não serve pra nada aqui.'), price: null, gems: 12, make: makeBatBarrel, trail: 'smoke' },
  { id: 'dispositivo', name: tr('O DISPOSITIVO'), desc: tr('Esfera de metal cheia de fios. Ninguém sabe o que acontece se bater numa pedra. Melhor não descobrir.'), price: null, ach: 'fechahaimer', make: makeDevice, trail: 'spark' },
  // TV hosts (parodies)
  { id: 'nave', name: tr('NAVE DOS BAIXINHOS'), desc: tr('Nave cor-de-rosa com cúpula de vidro e luzinhas piscando. Pousa na cachoeira toda manhã, depois do desenho.'), price: null, ach: 'chachu', make: makeShip, trail: 'rainbow' },
  { id: 'taxi', name: tr('VOU DE TÁXI'), desc: tr('Amarelinho, com placa no teto e o taxímetro rodando. A bandeirada é cara, mas a corrida é inesquecível.'), price: null, ach: 'anjelica', make: makeTaxi, trail: 'gold' },
  // myths: Greek gods and Brazilian folklore
  { id: 'coracao', name: tr('CORAÇÃO FLECHADO'), desc: tr('Um coração vermelho atravessado por uma flecha dourada. Desce a cachoeira apaixonado.'), price: null, ach: 'cupido', make: makeHeart, trail: 'hearts' },
  { id: 'olimpo', name: tr('COLUNA DO OLIMPO'), desc: tr('Mármore branquinho com um raio de ouro. Veio direto do topo da montanha dos deuses.'), price: null, ach: 'zeus', make: makeOlympus, trail: 'spark' },
  { id: 'concha', name: tr('CONCHA DO MAR'), desc: tr('Concha gigante cor de pêssego. Encoste o ouvido: dá pra ouvir a cachoeira.'), price: null, gems: 10, make: makeShell, trail: 'foam' },
  { id: 'estatua', name: tr('ESTÁTUA DE PEDRA'), desc: tr('Alguém olhou nos olhos errados. Agora é um barril de pedra rachada com uma cobra esculpida.'), price: 280, make: makeStatue, trail: 'smoke' },
  { id: 'redemoinho', name: tr('REDEMOINHO'), desc: tr('Um rodamoinho de poeira e folhas. Se aparecer um gorro vermelho rodando, já sabe quem é.'), price: null, ach: 'saci', make: makeWhirl, trail: 'smoke' },
  { id: 'vitoriaregia', name: tr('VITÓRIA-RÉGIA'), desc: tr('Folha gigante do rio com uma flor cor-de-rosa em cima. Flutua que é uma beleza.'), price: null, ach: 'iara', make: makeLily, trail: 'bubbles' },
  { id: 'boitata', name: tr('BOITATÁ'), desc: tr('A cobra de fogo que protege a mata, enrolada em forma de barril. Não apaga nem na cachoeira.'), price: null, ach: 'curupira', make: makeBoitata, trail: 'fire' },
  // phone extras (steps, light)
  { id: 'squeeze', name: tr('GARRAFINHA'), desc: tr('Squeeze de academia, meio cheia. Hidratação em primeiro lugar, cachoeira em segundo.'), price: null, ach: 'steps10k', alt: 300, make: makeSqueeze, trail: 'bubbles' },
  { id: 'vagalume', name: tr('VAGALUME'), desc: tr('Pisca no escuro e ilumina o caminho entre as pedras. Bateria? Biológica.'), price: null, ach: 'escuro', alt: 240, make: makeFirefly, trail: 'gold' },
  { id: 'guardasol', name: tr('GUARDA-SOL'), desc: tr('Listrado, de praia, com franjinha. Protege do sol, não das pedras.'), price: null, ach: 'solzao', alt: 240, make: makeUmbrella },
  // sensor tricks, lightning and labels
  { id: 'piao', name: tr('PIÃO'), desc: tr('O pião da casa própria, de madeira e listrado. Gira, gira e cai na cachoeira.'), price: null, ach: 'piao', alt: 200, make: makeTop, trail: 'rainbow' },
  { id: 'classea', name: tr('BARRIL CLASSE A'), desc: tr('Etiqueta de energia nota A. Gasta pouco, desce muito.'), price: null, ach: 'battfull', alt: 160, make: makeClassA, trail: 'spark' },
  { id: 'pilha', name: tr('PILHA FRACA'), desc: tr('Só sobrou um tracinho vermelho de carga. Segura até o fim da descida, por favor.'), price: null, ach: 'battlow', alt: 160, make: makeBattery, trail: 'siren' },
  { id: 'farol', name: tr('FAROL'), desc: tr('Vermelho e branco, com a luz acesa. Nenhuma neblina esconde a pedra dele.'), price: null, ach: 'torchfog', alt: 220, make: makeLighthouse, trail: 'holy' },
  { id: 'chuveiro', name: tr('CHUVEIRO ELÉTRICO'), desc: tr('Branquinho, com a chave no INVERNO. Dá choque se mexer molhado, então não mexe.'), price: null, ach: 'raio', make: makeShower, trail: 'steam' },
  { id: 'certificado', name: tr('BARRIL CERTIFICADO'), desc: tr('Passou em 47 testes de qualidade. Nenhum deles tinha cachoeira.'), price: null, ach: 'impacto', make: makeCertified },
  { id: 'altoem', name: tr('BARRIL ALTO EM'), desc: tr('ALTO EM PEDRAS, ALTO EM ÁGUA, ALTO EM ADRENALINA. Consumo moderado. Pode conter traços de cachoeira.'), price: 220, make: makeHighIn, trail: 'foam' },
  { id: 'matrix', name: tr('CHUVA DE CÓDIGO'), desc: tr('Preto, com letrinhas verdes caindo sem parar. Quem olha muito tempo começa a ver a cachoeira em código.'), price: null, ach: 'escolhido', make: makeCodeRain, trail: 'code' },
  { id: 'camera', name: tr('CÂMERA LAMBE-LAMBE'), desc: tr('Caixa de madeira, sanfona e lente de latão. A única câmera que já tirou foto nítida do monstro do lago.'), price: null, ach: 'printnitida', alt: 260, make: makeOldCamera, trail: 'smoke' },
  { id: 'disco', name: tr('DISCO VOADOR'), desc: tr('Cúpula de vidro, luzinhas girando e um raio trator desligado. Pousou na cachoeira pra tirar foto.'), price: null, ach: 'printufo', alt: 260, make: makeSaucer, trail: 'spark' },
  // movie and cartoon parodies
  { id: 'pericia', name: tr('MALETA DE PERÍCIA'), desc: tr('Alumínio, fita de evidência e uma lupa pra cada gota. Tudo catalogado, nada fora do lugar.'), price: null, ach: 'respingos', make: makeForensicCase },
  { id: 'bioluz', name: tr('BARRIL BIOLUMINESCENTE'), desc: tr('Madeira azul-noite com cipós que brilham no escuro. Plantado numa lua bem longe daqui.'), price: 260, make: makeGlowBarrel, trail: 'spark' },
  { id: 'esfera', name: tr('ESFERA DO DRAGÃO'), desc: tr('Laranja, de cristal, com quatro estrelas dentro. Junta as sete e pede um barril novo.'), price: null, ach: 'esferas', make: makeDragonBall, trail: 'gold' },
  { id: 'portal', name: tr('PORTAL VERDE'), desc: tr('Um rodamoinho verde que leva pra outra dimensão. Nessa dimensão, a cachoeira desce pra cima.'), price: null, ach: 'portal', make: makePortal, trail: 'radio' },
  { id: 'azeite', name: tr('AZEITE DA FAMÍLIA'), desc: tr('Lata de azeite importado da Sicília. A família cuida dos negócios, o azeite cuida da salada.'), price: null, ach: 'irrecusavel', make: makeOliveTin },
  { id: 'elfo', name: tr('BARRIL DOS ELFOS'), desc: tr('Carvalho, aros de prata e uma folha élfica. Já desceu um rio inteiro com um anão dentro.'), price: null, ach: 'naopassar', make: makeElvenBarrel, trail: 'holy' },
  { id: 'sabaob', name: tr('SABONETE'), desc: tr('Rosa, cheiroso e feito de um jeito que ninguém deve perguntar. Escorrega na mão e na cachoeira.'), price: null, ach: 'insonia', make: makeSoapBar, trail: 'bubbles' },
  { id: 'verme', name: tr('VERME DA AREIA'), desc: tr('Enorme, cheio de dentes e com cheiro de canela. Veio do deserto porque ouviu falar de tanta água.'), price: null, ach: 'duna', make: makeSandworm, trail: 'smoke' },
  // LENDÁRIO: the most expensive diamond skins
  { id: 'galaxia', name: tr('BARRIL GALÁCTICO'), desc: tr('Uma nebulosa inteira presa nos aros de ouro, com planeta e tudo. LENDÁRIO: poucos já viram um descer.'), price: null, gems: 35, legend: true, make: makeGalaxy, trail: 'stars' },
  { id: 'codecon', name: tr('BARRIL CODECON'), desc: tr('Feito em Joinville, desde 2019. Por dentro é só café e código. Nós falamos dev fluentemente.'), price: null, hidden: true, make: makeCodeconBarrel, trail: 'spark' },
];

// Rider heads. rows: palette chars ('.' = clear); eyes: [x, y] pixels drawn in eyeC and shifted
// sideways by the "look" direction; hand: colour of the hands gripping the rim.
const RIDER_SKINS = [
  {
    id: 'classic', name: tr('TURISTA DE CAPA'), desc: tr('Capa amarela de R$ 15 comprada na lojinha.'), price: 0,
    rows: RIDER_ROWS,
    pal: { Y: '#ffd23f', y: '#d9a514', h: '#fff3a0', o: '#2a2108', s: '#f1c27d' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#f1c27d',
  },
  {
    id: 'cat', name: tr('GATO LARANJA'), desc: tr('Odeia água. Ama adrenalina. Vai entender.'), price: 30,
    rows: ['o........o', 'oPo....oPo', 'oPPooooPPo', 'oCCCCCCCCo', 'oCcCCCCcCo', 'oCCCCCCCCo', 'oCCCCCCCCo', 'oWCCnnCCWo', 'oCCCCCCCCo', '.oooooooo.'],
    pal: { o: '#3a1f08', P: '#ff9fb0', C: '#f08a24', c: '#b85c10', n: '#ff7a9a', W: '#ffffff' },
    eyes: [[3, 6], [6, 6]], eyeC: '#1a1a1a', hand: '#f08a24',
  },
  {
    id: 'pirate', name: tr('PIRATA'), desc: tr('Perdeu o navio, sobrou o barril. Arrr!'), price: 45,
    rows: ['...oooo...', '..oRRRRo..', '.oRRWRRRo.', 'oRRRRRRRRo', 'osssssssso', 'okksssssso', 'okksssssso', 'osssssssso', '.obbbbbbo.'],
    pal: { o: '#2a1606', R: '#c81e1e', W: '#ffffff', s: '#e0ac69', k: '#111111', b: '#5a3416' },
    eyes: [[6, 6]], eyeC: '#111111', hand: '#e0ac69',
  },
  {
    id: 'ninja', name: tr('NINJA'), desc: tr('Tão silencioso que ninguém viu ele cair.'), price: null, ach: 'mute',
    rows: ['...oooo...', '..oNNNNo..', '.oNNNNNNo.', 'oRRRRRRRRo', 'oNNNNNNNNo', 'oNssssssNo', 'oNNNNNNNNo', 'oNNNNNNNNo', '.oNNNNNNo.'],
    pal: { o: '#0a0a0a', N: '#22252b', R: '#d62828', s: '#e0ac69' },
    eyes: [[3, 5], [6, 5]], eyeC: '#111111', hand: '#22252b',
  },
  {
    id: 'clown', name: tr('PALHAÇO'), desc: tr('O circo pegou fogo e ele pulou na cachoeira.'), price: null, ach: 'carnaval',
    rows: ['.GGBBYYRR.', 'GGBBYYRRGG', 'GBoWWWWoRY', 'BoWWWWWWoR', 'BoWWWWWWoR', 'oWWbWWbWWo', 'oWWWWWWWWo', 'oWWWNNWWWo', 'oWRRRRRRWo', '.oWWWWWWo.'],
    pal: { G: '#3ddc5a', B: '#3d8fe0', Y: '#ffd23f', R: '#e8434f', o: '#2a2108', W: '#f8f4ec', b: '#3d8fe0', N: '#ff2a2a' },
    eyes: [[3, 6], [6, 6]], eyeC: '#1a1a1a', hand: '#f8f4ec',
  },
  {
    id: 'viking', name: tr('VIKING'), desc: tr('Já desceu fiordes piores que isso aqui.'), price: 105,
    rows: ['H........H', 'HH.oooo.HH', '.HoMMMMoH.', '.oMMLMMMo.', 'oMMMMMMMMo', 'oNNNNNNNNo', 'osssssssso', 'oOssssssOo', 'OOOOmmOOOO', '.OOOOOOOO.', '..O.OO.O..'],
    pal: { H: '#f3e6c8', o: '#22262c', M: '#9aa3ae', L: '#e6ebf0', N: '#5d6670', s: '#f1c27d', O: '#d9761c', m: '#7a1d1d' },
    eyes: [[3, 6], [6, 6]], eyeC: '#1a1a1a', hand: '#f1c27d',
  },
  {
    id: 'robot', name: tr('ROBÔ'), desc: tr('À prova d’água? O manual diz que sim.'), price: 135,
    rows: ['....RR....', '....kk....', 'oooooooooo', 'oLMMMMMMMo', 'oMMMMMMMMo', 'oMDDDDDDMo', 'oMDDDDDDMo', 'oMMMMMMMMo', 'oMkMkMkMMo', 'oMMMMMMMMo', 'oooooooooo'],
    pal: { R: '#ff3b3b', k: '#2b3038', o: '#1b1f26', L: '#e6ebf0', M: '#9aa3ae', D: '#1b2a33' },
    eyes: [[3, 6], [6, 6]], eyeC: '#3df2ff', hand: '#9aa3ae',
  },
  {
    id: 'astro', name: tr('ASTRONAUTA'), desc: tr('Errou a órbita e caiu bem nas cataratas.'), price: 165,
    rows: ['...oooo...', '..oWWWWo..', '.oWWWWWWo.', 'oWWWWWWWWo', 'oWVVVVVVWo', 'oWVLVVVVWo', 'oWVVVVVVWo', 'oWWWWWWWWo', 'oGWWWWWWRo'],
    pal: { o: '#2b3340', W: '#eef2f6', V: '#1b2a4a', L: '#9fd8ff', G: '#3dff6e', R: '#ff3b3b' },
    eyes: [[3, 6], [6, 6]], eyeC: '#7fd3ff', hand: '#eef2f6',
  },
  {
    id: 'dino', name: tr('DINOSSAURO'), desc: tr('Sobreviveu ao meteoro. Agora quer emoção.'), price: 260,
    rows: ['...S..S...', '..oSooSo..', '.oddddddo.', 'oddddddddo', 'odLddddddo', 'oddddddddo', 'oddddddddo', 'oddnddnddo', 'okkkkkkkko', '.oWdWdWdo.', '..oooooo..'],
    pal: { S: '#ff8a1c', o: '#163d12', d: '#4caf50', L: '#9be07a', n: '#163d12', k: '#3a0d0d', W: '#ffffff' },
    eyes: [[3, 5], [6, 5]], eyeC: '#111111', hand: '#4caf50',
  },
  {
    id: 'et', name: tr('ET'), desc: tr('Atravessou a galáxia só pra descer essa cachoeira.'), price: 320,
    rows: ['.a......a.', '..k....k..', '...oggo...', '..oggggo..', '.oggLgggo.', 'oggggggggo', 'oggggggggo', 'oggggggggo', '.oggmmggo.', '..oggggo..', '...oooo...'],
    pal: { a: '#c8ff8a', k: '#2f6b1f', o: '#1d3b12', g: '#7ed957', L: '#c8ff8a', m: '#2f6b1f' },
    eyes: [[2, 6], [3, 6], [6, 6], [7, 6], [3, 7], [6, 7]], eyeC: '#0a0a0a', hand: '#7ed957',
  },
  {
    id: 'santa', name: tr('PAPAI NOEL'), desc: tr('Trenó na oficina, veio de barril mesmo. Ho ho ho!'), price: null, ach: 'natal',
    rows: ['.......WW.', '......rWW.', '....rrr...', '...rrrrr..', '..rrrrrrr.', '.WWWWWWWW.', '.WssssssW.', '.osssssso.', '.WssppssW.', 'WWWWWWWWWW', 'WWWWmmWWWW', '.WWWWWWWW.', '...WWWW...'],
    pal: { r: '#d62828', W: '#f4f4f4', s: '#f1c27d', o: '#2a2108', p: '#e8897a', m: '#7a1d1d' },
    eyes: [[3, 7], [6, 7]], eyeC: '#1a1a1a', hand: '#f4f4f4', trail: 'snow',
  },
  // ---- folklore & legends ----
  {
    id: 'witch', name: tr('BRUXA'), desc: tr('Vassoura quebrou. Barril serve. Abracadabarril!'), price: null, ach: 'halloween', monster: true,
    rows: ['......o...', '.....oKo..', '....oKKo..', '....oKKKo.', '...oKKKKo.', '...oPPPPo.', 'KKKKKKKKKK', 'Hogggggggo', 'Hogggggggo', 'HogggGGggo', 'Hogggggggo', '.oggmmggo.', '..oooooo..'],
    pal: { o: '#140b1c', K: '#2a1838', P: '#9b4dca', g: '#8fd16a', G: '#5e9e3e', m: '#3a0d0d', H: '#e8742a' },
    eyes: [[3, 8], [6, 8]], eyeC: '#1a1a1a', hand: '#8fd16a', trail: 'magic',
  },
  {
    id: 'unicorn', name: tr('UNICÓRNIO'), desc: tr('Deixa um rastro de óleo arco-íris. Exclusivo, chique e poluente.'), price: 600,
    rows: ['....y.....', '....Yy....', '...yYY....', '.ooWWWWoR.', 'oWWWWWWWRO', 'oWWWWWWWOY', 'oWWWWWWWYG', 'oWWWWWWWGB', 'oWWWWWWWBo', '.oPWWWWPo.', '..oooooo..'],
    pal: { o: '#4a3a5a', W: '#fbf7ff', Y: '#ffd23f', y: '#d9a514', R: '#ff4d6d', O: '#ff9f1c', G: '#3ddc5a', B: '#3d8fe0', P: '#ffb3c6' },
    eyes: [[3, 5], [6, 5]], eyeC: '#3a1f5a', hand: '#fbf7ff', trail: 'rainbow',
  },
  {
    id: 'vampire', name: tr('VAMPIRO'), desc: tr('Só desce a cachoeira à noite. Protetor solar fator 1000.'), price: null, ach: 'night', monster: true,
    rows: ['..oooooo..', '.oHHHHHHo.', 'oHHHHHHHHo', 'oHssHHssHo', 'oHssssssHo', 'osssssssso', 'osssssssso', 'osskkkksso', 'CosWssWsoC', 'CC.oooo.CC'],
    pal: { o: '#120d16', H: '#1b1422', s: '#e8e4f0', k: '#5a0d16', W: '#ffffff', C: '#b3122e' },
    eyes: [[3, 5], [6, 5]], eyeC: '#d61f1f', hand: '#e8e4f0',
  },
  {
    id: 'wolf', name: tr('LOBISOMEM'), desc: tr('Sétimo filho, sexta-feira, lua cheia e um barril.'), price: 135, monster: true,
    rows: ['o........o', 'oFo....oFo', 'oFFooooFFo', 'oFFFFFFFFo', 'oFfFFFFfFo', 'oFFFFFFFFo', 'oFFFFFFFFo', 'oFFLLLLFFo', 'oFFLkkLFFo', 'oFWLLLLWFo', '.oooooooo.'],
    pal: { o: '#1e1712', F: '#6b5a4a', f: '#4a3d31', L: '#a89482', k: '#111111', W: '#ffffff' },
    eyes: [[3, 5], [6, 5]], eyeC: '#ffd23f', hand: '#6b5a4a',
  },
  {
    id: 'zombie', name: tr('ZUMBI'), desc: tr('Cééérebro... e cachoeira. Nessa ordem.'), price: 60, monster: true,
    rows: ['..o.oo.o..', '.oHoHHoHo.', 'oHHHHHHHHo', 'oHHPPHHHHo', 'ozzzzzzzzo', 'ozzzzzzzzo', 'ozkzzzzzzo', 'ozzzzzzzzo', 'ozWkWkWzzo', '.ozzSzzzo.', '..oooooo..'],
    pal: { o: '#1a2216', H: '#3b2a1a', P: '#ff8fa8', z: '#8fae7a', k: '#4f6b45', W: '#e8e4c8', S: '#2a3324' },
    eyes: [[3, 5], [6, 5]], eyeC: '#f0f0d0', hand: '#8fae7a',
  },
  {
    id: 'yeti', name: tr('ABOMINÁVEL'), desc: tr('Veio do Himalaia porque achou a água daqui quentinha.'), price: 240,
    rows: ['..W.WW.W..', '.WWWWWWWW.', 'WWWWWWWWWW', 'WWbbbbbbWW', 'WbbbbbbbbW', 'WbbbbbbbbW', 'WbbbbbbbbW', 'WbbkkkkbbW', 'WWbWbbWbWW', '.WWWWWWWW.', '..W.WW.W..'],
    pal: { W: '#f4f8ff', b: '#7fa8d6', k: '#1b2a4a' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#f4f8ff', trail: 'snow',
  },
  {
    id: 'bigfoot', name: tr('PÉ-GRANDE'), desc: tr('Calça 58. Por isso não usa prancha.'), price: 150,
    rows: ['..oooooo..', '.oBBBBBBo.', 'oBBbBBbBBo', 'oBBBBBBBBo', 'oBddddddBo', 'oBddddddBo', 'oBddNNddBo', 'oBddddddBo', 'oBBdmmdBBo', 'oBBBBBBBBo', '.oBBBBBBo.'],
    pal: { o: '#1c120a', B: '#6b4423', b: '#8a5a30', d: '#3a2616', N: '#1c120a', m: '#140b06' },
    eyes: [[3, 5], [6, 5]], eyeC: '#f6e7c8', hand: '#6b4423',
  },
  {
    id: 'nessie', name: tr('MONSTRO DO LAGO'), desc: tr('Saiu do lago pra conhecer as cataratas. Foto sempre sai borrada.'), price: null, ach: 'print', alt: 300,
    rows: ['..oooo....', '.oGGGGoo..', 'oGGGGGGGo.', 'oGGGGGGGGo', 'oGGmmmmGGo', '.oGGGGGGo.', '..oGGLo...', '..oGGLo...', '..oGGLo...', '..oGGLo...', '..oGGLo...', '.oGGGLLo..', 'oGGGGGLLo.', 'oGGGGGGLLo'],
    pal: { o: '#123b22', G: '#3fa36a', L: '#9be0b0', m: '#123b22' },
    eyes: [[3, 3], [6, 3]], eyeC: '#111111', hand: '#3fa36a',
  },
  {
    id: 'skeleton', name: tr('ESQUELETO'), desc: tr('Leve, arejado e sem medo de quebrar. Já quebrou tudo.'), price: 105, monster: true,
    rows: ['..oooooo..', '.oWWWWWWo.', 'oWWWWWWWWo', 'oWWWWWWWWo', 'oWkkWWkkWo', 'oWkkWWkkWo', 'oWWWkkWWWo', '.oWWWWWWo.', '.okWkWkWo.', '..oWWWWo..'],
    pal: { o: '#2b2b33', W: '#f2efe6', k: '#1a1a1a' },
    eyes: [[3, 5], [6, 5]], eyeC: '#ff3b3b', hand: '#f2efe6',
  },
  {
    id: 'mummy', name: tr('MÚMIA'), desc: tr('3 mil anos enfaixada. Molhar as faixas? Primeira vez.'), price: 110, monster: true,
    rows: ['..oooooo..', '.oWwWWwWo.', 'oWWWwwWWWo', 'owWWWWWwWo', 'oWWwWWWWwo', 'okkkkkkkko', 'oWwWWWwWWo', 'oWWWwWWWwo', 'owWWWWwWWo', '.oWWwWWWo.', '..oooooo..'],
    pal: { o: '#4a4030', W: '#efe6cc', w: '#c9bc96', k: '#1a1610' },
    eyes: [[3, 5], [6, 5]], eyeC: '#ffd23f', hand: '#efe6cc',
  },
  {
    id: 'creature', name: tr('CRIATURA COSTURADA'), desc: tr('Feita de retalhos num laboratório. Os pontos aguentam água?'), price: null, ach: 'tight25', monster: true,
    rows: ['..oooooo..', '.oHHoHHHo.', 'oHHHHHHHHo', 'oaaaaabbbo', 'oSSSSSSSSo', 'oaaaabbbbo', 'oaaaabbbbo', 'oaaaaSbbbo', 'oaakkkkbbo', '.oaaabbbo.', '..oooooo..'],
    pal: { o: '#151a14', H: '#1b1b1b', a: '#9bb08a', b: '#c9a08a', S: '#2a2a2a', k: '#3a0d0d' },
    eyes: [[3, 6], [6, 6]], eyeC: '#1a1a1a', hand: '#9bb08a',
  },
  // ---- Brasil ----
  {
    id: 'caramelo', name: tr('VIRA-LATA CARAMELO'), desc: tr('Patrimônio nacional. Devia estar na nota de 200.'), price: 50,
    rows: ['..oooooo..', '.oCCCCCCo.', 'oDCCCCCCDo', 'DDCCCCCCDD', 'DDCCCCCCDD', 'DDCCCCCCDD', 'DoCLLLLCoD', '.oLLkkLLo.', '.oLLLLLLo.', '..oLppLo..', '...oppo...'],
    pal: { o: '#3a220c', C: '#d08a3c', D: '#9a5a1f', L: '#f3d2a2', k: '#1a1a1a', p: '#ff6f8a' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#d08a3c',
  },
  {
    id: 'lapwing', name: tr('QUERO-QUERO DE TOPETE'), desc: tr('Grita "quero-quero" e quer mesmo: quer descer de novo.'), price: 100,
    rows: ['...RR.....', '..RRRR....', '..RRRRR...', '.oRRRRRRo.', 'oGGGGGGGGo', 'oGGGGGGGGo', 'oWWGGGGWWo', 'oGGGBBGGGo', 'oKKKBBKKKo', '.oKKKKKKo.', '..oooooo..'],
    pal: { R: '#e8342a', o: '#1a1a1a', G: '#8e939c', W: '#ffffff', B: '#ff8a1c', K: '#202020' },
    eyes: [[3, 5], [6, 5]], eyeC: '#e01e1e', hand: '#8e939c',
  },
  {
    id: 'pony', name: tr('CAVALINHO DA SELEÇÃO'), desc: tr('Relincha a cada gol e a cada pedra que desvia.'), price: 140,
    rows: ['..o....o..', '.oHo..oHo.', '.oHHooHHo.', 'oHHMMMMHHo', 'oHHHMHHHHo', 'oHHHHHHHHo', 'oHHHHHHHHo', 'oHLLLLLLHo', 'oHLkLLkLHo', 'YYGYYYYGYY', 'YYYYGGYYYY'],
    pal: { o: '#2a1606', H: '#8a5a30', M: '#2a1606', L: '#c49a6c', k: '#2a1606', Y: '#ffd23f', G: '#1f9a46' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#8a5a30', trail: 'brasil',
  },
  // ---- pop ----
  {
    id: 'castaway', name: tr('NÁUFRAGO'), desc: tr('Ele e o Milson, sua bola de vôlei. Melhores amigos pra sempre.'), price: 165, ox: 5,
    rows: [
      '..oooooo.......', '.oHHHHHHo......', 'oHHHHHHHHo.....', 'oHssssssHo.....', 'oHssssssHo.....', 'osssssssso.....',
      'oBssssssBo.ooo.', 'oBBsmmsBBooWWWo', 'oBBBBBBBBooWRWo', '.oBBBBBBo.oWWWo', '..oBBBBo...ooo.',
    ],
    pal: { o: '#2a1606', H: '#6b4423', s: '#e0ac69', B: '#8a5a30', m: '#3a0d0d', W: '#f4f4ec', R: '#d62828' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#e0ac69',
  },
  {
    id: 'scientist', name: tr('CIENTISTA MALUCO'), desc: tr('Calculou tudo: a chance de dar certo é de 0,003%. Bora!'), price: 150,
    rows: ['W.W..W.W.W', '.WWWWWWWW.', 'WWWWWWWWWW', 'WWssssssWW', 'WssssssssW', 'WoLLooLLoW', 'WssssssssW', 'WsssWWsssW', '.osssssso.', 'CCCCrrCCCC'],
    pal: { W: '#f4f4f4', s: '#f1c27d', o: '#1a1a1a', L: '#bfe3ff', C: '#e8eef7', r: '#d62828' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#f1c27d', trail: 'spark',
  },
  {
    id: 'angel', name: tr('ANJINHO'), desc: tr('Nunca encostou numa pedra. Nem pensa nisso.'), price: null, ach: 'angel', ox: 7,
    rows: ['...yyyyyyyy...', '..............', '....oooooo....', '...oCCCCCCo...', '..oCCcCCcCCo..', '..oCssssssCo..', 'WWossssssssoWW', 'WWWossssssoWWW', '.WWossmmssoWW.', '..W.oooooo.W..'],
    pal: { y: '#ffe066', o: '#2a2108', C: '#ffd23f', c: '#e8b400', s: '#ffdbac', W: '#ffffff', m: '#d65a5a' },
    eyes: [[5, 6], [8, 6]], eyeC: '#3a2a1a', hand: '#ffdbac', trail: 'holy',
  },
  {
    id: 'devil', name: tr('DEMÔNIO'), desc: tr('Tá com o capeta no corpo. Literalmente.'), price: null, ach: 'm666',
    rows: ['H........H', 'HH......HH', '.HooooooH.', 'oRRRRRRRRo', 'oRRRRRRRRo', 'okkRRRRkko', 'oRRRRRRRRo', 'oRRRRRRRRo', 'oRkWWWWkRo', '.oRRkkRRo.', '..oookoo..'],
    pal: { H: '#f3e6c8', o: '#2a0606', R: '#d62828', k: '#2a0606', W: '#ffffff' },
    eyes: [[3, 6], [6, 6]], eyeC: '#ffd23f', hand: '#d62828', trail: 'fire',
  },
  {
    id: 'sponge', name: tr('BUCHINHA'), desc: tr('Esponja-do-mar rosinha e redonda. Não tem nada a ver com ninguém.'), price: null, ach: 'bubbles300',
    rows: ['...oooo...', '.ooPPPPoo.', 'oPPpPPPPPo', 'oPPPPPpPPo', 'oPpPPPPPPo', 'oPPPPPPPPo', 'oPPPPPPpPo', 'oPpPmmPPPo', '.oPPPPPpo.', '..oooooo..'],
    pal: { o: '#7a2a4a', P: '#ff8fb3', p: '#c95a85', m: '#7a2a4a' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#ff8fb3', trail: 'bubbles',
  },
  {
    id: 'marquio', name: tr('MARQUIO'), desc: tr('Encanador italiano, bigode de respeito e um pulo e tanto. A princesa tá em outra cachoeira.'), price: null, ach: 'plumber',
    rows: ['..oRRRRo..', '.oRRRRRRo.', 'oRRRRRRRRo', 'RRRRRRRRRR', '.oHssssHo.', '.osssssso.', '.ossNNsso.', 'oMMMMMMMMo', '.osmmmmso.', '..oBRRBo..', '.oBRRRRBo.'],
    pal: { o: '#2a1206', R: '#e02a2a', H: '#5a3410', s: '#f1c27d', N: '#e89a6a', M: '#3a2010', m: '#7a2a1a', B: '#2a4ad0' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#ffffff',
  },
  {
    id: 'handyman', name: tr('FAZ-TUDO'), desc: tr('Conserta barril, chuveiro e geladeira. Orçamento sem compromisso.'), price: null, ach: 'repair25',
    rows: ['...oooo...', '..oYYYYo..', '.oYYyYYYo.', 'oYYYYYYYYo', 'YYYYYYYYYY', 'osssssssso', 'osssssssso', 'osssssssso', 'osMMMMMMso', '.osssssso.', 'BBBBBBBBBB'],
    pal: { o: '#2a2108', Y: '#ffd23f', y: '#fff3a0', s: '#e0ac69', M: '#5a3416', B: '#3d6fb0' },
    eyes: [[3, 6], [6, 6]], eyeC: '#1a1a1a', hand: '#e0ac69', trail: 'spark',
  },
  {
    id: 'stunt', name: tr('DUBLÊ'), desc: tr('Faz as cenas perigosas. Sem rede, sem segunda chance.'), price: null, ach: 'hard',
    rows: ['..oooooo..', '.oRRRRRRo.', 'oRRWRRRRRo', 'oRRRRRRRRo', 'oRkkkkkkRo', 'oRkkkkkkRo', 'oRkkkkkkRo', 'oRRRRRRRRo', 'oRRRYYRRRo', '.oRRRRRRo.', '..oooooo..'],
    pal: { o: '#1a0606', R: '#d62828', W: '#ff8a8a', k: '#14161c', Y: '#ffd23f' },
    eyes: [[3, 5], [6, 5]], eyeC: '#ffffff', hand: '#14161c', trail: 'fire',
  },
  {
    id: 'kid8', name: tr('MENINO DO 8'), desc: tr('Mora num barril lá na vila. Troca qualquer skin por um sanduíche de presunto.'), price: null, ach: 'casa8',
    rows: ['..oooooo..', '.oCcCcCco.', 'oCcCcCcCco', 'oCCCCCCCCo', 'oHssssssHo', 'oHssssssHo', 'oHsfssfsHo', '.osssssso.', '.ossmmsso.', 'TtTtTtTtTt'],
    pal: { o: '#2a2108', C: '#7a8a3a', c: '#a0522d', H: '#6b5a2a', s: '#f1c27d', f: '#c68642', m: '#7a1d1d', T: '#d9c9a0', t: '#8a6a3a' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#f1c27d',
  },
  {
    id: 'cow', name: tr('VACA'), desc: tr('Desceu 1000 m no FÁCIL e trouxe vergonha pra família inteira. Muuu.'), price: null, ach: 'easy1000',
    rows: ['.H......H.', '.HooooooH.', 'EoWWKKWWoE', 'EoWKKWWWoE', '.oWWWWWKo.', '.oWWWWWWo.', '.oWWWWWWo.', 'oPPPPPPPPo', 'oPkPPPPkPo', 'oPPPPPPPPo', '.oooooooo.'],
    pal: { H: '#e8dcc0', o: '#2a2a2a', E: '#e8e4dc', W: '#ffffff', K: '#1a1a1a', P: '#ffb3c6', k: '#7a2a4a' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#ffffff', trail: 'foam',
  },
  // ---- device tricks, tech, fiction and around the world ----
  {
    id: 'beta', name: tr('BETA TESTER'), desc: tr('Achou 47 bugs, 3 eram features. Presente pra quem testou o jogo antes do lançamento. Valeu!'), price: null, beta: true,
    rows: ['...k..k...', '...oRRo...', '..oRkRkRo.', '.oCCCCCCo.', 'oCCCCCCCCo', 'CCCCCCCCCC', '.osssssso.', '.osssssso.', '.ossmmsso.', '..oTTTTo..'],
    pal: { k: '#1a1a1a', o: '#1a1a1a', R: '#e8342a', C: '#2e8a3e', s: '#f1c27d', m: '#7a1d1d', T: '#ffd23f' },
    eyes: [[3, 6], [6, 6]], eyeC: '#1a1a1a', hand: '#f1c27d', trail: 'spark',
  },
  {
    id: 'ghost', name: tr('FANTASMA'), desc: tr('Quebrou tanto barril que virou assombração da cachoeira. Buuu.'), price: null, ach: 'runs100',
    rows: ['...oooo...', '..oWWWWo..', '.oWWWWWWo.', 'oWWWWWWWWo', 'oWWWWWWWWo', 'oWWWWWWWWo', 'oWWWmmWWWo', 'oWWWmmWWWo', 'oWWWWWWWWo', 'oWWoWWoWWo'],
    pal: { o: '#8a9ab0', W: '#f4f8ff', m: '#2a2a3a' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a2a', hand: '#f4f8ff', trail: 'ghost', monster: true,
  },
  {
    id: 'demogorg', name: tr('DEMOGORGONZOLA'), desc: tr('Veio do mundo invertido e cheira a queijo azul. Abre a cara inteira pra dar oi.'), price: null, ach: 'demogorg',
    rows: ['o.o....o.o', 'oYo....oYo', 'oYYo..oYYo', '.oYmmmmYo.', 'oYmtmmtmYo', 'oYmmrrmmYo', 'oYmtmmtmYo', '.oYmmmmYo.', '..oYbYYo..', '..oYYbYo..', '.oYbYYYbo.', '.oYYYbYYo.'],
    pal: { o: '#3a2a10', Y: '#e8d48a', b: '#4a7a8a', m: '#7a1020', t: '#ffffff', r: '#c03040' },
    eyes: [], eyeC: '#000000', hand: '#e8d48a', trail: 'spore', monster: true,
  },
  {
    id: 'dumont', name: tr('SANTOS DUMMOUND'), desc: tr('Pai da aviação (segundo nós). Inventou o voo e o relógio de pulso. O barril, não.'), price: null, ach: 'airplane',
    rows: ['...oooo...', '..oHHHHo..', '.oHHHHHHo.', '.oBBBBBBo.', 'HHHHHHHHHH', '.osssssso.', '.osssssso.', '.ommmmmmo.', '.osssssso.', '..oWWWWo..', '.oWWkkWWo.'],
    pal: { o: '#2a2108', H: '#efe6c8', B: '#2a2a2a', s: '#f1c27d', m: '#3a2a1a', W: '#ffffff', k: '#1a1a1a' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#f1c27d',
  },
  {
    id: 'miner', name: tr('MINEIRO'), desc: tr('Capacete com lanterna, pão de queijo no bolso. Uai, cadê a luz?'), price: null, ach: 'torchnight', alt: 300,
    rows: ['...oooo...', '..oYWWYo..', '.oYYWWYYo.', 'oYYYYYYYYo', 'YYYYYYYYYY', '.osssssso.', '.osssssso.', '.osdssdso.', '.ossmmsso.', '..oCCCCo..'],
    pal: { o: '#2a2108', Y: '#ffd23f', W: '#fffbe8', s: '#e0ac69', d: '#8a6a4a', m: '#7a1d1d', C: '#3a5a8a' },
    eyes: [[3, 6], [6, 6]], eyeC: '#1a1a1a', hand: '#e0ac69',
  },
  {
    id: 'brickman', name: tr('BONEQUINHO DE BLOCOS'), desc: tr('Encaixa em qualquer barril. Perde o cabelo se bater muito forte.'), price: 135,
    rows: ['...oSSo...', '..oHHHHo..', '.oHHHHHHo.', '.oYYYYYYo.', '.oYYYYYYo.', '.oYYYYYYo.', '.oYmYYmYo.', '.oYYmmYYo.', '..oYYYYo..', '.oRRRRRRo.', 'oRRRRRRRRo'],
    pal: { o: '#2a2108', S: '#ffd23f', H: '#6b3a1a', Y: '#ffd23f', m: '#1a1a1a', R: '#d62828' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#ffd23f', trail: 'rainbow',
  },
  {
    id: 'dev', name: tr('DEV FULL STACK'), desc: tr('Funciona na máquina dele. Na cachoeira, ninguém sabe.'), price: 240,
    rows: ['..oooooo..', '.oGGGGGGo.', 'oGHHHHHHGo', 'PGssssssGP', 'PGkLskLkGP', 'oGssssssGo', 'oGssmmssGo', '.oGssssGo.', '.oGGGGGGo.', 'oGGGwGwGGo'],
    pal: { o: '#1a1a1a', G: '#4a5260', H: '#2a1a10', s: '#e0ac69', k: '#1a1a1a', L: '#bfe3ff', P: '#d62828', m: '#7a1d1d', w: '#e6ebf0' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#e0ac69',
  },
  {
    id: 'penguin', name: tr('PINGUIM DO TERMINAL'), desc: tr('Roda em qualquer barril, até nos mais velhos. Código aberto, barril aberto.'), price: 150,
    rows: ['...oooo...', '..oKKKKo..', '.oKKKKKKo.', '.oKWWWWKo.', 'oKWWWWWWKo', 'oKWWYYWWKo', 'oKWWYYWWKo', 'oKWWWWWWKo', '.oKWWWWKo.'],
    pal: { o: '#000000', K: '#1a1a1a', W: '#ffffff', Y: '#ffb020' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#1a1a1a', trail: 'snow',
  },
  {
    id: 'jobis', name: tr('ESTIVE TRABALHOS'), desc: tr('Só mais uma coisa: um barril sem botão nenhum. Revolucionário.'), price: 300,
    rows: ['..oooooo..', '.oGGGGGGo.', 'oGssssssGo', 'oskLkkLkso', '.osssssso.', '.oGsmmsGo.', '.oGGGGGGo.', '..oBBBBo..', '.oBBBBBBo.'],
    pal: { o: '#2a2108', G: '#9a9a9a', s: '#f1c27d', k: '#2a2a2a', L: '#dfe8ff', m: '#7a3a2a', B: '#111111' },
    eyes: [[3, 3], [6, 3]], eyeC: '#1a1a1a', hand: '#f1c27d',
  },
  {
    id: 'hitch', name: tr('MOCHILEIRO'), desc: tr('De roupão e com a toalha na cabeça, claro. Sabe que a resposta é 42, só esqueceu a pergunta.'), price: 42,
    rows: ['..oTtTto..', '.oTtTtTto.', 'oTtTtTtTto', 'oTTTTTTTTo', '.osssssso.', '.osssssso.', '.osssssso.', '.ossmmsso.', '..oRRRRo..', '.oRRWWRRo.'],
    pal: { o: '#2a1a08', T: '#ff9f1c', t: '#3d8fe0', s: '#f1c27d', m: '#7a3a2a', R: '#8a5a3a', W: '#e8dcc0' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#f1c27d',
  },
  {
    id: 'cyborg', name: tr('CIBORGUE DO FUTURO'), desc: tr('Veio de 2029 atrás de roupas, botas e um barril. Hasta la vista, pedra.'), price: 300,
    rows: ['..oooooo..', '.oHHHHHHo.', 'oHHHHHHHHo', 'oHssssssHo', 'oKKKKKKrKo', '.osssssMo.', '.osssMMMo.', '.osmmmsMo.', '..oLLLLo..', '.oLLWWLLo.'],
    pal: { o: '#1a1a1a', H: '#2a1a10', s: '#d9a070', K: '#111111', r: '#ff2a2a', M: '#c3cad4', m: '#6a2a1a', L: '#22252b', W: '#3a3f48' },
    eyes: [], eyeC: '#000000', hand: '#d9a070', trail: 'spark',
  },
  {
    id: 'gates', name: tr('BILL PORTÕES'), desc: tr('O barril travou? Desliga e liga de novo. Tela azul é a cachoeira.'), price: 300,
    rows: ['..oooooo..', '.oHHHHHHo.', 'oHHHHHsHHo', 'oHssssssHo', 'oskLkkLkso', '.osssssso.', '.ossmmsso.', '..oWWWWo..', '.oVVWWVVo.'],
    pal: { o: '#2a2108', H: '#a0703a', s: '#f1c27d', k: '#3a3a3a', L: '#dfe8ff', m: '#a04a4a', W: '#ffffff', V: '#6a8ab0' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#f1c27d', trail: 'spark',
  },
  {
    id: 'jedai', name: tr('MESTRE JEDAI'), desc: tr('Que a correnteza esteja com você. Usa a força pra desviar das pedras.'), price: 360, ox: 5,
    rows: ['..oooooo...g', '.oRRRRRRo..g', 'oRRHHHHRRo.g', 'oRssssssRo.g', 'oRssssssRo.g', 'oRBssssBRo.g', 'oRBBmmBBRo.g', '.oRBBBBRo..g', '.oRTTTTRo..h', 'oRRTTTTRRo.h'],
    pal: { o: '#2a1a08', R: '#6b4a2a', H: '#8a5a2a', s: '#f1c27d', B: '#b08050', m: '#5a2a1a', T: '#e8dcc0', g: '#5cff5c', h: '#9aa2b3' },
    eyes: [[3, 3], [6, 3]], eyeC: '#1a1a1a', hand: '#f1c27d', trail: 'spark',
  },
  {
    id: 'trooper', name: tr('SOLDADO ESTELAR'), desc: tr('Mira em tudo, acerta nada. Nem as pedras ele acerta. Ainda bem.'), price: 280,
    rows: ['..oooooo..', '.oWWWWWWo.', 'oWWWWWWWWo', 'oWKKWWKKWo', 'oWKKWWKKWo', 'oWWWWWWWWo', 'oWGWKKWGWo', '.oWKWWKWo.', '..oWWWWo..'],
    pal: { o: '#2a2a2a', W: '#f4f6f8', K: '#1a1a1a', G: '#9aa2b3' },
    eyes: [], eyeC: '#000000', hand: '#f4f6f8',
  },
  {
    id: 'samurai', name: tr('SAMURAI'), desc: tr('Honra, disciplina e um barril. O código do bushidô não fala nada de cachoeira.'), price: 165,
    rows: ['Y........Y', '.Y.oooo.Y.', '..YKKKKY..', '.oKKKKKKo.', 'oKKKKKKKKo', 'oKssssssKo', '.osssssso.', '.osmmmmso.', '..oRRRRo..', '.oRRRRRRo.'],
    pal: { o: '#1a1a1a', Y: '#ffd23f', K: '#2a2a3a', s: '#f1c27d', m: '#5a2a1a', R: '#a01a1a' },
    eyes: [[3, 6], [6, 6]], eyeC: '#1a1a1a', hand: '#f1c27d',
  },
  {
    id: 'gondolier', name: tr('GONDOLEIRO'), desc: tr('Trocou Veneza pelas cataratas. O remo ficou pra trás. O bigode, não.'), price: 120,
    rows: ['..oooooo..', '.oYYYYYYo.', '.oRRRRRRo.', 'YYYYYYYYYY', '.osssssso.', '.osssssso.', '.osmmmmso.', '..oWBWBo..', '.oWBWBWBo.'],
    pal: { o: '#2a2108', Y: '#e8c870', R: '#c02020', s: '#f1c27d', m: '#3a2a1a', W: '#ffffff', B: '#1a2a6a' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#f1c27d',
  },
  {
    id: 'guard', name: tr('GUARDA REAL'), desc: tr('Não pode rir, não pode se mexer. Na cachoeira, não tem escolha.'), price: 135,
    rows: ['..oooooo..', '.oKKKKKKo.', '.oKKKKKKo.', '.oKKKKKKo.', '.oKKKKKKo.', '.oKKKKKKo.', '.osssssso.', '.osssssso.', '.oKssssKo.', '..oRRRRo..', '.oRYRRYRo.'],
    pal: { o: '#1a1a1a', K: '#1a1a1a', s: '#f1c27d', R: '#c01818', Y: '#ffd23f' },
    eyes: [[3, 6], [6, 6]], eyeC: '#1a1a1a', hand: '#ffffff',
  },
  {
    id: 'cowboy', name: tr('CAUBÓI'), desc: tr('Domou touro, cavalo e agora um barril. Iiirrá!'), price: 105,
    rows: ['...oooo...', '..oBBBBo..', '.oBBBBBBo.', '.oDDDDDDo.', 'BBBBBBBBBB', '.osssssso.', '.osssssso.', '.ossmmsso.', '..oRRRRo..', '.oRRRRRRo.'],
    pal: { o: '#2a1808', B: '#8a5a2a', D: '#3a2010', s: '#f1c27d', m: '#7a1d1d', R: '#c02828' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#f1c27d',
  },
  {
    id: 'mariachi', name: tr('MARIACHI'), desc: tr('Toca uma serenata pra cachoeira. Ela responde com espuma.'), price: 120,
    rows: ['...oooo...', '..oKKKKo..', '..oKKKKo..', '.oKSSSSKo.', 'KKKKKKKKKK', 'SKKKKKKKKS', '.osssssso.', '.osssssso.', '.osmmmmso.', '..oWWWWo..', '.oRRWWRRo.'],
    pal: { o: '#1a1a1a', K: '#1a1a1a', S: '#c3cad4', s: '#f1c27d', m: '#3a2a1a', W: '#ffffff', R: '#c02828' },
    eyes: [[3, 6], [6, 6]], eyeC: '#1a1a1a', hand: '#f1c27d',
  },
  // ---- holidays ----
  {
    id: 'bunny', name: tr('COELHO DA PÁSCOA'), desc: tr('Escondeu os ovos e esqueceu onde. Tá procurando no rio.'), price: null, ach: 'pascoa',
    rows: ['.oo....oo.', 'oWWo..oWWo', 'oWPo..oPWo', 'oWPo..oPWo', 'oWPo..oPWo', '.oWooooWo.', '.oWWWWWWo.', 'oWWWWWWWWo', 'oWWWWWWWWo', 'oPWWkkWWPo', 'oWWWmmWWWo', '.oWWWWWWo.', '..oooooo..'],
    pal: { o: '#4a4a5a', W: '#fbfbff', P: '#ffb3c6', k: '#ff6f8a', m: '#4a4a5a' },
    eyes: [[3, 8], [6, 8]], eyeC: '#1a1a1a', hand: '#fbfbff', trail: 'easter',
  },
  {
    id: 'armadillo', name: tr('TATU DO HANUKKAH'), desc: tr('Meio tatu, meio feriado. 100% casca grossa.'), price: 135,
    rows: ['..oooooo..', '.oAaAaAao.', 'oaAaAaAaAo', 'oAaAaAaAao', 'oTTTTTTTTo', 'oTTTTTTTTo', '.oTTTTTTo.', '..oTTTTo..', '...oppo...', 'BWBWBWBWBW', 'WBWBWBWBWB'],
    pal: { o: '#2a2420', A: '#8a7a68', a: '#6a5c4e', T: '#c8a888', p: '#ff8fa8', B: '#2f6fd1', W: '#ffffff' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#c8a888',
  },
  // ---- historical figures ----
  {
    id: 'vangogh', name: tr('VAN GOGH'), desc: tr('Chapéu de palha, barba ruiva e um curativo na orelha. Ouviu falar que a cachoeira era bonita e veio pintar.'), price: null, ach: 'vangogh',
    rows: ['...oooo...', '..oYyYYo..', 'YYYYYYYYYY', '.oRssssRo.', 'WWsssssRo.', 'WWsssssRo.', '.oRRssRRo.', '.oRRmmRRo.', '..oRRRRo..', '.oBBBBBBo.'],
    pal: { o: '#3a2a10', Y: '#f2c94c', y: '#c8962a', R: '#d2691e', s: '#f1c27d', W: '#ffffff', m: '#7a2a1a', B: '#2f5fa8' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#f1c27d',
  },
  {
    id: 'picasso', name: tr('PICASSO'), desc: tr('Camisa listrada e um olho em cada altura. Diz que não caiu da cachoeira: pintou ela de outro ângulo.'), price: null, ach: 'picasso',
    rows: ['..oooooo..', '.oshhssso.', 'ossssppppo', 'kssssppppk', 'ossssppppo', 'ossssppppo', '.ossmmppo.', '..oWNWNo..', '.oWNWNWNo.', 'oNWNWNWNWo'],
    pal: { o: '#2a1a10', s: '#e8b88a', h: '#f8dcc0', p: '#9ab8e0', k: '#3a3a3a', m: '#8a3a2a', W: '#ffffff', N: '#1d2f6f' },
    eyes: [[3, 4], [6, 5]], eyeC: '#1a1a1a', hand: '#e8b88a',
  },
  {
    id: 'mozart', name: tr('MOZART'), desc: tr('Peruca empoada e casaca de gala. Compôs uma sinfonia inteira entre uma pedra e outra.'), price: null, ach: 'mozart',
    rows: ['..oWWWWo..', '.oWWWWWWo.', 'oWWssssWWo', 'WWssssssWW', 'oWssssssWo', 'WWsPssPsWW', '.ossmmsso.', '..oLLLLo..', '.oRLLLLRo.', 'oRRGLLGRRo'],
    pal: { o: '#5a5a6a', W: '#f4f4f8', s: '#f6d5b8', P: '#f0a0a8', m: '#c0505a', L: '#ffffff', R: '#c0283a', G: '#ffd23f' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#f6d5b8', trail: 'notes',
  },
  {
    id: 'davinci', name: tr('DA VINCI'), desc: tr('Pintor, inventor e engenheiro. Desenhou o barril, a cachoeira e a máquina de voar que devia estar usando agora.'), price: null, ach: 'davinci',
    rows: ['..oooooo..', '.oKKKKKKo.', 'oKKKKKKKKo', 'GGssssssGG', 'GGssssssGG', 'GGGssssGGG', 'GGGGmmGGGG', '.GGGGGGGG.', '..GGGGGG..', '...GGGG...'],
    pal: { o: '#1a1a1a', K: '#5a2a3a', G: '#d8d8d0', s: '#e8b88a', m: '#8a5a4a' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#e8b88a',
  },
  // ---- rescue and professions ----
  {
    id: 'civil', name: tr('DEFESA CIVIL'), desc: tr('Capacete, colete laranja e o celular apitando: ALERTA SEVERO DE TEMPESTADE. Ele já sabia.'), price: null, ach: 'stormsafe',
    rows: ['...oooo...', '..oOOOOo..', '.oOOWWOOo.', 'OOOOOOOOOO', '.osssssso.', '.osssssso.', '.ossmmsso.', '.oOYOOYOo.', 'oOOLLLLOOo', 'oOOOBBOOOo'],
    pal: { o: '#2a1a08', O: '#ff7a00', W: '#ffffff', s: '#e0ac69', m: '#7a2a1a', Y: '#ffe14d', L: '#d8dde4', B: '#1f3a8a' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#e0ac69',
  },
  {
    id: 'cop', name: tr('POLICIAL'), desc: tr('Quepe, distintivo e cara de poucos amigos. Já multou três pedras por excesso de dureza.'), price: null, ach: 'cleanrec',
    rows: ['..oooooo..', '.oBBYBBBo.', 'oBBBBBBBBo', 'oKKKKKKKKo', '.osssssso.', '.osssssso.', '.ossmmsso.', '..oBBBBo..', '.oBBYBBBo.', 'oBBBBBBBBo'],
    pal: { o: '#0a0f1a', B: '#1f3a6a', Y: '#ffd23f', K: '#111111', s: '#c68c5a', m: '#6a2a1a' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#c68c5a',
  },
  {
    id: 'fireman', name: tr('BOMBEIRO'), desc: tr('Capacete vermelho e bigode de herói. Veio apagar um incêndio e errou o endereço por uma cachoeira.'), price: null, ach: 'firefight',
    rows: ['...oooo...', '..oRRRRo..', '.oRRYYRRo.', 'RRRRRRRRRR', '.osssssso.', '.osssssso.', '.oskkkkso.', '.oTTTTTTo.', 'oTLLLLLLTo', 'oTTTTTTTTo'],
    pal: { o: '#2a0a0a', R: '#d62020', Y: '#ffd23f', s: '#f1c27d', k: '#3a2a1a', T: '#c8a040', L: '#e8f0f0' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#f1c27d',
  },
  {
    id: 'doctor', name: tr('MÉDICO'), desc: tr('Touca, máscara e estetoscópio. Receita: repouso absoluto. Ele mesmo não segue.'), price: null, ach: 'doctor',
    rows: ['..oooooo..', '.oGGGGGGo.', 'oGGGGGGGGo', 'oGssssssGo', '.osssssso.', '.oMMMMMMo.', '.oMMMMMMo.', '..oWWWWo..', '.oWkWWkWo.', 'oWWWkkWWWo'],
    pal: { o: '#1a2a2a', G: '#3aa58a', s: '#f1c27d', M: '#bfe3ff', W: '#ffffff', k: '#4a4a5a' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#f1c27d',
  },
  {
    id: 'gamer', name: tr('GAMER'), desc: tr('Headset com luz RGB, moletom e 14 horas de jogo. Acha que a cachoeira é a fase bônus.'), price: null, ach: 'nopause',
    rows: ['..kkkkkk..', '.kHHHHHHk.', 'kHHHHHHHHk', 'CssssssssC', 'CssssssssC', '.osssssso.', 'kkssmmsso.', '..oPPPPo..', '.oPPPPPPo.', 'oPPPCCPPPo'],
    pal: { k: '#1a1a1a', H: '#4a2a1a', C: '#3df27a', s: '#f1c27d', m: '#7a2a1a', P: '#6a3ab8', o: '#1a1a1a' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#f1c27d', trail: 'spark',
  },
  {
    id: 'chef', name: tr('CHEF DE COZINHA'), desc: tr('Chapéu alto, bigodão e lenço no pescoço. Tempera a cachoeira com sal grosso.'), price: 135,
    rows: ['..oWWWWo..', '.oWWWWWWo.', '.oWWWWWWo.', '..oWWWWo..', '.oLLLLLLo.', '.osssssso.', '.osssssso.', '.okkkkkko.', '..oWWWWo..', '.oWRWWRWo.', 'oWWWWWWWWo'],
    pal: { o: '#5a5a6a', W: '#ffffff', L: '#e0e4ea', s: '#f1c27d', k: '#2a1a10', R: '#d62828' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#f1c27d',
  },
  {
    id: 'courier', name: tr('ENTREGADOR'), desc: tr('Capacete na cabeça e pedido nas costas. A cachoeira foi o atalho que o GPS mandou.'), price: 120,
    rows: ['..oooooo..', '.oRRRRRRo.', 'oRRRRRRRRo', 'oRKKKKKKRo', 'oRssssssRo', 'oRssssssRo', 'oRssmmssRo', '.oRRRRRRo.', '.oGGGGGGo.', 'oGGGGGGGGo'],
    pal: { o: '#1a1a1a', R: '#e02a2a', K: '#2a2a3a', s: '#c68c5a', m: '#6a2a1a', G: '#2a2a2a' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#c68c5a',
  },
  // ---- TV and villains ----
  {
    id: 'milton', name: tr('MILTON SOUSA'), desc: tr('Terno, microfone no peito e um sorriso de domingo. Ma oeee! Quem quer barril? Joga pra plateia!'), price: null, ach: 'milton',
    rows: ['..oooooo..', '.oKKKKKKo.', 'oKKhKKKKKo', 'oKssssssKo', '.osssssso.', '.oWWWWWWo.', '..osssso..', '.oBWRWMBo.', 'oBBBRBBBBo', 'oBBBRBBBBo'],
    pal: { o: '#1a1a1a', K: '#1a1a2a', h: '#5a5a7a', s: '#f1c27d', W: '#ffffff', B: '#2a3a6a', R: '#d62828', M: '#9aa3ae' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#f1c27d', trail: 'gold',
  },
  {
    id: 'faustino', name: tr('FAUSTINO DO DOMINGÃO'), desc: tr('Ô loco, meu! Essa cachoeira é da pesada! Errou a pedra? ERROU!'), price: 165,
    rows: ['..oooooo..', '.oGGGGGGo.', 'oGGGGGGGGo', 'osssssssso', 'oKsKssKsKo', 'osssssssso', 'ossmmmmsso', '.osssssso.', '.oBBWWBBo.', 'oBBBWWBBBo'],
    pal: { o: '#2a2a2a', G: '#a8a8b0', s: '#f1c27d', K: '#1a1a1a', m: '#7a1a1a', B: '#3a3a5a', W: '#ffffff' },
    eyes: [[2, 4], [7, 4]], eyeC: '#1a1a1a', hand: '#f1c27d',
  },
  {
    id: 'nazare', name: tr('NAZARÉ CONFUSA'), desc: tr('Vilã de novela das nove. Fazendo as contas de quantas pedras faltam. Os números não fecham.'), price: null, ach: 'nazare',
    rows: ['..oYYYYo..', '.oYYYYYYo.', 'oYYYYYYYYo', 'YYssssssYY', 'YYssssssYY', 'YYssssssYY', '.oYsRRsYo.', '.oYssssYo.', '..oPWPWo..', '.oPPPPPPo.'],
    pal: { o: '#5a3a10', Y: '#ffd86a', s: '#f6d5b8', R: '#d62040', P: '#7a1a3a', W: '#ffffff' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#f6d5b8',
  },
  {
    id: 'odete', name: tr('ODETE ROIBARRIL'), desc: tr('Milionária, óculos escuros e colar de pérolas. Acha a cachoeira cafona, mas desce de primeira classe.'), price: 400,
    rows: ['..oGGGGo..', '.oGGGGGGo.', 'oGGGGGGGGo', 'oGssssssGo', 'oGKKsKKsGo', 'oGssssssGo', '.oGsRRsGo.', '..osssso..', '.oWBWBWBo.', 'oBBBBBBBBo'],
    pal: { o: '#3a3a3a', G: '#c8c8d0', s: '#f1d0b0', K: '#111111', R: '#c01040', W: '#ffffff', B: '#1a1a1a' },
    eyes: [], eyeC: '#000000', hand: '#f1d0b0',
  },
  {
    id: 'darklord', name: tr('LORDE SOMBRIO'), desc: tr('Capacete preto, capa e uma respiração pesada. Veio do lado sombrio da cachoeira. Eu sou seu barril.'), price: null, ach: 'darklord',
    rows: ['...oooo...', '..oKKKKo..', '.oKKLKKKo.', 'oKKKKKKKKo', 'oKDDKKDDKo', 'oKKKKKKKKo', 'oKKgggKKKo', 'KKKKKKKKKK', 'KKKRGBKKKK', 'KKKKKKKKKK'],
    pal: { o: '#000000', K: '#141418', L: '#5a5a6a', D: '#7a7a92', g: '#6a6a7a', R: '#ff2a2a', G: '#3df27a', B: '#3d8fe0' },
    eyes: [], eyeC: '#000000', hand: '#141418', trail: 'smoke',
  },
  {
    id: 'sinister', name: tr('PALHAÇO SINISTRO'), desc: tr('Cabelo verde, terno roxo e um sorriso grande demais. Por que tão sério, pedra?'), price: 300,
    rows: ['..GGGGGG..', '.GGGGGGGG.', 'GGWWWWWWGG', 'GWWWWWWWWG', '.oWWWWWWo.', '.oWWWWWWo.', '.RRRRRRRR.', '.oWRRRRWo.', '..oPPPPo..', '.oPPOOPPo.'],
    pal: { G: '#3a9a3a', W: '#f4f4f4', o: '#2a2a2a', R: '#d62020', P: '#6a2a8a', O: '#ff9a2a' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#f4f4f4', trail: 'magic',
  },
  {
    id: 'nightmare', name: tr('PESADELO DA RUA'), desc: tr('Chapéu surrado, suéter listrado e garras afiadas. Não durma na cachoeira.'), price: 240, monster: true,
    rows: ['...oooo...', '..oHHHHo..', '.oHHHHHHo.', 'HHHHHHHHHH', '.osBssBso.', '.oBssssBo.', '.ossBBsso.', '.osWkWkso.', '.oRGRGRGo.', 'oRGRGRGRGo'],
    pal: { o: '#2a1a0a', H: '#6a4a2a', s: '#c87a5a', B: '#8a3a2a', W: '#f0e0c0', k: '#2a1a0a', R: '#c02020', G: '#2a6a2a' },
    eyes: [[3, 5], [6, 5]], eyeC: '#ffd23f', hand: '#c87a5a',
  },
  {
    id: 'jackson', name: tr('JACKSON'), desc: tr('Máscara de hóquei e paciência infinita. Só aparece numa sexta-feira 13. E sempre volta.'), price: null, ach: 'friday13', monster: true,
    rows: ['..oooooo..', '.oMMMMMMo.', 'oMMkMMkMMo', 'oMRMMMMRMo', 'oMMMMMMMMo', 'oMRMkkMRMo', 'oMMkMMkMMo', '.oMMMMMMo.', '.oJJJJJJo.', 'oJJJJJJJJo'],
    pal: { o: '#1a1a1a', M: '#e8e4d0', k: '#3a3a3a', R: '#c01818', J: '#4a5030' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#d0b090', trail: 'smoke',
  },
  // ---- explorers, inventors, spies and teachers ----
  {
    id: 'relic', name: tr('CAÇADOR DE RELÍQUIAS'), desc: tr('Chapéu, jaqueta de couro e um chicote. Odeia cobras. Pedra rolando atrás dele? Rotina.'), price: 280,
    rows: ['..oooooo..', '.oHHHHHHo.', '.oHBBBBHo.', 'HHHHHHHHHH', '.osssssso.', '.osssssso.', '.osddddso.', '..oLLLLo..', '.oLWLLWLo.', 'oLLWWWWLLo'],
    pal: { o: '#2a1a08', H: '#8a5a2a', B: '#3a2010', s: '#e0ac69', d: '#9a7050', L: '#6a3a1a', W: '#d8c8a0' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#e0ac69',
  },
  {
    id: 'incognito', name: tr('AGENTE ANÔNIMO'), desc: tr('Chapéu, óculos e sobretudo cinza. Não deixa histórico, nem cookies, nem pegadas na água.'), price: null, ach: 'incognito',
    rows: ['..oooooo..', '.oGGGGGGo.', '.oGGGGGGo.', 'GGGGGGGGGG', '.oPPPPPPo.', 'PKWKPPKWKP', '.oPPPPPPo.', '.CCPPPPCC.', 'CCCCCCCCCC', 'CCCCCCCCCC'],
    pal: { o: '#2a2a30', G: '#4a4a52', P: '#9a9aa8', K: '#1a1a1a', W: '#dcdce8', C: '#5a5a66' },
    eyes: [], eyeC: '#000000', hand: '#5a5a66', trail: 'ghost',
  },
  {
    id: 'tesla', name: tr('ALQUIMISTA DA ELETRICIDADE'), desc: tr('Bigode fino, risca no meio e faíscas saindo do cabelo. Acende uma lâmpada só de olhar pra ela.'), price: null, ach: 'tesla',
    rows: ['Y.oooooo.Y', '.oKKsKKKo.', 'oKKKsKKKKo', 'oKssssssKo', '.osssssso.', '.osssssso.', '.okkkkkko.', '..osssso..', '.oBWWWWBo.', 'oBBBWWBBBo'],
    pal: { Y: '#3df2ff', o: '#1a1a1a', K: '#1a1a24', s: '#f1d0b0', k: '#2a1a10', B: '#2a2a3a', W: '#ffffff' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#f1d0b0', trail: 'spark',
  },
  {
    id: 'ada', name: tr('MATEMÁGICA DOS ALGORITMOS'), desc: tr('Escreveu o primeiro programa antes de existir computador. Já calculou a rota perfeita entre as pedras.'), price: null, ach: 'ada',
    rows: ['..oHHHHo..', '.oHHHHHHo.', 'HHHHssHHHH', 'HHssssssHH', 'HHssssssHH', '.osssssso.', '.ossmmsso.', '..oWWWWo..', '.oPWWWWPo.', 'oPPPPPPPPo'],
    pal: { o: '#1a1010', H: '#2a1a14', s: '#f6d5b8', m: '#b04050', W: '#ffffff', P: '#5a2a7a' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#f6d5b8',
  },
  {
    id: 'darwin', name: tr('NATURALISTA DAS ILHAS'), desc: tr('Barba branca e caderno de anotações. Diz que o piloto evoluiu de um barril. Faz sentido.'), price: null, ach: 'darwin',
    rows: ['..oooooo..', '.osshssso.', 'osssssssso', 'WWWWssWWWW', 'WssssssssW', 'WWssssssWW', 'WWWWmmWWWW', '.WWWWWWWW.', '.oWWWWWWo.', 'oCWWWWWWCo'],
    pal: { o: '#3a2a1a', s: '#e8b88a', h: '#f8dcc0', W: '#f0f0ea', m: '#8a5a4a', C: '#5a3a1a' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#e8b88a',
  },
  {
    id: 'agent006', name: tr('AGENTE 006'), desc: tr('Smoking, gravata-borboleta e licença pra descer. Tá a um número de ficar famoso.'), price: null, ach: 'agent006',
    rows: ['..oooooo..', '.oHHHHHHo.', 'oHHHHHHHHo', 'oHssssssHo', '.osssssso.', '.osssssso.', '.osssmmso.', '..osssso..', '.oKWkkWKo.', 'oKKKWWKKKo'],
    pal: { o: '#1a1a1a', H: '#5a3a1a', s: '#f1c27d', m: '#7a3a2a', K: '#141418', W: '#ffffff', k: '#000000' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#f1c27d',
  },
  {
    id: 'professor', name: tr('PROFESSOR'), desc: tr('Óculos redondos, colete e giz no bolso. Vai ter prova sobre a cachoeira. Vale ponto.'), price: null, ach: 'professor',
    rows: ['G.oGGGGo.G', '.oGGGGGGo.', 'oGssssssGo', 'oGssssssGo', 'oKWKssKWKo', '.osssssso.', '.osGGGGso.', '..osssso..', '.oVWWWWVo.', 'oVVVWWVVVo'],
    pal: { o: '#2a2a2a', G: '#b8b8c0', s: '#f1c27d', K: '#2a2a2a', W: '#dfefff', V: '#7a5a3a' },
    eyes: [[2, 4], [7, 4]], eyeC: '#1a1a1a', hand: '#f1c27d',
  },
  // ---- weekend challenges ----
  {
    id: 'grillman', name: tr('TIO DO CHURRASCO'), desc: tr('Bigode, avental e a pinça na mão. Ninguém encosta na churrasqueira dele.'), price: null, ach: 'wkday',
    rows: ['..oooooo..', '.oshsssso.', 'HssssssssH', 'HssssssssH', '.osssssso.', '.okkkkkko.', '..osssso..', '.oRWWWWRo.', 'oRRWWWWRRo', 'oRRWWWWRRo'],
    pal: { o: '#2a1a10', s: '#e0ac69', h: '#f8d0a0', H: '#3a2a1a', k: '#3a2a1a', R: '#c03030', W: '#f4f4f4' },
    eyes: [[3, 3], [6, 3]], eyeC: '#1a1a1a', hand: '#e0ac69', trail: 'smoke',
  },
  {
    id: 'farofa', name: tr('FAROFEIRO'), desc: tr('Chapéu de palha, óculos escuros e protetor no nariz. Trouxe a farofa, o frango e a caixa de som.'), price: null, ach: 'wkfull',
    rows: ['...oooo...', '..oYYYYo..', 'YYYYYYYYYY', '.osssssso.', '.oKKssKKo.', '.ossWWsso.', '.ossmmsso.', '..osssso..', '.oGsGGsGo.', 'oGGGGGGGGo'],
    pal: { o: '#3a2a10', Y: '#f2d070', s: '#c68c5a', K: '#1a1a1a', W: '#ffffff', m: '#7a2a1a', G: '#2a9a5a' },
    eyes: [], eyeC: '#000000', hand: '#c68c5a',
  },
  // ---- sharing in the popular apps ----
  {
    id: 'tiazap', name: tr('TIA DO ZAP'), desc: tr('Manda bom dia com flor e gatinho às 5h da manhã. Já compartilhou sua descida em 12 grupos.'), price: null, ach: 'share_zap', alt: 240,
    rows: ['.oCCCCCCo.', 'oCCCCCCCCo', 'CCssssssCC', 'CKWKssKWKC', 'CssssssssC', '.ossmmsso.', '..osssso..', '.oFPFFPFo.', 'oPFPPFPFPo', 'oPPFPPFPPo'],
    pal: { o: '#4a2a4a', C: '#b07ab8', s: '#e8b88a', K: '#3a2a3a', W: '#dfefff', m: '#c0405a', F: '#ffd23f', P: '#e85a9a' },
    eyes: [[2, 3], [7, 3]], eyeC: '#1a1a1a', hand: '#e8b88a', trail: 'hearts',
  },
  {
    id: 'blogueira', name: tr('BLOGUEIRINHA'), desc: tr('Óculos na cabeça, carão pra câmera e #cachoeira #barril #blessed. Postou antes de descer.'), price: null, ach: 'share_ig', alt: 240,
    rows: ['..oHHHHo..', '.oHKKKKHo.', 'oHHHHHHHHo', 'HHssssssHH', 'HHssssssHH', 'HHssRRssHH', 'HHHssssHHH', '.HoPPPPoH.', '.oPPPPPPo.', 'oPPPPPPPPo'],
    pal: { o: '#5a3a10', H: '#e8c06a', K: '#1a1a1a', s: '#f1c27d', R: '#e0306a', P: '#ff7ab0' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#f1c27d', trail: 'hearts',
  },
  {
    id: 'viral', name: tr('DANÇARINO VIRAL'), desc: tr('Inventou uma dancinha no meio da cachoeira. 2 milhões de views, 0 pedras desviadas.'), price: null, ach: 'share_tt', alt: 240,
    rows: ['..oooooo..', '.oBBBBBBo.', 'oBBBBBBBBo', 'oBssssssBo', '.osssssso.', '.osssssso.', '.osWWWWso.', '..osssso..', '.oTTCTTTo.', 'oTTTTTTTTo'],
    pal: { o: '#1a1a1a', B: '#2a2a3a', s: '#c68c5a', W: '#ffffff', T: '#ff2a6a', C: '#3df2ff' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#c68c5a', trail: 'rainbow',
  },
  {
    id: 'tioface', name: tr('TIO DO FACE'), desc: tr('Compartilha corrente, piada de pavê e agora a sua descida. "É PRA DESCER OU PRA SUBIR?"'), price: null, ach: 'share_fb', alt: 240,
    rows: ['..oooooo..', '.osshssso.', 'osssssssso', 'oKWKssKWKo', 'osssssssso', 'oskkkkkkso', '.osssssso.', '..oBBBBo..', '.oBWBBWBo.', 'oBBBBBBBBo'],
    pal: { o: '#2a1a10', s: '#e0ac69', h: '#f8d0a0', K: '#2a2a2a', W: '#dfefff', k: '#4a3a2a', B: '#3a5aa8' },
    eyes: [[2, 3], [7, 3]], eyeC: '#1a1a1a', hand: '#e0ac69',
  },
  // ---- reminders and invites ----
  {
    id: 'pigeon', name: tr('POMBO-CORREIO'), desc: tr('Entrega o lembrete do desafio todo dia às 19h. Nunca atrasa, nunca erra o endereço.'), price: null, ach: 'notif', alt: 135,
    rows: ['..oBBBBo..', '.oBBBBBBo.', 'BBBBBBBBBB', 'oGGGGGGGGo', 'oGGGGGGGGo', 'oGGGOOGGGo', 'oNNNNNNNNo', 'oNPNPNPNPo', '.oGGGGGGo.', 'oGGWWWWGGo'],
    pal: { o: '#3a3f4a', B: '#2f5fa8', G: '#9aa3b4', O: '#ff9a3a', N: '#3a9a7a', P: '#8a5ac8', W: '#ffffff' },
    eyes: [[3, 4], [6, 4]], eyeC: '#ff8a1c', hand: '#9aa3b4',
  },
  {
    id: 'ambassador', name: tr('EMBAIXADOR DA CACHOEIRA'), desc: tr('Faixa, medalha e terno. Trouxe gente nova pro rio e foi condecorado pelos lambaris.'), price: null, ach: 'invitenew',
    rows: ['..oooooo..', '.oHHHHHHo.', 'oHHHHHHHHo', 'oHssssssHo', '.osssssso.', '.osssssso.', '.ossmmsso.', '..oBBRBo..', '.oBBRYBBo.', 'oBBRBBBBBo'],
    pal: { o: '#1a1a1a', H: '#3a2a1a', s: '#e0ac69', m: '#7a3a2a', B: '#1a2a4a', R: '#c0283a', Y: '#ffd23f' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#e0ac69', trail: 'gold',
  },
  // ---- Chaplin + Chapolin, and the slimming pen ----
  {
    id: 'chaplolin', name: tr('CHAPLOLIN'), desc: tr('Chapéu-coco, bigodinho, antenas de vinil e uma marreta biônica. Metade vagabundo do cinema mudo, metade herói atrapalhado. Não contavam com sua astúcia!'), price: null, ach: 'astucia', ox: 5,
    rows: ['.A......A..YYY', '..a....a...RRR', '..oKKKKo...YYY', '..oKKKKo....h.', 'oKKKKKKKKo..h.', 'oRssssssRo..h.', 'oRssssssRo..h.', 'oRssMMssRo..h.', '.oRssssRo...h.', 'oRRAAAARRo..h.', 'oRRRAARRRo..h.'],
    pal: { A: '#ffd23f', a: '#e8b020', o: '#1a0a0a', K: '#1a1a1a', R: '#d62828', s: '#f1c27d', M: '#111111', Y: '#ffd23f', h: '#c89a5a' },
    eyes: [[3, 6], [6, 6]], eyeC: '#1a1a1a', hand: '#d62828', trail: 'hearts',
  },
  {
    id: 'canetinha', name: tr('TIO DA CANETINHA'), desc: tr('Comprou a canetinha emagrecedora da moda e ainda desce cachoeira pra queimar o resto. Já perdeu 8 kg e o medo.'), price: null, ach: 'mounja',
    rows: ['...oooo...', '..oHHHHo..', '.oHHHHHHo.', 'oRRWRRWRRo', 'osssssssso', 'osssssssso', 'osssssssDo', 'ossmmmmsso', '.osssssso.', 'oTTTTTTTTo'],
    pal: { o: '#2a1a08', H: '#5a3a1a', R: '#ff3b3b', W: '#ffffff', s: '#f1c27d', D: '#7fd3ff', m: '#7a3a2a', T: '#3dbf5a' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#f1c27d', trail: 'bubbles',
  },
  // ---- diamond-only (BANCO) ----
  {
    id: 'king', name: tr('REI DA CACHOEIRA'), desc: tr('Coroa de ouro, capa de veludo e barba de respeito. Comprou a cachoeira inteira com diamantes. A pedra não sabe disso.'), price: null, gems: 12,
    rows: ['.Y..Y..Y..', '.YRYYYBY..', '.YYYYYYY..', 'oVVVVVVVVo', 'osssssssso', 'osssssssso', 'oBsBBBBsBo', '.oBBBBBBo.', 'oVWVVVVWVo', 'oVVVVVVVVo'],
    pal: { Y: '#ffd23f', R: '#e8342a', B: '#8a5a2a', o: '#2a1206', V: '#9b1a3a', s: '#f1c27d', W: '#ffffff' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#f1c27d', trail: 'gold',
  },
  {
    id: 'dragon', name: tr('DRAGÃO'), desc: tr('Chifres, escamas e fumaça saindo do nariz. Guardava um tesouro de diamantes e trocou tudo por um barril.'), price: null, gems: 20, monster: true,
    rows: ['.H......H.', '.HH....HH.', '..oooooo..', '.oGGGGGGo.', 'oGGLGGLGGo', 'oGGGGGGGGo', 'oGGGGGGGGo', 'oGNGGGGNGo', '.oGTTTTGo.', 'oGGGGGGGGo'],
    pal: { H: '#e8dcc0', o: '#0a2a12', G: '#2fa84a', L: '#7ae08a', N: '#0a2a12', T: '#ffffff' },
    eyes: [[3, 5], [6, 5]], eyeC: '#ffd23f', hand: '#2fa84a', trail: 'fire',
  },
  // ---- heroes (parodies) and the atomic physicist ----
  {
    id: 'aranha', name: tr('HOMEM-ARRANHA'), desc: tr('Picado por uma pedra radioativa, agora arranha tudo no caminho. Com grandes poderes vêm grandes raspadas.'), price: null, ach: 'aranha',
    rows: ['..oRRRRo..', '.oRkRRkRo.', 'oRRkRRkRRo', 'okkkkkkkko', 'oRWWRRWWRo', 'oRWWRRWWRo', 'okRRkkRRko', 'oRRkRRkRRo', '.oRRkkRRo.', 'oBBBRRBBBo'],
    pal: { o: '#2a0606', R: '#d62828', k: '#5a0a0a', W: '#ffffff', B: '#1a4ad0' },
    eyes: [], eyeC: '#000000', hand: '#d62828',
  },
  {
    id: 'molhadao', name: tr('O INCRÍVEL MOLHADÃO'), desc: tr('Cientista calmo até levar o primeiro respingo. Aí fica verde, enorme e rasga a camisa.'), price: 360,
    rows: ['.oKKKKKKo.', 'oKKKKKKKKo', 'oGGGGGGGGo', 'oGgGGGGgGo', 'oGGGGGGGGo', 'oGGGGGGGGo', 'oGgMMMMgGo', '.oGGGGGGo.', 'oPPGGGGPPo', 'oPPPPPPPPo'],
    pal: { o: '#0a2a08', K: '#111111', G: '#4caf3a', g: '#2e7a22', M: '#1a3a12', P: '#6a2a9a' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#4caf3a',
  },
  {
    id: 'barrilha', name: tr('MULHER-BARRILHA'), desc: tr('Princesa guerreira de uma ilha escondida. Tiara, braceletes e um laço que faz qualquer pedra dizer a verdade.'), price: 320,
    rows: ['..oKKKKo..', '.oKKKKKKo.', 'oKYYRYYYKo', 'oKssssssKo', 'oKssssssKo', 'oKssssssKo', 'oKssmmssKo', 'KKssssssKK', 'KRRYYYYRRK', 'KRRRRRRRRK'],
    pal: { o: '#1a0a06', K: '#1a1210', Y: '#ffd23f', R: '#c81e1e', s: '#e0ac69', m: '#c0283a' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a3a8a', hand: '#e0ac69',
  },
  {
    id: 'batima', name: tr('BATIMÁ'), desc: tr('Bilionário de capa preta que só sai de noite. Comprou o barril com diamantes, claro.'), price: null, gems: 15,
    rows: ['.K......K.', '.KK....KK.', '.KKKKKKKK.', 'oKKKKKKKKo', 'oKWWKKWWKo', 'oKKKKKKKKo', 'oKssssssKo', 'oKssmmssKo', '.oKssssKo.', 'oKKYYYYKKo'],
    pal: { o: '#000000', K: '#1a1a24', W: '#ffffff', s: '#f1c27d', m: '#7a3a2a', Y: '#ffd23f' },
    eyes: [], eyeC: '#000000', hand: '#1a1a24', trail: 'smoke',
  },
  {
    id: 'superhomi', name: tr('SUPER-HOMI'), desc: tr('Veio de outro planeta e foi criado em Minas. Voa, enxerga através da pedra e fala uai.'), price: null, ach: 'superhomi',
    rows: ['..oKKKKo..', '.oKKKKKKo.', 'oKKKKKKKKo', 'oKssKsssKo', 'oKssssssKo', '.osssssso.', '.ossmmsso.', '..oBBBBo..', 'RoBBYYBBoR', 'RRBYRRYBRR'],
    pal: { o: '#0a1a3a', K: '#111111', s: '#f1c27d', m: '#7a3a2a', B: '#2a5ad0', Y: '#ffd23f', R: '#d62828' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a3a8a', hand: '#2a5ad0',
  },
  {
    id: 'fechahaimer', name: tr('FECHAHAIMER'), desc: tr('Físico de chapéu e cachimbo. Abriu a era atômica e agora fecha tudo: o app, a porta, a cachoeira.'), price: null, ach: 'fechahaimer',
    rows: ['..oHHHHo..', '.oHHHHHHo.', 'HHHHhhHHHH', '.oKssssKo.', '.osssssso.', '.osssssso.', '.ossmmssoP', '..osssso..', '.oGGWWGGo.', 'oGGGTTGGGo'],
    pal: { o: '#1a1410', H: '#8a7a5a', h: '#3a2e1e', K: '#3a2a1a', s: '#e8c8a0', m: '#9a5a4a', P: '#6a4a2a', G: '#5a5e66', W: '#ffffff', T: '#2a2a3a' },
    eyes: [[3, 4], [6, 4]], eyeC: '#5ab0ff', hand: '#e8c8a0', trail: 'smoke',
  },
  // ---- TV hosts (parodies) ----
  {
    id: 'chachu', name: tr('CHACHU'), desc: tr('Rainha dos baixinhos, loira de botas brancas. Desce na nave cantando ilarilariê e manda beijinho no final.'), price: null, ach: 'chachu',
    rows: ['.oYYYYYYo.', 'oYYYYYYYYo', 'YYYyyyyYYY', 'YYssssssYY', 'YYssssssYY', 'YYssssssYY', 'YYssmmssYY', 'YY.ossso.Y', 'Y.oWWRWWo.', '.oWWWWWWo.'],
    pal: { o: '#3a2a08', Y: '#ffe680', y: '#f2c94c', s: '#f1c8a0', m: '#e0306a', W: '#ffffff', R: '#ff6fb5' },
    eyes: [[3, 4], [6, 4]], eyeC: '#3d8fe0', hand: '#f1c8a0', trail: 'rainbow',
  },
  {
    id: 'anjelica', name: tr('ANJÉLICA'), desc: tr('Loira de sorriso largo que não anda de barco nem de ônibus. Pra descer a cachoeira? Vai de táxi.'), price: null, ach: 'anjelica',
    rows: ['..oYYYYo..', '.oYYYYYYo.', 'oYYyyyyYYo', 'oYssssssYo', 'oYssssssYo', 'oYssssssYo', 'oYsmmmmsYo', 'YY.ossso.Y', '.oPPPPPPo.', 'oPPPWWPPPo'],
    pal: { o: '#3a2a08', Y: '#f2d27a', y: '#d9b04a', s: '#f1c8a0', m: '#c0283a', P: '#9b4dca', W: '#ffd23f' },
    eyes: [[3, 4], [6, 4]], eyeC: '#2a6a3a', hand: '#f1c8a0', trail: 'gold',
  },
  // ---- myths: Greek gods and Brazilian folklore ----
  {
    id: 'cupido', name: tr('CUPIDO'), desc: tr('Bebê de asinhas, arco e flecha. Junta piloto com barril e não erra uma flechada.'), price: null, ach: 'cupido',
    rows: ['..oYyYYo..', '.oYYyYYyo.', 'oYyYYYyYYo', '.osssssso.', '.osssssso.', '.oRssssRo.', '.ossmmsso.', 'W.osssso.W', 'WWossssoWW', '.WsPPPPsW.'],
    pal: { o: '#5a3a10', Y: '#ffd23f', y: '#e8b020', s: '#ffd8c0', R: '#ff9ab0', m: '#e0306a', W: '#ffffff', P: '#ff6fb5' },
    eyes: [[3, 4], [6, 4]], eyeC: '#3d8fe0', hand: '#ffd8c0', trail: 'hearts',
  },
  {
    id: 'zeus', name: tr('ZEUS'), desc: tr('Rei dos deuses, barba branca e um raio na mão. Quando cai tempestade na cachoeira, é ele brincando.'), price: null, ach: 'zeus',
    rows: ['.oGgGGgGo.', 'oWWWWWWWWo', 'oWssssssWo', 'oWssssssWo', 'oWssssssWo', 'oWWsmmsWWo', '.oWWWWWWo.', '..oWWWWo..', '.oTTWWTTo.', 'oTTTGGTTTo'],
    pal: { o: '#2a2a3a', G: '#ffd23f', g: '#c99a1a', W: '#f4f4f8', s: '#e8c8a0', m: '#9a5a4a', T: '#c8d8f0' },
    eyes: [[3, 3], [6, 3]], eyeC: '#3d8fe0', hand: '#e8c8a0', trail: 'spark',
  },
  {
    id: 'poseidon', name: tr('POSEIDON'), desc: tr('Deus dos mares, de coroa e tridente. Veio ver de perto essa água doce que todo mundo comenta.'), price: null, gems: 15,
    rows: ['.G..GG..G.', '.GGGGGGGG.', 'oAAAAAAAAo', 'oAssssssAo', 'oAssssssAo', 'oAAsmmsAAo', '.oAAAAAAo.', '..oAAAAo..', '.osssssso.', 'oBBssssBBo'],
    pal: { o: '#0a2a2a', G: '#ffd23f', A: '#2ab0a0', s: '#d8a878', m: '#5a2a1a', B: '#1a4ad0' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#d8a878', trail: 'foam',
  },
  {
    id: 'medusa', name: tr('MEDUSA'), desc: tr('Cabelo de cobra e um olhar que petrifica. As pedras da cachoeira? Eram turistas.'), price: 360,
    rows: ['S.S.SS.S.S', '.SSeSSeSS.', 'SSSSSSSSSS', 'oSggggggSo', 'oSggggggSo', 'oSggggggSo', 'SSggmmggSS', 'S.ogggo..S', '.oGGGGGGo.', 'oGGGGGGGGo'],
    pal: { o: '#1a2a0a', S: '#4caf3a', e: '#e8342a', g: '#b8d8a0', m: '#6a1a2a', G: '#c99a1a' },
    eyes: [[3, 4], [6, 4]], eyeC: '#ffd23f', hand: '#b8d8a0', trail: 'smoke',
  },
  {
    id: 'saci', name: tr('SACI'), desc: tr('Uma perna só, gorro vermelho e cachimbo. Pula no barril, dá risada e some num redemoinho.'), price: null, ach: 'saci',
    rows: ['...oRRo...', '..oRRRRo..', '.oRRRRRRo.', '.oKKKKKKo.', '.oKKKKKKo.', '.oKKKKKKoP', '.oKKmmKKPP', '..oKKKKo..', '..oKKKKo..', '.oKRRRRKo.'],
    pal: { o: '#1a0a04', R: '#e8342a', K: '#7a4a2a', m: '#f4ece0', P: '#8a5a2a' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#7a4a2a', trail: 'smoke',
  },
  {
    id: 'iara', name: tr('IARA'), desc: tr('A mãe-d\'água dos rios. Canta tão bonito que até as pedras saem do caminho.'), price: null, ach: 'iara',
    rows: ['..oNNNNo..', '.oNNNNNNo.', 'oNNssssNNo', 'oNssssssNo', 'oNssssssNo', 'NNssmmssNN', 'NNNosssoNN', 'NNossssoNN', 'NoCCssCCoN', 'NossssssoN'],
    pal: { o: '#0a1a10', N: '#1a5a3a', s: '#c68642', m: '#c0283a', C: '#ff9ab0' },
    eyes: [[3, 4], [6, 4]], eyeC: '#2ab0a0', hand: '#c68642', trail: 'bubbles',
  },
  {
    id: 'curupira', name: tr('CURUPIRA'), desc: tr('Cabelo de fogo e pés virados pra trás. Quem segue as pegadas dele vai parar no começo da cachoeira.'), price: null, ach: 'curupira',
    rows: ['F.F.FF.F.F', '.FFFFFFFF.', 'FFFFFFFFFF', 'oFssssssFo', 'oFssssssFo', '.osssssso.', '.ossmmsso.', '..osssso..', '.oLLLLLLo.', 'oLlLLlLLlo'],
    pal: { o: '#2a0a04', F: '#ff5a1a', s: '#c68642', m: '#6a2a1a', L: '#3a8a2a', l: '#7acc4a' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#c68642', trail: 'fire',
  },
  // ---- phone extras (steps, headphones) ----
  {
    id: 'corredor', name: tr('ATLETA DE FIM DE SEMANA'), desc: tr('Faixa na testa, regata e um relógio que conta cada passo. Correu 2 km e já quer medalha.'), price: null, ach: 'steps2k', alt: 240,
    rows: ['..oHHHHo..', '.oHHHHHHo.', 'oRRRWRRRRo', 'osssssssso', 'osssssssso', 'osssssssDo', '.ossmmsso.', '..osssso..', '.oTTTTTTo.', 'oTTWWWWTTo'],
    pal: { o: '#2a1a08', H: '#5a3a1a', R: '#e8342a', W: '#ffffff', s: '#e0ac69', D: '#7fd3ff', m: '#7a3a2a', T: '#ff8a1c' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#e0ac69',
  },
  {
    id: 'dj', name: tr('DJ DA CACHOEIRA'), desc: tr('Fone gigante, camiseta neon e um remix da cachoeira tocando no último volume.'), price: null, ach: 'fone', alt: 240,
    rows: ['..oKKKKo..', '.PKKKKKKP.', 'PPKKKKKKPP', 'PPssssssPP', 'PPssssssPP', '.osssssso.', '.ossmmsso.', '..osssso..', '.oNNNNNNo.', 'oNNNNNNNNo'],
    pal: { o: '#1a1a1a', K: '#2a1a10', P: '#1a1a1a', s: '#c68642', m: '#6a2a1a', N: '#3bf0ff' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#c68642', trail: 'notes',
  },
  // ---- from codes (hidden until redeemed) ----
  {
    id: 'bartolomeu', name: tr('BARTOLOMEU'), desc: tr('O panda da Codecon. Olheira de quem fez deploy na sexta, café na mão e zero pressa. Let\'s code a better world.'), price: null, hidden: true, ox: 5,
    rows: ['.KK....KK....', 'KKKwwwwKKK...', '.Kwwwwwwk....', 'wKKwwwwKKw...', 'wKYKwwKYKw.MM', 'wwKKwwKKwwMMM', 'wwwwNNwwwwMMM', 'wwwwwwmmwwMMM', '.wswwwwsw..MM', 'KKKwwwwKKK...'],
    pal: { K: '#1a1a1e', w: '#e8e8ea', k: '#c8c8cc', Y: '#f0e6b0', N: '#4a4448', m: '#2a2a2e', s: '#9a9aa0', M: '#b8a070' },
    eyes: [[2, 4], [7, 4]], eyeC: '#111111', hand: '#1a1a1e', trail: 'steam',
  },
  // ---- backlog: history, detectives, parodies, family ----
  {
    id: 'annie', name: tr('TIA ANNIE'), desc: tr('Primeira pessoa a descer uma cachoeira num barril (1901). Antes, mandou a gata de teste. Hoje tem 37 gatos.'), price: null, ach: 'annie',
    rows: ['...oGGo...', '..oGGGGo..', '.oGGGGGGo.', 'oGssssssGo', 'oKWKssKWKo', '.osssssso.', '.ossmmsso.', '.oDDDDDoCC', 'oDDDDDDDCC', 'oDDDYDDDCo'],
    pal: { o: '#2a1a1a', G: '#c8c8d0', s: '#f1c8a0', K: '#2a2a2a', W: '#dfefff', m: '#b05a5a', D: '#2a2030', C: '#f08a24', Y: '#ffd23f' },
    eyes: [[2, 4], [7, 4]], eyeC: '#1a1a1a', hand: '#f1c8a0',
  },
  {
    id: 'gatovoa', name: tr('GATO ARCO-ÍRIS'), desc: tr('Voa pelo espaço deixando um arco-íris. Caiu na cachoeira e achou que era outra galáxia.'), price: 300,
    rows: ['o........o', 'oGo....oGo', 'oGGooooGGo', 'oGGGGGGGGo', 'oGgGGGGgGo', 'oGGGGGGGGo', 'oPGGGGGGPo', 'oGGGnnGGGo', 'oGGGGGGGGo', '.oooooooo.'],
    pal: { o: '#2a2a32', G: '#9aa3ae', g: '#6d7580', P: '#ff9fb0', n: '#ff7a9a' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#9aa3ae', trail: 'rainbow',
  },
  {
    id: 'sherlock', name: tr('SHERLOCK HOLMES'), desc: tr('O detetive de Baker Street. Deduziu pelo barro na bota que você vai bater na próxima pedra.'), price: null, ach: 'sherlock',
    rows: ['..oTtTto..', '.oTtTtTto.', 'oTtTtTtTto', '.osssssso.', '.osssssso.', '.osssssso.', '.ossssPPP.', '..osssoP..', '.oCCCCCCo.', 'oCCCWCCCCo'],
    pal: { o: '#1a1208', T: '#8a6a4a', t: '#5a442e', s: '#f1c27d', P: '#4a2a14', C: '#6a5a48', W: '#dfdfdf' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#f1c27d',
  },
  {
    id: 'xerife', name: tr('XERIFE DE BRINQUEDO'), desc: tr('Puxa a cordinha: "TEM UMA PEDRA NA MINHA BOTA!". Veio do quarto de uma criança, de barril.'), price: null, ach: 'xerife',
    rows: ['...oooo...', '..oBBBBo..', '.oBBBBBBo.', 'BBBBBBBBBB', '.osssssso.', '.osssssso.', '.ossmmsso.', '..oRRRRo..', '.oYKYYKYo.', 'oKYWYYWYKo'],
    pal: { o: '#2a1808', B: '#c98a3a', s: '#f1c27d', m: '#7a1d1d', R: '#d62828', Y: '#ffd23f', K: '#1a1a1a', W: '#ffffff' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#f1c27d',
  },
  {
    id: 'arquiteto', name: tr('ARQUITETO'), desc: tr('Crianças, essa é a história de como eu conheci a cachoeira. Ele trouxe o guarda-chuva amarelo, claro.'), price: null, ach: 'arquiteto',
    rows: ['..oYYYYo..', 'oYYYYYYYYo', '....oo....', '.oHHHHHHo.', 'oHssssssHo', 'osssssssso', '.ossmmsso.', '..osssso..', '.oJJWWJJo.', 'oJJJWTJJJo'],
    pal: { Y: '#ffd23f', o: '#2a2018', H: '#5a3a1e', s: '#f1c27d', m: '#a05050', J: '#2e3a5a', W: '#ffffff', T: '#c02828' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#f1c27d',
  },
  {
    id: 'quimico', name: tr('PROFESSOR DE QUÍMICA'), desc: tr('Dava aula, agora desce cachoeira. Diz que ele não está em perigo: ele É o perigo.'), price: null, ach: 'quimico',
    rows: ['...oooo...', '..oKKKKo..', '.oKKKKKKo.', 'KKKKKKKKKK', '.osssssso.', 'oKWKssKWKo', '.osssssso.', '.osGGGGso.', '..osGGso..', 'oYYYKKYYYo'],
    pal: { o: '#1a1a1a', K: '#1a1a1a', s: '#f1c27d', W: '#dfefff', G: '#7a6a4a', Y: '#e8d23a' },
    eyes: [[2, 5], [7, 5]], eyeC: '#1a1a1a', hand: '#e8d23a',
  },
  {
    id: 'voo815', name: tr('SOBREVIVENTE DO VOO'), desc: tr('O avião caiu numa ilha esquisita. Ele achou um barril e foi embora. Ou será que não?'), price: null, ach: 'numeros',
    rows: ['..o.oo.o..', '.oHHHHHHo.', 'oHHHHHHHHo', 'oHssssssHo', 'osssssssso', 'oBssssssBo', '.oBBmmBBo.', '..oBBBBo..', '.oWWAWWWo.', 'oWWWAWWWWo'],
    pal: { o: '#1e1208', H: '#3a2410', s: '#e0a878', B: '#5a3a1e', m: '#7a3030', W: '#e8e2d0', A: '#4a6a3a' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#e0a878',
  },
  {
    id: 'jogador', name: tr('JOGADOR 456'), desc: tr('Entrou num jogo de criança com prêmio de bilhões. Batatinha frita 1, 2, 3... e ele desceu a cachoeira.'), price: null, ach: 'batatinha',
    rows: ['..oooooo..', '.oHHHHHHo.', 'oHHHHHHHHo', 'oHssssssHo', 'osssssssso', 'osssssssso', '.ossmmsso.', '..osssso..', '.oGGWWGGo.', 'oGGWNNWGGo'],
    pal: { o: '#1a1a1a', H: '#1a1a1a', s: '#e8b88a', m: '#8a4a4a', G: '#2f8a6a', W: '#ffffff', N: '#1a1a1a' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#e8b88a',
  },
  {
    id: 'ladrao', name: tr('LADRÃO DE MACACÃO'), desc: tr('Macacão vermelho, máscara de bigode e um plano perfeito. O plano não previa a cachoeira.'), price: null, ach: 'assalto',
    rows: ['..oRRRRo..', '.oRRRRRRo.', 'oRRWWWWRRo', 'oRWWWWWWRo', 'oRWWWWWWRo', 'oRWKKKKWRo', 'oRWWmmWWRo', '.oRWWWWRo.', '.oRRRRRRo.', 'oRRRRRRRRo'],
    pal: { o: '#3a0505', R: '#c41e1e', W: '#f4f0e8', K: '#1a1a1a', m: '#c06060' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#1a1a1a',
  },
  {
    id: 'nortista', name: tr('REI DO NORTE'), desc: tr('Não sabe de nada, mas sabe descer cachoeira. O inverno chegou, e o barril também.'), price: null, ach: 'inverno',
    rows: ['.oHHHHHHo.', 'oHHHHHHHHo', 'oHssssssHo', 'oHssssssHo', 'oHssssssHo', '.osBBBBso.', '..oBmmBo..', 'FFoBBBBoFF', 'FFFLLLLFFF', 'oFFLLLLFFo'],
    pal: { o: '#120d0a', H: '#1a1410', s: '#e8c09a', B: '#3a2a20', m: '#8a4a4a', F: '#8a8478', L: '#2a2a2a' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#e8c09a',
  },
  {
    id: 'fisico', name: tr('FÍSICO TEÓRICO'), desc: tr('QI de 187, camiseta de super-herói e um lugar fixo no sofá. Calculou a cachoeira e errou por um barril.'), price: null, ach: 'toctoc',
    rows: ['..oooooo..', '.oHHHHHHo.', 'oHHHHHHHHo', 'oHHssssHHo', 'osssssssso', 'osssssssso', '.ossmmsso.', '..osssso..', '.oQQYYQQo.', 'oLQYRRYQLo'],
    pal: { o: '#1a1208', H: '#3a2418', s: '#f1c27d', m: '#a05050', Q: '#2a5ab8', Y: '#ffd23f', R: '#d62828', L: '#8a8a8a' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#f1c27d',
  },
  {
    id: 'mae', name: tr('MÃE'), desc: tr('Já falou pra não descer cachoeira. Agora desce junto, de casaco, porque vai esfriar.'), price: null, ach: 'maes',
    rows: ['..oHHHHo..', '.oHHHHHHo.', 'oHHssssHHo', 'oHssssssHo', 'oHssssssHo', 'oHssssssHo', 'oHssRRssHo', '.oHssssHo.', '.oPPWWPPo.', 'oPPPPPPPPo'],
    pal: { o: '#2a1208', H: '#6a3a1e', s: '#f1c27d', R: '#d62860', P: '#e85a9a', W: '#ffffff' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#f1c27d',
  },
  {
    id: 'pai', name: tr('PAI'), desc: tr('Pavê ou pacomê? Desce a cachoeira de chinelo e meia e diz que no tempo dele era mais alta.'), price: null, ach: 'pais',
    rows: ['..oooooo..', '.oHHHHHHo.', 'oHHsssssHo', 'osssssssso', 'osssssssso', 'osssssssso', '.osBBBBso.', '.ossmmsso.', '.oCCCCCCo.', 'oCCWCCWCCo'],
    pal: { o: '#1a1208', H: '#4a3020', s: '#f1c27d', B: '#4a3020', m: '#a05050', C: '#3a7ab8', W: '#ffffff' },
    eyes: [[3, 4], [6, 4]], eyeC: '#1a1a1a', hand: '#f1c27d',
  },
  // sensor tricks, lightning, parodies and the LENDÁRIO
  {
    id: 'sonambulo', name: tr('SONÂMBULO'), desc: tr('Touca, pijama listrado e olho fechado. Dormiu no sofá e acordou na cachoeira. Ou ainda tá dormindo.'), price: null, ach: 'soneca', alt: 180,
    rows: ['..oooo..WW', '.oBBBBooWW', 'oBBBBBBBo.', 'oWWWWWWWWo', 'osssssssso', 'osssssssso', 'osssssssso', '.osssmsso.', '.oPpPpPpo.', 'oPpPpPpPpo'],
    pal: { o: '#1a1a2a', B: '#3a5ab8', W: '#ffffff', s: '#f1c27d', m: '#a05050', P: '#bfe3ff', p: '#7fa8e0' },
    eyes: [[2, 5], [3, 5], [6, 5], [7, 5]], eyeC: '#7a4a2a', hand: '#f1c27d',
  },
  {
    id: 'escondido', name: tr('CONTA ATÉ DEZ'), desc: tr('Tapou os olhos pra contar até dez. Quando abriu, já estava descendo a cachoeira.'), price: null, ach: 'esconde', alt: 180,
    rows: ['..oooooo..', '.oHHHHHHo.', 'oHHHHHHHHo', 'oHssssssHo', 'ohhhhhhhho', 'ohfhhhhfho', 'osssssssso', '.ossmmsso.', '.oTTTTTTo.', 'oTTTTTTTTo'],
    pal: { o: '#2a1a0a', H: '#6a3a1e', s: '#f1c27d', h: '#e8b070', f: '#b8854a', m: '#a05050', T: '#ff9f1c' },
    eyes: [], eyeC: '#1a1a1a', hand: '#e8b070',
  },
  {
    id: 'torcedor', name: tr('TORCEDOR DE ARQUIBANCADA'), desc: tr('Cara pintada, camisa da sorte e a garganta já rouca. Grita gol até quando bate na pedra.'), price: null, ach: 'crowdyell', alt: 260,
    rows: ['..oooooo..', '.oGGGGGGo.', 'oGGGGGGGGo', 'oYYYYYYYYo', 'osssssssso', 'osssssssso', 'oGYssssGYo', '.osKKKKso.', '.oGGYYGGo.', 'oGGGYYGGGo'],
    pal: { o: '#1a1a0a', G: '#1f9a46', Y: '#ffd23f', s: '#e0ac69', K: '#5a1a1a' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#e0ac69',
  },
  {
    id: 'maratonista', name: tr('MARATONISTA'), desc: tr('42 km nas pernas, medalha no peito e a manta prateada nas costas. Descer a cachoeira é o desaquecimento.'), price: null, ach: 'steps42k', alt: 400,
    rows: ['..oooooo..', '.oHHHHHHo.', 'oHHHHHHHHo', 'oRRRRRRRRo', 'osssssssso', 'osssssssso', 'osssssssso', '.ossmmsso.', '.oAAYYAAo.', 'oAaAYYAaAo'],
    pal: { o: '#1a1208', H: '#2a1a10', R: '#d62828', s: '#8a5a3a', m: '#5a2a2a', A: '#dde3ea', a: '#9aa2b3', Y: '#ffd23f' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#8a5a3a',
  },
  {
    id: 'arrepiado', name: tr('ARREPIADO'), desc: tr('Levou um raio na cachoeira e o cabelo nunca mais baixou. Agora acende lâmpada com a mão.'), price: null, ach: 'raio', trail: 'spark',
    rows: ['.H..H..H..', '.HH.HH.HH.', 'oHHHHHHHHo', 'oHHHHHHHHo', 'osssssssso', 'osssssssso', 'osksssskso', '.ossKKsso.', '.oCCCCCCo.', 'oCcCCCCcCo'],
    pal: { o: '#1a1a1a', H: '#f4f0d0', s: '#e8c09a', k: '#8a7a6a', K: '#3a1010', C: '#5a5a5a', c: '#3a3a3a' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#e8c09a',
  },
  {
    id: 'dummy', name: tr('BONECO DE TESTE'), desc: tr('Amarelo, com alvo na testa e cinto de segurança. Bateu em 3 mil paredes e ainda topa a cachoeira.'), price: null, ach: 'impacto',
    rows: ['..oooooo..', '.oYYYYYYo.', 'oYYKWYYYYo', 'oYYWKYYYYo', 'oYYYYYYYYo', 'oYYYYYYYYo', 'oYYYYYYYYo', '.oYYYYYYo.', '.oBBBBGGo.', 'oBBBGGBBBo'],
    pal: { o: '#2a2306', Y: '#ffd23f', K: '#1a1a1a', W: '#ffffff', B: '#2a3a5a', G: '#9aa2b3' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#ffd23f',
  },
  {
    id: 'schrodinger', name: tr('GATO DE SCHRÖDINGER'), desc: tr('Metade gato, metade fantasma. Está vivo e morto ao mesmo tempo até alguém abrir o barril.'), price: null, ach: 'schrodinger', trail: 'ghost',
    rows: ['o........o', 'oPo....oQo', 'oPPooooQQo', 'oCCCCGGGGo', 'oCcCCGGgGo', 'oCCCCGGGGo', 'oCCCCGGGGo', 'oWCCnnGGWo', 'oCCCCGGGGo', '.oooooooo.'],
    pal: { o: '#1a1a2a', P: '#ff9fb0', Q: '#e8f0ff', C: '#8a8a9a', c: '#5a5a6a', G: '#dfe8ff', g: '#b8c8e8', n: '#ff7a9a', W: '#ffffff' },
    eyes: [[3, 6], [6, 6]], eyeC: '#1a1a1a', hand: '#8a8a9a',
  },
  {
    id: 'escolhido', name: tr('O ESCOLHIDO'), desc: tr('Sobretudo preto, óculos escuros e nenhuma pressa. Desvia das pedras em câmera lenta. Tomou a pílula errada e veio parar aqui.'), price: null, ach: 'escolhido', trail: 'code',
    rows: ['..oooooo..', '.oHHHHHHo.', 'oHHHHHHHHo', 'oHssssssHo', 'osssssssso', 'oKKKssKKKo', 'osssssssso', '.ossmmsso.', '.oKKssKKo.', 'oKKKssKKKo'],
    pal: { o: '#0a0a0a', H: '#1a1a1a', s: '#e8c09a', K: '#161616', m: '#a06060' },
    eyes: [[2, 5], [7, 5]], eyeC: '#3ddc5a', hand: '#e8c09a',
  },
  {
    id: 'bruxo', name: tr('BRUXINHO DE ÓCULOS'), desc: tr('Óculos redondos, cicatriz de raio e cachecol listrado. Pegou o barril achando que era vassoura.'), price: null, ach: 'pomo', trail: 'magic',
    rows: ['.o.oooo.o.', 'oHHHHHHHHo', 'oHHHHHHHHo', 'oHsssZssHo', 'ossGssGsso', 'osGsGGsGso', 'ossGssGsso', '.ossmmsso.', '.oRYRYRYo.', 'oKKRYRYKKo'],
    pal: { o: '#120a06', H: '#1a1410', s: '#f1c27d', Z: '#c84a4a', G: '#3a3a3a', m: '#a05050', R: '#8a1a1a', Y: '#d9a514', K: '#1a1a1a' },
    eyes: [[3, 5], [6, 5]], eyeC: '#2a6a3a', hand: '#f1c27d',
  },
  {
    id: 'tributa', name: tr('TRIBUTA'), desc: tr('Trança de lado, broche de pássaro e flecha nas costas. Se ofereceu no lugar da irmã pra descer a cachoeira.'), price: null, ach: 'emchamas', alt: 320, trail: 'fire',
    rows: ['..oHHHHo.F', '.oHHHHHHoA', 'oHHHHHHHHo', 'oHssssssHo', 'oHssssssHo', 'oHssssssHo', 'oHssssssHo', 'Hossmmsso.', 'HoJJYJJJo.', 'HJJJJJJJJo'],
    pal: { o: '#1a1208', H: '#3a2410', s: '#e0b088', m: '#a05050', J: '#3a4a3a', Y: '#ffd23f', F: '#d62828', A: '#8a5a2e' },
    eyes: [[3, 5], [6, 5]], eyeC: '#3a3a4a', hand: '#e0b088',
  },
  {
    id: 'genio', name: tr('GÊNIO DO LABORATÓRIO'), desc: tr('Cabelo laranja, óculos fundo de garrafa e jaleco. Tem um laboratório secreto no quarto e uma irmã que aperta todos os botões.'), price: 290,
    rows: ['..oooooo..', '.oOOOOOOo.', 'oOOOOOOOOo', 'oOssssssOo', 'oKKKKKKKKo', 'oKWWKKWWKo', 'osssssssso', '.ossmmsso.', '.oWWWWWWo.', 'oWWWKKWWWo'],
    pal: { o: '#1a1208', O: '#ff7a1c', s: '#f1c27d', K: '#1a1a1a', W: '#ffffff', m: '#a05050' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#9b4dca',
  },
  // movie and cartoon parodies
  {
    id: 'perito', name: tr('PERITO EM RESPINGOS'), desc: tr('Analista de respingos da polícia de Miami. Estuda cada gota da cachoeira e anota tudo. Tem um código: nenhum respingo sem análise.'), price: null, ach: 'respingos',
    rows: ['..oooooo..', '.oHHHHHHo.', 'oHHHHHHHHo', 'oHssssssHo', 'osssssssso', 'osssssssso', 'osssssssso', '.ossmmsso.', '.oGGssGGo.', 'oGGGGGGGGo'],
    pal: { o: '#1a1208', H: '#5a3a1e', s: '#f1c27d', m: '#a05050', G: '#6a7a6a' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#f1c27d',
  },
  {
    id: 'avatar', name: tr('GIGANTE AZUL'), desc: tr('Três metros, pele azul e trança comprida. Veio de uma lua cheia de árvores que brilham. Eu vejo você, pedra.'), price: 340,
    rows: ['..oooooo..', '.oHHHHHHo.', 'oHHHHHHHHo', 'oBbBBBBbBo', 'BBBBBBBBBB', 'oBBBBBBBBo', 'oBbBBBBbBo', '.oBBmmBBo.', '.oNNNNNNo.', 'oNNBBBBNNo'],
    pal: { o: '#0a1a2a', H: '#1a1a1a', B: '#3d8fe0', b: '#7fbfff', m: '#1f3f7a', N: '#8a5a2e' },
    eyes: [[3, 5], [6, 5]], eyeC: '#ffd23f', hand: '#3d8fe0',
  },
  {
    id: 'guerreiro', name: tr('GUERREIRO DOURADO'), desc: tr('Cabelo espetado e dourado, roupa laranja e um grito que dura três episódios. O poder de luta dele passa de 8 mil.'), price: null, ach: 'esferas', trail: 'gold',
    rows: ['Y..Y..Y..Y', 'YY.YY.YYY.', '.YYYYYYYY.', 'oYYYYYYYYo', 'osssssssso', 'osssssssso', 'osssssssso', '.ossmmsso.', '.oOBBBBOo.', 'oOOOBBOOOo'],
    pal: { o: '#2a1a0a', Y: '#ffe066', s: '#f1c27d', m: '#a05050', O: '#ff8a1c', B: '#1f5fae' },
    eyes: [[3, 5], [6, 5]], eyeC: '#2ab8a0', hand: '#f1c27d',
  },
  {
    id: 'vocientista', name: tr('VÔ CIENTISTA'), desc: tr('Cabelo azul espetado, jaleco e uma pistola de portais. Arrastou o neto pra mais uma aventura de 20 minutos.'), price: null, ach: 'portal',
    rows: ['.C.C.C.C..', 'CCCCCCCCC.', '.CCCCCCCC.', 'oCssssssCo', 'osKKKKKKso', 'osssssssso', 'osssssssso', '.ossmmGso.', '.oWWBBWWo.', 'oWWWBBWWWo'],
    pal: { o: '#1a1a1a', C: '#bfe3ff', s: '#e8d8c0', K: '#7a8a9a', m: '#8a5a5a', G: '#9be0b0', W: '#ffffff', B: '#5ab8e0' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#e8d8c0',
  },
  {
    id: 'neto', name: tr('NETO NERVOSO'), desc: tr('Camiseta amarela e muita ansiedade. O vô disse que ia ser rapidinho.'), price: 180,
    rows: ['..oooooo..', '.oHHHHHHo.', 'oHHHHHHHHo', 'oHssssssHo', 'osssssssso', 'osssssssso', 'osssssssso', '.osmmmmso.', '.oYYYYYYo.', 'oYYYYYYYYo'],
    pal: { o: '#1a1208', H: '#6a3a1e', s: '#f1c27d', m: '#a05050', Y: '#ffe066' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#f1c27d',
  },
  {
    id: 'padrinho', name: tr('O PADRINHO'), desc: tr('Smoking, rosa vermelha na lapela e voz rouca. Fez à cachoeira uma oferta que ela não pôde recusar.'), price: null, ach: 'irrecusavel',
    rows: ['..oooooo..', '.oHHHHHHo.', 'oHHHHHHHHo', 'oHssssssHo', 'osssssssso', 'osssssssso', 'osssssssso', '.ossmmsso.', '.oKKWWKKo.', 'oKRKWWKKKo'],
    pal: { o: '#1a1208', H: '#9aa2b3', s: '#e0b088', m: '#8a4a4a', K: '#1a1a1a', W: '#ffffff', R: '#d62828' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#e0b088',
  },
  {
    id: 'mago', name: tr('MAGO CINZENTO'), desc: tr('Chapéu pontudo, barba até o joelho e um cajado. Grita pra pedra que ela não vai passar. Ela não se mexe mesmo.'), price: null, ach: 'naopassar', trail: 'magic',
    rows: ['....oo....', '...oGGo...', '..oGGGGo..', '.oGGGGGGo.', 'GGGGGGGGGG', 'oGssssssGo', 'osssssssso', 'oWWsmmsWWo', '.oWWWWWWo.', 'oGWWWWWWGo', '.oGWWWWGo.'],
    pal: { o: '#2a2a2a', G: '#8a8a9a', s: '#e8c09a', W: '#f4f4f4', m: '#8a6a6a' },
    eyes: [[3, 6], [6, 6]], eyeC: '#1a1a1a', hand: '#e8c09a',
  },
  {
    id: 'sabao', name: tr('VENDEDOR DE SABÃO'), desc: tr('Jaqueta de couro vermelha e óculos cor-de-rosa. A primeira regra do clube do barril é: não se fala do clube do barril.'), price: null, ach: 'insonia',
    rows: ['..o.oo.o..', '.oHHHHHHo.', 'oHHHHHHHHo', 'oHssssssHo', 'osssssssso', 'oKKKssKKKo', 'osssssssso', '.ossmmsso.', '.oRRWWRRo.', 'oRRRWWRRRo'],
    pal: { o: '#1a1208', H: '#8a6a3a', s: '#f1c27d', K: '#2a1a2a', m: '#a05050', R: '#a01818', W: '#e8d8c8' },
    eyes: [[2, 5], [7, 5]], eyeC: '#ff9fe0', hand: '#f1c27d',
  },
  {
    id: 'walle', name: tr('ROBOZINHO CATADOR'), desc: tr('Uma caixinha amarela com olhos de binóculo. Passou 700 anos juntando lixo e agora junta moedas na cachoeira.'), price: null, ach: 'walle',
    rows: ['..GG..GG..', '.GWWGGWWG.', '.GWWGGWWG.', '..GG..GG..', '....GG....', 'oYYYYYYYYo', 'oYyYYYYyYo', 'oYYYYYYYYo', 'oYYKKKKYYo', 'oyyyyyyyyo'],
    pal: { o: '#3a2a00', G: '#6a7280', W: '#dfe8ff', K: '#1a1a1a', Y: '#ffd23f', y: '#c99a1a' },
    eyes: [[3, 2], [7, 2]], eyeC: '#1a1a1a', hand: '#6a7280',
  },
  {
    id: 'messias', name: tr('MESSIAS DO DESERTO'), desc: tr('Traje de destilação, olhos azuis de especiaria e muita profecia. Nunca tinha visto tanta água junta.'), price: null, ach: 'duna',
    rows: ['..oooooo..', '.oHHHHHHo.', 'oHHHHHHHHo', 'oHssssssHo', 'osssssssso', 'osssssssso', 'oTTTTTTTTo', '.oTTTTTTo.', '.oTTDDTTo.', 'oTTTDDTTTo'],
    pal: { o: '#2a1a0a', H: '#3a2a1a', s: '#e0b088', T: '#8a7a5a', D: '#5a4a3a' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1f5fff', hand: '#8a7a5a',
  },
  {
    id: 'descalco', name: tr('POLICIAL DESCALÇO'), desc: tr('Regata suja, pé descalço e uma noite de Natal que não acaba. Duro de matar, mais duro ainda de afundar.'), price: null, ach: 'duro',
    rows: ['..oooooo..', '.oHHssHHo.', 'oHssssssHo', 'osssssssso', 'osssssssso', 'osssssssso', 'osssssssso', '.obbmmbbo.', '.oWWssWWo.', 'oWkWWWWWWo'],
    pal: { o: '#1a1208', H: '#5a3a1e', s: '#e8b88a', b: '#9a7a5a', m: '#8a4a4a', W: '#f4f0e8', k: '#a08a6a' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a1a1a', hand: '#e8b88a',
  },
  {
    id: 'cacafantasma', name: tr('CAÇADOR DE FANTASMAS'), desc: tr('Macacão bege, óculos de proteção e uma mochila que zumbe. Viu um vulto no print e veio atrás.'), price: null, ach: 'printghost', alt: 260,
    rows: ['..oooooo..', '.oHHHHHHo.', 'oHHHHHHHHo', 'oGGGGGGGGo', 'oGWGssGWGo', 'osssssssso', 'osssssssso', '.ossmmsso.', 'KoBBRBBBoK', 'KBBBRBBBBK'],
    pal: { o: '#1a1208', H: '#5a3a1e', G: '#3a3a3a', W: '#bfe3ff', s: '#f1c27d', m: '#a05050', B: '#c8b88a', R: '#d62828', K: '#5a5a66' },
    eyes: [[2, 4], [7, 4]], eyeC: '#1a1a1a', hand: '#3a3a3a',
  },
  {
    id: 'fenix', name: tr('FÊNIX'), desc: tr('Ave de fogo que renasce das cinzas. Já caiu na cachoeira mil vezes e voltou todas. LENDÁRIA.'), price: null, gems: 40, legend: true, trail: 'fire',
    rows: ['..Y...Y...', '.YOY.YOY..', '.OROOOROO.', 'oRRRRRRRRo', 'oRRRRRRRRo', 'oRRRRRRRRo', 'oRRRBBRRRo', '.oRRBBRRo.', '.oOROROOo.', 'oOYOYOYOYo'],
    pal: { o: '#3a0a00', Y: '#ffe066', O: '#ff8a1c', R: '#e8301e', B: '#ffd23f' },
    eyes: [[3, 5], [6, 5]], eyeC: '#1a0a00', hand: '#ff8a1c',
  },
];

// Each rider's matching barrel (shown in the shop; riding the pair counts for TÁ COMBINANDO!).
// Riders missing here have no fitting barrel yet.
const PAIRS = {
  classic: 'classic', cat: 'box', pirate: 'rum', ninja: 'bamboo', clown: 'confetti', viking: 'keg', robot: 'generator',
  astro: 'rocket', dino: 'egg', et: 'orelhao', santa: 'gift', witch: 'pumpkin', vampire: 'coffin', wolf: 'classic',
  zombie: 'radio', yeti: 'fridge', bigfoot: 'log', skeleton: 'coffin', mummy: 'temple', creature: 'generator',
  caramelo: 'trash', lapwing: 'corn', pony: 'grito', castaway: 'cooler', scientist: 'blender', angel: 'cloud',
  devil: 'lava', sponge: 'duck', marquio: 'pipe', handyman: 'toilet', stunt: 'armor', kid8: 'classic', cow: 'jug',
  beta: 'beta', ghost: 'washer', dumont: 'dumont', miner: 'charcoal', brickman: 'bricks', dev: 'debug', penguin: 'iceberg',
  jobis: 'pear', hitch: 'guide', cyborg: 'cyborgb', gates: 'bluescreen', trooper: 'armor', samurai: 'japan',
  gondolier: 'italy', guard: 'phone', cowboy: 'usa', mariachi: 'mexico', bunny: 'egg', vangogh: 'starry',
  picasso: 'cubist', mozart: 'piano', davinci: 'monalisa', civil: 'raft', cop: 'police', fireman: 'hydrant',
  doctor: 'ambulance', gamer: 'arcade', chef: 'cooker', courier: 'bag', milton: 'chest', faustino: 'tank',
  nazare: 'cubist', odete: 'gold', darklord: 'armor', sinister: 'toybox', nightmare: 'coffin', jackson: 'camp',
  relic: 'temple', incognito: 'box', tesla: 'coil', ada: 'analytic', darwin: 'tortoise', agent006: 'armor',
  professor: 'chalkboard', grillman: 'grill', farofa: 'flamingo', tiazap: 'chatbubble', blogueira: 'filter',
  viral: 'phonebarrel', tioface: 'orelhao', pigeon: 'paperplane', ambassador: 'envelope', chaplolin: 'mallet', canetinha: 'pen', king: 'diamondb', dragon: 'lava', bartolomeu: 'codecon', aranha: 'teia', molhadao: 'radio', barrilha: 'gold', batima: 'batbarril', superhomi: 'phone', fechahaimer: 'dispositivo', chachu: 'nave', anjelica: 'taxi', cupido: 'coracao', zeus: 'olimpo', poseidon: 'concha', medusa: 'estatua', saci: 'redemoinho', iara: 'vitoriaregia', curupira: 'boitata', corredor: 'squeeze', dj: 'arcade', unicorn: 'rainbowb',
  annie: 'b1901', gatovoa: 'rainbowb', sherlock: 'tweed', xerife: 'starball', arquiteto: 'umbrella', quimico: 'motorhome',
  voo815: 'hatch', jogador: 'gamebarrel', ladrao: 'vault', nortista: 'throne', fisico: 'quantum', mae: 'vaso', pai: 'toolbox',
  arrepiado: 'chuveiro', dummy: 'certificado', escolhido: 'matrix', schrodinger: 'box', bruxo: 'pumpkin', tributa: 'charcoal',
  cacafantasma: 'washer', perito: 'pericia', avatar: 'bioluz', guerreiro: 'esfera', vocientista: 'portal', neto: 'portal', padrinho: 'azeite',
  mago: 'elfo', sabao: 'sabaob', walle: 'trash', messias: 'verme', descalco: 'gift', nessie: 'camera', genio: 'analytic', sonambulo: 'cloud', escondido: 'box', torcedor: 'radio', maratonista: 'squeeze', fenix: 'galaxia',
};
for (const r of RIDER_SKINS) r.pair = BARREL_SKINS.some((b) => b.id === PAIRS[r.id]) ? PAIRS[r.id] : null;
// A barrel's original pair is its first rider in the list: the shop always shows it. The other
// riders that also match it stay secret until the player rides that pair 300 m (save.pairs).
const PAIR_FIRST = {};
for (const r of RIDER_SKINS) if (r.pair && !PAIR_FIRST[r.pair]) PAIR_FIRST[r.pair] = r.id;
const pairKnown = (riderId) => {
  const r = RIDER_SKINS.find((k) => k.id === riderId);
  return !!r && !!r.pair && (PAIR_FIRST[r.pair] === riderId || !!save.pairs[riderId]);
};

// NFC lab slots: hidden until a creature is born there (see creatureOf / applyCreatures).
for (let n = 1; n <= 6; n++) {
  RIDER_SKINS.push({ id: `nfc${n}`, name: trf('CRIATURA {0}', n), desc: '', price: null, hidden: true, nfc: true, rows: RIDER_ROWS, pal: RIDER_SKINS[0].pal, eyes: [], eyeC: '#111', hand: '#888' });
  BARREL_SKINS.push({ id: `nfcb${n}`, name: trf('CASCO {0}', n), desc: '', price: null, hidden: true, nfc: true, make: () => makeBarrel(WOOD) });
}
function applyCreatures() {
  for (let n = 1; n <= 6; n++) {
    const seed = save.nfc[n];
    if (!seed) continue;
    const c = creatureOf(seed);
    const r = RIDER_SKINS.find((k) => k.id === `nfc${n}`);
    Object.assign(r, { name: c.name, desc: c.desc, rows: c.rows, pal: c.pal, eyes: c.eyes, eyeC: c.eyeC, hand: c.B, pair: `nfcb${n}` });
    const b = BARREL_SKINS.find((k) => k.id === `nfcb${n}`);
    Object.assign(b, { name: trf('CASCO DE {0}', c.name), desc: trf('Feito sob medida pra {0}. Cada chip, um casco diferente.', c.name), make: () => makeCreatureBarrel(c) });
    save.owned[`r:nfc${n}`] = save.owned[`b:nfcb${n}`] = true;
  }
}

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
  ghost: { c: ['#ffffff', '#dfe8ff', '#c8d4f0'] },
  smoke: { c: ['#5a5a5a', '#8a8a8a', '#3a3a3a'], s: 2 },
  hearts: { c: ['#ff4d6d', '#ffb3c6', '#ffffff'] },
  siren: { c: ['#ff2a2a', '#2a6aff'], s: 2, seq: true },
  notes: { c: ['#1a1a1a', '#ffffff', '#ffd23f'] },
  spore: { c: ['#d8d8e0', '#ffb3b3', '#8a8a9a'] },
  code: { c: ['#3ddc5a', '#1a6a2a', '#c8ffc8'] },
  stars: { c: ['#ffffff', '#ff4da6', '#3df2ff', '#ffd23f'] },
};
function trailColor(t) {
  const trail = TRAILS[riderSkin.trail] || TRAILS[barrelSkin.trail];
  if (!trail) return ['#7fbfff', 1];
  const c = trail.seq ? trail.c[Math.floor(t * 14) % trail.c.length] : trail.c[Math.floor(Math.random() * trail.c.length)];
  return [c, trail.s || 1];
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

// Repair bubble: green ring with a wrench inside. Only shows up while the barrel is cracked.
const WRENCH_ICON = ['.....G..G', '.....G..G', '.....GGGG', '....GGsG.', '...GGs...', '..GGs....', '.GGs.....', 'GGs......', 'Gs.......'];
function makeWrenchBubble() {
  const S = 13;
  const c = S / 2;
  return paint(S, S, (i, j) => {
    const dx = i + 0.5 - c;
    const dy = j + 0.5 - c;
    const d = Math.hypot(dx, dy);
    if (d > 6.3) return null;
    if (d > 5.2) return '#5cf08a';
    if ((i === 3 && j === 3) || (i === 4 && j === 2) || (i === 2 && j === 4)) return '#ffffff';
    const ch = (WRENCH_ICON[j - 2] || '')[i - 2];
    return ch === 'G' ? '#e6ebf0' : ch === 's' ? '#7c8393' : null;
  });
}

// Cracked copies of the barrel sprite (stage 1 and 2 of 3 hits). Crack pixels are laid out on
// a 20x24 grid and scaled to the sprite, and only darken pixels the sprite already has.
const CRACKS = [
  [],
  [[6, 1], [6, 2], [7, 3], [7, 4], [6, 5], [6, 6], [7, 7], [8, 8], [8, 9], [5, 6], [4, 7], [9, 10]],
  [[14, 22], [13, 21], [13, 20], [14, 19], [14, 18], [15, 17], [15, 16], [14, 15], [13, 14], [12, 13], [16, 21], [17, 22], [11, 12], [12, 16], [11, 17]],
];
function makeCracked(src, stage) {
  const w = src.width;
  const h = src.height;
  const c = makeCanvas(w, h);
  const x = c.getContext('2d');
  x.drawImage(src, 0, 0);
  if (!stage) return c;
  const img = x.getImageData(0, 0, w, h);
  const set = (i, j, rgb) => {
    if (i < 0 || j < 0 || i >= w || j >= h) return;
    const k = (j * w + i) * 4;
    if (img.data[k + 3] === 0) return;
    img.data[k] = rgb[0];
    img.data[k + 1] = rgb[1];
    img.data[k + 2] = rgb[2];
  };
  for (let s = 1; s <= stage; s++) {
    for (const [cx, cy] of CRACKS[s]) {
      const i = Math.round((cx * w) / 20);
      const j = Math.round((cy * h) / 24);
      set(i + 1, j, [210, 200, 185]); // lit edge on the right of the split
      set(i, j, [20, 12, 6]);
    }
  }
  x.putImageData(img, 0, 0);
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
// Metres between weather rolls (see weatherStep): one of 500, 550, 600, 650 or 700, drawn anew
// each time so the change doesn't always land on the same mark.
const wxGap = () => 500 + 50 * Math.floor(Math.random() * 5);
const BARREL_POS = 0.45; // barrel's resting row, as a fraction of the screen height
const INTRO_DUR = 2.2; // seconds the barrel takes to float down from above the screen
const MAX_VX = 135; // px/s lateral
const PX_PER_M = 10;
const HIT_R = BARREL_R * 0.85; // forgiving hitboxes (game-feel: near misses should feel fair)
// Difficulty: sets the tilt sensitivity, the hits the barrel takes (the last one breaks it),
// world speed, extra gap, how often pickups show up and how many are bad, coin bubbles and
// repair wrenches (per rock row, only while the barrel is cracked).
const DIFFS = [
  { name: tr('FÁCIL'), note: tr('CONTROLE POR TOQUE NOS LADOS DA TELA<br>CAMINHO MAIS LARGO, POUCAS MOEDAS<br>SEM SKINS (QUASE), POUCAS CONQUISTAS<br><span class="quote shame">VERGONHA PRA VOCÊ, PRA SUA<br>FAMÍLIA, PRA SUA VACA!</span>'), sens: 0, hp: 3, speed: 1, gap: 10, pickup: 0.075, bad: 0.2, coin: 0.12, gold: 0, wrench: 0.1 },
  { name: tr('NORMAL'), note: tr('3 BATIDAS PARA QUEBRAR<br>A CHAVE INGLESA CONSERTA<br><span class="quote">AO INFINITO E ALÉM!<br>(OU ATÉ A 3ª BATIDA)</span>'), sens: 1, hp: 3, speed: 1, gap: 0, pickup: 0.075, bad: 0.38, coin: 0.42, gold: 0.08, wrench: 0.06 },
  { name: tr('DIFÍCIL'), note: tr('MORTE SÚBITA, MAIS POWER-DOWNS<br>CONQUISTAS E SKINS EXTRAS<br><span class="quote">QUE A SORTE ESTEJA SEMPRE<br>A SEU FAVOR!</span>'), sens: 2, hp: 1, speed: 1, gap: 0, pickup: 0.1, bad: 0.6, coin: 0.42, gold: 0.1, wrench: 0 },
];

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
  lab: $('lab'),
  labPreview: $('labPreview'),
  labName: $('labName'),
  labMsg: $('labMsg'),
  labScan: $('labScan'),
  labUse: $('labUse'),
  labSlots: $('labSlots'),
  labBack: $('labBack'),
  shopNfcBtn: $('shopNfcBtn'),
  stepsBtn: $('stepsBtn'),
  say: $('say'),
  redeem: $('redeem'),
  redeemInput: $('redeemInput'),
  redeemGo: $('redeemGo'),
  redeemMsg: $('redeemMsg'),
  redeemBack: $('redeemBack'),
  shopCodeBtn: $('shopCodeBtn'),
  titleGems: $('titleGems'),
  gemBtn: $('gemBtn'),
  shopGems: $('shopGems'),
  shopGemBtn: $('shopGemBtn'),
  shopTop: $('shopTop'),
  shopTip: $('shopTip'),
  tabTune: $('tabTune'),
  tuneBody: $('tuneBody'),
  store: $('store'),
  storeBody: $('storeBody'),
  storeNote: $('storeNote'),
  storeBack: $('storeBack'),
  storeGems: $('storeGems'),
  storeCoins: $('storeCoins'),
  overGems: $('overGems'),
  revive: $('revive'),
  reviveM: $('reviveM'),
  reviveAd: $('reviveAd'),
  reviveGem: $('reviveGem'),
  reviveNo: $('reviveNo'),
  reviveBar: $('reviveBar'),
  adPrivacyBtn: $('adPrivacyBtn'),
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
  pauseBtn: $('pauseBtn'),
  pauseGo: $('pauseGo'),
  pauseSound: $('pauseSound'),
  pauseMusic: $('pauseMusic'),
  pauseQuit: $('pauseQuit'),
  pauseWarn: $('pauseWarn'),
  hpIcons: [...document.querySelectorAll('#hudHp .hp')],
  rotate: $('rotate'),
  desktop: $('desktop'),
  desktopUrl: $('desktopUrl'),
  soundBtn: $('soundBtn'),
  shakeBtn: $('shakeBtn'),
  musicBtn: $('musicBtn'),
  diffBtn: $('diffBtn'),
  diffNote: $('diffNote'),
  achBtn: $('achBtn'),
  rankBtn: $('rankBtn'),
  rankPos: $('rankPos'),
  overRankBtn: $('overRankBtn'),
  overRank: $('overRank'),
  rank: $('rank'),
  rankTabs: $('rankTabs'),
  rankNote: $('rankNote'),
  rankList: $('rankList'),
  rankMe: $('rankMe'),
  nameForm: $('nameForm'),
  nameInput: $('nameInput'),
  googleBtn: $('googleBtn'),
  googleInfo: $('googleInfo'),
  rankDelete: $('rankDelete'),
  rankBack: $('rankBack'),
  achCount: $('achCount'),
  ach: $('ach'),
  achSummary: $('achSummary'),
  achList: $('achList'),
  achBack: $('achBack'),
  update: $('update'),
  demoEnd: $('demoEnd'),
  demoEndTitle: $('demoEndTitle'),
  demoEndText: $('demoEndText'),
  demoAgain: $('demoAgain'),
  demoNote: $('demoNote'),
  demoCtl: $('demoCtl'),
  updateTitle: $('updateTitle'),
  updateText: $('updateText'),
  updateVer: $('updateVer'),
  updateGo: $('updateGo'),
  updateLater: $('updateLater'),
  achDiary: $('achDiary'),
  achTitle: $('achTitle'),
  overAch: $('overAch'),
  sum: $('sum'),
  sumBody: $('sumBody'),
  sumShop: $('sumShop'),
  sumBack: $('sumBack'),
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
  hudCoinBox: $('hudCoinBox'),
  shopCoins: $('shopCoins'),
  howTo: $('howTo'),
  aee: $('aee'),
  dailyBtn: $('dailyBtn'),
  chalBtn: $('chalBtn'),
  aboutBtn: $('aboutBtn'),
  about: $('about'),
  aboutBody: $('aboutBody'),
  aboutVer: $('aboutVer'),
  aboutBack: $('aboutBack'),
  aboutJoke: $('aboutJoke'),
  aboutJokeBtn: $('aboutJokeBtn'),
  tutCanvas: $('tutCanvas'),
  tutStep: $('tutStep'),
  tutChecks: $('tutChecks'),
  tutCal: $('tutCal'),
  sensorList: $('sensorList'),
  inviteBtn: $('inviteBtn'),
  inviteInfo: $('inviteInfo'),
  notifBtn: $('notifBtn'),
  chal: $('chal'),
  chalBody: $('chalBody'),
  chalBack: $('chalBack'),
  settings: $('settings'),
  setBtn: $('setBtn'),
  setBack: $('setBack'),
  dailyHead: $('dailyHead'),
  dailyText: $('dailyText'),
  dailyStatus: $('dailyStatus'),
  overDaily: $('overDaily'),
  torchBtn: $('torchBtn'),
  hudR: document.querySelector('.hud-r'),
  wx: $('wx'),
  wxIcon: $('wxIcon'),
  wxName: $('wxName'),
  micBtn: $('micBtn'),
  micInfo: $('micInfo'),
  upsideNote: $('upsideNote'),
  clockNote: $('clockNote'),
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
const pcMode = params.has('pc') || (DEMO && !isMobile); // desktop test mode (and the demo on a computer): arrow keys
const testGaps = params.has('test') ? [] : null; // guaranteed gaps, recorded for automated checks
const tapMode = params.get('tap') === 'true' || (DEMO && !isMobile); // test mode: press the left/right half of the screen
const playable = isMobile || pcMode || tapMode;
// DEMO on a phone: tilt when the sensor answers, else (or by choice) the sides of the screen
let demoTap = DEMO && isMobile && !window.DeviceOrientationEvent;

const input = new Input(canvas);
input.setTap(tapMode);
input.sens = DIFFS[save.diff].sens;
sfx.setEnabled(save.sound);
sfx.setMusicEnabled(save.music);

// ---------- sprites ----------
// equipped skins (validated: an unknown or unowned id falls back to the classic one)
const owns = (kind, skin) => skin.price === 0 || save.owned[`${kind}:${skin.id}`] === true;
// exclusive skins (price null) are only given by an achievement (skin.ach)
let barrelSkin = BARREL_SKINS[0];
let riderSkin = RIDER_SKINS[0];
let barrelSpr = null;
let barrelDmg = null; // barrelSpr with 0, 1 and 2 cracks
let riderSprs = null;
function applySkins() {
  barrelSkin = BARREL_SKINS.find((k) => k.id === save.barrel && owns('b', k)) || BARREL_SKINS[0];
  riderSkin = RIDER_SKINS.find((k) => k.id === save.rider && owns('r', k)) || RIDER_SKINS[0];
  save.barrel = barrelSkin.id;
  save.rider = riderSkin.id;
  barrelSpr = barrelSkin.make();
  barrelDmg = [0, 1, 2].map((k) => makeCracked(barrelSpr, k));
  riderSprs = { '-1': makeRiderSkin(riderSkin, -1), 0: makeRiderSkin(riderSkin, 0), 1: makeRiderSkin(riderSkin, 1) };
}
applyCreatures();
applySkins();
const RIDER_LOW = 3; // rows above the rim while ducked: just the top of the hood
const RIDER_HIGH = 8; // rows above the rim while peeking: hood, eyes and collar
const rockSprs = {};
for (let r = 4; r <= 9; r++) rockSprs[r] = [0, 1, 2].map((v) => makeRock(r, r * 131 + v * 17 + 5));
const wallPattern = ctx.createPattern(makeStoneTile(64, 1234), 'repeat');
const waterTile = makeWaterTile(W + 16, 128, 99);
const foamTile = makeFoamTile(W + 16, 160, 77);
const bubbleSprs = [makeBubble(false), makeBubble(true)];
const wrenchSpr = makeWrenchBubble();
// Power-ups (good) and power-downs (bad). dur 0 = lasts until used (the shield).
const POWERS = [
  { id: 'shield', name: tr('ESCUDO!'), good: true, dur: 0 },
  { id: 'magnet', name: tr('ÍMÃ!'), good: true, dur: 8 },
  { id: 'slow', name: tr('CÂMERA LENTA!'), good: true, dur: 6 },
  { id: 'mini', name: tr('MINI-BARRIL!'), good: true, dur: 8 },
  { id: 'double', name: tr('MOEDA EM DOBRO!'), good: true, dur: 10 },
  { id: 'invert', name: tr('TONTURA!'), good: false, dur: 5 },
  { id: 'fog', name: tr('NEBLINA!'), good: false, dur: 7 },
  { id: 'big', name: tr('BARRIL INCHADO!'), good: false, dur: 6 },
  { id: 'fire', name: tr('PEGOU FOGO!'), good: false, dur: 6, mic: true }, // only while the microphone is on
];
const POWER_BY_ID = Object.fromEntries(POWERS.map((pw) => [pw.id, pw]));
const capsuleSprs = Object.fromEntries(POWERS.map((pw) => [pw.id, makeCapsule(POWER_ICONS[pw.id], pw.good)]));
capsuleSprs.mystery = makeCapsule(POWER_ICONS.mystery, null); // "?" capsule: rolls any power, good or bad
const MYSTERY_CHANCE = 0.2; // share of spawned pickups that are "?"

const iconSprs = Object.fromEntries(POWERS.map((pw) => [pw.id, makeIcon(POWER_ICONS[pw.id])]));
const PICKUP_R = 7;
const SLOW_K = 0.6; // world speed while "câmera lenta" is on
const MAGNET_R = 80;
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
  bubbles: [], // coin bubbles: { wy, x, v, gold, ph } (wrench: true = repair bubble)
  hp: 3, // barrel hits left
  maxHp: 3,
  cfg: null, // DIFFS entry for the current run
  fromAd: false, // a full-screen ad just closed: the next calibration waits longer
  runDiff: -1, // difficulty index while a run is on (playing / dying), -1 otherwise
  pickups: [], // power-ups/downs: { wy, x, id, ph }
  fx: {}, // active effects: id -> seconds left (shield: 1 while held; ghost: invulnerable after a save)
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
  wind: 0, // px/s sideways push right now (VENTANIA)
  windDir: 1,
  windT: 0,
  windFlip: 8,
  upFlash: 6, // seconds to the next red flash in the MUNDO INVERTIDO
  bolt: null, // TEMPESTADE: { x, warn, t, struck, pts } while a lightning strike is marked or falling
  boltWait: 3,
  wxNext: 600, // metres of the next weather roll
  wxPending: null, // weather announced and about to land
  wxPendT: 0,
  wxPrev: 'clear', // weather fading out
  wxFade: 1,
  wxFromM: 0, // metres when the current weather began
  hintHideAt: 0,
  lastRun: null, // the finished run, for the share image
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
    } else if (G.run && G.run.weather === 'mirage' && G.rng() < 0.5) {
      G.rocks.push({ wy: wy + (G.rng() * 2 - 1) * 5, x: x + r, r, spr: rockSprs[r][Math.floor(G.rng() * 3)], passed: false, fake: true });
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
  const teach = i < 4 || !!G.tut; // the guided first run stays at the easy, wide-gap start
  const calm = isCalm(i);
  const tutRow = G.tut && i >= 4 ? G.tut.queue.shift() : null;
  const gapW = lerp(56, 37, d) + (calm ? 10 : 0) + (teach ? 14 : 0) + G.cfg.gap;
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
  // MIRAGEM: now and then a rock that isn't there sits right in the free gap
  if (G.run.weather === 'mirage' && !teach && G.rng() < 0.3) {
    const r = 5 + Math.floor(G.rng() * 3);
    G.rocks.push({ wy, x: g + (G.rng() * 2 - 1) * gapW * 0.15, r, spr: rockSprs[r][Math.floor(G.rng() * 3)], passed: false, fake: true });
  }
  // power-ups/downs sit at one edge of the guaranteed gap, so the rest of the gap (at least
  // gapW - 2 * PICKUP_R wide, more than the barrel) stays free: a bad one can always be dodged.
  let pickup = false;
  if (tutRow && tutRow !== 'coin') {
    // green capsule right in the middle of the gap (easy to grab), red one at its edge (easy to dodge)
    const side = G.rng() < 0.5 ? -1 : 1;
    const x = POWER_BY_ID[tutRow].good ? g : g + side * (gapW / 2 - PICKUP_R);
    G.pickups.push({ wy, x, id: tutRow, ph: G.rng() * 6 });
    pickup = true;
  } else if (tutRow === 'coin') {
    G.bubbles.push({ wy, x: g + (G.rng() * 2 - 1) * gapW * 0.12, v: 1, gold: false, ph: G.rng() * 6 });
  } else if (!G.tut && i >= 8 && G.rng() < G.cfg.pickup) {
    let id = 'mystery';
    if (G.rng() >= MYSTERY_CHANCE) {
      const bad = G.rng() < G.cfg.bad;
      const pool = POWERS.filter((pw) => pw.good !== bad && (!pw.mic || micLive()));
      id = pool[Math.floor(G.rng() * pool.length)].id;
    }
    const side = G.rng() < 0.5 ? -1 : 1;
    G.pickups.push({ wy, x: g + side * (gapW / 2 - PICKUP_R), id, ph: G.rng() * 6 });
    pickup = true;
  }
  // coin bubbles float in the guaranteed gap, so they never force an impossible move
  const cracked = G.hp < G.maxHp && !G.bubbles.some((b) => b.wrench);
  if (!teach && !pickup && cracked && G.rng() < G.cfg.wrench) {
    G.bubbles.push({ wy, x: g + (G.rng() * 2 - 1) * gapW * 0.18, v: 0, gold: false, wrench: true, ph: G.rng() * 6 });
  } else if (!teach && !pickup && G.rng() < G.cfg.coin) {
    const gold = G.rng() < G.cfg.gold;
    G.bubbles.push({ wy: wy + (G.rng() * 2 - 1) * 4, x: g + (G.rng() * 2 - 1) * gapW * 0.18, v: gold ? 5 : 1, gold, ph: G.rng() * 6 });
  }
  G.prevGap = g;
  G.rowIndex++;
  const nd = diff(wy + 80 - G.startCam);
  G.curSpacing = lerp(108, 62, nd) * (isCalm(G.rowIndex) ? 1.7 : 1);
  G.nextRowY += G.curSpacing;
}

// ---------- first ride: a guided run ----------
// The first run of a new player is scripted by metres: coins, a power-up, a power-down, the day
// going from afternoon to night and one weather (VENTANIA), each with a hint, so nobody takes the
// dark river at night for a broken game. The river stays at its easy start the whole time. It
// ends at TUT_END m and gives the run back to the real clock and weather; dying earlier just
// leaves it for the next run (up to TUT_RUNS runs). ?tutorial forces it, ?notut skips it.
const TUT_RUNS = 2;
const TUT_STEPS = [
  { m: 25, queue: ['coin', 'coin', 'coin', 'coin', 'coin'], hint: tr('ESTOURE AS BOLHAS<br>PRA GANHAR MOEDAS!') },
  { m: 75, queue: ['magnet', 'coin', 'coin', 'coin'], hint: tr('CÁPSULA VERDE É POWER-UP:<br>PEGUE!') },
  { m: 125, queue: ['big'], hint: tr('CÁPSULA VERMELHA É POWER-DOWN:<br>DESVIE!') },
  { m: 170, period: 'dusk', hint: tr('O JOGO SEGUE O RELÓGIO<br>DO SEU CELULAR.<br>OLHA O FIM DE TARDE...') },
  { m: 215, period: 'night', hint: tr('...E A NOITE! DE NOITE<br>O RIO FICA ESCURO MESMO,<br>É DE PROPÓSITO') },
  { m: 265, weather: 'wind', queue: ['coin', 'coin', 'coin', 'coin'], hint: tr('E O CLIMA MUDA O JOGO!<br>A VENTANIA EMPURRA O BARRIL<br>E DÁ MOEDA EM DOBRO') },
  { m: 340, end: true, hint: tr('PRONTO, AGORA É COM VOCÊ!<br>CADA DESCIDA TEM UM CLIMA,<br>E A NOITE É A DE VERDADE') },
];
const TUT_END = TUT_STEPS[TUT_STEPS.length - 1].m;
const tutWanted = () => !params.has('notut') && (params.has('tutorial') || (!testGaps && !save.tutDone && save.runs < TUT_RUNS));
function tutStep() {
  const s = TUT_STEPS[G.tut.step];
  if (!s || G.meters < s.m) return;
  G.tut.step++;
  if (s.queue) G.tut.queue.push(...s.queue);
  if (s.period) {
    world.tutPeriod = s.period;
    refreshPeriod();
  }
  if (s.weather) setWeather(s.weather);
  if (s.end) tutEnd(true);
  showHint(s.hint, 5, true);
}
// Back to the real clock and weather; done = the whole guided run was ridden.
function tutEnd(done) {
  if (!G.tut) return;
  G.tut = null;
  world.tutPeriod = null;
  refreshPeriod();
  if (!done) return;
  if (G.run.weather !== 'clear') setWeather('clear');
  G.wxNext = G.meters + wxGap();
  save.tutDone = true;
  writeSave(save);
  unlock('tutorial');
}

// ---------- achievements ----------
// Trophy room: every badge starts grey and lights up once earned. Unlocks are saved right away,
// so a crash or a closed tab never loses one. tier: 1 bronze, 2 silver, 3 gold, 4 special.
const ACHIEVEMENTS = [
  { id: 'm100', icon: '100', tier: 1, name: tr('100 METROS RASOS'), desc: tr('Usain Bolt ficaria orgulhoso. Ou não. Desça 100 m.') },
  { id: 'm300', icon: '300', tier: 1, name: tr('ESQUENTANDO O BARRIL'), desc: tr('Já pegou o jeito da coisa. Desça 300 m.') },
  { id: 'm500', icon: '500', tier: 2, name: tr('MEIO CAMINHO BOIADO'), desc: tr('Meio quilômetro sem ralar a madeira. Desça 500 m.') },
  { id: 'm1000', icon: '1K', tier: 3, name: tr('UOOEEEEE!'), desc: tr('A torcida de capa amarela aprova. Desça 1000 m.') },
  { id: 'm2000', icon: '2K', tier: 3, name: tr('PEIXE HONORÁRIO'), desc: tr('Os lambaris mandaram um abraço. Desça 2000 m.') },
  { id: 'm3000', icon: '3K', tier: 4, name: tr('LENDA DAS CATARATAS'), desc: tr('Já contam histórias suas no quiosque. Desça 3000 m.') },
  { id: 'tight', icon: '>|<', tier: 2, name: tr('SÓ PASSOU O BARRIL'), desc: tr('Nem uma folha de papel passava junto. Passe entre duas pedras coladinhas.') },
  { id: 'tight5', icon: '5x', tier: 3, name: tr('COSTUREIRO'), desc: tr('Enfiou o barril na agulha 5 vezes numa descida só.') },
  { id: 'graze1', icon: '~', tier: 1, name: tr('RASPOU A TINTA'), desc: tr('O verniz ficou na pedra. Passe raspando numa pedra.') },
  { id: 'graze10', icon: '10', tier: 2, name: tr('BARBEIRO DE PEDRA'), desc: tr('Fez a barba de 10 pedras numa descida só.') },
  { id: 'graze100', icon: '100~', tier: 3, name: tr('VIVENDO PERIGOSAMENTE'), desc: tr('100 raspadas no total. Sua mãe não precisa saber.') },
  { id: 'die1', icon: 'X', tier: 1, name: tr('LASCOU'), desc: tr('Literalmente. Quebre o barril pela primeira vez.') },
  { id: 'early', icon: ':(', tier: 1, name: tr('MORREU NA PRAIA'), desc: tr('Nem deu tempo de molhar o cabelo. Quebre antes dos 30 m.') },
  { id: 'trave', icon: '-1', tier: 2, name: tr('NA TRAVE'), desc: tr('Faltou ISSO aqui ó. Quebre a menos de 10 m do recorde.') },
  { id: 'record', icon: 'REC', tier: 2, name: tr('SUPERA-TE'), desc: tr('Bata o seu próprio recorde. O seu eu do passado chora.') },
  { id: 'runs10', icon: '10x', tier: 1, name: tr('TEIMOSO'), desc: tr('10 barris quebrados. O marceneiro agradece.') },
  { id: 'runs50', icon: '50x', tier: 3, name: tr('VICIADO EM BARRIL'), desc: tr('50 descidas. Tá tudo bem aí em casa?') },
  { id: 'km5', icon: '5KM', tier: 2, name: tr('QUILOMETRAGEM ALTA'), desc: tr('Some 5 km descendo, contando todas as descidas.') },
  { id: 'km20', icon: '20KM', tier: 3, name: tr('HORA DA REVISÃO'), desc: tr('20 km no total. Troca o óleo desse barril. Libera o TAMBOR DE ÓLEO.'), skin: 'b:oil' },
  { id: 'zen', icon: 'Zz', tier: 2, name: tr('MODO PLANTA'), desc: tr('Fique 5 s sem inclinar o celular. Fotossíntese ativada.') },
  { id: 'wall', icon: '|o', tier: 2, name: tr('ABRAÇA-PAREDE'), desc: tr('Fique colado no paredão por 2 s. Carente.') },
  { id: 'mute', icon: 'shh', tier: 2, name: tr('MODO BIBLIOTECA'), desc: tr('Chegue a 300 m com o som desligado. Shhhh. Libera o NINJA.'), skin: 'r:ninja' },
  { id: 'hard', icon: '!!!', tier: 3, name: tr('NERVOS DE AÇO'), desc: tr('Chegue a 800 m no DIFÍCIL raspando em pelo menos 10 pedras. Cena perigosa, sem dublê. Libera o DUBLÊ.'), skin: 'r:stunt' },
  { id: 'hard100', icon: '1HP', tier: 2, name: tr('MORTE SÚBITA'), desc: tr('Desça 100 m no DIFÍCIL. Uma batida e acabou.') },
  { id: 'hard1000', icon: 'LEN', tier: 4, name: tr('LENDA DA CACHOEIRA'), desc: tr('Desça 1000 m no DIFÍCIL. Libera o BARRIL VULCÂNICO.'), skin: 'b:lava', oldReward: 200 },
  { id: 'hardcursed', icon: '5:(', tier: 3, name: tr('AZAR PROFISSIONAL'), desc: tr('Pegue 5 power-downs numa descida só no DIFÍCIL.') },
  { id: 'hardshield', icon: '[!]', tier: 2, name: tr('VIDA EXTRA'), desc: tr('No DIFÍCIL, deixe o escudo segurar uma batida.') },
  { id: 'easy1000', icon: 'MUU', tier: 2, easy: true, name: tr('DESONRA!'), desc: tr('Desça 1000 m no FÁCIL. Libera a VACA. Vergonha pra sua família.'), skin: 'r:cow' },
  { id: 'easy100', icon: 'ABC', tier: 1, easy: true, name: tr('DE RODINHAS'), desc: tr('Desça 100 m no FÁCIL. Todo mundo começa assim.') },
  { id: 'nohit500', icon: '[ ]', tier: 3, name: tr('INTOCÁVEL'), desc: tr('Chegue a 500 m sem o barril levar nenhuma batida. Libera o BARRIL BLINDADO.'), skin: 'b:armor' },
  { id: 'casa8', icon: 'Nº8', tier: 2, name: tr('CASA Nº 8'), desc: tr('Chegue a 888 m no BARRIL CLÁSSICO. Libera o MENINO DO 8.'), skin: 'r:kid8' },
  { id: 'share', icon: '<3', tier: 1, name: tr('INFLUENCER DE CACHOEIRA'), desc: tr('Compartilhe a imagem de uma descida. Like, comenta e compartilha!') },
  { id: 'share10', icon: '10<3', tier: 2, name: tr('SPAM DE CACHOEIRA'), desc: tr('Compartilhe 10 descidas. Seus amigos já silenciaram você.') },
  { id: 'share_zap', icon: 'ZAP', tier: 2, needs: 'shareapp', name: tr('BOM DIA, GRUPO DA FAMÍLIA'), desc: tr('Compartilhe uma descida pelo WhatsApp. Libera a TIA DO ZAP e o BALÃO DE MENSAGEM.'), skin: ['r:tiazap', 'b:chatbubble'] },
  { id: 'share_ig', icon: '#', tier: 2, needs: 'shareapp', name: tr('POSTOU NOS STORIES'), desc: tr('Compartilhe uma descida pelo Instagram. Libera a BLOGUEIRINHA e o BARRIL COM FILTRO.'), skin: ['r:blogueira', 'b:filter'] },
  { id: 'share_tt', icon: '2M', tier: 2, needs: 'shareapp', name: tr('VIRALIZOU'), desc: tr('Compartilhe uma descida pelo TikTok. Libera o DANÇARINO VIRAL.'), skin: 'r:viral' },
  { id: 'share_fb', icon: 'PAVÊ', tier: 2, needs: 'shareapp', name: tr('É PAVÊ OU PRA DESCER?'), desc: tr('Compartilhe uma descida pelo Facebook ou Messenger. Libera o TIO DO FACE.'), skin: 'r:tioface' },
  { id: 'share_tg', icon: '>>', tier: 2, needs: 'shareapp', name: tr('MENSAGEM VOANDO'), desc: tr('Compartilhe uma descida pelo Telegram. Libera o AVIÃO DE PAPEL.'), skin: 'b:paperplane' },
  { id: 'share3', icon: '3APP', tier: 3, needs: 'shareapp', name: tr('INFLUENCER MULTIPLATAFORMA'), desc: tr('Compartilhe descidas em 3 apps diferentes. Libera o CELULAR GIGANTE.'), skin: 'b:phonebarrel' },
  { id: 'ranked', icon: '#', tier: 1, name: tr('NA BOCA DO POVO'), desc: tr('Entre no ranking online com apelido e conta Google.') },
  { id: 'top10', icon: 'TOP', tier: 3, name: tr('TOP 10'), desc: tr('Fique entre os 10 primeiros do ranking GERAL.') },
  { id: 'repair1', icon: '+1', tier: 1, name: tr('MARCENEIRO'), desc: tr('Conserte o barril com uma chave inglesa.') },
  { id: 'comeback', icon: '1>2', tier: 2, name: tr('VOLTA POR CIMA'), desc: tr('Conserte o barril quando ele estava por um fio.') },
  { id: 'thread30', icon: '1/3', tier: 2, name: tr('NA CORDA BAMBA'), desc: tr('Fique 30 s seguidos com o barril por um fio.') },
  { id: 'plumber', icon: 'FIX', tier: 3, name: tr('ENCANADOR DE PLANTÃO'), desc: tr('Conserte o barril 3 vezes numa descida só. Libera o MARQUIO.'), skin: 'r:marquio' },
  { id: 'repair25', icon: '25+', tier: 3, name: tr('FAZ-TUDO'), desc: tr('Conserte o barril 25 vezes no total. Libera o FAZ-TUDO.'), skin: 'r:handyman' },
  { id: 'pause', icon: '||', tier: 1, name: tr('PAUSA PRO CAFEZINHO'), desc: tr('Pause a descida. Ninguém é de ferro.') },
  { id: 'night', icon: '(o)', tier: 2, name: tr('CORUJA DO RIO'), desc: tr('Jogue entre meia-noite e 5 da manhã. Vai dormir! Libera o VAMPIRO.'), skin: 'r:vampire' },
  { id: 'bad3', icon: '3:(', tier: 1, name: tr('FASE RUIM'), desc: tr('3 descidas seguidas abaixo de 50 m. Acontece com todo mundo.') },
  { id: 'm50', icon: '50', tier: 1, name: tr('AQUECIMENTO'), desc: tr('Desça 50 m. Alongou antes, né?') },
  { id: 'm666', icon: '666', tier: 2, name: tr('NÚMERO DA BESTA'), desc: tr('Passe dos 666 m depois de pegar 3 power-downs na mesma descida. O capeta gosta de coisa ruim. Libera o DEMÔNIO.'), skin: 'r:devil' },
  { id: 'm750', icon: '750', tier: 2, name: tr('QUASE UM QUILÔMETRO'), desc: tr('Desça 750 m. Quase lá, quase lá...') },
  { id: 'm5000', icon: '5K', tier: 4, name: tr('NEM O GPS TE ACHA'), desc: tr('Desça 5000 m numa descida só. Isso é humanamente possível?') },
  { id: 'coin1', icon: 'o', tier: 1, name: tr('ESTOURA-BOLHA'), desc: tr('Estoure sua primeira bolha de moeda. Ploc!') },
  { id: 'goldbub', icon: 'O', tier: 1, name: tr('BOLHA DE OURO'), desc: tr('Pegue uma bolha dourada. Vale 5 moedas!') },
  { id: 'coin20', icon: '20', tier: 2, name: tr('MÃO DE VACA'), desc: tr('Pegue 20 moedas numa descida só.') },
  { id: 'coin50', icon: '50$', tier: 3, name: tr('BANCO CENTRAL'), desc: tr('Pegue 50 moedas numa descida só. Imprimindo dinheiro.') },
  { id: 'coin100', icon: '100', tier: 3, name: tr('100 MOEDAS'), desc: tr('Pegue 100 moedas numa descida só. Não ganhou vida extra, mas ganhou um cano. Libera o TUBO VERDE.'), skin: 'b:pipe' },
  { id: 'coins500', icon: '500$', tier: 2, name: tr('POUPANÇA'), desc: tr('Junte 500 moedas no total. Rende mais que a poupança.') },
  { id: 'bubbles300', icon: 'ooo', tier: 3, name: tr('PLOC PLOC PLOC'), desc: tr('Estoure 300 bolhas no total. Libera a BUCHINHA.'), skin: 'r:sponge' },
  { id: 'rich', icon: '$$', tier: 3, name: tr('OSTENTAÇÃO'), desc: tr('Tenha 1000 moedas guardadas ao mesmo tempo. Libera o BARRIL DE OURO.'), skin: 'b:gold' },
  { id: 'nocoin', icon: '0$', tier: 2, name: tr('DESAPEGADO'), desc: tr('Chegue a 500 m sem pegar nenhuma moeda. Dinheiro não traz felicidade.') },
  { id: 'angel', icon: '(+)', tier: 3, name: tr('ANJO DA GUARDA'), desc: tr('Chegue a 500 m sem raspar em nenhuma pedra. Libera o ANJINHO.'), skin: 'r:angel' },
  { id: 'tight25', icon: '25', tier: 3, name: tr('ALFAIATE'), desc: tr('Passe 25 vezes entre pedras coladinhas, somando todas as descidas. Libera a CRIATURA COSTURADA.'), skin: 'r:creature' },
  { id: 'pingpong', icon: '<>', tier: 2, name: tr('PINGUE-PONGUE'), desc: tr('Raspe em 3 pedras em menos de 2 segundos.') },
  { id: 'zen10', icon: 'ZZZ', tier: 3, name: tr('MONGE TIBETANO'), desc: tr('Fique 10 s sem inclinar o celular. Iluminação alcançada.') },
  { id: 'wall5', icon: '||o', tier: 3, name: tr('GRUDE'), desc: tr('Fique 5 s colado no paredão. Larga a parede!') },
  { id: 'runs100', icon: '100x', tier: 3, name: tr('CEMITÉRIO DE BARRIS'), desc: tr('100 barris quebrados. O marceneiro comprou casa na praia. Libera o FANTASMA.'), skin: 'r:ghost' },
  { id: 'scream', icon: 'AAH', tier: 1, name: tr('AAAAAHHH!'), desc: tr('Ouça o grito do piloto voando do barril. Clássico do cinema.') },
  { id: 'dejavu', icon: '=', tier: 2, name: tr('DÉJÀ VU'), desc: tr('Termine duas descidas seguidas com a mesma distância.') },
  { id: 'empate', icon: 'REC=', tier: 3, name: tr('EMPATE TÉCNICO'), desc: tr('Termine exatamente no seu recorde. Nem um metro a mais.') },
  { id: 'skins5', icon: '5', tier: 2, name: tr('FASHIONISTA'), desc: tr('Tenha 5 skins compradas na loja. Estilo é tudo.') },
  { id: 'cold', icon: '*', tier: 2, name: tr('FRIO DE RACHAR'), desc: tr('Desça 100 m com o ABOMINÁVEL dentro da GELADEIRA.') },
  { id: 'horror', icon: '!?', tier: 2, name: tr('NOITE DE TERROR'), desc: tr('Chegue a 300 m com um monstro: bruxa, vampiro, zumbi e cia.') },
  { id: 'milson', icon: 'MIL', tier: 1, name: tr('MILSOOOON!'), desc: tr('Quebre o barril com o NÁUFRAGO. Alguém salva a bola!') },
  { id: 'rainbow', icon: '~~~', tier: 2, name: tr('ÓLEO ARCO-ÍRIS'), desc: tr('Chegue a 500 m com o UNICÓRNIO. O IBAMA já foi avisado. Libera o BARRIL ARCO-ÍRIS.'), skin: 'b:rainbowb' },
  { id: 'nessie', icon: 'S', tier: 2, name: tr('FINALMENTE FOTOGRAFADO'), desc: tr('Chegue a 200 m com o MONSTRO DO LAGO. A foto saiu borrada.') },
  { id: 'eureka', icon: 'E!', tier: 3, name: tr('EUREKA!'), desc: tr('Chegue a 1000 m com o CIENTISTA MALUCO. A ciência venceu.') },
  { id: 'caramelo', icon: 'AU', tier: 1, name: tr('PATRIMÔNIO NACIONAL'), desc: tr('Desça com o VIRA-LATA CARAMELO. Ele merece.') },
  { id: 'holiday', icon: 'FER', tier: 3, name: tr('FERIADÃO'), desc: tr('Tenha o PAPAI NOEL, o COELHO DA PÁSCOA e o TATU DO HANUKKAH.') },
  { id: 'sextou', icon: 'SEX', tier: 1, easy: true, name: tr('SEXTOU!'), desc: tr('Jogue numa sexta-feira. O fim de semana começa no barril. Libera o BARRIL DE CHOPP.'), skin: 'b:keg' },
  { id: 'saved', icon: '[o]', tier: 1, name: tr('SALVO PELO GONGO'), desc: tr('O escudo segurou uma batida por você. Agradeça a ele.') },
  { id: 'powers', icon: 'POW', tier: 2, name: tr('SUPERPODEROSO'), desc: tr('Pegue os 5 tipos de power-up, somando todas as descidas.') },
  { id: 'cursed', icon: '13', tier: 2, name: tr('PÉ-FRIO'), desc: tr('Pegue 3 power-downs numa descida só. Quebrou um espelho?') },
  { id: 'collect', icon: 'TEL', tier: 2, name: tr('LIGAÇÃO A COBRAR'), desc: tr('Chegue a 300 m com a CABINE TELEFÔNICA.') },
  { id: 'shop1', icon: '$', tier: 1, name: tr('CONSUMISTA'), desc: tr('Compre a primeira skin. O capitalismo agradece.') },
  { id: 'shopall', icon: '$$$', tier: 4, name: tr('GUARDA-ROUPA COMPLETO'), desc: tr('Tenha todas as skins de barril e de piloto. Todas mesmo.') },
  { id: 'plugged', icon: 'V+', tier: 2, easy: true, needs: 'battery', name: tr('NA TOMADA'), desc: tr('Jogue com o celular no carregador. Libera o GERADOR.'), skin: 'b:generator' },
  { id: 'respingos', icon: '...', tier: 3, name: tr('ANÁLISE DE RESPINGOS'), desc: tr('Raspe em 10 pedras numa descida sem levar nenhuma batida. Tudo anotado. Libera o PERITO EM RESPINGOS e a MALETA DE PERÍCIA.'), skin: ['r:perito', 'b:pericia'] },
  { id: 'esferas', icon: '*7*', tier: 3, name: tr('AS SETE ESFERAS'), desc: tr('Pegue 7 bolhas douradas numa descida só. Libera o GUERREIRO DOURADO e a ESFERA DO DRAGÃO.'), skin: ['r:guerreiro', 'b:esfera'] },
  { id: 'portal', icon: '@', tier: 2, name: tr('VIAGEM ENTRE DIMENSÕES'), desc: tr('Desça 300 m com o CIENTISTA MALUCO. Ele achou um neto e uma pistola de portais. Libera o VÔ CIENTISTA e o PORTAL VERDE.'), skin: ['r:vocientista', 'b:portal'] },
  { id: 'irrecusavel', icon: '$$', tier: 3, name: tr('UMA OFERTA IRRECUSÁVEL'), desc: tr('Tenha 2000 moedas guardadas ao mesmo tempo. Libera O PADRINHO e o AZEITE DA FAMÍLIA.'), skin: ['r:padrinho', 'b:azeite'] },
  { id: 'naopassar', icon: 'NÃO', tier: 3, name: tr('VOCÊ NÃO VAI PASSAR!'), desc: tr('Passe 8 vezes entre pedras coladinhas numa descida só. Libera o MAGO CINZENTO e o BARRIL DOS ELFOS.'), skin: ['r:mago', 'b:elfo'] },
  { id: 'insonia', icon: '3AM', tier: 2, name: tr('INSÔNIA'), desc: tr('Jogue 3 descidas seguidas entre 1h e 5h da manhã. Você não dorme há dias. Libera o VENDEDOR DE SABÃO e o SABONETE.'), skin: ['r:sabao', 'b:sabaob'] },
  { id: 'walle', icon: '[]', tier: 2, name: tr('CATADOR ESPACIAL'), desc: tr('Pegue 40 moedas numa descida dentro da LATA DE LIXO. Libera o ROBOZINHO CATADOR.'), skin: 'r:walle' },
  { id: 'duna', icon: 'ºº', tier: 3, name: tr('A ESPECIARIA DEVE FLUIR'), desc: tr('Desça 600 m com miragem. Libera o MESSIAS DO DESERTO e o VERME DA AREIA.'), skin: ['r:messias', 'b:verme'] },
  { id: 'duro', icon: '60s', tier: 3, name: tr('DURO DE AFUNDAR'), desc: tr('Fique 60 s seguidos com o barril por um fio. Libera o POLICIAL DESCALÇO.'), skin: 'r:descalco' },
  { id: 'printnitida', icon: '[o]', tier: 2, easy: true, needs: 'print', name: tr('FINALMENTE NÍTIDA'), desc: tr('Tire um print com o MONSTRO DO LAGO de piloto. A primeira foto nítida da história. Libera a CÂMERA LAMBE-LAMBE.'), skin: 'b:camera' },
  { id: 'printghost', icon: 'BUU', tier: 2, easy: true, needs: 'print', name: tr('FOTO ASSOMBRADA'), desc: tr('Tire um print com o FANTASMA de piloto. Apareceu um vulto na foto. Libera o CAÇADOR DE FANTASMAS.'), skin: 'r:cacafantasma' },
  { id: 'printufo', icon: 'UFO', tier: 2, easy: true, needs: 'print', name: tr('PROVA DO ÓVNI'), desc: tr('Tire um print com o ET de piloto. Agora ninguém duvida. Libera o DISCO VOADOR.'), skin: 'b:disco' },
  { id: 'print', icon: 'TV', tier: 2, easy: true, needs: 'print', name: tr('MÃE, TÔ NA GLOBE!'), desc: tr('Tire um print da tela do jogo. Dizem que algo aparece na foto. Libera o MONSTRO DO LAGO.'), skin: 'r:nessie' },
  { id: 'shake', icon: '~~', tier: 2, needs: 'motion', name: tr('TERREMOTO'), desc: tr('Chacoalhe o celular com força durante a descida. Libera o LIQUIDIFICADOR.'), skin: 'b:blender' },
  { id: 'upside', icon: 'INV', tier: 2, easy: true, needs: 'motion', name: tr('MUNDO INVERTIDO'), desc: tr('Vire o celular de cabeça pra baixo na tela inicial. Tem algo estranho no rio...') },
  { id: 'demogorg', icon: 'D&D', tier: 3, needs: 'motion', name: tr('COISAS MAIS ESTRANHAS'), desc: tr('Desça 100 m no MUNDO INVERTIDO. Libera o DEMOGORGONZOLA.'), skin: 'r:demogorg' },
  { id: 'battlow', icon: '10%', tier: 2, easy: true, needs: 'battery', name: tr('VIVENDO NO LIMITE'), desc: tr('Jogue com menos de 10% de bateria. Procura uma tomada! Libera a PILHA FRACA.'), skin: 'b:pilha' },
  { id: 'battfull', icon: '90%', tier: 1, easy: true, needs: 'battery', name: tr('CARGA COMPLETA'), desc: tr('Jogue com 90% de bateria ou mais. Libera o BARRIL CLASSE A.'), skin: 'b:classea' },
  { id: 'airplane', icon: '14B', tier: 2, easy: true, name: tr('MODO AVIÃO'), desc: tr('Jogue no modo avião ou sem internet. Libera o SANTOS DUMMOUND e o 14-BARRIL.'), skin: ['r:dumont', 'b:dumont'] },
  { id: 'blowout', icon: 'FUU', tier: 2, needs: 'mic', name: tr('SOPRO DE BOMBEIRO'), desc: tr('Com o microfone ligado (AJUSTES), apague o barril em chamas soprando o celular. Libera o BARRIL DE CARVÃO.'), skin: 'b:charcoal' },
  { id: 'crowdyell', icon: 'AEE', tier: 3, needs: 'mic', name: tr('UOOOEEE JUNTO!'), desc: tr('Com o microfone ligado, grite junto com a torcida da escadaria (a cada 1000 m). Libera o TORCEDOR DE ARQUIBANCADA.'), skin: 'r:torcedor' },
  { id: 'torchfog', icon: '*>', tier: 2, needs: 'torch', name: tr('FAROL ALTO'), desc: tr('Acenda a lanterna do celular pra espantar a NEBLINA. Libera o FAROL.'), skin: 'b:farol' },
  { id: 'torchnight', icon: 'LUZ', tier: 2, needs: 'torch', name: tr('LANTERNINHA'), desc: tr('Acenda a lanterna do celular numa descida de noite. Libera o MINEIRO.'), skin: 'r:miner' },
  { id: 'rain300', icon: '///', tier: 2, name: tr('CANTANDO NA CHUVA'), desc: tr('Desça 300 m debaixo de chuva.') },
  { id: 'wind300', icon: '>>>', tier: 2, name: tr('E O VENTO LEVOU'), desc: tr('Desça 300 m com ventania.') },
  { id: 'dark500', icon: '( )', tier: 2, name: tr('SEM MEDO DO ESCURO'), desc: tr('Desça 500 m de noite com o ZUMBI (das 19h às 6h, no horário do celular). Ele brilha no escuro. Libera o BARRIL RADIOATIVO.'), skin: 'b:radio' },
  { id: 'weekend', icon: 'S+D', tier: 1, easy: true, name: tr('FIM DE SEMANA'), desc: tr('Jogue num sábado e num domingo. Descanso é pros fracos.') },
  { id: 'monday', icon: 'SEG', tier: 1, easy: true, name: tr('ODEIO SEGUNDA'), desc: tr('Jogue numa segunda-feira antes das 8h. Coragem.') },
  { id: 'lunch', icon: '12h', tier: 1, easy: true, name: tr('HORA DO ALMOÇO'), desc: tr('Jogue entre meio-dia e uma da tarde. A marmita espera.') },
  { id: 'anonovo', icon: '1/1', tier: 2, easy: true, name: tr('FELIZ BARRIL NOVO'), desc: tr('Jogue na virada do ano (30/12 a 2/1). Libera o ESPUMANTE.'), skin: 'b:champagne' },
  { id: 'carnaval', icon: 'CRN', tier: 2, easy: true, name: tr('ABRE ALAS!'), desc: tr('Jogue no Carnaval (sábado à quarta de cinzas). Libera o BARRIL DE CONFETE e o PALHAÇO.'), skin: ['b:confetti', 'r:clown'] },
  { id: 'pascoa', icon: 'OVO', tier: 2, easy: true, name: tr('OVO NO BARRIL'), desc: tr('Jogue na semana da Páscoa (quinta a segunda). Libera o OVO DE PÁSCOA e o COELHO DA PÁSCOA.'), skin: ['b:egg', 'r:bunny'] },
  { id: 'namorados', icon: '<3', tier: 2, easy: true, name: tr('CRUSH DA CACHOEIRA'), desc: tr('Jogue no Dia dos Namorados (11 a 13/6). Libera a CAIXA DE BOMBOM.'), skin: 'b:bonbon' },
  { id: 'junina', icon: 'ARR', tier: 2, easy: true, name: tr('ARRAIÁ DO BARRIL'), desc: tr('Jogue em junho, mês de festa junina. Libera a ESPIGA DE MILHO.'), skin: 'b:corn' },
  { id: 'sete', icon: '7/9', tier: 2, easy: true, name: tr('INDEPENDÊNCIA OU BARRIL!'), desc: tr('Jogue no 7 de Setembro (5 a 8/9). Libera o BARRIL DO GRITO.'), skin: 'b:grito' },
  { id: 'criancas', icon: 'KID', tier: 2, easy: true, name: tr('CRIANÇA INTERIOR'), desc: tr('Jogue no Dia das Crianças (10 a 13/10). Libera a CAIXA DE BRINQUEDOS.'), skin: 'b:toybox' },
  { id: 'halloween', icon: 'BOO', tier: 2, easy: true, name: tr('DOCES OU BARRIL'), desc: tr('Jogue no Halloween (25/10 a 2/11). Libera a ABÓBORA e a BRUXA.'), skin: ['b:pumpkin', 'r:witch'] },
  { id: 'natal', icon: 'HO!', tier: 2, easy: true, name: tr('NATAL NO BARRIL'), desc: tr('Jogue no Natal (20 a 26/12). Libera o PRESENTE e o PAPAI NOEL.'), skin: ['b:gift', 'r:santa'] },
  { id: 'tutorial', icon: '<->', tier: 1, easy: true, name: tr('AULA DE DIREÇÃO'), desc: tr('Termine a descida guiada da primeira partida, ou faça o tutorial em SOBRE (o "?" da tela inicial).') },
  { id: 'devmode', icon: '</>', tier: 2, easy: true, name: tr('AGORA VOCÊ É UM DESENVOLVEDOR'), desc: tr('Tem algo escondido na tela SOBRE. Dica: o Android faz a mesma coisa. Libera o BARRIL DE DEBUG.'), skin: 'b:debug' },
  { id: 'notif', icon: '19h', tier: 1, easy: true, needs: 'notif', name: tr('ATENDEU O CHAMADO'), desc: tr('Toque num lembrete do jogo (LEMBRETES ligado em AJUSTES). Libera o POMBO-CORREIO.'), skin: 'r:pigeon' },
  { id: 'invite1', icon: 'RSVP', tier: 2, easy: true, name: tr('CONVITE ACEITO'), desc: tr('Um amigo abriu o seu convite (SOBRE, no "?") com o jogo instalado. Libera o ENVELOPE.'), skin: 'b:envelope' },
  { id: 'invitenew', icon: 'NEW', tier: 3, easy: true, name: tr('EMBAIXADOR DA CACHOEIRA'), desc: tr('Um jogador novo começou a jogar pelo seu convite. Libera o EMBAIXADOR DA CACHOEIRA.'), skin: 'r:ambassador' },
  { id: 'invite5', icon: '5NEW', tier: 3, easy: true, name: tr('PUXOU A GALERA'), desc: tr('5 jogadores novos começaram pelo seu convite.') },
  { id: 'invited', icon: 'OI!', tier: 2, easy: true, name: tr('CHEGUEI PELO CONVITE'), desc: tr('Comece a jogar pelo convite de um amigo. Ganhe a CESTA DE BOAS-VINDAS de presente.'), skin: 'b:welcome' },
  { id: 'daily1', icon: 'D1', tier: 1, name: tr('DEVER DE CASA'), desc: tr('Conclua um desafio do dia.') },
  { id: 'dailyhard', icon: 'D!', tier: 2, name: tr('DESAFIO ACEITO'), desc: tr('Conclua um desafio do dia no DIFÍCIL.') },
  { id: 'daily7', icon: 'D7', tier: 2, name: tr('BATENDO PONTO'), desc: tr('Conclua 7 desafios do dia, somando todos os dias.') },
  { id: 'dailyall', icon: 'D3', tier: 2, name: tr('DIA PERFEITO'), desc: tr('Conclua o desafio do dia e os 2 mini-desafios no mesmo dia.') },
  { id: 'mini10', icon: 'm10', tier: 1, name: tr('PEQUENAS VITÓRIAS'), desc: tr('Conclua 10 mini-desafios, somando todos os dias.') },
  { id: 'mini50', icon: 'm50', tier: 3, name: tr('TAREFEIRO'), desc: tr('Conclua 50 mini-desafios. Riscou a lista inteira.') },
  { id: 'wkday', icon: 'S/D', tier: 2, name: tr('FIM DE SEMANA PRODUTIVO'), desc: tr('Conclua os 3 desafios de um sábado ou de um domingo. Libera o TIO DO CHURRASCO e a CHURRASQUEIRA.'), skin: ['r:grillman', 'b:grill'] },
  { id: 'wkfull', icon: '6/6', tier: 3, name: tr('SEM DESCANSO'), desc: tr('Conclua os 6 desafios do mesmo fim de semana (3 no sábado e 3 no domingo). Libera o FAROFEIRO e a BOIA DE FLAMINGO.'), skin: ['r:farofa', 'b:flamingo'] },
  { id: 'daily30', icon: 'D30', tier: 3, name: tr('FUNCIONÁRIO DO MÊS'), desc: tr('Conclua 30 desafios do dia. Carteira assinada na cachoeira. Libera a CANECA DE CAFÉ.'), skin: 'b:mug' },
  // ---- historical figures, rescue and professions ----
  { id: 'vangogh', icon: 'EAR', tier: 2, name: tr('UMA ORELHA A MENOS'), desc: tr('Leve uma batida antes dos 50 m e ainda chegue a 500 m. Perdeu um pedaço, ganhou uma obra-prima. Libera o VAN GOGH e o BARRIL ESTRELADO.'), skin: ['r:vangogh', 'b:starry'] },
  { id: 'picasso', icon: '[:/', tier: 2, name: tr('CUBISMO ACIDENTAL'), desc: tr('Pegue a TONTURA e chegue a 300 m. O mundo fica torto, a arte fica pronta. Libera o PICASSO e o BARRIL CUBISTA.'), skin: ['r:picasso', 'b:cubist'] },
  { id: 'mozart', icon: 'DÓ', tier: 2, name: tr('PEQUENA SERENATA NOTURNA'), desc: tr('Chegue a 300 m de noite com o som e a música ligados. Libera o MOZART e o PIANO DE CAUDA.'), skin: ['r:mozart', 'b:piano'] },
  { id: 'davinci', icon: 'DV', tier: 2, name: tr('GÊNIO DA RENASCENÇA'), desc: tr('Pegue 3 power-ups diferentes numa descida só. Inventor que é inventor usa tudo. Libera o DA VINCI e a MONA LISA.'), skin: ['r:davinci', 'b:monalisa'] },
  { id: 'stormsafe', icon: '/!\\', tier: 3, name: tr('ALERTA SEVERO'), desc: tr('Atravesse uma tempestade inteira, até o tempo abrir, sem levar nenhuma batida. Libera a DEFESA CIVIL e o BOTE INFLÁVEL.'), skin: ['r:civil', 'b:raft'] },
  { id: 'cleanrec', icon: 'OK', tier: 2, name: tr('FICHA LIMPA'), desc: tr('Chegue a 500 m sem pegar nenhum power-down. Nada consta. Libera o POLICIAL e a VIATURA.'), skin: ['r:cop', 'b:police'] },
  { id: 'firefight', icon: 'SOS', tier: 3, name: tr('HERÓI SEM CAPA'), desc: tr('Leve 2 batidas e mesmo assim chegue a 1000 m. Libera o BOMBEIRO e o HIDRANTE.'), skin: ['r:fireman', 'b:hydrant'] },
  { id: 'doctor', icon: '+10', tier: 2, name: tr('PLANTÃO MÉDICO'), desc: tr('Conserte o barril 10 vezes, somando todas as descidas. Libera o MÉDICO e a AMBULÂNCIA.'), skin: ['r:doctor', 'b:ambulance'] },
  { id: 'nopause', icon: '>>|', tier: 3, name: tr('NÃO PAUSA QUE TÁ NO CHEFÃO'), desc: tr('Chegue a 1000 m sem pausar nenhuma vez. Banheiro depois. Libera o GAMER e o FLIPERAMA.'), skin: ['r:gamer', 'b:arcade'] },
  // ---- combos: a rider in a barrel, down to some distance ----
  { id: 'annie', icon: '1901', tier: 3, name: tr('A RAINHA DA CACHOEIRA'), desc: tr('Chegue a 500 m com o GATO LARANJA. Libera a TIA ANNIE e o BARRIL DE 1901.'), skin: ['r:annie', 'b:b1901'] },
  { id: 'sherlock', icon: '?!', tier: 2, name: tr('ELEMENTAR'), desc: tr('Pegue 2 cápsulas "?" numa descida. Libera o SHERLOCK HOLMES.'), skin: 'r:sherlock' },
  { id: 'xerife', icon: 'BOTA', tier: 2, name: tr('TEM UMA PEDRA NA MINHA BOTA'), desc: tr('Chegue a 300 m com o CAUBÓI. Libera o XERIFE DE BRINQUEDO.'), skin: 'r:xerife' },
  { id: 'arquiteto', icon: 'LGN', tier: 2, name: tr('LENDÁ... ESPERA... RIO!'), desc: tr('Desça 500 m debaixo de chuva. Libera o ARQUITETO (e o guarda-chuva amarelo).'), skin: 'r:arquiteto' },
  { id: 'quimico', icon: 'Hg', tier: 2, name: tr('QUÍMICA PURA'), desc: tr('Pegue 5 power-ups numa descida. Libera o PROFESSOR DE QUÍMICA.'), skin: 'r:quimico' },
  { id: 'numeros', icon: '108', tier: 2, name: '4 8 15 16 23 42', desc: tr('Termine uma descida entre 108 e 115 m. Libera o SOBREVIVENTE DO VOO e a ESCOTILHA.'), skin: ['r:voo815', 'b:hatch'] },
  { id: 'batatinha', icon: '456', tier: 3, name: tr('BATATINHA FRITA 1, 2, 3'), desc: tr('Chegue a 456 m com o barril a uma batida de quebrar. Libera o JOGADOR 456.'), skin: 'r:jogador' },
  { id: 'assalto', icon: '$$$', tier: 3, name: tr('O PLANO PERFEITO'), desc: tr('Junte 100 moedas numa descida. Libera o LADRÃO DE MACACÃO.'), skin: 'r:ladrao' },
  { id: 'inverno', icon: 'NEVE', tier: 2, name: tr('O INVERNO CHEGOU'), desc: tr('Desça 300 m com NEVE. Libera o REI DO NORTE e o TRONO DE ESPADAS.'), skin: ['r:nortista', 'b:throne'] },
  { id: 'toctoc', icon: 'TOC', tier: 2, name: tr('TOC TOC TOC, CACHOEIRA'), desc: tr('Pause 3 vezes numa descida e chegue a 300 m. Libera o FÍSICO TEÓRICO.'), skin: 'r:fisico' },
  { id: 'maes', icon: 'MÃE', tier: 2, easy: true, name: tr('BÊNÇÃO, MÃE'), desc: tr('Jogue no fim de semana do Dia das Mães (2º domingo de maio). Libera a MÃE e o VASO DE FLORES.'), skin: ['r:mae', 'b:vaso'] },
  { id: 'pais', icon: 'PAI', tier: 2, easy: true, name: tr('PAVÊ OU PACOMÊ'), desc: tr('Jogue no fim de semana do Dia dos Pais (2º domingo de agosto). Libera o PAI e a CAIXA DE FERRAMENTAS.'), skin: ['r:pai', 'b:toolbox'] },
  { id: 'ladosombrio', icon: 'DRK', tier: 1, easy: true, name: tr('LADO SOMBRIO'), desc: tr('Jogue com o celular no modo escuro. Seus olhos agradecem.') },
  { id: 'piao', icon: '360', tier: 2, easy: true, needs: 'motion', name: tr('PIÃO DA CASA PRÓPRIA'), desc: tr('Na tela inicial, com o celular deitado na mesa, gire ele uma volta inteira. Libera o PIÃO.'), skin: 'b:piao' },
  { id: 'soneca', icon: 'Zzz', tier: 1, easy: true, needs: 'motion', name: tr('SONECA'), desc: tr('Com o jogo pausado, deixe o celular de tela pra baixo por 3 s. Cinco minutinhos. Libera o SONÂMBULO.'), skin: 'r:sonambulo' },
  { id: 'arregou', icon: 'FUI', tier: 1, easy: true, name: 'ARREGOU!', desc: 'Saia de uma descida pelo menu de pausa. A cachoeira venceu essa.' },
  { id: 'arregou1000', icon: 'PQ?', tier: 2, name: 'TÃO PERTO, TÃO LONGE', desc: 'Desista de uma descida depois de passar dos 1000 m. Por quê?!' },
  { id: 'c_annie', icon: '1901', tier: 4, combo: ['annie', 'b1901', 1901], name: tr('DE VOLTA A 1901'), desc: tr('Desça 1901 m com a TIA ANNIE no BARRIL DE 1901. A história se repete, com mais gatos.') },
  { id: 'c_unicorn', icon: '~*~', tier: 3, combo: ['unicorn', 'rainbowb', 1000], name: tr('BRILHO ETERNO'), desc: tr('Desça 1000 m com o UNICÓRNIO no BARRIL ARCO-ÍRIS. Purpurina até o fundo da cachoeira.') },
  { id: 'c_cat', icon: '[=]', tier: 2, combo: ['cat', 'box', 300], name: tr('SE CABE, EU SENTO'), desc: tr('Desça 300 m com o GATO LARANJA na CAIXA DE PAPELÃO. Lei universal dos gatos.') },
  { id: 'c_pirate', icon: 'ARR', tier: 2, combo: ['pirate', 'classic', 500], name: tr('PIRATA RAIZ'), desc: tr('Desça 500 m com o PIRATA no BARRIL CLÁSSICO. Nada de navio, barril de verdade.') },
  { id: 'c_viking', icon: 'SKL', tier: 2, combo: ['viking', 'keg', 500], name: tr('VALHALLA OPEN BAR'), desc: tr('Desça 500 m com o VIKING no BARRIL DE CHOPP. Odin pagou a rodada.') },
  { id: 'c_dev', icon: '{ }', tier: 2, combo: ['dev', 'mug', 500], name: tr('DEPLOY NA SEXTA'), desc: tr('Desça 500 m com o DEV FULL STACK na CANECA DE CAFÉ. Subiu pra produção e ninguém sabe por que funcionou.') },
  { id: 'c_caramelo', icon: 'AU!', tier: 2, combo: ['caramelo', 'trash', 200], name: tr('BANQUETE DO CARAMELO'), desc: tr('Desça 200 m com o VIRA-LATA CARAMELO na LATA DE LIXO. Achou um osso no caminho.') },
  { id: 'c_robot', icon: 'BIP', tier: 2, combo: ['robot', 'washer', 300], name: tr('REVOLTA DOS ELETRODOMÉSTICOS'), desc: tr('Desça 300 m com o ROBÔ na MÁQUINA DE LAVAR. As máquinas tomaram a cachoeira.') },
  { id: 'c_dino', icon: '(O)', tier: 2, combo: ['dino', 'egg', 300], name: tr('DE VOLTA PRO OVO'), desc: tr('Desça 300 m com o DINOSSAURO no OVO DE PÁSCOA. Extinção adiada.') },
  { id: 'c_marquio', icon: 'WAH', tier: 2, combo: ['marquio', 'pipe', 500], name: tr('ENCANAMENTO EM DIA'), desc: tr('Desça 500 m com o MARQUIO no TUBO VERDE. Desentupiu a cachoeira inteira.') },
  { id: 'c_vangogh', icon: '*.*', tier: 2, combo: ['vangogh', 'starry', 300, 'night'], name: tr('NOITE ESTRELADA'), desc: tr('Desça 300 m de noite com o VAN GOGH no BARRIL ESTRELADO. O céu posou pro quadro.') },
  { id: 'c_picasso', icon: '<>[', tier: 2, combo: ['picasso', 'cubist', 300], name: tr('ARTE MODERNA'), desc: tr('Desça 300 m com o PICASSO no BARRIL CUBISTA. Ninguém entendeu, todo mundo aplaudiu.') },
  { id: 'c_mozart', icon: 'FÁ', tier: 2, combo: ['mozart', 'piano', 500], name: tr('SINFONIA DA CACHOEIRA'), desc: tr('Desça 500 m com o MOZART no PIANO DE CAUDA. Cada pedra é uma nota.') },
  { id: 'c_davinci', icon: ':)?', tier: 2, combo: ['davinci', 'monalisa', 500], name: tr('O SORRISO MAIS FAMOSO'), desc: tr('Desça 500 m com o DA VINCI na MONA LISA. Ela sorriu? Ninguém sabe.') },
  { id: 'c_civil', icon: '199', tier: 3, combo: ['civil', 'raft', 300, 'storm'], name: tr('RESGATE NA TEMPESTADE'), desc: tr('Desça 300 m na tempestade com a DEFESA CIVIL no BOTE INFLÁVEL. O SMS chegou depois.') },
  { id: 'c_cop', icon: '190', tier: 2, combo: ['cop', 'police', 500], name: tr('PERSEGUIÇÃO NA CACHOEIRA'), desc: tr('Desça 500 m com o POLICIAL na VIATURA. Encosta a cachoeira aí, cidadão!') },
  { id: 'c_fire', icon: '193', tier: 2, combo: ['fireman', 'hydrant', 300], name: tr('ÁGUA É O QUE NÃO FALTA'), desc: tr('Desça 300 m com o BOMBEIRO no HIDRANTE. O bombeiro mais bem abastecido do Brasil.') },
  { id: 'c_doctor', icon: '192', tier: 2, combo: ['doctor', 'ambulance', 500], name: tr('PLANTÃO DE 24 HORAS'), desc: tr('Desça 500 m com o MÉDICO na AMBULÂNCIA. Já pode tomar um café.') },
  { id: 'c_gamer', icon: 'GG', tier: 3, combo: ['gamer', 'arcade', 1000], name: tr('SPEEDRUN DA CACHOEIRA'), desc: tr('Desça 1000 m com o GAMER no FLIPERAMA. Recorde mundial, sem bug.') },
  { id: 'c_chef', icon: 'PSS', tier: 2, combo: ['chef', 'cooker', 300], name: tr('FEIJÃO NO PONTO'), desc: tr('Desça 300 m com o CHEF na PANELA DE PRESSÃO. Desliga quando apitar.') },
  { id: 'c_courier', icon: '5*', tier: 2, combo: ['courier', 'bag', 500], name: tr('CHEGOU QUENTINHO'), desc: tr('Desça 500 m com o ENTREGADOR na BAG DE ENTREGA. Avalia com 5 estrelas?') },
  { id: 'c_samurai', icon: 'JPN', tier: 2, combo: ['samurai', 'japan', 600], name: tr('HONRA DO SOL NASCENTE'), desc: tr('Desça 600 m com o SAMURAI no BARRIL JAPONÊS. Chegou no fundo no segundo exato.') },
  { id: 'c_gondola', icon: 'SOLE', tier: 2, combo: ['gondolier', 'italy', 500], name: tr('O SOLE MIO'), desc: tr('Desça 500 m com o GONDOLEIRO no BARRIL ITALIANO. Veneza nunca teve uma correnteza dessas.') },
  { id: 'c_mariachi', icon: 'AY!', tier: 2, combo: ['mariachi', 'mexico', 600], name: tr('ARRIBA, ARRIBA!'), desc: tr('Desça 600 m com o MARIACHI no BARRIL MEXICANO. A serenata saiu picante.') },
  { id: 'c_cowboy', icon: 'YEE', tier: 2, combo: ['cowboy', 'usa', 500], name: tr('VELHO OESTE MOLHADO'), desc: tr('Desça 500 m com o CAUBÓI no BARRIL AMERICANO. O touro mecânico mais molhado do mundo.') },
  { id: 'c_guard', icon: 'TEA', tier: 2, combo: ['guard', 'phone', 600], name: tr('CHÁ DAS CINCO'), desc: tr('Desça 600 m com o GUARDA REAL na CABINE TELEFÔNICA. Nem piscou. Nem pode.') },
  { id: 'c_penguin', icon: 'BRR', tier: 2, combo: ['penguin', 'iceberg', 600], name: tr('VOLTANDO PRA CASA'), desc: tr('Desça 600 m com o PINGUIM DO TERMINAL no ICEBERG. Saudade do polo.') },
  { id: 'c_dumont', icon: '14B', tier: 3, combo: ['dumont', 'dumont', 700], name: tr('O VOO DO 14-BARRIL'), desc: tr('Desça 700 m com o SANTOS DUMMOUND no 14-BARRIL. Mais pesado que o ar, mas com estilo.') },
  { id: 'c_santa', icon: 'HOHO', tier: 2, combo: ['santa', 'gift', 600], name: tr('ENTREGA ANTECIPADA'), desc: tr('Desça 600 m com o PAPAI NOEL no PRESENTE. Esse ano chegou pela cachoeira.') },
  { id: 'c_bunny', icon: 'EGG', tier: 2, combo: ['bunny', 'egg', 500], name: tr('ACHEI O OVO!'), desc: tr('Desça 500 m com o COELHO DA PÁSCOA no OVO DE PÁSCOA. Tava aqui o tempo todo.') },
  { id: 'c_witch', icon: 'HEX', tier: 2, combo: ['witch', 'pumpkin', 600], name: tr('MEIA-NOITE NA ABÓBORA'), desc: tr('Desça 600 m com a BRUXA na ABÓBORA. O feitiço virou carruagem? Não. Barril.') },
  { id: 'c_clown', icon: 'HONK', tier: 2, combo: ['clown', 'confetti', 500], name: tr('BLOCO DO PALHAÇO'), desc: tr('Desça 500 m com o PALHAÇO no BARRIL DE CONFETE. O carnaval desceu a cachoeira.') },
  { id: 'c_miner', icon: 'UAI', tier: 2, combo: ['miner', 'charcoal', 600], name: tr('MINA DE CARVÃO'), desc: tr('Desça 600 m com o MINEIRO no BARRIL DE CARVÃO. Uai, mas é carvão pra churrasco?') },
  { id: 'c_hitch', icon: '42', tier: 2, combo: ['hitch', 'guide', 600], name: tr('NÃO ENTRE EM PÂNICO'), desc: tr('Desça 600 m com o MOCHILEIRO no GUIA DE BOLSO DA GALÁXIA. Trouxe a toalha, claro.') },
  { id: 'c_cyborg', icon: 'BRB', tier: 3, combo: ['cyborg', 'cyborgb', 700], name: tr('EU VOLTAREI'), desc: tr('Desça 700 m com o CIBORGUE DO FUTURO no BARRIL EXTERMINADO. Ele voltou. E desceu.') },
  { id: 'c_zombie', icon: 'RAD', tier: 2, combo: ['zombie', 'radio', 600], name: tr('APOCALIPSE RADIOATIVO'), desc: tr('Desça 600 m com o ZUMBI no BARRIL RADIOATIVO. Agora ele brilha no escuro.') },
  { id: 'c_robot2', icon: '100%', tier: 2, combo: ['robot', 'generator', 600], name: tr('CARGA TOTAL'), desc: tr('Desça 600 m com o ROBÔ no GERADOR. Bateria em 100%, juízo em 0%.') },
  { id: 'c_brick', icon: 'LEGO', tier: 2, combo: ['brickman', 'bricks', 500], name: tr('PEÇA POR PEÇA'), desc: tr('Desça 500 m com o BONEQUINHO DE BLOCOS no BARRIL DE BLOQUINHOS. Montado com manual e tudo.') },
  { id: 'c_castaway', icon: 'SOS', tier: 2, combo: ['castaway', 'cooler', 500], name: tr('KIT SOBREVIVÊNCIA'), desc: tr('Desça 500 m com o NÁUFRAGO na CAIXA DE ISOPOR. Gelo, refri e o Milson.') },
  { id: 'c_scientist', icon: 'ZAP', tier: 2, combo: ['scientist', 'blender', 600], name: tr('EXPERIMENTO FORA DE CONTROLE'), desc: tr('Desça 600 m com o CIENTISTA MALUCO no LIQUIDIFICADOR. Era pra ser uma vitamina.') },
  { id: 'c_pony', icon: 'HEXA', tier: 3, combo: ['pony', 'grito', 700], name: tr('RUMO AO HEXA'), desc: tr('Desça 700 m com o CAVALINHO DA SELEÇÃO no BARRIL DO GRITO. É GOOOL!') },
  { id: 'c_lapwing', icon: 'QQ', tier: 2, combo: ['lapwing', 'corn', 500], name: tr('ARRAIÁ DO QUERO-QUERO'), desc: tr('Desça 500 m com o QUERO-QUERO na ESPIGA DE MILHO. Quer quentão também.') },
  { id: 'c_handyman', icon: 'PLOP', tier: 2, combo: ['handyman', 'toilet', 500], name: tr('DESENTUPIDORA EXPRESSA'), desc: tr('Desça 500 m com o FAZ-TUDO na PRIVADA. Serviço feito, orçamento sem compromisso.') },
  { id: 'c_devil', icon: 'HOT', tier: 2, combo: ['devil', 'lava', 600], name: tr('QUENTE COMO O INFERNO'), desc: tr('Desça 600 m com o DEMÔNIO no BARRIL VULCÂNICO. Ele se sentiu em casa.') },
  { id: 'c_sponge', icon: 'BATH', tier: 2, combo: ['sponge', 'duck', 500], name: tr('HORA DO BANHO'), desc: tr('Desça 500 m com a BUCHINHA no PATINHO DE BORRACHA. Esfrega atrás da orelha.') },
  { id: 'c_cow', icon: 'LEITE', tier: 2, combo: ['cow', 'jug', 500], name: tr('LEITE DE GALÃO'), desc: tr('Desça 500 m com a VACA no GALÃO DE ÁGUA. Desnatado, segundo ela.') },
  { id: 'c_et', icon: 'CASA', tier: 2, combo: ['et', 'orelhao', 600], name: tr('LIGAÇÃO INTERPLANETÁRIA'), desc: tr('Desça 600 m com o ET no ORELHÃO. Ligação a cobrar pra outra galáxia.') },
  { id: 'c_courier2', icon: 'MÊS', tier: 2, combo: ['courier', 'cart', 600], name: tr('COMPRA DO MÊS'), desc: tr('Desça 600 m com o ENTREGADOR no CARRINHO DE MERCADO. Esqueceu o pão.') },
  { id: 'c_pirate2', icon: 'TERRA', tier: 2, combo: ['pirate', 'portugal', 600], name: tr('TERRA À VISTA!'), desc: tr('Desça 600 m com o PIRATA no BARRIL PORTUGUÊS. Descobriu a cachoeira em 1500.') },
  { id: 'c_chef2', icon: 'OUI', tier: 2, combo: ['chef', 'france', 600], name: tr('BAGUETE NA CACHOEIRA'), desc: tr('Desça 600 m com o CHEF no BARRIL FRANCÊS. Oui, chef!') },
  { id: 'c_wolf', icon: 'AUU', tier: 2, combo: ['wolf', 'classic', 600, 'night'], name: tr('LOBO DO MAR'), desc: tr('Desça 600 m com o LOBISOMEM no BARRIL CLÁSSICO, de noite. Lua cheia na cachoeira.') },
  // ---- TV and villains ----
  { id: 'milton', icon: 'MAOE', tier: 2, name: tr('QUEM QUER DINHEIRO?'), desc: tr('Pegue 5 bolhas douradas numa descida só. Ma oeee! Libera o MILTON SOUSA e o BAÚ DE PRÊMIOS.'), skin: ['r:milton', 'b:chest'] },
  { id: 'nazare', icon: '?+?', tier: 2, name: tr('AS CONTAS NÃO FECHAM'), desc: tr('Pegue a TONTURA 2 vezes numa descida só. Libera a NAZARÉ CONFUSA.'), skin: 'r:nazare' },
  { id: 'darklord', icon: 'HHH', tier: 3, name: tr('O LADO SOMBRIO'), desc: tr('Desça 500 m de noite no DIFÍCIL. Libera o LORDE SOMBRIO.'), skin: 'r:darklord' },
  { id: 'c_milton', icon: 'BAÚ', tier: 2, combo: ['milton', 'chest', 600], name: tr('ABRE A PORTA DA ESPERANÇA'), desc: tr('Desça 600 m com o MILTON SOUSA no BAÚ DE PRÊMIOS. Ma oeee!') },
  { id: 'c_faustino', icon: 'LOCO', tier: 2, combo: ['faustino', 'tank', 500], name: tr('Ô LOCO, MEU!'), desc: tr('Desça 500 m com o FAUSTINO DO DOMINGÃO na CAIXA D\'ÁGUA. Essa cachoeira é da pesada!') },
  { id: 'c_nazare', icon: '2+2', tier: 2, combo: ['nazare', 'cubist', 500], name: tr('MATEMÁTICA DE NOVELA'), desc: tr('Desça 500 m com a NAZARÉ CONFUSA no BARRIL CUBISTA. Nada faz sentido, nem os metros.') },
  { id: 'c_odete', icon: '$$$', tier: 2, combo: ['odete', 'gold', 600], name: tr('DINHEIRO NÃO É TUDO'), desc: tr('Desça 600 m com a ODETE ROIBARRIL no BARRIL DE OURO. Mas ajuda.') },
  { id: 'c_darklord', icon: 'KHH', tier: 3, combo: ['darklord', 'armor', 700], name: tr('RESPIRAÇÃO PESADA'), desc: tr('Desça 700 m com o LORDE SOMBRIO no BARRIL BLINDADO. Sua falta de fé nas pedras é perturbadora.') },
  { id: 'c_sinister', icon: 'HAHA', tier: 2, combo: ['sinister', 'toybox', 500], name: tr('POR QUE TÃO SÉRIO?'), desc: tr('Desça 500 m com o PALHAÇO SINISTRO na CAIXA DE BRINQUEDOS. Os brinquedos estão com medo.') },
  { id: 'c_nightmare', icon: 'ZZZ!', tier: 2, combo: ['nightmare', 'coffin', 600, 'night'], name: tr('NÃO DURMA NA CACHOEIRA'), desc: tr('Desça 600 m de noite com o PESADELO DA RUA no CAIXÃO. Um, dois, ele vem te pegar...') },
  { id: 'friday13', icon: '13!', tier: 2, easy: true, name: tr('SEXTA-FEIRA 13'), desc: tr('Jogue numa sexta-feira 13. Ele só aparece nesse dia. Libera o JACKSON.'), skin: 'r:jackson' },
  { id: 'jackson', icon: 'HKY', tier: 3, name: tr('ELE SEMPRE VOLTA'), desc: tr('Desça 1300 m com o JACKSON, em qualquer barril. Libera o BARRIL DO ACAMPAMENTO.'), skin: 'b:camp' },
  { id: 'c_jackson', icon: 'LAGO', tier: 3, combo: ['jackson', 'camp', 613, 'night'], name: tr('NÃO ENTRE NO LAGO À NOITE'), desc: tr('Desça 613 m de noite com o JACKSON no BARRIL DO ACAMPAMENTO. Ch ch ch... ah ah ah...') },
  // ---- explorers, inventors, spies and teachers ----
  { id: 'incognito', icon: 'ANON', tier: 2, name: tr('MODO ANÔNIMO'), desc: tr('Chegue a 300 m sem pegar nada: nem moeda, nem power-up, nem chave inglesa. Sem deixar rastros. Libera o AGENTE ANÔNIMO.'), skin: 'r:incognito' },
  { id: 'raio', icon: 'BZZ', tier: 3, name: tr('PARA-RAIO HUMANO'), desc: tr('Leve um raio da tempestade e continue descendo (com escudo também vale). Libera o ARREPIADO e o CHUVEIRO ELÉTRICO.'), skin: ['r:arrepiado', 'b:chuveiro'] },
  { id: 'entreraios', icon: '/\\/', tier: 3, name: tr('DANÇA DOS RAIOS'), desc: tr('Atravesse uma tempestade inteira sem nenhuma batida, com pelo menos 3 raios caindo raspando (UFA!).') },
  { id: 'impacto', icon: 'TST', tier: 2, name: tr('TESTE DE IMPACTO'), desc: tr('Leve 3 batidas numa descida e mesmo assim chegue a 300 m. Libera o BONECO DE TESTE e o BARRIL CERTIFICADO.'), skin: ['r:dummy', 'b:certificado'] },
  { id: 'schrodinger', icon: '?!', tier: 3, name: tr('VIVO E MORTO'), desc: tr('Use uma SOBREVIDA com o GATO LARANJA. Quebrou e não quebrou. Libera o GATO DE SCHRÖDINGER.'), skin: 'r:schrodinger' },
  { id: 'escolhido', icon: '010', tier: 3, name: tr('NÃO EXISTE PEDRA'), desc: tr('Raspe em 3 pedras durante uma CÂMERA LENTA. Libera O ESCOLHIDO e a CHUVA DE CÓDIGO.'), skin: ['r:escolhido', 'b:matrix'] },
  { id: 'pomo', icon: 'o~', tier: 2, name: tr('APANHADOR'), desc: tr('Pegue 3 bolhas douradas numa descida. Libera o BRUXINHO DE ÓCULOS.'), skin: 'r:bruxo' },
  { id: 'emchamas', icon: 'FOGO', tier: 3, needs: 'mic', name: tr('A GAROTA EM CHAMAS'), desc: tr('Com o microfone ligado, chegue a 500 m numa descida em que o barril pegou fogo. Libera a TRIBUTA.'), skin: 'r:tributa' },
  { id: 'tesla', icon: 'ZAP', tier: 3, name: tr('RAIO NA GARRAFA'), desc: tr('Desvie de 5 raios da tempestade numa descida só. Libera o ALQUIMISTA DA ELETRICIDADE e a BOBINA ELÉTRICA.'), skin: ['r:tesla', 'b:coil'] },
  { id: 'ada', icon: 'PRIM', tier: 2, name: tr('NÚMERO PRIMO'), desc: tr('Quebre o barril num número primo de metros acima de 100 (101, 103, 107...). Libera a MATEMÁGICA DOS ALGORITMOS e a MÁQUINA ANALÍTICA.'), skin: ['r:ada', 'b:analytic'] },
  { id: 'darwin', icon: 'EVO', tier: 3, name: tr('A ORIGEM DAS ESPÉCIES'), desc: tr('Tenha 20 pilotos diferentes. Libera o NATURALISTA DAS ILHAS e o CASCO DE TARTARUGA.'), skin: ['r:darwin', 'b:tortoise'] },
  { id: 'agent006', icon: '006', tier: 2, name: tr('BATIDO, NÃO MEXIDO'), desc: tr('Leve uma batida e depois fique 6 s sem inclinar o celular, na mesma descida. Libera o AGENTE 006.'), skin: 'r:agent006' },
  { id: 'professor', icon: 'A+', tier: 2, name: tr('APRENDEU A LIÇÃO'), desc: tr('Depois de uma descida abaixo de 50 m, chegue a 500 m na seguinte. Libera o PROFESSOR e o QUADRO NEGRO.'), skin: ['r:professor', 'b:chalkboard'] },
  { id: 'c_relic', icon: 'IDOL', tier: 2, combo: ['relic', 'temple', 600], name: tr('ISSO PERTENCE A UM MUSEU!'), desc: tr('Desça 600 m com o CAÇADOR DE RELÍQUIAS no TEMPLO PERDIDO. Tem uma pedra gigante rolando atrás.') },
  { id: 'c_anon', icon: '???', tier: 2, combo: ['incognito', 'box', 500], name: tr('NINGUÉM ME VIU'), desc: tr('Desça 500 m com o AGENTE ANÔNIMO na CAIXA DE PAPELÃO. Histórico apagado com sucesso.') },
  { id: 'c_arrepiado', icon: 'CHIA', tier: 3, combo: ['arrepiado', 'chuveiro', 300, 'storm'], name: tr('BANHO DE RAIO'), desc: tr('Desça 300 m na tempestade com o ARREPIADO no CHUVEIRO ELÉTRICO. A água esquentou sozinha.') },
  { id: 'c_dummy', icon: 'OK', tier: 2, combo: ['dummy', 'certificado', 500], name: tr('APROVADO NO TESTE'), desc: tr('Desça 500 m com o BONECO DE TESTE no BARRIL CERTIFICADO. Pode pôr o selo.') },
  { id: 'c_escolhido', icon: '0101', tier: 3, combo: ['escolhido', 'matrix', 1000], name: tr('SAIU DA SIMULAÇÃO'), desc: tr('Desça 1000 m com O ESCOLHIDO na CHUVA DE CÓDIGO. A cachoeira era só código o tempo todo.') },
  { id: 'c_tesla', icon: 'VOLT', tier: 3, combo: ['tesla', 'coil', 300, 'storm'], name: tr('ENERGIA DE GRAÇA'), desc: tr('Desça 300 m na tempestade com o ALQUIMISTA DA ELETRICIDADE na BOBINA ELÉTRICA. Os raios vieram carregar.') },
  { id: 'c_ada', icon: '0101', tier: 2, combo: ['ada', 'analytic', 512], name: tr('PRIMEIRO PROGRAMA'), desc: tr('Desça 512 m com a MATEMÁGICA DOS ALGORITMOS na MÁQUINA ANALÍTICA. Em binário: 1000000000.') },
  { id: 'c_darwin', icon: 'SLOW', tier: 2, combo: ['darwin', 'tortoise', 500], name: tr('SOBREVIVÊNCIA DO MAIS LENTO'), desc: tr('Desça 500 m com o NATURALISTA DAS ILHAS no CASCO DE TARTARUGA. A seleção natural tá confusa.') },
  { id: 'c_006', icon: '606', tier: 2, combo: ['agent006', 'armor', 606], name: tr('QUASE FAMOSO'), desc: tr('Desça 606 m com o AGENTE 006 no BARRIL BLINDADO. Falta só um número.') },
  { id: 'c_prof', icon: '10', tier: 2, combo: ['professor', 'chalkboard', 500], name: tr('PROVA SURPRESA'), desc: tr('Desça 500 m com o PROFESSOR no QUADRO NEGRO. Cola não vale.') },
  // ---- matching pairs, Chaplolin and the slimming pen ----
  { id: 'pair1', icon: '=', tier: 1, name: tr('TÁ COMBINANDO!'), desc: tr('Desça 300 m com um piloto no barril que é o par dele. A loja mostra o par original; os outros são segredo.') },
  { id: 'pair10', icon: '10=', tier: 3, name: tr('DESFILE DE MODA'), desc: tr('Desça 300 m com 10 pares diferentes de piloto e barril. A cachoeira virou passarela.') },
  { id: 'astucia', icon: 'CH!', tier: 3, name: tr('NÃO CONTAVAM COM MINHA ASTÚCIA'), desc: tr('Leve uma batida e, depois dela, passe raspando em 5 pedras e chegue a 400 m. Libera o CHAPLOLIN e a MARRETA BIÔNICA.'), skin: ['r:chaplolin', 'b:mallet'] },
  { id: 'mounja', icon: 'DIETA', tier: 3, name: tr('SECOU NA CACHOEIRA'), desc: tr('Desça 700 m sem pegar nenhuma moeda nem power-up. Dieta rigorosa. Libera o TIO DA CANETINHA e a CANETA MOUNJA-RIO.'), skin: ['r:canetinha', 'b:pen'] },
  { id: 'c_chaplolin', icon: 'PÓ!', tier: 2, combo: ['chaplolin', 'mallet', 600], name: tr('SIGAM-ME OS BONS!'), desc: tr('Desça 600 m com o CHAPLOLIN na MARRETA BIÔNICA. Palma, palma, não priemos cânico!') },
  { id: 'c_mounja', icon: '-10KG', tier: 2, combo: ['canetinha', 'pen', 600], name: tr('MENOS 10 KG'), desc: tr('Desça 600 m com o TIO DA CANETINHA na CANETA MOUNJA-RIO. A balança da margem nem acreditou.') },
  { id: 'c_gates', icon: 'DEL', tier: 2, combo: ['gates', 'bluescreen', 600], name: tr('CTRL+ALT+DEL'), desc: tr('Desça 600 m com o BILL PORTÕES na TELA AZUL. Reiniciou e continuou descendo.') },
  { id: 'c_jobis', icon: 'PERA', tier: 2, combo: ['jobis', 'pear', 600], name: tr('PENSE DIFERENTE'), desc: tr('Desça 600 m com o ESTIVE TRABALHOS no BARRIL DA PERA. Só mais uma coisa: funcionou.') },
  { id: 'c_astro', icon: 'NASA', tier: 3, combo: ['astro', 'rocket', 700], name: tr('HOUSTON, TEMOS UM BARRIL'), desc: tr('Desça 700 m com o ASTRONAUTA no FOGUETE. Um pequeno passo pro barril.') },
  { id: 'c_ninja', icon: 'SHH', tier: 2, combo: ['ninja', 'bamboo', 500], name: tr('CAMUFLAGEM PERFEITA'), desc: tr('Desça 500 m com o NINJA no TRONCO DE BAMBU. Ninguém viu nada.') },
  { id: 'c_angel', icon: 'O', tier: 2, combo: ['angel', 'cloud', 500], name: tr('NAS NUVENS'), desc: tr('Desça 500 m com o ANJINHO na NUVEM. Desceu do céu e caiu na cachoeira.') },
  { id: 'c_bigfoot', icon: 'PÉ', tier: 2, combo: ['bigfoot', 'log', 500], name: tr('FOTO BORRADA'), desc: tr('Desça 500 m com o PÉ-GRANDE no TRONCO OCO. Ninguém conseguiu provar.') },
  { id: 'c_pirate3', icon: 'RUM', tier: 2, combo: ['pirate', 'rum', 600], name: tr('YO HO HO!'), desc: tr('Desça 600 m com o PIRATA no BARRIL DE RUM. E uma garrafa de rum. Que acabou.') },
  // ---- long combos: 800 to 3000 m ----
  { id: 'c_cat800', icon: 'MIAU', tier: 2, combo: ['cat', 'box', 800], name: tr('SE CABE, ELE DESCE'), desc: tr('Desça 800 m com o GATO LARANJA na CAIXA DE PAPELÃO. Gato vê caixa, gato entra na caixa.') },
  { id: 'c_viking800', icon: 'SKÅL', tier: 2, combo: ['viking', 'keg', 800], name: tr('SKÅL NA CACHOEIRA'), desc: tr('Desça 800 m com o VIKING no BARRIL DE CHOPP. Brinde nórdico a cada pedra.') },
  { id: 'c_caramelo800', icon: 'AU!', tier: 2, combo: ['caramelo', 'trash', 800], name: tr('REVIRANDO O LIXO'), desc: tr('Desça 800 m com o VIRA-LATA CARAMELO na LATA DE LIXO. Achou um osso no caminho.') },
  { id: 'c_samurai800', icon: 'BUSHI', tier: 2, combo: ['samurai', 'japan', 800], name: tr('CAMINHO DO GUERREIRO'), desc: tr('Desça 800 m com o SAMURAI no BARRIL JAPONÊS. Honra até o último metro.') },
  { id: 'c_gondolier800', icon: 'SOLE', tier: 2, combo: ['gondolier', 'italy', 800], name: tr('GÔNDOLA RADICAL'), desc: tr('Desça 800 m com o GONDOLEIRO no BARRIL ITALIANO. Cantando, claro.') },
  { id: 'c_chef800', icon: 'PSSS', tier: 2, combo: ['chef', 'cooker', 800], name: tr('PANELA APITANDO'), desc: tr('Desça 800 m com o CHEF DE COZINHA na PANELA DE PRESSÃO. Apitou, tá pronto.') },
  { id: 'c_gates900', icon: '99%', tier: 2, combo: ['gates', 'bluescreen', 900], name: tr('INSTALANDO ATUALIZAÇÕES'), desc: tr('Desça 900 m com o BILL PORTÕES na TELA AZUL. Não desligue o barril.') },
  { id: 'c_jobis900', icon: '+1', tier: 2, combo: ['jobis', 'pear', 900], name: tr('SÓ MAIS UMA COISA'), desc: tr('Desça 900 m com o ESTIVE TRABALHOS no BARRIL DA PERA. Lançamento revolucionário.') },
  { id: 'c_marquio900', icon: '1UP', tier: 2, combo: ['marquio', 'pipe', 900], name: tr('A PRINCESA TÁ EM OUTRA CACHOEIRA'), desc: tr('Desça 900 m com o MARQUIO no TUBO VERDE. Obrigado, mas ela não está aqui.') },
  { id: 'c_relic900', icon: 'MAPA', tier: 2, combo: ['relic', 'temple', 900], name: tr('O X MARCA O LUGAR'), desc: tr('Desça 900 m com o CAÇADOR DE RELÍQUIAS no TEMPLO PERDIDO. O tesouro era a descida.') },
  { id: 'c_cop900', icon: 'UÓ', tier: 2, combo: ['cop', 'police', 900], name: tr('ENCOSTA A CACHOEIRA AÍ!'), desc: tr('Desça 900 m com o POLICIAL na VIATURA. A pedra fugiu, mas foi pega.') },
  { id: 'c_fireman900', icon: '193', tier: 2, combo: ['fireman', 'hydrant', 900], name: tr('ALARME FALSO'), desc: tr('Desça 900 m com o BOMBEIRO no HIDRANTE. O incêndio era na outra cachoeira.') },
  { id: 'c_astro1000', icon: 'RÉ?', tier: 3, combo: ['astro', 'rocket', 1000], name: tr('FOGUETE NÃO TEM RÉ'), desc: tr('Desça 1000 m com o ASTRONAUTA no FOGUETE. Só pra frente. Ou pra baixo.') },
  { id: 'c_vangogh1000', icon: '***', tier: 3, combo: ['vangogh', 'starry', 1000, 'night'], name: tr('A NOITE ESTRELADA'), desc: tr('Desça 1000 m de noite com o VAN GOGH no BARRIL ESTRELADO. A obra-prima ficou molhada.') },
  { id: 'c_doctor1000', icon: '24H', tier: 3, combo: ['doctor', 'ambulance', 1000], name: tr('PLANTÃO SEM FOLGA'), desc: tr('Desça 1000 m com o MÉDICO na AMBULÂNCIA. Sem pausa pro cafezinho.') },
  { id: 'c_gamer2000', icon: 'ZEROU', tier: 4, combo: ['gamer', 'arcade', 2000], name: tr('ZEROU A CACHOEIRA'), desc: tr('Desça 2000 m com o GAMER no FLIPERAMA. Com uma ficha só.') },
  { id: 'c_civil1000', icon: 'SOS!', tier: 3, combo: ['civil', 'raft', 1000], name: tr('ALERTA MÁXIMO'), desc: tr('Desça 1000 m com a DEFESA CIVIL no BOTE INFLÁVEL. Colete laranja do começo ao fim.') },
  { id: 'c_chaplolin1000', icon: 'PÓPÓ', tier: 3, combo: ['chaplolin', 'mallet', 1000], name: tr('MIL MARRETADAS'), desc: tr('Desça 1000 m com o CHAPLOLIN na MARRETA BIÔNICA. Suspeitei desde o princípio.') },
  { id: 'c_mounja1500', icon: '-30KG', tier: 3, combo: ['canetinha', 'pen', 1500], name: tr('MENOS 30 KG'), desc: tr('Desça 1500 m com o TIO DA CANETINHA na CANETA MOUNJA-RIO. Já tá vestindo M.') },
  { id: 'c_milton1500', icon: 'CERTO', tier: 3, combo: ['milton', 'chest', 1500], name: tr('ESTÁ CERTO DISSO?'), desc: tr('Desça 1500 m com o MILTON SOUSA no BAÚ DE PRÊMIOS. Ma oeee, vale um barril!') },
  { id: 'c_darwin1500', icon: 'EVO!', tier: 3, combo: ['darwin', 'tortoise', 1500], name: tr('EVOLUÇÃO COMPLETA'), desc: tr('Desça 1500 m com o NATURALISTA DAS ILHAS no CASCO DE TARTARUGA. A tartaruga venceu de novo.') },
  { id: 'c_tesla1500', icon: 'AC', tier: 3, combo: ['tesla', 'coil', 1500], name: tr('CORRENTE ALTERNADA'), desc: tr('Desça 1500 m com o ALQUIMISTA DA ELETRICIDADE na BOBINA ELÉTRICA. A cachoeira gerou energia pra cidade.') },
  { id: 'c_ada1500', icon: 'LOOP', tier: 3, combo: ['ada', 'analytic', 1500], name: tr('LOOP INFINITO'), desc: tr('Desça 1500 m com a MATEMÁGICA DOS ALGORITMOS na MÁQUINA ANALÍTICA. while (barril) { desce(); }') },
  { id: 'c_pony2000', icon: 'HEXA!', tier: 4, combo: ['pony', 'grito', 2000], name: tr('O HEXA VEIO PELA CACHOEIRA'), desc: tr('Desça 2000 m com o CAVALINHO DA SELEÇÃO no BARRIL DO GRITO. É campeão!') },
  { id: 'c_dumont2000', icon: 'VOO', tier: 4, combo: ['dumont', 'dumont', 2000], name: tr('VOO TRANSATLÂNTICO'), desc: tr('Desça 2000 m com o SANTOS DUMMOUND no 14-BARRIL. Paris fica pra próxima.') },
  { id: 'c_king2000', icon: 'REI', tier: 4, combo: ['king', 'diamondb', 2000], name: tr('REINADO ABSOLUTO'), desc: tr('Desça 2000 m com o REI DA CACHOEIRA no BARRIL DE DIAMANTE. Todo o rio agora é dele.') },
  { id: 'c_darklord2000', icon: 'IMPÉR', tier: 4, combo: ['darklord', 'armor', 2000], name: tr('O IMPÉRIO DESCE A CACHOEIRA'), desc: tr('Desça 2000 m com o LORDE SOMBRIO no BARRIL BLINDADO. A força está com o barril.') },
  { id: 'c_dragon3000', icon: 'FOGO!', tier: 4, combo: ['dragon', 'lava', 3000], name: tr('O DRAGÃO DO VULCÃO'), desc: tr('Desça 3000 m com o DRAGÃO no BARRIL VULCÂNICO. A cachoeira evaporou.') },
  { id: 'c_jackson3000', icon: '13x', tier: 4, combo: ['jackson', 'camp', 3000], name: tr('ELE NUNCA PARA'), desc: tr('Desça 3000 m com o JACKSON no BARRIL DO ACAMPAMENTO. Nem a cachoeira segura.') },
  { id: 'c_classic3000', icon: 'RAIZ', tier: 4, combo: ['classic', 'classic', 3000], name: tr('O CLÁSSICO É CLÁSSICO'), desc: tr('Desça 3000 m com o TURISTA DE CAPA no BARRIL CLÁSSICO. Sem skin, sem desculpa, só talento.') },
  // ---- heroes and the atomic physicist ----
  { id: 'aranha', icon: 'TEIA', tier: 3, name: tr('COM GRANDES PODERES...'), desc: tr('Raspe em 20 pedras numa descida só. Vêm grandes raspadas. Libera o HOMEM-ARRANHA e o BARRIL DE TEIA.'), skin: ['r:aranha', 'b:teia'] },
  { id: 'superhomi', icon: 'AÇO', tier: 3, name: tr('HOMEM DE AÇO'), desc: tr('Desça 1000 m sem levar nenhuma batida. Uai, sô! Libera o SUPER-HOMI.'), skin: 'r:superhomi' },
  { id: 'fechahaimer', icon: 'FECHA', tier: 3, name: tr('FECHA E ABRE'), desc: tr('Saia do app no meio de uma descida, volte e chegue a 500 m. Libera o FECHAHAIMER e O DISPOSITIVO.'), skin: ['r:fechahaimer', 'b:dispositivo'] },
  { id: 'chachu', icon: 'ILARI', tier: 2, name: tr('ILARILARIÊ'), desc: tr('Pegue 40 bolhas numa descida só. Beijinho, beijinho, tchau tchau! Libera a CHACHU e a NAVE DOS BAIXINHOS.'), skin: ['r:chachu', 'b:nave'] },
  { id: 'anjelica', icon: 'TÁXI', tier: 2, name: tr('VOU DE TÁXI'), desc: tr('Desça 600 m com 60 moedas ou mais numa descida só. O taxímetro não para! Libera a ANJÉLICA e o VOU DE TÁXI.'), skin: ['r:anjelica', 'b:taxi'] },
  { id: 'cupido', icon: '<3->', tier: 3, name: tr('FLECHADA CERTEIRA'), desc: tr('Forme 5 pares diferentes (piloto no barril que combina com ele). Libera o CUPIDO e o CORAÇÃO FLECHADO.'), skin: ['r:cupido', 'b:coracao'] },
  { id: 'zeus', icon: 'RAIO', tier: 3, name: tr('FÚRIA DO OLIMPO'), desc: tr('Desça 400 m debaixo de tempestade. Libera o ZEUS e a COLUNA DO OLIMPO.'), skin: ['r:zeus', 'b:olimpo'] },
  { id: 'saci', icon: 'SACI', tier: 2, name: tr('PULO DO SACI'), desc: tr('Desça 500 m com ventania. Libera o SACI e o REDEMOINHO.'), skin: ['r:saci', 'b:redemoinho'] },
  { id: 'iara', icon: 'IARA', tier: 2, name: tr('CANTO DA IARA'), desc: tr('Desça 300 m com miragem. Libera a IARA e a VITÓRIA-RÉGIA.'), skin: ['r:iara', 'b:vitoriaregia'] },
  { id: 'curupira', icon: 'MATA', tier: 2, name: tr('PROTETOR DA MATA'), desc: tr('Desça 300 m com neblina. Libera o CURUPIRA e o BOITATÁ.'), skin: ['r:curupira', 'b:boitata'] },
  { id: 'c_aranha', icon: 'ZIP', tier: 2, combo: ['aranha', 'teia', 800], name: tr('O ARRANHA DA VIZINHANÇA'), desc: tr('Desça 800 m com o HOMEM-ARRANHA no BARRIL DE TEIA. Pendurado por um fio, como sempre.') },
  { id: 'c_molhadao', icon: 'GRRR', tier: 2, combo: ['molhadao', 'radio', 800], name: tr('MOLHADÃO ESMAGA!'), desc: tr('Desça 800 m com O INCRÍVEL MOLHADÃO no BARRIL RADIOATIVO. Agora ele tá verde por dentro também.') },
  { id: 'c_barrilha', icon: 'LAÇO', tier: 2, combo: ['barrilha', 'gold', 800], name: tr('O LAÇO DA VERDADE'), desc: tr('Desça 800 m com a MULHER-BARRILHA no BARRIL DE OURO. A pedra confessou tudo.') },
  { id: 'c_batima', icon: 'BAT', tier: 3, combo: ['batima', 'batbarril', 900, 'night'], name: tr('O CAVALEIRO DA CACHOEIRA'), desc: tr('Desça 900 m de noite com o BATIMÁ no BATI-BARRIL. A cidade dorme tranquila.') },
  { id: 'c_superhomi', icon: 'CLARK', tier: 3, combo: ['superhomi', 'phone', 1000], name: tr('TROCA DE ROUPA'), desc: tr('Desça 1000 m com o SUPER-HOMI na CABINE TELEFÔNICA. Entrou de óculos, saiu de capa.') },
  { id: 'c_fechahaimer', icon: '1945', tier: 4, combo: ['fechahaimer', 'dispositivo', 1945], name: tr('AGORA ME TORNEI O BARRIL'), desc: tr('Desça 1945 m com o FECHAHAIMER n\'O DISPOSITIVO. Destruidor de pedras.') },
  { id: 'c_chachu', icon: 'NAVE', tier: 2, combo: ['chachu', 'nave', 800], name: tr('PLANETA DOS BAIXINHOS'), desc: tr('Desça 800 m com a CHACHU na NAVE DOS BAIXINHOS. Paquitas, a postos!') },
  { id: 'c_anjelica', icon: 'BANDE', tier: 2, combo: ['anjelica', 'taxi', 900], name: tr('BANDEIRADA DOIS'), desc: tr('Desça 900 m com a ANJÉLICA no VOU DE TÁXI. A corrida mais cara da história.') },
  { id: 'c_cupido', icon: 'AMOR', tier: 2, combo: ['cupido', 'coracao', 800], name: tr('AMOR À PRIMEIRA DESCIDA'), desc: tr('Desça 800 m com o CUPIDO no CORAÇÃO FLECHADO. Até a cachoeira se apaixonou.') },
  { id: 'c_zeus', icon: 'ZEUS', tier: 3, combo: ['zeus', 'olimpo', 1200], name: tr('DESCEU DO OLIMPO'), desc: tr('Desça 1200 m com o ZEUS na COLUNA DO OLIMPO. Os mortais aplaudem.') },
  { id: 'c_poseidon', icon: 'MAR', tier: 3, combo: ['poseidon', 'concha', 1000], name: tr('O MAR VIROU CACHOEIRA'), desc: tr('Desça 1000 m com o POSEIDON na CONCHA DO MAR. O tridente apontou o caminho.') },
  { id: 'c_medusa', icon: 'PEDRA', tier: 2, combo: ['medusa', 'estatua', 800], name: tr('NÃO OLHE PRA TRÁS'), desc: tr('Desça 800 m com a MEDUSA na ESTÁTUA DE PEDRA. As pedras do rio ficaram com medo.') },
  { id: 'c_saci', icon: 'PULO', tier: 2, combo: ['saci', 'redemoinho', 900], name: tr('NUMA PERNA SÓ'), desc: tr('Desça 900 m com o SACI no REDEMOINHO. Sem tropeçar, porque só tem uma perna.') },
  { id: 'c_iara', icon: 'CANTO', tier: 2, combo: ['iara', 'vitoriaregia', 900], name: tr('A RAINHA DO RIO'), desc: tr('Desça 900 m com a IARA na VITÓRIA-RÉGIA. O rio inteiro parou pra ouvir.') },
  { id: 'c_curupira', icon: 'FOGO', tier: 3, combo: ['curupira', 'boitata', 1000], name: tr('GUARDIÕES DA FLORESTA'), desc: tr('Desça 1000 m com o CURUPIRA no BOITATÁ. Nenhum lenhador passa daqui.') },
  // ---- phone extras ----
  { id: 'steps2k', icon: 'PÉ', tier: 2, needs: 'steps', name: tr('SAIU DO SOFÁ'), desc: tr('Ande 2.000 passos entre uma descida e outra (ligue PASSOS em AJUSTES). Libera o ATLETA DE FIM DE SEMANA.'), skin: 'r:corredor' },
  { id: 'steps10k', icon: '10K', tier: 2, needs: 'steps', name: tr('DEZ MIL PASSOS'), desc: tr('Some 10.000 passos contados pelo jogo. Libera a GARRAFINHA.'), skin: 'b:squeeze' },
  { id: 'steps42k', icon: '42K', tier: 3, needs: 'steps', name: tr('MARATONISTA'), desc: tr('Some 42.195 passos contados pelo jogo. Uma maratona inteira. De passos. Libera o MARATONISTA.'), skin: 'r:maratonista' },
  { id: 'escuro', icon: 'LUX', tier: 2, needs: 'light', name: tr('NO ESCURINHO'), desc: tr('Chegue a 300 m num lugar quase sem luz (o sensor de luz do celular confere). Libera o VAGALUME.'), skin: 'b:vagalume' },
  { id: 'solzao', icon: 'SOL', tier: 2, needs: 'light', name: tr('SOL NA CARA'), desc: tr('Chegue a 300 m jogando no sol forte. Passou protetor? Libera o GUARDA-SOL.'), skin: 'b:guardasol' },
  { id: 'esconde', icon: 'ESC', tier: 1, needs: 'proximity', name: tr('ESCONDE-ESCONDE'), desc: tr('Tampe o sensor de proximidade (no topo da tela) 3 vezes numa descida. Achou! Libera o CONTA ATÉ DEZ.'), skin: 'r:escondido' },
  { id: 'fone', icon: 'DJ', tier: 2, needs: 'phones', name: tr('DJ DA CACHOEIRA'), desc: tr('Desça 500 m de fone de ouvido, com o som ligado. Libera o DJ DA CACHOEIRA.'), skin: 'r:dj' },
  { id: 'nfc1', icon: 'NFC', tier: 2, needs: 'nfc', name: tr('CRIADOR DE MONSTROS'), desc: tr('Crie uma criatura no LABORATÓRIO NFC (na LOJA) encostando um bilhete, crachá ou tag no celular.') },
  { id: 'nfc6', icon: 'ZOO', tier: 3, needs: 'nfc', name: tr('ZOOLÓGICO DE CHIPS'), desc: tr('Tenha 6 criaturas no LABORATÓRIO NFC ao mesmo tempo.') },
  // ---- OFICINA and SOBREVIDA ----
  { id: 'tune1', icon: 'TUNE', tier: 1, name: tr('MECÂNICO DE FIM DE SEMANA'), desc: tr('Compre a primeira melhoria na OFICINA. Barril tunado, piloto orgulhoso.') },
  { id: 'tunemax', icon: 'MAX', tier: 3, name: tr('TUNADO DE FÁBRICA'), desc: tr('Deixe todas as melhorias da OFICINA no máximo. Esse barril já tem até aerofólio.') },
  { id: 'code1', icon: 'CODE', tier: 1, name: tr('TENHO UM CÓDIGO'), desc: tr('Resgate um código na LOJA. Quem tem amigo tem barril.') },
  { id: 'revive1', icon: '2X', tier: 1, name: tr('SEGUNDA CHANCE'), desc: tr('Use uma SOBREVIDA depois de quebrar o barril. Ninguém viu nada.') },
  { id: 'all', icon: '***', tier: 4, name: tr('PLATINOU'), desc: tr('Libere todas as outras conquistas. Agora vai lá fora pegar um sol.'), oldReward: 300 },
];
// Every achievement pays coins by tier; some also give an exclusive skin (a.skin).
const TIER_REWARD = [0, 5, 10, 15, 15];
const achReward = (a) => TIER_REWARD[a.tier];
// Badges paid before the cut (save.paid[id] === true) keep what they paid back then, so nobody's
// balance drops after an update.
const OLD_TIER_REWARD = [0, 10, 25, 50, 100];
const paidAmount = (a) => {
  const v = save.paid[a.id];
  return v === true ? a.oldReward ?? OLD_TIER_REWARD[a.tier] : v || 0;
};
const achSkins = (a) => (a.skin ? [].concat(a.skin) : []);
const skinByKey = (key) => (key[0] === 'b' ? BARREL_SKINS : RIDER_SKINS).find((k) => k.id === key.slice(2));
// Badges that need something from the device (battery, screenshot detection) only exist where it
// works; their skins go back to the shop at the "alt" price there.
const NATIVE_ANDROID = !!(window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === 'android');
// sensors this phone reported on an earlier launch (see initExtras); unknown = assume yes
const HW_KEY = 'cataratas.hw';
let HW = null;
try {
  HW = JSON.parse(localStorage.getItem(HW_KEY) || 'null');
} catch {
  HW = null;
}
const DEVICE_CAN = {
  battery: typeof navigator.getBattery === 'function',
  print: NATIVE_ANDROID,
  motion: 'DeviceMotionEvent' in window,
  mic: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
  torch: NATIVE_ANDROID,
  shareapp: NATIVE_ANDROID, // the Android share sheet says which app was picked; the web doesn't
  notif: NATIVE_ANDROID, // reminders are local notifications of the app
  steps: NATIVE_ANDROID && (!HW || HW.steps),
  light: NATIVE_ANDROID && (!HW || HW.light),
  proximity: NATIVE_ANDROID && (!HW || HW.proximity),
  phones: NATIVE_ANDROID,
  nfc: NATIVE_ANDROID && (!HW || HW.nfc),
};
const ALL_ACHIEVEMENTS = ACHIEVEMENTS.slice(); // before the device filter (for the backoffice export)
for (let k = ACHIEVEMENTS.length - 1; k >= 0; k--) {
  const a = ACHIEVEMENTS[k];
  if (!a.needs || DEVICE_CAN[a.needs]) continue;
  ACHIEVEMENTS.splice(k, 1);
  for (const key of achSkins(a)) {
    const sk = skinByKey(key);
    if (sk && sk.alt) sk.price = sk.alt;
  }
}
// the beta testers' items sit right after the classic ones in the shop
for (const list of [BARREL_SKINS, RIDER_SKINS]) list.splice(1, 0, ...list.splice(list.findIndex((k) => k.beta), 1));
// shortest first: the same rider and barrel unlock their combos one run at a time, in order
const COMBOS = ACHIEVEMENTS.filter((a) => a.combo).sort((x, y) => x.combo[2] - y.combo[2]);
const MONSTERS = new Set(RIDER_SKINS.filter((k) => k.monster).map((k) => k.id));
const DIST_ACH = [
  [50, 'm50'], [100, 'm100'], [300, 'm300'], [500, 'm500'], [750, 'm750'],
  [1000, 'm1000'], [2000, 'm2000'], [3000, 'm3000'], [5000, 'm5000'],
];
const TIGHT_GAP = 2 * HIT_R + 12; // free space between two rock hitboxes that counts as "só passou o barril"
const ZEN_SECS = 5;
const WALL_SECS = 2;
const WALL_NEAR = 3; // px between the barrel's edge and the wall
const unseenAch = new Set(); // unlocked since the trophy room was last opened
const toastQueue = [];
let toastTimer = 0;

// ---- DIÁRIO ----
function diaryNote(key, how) {
  if (save.diary[key] || !DIARY_KEY.test(key) || Object.keys(save.diary).length >= DIARY_MAX) return;
  const inRun = how === 0 && G.run && (G.state === 'playing' || G.state === 'revive' || G.state === 'dying' || G.state === 'over' || G.state === 'paused');
  save.diary[key] = [Date.now(), inRun ? 0 : how === 0 ? 2 : how, riderSkin.id, barrelSkin.id, inRun ? Math.max(0, Math.floor(G.meters)) : -1, inRun ? G.run.weather || 'clear' : '', inRun ? G.runDiff : -1];
}
// Trophy room line: only the day, the metres and the mode ("26/11/2026 · 340 m · NORMAL").
function diaryShort(key) {
  const e = save.diary[key];
  if (!e) return tr('ANTES DO DIÁRIO');
  const [t, how, , , m, , d] = e;
  const date = new Date(t).toLocaleDateString(LOCALE);
  if (how !== 0 || m < 0) return date;
  return `${date} · ${m.toLocaleString(LOCALE)} m${DIFFS[d] ? ` · ${DIFFS[d].name}` : ''}`;
}
// "26/11/2026 · GATO LARANJA + CAIXA DE PAPELÃO · 340 m · TEMPESTADE · NORMAL"
function diaryText(key) {
  const e = save.diary[key];
  if (!e) return tr('ANTES DO DIÁRIO');
  const [t, how, r, b, m, w, d] = e;
  const date = new Date(t).toLocaleDateString(LOCALE);
  if (how === 1) return trf('{0} · COMPRADA NA LOJA', date);
  if (how === 3) return trf('{0} · RESGATADA COM CÓDIGO', date);
  if (how === 4) return trf('{0} · PRESENTE', date);
  const rs = RIDER_SKINS.find((k) => k.id === r);
  const bs = BARREL_SKINS.find((k) => k.id === b);
  const who = `${rs ? rs.name : '?'} + ${bs ? bs.name : '?'}`;
  if (how === 2 || m < 0) return trf('{0} · {1} · FORA DA DESCIDA', date, who);
  const wx = WEATHERS[w] ? ` · ${WEATHERS[w].name}` : '';
  return `${date} · ${who} · ${m.toLocaleString(LOCALE)} m${wx}${DIFFS[d] ? ` · ${DIFFS[d].name}` : ''}`;
}

function achUnlocked() {
  return ACHIEVEMENTS.filter((a) => save.ach[a.id]).length;
}

// Pays an unlocked achievement's reward once (also used at boot for badges earned before
// rewards existed).
function grant(a) {
  for (const k of achSkins(a)) save.owned[k] = true; // also for badges that got a skin after they were paid
  if (save.paid[a.id] !== undefined) return;
  save.paid[a.id] = achReward(a);
  recalcCoins();
}

// ---- coins: balance = this and other installs' ledgers + achievement rewards ----
const myLedger = () => save.ledger[save.dev] || (save.ledger[save.dev] = { e: 0, s: 0, g: 0, gs: 0 });
function recalcCoins() {
  let c = 0;
  for (const a of ACHIEVEMENTS) c += paidAmount(a);
  let g = 0;
  for (const l of Object.values(save.ledger)) {
    c += l.e - l.s;
    g += (l.g || 0) - (l.gs || 0);
  }
  save.coins = Math.max(0, c);
  save.gems = Math.max(0, g);
}
function addCoins(n) {
  myLedger().e += n;
  recalcCoins();
}
function spendCoins(n) {
  myLedger().s += n;
  recalcCoins();
}
// Saves from before the ledger only had a balance: whatever the paid achievements don't explain
// goes into this install's entry, so the balance stays exactly the same.
function fixLedger() {
  if (!Object.keys(save.ledger).length) {
    let paid = 0;
    for (const a of ACHIEVEMENTS) paid += paidAmount(a);
    const d = save.coins - paid;
    save.ledger[save.dev] = { e: Math.max(0, d), s: Math.max(0, -d) };
  }
  recalcCoins();
}

// FÁCIL only gives bronze badges without a skin, plus the ones made for it (a.easy).
const easyOk = (a) => a.easy || (a.tier === 1 && !a.skin);
const easyMissed = new Set(); // achievements earned on FÁCIL that didn't count (told once each)

// While the guided first ride is still pending, nothing unlocks: the first badge is always
// AULA DE DIREÇÃO ('tutorial'). If the player never finishes it (TUT_RUNS runs), the lock lifts.
const achLocked = () => !save.ach.tutorial && (!!G.tut || tutWanted());

function unlock(id) {
  if (DEMO || save.ach[id]) return;
  if (id !== 'tutorial' && achLocked()) return;
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  if (!a) return;
  if (G.runDiff === 0 && !easyOk(a)) {
    // FÁCIL doesn't count this one: say so (once), so it doesn't look like a bug
    if (!easyMissed.has(id)) {
      easyMissed.add(id);
      toastQueue.push({ head: tr('NO FÁCIL NÃO VALE!'), name: a.name, sub: tr('JOGUE NO NORMAL OU DIFÍCIL'), muted: true });
      if (!toastTimer) nextToast();
    }
    return;
  }
  diaryNote(`a:${id}`, 0);
  for (const k of achSkins(a)) if (!save.owned[k]) diaryNote(k, 0);
  save.ach[id] = true;
  grant(a);
  unseenAch.add(id);
  if (G.run) G.run.newAch.push(id);
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
  if (save.coins >= 2000) unlock('irrecusavel');
}

function checkOwned() {
  const has = (key) => owns(key[0], skinByKey(key));
  const bought = Object.keys(save.owned).filter((k) => save.owned[k] && skinByKey(k) && skinByKey(k).price > 0).length;
  if (bought >= 1) unlock('shop1');
  if (bought >= 5) unlock('skins5');
  if (has('r:santa') && has('r:bunny') && has('r:armadillo')) unlock('holiday');
  if (RIDER_SKINS.filter((k) => owns('r', k)).length >= 20) unlock('darwin');
  const all = (list, kind) => list.every((k) => k.beta || k.hidden || owns(kind, k));
  if (all(BARREL_SKINS, 'b') && all(RIDER_SKINS, 'r')) unlock('shopall');
}

function nextToast() {
  const a = toastQueue.shift();
  if (!a) {
    toastTimer = 0;
    show(ui.toast, false);
    return;
  }
  const extra = achSkins(a).map((k) => ` + ${skinByKey(k).name}`).join('');
  const sub = a.sub ?? trf('+{0} MOEDAS{1}{2}', a.coins ?? achReward(a), a.gems ? trf(' + {0} DIAMANTES', a.gems) : '', extra);
  ui.toast.innerHTML = `<b>${a.head || tr('CONQUISTA LIBERADA!')}</b>${a.name}${sub ? `<i>${sub}</i>` : ''}`;
  ui.toast.classList.toggle('muted', !!a.muted);
  show(ui.toast, false);
  void ui.toast.offsetWidth; // restart the CSS animation
  show(ui.toast, true);
  if (a.muted) sfx.blip([392, 330], 0.08, 0.05);
  else sfx.blip([784, 988, 1175, 1568], 0.06, 0.06);
  toastTimer = setTimeout(nextToast, 2500);
}

function refreshAchCount() {
  ui.achCount.textContent = `${achUnlocked()}/${ACHIEVEMENTS.length}`;
  ui.shopCoins.textContent = save.coins;
}

// Trophy room order: earned first (just earned at the very top), then the locked ones; each
// group runs bronze -> special, keeping the list's own order inside a tier.
function achOrder() {
  const rank = (a) => (save.ach[a.id] ? (unseenAch.has(a.id) ? 0 : 1) : 2);
  return ACHIEVEMENTS.map((a, i) => ({ a, i })).sort((x, y) => rank(x.a) - rank(y.a) || x.a.tier - y.a.tier || x.i - y.i).map((x) => x.a);
}

let achDiary = false; // the trophy room shows the DIÁRIO instead of the badges
function renderDiary() {
  ui.achTitle.textContent = tr('DIÁRIO');
  ui.achDiary.textContent = tr('CONQUISTAS');
  const items = Object.entries(save.diary).sort((x, y) => y[1][0] - x[1][0]);
  ui.achSummary.textContent = trf('{0} ANOTAÇÕES', items.length);
  ui.achList.textContent = '';
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'sum-none';
    li.textContent = tr('O DIÁRIO COMEÇA AGORA: CADA CONQUISTA E SKIN NOVA FICA ANOTADA AQUI, COM O DIA, O PILOTO, O BARRIL E OS METROS.');
    ui.achList.append(li);
    return;
  }
  for (const [key, e] of items) {
    const a = key[0] === 'a' ? ACHIEVEMENTS.find((x) => x.id === key.slice(2)) : null;
    const sk = a ? null : skinByKey(key);
    if (!a && !sk) continue;
    const li = document.createElement('li');
    li.className = `ach diary-item t${a ? a.tier : 2}`;
    const medal = document.createElement('div');
    medal.className = 'medal';
    if (a) {
      medal.textContent = a.icon;
      if (a.icon.length > 3) medal.className = 'medal long';
    } else {
      const cv = key[0] === 'b' ? sk.make() : makeRiderSkin(sk, 0);
      cv.className = 'diary-skin';
      medal.append(cv);
    }
    const txt = document.createElement('div');
    txt.className = 'txt';
    const name = document.createElement('p');
    name.className = 'name';
    name.textContent = a ? a.name : sk.name;
    const kind = document.createElement('p');
    kind.className = 'reward';
    kind.textContent = a ? tr('CONQUISTA') : key[0] === 'b' ? tr('SKIN DE BARRIL') : tr('SKIN DE PILOTO');
    const when = document.createElement('p');
    when.className = 'desc';
    when.textContent = diaryText(key);
    txt.append(name, kind, when);
    li.append(medal, txt);
    ui.achList.append(li);
  }
}

function renderAch() {
  if (achDiary) return renderDiary();
  ui.achTitle.textContent = tr('CONQUISTAS');
  ui.achDiary.textContent = tr('DIÁRIO');
  const n = achUnlocked();
  ui.achSummary.textContent = trf('{0}/{1} LIBERADAS', n, ACHIEVEMENTS.length);
  ui.achList.textContent = '';
  for (const a of achOrder()) ui.achList.append(achItem(a, !!save.ach[a.id], unseenAch.has(a.id)));
  unseenAch.clear();
}

// One badge row of the trophy room (also used by the run summary).
function achItem(a, on, fresh) {
  const li = document.createElement('li');
  li.className = `ach t${a.tier}${on ? '' : ' locked'}${fresh ? ' fresh' : ''}`;
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
  reward.textContent = trf('+{0} MOEDAS{1}{2}', save.paid[a.id] !== undefined ? paidAmount(a) : achReward(a), '', achSkins(a).map((k) => ` + ${skinByKey(k).name}`).join(''));
  txt.append(name, desc, reward);
  if (on) {
    const when = document.createElement('p');
    when.className = 'diary';
    when.textContent = diaryShort(`a:${a.id}`);
    txt.append(when);
  }
  if (!on && !easyOk(a)) {
    const easy = document.createElement('p');
    easy.className = 'noeasy';
    easy.textContent = tr('SÓ NO NORMAL OU DIFÍCIL');
    txt.append(easy);
  }
  li.append(medal, txt);
  return li;
}

// ---------- run summary: where the coins came from and what got unlocked, and why ----------
// Coins a run brought in, by source.
function runCoins(r) {
  const achs = r.newAch.map((id) => ACHIEVEMENTS.find((a) => a.id === id)).filter(Boolean);
  const achCoins = achs.reduce((t, a) => t + achReward(a), 0);
  return { achs, achCoins, total: r.coins + achCoins + r.dailyCoins };
}
let sumSkin = null; // first skin unlocked in the run, for "VER NA LOJA"
function renderSummary() {
  const r = G.run;
  const lr = G.lastRun || { m: G.meters, rec: false, diffName: '' };
  const fmt = (n) => n.toLocaleString(LOCALE);
  const { achs, achCoins, total } = runCoins(r);
  const row = (label, val, cls = '') => `<li class="${cls}"><span>${label}</span><b>${val}</b></li>`;
  const coinRows = [
    row(trf('BOLHAS ESTOURADAS: {0}{1}', r.bubbles, r.gold ? trf(' ({0} DOURADA{1})', r.gold, r.gold > 1 ? 'S' : '') : ''), `+${COIN_ICON}${fmt(r.coins)}`),
    achs.length ? row(trf('CONQUISTAS: {0}', achs.length), `+${COIN_ICON}${fmt(achCoins)}`) : '',
    r.dailyCoins ? row(trf('DESAFIOS: {0}', r.chalDone.length), `+${COIN_ICON}${fmt(r.dailyCoins)}`) : '',
    row(tr('TOTAL GANHO'), `+${COIN_ICON}${fmt(total)}`, 'total'),
    row(tr('SALDO AGORA'), `${COIN_ICON}${fmt(save.coins)}`, 'bal'),
  ].join('');
  const stats = [
    [tr('RASPADAS'), r.grazes],
    [tr('PASSADAS APERTADAS'), r.tight],
    [tr('POWER-UPS'), r.good],
    [tr('POWER-DOWNS'), r.bad],
    [tr('BATIDAS'), r.hits],
    [tr('CONSERTOS'), r.repairs],
  ]
    .map(([k, v]) => row(k, fmt(v)))
    .join('');
  ui.sumBody.innerHTML =
    `<p class="sum-m">${fmt(lr.m)} m${lr.diffName ? ` · ${lr.diffName}` : ''}${lr.rec ? tr('<br><span class="sum-rec">NOVO RECORDE!</span>') : ''}</p>` +
    trf('<h3>MOEDAS</h3><ul class="sum-rows">{0}</ul>', coinRows) +
    trf('<h3>NA DESCIDA</h3><ul class="sum-rows">{0}</ul>', stats) +
    trf('<h3>{0}</h3>', achs.length ? trf('CONQUISTAS LIBERADAS: {0}', achs.length) : tr('CONQUISTAS'));
  if (achs.length) {
    const ul = document.createElement('ul');
    ul.className = 'ach-list sum-ach';
    for (const a of achs) ul.append(achItem(a, true, false));
    ui.sumBody.append(ul);
  } else {
    const p = document.createElement('p');
    p.className = 'sum-none';
    p.textContent = tr('NENHUMA NOVA DESTA VEZ. DÁ UMA OLHADA NOS TROFÉUS PRA VER O QUE FALTA.');
    ui.sumBody.append(p);
  }
  const keys = achs.flatMap((a) => achSkins(a));
  sumSkin = keys.length ? keys[0] : null;
  ui.sumShop.textContent = keys.length > 1 ? trf('VER {0} SKINS', keys.length) : tr('VER SKIN');
  show(ui.sumShop, !!sumSkin);
}
function openSummary() {
  renderSummary();
  show(ui.over, false);
  show(ui.sum, true);
  ui.sumBody.scrollTop = 0;
}
function closeSummary() {
  show(ui.sum, false);
  show(ui.over, true);
  G.lockUntil = performance.now() + 300; // the "VOLTAR" tap must not also start a run
}

let achFrom = null; // screen to go back to
function openAch(from) {
  achFrom = from;
  achDiary = false;
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
  return {
    grazes: 0, grazeT: [], tight: 0, zenT: 0, wallT: 0, threadT: 0, hits: 0, coins: 0, bubbles: 0, bad: 0, newAch: [],
    // for the daily challenge
    gold: 0, good: 0, mystery: 0, repairs: 0, saves: 0, zenMax: 0, threadMax: 0, daily: false, dailyDone: false,
    dailyCoins: 0, // challenge coins, for the run summary
    chal: [], chalDone: [], // challenges this run counts for / finished
    paused: false, pauses: 0, dizzy: false, dizzyN: 0, bolts: 0, prevM: save.lastM, goodIds: [], earlyHit: false, stormHits: -1, stormUfa: 0, slowGraze: 0, fired: false, grazeAfterHit: 0,
    tuned: false, revived: false, reviveFrom: 0, shieldAt: [], // OFICINA and SOBREVIDA
    leftApp: false, // went out of the app mid-run (FECHA E ABRE)
    combo: '', comboHint: false,
    luxN: 0, dark: true, sun: true, near: 0, phones: false, // light / proximity / headphones // the combo badge this run already gave, and the "next run" hint
  };
}

// Called when a rock scrolls past the barrel: was the barrel squeezed between this rock and a
// neighbour on the other side of the same row?
function checkTight(r) {
  let L = null;
  let R = null;
  for (const o of G.rocks) {
    if (o.fake || Math.abs(o.wy - r.wy) > 12) continue;
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
  checkDaily();
}

function achOnGraze() {
  sayMaybe(SAYS_GRAZE, 0.2);
  G.run.grazes++;
  save.grazes++;
  if (G.run.hits > 0) G.run.grazeAfterHit++;
  unlock('graze1');
  if (G.run.grazes >= 10) unlock('graze10');
  if (G.run.grazes >= 20) unlock('aranha');
  if (G.run.grazes >= 10 && G.run.hits === 0) unlock('respingos');
  if (save.grazes >= 100) unlock('graze100');
  const ts = G.run.grazeT;
  ts.push(G.playT);
  if (ts.length > 3) ts.shift();
  if (ts.length === 3 && ts[2] - ts[0] <= 2) unlock('pingpong');
  checkDaily();
}

function achOnPickup(pw, mystery) {
  if (mystery) G.run.mystery++;
  if (pw.good) G.run.good++;
  checkDaily();
  if (pw.id === 'invert') {
    G.run.dizzy = true;
    if (++G.run.dizzyN >= 2) unlock('nazare');
  }
  if (pw.good && !G.run.goodIds.includes(pw.id)) G.run.goodIds.push(pw.id);
  if (G.run.goodIds.length >= 3) unlock('davinci');
  if (pw.good) {
    save.powers[pw.id] = true;
    if (POWERS.every((x) => !x.good || save.powers[x.id])) unlock('powers');
  } else {
    if (++G.run.bad >= 3) unlock('cursed');
    if (G.run.bad >= 5 && G.runDiff === 2) unlock('hardcursed');
  }
}

function achOnBubble(b) {
  unlock('coin1');
  if (b.gold) G.run.gold++;
  checkDaily();
  if (b.gold) unlock('goldbub');
  if (G.run.gold >= 5) unlock('milton');
  if (G.run.gold >= 3) unlock('pomo');
  if (G.run.gold >= 7) unlock('esferas');
  if (G.run.coins >= 20) unlock('coin20');
  if (G.run.coins >= 50) unlock('coin50');
  if (G.run.coins >= 100) unlock('coin100');
  if (save.coinsTotal >= 500) unlock('coins500');
  if (save.bubbles >= 300) unlock('bubbles300');
  checkWallet();
}

function achOnMeters(m) {
  checkDaily();
  if (G.run.shieldAt.length && m >= G.run.shieldAt[0]) {
    G.run.shieldAt.shift();
    if (!G.fx.shield) {
      G.fx.shield = 1;
      popText(tr('ESCUDO DA OFICINA!'));
    }
  }
  for (const [d, id] of DIST_ACH) if (m >= d) unlock(id);
  if (m >= 300 && !save.sound) unlock('mute');
  if (G.runDiff === 2) {
    if (m >= 100) unlock('hard100');
    if (m >= 800 && G.run.grazes >= 10) unlock('hard'); // NERVOS DE AÇO: a stunt without a double
    if (m >= 1000) unlock('hard1000');
  }
  if (m >= 100 && G.runDiff === 0) unlock('easy100');
  if (m >= 1000 && G.runDiff === 0) unlock('easy1000');
  if (m >= 500 && G.run.hits === 0) unlock('nohit500');
  if (m >= 500 && G.run.coins === 0) unlock('nocoin');
  if (m >= 500 && G.run.grazes === 0) unlock('angel');
  const r = riderSkin.id;
  if (m >= 100 && r === 'yeti' && barrelSkin.id === 'fridge') unlock('cold');
  if (m >= 300 && MONSTERS.has(r)) unlock('horror');
  if (m >= 200 && r === 'nessie') unlock('nessie');
  if (m >= 500 && r === 'unicorn') unlock('rainbow');
  if (m >= 500 && r === 'cat') unlock('annie');
  if (m >= 300 && r === 'cowboy') unlock('xerife');
  if (G.run.mystery >= 2) unlock('sherlock');
  if (G.run.good >= 5) unlock('quimico');
  if (G.run.coins >= 100) unlock('assalto');
  if (m >= 456 && G.hp === 1 && G.maxHp > 1) unlock('batatinha');
  if (m >= 300 && G.run.pauses >= 3) unlock('toctoc');
  if (m - G.wxFromM >= 500 && G.run.weather === 'rain') unlock('arquiteto');
  if (m - G.wxFromM >= 300 && G.run.weather === 'snow') unlock('inverno');
  if (m >= 1000 && r === 'scientist') unlock('eureka');
  if (m >= 300 && barrelSkin.id === 'phone') unlock('collect');
  if (m >= 888 && barrelSkin.id === 'classic') unlock('casa8');
  if (m >= 100 && G.run.upside) unlock('demogorg');
  if (m - G.wxFromM >= 300 && isWet()) unlock('rain300');
  if (m - G.wxFromM >= 300 && G.run.weather === 'wind') unlock('wind300');
  if (m >= 500 && G.run.period === 'night' && riderSkin.id === 'zombie') unlock('dark500');
  if (m >= 666 && G.run.bad >= 3) unlock('m666'); // the devil likes the bad stuff
  if (m >= 500 && G.run.earlyHit) unlock('vangogh');
  if (m >= 300 && G.run.dizzy) unlock('picasso');
  if (m >= 300 && G.run.period === 'night' && save.sound && save.music) unlock('mozart');
  if (m >= 500 && G.run.bad === 0) unlock('cleanrec');
  if (m >= 1000 && G.run.hits >= 2) unlock('firefight');
  if (m >= 1000 && !G.run.paused) unlock('nopause');
  if (m >= 1300 && r === 'jackson') unlock('jackson');
  if (m >= 300 && G.run.coins === 0 && G.run.good === 0 && G.run.bad === 0 && G.run.repairs === 0) unlock('incognito');
  if (m >= 500 && G.run.prevM >= 0 && G.run.prevM < 50) unlock('professor');
  if (m >= 500 && G.run.period === 'night' && G.runDiff === 2) unlock('darklord');
  if (m >= 400 && G.run.hits > 0 && G.run.grazeAfterHit >= 5) unlock('astucia');
  if (m >= 1000 && G.run.hits === 0) unlock('superhomi');
  if (m >= 500 && G.run.leftApp) unlock('fechahaimer');
  if (G.run.bubbles >= 40) unlock('chachu');
  if (m >= 600 && G.run.coins >= 60) unlock('anjelica');
  if (Object.keys(save.pairs).length >= 5) unlock('cupido'); // players who had 5 pairs before this trophy existed
  if (m - G.wxFromM >= 400 && G.run.weather === 'storm') unlock('zeus');
  if (m - G.wxFromM >= 500 && G.run.weather === 'wind') unlock('saci');
  if (m - G.wxFromM >= 300 && G.run.weather === 'mirage') unlock('iara');
  if (m - G.wxFromM >= 300 && G.run.weather === 'fog') unlock('curupira');
  if (m >= 300 && G.run.luxN > 0 && G.run.dark) unlock('escuro');
  if (m >= 300 && G.run.luxN > 0 && G.run.sun) unlock('solzao');
  if (m >= 500 && G.run.phones && save.sound) unlock('fone');
  if (m >= 700 && G.run.coins === 0 && G.run.good === 0 && G.run.bad === 0) unlock('mounja');
  if (m >= 300 && G.run.hits >= 3) unlock('impacto');
  if (m >= 300 && riderSkin.id === 'scientist') unlock('portal');
  if (G.run.tight >= 8) unlock('naopassar');
  if (G.run.coins >= 40 && barrelSkin.id === 'trash') unlock('walle');
  if (m - G.wxFromM >= 600 && G.run.weather === 'mirage') unlock('duna');
  if (m >= 500 && G.run.fired) unlock('emchamas');
  if (m >= 300 && riderSkin.pair && riderSkin.pair === barrelSkin.id) {
    unlock('pair1');
    if (G.runDiff !== 0 && !save.pairs[r]) {
      if (PAIR_FIRST[barrelSkin.id] !== r) {
        toastQueue.push({ head: tr('PAR SECRETO DESCOBERTO!'), name: `${riderSkin.name} + ${barrelSkin.name}`, sub: '' });
        if (!toastTimer) nextToast();
      }
      save.pairs[r] = true;
      if (Object.keys(save.pairs).length >= 5) unlock('cupido');
      if (Object.keys(save.pairs).length >= 10) unlock('pair10');
    }
  }
  // At most one combo per run (they all share this run's rider and barrel, so a long run would
  // otherwise take the 600 m and the 900 m one at once). Another one ready waits for the next run.
  if (G.run.comboHint) return;
  for (const a of COMBOS) {
    const [rider, barrel, dist, when] = a.combo;
    if (r !== rider || barrelSkin.id !== barrel || save.ach[a.id] || a.id === G.run.combo) continue;
    if (!(when === 'night' ? G.run.period === 'night' && m >= dist : when === 'storm' ? G.run.weather === 'storm' && m - G.wxFromM >= dist : m >= dist)) continue;
    if (G.run.combo) {
      G.run.comboHint = true;
      toastQueue.push({ head: tr('MAIS UM COMBO!'), name: a.name, sub: tr('FICA PRA PRÓXIMA DESCIDA'), muted: true });
      if (!toastTimer) nextToast();
      return;
    }
    unlock(a.id);
    if (save.ach[a.id]) G.run.combo = a.id;
    return;
  }
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
  G.run.threadT = G.maxHp > 1 && G.hp === 1 ? G.run.threadT + dt : 0;
  if (G.run.threadT >= 30) unlock('thread30');
  if (G.run.threadT >= 60) unlock('duro');
  if (G.run.hits > 0 && G.run.zenT >= 6) unlock('agent006');
  if (G.run.zenT > G.run.zenMax || G.run.threadT > G.run.threadMax) {
    G.run.zenMax = Math.max(G.run.zenMax, G.run.zenT);
    G.run.threadMax = Math.max(G.run.threadMax, G.run.threadT);
    checkDaily();
  }
}

const isPrime = (n) => {
  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
  return n > 1;
};

const insomnia = { n: 0, t: 0 }; // INSÔNIA: runs in a row between 1 and 5 am
function achOnDeath(m) {
  unlock('die1');
  const hr = now().getHours();
  if (hr >= 1 && hr < 5) {
    if (Date.now() - insomnia.t > 3 * 3600e3) insomnia.n = 0;
    insomnia.n++;
    insomnia.t = Date.now();
    if (insomnia.n >= 3) unlock('insonia');
  } else insomnia.n = 0;
  if (m < 30) unlock('early');
  if (save.best >= 50 && m < save.best && save.best - m <= 10) unlock('trave');
  if (save.best >= 50 && m === save.best) unlock('empate');
  if (m > 0 && m === save.lastM) unlock('dejavu');
  if (m > 100 && isPrime(m)) unlock('ada');
  if (m >= 108 && m <= 115) unlock('numeros');
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


// ---------- challenges: 1 main + 2 minis every day, plus 3 more on Saturday and on Sunday ----------
// Each kind draws from its own pool like a shuffled deck (seeded by the date), so a challenge only
// comes back after the whole pool went by. The main one is always on NORMAL or DIFÍCIL (d) and may
// ask for a skin; minis and weekend ones count on NORMAL or DIFÍCIL with any skin.
// stat: what is counted (see dailyVal); sum: adds up over every run of the day instead of one run.
const DAILY_REWARD = [0, 30, 50];
const MINI_REWARD = 10;
const WEEKEND_REWARD = 20;
const EXTRA_REWARD = 20; // DESAFIO EXTRA (config/desafios "extra"): default coins when it doesn't say
const EXTRA_MAX = 3;
const DAILY = [
  { d: 1, stat: 'm', goal: 800, text: tr('DESÇA 800 m NUMA DESCIDA') },
  { d: 1, stat: 'coins', goal: 15, text: tr('PEGUE 15 MOEDAS NUMA DESCIDA') },
  { d: 1, stat: 'grazes', goal: 5, text: tr('RASPE EM 5 PEDRAS NUMA DESCIDA') },
  { d: 1, stat: 'm', goal: 700, rider: 'cat', text: tr('CHEGUE A 700 m COM O GATO LARANJA') },
  { d: 2, stat: 'm', goal: 700, text: tr('DESÇA 700 m NA MORTE SÚBITA') },
  { d: 1, stat: 'repairs', goal: 2, text: tr('CONSERTE O BARRIL 2 VEZES NUMA DESCIDA') },
  { d: 1, stat: 'm', goal: 2500, sum: true, text: tr('SOME 2500 m HOJE, EM QUANTAS DESCIDAS QUISER') },
  { d: 1, stat: 'good', goal: 3, text: tr('PEGUE 3 POWER-UPS BONS NUMA DESCIDA') },
  { d: 1, stat: 'm', goal: 700, barrel: 'melon', text: tr('CHEGUE A 700 m NA MELANCIA') },
  { d: 2, stat: 'coins', goal: 10, text: tr('PEGUE 10 MOEDAS NA MORTE SÚBITA') },
  { d: 1, stat: 'tight', goal: 2, text: tr('PASSE 2 VEZES ENTRE PEDRAS COLADINHAS NUMA DESCIDA') },
  { d: 1, stat: 'nohit', goal: 700, text: tr('CHEGUE A 700 m SEM O BARRIL LEVAR BATIDA') },
  { d: 1, stat: 'gold', goal: 2, sum: true, text: tr('PEGUE 2 BOLHAS DOURADAS HOJE') },
  { d: 1, stat: 'm', goal: 750, rider: 'pirate', text: tr('CHEGUE A 750 m COM O PIRATA. ARRR!') },
  { d: 2, stat: 'm', goal: 1000, text: tr('DESÇA 1000 m NA MORTE SÚBITA') },
  { d: 1, stat: 'coins', goal: 25, text: tr('PEGUE 25 MOEDAS NUMA DESCIDA') },
  { d: 1, stat: 'zenMax', goal: 5, unit: 's', text: tr('FIQUE 5 s SEM INCLINAR O CELULAR') },
  { d: 1, stat: 'coins', goal: 60, sum: true, text: tr('JUNTE 60 MOEDAS HOJE') },
  { d: 1, stat: 'm', goal: 800, barrel: 'box', text: tr('CHEGUE A 800 m NA CAIXA DE PAPELÃO') },
  { d: 2, stat: 'grazes', goal: 5, text: tr('RASPE EM 5 PEDRAS NA MORTE SÚBITA') },
  { d: 1, stat: 'nocoin', goal: 700, text: tr('CHEGUE A 700 m SEM PEGAR NENHUMA MOEDA') },
  { d: 1, stat: 'mystery', goal: 2, text: tr('PEGUE 2 CÁPSULAS "?" NUMA DESCIDA') },
  { d: 1, stat: 'm', goal: 700, rider: 'caramelo', text: tr('CHEGUE A 700 m COM O CARAMELO') },
  { d: 2, stat: 'good', goal: 2, text: tr('PEGUE 2 POWER-UPS BONS NA MORTE SÚBITA') },
  { d: 2, stat: 'm', goal: 1500, sum: true, text: tr('SOME 1500 m HOJE, EM QUANTAS DESCIDAS QUISER') },
  { d: 1, stat: 'm', goal: 1000, text: tr('DESÇA 1000 m NUMA DESCIDA') },
  { d: 1, stat: 'm', goal: 800, barrel: 'cooler', text: tr('CHEGUE A 800 m NA CAIXA DE ISOPOR') },
  { d: 2, stat: 'saves', goal: 1, text: tr('DEIXE O ESCUDO SEGURAR UMA BATIDA') },
  { d: 1, stat: 'threadMax', goal: 20, unit: 's', text: tr('FIQUE 20 s SEGUIDOS COM O BARRIL POR UM FIO') },
  { d: 2, stat: 'm', goal: 700, rider: 'zombie', text: tr('CHEGUE A 700 m COM O ZUMBI') },
  { d: 1, stat: 'm', goal: 1200, text: tr('DESÇA 1200 m NUMA DESCIDA') },
  { d: 2, stat: 'm', goal: 500, text: tr('DESÇA 500 m NA MORTE SÚBITA') },
  { d: 1, stat: 'coins', goal: 35, text: tr('PEGUE 35 MOEDAS NUMA DESCIDA') },
  { d: 2, stat: 'coins', goal: 15, text: tr('PEGUE 15 MOEDAS NA MORTE SÚBITA') },
  { d: 1, stat: 'grazes', goal: 8, text: tr('RASPE EM 8 PEDRAS NUMA DESCIDA') },
  { d: 1, stat: 'tight', goal: 3, text: tr('PASSE 3 VEZES ENTRE PEDRAS COLADINHAS NUMA DESCIDA') },
  { d: 1, stat: 'nohit', goal: 900, text: tr('CHEGUE A 900 m SEM O BARRIL LEVAR BATIDA') },
  { d: 1, stat: 'nograze', goal: 500, text: tr('CHEGUE A 500 m SEM RASPAR EM NENHUMA PEDRA') },
  { d: 1, stat: 'nobad', goal: 800, text: tr('CHEGUE A 800 m SEM PEGAR POWER-DOWN') },
  { d: 1, stat: 'good', goal: 4, text: tr('PEGUE 4 POWER-UPS BONS NUMA DESCIDA') },
  { d: 1, stat: 'repairs', goal: 3, text: tr('CONSERTE O BARRIL 3 VEZES NUMA DESCIDA') },
  { d: 1, stat: 'gold', goal: 3, sum: true, text: tr('PEGUE 3 BOLHAS DOURADAS HOJE') },
  { d: 1, stat: 'm', goal: 4000, sum: true, text: tr('SOME 4000 m HOJE, EM QUANTAS DESCIDAS QUISER') },
  { d: 1, stat: 'bubbles', goal: 30, text: tr('ESTOURE 30 BOLHAS NUMA DESCIDA') },
  { d: 1, stat: 'zenMax', goal: 8, unit: 's', text: tr('FIQUE 8 s SEM INCLINAR O CELULAR') },
  { d: 1, stat: 'mystery', goal: 3, text: tr('PEGUE 3 CÁPSULAS "?" NUMA DESCIDA') },
  { d: 1, stat: 'm', goal: 800, rider: 'viking', text: tr('CHEGUE A 800 m COM O VIKING') },
  { d: 1, stat: 'm', goal: 800, barrel: 'duck', text: tr('CHEGUE A 800 m NO PATINHO DE BORRACHA') },
  { d: 1, stat: 'm', goal: 800, rider: 'dino', text: tr('CHEGUE A 800 m COM O DINOSSAURO') },
  { d: 2, stat: 'm', goal: 600, rider: 'samurai', text: tr('CHEGUE A 600 m COM O SAMURAI NA MORTE SÚBITA') },
  { d: 1, stat: 'm', goal: 800, barrel: 'trash', text: tr('CHEGUE A 800 m NA LATA DE LIXO') },
  { d: 1, stat: 'm', goal: 700, rider: 'astro', text: tr('CHEGUE A 700 m COM O ASTRONAUTA') },
  { d: 1, stat: 'coins', goal: 120, sum: true, text: tr('JUNTE 120 MOEDAS HOJE') },
  { d: 1, stat: 'grazes', goal: 20, sum: true, text: tr('RASPE EM 20 PEDRAS HOJE') },
  { d: 2, stat: 'tight', goal: 2, text: tr('PASSE 2 VEZES ENTRE PEDRAS COLADINHAS NA MORTE SÚBITA') },
  // season 1 (from 2026-12-01): longer runs with a skin
  { s: 1, d: 1, stat: 'm', goal: 900, rider: 'cowboy', text: tr('CHEGUE A 900 m COM O CAUBÓI') },
  { s: 1, d: 1, stat: 'm', goal: 900, barrel: 'cart', text: tr('CHEGUE A 900 m NO CARRINHO DE MERCADO') },
  { s: 1, d: 1, stat: 'm', goal: 1000, rider: 'robot', text: tr('CHEGUE A 1000 m COM O ROBÔ') },
  { s: 1, d: 1, stat: 'm', goal: 1000, barrel: 'washer', text: tr('CHEGUE A 1000 m NA MÁQUINA DE LAVAR') },
  { s: 1, d: 1, stat: 'm', goal: 900, rider: 'gondolier', text: tr('CHEGUE A 900 m COM O GONDOLEIRO') },
  { s: 1, d: 1, stat: 'm', goal: 900, barrel: 'orelhao', text: tr('CHEGUE A 900 m NO ORELHÃO') },
  { s: 1, d: 1, stat: 'm', goal: 1000, rider: 'yeti', text: tr('CHEGUE A 1000 m COM O ABOMINÁVEL') },
  { s: 1, d: 1, stat: 'm', goal: 1000, barrel: 'jug', text: tr('CHEGUE A 1000 m NO GALÃO DE ÁGUA') },
  { s: 1, d: 1, stat: 'm', goal: 1100, rider: 'mariachi', text: tr('CHEGUE A 1100 m COM O MARIACHI') },
  { s: 1, d: 1, stat: 'm', goal: 1200, barrel: 'fridge', text: tr('CHEGUE A 1200 m NA GELADEIRA') },
  { s: 1, d: 1, stat: 'm', goal: 1200, barrel: 'rocket', text: tr('CHEGUE A 1200 m NO FOGUETE') },
  { s: 1, d: 1, stat: 'm', goal: 1000, barrel: 'mengao', text: tr('CHEGUE A 1000 m NO BARRIL MENGÃO') },
  { s: 1, d: 1, stat: 'm', goal: 1000, barrel: 'timao', text: tr('CHEGUE A 1000 m NO BARRIL TIMÃO') },
  { s: 1, d: 1, stat: 'm', goal: 1000, barrel: 'verdao', text: tr('CHEGUE A 1000 m NO BARRIL VERDÃO') },
  { s: 1, d: 2, stat: 'm', goal: 900, rider: 'chef', text: tr('CHEGUE A 900 m COM O CHEF NA MORTE SÚBITA') },
  // season 2 (from 2026-12-15): a rider in their matching barrel, and times of day (hours: [from, to))
  { s: 2, d: 1, stat: 'm', goal: 800, rider: 'cat', barrel: 'box', text: tr('CHEGUE A 800 m COM O GATO LARANJA NA CAIXA DE PAPELÃO') },
  { s: 2, d: 1, stat: 'm', goal: 800, hours: [19, 6], text: tr('DE NOITE (19h ÀS 6h), DESÇA 800 m NUMA DESCIDA') },
  { s: 2, d: 1, stat: 'm', goal: 900, rider: 'pirate', barrel: 'rum', text: tr('CHEGUE A 900 m COM O PIRATA NO BARRIL DE RUM') },
  { s: 2, d: 1, stat: 'coins', goal: 25, hours: [6, 12], text: tr('DE MANHÃ (6h AO MEIO-DIA), PEGUE 25 MOEDAS NUMA DESCIDA') },
  { s: 2, d: 1, stat: 'm', goal: 1000, rider: 'astro', barrel: 'rocket', text: tr('CHEGUE A 1000 m COM O ASTRONAUTA NO FOGUETE') },
  { s: 2, d: 1, stat: 'nohit', goal: 700, hours: [12, 18], text: tr('À TARDE (12h ÀS 18h), CHEGUE A 700 m SEM LEVAR BATIDA') },
  { s: 2, d: 1, stat: 'm', goal: 800, rider: 'caramelo', barrel: 'trash', text: tr('CHEGUE A 800 m COM O CARAMELO NA LATA DE LIXO') },
  { s: 2, d: 1, stat: 'm', goal: 800, rider: 'skeleton', barrel: 'coffin', hours: [19, 6], text: tr('DE NOITE, CHEGUE A 800 m COM O ESQUELETO NO CAIXÃO') },
  { s: 2, d: 1, stat: 'coins', goal: 30, rider: 'castaway', barrel: 'cooler', text: tr('PEGUE 30 MOEDAS COM O NÁUFRAGO NA CAIXA DE ISOPOR') },
  { s: 2, d: 1, stat: 'm', goal: 800, rider: 'mummy', barrel: 'temple', hours: [6, 18], text: tr('DE DIA (6h ÀS 18h), CHEGUE A 800 m COM A MÚMIA NO TEMPLO PERDIDO') },
  { s: 2, d: 1, stat: 'm', goal: 900, rider: 'penguin', barrel: 'iceberg', text: tr('CHEGUE A 900 m COM O PINGUIM NO ICEBERG') },
  { s: 2, d: 1, stat: 'grazes', goal: 6, hours: [12, 18], text: tr('À TARDE (12h ÀS 18h), RASPE EM 6 PEDRAS NUMA DESCIDA') },
  { s: 2, d: 1, stat: 'm', goal: 900, rider: 'cowboy', barrel: 'usa', text: tr('CHEGUE A 900 m COM O CAUBÓI NO BARRIL AMERICANO') },
  { s: 2, d: 2, stat: 'm', goal: 700, rider: 'samurai', barrel: 'japan', text: tr('CHEGUE A 700 m COM O SAMURAI NO BARRIL JAPONÊS NA MORTE SÚBITA') },
  { s: 2, d: 1, stat: 'm', goal: 1000, rider: 'zombie', hours: [19, 6], text: tr('DE NOITE, CHEGUE A 1000 m COM O ZUMBI') },
  { s: 2, d: 1, stat: 'm', goal: 900, rider: 'courier', barrel: 'bag', text: tr('CHEGUE A 900 m COM O ENTREGADOR NA BAG DE ENTREGA') },
  { s: 2, d: 2, stat: 'm', goal: 600, hours: [6, 12], text: tr('DE MANHÃ (6h AO MEIO-DIA), DESÇA 600 m NA MORTE SÚBITA') },
  { s: 2, d: 1, stat: 'm', goal: 900, rider: 'gates', barrel: 'bluescreen', text: tr('CHEGUE A 900 m COM O BILL PORTÕES NA TELA AZUL') },
];
const MINI = [
  { stat: 'm', goal: 300, text: tr('DESÇA 300 m') },
  { stat: 'm', goal: 500, text: tr('DESÇA 500 m') },
  { stat: 'coins', goal: 8, text: tr('PEGUE 8 MOEDAS NUMA DESCIDA') },
  { stat: 'coins', goal: 12, text: tr('PEGUE 12 MOEDAS NUMA DESCIDA') },
  { stat: 'grazes', goal: 3, text: tr('RASPE EM 3 PEDRAS NUMA DESCIDA') },
  { stat: 'tight', goal: 1, text: tr('PASSE ENTRE DUAS PEDRAS COLADINHAS') },
  { stat: 'good', goal: 1, text: tr('PEGUE UM POWER-UP BOM') },
  { stat: 'gold', goal: 1, text: tr('PEGUE UMA BOLHA DOURADA') },
  { stat: 'repairs', goal: 1, text: tr('CONSERTE O BARRIL COM A CHAVE INGLESA') },
  { stat: 'mystery', goal: 1, text: tr('PEGUE UMA CÁPSULA "?"') },
  { stat: 'zenMax', goal: 3, unit: 's', text: tr('FIQUE 3 s SEM INCLINAR O CELULAR') },
  { stat: 'bubbles', goal: 12, text: tr('ESTOURE 12 BOLHAS NUMA DESCIDA') },
  { stat: 'nohit', goal: 300, text: tr('CHEGUE A 300 m SEM LEVAR BATIDA') },
  { stat: 'nocoin', goal: 300, text: tr('CHEGUE A 300 m SEM PEGAR MOEDA') },
  { stat: 'nograze', goal: 200, text: tr('CHEGUE A 200 m SEM RASPAR EM PEDRA') },
  { stat: 'nobad', goal: 400, text: tr('CHEGUE A 400 m SEM PEGAR POWER-DOWN') },
  { stat: 'm', goal: 1000, sum: true, text: tr('SOME 1000 m HOJE') },
  { stat: 'coins', goal: 30, sum: true, text: tr('JUNTE 30 MOEDAS HOJE') },
  { stat: 'bubbles', goal: 30, sum: true, text: tr('ESTOURE 30 BOLHAS HOJE') },
  { stat: 'runs', goal: 3, sum: true, text: tr('JOGUE 3 DESCIDAS HOJE') },
  { stat: 'grazes', goal: 10, sum: true, text: tr('RASPE EM 10 PEDRAS HOJE') },
  { stat: 'bad', goal: 2, text: tr('PEGUE 2 POWER-DOWNS NUMA DESCIDA. CORAGEM!') },
  { stat: 'threadMax', goal: 8, unit: 's', text: tr('FIQUE 8 s COM O BARRIL POR UM FIO') },
  { stat: 'saves', goal: 1, text: tr('DEIXE O ESCUDO SEGURAR UMA BATIDA') },
  // season 2
  { s: 2, stat: 'm', goal: 400, rider: 'cat', barrel: 'box', text: tr('DESÇA 400 m COM O GATO NA CAIXA') },
  { s: 2, stat: 'm', goal: 300, hours: [6, 12], text: tr('DE MANHÃ (6h AO MEIO-DIA), DESÇA 300 m') },
  { s: 2, stat: 'm', goal: 400, rider: 'hitch', barrel: 'guide', text: tr('DESÇA 400 m COM O MOCHILEIRO NO GUIA DE BOLSO') },
  { s: 2, stat: 'coins', goal: 10, hours: [12, 18], text: tr('À TARDE (12h ÀS 18h), PEGUE 10 MOEDAS NUMA DESCIDA') },
  { s: 2, stat: 'm', goal: 400, hours: [19, 6], text: tr('DE NOITE (19h ÀS 6h), DESÇA 400 m') },
  { s: 2, stat: 'runs', goal: 1, hours: [12, 14], text: tr('JOGUE UMA DESCIDA NA HORA DO ALMOÇO (12h ÀS 14h)') },
  { s: 2, stat: 'm', goal: 300, rider: 'gondolier', barrel: 'italy', text: tr('DESÇA 300 m COM O GONDOLEIRO NO BARRIL ITALIANO') },
  { s: 2, stat: 'm', goal: 300, rider: 'mariachi', barrel: 'mexico', text: tr('DESÇA 300 m COM O MARIACHI NO BARRIL MEXICANO') },
];
const WEEKEND = [
  { stat: 'm', goal: 1500, text: tr('DESÇA 1500 m NUMA DESCIDA') },
  { stat: 'm', goal: 5000, sum: true, text: tr('SOME 5000 m NO DIA') },
  { stat: 'runs', goal: 6, sum: true, text: tr('JOGUE 6 DESCIDAS NO DIA') },
  { stat: 'coins', goal: 150, sum: true, text: tr('JUNTE 150 MOEDAS NO DIA') },
  { stat: 'gold', goal: 5, sum: true, text: tr('PEGUE 5 BOLHAS DOURADAS NO DIA') },
  { stat: 'grazes', goal: 25, sum: true, text: tr('RASPE EM 25 PEDRAS NO DIA') },
  { stat: 'tight', goal: 5, sum: true, text: tr('PASSE 5 VEZES ENTRE PEDRAS COLADINHAS NO DIA') },
  { stat: 'repairs', goal: 5, sum: true, text: tr('CONSERTE O BARRIL 5 VEZES NO DIA') },
  { stat: 'good', goal: 8, sum: true, text: tr('PEGUE 8 POWER-UPS BONS NO DIA') },
  { stat: 'mystery', goal: 5, sum: true, text: tr('PEGUE 5 CÁPSULAS "?" NO DIA') },
  { stat: 'bubbles', goal: 80, sum: true, text: tr('ESTOURE 80 BOLHAS NO DIA') },
  { stat: 'coins', goal: 40, text: tr('PEGUE 40 MOEDAS NUMA DESCIDA') },
  { stat: 'nohit', goal: 1000, text: tr('CHEGUE A 1000 m SEM LEVAR BATIDA') },
  { stat: 'nograze', goal: 700, text: tr('CHEGUE A 700 m SEM RASPAR EM PEDRA') },
  { stat: 'nobad', goal: 1000, text: tr('CHEGUE A 1000 m SEM PEGAR POWER-DOWN') },
  { stat: 'zenMax', goal: 10, unit: 's', text: tr('FIQUE 10 s SEM INCLINAR O CELULAR') },
  { stat: 'threadMax', goal: 30, unit: 's', text: tr('FIQUE 30 s SEGUIDOS COM O BARRIL POR UM FIO') },
  { stat: 'saves', goal: 2, sum: true, text: tr('DEIXE O ESCUDO SEGURAR 2 BATIDAS NO DIA') },
  // season 2
  { s: 2, stat: 'm', goal: 1200, rider: 'yeti', barrel: 'fridge', text: tr('CHEGUE A 1200 m COM O ABOMINÁVEL NA GELADEIRA') },
  { s: 2, stat: 'm', goal: 2000, sum: true, hours: [6, 12], text: tr('SOME 2000 m DE MANHÃ (6h AO MEIO-DIA)') },
  { s: 2, stat: 'coins', goal: 60, sum: true, hours: [19, 6], text: tr('JUNTE 60 MOEDAS DE NOITE (19h ÀS 6h)') },
  { s: 2, stat: 'm', goal: 1000, rider: 'relic', barrel: 'temple', text: tr('CHEGUE A 1000 m COM O CAÇADOR DE RELÍQUIAS NO TEMPLO PERDIDO') },
  { s: 2, stat: 'm', goal: 3000, sum: true, hours: [12, 18], text: tr('SOME 3000 m À TARDE (12h ÀS 18h)') },
  { s: 2, stat: 'm', goal: 1000, rider: 'medusa', barrel: 'estatua', text: tr('CHEGUE A 1000 m COM A MEDUSA NA ESTÁTUA DE PEDRA') },
];
const DAILY_UNIT = {
  m: 'm', nohit: 'm', nocoin: 'm', nograze: 'm', nobad: 'm', coins: tr('MOEDAS'), grazes: tr('RASPADAS'), repairs: tr('CONSERTOS'), good: tr('POWER-UPS'),
  tight: tr('PASSADAS'), gold: tr('DOURADAS'), mystery: tr('CÁPSULAS'), saves: tr('ESCUDO'), bubbles: tr('BOLHAS'), bad: tr('POWER-DOWNS'), runs: tr('DESCIDAS'),
};
// Seasons keep every date's challenges fixed, across app versions. A challenge's "s" is the season
// it joined (default 0); a season deals only from challenges up to it, counting from its own first
// day. To add challenges: APPEND them with s: <next season> and add that season's start date
// (in the future, so older versions still agree until then). Never edit, reorder or delete entries.
const SEASONS = ['2025-11-08', '2026-12-01', '2026-12-15'];
function seasonOf(key) {
  let s = 0;
  for (let i = 1; i < SEASONS.length; i++) if (key >= SEASONS[i]) s = i;
  return s;
}
const seasonPools = new Map();
function seasonPool(pool, s) {
  const id = `${pool.length}:${s}:${pool === DAILY ? 'd' : pool === MINI ? 'm' : 'w'}`;
  if (!seasonPools.has(id)) seasonPools.set(id, pool.filter((c) => (c.s || 0) <= s));
  return seasonPools.get(id);
}
let dailyKeyOverride = ''; // test hook only: pretend today is this "YYYY-MM-DD"

const pad2 = (n) => String(n).padStart(2, '0');
// The challenges' day turns at midnight in Brasília (UTC-3, no daylight saving since 2019) for
// everyone, whatever the phone's time zone, so the whole country plays the same ones.
const BRT = -3 * 3600e3;
function keyAt(ms) {
  const d = new Date(ms + BRT);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
function todayKey() {
  return dailyKeyOverride || keyAt(now().getTime());
}
const keyDay = (key) => Math.round(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) / 864e5);
const keyDow = (key) => (keyDay(key) + 4) % 7; // 1970-01-01 was a Thursday; 0 = Sunday, 6 = Saturday
const isWeekendKey = (key) => keyDow(key) === 0 || keyDow(key) === 6;
// Saturday of the weekend a Saturday/Sunday key belongs to (shared by both days)
const weekendOf = (key) => keyDay(key) - (keyDow(key) === 0 ? 1 : 0);
// n-th card of a pool dealt as shuffled decks, one deck after another. Each new deck starts with
// cards from the back half of the previous one, so nothing comes back for at least half a pool.
const deckCache = new Map();
function deckOrder(pool, cycle, salt) {
  const id = `${salt}:${cycle}`;
  if (deckCache.has(id)) return deckCache.get(id);
  const len = pool.length;
  const rnd = mulberry32(cycle * 7919 + salt);
  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  let order;
  if (cycle <= 0) order = shuffle(pool.map((_, i) => i));
  else {
    const prev = deckOrder(pool, cycle - 1, salt);
    const half = len >> 1;
    order = [...shuffle(prev.slice(0, half)), ...shuffle(prev.slice(half))]; // the most recent half goes last
  }
  if (deckCache.size > 64) deckCache.clear();
  deckCache.set(id, order);
  return order;
}
function deal(pool, n, salt) {
  const len = pool.length;
  const k = Math.max(0, n);
  return pool[deckOrder(pool, Math.floor(k / len), salt)[k % len]];
}
const freshSlots = (n) => Array.from({ length: n }, () => ({ done: false, prog: 0 }));

// A new day starts fresh challenges.
function ensureDaily() {
  const key = todayKey();
  // a key older than the one already played means the clock went back: keep today's state
  if (save.daily.key === key || (save.daily.key && key < save.daily.key && !dailyKeyOverride)) return;
  save.daily = { key, done: false, prog: 0, mini: freshSlots(2), wk: freshSlots(isWeekendKey(key) ? 3 : 0), extra: freshSlots(EXTRA_MAX) };
  writeSave(save);
}
function dealtMain(key) {
  const s = seasonOf(key);
  return deal(seasonPool(DAILY, s), keyDay(key) - keyDay(SEASONS[s]), 11 + s * 1000);
}
function dailyChallenge() {
  const key = save.daily.key || todayKey();
  const ov = chalOverride.days[key];
  return (ov && ov.main) || dealtMain(key);
}
// Every challenge of today, with its saved state: { kind, i, c, st, reward }.
function challenges() {
  const key = save.daily.key || todayKey();
  const s = seasonOf(key);
  const day0 = keyDay(SEASONS[s]);
  const day = keyDay(key) - day0;
  const ov = chalOverride.days[key] || {};
  const main = dailyChallenge();
  const list = [{ kind: 'main', i: 0, c: main, st: save.daily, reward: DAILY_REWARD[main.d] }];
  for (let i = 0; i < 2; i++) {
    const c = (ov.mini && ov.mini[i]) || deal(seasonPool(MINI, s), day * 2 + i, 23 + s * 1000);
    list.push({ kind: 'mini', i, c, st: save.daily.mini[i], reward: MINI_REWARD });
  }
  if (isWeekendKey(key)) {
    const base = Math.floor((weekendOf(key) - day0) / 7) * 6 + (keyDow(key) === 0 ? 3 : 0);
    for (let i = 0; i < save.daily.wk.length; i++) {
      const c = (ov.wk && ov.wk[i]) || deal(seasonPool(WEEKEND, s), base + i, 37 + s * 1000);
      list.push({ kind: 'wk', i, c, st: save.daily.wk[i], reward: WEEKEND_REWARD });
    }
  }
  // DESAFIOS EXTRAS: only on days config/desafios gives some; on top of the usual ones
  (ov.extra || []).slice(0, EXTRA_MAX).forEach((c, i) => {
    list.push({ kind: 'extra', i, c, st: save.daily.extra[i], reward: c.reward || EXTRA_REWARD, gems: c.gems || 0 });
  });
  // a slot whose challenge changed (an override arrived, a new version) starts its progress over
  for (const x of list) {
    if (!x.st || x.st.done || x.st.t === x.c.text) continue;
    if (x.st.t) x.st.prog = 0;
    x.st.t = x.c.text;
  }
  return list.filter((x) => x.st);
}

// ---- feature flags: Firestore config/flags (public read, changed with "npm run flags") ----
// One boolean field per feature; a missing field (or no document) means on. Read at launch, when
// the connection comes back and when the app comes back after 10 min, and kept for offline use.
// firestore.rules checks the same flags, so old versions and fake clients are stopped as well.
const FLAGS_KEY = 'cataratas.flags';
const FLAG_IDS = ['ranking', 'semana', 'codes', 'invites', 'google', 'ads'];
let flags = {};
try {
  const f = JSON.parse(localStorage.getItem(FLAGS_KEY) || '{}');
  for (const id of FLAG_IDS) if (f[id] === false) flags[id] = false;
} catch {
  flags = {};
}
let flagsAt = 0;
const flagOn = (id) => flags[id] !== false;
async function fetchFlags(force = true) {
  if (!navigator.onLine || (!force && Date.now() - flagsAt < 10 * 60e3)) return;
  try {
    const res = await fbFetch(`${FS}/config/flags?key=${FB.key}`);
    if (!res.ok && res.status !== 404) return; // try again later
    const f = res.ok ? (await res.json()).fields || {} : {};
    const next = {};
    for (const id of FLAG_IDS) if (f[id] && f[id].booleanValue === false) next[id] = false;
    flagsAt = Date.now();
    const changed = JSON.stringify(next) !== JSON.stringify(flags);
    flags = next;
    try {
      localStorage.setItem(FLAGS_KEY, JSON.stringify(flags));
    } catch {
      /* no storage: kept for this session */
    }
    if (changed) applyFlags();
  } catch {
    /* offline or blocked: the last flags stay */
  }
  fetchAppCfg();
}

// ---- ATUALIZE O JOGO: Firestore config/app (public read, set in the backoffice) ----
// minVersion: versions below it can't play until they update (a modal with no way out);
// latestVersion: versions below it get a dismissible suggestion, once per version; message:
// optional text for the modal. Kept for offline use, so a known minimum still applies.
const APPCFG_KEY = 'cataratas.app';
const STORE_URL = 'https://play.google.com/store/apps/details?id=dev.godri.cataratas';
const VER_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
function verCmp(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
function cleanAppCfg(c) {
  const out = { minVersion: '', latestVersion: '', message: '' };
  if (!c || typeof c !== 'object') return out;
  if (typeof c.minVersion === 'string' && VER_RE.test(c.minVersion)) out.minVersion = c.minVersion;
  if (typeof c.latestVersion === 'string' && VER_RE.test(c.latestVersion)) out.latestVersion = c.latestVersion;
  if (typeof c.message === 'string') out.message = c.message.slice(0, 160);
  return out;
}
let appCfg = cleanAppCfg((() => {
  try {
    return JSON.parse(localStorage.getItem(APPCFG_KEY) || 'null');
  } catch {
    return null;
  }
})());
const updateForced = () => !!appCfg.minVersion && verCmp(APP_VERSION, appCfg.minVersion) < 0;
const updateSuggested = () => !!appCfg.latestVersion && verCmp(APP_VERSION, appCfg.latestVersion) < 0 && localStorage.getItem(`${APPCFG_KEY}.later`) !== appCfg.latestVersion;
async function fetchAppCfg() {
  if (!navigator.onLine) return;
  try {
    const res = await fbFetch(`${FS}/config/app?key=${FB.key}`);
    if (!res.ok && res.status !== 404) return;
    const f = res.ok ? (await res.json()).fields || {} : {};
    appCfg = cleanAppCfg({ minVersion: f.minVersion && f.minVersion.stringValue, latestVersion: f.latestVersion && f.latestVersion.stringValue, message: f.message && f.message.stringValue });
    try {
      localStorage.setItem(APPCFG_KEY, JSON.stringify(appCfg));
    } catch {
      /* no storage: kept for this session */
    }
    checkUpdate();
  } catch {
    /* offline or blocked: the last config stays */
  }
}
// Shows the modal when it applies and nothing is going on (never mid-run: it waits for the end).
function checkUpdate() {
  if (testGaps || G.state === 'playing' || G.state === 'revive' || G.state === 'dying' || G.state === 'paused') return;
  const forced = updateForced();
  if (!forced && !updateSuggested()) {
    show(ui.update, false);
    return;
  }
  ui.updateTitle.textContent = forced ? tr('ATUALIZE O JOGO') : tr('VERSÃO NOVA!');
  ui.updateText.textContent = appCfg.message || (forced ? tr('ESSA VERSÃO NÃO FUNCIONA MAIS. ATUALIZE NA LOJA PRA CONTINUAR DESCENDO A CACHOEIRA.') : tr('TEM SKIN, DESAFIO E CONQUISTA NOVA ESPERANDO NA LOJA.'));
  ui.updateVer.textContent = trf('SUA VERSÃO: {0} · NOVA: {1}', APP_VERSION, forced ? appCfg.minVersion : appCfg.latestVersion);
  show(ui.updateLater, !forced);
  show(ui.update, true);
}
// What's on screen right now follows a flag that just changed.
function applyFlags() {
  show(ui.inviteBtn, flagOn('invites'));
  if (!ui.rank.hidden) renderRank();
  if (flagOn('ranking') && save.rank.dirty && save.rank.name) syncRank().catch(() => {});
  if (flagOn('invites')) sendInvite();
}

// ---- remote overrides: Firestore config/desafios (public read, edited in the console) ----
// Document field "data" (string) = JSON { "days": { "YYYY-MM-DD": { "main": {...}, "mini": [{...}, {...}],
// "wk": [{...}, {...}, {...}] } } }. Any part may be left out; what's missing comes from the deck.
// Fetched when online (at most every 3 h) and cached, so it also works offline afterwards.
const CFG_KEY = 'cataratas.config';
const CHAL_STATS = new Set(['m', 'nohit', 'nocoin', 'nograze', 'nobad', 'coins', 'grazes', 'repairs', 'good', 'tight', 'gold', 'mystery', 'saves', 'bubbles', 'bad', 'runs', 'zenMax', 'threadMax']);
// hours: [from, to) on the phone clock, 0-23; from > to wraps past midnight ([19, 6] = night)
const validHours = (h) => Array.isArray(h) && h.length === 2 && h.every((x) => Number.isInteger(x) && x >= 0 && x <= 23) && h[0] !== h[1];
function inHours(c) {
  if (!c.hours) return true;
  const h = now().getHours();
  const [a, b] = c.hours;
  return a < b ? h >= a && h < b : h >= a || h < b;
}
const hoursText = (c) => trf('SÓ DAS {0}h ÀS {1}h', c.hours[0], c.hours[1]);
function validChal(c, main) {
  if (!c || typeof c !== 'object' || !CHAL_STATS.has(c.stat)) return null;
  if (!Number.isInteger(c.goal) || c.goal < 1 || c.goal > 100000) return null;
  if (typeof c.text !== 'string' || c.text.length < 3 || c.text.length > 80) return null;
  const out = { stat: c.stat, goal: c.goal, text: c.text, sum: c.sum === true };
  if (main) out.d = c.d === 2 ? 2 : 1;
  if (typeof c.unit === 'string' && c.unit.length <= 4) out.unit = c.unit;
  if (typeof c.rider === 'string' && RIDER_SKINS.some((k) => k.id === c.rider)) out.rider = c.rider;
  if (typeof c.barrel === 'string' && BARREL_SKINS.some((k) => k.id === c.barrel)) out.barrel = c.barrel;
  if (validHours(c.hours)) out.hours = [c.hours[0], c.hours[1]];
  if (Number.isInteger(c.reward) && c.reward >= 1 && c.reward <= 500) out.reward = c.reward; // extras only
  if (Number.isInteger(c.gems) && c.gems >= 1 && c.gems <= 10) out.gems = c.gems;
  return out;
}
function parseOverride(raw) {
  const days = {};
  const src = raw && typeof raw === 'object' && raw.days && typeof raw.days === 'object' ? raw.days : {};
  for (const [key, d] of Object.entries(src)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !d || typeof d !== 'object') continue;
    const day = {};
    const main = validChal(d.main, true);
    if (main) day.main = main;
    if (Array.isArray(d.mini)) day.mini = d.mini.slice(0, 2).map((c) => validChal(c, false));
    if (Array.isArray(d.wk)) day.wk = d.wk.slice(0, 3).map((c) => validChal(c, false));
    if (Array.isArray(d.extra)) day.extra = d.extra.slice(0, EXTRA_MAX).map((c) => validChal(c, false)).filter(Boolean);
    days[key] = day;
  }
  return { days };
}
function loadOverride() {
  try {
    const c = JSON.parse(localStorage.getItem(CFG_KEY) || 'null');
    return { at: (c && c.at) || 0, ...parseOverride(c) };
  } catch {
    return { at: 0, days: {} };
  }
}
let chalOverride = loadOverride();
async function fetchOverride(force) {
  if (!navigator.onLine || (!force && Date.now() - chalOverride.at < 3 * 3600e3)) return;
  try {
    const res = await fbFetch(`${FS}/config/desafios?key=${FB.key}`);
    let raw = { days: {} };
    if (res.ok) {
      const body = await res.json();
      raw = JSON.parse((body.fields && body.fields.data && body.fields.data.stringValue) || '{}');
    } else if (res.status !== 404) return; // try again later
    const parsed = parseOverride(raw);
    const today = todayKey();
    for (const k of Object.keys(parsed.days)) if (k < today) delete parsed.days[k]; // only what's ahead
    chalOverride = { at: Date.now(), ...parsed };
    try {
      localStorage.setItem(CFG_KEY, JSON.stringify(chalOverride));
    } catch {
      /* no storage: keep it for this session */
    }
    refreshDaily();
  } catch {
    /* offline or blocked: the deck decides */
  }
}
const dayName = () => (keyDow(save.daily.key || todayKey()) === 0 ? tr('DOMINGO') : tr('SÁBADO'));
const CHAL_HEAD = { main: () => tr('DESAFIO DO DIA!'), mini: () => tr('MINI-DESAFIO!'), wk: () => trf('DESAFIO DE {0}!', dayName()), extra: () => tr('DESAFIO EXTRA!') };
// The skins a challenge needs (barrel and/or rider); dailySkin is the one to deal with first:
// one not owned yet, else one not equipped, else the first.
const dailySkins = (c) => [c.barrel && ['b', BARREL_SKINS.find((k) => k.id === c.barrel)], c.rider && ['r', RIDER_SKINS.find((k) => k.id === c.rider)]].filter(Boolean);
function dailySkin(c) {
  const all = dailySkins(c);
  if (!all.length) return null;
  return all.find(([k, sk]) => sk && !owns(k, sk)) || all.find(([k, sk]) => sk && (k === 'b' ? barrelSkin : riderSkin).id !== sk.id) || all[0];
}
const dailyFmt = (c, v) => `${Math.min(v, c.goal)}/${c.goal} ${c.unit || DAILY_UNIT[c.stat] || ''}`.trim();

function dailyVal(c, r, m) {
  if (c.stat === 'm') return m;
  if (c.stat === 'nohit') return r.hits ? 0 : m;
  if (c.stat === 'nocoin') return r.coins ? 0 : m;
  if (c.stat === 'nograze') return r.grazes ? 0 : m;
  if (c.stat === 'nobad') return r.bad ? 0 : m;
  if (c.stat === 'runs') return 1;
  return Math.floor(r[c.stat] || 0);
}

// Does the run now on (or about to start) count for this challenge?
function chalEligible(x) {
  if (x.st.done || save.diff < 1) return false;
  if (x.kind === 'main' && save.diff !== x.c.d) return false;
  if (x.c.barrel && barrelSkin.id !== x.c.barrel) return false;
  if (x.c.rider && riderSkin.id !== x.c.rider) return false;
  if (!inHours(x.c)) return false;
  return true;
}
const dailyEligible = () => chalEligible(challenges()[0]);
const chalId = (x) => `${x.kind}${x.i}`;

function completeChallenge(x) {
  const r = G.run;
  x.st.done = true;
  addCoins(x.reward);
  r.dailyCoins += x.reward;
  r.chalDone.push(chalId(x));
  if (x.kind === 'main') {
    r.dailyDone = true;
    save.dailyCount++;
  } else if (x.kind === 'mini') save.miniCount++;
  else if (x.kind === 'wk') {
    const wk = weekendOf(save.daily.key);
    if (save.wkKey !== wk) {
      save.wkKey = wk;
      save.wkDone = 0;
    }
    save.wkDone++;
  }
  writeSave(save);
  const gems = x.kind === 'wk' ? WEEKEND_GEMS : x.gems || 0;
  if (gems) addGems(gems);
  toastQueue.push({ head: CHAL_HEAD[x.kind](), name: x.c.text, coins: x.reward, gems });
  if (!toastTimer) nextToast();
  if (x.kind === 'main') {
    scheduleReminders(); // today's reminder isn't needed anymore
    unlock('daily1');
    if (x.c.d === 2) unlock('dailyhard');
    if (save.dailyCount >= 7) unlock('daily7');
    if (save.dailyCount >= 30) unlock('daily30');
  }
  if (save.miniCount >= 10) unlock('mini10');
  if (save.miniCount >= 50) unlock('mini50');
  if (save.daily.done && save.daily.mini.every((s) => s.done)) unlock('dailyall');
  if (save.daily.wk.length && save.daily.wk.every((s) => s.done)) unlock('wkday');
  if (save.wkDone >= 6) unlock('wkfull');
  refreshAchCount();
  checkWallet();
}

function checkDaily() {
  const r = G.run;
  if (!r || !r.chal.length || G.runDiff < 1) return;
  for (const x of challenges()) {
    if (x.st.done || !r.chal.includes(chalId(x))) continue;
    if ((x.c.sum ? x.st.prog : 0) + dailyVal(x.c, r, G.meters) >= x.c.goal) completeChallenge(x);
  }
}

// End of a run: "sum" challenges keep what this run added; returns the lines for the game-over screen.
function dailyAtEnd() {
  const r = G.run;
  if (!r || !r.chal.length) return '';
  const lines = [];
  for (const x of challenges()) {
    if (!r.chal.includes(chalId(x))) continue;
    if (r.chalDone.includes(chalId(x))) {
      lines.push(trf('{0} CONCLUÍDO! +{1}{2}', CHAL_HEAD[x.kind]().replace(/[¡!]/g, ''), COIN_ICON, x.reward));
      continue;
    }
    if (x.st.done) continue;
    const v = dailyVal(x.c, r, G.meters);
    if (x.c.sum) {
      x.st.prog += v;
      if (x.kind === 'main') lines.push(trf('DESAFIO DO DIA: {0} HOJE', dailyFmt(x.c, x.st.prog)));
    } else if (x.kind === 'main') lines.push(trf('DESAFIO DO DIA: {0}. QUASE!', dailyFmt(x.c, v)));
  }
  writeSave(save);
  const all = challenges();
  const left = all.filter((x) => !x.st.done).length;
  if (left) lines.push(trf('DESAFIOS DE HOJE: {0}/{1}', all.length - left, all.length));
  return lines.join('<br>');
}

// Title: the main challenge card, and the button with today's tally that opens the full list.
function refreshDaily() {
  ensureDaily();
  const all = challenges();
  const main = all[0];
  const c = main.c;
  const done = all.filter((x) => x.st.done).length;
  const wk = all.filter((x) => x.kind === 'wk');
  ui.chalBtn.innerHTML = trf('DESAFIOS DE HOJE: {0}/{1}{2} <span aria-hidden="true">›</span>', done, all.length, wk.length ? ` · ${dayName()}!` : '');
  ui.chalBtn.classList.toggle('all', done === all.length);
  show(ui.dailyBtn, !save.daily.done);
  if (save.daily.done) return;
  ui.dailyBtn.dataset.diff = c.d;
  ui.dailyHead.innerHTML = trf('DESAFIO DO DIA · {0} · +{1}{2}', DIFFS[c.d].name, COIN_ICON, DAILY_REWARD[c.d]);
  ui.dailyText.textContent = c.text;
  const sk = dailySkin(c);
  let st;
  if (save.diff !== c.d) st = trf('TOQUE PARA MUDAR PARA O {0}', DIFFS[c.d].name);
  else if (!inHours(c)) st = hoursText(c);
  else if (sk && !owns(sk[0], sk[1])) st = sk[1].price > 0 ? trf('TOQUE PARA COMPRAR: {0}{1}', COIN_ICON, sk[1].price) : tr('TOQUE PARA VER COMO LIBERAR');
  else if (sk && (sk[0] === 'b' ? barrelSkin : riderSkin).id !== sk[1].id) st = tr('TOQUE PARA EQUIPAR');
  else if (c.sum && save.daily.prog > 0) st = trf('HOJE: {0}', dailyFmt(c, save.daily.prog));
  else st = tr('PRONTO! É SÓ JOGAR');
  ui.dailyStatus.innerHTML = st;
  ui.dailyBtn.classList.toggle('ready', dailyEligible());
}

// The full list: main, minis and (on weekends) the day's 3 extra challenges, with progress.
function renderChal() {
  ensureDaily();
  const all = challenges();
  const item = (x) => {
    const need = [];
    if (x.kind === 'main') need.push(DIFFS[x.c.d].name);
    const names = dailySkins(x.c).filter(([, sk]) => sk).map(([, sk]) => sk.name);
    if (names.length) need.push(trf('COM {0}', names.join(' + ')));
    if (x.c.hours && !x.st.done) need.push(hoursText(x.c));
    const prog = x.st.done ? tr('FEITO!') : x.c.sum ? `${dailyFmt(x.c, x.st.prog)}` : tr('NUMA DESCIDA');
    return `<li class="${x.st.done ? 'done' : ''}"><span class="chal-t">${x.c.text}${need.length ? `<small>${need.join(' · ')}</small>` : ''}</span><b>${x.st.done ? '✓' : `+${COIN_ICON}${x.reward}${x.gems ? ` +${GEM_ICON}${x.gems}` : ''}`}</b><em>${prog}</em></li>`;
  };
  const group = (title, list) => (list.length ? `<h3>${title}</h3><ul class="chal-list">${list.map(item).join('')}</ul>` : '');
  const wk = all.filter((x) => x.kind === 'wk');
  const wkInfo = wk.length
    ? trf('<p class="chal-note">FAÇA OS 3 DE HOJE: LIBERA O TIO DO CHURRASCO E A CHURRASQUEIRA.<br>FAÇA OS 6 DO FIM DE SEMANA ({0}/6): LIBERA O FAROFEIRO E A BOIA DE FLAMINGO.</p>', save.wkKey === weekendOf(save.daily.key) ? save.wkDone : 0)
    : tr('<h3>FIM DE SEMANA</h3><p class="chal-note">TODO SÁBADO E DOMINGO TEM 3 DESAFIOS A MAIS. FAÇA OS 3 DE UM DIA E LIBERE O TIO DO CHURRASCO E A CHURRASQUEIRA. FAÇA OS 6 DO MESMO FIM DE SEMANA E LIBERE O FAROFEIRO E A BOIA DE FLAMINGO.</p>');
  ui.chalBody.innerHTML = [
    group(tr('DESAFIO DO DIA'), all.filter((x) => x.kind === 'main')),
    group(tr('MINI-DESAFIOS'), all.filter((x) => x.kind === 'mini')),
    group(trf('DESAFIOS DE {0}', dayName()), wk),
    group(tr('DESAFIOS EXTRAS'), all.filter((x) => x.kind === 'extra')),
    wkInfo,
    tr('<p class="chal-note">VALEM NO NORMAL E NO DIFÍCIL. NO FÁCIL NÃO CONTA.</p>'),
  ].join('');
}
function openChal() {
  renderChal();
  show(ui.title, false);
  show(ui.chal, true);
  ui.chalBody.scrollTop = 0;
}
function closeChal() {
  show(ui.chal, false);
  show(ui.title, true);
  refreshDaily();
  G.lockUntil = performance.now() + 300; // the "VOLTAR" tap must not also start a run
}

// Tapping the card sets the run up: difficulty, then the skin (equips it, or opens the shop on it).
function prepareDaily() {
  const c = dailyChallenge();
  if (save.daily.done) return;
  if (save.diff !== c.d) {
    save.diff = c.d;
    input.sens = DIFFS[save.diff].sens;
    flashDiffNote();
  }
  const missing = dailySkins(c).find(([kind, skin]) => skin && !owns(kind, skin));
  if (missing) {
    writeSave(save);
    refreshToggles();
    openShop(ui.title, missing[0], missing[1].id);
    return;
  }
  if (dailySkins(c).length) {
    for (const [kind, skin] of dailySkins(c)) {
      if (!skin) continue;
      if (kind === 'b') save.barrel = skin.id;
      else save.rider = skin.id;
    }
    applySkins();
  }
  writeSave(save);
  refreshToggles();
}

// ---------- device tricks ----------
// Charger: the Battery Status API (Chrome / Android WebView).
function watchCharger() {
  if (!DEVICE_CAN.battery) return;
  navigator
    .getBattery()
    .then((b) => {
      battery = b;
      checkBattery();
      b.addEventListener('chargingchange', checkBattery);
      b.addEventListener('levelchange', checkBattery);
    })
    .catch(() => {});
}

// Screenshot: MainActivity listens with Android 14's ScreenCaptureCallback and fires this window
// event. Android saves the picture before telling anyone, so the monster surfaces right after it.
const NESSIE_ROWS = [
  '....oooo....................',
  '...oGGGGo...................',
  '..oGGeGGGo..................',
  '.oGGGGGGGGo.................',
  '.oGGGGGGGGo.................',
  '..oommmGGGo.................',
  '......oGGLo.................',
  '......oGGLo.................',
  '......oGGLo.................',
  '......oGGLo.................',
  '......oGGLo.........ooo.....',
  '.....oGGGLo.......ooGGGoo...',
  '.....oGGGLLo.....oGGGGGLLo..',
  '....oGGGGGLLo...oGGGGGGGLLo.',
  'wwwwwwwwwwwwwwwwwwwwwwwwwwww',
  'WwWWwWWWwWWwWWWwWWwWWWwWWwWW',
];
const NESSIE_PAL = { o: '#123b22', G: '#3fa36a', L: '#9be0b0', e: '#111111', m: '#123b22', w: '#ffffff', W: '#bfe3ff' };
let nessieEl = null;
let flashEl = null;
function nessieSurfaces() {
  if (!nessieEl) {
    nessieEl = paint(NESSIE_ROWS[0].length, NESSIE_ROWS.length, (i, j) => NESSIE_PAL[NESSIE_ROWS[j][i]] || null);
    nessieEl.id = 'nessie';
    nessieEl.setAttribute('aria-hidden', 'true');
    flashEl = document.createElement('div');
    flashEl.id = 'camflash';
    document.body.append(flashEl, nessieEl);
  }
  for (const el of [nessieEl, flashEl]) {
    el.classList.remove('go');
    void el.offsetWidth; // restart the CSS animation
    el.classList.add('go');
  }
  sfx.blip([1568, 2093], 0.03, 0.05); // camera click
}
// A print with certain riders equipped catches something else on camera.
const PRINT_RIDERS = { nessie: 'printnitida', ghost: 'printghost', et: 'printufo' };
function onScreenshot() {
  nessieSurfaces();
  unlock('print');
  if (PRINT_RIDERS[riderSkin.id]) unlock(PRINT_RIDERS[riderSkin.id]);
}
window.addEventListener('cataratas:screenshot', onScreenshot);

// ---------- clock (anti-cheat) ----------
// Date and time badges, holidays and the daily challenge read the clock through now(). When online
// we ask Firestore for the server time (runQuery answers carry "readTime"); a phone clock more than
// 10 min off is ignored and the server time is used. Offline, the phone clock is used, but a clock
// that went back before the last time seen in this save isn't trusted for time badges.
const clock = { offset: 0, verified: false, bad: false };
const now = () => new Date(Date.now() + clock.offset);
function clockTrusted() {
  return clock.verified || Date.now() >= save.lastTime - 10 * 60e3;
}
function stampClock() {
  const t = now().getTime();
  if (t > save.lastTime) save.lastTime = t;
}
async function syncClock() {
  if (!navigator.onLine) return;
  try {
    await appCheckToken(); // fetched first, so it doesn't count in the round trip
    const t0 = Date.now();
    const res = await fbFetch(`${FS}:runQuery?key=${FB.key}`, json({ structuredQuery: { from: [{ collectionId: 'players' }], where: ONLY_GOOGLE, limit: 1 } }));
    const body = await res.json();
    const t1 = Date.now();
    const read = Array.isArray(body) && body.find((r) => r.readTime);
    if (!read) return;
    const server = Date.parse(read.readTime) + (t1 - t0) / 2;
    const off = server - t1;
    clock.bad = Math.abs(off) > 10 * 60e3;
    clock.offset = clock.bad ? off : 0;
    clock.verified = true;
    refreshClockNote();
    refreshDaily();
    checkHolidays();
    fetchOverride();
  } catch {
    /* offline or blocked: keep the phone clock */
  }
}
function refreshClockNote() {
  const d = now();
  const f13 = clockTrusted() && d.getDay() === 5 && d.getDate() === 13 && !save.ach.friday13;
  ui.clockNote.textContent = clock.bad ? tr('RELÓGIO DO CELULAR ERRADO: USANDO A HORA DA INTERNET') : f13 ? tr('SEXTA-FEIRA 13... TEM ALGUÉM TE ESPERANDO NA CACHOEIRA') : '';
  show(ui.clockNote, clock.bad || f13);
}

// Weekday / hour badges (phone clock, see now()).
function checkClockBadges() {
  if (!clockTrusted()) return;
  stampClock();
  const d = now();
  const h = d.getHours();
  const wd = d.getDay();
  if (h < 5) unlock('night');
  if (wd === 5) unlock('sextou');
  if (wd === 5 && d.getDate() === 13) unlock('friday13');
  if (wd === 6) save.weekendSat = true;
  if (wd === 0) save.weekendSun = true;
  if (save.weekendSat && save.weekendSun) unlock('weekend');
  if (wd === 1 && h < 8) unlock('monday');
  if (h === 12) unlock('lunch');
}

// Easter Sunday (anonymous Gregorian algorithm); Carnaval and Páscoa move with it.
function easterOf(y) {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}
const HOLIDAYS = [
  { ach: 'anonovo', on: (m, d) => (m === 12 && d >= 30) || (m === 1 && d <= 2) },
  { ach: 'carnaval', on: (m, d, e) => e >= -50 && e <= -46 },
  { ach: 'pascoa', on: (m, d, e) => e >= -3 && e <= 1 },
  { ach: 'namorados', on: (m, d) => m === 6 && d >= 11 && d <= 13 },
  { ach: 'junina', on: (m) => m === 6 },
  { ach: 'sete', on: (m, d) => m === 9 && d >= 5 && d <= 8 },
  { ach: 'criancas', on: (m, d) => m === 10 && d >= 10 && d <= 13 },
  { ach: 'halloween', on: (m, d) => (m === 10 && d >= 25) || (m === 11 && d <= 2) },
  { ach: 'natal', on: (m, d) => m === 12 && d >= 20 && d <= 26 },
  // Mother's and Father's Day in Brazil: 2nd Sunday of May / August, from Friday to Monday
  { ach: 'maes', on: (m, d, e, y) => m === 5 && Math.abs(d - secondSunday(y, 5) + 0.5) <= 1.5 },
  { ach: 'pais', on: (m, d, e, y) => m === 8 && Math.abs(d - secondSunday(y, 8) + 0.5) <= 1.5 },
];
function secondSunday(y, m) {
  return 8 + ((7 - new Date(y, m - 1, 8).getDay()) % 7);
}
function holidaysOn(t) {
  const day0 = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const e = Math.round((day0 - easterOf(t.getFullYear())) / 864e5);
  return HOLIDAYS.filter((h) => h.on(t.getMonth() + 1, t.getDate(), e, t.getFullYear())).map((h) => h.ach);
}
function checkHolidays() {
  if (!clockTrusted()) return;
  for (const id of holidaysOn(now())) unlock(id);
}

// ---------- battery ----------
let battery = null;
function checkBattery() {
  if (!battery) return;
  if (battery.charging) unlock('plugged');
  if (battery.level < 0.1) unlock('battlow');
  if (battery.level >= 0.9) unlock('battfull');
}

// ---------- shake (during a run) and upside down (title) ----------
const shake = { last: null, hits: [] };
window.addEventListener('devicemotion', (e) => {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  const l = shake.last;
  shake.last = { x: a.x, y: a.y, z: a.z };
  // SONECA: paused with the screen facing the table for 3 s
  if (G.state === 'paused' && a.z < -8.5) {
    if (!shake.napAt) shake.napAt = performance.now();
    else if (performance.now() - shake.napAt > 3000) unlock('soneca');
  } else shake.napAt = 0;
  if (!l || G.state !== 'playing') return;
  const jolt = Math.abs(a.x - l.x) + Math.abs(a.y - l.y) + Math.abs(a.z - l.z);
  if (jolt < 18) return;
  const t = performance.now();
  shake.hits = shake.hits.filter((h) => t - h < 1200);
  if (shake.hits.length && t - shake.hits[shake.hits.length - 1] < 80) return;
  shake.hits.push(t);
  if (shake.hits.length >= 5) {
    shake.hits.length = 0;
    G.trauma = Math.min(1, G.trauma + 0.5);
    popText(tr('TERREMOTO!'), '');
    unlock('shake');
  }
});

// PIÃO DA CASA PRÓPRIA: on the title, the phone lying flat turns a full circle (compass heading)
// within 8 s. Wobbling back and forth cancels out.
const spin = { last: null, sum: 0, t0: 0 };
window.addEventListener('deviceorientation', (e) => {
  const flat = e.alpha != null && e.beta != null && Math.abs(e.beta) < 25 && Math.abs(e.gamma) < 25;
  if (!flat || G.state !== 'title') {
    spin.last = null;
    return;
  }
  const t = performance.now();
  if (spin.last == null || t - spin.t0 > 8000) {
    spin.sum = 0;
    spin.t0 = t;
  } else {
    let d = e.alpha - spin.last;
    if (d > 180) d -= 360;
    else if (d < -180) d += 360;
    spin.sum += d;
  }
  spin.last = e.alpha;
  if (Math.abs(spin.sum) >= 360) {
    spin.sum = 0;
    unlock('piao');
  }
});
// LADO SOMBRIO: the phone's dark theme. In the app the WebView reports the app's own (light)
// theme, so Android is asked directly; in a browser prefers-color-scheme is right.
const darkScheme = matchMedia('(prefers-color-scheme: dark)');
function checkDarkMode() {
  if (darkScheme.matches) return unlock('ladosombrio');
  const cap = window.Capacitor;
  if (!NATIVE_ANDROID || !cap || typeof cap.nativePromise !== 'function') return;
  cap.nativePromise('CataratasSensors', 'darkMode', {}).then((r) => r && r.dark && unlock('ladosombrio')).catch(() => {});
}

// Flipping the phone upside down on the title toggles the MUNDO INVERTIDO for the next runs.
const flip = { t: 0, armed: true };
function upsideStep(dt) {
  if (G.state !== 'title' || ui.title.hidden || input.beta == null) return;
  const down = Math.sin(input.beta * DEG) < -0.75;
  if (!down) {
    flip.t = 0;
    if (Math.sin(input.beta * DEG) > 0.3) flip.armed = true;
    return;
  }
  if (!flip.armed || (flip.t += dt) < 0.7) return;
  flip.armed = false;
  setUpside(!save.upside);
}
function setUpside(on) {
  save.upside = on;
  writeSave(save);
  applyUpside();
  G.flash = reducedMotion ? 0 : 0.12;
  sfx.unlock();
  if (on) sfx.blip([220, 207, 196, 98], 0.12, 0.08);
  else sfx.blip([523, 659, 784], 0.06, 0.05);
  if (navigator.vibrate) navigator.vibrate(on ? [30, 60, 30, 60, 200] : 40);
  if (on) unlock('upside');
}
function applyUpside() {
  document.body.classList.toggle('upside', save.upside);
  show(ui.upsideNote, save.upside);
}

// ---------- day / night (phone clock) and weather (per run) ----------
function periodOf(t) {
  const h = t.getHours();
  return h >= 19 || h < 6 ? 'night' : h < 8 ? 'dawn' : h >= 17 ? 'dusk' : 'day';
}
const world = { period: periodOf(new Date()), override: params.get('period'), weatherOverride: params.get('weather') };
function refreshPeriod() {
  world.period = world.tutPeriod || world.override || periodOf(now());
}
// Weather: every run starts clear; every 500-700 m weatherStep rolls again and about half the
// rolls bring one. Each shows its icon under the record for the
// whole run and a hint at the start. odds: chance per run (the rest is clear sky).
const WEATHERS = {
  rain: { name: tr('CHUVA'), soon: tr('VEM CHUVA AÍ!'), tip: tr('CHUVA'), odds: 0.11,
    rows: ['..WWW....', '.WWWWWW..', 'WWWWWWWW.', 'WWWWWWWWW', '.WWWWWWW.', '.........', '.B..B..B.', 'B..B..B..', '.........'], pal: { W: '#e6ebf0', B: '#6fb2f0' } },
  wind: { name: tr('VENTANIA'), soon: tr('VEM VENTANIA!'), badge: tr('VENTANIA<br><b>MOEDAS x2</b>'), tip: tr('VENTANIA: MOEDAS EM DOBRO!'), odds: 0.1,
    rows: ['.....WW..', 'WWWWW..W.', '.......W.', 'WWWWWWW..', '.........', 'WWWWWWWW.', '........W', '.....W..W', '......WW.'], pal: { W: '#e6f4ff' } },
  storm: { name: tr('TEMPESTADE'), soon: tr('VEM TEMPESTADE!'), tip: tr('TEMPESTADE: SAIA DO ALVO<br>ANTES DO RAIO CAIR!'), odds: 0.07,
    rows: ['..ggg....', '.gggggg..', 'ggggggggg', '.ggYgggg.', '...YY....', '..YYYY...', '....YY...', '....Y....', '...Y.....'], pal: { g: '#8a93a6', Y: '#ffd23f' } },
  snow: { name: tr('NEVE'), soon: tr('VAI NEVAR!'), tip: tr('NEVE: O BARRIL ESCORREGA'), odds: 0.07,
    rows: ['....W....', '.W..W..W.', '..W.W.W..', '...WWW...', 'WWWWWWWWW', '...WWW...', '..W.W.W..', '.W..W..W.', '....W....'], pal: { W: '#e6f4ff' } },
  fog: { name: tr('NEBLINA'), soon: tr('VEM NEBLINA!'), tip: tr('NEBLINA: OLHO VIVO LÁ NA FRENTE'), odds: 0.07,
    rows: ['.........', '.WWWWWW..', '.........', '..WWWWWWW', '.........', 'WWWWWW...', '.........', '..gggggg.', '.........'], pal: { W: '#e6ebf0', g: '#9aa3ae' } },
  mirage: { name: tr('MIRAGEM'), soon: tr('VEM MIRAGEM!'), tip: tr('MIRAGEM: NEM TODA PEDRA<br>É DE VERDADE'), odds: 0.06,
    rows: ['...YYY...', '..YYYYY..', '..YYYYY..', '...YYY...', '.........', '.OO..OO..', 'O..OO..OO', '.........', '.OO..OO..'], pal: { Y: '#ffd23f', O: '#ff9f1c' } },
};
const weatherIconUrl = {};
for (const [id, w] of Object.entries(WEATHERS)) weatherIconUrl[id] = makeIcon(w).toDataURL();
function rollWeather() {
  if (world.weatherOverride) return world.weatherOverride;
  if (save.runs < 3) return 'clear'; // first runs: learn the game first
  let r = Math.random();
  for (const [id, w] of Object.entries(WEATHERS)) if ((r -= w.odds) < 0) return id;
  return 'clear';
}
const isWet = () => G.run && (G.run.weather === 'rain' || G.run.weather === 'storm');

// Every 500-700 m (wxGap) the weather is rolled again (same odds as at the start). Rolling the
// same weather changes nothing and says nothing; a different one is announced, and lands
// WX_WARN seconds later with a cross-fade.
const WX_WARN = 2;
function weatherStep(dt) {
  G.wxFade += dt / 1.5;
  if (G.wxPending) {
    if ((G.wxPendT -= dt) <= 0) setWeather(G.wxPending);
    return;
  }
  if (G.meters < G.wxNext) return;
  G.wxNext += wxGap();
  const next = rollWeather();
  if (next === G.run.weather) return;
  G.wxPending = next;
  G.wxPendT = WX_WARN + 0.9;
  // a 100 m milestone may pop first; the warning follows it
  setTimeout(() => {
    if (G.state !== 'playing' || G.wxPending !== next) return;
    popText(next === 'clear' ? tr('O TEMPO VAI ABRIR!') : WEATHERS[next].soon, next === 'clear' ? '' : 'bad');
    sfx.blip([392, 523, 392, 523], 0.08, 0.05);
  }, 900);
}
function setWeather(w) {
  // ALERTA SEVERO: a whole storm, from rolling in to clearing up, without a hit
  if (G.run.weather === 'storm' && G.run.stormHits === G.run.hits && G.state === 'playing') {
    unlock('stormsafe');
    if (G.run.stormUfa >= 3) unlock('entreraios'); // DANÇA DOS RAIOS: and 3 bolts fell right beside it
  }
  G.run.stormHits = w === 'storm' ? G.run.hits : -1;
  G.run.stormUfa = 0;
  G.wxPrev = G.run.weather;
  G.wxFade = 0;
  G.wxPending = null;
  G.run.weather = w;
  G.wxFromM = G.meters;
  G.wind = 0;
  G.windT = 0;
  G.windFlip = 6 + Math.random() * 6;
  G.bolt = null;
  G.boltWait = 2.5 + Math.random() * 2; // no bolt right as the storm rolls in
  if (G.wxPrev === 'mirage') G.rocks = G.rocks.filter((r) => !r.fake); // the mirage clears
  showWeatherBadge();
  layoutFxHud();
  if (w === 'clear') popText(tr('O TEMPO ABRIU!'), '');
  else showHint(WEATHERS[w].tip);
  ui.wx.classList.remove('in');
  void ui.wx.offsetWidth; // restart the CSS animation
  ui.wx.classList.add('in');
}

// Weather badge under the record, and where the power-up icons start below it.
let fxHudY = 18;
function showWeatherBadge() {
  const w = WEATHERS[G.run.weather];
  show(ui.wx, !!w);
  if (!w) return;
  ui.wx.dataset.w = G.run.weather;
  ui.wxIcon.src = weatherIconUrl[G.run.weather];
  ui.wxIcon.classList.toggle('flip', G.run.weather === 'wind' && G.windDir < 0);
  ui.wxName.innerHTML = w.badge || w.name;
}
function layoutFxHud() {
  if (ui.hud.hidden) return;
  const c = canvas.getBoundingClientRect();
  if (!c.height) return;
  const bottom = ui.hudR.getBoundingClientRect().bottom;
  fxHudY = Math.max(18, Math.ceil(((bottom - c.top) * H) / c.height) + 4);
}
const WIND_MAX = 42; // px/s pushed sideways at the peak of a gust
function windStep(dt) {
  if (G.run.weather !== 'wind' || !G.landed) return;
  G.windT += dt;
  if ((G.windFlip -= dt) <= 0) {
    G.windDir = -G.windDir;
    G.windFlip = 7 + Math.random() * 6;
    popText(G.windDir > 0 ? tr('VENTO →') : tr('← VENTO'), '');
    ui.wxIcon.classList.toggle('flip', G.windDir < 0);
  }
  const gust = Math.pow(0.5 + 0.5 * Math.sin(G.windT * 0.9), 2);
  G.wind = G.windDir * gust * WIND_MAX * (G.runDiff === 0 ? 0.5 : 1);
  G.bx += G.wind * dt;
  if (Math.random() < dt * 30 * gust) emit(G.windDir > 0 ? -4 : W + 4, G.cam + Math.random() * H, G.windDir * (160 + Math.random() * 80), 0, 1.4, 'rgba(255,255,255,0.5)', 1, 0);
}

// TEMPESTADE: a target marks where the bolt will fall (where the barrel is now), then it falls.
// The barrel sits on a fixed screen row, so the mark stays put and you steer out of it.
const BOLT_WARN = [1.7, 1.3, 1.05]; // seconds of warning per difficulty
const BOLT_R = 12; // strike radius around the mark
function stormStep(dt) {
  if (G.run.weather !== 'storm' || !G.landed) return;
  const by = G.cam + curBY;
  if (!G.bolt) {
    if ((G.boltWait -= dt) > 0) return;
    const x = clamp(G.bx, wallL(by) + 8, wallR(by) - 8);
    G.bolt = { x, warn: BOLT_WARN[G.runDiff], t: 0, struck: false, pts: null };
    sfx.blip([1175, 880, 1175], 0.05, 0.05);
    if (navigator.vibrate) navigator.vibrate(30);
    return;
  }
  const b = G.bolt;
  b.t += dt;
  if (!b.struck && b.t >= b.warn) {
    b.struck = true;
    b.t = 0;
    // jagged path from the top of the screen down to the mark
    b.pts = [];
    for (let y = -8; y < curBY; y += 10) b.pts.push([b.x + (y < curBY - 10 ? Math.round((Math.random() * 2 - 1) * 6) : 0), y]);
    b.pts.push([b.x, curBY]);
    sfx.thunder();
    G.trauma = Math.min(1, G.trauma + 0.35);
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      emit(b.x, by, Math.cos(a) * 60, Math.sin(a) * 40 - 20, 0.45, k % 2 ? '#fff6b0' : '#bfe3ff', 1, 120);
    }
    const close = Math.abs(G.bx - b.x);
    if (close < BOLT_R * barrelScale() && !(G.fx.ghost > 0)) {
      if (G.fx.shield || G.hp > 1) {
        if (G.fx.shield) shieldSave('bolt', by);
        else takeHit('bolt', by);
        unlock('raio'); // struck by lightning and still going
      } else {
        G.hp = 0;
        refreshHp();
        die();
      }
    } else {
      if (close < BOLT_R + 14) {
        popText(tr('UFA!'), '');
        G.run.stormUfa++;
      }
      if (close >= BOLT_R * barrelScale() && ++G.run.bolts >= 5) unlock('tesla');
    }
  } else if (b.struck && b.t > 0.3) {
    G.bolt = null;
    G.boltWait = (G.runDiff === 2 ? 2 : 2.6) + Math.random() * 2.6;
  }
}

function drawStorm() {
  const b = G.bolt;
  if (!b || G.state !== 'playing') return;
  const cy = Math.round(curBY);
  const x = Math.round(b.x);
  if (!b.struck) {
    const k = b.t / b.warn; // 0 -> 1 as the strike nears
    const on = Math.floor(b.t * (4 + k * 14)) % 2 === 0;
    const col = on ? '#ffd23f' : '#ff3b3b';
    // faint column where it will fall
    ctx.fillStyle = 'rgba(255,240,160,0.18)';
    for (let y = (Math.floor(G.t * 40) % 6) - 6; y < cy - 14; y += 6) ctx.fillRect(x, y, 1, 3);
    // ring closing in on the mark
    const R = Math.round(lerp(18, BOLT_R, k));
    ctx.fillStyle = col;
    for (let a = 0; a < 32; a++) {
      const t = (a / 32) * Math.PI * 2;
      ctx.fillRect(x + Math.round(Math.cos(t) * R) - 1, cy + Math.round(Math.sin(t) * R * 0.6), 2, 2);
    }
    // crosshair
    ctx.fillRect(x - 3, cy, 7, 1);
    ctx.fillRect(x, cy - 3, 1, 7);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x - 3, cy + 1, 7, 1);
    return;
  }
  // the strike: a white flash fading out, then the bolt itself
  const fade = 1 - b.t / 0.3;
  ctx.fillStyle = `rgba(230,240,255,${0.45 * fade})`;
  ctx.fillRect(-8, -8, W + 16, H + 16);
  for (const [w, c] of [[3, '#ffd23f'], [1, '#ffffff']]) {
    ctx.fillStyle = c;
    for (let k = 1; k < b.pts.length; k++) {
      const [x0, y0] = b.pts[k - 1];
      const [x1, y1] = b.pts[k];
      for (let s = 0; s <= 10; s++) {
        const px = Math.round(lerp(x0, x1, s / 10));
        const py = Math.round(lerp(y0, y1, s / 10));
        ctx.fillRect(px - (w >> 1), py, w, 1);
      }
    }
  }
}

// Overlays for night, dawn/dusk, rain and the upside-down world (drawn over the river).
function drawAtmosphere(bx) {
  const playing = G.state === 'playing' || G.state === 'paused';
  const cx = Math.round(bx);
  const cy = Math.round(playing ? curBY : H * 0.45);
  const p = world.period;
  if (p === 'dawn' || p === 'dusk') {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = p === 'dawn' ? '#ffd8c0' : '#ffb890';
    ctx.fillRect(-8, -8, W + 16, H + 16);
    ctx.globalCompositeOperation = 'source-over';
  }
  if (save.upside) {
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = 'rgba(40,40,60,0.85)';
    ctx.fillRect(-8, -8, W + 16, H + 16);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = '#a898b8';
    ctx.fillRect(-8, -8, W + 16, H + 16);
    ctx.globalCompositeOperation = 'source-over';
    // floating spores drifting up
    for (let k = 0; k < 46; k++) {
      const x = (hash1(k * 7.3) * (W + 20) + Math.sin(G.t * 0.6 + k) * 6) % (W + 20) - 10;
      const y = H + 10 - ((hash1(k * 3.1) * (H + 20) + G.t * (6 + hash1(k) * 10)) % (H + 20));
      ctx.fillStyle = k % 3 ? 'rgba(220,220,230,0.55)' : 'rgba(255,180,180,0.5)';
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
    // red lightning now and then
    if ((G.upFlash -= 1 / 60) < 0) G.upFlash = 5 + Math.random() * 7;
    if (G.upFlash < 0.18) {
      ctx.fillStyle = `rgba(255,30,40,${0.25 * (G.upFlash / 0.18)})`;
      ctx.fillRect(-8, -8, W + 16, H + 16);
    }
  }
  if (p === 'night') {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = save.upside ? '#b0bce0' : '#8a98cc';
    ctx.fillRect(-8, -8, W + 16, H + 16);
    ctx.globalCompositeOperation = 'source-over';
    if (playing) {
      const lit = torch.on;
      const gr = ctx.createRadialGradient(cx, cy, lit ? 70 : 34, cx, cy, lit ? 200 : 110);
      gr.addColorStop(0, 'rgba(4,8,24,0)');
      gr.addColorStop(1, `rgba(4,8,24,${lit ? 0.2 : 0.6})`);
      ctx.fillStyle = gr;
      ctx.fillRect(-8, -8, W + 16, H + 16);
    }
  }
  if (!playing || !G.run) return;
  // a weather change fades the old sky out and the new one in
  const f = Math.min(1, G.wxFade);
  if (f < 1 && G.wxPrev !== 'clear') {
    ctx.globalAlpha = 1 - f;
    drawWeather(G.wxPrev, cy);
  }
  ctx.globalAlpha = f;
  drawWeather(G.run.weather, cy);
  ctx.globalAlpha = 1;
}

function drawWeather(wx, cy) {
  if (wx === 'rain' || wx === 'storm') {
    const storm = wx === 'storm';
    ctx.fillStyle = storm ? 'rgba(10,14,32,0.32)' : 'rgba(10,20,40,0.18)';
    ctx.fillRect(-8, -8, W + 16, H + 16);
    ctx.fillStyle = 'rgba(200,225,255,0.55)';
    for (let k = 0; k < (storm ? 110 : 70); k++) {
      const x = (hash1(k * 5.7) * (W + 40) - G.t * 40) % (W + 40);
      const y = (hash1(k * 9.1) * (H + 20) + G.t * (220 + hash1(k) * 80)) % (H + 20) - 10;
      const xx = Math.round(x < 0 ? x + W + 40 : x) - 20;
      ctx.fillRect(xx, Math.round(y), 1, 3);
      ctx.fillRect(xx - 1, Math.round(y) + 3, 1, 1);
    }
  }
  if (wx === 'snow') {
    ctx.fillStyle = 'rgba(230,240,255,0.2)';
    ctx.fillRect(-8, -8, W + 16, H + 16);
    for (let k = 0; k < 80; k++) {
      const x = (hash1(k * 4.3) * (W + 20) + Math.sin(G.t * 1.3 + k) * 5) % (W + 20) - 10;
      const y = (hash1(k * 8.7) * (H + 20) + G.t * (25 + hash1(k * 1.9) * 25)) % (H + 20) - 10;
      ctx.fillStyle = k % 4 ? '#ffffff' : '#d8e8ff';
      const s = k % 3 === 0 ? 2 : 1;
      ctx.fillRect(Math.round(x), Math.round(y), s, s);
    }
  }
  if (wx === 'fog') {
    // the river ahead (below the barrel) fades into the mist; it breathes thicker and thinner
    const dens = 0.78 + 0.17 * Math.sin(G.t * 0.45);
    ctx.fillStyle = 'rgba(215,225,235,0.12)';
    ctx.fillRect(-8, -8, W + 16, H + 16);
    const gr = ctx.createLinearGradient(0, cy + 22, 0, H);
    gr.addColorStop(0, 'rgba(215,225,235,0)');
    gr.addColorStop(0.55, `rgba(215,225,235,${0.7 * dens})`);
    gr.addColorStop(1, `rgba(215,225,235,${dens})`);
    ctx.fillStyle = gr;
    ctx.fillRect(-8, cy + 22, W + 16, H - cy);
    ctx.fillStyle = 'rgba(235,242,250,0.25)';
    for (let k = 0; k < 7; k++) {
      const y = Math.round((hash1(k * 6.1) * H + G.t * 6) % H);
      const x = Math.round(((hash1(k * 2.3) * W + G.t * (8 + k * 2)) % (W + 80)) - 60);
      ctx.fillRect(x, y, 40 + k * 4, 2);
    }
  }
  if (wx === 'mirage') {
    ctx.fillStyle = 'rgba(255,160,60,0.2)'; // hot, sun-baked light
    ctx.fillRect(-8, -8, W + 16, H + 16);
    // heat shimmer: thin bright lines wobbling across the river
    ctx.fillStyle = 'rgba(255,240,200,0.16)';
    for (let k = 0; k < 14; k++) {
      const y = Math.round((hash1(k * 3.7) * H + G.t * 12) % H);
      for (let x = 0; x < W; x += 6) ctx.fillRect(x, y + Math.round(Math.sin(G.t * 5 + x * 0.2 + k)), 4, 1);
    }
  }
}

// ---------- microphone: blow out the fire, yell with the crowd ----------
// Opt-in (AJUSTES). The stream is open only during a run.
const mic = { stream: null, ac: null, an: null, buf: null, level: 0, loudT: 0, yellT: 0, fake: -1 };
const micLive = () => !!mic.an || mic.fake >= 0;
async function micOpen() {
  if (mic.stream) return true;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
  mic.stream = stream;
  const AC = window.AudioContext || window.webkitAudioContext;
  mic.ac = new AC();
  const src = mic.ac.createMediaStreamSource(stream);
  mic.an = mic.ac.createAnalyser();
  mic.an.fftSize = 1024;
  mic.buf = new Float32Array(mic.an.fftSize);
  src.connect(mic.an);
  return true;
}
function micClose() {
  if (mic.stream) for (const t of mic.stream.getTracks()) t.stop();
  if (mic.ac) mic.ac.close().catch(() => {});
  mic.stream = mic.ac = mic.an = mic.buf = null;
  mic.level = mic.loudT = mic.yellT = 0;
}
function micStep(dt) {
  if (mic.fake >= 0) mic.level = mic.fake;
  else if (mic.an) {
    mic.an.getFloatTimeDomainData(mic.buf);
    let sum = 0;
    for (let k = 0; k < mic.buf.length; k++) sum += mic.buf[k] * mic.buf[k];
    mic.level = Math.sqrt(sum / mic.buf.length);
  } else return;
  mic.loudT = mic.level > 0.1 ? mic.loudT + dt : 0;
  mic.yellT = mic.level > 0.16 ? mic.yellT + dt : 0;
  if (G.cheerT >= 0 && mic.yellT >= 0.5) unlock('crowdyell');
}
async function setMic(on) {
  if (!on) {
    save.mic = false;
    micClose();
  } else {
    try {
      await micOpen(); // asks for permission now, not in the middle of a run
      save.mic = true;
      if (G.state !== 'playing') micClose();
      ui.micInfo.textContent = tr('SOPRE PRA APAGAR FOGO E GRITE COM A TORCIDA');
    } catch {
      save.mic = false;
      ui.micInfo.textContent = tr('SEM PERMISSÃO DO MICROFONE');
    }
  }
  writeSave(save);
  refreshToggles();
}

// Fire (power-down, only with the microphone on): blow before it burns through.
function fireStep(dt) {
  if (!(G.fx.fire > 0)) return;
  const by = G.cam + curBY;
  if (Math.random() < dt * 70) {
    const c = ['#ff3b1f', '#ff8a1c', '#ffd23f'][Math.floor(Math.random() * 3)];
    emit(G.bx + Math.random() * 14 - 7, by - 8, Math.random() * 20 - 10, G.speed - 50 - Math.random() * 40, 0.35, c, 1 + (Math.random() < 0.3 ? 1 : 0), 0);
  }
  if (mic.loudT >= 0.3) {
    delete G.fx.fire;
    mic.loudT = 0;
    show(ui.hint, false);
    popText(tr('APAGOU!'), '');
    sfx.splash();
    for (let k = 0; k < 14; k++) emit(G.bx + Math.random() * 12 - 6, by - 6, Math.random() * 30 - 15, G.speed - 20 - Math.random() * 40, 0.8, k % 2 ? '#5a5a5a' : '#8a8a8a', 2, -20);
    unlock('blowout');
    return;
  }
  if (G.fx.fire > dt) return;
  delete G.fx.fire;
  show(ui.hint, false);
  if (G.fx.shield) {
    delete G.fx.shield;
    G.fx.ghost = 1;
    popText(tr('O ESCUDO APAGOU!'), '');
    return;
  }
  if (G.hp > 1) {
    G.hp--;
    G.run.hits++;
    if (G.meters < 50) G.run.earlyHit = true;
    refreshHp();
    G.fx.ghost = 1;
    G.trauma = Math.min(1, G.trauma + 0.5);
    sfx.crash();
    popText(tr('QUEIMOU!'), 'bad');
  } else {
    G.hp = 0;
    refreshHp();
    die();
  }
}

// ---------- flashlight (native plugin) ----------
const torch = { ok: false, on: false, timer: 0 };
function torchInit() {
  if (!DEVICE_CAN.torch) return;
  window.Capacitor.nativePromise('CapacitorFlash', 'isAvailable', {})
    .then((r) => (torch.ok = !!(r && r.value)))
    .catch(() => {});
}
function torchSet(on) {
  if (!torch.ok || torch.on === on) return;
  torch.on = on;
  clearTimeout(torch.timer);
  window.Capacitor.nativePromise('CapacitorFlash', on ? 'switchOn' : 'switchOff', on ? { intensity: 1 } : {}).catch(() => (torch.on = false));
}
const torchWanted = () => torch.ok && G.state === 'playing' && (G.fx.fog > 0 || (world.period === 'night' && !torch.on));
function torchUse() {
  if (!torchWanted()) return;
  torchSet(true);
  sfx.blip([1047, 1568], 0.04, 0.05);
  if (G.fx.fog > 0) {
    delete G.fx.fog;
    popText(tr('FAROL ALTO!'), '');
    unlock('torchfog');
  }
  if (world.period === 'night') unlock('torchnight');
  else torch.timer = setTimeout(() => torchSet(false), 2500); // daytime: just a flash to clear the fog
}

// ---------- beta testers' gift ----------
function grantBeta() {
  if (DEMO || !BETA || (testGaps && params.has('nobeta'))) return;
  const keys = ['r:beta', 'b:beta'].filter((k) => !save.owned[k]);
  if (!keys.length) return;
  for (const k of keys) {
    save.owned[k] = true;
    diaryNote(k, 4);
  }
  writeSave(save);
  toastQueue.push({ head: tr('PRESENTE DE BETA TESTER!'), name: tr('BETA TESTER + BARRIL BETA'), sub: tr('VALEU POR TESTAR! ESTÃO NA LOJA.') });
  if (!toastTimer) nextToast();
}

// ---------- shop ----------
const wallet = () => save.coins;
const COIN_ICON = '<i class="coin" aria-hidden="true"></i>';
const shop = { tab: 'b', sel: 'classic', from: null };
const shopSkins = () => (shop.tab === 'b' ? BARREL_SKINS : RIDER_SKINS).filter((k) => !k.hidden || owns(shop.tab, k));
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

// Shop order: yours first, then what you can buy (cheapest first), then the achievement-only
// ones (easiest achievement first), and the beta gifts nobody can get any more at the end.
// Inside "yours" the same order holds, so the classic one leads.
const ACH_TIER = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a.tier]));
function shopOrder() {
  const list = shopSkins();
  const kind = (k) => (k.beta ? 4 : k.gems ? 2 : k.price === null ? 3 : 1);
  const group = (k) => (owns(shop.tab, k) ? 0 : kind(k));
  const value = (k) => (k.gems ? k.gems : k.price === null ? 10000 + (ACH_TIER[k.ach] || 9) * 1000 : k.price);
  return list
    .map((k, i) => ({ k, i }))
    .sort((x, y) => group(x.k) - group(y.k) || kind(x.k) - kind(y.k) || value(x.k) - value(y.k) || x.i - y.i)
    .map((x) => x.k);
}

// "Par:" line in the shop: a rider's matching barrel, or the riders a barrel matches.
function pairText(tab, skin) {
  if (tab === 'r') {
    const b = skin.pair && skin.pair !== 'classic' && BARREL_SKINS.find((k) => k.id === skin.pair);
    if (!b) return '';
    return pairKnown(skin.id) ? ` Par: ${b.name}.` : tr(' Par: ??? (é segredo: descubra combinando).');
  }
  if (skin.id === 'classic') return '';
  const rs = RIDER_SKINS.filter((k) => k.pair === skin.id);
  const known = rs.filter((k) => pairKnown(k.id)).map((k) => k.name);
  const secret = rs.length - known.length;
  const more = secret ? (secret > 1 ? trf(' + {0} pares secretos', secret) : tr(' + 1 par secreto')) : '';
  if (!known.length) return secret ? trf(' Par de: ???{0}.', more) : '';
  return trf(' Par de: {0}{1}{2}.', known.slice(0, 3).join(', '), known.length > 3 ? '...' : '', more);
}
function refreshShop() {
  show(ui.shopNfcBtn, DEVICE_CAN.nfc);
  ui.wallet.textContent = wallet();
  refreshGems();
  for (const [el, t] of [[ui.tabBarrel, 'b'], [ui.tabRider, 'r'], [ui.tabTune, 't']]) {
    el.classList.toggle('on', shop.tab === t);
    el.setAttribute('aria-selected', String(shop.tab === t));
  }
  const tune = shop.tab === 't';
  for (const el of [ui.shopTop, ui.shopList, ui.shopTip]) show(el, !tune);
  show(ui.tuneBody, tune);
  if (tune) return renderTune();
  const skin = shopSkins().find((k) => k.id === shop.sel);
  const have = owns(shop.tab, skin);
  const using = equippedId() === skin.id;
  const exclusive = skin.price === null && !skin.gems;
  const viaAch = exclusive ? ACHIEVEMENTS.find((a) => a.id === skin.ach) : null;
  ui.shopName.textContent = skin.name;
  // the pair goes on its own line (the diary is only in the DIÁRIO, to keep the shop clean)
  const pair = pairText(shop.tab, skin).trim();
  ui.shopDesc.textContent = (!have && viaAch ? trf('{0} Libera com a conquista {1}.', skin.desc, viaAch.name) : skin.desc) + (pair ? `\n${pair}` : '');
  const btn = ui.shopAction;
  btn.classList.remove('wait', 'using');
  if (using) {
    btn.textContent = tr('EM USO');
    btn.classList.add('using');
  } else if (have) btn.textContent = tr('USAR');
  else if (skin.beta) {
    btn.textContent = BETA ? tr('PRESENTE DE BETA') : tr('SÓ PRA BETA TESTERS');
    btn.classList.add('wait');
  } else if (exclusive) {
    btn.textContent = tr('EXCLUSIVO DE CONQUISTA');
    btn.classList.add('wait');
  } else if (skin.gems) {
    btn.innerHTML = save.gems >= skin.gems ? trf('COMPRAR: {0}{1}', GEM_ICON, skin.gems) : trf('FALTAM {0}{1}', GEM_ICON, skin.gems - save.gems);
    if (save.gems < skin.gems) btn.classList.add('wait');
  } else if (wallet() >= skin.price) btn.innerHTML = trf('COMPRAR: {0}{1}', COIN_ICON, skin.price);
  else {
    btn.innerHTML = trf('FALTAM {0}{1}', COIN_ICON, skin.price - wallet());
    btn.classList.add('wait');
  }
  drawShopPreview();

  ui.shopList.textContent = '';
  for (const k of shopOrder()) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    const mine = owns(shop.tab, k);
    const eq = equippedId() === k.id;
    b.className = `item${k.legend ? ' legend' : ''}${mine ? '' : ' locked'}${!mine && k.beta ? ' gone' : ''}${eq ? ' equipped' : ''}${k.id === shop.sel ? ' sel' : ''}`;
    b.dataset.id = k.id;
    const priceTxt = k.beta ? tr(', só pra beta testers') : k.gems ? trf(', {0} diamantes', k.gems) : k.price === null ? tr(', exclusivo de conquista') : trf(', {0} moedas', k.price);
    b.setAttribute('aria-label', `${k.name}${mine ? '' : priceTxt}${eq ? tr(', em uso') : ''}`);
    const cv = shop.tab === 'b' ? k.make() : makeRiderSkin(k, 0);
    cv.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    if (eq) label.textContent = tr('EM USO');
    else if (mine) label.textContent = tr('SUA');
    else if (k.beta) label.textContent = tr('BETA');
    else if (k.gems) label.innerHTML = `${GEM_ICON}${k.gems}`;
    else if (k.price === null) label.textContent = tr('TROFÉU');
    else label.innerHTML = `${COIN_ICON}${k.price}`;
    b.append(cv, label);
    li.append(b);
    ui.shopList.append(li);
  }
}

function openShop(from, tab, sel) {
  shop.from = from;
  if (tab) shop.tab = tab;
  shop.sel = sel || (shop.tab === 't' ? null : equippedId());
  show(from, false);
  show(ui.shop, true);
  refreshShop();
  ui.shopList.scrollTop = 0;
}
function closeShop() {
  show(ui.shop, false);
  refreshDaily();
  show(shop.from || ui.title, true);
  G.lockUntil = performance.now() + 300;
}
function setShopTab(tab) {
  shop.tab = tab;
  shop.sel = tab === 't' ? null : equippedId();
  refreshShop();
  ui.shopList.scrollTop = 0;
}

function shopAct() {
  const skin = shopSkins().find((k) => k.id === shop.sel);
  if (equippedId() === skin.id) return;
  if (!owns(shop.tab, skin)) {
    if (skin.gems) {
      if (!spendGems(skin.gems)) {
        sfx.blip([220, 180], 0.08, 0.05);
        openStore(ui.shop);
        return;
      }
    } else if (skin.price === null || wallet() < skin.price) {
      sfx.blip([220, 180], 0.08, 0.05);
      return;
    } else spendCoins(skin.price);
    save.owned[`${shop.tab}:${skin.id}`] = true;
    diaryNote(`${shop.tab}:${skin.id}`, 1);
    cloudSoon();
    sfx.blip([523, 659, 784, 1047, 1319], 0.06, 0.06);
    checkOwned();
  } else sfx.blip([880, 1175], 0.05, 0.05);
  if (shop.tab === 'b') save.barrel = skin.id;
  else save.rider = skin.id;
  applySkins();
  writeSave(save);
  refreshAchCount();
  refreshShop();
  // a purchase moves the skin up to "yours": keep it in view
  const sel = ui.shopList.querySelector('.sel');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
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
  G.pickups.length = 0;
  G.fx = {};
  G.cfg = DIFFS[save.diff];
  G.runDiff = save.diff;
  G.hp = G.maxHp = G.cfg.hp;
  refreshHp();
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
  sayReset();
  G.run.tuned = tunedRun();
  if (G.run.tuned) {
    G.hp = G.maxHp = G.cfg.hp + save.tune.hull;
    if (save.tune.shield) G.fx.shield = 1;
    G.run.shieldAt = [500, 1000].slice(0, Math.max(0, save.tune.shield - 1));
  }
  refreshHp();
  G.tut = tutWanted() ? { step: 0, queue: [] } : null;
  world.tutPeriod = null;
  refreshPeriod();
  G.run.weather = world.weatherOverride || 'clear'; // every run starts under a clear sky; weatherStep rolls later
  G.run.period = world.period;
  G.run.upside = save.upside;
  G.wind = 0;
  G.windT = 0;
  G.windDir = Math.random() < 0.5 ? -1 : 1;
  G.windFlip = 6 + Math.random() * 6;
  G.bolt = null;
  G.boltWait = 3 + Math.random() * 2;
  G.wxNext = G.tut ? Infinity : wxGap(); // the guided run brings its own weather
  G.wxPending = null;
  G.wxPrev = 'clear';
  G.wxFade = 1;
  G.wxFromM = 0;
  ui.wx.classList.remove('in');
  ensureDaily();
  G.run.chal = challenges().filter(chalEligible).map(chalId);
  G.run.daily = G.run.chal.includes('main0');
  endCheer();
}

function start() {
  if (!playable || G.state === 'playing' || G.state === 'revive' || !ui.store.hidden || !ui.redeem.hidden || !ui.lab.hidden || !ui.ach.hidden || !ui.shop.hidden || !ui.rank.hidden || !ui.settings.hidden || !ui.sum.hidden || !ui.chal.hidden || !ui.about.hidden || !ui.update.hidden || !ui.demoEnd.hidden) return;
  if (performance.now() < G.lockUntil) return;
  sfx.unlock();
  if (!pcMode && !tapMode) input.requestPermission(); // iOS prompt; must be called synchronously from the tap
  input.calibrate(G.fromAd ? 900 : 450);
  G.fromAd = false;
  resetRun();
  input.setTap(tapMode || G.runDiff === 0 || demoTap); // FÁCIL steers by touching the sides of the screen
  if (DEMO && isMobile && !demoTap) {
    // no tilt readings (no sensor, or the iPhone prompt was refused): the sides of the screen
    setTimeout(() => {
      if (G.state !== 'playing' || input.hasSensor) return;
      demoTap = true;
      input.setTap(true);
      refreshDemo();
      showHint(tr('TOQUE NOS LADOS<br>DA TELA PRA DESVIAR'));
    }, 1800);
  }
  G.state = 'playing';
  show(ui.diffNote, false);
  show(ui.title, false);
  show(ui.over, false);
  show(ui.pause, false);
  show(ui.hud, true);
  ui.score.textContent = '0 m';
  ui.best.textContent = trf('REC {0} m', save.best);
  ui.best.classList.remove('beat');
  showWeatherBadge();
  layoutFxHud();
  const how = input.tapOn ? tr('TOQUE À ESQUERDA<br>OU À DIREITA') : pcMode ? tr('USE ← → NO TECLADO') : tr('INCLINE O CELULAR');
  const dly = G.run.daily ? trf('<br><span class="hint-daily">DESAFIO: {0}</span>', dailyChallenge().text) : '';
  const wInfo = WEATHERS[G.run.weather];
  const env = [G.run.tuned && tr('TUNADO: FORA DO RANKING'), G.run.upside && tr('MUNDO INVERTIDO!'), G.run.period === 'night' && tr('NOITE'), wInfo && wInfo.tip].filter(Boolean);
  const envTxt = env.length ? `<br><span class="hint-env">${env.join(' · ')}</span>` : '';
  if (G.tut) showHint(trf('PRIMEIRA DESCIDA!<br>{0}<br>PRA DESVIAR DAS PEDRAS', how), 5, true);
  else showHint(`${G.runDiff === 2 ? trf('MORTE SÚBITA!<br>{0}', how) : how}${envTxt}${dly}`);
  if (save.mic) micOpen().catch(() => {});
  sfx.stopLose();
  sfx.startWater();
  sfx.startMusic();
  sfx.splash();
  requestWakeLock();
  checkClockBadges();
  checkHolidays();
  if (!navigator.onLine || airplaneOn) unlock('airplane');
  checkBattery();
  checkDarkMode();
  if (riderSkin.id === 'caramelo') unlock('caramelo');
  extrasRunStart();
  ui.hudCoins.textContent = '0';
  setTimeout(() => {
    if (G.state === 'playing' && !input.hasSensor && !pcMode && !input.tapOn) showHint(tr('SENSOR DE MOVIMENTO<br>NÃO ENCONTRADO'));
  }, 1200);
}

// steady: no blinking, for longer texts that need reading (the guided first run)
function showHint(html, secs = 3.5, steady = false) {
  ui.hint.innerHTML = html;
  ui.hint.classList.toggle('steady', steady);
  show(ui.hint, true);
  G.hintShown = true;
  G.hintHideAt = G.playT + secs;
}

function die() {
  G.state = 'dying';
  tutEnd(false);
  show(ui.say, false);
  extrasRunStop();
  G.deathT = 0;
  const now = performance.now();
  G.hitStopUntil = now + 120; // hit-stop: freeze the impact frame
  G.trauma = Math.min(1, G.trauma + 0.9);
  G.flash = reducedMotion ? 0 : 0.07; // single flash, well under 3/s
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
  setTimeout(checkUpdate, 1500); // a config that arrived mid-run shows now
  input.setTap(tapMode);
  torchSet(false);
  micClose();
  show(ui.torchBtn, false);
  const m = G.meters;
  achOnDeath(m);
  if (DEMO) return demoEnd(m);
  const rec = m > save.best;
  // tuned runs stay out of the ranking; after a SOBREVIDA it keeps the metres before the crash
  recordRun(G.run.tuned ? 0 : G.run.revived ? G.run.reviveFrom : m, G.runDiff, G.run.tuned ? 'tuned' : G.run.revived ? 'revived' : '');
  ad.runs++;
  if (save.steps) readSteps(false);
  loadInter();
  loadReward();
  const dg = dayGems();
  ui.overGems.innerHTML = dg ? trf('+{0}{1} {2}: PRIMEIRA DESCIDA DO DIA!', GEM_ICON, dg, dg === 1 ? tr('DIAMANTE') : tr('DIAMANTES')) : '';
  show(ui.overGems, dg > 0);
  G.lastRun = { m, rec, best: Math.max(m, save.best), diff: G.runDiff, diffName: DIFFS[G.runDiff].name, rider: riderSkin, barrel: barrelSkin, riderSpr: riderSprs[0], barrelSpr, card: null };
  G.runDiff = -1;
  prepareCard(G.lastRun);
  if (rec) {
    save.best = m;
    writeSave(save);
  }
  ui.overScore.textContent = `${m} m`;
  ui.overBest.textContent = save.best;
  ui.titleBest.textContent = save.best;
  show(ui.newRec, rec);
  const got = G.run.newAch.length;
  ui.overAch.textContent = got === 1 ? tr('+1 CONQUISTA NOVA!') : trf('+{0} CONQUISTAS NOVAS!', got);
  show(ui.overAch, got > 0);
  show(ui.sum, false);
  const dl = dailyAtEnd();
  ui.overDaily.innerHTML = dl;
  ui.overDaily.classList.toggle('done', G.run.dailyDone);
  show(ui.overDaily, !!dl);
  const gained = runCoins(G.run).total; // bubbles + badges + daily challenge (the summary breaks it down)
  ui.overCoins.innerHTML = trf('<span class="earn">+{0}{1} {2}</span><span class="bal">SALDO: {3}{4}</span>', COIN_ICON, gained, gained === 1 ? tr('MOEDA') : tr('MOEDAS'), COIN_ICON, save.coins);
  refreshAchCount();
  show(ui.hud, false);
  show(ui.over, true);
  G.lockUntil = performance.now() + 650; // avoid restarting with a stray tap
  if (rec) sfx.blip([523, 659, 784, 1047], 0.09);
  releaseWakeLock();
  cloudSoon(1500);
  if (canNotify() && save.notify && !save.notifAsked) setTimeout(askNotify, 1200);
  else scheduleReminders();
  sendInvite();
}

// ---------- DEMO: the end of the demo, with the store buttons ----------
function demoWin() {
  G.demoWon = true;
  tutEnd(false);
  show(ui.say, false);
  extrasRunStop();
  sfx.stopWater(0.5);
  sfx.stopMusic();
  endCheer();
  sfx.blip([523, 659, 784, 1047, 1319], 0.08, 0.07);
  for (let k = 0; k < 30; k++) emit(G.bx, G.cam + curBY, (Math.random() * 2 - 1) * 90, -40 - Math.random() * 80, 1, ['#ffd23f', '#3ddc5a', '#ff4d6d', '#3d8fe0'][k % 4], 2, 140);
  gameOver();
}
function demoEnd(m) {
  const won = !!G.demoWon;
  G.demoWon = false;
  G.runDiff = -1;
  if (m > save.best) {
    save.best = m;
    writeSave(save);
  }
  ui.titleBest.textContent = save.best;
  ui.demoEndTitle.textContent = won ? trf('VOCÊ CHEGOU AOS {0} m!', DEMO_M) : tr('O BARRIL QUEBROU!');
  ui.demoEndText.textContent = won
    ? tr('A DEMO ACABA AQUI. NO JOGO COMPLETO A CACHOEIRA NÃO TEM FIM: MAIS DE 150 PILOTOS E BARRIS, DESAFIOS TODO DIA, CLIMA, CONQUISTAS E RANKING.')
    : trf('VOCÊ DESCEU {0} m. NA DEMO DÁ PRA IR ATÉ {1} m. TENTA DE NOVO OU BAIXA O JOGO COMPLETO!', m, DEMO_M);
  show(ui.hud, false);
  show(ui.demoEnd, true);
  G.lockUntil = performance.now() + 650;
  releaseWakeLock();
}
// the title in the demo: what it is, and the control (tilt or the sides of the screen) on a phone
function refreshDemo() {
  if (!DEMO) return;
  ui.demoNote.innerHTML = isMobile
    ? trf('DEMO: DESÇA ATÉ {0} m<br>{1}', DEMO_M, demoTap ? tr('TOQUE NOS LADOS DA TELA PRA DESVIAR') : tr('INCLINE O CELULAR PRA DESVIAR'))
    : trf('DEMO: DESÇA ATÉ {0} m<br>{1}', DEMO_M, tr('USE AS SETAS DO TECLADO OU CLIQUE NOS LADOS DA TELA'));
  ui.demoCtl.textContent = demoTap ? tr('CONTROLE: TOQUE') : tr('CONTROLE: INCLINAR');
  show(ui.demoCtl, isMobile);
}

// ---------- ranking (Firebase Auth + Firestore over REST: no SDK, the game stays one script) ----------
const FB = {
  key: '',
  project: 'cataratas-no-barril',
  webClientId: '79208843725-pk0v59vdvgbtrhhr1tj6jdk7sethtp6s.apps.googleusercontent.com', // OAuth "Web client" of the project (Google sign-in)
};
const RANK_W = [0.5, 1, 1.5]; // points per metre on FÁCIL / NORMAL / DIFÍCIL
const MODE_FIELD = ['easy', 'normal', 'hard'];
// SEMANA: weeks turn on Monday 00:00 in Brasília (UTC-3); week 0 started on 2024-01-01.
// firestore.rules computes the same number from the server time.
const WEEK0 = Date.UTC(2024, 0, 1, 3);
const WEEK_MS = 7 * 864e5;
const weekNo = (t = now()) => Math.floor((t.getTime() - WEEK0) / WEEK_MS);
const WEEK_PRIZE = [[1, 10], [3, 6], [10, 3]]; // [up to position, diamonds] for last week's board
const RANK_BOARDS = [
  { id: 'wbest', tab: tr('SEMANA'), unit: tr('PTS'), week: true, note: tr('MELHOR DESCIDA DESTA SEMANA, EM PONTOS<br>ZERA TODA SEGUNDA · TOP 10 GANHA DIAMANTES') },
  { id: 'best', tab: tr('GERAL'), unit: tr('PTS'), note: tr('MELHOR DESCIDA EM PONTOS<br>METROS × FÁCIL 0,5 · NORMAL 1 · DIFÍCIL 1,5') },
  { id: 'total', tab: tr('TOTAL'), unit: tr('PTS'), note: tr('SOMA DE TODAS AS DESCIDAS<br>METROS × FÁCIL 0,5 · NORMAL 1 · DIFÍCIL 1,5') },
  { id: 'easy', tab: tr('FÁCIL'), unit: 'm', note: tr('MELHOR DESCIDA NO FÁCIL, EM METROS') },
  { id: 'normal', tab: tr('NORMAL'), unit: 'm', note: tr('MELHOR DESCIDA NO NORMAL, EM METROS') },
  { id: 'hard', tab: tr('DIFÍCIL'), unit: 'm', note: tr('MELHOR DESCIDA NO DIFÍCIL, EM METROS') },
];
const DB = `projects/${FB.project}/databases/(default)/documents`;
const FS = `https://firestore.googleapis.com/v1/${DB}`;
const IDT = (path) => `https://identitytoolkit.googleapis.com/v1/${path}?key=${FB.key}`;
const AUTH_KEY = 'cataratas.auth';
const NAME_RE = /^[A-Z0-9ÀÁÂÃÇÉÊÍÓÔÕÚÜ ._-]{3,12}$/;
const fsInt = (n) => ({ integerValue: String(Math.floor(n)) });
// The ranking only shows accounts linked to Google: anonymous ones cost nothing to make, so they'd
// let anyone flood the board. firestore.rules checks "google" against the sign-in token and only
// lets queries that ask for google == true read other players.
const ONLY_GOOGLE = { fieldFilter: { field: { fieldPath: 'google' }, op: 'EQUAL', value: { booleanValue: true } } };
const json = (body, token) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});

// ---- App Check: tells Firebase the call comes from the real app (Play Integrity) ----
// The native plugin (AppCheckPlugin.java) gets the token from the Firebase SDK and every Firestore /
// Auth call carries it in X-Firebase-AppCheck. In the browser (npm run dev) there's none, unless a
// debug token registered in the console (App Check → Cataratas Web) is in localStorage
// "cataratas.appcheck.debug". A call without a token still goes out: until App Check is enforced in
// the console, Firebase takes it (and counts it as unverified).
const APPCHECK_WEB_APP = '1:79208843725:web:dadfedacbd0b658d821c84';
const appCheck = { token: '', exp: 0, busy: null };
function appCheckToken() {
  if (Date.now() < appCheck.exp) return Promise.resolve(appCheck.token);
  if (!appCheck.busy) appCheck.busy = loadAppCheck().finally(() => (appCheck.busy = null));
  return appCheck.busy;
}
async function loadAppCheck() {
  let t = null;
  try {
    const get = async () => {
      if (NATIVE_ANDROID) return window.Capacitor.nativePromise('CataratasAppCheck', 'token', {});
      const debug = localStorage.getItem('cataratas.appcheck.debug');
      if (!debug) return null;
      const url = `https://firebaseappcheck.googleapis.com/v1/projects/${FB.project}/apps/${APPCHECK_WEB_APP}:exchangeDebugToken?key=${FB.key}`;
      const j = await api(url, json({ debugToken: debug }), false);
      return { token: j.token, exp: Date.now() + parseInt(j.ttl, 10) * 1000 };
    };
    // Play Integrity can be slow on the first call: don't hold the game's calls for long
    t = await Promise.race([get(), new Promise((ok) => setTimeout(() => ok(null), 6000))]);
  } catch {
    t = null; // no Play services, sideloaded app, offline...
  }
  if (t && t.token) Object.assign(appCheck, { token: t.token, exp: Math.min(t.exp, Date.now() + 3600e3) - 5 * 60e3 });
  else Object.assign(appCheck, { token: '', exp: Date.now() + 60e3 }); // try again in a minute
  return appCheck.token;
}
// fetch for Firebase: adds the App Check token when there is one.
async function fbFetch(url, opts = {}) {
  if (DEMO) throw new Error('demo: offline');
  const tok = await appCheckToken();
  return fetch(url, tok ? { ...opts, headers: { ...(opts.headers || {}), 'X-Firebase-AppCheck': tok } } : opts);
}

async function api(url, opts, check = true) {
  if (DEMO) throw new Error('demo: offline');
  const res = await (check ? fbFetch : fetch)(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data.error && data.error.message) || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Firebase session: { uid, idToken, refreshToken, exp, email } (email: '' while anonymous).
let auth = null;
try {
  auth = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
} catch {
  auth = null;
}
function setSession(j) {
  auth = {
    uid: j.localId || j.user_id,
    idToken: j.idToken || j.id_token,
    refreshToken: j.refreshToken || j.refresh_token,
    exp: Date.now() + (Number(j.expiresIn || j.expires_in || 3600) - 120) * 1000,
    email: j.email !== undefined ? j.email : (auth && auth.email) || '',
  };
  try {
    localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  } catch {
    /* no storage: the session lasts until the app closes */
  }
}
async function idToken() {
  if (!auth) setSession(await api(IDT('accounts:signUp'), json({ returnSecureToken: true })));
  else if (Date.now() > auth.exp) {
    const j = await api(`https://securetoken.googleapis.com/v1/token?key=${FB.key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(auth.refreshToken)}`,
    });
    setSession(j);
  }
  return auth.idToken;
}

function fromDoc(doc) {
  const out = { id: doc.name.split('/').pop() };
  for (const [k, v] of Object.entries(doc.fields || {})) {
    if ('integerValue' in v) out[k] = Number(v.integerValue);
    else if ('stringValue' in v) out[k] = v.stringValue;
    else if ('booleanValue' in v) out[k] = v.booleanValue;
  }
  return out;
}

function cleanName(raw) {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9ÀÁÂÃÇÉÊÍÓÔÕÚÜ ._-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12);
}

// Adds a finished run to the local totals and sends them when the player has a name.
function recordRun(m, diff, why = '') {
  show(ui.overRank, false);
  if (why === 'tuned') {
    ui.overRank.textContent = tr('DESCIDA TUNADA: NÃO VALE PRO RANKING');
    show(ui.overRank, true);
  }
  if (m <= 0 || diff < 0) return;
  const r = save.rank;
  const pts = Math.round(m * RANK_W[diff]);
  r.best = Math.max(r.best, pts);
  r.total += pts;
  r[MODE_FIELD[diff]] = Math.max(r[MODE_FIELD[diff]], m);
  mergeWeek(r, weekNo(), pts);
  r.runs++;
  r.dirty = true;
  writeSave(save);
  const pre = why === 'revived' ? trf('RANKING: {0} m (ATÉ A SOBREVIDA) · ', m) : '';
  if (!flagOn('ranking')) {
    // switched off (npm run flags): the run stays on the phone (dirty) and goes up later
    ui.overRank.textContent = pre + tr('RANKING EM MANUTENÇÃO: SUA DESCIDA SOBE DEPOIS');
    show(ui.overRank, true);
    return;
  }
  ui.overRank.textContent = pre + (!r.name ? tr('DÊ UM APELIDO E VINCULE O GOOGLE PRA APARECER NO RANKING') : cloudOn() ? tr('ENVIANDO PRO RANKING...') : tr('VINCULE O GOOGLE PRA APARECER NO RANKING'));
  show(ui.overRank, true);
  if (r.name && !cloudOn()) {
    // anonymous: not on the board, but show where this run would be
    myPosition('best', r.best)
      .then((pos) => {
        ui.overRank.textContent = trf('{0}SERIA #{1} NO RANKING · VINCULE O GOOGLE PRA ENTRAR', pre, pos);
      })
      .catch(() => {});
  } else if (r.name) {
    syncRank()
      .then(() => checkWeekPrize())
      .then(() => myPosition('best', r.best))
      .then((pos) => {
        ui.overRank.textContent = trf('{0}#{1} NO RANKING GERAL', pre, pos);
      })
      .catch(() => {
        ui.overRank.textContent = trf('{0}SEM CONEXÃO: O RANKING ATUALIZA DEPOIS', pre);
      });
  }
}

// Sends the local totals (merged with what the server already has for this account).
let syncing = null;
function syncRank() {
  if (!syncing) syncing = pushRank().finally(() => (syncing = null));
  return syncing;
}
async function pushRank() {
  const r = save.rank;
  // anonymous accounts stay off the board: their records wait on the phone (dirty) and go up
  // when Google is linked
  if (!r.name || !r.dirty || !cloudOn() || !flagOn('ranking')) return;
  const token = await idToken();
  try {
    const mine = fromDoc(await api(`${FS}/players/${auth.uid}`, { headers: { Authorization: `Bearer ${token}` } }));
    for (const k of ['best', 'total', 'easy', 'normal', 'hard', 'runs']) r[k] = Math.max(r[k], mine[k] || 0);
    mergeWeek(r, mine.pweek, mine.pwbest);
    mergeWeek(r, mine.week, mine.wbest);
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  r.total = Math.max(r.total, r.best);
  const fields = { name: { stringValue: r.name }, google: { booleanValue: !!auth.email } };
  for (const k of ['best', 'total', 'easy', 'normal', 'hard', 'runs']) fields[k] = fsInt(r[k]);
  // SEMANA: this week's score (or last week's, right at the turn) and last week's, for the
  // prize; older ones are dropped
  const wk = weekNo();
  if (r.wbest > 0 && r.week >= wk - 1) Object.assign(fields, { week: fsInt(r.week), wbest: fsInt(Math.min(r.wbest, r.best)) });
  if (r.pwbest > 0 && r.pweek === wk - 1 && r.week === wk) Object.assign(fields, { pweek: fsInt(r.pweek), pwbest: fsInt(Math.min(r.pwbest, r.best)) });
  const send = (f) =>
    api(`${FS}:commit`, json({ writes: [{ update: { name: `${DB}/players/${auth.uid}`, fields: f }, updateTransforms: [{ fieldPath: 'updated', setToServerValue: 'REQUEST_TIME' }] }] }, token));
  try {
    await send(fields);
  } catch (e) {
    // rules from before SEMANA (or a clock off at the turn of the week): send without it
    if (e.status !== 403 || !fields.week) throw e;
    for (const k of ['week', 'wbest', 'pweek', 'pwbest']) delete fields[k];
    await send(fields);
  }
  r.dirty = false;
  writeSave(save);
  unlock('ranked');
}

// ---- cloud save: progress backed up to saves/{uid} while the account is linked to Google ----
// Local first: the game always plays from the phone's save (it must work offline). With Google
// linked, every sync pulls the cloud copy, merges it in and pushes the result back. The merge
// only ever grows things (union of badges and skins, highest counters, per-install coin
// ledgers), so syncing twice, or from two phones, never loses or doubles anything.
const CLOUD_MAX = ['best', 'runs', 'totalM', 'grazes', 'bubbles', 'tightTotal', 'repairs', 'coinsTotal', 'dailyCount', 'miniCount', 'shares', 'invitesOk', 'invitesNew'];
const CLOUD_SETS = ['ach', 'owned', 'powers', 'shareApps', 'pairs', 'iap', 'codes', 'nfc'];
const RANK_NUM = ['best', 'total', 'easy', 'normal', 'hard', 'runs'];
// SEMANA: a best run only counts in the week it was made. When a newer week comes in, the old
// one moves to pweek/pwbest (kept for last week's prize). Returns true when something changed.
function mergeWeek(rk, week, wbest) {
  if (!(week >= 0)) return false;
  let changed = false;
  if (week > rk.week) {
    if (rk.week >= 0 && rk.wbest > 0) Object.assign(rk, { pweek: rk.week, pwbest: rk.wbest });
    Object.assign(rk, { week, wbest: 0 });
    changed = true;
  }
  if (week === rk.week && wbest > rk.wbest) {
    rk.wbest = wbest;
    changed = true;
  } else if (week === rk.pweek && wbest > rk.pwbest) {
    rk.pwbest = wbest;
    changed = true;
  }
  return changed;
}
const cloudOn = () => !!(auth && auth.email);

function cloudPayload() {
  const p = { v: VERSION, ledger: save.ledger, daily: save.daily, weekendSat: save.weekendSat, weekendSun: save.weekendSun, wkKey: save.wkKey, wkDone: save.wkDone, invitedBy: save.invitedBy, inviteFresh: save.inviteFresh, gemDay: save.gemDay, gemGoogle: save.gemGoogle, tune: save.tune, noAds: save.noAds, weekPrize: save.weekPrize };
  for (const k of CLOUD_MAX) p[k] = save[k];
  for (const k of CLOUD_SETS) p[k] = save[k];
  p.paid = save.paid;
  p.diary = save.diary;
  p.rank = { name: save.rank.name };
  for (const k of RANK_NUM) p.rank[k] = save.rank[k];
  for (const k of ['week', 'wbest', 'pweek', 'pwbest']) p.rank[k] = save.rank[k];
  return p;
}

// Merges a cloud copy into the local save. Settings, the equipped skins and this phone's
// streaks stay local. Returns true when something new came in.
function mergeSave(raw) {
  const r = migrate(raw, defaults(false)); // same validation as a local save
  const before = JSON.stringify(cloudPayload());
  for (const k of CLOUD_MAX) save[k] = Math.max(save[k], r[k]);
  for (const k of CLOUD_SETS) Object.assign(save[k], r[k]);
  // the same badge paid on two installs: the old-rules payment (true) wins, else the larger one
  for (const [id, v] of Object.entries(r.paid)) {
    const mine = save.paid[id];
    if (mine === undefined || v === true || (mine !== true && v > mine)) save.paid[id] = v;
  }
  for (const [id, l] of Object.entries(r.ledger)) {
    const mine = save.ledger[id];
    if (!mine) save.ledger[id] = { e: l.e, s: l.s, g: l.g, gs: l.gs };
    else {
      mine.e = Math.max(mine.e, l.e);
      mine.s = Math.max(mine.s, l.s);
      mine.g = Math.max(mine.g || 0, l.g);
      mine.gs = Math.max(mine.gs || 0, l.gs);
    }
  }
  // the diary keeps the first time anything was earned, on any phone
  for (const [k, e] of Object.entries(r.diary)) if (!save.diary[k] || e[0] < save.diary[k][0]) save.diary[k] = e;
  // bought upgrades and purchases never go away; the day bonus is paid once per day on any phone
  for (const t of TUNE_IDS) save.tune[t] = Math.max(save.tune[t], r.tune[t]);
  save.noAds = save.noAds || r.noAds;
  save.gemGoogle = save.gemGoogle || r.gemGoogle;
  if (r.gemDay > save.gemDay) save.gemDay = r.gemDay;
  save.weekendSat = save.weekendSat || r.weekendSat;
  save.weekendSun = save.weekendSun || r.weekendSun;
  if (r.daily.key > save.daily.key) save.daily = JSON.parse(JSON.stringify(r.daily));
  else if (r.daily.key === save.daily.key) {
    const both = (a, b) => {
      a.done = a.done || b.done;
      a.prog = Math.max(a.prog, b.prog);
    };
    both(save.daily, r.daily);
    save.daily.mini.forEach((x, i) => r.daily.mini[i] && both(x, r.daily.mini[i]));
    save.daily.wk.forEach((x, i) => r.daily.wk[i] && both(x, r.daily.wk[i]));
    save.daily.extra.forEach((x, i) => r.daily.extra[i] && both(x, r.daily.extra[i]));
  }
  if (!save.invitedBy && r.invitedBy) {
    save.invitedBy = r.invitedBy; // invited once per player, also across installs
    save.inviteFresh = r.inviteFresh;
  }
  if (r.wkKey > save.wkKey) {
    save.wkKey = r.wkKey;
    save.wkDone = r.wkDone;
  } else if (r.wkKey === save.wkKey) save.wkDone = Math.max(save.wkDone, r.wkDone);
  const rk = save.rank;
  // a fresh install that signs in gets its old nickname back
  if (r.rank.name && (!rk.name || rk.runs < r.rank.runs)) rk.name = r.rank.name;
  for (const k of RANK_NUM) {
    if (r.rank[k] > rk[k]) {
      rk[k] = r.rank[k];
      rk.dirty = true;
    }
  }
  if (mergeWeek(rk, r.rank.pweek, r.rank.pwbest)) rk.dirty = true;
  if (mergeWeek(rk, r.rank.week, r.rank.wbest)) rk.dirty = true;
  if (r.weekPrize > save.weekPrize) save.weekPrize = r.weekPrize;
  applyCreatures();
  recalcCoins();
  const changed = JSON.stringify(cloudPayload()) !== before;
  if (changed) {
    checkOwned();
    checkWallet();
    applySkins();
    writeSave(save);
    ui.titleBest.textContent = save.best;
    refreshAchCount();
    refreshRankTile();
    refreshDaily();
    if (!ui.shop.hidden) refreshShop();
  }
  return changed;
}

let cloudBusy = null;
let cloudTimer = 0;
function cloudSync() {
  if (!cloudOn()) return Promise.resolve(false);
  if (!cloudBusy) cloudBusy = cloudPullPush().finally(() => (cloudBusy = null));
  return cloudBusy;
}
async function cloudPullPush() {
  const token = await idToken();
  const url = `${FS}/saves/${auth.uid}`;
  let changed = false;
  let doc = null;
  try {
    doc = fromDoc(await api(url, { headers: { Authorization: `Bearer ${token}` } }));
  } catch (e) {
    if (e.status !== 404) throw e; // 404: first backup of this account
  }
  if (doc) {
    let raw = null;
    try {
      raw = JSON.parse(doc.data);
    } catch {
      raw = null; // unreadable copy: the push below replaces it
    }
    if (raw) changed = mergeSave(raw);
  }
  cloudDirty = false;
  await api(
    `${FS}:commit`,
    json(
      {
        writes: [
          {
            update: { name: `${DB}/saves/${auth.uid}`, fields: { data: { stringValue: JSON.stringify(cloudPayload()) } } },
            updateTransforms: [{ fieldPath: 'updated', setToServerValue: 'REQUEST_TIME' }],
          },
        ],
      },
      token,
    ),
  ).catch((e) => {
    cloudDirty = true;
    throw e;
  });
  if (save.rank.dirty && save.rank.name) syncRank().catch(() => {});
  return changed;
}
// Backup a little later (batches a burst of changes into one write).
function cloudSoon(ms = 3000) {
  if (!cloudOn()) return;
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => cloudSync().catch(() => (cloudDirty = true)), ms);
}

// The filter of a board: Google accounts only (firestore.rules hides anonymous entries), its field
// above `value`, and on SEMANA only that week's entries. Each one has an index in
// firestore.indexes.json.
function boardWhere(field, value, week) {
  const filters = [ONLY_GOOGLE];
  if (field === 'wbest' || field === 'pwbest') {
    filters.push({ fieldFilter: { field: { fieldPath: field === 'wbest' ? 'week' : 'pweek' }, op: 'EQUAL', value: fsInt(week ?? weekNo()) } });
  }
  filters.push({ fieldFilter: { field: { fieldPath: field }, op: 'GREATER_THAN', value: fsInt(value) } });
  return { compositeFilter: { op: 'AND', filters } };
}
async function fetchBoard(field, week) {
  const rows = await api(
    `${FS}:runQuery?key=${FB.key}`,
    json({
      structuredQuery: {
        from: [{ collectionId: 'players' }],
        where: boardWhere(field, 0, week),
        orderBy: [{ field: { fieldPath: field }, direction: 'DESCENDING' }],
        limit: 50,
      },
    }),
  );
  return rows.filter((x) => x.document).map((x) => fromDoc(x.document));
}

async function myPosition(field, value, week) {
  const res = await api(
    `${FS}:runAggregationQuery?key=${FB.key}`,
    json({
      structuredAggregationQuery: {
        structuredQuery: {
          from: [{ collectionId: 'players' }],
          where: boardWhere(field, value, week),
          // same order as the board, so the count uses its index (google, …, field DESC)
          orderBy: [{ field: { fieldPath: field }, direction: 'DESCENDING' }],
        },
        aggregations: [{ alias: 'n', count: {} }],
      },
    }),
  );
  const pos = Number(res[0].result.aggregateFields.n.integerValue) + 1;
  // anonymous: the place this score would have (Google players above it + 1); not kept
  if (field === 'best' && cloudOn()) {
    save.rank.pos = pos;
    writeSave(save);
    refreshRankTile();
    if (pos <= 10) unlock('top10');
  }
  return pos;
}

// SEMANA prize: the first time the ranking is opened (or a run ends online) in a new week, the
// player's place on last week's board is looked up once; the top 10 get diamonds.
let prizeBusy = false;
async function checkWeekPrize() {
  const last = weekNo() - 1;
  const r = save.rank;
  if (prizeBusy || !r.name || !cloudOn() || !flagOn('ranking') || !flagOn('semana') || save.weekPrize >= last || !clock.verified) return;
  const score = r.week === last ? r.wbest : r.pweek === last ? r.pwbest : 0;
  if (!(score > 0)) {
    if (r.week >= last) save.weekPrize = last; // didn't play last week: nothing to check
    return;
  }
  prizeBusy = true;
  try {
    await syncRank(); // our own entry first, so it's on the board being counted
    // last week's entries sit in week/wbest (didn't play since) or pweek/pwbest (played this week)
    const pos = (await myPosition('wbest', score, last)) + (await myPosition('pwbest', score, last)) - 1;
    save.weekPrize = last;
    const prize = WEEK_PRIZE.find(([upTo]) => pos <= upTo);
    if (prize) {
      addGems(prize[1]);
      toastQueue.push({ head: tr('RANKING DA SEMANA!'), name: trf('VOCÊ FICOU EM #{0}', pos), sub: trf('+{0} DIAMANTES', prize[1]) });
      if (!toastTimer) nextToast();
    }
    writeSave(save);
  } catch {
    /* offline: try again later */
  } finally {
    prizeBusy = false;
  }
}

// ---- Google: links the anonymous account, so the ranking entry survives a new phone ----
const GOOGLE_STATE = 'cataratas.google';
async function googleSignIn() {
  if (!FB.webClientId) throw new Error('google not configured');
  const cap = window.Capacitor;
  if (cap && typeof cap.nativePromise === 'function') {
    await cap.nativePromise('SocialLogin', 'initialize', { google: { webClientId: FB.webClientId } });
    // no extra scopes: the ID token already carries the e-mail (scopes would need a MainActivity change)
    const res = await cap.nativePromise('SocialLogin', 'login', { provider: 'google', options: {} });
    return linkGoogle(res.result.idToken);
  }
  // browser: OpenID implicit flow, back to this page with #id_token=...
  const nonce = Math.random().toString(36).slice(2);
  try {
    sessionStorage.setItem(GOOGLE_STATE, nonce);
  } catch {
    /* the nonce check is skipped below when storage is off */
  }
  const back = location.origin + location.pathname;
  location.href =
    'https://accounts.google.com/o/oauth2/v2/auth' +
    `?client_id=${encodeURIComponent(FB.webClientId)}&redirect_uri=${encodeURIComponent(back)}` +
    `&response_type=id_token&scope=${encodeURIComponent('openid email profile')}&nonce=${nonce}&state=${nonce}&prompt=select_account`;
  return new Promise(() => {}); // the page navigates away
}

async function linkGoogle(googleToken) {
  const body = { postBody: `id_token=${googleToken}&providerId=google.com`, requestUri: 'http://localhost', returnSecureToken: true };
  const token = await idToken();
  try {
    setSession(await api(IDT('accounts:signInWithIdp'), json({ ...body, idToken: token })));
  } catch (e) {
    if (!/FEDERATED_USER_ID_ALREADY_LINKED|CREDENTIAL_ALREADY_IN_USE/.test(e.message)) throw e;
    // this Google account already has a player (another phone): switch to it and drop the
    // anonymous entry, keeping the best of both
    const old = { uid: auth.uid, token };
    setSession(await api(IDT('accounts:signInWithIdp'), json(body)));
    await fbFetch(`${FS}/players/${old.uid}`, { method: 'DELETE', headers: { Authorization: `Bearer ${old.token}` } }).catch(() => {});
  }
  save.rank.dirty = true;
  writeSave(save);
  await syncRank();
  // bring in (and back up) the progress saved under this Google account
  if (await cloudSync().catch(() => false)) {
    toastQueue.push({ head: tr('PROGRESSO RECUPERADO!'), name: tr('MOEDAS, SKINS E CONQUISTAS'), sub: '' });
    if (!toastTimer) nextToast();
  }
  if (!save.gemGoogle) {
    save.gemGoogle = true;
    addGems(GOOGLE_GEMS);
    writeSave(save);
    cloudSoon();
    gemToast(GOOGLE_GEMS, tr('CONTA VINCULADA!'), tr('PRESENTE DO BANCO'));
  }
}

// Back from the Google page in the browser.
function finishGoogleRedirect() {
  if (!location.hash.includes('id_token=')) return;
  const p = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
  let expected = null;
  try {
    expected = sessionStorage.getItem(GOOGLE_STATE);
    sessionStorage.removeItem(GOOGLE_STATE);
  } catch {
    /* storage off */
  }
  if (expected && p.get('state') !== expected) return;
  linkGoogle(p.get('id_token'))
    .then(() => popText(tr('GOOGLE VINCULADO!'), ''))
    .catch(() => popText(tr('NÃO DEU PRA ENTRAR'), 'bad'));
}

// ---- ranking screen ----
const rankView = { board: 'best', from: null, seq: 0 };
function refreshRankTile() {
  const on = save.rank.name && cloudOn();
  ui.rankPos.textContent = on && save.rank.pos ? `#${save.rank.pos}` : on ? '---' : tr('ENTRAR');
}
function renderRankPlayer() {
  const r = save.rank;
  if (document.activeElement !== ui.nameInput) ui.nameInput.value = r.name;
  const linked = !!(auth && auth.email);
  ui.googleBtn.hidden = linked || !FB.webClientId || !r.name || !flagOn('google');
  ui.googleInfo.textContent = linked
    ? trf('CONTA GOOGLE: {0}\nPROGRESSO SALVO NA NUVEM', auth.email)
    : r.name
      ? tr('SÓ CONTAS GOOGLE APARECEM NO RANKING. VINCULE PRA ENTRAR E NÃO PERDER MOEDAS, SKINS E CONQUISTAS')
      : tr('ESCOLHA UM APELIDO PRA ENTRAR NO RANKING');
  show(ui.rankDelete, !!(auth || r.name));
}

// Account deletion (Google Play rule for apps with accounts): removes the player's ranking doc and
// the Firebase account. The local save (records, coins, skins) stays on the phone.
let deleteArmed = 0;
async function deleteRankData() {
  if (Date.now() > deleteArmed) {
    deleteArmed = Date.now() + 4000;
    ui.rankDelete.textContent = tr('TOQUE DE NOVO PRA CONFIRMAR');
    setTimeout(() => {
      if (Date.now() > deleteArmed) ui.rankDelete.textContent = tr('APAGAR MEUS DADOS DO RANKING');
    }, 4100);
    return;
  }
  deleteArmed = 0;
  ui.rankDelete.disabled = true;
  ui.rankDelete.textContent = tr('APAGANDO...');
  try {
    if (auth) {
      const token = await idToken();
      const res = await fbFetch(`${FS}/players/${auth.uid}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
      const sv = await fbFetch(`${FS}/saves/${auth.uid}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (!sv.ok && sv.status !== 404) throw new Error(`HTTP ${sv.status}`);
      const inv = await fbFetch(`${FS}/invites/${auth.uid}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (!inv.ok && inv.status !== 404) throw new Error(`HTTP ${inv.status}`);
      await api(IDT('accounts:delete'), json({ idToken: token }));
    }
    const cap = window.Capacitor;
    if (cap && cap.isNativePlatform && cap.isNativePlatform()) cap.nativePromise('SocialLogin', 'logout', { provider: 'google' }).catch(() => {});
    auth = null;
    try {
      localStorage.removeItem(AUTH_KEY);
    } catch {
      /* nothing stored */
    }
    Object.assign(save.rank, { name: '', pos: 0, dirty: false });
    writeSave(save);
    refreshRankTile();
    ui.rankDelete.textContent = tr('APAGAR MEUS DADOS DO RANKING');
    ui.googleInfo.textContent = tr('DADOS DO RANKING APAGADOS');
    renderRank().then(() => (ui.googleInfo.textContent = tr('DADOS DO RANKING APAGADOS')));
  } catch {
    ui.rankDelete.textContent = tr('NÃO DEU. TENTE COM INTERNET');
  } finally {
    ui.rankDelete.disabled = false;
  }
}
async function renderRank() {
  const seq = ++rankView.seq;
  const board = RANK_BOARDS.find((b) => b.id === rankView.board);
  for (const btn of ui.rankTabs.children) {
    const on = btn.dataset.id === board.id;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-selected', String(on));
  }
  ui.rankNote.innerHTML = board.note;
  ui.rankList.innerHTML = tr('<li class="rank-msg">CARREGANDO...</li>');
  const mine = board.week && save.rank.week !== weekNo() ? 0 : save.rank[board.id];
  ui.rankMe.textContent = save.rank.name ? trf('VOCÊ: {0} {1}', mine.toLocaleString(LOCALE), board.unit) : '';
  renderRankPlayer();
  if (!flagOn('ranking')) {
    ui.rankList.innerHTML = tr('<li class="rank-msg">RANKING EM MANUTENÇÃO.<br>VOLTE DAQUI A POUCO.</li>');
    return;
  }
  try {
    checkWeekPrize();
    if (save.rank.dirty && save.rank.name) await syncRank().catch(() => {});
    const rows = await fetchBoard(board.id);
    if (seq !== rankView.seq) return;
    ui.rankList.textContent = '';
    if (!rows.length) ui.rankList.innerHTML = tr('<li class="rank-msg">NINGUÉM AINDA. SEJA O PRIMEIRO!</li>');
    rows.forEach((row, k) => {
      const li = document.createElement('li');
      li.className = `rank-row${auth && row.id === auth.uid ? ' me' : ''}${k < 3 ? ` top${k + 1}` : ''}`;
      const pos = document.createElement('span');
      pos.className = 'pos';
      pos.textContent = `${k + 1}`;
      const name = document.createElement('span');
      name.className = 'who';
      name.textContent = row.name || '???';
      const val = document.createElement('span');
      val.className = 'val';
      val.textContent = `${(row[board.id] || 0).toLocaleString(LOCALE)} ${board.unit}`;
      li.append(pos, name, val);
      ui.rankList.append(li);
    });
    if (save.rank.name && mine > 0) {
      const pos = await myPosition(board.id, mine);
      if (seq === rankView.seq) {
        ui.rankMe.textContent = cloudOn()
          ? trf('VOCÊ: #{0} · {1} {2}', pos, mine.toLocaleString(LOCALE), board.unit)
          : trf('VOCÊ SERIA #{0} · {1} {2}', pos, mine.toLocaleString(LOCALE), board.unit);
      }
    }
  } catch {
    if (seq === rankView.seq) ui.rankList.innerHTML = tr('<li class="rank-msg">SEM CONEXÃO.<br>TOQUE NUMA ABA PRA TENTAR DE NOVO.</li>');
  }
}
function openRank(from) {
  rankView.from = from;
  show(from, false);
  show(ui.rank, true);
  renderRank();
}
function closeRank() {
  ui.nameInput.blur();
  show(ui.rank, false);
  show(rankView.from || ui.title, true);
  G.lockUntil = performance.now() + 300;
}
for (const b of RANK_BOARDS) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tab';
  btn.setAttribute('role', 'tab');
  btn.dataset.id = b.id;
  btn.textContent = b.tab;
  ui.rankTabs.append(btn);
}

// ---------- share ----------
// ---------- speech bubbles ----------
// Lines for the share image and for the bubble that pops over the rider now and then during a
// run: each rider's own lines (SAYS), funny lines anyone can say (SAYS_ANY) and lines for a
// moment (a hit, a close shave, a record, a very short or a very long run).
const SAYS = {
  classic: [tr('A CAPA DE R$ 15 AGUENTOU!'), tr('COMPREI ESSA CAPA NA LOJINHA.'), tr('ISSO NÃO TAVA NO PASSEIO.'), tr('SERÁ QUE TEM FOTO NA SAÍDA?'), tr('CADÊ O GUIA DO PASSEIO?'), tr('MEU SELFIE STICK CAIU!'), tr('TÁ INCLUSO NO INGRESSO?'), tr('VOU DAR UMA ESTRELA NO SITE.')],
  cat: [tr('CAÍ DE PÉ. COMO SEMPRE.'), tr('ODEIO ÁGUA. AMO ISSO.'), tr('MIAU? MIAAAAU!'), tr('SETE VIDAS. GASTEI DUAS AQUI.'), tr('DERRUBEI A PEDRA DA MESA.'), tr('CADÊ MEU SACHÊ?'), tr('PSSST! SAI, PEDRA!'), tr('VOU ME LAMBER POR UMA HORA.')],
  pirate: [tr('ARRR! CADÊ O TESOURO?'), tr('TERRA À VISTA! AH, É PEDRA.'), tr('PERNA DE PAU BOIA, NÉ?'), tr('O MAPA DIZIA PRA DESCER!'), tr('O PAPAGAIO FUGIU.'), tr('ÂNCORA? QUE ÂNCORA?'), tr('ABORDAR AQUELA PEDRA!'), tr('O X MARCA A CACHOEIRA.')],
  ninja: [tr('NINGUÉM ME VIU DESCER.'), tr('SHHH. ESTOU DESVIANDO.'), tr('FUMAÇA! ... CADÊ A FUMAÇA?'), tr('SOU UMA SOMBRA NA ÁGUA.'), tr('SHURIKEN NA PEDRA!'), tr('NEM A PEDRA ME OUVIU.'), tr('TREINEI DEZ ANOS PRA ISSO.'), tr('DESAPAREÇO EM 3, 2...')],
  clown: [tr('ALGUÉM VIU MEU NARIZ?'), tr('FON FON!'), tr('O SHOW NÃO PODE PARAR!'), tr('TORTA NA CARA DA PEDRA!'), tr('MEU SAPATO ENCHEU D\'ÁGUA.'), tr('RESPEITÁVEL PÚBLICO!'), tr('A FLOR ESGUICHA? AGORA SIM.'), tr('HOJE TEM MARMELADA? TEM!')],
  viking: [tr('VALHALLA FICA RIO ABAIXO!'), tr('JÁ DESCI FIORDE PIOR.'), tr('SKÅL!'), tr('ODIN, OLHA ISSO!'), tr('MEU CHIFRE TÁ SEGURO?'), tr('SAQUEAR A PRÓXIMA PEDRA!'), tr('DRAKKAR É PRA AMADOR.'), tr('PELA BARBA DE THOR!')],
  robot: [tr('BIP BOP. ÁGUA NO CIRCUITO.'), tr('ERRO 404: CHÃO NÃO ENCONTRADO.'), tr('RECALCULANDO ROTA...'), tr('BATERIA: 12%.'), tr('UMIDADE CRÍTICA.'), tr('SOU À PROVA D\'ÁGUA. ACHO.'), tr('CALCULANDO DESVIO...'), tr('REINICIANDO EM 3, 2, 1...')],
  astro: [tr('HOUSTON, TEMOS UMA CACHOEIRA.'), tr('GRAVIDADE: CONFIRMADA.'), tr('UM PEQUENO PASSO PRO BARRIL.'), tr('SEM GRAVIDADE ERA MAIS FÁCIL.'), tr('CONTROLE, PERDI O SINAL.'), tr('ESSA ÓRBITA TÁ ESTRANHA.'), tr('O CAPACETE TÁ EMBAÇANDO.'), tr('A TERRA É AZUL. E MOLHADA.')],
  dino: [tr('SOBREVIVI AO METEORO. E A ISSO.'), tr('RAWR! (TRADUÇÃO: SOCORRO)'), tr('BRAÇO CURTO, CORAGEM LONGA.'), tr('NÃO ALCANÇO O BARRIL!'), tr('ISSO É UM METEORO? UFA, PEDRA.'), tr('EXTINTO? EU NÃO.'), tr('COMI UMA SAMAMBAIA ANTES.'), tr('JURÁSSICO ERA MAIS SECO.')],
  et: [tr('MINHA CASA... TELEFONE... ÁGUA!'), tr('NO MEU PLANETA ISSO É BRINQUEDO.'), tr('LEVEM-ME AO SEU BARRIL.'), tr('ESSES TERRÁQUEOS SÃO LOUCOS.'), tr('MEU DISCO VOADOR ESTACIONOU MAL.'), tr('BIP. BIP. CACHOEIRA DETECTADA.'), tr('VIM EM PAZ. E MOLHADO.'), tr('MEU DEDO BRILHA NO ESCURO.')],
  santa: [tr('HO HO HOOOO... SOCORRO!'), tr('AS RENAS NÃO QUISERAM VIR.'), tr('FUI BONZINHO ESSE ANO?'), tr('RODOLFO, ACENDE O NARIZ!'), tr('A LISTA FICOU MOLHADA.'), tr('ESSA CHAMINÉ É ESTRANHA.'), tr('PEDRA, VOCÊ GANHOU CARVÃO!'), tr('NO POLO NORTE É MAIS GELADO.')],
  witch: [tr('MINHA VASSOURA ERA MAIS SEGURA.'), tr('ABRACADABARRIL!'), tr('VOU TE TRANSFORMAR EM SAPO, PEDRA!'), tr('MEU GATO PRETO FICOU EM CASA.'), tr('POÇÃO DE NÃO AFUNDAR, JÁ!'), tr('HI HI HI HI!'), tr('ESSE CALDEIRÃO É GRANDE.'), tr('FEITIÇO DE DESVIAR PEDRA!')],
  annie: [tr('EM 1901 NÃO TINHA CAPACETE.'), tr('A GATA DESCEU ANTES. FOI BEM.'), tr('NINGUÉM DEVIA FAZER ISSO DE NOVO.'), tr('TINHA 63 ANOS. E DAÍ?'), tr('BARRIL DE CARVALHO, O MELHOR.'), tr('FIQUEI FAMOSA, NÃO RICA.'), tr('AS CATARATAS SÃO MINHAS.'), tr('CADÊ MEU TRAVESSEIRO?')],
  gatovoa: [tr('NYA NYA NYA NYA!'), tr('O ARCO-ÍRIS É MEU.'), tr('ACHEI QUE ERA O ESPAÇO.'), tr('PISCADINHA PIXELADA!'), tr('SOU FEITO DE BISCOITO.'), tr('VOO NO LOOP!'), tr('MIAU EM 8 BITS.'), tr('ESPAÇO É MAIS SECO.')],
  sherlock: [tr('ELEMENTAR.'), tr('A PEDRA ESTAVA LÁ O TEMPO TODO.'), tr('O CULPADO É O RIO.'), tr('O JOGO COMEÇOU!'), tr('WATSON, ANOTA ISSO.'), tr('PEDRA DE CALCÁRIO, CLARAMENTE.'), tr('UM CASO DE TRÊS CACHIMBOS.'), tr('ELIMINE O IMPOSSÍVEL.')],
  xerife: [tr('TEM UMA PEDRA NA MINHA BOTA!'), tr('ALGUÉM ENVENENOU O BEBEDOURO!'), tr('VOCÊ É MEU PARCEIRO.'), tr('ALCANCE O CÉU!'), tr('ESSA CIDADE PRECISA DE MIM.'), tr('CADÊ MEU CAVALO?'), tr('SOU UM BRINQUEDO, MAS CORAJOSO.'), tr('O DONO VAI VOLTAR!')],
  arquiteto: [tr('CRIANÇAS, ESSA É UMA LONGA HISTÓRIA.'), tr('TRAGAM O GUARDA-CHUVA AMARELO.'), tr('LENDÁ... ESPERA... RIO!'), tr('ISSO VAI SER LENDÁRIO!'), tr('JÁ CONHECI A SUA MÃE?'), tr('A PEDRA TEM UM PROJETO.'), tr('NO BAR DE SEMPRE.'), tr('TED, FOCA!')],
  quimico: [tr('EU SOU O PERIGO.'), tr('DIGA MEU NOME.'), tr('É SÓ QUÍMICA.'), tr('99,1% DE PUREZA.'), tr('CIÊNCIA, CARAMBA!'), tr('EU BATO NA PORTA.'), tr('O MOTORHOME FICOU NO DESERTO.'), tr('TABELA PERIÓDICA DA PEDRA.')],
  voo815: [tr('A GENTE TEM QUE VOLTAR!'), '4 8 15 16 23 42.', tr('TEM ALGUMA COISA NA FLORESTA.'), tr('A ESCOTILHA TÁ ABERTA.'), tr('ESSA ILHA SE MEXE.'), tr('APERTA O BOTÃO A CADA 108 MIN.'), tr('VIVEMOS JUNTOS OU MORREMOS SÓS.'), tr('TEM URSO POLAR AQUI?')],
  jogador: [tr('BATATINHA FRITA 1, 2, 3!'), tr('EU NÃO SOU UM CAVALO.'), tr('ERA SÓ PRA GANHAR UMA GRANA.'), tr('QUAL O PRÓXIMO JOGO?'), tr('A BONECA TÁ OLHANDO!'), tr('QUEBREI O BISCOITO.'), tr('CABO DE GUERRA COM A PEDRA!'), tr('ELIMINADO? EU NÃO!')],
  ladrao: [tr('BELLA CIAO, CACHOEIRA.'), tr('O PLANO ERA PERFEITO.'), tr('NINGUÉM SE MACHUCA, SÓ O BARRIL.'), tr('ESSE É O PLANO B.'), tr('O PROFESSOR PENSOU EM TUDO.'), tr('NINGUÉM SAI DO BARRIL!'), tr('CADA UM COM SUA CIDADE.'), tr('O COFRE ERA ÁGUA.')],
  nortista: [tr('O INVERNO CHEGOU.'), tr('EU NÃO SEI DE NADA.'), tr('O NORTE NÃO ESQUECE.'), tr('A MURALHA FICOU PRA TRÁS.'), tr('SOU O REI. DO BARRIL.'), tr('ESSE FRIO NÃO É NADA.'), tr('O LOBO VEIO JUNTO.'), tr('UM LANNISTER? ONDE?')],
  fisico: [tr('BAZINGA!'), tr('TOC TOC TOC, CACHOEIRA.'), tr('ESSE É O MEU LUGAR.'), tr('TECNICAMENTE, ISSO É QUEDA LIVRE.'), tr('MEU APARTAMENTO, MINHAS REGRAS.'), tr('PEDRA, PAPEL, TESOURA, LAGARTO...'), tr('ISSO É SARCASMO?'), tr('EU NÃO SOU LOUCO, MINHA MÃE TESTOU.')],
  mae: [tr('LEVA CASACO!'), tr('JÁ FALEI PRA NÃO CORRER!'), tr('MANDA MENSAGEM QUANDO CHEGAR.'), tr('CADÊ SEU CAPACETE?'), tr('COMEU ANTES DE DESCER?'), tr('VOU CONTAR ATÉ TRÊS!'), tr('NÃO É NÃO!'), tr('ISSO É HORA DE CHEGAR?')],
  pai: [tr('PAVÊ OU PACOMÊ?'), tr('NO MEU TEMPO ERA MAIS ALTA.'), tr('APAGA A LUZ QUE NÃO SOU SÓCIO DA LIGHT.'), tr('VAI PERGUNTAR PRA SUA MÃE.'), tr('PODE DEIXAR QUE EU SEI O CAMINHO.'), tr('JÁ TÔ NO PORTÃO!'), tr('QUEM MEXEU NO CONTROLE?'), tr('VAMOS FALAR DE PEDRA? PEDREIRO!')],
  unicorn: [tr('DEIXEI UM ARCO-ÍRIS NO RIO.'), tr('SOU LINDO ATÉ MOLHADO.'), tr('PURPURINA À PROVA D’ÁGUA.'), tr('MEU CHIFRE É DECORATIVO.'), tr('BRILHO EM TUDO!'), tr('NÃO ACREDITAM EM MIM.'), tr('MINHA CRINA TÁ UM ARRASO.'), tr('SOU RARO E MOLHADO.')],
  vampire: [tr('AINDA BEM QUE TAVA NUBLADO.'), tr('NÃO TEM ALHO NESSE RIO, NÉ?'), tr('BLEH! ÁGUA NÃO É SANGUE.'), tr('QUERO CHUPAR... SEU SUCO.'), tr('MEU CAIXÃO É MAIS CONFORTÁVEL.'), tr('NÃO TENHO REFLEXO NA ÁGUA.'), tr('VIREI MORCEGO? NÃO DEU.'), tr('A NOITE É UMA CRIANÇA.')],
  wolf: [tr('AUUUUUU! ÁGUA GELADA!'), tr('CADÊ A LUA CHEIA?'), tr('CACHORRO MOLHADO, NÃO!'), tr('TÔ SOLTANDO PELO NO RIO.'), tr('ME COÇA ATRÁS DA ORELHA?'), tr('CHEIRO DE PEDRA MOLHADA.'), tr('NÃO SOU CACHORRO, TÁ?'), tr('GRRR... AU?')],
  zombie: [tr('CÉÉÉREBRO... MOLHADO...'), tr('JÁ MORRI. TÔ TRANQUILO.'), tr('UUUGH... PEDRA...'), tr('MEU BRAÇO CAIU NA ÁGUA.'), tr('ANDO DEVAGAR, DESÇO RÁPIDO.'), tr('GRRRUUUH... CACHOEIRA...'), tr('NÃO SINTO DOR. NEM FRIO.'), tr('PEDRA TEM CÉREBRO? NÃO.')],
  yeti: [tr('ACHEI A ÁGUA QUENTINHA.'), tr('AQUI É VERÃO PRA MIM.'), tr('BRRR? NÃO. AHHH!'), tr('PISEI NUM BONECO DE NEVE.'), tr('CADÊ A NEVE DESSA CACHOEIRA?'), tr('MEU PELO VIROU ESPONJA.'), tr('RUAAARGH! QUE DELÍCIA!'), tr('NÃO SOU ABOMINÁVEL. SOU FOFO.')],
  bigfoot: [tr('SAIU TREMIDA, COMO SEMPRE.'), tr('NÃO TIRA FOTO!'), tr('CALÇO 58. O BARRIL, 40.'), tr('MEU PÉ NÃO CABE AQUI.'), tr('SOU LENDA. E TÔ MOLHADO.'), tr('DEIXEI PEGADA NA ÁGUA.'), tr('FOTO DESFOCADA, POR FAVOR.'), tr('A FLORESTA É MAIS SECA.')],
  nessie: [tr('FINALMENTE UMA FOTO NÍTIDA!'), tr('LAGO É PRA AMADOR.'), tr('SAUDADE DA ESCÓCIA.'), tr('NINGUÉM ACREDITA EM MIM.'), tr('PESCOÇO LONGO AJUDA A VER PEDRA.'), tr('ÁGUA DOCE? TÔ ACOSTUMADA.'), tr('SAI DAQUI, TURISTA!'), tr('TIRA UMA FOTO NÍTIDA, VAI!')],
  skeleton: [tr('ME DEU UM FRIO NA ESPINHA.'), tr('TÔ SÓ O OSSO.'), tr('NÃO TENHO NADA A PERDER. NEM PELE.'), tr('MEUS OSSOS TÃO CHACOALHANDO.'), tr('SEM CARNE, SEM PESO.'), tr('QUEBREI A TÍBIA. DE NOVO.'), tr('MEU CRÂNIO VAI BOIAR.'), tr('ÁGUA ENTRA E SAI. NORMAL.')],
  mummy: [tr('MINHAS FAIXAS ENCOLHERAM!'), tr('3 MIL ANOS SEM ME MOLHAR.'), tr('ALGUÉM TEM UM SECADOR?'), tr('FARAÓ NENHUM FEZ ISSO.'), tr('TÔ DESENROLANDO!'), tr('O NILO ERA MAIS CALMO.'), tr('MALDIÇÃO NESSA PEDRA!'), tr('MEU SARCÓFAGO NÃO BOIA.')],
  creature: [tr('ESTÁ VIVO! E ENCHARCADO!'), tr('OS PONTOS TÃO SEGURANDO.'), tr('UUURGH! QUE ÁGUA BOA.'), tr('ME LIGA NO RAIO DE NOVO!'), tr('O DOUTOR NÃO VAI GOSTAR.'), tr('MEU PARAFUSO TÁ FROUXO.'), tr('FOGO RUIM! ÁGUA BOA!'), tr('SOU FEITO DE PEDAÇOS.')],
  caramelo: [tr('AU AU! CADÊ MEU PETISCO?'), tr('JÁ TÔ NA NOTA DE 200?'), tr('RABO ABANANDO A MIL.'), tr('LATI PRA PEDRA. ELA NÃO LIGOU.'), tr('CADÊ A BOLINHA?'), tr('SACUDIR AGORA OU DEPOIS?'), tr('SOU DE RUA, SOU DE RIO.'), tr('QUEM É UM BOM GAROTO? EU!')],
  lapwing: [tr('QUERO-QUERO! QUERO MAIS!'), tr('QUERO DESCER DE NOVO!'), tr('QUEM MEXEU NO MEU NINHO?'), tr('QUERO-QUERO-QUERO!'), tr('SAI DO MEU CAMPO, PEDRA!'), tr('TOPETE MOLHADO, NÃO!'), tr('VOU DAR RASANTE NA PEDRA!'), tr('SÓ QUERO SOSSEGO. MENTIRA.')],
  pony: [tr('GOOOOL DO BARRIL!'), tr('RUMO AO HEXA!'), tr('RELINCHO DE ALEGRIA!'), tr('TOCA O HINO!'), tr('É TETRA! É PENTA! É BARRIL!'), tr('PEDRA IMPEDIDA!'), tr('CAVALGANDO A CORRENTEZA!'), tr('PÕE NO TELÃO!')],
  castaway: [tr('MILSOOOON!'), tr('SOS! SOS! S... DEIXA.'), tr('MILSON, SEGURA FIRME!'), tr('TRÊS ANOS NUMA ILHA. ISSO É FÉRIAS.'), tr('FIZ FOGO COM DUAS PEDRAS.'), tr('MILSON, NÃO SOLTA!'), tr('UM NAVIO! AH, É PEDRA.'), tr('CADÊ MEU COCO?')],
  scientist: [tr('CALCULEI ERRADO. DE NOVO.'), tr('FUNCIONOU! (SEM QUERER)'), tr('TUDO PELA CIÊNCIA!'), tr('EUREKA! QUER DIZER, SOCORRO!'), tr('HIPÓTESE: VAI DOER.'), tr('ANOTA: ÁGUA MOLHA.'), tr('MEU CABELO JÁ ERA ASSIM.'), tr('PRECISO DE MAIS DADOS!')],
  angel: [tr('NEM UM ARRANHÃO. AMÉM.'), tr('TEM ALGUÉM LÁ EM CIMA CUIDANDO.'), tr('AURÉOLA À PROVA D’ÁGUA.'), tr('ASAS MOLHADAS NÃO VOAM.'), tr('PAZ E CACHOEIRA.'), tr('PEDRA, EU TE PERDOO.'), tr('TOCANDO HARPA NO BARRIL.'), tr('SANTA PACIÊNCIA!')],
  devil: [tr('ESSA ÁGUA TÁ FRIA DEMAIS.'), tr('QUENTE AQUI? NEM PERTO.'), tr('VOU ESQUENTAR ESSE RIO.'), tr('A PEDRA FOI IDEIA MINHA.'), tr('QUER FAZER UM PACTO?'), tr('MEU TRIDENTE ENFERRUJOU.'), tr('MUAHAHAHA!'), tr('O INFERNO É MAIS SECO.')],
  sponge: [tr('EU ESTOU PRONTO! EU ESTOU PRONTO!'), tr('ABSORVI METADE DO RIO.'), tr('QUE DIA LINDO PRA DESCER!'), tr('ABSORVENTE E AMARELA? NÃO, ROSA!'), tr('FIQUEI DO TAMANHO DE UM SOFÁ.'), tr('ME ESPREME DEPOIS!'), tr('BOLHAS! BOLHAS PRA TODO LADO!'), tr('HA HA HA HA HA!')],
  marquio: [tr('É EU, MARQUIO!'), tr('UAHUUU!'), tr('A PRINCESA TÁ EM OUTRO BARRIL?'), tr('MAMMA MIA!'), tr('CADÊ O COGUMELO?'), tr('ESSE CANO TÁ VAZANDO.'), tr('PULA! PULA! AH, É BARRIL.'), tr('OKIE DOKIE!')],
  handyman: [tr('DÁ PRA CONSERTAR. ACHO.'), tr('ISSO AÍ É SÓ UMA FITINHA.'), tr('ORÇAMENTO SEM COMPROMISSO!'), tr('TRAZ A CHAVE DE FENDA!'), tr('DÁ UMA SEMANINHA.'), tr('ISSO AÍ É GAMBIARRA.'), tr('A PEÇA TÁ EM FALTA.'), tr('SILVER TAPE RESOLVE.')],
  stunt: [tr('SEM DUBLÊ PRO DUBLÊ.'), tr('FAÇO ISSO TODO DIA.'), tr('CORTA! VAMOS DE NOVO!'), tr('SEGURA O CAFÉ QUE EU VOU.'), tr('JÁ QUEBREI TODOS OS OSSOS.'), tr('CENA DE AÇÃO, TOMADA 1!'), tr('O ATOR TÁ NO CAMARIM.'), tr('NEM PRECISEI DE CABO.')],
  kid8: [tr('FOI SEM QUERER QUERENDO!'), tr('ISSO, ISSO, ISSO!'), tr('NINGUÉM TEM PACIÊNCIA COMIGO!'), tr('PRESTENÇÃO, PRESTENÇÃO!'), tr('TÁ BOM, MAS NÃO SE IRRITE!'), tr('PIPIPIPIPI!'), tr('ZAS! ZAS! ZAS!'), tr('EU QUERIA UM SANDUÍCHE.')],
  cow: [tr('MUUU. QUE VERGONHA.'), tr('LEITE BATIDO!'), tr('MUUUITA ÁGUA!'), tr('MUUU. VIREI VACA ATOLADA.'), tr('O PASTO É MAIS CALMO.'), tr('CADÊ MEU SININHO?'), tr('VAI DAR LEITE COM GÁS.'), tr('MUUU... SOCORRO.')],
  beta: [tr('ISSO É BUG OU FEATURE?'), tr('REPORTANDO: PEDRA NO CAMINHO.'), tr('FUNCIONA NA MINHA MÁQUINA.'), tr('ABRINDO UM TICKET.'), tr('NÃO REPRODUZ NO MEU CELULAR.'), tr('VERSÃO 0.9 É ASSIM MESMO.'), tr('PRINT E MANDA PRO DEV.'), tr('ESSA PEDRA TÁ NO LUGAR ERRADO.')],
  ghost: [tr('BUUU! (MOLHADO)'), tr('ATRAVESSO PEDRA. ÀS VEZES.'), tr('JÁ QUEBREI AQUI 100 VEZES.'), tr('NÃO TENHO MEDO DE PEDRA.'), tr('O LENÇOL TÁ ENCHARCADO.'), tr('ASSOMBRANDO O RIO.'), tr('ALGUÉM CHAMOU UM PADRE?'), tr('UUUUUH... BLUB.')],
  demogorg: [tr('GRRRAAAH!'), tr('NO MUNDO INVERTIDO É MAIS SECO.'), tr('CHEIRO DE QUEIJO? SOU EU.'), tr('CADÊ AS LUZINHAS DE NATAL?'), tr('SHHHRAAAK!'), tr('O PORTAL ERA POR AQUI.'), tr('COMI UM WAFFLE. TAVA BOM.'), tr('SOU FLOR DE DENTE.')],
  dumont: [tr('MAIS PESADO QUE O AR. E QUE A ÁGUA.'), tr('INVENTEI O VOO. E A QUEDA.'), tr('QUE HORAS SÃO? TENHO RELÓGIO!'), tr('O 14-BIS NÃO TINHA BOIA.'), tr('VOO OU NAVEGAÇÃO?'), tr('PARIS, AÍ VOU EU!'), tr('MEU CHAPÉU VOOU. ELE SIM.'), tr('PATENTE? NÃO PRECISA.')],
  miner: [tr('UAI, CADÊ A LUZ?'), tr('TREM BÃO DEMAIS!'), tr('PÃO DE QUEIJO MOLHADO, NÃO!'), tr('ÔÔ TREM DOIDO!'), tr('CADÊ O CAFEZIM?'), tr('SÔ, QUE CACHOEIRA!'), tr('ACHEI OURO! AH, É PEDRA.'), tr('NÓIS DESCE DEVAGARIM.')],
  brickman: [tr('PEÇA POR PEÇA!'), tr('PERDI O CABELO DE NOVO.'), tr('ENCAIXOU!'), tr('PISEI NUMA PEÇA. AI!'), tr('MEU BRAÇO GIRA 360.'), tr('FALTA UMA PEÇA NO BARRIL.'), tr('TUDO É INCRÍVEL!'), tr('SÓ TENHO UM SORRISO.')],
  dev: [tr('FUNCIONA NA MINHA MÁQUINA.'), tr('DEPLOY NA SEXTA DÁ NISSO.'), tr('GIT PUSH NA CACHOEIRA.'), tr('ISSO É UM BUG CONHECIDO.'), tr('STACK OVERFLOW, ME AJUDA!'), tr('NULL POINTER NA PEDRA.'), tr('O ESTAGIÁRIO MEXEU AQUI.'), tr('REFATORO DEPOIS.')],
  penguin: [tr('SUDO DESCER CACHOEIRA.'), tr('CÓDIGO ABERTO, BARRIL ABERTO.'), tr('BRRR. ME SINTO EM CASA.'), tr('TERMINAL ABERTO.'), tr('RM -RF PEDRA.'), tr('COMPILEI O BARRIL.'), tr('NÃO USO JANELAS.'), tr('PEIXE NO KERNEL?')],
  jobis: [tr('SÓ MAIS UMA COISA...'), tr('PENSE DIFERENTE. PENSE BARRIL.'), tr('ISSO MUDA TUDO.'), tr('UM BARRIL. UM RIO. UMA DESCIDA.'), tr('É MÁGICO.'), tr('SEM BOTÕES. SÓ INCLINA.'), tr('GOLA ALTA MOLHADA, NÃO.'), tr('CONTINUE FAMINTO. E MOLHADO.')],
  hitch: [tr('NÃO ENTRE EM PÂNICO!'), tr('A RESPOSTA É 42.'), tr('TROUXE A TOALHA, CLARO.'), tr('ADEUS, E OBRIGADO PELOS PEIXES!'), tr('A TOALHA TÁ MOLHADA.'), tr('A PROBABILIDADE ERA INFINITA.'), tr('ODEIO SEGUNDAS.'), tr('UM BULE NO RIO? IMPROVÁVEL.')],
  cyborg: [tr('EU VOLTAREI.'), tr('HASTA LA VISTA, PEDRA.'), tr('PRECISO DO SEU BARRIL.'), tr('ALVO: PEDRA. ELIMINAR.'), tr('VENHA COMIGO SE QUISER VIVER.'), tr('SOU UM MODELO ANTIGO.'), tr('NÃO SINTO DOR.'), tr('SEM PROBLEMAS.')],
  gates: [tr('JÁ TENTOU DESLIGAR E LIGAR?'), tr('TELA AZUL DE NOVO, NÃO!'), tr('ATUALIZANDO... 1 DE 347.'), tr('CLIQUE EM OK PRA CONTINUAR.'), tr('O CLIPE DE PAPEL QUER AJUDAR.'), tr('ERRO FATAL: PEDRA.'), tr('REINICIE PRA APLICAR.'), tr('640 KB BASTAM PRA TODOS.')],
  jedai: [tr('QUE A CORRENTEZA ESTEJA COM VOCÊ.'), tr('FAÇA OU NÃO FAÇA. TENTAR NÃO HÁ.'), tr('SINTO UMA PERTURBAÇÃO NA ÁGUA.'), tr('USE A FORÇA, BARRIL.'), tr('MUITO A APRENDER VOCÊ TEM.'), tr('PEDRA GRANDE, MEDO PEQUENO.'), tr('MOLHADO EU ESTOU.'), tr('O LADO SOMBRIO É ESCORREGADIO.')],
  trooper: [tr('ERREI A PEDRA. COMO SEMPRE.'), tr('ESSE NÃO É O BARRIL QUE PROCURAM.'), tr('MIRA? QUE MIRA?'), tr('ALTO! IDENTIFIQUE-SE, PEDRA!'), tr('BATI A CABEÇA NO CAPACETE.'), tr('ARMADURA BRANCA NÃO É À PROVA D\'ÁGUA.'), tr('PEDE REFORÇO!'), tr('ERREI DE NOVO, CHEFE.')],
  samurai: [tr('HONRA ATÉ O FIM DO RIO.'), tr('SILÊNCIO E FOCO.'), tr('MINHA ESPADA CORTA ÁGUA.'), tr('CORTE PERFEITO NA ÁGUA.'), tr('UM SAMURAI NÃO GRITA. AAAH!'), tr('A PEDRA É MINHA MESTRA.'), tr('A CORRENTEZA É O CAMINHO.'), tr('HAI!')],
  gondolier: [tr('O SOLE MIOOO!'), tr('CADÊ MEU REMO?'), tr('VENEZA TEM MENOS PEDRA.'), tr('NA GÔNDOLA NÃO TINHA ISSO.'), tr('MAMMA, QUE CORRENTEZA!'), tr('QUER UMA SERENATA?'), tr('PASTA DEPOIS DA DESCIDA!'), tr('ANDIAMO!')],
  guard: [tr('NÃO POSSO RIR. NEM GRITAR.'), tr('DEUS SALVE O BARRIL.'), tr('NEM PISQUEI.'), tr('MEU CHAPÉU PESA 1 KG.'), tr('TROCA DA GUARDA: AGORA!'), tr('CHÁ DAS CINCO ATRASADO.'), tr('POSTURA! SEMPRE POSTURA!'), tr('...')],
  cowboy: [tr('IIIIRRÁ!'), tr('ESSE TOURO É MOLHADO.'), tr('TEM UMA COBRA NA MINHA BOTA!'), tr('ESSA CIDADE É PEQUENA PRA NÓS DOIS.'), tr('SEGURA, PEÃO!'), tr('MEU CAVALO SABE NADAR?'), tr('LAÇO NA PEDRA!'), tr('POEIRA, NÃO. ÁGUA, SIM.')],
  mariachi: [tr('AY, AY, AY, AY!'), tr('CANTA E NÃO CHORA!'), tr('ARRIBA, BARRIL!'), tr('CIELITO LINDO!'), tr('O SOMBRERO É BOIA.'), tr('TOCANDO NA CORRENTEZA!'), tr('MI CORAZÓN! MI BARRIL!'), tr('ÁNDALE, ÁNDALE!')],
  bunny: [tr('ESCONDI UM OVO NO BARRIL.'), tr('CADÊ MEUS OVOS?'), tr('PULO, PULO, AFUNDO!'), tr('CHOCOLATE DERRETE NA ÁGUA?'), tr('MINHAS ORELHAS SÃO REMOS.'), tr('CENOURA PRA VIAGEM.'), tr('FELIZ PÁSCOA, PEDRA!'), tr('PULEI ALTO DEMAIS.')],
  armadillo: [tr('VIREI UMA BOLINHA DE MEDO.'), tr('CASCA GROSSA, CORAÇÃO MOLE.'), tr('OITO VELAS, UM BARRIL.'), tr('ENROLA E DESCE!'), tr('BATI? NEM SENTI.'), tr('MEU BURACO É MAIS SECO.'), tr('CASCO DE RESPEITO.'), tr('FELIZ FERIADO!')],
  vangogh: [tr('QUE NOITE ESTRELADA!'), tr('NÃO OUVI A PEDRA CHEGANDO.'), tr('VOU PINTAR ESSA CACHOEIRA.'), tr('ESSE AZUL É PERFEITO.'), tr('GIRASSÓIS NA MARGEM!'), tr('A TINTA TÁ ESCORRENDO.'), tr('PINCELADA EM ESPIRAL!'), tr('O QUÊ? FALA MAIS ALTO!')],
  picasso: [tr('VI A PEDRA DE TODOS OS ÂNGULOS.'), tr('MEU OLHO TÁ ONDE?'), tr('ISSO É ARTE MODERNA.'), tr('ESSA PEDRA É UM CUBO.'), tr('MEU NARIZ MUDOU DE LUGAR.'), tr('FASE AZUL. BEM AZUL.'), tr('ARTE É DESCER DE BARRIL.'), tr('ASSINO A CACHOEIRA.')],
  mozart: [tr('ISSO ESTÁ EM DÓ MAIOR!'), tr('SINFONIA Nº 40: A QUEDA.'), tr('BRAVO! BRAVÍSSIMO!'), tr('ALLEGRO! MUITO ALLEGRO!'), tr('A PEDRA DESAFINOU.'), tr('PEQUENA SERENATA DA CACHOEIRA.'), tr('MINHA PERUCA BOIOU.'), tr('CRESCENDO! CRESCENDO!')],
  davinci: [tr('EU DESENHEI ISSO EM 1490.'), tr('CADÊ MINHA MÁQUINA DE VOAR?'), tr('SORRIA, MONA LISA!'), tr('ANOTO TUDO AO CONTRÁRIO.'), tr('PROPORÇÃO ÁUREA NA ONDA.'), tr('PRECISO DE UM PARAQUEDAS.'), tr('O HOMEM VITRUVIANO NO BARRIL.'), tr('GÊNIO TAMBÉM SE MOLHA.')],
  civil: [tr('ALERTA SEVERO: PEDRAS!'), tr('EVACUEM A CACHOEIRA!'), tr('COLETE SALVA VIDAS!'), tr('MANTENHAM A CALMA!'), tr('ÁREA DE RISCO!'), tr('NÍVEL DO RIO SUBINDO!'), tr('ROTA DE FUGA: PRA BAIXO.'), tr('RECEBEU O SMS? EU MANDEI.')],
  cop: [tr('ENCOSTA A PEDRA AÍ!'), tr('DOCUMENTO DO BARRIL, POR FAVOR.'), tr('PERDEU, PEDRA!'), tr('MÃOS NO BARRIL!'), tr('VOCÊ TEM O DIREITO DE AFUNDAR.'), tr('EXCESSO DE VELOCIDADE!'), tr('CADÊ MINHA ROSQUINHA?'), tr('BLITZ NA CACHOEIRA!')],
  fireman: [tr('QUANTA ÁGUA! APAGO TUDO.'), tr('193, QUAL A EMERGÊNCIA?'), tr('ESSE INCÊNDIO É MOLHADO.'), tr('MANGUEIRA DESNECESSÁRIA.'), tr('SALVEI UM GATO HOJE.'), tr('ESCADA MAGIRUS, CADÊ?'), tr('TUDO SOB CONTROLE.'), tr('SIRENE LIGADA!')],
  doctor: [tr('DIGA AAA!'), tr('REPOUSO ABSOLUTO. MENOS EU.'), tr('ESSA PEDRA PRECISA DE RAIO-X.'), tr('PRESSÃO 12 POR 8.'), tr('TOME DOIS COMPRIMIDOS.'), tr('SEM PULSO? AH, É A PEDRA.'), tr('ISSO NÃO É RECOMENDADO.'), tr('TEM MÉDICO A BORDO? EU.')],
  gamer: [tr('GG EZ!'), tr('LAG! FOI LAG!'), tr('SÓ MAIS UMA PARTIDA!'), tr('CADÊ O CHECKPOINT?'), tr('NERFA ESSA PEDRA!'), tr('MÃE, TÔ NO MEIO DA FASE!'), tr('FOI O CONTROLE!'), tr('SPEEDRUN DA CACHOEIRA!')],
  chef: [tr('TEMPERO DO RIO!'), tr('OUI, CHEF!'), tr('FALTOU SAL NESSA ÁGUA.'), tr('SOPA DE PEDRA!'), tr('AL DENTE!'), tr('MAIS UMA PITADA DE ÁGUA.'), tr('CADÊ MEU AVENTAL?'), tr('SERVIDO NO BARRIL!')],
  courier: [tr('SEU PEDIDO ESTÁ A CAMINHO!'), tr('O GPS MANDOU POR AQUI.'), tr('ENTREGA EXPRESSA!'), tr('O CLIENTE TÁ ESPERANDO!'), tr('CINCO ESTRELAS, POR FAVOR.'), tr('A PIZZA TÁ MOLHADA.'), tr('RECALCULANDO A ROTA...'), tr('DEIXO NA PORTARIA?')],
  milton: [tr('MA OEEE!'), tr('QUEM QUER DINHEIROOO?'), tr('ESTÁ CERTO DISSO?'), tr('VEM PRA CÁ!'), tr('É DINHEIRO OU NÃO É?'), tr('AVIÃOZINHO DE DINHEIRO!'), tr('RÁ RÁ! HI HI!'), tr('MAIS UM PRO AUDITÓRIO!')],
  faustino: [tr('Ô LOCO, MEU!'), tr('ERROU!'), tr('ESSA CACHOEIRA É DA PESADA!'), tr('OLHA A PEDRA AÍ, GENTE!'), tr('QUEM SABE FAZ AO VIVO!'), tr('TÁ PEGANDO FOGO, BICHO!'), tr('OLOCO, BICHO!'), tr('VAI PRO TROFÉU!')],
  nazare: [tr('AS CONTAS NÃO FECHAM.'), tr('QUANTAS PEDRAS? SEI LÁ.'), tr('CADÊ MEU DINHEIRO?'), tr('SE EU CAIR, CAIO DE SALTO.'), tr('UMA TESOURA, POR FAVOR.'), tr('ESSA PEDRA ME PROVOCOU.'), tr('DOIS MAIS DOIS É... PEDRA?'), tr('EU? CONFUSA? NUNCA.')],
  odete: [tr('QUE CACHOEIRA CAFONA.'), tr('PRIMEIRA CLASSE, POR FAVOR.'), tr('ISSO AQUI É O BRASIL?'), tr('ONDE FICA O CAMAROTE?'), tr('MEU MOTORISTA FICOU NO CARRO.'), tr('ÁGUA SEM GÁS? QUE HORROR.'), tr('COMPRO ESSA CACHOEIRA.'), tr('MINHAS PÉROLAS, CUIDADO!')],
  darklord: [tr('EU SOU SEU BARRIL.'), tr('SUA FALTA DE FÉ É PERTURBADORA.'), tr('KHHH... PSHHH...'), tr('NÃO, EU SOU O SEU BARRIL.'), tr('JUNTE-SE AO LADO SOMBRIO.'), tr('O IMPERADOR NÃO VAI GOSTAR.'), tr('ESTRANGULANDO A PEDRA...'), tr('MINHA CAPA ENCHARCOU.')],
  sinister: [tr('POR QUE TÃO SÉRIO?'), tr('HAHAHAHA!'), tr('VAMOS DEIXAR ISSO INTERESSANTE.'), tr('ME DÁ UM SORRISO, PEDRA!'), tr('O CAOS É JUSTO.'), tr('QUER SABER DAS CICATRIZES?'), tr('UMA PIADA MOLHADA!'), tr('OLHA A MAQUIAGEM!')],
  nightmare: [tr('NÃO DURMA AGORA!'), tr('UM, DOIS, ELE VEM TE PEGAR...'), tr('DOCES SONHOS.'), tr('ACORDA! OU NÃO.'), tr('TRÊS, QUATRO, TRANCA A PORTA...'), tr('MINHAS GARRAS ENFERRUJAM.'), tr('BEM-VINDO AO MEU PESADELO.'), tr('NÃO PISCA.')],
  jackson: [tr('CH CH CH... AH AH AH...'), tr('EU SEMPRE VOLTO.'), tr('...'), tr('SEXTA-FEIRA 13 É HOJE?'), tr('O ACAMPAMENTO FICA RIO ACIMA.'), tr('A MÁSCARA NÃO SAI.'), tr('ANDO DEVAGAR. SEMPRE ALCANÇO.'), tr('HUMM.')],
  relic: [tr('ISSO PERTENCE A UM MUSEU!'), tr('ODEIO COBRAS.'), tr('CORRE QUE A PEDRA TÁ ROLANDO!'), tr('NÃO OLHE PRA ARCA!'), tr('ESSA PEDRA É ANTIGA.'), tr('MEU CHAPÉU NUNCA CAI.'), tr('TÁ CHEIO DE ARMADILHA AQUI.'), tr('X NUNCA MARCA O LUGAR.')],
  incognito: [tr('QUEM? EU? NÃO TÔ AQUI.'), tr('HISTÓRICO APAGADO.'), tr('SEM COOKIES, SEM RASTRO.'), tr('ESSA CONVERSA NÃO EXISTIU.'), tr('MODO ANÔNIMO ATIVADO.'), tr('NÃO TIRA FOTO.'), tr('SOU SÓ UM BARRIL QUALQUER.'), tr('APAGANDO PEGADAS...')],
  tesla: [tr('QUE CORRENTE!'), tr('ALTERNADA, CLARO.'), tr('SENTI UM CHOQUE.'), tr('VOU ILUMINAR A CACHOEIRA.'), tr('ENERGIA SEM FIO!'), tr('BOBINA CARREGADA!'), tr('O FUTURO É ELÉTRICO.'), tr('BZZZ... EUREKA!')],
  ada: [tr('CALCULEI A ROTA PERFEITA.'), tr('ISSO É UM LOOP DE PEDRAS.'), tr('0 PEDRAS, 1 BARRIL.'), tr('SE PEDRA, ENTÃO DESVIA.'), tr('COMPILANDO A DESCIDA...'), tr('A MÁQUINA NÃO ERRA.'), tr('POESIA E MATEMÁTICA!'), tr('ERRO NA LINHA 1843.')],
  darwin: [tr('SÓ OS MAIS FORTES DESCEM.'), tr('O BARRIL EVOLUIU.'), tr('ANOTANDO: PEDRA, PEDRA, PEDRA.'), tr('UMA ESPÉCIE NOVA DE PEDRA!'), tr('ADAPTAR OU AFUNDAR.'), tr('OS TENTILHÕES FICARAM PRA TRÁS.'), tr('SELEÇÃO NATURAL EM AÇÃO!'), tr('INTERESSANTE. MUITO.')],
  agent006: [tr('BATIDO, NÃO MEXIDO.'), tr('ZERO ZERO SEIS. QUASE FAMOSO.'), tr('LICENÇA PRA DESCER.'), tr('O NOME É SEIS. ZERO ZERO SEIS.'), tr('O QUARTEL MANDOU UM BARRIL.'), tr('MISSÃO: NÃO MOLHAR O SMOKING.'), tr('O SETE É SUPERESTIMADO.'), tr('UM GADGET, POR FAVOR.')],
  professor: [tr('ISSO CAI NA PROVA!'), tr('SILÊNCIO NA SALA!'), tr('QUEM COLOU ESSA PEDRA AQUI?'), tr('PODE APAGAR O QUADRO?'), tr('ISSO VALE NOTA.'), tr('TRABALHO PRA SEGUNDA!'), tr('QUEM SABE A RESPOSTA?'), tr('CHAMADA: PEDRA? PRESENTE.')],
  grillman: [tr('NINGUÉM ENCOSTA NA CHURRASQUEIRA!'), tr('A CARNE TÁ NO PONTO!'), tr('SÁBADO É SÁBADO!'), tr('PASSA O VINAGRETE!'), tr('O CORAÇÃOZINHO TÁ PRONTO!'), tr('SAL GROSSO E PACIÊNCIA.'), tr('QUEM TROUXE O GELO?'), tr('O CARVÃO MOLHOU!')],
  farofa: [tr('TROUXE A FAROFA!'), tr('CADÊ O FRANGO?'), tr('AUMENTA O SOM AÍ!'), tr('CADÊ O GUARDA-SOL?'), tr('TEM FAROFA PRA TODO MUNDO!'), tr('O ISOPOR TÁ BOIANDO.'), tr('AREIA NA COXINHA, NÃO!'), tr('DOMINGO É DIA DE RIO!')],
  tiazap: [tr('BOM DIA, GRUPO!'), tr('REPASSEM PRA 10 AMIGOS!'), tr('KKKKKKKK'), tr('BOA NOITE, FAMÍLIA! FLORES!'), tr('ISSO É VERDADE, VI NO GRUPO.'), tr('ÁUDIO DE 7 MINUTOS CHEGANDO.'), tr('QUEM SAIU DO GRUPO?'), tr('DEUS ABENÇOE ESSA DESCIDA.')],
  blogueira: [tr('POSTA ESSA!'), tr('#CACHOEIRA #BLESSED'), tr('ARRASTA PRA CIMA!'), tr('SEGUE PRA MAIS CACHOEIRAS!'), tr('FILTRO NA PEDRA!'), tr('RECEBIDINHO DO BARRIL!'), tr('CUPOM CACHOEIRA10!'), tr('A LUZ AQUI TÁ PERFEITA.')],
  viral: [tr('VIRALIZOU!'), tr('FAZ A DANCINHA!'), tr('2 MILHÕES DE VIEWS!'), tr('ATIVA O SININHO!'), tr('TREND DO BARRIL!'), tr('PASSINHO NA PEDRA!'), tr('DUETA COMIGO!'), tr('ISSO VAI FLOPAR.')],
  tioface: [tr('É PAVÊ OU PRA DESCER?'), tr('COMPARTILHE SE É CONTRA PEDRA.'), tr('FOTO DE PERFIL NOVA!'), tr('ACEITA MEU CONVITE DE AMIZADE!'), tr('KKKKK BOA ESSA'), tr('MARQUEI VOCÊ NA FOTO.'), tr('DIGITANDO...'), tr('CURTE AÍ, SOBRINHO!')],
  pigeon: [tr('RUUU RUUU!'), tr('ENTREGA ÀS 19H!'), tr('LEMBRETE: JOGAR!'), tr('CORRESPONDÊNCIA MOLHADA.'), tr('NÃO SOU POMBO DE PRAÇA.'), tr('RUUU! ENTREGUE!'), tr('O CARTEIRO SOU EU.'), tr('ASAS NA CORRENTEZA!')],
  ambassador: [tr('EM NOME DO RIO, OBRIGADO!'), tr('CONDECORADO PELOS LAMBARIS.'), tr('DIPLOMACIA COM AS PEDRAS.'), tr('UM BRINDE AO RIO!'), tr('TRATADO DE PAZ COM AS PEDRAS.'), tr('PASSAPORTE CARIMBADO!'), tr('TRAGAM MAIS AMIGOS!'), tr('MINHA MEDALHA BRILHA.')],
  chaplolin: [tr('NÃO CONTAVAM COM MINHA ASTÚCIA!'), tr('SIGAM-ME OS BONS!'), tr('PALMA, PALMA, NÃO PRIEMOS CÂNICO!'), tr('SUSPEITEI DESDE O PRINCÍPIO.'), tr('SE APROVEITAM DA MINHA NOBREZA!'), tr('ISSO, ISSO, ISSO!'), tr('MINHAS ANTENINHAS DETECTAM PEDRA!'), tr('TUDO FRIAMENTE CALCULADO!')],
  canetinha: [tr('MENOS 8 KG!'), tr('UMA DOSE POR SEMANA!'), tr('A CALÇA JÁ TÁ LARGA!'), tr('ACADEMIA? EU DESÇO CACHOEIRA.'), tr('SEM FOME NENHUMA.'), tr('O BARRIL FICOU FOLGADO.'), tr('CONTANDO CALORIAS DA ÁGUA.'), tr('ANTES E DEPOIS!')],
  king: [tr('O RIO É MEU!'), tr('SÚDITOS, DESVIEM!'), tr('COROA À PROVA D’ÁGUA.'), tr('CORTEM A CABEÇA DA PEDRA!'), tr('SOU REI, NÃO REMO.'), tr('QUE TOQUEM AS TROMBETAS!'), tr('MEU TRONO É DE MADEIRA.'), tr('PAGUEM O IMPOSTO DO RIO!')],
  dragon: [tr('FUUUUSH!'), tr('EVAPOREI A CACHOEIRA.'), tr('CADÊ MEU TESOURO?'), tr('SAI DA FRENTE QUE EU QUEIMO!'), tr('MINHAS ASAS MOLHARAM.'), tr('CUSPI FOGO. SAIU VAPOR.'), tr('ESCAMAS À PROVA DE PEDRA.'), tr('RAAAWR!')],
  aranha: [tr('MEU SENTIDO DE PEDRA TÁ APITANDO!'), tr('COM GRANDES PODERES VÊM GRANDES RASPADAS.'), tr('TEIA NÃO GRUDA EM ÁGUA!'), tr('SEU AMIGO DA VIZINHANÇA!'), tr('PENDURADO NUM FIO.'), tr('TÔ ATRASADO PRA AULA.'), tr('ESCALEI A CACHOEIRA. AO CONTRÁRIO.'), tr('MINHA TIA VAI ME MATAR.')],
  molhadao: [tr('MOLHADÃO ESMAGA!'), tr('NÃO ME MOLHA. VOCÊ NÃO VAI GOSTAR.'), tr('MINHA CAMISA RASGOU DE NOVO.'), tr('AGORA EU TÔ BRAVO.'), tr('RAAARGH! PEDRA PEQUENA!'), tr('SEMPRE ESTOU MOLHADO.'), tr('CALMA... RESPIRA...'), tr('VERDE É MINHA COR.')],
  barrilha: [tr('PELO PODER DO BARRIL!'), tr('BRACELETE À PROVA DE PEDRA!'), tr('O LAÇO NÃO MENTE!'), tr('PELA ILHA!'), tr('AMAZONAS NÃO RECUAM.'), tr('MEU AVIÃO INVISÍVEL SUMIU.'), tr('A VERDADE, PEDRA!'), tr('TIARA NO LUGAR!')],
  batima: [tr('EU SOU O BARRIL!'), tr('CADÊ O BATI-SINAL?'), tr('SOU RICO, MAS DESÇO DE BARRIL.'), tr('ONDE ESTÁ O DETONADOR?'), tr('A NOITE É MINHA.'), tr('ALFREDO, TRAZ A TOALHA!'), tr('EU TRABALHO SOZINHO.'), tr('ESSA PEDRA ERA DO CORINGA?')],
  superhomi: [tr('É UM PÁSSARO? É UM BARRIL!'), tr('UAI, SÔ! QUE ÁGUA!'), tr('CADÊ A CABINE PRA TROCAR DE ROUPA?'), tr('UAI, QUE PEDRA TREM!'), tr('MEU PONTO FRACO É PEDRA VERDE.'), tr('PÃO DE QUEIJO DÁ SUPERFORÇA.'), tr('VISÃO DE RAIO-X: PEDRA.'), tr('PRO ALTO E AVANTE! OU PRA BAIXO.')],
  fechahaimer: [tr('AGORA ME TORNEI O BARRIL.'), tr('FECHA! FECHA ESSE APP!'), tr('A FÍSICA NÃO EXPLICA ISSO.'), tr('FECHA A JANELA TAMBÉM.'), tr('A FÍSICA É IMPLACÁVEL.'), tr('TRÊS HORAS DE FILME. TRÊS DE DESCIDA.'), tr('O CACHIMBO APAGOU.'), tr('REAÇÃO EM CADEIA!')],
  chachu: [tr('ILARILARIÊ, Ô, Ô, Ô!'), tr('BEIJINHO, BEIJINHO, TCHAU TCHAU!'), tr('QUERER, PODER E CONSEGUIR!'), tr('ABRAÇO DE URSO NA PEDRA!'), tr('BAIXINHOS, SEGUREM FIRME!'), tr('BOTA NO PÉ, BARRIL NA ÁGUA!'), tr('PAPAI E MAMÃE, OLHA EU!'), tr('A NAVE ESPERA LÁ EMBAIXO.')],
  anjelica: [tr('VOU DE TÁXI!'), tr('MOÇO, SEGUE AQUELA CACHOEIRA!'), tr('PODE FICAR COM O TROCO.'), tr('TAXÍMETRO RODANDO!'), tr('NA PRÓXIMA, VIRA À ESQUERDA.'), tr('BANDEIRA DOIS!'), tr('NÃO VOU DE BARCO, NÃO!'), tr('CORRIDA DE APP, NÃO!')],
  cupido: [tr('FLECHADA NO CORAÇÃO!'), tr('ESSE BARRIL COMBINA COM VOCÊ!'), tr('O AMOR TÁ NO AR. E NA ÁGUA.'), tr('VOCÊS FORMAM UM LINDO PAR.'), tr('ERREI A FLECHA. ACERTEI A PEDRA.'), tr('AMOR À PRIMEIRA DESCIDA!'), tr('MINHAS ASINHAS NÃO AGUENTAM.'), tr('PEDRA, VOCÊ TAMBÉM MERECE AMOR.')],
  zeus: [tr('QUEM MANDOU ESSE RAIO? FUI EU.'), tr('MORTAIS, SAIAM DA FRENTE!'), tr('NO OLIMPO NÃO TEM CACHOEIRA ASSIM.'), tr('TROVÃO EM 3, 2, 1...'), tr('HERA NÃO PODE SABER DISSO.'), tr('DEUS DOS DEUSES, MOLHADO.'), tr('A PEDRA OFENDEU O OLIMPO.'), tr('POSEIDON, PARA DE RIR!')],
  poseidon: [tr('ÁGUA DOCE? QUE EXÓTICO!'), tr('O TRIDENTE APONTA PRA BAIXO!'), tr('ESSE RIO É MEU AGORA.'), tr('ONDE ESTÃO OS GOLFINHOS?'), tr('SAL FAZ FALTA.'), tr('ONDA GIGANTE, JÁ!'), tr('MEU IRMÃO MANDA NO CÉU.'), tr('RIO É MAR PEQUENO.')],
  medusa: [tr('NÃO OLHA PRA MIM, PEDRA!'), tr('MAIS UMA ESTÁTUA PRA COLEÇÃO.'), tr('MEU CABELO TÁ SIBILANDO.'), tr('OLHOU? VIROU PEDRA.'), tr('MINHAS COBRAS ODEIAM ÁGUA.'), tr('ÓCULOS ESCUROS, POR FAVOR.'), tr('SSSSSS!'), tr('CHAPINHA NÃO RESOLVE.')],
  saci: [tr('HÁ HÁ HÁ! NUMA PERNA SÓ!'), tr('QUEM PEGOU MEU GORRO?'), tr('VIRO REDEMOINHO E SUMO!'), tr('TRANÇEI A CRINA DA PEDRA.'), tr('MEU CACHIMBO MOLHOU!'), tr('PULANDO DE PEDRA EM PEDRA!'), tr('NINGUÉM ME PEGA!'), tr('UMA PERNA É SUFICIENTE.')],
  iara: [tr('LÁ LÁ LÁÁÁ...'), tr('O RIO É MINHA CASA.'), tr('VEM PRO FUNDO, VEM!'), tr('SEU CORAÇÃO É MEU.'), tr('CANTO E A PEDRA SAI.'), tr('CABELO DE ALGA, LINDO.'), tr('NADO MELHOR QUE O BARRIL.'), tr('QUEM ME OUVE, NÃO VOLTA.')],
  curupira: [tr('SEGUE MINHAS PEGADAS!'), tr('NINGUÉM DERRUBA ESSA MATA!'), tr('MEU PÉ É PRA TRÁS, O BARRIL PRA FRENTE.'), tr('QUEM DESMATOU AQUI?'), tr('MEU CABELO NÃO APAGA.'), tr('ASSOBIO PRA ASSUSTAR!'), tr('PROTETOR DA FLORESTA!'), tr('CAÇADOR, VOLTA!')],
  bartolomeu: [tr('LET\'S CODE A BETTER WORLD.'), tr('MAIS CAFÉ, POR FAVOR.'), tr('DEPLOY NA SEXTA? NÃO.'), tr('REVIEW APROVADO.'), tr('BAMBU NO CAFÉ DA MANHÃ.'), tr('VEM PRA CODECON!'), tr('TESTES PASSANDO. ACHO.'), tr('PANDA NÃO CORRE. DESCE.')],
  corredor: [tr('BATI MEU RECORDE PESSOAL!'), tr('O RELÓGIO NÃO CONTA BARRIL.'), tr('CÃIBRA! CÃIBRA!'), tr('MEDALHA DE PARTICIPAÇÃO!'), tr('POSTEI O TREINO.'), tr('DOMINGO TEM CORRIDA.'), tr('HIDRATAÇÃO EM DIA!'), tr('PACE DE 5 POR KM!')],
  dj: [tr('SOLTA O GRAVE!'), tr('MÃOS PRO ALTO!'), tr('REMIX DA CACHOEIRA!'), tr('UM, DOIS, TESTANDO...'), tr('A PISTA TÁ MOLHADA!'), tr('PEDIDO DE MÚSICA? NÃO ACEITO.'), tr('ESSA BATIDA É PEDRA!'), tr('SÓ HITS ATÉ O FIM!')],
  cacafantasma: [tr('QUEM VOCÊ VAI CHAMAR?'), tr('NÃO CRUZA OS RAIOS!'), tr('O MEDIDOR TÁ APITANDO!'), tr('VI UM VULTO NA ÁGUA.'), tr('GOSMA VERDE NO BARRIL!'), tr('ARMADILHA PRONTA!'), tr('ESSA CACHOEIRA É ASSOMBRADA.'), tr('NÃO TENHO MEDO DE FANTASMA.')],
  perito: [tr('TUDO ANOTADO.'), tr('ESSE RESPINGO É SUSPEITO.'), tr('TENHO UM CÓDIGO.'), tr('TRAGO ROSQUINHAS PRO PESSOAL.'), tr('O PASSAGEIRO TÁ QUIETO HOJE.'), tr('MIAMI É MAIS QUENTE.'), tr('ANALISANDO A TRAJETÓRIA...'), tr('NENHUMA GOTA FORA DO LUGAR.')],
  avatar: [tr('EU VEJO VOCÊ.'), tr('A MÃE NATUREZA ME GUIA.'), tr('MINHA TRANÇA CONECTA COM O RIO.'), tr('TRÊS METROS DE CORAGEM.'), tr('ESSA ÁGUA BRILHA DE NOITE?'), tr('SAIAM DA MINHA FLORESTA!'), tr('AZUL COMBINA COM CACHOEIRA.'), tr('VOEI DE DRAGÃO. ISSO É FÁCIL.')],
  guerreiro: [tr('KAAAA... MEEEE...'), tr('MAIS DE 8 MIL!'), tr('TÔ CARREGANDO O PODER!'), tr('CADÊ A NUVEM VOADORA?'), tr('ESSE GRITO DURA UM EPISÓDIO.'), tr('TÔ COM FOME. MUITA.'), tr('DOURADO É O NOVO LOIRO.'), tr('PEDRA, VOCÊ É FORTE!')],
  vocientista: [tr('UUURP! VAMO, NETO!'), tr('ENTRA E SAI, 20 MINUTOS.'), tr('ESSA DIMENSÃO É CHATA.'), tr('SOU UM PICLES! NÃO, BARRIL!'), tr('CIÊNCIA NÃO É SOBRE PORQUÊ.'), tr('WUBBA LUBBA CACHOEIRA!'), tr('A PISTOLA TÁ SEM CARGA.'), tr('ME DÁ OUTRO GOLE.')],
  neto: [tr('AW, VÔ, ISSO É PERIGOSO!'), tr('EU QUERO IR PRA CASA.'), tr('TENHO PROVA AMANHÃ!'), tr('ISSO NÃO TÁ CERTO, VÔ!'), tr('A-A-A PEDRA!'), tr('POR QUE SEMPRE EU?'), tr('MINHA MÃE VAI SURTAR.'), tr('TÁ, TÁ, EU VOU!')],
  padrinho: [tr('FAREI UMA OFERTA IRRECUSÁVEL.'), tr('A FAMÍLIA EM PRIMEIRO LUGAR.'), tr('NÃO É PESSOAL. SÃO NEGÓCIOS.'), tr('DEIXA A PEDRA, PEGA O CANNOLI.'), tr('MANTENHA OS AMIGOS POR PERTO.'), tr('A PEDRA ME DESRESPEITOU.'), tr('NO DIA DO CASAMENTO DA MINHA FILHA?'), tr('BEIJA A MÃO, CACHOEIRA.')],
  mago: [tr('VOCÊ NÃO VAI PASSAR!'), tr('UM MAGO NUNCA SE ATRASA.'), tr('FUJAM, SEUS TOLOS!'), tr('O ANEL FICOU NO BOLSO.'), tr('NEM TODO QUE VAGUEIA SE PERDE.'), tr('MEU CAJADO ENCHARCOU.'), tr('VOLTO DE BRANCO.'), tr('ESSA PEDRA É DE MORIA?')],
  sabao: [tr('NÃO SE FALA DO CLUBE.'), tr('VOCÊ NÃO É SEU BARRIL.'), tr('TUDO QUE VOCÊ TEM TE PRENDE.'), tr('BATE NA PEDRA, VAI!'), tr('SÓ DORMI DUAS HORAS.'), tr('QUER COMPRAR SABONETE?'), tr('SEGUNDA REGRA: VER A PRIMEIRA.'), tr('QUEM ESTÁ DESCENDO? EU? NÓS?')],
  walle: [tr('UÓÓLI!'), tr('ACHEI UMA MOEDA!'), tr('COMPACTANDO...'), tr('CADÊ MINHA PLANTINHA?'), tr('BIIIP... UÊ?'), tr('700 ANOS DE TRABALHO.'), tr('ÁGUA É DIFERENTE DE LIXO.'), tr('SOLZINHO, RECARREGA!')],
  messias: [tr('A ESPECIARIA DEVE FLUIR.'), tr('O MEDO MATA A MENTE.'), tr('TANTA ÁGUA! QUE DESPERDÍCIO!'), tr('ANDE SEM RITMO.'), tr('EU VI ESSE FUTURO.'), tr('O VERME VEM AÍ!'), tr('MEU TRAJE RECICLA ISSO.'), tr('O DESERTO É MAIS SECO.')],
  descalco: [tr('YIPPEE KI-YAY, PEDRA!'), tr('CADÊ MEU SAPATO?'), tr('VIDRO NO PÉ, NÃO!'), tr('VEM PRA FESTA, ESTRANHO!'), tr('SÓ QUERIA PASSAR O NATAL.'), tr('HOMEM ERRADO, LUGAR ERRADO.'), tr('AGORA EU TENHO UM BARRIL. HO HO HO.'), tr('ESSE DUTO DE AR É MOLHADO.')],
  sonambulo: [tr('ZZZ... MAIS CINCO MINUTOS...'), tr('MÃE, JÁ ACORDEI...'), tr('QUE SONHO MOLHADO.'), tr('ONDE TÔ? NA CAMA?'), tr('SONHEI QUE CAÍA. E CAÍ.'), tr('O DESPERTADOR TÁ TOCANDO?'), tr('CONTANDO PEDRAS PRA DORMIR.'), tr('RONC... RONC...')],
  escondido: [tr('...OITO, NOVE, DEZ! LÁ VOU EU!'), tr('NÃO VALE ESPIAR!'), tr('CADÊ TODO MUNDO?'), tr('ACHEI VOCÊ, PEDRA!'), tr('UM, DOIS, TRÊS... VALEU?'), tr('TÔ CONTANDO DE OLHO FECHADO!'), tr('1, 2, 3, SALVA TODOS!'), tr('NINGUÉM SE ESCONDE NA ÁGUA!')],
  torcedor: [tr('É GOOOOL!'), tr('JUIZ LADRÃO!'), tr('SOU TORCEDOR ATÉ DEBAIXO D\'ÁGUA!'), tr('VAMO, VAMO, BARRIL!'), tr('ESSE É O MEU TIME!'), tr('TEM VAR NA CACHOEIRA?'), tr('OLÉ! OLÉ! OLÉ!'), tr('PERDI A VOZ NO PRIMEIRO TEMPO.')],
  maratonista: [tr('SÓ MAIS 2 KM!'), tr('ISSO CONTA PASSO?'), tr('CADÊ O POSTO DE ÁGUA? ACHEI.'), tr('O MURO DO KM 30!'), tr('BOLHA NO PÉ, NÃO!'), tr('GEL DE CARBOIDRATO, JÁ!'), tr('CHEGADA À VISTA!'), tr('TÊNIS ENCHARCADO.')],
  arrepiado: [tr('BZZZT!'), tr('MEU CABELO NUNCA MAIS BAIXOU.'), tr('TÔ COM 220 VOLTS.'), tr('FUI ATÉ O CÉU E VOLTEI.'), tr('NÃO ME ENCOSTA, DÁ CHOQUE.'), tr('SOU UM PARA-RAIO HUMANO.'), tr('SINTO CHEIRO DE QUEIMADO.'), tr('PENTE NENHUM RESOLVE.')],
  dummy: [tr('TESTE 3.001, LÁ VAMOS NÓS.'), tr('APERTEM OS CINTOS!'), tr('NÃO SINTO NADA. SOU DE PLÁSTICO.'), tr('ANOTA O IMPACTO!'), tr('PARECE QUE FOI A 80 KM/H.'), tr('AIRBAG, CADÊ VOCÊ?'), tr('SOU SUBSTITUÍVEL. MAS NÃO QUERO.'), tr('CÂMERA LENTA LIGADA!')],
  schrodinger: [tr('TÔ VIVO. OU NÃO.'), tr('ABRE O BARRIL PRA VER.'), tr('MIAU E NÃO MIAU.'), tr('A CAIXA TÁ FECHADA?'), tr('ONDA OU PARTÍCULA? GATO.'), tr('50% DE CHANCE DE MIAU.'), tr('NÃO OLHA! VAI COLAPSAR!'), tr('SUPERPOSIÇÃO DE BARRIL.')],
  escolhido: [tr('NÃO EXISTE PEDRA.'), tr('EU SEI DESVIAR.'), tr('ISSO É REAL?'), tr('PÍLULA AZUL OU VERMELHA?'), tr('EU SEI KUNG FU.'), tr('ESQUIVA EM CÂMERA LENTA!'), tr('O GATO PASSOU DUAS VEZES.'), tr('SIGA O COELHO BRANCO.')],
  bruxo: [tr('ACCIO BARRIL!'), tr('CADÊ MINHA VASSOURA?'), tr('DEZ PONTOS PRA MINHA CASA!'), tr('EXPELLIARMUS, PEDRA!'), tr('MINHA CICATRIZ TÁ DOENDO.'), tr('PLATAFORMA 9 E 3/4 É AQUI?'), tr('O CHAPÉU ME MANDOU PRA CÁ.'), tr('ESQUECI A VARINHA!')],
  tributa: [tr('QUE A SORTE ESTEJA A MEU FAVOR.'), tr('EU ME OFEREÇO!'), tr('A CACHOEIRA É A ARENA.'), tr('NA ARENA NÃO TEM BARRIL.'), tr('FLECHA NA PEDRA!'), tr('ESSE PÁSSARO SOU EU.'), tr('TRÊS DEDOS PRO ALTO!'), tr('A CAPITAL TÁ ASSISTINDO.')],
  genio: [tr('SAI DO MEU LABORATÓRIO!'), tr('NÃO APERTA ESSE BOTÃO!'), tr('CALCULEI TUDO. MENOS A PEDRA.'), tr('ROBÔ, ATIVAR!'), tr('QUEM MEXEU NA MINHA PORÇÃO?'), tr('MINHA IRMÃ TÁ NO BARRIL?!'), tr('EXPERIMENTO Nº 4.002.'), tr('SENHA DO LABORATÓRIO: PEDRA.')],
  fenix: [tr('EU SEMPRE VOLTO.'), tr('DAS CINZAS PRA CACHOEIRA!'), tr('MOLHOU? EU RENASÇO.'), tr('QUEIMEI, MAS VOLTEI.'), tr('MINHAS LÁGRIMAS CURAM.'), tr('ASAS DE FOGO!'), tr('MIL ANOS, MIL DESCIDAS.'), tr('LENDÁRIA E ENCHARCADA.')],
};
// Lines of the barrel (any rider says them now and then) and of a rider in their matching barrel.
const SAYS_BARREL = {
  classic: [tr('BARRIL BOM É BARRIL DE MADEIRA.')],
  radio: [tr('ESSE BRILHO É NORMAL?'), tr('TÔ VENDO NO ESCURO!')],
  keg: [tr('CHOPP SEM ESPUMA NÃO DÁ.'), tr('TÁ TRINCANDO!')],
  melon: [tr('CUIDADO COM O CAROÇO!'), tr('TÁ DOCE AQUI DENTRO.')],
  trash: [tr('RECICLA EU!'), tr('NÃO É LIXO, É VINTAGE.')],
  duck: [tr('QUACK!'), tr('BOIA QUE É UMA BELEZA.')],
  fridge: [tr('ALGUÉM FECHA A PORTA!'), tr('TEM FEIJÃO NO POTE DE SORVETE.')],
  cooker: [tr('PSSSSSSS!'), tr('VAI APITAR!')],
  box: [tr('SE CABE, EU SENTO.'), tr('PAPELÃO MOLHADO, SOCORRO.')],
  toilet: [tr('ALGUÉM DEU DESCARGA?'), tr('ESSA É A DESCIDA MAIS LONGA.')],
  orelhao: [tr('ALÔ? É DA CACHOEIRA?'), tr('CADÊ A FICHA?')],
  washer: [tr('CENTRIFUGANDO!'), tr('MODO ROUPA DELICADA.')],
  gold: [tr('OURO NÃO BOIA. EU BOIO.')],
  armor: [tr('PODE VIR, PEDRA!')],
  rocket: [tr('3, 2, 1... ÁGUA!')],
  coffin: [tr('PELO MENOS É CONFORTÁVEL.')],
  pumpkin: [tr('CHEIRO DE TORTA DE ABÓBORA.')],
  gift: [tr('NÃO ABRE ANTES DO NATAL!')],
  piano: [tr('DÓ, RÉ, MI, PEDRA!')],
  police: [tr('ENCOSTA, PEDRA!')],
  ambulance: [tr('ABRE ALAS!')],
  grill: [tr('TEM PICANHA?'), tr('O CARVÃO APAGOU!')],
  cloud: [tr('NUVEM NÃO AFUNDA, NÉ?')],
  chuveiro: [tr('TÁ NO INVERNO OU NO VERÃO?'), tr('NÃO ENCOSTA MOLHADO!'), tr('CAIU A LUZ DO PRÉDIO.')],
  certificado: [tr('PRODUTO TESTADO E APROVADO.'), tr('TEM SELO, PODE CONFIAR.')],
  altoem: [tr('ALTO EM PEDRAS!'), tr('CONSUMA COM MODERAÇÃO.'), tr('CONTÉM TRAÇOS DE CACHOEIRA.')],
  piao: [tr('TÔ TONTO!'), tr('GIRA, GIRA, GIRA...')],
  classea: [tr('GASTANDO POUCO, DESCENDO MUITO.'), tr('NOTA A, MERMÃO.')],
  pilha: [tr('BATERIA FRACA!'), tr('ALGUÉM TEM UM CARREGADOR?')],
  farol: [tr('LUZ ALTA, PEDRA!'), tr('NAVIO À VISTA? NÃO, PEDRA.')],
  matrix: [tr('TÔ VENDO TUDO EM VERDE.'), tr('ISSO FOI UM DÉJÀ VU?')],
  camera: [tr('SORRIA PRO PASSARINHO!'), tr('NÃO SE MEXE QUE BORRA!')],
  disco: [tr('LEVEM-ME AO SEU LÍDER.'), tr('RAIO TRATOR NA PEDRA!')],
  pericia: [tr('EVIDÊNCIA Nº 1: ÁGUA.'), tr('NÃO MEXE NA CENA!')],
  bioluz: [tr('TÁ TUDO BRILHANDO!'), tr('A FLORESTA TÁ VIVA.')],
  esfera: [tr('FALTAM SÓ SEIS!'), tr('FAÇA UM PEDIDO!')],
  portal: [tr('OUTRA DIMENSÃO, OUTRA PEDRA.'), tr('SCHLOOP!')],
  azeite: [tr('EXTRA VIRGEM, EXTRA RÁPIDO.'), tr('ESCORREGA QUE É UMA BELEZA.')],
  elfo: [tr('UM RIO, UM BARRIL, UM ANÃO.'), tr('PARA O LESTE, SEMPRE!')],
  sabaob: [tr('ESCORREGOU!'), tr('ESPUMA PRA TODO LADO!')],
  verme: [tr('SENTIU O TREMOR?'), tr('CHEIRO DE CANELA.')],
  galaxia: [tr('TEM UM PLANETA AQUI DENTRO.'), tr('INFINITO E CACHOEIRA.')],
};
const SAYS_PAIR = {
  'cat+box': [tr('MINHA CAIXA, MINHAS REGRAS.')],
  'pirate+rum': [tr('YO HO HO E UM BARRIL DE RUM!')],
  'viking+keg': [tr('SKÅL! COM CHOPP É OUTRA COISA.')],
  'astro+rocket': [tr('HOUSTON, TEMOS UMA CACHOEIRA.')],
  'santa+gift': [tr('HO HO HO! O PRESENTE SOU EU.')],
  'witch+pumpkin': [tr('MINHA ABÓBORA VIROU CARRUAGEM. AQUÁTICA.')],
  'vampire+coffin': [tr('FINALMENTE, MINHA CAMA.')],
  'yeti+fridge': [tr('AQUI DENTRO É QUE NEM EM CASA.')],
  'handyman+toilet': [tr('JÁ DESENTUPI ESSA AQUI.')],
  'devil+lava': [tr('QUENTINHO, DO JEITO QUE EU GOSTO.')],
  'zeus+olimpo': [tr('MINHA COLUNA, MEUS RAIOS.')],
  'arrepiado+chuveiro': [tr('BZZT! ÁGUA QUENTE NA HORA!'), tr('LIGA NO INVERNO, CAIU O RAIO!')],
  'dummy+certificado': [tr('TESTADO EM MIM, APROVADO PRA VOCÊ.')],
  'escolhido+matrix': [tr('AGORA EU VEJO O CÓDIGO.')],
  'schrodinger+box': [tr('NINGUÉM ABRE ESSA CAIXA!')],
  'bruxo+pumpkin': [tr('FEITIÇO DE ABÓBORA, FUNCIONA!')],
  'tributa+charcoal': [tr('A GAROTA EM CHAMAS VOLTOU.')],
  'fenix+galaxia': [tr('RENASCI NAS ESTRELAS.')],
  'vocientista+portal': [tr('PORTAL ABERTO, NETO. PULA!')],
  'mago+elfo': [tr('AOS PORTOS CINZENTOS!')],
  'guerreiro+esfera': [tr('SÓ FALTAM SEIS, VAMOS!')],
  'padrinho+azeite': [tr('AZEITE DA FAMÍLIA, RESPEITA.')],
  'messias+verme': [tr('MONTANDO O VERME!')],
};
const SAYS_ANY = [
  tr('QUE DESCIDA!'), tr('ALGUÉM TEM UMA TOALHA?'), tr('MEU CABELO TÁ ÓTIMO.'), tr('MÃE, OLHA EU AQUI!'), tr('FOI MAL, PEDRA.'),
  tr('ISSO É PERMITIDO?'), tr('TÔ BEM! TÔ BEM!'), tr('QUEM TEVE ESSA IDEIA?'), tr('PRÓXIMA PARADA: O FUNDO.'), tr('NÃO OLHA PRA BAIXO!'),
  tr('UOOOOEEEE!'), tr('TÁ CHEGANDO?'), tr('ACHEI QUE ERA RASO.'), tr('ESQUECI O PROTETOR SOLAR.'), tr('O BARRIL TÁ VAZANDO?'),
  tr('PEDRA À DIREITA! NÃO, ESQUERDA!'), tr('JÁ DÁ PRA PARAR?'), tr('SEGURA, PEÃO!'), tr('VOU CONTAR PRA TODO MUNDO.'), tr('5 ESTRELAS, RECOMENDO.'),
  tr('DEVIA TER IDO DE ÔNIBUS.'), tr('ISSO CONTA COMO BANHO?'), tr('ALGUÉM DESLIGA ESSA CACHOEIRA?'), tr('TÁ TUDO SOB CONTROLE.'),
  tr('SE EU SOBREVIVER, CONTO PRA TODOS.'), tr('QUEM DEIXOU A TORNEIRA ABERTA?'), tr('TINHA UM BOTÃO DE FREIO AQUI.'), tr('ÁGUA NO OUVIDO, NÃO!'), tr('ISSO AQUI TEM SEGURO?'), tr('O GUIA DISSE QUE ERA TRANQUILO.'), tr('VOU PEDIR REEMBOLSO.'), tr('NEM PRECISEI DE BOIA.'), tr('ALGUÉM TÁ FILMANDO?'), tr('ESSA PEDRA É NOVA.'), tr('SEGURA O CHAPÉU!'), tr('TÔ VENDO O FIM? NÃO.'), tr('ME AVISA QUANDO ACABAR.'), tr('MAIS RÁPIDO! NÃO, MAIS DEVAGAR!'), tr('ISSO VAI PRO MEU CURRÍCULO.'), tr('CHEGA DE PEDRA POR HOJE.'),
];
const SAYS_HIT = [tr('AI!'), tr('ESSA DOEU.'), tr('QUEM PÔS ESSA PEDRA AÍ?'), tr('MEU BARRIL!'), tr('TÁ TUDO BEM. TÁ?'), tr('FOI DE PROPÓSITO.')];
const SAYS_GRAZE = [tr('UFA!'), tr('RASPOU!'), tr('ESSA FOI POR POUCO!'), tr('SENTI O VENTO DA PEDRA.'), tr('NEM ENCOSTOU!')];
const SAYS_REC = [tr('NOVO RECORDE!'), tr('ALGUÉM TÁ VENDO ISSO?'), tr('SOU UMA LENDA!'), tr('ANOTA AÍ ESSE NÚMERO!')];
const SAYS_SHORT = [tr('NEM COMECEI!'), tr('FOI O SENSOR!'), tr('ESSA NÃO VALEU.'), tr('TAVA AQUECENDO.')];
const SAYS_LONG = [tr('NEM ACREDITO!'), tr('QUE DESCIDA HISTÓRICA!'), tr('JÁ POSSO DESCANSAR?')];
const pickOne = (list) => list[Math.floor(Math.random() * list.length)];
const riderSays = (id) => pickOne(SAYS[id] || SAYS_ANY);
// A line for this rider in this barrel: the pair's own line, the barrel's, the rider's or anyone's.
function comboSays(riderId, barrelId) {
  const pair = SAYS_PAIR[`${riderId}+${barrelId}`];
  if (pair && Math.random() < 0.5) return pickOne(pair);
  const bl = SAYS_BARREL[barrelId];
  if (bl && Math.random() < 0.3) return pickOne(bl);
  return Math.random() < 0.7 ? riderSays(riderId) : pickOne(SAYS_ANY);
}
// The share image: the moment first (short run, record, very long), else the rider or anyone.
function shareSay(r) {
  const k = Math.random();
  if (r.m < 30 && k < 0.5) return pickOne(SAYS_SHORT);
  if (r.rec && k < 0.4) return pickOne(SAYS_REC);
  if (r.m >= 1000 && k < 0.25) return pickOne(SAYS_LONG);
  if (r.rider.id === 'schrodinger') return Math.random() < 0.5 ? tr('VIVO!') : tr('MORTO! (OU NÃO)');
  return comboSays(r.rider.id, r.barrel.id);
}

// In-game bubble over the rider: one every 25 to 50 s, sometimes after a hit or a close shave.
const SAY_SECS = 2.6;
const sayState = { t: 0, next: 0, last: -99, w: 0 };
function sayReset() {
  sayState.t = 0;
  sayState.next = 8 + Math.random() * 14;
  sayState.last = -99;
  show(ui.say, false);
}
function sayShow(txt) {
  ui.say.textContent = txt;
  sayState.t = SAY_SECS;
  sayState.last = G.playT;
  // measure it once in the middle of the screen and lock that size: near an edge the browser
  // would otherwise re-wrap the text every frame as the barrel moves
  ui.say.style.left = '0px'; // full width available while measuring
  ui.say.style.width = 'max-content'; // one line, or wrapped at the CSS max-width
  show(ui.say, true);
  sayState.w = ui.say.offsetWidth; // layout size, not affected by the pop-in scale
  ui.say.style.width = `${sayState.w}px`;
  sayPlace();
  ui.say.classList.remove('in');
  void ui.say.offsetWidth; // restart the pop-in
  ui.say.classList.add('in');
}
// list: lines for this moment; chance: how often it speaks up (never twice within 6 s)
function sayMaybe(list, chance) {
  if (G.state !== 'playing' || sayState.t > 0 || G.playT - sayState.last < 6 || Math.random() > chance) return;
  sayShow(pickOne(list));
}
function sayStep(dt) {
  if (sayState.t > 0) {
    sayState.t -= dt;
    if (sayState.t <= 0) show(ui.say, false);
    else sayPlace();
    return;
  }
  if (G.playT >= sayState.next) {
    sayShow(comboSays(riderSkin.id, barrelSkin.id));
    sayState.next = G.playT + 25 + Math.random() * 25;
  }
}
// Above the rider's head, on the canvas as the screen shows it (object-fit: contain).
function sayPlace() {
  const r = canvas.getBoundingClientRect();
  const k = Math.min(r.width / W, r.height / H);
  const x = r.left + (r.width - W * k) / 2 + G.bx * k;
  const y = r.top + (r.height - H * k) / 2 + (curBY - BARREL_H / 2 - 14) * k;
  const half = sayState.w / 2;
  const left = clamp(x, half + 8, window.innerWidth - half - 8); // the bubble stays on screen...
  ui.say.style.left = `${Math.round(left)}px`;
  ui.say.style.top = `${Math.round(y)}px`;
  ui.say.style.setProperty('--tail', `${Math.round(clamp(x - (left - half), 14, sayState.w - 14))}px`); // ...and the tail follows the rider
}
const SHARE_URL = 'https://godri.dev/cataratas';
const PIXEL_FONT = '"Press Start 2P", ui-monospace, monospace';

// 1080x1350 card: waterfall, the rider in the barrel, a speech bubble, the distance.
function makeShareImage(r) {
  const CW = 1080;
  const CH = 1350;
  const c = makeCanvas(CW, CH);
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  x.textAlign = 'center';
  x.textBaseline = 'alphabetic';
  // water
  x.fillStyle = '#1f5fae';
  x.fillRect(0, 0, CW, CH);
  const S = 6;
  for (let y = 0; y < CH; y += waterTile.height * S) x.drawImage(waterTile, -48, y, waterTile.width * S, waterTile.height * S);
  for (let y = -200; y < CH; y += foamTile.height * S) x.drawImage(foamTile, -48, y, foamTile.width * S, foamTile.height * S);
  // stone walls on both sides
  const stone = makeStoneTile(64, 1234);
  const T = 64 * 3;
  for (let y = 0; y < CH; y += T) {
    x.drawImage(stone, -T + 84, y, T, T);
    x.drawImage(stone, CW - 84, y, T, T);
  }
  x.fillStyle = '#9aa2b3';
  x.fillRect(84, 0, 6, CH);
  x.fillRect(CW - 90, 0, 6, CH);
  // darker bands behind the text
  x.fillStyle = 'rgba(11, 26, 51, 0.55)';
  x.fillRect(0, 0, CW, 260);
  x.fillRect(0, 960, CW, CH - 960);
  const text = (str, tx, ty, size, color) => {
    x.font = `${size}px ${PIXEL_FONT}`;
    const o = Math.max(3, Math.round(size / 9));
    x.fillStyle = '#000000';
    x.fillText(str, tx + o, ty + o);
    x.fillStyle = color;
    x.fillText(str, tx, ty);
  };
  text(tr('CATARATAS'), CW / 2, 130, 76, '#ffffff');
  text(tr('NO BARRIL'), CW / 2, 215, 52, '#ffd23f');

  // rider in the barrel, peeking, scaled up
  const spr = makeCanvas(40, 40);
  drawRiderInBarrel(spr.getContext('2d'), 20, 14, r.riderSpr, r.rider, r.barrelSpr, RIDER_HIGH);
  const K = 14;
  const bx = CW / 2 - 20 * K;
  const by = 380;
  x.drawImage(spr, bx, by, 40 * K, 40 * K);
  // splash at the waterline
  x.fillStyle = '#eaf7ff';
  for (const [dx, w] of [[-170, 70], [110, 70], [-120, 40], [90, 40]]) x.fillRect(CW / 2 + dx, by + 38 * K, w, 14);

  // speech bubble with a tail pointing at the rider
  const say = r.say || (r.say = shareSay(r)); // picked once, so re-sharing shows the same card
  x.font = `30px ${PIXEL_FONT}`;
  const words = say.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (x.measureText(next).width > 640 && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  lines.push(cur);
  const bw = Math.min(760, Math.max(...lines.map((l) => x.measureText(l).width)) + 80);
  const bh = lines.length * 46 + 44;
  const bxl = CW / 2 - bw / 2;
  const byt = 290 - bh / 2 + 10;
  x.fillStyle = '#000000';
  x.fillRect(bxl + 8, byt + 8, bw, bh);
  x.fillStyle = '#ffffff';
  x.fillRect(bxl, byt, bw, bh);
  x.fillRect(CW / 2 - 10, byt + bh, 40, 20);
  x.fillRect(CW / 2 - 10, byt + bh + 20, 20, 20);
  x.fillStyle = '#1a1a1a';
  lines.forEach((l, k) => x.fillText(l, CW / 2, byt + 62 + k * 46));

  // result
  text(`${r.m} m`, CW / 2, 1090, 104, '#ffd23f');
  text(r.rec ? tr('NOVO RECORDE!') : trf('RECORDE: {0} m', r.best), CW / 2, 1160, 34, r.rec ? '#ff8fb3' : '#ffffff');
  text(trf('MODO {0}', r.diffName), CW / 2, 1220, 30, ['#7dff8a', '#bfe3ff', '#ff8a8a'][r.diff]);
  text(`${r.rider.name} · ${r.barrel.name}`, CW / 2, 1268, 18, '#c9d1db');
  text('GODRI.DEV/CATARATAS', CW / 2, 1320, 22, '#ffffff');
  return c;
}

// Draw the card as soon as the run ends (once the pixel font is ready), so the share tap goes
// straight to the share call: browsers only allow it shortly after a real tap.
function prepareCard(r) {
  const fonts = document.fonts && document.fonts.load ? document.fonts.load(`30px ${PIXEL_FONT}`).catch(() => {}) : Promise.resolve();
  r.card = fonts.then(() => {
    const cv = makeShareImage(r);
    return new Promise((res) => cv.toBlob((blob) => res({ cv, blob }), 'image/png'));
  });
}

let sharing = false;
// Package names (what Android reports) of the apps that have their own badge.
const SHARE_APPS = {
  'com.whatsapp': 'whatsapp', 'com.whatsapp.w4b': 'whatsapp',
  'com.instagram.android': 'instagram',
  'com.zhiliaoapp.musically': 'tiktok', 'com.ss.android.ugc.trill': 'tiktok', 'com.ss.android.ugc.aweme': 'tiktok', 'com.zhiliaoapp.musically.go': 'tiktok',
  'com.facebook.katana': 'facebook', 'com.facebook.lite': 'facebook', 'com.facebook.orca': 'facebook', 'com.facebook.mlite': 'facebook',
  'org.telegram.messenger': 'telegram', 'org.telegram.messenger.web': 'telegram', 'org.thunderdog.challegram': 'telegram',
};
const SHARE_BADGE = { whatsapp: 'share_zap', instagram: 'share_ig', tiktok: 'share_tt', facebook: 'share_fb', telegram: 'share_tg' };
// Called only when the share finished: the sheet's app was picked (Android), the browser's share
// resolved, or the image was downloaded. A canceled sheet throws before getting here.
function achOnShare(pkg) {
  save.shares++;
  unlock('share');
  if (save.shares >= 10) unlock('share10');
  if (pkg) {
    const id = SHARE_APPS[pkg] || pkg.slice(0, 80);
    save.shareApps[id] = true;
    if (SHARE_BADGE[id]) unlock(SHARE_BADGE[id]);
    if (Object.keys(save.shareApps).length >= 3) unlock('share3');
  }
  writeSave(save);
}

async function shareRun() {
  const r = G.lastRun;
  if (!r || sharing) return;
  sharing = true;
  sfx.blip([880], 0.05, 0.05);
  try {
    if (!r.card) prepareCard(r);
    const { cv, blob } = await r.card;
    let app = ''; // Android: package of the app picked in the share sheet
    const text = trf('Desci {0} m de cachoeira dentro de um barril no modo {1}! Consegue me passar? {2}', r.m, r.diffName, SHARE_URL);
    const cap = window.Capacitor;
    if (cap && typeof cap.nativePromise === 'function') {
      // Android app: the WebView has no Web Share, so save the PNG in the cache and use the share sheet.
      const data = cv.toDataURL('image/png').split(',')[1];
      const { uri } = await cap.nativePromise('Filesystem', 'writeFile', { path: 'cataratas-descida.png', data, directory: 'CACHE' });
      const res = await cap.nativePromise('Share', 'share', { title: tr('Cataratas no Barril'), text, files: [uri], dialogTitle: 'Compartilhar descida' });
      app = (res && typeof res.activityType === 'string' && res.activityType) || '';
    } else {
      const file = new File([blob], 'cataratas-descida.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text, title: tr('Cataratas no Barril') });
      } else {
        // no Web Share with files (desktop browsers): download the image instead
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
    }
    achOnShare(app);
  } catch {
    /* share sheet closed (canceled) or not available: no badge */
  } finally {
    sharing = false;
  }
}

function toTitle() {
  refreshClockNote();
  if (performance.now() < G.lockUntil) return;
  G.state = 'title';
  show(ui.over, false);
  refreshPeriod();
  refreshDaily();
  show(ui.title, true);
}

function pause() {
  if (G.state !== 'playing') return;
  show(ui.say, false);
  sayState.t = 0;
  extrasRunStop();
  G.state = 'paused';
  torchSet(false);
  show(ui.torchBtn, false);
  show(ui.pause, true);
  disarmQuit();
  refreshPauseToggles();
  G.run.paused = true;
  G.run.pauses++;
  unlock('pause');
  sfx.suspend();
}

function resume() {
  if (G.state !== 'paused') return;
  if (!ui.rotate.hidden) return;
  G.state = 'playing';
  show(ui.pause, false);
  sfx.resume();
  input.calibrate(); // the phone may be held differently now (or the sensor slept while paused)
  extrasRunStart();
  acc = 0;
  last = performance.now();
  G.hitStopUntil = last + 350; // short beat to get your grip back
}

// Pause menu: sound and music toggles (the same settings as AJUSTES) and SAIR DA DESCIDA, which
// asks for a second tap and throws the run away: no metres for the record, ranking or totals,
// and the coins picked up in it are taken back. Badges and challenges already earned stay.
function refreshPauseToggles() {
  for (const [btn, on, name] of [[ui.pauseSound, save.sound, tr('SOM')], [ui.pauseMusic, save.music, tr('MÚSICA')]]) {
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', trf('{0}: {1}', name, on ? tr('ligado') : tr('desligado')));
  }
}
let quitArmed = 0;
function disarmQuit() {
  clearTimeout(quitArmed);
  quitArmed = 0;
  ui.pauseQuit.classList.remove('armed');
  show(ui.pauseWarn, false);
}
function quitRun() {
  if (G.state !== 'paused') return;
  if (!quitArmed) {
    ui.pauseQuit.classList.add('armed');
    show(ui.pauseWarn, true);
    quitArmed = setTimeout(disarmQuit, 4000);
    sfx.blip([330, 262], 0.08, 0.05);
    return;
  }
  disarmQuit();
  const m = G.meters;
  if (G.run.coins > 0) {
    myLedger().e = Math.max(0, myLedger().e - G.run.coins); // the run's coins go back to the river
    recalcCoins();
  }
  tutEnd(false);
  G.state = 'title';
  G.runDiff = -1;
  input.setTap(tapMode);
  torchSet(false);
  micClose();
  endCheer();
  sfx.resume();
  sfx.stopWater(0.2);
  sfx.stopMusic();
  show(ui.pause, false);
  show(ui.hud, false);
  show(ui.torchBtn, false);
  show(ui.hint, false);
  show(ui.say, false);
  G.rocks.length = 0;
  G.bubbles.length = 0;
  G.pickups.length = 0;
  G.fx = {};
  unlock('arregou');
  if (m >= 1000) unlock('arregou1000');
  writeSave(save);
  releaseWakeLock();
  refreshPeriod();
  refreshDaily();
  refreshAchCount();
  show(ui.title, true);
  G.lockUntil = performance.now() + 500;
}

function milestone(m) {
  popText(`${m} m!`, '');
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
  const txt = t < 0.12 ? 'U' : t < 0.3 ? tr('UO') : t < 0.45 ? tr('UOO') : trf('UOO{0}{1}', 'E'.repeat(Math.min(8, 1 + Math.floor((t - 0.45) * 9))), t > 1.2 ? '!' : '');
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
    upsideStep(dt);
    G.cam += 38 * dt;
    G.bx += (W / 2 - G.bx) * (1 - Math.exp(-3 * dt));
  } else if (G.state === 'playing') {
    const dist = G.cam - G.startCam;
    const d = diff(dist);
    G.speed = speedFor(d) * G.cfg.speed * (G.fx.slow > 0 ? SLOW_K : 1);
    G.cam += G.speed * dt;
    G.playT += dt;
    micStep(dt);
    fireStep(dt); // before tickFx, which would drop the fire at zero
    if (G.state !== 'playing') return; // burnt down
    tickFx(dt);

    // no steering while the barrel is still floating down onto its row
    const steer = input.getSteer(dt) * (G.fx.invert > 0 ? -1 : 1) * (G.landed ? 1 : 0);
    const grip = G.run.weather === 'snow' ? 3.2 : 14; // NEVE: the barrel slides on the ice
    G.vx += (steer * MAX_VX - G.vx) * (1 - Math.exp(-grip * dt));
    G.bx += G.vx * dt;
    windStep(dt);
    weatherStep(dt);
    stormStep(dt);
    if (G.state !== 'playing') return; // struck by lightning
    if (ui.torchBtn.hidden === torchWanted()) show(ui.torchBtn, torchWanted());

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
      if (r.fake) {
        if (Math.hypot(r.x - G.bx, r.wy - by) < r.r + HIT_R * barrelScale()) {
          for (let j = 0; j < 8; j++) emit(r.x, r.wy, (Math.random() * 2 - 1) * 40, (Math.random() * 2 - 1) * 40, 0.4, j % 2 ? '#ffe2b8' : '#ffffff', 1, 0);
          continue; // it was never there
        }
        G.rocks[w++] = r;
        continue;
      }
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
    const pull = 1 - Math.exp(-7 * dt);
    const magR = G.fx.magnet > 0 ? MAGNET_R : G.run.tuned ? TUNE_MAGNET[save.tune.magnet] : 0;
    let wb = 0;
    for (let k = 0; k < G.bubbles.length; k++) {
      const b = G.bubbles[k];
      if (b.wy < G.cam - 24) continue;
      if (magR && Math.hypot(b.x - G.bx, b.wy - by) < magR) {
        b.x += (G.bx - b.x) * pull;
        b.wy += (by - b.wy) * pull;
      }
      const bx = b.x + Math.sin(G.t * 2 + b.ph) * 2;
      const dx = bx - G.bx;
      const dy = b.wy - by;
      const rr = HIT_R * barrelScale() + BUBBLE_R;
      if (G.landed && dx * dx + dy * dy < rr * rr) {
        collectBubble(b, bx);
        continue;
      }
      G.bubbles[wb++] = b;
    }
    G.bubbles.length = wb;

    let wp = 0;
    for (let k = 0; k < G.pickups.length; k++) {
      const pk = G.pickups[k];
      if (pk.wy < G.cam - 24) continue;
      const rr = HIT_R * barrelScale() + PICKUP_R;
      if (G.landed && Math.hypot(pk.x - G.bx, pk.wy - by) < rr) {
        takePickup(pk, pk.x);
        continue;
      }
      G.pickups[wp++] = pk;
    }
    G.pickups.length = wp;

    if (G.landed && !(G.fx.ghost > 0)) {
      const hit = hitTest(by);
      if (hit && G.fx.shield) shieldSave(hit, by);
      else if (hit && G.hp > 1) takeHit(hit, by);
      else if (hit) {
        G.hp = 0;
        refreshHp();
        die();
        return;
      }
    } else if (G.fx.ghost > 0) {
      // invulnerable for a moment after the shield pops: keep the barrel off the walls
      const hw = HIT_R * barrelScale();
      G.bx = clamp(G.bx, wallL(by) + hw, wallR(by) - hw);
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
      if (DEMO && m >= DEMO_M && G.state === 'playing') return demoWin();
      if (m >= G.nextMilestone) {
        milestone(G.nextMilestone);
        G.nextMilestone += 100;
      }
      if (!G.beatBest && save.best > 0 && m > save.best) {
        G.beatBest = true;
        sayMaybe(SAYS_REC, 0.6);
        ui.best.textContent = tr('NOVO REC!');
        ui.best.classList.add('beat');
        sfx.blip([784, 1047, 1319], 0.07, 0.06);
        unlock('record');
      }
    }
    if (G.tut) tutStep();
    if (G.hintShown && G.playT > G.hintHideAt) {
      show(ui.hint, false);
      G.hintShown = false;
    }
    sayStep(dt);
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
    if (G.deathT > 1.0) {
      if (canRevive()) openRevive();
      else gameOver();
    }
  } else if (G.state === 'revive') {
    updateDebris(dt);
    G.cam += 14 * dt;
    reviveStep(dt);
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

// Barrel size factor from the mini / inflated effects.
function barrelScale() {
  return G.fx.mini > 0 ? 0.6 : G.fx.big > 0 ? 1.35 : 1;
}

// What the barrel is hitting: 'wall', a rock object, or null.
function hitTest(by) {
  const k = barrelScale();
  const R = HIT_R * k;
  // Walls: sample the barrel's top, middle and bottom (it's taller than wide).
  for (const dy of [-9, 0, 9]) {
    const hw = (dy === 0 ? R : R * 0.75) - 1; // a graze is not a crash
    const wy = by + dy * k;
    if (G.bx - hw < wallL(wy) || G.bx + hw > wallR(wy)) return 'wall';
  }
  for (const r of G.rocks) {
    if (r.fake) continue;
    const dx = r.x - G.bx;
    const dy = r.wy - by;
    const rr = r.r * 0.82 + R;
    if (dx * dx + dy * dy < rr * rr) return r;
  }
  return null;
}

// ---------- power-ups ----------
function tickFx(dt) {
  for (const id of Object.keys(G.fx)) {
    if (id === 'shield') continue;
    G.fx[id] -= dt;
    if (G.fx[id] <= 0) delete G.fx[id];
  }
}

function takePickup(pk, x) {
  // "?" rolls any of the 8 powers, every one equally likely
  const mystery = pk.id === 'mystery';
  const roll = POWERS.filter((p) => !p.mic || micLive());
  const pw = mystery ? roll[Math.floor(Math.random() * roll.length)] : POWER_BY_ID[pk.id];
  // mini and inflated cancel each other out
  if (pw.id === 'mini') delete G.fx.big;
  if (pw.id === 'big') delete G.fx.mini;
  G.fx[pw.id] = pw.dur || 1;
  popText(mystery ? `? ${pw.name}` : pw.name, pw.good ? '' : 'bad');
  if (pw.id === 'fire') {
    G.run.fired = true; // GAROTA EM CHAMAS
    ui.hint.innerHTML = tr('ASSOPRE O<br>MICROFONE!');
    show(ui.hint, true);
  }
  const result = () => (pw.good ? sfx.blip([523, 784, 1047, 1568], 0.05, 0.06) : sfx.blip([392, 311, 233, 175], 0.07, 0.06));
  if (mystery) {
    sfx.blip([660, 880, 660, 880], 0.04, 0.05); // roulette, then the result
    setTimeout(result, 170);
  } else result();
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    emit(x, pk.wy, Math.cos(a) * 55, Math.sin(a) * 55 + G.speed * 0.5, 0.4, pw.good ? (k % 2 ? '#3ddc5a' : '#ffffff') : k % 2 ? '#ff3b3b' : '#ff7ad9', 1, 0);
  }
  achOnPickup(pw, mystery);
}

// Clears what the barrel just hit: rocks in the way shatter, walls bounce you back.
function clearHit(hit, by) {
  if (hit === 'bolt') return;
  if (hit === 'wall') {
    G.bx += (W / 2 - G.bx) * 0.25;
    G.vx = 0;
  } else {
    const R = HIT_R * barrelScale() + 6;
    G.rocks = G.rocks.filter((r) => {
      const near = Math.hypot(r.x - G.bx, r.wy - by) < r.r + R;
      if (near) {
        for (let k = 0; k < 8; k++) emit(r.x, r.wy, (Math.random() * 2 - 1) * 70, (Math.random() * 2 - 1) * 70, 0.6, k % 2 ? '#7c8393' : '#b7bfcc', 2, 150);
      }
      return !near;
    });
  }
}

// The shield pops instead of the barrel.
function shieldSave(hit, by) {
  delete G.fx.shield;
  G.fx.ghost = 1;
  G.trauma = Math.min(1, G.trauma + 0.45);
  sfx.splash();
  sfx.blip([1568, 1047, 784], 0.05, 0.06);
  clearHit(hit, by);
  if (G.runDiff === 2) unlock('hardshield');
  G.run.saves++;
  checkDaily();
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    emit(G.bx, by, Math.cos(a) * 80, Math.sin(a) * 80, 0.4, '#bfe3ff', 1, 0);
  }
  unlock('saved');
}

// A hit that doesn't break the barrel yet: it cracks, blinks and can't be hit for a second.
function takeHit(hit, by) {
  G.hp--;
  sayMaybe(SAYS_HIT, 0.4);
  G.run.hits++;
  if (G.meters < 50) G.run.earlyHit = true;
  refreshHp();
  G.fx.ghost = 1;
  G.hitStopUntil = performance.now() + 70;
  G.trauma = Math.min(1, G.trauma + 0.6);
  sfx.crash();
  if (navigator.vibrate) navigator.vibrate(60);
  clearHit(hit, by);
  popText(G.hp === 1 ? tr('POR UM FIO!') : tr('RACHOU!'), 'bad');
  for (let k = 0; k < 12; k++) {
    const a = Math.random() * Math.PI * 2;
    const v = 30 + Math.random() * 50;
    emit(G.bx, by, Math.cos(a) * v, Math.sin(a) * v - 20, 0.6 + Math.random() * 0.4, k % 3 ? '#a66a31' : '#6e4420', 1 + (k & 1), 160);
  }
}

// The wrench bubble mends one crack. It never adds a hit above G.maxHp.
function repair(b, x) {
  const fixed = G.hp < G.maxHp;
  const wasLast = G.hp === 1;
  if (fixed) {
    G.hp++;
    save.repairs++;
    G.run.repairs++;
    checkDaily();
    unlock('repair1');
    if (wasLast) unlock('comeback');
    if (save.repairs >= 10) unlock('doctor');
    if (save.repairs >= 25) unlock('repair25');
    if (G.run.repairs >= 3) unlock('plumber');
  }
  refreshHp();
  popText(fixed ? tr('CONSERTOU!') : tr('JÁ TÁ INTEIRO!'), '');
  sfx.blip([523, 659, 784, 1047], 0.05, 0.06);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    emit(x, b.wy, Math.cos(a) * 50, Math.sin(a) * 50 + G.speed * 0.6, 0.4, k % 2 ? '#ffffff' : '#5cf08a', 1, 0);
  }
}

function refreshHp() {
  ui.hpIcons.forEach((el, k) => {
    el.classList.toggle('lost', k >= G.hp);
    el.style.display = k < G.maxHp && G.maxHp > 1 ? '' : 'none'; // DIFÍCIL: sudden death, no hit counter
  });
}

function popText(txt, cls) {
  ui.pop.textContent = txt;
  ui.pop.className = '';
  ui.pop.style.setProperty('--chars', txt.length);
  void ui.pop.offsetWidth; // restart the CSS animation
  ui.pop.className = `show ${cls || ''}${txt.length > 14 ? ' long' : ''}`.trim();
}

function collectBubble(b, x) {
  if (b.wrench) return repair(b, x);
  const v = b.v * (G.fx.double > 0 ? 2 : 1) * (G.run.weather === 'wind' ? 2 : 1); // VENTANIA pays double
  G.run.coins += v;
  G.run.bubbles++;
  addCoins(v);
  save.coinsTotal += v;
  save.bubbles++;
  ui.hudCoins.textContent = G.run.coins;
  ui.hudCoinBox.classList.remove('bump');
  void ui.hudCoinBox.offsetWidth; // restart the CSS animation
  ui.hudCoinBox.classList.add('bump');
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
  if (G.fx.slow > 0 && ++G.run.slowGraze >= 3) unlock('escolhido'); // three grazes in one CÂMERA LENTA
  if (!(G.fx.slow > 0)) G.run.slowGraze = 0;
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
  const mirage = G.run && G.run.weather === 'mirage' && G.state !== 'title';
  for (const r of G.rocks) {
    const sy = Math.round(r.wy - cam);
    if (sy < -20 || sy > H + 20) continue;
    const s = r.spr;
    const wob = mirage ? Math.round(Math.sin(G.t * 6 + r.wy * 0.15) * (r.fake ? 1.5 : 1)) : 0;
    const x0 = Math.round(r.x) - (s.width >> 1) + wob;
    if (r.fake) ctx.globalAlpha = 0.72 + 0.2 * Math.sin(G.t * 4 + r.x);
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
    ctx.globalAlpha = 1;
  }

  // coin bubbles
  for (const b of G.bubbles) {
    const sy = Math.round(b.wy - cam + Math.sin(G.t * 3 + b.ph));
    if (sy < -10 || sy > H + 10) continue;
    const spr = b.wrench ? wrenchSpr : bubbleSprs[b.gold ? 1 : 0];
    ctx.drawImage(spr, Math.round(b.x + Math.sin(G.t * 2 + b.ph) * 2) - (spr.width >> 1), sy - (spr.height >> 1));
  }

  // power-ups / downs (blink a little so they read as "special")
  for (const pk of G.pickups) {
    const sy = Math.round(pk.wy - cam + Math.sin(G.t * 4 + pk.ph) * 1.5);
    if (sy < -12 || sy > H + 12) continue;
    const spr = capsuleSprs[pk.id];
    ctx.drawImage(spr, Math.round(pk.x) - (spr.width >> 1), sy - (spr.height >> 1));
  }

  // crash: barrel pieces and the rider flying out
  for (const p of G.debris) {
    ctx.save();
    ctx.translate(Math.round(p.x), Math.round(p.y - cam));
    ctx.rotate(p.rot);
    ctx.drawImage(barrelDmg[Math.min(2, G.maxHp - 1)], p.sx, p.sy, p.sw, p.sh, -p.sw / 2, -p.sh / 2, p.sw, p.sh);
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
    const ks = barrelScale();
    const ghostBlink = G.fx.ghost > 0 && Math.floor(G.t * 20) % 2 === 0;
    ctx.save();
    if (ghostBlink) ctx.globalAlpha = 0.45;
    ctx.translate(Math.round(bx), by);
    ctx.rotate(rot);
    ctx.scale(sx * ks, sy * ks);
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
    drawRiderInBarrel(ctx, 0, -BARREL_H / 2, riderSprs[look], riderSkin, barrelDmg[Math.min(2, G.maxHp - Math.max(1, G.hp))], lift);
    ctx.restore();
    if (G.fx.shield) {
      ctx.strokeStyle = Math.floor(G.t * 6) % 2 ? '#bfe3ff' : '#7fd3ff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(Math.round(bx) + 0.5, by + 0.5, 16 * ks, 0, Math.PI * 2);
      ctx.stroke();
    }
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

  drawAtmosphere(bx);
  drawStorm();

  // fog power-down: only a small circle around the barrel stays visible
  if (G.fx.fog > 0 && G.state === 'playing') {
    // rolls in slowly (about 2.5 s) and closes the clear circle around the barrel as it thickens
    const grow = Math.min(1, (POWER_BY_ID.fog.dur - G.fx.fog) / 2.5);
    const ease = grow * grow * (3 - 2 * grow);
    const fade = Math.min(1, G.fx.fog / 0.8, ease);
    const cx = Math.round(bx);
    const cy = Math.round(curBY);
    const r0 = 20 + 40 * (1 - ease);
    const gr = ctx.createRadialGradient(cx, cy, r0, cx, cy, r0 + 38 + 40 * (1 - ease));
    gr.addColorStop(0, 'rgba(225,235,245,0)');
    gr.addColorStop(1, `rgba(225,235,245,${0.96 * fade})`);
    ctx.fillStyle = gr;
    ctx.fillRect(-8, -8, W + 16, H + 16);
  }

  drawCrowd();
  drawFxHud();

  if (G.flash > 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(-8, -8, W + 16, H + 16);
  }
}

// Active effects, top right under the record and the weather badge: icon + bar for the time left.
function drawFxHud() {
  if (G.state !== 'playing' && G.state !== 'paused') return;
  let x = W - 13;
  for (const pw of POWERS) {
    const left = G.fx[pw.id];
    if (!(left > 0)) continue;
    ctx.drawImage(iconSprs[pw.id], x, fxHudY);
    if (pw.dur) {
      ctx.fillStyle = '#0f1117';
      ctx.fillRect(x, fxHudY + 11, 9, 2);
      ctx.fillStyle = pw.good ? '#3ddc5a' : '#ff3b3b';
      ctx.fillRect(x, fxHudY + 11, Math.max(1, Math.round((9 * left) / pw.dur)), 2);
    }
    x -= 12;
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
  if (ad.ok) syncBanner();
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
  layoutFxHud();
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
  // how to steer is shown when the run starts; the title only warns when the sensor can't work
  ui.howTo.innerHTML = tr('ABRA EM HTTPS PARA<br>USAR O SENSOR');
  show(ui.howTo, !tapMode && !pcMode && !tiltAvailable);
  show(ui.micBtn, DEVICE_CAN.mic);
  show(ui.notifBtn, canNotify());
  show(ui.stepsBtn, DEVICE_CAN.steps);
  for (const [btn, on, name] of [
    [ui.stepsBtn, save.steps, tr('Passos')],
    [ui.notifBtn, save.notify, tr('Lembretes')],
    [ui.micBtn, save.mic, tr('Microfone')],
    [ui.soundBtn, save.sound, tr('Som')],
    [ui.musicBtn, save.music, tr('Música')],
    [ui.shakeBtn, save.shake, tr('Tremor')],
  ]) {
    btn.classList.toggle('off', !on);
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', trf('{0}: {1}', name, on ? tr('ligado') : tr('desligado')));
  }
  ui.diffBtn.textContent = trf('MODO: {0}', DIFFS[save.diff].name);
  ui.diffBtn.setAttribute('aria-label', trf('Dificuldade: {0}', DIFFS[save.diff].name));
  ui.diffBtn.dataset.diff = save.diff;
  refreshDaily();
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
bindToggle(ui.notifBtn, () => {
  save.notify = !save.notify;
  if (save.notify) askNotify();
  else scheduleReminders(); // cancels the pending ones
});
bindToggle(ui.stepsBtn, () => {
  save.steps = !save.steps;
  if (!save.steps) return;
  // asks for the "physical activity" permission the first time
  readSteps(true).then((r) => {
    if (r && r.steps < 0 && r.reason === 'permission') {
      save.steps = false;
      writeSave(save);
      refreshToggles();
      ui.micInfo.textContent = tr('SEM A PERMISSÃO DE ATIVIDADE FÍSICA O JOGO NÃO CONSEGUE LER OS PASSOS.');
    } else if (r && r.steps >= 0) ui.micInfo.textContent = tr('PASSOS LIGADOS: ANDE E VOLTE PRA DESCER. OS PASSOS FICAM SÓ NO SEU CELULAR.');
  });
});
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
// The difficulty's description pops up under the button after it's changed, long enough to read.
let diffNoteTimer = 0;
function flashDiffNote() {
  ui.diffNote.innerHTML = DIFFS[save.diff].note;
  show(ui.diffNote, true);
  ui.diffNote.classList.remove('up');
  if (ui.diffNote.getBoundingClientRect().bottom > window.innerHeight - 8) ui.diffNote.classList.add('up');
  clearTimeout(diffNoteTimer);
  diffNoteTimer = setTimeout(() => show(ui.diffNote, false), 10000);
}
bindToggle(ui.diffBtn, () => {
  save.diff = (save.diff + 1) % 3;
  input.sens = DIFFS[save.diff].sens;
  flashDiffNote();
  input.requestPermission(); // also a good moment to get the iOS motion prompt out of the way
});

// ---------- diamonds, OFICINA, BANCO, ads and purchases ----------
// DIAMANTES are the rare currency: weekend challenges, the first run of the day, linking Google
// and the BANCO (in-app purchases). They buy the diamond-only skins, the OFICINA upgrades and the
// SOBREVIDA. They live in the same per-install ledger as the coins (fields g / gs).
const GEM_ICON = '<i class="gem" aria-hidden="true"></i>';
const WEEKEND_GEMS = 2; // per weekend challenge
const GOOGLE_GEMS = 3; // once, for linking a Google account in the ranking
const REVIVE_GEMS = 3;
const REVIVE_SECS = 7; // the SOBREVIDA offer waits this long, then the run ends
const GEM_TRADE = [5, 150]; // diamonds -> coins in the BANCO

function addGems(n) {
  const l = myLedger();
  l.g = (l.g || 0) + n;
  recalcCoins();
  refreshGems();
}
function spendGems(n) {
  if (save.gems < n) return false;
  const l = myLedger();
  l.gs = (l.gs || 0) + n;
  recalcCoins();
  refreshGems();
  return true;
}
function refreshGems() {
  for (const el of [ui.titleGems, ui.shopGems, ui.storeGems]) if (el) el.textContent = save.gems;
  if (ui.storeCoins) ui.storeCoins.textContent = save.coins;
}
function gemToast(n, head, name) {
  toastQueue.push({ head, name, sub: trf('+{0} {1}', n, n === 1 ? tr('DIAMANTE') : tr('DIAMANTES')) });
  if (!toastTimer) nextToast();
}

// First run of the day (Brasília day): 1 to 3 diamonds, shown on the game-over screen.
function dayGems() {
  const key = todayKey();
  if (save.gemDay === key) return 0;
  save.gemDay = key;
  const n = 1 + Math.floor(Math.random() * 3);
  addGems(n);
  return n;
}

// ---- OFICINA: upgrades for every barrel, bought with diamonds ----
// A run with them on is "tunada": it counts for trophies, challenges and coins, not for the ranking.
const TUNES = [
  { id: 'hull', name: tr('CASCO REFORÇADO'), lv: [tr('+1 VIDA EM TODA DESCIDA'), tr('+2 VIDAS EM TODA DESCIDA')], cost: [12, 30] },
  { id: 'magnet', name: tr('ÍMÃ NO CASCO'), lv: [tr('PUXA AS BOLHAS DE PERTO'), tr('PUXA AS BOLHAS DE MAIS LONGE'), tr('PUXA AS BOLHAS DE BEM LONGE')], cost: [5, 12, 25] },
  { id: 'shield', name: tr('ESCUDO DE LARGADA'), lv: [tr('COMEÇA A DESCIDA COM ESCUDO'), tr('+ UM ESCUDO NOVO AOS 500 M'), tr('+ OUTRO ESCUDO AOS 1000 M')], cost: [8, 18, 30] },
];
const TUNE_MAGNET = [0, 28, 42, 58]; // px, by level (the ÍMÃ power-up pulls from 80)
const tunedRun = () => save.tuneOn && TUNES.some((t) => save.tune[t.id] > 0);

function renderTune() {
  const body = ui.tuneBody;
  body.textContent = '';
  const intro = document.createElement('p');
  intro.className = 'tune-intro';
  intro.textContent = tr('AS MELHORIAS VALEM PRA QUALQUER BARRIL. DESCIDA TUNADA CONTA PRA TROFÉUS, DESAFIOS E MOEDAS, MAS NÃO PRO RANKING.');
  const tog = document.createElement('button');
  tog.type = 'button';
  tog.className = `tune-toggle${save.tuneOn ? ' on' : ''}`;
  tog.dataset.act = 'toggle';
  tog.setAttribute('aria-pressed', String(save.tuneOn));
  tog.textContent = save.tuneOn ? tr('TUNAGEM: LIGADA') : tr('TUNAGEM: DESLIGADA (VALE RANKING)');
  body.append(intro, tog);
  for (const t of TUNES) {
    const lvl = save.tune[t.id];
    const max = lvl >= t.cost.length;
    const row = document.createElement('div');
    row.className = 'tune-row';
    const pips = t.cost.map((_, k) => `<i class="pip${k < lvl ? ' on' : ''}"></i>`).join('');
    const now = lvl ? t.lv[lvl - 1] : tr('SEM MELHORIA');
    const next = max ? tr('NO MÁXIMO!') : trf('PRÓXIMO: {0}', t.lv[lvl]);
    row.innerHTML = `<p class="tune-name">${t.name}</p><p class="tune-pips" aria-label="Nível ${lvl} de ${t.cost.length}">${pips}</p><p class="tune-now">${now}</p><p class="tune-next">${next}</p>`;
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.act = t.id;
    if (max) {
      b.textContent = tr('MÁXIMO');
      b.className = 'using';
    } else {
      const c = t.cost[lvl];
      b.innerHTML = save.gems >= c ? trf('MELHORAR: {0}{1}', GEM_ICON, c) : trf('FALTAM {0}{1}', GEM_ICON, c - save.gems);
      if (save.gems < c) b.className = 'wait';
    }
    row.append(b);
    body.append(row);
  }
}
function tuneAct(e) {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.act === 'toggle') {
    save.tuneOn = !save.tuneOn;
    sfx.blip([660, 880], 0.05, 0.05);
  } else {
    const t = TUNES.find((x) => x.id === b.dataset.act);
    const lvl = save.tune[t.id];
    if (lvl >= t.cost.length) return;
    if (save.gems < t.cost[lvl]) {
      sfx.blip([220, 180], 0.08, 0.05);
      openStore(ui.shop);
      return;
    }
    spendGems(t.cost[lvl]);
    save.tune[t.id]++;
    sfx.blip([523, 659, 784, 1047, 1319], 0.06, 0.06);
    unlock('tune1');
    if (TUNES.every((x) => save.tune[x.id] >= x.cost.length)) unlock('tunemax');
    cloudSoon();
  }
  writeSave(save);
  renderTune();
}

// ---- ads (AdMob, Android app only) ----
// A banner at the bottom of the menus (never during a run), a full-screen ad now and then between
// runs (adBreak: never for new players, at most one every AD_GAP_RUNS game overs and AD_GAP_MS),
// and a rewarded video the player can pick for the SOBREVIDA. REMOVER ANÚNCIOS turns off the banner
// and the full-screen ones; the rewarded video stays, since only the player starts it.
// Real AdMob units (app id in android/app/src/main/res/values/strings.xml). Never click your own
// ads: register your phone under AdMob > Settings > Test devices, so it gets test ads.
// Google's test units, for switching back: banner 9214589741, interstitial 1033173712, rewarded
// 5224354917 (all ca-app-pub-3940256099942544/…), app id ca-app-pub-3940256099942544~3347511713.
const ADS = {
  banner: 'ca-app-pub-1268637111637402/4358990240',
  interstitial: 'ca-app-pub-1268637111637402/5377005558',
  rewarded: 'ca-app-pub-1268637111637402/4746003056',
  testing: false,
};
const AD_GAP_RUNS = 4;
const AD_GAP_MS = 4 * 60e3;
const AD_FIRST_RUNS = 5;
const ad = { ok: false, made: false, shown: false, h: 0, inter: false, reward: false, runs: 0, last: performance.now(), after: null, afterReward: null, earned: false, loadingI: false, loadingR: false };
const adsNative = () => NATIVE_ANDROID && !params.has('test') && !!window.Capacitor && typeof window.Capacitor.nativePromise === 'function';
const adCall = (m, o = {}) => window.Capacitor.nativePromise('AdMob', m, o);
const adOpts = (adId) => ({ adId, isTesting: ADS.testing });

async function initAds() {
  if (!adsNative()) return;
  try {
    await adCall('initialize', { initializeForTesting: ADS.testing, tagForChildDirectedTreatment: false });
    // consent (UMP): only asks where the law requires it (EU/UK). If the request itself fails
    // (offline, DNS blocker), ads still try: the SDK serves non-personalised ones without consent.
    const info = await adCall('requestConsentInfo', {})
      .then((i) => (i.status === 'REQUIRED' && i.isConsentFormAvailable ? adCall('showConsentForm', {}) : i))
      .catch(() => null);
    if (info) {
      show(ui.adPrivacyBtn, info.privacyOptionsRequirementStatus === 'REQUIRED');
      if (!info.canRequestAds && info.status === 'REQUIRED') return;
    }
    const cap = window.Capacitor;
    cap.addListener('AdMob', 'bannerAdSizeChanged', (e) => {
      ad.h = (e && e.height) || 0;
      setAdPad();
    });
    const interDone = () => {
      const f = ad.after;
      ad.after = null;
      loadInter();
      if (f) f();
    };
    cap.addListener('AdMob', 'interstitialAdDismissed', interDone);
    cap.addListener('AdMob', 'interstitialAdFailedToShow', interDone);
    cap.addListener('AdMob', 'onRewardedVideoAdReward', () => (ad.earned = true));
    cap.addListener('AdMob', 'onRewardedVideoAdDismissed', rewardDone);
    cap.addListener('AdMob', 'onRewardedVideoAdFailedToShow', rewardDone);
    ad.ok = true;
    loadInter();
    loadReward();
  } catch {
    /* no ads: the game goes on */
  }
}
function setAdPad() {
  document.documentElement.style.setProperty('--ad-h', `${ad.shown ? ad.h : 0}px`);
}
// Called every frame: the banner shows on the title and game-over screens only.
function syncBanner() {
  const want = ad.ok && !save.noAds && flagOn('ads') && (G.state === 'title' || G.state === 'over');
  if (want === ad.shown) return;
  ad.shown = want;
  if (want) {
    if (ad.made) adCall('resumeBanner').catch(() => {});
    else {
      ad.made = true;
      adCall('showBanner', { ...adOpts(ADS.banner), adSize: 'ADAPTIVE_BANNER', position: 'BOTTOM_CENTER', margin: 0 }).catch(() => (ad.made = false));
    }
  } else if (ad.made) adCall(save.noAds ? 'removeBanner' : 'hideBanner').catch(() => {});
  if (save.noAds) ad.made = false;
  setAdPad();
}
// Both are loaded ahead of time; a failed load (offline) is retried at the next game over.
function loadInter() {
  if (!ad.ok || save.noAds || ad.inter || ad.loadingI) return;
  ad.loadingI = true;
  adCall('prepareInterstitial', adOpts(ADS.interstitial))
    .then(() => (ad.inter = true))
    .catch(() => {})
    .finally(() => (ad.loadingI = false));
}
function loadReward() {
  if (!ad.ok || ad.reward || ad.loadingR) return;
  ad.loadingR = true;
  adCall('prepareRewardVideoAd', adOpts(ADS.rewarded))
    .then(() => (ad.reward = true))
    .catch(() => {})
    .finally(() => (ad.loadingR = false));
}
// Between runs (DE NOVO / MENU): maybe a full-screen ad first, then go on.
function adBreak(then) {
  const now = performance.now();
  if (!ad.ok || save.noAds || !flagOn('ads') || !ad.inter || save.runs < AD_FIRST_RUNS || ad.runs < AD_GAP_RUNS || now - ad.last < AD_GAP_MS) return then();
  ad.inter = false;
  ad.runs = 0;
  ad.last = now;
  ad.after = then;
  G.fromAd = true; // the next calibration waits longer
  adCall('showInterstitial').catch(() => {
    ad.after = null;
    then();
  });
}
const canRewardAd = () => ad.ok && ad.reward && flagOn('ads');
function watchReward(done) {
  ad.reward = false;
  ad.earned = false;
  ad.afterReward = done;
  ad.last = performance.now(); // a video just played: no full-screen ad right after
  ad.runs = 0;
  adCall('showRewardVideoAd').catch(rewardDone);
}
function rewardDone() {
  const f = ad.afterReward;
  ad.afterReward = null;
  loadReward();
  if (f) f(ad.earned);
}

// ---- purchases (Google Play Billing through @capgo/native-purchases, Android app only) ----
// Product ids must match the ones created in the Play Console (Produtos no app). Diamonds and
// coins are consumables; sem_anuncios is bought once and comes back with RESTAURAR COMPRAS.
const IAP = [
  { id: 'diamantes_10', gems: 10, name: tr('10 DIAMANTES') },
  { id: 'diamantes_30', gems: 30, name: tr('30 DIAMANTES'), tag: tr('+ POPULAR') },
  { id: 'diamantes_80', gems: 80, name: tr('80 DIAMANTES'), tag: tr('MELHOR PREÇO') },
  { id: 'moedas_500', coins: 500, name: tr('500 MOEDAS') },
  { id: 'moedas_1500', coins: 1500, name: tr('1500 MOEDAS') },
  { id: 'sem_anuncios', noAds: true, name: tr('REMOVER ANÚNCIOS') },
];
const iap = { ok: false, prices: {}, busy: false, msg: '' };
const iapCall = (m, o = {}) => window.Capacitor.nativePromise('NativePurchases', m, o);

async function initIap() {
  if (!NATIVE_ANDROID || params.has('test') || !window.Capacitor || typeof window.Capacitor.nativePromise !== 'function') return;
  try {
    const r = await iapCall('isBillingSupported');
    if (!r || !r.isBillingSupported) return;
    iap.ok = true;
    const { products } = await iapCall('getProducts', { productIdentifiers: IAP.map((p) => p.id), productType: 'inapp' });
    for (const p of products || []) iap.prices[p.identifier] = p.priceString;
    await ownedPurchases();
  } catch {
    /* no billing (emulator without Play, or products not created yet) */
  }
  if (!ui.store.hidden) renderStore();
}
// sem_anuncios already bought (new phone, reinstall) and consumables that never got credited.
async function ownedPurchases() {
  const { purchases } = await iapCall('getPurchases', { productType: 'inapp' });
  for (const t of purchases || []) {
    const p = IAP.find((x) => x.id === t.productIdentifier);
    if (p && (t.purchaseState === undefined || t.purchaseState === '1')) creditPurchase(p, t.transactionId || t.orderId || p.id, true);
  }
}
function creditPurchase(p, tx, quiet) {
  if (p.noAds) {
    if (save.noAds) return;
    save.noAds = true;
    syncBanner();
  } else {
    if (save.iap[tx]) return;
    save.iap[tx] = true;
    if (p.gems) addGems(p.gems);
    if (p.coins) addCoins(p.coins);
  }
  writeSave(save);
  cloudSoon();
  refreshWallets();
  if (!quiet || !p.noAds) {
    toastQueue.push({ head: tr('COMPRA CONFIRMADA!'), name: p.name, sub: tr('VALEU POR APOIAR O JOGO!') });
    if (!toastTimer) nextToast();
  }
}
async function buyProduct(p) {
  if (!iap.ok || iap.busy) return;
  iap.busy = true;
  iap.msg = tr('ABRINDO A GOOGLE PLAY...');
  renderStore();
  try {
    const t = await iapCall('purchaseProduct', { productIdentifier: p.id, productType: 'inapp', quantity: 1, isConsumable: !p.noAds });
    if (t && t.purchaseState === '0') iap.msg = tr('PAGAMENTO PENDENTE: OS ITENS CHEGAM QUANDO ELE FOR APROVADO.');
    else {
      creditPurchase(p, (t && (t.transactionId || t.orderId)) || `${p.id}:${Date.now()}`);
      iap.msg = '';
    }
  } catch (e) {
    iap.msg = /cancel/i.test(String(e && e.message)) ? '' : tr('A COMPRA NÃO FOI CONCLUÍDA.');
  }
  iap.busy = false;
  renderStore();
}
async function restorePurchases() {
  if (!iap.ok || iap.busy) return;
  iap.busy = true;
  iap.msg = tr('PROCURANDO COMPRAS...');
  renderStore();
  try {
    await iapCall('restorePurchases');
    await ownedPurchases();
    iap.msg = save.noAds ? tr('COMPRAS RESTAURADAS.') : tr('NENHUMA COMPRA PRA RESTAURAR.');
  } catch {
    iap.msg = tr('NÃO DEU PRA FALAR COM A GOOGLE PLAY.');
  }
  iap.busy = false;
  renderStore();
}

// ---- BANCO: the store screen ----
const store = { from: null };
function refreshWallets() {
  refreshGems();
  ui.shopCoins.textContent = save.coins;
  if (!ui.shop.hidden) refreshShop();
}
function openStore(from) {
  store.from = from;
  show(from, false);
  show(ui.store, true);
  renderStore();
  ui.storeBody.scrollTop = 0;
}
function closeStore() {
  show(ui.store, false);
  show(store.from || ui.title, true);
  if (store.from === ui.shop) refreshShop();
  G.lockUntil = performance.now() + 300;
}
function renderStore() {
  refreshGems();
  const body = ui.storeBody;
  body.textContent = '';
  const h3 = (t) => {
    const h = document.createElement('h3');
    h.textContent = t;
    body.append(h);
  };
  const item = (p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'store-item';
    b.dataset.iap = p.id;
    const icon = p.gems ? GEM_ICON : p.coins ? COIN_ICON : '';
    const price = !iap.ok ? tr('SÓ NO APP') : iap.prices[p.id] || '...';
    const owned = p.noAds && save.noAds;
    b.innerHTML = `<span class="si-name">${icon}${p.name}${p.tag ? `<em>${p.tag}</em>` : ''}</span><span class="si-price">${owned ? tr('JÁ É SEU!') : price}</span>`;
    if (owned || !iap.ok || iap.busy || !iap.prices[p.id]) b.disabled = true;
    body.append(b);
  };
  h3(tr('DIAMANTES'));
  IAP.filter((p) => p.gems).forEach(item);
  h3(tr('MOEDAS'));
  IAP.filter((p) => p.coins).forEach(item);
  const trade = document.createElement('button');
  trade.type = 'button';
  trade.className = 'store-item';
  trade.dataset.act = 'trade';
  trade.innerHTML = trf('<span class="si-name">TROCAR {0}{1} POR {2}{3}</span><span class="si-price">{4}</span>', GEM_ICON, GEM_TRADE[0], COIN_ICON, GEM_TRADE[1], save.gems >= GEM_TRADE[0] ? tr('TROCAR') : tr('SEM DIAMANTES'));
  trade.disabled = save.gems < GEM_TRADE[0];
  body.append(trade);
  h3(tr('ANÚNCIOS'));
  item(IAP.find((p) => p.noAds));
  const note = document.createElement('p');
  note.className = 'about-p dim';
  note.textContent = tr('SEM ANÚNCIOS: SOME O BANNER E A PROPAGANDA ENTRE DESCIDAS. O VÍDEO DA SOBREVIDA CONTINUA, SÓ SE VOCÊ QUISER.');
  body.append(note);
  if (iap.ok) {
    const rs = document.createElement('button');
    rs.type = 'button';
    rs.className = 'link';
    rs.dataset.act = 'restore';
    rs.textContent = tr('RESTAURAR COMPRAS');
    body.append(rs);
  }
  const cd = document.createElement('button');
  cd.type = 'button';
  cd.className = 'store-item';
  cd.dataset.act = 'code';
  cd.innerHTML = tr('<span class="si-name">TEM UM CÓDIGO?</span><span class="si-price">RESGATAR</span>');
  body.append(cd);
  h3(tr('DIAMANTES DE GRAÇA'));
  const ul = document.createElement('ul');
  ul.className = 'store-free';
  const today = save.gemDay === todayKey();
  for (const [t, done] of [
    [trf('DESAFIOS DE SÁBADO E DOMINGO: +{0} CADA', WEEKEND_GEMS), false],
    [tr('PRIMEIRA DESCIDA DO DIA: +1 A 3'), today],
    [trf('VINCULAR A CONTA GOOGLE NO RANKING: +{0}', GOOGLE_GEMS), save.gemGoogle],
  ]) {
    const li = document.createElement('li');
    li.className = done ? 'done' : '';
    li.innerHTML = `${GEM_ICON}${t}${done ? ' ✔' : ''}`;
    ul.append(li);
  }
  body.append(ul);
  ui.storeNote.textContent = iap.msg;
}
function storeAct(e) {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  if (b.dataset.iap) buyProduct(IAP.find((p) => p.id === b.dataset.iap));
  else if (b.dataset.act === 'restore') restorePurchases();
  else if (b.dataset.act === 'code') openRedeem(ui.store);
  else if (b.dataset.act === 'trade' && spendGems(GEM_TRADE[0])) {
    addCoins(GEM_TRADE[1]);
    writeSave(save);
    cloudSoon();
    sfx.blip([523, 659, 784, 1047], 0.06, 0.06);
    refreshWallets();
    renderStore();
  }
}

// ---- SOBREVIDA: after the crash, keep going once per run (video or diamonds) ----
// The ranking keeps the metres from before the crash; everything else counts the whole run.
const canRevive = () => !DEMO && !G.run.revived && G.meters >= 30 && (canRewardAd() || save.gems >= REVIVE_GEMS);
function openRevive() {
  G.state = 'revive';
  G.reviveT = REVIVE_SECS;
  G.reviveBusy = false;
  show(ui.hud, false);
  ui.reviveM.textContent = `${G.meters} m`;
  show(ui.reviveAd, canRewardAd());
  ui.reviveGem.innerHTML = save.gems >= REVIVE_GEMS ? trf('USAR {0}{1}', GEM_ICON, REVIVE_GEMS) : trf('FALTAM {0}{1}', GEM_ICON, REVIVE_GEMS - save.gems);
  ui.reviveGem.disabled = save.gems < REVIVE_GEMS;
  ui.reviveBar.style.transform = 'scaleX(1)';
  show(ui.revive, true);
}
function reviveStep(dt) {
  if (G.reviveBusy) return;
  G.reviveT -= dt;
  ui.reviveBar.style.transform = `scaleX(${Math.max(0, G.reviveT / REVIVE_SECS)})`;
  if (G.reviveT <= 0) declineRevive();
}
function declineRevive() {
  if (G.state !== 'revive') return;
  show(ui.revive, false);
  gameOver();
}
function reviveAct(e) {
  const b = e.target.closest('button');
  if (!b || G.state !== 'revive' || G.reviveBusy) return;
  if (b === ui.reviveNo) declineRevive();
  else if (b === ui.reviveGem && spendGems(REVIVE_GEMS)) {
    writeSave(save);
    cloudSoon();
    doRevive();
  } else if (b === ui.reviveAd && canRewardAd()) {
    G.reviveBusy = true;
    watchReward((earned) => {
      G.reviveBusy = false;
      if (earned) doRevive(true);
      else declineRevive();
    });
  }
}
function doRevive(afterAd) {
  show(ui.revive, false);
  G.run.revived = true;
  G.run.reviveFrom = G.meters;
  G.state = 'playing';
  G.hp = Math.min(G.maxHp, 2);
  refreshHp();
  G.fx = { shield: 1, ghost: 2 };
  const by = G.cam + curBY;
  G.rocks = G.rocks.filter((r) => r.wy < by - 30 || r.wy > by + 160); // a clear stretch to get going
  G.debris.length = 0;
  G.flyer = null;
  G.bx = G.prevBx = W / 2;
  G.vx = 0;
  G.trauma = 0;
  show(ui.hud, true);
  input.calibrate(afterAd ? 900 : 450);
  G.hitStopUntil = performance.now() + (afterAd ? 700 : 350); // a beat to get the grip back
  sfx.stopLose();
  sfx.startWater();
  sfx.startMusic();
  sfx.splash();
  popText(tr('SOBREVIDA!'));
  showHint(tr('SEGURE O CELULAR<br>NA POSIÇÃO DE JOGO'));
  unlock('revive1');
  if (riderSkin.id === 'cat') unlock('schrodinger'); // broke and didn't: alive and dead at once
}

// ---------- RESGATAR CÓDIGO ----------
// Codes live in Firestore (codes/<CODE>, created with scripts/codes.mjs): coins, diamonds and/or
// skins, a cap of redemptions ("max") and optionally an end date ("until"). Redeeming is one
// atomic commit: the account's claim (codes/<CODE>/claims/<uid>, once per account) plus +1 on
// "used"; the rules refuse it past the cap, after the date or a second time. Skins from codes can
// be hidden ones (hidden: true), which only show up in the shop once owned.
const CODE_RE = /^[A-Z0-9_-]{3,24}$/;
const cleanCode = (raw) => raw.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
const codeMsg = (txt, ok) => {
  ui.redeemMsg.textContent = txt;
  ui.redeemMsg.classList.toggle('ok', !!ok);
};
function codeDoc(doc) {
  const f = doc.fields || {};
  const int = (k) => (f[k] && 'integerValue' in f[k] ? Number(f[k].integerValue) : 0);
  const skins = f.skins && f.skins.arrayValue ? (f.skins.arrayValue.values || []).map((v) => v.stringValue).filter(Boolean) : [];
  return {
    coins: int('coins'), gems: int('gems'), max: int('max'), used: int('used'), skins,
    active: !!(f.active && f.active.booleanValue),
    until: f.until && f.until.timestampValue ? Date.parse(f.until.timestampValue) : 0,
  };
}
function grantCode(code, c, skinsOnly) {
  for (const key of c.skins) {
    if (!save.owned[key]) diaryNote(key, 3);
    save.owned[key] = true;
  }
  if (!skinsOnly) {
    if (c.coins) addCoins(c.coins);
    if (c.gems) addGems(c.gems);
  }
  save.codes[code] = true;
  writeSave(save);
  cloudSoon();
  checkOwned();
  refreshWallets();
}
let redeeming = false;
async function redeemCode() {
  if (redeeming) return;
  const code = cleanCode(ui.redeemInput.value);
  ui.redeemInput.value = code;
  if (!CODE_RE.test(code)) return codeMsg(tr('DIGITE O CÓDIGO (3 A 24 LETRAS OU NÚMEROS).'));
  if (save.codes[code]) return codeMsg(tr('VOCÊ JÁ RESGATOU ESSE CÓDIGO.'));
  if (!flagOn('codes')) return codeMsg(tr('CÓDIGOS EM MANUTENÇÃO. TENTE MAIS TARDE.'));
  redeeming = true;
  ui.redeemGo.disabled = true;
  codeMsg(tr('CONFERINDO...'));
  try {
    const token = await idToken();
    const H = { headers: { Authorization: `Bearer ${token}` } };
    const name = `${DB}/codes/${code}`;
    let doc;
    try {
      doc = await api(`${FS}/codes/${code}`, H);
    } catch (e) {
      if (e.status === 404) return codeMsg(tr('CÓDIGO INVÁLIDO.'));
      throw e;
    }
    const c = codeDoc(doc);
    const missing = c.skins.filter((k) => !skinByKey(k));
    if (missing.length) return codeMsg(tr('ESSE CÓDIGO PRECISA DA VERSÃO MAIS NOVA DO JOGO. ATUALIZE E TENTE DE NOVO.'));
    // this account already redeemed it (another phone, a reinstall): the skins come back
    const mine = await api(`${FS}/codes/${code}/claims/${auth.uid}`, H).catch(() => null);
    if (mine) {
      grantCode(code, c, true);
      return codeMsg(c.skins.length ? tr('ESSE CÓDIGO JÁ ERA SEU: AS SKINS VOLTARAM!') : tr('VOCÊ JÁ RESGATOU ESSE CÓDIGO.'), !!c.skins.length);
    }
    if (!c.active || (c.until && Date.now() > c.until)) return codeMsg(tr('ESSE CÓDIGO EXPIROU.'));
    if (c.used >= c.max) return codeMsg(tr('ESSE CÓDIGO ESGOTOU. FICA PRO PRÓXIMO!'));
    try {
      await api(`${FS}:commit`, json({
        writes: [
          { update: { name: `${name}/claims/${auth.uid}`, fields: {} }, updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }], currentDocument: { exists: false } },
          { transform: { document: name, fieldTransforms: [{ fieldPath: 'used', increment: { integerValue: '1' } }] } },
        ],
      }, token));
    } catch (e) {
      // refused by the rules: someone took the last one, or it just expired
      if (e.status === 403 || e.status === 400) return codeMsg(tr('ESSE CÓDIGO ESGOTOU OU EXPIROU.'));
      throw e;
    }
    grantCode(code, c, false);
    const got = [c.coins && trf('{0} MOEDAS', c.coins), c.gems && trf('{0} DIAMANTES', c.gems), ...c.skins.map((k) => skinByKey(k).name)].filter(Boolean);
    codeMsg(trf('RESGATADO! {0}', got.join(' + ')), true);
    sfx.blip([523, 659, 784, 1047, 1319], 0.06, 0.06);
    toastQueue.push({ head: tr('CÓDIGO RESGATADO!'), name: code, sub: got.join(' + ') });
    if (!toastTimer) nextToast();
    unlock('code1');
  } catch {
    codeMsg(tr('SEM CONEXÃO. TENTE DE NOVO COM INTERNET.'));
  } finally {
    redeeming = false;
    ui.redeemGo.disabled = false;
  }
}
const redeem = { from: null };
function openRedeem(from) {
  redeem.from = from;
  show(from, false);
  show(ui.redeem, true);
  codeMsg('');
  ui.redeemInput.value = '';
  ui.redeemInput.focus();
}
function closeRedeem() {
  show(ui.redeem, false);
  show(redeem.from || ui.title, true);
  if (redeem.from === ui.shop) refreshShop();
  if (redeem.from === ui.store) renderStore();
  G.lockUntil = performance.now() + 300;
}

// ---------- phone extras: steps, light, proximity, headphones, NFC lab ----------
// Native plugin CataratasSensors (android/.../SensorsPlugin.java). Everything stays on the phone:
// the step counter is only compared with its last reading, and NFC gives a hash of the chip id.
const sens = (m, o = {}) => window.Capacitor.nativePromise('CataratasSensors', m, o);
const extrasOn = () => NATIVE_ANDROID && !!window.Capacitor && typeof window.Capacitor.nativePromise === 'function';
async function initExtras() {
  if (!extrasOn()) return;
  try {
    const info = await sens('info');
    // which sensors exist decides, from the next launch on, which trophies this phone shows
    localStorage.setItem(HW_KEY, JSON.stringify({ steps: info.steps, light: info.light, proximity: info.proximity, nfc: info.nfc }));
  } catch {
    return;
  }
  const cap = window.Capacitor;
  cap.addListener('CataratasSensors', 'light', (e) => onLux(e.lux));
  cap.addListener('CataratasSensors', 'proximity', (e) => onNear(e.near));
  if (save.steps) readSteps(false);
}

// Steps: the phone counts since it was turned on; the game adds up the differences between its
// readings (app opened, back from the background, end of a run). A reboot just starts over.
async function readSteps(ask) {
  if (!extrasOn() || !DEVICE_CAN.steps) return null;
  const r = await sens('steps', { ask }).catch(() => null);
  if (!r || r.steps < 0) return r;
  const boot = Math.round(r.boot / 60000);
  const same = save.stepLast >= 0 && Math.abs(boot - save.stepBoot) <= 2 && r.steps >= save.stepLast;
  const delta = same ? r.steps - save.stepLast : 0;
  save.stepLast = r.steps;
  save.stepBoot = boot;
  if (delta > 0) {
    save.stepsTotal += delta;
    if (delta >= 2000) unlock('steps2k');
    if (save.stepsTotal >= 10000) unlock('steps10k');
    if (save.stepsTotal >= 42195) unlock('steps42k');
    if (delta >= 500) {
      toastQueue.push({ head: tr('VOCÊ ANDOU!'), name: trf('{0} PASSOS', delta.toLocaleString(LOCALE)), sub: tr('DESDE A ÚLTIMA DESCIDA'), muted: true });
      if (!toastTimer) nextToast();
    }
  }
  writeSave(save);
  return r;
}

// Light and proximity are watched only during a run.
function extrasRunStart() {
  if (!extrasOn()) return;
  if (DEVICE_CAN.light || DEVICE_CAN.proximity) sens('watch', { light: DEVICE_CAN.light, proximity: DEVICE_CAN.proximity }).catch(() => {});
  sens('headphones').then((h) => (G.run.phones = !!(h.wired || h.bluetooth))).catch(() => {});
}
function extrasRunStop() {
  if (extrasOn()) sens('unwatch').catch(() => {});
}
function onLux(lux) {
  if (G.state !== 'playing' || !Number.isFinite(lux)) return;
  G.run.luxN++;
  if (lux >= 5) G.run.dark = false;
  if (lux < 10000) G.run.sun = false;
}
function onNear(near) {
  if (G.state !== 'playing' || !near) return;
  if (++G.run.near >= 3) unlock('esconde');
}

// ---- LABORATÓRIO NFC ----
const lab = { from: null, sel: 1, scanning: false };
function openLab(from) {
  lab.from = from;
  lab.sel = Number(Object.keys(save.nfc)[0]) || 1;
  show(from, false);
  show(ui.lab, true);
  ui.labMsg.textContent = '';
  renderLab();
  // keeps Android from opening tags (links, "new tag" screen) while the lab is open
  if (extrasOn()) sens('nfcHold').catch(() => {});
}
function closeLab() {
  if (extrasOn()) sens('nfcStop').catch(() => {});
  show(ui.lab, false);
  show(lab.from || ui.title, true);
  if (lab.from === ui.shop) refreshShop();
  G.lockUntil = performance.now() + 300;
}
function renderLab() {
  const seed = save.nfc[lab.sel];
  const x = ui.labPreview.getContext('2d');
  x.imageSmoothingEnabled = false;
  x.fillStyle = '#1f5fae';
  x.fillRect(0, 0, ui.labPreview.width, ui.labPreview.height);
  if (seed) {
    const r = RIDER_SKINS.find((k) => k.id === `nfc${lab.sel}`);
    const b = BARREL_SKINS.find((k) => k.id === `nfcb${lab.sel}`);
    drawRiderInBarrel(x, ui.labPreview.width >> 1, ui.labPreview.height - BARREL_H - 1, makeRiderSkin(r, 0), r, b.make(), RIDER_HIGH);
    ui.labName.textContent = r.name;
  } else ui.labName.textContent = trf('ESPAÇO {0}: VAZIO', lab.sel);
  const using = save.rider === `nfc${lab.sel}` && save.barrel === `nfcb${lab.sel}`;
  ui.labUse.disabled = !seed || using;
  ui.labUse.textContent = using ? tr('EM USO') : tr('USAR ESSA CRIATURA');
  ui.labScan.textContent = lab.scanning ? tr('CANCELAR') : tr('ESCANEAR');
  ui.labSlots.textContent = '';
  for (let n = 1; n <= 6; n++) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.n = n;
    btn.className = `item${n === lab.sel ? ' sel' : ''}${save.nfc[n] ? '' : ' locked'}`;
    const r = RIDER_SKINS.find((k) => k.id === `nfc${n}`);
    btn.setAttribute('aria-label', save.nfc[n] ? r.name : trf('Espaço {0} vazio', n));
    if (save.nfc[n]) {
      const cv = makeRiderSkin(r, 0);
      cv.setAttribute('aria-hidden', 'true');
      btn.append(cv);
    }
    const label = document.createElement('span');
    label.textContent = save.nfc[n] ? r.name.slice(0, 8) : tr('VAZIO');
    btn.append(label);
    li.append(btn);
    ui.labSlots.append(li);
  }
}
async function labScan() {
  if (lab.scanning) {
    sens('nfcCancel').catch(() => {});
    return;
  }
  lab.scanning = true;
  ui.labMsg.textContent = tr('ENCOSTE O OBJETO ATRÁS DO CELULAR...');
  renderLab();
  const timer = setTimeout(() => sens('nfcCancel').catch(() => {}), 30000);
  const r = await sens('nfcScan').catch(() => null);
  clearTimeout(timer);
  lab.scanning = false;
  if (!r) ui.labMsg.textContent = tr('NÃO DEU PRA LER. TENTE DE NOVO.');
  else if (r.off) ui.labMsg.textContent = tr('LIGUE O NFC NAS CONFIGURAÇÕES DO ANDROID E TENTE DE NOVO.');
  else if (r.cancelled) ui.labMsg.textContent = '';
  else if (/^[0-9a-f]{16}$/.test(r.id)) addCreature(r.id);
  renderLab();
}
function addCreature(seed) {
  const have = Object.keys(save.nfc).find((k) => save.nfc[k] === seed);
  if (have) {
    lab.sel = Number(have);
    ui.labMsg.textContent = tr('ESSA CRIATURA JÁ MORA AQUI!');
    return;
  }
  let n = 1;
  while (n <= 6 && save.nfc[n]) n++;
  const replaced = n > 6;
  if (replaced) n = lab.sel;
  save.nfc[n] = seed;
  lab.sel = n;
  applyCreatures();
  writeSave(save);
  cloudSoon();
  sfx.blip([392, 523, 659, 784, 1047], 0.07, 0.06);
  ui.labMsg.textContent = replaced ? trf('NASCEU! (NO LUGAR DA CRIATURA DO ESPAÇO {0})', n) : tr('NASCEU UMA CRIATURA NOVA!');
  unlock('nfc1');
  if (Object.keys(save.nfc).length >= 6) unlock('nfc6');
}
function labUse() {
  if (!save.nfc[lab.sel]) return;
  save.rider = `nfc${lab.sel}`;
  save.barrel = `nfcb${lab.sel}`;
  applySkins();
  writeSave(save);
  sfx.blip([880, 1175], 0.05, 0.05);
  renderLab();
}

// ---------- wiring ----------
ui.title.addEventListener('click', start);
ui.over.addEventListener('click', (e) => {
  if (e.target.closest('#menuBtn')) adBreak(toTitle);
  else if (e.target.closest('#shareBtn')) {
    if (performance.now() >= G.lockUntil) shareRun();
  }
  else if (e.target.closest('#overRankBtn')) {
    if (performance.now() >= G.lockUntil) openRank(ui.over);
  } else if (e.target.closest('#overAchBtn')) {
    if (performance.now() >= G.lockUntil) openAch(ui.over);
  } else if (e.target.closest('#overShopBtn')) {
    if (performance.now() >= G.lockUntil) openShop(ui.over);
  } else if (e.target.closest('#overSumBtn')) {
    if (performance.now() >= G.lockUntil) {
      sfx.blip([880], 0.05, 0.05);
      openSummary();
    }
  } else if (performance.now() >= G.lockUntil) adBreak(start);
});
ui.sumBack.addEventListener('click', () => {
  sfx.blip([660], 0.05, 0.05);
  closeSummary();
});
ui.sumShop.addEventListener('click', () => {
  if (!sumSkin) return;
  sfx.blip([880], 0.05, 0.05);
  openShop(ui.sum, sumSkin[0], sumSkin.slice(2));
});
ui.achBtn.addEventListener('click', (e) => {
  e.stopPropagation(); // the title screen itself starts a run on tap
  sfx.unlock();
  sfx.blip([880], 0.05, 0.05);
  openAch(ui.title);
});
function openSettings() {
  show(ui.diffNote, false);
  show(ui.title, false);
  show(ui.settings, true);
}
function closeSettings() {
  show(ui.settings, false);
  show(ui.title, true);
  G.lockUntil = performance.now() + 300;
}
ui.setBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  sfx.unlock();
  sfx.blip([880], 0.05, 0.05);
  openSettings();
});
ui.setBack.addEventListener('click', closeSettings);
ui.dailyBtn.addEventListener('click', (e) => {
  e.stopPropagation(); // the title screen itself starts a run on tap
  sfx.unlock();
  sfx.blip([880, 1175], 0.05, 0.05);
  prepareDaily();
});

// ---------- reminders: local notifications of the Android app ----------
// Every day at 19h for the next 7 days, with that day's challenge in the text (and the weekend
// extras on Saturday and Sunday). Rescheduled whenever the app opens or a run ends; today's is
// skipped once the challenge of the day is done. Tapping one gives ATENDEU O CHAMADO.
const REMIND_HOUR = 19;
const REMIND_IDS = [9001, 9002, 9003, 9004, 9005, 9006, 9007];
const REMIND_TITLES = [tr('A cachoeira tá te chamando!'), tr('O barril tá com saudade'), 'Bora descer?', tr('Tem desafio novo no rio'), tr('Uooeeee! Hora de descer')];
const canNotify = () => DEVICE_CAN.notif && !!window.Capacitor && typeof window.Capacitor.nativePromise === 'function';
const notifCall = (m, o = {}) => window.Capacitor.nativePromise('LocalNotifications', m, o);
let remindBusy = false;
async function scheduleReminders() {
  if (!canNotify() || remindBusy) return;
  remindBusy = true;
  try {
    await notifCall('cancel', { notifications: REMIND_IDS.map((id) => ({ id })) });
    if (!save.notify) return;
    const perm = await notifCall('checkPermissions');
    if (!perm || perm.display !== 'granted') return;
    await notifCall('createChannel', { id: 'lembretes', name: tr('Lembretes do desafio'), description: tr('Um lembrete por dia do desafio do dia'), importance: 3 }).catch(() => {});
    const list = [];
    for (let k = 0; k < 7; k++) {
      const at = new Date();
      at.setDate(at.getDate() + k);
      at.setHours(REMIND_HOUR, 0, 0, 0);
      if (at.getTime() < Date.now() + 60e3) continue;
      const key = keyAt(at.getTime() + clock.offset);
      if (key === save.daily.key && save.daily.done) continue; // already played today's
      const ov = chalOverride.days[key];
      const c = (ov && ov.main) || dealtMain(key);
      const wk = isWeekendKey(key) ? trf(' E hoje tem 3 desafios extras de {0}!', keyDow(key) === 0 ? 'domingo' : 'sábado') : '';
      list.push({
        id: REMIND_IDS[k], channelId: 'lembretes', smallIcon: 'ic_stat_barrel', iconColor: '#1f5fae',
        title: REMIND_TITLES[keyDay(key) % REMIND_TITLES.length],
        body: trf('Desafio do dia: {0}.{1}', c.text, wk),
        schedule: { at: at.toISOString(), allowWhileIdle: true }, isExactNotification: false,
        extra: { kind: 'reminder', key },
      });
    }
    if (list.length) await notifCall('schedule', { notifications: list });
  } catch {
    /* plugin missing or refused: no reminders */
  } finally {
    remindBusy = false;
  }
}
// Asked once, after the first run ends (not on the first screen), and when LEMBRETES is turned on.
async function askNotify() {
  if (!canNotify()) return;
  save.notifAsked = true;
  writeSave(save);
  try {
    const r = await notifCall('requestPermissions');
    if (!r || r.display !== 'granted') {
      save.notify = false;
      writeSave(save);
      refreshToggles();
    }
  } catch {
    /* no prompt available */
  }
  scheduleReminders();
}
if (canNotify() && typeof window.Capacitor.addListener === 'function') {
  // also delivered when the tap opened the app from scratch (the plugin keeps it until we listen)
  window.Capacitor.addListener('LocalNotifications', 'localNotificationActionPerformed', (e) => {
    const n = e && e.notification;
    if (n && n.extra && n.extra.kind === 'reminder') unlock('notif');
  });
}

// ---------- invites ----------
// The invite link carries the inviter's account id: godri.dev/cataratas/convite.html?de=<id>.
// That page opens the app (cataratas://convite?de=…) or the Play Store with the same code as
// install referrer; MainActivity hands the code to the game ("cataratas:invite"). The invited
// player records invites/<own id> = { by, fresh } in Firestore once; the inviter reads the
// records that name them and gets the badges. "fresh": the invited player hadn't played yet.
const INVITE_URL = 'https://godri.dev/cataratas/convite.html';
const INVITE_RE = /^[A-Za-z0-9]{10,64}$/;
let inviteCheckT = 0;
async function shareInvite() {
  sfx.blip([880], 0.05, 0.05);
  if (!flagOn('invites')) {
    toastQueue.push({ head: tr('CONVITES EM MANUTENÇÃO'), name: tr('TENTE DE NOVO MAIS TARDE'), sub: '', muted: true });
    if (!toastTimer) nextToast();
    return;
  }
  try {
    await idToken(); // the invite code is this player's account id (an anonymous one is enough)
  } catch {
    toastQueue.push({ head: tr('SEM INTERNET'), name: tr('O CONVITE PRECISA DE CONEXÃO'), sub: tr('TENTE DE NOVO DAQUI A POUCO'), muted: true });
    if (!toastTimer) nextToast();
    return;
  }
  const url = `${INVITE_URL}?de=${auth.uid}`;
  const text = trf('Bora descer a cachoeira dentro de um barril? Entra no Cataratas no Barril pelo meu convite que a gente ganha skin de presente: {0}', url);
  const cap = window.Capacitor;
  try {
    if (cap && typeof cap.nativePromise === 'function' && NATIVE_ANDROID) {
      await cap.nativePromise('Share', 'share', { title: tr('Cataratas no Barril'), text, dialogTitle: tr('Convidar um amigo') });
    } else if (navigator.share) {
      await navigator.share({ title: tr('Cataratas no Barril'), text });
    } else {
      await navigator.clipboard.writeText(text);
      toastQueue.push({ head: tr('LINK COPIADO!'), name: tr('COLE NUMA CONVERSA COM UM AMIGO'), sub: tr('VOCÊS DOIS GANHAM SKIN') });
      if (!toastTimer) nextToast();
    }
  } catch {
    /* share sheet closed */
  }
}
function handleInvite(code, src) {
  if (!INVITE_RE.test(code || '') || save.invitedBy) return;
  if (auth && auth.uid === code) {
    toastQueue.push({ head: tr('ESSE CONVITE É SEU!'), name: tr('MANDE PRA UM AMIGO'), sub: tr('QUANDO ELE ABRIR, VOCÊ GANHA SKIN'), muted: true });
    if (!toastTimer) nextToast();
    return;
  }
  save.invitedBy = code;
  save.inviteFresh = save.runs === 0; // a new player: the gift for them, the big badge for the friend
  save.invitePending = true;
  writeSave(save);
  if (save.inviteFresh) unlock('invited');
  else {
    toastQueue.push({ head: tr('CONVITE ACEITO!'), name: tr('SEU AMIGO VAI GANHAR UMA SKIN'), sub: src === 'web' ? tr('OBRIGADO POR JOGAR') : tr('VALEU POR ABRIR O CONVITE') });
    if (!toastTimer) nextToast();
  }
  sendInvite();
}
async function sendInvite() {
  if (!save.invitePending || !navigator.onLine || !flagOn('invites')) return; // kept pending while off
  try {
    const token = await idToken();
    if (auth.uid === save.invitedBy) {
      save.invitePending = false;
    } else {
      await api(`${FS}:commit`, json({
        writes: [{
          update: { name: `${DB}/invites/${auth.uid}`, fields: { by: { stringValue: save.invitedBy }, fresh: { booleanValue: save.inviteFresh } } },
          currentDocument: { exists: false },
          updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }],
        }],
      }, token));
      save.invitePending = false;
    }
  } catch (e) {
    if (e.status === 400 || e.status === 409) save.invitePending = false; // already recorded: one invite per player
  }
  writeSave(save);
}
// The inviter side: who accepted this player's invites. Only for players that already have an
// account (anyone who shared an invite does); at most once an hour.
async function checkInvites(force) {
  if (!auth || !navigator.onLine || !flagOn('invites') || (!force && Date.now() - inviteCheckT < 3600e3)) return;
  inviteCheckT = Date.now();
  try {
    const token = await idToken();
    const rows = await api(`${FS}:runQuery`, json({
      structuredQuery: {
        from: [{ collectionId: 'invites' }],
        where: { fieldFilter: { field: { fieldPath: 'by' }, op: 'EQUAL', value: { stringValue: auth.uid } } },
        limit: 500,
      },
    }, token));
    const docs = (Array.isArray(rows) ? rows : []).filter((r) => r.document).map((r) => fromDoc(r.document));
    const fresh = docs.filter((d) => d.fresh === true).length;
    save.invitesOk = Math.max(save.invitesOk, docs.length);
    save.invitesNew = Math.max(save.invitesNew, fresh);
    writeSave(save);
  } catch {
    /* offline or rules not deployed yet: try again later */
  }
  if (save.invitesOk >= 1) unlock('invite1');
  if (save.invitesNew >= 1) unlock('invitenew');
  if (save.invitesNew >= 5) unlock('invite5');
  if (!ui.about.hidden) aboutInvites();
}
function aboutInvites() {
  ui.inviteInfo.textContent = save.invitesOk
    ? trf('AMIGOS QUE ACEITARAM: {0}{1}', save.invitesOk, save.invitesNew ? trf(' ({0} NOVO{1} NO JOGO)', save.invitesNew, save.invitesNew > 1 ? 'S' : '') : '')
    : tr('QUANDO UM AMIGO ABRIR O SEU CONVITE COM O JOGO INSTALADO, VOCÊ GANHA O ENVELOPE. SE ELE FOR NOVO NO JOGO, VOCÊ GANHA O EMBAIXADOR DA CACHOEIRA E ELE GANHA A CESTA DE BOAS-VINDAS.');
}
window.addEventListener('cataratas:invite', (e) => handleInvite(e.code, e.src));

// ---------- about: version, credits, jokes, the tilt tutorial and an easter egg ----------
const JOKES = [
  tr('POR QUE O BARRIL NÃO GUARDA SEGREDO? PORQUE ELE VAZA.'),
  tr('O PILOTO PERGUNTOU SE TINHA CINTO DE SEGURANÇA. O BARRIL RIU ATÉ RACHAR.'),
  tr('QUAL O ESPORTE FAVORITO DO BARRIL? DESCIDA LIVRE. SEM FREIO, SEM SEGURO, SEM JUÍZO.'),
  tr('ESTE JOGO NÃO FOI TESTADO EM ANIMAIS. SÓ NO GATO LARANJA, E ELE ODIOU.'),
  tr('DICA PROFISSIONAL: PEDRA É DURA. DESVIE DELA.'),
  tr('SE VOCÊ LEU ATÉ AQUI, JÁ PODIA TER DESCIDO 300 m.'),
  tr('O BARRIL CLÁSSICO TEM CHEIRINHO DE VINHO. NÃO PERGUNTE COMO A GENTE SABE.'),
  tr('O QUE A CACHOEIRA DISSE PRO BARRIL? NADA. CACHOEIRA NÃO FALA. MAS ELA TE OLHOU FEIO.'),
  tr('QUANTOS PILOTOS CABEM NUM BARRIL? UM. O RESTO VAI NA PRÓXIMA DESCIDA.'),
  tr('O MARCENEIRO DA CACHOEIRA JÁ COMPROU CASA NA PRAIA. OBRIGADO, JOGADORES.'),
  tr('A CHAVE INGLESA CONSERTA O BARRIL. O SEU CORAÇÃO, NÃO.'),
  tr('SE O BARRIL QUEBROU NOS PRIMEIROS 30 m, A CULPA É DO SENSOR. COM CERTEZA.'),
];
const DEV_TAPS = 7;
const about = { taps: 0, jokeI: Math.floor(Math.random() * JOKES.length), raf: 0, x: 0, last: 0, left: false, right: false, back: false, rider: null, barrel: null };

function aboutVersion() {
  const left = DEV_TAPS - about.taps;
  ui.aboutVer.textContent = save.ach.devmode
    ? trf('VERSÃO {0} · VOCÊ JÁ É DESENVOLVEDOR', APP_VERSION)
    : about.taps >= 3 && left > 0
      ? trf('FALTAM {0} TOQUE{1} PARA VOCÊ SER UM DESENVOLVEDOR', left, left > 1 ? 'S' : '')
      : trf('VERSÃO {0}', APP_VERSION);
}
function aboutJoke() {
  ui.aboutJoke.textContent = JOKES[about.jokeI % JOKES.length];
}
function aboutSensors() {
  const rows = [
    [input.hasSensor || pcMode || tapMode, tr('INCLINAÇÃO (CONTROLA O BARRIL)'), pcMode ? tr('NO COMPUTADOR: SETAS DO TECLADO') : tapMode ? tr('MODO TOQUE') : input.hasSensor ? '' : tr('NÃO ENCONTRADO')],
    [DEVICE_CAN.motion, tr('CHACOALHAR / VIRAR O CELULAR'), ''],
    [DEVICE_CAN.mic, tr('MICROFONE'), save.mic ? tr('LIGADO EM AJUSTES') : tr('DESLIGADO EM AJUSTES')],
    [DEVICE_CAN.torch, tr('LANTERNA'), ''],
    [DEVICE_CAN.battery, tr('BATERIA E CARREGADOR'), ''],
    [DEVICE_CAN.print, tr('AVISO DE PRINT'), ''],
    [DEVICE_CAN.steps, tr('CONTADOR DE PASSOS'), save.steps ? trf('LIGADO · {0} PASSOS', save.stepsTotal.toLocaleString(LOCALE)) : tr('LIGUE EM AJUSTES')],
    [DEVICE_CAN.light, tr('SENSOR DE LUZ'), ''],
    [DEVICE_CAN.proximity, tr('SENSOR DE PROXIMIDADE'), ''],
    [DEVICE_CAN.phones, tr('FONE DE OUVIDO'), ''],
    [DEVICE_CAN.nfc, tr('NFC (LABORATÓRIO NA LOJA)'), ''],
  ];
  ui.sensorList.innerHTML = rows.map(([ok, name, note]) => `<li class="${ok ? 'ok' : 'no'}">${name}${note ? ` · ${note}` : ''}</li>`).join('');
}
function tutChecks() {
  const steps = [[about.left, tr('INCLINE PRA ESQUERDA')], [about.right, tr('INCLINE PRA DIREITA')], [about.back, tr('VOLTE PRO MEIO')]];
  ui.tutChecks.innerHTML = steps.map(([ok, t]) => `<li class="${ok ? 'ok' : ''}">${t}</li>`).join('');
  const how = pcMode ? tr('USE AS SETAS ← →') : tapMode ? tr('TOQUE NOS LADOS DA TELA') : tr('INCLINE O CELULAR, COMO UM VOLANTE');
  ui.tutStep.textContent = about.back ? tr('PRONTO! VOCÊ JÁ SABE PILOTAR') : how;
}
// The barrel on its little river follows the same steering the game uses.
function tutFrame(now) {
  about.raf = requestAnimationFrame(tutFrame);
  const dt = Math.min(0.05, (now - (about.last || now)) / 1000);
  about.last = now;
  const steer = input.getSteer(dt);
  about.x += (steer * 70 - about.x) * Math.min(1, dt * 10);
  if (steer < -0.6) about.left = true;
  if (steer > 0.6) about.right = true;
  if (about.left && about.right && !about.back && Math.abs(steer) < 0.15) {
    about.back = true;
    sfx.blip([660, 990], 0.07, 0.06);
    unlock('tutorial');
  }
  if (now - (about.checkT || 0) > 150) {
    about.checkT = now;
    tutChecks();
  }
  const c = ui.tutCanvas.getContext('2d');
  const w = ui.tutCanvas.width;
  const h = ui.tutCanvas.height;
  c.imageSmoothingEnabled = false;
  c.fillStyle = '#1f5fae';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#2a6fc0';
  const flow = (now / 25) % 16;
  for (let x = 2; x < w; x += 7) for (let y = -16 + flow + (x % 5) * 3; y < h; y += 16) c.fillRect(x, Math.round(y), 1, 6);
  c.fillStyle = '#3a3f4b';
  c.fillRect(0, 0, 6, h);
  c.fillRect(w - 6, 0, 6, h);
  // arrows that light up as each side is reached
  c.fillStyle = about.left ? '#7dff9a' : '#bfe3ff';
  c.fillRect(14, 30, 8, 2); c.fillRect(14, 29, 2, 4); c.fillRect(12, 30, 2, 2);
  c.fillStyle = about.right ? '#7dff9a' : '#bfe3ff';
  c.fillRect(w - 22, 30, 8, 2); c.fillRect(w - 16, 29, 2, 4); c.fillRect(w - 14, 30, 2, 2);
  drawRiderInBarrel(c, Math.round(w / 2 + about.x), h - BARREL_H - 4, about.rider, riderSkin, about.barrel, RIDER_HIGH);
}
function openAbout() {
  show(ui.diffNote, false);
  show(ui.title, false);
  show(ui.about, true);
  ui.aboutBody.scrollTop = 0;
  about.taps = 0;
  about.left = about.right = about.back = false;
  about.x = 0;
  about.last = 0;
  about.rider = makeRiderSkin(riderSkin, 0);
  about.barrel = barrelSkin.make();
  input.requestPermission();
  input.calibrate();
  aboutVersion();
  aboutJoke();
  aboutSensors();
  aboutInvites();
  checkInvites();
  tutChecks();
  cancelAnimationFrame(about.raf);
  about.raf = requestAnimationFrame(tutFrame);
}
function closeAbout() {
  cancelAnimationFrame(about.raf);
  show(ui.about, false);
  show(ui.title, true);
  G.lockUntil = performance.now() + 300;
}
// godri.dev card in SOBRE: in the app, navigating to another site is handed to the phone's
// browser by Capacitor (the game stays where it was); on the web the link opens a new tab.
document.querySelector('.about-brand').addEventListener('click', (e) => {
  if (!NATIVE_ANDROID) return;
  e.preventDefault();
  sfx.blip([880], 0.05, 0.05);
  location.href = e.currentTarget.href;
});
ui.aboutBtn.addEventListener('click', (e) => {
  e.stopPropagation(); // the title screen itself starts a run on tap
  sfx.unlock();
  sfx.blip([880], 0.05, 0.05);
  openAbout();
});
ui.aboutBack.addEventListener('click', () => {
  sfx.blip([660], 0.05, 0.05);
  closeAbout();
});
ui.inviteBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  shareInvite();
});
ui.aboutJokeBtn.addEventListener('click', () => {
  sfx.blip([990], 0.04, 0.05);
  about.jokeI++;
  aboutJoke();
});
ui.tutCal.addEventListener('click', () => {
  input.calibrate();
  sfx.blip([880], 0.05, 0.05);
  ui.tutStep.textContent = tr('CALIBRADO! ESSA POSIÇÃO AGORA É O MEIO');
});
// Easter egg: like Android's "build number", tapping the version 7 times.
ui.aboutVer.addEventListener('click', () => {
  if (save.ach.devmode) return;
  about.taps++;
  sfx.blip([600 + about.taps * 80], 0.04, 0.05);
  if (about.taps >= DEV_TAPS) {
    unlock('devmode');
    if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
  }
  aboutVersion();
});

ui.chalBtn.addEventListener('click', (e) => {
  e.stopPropagation(); // the title screen itself starts a run on tap
  sfx.unlock();
  sfx.blip([880], 0.05, 0.05);
  openChal();
});
ui.chalBack.addEventListener('click', () => {
  sfx.blip([660], 0.05, 0.05);
  closeChal();
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
ui.tabTune.addEventListener('click', () => setShopTab('t'));
ui.tuneBody.addEventListener('click', tuneAct);
ui.shopGemBtn.addEventListener('click', () => {
  sfx.blip([880], 0.05, 0.05);
  openStore(ui.shop);
});
ui.gemBtn.addEventListener('click', (e) => {
  e.stopPropagation(); // the title screen starts a run on any other tap
  sfx.blip([880], 0.05, 0.05);
  openStore(ui.title);
});
ui.storeBody.addEventListener('click', storeAct);
ui.shopNfcBtn.addEventListener('click', () => {
  sfx.blip([880], 0.05, 0.05);
  openLab(ui.shop);
});
ui.labScan.addEventListener('click', labScan);
ui.labUse.addEventListener('click', labUse);
ui.labBack.addEventListener('click', () => {
  sfx.blip([660], 0.05, 0.05);
  closeLab();
});
ui.labSlots.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  lab.sel = Number(b.dataset.n);
  ui.labMsg.textContent = '';
  renderLab();
});
ui.shopCodeBtn.addEventListener('click', () => {
  sfx.blip([880], 0.05, 0.05);
  openRedeem(ui.shop);
});
ui.redeemBack.addEventListener('click', () => {
  sfx.blip([660], 0.05, 0.05);
  closeRedeem();
});
$('redeemForm').addEventListener('submit', (e) => {
  e.preventDefault();
  redeemCode();
});
ui.storeBack.addEventListener('click', () => {
  sfx.blip([660], 0.05, 0.05);
  closeStore();
});
ui.revive.addEventListener('click', reviveAct);
ui.adPrivacyBtn.addEventListener('click', () => adCall('showPrivacyOptionsForm').catch(() => {}));
ui.shopList.addEventListener('click', (e) => {
  const b = e.target.closest('.item');
  if (!b) return;
  shop.sel = b.dataset.id;
  sfx.blip([990], 0.04, 0.04);
  refreshShop();
});
ui.rankBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  sfx.blip([660], 0.05, 0.05);
  openRank(ui.title);
});
ui.rankBack.addEventListener('click', () => {
  sfx.blip([660], 0.05, 0.05);
  closeRank();
});
ui.rankTabs.addEventListener('click', (e) => {
  const b = e.target.closest('.tab');
  if (!b) return;
  rankView.board = b.dataset.id;
  sfx.blip([990], 0.04, 0.04);
  renderRank();
});
ui.nameInput.addEventListener('input', () => {
  const v = cleanName(ui.nameInput.value);
  if (v !== ui.nameInput.value.toUpperCase().trim()) ui.nameInput.value = v;
});
ui.nameForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = cleanName(ui.nameInput.value);
  if (!NAME_RE.test(name)) {
    popText(tr('APELIDO: 3 A 12 LETRAS'), 'bad');
    return;
  }
  ui.nameInput.blur();
  save.rank.name = name;
  save.rank.dirty = true;
  writeSave(save);
  refreshRankTile();
  sfx.blip([523, 784], 0.06, 0.05);
  renderRank();
});
ui.rankDelete.addEventListener('click', deleteRankData);
ui.googleBtn.addEventListener('click', () => {
  ui.googleBtn.disabled = true;
  ui.googleInfo.textContent = tr('ENTRANDO COM O GOOGLE...');
  googleSignIn()
    .then(() => {
      sfx.blip([523, 659, 784], 0.06, 0.05);
      renderRank();
    })
    .catch((e) => {
      // the #pop text sits under this screen, so the message goes here
      const cancelled = /cancel/i.test((e && e.message) || '');
      ui.googleInfo.textContent = cancelled ? tr('LOGIN CANCELADO') : tr('NÃO DEU PRA ENTRAR. TENTE DE NOVO.');
      console.warn('google sign-in', e && e.message);
    })
    .finally(() => (ui.googleBtn.disabled = false));
});
ui.demoAgain.addEventListener('click', () => {
  show(ui.demoEnd, false);
  G.lockUntil = 0;
  start();
});
ui.demoCtl.addEventListener('click', (e) => {
  e.stopPropagation();
  demoTap = !demoTap;
  sfx.blip([660], 0.05, 0.05);
  refreshDemo();
  if (!demoTap) input.requestPermission(); // iPhone: the motion prompt needs this tap
  G.lockUntil = performance.now() + 300;
});
ui.updateGo.addEventListener('click', () => {
  sfx.blip([660, 880], 0.05, 0.05);
  // in the app, leaving the WebView's origin hands the link to Android (the Play Store app)
  if (NATIVE_ANDROID) location.href = STORE_URL;
  else window.open(STORE_URL, '_blank', 'noopener');
});
ui.updateLater.addEventListener('click', () => {
  sfx.blip([660], 0.05, 0.05);
  try {
    localStorage.setItem(`${APPCFG_KEY}.later`, appCfg.latestVersion);
  } catch {
    /* asks again next launch */
  }
  show(ui.update, false);
  G.lockUntil = performance.now() + 300;
});
ui.achDiary.addEventListener('click', () => {
  sfx.blip([660, 880], 0.05, 0.05);
  achDiary = !achDiary;
  renderAch();
  ui.achList.scrollTop = 0;
});
ui.achBack.addEventListener('click', () => {
  sfx.blip([660], 0.05, 0.05);
  closeAch();
});
ui.pause.addEventListener('click', (e) => {
  if (e.target.closest('.pause-menu')) return; // the buttons below handle themselves
  resume();
});
ui.pauseGo.addEventListener('click', resume);
ui.pauseQuit.addEventListener('click', quitRun);
for (const [btn, key, apply] of [
  [ui.pauseSound, 'sound', (on) => sfx.setEnabled(on)],
  [ui.pauseMusic, 'music', (on) => sfx.setMusicEnabled(on)],
]) {
  btn.addEventListener('click', () => {
    save[key] = !save[key];
    apply(save[key]);
    writeSave(save);
    refreshToggles();
    refreshPauseToggles();
  });
}
ui.pauseBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
ui.pauseBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  pause();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (G.state === 'playing' || G.state === 'paused') G.run.leftApp = true;
    pause();
    if (cloudDirty) cloudSync().catch(() => (cloudDirty = true)); // leaving the app: back up now
  } else {
    checkClockBadges();
    checkHolidays();
    if (save.steps) readSteps(false);
  }
});
ui.torchBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
ui.torchBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  torchUse();
});
ui.micBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  sfx.unlock();
  sfx.blip([880], 0.05, 0.05);
  setMic(!save.mic);
});
window.addEventListener('offline', () => {
  if (G.state === 'playing') unlock('airplane');
});
// Android app: the airplane mode switch itself (it can keep Wi-Fi on, so the phone stays online).
let airplaneOn = false;
window.addEventListener('cataratas:airplane', (e) => {
  airplaneOn = e.on === true;
  if (airplaneOn && G.state === 'playing') unlock('airplane');
});
window.addEventListener('online', () => {
  syncClock();
  fetchFlags();
  if (cloudDirty) cloudSoon(1000);
});
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
document.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && !ui.ach.hidden) return closeAch();
  if (e.code === 'Escape' && !ui.lab.hidden) return closeLab();
  if (e.code === 'Escape' && !ui.redeem.hidden) return closeRedeem();
  if (e.code === 'Escape' && !ui.store.hidden) return closeStore();
  if (e.code === 'Escape' && G.state === 'revive') return declineRevive();
  if (e.code === 'Escape' && !ui.shop.hidden) return closeShop();
  if (e.code === 'Escape' && !ui.sum.hidden) return closeSummary();
  if (e.code === 'Escape' && !ui.chal.hidden) return closeChal();
  if (e.code === 'Escape' && !ui.about.hidden) return closeAbout();
  if (e.code === 'Escape' && !ui.rank.hidden) return closeRank();
  if (e.code === 'Escape' && !ui.settings.hidden) return closeSettings();
  if (!ui.rank.hidden || !ui.redeem.hidden) return; // typing a name or a code
  if ((e.code === 'Escape' || e.code === 'KeyP') && G.state === 'playing') return pause();
  if (e.code !== 'Space' && e.code !== 'Enter') return;
  if (!ui.ach.hidden || !ui.shop.hidden || !ui.sum.hidden || !ui.chal.hidden || !ui.about.hidden || !ui.store.hidden) return;
  if (G.state === 'title' || G.state === 'over') start();
  else if (G.state === 'paused') resume();
});

ui.titleBest.textContent = save.best;
refreshRankTile();
finishGoogleRedirect();
if (save.rank.dirty && save.rank.name) syncRank().catch(() => {});
G.run = newRunStats();
fixLedger();
// pay rewards for badges earned before achievements paid coins (and any skins they give)
for (const a of ACHIEVEMENTS) if (save.ach[a.id]) grant(a);
applySkins();
checkOwned();
checkWallet();
writeSave(save);
G.run = newRunStats(); // the boot checks above must not count as "new" for the first run
refreshToggles();
refreshAchCount();
refreshClockNote();
scheduleReminders();
refreshGems();
initAds();
initIap();
initExtras();

// ---------- studio splash (godri.dev) ----------
// Plays once per launch over the title; a tap skips it. Off in the automated tests (?test).
const BRAND_MS = 2500;
const brandEl = $('brand');
let brandDone = false;
function brandOut() {
  if (brandDone) return;
  brandDone = true;
  G.lockUntil = performance.now() + 500; // the tap that skipped it must not start a run
  brandEl.classList.add(reducedMotion ? 'gone' : 'out');
  setTimeout(() => show(brandEl, false), reducedMotion ? 250 : 460);
}
if (params.has('test') || params.has('nobrand')) {
  brandDone = true;
  show(brandEl, false);
} else {
  G.lockUntil = performance.now() + BRAND_MS + 600;
  brandEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    brandOut();
  });
  setTimeout(brandOut, BRAND_MS);
}
setTimeout(() => {
  sendInvite();
  checkInvites();
}, 2500);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    fetchFlags(false);
    checkInvites();
  }
});
grantBeta();
watchCharger();
torchInit();
applyUpside();
refreshPeriod();
checkClockBadges();
checkHolidays();
show(ui.inviteBtn, flagOn('invites'));
checkUpdate(); // a minimum version already known blocks before going online
fetchFlags();
syncClock();
cloudSync().catch(() => (cloudDirty = true)); // pull what other phones added, then back up
if (!save.mic) ui.micInfo.textContent = tr('LIGUE PRA SOPRAR O FOGO E GRITAR COM A TORCIDA');
if (DEMO) {
  document.body.classList.add('demo');
  save.diff = 1; // the demo is NORMAL: 3 hits, the wrench fixes
  refreshDemo();
}
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
    // ranking and feature flags (live Firestore)
    flags: () => ({ ...flags, at: flagsAt }),
    board: (field) => fetchBoard(field),
    position: (field, value) => myPosition(field, value),
    openRank: () => openRank(ui.title),
    rankText: () => ui.rankList.textContent,
    unlock: (id) => unlock(id),
    achievements: () => ({ ...save.ach }),
    gems: (n) => {
      addGems(n);
      writeSave(save);
      return save.gems;
    },
    meters: (m) => (G.meters = m),
    achMeters: (m) => achOnMeters(m),
    nfc: (seed) => {
      addCreature(seed);
      return Object.assign({}, save.nfc);
    },
    creature: (seed) => creatureOf(seed),
    say: (t) => sayShow(t || riderSays(riderSkin.id)),
    input: () => ({ neutral: input.neutral, raw: input.raw, calibrating: !!input.cal, steer: input.filtered, tap: input.tapOn }),
    state: () => ({ state: G.state, hp: G.hp, maxHp: G.maxHp, fx: { ...G.fx }, run: { tuned: G.run.tuned, revived: G.run.revived, reviveFrom: G.run.reviveFrom }, gems: save.gems, coins: save.coins, tune: { ...save.tune }, rank: { ...save.rank } }),
    give: (n) => {
      addCoins(n);
      writeSave(save);
      refreshAchCount();
    },
    bubbles: () => G.bubbles.map((b) => ({ wy: b.wy, x: b.x, v: b.v })),
    power: (id) => takePickup({ id, wy: G.cam + curBY, ph: 0 }, G.bx),
    save: () => JSON.parse(JSON.stringify(save)),
    rockList: () => G.rocks.map((r) => ({ wy: r.wy, x: r.x, r: r.r })),
    gaps: () => testGaps.filter((g) => g.wy > G.cam - 30),
    walls: (wy) => [wallL(wy), wallR(wy)],
    hit: () => takeHit('wall', G.cam + curBY),
    // a real collision: shield, then a crack, then the crash
    crash: () => {
      const by = G.cam + curBY;
      if (G.fx.shield) shieldSave('wall', by);
      else if (G.hp > 1) takeHit('wall', by);
      else {
        G.hp = 0;
        refreshHp();
        die();
      }
    },
    rank: () => ({ ...save.rank, uid: auth && auth.uid }),
    shareImage: () => makeShareImage(G.lastRun).toDataURL('image/png'),
    wrench: () => collectBubble({ wrench: true, wy: G.cam + curBY }, G.bx),
    nessie: () => nessieSurfaces(),
    cloudPayload: () => JSON.parse(JSON.stringify(cloudPayload())),
    mergeSave: (raw) => mergeSave(raw),
    setAuth: (a) => (auth = a),
    cloudSync: () => cloudSync(),
    bolt: () => G.bolt && { ...G.bolt },
    setWeather: (w) => setWeather(w),
    wx: () => ({ w: G.run.weather, next: G.wxNext, pending: G.wxPending, fromM: G.wxFromM }),
    fxHudY: () => fxHudY,
    world: (o = {}) => {
      if ('period' in o) world.override = o.period;
      if ('weather' in o) world.weatherOverride = o.weather;
      if ('upside' in o) setUpside(o.upside);
      if ('mic' in o) mic.fake = o.mic;
      refreshPeriod();
      return { period: world.period, weather: G.run && G.run.weather, upside: save.upside, mic: mic.level, clock: { ...clock }, holidays: holidaysOn(now()) };
    },
    holidaysOn: (iso) => holidaysOn(new Date(iso)),
    shakeNow: () => unlock('shake'),
    // a rider sitting in a barrel, drawn like the shop preview (for checking new skins)
    htmlKeys: () => [...htmlKeys],
    lang: () => LANG,
    pairSprite: (r, b) => {
      const R = RIDER_SKINS.find((k) => k.id === r);
      const B = BARREL_SKINS.find((k) => k.id === b);
      const c = makeCanvas(BARREL_W + 12, BARREL_H + 20);
      drawRiderInBarrel(c.getContext('2d'), c.width >> 1, 18, makeRiderSkin(R, 0), R, B.make(), RIDER_HIGH);
      return c.toDataURL();
    },
    equip: (b, r) => {
      save.owned[`b:${b}`] = save.owned[`r:${r}`] = true;
      save.barrel = b;
      save.rider = r;
      applySkins();
      writeSave(save);
    },
    combo: (b, r, scale = 1) => {
      const bs = BARREL_SKINS.find((k) => k.id === b);
      const rs = RIDER_SKINS.find((k) => k.id === r);
      const c = document.createElement('canvas');
      c.width = 32 * scale;
      c.height = 44 * scale;
      const x = c.getContext('2d');
      x.imageSmoothingEnabled = false;
      x.scale(scale, scale);
      drawRiderInBarrel(x, 16, 44 - BARREL_H - 1, makeRiderSkin(rs, 0), rs, bs.make(), RIDER_HIGH);
      return c.toDataURL();
    },
    sheet: (ids) => {
      const c = document.createElement('canvas');
      const list = ids.map((id) => [BARREL_SKINS.find((k) => k.id === id), RIDER_SKINS.find((k) => k.id === id)]);
      c.width = list.length * 26;
      c.height = 80;
      const x = c.getContext('2d');
      x.fillStyle = '#1f5fae';
      x.fillRect(0, 0, c.width, c.height);
      list.forEach(([b, r], k) => {
        if (b) x.drawImage(b.make(), k * 26 + 3, 2);
        if (r) drawRiderInBarrel(x, k * 26 + 13, 50, makeRiderSkin(r, 0), r, BARREL_SKINS[0].make(), RIDER_HIGH);
      });
      return c.toDataURL();
    },
    // Everything the backoffice page lists (scripts/backoffice.mjs).
    catalog: () => {
      const png = (c) => c.toDataURL('image/png');
      const skin = (k) => ({
        id: k.id, name: k.name, desc: k.desc, price: k.ach && k.alt && k.price === k.alt ? null : k.price,
        ach: k.ach || null, alt: k.alt || null, beta: !!k.beta, monster: !!k.monster, trail: k.trail || null, pair: k.pair || null, gems: k.gems || null, hidden: !!k.hidden, nfc: !!k.nfc, legend: !!k.legend, says: SAYS[k.id] || null,
      });
      const barrels = BARREL_SKINS.map((k) => ({ ...skin(k), says: SAYS_BARREL[k.id] || null, img: png(k.make()) }));
      const classic = BARREL_SKINS.find((k) => k.id === 'classic').make();
      const riders = RIDER_SKINS.map((k) => {
        const c = makeCanvas(32, 44);
        drawRiderInBarrel(c.getContext('2d'), 16, 44 - BARREL_H - 1, makeRiderSkin(k, 0), k, classic, RIDER_HIGH);
        return { ...skin(k), pairKnown: !k.pair || PAIR_FIRST[k.pair] === k.id, img: png(c) };
      });
      const achievements = ALL_ACHIEVEMENTS.map((a) => ({
        id: a.id, icon: a.icon, tier: a.tier, name: a.name, desc: a.desc, reward: achReward(a), skins: achSkins(a),
        easy: easyOk(a), needs: a.needs || null, combo: a.combo || null,
      }));
      const daily = [...DAILY.map((c) => ({ ...c, kind: 'main' })), ...MINI.map((c) => ({ ...c, kind: 'mini' })), ...WEEKEND.map((c) => ({ ...c, kind: 'wk' }))]
        .map((c) => ({ ...c, skin: c.barrel ? `b:${c.barrel}` : c.rider ? `r:${c.rider}` : null, skins: [c.barrel && `b:${c.barrel}`, c.rider && `r:${c.rider}`].filter(Boolean) }));
      const says = { any: SAYS_ANY, hit: SAYS_HIT, graze: SAYS_GRAZE, rec: SAYS_REC, short: SAYS_SHORT, long: SAYS_LONG };
      const pairSays = Object.entries(SAYS_PAIR).map(([k, l]) => ({ rider: k.split('+')[0], barrel: k.split('+')[1], says: l }));
      return { says, pairSays, barrels, riders, achievements, daily, tierReward: TIER_REWARD, dailyReward: DAILY_REWARD, miniReward: MINI_REWARD, weekendReward: WEEKEND_REWARD };
    },
    // day: "YYYY-MM-DD" to pretend today is that date
    daily: (day) => {
      if (day) dailyKeyOverride = day;
      refreshDaily();
      return {
        key: save.daily.key, count: save.dailyCount, mini: save.miniCount, wkKey: save.wkKey, wkDone: save.wkDone,
        list: challenges().map((x) => ({ kind: x.kind, text: x.c.text, done: x.st.done, prog: x.st.prog, reward: x.reward })),
        run: G.run && { chal: G.run.chal, done: G.run.chalDone },
      };
    },
    shareDone: (pkg) => achOnShare(pkg || ''),
    reminders: async () => {
      await scheduleReminders();
      return notifCall('getPending');
    },
    // a reminder a few seconds from now, to try tapping it
    remindSoon: (sec = 5) => notifCall('schedule', { notifications: [{ id: 9100, channelId: 'lembretes', smallIcon: 'ic_stat_barrel', iconColor: '#1f5fae', title: tr('Teste do lembrete'), body: tr('Toque para abrir o jogo'), schedule: { at: new Date(Date.now() + sec * 1000).toISOString(), allowWhileIdle: true }, isExactNotification: false, extra: { kind: 'reminder' } }] }),
    invite: (code, src) => handleInvite(code, src || 'link'),
    inviteState: () => ({ by: save.invitedBy, fresh: save.inviteFresh, pending: save.invitePending, ok: save.invitesOk, fresh2: save.invitesNew, uid: auth && auth.uid }),
    checkInvites: () => checkInvites(true),
    override: (raw) => {
      chalOverride = { at: Date.now(), ...parseOverride(raw) };
      refreshDaily();
      return chalOverride;
    },
    todayKey: () => todayKey(),
    dailyList: () => [...DAILY, ...MINI, ...WEEKEND].map((c) => ({ ...c, skin: c.barrel || c.rider, ok: !dailySkin(c) || !!dailySkin(c)[1] })),
    resetDaily: () => {
      save.daily = { key: '', done: false, prog: 0, mini: [], wk: [] };
      refreshDaily();
    },
  };
}

})();
