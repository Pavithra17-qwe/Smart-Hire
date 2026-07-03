// app/api/interview/reschedule/submit/route.ts
//
// Candidate-facing endpoint. Called from RescheduleClient.tsx when the
// candidate picks a new date/time and clicks Submit.
//
// Every rule below is enforced HERE (server-side) even though the same
// rules are also checked client-side in RescheduleClient.tsx, per the
// spec's "All validations must be enforced on both the frontend and
// backend" requirement.

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { sendRescheduledInterviewInvite } from '@/lib/interview/sendRescheduledInvite';

const THREE_DAYS_MS = 48 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token, newDate } = body as {
      token: string;
      newDate: string;      // yyyy-mm-dd
    };

    if (!token || !newDate) {
      return NextResponse.json({ error: 'Missing token or newDate.' }, { status: 400 });
    }

    // ── Resolve the interview + candidate docs from the token ──────────────
    const interviewSnap = await adminDb
      .collection('ai_interviews')
      .where('token', '==', token)
      .limit(1)
      .get();

    if (interviewSnap.empty) {
      return NextResponse.json({ error: 'Invalid or unknown interview link.' }, { status: 404 });
    }

    const interviewDoc = interviewSnap.docs[0];
    const interviewData = interviewDoc.data();
    if (interviewData.status === 'completed') {
      return NextResponse.json(
        { error: 'You have already completed this interview and cannot reschedule it.' },
        { status: 409 },
      );
    }
    const candidateId: string | undefined = interviewData.candidateId;

    if (!candidateId) {
      return NextResponse.json({ error: 'Interview link is not linked to a candidate.' }, { status: 400 });
    }

    const candidateRef = adminDb.collection('candidates').doc(candidateId);
    const candidateSnap = await candidateRef.get();
    if (!candidateSnap.exists) {
      return NextResponse.json({ error: 'Candidate not found.' }, { status: 404 });
    }
    const candidate = candidateSnap.data() as Record<string, any>;

    // ── Rule: reschedule only once ──────────────────────────────────────────
    if (candidate.l1RescheduleUsed === true) {
      return NextResponse.json(
        { error: 'You have already used your one-time reschedule request.' },
        { status: 409 },
      );
    }

    // ── Rule: only within 3 days of the original interview email ──────────
    const sentAtMs: number = candidate.l1AIInterviewSentAt?.toMillis?.() ?? 0;
    if (!sentAtMs) {
      return NextResponse.json({ error: 'No original interview invitation found.' }, { status: 400 });
    }
    const deadlineMs = sentAtMs + THREE_DAYS_MS;
    if (Date.now() > deadlineMs) {
      return NextResponse.json(
        { error: 'The 48-hour reschedule window for this interview has passed.' },
        { status: 403 },
      );
    }

    // ── Rule: only future date & time ───────────────────────────────────────
    // ── Rule: date must be within today → today+3 calendar days ────────────
    const parsedNewDate = parseYMDLocal(newDate);
    if (!parsedNewDate) {
      return NextResponse.json({ error: 'Invalid date format.' }, { status: 400 });
    }
    const todayStart = startOfLocalDay(new Date());
    const minAllowedDate = new Date(todayStart);
    minAllowedDate.setDate(minAllowedDate.getDate() + 2);
    const maxAllowedDate = new Date(todayStart);
    maxAllowedDate.setDate(maxAllowedDate.getDate() + 3);
    if (parsedNewDate.getTime() < minAllowedDate.getTime()) {
      return NextResponse.json(
        { error: 'Please select a date at least 2 days from today.' },
        { status: 400 },
      );
    }
    if (parsedNewDate.getTime() > maxAllowedDate.getTime()) {
      return NextResponse.json(
        { error: 'Please choose a date within the next 3 days.' },
        { status: 400 },
      );
    }

    // ── Time is preserved from the original schedule — not selectable ──────
    const originalSlot: string = candidate.l1TimeSlot || '';

    // ── Rule: only future date (+ time, if a slot exists) ───────────────────
    const newDateTime = originalSlot
      ? parseDateAndSlot(newDate, originalSlot)
      : parseYMDLocal(newDate);
    if (!newDateTime) {
      return NextResponse.json({ error: 'Invalid date.' }, { status: 400 });
    }
    // For date-only (no slot) candidates, compare against end-of-day so
    // "today" remains selectable even if it's already past midnight local time.
    const compareTime = originalSlot ? newDateTime.getTime() : new Date(newDateTime).setHours(23, 59, 59, 999);
    if (compareTime <= Date.now()) {
      return NextResponse.json({ error: 'Please choose a date that is still in the future.' }, { status: 400 });
    }

    // ── Snapshot the previous schedule before overwriting ───────────────────
    const previousDate = candidate.l1ScheduledDate || null;
    const previousSlot = candidate.l1TimeSlot || null;
    const rescheduledAt = Timestamp.now();

    const candidateUpdate = {
      l1Status: 'Rescheduled',
      l1ScheduledDate: newDate,
      ...(originalSlot ? { l1TimeSlot: originalSlot } : {}), // time is unchanged — carried forward as-is
      l1PreviousScheduledDate: previousDate,
      l1PreviousTimeSlot: previousSlot,
      l1RescheduleUsed: true,
      l1RescheduledAt: rescheduledAt,
      l1RescheduledBy: 'Candidate',
      // Hide the old link immediately — page.tsx / InterviewClient already
      // treat a missing/blank l1AIInterviewUrl as "nothing to show".
      l1AIInterviewUrl: '',
      lastUpdated: Timestamp.now(),
    };
    await candidateRef.update(candidateUpdate);

    // Invalidate the current interview link so it can never be opened again.
    await interviewDoc.ref.update({
      status: 'expired',
      expiredReason: 'rescheduled',
      expiredAt: Timestamp.now(),
      scheduledDateTime: Timestamp.fromDate(newDateTime),
    });

    // ── Candidate History ────────────────────────────────────────────────
   // ── Candidate History ────────────────────────────────────────────────
   await adminDb.collection('candidate_history').add({
    candidateId,
    stage: 'L1 Interview',
    action: 'candidate-reschedule',
    status: 'Rescheduled',
    feedback: '',
    schedulingNotes: '',
    scheduledDate: newDate,
    timeSlot: originalSlot || null,
    panelUid: null,
    panelName: null,
    updatedBy: 'candidate',
    updatedByName: candidate.candidateName || 'Candidate',
    updatedByRole: 'candidate',
    updatedAt: Timestamp.now(),
    extra: { previousDate, previousSlot, newDate, newTimeSlot: originalSlot },
  });

  // ── Audit log ────────────────────────────────────────────────────────
  await appendAuditLog(candidateId, 'l1', {
    event: 'candidate_reschedule',
    previousDate,
    previousSlot,
    newDate,
    newTimeSlot: originalSlot,
    candidateRescheduledAt: rescheduledAt.toMillis(),
    previousToken: token,
  });

    // ── Case 1: interview is within 12 hours — send the real invite now.
    // Case 2: further out — leave l1Status as 'Rescheduled'; process-due's
     // ── Always send the rescheduled-invite email immediately, right after
    // the candidate confirms — no cron/process-due dependency. This is the
    // only path that sends this email now; process-due is unused.
    // sendRescheduledInterviewInvite no longer flips l1Status back to
    // 'Scheduled' (see lib/interview/sendRescheduledInvite.ts) — the
    // candidate correctly stays 'Rescheduled' per spec.
    try {
      await sendRescheduledInterviewInvite(candidateId, {
        ...candidate,
        l1ScheduledDate: newDate,
        l1TimeSlot: originalSlot,
      });
      await appendAuditLog(candidateId, 'l1', {
        event: 'reschedule_invite_sent_immediately',
        sentAt: Date.now(),
        deliveryStatus: 'sent',
      });
    } catch (err) {
      console.error('[reschedule/submit] Immediate invite email failed:', err);
      await appendAuditLog(candidateId, 'l1', {
        event: 'reschedule_invite_sent_immediately',
        sentAt: Date.now(),
        deliveryStatus: 'failed',
      });
    }
   

    return NextResponse.json({
      success: true,
      newDate,
      newTimeSlot: originalSlot,
      message: 'Your interview has been successfully rescheduled.',
    });
  } catch (err) {
    console.error('[reschedule/submit] Failed:', err);
    return NextResponse.json({ error: 'Failed to reschedule interview.' }, { status: 500 });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function parseDateAndSlot(dateStr: string, slot: string): Date | null {
  // Expects slot like "3:00 PM" or "03:00pm - 04:00pm" (start half only matters).
  const startPart = slot.split('-')[0]?.trim() || slot.trim();
  const m = startPart.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  const meridiem = m[3].toLowerCase();
  if (meridiem === 'pm' && hour !== 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;

  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  d.setHours(hour, minute, 0, 0);
  return d;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function parseYMDLocal(dateStr: string): Date | null {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  const d = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

async function appendAuditLog(candidateId: string, stageKey: string, entry: Record<string, any>) {
  const ref = adminDb.collection('interview_audit_log').doc(`${candidateId}_${stageKey}`);
  await ref.set(
    {
      candidateId,
      stageKey,
      entries: FieldValue.arrayUnion({ ...entry, loggedAt: Timestamp.now() }),
    },
    { merge: true },
  );
}