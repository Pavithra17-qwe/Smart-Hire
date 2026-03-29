'use server';
/**
 * @fileOverview A flow for sending welcome emails to newly created agencies.
 *
 * - sendWelcomeEmail - A function that handles the welcome email logic.
 * - SendWelcomeEmailInput - The input type for the notification.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import { db } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import nodemailer from 'nodemailer';

const SendWelcomeEmailInputSchema = z.object({
  agencyName: z.string().describe('Name of the agency.'),
  agencyEmail: z.string().email().describe('Email of the agency.'),
  tempPassword: z.string().describe('The generated temporary password.'),
});
export type SendWelcomeEmailInput = z.infer<typeof SendWelcomeEmailInputSchema>;

export async function sendWelcomeEmail(input: SendWelcomeEmailInput): Promise<{ success: boolean; logId?: string }> {
  return sendWelcomeEmailFlow(input);
}

const sendWelcomeEmailFlow = ai.defineFlow(
  {
    name: 'sendWelcomeEmailFlow',
    inputSchema: SendWelcomeEmailInputSchema,
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
      const errorMessage = `Missing required environment variables for sending email: ${missingVars.join(', ')}`;
      console.error(`[Welcome Email Error] ${errorMessage}`);
      
      // Log the configuration error to Firestore
      try {
        await addDoc(collection(db, 'notifications'), {
          type: 'Welcome Email',
          agencyName: input.agencyName,
          recipientEmail: input.agencyEmail,
          status: 'Failed',
          error: errorMessage,
          sentAt: serverTimestamp(),
        });
      } catch (logErr) {
        console.error('Failed to log configuration error to Firestore:', logErr);
      }
      
      // Return failure without trying to send an email
      return { success: false };
    }

    const emailBody = `Welcome to SmartHire!\n\nYour agency account has been created successfully.\n\nLogin Details:\nEmail: ${input.agencyEmail}\nTemporary Password: ${input.tempPassword}\n\nLogin to SmartHire:\nhttps://smart-hire-swart.vercel.app/\n\nPlease log in using the above credentials and change your password after your first login.\n\nBest regards,\nThe SmartHire Team`;

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
        to: input.agencyEmail,
        subject: `Welcome to SmartHire – Account Created`,
        text: emailBody,
      });

      console.log(`[Welcome Email Success] MessageId: ${info.messageId} - Recipient: ${input.agencyEmail}`);

      const logRef = await addDoc(collection(db, 'notifications'), {
        type: 'Welcome Email',
        agencyName: input.agencyName,
        recipientEmail: input.agencyEmail,
        status: 'Sent',
        sentAt: serverTimestamp(),
        messageId: info.messageId,
      });

      return { success: true, logId: logRef.id };
    } catch (error: any) {
      console.error('[Welcome Email Error] Failed to send email:', error);
      
      try {
        await addDoc(collection(db, 'notifications'), {
          type: 'Welcome Email',
          agencyName: input.agencyName,
          recipientEmail: input.agencyEmail,
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
