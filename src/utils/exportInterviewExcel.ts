// utils/exportInterviewExcel.ts
// Place at: src/utils/exportInterviewExcel.ts

import * as XLSX from 'xlsx';

export interface InterviewQuestionAnswer {
  questionNumber: number;
  questionText: string;
  answerTranscript: string;
  codeAnswer?: string;
  timeTakenSeconds?: number;
}

export interface InterviewExportRow {
  candidateName: string;
  email: string;
  phone?: string;
  jobRole: string;
  experience: string;
  location?: string;
  currentCTC?: string | number;
  expectedCTC?: string | number;
  noticePeriod?: string;
  interviewDate: string;
  interviewCompletedAt?: string;
  stage?: string;
  overallScore?: number;
  technicalScore?: number;
  communicationScore?: number;
  bodyLanguageScore?: number;
  eyeContactScore?: number;
  aiSummary?: string;
  questionsAndAnswers: InterviewQuestionAnswer[];
}

// ─── Colors ───────────────────────────────────────────────────────────────────
const C = {
  purple:      'FF7C3AED',
  purpleLight: 'FFF5F3FF',
  green:       'FF059669',
  greenLight:  'FFF0FDF4',
  amber:       'FFD97706',
  amberLight:  'FFFEF3C7',
  slate:       'FF334155',
  slateLight:  'FFF8FAFC',
  white:       'FFFFFFFF',
  border:      'FFE2E8F0',
  headerBg:    'FF1E1B4B',
  subHeaderBg: 'FF4C1D95',
  codeBg:      'FF1E1E1E',
  codeText:    'FFD4D4D4',
  gray100:     'FFF3F4F6',
  gray200:     'FFE5E7EB',
  gray600:     'FF4B5563',
  gray800:     'FF1F2937',
  answerBg:    'FFFFFDF5',   // warm cream for answer rows
  qBg:         'FFF0F4FF',   // soft blue for question rows
};

type CellStyle = {
  font?: Record<string, unknown>;
  fill?: Record<string, unknown>;
  alignment?: Record<string, unknown>;
  border?: Record<string, unknown>;
  numFmt?: string;
};

const thinBorder = {
  top:    { style: 'thin', color: { rgb: C.border } },
  bottom: { style: 'thin', color: { rgb: C.border } },
  left:   { style: 'thin', color: { rgb: C.border } },
  right:  { style: 'thin', color: { rgb: C.border } },
};

const medBorder = {
  top:    { style: 'medium', color: { rgb: C.purple } },
  bottom: { style: 'medium', color: { rgb: C.purple } },
  left:   { style: 'medium', color: { rgb: C.purple } },
  right:  { style: 'medium', color: { rgb: C.purple } },
};

const colLetter = (n: number): string => {
  let s = '';
  let num = n;
  while (num > 0) { num--; s = String.fromCharCode(65 + (num % 26)) + s; num = Math.floor(num / 26); }
  return s;
};
const cellRef = (col: number, row: number) => `${colLetter(col)}${row}`;

const makeCell = (value: string | number | null | undefined, style: CellStyle = {}): XLSX.CellObject => ({
  v: value ?? '',
  t: typeof value === 'number' ? 'n' : 's',
  s: { border: thinBorder, alignment: { vertical: 'top', wrapText: true }, ...style },
});

const headerCell = (value: string, bg = C.headerBg): XLSX.CellObject =>
  makeCell(value, {
    font:      { bold: true, color: { rgb: C.white }, sz: 11, name: 'Calibri' },
    fill:      { fgColor: { rgb: bg }, patternType: 'solid' },
    alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
  });

const subHeaderCell = (value: string, bg = C.subHeaderBg): XLSX.CellObject =>
  makeCell(value, {
    font:      { bold: true, color: { rgb: C.white }, sz: 10, name: 'Calibri' },
    fill:      { fgColor: { rgb: bg }, patternType: 'solid' },
    alignment: { horizontal: 'left', vertical: 'middle', wrapText: true },
  });

