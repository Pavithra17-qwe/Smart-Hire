// app/api/interview/reschedule/process-due/route.ts
//
// Same job as the old standalone Cloud Function, but as a plain Next.js
// API route living next to your other reschedule endpoints — so it shares
// the same `adminDb` and `sendInterviewEmail` imports as
// submit/route.ts and info/route.ts (no cross-project import-path issues).
//
// Trigger this on a schedule (every 5 minutes) with EITHER:
//
//   A) Vercel Cron — add to vercel.json at the project root:
//      {
//        "crons": [
//          { "path": "/api/interview/reschedule/process-due", "schedule": "*/5 * * * *" }
//        ]
//      }
//      Vercel automatically sends a request with header
//      `Authorization: Bearer ${CRON_SECRET}` when CRON_SECRET is set in
//      your project's env vars — this route checks for that below.
//
//   B) Firebase Cloud Scheduler — create a job with an HTTP target pointing
//      at this route's full URL, method POST, and an
//      `Authorization: Bearer <secret>` header matching CRON_SECRET.
//
// Only touches candidates whose Screening Round (l1) status is
// 'Rescheduled'. Idempotent via a short-lived l1SchedulerLock field so
// overlapping invocations can't double-process the same candidate.

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { sendRescheduledInterviewInvite, parseDateAndSlot, parseDateOnlyLocal } from '@/lib/interview/sendRescheduledInvite';

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const LOCK_STALE_MS = 5 * 60 * 1000; // abandoned-lock cutoff

export async function POST(req: NextRequest) {
  // ── Auth: only cron (or you, manually, for testing) may call this ────────
  const authHeader = req.headers.get('authorization') || '';
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = Date.now();
  console.log(`[process-due] Cron started at: ${new Date(now).toISOString()}`);
  const results: Array<{ candidateId: string; status: string }> = [];

  const snap = await adminDb.collection('candidates').where('l1Status', '==', 'Rescheduled').get();
  console.log(`[process-due] Candidates found with l1Status == 'Rescheduled': ${snap.size}`);
  if (snap.empty) {
    return NextResponse.json({ processed: 0, results });
  }

  for (const doc of snap.docs) {
    const candidateId = doc.id;
    const data = doc.data();

    const scheduledDate: string | undefined = data.l1ScheduledDate;
    const scheduledSlot: string | undefined = data.l1TimeSlot;

    console.log(`[process-due] Candidate found: id=${candidateId}, l1Status=${data.l1Status}, l1ScheduledDate=${scheduledDate}, l1TimeSlot=${scheduledSlot || '(none)'}, l1InviteSent=${data.l1InviteSent === true}`);

    // Dedup safety net (req #6) — the l1Status flip already prevents this
    // in the normal case since this query only matches 'Rescheduled', but
    // guard here too in case a candidate doc was re-queried mid-run.
    if (data.l1InviteSent === true) {
      console.log(`[process-due] Skipping — invite already sent. candidateId=${candidateId}, sentAt=${data.l1InviteSentAt?.toDate?.()?.toISOString?.() || '(unknown)'}`);
      results.push({ candidateId, status: 'skipped_already_sent' });
      continue;
    }

    if (!scheduledDate) {
      console.log(`[process-due] Skipping — no l1ScheduledDate. candidateId=${candidateId}`);
      results.push({ candidateId, status: 'skipped_missing_schedule' });
      continue;
    }

    const interviewTimeMs = scheduledSlot
      ? parseDateAndSlot(scheduledDate, scheduledSlot)?.getTime()
      : (parseDateOnlyLocal(scheduledDate)?.getTime() ?? new Date(scheduledDate).setHours(0, 0, 0, 0));
    if (!interviewTimeMs) {
      console.log(`[process-due] Skipping — could not parse date/slot. candidateId=${candidateId}, date=${scheduledDate}, slot=${scheduledSlot}`);
      results.push({ candidateId, status: 'skipped_unparseable_slot' });
      continue;
    }

    const sendAtMs = interviewTimeMs - TWELVE_HOURS_MS;
    console.log(`[process-due] candidateId=${candidateId} — Interview Time: ${new Date(interviewTimeMs).toISOString()}, Send At: ${new Date(sendAtMs).toISOString()}, Current Time: ${new Date(now).toISOString()}`);

    // Not yet within the 12-hour window — leave it for a later run.
    if (now < sendAtMs) {
      console.log(`[process-due] candidateId=${candidateId} — Candidate is not due yet.`);
      results.push({ candidateId, status: 'not_due_yet' });
      continue;
    }
    console.log(`[process-due] candidateId=${candidateId} — Candidate is due.`);

    // ── Idempotency guard ────────────────────────────────────────────────
    const lockMs: number = data.l1SchedulerLock?.toMillis?.() ?? 0;
    if (lockMs && now - lockMs < LOCK_STALE_MS) {
      console.log(`[process-due] candidateId=${candidateId} — Skipping, locked by another run (lock age ${now - lockMs}ms).`);
      results.push({ candidateId, status: 'locked_by_other_run' });
      continue;
    }

    const candidateRef = adminDb.collection('candidates').doc(candidateId);
    await candidateRef.update({ l1SchedulerLock: Timestamp.now() });

    try {
      await sendRescheduledInterviewInvite(candidateId, data);
      results.push({ candidateId, status: 'processed' });
    } catch (err: any) {
      console.error(`[process-due] Failed for candidate ${candidateId}:`, err?.message || err);
      console.error(`[process-due] Stack trace for candidate ${candidateId}:`, err?.stack || '(no stack available)');
      // Leave l1Status as 'Rescheduled' and clear the lock so the next run retries.
      await candidateRef.update({ l1SchedulerLock: FieldValue.delete() });
      console.log(`[process-due] candidateId=${candidateId} — Scheduler lock released after failure. Will retry on next run.`);
      results.push({ candidateId, status: 'failed' });
    }
  }

  console.log(`[process-due] Cron finished. Processed ${results.length} candidate(s):`, JSON.stringify(results));

  return NextResponse.json({ processed: results.length, results });
}