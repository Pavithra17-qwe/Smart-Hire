'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  doc, onSnapshot, updateDoc, addDoc, getDoc,
  collection, Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Calendar, Lock, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Candidate } from '@/types/candidate';
import { normalizeStatus } from '@/lib/normalizeStatus';
import { sendInterviewEmail } from '@/ai/flows/send-interview-email-flow';

// ─── TYPES ────────────────────────────────────────────────────────────────────
type Status =
  | 'Pending' | 'Accepted' | 'Rejected' | 'Scheduled'
  | 'Selected' | 'Offer Sent' | 'Joined' | 'In Progress'
  | 'Locked' | 'Released';

interface StageCardProps {
  title: string;
  status: Status;
  isLocked: boolean;
  scheduledDate?: string;
  timeSlot?: string;
  schedulingNotes?: string;
  savedFeedback?: string;
  onAction: (action: string, payload: any) => void;
  isResume?: boolean;
  isOffer?: boolean;
  canUpdate: boolean;
  role: string | null;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
async function getUploaderInfo(createdBy: string) {
  try {
    const snap = await getDoc(doc(db, 'users', createdBy));
    if (snap.exists()) {
      const d = snap.data();
      return { email: d.email || null, name: d.displayName || d.name || null };
    }
  } catch {}
  return { email: null, name: null };
}

async function getLoggedInUserName(uid: string): Promise<string | null> {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) {
      const d = snap.data();
      return d.displayName || d.name || d.fullName || null;
    }
  } catch {}
  return null;
}

async function sendEmail(params: any) {
  if (!params.toEmail?.includes('@')) return;
  try {
    await sendInterviewEmail({
      candidateName:    params.candidateName,
      candidateEmail:   params.toEmail,
      jobRole:          params.jobRole,
      experience:       params.experience || '',
      location:         params.location   || '',
      interviewerName:  params.interviewerName,
      interviewerEmail: params.interviewerEmail || '',
      interviewDate:    params.interviewDate    || '',
      interviewTime:    params.interviewTime    || '',
      schedulingNotes:  params.schedulingNotes  || '',
      interviewFeedback: params.interviewFeedback || '',
      stage:            params.stage,
      senderRole:       params.senderRole,
      emailType:        params.emailType,
    });
  } catch (err) {
    console.error('Email send failed:', err);
  }
}

// ─── AI SCORE DISPLAY HELPER ─────────────────────────────────────────────────
// Returns the color theme and a label for any score value including 0
function getScoreDisplay(score: number | undefined | null): {
  color: string;
  bg: string;
  border: string;
  label: string;
  icon: React.ReactNode;
  textColor: string;
} {
  const s = typeof score === 'number' ? score : -1;

  if (s < 0) return {
    color: '#6B7280', bg: '#F3F4F6', border: '#E5E7EB',
    label: 'Not Evaluated', icon: <Minus className="h-4 w-4" />, textColor: '#374151',
  };
  if (s === 0) return {
    color: '#DC2626', bg: '#FEF2F2', border: '#FECACA',
    label: 'No Match', icon: <TrendingDown className="h-4 w-4" />, textColor: '#991B1B',
  };
  if (s <= 30) return {
    color: '#DC2626', bg: '#FEF2F2', border: '#FECACA',
    label: 'Very Low Match', icon: <TrendingDown className="h-4 w-4" />, textColor: '#991B1B',
  };
  if (s <= 50) return {
    color: '#D97706', bg: '#FFFBEB', border: '#FDE68A',
    label: 'Below Average', icon: <TrendingDown className="h-4 w-4" />, textColor: '#92400E',
  };
  if (s <= 65) return {
    color: '#F59E0B', bg: '#FEF3C7', border: '#FCD34D',
    label: 'Moderate Match', icon: <Minus className="h-4 w-4" />, textColor: '#78350F',
  };
  if (s <= 80) return {
    color: '#16A34A', bg: '#F0FDF4', border: '#86EFAC',
    label: 'Good Match', icon: <TrendingUp className="h-4 w-4" />, textColor: '#14532D',
  };
  return {
    color: '#059669', bg: '#ECFDF5', border: '#6EE7B7',
    label: 'Strong Match', icon: <TrendingUp className="h-4 w-4" />, textColor: '#064E3B',
  };
}

