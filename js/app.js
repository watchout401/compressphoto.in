/**
 * app.js — Main Orchestrator
 * Ties together: ExamData, BgDetect, BgRemove, Compress, UI, Share
 *
 * Flow:
 * 1. User selects exam → spec panel shown
 * 2. User uploads photo → preview + bg check
 * 3. User clicks Compress:
 *    a. Show progress
 *    b. If bg needed & doesn't match → BgRemove.removeAndReplace()
 *    c. Compress.compressBothFormats()
 *    d. UI.showResult()
 *    e. Smooth scroll
 */

const App = (() => {

  let _currentFile       = null;
  let _currentFileBuffer = null;  // Full ArrayBuffer, read via FileReader
  let _processedBlob     = null;
  let _lastResult        = null;
  let _activeTab         = 'photo';
  let _uploadOriginalKB  = 0;
  let _examSelected      = false;  // Gate: must select exam before uploading

  // ──────────────────────────────────────────────────────────
  // Init
  // ──────────────────────────────────────────────────────────
  async function init() {
    await ExamData.buildSidebar();
    ExamData.initSearch();

    lockUpload();  // Start locked until exam selected
    setupUploadZone();
    setupTabSwitcher();
    setupMobileSidebar();
    setupCompressButton();
    setupProcessAgain();
  }

  // ──────────────────────────────────────────────────────────
  // Upload Lock / Unlock (gate: exam must be selected first)
  // ──────────────────────────────────────────────────────────
  function lockUpload() {
    _examSelected = false;
    const overlay = document.getElementById('upload-lock-overlay');
    if (overlay) overlay.style.display = 'flex';
    const btn = document.getElementById('btn-compress');
    if (btn) btn.disabled = true;
  }

  function unlockUpload() {
    _examSelected = true;
    const overlay = document.getElementById('upload-lock-overlay');
    if (overlay) overlay.style.display = 'none';
    // Compress button only unlocks after file is also chosen
  }

  // ──────────────────────────────────────────────────────────
  // Tab Switcher (Photo ↔ Signature)
  // ──────────────────────────────────────────────────────────
  function setupTabSwitcher() {
    const tabs = document.querySelectorAll('.header-tab, .mobile-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const type = tab.dataset.tab;
        if (!type) return;

        tabs.forEach(t => t.classList.remove('active'));
        document.querySelectorAll(`[data-tab="${type}"]`).forEach(t => t.classList.add('active'));

        _activeTab = type;

        // Re-render spec panel for the new tab
        const current = ExamData.getCurrentExam();
        if (current) {
          ExamData.renderSpecPanel(current.category, current.exam, type);
        }

        // Reset upload for new tab
        resetUpload();
      });
    });
  }

  // ──────────────────────────────────────────────────────────
  // Upload Zone
  // ──────────────────────────────────────────────────────────
  function setupUploadZone() {
    const zone      = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');
    const removeBtn = document.getElementById('preview-remove-btn');

    if (!zone || !fileInput) return;

    // Click to open file picker (only if exam is selected + not clicking remove btn)
    zone.addEventListener('click', (e) => {
      if (!_examSelected) return;  // Locked
      if (e.target === removeBtn || removeBtn?.contains(e.target)) return;

      // Check if clicking the specific camera button
      if (e.target.closest('#btn-camera')) {
        document.getElementById('camera-input')?.click();
        return;
      }

      // Default: browse files
      fileInput.click();
    });

    // File input change
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) handleFileSelected(file);
      fileInput.value = '';
    });

    // Camera input change
    const cameraInput = document.getElementById('camera-input');
    if (cameraInput) {
      cameraInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (file) handleFileSelected(file);
        cameraInput.value = '';
      });
    }

    // Drag & drop
    zone.addEventListener('dragover',  (e) => {
      e.preventDefault();
      if (_examSelected) zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', (e) => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      if (!_examSelected) return;
      const file = e.dataTransfer.files?.[0];
      if (file) handleFileSelected(file);
    });

    // Remove preview
    removeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      resetUpload();
    });
  }

  async function handleFileSelected(file) {
    // Validate type
    if (!file.type.startsWith('image/')) {
      UI.toast('Please upload an image file (JPEG, PNG, etc.)', 'error');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      UI.toast('File too large. Please upload an image under 15MB.', 'error');
      return;
    }

    _currentFile      = null;  // Reset until read completes
    _currentFileBuffer = null;
    _processedBlob    = null;
    _uploadOriginalKB = Math.round(file.size / 1024 * 10) / 10;

    // Disable compress button & hide previous results
    const btn = document.getElementById('btn-compress');
    if (btn) btn.disabled = true;
    UI.hideResult();
    UI.hideBgCheckChip();

    // Show reading progress bar
    const uploadContent = document.getElementById('upload-content');
    const readWrap      = document.getElementById('upload-read-wrap');
    const readFill      = document.getElementById('upload-read-fill');
    const readPct       = document.getElementById('upload-read-pct');
    const previewWrap   = document.getElementById('preview-wrap');

    uploadContent?.classList.add('hidden');
    previewWrap?.classList.remove('visible'); // hide old preview
    if (readWrap) readWrap.style.display = 'flex';
    if (readFill) readFill.style.width = '0%';
    if (readPct)  readPct.textContent  = '0%';

    // Read file with real progress events
    try {
      await readFileWithProgress(file, (pct) => {
        if (readFill) readFill.style.width = pct + '%';
        if (readPct)  readPct.textContent  = Math.round(pct) + '%';
      });
    } catch (err) {
      if (readWrap) readWrap.style.display = 'none';
      uploadContent?.classList.remove('hidden');
      UI.toast('Could not read the image file.', 'error');
      return;
    }

    // Reading done — hide bar
    await sleep(250);  // Brief pause so user sees 100%
    if (readWrap) readWrap.style.display = 'none';

    // ── FAST PRE-SCALE: Prevent RAM crashes on high-megapixel cameras
    try {
      const scaledBlob = await Compress.preScale(file, 1800);
      if (scaledBlob !== file) {
        // Reconstruct File object to keep filename for preview
        file = new File([scaledBlob], file.name || 'image.jpg', {
          type: scaledBlob.type,
          lastModified: Date.now()
        });
      }
    } catch (e) {
      console.warn("Pre-scaling failed, falling back to original", e);
    }

    _currentFile = file;
    showPreview(file);

    // Background check
    const spec = ExamData.getCurrentSpec(_activeTab);
    if (spec?.bgRequired && spec?.bgColor) {
      UI.showBgCheckResult(null, spec.bgColor);
      try {
        const checkResult = await BgDetect.check(file, spec.bgColor);
        UI.showBgCheckResult(checkResult.match, spec.bgColor);
      } catch (e) {
        UI.hideBgCheckChip();
      }
    }

    // Enable compress button only now
    if (btn) btn.disabled = false;
  }

  // Read progress using FileReader with progress events
  function readFileWithProgress(file, onProgress) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress((e.loaded / e.total) * 100);
        }
      };

      reader.onload = () => {
        onProgress(100);
        resolve(reader.result);
      };

      reader.onerror = () => reject(new Error('FileReader error'));

      // readAsArrayBuffer gives real progress events, fast for any size
      reader.readAsArrayBuffer(file);
    });
  }

  function showPreview(file) {
    const zone       = document.getElementById('upload-zone');
    const uploadContent = document.getElementById('upload-content');
    const previewWrap   = document.getElementById('preview-wrap');
    const previewImg    = document.getElementById('preview-img');
    const previewName   = document.getElementById('preview-filename');
    const previewSize   = document.getElementById('preview-filesize');

    const url = URL.createObjectURL(file);

    if (previewImg) {
      previewImg.src = url;
      previewImg.onload = () => URL.revokeObjectURL(url);
    }

    if (previewName) previewName.textContent = file.name;
    if (previewSize) previewSize.textContent = `${_uploadOriginalKB} KB`;

    uploadContent?.classList.add('hidden');
    previewWrap?.classList.add('visible');
    zone?.classList.add('has-file');
  }

  // ──────────────────────────────────────────────────────────
  // Compress Button
  // ──────────────────────────────────────────────────────────
  function setupCompressButton() {
    const btn = document.getElementById('btn-compress');
    if (!btn) return;

    btn.addEventListener('click', async () => {
      if (!_currentFile) {
        UI.toast('Please upload a photo first.', 'warning');
        return;
      }

      const examCtx = ExamData.getCurrentExam();
      if (!examCtx) {
        UI.toast('Please select an exam from the left panel first.', 'warning');
        return;
      }

      const spec = examCtx.exam[_activeTab];
      if (!spec) {
        UI.toast(`No ${_activeTab} spec found for this exam.`, 'error');
        return;
      }

      await runCompressionPipeline(_currentFile, spec, examCtx);
    });
  }

  // ──────────────────────────────────────────────────────────
  // Main Compression Pipeline
  // ──────────────────────────────────────────────────────────
  async function runCompressionPipeline(file, spec, examCtx) {
    const btn = document.getElementById('btn-compress');
    if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner"></div> Processing...'; }

    UI.showProgress();
    UI.hideResult();

    let bgWasRemoved = false;
    let sourceBlob   = file;

    try {
      // ── Step 1: Check background (client-side, fast)
      UI.animateTo(15, 'Analysing background color...', 400);

      let needsBgRemoval = false;

      if (spec.bgRequired && spec.bgColor && spec.bgColor !== 'any') {
        const checkResult = await BgDetect.check(file, spec.bgColor);

        if (!checkResult.match && !checkResult.skipped) {
          needsBgRemoval = true;
        }
      }

      // ── Step 2: Background removal (server, only if needed)
      if (needsBgRemoval) {
        UI.animateTo(30, 'Sending to AI background removal...', 500);

        try {
          sourceBlob   = await BgRemove.removeAndReplace(
            file,
            spec.bgColor,
            (p, label) => UI.animateTo(30 + p * 0.32, label || 'Processing background (AI)...', 200)
          );
          bgWasRemoved = true;
          UI.animateTo(62, 'Background replaced ✅', 300);
        } catch (bgErr) {
          console.warn('Background removal failed, continuing without:', bgErr.message);
          UI.toast(`Background removal skipped: ${bgErr.message}`, 'warning');
          sourceBlob = file; // Fall back to original
        }
      } else {
        UI.animateTo(62, 'Background OK — skipping server step ✅', 500);
      }

      await sleep(300);

      // ── Step 3: Compress (client-side, high quality)
      UI.animateTo(70, 'Compressing & resizing (highest quality)...', 400);

      const result = await Compress.compressBothFormats(
        sourceBlob,
        spec,
        (p) => UI.animateTo(70 + p * 0.25, 'Compressing...', 150)
      );

      _lastResult = result;

      UI.animateTo(98, 'Finalising output...', 300);
      await sleep(400);
      UI.animateTo(100, 'Done! ✅', 200);
      await sleep(500);

      // ── Step 4: Show result
      UI.hideProgress();
      UI.showResult({
        originalFile: file,
        result,
        spec,
        exam:        examCtx.exam.name,
        bgWasRemoved,
      });

      // Wire share button
      const shareBtn = document.getElementById('btn-share');
      if (shareBtn) {
        shareBtn.onclick = () => Share.shareResult(
          examCtx.exam.name,
          _uploadOriginalKB,
          result.jpeg.sizeKB
        );
      }

      // Quality warning
      if (result.jpeg.qualityWarning) {
        UI.toast('⚠️ Photo was heavily compressed to meet the size limit. Quality may be slightly reduced.', 'warning', 6000);
      } else {
        UI.toast('Photo compressed with maximum quality! 🎉', 'success');
      }

    } catch (err) {
      console.error('Compression pipeline error:', err);
      UI.hideProgress();
      UI.toast(`Error: ${err.message}`, 'error', 6000);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '⚡ Compress Photo';
      }
    }
  }

  // ──────────────────────────────────────────────────────────
  // Reset
  // ──────────────────────────────────────────────────────────
  function resetUpload() {
    _currentFile       = null;
    _currentFileBuffer = null;
    _processedBlob     = null;
    _lastResult        = null;

    const zone          = document.getElementById('upload-zone');
    const uploadContent = document.getElementById('upload-content');
    const previewWrap   = document.getElementById('preview-wrap');
    const previewImg    = document.getElementById('preview-img');
    const readWrap      = document.getElementById('upload-read-wrap');
    const btn           = document.getElementById('btn-compress');

    if (previewImg) previewImg.src = '';
    uploadContent?.classList.remove('hidden');
    previewWrap?.classList.remove('visible');
    zone?.classList.remove('has-file', 'drag-over');
    if (readWrap) readWrap.style.display = 'none';
    if (btn) btn.disabled = true;

    UI.hideBgCheckChip();
    UI.hideProgress();
    UI.hideResult();
  }

  // ──────────────────────────────────────────────────────────
  // Process Again
  // ──────────────────────────────────────────────────────────
  function setupProcessAgain() {
    document.getElementById('btn-process-again')?.addEventListener('click', () => {
      UI.hideResult();
      resetUpload();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // ──────────────────────────────────────────────────────────
  // Mobile Sidebar
  // ──────────────────────────────────────────────────────────
  function setupMobileSidebar() {
    const hamburger = document.getElementById('hamburger-btn');
    const overlay   = document.getElementById('sidebar-overlay');
    const sidebar   = document.getElementById('sidebar');
    const mobileExamBtn = document.getElementById('mobile-exam-selector-btn');

    const open = () => {
      sidebar?.classList.add('mobile-open');
      overlay?.classList.add('visible');
    };
    const close = () => {
      sidebar?.classList.remove('mobile-open');
      overlay?.classList.remove('visible');
    };

    hamburger?.addEventListener('click', open);
    mobileExamBtn?.addEventListener('click', open);
    overlay?.addEventListener('click', close);
  }

  // ──────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  return { init, resetUpload, unlockUpload };
})();

window.App = App;
document.addEventListener('DOMContentLoaded', () => App.init());
