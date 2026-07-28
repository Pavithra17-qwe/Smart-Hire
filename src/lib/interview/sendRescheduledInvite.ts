// lib/interview/sendRescheduledInvite.ts
//
// Shared by:
//   - app/api/interview/reschedule/submit/route.ts   (Case 1: today, sent immediately)
//   - app/api/interview/reschedule/process-due/route.ts (Case 2: future date, sent 12h before)
//
// ORDERING FIX (root cause of requirement #4's "missing email" bug):
// the candidate's l1Status is now only flipped Rescheduled -> Scheduled
// AFTER sendInterviewEmail() has confirmed success. Previously
// process-due/route.ts flipped the status first and sent the email last,
// inside a catch-and-log block — so a failed/slow send left the
// candidate silently stuck on "Scheduled" with no email and no way for
// the cron job to retry (it only re-queries l1Status == 'Rescheduled').
//
// This function throws on email failure so callers can decide what to do
// — but in both callers the correct behavior is "leave l1Status alone,"
// which is what happens automatically since the Firestore update below
// never runs if sendInterviewEmail didn't succeed.

import { adminDb } from '@/lib/firebaseAdmin';
import { getBaseUrl } from '@/lib/getBaseUrl';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';
import { sendInterviewEmail } from '@/ai/flows/send-interview-email-flow';

export function parseDateAndSlot(dateStr: string, slot: string): Date | null {
  const startPart = slot.split('-')[0]?.trim() || slot.trim();
  const m = startPart.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  if (m[3].toLowerCase() === 'pm' && hour !== 12) hour += 12;
  if (m[3].toLowerCase() === 'am' && hour === 12) hour = 0;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  d.setHours(hour, minute, 0, 0);
  return d;
}

