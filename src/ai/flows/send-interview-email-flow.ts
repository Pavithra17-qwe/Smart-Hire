'use server';
/**
 * @fileOverview Sends interview/offer emails via Nodemailer SMTP.
 *
 * Two separate feedback fields in email:
 *   schedulingNotes   — entered when proposing interview date/time
 *   interviewFeedback — entered after interview when selecting/rejecting
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { db } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
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
  schedulingNotes:   z.string().optional().default(''),   // ← notes at scheduling time
  interviewFeedback: z.string().optional().default(''),   // ← feedback after interview
  stage:             z.string().optional().default(''),

  senderRole: z.enum(['panel', 'hr', 'system']).optional(),

  emailType: z.enum([
    'interview_scheduled',
    'candidate_selected',
    'candidate_rejected',
    'offer_released',
    'offer_accepted',
    'offer_rejected',
  ]).optional(),
});

export type SendInterviewEmailInput = z.infer<typeof SendInterviewEmailInputSchema>;

export async function sendInterviewEmail(
  input: SendInterviewEmailInput
): Promise<{ success: boolean; logId?: string }> {
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
 * Subject: "<Stage> - <candidateName> <verb> — <jobRole>"
 * e.g. "L1 Interview - kiran Scheduled — DEV"
 */
function getSubject(emailType: string | undefined, jobRole: string, candidateName: string, stage: string): string {
  const prefix = stage ? `${stage} - ` : '';
  switch (emailType) {
    case 'interview_scheduled': return `${prefix}${candidateName} Scheduled — ${jobRole}`;
    case 'candidate_selected':  return `${prefix}${candidateName} Selected — ${jobRole}`;
    case 'candidate_rejected':  return `${prefix}${candidateName} Rejected — ${jobRole}`;
    case 'offer_released':      return `${prefix}${candidateName} Offer Released — ${jobRole}`;
    case 'offer_accepted':      return `${prefix}${candidateName} Offer Accepted — ${jobRole}`;
    case 'offer_rejected':      return `${prefix}${candidateName} Offer Rejected — ${jobRole}`;
    default:                    return `${prefix}${candidateName} Update — ${jobRole}`;
  }
}

