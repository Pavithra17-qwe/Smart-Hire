'use server';
/**
 * @fileOverview A flow for sending interview emails to candidates.
 *
 * - sendInterviewEmail - A function that handles the interview email logic.
 * - SendInterviewEmailInput - The input type for the notification.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import {db} from '@/lib/firebase';
import {collection, addDoc, serverTimestamp} from 'firebase/firestore';
import nodemailer from 'nodemailer';

// Define the input schema for the interview email flow
const SendInterviewEmailInputSchema = z.object({
  candidateName: z.string().describe('Full name of the candidate.'),
  candidateEmail: z.string().email().describe('Email of the candidate.'),
  jobRole: z.string().describe('The job role the candidate is being interviewed for.'),
  interviewerName: z.string().describe('Name of the interviewer.'),
  interviewDate: z.string().describe('Date of the interview (e.g., Monday, July 29, 2024).'),
  interviewTime: z.string().describe('Time of the interview (e.g., 10:00 AM PST).'),
  interviewLink: z.string().url().describe('URL for the video call (e.g., Google Meet link).'),
});

export type SendInterviewEmailInput = z.infer<typeof SendInterviewEmailInputSchema>;

// Export a function to be called by the application
export async function sendInterviewEmail(input: SendInterviewEmailInput): Promise<{ success: boolean; logId?: string }> {
  return sendInterviewEmailFlow(input);
}

// Define the Genkit flow
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
    // Ensure all required SMTP environment variables are set
    const requiredEnvVars = [
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_USER',
      'SMTP_PASS',
      'SMTP_FROM',
    ];
    const missingVars = requiredEnvVars.filter((key) => !process.env[key]);

    if (missingVars.length > 0) {
      const errorMessage = `Missing required SMTP configuration: ${missingVars.join(', ')}`;
      console.error(`[Interview Email Error] ${errorMessage}`);
      try {
        await addDoc(collection(db, 'notifications'), {
          type: 'Interview Email',
          recipientEmail: input.candidateEmail,
          status: 'Failed',
          error: errorMessage,
          sentAt: serverTimestamp(),
        });
      } catch (logErr) {
        console.error('Failed to log configuration error to Firestore:', logErr);
      }
      return { success: false };
    }

    const emailBody = `Dear ${input.candidateName},\n\nThank you for your interest in the ${input.jobRole} position.\n\nWe are pleased to invite you for an interview with ${input.interviewerName}.\n\nDate: ${input.interviewDate}\nTime: ${input.interviewTime}\nLink: ${input.interviewLink}\n\nPlease be prepared to discuss your experience and qualifications.\n\nBest regards,\nThe SmartHire Team`;

    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      const info = await transporter.sendMail({
        from: `"SmartHire" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
        to: input.candidateEmail,
        subject: `Interview Invitation: ${input.jobRole} at SmartHire`,
        text: emailBody,
      });

      console.log(`[Interview Email Success] MessageId: ${info.messageId} - Recipient: ${input.candidateEmail}`);

      const logRef = await addDoc(collection(db, 'notifications'), {
        type: 'Interview Email',
        candidateName: input.candidateName,
        recipientEmail: input.candidateEmail,
        jobRole: input.jobRole,
        status: 'Sent',
        sentAt: serverTimestamp(),
        messageId: info.messageId,
      });

      return { success: true, logId: logRef.id };
    } catch (error: any) {
      console.error('[Interview Email Error] Failed to send email:', error);
      
      try {
        await addDoc(collection(db, 'notifications'), {
          type: 'Interview Email',
          candidateName: input.candidateName,
          recipientEmail: input.candidateEmail,
          status: 'Failed',
          error: error.message,
          sentAt: serverTimestamp()
        });
      } catch (logErr) {
        console.error('Failed to log email error to Firestore:', logErr);
      }

      return { success: false };
    }
  }
);
