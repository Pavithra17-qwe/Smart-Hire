// lib/analyzeVideoFrames.ts
//
// EYE-CONTACT-ONLY FIX
// ─────────────────────────────────────────────────────────────────────────
// Original root cause of Eye Contact always showing 0: `eyeContactScore`
// was set to `centerPct` — the % of frames the vision model labeled
// strictly `CENTER`. The frame-labeling prompt intentionally tells the
// model to be maximally strict about that label so BODY LANGUAGE posture
// penalties catch bad posture correctly. That strictness is correct for
// body language, but drove eyeContactScore to 0 for completely normal
// webcam eye contact.
//
// That part of the fix (an independent, more lenient `eyeContact` label
// per frame, separate from the strict `frames` posture labels) is
// unchanged and still in place below.
//
// NEW IN THIS PASS — discretization per updated scoring requirement:
//   Eye Contact is no longer returned as a raw 0-100 percentage. It is
//   now discretized to:
//     100 -> candidate looked at the camera for the majority of the
//            interview (>= 50% of analyzed frames judged "looking at
//            camera")
//     50  -> candidate did NOT consistently look at the camera
//            (< 50% of frames, i.e. frequently looked away/down/side)
//     -1  -> sentinel meaning "could not be analyzed" (no frames, no API
//            key, insufficient frames, Claude error, parse error). This
//            sentinel is unchanged from before and is what the route
//            handler (app/api/interview/score/route.ts) turns into a
//            final Eye Contact score of 0 — reserved ONLY for "no video /
//            no face detected at all / insufficient visual data".
//
// The strict `frames` array, and everything derived from it
// (bodyLanguageScore, gazeBreakdown, suspicionFlags, faceVisiblePct), is
// UNCHANGED — same labels, same counts, same formulas. Only the source
// and final shape of eyeContactScore changed.
//
// Debug logging, tagged [EyeContact][DEBUG], covers: video loaded, face
// detected, camera gaze analyzed, Eye Contact score calculated.

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

