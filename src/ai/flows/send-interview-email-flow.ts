'use server';
/**
 * @fileOverview A flow for sending real interview schedule notifications using Nodemailer.
 *
 * - sendInterviewEmail - A function that handles the email notification logic.
 * - SendInterviewEmailInput - The input type for the notification.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import { db } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import nodemailer from 'nodemailer';

const SendInterviewEmailInputSchema = z.object({
  candidateName: z.string().describe('Full name of the candidate.'),
  role: z.string().describe('The job role the candidate is applying for.'),
  agencyName: z.string().describe('The name of the recruitment agency.'),
  agentName: z.string().describe('Name of the assigned agent/contact person.'),
  agentEmail: z.string().email().describe('Email of the assigned agent.'),
  scheduledDate: z.string().describe('The date selected for the interview.'),
  scheduledTime: z.string().describe('The time selected for the interview.'),
  round: z.string().describe('The interview round (e.g., L1, L2, HR Round).'),
  adminName: z.string().describe('Name of the assigned admin.'),
});
export type SendInterviewEmailInput = z.infer<typeof SendInterviewEmailInputSchema>;

export async function sendInterviewEmail(input: SendInterviewEmailInput): Promise<{ success: boolean; logId?: string }> {
  return sendInterviewEmailFlow(input);
}

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
    const subject = `Schedule ${input.round} Interview – ${input.candidateName} (${input.role})`;
    
    const emailBody = `Hi ${input.agencyName},

Please schedule the ${input.round} interview for the candidate below.

Candidate Name: ${input.candidateName}
Role: ${input.role}
Interview Date: ${input.scheduledDate}
Interview Time: ${input.scheduledTime}

Kindly confirm once the interview has been scheduled.

Best regards,
${input.adminName}`;

    try {
      // Configuration for real email sending via SMTP
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      // Send the actual email
      const info = await transporter.sendMail({
        from: `"${input.adminName} via SmartHire" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
        to: input.agentEmail,
        subject: subject,
        text: emailBody,
      });

      console.log(`[Email Success] MessageId: ${info.messageId} - Recipient: ${input.agentEmail}`);

      // Log the activity to Firestore
      const logRef = await addDoc(collection(db, 'notifications'), {
        type: 'Interview Schedule',
        candidateName: input.candidateName,
        recipientEmail: input.agentEmail,
        recipientName: input.agentName,
        round: input.round,
        adminName: input.adminName,
        subject: subject,
        body: emailBody,
        sentAt: serverTimestamp(),
        status: 'Sent',
        messageId: info.messageId,
        providerResponse: info.response
      });

      return { success: true, logId: logRef.id };
    } catch (error: any) {
      console.error('[Email Error] Failed to send real email:', error);
      
      // Log the failure to Firestore for auditing
      try {
        await addDoc(collection(db, 'notifications'), {
          type: 'Interview Schedule',
          candidateName: input.candidateName,
          recipientEmail: input.agentEmail,
          recipientName: input.agentName,
          round: input.round,
          adminName: input.adminName,
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
