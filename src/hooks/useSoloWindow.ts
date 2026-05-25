import { useEffect } from 'react';

export function useSoloWindow() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isSolo = params.has('solo');

    if (isSolo) return; // Already the solo window — do nothing

    const soloUrl = window.location.href.includes('?')
      ? window.location.href + '&solo=1'
      : window.location.href + '?solo=1';

    const w = screen.availWidth;
    const h = screen.availHeight;

    // Open a maximized, chrome-free popup window
    const popup = window.open(
      soloUrl,
      'smarthire_interview',
      `width=${w},height=${h},left=0,top=0,` +
      `toolbar=no,menubar=no,scrollbars=no,` +
      `resizable=no,status=no,location=no`
    );

    if (popup) {
      popup.focus();
      window.close(); // Close the original tab (works when opened via link)
    }
    // If popup is blocked by browser: gracefully falls through,
    // interview continues in current tab without any crash
  }, []);
}