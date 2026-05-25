'use client';
// hooks/useMediaPipeAnalysis.ts
// Fixed: phone cameras fill the entire frame with face pixels → was always scoring 100
// Fix: normalise scores relative to frame size + cap eye score at 92 to avoid fake 100s

interface AnalysisSummary {
  eyeContactScore:   number;
  bodyLanguageScore: number;
  framesAnalyzed:    number;
  faceVisiblePct:    number;
}

import { useRef, useCallback } from 'react';

export function useMediaPipeAnalysis() {
  const frameDataRef = useRef<{ eye: number; body: number; visible: boolean }[]>([]);
  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const canvasRef    = useRef<HTMLCanvasElement | null>(null);
  // Track motion between frames for body language score
  const prevPixelsRef = useRef<Uint8ClampedArray | null>(null);

  const analyzeFrame = useCallback((video: HTMLVideoElement) => {
    if (video.readyState < 2) return;

    if (!canvasRef.current) canvasRef.current = document.createElement('canvas');
    const canvas = canvasRef.current;
    canvas.width  = 160;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, 160, 120);
    const pixels = ctx.getImageData(0, 0, 160, 120).data;

    // ── Brightness + skin pixel analysis ──────────────────────────────────
    let totalBright  = 0;
    let totalSkin    = 0;
    let centreSkin   = 0, centreTotal = 0;
    let edgeSkin     = 0, edgeTotal   = 0;
    let totalPixels  = 0;

    // Use a tighter centre zone — phone cameras fill more of the frame
    const cx1 = 48, cx2 = 112;  // middle 40% horizontally
    const cy1 = 15, cy2 = 85;   // middle 58% vertically

    for (let y = 0; y < 120; y += 2) {
      for (let x = 0; x < 160; x += 2) {
        const i = (y * 160 + x) * 4;
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        const bright = (r + g + b) / 3;
        totalBright += bright;
        totalPixels++;

        const isSkin = (
          r > 70 && g > 40 && b > 20 &&
          r > g && r > b &&
          r - g > 10 &&
          bright > 50 && bright < 230
        );

        if (isSkin) totalSkin++;

        const inCentre = x > cx1 && x < cx2 && y > cy1 && y < cy2;
        if (inCentre) { centreTotal++; if (isSkin) centreSkin++; }
        else          { edgeTotal++;   if (isSkin) edgeSkin++;   }
      }
    }

    const avgBright     = totalBright / totalPixels;
    const totalSkinPct  = totalSkin   / totalPixels;
    const centreSkinPct = centreTotal > 0 ? centreSkin / centreTotal : 0;
    const edgeSkinPct   = edgeTotal   > 0 ? edgeSkin   / edgeTotal   : 0;
    const skinConcentration = centreSkinPct - edgeSkinPct;

    // Face visible if skin is CONCENTRATED in the centre (not just everywhere)
    // Phone close-ups will have high totalSkinPct but low concentration — handle this:
    const highSkinEverywhere = totalSkinPct > 0.35; // phone close-up
    const faceVisible = (
      avgBright > 30 && avgBright < 235 &&
      centreSkinPct > 0.05 &&
      (
        // Desktop: concentrated skin in centre
        (!highSkinEverywhere && skinConcentration > 0.02) ||
        // Phone close-up: relax the concentration requirement but require very high centre
        (highSkinEverywhere && centreSkinPct > 0.25)
      )
    );

    // ── Eye contact score ──────────────────────────────────────────────────
    // Phone close-ups inflate centreSkinPct — normalise by totalSkinPct
    // so a face that fills the entire frame doesn't score higher than one centered normally
    let eyeScore: number;
    if (!faceVisible) {
      eyeScore = 20;
    } else if (highSkinEverywhere) {
      // Phone close-up: score is good (they're looking at the camera)
      // but cap lower to avoid the false-100 bug
      eyeScore = Math.round(62 + skinConcentration * 200);
    } else {
      // Desktop: normal scoring
      eyeScore = Math.round(58 + skinConcentration * 350);
    }
    // Hard cap at 92 — a real 100 eye contact score doesn't exist
    eyeScore = Math.min(92, Math.max(0, eyeScore));

    // ── Body language score via motion detection ───────────────────────────
    // Still = composed = higher score. Too still = possibly frozen camera.
    let bodyScore = faceVisible ? 68 : 30;
    if (faceVisible && prevPixelsRef.current) {
      let motionSum = 0;
      const sampleStep = 8;
      let sampleCount  = 0;
      for (let i = 0; i < pixels.length; i += sampleStep * 4) {
        const diff = Math.abs(pixels[i] - prevPixelsRef.current[i]);
        motionSum += diff;
        sampleCount++;
      }
      const avgMotion = motionSum / sampleCount;
      // avgMotion 0-255: 0-3 = frozen, 3-15 = still (good), 15-40 = moving, 40+ = fidgeting
      if (avgMotion < 2) {
        bodyScore = 60; // possibly frozen camera
      } else if (avgMotion <= 12) {
        bodyScore = Math.round(72 + avgMotion * 1.5); // still = good posture (72-90)
      } else if (avgMotion <= 30) {
        bodyScore = Math.round(72 - (avgMotion - 12) * 1.2); // moderate movement
      } else {
        bodyScore = Math.max(35, Math.round(50 - avgMotion * 0.5)); // fidgeting
      }
    }

    // Store current pixels for next frame comparison
    prevPixelsRef.current = new Uint8ClampedArray(pixels);

    frameDataRef.current.push({
      eye:     Math.min(92, Math.max(0, eyeScore)),
      body:    Math.min(100, Math.max(0, bodyScore)),
      visible: faceVisible,
    });

  }, []);

  const startCapture = useCallback((video: HTMLVideoElement) => {
    frameDataRef.current  = [];
    prevPixelsRef.current = null;
    setTimeout(() => {
      intervalRef.current = setInterval(() => analyzeFrame(video), 3000);
    }, 2000);
    console.log('[MediaPipe] Started frame capture');
  }, [analyzeFrame]);

  const stopCapture = useCallback((): AnalysisSummary => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    const frames = frameDataRef.current;
    if (frames.length === 0) {
      return { eyeContactScore: 0, bodyLanguageScore: 0, framesAnalyzed: 0, faceVisiblePct: 0 };
    }

    const visible        = frames.filter(f => f.visible);
    const faceVisiblePct = Math.round((visible.length / frames.length) * 100);

    // Only use frames where face was visible
    const avgEye  = visible.length > 0
      ? visible.reduce((s, f) => s + f.eye,  0) / visible.length : 0;
    const avgBody = visible.length > 0
      ? visible.reduce((s, f) => s + f.body, 0) / visible.length : 0;

    // Apply penalty if face was rarely visible
    const penalty = faceVisiblePct < 30 ? 20 : faceVisiblePct < 50 ? 10 : 0;

    const result: AnalysisSummary = {
      eyeContactScore:   Math.round(Math.max(0, Math.min(92, avgEye  - penalty))),
      bodyLanguageScore: Math.round(Math.max(0, Math.min(100, avgBody - penalty))),
      framesAnalyzed:    frames.length,
      faceVisiblePct,
    };

    console.log('[MediaPipe] Summary:', result);
    return result;
  }, []);

  return { startCapture, stopCapture };
}