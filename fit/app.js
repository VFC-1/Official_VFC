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
const blank = () => ({ profile: null, days: {}, badges: {}, milestones: [], templates: [], ffRecent: [],
  records: { bestStreak: 0, bestTargetStreak: 0, highestRank: -1, lastRank: -1 }, settings: { apiUrl: '', apiCode: '' } });
/** Merge saved data over defaults so older saves pick up new fields without losing anything. */
function hydrate(data) {
  const b = blank();
  return { ...b, ...data, records: { ...b.records, ...(data.records || {}) }, settings: { ...b.settings, ...(data.settings || {}) } };
}
let S = load();
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return blank();
    return hydrate(JSON.parse(raw));
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
/* ═════════════ streak ranks ═════════════ */
const TIERS = [
  { id: 'bronze', n: 'Bronze', c: ['#e3a46b', '#8a4b1d'], rgb: '205,127,50', rgb2: '150,82,32', acc: '236,166,104', band: ['#2b1407', '#8a4c1f', '#c97f3e'], confetti: ['#cd7f32', '#e3a46b', '#8a4b1d', '#f3d2b0'] },
  { id: 'silver', n: 'Silver', c: ['#eef2f7', '#8c96a6'], rgb: '196,206,220', rgb2: '120,132,152', acc: '218,226,236', band: ['#171b23', '#566174', '#aab4c3'], confetti: ['#e5e9f0', '#b8c1cf', '#8c96a6', '#ffffff'] },
  { id: 'gold', n: 'Gold', c: ['#ffe08a', '#b8860b'], rgb: '240,190,60', rgb2: '184,134,11', acc: '247,201,72', band: ['#271c03', '#8c650c', '#dcaa2c'], confetti: ['#f5c542', '#ffe08a', '#b8860b', '#fff4cc'] },
  { id: 'diamond', n: 'Diamond', c: ['#67e8f9', '#8b5cf6'], rgb: '103,232,249', rgb2: '139,92,246', acc: '110,231,249', band: ['#0a1730', '#16698a', '#6d4fe0'], confetti: ['#7dd3fc', '#a5f3fc', '#a78bfa', '#e0e7ff'] },
];
const RANK_MIN = [1, 3, 5, 7, 10, 14, 21, 30, 45, 60, 90, 120];
const RANKS = RANK_MIN.map((min, i) => ({ i, min, tier: TIERS[(i / 3) | 0], lvl: (i % 3) + 1, name: `${TIERS[(i / 3) | 0].n} ${['I', 'II', 'III'][i % 3]}` }));
/** Rank index for a logging streak (−1 = unranked). */
const rankIndex = st => RANK_MIN.reduce((r, min, i) => (st >= min ? i : r), -1);
function rankBadge(i, size = 28) {
  if (i < 0) return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2 28 8v10c0 6-6 11-12 12C10 29 4 24 4 18V8Z" fill="none" stroke="var(--dim)" stroke-width="1.5" stroke-dasharray="3 3"/></svg>`;
  const r = RANKS[i], id = `rk${i}-${size}`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${r.tier.c[0]}"/><stop offset="1" stop-color="${r.tier.c[1]}"/></linearGradient></defs>
    <path d="M16 2 28 8v10c0 6-6 11-12 12C10 29 4 24 4 18V8Z" fill="url(#${id})" stroke="rgba(255,255,255,.35)" stroke-width="1"/>
    <text x="16" y="20.5" text-anchor="middle" font-size="${r.lvl === 3 ? 9.5 : 11}" font-weight="800" fill="rgba(20,16,10,.72)" font-family="-apple-system,system-ui,sans-serif">${['I', 'II', 'III'][r.lvl - 1]}</text></svg>`;
}
/** Tint the app background to the current rank (subtle; richer per level). */
const BASE_THEME = { acc: '74,222,128', band: ['#05211a', '#0f6447', '#1e9f78'], rgb: '74,222,128', rgb2: '45,212,191' };
function applyRankTheme() {
  const b = document.body, i = S.profile ? rankIndex(streak(isLogged)) : -1, r = RANKS[i];
  const th = r ? r.tier : BASE_THEME;
  if (r) { b.dataset.tier = r.tier.id; b.dataset.lvl = r.lvl; } else { delete b.dataset.tier; delete b.dataset.lvl; }
  b.style.setProperty('--rk', th.rgb); b.style.setProperty('--rk2', th.rgb2); b.style.setProperty('--acc', th.acc);
  b.style.setProperty('--band1', th.band[0]); b.style.setProperty('--band2', th.band[1]); b.style.setProperty('--band3', th.band[2]);
  $('meta[name="theme-color"]')?.setAttribute('content', th.band[0]);
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
// Offline food list: [keywords (whole words; plurals handled), kcal per unit, unit]. Longest keyword wins.
const FOODS = [
  // breakfast
  [['egg', 'eggs over easy', 'fried egg', 'scrambled egg', 'boiled egg'], 80, 'egg'], [['egg white'], 17, 'egg white'], [['omelet', 'omelette'], 350, 'omelet'],
  [['bacon', 'bacon strip'], 45, 'strip'], [['turkey bacon'], 35, 'strip'], [['sausage', 'sausage link'], 170, 'link'], [['sausage patty'], 200, 'patty'],
  [['pancake'], 175, 'pancake'], [['waffle'], 220, 'waffle'], [['french toast'], 230, 'slice'], [['syrup', 'maple syrup'], 200, 'serving'],
  [['toast', 'bread', 'slice of bread', 'piece of toast'], 80, 'slice'], [['english muffin'], 135, 'muffin'], [['bagel'], 280, 'bagel'], [['biscuit'], 250, 'biscuit'],
  [['biscuits and gravy'], 600, 'plate'], [['gravy'], 100, 'serving'], [['hash brown', 'hashbrown'], 150, 'serving'], [['grits'], 180, 'bowl'],
  [['butter'], 100, 'tbsp'], [['cream cheese'], 100, '2 tbsp'], [['jelly', 'jam'], 50, 'tbsp'], [['honey'], 64, 'tbsp'],
  [['oatmeal', 'oats'], 160, 'bowl'], [['cereal'], 220, 'bowl'], [['yogurt', 'yoghurt', 'greek yogurt'], 150, 'cup'], [['granola'], 250, 'half cup'],
  [['breakfast burrito'], 550, 'burrito'], [['breakfast taco'], 250, 'taco'], [['breakfast sandwich'], 450, 'sandwich'], [['croissant'], 270, 'croissant'],
  [['muffin'], 420, 'muffin'], [['donut', 'doughnut'], 260, 'donut'], [['cinnamon roll'], 420, 'roll'], [['kolache'], 300, 'kolache'],
  // fruit & veg
  [['banana'], 105, 'banana'], [['apple'], 95, 'apple'], [['orange'], 65, 'orange'], [['grape'], 100, 'cup'], [['berries', 'strawberries', 'blueberries', 'strawberry', 'blueberry'], 70, 'cup'],
  [['watermelon'], 85, 'cup'], [['pineapple'], 80, 'cup'], [['mango'], 200, 'mango'], [['peach'], 60, 'peach'], [['fruit', 'fruit cup'], 80, 'cup'],
  [['salad', 'side salad'], 200, 'bowl'], [['caesar salad'], 450, 'bowl'], [['broccoli', 'veggies', 'vegetables', 'green beans', 'carrots', 'corn', 'peas', 'spinach'], 60, 'cup'],
  [['avocado'], 240, 'avocado'], [['guacamole', 'guac'], 230, 'half cup'], [['pickle'], 5, 'pickle'],
  // mains
  [['chicken', 'chicken breast', 'grilled chicken', 'baked chicken'], 280, 'breast'], [['fried chicken'], 400, 'piece'], [['nugget', 'chicken nugget'], 48, 'nugget'],
  [['wing', 'chicken wing', 'hot wing'], 90, 'wing'], [['tender', 'chicken tender', 'chicken strip'], 130, 'tender'], [['rotisserie chicken'], 450, 'quarter'],
  [['steak'], 600, 'steak'], [['ribeye'], 750, 'steak'], [['brisket'], 350, 'serving'], [['ribs', 'rib'], 900, 'half rack'], [['pulled pork'], 400, 'serving'],
  [['pork chop'], 300, 'chop'], [['ham'], 60, 'slice'], [['turkey'], 50, 'slice'], [['meatball'], 75, 'meatball'], [['meatloaf'], 350, 'slice'],
  [['burger', 'hamburger', 'cheeseburger'], 600, 'burger'], [['hot dog', 'corn dog'], 290, 'hot dog'],
  [['salmon'], 360, 'fillet'], [['tuna'], 180, 'can'], [['shrimp'], 120, 'serving'], [['fish', 'tilapia', 'catfish', 'cod'], 250, 'fillet'], [['fish sticks'], 50, 'stick'],
  [['pizza', 'slice of pizza', 'pizza slice', 'pepperoni pizza', 'cheese pizza'], 285, 'slice'], [['personal pizza'], 800, 'pizza'],
  [['taco', 'street taco'], 200, 'taco'], [['burrito'], 750, 'burrito'], [['burrito bowl'], 700, 'bowl'], [['quesadilla'], 520, 'quesadilla'], [['nachos'], 650, 'plate'],
  [['fajita', 'fajitas', 'chicken fajitas', 'beef fajitas', 'fajita chicken', 'fajita beef', 'steak fajitas', 'fajita plate'], 900, 'plate'], [['enchilada'], 330, 'enchilada'], [['tamale'], 285, 'tamale'],
  [['tortilla', 'flour tortilla'], 140, 'tortilla'], [['chips and salsa', 'tortilla chips'], 430, 'basket'], [['queso'], 120, 'quarter cup'], [['salsa', 'pico'], 15, 'serving'],
  [['refried beans', 'beans', 'black beans', 'charro beans'], 220, 'cup'], [['mexican rice', 'spanish rice'], 220, 'cup'], [['sour cream'], 60, '2 tbsp'],
  [['sandwich', 'sub', 'hoagie'], 450, 'sandwich'], [['grilled cheese'], 440, 'sandwich'], [['pbj', 'pb and j', 'peanut butter and jelly'], 380, 'sandwich'],
  [['beef n cheddar', 'roast beef'], 450, 'sandwich'], [['wrap'], 450, 'wrap'], [['sushi', 'sushi roll', 'roll of sushi'], 300, 'roll'], [['ramen'], 450, 'bowl'], [['pho'], 450, 'bowl'],
  [['fried rice'], 520, 'plate'], [['orange chicken'], 490, 'serving'], [['lo mein', 'chow mein'], 500, 'plate'], [['egg roll'], 200, 'egg roll'], [['dumpling', 'potsticker'], 60, 'dumpling'],
  [['rice', 'white rice', 'brown rice'], 205, 'cup'], [['pasta', 'spaghetti', 'noodles', 'penne', 'fettuccine'], 400, 'plate'], [['spaghetti and meatballs'], 700, 'plate'],
  [['lasagna'], 450, 'piece'], [['mac and cheese', 'mac n cheese', 'macaroni'], 400, 'cup'], [['alfredo'], 900, 'plate'],
  [['potato', 'baked potato'], 160, 'potato'], [['mashed potatoes'], 240, 'cup'], [['sweet potato'], 115, 'potato'], [['fries', 'french fries'], 380, 'serving'], [['tots', 'tater tots'], 350, 'serving'],
  [['chili'], 300, 'bowl'], [['soup'], 200, 'bowl'], [['stew'], 350, 'bowl'], [['casserole'], 400, 'serving'], [['pot pie'], 650, 'pie'], [['gumbo'], 350, 'bowl'],
  [['cheese', 'slice of cheese'], 110, 'slice'], [['string cheese'], 80, 'stick'], [['peanut butter'], 190, '2 tbsp'], [['nuts', 'almonds', 'peanuts', 'cashews', 'trail mix'], 170, 'handful'],
  [['hummus'], 70, '2 tbsp'], [['crackers'], 130, 'serving'], [['pretzels'], 110, 'serving'], [['chips', 'potato chips', 'doritos', 'cheetos'], 150, 'bag'], [['popcorn'], 130, 'cup bag'],
  // sweets & snacks
  [['candy bar', 'snickers', 'kit kat', 'twix', 'reeses', 'chocolate bar', 'milky way', 'butterfinger'], 230, 'bar'], [['candy', 'skittles', 'm and ms', 'gummy bears', 'starburst'], 220, 'pack'],
  [['chocolate'], 210, 'bar'], [['protein bar', 'granola bar', 'cliff bar', 'quest bar'], 210, 'bar'], [['cookie'], 150, 'cookie'], [['brownie'], 250, 'brownie'],
  [['cake', 'slice of cake'], 350, 'slice'], [['cupcake'], 300, 'cupcake'], [['pie', 'slice of pie'], 400, 'slice'], [['cheesecake'], 450, 'slice'],
  [['ice cream'], 270, 'cup'], [['milkshake', 'shake'], 600, 'shake'], [['pop tart', 'poptart'], 200, 'pastry'], [['rice krispie treat'], 90, 'bar'],
  // drinks
  [['milk'], 120, 'cup'], [['chocolate milk'], 190, 'cup'], [['coffee', 'black coffee'], 5, 'cup'], [['latte'], 190, 'grande'], [['frappuccino', 'frappe'], 380, 'grande'],
  [['soda', 'coke', 'pepsi', 'sprite', 'dr pepper', 'mountain dew', 'root beer'], 150, 'can'], [['diet coke', 'diet soda', 'coke zero', 'diet dr pepper', 'water', 'sparkling water'], 0, 'drink'],
  [['sweet tea'], 180, 'glass'], [['lemonade'], 200, 'glass'], [['juice', 'orange juice', 'apple juice'], 120, 'cup'], [['smoothie'], 350, 'smoothie'],
  [['beer'], 150, 'beer'], [['light beer', 'michelob ultra', 'bud light', 'coors light'], 100, 'beer'], [['wine', 'glass of wine'], 125, 'glass'], [['margarita'], 300, 'drink'],
  [['energy drink', 'monster', 'red bull', 'celsius'], 160, 'can'], [['protein shake'], 160, 'shake'], [['gatorade', 'powerade'], 140, 'bottle'],
];
const NUMWORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, half: 0.5, couple: 2, few: 3 };

/* ── fast food menu matching ("Big Mac and large fries") ── */
const ffNorm = t => ` ${String(t).toLowerCase().replace(/&/g, ' and ').replace(/[’'®™.!?]/g, '').replace(/-/g, ' ').replace(/[^a-z0-9"\s]/g, ' ').replace(/\s+/g, ' ').trim()} `;
const has = (hay, needle) => hay.includes(` ${needle.trim()} `);
const FF_GENERIC = new Set(['burrito', 'bowl', 'salad', 'taco', 'tacos', 'pizza', 'pasta', 'donut', 'coffee', 'latte', 'cookie', 'chips', 'muffin', 'croissant', 'bagel', 'pepperoni', 'breast', 'thigh', 'leg', 'drumstick', 'wing', 'wings', 'biscuit', 'mac', 'chili', 'baked potato', 'pancakes', 'hotcakes', 'cone', 'lemonade', 'iced coffee', 'chai', 'mocha', 'quesadilla', 'philly', 'teriyaki', 'meatball', 'boneless', 'alfredo', 'garlic bread', 'onion rings', 'tots', 'tater tots', 'slaw', 'coleslaw', 'mashed potatoes', 'egg roll', 'white rice', 'fried rice', 'guac', 'queso', 'minis', 'refresher', 'macchiato', 'shake', 'milkshake', 'tea', 'fries', 'nuggets', 'tenders', 'strips', 'cheeseburger', 'hot dog', 'hash brown', 'hash browns', 'red beans', 'cajun fries', 'apple pie', 'frap', 'chicken sandwich', 'spicy chicken sandwich', 'spicy chicken', 'grilled nuggets', 'cookie', 'iced latte', 'turkey sub', 'tuna sub', 'drip coffee', 'super greens', 'thin crust', 'pan pizza', 'cheese pizza', 'pepperoni pizza', 'bacon egg and cheese', 'sausage egg and cheese', 'chips and cheese', 'teriyaki chicken', 'cobb salad', 'chicken biscuit', 'mac and cheese', 'coke', 'soda', 'pop', 'sprite', 'dr pepper', 'pepsi', 'blast', 'little burger', 'leg', 'strips', 'frosty']);
const FF_INDEX = (() => {
  const count = {};
  FF_CHAINS.forEach(c => new Set(c.items.flatMap(it => it.a.map(a => ffNorm(a).trim()))).forEach(a => { count[a] = (count[a] || 0) + 1; }));
  const global = [];
  FF_CHAINS.forEach(c => c.items.forEach(it => {
    // Only curated, chain-specific aliases match without the restaurant being named.
    it.a.map(a => ffNorm(a).trim()).forEach(k => { if (!FF_GENERIC.has(k) && count[k] === 1 && k.length > 3) global.push({ k, c, it }); });
  }));
  global.sort((a, b) => b.k.length - a.k.length);
  return { global };
})();
// Phrases containing "and" that must not be split into separate foods.
const FF_PROTECT = [...new Set(['mac and cheese', 'mac n cheese', 'pb and j', 'peanut butter and jelly', 'fish and chips', 'biscuits and gravy', 'rice and beans', 'beans and rice', 'chips and salsa',
  ...FF_CHAINS.flatMap(c => c.items.flatMap(it => [ffNorm(it.n.replace(/\(.*?\)/g, '')).trim(), ...it.a.map(a => ffNorm(a).trim())])).filter(k => k.includes(' and ')),
  ...FF_CHAINS.flatMap(c => [c.name, ...c.a]).map(n => ffNorm(n).trim()).filter(k => k.includes(' and '))])].sort((a, b) => b.length - a.length);
const STOP = new Set(['w', 'with', 'the', 'and', 'of', 'a', 'pc', 'ct', 'large', 'small', 'medium', 'slice', 'each', 'typical', 'plain']);
const SIZE_WORDS = [[/\b(small|sm|kids?)\b/, ['s', 'small', 'snack', 'mini', 'half', 'tall', 'little', 'regular']], [/\b(medium|med|regular|reg)\b/, ['m', 'regular', 'grande', 'full']], [/\b(large|lg|big)\b/, ['l', 'large', 'venti']],
  [/\btall\b/, ['tall']], [/\bgrande\b/, ['grande']], [/\bventi\b/, ['venti']], [/\bfoot ?long\b/, ['footlong']], [/\b(6 ?inch|6")/, ['6"']], [/\bhalf\b/, ['half']], [/\blittle\b/, ['little']]];
const TWEAK_WORDS = [['no mayo', ['noMayo']], ['no cheese', ['noCheese', 'noCheese2']], ['no sauce', ['noSauce']], ['no sour cream', ['noSourCream']], ['no whip', ['noWhip']],
  ['no bun', ['noBun']], ['lettuce wrap', ['noBun']], ['diet', ['diet']], ['zero', ['diet']], ['unsweet', ['unsweet']], ['black', ['black']], ['nonfat', ['skim']], ['skim', ['skim']],
  ['oat milk', ['oat']], ['sugar free', ['sfSyrup']], ['add cheese', ['addCheese']], ['w cheese', ['addCheese']], ['bacon', ['addBacon']], ['mayo', ['addMayo']], ['guac', ['addGuac']], ['queso', ['addQueso']], ['sour cream', ['addSourCream']], ['extra cheese', ['extraCheese']]];
const chainIn = t => FF_CHAINS.find(c => [c.name, ...c.a].some(n => has(t, ffNorm(n).trim())));

/** Calories for one order line. */
function ffLineCal(it, sizeIdx, qty, tweaks) {
  const base = it.s ? it.s[sizeIdx][1] : it.c;
  const sets = tweaks.map(k => FF_TWEAKS[k]).filter(t => t && 'set' in t);
  const per = sets.length ? Math.min(...sets.map(t => t.set)) : Math.max(0, base + tweaks.reduce((a, k) => a + (FF_TWEAKS[k]?.d || 0), 0));
  return Math.round(per * qty);
}
function ffLineName(it, sizeIdx, qty, tweaks) {
  const size = it.s ? it.s[sizeIdx][0] + ' ' : '';
  return `${qty !== 1 ? qty + '× ' : ''}${size}${it.n}${tweaks.length ? ` (${tweaks.map(k => FF_TWEAKS[k].l.toLowerCase()).join(', ')})` : ''}`;
}
const ffDefaultSize = it => (it.s ? Math.min(1, it.s.length - 1) : 0);
/** Try to read one food phrase as a menu item. ctx = chain mentioned earlier in the sentence. */
function ffMatchPart(part, ctx) {
  const t = ffNorm(part), named = chainIn(t), chain = named || ctx;
  let best = null;
  if (chain) {
    for (const it of chain.items) {
      const keys = [ffNorm(it.n.replace(/\(.*?\)/g, '')).trim(), ...it.a.map(a => ffNorm(a).trim())];
      let score = 0;
      for (const k of keys) if (has(t, k)) score = Math.max(score, 10 + k.length);
      if (!score) {
        const toks = ffNorm(it.n.replace(/\(.*?\)/g, '')).trim().split(' ').filter(w => !STOP.has(w) && w.length > 1);
        const hit = toks.filter(w => has(t, w) || has(t, w.replace(/s$/, ''))).length;
        if (hit) score = hit / toks.length * 5 + hit;
      }
      if (score && (!best || score > best.score || (score === best.score && it.n.length < best.it.n.length))) best = { score, it, c: chain };
    }
  }
  if (!best || best.score < 2) {
    const g = FF_INDEX.global.find(x => has(t, x.k));
    if (g && !chain) return ffMatchPart(part, g.c); // re-score within that chain ("whopper w cheese" → Whopper w/ Cheese)
    if (g) best = { score: 99, it: g.it, c: g.c };
  }
  if (!best) return null;
  const it = best.it;
  let sizeIdx = ffDefaultSize(it);
  if (it.s) {
    const pc = t.match(/ (\d+) ?(pc|piece|pieces|ct|count|nuggets|tenders|strips|wings)\b/);
    const labels = it.s.map(x => ffNorm(x[0]).trim());
    let found = -1;
    if (pc) found = labels.findIndex(l => l.startsWith(pc[1] + ' '));
    if (found < 0) for (const [re, opts] of SIZE_WORDS) if (re.test(t)) { found = labels.findIndex(l => opts.includes(l)); if (found >= 0) break; }
    if (found >= 0) sizeIdx = found;
  }
  const n = t.match(/^ (\d+(?:\.\d+)?)(?! ?(pc|piece|ct|count|oz|inch|"))/), w = t.trim().split(' ').find(x => NUMWORDS[x] && x !== 'a');
  const qty = n ? parseFloat(n[1]) : w ? NUMWORDS[w] : 1;
  const tweaks = [];
  for (const [phrase, keys] of TWEAK_WORDS) {
    if (!has(t, phrase) || (!phrase.startsWith('no ') && has(t, 'no ' + phrase))) continue;
    const k = keys.find(k => it.t.includes(k));
    if (k && !tweaks.includes(k)) tweaks.push(k);
  }
  return { chain: best.c, it, sizeIdx, qty, tweaks, cal: ffLineCal(it, sizeIdx, qty, tweaks), name: ffLineName(it, sizeIdx, qty, tweaks) };
}
function splitFoods(text) {
  let t = ffNorm(String(text).replace(/[,+\n;]/g, ' and ')).replace(/ with (no |extra |add |cheese|bacon|mayo|guac|queso|sour cream|oat|nonfat|skim)/g, ' w $1');
  FF_PROTECT.forEach(p => { t = t.split(` ${p} `).join(` ${p.replace(/ /g, '_')} `); });
  const parts = t.split(/ and | with | plus | also /).map(x => x.replace(/_/g, ' ').trim()).filter(Boolean);
  // "Whopper, no mayo" → the tweak belongs to the item before it.
  return parts.reduce((out, p) => { if (out.length && /^(no|extra|add|light|without|hold the|diet|zero)\b/.test(p) && !/^(diet|zero) /.test(p)) out[out.length - 1] += ' ' + p; else out.push(p); return out; }, []);
}
/* Generic (non-menu) foods: find every food word in a phrase, longest match first. */
const FOOD_KEYS = FOODS.flatMap(f => f[0].map(k => ({ k: ffNorm(k).trim(), f }))).sort((a, b) => b.k.length - a.k.length);
const QTY_SKIP = new Set(['piece', 'pieces', 'slice', 'slices', 'strip', 'strips', 'cup', 'cups', 'of', 'x', 'large', 'big', 'small', 'medium', 'scoop', 'scoops', 'bowl', 'bowls', 'plate', 'plates', 'handful', 'bag', 'can', 'cans', 'glass', 'glasses', 'serving', 'servings', 'homemade', 'home', 'made', 'fried', 'scrambled', 'grilled', 'baked', 'boiled', 'over', 'easy', 'hard']);
const FILLER = new Set([...QTY_SKIP, 'and', 'with', 'a', 'an', 'the', 'some', 'my', 'had', 'ate', 'for', 'on', 'in', 'w', 'at', 'from', 'side', 'extra', 'little', 'bit', 'lot', 'few', 'couple', 'two', 'three', 'four', 'five', 'one', 'half', 'light', 'regular', 'mini', 'double', 'single', 'plain', 'fresh', 'warm', 'cold', 'hot', 'iced', 'sweet', 'spicy', 'leftover', 'leftovers', 'today', 'breakfast', 'lunch', 'dinner', 'snack', 'meal', 'pc', 'pcs', 'oz', 'lb', 'tbsp', 'tsp']);
function scanFoods(part) {
  const t = ffNorm(part), toks = t.trim().split(' '), used = new Array(toks.length).fill(false), hits = [];
  for (const { k, f } of FOOD_KEYS) {
    const kt = k.split(' ');
    for (let i = 0; i + kt.length <= toks.length; i++) {
      if (used.slice(i, i + kt.length).some(Boolean)) continue;
      const ok = kt.every((w, j) => { const x = toks[i + j]; return x === w || x === w + 's' || x === w + 'es' || (w.endsWith('y') && x === w.slice(0, -1) + 'ies'); });
      if (!ok) continue;
      for (let j = 0; j < kt.length; j++) used[i + j] = true;
      // quantity: nearest number within 3 words before, skipping words like "pieces of"
      let qty = 1, size = 1;
      for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
        const x = toks[j];
        if (/^\d+(\.\d+)?$/.test(x)) { qty = parseFloat(x); used[j] = true; break; }
        if (NUMWORDS[x] && x !== 'a') { qty = NUMWORDS[x]; used[j] = true; break; }
        if (x === 'large' || x === 'big' || x === 'double') size = 1.4;
        if (x === 'small' || x === 'mini' || x === 'little') size = 0.7;
        if (!QTY_SKIP.has(x)) break;
      }
      hits.push({ i, name: kt.join(' '), f, qty, cal: Math.round(f[1] * qty * size) });
    }
  }
  const unknown = toks.filter((w, i) => !used[i] && !FILLER.has(w) && !/^\d/.test(w) && !NUMWORDS[w] && w.length > 2);
  return { hits: hits.sort((a, b) => a.i - b.i), unknown };
}
function localFoodEstimate(text) {
  const parts = splitFoods(text);
  const items = []; let total = 0, menuHits = 0, ctx = chainIn(ffNorm(text));
  const unknown = [];
  for (const part of parts) {
    const ff = ffMatchPart(part, ctx);
    if (ff) { ctx = ff.chain; menuHits++; items.push({ name: `${ff.chain.name} ${ff.name}`, short: ff.name.replace(/ \(.*\)$/, ''), chain: ff.chain.name, portion: '', calories: ff.cal }); total += ff.cal; continue; }
    const { hits, unknown: u } = scanFoods(part);
    for (const h of hits) { items.push({ name: `${h.qty !== 1 ? h.qty + ' × ' : ''}${h.name}`, portion: h.name.includes(h.f[2]) || h.f[2].includes(h.name) ? '' : `per ${h.f[2]}`, calories: h.cal }); total += h.cal; }
    if (!hits.length) unknown.push(part); else unknown.push(...u.filter(w => !chainIn(` ${w} `)));
  }
  if (!items.length) return null;
  const menuAll = menuHits === parts.length && !(chainIn(ffNorm(text)) && !menuHits);
  const missed = [...new Set(unknown)].slice(0, 4);
  return {
    items, total_calories: total, confidence: menuAll ? 'menu' : 'quick', menuAll, missed,
    title: menuAll ? (new Set(items.map(i => i.chain)).size === 1 ? `${items[0].chain}: ${items.map(i => i.short).join(', ')}` : items.map(i => i.name).join(', ')) : null,
    note: menuAll ? 'Matched the built-in menu (≈ published values).'
      : `Quick estimate from Leanline’s food list.${missed.length ? ` Didn’t recognize “${missed.join(', ')}”, so it isn’t counted. Type a total above if that’s off.` : ''}${aiReady() ? '' : ' For photos and restaurant meals, turn on AI in Me → AI estimates.'}`,
  };
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

/* ═════════════ coach line + daily inspiration ═════════════ */
/** Short contextual nudge for today, or '' when there's nothing timely to say. */
function coachLine() {
  const st = streak(isLogged), t = totals(todayKey()), tgt = targetFor(), lost = round(S.profile.startWeight - latestWeight(), 1);
  const hr = new Date().getHours();
  if (st >= 2 && !isLogged(todayKey())) return `🔥 Your <b>${st}-day streak</b> is on the line. Log something today to keep it.`;
  if (t.meals && t.net > tgt) return `<b>${fmt(t.net - tgt)} cal over.</b> About ${Math.round((t.net - tgt) / 4.5)} minutes of walking would cover it.`;
  if (t.meals && hr >= 18 && t.net <= tgt) return `Nice work. <b>${fmt(tgt - t.net)} cal</b> to spare tonight.`;
  if (lost >= 1 && hr < 11) return `You’re <b>${lost} lbs down</b> since you started. Keep stacking days.`;
  return '';
}
const dayNum = (k = todayKey()) => daysBetween('2026-01-01', k);
const pick = (list, n) => list[((n % list.length) + list.length) % list.length];
/** Which inspiration shows today: the user's choice, or alternate verse/quote by day. */
function inspoKind(k = todayKey()) {
  const pref = S.settings.inspo || 'both';
  if (pref === 'verse' || pref === 'quote') return S.settings.inspoToday?.k === k ? S.settings.inspoToday.kind : pref;
  return S.settings.inspoToday?.k === k ? S.settings.inspoToday.kind : (dayNum(k) % 2 === 0 ? 'verse' : 'quote');
}
function inspoCard() {
  const k = todayKey(), kind = inspoKind(k), n = dayNum(k);
  const v = pick(VERSES, Math.floor(n / 2) * 7 + (n % 2)), q = pick(QUOTES, Math.floor(n / 2) * 5 + (n % 2));
  const body = kind === 'verse'
    ? `<blockquote class="inspo-text">${esc(v.t)}</blockquote><div class="inspo-ref">${esc(v.ref)} <span>NABRE</span></div>`
    : `<blockquote class="inspo-text">${esc(q.t)}</blockquote><div class="inspo-ref">${q.by ? esc(q.by) : 'Leanline'}</div>`;
  return `<div class="card inspo ${kind}">
    <div class="row between inspo-head"><span class="eyebrow">${kind === 'verse' ? '✝️ Verse of the day' : '💬 Quote of the day'}</span>
      <div class="mini-seg"><button data-inspo="verse" class="${kind === 'verse' ? 'on' : ''}" aria-label="Show verse">Verse</button><button data-inspo="quote" class="${kind === 'quote' ? 'on' : ''}" aria-label="Show quote">Quote</button></div></div>
    ${body}
    <button class="inspo-share" id="inspo-share" aria-label="Share">Share ↗</button>
  </div>`;
}
function inspoText() {
  const k = todayKey(), n = dayNum(k), kind = inspoKind(k);
  if (kind === 'verse') { const v = pick(VERSES, Math.floor(n / 2) * 7 + (n % 2)); return `“${v.t}” (${v.ref}, NABRE)`; }
  const q = pick(QUOTES, Math.floor(n / 2) * 5 + (n % 2)); return `“${q.t}”${q.by ? ` (${q.by})` : ''}`;
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
  const st = streak(isLogged), ri = rankIndex(st), rankUp = ri >= 0 && ri > S.records.lastRank;
  S.records.lastRank = ri; S.records.highestRank = Math.max(S.records.highestRank, ri);
  applyRankTheme();
  const lost = lostLbs(), celebrations = [];
  for (let m = 5; m <= lost; m += 5) if (!S.milestones.includes(m)) { S.milestones.push(m); celebrations.push(m); }
  save();
  const queue = [
    ...(rankUp ? [{ html: rankBadge(ri, 88), t: `Ranked up: ${RANKS[ri].name}`, d: ri < RANKS.length - 1 ? `${st}-day streak. Keep it going ${RANKS[ri + 1].min - st} more day${RANKS[ri + 1].min - st === 1 ? '' : 's'} for ${RANKS[ri + 1].name}.` : 'The highest rank there is. Legendary.', colors: RANKS[ri].tier.confetti }] : []),
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
  confetti(item.colors);
  const el = document.createElement('div'); el.className = 'celebrate';
  el.innerHTML = `<div class="box"><div class="e">${item.html || item.e}</div><h2>${esc(item.t)}</h2><p>${esc(item.d)}</p><button class="btn">Let’s go!</button></div>`;
  document.body.appendChild(el);
  $('button', el).onclick = () => { el.remove(); celebrate(queue); };
}
function confetti(palette) {
  const c = $('#confetti'), ctx = c.getContext('2d'), dpr = devicePixelRatio || 1;
  c.width = innerWidth * dpr; c.height = innerHeight * dpr; ctx.scale(dpr, dpr);
  const colors = palette || ['#4ade80', '#60a5fa', '#fbbf24', '#f87171', '#a78bfa', '#fb923c', '#f472b6'];
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
/* ═════════════ screens ═════════════ */
function render() {
  const app = $('#app');
  if (!S.profile) { $('#tabbar').classList.add('hidden'); app.innerHTML = onboardingHTML(); bindOnboarding(); return; }
  $('#tabbar').classList.remove('hidden');
  if (tab === 'badges') { tab = 'ranks'; ranksView = 'badges'; }
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  app.innerHTML = { today: todayHTML, journey: journeyHTML, ranks: ranksHTML, me: meHTML }[tab]();
  ({ today: bindToday, ranks: bindRanks, me: bindMe }[tab])?.();
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
const MEALS = [['breakfast', '🌅', 'Breakfast'], ['lunch', '☀️', 'Lunch'], ['dinner', '🌙', 'Dinner'], ['snack', '🍿', 'Snacks']];
function mealOf(e) {
  if (e.meal) return e.meal;
  const h = e.time ? new Date(e.time).getHours() + new Date(e.time).getMinutes() / 60 : 12;
  return h < 10.5 ? 'breakfast' : h < 15 ? 'lunch' : h < 21 ? 'dinner' : 'snack';
}
function greeting() { const h = new Date().getHours(); return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
function todayHTML() {
  const k = viewDay, d = peekDay(k), t = totals(k), tgt = targetFor(k), sc = scoreFor(k), isToday = k === todayKey();
  const left = tgt - t.net, st = streak(isLogged), ri = rankIndex(st), pct = clamp(t.net / tgt, 0, 1), over = t.net > tgt;
  const coach = isToday ? coachLine() : '';
  const entry = (e, type) => `<div class="entry">
      ${e.photo ? `<img class="thumb" src="${e.photo}" alt="">` : `<div class="thumb">${type === 'food' ? (e.ff ? '🍔' : '🍽️') : (e.emoji || '🏃')}</div>`}
      <div class="meta"><div class="name">${esc(e.name)}</div><div class="note">${esc(e.note || (e.time ? new Date(e.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''))}</div></div>
      <div class="cal ${type === 'food' ? '' : 'burn'}">${type === 'food' ? '' : '−'}${fmt(e.cal)}</div>
      <button class="del" data-del="${type}:${e.id}" aria-label="Delete">✕</button></div>`;
  const groups = MEALS.map(([id, em, label]) => ({ id, em, label, items: d.food.filter(e => mealOf(e) === id) })).filter(g => g.items.length);
  const bar = (v, max, c) => `<div class="mini-bar"><i style="width:${v / max * 100}%;background:${c}"></i></div>`;
  const C = 2 * Math.PI * 26;
  return `
  <section class="band">
    <div class="band-top">
      <div class="datenav"><button id="prev" aria-label="Previous day">‹</button><span>${isToday ? niceDate(k, { weekday: 'long', month: 'short', day: 'numeric' }) : relDate(k)}</span><button id="next" aria-label="Next day" ${isToday ? 'disabled' : ''}>›</button></div>
      <button class="rank-chip" id="rank-pill" aria-label="Streak rank">${rankBadge(ri, 22)}<span>${ri >= 0 ? RANKS[ri].name : 'Unranked'}</span><b>🔥 ${st}</b></button>
    </div>
    <div class="band-main">
      <div>
        <div class="band-label">${isToday ? greeting() : 'Calories'}</div>
        <div class="band-num num">${fmt(Math.abs(left))}</div>
        <div class="band-sub">${left >= 0 ? 'calories left' : 'calories over'} · target ${fmt(tgt)}</div>
      </div>
      <div class="score-dial" aria-label="Day score ${sc.total}">
        <svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="26" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="5"/>
          <circle cx="30" cy="30" r="26" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - sc.total / 100)}" transform="rotate(-90 30 30)"/></svg>
        <div><b class="num">${sc.total}</b><span>${scoreGrade(sc.total)}</span></div>
      </div>
    </div>
    <div class="fuel ${over ? 'over' : ''}"><i style="width:${pct * 100}%"></i></div>
    <div class="band-stats">
      <div><span>Eaten</span><b class="num">${fmt(t.eaten)}</b></div>
      <div><span>Burned</span><b class="num">${fmt(t.burned)}</b></div>
      <button id="hero-weight"><span>Weight</span><b class="num">${d.weight || latestWeight(k)}</b></button>
    </div>
  </section>
  <nav class="dock" aria-label="Quick log">
    <button data-q="food"><span class="ic">🍽️</span>Food</button>
    <button data-q="ff"><span class="ic">🍔</span>Fast food</button>
    <button data-q="workout"><span class="ic">💪</span>Workout</button>
    <button data-q="weight"><span class="ic">⚖️</span>Weigh-in</button>
  </nav>
  ${coach ? `<p class="coach">${coach}</p>` : ''}
  <section class="card score-card">
    <div class="eyebrow">Day score</div>
    <div class="score-parts">
      <div><span>Calories</span>${bar(sc.cal, 60, 'rgb(var(--acc))')}<b class="num">${sc.cal}/60</b></div>
      <div><span>Logging</span>${bar(sc.log, 20, 'var(--blue)')}<b class="num">${sc.log}/20</b></div>
      <div><span>Exercise</span>${bar(sc.ex, 20, 'var(--orange)')}<b class="num">${sc.ex}/20</b></div>
    </div>
  </section>
  ${isToday ? inspoCard() : ''}
  <div class="sec-h"><h2>Meals</h2><span class="sub num">${fmt(t.eaten)} cal</span></div>
  ${groups.length ? groups.map(g => `<section class="card list-card"><div class="row between group-h"><span>${g.em} ${g.label}</span><span class="num">${fmt(g.items.reduce((a, e) => a + e.cal, 0))} cal</span></div>${g.items.map(e => entry(e, 'food')).join('')}</section>`).join('')
    : `<button class="card empty-card" data-q="food"><span class="e">🍽️</span><b>Log your first meal</b><small>Snap a photo, type it, or pick fast food</small></button>`}
  <div class="sec-h"><h2>Workouts</h2><button class="link" id="wh-link">History & PRs</button></div>
  ${d.exercise.length ? `<section class="card list-card">${d.exercise.map(e => entry(e, 'exercise')).join('')}</section>`
    : `<button class="card empty-card" data-q="workout"><span class="e">💪</span><b>No workout yet</b><small>Cardio, lifting, sports. It all counts.</small></button>`}`;
}
function bindToday() {
  $('#prev').onclick = () => { viewDay = addDays(viewDay, -1); render(); };
  $('#next').onclick = () => { if (viewDay < todayKey()) { viewDay = addDays(viewDay, 1); render(); } };
  $('#wh-link').onclick = workoutHistorySheet;
  $('#hero-weight').onclick = weightSheet;
  $('#rank-pill').onclick = () => { tab = 'ranks'; ranksView = 'rank'; render(); scrollTo(0, 0); };
  $$('[data-q]').forEach(b => b.onclick = () => { haptic(); ({ food: () => foodSheet(), ff: () => { ffOrder = []; fastFoodSheet(); }, workout: () => exerciseSheet(), weight: weightSheet })[b.dataset.q](); });
  $$('[data-inspo]').forEach(b => b.onclick = () => { S.settings.inspoToday = { k: todayKey(), kind: b.dataset.inspo }; save(); haptic(); render(); });
  const share = $('#inspo-share');
  if (share) share.onclick = async () => {
    const text = inspoText();
    try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); toast('Copied'); } } catch { }
  };
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
function foodSheet(opts = {}) {
  const recents = recentFoods();
  openSheet(`<h2>🍽️ Log food</h2>
    ${recents.length ? `<div class="sub" style="margin:0 0 8px 4px">Tap to re-add</div><div class="chips">${recents.map((f, i) => `<button class="chip" data-recent="${i}">${esc(f.name.length > 34 ? f.name.slice(0, 32) + '…' : f.name)} <small>${fmt(f.cal)}</small></button>`).join('')}</div>` : ''}
    <div class="grid2" style="margin-bottom:12px">
      <label class="tile-btn" id="photo-drop"><input type="file" accept="image/*" id="photo-in" hidden><span class="e">📷</span><span>Photo</span></label>
      <button class="tile-btn" id="ff-open" type="button"><span class="e">🍔</span><span>Fast food</span></button>
    </div>
    <div id="photo-preview"></div>
    <div class="field"><label>What did you eat?</label><textarea class="input" id="food-txt" placeholder="e.g. 2 eggs and toast, or Big Mac and large fries"></textarea></div>
    <div class="field"><label>Calories (leave blank and we’ll estimate)</label><input class="input" id="food-cal" inputmode="numeric" placeholder="optional"></div>
    <div id="est"></div>
    <button class="btn" id="food-go">Add</button>
    ${aiReady() ? '' : '<p class="sub" style="text-align:center">Photo estimates need AI. Set it up in Me → AI estimates.</p>'}`, sh => {
    let photo = null, estimate = null;
    $$('[data-recent]', sh).forEach(b => b.onclick = () => { const f = recents[+b.dataset.recent]; addEntry('food', { name: f.name, cal: f.cal, note: 'Re-added', photo: f.photo || null, ff: f.ff || null }); });
    $('#ff-open', sh).onclick = () => { ffOrder = []; fastFoodSheet(); };
    const takePhoto = async file => {
      if (!file) return;
      try {
        photo = await readPhoto(file); estimate = null;
        $('#photo-preview', sh).innerHTML = `<div class="photo-drop"><img src="${photo.ai}" alt=""><button class="x" id="photo-x" type="button">✕</button></div>`;
        $('#photo-x', sh).onclick = ev => { ev.preventDefault(); photo = null; estimate = null; $('#photo-preview', sh).innerHTML = ''; };
      } catch (err) { toast(err.message); }
    };
    $('#photo-in', sh).onchange = e => takePhoto(e.target.files[0]);
    if (opts.file) takePhoto(opts.file);
    $('#food-txt', sh).oninput = () => { estimate = null; $('#est', sh).innerHTML = ''; setBtn('Add'); };
    const btn = $('#food-go', sh), setBtn = (h, busy) => { btn.innerHTML = h; btn.disabled = !!busy; };
    btn.onclick = async () => {
      const text = $('#food-txt', sh).value.trim(), cal = Number($('#food-cal', sh).value);
      if (cal > 0) return addEntry('food', { name: text || 'Food', cal: Math.round(cal), photo: photo?.thumb || null });
      if (estimate) return addEntry('food', { name: estimate.title || text || 'Meal', cal: estimate.total_calories, note: estimate.confidence === 'menu' ? '🍔 Menu values' : estimate.confidence === 'quick' ? 'Quick estimate' : `AI estimate · ${estimate.confidence || 'medium'} confidence`, photo: photo?.thumb || null });
      if (!text && !photo) return toast('Type what you ate or add a photo');
      const local = text ? localFoodEstimate(text) : null;
      if (local?.menuAll && !photo) estimate = local; // every item is on a built-in menu: instant + offline
      else if (aiReady()) {
        setBtn('<span class="spinner"></span> Estimating…', true);
        try { estimate = await aiEstimate({ kind: 'food', text, image: photo?.ai || null }); }
        catch (err) { toast(err.message); estimate = local; }
      } else if (photo && !text) { toast('Add a description too. AI isn’t set up yet.'); return; }
      else estimate = local;
      if (!estimate) { setBtn('Add'); $('#est', sh).innerHTML = `<div class="estimate"><b>Not sure about that one.</b><div class="sub">Type the calories above${aiReady() ? '' : ', or turn on AI in Me → AI estimates so it can figure out anything you type or photograph'}.</div></div>`; $('#food-cal', sh).focus(); return; }
      $('#est', sh).innerHTML = `<div class="estimate"><div class="row between"><span class="sub">Estimated</span><span class="tot">${fmt(estimate.total_calories)} cal</span></div>
        <ul>${(estimate.items || []).map(i => `<li>${esc(i.name)}${i.portion ? ` (${esc(i.portion)})` : ''}: ${fmt(i.calories)}</li>`).join('')}</ul>
        ${estimate.note ? `<div class="sub">${esc(estimate.note)}</div>` : ''}</div>`;
      $('#food-cal', sh).placeholder = `${estimate.total_calories} (estimated; type to override)`;
      setBtn(`Add ${fmt(estimate.total_calories)} cal`);
    };
  });
}

/* ═════════════ fast food order builder ═════════════ */
let ffOrder = [];
const FF_CATS = [['main', 'Mains'], ['breakfast', 'Breakfast'], ['side', 'Sides'], ['drink', 'Drinks'], ['dessert', 'Desserts'], ['build', 'Build your own']];
const ffTotal = () => ffOrder.reduce((a, l) => a + l.cal, 0);
const chainLogo = (c, size = 44) => `<span class="ff-logo" style="width:${size}px;height:${size}px;background:${c.bg};color:${c.fg};font-size:${Math.round(size * 0.5)}px">${c.e}</span>`;
function fastFoodSheet(view = { chain: null, q: '' }) {
  const chain = view.chain && FF_CHAINS.find(c => c.id === view.chain);
  openSheet(`<div class="row" style="gap:8px;margin-bottom:12px">
      <button class="icon-btn" id="ff-back" aria-label="Back">‹</button>
      ${chain ? `${chainLogo(chain, 34)}<h2 style="margin:0">${esc(chain.name)}</h2>` : '<h2 style="margin:0">🍔 Fast food</h2>'}</div>
    ${chain ? '' : `<input class="input" id="ff-q" type="search" placeholder="Search restaurants or items" value="${esc(view.q)}" autocomplete="off" style="margin-bottom:12px">`}
    <div id="ff-body"></div>
    <div class="field" style="margin-top:14px"><label>Not on the menu? Type it</label>
      <div class="row"><input class="input" id="ff-custom" placeholder="${chain ? `e.g. ${esc(chain.name)} seasonal special` : 'e.g. Arby’s beef n cheddar'}"><button class="btn secondary" id="ff-custom-go" style="width:auto;padding:0 16px">Add</button></div></div>
    <div id="ff-tray"></div>`, sh => {
    const body = $('#ff-body', sh);
    let open = null; // "chainId:itemIdx" currently expanded
    const itemRow = (c, idx, showChain) => {
      const it = c.items[idx], key = `${c.id}:${idx}`;
      const cal = it.s ? (it.s.length > 1 ? `${fmt(it.s[0][1])}–${fmt(it.s[it.s.length - 1][1])}` : fmt(it.s[0][1])) : fmt(it.c);
      return `<div class="ff-item ${open === key ? 'open' : ''}" data-key="${key}">
        <button class="ff-row" data-toggle="${key}">${showChain ? chainLogo(c, 30) : ''}<span class="ff-n">${esc(it.n)}${showChain ? `<small>${esc(c.name)}</small>` : ''}</span><span class="ff-c">${cal}</span><span class="ff-plus">${open === key ? '−' : '+'}</span></button>
        ${open === key ? ffConfigHTML(it) : ''}</div>`;
    };
    const draw = () => {
      if (chain) {
        body.innerHTML = FF_CATS.map(([k, label]) => {
          const idxs = chain.items.map((it, i) => it.k === k ? i : -1).filter(i => i >= 0);
          return idxs.length ? `<div class="ff-cat">${label}</div>${idxs.map(i => itemRow(chain, i)).join('')}` : '';
        }).join('');
      } else {
        const q = ffNorm(view.q).trim();
        const recent = S.ffRecent.slice(0, 6);
        const chains = FF_CHAINS.filter(c => !q || ffNorm(c.name + ' ' + c.a.join(' ')).includes(q));
        const items = q.length >= 2 ? FF_CHAINS.flatMap(c => c.items.map((it, i) => ({ c, i, it }))).filter(x => ffNorm(x.it.n + ' ' + x.it.a.join(' ')).includes(q)).slice(0, 25) : [];
        body.innerHTML = `${!q && recent.length ? `<div class="ff-cat">Recent orders · tap to log</div><div class="chips">${recent.map((o, i) => `<button class="chip" data-reorder="${i}">${esc(o.name.length > 38 ? o.name.slice(0, 36) + '…' : o.name)} <small>${fmt(o.cal)}</small></button>`).join('')}</div>` : ''}
          ${chains.length ? `<div class="ff-grid">${chains.map(c => `<button class="ff-chain" data-chain="${c.id}">${chainLogo(c)}<span>${esc(c.name)}</span></button>`).join('')}</div>` : ''}
          ${items.length ? `<div class="ff-cat">Menu items</div>${items.map(x => itemRow(x.c, x.i, true)).join('')}` : ''}
          ${q && !chains.length && !items.length ? '<div class="empty">No match. Type it below and we’ll estimate it.</div>' : ''}`;
      }
      bindBody();
    };
    const bindBody = () => {
      $$('[data-chain]', body).forEach(b => b.onclick = () => { haptic(); fastFoodSheet({ chain: b.dataset.chain, q: '' }); });
      $$('[data-reorder]', body).forEach(b => b.onclick = () => {
        const o = S.ffRecent[+b.dataset.reorder];
        logFF(o.name, o.cal, o.lines);
      });
      $$('[data-toggle]', body).forEach(b => b.onclick = () => { open = open === b.dataset.toggle ? null : b.dataset.toggle; haptic(); draw(); });
      const el = open && $(`.ff-item[data-key="${open}"]`, body);
      if (!el) return;
      const [cid, idx] = open.split(':'), c = FF_CHAINS.find(x => x.id === cid), it = c.items[+idx];
      const st = { size: ffDefaultSize(it), qty: 1, tweaks: [] };
      const upd = () => {
        $('[data-addline]', el).textContent = `Add to order · ${fmt(ffLineCal(it, st.size, st.qty, st.tweaks))} cal`;
        $('[data-qty]', el).textContent = st.qty;
      };
      $$('[data-size]', el).forEach(b => b.onclick = () => { st.size = +b.dataset.size; $$('[data-size]', el).forEach(x => x.classList.toggle('on', x === b)); upd(); });
      $$('[data-tw]', el).forEach(b => b.onclick = () => {
        const k = b.dataset.tw; st.tweaks = st.tweaks.includes(k) ? st.tweaks.filter(x => x !== k) : [...st.tweaks, k];
        b.classList.toggle('on', st.tweaks.includes(k)); haptic(); upd();
      });
      $('[data-dec]', el).onclick = () => { st.qty = Math.max(1, st.qty - 1); upd(); };
      $('[data-inc]', el).onclick = () => { st.qty = Math.min(20, st.qty + 1); upd(); };
      $('[data-addline]', el).onclick = () => {
        ffOrder.push({ chain: c.name, name: ffLineName(it, st.size, st.qty, st.tweaks), cal: ffLineCal(it, st.size, st.qty, st.tweaks) });
        open = null; haptic(); draw(); drawTray(); toast(`Added · order ${fmt(ffTotal())} cal`);
      };
      upd();
    };
    const drawTray = () => {
      const tray = $('#ff-tray', sh);
      if (!ffOrder.length) { tray.innerHTML = ''; return; }
      tray.innerHTML = `<div class="ff-tray"><div class="row between" style="margin-bottom:6px"><b>Your order</b><span class="sub">${ffOrder.length} item${ffOrder.length > 1 ? 's' : ''}</span></div>
        <div class="ff-lines">${ffOrder.map((l, i) => `<div class="ff-line"><span>${esc(l.name)}<small>${esc(l.chain)}</small></span><b>${fmt(l.cal)}</b><button data-rm="${i}" aria-label="Remove">✕</button></div>`).join('')}</div>
        <button class="btn" id="ff-log" style="margin-top:10px">Log order · ${fmt(ffTotal())} cal</button></div>`;
      $$('[data-rm]', tray).forEach(b => b.onclick = () => { ffOrder.splice(+b.dataset.rm, 1); drawTray(); });
      $('#ff-log', tray).onclick = () => {
        const chains = [...new Set(ffOrder.map(l => l.chain))];
        const name = (chains.length === 1 ? `${chains[0]}: ` : '') + ffOrder.map(l => l.name.replace(/ \(.*\)$/, '')).join(', ');
        logFF(name, ffTotal(), ffOrder);
      };
    };
    $('#ff-back', sh).onclick = () => chain ? fastFoodSheet({ chain: null, q: '' }) : foodSheet();
    const q = $('#ff-q', sh);
    if (q) q.oninput = () => { view.q = q.value; open = null; draw(); };
    $('#ff-custom-go', sh).onclick = async () => {
      const inp = $('#ff-custom', sh), text = inp.value.trim(); if (!text) return toast('Type the item first');
      const full = chain && !chainIn(ffNorm(text)) ? `${chain.name} ${text}` : text;
      const btn = $('#ff-custom-go', sh); let est = localFoodEstimate(full);
      if (!est?.menuAll && aiReady()) {
        btn.innerHTML = '<span class="spinner"></span>'; btn.disabled = true;
        try { est = await aiEstimate({ kind: 'food', text: `${full} (fast food, standard menu portion)` }); } catch (e) { toast(e.message); }
        btn.textContent = 'Add'; btn.disabled = false;
      }
      if (!est) return toast('Couldn’t estimate that. Log it from the Food screen with calories.');
      ffOrder.push({ chain: chain ? chain.name : 'Other', name: est.menuAll ? est.items.map(i => i.name).join(', ') : (est.title || text), cal: est.total_calories });
      inp.value = ''; drawTray(); toast(`Added · ≈ ${fmt(est.total_calories)} cal`);
    };
    draw(); drawTray();
  });
}
function ffConfigHTML(it) {
  const def = ffDefaultSize(it);
  return `<div class="ff-config">
    ${it.s ? `<div class="seg" style="margin-bottom:10px">${it.s.map((s, i) => `<button type="button" data-size="${i}" class="${i === def ? 'on' : ''}">${esc(s[0])}<small>${fmt(s[1])}</small></button>`).join('')}</div>` : ''}
    ${it.t.length ? `<div class="chips" style="margin-bottom:10px">${it.t.map(k => `<button type="button" class="chip tw" data-tw="${k}">${esc(FF_TWEAKS[k].l)} <small>${'set' in FF_TWEAKS[k] ? '→ ' + FF_TWEAKS[k].set : (FF_TWEAKS[k].d > 0 ? '+' : '') + FF_TWEAKS[k].d}</small></button>`).join('')}</div>` : ''}
    <div class="row"><div class="qty"><button type="button" data-dec>−</button><span data-qty>1</span><button type="button" data-inc>+</button></div>
    <button type="button" class="btn" data-addline style="flex:1;min-height:48px;font-size:15px">Add to order</button></div></div>`;
}
function logFF(name, cal, lines) {
  S.ffRecent = [{ name, cal, lines }, ...S.ffRecent.filter(o => o.name !== name)].slice(0, 8);
  ffOrder = [];
  addEntry('food', { name, cal, note: `🍔 ${lines.length} item${lines.length > 1 ? 's' : ''} · ≈ menu values`, ff: lines });
}

/* ═════════════ workouts ═════════════ */
const CARDIO = [['Run', '🏃', [8, 9.8, 11.5]], ['Walk', '🚶', [3, 3.8, 5]], ['Bike', '🚴', [5.8, 7.5, 10]], ['Swim', '🏊', [6, 8, 10]], ['Row', '🚣', [4.8, 7, 8.5]],
  ['Elliptical', '〰️', [4.5, 5, 7]], ['Stairs', '🪜', [6, 8, 9]], ['HIIT', '⚡', [6, 8, 10]], ['Hike', '🥾', [5, 6, 7.5]], ['Jump rope', '🪢', [8.8, 11, 12]]];
const SPORTS = [['Basketball', '🏀', [4.5, 6.5, 8]], ['Soccer', '⚽', [5, 7, 10]], ['Football', '🏈', [5, 8, 9]], ['Tennis', '🎾', [5, 7, 8]], ['Pickleball', '🏓', [4, 5, 6]],
  ['Boxing', '🥊', [6, 7.8, 12]], ['Martial arts', '🥋', [5.3, 7.5, 10.3]], ['Volleyball', '🏐', [3, 4, 6]], ['Climbing', '🧗', [5.8, 7.5, 8]], ['Golf', '⛳', [3.5, 4.5, 4.8]]];
const LIFTS = ['Bench press', 'Squat', 'Deadlift', 'Overhead press', 'Barbell row', 'Pull-ups', 'Lat pulldown', 'Incline dumbbell press', 'Leg press', 'Romanian deadlift', 'Bicep curl', 'Tricep pushdown', 'Lunges', 'Hip thrust', 'Shoulder press'];
const INTENSITY = ['easy', 'moderate', 'hard'];
const W_TYPES = [['cardio', '🏃', 'Cardio'], ['strength', '🏋️', 'Strength'], ['sports', '🏀', 'Sports'], ['other', '✨', 'Other']];
const newWorkout = () => ({ type: 'cardio', activity: 'Run', sport: 'Basketball', desc: '', duration: '', distance: '', intensity: 'moderate', hr: '', exercises: [{ name: '', sets: '', reps: '', weight: '' }], calMode: 'est', cal: '' });
const actOf = w => w.type === 'cardio' ? CARDIO.find(a => a[0] === w.activity) : w.type === 'sports' ? SPORTS.find(a => a[0] === w.sport) : null;
const liftsOf = w => (w.exercises || []).filter(x => x.name && (Number(x.sets) || Number(x.reps)));
function wMinutes(w) {
  const m = Number(w.duration);
  if (m > 0) return m;
  if (w.type === 'strength') { const sets = liftsOf(w).reduce((a, x) => a + (Number(x.sets) || 1), 0); return sets ? sets * 2.5 : 0; }
  return 0;
}
/** Net calories burned (above resting): heart rate → distance → MET, in that order of accuracy. */
function estimateWorkout(w) {
  const p = S.profile, lbs = latestWeight(), kg = lbs * 0.453592, min = wMinutes(w) || 30, ii = INTENSITY.indexOf(w.intensity), hr = Number(w.hr);
  const restPerMin = bmr(lbs) / 1440;
  if (hr >= 70 && hr <= 220 && Number(w.duration) > 0) {
    const gross = p.sex === 'male' ? (-55.0969 + 0.6309 * hr + 0.1988 * kg + 0.2017 * p.age) / 4.184 : (-20.4022 + 0.4472 * hr - 0.1263 * kg + 0.074 * p.age) / 4.184;
    return { cal: Math.max(0, Math.round((gross - restPerMin) * min)), how: 'from heart rate' };
  }
  const mi = Number(w.distance);
  if (w.type === 'cardio' && mi > 0 && ['Run', 'Walk', 'Hike'].includes(w.activity)) {
    const per = { Run: 0.63, Walk: 0.3, Hike: 0.4 }[w.activity] * (w.activity === 'Hike' ? [0.9, 1, 1.25][ii] : 1);
    return { cal: Math.round(per * lbs * mi), how: 'from distance' };
  }
  const met = actOf(w)?.[2][ii] ?? (w.type === 'strength' ? [3.5, 5, 6][ii] : [3, 4.5, 6.5][ii]);
  return { cal: Math.max(0, Math.round((met - 1) * kg * (min / 60))), how: `${w.intensity} effort × ${Math.round(min)} min` };
}
function describeWorkout(w) {
  const min = wMinutes(w), mi = Number(w.distance), a = actOf(w);
  const cap = s => s[0].toUpperCase() + s.slice(1);
  let name, details = [], emoji = a?.[1] || (w.type === 'strength' ? '🏋️' : '✨');
  if (w.type === 'cardio') {
    name = [w.activity, mi ? `${round(mi, 2)} mi` : '', min ? `${Math.round(min)} min` : ''].filter(Boolean).join(' · ');
    if (mi && Number(w.duration) && ['Run', 'Walk', 'Hike'].includes(w.activity)) { const pace = Number(w.duration) / mi; details.push(`${Math.floor(pace)}:${pad(Math.round((pace % 1) * 60))}/mi`); }
  } else if (w.type === 'strength') {
    const L = liftsOf(w);
    name = L.length === 1 ? `${L[0].name} · ${Math.round(min)} min` : `Strength · ${L.length || ''} exercise${L.length === 1 ? '' : 's'} · ${Math.round(min)} min`.replace('·  exercises', '');
    details.push(L.map(x => `${x.name} ${x.sets || 1}×${x.reps || '?'}${Number(x.weight) ? ` @ ${x.weight}` : ''}`).join(', '));
  } else if (w.type === 'sports') name = [w.sport, min ? `${Math.round(min)} min` : ''].filter(Boolean).join(' · ');
  else name = [w.desc || 'Workout', min ? `${Math.round(min)} min` : ''].filter(Boolean).join(' · ');
  if (w.type !== 'strength' || w.intensity !== 'moderate') details.unshift(cap(w.intensity));
  if (Number(w.hr)) details.push(`${w.hr} bpm`);
  details.push(w.calMode === 'manual' ? '⌚ your number' : '≈ estimated');
  return { name, note: details.filter(Boolean).join(' · '), emoji };
}
function workoutEntry(w) {
  const est = estimateWorkout(w), cal = w.calMode === 'manual' ? Math.round(Number(w.cal)) : est.cal;
  const { name, note, emoji } = describeWorkout(w);
  return { name, note, emoji, cal, type: w.type, w: JSON.parse(JSON.stringify(w)) };
}
/* personal records */
function allWorkouts() {
  return Object.keys(S.days).sort().flatMap(k => S.days[k].exercise.map(e => ({ k, e })));
}
function personalRecords() {
  const pr = { run: null, longest: null, cal: null, pace: null, lifts: {} };
  for (const { k, e } of allWorkouts()) {
    const w = e.w;
    if (e.cal && (!pr.cal || e.cal > pr.cal.v)) pr.cal = { v: e.cal, k, n: e.name };
    if (!w) continue;
    const min = wMinutes(w), mi = Number(w.distance);
    if (min && (!pr.longest || min > pr.longest.v)) pr.longest = { v: min, k, n: e.name };
    if (w.type === 'cardio' && w.activity === 'Run' && mi) {
      if (!pr.run || mi > pr.run.v) pr.run = { v: mi, k };
      if (mi >= 1 && Number(w.duration)) { const pace = Number(w.duration) / mi; if (!pr.pace || pace < pr.pace.v) pr.pace = { v: pace, k }; }
    }
    if (w.type === 'strength') for (const x of liftsOf(w)) {
      const wt = Number(x.weight), key = x.name.trim().toLowerCase();
      if (wt > 0 && (!pr.lifts[key] || wt > pr.lifts[key].v)) pr.lifts[key] = { v: wt, k, n: x.name.trim(), reps: x.reps };
    }
  }
  return pr;
}
function prDiff(before, after) {
  const out = [];
  if (after.run && (!before.run || after.run.v > before.run.v)) out.push(`Longest run ${round(after.run.v, 2)} mi`);
  if (after.pace && before.pace && after.pace.v < before.pace.v) out.push('Fastest mile pace');
  for (const [k, l] of Object.entries(after.lifts)) if (!before.lifts[k] || l.v > before.lifts[k].v) if (before.lifts[k]) out.push(`${l.n} ${l.v} lb`);
  if (after.cal && before.cal && after.cal.v > before.cal.v) out.push(`Most calories ${fmt(after.cal.v)}`);
  return out;
}
function logWorkout(entry) {
  const before = personalRecords();
  addEntry('exercise', entry);
  const prs = prDiff(before, personalRecords());
  if (prs.length) setTimeout(() => { toast(`🏅 New PR: ${prs[0]}`); confetti(['#fbbf24', '#4ade80', '#60a5fa']); }, 900);
}

function exerciseSheet(w = newWorkout()) {
  const tpl = S.templates || [];
  const segBtns = (list, cur, attr) => list.map(([n, e]) => `<button type="button" class="chip pick ${cur === n ? 'on' : ''}" data-${attr}="${esc(n)}">${e} ${esc(n)}</button>`).join('');
  const typeFields = () => {
    if (w.type === 'cardio') return `<div class="chips">${segBtns(CARDIO, w.activity, 'act')}</div>
      <div class="grid2"><div class="field"><label>Duration (min)</label><input class="input" data-f="duration" inputmode="decimal" placeholder="30" value="${esc(w.duration)}"></div>
      <div class="field"><label>Distance (mi) · optional</label><input class="input" data-f="distance" inputmode="decimal" placeholder="3.1" value="${esc(w.distance)}"></div></div>`;
    if (w.type === 'strength') return `<datalist id="lifts">${LIFTS.map(l => `<option value="${l}">`).join('')}</datalist>
      <div class="lift-head"><span>Exercise</span><span>Sets</span><span>Reps</span><span>lb</span><span></span></div>
      ${w.exercises.map((x, i) => `<div class="lift-row">
        <input class="input" list="lifts" data-x="${i}:name" placeholder="Bench press" value="${esc(x.name)}">
        <input class="input" data-x="${i}:sets" inputmode="numeric" placeholder="3" value="${esc(x.sets)}">
        <input class="input" data-x="${i}:reps" inputmode="numeric" placeholder="10" value="${esc(x.reps)}">
        <input class="input" data-x="${i}:weight" inputmode="decimal" placeholder="135" value="${esc(x.weight)}">
        <button type="button" class="lift-rm" data-rmx="${i}" aria-label="Remove">✕</button></div>`).join('')}
      <button type="button" class="btn secondary" id="add-lift" style="min-height:44px;font-size:15px;margin-bottom:12px">+ Add exercise</button>
      <div class="field"><label>Total duration (min)</label><input class="input" data-f="duration" inputmode="decimal" placeholder="auto from sets" value="${esc(w.duration)}"></div>`;
    if (w.type === 'sports') return `<div class="chips">${segBtns(SPORTS, w.sport, 'sport')}</div>
      <div class="field"><label>Duration (min)</label><input class="input" data-f="duration" inputmode="decimal" placeholder="60" value="${esc(w.duration)}"></div>`;
    return `<div class="field"><label>What did you do?</label><input class="input" data-f="desc" placeholder="e.g. yard work, dance class" value="${esc(w.desc)}"></div>
      <div class="field"><label>Duration (min)</label><input class="input" data-f="duration" inputmode="decimal" placeholder="30" value="${esc(w.duration)}"></div>`;
  };
  openSheet(`<div class="row between"><h2>💪 Log workout</h2><button class="link" id="wh-open" type="button">History & PRs ›</button></div>
    ${tpl.length ? `<div class="row between" style="margin:0 4px 8px"><span class="sub">⭐ Favorites · tap to log</span><button class="link" id="tpl-edit" type="button">Edit</button></div>
      <div class="chips" id="tpl-chips">${tpl.map((t, i) => `<button class="chip" data-tpl="${i}">${esc(t.emoji || '⭐')} ${esc(t.name)}<span class="tpl-x hidden" data-tplx="${i}">✕</span></button>`).join('')}</div>` : ''}
    <div class="seg" style="margin-bottom:12px">${W_TYPES.map(([k, e, l]) => `<button type="button" data-type="${k}" class="${w.type === k ? 'on' : ''}">${e} ${l}</button>`).join('')}</div>
    ${typeFields()}
    <div class="field"><label>Intensity</label><div class="seg">${INTENSITY.map(i => `<button type="button" data-int="${i}" class="${w.intensity === i ? 'on' : ''}">${i[0].toUpperCase() + i.slice(1)}</button>`).join('')}</div></div>
    ${w.type !== 'strength' ? `<div class="field"><label>Avg heart rate (bpm) · optional</label><input class="input" data-f="hr" inputmode="numeric" placeholder="e.g. 145" value="${esc(w.hr)}"></div>` : ''}
    <div class="field"><label>Calories burned</label><div class="seg">
      <button type="button" data-cm="est" class="${w.calMode === 'est' ? 'on' : ''}">Estimate it for me</button><button type="button" data-cm="manual" class="${w.calMode === 'manual' ? 'on' : ''}">I know my calories</button></div></div>
    ${w.calMode === 'manual' ? `<div class="field"><input class="input" data-f="cal" inputmode="numeric" placeholder="Active calories from your watch or machine" value="${esc(w.cal)}"></div>` : '<div class="estimate" id="w-est"></div>'}
    <button type="button" class="chip fav" id="w-fav" style="width:100%;margin-bottom:12px">☆ Save as favorite</button>
    <button class="btn" id="w-go">Add workout</button>`, sh => {
    let fav = false;
    const refresh = () => {
      const est = estimateWorkout(w), box = $('#w-est', sh);
      if (box) box.innerHTML = `<div class="row between"><span class="sub">Estimated burn</span><span class="tot">${fmt(est.cal)} cal</span></div><div class="sub">${esc(est.how)} · at ${latestWeight()} lb</div>`;
      $('#w-go', sh).textContent = `Add workout · ${fmt(w.calMode === 'manual' ? Number(w.cal) || 0 : est.cal)} cal`;
    };
    $$('[data-f]', sh).forEach(i => i.oninput = () => { w[i.dataset.f] = i.value; refresh(); });
    $$('[data-x]', sh).forEach(i => i.oninput = () => { const [n, f] = i.dataset.x.split(':'); w.exercises[n][f] = i.value; refresh(); });
    $$('[data-rmx]', sh).forEach(b => b.onclick = () => { w.exercises.splice(+b.dataset.rmx, 1); if (!w.exercises.length) w.exercises.push({ name: '', sets: '', reps: '', weight: '' }); exerciseSheet(w); });
    const addLift = $('#add-lift', sh);
    if (addLift) addLift.onclick = () => { const last = w.exercises[w.exercises.length - 1]; w.exercises.push({ name: '', sets: last.sets, reps: last.reps, weight: '' }); exerciseSheet(w); setTimeout(() => $$('[data-x$=":name"]').pop()?.focus(), 300); };
    $$('[data-type]', sh).forEach(b => b.onclick = () => { w.type = b.dataset.type; haptic(); exerciseSheet(w); });
    $$('[data-act]', sh).forEach(b => b.onclick = () => { w.activity = b.dataset.act; haptic(); exerciseSheet(w); });
    $$('[data-sport]', sh).forEach(b => b.onclick = () => { w.sport = b.dataset.sport; haptic(); exerciseSheet(w); });
    $$('[data-int]', sh).forEach(b => b.onclick = () => { w.intensity = b.dataset.int; $$('[data-int]', sh).forEach(x => x.classList.toggle('on', x === b)); haptic(); refresh(); });
    $$('[data-cm]', sh).forEach(b => b.onclick = () => { w.calMode = b.dataset.cm; exerciseSheet(w); });
    $('#w-fav', sh).onclick = e => { fav = !fav; e.currentTarget.classList.toggle('on', fav); e.currentTarget.textContent = fav ? '★ Will save as favorite' : '☆ Save as favorite'; haptic(); };
    $('#wh-open', sh).onclick = workoutHistorySheet;
    let editing = false;
    const ed = $('#tpl-edit', sh);
    if (ed) ed.onclick = () => { editing = !editing; ed.textContent = editing ? 'Done' : 'Edit'; $$('.tpl-x', sh).forEach(x => x.classList.toggle('hidden', !editing)); };
    $$('[data-tpl]', sh).forEach(b => b.onclick = ev => {
      const i = +b.dataset.tpl;
      if (editing || ev.target.dataset.tplx !== undefined) { S.templates.splice(i, 1); save(); exerciseSheet(w); return; }
      logWorkout(workoutEntry(S.templates[i].w));
    });
    $('#w-go', sh).onclick = () => {
      if (w.type === 'strength' && !liftsOf(w).length && !Number(w.duration)) return toast('Add at least one exercise with sets/reps, or a duration');
      if (w.type === 'other' && !w.desc.trim() && !Number(w.duration)) return toast('Describe the workout or add a duration');
      if (w.calMode === 'manual' && !(Number(w.cal) >= 0 && w.cal !== '')) return toast('Enter your calories, or switch to Estimate');
      if (w.type === 'cardio' && !Number(w.duration) && !Number(w.distance) && w.calMode === 'est') return toast('Add a duration or distance');
      if (w.type === 'strength') w.exercises = liftsOf(w).length ? liftsOf(w) : w.exercises;
      const entry = workoutEntry(w);
      if (fav) { S.templates = [...S.templates, { name: entry.name, emoji: entry.emoji, w: entry.w }].slice(-12); }
      logWorkout(entry);
    };
    refresh();
  });
}
function workoutHistorySheet() {
  const pr = personalRecords(), list = allWorkouts().reverse(), month = todayKey().slice(0, 7);
  const thisMonth = list.filter(x => x.k.startsWith(month));
  const lifts = Object.values(pr.lifts).sort((a, b) => b.v - a.v).slice(0, 8);
  const tile = (label, v, sub) => `<div class="pr-tile"><div class="k">${label}</div><div class="v">${v}</div><div class="sub">${sub || ''}</div></div>`;
  const byDay = {}; list.slice(0, 40).forEach(x => (byDay[x.k] ||= []).push(x.e));
  openSheet(`<div class="row" style="gap:8px;margin-bottom:12px"><button class="icon-btn" id="wh-back" aria-label="Back">‹</button><h2 style="margin:0">📊 Workouts</h2></div>
    <div class="grid3" style="margin-bottom:12px">
      ${tile('This month', thisMonth.length, 'workouts')}
      ${tile('Minutes', fmt(thisMonth.reduce((a, x) => a + (x.e.w ? wMinutes(x.e.w) : 0), 0)), 'this month')}
      ${tile('Burned', fmt(thisMonth.reduce((a, x) => a + (x.e.cal || 0), 0)), 'cal this month')}</div>
    <div class="ff-cat">🏅 Personal records</div>
    <div class="grid2" style="margin-bottom:12px">
      ${tile('Longest run', pr.run ? `${round(pr.run.v, 2)} mi` : '—', pr.run ? niceDate(pr.run.k) : 'Log a run with distance')}
      ${tile('Fastest pace', pr.pace ? `${Math.floor(pr.pace.v)}:${pad(Math.round((pr.pace.v % 1) * 60))}/mi` : '—', pr.pace ? niceDate(pr.pace.k) : 'Runs of 1+ mi')}
      ${tile('Longest workout', pr.longest ? `${Math.round(pr.longest.v)} min` : '—', pr.longest ? niceDate(pr.longest.k) : '')}
      ${tile('Biggest burn', pr.cal ? `${fmt(pr.cal.v)} cal` : '—', pr.cal ? niceDate(pr.cal.k) : '')}</div>
    <div class="ff-cat">🏋️ Heaviest lifts</div>
    <div class="card" style="padding:4px 14px">${lifts.map(l => `<div class="ff-line"><span>${esc(l.n)}<small>${niceDate(l.k)}${l.reps ? ` · ${esc(l.reps)} reps` : ''}</small></span><b>${l.v} lb</b></div>`).join('') || '<div class="empty">Log a strength workout with weights</div>'}</div>
    <div class="ff-cat">Recent</div>
    <div class="card" style="padding:4px 14px">${Object.entries(byDay).map(([k, es]) => `<div class="wh-day">${relDate(k)}</div>${es.map(e => `<div class="ff-line"><span>${e.emoji || '🏃'} ${esc(e.name)}<small>${esc(e.note || '')}</small></span><b>${fmt(e.cal)}</b></div>`).join('')}`).join('') || '<div class="empty">No workouts yet</div>'}</div>`, sh => {
    $('#wh-back', sh).onclick = () => exerciseSheet();
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
  return `<h1 class="page-title">Journey</h1>
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

/* ── ranks (rank · best days · badges) ── */
let ranksView = 'rank';
function ranksHTML() {
  const views = [['rank', 'Rank'], ['days', 'Best days'], ['badges', 'Badges']];
  return `<h1 class="page-title">Ranks</h1>
  <div class="seg page-seg">${views.map(([k, l]) => `<button data-rv="${k}" class="${ranksView === k ? 'on' : ''}">${l}</button>`).join('')}</div>
  ${{ rank: rankViewHTML, days: daysViewHTML, badges: badgesHTML }[ranksView]()}`;
}
function bindRanks() { $$('[data-rv]').forEach(b => b.onclick = () => { ranksView = b.dataset.rv; haptic(); render(); }); }
function rankViewHTML() {
  const st = streak(isLogged), tst = streak(isOnTarget);
  const ri = rankIndex(st), cur = RANKS[ri], next = RANKS[ri + 1], hi = S.records.highestRank;
  const from = cur ? cur.min : 0, pct = next ? clamp((st - from) / (next.min - from), 0, 1) : 1;
  const grad = cur ? `linear-gradient(90deg,${cur.tier.c[1]},${cur.tier.c[0]})` : 'var(--line)';
  return `<section class="band rank-hero">
    <div class="rank-emblem">${rankBadge(ri, 104)}</div>
    <div class="eyebrow">Streak rank</div>
    <div class="rank-name">${cur ? cur.name : 'Unranked'}</div>
    <div class="sub">🔥 ${st}-day logging streak${hi >= 0 ? ` · best rank ${RANKS[hi].name}` : ''}</div>
    <div class="progressbar"><i style="width:${pct * 100}%;background:${grad}"></i></div>
    <div class="sub">${next ? (st ? `<b class="num" style="color:var(--text)">${next.min - st}</b> more day${next.min - st === 1 ? '' : 's'} to <b style="color:var(--text)">${next.name}</b>` : 'Log food today to reach <b style="color:var(--text)">Bronze I</b>') : 'Top rank reached 👑'}</div>
  </section>
  <div class="grid2" style="margin-bottom:12px">
    <section class="card stat-card"><div class="eyebrow">🔥 Logging streak</div><div class="big num">${st}</div><div class="sub">Best ${S.records.bestStreak} days</div></section>
    <section class="card stat-card"><div class="eyebrow">🎯 On target</div><div class="big num">${tst}</div><div class="sub">Best ${S.records.bestTargetStreak} days</div></section>
  </div>
  <section class="card"><div class="eyebrow" style="margin-bottom:10px">The ladder</div>
    <div class="ladder">${TIERS.map((t, ti) => `<div class="ladder-row"><span class="ladder-name">${t.n}</span>${[0, 1, 2].map(l => {
      const i = ti * 3 + l; return `<div class="ladder-step ${i <= hi ? 'got' : ''} ${i === ri ? 'now' : ''}">${rankBadge(i, 30)}<span>${RANK_MIN[i]}d</span></div>`;
    }).join('')}</div>`).join('')}</div></section>`;
}
function daysViewHTML() {
  const days = scoredDays().sort((a, b) => b.total - a.total || a.net - b.net);
  const medal = i => ['🥇', '🥈', '🥉'][i] || `${i + 1}`;
  const pod = (d, i, cls = '') => d ? `<div class="pod ${cls}"><div class="m">${medal(i)}</div><div class="sc num" style="color:${scoreColor(d.total)}">${d.total}</div><div class="dt">${relDate(d.k)}</div></div>` : '<div class="pod" style="opacity:.3"><div class="m">·</div><div class="sc">–</div><div class="dt">—</div></div>';
  return `${days.length ? `<div class="podium">${pod(days[1], 1)}${pod(days[0], 0, 'first')}${pod(days[2], 2)}</div>` : ''}
  <section class="card list-card">
    ${days.map((d, i) => `<div class="rank"><div class="pos">${medal(i)}</div>
      <div class="meta"><div class="d">${niceDate(d.k)}${d.k === todayKey() ? ' · Today' : ''}</div>
      <div class="s">🍽️ ${fmt(d.eaten)} · 🔥 ${fmt(d.burned)} · net ${fmt(d.net)}</div>
      <div class="scorebar"><i style="width:${d.total}%;background:${scoreColor(d.total)}"></i></div></div>
      <div class="score num" style="color:${scoreColor(d.total)}">${d.total}</div></div>`).join('') || '<div class="empty">Log your first day to get ranked</div>'}
  </section>
  <p class="sub" style="text-align:center">Score = calories on target (60) + logging meals & weigh-in (20) + exercise (20)</p>`;
}
function badgesHTML() {
  const got = BADGES.filter(b => S.badges[b.id]).length;
  return `<section class="card"><div class="row between"><span class="eyebrow">Collected</span><b class="num">${got} / ${BADGES.length}</b></div>
  <div class="progressbar"><i style="width:${got / BADGES.length * 100}%"></i></div></section>
  <div class="badges">${BADGES.map(b => `<div class="badge ${S.badges[b.id] ? '' : 'locked'}"><div class="e">${b.e}</div><div class="t">${esc(b.t)}</div>
    <div class="dsc">${S.badges[b.id] ? `✓ ${niceDate(S.badges[b.id], { month: 'short', day: 'numeric' })}` : esc(b.d)}</div></div>`).join('')}</div>`;
}

/* ── me / settings ── */
function meHTML() {
  const p = S.profile, used = (() => { try { return Math.round((localStorage.getItem(STORE_KEY) || '').length / 1024); } catch { return 0; } })();
  return `<h1 class="page-title">Me</h1>
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
  <div class="card"><h3>Daily inspiration</h3>
    <div class="seg" id="inspo-pref">${[['both', 'Both'], ['verse', 'Verses'], ['quote', 'Quotes']].map(([k, l]) => `<button data-ip="${k}" class="${(S.settings.inspo || 'both') === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <p class="sub" style="margin-bottom:0">“Both” alternates a Bible verse and a quote each day. Tap Verse/Quote on the card to switch for the day.</p>
  </div>
  <div class="card"><button class="btn danger" id="reset">Erase everything</button></div>
  <p class="sub" style="text-align:center">Leanline · estimates are guides, not medical advice</p>
  <p class="legal">${esc(NABRE_NOTICE)}</p>`;
}
function bindMe() {
  const root = $('#prof'); bindSegs(root);
  $('#prof-save').onclick = () => {
    const np = readProfileForm(root, S.profile); if (typeof np === 'string') return toast(np);
    if (np.startWeight !== S.profile.startWeight) day(S.profile.startDate).weight = np.startWeight;
    S.profile = np; save(); evaluate(); render(); toast(`Saved · new target ${fmt(targetFor())} cal`);
  };
  $$('[data-ip]').forEach(b => b.onclick = () => { S.settings.inspo = b.dataset.ip; delete S.settings.inspoToday; save(); render(); toast('Saved'); });
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
      S = hydrate(data); save(); applyRankTheme(); render(); toast('Backup restored');
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
