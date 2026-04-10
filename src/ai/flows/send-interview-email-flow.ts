'use server';
/**
 * @fileOverview Sends interview/offer emails via Nodemailer SMTP.
 *
 * EMAIL THREADING:
 *   - First email for a candidate saves its messageId to Firestore
 *     as `emailThreadMessageId` on the candidate document.
 *   - All subsequent emails pass that messageId in `In-Reply-To`
 *     and `References` headers so they land in the same thread.
 *   - Subject is always "Candidate Update – <name> (<role>)" so
 *     email clients recognise it as the same conversation.
 *
 * Two separate feedback fields in email:
 *   schedulingNotes   — entered when proposing interview date/time
 *   interviewFeedback — entered after interview when selecting/rejecting
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { db } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp, doc, updateDoc } from 'firebase/firestore';
import nodemailer from 'nodemailer';

// ─────────────────────────────────────────────
// INPUT SCHEMA
// ─────────────────────────────────────────────
const SendInterviewEmailInputSchema = z.object({
  candidateName:     z.string(),
  candidateEmail:    z.string().email(),
  jobRole:           z.string(),
  experience:        z.string().optional().default(''),
  location:          z.string().optional().default(''),
  interviewerName:   z.string(),
  interviewerEmail:  z.string().optional().default(''),
  interviewDate:     z.string().optional().default(''),
  interviewTime:     z.string().optional().default(''),
  schedulingNotes:   z.string().optional().default(''),
  interviewFeedback: z.string().optional().default(''),
  stage:             z.string().optional().default(''),

  senderRole: z.enum(['panel', 'hr', 'system']).optional(),

  emailType: z.enum([
    'resume_accepted',
    'resume_rejected',
    'interview_scheduled',
    'candidate_selected',
    'candidate_rejected',
    'offer_released',
    'offer_accepted',
    'offer_rejected',
    'panel_assigned',
    'panel_feedback_submitted',
  ]).optional(),

  // ── THREADING FIELDS ──────────────────────────────────────────────────────
  // candidateId   : Firestore document ID — needed to save the first messageId
  // threadMessageId: The messageId of the FIRST email ever sent for this
  //                  candidate. Pass it in every subsequent send so nodemailer
  //                  adds In-Reply-To / References headers and clients thread them.
  candidateId:      z.string().optional().default(''),
  threadMessageId:  z.string().optional().default(''),
});

export type SendInterviewEmailInput = z.infer<typeof SendInterviewEmailInputSchema>;

export async function sendInterviewEmail(
  input: SendInterviewEmailInput
): Promise<{ success: boolean; logId?: string; messageId?: string }> {
  return sendInterviewEmailFlow(input);
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function buildFromField(senderRole?: string): string {
  const smtpUser = process.env.SMTP_FROM || process.env.SMTP_USER || '';
  let displayName = 'SmartHire';
  if (senderRole === 'panel') displayName = 'SmartHire (Panel)';
  if (senderRole === 'hr')    displayName = 'SmartHire (HR)';
  return `"${displayName}" <${smtpUser}>`;
}

/**
 * Subject is ALWAYS the same string for a given candidate so that
 * email clients (Gmail, Outlook, Apple Mail) keep all updates in
 * one conversation thread when combined with In-Reply-To headers.
 */
function getSubject(candidateName: string, jobRole: string): string {
  return `Candidate Update – ${candidateName} (${jobRole})`;
}

/**
 * Returns a human-readable label for the current action so the email
 * body clearly tells the reader what just happened.
 */
function getActionLabel(emailType: string | undefined, stage: string): string {
  switch (emailType) {
    case 'resume_accepted':          return '✅ Resume Accepted';
    case 'resume_rejected':          return '❌ Resume Rejected';
    case 'interview_scheduled':      return `📅 Interview Scheduled – ${stage}`;
    case 'candidate_selected':       return `✅ Candidate Selected – ${stage}`;
    case 'candidate_rejected':       return `❌ Candidate Rejected – ${stage}`;
    case 'offer_released':           return '📨 Offer Released';
    case 'offer_accepted':           return '🎉 Offer Accepted';
    case 'offer_rejected':           return '❌ Offer Rejected';
    case 'panel_assigned':           return `👤 Panel Assigned – ${stage}`;
    case 'panel_feedback_submitted': return `💬 Panel Feedback Submitted – ${stage}`;
    default:                         return `🔔 Status Update – ${stage}`;
  }
}

