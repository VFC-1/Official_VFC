/* ═══════════════════════════════════════════════════════════
   Leanline — weight-loss tracker (all data stays on this phone)
═══════════════════════════════════════════════════════════ */
'use strict';

const STORE_KEY = 'leanline.v1';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round = (v, d = 0) => { const p = 10 ** d; return Math.round(v * p) / p; };
const fmt = n => Math.round(n).toLocaleString();

/* ── dates (local time, YYYY-MM-DD keys) ── */
const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const todayKey = () => keyOf(new Date());
const addDays = (k, n) => { const d = dateOf(k); d.setDate(d.getDate() + n); return keyOf(d); };
const daysBetween = (a, b) => Math.round((dateOf(b) - dateOf(a)) / 86400000);
const niceDate = (k, opts = { weekday: 'short', month: 'short', day: 'numeric' }) => dateOf(k).toLocaleDateString(undefined, opts);
const relDate = k => {
  const diff = daysBetween(k, todayKey());
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return niceDate(k);
};

/* ═════════════ storage ═════════════ */
const blank = () => ({ profile: null, days: {}, badges: {}, milestones: [], records: { bestStreak: 0, bestTargetStreak: 0 }, settings: { apiUrl: '', apiCode: '' } });
let S = load();
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return blank();
    return Object.assign(blank(), JSON.parse(raw));
  } catch { return blank(); }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }
  catch (e) { toast('⚠️ Storage full — export a backup and remove some photos'); }
}
const day = k => (S.days[k] ||= { food: [], exercise: [], weight: null });
const peekDay = k => S.days[k] || { food: [], exercise: [], weight: null };

/* ═════════════ the math ═════════════ */
const ACTIVITY = {
  sedentary: { f: 1.2, label: 'Sedentary', desc: 'Desk job, little walking' },
  light: { f: 1.375, label: 'Light', desc: 'On your feet some of the day' },
  active: { f: 1.55, label: 'Active', desc: 'Active job or lots of walking' },
};

function latestWeight(uptoKey = '9999-12-31') {
  const keys = Object.keys(S.days).filter(k => k <= uptoKey && S.days[k].weight).sort();
  return keys.length ? S.days[keys[keys.length - 1]].weight : S.profile.startWeight;
}
function weightSeries() {
  const pts = Object.keys(S.days).filter(k => S.days[k].weight).sort().map(k => ({ k, w: S.days[k].weight }));
  if (!pts.length || pts[0].k > S.profile.startDate) pts.unshift({ k: S.profile.startDate, w: S.profile.startWeight });
  return pts;
}
function bmr(weightLbs) {
  const p = S.profile, kg = weightLbs * 0.453592, cm = p.heightIn * 2.54;
  return 10 * kg + 6.25 * cm - 5 * p.age + (p.sex === 'male' ? 5 : -161);
}
function tdee(weightLbs) { return bmr(weightLbs) * ACTIVITY[S.profile.activity].f; }
/** Daily calorie target (net = eaten − exercise) for a given day. */
function targetFor(k = todayKey()) {
  const p = S.profile, w = latestWeight(k), maintain = tdee(w);
  let deficit = 500; // ≈ 1 lb / week
  if (p.targetDate && p.targetDate > k) {
    const lbsLeft = Math.max(0, w - p.goalWeight), days = Math.max(1, daysBetween(k, p.targetDate));
    deficit = clamp((lbsLeft * 3500) / days, 250, 1000);
  }
  if (w <= p.goalWeight) deficit = 0; // goal reached → maintain
  const floor = p.sex === 'male' ? 1500 : 1200;
  return Math.round(Math.max(floor, maintain - deficit) / 10) * 10;
}

function totals(k) {
  const d = peekDay(k);
  const eaten = d.food.reduce((a, f) => a + (Number(f.cal) || 0), 0);
  const burned = d.exercise.reduce((a, f) => a + (Number(f.cal) || 0), 0);
  return { eaten, burned, net: eaten - burned, meals: d.food.length, workouts: d.exercise.length, weighed: !!d.weight };
}
const isLogged = k => peekDay(k).food.length > 0;
const isOnTarget = k => { if (!isLogged(k)) return false; const t = totals(k); return t.net <= targetFor(k) + 50 && t.net >= targetFor(k) * 0.55; };

/** 0–100 daily score: calories 60 · logging 20 · exercise 20 (+ small weigh-in bonus). */
function scoreFor(k) {
  const t = totals(k);
  if (!t.meals && !t.workouts) return { total: 0, cal: 0, log: 0, ex: 0 };
  const target = targetFor(k);
  let cal = 0;
  if (t.meals) {
    if (t.net <= target) {
      const low = target * 0.6; // eating far too little isn't a win
      cal = t.net >= low ? 60 : 60 * clamp(t.net / low, 0, 1) * 0.7 + 18;
    } else cal = 60 * clamp(1 - (t.net - target) / 600, 0, 1);
  }
  const log = Math.min(17, [0, 8, 13, 17][Math.min(3, t.meals)] ?? 17) + (t.weighed ? 3 : 0);
  const ex = clamp((t.burned / 300) * 20, 0, 20);
  return { total: Math.round(clamp(cal + log + ex, 0, 100)), cal: Math.round(cal), log: Math.round(log), ex: Math.round(ex) };
}
const scoreColor = s => s >= 85 ? 'var(--accent)' : s >= 65 ? 'var(--blue)' : s >= 45 ? 'var(--warn)' : 'var(--bad)';
const scoreGrade = s => s >= 95 ? 'S' : s >= 85 ? 'A' : s >= 70 ? 'B' : s >= 55 ? 'C' : s >= 40 ? 'D' : 'F';

/** Current streak: consecutive days ending today (or yesterday, if today isn't logged yet). */
function streak(test) {
  let k = todayKey(), n = 0;
  if (!test(k)) k = addDays(k, -1);
  while (test(k)) { n++; k = addDays(k, -1); }
  return n;
}
function longest(test) {
  const keys = Object.keys(S.days).filter(test).sort();
  let best = 0, run = 0, prev = null;
  for (const k of keys) { run = prev && daysBetween(prev, k) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = k; }
  return best;
}
function scoredDays() {
  return Object.keys(S.days).filter(k => k <= todayKey() && (S.days[k].food.length || S.days[k].exercise.length))
    .map(k => ({ k, ...scoreFor(k), ...totals(k), target: targetFor(k) }));
}
function linreg(pts) { // pts: [{x,y}]
  const n = pts.length; if (n < 2) return null;
  const mx = pts.reduce((a, p) => a + p.x, 0) / n, my = pts.reduce((a, p) => a + p.y, 0) / n;
  const sxx = pts.reduce((a, p) => a + (p.x - mx) ** 2, 0); if (!sxx) return null;
  const slope = pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / sxx;
  return { slope, icpt: my - slope * mx };
}
/** Projection from the last 30 days of weigh-ins, falling back to the calorie-deficit math. */
function projection() {
  const ser = weightSeries(), p = S.profile, now = todayKey(), cur = latestWeight();
  if (cur <= p.goalWeight) return { done: true };
  const recent = ser.filter(s => daysBetween(s.k, now) <= 30);
  const reg = linreg(recent.map(s => ({ x: daysBetween(p.startDate, s.k), y: s.w })));
  let perDay = reg && recent.length >= 3 && reg.slope < -0.005 ? reg.slope : null, src = 'trend';
  if (perDay === null) {
    const days = scoredDays().slice(-14);
    if (days.length >= 3) {
      const avgDef = days.reduce((a, d) => a + (tdee(cur) - d.net), 0) / days.length;
      if (avgDef > 50) { perDay = -avgDef / 3500; src = 'calories'; }
    }
  }
  if (perDay === null) return { done: false, date: null };
  const daysLeft = Math.ceil((cur - p.goalWeight) / -perDay);
  return { done: false, date: addDays(now, daysLeft), perWeek: -perDay * 7, src, reg };
}

