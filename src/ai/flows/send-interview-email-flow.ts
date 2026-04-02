'use server';
/**
 * @fileOverview Sends interview/offer emails via Nodemailer SMTP.
 *
 * Recipient  : Always the uploader (HR or Agency who added the candidate)
 * From name  :
 *   senderRole='panel' => "SmartHire (Panel) <smtp_user>"
 *   senderRole='hr'    => "SmartHire (HR) <smtp_user>"
 *   fallback           => "SmartHire <smtp_user>"
 *
 * Email body includes:
 *   - Candidate name + job role
 *   - Interview date/time (for schedule emails)
 *   - Panel/HR member name + their email (so uploader knows who to contact)
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
  candidateName:    z.string().describe('Full name of the candidate.'),
  candidateEmail:   z.string().email().describe('Recipient email address (the uploader — HR or Agency).'),
  jobRole:          z.string().describe('The job role being interviewed for.'),
  experience: z.string().optional().default(''),
location: z.string().optional().default(''),
  interviewerName:  z.string().describe('Display name of the panel/HR member who performed the action.'),
  interviewerEmail: z.string().optional().default('').describe('Email of the panel/HR member — shown in body so uploader can contact them.'),
  interviewDate:    z.string().optional().default('').describe('Date of the interview (for schedule emails, else empty string).'),
  interviewTime:    z.string().optional().default('').describe('Time slot of the interview (for schedule emails, else empty string).'),

  // Controls From display name
  senderRole: z.enum(['panel', 'hr', 'system']).optional(),

  // Controls subject line and email body content
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

// ─────────────────────────────────────────────
// PUBLIC EXPORT
// ─────────────────────────────────────────────
export async function sendInterviewEmail(
  input: SendInterviewEmailInput
): Promise<{ success: boolean; logId?: string }> {
  return sendInterviewEmailFlow(input);
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/** Build the From display name using senderRole */
function buildFromField(senderRole?: string): string {
  const smtpUser = process.env.SMTP_FROM || process.env.SMTP_USER || '';
  let displayName = 'SmartHire';
  if (senderRole === 'panel') displayName = 'SmartHire (Panel)';
  if (senderRole === 'hr')    displayName = 'SmartHire (HR)';
  return `"${displayName}" <${smtpUser}>`;
}

/** Subject line per emailType */
function getSubject(emailType: string | undefined, jobRole: string, candidateName: string): string {
  switch (emailType) {
    case 'interview_scheduled': return `Interview Scheduled for ${candidateName} — ${jobRole}`;
    case 'candidate_selected':  return `${candidateName} Selected — ${jobRole}`;
    case 'candidate_rejected':  return `${candidateName} Rejected — ${jobRole}`;
    case 'offer_released':      return `Offer Released for ${candidateName} — ${jobRole}`;
    case 'offer_accepted':      return `${candidateName} Accepted the Offer — ${jobRole}`;
    case 'offer_rejected':      return `${candidateName} Rejected the Offer — ${jobRole}`;
    default:                    return `Interview Update for ${candidateName} — ${jobRole}`;
  }
}

