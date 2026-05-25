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

// ─── Helper: sanitize strings for Cloudinary paths ───────────────────────────
function toSlug(str: string, maxLen = 40): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9@._-]/g, '_')  // keep letters, digits, @, dots, hyphens
    .replace(/_+/g, '_')              // collapse consecutive underscores
    .substring(0, maxLen);
}

// ─── Groq Whisper transcription ──────────────────────────────────────────────
async function transcribeAudio(buffer: Buffer, questionIdx: number): Promise<string> {
  try {
    const whisperForm = new FormData();
    const audioFile   = new File([buffer], `q${questionIdx + 1}.webm`, { type: 'audio/webm' });

    whisperForm.append('file',            audioFile);
    whisperForm.append('model',           'whisper-large-v3-turbo');
    whisperForm.append('response_format', 'text');
    whisperForm.append('language',        'en');

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
      body:    whisperForm,
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[Whisper] Q${questionIdx + 1} failed:`, errText);
      return '';
    }

    const transcript = await res.text();
    console.log(`[Whisper] Q${questionIdx + 1} transcript:`, transcript.substring(0, 120));
    return transcript.trim();

  } catch (err) {
    console.error(`[Whisper] Q${questionIdx + 1} error:`, err);
    return '';
  }
}

// ─── POST handler ────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    // ── Read all fields from formData ────────────────────────────────────
    const videoFile      = formData.get('video')          as File   | null;
    const token          = formData.get('token')          as string | null;
    const candidateId    = formData.get('candidateId')    as string | null;
    const candidateName  = formData.get('candidateName')  as string | null;  // ← NEW
    const candidateEmail = formData.get('candidateEmail') as string | null;  // ← NEW
    const questionText   = formData.get('questionText')   as string | null;  // ← NEW
    const questionIdx    = formData.get('questionIdx')    as string | null;

    if (!videoFile || !token || !candidateId || questionIdx === null) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const qIdx   = parseInt(questionIdx, 10);
    const buffer = Buffer.from(await videoFile.arrayBuffer());

    // ── Build Cloudinary folder & file names ─────────────────────────────
    // Folder:  smarthire/interviews/priya_sharma_priya@gmail.com
    // File:    tell_me_about_yourself  (instead of q1)
    const folderName   = toSlug(`${candidateName ?? candidateId}_${candidateEmail ?? ''}`, 60);
    const publicIdName = toSlug(questionText ?? `q${qIdx + 1}`, 50);

    // ── 1. Upload to Cloudinary ──────────────────────────────────────────
    const uploadResult = await new Promise<any>((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          resource_type: 'video',
          folder:        `smarthire/interviews/${folderName}`,  // ← FIXED
          public_id:     publicIdName,                          // ← FIXED
          overwrite:     true,
          tags:          ['interview', `candidate_${candidateId}`, `token_${token}`],
          video_codec:   'auto',
          eager: [
            { width: 400, height: 300, crop: 'fill', format: 'jpg', start_offset: '2' },
          ],
          eager_async: true,
          context:     `candidate_id=${candidateId}|question_index=${qIdx}|token=${token}`,
        },
        (error, result) => { if (error) reject(error); else resolve(result); },
      ).end(buffer);
    });

    const videoUrl     = uploadResult.secure_url             as string;
    const thumbnailUrl = uploadResult.eager?.[0]?.secure_url ?? '';
    const publicId     = uploadResult.public_id              as string;
    const duration     = uploadResult.duration               as number | null;

    // ── 2. Transcribe with Groq Whisper ──────────────────────────────────
    const transcript = await transcribeAudio(buffer, qIdx);

    // ── 3. Save to ai_interviews (answers array) ─────────────────────────
    const db        = getFirestore();
    const interSnap = await db
      .collection('ai_interviews')
      .where('token', '==', token)
      .limit(1)
      .get();

    if (!interSnap.empty) {
      const interDoc     = interSnap.docs[0];
      const existingData = interDoc.data();
      const answers: any[] = existingData.answers || [];

      while (answers.length <= qIdx) {
        answers.push({ videoUrl: '', transcript: '' });
      }
      answers[qIdx] = { videoUrl, transcript };

      await interDoc.ref.update({ answers });
      console.log(`[complete] Saved Q${qIdx + 1} transcript to ai_interviews`);
    } else {
      console.warn('[complete] ai_interviews doc not found for token:', token);
    }

    // ── 4. Save to candidates doc ─────────────────────────────────────────
    const candRef = db.collection('candidates').doc(candidateId);
    await candRef.set(
      {
        videoAnswers: admin.firestore.FieldValue.arrayUnion({
          questionIdx:  qIdx,
          videoUrl,
          thumbnailUrl,
          publicId,
          duration:     duration ?? null,
          transcript,
          uploadedAt:   new Date().toISOString(),
        }),
        interviewStatus:      'submitted',
        interviewSubmittedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastToken:            token,
      },
      { merge: true },
    );

    console.log(`[complete] Q${qIdx + 1} done for ${candidateId} | transcript: ${transcript ? 'yes' : 'no'}`);

    return NextResponse.json({ success: true, videoUrl, thumbnailUrl, publicId, questionIdx: qIdx, transcript });

  } catch (err: any) {
    console.error('[complete] Error:', err);
    return NextResponse.json({ error: 'Upload failed', detail: err.message }, { status: 500 });
  }
}