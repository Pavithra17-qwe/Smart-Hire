// app/api/interview/score/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

export async function POST(req: NextRequest) {

  let candidateId = '';
  let snap: FirebaseFirestore.QuerySnapshot | null = null;

  try {
    const body = await req.json();
    const {
      token, questions, jobRole, codeAnswer, codeLanguage, videoUrls,
      eyeContactScore, bodyLanguageScore, faceVisiblePct,
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

    const hasVideos = Array.isArray(videoUrls) && videoUrls.length > 0;

   // ── STEP 1: Use already saved transcripts ─────────────────────
const existingAnswers = docData.answers || [];

const transcripts = existingAnswers.map(
  (a: any) => a?.transcript || ''
);

console.log('Saved transcripts:', transcripts);
    // ── STEP 2: Classify each answer ──────────────────────────────────────────

    const isRealAnswer = (t: string) =>
      t &&
      t.trim().length >= 3 &&
      t.trim().split(/\s+/).length >= 2;

    const answerMap = questionList.map((q, i) => ({
      question:   q,
      transcript: transcripts[i]?.trim() || '',
      hasVideo:   !!videoUrls?.[i],
      answered:   isRealAnswer(transcripts[i] || ''),
    }));

    const answeredCount  = answerMap.filter(a => a.answered).length;
    const totalQuestions = questionList.length;
    const answerRate     = totalQuestions > 0 ? answeredCount / totalQuestions : 0;

    // ✅ FIX 2: Added debug log so you can see exactly what happened
    // in Vercel logs if scoring gives 0 again in future.
    console.log('[Score] Transcription results:', transcripts.map((t: string, i: number) => ({      q: i + 1,
      videoUrl: !!videoUrls?.[i],
      words: t?.trim().split(/\s+/).filter(Boolean).length || 0,
      preview: t?.substring(0, 60) || 'EMPTY',
    })));
    console.log(`[Score] Answered ${answeredCount}/${totalQuestions} (${Math.round(answerRate * 100)}%)`);

    // ── STEP 3: Build per-question context for AI ─────────────────────────────
    const answersText = answerMap.map((a, i) => {
      if (a.answered) {
        return `Q${i + 1}: ${a.question}\nAnswer: ${a.transcript}\nStatus: ANSWERED`;
      } else if (a.hasVideo) {
        return `Q${i + 1}: ${a.question}\nAnswer: [Video recorded but candidate did not speak / spoke too briefly]\nStatus: NOT_ANSWERED`;
      } else {
        return `Q${i + 1}: ${a.question}\nAnswer: [No recording]\nStatus: SKIPPED`;
      }
    }).join('\n\n');

    const codeSection = codeAnswer?.trim()
      ? `\nCODING SUBMISSION (${codeLanguage || 'unknown'}):\n${codeAnswer.trim()}`
      : '';

    const mediaSection = `
MEDIAPIPE PHYSICAL SCORES (from actual face tracking during interview):
- Eye Contact detected: ${typeof eyeContactScore === 'number' ? eyeContactScore : 'N/A'}
- Body Language detected: ${typeof bodyLanguageScore === 'number' ? bodyLanguageScore : 'N/A'}
- Face visible percentage: ${typeof faceVisiblePct === 'number' ? faceVisiblePct + '%' : 'N/A'}
- Candidate answered ${answeredCount} of ${totalQuestions} questions
`;

    // ── STEP 4: Build strict AI scoring prompt ────────────────────────────────
    const prompt = `You are a strict technical interviewer scoring a ${jobRole} candidate.

RESUME:
${resumeText || 'Not provided.'}

JOB DESCRIPTION:
${jd || 'Not provided.'}

INTERVIEW TRANSCRIPT (${answeredCount} of ${totalQuestions} questions answered):
${answersText}
${codeSection}
${mediaSection}  

SCORING RULES — follow these exactly:

1. technicalScore (0-100):
   - Score ONLY based on correctness and depth of answers given
   - If 0 questions answered: give 0
   - If 1-2 questions answered: max score is 40, based on quality
   - If 3-4 questions answered: max score is 70, based on quality
   - If all 5 answered correctly and well: can score up to 100
   - Deduct heavily for wrong answers, vague answers, or no answers

2. communicationScore (0-100):
   - Score based on clarity, structure, and articulation of spoken answers
   - If 0 questions answered: give 0
   - If answers are present: score based on how clearly they communicated

3. bodyLanguageScore (0-100):
   - Use the MediaPipe body language score provided above as your primary source
   - If answeredCount is 0: give exactly 0 — no exceptions
   - If face visible % is below 15: give exactly 0
   - Otherwise use the MediaPipe score directly

4. eyeContactScore (0-100):
   - Use the MediaPipe eye contact score provided above as your primary source
   - If answeredCount is 0: give exactly 0 — no exceptions
   - If face visible % is below 15: give exactly 0
   - Otherwise use the MediaPipe score directly

5. overallScore: compute as weighted average:
   - technical: 50%
   - communication: 35%
   - bodyLanguage: 7.5%
   - eyeContact: 7.5%

6. recommendation:
   - "Strong Yes" only if overallScore >= 80 AND answeredCount >= 4
   - "Yes" if overallScore >= 65 AND answeredCount >= 3
   - "Maybe" if overallScore >= 45 AND answeredCount >= 2
   - "No" for everything else — especially if answeredCount < 2

7. summary: be brutally honest — mention exactly how many questions were answered
   and whether answers were correct, vague, or absent.

8. strengths: only list GENUINE strengths based on actual answers. Empty array if none.

Respond with ONLY raw JSON, no markdown, no backticks:
{
  "overallScore": <integer 0-100>,
  "technicalScore": <integer 0-100>,
  "communicationScore": <integer 0-100>,
  "bodyLanguageScore": <integer 0-100>,
  "eyeContactScore": <integer 0-100>,
  "summary": "<2-3 honest sentences>",
  "technicalFeedback": "<1-2 sentences>",
  "communicationFeedback": "<1-2 sentences>",
  "bodyLanguageFeedback": "<1-2 sentences>",
  "recommendation": "<Strong Yes | Yes | Maybe | No>",
  "strengths": [],
  "improvements": ["<gap 1>", "<gap 2>"]
}`;

    // ── STEP 5: Call Groq ─────────────────────────────────────────────────────
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model:    'llama-3.3-70b-versatile',
        messages: [
          {
            role:    'system',
            content: `You are a strict, honest technical interviewer. 
You score ONLY based on what the candidate actually said.
If they did not answer, they score low — period.
Do not give benefit of the doubt. Output ONLY raw JSON.`,
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens:  900,
      }),
    });

    if (!groqRes.ok) {
      throw new Error(`Groq API ${groqRes.status}: ${await groqRes.text()}`);
    }

    const groqData = await groqRes.json();
    const content  = groqData.choices?.[0]?.message?.content || '';
    console.log('[Score] Groq raw:', content.substring(0, 400));

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Groq response');

    const ev = JSON.parse(jsonMatch[0]);

    // ── STEP 6: Apply MediaPipe ONLY if candidate actually spoke ──────────────
    const mediaPipeReliable =
      typeof eyeContactScore   === 'number' &&
      typeof bodyLanguageScore === 'number' &&
      typeof faceVisiblePct    === 'number' &&
      faceVisiblePct > 30 &&
      eyeContactScore < 98 &&
      answeredCount > 0;

    const clamp = (val: unknown, min = 0, max = 100) =>
      Math.round(Math.max(min, Math.min(max, Number(val) || 0)));

    const tech = clamp(ev.technicalScore);
    const comm = clamp(ev.communicationScore);

    const faceWasHidden = typeof faceVisiblePct === 'number' && faceVisiblePct < 20;
    const physCap =
      answeredCount === 0 ? 0 :
      faceWasHidden       ? 5 :
      answeredCount === 1 ? 50 : 100;

    const finalEyeContact = Math.min(physCap,
      mediaPipeReliable
        ? Math.round(eyeContactScore! * 0.4 + clamp(ev.eyeContactScore) * 0.6)
        : clamp(ev.eyeContactScore)
    );

    const finalBodyLanguage = Math.min(physCap,
      mediaPipeReliable
        ? Math.round(bodyLanguageScore! * 0.4 + clamp(ev.bodyLanguageScore) * 0.6)
        : clamp(ev.bodyLanguageScore)
    );

    // ── STEP 7: Compute final overall + apply hard caps ───────────────────────
    const computedOverall = Math.round(
      tech              * 0.50 +
      comm              * 0.35 +
      finalBodyLanguage * 0.075 +
      finalEyeContact   * 0.075,
    );

    // ✅ FIX 3: overallCap now uses answeredCount which comes from real
    // transcripts only — silent videos correctly stay as NOT_ANSWERED.
    // This is correct behaviour: only actual spoken answers raise the cap.
    const overallCap =
      answeredCount === 0 ? 0 :
      answeredCount === 1 ? 40 :
      answeredCount === 2 ? 60 :
      answeredCount === 3 ? 75 : 100;

    const finalOverall = Math.min(computedOverall, overallCap);

    let recommendation = String(ev.recommendation ?? 'No');
    if (answeredCount === 0)                              recommendation = 'No';
    else if (answeredCount === 1 && finalOverall < 50)   recommendation = 'No';
    else if (answeredCount <= 2 && finalOverall < 60)    recommendation = 'Maybe';

    const result = {
      score:                 finalOverall,
      technicalScore:        tech,
      communicationScore:    comm,
      bodyLanguageScore:     finalBodyLanguage,
      eyeContactScore:       finalEyeContact,
      summary:               String(ev.summary              ?? ''),
      technicalFeedback:     String(ev.technicalFeedback     ?? ''),
      communicationFeedback: String(ev.communicationFeedback ?? ''),
      bodyLanguageFeedback:  String(ev.bodyLanguageFeedback  ?? ''),
      recommendation,
      strengths:             Array.isArray(ev.strengths)    ? ev.strengths    : [],
      improvements:          Array.isArray(ev.improvements) ? ev.improvements : [],
    };

    console.log('[Score] Final:', {
      overall:      result.score,
      technical:    result.technicalScore,
      comm:         result.communicationScore,
      answered:     `${answeredCount}/${totalQuestions}`,
      cap:          overallCap,
    });

    // ── STEP 8: Save to Firestore ─────────────────────────────────────────────
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
    });

    if (candidateId) {
      await adminDb.doc(`candidates/${candidateId}`).update({
        l1AIStatus:              'completed',
        l1AIScore:               result.score,
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
      });
    }

    return NextResponse.json(result);

  } catch (err: any) {
    console.error('[Score] Error:', err.message);

    const fallback = {
      score: 0, technicalScore: 0, communicationScore: 0,
      bodyLanguageScore: 0, eyeContactScore: 0,
      summary: 'AI evaluation could not be completed. Please review manually.',
      technicalFeedback: '', communicationFeedback: '', bodyLanguageFeedback: '',
      recommendation: 'Manual Review', strengths: [], improvements: [],
    };

    try {
      if (candidateId) {
        await adminDb.doc(`candidates/${candidateId}`).update({
          l1AIStatus: 'completed', l1AIScore: 0,
          l1AISummary: fallback.summary,
          l1AIRecommendation: 'Manual Review',
          l1AIStrengths: [], l1AIImprovements: [],
          l1AICompletedAt: FieldValue.serverTimestamp(),
          lastUpdated:     FieldValue.serverTimestamp(),
        });
      }
      if (snap && !snap.empty) {
        await snap.docs[0].ref.update({
          status: 'completed', aiScore: 0,
          aiSummary: 'AI evaluation failed. Manual review required.',
          scoredAt: FieldValue.serverTimestamp(),
        });
      }
    } catch (_) {}

    return NextResponse.json(fallback);
  }
}