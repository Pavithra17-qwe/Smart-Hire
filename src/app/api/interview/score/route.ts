// app/api/interview/score/route.ts
//
// EYE-CONTACT-ONLY FIX (v4 — removes binary discretization)
// ─────────────────────────────────────────────────────────────────────────
// No scoring logic changed in this file except Eye Contact. Technical/
// Communication/Body Language/Overall Score and all existing data-source
// selection logic (hasVideoData / hasClientData / noValidFaceAtAll /
// clamping / Firestore shape / response shape) are unchanged.
//
// ROOT CAUSE OF "always 50":
//   A previous pass added a STAGE 2b discretization step that collapsed the
//   real, continuously-calculated eye-contact percentage (correctly computed
//   in lib/analyzeVideoFrames.ts across the FULL interview) into only two
//   possible values: 100 (>= 50%) or 50 (< 50%). Any candidate whose
//   full-interview "looking at camera" percentage was under 50% — which is
//   common even with genuinely good eye contact, since the underlying
//   per-frame judgment is deliberately strict — was forced to exactly 50,
//   regardless of their true score.
//
// FIX: STAGE 2b discretization removed entirely. finalEyeContact now keeps
// the real, continuous percentage produced upstream (from analyzeFrames()
// or client MediaPipe) all the way through to the response and Firestore.
// The only remaining forced value is 0, and only when there is genuinely
// no usable face/video data at all (dataSource === 'default_no_data' or
// faceVisiblePct === 0) — handled by the existing noValidFaceAtAll check,
// which is unchanged.
//
// Body Language logic is completely untouched by this fix (it was never
// discretized and had no 50-fallback issue).

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { analyzeFrames } from '@/lib/analyzeVideoFrames';


