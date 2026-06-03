import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

export async function POST(req: NextRequest) {
  try {
    // sendBeacon sends Content-Type: text/plain, not application/json
    // req.json() fails silently on text/plain — handle both
  // In /api/interview/expire/route.ts
// Make sure this block exists — sendBeacon sends text/plain not application/json:
const contentType = req.headers.get('content-type') || '';
let token: string;
let reason: string;

if (contentType.includes('application/json')) {
  const body = await req.json();
  token  = body.token;
  reason = body.reason;
} else {
  // sendBeacon sends text/plain
  const text = await req.text();
  const body = JSON.parse(text);
  token  = body.token;
  reason = body.reason;
}

    console.log('[expire] Called with token:', token, 'reason:', reason);

    if (!token) return NextResponse.json({ error: 'No token' }, { status: 400 });

    const snap = await adminDb
      .collection('ai_interviews')
      .where('token', '==', token)
      .limit(1)
      .get();

    if (snap.empty) {
      console.log('[expire] ❌ No ai_interview found for token:', token);
      return NextResponse.json({ ok: false, error: 'Not found' });
    }

    const data = snap.docs[0].data();
    console.log('[expire] Found ai_interview, candidateId:', data.candidateId);

    await snap.docs[0].ref.update({
      status:        'expired',
      expiredReason: reason || 'unknown',
      expiredAt:     FieldValue.serverTimestamp(),
    });
    console.log('[expire] ✅ ai_interviews doc updated');

    if (data.candidateId) {
      await adminDb.doc(`candidates/${data.candidateId}`).update({
        l1Status:          'Expired',
        l1AIStatus:        'expired',
        l1AIExpiredAt:     FieldValue.serverTimestamp(),
        l1AIExpiredReason: reason || 'unknown',
         l1AIInterviewStartedAt: null,
  l1AISessionActive:      false,
      });
      console.log('[expire] ✅ candidates doc updated:', data.candidateId);
    } else {
      console.log('[expire] ❌ No candidateId in ai_interview doc!');
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[expire] ❌ Error:', err);
    return NextResponse.json({ ok: false });
  }
}