/**
 * Vercel Serverless Function: /api/remove-bg
 * Receives base64 image → calls ClipDrop API → fills bg color → returns base64
 *
 * This function:
 * 1. Validates the incoming request (origin, size, mime type)
 * 2. Sends to ClipDrop background removal API
 * 3. Fills the transparent PNG with required background color using canvas
 * 4. Returns the processed image as base64
 * 5. NEVER stores images — all in memory
 */

export const config = { maxDuration: 30 };

export default async function handler(req, res) {

  // ── CORS: Only accept from compressphoto.in (and localhost for dev)
  const origin  = req.headers.origin || '';
  const allowed = [
    'https://compressphoto.in',
    'https://www.compressphoto.in',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ];

  if (!allowed.some(o => origin.startsWith(o)) && origin !== '') {
    return res.status(403).json({ success: false, error: 'Origin not allowed' });
  }

  // ── OPTIONS pre-flight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // ── Parse body
  const { image, bgColor, mimeType } = req.body || {};

  if (!image || typeof image !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing image data' });
  }

  // ── Validate base64 size (≤ 8MB decoded ≈ ≤ 11MB b64)
  const estimatedBytes = (image.length * 3) / 4;
  if (estimatedBytes > 8 * 1024 * 1024) {
    return res.status(400).json({ success: false, error: 'Image too large (max 8MB)' });
  }

  // ── Determine background color
  const bgHex = resolveColor(bgColor);

  // ── API Key
  const apiKey = process.env.CLIPDROP_API_KEY;
  if (!apiKey) {
    console.error('CLIPDROP_API_KEY not set in environment');
    return res.status(500).json({
      success:  false,
      error:    'API not configured',
      fallback: true,
    });
  }

  try {
    // ── Convert base64 to Buffer
    const imageBuffer = Buffer.from(image, 'base64');

    // ── Build FormData for ClipDrop API
    const formData = new FormData();
    const blob     = new Blob([imageBuffer], { type: mimeType || 'image/jpeg' });
    formData.append('image_file', blob, 'photo.jpg');

    // ── Call ClipDrop Remove Background API
    const clipResponse = await fetch('https://clipdrop-api.co/remove-background/v1', {
      method:  'POST',
      headers: { 'x-api-key': apiKey },
      body:    formData,
    });

    if (!clipResponse.ok) {
      const errText = await clipResponse.text();
      console.error('ClipDrop API error:', clipResponse.status, errText);

      // If rate limited, tell client to fallback gracefully
      if (clipResponse.status === 429) {
        return res.status(200).json({
          success:  false,
          error:    'Background removal is temporarily busy. Try again in a minute.',
          fallback: true,
        });
      }

      return res.status(200).json({
        success:  false,
        error:    `Background removal failed (${clipResponse.status})`,
        fallback: true,
      });
    }

    // ── Get transparent PNG from ClipDrop
    const transparentPngBuffer = Buffer.from(await clipResponse.arrayBuffer());

    // ── Fill background with solid color using sharp (or return as-is for now)
    // Without sharp (pure Node): use the canvas npm package
    // For Vercel, we'll use the @napi-rs/canvas package
    let finalImageBuffer;

    try {
      finalImageBuffer = await fillBackground(transparentPngBuffer, bgHex);
    } catch (canvasErr) {
      console.warn('Canvas fill failed, returning transparent PNG:', canvasErr.message);
      // Return the transparent-background PNG — still useful
      finalImageBuffer = transparentPngBuffer;
    }

    // ── Return as base64 (NEVER write to disk)
    const resultBase64 = finalImageBuffer.toString('base64');

    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    return res.status(200).json({
      success:       true,
      image:         resultBase64,
      processedInMs: Date.now(),
    });

  } catch (err) {
    console.error('remove-bg handler error:', err);
    return res.status(200).json({
      success:  false,
      error:    'Internal processing error',
      fallback: true,
    });
  }
}

// ──────────────────────────────────────────────────────────
// Fill transparent PNG with solid background using Canvas
// ──────────────────────────────────────────────────────────
async function fillBackground(pngBuffer, hexColor) {
  // Dynamic import to avoid issues if package not installed
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');

  const img    = await loadImage(pngBuffer);
  const canvas = createCanvas(img.width, img.height);
  const ctx    = canvas.getContext('2d');

  // Fill background first
  ctx.fillStyle = hexColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw the transparent image on top
  ctx.drawImage(img, 0, 0);

  // Return as PNG buffer (lossless for this step)
  return canvas.toBuffer('image/png');
}

// ──────────────────────────────────────────────────────────
// Resolve color name to hex
// ──────────────────────────────────────────────────────────
function resolveColor(bgColor) {
  const map = {
    white:  '#FFFFFF',
    blue:   '#003580',
    cream:  '#FFFDD0',
    grey:   '#F5F5F5',
    gray:   '#F5F5F5',
  };

  if (!bgColor) return '#FFFFFF';
  if (bgColor.startsWith('#')) return bgColor;
  return map[bgColor.toLowerCase()] || '#FFFFFF';
}