/* ═════════════ offline estimators (used when AI isn't set up) ═════════════ */
const FOODS = [ // [keywords, kcal per unit, unit label]
  [['egg'], 75, 'egg'], [['toast', 'bread', 'slice'], 80, 'slice'], [['bagel'], 280, 'bagel'], [['butter'], 100, 'tbsp'],
  [['banana'], 105, 'banana'], [['apple'], 95, 'apple'], [['orange'], 65, 'orange'], [['grape'], 100, 'cup'], [['berries', 'strawberr', 'blueberr'], 70, 'cup'],
  [['oatmeal', 'oats'], 160, 'bowl'], [['cereal'], 220, 'bowl'], [['yogurt', 'yoghurt'], 150, 'cup'], [['granola'], 250, 'half cup'],
  [['milk'], 120, 'cup'], [['coffee'], 5, 'cup'], [['latte'], 190, 'grande'], [['frappuccino', 'frappe'], 380, 'grande'], [['soda', 'coke', 'pepsi', 'sprite'], 150, 'can'],
  [['juice'], 120, 'cup'], [['beer'], 150, 'beer'], [['wine'], 125, 'glass'], [['energy drink', 'monster', 'red bull'], 160, 'can'], [['protein shake', 'shake'], 160, 'shake'],
  [['chicken breast', 'grilled chicken'], 280, 'breast'], [['chicken'], 300, 'serving'], [['nugget'], 48, 'nugget'], [['wing'], 90, 'wing'], [['tender', 'strip'], 120, 'tender'],
  [['steak'], 550, 'steak'], [['burger', 'cheeseburger'], 550, 'burger'], [['hot dog'], 290, 'hot dog'], [['bacon'], 45, 'strip'], [['sausage'], 190, 'link'],
  [['salmon'], 360, 'fillet'], [['tuna'], 180, 'can'], [['shrimp'], 120, 'serving'], [['fish'], 250, 'fillet'],
  [['pizza'], 285, 'slice'], [['taco'], 210, 'taco'], [['burrito'], 750, 'burrito'], [['quesadilla'], 520, 'quesadilla'], [['nachos'], 650, 'plate'],
  [['sandwich', 'sub'], 450, 'sandwich'], [['wrap'], 450, 'wrap'], [['sushi roll', 'roll'], 300, 'roll'], [['ramen'], 450, 'bowl'], [['pho'], 450, 'bowl'],
  [['rice'], 205, 'cup'], [['pasta', 'spaghetti', 'noodle', 'mac'], 400, 'plate'], [['potato'], 160, 'potato'], [['fries'], 380, 'medium'], [['chips'], 150, 'bag'],
  [['salad'], 200, 'bowl'], [['soup'], 200, 'bowl'], [['broccoli', 'veggie', 'vegetable', 'green bean', 'carrot'], 50, 'cup'], [['avocado'], 240, 'avocado'],
  [['cheese'], 110, 'slice'], [['peanut butter', 'pb'], 190, '2 tbsp'], [['pb&j', 'pbj'], 380, 'sandwich'], [['nuts', 'almond', 'peanut', 'cashew'], 170, 'handful'],
  [['protein bar', 'granola bar', 'bar'], 220, 'bar'], [['cookie'], 150, 'cookie'], [['donut', 'doughnut'], 260, 'donut'], [['muffin'], 420, 'muffin'], [['pancake'], 175, 'pancake'], [['waffle'], 220, 'waffle'],
  [['ice cream'], 270, 'cup'], [['chocolate', 'candy'], 220, 'bar'], [['cake'], 350, 'slice'], [['popcorn'], 130, 'cup bag'],
];
const NUMWORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, half: 0.5, couple: 2, few: 3 };
function localFoodEstimate(text) {
  const parts = text.toLowerCase().split(/,|\band\b|\bwith\b|\+|&(?!j)|\n/).map(s => s.trim()).filter(Boolean);
  const items = []; let total = 0;
  for (const part of parts) {
    const m = part.match(/(\d+(?:\.\d+)?)/); const w = part.split(/\s+/).find(x => NUMWORDS[x]);
    const qty = m ? parseFloat(m[1]) : w ? NUMWORDS[w] : 1;
    let large = /\b(large|big|double|xl)\b/.test(part) ? 1.4 : /\b(small|mini|little)\b/.test(part) ? 0.7 : 1;
    const hit = FOODS.find(([keys]) => keys.some(kw => part.includes(kw)));
    if (hit) { const cal = Math.round(hit[1] * qty * large); items.push({ name: part, calories: cal }); total += cal; }
  }
  return items.length ? { items, total_calories: total, confidence: 'low', note: 'Offline rough estimate — set up AI in Me → Settings for better ones.' } : null;
}
const METS = [ // [keywords, MET]
  [['run', 'jog'], 9.8], [['sprint'], 12], [['walk'], 3.5], [['hike'], 6], [['bike', 'cycl', 'spin', 'peloton'], 7.5], [['swim'], 7],
  [['lift', 'weights', 'gym', 'strength'], 5], [['hiit', 'crossfit', 'circuit'], 8], [['yoga', 'stretch', 'pilates'], 3], [['basketball'], 6.5],
  [['soccer', 'football'], 7], [['tennis', 'pickleball'], 7], [['box', 'kickbox', 'sparr', 'mma', 'fight'], 9], [['row'], 7], [['elliptical'], 5],
  [['stair', 'stepper'], 9], [['dance', 'zumba'], 6], [['jump rope', 'rope'], 11], [['clean', 'yard', 'mow'], 4], [['golf'], 4.5],
];
function localExerciseEstimate(text) {
  const t = text.toLowerCase();
  const n = Number(t.trim()); if (!isNaN(n) && n > 0) return { calories: Math.round(n), title: 'Exercise' };
  const hit = METS.find(([keys]) => keys.some(k => t.includes(k)));
  let mins = 30; const h = t.match(/(\d+(?:\.\d+)?)\s*(h|hr|hour)/), mm = t.match(/(\d+)\s*(m|min)/), steps = t.match(/(\d[\d,]*)\s*steps/);
  if (steps) return { calories: Math.round(parseInt(steps[1].replace(/,/g, '')) * 0.04 * (latestWeight() / 160)), title: `${steps[1]} steps` };
  if (h) mins = parseFloat(h[1]) * 60; else if (mm) mins = parseInt(mm[1]);
  const met = hit ? hit[1] : 5, kg = latestWeight() * 0.453592;
  return { calories: Math.round((met - 1) * kg * (mins / 60)), title: text.trim() };
}

