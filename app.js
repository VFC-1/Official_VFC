/* ═══════════════════════════════════════════════
   VFC — Vop Fight Club  |  app.js
   CHANGE THE PASSWORD BELOW:
*/
const ADMIN_PASSWORD = 'VFC2025';

/* ── JSONBin config ── */
const BIN_ID  = '69f9289b856a682189a7f4b3';
const BIN_KEY = '$2a$10$anaNujlYjKmXfp6C5dVIP.QJHkb8lo0lioPvVaP2qlk5K4hU4JX3i';
const BIN_URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`;

/* ── Local storage (fighters only) ── */
const K_FIGHTERS = 'vfc_fighters';

/* ── Helpers ── */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function loadLocal(key, def) {
  try { return JSON.parse(localStorage.getItem(key)) ?? def; }
  catch { return def; }
}
function saveLocal(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

const WC_LABELS = { sub165: 'Sub 165', '165to185': '165–185', '185plus': '185+' };

function checkSession(key) { return sessionStorage.getItem(key) === '1'; }
function setSession(key)   { sessionStorage.setItem(key, '1'); }

function openModal(o)  { o.classList.add('open');    document.body.style.overflow = 'hidden'; }
function closeModal(o) { o.classList.remove('open'); document.body.style.overflow = ''; }

/* ═══════════════════════════════════════════════
   JSONBIN
═══════════════════════════════════════════════ */
async function readBin() {
  try {
    const res  = await fetch(BIN_URL + '/latest', { headers: { 'X-Master-Key': BIN_KEY } });
    const json = await res.json();
    return json.record || { submissions: [], rankings: {} };
  } catch { return { submissions: [], rankings: {} }; }
}

async function writeBin(data) {
  await fetch(BIN_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Master-Key': BIN_KEY },
    body: JSON.stringify(data)
  });
}

/* ═══════════════════════════════════════════════
   SUBMIT PAGE
═══════════════════════════════════════════════ */
async function initSubmitPage() {
  const form       = $('fightForm');
  const successMsg = $('successMsg');
  const listEl     = $('submissionsList');
  if (!form) return;

  listEl.innerHTML = '<div class="no-submissions">Loading...</div>';
  const bin = await readBin();
  renderSubmissions(listEl, bin.submissions || []);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const f1    = $('fighter1').value.trim();
    const f2    = $('fighter2').value.trim();
    const wc    = $('weightClass').value;
    const sport = $('sport') ? $('sport').value : '';
    if (!f1 || !f2 || !wc || !sport) return;

    const bin = await readBin();
    bin.submissions = bin.submissions || [];
    bin.submissions.unshift({
      fighter1: f1, fighter2: f2,
      wc, wcLabel: WC_LABELS[wc] || wc,
      sport, date: new Date().toLocaleDateString()
    });
    await writeBin(bin);

    form.reset();
    successMsg.style.display = 'block';
    setTimeout(() => { successMsg.style.display = 'none'; }, 3500);
    renderSubmissions(listEl, bin.submissions);
  });
}

function renderSubmissions(container, list) {
  if (!container) return;
  if (!list || !list.length) {
    container.innerHTML = '<div class="no-submissions">No submissions yet</div>';
    return;
  }
  container.innerHTML = list.map(s =>
    `<div class="submission-item">
       <span class="fighters">${esc(s.fighter1)} vs ${esc(s.fighter2)}</span>
       <span class="weight">${esc(s.wcLabel)} &bull; ${esc(s.sport || '')} &bull; ${esc(s.date)}</span>
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