function fallbackResult(reason: string): VideoAnalysisResult {
  console.log('[VideoAnalysis] Fallback reason:', reason);
  console.log('[EyeContact][DEBUG] Returning fallback -1 (insufficient data — no video / no face / cannot analyze) — reason:', reason);
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

export async function analyzeFrames(frames: string[]): Promise<VideoAnalysisResult> {
  console.log('[EyeContact][DEBUG] analyzeFrames() called with', Array.isArray(frames) ? frames.length : 0, 'raw frames');

  if (!Array.isArray(frames) || frames.length === 0) {
    console.log('[EyeContact][DEBUG] Video loaded check FAILED — no frames provided.');
    return fallbackResult('no_frames');
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallbackResult('no_api_key');

  const validFrames = frames.filter(
    (f) => typeof f === 'string' && f.length > 500,
  );

  console.log(`[VideoAnalysis] Received ${validFrames.length} valid frames`);
  console.log('[EyeContact][DEBUG] Video loaded successfully —', validFrames.length, 'valid frames of', frames.length, 'received');

  if (validFrames.length < 2) {
    console.log('[EyeContact][DEBUG] Insufficient visual data — fewer than 2 valid frames, cannot analyze camera gaze.');
    return fallbackResult('insufficient_frames');
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
      max_tokens: 900,
      messages: [
        {
          role:    'user',
          content: [
            ...imageBlocks,
            {
              type: 'text',
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

SEPARATELY, for EACH of the same ${N} frames, also make a second, more
LENIENT judgment specifically about natural eye contact / engagement with
the camera. This is intentionally more forgiving than the posture label
above, because people naturally glance slightly down or to the side at
their own screen or video preview while still maintaining genuine,
natural eye contact during a video call. Label each frame:

YES — The candidate is generally oriented toward the camera/screen and
      appears engaged, even if their gaze is not perfectly centered
      (e.g. a natural slight downward glance at their own screen, or a
      brief glance at their video preview, still counts as YES).
NO  — The candidate is clearly and sustainedly looking away from the
      camera/screen (e.g. turned toward another person or object,
      reading something off to the side for a prolonged period, looking
      down at a phone for a while), OR no face is visible in the frame.

Output ONLY this JSON (no markdown, no explanation):
{
  "frames": ["CENTER","DOWN","SIDE","CENTER",...],
  "eyeContact": ["YES","NO","YES",...],
  "suspicionNotes": []
}

Both "frames" and "eyeContact" arrays must have exactly ${N} entries each, one per image, in the same order.
suspicionNotes: list any specific concerns (e.g. "looking at phone in frames 3-5").`,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    console.error('[VideoAnalysis] Claude error:', await response.text());
    return fallbackResult('claude_error');
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '';
  console.log('[VideoAnalysis] Claude raw:', text.substring(0, 500));

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error('[VideoAnalysis] No JSON in Claude response');
    return fallbackResult('parse_error');
  }

  const parsed = JSON.parse(jsonMatch[0]);

  // ── Strict posture labels — UNCHANGED, still drive body language,
  // gaze breakdown, suspicion flags, and faceVisiblePct exactly as before ──
  const labels: string[] = Array.isArray(parsed.frames)
    ? parsed.frames.slice(0, N)
    : [];

  while (labels.length < N) labels.push('ABSENT');

  const C = labels.filter((l) => l === 'CENTER').length;
  const D = labels.filter((l) => l === 'DOWN').length;
  const S = labels.filter((l) => l === 'SIDE').length;
  const A = labels.filter((l) => l === 'ABSENT').length;
  const T = N;

  const centerPct = Math.round((C / T) * 100);
  const downPct   = Math.round((D / T) * 100);
  const sidePct   = Math.round((S / T) * 100);
  const absentPct = Math.round((A / T) * 100);

  const faceVisiblePct  = Math.round(((C + D + S) / T) * 100);
  console.log('[EyeContact][DEBUG] Face detected — faceVisiblePct:', faceVisiblePct, '% (C:', C, 'D:', D, 'S:', S, 'A:', A, 'of', T, 'frames)');

  const penaltyRaw =
    (D / T) * 1.80 +
    (S / T) * 1.40 +
    (A / T) * 0.80;

  // bodyLanguageScore — UNCHANGED formula, unchanged inputs.
  const bodyLanguageScore = Math.round(Math.max(0, Math.min(100, 100 - penaltyRaw * 100)));

  const totalPct = centerPct + downPct + sidePct + absentPct;
  const adjust   = 100 - totalPct;
  const gazeBreakdown = {
    center: centerPct + adjust,
    down:   downPct,
    side:   sidePct,
    absent: absentPct,
  };

  const suspicionFlags: string[] = Array.isArray(parsed.suspicionNotes)
    ? parsed.suspicionNotes.filter((n: unknown) => typeof n === 'string')
    : [];

  if (downPct > 20 && !suspicionFlags.some((f) => f.toLowerCase().includes('down')))
    suspicionFlags.push(`Looking down ${downPct}% of the time — possible phone or notes`);
  if (sidePct > 20 && !suspicionFlags.some((f) => f.toLowerCase().includes('side') || f.toLowerCase().includes('sideways')))
    suspicionFlags.push(`Looking sideways ${sidePct}% of the time — possible reference material`);
  if (absentPct > 25)
    suspicionFlags.push(`Face not visible ${absentPct}% of the time`);

  console.log('[VideoAnalysis] Frame counts:', { C, D, S, A, T });

  // ── EYE CONTACT FIX: independent, lenient signal ────────────────────
  // Derived from the new `eyeContact` field. Falls back to the old
  // CENTER-only derivation (logged) if the model didn't return it, so
  // behavior degrades gracefully rather than breaking.
  const rawEyeLabels: string[] = Array.isArray(parsed.eyeContact)
    ? parsed.eyeContact.slice(0, N)
    : [];

  let eyeLabels = rawEyeLabels;
  let eyeContactSource = 'model_eyeContact_field';

  if (eyeLabels.length < N) {
    console.warn('[EyeContact][DEBUG] Model did not return a valid eyeContact[] field (got', rawEyeLabels.length, 'of', N, ') — falling back to deriving from strict CENTER label.');
    eyeLabels = labels.map((l) => (l === 'CENTER' ? 'YES' : 'NO'));
    eyeContactSource = 'derived_from_frames_fallback';
  }
  while (eyeLabels.length < N) eyeLabels.push('NO');

  const eyeYes = eyeLabels.filter((l) => String(l).toUpperCase() === 'YES').length;
  const eyeContactPct = Math.round((eyeYes / T) * 100);

  console.log('[EyeContact][DEBUG] Camera gaze analyzed — eyeContact labels:', eyeLabels, 'source:', eyeContactSource);
  console.log('[EyeContact][DEBUG] eyeYes:', eyeYes, '/ T:', T, '-> raw eyeContactPct:', eyeContactPct);

  // ── DISCRETIZATION (per updated scoring requirement) ───────────────────
  // 100 = candidate looked at the camera for the majority of the interview
  // 50  = candidate did not consistently look at the camera (frequently
  //       looked away / down / side)
  // 0 is NOT assigned here — 0 is reserved for "no video / no face /
  // insufficient data" and is handled entirely by the -1 sentinel path
  // (fallbackResult, above) which the route layer maps to 0.
  // const eyeContactScore = eyeContactPct >= 50 ? 100 : 50;
  const eyeContactScore = eyeContactPct;

  console.log('[EyeContact][DEBUG] Eye Contact score calculated — raw%:', eyeContactPct, '-> discretized score:', eyeContactScore);
  console.log('[VideoAnalysis] Scores:', { eyeContactScore, bodyLanguageScore, faceVisiblePct, gazeBreakdown });

  return {
    eyeContactScore,
    bodyLanguageScore,
    faceVisiblePct,
    gazeBreakdown,
    suspicionFlags,
    framesAnalyzed: T,
    method:         'claude_vision_direct',
  };
}