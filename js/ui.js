/**
 * ui.js — UI Interactions
 * Progress bar, smooth scroll, before/after display, toasts
 */

const UI = (() => {

  // ──────────────────────────────────────────────────────────
  // Progress Bar
  // ──────────────────────────────────────────────────────────
  const steps = [
    { id: 'step-detect',   label: 'Analysing background color...' },
    { id: 'step-remove',   label: 'Processing background on your device...' },
    { id: 'step-compress', label: 'Compressing & resizing...' },
    { id: 'step-done',     label: 'Finalising output...' },
  ];

  function showProgress() {
    const section = document.getElementById('progress-section');
    if (section) {
      section.classList.add('visible');
      setProgress(0, steps[0].label);
    }
  }

  function hideProgress() {
    const section = document.getElementById('progress-section');
    if (section) section.classList.remove('visible');
  }

  function setProgress(pct, label = '') {
    const fill  = document.getElementById('progress-fill');
    const pctEl = document.getElementById('progress-pct');
    const lblEl = document.getElementById('progress-label-text');

    if (fill)  fill.style.width  = `${Math.min(100, Math.max(0, pct))}%`;
    if (pctEl) pctEl.textContent = `${Math.round(pct)}%`;
    if (lblEl && label) lblEl.textContent = label;

    // Update step indicators
    updateSteps(pct);
  }

  function updateSteps(pct) {
    const thresholds = [0, 25, 60, 85, 100];

    steps.forEach((step, idx) => {
      const el = document.getElementById(step.id);
      if (!el) return;

      if (pct >= thresholds[idx + 1]) {
        el.className = 'progress-step complete';
        el.querySelector('.step-dot').textContent = '✓';
      } else if (pct >= thresholds[idx]) {
        el.className = 'progress-step active';
        el.querySelector('.step-dot').textContent = '';
      } else {
        el.className = 'progress-step';
        el.querySelector('.step-dot').textContent = '';
      }
    });
  }

  // Animate progress smoothly from current to target
  function animateTo(targetPct, label, durationMs = 500) {
    const fill  = document.getElementById('progress-fill');
    const pctEl = document.getElementById('progress-pct');
    const lblEl = document.getElementById('progress-label-text');

    const currentWidth = parseFloat(fill?.style.width || '0');
    const start  = performance.now();
    const delta  = targetPct - currentWidth;

    if (lblEl && label) lblEl.textContent = label;

    function tick(now) {
      const elapsed  = now - start;
      const progress = Math.min(elapsed / durationMs, 1);
      // Ease out
      const eased  = 1 - Math.pow(1 - progress, 3);
      const current = currentWidth + delta * eased;

      if (fill)  fill.style.width  = `${current}%`;
      if (pctEl) pctEl.textContent = `${Math.round(current)}%`;
      updateSteps(current);

      if (progress < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }

  // ──────────────────────────────────────────────────────────
  // Result Display
  // ──────────────────────────────────────────────────────────
  function showResult(data) {
    /*
    data = {
      originalFile:  File,
      result:        { jpeg: {...}, png: {...}, widthPx, heightPx },
      spec:          exam spec object,
      exam:          exam name,
      bgWasRemoved:  boolean,
    }
    */
    const section = document.getElementById('result-section');
    if (!section) return;

    const { originalFile, result, spec, exam, bgWasRemoved } = data;
    const origSizeKB = Math.round(originalFile.size / 1024 * 10) / 10;
    const finalSizeKB = result.jpeg.sizeKB;
    const savedPct  = Math.round((1 - finalSizeKB / origSizeKB) * 100);

    // Before image
    const beforeImg = document.getElementById('before-img');
    if (beforeImg) {
      beforeImg.src = URL.createObjectURL(originalFile);
    }

    // After image (show JPEG by default)
    const afterImg = document.getElementById('after-img');
    if (afterImg) {
      afterImg.src = result.jpeg.objectUrl;
    }

    // Before stats — File objects don't have .width/.height, need to read from image
    setText('before-size', `${origSizeKB} KB`);
    setText('before-dims', '...');
    setText('before-fmt',  originalFile.type.replace('image/', '').toUpperCase());

    // Read actual dimensions from original image
    const beforeImgEl = document.getElementById('before-img');
    if (beforeImgEl) {
      const origUrl = URL.createObjectURL(originalFile);
      beforeImgEl.onload = () => {
        setText('before-dims', `${beforeImgEl.naturalWidth} × ${beforeImgEl.naturalHeight} px`);
        URL.revokeObjectURL(origUrl);
      };
      beforeImgEl.src = origUrl;
    }

    // After stats
    setText('after-size',  `${finalSizeKB} KB`);
    setText('after-dims',  `${result.widthPx} × ${result.heightPx} px`);
    setText('after-fmt',   spec.format);
    setText('after-quality', `${result.jpeg.qualityPercent}%`);

    // Savings banner
    setText('savings-from-to', `${origSizeKB} KB → ${finalSizeKB} KB`);
    setText('savings-pct',     `${savedPct}% smaller`);

    // Quality badge
    const qBadge = document.getElementById('quality-badge');
    if (qBadge) {
      if (result.jpeg.qualityPercent >= 90) {
        qBadge.className = 'quality-badge excellent';
        qBadge.querySelector('.quality-label').textContent = 'Excellent Quality';
      } else if (result.jpeg.qualityPercent >= 78) {
        qBadge.className = 'quality-badge good';
        qBadge.querySelector('.quality-label').textContent = 'Good Quality';
      } else {
        qBadge.className = 'quality-badge';
        qBadge.querySelector('.quality-label').textContent = 'Acceptable Quality';
      }
    }

    // Download buttons
    const dlJpeg = document.getElementById('btn-download-jpeg');
    const dlPng  = document.getElementById('btn-download-png');

    if (dlJpeg) {
      dlJpeg.onclick = () => download(result.jpeg.objectUrl, `${exam.replace(/\s+/g,'_')}_photo.jpg`);
    }
    if (dlPng) {
      dlPng.onclick  = () => download(result.png.objectUrl,  `${exam.replace(/\s+/g,'_')}_photo.png`);
    }

    // BG removed badge
    const bgTag = document.getElementById('bg-removed-tag');
    if (bgTag) bgTag.classList.toggle('hidden', !bgWasRemoved);

    // Official link
    const offLink = document.getElementById('result-official-link');
    if (offLink && spec.officialLink) {
      offLink.href = spec.officialLink;
    }

    // Below-min warning banner
    const belowMinBanner = document.getElementById('below-min-banner');
    if (belowMinBanner) {
      if (result.jpeg.belowMin) {
        belowMinBanner.classList.remove('hidden');
        belowMinBanner.textContent =
          `⚠️ Output is ${result.jpeg.sizeKB} KB — below the ${result.minSizeKB} KB minimum. ` +
          `Your image (${result.widthPx}×${result.heightPx}px) is physically too small to store more data. ` +
          `Consider using a higher-resolution original photo (e.g. from a DSLR or 12MP+ phone camera).`;
      } else {
        belowMinBanner.classList.add('hidden');
      }
    }

    // Show section + scroll
    section.classList.add('visible');
    setTimeout(() => scrollTo(section), 300);
  }

  function hideResult() {
    const section = document.getElementById('result-section');
    if (section) section.classList.remove('visible');
  }

  // ──────────────────────────────────────────────────────────
  // Smooth Scroll
  // ──────────────────────────────────────────────────────────
  function scrollTo(el) {
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ──────────────────────────────────────────────────────────
  // Toast Notifications
  // ──────────────────────────────────────────────────────────
  function toast(message, type = 'info', durationMs = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };

    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <span>${message}</span>
    `;

    container.appendChild(el);

    setTimeout(() => {
      el.style.animation = 'none';
      el.style.opacity   = '0';
      el.style.transform = 'translateX(20px)';
      el.style.transition = 'opacity 0.3s, transform 0.3s';
      setTimeout(() => el.remove(), 350);
    }, durationMs);
  }

  // ──────────────────────────────────────────────────────────
  // BG Check Chip
  // ──────────────────────────────────────────────────────────
  function showBgCheckResult(match, bgColor) {
    const chip = document.getElementById('bg-check-chip');
    if (!chip) return;

    chip.classList.remove('hidden', 'match', 'no-match', 'checking');

    if (match === null) {
      chip.className = 'bg-check-chip checking';
      chip.textContent = '⏳ Checking background color...';
    } else if (match) {
      chip.className = 'bg-check-chip match';
      chip.textContent = `✅ ${bgColor.charAt(0).toUpperCase() + bgColor.slice(1)} background detected — no extra processing needed`;
    } else {
      chip.className = 'bg-check-chip no-match';
      chip.textContent = `🖥️ Background will be changed to ${bgColor} using your device's processing power (private & offline)`;
    }
  }

  function hideBgCheckChip() {
    const chip = document.getElementById('bg-check-chip');
    if (chip) chip.classList.add('hidden');
  }

  // ──────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────
  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function download(url, filename) {
    const a = document.createElement('a');
    a.href     = url;
    a.download = filename;  // Sets the saved filename including extension
    a.rel      = 'noopener';
    a.style.display = 'none';

    // MUST be in DOM for Safari + Chrome to respect the download attribute
    document.body.appendChild(a);
    a.click();
    // Short delay before removal ensures the click is processed
    setTimeout(() => document.body.removeChild(a), 150);

    toast('Download started! 🎉', 'success');
  }

  return {
    showProgress, hideProgress, setProgress, animateTo,
    showResult, hideResult,
    toast, scroll: scrollTo,
    showBgCheckResult, hideBgCheckChip,
  };
})();

window.UI = UI;
