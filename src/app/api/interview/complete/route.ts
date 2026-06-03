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
    // ✅ Skip if file too large for Whisper (25MB limit)
    if (buffer.length > 24 * 1024 * 1024) {
      console.warn(`[Whisper] Q${questionIdx + 1} too large (${Math.round(buffer.length / 1024 / 1024)}MB), skipping`);
      return '';
    }

    const whisperForm = new FormData();
    const audioFile   = new File([buffer], `q${questionIdx + 1}.webm`, { type: 'audio/webm' });

    whisperForm.append('file',            audioFile);
    whisperForm.append('model',           'whisper-large-v3');
    whisperForm.append('response_format', 'text');
    whisperForm.append('language',        'en');

    // ✅ 30s timeout so Whisper never hangs the whole function
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
      body:    whisperForm,
      signal:  controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[Whisper] Q${questionIdx + 1} failed:`, errText);
      return '';
    }

    const transcript = await res.text();
    console.log('WHISPER RAW RESPONSE:', transcript);
    console.log(`[Whisper] Q${questionIdx + 1} transcript:`, transcript.substring(0, 120));
    return transcript.trim();

  } catch (err) {
    console.error(`[Whisper] Q${questionIdx + 1} error:`, err);
    return '';
  }
}
export const maxDuration = 300; // ← Fix timeout

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const videoFile         = formData.get('video')              as File   | null;
    const token             = formData.get('token')              as string | null;
    const candidateId       = formData.get('candidateId')        as string | null;
    const candidateName     = formData.get('candidateName')      as string | null;
    const candidateEmail    = formData.get('candidateEmail')     as string | null;
    const questionText      = formData.get('questionText')       as string | null;
    const questionIdx       = formData.get('questionIdx')        as string | null;
    const isMerged          = formData.get('isMerged') === 'true';
    // ← NEW: accept client-side speech transcript per question
    const clientTranscripts = formData.get('transcripts');
const transcriptsMap: Record<number, string> = {};
if (clientTranscripts) {
  const parsed = JSON.parse(clientTranscripts as string);
  Object.entries(parsed).forEach(([k, v]) => {
    transcriptsMap[Number(k)] = String(v || '');
  });
}

    if (!videoFile || !token || !candidateId || questionIdx === null) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const qIdx   = parseInt(questionIdx, 10);
    const buffer = Buffer.from(await videoFile.arrayBuffer());

    const sizeMB = buffer.length / 1024 / 1024;

    console.log(
      `[UPLOAD START] Candidate=${candidateEmail}`
    );
    
    console.log(
      `[UPLOAD SIZE] ${sizeMB.toFixed(2)} MB`
    );
    
    if (sizeMB > 100) {
      throw new Error(
        `Video too large: ${sizeMB.toFixed(2)} MB`
      );
    }
    // ── Build Cloudinary folder & file names ─────────────────────────────
    const folderName   = toSlug(`${candidateName ?? candidateId}_${candidateEmail ?? ''}`, 60);
    const publicIdName = isMerged
      ? 'full_interview'
      : toSlug(questionText ?? `q${qIdx + 1}`, 50);

    // ── 1. Upload to Cloudinary ──────────────────────────────────────────
    const uploadResult = await new Promise<any>((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          resource_type: 'video',
          timeout: 300000, // 5 min
          folder:        `smarthire/interviews/${folderName}`,
          public_id:     publicIdName,
          overwrite:     true,
          tags:          ['interview', `candidate_${candidateId}`, `token_${token}`],
          video_codec:   'auto',
          eager: [
            { width: 400, height: 300, crop: 'fill', format: 'jpg', start_offset: '2' },
          ],
          eager_async:   true,
          context:       `candidate_id=${candidateId}|question_index=${qIdx}|token=${token}`,
        },
        (error, result) => { if (error) reject(error); else resolve(result); },
      ).end(buffer);
    });

    const videoUrl     = uploadResult.secure_url             as string;
    const thumbnailUrl = uploadResult.eager?.[0]?.secure_url ?? '';
    const publicId     = uploadResult.public_id              as string;
    const duration     = uploadResult.duration               as number | null;

    console.log(
      `[UPLOAD SUCCESS] ${uploadResult.secure_url}`
  );

    // ── 2. Transcript logic ──────────────────────────────────────────────
    // For merged uploads: iterate all questions using client-side transcripts
    // For individual uploads: try client transcript first, Whisper as fallback
    let transcript = '';

    if (isMerged) {
      // Merged blob = full interview. Individual transcripts come from the
      // client speech API — already reliable. No point sending 100MB+ to Whisper.
      // transcriptsMap has all per-Q transcripts; join them for the merged record.
      transcript = Object.entries(transcriptsMap)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([i, t]) => `Q${Number(i) + 1}: ${t}`)
      .join('\n\n');
      console.log(`[complete] Merged transcript from client (${transcript.length} chars)`);
    } else {
      // Individual question upload
      const clientTranscript = (transcriptsMap[qIdx] || '').trim();
      if (clientTranscript.length > 20) {
        // Client speech API captured something useful — use it
        transcript = clientTranscript;
        console.log(`[complete] Q${qIdx + 1} using client transcript (${transcript.length} chars)`);
      } else {
        // Client got nothing — fall back to Whisper (only works if < 25MB)
        console.log(`[complete] Q${qIdx + 1} client transcript empty, trying Whisper...`);
        transcript = await transcribeAudio(buffer, qIdx);
      }
    }

    // ── 3. Save to ai_interviews ─────────────────────────────────────────
    const db = getFirestore();
    const interSnap = await db
      .collection('ai_interviews')
      .where('token', '==', token)
      .limit(1)
      .get();

    if (!interSnap.empty) {
      if (isMerged) {
        // Save the video URL + full transcript on the top-level doc
        await interSnap.docs[0].ref.update({
          mergedVideoUrl:  videoUrl,
          fullTranscript:  transcript,
          // Also write per-question transcripts into answers_map
          ...Object.fromEntries(
            Object.entries(transcriptsMap).map(([i, t]) => [
              `answers_map.q${i}`,
              {
                transcript:  t,
                questionIdx: Number(i),
                savedAt:     new Date().toISOString(),
              },
            ])
          ),
        });
      } else {
        await interSnap.docs[0].ref.update({
          [`answers_map.q${qIdx}`]: {
            videoUrl,
            transcript,
            questionIdx: qIdx,
            savedAt:     new Date().toISOString(),
          },
        });
      }
      console.log(`[complete] Firebase updated. transcript length: ${transcript.length}`);
    } else {
      console.error('[complete] No ai_interviews doc found for token:', token);
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
          isMerged,
        }),
        interviewStatus:      'submitted',
        interviewSubmittedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastToken:            token,
      },
      { merge: true },
    );

    console.log(`[complete] Done for ${candidateId} | Q${qIdx + 1} | transcript: ${transcript.length} chars`);
    return NextResponse.json({ success: true, videoUrl, thumbnailUrl, publicId, questionIdx: qIdx, transcript,uploadSizeMB: sizeMB });

  } catch (err: any) {
    console.error(
      '[UPLOAD FAILED]',
      err
    );    return NextResponse.json({ error: 'Upload failed', detail: err.message }, { status: 500 });
  }
}