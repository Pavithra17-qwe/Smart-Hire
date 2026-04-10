'use client';

/**
 * ============================================================
 * EMAIL THREADING — HOW IT WORKS
 * ============================================================
 *
 * Instead of sending 7-8 separate emails, every update for a
 * candidate now arrives as a REPLY in the same email thread.
 *
 * HOW:
 *   1. First email ever sent for a candidate (e.g. Resume Accepted)
 *      → nodemailer sends it normally and returns a `messageId`.
 *      → We save that messageId to Firestore:
 *            candidates/{id}.emailThreadMessageId
 *
 *   2. Every email after that reads `emailThreadMessageId` from
 *      the fresh candidate doc and passes it to sendInterviewEmail
 *      as `threadMessageId`.
 *
 *   3. The flow adds nodemailer headers:
 *            In-Reply-To:  <original messageId>
 *            References:   <original messageId>
 *      Gmail, Outlook, and Apple Mail all use these to show the
 *      email as a reply in the existing conversation.
 *
 *   4. Subject is always identical:
 *            "Candidate Update – John Doe (Frontend Developer)"
 *      so clients group by subject + headers together.
 *
 * RESULT: Recipients see ONE conversation with replies like:
 *   ┌─ Candidate Update – John Doe (Frontend Developer)
 *   │   Mail 1 → Resume Accepted
 *   │   Mail 2 → L1 Interview Scheduled
 *   │   Mail 3 → L1 Cleared → Selected
 *   │   Mail 4 → L2 Scheduled
 *   └─  ...
 *
 * ============================================================
 * EMAIL BUG FIXES (from previous version) — still in place
 * ============================================================
 *
 * BUG 1 — Uploader never got mail
 *   FIX: fallback to candidate.createdByEmail if user doc missing.
 *
 * BUG 2 — Panel not receiving mail when HR schedules L1/L2
 *   FIX: panelUsers fetch tries email, emailAddress, userEmail, mail.
 *
 * BUG 3 — Panel feedback submitted: nobody received mail
 *   FIX: 3-level fallback for HR email:
 *     1. resumeReviewedByEmail
 *     2. l1InterviewerEmail / l2InterviewerEmail
 *     3. Skip with warning
 *
 * BUG 4 — HR self-confirm not sent when HR = uploader
 *   FIX: actorEmail falls back to user.providerData[0]?.email.
 *
 * ============================================================
 */

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  doc, onSnapshot, updateDoc, addDoc, getDoc, getDocs,
  collection, Timestamp, query, where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Calendar, Lock, TrendingUp, TrendingDown, Minus, AlertCircle, Eye } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Candidate } from '@/types/candidate';
import { normalizeStatus } from '@/lib/normalizeStatus';
import { sendInterviewEmail } from '@/ai/flows/send-interview-email-flow';


// ─── TYPES ────────────────────────────────────────────────────────────────────
type EmailType =
  | 'resume_accepted'
  | 'resume_rejected'
  | 'interview_scheduled'
  | 'candidate_selected'
  | 'candidate_rejected'
  | 'offer_released'
  | 'offer_accepted'
  | 'offer_rejected'
  | 'panel_assigned'
  | 'panel_feedback_submitted';

type CandidateHistoryItem = {
  stage: string;
  updatedByName: string;
  updatedByRole: string;
  action?: string;
};

type Status =
  | 'Pending' | 'Accepted' | 'Rejected' | 'Scheduled'
  | 'Selected' | 'Offer Sent' | 'Joined' | 'In Progress'
  | 'Locked' | 'Released';

type UserRole = 'admin' | 'hr' | 'agency' | 'panel';

interface PanelUser {
  uid: string;
  name: string;
  email: string;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

async function getUserInfo(uid: string): Promise<{ email: string | null; name: string | null }> {
  if (!uid) return { email: null, name: null };
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) {
      const d = snap.data();
      const email = d.email || d.emailAddress || d.userEmail || d.mail || null;
      const name  = d.displayName || d.name || d.fullName || null;
      if (!email) {
        console.error(
          `[getUserInfo] ❌ User UID "${uid}" has NO email field in Firestore.`,
          '\nDocument data:', d,
          '\nFIX: Open Firebase console → users collection → this document → add an "email" field.'
        );
      }
      return { email, name };
    } else {
      console.error(`[getUserInfo] ❌ No user document found for UID "${uid}" in Firestore users collection.`);
    }
  } catch (err) {
    console.error('[getUserInfo] Firestore read error:', err);
  }
  return { email: null, name: null };
}

async function getFreshCandidate(candidateId: string): Promise<Record<string, any> | null> {
  if (!candidateId) return null;
  try {
    const snap = await getDoc(doc(db, 'candidates', candidateId));
    if (snap.exists()) return { id: snap.id, ...snap.data() };
    console.error(`[getFreshCandidate] ❌ No candidate found for id "${candidateId}"`);
  } catch (err) {
    console.error('[getFreshCandidate] Firestore read error:', err);
  }
  return null;
}

/**
 * Sends a single email.
 * Now accepts candidateId and threadMessageId for threading support.
 */
async function sendEmail(params: {
  toEmail: string;
  candidateName: string;
  jobRole: string;
  interviewerName: string;
  interviewerEmail: string;
  experience: string;
  location: string;
  stage: string;
  schedulingNotes: string;
  interviewFeedback: string;
  interviewDate: string;
  interviewTime: string;
  senderRole: string;
  emailType: string;
  // ── THREADING ──────────────────────────────────────────────
  candidateId:     string;   // Firestore candidate doc ID
  threadMessageId: string;   // messageId of first email — '' if not yet sent
}) {
  const email = params.toEmail?.trim();
  if (!email || !email.includes('@')) {
    console.warn('[sendEmail] ⚠️  Skipping — invalid toEmail:', params.toEmail);
    return;
  }
  console.log(
    '[sendEmail] → Sending to:', email,
    '| type:', params.emailType,
    '| stage:', params.stage,
    '| thread:', params.threadMessageId || '(first email)',
  );
  try {
    await sendInterviewEmail({
      candidateName:     params.candidateName,
      candidateEmail:    email,
      jobRole:           params.jobRole,
      experience:        params.experience,
      location:          params.location,
      interviewerName:   params.interviewerName,
      interviewerEmail:  params.interviewerEmail,
      interviewDate:     params.interviewDate,
      interviewTime:     params.interviewTime,
      schedulingNotes:   params.schedulingNotes,
      interviewFeedback: params.interviewFeedback,
      stage:             params.stage,
      senderRole:        params.senderRole as 'panel' | 'hr' | 'system',
      emailType:         params.emailType as EmailType,
      // ── THREADING ────────────────────────────────────────
      candidateId:      params.candidateId,
      threadMessageId:  params.threadMessageId,
    });
    console.log('[sendEmail] ✅ Sent to:', email);
  } catch (err) {
    console.error('[sendEmail] ❌ Failed for', email, err);
  }
}

