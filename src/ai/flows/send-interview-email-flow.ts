'use server';
/**
 * @fileOverview A flow for sending interview emails.
 * The "From" name dynamically shows:
 *   - "SmartHire (Panel)" when sent by panel (L1/L2)
 *   - "SmartHire (HR)"    when sent by HR (HR Round / Offer Stage)
 *   - "SmartHire"         as fallback
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
  candidateName:  z.string().describe('Full name of the candidate.'),
  candidateEmail: z.string().email().describe('Recipient email address.'),
  jobRole:        z.string().describe('The job role being interviewed for.'),
  interviewerName: z.string().describe('Name of the interviewer or hiring team member.'),
  interviewDate:  z.string().describe('Date of the interview.'),
  interviewTime:  z.string().describe('Time slot of the interview.'),
  interviewLink:  z.string().describe('Video call link (can be empty string).'),

  // NEW: controls the "From" display name
  // 'panel' → "SmartHire (Panel)"
  // 'hr'    → "SmartHire (HR)"
  // omitted → "SmartHire"
  senderRole: z.enum(['panel', 'hr', 'system']).optional().describe('Role of the sender for From name display.'),

  // NEW: optional subject/body override label so we can customize per action
  emailType: z.enum([
    'interview_scheduled',
    'candidate_selected',
    'candidate_rejected',
    'offer_released',
    'offer_accepted',
    'offer_rejected',
  ]).optional().describe('Type of email to determine subject and body.'),
});

export type SendInterviewEmailInput = z.infer<typeof SendInterviewEmailInputSchema>;

// ─────────────────────────────────────────────
// PUBLIC FUNCTION
// ─────────────────────────────────────────────
export async function sendInterviewEmail(
  input: SendInterviewEmailInput
): Promise<{ success: boolean; logId?: string }> {
  return sendInterviewEmailFlow(input);
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/** Returns the "From" display name based on senderRole */
function getFromName(senderRole?: string): string {
  switch (senderRole) {
    case 'panel':  return 'SmartHire (Panel)';
    case 'hr':     return 'SmartHire (HR)';
    default:       return 'SmartHire';
  }
}

/** Returns subject line based on emailType */
function getSubject(emailType: string | undefined, jobRole: string): string {
  switch (emailType) {
    case 'interview_scheduled': return `Interview Scheduled: ${jobRole} at SmartHire`;
    case 'candidate_selected':  return `Update: You've Been Selected — ${jobRole} at SmartHire`;
    case 'candidate_rejected':  return `Update: Application Status — ${jobRole} at SmartHire`;
    case 'offer_released':      return `Offer Letter: ${jobRole} at SmartHire`;
    case 'offer_accepted':      return `Offer Accepted: ${jobRole} at SmartHire`;
    case 'offer_rejected':      return `Offer Status Update: ${jobRole} at SmartHire`;
    default:                    return `Interview Invitation: ${jobRole} at SmartHire`;
  }
}

/** Returns email body based on emailType */
function getEmailBody(input: SendInterviewEmailInput): string {
  const { candidateName, jobRole, interviewerName, interviewDate, interviewTime, interviewLink, emailType } = input;

  switch (emailType) {
    case 'interview_scheduled':
      return `Dear ${candidateName},

We are pleased to invite you for an interview for the ${jobRole} position.

Interviewer : ${interviewerName}
Date        : ${interviewDate}
Time        : ${interviewTime}
Meeting Link: ${interviewLink}

Please be prepared to discuss your experience and qualifications.

Best regards,
The SmartHire Team`;

    case 'candidate_selected':
      return `Dear ${candidateName},

We are happy to inform you that you have been selected in the ${jobRole} interview round conducted by ${interviewerName}.

You will be contacted shortly regarding the next steps.

Best regards,
The SmartHire Team`;

    case 'candidate_rejected':
      return `Dear ${candidateName},

Thank you for your time and effort in the interview process for the ${jobRole} position.

After careful consideration, we regret to inform you that we will not be moving forward with your application at this time.

We appreciate your interest in SmartHire and wish you the best in your career journey.

Best regards,
The SmartHire Team`;

    case 'offer_released':
      return `Dear ${candidateName},

Congratulations! We are pleased to extend an offer for the ${jobRole} position at SmartHire.

Please review the offer details and respond at your earliest convenience.

Best regards,
The SmartHire HR Team`;

    case 'offer_accepted':
      return `Dear ${candidateName},

We are delighted to confirm that you have accepted the offer for the ${jobRole} position.

Welcome to SmartHire! Our HR team will reach out to you with onboarding details.

Best regards,
The SmartHire HR Team`;

    case 'offer_rejected':
      return `Dear ${candidateName},

We have received your response regarding the offer for the ${jobRole} position.

We understand your decision and appreciate the time you spent with us throughout the process. We wish you the very best.

Best regards,
The SmartHire HR Team`;

    default:
      // Fallback: original generic body
      return `Dear ${candidateName},

Thank you for your interest in the ${jobRole} position.

We are pleased to invite you for an interview with ${interviewerName}.

Date: ${interviewDate}
Time: ${interviewTime}
Link: ${interviewLink}

Please be prepared to discuss your experience and qualifications.

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

    // ── Validate SMTP env vars ──
    const requiredEnvVars = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
    const missingVars = requiredEnvVars.filter((key) => !process.env[key]);

    if (missingVars.length > 0) {
      const errorMessage = `Missing required SMTP configuration: ${missingVars.join(', ')}`;
      console.error(`[SmartHire Email] ❌ ${errorMessage}`);
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

    // ── Build email parts ──
    const fromName  = getFromName(input.senderRole);
    const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
    const subject   = getSubject(input.emailType, input.jobRole);
    const body      = getEmailBody(input);

    console.log(`[SmartHire Email] 📧 Sending "${subject}" from "${fromName}" to ${input.candidateEmail}`);

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

      const info = await transporter.sendMail({
        from:    `"${fromName}" <${fromEmail}>`,  // ← Dynamic From name
        to:      input.candidateEmail,
        subject: subject,
        text:    body,
      });

      console.log(`[SmartHire Email] ✅ Sent! MessageId: ${info.messageId} → ${input.candidateEmail}`);

      const logRef = await addDoc(collection(db, 'notifications'), {
        type:           'Interview Email',
        emailType:      input.emailType || 'generic',
        senderRole:     input.senderRole || 'system',
        fromName:       fromName,
        candidateName:  input.candidateName,
        recipientEmail: input.candidateEmail,
        jobRole:        input.jobRole,
        status:         'Sent',
        sentAt:         serverTimestamp(),
        messageId:      info.messageId,
      });

      return { success: true, logId: logRef.id };

    } catch (error: any) {
      console.error('[SmartHire Email] ❌ Failed to send:', error);
      try {
        await addDoc(collection(db, 'notifications'), {
          type:           'Interview Email',
          emailType:      input.emailType || 'generic',
          candidateName:  input.candidateName,
          recipientEmail: input.candidateEmail,
          status:         'Failed',
          error:          error.message,
          sentAt:         serverTimestamp(),
        });
      } catch (logErr) {
        console.error('[SmartHire Email] Failed to log error to Firestore:', logErr);
      }
      return { success: false };
    }
  }
);