async function initRankingsPage() {
  const pwInput  = $('rankPwInput');
  const pwBtn    = $('rankPwBtn');
  const pwStatus = $('rankPwStatus');
  if (!pwBtn) return;

  pwStatus.textContent = 'Loading...';
  const bin      = await readBin();
  const rankings = Object.keys(bin.rankings || {}).length ? bin.rankings : DEFAULT_RANKINGS;
  renderRankings(rankings);
  pwStatus.textContent = 'Locked';

  if (checkSession('rank_unlocked')) enableRankEdit(pwStatus, pwBtn);

  pwBtn.addEventListener('click', async () => {
    if (rankingsEditing) {
      pwStatus.textContent = 'Saving...';
      const bin = await readBin();
      bin.rankings = loadLocal('vfc_rankings_draft', DEFAULT_RANKINGS);
      await writeBin(bin);
      renderRankings(bin.rankings);
      disableRankEdit(pwStatus, pwBtn, pwInput);
    } else {
      if (pwInput.value === ADMIN_PASSWORD) {
        setSession('rank_unlocked');
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

  const slotModal      = $('slotModal');
  const slotModalClose = $('slotModalClose');
  const slotSaveBtn    = $('slotSaveBtn');

  slotModalClose.addEventListener('click', () => closeModal(slotModal));
  slotModal.addEventListener('click', e => { if (e.target === slotModal) closeModal(slotModal); });

  slotSaveBtn.addEventListener('click', () => {
    if (!pendingSlot) return;
    const name  = $('slotName').value.trim();
    const rec   = $('slotRecord').value.trim();
    const draft = loadLocal('vfc_rankings_draft', DEFAULT_RANKINGS);
    const wc    = pendingSlot.wc;
    if (!draft[wc]) return;

    if (pendingSlot.type === 'champ')          draft[wc].champ = { name, rec };
    else if (pendingSlot.type === 'contender') draft[wc].contenders[pendingSlot.idx] = { name, rec };
    else                                       draft[wc].chuds[pendingSlot.idx] = { name, rec };

    saveLocal('vfc_rankings_draft', draft);
    renderRankings(draft);
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
  readBin().then(b => {
    saveLocal('vfc_rankings_draft', Object.keys(b.rankings||{}).length ? b.rankings : DEFAULT_RANKINGS);
    attachSlotClicks();
  });
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
  const draft  = loadLocal('vfc_rankings_draft', DEFAULT_RANKINGS);
  const wcData = draft[wc] || { champ:{name:'',rec:''}, contenders:[], chuds:[] };

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
  const WCS = ['sub165','165to185','185plus'];
  WCS.forEach(wc => {
    const wcData = data[wc] || DEFAULT_RANKINGS[wc];
    const nameEl = $(`champ-${wc}-name`);
    const recEl  = $(`champ-${wc}-rec`);
    if (nameEl) { nameEl.textContent = wcData.champ.name || 'VACANT'; nameEl.classList.toggle('champ-vacant', !wcData.champ.name); }
    if (recEl)  { recEl.textContent  = wcData.champ.rec  || ''; }

    wcData.contenders.forEach((f, i) => {
      const slot = $(`${wc}-c${i+1}`);
      if (!slot) return;
      slot.querySelector('.rank-name').textContent = f.name || '—';
      const rEl = slot.querySelector('.rank-rec');
      if (rEl) rEl.textContent = f.rec || '';
      slot.classList.toggle('rank-empty', !f.name);
      slot.classList.toggle('filled',     !!f.name);
      slot.classList.toggle('contender',  !!f.name);
    });

    wcData.chuds.forEach((f, i) => {
      const slot = $(`${wc}-h${i+1}`);
      if (!slot) return;
      slot.querySelector('.rank-name').textContent = f.name || '—';
      const rEl = slot.querySelector('.rank-rec');
      if (rEl) rEl.textContent = f.rec || '';
      slot.classList.toggle('rank-empty', !f.name);
      slot.classList.toggle('filled',     !!f.name);
      slot.classList.toggle('chud',       !!f.name);
    });
  });
  if (rankingsEditing) attachSlotClicks();
}

/* ═══════════════════════════════════════════════
   FIGHTER PROFILES PAGE
═══════════════════════════════════════════════ */
let profilesEditing    = false;
let editingFighterId   = null;
let pendingPhotoBase64 = null;

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

function initProfilesPage() {
  const pwInput  = $('profPwInput');
  const pwBtn    = $('profPwBtn');
  const pwStatus = $('profPwStatus');
  const addBtn   = $('addFighterBtn');
  const grid     = $('fightersGrid');
  if (!pwBtn) return;

  renderFighters(grid);
  if (checkSession('prof_unlocked')) enableProfEdit(pwStatus, pwBtn, addBtn);

  pwBtn.addEventListener('click', () => {
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
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      pendingPhotoBase64 = ev.target.result;
      $('editPhotoPreview').innerHTML = `<img src="${pendingPhotoBase64}" alt="preview" />`;
      $('editPhotoLabel').textContent = file.name;
    };
    reader.readAsDataURL(file);
  });

  $('editSaveBtn').addEventListener('click', saveFighter);
  $('editDeleteBtn').addEventListener('click', () => {
    if (!editingFighterId) return;
    if (!confirm('Delete this fighter?')) return;
    saveLocal(K_FIGHTERS, loadLocal(K_FIGHTERS, []).filter(f => f.id !== editingFighterId));
    closeModal(editModal);
    renderFighters(grid);
  });
}

function enableProfEdit(statusEl, btn, addBtn) {
  profilesEditing = true;
  statusEl.textContent = 'Admin Mode';
  statusEl.className = 'pw-status ok';
  btn.textContent = 'LOCK';
  btn.classList.add('active');
  addBtn.classList.add('visible');
  document.body.classList.add('edit-mode-profiles');
}

function disableProfEdit(statusEl, btn, inputEl, addBtn) {
  profilesEditing = false;
  statusEl.textContent = 'Locked';
  statusEl.className = 'pw-status';
  btn.textContent = 'UNLOCK';
  btn.classList.remove('active');
  if (inputEl) inputEl.value = '';
  addBtn.classList.remove('visible');
  document.body.classList.remove('edit-mode-profiles');
  sessionStorage.removeItem('prof_unlocked');
}

function renderFighters(grid) {
  if (!grid) return;
  const fighters = loadLocal(K_FIGHTERS, []);
  if (!fighters.length) {
    grid.innerHTML = '<div class="no-fighters">No fighters on the roster yet</div>';
    return;
  }
  grid.innerHTML = fighters.map(f => {
    const avatarHtml = f.photo
      ? `<div class="fighter-avatar"><img src="${f.photo}" alt="${esc(f.name)}" /></div>`
      : `<div class="fighter-avatar">🥊</div>`;
    return `
    <div class="fighter-card" data-id="${f.id}">
      <div class="fighter-card-top">
        ${avatarHtml}
        <div class="fighter-fn">${esc(f.name)}</div>
        <div class="fighter-wc">${esc(f.weightClass)}</div>
        <div class="fighter-rec">${esc(f.record || '0-0')}</div>
      </div>
      <div class="fighter-card-btns">
        <button onclick="openBioModal('${f.id}')">BIO</button>
        <button class="edit-fighter-btn" onclick="openEditModal('${f.id}')">EDIT</button>
      </div>
    </div>`;
  }).join('');
}

function openBioModal(id) {
  const f = loadLocal(K_FIGHTERS, []).find(x => x.id === id);
  if (!f) return;
  $('bioPhoto').innerHTML     = f.photo ? `<img src="${f.photo}" alt="${esc(f.name)}" />` : '🥊';
  $('bioName').textContent    = f.name;
  $('bioWc').textContent      = f.weightClass;
  $('bioRec').textContent     = f.record || '0-0';
  $('bioBioText').textContent = f.bio || '';
  openModal($('bioModal'));
}

function openEditModal(id) {
  editingFighterId = id; pendingPhotoBase64 = null;
  if (id) {
    const f = loadLocal(K_FIGHTERS, []).find(x => x.id === id);
    if (!f) return;
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

function saveFighter() {
  const name = $('editName').value.trim();
  const wc   = $('editWeightClass').value;
  const rec  = $('editRecord').value.trim();
  const bio  = $('editBio').value.trim();
  if (!name || !wc) { alert('Name and weight class are required.'); return; }
  const fighters = loadLocal(K_FIGHTERS, []);
  if (editingFighterId) {
    const idx = fighters.findIndex(f => f.id === editingFighterId);
    if (idx === -1) return;
    fighters[idx] = { ...fighters[idx], name, weightClass: wc, record: rec, bio,
      photo: pendingPhotoBase64 !== null ? pendingPhotoBase64 : fighters[idx].photo };
  } else {
    fighters.push({ id: uid(), name, weightClass: wc, record: rec, bio, photo: pendingPhotoBase64 || '' });
  }
  saveLocal(K_FIGHTERS, fighters);
  closeModal($('editFighterModal'));
  renderFighters($('fightersGrid'));
}

/* ── Boot ── */
document.addEventListener('DOMContentLoaded', () => {
  initSubmitPage();
  initRankingsPage();
  initProfilesPage();
});
