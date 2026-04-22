/**
 * admin.js — Admin Panel Logic
 *
 * Features:
 * - Password login (sessionStorage)
 * - Load exam data from /data/exams.json (falls back to localStorage)
 * - Full CRUD: Add, Edit, Delete exams
 * - Search + category filter
 * - Auto-save changes to localStorage
 * - Export updated JSON for deployment
 * - Import JSON to restore/update
 */

// ──────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────
const STORAGE_KEY    = 'cp_admin_examdata';
const SESSION_KEY    = 'cp_admin_authed';
const ADMIN_PASSWORD = 'Chingu@15';           // Change in production!

const BG_HEX_MAP = {
  white: '#FFFFFF',
  blue:  '#003580',
  cream: '#FFFDD0',
  any:   '#888888',
};

// ──────────────────────────────────────────────────────────
// State
// ──────────────────────────────────────────────────────────
let _data         = null;   // { categories: [...] }
let _editingExam  = null;   // { catId, examId } or null for new
let _editCount    = 0;

// ──────────────────────────────────────────────────────────
// Auth
// ──────────────────────────────────────────────────────────
function doLogin() {
  const pass  = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');

  if (pass === ADMIN_PASSWORD) {
    sessionStorage.setItem(SESSION_KEY, '1');
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('admin-wrap').style.display   = 'flex';
    errEl.textContent = '';
    initAdmin();
  } else {
    errEl.textContent = '❌ Incorrect password. Try again.';
    document.getElementById('login-pass').value = '';
    document.getElementById('login-pass').focus();
  }
}

function doLogout() {
  sessionStorage.removeItem(SESSION_KEY);
  location.reload();
}

// Allow Enter key on password field
document.getElementById('login-pass').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doLogin();
});

// Auto-login if already authenticated this session
if (sessionStorage.getItem(SESSION_KEY)) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('admin-wrap').style.display   = 'flex';
  initAdmin();
}

// ──────────────────────────────────────────────────────────
// Init
// ──────────────────────────────────────────────────────────
async function initAdmin() {
  _data = await loadData();
  populateCategoryFilters();
  updateStats();
  renderTable();
}

// ──────────────────────────────────────────────────────────
// Data Loading
// ──────────────────────────────────────────────────────────
async function loadData() {
  // 1. Try localStorage first (has admin edits)
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed?.categories?.length) {
        showStatus('Loaded from browser storage');
        return parsed;
      }
    } catch (_) {}
  }

  // 2. Fetch from server
  try {
    const res  = await fetch('/data/exams.json');
    const data = await res.json();
    showStatus('Loaded from exams.json');
    return data;
  } catch (err) {
    showToast('Could not load exams.json — check server', 'error');
    return { categories: [] };
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(_data));
  _editCount++;
  document.getElementById('stat-modified').textContent = _editCount;
  document.getElementById('stat-saved').textContent    = '✓ Saved';
  document.getElementById('stat-saved').style.color    = '#10b981';
  showStatus(`Last saved ${new Date().toLocaleTimeString()}`);
}

function showStatus(msg) {
  const el = document.getElementById('last-saved-label');
  if (el) el.textContent = msg;
}

// ──────────────────────────────────────────────────────────
// Stats
// ──────────────────────────────────────────────────────────
function updateStats() {
  if (!_data) return;
  const cats  = _data.categories.length;
  const exams = _data.categories.reduce((s, c) => s + c.exams.length, 0);
  document.getElementById('stat-cats').textContent  = cats;
  document.getElementById('stat-exams').textContent = exams;
}

// ──────────────────────────────────────────────────────────
// Category filter dropdowns
// ──────────────────────────────────────────────────────────
function populateCategoryFilters() {
  if (!_data) return;

  const filterSel = document.getElementById('cat-filter');
  const catSel    = document.getElementById('f-cat');

  filterSel.innerHTML = '<option value="">All Categories</option>';
  catSel.innerHTML    = '';

  _data.categories.forEach(cat => {
    filterSel.innerHTML += `<option value="${cat.id}">${cat.icon || ''} ${cat.name}</option>`;
    catSel.innerHTML    += `<option value="${cat.id}">${cat.icon || ''} ${cat.name}</option>`;
  });
}

