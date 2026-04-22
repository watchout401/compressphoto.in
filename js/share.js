/**
 * share.js — Share functionality
 * Uses Web Share API on mobile, clipboard fallback on desktop
 */

const Share = (() => {

  async function shareResult(examName, originalKB, finalKB) {
    const savedPct = Math.round((1 - finalKB / originalKB) * 100);
    const text = `📸 Just compressed my ${examName} exam photo from ${originalKB}KB to ${finalKB}KB (${savedPct}% smaller!) using compressphoto.in — free & instant!`;
    const url  = 'https://compressphoto.in';

    // Try Web Share API (mobile / modern browsers)
    if (navigator.share) {
      try {
        await navigator.share({ title: 'compressphoto.in', text, url });
        UI.toast('Shared successfully! 🎉', 'success');
        return;
      } catch (e) {
        if (e.name !== 'AbortError') {
          // Fall through to clipboard
        } else {
          return; // User cancelled
        }
      }
    }

    // Clipboard fallback
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      UI.toast('Link copied to clipboard! Share it with friends 📋', 'success');
    } catch (e) {
      // Manual fallback
      const ta = document.createElement('textarea');
      ta.value = `${text}\n${url}`;
      ta.style.position = 'fixed';
      ta.style.opacity  = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      UI.toast('Copied to clipboard!', 'success');
    }
  }

  return { shareResult };
})();

window.Share = Share;