/* ═════════════ AI estimate (via your serverless proxy) ═════════════ */
const aiReady = () => !!S.settings.apiUrl;
async function aiEstimate(payload) {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 60000);
  try {
    const r = await fetch(S.settings.apiUrl, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', ...(S.settings.apiCode ? { 'X-App-Code': S.settings.apiCode } : {}) },
      body: JSON.stringify({ ...payload, weightLbs: latestWeight() }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Server error ${r.status}`);
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('AI took too long — try again');
    if (!navigator.onLine) throw new Error('You’re offline — enter calories manually');
    throw e;
  } finally { clearTimeout(timer); }
}
/** Shrink a photo: big version for the AI, tiny thumbnail to keep on the phone. */
function readPhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const make = (max, q) => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', q);
      };
      const out = { ai: make(1024, 0.8), thumb: make(160, 0.7) }; URL.revokeObjectURL(url); resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Couldn’t read that photo')); };
    img.src = url;
  });
}

/* ═════════════ messages ═════════════ */
const QUOTES = [
  'Small steps every day add up to big results.', 'You don’t have to be perfect — just consistent.', 'Progress, not perfection.',
  'The best project you’ll ever work on is you.', 'Discipline is choosing what you want most over what you want now.',
  'One meal at a time. One day at a time.', 'Your future self is watching. Make them proud.', 'Strong is built, not given.',
  'A slow week is still forward motion.', 'Logging is a superpower — awareness changes everything.', 'Hydrate, move, repeat.',
  'Every rep, every step, every choice counts.', 'Fall down seven times, log the eighth.', 'You’ve survived 100% of your hardest days.',
];
function motd() {
  const st = streak(isLogged), t = totals(todayKey()), tgt = targetFor(), lost = round(S.profile.startWeight - latestWeight(), 1);
  const hr = new Date().getHours();
  if (st >= 3 && !isLogged(todayKey())) return `🔥 <b>${st}-day streak</b> on the line — log something today to keep it alive!`;
  if (t.meals && t.net > tgt) return `You’re <b>${fmt(t.net - tgt)} cal over</b> — about ${Math.round((t.net - tgt) / 4.5)} minutes of walking would cover it. 🚶`;
  if (t.meals && hr >= 18 && t.net <= tgt) return `Crushing it — <b>${fmt(tgt - t.net)} cal</b> to spare tonight. 💪`;
  if (lost >= 1 && hr < 11) return `Good morning! You’re <b>${lost} lbs down</b> since you started. Keep stacking days. ☀️`;
  const q = QUOTES[(daysBetween('2026-01-01', todayKey()) % QUOTES.length + QUOTES.length) % QUOTES.length];
  return `<b>Today’s thought:</b> ${q}`;
}

/* ═════════════ badges ═════════════ */
const allFood = () => Object.values(S.days).flatMap(d => d.food);
const allEx = () => Object.values(S.days).flatMap(d => d.exercise);
const lostLbs = () => S.profile.startWeight - Math.min(...weightSeries().map(s => s.w));
const BADGES = [
  { id: 'first', e: '🌱', t: 'First Bite', d: 'Log your first meal', test: () => allFood().length >= 1 },
  { id: 'photo', e: '📸', t: 'Food Paparazzi', d: 'Log a meal with a photo', test: () => allFood().some(f => f.photo) },
  { id: 's3', e: '🔥', t: 'Warming Up', d: '3-day logging streak', test: () => S.records.bestStreak >= 3 },
  { id: 's7', e: '⚡', t: 'One Week Strong', d: '7-day logging streak', test: () => S.records.bestStreak >= 7 },
  { id: 's14', e: '💎', t: 'Two Weeks Deep', d: '14-day logging streak', test: () => S.records.bestStreak >= 14 },
  { id: 's30', e: '👑', t: 'Habit Royalty', d: '30-day logging streak', test: () => S.records.bestStreak >= 30 },
  { id: 's100', e: '🏛️', t: 'Legend', d: '100-day logging streak', test: () => S.records.bestStreak >= 100 },
  { id: 't5', e: '🎯', t: 'Bullseye x5', d: '5 on-target days in a row', test: () => S.records.bestTargetStreak >= 5 },
  { id: 'score90', e: '⭐', t: 'Gold Star', d: 'Score 90+ in a day', test: () => scoredDays().some(d => d.total >= 90) },
  { id: 'score100', e: '💯', t: 'Perfect Day', d: 'Score a perfect 100', test: () => scoredDays().some(d => d.total >= 100) },
  { id: 'ex1', e: '👟', t: 'Get Moving', d: 'Log your first workout', test: () => allEx().length >= 1 },
  { id: 'ex10', e: '🏋️', t: 'Gym Regular', d: 'Log 10 workouts', test: () => allEx().length >= 10 },
  { id: 'burn500', e: '🌋', t: 'Furnace', d: 'Burn 500+ cal in one day', test: () => scoredDays().some(d => d.burned >= 500) },
  { id: 'weigh7', e: '⚖️', t: 'Data Nerd', d: 'Log 7 weigh-ins', test: () => Object.values(S.days).filter(d => d.weight).length >= 7 },
  { id: 'l5', e: '🥉', t: '5 Down', d: 'Lose 5 lbs', test: () => lostLbs() >= 5 },
  { id: 'l10', e: '🥈', t: '10 Down', d: 'Lose 10 lbs', test: () => lostLbs() >= 10 },
  { id: 'l25', e: '🥇', t: '25 Down', d: 'Lose 25 lbs', test: () => lostLbs() >= 25 },
  { id: 'l50', e: '🏆', t: 'Half Century', d: 'Lose 50 lbs', test: () => lostLbs() >= 50 },
  { id: 'week', e: '📅', t: 'Perfect Week', d: '7 on-target days in a row', test: () => S.records.bestTargetStreak >= 7 },
  { id: 'goal', e: '🎉', t: 'Goal Crusher', d: 'Reach your goal weight', test: () => latestWeight() <= S.profile.goalWeight },
];

/** Re-check records, badges & 5-lb milestones after every change; celebrate anything new. */
function evaluate() {
  S.records.bestStreak = Math.max(S.records.bestStreak, longest(isLogged));
  S.records.bestTargetStreak = Math.max(S.records.bestTargetStreak, longest(isOnTarget));
  const fresh = [];
  for (const b of BADGES) if (!S.badges[b.id] && b.test()) { S.badges[b.id] = todayKey(); fresh.push(b); }
  const lost = lostLbs(), celebrations = [];
  for (let m = 5; m <= lost; m += 5) if (!S.milestones.includes(m)) { S.milestones.push(m); celebrations.push(m); }
  save();
  const queue = [
    ...celebrations.map(m => ({ e: '🎊', t: `${m} lbs down!`, d: `You’ve lost ${m} pounds since ${niceDate(S.profile.startDate, { month: 'short', day: 'numeric' })}. That’s huge.` })),
    ...fresh.map(b => ({ e: b.e, t: `Badge unlocked: ${b.t}`, d: b.d })),
  ];
  if (queue.length) celebrate(queue);
}

/* ═════════════ UI helpers ═════════════ */
let tab = 'today', viewDay = todayKey();
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2400); }
function haptic() { try { navigator.vibrate?.(10); } catch { } }
function openSheet(html, onMount) {
  const sh = $('#sheet'); sh.innerHTML = `<div class="grabber"></div>${html}`;
  sh.classList.add('open'); $('#backdrop').classList.add('open'); onMount?.(sh);
}
function closeSheet() { $('#sheet').classList.remove('open'); $('#backdrop').classList.remove('open'); }
$('#backdrop').addEventListener('click', closeSheet);
(() => { // swipe the sheet down to dismiss
  let y0 = null; const sh = $('#sheet');
  sh.addEventListener('touchstart', e => { y0 = sh.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
  sh.addEventListener('touchmove', e => { if (y0 !== null) { const dy = e.touches[0].clientY - y0; if (dy > 0) sh.style.transform = `translateY(${dy}px)`; } }, { passive: true });
  sh.addEventListener('touchend', e => { if (y0 !== null) { const dy = e.changedTouches[0].clientY - y0; sh.style.transform = ''; if (dy > 110) closeSheet(); } y0 = null; });
})();

function celebrate(queue) {
  const item = queue.shift(); if (!item) return;
  confetti();
  const el = document.createElement('div'); el.className = 'celebrate';
  el.innerHTML = `<div class="box"><div class="e">${item.e}</div><h2>${esc(item.t)}</h2><p>${esc(item.d)}</p><button class="btn">Let’s go!</button></div>`;
  document.body.appendChild(el);
  $('button', el).onclick = () => { el.remove(); celebrate(queue); };
}
function confetti() {
  const c = $('#confetti'), ctx = c.getContext('2d'), dpr = devicePixelRatio || 1;
  c.width = innerWidth * dpr; c.height = innerHeight * dpr; ctx.scale(dpr, dpr);
  const colors = ['#4ade80', '#60a5fa', '#fbbf24', '#f87171', '#a78bfa', '#fb923c', '#f472b6'];
  const P = Array.from({ length: 160 }, () => ({
    x: innerWidth / 2 + (Math.random() - .5) * 80, y: innerHeight * .35, vx: (Math.random() - .5) * 14, vy: Math.random() * -14 - 4,
    s: Math.random() * 7 + 4, r: Math.random() * 6, vr: (Math.random() - .5) * .4, c: colors[(Math.random() * colors.length) | 0],
  }));
  let f = 0;
  (function tick() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of P) { p.vy += .35; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.r += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore(); }
    if (++f < 180) requestAnimationFrame(tick); else ctx.clearRect(0, 0, innerWidth, innerHeight);
  })();
}
function ring(pct, color, size = 150, stroke = 14) {
  const r = (size - stroke) / 2, C = 2 * Math.PI * r, p = clamp(pct, 0, 1);
  return `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--card2)" stroke-width="${stroke}"/>
  <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - p)}" style="transition:stroke-dashoffset .6s"/></svg>`;
}

