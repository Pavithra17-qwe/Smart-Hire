'use server';
/**
 * @fileOverview A flow for sending welcome emails to newly created users (HR, Panel).
 *
 * - sendNewUserWelcomeEmail - A function that handles the welcome email logic.
 * - SendNewUserWelcomeEmailInput - The input type for the notification.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import { db } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import nodemailer from 'nodemailer';

const SendNewUserWelcomeEmailInputSchema = z.object({
  name: z.string().describe('Full name of the user.'),
  email: z.string().email().describe('Email of the user.'),
  role: z.string().describe('Assigned role of the user (e.g., HR, Panel).'),
  tempPassword: z.string().describe('The generated temporary password.'),
});
export type SendNewUserWelcomeEmailInput = z.infer<typeof SendNewUserWelcomeEmailInputSchema>;

export async function sendNewUserWelcomeEmail(input: SendNewUserWelcomeEmailInput): Promise<{ success: boolean; logId?: string }> {
  return sendNewUserWelcomeEmailFlow(input);
}

const sendNewUserWelcomeEmailFlow = ai.defineFlow(
  {
    name: 'sendNewUserWelcomeEmailFlow',
    inputSchema: SendNewUserWelcomeEmailInputSchema,
    outputSchema: z.object({
      success: z.boolean(),
      logId: z.string().optional(),
    }),
  },
  async (input) => {
    const emailBody = `Welcome to SmartHire!

Your user account has been created successfully.

Role: ${input.role}

Login Details:
Email: ${input.email}
Temporary Password: ${input.tempPassword}

Login to SmartHire:
https://smart-hire-swart.vercel.app/

Please log in using the above credentials and change your password after your first login.

Best regards,
The SmartHire Team`;

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
        to: input.email,
        subject: `Welcome to SmartHire – Your Account is Ready`,
        text: emailBody,
      });

      console.log(`[New User Email Success] MessageId: ${info.messageId} - Recipient: ${input.email}`);

      const logRef = await addDoc(collection(db, 'notifications'), {
        type: 'New User Welcome',
        userName: input.name,
        recipientEmail: input.email,
        status: 'Sent',
        sentAt: serverTimestamp(),
        messageId: info.messageId,
      });

      return { success: true, logId: logRef.id };
    } catch (error: any) {
      console.error('[New User Email Error] Failed to send email:', error);
      
      try {
        await addDoc(collection(db, 'notifications'), {
          type: 'New User Welcome',
          userName: input.name,
          recipientEmail: input.email,
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
