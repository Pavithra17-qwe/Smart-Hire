'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { doc, onSnapshot, updateDoc, addDoc, getDoc, collection, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Calendar, Lock } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Candidate } from '@/types/candidate';
import { normalizeStatus } from '@/lib/normalizeStatus';
import { sendInterviewEmail } from '@/ai/flows/send-interview-email-flow';

// --- TYPE DEFINITIONS ---
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
  schedulingNotes?: string;   // ← notes entered at scheduling time
  savedFeedback?: string;     // ← feedback entered after interview (select/reject)
  onAction: (action: string, payload: any) => void;
  isResume?: boolean;
  isOffer?: boolean;
  canUpdate: boolean;
  role: string | null;
}

// ─────────────────────────────────────────────
// HELPER: fetch uploader info
// ─────────────────────────────────────────────
async function getUploaderInfo(createdBy: string): Promise<{ email: string | null; name: string | null }> {
  try {
    const userSnap = await getDoc(doc(db, 'users', createdBy));
    if (userSnap.exists()) {
      const data = userSnap.data();
      return { email: data.email || null, name: data.displayName || data.name || null };
    }
    return { email: null, name: null };
  } catch (err) {
    console.error('❌ Failed to fetch uploader info:', err);
    return { email: null, name: null };
  }
}

// ─────────────────────────────────────────────
// HELPER: fetch logged-in user's real display name from Firestore
// ─────────────────────────────────────────────
async function getLoggedInUserName(uid: string): Promise<string | null> {
  try {
    const userSnap = await getDoc(doc(db, 'users', uid));
    if (userSnap.exists()) {
      const data = userSnap.data();
      return data.displayName || data.name || data.fullName || null;
    }
    return null;
  } catch (err) {
    console.error('❌ Failed to fetch logged-in user name:', err);
    return null;
  }
}

// ─────────────────────────────────────────────
// HELPER: send email
// ─────────────────────────────────────────────
async function sendEmail(params: {
  toEmail: string;
  candidateName: string;
  jobRole: string;
  experience?: string;
  location?: string;
  interviewerName: string;
  interviewerEmail?: string;
  interviewDate?: string;
  interviewTime?: string;
  schedulingNotes?: string;
  interviewFeedback?: string;
  label: string;
  stage: string;
  senderRole?: 'panel' | 'hr' | 'system';
  emailType?: 'interview_scheduled' | 'candidate_selected' | 'candidate_rejected' | 'offer_released' | 'offer_accepted' | 'offer_rejected';
}) {
  const { toEmail, label } = params;
  console.log(`📧 Sending [${label}] email to: ${toEmail}`);
  if (!toEmail || !toEmail.includes('@')) {
    console.error(`❌ [${label}] Aborted — invalid toEmail: "${toEmail}"`);
    return;
  }
  try {
    const result = await sendInterviewEmail({
      candidateName:    params.candidateName,
      candidateEmail:   toEmail,
      jobRole:          params.jobRole,
      experience:       params.experience || '',
      location:         params.location || '',
      interviewerName:  params.interviewerName,
      interviewerEmail: params.interviewerEmail || '',
      interviewDate:    params.interviewDate || '',
      interviewTime:    params.interviewTime || '',
      schedulingNotes:  params.schedulingNotes || '',
      interviewFeedback: params.interviewFeedback || '',
      stage:            params.stage,
      senderRole:       params.senderRole,
      emailType:        params.emailType,
    });
    if (result?.success) {
      console.log(`✅ [${label}] email sent → to: ${toEmail}`);
    } else {
      console.error(`❌ [${label}] flow returned success=false`);
    }
  } catch (err: any) {
    console.error(`❌ [${label}] exception:`, err?.message || err);
  }
}