/* ═════════════ screens ═════════════ */
function render() {
  const app = $('#app');
  if (!S.profile) { $('#tabbar').classList.add('hidden'); app.innerHTML = onboardingHTML(); bindOnboarding(); return; }
  $('#tabbar').classList.remove('hidden');
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  app.innerHTML = { today: todayHTML, journey: journeyHTML, ranks: ranksHTML, badges: badgesHTML, me: meHTML }[tab]();
  ({ today: bindToday, me: bindMe }[tab])?.();
}
$$('.tab').forEach(t => t.addEventListener('click', () => { haptic(); tab = t.dataset.tab; if (tab === 'today') viewDay = todayKey(); render(); scrollTo(0, 0); }));

/* ── onboarding ── */
function profileForm(p = {}) {
  const ft = p.heightIn ? Math.floor(p.heightIn / 12) : '', inch = p.heightIn ? p.heightIn % 12 : '';
  return `
  <div class="field"><label>Sex (for the calorie formula)</label><div class="seg" data-seg="sex">
    <button type="button" data-v="male" class="${p.sex === 'male' ? 'on' : ''}">Male</button><button type="button" data-v="female" class="${p.sex === 'female' ? 'on' : ''}">Female</button></div></div>
  <div class="grid2">
    <div class="field"><label>Age</label><input class="input" id="f-age" inputmode="numeric" placeholder="30" value="${p.age ?? ''}"></div>
    <div class="field"><label>Height</label><div class="row"><input class="input" id="f-ft" inputmode="numeric" placeholder="5 ft" value="${ft}"><input class="input" id="f-in" inputmode="numeric" placeholder="10 in" value="${inch}"></div></div>
  </div>
  <div class="grid2">
    <div class="field"><label>${p.startWeight ? 'Start weight' : 'Current weight'} (lbs)</label><input class="input" id="f-start" inputmode="decimal" placeholder="210" value="${p.startWeight ?? ''}"></div>
    <div class="field"><label>Goal weight (lbs)</label><input class="input" id="f-goal" inputmode="decimal" placeholder="180" value="${p.goalWeight ?? ''}"></div>
  </div>
  <div class="field"><label>Activity level (not counting workouts you log)</label><div class="seg" data-seg="activity">
    ${Object.entries(ACTIVITY).map(([k, a]) => `<button type="button" data-v="${k}" class="${(p.activity || 'light') === k ? 'on' : ''}">${a.label}</button>`).join('')}</div></div>
  <div class="field"><label>Target date (optional)</label><input class="input" id="f-date" type="date" value="${p.targetDate ?? ''}"></div>`;
}
function readProfileForm(root, prev = {}) {
  const seg = n => $(`[data-seg="${n}"] .on`, root)?.dataset.v;
  const p = {
    ...prev, sex: seg('sex'), activity: seg('activity') || 'light', age: Number($('#f-age', root).value),
    heightIn: Number($('#f-ft', root).value) * 12 + Number($('#f-in', root).value || 0),
    startWeight: Number($('#f-start', root).value), goalWeight: Number($('#f-goal', root).value), targetDate: $('#f-date', root).value || null,
  };
  if (!p.sex) return 'Pick male or female';
  if (!(p.age >= 13 && p.age <= 100)) return 'Enter your age';
  if (!(p.heightIn >= 48 && p.heightIn <= 96)) return 'Enter your height in feet and inches';
  if (!(p.startWeight >= 70 && p.startWeight <= 700)) return 'Enter your weight in lbs';
  if (!(p.goalWeight >= 70 && p.goalWeight < p.startWeight)) return 'Goal weight should be below your current weight';
  return p;
}
function bindSegs(root) { $$('.seg', root).forEach(seg => seg.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $$('button', seg).forEach(x => x.classList.toggle('on', x === b)); haptic(); })); }
function onboardingHTML() {
  return `<div class="onb-hero"><div class="e">🌿</div><h1>Welcome to Leanline</h1><p class="sub">Log what you eat and burn. We handle the math, scores, streaks and your journey.</p></div>
  <div class="card" id="onb">${profileForm()}<button class="btn" id="onb-go">Start my journey</button>
  <p class="sub" style="text-align:center;margin:12px 0 0">Everything stays on this phone.</p></div>`;
}
function bindOnboarding() {
  const root = $('#onb'); bindSegs(root);
  $('#onb-go').onclick = () => {
    const p = readProfileForm(root); if (typeof p === 'string') return toast(p);
    p.startDate = todayKey(); S.profile = p; day(p.startDate).weight = p.startWeight; save();
    tab = 'today'; render(); toast(`Your daily target: ${fmt(targetFor())} cal`);
  };
}

