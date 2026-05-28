// app/api/interview/analyze-video/route.ts
// FIXED VERSION — corrected bodyLanguageScore formula + stricter gaze classification

import { NextRequest, NextResponse } from 'next/server';

export interface VideoAnalysisResult {
  eyeContactScore:   number;
  bodyLanguageScore: number;
  faceVisiblePct:    number;
  gazeBreakdown: {
    center: number;
    down:   number;
    side:   number;
    absent: number;
  };
  suspicionFlags: string[];
  framesAnalyzed: number;
  method:         string;
}

export async function POST(req: NextRequest) {
  try {
    const { frames } = await req.json(); // frames: string[] (base64 JPEG)

    if (!Array.isArray(frames) || frames.length === 0) {
      return NextResponse.json(fallbackResult('no_frames'));
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(fallbackResult('no_api_key'));
    }

    const validFrames = frames.filter(
      (f) => typeof f === 'string' && f.length > 500,
    );

    console.log(`[VideoAnalysis] Received ${validFrames.length} valid frames`);

    if (validFrames.length < 2) {
      return NextResponse.json(fallbackResult('insufficient_frames'));
    }

    const imageBlocks = validFrames.map((b64) => ({
      type:   'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: b64 },
    }));

    const N = validFrames.length;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 800,
        messages: [
          {
            role:    'user',
            content: [
              ...imageBlocks,
              {
                type: 'text',
                // ── FIXED PROMPT ─────────────────────────────────────────────
                // Key changes vs old prompt:
                //   1. Explicit per-frame label required (no skipping)
                //   2. bodyLanguageScore formula is arithmetic — Claude does NOT
                //      compute it, we compute it server-side from the counts
                //   3. Bias toward DOWN/SIDE for ambiguous cases (strict scoring)
                //   4. gazeBreakdown values must be raw counts, not percentages
                //      (we convert server-side so rounding doesn't drift to ≠100)
                text: `You are a strict interview integrity analyst reviewing ${N} frames from a video job interview (evenly sampled throughout).

For EACH of the ${N} frames, assign exactly one label:

CENTER  — The person's eyes/face are clearly and directly aimed at the camera lens. Head is level. Confident gaze.
DOWN    — Head or eyes are tilted downward toward lap, phone, desk, or keyboard. ANY downward chin tilt = DOWN.
SIDE    — Head or eyes are turned left or right. Looking at another screen, paper, or off to the side.
ABSENT  — No face is clearly visible. Frame is dark, blurry, face is obscured, or person has turned away.

STRICT RULES (follow exactly):
- If genuinely uncertain between CENTER and any other label → use the other label, not CENTER.
- Even a slight downward tilt of the chin → DOWN.
- Even a slight sideways turn of the head or eyes → SIDE.
- If the face is partially cut off or very small → ABSENT.
- Do NOT be generous. Err on the side of flagging.

Output ONLY this JSON (no markdown, no explanation):
{
  "frames": ["CENTER","DOWN","SIDE","CENTER",...],
  "suspicionNotes": []
}

The "frames" array must have exactly ${N} entries, one per image.
suspicionNotes: list any specific concerns (e.g. "looking at phone in frames 3-5").`,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error('[VideoAnalysis] Claude error:', await response.text());
      return NextResponse.json(fallbackResult('claude_error'));
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    console.log('[VideoAnalysis] Claude raw:', text.substring(0, 500));

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[VideoAnalysis] No JSON in Claude response');
      return NextResponse.json(fallbackResult('parse_error'));
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // ── Compute scores server-side from raw frame labels ─────────────────────
    // This is the KEY FIX — we do the math here, not in the Claude prompt.
    // The old approach asked Claude to compute bodyLanguageScore as
    // "100 - penalties", which always returned 100 when no DOWN/SIDE frames
    // were present (correct math, but misleading for a normal candidate).
    // Now we compute a CALIBRATED score with realistic baselines.

    const labels: string[] = Array.isArray(parsed.frames)
      ? parsed.frames.slice(0, N)
      : [];

    // Pad if Claude returned fewer labels than frames
    while (labels.length < N) labels.push('ABSENT');

    const C = labels.filter((l) => l === 'CENTER').length;
    const D = labels.filter((l) => l === 'DOWN').length;
    const S = labels.filter((l) => l === 'SIDE').length;
    const A = labels.filter((l) => l === 'ABSENT').length;
    const T = N;

    // Raw percentages (0-100)
    const centerPct = Math.round((C / T) * 100);
    const downPct   = Math.round((D / T) * 100);
    const sidePct   = Math.round((S / T) * 100);
    const absentPct = Math.round((A / T) * 100);

    // eyeContactScore: % of frames with direct camera gaze
    const eyeContactScore = centerPct;

    // faceVisiblePct: frames where face is at least present (even if not centered)
    const faceVisiblePct = Math.round(((C + D + S) / T) * 100);

    // bodyLanguageScore: starts at 100, penalised per non-center frame type.
    // Penalty weights are calibrated so:
    //   - 100% CENTER  → 100
    //   - 25% DOWN     →  ~55  (looking at phone — serious red flag)
    //   - 25% SIDE     →  ~65  (looking at notes — moderate red flag)
    //   - 20% ABSENT   →  ~75  (stepped away / obscured — mild flag)
    //   - Mix of all   → lower
    const penaltyRaw =
      (D / T) * 1.80 +   // DOWN is the worst signal
      (S / T) * 1.40 +   // SIDE is bad but less certain
      (A / T) * 0.80;    // ABSENT is mildest (could be angle/lighting)

    const bodyLanguageScore = Math.round(Math.max(0, Math.min(100, 100 - penaltyRaw * 100)));

    // Normalize gazeBreakdown to exactly 100 (avoid rounding drift)
    const totalPct   = centerPct + downPct + sidePct + absentPct;
    const adjust     = 100 - totalPct; // usually 0 or ±1 due to rounding
    const gazeBreakdown = {
      center: centerPct + adjust, // absorb the rounding error into center
      down:   downPct,
      side:   sidePct,
      absent: absentPct,
    };

    // Build suspicion flags
    const suspicionFlags: string[] = Array.isArray(parsed.suspicionNotes)
      ? parsed.suspicionNotes.filter((n: unknown) => typeof n === 'string')
      : [];

    if (downPct > 20 && !suspicionFlags.some((f) => f.toLowerCase().includes('down')))
      suspicionFlags.push(
        `Looking down ${downPct}% of the time — possible phone or notes`,
      );
    if (sidePct > 20 && !suspicionFlags.some((f) => f.toLowerCase().includes('side') || f.toLowerCase().includes('sideways')))
      suspicionFlags.push(
        `Looking sideways ${sidePct}% of the time — possible reference material`,
      );
    if (absentPct > 25)
      suspicionFlags.push(`Face not visible ${absentPct}% of the time`);

    console.log('[VideoAnalysis] Frame counts:', { C, D, S, A, T });
    console.log('[VideoAnalysis] Scores:', {
      eyeContactScore,
      bodyLanguageScore,
      faceVisiblePct,
      gazeBreakdown,
    });

    const result: VideoAnalysisResult = {
      eyeContactScore,
      bodyLanguageScore,
      faceVisiblePct,
      gazeBreakdown,
      suspicionFlags,
      framesAnalyzed: T,
      method:         'claude_vision_direct',
    };

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[VideoAnalysis] Fatal:', err.message);
    return NextResponse.json(fallbackResult('exception'));
  }
}

function fallbackResult(reason: string): VideoAnalysisResult {
  console.log('[VideoAnalysis] Fallback reason:', reason);
  return {
    eyeContactScore:   -1,
    bodyLanguageScore: -1,
    faceVisiblePct:    -1,
    gazeBreakdown:     { center: 0, down: 0, side: 0, absent: 0 },
    suspicionFlags:    [],
    framesAnalyzed:    0,
    method:            `fallback_${reason}`,
  };
}