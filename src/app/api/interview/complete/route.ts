// app/api/interview/complete/route.ts
// Uploads one video blob per question to Cloudinary,
// then saves the URL to Firestore under the candidate's document.

import { NextRequest, NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';
import * as admin from 'firebase-admin';

// ─── Firebase Admin (lazy singleton) ───────────────────────────────────────
function getFirestore() {
  if (!admin.apps.length) {
    const firebaseConfig = process.env.FIREBASE_CONFIG
      ? JSON.parse(process.env.FIREBASE_CONFIG)
      : null;

    if (firebaseConfig) {
      admin.initializeApp({
        credential: admin.credential.cert(firebaseConfig),
      });
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

// ─── Cloudinary config ──────────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key:    process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
});

// ─── POST handler ───────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const formData    = await req.formData();
    const videoFile   = formData.get('video')       as File | null;
    const token       = formData.get('token')       as string | null;
    const candidateId = formData.get('candidateId') as string | null;
    const questionIdx = formData.get('questionIdx') as string | null;

    if (!videoFile || !token || !candidateId || questionIdx === null) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const qIdx = parseInt(questionIdx, 10);

    const arrayBuffer = await videoFile.arrayBuffer();
    const buffer      = Buffer.from(arrayBuffer);

    // ── Upload to Cloudinary ─────────────────────────────────────────────
    const uploadResult = await new Promise<any>((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          resource_type: 'video',
          folder:        `smarthire/interviews/${candidateId}`,
          public_id:     `q${qIdx + 1}`,
          overwrite:     true,
          tags:          ['interview', `candidate_${candidateId}`, `token_${token}`],
          video_codec:   'auto',
          eager: [
            { width: 400, height: 300, crop: 'fill', format: 'jpg', start_offset: '2' },
          ],
          eager_async: true,
          context:     `candidate_id=${candidateId}|question_index=${qIdx}|token=${token}`,
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        },
      ).end(buffer);
    });

    const videoUrl     = uploadResult.secure_url               as string;
    const thumbnailUrl = (uploadResult.eager?.[0]?.secure_url ?? '') as string;
    const publicId     = uploadResult.public_id                as string;
    const duration     = uploadResult.duration                 as number | null;

    // ── Save to Firestore ────────────────────────────────────────────────
    const db  = getFirestore();
    const ref = db.collection('candidates').doc(candidateId);

    await ref.set(
      {
        videoAnswers: admin.firestore.FieldValue.arrayUnion({
          questionIdx: qIdx,
          videoUrl,
          thumbnailUrl,
          publicId,
          duration:    duration ?? null,
          uploadedAt:  new Date().toISOString(),
        }),
        interviewStatus:      'submitted',
        interviewSubmittedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastToken:            token,
      },
      { merge: true },
    );

    console.log(`[complete] Q${qIdx + 1} uploaded for ${candidateId} -> ${videoUrl}`);

    return NextResponse.json({
      success:     true,
      videoUrl,
      thumbnailUrl,
      publicId,
      questionIdx: qIdx,
    });

  } catch (err: any) {
    console.error('[complete] Error:', err);
    return NextResponse.json(
      { error: 'Upload failed', detail: err.message },
      { status: 500 },
    );
  }
}