// ─────────────────────────────────────────────
// StageCard — fully rebuilt
// ─────────────────────────────────────────────
const StageCard: React.FC<StageCardProps> = ({
  title, status, isLocked, scheduledDate, timeSlot,
  schedulingNotes, savedFeedback,
  onAction, isResume = false, isOffer = false, canUpdate, role,
}) => {
  // Scheduling (Pending state)
  const [date, setDate]               = useState('');
  const [slot, setSlot]               = useState('');
  const [schedNotes, setSchedNotes]   = useState('');
  const [schedError, setSchedError]   = useState('');

  // Post-interview (Scheduled state)
  const [postFeedback, setPostFeedback]   = useState('');
  const [postError, setPostError]         = useState('');

  // Resume review
  const [resumeFeedback, setResumeFeedback] = useState('');

  // Offer feedback
  const [offerFeedback, setOfferFeedback] = useState('');
  const [offerError, setOfferError]       = useState('');

  const today      = new Date().toISOString().split('T')[0];
  const normalized = normalizeStatus(status);
  const isActive   = !isLocked && ['Pending', 'Scheduled', 'Released'].includes(normalized.name);

  const canPerformAction = () => {
    if (!canUpdate) return false;
    if (role === 'admin' || role === 'agency') return false;
    if (role === 'panel' && (title === 'HR Round' || title === 'Offer Stage')) return false;
    if (role === 'hr' && (title === 'Resume Review' || title === 'L1 Interview' || title === 'L2 Interview')) return false;
    return true;
  };

  // ── Scheduling propose handler ──
  const handlePropose = () => {
    if (!date || !slot) { alert('Please pick a date and time slot.'); return; }
    if (!schedNotes.trim()) { setSchedError('Scheduling notes are required.'); return; }
    setSchedError('');
    onAction('schedule', { scheduledDate: date, timeSlot: slot, schedulingNotes: schedNotes.trim() });
  };

  // ── Post-interview select/reject handler ──
  const handlePostAction = (action: 'select' | 'reject') => {
    if (!postFeedback.trim()) { setPostError('Interview feedback is required.'); return; }
    setPostError('');
    onAction(action, { feedback: postFeedback.trim() });
  };

  // ── Offer feedback handler ──
  const handleOfferAction = (action: 'offer-accept' | 'offer-reject') => {
    if (!offerFeedback.trim()) { setOfferError('Feedback is required.'); return; }
    setOfferError('');
    onAction(action, { feedback: offerFeedback.trim() });
  };

  const timeSlots = [
    '09:00am - 10:00am', '10:00am - 11:00am', '11:00am - 12:00pm',
    '01:00pm - 02:00pm', '02:00pm - 03:00pm', '03:00pm - 04:00pm', '04:00pm - 05:00pm',
  ];

  // ── Shared text style for saved data ──
  const savedTextStyle: React.CSSProperties = {
    fontSize: '13px',
    lineHeight: '1.6',
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
  };

  const errorStyle: React.CSSProperties = {
    color: '#DC2626',
    fontSize: '12px',
    marginTop: '4px',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '12px',
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: '4px',
  };

  const infoBoxStyle: React.CSSProperties = {
    background: '#F9FAFB',
    borderRadius: '8px',
    padding: '10px 12px',
    border: '1px solid #E5E7EB',
  };

  return (
    <div style={{
      borderRadius: '12px',
      border: `1.5px solid ${isActive ? '#7C3AED' : '#E5E7EB'}`,
      boxShadow: isActive ? '0 2px 10px rgba(124,58,237,0.08)' : 'none',
      background: 'white',
    }}>
      {/* Header */}
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

            {/* ════════════════════════════
                RESUME REVIEW
            ════════════════════════════ */}
            {isResume && (
              <>
                {(normalized.name === 'Accepted' || normalized.name === 'Rejected') && (
                  <div style={infoBoxStyle}>
                    <p style={labelStyle}>Feedback</p>
                    <p style={{ ...savedTextStyle, color: normalized.name === 'Rejected' ? '#DC2626' : '#374151' }}>
                      {savedFeedback || 'No feedback provided.'}
                    </p>
                  </div>
                )}
                {canPerformAction() && normalized.name === 'Pending' && (
                  <>
                    <Textarea
                      placeholder="Enter resume review feedback (mandatory)..."
                      value={resumeFeedback}
                      onChange={(e) => setResumeFeedback(e.target.value)}
                      style={{ resize: 'vertical', minHeight: '80px', wordBreak: 'break-word' }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                      <Button variant="destructive"
                        onClick={() => {
                          if (!resumeFeedback.trim()) { alert('Feedback is required.'); return; }
                          onAction('reject', { feedback: resumeFeedback.trim() });
                        }}>
                        ✕ Reject
                      </Button>
                      <Button variant="default"
                        onClick={() => {
                          if (!resumeFeedback.trim()) { alert('Feedback is required.'); return; }
                          onAction('accept', { feedback: resumeFeedback.trim() });
                        }}>
                        ✓ Accept
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}

            {/* ════════════════════════════
                L1 / L2 / HR INTERVIEW
            ════════════════════════════ */}
            {!isResume && !isOffer && (
              <>
                {/* ── Show saved schedule info ── */}
                {['Scheduled', 'Selected', 'Rejected'].includes(normalized.name) && scheduledDate && (
                  <div style={infoBoxStyle}>
                    <p style={labelStyle}>📅 Scheduled</p>
                    <p style={{ ...savedTextStyle, fontWeight: '600', color: '#374151' }}>
                      {new Date(scheduledDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} at {timeSlot}
                    </p>
                  </div>
                )}

                {/* ── Show saved scheduling notes ── */}
                {['Scheduled', 'Selected', 'Rejected'].includes(normalized.name) && schedulingNotes && (
                  <div style={infoBoxStyle}>
                    <p style={labelStyle}>📝 Scheduling Notes</p>
                    <p style={{ ...savedTextStyle, color: '#374151' }}>{schedulingNotes}</p>
                  </div>
                )}

                {/* ── Show saved post-interview feedback ── */}
                {['Selected', 'Rejected'].includes(normalized.name) && savedFeedback && (
                  <div style={{ ...infoBoxStyle, borderColor: normalized.name === 'Rejected' ? '#FCA5A5' : '#6EE7B7' }}>
                    <p style={labelStyle}>💬 Interview Feedback</p>
                    <p style={{ ...savedTextStyle, color: normalized.name === 'Rejected' ? '#DC2626' : '#065F46' }}>
                      {savedFeedback}
                    </p>
                  </div>
                )}

                {/* ── PENDING: Propose date + scheduling notes ── */}
                {canPerformAction() && normalized.name === 'Pending' && (
                  <div style={{ background: '#F9FAFB', borderRadius: '10px', padding: '14px', border: '1px solid #E5E7EB' }}>
                    <p style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '12px' }}>Propose Interview Time</p>

                    {/* Date + Slot row */}
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '12px' }}>
                      <div style={{ position: 'relative', minWidth: '150px' }}>
                        <Calendar className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" style={{ pointerEvents: 'none' }} />
                        <Input
                          type="date"
                          value={date}
                          onChange={(e) => setDate(e.target.value)}
                          className="pl-10"
                          style={{ background: 'white', borderRadius: '8px' }}
                          min={today}
                        />
                      </div>
                      <select
                        value={slot}
                        onChange={(e) => setSlot(e.target.value)}
                        style={{ borderRadius: '8px', border: '1px solid #E5E7EB', padding: '9px', background: 'white', flex: 1, minWidth: '160px' }}
                      >
                        <option value="">Select a time slot</option>
                        {timeSlots.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>

                    {/* Scheduling Notes — mandatory */}
                    <div style={{ marginBottom: '4px' }}>
                      <p style={{ ...labelStyle, marginBottom: '6px' }}>
                        Scheduling Notes <span style={{ color: '#DC2626' }}>*</span>
                      </p>
                      <Textarea
                        placeholder="Add notes for this interview (e.g. topics to cover, instructions for the candidate)..."
                        value={schedNotes}
                        onChange={(e) => { setSchedNotes(e.target.value); if (e.target.value.trim()) setSchedError(''); }}
                        style={{ resize: 'vertical', minHeight: '80px', wordBreak: 'break-word', background: 'white' }}
                      />
                      {schedError && <p style={errorStyle}>⚠ {schedError}</p>}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
                      <Button onClick={handlePropose} style={{ background: '#7C3AED', color: 'white', fontWeight: 'bold' }}>
                        📅 Propose
                      </Button>
                    </div>
                  </div>
                )}

                {/* ── SCHEDULED: Post-interview feedback + Select/Reject ── */}
                {canPerformAction() && normalized.name === 'Scheduled' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <p style={{ ...labelStyle, marginBottom: '2px' }}>
                      Interview Feedback <span style={{ color: '#DC2626' }}>*</span>
                    </p>
                    <Textarea
                      placeholder="Enter post-interview feedback (mandatory)..."
                      value={postFeedback}
                      onChange={(e) => { setPostFeedback(e.target.value); if (e.target.value.trim()) setPostError(''); }}
                      style={{ resize: 'vertical', minHeight: '90px', wordBreak: 'break-word' }}
                    />
                    {postError && <p style={errorStyle}>⚠ {postError}</p>}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
                      <Button variant="destructive" onClick={() => handlePostAction('reject')}>✕ Reject</Button>
                      <Button variant="default" onClick={() => handlePostAction('select')}>✓ Select</Button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ════════════════════════════
                OFFER STAGE
            ════════════════════════════ */}
            {isOffer && (
              <>
                {normalized.name === 'Released' && !canPerformAction() && (
                  <p style={{ fontSize: '13px', color: '#2563EB', fontWeight: '600' }}>📨 Offer has been released. Awaiting candidate response.</p>
                )}
                {(normalized.name === 'Accepted' || normalized.name === 'Rejected') && savedFeedback && (
                  <div style={{ ...infoBoxStyle, borderColor: normalized.name === 'Accepted' ? '#6EE7B7' : '#FCA5A5' }}>
                    <p style={labelStyle}>Response Notes</p>
                    <p style={{ ...savedTextStyle, color: normalized.name === 'Accepted' ? '#065F46' : '#DC2626' }}>
                      {normalized.name === 'Accepted' ? '🎉 ' : ''}
                      {savedFeedback}
                    </p>
                  </div>
                )}
                {canPerformAction() && normalized.name === 'Pending' && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Button onClick={() => onAction('release-offer', {})} style={{ background: '#7C3AED', color: 'white' }}>
                      📨 Release Offer
                    </Button>
                  </div>
                )}
                {canPerformAction() && normalized.name === 'Released' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <p style={{ fontSize: '13px', color: '#2563EB', fontWeight: '600' }}>📨 Offer has been released</p>
                    <p style={{ ...labelStyle, marginBottom: '2px' }}>
                      Response Notes <span style={{ color: '#DC2626' }}>*</span>
                    </p>
                    <Textarea
                      placeholder="Enter candidate's response or notes (mandatory)..."
                      value={offerFeedback}
                      onChange={(e) => { setOfferFeedback(e.target.value); if (e.target.value.trim()) setOfferError(''); }}
                      style={{ resize: 'vertical', minHeight: '80px', wordBreak: 'break-word' }}
                    />
                    {offerError && <p style={errorStyle}>⚠ {offerError}</p>}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
                      <Button variant="destructive" onClick={() => handleOfferAction('offer-reject')}>✕ Mark Rejected</Button>
                      <Button variant="default" onClick={() => handleOfferAction('offer-accept')}>✓ Mark Accepted</Button>
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

// ─────────────────────────────────────────────
// MAIN PAGE COMPONENT
// ─────────────────────────────────────────────
export default function CandidatePage({ params }: { params: { candidateId: string } }) {
  const { candidateId } = params;
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [loading, setLoading]     = useState(true);
  const router = useRouter();
  const { role, user } = useAuth();

  useEffect(() => {
    if (!candidateId) return;
    const unsub = onSnapshot(doc(db, 'candidates', candidateId), (snapshot) => {
      if (snapshot.exists()) {
        setCandidate({ id: snapshot.id, ...snapshot.data() } as Candidate);
      } else {
        setCandidate(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [candidateId]);

  const handleAction = async (stage: string, action: string, payload: any) => {
    if (!candidate || !user) return;

    let updateData: Partial<Candidate> = {};
    const historyData: any = {
      candidateId,
      stage,
      status: '',
      feedback:         payload.feedback         || '',
      schedulingNotes:  payload.schedulingNotes  || '',
      scheduledDate:    payload.scheduledDate    || null,
      timeSlot:         payload.timeSlot         || null,
      updatedBy:  user.uid,
      updatedAt:  Timestamp.now(),
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
          // schedulingNotes stored separately — never mixed with post-interview feedback
          updateData = { l1Status: 'Scheduled', l1ScheduledDate: payload.scheduledDate, l1TimeSlot: payload.timeSlot, l1SchedulingNotes: payload.schedulingNotes };
          historyData.status = 'Scheduled';
        } else if (action === 'select') {
          updateData = { l1Status: 'Selected', l1Feedback: payload.feedback, l2Status: 'Pending' };
          historyData.status = 'Selected';
        } else {
          updateData = { l1Status: 'Rejected', l1Feedback: payload.feedback, finalStatus: 'Rejected', l2Status: 'Locked', hrStatus: 'Locked', offerStatus: 'Locked' };
          historyData.status = 'Rejected';
        }
        break;

      case 'L2 Interview':
        if (action === 'schedule') {
          updateData = { l2Status: 'Scheduled', l2ScheduledDate: payload.scheduledDate, l2TimeSlot: payload.timeSlot, l2SchedulingNotes: payload.schedulingNotes };
          historyData.status = 'Scheduled';
        } else if (action === 'select') {
          updateData = { l2Status: 'Selected', l2Feedback: payload.feedback, hrStatus: 'Pending' };
          historyData.status = 'Selected';
        } else {
          updateData = { l2Status: 'Rejected', l2Feedback: payload.feedback, finalStatus: 'Rejected', hrStatus: 'Locked', offerStatus: 'Locked' };
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

    // ── Save to Firestore ──
    try {
      await updateDoc(doc(db, 'candidates', candidate.id), { ...updateData, lastUpdated: Timestamp.now() });
      await addDoc(collection(db, 'candidate_history'), historyData);
      console.log(`✅ Firestore updated — stage: ${stage}, action: ${action}`);
    } catch (error) {
      console.error('❌ Firestore update failed:', error);
      return;
    }

    // ── Determine if email is needed ──
    const needsEmail =
      (stage === 'L1 Interview' && ['schedule', 'select', 'reject'].includes(action)) ||
      (stage === 'L2 Interview' && ['schedule', 'select', 'reject'].includes(action)) ||
      (stage === 'HR Round'     && ['schedule', 'select', 'reject'].includes(action)) ||
      (stage === 'Offer Stage'  && ['release-offer', 'offer-accept', 'offer-reject'].includes(action));

    if (!needsEmail) return;

    if (!candidate.createdBy) {
      console.warn('⚠️ candidate.createdBy is missing');
      return;
    }

    const uploader = await getUploaderInfo(candidate.createdBy);
    if (!uploader.email || !uploader.email.includes('@')) {
      console.warn('⚠️ Uploader email invalid:', uploader.email);
      return;
    }

    const loggedInUserName = await getLoggedInUserName(user.uid);
    const interviewerName  =
      loggedInUserName     ||
      user.displayName     ||
      (role === 'hr' ? 'HR Team' : 'Panel Team');

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

    if (stage === 'L1 Interview') {
      if (action === 'schedule')
        await sendEmail({ ...base, label: 'L1 Scheduled', senderRole: 'panel', emailType: 'interview_scheduled', interviewDate: payload.scheduledDate, interviewTime: payload.timeSlot });
      else if (action === 'select')
        await sendEmail({ ...base, label: 'L1 Selected',  senderRole: 'panel', emailType: 'candidate_selected' });
      else
        await sendEmail({ ...base, label: 'L1 Rejected',  senderRole: 'panel', emailType: 'candidate_rejected' });
    }

    if (stage === 'L2 Interview') {
      if (action === 'schedule')
        await sendEmail({ ...base, label: 'L2 Scheduled', senderRole: 'panel', emailType: 'interview_scheduled', interviewDate: payload.scheduledDate, interviewTime: payload.timeSlot });
      else if (action === 'select')
        await sendEmail({ ...base, label: 'L2 Selected',  senderRole: 'panel', emailType: 'candidate_selected' });
      else
        await sendEmail({ ...base, label: 'L2 Rejected',  senderRole: 'panel', emailType: 'candidate_rejected' });
    }

    if (stage === 'HR Round') {
      if (action === 'schedule')
        await sendEmail({ ...base, label: 'HR Scheduled', senderRole: 'hr', emailType: 'interview_scheduled', interviewDate: payload.scheduledDate, interviewTime: payload.timeSlot });
      else if (action === 'select')
        await sendEmail({ ...base, label: 'HR Selected',  senderRole: 'hr', emailType: 'candidate_selected' });
      else
        await sendEmail({ ...base, label: 'HR Rejected',  senderRole: 'hr', emailType: 'candidate_rejected' });
    }

    if (stage === 'Offer Stage') {
      if (action === 'release-offer')
        await sendEmail({ ...base, label: 'Offer Released', senderRole: 'hr', emailType: 'offer_released' });
      else if (action === 'offer-accept')
        await sendEmail({ ...base, label: 'Offer Accepted', senderRole: 'hr', emailType: 'offer_accepted' });
      else
        await sendEmail({ ...base, label: 'Offer Rejected', senderRole: 'hr', emailType: 'offer_rejected' });
    }
  };

  // ─────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────
  if (loading) return (
    <div style={{ fontFamily: 'Segoe UI, system-ui', background: '#F5F6FA', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      Loading Candidate...
    </div>
  );

  if (!candidate) return (
    <div style={{ fontFamily: 'Segoe UI, system-ui', background: '#F5F6FA', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
    {
      title: 'Resume Review', status: resumeReviewStatus, isLocked: false,
      savedFeedback: candidate.resumeFeedback,
      onAction: (a, p) => handleAction('Resume Review', a, p),
      isResume: true, canUpdate: true, role,
    },
    {
      title: 'L1 Interview', status: l1Status, isLocked: lockedStates.l1,
      scheduledDate: candidate.l1ScheduledDate, timeSlot: candidate.l1TimeSlot,
      schedulingNotes: candidate.l1SchedulingNotes,   // ← separate field
      savedFeedback:   candidate.l1Feedback,           // ← post-interview only
      onAction: (a, p) => handleAction('L1 Interview', a, p),
      canUpdate: true, role,
    },
    {
      title: 'L2 Interview', status: l2Status, isLocked: lockedStates.l2,
      scheduledDate: candidate.l2ScheduledDate, timeSlot: candidate.l2TimeSlot,
      schedulingNotes: candidate.l2SchedulingNotes,
      savedFeedback:   candidate.l2Feedback,
      onAction: (a, p) => handleAction('L2 Interview', a, p),
      canUpdate: true, role,
    },
    {
      title: 'HR Round', status: hrStatus, isLocked: lockedStates.hr,
      scheduledDate: candidate.hrScheduledDate, timeSlot: candidate.hrTimeSlot,
      schedulingNotes: candidate.hrSchedulingNotes,
      savedFeedback:   candidate.hrFeedback,
      onAction: (a, p) => handleAction('HR Round', a, p),
      canUpdate: true, role,
    },
    {
      title: 'Offer Stage', status: offerStatus, isLocked: lockedStates.offer,
      savedFeedback: candidate.offerFeedback,
      onAction: (a, p) => handleAction('Offer Stage', a, p),
      isOffer: true, canUpdate: true, role,
    },
  ];

  return (
    <div style={{ fontFamily: 'Segoe UI, system-ui', background: '#F5F6FA', padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', fontSize: '14px', cursor: 'pointer' }}>
          ← Back to History
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '30% 70%', gap: '24px' }}>

        {/* ── LEFT COLUMN ── */}
        <div className="space-y-6">
          <div style={{ background: 'white', borderRadius: '12px', padding: '20px', textAlign: 'center' }}>
            <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: '#EDE9FE', margin: '0 auto 12px' }} />
            <h2 style={{ fontWeight: 'bold' }}>{candidate.candidateName}</h2>
            <p style={{ color: 'gray', fontSize: '14px' }}>{candidate.candidateDesignation}</p>
            <div style={{ marginTop: '10px' }}><Badge>In Progress</Badge></div>
          </div>

          <div style={{ background: 'white', borderRadius: '12px', padding: '20px' }}>
            <p style={{ fontWeight: 'bold', marginBottom: '8px' }}>AI Match Summary (Based on Resume)</p>
            <Badge style={{
              background: (candidate.matchScore ?? 0) > 60 ? '#DCFCE7' : '#FEE2E2',
              color:      (candidate.matchScore ?? 0) > 60 ? '#16A34A' : '#DC2626',
            }}>
              {(candidate.matchScore ?? 0) > 60 ? 'Matched' : 'Not Matched'}
            </Badge>
            <p style={{ marginTop: '10px', fontWeight: 'bold' }}>Match Score: {candidate.matchScore ?? 0}%</p>
            <p style={{ marginTop: '10px', fontSize: '13px', color: 'gray' }}>
              {candidate.matchSummary
                ? candidate.matchSummary
                : candidate.matchScore === undefined
                  ? 'This candidate has not been evaluated yet. Please run the AI match to get a score and reason.'
                  : candidate.matchScore === 0
                    ? "Match score is 0% — the candidate's resume does not meet the required skills, experience level, or domain knowledge for this role. Key qualifications are missing or insufficient."
                    : candidate.matchScore <= 40
                      ? 'Low match (below 40%). The candidate meets only a few required qualifications. Significant gaps exist in skills or experience.'
                      : candidate.matchScore <= 60
                        ? 'Partial match (41–60%). The candidate meets some requirements but does not fully qualify. Further evaluation is recommended.'
                        : candidate.matchScore <= 80
                          ? 'Good match (61–80%). The candidate meets most required qualifications with minor gaps.'
                          : 'Strong match (above 80%). The candidate is highly qualified and closely aligns with the role requirements.'
              }
            </p>
          </div>

          <div style={{ background: 'white', borderRadius: '12px', padding: '20px', textAlign: 'center' }}>
            {candidate.resumeFile?.data ? (
              <Button variant="outline" onClick={() => {
                const bytes = atob(candidate.resumeFile.data);
                const arr = new Uint8Array(bytes.length).map((_, i) => bytes.charCodeAt(i));
                window.open(URL.createObjectURL(new Blob([arr], { type: 'application/pdf' })), '_blank');
              }}>
                View Resume
              </Button>
            ) : (
              <p style={{ color: 'gray', fontSize: '13px' }}>No resume uploaded</p>
            )}
          </div>
        </div>

        {/* ── RIGHT COLUMN ── */}
        <div className="space-y-6">
          <div style={{ background: 'white', borderRadius: '12px', padding: '20px' }}>
            <h2 style={{ fontWeight: 'bold', marginBottom: '6px' }}>Interview Workflow</h2>
            <p style={{ fontSize: '13px', color: 'gray', marginBottom: '16px' }}>Manage active round. Save details to advance.</p>
            <div className="space-y-4">
              {stageDefs.map((stage) => <StageCard key={stage.title} {...stage} />)}
            </div>
          </div>

          <div style={{ background: 'white', borderRadius: '12px', padding: '20px' }}>
            <h2 style={{ fontWeight: 'bold', marginBottom: '16px' }}>Professional Background</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div><p style={{ color: 'gray', fontSize: '12px' }}>Full Name</p><p style={{ fontWeight: 'bold' }}>{candidate.candidateName}</p></div>
              <div><p style={{ color: 'gray', fontSize: '12px' }}>Email</p><p style={{ fontWeight: 'bold', wordBreak: 'break-all' }}>{candidate.candidateEmail}</p></div>
              <div><p style={{ color: 'gray', fontSize: '12px' }}>Phone</p><p style={{ fontWeight: 'bold' }}>{candidate.candidatePhone || candidate.phone || '—'}</p></div>
              <div><p style={{ color: 'gray', fontSize: '12px' }}>Experience</p><p style={{ fontWeight: 'bold' }}>{candidate.experience} Years</p></div>
              <div><p style={{ color: 'gray', fontSize: '12px' }}>Current CTC</p><p style={{ fontWeight: 'bold' }}>{candidate.currentCtc}</p></div>
              <div><p style={{ color: 'gray', fontSize: '12px' }}>Expected CTC</p><p style={{ fontWeight: 'bold' }}>{candidate.expectedCtc}</p></div>
              <div><p style={{ color: 'gray', fontSize: '12px' }}>Notice Period</p><p style={{ fontWeight: 'bold' }}>{candidate.noticePeriod}</p></div>
              <div>
                <p style={{ color: 'gray', fontSize: '12px' }}>Comfortable Onsite?</p>
                <Badge style={{ background: '#6C63FF', color: 'white' }}>{candidate.isComfortableOnsite}</Badge>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}