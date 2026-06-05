// app/api/interview/complete/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';
import * as admin from 'firebase-admin';

// ─── Firebase Admin (lazy singleton) ────────────────────────────────────────
function getFirestore() {
  if (!admin.apps.length) {
    const firebaseConfig = process.env.FIREBASE_CONFIG
      ? JSON.parse(process.env.FIREBASE_CONFIG)
      : null;
    if (firebaseConfig) {
      admin.initializeApp({ credential: admin.credential.cert(firebaseConfig) });
    } else {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId:   process.env.FIREBASE_PROJECT_ID!,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
          privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')!,
        }),
      });
    }
  }
  return admin.firestore();
}

// ─── Cloudinary config ───────────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key:    process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
});

function toSlug(str: string, maxLen = 40): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9@._-]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, maxLen);
}

// ─── Whisper helper stays — used nowhere now but harmless to keep ────────────
async function transcribeAudio(buffer: Buffer, questionIdx: number): Promise<string> {
  try {
    if (buffer.length > 24 * 1024 * 1024) return '';
    const whisperForm = new FormData();
    const audioFile = new File([new Uint8Array(buffer)], `q${questionIdx + 1}.webm`, { type: 'audio/webm' });
    whisperForm.append('file', audioFile);
    whisperForm.append('model', 'whisper-large-v3');
    whisperForm.append('response_format', 'text');
    whisperForm.append('language', 'en');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
      body: whisperForm,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return '';
    return (await res.text()).trim();
  } catch { return ''; }
}

export const maxDuration = 300;

// ─── NEW POST — accepts JSON, no video binary ────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body           = await req.json();
    const videoUrl       = body.videoUrl       as string;
    const token          = body.token          as string;
    const candidateId    = body.candidateId    as string;
    const candidateName  = body.candidateName  as string;
    const candidateEmail = body.candidateEmail as string;
    const isMerged       = body.isMerged === true;
    const transcriptsMap = (body.transcripts ?? {}) as Record<string, string>;

    if (!videoUrl || !token || !candidateId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Build full transcript string from speech recognition map
    const transcript = Object.entries(transcriptsMap)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([i, t]) => `Q${Number(i) + 1}: ${t}`)
      .join('\n\n');

    console.log(`[complete] transcript: ${transcript.length} chars | videoUrl: ${videoUrl}`);

    // ── Save to ai_interviews ────────────────────────────────────────────────
    const db = getFirestore();
    const interSnap = await db
      .collection('ai_interviews')
      .where('token', '==', token)
      .limit(1)
      .get();

    if (!interSnap.empty) {
      await interSnap.docs[0].ref.update({
        mergedVideoUrl: videoUrl,
        fullTranscript: transcript,
        ...Object.fromEntries(
          Object.entries(transcriptsMap).map(([i, t]) => [
            `answers_map.q${i}`,
            { transcript: t, questionIdx: Number(i), savedAt: new Date().toISOString() },
          ])
        ),
      });
      console.log('[complete] ai_interviews updated');
    } else {
      console.error('[complete] No ai_interviews doc found for token:', token);
    }

    // ── Save to candidates doc ───────────────────────────────────────────────
    const candRef = db.collection('candidates').doc(candidateId);
    await candRef.set(
      {
        videoAnswers: admin.firestore.FieldValue.arrayUnion({
          questionIdx:  0,
          videoUrl,
          transcript,
          uploadedAt:   new Date().toISOString(),
          isMerged:     true,
        }),
        interviewStatus:      'submitted',
        interviewSubmittedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastToken:            token,
      },
      { merge: true },
    );

    console.log(`[complete] Done for ${candidateId}`);
    return NextResponse.json({ success: true, videoUrl, transcript });

  } catch (err: any) {
    console.error('[complete] Failed:', err);
    return NextResponse.json({ error: 'Failed', detail: err.message }, { status: 500 });
  }
}