function getEmailBody(input: SendInterviewEmailInput): string {
  const {
    candidateName, jobRole, experience, location,
    interviewerName, interviewerEmail,
    interviewDate, interviewTime,
    schedulingNotes, interviewFeedback,
    emailType, senderRole, stage,
  } = input;

  const roleLabel = senderRole === 'hr' ? 'HR' : 'Panel';

  const handledBy = `
Handled by :
  - Name  : ${interviewerName}
  ${interviewerEmail ? `- Email : ${interviewerEmail}` : ''}
  - Role  : ${roleLabel}`;

  const schedNotesSection = schedulingNotes
    ? `\nScheduling Notes :\n  ${schedulingNotes}\n`
    : '';

  const feedbackSection = interviewFeedback
    ? `\nInterview Feedback :\n  ${interviewFeedback}\n`
    : '';

  // Shared candidate block
  const candidateBlock = `
Candidate   : ${candidateName}
Job Role    : ${jobRole}
Experience  : ${experience || 'N/A'}
Location    : ${location   || 'N/A'}`;

  switch (emailType) {
    case 'resume_accepted':
      return `Hi,

This is an update for the following candidate.

UPDATE : ✅ Resume Accepted
${candidateBlock}
${feedbackSection}${handledBy}

The candidate will proceed to the next stage.

Best regards,
The SmartHire Team`;

    case 'resume_rejected':
      return `Hi,

This is an update for the following candidate.

UPDATE : ❌ Resume Rejected
${candidateBlock}
${feedbackSection}${handledBy}

Thank you for your effort.

Best regards,
The SmartHire Team`;

    case 'interview_scheduled':
      return `Hi,

This is an update for the following candidate.

UPDATE : 📅 Interview Scheduled – ${stage}
${candidateBlock}
Date        : ${interviewDate}
Time Slot   : ${interviewTime}
${schedNotesSection}${handledBy}

Please ensure the candidate is informed and prepared.

Best regards,
The SmartHire Team`;

    case 'candidate_selected':
      return `Hi,

This is an update for the following candidate.

UPDATE : ✅ Candidate Selected – ${stage}
${candidateBlock}
${feedbackSection}${handledBy}

Our team will proceed with the next steps accordingly.

Best regards,
The SmartHire Team`;

    case 'candidate_rejected':
      return `Hi,

This is an update for the following candidate.

UPDATE : ❌ Candidate Rejected – ${stage}
${candidateBlock}
${feedbackSection}${handledBy}

Thank you for your support throughout this process.

Best regards,
The SmartHire Team`;

    case 'offer_released':
      return `Hi,

This is an update for the following candidate.

UPDATE : 📨 Offer Released
${candidateBlock}
${handledBy}

Kindly ensure the candidate receives and reviews the offer at the earliest.

Best regards,
The SmartHire HR Team`;

    case 'offer_accepted':
      return `Hi,

This is an update for the following candidate.

UPDATE : 🎉 Offer Accepted
${candidateBlock}
${feedbackSection}${handledBy}

Our HR team will coordinate the onboarding process.

Best regards,
The SmartHire HR Team`;

    case 'offer_rejected':
      return `Hi,

This is an update for the following candidate.

UPDATE : ❌ Offer Rejected
${candidateBlock}
${feedbackSection}${handledBy}

We appreciate all the effort invested in this process.

Best regards,
The SmartHire HR Team`;

    case 'panel_assigned':
      return `Hi,

This is an update for the following candidate.

UPDATE : 👤 You have been assigned as the interviewer – ${stage}
${candidateBlock}
Date        : ${interviewDate}
Time Slot   : ${interviewTime}
${schedNotesSection}${handledBy}

Please be available at the scheduled time.

Best regards,
The SmartHire Team`;

    default:
      return `Hi,

This is an update for the following candidate.

UPDATE : 🔔 ${stage} – Status Changed
${candidateBlock}
${handledBy}

Best regards,
The SmartHire Team`;
  }
}