/** Email body per emailType — includes candidate name, job role, date/time (if relevant), interviewer name + email */
function getEmailBody(input: SendInterviewEmailInput): string {
  const {
    candidateName, jobRole,
    experience,location,
    interviewerName, interviewerEmail,
    interviewDate, interviewTime, 
    emailType,
    senderRole,
  } = input;

  // Contact line always shown so uploader knows who handled this
  const roleLabel = senderRole === 'hr' ? 'HR' : 'Panel';

  const contactLine = `
  Handled by :
  - Name  : ${interviewerName}
  ${interviewerEmail ? `- Email : ${interviewerEmail}` : ''}
  - Role  : ${roleLabel}
  `;

  switch (emailType) {

    // ── Interview Scheduled ──
    case 'interview_scheduled':
      return `Hi,

An interview has been scheduled for the following candidate.
Candidate   : ${candidateName}
Job Role    : ${jobRole}
Experience : ${experience || 'N/A'}
Location   : ${location || 'N/A'}
Date        : ${interviewDate}
Time Slot   : ${interviewTime}
${contactLine}

Please ensure the candidate is informed and prepared.

Best regards,
The SmartHire Team`;

    // ── Candidate Selected ──
    case 'candidate_selected':
      return `Hi,

We are pleased to inform you that the following candidate has been selected and will be moving to the next stage.
Candidate   : ${candidateName}
Job Role    : ${jobRole}
Experience : ${experience || 'N/A'}
Location   : ${location || 'N/A'}
${contactLine}

Our team will proceed with the next steps accordingly.

Best regards,
The SmartHire Team`;

    // ── Candidate Rejected ──
    case 'candidate_rejected':
      return `Hi,

After careful evaluation, the following candidate has not been selected to proceed further at this stage.

Candidate   : ${candidateName}
Job Role    : ${jobRole}
Experience : ${experience || 'N/A'}
Location   : ${location || 'N/A'}
${contactLine}

Thank you for your support throughout this process.

Best regards,
The SmartHire Team`;

    // ── Offer Released ──
    case 'offer_released':
      return `Hi,

An offer has been released for the following candidate. Please follow up with them regarding acceptance.

Candidate   : ${candidateName}
Job Role    : ${jobRole}
Experience : ${experience || 'N/A'}
Location   : ${location || 'N/A'}
${contactLine}

Kindly ensure the candidate receives and reviews the offer at the earliest.

Best regards,
The SmartHire HR Team`;

    // ── Offer Accepted ──
    case 'offer_accepted':
      return `Hi,

Great news! The following candidate has accepted the offer and will be joining us.

Candidate   : ${candidateName}
Job Role    : ${jobRole}
Experience : ${experience || 'N/A'}
Location   : ${location || 'N/A'}
${contactLine}

Our HR team will coordinate the onboarding process. Please keep the candidate informed.

Best regards,
The SmartHire HR Team`;

    // ── Offer Rejected ──
    case 'offer_rejected':
      return `Hi,

The following candidate has declined the offer for the ${jobRole} position.
Candidate   : ${candidateName}
Job Role    : ${jobRole}
Experience : ${experience || 'N/A'}
Location   : ${location || 'N/A'}
${contactLine}

We appreciate all the effort invested in this process. Please reach out if you have any queries.

Best regards,
The SmartHire HR Team`;

    // ── Fallback ──
    default:
      return `Hi,

There has been an update regarding the following candidate.

Candidate Details:
- Name       : ${candidateName}
- Role       : ${jobRole}
- Experience : ${experience || 'N/A'}
- Location   : ${location || 'N/A'}
${contactLine}

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
      success: z.boolean(),
      logId: z.string().optional(),
    }),
  },
  async (input) => {

    // Validate SMTP env vars
    const requiredEnvVars = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
    const missingVars = requiredEnvVars.filter((key) => !process.env[key]);

    if (missingVars.length > 0) {
      const errorMessage = `Missing required SMTP config: ${missingVars.join(', ')}`;
      console.error(`[SmartHire Email] ERROR: ${errorMessage}`);
      try {
        await addDoc(collection(db, 'notifications'), {
          type: 'Interview Email',
          recipientEmail: input.candidateEmail,
          status: 'Failed',
          error: errorMessage,
          sentAt: serverTimestamp(),
        });
      } catch (logErr) {
        console.error('[SmartHire Email] Failed to log config error:', logErr);
      }
      return { success: false };
    }

    const fromField = buildFromField(input.senderRole);
    const subject   = getSubject(input.emailType, input.jobRole, input.candidateName);
    const body      = getEmailBody(input);

    console.log(`[SmartHire Email] Sending "${subject}"`);
    console.log(`[SmartHire Email] From        : ${fromField}`);
    console.log(`[SmartHire Email] To          : ${input.candidateEmail}`);
    console.log(`[SmartHire Email] Interviewer : ${input.interviewerName} <${input.interviewerEmail}>`);

    try {
      const transporter = nodemailer.createTransport({
        host:   process.env.SMTP_HOST,
        port:   parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      const mailOptions: nodemailer.SendMailOptions = {
        from:    fromField,
        to:      input.candidateEmail,
        subject: subject,
        text:    body,
      };

      // Reply-To goes to the actual panel/HR member so uploader can directly reply to them
      if (input.interviewerEmail) {
        mailOptions.replyTo = `"${input.interviewerName}" <${input.interviewerEmail}>`;
      }

      const info = await transporter.sendMail(mailOptions);
      console.log(`[SmartHire Email] SUCCESS - MessageId: ${info.messageId}`);

      const logRef = await addDoc(collection(db, 'notifications'), {
        type:             'Interview Email',
        emailType:        input.emailType || 'generic',
        senderRole:       input.senderRole || 'system',
        interviewerName:  input.interviewerName,
        interviewerEmail: input.interviewerEmail,
        fromField:        fromField,
        candidateName:    input.candidateName,
        recipientEmail:   input.candidateEmail,  // uploader's email
        jobRole:          input.jobRole,
        status:           'Sent',
        sentAt:           serverTimestamp(),
        messageId:        info.messageId,
      });

      return { success: true, logId: logRef.id };

    } catch (error: any) {
      console.error('[SmartHire Email] FAILED:', error);
      try {
        await addDoc(collection(db, 'notifications'), {
          type:             'Interview Email',
          emailType:        input.emailType || 'generic',
          candidateName:    input.candidateName,
          recipientEmail:   input.candidateEmail,
          interviewerEmail: input.interviewerEmail || null,
          status:           'Failed',
          error:            error.message,
          sentAt:           serverTimestamp(),
        });
      } catch (logErr) {
        console.error('[SmartHire Email] Failed to log error:', logErr);
      }
      return { success: false };
    }
  }
);