// ─── AI SCORE DISPLAY HELPER ─────────────────────────────────────────────────
function getScoreDisplay(score: number | undefined | null): {
  color: string; bg: string; border: string; label: string; icon: React.ReactNode; textColor: string;
} {
  const s = typeof score === 'number' ? score : -1;
  if (s < 0)   return { color: '#6B7280', bg: '#F3F4F6', border: '#E5E7EB', label: 'Not Evaluated',  icon: <Minus className="h-4 w-4" />,        textColor: '#374151' };
  if (s === 0) return { color: '#DC2626', bg: '#FEF2F2', border: '#FECACA', label: 'No Match',        icon: <TrendingDown className="h-4 w-4" />, textColor: '#991B1B' };
  if (s <= 30) return { color: '#DC2626', bg: '#FEF2F2', border: '#FECACA', label: 'Very Low Match',  icon: <TrendingDown className="h-4 w-4" />, textColor: '#991B1B' };
  if (s <= 50) return { color: '#D97706', bg: '#FFFBEB', border: '#FDE68A', label: 'Below Average',   icon: <TrendingDown className="h-4 w-4" />, textColor: '#92400E' };
  if (s <= 65) return { color: '#F59E0B', bg: '#FEF3C7', border: '#FCD34D', label: 'Moderate Match',  icon: <Minus className="h-4 w-4" />,        textColor: '#78350F' };
  if (s <= 80) return { color: '#16A34A', bg: '#F0FDF4', border: '#86EFAC', label: 'Good Match',      icon: <TrendingUp className="h-4 w-4" />,   textColor: '#14532D' };
  return              { color: '#059669', bg: '#ECFDF5', border: '#6EE7B7', label: 'Strong Match',    icon: <TrendingUp className="h-4 w-4" />,   textColor: '#064E3B' };
}

function buildFallbackSummary(score: number | undefined | null, candidate: Candidate): string {
  const s = typeof score === 'number' ? score : -1;
  if (s < 0)   return "This candidate has not been evaluated yet. Go to Candidate Evaluation and re-submit to generate an AI match score.";
  if (s === 0) return "Score: 0% — The resume could not be matched against the Job Description. Possible reasons:\n\n• The resume file may be unreadable or encrypted.\n• The resume content does not relate to the job requirements.\n• The JD file was not available at the time of submission.\n\nPlease verify the uploaded resume and re-evaluate if needed.";
  if (s <= 30) return `Score: ${s}% — Very low match.\n\nThe candidate's profile has significant gaps compared to the job requirements.`;
  if (s <= 50) return `Score: ${s}% — Below average match.\n\nThe candidate meets only a few of the required qualifications.`;
  if (s <= 65) return `Score: ${s}% — Moderate match.\n\nThe candidate meets some key criteria but does not fully align with all job requirements.`;
  if (s <= 80) return `Score: ${s}% — Good match.\n\nThe candidate meets most of the required qualifications with only minor gaps.`;
  return `Score: ${s}% — Strong match.\n\nThe candidate closely aligns with the role requirements. Highly recommended for the next stage.`;
}