// Generates a rich summary when the stored summary is missing or too short
function buildFallbackSummary(score: number | undefined | null, candidate: Candidate): string {
  const s = typeof score === 'number' ? score : -1;

  if (s < 0) {
    return "This candidate has not been evaluated yet. Go to Candidate Evaluation and re-submit to generate an AI match score.";
  }
  if (s === 0) {
    return "Score: 0% — The resume could not be matched against the Job Description. Possible reasons:\n\n• The resume file may be unreadable or encrypted.\n• The resume content does not relate to the job requirements.\n• The JD file was not available at the time of submission.\n\nPlease verify the uploaded resume and re-evaluate if needed.";
  }
  if (s <= 30) {
    return `Score: ${s}% — Very low match.\n\nThe candidate's profile has significant gaps compared to the job requirements. Key qualifications, required skills, or experience level may be missing or insufficient. It is not recommended to proceed without a more detailed review.`;
  }
  if (s <= 50) {
    return `Score: ${s}% — Below average match.\n\nThe candidate meets only a few of the required qualifications. There are notable gaps in skills or experience. A manual review is recommended before proceeding to the interview stage.`;
  }
  if (s <= 65) {
    return `Score: ${s}% — Moderate match.\n\nThe candidate meets some key criteria but does not fully align with all job requirements. There are areas of partial fit alongside a few gaps. Further evaluation through screening is recommended.`;
  }
  if (s <= 80) {
    return `Score: ${s}% — Good match.\n\nThe candidate meets most of the required qualifications with only minor gaps. They are a strong candidate and are recommended for the interview process.`;
  }
  return `Score: ${s}% — Strong match.\n\nThe candidate closely aligns with the role requirements and demonstrates the key skills and experience needed. Highly recommended for the next stage.`;
}

