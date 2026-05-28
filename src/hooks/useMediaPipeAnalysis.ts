'use client';
// hooks/useMediaPipeAnalysis.ts
// IMPROVED VERSION — MediaPipe iris tracking with robust fallback
// Falls back to native FaceDetector API → canvas pixel heuristic → neutral
// All client data is sent to server; server-side Claude Vision is the primary scorer

import { useRef, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface AnalysisSummary {
  eyeContactScore:   number;   // 0-100
  bodyLanguageScore: number;   // 0-100
  framesAnalyzed:    number;
  faceVisiblePct:    number;   // % of frames where face was detected
  suspicionFlags:    string[];
  gazeBreakdown: {
    center:  number;
    down:    number;
    side:    number;
    absent:  number;
  };
  trackingMethod: string;  // for debugging: which method actually worked
}

type GazeDir = 'center' | 'down' | 'left' | 'right' | 'up' | 'absent';

interface FrameData {
  gaze:        GazeDir;
  headDown:    boolean;
  headSide:    boolean;
  faceVisible: boolean;
  ts:          number;
}

// ─── MediaPipe landmark indices ────────────────────────────────────────────────
const L_EYE_OUTER  = 33;
const L_EYE_INNER  = 133;
const L_IRIS       = 468;
const R_EYE_OUTER  = 263;
const R_EYE_INNER  = 362;
const R_IRIS       = 473;
const NOSE_TIP     = 1;
const FOREHEAD     = 10;
const CHIN         = 152;
const FACE_LEFT    = 234;
const FACE_RIGHT   = 454;

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useMediaPipeAnalysis() {
  const framesRef           = useRef<FrameData[]>([]);
  const startTimeRef        = useRef<number>(0);
  const faceMeshRef         = useRef<any>(null);
  const cameraRef           = useRef<any>(null);
  const loadedRef           = useRef<boolean>(false);
  const videoElRef          = useRef<HTMLVideoElement | null>(null);
  const trackingMethodRef   = useRef<string>('none');

  // Fallback: canvas interval handle
  const canvasIntervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const canvasRef           = useRef<HTMLCanvasElement | null>(null);
  const nativeFaceDetRef    = useRef<any>(null);

  // ── Gaze from MediaPipe FaceMesh landmarks ────────────────────────────────
  const calcGaze = (lm: any[]): { gaze: GazeDir; headDown: boolean; headSide: boolean } => {
    try {
      const lIris  = lm[L_IRIS];
      const rIris  = lm[R_IRIS];
      const lOuter = lm[L_EYE_OUTER];
      const lInner = lm[L_EYE_INNER];
      const rOuter = lm[R_EYE_OUTER];
      const rInner = lm[R_EYE_INNER];
      const noseTip   = lm[NOSE_TIP];
      const forehead  = lm[FOREHEAD];
      const chin      = lm[CHIN];
      const faceLeft  = lm[FACE_LEFT];
      const faceRight = lm[FACE_RIGHT];

      const faceH     = Math.abs(chin.y - forehead.y) || 0.01;
      const faceW     = Math.abs(faceRight.x - faceLeft.x) || 0.01;
      const nosePos   = (noseTip.y - forehead.y) / faceH;
      const headTurnRatio = (noseTip.x - faceLeft.x) / faceW;

      if (nosePos > 0.60) return { gaze: 'down',  headDown: true,  headSide: false };
      if (headTurnRatio < 0.36) return { gaze: 'left',  headDown: false, headSide: true  };
      if (headTurnRatio > 0.64) return { gaze: 'right', headDown: false, headSide: true  };

      if (lIris && rIris) {
        const lEyeW    = Math.abs(lInner.x - lOuter.x) || 0.01;
        const rEyeW    = Math.abs(rInner.x - rOuter.x) || 0.01;
        const lGazeH   = (lIris.x - lOuter.x) / lEyeW;
        const rGazeH   = (rIris.x - rOuter.x) / rEyeW;
        const horizGaze = (lGazeH + rGazeH) / 2;
        if (horizGaze < 0.30) return { gaze: 'right', headDown: false, headSide: false };
        if (horizGaze > 0.70) return { gaze: 'left',  headDown: false, headSide: false };
      }

      if (nosePos < 0.36) return { gaze: 'up', headDown: false, headSide: false };
      return { gaze: 'center', headDown: false, headSide: false };
    } catch {
      return { gaze: 'center', headDown: false, headSide: false };
    }
  };

  // ── Load script helper ────────────────────────────────────────────────────
  const loadScript = (src: string): Promise<void> =>
    new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const s   = document.createElement('script');
      s.src     = src;
      s.onload  = () => resolve();
      s.onerror = () => reject(new Error(`Failed: ${src}`));
      document.head.appendChild(s);
    });

  // ── Init MediaPipe FaceMesh ───────────────────────────────────────────────
  const initFaceMesh = useCallback(async (video: HTMLVideoElement): Promise<boolean> => {
    const FaceMesh = (window as any).FaceMesh;
    const Camera   = (window as any).Camera;
    if (!FaceMesh || !Camera) return false;

    try {
      const faceMesh = new FaceMesh({
        locateFile: (f: string) =>
          `https://unpkg.com/@mediapipe/face_mesh@0.4.1633559619/${f}`,
      });
      faceMesh.setOptions({
        maxNumFaces:            1,
        refineLandmarks:        true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence:  0.5,
      });
      faceMesh.onResults((results: any) => {
        const ts = (Date.now() - startTimeRef.current) / 1000;
        if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
          framesRef.current.push({ gaze: 'absent', headDown: false, headSide: false, faceVisible: false, ts });
          return;
        }
        const { gaze, headDown, headSide } = calcGaze(results.multiFaceLandmarks[0]);
        framesRef.current.push({ gaze, headDown, headSide, faceVisible: true, ts });
      });

      const camera = new Camera(video, {
        onFrame: async () => { await faceMesh.send({ image: video }); },
        width: 640, height: 480,
      });
      await camera.start();
      faceMeshRef.current = faceMesh;
      cameraRef.current   = camera;
      trackingMethodRef.current = 'mediapipe_facemesh';
      console.log('[Tracking] MediaPipe FaceMesh running');
      return true;
    } catch (err) {
      console.warn('[Tracking] FaceMesh init failed:', err);
      return false;
    }
  }, []);

  // ── Fallback 1: Native FaceDetector API + canvas ──────────────────────────
  const initNativeFaceDetector = useCallback(async (video: HTMLVideoElement): Promise<boolean> => {
    if (typeof window === 'undefined' || !('FaceDetector' in window)) return false;
    try {
      const fd = new (window as any).FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
      nativeFaceDetRef.current = fd;

      // Create offscreen canvas for pixel analysis
      const canvas = document.createElement('canvas');
      canvas.width  = 320;
      canvas.height = 240;
      canvasRef.current = canvas;

      const tick = async () => {
        if (!video.videoWidth || video.readyState < 2) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, 320, 240);
        const ts = (Date.now() - startTimeRef.current) / 1000;

        try {
          const faces = await fd.detect(video);
          if (!faces || faces.length === 0) {
            framesRef.current.push({ gaze: 'absent', headDown: false, headSide: false, faceVisible: false, ts });
            return;
          }
          // Face detected — estimate gaze from face bounding box position
          const face      = faces[0].boundingBox;
          const vidW      = video.videoWidth;
          const vidH      = video.videoHeight;
          const faceCX    = (face.x + face.width  / 2) / vidW;  // 0=left, 1=right
          const faceCY    = (face.y + face.height / 2) / vidH;  // 0=top,  1=bottom
          const faceSize  = (face.width / vidW);                 // relative size

          // Too small = far from camera or head turned away
          if (faceSize < 0.08) {
            framesRef.current.push({ gaze: 'absent', headDown: false, headSide: false, faceVisible: false, ts });
            return;
          }
          // Face too low in frame → looking down
          if (faceCY > 0.72) {
            framesRef.current.push({ gaze: 'down', headDown: true, headSide: false, faceVisible: true, ts });
            return;
          }
          // Face too far to either side → looking sideways
          if (faceCX < 0.30) {
            framesRef.current.push({ gaze: 'left', headDown: false, headSide: true, faceVisible: true, ts });
            return;
          }
          if (faceCX > 0.70) {
            framesRef.current.push({ gaze: 'right', headDown: false, headSide: true, faceVisible: true, ts });
            return;
          }
          framesRef.current.push({ gaze: 'center', headDown: false, headSide: false, faceVisible: true, ts });
        } catch {
          // Detect threw — check brightness at least
          const imageData = ctx.getImageData(0, 0, 320, 240);
          const pixels    = imageData.data;
          let bright = 0;
          for (let i = 0; i < pixels.length; i += 40) {
            bright += (pixels[i] + pixels[i+1] + pixels[i+2]) / 3;
          }
          const avg = bright / (pixels.length / 40);
          if (avg < 20) {
            framesRef.current.push({ gaze: 'absent', headDown: false, headSide: false, faceVisible: false, ts });
          } else {
            // Assume center if something visible
            framesRef.current.push({ gaze: 'center', headDown: false, headSide: false, faceVisible: true, ts });
          }
        }
      };

      // Sample at ~2fps — enough for trend analysis
      canvasIntervalRef.current = setInterval(tick, 500);
      trackingMethodRef.current = 'native_facedetector';
      console.log('[Tracking] Native FaceDetector running');
      return true;
    } catch (err) {
      console.warn('[Tracking] Native FaceDetector failed:', err);
      return false;
    }
  }, []);

  // ── Fallback 2: Pure canvas brightness/skin heuristic ─────────────────────
  const initCanvasHeuristic = useCallback((video: HTMLVideoElement): boolean => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width  = 320;
      canvas.height = 240;
      canvasRef.current = canvas;

      const tick = () => {
        if (!video.videoWidth || video.readyState < 2) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, 320, 240);
        const ts = (Date.now() - startTimeRef.current) / 1000;

        const imageData = ctx.getImageData(0, 0, 320, 240);
        const pixels    = imageData.data;
        const w = 320, h = 240;

        let totalBright = 0, pixCount = 0;
        let topSkinPx   = 0, topTotal = 0;
        let botSkinPx   = 0, botTotal = 0;
        let ctrSkinPx   = 0, ctrTotal = 0;

        for (let y = 0; y < h; y += 4) {
          for (let x = 0; x < w; x += 4) {
            const i   = (y * w + x) * 4;
            const r   = pixels[i], g = pixels[i+1], b = pixels[i+2];
            const br  = (r + g + b) / 3;
            totalBright += br;
            pixCount++;

            // Skin tone detection (rough HSV approach via RGB)
            const isSkin = r > 70 && g > 45 && b > 20 &&
                           r > g && r > b &&
                           (r - g) > 12 && (r - b) > 15 &&
                           br > 50 && br < 230;

            const xNorm = x / w, yNorm = y / h;
            const inCtr = xNorm > 0.25 && xNorm < 0.75 && yNorm > 0.15 && yNorm < 0.65;
            const inTop = yNorm < 0.4;
            const inBot = yNorm > 0.7;

            if (inCtr)  { ctrTotal++;  if (isSkin) ctrSkinPx++;  }
            if (inTop)  { topTotal++;  if (isSkin) topSkinPx++;  }
            if (inBot)  { botTotal++;  if (isSkin) botSkinPx++;  }
          }
        }

        const avgBright  = totalBright / pixCount;
        const topSkinPct = topTotal > 0 ? topSkinPx / topTotal : 0;
        const botSkinPct = botTotal > 0 ? botSkinPx / botTotal : 0;
        const ctrSkinPct = ctrTotal > 0 ? ctrSkinPx / ctrTotal : 0;

        if (avgBright < 20) {
          framesRef.current.push({ gaze: 'absent', headDown: false, headSide: false, faceVisible: false, ts });
          return;
        }
        if (ctrSkinPct < 0.04) {
          framesRef.current.push({ gaze: 'absent', headDown: false, headSide: false, faceVisible: false, ts });
          return;
        }
        // More skin in bottom half → head tilted down (phone)
        if (botSkinPct > topSkinPct * 1.5 && botSkinPct > 0.08) {
          framesRef.current.push({ gaze: 'down', headDown: true, headSide: false, faceVisible: true, ts });
          return;
        }
        // Face centred and visible
        framesRef.current.push({ gaze: 'center', headDown: false, headSide: false, faceVisible: true, ts });
      };

      canvasIntervalRef.current = setInterval(tick, 600);
      trackingMethodRef.current = 'canvas_heuristic';
      console.log('[Tracking] Canvas heuristic running');
      return true;
    } catch (err) {
      console.warn('[Tracking] Canvas heuristic failed:', err);
      return false;
    }
  }, []);

  // ── Public: startCapture ──────────────────────────────────────────────────
  const startCapture = useCallback(async (video: HTMLVideoElement) => {
    framesRef.current    = [];
    startTimeRef.current = Date.now();
    videoElRef.current   = video;
    trackingMethodRef.current = 'none';

    // Try MediaPipe first
    try {
      if (!loadedRef.current) {
        console.log('[Tracking] Loading MediaPipe scripts...');
        await Promise.race([
          (async () => {
            await loadScript(
              'https://unpkg.com/@mediapipe/face_mesh@0.4.1633559619/face_mesh.js'
            );
            await loadScript(
              'https://unpkg.com/@mediapipe/camera_utils@0.3.1632717810/camera_utils.js'
            );
          })(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000)),
        ]);
        loadedRef.current = true;
        console.log('[Tracking] MediaPipe scripts loaded');
      }
      const ok = await initFaceMesh(video);
      if (ok) return; // MediaPipe working — done
    } catch (err) {
      console.warn('[Tracking] MediaPipe unavailable:', err);
    }

    // Fallback 1: Native FaceDetector
    try {
      const ok = await initNativeFaceDetector(video);
      if (ok) return;
    } catch (err) {
      console.warn('[Tracking] Native FaceDetector unavailable:', err);
    }

    // Fallback 2: Canvas heuristic — always works
    initCanvasHeuristic(video);
  }, [initFaceMesh, initNativeFaceDetector, initCanvasHeuristic]);

  // ── Public: stopCapture → scored summary ─────────────────────────────────
  const stopCapture = useCallback((): AnalysisSummary => {
    // Stop all tracking
    try { cameraRef.current?.stop(); } catch (_) {}
    cameraRef.current   = null;
    faceMeshRef.current = null;
    if (canvasIntervalRef.current) {
      clearInterval(canvasIntervalRef.current);
      canvasIntervalRef.current = null;
    }

    const frames = framesRef.current;
    const method = trackingMethodRef.current;

    if (frames.length < 5) {
      return {
        eyeContactScore:   -1,
        bodyLanguageScore: -1,
        framesAnalyzed:    frames.length,
        faceVisiblePct:    -1,
        suspicionFlags:    [],
        gazeBreakdown:     { center: 0, down: 0, side: 0, absent: 0 },
        trackingMethod:    method,
      };
    }

    const total         = frames.length;
    const absentFrames  = frames.filter(f => f.gaze === 'absent').length;
    const centerFrames  = frames.filter(f => f.gaze === 'center').length;
    const downFrames    = frames.filter(f => f.gaze === 'down').length;
    const leftFrames    = frames.filter(f => f.gaze === 'left').length;
    const rightFrames   = frames.filter(f => f.gaze === 'right').length;
    const sideFrames    = leftFrames + rightFrames;

    const faceVisiblePct   = Math.round(((total - absentFrames) / total) * 100);
    const eyeContactScore  = Math.round((centerFrames / total) * 100);
    const bodyPenaltyRaw   = (downFrames * 2.5 + sideFrames * 1.5 + absentFrames) / total;
    const bodyLanguageScore= Math.round(Math.max(0, 100 - bodyPenaltyRaw * 100));

    const gazeBreakdown = {
      center:  Math.round((centerFrames  / total) * 100),
      down:    Math.round((downFrames    / total) * 100),
      side:    Math.round((sideFrames    / total) * 100),
      absent:  Math.round((absentFrames  / total) * 100),
    };

    const suspicionFlags: string[] = [];
    if (downFrames / total > 0.25)
      suspicionFlags.push(`Looking down ${Math.round(downFrames/total*100)}% of the time — possible phone or notes on lap`);
    if (sideFrames / total > 0.30)
      suspicionFlags.push(`Looking sideways ${Math.round(sideFrames/total*100)}% of the time — possible reference material or second screen`);
    if (absentFrames / total > 0.20)
      suspicionFlags.push(`Face not visible ${Math.round(absentFrames/total*100)}% of the time`);

    let longestSideRun = 0, currentRun = 0;
    for (const f of frames) {
      if (f.gaze === 'left' || f.gaze === 'right') {
        if (++currentRun > longestSideRun) longestSideRun = currentRun;
      } else { currentRun = 0; }
    }
    const fps           = method === 'mediapipe_facemesh' ? 10 : 2;
    const sustainedSecs = Math.round(longestSideRun / fps);
    if (sustainedSecs >= 5)
      suspicionFlags.push(`Sustained sideways gaze for ~${sustainedSecs}s — possible script reading`);

    if (faceVisiblePct > 70 && eyeContactScore < 30)
      suspicionFlags.push(`Eye contact only ${eyeContactScore}% despite face being visible`);

    const result: AnalysisSummary = {
      eyeContactScore:   Math.min(100, Math.max(0, eyeContactScore)),
      bodyLanguageScore: Math.min(100, Math.max(0, bodyLanguageScore)),
      framesAnalyzed:    total,
      faceVisiblePct,
      suspicionFlags,
      gazeBreakdown,
      trackingMethod:    method,
    };

    console.log('[Tracking] Final result:', result);
    return result;
  }, []);

  return { startCapture, stopCapture };
}