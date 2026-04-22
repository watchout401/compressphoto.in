/**
 * compress.js — High-quality client-side image compression
 *
 * KEY PRINCIPLE: We use binary search to find the HIGHEST quality
 * JPEG setting that still fits within the exam's size limit.
 * We NEVER arbitrarily degrade quality — we find the exact sweet spot.
 *
 * Quality floor: 0.78 (78%) — below this we warn but still try.
 * For resize: we use a high-DPI canvas with lanczos-like downsampling.
 */

const Compress = (() => {

  const QUALITY_CEILING = 0.97;   // Never go above this (diminishing returns file-size)
  const QUALITY_FLOOR   = 0.78;   // Warn if we have to go below this
  const MAX_ITERATIONS  = 14;     // Binary search max steps

  // ──────────────────────────────────────────────────────────
  // Load a File/Blob into an HTMLImageElement
  // ──────────────────────────────────────────────────────────
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = typeof src === 'string' ? src : URL.createObjectURL(src);
      const isBlob = typeof src !== 'string';

      img.onload = () => {
        if (isBlob) URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        if (isBlob) URL.revokeObjectURL(url);
        reject(new Error('Failed to load image'));
      };
      img.src = url;
    });
  }

  // ──────────────────────────────────────────────────────────
  // Draw image to canvas at target dimensions
  // Uses step-down downsampling for better quality on large reductions
  // ──────────────────────────────────────────────────────────
  function drawResized(img, targetW, targetH) {
    const srcW = img.naturalWidth  || img.width;
    const srcH = img.naturalHeight || img.height;

    // Step-down: if reducing by more than 50%, do it in steps
    let canvas = document.createElement('canvas');
    let ctx    = canvas.getContext('2d', { willReadFrequently: false });

    let curW = srcW;
    let curH = srcH;
    canvas.width  = curW;
    canvas.height = curH;
    ctx.imageSmoothingEnabled  = true;
    ctx.imageSmoothingQuality  = 'high';
    ctx.drawImage(img, 0, 0);

    // Stepwise halving until close to target
    while (curW > targetW * 2 || curH > targetH * 2) {
      const nextW = Math.max(Math.floor(curW / 2), targetW);
      const nextH = Math.max(Math.floor(curH / 2), targetH);

      const tmp    = document.createElement('canvas');
      tmp.width    = nextW;
      tmp.height   = nextH;
      const tmpCtx = tmp.getContext('2d');
      tmpCtx.imageSmoothingEnabled = true;
      tmpCtx.imageSmoothingQuality = 'high';
      tmpCtx.drawImage(canvas, 0, 0, nextW, nextH);

      canvas = tmp;
      ctx    = tmpCtx;
      curW   = nextW;
      curH   = nextH;
    }

    // Final draw to exact target size
    const final    = document.createElement('canvas');
    final.width    = targetW;
    final.height   = targetH;
    const finalCtx = final.getContext('2d');
    finalCtx.imageSmoothingEnabled = true;
    finalCtx.imageSmoothingQuality = 'high';
    finalCtx.drawImage(canvas, 0, 0, targetW, targetH);

    return final;
  }

  // ──────────────────────────────────────────────────────────
  // Convert canvas to Blob at given quality
  // ──────────────────────────────────────────────────────────
  function canvasToBlob(canvas, format, quality) {
    return new Promise((resolve, reject) => {
      const mimeType = format === 'PNG' ? 'image/png' : 'image/jpeg';
      // PNG quality param is ignored (lossless), but we still pass it
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')),
        mimeType,
        quality
      );
    });
  }

  // ──────────────────────────────────────────────────────────
  // Binary search for highest quality within size limits
  // Respects BOTH maxSizeKB and minSizeKB constraints
  // ──────────────────────────────────────────────────────────
  async function findBestQuality(canvas, format, maxSizeKB, minSizeKB) {
    // PNG is lossless — just output and report if out of range
    if (format === 'PNG') {
      const blob    = await canvasToBlob(canvas, 'PNG', 1.0);
      const sizeKB  = blob.size / 1024;
      const rounded = Math.round(sizeKB * 10) / 10;
      return {
        blob,
        quality:       1.0,
        sizeKB:        rounded,
        withinTarget:  sizeKB <= maxSizeKB,
        belowMin:      minSizeKB && sizeKB < minSizeKB,
        qualityWarning: false,
        qualityPercent: 100,
      };
    }

    // ── JPEG Phase 1: Check at absolute top quality (1.0)
    // If even 100% quality gives < minSizeKB, image is inherently tiny
    // (e.g. 200×230px can't physically hold 20KB of data sometimes)
    const absoluteTopBlob  = await canvasToBlob(canvas, 'JPEG', 1.0);
    const absoluteTopKB    = absoluteTopBlob.size / 1024;

    if (absoluteTopKB < (minSizeKB || 0)) {
      // Cannot reach minimum even at 100% quality — inherently small image
      return {
        blob:          absoluteTopBlob,
        quality:       1.0,
        sizeKB:        Math.round(absoluteTopKB * 10) / 10,
        withinTarget:  absoluteTopKB <= maxSizeKB,
        belowMin:      true,
        qualityWarning: false,
        qualityPercent: 100,
      };
    }

    // ── JPEG Phase 2: Check at QUALITY_CEILING first
    const topBlob = await canvasToBlob(canvas, 'JPEG', QUALITY_CEILING);
    const topKB   = topBlob.size / 1024;

    // Perfect case: fits within max AND meets min at our ceiling quality
    if (topKB <= maxSizeKB && topKB >= (minSizeKB || 0)) {
      return {
        blob:          topBlob,
        quality:       QUALITY_CEILING,
        sizeKB:        Math.round(topKB * 10) / 10,
        withinTarget:  true,
        belowMin:      false,
        qualityWarning: false,
        qualityPercent: Math.round(QUALITY_CEILING * 100),
      };
    }

    // ── JPEG Phase 3: Image fits under max at ceiling but is BELOW min
    // Push quality UP from ceiling toward 1.0 to increase file size
    if (topKB < (minSizeKB || 0)) {
      let low  = QUALITY_CEILING;
      let high = 1.0;
      let best = absoluteTopBlob;  // fallback = 100% quality
      let bestQ = 1.0;

      for (let i = 0; i < 10; i++) {
        const mid    = (low + high) / 2;
        const blob   = await canvasToBlob(canvas, 'JPEG', mid);
        const sizeKB = blob.size / 1024;

        if (sizeKB <= maxSizeKB) {
          best  = blob;
          bestQ = mid;
          if (sizeKB >= (minSizeKB || 0)) break;  // In target range!
          low = mid;   // Still below min, go higher
        } else {
          high = mid;  // Overshot max, go lower
        }
      }

      const finalKB = best.size / 1024;
      return {
        blob:          best,
        quality:       bestQ,
        sizeKB:        Math.round(finalKB * 10) / 10,
        withinTarget:  finalKB <= maxSizeKB,
        belowMin:      finalKB < (minSizeKB || 0),
        qualityWarning: false,
        qualityPercent: Math.round(bestQ * 100),
      };
    }

    // ── JPEG Phase 4: Normal case — too big at ceiling, binary search DOWN
    let low   = 0.50;
    let high  = QUALITY_CEILING;
    let best  = null;
    let bestQ = QUALITY_CEILING;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const mid    = (low + high) / 2;
      const blob   = await canvasToBlob(canvas, 'JPEG', mid);
      const sizeKB = blob.size / 1024;

      if (sizeKB <= maxSizeKB) {
        best  = blob;
        bestQ = mid;
        low   = mid;  // Try higher quality
        if (Math.abs(sizeKB - maxSizeKB) < 1.5) break;  // Close enough
      } else {
        high = mid;
      }
    }

    if (!best) {
      best  = await canvasToBlob(canvas, 'JPEG', low);
      bestQ = low;
    }

    const finalKB = best.size / 1024;
    return {
      blob:          best,
      quality:       bestQ,
      sizeKB:        Math.round(finalKB * 10) / 10,
      withinTarget:  finalKB <= maxSizeKB,
      belowMin:      minSizeKB && finalKB < minSizeKB,
      qualityWarning: bestQ < QUALITY_FLOOR,
      qualityPercent: Math.round(bestQ * 100),
    };
  }

  // ──────────────────────────────────────────────────────────
  // Public: compress an image to exam specs
  // ──────────────────────────────────────────────────────────

  /**
   * @param {File|Blob|string} source   - Original image (File, Blob, or data URL)
   * @param {object}           spec     - Exam photo spec
   * @param {number}           spec.widthPx
   * @param {number}           spec.heightPx
   * @param {number}           spec.maxSizeKB
   * @param {number}           spec.minSizeKB
   * @param {string}           spec.format     - 'JPEG' | 'PNG'
   * @param {function}         onProgress      - Optional progress callback(0–100)
   * @returns {Promise<CompressResult>}
   */
  async function compress(source, spec, onProgress = () => {}) {
    onProgress(5);

    // Load source image
    const img = await loadImage(source);
    onProgress(20);

    // Resize with high-quality step-down
    const canvas = drawResized(img, spec.widthPx, spec.heightPx);
    onProgress(45);

    // Find best quality that fits within file size
    const result = await findBestQuality(
      canvas,
      spec.format,
      spec.maxSizeKB,
      spec.minSizeKB
    );
    onProgress(90);

    // Generate object URL for download
    const objectUrl = URL.createObjectURL(result.blob);
    onProgress(100);

    return {
      blob:          result.blob,
      objectUrl,
      sizeKB:        result.sizeKB,
      widthPx:       spec.widthPx,
      heightPx:      spec.heightPx,
      format:        spec.format,
      quality:       result.quality,
      qualityPercent: result.qualityPercent || Math.round(result.quality * 100),
      qualityWarning: result.qualityWarning,
      withinTarget:  result.withinTarget,
    };
  }

  /**
   * Compress for BOTH JPEG and PNG output simultaneously
   */
  async function compressBothFormats(source, spec, onProgress = () => {}) {
    onProgress(5);
    const img = await loadImage(source);
    onProgress(15);
    const canvas = drawResized(img, spec.widthPx, spec.heightPx);
    onProgress(40);

    const [jpegResult, pngResult] = await Promise.all([
      findBestQuality(canvas, 'JPEG', spec.maxSizeKB, spec.minSizeKB),
      findBestQuality(canvas, 'PNG',  spec.maxSizeKB * 3, spec.minSizeKB),
    ]);
    onProgress(95);

    return {
      jpeg: {
        blob:           jpegResult.blob,
        objectUrl:      URL.createObjectURL(jpegResult.blob),
        sizeKB:         jpegResult.sizeKB,
        qualityPercent: jpegResult.qualityPercent || Math.round((jpegResult.quality || 0.9) * 100),
        qualityWarning: jpegResult.qualityWarning,
        belowMin:       jpegResult.belowMin || false,
      },
      png: {
        blob:           pngResult.blob,
        objectUrl:      URL.createObjectURL(pngResult.blob),
        sizeKB:         pngResult.sizeKB,
        qualityPercent: 100,
        qualityWarning: false,
        belowMin:       pngResult.belowMin || false,
      },
      widthPx:         spec.widthPx,
      heightPx:        spec.heightPx,
      minSizeKB:       spec.minSizeKB,
      maxSizeKB:       spec.maxSizeKB,
    };
  }

  /**
   * Free object URLs to prevent memory leaks
   */
  function revokeUrls(...urls) {
    urls.forEach(u => { if (u) URL.revokeObjectURL(u); });
  }

  return { compress, compressBothFormats, revokeUrls };
})();

window.Compress = Compress;