// ──────────────────────────────────────────────────────────
// Table Rendering
// ──────────────────────────────────────────────────────────
function renderTable() {
  if (!_data) return;

  const query     = document.getElementById('admin-search').value.toLowerCase().trim();
  const catFilter = document.getElementById('cat-filter').value;
  const tbody     = document.getElementById('table-body');
  let   rows      = '';
  let   count     = 0;

  _data.categories.forEach(cat => {
    if (catFilter && cat.id !== catFilter) return;

    cat.exams.forEach(exam => {
      if (query && !exam.name.toLowerCase().includes(query) && !exam.fullName.toLowerCase().includes(query)) return;

      const p    = exam.photo;
      const s    = exam.signature;
      const bgC  = BG_HEX_MAP[p?.bgColor] || '#888';

      rows += `
        <tr>
          <td>
            <div style="font-weight:600;">${exam.name}</div>
            <div style="font-size:0.72rem;color:var(--text-muted);">${exam.fullName}</div>
          </td>
          <td><span class="badge-cat">${cat.icon || ''} ${cat.name}</span></td>
          <td>
            ${p ? `
              <span class="spec-chip">${p.widthPx}×${p.heightPx}px</span>
              <span class="spec-chip">${p.minSizeKB}–${p.maxSizeKB} KB</span>
              <span class="spec-chip">${p.format}</span>
            ` : '<span style="color:var(--text-muted)">—</span>'}
          </td>
          <td>
            ${s ? `
              <span class="spec-chip">${s.widthPx}×${s.heightPx}px</span>
              <span class="spec-chip">${s.minSizeKB}–${s.maxSizeKB} KB</span>
            ` : '<span style="color:var(--text-muted)">—</span>'}
          </td>
          <td>
            <span style="display:flex;align-items:center;gap:6px;">
              <span class="bg-dot" style="background:${bgC};"></span>
              ${p?.bgColor || '—'}
            </span>
          </td>
          <td style="font-size:0.78rem;color:var(--text-muted);">${exam.lastVerified || '—'}</td>
          <td><span class="spec-chip">${exam.cycle || '—'}</span></td>
          <td>
            <div class="action-btns">
              <button class="btn-edit" onclick="openEditModal('${cat.id}','${exam.id}')">✏️ Edit</button>
              <button class="btn-del"  onclick="deleteExam('${cat.id}','${exam.id}')">🗑️</button>
            </div>
          </td>
        </tr>
      `;
      count++;
    });
  });

  if (count === 0) {
    tbody.innerHTML = `
      <tr><td colspan="8">
        <div class="table-empty">
          <span>🔍</span>
          No exams found matching your search.
        </div>
      </td></tr>
    `;
  } else {
    tbody.innerHTML = rows;
  }
}

// ──────────────────────────────────────────────────────────
// Modal: Open for editing
// ──────────────────────────────────────────────────────────
function openEditModal(catId, examId) {
  const cat  = _data.categories.find(c => c.id === catId);
  const exam = cat?.exams.find(e => e.id === examId);
  if (!exam) return;

  _editingExam = { catId, examId };
  document.getElementById('modal-title').textContent = `✏️ Edit: ${exam.name}`;
  document.getElementById('f-is-new').value = 'false';

  // Fill form
  document.getElementById('f-cat-id').value  = catId;
  document.getElementById('f-exam-id').value = examId;
  document.getElementById('f-name').value     = exam.name;
  document.getElementById('f-fullname').value = exam.fullName;
  document.getElementById('f-cycle').value    = exam.cycle    || '';
  document.getElementById('f-link').value     = exam.officialLink || '';
  document.getElementById('f-verified').value = exam.lastVerified || '';

  // Category selector
  document.getElementById('f-cat').value = catId;

  // Photo spec
  const p = exam.photo || {};
  document.getElementById('f-p-max').value  = p.maxSizeKB  || '';
  document.getElementById('f-p-min').value  = p.minSizeKB  || '';
  document.getElementById('f-p-w').value    = p.widthPx    || '';
  document.getElementById('f-p-h').value    = p.heightPx   || '';
  document.getElementById('f-p-fmt').value  = p.format     || 'JPEG';
  document.getElementById('f-p-bg').value   = p.bgColor    || 'white';
  document.getElementById('f-p-bgreq').value = String(p.bgRequired !== false);
  document.getElementById('f-p-notes').value = p.notes     || '';

  // Signature spec
  const s = exam.signature || {};
  document.getElementById('f-s-max').value  = s.maxSizeKB  || '';
  document.getElementById('f-s-min').value  = s.minSizeKB  || '';
  document.getElementById('f-s-w').value    = s.widthPx    || '';
  document.getElementById('f-s-h').value    = s.heightPx   || '';
  document.getElementById('f-s-fmt').value  = s.format     || 'JPEG';
  document.getElementById('f-s-bg').value   = s.bgColor    || 'white';
  document.getElementById('f-s-notes').value = s.notes     || '';

  document.getElementById('modal-save-btn').textContent = '💾 Save Changes';
  document.getElementById('modal-overlay').classList.add('open');
}

