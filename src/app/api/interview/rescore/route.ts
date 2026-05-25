import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

const GROQ_WHISPER_LIMIT_BYTES = 24 * 1024 * 1024;

async function transcribeUrl(url: string, index: number): Promise<string> {
  try {
    let fetchUrl = url;
    if (url.includes('cloudinary.com')) {
      fetchUrl = url
        .replace('/upload/', '/upload/f_mp3,q_auto:eco/')
        .replace(/\.(webm|mp4|mov)$/i, '.mp3');
    }

    const c1 = new AbortController();
    const t1 = setTimeout(() => c1.abort(), 25000);
    let res = await fetch(fetchUrl, { signal: c1.signal });
    clearTimeout(t1);

    if (!res.ok && fetchUrl !== url) {
      const c2 = new AbortController();
      const t2 = setTimeout(() => c2.abort(), 25000);
      res = await fetch(url, { signal: c2.signal });
      clearTimeout(t2);
    }

    if (!res.ok) { console.warn(`Video ${index + 1} fetch failed: ${res.status}`); return ''; }

    const size = parseInt(res.headers.get('content-length') || '0');
    console.log(`Video ${index + 1} size: ${Math.round(size / 1024)}KB`);
    if (size > GROQ_WHISPER_LIMIT_BYTES) { console.warn(`Video ${index + 1} too large`); return ''; }

    const buffer = Buffer.from(await res.arrayBuffer());
    const isMP3  = fetchUrl.endsWith('.mp3');
    const form   = new FormData();
    form.append('file', new Blob([buffer], { type: isMP3 ? 'audio/mpeg' : 'audio/webm' }), `answer_${index + 1}.${isMP3 ? 'mp3' : 'webm'}`);
    form.append('model', 'whisper-large-v3');
    form.append('response_format', 'text');
    form.append('language', 'en');
    form.append('temperature', '0');

    const gc = new AbortController();
    const gt = setTimeout(() => gc.abort(), 40000);
    const groq = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: form,
      signal: gc.signal,
    });
    clearTimeout(gt);

    if (!groq.ok) { console.warn(`Whisper error Q${index + 1}: ${groq.status}`); return ''; }

    const text = (await groq.text()).trim();
    console.log(`✓ Q${index + 1} transcript (${text.split(/\s+/).length} words): ${text.substring(0, 80)}`);
    return text;
  } catch (e: any) {
    console.warn(`Transcribe error Q${index + 1}:`, e.message);
    return '';
  }
}

