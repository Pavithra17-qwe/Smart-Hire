'use server';
/**
 * @fileOverview Sends interview/offer emails via Nodemailer SMTP.
 *
 * From display name:
 *   senderRole='panel'  => "SmartHire (Panel) <panel@email.com>"
 *   senderRole='hr'     => "SmartHire (HR) <hr@email.com>"
 *   fallback            => "SmartHire <smtp_user@email.com>"
 *
 * Reply-To is always set to senderEmail so replies go to the right person.
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
  candidateName:   z.string().describe('Full name of the candidate.'),
  candidateEmail:  z.string().email().describe('Recipient email address.'),
  jobRole:         z.string().describe('The job role being interviewed for.'),
  interviewerName: z.string().describe('Name of the interviewer or hiring team member.'),
  interviewDate:   z.string().describe('Date of the interview.'),
  interviewTime:   z.string().describe('Time slot of the interview.'),
  interviewLink:   z.string().describe('Video call link (can be empty string).'),

  // 'panel' => "SmartHire (Panel)", 'hr' => "SmartHire (HR)", default => "SmartHire"
  senderRole: z.enum(['panel', 'hr', 'system']).optional(),

  // Actual email of the logged-in panel/HR user — shown in From & Reply-To
  senderEmail: z.string().email().optional(),

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

/** Build the From display name using senderRole + senderEmail */
function buildFromField(senderRole?: string, senderEmail?: string): string {
  const smtpUser = process.env.SMTP_FROM || process.env.SMTP_USER || '';

  // Display name based on role
  let displayName = 'SmartHire';
  if (senderRole === 'panel') displayName = 'SmartHire (Panel)';
  if (senderRole === 'hr')    displayName = 'SmartHire (HR)';

  // Use senderEmail in the address if provided, else fall back to SMTP_FROM
  // NOTE: Gmail SMTP requires the actual sending address to match SMTP_USER.
  // We show senderEmail in the display label so the recipient can see who sent it.
  if (senderEmail) {
    displayName = `${displayName} via ${senderEmail}`;
  }

  return `"${displayName}" <${smtpUser}>`;
}

/** Subject line per emailType */
function getSubject(emailType: string | undefined, jobRole: string): string {
  switch (emailType) {
    case 'interview_scheduled': return `Interview Scheduled: ${jobRole} at SmartHire`;
    case 'candidate_selected':  return `You have been Selected - ${jobRole} at SmartHire`;
    case 'candidate_rejected':  return `Application Update - ${jobRole} at SmartHire`;
    case 'offer_released':      return `Offer Letter: ${jobRole} at SmartHire`;
    case 'offer_accepted':      return `Offer Accepted - ${jobRole} at SmartHire`;
    case 'offer_rejected':      return `Offer Status Update - ${jobRole} at SmartHire`;
    default:                    return `Interview Invitation: ${jobRole} at SmartHire`;
  }
}

/** Email body per emailType */
function getEmailBody(input: SendInterviewEmailInput): string {
  const { candidateName, jobRole, interviewerName, interviewDate, interviewTime, interviewLink, emailType, senderEmail } = input;
  const contactLine = senderEmail ? `\nFor queries, contact: ${senderEmail}` : '';

  switch (emailType) {
    case 'interview_scheduled':
      return `Dear ${candidateName},

We are pleased to schedule your interview for the ${jobRole} position.

Interviewer  : ${interviewerName}
Date         : ${interviewDate}
Time         : ${interviewTime}
Meeting Link : ${interviewLink}

Please be prepared to discuss your experience and qualifications.
${contactLine}

Best regards,
The SmartHire Team`;

    case 'candidate_selected':
      return `Dear ${candidateName},

We are happy to inform you that you have been selected in the ${jobRole} interview round conducted by ${interviewerName}.

Our team will contact you shortly regarding the next steps.
${contactLine}

Best regards,
The SmartHire Team`;

    case 'candidate_rejected':
      return `Dear ${candidateName},

Thank you for your time and effort during the interview process for the ${jobRole} position.

After careful consideration, we regret to inform you that we will not be moving forward with your application at this time.

We appreciate your interest and wish you the very best in your career journey.
${contactLine}

Best regards,
The SmartHire Team`;

    case 'offer_released':
      return `Dear ${candidateName},

Congratulations! We are pleased to extend an offer for the ${jobRole} position at SmartHire.

Please review the offer details and respond at your earliest convenience.
${contactLine}

Best regards,
The SmartHire HR Team`;

    case 'offer_accepted':
      return `Dear ${candidateName},

We are delighted to confirm that you have accepted the offer for the ${jobRole} position at SmartHire.

Welcome aboard! Our HR team will reach out to you soon with onboarding details.
${contactLine}

Best regards,
The SmartHire HR Team`;

    case 'offer_rejected':
      return `Dear ${candidateName},

We have received your response regarding the offer for the ${jobRole} position.

We understand your decision and appreciate all the time you spent with us throughout this process. We wish you the very best.
${contactLine}

Best regards,
The SmartHire HR Team`;

    default:
      return `Dear ${candidateName},

Thank you for your interest in the ${jobRole} position.

We are pleased to invite you for an interview with ${interviewerName}.

Date : ${interviewDate}
Time : ${interviewTime}
Link : ${interviewLink}
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

    const fromField = buildFromField(input.senderRole, input.senderEmail);
    const subject   = getSubject(input.emailType, input.jobRole);
    const body      = getEmailBody(input);

    console.log(`[SmartHire Email] Sending "${subject}"`);
    console.log(`[SmartHire Email] From    : ${fromField}`);
    console.log(`[SmartHire Email] Reply-To: ${input.senderEmail || 'not set'}`);
    console.log(`[SmartHire Email] To      : ${input.candidateEmail}`);

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

      // Set Reply-To to the actual panel/HR user's email so replies go to them
      if (input.senderEmail) {
        mailOptions.replyTo = input.senderEmail;
      }

      const info = await transporter.sendMail(mailOptions);

      console.log(`[SmartHire Email] SUCCESS - MessageId: ${info.messageId}`);

      const logRef = await addDoc(collection(db, 'notifications'), {
        type:           'Interview Email',
        emailType:      input.emailType || 'generic',
        senderRole:     input.senderRole || 'system',
        senderEmail:    input.senderEmail || null,
        fromField:      fromField,
        candidateName:  input.candidateName,
        recipientEmail: input.candidateEmail,
        jobRole:        input.jobRole,
        status:         'Sent',
        sentAt:         serverTimestamp(),
        messageId:      info.messageId,
      });

      return { success: true, logId: logRef.id };

    } catch (error: any) {
      console.error('[SmartHire Email] FAILED:', error);
      try {
        await addDoc(collection(db, 'notifications'), {
          type:           'Interview Email',
          emailType:      input.emailType || 'generic',
          candidateName:  input.candidateName,
          recipientEmail: input.candidateEmail,
          senderEmail:    input.senderEmail || null,
          status:         'Failed',
          error:          error.message,
          sentAt:         serverTimestamp(),
        });
      } catch (logErr) {
        console.error('[SmartHire Email] Failed to log error:', logErr);
      }
      return { success: false };
    }
  }
);