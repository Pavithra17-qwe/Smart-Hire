// app/api/interview/resend/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { sendInterviewEmail } from '@/ai/flows/send-interview-email-flow';

export async function POST(req: NextRequest) {
  try {
    const { token, candidateId, candidateEmail, candidateName, jobRole } = await req.json();

    if (!token || !candidateEmail) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // ── 1. Find the expired interview doc by old token ──────────────────────
    const snap = await adminDb
      .collection('ai_interviews')
      .where('token', '==', token)
      .limit(1)
      .get();

    if (snap.empty) {
      return NextResponse.json({ error: 'Interview not found' }, { status: 404 });
    }

    const oldDoc = snap.docs[0];
    const oldData = oldDoc.data();

    // ── 2. Create new token + new doc with status 'pending' ─────────────────
    const newToken = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = Timestamp.fromMillis(now + 48 * 60 * 60 * 1000);

    const newDocRef = await adminDb.collection('ai_interviews').add({
      candidateId:      oldData.candidateId      || candidateId || '',
      candidateName:    oldData.candidateName     || candidateName || '',
      candidateEmail:   oldData.candidateEmail    || candidateEmail,
      jobRole:          oldData.jobRole           || jobRole || '',
      resumeText:       oldData.resumeText        || '',
      jobDescription:   oldData.jobDescription    || '',
      experience:       oldData.experience        || '',
      location:         oldData.location          || '',
      scheduledByName:  oldData.scheduledByName   || 'HR',
      interviewMode:    oldData.interviewMode     || 'ai',
      projectQuestions: oldData.projectQuestions  || [],
      token:            newToken,
      status:           'pending',
      expiredReason:    null,
      expiredAt:        null,
      createdAt:        Timestamp.now(),
      expiresAt,
      resentFrom:       token,
    });

    console.log('[Resend] New doc created:', newDocRef.id, '| New token:', newToken);

    // ── 3. Update candidate doc with new token + reset status ───────────────
    const resolvedCandidateId = oldData.candidateId || candidateId;
    if (resolvedCandidateId) {
      await adminDb.doc(`candidates/${resolvedCandidateId}`).update({
        l1Status:            'Pending',
        l1AIStatus:          'link_sent',
        l1AIInterviewToken:  newToken,
        l1AIInterviewSentAt: Timestamp.now(),
        l1AIExpiredAt:       FieldValue.delete(),
        l1AIExpiredReason:   FieldValue.delete(),
      });
      console.log('[Resend] Candidate doc reset:', resolvedCandidateId);
    }

    // ── 4. Build the new interview link ─────────────────────────────────────
    const host = req.headers.get('host') || '';
    const proto = req.headers.get('x-forwarded-proto') || 'https';
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `${proto}://${host}`;
    const interviewUrl = `${baseUrl}/interview/${newToken}`;
    console.log('[Resend] Interview URL being sent:', interviewUrl);
    // ── 5. Send email to candidate (all required fields included) ────────────
    const emailResult = await sendInterviewEmail({
      candidateName:     oldData.candidateName   || candidateName || '',
      candidateEmail:    oldData.candidateEmail  || candidateEmail,
      jobRole:           oldData.jobRole         || jobRole || '',
      experience:        oldData.experience      || '',
      location:          oldData.location        || '',
      interviewerName:   oldData.scheduledByName || 'HR',
      interviewerEmail:  '',
      interviewDate:     '',
      interviewTime:     '',
      schedulingNotes:   `AI interview link: ${interviewUrl}`,
      interviewFeedback: '',
      emailType:         'interview_scheduled',
      stage:             'L1 Interview',
      candidateId:       resolvedCandidateId     || '',
      senderRole:        'hr',
      threadMessageId:   '',
      interviewLink:     interviewUrl,
    });

    console.log('[Resend] Email sent:', emailResult);

    return NextResponse.json({ success: true, newToken });

  } catch (err: any) {
    console.error('[Resend] Error:', err);
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}