// ─── AI MATCH CARD ────────────────────────────────────────────────────────────
const AIMatchCard: React.FC<{ candidate: Candidate }> = ({ candidate }) => {
  // Support both matchScore (old) and aiScore (new field name used in dashboard)
  const rawScore  = candidate.matchScore ?? candidate.aiScore;
  const score     = typeof rawScore === 'number' ? rawScore : undefined;
  const display   = getScoreDisplay(score);

  // Use stored summary if it's meaningful (>30 chars), otherwise generate one
  const storedSummary = candidate.matchSummary || "";
  const summary = storedSummary.trim().length > 30
    ? storedSummary
    : buildFallbackSummary(score, candidate);

  const scoreLabel = score !== undefined ? `${score}%` : '—';

  return (
    <div style={{
      background: 'white',
      borderRadius: '12px',
      padding: '20px',
      border: `1.5px solid ${display.border}`,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <p style={{ fontWeight: 'bold', fontSize: '14px', color: '#111827', margin: 0 }}>
          🤖 AI Match Analysis
        </p>
        <span style={{
          fontSize: '11px',
          fontWeight: '600',
          color: display.color,
          background: display.bg,
          border: `1px solid ${display.border}`,
          padding: '2px 8px',
          borderRadius: '999px',
        }}>
          {display.label}
        </span>
      </div>

      {/* Score ring + score number */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        background: display.bg,
        border: `1px solid ${display.border}`,
        borderRadius: '10px',
        padding: '12px 16px',
        marginBottom: '14px',
      }}>
        {/* Circle score */}
        <div style={{
          width: '64px',
          height: '64px',
          borderRadius: '50%',
          border: `4px solid ${display.color}`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          background: 'white',
        }}>
          <span style={{ fontSize: score !== undefined ? '18px' : '20px', fontWeight: '900', color: display.color, lineHeight: 1 }}>
            {scoreLabel}
          </span>
          {score !== undefined && (
            <span style={{ fontSize: '9px', color: display.color, fontWeight: '600', opacity: 0.8 }}>score</span>
          )}
        </div>

        {/* Score bar */}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', color: display.textColor }}>
            {display.icon}
            <span style={{ fontWeight: '700', fontSize: '14px' }}>{display.label}</span>
          </div>
          {score !== undefined && (
            <div style={{ height: '8px', background: '#E5E7EB', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${score}%`,
                background: display.color,
                borderRadius: '4px',
                transition: 'width 0.5s ease',
              }} />
            </div>
          )}
          <p style={{ fontSize: '11px', color: '#6B7280', marginTop: '4px' }}>
            {score === undefined
              ? 'Not yet evaluated'
              : score === 0
                ? 'Resume could not be matched'
                : `${score}/100 match score`
            }
          </p>
        </div>
      </div>

      {/* Summary text */}
      <div>
        <p style={{ fontSize: '12px', fontWeight: '600', color: '#6B7280', marginBottom: '6px' }}>WHY THIS SCORE</p>
        <div style={{
          fontSize: '13px',
          lineHeight: '1.7',
          color: '#374151',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
{summary.split('\n\n').map((para: string, i: number) => (
  <p key={i} style={{ margin: '0 0 8px 0' }}>
    {para}
  </p>
))}
        </div>
      </div>

      {/* Scoring method badge */}
      {candidate.matchSummary?.includes('Job Description') || candidate.matchSummary?.includes('JD') ? (
        <div style={{ marginTop: '12px', fontSize: '11px', color: '#6B7280', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ background: '#EDE9FE', color: '#5B21B6', padding: '2px 6px', borderRadius: '4px', fontWeight: '600' }}>
            JD-based
          </span>
          AI compared resume against Job Description
        </div>
      ) : candidate.matchSummary ? (
        <div style={{ marginTop: '12px', fontSize: '11px', color: '#6B7280', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ background: '#FEF3C7', color: '#92400E', padding: '2px 6px', borderRadius: '4px', fontWeight: '600' }}>
            Profile-based
          </span>
          Scored on candidate profile fields (no JD available)
        </div>
      ) : null}
    </div>
  );
};

// ─── STAGE CARD ───────────────────────────────────────────────────────────────
const StageCard: React.FC<StageCardProps> = ({
  title, status, isLocked, scheduledDate, timeSlot,
  schedulingNotes, savedFeedback,
  onAction, isResume = false, isOffer = false, canUpdate, role,
}) => {
  const [date, setDate]                 = useState('');
  const [slot, setSlot]                 = useState('');
  const [schedNotes, setSchedNotes]     = useState('');
  const [schedError, setSchedError]     = useState('');
  const [postFeedback, setPostFeedback] = useState('');
  const [postError, setPostError]       = useState('');
  const [resumeFeedback, setResumeFeedback] = useState('');
  const [offerFeedback, setOfferFeedback]   = useState('');
  const [offerError, setOfferError]         = useState('');

  const today      = new Date().toISOString().split('T')[0];
  const normalized = normalizeStatus(status);
  const isActive   = !isLocked && ['Pending', 'Scheduled', 'Released'].includes(normalized.name);

  const canPerformAction = () => {
    if (!canUpdate)                                                         return false;
    if (role === 'admin' || role === 'agency')                              return false;
    if (role === 'panel' && (title === 'HR Round' || title === 'Offer Stage')) return false;
    if (role === 'hr' && ['Resume Review','L1 Interview','L2 Interview'].includes(title)) return false;
    return true;
  };

  const handlePropose = () => {
    if (!date || !slot) { alert('Please pick a date and time slot.'); return; }
    if (!schedNotes.trim()) { setSchedError('Scheduling notes are required.'); return; }
    setSchedError('');
    onAction('schedule', { scheduledDate: date, timeSlot: slot, schedulingNotes: schedNotes.trim() });
  };

  const handlePostAction = (action: 'select' | 'reject') => {
    if (!postFeedback.trim()) { setPostError('Interview feedback is required.'); return; }
    setPostError('');
    onAction(action, { feedback: postFeedback.trim() });
  };

  const handleOfferAction = (action: 'offer-accept' | 'offer-reject') => {
    if (!offerFeedback.trim()) { setOfferError('Feedback is required.'); return; }
    setOfferError('');
    onAction(action, { feedback: offerFeedback.trim() });
  };

  const timeSlots = [
    '09:00am - 10:00am', '10:00am - 11:00am', '11:00am - 12:00pm',
    '01:00pm - 02:00pm', '02:00pm - 03:00pm', '03:00pm - 04:00pm', '04:00pm - 05:00pm',
  ];

  const infoBox: React.CSSProperties  = { background: '#F9FAFB', borderRadius: '8px', padding: '10px 12px', border: '1px solid #E5E7EB' };
  const lbl: React.CSSProperties      = { fontSize: '12px', fontWeight: '600', color: '#6B7280', marginBottom: '4px' };
  const saved: React.CSSProperties    = { fontSize: '13px', lineHeight: '1.6', wordBreak: 'break-word', whiteSpace: 'pre-wrap' };
  const errStyle: React.CSSProperties = { color: '#DC2626', fontSize: '12px', marginTop: '4px' };

  return (
    <div style={{
      borderRadius: '12px',
      border: `1.5px solid ${isActive ? '#7C3AED' : '#E5E7EB'}`,
      boxShadow: isActive ? '0 2px 10px rgba(124,58,237,0.08)' : 'none',
      background: 'white',
    }}>
      <div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #F3F4F6' }}>
        <h3 style={{ fontWeight: 'bold', fontSize: '15px', margin: 0 }}>{title}</h3>
        <Badge className={normalized.color}>{normalized.name}</Badge>
      </div>

      <div style={{ padding: '14px 16px' }}>
        {isLocked ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#9CA3AF', fontSize: '13px' }}>
            <Lock className="h-4 w-4" />
            <span>Complete the previous stage to unlock this step.</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

            {/* RESUME REVIEW */}
            {isResume && (
              <>
                {(normalized.name === 'Accepted' || normalized.name === 'Rejected') && (
                  <div style={infoBox}>
                    <p style={lbl}>Feedback</p>
                    <p style={{ ...saved, color: normalized.name === 'Rejected' ? '#DC2626' : '#374151' }}>
                      {savedFeedback || 'No feedback provided.'}
                    </p>
                  </div>
                )}
                {canPerformAction() && normalized.name === 'Pending' && (
                  <>
                    <Textarea
                      placeholder="Enter resume review feedback (mandatory)…"
                      value={resumeFeedback}
                      onChange={e => setResumeFeedback(e.target.value)}
                      style={{ resize: 'vertical', minHeight: '80px' }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                      <Button variant="destructive" onClick={() => { if (!resumeFeedback.trim()) { alert('Feedback is required.'); return; } onAction('reject', { feedback: resumeFeedback.trim() }); }}>✕ Reject</Button>
                      <Button variant="default"     onClick={() => { if (!resumeFeedback.trim()) { alert('Feedback is required.'); return; } onAction('accept', { feedback: resumeFeedback.trim() }); }}>✓ Accept</Button>
                    </div>
                  </>
                )}
              </>
            )}

            {/* L1 / L2 / HR INTERVIEWS */}
            {!isResume && !isOffer && (
              <>
                {['Scheduled','Selected','Rejected'].includes(normalized.name) && scheduledDate && (
                  <div style={infoBox}>
                    <p style={lbl}>📅 Scheduled</p>
                    <p style={{ ...saved, fontWeight: '600', color: '#374151' }}>
                      {new Date(scheduledDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} at {timeSlot}
                    </p>
                  </div>
                )}
                {['Scheduled','Selected','Rejected'].includes(normalized.name) && schedulingNotes && (
                  <div style={infoBox}>
                    <p style={lbl}>📝 Scheduling Notes</p>
                    <p style={{ ...saved, color: '#374151' }}>{schedulingNotes}</p>
                  </div>
                )}
                {['Selected','Rejected'].includes(normalized.name) && savedFeedback && (
                  <div style={{ ...infoBox, borderColor: normalized.name === 'Rejected' ? '#FCA5A5' : '#6EE7B7' }}>
                    <p style={lbl}>💬 Interview Feedback</p>
                    <p style={{ ...saved, color: normalized.name === 'Rejected' ? '#DC2626' : '#065F46' }}>{savedFeedback}</p>
                  </div>
                )}
                {canPerformAction() && normalized.name === 'Pending' && (
                  <div style={{ background: '#F9FAFB', borderRadius: '10px', padding: '14px', border: '1px solid #E5E7EB' }}>
                    <p style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '12px' }}>Propose Interview Time</p>
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
                      <div style={{ position: 'relative', minWidth: '150px' }}>
                        <Calendar className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" style={{ pointerEvents: 'none' }} />
                        <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="pl-10" min={today} style={{ background: 'white', borderRadius: '8px' }} />
                      </div>
                      <select value={slot} onChange={e => setSlot(e.target.value)} style={{ borderRadius: '8px', border: '1px solid #E5E7EB', padding: '9px', background: 'white', flex: 1, minWidth: '160px' }}>
                        <option value="">Select a time slot</option>
                        {timeSlots.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <p style={{ ...lbl, marginBottom: '6px' }}>Scheduling Notes <span style={{ color: '#DC2626' }}>*</span></p>
                    <Textarea
                      placeholder="Add notes for this interview…"
                      value={schedNotes}
                      onChange={e => { setSchedNotes(e.target.value); if (e.target.value.trim()) setSchedError(''); }}
                      style={{ resize: 'vertical', minHeight: '80px', background: 'white' }}
                    />
                    {schedError && <p style={errStyle}>⚠ {schedError}</p>}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
                      <Button onClick={handlePropose} style={{ background: '#7C3AED', color: 'white', fontWeight: 'bold' }}>📅 Propose</Button>
                    </div>
                  </div>
                )}
                {canPerformAction() && normalized.name === 'Scheduled' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <p style={{ ...lbl, marginBottom: '2px' }}>Interview Feedback <span style={{ color: '#DC2626' }}>*</span></p>
                    <Textarea
                      placeholder="Enter post-interview feedback (mandatory)…"
                      value={postFeedback}
                      onChange={e => { setPostFeedback(e.target.value); if (e.target.value.trim()) setPostError(''); }}
                      style={{ resize: 'vertical', minHeight: '90px' }}
                    />
                    {postError && <p style={errStyle}>⚠ {postError}</p>}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
                      <Button variant="destructive" onClick={() => handlePostAction('reject')}>✕ Reject</Button>
                      <Button variant="default"     onClick={() => handlePostAction('select')}>✓ Select</Button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* OFFER STAGE */}
            {isOffer && (
              <>
                {normalized.name === 'Released' && !canPerformAction() && (
                  <p style={{ fontSize: '13px', color: '#2563EB', fontWeight: '600' }}>📨 Offer has been released. Awaiting candidate response.</p>
                )}
                {(normalized.name === 'Accepted' || normalized.name === 'Rejected') && savedFeedback && (
                  <div style={{ ...infoBox, borderColor: normalized.name === 'Accepted' ? '#6EE7B7' : '#FCA5A5' }}>
                    <p style={lbl}>Response Notes</p>
                    <p style={{ ...saved, color: normalized.name === 'Accepted' ? '#065F46' : '#DC2626' }}>
                      {normalized.name === 'Accepted' ? '🎉 ' : ''}{savedFeedback}
                    </p>
                  </div>
                )}
                {canPerformAction() && normalized.name === 'Pending' && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Button onClick={() => onAction('release-offer', {})} style={{ background: '#7C3AED', color: 'white' }}>📨 Release Offer</Button>
                  </div>
                )}
                {canPerformAction() && normalized.name === 'Released' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <p style={{ fontSize: '13px', color: '#2563EB', fontWeight: '600' }}>📨 Offer has been released</p>
                    <p style={{ ...lbl, marginBottom: '2px' }}>Response Notes <span style={{ color: '#DC2626' }}>*</span></p>
                    <Textarea
                      placeholder="Enter candidate's response or notes (mandatory)…"
                      value={offerFeedback}
                      onChange={e => { setOfferFeedback(e.target.value); if (e.target.value.trim()) setOfferError(''); }}
                      style={{ resize: 'vertical', minHeight: '80px' }}
                    />
                    {offerError && <p style={errStyle}>⚠ {offerError}</p>}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
                      <Button variant="destructive" onClick={() => handleOfferAction('offer-reject')}>✕ Mark Rejected</Button>
                      <Button variant="default"     onClick={() => handleOfferAction('offer-accept')}>✓ Mark Accepted</Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function CandidatePage({ params }: { params: { candidateId: string } }) {
  const { candidateId } = params;
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [loading, setLoading]     = useState(true);
  const router                    = useRouter();
  const { role, user }            = useAuth();

  useEffect(() => {
    if (!candidateId) return;
    const unsub = onSnapshot(doc(db, 'candidates', candidateId), (snap) => {
      setCandidate(snap.exists() ? { id: snap.id, ...snap.data() } as Candidate : null);
      setLoading(false);
    });
    return () => unsub();
  }, [candidateId]);

  const handleAction = async (stage: string, action: string, payload: any) => {
    if (!candidate || !user) return;

    let updateData: Partial<Candidate> = {};
    const historyData: any = {
      candidateId, stage,
      status:          '',
      feedback:        payload.feedback        || '',
      schedulingNotes: payload.schedulingNotes || '',
      scheduledDate:   payload.scheduledDate   || null,
      timeSlot:        payload.timeSlot        || null,
      updatedBy:       user.uid,
      updatedAt:       Timestamp.now(),
    };

    switch (stage) {
      case 'Resume Review':
        if (action === 'accept') {
          updateData = { resumeReviewStatus: 'Accepted', resumeFeedback: payload.feedback, l1Status: 'Pending' };
          historyData.status = 'Accepted';
        } else {
          updateData = { resumeReviewStatus: 'Rejected', resumeFeedback: payload.feedback, finalStatus: 'Rejected', l1Status: 'Locked', l2Status: 'Locked', hrStatus: 'Locked', offerStatus: 'Locked' };
          historyData.status = 'Rejected';
        }
        break;
      case 'L1 Interview':
        if (action === 'schedule') {
          updateData = { l1Status: 'Scheduled', l1ScheduledDate: payload.scheduledDate, l1TimeSlot: payload.timeSlot, l1SchedulingNotes: payload.schedulingNotes, l1InterviewerUid: user.uid, l1InterviewerName: user.displayName || user.email };
          historyData.status = 'Scheduled';
        } else if (action === 'select') {
          updateData = { l1Status: 'Selected', l1Feedback: payload.feedback, l2Status: 'Pending', l1InterviewerUid: user.uid, l1InterviewerName: user.displayName || user.email };
          historyData.status = 'Selected';
        } else {
          updateData = { l1Status: 'Rejected', l1Feedback: payload.feedback, finalStatus: 'Rejected', l2Status: 'Locked', hrStatus: 'Locked', offerStatus: 'Locked', l1InterviewerUid: user.uid, l1InterviewerName: user.displayName || user.email };
          historyData.status = 'Rejected';
        }
        break;
      case 'L2 Interview':
        if (action === 'schedule') {
          updateData = { l2Status: 'Scheduled', l2ScheduledDate: payload.scheduledDate, l2TimeSlot: payload.timeSlot, l2SchedulingNotes: payload.schedulingNotes, l2InterviewerUid: user.uid, l2InterviewerName: user.displayName || user.email };
          historyData.status = 'Scheduled';
        } else if (action === 'select') {
          updateData = { l2Status: 'Selected', l2Feedback: payload.feedback, hrStatus: 'Pending', l2InterviewerUid: user.uid, l2InterviewerName: user.displayName || user.email };
          historyData.status = 'Selected';
        } else {
          updateData = { l2Status: 'Rejected', l2Feedback: payload.feedback, finalStatus: 'Rejected', hrStatus: 'Locked', offerStatus: 'Locked', l2InterviewerUid: user.uid, l2InterviewerName: user.displayName || user.email };
          historyData.status = 'Rejected';
        }
        break;
      case 'HR Round':
        if (action === 'schedule') {
          updateData = { hrStatus: 'Scheduled', hrScheduledDate: payload.scheduledDate, hrTimeSlot: payload.timeSlot, hrSchedulingNotes: payload.schedulingNotes };
          historyData.status = 'Scheduled';
        } else if (action === 'select') {
          updateData = { hrStatus: 'Selected', hrFeedback: payload.feedback, offerStatus: 'Pending' };
          historyData.status = 'Selected';
        } else {
          updateData = { hrStatus: 'Rejected', hrFeedback: payload.feedback, finalStatus: 'Rejected', offerStatus: 'Locked' };
          historyData.status = 'Rejected';
        }
        break;
      case 'Offer Stage':
        if (action === 'release-offer') {
          updateData = { offerStatus: 'Released' };
          historyData.status = 'Released';
        } else if (action === 'offer-accept') {
          updateData = { offerStatus: 'Accepted', offerFeedback: payload.feedback, finalStatus: 'Completed' };
          historyData.status = 'Accepted';
        } else {
          updateData = { offerStatus: 'Rejected', offerFeedback: payload.feedback, finalStatus: 'Rejected' };
          historyData.status = 'Rejected';
        }
        break;
    }

    try {
      await updateDoc(doc(db, 'candidates', candidate.id), { ...updateData, lastUpdated: Timestamp.now() });
      await addDoc(collection(db, 'candidate_history'), historyData);
    } catch (err) {
      console.error('Firestore update failed:', err);
      return;
    }

    // Emails
    const needsEmail =
      ['L1 Interview','L2 Interview','HR Round'].includes(stage) && ['schedule','select','reject'].includes(action) ||
      stage === 'Offer Stage' && ['release-offer','offer-accept','offer-reject'].includes(action);

    if (!needsEmail || !candidate.createdBy) return;

    const uploader = await getUploaderInfo(candidate.createdBy);
    if (!uploader.email?.includes('@')) return;

    const loggedInUserName = await getLoggedInUserName(user.uid);
    const interviewerName  = loggedInUserName || user.displayName || (role === 'hr' ? 'HR Team' : 'Panel Team');

    const base = {
      toEmail:           uploader.email,
      candidateName:     candidate.candidateName        || 'Candidate',
      jobRole:           candidate.candidateDesignation || 'Not specified',
      interviewerName,
      interviewerEmail:  user.email ?? '',
      experience:        String(candidate.experience || ''),
      location:          String(candidate.location   || ''),
      stage,
      schedulingNotes:   payload.schedulingNotes || '',
      interviewFeedback: payload.feedback        || '',
    };

    const senderRole = stage === 'HR Round' || stage === 'Offer Stage' ? 'hr' : 'panel';
    const actionToEmailType: Record<string, any> = {
      schedule:      'interview_scheduled',
      select:        'candidate_selected',
      reject:        'candidate_rejected',
      'release-offer': 'offer_released',
      'offer-accept':  'offer_accepted',
      'offer-reject':  'offer_rejected',
    };

    await sendEmail({
      ...base,
      label:     `${stage} ${action}`,
      senderRole,
      emailType: actionToEmailType[action],
      interviewDate: payload.scheduledDate || '',
      interviewTime: payload.timeSlot      || '',
    });
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'Segoe UI, system-ui' }}>
      Loading Candidate…
    </div>
  );
  if (!candidate) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'Segoe UI, system-ui' }}>
      Candidate not found.
    </div>
  );

  const getStatus = (s: Status | undefined): Status => s || 'Pending';
  const resumeReviewStatus = getStatus(candidate.resumeReviewStatus);
  const l1Status           = getStatus(candidate.l1Status);
  const l2Status           = getStatus(candidate.l2Status);
  const hrStatus           = getStatus(candidate.hrStatus);
  const offerStatus        = getStatus(candidate.offerStatus);

  const lockedStates = {
    l1:    resumeReviewStatus !== 'Accepted',
    l2:    l1Status !== 'Selected',
    hr:    l2Status !== 'Selected',
    offer: hrStatus !== 'Selected',
  };

  const stageDefs: StageCardProps[] = [
    { title: 'Resume Review', status: resumeReviewStatus, isLocked: false,     savedFeedback: candidate.resumeFeedback, onAction: (a,p) => handleAction('Resume Review', a, p), isResume: true, canUpdate: true, role },
    { title: 'L1 Interview',  status: l1Status,           isLocked: lockedStates.l1, scheduledDate: candidate.l1ScheduledDate, timeSlot: candidate.l1TimeSlot, schedulingNotes: candidate.l1SchedulingNotes, savedFeedback: candidate.l1Feedback, onAction: (a,p) => handleAction('L1 Interview', a, p), canUpdate: true, role },
    { title: 'L2 Interview',  status: l2Status,           isLocked: lockedStates.l2, scheduledDate: candidate.l2ScheduledDate, timeSlot: candidate.l2TimeSlot, schedulingNotes: candidate.l2SchedulingNotes, savedFeedback: candidate.l2Feedback, onAction: (a,p) => handleAction('L2 Interview', a, p), canUpdate: true, role },
    { title: 'HR Round',      status: hrStatus,           isLocked: lockedStates.hr, scheduledDate: candidate.hrScheduledDate, timeSlot: candidate.hrTimeSlot, schedulingNotes: candidate.hrSchedulingNotes, savedFeedback: candidate.hrFeedback, onAction: (a,p) => handleAction('HR Round', a, p), canUpdate: true, role },
    { title: 'Offer Stage',   status: offerStatus,        isLocked: lockedStates.offer, savedFeedback: candidate.offerFeedback, onAction: (a,p) => handleAction('Offer Stage', a, p), isOffer: true, canUpdate: true, role },
  ];

  // Final status badge color
  const finalStatus = candidate.finalStatus || 'In Progress';
  const finalBadgeStyle: React.CSSProperties = {
    background: finalStatus === 'Completed' ? '#D1FAE5' : finalStatus === 'Rejected' ? '#FEE2E2' : '#EDE9FE',
    color:      finalStatus === 'Completed' ? '#065F46'  : finalStatus === 'Rejected' ? '#991B1B'  : '#5B21B6',
    padding: '4px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: '700', display: 'inline-block',
  };

  return (
    <div style={{ fontFamily: 'Segoe UI, system-ui', background: '#F5F6FA', padding: '24px' }}>
      <div style={{ marginBottom: '20px' }}>
        <Button variant="outline" onClick={() => router.back()} className="flex items-center gap-2 font-semibold">
          ← Back to History
        </Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '30% 70%', gap: '24px' }}>

        {/* ── LEFT COLUMN ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Profile card */}
          <div style={{ background: 'white', borderRadius: '12px', padding: '20px', textAlign: 'center' }}>
            <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: '#EDE9FE', margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', fontWeight: '700', color: '#5B21B6' }}>
              {(candidate.candidateName || '?')[0].toUpperCase()}
            </div>
            <h2 style={{ fontWeight: 'bold', margin: '0 0 4px' }}>{candidate.candidateName}</h2>
            <p style={{ color: 'gray', fontSize: '14px', margin: '0 0 10px' }}>{candidate.candidateDesignation}</p>
            <span style={finalBadgeStyle}>{finalStatus}</span>
          </div>

          {/* ── AI Match Card (the fixed one) ── */}
          <AIMatchCard candidate={candidate} />

          {/* Resume viewer */}
          <div style={{ background: 'white', borderRadius: '12px', padding: '20px', textAlign: 'center' }}>
            {candidate.resumeFile?.data ? (
              <Button variant="outline" onClick={() => {
                const bytes = atob(candidate.resumeFile.data);
                const arr   = new Uint8Array(bytes.length).map((_, i) => bytes.charCodeAt(i));
                const fileType = candidate.resumeFile.type || 'application/pdf';

                const blob = new Blob([arr], { type: fileType });
                const url = URL.createObjectURL(blob);
                
                if (fileType.includes('pdf')) {
                  window.open(url, '_blank'); // works
                } else {
                  // download instead of preview
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = candidate.resumeFile.name || 'resume';
                  a.click();
                }
                              }}>
                📄 View Resume
              </Button>
            ) : (
              <p style={{ color: 'gray', fontSize: '13px' }}>No resume uploaded</p>
            )}
          </div>
        </div>

        {/* ── RIGHT COLUMN ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Interview Workflow */}
          <div style={{ background: 'white', borderRadius: '12px', padding: '20px' }}>
            <h2 style={{ fontWeight: 'bold', marginBottom: '6px' }}>Interview Workflow</h2>
            <p style={{ fontSize: '13px', color: 'gray', marginBottom: '16px' }}>Manage active round. Save details to advance.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {stageDefs.map(stage => <StageCard key={stage.title} {...stage} />)}
            </div>
          </div>

          {/* Professional Background */}
          <div style={{ background: 'white', borderRadius: '12px', padding: '20px' }}>
            <h2 style={{ fontWeight: 'bold', marginBottom: '16px' }}>Professional Background</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              {[
                ['Full Name',         candidate.candidateName],
                ['Email',             candidate.candidateEmail],
                ['Phone',             candidate.phoneNumber || candidate.candidatePhone || candidate.phone || '—'],
                ['Experience',        candidate.experience ? `${candidate.experience} Years` : '—'],
                ['Current CTC',       candidate.currentCtc  || '—'],
                ['Expected CTC',      candidate.expectedCtc || '—'],
                ['Notice Period',     candidate.noticePeriod || '—'],
                ['Onsite Comfort',    candidate.isComfortableOnsite || '—'],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <p style={{ color: 'gray', fontSize: '12px', marginBottom: '2px' }}>{label}</p>
                  <p style={{ fontWeight: 'bold', wordBreak: 'break-all' }}>{value as string}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}