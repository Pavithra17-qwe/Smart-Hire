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
 * PANEL AVAILABILITY VALIDATION — added
 * ============================================================
 *
 * Prevents assigning the same panel member to two interviews
 * that share the same Date + Time Slot.
 *
 * Applies to: L1 Technical Round (stageKey='l2') and
 *             L2 Manager Round  (stageKey='l2manager').
 *
 * Three layers of protection:
 *   1. Dropdown filtering — conflicting UIDs are excluded from
 *      the panel selector so HR never sees unavailable members.
 *   2. Re-validation on date/slot change — if HR picks a panel
 *      member first and then selects a conflicting slot, the
 *      selection is cleared and a message is shown.
 *   3. Final pre-save check — even if two HR users race to book
 *      the same slot, a fresh Firestore read blocks the second
 *      save and surfaces an error.
 *
 * ============================================================
 */

import React, { useState, useEffect, use } from 'react'
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
import { AIInterviewStatusCard } from '@/components/AIInterviewStatus/AIInterviewStatusCard';
import ExportInterviewButton from '@/components/ExportInterviewButton';

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
  | 'Locked' | 'Released' | 'Panel Assigned' | 'Panel Reviewed'
  | 'On Hold';

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
  candidateId:     string;
  threadMessageId: string;
  rescheduleToken?: string;
  l1RescheduleUsed?: boolean;
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
      candidateId:       params.candidateId,
      threadMessageId:   params.threadMessageId,
      interviewLink:     '',
      rescheduleToken:   params.rescheduleToken || '',
      l1RescheduleUsed:  params.l1RescheduleUsed ?? false,
    });
    console.log('[sendEmail] ✅ Sent to:', email);
  } catch (err) {
    console.error('[sendEmail] ❌ Failed for', email, err);
  }
}

// ─── PANEL AVAILABILITY HELPERS ───────────────────────────────────────────────
//
// These utilities are the ONLY additions to the existing code.
// They do not touch any existing function, type, or component.
//
// checkPanelAvailability
//   Performs a fresh Firestore read to confirm that a specific panel
//   member (panelUid) is not already "Scheduled" for the given date
//   and time slot across L1 Technical, L2, and L2 Manager rounds.
//   `excludeCandidateId` is passed so the current candidate's own
//   record is never treated as a conflict with itself.
//
async function checkPanelAvailability(
  panelUid: string,
  date: string,
  slot: string,
  excludeCandidateId: string,
): Promise<{ available: boolean; conflictCandidateName?: string }> {
  if (!panelUid || !date || !slot) return { available: true };
  try {
    const snap = await getDocs(collection(db, 'candidates'));
    for (const d of snap.docs) {
      if (d.id === excludeCandidateId) continue;
      const data = d.data();

      // L1 Technical Round conflict
      if (
        data.l2Status     === 'Scheduled' &&
        data.l2PanelUid   === panelUid    &&
        data.l2ScheduledDate === date     &&
        data.l2TimeSlot   === slot
      ) {
        return { available: false, conflictCandidateName: data.candidateName || 'another candidate' };
      }

      // L2 Manager Round conflict
      if (
        data.l2ManagerStatus        === 'Scheduled' &&
        data.l2ManagerPanelUid      === panelUid    &&
        data.l2ManagerScheduledDate === date        &&
        data.l2ManagerTimeSlot      === slot
      ) {
        return { available: false, conflictCandidateName: data.candidateName || 'another candidate' };
      }
    }
    return { available: true };
  } catch (err) {
    console.error('[checkPanelAvailability] Firestore read error:', err);
    // Fail open so a Firestore error does not silently block scheduling.
    // The schedule button re-check below is the authoritative guard.
    return { available: true };
  }
}

// useConflictingPanelUids
//   React hook that rebuilds the set of unavailable panel UIDs
//   whenever the selected date or time slot changes.
//   Returns a Set<string> of UIDs that are already booked.
//
function useConflictingPanelUids(
  date: string,
  slot: string,
  excludeCandidateId: string,
): Set<string> {
  const [conflicting, setConflicting] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!date || !slot) {
      setConflicting(new Set());
      return;
    }
    let cancelled = false;
    getDocs(collection(db, 'candidates'))
      .then(snap => {
        if (cancelled) return;
        const booked = new Set<string>();
        snap.docs.forEach(d => {
          if (d.id === excludeCandidateId) return;
          const data = d.data();

          // L1 Technical Round
          if (
            data.l2Status        === 'Scheduled' &&
            data.l2PanelUid      &&
            data.l2ScheduledDate === date         &&
            data.l2TimeSlot      === slot
          ) {
            booked.add(data.l2PanelUid);
          }

          // L2 Manager Round
          if (
            data.l2ManagerStatus        === 'Scheduled' &&
            data.l2ManagerPanelUid      &&
            data.l2ManagerScheduledDate === date         &&
            data.l2ManagerTimeSlot      === slot
          ) {
            booked.add(data.l2ManagerPanelUid);
          }
        });
        setConflicting(booked);
      })
      .catch(err => {
        console.error('[useConflictingPanelUids] Firestore error:', err);
        if (!cancelled) setConflicting(new Set());
      });
    return () => { cancelled = true; };
  }, [date, slot, excludeCandidateId]);

  return conflicting;
}

// ─── END PANEL AVAILABILITY HELPERS ──────────────────────────────────────────

function useInterviewCountdown(linkSentAt: string | number, completed?: boolean) {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => {
    if (!linkSentAt || completed) return;

    const sentMs =
      typeof linkSentAt === 'string'
        ? new Date(linkSentAt).getTime()
        : Number(linkSentAt);

        const expiryMs =
        (linkSentAt as any)?.seconds
          ? (linkSentAt as any).seconds * 1000 + (48 * 60 * 60 * 1000)
          : new Date(linkSentAt).getTime() + (48 * 60 * 60 * 1000);

    const update = () => {
      const remain = Math.max(
        0,
        Math.floor((expiryMs - Date.now()) / 1000)
      );

      setSecondsLeft(remain);

      if (remain <= 0) {
        setIsExpired(true);
      }
    };

    update();

    const timer = setInterval(update, 1000);

    return () => clearInterval(timer);
  }, [linkSentAt, completed]);

  return { secondsLeft, isExpired };
}
// ─── AI INTERVIEW LIVE COUNTDOWN ─────────────────────────────────────────────
 
const AIInterviewCountdown: React.FC<{
  sentAt: any;
  isCompleted: boolean;
}> = ({ sentAt, isCompleted }) => {

  type Display = { text: string; color: string; bg: string; border: string; icon: string };

  const [display, setDisplay] = React.useState<Display | null>(null);

  React.useEffect(() => {
    if (isCompleted) {
      setDisplay({
        text: 'Interview Completed',
        color: '#059669', bg: '#ECFDF5', border: '#6EE7B7', icon: '✅',
      });
      return;
    }

    if (!sentAt) {
      setDisplay(null);
      return;
    }

    // Parse Firestore Timestamp correctly
    const sentMs: number =
      sentAt?.seconds        ? sentAt.seconds * 1000
      : sentAt?.toMillis     ? sentAt.toMillis()
      : typeof sentAt === 'number' ? sentAt
      : new Date(sentAt).getTime();

    if (!sentMs || isNaN(sentMs)) {
      setDisplay(null);
      return;
    }

    const expiryMs = sentMs + 48 * 60 * 60 * 1000;

    const tick = () => {
      const remaining = expiryMs - Date.now();

      if (remaining <= 0) {
        setDisplay({
          text: 'Link expired',
          color: '#DC2626', bg: '#FEF2F2', border: '#FECACA', icon: '❌',
        });
        return;
      }

      const totalSecs = Math.floor(remaining / 1000);
      const hrs  = Math.floor(totalSecs / 3600);
      const mins = Math.floor((totalSecs % 3600) / 60);
      const secs = totalSecs % 60;
      const pad  = (n: number) => String(n).padStart(2, '0');

      const isUrgent  = totalSecs < 3600;
      const isWarning = totalSecs < 7200;

      setDisplay({
        text:   `${pad(hrs)}:${pad(mins)}:${pad(secs)} remaining`,
        color:  isUrgent ? '#DC2626' : isWarning ? '#D97706' : '#059669',
        bg:     isUrgent ? '#FEF2F2' : isWarning ? '#FFFBEB' : '#F0FDF4',
        border: isUrgent ? '#FECACA' : isWarning ? '#FDE68A' : '#86EFAC',
        icon:   isUrgent ? '🔴'      : isWarning ? '⚠️'      : '⏳',
      });
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);

  }, [sentAt, isCompleted]);

  if (!display) return null;

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      fontSize: '13px', fontWeight: 600,
      color: display.color, background: display.bg,
      border: `1px solid ${display.border}`,
      borderRadius: '6px', padding: '3px 10px',
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap',
    }}>
      {display.icon} {display.text}
    </span>
  );
};
 
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
    </div>
  );
};

