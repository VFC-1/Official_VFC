/* ═══════════════════════════════════════════════
   VFC — Vop Fight Club  |  app.js
   ═══════════════════════════════════════════════
   CHANGE THE PASSWORD BELOW (line 8):
*/
const ADMIN_PASSWORD = 'VFC2025';

/* ── Storage keys ── */
const K_RANKINGS    = 'vfc_rankings_v2';
const K_SUBMISSIONS = 'vfc_submissions';
const K_FIGHTERS    = 'vfc_fighters';

/* ── Helpers ── */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function load(key, def) {
  try { return JSON.parse(localStorage.getItem(key)) ?? def; }
  catch { return def; }
}
function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

const WC_LABELS = { sub165: 'Sub 165', '165to185': '165–185', '185plus': '185+' };

/* ═══════════════════════════════════════════════
   PASSWORD UNLOCK — shared util
   Returns true if session already unlocked.
   Prompts otherwise.
═══════════════════════════════════════════════ */
function checkSession(key) {
  return sessionStorage.getItem(key) === '1';
}
function setSession(key) {
  sessionStorage.setItem(key, '1');
}

/* ═══════════════════════════════════════════════
   MODAL helpers
═══════════════════════════════════════════════ */
function openModal(overlay) {
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeModal(overlay) {
  overlay.classList.remove('open');
  document.body.style.overflow = '';
}

/* ═══════════════════════════════════════════════
   SUBMIT PAGE
═══════════════════════════════════════════════ */
function initSubmitPage() {
  const form       = $('fightForm');
  const successMsg = $('successMsg');
  const listEl     = $('submissionsList');
  if (!form) return;

  renderSubmissions(listEl);

  form.addEventListener('submit', e => {
    e.preventDefault();
    const f1 = $('fighter1').value.trim();
    const f2 = $('fighter2').value.trim();
    const wc = $('weightClass').value;
    if (!f1 || !f2 || !wc) return;

    const list = load(K_SUBMISSIONS, []);
    list.unshift({ fighter1: f1, fighter2: f2, wc, wcLabel: WC_LABELS[wc] || wc, date: new Date().toLocaleDateString() });
    save(K_SUBMISSIONS, list);

    form.reset();
    successMsg.style.display = 'block';
    setTimeout(() => { successMsg.style.display = 'none'; }, 3500);
    renderSubmissions(listEl);
  });
}

function renderSubmissions(container) {
  if (!container) return;
  const list = load(K_SUBMISSIONS, []);
  if (!list.length) {
    container.innerHTML = '<div class="no-submissions">No submissions yet</div>';
    return;
  }
  container.innerHTML = list.map(s =>
    `<div class="submission-item">
       <span class="fighters">${esc(s.fighter1)} vs ${esc(s.fighter2)}</span>
       <span class="weight">${esc(s.wcLabel)} &bull; ${esc(s.date)}</span>
     </div>`
  ).join('');
}

/* ═══════════════════════════════════════════════
   RANKINGS PAGE
═══════════════════════════════════════════════ */
const DEFAULT_RANKINGS = {
  sub165:    { champ: {name:'',rec:''}, contenders:[{name:'',rec:''},{name:'',rec:''},{name:'',rec:''}], chuds:[{name:'',rec:''},{name:'',rec:''},{name:'',rec:''}] },
  '165to185':{ champ: {name:'',rec:''}, contenders:[{name:'',rec:''},{name:'',rec:''},{name:'',rec:''}], chuds:[{name:'',rec:''},{name:'',rec:''},{name:'',rec:''}] },
  '185plus': { champ: {name:'',rec:''}, contenders:[{name:'',rec:''},{name:'',rec:''},{name:'',rec:''}], chuds:[{name:'',rec:''},{name:'',rec:''}  ,{name:'',rec:''}] },
};

let rankingsEditing = false;
let pendingSlot = null; // { el, type, wc, idx }

function initRankingsPage() {
  const pwInput  = $('rankPwInput');
  const pwBtn    = $('rankPwBtn');
  const pwStatus = $('rankPwStatus');
  if (!pwBtn) return;

  const data = load(K_RANKINGS, DEFAULT_RANKINGS);
  renderRankings(data);

  // If already unlocked this session, show edit state
  if (checkSession('rank_unlocked')) {
    enableRankEdit(pwStatus, pwBtn);
  }

  pwBtn.addEventListener('click', () => {
    if (rankingsEditing) {
      // Save & lock
      const updated = collectRankings();
      save(K_RANKINGS, updated);
      renderRankings(updated);
      disableRankEdit(pwStatus, pwBtn, pwInput);
    } else {
      const val = pwInput.value;
      if (val === ADMIN_PASSWORD) {
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

  // Allow Enter key in password field
  pwInput.addEventListener('keydown', e => { if (e.key === 'Enter') pwBtn.click(); });

  // Slot edit modal
  const slotModal     = $('slotModal');
  const slotModalClose = $('slotModalClose');
  const slotSaveBtn   = $('slotSaveBtn');

  slotModalClose.addEventListener('click', () => closeModal(slotModal));
  slotModal.addEventListener('click', e => { if (e.target === slotModal) closeModal(slotModal); });

  slotSaveBtn.addEventListener('click', () => {
    if (!pendingSlot) return;
    const name = $('slotName').value.trim();
    const rec  = $('slotRecord').value.trim();

    const data = load(K_RANKINGS, DEFAULT_RANKINGS);
    const wc   = pendingSlot.wc;

    if (!data[wc]) return;

    if (pendingSlot.type === 'champ') {
      data[wc].champ = { name, rec };
    } else if (pendingSlot.type === 'contender') {
      data[wc].contenders[pendingSlot.idx] = { name, rec };
    } else {
      data[wc].chuds[pendingSlot.idx] = { name, rec };
    }

    save(K_RANKINGS, data);
    renderRankings(data);
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
    // Champ
    const champNameEl = $(`champ-${wc}-name`);
    if (champNameEl) {
      champNameEl.onclick = () => openSlotModal('champ', wc, 0, champNameEl.dataset);
    }
    // Contenders
    for (let i = 1; i <= 3; i++) {
      const slot = $(`${wc}-c${i}`);
      if (slot) {
        slot.querySelector('.rank-name').onclick = () => openSlotModal('contender', wc, i - 1);
      }
    }
    // Chuds
    for (let i = 1; i <= 3; i++) {
      const slot = $(`${wc}-h${i}`);
      if (slot) {
        slot.querySelector('.rank-name').onclick = () => openSlotModal('chud', wc, i - 1);
      }
    }
  });
}

function openSlotModal(type, wc, idx) {
  const data  = load(K_RANKINGS, DEFAULT_RANKINGS);
  const wcData = data[wc] || { champ:{name:'',rec:''}, contenders:[], chuds:[] };

  let current = { name: '', rec: '' };
  if (type === 'champ') current = wcData.champ;
  else if (type === 'contender') current = wcData.contenders[idx] || current;
  else current = wcData.chuds[idx] || current;

  $('slotModalTitle').textContent = type === 'champ'
    ? `EDIT CHAMPION — ${WC_LABELS[wc]}`
    : `EDIT ${type.toUpperCase()} #${idx+1} — ${WC_LABELS[wc]}`;

  $('slotName').value   = current.name || '';
  $('slotRecord').value = current.rec  || '';
  pendingSlot = { type, wc, idx };

  openModal($('slotModal'));
  $('slotName').focus();
}

function renderRankings(data) {
  const WCS = ['sub165','165to185','185plus'];
  WCS.forEach(wc => {
    const wcData = data[wc] || DEFAULT_RANKINGS[wc];

    // Champ
    const nameEl = $(`champ-${wc}-name`);
    const recEl  = $(`champ-${wc}-rec`);
    if (nameEl) {
      const n = wcData.champ.name;
      nameEl.textContent = n || 'VACANT';
      nameEl.classList.toggle('champ-vacant', !n);
    }
    if (recEl) { recEl.textContent = wcData.champ.rec || ''; }

    // Contenders
    wcData.contenders.forEach((f, i) => {
      const slot = $(`${wc}-c${i+1}`);
      if (!slot) return;
      const nEl = slot.querySelector('.rank-name');
      const rEl = slot.querySelector('.rank-rec');
      nEl.textContent = f.name || '—';
      if (rEl) rEl.textContent = f.rec || '';
      slot.classList.toggle('rank-empty', !f.name);
      slot.classList.toggle('filled', !!f.name);
      slot.classList.toggle('contender', !!f.name);
    });

    // Chuds
    wcData.chuds.forEach((f, i) => {
      const slot = $(`${wc}-h${i+1}`);
      if (!slot) return;
      const nEl = slot.querySelector('.rank-name');
      const rEl = slot.querySelector('.rank-rec');
      nEl.textContent = f.name || '—';
      if (rEl) rEl.textContent = f.rec || '';
      slot.classList.toggle('rank-empty', !f.name);
      slot.classList.toggle('filled', !!f.name);
      slot.classList.toggle('chud', !!f.name);
    });
  });

  // Re-attach clicks if still in edit mode
  if (rankingsEditing) attachSlotClicks();
}

function collectRankings() {
  return load(K_RANKINGS, DEFAULT_RANKINGS);
}

/* ═══════════════════════════════════════════════
   FIGHTER PROFILES PAGE
═══════════════════════════════════════════════ */
let profilesEditing = false;
let editingFighterId = null;
let pendingPhotoBase64 = null;

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

function initProfilesPage() {
  const pwInput   = $('profPwInput');
  const pwBtn     = $('profPwBtn');
  const pwStatus  = $('profPwStatus');
  const addBtn    = $('addFighterBtn');
  const grid      = $('fightersGrid');
  if (!pwBtn) return;

  renderFighters(grid);

  if (checkSession('prof_unlocked')) {
    enableProfEdit(pwStatus, pwBtn, addBtn);
  }

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

  // Add fighter
  addBtn.addEventListener('click', () => openEditModal(null));

  // Bio modal close
  const bioModal = $('bioModal');
  $('bioModalClose').addEventListener('click', () => closeModal(bioModal));
  bioModal.addEventListener('click', e => { if (e.target === bioModal) closeModal(bioModal); });

  // Edit modal close
  const editModal = $('editFighterModal');
  $('editModalClose').addEventListener('click', () => closeModal(editModal));
  editModal.addEventListener('click', e => { if (e.target === editModal) closeModal(editModal); });

  // Photo upload preview
  $('editPhotoFile').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      pendingPhotoBase64 = ev.target.result;
      const prev = $('editPhotoPreview');
      prev.innerHTML = `<img src="${pendingPhotoBase64}" alt="preview" />`;
      $('editPhotoLabel').textContent = file.name;
    };
    reader.readAsDataURL(file);
  });

  // Save fighter
  $('editSaveBtn').addEventListener('click', saveFighter);

  // Delete fighter
  $('editDeleteBtn').addEventListener('click', () => {
    if (!editingFighterId) return;
    if (!confirm('Delete this fighter?')) return;
    const fighters = load(K_FIGHTERS, []).filter(f => f.id !== editingFighterId);
    save(K_FIGHTERS, fighters);
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
  const fighters = load(K_FIGHTERS, []);

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
  const fighters = load(K_FIGHTERS, []);
  const f = fighters.find(x => x.id === id);
  if (!f) return;

  const bioPhoto = $('bioPhoto');
  if (f.photo) {
    bioPhoto.innerHTML = `<img src="${f.photo}" alt="${esc(f.name)}" />`;
  } else {
    bioPhoto.innerHTML = '🥊';
  }
  $('bioName').textContent = f.name;
  $('bioWc').textContent   = f.weightClass;
  $('bioRec').textContent  = f.record || '0-0';
  $('bioBioText').textContent = f.bio || '';

  openModal($('bioModal'));
}

function openEditModal(id) {
  editingFighterId = id;
  pendingPhotoBase64 = null;

  const deleteBtn = $('editDeleteBtn');

  if (id) {
    const fighters = load(K_FIGHTERS, []);
    const f = fighters.find(x => x.id === id);
    if (!f) return;
    $('editModalTitle').textContent = 'EDIT FIGHTER';
    $('editName').value        = f.name;
    $('editWeightClass').value = f.weightClass;
    $('editRecord').value      = f.record || '';
    $('editBio').value         = f.bio    || '';

    const prev = $('editPhotoPreview');
    if (f.photo) {
      prev.innerHTML = `<img src="${f.photo}" alt="preview" />`;
    } else {
      prev.innerHTML = '🥊';
    }
    $('editPhotoLabel').textContent = f.photo ? 'Change photo' : 'Click to upload photo';
    deleteBtn.style.display = '';
  } else {
    $('editModalTitle').textContent = 'ADD FIGHTER';
    $('editName').value        = '';
    $('editWeightClass').value = '';
    $('editRecord').value      = '';
    $('editBio').value         = '';
    $('editPhotoPreview').innerHTML = '🥊';
    $('editPhotoLabel').textContent = 'Click to upload photo';
    $('editPhotoFile').value = '';
    deleteBtn.style.display = 'none';
  }

  openModal($('editFighterModal'));
}

function saveFighter() {
  const name = $('editName').value.trim();
  const wc   = $('editWeightClass').value;
  const rec  = $('editRecord').value.trim();
  const bio  = $('editBio').value.trim();

  if (!name || !wc) { alert('Name and weight class are required.'); return; }

  const fighters = load(K_FIGHTERS, []);

  if (editingFighterId) {
    const idx = fighters.findIndex(f => f.id === editingFighterId);
    if (idx === -1) return;
    fighters[idx] = {
      ...fighters[idx],
      name, weightClass: wc, record: rec, bio,
      photo: pendingPhotoBase64 !== null ? pendingPhotoBase64 : fighters[idx].photo,
    };
  } else {
    fighters.push({
      id: uid(), name, weightClass: wc, record: rec, bio,
      photo: pendingPhotoBase64 || '',
    });
  }

  save(K_FIGHTERS, fighters);
  closeModal($('editFighterModal'));
  renderFighters($('fightersGrid'));
}

/* ═══════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initSubmitPage();
  initRankingsPage();
  initProfilesPage();
});
