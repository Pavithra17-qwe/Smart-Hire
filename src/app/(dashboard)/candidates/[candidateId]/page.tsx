'use client';

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
type CandidateHistoryItem = {
  stage: string;
  updatedByName: string;
  updatedByRole: string;
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
function getScoreDisplay(score: number | undefined | null): {
  color: string; bg: string; border: string; label: string; icon: React.ReactNode; textColor: string;
} {
  const s = typeof score === 'number' ? score : -1;
  if (s < 0)   return { color: '#6B7280', bg: '#F3F4F6', border: '#E5E7EB', label: 'Not Evaluated', icon: <Minus className="h-4 w-4" />, textColor: '#374151' };
  if (s === 0) return { color: '#DC2626', bg: '#FEF2F2', border: '#FECACA', label: 'No Match',       icon: <TrendingDown className="h-4 w-4" />, textColor: '#991B1B' };
  if (s <= 30) return { color: '#DC2626', bg: '#FEF2F2', border: '#FECACA', label: 'Very Low Match', icon: <TrendingDown className="h-4 w-4" />, textColor: '#991B1B' };
  if (s <= 50) return { color: '#D97706', bg: '#FFFBEB', border: '#FDE68A', label: 'Below Average',  icon: <TrendingDown className="h-4 w-4" />, textColor: '#92400E' };
  if (s <= 65) return { color: '#F59E0B', bg: '#FEF3C7', border: '#FCD34D', label: 'Moderate Match', icon: <Minus className="h-4 w-4" />,        textColor: '#78350F' };
  if (s <= 80) return { color: '#16A34A', bg: '#F0FDF4', border: '#86EFAC', label: 'Good Match',     icon: <TrendingUp className="h-4 w-4" />,   textColor: '#14532D' };
  return              { color: '#059669', bg: '#ECFDF5', border: '#6EE7B7', label: 'Strong Match',   icon: <TrendingUp className="h-4 w-4" />,   textColor: '#064E3B' };
}

function buildFallbackSummary(score: number | undefined | null, candidate: Candidate): string {
  const s = typeof score === 'number' ? score : -1;
  if (s < 0)   return "This candidate has not been evaluated yet. Go to Candidate Evaluation and re-submit to generate an AI match score.";
  if (s === 0) return "Score: 0% — The resume could not be matched against the Job Description. Possible reasons:\n\n• The resume file may be unreadable or encrypted.\n• The resume content does not relate to the job requirements.\n• The JD file was not available at the time of submission.\n\nPlease verify the uploaded resume and re-evaluate if needed.";
  if (s <= 30) return `Score: ${s}% — Very low match.\n\nThe candidate's profile has significant gaps compared to the job requirements. Key qualifications, required skills, or experience level may be missing or insufficient. It is not recommended to proceed without a more detailed review.`;
  if (s <= 50) return `Score: ${s}% — Below average match.\n\nThe candidate meets only a few of the required qualifications. There are notable gaps in skills or experience. A manual review is recommended before proceeding to the interview stage.`;
  if (s <= 65) return `Score: ${s}% — Moderate match.\n\nThe candidate meets some key criteria but does not fully align with all job requirements. There are areas of partial fit alongside a few gaps. Further evaluation through screening is recommended.`;
  if (s <= 80) return `Score: ${s}% — Good match.\n\nThe candidate meets most of the required qualifications with only minor gaps. They are a strong candidate and are recommended for the interview process.`;
  return `Score: ${s}% — Strong match.\n\nThe candidate closely aligns with the role requirements and demonstrates the key skills and experience needed. Highly recommended for the next stage.`;
}

// ─── AI MATCH CARD ─── UNCHANGED ─────────────────────────────────────────────
const AIMatchCard: React.FC<{ candidate: Candidate }> = ({ candidate }) => {
  const rawScore  = candidate.matchScore ?? candidate.aiScore;
  const score     = typeof rawScore === 'number' ? rawScore : undefined;
  const display   = getScoreDisplay(score);
  const storedSummary = candidate.matchSummary || "";
  const summary = storedSummary.trim().length > 30 ? storedSummary : buildFallbackSummary(score, candidate);
  const scoreLabel = score !== undefined ? `${score}%` : '—';

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
  <div
    style={{
      marginTop: '12px',
      padding: '8px 10px',
      borderRadius: '6px',
      background: '#EEF2FF', // light highlight
      border: '1px solid #C7D2FE'
    }}
  >
    <p
      style={{
        fontSize: '12px',
        fontWeight: '700', // ✅ bold
        color: '#3730A3'   // ✅ highlighted text color
      }}
    >
      {candidate.matchSummary?.includes('Job Description') || candidate.matchSummary?.includes('JD')
        ? 'AI compared resume against Job Description'
        : 'Scored based on candidate profile (No JD available)'}
    </p>
  </div>
)}
    </div>
  );
};

