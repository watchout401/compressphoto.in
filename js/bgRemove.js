/**
 * bgRemove.js — Client-Side Background Removal (100% FREE, No API Key)
 *
 * Uses @imgly/background-removal — an open-source WASM + AI library
 * that runs ENTIRELY in the user's browser. No server, no API key,
 * no privacy risk, no cost — ever.
 *
 * Flow:
 * 1. Lazy-load the @imgly library from CDN on first use
 * 2. Pre-resize image to max 1200px (faster processing)
 * 3. Run AI background removal in browser (WebAssembly)
 * 4. Fill transparent PNG with required solid color on canvas
 * 5. Return final Blob for the compress step
 *
 * First run: ~5–10 sec model download (~40MB, cached by browser)
 * Subsequent runs: ~3–5 sec on mid-range, instant on high-end
 */

const BgRemove = (() => {

  const IMGLY_CDN_URL  = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.6.0/+esm';
  const MAX_DIM_BEFORE = 1200;  // Pre-resize before AI processing (faster, less RAM)
  const MAX_FILE_MB    = 15;

  let _removeBackgroundFn = null;  // Cached after first import
  let _modelLoading       = false;
  let _modelLoaded        = false;

  // ──────────────────────────────────────────────────────────
  // Lazy-load the @imgly library (only when needed)
  // ──────────────────────────────────────────────────────────
  async function loadLibrary(onProgress) {
    if (_removeBackgroundFn) return _removeBackgroundFn;

    if (_modelLoading) {
      // Wait for ongoing load
      return new Promise((resolve) => {
        const check = setInterval(() => {
          if (_removeBackgroundFn) {
            clearInterval(check);
            resolve(_removeBackgroundFn);
          }
        }, 200);
      });
    }

    _modelLoading = true;
    onProgress(5, 'Loading AI model (first time ~10s, then cached)...');

    try {
      const module = await import(IMGLY_CDN_URL);
      _removeBackgroundFn = module.removeBackground;
      _modelLoaded = true;
      onProgress(25, 'AI model ready!');
      return _removeBackgroundFn;
    } catch (err) {
      _modelLoading = false;
      throw new Error('Failed to load AI model. Check your internet connection.');
    }
  }

  // ──────────────────────────────────────────────────────────
  // Pre-resize image before AI processing (speeds up 3–4x)
  // ──────────────────────────────────────────────────────────
  async function preResize(file) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(url);
        const { naturalWidth: w, naturalHeight: h } = img;

        if (w <= MAX_DIM_BEFORE && h <= MAX_DIM_BEFORE) {
          resolve(file); // Already small enough
          return;
        }

        const ratio = Math.min(MAX_DIM_BEFORE / w, MAX_DIM_BEFORE / h);
        const newW  = Math.round(w * ratio);
        const newH  = Math.round(h * ratio);

        const canvas = document.createElement('canvas');
        canvas.width  = newW;
        canvas.height = newH;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, newW, newH);

        canvas.toBlob(blob => resolve(blob || file), 'image/jpeg', 0.93);
      };

      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  // ──────────────────────────────────────────────────────────
  // Fill a transparent PNG with a solid background color
  // ──────────────────────────────────────────────────────────
  async function fillBackground(transparentBlob, hexColor) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(transparentBlob);

      img.onload = () => {
        URL.revokeObjectURL(url);

        const canvas = document.createElement('canvas');
        canvas.width  = img.naturalWidth  || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');

        // 1. Fill solid background
        ctx.fillStyle = hexColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 2. Draw transparent subject on top
        ctx.drawImage(img, 0, 0);

        canvas.toBlob(blob => {
          if (blob) resolve(blob);
          else      reject(new Error('Canvas fillBackground toBlob failed'));
        }, 'image/png');
      };

      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load transparent image')); };
      img.src = url;
    });
  }

  // ──────────────────────────────────────────────────────────
  // Resolve color name → hex
  // ──────────────────────────────────────────────────────────
  function resolveHex(bgColor) {
    const map = {
      white: '#FFFFFF',
      blue:  '#003580',
      cream: '#FFFDD0',
      grey:  '#F5F5F5',
      gray:  '#F5F5F5',
    };
    if (!bgColor) return '#FFFFFF';
    if (bgColor.startsWith('#')) return bgColor;
    return map[bgColor.toLowerCase()] || '#FFFFFF';
  }

  // ──────────────────────────────────────────────────────────
  // Public API: Remove background and fill with solid color
  // ──────────────────────────────────────────────────────────

  /**
   * @param {File|Blob} file      - Original image
   * @param {string}    bgColor   - 'white' | 'blue' | '#hex'
   * @param {function}  onProgress - (percent, label) => void
   * @returns {Promise<Blob>}      - Final image with solid background
   */
  async function removeAndReplace(file, bgColor, onProgress = () => {}) {

    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      throw new Error(`File too large. Max ${MAX_FILE_MB}MB.`);
    }

    // Step 1: Load library (lazy, cached after first load)
    const removeBackground = await loadLibrary(onProgress);
    onProgress(25, 'Pre-processing image...');

    // Step 2: Pre-resize before AI (3–4x faster processing)
    const resized = await preResize(file);
    onProgress(35, 'Running AI background removal...');

    // Step 3: Run AI removal in browser (WASM)
    // This returns a transparent PNG Blob
    let transparentBlob;
    try {
      transparentBlob = await removeBackground(resized, {
        // Use the small model for speed on low-end devices
        // 'small' model = ~5MB, good for passport photos
        // 'medium' model = ~40MB, better for complex backgrounds
        model: 'small',
        output: {
          format: 'image/png',
          quality: 1.0,  // Lossless — quality must not be degraded here
        },
      });
    } catch (aiErr) {
      console.error('AI removal error:', aiErr);
      throw new Error('Background removal failed. Please try a photo with a simpler background.');
    }

    onProgress(80, 'Filling background color...');

    // Step 4: Fill with required solid color
    const hexColor   = resolveHex(bgColor);
    const finalBlob  = await fillBackground(transparentBlob, hexColor);

    onProgress(100, 'Background replaced!');

    return finalBlob;
  }

  // ──────────────────────────────────────────────────────────
  // Check if library is already loaded (for UI hints)
  // ──────────────────────────────────────────────────────────
  function isModelLoaded() {
    return _modelLoaded;
  }

  return { removeAndReplace, isModelLoaded };
})();

window.BgRemove = BgRemove;

