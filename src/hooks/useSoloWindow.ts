// hooks/useSoloWindow.ts
// FIXED VERSION — no window.close(), no BroadcastChannel conflicts
// Strategy:
//   1. If URL has ?solo=1 → this IS the solo popup → register as owner, do nothing else
//   2. If URL has no ?solo=1 → open popup with ?solo=1, then show a blocking overlay
//      on the original tab (never try to close it — browsers block that)
//   3. If a second tab opens the same interview link → show blocking overlay immediately

import { useEffect } from 'react';

const CHANNEL_NAME = 'smarthire_interview_solo';
const STORAGE_KEY  = 'smarthire_interview_active';

export function useSoloWindow() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isSolo = params.has('solo');

    // ── Helper: show a full-screen blocking overlay (no close, no redirect) ──
    const showBlocker = (
      title:   string,
      message: string,
      icon:    string = '⚠️',
    ) => {
      // Don't add twice
      if (document.getElementById('smarthire-blocker')) return;

      const overlay = document.createElement('div');
      overlay.id = 'smarthire-blocker';
      overlay.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:2147483647',
        'background:rgba(15,23,42,0.98)',
        'display:flex', 'flex-direction:column',
        'align-items:center', 'justify-content:center',
        'text-align:center', 'padding:40px',
        "font-family:Inter,system-ui,-apple-system,sans-serif",
      ].join(';');

      overlay.innerHTML = `
        <div style="font-size:52px;margin-bottom:20px;line-height:1">${icon}</div>
        <h1 style="
          color:#F8FAFC;font-size:22px;font-weight:700;
          margin:0 0 12px;letter-spacing:-0.02em;max-width:480px;
        ">${title}</h1>
        <p style="
          color:rgba(248,250,252,0.6);font-size:14px;
          line-height:1.75;max-width:420px;margin:0;
        ">${message}</p>
      `;

      // Prevent any interaction with the page underneath
      overlay.addEventListener('click',       e => e.stopPropagation());
      overlay.addEventListener('keydown',     e => e.preventDefault());
      overlay.addEventListener('contextmenu', e => e.preventDefault());
      document.body.appendChild(overlay);
    };

    // ── CASE 1: This is the solo popup tab ───────────────────────────────────
    if (isSolo) {
      // Announce ourselves so any other tab with this URL shows a blocker
      const channel = new BroadcastChannel(CHANNEL_NAME);
      channel.postMessage({ type: 'solo-open' });

      // If another solo tab announces itself later → we show blocker here
      channel.onmessage = (e) => {
        if (e.data?.type === 'solo-open') {
          channel.close();
          showBlocker(
            'Interview already open',
            'This interview is running in another window.<br>Please return to that window to continue.',
          );
        }
      };

      // Cleanup on unmount
      return () => { try { channel.close(); } catch (_) {} };
    }

    // ── CASE 2: Original tab (no ?solo param) ────────────────────────────────
    // Try to open a popup. If it succeeds, block this original tab.
    // If popup is blocked by browser, do nothing — interview continues normally.

    const soloUrl = window.location.href.includes('?')
      ? `${window.location.href}&solo=1`
      : `${window.location.href}?solo=1`;

    const w      = screen.availWidth;
    const h      = screen.availHeight;
    const popup  = window.open(
      soloUrl,
      'smarthire_interview',
      [
        `width=${w}`,  `height=${h}`,
        'left=0',      'top=0',
        'toolbar=no',  'menubar=no',
        'scrollbars=no', 'resizable=no',
        'status=no',   'location=no',
      ].join(','),
    );

    if (popup) {
      popup.focus();

      // Block this original tab — popup is now the real interview
      showBlocker(
        'Interview opened in a new window',
        'Your interview is running in the popup window that just opened.<br>' +
        'Please switch to that window and complete your interview there.<br><br>' +
        '<span style="color:rgba(248,250,252,0.4);font-size:12px">' +
        'If the popup was blocked by your browser, you can close this message ' +
        'and continue here.</span>',
        '🪟',
      );

      // If the popup gets closed (candidate closes it by mistake), remove the blocker
      // so they can continue in this tab as a fallback
      const checkPopup = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkPopup);
          const blocker = document.getElementById('smarthire-blocker');
          if (blocker) blocker.remove();
        }
      }, 1000);

      return () => clearInterval(checkPopup);
    }

    // Popup was blocked — silently continue in current tab (no overlay, no crash)
    console.log('[useSoloWindow] Popup blocked — continuing in current tab');
  }, []);
}