function getEmailBody(input: SendInterviewEmailInput): string {
  const {
    candidateName, jobRole, experience, location,
    interviewerName, interviewerEmail,
    interviewDate, interviewTime,
    schedulingNotes, interviewFeedback,
    emailType, senderRole,
  } = input;

  const roleLabel = senderRole === 'hr' ? 'HR' : 'Panel';

  const handledBy = `
Handled by :
  - Name  : ${interviewerName}
  ${interviewerEmail ? `- Email : ${interviewerEmail}` : ''}
  - Role  : ${roleLabel}`;

  // Only include scheduling notes section if there is content
  const schedNotesSection = schedulingNotes
    ? `\nScheduling Notes :\n  ${schedulingNotes}\n`
    : '';

  // Only include interview feedback section if there is content
  const feedbackSection = interviewFeedback
    ? `\nInterview Feedback :\n  ${interviewFeedback}\n`
    : '';

  switch (emailType) {

    case 'interview_scheduled':
      return `Hi,

An interview has been scheduled for the following candidate.

Candidate   : ${candidateName}
Job Role    : ${jobRole}
Experience  : ${experience || 'N/A'}
Location    : ${location  || 'N/A'}
Date        : ${interviewDate}
Time Slot   : ${interviewTime}
${schedNotesSection}${handledBy}

Please ensure the candidate is informed and prepared.

Best regards,
The SmartHire Team`;

    case 'candidate_selected':
      return `Hi,

We are pleased to inform you that the following candidate has been selected and will be moving to the next stage.

Candidate   : ${candidateName}
Job Role    : ${jobRole}
Experience  : ${experience || 'N/A'}
Location    : ${location  || 'N/A'}
${feedbackSection}${handledBy}

Our team will proceed with the next steps accordingly.

Best regards,
The SmartHire Team`;

    case 'candidate_rejected':
      return `Hi,

After careful evaluation, the following candidate has not been selected to proceed further at this stage.

Candidate   : ${candidateName}
Job Role    : ${jobRole}
Experience  : ${experience || 'N/A'}
Location    : ${location  || 'N/A'}
${feedbackSection}${handledBy}

Thank you for your support throughout this process.

Best regards,
The SmartHire Team`;

    case 'offer_released':
      return `Hi,

An offer has been released for the following candidate. Please follow up with them regarding acceptance.

Candidate   : ${candidateName}
Job Role    : ${jobRole}
Experience  : ${experience || 'N/A'}
Location    : ${location  || 'N/A'}
${handledBy}

Kindly ensure the candidate receives and reviews the offer at the earliest.

Best regards,
The SmartHire HR Team`;

    case 'offer_accepted':
      return `Hi,

Great news! The following candidate has accepted the offer and will be joining us.

Candidate   : ${candidateName}
Job Role    : ${jobRole}
Experience  : ${experience || 'N/A'}
Location    : ${location  || 'N/A'}
${feedbackSection}${handledBy}

Our HR team will coordinate the onboarding process. Please keep the candidate informed.

Best regards,
The SmartHire HR Team`;

    case 'offer_rejected':
      return `Hi,

The following candidate has declined the offer.

Candidate   : ${candidateName}
Job Role    : ${jobRole}
Experience  : ${experience || 'N/A'}
Location    : ${location  || 'N/A'}
${feedbackSection}${handledBy}

We appreciate all the effort invested in this process.

Best regards,
The SmartHire HR Team`;

    default:
      return `Hi,

There has been an update regarding the following candidate.

Candidate   : ${candidateName}
Job Role    : ${jobRole}
Experience  : ${experience || 'N/A'}
Location    : ${location  || 'N/A'}
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
    outputSchema: z.object({ success: z.boolean(), logId: z.string().optional() }),
  },
  async (input) => {

    const requiredEnvVars = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
    const missingVars = requiredEnvVars.filter((key) => !process.env[key]);

    if (missingVars.length > 0) {
      const errorMessage = `Missing required SMTP config: ${missingVars.join(', ')}`;
      console.error(`[SmartHire Email] ERROR: ${errorMessage}`);
      try {
        await addDoc(collection(db, 'notifications'), { type: 'Interview Email', recipientEmail: input.candidateEmail, status: 'Failed', error: errorMessage, sentAt: serverTimestamp() });
      } catch (_) {}
      return { success: false };
    }

    const fromField = buildFromField(input.senderRole);
    const subject   = getSubject(input.emailType, input.jobRole, input.candidateName, input.stage || '');
    const body      = getEmailBody(input);

    console.log(`[SmartHire Email] Sending "${subject}"`);
    console.log(`[SmartHire Email] From : ${fromField}`);
    console.log(`[SmartHire Email] To   : ${input.candidateEmail}`);
    console.log(`[SmartHire Email] By   : ${input.interviewerName} <${input.interviewerEmail}>`);

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

      const info = await transporter.sendMail(mailOptions);
      console.log(`[SmartHire Email] SUCCESS - MessageId: ${info.messageId}`);

      const logRef = await addDoc(collection(db, 'notifications'), {
        type:              'Interview Email',
        emailType:         input.emailType   || 'generic',
        stage:             input.stage       || '',
        senderRole:        input.senderRole  || 'system',
        interviewerName:   input.interviewerName,
        interviewerEmail:  input.interviewerEmail,
        fromField,
        candidateName:     input.candidateName,
        recipientEmail:    input.candidateEmail,
        jobRole:           input.jobRole,
        schedulingNotes:   input.schedulingNotes   || '',
        interviewFeedback: input.interviewFeedback || '',
        status:            'Sent',
        sentAt:            serverTimestamp(),
        messageId:         info.messageId,
      });

      return { success: true, logId: logRef.id };

    } catch (error: any) {
      console.error('[SmartHire Email] FAILED:', error);
      try {
        await addDoc(collection(db, 'notifications'), {
          type: 'Interview Email', emailType: input.emailType || 'generic',
          candidateName: input.candidateName, recipientEmail: input.candidateEmail,
          status: 'Failed', error: error.message, sentAt: serverTimestamp(),
        });
      } catch (_) {}
      return { success: false };
    }
  }
);