/* ── today ── */
function todayHTML() {
  const k = viewDay, d = peekDay(k), t = totals(k), tgt = targetFor(k), sc = scoreFor(k), isToday = k === todayKey();
  const left = tgt - t.net, st = streak(isLogged), pct = t.net / tgt;
  const ringColor = t.net > tgt ? 'var(--bad)' : pct > 0.9 ? 'var(--warn)' : 'var(--accent)';
  const entry = (e, type) => `<div class="entry">
      ${e.photo ? `<img class="thumb" src="${e.photo}" alt="">` : `<div class="thumb">${type === 'food' ? '🍽️' : '🏃'}</div>`}
      <div class="meta"><div class="name">${esc(e.name)}</div><div class="note">${esc(e.note || (e.time ? new Date(e.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''))}</div></div>
      <div class="cal" style="color:${type === 'food' ? 'var(--text)' : 'var(--accent)'}">${type === 'food' ? '' : '−'}${fmt(e.cal)}</div>
      <button class="del" data-del="${type}:${e.id}" aria-label="Delete">✕</button></div>`;
  return `
  <div class="topbar">
    <div class="datenav"><button id="prev" aria-label="Previous day">‹</button><div class="lbl">${relDate(k)}</div><button id="next" aria-label="Next day" ${isToday ? 'disabled style="opacity:.3"' : ''}>›</button></div>
    <div class="streak-pill ${st ? '' : 'cold'}">🔥 <span class="num">${st}</span></div>
  </div>
  ${isToday ? `<div class="motd">${motd()}</div>` : ''}
  <div class="card"><div class="hero">
    <div class="ring">${ring(pct, ringColor)}<div class="center"><div class="v">${fmt(Math.abs(left))}</div><div class="l">${left >= 0 ? 'cal left' : 'cal over'}</div></div></div>
    <div class="stats">
      <div class="stat"><div class="k">EATEN</div><div class="v">${fmt(t.eaten)}</div></div>
      <div class="stat"><div class="k">BURNED</div><div class="v" style="color:var(--accent)">${fmt(t.burned)}</div></div>
      <div class="stat"><div class="k">TARGET (NET)</div><div class="v">${fmt(tgt)}</div></div>
    </div></div>
    <div class="row between" style="margin-top:14px">
      <span class="sub">Day score</span>
      <span class="score-chip" style="color:${scoreColor(sc.total)}">${sc.total} <span style="opacity:.7">· ${scoreGrade(sc.total)}</span></span>
    </div>
    <div class="scorebar"><i style="width:${sc.total}%;background:${scoreColor(sc.total)}"></i></div>
    <div class="sub" style="margin-top:6px;font-size:12px">Calories ${sc.cal}/60 · Logging ${sc.log}/20 · Exercise ${sc.ex}/20</div>
  </div>
  <div class="quick">
    <button class="qbtn" data-add="food"><span class="e">🍽️</span>Food</button>
    <button class="qbtn" data-add="exercise"><span class="e">🏃</span>Exercise</button>
    <button class="qbtn" data-add="weight"><span class="e">⚖️</span>${d.weight ? d.weight + ' lb' : 'Weight'}</button>
  </div>
  <div class="card"><h3>Food · ${fmt(t.eaten)} cal</h3>${d.food.map(e => entry(e, 'food')).join('') || '<div class="empty">Nothing logged yet — tap Food above</div>'}</div>
  <div class="card"><h3>Exercise · ${fmt(t.burned)} cal</h3>${d.exercise.map(e => entry(e, 'exercise')).join('') || '<div class="empty">No workouts yet</div>'}</div>`;
}
function bindToday() {
  $('#prev').onclick = () => { viewDay = addDays(viewDay, -1); render(); };
  $('#next').onclick = () => { if (viewDay < todayKey()) { viewDay = addDays(viewDay, 1); render(); } };
  $$('[data-add]').forEach(b => b.onclick = () => { haptic(); ({ food: foodSheet, exercise: exerciseSheet, weight: weightSheet })[b.dataset.add](); });
  $$('[data-del]').forEach(b => b.onclick = () => {
    const [type, id] = b.dataset.del.split(':'), list = day(viewDay)[type], e = list.find(x => x.id === id);
    if (!confirm(`Delete “${e.name}”?`)) return;
    list.splice(list.indexOf(e), 1); save(); render(); toast('Deleted');
  });
}
function addEntry(type, e) {
  const k = viewDay; day(k)[type].push({ id: uid(), time: Date.now(), ...e }); save();
  closeSheet(); haptic();
  const prevStreak = S.records.bestStreak; evaluate(); render();
  const st = streak(isLogged);
  toast(type === 'food' ? `+${fmt(e.cal)} cal · ${fmt(Math.max(0, targetFor(k) - totals(k).net))} left${st > 1 && st > prevStreak ? ` · 🔥 ${st} days!` : ''}` : `🔥 −${fmt(e.cal)} cal burned`);
}

