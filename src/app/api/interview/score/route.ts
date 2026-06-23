// app/api/interview/score/route.ts — UPDATED VERSION
// KEY CHANGE: Calls /api/interview/analyze-video FIRST to get real eye/body scores from video
// Falls back to client MediaPipe data if video analysis fails
// Groq only scores technical + communication (no eye/body)

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { analyzeFrames } from '@/lib/analyzeVideoFrames';

export async function POST(req: NextRequest) {

  let candidateId = '';
  let snap: FirebaseFirestore.QuerySnapshot | null = null;

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

    // ── Extract MediaPipe + integrity data from client ────────────────────
    const clientSuspicionFlags: string[] = Array.isArray(body.suspicionFlags)
      ? body.suspicionFlags : [];

    const clientGazeBreakdown: {
      center: number; down: number; side: number; absent: number;
    } = body.gazeBreakdown ?? { center: 0, down: 0, side: 0, absent: 0 };

   // ── STEP 1: Server-side video analysis (Claude Vision via direct frames) ──
// ── STEP 1: Server-side video analysis (direct function call) ────────────────
let videoEyeScore:   number  = -1;
let videoBodyScore:  number  = -1;
let videoFacePct:    number  = -1;
let videoGaze       = { center: 0, down: 0, side: 0, absent: 0 };
let videoSuspicion: string[] = [];
let videoAnalysisMethod      = 'none';

const videoFrames: string[] = Array.isArray(body.videoFrames) ? body.videoFrames : [];
console.log('[Score] videoFrames received:', videoFrames.length); // ← ADD THIS

if (videoFrames.length >= 2) {
  try {
    console.log(`[Score] Analyzing ${videoFrames.length} frames directly...`);
    const analysisData = await analyzeFrames(videoFrames);
    if (analysisData.eyeContactScore >= 0) {
      videoEyeScore       = analysisData.eyeContactScore;
      videoBodyScore      = analysisData.bodyLanguageScore;
      videoFacePct        = analysisData.faceVisiblePct;
      videoGaze           = analysisData.gazeBreakdown;
      videoSuspicion      = analysisData.suspicionFlags || [];
      videoAnalysisMethod = analysisData.method;
      console.log('[Score] Video analysis succeeded:', { eye: videoEyeScore, body: videoBodyScore });
    }
  } catch (err: any) {
    console.warn('[Score] Video analysis failed (non-fatal):', err.message);
  }
} else {
  console.log('[Score] No frames received — skipping video analysis');
}
    // ── STEP 2: Pick best available eye/body data ─────────────────────────
    // Priority: (1) Server Claude Vision, (2) Client MediaPipe, (3) Neutral default
    let finalEyeContact:   number;
    let finalBodyLanguage: number;
    let finalFacePct:      number;
    let finalGaze         = { center: 0, down: 0, side: 0, absent: 0 };
    let finalSuspicion:    string[];
    let dataSource:        string;

    const hasVideoData  = videoEyeScore >= 0 && videoBodyScore >= 0;
    const hasClientData = typeof clientEyeScore === 'number' && clientEyeScore >= 0 &&
                          typeof clientBodyScore === 'number' && clientBodyScore >= 0;

    if (hasVideoData) {
      // Best: server-side Claude Vision analysis of actual video frames
      finalEyeContact   = videoEyeScore;
      finalBodyLanguage = videoBodyScore;
      finalFacePct      = videoFacePct;
      finalGaze         = videoGaze;
      finalSuspicion    = [...new Set([...videoSuspicion, ...clientSuspicionFlags])];
      dataSource        = `claude_vision_${videoAnalysisMethod}`;
      console.log('[Score] Using server video analysis scores');
    } else if (hasClientData) {
      // Fallback: MediaPipe from client (when video analysis fails)
      finalEyeContact   = clientEyeScore;
      finalBodyLanguage = clientBodyScore;
      finalFacePct      = typeof clientFacePct === 'number' ? clientFacePct : 50;
      finalGaze         = clientGazeBreakdown;
      finalSuspicion    = clientSuspicionFlags;
      dataSource        = 'client_mediapipe';
      console.log('[Score] Using client MediaPipe scores');
    } else {
      // No data available — use neutral 50 with a note
      finalEyeContact   = 50;
      finalBodyLanguage = 50;
      finalFacePct      = 50;
      finalGaze         = { center: 50, down: 0, side: 0, absent: 50 };
      finalSuspicion    = [];
      dataSource        = 'default_no_data';
      console.log('[Score] No video or MediaPipe data — using defaults');
    }

    // ── STEP 3: Get transcripts ───────────────────────────────────────────
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
      console.log('[Score] Using client transcripts');
      transcripts     = questionList.map((_, i) => clientTranscripts[i] || '');
      existingAnswers = questionList.map((_, i) => ({
        videoUrl:   videoUrls?.[i] || '',
        transcript: clientTranscripts[i] || '',
      }));
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

    console.log('[Score] Transcripts:', transcripts.map((t, i) =>
      `Q${i+1}: "${t.substring(0, 50)}"`));

    // ── STEP 4: Classify answers ──────────────────────────────────────────
    const isRealAnswer = (t: string) =>
      t?.trim().length >= 3 && t.trim().split(/\s+/).filter(Boolean).length >= 1;

    const answerMap = questionList.map((q, i) => ({
      question:   q,
      transcript: transcripts[i]?.trim() || '',
      hasVideo:   !!existingAnswers?.[i]?.videoUrl,
      // Count as answered if there's a transcript OR a video recording
      answered:   isRealAnswer(transcripts[i] || '') || !!existingAnswers?.[i]?.videoUrl,
    }));

    const answeredCount  = answerMap.filter(a => a.answered).length;
    const totalQuestions = questionList.length;

    console.log(`[Score] Answered ${answeredCount}/${totalQuestions}`);

    // ── STEP 5: Build answers text ────────────────────────────────────────
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

   // ── STEP 6: Groq prompt — ONLY technical + communication ─────────────
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

1. technicalScore (0-100):
   - Score on correctness, depth, and relevance of answers to the job role
   - A candidate who speaks for 60–90 seconds per question and covers key concepts deserves 55–75
   - Correct concepts with some gaps → 55–65
   - Good coverage with examples → 65–80
   - Excellent depth, specific tools, clear reasoning → 80–95
   - 0 questions answered → 0. Partial answers still show knowledge — don't penalise heavily.

2. communicationScore (0-100):
   - Score on how clearly the candidate conveyed their ideas (NOT transcription quality)
   - A candidate who spoke for 60–90 seconds per question and stayed on topic deserves at least 55
   - Structured, coherent verbal answers → 60–75
   - Well-articulated with clear examples → 75–90
   - Penalise only genuine lack of coherence, not STT artifacts

3. recommendation:
   - "Strong Yes" if technicalScore >= 72 AND answeredCount >= 4
   - "Yes" if technicalScore >= 58 AND answeredCount >= 3
   - "Maybe" if technicalScore >= 40 AND answeredCount >= 2
   - "No" for everything else

4. summary: 2–3 balanced sentences. Mention what they did well AND where to improve.

5. strengths: list at least 1–2 genuine strengths if the candidate answered any questions.

6. improvements: 2 specific, actionable gaps.

Score reference: 30–45 = weak, 46–60 = average, 61–75 = good, 76–90 = very good, 91–100 = exceptional.
A candidate who answered all 5 questions with relevant content should score at least 55–65 overall.

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

    // ── STEP 7: Call Groq ─────────────────────────────────────────────────
    
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

    // ── STEP 8: Clamp all scores ──────────────────────────────────────────
    const clamp = (val: unknown, min = 0, max = 100) =>
      Math.round(Math.max(min, Math.min(max, Number(val) || 0)));

    const tech = clamp(ev.technicalScore);
    const comm = clamp(ev.communicationScore);

    // ── STEP 9: Build body language feedback string ───────────────────────
    let bodyLanguageFeedback: string;

    if (answeredCount === 0) {
      bodyLanguageFeedback = 'Candidate did not answer any questions verbally.';
      // Don't override finalEyeContact / finalBodyLanguage — camera data is still valid
    } else if (dataSource === 'default_no_data') {
      bodyLanguageFeedback = 'Camera tracking data was not available for this session.';
    } else if (finalFacePct < 20) {
      finalEyeContact      = 5;
      finalBodyLanguage    = 5;
      bodyLanguageFeedback = 'Face was not visible for most of the interview.';
    } else if (finalGaze.down > 25) {
      bodyLanguageFeedback = `Candidate looked down ${finalGaze.down}% of the time — possible phone or notes use.`;
    } else if (finalGaze.side > 25) {
      bodyLanguageFeedback = `Candidate looked sideways ${finalGaze.side}% of the time — possible reference material.`;
    } else if (finalGaze.absent > 20) {
      bodyLanguageFeedback = `Face was absent from frame ${finalGaze.absent}% of the time.`;
    } else if (finalEyeContact >= 70) {
      bodyLanguageFeedback = `Good eye contact maintained ${finalGaze.center}% of the time.`;
    } else {
      bodyLanguageFeedback = `Eye contact was ${finalGaze.center}% — candidate should look more directly at the camera.`;
    }

    console.log('[Score] Final eye/body scores:', {
      eyeContact:   finalEyeContact,
      bodyLanguage: finalBodyLanguage,
      source:       dataSource,
      gaze:         finalGaze,
    });

    // ── STEP 10: Overall score (weighted) + caps ──────────────────────────
    const computedOverall = Math.round(
      tech              * 0.50 +
      comm              * 0.35 +
      finalBodyLanguage * 0.075 +
      finalEyeContact   * 0.075,
    );

    const overallCap =
  answeredCount === 0 ? 0  :
  answeredCount === 1 ? 45 :
  answeredCount === 2 ? 65 :
  answeredCount === 3 ? 80 :
  answeredCount === 4 ? 90 : 100;

    const finalOverall = Math.min(computedOverall, overallCap);

    // Override recommendation based on integrity flags
    let recommendation = String(ev.recommendation ?? 'No');
    if (answeredCount === 0)                            recommendation = 'No';
    else if (answeredCount === 1 && finalOverall < 50)  recommendation = 'No';
    else if (answeredCount <= 2 && finalOverall < 60)   recommendation = 'Maybe';
    if (finalSuspicion.length >= 2 && recommendation === 'Strong Yes') recommendation = 'Yes';
    if (finalSuspicion.length >= 3)                                     recommendation = 'Maybe';

    const result = {
      score:                 finalOverall,
      technicalScore:        tech,
      communicationScore:    comm,
      bodyLanguageScore:     clamp(finalBodyLanguage),
      eyeContactScore:       clamp(finalEyeContact),
      summary:               String(ev.summary              ?? ''),
      technicalFeedback:     String(ev.technicalFeedback    ?? ''),
      communicationFeedback: String(ev.communicationFeedback ?? ''),
      bodyLanguageFeedback,
      recommendation,
      strengths:             Array.isArray(ev.strengths)    ? ev.strengths    : [],
      improvements:          Array.isArray(ev.improvements) ? ev.improvements : [],
    };

    console.log('[Score] Final result:', {
      overall:   result.score,
      technical: result.technicalScore,
      comm:      result.communicationScore,
      eye:       result.eyeContactScore,
      body:      result.bodyLanguageScore,
      answered:  `${answeredCount}/${totalQuestions}`,
      source:    dataSource,
      integrity: finalSuspicion.length > 0 ? finalSuspicion : 'clean',
    });

    // ── STEP 11: Save to Firestore ────────────────────────────────────────
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
    });

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
      });
    }

    return NextResponse.json(result);

  } catch (err: any) {
    console.error('[Score] Error:', err.message);

    const fallback = {
      score: 0, technicalScore: 0, communicationScore: 0,
      bodyLanguageScore: 0, eyeContactScore: 0,
      summary: 'AI evaluation could not be completed. Please review manually.',
      technicalFeedback: '', communicationFeedback: '',
      bodyLanguageFeedback: '',
      recommendation: 'Manual Review', strengths: [], improvements: [],
    };

    try {
      if (candidateId) {
        await adminDb.doc(`candidates/${candidateId}`).update({
          l1AIStatus:          'completed',
          l1AIScore:           0,
          l1AISummary:         fallback.summary,
          l1AIRecommendation:  'Manual Review',
          l1AIStrengths:       [],
          l1AIImprovements:    [],
          l1AICompletedAt:     FieldValue.serverTimestamp(),
          lastUpdated:         FieldValue.serverTimestamp(),
        });
      }
      if (snap && !snap.empty) {
        await snap.docs[0].ref.update({
          status:    'completed',
          aiScore:   0,
          aiSummary: 'AI evaluation failed. Manual review required.',
          scoredAt:  FieldValue.serverTimestamp(),
        });
      }
    } catch (_) {}

    return NextResponse.json(fallback);
  }
}