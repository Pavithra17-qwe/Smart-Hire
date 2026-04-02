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

interface ProposeTimeProps {
  onPropose: (date: string, slot: string) => void;
}

interface StageCardProps {
  title: string;
  status: Status;
  isLocked: boolean;
  scheduledDate?: string;
  timeSlot?: string;
  savedFeedback?: string;
  onAction: (action: string, payload: any) => void;
  isResume?: boolean;
  isOffer?: boolean;
  canUpdate: boolean;
  role: string | null;
}

// ─────────────────────────────────────────────
// HELPER: fetch creator's email from users collection
// users/{uid} → email field
// ─────────────────────────────────────────────
async function getCreatorEmail(createdBy: string): Promise<string | null> {
  try {
    const userSnap = await getDoc(doc(db, 'users', createdBy));
    if (userSnap.exists()) {
      const email = userSnap.data().email || null;
      if (!email) console.warn('⚠️ users doc found but email field is empty for UID:', createdBy);
      return email;
    }
    console.warn('⚠️ No users doc found for UID:', createdBy);
    return null;
  } catch (err) {
    console.error('❌ Failed to fetch creator email:', err);
    return null;
  }
}

// ─────────────────────────────────────────────
// HELPER: send email with logging
// ─────────────────────────────────────────────
async function sendEmail(params: {
  toEmail: string;
  candidateName: string;
  jobRole: string;
  interviewerName: string;
  interviewDate?: string;
  interviewTime?: string;
  interviewLink?: string;
  label: string;
  senderRole?: 'panel' | 'hr' | 'system';
  emailType?: 'interview_scheduled' | 'candidate_selected' | 'candidate_rejected' | 'offer_released' | 'offer_accepted' | 'offer_rejected';
}) {
  const { toEmail, label, candidateName, jobRole, interviewerName, interviewDate, interviewTime, interviewLink, senderRole, emailType } = params;
  console.log(`📧 Sending [${label}] email to: ${toEmail}`);
  try {
    await sendInterviewEmail({
      candidateName,
      candidateEmail: toEmail,
      jobRole,
      interviewerName,
      interviewDate: interviewDate || '',
      interviewTime: interviewTime || '',
      interviewLink: interviewLink || '',
      senderRole,
      emailType,
    });
    console.log(`✅ [${label}] email sent to: ${toEmail}`);
  } catch (err) {
    console.error(`❌ [${label}] email FAILED to: ${toEmail}`, err);
  }
}