const scoreCell = (score: number | undefined): XLSX.CellObject => {
  if (score === undefined || score === null) return makeCell('—');
  let bg = C.greenLight; let fg = C.green;
  if (score < 50)      { bg = 'FFFEF2F2'; fg = 'FFDC2626'; }
  else if (score < 70) { bg = C.amberLight; fg = C.amber; }
  return { v: score, t: 'n', s: { border: thinBorder, font: { bold: true, color: { rgb: fg }, sz: 10, name: 'Calibri' }, fill: { fgColor: { rgb: bg }, patternType: 'solid' }, alignment: { horizontal: 'center', vertical: 'middle' }, numFmt: '0' } };
};

const codeCell = (code: string | undefined): XLSX.CellObject => {
  if (!code?.trim()) return makeCell('—');
  return makeCell(code, {
    font:      { color: { rgb: C.codeText }, sz: 8, name: 'Courier New' },
    fill:      { fgColor: { rgb: C.codeBg }, patternType: 'solid' },
    alignment: { vertical: 'top', wrapText: true },
  });
};

// ─── Sheet 1: Summary (one row per candidate) ─────────────────────────────────
function buildSummarySheet(data: InterviewExportRow[]): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  const headers = [
    '#', 'Candidate Name', 'Email', 'Phone', 'Job Role', 'Experience',
    'Location', 'Current CTC', 'Expected CTC', 'Notice Period',
    'Interview Date', 'Overall Score', 'Technical', 'Communication',
    'Body Language', 'Eye Contact', 'AI Summary', 'Stage',
  ];
  const colWidths = [4, 22, 28, 14, 22, 12, 16, 12, 12, 14, 22, 12, 10, 14, 14, 10, 60, 10];

  ws[cellRef(1, 1)] = makeCell('SmartHire · AI Interview Report — Candidate Summary', {
    font: { bold: true, color: { rgb: C.white }, sz: 14, name: 'Calibri' },
    fill: { fgColor: { rgb: C.headerBg }, patternType: 'solid' },
    alignment: { horizontal: 'center', vertical: 'middle' },
  });
  ws[cellRef(1, 2)] = makeCell(
    `Generated: ${new Date().toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' })}`,
    { font: { italic: true, color: { rgb: C.gray600 }, sz: 9, name: 'Calibri' }, fill: { fgColor: { rgb: C.slateLight }, patternType: 'solid' }, alignment: { horizontal: 'right', vertical: 'middle' } }
  );
  headers.forEach((h, i) => { ws[cellRef(i + 1, 3)] = headerCell(h); });

  data.forEach((row, ri) => {
    const r = ri + 4;
    const rowBg = ri % 2 === 0 ? C.white : C.slateLight;
    const bg = (extra: CellStyle = {}): CellStyle => ({
      font: { color: { rgb: C.gray800 }, sz: 9, name: 'Calibri' },
      fill: { fgColor: { rgb: rowBg }, patternType: 'solid' },
      ...extra,
    });
    ws[cellRef(1,  r)] = makeCell(ri + 1, bg({ font: { bold: true, sz: 9, name: 'Calibri', color: { rgb: C.purple } }, alignment: { horizontal: 'center', vertical: 'top' } }));
    ws[cellRef(2,  r)] = makeCell(row.candidateName,             bg({ font: { bold: true, sz: 9, name: 'Calibri', color: { rgb: C.gray800 } } }));
    ws[cellRef(3,  r)] = makeCell(row.email,                     bg());
    ws[cellRef(4,  r)] = makeCell(row.phone ?? '—',             bg());
    ws[cellRef(5,  r)] = makeCell(row.jobRole,                   bg());
    ws[cellRef(6,  r)] = makeCell(row.experience,                bg({ alignment: { horizontal: 'center', vertical: 'top' } }));
    ws[cellRef(7,  r)] = makeCell(row.location ?? '—',          bg());
    ws[cellRef(8,  r)] = makeCell(String(row.currentCTC  ?? '—'), bg());
    ws[cellRef(9,  r)] = makeCell(String(row.expectedCTC ?? '—'), bg());
    ws[cellRef(10, r)] = makeCell(row.noticePeriod ?? '—',       bg());
    ws[cellRef(11, r)] = makeCell(row.interviewDate,              bg());
    ws[cellRef(12, r)] = scoreCell(row.overallScore);
    ws[cellRef(13, r)] = scoreCell(row.technicalScore);
    ws[cellRef(14, r)] = scoreCell(row.communicationScore);
    ws[cellRef(15, r)] = scoreCell(row.bodyLanguageScore);
    ws[cellRef(16, r)] = scoreCell(row.eyeContactScore);
    ws[cellRef(17, r)] = makeCell(row.aiSummary ?? '—',          bg({ alignment: { vertical: 'top', wrapText: true } }));
    ws[cellRef(18, r)] = makeCell(row.stage ?? 'L1',             bg({ alignment: { horizontal: 'center', vertical: 'top' } }));
  });

  const lastRow = data.length + 3;
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } },
  ];
  ws['!ref']    = `A1:${cellRef(headers.length, lastRow)}`;
  ws['!cols']   = colWidths.map(w => ({ wch: w }));
  ws['!freeze'] = { xSplit: 0, ySplit: 3 };
  return ws;
}