export async function POST(req: NextRequest) {


  let candidateId = '';
  let snap: FirebaseFirestore.QuerySnapshot | null = null;


  // ── Hoisted so the catch block can still access whatever was computed
  // before a downstream (e.g. Groq) failure ──────────────────────────────
  let finalEyeContact:   number | null = null;
  let finalBodyLanguage: number | null = null; // raw, visual-only until STEP 10 blend
  let finalFacePct:      number | null = null;
  let finalGaze          = { center: 0, down: 0, side: 0, absent: 0 };
  let finalSuspicion:    string[] = [];
  let dataSource:        string   = 'not_computed';
  let bodyLanguageFeedback: string = '';
  let transcriptsOuter:  string[] = [];
  let answeredCountOuter = 0;
  let totalQuestionsOuter = 0;


  const round = (n: number) => Math.round(n);
  const clampScore = (val: unknown, min = 0, max = 100) =>
    Math.round(Math.max(min, Math.min(max, Number(val) || 0)));


  try {
    const body = await req.json();
    const {
      token, questions, jobRole, codeAnswer, codeLanguage, videoUrls,
      eyeContactScore:   clientEyeScore,
      bodyLanguageScore: clientBodyScore,
      faceVisiblePct:    clientFacePct,
      timings,
    } = body;


    candidateId = body.candidateId || '';


    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }


    snap = await adminDb
      .collection('ai_interviews')
      .where('token', '==', token)
      .limit(1)
      .get();


    if (snap.empty) {
      return NextResponse.json({ error: 'Interview not found' }, { status: 404 });
    }


    const docData    = snap.docs[0].data();
    const resumeText = docData.resumeText     || '';
    const jd         = docData.jobDescription || '';


    const questionList: string[] = Array.isArray(questions) && questions.length > 0
      ? questions
      : (docData.questions || []);


    // ── Extract MediaPipe + integrity data from client ──────────────────
    const clientSuspicionFlags: string[] = Array.isArray(body.suspicionFlags)
      ? body.suspicionFlags : [];


    const clientGazeBreakdown: {
      center: number; down: number; side: number; absent: number;
    } = body.gazeBreakdown ?? { center: 0, down: 0, side: 0, absent: 0 };


    console.log('[Score] Incoming payload check:', {
      hasVideoFrames:     Array.isArray(body.videoFrames),
      videoFramesLength:  Array.isArray(body.videoFrames) ? body.videoFrames.length : 0,
      clientEyeScore,
      clientBodyScore,
      clientFacePct,
      clientGazeBreakdown,
    });
    console.log('[EyeContact][DEBUG] STAGE 0 — Video loaded check / incoming client eye contact value:', clientEyeScore, 'clientFacePct:', clientFacePct);


    // ══════════════════════════════════════════════════════════════════
    // STEP A: Server-side video analysis + data-source selection.
    // Runs UNCONDITIONALLY, regardless of whether the candidate answered
    // any questions verbally — body language / eye contact are camera
    // signals, not speech signals.
    // ══════════════════════════════════════════════════════════════════
    let videoEyeScore:   number  = -1;
    let videoBodyScore:  number  = -1;
    let videoFacePct:    number  = -1;
    let videoGaze       = { center: 0, down: 0, side: 0, absent: 0 };
    let videoSuspicion: string[] = [];
    let videoAnalysisMethod      = 'none';


    const videoFrames: string[] = Array.isArray(body.videoFrames) ? body.videoFrames : [];
    console.log('[Score] videoFrames received:', videoFrames.length);


    if (videoFrames.length >= 2) {
      try {
        console.log(`[Score] Analyzing ${videoFrames.length} frames directly...`);
        console.log('[EyeContact][DEBUG] Video loaded successfully —', videoFrames.length, 'frames handed to analyzeFrames()');
        const analysisData = await analyzeFrames(videoFrames);
        console.log('[Score] analyzeFrames() raw output:', JSON.stringify(analysisData));
        console.log('[EyeContact][DEBUG] STAGE 1 — analyzeFrames() returned eyeContactScore:', analysisData.eyeContactScore, 'faceVisiblePct:', analysisData.faceVisiblePct, 'method:', analysisData.method);


        if (analysisData.eyeContactScore >= 0) {
          videoEyeScore       = analysisData.eyeContactScore;
          videoBodyScore      = analysisData.bodyLanguageScore;
          videoFacePct        = analysisData.faceVisiblePct;
          videoGaze           = analysisData.gazeBreakdown;
          videoSuspicion      = analysisData.suspicionFlags || [];
          videoAnalysisMethod = analysisData.method;
          console.log('[Score] Video analysis succeeded:', {
            eye: videoEyeScore, body: videoBodyScore, facePct: videoFacePct, method: videoAnalysisMethod,
          });
        } else {
          console.warn('[Score] analyzeFrames() returned a negative/invalid eyeContactScore — treating as no data.');
          console.warn('[EyeContact][DEBUG] STAGE 1 — eyeContactScore was negative (insufficient visual data), video data treated as unusable.');
        }
      } catch (err: any) {
        console.warn('[Score] Video analysis failed (non-fatal):', err.message);
        console.warn('[EyeContact][DEBUG] STAGE 1 — analyzeFrames() threw:', err.message);
      }
    } else {
      console.log('[Score] Fewer than 2 frames received — skipping video analysis.');
      console.log('[EyeContact][DEBUG] STAGE 1 — skipped (fewer than 2 video frames / no video available).');
    }


    console.log('[Score] Client MediaPipe scores received:', {
      clientEyeScore, clientBodyScore, clientFacePct, clientGazeBreakdown,
    });


    // A source only counts as "valid data" if faceVisiblePct > 0 — a score
    // of 0 paired with 0% face visibility means tracking never actually ran.
    const hasVideoData  = videoEyeScore >= 0 && videoBodyScore >= 0 && videoFacePct > 0;
    const hasClientData = typeof clientEyeScore === 'number' && clientEyeScore >= 0 &&
                          typeof clientBodyScore === 'number' && clientBodyScore >= 0 &&
                          typeof clientFacePct === 'number' && clientFacePct > 0;


    if (hasVideoData) {
      finalEyeContact   = videoEyeScore;
      finalBodyLanguage = videoBodyScore;
      finalFacePct      = videoFacePct;
      finalGaze         = videoGaze;
      finalSuspicion    = [...new Set([...videoSuspicion, ...clientSuspicionFlags])];
      dataSource        = `claude_vision_${videoAnalysisMethod}`;
      console.log('[Score] Data source selected: claude_vision (server video analysis)');
      console.log('[EyeContact][DEBUG] Face detected via server video analysis — faceVisiblePct:', finalFacePct);
    } else if (hasClientData) {
      finalEyeContact   = clientEyeScore;
      finalBodyLanguage = clientBodyScore;
      finalFacePct      = clientFacePct;
      finalGaze         = clientGazeBreakdown;
      finalSuspicion    = clientSuspicionFlags;
      dataSource        = 'client_mediapipe';
      console.log('[Score] Data source selected: client_mediapipe (server analysis unavailable/invalid)');
      console.log('[EyeContact][DEBUG] Face detected via client MediaPipe — faceVisiblePct:', finalFacePct);
    } else {
      // Neither server video analysis nor client MediaPipe produced usable
      // face-tracking data. This is the ONLY case (besides faceVisiblePct
      // === 0 below) where 0 is legitimate — no video/face data exists at all.
      finalEyeContact   = 0;
      finalBodyLanguage = 0;
      finalFacePct      = 0;
      finalGaze         = { center: 0, down: 0, side: 0, absent: 100 };
      finalSuspicion    = [];
      dataSource        = 'default_no_data';
      console.log('[Score] Data source selected: default_no_data — no usable face-tracking data from any source.');
      console.log('[EyeContact][DEBUG] No face detected / no video / insufficient data — Eye Contact will be 0.');
    }
    console.log('[EyeContact][DEBUG] STAGE 2 — dataSource:', dataSource, '-> finalEyeContact (pre zero-out check):', finalEyeContact, 'finalFacePct:', finalFacePct);


    // ══════════════════════════════════════════════════════════════════
    // EYE CONTACT FIX — STAGE 2b (v4): NO discretization.
    // finalEyeContact is kept exactly as the real, continuous percentage
    // of the FULL interview the candidate was judged to be looking at the
    // camera (from analyzeFrames()'s full-video analysis, or client
    // MediaPipe). Do NOT collapse this into 100/50 buckets — that was the
    // root cause of the "always 50" bug. The only legitimate forced value
    // is 0, applied below by the existing noValidFaceAtAll check for
    // genuine "no data" cases.
    // ══════════════════════════════════════════════════════════════════
    console.log('[EyeContact][DEBUG] STAGE 2b — Eye Contact kept as real analyzed percentage (no discretization applied):', finalEyeContact);


    // ── FIX 1 (unchanged): proportional scoring, no arbitrary
    // threshold zero-out. 0 is only correct when there is NO valid
    // face/video at all — handled by dataSource === 'default_no_data' or
    // faceVisiblePct === 0 (video existed but no face was ever detected).
    const noValidFaceAtAll =
      dataSource === 'default_no_data' ||
      (finalFacePct !== null && finalFacePct === 0);


    if (noValidFaceAtAll) {
      finalEyeContact   = 0;
      finalBodyLanguage = 0;
    }
    console.log('[EyeContact][DEBUG] STAGE 3 — noValidFaceAtAll:', noValidFaceAtAll, '-> finalEyeContact (post zero-out check):', finalEyeContact);


    // ── Build the human-readable body-language feedback string ─────────
    if (dataSource === 'default_no_data') {
      bodyLanguageFeedback = 'No usable camera tracking data was available for this session (no video recorded, or face was never detected).';
    } else if (noValidFaceAtAll) {
      bodyLanguageFeedback = 'Face was never detected in the recorded video.';
    } else if (finalFacePct !== null && finalFacePct < 20) {
      bodyLanguageFeedback = `Face was only visible ${finalFacePct}% of the interview, so scores below reflect limited but real tracking data.`;
    } else if (finalGaze.down > 25) {
      bodyLanguageFeedback = `Candidate looked down ${finalGaze.down}% of the time — possible phone or notes use.`;
    } else if (finalGaze.side > 25) {
      bodyLanguageFeedback = `Candidate looked sideways ${finalGaze.side}% of the time — possible reference material.`;
    } else if (finalGaze.absent > 20) {
      bodyLanguageFeedback = `Face was absent from frame ${finalGaze.absent}% of the time.`;
    } else if ((finalEyeContact ?? 0) >= 70) {
      bodyLanguageFeedback = `Good eye contact maintained ${finalGaze.center}% of the time.`;
    } else {
      bodyLanguageFeedback = `Eye contact was ${finalGaze.center}% — candidate should look more directly at the camera.`;
    }


    console.log('[Score] Visual (pre-blend) eye/body scores:', {
      eyeContact:   finalEyeContact,
      bodyLanguage: finalBodyLanguage,
      facePct:      finalFacePct,
      source:       dataSource,
      gaze:         finalGaze,
    });


    // ── STEP 1: Get transcripts (UNCHANGED) ─────────────────────────────
    const clientTranscripts: string[] = Array.isArray(body.transcripts)
      ? body.transcripts : [];


    let transcripts: string[]   = [];
    let existingAnswers: any[]  = [];


    if (Array.isArray(clientTranscripts) && clientTranscripts.length > 0) {
      console.log('[Score] Using client transcripts');
      transcripts     = questionList.map((_, i) => (clientTranscripts[i] || '').trim());
      existingAnswers = questionList.map((_, i) => ({
        videoUrl:   videoUrls?.[i] || '',
        transcript: clientTranscripts[i] || '',
      }));
    } else {
      console.log('[Score] Falling back to Firestore answers_map');
      await new Promise(r => setTimeout(r, 12000));


      const freshSnap  = await adminDb.collection('ai_interviews')
        .where('token', '==', token).limit(1).get();
      const freshData  = freshSnap.empty ? docData : freshSnap.docs[0].data();
      const answersMap = freshData.answers_map || {};


      console.log('[Score] answers_map keys:', Object.keys(answersMap));
      transcripts     = questionList.map((_, i) => answersMap[`q${i}`]?.transcript || '');
      existingAnswers = questionList.map((_, i) => answersMap[`q${i}`] || null);
    }


    transcriptsOuter = transcripts;


    console.log('[Score] Transcripts:', transcripts.map((t, i) =>
      `Q${i+1}: "${t.substring(0, 50)}"`));


    // ── STEP 2: Classify answers (UNCHANGED) ────────────────────────────
    const isRealAnswer = (t: string) =>
      t?.trim().length >= 3 && t.trim().split(/\s+/).filter(Boolean).length >= 1;


    const answerMap = questionList.map((q, i) => ({
      question:   q,
      transcript: transcripts[i]?.trim() || '',
      hasVideo:   !!existingAnswers?.[i]?.videoUrl,
      answered:   isRealAnswer(transcripts[i] || ''),
    }));


    const answeredCount  = answerMap.filter(a => a.answered).length;
    const totalQuestions = questionList.length;
    answeredCountOuter  = answeredCount;
    totalQuestionsOuter = totalQuestions;


    console.log(`[Score] Answered ${answeredCount}/${totalQuestions}`);


    // ── STEP 2.5: Short-circuit — zero meaningful VERBAL responses (UNCHANGED
    // Technical/Communication logic; body/eye still camera-derived) ────────
    if (answeredCount === 0) {
      const noEvalResult = {
        score:                 0,
        technicalScore:        0,
        communicationScore:    0,
        bodyLanguageScore:     clampScore(finalBodyLanguage),
        eyeContactScore:       clampScore(finalEyeContact),
        summary:               'The candidate did not answer any interview questions verbally. Technical and communication scores are 0 and could not be evaluated.'
          + (dataSource !== 'default_no_data' ? ' Body language and eye contact were still assessed from the camera feed.' : ''),
        technicalFeedback:     'Not Evaluated',
        communicationFeedback: 'Not Evaluated',
        bodyLanguageFeedback,
        recommendation:        'No',
        strengths:             ['None'] as string[],
        improvements:          ['Candidate did not provide any spoken responses during the interview.'] as string[],
        evaluationStatus:      'evaluated',
      };


      console.log('[Score] No verbal responses — skipping Groq technical/communication evaluation. Body/eye scores still computed from camera data:', {
        bodyLanguageScore: noEvalResult.bodyLanguageScore,
        eyeContactScore:   noEvalResult.eyeContactScore,
        source:            dataSource,
      });
      console.log('[EyeContact][DEBUG] STAGE 4 (no-verbal-answer path) — eyeContactScore returned to client:', noEvalResult.eyeContactScore);


      await snap.docs[0].ref.update({
        status:                  'completed',
        aiScore:                 0,
        aiTechnicalScore:        0,
        aiCommunicationScore:    0,
        aiBodyLanguageScore:     noEvalResult.bodyLanguageScore,
        aiEyeContactScore:       noEvalResult.eyeContactScore,
        aiSummary:               noEvalResult.summary,
        aiTechnicalFeedback:     noEvalResult.technicalFeedback,
        aiCommunicationFeedback: noEvalResult.communicationFeedback,
        aiBodyLanguageFeedback:  noEvalResult.bodyLanguageFeedback,
        aiRecommendation:        noEvalResult.recommendation,
        aiStrengths:             noEvalResult.strengths,
        aiImprovements:          noEvalResult.improvements,
        transcripts,
        answeredQuestions:       0,
        totalQuestions,
        scoredAt:                FieldValue.serverTimestamp(),
        suspicionFlags:          finalSuspicion,
        gazeBreakdown:           finalGaze,
        integrityStatus:         finalSuspicion.length > 0 ? 'flagged' : 'clean',
        videoAnalysisSource:     dataSource,
        evaluationStatus:        noEvalResult.evaluationStatus,
      });
      console.log('[EyeContact][DEBUG] STAGE 5 (no-verbal-answer path) — Eye Contact score saved to Firestore:', noEvalResult.eyeContactScore);


      if (candidateId) {
        await adminDb.doc(`candidates/${candidateId}`).update({
          l1AIStatus:              'completed',
          l1AIScore:               0,
          l1AIVideoUrl:            videoUrls?.[0] || '',
          l1AICodeAnswer:          codeAnswer || '',
          l1AITechnicalScore:      0,
          l1AICommunicationScore:  0,
          l1AIBodyLanguageScore:   noEvalResult.bodyLanguageScore,
          l1AIEyeContactScore:     noEvalResult.eyeContactScore,
          l1AISummary:             noEvalResult.summary,
          l1AIFeedback:            noEvalResult.technicalFeedback,
          l1AIRecommendation:      noEvalResult.recommendation,
          l1AIStrengths:           noEvalResult.strengths,
          l1AIImprovements:        noEvalResult.improvements,
          l1AIAnsweredCount:       0,
          l1AITotalQuestions:      totalQuestions,
          l1AICompletedAt:         FieldValue.serverTimestamp(),
          lastUpdated:             FieldValue.serverTimestamp(),
          l1AISuspicionFlags:      finalSuspicion,
          l1AIGazeBreakdown:       finalGaze,
          l1AIIntegrityStatus:     finalSuspicion.length > 0 ? 'flagged' : 'clean',
          l1AIQuestions:           questionList,
          l1AITranscripts:         transcripts,
          l1AITimings:             Array.isArray(timings) ? timings : [],
          l1AIVideoAnalysisSource: dataSource,
          l1AIEvaluationStatus:    noEvalResult.evaluationStatus,
        });
      }


      console.log('[EyeContact][DEBUG] STAGE 6 (no-verbal-answer path) — Eye Contact score returned to UI:', noEvalResult.eyeContactScore);
      return NextResponse.json(noEvalResult);
    }


    // ── STEP 5: Build answers text (UNCHANGED) ──────────────────────────
    const answersText = answerMap.map((a, i) => {
      if (a.answered) {
        return `Q${i+1}: ${a.question}\nAnswer: ${a.transcript}\nStatus: ANSWERED`;
      } else if (a.hasVideo) {
        return `Q${i+1}: ${a.question}\nAnswer: [Recorded but no speech detected]\nStatus: NOT_ANSWERED`;
      } else {
        return `Q${i+1}: ${a.question}\nAnswer: [No recording]\nStatus: SKIPPED`;
      }
    }).join('\n\n');


    const codeSection = codeAnswer?.trim()
      ? `\nCODING SUBMISSION (${codeLanguage || 'unknown'}):\n${codeAnswer.trim()}`
      : '';


    const timingsSection = Array.isArray(timings) && timings.length > 0
      ? `\nTIME TAKEN PER QUESTION (seconds): ${timings.map((t: number, i: number) => `Q${i+1}: ${t}s`).join(', ')}\nNote: very short answers (under 15s) likely lack depth.`
      : '';


    // ── STEP 6 & 7: Groq prompt + call — TECHNICAL/COMMUNICATION LOGIC
    // COMPLETELY UNCHANGED ────────────────────────────────────────────────
    const prompt = `You are a fair and balanced interviewer scoring a ${jobRole} candidate.


IMPORTANT CONTEXT: Answers are captured via speech-to-text which introduces transcription errors
(mishearing words, run-on sentences, missing punctuation). Judge the SUBSTANCE and INTENT of
what was said, not the transcription quality. "sanitary testing" means "sanity testing".
"jeera" means "Jira". Overlook phonetic errors and incomplete sentences caused by STT.


RESUME:
${resumeText || 'Not provided.'}


JOB DESCRIPTION:
${jd || 'Not provided.'}


INTERVIEW ANSWERS (${answeredCount} of ${totalQuestions} questions answered):
${answersText}
${codeSection}
${timingsSection}


SCORING RULES:


There are 5 interview questions, each worth 20 marks. Evaluate every question
independently, based only on that question's response, then sum the 5
per-question marks for the final score.


Per-question scoring (0–20), applied identically for technicalScore and
communicationScore:
   - 0: No answer, blank, silent, or completely incorrect/irrelevant answer.
   - 1–5: Very poor understanding with incorrect or mostly irrelevant response.
   - 6–10: Partially correct but missing key concepts or containing major mistakes.
   - 11–15: Mostly correct with minor gaps or limited explanation.
   - 16–18: Correct answer with good explanation and relevant examples.
   - 19–20: Excellent, detailed, accurate answer with clear reasoning and practical examples.


1. technicalScore (0-100): sum of the 5 per-question technical marks (correctness,
   depth, relevance to the job role). Do not award marks for unanswered questions.


2. communicationScore (0-100): sum of the 5 per-question communication marks
   (clarity, confidence, structure, relevance — NOT transcription quality).
   Unanswered questions receive 0 marks.


Important:
   - Do not give marks simply because a question was answered.
   - A wrong or irrelevant answer receives 0–5 marks for that question.
   - An unanswered question must receive 0 marks for that question.
   - Base each question's score on quality, correctness, depth, and relevance —
     not on response length or speech-to-text transcription errors. Ignore minor
     speech recognition mistakes and judge the candidate's intended meaning.


Calibration reference only:
   - 5 excellent answers → 90–100
   - 4 good answers + 1 unanswered → 65–80
   - 3 excellent answers + 2 unanswered → around 55–60
   - 3 poor/wrong answers + 2 unanswered → around 5–20
   - All 5 answers wrong → 0–25


3. recommendation:
   - "Strong Yes" if technicalScore >= 72 AND answeredCount >= 4
   - "Yes" if technicalScore >= 58 AND answeredCount >= 3
   - "Maybe" if technicalScore >= 40 AND answeredCount >= 2
   - "No" for everything else


4. summary: 2–3 balanced sentences. Mention what they did well AND where to improve.


5. strengths: list at least 1–2 genuine strengths if the candidate answered any questions.


6. improvements: 2 specific, actionable gaps.


Output ONLY raw JSON, no markdown, no backticks:
{
  "technicalScore": <integer 0-100>,
  "communicationScore": <integer 0-100>,
  "summary": "<2-3 sentences>",
  "technicalFeedback": "<1-2 sentences>",
  "communicationFeedback": "<1-2 sentences>",
  "recommendation": "<Strong Yes | Yes | Maybe | No>",
  "strengths": ["<strength 1>", "<strength 2>"],
  "improvements": ["<gap 1>", "<gap 2>"]
}`;


    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model:       'llama-3.3-70b-versatile',
        messages: [
          {
            role:    'system',
            content:  'You are a fair technical interviewer. Answers come from speech-to-text — judge the substance and intent, not transcription artifacts. Be encouraging where merit exists. Output ONLY raw JSON.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens:  1000,
      }),
    });


    if (!groqRes.ok) {
      throw new Error(`Groq API ${groqRes.status}: ${await groqRes.text()}`);
    }


    const groqData = await groqRes.json();
    const content  = groqData.choices?.[0]?.message?.content || '';
    console.log('[Score] Groq raw:', content.substring(0, 300));


    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Groq response');


    const ev = JSON.parse(jsonMatch[0]);


    // ── STEP 8: Clamp technical/communication scores (UNCHANGED) ────────
    const tech = clampScore(ev.technicalScore);
    const comm = clampScore(ev.communicationScore);


    // ══════════════════════════════════════════════════════════════════
    // FIX 2 (unchanged): Body Language may take overall interview
    // behavior as a small supporting signal. Never reads or writes
    // tech/comm. Eye contact is intentionally left OUT of this blend —
    // it stays a pure reflection of camera gaze behavior.
    // ══════════════════════════════════════════════════════════════════
    const visualBodyLanguage = finalBodyLanguage ?? 0;

    if (!noValidFaceAtAll) {
      const answerQualityAvg = (tech + comm) / 2; // 0-100, purely for the blend
      const blended = visualBodyLanguage * 0.85 + answerQualityAvg * 0.15;
      finalBodyLanguage = Math.round(Math.max(0, Math.min(100, blended)));

      console.log('[Score] Body language blended with answer-quality signal:', {
        visualBodyLanguage, answerQualityAvg, blendedBodyLanguage: finalBodyLanguage,
      });
    }
    // finalEyeContact is untouched here — stays purely camera-derived,
    // as the real continuous percentage (no discretization).
    console.log('[EyeContact][DEBUG] STAGE 6 (post Groq, pre-overall) — finalEyeContact still:', finalEyeContact);


    // ── STEP 10: Overall score (weighted) + caps (UNCHANGED) ─────────────
    const computedOverall = round(
      tech                       * 0.50 +
      comm                       * 0.35 +
      (finalBodyLanguage ?? 0)   * 0.075 +
      (finalEyeContact ?? 0)     * 0.075,
    );


    const overallCap =
      answeredCount === 1 ? 45 :
      answeredCount === 2 ? 65 :
      answeredCount === 3 ? 80 :
      answeredCount === 4 ? 90 : 100;


    const finalOverall = Math.min(computedOverall, overallCap);


    let recommendation = String(ev.recommendation ?? 'No');
    if (answeredCount === 1 && finalOverall < 50)       recommendation = 'No';
    else if (answeredCount <= 2 && finalOverall < 60)   recommendation = 'Maybe';
    if (finalSuspicion.length >= 2 && recommendation === 'Strong Yes') recommendation = 'Yes';
    if (finalSuspicion.length >= 3)                                     recommendation = 'Maybe';


    const result = {
      score:                 finalOverall,
      technicalScore:        tech,
      communicationScore:    comm,
      bodyLanguageScore:     clampScore(finalBodyLanguage),
      eyeContactScore:       clampScore(finalEyeContact),
      summary:               String(ev.summary              ?? ''),
      technicalFeedback:     String(ev.technicalFeedback    ?? ''),
      communicationFeedback: String(ev.communicationFeedback ?? ''),
      bodyLanguageFeedback,
      recommendation,
      strengths:             Array.isArray(ev.strengths)    ? ev.strengths    : [],
      improvements:          Array.isArray(ev.improvements) ? ev.improvements : [],
      evaluationStatus:      'evaluated',
    };
    console.log('[EyeContact][DEBUG] STAGE 7 — clampScore(finalEyeContact) = eyeContactScore in result object:', result.eyeContactScore);


    console.log('[Score] Final result (pre-response):', {
      overall:   result.score,
      technical: result.technicalScore,
      comm:      result.communicationScore,
      eye:       result.eyeContactScore,
      body:      result.bodyLanguageScore,
      answered:  `${answeredCount}/${totalQuestions}`,
      source:    dataSource,
      integrity: finalSuspicion.length > 0 ? finalSuspicion : 'clean',
    });


    // ── STEP 11: Save to Firestore (UNCHANGED schema) ────────────────────
    await snap.docs[0].ref.update({
      status:                  'completed',
      aiScore:                 result.score,
      aiTechnicalScore:        result.technicalScore,
      aiCommunicationScore:    result.communicationScore,
      aiBodyLanguageScore:     result.bodyLanguageScore,
      aiEyeContactScore:       result.eyeContactScore,
      aiSummary:               result.summary,
      aiTechnicalFeedback:     result.technicalFeedback,
      aiCommunicationFeedback: result.communicationFeedback,
      aiBodyLanguageFeedback:  result.bodyLanguageFeedback,
      aiRecommendation:        result.recommendation,
      aiStrengths:             result.strengths,
      aiImprovements:          result.improvements,
      transcripts,
      answeredQuestions:       answeredCount,
      totalQuestions,
      scoredAt:                FieldValue.serverTimestamp(),
      suspicionFlags:          finalSuspicion,
      gazeBreakdown:           finalGaze,
      integrityStatus:         finalSuspicion.length > 0 ? 'flagged' : 'clean',
      videoAnalysisSource:     dataSource,
      evaluationStatus:        'evaluated',
    });
    console.log('[EyeContact][DEBUG] STAGE 8 — Eye Contact score saved to Firestore (ai_interviews doc):', result.eyeContactScore);


    if (candidateId) {
      await adminDb.doc(`candidates/${candidateId}`).update({
        l1AIStatus:              'completed',
        l1AIScore:               result.score,
        l1AIVideoUrl:            videoUrls?.[0] || '',
        l1AICodeAnswer:          codeAnswer || '',
        l1AITechnicalScore:      result.technicalScore,
        l1AICommunicationScore:  result.communicationScore,
        l1AIBodyLanguageScore:   result.bodyLanguageScore,
        l1AIEyeContactScore:     result.eyeContactScore,
        l1AISummary:             result.summary,
        l1AIFeedback:            result.technicalFeedback,
        l1AIRecommendation:      result.recommendation,
        l1AIStrengths:           result.strengths,
        l1AIImprovements:        result.improvements,
        l1AIAnsweredCount:       answeredCount,
        l1AITotalQuestions:      totalQuestions,
        l1AICompletedAt:         FieldValue.serverTimestamp(),
        lastUpdated:             FieldValue.serverTimestamp(),
        l1AISuspicionFlags:      finalSuspicion,
        l1AIGazeBreakdown:       finalGaze,
        l1AIIntegrityStatus:     finalSuspicion.length > 0 ? 'flagged' : 'clean',
        l1AIQuestions:           questionList,
        l1AITranscripts:         transcripts,
        l1AITimings:             Array.isArray(timings) ? timings : [],
        l1AIVideoAnalysisSource: dataSource,
        l1AIEvaluationStatus:    'evaluated',
      });
      console.log('[EyeContact][DEBUG] STAGE 9 — Eye Contact score saved to Firestore (candidate doc):', result.eyeContactScore);
    }


    console.log('[EyeContact][DEBUG] STAGE 10 — Eye Contact score returned to UI:', result.eyeContactScore);
    return NextResponse.json(result);


  } catch (err: any) {
    console.error('[Score] Error:', err.message);


    // If video/MediaPipe scoring already completed successfully before this
    // error occurred (e.g. Groq failed), preserve those real scores instead
    // of overwriting them with 0. Only technical/communication — the part
    // that actually failed — falls back to "Manual Review".
    const hasPreservedVideoScores = finalEyeContact !== null && finalBodyLanguage !== null;


    console.log('[Score] Entering error fallback. Preserved video scores available:', hasPreservedVideoScores, {
      finalEyeContact, finalBodyLanguage, dataSource,
    });
    console.log('[EyeContact][DEBUG] STAGE ERR — in catch block, finalEyeContact:', finalEyeContact, 'will be preserved:', hasPreservedVideoScores);


    const fallback = {
      score:              0,
      technicalScore:     0,
      communicationScore: 0,
      bodyLanguageScore:  hasPreservedVideoScores ? round(finalBodyLanguage as number) : 0,
      eyeContactScore:    hasPreservedVideoScores ? round(finalEyeContact as number)   : 0,
      summary: 'AI technical/communication evaluation could not be completed. Please review manually.'
        + (hasPreservedVideoScores ? ' Body language and eye contact scores were captured successfully.' : ''),
      technicalFeedback: '', communicationFeedback: '',
      bodyLanguageFeedback: hasPreservedVideoScores ? bodyLanguageFeedback : '',
      recommendation: 'Manual Review', strengths: [], improvements: [],
    };

    console.log('[EyeContact][DEBUG] STAGE ERR — Eye Contact score returned to UI (fallback path):', fallback.eyeContactScore);


    try {
      if (candidateId) {
        await adminDb.doc(`candidates/${candidateId}`).update({
          l1AIStatus:            'completed',
          l1AIScore:             0,
          l1AIBodyLanguageScore: fallback.bodyLanguageScore,
          l1AIEyeContactScore:   fallback.eyeContactScore,
          l1AISummary:           fallback.summary,
          l1AIRecommendation:    'Manual Review',
          l1AIStrengths:         [],
          l1AIImprovements:      [],
          l1AITranscripts:       transcriptsOuter,
          l1AIAnsweredCount:     answeredCountOuter,
          l1AITotalQuestions:    totalQuestionsOuter,
          l1AIVideoAnalysisSource: dataSource,
          l1AICompletedAt:       FieldValue.serverTimestamp(),
          lastUpdated:           FieldValue.serverTimestamp(),
        });
      }
      if (snap && !snap.empty) {
        await snap.docs[0].ref.update({
          status:              'completed',
          aiScore:             0,
          aiBodyLanguageScore: fallback.bodyLanguageScore,
          aiEyeContactScore:   fallback.eyeContactScore,
          aiSummary:           fallback.summary,
          videoAnalysisSource: dataSource,
          scoredAt:            FieldValue.serverTimestamp(),
        });
      }
    } catch (_) {}


    return NextResponse.json(fallback);
  }
}