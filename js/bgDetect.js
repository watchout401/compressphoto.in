/**
 * bgDetect.js — Client-side background color detection
 * Samples corner pixels of an image to check if background
 * already matches the required exam color.
 * NO server calls here. Pure canvas pixel reading.
 */

const BgDetect = (() => {

  // ──────────────────────────────────────────────────────────
  // Config
  // ──────────────────────────────────────────────────────────
  const SAMPLE_OFFSET = 8;       // px from edge to sample
  const TOLERANCE     = 35;      // RGB tolerance (0-255)

  // Known background colors
  const BG_DEFINITIONS = {
    white: { r: 255, g: 255, b: 255 },
    blue:  { r:   0, g:  53, b: 128 },  // standard "passport blue"
    any:   null
  };

  // ──────────────────────────────────────────────────────────
  // Draw image to an offscreen canvas and return context
  // ──────────────────────────────────────────────────────────
  async function getImagePixels(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width  = img.naturalWidth;
        canvas.height = img.naturalHeight;

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        resolve({ ctx, width: canvas.width, height: canvas.height });
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image for background check'));
      };

      img.src = url;
    });
  }

  // ──────────────────────────────────────────────────────────
  // Get average RGB from a set of sample points
  // ──────────────────────────────────────────────────────────
  function samplePixels(ctx, width, height) {
    const o = SAMPLE_OFFSET;

    // Sample 7 points — corners + top-center + left/right mid
    // Deliberately AVOID the center (that's the face)
    const points = [
      { x: o,         y: o          },  // top-left
      { x: width - o, y: o          },  // top-right
      { x: o,         y: height - o },  // bottom-left
      { x: width - o, y: height - o },  // bottom-right
      { x: width / 2, y: o          },  // top-center
      { x: o,         y: height / 2 },  // left-middle
      { x: width - o, y: height / 2 },  // right-middle
    ];

    let totalR = 0, totalG = 0, totalB = 0;
    let valid = 0;

    for (const pt of points) {
      const x = Math.round(Math.max(0, Math.min(pt.x, width - 1)));
      const y = Math.round(Math.max(0, Math.min(pt.y, height - 1)));
      const data = ctx.getImageData(x, y, 1, 1).data;

      // Skip fully transparent pixels
      if (data[3] < 10) continue;

      totalR += data[0];
      totalG += data[1];
      totalB += data[2];
      valid++;
    }

    if (valid === 0) return null;

    return {
      r: Math.round(totalR / valid),
      g: Math.round(totalG / valid),
      b: Math.round(totalB / valid),
    };
  }

  // ──────────────────────────────────────────────────────────
  // Check if sampled color matches a target within tolerance
  // ──────────────────────────────────────────────────────────
  function colorMatches(sampled, target, tolerance = TOLERANCE) {
    if (!sampled || !target) return false;
    return (
      Math.abs(sampled.r - target.r) <= tolerance &&
      Math.abs(sampled.g - target.g) <= tolerance &&
      Math.abs(sampled.b - target.b) <= tolerance
    );
  }

  // ──────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────

  /**
   * Check if an image's background matches the required color.
   *
   * @param {File}   file      - The image file
   * @param {string} bgColor   - 'white' | 'blue' | 'any' | hex string
   * @returns {Promise<{match: boolean, sampledRgb: object, requiredColor: string}>}
   */
  async function check(file, bgColor) {
    // If exam doesn't require a specific background, always match
    if (!bgColor || bgColor === 'any' || bgColor === 'none') {
      return { match: true, sampledRgb: null, requiredColor: 'none', skipped: true };
    }

    const { ctx, width, height } = await getImagePixels(file);
    const sampled = samplePixels(ctx, width, height);

    if (!sampled) {
      // Could not sample — let it pass to server
      return { match: false, sampledRgb: null, requiredColor: bgColor, error: 'sampling_failed' };
    }

    let target;

    if (bgColor === 'white') {
      target = BG_DEFINITIONS.white;
    } else if (bgColor === 'blue') {
      target = BG_DEFINITIONS.blue;
      // Blue has wider tolerance since "exam blue" varies slightly
      const blueMatch = (
        sampled.b > 100 &&
        sampled.b > sampled.r + 30 &&
        sampled.b > sampled.g + 20
      );
      return {
        match: blueMatch,
        sampledRgb: sampled,
        requiredColor: bgColor,
        hex: rgbToHex(sampled),
      };
    } else if (bgColor.startsWith('#')) {
      target = hexToRgb(bgColor);
    } else {
      target = BG_DEFINITIONS[bgColor] || null;
    }

    const match = colorMatches(sampled, target);

    return {
      match,
      sampledRgb: sampled,
      requiredColor: bgColor,
      hex: rgbToHex(sampled),
    };
  }

  // ──────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────
  function rgbToHex({ r, g, b }) {
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  function hexToRgb(hex) {
    const res = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return res
      ? { r: parseInt(res[1], 16), g: parseInt(res[2], 16), b: parseInt(res[3], 16) }
      : null;
  }

  return { check };
})();

window.BgDetect = BgDetect;