// ─────────────────────────────────────────────
// ProposeTime Sub-component
// ─────────────────────────────────────────────
const ProposeTime: React.FC<ProposeTimeProps> = ({ onPropose }) => {
  const [date, setDate] = useState('');
  const [slot, setSlot] = useState('');
  const today = new Date().toISOString().split('T')[0];

  const handlePropose = () => {
    if (!date || !slot) { alert('Please pick a date and time slot.'); return; }
    onPropose(date, slot);
  };

  const timeSlots = [
    '09:00am - 10:00am', '10:00am - 11:00am', '11:00am - 12:00pm',
    '01:00pm - 02:00pm', '02:00pm - 03:00pm', '03:00pm - 04:00pm', '04:00pm - 05:00pm',
  ];

  return (
    <div style={{ background: '#F9FAFB', borderRadius: '10px', padding: '14px' }}>
      <p style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '12px' }}>Propose Interview Time</p>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        <div style={{ position: 'relative' }}>
          <Calendar className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="pl-10" style={{ background: 'white', borderRadius: '8px' }} min={today} />
        </div>
        <select value={slot} onChange={(e) => setSlot(e.target.value)}
          style={{ borderRadius: '8px', border: '1px solid #E5E7EB', padding: '9px', background: 'white', flex: 1 }}>
          <option value="">Select a slot</option>
          {timeSlots.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Button onClick={handlePropose} style={{ background: '#7C3AED', color: 'white', fontWeight: 'bold' }}>Propose</Button>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
// StageCard Sub-component
// ─────────────────────────────────────────────
const StageCard: React.FC<StageCardProps> = ({
  title, status, isLocked, scheduledDate, timeSlot,
  savedFeedback, onAction, isResume = false, isOffer = false, canUpdate, role,
}) => {
  const [feedback, setFeedback] = useState('');
  const postFeedbackRef = useRef<HTMLTextAreaElement>(null);
  const normalized = normalizeStatus(status);
  const isActive = !isLocked && ['Pending', 'Scheduled', 'Released'].includes(normalized.name);

  const cardStyle = {
    borderRadius: '12px',
    border: `1.5px solid ${isActive ? '#7C3AED' : '#E5E7EB'}`,
    boxShadow: isActive ? '0 2px 10px rgba(124,58,237,0.08)' : 'none',
    background: 'white',
  };

  const canPerformAction = () => {
    if (!canUpdate) return false;
    if (role === 'admin' || role === 'agency') return false;
    if (role === 'panel' && (title === 'HR Round' || title === 'Offer Stage')) return false;
    if (role === 'hr' && (title === 'Resume Review' || title === 'L1 Interview' || title === 'L2 Interview')) return false;
    return true;
  };

  return (
    <div style={cardStyle}>
      <div style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontWeight: 'bold', fontSize: '15px', margin: 0 }}>{title}</h3>
        <Badge className={normalized.color}>{normalized.name}</Badge>
      </div>
      <div style={{ padding: '0 16px 16px 16px' }}>
        {isLocked ? (
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <Lock className="h-4 w-4" />
            <p>Complete the previous stage to unlock this step.</p>
          </div>
        ) : (
          <div className="space-y-4">

            {/* ── Resume Review ── */}
            {isResume && (
              <>
                {(normalized.name === 'Accepted' || normalized.name === 'Rejected') && (
                  <p className={`text-sm ${normalized.name === 'Rejected' ? 'text-red-600' : 'text-gray-600'}`}>
                    {savedFeedback || 'No feedback provided.'}
                  </p>
                )}
                {canPerformAction() && normalized.name === 'Pending' && (
                  <>
                    <Textarea placeholder="Enter feedback (optional)..." value={feedback} onChange={(e) => setFeedback(e.target.value)} />
                    <div className="flex justify-end gap-2">
                      <Button variant="destructive" onClick={() => onAction('reject', { feedback })}>✕ Reject</Button>
                      <Button variant="default" onClick={() => onAction('accept', { feedback })}>✓ Accept</Button>
                    </div>
                  </>
                )}
              </>
            )}

            {/* ── L1 / L2 / HR Interview Stages ── */}
            {!isResume && !isOffer && (
              <>
                {(normalized.name === 'Scheduled' || normalized.name === 'Selected' || normalized.name === 'Rejected') && scheduledDate && (
                  <p className="text-sm font-semibold">
                    Scheduled on: {new Date(scheduledDate).toLocaleDateString()} at {timeSlot}
                  </p>
                )}
                {(normalized.name === 'Selected' || normalized.name === 'Rejected') && (
                  <p className={`text-sm mt-2 ${normalized.name === 'Rejected' ? 'text-red-600' : 'text-gray-600'}`}>
                    {savedFeedback || 'No feedback provided.'}
                  </p>
                )}
                {canPerformAction() && (
                  <>
                    {normalized.name === 'Pending' && (
                      <ProposeTime onPropose={(date, slot) => onAction('schedule', { scheduledDate: date, timeSlot: slot })} />
                    )}
                    {normalized.name === 'Scheduled' && (
                      <>
                        <Textarea placeholder="Enter interview feedback..." ref={postFeedbackRef} />
                        <div className="flex justify-end gap-2">
                          <Button variant="destructive" onClick={() => onAction('reject', { feedback: postFeedbackRef.current?.value || '' })}>✕ Reject</Button>
                          <Button variant="default" onClick={() => onAction('select', { feedback: postFeedbackRef.current?.value || '' })}>✓ Select</Button>
                        </div>
                      </>
                    )}
                  </>
                )}
              </>
            )}

            {/* ── Offer Stage ── */}
            {isOffer && (
              <>
                {normalized.name === 'Released' && (
                  <p className="text-sm font-semibold text-blue-600">📨 Offer has been released</p>
                )}
                {(normalized.name === 'Accepted' || normalized.name === 'Rejected') && savedFeedback && (
                  <p className={`text-sm font-semibold ${normalized.name === 'Accepted' ? 'text-green-600' : 'text-red-600'}`}>
                    {normalized.name === 'Accepted' ? '🎉 Candidate accepted the offer. ' : 'Candidate rejected the offer. '}
                    {savedFeedback}
                  </p>
                )}
                {canPerformAction() && (
                  <>
                    {normalized.name === 'Pending' && (
                      <div className="flex justify-end">
                        <Button onClick={() => onAction('release-offer', {})} style={{ background: '#7C3AED', color: 'white' }}>
                          📨 Release Offer
                        </Button>
                      </div>
                    )}
                    {normalized.name === 'Released' && (
                      <>
                        <Textarea placeholder="Enter feedback..." ref={postFeedbackRef} />
                        <div className="flex justify-end gap-2">
                          <Button variant="destructive" onClick={() => onAction('offer-reject', { feedback: postFeedbackRef.current?.value || '' })}>✕ Mark Rejected</Button>
                          <Button variant="default" onClick={() => onAction('offer-accept', { feedback: postFeedbackRef.current?.value || '' })}>✓ Mark Accepted</Button>
                        </div>
                      </>
                    )}
                  </>
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
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const { role, user } = useAuth();

  useEffect(() => {
    if (!candidateId) return;
    const unsub = onSnapshot(doc(db, 'candidates', candidateId), (snapshot) => {
      if (snapshot.exists()) {
        setCandidate({ id: snapshot.id, ...snapshot.data() } as Candidate);
      } else {
        console.warn('No candidate found for ID:', candidateId);
        setCandidate(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [candidateId]);

  // ─────────────────────────────────────────────
  // EMAIL RULES:
  //   Resume Review  → accept / reject       → ❌ no email
  //   L1 Interview   → schedule              → ✅ email to createdBy
  //   L1 Interview   → select / reject       → ✅ email to createdBy
  //   L2 Interview   → schedule              → ✅ email to createdBy
  //   L2 Interview   → select / reject       → ✅ email to createdBy
  //   HR Round       → schedule (propose)    → ✅ email to createdBy
  //   HR Round       → select / reject       → ❌ no email
  //   Offer Stage    → release-offer         → ✅ email to createdBy
  //   Offer Stage    → offer-accept          → ✅ email to createdBy
  //   Offer Stage    → offer-reject          → ✅ email to createdBy
  // ─────────────────────────────────────────────
  const handleAction = async (stage: string, action: string, payload: any) => {
    if (!candidate || !user) return;

    let updateData: Partial<Candidate> = {};
    const historyData: any = {
      candidateId,
      stage,
      status: '',
      feedback: payload.feedback || '',
      scheduledDate: payload.scheduledDate || null,
      timeSlot: payload.timeSlot || null,
      updatedBy: user.uid,
      updatedAt: Timestamp.now(),
    };

    switch (stage) {
      case 'Resume Review':
        if (action === 'accept') {
          updateData = { resumeReviewStatus: 'Accepted', l1Status: 'Pending' };
          historyData.status = 'Accepted';
        } else {
          updateData = { resumeReviewStatus: 'Rejected', finalStatus: 'Rejected', l1Status: 'Locked', l2Status: 'Locked', hrStatus: 'Locked', offerStatus: 'Locked' };
          historyData.status = 'Rejected';
        }
        break;

      case 'L1 Interview':
        if (action === 'schedule') {
          updateData = { l1Status: 'Scheduled', l1ScheduledDate: payload.scheduledDate, l1TimeSlot: payload.timeSlot };
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
          updateData = { l2Status: 'Scheduled', l2ScheduledDate: payload.scheduledDate, l2TimeSlot: payload.timeSlot };
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
          updateData = { hrStatus: 'Scheduled', hrScheduledDate: payload.scheduledDate, hrTimeSlot: payload.timeSlot };
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

    // ── Step 1: Save to Firestore ──
    try {
      await updateDoc(doc(db, 'candidates', candidate.id), { ...updateData, lastUpdated: Timestamp.now() });
      await addDoc(collection(db, 'candidate_history'), historyData);
      console.log(`✅ Firestore updated — stage: ${stage}, action: ${action}`);
    } catch (error) {
      console.error('❌ Firestore update failed:', error);
      return; // do not send email if DB failed
    }

    // ── Step 2: Determine if email is needed ──
    const needsEmail =
      (stage === 'L1 Interview' && ['schedule', 'select', 'reject'].includes(action)) ||
      (stage === 'L2 Interview' && ['schedule', 'select', 'reject'].includes(action)) ||
      (stage === 'HR Round'     && action === 'schedule') ||
      (stage === 'Offer Stage'  && ['release-offer', 'offer-accept', 'offer-reject'].includes(action));

    if (!needsEmail) return;

    // ── Step 3: Resolve creator's email from users collection ──
    if (!candidate.createdBy) {
      console.warn('⚠️ candidate.createdBy is missing — cannot resolve email');
      return;
    }

    const creatorEmail = await getCreatorEmail(candidate.createdBy);
    if (!creatorEmail) {
      console.warn('⚠️ Creator email could not be resolved — email not sent');
      return;
    }

    const base = {
      toEmail: creatorEmail,
      candidateName: candidate.candidateName || 'Candidate',
      jobRole: candidate.candidateDesignation || 'Not specified',
      interviewerName: user.displayName || user.email || 'Hiring Team',
      interviewLink: 'https://meet.google.com/your-link',
      senderEmail: user.email || undefined,
    };

    // ── Step 4: Send the right email per stage + action ──
    // From name will show:
    //   L1/L2 → "SmartHire (Panel)"
    //   HR Round / Offer Stage → "SmartHire (HR)"

    if (stage === 'L1 Interview') {
      if (action === 'schedule') {
        await sendEmail({ ...base, label: 'L1 Scheduled', senderRole: 'panel', emailType: 'interview_scheduled', interviewDate: payload.scheduledDate, interviewTime: payload.timeSlot });
      } else if (action === 'select') {
        await sendEmail({ ...base, label: 'L1 Selected', senderRole: 'panel', emailType: 'candidate_selected' });
      } else if (action === 'reject') {
        await sendEmail({ ...base, label: 'L1 Rejected', senderRole: 'panel', emailType: 'candidate_rejected' });
      }
    }

    if (stage === 'L2 Interview') {
      if (action === 'schedule') {
        await sendEmail({ ...base, label: 'L2 Scheduled', senderRole: 'panel', emailType: 'interview_scheduled', interviewDate: payload.scheduledDate, interviewTime: payload.timeSlot });
      } else if (action === 'select') {
        await sendEmail({ ...base, label: 'L2 Selected', senderRole: 'panel', emailType: 'candidate_selected' });
      } else if (action === 'reject') {
        await sendEmail({ ...base, label: 'L2 Rejected', senderRole: 'panel', emailType: 'candidate_rejected' });
      }
    }

    if (stage === 'HR Round' && action === 'schedule') {
      await sendEmail({ ...base, label: 'HR Scheduled', senderRole: 'hr', emailType: 'interview_scheduled', interviewDate: payload.scheduledDate, interviewTime: payload.timeSlot });
    }

    if (stage === 'Offer Stage') {
      if (action === 'release-offer') {
        await sendEmail({ ...base, label: 'Offer Released', senderRole: 'hr', emailType: 'offer_released' });
      } else if (action === 'offer-accept') {
        await sendEmail({ ...base, label: 'Offer Accepted', senderRole: 'hr', emailType: 'offer_accepted' });
      } else if (action === 'offer-reject') {
        await sendEmail({ ...base, label: 'Offer Rejected', senderRole: 'hr', emailType: 'offer_rejected' });
      }
    }

  }; // ← handleAction ends here ✅

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
    { title: 'Resume Review', status: resumeReviewStatus, isLocked: false, savedFeedback: candidate.resumeFeedback, onAction: (a, p) => handleAction('Resume Review', a, p), isResume: true, canUpdate: true, role },
    { title: 'L1 Interview',  status: l1Status,  isLocked: lockedStates.l1,  scheduledDate: candidate.l1ScheduledDate, timeSlot: candidate.l1TimeSlot, savedFeedback: candidate.l1Feedback, onAction: (a, p) => handleAction('L1 Interview', a, p),  canUpdate: true, role },
    { title: 'L2 Interview',  status: l2Status,  isLocked: lockedStates.l2,  scheduledDate: candidate.l2ScheduledDate, timeSlot: candidate.l2TimeSlot, savedFeedback: candidate.l2Feedback, onAction: (a, p) => handleAction('L2 Interview', a, p),  canUpdate: true, role },
    { title: 'HR Round',      status: hrStatus,  isLocked: lockedStates.hr,  scheduledDate: candidate.hrScheduledDate, timeSlot: candidate.hrTimeSlot, savedFeedback: candidate.hrFeedback, onAction: (a, p) => handleAction('HR Round', a, p),      canUpdate: true, role },
    { title: 'Offer Stage',   status: offerStatus, isLocked: lockedStates.offer, savedFeedback: candidate.offerFeedback, onAction: (a, p) => handleAction('Offer Stage', a, p), isOffer: true, canUpdate: true, role },
  ];

  return (
    <div style={{ fontFamily: 'Segoe UI, system-ui', background: '#F5F6FA', padding: '24px' }}>

      {/* Top Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', fontSize: '14px', cursor: 'pointer' }}>
          ← Back to History
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '30% 70%', gap: '24px' }}>

        {/* ── LEFT COLUMN ── */}
        <div className="space-y-6">

          {/* Candidate Card */}
          <div style={{ background: 'white', borderRadius: '12px', padding: '20px', textAlign: 'center' }}>
            <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: '#EDE9FE', margin: '0 auto 12px' }} />
            <h2 style={{ fontWeight: 'bold' }}>{candidate.candidateName}</h2>
            <p style={{ color: 'gray', fontSize: '14px' }}>{candidate.candidateDesignation}</p>
            <div style={{ marginTop: '10px' }}><Badge>In Progress</Badge></div>
          </div>

          {/* AI Match Summary */}
          <div style={{ background: 'white', borderRadius: '12px', padding: '20px' }}>
            <p style={{ fontWeight: 'bold', marginBottom: '8px' }}>AI Match Summary (Based on Resume)</p>
            <Badge style={{
              background: (candidate.matchScore ?? 0) > 60 ? '#DCFCE7' : '#FEE2E2',
              color: (candidate.matchScore ?? 0) > 60 ? '#16A34A' : '#DC2626',
            }}>
              {(candidate.matchScore ?? 0) > 60 ? 'Matched' : 'Not Matched'}
            </Badge>
            <p style={{ marginTop: '10px', fontWeight: 'bold' }}>Match Score: {candidate.matchScore ?? 0}%</p>
            <p style={{ marginTop: '10px', fontSize: '13px', color: 'gray' }}>
              {candidate.matchSummary ?? (
                candidate.matchScore === undefined ? 'Candidate has not been evaluated yet.'
                : candidate.matchScore === 0 ? 'Candidate is not matched because required skills, experience, or domain knowledge are missing or not evaluated.'
                : candidate.matchScore > 60 ? 'Candidate is a strong match based on skills, experience, and job requirements.'
                : 'Candidate partially matches but does not meet all key requirements.'
              )}
            </p>
          </div>

          {/* Resume */}
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

          {/* Interview Workflow */}
          <div style={{ background: 'white', borderRadius: '12px', padding: '20px' }}>
            <h2 style={{ fontWeight: 'bold', marginBottom: '6px' }}>Interview Workflow</h2>
            <p style={{ fontSize: '13px', color: 'gray', marginBottom: '16px' }}>Manage active round. Save details to advance.</p>
            <div className="space-y-4">
              {stageDefs.map((stage) => <StageCard key={stage.title} {...stage} />)}
            </div>
          </div>

          {/* Professional Background */}
          <div style={{ background: 'white', borderRadius: '12px', padding: '20px' }}>
            <h2 style={{ fontWeight: 'bold', marginBottom: '16px' }}>Professional Background</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div><p style={{ color: 'gray', fontSize: '12px' }}>Full Name</p><p style={{ fontWeight: 'bold' }}>{candidate.candidateName}</p></div>
              <div><p style={{ color: 'gray', fontSize: '12px' }}>Email</p><p style={{ fontWeight: 'bold' }}>{candidate.candidateEmail}</p></div>
              <div><p style={{ color: 'gray', fontSize: '12px' }}>Phone</p><p style={{ fontWeight: 'bold' }}>{candidate.candidatePhone}</p></div>
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