// ─── SHARED STYLES ────────────────────────────────────────────────────────────
const iBox: React.CSSProperties  = { background: '#F9FAFB', borderRadius: '8px', padding: '10px 12px', border: '1px solid #E5E7EB' };
const lbl: React.CSSProperties   = { fontSize: '12px', fontWeight: '600', color: '#6B7280', marginBottom: '4px' };
const saved: React.CSSProperties = { fontSize: '13px', lineHeight: '1.6', wordBreak: 'break-word', whiteSpace: 'pre-wrap' };
const errS: React.CSSProperties  = { color: '#DC2626', fontSize: '12px', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' };

function formatScheduledDateTime(dateValue: string | undefined, timeSlot: string | undefined): { datePart: string; timePart: string | null } {
  const datePart = dateValue
    ? new Date(dateValue).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';

  if (!timeSlot) return { datePart, timePart: null };

  // Normalize "09:00am - 10:00am" → "9:00 AM – 10:00 AM"
  const formatHalf = (half: string): string | null => {
    const m = half.trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
    if (!m) return null;
    const hour = parseInt(m[1], 10);
    const minute = m[2];
    const meridiem = m[3].toUpperCase();
    return `${hour}:${minute} ${meridiem}`;
  };

  const [startRaw, endRaw] = timeSlot.split('-');
  const start = startRaw ? formatHalf(startRaw) : null;
  const end = endRaw ? formatHalf(endRaw) : null;

  if (start && end) return { datePart, timePart: `${start} – ${end}` };

  // Fallback: couldn't parse the slot format — show it exactly as saved
  // rather than dropping it, so unexpected formats still display.
  return { datePart, timePart: timeSlot };
}
const TIME_SLOTS = [
  '09:00am - 10:00am', '10:00am - 11:00am', '11:00am - 12:00pm',
  '01:00pm - 02:00pm', '02:00pm - 03:00pm', '03:00pm - 04:00pm', '04:00pm - 05:00pm',
];

// ─── SHARED SLOT AVAILABILITY HELPERS (used by L1, L2, L2 Manager, HR Round) ──
function parseSlotStart(slotLabel: string): { hour: number; minute: number } | null {
  const startPart = slotLabel.split('-')[0]?.trim();
  if (!startPart) return null;
  const m = startPart.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  const meridiem = m[3].toLowerCase();
  if (meridiem === 'pm' && hour !== 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  return { hour, minute };
}

// Returns true if `slotLabel` starts at least `bufferMinutes` minutes from now,
// given the currently selected `dateValue`. Future dates always pass.
// bufferMinutes defaults to 30 (L1 / L2 / L2 Manager); HR Round passes 60.
function isSlotSelectable(slotLabel: string, dateValue: string, todayStr: string, bufferMinutes: number = 30): boolean {
  if (!dateValue) return true;
  if (dateValue !== todayStr) return true;
  const parsed = parseSlotStart(slotLabel);
  if (!parsed) return true;
  const slotDate = new Date();
  slotDate.setHours(parsed.hour, parsed.minute, 0, 0);
  const minSelectable = new Date(Date.now() + bufferMinutes * 60 * 1000);
  return slotDate.getTime() >= minSelectable.getTime();
}
// ─── END SHARED SLOT AVAILABILITY HELPERS ─────────────────────────────────────

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

  // Map 'Expired' to a red badge manually since normalizeStatus may not know it
  const displayBadge = status === 'On Hold'
    ? <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '999px', background: '#FEF3C7', color: '#92400E' }}>⏸ On Hold</span>
    : status === 'Expired'
    ? <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '999px', background: '#FEE2E2', color: '#991B1B' }}>Expired</span>
    : <Badge className={normalized.color}>{isLocked ? 'Locked' : normalized.name}</Badge>;
  return (
    <div style={{
      borderRadius: '12px',
      border: `1.5px solid ${status === 'Expired' ? '#FECACA' : isActive ? '#7C3AED' : '#E5E7EB'}`,
      boxShadow: isActive ? '0 2px 10px rgba(124,58,237,0.08)' : 'none',
      background: 'white',
    }}>
      <div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #F3F4F6' }}>
        <h3 style={{ fontWeight: 'bold', fontSize: '15px', margin: 0 }}>{title}</h3>
        {displayBadge}
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

const ResumeReviewCard: React.FC<{
  candidate: Candidate; role: UserRole | null; user: any;
  panelUsers: PanelUser[];
  history: CandidateHistoryItem[];
  onAction: (action: string, payload: any) => void;
}> = ({ candidate, role, user, panelUsers, history, onAction }) => {
  const [feedback, setFeedback] = useState('');
  const [panelUid, setPanelUid] = useState('');
  const [err, setErr]           = useState('');

  const status          = (candidate.resumeReviewStatus || 'Pending') as string;
  const assignedPanel   = (candidate as any).resumePanelUid;
  const panelName       = (candidate as any).resumePanelName;
  const panelFeedback   = (candidate as any).resumePanelFeedback;
  const panelDecision   = (candidate as any).resumePanelDecision;
  const hrFeedback      = (candidate as any).resumeHRFeedback;

  const isDone          = ['Accepted', 'Rejected'].includes(status);
  const isHR            = role === 'hr';
  const isPanel         = role === 'panel';
  const isAssignedPanel = isPanel && user?.uid === assignedPanel;

  const step1Done   = !!assignedPanel || isDone;
  const step2Done   = !!panelFeedback;
  const step3Active = status === 'Panel Reviewed';

  const handleAssign = () => {
    if (!feedback.trim()) { setErr('HR feedback is required.'); return; }
    if (!panelUid)        { setErr('Please select a panel member.'); return; }
    setErr('');
    const panel = panelUsers.find(p => p.uid === panelUid);
    onAction('assign-panel', {
      panelUid,
      panelName:  panel?.name || panel?.email || 'Panel',
      panelEmail: panel?.email || '',
      feedback:   feedback.trim(),
    });
  };

  const handleHRReject = () => {
    if (!feedback.trim()) { setErr('HR feedback is required before rejecting.'); return; }
    setErr('');
    onAction('reject', { feedback: feedback.trim() });
  };

  const handlePanelSubmit = (decision: 'panel-accept' | 'panel-reject') => {
    if (!feedback.trim()) { setErr('Panel feedback is required.'); return; }
    setErr('');
    onAction(decision, { feedback: feedback.trim() });
  };

  const dotStyle = (done: boolean, active: boolean, color = '#7C3AED'): React.CSSProperties => ({
    width: '10px', height: '10px', borderRadius: '50%', flexShrink: 0, marginTop: '2px',
    background: done ? '#1D9E75' : active ? color : 'transparent',
    border: done ? 'none' : active ? 'none' : '1.5px dashed #B4B2A9',
  });

  const timelineRow: React.CSSProperties = { display: 'flex', gap: 0 };
  const spineCol: React.CSSProperties = { width: '36px', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '2px', flexShrink: 0 };
  const vline: React.CSSProperties = { flex: 1, width: '1.5px', background: '#E5E7EB', margin: '4px 0', minHeight: '16px' };
  const bodyCol: React.CSSProperties = { flex: 1, paddingBottom: '16px' };

  const whoLabel = (pill: string, pillColor: { bg: string; text: string }, label: string): React.ReactNode => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '5px' }}>
      <span style={{ fontSize: '10px', fontWeight: '700', padding: '1px 7px', borderRadius: '999px', background: pillColor.bg, color: pillColor.text }}>{pill}</span>
      <span style={{ fontSize: '11px', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
    </div>
  );

  const hrPill  = { bg: '#FAEEDA', text: '#92400E' };
  const panPill = { bg: '#E1F5EE', text: '#065F46' };

  const badgeMap: Record<string, { label: string; bg: string; color: string }> = {
    Pending:          { label: 'Pending',        bg: '#EDE9FE', color: '#5B21B6' },
    'Panel Assigned': { label: 'Panel Assigned', bg: '#EFF6FF', color: '#1D4ED8' },
    'Panel Reviewed': { label: 'Panel Reviewed', bg: '#FEF3C7', color: '#92400E' },
    Accepted:         { label: 'Accepted',       bg: '#D1FAE5', color: '#065F46' },
    Rejected:         { label: 'Rejected',       bg: '#FEE2E2', color: '#991B1B' },
    'On Hold':        { label: 'On Hold',        bg: '#FEF3C7', color: '#92400E' },
  };
  const badge = badgeMap[status] || { label: status, bg: '#F3F4F6', color: '#374151' };
  const aiScore = (candidate as any).matchScore ?? (candidate as any).aiScore ?? null;
  const isHighScore = typeof aiScore === 'number' && aiScore >= 80;
  return (
    <div style={{
      borderRadius: '12px',
      border: `1.5px solid ${['Pending','Panel Assigned','Panel Reviewed'].includes(status) ? '#7C3AED' : '#E5E7EB'}`,
      boxShadow: ['Pending','Panel Assigned','Panel Reviewed'].includes(status) ? '0 2px 10px rgba(124,58,237,0.08)' : 'none',
      background: 'white', overflow: 'hidden',
    }}>
      <div style={{ padding: '13px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #F3F4F6' }}>
        <h3 style={{ fontWeight: 'bold', fontSize: '15px', margin: 0 }}>Resume Review</h3>
        <span style={{ fontSize: '11px', fontWeight: '700', padding: '3px 10px', borderRadius: '999px', background: badge.bg, color: badge.color }}>{badge.label}</span>
      </div>
      <div style={{ padding: '10px 16px 14px' }}>

{/* ── HIGH SCORE PATH (≥ 80): auto-advanced, show result only ── */}
{/* ── HIGH SCORE PATH (≥ 80): auto-advanced, show result only ── */}
{isHighScore && status === 'Accepted' && (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
    <div style={{
      background: aiScore >= 90 ? '#ECFDF5' : '#F0FDF4',
      border: `1.5px solid ${aiScore >= 90 ? '#6EE7B7' : '#86EFAC'}`,
      borderRadius: '10px', padding: '14px 16px',
      display: 'flex', alignItems: 'center', gap: '14px',
    }}>
      <div style={{
        width: '64px', height: '64px', borderRadius: '50%',
        border: `4px solid ${aiScore >= 90 ? '#059669' : '#16A34A'}`,
        background: 'white', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <span style={{ fontSize: '18px', fontWeight: '900', color: aiScore >= 90 ? '#059669' : '#16A34A', lineHeight: 1 }}>{aiScore}%</span>
        <span style={{ fontSize: '9px', color: '#6B7280', fontWeight: '600' }}>score</span>
      </div>
      <div>
        <p style={{ fontSize: '14px', fontWeight: '700', color: aiScore >= 90 ? '#059669' : '#16A34A', margin: '0 0 3px' }}>
          {aiScore >= 90 ? '🌟 Excellent Match — Auto Advanced' : '✅ Good Match — Auto Advanced'}
        </p>
        <p style={{ fontSize: '12px', color: '#6B7280', margin: 0 }}>
          AI interview link has been automatically sent to the candidate.
        </p>
      </div>
    </div>
    <UpdatedByBadge history={history} stage="Resume Review" actions={['accept']} />
  </div>
)}

{/* ── HIGH SCORE but still Pending (edge case: page loaded before auto-advance completed) ── */}
{isHighScore && status === 'Pending' && (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#ECFDF5', border: '1px solid #6EE7B7', borderRadius: '8px', padding: '12px 14px' }}>
      <span style={{ fontSize: '20px' }}>⏳</span>
      <p style={{ fontSize: '13px', color: '#059669', fontWeight: '600', margin: 0 }}>
        Score {aiScore}% — should auto-advance to L1. If this persists, send the link manually below.
      </p>
    </div>
    {role === 'hr' && (
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          onClick={() => onAction('accept', { feedback: `Manually advanced — AI match score ${aiScore}%` })}
          style={{ background: '#7C3AED', color: 'white', fontWeight: 'bold' }}
        >
          ✓ Send Interview Link Now
        </Button>
      </div>
    )}
  </div>
)}

{/* ── LOW SCORE PATH (< 80): manual HR review ── */}
{!isHighScore && (
  <>
    {/* STEP 1 */}
    <div style={timelineRow}>
      <div style={spineCol}>
        <div style={dotStyle(isDone, !isDone && status === 'Pending', '#F59E0B')} />
        <div style={vline} />
      </div>
      <div style={bodyCol}>
        {whoLabel('HR', hrPill, isDone ? 'Step 1 — done' : 'Step 1 — active')}

        {/* Score banner for low scorers */}
        {aiScore !== null && status === 'Pending' && isHR && (
          <div style={{
            background: '#FEF9C3', border: '1px solid #FDE68A',
            borderRadius: '8px', padding: '10px 14px', marginBottom: '8px',
            display: 'flex', alignItems: 'center', gap: '12px',
          }}>
            <div style={{
              width: '48px', height: '48px', borderRadius: '50%',
              border: '3px solid #D97706', background: 'white',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <span style={{ fontSize: '14px', fontWeight: '900', color: '#D97706', lineHeight: 1 }}>{aiScore}%</span>
            </div>
            <div>
              <p style={{ fontSize: '12px', fontWeight: '700', color: '#92400E', margin: '0 0 2px' }}>⚠️ Below Threshold</p>
              <p style={{ fontSize: '11px', color: '#78350F', margin: 0 }}>Score &lt; 80% — HR review required before sending interview link.</p>
            </div>
          </div>
        )}

        {isDone && (
          <div style={{ background: '#F9FAFB', borderRadius: '8px', padding: '10px 12px', border: '1px solid #E5E7EB', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <p style={{ fontSize: '13px', fontWeight: '600', color: '#374151', margin: 0 }}>
            {status === 'Rejected' ? '✕ Resume Rejected' : '✓ Moved to Screening Round'}            </p>
            {hrFeedback && <p style={{ fontSize: '12px', color: '#6B7280', margin: 0 }}>"{hrFeedback}"</p>}
            <UpdatedByBadge history={history} stage="Resume Review" actions={['accept', 'reject']} />
          </div>
        )}
{isHR && status === 'Pending' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div>
              <p style={{ fontSize: '11px', fontWeight: '600', color: '#6B7280', marginBottom: '5px' }}>HR Feedback <span style={{ color: '#DC2626' }}>*</span></p>
              <Textarea
                placeholder="Write your resume review notes…"
                value={feedback}
                onChange={e => { setFeedback(e.target.value); if (e.target.value.trim()) setErr(''); }}
                style={{ resize: 'vertical', minHeight: '80px' }}
              />
            </div>
            {err && <p style={{ color: '#DC2626', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}><AlertCircle className="h-3 w-3" />{err}</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Button variant="destructive" onClick={handleHRReject}>✕ Reject</Button>
              <Button
                onClick={() => {
                  if (!feedback.trim()) { setErr('Note is required to put on hold.'); return; }
                  setErr('');
                  onAction('hold', { feedback: feedback.trim() });
                }}
                style={{ background: '#F59E0B', color: 'white', fontWeight: 'bold' }}
              >
                ⏸ Hold
              </Button>
              <Button
                onClick={() => {
                  if (!feedback.trim()) { setErr('HR feedback is required.'); return; }
                  setErr('');
                  onAction('accept', { feedback: feedback.trim() });
                }}
                style={{ background: '#7C3AED', color: 'white', fontWeight: 'bold' }}
              >
                ✓ Move to Screening Round
              </Button>
            </div>
          </div>
        )}

        {isHR && status === 'On Hold' && (
          <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '10px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <p style={{ fontSize: '13px', fontWeight: 700, color: '#92400E', margin: 0 }}>⏸ On Hold</p>
            {(candidate as any).resumeHoldFeedback && (
              <p style={{ fontSize: '12px', color: '#78350F', margin: 0 }}>"{(candidate as any).resumeHoldFeedback}"</p>
            )}
            <UpdatedByBadge history={history} stage="Resume Review" actions={['hold']} />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button onClick={() => onAction('resume', {})} style={{ background: '#7C3AED', color: 'white', fontWeight: 'bold' }}>▶ Resume</Button>
            </div>
          </div>
        )}

        {!isHR && (status === 'Pending' || status === 'On Hold') && (
          <p style={{ fontSize: '12px', color: '#9CA3AF' }}>Waiting for HR to review the resume.</p>
        )}
      </div>
    </div>
  </>
)}

</div>
</div>
);
}; 
function ScoreRing({ score, size, strokeWidth }: { score: number | null; size: number; strokeWidth: number }) {
  const r = (size / 2) - (strokeWidth / 2) - 2;
  const circumference = 2 * Math.PI * r;
  const pct = typeof score === 'number' ? Math.min(Math.max(score, 0), 100) : 0;
  const dash = (pct / 100) * circumference;
  const c = score === null || score === 0 ? { fill:'#FCEBEB', stroke:'#F7C1C1', arc:'#E24B4A', num:'#A32D2D', sub:'#791F1F' }
    : score <= 30 ? { fill:'#FCEBEB', stroke:'#F7C1C1', arc:'#E24B4A', num:'#A32D2D', sub:'#791F1F' }
    : score <= 50 ? { fill:'#FAEEDA', stroke:'#FAC775', arc:'#EF9F27', num:'#854F0B', sub:'#633806' }
    : score <= 65 ? { fill:'#FEF3C7', stroke:'#FDE68A', arc:'#F59E0B', num:'#78350F', sub:'#451A03' }
    : score <= 80 ? { fill:'#D1FAE5', stroke:'#6EE7B7', arc:'#10B981', num:'#065F46', sub:'#064E3B' }
    : { fill:'#ECFDF5', stroke:'#6EE7B7', arc:'#059669', num:'#064E3B', sub:'#022C22' };
  const cx = size / 2, cy = size / 2;
  const numSize = size >= 90 ? 22 : 15;
  const subSize = size >= 90 ? 11 : 9;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill={c.fill} stroke={c.stroke} strokeWidth="1" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#F1EFE8" strokeWidth={strokeWidth} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={c.arc} strokeWidth={strokeWidth}
        strokeDasharray={`${dash} ${circumference}`} strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`} />
      <text x={cx} y={size >= 90 ? cy - 4 : cy - 5} dominantBaseline="middle"
        textAnchor="middle" fontSize={numSize} fontWeight="600" fill={c.num}>{score ?? '—'}</text>
      <text x={cx} y={size >= 90 ? cy + 10 : cy + 7} dominantBaseline="middle"
        textAnchor="middle" fontSize={subSize} fill={c.sub}>/100</text>
    </svg>
  );
}
const AIInterviewCountdownWithFallback: React.FC<{
  candidate: Candidate;
  isCompleted: boolean;
}> = ({ candidate, isCompleted }) => {
  const [sentAt, setSentAt] = React.useState<any>(
    (candidate as any).l1AIInterviewSentAt ?? null
  );

  React.useEffect(() => {
    // If sentAt already exists on the candidate doc, use it directly
    if ((candidate as any).l1AIInterviewSentAt) {
      setSentAt((candidate as any).l1AIInterviewSentAt);
      return;
    }

    // Fallback: read createdAt from ai_interviews collection
    const token = (candidate as any).l1AIInterviewToken;
    if (!token) return;

    getDoc(doc(db, 'ai_interviews', token))
      .then(snap => {
        // token is a field, not the doc ID — so query by field
        return getDocs(
          query(
            collection(db, 'ai_interviews'),
            where('token', '==', token)
          )
        );
      })
      .then(snap => {
        if (!snap.empty) {
          const data = snap.docs[0].data();
          const ts = data.l1AIInterviewSentAt || data.createdAt;
          if (ts) {
            setSentAt(ts);
            // Also patch the candidate doc so future loads don't need this fallback
            updateDoc(doc(db, 'candidates', (candidate as any).id), {
              l1AIInterviewSentAt: ts,
            }).catch(() => {});
          }
        }
      })
      .catch(() => {});
  }, [(candidate as any).l1AIInterviewToken]);

  return (
    <AIInterviewCountdown
      sentAt={sentAt}
      isCompleted={isCompleted}
    />
  );
};

// ─── AI SCORE REPORT (shown inline inside L1 card once interview completes) ──
const AIScoreReport: React.FC<{
  candidate: Candidate;
  role: UserRole | null;
  status: string;
  savedFeedback: string | undefined;
  history: CandidateHistoryItem[];
  onAction: (action: string, payload: any) => void;
}> = ({ candidate, role, status, savedFeedback, history, onAction }) => {
  const [hrNotes,   setHrNotes]   = React.useState('');
  const [videoOpen, setVideoOpen] = React.useState(false);
  const [hrErr,     setHrErr]     = React.useState('');
  const [reScoring, setReScoring] = React.useState(false);

  const overallScore = (candidate as any).l1AIScore              ?? null;
  const techScore    = (candidate as any).l1AITechnicalScore     ?? null;
  const commScore    = (candidate as any).l1AICommunicationScore ?? null;
  const bodyScore    = (candidate as any).l1AIBodyLanguageScore  ?? null;
  const eyeScore     = (candidate as any).l1AIEyeContactScore    ?? null;
  const summary      = (candidate as any).l1AISummary            || '';
  const rec          = (candidate as any).l1AIRecommendation     || '';
  const strengths    = (candidate as any).l1AIStrengths          || [];
  const improvements = (candidate as any).l1AIImprovements       || [];

  const isDone = status === 'Selected' || status === 'Rejected';

  // Only show "failed" when score is genuinely 0 AND summary says it failed
  const evaluationFailed =
    overallScore === 0 &&
    (summary.toLowerCase().includes('failed') ||
     summary.toLowerCase().includes('could not') ||
     summary.toLowerCase().includes('manual review') ||
     summary === '');

  // ── Colour helpers ──────────────────────────────────────────────────────────
  const scoreColor = (s: number | null) => {
    if (s === null) return '#9CA3AF';
    if (s >= 80) return '#059669';
    if (s >= 65) return '#16A34A';
    if (s >= 50) return '#D97706';
    if (s >= 35) return '#F59E0B';
    return '#DC2626';
  };
  const scoreBg = (s: number | null) => {
    if (s === null) return '#F3F4F6';
    if (s >= 80) return '#D1FAE5';
    if (s >= 65) return '#ECFDF5';
    if (s >= 50) return '#FEF3C7';
    if (s >= 35) return '#FEF9C3';
    return '#FEE2E2';
  };
  const scoreBorder = (s: number | null) => {
    if (s === null) return '#E5E7EB';
    if (s >= 80) return '#6EE7B7';
    if (s >= 65) return '#86EFAC';
    if (s >= 50) return '#FCD34D';
    if (s >= 35) return '#FDE68A';
    return '#FECACA';
  };
  const scoreLabel = (s: number | null) => {
    if (s === null) return 'Pending';
    if (s >= 80) return 'Excellent';
    if (s >= 65) return 'Good';
    if (s >= 50) return 'Average';
    if (s >= 35) return 'Below Avg';
    return 'Needs Work';
  };

  const recBg    = rec === 'Strong Yes' ? '#DCFCE7' : rec === 'Yes' ? '#EFF6FF' : rec === 'Maybe' ? '#FFFBEB' : '#FEE2E2';
  const recColor = rec === 'Strong Yes' ? '#15803D' : rec === 'Yes' ? '#1D4ED8' : rec === 'Maybe' ? '#92400E'  : '#991B1B';
  const recIcon  = rec === 'Strong Yes' ? '🌟'      : rec === 'Yes' ? '✅'      : rec === 'Maybe' ? '🤔'       : '❌';

  const oColor  = scoreColor(overallScore);
  const oBg     = scoreBg(overallScore);
  const oBorder = scoreBorder(overallScore);

  const categories = [
    { label: 'Technical',     icon: '💻', score: techScore },
    { label: 'Communication', icon: '🗣️', score: commScore },
    { label: 'Body Language', icon: '🧍', score: bodyScore },
    { label: 'Eye Contact',   icon: '👁️', score: eyeScore  },
  ];

  // ── Re-score handler ────────────────────────────────────────────────────────
  const handleReScore = async () => {
    setReScoring(true);
    try {
      const token = (candidate as any).l1AIInterviewToken;
      if (!token) { alert('No interview token found.'); setReScoring(false); return; }
      const res  = await fetch('/api/interview/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          candidateId: candidate.id,
          questions:   [],
          jobRole:     (candidate as any).candidateDesignation || '',
          videoUrls:   [],
          codeAnswer:  '',
        }),
      });
      const data = await res.json();
      console.log('[ReScore] Result:', data);
      alert(`Re-scoring complete! Score: ${data.score}. The page will update automatically.`);
    } catch (err) {
      console.error('[ReScore] Failed:', err);
      alert('Re-scoring failed. Check the console.');
    } finally {
      setReScoring(false);
    }
  };

  return (
    <div style={{ border: '1.5px solid #E5E7EB', borderRadius: '14px', overflow: 'hidden', background: 'white' }}>

      {/* ── Header ── */}
      <div style={{ padding: '13px 16px', borderBottom: '1px solid #F3F4F6', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#FAFAFA' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '18px' }}>🤖</span>
          <span style={{ fontWeight: '700', fontSize: '14px', color: '#111827' }}>AI Interview Report</span>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>

{/* Status Badge */}
<span style={{
  fontSize: '11px',
  fontWeight: 700,
  padding: '3px 10px',
  borderRadius: '999px',
  background: evaluationFailed ? '#FEF3C7' : '#D1FAE5',
  color: evaluationFailed ? '#92400E' : '#065F46',
}}>
  {evaluationFailed ? '⚠ Needs Manual Review' : '✓ Interview Completed'}
</span>

{/* Export Button */}
<ExportInterviewButton candidateDoc={candidate} />

</div>
      </div>

      {/* ── Score section ── */}
      <div style={{ padding: '20px 16px 16px' }}>
        {evaluationFailed ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: '#FEF9C3', border: '1px solid #FDE68A', borderRadius: '10px', padding: '14px 16px' }}>
              <span style={{ fontSize: '24px', flexShrink: 0 }}>⚠️</span>
              <div>
                <p style={{ fontSize: '13px', fontWeight: 700, color: '#92400E', margin: '0 0 3px' }}>AI Evaluation Could Not Be Completed</p>
                <p style={{ fontSize: '12px', color: '#78350F', margin: 0 }}>
                  {summary || 'The interview could not be processed. Please review the recording manually or try re-scoring.'}
                </p>
              </div>
            </div>
            {role === 'hr' && (candidate as any).l1AIInterviewToken && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={handleReScore}
                  disabled={reScoring}
                  style={{ background: '#7C3AED', color: 'white', border: 'none', borderRadius: '8px', padding: '8px 16px', fontSize: '13px', fontWeight: 600, cursor: reScoring ? 'not-allowed' : 'pointer', opacity: reScoring ? 0.7 : 1 }}
                >
                  {reScoring ? '⏳ Re-scoring...' : '🔄 Re-score Interview'}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* Overall ring*/}
            <div style={{
  display: 'flex', alignItems: 'center', gap: '24px',
  background: '#F9FAFB', borderRadius: '12px',
  padding: '20px 24px', border: '1px solid #F1F5F9', flexWrap: 'wrap',
}}>
  {/* Overall — large */}
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
    <ScoreRing score={overallScore} size={96} strokeWidth={6} />
    <span style={{ fontSize: '12px', fontWeight: 600, color: '#374151' }}>Overall</span>
    <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '999px', fontWeight: 600,
      background: scoreBg(overallScore), color: scoreColor(overallScore), border: `1px solid ${scoreBorder(overallScore)}` }}>
      {scoreLabel(overallScore)}
    </span>
  </div>

  {/* Divider */}
  <div style={{ width: '1px', height: '80px', background: '#E5E7EB', flexShrink: 0 }} />

  {/* 4 categories — same smaller size */}
  <div style={{ display: 'flex', gap: '0px', flex: 1, alignItems: 'flex-start', justifyContent: 'space-evenly' }}>    {[
      { label: 'Technical',     score: techScore },
      { label: 'Communication', score: commScore },
      { label: 'Body language', score: bodyScore },
      { label: 'Eye contact',   score: eyeScore  },
    ].map(({ label, score }) => (
      <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
        <ScoreRing score={score} size={64} strokeWidth={5} />
        <span style={{ fontSize: '11px', fontWeight: 600, color: '#6B7280', textAlign: 'center' }}>{label}</span>
      </div>
    ))}
  </div>
</div>
          </div>
        )}
      </div>

      {/* ── AI Summary ── */}
      {!evaluationFailed && summary && (
        <div style={{ margin: '0 16px 14px', background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: '8px', padding: '10px 14px' }}>
          <p style={{ fontSize: '11px', fontWeight: 700, color: '#0369A1', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>📋 AI Summary</p>
          <p style={{ fontSize: '12px', color: '#374151', margin: 0, lineHeight: 1.7 }}>{summary}</p>
        </div>
      )}
{/* ── Strengths + Improvements + Video ── */}
{/* ── Strengths + Improvements ── */}
{!evaluationFailed && (strengths.length > 0 || improvements.length > 0) && (
  <div
    style={{
      padding: '0 16px 14px',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '14px',
      alignItems: 'stretch',
    }}
  >

    {/* LEFT — Strengths */}
    {strengths.length > 0 && (
      <div
        style={{
          background: '#F0FDF4',
          border: '1px solid #86EFAC',
          borderRadius: '12px',
          padding: '14px 16px',
          height: '100%',
        }}
      >
        <p
          style={{
            fontSize: '11px',
            fontWeight: 700,
            color: '#15803D',
            margin: '0 0 10px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          ✓ Strengths
        </p>

        {(strengths as string[]).map((s: string, i: number) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              marginBottom: i < strengths.length - 1 ? '8px' : 0,
            }}
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: '#16A34A',
                flexShrink: 0,
                marginTop: '6px',
              }}
            />
            <p
              style={{
                fontSize: '13px',
                color: '#374151',
                margin: 0,
                lineHeight: 1.6,
              }}
            >
              {s}
            </p>
          </div>
        ))}
      </div>
    )}

    {/* RIGHT — To Improve */}
    {improvements.length > 0 && (
      <div
        style={{
          background: '#FFFBEB',
          border: '1px solid #FCD34D',
          borderRadius: '12px',
          padding: '14px 16px',
          height: '100%',
        }}
      >
        <p
          style={{
            fontSize: '11px',
            fontWeight: 700,
            color: '#92400E',
            margin: '0 0 10px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          ↑ To Improve
        </p>

        {(improvements as string[]).map((s: string, i: number) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              marginBottom: i < improvements.length - 1 ? '8px' : 0,
            }}
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: '#D97706',
                flexShrink: 0,
                marginTop: '6px',
              }}
            />
            <p
              style={{
                fontSize: '13px',
                color: '#374151',
                margin: 0,
                lineHeight: 1.6,
              }}
            >
              {s}
            </p>
          </div>
        ))}
      </div>
    )}
  </div>
)}
    {/* Watch Recording */}
   {((candidate as any).l1AIVideoUrl || (candidate as any).l1VideoUrl || ((candidate as any).l1VideoUrls && (candidate as any).l1VideoUrls[0])) && (
      <div>
        <button
          onClick={() => {
            const url = (candidate as any).l1AIVideoUrl;
            setVideoOpen(prev => !prev);
          }}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '7px',
            fontSize: '13px', fontWeight: 600, padding: '8px 16px',
            background: '#F5F3FF', border: '1px solid #DDD6FE',
            borderRadius: '8px', color: '#6D28D9', cursor: 'pointer',
          }}
        >
          ▶ Watch Recording
          <span style={{ fontSize: '11px', color: '#9CA3AF', fontWeight: 400 }}>5 questions · ~12 min</span>
        </button>

        {videoOpen && (
          <div style={{
            marginTop: '10px', borderRadius: '10px', overflow: 'hidden',
            border: '1px solid #E5E7EB', background: '#000',
            aspectRatio: '16/9', width: '100%',
          }}>
            <video
              src={(candidate as any).l1AIVideoUrl}
              controls
              style={{ width: '100%', height: '100%', display: 'block' }}
            />
          </div>
        )}
      </div>
    )}

  

      {/* ── HR Decision panel (scores available) ── */}
      {/* ── HR Decision panel (scores available) ── */}
      {role === 'hr' && !isDone && !evaluationFailed && status !== 'On Hold' && (
        <div style={{ margin: '0 16px 16px', background: '#F8F7FF', borderRadius: '10px', padding: '14px', border: '1px solid #DDD6FE' }}>
          <p style={{ fontSize: '13px', fontWeight: 700, color: '#4C1D95', margin: '0 0 4px' }}>👤 Your Decision</p>
          <p style={{ fontSize: '12px', color: '#6B7280', margin: '0 0 10px' }}>
            Review the AI scores above, then move the candidate forward or reject.
          </p>
          <p style={{ fontSize: '11px', fontWeight: 600, color: '#374151', margin: '0 0 5px' }}>
            HR Notes <span style={{ color: '#DC2626' }}>*</span>
          </p>
          <Textarea
            placeholder="Add your review notes before deciding (required)…"
            value={hrNotes}
            onChange={e => { setHrNotes(e.target.value); if (e.target.value.trim()) setHrErr(''); }}
            style={{ resize: 'vertical', minHeight: '80px', marginBottom: '10px', background: 'white' }}
          />
          {hrErr && (
            <p style={{ color: '#DC2626', fontSize: '12px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <AlertCircle className="h-3 w-3" />{hrErr}
            </p>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button variant="destructive" onClick={() => {
              if (!hrNotes.trim()) { setHrErr('HR notes are required.'); return; }
              onAction('ai-reject', { feedback: hrNotes.trim(), aiScore: overallScore ?? 0 });
            }}>✕ Reject</Button>
            <Button onClick={() => {
              if (!hrNotes.trim()) { setHrErr('Note is required to put on hold.'); return; }
              onAction('hold', { feedback: hrNotes.trim() });
            }} style={{ background: '#F59E0B', color: 'white', fontWeight: 'bold' }}>⏸ Hold</Button>
            <Button onClick={() => {
              if (!hrNotes.trim()) { setHrErr('HR notes are required.'); return; }
              onAction('ai-select', { feedback: hrNotes.trim(), aiScore: overallScore ?? 0 });
            }} style={{ background: '#7C3AED', color: 'white', fontWeight: 'bold' }}>✓ Move to L1 Technical Round</Button>
          </div>
        </div>
      )}

      {/* ── On Hold (scores available) ── */}
      {role === 'hr' && !isDone && !evaluationFailed && status === 'On Hold' && (
        <div style={{ margin: '0 16px 16px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '10px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <p style={{ fontSize: '13px', fontWeight: 700, color: '#92400E', margin: 0 }}>⏸ On Hold</p>
          {(candidate as any).l1HoldFeedback && (
            <p style={{ fontSize: '12px', color: '#78350F', margin: 0 }}>"{(candidate as any).l1HoldFeedback}"</p>
          )}
          <UpdatedByBadge history={history} stage="L1 Interview" actions={['hold']} />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={() => onAction('resume', {})} style={{ background: '#7C3AED', color: 'white', fontWeight: 'bold' }}>▶ Resume</Button>
          </div>
        </div>
      )}

      {/* ── HR Decision panel (evaluation failed) ── */}
     {/* ── HR Decision panel (evaluation failed) ── */}
     {role === 'hr' && !isDone && evaluationFailed && status !== 'On Hold' && (
        <div style={{ margin: '0 16px 16px', background: '#FFF8F8', borderRadius: '10px', padding: '14px', border: '1px solid #FECACA' }}>
          <p style={{ fontSize: '13px', fontWeight: 700, color: '#991B1B', margin: '0 0 4px' }}>👤 Manual Decision Required</p>
          <p style={{ fontSize: '12px', color: '#6B7280', margin: '0 0 10px' }}>
            AI evaluation failed — review the recording manually, then decide.
          </p>
          <p style={{ fontSize: '11px', fontWeight: 600, color: '#374151', margin: '0 0 5px' }}>
            HR Notes <span style={{ color: '#DC2626' }}>*</span>
          </p>
          <Textarea
            placeholder="Add your review notes after watching the recording (required)…"
            value={hrNotes}
            onChange={e => { setHrNotes(e.target.value); if (e.target.value.trim()) setHrErr(''); }}
            style={{ resize: 'vertical', minHeight: '80px', marginBottom: '10px', background: 'white' }}
          />
          {hrErr && (
            <p style={{ color: '#DC2626', fontSize: '12px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <AlertCircle className="h-3 w-3" />{hrErr}
            </p>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button variant="destructive" onClick={() => {
              if (!hrNotes.trim()) { setHrErr('HR notes are required.'); return; }
              onAction('ai-reject', { feedback: hrNotes.trim(), aiScore: 0 });
            }}>✕ Reject</Button>
            <Button onClick={() => {
              if (!hrNotes.trim()) { setHrErr('Note is required to put on hold.'); return; }
              onAction('hold', { feedback: hrNotes.trim() });
            }} style={{ background: '#F59E0B', color: 'white', fontWeight: 'bold' }}>⏸ Hold</Button>
            <Button onClick={() => {
              if (!hrNotes.trim()) { setHrErr('HR notes are required.'); return; }
              onAction('ai-select', { feedback: hrNotes.trim(), aiScore: 0 });
            }} style={{ background: '#7C3AED', color: 'white', fontWeight: 'bold' }}>✓ Move to L1 Technical Round </Button>
          </div>
        </div>
      )}

      {/* ── On Hold (evaluation failed path) ── */}
      {role === 'hr' && !isDone && evaluationFailed && status === 'On Hold' && (
        <div style={{ margin: '0 16px 16px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '10px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <p style={{ fontSize: '13px', fontWeight: 700, color: '#92400E', margin: 0 }}>⏸ On Hold</p>
          {(candidate as any).l1HoldFeedback && (
            <p style={{ fontSize: '12px', color: '#78350F', margin: 0 }}>"{(candidate as any).l1HoldFeedback}"</p>
          )}
          <UpdatedByBadge history={history} stage="L1 Interview" actions={['hold']} />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={() => onAction('resume', {})} style={{ background: '#7C3AED', color: 'white', fontWeight: 'bold' }}>▶ Resume</Button>
          </div>
        </div>
      )}

      {/* ── Final decision (already made) ── */}
      {isDone && savedFeedback && (
        <div style={{ margin: '0 16px 16px', background: status === 'Rejected' ? '#FFF8F8' : '#F0FDF9', border: `1px solid ${status === 'Rejected' ? '#FECACA' : '#6EE7B7'}`, borderRadius: '8px', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <p style={{ fontSize: '12px', fontWeight: 700, margin: 0, color: status === 'Rejected' ? '#DC2626' : '#059669' }}>
          {status === 'Rejected' ? '✕ Rejected by HR' : '✓ Moved to L1 Technical Round by HR'}
          </p>
          <p style={{ fontSize: '12px', color: '#374151', margin: 0 }}>{savedFeedback}</p>
          <UpdatedByBadge history={history} stage="L1 Interview" actions={['ai-select', 'ai-reject']} />
        </div>
      )}

    </div>
  );
};

// ─── STAGE 2 & 3: L1 / L2 INTERVIEW ─────────────────────────────────────────
const InterviewStageCard: React.FC<{
  candidate: Candidate; role: UserRole | null; user: any;
  panelUsers: PanelUser[]; stageKey:
  | 'screening'
  | 'l1'
  | 'l2'
  | 'l2manager'
  | 'hr'; title: string;
  history: CandidateHistoryItem[];
  onAction: (action: string, payload: any) => void;
}> = ({ candidate, role, user, panelUsers, stageKey, title, history, onAction }) => {
  const [date, setDate]         = useState('');
  const [slot, setSlot]         = useState('');
  const [notes, setNotes]       = useState('');
  const [panelUid, setPanelUid] = useState('');
  const [feedback, setFeedback] = useState('');
  const [schedErr, setSchedErr] = useState('');
  const [aiLinkLoading, setAiLinkLoading] = useState(false);
  const [aiLinkSent, setAiLinkSent]       = useState(false);
  const [fbErr, setFbErr]       = useState('');

  // ── Panel availability state (only used for l2 and l2manager) ─────────────
  // `panelConflictMsg` holds the message shown when a previously selected
  // panel member becomes unavailable after date/slot is changed.
  const [panelConflictMsg, setPanelConflictMsg] = useState('');

  // Derive the set of UIDs that are already booked for the chosen date+slot.
  // The hook returns an empty Set when date or slot is not yet chosen so the
  // full panel list remains visible until the HR makes both selections.
  const conflictingUids = useConflictingPanelUids(
    (stageKey === 'l2' || stageKey === 'l2manager') ? date : '',
    (stageKey === 'l2' || stageKey === 'l2manager') ? slot : '',
    candidate.id,
  );

  // Filtered panel list: hides members who are already booked for this slot.
  const availablePanelUsers =
    (stageKey === 'l2' || stageKey === 'l2manager')
      ? panelUsers.filter(p => !conflictingUids.has(p.uid))
      : panelUsers;

  // Re-validate current panel selection whenever date or slot changes.
  // If the selected panel member is now in the conflict set, clear them and
  // show the inline conflict message.
  useEffect(() => {
    if (stageKey !== 'l2' && stageKey !== 'l2manager') return;
    if (!panelUid || !date || !slot) return;
    if (conflictingUids.has(panelUid)) {
      setPanelUid('');
      setPanelConflictMsg(
        'The selected panel member is already assigned to another interview for the chosen date and time slot. Please select another panel member.'
      );
    } else {
      setPanelConflictMsg('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, slot, conflictingUids]);
  // ── End panel availability state ──────────────────────────────────────────

  const today = new Date().toISOString().split('T')[0];
  // Time slots to render in the dropdown for l2/l2manager scheduling —
  // all slots for future dates, only the 30-min-buffer-valid ones for today.
  const visibleTimeSlots =
    (stageKey === 'l2' || stageKey === 'l2manager')
      ? TIME_SLOTS.filter(s => isSlotSelectable(s, date, today))
      : TIME_SLOTS;

  // If the currently selected date/slot combination becomes invalid
  // (e.g. user had a future-date slot selected, then changed the date to
  // today and that slot no longer has the required 30-min buffer), clear
  // the slot selection and reset the dropdown to its placeholder.
  useEffect(() => {
    if (stageKey !== 'l2' && stageKey !== 'l2manager') return;
    if (!slot) return;
    if (!isSlotSelectable(slot, date, today)) {
      setSlot('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, stageKey]);
  // ── End slot availability helpers ──────────────────────────────────────────

  const prefixMap = {
    screening: 'screening',
    l1: 'l1',
    l2: 'l2',
    l2manager: 'l2Manager',
    hr: 'hr',
  };
  
  const prefix = prefixMap[stageKey];
  
  const statusKey   = `${prefix}Status`;
  const dateKey     = `${prefix}ScheduledDate`;
  const slotKey     = `${prefix}TimeSlot`;
  const notesKey    = `${prefix}SchedulingNotes`;
  const fbKey       = `${prefix}Feedback`;
  const panelUidKey = `${prefix}PanelUid`;
  const panelNmKey  = `${prefix}PanelName`;

  const status        = (candidate as any)[statusKey]  || 'Locked';
  const savedDate     = (candidate as any)[dateKey];
  const savedSlot     = (candidate as any)[slotKey];
  const savedNotes    = (candidate as any)[notesKey];
  const savedFeedback = (candidate as any)[fbKey];
  const savedHoldFeedback = (candidate as any)[`${prefix}HoldFeedback`];
  const assignedPanel = (candidate as any)[panelUidKey];
  const panelName     = (candidate as any)[panelNmKey];

  const isLocked        = status === 'Locked';
  const isHR            = role === 'hr';
  const isPanel         = role === 'panel';
  const isAssignedPanel = isPanel && user?.uid === assignedPanel;

  const canHRSchedule    = isHR && status === 'Pending';
  const canPanelFeedback = isAssignedPanel && status === 'Scheduled';

 // 'Rescheduled' added: l1Status now stays 'Rescheduled' after a
  // candidate-initiated reschedule (previously flipped back to 'Scheduled'),
  // so this card must still recognize that status to keep displaying.
  const showScheduleInfo = ['Scheduled', 'Selected', 'Rejected', 'Rescheduled'].includes(status) && savedDate;
  const showFeedback = ['Selected', 'Rejected'].includes(status) && savedFeedback && (candidate as any)[`${stageKey}InterviewType`] !== 'ai';

  // ── handleSchedule — UNCHANGED logic, with one pre-save availability check added ──
  const handleSchedule = async () => {
    if (!panelUid)      { setSchedErr('Please select a panel member.'); return; }
    if (!date || !slot) { setSchedErr('Please select date and time.'); return; }
    if (!notes.trim())  { setSchedErr('Scheduling notes are required.'); return; }

    // ── Final live availability check (Layer 3) ──────────────────────────────
    // Performed only for the rounds that have panel availability validation.
    // This guards against two HR users scheduling the same panel member
    // simultaneously when both see an unfiltered dropdown.
    if (stageKey === 'l2' || stageKey === 'l2manager') {
      const check = await checkPanelAvailability(panelUid, date, slot, candidate.id);
      if (!check.available) {
        setSchedErr(
          'The selected panel member is no longer available for this interview slot. Please choose another panel member.'
        );
        setPanelUid('');
        return;
      }
    }
    // ── End final check ──────────────────────────────────────────────────────

    setSchedErr('');
    const panel = panelUsers.find(p => p.uid === panelUid);
    const panelEmail = panel?.email || '';
    onAction('schedule', {
      scheduledDate: date, timeSlot: slot, schedulingNotes: notes.trim(),
      panelUid, panelName: panel?.name || panel?.email || 'Panel', panelEmail,
    });
  };

  const handleAISchedule = async () => {
    if (!date)         { setSchedErr('Please select a deadline date.'); return; }
    if (!notes.trim()) { setSchedErr('Please add notes for the candidate.'); return; }
    setSchedErr('');
    setAiLinkLoading(true);
    try {
      await onAction('ai-schedule', { scheduledDate: date, schedulingNotes: notes.trim(), interviewType: 'ai'});
      setAiLinkSent(true);
    } catch (err) {
      console.error('AI schedule failed:', err);
      setSchedErr('Failed to send AI interview link. Please try again.');
    } finally {
      setAiLinkLoading(false);
    }
  };

  const handlePanelDecision = (action: 'panel-select' | 'panel-reject') => {
    if (!feedback.trim()) { setFbErr('Feedback is required.'); return; }
    setFbErr('');
    onAction(action, { feedback: feedback.trim() });
  };

  const nextStageLabel = stageKey === 'l1' ? 'L1 Technical Round' : stageKey === 'l2' ? 'L2 Manager' : 'HR Round';

  return (
    <StageShell title={title} status={status} isLocked={isLocked}>
      {showScheduleInfo && (
        <div style={{ border: '1.5px solid #E5E7EB', borderRadius: '12px', overflow: 'hidden', background: 'white' }}>
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <p style={{ fontSize: '13px', fontWeight: '700', color: '#374151', margin: 0 }}>📅 Schedule Information</p>
            <div>
              <p style={lbl}>Date & Time</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
  <p style={{ fontSize: '14px', color: '#111827', margin: 0 }}>
  {(() => {
      const { datePart, timePart } = formatScheduledDateTime(savedDate, savedSlot);
      return timePart ? `📅 ${datePart} • 🕘 ${timePart}` : `📅 ${datePart}`;
    })()}
  </p>
  {stageKey === 'l1' &&
 ['ai', 'manual'].includes((candidate as any).l1InterviewType) &&
 (candidate as any).l1AIInterviewSentAt && (
  <>
    <span style={{ color: '#9CA3AF' }}>—</span>
    <AIInterviewCountdownWithFallback
      candidate={candidate}
      isCompleted={(candidate as any).l1AIStatus === 'completed'}
    />
    </>
  )}
</div>
</div>
            {savedNotes && <div><p style={lbl}>📝 Scheduling Notes</p><p style={{ ...saved, color: '#374151', margin: 0 }}>{savedNotes}</p></div>}
            {panelName && <div><p style={lbl}>👤 Assigned Panel</p><p style={{ ...saved, color: '#1D4ED8', fontWeight: '600', margin: 0 }}>{panelName}</p></div>}
            <UpdatedByBadge history={history} stage={title} actions={['schedule']} />
          </div>
          {showFeedback && (
            <>
              <div style={{ borderTop: '1px solid #E5E7EB', background: '#F9FAFB', padding: '7px 16px' }}>
                <span style={{ fontSize: '11px', fontWeight: '700', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.07em' }}>💬 Interview Feedback</span>
              </div>
              <div style={{ padding: '14px 16px', background: status === 'Rejected' ? '#FFF8F8' : '#F6FEF9', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <p style={{ ...saved, color: status === 'Rejected' ? '#DC2626' : '#065F46', margin: 0 }}>{savedFeedback}</p>
                <UpdatedByBadge
  history={history}
  stage={stageKey === 'l2' ? 'L2 Interview' : title}
  actions={['panel-select', 'panel-reject']}
/>
              </div>
            </>
          )}
        </div>
      )}
     

{stageKey === 'l1' && (candidate as any).l1RescheduleUsed && (
  <div style={{
    border: '1.5px solid #DDD6FE', borderRadius: '12px', overflow: 'hidden',
    background: 'white',
  }}>
    <div style={{
      padding: '13px 16px', borderBottom: '1px solid #F3F4F6',
      display: 'flex', alignItems: 'center', gap: '8px', background: '#F8F7FF',
    }}>
      <span style={{ fontSize: '16px' }}>🔄</span>
      <span style={{ fontWeight: 700, fontSize: '14px', color: '#4C1D95' }}>Interview Rescheduled</span>
    </div>

    <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
        <div>
          <p style={{ fontSize: '11px', fontWeight: 700, color: '#9CA3AF', marginBottom: '4px', textTransform: 'uppercase' }}>
            Previous Schedule
          </p>
          <p style={{ fontSize: '13px', color: '#374151', margin: 0 }}>
            {(candidate as any).l1PreviousScheduledDate
              ? new Date((candidate as any).l1PreviousScheduledDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
              : '—'}
          </p>
          <p style={{ fontSize: '13px', color: '#374151', margin: 0 }}>
            {(candidate as any).l1PreviousTimeSlot || ''}
          </p>
        </div>
        <div>
          <p style={{ fontSize: '11px', fontWeight: 700, color: '#9CA3AF', marginBottom: '4px', textTransform: 'uppercase' }}>
            New Schedule
          </p>
          <p style={{ fontSize: '13px', color: '#111827', fontWeight: 600, margin: 0 }}>
            {(candidate as any).l1ScheduledDate
              ? new Date((candidate as any).l1ScheduledDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
              : '—'}
          </p>
          <p style={{ fontSize: '13px', color: '#111827', fontWeight: 600, margin: 0 }}>
            {(candidate as any).l1TimeSlot || ''}
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', paddingTop: '10px', borderTop: '1px dashed #E5E7EB' }}>
        <div>
          <p style={{ fontSize: '11px', fontWeight: 700, color: '#9CA3AF', marginBottom: '4px', textTransform: 'uppercase' }}>
            Requested By
          </p>
          <p style={{ fontSize: '13px', color: '#374151', margin: 0 }}>{(candidate as any).l1RescheduledBy || 'Candidate'}</p>
        </div>
        <div>
          <p style={{ fontSize: '11px', fontWeight: 700, color: '#9CA3AF', marginBottom: '4px', textTransform: 'uppercase' }}>
            Requested On
          </p>
          <p style={{ fontSize: '13px', color: '#374151', margin: 0 }}>
            {(candidate as any).l1RescheduledAt?.seconds
              ? new Date((candidate as any).l1RescheduledAt.seconds * 1000).toLocaleString('en-GB', {
                  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                })
              : '—'}
          </p>
        </div>
      </div>

      <p style={{ fontSize: '11px', color: '#9CA3AF', margin: 0 }}>
      The candidate has successfully rescheduled their interview. The updated interview invitation has been sent automatically.
      </p>
    </div>
  </div>
)}
{/* ── AI Interview: session expired/ended early ── */}
{stageKey === 'l1' &&
 (status === 'Expired' || (candidate as any).l1AIStatus === 'expired') &&
 ['ai', 'manual'].includes((candidate as any).l1InterviewType) && (
  <div style={{
    background: '#FFF8F8', border: '1.5px solid #FECACA',
    borderRadius: '12px', padding: '16px',
    display: 'flex', flexDirection: 'column', gap: '12px',
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <div style={{
        width: '48px', height: '48px', borderRadius: '50%',
        background: '#FEE2E2', display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: '22px', flexShrink: 0,
      }}>
        {(candidate as any).l1AIExpiredReason === 'candidate_ended' ? '⚠️' : '🔒'}
      </div>
      <div>
        <p style={{ fontSize: '14px', fontWeight: 700, color: '#991B1B', margin: '0 0 3px' }}>
          {(candidate as any).l1AIExpiredReason === 'candidate_ended'
            ? 'Candidate Ended Session Early'
            : (candidate as any).l1AIExpiredReason === 'tab_switch'
            ? 'Session Terminated — Tab Switch'
            : (candidate as any).l1AIExpiredReason === 'app_switch'
            ? 'Session Terminated — App Switch'
            : (candidate as any).l1AIExpiredReason === 'closed'
            ? 'Session Terminated — Browser Closed'
            : 'Interview Session Expired'}
        </p>
        <p style={{ fontSize: '12px', color: '#DC2626', margin: 0 }}>
          {(candidate as any).l1AIExpiredReason === 'candidate_ended'
            ? 'The candidate manually ended the session before completing all questions.'
            : 'The session was automatically terminated due to a security violation.'}
        </p>
      </div>
    </div>

    {/* Show partial answers if any were recorded */}
    {(candidate as any).l1AIExpiredAt && (
      <div style={{
        background: '#F9FAFB', border: '1px solid #E5E7EB',
        borderRadius: '8px', padding: '10px 14px', fontSize: '12px', color: '#6B7280',
      }}>
        Session ended at:{' '}
        {new Date(
          (candidate as any).l1AIExpiredAt?.seconds * 1000
        ).toLocaleString('en-IN', {
          day: '2-digit', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        })}
      </div>
    )}

    {/* HR actions */}
    {role === 'hr' && (
      <div style={{
        background: '#F8F7FF', borderRadius: '10px', padding: '14px',
        border: '1px solid #DDD6FE',
      }}>
        <p style={{ fontSize: '13px', fontWeight: 700, color: '#4C1D95', margin: '0 0 10px' }}>
          What would you like to do?
        </p>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={() => onAction('resend-ai-link', {})}
            style={{
              background: '#7C3AED', color: 'white', border: 'none',
              borderRadius: '8px', padding: '8px 16px', fontSize: '13px',
              fontWeight: 600, cursor: 'pointer',
            }}
          >
            🔄 Resend Interview Link
          </button>
          <button
            onClick={() => onAction('ai-reject', {
              feedback: `Session terminated: ${(candidate as any).l1AIExpiredReason || 'expired'}`,
              aiScore: 0,
            })}
            style={{
              background: 'white', color: '#DC2626',
              border: '1px solid #FECACA',
              borderRadius: '8px', padding: '8px 16px', fontSize: '13px',
              fontWeight: 600, cursor: 'pointer',
            }}
          >
            ✕ Reject Candidate
          </button>
        </div>
      </div>
    )}
  </div>
)}
    {/* ── AI Interview: waiting for candidate ── */}
    {stageKey === 'l1' &&
 (status === 'Scheduled' || status === 'Rescheduled') &&
 status !== 'Expired' &&
 ['ai', 'manual'].includes((candidate as any).l1InterviewType) &&
 !['completed', 'expired'].includes((candidate as any).l1AIStatus) &&
 (candidate as any).l1AIExpiredReason == null && (
   <AIInterviewStatusCard
     candidateId={candidate.id}
     candidateName={candidate.candidateName || ''}
     role={role}
     onDecision={(action, payload) => onAction(action, payload)}
   />
)}

      {/* ── MANUAL Interview: show link + countdown while pending ── */}
      {/* ── MANUAL Interview: completed ── */}
{stageKey === 'l1' &&
 (candidate as any).l1InterviewType === 'manual' &&
 (candidate as any).l1AIStatus !== 'completed' && (
        <div style={{
          border: '1.5px solid #DDD6FE',
          borderRadius: '12px',
          overflow: 'hidden',
          background: 'white',
        }}>
          {/* Header */}
          <div style={{
            padding: '13px 16px',
            borderBottom: '1px solid #F3F4F6',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: '#FAFAFA',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '18px' }}>📋</span>
              <span style={{ fontWeight: '700', fontSize: '14px', color: '#111827' }}>
                Manual Interview Link
              </span>
            </div>
            <AIInterviewCountdownWithFallback
  candidate={candidate}
  isCompleted={(candidate as any).l1AIStatus === 'completed'}
/>
          </div>

          {/* Link box */}
          <div style={{ padding: '16px' }}>
            <p style={{ fontSize: '12px', color: '#6B7280', marginBottom: '10px' }}>
              This link uses the project's interview questions. Share it with the candidate or copy it below.
            </p>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: '#F5F3FF',
              border: '1px solid #DDD6FE',
              borderRadius: '8px',
              padding: '10px 14px',
            }}>
              <span style={{
                flex: 1,
                fontSize: '12px',
                color: '#5B21B6',
                fontWeight: 600,
                wordBreak: 'break-all',
              }}>
                {(candidate as any).l1AIInterviewUrl || '—'}
              </span>
              <button
                onClick={() => {
                  const url = (candidate as any).l1AIInterviewUrl;
                  if (url) {
                    navigator.clipboard.writeText(url);
                  }
                }}
                style={{
                  background: '#7C3AED',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '6px 14px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                Copy
              </button>
            </div>

            {/* Questions preview */}
            {(candidate as any).projectQuestions?.length > 0 && (
              <div style={{ marginTop: '14px' }}>
                <p style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  color: '#6B7280',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  marginBottom: '8px',
                }}>
                  📝 Interview Questions ({(candidate as any).projectQuestions.length})
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {((candidate as any).projectQuestions as any[]).map((q: any, i: number) => (
                    <div key={i} style={{
                      display: 'flex',
                      gap: '10px',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      background: q.type === 'coding' ? '#EFF6FF' : '#F9FAFB',
                      border: `1px solid ${q.type === 'coding' ? '#BFDBFE' : '#E5E7EB'}`,
                    }}>
                      <span style={{
                        fontSize: '10px',
                        fontWeight: 700,
                        color: q.type === 'coding' ? '#1D4ED8' : '#6B7280',
                        background: q.type === 'coding' ? '#DBEAFE' : '#F3F4F6',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        alignSelf: 'flex-start',
                        flexShrink: 0,
                        marginTop: '1px',
                      }}>
                        {q.type === 'coding' ? '💻' : '📝'} Q{i + 1}
                      </span>
                      <span style={{ fontSize: '12px', color: '#374151', lineHeight: 1.5 }}>
                        {q.text}
                      </span>
                      {q.timerMinutes && (
                        <span style={{
                          fontSize: '10px',
                          color: '#1D4ED8',
                          fontWeight: 600,
                          flexShrink: 0,
                          alignSelf: 'flex-start',
                          marginTop: '2px',
                        }}>
                          ⏱ {q.timerMinutes}m
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}



      {/* ── AI Interview: inline score report in L1 once completed ── */}
      {stageKey === 'l1' &&
       ['ai', 'manual'].includes((candidate as any).l1InterviewType) &&
       (candidate as any).l1AIStatus === 'completed' && (
        <AIScoreReport
          candidate={candidate}
          role={role}
          status={status}
          savedFeedback={savedFeedback}
          history={history}
          onAction={onAction}
        />
      )}

{canHRSchedule && (stageKey === 'l2' || stageKey === 'l2manager') && (
        <div style={{ background: '#F9FAFB', borderRadius: '10px', padding: '14px', border: '1px solid #E5E7EB' }}>
          <p style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '12px' }}>Schedule {title}</p>

          {/* ── Date & Slot — rendered FIRST so the panel list filters immediately ── */}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
            <div style={{ position: 'relative', minWidth: '150px' }}>
              <Calendar className="h-4 w-4" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF', pointerEvents: 'none' }} />
              <Input
                type="date"
                value={date}
                min={today}
                onChange={e => { setDate(e.target.value); setSchedErr(''); setPanelConflictMsg(''); }}
                className="pl-10"
                style={{ background: 'white', borderRadius: '8px' }}
              />
            </div>
            <select
              value={slot}
              onChange={e => { setSlot(e.target.value); setSchedErr(''); setPanelConflictMsg(''); }}
              style={{ borderRadius: '8px', border: '1px solid #E5E7EB', padding: '9px', background: 'white', flex: 1, minWidth: '160px', fontSize: '13px' }}
            >
              <option value="">Select a time slot</option>
              {visibleTimeSlots.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* ── Panel member dropdown — filtered by availability ── */}
          <p style={{ ...lbl, marginBottom: '6px' }}>
            Assign Panel Member <span style={{ color: '#DC2626' }}>*</span>
            {date && slot && conflictingUids.size > 0 && (
              <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 600, color: '#D97706', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '999px', padding: '1px 8px' }}>
                {conflictingUids.size} member{conflictingUids.size > 1 ? 's' : ''} unavailable for this slot
              </span>
            )}
          </p>
          <select
            value={panelUid}
            onChange={e => {
              setPanelUid(e.target.value);
              if (e.target.value) { setSchedErr(''); setPanelConflictMsg(''); }
            }}
            style={{ width: '100%', borderRadius: '8px', border: `1px solid ${panelConflictMsg ? '#FECACA' : '#E5E7EB'}`, padding: '9px 12px', fontSize: '13px', marginBottom: '4px', background: 'white' }}
          >
            <option value="">— Select Panel Member —</option>
            {availablePanelUsers.map(p => (
              <option key={p.uid} value={p.uid}>{p.name ? `${p.name} (${p.email})` : p.email || `UID: ${p.uid}`}</option>
            ))}
          </select>

          {/* Panel conflict message (Layer 2: re-validation after date/slot change) */}
          {panelConflictMsg && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: '8px',
              background: '#FEF2F2', border: '1px solid #FECACA',
              borderRadius: '8px', padding: '10px 12px', marginBottom: '10px',
            }}>
              <AlertCircle className="h-4 w-4" style={{ color: '#DC2626', flexShrink: 0, marginTop: '1px' }} />
              <p style={{ fontSize: '12px', color: '#DC2626', margin: 0, lineHeight: 1.5 }}>
                {panelConflictMsg}
              </p>
            </div>
          )}

          {/* Informational note when date+slot are set and panel list has been filtered */}
          {date && slot && conflictingUids.size > 0 && !panelConflictMsg && (
            <p style={{ fontSize: '11px', color: '#9CA3AF', marginBottom: '10px' }}>
              Only panel members who are free for this slot are shown above.
            </p>
          )}

          <p style={{ ...lbl, marginBottom: '6px', marginTop: '4px' }}>Scheduling Notes <span style={{ color: '#DC2626' }}>*</span></p>
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
          <Textarea placeholder="Enter your technical interview feedback (mandatory)…" value={feedback} onChange={e => { setFeedback(e.target.value); if (e.target.value.trim()) setFbErr(''); }} style={{ resize: 'vertical', minHeight: '90px' }} />
          {fbErr && <p style={errS}><AlertCircle className="h-3 w-3" />{fbErr}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
            <Button variant="destructive" onClick={() => handlePanelDecision('panel-reject')}>✕ Reject</Button>
            <Button onClick={() => {
              if (!feedback.trim()) { setFbErr('Note is required to put on hold.'); return; }
              setFbErr('');
              onAction('hold', { feedback: feedback.trim() });
            }} style={{ background: '#F59E0B', color: 'white', fontWeight: 'bold' }}>⏸ Hold</Button>
            <Button variant="default" onClick={() => handlePanelDecision('panel-select')} style={{ background: '#059669', color: 'white' }}>✓ Move to {nextStageLabel}</Button>
          </div>
        </div>
      )}

     {/* Panel On Hold view */}
{isAssignedPanel && status === 'On Hold' && (
  <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '10px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
    <p style={{ fontSize: '13px', fontWeight: 700, color: '#92400E', margin: 0 }}>⏸ On Hold</p>
    {savedHoldFeedback && (
      <p style={{ fontSize: '12px', color: '#78350F', margin: 0 }}>"{savedHoldFeedback}"</p>
    )}
    <UpdatedByBadge history={history} stage={stageKey === 'l2' ? 'L2 Interview' : title} actions={['hold']} />
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <Button onClick={() => onAction('resume', {})} style={{ background: '#7C3AED', color: 'white', fontWeight: 'bold' }}>▶ Resume</Button>
    </div>
  </div>
)}

{/* HR On Hold view — full access for L1 and L2, read-only for others */}
{isHR && status === 'On Hold' && (
  (stageKey === 'l1' || stageKey === 'l2') ? (
    <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '10px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <p style={{ fontSize: '13px', fontWeight: 700, color: '#92400E', margin: 0 }}>⏸ On Hold</p>
      {savedHoldFeedback && (
        <p style={{ fontSize: '12px', color: '#78350F', margin: 0 }}>"{savedHoldFeedback}"</p>
      )}
      <UpdatedByBadge history={history} stage={stageKey === 'l2' ? 'L2 Interview' : title} actions={['hold']} />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button onClick={() => onAction('resume', {})} style={{ background: '#7C3AED', color: 'white', fontWeight: 'bold' }}>▶ Resume</Button>
      </div>
    </div>
  ) : (
    <ReadOnlyNote msg="This candidate is currently on hold by the assigned panel member." />
  )
)}

      {isHR && status === 'Scheduled' && (candidate as any).l1InterviewType !== 'ai' && (
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
  const status = candidate.hrStatus || 'Pending';
  const isHR   = role === 'hr';

  // ── Time slot filtering — reuses the shared L1/L2 helper, 1-hour buffer for HR ──
  const visibleTimeSlots = TIME_SLOTS.filter(s => isSlotSelectable(s, date, today, 60));

  useEffect(() => {
    if (!slot) return;
    if (!isSlotSelectable(slot, date, today, 60)) {
      setSlot('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);
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
              {(() => {
                  const { datePart, timePart } = formatScheduledDateTime(candidate.hrScheduledDate, candidate.hrTimeSlot);
                  return timePart ? `📅 ${datePart} • 🕘 ${timePart}` : `📅 ${datePart}`;
                })()}
              </p>
            </div>
            {candidate.hrSchedulingNotes && <div><p style={lbl}>📝 Scheduling Notes</p><p style={{ ...saved, color: '#374151', margin: 0 }}>{candidate.hrSchedulingNotes}</p></div>}
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
            <select
              value={slot}
              onChange={e => setSlot(e.target.value)}
              disabled={visibleTimeSlots.length === 0}
              style={{ borderRadius: '8px', border: '1px solid #E5E7EB', padding: '9px', background: visibleTimeSlots.length === 0 ? '#F3F4F6' : 'white', flex: 1, minWidth: '160px', fontSize: '13px', cursor: visibleTimeSlots.length === 0 ? 'not-allowed' : 'pointer' }}
            >
              <option value="">{visibleTimeSlots.length === 0 ? 'No slots available for this date' : 'Select a time slot'}</option>
              {visibleTimeSlots.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <p style={{ ...lbl, marginBottom: '6px' }}>Scheduling Notes <span style={{ color: '#DC2626' }}>*</span></p>
          <Textarea placeholder="Add notes for this HR round…" value={notes} onChange={e => { setNotes(e.target.value); if (e.target.value.trim()) setSchedErr(''); }} style={{ resize: 'vertical', minHeight: '80px', background: 'white' }} />
          {schedErr && <p style={errS}><AlertCircle className="h-3 w-3" />{schedErr}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
            <Button onClick={handleSchedule} style={{ background: '#7C3AED', color: 'white', fontWeight: 'bold' }}>📅 Schedule</Button>
          </div>
        </div>
      )}
     {isHR && status === 'Scheduled' && (
        <>
          <p style={{ ...lbl, marginBottom: '2px' }}>Interview Feedback <span style={{ color: '#DC2626' }}>*</span></p>
          <Textarea placeholder="Enter post-HR-round feedback (mandatory)…" value={feedback} onChange={e => { setFeedback(e.target.value); if (e.target.value.trim()) setFbErr(''); }} style={{ resize: 'vertical', minHeight: '90px' }} />
          {fbErr && <p style={errS}><AlertCircle className="h-3 w-3" />{fbErr}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
            <Button variant="destructive" onClick={() => handleDecide('reject')}>✕ Reject</Button>
            <Button onClick={() => {
              if (!feedback.trim()) { setFbErr('Note is required to put on hold.'); return; }
              setFbErr('');
              onAction('hold', { feedback: feedback.trim() });
            }} style={{ background: '#F59E0B', color: 'white', fontWeight: 'bold' }}>⏸ Hold</Button>
            <Button variant="default"     onClick={() => handleDecide('select')}>✓ Move to Offer</Button>
          </div>
        </>
      )}

      {isHR && status === 'On Hold' && (
        <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '10px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <p style={{ fontSize: '13px', fontWeight: 700, color: '#92400E', margin: 0 }}>⏸ On Hold</p>
          {(candidate as any).hrHoldFeedback && (
            <p style={{ fontSize: '12px', color: '#78350F', margin: 0 }}>"{(candidate as any).hrHoldFeedback}"</p>
          )}
          <UpdatedByBadge history={history} stage="HR Round" actions={['hold']} />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={() => onAction('resume', {})} style={{ background: '#7C3AED', color: 'white', fontWeight: 'bold' }}>▶ Resume</Button>
          </div>
        </div>
      )}

      {!isHR && status !== 'Locked' && status !== 'On Hold' && <ReadOnlyNote msg="Only HR can manage the HR Round." />}
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
  const status = candidate.offerStatus || 'Pending';
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
          <p style={{ ...lbl, color: status === 'Accepted' ? '#065F46' : '#991B1B', fontSize: '13px', fontWeight: '700', margin: 0 }}>{status === 'Accepted' ? '🎉 Offer Accepted' : '❌ Offer Rejected'}</p>
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
          <Textarea placeholder="Enter candidate's response or notes (mandatory)…" value={offerFeedback} onChange={e => { setOfferFeedback(e.target.value); if (e.target.value.trim()) setOfferError(''); }} style={{ resize: 'vertical', minHeight: '80px' }} />
          {offerError && <p style={errS}><AlertCircle className="h-3 w-3" />{offerError}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
            <Button variant="destructive" onClick={() => handleOfferAction('offer-reject')}>✕ Mark Rejected</Button>
            <Button onClick={() => {
              if (!offerFeedback.trim()) { setOfferError('Note is required to put on hold.'); return; }
              setOfferError('');
              onAction('hold', { feedback: offerFeedback.trim() });
            }} style={{ background: '#F59E0B', color: 'white', fontWeight: 'bold' }}>⏸ Hold</Button>
            <Button variant="default"     onClick={() => handleOfferAction('offer-accept')}>✓ Mark Accepted</Button>
          </div>
        </>
      )}

      {isHR && status === 'On Hold' && (
        <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '10px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <p style={{ fontSize: '13px', fontWeight: 700, color: '#92400E', margin: 0 }}>⏸ On Hold</p>
          {(candidate as any).offerHoldFeedback && (
            <p style={{ fontSize: '12px', color: '#78350F', margin: 0 }}>"{(candidate as any).offerHoldFeedback}"</p>
          )}
          <UpdatedByBadge history={history} stage="Offer Stage" actions={['hold']} />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={() => onAction('resume', {})} style={{ background: '#7C3AED', color: 'white', fontWeight: 'bold' }}>▶ Resume</Button>
          </div>
        </div>
      )}

      {!isHR && status !== 'Locked' && status !== 'Released' && status !== 'On Hold' && <ReadOnlyNote msg="Only HR can manage the Offer Stage." />}
    </StageShell>
  );
};

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function CandidatePage({ params }: { params: Promise<{ candidateId: string }> }) {
  const { candidateId } = use(params);
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
    if (role !== 'hr' && role !== 'panel') return;
    getDocs(query(collection(db, 'users'), where('role', '==', 'panel'), where('status', '==', 'Active'))).then(snap => {
      const users: PanelUser[] = snap.docs.map(d => {
        const data = d.data();
        const email = data.email || data.emailAddress || data.userEmail || data.mail || '';
        const name  = data.displayName || data.name || data.fullName || '';
        if (!email) console.error(`[PanelUsers] ❌ Panel user UID "${d.id}" has no email field.`, '\nDocument data:', data);
        return { uid: d.id, name, email };
      });
      setPanelUsers(users);
    });
  }, [role]);

  // ─── CENTRAL ACTION HANDLER ───────────────────────────────────────────────
  const handleAction = async (stage: string, action: string, payload: any) => {
    if (!candidate || !user) return;

    const actorEmail = user.email || user.providerData?.[0]?.email || '';
    const loggedInUserName = await getUserInfo(user.uid);
    const actorName = loggedInUserName.name || user.displayName || actorEmail || 'Unknown';

    const historyData: any = {
      candidateId, stage, action, status: '',
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
        if (action === 'assign-panel') {
          updateData = {
            resumeReviewStatus:    'Panel Assigned',
            resumePanelUid:        payload.panelUid,
            resumePanelName:       payload.panelName,
            resumePanelEmail:      payload.panelEmail,
            resumeAssignedByEmail: actorEmail,
            resumeAssignedByUid:   user.uid,
            resumeFeedback:        payload.feedback || '',
            resumeHRFeedback:      payload.feedback || '',
          };
          historyData.status = 'Panel Assigned';
        } else if (action === 'panel-accept') {
          updateData = { resumeReviewStatus: 'Panel Reviewed', resumePanelFeedback: payload.feedback, resumePanelDecision: 'accept' };
          historyData.status = 'Panel Reviewed';
        } else if (action === 'panel-reject') {
          updateData = { resumeReviewStatus: 'Panel Reviewed', resumePanelFeedback: payload.feedback, resumePanelDecision: 'reject' };
          historyData.status = 'Panel Reviewed';
        } else if (action === 'accept') {
          const token = globalThis.crypto.randomUUID();
          const baseUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
          const interviewUrl = `${baseUrl}/interview/${token}`;
          const resumeText = [
            `Name: ${candidate.candidateName}`,
            `Role: ${candidate.candidateDesignation}`,
            `Experience: ${(candidate as any).experience} years`,
            `Skills: ${(candidate as any).skills || ''}`,
            `Current Company: ${(candidate as any).currentCompany || ''}`,
            `Notice Period: ${(candidate as any).noticePeriod || ''}`,
          ].filter(Boolean).join('\n');
          const jobDescription = (candidate as any).jobDescription || (candidate as any).jdText || `Role: ${candidate.candidateDesignation}`;
          
          // ← Compute ONCE, reuse in both writes
          const sentAt = Timestamp.now();
          const expiresAt = Timestamp.fromMillis(sentAt.toMillis() + 48 * 60 * 60 * 1000);
          
          await addDoc(collection(db, 'ai_interviews'), {
            token, candidateId: candidateId, candidateName: candidate.candidateName || '',
            candidateEmail: candidate.candidateEmail || '', jobRole: candidate.candidateDesignation || '',
            resumeText, jobDescription, scheduledByUid: user.uid, scheduledByName: actorName,
            status: 'pending', createdAt: sentAt, expiresAt, interviewUrl,
            l1AIInterviewSentAt: sentAt, // ← also save here for page.tsx fallback
            interviewMode:    (candidate as any).interviewMode    ?? 'ai',
            projectQuestions: (candidate as any).projectQuestions ?? [],
          });
          updateData = {
            resumeReviewStatus: 'Accepted',
            resumeFeedback: payload.feedback || (candidate as any).resumePanelFeedback || '',
            l1Status: 'Scheduled', l1InterviewType: 'ai',
            l1ScheduledDate: new Date().toISOString().split('T')[0],
            l1AIInterviewToken: token, l1AIInterviewUrl: interviewUrl,
            l1AIInterviewSentAt: sentAt, // ← same timestamp object
            l1InterviewerUid: user.uid, l1InterviewerName: actorName, l1InterviewerEmail: actorEmail,
            resumeReviewedByEmail: actorEmail, resumeReviewedByUid: user.uid, resumeReviewedByName: actorName,
          };
          historyData.status = 'Accepted';
          await updateDoc(doc(db, 'candidates', candidateId), { ...updateData, lastUpdated: Timestamp.now() });
await addDoc(collection(db, 'candidate_history'), historyData);
const threadId = (candidate as any).emailThreadMessageId || '';
await sendEmail({ toEmail: candidate.candidateEmail || '', candidateName: candidate.candidateName || '', jobRole: candidate.candidateDesignation || '', interviewerName: actorName, interviewerEmail: actorEmail, experience: String((candidate as any).experience || ''), location: String((candidate as any).location || ''), stage: 'L1 Interview', schedulingNotes: `AI interview link: ${interviewUrl}`, interviewFeedback: '', interviewDate: new Date().toISOString().split('T')[0], interviewTime: '', senderRole: 'hr', emailType: 'interview_scheduled', candidateId: candidateId, threadMessageId: threadId,rescheduleToken: token, l1RescheduleUsed: false });
const uploaderEmailForAI = candidate.createdByEmail || actorEmail;
await sendEmail({ toEmail: uploaderEmailForAI, candidateName: candidate.candidateName || '', jobRole: candidate.candidateDesignation || '', interviewerName: actorName, interviewerEmail: actorEmail, experience: String((candidate as any).experience || ''), location: '', stage: 'L1 Interview', schedulingNotes: `AI interview link sent to candidate. Token: ${token}`, interviewFeedback: '', interviewDate: new Date().toISOString().split('T')[0], interviewTime: '', senderRole: 'hr', emailType: 'interview_scheduled', candidateId: candidateId, threadMessageId: threadId,rescheduleToken: token, l1RescheduleUsed: false });
          return;
        } else if (action === 'reject') {
          updateData = { resumeReviewStatus: 'Rejected', resumeFeedback: payload.feedback || (candidate as any).resumePanelFeedback || '', finalStatus: 'Rejected', rejectionDate: Timestamp.now(), l1Status: 'Locked', l2Status: 'Locked', hrStatus: 'Locked', offerStatus: 'Locked' };
          historyData.status = 'Rejected';
        } else if (action === 'hold') {
          updateData = { resumeReviewStatus: 'On Hold', resumeHoldFeedback: payload.feedback, resumeReviewPrevStatus: candidate.resumeReviewStatus };
          historyData.status = 'On Hold';
        } else if (action === 'resume') {
          updateData = { resumeReviewStatus: (candidate as any).resumeReviewPrevStatus || 'Pending', resumeHoldFeedback: null };
          historyData.status = 'Resumed';
        }
        break;

      case 'L1 Interview':
        if (action === 'ai-select') {
          updateData = { l1Status: 'Selected', l1Feedback: payload.feedback, l1AIScore: payload.aiScore, l2Status: 'Pending' };
          historyData.status = 'Selected';
        } else if (action === 'ai-reject') {
          updateData = { l1Status: 'Rejected', l1Feedback: payload.feedback, l1AIScore: payload.aiScore, finalStatus: 'Rejected',rejectionDate: Timestamp.now(), l2Status: 'Locked', hrStatus: 'Locked', offerStatus: 'Locked' };
          historyData.status = 'Rejected';
        } else if (action === 'ai-schedule') {
          const token = globalThis.crypto.randomUUID();
          const baseUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
          const interviewUrl = `${baseUrl}/interview/${token}`;
          const resumeText = [`Name: ${candidate.candidateName}`, `Role: ${candidate.candidateDesignation}`, `Experience: ${(candidate as any).experience} years`, `Skills: ${(candidate as any).skills || ''}`, `Current Company: ${(candidate as any).currentCompany || ''}`, `Notice Period: ${(candidate as any).noticePeriod || ''}`].filter(Boolean).join('\n');
          const jobDescription = (candidate as any).jobDescription || (candidate as any).jdText || `Role: ${candidate.candidateDesignation}`;
          
          // ← Compute ONCE, reuse in both writes so timestamps match exactly
          const sentAt = Timestamp.now();
          const expiresAt = Timestamp.fromMillis(sentAt.toMillis() + 48 * 60 * 60 * 1000);
          
          await addDoc(collection(db, 'ai_interviews'), { token, candidateId: candidateId, candidateName: candidate.candidateName || '', candidateEmail: candidate.candidateEmail || '', jobRole: candidate.candidateDesignation || '', resumeText, jobDescription, scheduledByUid: user.uid, scheduledByName: actorName, status: 'pending', createdAt: sentAt, expiresAt, interviewUrl, l1AIInterviewSentAt: sentAt });
          
          updateData = { l1Status: 'Scheduled', l1InterviewType: 'ai', l1ScheduledDate: payload.scheduledDate, l1SchedulingNotes: payload.schedulingNotes, l1AIInterviewToken: token, l1AIInterviewUrl: interviewUrl, l1InterviewerUid: user.uid, l1InterviewerName: actorName, l1InterviewerEmail: actorEmail, l1AIInterviewSentAt: sentAt };
          
          historyData.status = 'Scheduled';
          await updateDoc(doc(db, 'candidates', candidateId), { ...updateData, lastUpdated: Timestamp.now() });
          await addDoc(collection(db, 'candidate_history'), historyData);
          const threadMessageId = candidate.emailThreadMessageId || '';
          const uploaderEmail = candidate.createdByEmail || '';
          await sendEmail({ toEmail: candidate.candidateEmail || '', candidateName: candidate.candidateName || '', jobRole: candidate.candidateDesignation || '', interviewerName: actorName, interviewerEmail: actorEmail, experience: String((candidate as any).experience || ''), location: String((candidate as any).location || ''), stage: 'L1 Interview', schedulingNotes: `Interview link: ${interviewUrl}\n\nNotes: ${payload.schedulingNotes}`, interviewFeedback: '', interviewDate: payload.scheduledDate, interviewTime: '', senderRole: 'hr', emailType: 'interview_scheduled', candidateId: candidateId, threadMessageId, rescheduleToken: token, l1RescheduleUsed: false });
          await sendEmail({ toEmail: uploaderEmail || actorEmail, candidateName: candidate.candidateName || '', jobRole: candidate.candidateDesignation || '', interviewerName: actorName, interviewerEmail: actorEmail, experience: String((candidate as any).experience || ''), location: '', stage: 'L1 Interview', schedulingNotes: `AI interview link has been sent to the candidate. Token: ${token}`, interviewFeedback: '', interviewDate: payload.scheduledDate, interviewTime: '', senderRole: 'hr', emailType: 'interview_scheduled', candidateId: candidateId, threadMessageId });
          return;

  } else if (action === 'resend-ai-link') {   // ← ADD FROM HERE
    const token = globalThis.crypto.randomUUID();
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
    const interviewUrl = `${baseUrl}/interview/${token}`;
    const sentAt = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(sentAt.toMillis() + 48 * 60 * 60 * 1000);

    const resumeText = [
      `Name: ${candidate.candidateName}`,
      `Role: ${candidate.candidateDesignation}`,
      `Experience: ${(candidate as any).experience} years`,
      `Skills: ${(candidate as any).skills || ''}`,
    ].filter(Boolean).join('\n');
    const jobDescription = (candidate as any).jobDescription || (candidate as any).jdText || `Role: ${candidate.candidateDesignation}`;

    await addDoc(collection(db, 'ai_interviews'), {
      token, candidateId: candidateId,
      candidateName:  candidate.candidateName  || '',
      candidateEmail: candidate.candidateEmail || '',
      jobRole:        candidate.candidateDesignation || '',
      resumeText, jobDescription,
      scheduledByUid:  user.uid,
      scheduledByName: actorName,
      status: 'pending', createdAt: sentAt, expiresAt,
      interviewUrl, l1AIInterviewSentAt: sentAt,
      interviewMode:    (candidate as any).interviewMode    ?? 'ai',
      projectQuestions: (candidate as any).projectQuestions ?? [],
    });

    updateData = {
      l1Status:            'Scheduled',
      l1AIStatus:          'pending',
      l1AIExpiredReason:   null,
      l1AIExpiredAt:       null,
      l1AIInterviewToken:  token,
      l1AIInterviewUrl:    interviewUrl,
      l1AIInterviewSentAt: sentAt,
    };
    historyData.status = 'Scheduled';

    await updateDoc(doc(db, 'candidates',candidateId), { ...updateData, lastUpdated: Timestamp.now() });
    await addDoc(collection(db, 'candidate_history'), historyData);

    const threadMessageId = candidate.emailThreadMessageId || '';
    await sendEmail({
      toEmail:           candidate.candidateEmail || '',
      candidateName:     candidate.candidateName  || '',
      jobRole:           candidate.candidateDesignation || '',
      interviewerName:   actorName,
      interviewerEmail:  actorEmail,
      experience:        String((candidate as any).experience || ''),
      location:          String((candidate as any).location   || ''),
      stage:             'L1 Interview',
      schedulingNotes:   `AI interview link: ${interviewUrl}`,
            interviewFeedback: '',
      interviewDate:     new Date().toISOString().split('T')[0],
      interviewTime:     '',
      senderRole:        'hr',
      emailType:         'interview_scheduled',
      candidateId:       candidateId,
      threadMessageId,
      rescheduleToken:   token,
      l1RescheduleUsed:  (candidate as any).l1RescheduleUsed === true,
    });
    return;         

        } else if (action === 'schedule') {
          updateData = { l1Status: 'Scheduled', l1ScheduledDate: payload.scheduledDate, l1TimeSlot: payload.timeSlot, l1SchedulingNotes: payload.schedulingNotes, l1PanelUid: payload.panelUid, l1PanelName: payload.panelName, l1PanelEmail: payload.panelEmail, l1InterviewerUid: user.uid, l1InterviewerName: actorName, l1InterviewerEmail: actorEmail };
          historyData.status = 'Scheduled';
        } else if (action === 'panel-select') {
          updateData = { l1Status: 'Selected', l1Feedback: payload.feedback, l2Status: 'Pending' };
          historyData.status = 'Selected';
        } else if (action === 'panel-reject') {
          updateData = { l1Status: 'Rejected', l1Feedback: payload.feedback, finalStatus: 'Rejected', rejectionDate: Timestamp.now(), l2Status: 'Locked', hrStatus: 'Locked', offerStatus: 'Locked' };
          historyData.status = 'Rejected';
        } else if (action === 'hold') {
          updateData = { l1Status: 'On Hold', l1HoldFeedback: payload.feedback, l1PrevStatus: candidate.l1Status };
          historyData.status = 'On Hold';
        } else if (action === 'resume') {
          updateData = { l1Status: (candidate as any).l1PrevStatus || 'Scheduled', l1HoldFeedback: null };
          historyData.status = 'Resumed';
        }
        break;

      case 'L2 Interview':
        if (action === 'schedule') {
          updateData = { l2Status: 'Scheduled', l2ScheduledDate: payload.scheduledDate, l2TimeSlot: payload.timeSlot, l2SchedulingNotes: payload.schedulingNotes, l2PanelUid: payload.panelUid, l2PanelName: payload.panelName, l2PanelEmail: payload.panelEmail, l2InterviewerUid: user.uid, l2InterviewerName: actorName, l2InterviewerEmail: actorEmail };
          historyData.status = 'Scheduled';
        } else if (action === 'panel-select') {
          updateData = { l2Status: 'Selected', l2Feedback: payload.feedback, l2ManagerStatus: 'Pending' };
          historyData.status = 'Selected';
        } else if (action === 'panel-reject') {
          updateData = { l2Status: 'Rejected', l2Feedback: payload.feedback, finalStatus: 'Rejected', rejectionDate: Timestamp.now(), hrStatus: 'Locked', offerStatus: 'Locked' };
          historyData.status = 'Rejected';
        } else if (action === 'hold') {
          updateData = { l2Status: 'On Hold', l2HoldFeedback: payload.feedback, l2PrevStatus: candidate.l2Status };
          historyData.status = 'On Hold';
        } else if (action === 'resume') {
          updateData = { l2Status: (candidate as any).l2PrevStatus || 'Scheduled', l2HoldFeedback: null };
          historyData.status = 'Resumed';
        }
        break;

        case 'L2 Manager Round':
  if (action === 'schedule') {
    updateData = {
      l2ManagerStatus: 'Scheduled',
      l2ManagerScheduledDate: payload.scheduledDate,
      l2ManagerTimeSlot: payload.timeSlot,
      l2ManagerSchedulingNotes: payload.schedulingNotes,
      l2ManagerPanelUid: payload.panelUid,
      l2ManagerPanelName: payload.panelName,
      l2ManagerPanelEmail: payload.panelEmail,
      l2ManagerInterviewerUid: user.uid,
      l2ManagerInterviewerName: actorName,
      l2ManagerInterviewerEmail: actorEmail,
    };
    historyData.status = 'Scheduled';
  } else if (action === 'panel-select') {
    updateData = { l2ManagerStatus: 'Selected', l2ManagerFeedback: payload.feedback, hrStatus: 'Pending' };
    historyData.status = 'Selected';
  } else if (action === 'panel-reject') {
    updateData = { l2ManagerStatus: 'Rejected', l2ManagerFeedback: payload.feedback, finalStatus: 'Rejected',rejectionDate: Timestamp.now(), hrStatus: 'Locked', offerStatus: 'Locked' };
    historyData.status = 'Rejected';
  } else if (action === 'hold') {
    updateData = { l2ManagerStatus: 'On Hold', l2ManagerHoldFeedback: payload.feedback, l2ManagerPrevStatus: (candidate as any).l2ManagerStatus };
    historyData.status = 'On Hold';
  } else if (action === 'resume') {
    updateData = { l2ManagerStatus: (candidate as any).l2ManagerPrevStatus || 'Scheduled', l2ManagerHoldFeedback: null };
    historyData.status = 'Resumed';
  }
  break;

      case 'HR Round':
        if (action === 'schedule') {
          updateData = { hrStatus: 'Scheduled', hrScheduledDate: payload.scheduledDate, hrTimeSlot: payload.timeSlot, hrSchedulingNotes: payload.schedulingNotes, hrInterviewerEmail: actorEmail, hrInterviewerUid: user.uid };
          historyData.status = 'Scheduled';
        } else if (action === 'select') {
          updateData = { hrStatus: 'Selected', hrFeedback: payload.feedback, offerStatus: 'Pending' };
          historyData.status = 'Selected';
        } else if (action === 'hold') {
          updateData = { hrStatus: 'On Hold', hrHoldFeedback: payload.feedback, hrPrevStatus: candidate.hrStatus };
          historyData.status = 'On Hold';
        } else if (action === 'resume') {
          updateData = { hrStatus: (candidate as any).hrPrevStatus || 'Scheduled', hrHoldFeedback: null };
          historyData.status = 'Resumed';
        } else {
          updateData = { hrStatus: 'Rejected', hrFeedback: payload.feedback, finalStatus: 'Rejected',rejectionDate: Timestamp.now(), offerStatus: 'Locked' };
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
        } else if (action === 'hold') {
          updateData = { offerStatus: 'On Hold', offerHoldFeedback: payload.feedback, offerPrevStatus: candidate.offerStatus };
          historyData.status = 'On Hold';
        } else if (action === 'resume') {
          updateData = { offerStatus: (candidate as any).offerPrevStatus || 'Released', offerHoldFeedback: null };
          historyData.status = 'Resumed';
        } else if (action === 'offer-reject') {
          updateData = { offerStatus: 'Rejected', offerFeedback: payload.feedback, finalStatus: 'Rejected', rejectionDate: Timestamp.now() };
          historyData.status = 'Rejected';
        }
        break;

    }

    try {
      await updateDoc(doc(db, 'candidates', candidateId), { ...updateData, lastUpdated: Timestamp.now() });
      await addDoc(collection(db, 'candidate_history'), historyData);
      setHistory(prev => [...prev, { stage, action, updatedByName: historyData.updatedByName, updatedByRole: historyData.updatedByRole }]);
    } catch (err) {
      console.error('Firestore update failed:', err);
      return;
    }

    const fresh = await getFreshCandidate(candidateId);
    if (!fresh) { console.error('[Email] ❌ Could not read fresh candidate — emails skipped for action:', action); return; }

    const threadMessageId: string = fresh.emailThreadMessageId || '';

    let uploaderEmail: string | null = null;
    let uploaderName:  string | null = null;
    if (fresh.createdBy) {
      const uploaderInfo = await getUserInfo(fresh.createdBy);
      uploaderEmail = uploaderInfo.email;
      uploaderName  = uploaderInfo.name;
    }
    if (!uploaderEmail && fresh.createdByEmail) uploaderEmail = fresh.createdByEmail;

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
      candidateId:       candidateId,
      threadMessageId:   threadMessageId,
    };

    const queue = new Map<string, typeof baseParams & { toEmail: string; senderRole: string; emailType: string }>();
    const enqueue = (toEmail: string | null | undefined, senderRole: string, emailType: string) => {
      const raw = toEmail?.trim();
      if (!raw || !raw.includes('@')) return;
      const key = raw.toLowerCase();
      if (queue.has(key)) return;
      queue.set(key, { ...baseParams, toEmail: raw, senderRole, emailType });
    };

    if (stage === 'Resume Review') {
      if (action === 'assign-panel') {
        const panelEmail = payload.panelEmail || fresh.resumePanelEmail || '';
        const hrFeedback = payload.feedback   || fresh.resumeHRFeedback || '';
        const queueWithFeedback = { ...baseParams, interviewFeedback: hrFeedback };
        const enqueueWithFeedback = (toEmail: string | null | undefined, senderRole: string, emailType: string) => {
          const raw = toEmail?.trim();
          if (!raw || !raw.includes('@')) return;
          const key = raw.toLowerCase();
          if (queue.has(key)) return;
          queue.set(key, { ...queueWithFeedback, toEmail: raw, senderRole, emailType });
        };
        enqueueWithFeedback(panelEmail, 'hr', 'panel_assigned');
        enqueueWithFeedback(actorEmail, 'hr', 'panel_assigned');
      } else if (action === 'panel-accept' || action === 'panel-reject') {
        const hrEmail = fresh.resumeAssignedByEmail || uploaderEmail;
        const emailType = action === 'panel-accept' ? 'resume_accepted' : 'resume_rejected';
        enqueue(hrEmail,    'panel', emailType);
        enqueue(actorEmail, 'panel', emailType);
      } else if (action === 'accept' || action === 'reject') {
        const emailType = action === 'accept' ? 'resume_accepted' : 'resume_rejected';
        enqueue(uploaderEmail, 'hr', emailType);
        enqueue(actorEmail,    'hr', emailType);
        enqueue(fresh.candidateEmail, 'hr', emailType);
      }
    } else if (action === 'schedule' && stage === 'L1 Interview') {
      const panelEmail = fresh.l1PanelEmail || payload.panelEmail || '';
      enqueue(uploaderEmail, 'hr', 'interview_scheduled');
      enqueue(actorEmail,    'hr', 'interview_scheduled');
      enqueue(panelEmail,    'hr', 'panel_assigned');
    } else if (action === 'schedule' && stage === 'L2 Interview') {
      const panelEmail = fresh.l2PanelEmail || payload.panelEmail || '';
      enqueue(uploaderEmail, 'hr', 'interview_scheduled');
      enqueue(actorEmail,    'hr', 'interview_scheduled');
      enqueue(panelEmail,    'hr', 'panel_assigned');
    } 
   else if (action === 'schedule' && stage === 'L2 Manager Round') {
    const panelEmail = fresh.l2ManagerPanelEmail || payload.panelEmail || '';
    enqueue(uploaderEmail, 'hr', 'interview_scheduled');
    enqueue(actorEmail,    'hr', 'interview_scheduled');
    enqueue(panelEmail,    'hr', 'panel_assigned');
  } else if (action === 'schedule' && stage === 'HR Round') {
    enqueue(uploaderEmail, 'hr', 'interview_scheduled');
    enqueue(actorEmail,    'hr', 'interview_scheduled');
  }
    else if (stage === 'L1 Interview' && (action === 'ai-select' || action === 'ai-reject')) {
      const emailType = action === 'ai-select' ? 'candidate_selected' : 'candidate_rejected';
      enqueue(uploaderEmail, 'hr', emailType);
      enqueue(actorEmail,    'hr', emailType);
      enqueue(fresh.candidateEmail, 'hr', emailType);
    } else if ((stage === 'L1 Interview' || stage === 'L2 Interview') && (action === 'panel-select' || action === 'panel-reject')) {
      const reviewerEmail = fresh.resumeReviewedByEmail || (stage === 'L1 Interview' ? fresh.l1InterviewerEmail : fresh.l2InterviewerEmail) || null;
      const emailType = action === 'panel-select' ? 'candidate_selected' : 'candidate_rejected';
      enqueue(uploaderEmail, 'panel', emailType);
      enqueue(reviewerEmail, 'panel', emailType);
      enqueue(actorEmail,    'panel', emailType);
      enqueue(fresh.candidateEmail, 'panel', emailType); 
} else if (stage === 'L2 Manager Round' && (action === 'panel-select' || action === 'panel-reject')) {
  const emailType = action === 'panel-select' ? 'candidate_selected' : 'candidate_rejected';
  enqueue(uploaderEmail,        'panel', emailType);
  enqueue(actorEmail,           'panel', emailType);
  enqueue(fresh.candidateEmail, 'panel', emailType);
} 
else if (stage === 'HR Round' && (action === 'select' || action === 'reject')) {
      const emailType = action === 'select' ? 'candidate_selected' : 'candidate_rejected';
      enqueue(uploaderEmail, 'hr', emailType);
      enqueue(actorEmail,    'hr', emailType);
      enqueue(fresh.candidateEmail, 'hr', emailType);
    } else if (stage === 'Offer Stage') {
      const emailType = action === 'release-offer' ? 'offer_released' : action === 'offer-accept' ? 'offer_accepted' : 'offer_rejected';
      enqueue(uploaderEmail, 'hr', emailType);
      enqueue(actorEmail,    'hr', emailType);
      enqueue(fresh.candidateEmail, 'hr', emailType);
    }

    for (const emailParams of queue.values()) {
      await sendEmail(emailParams);
    }
  };

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'Segoe UI, system-ui' }}>Loading Candidate…</div>;
  if (!candidate) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'Segoe UI, system-ui' }}>Candidate not found.</div>;
  if (role === 'agency' && candidate.createdBy !== user?.uid) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'Segoe UI, system-ui' }}>You don't have access to this candidate.</div>;

  const finalStatus = candidate.finalStatus || 'In Progress';
  const finalBadgeStyle: React.CSSProperties = {
    background: finalStatus === 'Completed' ? '#D1FAE5' : finalStatus === 'Rejected' ? '#FEE2E2' : '#EDE9FE',
    color:      finalStatus === 'Completed' ? '#065F46'  : finalStatus === 'Rejected' ? '#991B1B'  : '#5B21B6',
    padding: '4px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: '700', display: 'inline-block',
  };

  return (
    <div style={{ fontFamily: 'Segoe UI, system-ui', background: '#F5F6FA', padding: '24px' }}>
      <div style={{ marginBottom: '20px' }}>
        <Button variant="outline" onClick={() => router.back()} className="flex items-center gap-2 font-semibold">← Back to History</Button>
      </div>

      {role === 'admin' && (
        <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: '10px', padding: '10px 16px', marginBottom: '16px', fontSize: '13px', color: '#92400E', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Eye className="h-4 w-4" /> <strong>Admin View:</strong> You can view all candidate details but cannot take any actions.
        </div>
      )}

<div style={{ display: 'grid', gridTemplateColumns: '500px 1fr', gap: '24px' }}>
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
          <div style={{ background: 'white', borderRadius: '12px', padding: '20px', textAlign: 'center' }}>
            {candidate.resumeFile?.data ? (
              <Button variant="outline" onClick={() => {
                const bytes    = atob(candidate.resumeFile.data);
                const arr      = new Uint8Array(bytes.length).map((_, i) => bytes.charCodeAt(i));
                const fileType = candidate.resumeFile.type || 'application/pdf';
                const blob     = new Blob([arr], { type: fileType });
                const url      = URL.createObjectURL(blob);
                if (fileType.includes('pdf')) { window.open(url, '_blank'); }
                else { const a = document.createElement('a'); a.href = url; a.download = candidate.resumeFile.name || 'resume'; a.click(); }
              }}>📄 View Resume</Button>
            ) : (
              <p style={{ color: 'gray', fontSize: '13px' }}>No resume uploaded</p>
            )}
          </div>
          <AIMatchCard candidate={candidate} />
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
                  <p style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '4px' }}>{label}</p>
                  <p style={{ color: 'gray', fontSize: '12px', wordBreak: 'break-all' }}>{value as string}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── RIGHT COLUMN ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ background: 'white', borderRadius: '12px', padding: '20px' }}>
            <h2 style={{ fontWeight: 'bold', marginBottom: '6px' }}>Interview Workflow</h2>
            <p style={{ fontSize: '13px', color: 'gray', marginBottom: '16px' }}>Manage active round. Save details to advance.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <ResumeReviewCard candidate={candidate} role={role as UserRole} user={user} panelUsers={panelUsers} history={history} onAction={(a, p) => handleAction('Resume Review', a, p)} />
              <InterviewStageCard candidate={candidate} role={role as UserRole} user={user} panelUsers={panelUsers} stageKey="l1" title="Screening Round" history={history} onAction={(a, p) => handleAction('L1 Interview', a, p)} />
              <InterviewStageCard candidate={candidate} role={role as UserRole} user={user} panelUsers={panelUsers} stageKey="l2" title="L1 Technical Round" history={history} onAction={(a, p) => handleAction('L2 Interview', a, p)} />
              <InterviewStageCard
  candidate={candidate}
  role={role as UserRole}
  user={user}
  panelUsers={panelUsers}
  stageKey="l2manager"
  title="L2 Manager Round"
  history={history}
  onAction={(a, p) => handleAction('L2 Manager Round', a, p)}
/>

              <HRRoundCard candidate={candidate} role={role as UserRole} history={history} onAction={(a, p) => handleAction('HR Round', a, p)} />
              <OfferStageCard candidate={candidate} role={role as UserRole} history={history} onAction={(a, p) => handleAction('Offer Stage', a, p)} />
            </div>
          </div>


        </div>
      </div>
    </div>
  );
}



