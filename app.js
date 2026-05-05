/* ═══════════════════════════════════════════════
   VFC — app.js  |  Change password on line 5
═══════════════════════════════════════════════ */
const ADMIN_PASSWORD = 'VFC2025';
const DB = 'https://vfc1-1ea94-default-rtdb.firebaseio.com';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const WC_LABELS = { sub165:'Sub 165','165to185':'165–185','185plus':'185+' };

function checkSession(k) { return sessionStorage.getItem(k) === '1'; }
function setSession(k)   { sessionStorage.setItem(k, '1'); }
function openModal(o)    { o.classList.add('open');    document.body.style.overflow='hidden'; }
function closeModal(o)   { o.classList.remove('open'); document.body.style.overflow=''; }

/* ── Firebase helpers ── */
async function fbGet(path) {
  try {
    const r = await fetch(`${DB}/${path}.json`);
    return await r.json();
  } catch { return null; }
}
async function fbSet(path, data) {
  try {
    await fetch(`${DB}/${path}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  } catch { console.error('write failed:', path); }
}

/* Firebase turns arrays into objects — this fixes that */
function toArr(val, len) {
  if (!val) return Array(len).fill(null).map(() => ({ name:'', rec:'' }));
  if (Array.isArray(val)) return val;
  return Object.values(val);
}

function normalizeRankings(data) {
  const WCS = ['sub165','165to185','185plus'];
  const out = {};
  WCS.forEach(wc => {
    const d = (data && data[wc]) ? data[wc] : {};
    out[wc] = {
      champ:      d.champ || { name:'', rec:'' },
      contenders: toArr(d.contenders, 3),
      chuds:      toArr(d.chuds, 3),
    };
  });
  return out;
}

function normalizeFighters(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return Object.values(data);
}

/* ═══════════════════════════════════════════════
   SUBMIT PAGE
═══════════════════════════════════════════════ */
async function initSubmitPage() {
  const form = $('fightForm'), successMsg = $('successMsg'), listEl = $('submissionsList');
  if (!form) return;

  listEl.innerHTML = '<div class="no-submissions">Loading...</div>';
  const subs = toArr(await fbGet('submissions'), 0).filter(Boolean);
  renderSubmissions(listEl, subs);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const f1    = $('fighter1').value.trim();
    const f2    = $('fighter2').value.trim();
    const wc    = $('weightClass').value;
    const sport = $('sport') ? $('sport').value : '';
    if (!f1 || !f2 || !wc || !sport) return;

    const current = toArr(await fbGet('submissions'), 0).filter(Boolean);
    current.unshift({ fighter1:f1, fighter2:f2, wc, wcLabel:WC_LABELS[wc]||wc, sport, date:new Date().toLocaleDateString() });
    await fbSet('submissions', current);

    form.reset();
    successMsg.style.display = 'block';
    setTimeout(() => { successMsg.style.display = 'none'; }, 3500);
    renderSubmissions(listEl, current);
  });
}

function renderSubmissions(container, list) {
  if (!container) return;
  if (!list || !list.length) { container.innerHTML = '<div class="no-submissions">No submissions yet</div>'; return; }
  container.innerHTML = list.map(s =>
    `<div class="submission-item">
       <span class="fighters">${esc(s.fighter1)} vs ${esc(s.fighter2)}</span>
       <span class="weight">${esc(s.wcLabel)} &bull; ${esc(s.sport||'')} &bull; ${esc(s.date)}</span>
     </div>`
  ).join('');
}

/* ═══════════════════════════════════════════════
   RANKINGS PAGE
═══════════════════════════════════════════════ */
const DEFAULT_RANKINGS = {
  sub165:     { champ:{name:'',rec:''}, contenders:[{name:'',rec:''},{name:'',rec:''},{name:'',rec:''}], chuds:[{name:'',rec:''},{name:'',rec:''},{name:'',rec:''}] },
  '165to185': { champ:{name:'',rec:''}, contenders:[{name:'',rec:''},{name:'',rec:''},{name:'',rec:''}], chuds:[{name:'',rec:''},{name:'',rec:''},{name:'',rec:''}] },
  '185plus':  { champ:{name:'',rec:''}, contenders:[{name:'',rec:''},{name:'',rec:''},{name:'',rec:''}], chuds:[{name:'',rec:''},{name:'',rec:''},{name:'',rec:''}] },
};

let rankingsEditing = false;
let pendingSlot     = null;
let rankingsDraft   = null;

async function initRankingsPage() {
  const pwInput = $('rankPwInput'), pwBtn = $('rankPwBtn'), pwStatus = $('rankPwStatus');
  if (!pwBtn) return;

  pwStatus.textContent = 'Loading...';
  rankingsDraft = normalizeRankings(await fbGet('rankings'));
  renderRankings(rankingsDraft);
  pwStatus.textContent = 'Locked';

  if (checkSession('rank_unlocked')) enableRankEdit(pwStatus, pwBtn);

  pwBtn.addEventListener('click', async () => {
    if (rankingsEditing) {
      pwStatus.textContent = 'Saving...';
      await fbSet('rankings', rankingsDraft);
      rankingsDraft = normalizeRankings(await fbGet('rankings'));
      renderRankings(rankingsDraft);
      disableRankEdit(pwStatus, pwBtn, pwInput);
    } else {
      if (pwInput.value === ADMIN_PASSWORD) {
        setSession('rank_unlocked');
        pwStatus.textContent = 'Loading...';
        rankingsDraft = normalizeRankings(await fbGet('rankings'));
        enableRankEdit(pwStatus, pwBtn);
        pwInput.value = '';
      } else {
        pwStatus.textContent = 'Wrong password';
        pwStatus.className = 'pw-status err';
        setTimeout(() => { pwStatus.textContent = 'Locked'; pwStatus.className = 'pw-status'; }, 2000);
      }
    }
  });

  pwInput.addEventListener('keydown', e => { if (e.key === 'Enter') pwBtn.click(); });

  const slotModal = $('slotModal');
  $('slotModalClose').addEventListener('click', () => closeModal(slotModal));
  slotModal.addEventListener('click', e => { if (e.target === slotModal) closeModal(slotModal); });

  $('slotSaveBtn').addEventListener('click', () => {
    if (!pendingSlot) return;
    const name = $('slotName').value.trim();
    const rec  = $('slotRecord').value.trim();
    const wc   = pendingSlot.wc;

    if (pendingSlot.type === 'champ')          rankingsDraft[wc].champ = { name, rec };
    else if (pendingSlot.type === 'contender') rankingsDraft[wc].contenders[pendingSlot.idx] = { name, rec };
    else                                       rankingsDraft[wc].chuds[pendingSlot.idx] = { name, rec };

    renderRankings(rankingsDraft);
    closeModal(slotModal);
    pendingSlot = null;
  });
}

function enableRankEdit(statusEl, btn) {
  rankingsEditing = true;
  statusEl.textContent = 'Editing — click slots to update';
  statusEl.className = 'pw-status ok';
  btn.textContent = 'SAVE & LOCK';
  btn.classList.add('active');
  document.body.classList.add('edit-mode');
  attachSlotClicks();
}

function disableRankEdit(statusEl, btn, inputEl) {
  rankingsEditing = false;
  statusEl.textContent = 'Saved & Locked';
  statusEl.className = 'pw-status ok';
  btn.textContent = 'UNLOCK';
  btn.classList.remove('active');
  if (inputEl) inputEl.value = '';
  document.body.classList.remove('edit-mode');
  sessionStorage.removeItem('rank_unlocked');
  setTimeout(() => { statusEl.textContent = 'Locked'; statusEl.className = 'pw-status'; }, 2000);
}

function attachSlotClicks() {
  const WCS = ['sub165','165to185','185plus'];
  WCS.forEach(wc => {
    const cn = $(`champ-${wc}-name`);
    if (cn) cn.onclick = () => openSlotModal('champ', wc, 0);
    for (let i = 1; i <= 3; i++) {
      const cs = $(`${wc}-c${i}`);
      if (cs) cs.querySelector('.rank-name').onclick = () => openSlotModal('contender', wc, i-1);
      const hs = $(`${wc}-h${i}`);
      if (hs) hs.querySelector('.rank-name').onclick = () => openSlotModal('chud', wc, i-1);
    }
  });
}

function openSlotModal(type, wc, idx) {
  const wcData = rankingsDraft[wc] || DEFAULT_RANKINGS[wc];
  let cur = { name:'', rec:'' };
  if (type === 'champ')          cur = wcData.champ;
  else if (type === 'contender') cur = wcData.contenders[idx] || cur;
  else                           cur = wcData.chuds[idx] || cur;

  $('slotModalTitle').textContent = type === 'champ'
    ? `EDIT CHAMPION — ${WC_LABELS[wc]}`
    : `EDIT ${type.toUpperCase()} #${idx+1} — ${WC_LABELS[wc]}`;
  $('slotName').value   = cur.name || '';
  $('slotRecord').value = cur.rec  || '';
  pendingSlot = { type, wc, idx };
  openModal($('slotModal'));
  $('slotName').focus();
}

function renderRankings(data) {
  ['sub165','165to185','185plus'].forEach(wc => {
    const wcData = data[wc] || DEFAULT_RANKINGS[wc];
    const nameEl = $(`champ-${wc}-name`), recEl = $(`champ-${wc}-rec`);
    if (nameEl) { nameEl.textContent = wcData.champ.name || 'VACANT'; nameEl.classList.toggle('champ-vacant', !wcData.champ.name); }
    if (recEl)  { recEl.textContent  = wcData.champ.rec  || ''; }

    toArr(wcData.contenders, 3).forEach((f, i) => {
      const slot = $(`${wc}-c${i+1}`); if (!slot) return;
      slot.querySelector('.rank-name').textContent = f.name || '—';
      const rEl = slot.querySelector('.rank-rec'); if (rEl) rEl.textContent = f.rec || '';
      slot.classList.toggle('rank-empty', !f.name);
      slot.classList.toggle('filled',     !!f.name);
      slot.classList.toggle('contender',  !!f.name);
    });

    toArr(wcData.chuds, 3).forEach((f, i) => {
      const slot = $(`${wc}-h${i+1}`); if (!slot) return;
      slot.querySelector('.rank-name').textContent = f.name || '—';
      const rEl = slot.querySelector('.rank-rec'); if (rEl) rEl.textContent = f.rec || '';
      slot.classList.toggle('rank-empty', !f.name);
      slot.classList.toggle('filled',     !!f.name);
      slot.classList.toggle('chud',       !!f.name);
    });
  });
  if (rankingsEditing) attachSlotClicks();
}

/* ═══════════════════════════════════════════════
   FIGHTER PROFILES — now stored in Firebase
═══════════════════════════════════════════════ */
let profilesEditing    = false;
let editingFighterId   = null;
let pendingPhotoBase64 = null;

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

async function initProfilesPage() {
  const pwInput = $('profPwInput'), pwBtn = $('profPwBtn'), pwStatus = $('profPwStatus');
  const addBtn  = $('addFighterBtn'), grid = $('fightersGrid');
  if (!pwBtn) return;

  grid.innerHTML = '<div class="no-fighters">Loading...</div>';
  const fighters = normalizeFighters(await fbGet('fighters'));
  renderFighters(grid, fighters);

  if (checkSession('prof_unlocked')) enableProfEdit(pwStatus, pwBtn, addBtn);

  pwBtn.addEventListener('click', async () => {
    if (profilesEditing) {
      disableProfEdit(pwStatus, pwBtn, pwInput, addBtn);
    } else {
      if (pwInput.value === ADMIN_PASSWORD) {
        setSession('prof_unlocked');
        enableProfEdit(pwStatus, pwBtn, addBtn);
        pwInput.value = '';
      } else {
        pwStatus.textContent = 'Wrong password';
        pwStatus.className = 'pw-status err';
        setTimeout(() => { pwStatus.textContent = 'Locked'; pwStatus.className = 'pw-status'; }, 2000);
      }
    }
  });
  pwInput.addEventListener('keydown', e => { if (e.key === 'Enter') pwBtn.click(); });
  addBtn.addEventListener('click', () => openEditModal(null));

  const bioModal = $('bioModal');
  $('bioModalClose').addEventListener('click', () => closeModal(bioModal));
  bioModal.addEventListener('click', e => { if (e.target === bioModal) closeModal(bioModal); });

  const editModal = $('editFighterModal');
  $('editModalClose').addEventListener('click', () => closeModal(editModal));
  editModal.addEventListener('click', e => { if (e.target === editModal) closeModal(editModal); });

  $('editPhotoFile').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      pendingPhotoBase64 = ev.target.result;
      $('editPhotoPreview').innerHTML = `<img src="${pendingPhotoBase64}" alt="preview" />`;
      $('editPhotoLabel').textContent = file.name;
    };
    reader.readAsDataURL(file);
  });

  $('editSaveBtn').addEventListener('click', saveFighter);
  $('editDeleteBtn').addEventListener('click', async () => {
    if (!editingFighterId || !confirm('Delete this fighter?')) return;
    const fighters = normalizeFighters(await fbGet('fighters')).filter(f => f.id !== editingFighterId);
    await fbSet('fighters', fighters);
    closeModal(editModal);
    renderFighters(grid, fighters);
  });
}