// ──────────────────────────────────────────────────────────
// Modal: Open for adding a new exam
// ──────────────────────────────────────────────────────────
function openAddModal() {
  _editingExam = null;
  document.getElementById('modal-title').textContent = '➕ Add New Exam';
  document.getElementById('exam-form').reset();
  document.getElementById('f-is-new').value = 'true';

  // Set sensible defaults
  document.getElementById('f-p-fmt').value   = 'JPEG';
  document.getElementById('f-p-bg').value    = 'white';
  document.getElementById('f-p-bgreq').value = 'true';
  document.getElementById('f-s-fmt').value   = 'JPEG';
  document.getElementById('f-s-bg').value    = 'white';
  document.getElementById('f-verified').value = new Date().toISOString().slice(0, 10);

  document.getElementById('modal-save-btn').textContent = '➕ Add Exam';
  document.getElementById('modal-overlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  _editingExam = null;
}

function closeModalOnOutsideClick(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
}

// ──────────────────────────────────────────────────────────
// Save Exam (Add or Edit)
// ──────────────────────────────────────────────────────────
function saveExam(e) {
  e.preventDefault();

  const isNew   = document.getElementById('f-is-new').value === 'true';
  const catId   = document.getElementById('f-cat').value;
  const name    = document.getElementById('f-name').value.trim();
  const fullName= document.getElementById('f-fullname').value.trim();

  const cat = _data.categories.find(c => c.id === catId);
  if (!cat) { showToast('Category not found!', 'error'); return; }

  // Build spec objects
  const photo = {
    maxSizeKB:  parseInt(document.getElementById('f-p-max').value) || 50,
    minSizeKB:  parseInt(document.getElementById('f-p-min').value) || 0,
    widthPx:    parseInt(document.getElementById('f-p-w').value)   || 200,
    heightPx:   parseInt(document.getElementById('f-p-h').value)   || 230,
    format:     document.getElementById('f-p-fmt').value,
    bgColor:    document.getElementById('f-p-bg').value,
    bgRequired: document.getElementById('f-p-bgreq').value === 'true',
    bgHex:      BG_HEX_MAP[document.getElementById('f-p-bg').value] || '#FFFFFF',
    notes:      document.getElementById('f-p-notes').value.trim(),
  };

  const signature = {
    maxSizeKB:  parseInt(document.getElementById('f-s-max').value) || 20,
    minSizeKB:  parseInt(document.getElementById('f-s-min').value) || 0,
    widthPx:    parseInt(document.getElementById('f-s-w').value)   || 140,
    heightPx:   parseInt(document.getElementById('f-s-h').value)   || 60,
    format:     document.getElementById('f-s-fmt').value,
    bgColor:    document.getElementById('f-s-bg').value,
    bgRequired: true,
    bgHex:      BG_HEX_MAP[document.getElementById('f-s-bg').value] || '#FFFFFF',
    notes:      document.getElementById('f-s-notes').value.trim(),
  };

  if (isNew) {
    // Generate ID from name
    const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    if (cat.exams.find(e => e.id === id)) {
      showToast('An exam with this name already exists in this category!', 'error');
      return;
    }

    cat.exams.push({
      id,
      name,
      fullName,
      photo,
      signature,
      officialLink:  document.getElementById('f-link').value.trim(),
      lastVerified:  document.getElementById('f-verified').value,
      cycle:         document.getElementById('f-cycle').value.trim(),
    });

    showToast(`✅ "${name}" added successfully!`, 'success');

  } else {
    // Edit existing — may have moved to different category
    const oldCatId  = document.getElementById('f-cat-id').value;
    const examId    = document.getElementById('f-exam-id').value;
    const oldCat    = _data.categories.find(c => c.id === oldCatId);
    const examIdx   = oldCat?.exams.findIndex(e => e.id === examId);

    if (!oldCat || examIdx === -1) { showToast('Exam not found!', 'error'); return; }

    const existing = oldCat.exams[examIdx];

    // Remove from old category
    oldCat.exams.splice(examIdx, 1);

    // Add to (possibly new) category
    cat.exams.push({
      ...existing,
      name,
      fullName,
      photo,
      signature,
      officialLink:  document.getElementById('f-link').value.trim(),
      lastVerified:  document.getElementById('f-verified').value,
      cycle:         document.getElementById('f-cycle').value.trim(),
    });

    showToast(`✅ "${name}" updated successfully!`, 'success');
  }

  saveData();
  updateStats();
  renderTable();
  closeModal();
}

// ──────────────────────────────────────────────────────────
// Delete Exam
// ──────────────────────────────────────────────────────────
function deleteExam(catId, examId) {
  const cat  = _data.categories.find(c => c.id === catId);
  const exam = cat?.exams.find(e => e.id === examId);
  if (!exam) return;

  if (!confirm(`Delete "${exam.name}" from ${cat.name}?\n\nThis cannot be undone (unless you reset to original or reimport).`)) return;

  cat.exams = cat.exams.filter(e => e.id !== examId);
  saveData();
  updateStats();
  renderTable();
  showToast(`🗑️ "${exam.name}" deleted.`, 'info');
}

// ──────────────────────────────────────────────────────────
// Export JSON
// ──────────────────────────────────────────────────────────
function exportJSON() {
  const json     = JSON.stringify(_data, null, 2);
  const blob     = new Blob([json], { type: 'application/json' });
  const url      = URL.createObjectURL(blob);
  const a        = document.createElement('a');
  a.href         = url;
  a.download     = `exams_${new Date().toISOString().slice(0,10)}.json`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 150);
  showToast('📦 JSON exported! Replace data/exams.json to deploy.', 'success', 5000);
}

