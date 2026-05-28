// utils/extractVideoFrames.ts
// FIXED VERSION — handles Infinity duration from MediaRecorder webm blobs
//
// Root cause: MediaRecorder webm output does not embed duration metadata in the
// container header, so video.duration === Infinity until you seek near the end,
// which forces the browser to scan and set the real duration via durationchange.

export async function extractFramesFromBlob(
    videoBlob: Blob,
    frameCount: number = 8,
  ): Promise<string[]> {
    return new Promise((resolve) => {
      const frames: string[] = [];
      const url   = URL.createObjectURL(videoBlob);
      const video = document.createElement('video');
  
      video.crossOrigin = 'anonymous';
      video.muted       = true;
      video.preload     = 'metadata';
      video.src         = url;
  
      const canvas = document.createElement('canvas');
      canvas.width  = 320;
      canvas.height = 240;
      const ctx = canvas.getContext('2d');
  
      let captureStarted = false;
  
      const cleanup = () => {
        try { URL.revokeObjectURL(url); } catch (_) {}
      };
  
      const done = () => {
        cleanup();
        resolve(frames);
      };
  
      // Safety timeout — 35 seconds max
      const safetyTimer = setTimeout(done, 35_000);
  
      const startCapture = () => {
        if (captureStarted) return;
        captureStarted = true;
  
        const duration = video.duration;
  
        if (!duration || !isFinite(duration) || duration < 0.3) {
          clearTimeout(safetyTimer);
          done();
          return;
        }
  
        // Skip the very first and last seconds (camera settling / ending noise)
        const start    = Math.min(1.5, duration * 0.05);
        const end      = Math.max(start + 0.3, duration - 1.5);
        const interval = frameCount > 1 ? (end - start) / (frameCount - 1) : 0;
        const times    = Array.from({ length: frameCount }, (_, i) =>
          parseFloat(Math.min(start + i * interval, end).toFixed(3))
        );
  
        let idx = 0;
  
        const captureNext = () => {
          if (idx >= times.length) {
            clearTimeout(safetyTimer);
            done();
            return;
          }
          video.currentTime = times[idx];
        };
  
        video.onseeked = () => {
          try {
            if (ctx) {
              ctx.drawImage(video, 0, 0, 320, 240);
              const b64 = canvas.toDataURL('image/jpeg', 0.75).split(',')[1];
              if (b64 && b64.length > 500) frames.push(b64);
            }
          } catch (_) {}
          idx++;
          captureNext();
        };
  
        video.onerror = () => {
          clearTimeout(safetyTimer);
          done();
        };
  
        captureNext();
      };
  
      // ── KEY FIX: handle Infinity duration from MediaRecorder webm ──────────
      // When duration is Infinity on loadedmetadata, seek to a huge timestamp.
      // The browser clamps to the real end and fires durationchange with the
      // correct finite value. Only then do we start extracting frames.
      video.onloadedmetadata = () => {
        if (isFinite(video.duration)) {
          startCapture();
        } else {
          // Trigger the browser to compute real duration
          video.currentTime = 1e10;
        }
      };
  
      // Fires after the seek above resolves the real duration
      video.ondurationchange = () => {
        if (isFinite(video.duration) && !captureStarted) {
          // Reset to beginning before we start capturing frames
          video.currentTime = 0;
          // Give the browser a tick to settle after the duration fix
          setTimeout(startCapture, 50);
        }
      };
  
      video.onerror = () => {
        clearTimeout(safetyTimer);
        done();
      };
    });
  }