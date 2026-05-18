import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

export async function POST(req: NextRequest) {
  
  // ── Declare outside try so catch block can access them ──────────────────
  let candidateId = '';
  let snap: FirebaseFirestore.QuerySnapshot | null = null;

  try {
    const body = await req.json();
    const { token, questions, jobRole, codeAnswer } = body;
    candidateId = body.candidateId || '';   // ← assign to outer variable

    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    // ── Find the ai_interviews doc ────────────────────────────────────────
    snap = await adminDb                    // ← assign to outer variable
      .collection('ai_interviews')
      .where('token', '==', token)
      .limit(1)
      .get();
    if (snap.empty) {
      return NextResponse.json({ error: 'Interview not found' }, { status: 404 });
    }

    const docData   = snap.docs[0].data();
    const resumeText = docData.resumeText || '';

    // ── Build answers text from saved transcripts ─────────────────────────
    const savedAnswers = docData.answers || [];
    const answersText  = (questions as string[]).map((q, i) => {
      const transcript = savedAnswers[i]?.transcript || '(No answer recorded)';
      return `Q${i + 1}: ${q}\nAnswer: ${transcript}`;
    }).join('\n\n');

    // ── Call Groq ─────────────────────────────────────────────────────────
    const prompt = `You are an expert AI interviewer evaluating a candidate for a ${jobRole} position.

CANDIDATE RESUME:
${resumeText}

INTERVIEW ANSWERS:
${answersText}

Evaluate the candidate and return ONLY valid JSON, no markdown, no extra text:
{
  "overallScore": 75,
  "technicalScore": 70,
  "communicationScore": 80,
  "bodyLanguageScore": 65,
  "eyeContactScore": 70,
  "summary": "2-3 sentence overall performance summary",
  "technicalFeedback": "1-2 sentences on technical knowledge depth",
  "communicationFeedback": "1-2 sentences on clarity and articulation",
  "bodyLanguageFeedback": "1-2 sentences on composure and professionalism",
  "recommendation": "Strong Yes",
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "improvements": ["area 1", "area 2"]
}

Scoring guide (0-100):
- overallScore: weighted average of all dimensions
- technicalScore: accuracy, depth, relevance to the job role
- communicationScore: clarity, confidence, structured answers
- bodyLanguageScore: professionalism and composure inferred from response quality
- eyeContactScore: engagement and directness inferred from response quality
- recommendation must be one of: "Strong Yes" (85+), "Yes" (70-84), "Maybe" (50-69), "No" (below 50)`;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model:       'llama3-8b-8192',
        messages:    [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens:  900,
      }),
    });

    if (!groqRes.ok) {
      throw new Error(`Groq API returned ${groqRes.status}`);
    }

    const groqData = await groqRes.json();
    const content  = groqData.choices?.[0]?.message?.content || '';

    // ── Safely parse JSON ─────────────────────────────────────────────────
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in Groq response');

    const ev = JSON.parse(jsonMatch[0]);

    const result = {
      score:                ev.overallScore           ?? 0,
      technicalScore:       ev.technicalScore         ?? 0,
      communicationScore:   ev.communicationScore     ?? 0,
      bodyLanguageScore:    ev.bodyLanguageScore      ?? 0,
      eyeContactScore:      ev.eyeContactScore        ?? 0,
      summary:              ev.summary                ?? '',
      technicalFeedback:    ev.technicalFeedback      ?? '',
      communicationFeedback:ev.communicationFeedback  ?? '',
      bodyLanguageFeedback: ev.bodyLanguageFeedback   ?? '',
      recommendation:       ev.recommendation         ?? 'Manual Review',
      strengths:            ev.strengths              ?? [],
      improvements:         ev.improvements           ?? [],
    };

    // ── Save to ai_interviews doc ─────────────────────────────────────────
    await snap.docs[0].ref.update({
      status:                 'completed',     
      aiScore:                result.score,
      aiTechnicalScore:       result.technicalScore,
      aiCommunicationScore:   result.communicationScore,
      aiBodyLanguageScore:    result.bodyLanguageScore,
      aiEyeContactScore:      result.eyeContactScore,
      aiSummary:              result.summary,
      aiTechnicalFeedback:    result.technicalFeedback,
      aiCommunicationFeedback:result.communicationFeedback,
      aiBodyLanguageFeedback: result.bodyLanguageFeedback,
      aiRecommendation:       result.recommendation,
      aiStrengths:            result.strengths,
      aiImprovements:         result.improvements,
      scoredAt:               FieldValue.serverTimestamp(),
    });

    // ── Save to candidate doc ─────────────────────────────────────────
if (candidateId) {
  await adminDb.doc(`candidates/${candidateId}`).update({
    l1AIStatus:               'completed',            // ← NEW (triggers HR view)
    l1AIScore:                result.score,
    l1AICodeAnswer:   codeAnswer || '',  
    l1AITechnicalScore:       result.technicalScore,
    l1AICommunicationScore:   result.communicationScore,
    l1AIBodyLanguageScore:    result.bodyLanguageScore,
    l1AIEyeContactScore:      result.eyeContactScore,
    l1AISummary:              result.summary,
    l1AIFeedback:             result.technicalFeedback, // ← NEW (shown to HR)
    l1AIRecommendation:       result.recommendation,
    l1AIStrengths:            result.strengths,
    l1AIImprovements:         result.improvements,
    l1AICompletedAt:          FieldValue.serverTimestamp(), // ← NEW
    lastUpdated:              FieldValue.serverTimestamp(), // ← NEW
  });
}

    return NextResponse.json(result);

  
  } catch (err: any) {
    console.error('[Score API] Error:', err.message);

    // ── CRITICAL: even on failure, mark candidate as completed ──────────────
    // Otherwise HR page stays on "in_progress" forever
    if (candidateId) {
      try {
        await adminDb.doc(`candidates/${candidateId}`).update({
          l1AIStatus:      'completed',
          l1AIScore:       0,
          l1AISummary:     'AI evaluation could not be completed. Please review the recording manually.',
          l1AIFeedback:    '',
          l1AIRecommendation: 'Manual Review',
          l1AIStrengths:   [],
          l1AIImprovements:[],
          l1AICompletedAt: FieldValue.serverTimestamp(),
          lastUpdated:     FieldValue.serverTimestamp(),
        });
      } catch (updateErr) {
        console.error('[Score API] Could not update candidate status:', updateErr);
      }
    }

    // Also mark the ai_interviews doc as completed
    if (snap && !snap.empty) {
      try {
        await snap.docs[0].ref.update({
          status:    'completed',
          aiScore:   0,
          aiSummary: 'AI evaluation failed. Manual review required.',
          scoredAt:  FieldValue.serverTimestamp(),
        });
      } catch (_) {}
    }

    return NextResponse.json({
      score: 0,
      technicalScore: 0,
      communicationScore: 0,
      bodyLanguageScore: 0,
      eyeContactScore: 0,
      summary: 'AI evaluation could not be completed. Please review the recording manually.',
      technicalFeedback: '',
      communicationFeedback: '',
      bodyLanguageFeedback: '',
      recommendation: 'Manual Review',
      strengths: [],
      improvements: [],
    });
  }
}