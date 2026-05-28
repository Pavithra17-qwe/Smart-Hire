'use client';

import React, { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { AlertCircle } from 'lucide-react';

interface Props {
  candidateId:   string;
  candidateName: string;
  role:          string | null;
  onDecision:    (action: 'ai-select' | 'ai-reject', payload: any) => void;
}

export const AIInterviewStatusCard: React.FC<Props> = ({
  candidateId, candidateName, role, onDecision,
}) => {

  const [aiStatus,         setAiStatus]         = useState<string>('pending');
  const [aiScore,          setAiScore]          = useState<number | null>(null);
  const [aiSummary,        setAiSummary]        = useState('');
  const [aiFeedback,       setAiFeedback]       = useState('');
  const [aiRecommendation, setAiRecommendation] = useState('');
  const [aiStrengths,      setAiStrengths]      = useState<string[]>([]);
  const [aiImprovements,   setAiImprovements]   = useState<string[]>([]);
  const [techScore,        setTechScore]        = useState<number | null>(null);
  const [commScore,        setCommScore]        = useState<number | null>(null);
  const [l1Status,         setL1Status]         = useState('Scheduled');
  const [hrNotes,          setHrNotes]          = useState('');
  const [hrNotesErr,       setHrNotesErr]       = useState('');

  useEffect(() => {
    if (!candidateId) return;
    const unsub = onSnapshot(doc(db, 'candidates', candidateId), (snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      setAiStatus(         d.l1AIStatus            || 'pending');
      setAiScore(          d.l1AIScore              ?? null);
      setAiSummary(        d.l1AISummary            || '');
      setAiFeedback(       d.l1AIFeedback           || '');
      setAiRecommendation( d.l1AIRecommendation     || '');
      setAiStrengths(      d.l1AIStrengths          || []);
      setAiImprovements(   d.l1AIImprovements       || []);
      setTechScore(        d.l1AITechnicalScore     ?? null);
      setCommScore(        d.l1AICommunicationScore ?? null);
      setL1Status(         d.l1Status               || 'Scheduled');
    });
    return () => unsub();
  }, [candidateId]);

  const isHR  = role === 'hr';
  const isDone = ['Selected', 'Rejected'].includes(l1Status);

  const scoreColor = (s: number) => {
    if (s >= 80) return { color: '#059669', bg: '#ECFDF5', border: '#6EE7B7', label: 'Excellent'    };
    if (s >= 60) return { color: '#D97706', bg: '#FFFBEB', border: '#FDE68A', label: 'Good'         };
    if (s >= 40) return { color: '#EA580C', bg: '#FFF7ED', border: '#FED7AA', label: 'Average'      };
    if (s > 0)   return { color: '#DC2626', bg: '#FEF2F2', border: '#FECACA', label: 'Low'          };
    return              { color: '#6B7280', bg: '#F3F4F6', border: '#E5E7EB', label: 'Needs Review' };
  };

  const handleDecision = (action: 'ai-select' | 'ai-reject') => {
    if (!hrNotes.trim()) { setHrNotesErr('HR notes are required before deciding.'); return; }
    setHrNotesErr('');
    onDecision(action, { feedback: hrNotes.trim(), aiScore, aiFeedback });
  };

  // Already decided — parent card shows result
  if (isDone) return null;

  // ── STATE 1: PENDING ──────────────────────────────────────────────────────
  if (aiStatus === 'pending') {
    return (
      <div style={{ background: '#F5F3FF', borderRadius: '12px', padding: '16px', border: '1px solid #DDD6FE', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>🤖</span>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#5B21B6' }}>AI Interview Sent</span>
          </div>
          <span style={{ fontSize: '10px', fontWeight: 700, padding: '3px 10px', borderRadius: '999px', background: '#EDE9FE', color: '#7C3AED', border: '1px solid #C4B5FD' }}>
            ⏳ Awaiting Candidate
          </span>
        </div>
        {[
          { icon: '✉️', text: 'Interview link emailed to candidate',       done: true  },
          { icon: '⏳', text: 'Candidate must complete within 48 hours',   done: false },
          { icon: '🤖', text: 'AI will auto-score once submitted',         done: false },
          { icon: '👤', text: 'HR reviews score and makes final decision', done: false },
        ].map((step, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', borderRadius: '8px', background: step.done ? '#EDE9FE' : '#F9FAFB', border: `1px solid ${step.done ? '#C4B5FD' : '#E5E7EB'}` }}>
            <span style={{ fontSize: '14px' }}>{step.icon}</span>
            <span style={{ fontSize: '12px', flex: 1, color: step.done ? '#5B21B6' : '#9CA3AF', fontWeight: step.done ? 600 : 400 }}>{step.text}</span>
            {step.done && <span style={{ fontSize: '10px', fontWeight: 700, color: '#7C3AED', background: 'white', padding: '1px 7px', borderRadius: '999px', border: '1px solid #C4B5FD' }}>Done</span>}
          </div>
        ))}
        <p style={{ fontSize: '11px', color: '#9CA3AF', margin: 0, textAlign: 'center' }}>
          This page updates automatically when the candidate submits.
        </p>
      </div>
    );
  }

  // ── STATE 2: IN PROGRESS ──────────────────────────────────────────────────
  if (aiStatus === 'in_progress') {
    return (
      <div style={{ background: '#FFFBEB', borderRadius: '12px', padding: '16px', border: '1px solid #FDE68A', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>🎙</span>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#92400E' }}>Interview In Progress</span>
          </div>
          <span style={{ fontSize: '10px', fontWeight: 700, padding: '3px 10px', borderRadius: '999px', background: '#FEF3C7', color: '#D97706', border: '1px solid #FCD34D' }}>● Live Now</span>
        </div>
        {[
          { icon: '✉️', text: 'Link sent to candidate',        done: true  },
          { icon: '🎙', text: 'Candidate started interview',   done: true  },
          { icon: '🤖', text: 'AI scoring — after submission', done: false },
          { icon: '👤', text: 'HR decision',                   done: false },
        ].map((step, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 10px', borderRadius: '8px', background: step.done ? '#FFFBEB' : '#F9FAFB', border: `1px solid ${step.done ? '#FDE68A' : '#E5E7EB'}` }}>
            <span style={{ fontSize: '13px' }}>{step.icon}</span>
            <span style={{ fontSize: '12px', flex: 1, color: step.done ? '#92400E' : '#9CA3AF', fontWeight: step.done ? 600 : 400 }}>{step.text}</span>
            {step.done && <span style={{ fontSize: '11px', color: '#D97706' }}>✓</span>}
          </div>
        ))}
        <p style={{ fontSize: '11px', color: '#9CA3AF', margin: 0, textAlign: 'center' }}>
          This page updates automatically when they finish.
        </p>
      </div>
    );
  }
  if (aiStatus === 'expired') {
    return (
      <div style={{
        background: '#FFF8F8', borderRadius: '12px', padding: '16px',
        border: '1.5px solid #FECACA', display: 'flex', flexDirection: 'column', gap: '8px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>⚠️</span>
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#991B1B' }}>Session Ended</span>
          </div>
          <span style={{
            fontSize: '10px', fontWeight: 700, padding: '3px 10px',
            borderRadius: '999px', background: '#FEE2E2',
            color: '#991B1B', border: '1px solid #FECACA',
          }}>● Expired</span>
        </div>
        {[
          { icon: '✉️', text: 'Link sent to candidate',           done: true,  warn: false },
          { icon: '🎙', text: 'Candidate started interview',      done: true,  warn: false },
          { icon: '⚠️', text: 'Session ended before completion',  done: true,  warn: true  },
          { icon: '👤', text: 'HR decision required',             done: false, warn: false },
        ].map((step, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '7px 10px', borderRadius: '8px',
            background: step.warn ? '#FFF8F8' : step.done ? '#FFF1F2' : '#F9FAFB',
            border: `1px solid ${step.warn ? '#FECACA' : step.done ? '#FECACA' : '#E5E7EB'}`,
          }}>
            <span style={{ fontSize: '13px' }}>{step.icon}</span>
            <span style={{
              fontSize: '12px', flex: 1,
              color: step.done ? '#991B1B' : '#9CA3AF',
              fontWeight: step.done ? 600 : 400,
            }}>{step.text}</span>
            {step.done && <span style={{ fontSize: '11px', color: '#DC2626' }}>✓</span>}
          </div>
        ))}
        <p style={{ fontSize: '11px', color: '#9CA3AF', margin: 0, textAlign: 'center' }}>
          Use the options below to resend the link or reject the candidate.
        </p>
      </div>
    );
  }

  // ── STATE 3: COMPLETED ────────────────────────────────────────────────────
  if (aiStatus === 'completed') {
    const sd = aiScore !== null ? scoreColor(aiScore) : null;

    const recBadge = (rec: string) => {
      if (rec === 'Strong Yes') return { bg: '#DCFCE7', color: '#15803D', border: '#86EFAC' };
      if (rec === 'Yes')        return { bg: '#D1FAE5', color: '#065F46', border: '#6EE7B7' };
      if (rec === 'Maybe')      return { bg: '#FEF3C7', color: '#92400E', border: '#FCD34D' };
      return                           { bg: '#FEE2E2', color: '#991B1B', border: '#FECACA' };
    };
    const rc = recBadge(aiRecommendation);

    // Check if AI evaluation failed
    const evaluationFailed = aiScore === 0 && aiSummary.includes('could not be completed');

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

        {/* ── Evaluation failed fallback ── */}
        {evaluationFailed ? (
          <div style={{ background: '#F9FAFB', borderRadius: '12px', padding: '16px', border: '1px solid #E5E7EB', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '18px' }}>🤖</span>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#374151' }}>AI Interview Completed</span>
              <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', background: '#FEF3C7', color: '#92400E', border: '1px solid #FCD34D' }}>Manual Review Required</span>
            </div>
            <p style={{ fontSize: '13px', color: '#6B7280', margin: 0, lineHeight: 1.6 }}>
              AI evaluation could not be completed. Please review the candidate's recording manually and make your decision below.
            </p>
          </div>
        ) : (
          <>
            {/* ── Score hero ── */}
            <div style={{ background: sd?.bg || '#F9FAFB', borderRadius: '12px', padding: '16px', border: `1.5px solid ${sd?.border || '#E5E7EB'}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '18px' }}>🤖</span>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: '#111827' }}>AI Interview Report</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {aiRecommendation && (
                    <span style={{ fontSize: '10px', fontWeight: 700, padding: '3px 9px', borderRadius: '999px', background: rc.bg, color: rc.color, border: `1px solid ${rc.border}` }}>
                      {aiRecommendation}
                    </span>
                  )}
                  <span style={{ fontSize: '10px', fontWeight: 700, padding: '3px 9px', borderRadius: '999px', background: '#DCFCE7', color: '#15803D', border: '1px solid #86EFAC' }}>✓ Completed</span>
                </div>
              </div>

              {/* Overall score */}
              {aiScore !== null && aiScore > 0 && sd && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', background: 'white', borderRadius: '10px', padding: '12px 14px', border: `1px solid ${sd.border}`, marginBottom: '12px' }}>
                  <div style={{ width: '68px', height: '68px', borderRadius: '50%', flexShrink: 0, border: `4px solid ${sd.color}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: sd.bg }}>
                    <span style={{ fontSize: '22px', fontWeight: 900, color: sd.color, lineHeight: 1 }}>{aiScore}</span>
                    <span style={{ fontSize: '9px', color: sd.color, fontWeight: 600 }}>/100</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 700, color: sd.color }}>{sd.label}</span>
                      <span style={{ fontSize: '11px', color: '#6B7280' }}>Overall Score</span>
                    </div>
                    <div style={{ height: '8px', background: '#E5E7EB', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${aiScore}%`, background: sd.color, borderRadius: '4px', transition: 'width 0.8s ease' }} />
                    </div>
                  </div>
                </div>
              )}

              {/* Sub-scores */}
              {(techScore !== null || commScore !== null) && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {[
                    { label: '🔧 Technical',     score: techScore },
                    { label: '💬 Communication', score: commScore },
                  ].map(({ label, score }) => score !== null && (
                    <div key={label} style={{ background: 'white', borderRadius: '8px', padding: '10px 12px', border: '1px solid #E5E7EB' }}>
                      <p style={{ fontSize: '11px', color: '#6B7280', margin: '0 0 4px' }}>{label}</p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '16px', fontWeight: 700, color: scoreColor(score).color }}>{score}</span>
                        <div style={{ flex: 1, height: '4px', background: '#E5E7EB', borderRadius: '2px' }}>
                          <div style={{ height: '100%', width: `${score}%`, background: scoreColor(score).color, borderRadius: '2px' }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── AI Summary ── */}
            {aiSummary && (
              <div style={{ background: '#F0F9FF', borderRadius: '10px', padding: '12px 14px', border: '1px solid #BAE6FD' }}>
                <p style={{ fontSize: '11px', fontWeight: 700, color: '#0369A1', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>📋 AI Summary</p>
                <p style={{ fontSize: '13px', color: '#0C4A6E', lineHeight: 1.7, margin: 0 }}>{aiSummary}</p>
              </div>
            )}

            {/* ── Technical Feedback ── */}
            {aiFeedback && (
              <div style={{ background: '#F9FAFB', borderRadius: '10px', padding: '12px 14px', border: '1px solid #E5E7EB' }}>
                <p style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>🔧 Technical Feedback</p>
                <p style={{ fontSize: '13px', color: '#374151', lineHeight: 1.7, margin: 0 }}>{aiFeedback}</p>
              </div>
            )}

            {/* ── Strengths + Improvements ── */}
            {(aiStrengths.length > 0 || aiImprovements.length > 0) && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {aiStrengths.length > 0 && (
                  <div style={{ background: '#F0FDF4', borderRadius: '10px', padding: '12px', border: '1px solid #86EFAC' }}>
                    <p style={{ fontSize: '11px', fontWeight: 700, color: '#15803D', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>✅ Strengths</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                      {aiStrengths.map((s, i) => (
                        <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                          <span style={{ color: '#16A34A', fontSize: '11px', marginTop: '2px', flexShrink: 0 }}>•</span>
                          <span style={{ fontSize: '12px', color: '#166534', lineHeight: 1.5 }}>{s}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {aiImprovements.length > 0 && (
                  <div style={{ background: '#FFF7ED', borderRadius: '10px', padding: '12px', border: '1px solid #FED7AA' }}>
                    <p style={{ fontSize: '11px', fontWeight: 700, color: '#C2410C', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>📈 Areas to Improve</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                      {aiImprovements.map((s, i) => (
                        <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                          <span style={{ color: '#EA580C', fontSize: '11px', marginTop: '2px', flexShrink: 0 }}>•</span>
                          <span style={{ fontSize: '12px', color: '#7C2D12', lineHeight: 1.5 }}>{s}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ── HR Decision ── */}
        {isHR && l1Status === 'Scheduled' && (
          <div style={{ background: '#F9FAFB', borderRadius: '12px', padding: '16px', border: '1.5px solid #7C3AED', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '16px' }}>👤</span>
              <p style={{ fontSize: '13px', fontWeight: 700, color: '#374151', margin: 0 }}>Your Decision</p>
            </div>
            <p style={{ fontSize: '12px', color: '#6B7280', margin: 0 }}>
              Review the AI report above, then move the candidate forward or reject.
            </p>
            <div>
              <p style={{ fontSize: '11px', fontWeight: 600, color: '#374151', marginBottom: '5px' }}>
                HR Notes <span style={{ color: '#DC2626' }}>*</span>
              </p>
              <textarea
                value={hrNotes}
                onChange={e => { setHrNotes(e.target.value); if (e.target.value.trim()) setHrNotesErr(''); }}
                placeholder="Add your review notes before deciding (required)…"
                style={{ width: '100%', borderRadius: '8px', padding: '9px 12px', border: `1px solid ${hrNotesErr ? '#EF4444' : '#E5E7EB'}`, fontSize: '13px', resize: 'vertical', minHeight: '80px', background: 'white', boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none' }}
              />
              {hrNotesErr && (
                <p style={{ color: '#DC2626', fontSize: '12px', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <AlertCircle className="h-3 w-3" /> {hrNotesErr}
                </p>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => handleDecision('ai-reject')} style={{ background: '#DC2626', color: 'white', border: 'none', borderRadius: '8px', padding: '10px 20px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                ✕ Reject
              </button>
              <button onClick={() => handleDecision('ai-select')} style={{ background: '#7C3AED', color: 'white', border: 'none', borderRadius: '8px', padding: '10px 20px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                ✓ Move to L2 →
              </button>
            </div>
          </div>
        )}

        {!isHR && l1Status === 'Scheduled' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#9CA3AF', background: '#F9FAFB', borderRadius: '8px', padding: '8px 12px', border: '1px solid #E5E7EB' }}>
            👁 AI interview completed. Waiting for HR to review and decide.
          </div>
        )}

      </div>
    );
  }

  return null;
};