// ─── AI MATCH CARD ────────────────────────────────────────────────────────────
const AIMatchCard: React.FC<{ candidate: Candidate }> = ({ candidate }) => {
  const rawScore      = candidate.matchScore ?? candidate.aiScore;
  const score         = typeof rawScore === 'number' ? rawScore : undefined;
  const display       = getScoreDisplay(score);
  const storedSummary = candidate.matchSummary || "";
  const summary       = storedSummary.trim().length > 30 ? storedSummary : buildFallbackSummary(score, candidate);
  const scoreLabel    = score !== undefined ? `${score}%` : '—';

  return (
    <div style={{ background: 'white', borderRadius: '12px', padding: '20px', border: `1.5px solid ${display.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <p style={{ fontWeight: 'bold', fontSize: '14px', color: '#111827', margin: 0 }}>🤖 AI Match Analysis</p>
        <span style={{ fontSize: '11px', fontWeight: '600', color: display.color, background: display.bg, border: `1px solid ${display.border}`, padding: '2px 8px', borderRadius: '999px' }}>
          {display.label}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', background: display.bg, border: `1px solid ${display.border}`, borderRadius: '10px', padding: '12px 16px', marginBottom: '14px' }}>
        <div style={{ width: '64px', height: '64px', borderRadius: '50%', border: `4px solid ${display.color}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: 'white' }}>
          <span style={{ fontSize: score !== undefined ? '18px' : '20px', fontWeight: '900', color: display.color, lineHeight: 1 }}>{scoreLabel}</span>
          {score !== undefined && <span style={{ fontSize: '9px', color: display.color, fontWeight: '600', opacity: 0.8 }}>score</span>}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', color: display.textColor }}>
            {display.icon}
            <span style={{ fontWeight: '700', fontSize: '14px' }}>{display.label}</span>
          </div>
          {score !== undefined && (
            <div style={{ height: '8px', background: '#E5E7EB', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${score}%`, background: display.color, borderRadius: '4px', transition: 'width 0.5s ease' }} />
            </div>
          )}
          <p style={{ fontSize: '11px', color: '#6B7280', marginTop: '4px' }}>
            {score === undefined ? 'Not yet evaluated' : score === 0 ? 'Resume could not be matched' : `${score}/100 match score`}
          </p>
        </div>
      </div>
      <div>
        <p style={{ fontSize: '12px', fontWeight: '600', color: '#6B7280', marginBottom: '6px' }}>WHY THIS SCORE</p>
        <div style={{ fontSize: '13px', lineHeight: '1.7', color: '#374151', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {summary.split('\n\n').map((para: string, i: number) => (
            <p key={i} style={{ margin: '0 0 8px 0' }}>{para}</p>
          ))}
        </div>
      </div>
      {candidate.matchSummary && (
        <div style={{ marginTop: '12px', padding: '8px 10px', borderRadius: '6px', background: '#EEF2FF', border: '1px solid #C7D2FE' }}>
          <p style={{ fontSize: '12px', fontWeight: '700', color: '#3730A3' }}>
            {candidate.matchSummary?.includes('Job Description') || candidate.matchSummary?.includes('JD')
              ? 'AI compared resume against Job Description'
              : 'Scored based on candidate profile (No JD available)'}
          </p>
        </div>
      )}
    </div>
  );
};

// ─── SHARED STYLES ────────────────────────────────────────────────────────────
const iBox: React.CSSProperties  = { background: '#F9FAFB', borderRadius: '8px', padding: '10px 12px', border: '1px solid #E5E7EB' };
const lbl: React.CSSProperties   = { fontSize: '12px', fontWeight: '600', color: '#6B7280', marginBottom: '4px' };
const saved: React.CSSProperties = { fontSize: '13px', lineHeight: '1.6', wordBreak: 'break-word', whiteSpace: 'pre-wrap' };
const errS: React.CSSProperties  = { color: '#DC2626', fontSize: '12px', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' };

const TIME_SLOTS = [
  '09:00am - 10:00am', '10:00am - 11:00am', '11:00am - 12:00pm',
  '01:00pm - 02:00pm', '02:00pm - 03:00pm', '03:00pm - 04:00pm', '04:00pm - 05:00pm',
];

// ─── UPDATED BY BADGE ─────────────────────────────────────────────────────────
const UpdatedByBadge: React.FC<{ history: CandidateHistoryItem[]; stage: string; actions?: string[] }> = ({ history, stage, actions }) => {
  const stageEntries = history.filter(h => h.stage === stage);
  let last: CandidateHistoryItem | undefined;
  if (actions && actions.length > 0) {
    const strict = stageEntries.filter(h => h.action && actions.includes(h.action));
    last = strict.length > 0 ? strict[strict.length - 1] : stageEntries[stageEntries.length - 1];
  } else {
    last = stageEntries[stageEntries.length - 1];
  }
  if (!last) return null;
  const displayName = (last.updatedByName && last.updatedByName !== 'Unknown') ? last.updatedByName : null;
  const displayRole = (last.updatedByRole && last.updatedByRole !== 'unknown') ? last.updatedByRole : null;
  if (!displayName && !displayRole) return null;
  const roleColor: Record<string, { bg: string; text: string; border: string }> = {
    hr:     { bg: '#EFF6FF', text: '#1D4ED8', border: '#BFDBFE' },
    panel:  { bg: '#F0FDF4', text: '#065F46', border: '#86EFAC' },
    admin:  { bg: '#FEF3C7', text: '#92400E', border: '#FCD34D' },
    agency: { bg: '#F5F3FF', text: '#5B21B6', border: '#DDD6FE' },
  };
  const c = roleColor[displayRole?.toLowerCase() ?? ''] || { bg: '#F3F4F6', text: '#374151', border: '#E5E7EB' };
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 10px', borderRadius: '6px', background: c.bg, border: `1px solid ${c.border}`, fontSize: '12px', color: c.text, alignSelf: 'flex-start' }}>
      <span style={{ fontWeight: '500', opacity: 0.8 }}>✏️ Updated by</span>
      <span style={{ fontWeight: '700' }}>{displayName ?? '—'}</span>
      {displayRole && (
        <span style={{ background: c.border, color: c.text, padding: '1px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: '700', textTransform: 'capitalize' }}>
          {displayRole}
        </span>
      )}
    </div>
  );
};

// ─── READ-ONLY NOTE ───────────────────────────────────────────────────────────
const ReadOnlyNote: React.FC<{ msg: string }> = ({ msg }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#9CA3AF', background: '#F9FAFB', borderRadius: '8px', padding: '8px 12px', border: '1px solid #E5E7EB' }}>
    <Eye className="h-4 w-4" style={{ flexShrink: 0 }} /> {msg}
  </div>
);

// ─── STAGE SHELL ──────────────────────────────────────────────────────────────
const StageShell: React.FC<{ title: string; status: string; isLocked: boolean; children: React.ReactNode }> = ({ title, status, isLocked, children }) => {
  const normalized = normalizeStatus(status as any);
  const isActive   = !isLocked && ['Pending', 'Scheduled', 'Released'].includes(normalized.name);
  return (
    <div style={{ borderRadius: '12px', border: `1.5px solid ${isActive ? '#7C3AED' : '#E5E7EB'}`, boxShadow: isActive ? '0 2px 10px rgba(124,58,237,0.08)' : 'none', background: 'white' }}>
      <div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #F3F4F6' }}>
        <h3 style={{ fontWeight: 'bold', fontSize: '15px', margin: 0 }}>{title}</h3>
        <Badge className={normalized.color}>{isLocked ? 'Locked' : normalized.name}</Badge>
      </div>
      <div style={{ padding: '14px 16px' }}>
        {isLocked ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#9CA3AF', fontSize: '13px' }}>
            <Lock className="h-4 w-4" /><span>Complete the previous stage to unlock this step.</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>{children}</div>
        )}
      </div>
    </div>
  );
};

// ─── STAGE 1: RESUME REVIEW ───────────────────────────────────────────────────
const ResumeReviewCard: React.FC<{
  candidate: Candidate; role: UserRole | null;
  history: CandidateHistoryItem[];
  onAction: (action: string, payload: any) => void;
}> = ({ candidate, role, history, onAction }) => {
  const [feedback, setFeedback] = useState('');
  const [err, setErr]           = useState('');
  const status = candidate.resumeReviewStatus || 'Pending';
  const isDone = ['Accepted', 'Rejected'].includes(status);

  const handleAct = (action: 'accept' | 'reject') => {
    if (!feedback.trim()) { setErr('Feedback is required.'); return; }
    setErr('');
    onAction(action, { feedback: feedback.trim() });
  };

  return (
    <StageShell title="Resume Review" status={status} isLocked={false}>
      {isDone && (
        <div style={{ ...iBox, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <p style={lbl}>📋 Review Details</p>
          <p style={{ ...saved, color: status === 'Rejected' ? '#DC2626' : '#374151' }}>
            {candidate.resumeFeedback || 'No feedback provided.'}
          </p>
          <UpdatedByBadge history={history} stage="Resume Review" actions={['accept', 'reject']} />
        </div>
      )}
      {role === 'hr' && status === 'Pending' && (
        <>
          <Textarea
            placeholder="Enter resume review feedback (mandatory)…"
            value={feedback}
            onChange={e => { setFeedback(e.target.value); if (e.target.value.trim()) setErr(''); }}
            style={{ resize: 'vertical', minHeight: '80px' }}
          />
          {err && <p style={errS}><AlertCircle className="h-3 w-3" />{err}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button variant="destructive" onClick={() => handleAct('reject')}>✕ Reject</Button>
            <Button variant="default"     onClick={() => handleAct('accept')}>✓ Move to L1</Button>
          </div>
        </>
      )}
      {role !== 'hr' && status === 'Pending' && (
        <ReadOnlyNote msg="Only HR can review and action the resume." />
      )}
    </StageShell>
  );
};

// ─── STAGE 2 & 3: L1 / L2 INTERVIEW ─────────────────────────────────────────
const InterviewStageCard: React.FC<{
  candidate: Candidate; role: UserRole | null; user: any;
  panelUsers: PanelUser[]; stageKey: 'l1' | 'l2'; title: string;
  history: CandidateHistoryItem[];
  onAction: (action: string, payload: any) => void;
}> = ({ candidate, role, user, panelUsers, stageKey, title, history, onAction }) => {
  const [date, setDate]         = useState('');
  const [slot, setSlot]         = useState('');
  const [notes, setNotes]       = useState('');
  const [panelUid, setPanelUid] = useState('');
  const [feedback, setFeedback] = useState('');
  const [schedErr, setSchedErr] = useState('');
  const [fbErr, setFbErr]       = useState('');
  const today = new Date().toISOString().split('T')[0];

  const statusKey   = stageKey === 'l1' ? 'l1Status'          : 'l2Status';
  const dateKey     = stageKey === 'l1' ? 'l1ScheduledDate'   : 'l2ScheduledDate';
  const slotKey     = stageKey === 'l1' ? 'l1TimeSlot'        : 'l2TimeSlot';
  const notesKey    = stageKey === 'l1' ? 'l1SchedulingNotes' : 'l2SchedulingNotes';
  const fbKey       = stageKey === 'l1' ? 'l1Feedback'        : 'l2Feedback';
  const panelUidKey = stageKey === 'l1' ? 'l1PanelUid'        : 'l2PanelUid';
  const panelNmKey  = stageKey === 'l1' ? 'l1PanelName'       : 'l2PanelName';

  const status        = (candidate as any)[statusKey]  || 'Locked';
  const savedDate     = (candidate as any)[dateKey];
  const savedSlot     = (candidate as any)[slotKey];
  const savedNotes    = (candidate as any)[notesKey];
  const savedFeedback = (candidate as any)[fbKey];
  const assignedPanel = (candidate as any)[panelUidKey];
  const panelName     = (candidate as any)[panelNmKey];

  const isLocked        = status === 'Locked';
  const isHR            = role === 'hr';
  const isPanel         = role === 'panel';
  const isAssignedPanel = isPanel && user?.uid === assignedPanel;

  const canHRSchedule    = isHR && status === 'Pending';
  const canPanelFeedback = isAssignedPanel && status === 'Scheduled';

  const showScheduleInfo = ['Scheduled', 'Selected', 'Rejected'].includes(status) && savedDate;
  const showFeedback     = ['Selected', 'Rejected'].includes(status) && savedFeedback;

  const handleSchedule = () => {
    if (!panelUid)      { setSchedErr('Please select a panel member.'); return; }
    if (!date || !slot) { setSchedErr('Please select date and time.'); return; }
    if (!notes.trim())  { setSchedErr('Scheduling notes are required.'); return; }
    setSchedErr('');
    const panel = panelUsers.find(p => p.uid === panelUid);
    const panelEmail = panel?.email || '';
    if (!panelEmail || !panelEmail.includes('@')) {
      console.error(
        '[Schedule] ❌ Panel member has no valid email!',
        '\nUID:', panelUid, '\nPanel object:', panel,
        '\nFIX: Check that panelUsers is fetched correctly and that panel user documents have an email field.'
      );
    }
    onAction('schedule', {
      scheduledDate:   date,
      timeSlot:        slot,
      schedulingNotes: notes.trim(),
      panelUid,
      panelName:  panel?.name || panel?.email || 'Panel',
      panelEmail: panelEmail,
    });
  };

  const handlePanelDecision = (action: 'panel-select' | 'panel-reject') => {
    if (!feedback.trim()) { setFbErr('Feedback is required.'); return; }
    setFbErr('');
    onAction(action, { feedback: feedback.trim() });
  };

  const nextStageLabel = stageKey === 'l1' ? 'L2' : 'HR Round';

  return (
    <StageShell title={title} status={status} isLocked={isLocked}>

      {showScheduleInfo && (
        <div style={{ border: '1.5px solid #E5E7EB', borderRadius: '12px', overflow: 'hidden', background: 'white' }}>
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <p style={{ fontSize: '13px', fontWeight: '700', color: '#374151', margin: 0 }}>📅 Schedule Information</p>
            <div>
              <p style={lbl}>Date & Time</p>
              <p style={{ ...saved, fontWeight: '600', color: '#374151', margin: 0 }}>
                {new Date(savedDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} at {savedSlot}
              </p>
            </div>
            {savedNotes && (
              <div>
                <p style={lbl}>📝 Scheduling Notes</p>
                <p style={{ ...saved, color: '#374151', margin: 0 }}>{savedNotes}</p>
              </div>
            )}
            {panelName && (
              <div>
                <p style={lbl}>👤 Assigned Panel</p>
                <p style={{ ...saved, color: '#1D4ED8', fontWeight: '600', margin: 0 }}>{panelName}</p>
              </div>
            )}
            <UpdatedByBadge history={history} stage={title} actions={['schedule']} />
          </div>
          {showFeedback && (
            <>
              <div style={{ borderTop: '1px solid #E5E7EB', background: '#F9FAFB', padding: '7px 16px' }}>
                <span style={{ fontSize: '11px', fontWeight: '700', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  💬 Interview Feedback
                </span>
              </div>
              <div style={{ padding: '14px 16px', background: status === 'Rejected' ? '#FFF8F8' : '#F6FEF9', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <p style={{ ...saved, color: status === 'Rejected' ? '#DC2626' : '#065F46', margin: 0 }}>{savedFeedback}</p>
                <UpdatedByBadge history={history} stage={title} actions={['panel-select', 'panel-reject']} />
              </div>
            </>
          )}
        </div>
      )}

      {canHRSchedule && (
        <div style={{ background: '#F9FAFB', borderRadius: '10px', padding: '14px', border: '1px solid #E5E7EB' }}>
          <p style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '12px' }}>Schedule {title}</p>
          <p style={{ ...lbl, marginBottom: '6px' }}>Assign Panel Member <span style={{ color: '#DC2626' }}>*</span></p>
          <select
            value={panelUid}
            onChange={e => { setPanelUid(e.target.value); if (e.target.value) setSchedErr(''); }}
            style={{ width: '100%', borderRadius: '8px', border: '1px solid #E5E7EB', padding: '9px 12px', fontSize: '13px', marginBottom: '12px', background: 'white' }}
          >
            <option value="">— Select Panel Member —</option>
            {panelUsers.map(p => (
              <option key={p.uid} value={p.uid}>
                {p.name ? `${p.name} (${p.email})` : p.email || `UID: ${p.uid}`}
              </option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
            <div style={{ position: 'relative', minWidth: '150px' }}>
              <Calendar className="h-4 w-4" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF', pointerEvents: 'none' }} />
              <Input type="date" value={date} min={today} onChange={e => setDate(e.target.value)} className="pl-10" style={{ background: 'white', borderRadius: '8px' }} />
            </div>
            <select value={slot} onChange={e => setSlot(e.target.value)} style={{ borderRadius: '8px', border: '1px solid #E5E7EB', padding: '9px', background: 'white', flex: 1, minWidth: '160px', fontSize: '13px' }}>
              <option value="">Select a time slot</option>
              {TIME_SLOTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <p style={{ ...lbl, marginBottom: '6px' }}>Scheduling Notes <span style={{ color: '#DC2626' }}>*</span></p>
          <Textarea
            placeholder="Add notes for this interview…"
            value={notes}
            onChange={e => { setNotes(e.target.value); if (e.target.value.trim()) setSchedErr(''); }}
            style={{ resize: 'vertical', minHeight: '80px', background: 'white' }}
          />
          {schedErr && <p style={errS}><AlertCircle className="h-3 w-3" />{schedErr}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
            <Button onClick={handleSchedule} style={{ background: '#7C3AED', color: 'white', fontWeight: 'bold' }}>📅 Schedule</Button>
          </div>
        </div>
      )}

      {canPanelFeedback && (
        <div style={{ background: '#F0FDF4', borderRadius: '10px', padding: '14px', border: '1px solid #86EFAC' }}>
          <p style={{ fontWeight: 'bold', fontSize: '13px', color: '#065F46', marginBottom: '4px' }}>Submit Interview Feedback</p>
          <Textarea
            placeholder="Enter your technical interview feedback (mandatory)…"
            value={feedback}
            onChange={e => { setFeedback(e.target.value); if (e.target.value.trim()) setFbErr(''); }}
            style={{ resize: 'vertical', minHeight: '90px' }}
          />
          {fbErr && <p style={errS}><AlertCircle className="h-3 w-3" />{fbErr}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
            <Button variant="destructive" onClick={() => handlePanelDecision('panel-reject')}>✕ Reject</Button>
            <Button variant="default" onClick={() => handlePanelDecision('panel-select')} style={{ background: '#059669', color: 'white' }}>
              ✓ Move to {nextStageLabel}
            </Button>
          </div>
        </div>
      )}

      {isHR && status === 'Scheduled' && (
        <ReadOnlyNote msg="Waiting for the assigned panel member to submit their feedback and decision." />
      )}
      {isPanel && !isAssignedPanel && !isLocked && (
        <ReadOnlyNote msg="You are not assigned to this interview. View only." />
      )}
      {(role === 'admin' || role === 'agency') && !isLocked && (
        <ReadOnlyNote msg={`Only HR and assigned panel can manage ${title}.`} />
      )}
    </StageShell>
  );
};

// ─── STAGE 4: HR ROUND ────────────────────────────────────────────────────────
const HRRoundCard: React.FC<{
  candidate: Candidate; role: UserRole | null;
  history: CandidateHistoryItem[];
  onAction: (action: string, payload: any) => void;
}> = ({ candidate, role, history, onAction }) => {
  const [date, setDate]         = useState('');
  const [slot, setSlot]         = useState('');
  const [notes, setNotes]       = useState('');
  const [feedback, setFeedback] = useState('');
  const [schedErr, setSchedErr] = useState('');
  const [fbErr, setFbErr]       = useState('');
  const today  = new Date().toISOString().split('T')[0];
  const status = candidate.hrStatus || 'Locked';
  const isHR   = role === 'hr';

  const showScheduleInfo = ['Scheduled', 'Selected', 'Rejected'].includes(status) && candidate.hrScheduledDate;
  const showFeedback     = ['Selected', 'Rejected'].includes(status) && candidate.hrFeedback;

  const handleSchedule = () => {
    if (!date || !slot) { setSchedErr('Please select date and time.'); return; }
    if (!notes.trim())  { setSchedErr('Scheduling notes are required.'); return; }
    setSchedErr('');
    onAction('schedule', { scheduledDate: date, timeSlot: slot, schedulingNotes: notes.trim() });
  };

  const handleDecide = (action: 'select' | 'reject') => {
    if (!feedback.trim()) { setFbErr('Feedback is required.'); return; }
    setFbErr('');
    onAction(action, { feedback: feedback.trim() });
  };

  return (
    <StageShell title="HR Round" status={status} isLocked={status === 'Locked'}>
      {showScheduleInfo && (
        <div style={{ border: '1.5px solid #E5E7EB', borderRadius: '12px', overflow: 'hidden', background: 'white' }}>
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <p style={{ fontSize: '13px', fontWeight: '700', color: '#374151', margin: 0 }}>📅 Schedule Information</p>
            <div>
              <p style={lbl}>Date & Time</p>
              <p style={{ ...saved, fontWeight: '600', color: '#374151', margin: 0 }}>
                {new Date(candidate.hrScheduledDate!).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} at {candidate.hrTimeSlot}
              </p>
            </div>
            {candidate.hrSchedulingNotes && (
              <div>
                <p style={lbl}>📝 Scheduling Notes</p>
                <p style={{ ...saved, color: '#374151', margin: 0 }}>{candidate.hrSchedulingNotes}</p>
              </div>
            )}
            <UpdatedByBadge history={history} stage="HR Round" actions={['schedule']} />
          </div>
          {showFeedback && (
            <>
              <div style={{ borderTop: '1px solid #E5E7EB', background: '#F9FAFB', padding: '7px 16px' }}>
                <span style={{ fontSize: '11px', fontWeight: '700', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.07em' }}>💬 Interview Feedback</span>
              </div>
              <div style={{ padding: '14px 16px', background: status === 'Rejected' ? '#FFF8F8' : '#F6FEF9', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <p style={{ ...saved, color: status === 'Rejected' ? '#DC2626' : '#065F46', margin: 0 }}>{candidate.hrFeedback}</p>
                <UpdatedByBadge history={history} stage="HR Round" actions={['select', 'reject']} />
              </div>
            </>
          )}
        </div>
      )}

      {isHR && status === 'Pending' && (
        <div style={{ background: '#F9FAFB', borderRadius: '10px', padding: '14px', border: '1px solid #E5E7EB' }}>
          <p style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '12px' }}>Schedule HR Round</p>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
            <div style={{ position: 'relative', minWidth: '150px' }}>
              <Calendar className="h-4 w-4" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF', pointerEvents: 'none' }} />
              <Input type="date" value={date} min={today} onChange={e => setDate(e.target.value)} className="pl-10" style={{ background: 'white', borderRadius: '8px' }} />
            </div>
            <select value={slot} onChange={e => setSlot(e.target.value)} style={{ borderRadius: '8px', border: '1px solid #E5E7EB', padding: '9px', background: 'white', flex: 1, minWidth: '160px', fontSize: '13px' }}>
              <option value="">Select a time slot</option>
              {TIME_SLOTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <p style={{ ...lbl, marginBottom: '6px' }}>Scheduling Notes <span style={{ color: '#DC2626' }}>*</span></p>
          <Textarea placeholder="Add notes for this HR round…" value={notes}
            onChange={e => { setNotes(e.target.value); if (e.target.value.trim()) setSchedErr(''); }}
            style={{ resize: 'vertical', minHeight: '80px', background: 'white' }} />
          {schedErr && <p style={errS}><AlertCircle className="h-3 w-3" />{schedErr}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
            <Button onClick={handleSchedule} style={{ background: '#7C3AED', color: 'white', fontWeight: 'bold' }}>📅 Schedule</Button>
          </div>
        </div>
      )}

      {isHR && status === 'Scheduled' && (
        <>
          <p style={{ ...lbl, marginBottom: '2px' }}>Interview Feedback <span style={{ color: '#DC2626' }}>*</span></p>
          <Textarea placeholder="Enter post-HR-round feedback (mandatory)…" value={feedback}
            onChange={e => { setFeedback(e.target.value); if (e.target.value.trim()) setFbErr(''); }}
            style={{ resize: 'vertical', minHeight: '90px' }} />
          {fbErr && <p style={errS}><AlertCircle className="h-3 w-3" />{fbErr}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
            <Button variant="destructive" onClick={() => handleDecide('reject')}>✕ Reject</Button>
            <Button variant="default"     onClick={() => handleDecide('select')}>✓ Move to Offer</Button>
          </div>
        </>
      )}

      {!isHR && status !== 'Locked' && (
        <ReadOnlyNote msg="Only HR can manage the HR Round." />
      )}
    </StageShell>
  );
};

// ─── STAGE 5: OFFER STAGE ─────────────────────────────────────────────────────
const OfferStageCard: React.FC<{
  candidate: Candidate; role: UserRole | null;
  history: CandidateHistoryItem[];
  onAction: (action: string, payload: any) => void;
}> = ({ candidate, role, history, onAction }) => {
  const [offerFeedback, setOfferFeedback] = useState('');
  const [offerError, setOfferError]       = useState('');
  const status = candidate.offerStatus || 'Locked';
  const isHR   = role === 'hr';

  const handleOfferAction = (action: 'offer-accept' | 'offer-reject') => {
    if (!offerFeedback.trim()) { setOfferError('Response notes are required.'); return; }
    setOfferError('');
    onAction(action, { feedback: offerFeedback.trim() });
  };

  return (
    <StageShell title="Offer Stage" status={status} isLocked={status === 'Locked'}>
      {status === 'Released' && (
        <div style={{ background: '#EFF6FF', borderRadius: '8px', padding: '10px 14px', border: '1px solid #BFDBFE', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <p style={{ fontSize: '13px', color: '#2563EB', fontWeight: '600', margin: 0 }}>📨 Offer has been released. Awaiting candidate response.</p>
          <UpdatedByBadge history={history} stage="Offer Stage" actions={['release-offer']} />
        </div>
      )}
      {(status === 'Accepted' || status === 'Rejected') && candidate.offerFeedback && (
        <div style={{ background: status === 'Accepted' ? '#F0FDF9' : '#FFF5F5', borderRadius: '10px', padding: '12px 14px', border: `1px solid ${status === 'Accepted' ? '#6EE7B7' : '#FCA5A5'}`, display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <p style={{ ...lbl, color: status === 'Accepted' ? '#065F46' : '#991B1B', fontSize: '13px', fontWeight: '700', margin: 0 }}>
            {status === 'Accepted' ? '🎉 Offer Accepted' : '❌ Offer Rejected'}
          </p>
          <div style={iBox}>
            <p style={lbl}>Response Notes</p>
            <p style={{ ...saved, color: status === 'Accepted' ? '#065F46' : '#DC2626' }}>{candidate.offerFeedback}</p>
          </div>
          <UpdatedByBadge history={history} stage="Offer Stage" actions={['offer-accept', 'offer-reject']} />
        </div>
      )}
      {isHR && status === 'Pending' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <p style={{ fontSize: '13px', color: '#6B7280' }}>Candidate has cleared all rounds. Release the offer when ready.</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={() => onAction('release-offer', {})} style={{ background: '#7C3AED', color: 'white' }}>📨 Release Offer</Button>
          </div>
        </div>
      )}
      {isHR && status === 'Released' && (
        <>
          <p style={{ ...lbl, marginBottom: '2px' }}>Response Notes <span style={{ color: '#DC2626' }}>*</span></p>
          <Textarea placeholder="Enter candidate's response or notes (mandatory)…" value={offerFeedback}
            onChange={e => { setOfferFeedback(e.target.value); if (e.target.value.trim()) setOfferError(''); }}
            style={{ resize: 'vertical', minHeight: '80px' }} />
          {offerError && <p style={errS}><AlertCircle className="h-3 w-3" />{offerError}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
            <Button variant="destructive" onClick={() => handleOfferAction('offer-reject')}>✕ Mark Rejected</Button>
            <Button variant="default"     onClick={() => handleOfferAction('offer-accept')}>✓ Mark Accepted</Button>
          </div>
        </>
      )}
      {!isHR && status !== 'Locked' && status !== 'Released' && (
        <ReadOnlyNote msg="Only HR can manage the Offer Stage." />
      )}
    </StageShell>
  );
};

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function CandidatePage({ params }: { params: { candidateId: string } }) {
  const { candidateId } = params;
  const [candidate, setCandidate]   = useState<Candidate | null>(null);
  const [loading, setLoading]       = useState(true);
  const [panelUsers, setPanelUsers] = useState<PanelUser[]>([]);
  const router                      = useRouter();
  const { role, user }              = useAuth();
  const [history, setHistory]       = useState<CandidateHistoryItem[]>([]);

  useEffect(() => {
    if (!candidateId) return;
    const q = query(collection(db, 'candidate_history'), where('candidateId', '==', candidateId));
    getDocs(q).then((snap) => {
      const data: CandidateHistoryItem[] = snap.docs.map(d => {
        const docData = d.data();
        return {
          stage:         docData.stage         || '',
          updatedByName: docData.updatedByName || '',
          updatedByRole: docData.updatedByRole || '',
          action:        docData.action        || '',
        };
      });
      setHistory(data);
    });
  }, [candidateId]);

  useEffect(() => {
    if (!candidateId) return;
    const unsub = onSnapshot(doc(db, 'candidates', candidateId), (snap) => {
      setCandidate(snap.exists() ? { id: snap.id, ...snap.data() } as Candidate : null);
      setLoading(false);
    });
    return () => unsub();
  }, [candidateId]);

  useEffect(() => {
    if (role !== 'hr') return;
    getDocs(query(collection(db, 'users'), where('role', '==', 'panel'))).then(snap => {
      const users: PanelUser[] = snap.docs.map(d => {
        const data = d.data();
        const email =
          data.email        ||
          data.emailAddress ||
          data.userEmail    ||
          data.mail         ||
          '';
        const name =
          data.displayName ||
          data.name        ||
          data.fullName    ||
          '';
        if (!email) {
          console.error(
            `[PanelUsers] ❌ Panel user UID "${d.id}" has no email field.`,
            '\nDocument data:', data,
            '\nFIX: Add an "email" field to this user document in Firebase.'
          );
        }
        return { uid: d.id, name, email };
      });
      console.log('[PanelUsers] Loaded:', users.map(u => ({ uid: u.uid, email: u.email || '⚠️ MISSING' })));
      setPanelUsers(users);
    });
  }, [role]);

  // ─── CENTRAL ACTION HANDLER ───────────────────────────────────────────────
  const handleAction = async (stage: string, action: string, payload: any) => {
    if (!candidate || !user) return;

    const actorEmail =
      user.email                    ||
      user.providerData?.[0]?.email ||
      '';

    const loggedInUserName = await getUserInfo(user.uid);
    const actorName = loggedInUserName.name || user.displayName || actorEmail || 'Unknown';

    const historyData: any = {
      candidateId,
      stage,
      action,
      status:          '',
      feedback:        payload.feedback        || '',
      schedulingNotes: payload.schedulingNotes || '',
      scheduledDate:   payload.scheduledDate   || null,
      timeSlot:        payload.timeSlot        || null,
      panelUid:        payload.panelUid        || null,
      panelName:       payload.panelName       || null,
      updatedBy:       user.uid,
      updatedByName:   actorName,
      updatedByRole:   role || 'unknown',
      updatedAt:       Timestamp.now(),
    };

    let updateData: Partial<any> = {};

    switch (stage) {

      case 'Resume Review':
        if (action === 'accept') {
          updateData = {
            resumeReviewStatus:    'Accepted',
            resumeFeedback:        payload.feedback,
            l1Status:              'Pending',
            resumeReviewedByEmail: actorEmail,
            resumeReviewedByUid:   user.uid,
            resumeReviewedByName:  actorName,
          };
          historyData.status = 'Accepted';
        } else {
          updateData = {
            resumeReviewStatus: 'Rejected',
            resumeFeedback:     payload.feedback,
            finalStatus:        'Rejected',
            l1Status:           'Locked',
            l2Status:           'Locked',
            hrStatus:           'Locked',
            offerStatus:        'Locked',
          };
          historyData.status = 'Rejected';
        }
        break;

      case 'L1 Interview':
        if (action === 'schedule') {
          updateData = {
            l1Status:           'Scheduled',
            l1ScheduledDate:    payload.scheduledDate,
            l1TimeSlot:         payload.timeSlot,
            l1SchedulingNotes:  payload.schedulingNotes,
            l1PanelUid:         payload.panelUid,
            l1PanelName:        payload.panelName,
            l1PanelEmail:       payload.panelEmail,
            l1InterviewerUid:   user.uid,
            l1InterviewerName:  actorName,
            l1InterviewerEmail: actorEmail,
          };
          historyData.status = 'Scheduled';
        } else if (action === 'panel-select') {
          updateData = { l1Status: 'Selected', l1Feedback: payload.feedback, l2Status: 'Pending' };
          historyData.status = 'Selected';
        } else if (action === 'panel-reject') {
          updateData = { l1Status: 'Rejected', l1Feedback: payload.feedback, finalStatus: 'Rejected', l2Status: 'Locked', hrStatus: 'Locked', offerStatus: 'Locked' };
          historyData.status = 'Rejected';
        }
        break;

      case 'L2 Interview':
        if (action === 'schedule') {
          updateData = {
            l2Status:           'Scheduled',
            l2ScheduledDate:    payload.scheduledDate,
            l2TimeSlot:         payload.timeSlot,
            l2SchedulingNotes:  payload.schedulingNotes,
            l2PanelUid:         payload.panelUid,
            l2PanelName:        payload.panelName,
            l2PanelEmail:       payload.panelEmail,
            l2InterviewerUid:   user.uid,
            l2InterviewerName:  actorName,
            l2InterviewerEmail: actorEmail,
          };
          historyData.status = 'Scheduled';
        } else if (action === 'panel-select') {
          updateData = { l2Status: 'Selected', l2Feedback: payload.feedback, hrStatus: 'Pending' };
          historyData.status = 'Selected';
        } else if (action === 'panel-reject') {
          updateData = { l2Status: 'Rejected', l2Feedback: payload.feedback, finalStatus: 'Rejected', hrStatus: 'Locked', offerStatus: 'Locked' };
          historyData.status = 'Rejected';
        }
        break;

      case 'HR Round':
        if (action === 'schedule') {
          updateData = {
            hrStatus:           'Scheduled',
            hrScheduledDate:    payload.scheduledDate,
            hrTimeSlot:         payload.timeSlot,
            hrSchedulingNotes:  payload.schedulingNotes,
            hrInterviewerEmail: actorEmail,
            hrInterviewerUid:   user.uid,
          };
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

    // ── WRITE TO FIRESTORE ────────────────────────────────────────────────────
    try {
      await updateDoc(doc(db, 'candidates', candidate.id), { ...updateData, lastUpdated: Timestamp.now() });
      await addDoc(collection(db, 'candidate_history'), historyData);
      setHistory(prev => [...prev, {
        stage,
        action,
        updatedByName: historyData.updatedByName,
        updatedByRole: historyData.updatedByRole,
      }]);
    } catch (err) {
      console.error('Firestore update failed:', err);
      return;
    }

    // ── EMAIL DISPATCH ────────────────────────────────────────────────────────

    // STEP 1 — Always read fresh candidate after Firestore write
    const fresh = await getFreshCandidate(candidate.id);
    if (!fresh) {
      console.error('[Email] ❌ Could not read fresh candidate — emails skipped for action:', action);
      return;
    }

    // ── THREADING: read saved messageId from the fresh candidate doc ─────────
    // If this is the first email ever for this candidate, this will be ''
    // and the flow will save the new messageId back to Firestore for next time.
    const threadMessageId: string = fresh.emailThreadMessageId || '';
    console.log('[Email] threadMessageId:', threadMessageId || '(first email — will save after send)');

    // STEP 2 — Resolve uploader email
    let uploaderEmail: string | null = null;
    let uploaderName:  string | null = null;

    if (fresh.createdBy) {
      const uploaderInfo = await getUserInfo(fresh.createdBy);
      uploaderEmail = uploaderInfo.email;
      uploaderName  = uploaderInfo.name;
    }
    if (!uploaderEmail && fresh.createdByEmail) {
      uploaderEmail = fresh.createdByEmail;
      console.log('[Email] Using createdByEmail fallback:', uploaderEmail);
    }
    if (!uploaderEmail) {
      console.error(
        '[Email] ❌ UPLOADER EMAIL NOT FOUND.',
        '\ncandidate.createdBy UID:', fresh.createdBy,
        '\nFIX OPTION A: Open Firebase console → users collection → UID above → add "email" field.',
        '\nFIX OPTION B: In your candidate upload code, also save createdByEmail: user.email on the candidate document.'
      );
    }

    // STEP 3 — Build base params shared across all emails
    const baseParams = {
      candidateName:     fresh.candidateName        || 'Candidate',
      jobRole:           fresh.candidateDesignation || 'Not specified',
      interviewerName:   actorName,
      interviewerEmail:  actorEmail,
      experience:        String(fresh.experience || ''),
      location:          String(fresh.location   || ''),
      stage,
      schedulingNotes:   payload.schedulingNotes || '',
      interviewFeedback: payload.feedback        || '',
      interviewDate:     payload.scheduledDate   || '',
      interviewTime:     payload.timeSlot        || '',
      // ── THREADING fields passed to every email ──────────────────────────
      candidateId:      candidate.id,
      threadMessageId:  threadMessageId,
    };

    // STEP 4 — Email queue (dedup by address)
    const queue = new Map<string, typeof baseParams & { toEmail: string; senderRole: string; emailType: string }>();

    const enqueue = (toEmail: string | null | undefined, senderRole: string, emailType: string) => {
      const raw = toEmail?.trim();
      if (!raw || !raw.includes('@')) {
        if (raw) console.warn('[Email] enqueue skipped — bad address:', raw, '| stage:', stage, '| action:', action);
        return;
      }
      const key = raw.toLowerCase();
      if (queue.has(key)) {
        console.log('[Email] Deduped:', raw);
        return;
      }
      queue.set(key, { ...baseParams, toEmail: raw, senderRole, emailType });
    };

    console.log('[Email] ── Building queue for stage:', stage, '| action:', action);
    console.log('[Email]    uploaderEmail:', uploaderEmail || '⚠️  MISSING');
    console.log('[Email]    actorEmail:', actorEmail || '⚠️  MISSING');

    // ── RESUME REVIEW ─────────────────────────────────────────────────────────
    if (stage === 'Resume Review') {
      const emailType = action === 'accept' ? 'resume_accepted' : 'resume_rejected';
      enqueue(uploaderEmail, 'hr', emailType);
      enqueue(actorEmail,    'hr', emailType);
    }

    // ── L1 SCHEDULE ───────────────────────────────────────────────────────────
    else if (action === 'schedule' && stage === 'L1 Interview') {
      const panelEmail = fresh.l1PanelEmail || payload.panelEmail || '';
      console.log('[Email]    l1PanelEmail:', panelEmail || '⚠️  MISSING');
      enqueue(uploaderEmail, 'hr', 'interview_scheduled');
      enqueue(actorEmail,    'hr', 'interview_scheduled');
      enqueue(panelEmail,    'hr', 'panel_assigned');
    }

    // ── L2 SCHEDULE ───────────────────────────────────────────────────────────
    else if (action === 'schedule' && stage === 'L2 Interview') {
      const panelEmail = fresh.l2PanelEmail || payload.panelEmail || '';
      console.log('[Email]    l2PanelEmail:', panelEmail || '⚠️  MISSING');
      enqueue(uploaderEmail, 'hr', 'interview_scheduled');
      enqueue(actorEmail,    'hr', 'interview_scheduled');
      enqueue(panelEmail,    'hr', 'panel_assigned');
    }

    // ── HR ROUND SCHEDULE ─────────────────────────────────────────────────────
    else if (action === 'schedule' && stage === 'HR Round') {
      enqueue(uploaderEmail, 'hr', 'interview_scheduled');
      enqueue(actorEmail,    'hr', 'interview_scheduled');
    }

    // ── L1 / L2 PANEL FEEDBACK ────────────────────────────────────────────────
    else if (
      (stage === 'L1 Interview' || stage === 'L2 Interview') &&
      (action === 'panel-select' || action === 'panel-reject')
    ) {
      const reviewerEmail =
        fresh.resumeReviewedByEmail ||
        (stage === 'L1 Interview' ? fresh.l1InterviewerEmail : fresh.l2InterviewerEmail) ||
        null;

      const panelMemberEmail = actorEmail;
      const emailType = action === 'panel-select' ? 'candidate_selected' : 'candidate_rejected';

      enqueue(uploaderEmail,    'panel', emailType);
      enqueue(reviewerEmail,    'panel', emailType);
      enqueue(panelMemberEmail, 'panel', emailType);
    }

    // ── HR ROUND FEEDBACK ─────────────────────────────────────────────────────
    else if (stage === 'HR Round' && (action === 'select' || action === 'reject')) {
      const emailType = action === 'select' ? 'candidate_selected' : 'candidate_rejected';
      enqueue(uploaderEmail, 'hr', emailType);
      enqueue(actorEmail,    'hr', emailType);
    }

    // ── OFFER STAGE ───────────────────────────────────────────────────────────
    else if (stage === 'Offer Stage') {
      const emailType =
        action === 'release-offer' ? 'offer_released'  :
        action === 'offer-accept'  ? 'offer_accepted'  :
                                     'offer_rejected';
      enqueue(uploaderEmail, 'hr', emailType);
      enqueue(actorEmail,    'hr', emailType);
    }

    // ── FLUSH ─────────────────────────────────────────────────────────────────
    const recipients = [...queue.keys()];
    console.log(`[Email] ── Sending to ${recipients.length} recipient(s):`, recipients);

    for (const emailParams of queue.values()) {
      await sendEmail(emailParams);
    }

    console.log('[Email] ── Dispatch complete. Stage:', stage, '| Action:', action);
  };

  // ─── LOADING / NOT FOUND / ACCESS CHECK ──────────────────────────────────
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
  if (role === 'agency' && candidate.createdBy !== user?.uid) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'Segoe UI, system-ui' }}>
        You don't have access to this candidate.
      </div>
    );
  }

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

      {role === 'admin' && (
        <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: '10px', padding: '10px 16px', marginBottom: '16px', fontSize: '13px', color: '#92400E', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Eye className="h-4 w-4" /> <strong>Admin View:</strong> You can view all candidate details but cannot take any actions.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '30% 70%', gap: '24px' }}>

        {/* ── LEFT COLUMN ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ background: 'white', borderRadius: '12px', padding: '20px', textAlign: 'center' }}>
            <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: '#EDE9FE', margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', fontWeight: '700', color: '#5B21B6' }}>
              {(candidate.candidateName || '?')[0].toUpperCase()}
            </div>
            <h2 style={{ fontWeight: 'bold', margin: '0 0 4px' }}>{candidate.candidateName}</h2>
            <p style={{ color: 'gray', fontSize: '14px', margin: '0 0 10px' }}>{candidate.candidateDesignation}</p>
            <span style={finalBadgeStyle}>{finalStatus}</span>
          </div>

          <AIMatchCard candidate={candidate} />

          <div style={{ background: 'white', borderRadius: '12px', padding: '20px', textAlign: 'center' }}>
            {candidate.resumeFile?.data ? (
              <Button variant="outline" onClick={() => {
                const bytes    = atob(candidate.resumeFile.data);
                const arr      = new Uint8Array(bytes.length).map((_, i) => bytes.charCodeAt(i));
                const fileType = candidate.resumeFile.type || 'application/pdf';
                const blob     = new Blob([arr], { type: fileType });
                const url      = URL.createObjectURL(blob);
                if (fileType.includes('pdf')) {
                  window.open(url, '_blank');
                } else {
                  const a = document.createElement('a');
                  a.href = url; a.download = candidate.resumeFile.name || 'resume'; a.click();
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
          <div style={{ background: 'white', borderRadius: '12px', padding: '20px' }}>
            <h2 style={{ fontWeight: 'bold', marginBottom: '6px' }}>Interview Workflow</h2>
            <p style={{ fontSize: '13px', color: 'gray', marginBottom: '16px' }}>Manage active round. Save details to advance.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <ResumeReviewCard
                candidate={candidate} role={role as UserRole} history={history}
                onAction={(a, p) => handleAction('Resume Review', a, p)}
              />
              <InterviewStageCard
                candidate={candidate} role={role as UserRole} user={user} panelUsers={panelUsers}
                stageKey="l1" title="L1 Interview" history={history}
                onAction={(a, p) => handleAction('L1 Interview', a, p)}
              />
              <InterviewStageCard
                candidate={candidate} role={role as UserRole} user={user} panelUsers={panelUsers}
                stageKey="l2" title="L2 Interview" history={history}
                onAction={(a, p) => handleAction('L2 Interview', a, p)}
              />
              <HRRoundCard
                candidate={candidate} role={role as UserRole} history={history}
                onAction={(a, p) => handleAction('HR Round', a, p)}
              />
              <OfferStageCard
                candidate={candidate} role={role as UserRole} history={history}
                onAction={(a, p) => handleAction('Offer Stage', a, p)}
              />
            </div>
          </div>

          <div style={{ background: 'white', borderRadius: '12px', padding: '20px' }}>
            <h2 style={{ fontWeight: 'bold', marginBottom: '16px' }}>Professional Background</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              {[
                ['Full Name',      candidate.candidateName],
                ['Email',          candidate.candidateEmail],
                ['Phone',          candidate.phoneNumber || candidate.candidatePhone || candidate.phone || '—'],
                ['Experience',     candidate.experience ? `${candidate.experience} Years` : '—'],
                ['Current CTC',    candidate.currentCtc   || '—'],
                ['Expected CTC',   candidate.expectedCtc  || '—'],
                ['Notice Period',  candidate.noticePeriod  || '—'],
                ['Onsite Comfort', candidate.isComfortableOnsite || '—'],
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