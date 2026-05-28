// components/ExportInterviewButton.tsx
// Place at: src/components/ExportInterviewButton.tsx
//
// ── Usage 1: Single candidate (inside the AI Interview Report card) ───────────
//
//   import ExportInterviewButton from '@/components/ExportInterviewButton';
//
//   <ExportInterviewButton candidateDoc={candidate} />
//
// ── Usage 2: All candidates (Candidate List page) ────────────────────────────
//
//   <ExportInterviewButton allCandidateDocs={candidates} />
//
// Both accept the raw Candidate object from Firestore — no manual mapping needed.
// ─────────────────────────────────────────────────────────────────────────────

'use client';

import { useState } from 'react';
import { exportInterviewsToExcel, buildExportRow } from '@/utils/exportInterviewExcel';

// ─── Props ────────────────────────────────────────────────────────────────────
// Accept the raw Firestore candidate doc (Record<string,any>) so there
// is NO type mismatch with your Candidate type.

interface SingleProps {
  candidateDoc:     Record<string, any>;
  allCandidateDocs?: never;
  variant?:          'icon' | 'full';
}

interface MultiProps {
  allCandidateDocs: Record<string, any>[];
  candidateDoc?:    never;
  variant?:         'icon' | 'full';
}

type Props = SingleProps | MultiProps;

// ─── Component ────────────────────────────────────────────────────────────────

export default function ExportInterviewButton({ candidateDoc, allCandidateDocs, variant = 'full' }: Props) {
  const [loading, setLoading] = useState(false);
  const [done,    setDone]    = useState(false);

  const handleExport = async () => {
    setLoading(true);
    setDone(false);
    await new Promise(r => setTimeout(r, 60));   // let React re-render first

    try {
      if (allCandidateDocs) {
        // ── Multi export (Candidate List) ──────────────────────────
        const rows = allCandidateDocs.map(doc => buildExportRow(doc));
        exportInterviewsToExcel(
          rows,
          `SmartHire_All_Interviews_${new Date().toISOString().slice(0, 10)}.xlsx`
        );
      } else if (candidateDoc) {
        // ── Single export (AI Interview Report card) ───────────────
        const row = buildExportRow(candidateDoc);
        const safeName = (candidateDoc.candidateName ?? 'Candidate').replace(/\s+/g, '_');
        exportInterviewsToExcel([row], `SmartHire_${safeName}_Interview.xlsx`);
      }

      setDone(true);
      setTimeout(() => setDone(false), 3000);
    } catch (err) {
      console.error('[ExportInterviewButton]', err);
      alert('Export failed — check console for details.');
    } finally {
      setLoading(false);
    }
  };

  // ── Icon variant (compact, for table rows) ────────────────────────────────
  if (variant === 'icon') {
    return (
      <>
        <button
          onClick={handleExport}
          disabled={loading}
          title="Export interview to Excel"
          style={{
            display:        'inline-flex',
            alignItems:     'center',
            justifyContent: 'center',
            width:          '34px',
            height:         '34px',
            borderRadius:   '8px',
            border:         `1px solid ${done ? '#86EFAC' : '#D1D5DB'}`,
            background:     done ? '#F0FDF4' : '#FFFFFF',
            cursor:         loading ? 'wait' : 'pointer',
            transition:     'all 0.2s',
            flexShrink:     0,
          }}
        >
          {loading ? <SpinIcon /> : done ? <CheckIcon /> : <ExcelIcon size={15} />}
        </button>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </>
    );
  }

  // ── Full variant (default) ────────────────────────────────────────────────
  const count = allCandidateDocs?.length;

  return (
    <>
      <button
        onClick={handleExport}
        disabled={loading}
        style={{
          display:     'inline-flex',
          alignItems:  'center',
          gap:         '8px',
          padding:     '9px 16px',
          borderRadius:'8px',
          border:      `1px solid ${done ? '#86EFAC' : '#D1D5DB'}`,
          background:  done ? '#F0FDF4' : loading ? '#F9FAFB' : '#FFFFFF',
          color:       done ? '#15803D' : '#374151',
          fontSize:    '13px',
          fontWeight:  600,
          cursor:      loading ? 'wait' : 'pointer',
          transition:  'all 0.2s',
          whiteSpace:  'nowrap',
          boxShadow:   '0 1px 2px rgba(0,0,0,0.05)',
        }}
      >
        {loading ? (
          <><SpinIcon /> Exporting…</>
        ) : done ? (
          <><CheckIcon /> Downloaded!</>
        ) : (
          <>
            <ExcelIcon size={15} />
            {count !== undefined ? `Export All (${count})` : 'Export to Excel'}
          </>
        )}
      </button>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </>
  );
}

// ─── Icon helpers ─────────────────────────────────────────────────────────────

function SpinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" stroke="#E5E7EB" strokeWidth="3" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="#7C3AED" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path d="M5 13l4 4L19 7" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ExcelIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <rect x="2" y="3" width="20" height="18" rx="3" fill="#16A34A" />
      <rect x="8" y="3" width="1.5" height="18" fill="rgba(255,255,255,0.2)" />
      <rect x="2" y="8.5" width="20" height="1.2" fill="rgba(255,255,255,0.2)" />
      <rect x="2" y="14" width="20" height="1.2" fill="rgba(255,255,255,0.2)" />
      <text x="4.5" y="13.5" fontSize="7" fontWeight="bold" fill="white" fontFamily="Arial,sans-serif">XLS</text>
      <path d="M15 10l2.5 4.5M17.5 10L15 14.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}