/* recent foods → one-tap re-add */
function recentFoods() {
  const seen = new Map();
  Object.keys(S.days).sort().reverse().forEach(k => S.days[k].food.slice().reverse().forEach(f => {
    const key = f.name.toLowerCase(); if (!seen.has(key)) seen.set(key, f);
  }));
  return [...seen.values()].slice(0, 8);
}
function foodSheet() {
  const recents = recentFoods();
  openSheet(`<h2>🍽️ Log food</h2>
    ${recents.length ? `<div class="sub" style="margin:0 0 8px 4px">Tap to re-add</div><div class="chips">${recents.map((f, i) => `<button class="chip" data-recent="${i}">${esc(f.name)} <small>${fmt(f.cal)}</small></button>`).join('')}</div>` : ''}
    <label class="photo-drop" id="photo-drop"><input type="file" accept="image/*" id="photo-in" hidden><span>📷 Add a photo</span></label>
    <div class="field"><label>What did you eat?</label><textarea class="input" id="food-txt" placeholder="e.g. 2 eggs and toast with butter"></textarea></div>
    <div class="field"><label>Calories (leave blank and we’ll estimate)</label><input class="input" id="food-cal" inputmode="numeric" placeholder="optional"></div>
    <div id="est"></div>
    <button class="btn" id="food-go">Add</button>
    ${aiReady() ? '' : '<p class="sub" style="text-align:center">Photo estimates need AI — set it up in Me → AI Estimates.</p>'}`, sh => {
    let photo = null, estimate = null;
    $$('[data-recent]', sh).forEach(b => b.onclick = () => { const f = recents[+b.dataset.recent]; addEntry('food', { name: f.name, cal: f.cal, note: 'Re-added', photo: f.photo || null }); });
    $('#photo-in', sh).onchange = async e => {
      const file = e.target.files[0]; if (!file) return;
      try {
        photo = await readPhoto(file); estimate = null;
        $('#photo-drop', sh).innerHTML = `<img src="${photo.ai}" alt=""><button class="x" id="photo-x" type="button">✕</button>`;
        $('#photo-x', sh).onclick = ev => { ev.preventDefault(); foodSheet(); };
      } catch (err) { toast(err.message); }
    };
    $('#food-txt', sh).oninput = () => { estimate = null; $('#est', sh).innerHTML = ''; setBtn('Add'); };
    const btn = $('#food-go', sh), setBtn = (h, busy) => { btn.innerHTML = h; btn.disabled = !!busy; };
    btn.onclick = async () => {
      const text = $('#food-txt', sh).value.trim(), cal = Number($('#food-cal', sh).value);
      if (cal > 0) return addEntry('food', { name: text || 'Food', cal: Math.round(cal), photo: photo?.thumb || null });
      if (estimate) return addEntry('food', { name: estimate.title || text || 'Meal', cal: estimate.total_calories, note: `${estimate.confidence || 'AI'} confidence estimate`, photo: photo?.thumb || null });
      if (!text && !photo) return toast('Type what you ate or add a photo');
      if (aiReady()) {
        setBtn('<span class="spinner"></span> Estimating…', true);
        try { estimate = await aiEstimate({ kind: 'food', text, image: photo?.ai || null }); }
        catch (err) { toast(err.message); estimate = text ? localFoodEstimate(text) : null; }
      } else if (photo && !text) { toast('Add a description too — AI isn’t set up yet'); return; }
      else estimate = localFoodEstimate(text);
      if (!estimate) { setBtn('Add'); return toast('Couldn’t guess that — enter calories'); }
      $('#est', sh).innerHTML = `<div class="estimate"><div class="row between"><span class="sub">Estimated</span><span class="tot">${fmt(estimate.total_calories)} cal</span></div>
        <ul>${(estimate.items || []).map(i => `<li>${esc(i.name)}${i.portion ? ` (${esc(i.portion)})` : ''} — ${fmt(i.calories)}</li>`).join('')}</ul>
        ${estimate.note ? `<div class="sub">${esc(estimate.note)}</div>` : ''}</div>`;
      $('#food-cal', sh).placeholder = `${estimate.total_calories} (estimated — type to override)`;
      setBtn(`Add ${fmt(estimate.total_calories)} cal`);
    };
  });
}
const WORKOUTS = ['30 min walk', '30 min run', '45 min weights', '30 min bike', '20 min HIIT', '10,000 steps'];
function exerciseSheet() {
  openSheet(`<h2>🏃 Log exercise</h2>
    <div class="chips">${WORKOUTS.map(w => `<button class="chip" data-w="${esc(w)}">${esc(w)}</button>`).join('')}</div>
    <div class="field"><label>Workout or calories burned</label><input class="input" id="ex-txt" placeholder="e.g. 45 min run, or 350"></div>
    <div id="est"></div><button class="btn" id="ex-go">Add</button>`, sh => {
    const go = async text => {
      if (!text) return toast('Type a workout or a number');
      const btn = $('#ex-go', sh); let est;
      if (!isNaN(Number(text))) est = localExerciseEstimate(text);
      else if (aiReady()) {
        btn.innerHTML = '<span class="spinner"></span> Estimating…'; btn.disabled = true;
        try { est = await aiEstimate({ kind: 'exercise', text }); } catch (e) { toast(e.message); est = localExerciseEstimate(text); }
      } else est = localExerciseEstimate(text);
      addEntry('exercise', { name: est.title || text, cal: Math.max(0, Math.round(est.calories)), note: est.note || '' });
    };
    $$('[data-w]', sh).forEach(b => b.onclick = () => go(b.dataset.w));
    $('#ex-go', sh).onclick = () => go($('#ex-txt', sh).value.trim());
  });
}
function weightSheet() {
  const cur = peekDay(viewDay).weight || latestWeight(viewDay);
  openSheet(`<h2>⚖️ Weigh-in</h2><p class="sub" style="margin-top:-8px">Best first thing in the morning.</p>
    <div class="stepper field"><button id="w-minus">−</button><input class="input" id="w-val" inputmode="decimal" value="${cur}"><button id="w-plus">+</button></div>
    <button class="btn" id="w-go">Save weight</button>`, sh => {
    const inp = $('#w-val', sh), bump = n => { inp.value = round(Number(inp.value) + n, 1); haptic(); };
    $('#w-minus', sh).onclick = () => bump(-0.2); $('#w-plus', sh).onclick = () => bump(0.2);
    $('#w-go', sh).onclick = () => {
      const w = Number(inp.value); if (!(w > 50 && w < 800)) return toast('Enter a valid weight');
      const before = latestWeight(); day(viewDay).weight = round(w, 1); save(); closeSheet(); evaluate(); render();
      const diff = round(w - before, 1);
      toast(diff < 0 ? `📉 Down ${-diff} lbs — nice!` : diff > 0 ? `Up ${diff} lbs — normal fluctuation, keep going` : 'Weight saved');
    };
  });
}

