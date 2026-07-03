'use client';
// app/interview/reschedule/[token]/RescheduleClient.tsx

import { useEffect, useState, forwardRef } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { format, parse, isValid, addDays, startOfDay } from 'date-fns';

type InfoState =
  | { status: 'loading' }
  | { status: 'ineligible'; reason: string; currentDate: string | null; currentTimeSlot: string | null }
  | { status: 'eligible'; candidateName: string; currentDate: string | null; currentTimeSlot: string | null };

// ── Custom input to match the app's existing DatePicker styling ────────────
interface DateInputProps {
  value?: string;
  onClick?: () => void;
  placeholder?: string;
}
const DateInput = forwardRef<HTMLButtonElement, DateInputProps>(
  ({ value, onClick, placeholder }, ref) => (
    <button
      type="button"
      onClick={onClick}
      ref={ref}
      style={{
        width: '100%', textAlign: 'left', border: '1px solid #E2E8F0', borderRadius: '8px',
        padding: '10px 12px', fontSize: '14px', background: 'white', cursor: 'pointer',
        color: value ? '#0F172A' : '#94A3B8',
      }}
    >
      📅 {value || placeholder}
    </button>
  ),
);
DateInput.displayName = 'DateInput';

export default function RescheduleClient({ token }: { token: string }) {
  const [info, setInfo] = useState<InfoState>({ status: 'loading' });
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  // Allowed window: day-after-tomorrow through today + 3 calendar days (inclusive)
  // Screening Round reschedules can no longer target today or tomorrow —
  // earliest selectable date is today + 2.
  const todayStart = startOfDay(new Date());
  const minDate = addDays(todayStart, 2);
  const maxDate = addDays(todayStart, 3);

  useEffect(() => {
    fetch(`/api/interview/reschedule/info?token=${encodeURIComponent(token)}`)
      .then(res => res.json())
      .then(data => {
        if (data.eligible) {
          setInfo({
            status: 'eligible',
            candidateName: data.candidateName,
            currentDate: data.currentDate,
            currentTimeSlot: data.currentTimeSlot,
          });
        } else {
          setInfo({
            status: 'ineligible',
            reason: data.reason || 'unknown',
            currentDate: data.currentDate ?? null,
            currentTimeSlot: data.currentTimeSlot ?? null,
          });
        }
      })
      .catch(() => setInfo({ status: 'ineligible', reason: 'error', currentDate: null, currentTimeSlot: null }));
  }, [token]);

  const handleSubmit = async () => {
    setError('');
    if (!selectedDate) { setError('Please select a new interview date.'); return; }

    setSubmitting(true);
    try {
      const res = await fetch('/api/interview/reschedule/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newDate: format(selectedDate, 'yyyy-MM-dd') }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.');
        setSubmitting(false);
        return;
      }
      setSubmitted(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const wrap = (children: React.ReactNode) => (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC', fontFamily: 'Inter, system-ui, sans-serif', padding: '2rem' }}>
      <div style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: '20px', padding: '40px', maxWidth: '480px', width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
        {children}
      </div>
    </div>
  );

  if (info.status === 'loading') {
    return wrap(<p style={{ textAlign: 'center', color: '#64748B' }}>Loading…</p>);
  }

  if (submitted) {
    return wrap(
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '40px', marginBottom: '12px' }}>✅</div>
        <h1 style={{ fontSize: '20px', fontWeight: 800, color: '#0F172A', marginBottom: '10px' }}>
          Interview Rescheduled Successfully
        </h1>
        <p style={{ fontSize: '14px', color: '#64748B', lineHeight: 1.7, marginBottom: '8px' }}>
          Your interview has been successfully rescheduled.
        </p>
        <p style={{ fontSize: '13px', color: '#64748B', lineHeight: 1.7, marginBottom: '8px' }}>
          A new interview invitation containing your secure interview link will be sent automatically
          12 hours before your interview.
        </p>
        <p style={{ fontSize: '13px', color: '#94A3B8', fontWeight: 600 }}>
          No further rescheduling is allowed.
        </p>
      </div>,
    );
  }

  if (info.status === 'ineligible') {
    if (info.reason === 'window_closed') {
           return wrap(
             <div style={{ textAlign: 'center' }}>
               <div style={{ fontSize: '40px', marginBottom: '12px' }}>⏰</div>
              <h1 style={{ fontSize: '18px', fontWeight: 800, color: '#0F172A', marginBottom: '10px' }}>
                Reschedule Window Expired
               </h1>
               <p style={{ fontSize: '13px', color: '#64748B', lineHeight: 1.7, marginBottom: '8px' }}>
                 You can reschedule your Screening Round interview only once and within 48 hours of receiving your interview invitation email.
               </p>
               <p style={{ fontSize: '13px', color: '#64748B', lineHeight: 1.7, marginBottom: '8px' }}>
                Your reschedule window has now expired.
                </p>
               <p style={{ fontSize: '13px', color: '#64748B', lineHeight: 1.7 }}>
                 Please contact the hiring team if you require further assistance.
               </p>
               {info.currentDate && (
                  <p style={{ fontSize: '12px', color: '#94A3B8', marginTop: '14px' }}>
                    Your current interview: <strong>{info.currentDate}</strong> {info.currentTimeSlot ? `· ${info.currentTimeSlot}` : ''}
                  </p>
               )}
              </div>,
            );
          }
    const message =
      info.reason === 'already_used'
        ? 'You have already used your one-time reschedule request.'
        : info.reason === 'already_completed'
        ? 'You have already completed this interview, so it cannot be rescheduled.'
        : 'This reschedule link is invalid.';
    return wrap(
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔒</div>
        <h1 style={{ fontSize: '18px', fontWeight: 800, color: '#0F172A', marginBottom: '10px' }}>
          Reschedule Not Available
        </h1>
        <p style={{ fontSize: '13px', color: '#64748B', lineHeight: 1.7 }}>{message}</p>
        {info.currentDate && (
          <p style={{ fontSize: '12px', color: '#94A3B8', marginTop: '14px' }}>
            Your current interview: <strong>{info.currentDate}</strong> {info.currentTimeSlot ? `· ${info.currentTimeSlot}` : ''}
          </p>
        )}
      </div>,
    );
  }

  // eligible
  return wrap(
    <>
      <h1 style={{ fontSize: '20px', fontWeight: 800, color: '#0F172A', marginBottom: '6px' }}>
        Reschedule Your Screening Interview
      </h1>
      <p style={{ fontSize: '13px', color: '#64748B', marginBottom: '20px' }}>
        Hi {info.candidateName || 'there'}, pick a new date below. Your interview time stays the same.
      </p>

      <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '12px 14px', marginBottom: '18px' }}>
        <p style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', marginBottom: '4px' }}>CURRENT SCHEDULE</p>
        <p style={{ fontSize: '13px', color: '#111827', margin: 0 }}>
          {info.currentDate || '—'} {info.currentTimeSlot ? `· ${info.currentTimeSlot}` : ''}
        </p>
      </div>

      <div style={{ marginBottom: '6px' }}>
        <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '6px' }}>
          New Interview Date
        </label>
        <DatePicker
          selected={selectedDate}
          onChange={(date: Date | null) => { setSelectedDate(date); setError(''); }}
          minDate={minDate}
          maxDate={maxDate}
          dateFormat="dd-MM-yyyy"
          placeholderText="Select a date"
          customInput={<DateInput placeholder="Select a date" />}
        />
       <p style={{ fontSize: '11px', color: '#94A3B8', marginTop: '6px' }}>
          You may only choose a date between {format(minDate, 'dd MMM yyyy')} and {format(maxDate, 'dd MMM yyyy')}.
          Today and tomorrow are not available for rescheduling.
          Your interview time ({info.currentTimeSlot || 'as originally scheduled'}) will stay the same.
        </p>
      </div>

      {error && <p style={{ color: '#DC2626', fontSize: '12px', marginBottom: '10px' }}>{error}</p>}

      <p style={{ fontSize: '11px', color: '#94A3B8', marginBottom: '16px', lineHeight: 1.6 }}>
        ⚠ You may reschedule only once. After submitting, this option will be permanently disabled.
      </p>

      <button
        onClick={handleSubmit}
        disabled={submitting}
        style={{
          width: '100%', background: submitting ? '#94A3B8' : 'linear-gradient(135deg, #6366F1, #8B5CF6)',
          color: 'white', border: 'none', borderRadius: '10px', padding: '13px', fontSize: '14px',
          fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer',
        }}
      >
        {submitting ? 'Submitting…' : 'Confirm New Schedule'}
      </button>
    </>,
  );
}