export async function POST(req: NextRequest) {
  try {
    const { token } = await req.json();

    const snap = await adminDb
      .collection('ai_interviews')
      .where('token', '==', token)
      .limit(1)
      .get();

    if (snap.empty) return NextResponse.json({ error: 'Token not found' }, { status: 404 });

    const doc        = snap.docs[0].data();
    const candidateId = doc.candidateId   || '';
    const jobRole     = doc.jobRole        || '';
    const resumeText  = doc.resumeText     || '';
    const jd          = doc.jobDescription || '';
    const questions: string[] = doc.questions || [];

    // ── Recover video URLs from transcripts field (they were saved there by mistake) ──
    const stored = doc.transcripts || [];
    const videoUrls: string[] = stored.filter((t: string) => typeof t === 'string' && t.startsWith('http'));

    console.log('[Rescore] Video URLs found:', videoUrls.length, videoUrls);

    if (videoUrls.length === 0) {
      return NextResponse.json({ error: 'No video URLs found. Check transcripts field in Firestore.' }, { status: 400 });
    }

    // ── Transcribe all videos ──
    console.log('[Rescore] Transcribing', videoUrls.length, 'videos...');
    const transcripts: string[] = await Promise.all(
      videoUrls.map((url, i) => transcribeUrl(url, i))
    );

    console.log('[Rescore] Transcripts:', transcripts.map((t, i) =>
      `Q${i + 1}: ${t ? t.length + ' chars' : 'EMPTY'}`
    ));

    // ── Score with Groq ──
    const isRealAnswer = (t: string, qi: number) =>
      !!t && t.trim().length >= 10 && t.trim().split(/\s+/).length >= (qi === 0 ? 5 : 8);

    const answerMap = questions.map((q, i) => ({
      question:   q,
      transcript: transcripts[i]?.trim() || '',
      answered:   isRealAnswer(transcripts[i] || '', i),
    }));

    const answeredCount  = answerMap.filter(a => a.answered).length;
    const totalQuestions = questions.length || videoUrls.length;

    const answersText = answerMap.map((a, i) =>
      a.answered
        ? `Q${i + 1}: ${a.question}\nAnswer: ${a.transcript}\nStatus: ANSWERED`
        : `Q${i + 1}: ${a.question}\nAnswer: [No speech detected]\nStatus: NOT_ANSWERED`
    ).join('\n\n');

    const codeAnswer = doc.l1AICodeAnswer || '';
    const codeSection = codeAnswer.trim()
      ? `\nCODING SUBMISSION:\n${codeAnswer.trim()}`
      : '';

    const prompt = `You are a strict technical interviewer scoring a ${jobRole} candidate.

RESUME: ${resumeText}
JOB DESCRIPTION: ${jd}

INTERVIEW TRANSCRIPT (${answeredCount} of ${totalQuestions} answered):
${answersText}
${codeSection}

SCORING RULES:
1. technicalScore (0-100): based on correctness of answers. 0 if none answered.
2. communicationScore (0-100): based on clarity. 0 if none answered.
3. bodyLanguageScore (0-100): give 50 as default since no tracking data.
4. eyeContactScore (0-100): give 50 as default since no tracking data.
5. overallScore: tech*0.50 + comm*0.35 + body*0.075 + eye*0.075
6. recommendation: "Strong Yes" if >=80 AND answered>=4, "Yes" if >=65 AND >=3, "Maybe" if >=45 AND >=2, else "No"
7. summary: honest 2-3 sentences mentioning how many questions answered.

Respond ONLY with raw JSON:
{
  "overallScore": 0,
  "technicalScore": 0,
  "communicationScore": 0,
  "bodyLanguageScore": 50,
  "eyeContactScore": 50,
  "summary": "",
  "technicalFeedback": "",
  "communicationFeedback": "",
  "bodyLanguageFeedback": "",
  "recommendation": "No",
  "strengths": [],
  "improvements": []
}`;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are a strict technical interviewer. Output ONLY raw JSON.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 900,
      }),
    });

    const groqData = await groqRes.json();
    const content  = groqData.choices?.[0]?.message?.content || '{}';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const ev = JSON.parse(jsonMatch ? jsonMatch[0] : '{}');

    const clamp = (v: unknown) => Math.round(Math.max(0, Math.min(100, Number(v) || 0)));

    const tech = clamp(ev.technicalScore);
    const comm = clamp(ev.communicationScore);
    const body = clamp(ev.bodyLanguageScore);
    const eye  = clamp(ev.eyeContactScore);

    const overallCap =
      answeredCount === 0 ? 0 :
      answeredCount === 1 ? 40 :
      answeredCount === 2 ? 60 :
      answeredCount === 3 ? 75 : 100;

    const computed = Math.round(tech * 0.50 + comm * 0.35 + body * 0.075 + eye * 0.075);
    const final    = Math.min(computed, overallCap);

    let recommendation = String(ev.recommendation ?? 'No');
    if (answeredCount === 0) recommendation = 'No';
    else if (answeredCount <= 2 && final < 60) recommendation = 'Maybe';

    console.log('[Rescore] Final score:', final, '| Answered:', answeredCount, '/', totalQuestions);

    // ── Save to Firestore ──
    await snap.docs[0].ref.update({
      aiScore:                 final,
      aiTechnicalScore:        tech,
      aiCommunicationScore:    comm,
      aiBodyLanguageScore:     body,
      aiEyeContactScore:       eye,
      aiSummary:               String(ev.summary              || ''),
      aiTechnicalFeedback:     String(ev.technicalFeedback    || ''),
      aiCommunicationFeedback: String(ev.communicationFeedback || ''),
      aiBodyLanguageFeedback:  String(ev.bodyLanguageFeedback || ''),
      aiRecommendation:        recommendation,
      aiStrengths:             Array.isArray(ev.strengths)    ? ev.strengths    : [],
      aiImprovements:          Array.isArray(ev.improvements) ? ev.improvements : [],
      transcripts,
      answeredQuestions:       answeredCount,
      totalQuestions,
      scoredAt:                FieldValue.serverTimestamp(),
    });

    if (candidateId) {
      await adminDb.doc(`candidates/${candidateId}`).update({
        l1AIScore:               final,
        l1AITechnicalScore:      tech,
        l1AICommunicationScore:  comm,
        l1AIBodyLanguageScore:   body,
        l1AIEyeContactScore:     eye,
        l1AISummary:             String(ev.summary || ''),
        l1AIFeedback:            String(ev.technicalFeedback || ''),
        l1AIRecommendation:      recommendation,
        l1AIStrengths:           Array.isArray(ev.strengths)    ? ev.strengths    : [],
        l1AIImprovements:        Array.isArray(ev.improvements) ? ev.improvements : [],
        l1AIAnsweredCount:       answeredCount,
        l1AITotalQuestions:      totalQuestions,
        lastUpdated:             FieldValue.serverTimestamp(),
      });
    }

    return NextResponse.json({ success: true, score: final, answeredCount, transcripts });

  } catch (err: any) {
    console.error('[Rescore] Error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
