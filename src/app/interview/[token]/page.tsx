
// app/interview/[token]/page.tsx
export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { adminDb } from '@/lib/firebaseAdmin';
import InterviewClient from './InterviewClient';

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function InterviewPage({ params }: PageProps) {
  const { token } = await params;

  let expiredReason: string | null = null;
  let candidateData: any = null;

  try {
    const snapshot = await adminDb
      .collection('ai_interviews')
      .where('token', '==', token)
      .limit(1)
      .get();

    console.log('[InterviewPage] token:', token);
    console.log('[InterviewPage] snapshot empty:', snapshot.empty);

    if (snapshot.empty) {
      expiredReason = 'invalid';
    } else {
      const docSnap = snapshot.docs[0];
      const data = docSnap.data();
    
      console.log('[InterviewPage] status:', data.status);
      console.log('[InterviewPage] expiresAt:', data.expiresAt);
      console.log('[InterviewPage] expiresAtMs:', data.expiresAt?.toMillis?.() ?? 0);
      console.log('[InterviewPage] Date.now():', Date.now());
    
      const expiresAtMs = data.expiresAt?.toMillis?.() ?? 0;
    
      if (expiresAtMs > 0 && Date.now() > expiresAtMs) {
        expiredReason = 'time_expired';
        await docSnap.ref.update({ status: 'expired', expiredReason: 'time_expired' });
    
      } else if (data.status === 'completed') {
        expiredReason = 'completed';
    
      } else if (data.status === 'expired') {
        expiredReason = data.expiredReason || 'session_ended';
    
      } else if (data.status === 'pending') {
        // Heartbeat check — runs but does NOT block candidateData from being built
        try {
          const lastHeartbeat = data.lastHeartbeat?.toMillis?.() ?? 0;
          if (lastHeartbeat > 0 && (Date.now() - lastHeartbeat) > 45_000) {
            expiredReason = 'closed';
            await docSnap.ref.update({ status: 'expired', expiredReason: 'closed', expiredAt: new Date() });
            if (data.candidateId) {
              await adminDb.doc(`candidates/${data.candidateId}`).update({
                l1Status: 'Expired', l1AIStatus: 'expired',
                l1AIExpiredAt: new Date(), l1AIExpiredReason: 'closed',
              });
            }
          }
        } catch (err) {
          console.error('[InterviewPage] Heartbeat check error (non-fatal):', err);
        }
      }
    
      // ── Build candidateData if not expired — runs for ANY valid status ──
      if (!expiredReason) {
        console.log('[InterviewPage] ✅ Building candidateData');
        let linkSentAtMs = data.createdAt?.toMillis?.() ?? 0;
    
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
            console.warn('[InterviewPage] Could not read l1AIInterviewSentAt:', err);
          }
        }
    
        candidateData = {
          token,
          docId:            docSnap.id,
          candidateId:      data.candidateId      || '',
          candidateName:    data.candidateName     || '',
          candidateEmail:   data.candidateEmail    || '',
          jobRole:          data.jobRole           || '',
          resumeText:       data.resumeText        || '',
          jobDescription:   data.jobDescription    || '',
          experience:       String(data.experience || ''),
          location:         String(data.location   || ''),
          interviewerName:  data.scheduledByName   || 'HR',
          stage:            'L1 Interview',
          linkSentAt:       linkSentAtMs,
          interviewMode:    data.interviewMode     ?? 'ai',
          projectQuestions: data.projectQuestions  ?? [],
        };
        console.log('[InterviewPage] ✅ candidateData built successfully');
      }
    }
  } catch (err) {
    console.error('[InterviewPage] Error loading token:', err);
    expiredReason = 'error';
  }

  if (expiredReason || !candidateData) {
    return <ExpiredPage reason={expiredReason ?? 'error'} />;
  }

  return <InterviewClient candidate={candidateData} />;
}