function enableProfEdit(statusEl, btn, addBtn) {
  profilesEditing = true;
  statusEl.textContent = 'Admin Mode'; statusEl.className = 'pw-status ok';
  btn.textContent = 'LOCK'; btn.classList.add('active');
  addBtn.classList.add('visible');
  document.body.classList.add('edit-mode-profiles');
}

function disableProfEdit(statusEl, btn, inputEl, addBtn) {
  profilesEditing = false;
  statusEl.textContent = 'Locked'; statusEl.className = 'pw-status';
  btn.textContent = 'UNLOCK'; btn.classList.remove('active');
  if (inputEl) inputEl.value = '';
  addBtn.classList.remove('visible');
  document.body.classList.remove('edit-mode-profiles');
  sessionStorage.removeItem('prof_unlocked');
}

function renderFighters(grid, fighters) {
  if (!grid) return;
  if (!fighters || !fighters.length) {
    grid.innerHTML = '<div class="no-fighters">No fighters on the roster yet</div>'; return;
  }
  grid.innerHTML = fighters.map(f => {
    const avatar = f.photo
      ? `<div class="fighter-avatar"><img src="${f.photo}" alt="${esc(f.name)}" /></div>`
      : `<div class="fighter-avatar">🥊</div>`;
    return `<div class="fighter-card" data-id="${f.id}">
      <div class="fighter-card-top">
        ${avatar}
        <div class="fighter-fn">${esc(f.name)}</div>
        <div class="fighter-wc">${esc(f.weightClass)}</div>
        <div class="fighter-rec">${esc(f.record||'0-0')}</div>
      </div>
      <div class="fighter-card-btns">
        <button onclick="openBioModal('${f.id}')">BIO</button>
        <button class="edit-fighter-btn" onclick="openEditModal('${f.id}')">EDIT</button>
      </div>
    </div>`;
  }).join('');
}

