'use server';


import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { adminDb } from '@/lib/firebaseAdmin';        // ✅ Admin SDK only
import { FieldValue } from 'firebase-admin/firestore'; // ✅ Admin SDK only
import nodemailer from 'nodemailer';


// ─────────────────────────────────────────────
// INPUT SCHEMA
// ─────────────────────────────────────────────
const SendInterviewEmailInputSchema = z.object({
  candidateName: z.string(),
  candidateEmail: z.string().email(),
  jobRole: z.string(),
  experience: z.string().optional().default(''),
  location: z.string().optional().default(''),
  interviewerName: z.string(),
  interviewerEmail: z.string().optional().default(''),
  interviewDate: z.string().optional().default(''),
  interviewTime: z.string().optional().default(''),
  schedulingNotes: z.string().optional().default(''),
  interviewFeedback: z.string().optional().default(''),
  stage: z.string().optional().default(''),


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
    'screening_reschedule_confirmed',
    'interview_rescheduled_invite',
  ]).optional(),


  candidateId: z.string().optional().default(''),
  threadMessageId: z.string().optional().default(''),
  interviewLink: z.string().optional().default(''),
  l1RescheduleUsed: z.boolean().optional().default(false),
  rescheduleToken: z.string().optional().default(''),
});


export type SendInterviewEmailInput = z.input<typeof SendInterviewEmailInputSchema>;


export async function sendInterviewEmail(
  input: SendInterviewEmailInput
): Promise<{ success: boolean; logId?: string; messageId?: string }> {
  return sendInterviewEmailFlow(
    input as z.infer<typeof SendInterviewEmailInputSchema>
  );
}


// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────


function buildFromField(senderRole?: string): string {
  const smtpUser = process.env.SMTP_FROM || process.env.SMTP_USER || '';
  let displayName = 'SmartHire';
  if (senderRole === 'panel') displayName = 'SmartHire (Panel)';
  if (senderRole === 'hr') displayName = 'SmartHire (HR)';
  return `"${displayName}" <${smtpUser}>`;
}


function getSubject(input: SendInterviewEmailInput): string {
  if (input.emailType === 'interview_rescheduled_invite') {
    return `Interview Rescheduled – Updated Interview Details for ${input.jobRole} Position`;
  }
  return `Candidate Update – ${input.candidateName} (${input.jobRole})`;
}


