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


  candidateId:      z.string().optional().default(''),
  threadMessageId:  z.string().optional().default(''),
interviewLink: z.string().optional().default(''),
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


function getSubject(candidateName: string, jobRole: string): string {
  return `Candidate Update – ${candidateName} (${jobRole})`;
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


case 'interview_scheduled': {
  const isAIInterview =
  input.schedulingNotes?.includes('AI interview link:') ||
  input.schedulingNotes?.includes('Interview link:');


  if (isAIInterview) {
    // Extract just the URL from schedulingNotes
    // schedulingNotes format: "AI interview link: https://..."
    const urlMatch = input.schedulingNotes?.match(/https?:\/\/[^\s]+/);
    const interviewUrl = urlMatch ? urlMatch[0] : input.schedulingNotes || '';


    return `Hi ${candidateName},


    Congratulations! You have been shortlisted for the ${jobRole} position.
   
    Please complete your AI-powered video interview using the link below:
   
    ${interviewUrl}


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
        // ✅ Admin SDK
        await adminDb.collection('notifications').add({
          type:           'Interview Email',
          recipientEmail: input.candidateEmail,
          status:         'Failed',
          error:          errorMessage,
          sentAt:         FieldValue.serverTimestamp(),
        });
      } catch (_) {}
      return { success: false };
    }


    const fromField = buildFromField(input.senderRole);
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


      if (input.threadMessageId) {
        mailOptions.inReplyTo  = input.threadMessageId;
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
        sentAt:            FieldValue.serverTimestamp(),
        messageId:         sentMessageId,
      });


      return { success: true, logId: logRef.id, messageId: sentMessageId };


    } catch (error: any) {
      console.error('[SmartHire Email] FAILED:', error);
      try {
        // ✅ Admin SDK — log failure
        await adminDb.collection('notifications').add({
          type:           'Interview Email',
          emailType:      input.emailType || 'generic',
          candidateName:  input.candidateName,
          recipientEmail: input.candidateEmail,
          status:         'Failed',
          error:          error.message,
          sentAt:         FieldValue.serverTimestamp(),
        });
      } catch (_) {}
      return { success: false };
    }
  }
);

