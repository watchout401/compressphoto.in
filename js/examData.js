/**
 * examData.js — Load and render exam categories + specs
 * Reads from /data/exams.json (fallback to embedded data)
 * Also updates spec panel and sidebar.
 */

const ExamData = (() => {

  let _data    = null;
  let _current = null; // { category, exam }

  // ──────────────────────────────────────────────────────────
  // Load exam data from JSON
  // ──────────────────────────────────────────────────────────
  async function load() {
    if (_data) return _data;
    try {
      const res  = await fetch('/data/exams.json');
      _data = await res.json();
    } catch (e) {
      console.error('Failed to load exam data', e);
      _data = { categories: [] };
    }
    return _data;
  }

  // ──────────────────────────────────────────────────────────
  // Build sidebar HTML from exam data
  // ──────────────────────────────────────────────────────────
  async function buildSidebar() {
    const data  = await load();
    const list  = document.getElementById('category-list');
    if (!list) return;

    list.innerHTML = '';

    data.categories.forEach(cat => {
      const item = document.createElement('div');
      item.className  = 'category-item';
      item.dataset.id = cat.id;

      item.innerHTML = `
        <button class="category-btn" aria-expanded="false" data-cat="${cat.id}">
          <span class="category-icon">${cat.icon}</span>
          <span class="category-name">${cat.name}</span>
          <span class="category-count">${cat.exams.length}</span>
          <span class="category-arrow">▶</span>
        </button>
        <div class="exam-dropdown" id="dropdown-${cat.id}">
          <div class="exam-list">
            ${cat.exams.map(ex => `
              <button class="exam-btn"
                      data-cat="${cat.id}"
                      data-exam="${ex.id}"
                      title="${ex.fullName}">
                <span class="exam-btn-name">${ex.name}</span>
                <span class="exam-btn-cycle">${ex.cycle || ''}</span>
              </button>
            `).join('')}
          </div>
        </div>
      `;

      list.appendChild(item);

      // Category toggle
      const btn      = item.querySelector('.category-btn');
      const dropdown = item.querySelector('.exam-dropdown');

      btn.addEventListener('click', () => {
        const isOpen = dropdown.classList.contains('open');

        // Close all others
        document.querySelectorAll('.exam-dropdown.open').forEach(d => {
          d.classList.remove('open');
        });
        document.querySelectorAll('.category-btn.open').forEach(b => {
          b.classList.remove('open');
          b.setAttribute('aria-expanded', 'false');
        });

        if (!isOpen) {
          dropdown.classList.add('open');
          btn.classList.add('open');
          btn.setAttribute('aria-expanded', 'true');
        }
      });

      // Exam selection
      item.querySelectorAll('.exam-btn').forEach(examBtn => {
        examBtn.addEventListener('click', () => {
          const catId  = examBtn.dataset.cat;
          const examId = examBtn.dataset.exam;
          selectExam(catId, examId);
        });
      });
    });

    // Update stats in sidebar footer
    const totalExams = data.categories.reduce((sum, c) => sum + c.exams.length, 0);
    const catCountEl = document.getElementById('stat-categories');
    const exmCountEl = document.getElementById('stat-exams');
    if (catCountEl) catCountEl.textContent = data.categories.length;
    if (exmCountEl) exmCountEl.textContent = totalExams;
  }

  // ──────────────────────────────────────────────────────────
  // Search filter
  // ──────────────────────────────────────────────────────────
  function initSearch() {
    const input = document.getElementById('sidebar-search');
    if (!input) return;

    input.addEventListener('input', () => {
      const q = input.value.toLowerCase().trim();
      filterSidebar(q);
    });
  }

  function filterSidebar(query) {
    const categories = document.querySelectorAll('.category-item');

    categories.forEach(catEl => {
      const catName = catEl.querySelector('.category-name').textContent.toLowerCase();
      const exams   = catEl.querySelectorAll('.exam-btn');
      let   anyMatch = catName.includes(query);

      exams.forEach(ex => {
        const name  = ex.querySelector('.exam-btn-name').textContent.toLowerCase();
        const match = !query || name.includes(query) || catName.includes(query);
        ex.style.display = match ? '' : 'none';
        if (match) anyMatch = true;
      });

      catEl.style.display = anyMatch ? '' : 'none';

      // Auto-open if search matches
      if (query && anyMatch) {
        const dropdown = catEl.querySelector('.exam-dropdown');
        const btn      = catEl.querySelector('.category-btn');
        dropdown?.classList.add('open');
        btn?.classList.add('open');
      } else if (!query) {
        const dropdown = catEl.querySelector('.exam-dropdown');
        const btn      = catEl.querySelector('.category-btn');
        dropdown?.classList.remove('open');
        btn?.classList.remove('open');
        btn?.setAttribute('aria-expanded', 'false');
      }
    });

    // Show empty state
    const empty = document.getElementById('sidebar-empty');
    const visibleCount = [...categories].filter(el => el.style.display !== 'none').length;
    if (empty) empty.classList.toggle('hidden', visibleCount > 0);
  }

  // ──────────────────────────────────────────────────────────
  // Select exam — update active state + render spec
  // ──────────────────────────────────────────────────────────
  async function selectExam(catId, examId) {
    const data = await load();
    const cat  = data.categories.find(c => c.id === catId);
    const exam = cat?.exams.find(e => e.id === examId);
    if (!exam) return;

    _current = { category: cat, exam };

    // Active state
    document.querySelectorAll('.exam-btn.active').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.exam-btn[data-exam="${examId}"]`);
    if (btn) btn.classList.add('active');

    // Update mobile selector bar text
    const mobileLabel = document.getElementById('mobile-exam-label');
    if (mobileLabel) {
      mobileLabel.textContent = exam.name;
      mobileLabel.closest('.mobile-exam-selector-btn')?.classList.add('has-exam');
    }

    // Render spec panel
    renderSpecPanel(cat, exam, 'photo');

    // Unlock the upload zone (exam is now selected)
    window.App?.unlockUpload?.();

    // Close mobile sidebar if open
    closeMobileSidebar();

    // Analytics log
    logSelection(exam.name, cat.name);

    // Reset upload area
    window.App?.resetUpload?.();
  }

  // ──────────────────────────────────────────────────────────
  // Render Spec Panel
  // ──────────────────────────────────────────────────────────
  function renderSpecPanel(cat, exam, type = 'photo') {
    const panel       = document.getElementById('spec-panel');
    const placeholder = document.getElementById('spec-placeholder');
    if (!panel || !placeholder) return;

    const spec = exam[type]; // photo or signature
    if (!spec) return;

    placeholder.classList.add('hidden');
    panel.classList.remove('hidden');

    // Background chip
    const bgDot   = spec.bgColor === 'white' ? '#fff' : spec.bgColor === 'blue' ? '#003580' : '#888';
    const bgLabel = spec.bgRequired
      ? `${spec.bgColor.charAt(0).toUpperCase() + spec.bgColor.slice(1)} bg required`
      : 'Any background';

    panel.innerHTML = `
      <div class="spec-panel-header">
        <div class="spec-panel-title">
          <h2>${exam.fullName}</h2>
          <div class="spec-panel-meta">
            <span class="badge badge-primary">${cat.name}</span>
            <span class="spec-verified">
              ✓ Verified ${exam.lastVerified || 'recently'}
            </span>
          </div>
        </div>
        <div class="spec-panel-actions">
          ${spec.bgRequired ? `
            <div class="spec-bg-chip" title="Background requirement">
              <span class="spec-bg-dot" style="background:${bgDot}"></span>
              <span>${bgLabel}</span>
            </div>
          ` : ''}
          <a href="${exam.officialLink}" target="_blank" rel="noopener"
             class="btn btn-secondary text-xs" style="padding:6px 12px;">
            📄 Official
          </a>
        </div>
      </div>

      <div class="spec-grid">
        <div class="spec-item highlight">
          <span class="spec-label">Max Size</span>
          <span class="spec-value">${spec.maxSizeKB} KB</span>
        </div>
        <div class="spec-item highlight">
          <span class="spec-label">Min Size</span>
          <span class="spec-value">${spec.minSizeKB} KB</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">Width</span>
          <span class="spec-value">${spec.widthPx} px</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">Height</span>
          <span class="spec-value">${spec.heightPx} px</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">Format</span>
          <span class="spec-value">${spec.format}</span>
        </div>
        <div class="spec-item" style="border-color: ${spec.bgRequired ? 'rgba(108,99,255,0.3)' : ''}">
          <span class="spec-label">Background</span>
          <span class="spec-value" style="display:flex;align-items:center;gap:6px;">
            <span style="width:12px;height:12px;border-radius:50%;background:${bgDot};border:1px solid rgba(255,255,255,0.2);display:inline-block;"></span>
            ${spec.bgColor.charAt(0).toUpperCase() + spec.bgColor.slice(1)}
          </span>
        </div>
      </div>

      ${spec.notes ? `
        <div class="divider"></div>
        <p class="text-xs text-muted" style="line-height:1.6;">
          📌 ${spec.notes}
        </p>
      ` : ''}
    `;

    panel.className = 'spec-panel animate-fade-in';
  }

  // ──────────────────────────────────────────────────────────
  // Getters
  // ──────────────────────────────────────────────────────────
  function getCurrentSpec(type = 'photo') {
    return _current?.exam?.[type] || null;
  }

  function getCurrentExam() {
    return _current;
  }

  // ──────────────────────────────────────────────────────────
  // Analytics (fire-and-forget)
  // ──────────────────────────────────────────────────────────
  function logSelection(examName, categoryName) {
    fetch('/api/log-analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exam: examName, category: categoryName }),
    }).catch(() => {}); // silent fail
  }

  // ──────────────────────────────────────────────────────────
  // Mobile sidebar helpers
  // ──────────────────────────────────────────────────────────
  function closeMobileSidebar() {
    document.getElementById('sidebar')?.classList.remove('mobile-open');
    document.getElementById('sidebar-overlay')?.classList.remove('visible');
  }

  return {
    load,
    buildSidebar,
    initSearch,
    selectExam,
    renderSpecPanel,
    getCurrentSpec,
    getCurrentExam,
  };
})();

window.ExamData = ExamData;