function getEmailBody(input: SendInterviewEmailInput): string {
  const {
    candidateName,
    jobRole,
    experience,
    location,
    interviewerName,
    interviewerEmail,
    interviewDate,
    interviewTime,
    schedulingNotes,
    interviewFeedback,
    emailType,
    senderRole,
    stage,
    interviewLink,
    l1RescheduleUsed,
    rescheduleToken,
  } = input;

  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').replace(/\/$/, '');


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


  const candidateBlock = `
Candidate   : ${candidateName}
Job Role    : ${jobRole}
Experience  : ${experience || 'N/A'}
Location    : ${location || 'N/A'}`;


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


    case 'interview_scheduled': {
      const isAIInterview =
        input.schedulingNotes?.includes('AI interview link:') ||
        input.schedulingNotes?.includes('Interview link:');


      if (isAIInterview) {
        // Extract just the URL from schedulingNotes
        // schedulingNotes format: "AI interview link: https://..."
        const urlMatch = input.schedulingNotes?.match(/https?:\/\/[^\s]+/);
        const interviewUrl = urlMatch ? urlMatch[0] : input.schedulingNotes || '';


        const isScreeningRound = stage === 'L1 Interview';
        const rescheduleBlock =
          isScreeningRound && !l1RescheduleUsed && rescheduleToken
            ? `

⚠ Important: You may reschedule your Screening Round interview only once
and only within 2 days of receiving this email. After rescheduling once,. After rescheduling once,
this option will be permanently disabled.

Reschedule your interview: ${baseUrl}/interview/reschedule/${rescheduleToken}
`
            : '';

        return `Hi ${candidateName},


    Congratulations! You have been shortlisted for the ${jobRole} position.
   
    Please complete your AI-powered video interview using the link below:
   
    ${interviewUrl}
${rescheduleBlock}

IMPORTANT INSTRUCTIONS:
  • This link is valid for 48 hours only
  • Enable your CAMERA and MICROPHONE before starting
  • Find a quiet, well-lit environment
  • Complete the interview in one sitting — do not switch tabs or close the browser
  • The interview includes a self-introduction and technical questions


Once submitted, our team will review your responses and get back to you.


Handled by :
  - Name  : ${interviewerName}
  - Role  : HR


Best regards,
The SmartHire Team`;
      }


      // Normal interview schedule (L2, HR round)
      return `Hi,


    This is to inform you that the ${stage} has been scheduled.
   
    Candidate   : ${candidateName}
    Job Role    : ${jobRole}
    Date        : ${interviewDate}
    Time Slot   : ${interviewTime}
    ${schedulingNotes
          ? `\nNotes :\n  ${schedulingNotes}\n`
          : ''}
Handled by :
  - Name  : ${interviewerName}
  - Role  : HR


Best regards,
The SmartHire Team`;
    }


    case 'interview_rescheduled_invite':
      return `Hi ${candidateName},

Your interview has been successfully rescheduled.

Your updated interview details are now available. Please complete your AI-powered video interview using the updated interview link below on your scheduled interview date and time.

Join Your Interview
${interviewLink}

Updated Interview Details
Position: ${jobRole}
Interview Date: ${interviewDate}

IMPORTANT INSTRUCTIONS
  • This interview link is valid only for your scheduled interview date and time.
  • Please join 5–10 minutes before your interview.
  • Enable your CAMERA and MICROPHONE before starting.
  • Ensure you have a stable internet connection.
  • Find a quiet, well-lit environment.
  • Complete the interview in one sitting—do not switch tabs or close the browser.
  • The interview includes a self-introduction and technical questions.

Important Notice
Your interview has already been successfully rescheduled.
This email contains your updated interview schedule.
No further rescheduling is permitted.

Once submitted, our team will review your responses and get back to you.

Handled by
Name: ${interviewerName}
Role: HR

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


    case 'panel_assigned': {
      const hrFeedbackSection = interviewFeedback
        ? `\nHR Notes :\n  ${interviewFeedback}\n`
        : '';
      return `Hi,


This is an update for the following candidate.


UPDATE : 👤 You have been assigned as the interviewer – ${stage}
${candidateBlock}
${interviewDate ? `Date        : ${interviewDate}\n` : ''}${interviewTime ? `Time Slot   : ${interviewTime}\n` : ''}${hrFeedbackSection}${schedNotesSection}${handledBy}


${stage === 'Resume Review'
          ? "Please review the candidate's resume and submit your feedback."
          : 'Please be available at the scheduled time.'}


Best regards,
The SmartHire Team`;
    }


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
function getEmailHtml(input: SendInterviewEmailInput): string | null {
  const {
    candidateName,
    jobRole,
    interviewerName,
    schedulingNotes,
    emailType,
    stage,
    l1RescheduleUsed,
    rescheduleToken,
  } = input;

  if (emailType !== 'interview_scheduled' && emailType !== 'interview_rescheduled_invite') return null;

  if (emailType === 'interview_rescheduled_invite') {
    const btnStyle = `display:inline-block;padding:12px 28px;border-radius:8px;font-weight:700;font-size:15px;text-decoration:none;`;
    return `
    <div style="font-family:Segoe UI, Arial, sans-serif; color:#111827; max-width:560px;">
      <p>Hi ${candidateName},</p>
      <p>Your interview has been successfully rescheduled.</p>
      <p>Your updated interview details are now available. Please complete your AI-powered video interview using the updated interview link below on your scheduled interview date and time.</p>

      <p style="margin:24px 0;">
        <a href="${input.interviewLink}" style="${btnStyle} background:#7C3AED; color:#ffffff;">Join Your Interview</a>
      </p>

      <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:14px 16px; margin:20px 0;">
        <p style="margin:0 0 6px; font-size:13px; font-weight:700; color:#111827;">Updated Interview Details</p>
        <p style="margin:0; font-size:13px; color:#374151;">Position: ${jobRole}</p>
        <p style="margin:0; font-size:13px; color:#374151;">Interview Date: ${input.interviewDate}</p>
      </div>

      <p style="font-size:13px; color:#374151;"><strong>IMPORTANT INSTRUCTIONS</strong></p>
      <ul style="font-size:13px; color:#374151; line-height:1.7;">
        <li>This interview link is valid only for your scheduled interview date and time.</li>
        <li>Please join 5–10 minutes before your interview.</li>
        <li>Enable your CAMERA and MICROPHONE before starting.</li>
        <li>Ensure you have a stable internet connection.</li>
        <li>Find a quiet, well-lit environment.</li>
        <li>Complete the interview in one sitting—do not switch tabs or close the browser.</li>
        <li>The interview includes a self-introduction and technical questions.</li>
      </ul>

      <div style="background:#FFFBEB; border:1px solid #FCD34D; border-radius:8px; padding:14px 16px; margin:20px 0;">
        <p style="margin:0; font-size:13px; color:#92400E;"><strong>Important Notice</strong></p>
        <p style="margin:6px 0 0; font-size:13px; color:#92400E;">Your interview has already been successfully rescheduled. This email contains your updated interview schedule. No further rescheduling is permitted.</p>
      </div>

      <p>Once submitted, our team will review your responses and get back to you.</p>

      <p style="font-size:13px; color:#6B7280;">
        Handled by:<br/>
        - Name: ${interviewerName}<br/>
        - Role: HR
      </p>

      <p>Best regards,<br/>The SmartHire Team</p>
    </div>`;
  }

  const isAIInterview =
    schedulingNotes?.includes('AI interview link:') ||
    schedulingNotes?.includes('Interview link:');

  if (!isAIInterview) return null;

  const urlMatch = schedulingNotes?.match(/https?:\/\/[^\s]+/);
  const interviewUrl = urlMatch ? urlMatch[0] : '';

  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').replace(/\/$/, '');
  const isScreeningRound = stage === 'L1 Interview';
  const showReschedule = isScreeningRound && !l1RescheduleUsed && rescheduleToken;

  const rescheduleUrl = `${baseUrl}/interview/reschedule/${rescheduleToken}`;

  const btnStyle = `display:inline-block;padding:12px 28px;border-radius:8px;font-weight:700;font-size:15px;text-decoration:none;`;

  return `
  <div style="font-family:Segoe UI, Arial, sans-serif; color:#111827; max-width:560px;">
    <p>Hi ${candidateName},</p>
    <p>Congratulations! You have been shortlisted for the <strong>${jobRole}</strong> position.</p>
    <p>Please complete your AI-powered video interview using the button below:</p>

    <p style="margin:24px 0;">
      <a href="${interviewUrl}" style="${btnStyle} background:#7C3AED; color:#ffffff;">Join Interview</a>
    </p>

    ${showReschedule ? `
    <div style="background:#FFFBEB; border:1px solid #FCD34D; border-radius:8px; padding:14px 16px; margin:20px 0;">
      <p style="margin:0 0 10px; font-size:13px; color:#92400E;">
        ⚠ <strong>Important:</strong> You may reschedule your Screening Round interview only once
        and only within 2 days of receiving this email. After rescheduling once,
        this option will be permanently disabled.
      </p>
      <a href="${rescheduleUrl}" style="${btnStyle} background:#ffffff; color:#92400E; border:1.5px solid #F59E0B;">Reschedule Interview</a>
    </div>
    ` : ''}

    <p style="font-size:13px; color:#374151;"><strong>IMPORTANT INSTRUCTIONS:</strong></p>
    <ul style="font-size:13px; color:#374151; line-height:1.7;">
      <li>This link is valid for 48 hours only</li>
      <li>Enable your CAMERA and MICROPHONE before starting</li>
      <li>Find a quiet, well-lit environment</li>
      <li>Complete the interview in one sitting — do not switch tabs or close the browser</li>
      <li>The interview includes a self-introduction and technical questions</li>
    </ul>

    <p>Once submitted, our team will review your responses and get back to you.</p>

    <p style="font-size:13px; color:#6B7280;">
      Handled by:<br/>
      - Name: ${interviewerName}<br/>
      - Role: HR
    </p>

    <p>Best regards,<br/>The SmartHire Team</p>
  </div>`;
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
        // ✅ Admin SDK
        await adminDb.collection('notifications').add({
          type: 'Interview Email',
          recipientEmail: input.candidateEmail,
          status: 'Failed',
          error: errorMessage,
          sentAt: FieldValue.serverTimestamp(),
        });
      } catch (_) { }
      return { success: false };
    }


    const fromField = buildFromField(input.senderRole);
    const subject = getSubject(input);
    const body = getEmailBody(input);
    const htmlBody = getEmailHtml(input);


    console.log(`[SmartHire Email] Sending "${subject}"`);
    console.log(`[SmartHire Email] From          : ${fromField}`);
    console.log(`[SmartHire Email] To             : ${input.candidateEmail}`);
    console.log(`[SmartHire Email] threadMessageId: ${input.threadMessageId || '(first email – no thread yet)'}`);


    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });


      const mailOptions: nodemailer.SendMailOptions = {
        from: fromField,
        to: input.candidateEmail,
        subject: subject,
        text: body,
        ...(htmlBody ? { html: htmlBody } : {}),
      };

      if (input.interviewerEmail) {
        mailOptions.replyTo = `"${input.interviewerName}" <${input.interviewerEmail}>`;
      }


      if (input.threadMessageId) {
        mailOptions.inReplyTo = input.threadMessageId;
        mailOptions.references = input.threadMessageId;
        console.log(`[SmartHire Email] Threading as reply to: ${input.threadMessageId}`);
      }


      const info = await transporter.sendMail(mailOptions);
      const sentMessageId = info.messageId;
      console.log(`[SmartHire Email] SUCCESS - MessageId: ${sentMessageId}`);


      // ✅ Admin SDK — save thread message ID
      if (!input.threadMessageId && input.candidateId) {
        try {
          await adminDb.doc(`candidates/${input.candidateId}`).update({
            emailThreadMessageId: sentMessageId,
          });
          console.log(`[SmartHire Email] Saved emailThreadMessageId to candidate ${input.candidateId}`);
        } catch (saveErr) {
          console.error('[SmartHire Email] Could not save emailThreadMessageId:', saveErr);
        }
      }


      // ✅ Admin SDK — log the notification
      const logRef = await adminDb.collection('notifications').add({
        type: 'Interview Email',
        emailType: input.emailType || 'generic',
        stage: input.stage || '',
        senderRole: input.senderRole || 'system',
        interviewerName: input.interviewerName,
        interviewerEmail: input.interviewerEmail,
        fromField,
        candidateName: input.candidateName,
        candidateId: input.candidateId || '',
        recipientEmail: input.candidateEmail,
        jobRole: input.jobRole,
        schedulingNotes: input.schedulingNotes || '',
        interviewFeedback: input.interviewFeedback || '',
        threadMessageId: input.threadMessageId || '',
        sentMessageId: sentMessageId,
        status: 'Sent',
        sentAt: FieldValue.serverTimestamp(),
        messageId: sentMessageId,
      });


      return { success: true, logId: logRef.id, messageId: sentMessageId };


    } catch (error: any) {
      console.error('[SmartHire Email] FAILED:', error);
      try {
        // ✅ Admin SDK — log failure
        await adminDb.collection('notifications').add({
          type: 'Interview Email',
          emailType: input.emailType || 'generic',
          candidateName: input.candidateName,
          recipientEmail: input.candidateEmail,
          status: 'Failed',
          error: error.message,
          sentAt: FieldValue.serverTimestamp(),
        });
      } catch (_) { }
      return { success: false };
    }
  }
);