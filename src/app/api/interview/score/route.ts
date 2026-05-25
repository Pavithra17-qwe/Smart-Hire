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
      token, questions, jobRole, codeAnswer, videoUrls,
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

    // ── STEP 1: Transcribe all videos ─────────────────────────────────────
    let transcripts: string[] = [];

    if (hasVideos) {
      console.log('[Score] Transcribing', videoUrls.length, 'videos...');
      try {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
        const transcribeRes = await fetch(`${baseUrl}/api/interview/transcribe`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ videoUrls }),
        });
        if (transcribeRes.ok) {
          const data = await transcribeRes.json();
          transcripts = data.transcripts || [];
        }
      } catch (err) {
        console.warn('[Score] Transcription call failed:', err);
      }
    }

    // ── STEP 2: Count how many questions were actually answered ───────────
    const answeredCount = transcripts.filter(t => {
      if (!t || t.trim().length < 30) return false;
      const wordCount = t.trim().split(/\s+/).length;
      return wordCount >= 8; // at least 8 words = real answer
    }).length;
    const totalQuestions = questionList.length;
    const answerRate = totalQuestions > 0 ? answeredCount / totalQuestions : 0;

    console.log(`[Score] Answered ${answeredCount}/${totalQuestions} questions (${Math.round(answerRate * 100)}%)`);

    // ── STEP 3: Build honest answers text ─────────────────────────────────
    const isRealAnswer = (t: string) =>
      t && t.trim().length >= 30 && t.trim().split(/\s+/).length >= 8;
    
    const answersText = questionList.map((q, i) => {
      const transcript = transcripts[i]?.trim();
      if (isRealAnswer(transcript)) {
        return `Q${i + 1}: ${q}\nAnswer: ${transcript}`;
      } else if (videoUrls?.[i]) {
        return `Q${i + 1}: ${q}\nAnswer: [Candidate started but did not complete answer]`;
      } else {
        return `Q${i + 1}: ${q}\nAnswer: [Not recorded]`;
      }
    }).join('\n\n');

    const codeSection = codeAnswer?.trim()
      ? `\nCODING SUBMISSION:\n${codeAnswer.trim()}`
      : '';

    // ── STEP 4: MediaPipe reliability check ───────────────────────────────
    const mediaPipeReliable =
      typeof eyeContactScore   === 'number' &&
      typeof bodyLanguageScore === 'number' &&
      typeof faceVisiblePct    === 'number' &&
      faceVisiblePct > 30 &&
      eyeContactScore < 98; // 98+ = phone bug

    // ── STEP 5: Build scoring prompt ──────────────────────────────────────
    const prompt = `You are an expert technical interviewer evaluating a ${jobRole} candidate.

RESUME:
${resumeText || 'Not provided.'}

JOB DESCRIPTION:
${jd || 'Not provided.'}

INTERVIEW ANSWERS (${answeredCount} of ${totalQuestions} questions answered):
${answersText}
${codeSection}

IMPORTANT CONTEXT:
- The candidate answered ${answeredCount} out of ${totalQuestions} questions.
- ${answeredCount === 0
    ? 'The candidate did NOT answer any questions. Score technical and communication very low (20-35).'
    : answeredCount < totalQuestions
    ? `Only ${answeredCount} question(s) were answered. Unanswered questions should heavily penalise the technical score.`
    : 'All questions were answered. Score based on quality of actual answers.'}
- Scores MUST be different for each dimension — never return the same number for all.
- Use the full 0-100 range honestly.
- technicalScore: based ONLY on the quality and correctness of answers given. If no answers, score 20-30.
- communicationScore: based on clarity of spoken answers. If no answers, score 25-40.
- ${mediaPipeReliable ? 'eyeContactScore and bodyLanguageScore: will be overridden by camera data, give your best estimate.' : 'eyeContactScore and bodyLanguageScore: infer from interview completion (50-70 range).'}
- recommendation: "Strong Yes" >= 85, "Yes" 70-84, "Maybe" 50-69, "No" below 50.

Respond with ONLY raw JSON, no markdown, no backticks:
{
  "overallScore": <integer 0-100>,
  "technicalScore": <integer 0-100>,
  "communicationScore": <integer 0-100>,
  "bodyLanguageScore": <integer 0-100>,
  "eyeContactScore": <integer 0-100>,
  "summary": "<2-3 honest sentences about performance including how many questions were answered>",
  "technicalFeedback": "<1-2 sentences>",
  "communicationFeedback": "<1-2 sentences>",
  "bodyLanguageFeedback": "<1-2 sentences>",
  "recommendation": "<Strong Yes | Yes | Maybe | No>",
  "strengths": ["<only list genuine strengths, can be empty array if none>"],
  "improvements": ["<specific gap 1>", "<specific gap 2>"]
}`;

    // ── STEP 6: Call Groq ─────────────────────────────────────────────────
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
            content: 'You are an expert interviewer. Output ONLY raw JSON. No markdown. No backticks. Be honest — a candidate who skipped most questions should score low.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens:  900,
      }),
    });

    if (!groqRes.ok) {
      throw new Error(`Groq API ${groqRes.status}: ${await groqRes.text()}`);
    }

    const groqData = await groqRes.json();
    const content  = groqData.choices?.[0]?.message?.content || '';
    console.log('[Score] Groq response:', content.substring(0, 400));

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Groq response: ' + content.substring(0, 200));

    const ev = JSON.parse(jsonMatch[0]);

    // ── STEP 7: Compute final scores ──────────────────────────────────────
    // No floor for unanswered interviews — if they didn't answer, score should be low
    const floor = answeredCount > 0 ? 20 : 0;
    const clamp = (val: unknown, min = floor) =>
      Math.round(Math.max(min, Math.min(100, Number(val) || min)));

    const finalEyeContact = mediaPipeReliable
      ? Math.round(eyeContactScore!  * 0.5 + clamp(ev.eyeContactScore)  * 0.5)
      : clamp(ev.eyeContactScore, 40);

    const finalBodyLanguage = mediaPipeReliable
      ? Math.round(bodyLanguageScore! * 0.5 + clamp(ev.bodyLanguageScore) * 0.5)
      : clamp(ev.bodyLanguageScore, 40);

    const tech = clamp(ev.technicalScore);
    const comm = clamp(ev.communicationScore);

    // Server-side weighted overall — never trust model's own sum
    const computedOverall = Math.round(
      tech              * 0.40 +
      comm              * 0.35 +
      finalBodyLanguage * 0.125 +
      finalEyeContact   * 0.125,
    );

    const result = {
      score:                 computedOverall,
      technicalScore:        tech,
      communicationScore:    comm,
      bodyLanguageScore:     finalBodyLanguage,
      eyeContactScore:       finalEyeContact,
      summary:               String(ev.summary              ?? ''),
      technicalFeedback:     String(ev.technicalFeedback     ?? ''),
      communicationFeedback: String(ev.communicationFeedback ?? ''),
      bodyLanguageFeedback:  String(ev.bodyLanguageFeedback  ?? ''),
      recommendation:        String(ev.recommendation        ?? 'No'),
      strengths:             Array.isArray(ev.strengths)    ? ev.strengths    : [],
      improvements:          Array.isArray(ev.improvements) ? ev.improvements : [],
    };

    console.log('[Score] Final:', {
      overall:       result.score,
      technical:     result.technicalScore,
      communication: result.communicationScore,
      eye:           result.eyeContactScore,
      body:          result.bodyLanguageScore,
      answered:      `${answeredCount}/${totalQuestions}`,
    });

    // ── STEP 8: Save to Firestore ─────────────────────────────────────────
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
          lastUpdated: FieldValue.serverTimestamp(),
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