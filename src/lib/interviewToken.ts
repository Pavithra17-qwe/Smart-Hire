// lib/interviewToken.ts
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import crypto from 'crypto';

export interface InterviewTokenPayload {
  candidateId: string;
  candidateEmail: string;
  candidateName: string;
  jobRole: string;
  experience?: string;
  location?: string;
  interviewerName: string;
  stage: string;
  expiresAt: number; // Unix ms
}

/** Generate a secure token and store it in Firestore */
export async function createInterviewToken(
  payload: Omit<InterviewTokenPayload, 'expiresAt'>
): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 48 * 60 * 60 * 1000; // 48 hours

  await adminDb.collection('interviewTokens').doc(token).set({
    ...payload,
    expiresAt,
    used: false,
    sessionStarted: false,
    completed: false,
    createdAt: FieldValue.serverTimestamp(),
  });

  return token;
}

/** Returns the base URL for the interview link */
export function getInterviewLink(token: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    'http://localhost:3000';
  return `${base}/interview/${token}`;
}