// ─── INTERVIEW WORKFLOW HELPERS ───────────────────────────────────────────────
const iBox: React.CSSProperties  = { background: '#F9FAFB', borderRadius: '8px', padding: '10px 12px', border: '1px solid #E5E7EB' };
const lbl: React.CSSProperties   = { fontSize: '12px', fontWeight: '600', color: '#6B7280', marginBottom: '4px' };
const saved: React.CSSProperties = { fontSize: '13px', lineHeight: '1.6', wordBreak: 'break-word', whiteSpace: 'pre-wrap' };
const errS: React.CSSProperties  = { color: '#DC2626', fontSize: '12px', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' };

const TIME_SLOTS = [
  '09:00am - 10:00am', '10:00am - 11:00am', '11:00am - 12:00pm',
  '01:00pm - 02:00pm', '02:00pm - 03:00pm', '03:00pm - 04:00pm', '04:00pm - 05:00pm',
];

// Read-only notice for non-acting roles
const ReadOnlyNote: React.FC<{ msg: string }> = ({ msg }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#9CA3AF', background: '#F9FAFB', borderRadius: '8px', padding: '8px 12px', border: '1px solid #E5E7EB' }}>
    <Eye className="h-4 w-4" style={{ flexShrink: 0 }} /> {msg}
  </div>
);

// Card shell — same visual style as original StageCard
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

// ─── STAGE 1: RESUME REVIEW ── HR only ───────────────────────────────────────
const ResumeReviewCard: React.FC<{
  candidate: Candidate;
  role: UserRole | null;
  history: CandidateHistoryItem[];   // ✅ ADD THIS
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
        <div style={iBox}>
          <p style={lbl}>Feedback</p>
          <p style={{ ...saved, color: status === 'Rejected' ? '#DC2626' : '#374151' }}>
            {candidate.resumeFeedback || 'No feedback provided.'}
          </p>
             {/* ✅ NEW: Updated By */}
    {history
  .filter((h: CandidateHistoryItem) => h.stage === 'Resume Review')
  .slice(-1)
  .map((h: CandidateHistoryItem) => (
        <p style={{ fontSize: '12px', color: '#6B7280', marginTop: '6px' }}>
          Updated by: <b>{h.updatedByName}</b> ({h.updatedByRole})
        </p>
      ))
    }
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
// HR schedules + assigns panel → Panel submits feedback → HR makes final call
const InterviewStageCard: React.FC<{
  candidate: Candidate; role: UserRole | null; user: any;
  panelUsers: PanelUser[]; stageKey: 'l1' | 'l2'; title: string;  history: CandidateHistoryItem[]; 
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

  const statusKey    = stageKey === 'l1' ? 'l1Status'          : 'l2Status';
  const dateKey      = stageKey === 'l1' ? 'l1ScheduledDate'   : 'l2ScheduledDate';
  const slotKey      = stageKey === 'l1' ? 'l1TimeSlot'        : 'l2TimeSlot';
  const notesKey     = stageKey === 'l1' ? 'l1SchedulingNotes' : 'l2SchedulingNotes';
  const fbKey        = stageKey === 'l1' ? 'l1Feedback'        : 'l2Feedback';
  const panelFbKey   = stageKey === 'l1' ? 'l1PanelFeedback'   : 'l2PanelFeedback';
  const panelUidKey  = stageKey === 'l1' ? 'l1PanelUid'        : 'l2PanelUid';
  const panelNmKey   = stageKey === 'l1' ? 'l1PanelName'       : 'l2PanelName';

  const status        = (candidate as any)[statusKey]  || 'Locked';
  const savedDate     = (candidate as any)[dateKey];
  const savedSlot     = (candidate as any)[slotKey];
  const savedNotes    = (candidate as any)[notesKey];
  const savedFeedback = (candidate as any)[fbKey];
  const panelFeedback = (candidate as any)[panelFbKey];
  const assignedPanel = (candidate as any)[panelUidKey];
  const panelName     = (candidate as any)[panelNmKey];

  const isLocked        = status === 'Locked';
  const isHR            = role === 'hr';
  const isPanel         = role === 'panel';
  const isAssignedPanel = isPanel && user?.uid === assignedPanel;

  const canHRSchedule    = isHR && status === 'Pending';
  const canPanelFeedback = isAssignedPanel && status === 'Scheduled' && !panelFeedback;
  const canHRDecide      = isHR && status === 'Scheduled' && !!panelFeedback;

  const handleSchedule = () => {
    if (!panelUid)      { setSchedErr('Please select a panel member.'); return; }
    if (!date || !slot) { setSchedErr('Please select date and time.'); return; }
    if (!notes.trim())  { setSchedErr('Scheduling notes are required.'); return; }
    setSchedErr('');
    const panel = panelUsers.find(p => p.uid === panelUid);
    onAction('schedule', {
      scheduledDate: date, timeSlot: slot, schedulingNotes: notes.trim(),
      panelUid, panelName: panel?.name || panel?.email || 'Panel', panelEmail: panel?.email || '',
    });
  };

  const handlePanelFeedback = (action: 'panel-select' | 'panel-reject') => {
    if (!feedback.trim()) { setFbErr('Feedback is required.'); return; }
    setFbErr('');
    onAction(action, { feedback: feedback.trim() });
  };

  return (
    <StageShell title={title} status={status} isLocked={isLocked}>

      {/* Saved schedule info */}
      {['Scheduled','Selected','Rejected'].includes(status) && savedDate && (
        <div style={iBox}>
          <p style={lbl}>📅 Scheduled</p>
          <p style={{ ...saved, fontWeight: '600', color: '#374151' }}>
            {new Date(savedDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} at {savedSlot}
          </p>
        </div>
      )}
      {['Scheduled','Selected','Rejected'].includes(status) && savedNotes && (
        <div style={iBox}><p style={lbl}>📝 Scheduling Notes</p><p style={{ ...saved, color: '#374151' }}>{savedNotes}</p></div>
      )}
      {['Scheduled','Selected','Rejected'].includes(status) && panelName && (
        <div style={iBox}><p style={lbl}>👤 Assigned Panel</p><p style={{ ...saved, color: '#1D4ED8', fontWeight: '600' }}>{panelName}</p></div>
      )}
{/* ✅ Updated By */}
{history
  ?.filter(h => h.stage === title)
  .slice(-1)
  .map((h, i) => (
    <p key={i} style={{ fontSize: '12px', color: '#6B7280', marginTop: '6px' }}>
      Updated by: <b>{h.updatedByName}</b> ({h.updatedByRole})
    </p>
))}
      {/* Final feedback (after HR decision) */}

      {['Selected','Rejected'].includes(status) && savedFeedback && (
        
        <div style={{ ...iBox, borderColor: status === 'Rejected' ? '#FCA5A5' : '#6EE7B7' }}>
          <p style={lbl}>💬 Interview Feedback</p>
          <p style={{ ...saved, color: status === 'Rejected' ? '#DC2626' : '#065F46' }}>{savedFeedback}</p>
        </div>
      )}

      {/* Panel feedback visible to HR while awaiting decision */}
      {isHR && panelFeedback && status === 'Scheduled' && (
        <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: '8px', padding: '10px 12px' }}>
          <p style={{ ...lbl, color: '#92400E' }}>📋 Panel Feedback — Awaiting Your Decision</p>
          <p style={{ ...saved, color: '#78350F' }}>{panelFeedback}</p>
        </div>
      )}

      {/* HR: Schedule form */}
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
            {panelUsers.map(p =><option key={p.uid} value={p.uid}>
  {p.name ? `${p.name} (${p.email})` : p.email}
</option>)}
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

      {/* Panel: Submit feedback — only if assigned */}
      {canPanelFeedback && (
        <div style={{ background: '#F0FDF4', borderRadius: '10px', padding: '14px', border: '1px solid #86EFAC' }}>
          <p style={{ fontWeight: 'bold', fontSize: '13px', color: '#065F46', marginBottom: '8px' }}>Submit Interview Feedback</p>
          <Textarea
            placeholder="Enter your technical interview feedback (mandatory)…"
            value={feedback}
            onChange={e => { setFeedback(e.target.value); if (e.target.value.trim()) setFbErr(''); }}
            style={{ resize: 'vertical', minHeight: '90px' }}
          />
          {fbErr && <p style={errS}><AlertCircle className="h-3 w-3" />{fbErr}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
            <Button variant="destructive" onClick={() => handlePanelFeedback('panel-reject')}>✕ Reject</Button>
            <Button variant="default"     onClick={() => handlePanelFeedback('panel-select')}>✓ Select</Button>
          </div>
        </div>
      )}

      {/* HR: Final decision after panel submits feedback */}
      {canHRDecide && (
        <div style={{ background: '#EFF6FF', borderRadius: '10px', padding: '14px', border: '1px solid #BFDBFE' }}>
          <p style={{ fontWeight: 'bold', fontSize: '13px', color: '#1D4ED8', marginBottom: '4px' }}>HR Decision</p>
          <p style={{ fontSize: '12px', color: '#3B82F6', marginBottom: '10px' }}>Panel has submitted feedback above. Make your final decision.</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button variant="destructive" onClick={() => onAction('reject', {})}>✕ Reject</Button>
            <Button variant="default"     onClick={() => onAction('select', {})}>✓ Move to {stageKey === 'l1' ? 'L2' : 'HR Round'}</Button>
          </div>
        </div>
      )}

      {/* HR waiting for panel feedback */}
      {isHR && status === 'Scheduled' && !panelFeedback && (
        <ReadOnlyNote msg="Waiting for the assigned panel member to submit their feedback." />
      )}

      {/* Panel not assigned */}
      {isPanel && !isAssignedPanel && !isLocked && (
        <ReadOnlyNote msg="You are not assigned to this interview. View only." />
      )}

      {/* Panel already submitted feedback */}
      {isPanel && isAssignedPanel && status === 'Scheduled' && panelFeedback && (
        <div style={{ ...iBox, borderColor: '#86EFAC' }}>
          <p style={{ ...lbl, color: '#065F46' }}>✅ Your Feedback Submitted</p>
          <p style={{ ...saved, color: '#065F46' }}>{panelFeedback}</p>
        </div>
      )}

      {/* Admin / Agency view */}
      {(role === 'admin' || role === 'agency') && !isLocked && (
        <ReadOnlyNote msg={`Only HR and assigned panel can manage ${title}.`} />
      )}
    </StageShell>
  );
};

// ─── STAGE 4: HR ROUND ── HR only ────────────────────────────────────────────
const HRRoundCard: React.FC<{
  candidate: Candidate;
  role: UserRole | null;
  history: CandidateHistoryItem[];   // ✅ ADD
  onAction: (action: string, payload: any) => void;
}> = ({ candidate, role, history,onAction }) => {
  const [date, setDate]         = useState('');
  const [slot, setSlot]         = useState('');
  const [notes, setNotes]       = useState('');
  const [feedback, setFeedback] = useState('');
  const [schedErr, setSchedErr] = useState('');
  const [fbErr, setFbErr]       = useState('');
  const today  = new Date().toISOString().split('T')[0];
  const status = candidate.hrStatus || 'Locked';
  const isHR   = role === 'hr';

  const handleSchedule = () => {
    if (!date || !slot)  { setSchedErr('Please select date and time.'); return; }
    if (!notes.trim())   { setSchedErr('Scheduling notes are required.'); return; }
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
      {['Scheduled','Selected','Rejected'].includes(status) && candidate.hrScheduledDate && (
        <div style={iBox}>
          <p style={lbl}>📅 Scheduled</p>
          <p style={{ ...saved, fontWeight: '600', color: '#374151' }}>
            {new Date(candidate.hrScheduledDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} at {candidate.hrTimeSlot}
          </p>
        </div>
      )}
      {['Scheduled','Selected','Rejected'].includes(status) && candidate.hrSchedulingNotes && (
        <div style={iBox}><p style={lbl}>📝 Scheduling Notes</p><p style={{ ...saved, color: '#374151' }}>{candidate.hrSchedulingNotes}</p></div>
      )}
      {['Selected','Rejected'].includes(status) && candidate.hrFeedback && (
        <div style={{ ...iBox, borderColor: status === 'Rejected' ? '#FCA5A5' : '#6EE7B7' }}>
          <p style={lbl}>💬 HR Feedback</p>
          <p style={{ ...saved, color: status === 'Rejected' ? '#DC2626' : '#065F46' }}>{candidate.hrFeedback}</p>
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

// ─── STAGE 5: OFFER STAGE ── HR only ─────────────────────────────────────────
const OfferStageCard: React.FC<{
  candidate: Candidate;
  role: UserRole | null;
  history: CandidateHistoryItem[];   // ✅ ADD
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
      {status === 'Released' && !isHR && (
        <p style={{ fontSize: '13px', color: '#2563EB', fontWeight: '600' }}>📨 Offer has been released. Awaiting candidate response.</p>
      )}
      {(status === 'Accepted' || status === 'Rejected') && candidate.offerFeedback && (
        <div style={{ ...iBox, borderColor: status === 'Accepted' ? '#6EE7B7' : '#FCA5A5' }}>
          <p style={lbl}>Response Notes</p>
          <p style={{ ...saved, color: status === 'Accepted' ? '#065F46' : '#DC2626' }}>
            {status === 'Accepted' ? '🎉 ' : ''}{candidate.offerFeedback}
          </p>
        </div>
      )}
      {isHR && status === 'Pending' && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button onClick={() => onAction('release-offer', {})} style={{ background: '#7C3AED', color: 'white' }}>📨 Release Offer</Button>
        </div>
      )}
      {isHR && status === 'Released' && (
        <>
          <p style={{ fontSize: '13px', color: '#2563EB', fontWeight: '600' }}>📨 Offer has been released</p>
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
  const [history, setHistory] = useState<CandidateHistoryItem[]>([]);
    useEffect(() => {
    if (!candidateId) return;
  
    const q = query(
      collection(db, 'candidate_history'),
      where('candidateId', '==', candidateId)
    );
  
    getDocs(q).then((snap) => {
      const data: CandidateHistoryItem[] = snap.docs.map(doc => {
        const d = doc.data();
        return {
          stage: d.stage || '',
          updatedByName: d.updatedByName || '',
          updatedByRole: d.updatedByRole || '',
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

  // HR needs panel list for L1/L2 scheduling dropdowns
  useEffect(() => {
    if (role !== 'hr') return;
    getDocs(query(collection(db, 'users'), where('role', '==', 'panel'))).then(snap => {
      setPanelUsers(snap.docs.map(d => {
        const data = d.data();
        return { uid: d.id, name: data.displayName || data.name || '', email: data.email || '' };
      }));
    });
  }, [role]);

  // ─── CENTRAL ACTION HANDLER ───────────────────────────────────────────────
  const handleAction = async (stage: string, action: string, payload: any) => {
    if (!candidate || !user) return;

    let updateData: Partial<any> = {};
    const loggedInUserName = await getLoggedInUserName(user.uid);
    const historyData: any = {
      candidateId, stage, action,
      status:          '',
      feedback:        payload.feedback        || '',
      schedulingNotes: payload.schedulingNotes || '',
      scheduledDate:   payload.scheduledDate   || null,
      timeSlot:        payload.timeSlot        || null,
      panelUid:        payload.panelUid        || null,
      panelName:       payload.panelName       || null,
      updatedBy: user.uid,
      updatedByName: loggedInUserName || user.displayName || user.email || 'Unknown', // ✅ FIX
      updatedByRole: role || 'unknown',

  updatedAt: Timestamp.now(),
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
          // HR schedules and assigns panel
          updateData = {
            l1Status: 'Scheduled',
            l1ScheduledDate: payload.scheduledDate, l1TimeSlot: payload.timeSlot, l1SchedulingNotes: payload.schedulingNotes,
            l1PanelUid: payload.panelUid, l1PanelName: payload.panelName, l1PanelEmail: payload.panelEmail,
            l1InterviewerUid: user.uid, l1InterviewerName: user.displayName || user.email, l1InterviewerEmail: user.email || '',
          };
          historyData.status = 'Scheduled';
        } else if (action === 'panel-select' || action === 'panel-reject') {
          // Panel submits feedback; HR decides next
          updateData = { l1PanelFeedback: payload.feedback };
          historyData.status = 'Panel Feedback Submitted';
        } else if (action === 'select') {
          // HR moves to L2
          updateData = { l1Status: 'Selected', l1Feedback: (candidate as any).l1PanelFeedback || '', l2Status: 'Pending' };
          historyData.status = 'Selected';
        } else if (action === 'reject') {
          updateData = { l1Status: 'Rejected', l1Feedback: (candidate as any).l1PanelFeedback || '', finalStatus: 'Rejected', l2Status: 'Locked', hrStatus: 'Locked', offerStatus: 'Locked' };
          historyData.status = 'Rejected';
        }
        break;

      case 'L2 Interview':
        if (action === 'schedule') {
          updateData = {
            l2Status: 'Scheduled',
            l2ScheduledDate: payload.scheduledDate, l2TimeSlot: payload.timeSlot, l2SchedulingNotes: payload.schedulingNotes,
            l2PanelUid: payload.panelUid, l2PanelName: payload.panelName, l2PanelEmail: payload.panelEmail,
            l2InterviewerUid: user.uid, l2InterviewerName: user.displayName || user.email, l2InterviewerEmail: user.email || '',
          };
          historyData.status = 'Scheduled';
        } else if (action === 'panel-select' || action === 'panel-reject') {
          updateData = { l2PanelFeedback: payload.feedback };
          historyData.status = 'Panel Feedback Submitted';
        } else if (action === 'select') {
          updateData = { l2Status: 'Selected', l2Feedback: (candidate as any).l2PanelFeedback || '', hrStatus: 'Pending' };
          historyData.status = 'Selected';
        } else if (action === 'reject') {
          updateData = { l2Status: 'Rejected', l2Feedback: (candidate as any).l2PanelFeedback || '', finalStatus: 'Rejected', hrStatus: 'Locked', offerStatus: 'Locked' };
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

    // ── EMAIL DISPATCH ─────────────────────────────────────────────────────
    // Rule: Never email candidate. Email uploader + HR + panel as appropriate.
    if (!candidate.createdBy) return;
    const uploader         = await getUploaderInfo(candidate.createdBy);
    const interviewerName  = loggedInUserName || user.displayName || (role === 'hr' ? 'HR Team' : 'Panel Team');

    const baseParams = {
      candidateName:     candidate.candidateName        || 'Candidate',
      jobRole:           candidate.candidateDesignation || 'Not specified',
      interviewerName,
      interviewerEmail:  user.email ?? '',
      experience:        String(candidate.experience || ''),
      location:          String(candidate.location   || ''),
      stage,
      schedulingNotes:   payload.schedulingNotes  || '',
      interviewFeedback: payload.feedback         || '',
      interviewDate:     payload.scheduledDate    || '',
      interviewTime:     payload.timeSlot         || '',
    };

    const actionToEmailType: Record<string, string> = {
      'accept':        'resume_accepted',
      'reject':        'candidate_rejected',
      'schedule':      'interview_scheduled',
      'panel-select':  'panel_feedback_submitted',
      'panel-reject':  'panel_feedback_submitted',
      'select':        'candidate_selected',
      'release-offer': 'offer_released',
      'offer-accept':  'offer_accepted',
      'offer-reject':  'offer_rejected',
    };
    const emailType  = actionToEmailType[action] || 'status_update';
    const senderRole = ['HR Round','Offer Stage','Resume Review'].includes(stage) ? 'hr' : role || 'hr';

    // 1. Always notify the uploader (HR or Agency who uploaded the candidate)
    if (uploader.email?.includes('@')) {
      await sendEmail({ ...baseParams, toEmail: uploader.email, senderRole, emailType });
    }

    // 2. If HR took the action AND is not the uploader, also CC the HR who acted
    if (role === 'hr' && user.email?.includes('@') && user.email !== uploader.email) {
      await sendEmail({ ...baseParams, toEmail: user.email, senderRole: 'hr', emailType });
    }

    // 3. On L1/L2 schedule: notify the newly assigned panel member
    if (action === 'schedule' && payload.panelEmail?.includes('@')) {
      await sendEmail({ ...baseParams, toEmail: payload.panelEmail, senderRole: 'hr', emailType: 'panel_assigned' });
    }

    // 4. On panel feedback: notify HR (the one who scheduled) so they can decide
    if (action === 'panel-select' || action === 'panel-reject') {
      const hrEmailKey = stage === 'L1 Interview' ? 'l1InterviewerEmail' : 'l2InterviewerEmail';
      const hrEmail    = (candidate as any)[hrEmailKey];
      if (hrEmail?.includes('@') && hrEmail !== uploader.email) {
        await sendEmail({ ...baseParams, toEmail: hrEmail, senderRole: 'panel', emailType: 'hr_panel_feedback_notification' });
      }
      // Also notify uploader if they differ from HR
      // (already covered in step 1 above)
    }
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

  // Agency: only their own candidates
  if (role === 'agency' && candidate.createdBy !== user?.uid) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'Segoe UI, system-ui' }}>
        You don't have access to this candidate.
      </div>
    );
  }

  const getStatus = (s: Status | undefined): Status => s || 'Pending';
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

      {/* Admin read-only banner */}
      {role === 'admin' && (
        <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: '10px', padding: '10px 16px', marginBottom: '16px', fontSize: '13px', color: '#92400E', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Eye className="h-4 w-4" /> <strong>Admin View:</strong> You can view all candidate details but cannot take any actions.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '30% 70%', gap: '24px' }}>

        {/* ── LEFT COLUMN ── unchanged layout */}
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

          {/* AI Match Card — UNCHANGED */}
          <AIMatchCard candidate={candidate} />

          {/* Resume viewer — UNCHANGED */}
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

          {/* Interview Workflow — MODIFIED */}
          <div style={{ background: 'white', borderRadius: '12px', padding: '20px' }}>
            <h2 style={{ fontWeight: 'bold', marginBottom: '6px' }}>Interview Workflow</h2>
            <p style={{ fontSize: '13px', color: 'gray', marginBottom: '16px' }}>Manage active round. Save details to advance.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

            <ResumeReviewCard
  candidate={candidate}
  role={role as UserRole}
  history={history}   // ✅ ADD THIS
  onAction={(a, p) => handleAction('Resume Review', a, p)}
/>
              <InterviewStageCard
                candidate={candidate} role={role as UserRole} user={user} panelUsers={panelUsers}
                stageKey="l1" title="L1 Interview"
                history={history}
                onAction={(a, p) => handleAction('L1 Interview', a, p)}
              />
              <InterviewStageCard
                candidate={candidate} role={role as UserRole} user={user} panelUsers={panelUsers}
                stageKey="l2" title="L2 Interview"
                history={history}
                onAction={(a, p) => handleAction('L2 Interview', a, p)}
              />
              <HRRoundCard
                candidate={candidate} role={role as UserRole}
                history={history}
                onAction={(a, p) => handleAction('HR Round', a, p)}
              />
              <OfferStageCard
                candidate={candidate} role={role as UserRole}
                history={history}
                onAction={(a, p) => handleAction('Offer Stage', a, p)}
              />

            </div>
          </div>

          {/* Professional Background — UNCHANGED */}
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