// ─── Sheet 2: Q&A Only — clean, no repeated candidate meta ───────────────────
function buildQASheet(data: InterviewExportRow[]): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  const merges: XLSX.Range[] = [];

  // 5 columns: Q# | Question | Answer | Code | Time
  const COLS  = { q: 1, question: 2, answer: 3, code: 4, time: 5 };
  const colWidths = [6, 48, 58, 46, 13];

  let row = 1;

  // ── Page title ──────────────────────────────────────────────────────────────
  ws[cellRef(1, row)] = makeCell('SmartHire · AI Interview — Questions & Answers', {
    font:      { bold: true, color: { rgb: C.white }, sz: 14, name: 'Calibri' },
    fill:      { fgColor: { rgb: C.headerBg }, patternType: 'solid' },
    alignment: { horizontal: 'center', vertical: 'middle' },
  });
  merges.push({ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: 4 } });
  row++;

  ws[cellRef(1, row)] = makeCell(
    `Generated: ${new Date().toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' })}`,
    { font: { italic: true, color: { rgb: C.gray600 }, sz: 9, name: 'Calibri' }, fill: { fgColor: { rgb: C.slateLight }, patternType: 'solid' }, alignment: { horizontal: 'right', vertical: 'middle' } }
  );
  merges.push({ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: 4 } });
  row++;

  // ── One block per candidate ─────────────────────────────────────────────────
  data.forEach((candidate, ci) => {

    // ── Candidate name banner (slim — just name + role + date) ──────────────
    ws[cellRef(1, row)] = makeCell(
      `${ci + 1}.  ${candidate.candidateName}   ·   ${candidate.jobRole}   ·   ${candidate.interviewDate}`,
      {
        font:      { bold: true, color: { rgb: C.white }, sz: 11, name: 'Calibri' },
        fill:      { fgColor: { rgb: C.subHeaderBg }, patternType: 'solid' },
        alignment: { horizontal: 'left', vertical: 'middle' },
        border:    medBorder,
      }
    );
    merges.push({ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: 4 } });
    row++;

    // ── Column headers for this candidate's Q&A block ────────────────────────
    ws[cellRef(COLS.q,        row)] = subHeaderCell('Q #',                        'FF374151');
    ws[cellRef(COLS.question, row)] = subHeaderCell('AI Question Asked',          'FF374151');
    ws[cellRef(COLS.answer,   row)] = subHeaderCell('Candidate Answer',           'FF374151');
    ws[cellRef(COLS.code,     row)] = subHeaderCell('Code Answer (if any)',       'FF374151');
    ws[cellRef(COLS.time,     row)] = subHeaderCell('Time Taken',                 'FF374151');
    row++;

    // ── Q&A rows ─────────────────────────────────────────────────────────────
    if (!candidate.questionsAndAnswers?.length) {
      ws[cellRef(1, row)] = makeCell('No questions recorded for this candidate.', {
        font:      { italic: true, color: { rgb: C.gray600 }, sz: 9, name: 'Calibri' },
        fill:      { fgColor: { rgb: C.gray100 }, patternType: 'solid' },
        alignment: { horizontal: 'center', vertical: 'middle' },
      });
      merges.push({ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: 4 } });
      row++;
    } else {
      candidate.questionsAndAnswers.forEach((qa) => {
        // ── Q row (question on blue background) ────────────────────────────
        ws[cellRef(COLS.q, row)] = {
          v: `Q${qa.questionNumber}`, t: 's',
          s: {
            border: thinBorder,
            font:      { bold: true, color: { rgb: C.purple }, sz: 13, name: 'Calibri' },
            fill:      { fgColor: { rgb: C.qBg }, patternType: 'solid' },
            alignment: { horizontal: 'center', vertical: 'middle' },
          },
        };
        ws[cellRef(COLS.question, row)] = makeCell(qa.questionText, {
          font:      { bold: true, color: { rgb: 'FF1E3A5F' }, sz: 10, name: 'Calibri' },
          fill:      { fgColor: { rgb: C.qBg }, patternType: 'solid' },
          alignment: { vertical: 'top', wrapText: true },
        });
        // Answer + Code + Time also on the same row
        const hasAnswer = qa.answerTranscript?.trim();
        ws[cellRef(COLS.answer, row)] = makeCell(
          hasAnswer ? qa.answerTranscript : '(No transcript captured)',
          {
            font:      { color: { rgb: hasAnswer ? C.gray800 : C.gray600 }, sz: 9, name: 'Calibri', italic: !hasAnswer },
            fill:      { fgColor: { rgb: C.answerBg }, patternType: 'solid' },
            alignment: { vertical: 'top', wrapText: true },
          }
        );
        ws[cellRef(COLS.code, row)] = qa.codeAnswer?.trim()
          ? codeCell(qa.codeAnswer)
          : makeCell('—', {
              font:      { color: { rgb: C.gray600 }, sz: 9, name: 'Calibri' },
              fill:      { fgColor: { rgb: C.white }, patternType: 'solid' },
              alignment: { horizontal: 'center', vertical: 'top' },
            });
        ws[cellRef(COLS.time, row)] = makeCell(
          qa.timeTakenSeconds !== undefined
            ? `${Math.floor(qa.timeTakenSeconds / 60)}m ${qa.timeTakenSeconds % 60}s`
            : '—',
          {
            font:      { color: { rgb: C.gray600 }, sz: 9, name: 'Calibri' },
            fill:      { fgColor: { rgb: C.white }, patternType: 'solid' },
            alignment: { horizontal: 'center', vertical: 'top' },
          }
        );
        row++;
      });
    }

    // ── Thin separator between candidates ────────────────────────────────────
    for (let c = 1; c <= 5; c++) {
      ws[cellRef(c, row)] = makeCell('', { fill: { fgColor: { rgb: C.gray200 }, patternType: 'solid' }, border: {} });
    }
    row++;
  });

  ws['!ref']    = `A1:${cellRef(5, row)}`;
  ws['!cols']   = colWidths.map(w => ({ wch: w }));
  ws['!merges'] = merges;
  ws['!rows'] = Array.from({ length: row }, (_, i) => ({ hpt: 80 }));
  ws['!freeze'] = { xSplit: 0, ySplit: 2 };
  return ws;
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function exportInterviewsToExcel(data: InterviewExportRow[], filename?: string): void {
  if (!data?.length) { console.warn('[exportInterviewsToExcel] No data.'); return; }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSummarySheet(data), '📊 Summary');
  XLSX.utils.book_append_sheet(wb, buildQASheet(data),      '📝 Q&A');
  XLSX.writeFile(wb, filename ?? `SmartHire_Interviews_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ─── buildExportRow ───────────────────────────────────────────────────────────
// Reads directly from Firestore candidate doc.
// ── Date fix: tries l1AICompletedAt (Firestore Timestamp or ISO string) ──────
// ── Q&A fix:  reads questions / transcripts / timings arrays saved by /api/interview/score
//
// ── EXCEL EXPORT FIX (unanswered-questions bug) ──────────────────────────────
// ROOT CAUSE: "questions exist?" was being decided purely from the question
// TEXT array (l1AIQuestions / aiQuestions / questions). On candidates who
// answered ZERO questions, that text array can come back empty even though
// the interview genuinely had questions — the question COUNT is still saved
// separately by /api/interview/score as l1AITotalQuestions / totalQuestions.
// Because the export only looked at the text array, it wrongly treated
// "no answers" as "no questions" and rendered the "No questions recorded
// for this candidate." fallback instead of listing the questions with
// "(No transcript captured)".
//
// FIX: if the question-text array is empty but a real question count exists
// on the doc, synthesize placeholder question rows ("Question 1", "Question
// 2", …) so every asked question still gets its own row in the export, with
// the Candidate Answer column showing "(No transcript captured)" via the
// existing buildQASheet hasAnswer check. No scoring, evaluation, transcript
// storage, or database logic is touched — this only changes what feeds the
// Excel export.

export function buildExportRow(candidateDoc: Record<string, any>): InterviewExportRow {

  // ── 1. Interview date — try every field where it could be stored ────────────
  const rawDate =
    candidateDoc.l1AICompletedAt   ??   // set by /api/interview/score when scoring finishes
    candidateDoc.l1CompletedAt     ??
    candidateDoc.completedAt       ??
    candidateDoc.l1ScheduledDate   ??
    null;

  let interviewDate = 'N/A';
  if (rawDate) {
    try {
      // Firestore Timestamp object
      if (typeof rawDate === 'object' && 'seconds' in rawDate) {
        interviewDate = new Date(rawDate.seconds * 1000).toLocaleString('en-IN', {
          day: '2-digit', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        });
      } else {
        // ISO string or plain date string
        const d = new Date(rawDate);
        if (!isNaN(d.getTime())) {
          interviewDate = d.toLocaleString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
          });
        }
      }
    } catch { /* leave as N/A */ }
  }

  // ── 2. Questions & answers ───────────────────────────────────────────────────
  // Your /api/interview/score saves these fields. Try all known field names.
  const questions: string[] =
    candidateDoc.l1AIQuestions    ??
    candidateDoc.aiQuestions      ??
    candidateDoc.questions        ??
    [];

  const transcripts: string[] =
    candidateDoc.l1AITranscripts  ??
    candidateDoc.aiTranscripts    ??
    candidateDoc.transcripts      ??
    [];

  const timings: number[] =
    candidateDoc.l1AITimings      ??
    candidateDoc.aiTimings        ??
    candidateDoc.timings          ??
    [];

  // ── FIX: fall back to the saved question COUNT when the question TEXT
  // array is empty. This is what distinguishes "questions were asked but
  // none were answered" (export all questions with placeholder text +
  // "(No transcript captured)") from "no questions were ever asked/recorded"
  // (export keeps showing the "No questions recorded" message via the empty
  // array reaching buildQASheet unchanged).
  const totalQuestionsMeta: number =
    candidateDoc.l1AITotalQuestions ??
    candidateDoc.totalQuestions     ??
    0;

  const effectiveQuestions: string[] =
    questions.length > 0
      ? questions
      : totalQuestionsMeta > 0
        ? Array.from({ length: totalQuestionsMeta }, (_, i) => `Question ${i + 1}`)
        : [];

  const isCodeQ = (text: string) => /\bwrite\b|\bimplement\b|\bpseudocode\b/i.test(text);
  const lastQ   = effectiveQuestions.length - 1;

  const questionsAndAnswers = effectiveQuestions.map((q, i) => ({
    questionNumber:   i + 1,
    questionText:     q,
    answerTranscript: transcripts[i]?.trim() ?? '',
    codeAnswer:       i === lastQ && isCodeQ(q) ? (candidateDoc.l1AICodeAnswer ?? candidateDoc.codeAnswer ?? '') : undefined,
    timeTakenSeconds: timings[i],
  }));

  return {
    candidateName:      candidateDoc.candidateName        ?? '',
    email:              candidateDoc.candidateEmail        ?? '',
    phone:              candidateDoc.phoneNumber           ?? candidateDoc.phone ?? '',
    jobRole:            candidateDoc.candidateDesignation  ?? '',
    experience:         String(candidateDoc.experience     ?? ''),
    location:           candidateDoc.location              ?? '',
    currentCTC:         candidateDoc.currentCtc            ?? '',
    expectedCTC:        candidateDoc.expectedCtc           ?? '',
    noticePeriod:       candidateDoc.noticePeriod          ?? '',
    stage:              'L1',
    interviewDate,
    interviewCompletedAt: rawDate ?? undefined,
    overallScore:       candidateDoc.l1AIScore              ?? undefined,
    technicalScore:     candidateDoc.l1AITechnicalScore     ?? undefined,
    communicationScore: candidateDoc.l1AICommunicationScore ?? undefined,
    bodyLanguageScore:  candidateDoc.l1AIBodyLanguageScore  ?? undefined,
    eyeContactScore:    candidateDoc.l1AIEyeContactScore    ?? undefined,
    aiSummary:          candidateDoc.l1AISummary            ?? '',
    questionsAndAnswers,
  };
}