function ExpiredPage({ reason }: { reason: string }) {
  const config: Record<string, {
    icon: string; title: string; body: string;
    accent: string; iconBg: string; iconBorder: string;
  }> = {
    // Candidate clicked "End Session"
    candidate_ended: {
      icon: '🚪',
      title: 'Interview Session Ended',
      body: 'You ended this interview session early. This link can no longer be used.',
      accent: 'linear-gradient(90deg, #F59E0B, #EF4444)',
      iconBg: 'linear-gradient(135deg, #FEF3C7, #FEE2E2)',
      iconBorder: '#FCD34D',
    },
    // Tab switch
    tab_switch: {
      icon: '🔒',
      title: 'Session Terminated',
      body: 'Your session ended because you switched browser tabs. For security, this link can no longer be used.',
      accent: 'linear-gradient(90deg, #EF4444, #DC2626)',
      iconBg: 'linear-gradient(135deg, #FEE2E2, #FECACA)',
      iconBorder: '#FCA5A5',
    },
    // App switch
    app_switch: {
      icon: '🔒',
      title: 'Session Terminated',
      body: 'Your session ended because you switched to another application. For security, this link can no longer be used.',
      accent: 'linear-gradient(90deg, #EF4444, #DC2626)',
      iconBg: 'linear-gradient(135deg, #FEE2E2, #FECACA)',
      iconBorder: '#FCA5A5',
    },
    // Browser closed
    closed: {
      icon: '🔒',
      title: 'Session Terminated',
      body: 'Your session ended because the browser was closed. For security, this link can no longer be used.',
      accent: 'linear-gradient(90deg, #EF4444, #DC2626)',
      iconBg: 'linear-gradient(135deg, #FEE2E2, #FECACA)',
      iconBorder: '#FCA5A5',
    },
    // Generic session ended fallback
    session_ended: {
      icon: '🔒',
      title: 'Session Ended',
      body: 'Your interview session has ended. For security, this link can no longer be used. Please contact HR.',
      accent: 'linear-gradient(90deg, #EF4444, #DC2626)',
      iconBg: 'linear-gradient(135deg, #FEE2E2, #FECACA)',
      iconBorder: '#FCA5A5',
    },
    // 48-hour time limit
    time_expired: {
      icon: '⏰',
      title: 'Interview Link Expired',
      body: 'This interview link was valid for 48 hours and has now expired. Please contact HR to request a new link.',
      accent: 'linear-gradient(90deg, #EF4444, #F97316)',
      iconBg: 'linear-gradient(135deg, #FEE2E2, #FECACA)',
      iconBorder: '#FCA5A5',
    },
    // Already done
    completed: {
      icon: '✅',
      title: 'Interview Already Submitted',
      body: 'You have already completed this interview. Our team will review your responses and get back to you.',
      accent: 'linear-gradient(90deg, #059669, #10B981)',
      iconBg: 'linear-gradient(135deg, #D1FAE5, #A7F3D0)',
      iconBorder: '#6EE7B7',
    },
    // Bad link
    invalid: {
      icon: '🔗',
      title: 'Invalid Interview Link',
      body: 'This interview link does not exist. Please check your email for the correct link or contact HR.',
      accent: 'linear-gradient(90deg, #6366F1, #8B5CF6)',
      iconBg: 'linear-gradient(135deg, #EDE9FE, #DDD6FE)',
      iconBorder: '#C4B5FD',
    },
    // Server error
    error: {
      icon: '⚠️',
      title: 'Something Went Wrong',
      body: 'We could not load your interview. Please try refreshing, or contact HR if the problem persists.',
      accent: 'linear-gradient(90deg, #F59E0B, #EF4444)',
      iconBg: 'linear-gradient(135deg, #FEF3C7, #FEE2E2)',
      iconBorder: '#FCD34D',
    },
  };

  const msg = config[reason] ?? config['session_ended'];

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#F8FAFC',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      padding: '2rem',
      textAlign: 'center',
    }}>
      <div style={{
        background: 'white',
        border: '1px solid #E2E8F0',
        borderRadius: '24px',
        padding: '52px 56px',
        maxWidth: '500px',
        width: '100%',
        boxShadow: '0 4px 24px rgba(0,0,0,0.07)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Accent bar */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '4px',
          background: msg.accent,
          borderRadius: '24px 24px 0 0',
        }} />

        {/* Icon */}
        <div style={{
          width: '80px', height: '80px', borderRadius: '50%',
          background: msg.iconBg,
          border: `3px solid ${msg.iconBorder}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '36px', margin: '0 auto 24px',
          boxShadow: '0 0 0 12px rgba(239,68,68,0.06)',
        }}>
          {msg.icon}
        </div>

        {/* Title */}
        <h1 style={{
          fontSize: '24px', fontWeight: 800, color: '#0F172A',
          marginBottom: '12px', letterSpacing: '-0.02em',
        }}>
          {msg.title}
        </h1>

        {/* Body */}
        <p style={{
          fontSize: '14px', color: '#64748B',
          lineHeight: 1.8, marginBottom: '32px',
        }}>
          {msg.body}
        </p>

        {/* Footer note */}
        <div style={{
          background: '#F8FAFC', border: '1px solid #E2E8F0',
          borderRadius: '12px', padding: '14px 18px',
          fontSize: '12px', color: '#94A3B8', lineHeight: 1.7,
        }}>
          SmartHire AI Interview System
        </div>
      </div>
    </div>
  );
}