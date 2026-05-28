// app/interview/[token]/page.tsx
import { adminDb } from '@/lib/firebaseAdmin';
import InterviewClient from './InterviewClient';

interface PageProps {
  params: { token: string };
}

export default async function InterviewPage({ params }: PageProps) {
  const { token } = params;

  let expiredReason: string | null = null;
  let candidateData: any = null;

  try {
    // ── STEP 1: Find the ai_interviews doc by token field ──
    // Your handleAction saves to 'ai_interviews' collection with a 'token' field
    // NOT as the document ID — so we must query by field
    const snapshot = await adminDb
      .collection('ai_interviews')
      .where('token', '==', token)
      .limit(1)
      .get();

    if (snapshot.empty) {
      expiredReason = 'invalid';
    } else {
      const docSnap = snapshot.docs[0];
      const data = docSnap.data();

      // ── STEP 2: Check 48-hour expiry ──
const expiresAtMs = data.expiresAt?.toMillis?.() ?? 0;
if (Date.now() > expiresAtMs) {
  expiredReason = 'expired';
  await docSnap.ref.update({ status: 'expired' });
}

// ── STEP 3: Check if already completed ──
else if (data.status === 'completed') {
  expiredReason = 'completed';
}

// ── STEP 4: Check if session was terminated server-side ──
else if (data.status === 'expired') {
  expiredReason = 'session_ended';
}

      // ── STEP 5: All good — pass data to client ──
     else {
      // Read l1AIInterviewSentAt from the candidate doc (accurate send time)
      let linkSentAtMs = data.createdAt?.toMillis?.() ?? 0; // fallback

      if (data.candidateId) {
        try {
          const candSnap = await adminDb
            .collection('candidates')
            .doc(data.candidateId)
            .get();
          if (candSnap.exists) {
            const sentAt = candSnap.data()?.l1AIInterviewSentAt;
            if (sentAt?.toMillis) {
              linkSentAtMs = sentAt.toMillis();
            }
          }
        } catch (err) {
          console.warn('[InterviewPage] Could not read l1AIInterviewSentAt, falling back to createdAt:', err);
        }
      }

      candidateData = {
        token,
        docId: docSnap.id,
        candidateId: data.candidateId || '',
        candidateName: data.candidateName || '',
        candidateEmail: data.candidateEmail || '',
        jobRole: data.jobRole || '',
        resumeText: data.resumeText || '',
        jobDescription: data.jobDescription || '',
        experience: data.experience || '',
        location: data.location || '',
        interviewerName: data.scheduledByName || 'HR',
        stage: 'L1 Interview',
        linkSentAt: linkSentAtMs,
      };
    }
    }
  } catch (err) {
    console.error('[InterviewPage] Error loading token:', err);
    expiredReason = 'error';
  }

  if (expiredReason) {
    return <ExpiredPage reason={expiredReason} />;
  }

  return <InterviewClient candidate={candidateData} />;
}

function ExpiredPage({ reason }: { reason: string }) {
  const messages: Record<string, { icon: string; title: string; body: string }> = {
    expired:      {
      icon: '⏰',
      title: 'Link Expired',
      body: 'This interview link has expired (48-hour limit reached). Please contact HR for assistance.',
    },
    completed:    {
      icon: '✅',
      title: 'Interview Already Completed',
      body: 'You have already submitted this interview. Our team will review your responses and get back to you.',
    },
    session_ended: {
      icon: '🔒',
      title: 'Session Ended',
      body: 'Your interview session ended because the browser tab was closed or switched. For security, this link can no longer be used. Please contact HR.',
    },
    invalid:      {
      icon: '❌',
      title: 'Invalid Link',
      body: 'This interview link is not valid. Please check your email for the correct link or contact HR.',
    },
    error:        {
      icon: '⚠️',
      title: 'Something Went Wrong',
      body: 'We could not load your interview. Please try again or contact HR.',
    },
  };

  const msg = messages[reason] || messages['error'];

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#F5F6FA',
      fontFamily: 'Segoe UI, sans-serif',
      padding: '2rem',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: '3.5rem', marginBottom: '1.5rem' }}>{msg.icon}</div>
      <h1 style={{
        color: '#111827',
        fontSize: '1.75rem',
        fontWeight: 700,
        marginBottom: '1rem',
      }}>
        {msg.title}
      </h1>
      <p style={{
        color: '#6B7280',
        fontSize: '1rem',
        maxWidth: '440px',
        lineHeight: 1.8,
      }}>
        {msg.body}
      </p>
      <p style={{
        color: '#4B5563',
        fontSize: '0.8rem',
        marginTop: '2rem',
      }}>
        SmartHire AI Interview System
      </p>
    </div>
  );
}