// ──────────────────────────────────────────────────────────
// Import JSON
// ──────────────────────────────────────────────────────────
function importJSON(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!parsed?.categories) throw new Error('Invalid format — missing "categories" key');

      _data = parsed;
      saveData();
      populateCategoryFilters();
      updateStats();
      renderTable();
      showToast(`✅ Imported ${parsed.categories.length} categories successfully!`, 'success');
    } catch (err) {
      showToast(`❌ Import failed: ${err.message}`, 'error', 6000);
    }
  };
  reader.readAsText(file);
  event.target.value = ''; // Reset input
}

// ──────────────────────────────────────────────────────────
// Reset to original exams.json
// ──────────────────────────────────────────────────────────
async function resetToOriginal() {
  if (!confirm('This will discard ALL your local edits and reload the original exams.json. Are you sure?')) return;

  localStorage.removeItem(STORAGE_KEY);

  try {
    const res  = await fetch('/data/exams.json?nocache=' + Date.now());
    _data = await res.json();
    saveData();
    populateCategoryFilters();
    updateStats();
    renderTable();
    showToast('🔄 Reset to original exams.json!', 'success');
  } catch (err) {
    showToast('❌ Could not fetch original exams.json', 'error');
  }
}

// ──────────────────────────────────────────────────────────
// Toast
// ──────────────────────────────────────────────────────────
let _toastTimer = null;

function showToast(msg, type = 'info', duration = 3500) {
  const el = document.getElementById('admin-toast');
  if (!el) return;

  el.textContent = msg;
  el.className   = `show ${type}`;

  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.className = type;
  }, duration);
}

// ──────────────────────────────────────────────────────────
// Keyboard shortcuts
// ──────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});
