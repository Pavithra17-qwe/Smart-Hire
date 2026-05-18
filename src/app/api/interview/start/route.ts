import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

export async function POST(req: NextRequest) {
  const { token } = await req.json();
  if (!token) return NextResponse.json({ error: 'No token' }, { status: 400 });

  try {
    // Find doc by token field in ai_interviews collection
    const snap = await adminDb
      .collection('ai_interviews')
      .where('token', '==', token)
      .limit(1)
      .get();

    if (snap.empty) {
      return NextResponse.json({ error: 'Token not found' }, { status: 404 });
    }

    const docData = snap.docs[0].data();

    await snap.docs[0].ref.update({
      status:           'in_progress',
      sessionStartedAt: FieldValue.serverTimestamp(),
    });
    
    // ── NEW: also update candidate doc so HR sees live status ────────
    if (docData.candidateId) {
      await adminDb.doc(`candidates/${docData.candidateId}`).update({
        l1AIStatus:  'in_progress',
        lastUpdated: FieldValue.serverTimestamp(),
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[start] Error:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}