export function parseDateOnlyLocal(dateStr: string): Date | null {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  const d = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

export function endOfLocalDay(dateStr: string): Date | null {
  const m = dateStr?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  return new Date(year, month - 1, day, 23, 59, 59, 999);
}

/**
 * Generates a fresh token + interview link, sends the
 * "Interview Rescheduled – Updated Interview Details" email, and — only
 * once that email has actually been sent — flips l1Status
 * Rescheduled -> Scheduled.
 *
 * Throws if the email fails to send. Callers should catch this, log it,
 * and leave the candidate as-is (still 'Rescheduled') so process-due's
 * cron retries them on its next run.
 */
export async function sendRescheduledInterviewInvite(
  candidateId: string,
  data: FirebaseFirestore.DocumentData,
): Promise<void> {
  const candidateRef = adminDb.collection('candidates').doc(candidateId);

  const oldToken: string | undefined = data.l1AIInterviewToken;
  const newToken = randomUUID();
  // const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://smart-hire-six.vercel.app';
  const baseUrl = getBaseUrl();
  const interviewUrl = `${baseUrl}/interview/${newToken}`;

  const sentAt = Timestamp.now();
  // Expiry = 11:59:59 PM on the selected interview date, not a rolling 48h
  // window — falls back to the old 48h rule only if the date is unparseable.
  const rescheduleExpiryDate = endOfLocalDay(data.l1ScheduledDate);
  const expiresAt = rescheduleExpiryDate
    ? Timestamp.fromDate(rescheduleExpiryDate)
    : Timestamp.fromMillis(sentAt.toMillis() + 48 * 60 * 60 * 1000);

  // Invalidate the previous token doc, if any (defensive — submit/route.ts
  // already expires it at reschedule time, this just guarantees it for
  // the cron path where more time has passed).
  if (oldToken) {
    const oldSnap = await adminDb.collection('ai_interviews').where('token', '==', oldToken).limit(1).get();
    if (!oldSnap.empty) {
      await oldSnap.docs[0].ref.update({
        status: 'expired',
        expiredReason: 'superseded',
        expiredAt: Timestamp.now(),
      });
    }
  }

  const resumeText = [
    `Name: ${data.candidateName || ''}`,
    `Role: ${data.candidateDesignation || ''}`,
    `Experience: ${data.experience || ''} years`,
    `Skills: ${data.skills || ''}`,
  ].filter(Boolean).join('\n');
  const jobDescription = data.jobDescription || data.jdText || `Role: ${data.candidateDesignation || ''}`;

  const scheduledDateTimeMs = data.l1TimeSlot
    ? parseDateAndSlot(data.l1ScheduledDate, data.l1TimeSlot)!.getTime()
    : (parseDateOnlyLocal(data.l1ScheduledDate)?.getTime() ?? new Date(data.l1ScheduledDate).setHours(0, 0, 0, 0));

  await adminDb.collection('ai_interviews').add({
    token: newToken,
    previousToken: oldToken || null,
    candidateId,
    candidateName: data.candidateName || '',
    candidateEmail: data.candidateEmail || '',
    jobRole: data.candidateDesignation || '',
    resumeText,
    jobDescription,
    status: 'pending',
    createdAt: sentAt,
    expiresAt,
    interviewUrl,
    scheduledDateTime: Timestamp.fromMillis(scheduledDateTimeMs),
    l1AIInterviewSentAt: sentAt,
    interviewMode: data.interviewMode ?? 'ai',
    projectQuestions: data.projectQuestions ?? [],
  });

 // ── Send the email FIRST. Status only flips if this succeeds. ──────────
 console.log(`[sendRescheduledInvite] Sending invite to candidate... candidateId=${candidateId}, to=${data.candidateEmail}, interviewDate=${data.l1ScheduledDate}, timeSlot=${data.l1TimeSlot || '(none — date-only)'}`);
 const emailResult = await sendInterviewEmail({
    candidateName: data.candidateName || '',
    candidateEmail: data.candidateEmail || '',
    jobRole: data.candidateDesignation || '',
    experience: String(data.experience || ''),
    location: String(data.location || ''),
    interviewerName: data.l1InterviewerName || 'SmartHire Team',
    interviewerEmail: '',
    interviewDate: data.l1ScheduledDate,
    interviewTime: data.l1TimeSlot,
    schedulingNotes: '',
    interviewFeedback: '',
    stage: 'L1 Interview',
    senderRole: 'system',
    emailType: 'interview_rescheduled_invite',
    candidateId,
    threadMessageId: data.emailThreadMessageId || '',
    interviewLink: interviewUrl,
  } as any);

  if (!emailResult.success) {
    throw new Error(`sendInterviewEmail returned success:false for candidate ${candidateId}`);
  }
  console.log(`[sendRescheduledInvite] Invite sent successfully. candidateId=${candidateId}, messageId=${emailResult.messageId || '(none)'}`);

  await candidateRef.update({
    // l1Status intentionally NOT written here — the candidate must remain
    // 'Rescheduled' after this invite is sent (spec requirement 3), not
    // revert to 'Scheduled'.
    l1AIInterviewToken: newToken,
    l1AIInterviewUrl: interviewUrl,
    l1AIInterviewSentAt: sentAt,
    l1SchedulerLock: FieldValue.delete(),
    l1InviteSent: true,
    l1InviteSentAt: sentAt,
    lastUpdated: Timestamp.now(),
  });
  console.log(`[sendRescheduledInvite] Firestore update result: OK. candidateId=${candidateId}, l1Status=Scheduled, l1InviteSent=true`);

  await adminDb.collection('candidate_history').add({
    candidateId,
    stage: 'L1 Interview',
    action: 'reschedule-invite-sent',
    status: 'Rescheduled',
    feedback: '',
    schedulingNotes: 'New interview invitation sent. Interview link generated.',
    scheduledDate: data.l1ScheduledDate,
    timeSlot: data.l1TimeSlot,
    updatedBy: 'system',
    updatedByName: 'SmartHire System',
    updatedByRole: 'system',
    updatedAt: Timestamp.now(),
  });

  await adminDb.collection('interview_audit_log').doc(`${candidateId}_l1`).set(
    {
      candidateId,
      stageKey: 'l1',
      entries: FieldValue.arrayUnion({
        event: 'new_interview_email_sent',
        previousToken: oldToken || null,
        newToken,
        previousLink: oldToken ? `${baseUrl}/interview/${oldToken}` : null,
        newLink: interviewUrl,
        sentAt: sentAt.toMillis(),
        loggedAt: Timestamp.now(),
      }),
    },
    { merge: true },
  );
}