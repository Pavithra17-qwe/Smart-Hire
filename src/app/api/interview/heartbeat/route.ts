// ============================================================
// FILE 1: app/api/interview/heartbeat/route.ts  (NEW FILE)
// ============================================================
// The candidate's browser pings this every 10s during interview.
// If pings stop for 30s, a background job (or next page load) 
// marks the session expired.

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

export async function POST(req: NextRequest) {
  try {
    const { token } = await req.json();
    if (!token) return NextResponse.json({ ok: false });

    const snap = await adminDb
      .collection('ai_interviews')
      .where('token', '==', token)
      .limit(1)
      .get();

    if (snap.empty) return NextResponse.json({ ok: false });

    // Update lastHeartbeat timestamp
    await snap.docs[0].ref.update({
      lastHeartbeat: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false });
  }
}


// ============================================================
// FILE 2: Changes to page.tsx — check for stale heartbeat
// ============================================================
// In InterviewPage, add this check BEFORE the status checks:
//
//   // ── STEP 1.5: Check if heartbeat went stale (window was closed) ──
//   const lastHeartbeat = data.lastHeartbeat?.toMillis?.() ?? 0;
//   const heartbeatAge  = Date.now() - lastHeartbeat;
//   const SESSION_TIMEOUT_MS = 45_000; // 45 seconds
//
//   if (
//     data.status === 'pending' &&        // was active
//     lastHeartbeat > 0 &&               // heartbeat existed
//     heartbeatAge > SESSION_TIMEOUT_MS  // but went stale
//   ) {
//     expiredReason = 'closed';
//     await docSnap.ref.update({ status: 'expired', expiredReason: 'closed' });
//     // Also update candidate doc
//     if (data.candidateId) {
//       await adminDb.doc(`candidates/${data.candidateId}`).update({
//         l1Status: 'Expired', l1AIStatus: 'expired',
//         l1AIExpiredReason: 'closed',
//       });
//     }
//   }


// ============================================================
// FILE 3: Changes to InterviewClient.tsx — send heartbeat
// ============================================================
// Add this in the InterviewClient component, inside the 
// useEffect that watches stage === 'interview':

/*
  // ── Heartbeat: ping every 10s so server knows session is alive ──
  useEffect(() => {
    if (stage !== 'interview') return;

    const pingHeartbeat = () => {
      fetch('/api/interview/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: candidate.token }),
      }).catch(() => {});
    };

    pingHeartbeat(); // immediate first ping
    const interval = setInterval(pingHeartbeat, 10_000); // every 10s

    return () => clearInterval(interval);
  }, [stage, candidate.token]);
*/