async function openBioModal(id) {
  const fighters = normalizeFighters(await fbGet('fighters'));
  const f = fighters.find(x => x.id === id); if (!f) return;
  $('bioPhoto').innerHTML     = f.photo ? `<img src="${f.photo}" alt="${esc(f.name)}" />` : '🥊';
  $('bioName').textContent    = f.name;
  $('bioWc').textContent      = f.weightClass;
  $('bioRec').textContent     = f.record || '0-0';
  $('bioBioText').textContent = f.bio || '';
  openModal($('bioModal'));
}

async function openEditModal(id) {
  editingFighterId = id; pendingPhotoBase64 = null;
  if (id) {
    const fighters = normalizeFighters(await fbGet('fighters'));
    const f = fighters.find(x => x.id === id); if (!f) return;
    $('editModalTitle').textContent  = 'EDIT FIGHTER';
    $('editName').value              = f.name;
    $('editWeightClass').value       = f.weightClass;
    $('editRecord').value            = f.record || '';
    $('editBio').value               = f.bio    || '';
    $('editPhotoPreview').innerHTML  = f.photo ? `<img src="${f.photo}" alt="preview" />` : '🥊';
    $('editPhotoLabel').textContent  = f.photo ? 'Change photo' : 'Click to upload photo';
    $('editDeleteBtn').style.display = '';
  } else {
    $('editModalTitle').textContent  = 'ADD FIGHTER';
    $('editName').value = $('editWeightClass').value = $('editRecord').value = $('editBio').value = '';
    $('editPhotoPreview').innerHTML  = '🥊';
    $('editPhotoLabel').textContent  = 'Click to upload photo';
    $('editPhotoFile').value         = '';
    $('editDeleteBtn').style.display = 'none';
  }
  openModal($('editFighterModal'));
}

async function saveFighter() {
  const name = $('editName').value.trim();
  const wc   = $('editWeightClass').value;
  const rec  = $('editRecord').value.trim();
  const bio  = $('editBio').value.trim();
  if (!name || !wc) { alert('Name and weight class are required.'); return; }

  const fighters = normalizeFighters(await fbGet('fighters'));
  if (editingFighterId) {
    const idx = fighters.findIndex(f => f.id === editingFighterId);
    if (idx === -1) return;
    fighters[idx] = { ...fighters[idx], name, weightClass:wc, record:rec, bio,
      photo: pendingPhotoBase64 !== null ? pendingPhotoBase64 : fighters[idx].photo };
  } else {
    fighters.push({ id:uid(), name, weightClass:wc, record:rec, bio, photo:pendingPhotoBase64||'' });
  }
  await fbSet('fighters', fighters);
  closeModal($('editFighterModal'));
  renderFighters($('fightersGrid'), fighters);
}

/* ── Boot ── */
document.addEventListener('DOMContentLoaded', () => {
  initSubmitPage();
  initRankingsPage();
  initProfilesPage();
});