/* ── journey ── */
function weightChart() {
  const ser = weightSeries(), p = S.profile, proj = projection();
  const W = 340, H = 200, L = 34, R = 10, T = 12, B = 24;
  const x0 = 0, endDay = Math.max(14, daysBetween(p.startDate, todayKey()) + 3);
  const ws = ser.map(s => s.w).concat(p.goalWeight);
  let lo = Math.floor(Math.min(...ws) - 2), hi = Math.ceil(Math.max(...ws) + 2);
  const X = dd => L + (dd - x0) / (endDay - x0) * (W - L - R), Y = w => T + (hi - w) / (hi - lo) * (H - T - B);
  const pts = ser.map(s => [X(daysBetween(p.startDate, s.k)), Y(s.w)]);
  const ticks = 4, grid = Array.from({ length: ticks + 1 }, (_, i) => lo + (hi - lo) * i / ticks);
  let trend = '';
  if (proj.reg) { const a = Math.max(0, daysBetween(p.startDate, todayKey()) - 30), b = endDay; trend = `<line x1="${X(a)}" y1="${Y(proj.reg.icpt + proj.reg.slope * a)}" x2="${X(b)}" y2="${Y(proj.reg.icpt + proj.reg.slope * b)}" stroke="var(--purple)" stroke-width="2" stroke-dasharray="5 5"/>`; }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Weight over time">
    ${grid.map(g => `<line x1="${L}" x2="${W - R}" y1="${Y(g)}" y2="${Y(g)}" stroke="var(--line)"/><text x="${L - 6}" y="${Y(g) + 4}" fill="var(--dim)" font-size="10" text-anchor="end">${Math.round(g)}</text>`).join('')}
    <line x1="${L}" x2="${W - R}" y1="${Y(p.goalWeight)}" y2="${Y(p.goalWeight)}" stroke="var(--accent)" stroke-dasharray="2 4" stroke-width="1.5"/>
    <text x="${W - R}" y="${Y(p.goalWeight) - 5}" fill="var(--accent)" font-size="10" text-anchor="end">Goal ${p.goalWeight}</text>
    ${trend}
    ${pts.length > 1 ? `<path d="M${pts.map(q => q.join(',')).join(' L')} L${pts[pts.length - 1][0]},${H - B} L${pts[0][0]},${H - B} Z" fill="rgba(96,165,250,.12)"/><polyline points="${pts.map(q => q.join(',')).join(' ')}" fill="none" stroke="var(--blue)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
    ${pts.map(q => `<circle cx="${q[0]}" cy="${q[1]}" r="3.5" fill="var(--bg)" stroke="var(--blue)" stroke-width="2"/>`).join('')}
    <text x="${L}" y="${H - 6}" fill="var(--dim)" font-size="10">${niceDate(p.startDate, { month: 'short', day: 'numeric' })}</text>
    <text x="${W - R}" y="${H - 6}" fill="var(--dim)" font-size="10" text-anchor="end">${niceDate(addDays(p.startDate, endDay), { month: 'short', day: 'numeric' })}</text>
  </svg>`;
}
function calorieChart() {
  const n = 14, W = 340, H = 150, L = 34, R = 10, T = 10, B = 22;
  const keys = Array.from({ length: n }, (_, i) => addDays(todayKey(), i - n + 1));
  const data = keys.map(k => ({ k, ...totals(k), tgt: targetFor(k) }));
  const max = Math.max(500, ...data.map(d => Math.max(d.net, d.tgt))) * 1.1;
  const bw = (W - L - R) / n, Y = v => T + (1 - v / max) * (H - T - B);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Net calories, last 14 days">
    ${[0, .5, 1].map(f => `<line x1="${L}" x2="${W - R}" y1="${Y(max * f / 1.1)}" y2="${Y(max * f / 1.1)}" stroke="var(--line)"/><text x="${L - 6}" y="${Y(max * f / 1.1) + 4}" fill="var(--dim)" font-size="10" text-anchor="end">${Math.round(max * f / 1.1 / 100) / 10}k</text>`).join('')}
    ${data.map((d, i) => { const x = L + i * bw + 3, h = Math.max(0, H - B - Y(Math.max(0, d.net))); return `
      ${d.meals ? `<rect x="${x}" y="${H - B - h}" width="${bw - 6}" height="${h}" rx="3" fill="${d.net <= d.tgt + 50 ? 'var(--accent)' : 'var(--bad)'}" opacity=".85"/>` : `<rect x="${x}" y="${H - B - 3}" width="${bw - 6}" height="3" rx="1.5" fill="var(--line)"/>`}
      <line x1="${x - 2}" x2="${x + bw - 4}" y1="${Y(d.tgt)}" y2="${Y(d.tgt)}" stroke="var(--text)" stroke-width="1.5" opacity=".5"/>
      ${i % 2 === (n - 1) % 2 ? `<text x="${x + (bw - 6) / 2}" y="${H - 7}" fill="var(--dim)" font-size="9" text-anchor="middle">${dateOf(d.k).getDate()}</text>` : ''}`; }).join('')}
  </svg>`;
}
function weekSummary(offset) {
  const end = addDays(todayKey(), -7 * offset), keys = Array.from({ length: 7 }, (_, i) => addDays(end, i - 6));
  const logged = keys.filter(isLogged), sc = logged.map(scoreFor);
  const ws = keys.map(k => peekDay(k).weight).filter(Boolean);
  return {
    logged: logged.length, onTarget: keys.filter(isOnTarget).length,
    avgScore: sc.length ? Math.round(sc.reduce((a, s) => a + s.total, 0) / sc.length) : 0,
    avgNet: logged.length ? Math.round(logged.reduce((a, k) => a + totals(k).net, 0) / logged.length) : 0,
    burned: keys.reduce((a, k) => a + totals(k).burned, 0),
    best: logged.map(k => ({ k, s: scoreFor(k).total })).sort((a, b) => b.s - a.s)[0],
    wChange: ws.length >= 2 ? round(ws[ws.length - 1] - ws[0], 1) : null,
  };
}
function journeyHTML() {
  const p = S.profile, cur = latestWeight(), lost = round(p.startWeight - cur, 1), total = p.startWeight - p.goalWeight;
  const pct = clamp(lost / total, 0, 1), proj = projection(), w = weekSummary(0), lw = weekSummary(1);
  const deficitLbs = round(scoredDays().reduce((a, d) => a + (tdee(latestWeight(d.k)) - d.net), 0) / 3500, 1);
  const arrow = (a, b, higherBetter = true) => a === b ? '' : (a > b) === higherBetter ? ' <span style="color:var(--accent)">▲</span>' : ' <span style="color:var(--bad)">▼</span>';
  return `<div class="page-title">Journey</div>
  <div class="card">
    <div class="row between"><div><div class="sub">Lost so far</div><div class="big" style="color:var(--accent)">${lost > 0 ? lost : 0} <span style="font-size:18px">lbs</span></div></div>
    <div style="text-align:right"><div class="sub">Current</div><div class="big">${cur}</div></div></div>
    <div class="progressbar"><i style="width:${pct * 100}%"></i></div>
    <div class="row between sub"><span>${p.startWeight} start</span><span>${Math.round(pct * 100)}%</span><span>${p.goalWeight} goal</span></div>
  </div>
  <div class="card"><h3>Projected goal date</h3>
    ${proj.done ? '<div class="big">🎉 Goal reached!</div>' : proj.date ? `<div class="big">${niceDate(proj.date, { month: 'long', day: 'numeric', year: 'numeric' })}</div>
      <div class="sub">At ${round(proj.perWeek, 1)} lbs/week, based on your ${proj.src === 'trend' ? 'weigh-in trend' : 'calorie deficit'}${p.targetDate ? ` · target ${niceDate(p.targetDate, { month: 'short', day: 'numeric' })} ${proj.date <= p.targetDate ? '✅ on track' : '⚠️ behind'}` : ''}</div>`
      : '<div class="sub">Log a few days of food and a couple of weigh-ins and we’ll project your goal date.</div>'}
  </div>
  <div class="card chart"><h3>Weight</h3>${weightChart()}
    <div class="legend"><span><i style="background:var(--blue)"></i>Weigh-ins</span><span><i style="background:var(--purple)"></i>30-day trend</span><span><i style="background:var(--accent)"></i>Goal</span></div></div>
  <div class="card chart"><h3>Net calories · last 14 days</h3>${calorieChart()}
    <div class="legend"><span><i style="background:var(--accent)"></i>On target</span><span><i style="background:var(--bad)"></i>Over</span><span><i style="background:var(--text);opacity:.5"></i>Target</span></div></div>
  <div class="card"><h3>This week vs last week</h3>
    <div class="grid2">
      <div class="stat"><div class="k">AVG SCORE</div><div class="v">${w.avgScore}${arrow(w.avgScore, lw.avgScore)}</div><div class="sub">last wk ${lw.avgScore}</div></div>
      <div class="stat"><div class="k">ON-TARGET DAYS</div><div class="v">${w.onTarget}/7${arrow(w.onTarget, lw.onTarget)}</div><div class="sub">last wk ${lw.onTarget}/7</div></div>
      <div class="stat"><div class="k">AVG NET CAL</div><div class="v">${fmt(w.avgNet)}${arrow(w.avgNet, lw.avgNet, false)}</div><div class="sub">last wk ${fmt(lw.avgNet)}</div></div>
      <div class="stat"><div class="k">BURNED</div><div class="v">${fmt(w.burned)}${arrow(w.burned, lw.burned)}</div><div class="sub">last wk ${fmt(lw.burned)}</div></div>
    </div>
    <p class="sub" style="margin:12px 0 0">${w.best ? `Best day: <b style="color:var(--text)">${niceDate(w.best.k)}</b> (${w.best.s}). ` : ''}${w.wChange !== null ? `Weight ${w.wChange <= 0 ? 'down' : 'up'} ${Math.abs(w.wChange)} lbs this week. ` : ''}${w.logged < 7 ? `Logged ${w.logged}/7 days.` : 'Logged every day! 🙌'}</p>
  </div>
  <div class="card"><h3>By the numbers</h3><div class="grid2">
    <div class="stat"><div class="k">DAYS ON JOURNEY</div><div class="v">${daysBetween(p.startDate, todayKey()) + 1}</div></div>
    <div class="stat"><div class="k">DAYS LOGGED</div><div class="v">${Object.keys(S.days).filter(isLogged).length}</div></div>
    <div class="stat"><div class="k">DEFICIT ≈ FAT</div><div class="v">${deficitLbs > 0 ? deficitLbs : 0} lbs</div></div>
    <div class="stat"><div class="k">MAINTENANCE</div><div class="v">${fmt(tdee(cur))}</div></div>
  </div></div>`;
}

/* ── ranks ── */
function ranksHTML() {
  const days = scoredDays().sort((a, b) => b.total - a.total || a.net - b.net);
  const st = streak(isLogged), tst = streak(isOnTarget);
  const medal = i => ['🥇', '🥈', '🥉'][i] || `#${i + 1}`;
  const pod = (d, i, cls = '') => d ? `<div class="pod ${cls}"><div class="m">${medal(i)}</div><div class="sc" style="color:${scoreColor(d.total)}">${d.total}</div><div class="dt">${relDate(d.k)}</div></div>` : '<div class="pod" style="opacity:.3"><div class="m">·</div><div class="sc">–</div><div class="dt">—</div></div>';
  return `<div class="page-title">Rankings</div>
  <div class="grid2" style="margin-bottom:12px">
    <div class="card" style="margin:0"><h3>🔥 Logging streak</h3><div class="big">${st}</div><div class="sub">Best: ${S.records.bestStreak} days</div></div>
    <div class="card" style="margin:0"><h3>🎯 On-target streak</h3><div class="big">${tst}</div><div class="sub">Best: ${S.records.bestTargetStreak} days</div></div>
  </div>
  ${days.length ? `<div class="podium">${pod(days[1], 1)}${pod(days[0], 0, 'first')}${pod(days[2], 2)}</div>` : ''}
  <div class="card"><h3>All days · best to worst</h3>
    ${days.map((d, i) => `<div class="rank"><div class="pos">${medal(i)}</div>
      <div class="meta"><div class="d">${niceDate(d.k)}${d.k === todayKey() ? ' · Today' : ''}</div>
      <div class="s">🍽️ ${fmt(d.eaten)} · 🏃 ${fmt(d.burned)} · net ${fmt(d.net)}</div>
      <div class="scorebar"><i style="width:${d.total}%;background:${scoreColor(d.total)}"></i></div></div>
      <div class="score" style="color:${scoreColor(d.total)}">${d.total}</div></div>`).join('') || '<div class="empty">Log your first day to get ranked</div>'}
  </div>
  <p class="sub" style="text-align:center">Score = calories on target (60) + logging meals & weigh-in (20) + exercise (20)</p>`;
}

/* ── badges ── */
function badgesHTML() {
  const got = BADGES.filter(b => S.badges[b.id]).length;
  return `<div class="page-title">Badges</div><p class="sub" style="margin-top:-8px">${got} of ${BADGES.length} unlocked</p>
  <div class="progressbar"><i style="width:${got / BADGES.length * 100}%"></i></div>
  <div class="badges" style="margin-top:14px">${BADGES.map(b => `<div class="badge ${S.badges[b.id] ? '' : 'locked'}"><div class="e">${b.e}</div><div class="t">${esc(b.t)}</div>
    <div class="dsc">${S.badges[b.id] ? `✓ ${niceDate(S.badges[b.id], { month: 'short', day: 'numeric' })}` : esc(b.d)}</div></div>`).join('')}</div>`;
}

/* ── me / settings ── */
function meHTML() {
  const p = S.profile, used = (() => { try { return Math.round((localStorage.getItem(STORE_KEY) || '').length / 1024); } catch { return 0; } })();
  return `<div class="page-title">Me</div>
  <div class="card"><h3>Your numbers</h3><div class="settings-list">
    <div class="item"><span>Daily target (net)</span><b>${fmt(targetFor())} cal</b></div>
    <div class="item"><span>Maintenance (TDEE)</span><b>${fmt(tdee(latestWeight()))} cal</b></div>
    <div class="item"><span>Resting burn (BMR)</span><b>${fmt(bmr(latestWeight()))} cal</b></div>
  </div></div>
  <div class="card" id="prof"><h3>Profile</h3>${profileForm(p)}<button class="btn secondary" id="prof-save">Save profile</button></div>
  <div class="card"><h3>AI estimates (photos & descriptions)</h3>
    <p class="sub" style="margin-top:0">Paste your estimator URL from the setup guide. Without it, typed foods use a built-in offline guesser.</p>
    <div class="field"><label>Estimator URL</label><input class="input" id="api-url" type="url" placeholder="https://your-app.vercel.app/api/estimate" value="${esc(S.settings.apiUrl)}" autocapitalize="off" autocorrect="off"></div>
    <div class="field"><label>Passcode (matches APP_PASSCODE)</label><input class="input" id="api-code" placeholder="optional" value="${esc(S.settings.apiCode)}" autocapitalize="off" autocorrect="off"></div>
    <div class="grid2"><button class="btn secondary" id="api-save">Save</button><button class="btn secondary" id="api-test">Test</button></div>
  </div>
  <div class="card"><h3>Backup</h3><p class="sub" style="margin-top:0">Your data lives only on this phone (${used} KB). Export a backup now and then — save it to Files or iCloud.</p>
    <div class="grid2"><button class="btn secondary" id="exp">⬇️ Export</button><label class="btn secondary">⬆️ Import<input type="file" id="imp" accept="application/json,.json" hidden></label></div>
  </div>
  <div class="card"><button class="btn danger" id="reset">Erase everything</button></div>
  <p class="sub" style="text-align:center">Leanline · estimates are guides, not medical advice</p>`;
}
function bindMe() {
  const root = $('#prof'); bindSegs(root);
  $('#prof-save').onclick = () => {
    const np = readProfileForm(root, S.profile); if (typeof np === 'string') return toast(np);
    if (np.startWeight !== S.profile.startWeight) day(S.profile.startDate).weight = np.startWeight;
    S.profile = np; save(); evaluate(); render(); toast(`Saved · new target ${fmt(targetFor())} cal`);
  };
  $('#api-save').onclick = () => { S.settings.apiUrl = $('#api-url').value.trim(); S.settings.apiCode = $('#api-code').value.trim(); save(); toast('AI settings saved'); };
  $('#api-test').onclick = async () => {
    S.settings.apiUrl = $('#api-url').value.trim(); S.settings.apiCode = $('#api-code').value.trim(); save();
    if (!aiReady()) return toast('Paste your estimator URL first');
    toast('Testing…');
    try { const r = await aiEstimate({ kind: 'food', text: '1 banana' }); toast(`✅ Works! 1 banana ≈ ${r.total_calories} cal`); } catch (e) { toast(`❌ ${e.message}`); }
  };
  $('#exp').onclick = async () => {
    const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' }), name = `leanline-backup-${todayKey()}.json`;
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Leanline backup' }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  $('#imp').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text()); if (!data.profile || !data.days) throw new Error();
      if (!confirm('Replace everything on this phone with this backup?')) return;
      S = Object.assign(blank(), data); save(); render(); toast('Backup restored');
    } catch { toast('That file isn’t a Leanline backup'); }
  };
  $('#reset').onclick = () => {
    if (!confirm('Erase all your data? This can’t be undone.')) return;
    if (!confirm('Really sure? Export a backup first if you might want it.')) return;
    S = blank(); save(); tab = 'today'; render();
  };
}

/* ═════════════ boot ═════════════ */
render();
if (S.profile) evaluate();
// When the app comes back to the foreground on a new day, jump to today.
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.profile && tab === 'today' && viewDay !== todayKey()) { viewDay = todayKey(); render(); } });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
