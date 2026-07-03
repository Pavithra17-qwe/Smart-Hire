// app/api/interview/reschedule/info/route.ts
//
// GET /api/interview/reschedule/info?token=xxx
// Used by the reschedule page (server component) to show the candidate
// their current interview date/time and whether they're still eligible
// to reschedule, without exposing anything else about the candidate doc.

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';

const THREE_DAYS_MS = 48 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'Missing token.' }, { status: 400 });

  const interviewSnap = await adminDb
    .collection('ai_interviews')
    .where('token', '==', token)
    .limit(1)
    .get();

  if (interviewSnap.empty) {
    return NextResponse.json({ eligible: false, reason: 'invalid_link' }, { status: 200 });
  }

  if (interviewSnap.empty) {
    return NextResponse.json({ eligible: false, reason: 'invalid_link' }, { status: 200 });
  }

  const interviewData = interviewSnap.docs[0].data();

  // ── Candidate already completed this interview — reschedule no longer applies ──
  if (interviewData.status === 'completed') {
    return NextResponse.json({ eligible: false, reason: 'already_completed' }, { status: 200 });
  }

  const candidateId = interviewData.candidateId;
  if (!candidateId) return NextResponse.json({ eligible: false, reason: 'invalid_link' }, { status: 200 });

  const candidateSnap = await adminDb.collection('candidates').doc(candidateId).get();
  if (!candidateSnap.exists) return NextResponse.json({ eligible: false, reason: 'invalid_link' }, { status: 200 });

  const c = candidateSnap.data() as Record<string, any>;

  if (c.l1RescheduleUsed === true) {
    return NextResponse.json({
      eligible: false,
      reason: 'already_used',
      currentDate: c.l1ScheduledDate || null,
      currentTimeSlot: c.l1TimeSlot || null,
    });
  }

  const sentAtMs: number = c.l1AIInterviewSentAt?.toMillis?.() ?? 0;
  const deadlineMs = sentAtMs ? sentAtMs + THREE_DAYS_MS : 0;

  if (!sentAtMs || Date.now() > deadlineMs) {
    return NextResponse.json({
      eligible: false,
      reason: 'window_closed',
      currentDate: c.l1ScheduledDate || null,
      currentTimeSlot: c.l1TimeSlot || null,
    });
  }

  return NextResponse.json({
    eligible: true,
    candidateName: c.candidateName || '',
    currentDate: c.l1ScheduledDate || null,
    currentTimeSlot: c.l1TimeSlot || null,
    rescheduleDeadline: deadlineMs,
  });
}