// ─────────────────────────────────────────────
// GENKIT FLOW
// ─────────────────────────────────────────────
const sendInterviewEmailFlow = ai.defineFlow(
  {
    name: 'sendInterviewEmailFlow',
    inputSchema: SendInterviewEmailInputSchema,
    outputSchema: z.object({
      success:   z.boolean(),
      logId:     z.string().optional(),
      messageId: z.string().optional(),
    }),
  },
  async (input) => {

    const requiredEnvVars = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
    const missingVars = requiredEnvVars.filter((key) => !process.env[key]);

    if (missingVars.length > 0) {
      const errorMessage = `Missing required SMTP config: ${missingVars.join(', ')}`;
      console.error(`[SmartHire Email] ERROR: ${errorMessage}`);
      try {
        await addDoc(collection(db, 'notifications'), {
          type:           'Interview Email',
          recipientEmail: input.candidateEmail,
          status:         'Failed',
          error:          errorMessage,
          sentAt:         serverTimestamp(),
        });
      } catch (_) {}
      return { success: false };
    }

    const fromField = buildFromField(input.senderRole);
    // ── THREADING: subject must be IDENTICAL across all emails for this candidate
    const subject   = getSubject(input.candidateName, input.jobRole);
    const body      = getEmailBody(input);

    console.log(`[SmartHire Email] Sending "${subject}"`);
    console.log(`[SmartHire Email] From          : ${fromField}`);
    console.log(`[SmartHire Email] To             : ${input.candidateEmail}`);
    console.log(`[SmartHire Email] threadMessageId: ${input.threadMessageId || '(first email – no thread yet)'}`);

    try {
      const transporter = nodemailer.createTransport({
        host:   process.env.SMTP_HOST,
        port:   parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });

      const mailOptions: nodemailer.SendMailOptions = {
        from:    fromField,
        to:      input.candidateEmail,
        subject: subject,
        text:    body,
      };

      if (input.interviewerEmail) {
        mailOptions.replyTo = `"${input.interviewerName}" <${input.interviewerEmail}>`;
      }

      // ── THREADING HEADERS ──────────────────────────────────────────────────
      // If we already have a threadMessageId (from the first email ever sent
      // for this candidate), attach it so email clients show this as a reply
      // in the same conversation, not a new separate email.
      if (input.threadMessageId) {
        mailOptions.inReplyTo  = input.threadMessageId;
        mailOptions.references = input.threadMessageId;
        console.log(`[SmartHire Email] Threading as reply to: ${input.threadMessageId}`);
      }

      const info = await transporter.sendMail(mailOptions);
      const sentMessageId = info.messageId;
      console.log(`[SmartHire Email] SUCCESS - MessageId: ${sentMessageId}`);

      // ── SAVE THREAD MESSAGE ID ─────────────────────────────────────────────
      // If this is the FIRST email for this candidate (no threadMessageId yet),
      // save the messageId we just got back to the candidate Firestore document.
      // Every subsequent email will read this value and use it for threading.
      if (!input.threadMessageId && input.candidateId) {
        try {
          await updateDoc(doc(db, 'candidates', input.candidateId), {
            emailThreadMessageId: sentMessageId,
          });
          console.log(`[SmartHire Email] Saved emailThreadMessageId to candidate ${input.candidateId}: ${sentMessageId}`);
        } catch (saveErr) {
          // Non-fatal — threading just won't work for subsequent emails for this candidate
          console.error('[SmartHire Email] Could not save emailThreadMessageId:', saveErr);
        }
      }

      const logRef = await addDoc(collection(db, 'notifications'), {
        type:              'Interview Email',
        emailType:         input.emailType       || 'generic',
        stage:             input.stage           || '',
        senderRole:        input.senderRole      || 'system',
        interviewerName:   input.interviewerName,
        interviewerEmail:  input.interviewerEmail,
        fromField,
        candidateName:     input.candidateName,
        candidateId:       input.candidateId     || '',
        recipientEmail:    input.candidateEmail,
        jobRole:           input.jobRole,
        schedulingNotes:   input.schedulingNotes   || '',
        interviewFeedback: input.interviewFeedback || '',
        threadMessageId:   input.threadMessageId   || '',
        sentMessageId:     sentMessageId,
        status:            'Sent',
        sentAt:            serverTimestamp(),
        messageId:         sentMessageId,
      });

      return { success: true, logId: logRef.id, messageId: sentMessageId };

    } catch (error: any) {
      console.error('[SmartHire Email] FAILED:', error);
      try {
        await addDoc(collection(db, 'notifications'), {
          type:          'Interview Email',
          emailType:     input.emailType || 'generic',
          candidateName: input.candidateName,
          recipientEmail: input.candidateEmail,
          status:        'Failed',
          error:         error.message,
          sentAt:        serverTimestamp(),
        });
      } catch (_) {}
      return { success: false };
    }
  }
);