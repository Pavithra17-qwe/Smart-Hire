'use client';

import { useState, useMemo, useEffect,forwardRef } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { format, parse, isValid } from 'date-fns';
import Link from 'next/link';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import 'react-datepicker/dist/react-datepicker.css';
import { useId } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Search, RotateCcw, ChevronDown, ChevronUp, XCircle, Eye, FileText } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
interface RejectedCandidate {
  id: string;
  candidateName: string;
  candidateEmail: string;
  phoneNumber: string;
  candidateDesignation: string;
  projectName?: string;
  rejectedStage?: string;
  rejectionReason?: string;
  rejectionDate?: any;
  rejectedByName?: string;
  rejectedByEmail?: string;
  createdDate?: any;
  finalStatus?: string;
  resumeReviewStatus?: string;
  resumeFeedback?: string;
  resumeHRFeedback?: string;
  resumePanelFeedback?: string;
  l1Status?: string;
  l1Feedback?: string;
  l2Status?: string;
  l2Feedback?: string;
  l2ManagerStatus?: string;
  l2ManagerFeedback?: string;
  hrStatus?: string;
  hrFeedback?: string;
  offerStatus?: string;
  offerFeedback?: string;
  newOfferStatus?: string;
  resumeFile?: { name?: string; type?: string; data?: string } | null;
  [key: string]: any;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Derives the stage at which the candidate was rejected
 * by walking down the pipeline and finding the first Rejected status.
 * Uses the DISPLAY mapping (same shift as Candidate History page):
 *   Screening Status  ← l1Status
 *   L1 Status         ← l2Status
 *   L2 Status         ← hrStatus
 *   HR Status         ← offerStatus
 *   Offer Status      ← newOfferStatus
 */
function deriveRejectedStage(c: RejectedCandidate): string {
  if ((c.resumeReviewStatus ?? '').toLowerCase() === 'rejected') return 'Resume Review';
  if ((c.l1Status ?? '').toLowerCase() === 'rejected') return 'Screening';
  if ((c.l2Status ?? '').toLowerCase() === 'rejected') return 'L1 Interview';
  if ((c.hrStatus ?? '').toLowerCase() === 'rejected') return 'L2 Interview';
  if ((c.offerStatus ?? '').toLowerCase() === 'rejected') return 'HR Round';
  if ((c.newOfferStatus ?? '').toLowerCase() === 'rejected') return 'Offer';
  return c.rejectedStage || 'Unknown';
}

/**
 * Resolves the rejection date for a candidate.
 * Priority: rejectionDate → fallback: createdDate
 */
function resolveRejectionDate(c: RejectedCandidate): any {
  return c.rejectionDate ?? c.createdDate ?? null;
}

/**
 * ── Rejection Reason resolution ──────────────────────────────────────────────
 * The Rejected Candidates page does not own rejection-reason data — it must
 * reuse the feedback already captured by the existing stage-level workflows
 * (Resume Review, Screening, L1/L2 Interview, HR Round, Offer Stage), exactly
 * as those fields are written in the Candidate Details page action handler.
 *
 * Resolution order:
 *   1. The feedback field for the stage where the candidate was actually
 *      rejected (matches deriveRejectedStage's own mapping, so the reason
 *      shown always corresponds to the badge shown).
 *   2. candidate.rejectionReason (legacy / explicit field, if present).
 *   3. The most recently written feedback field across any stage, in case
 *      rejection was recorded in a slightly different shape than expected.
 *   4. "No rejection reason was recorded." — only when truly nothing exists.
 */
function resolveRejectionReason(c: RejectedCandidate): string {
  const stage = deriveRejectedStage(c);

  const stageFeedbackMap: Record<string, (string | undefined)[]> = {
    'Resume Review': [c.resumeFeedback, c.resumeHRFeedback, c.resumePanelFeedback],
    'Screening': [c.l1Feedback],
    'L1 Interview': [c.l2Feedback],
    'L2 Interview': [c.l2ManagerFeedback, c.hrFeedback],
    'HR Round': [c.offerFeedback, c.hrFeedback],
    'Offer': [c.offerFeedback],
  };

  // 1. Stage-specific feedback, matching the stage actually shown in the badge.
  const stageCandidates = stageFeedbackMap[stage] || [];
  for (const val of stageCandidates) {
    if (val && val.trim()) return val.trim();
  }

  // 2. Legacy/explicit rejectionReason field.
  if (c.rejectionReason && c.rejectionReason.trim()) return c.rejectionReason.trim();

  // 3. Fall back to the latest feedback recorded anywhere on the candidate,
  //    in case the rejection stage detection above doesn't line up with
  //    where the feedback text actually lives.
  const anyFeedback = [
    c.offerFeedback,
    c.hrFeedback,
    c.l2ManagerFeedback,
    c.l2Feedback,
    c.l1Feedback,
    c.resumePanelFeedback,
    c.resumeHRFeedback,
    c.resumeFeedback,
  ];
  for (const val of anyFeedback) {
    if (val && val.trim()) return val.trim();
  }

  // 4. Nothing found anywhere.
  return 'No rejection reason was recorded.';
}

function formatDate(val: any): string {
  if (!val) return '—';
  if (typeof val.toDate === 'function') return val.toDate().toLocaleDateString('en-IN');
  if (val instanceof Date) return val.toLocaleDateString('en-IN');
  if (typeof val === 'string') return new Date(val).toLocaleDateString('en-IN');
  return '—';
}

function toTimestamp(val: any): number {
  if (!val) return 0;
  if (typeof val.toMillis === 'function') return val.toMillis();
  if (typeof val.toDate === 'function') return val.toDate().getTime();
  if (val instanceof Date) return val.getTime();
  if (typeof val === 'string') return new Date(val).getTime();
  return 0;
}

/**
 * Parses a `YYYY-MM-DD` string (the native <input type="date"> value format)
 * as a LOCAL calendar date at the given hour/min/sec, rather than letting
 * `new Date('YYYY-MM-DD')` parse it as UTC midnight and then mutating it
 * with .setHours() in local time — that combination silently shifts the
 * effective boundary by the browser's UTC offset, which made the date range
 * filter under- or over-include candidates depending on the user's timezone.
 */
/**
 * Parses a manually-typed DD-MM-YYYY string into a local timestamp at the
 * given hour/min/sec/ms. Returns NaN for empty, malformed, or invalid
 * (non-existent) dates so callers can treat the filter as inactive/ignored
 * rather than silently matching everything or throwing.
 */
function parseDDMMYYYY(
  dateStr: string,
  hours: number, minutes: number, seconds: number, ms: number
): number {
  if (!dateStr) return NaN;
  const match = dateStr.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return NaN;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);

  const date = new Date(year, month - 1, day, hours, minutes, seconds, ms);
  // Guard against overflow dates like 31-02-2026, which JS Date silently
  // rolls forward into March — reject anything that doesn't round-trip.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return NaN;
  }
  return date.getTime();
}

// ─── Stage badge ──────────────────────────────────────────────────────────────
const STAGE_COLORS: Record<string, string> = {
  'Resume Review': '!bg-orange-100 !text-orange-700',
  'Screening': '!bg-purple-100 !text-purple-700',
  'L1 Interview': '!bg-blue-100   !text-blue-700',
  'L2 Interview': '!bg-indigo-100 !text-indigo-700',
  'HR Round': '!bg-teal-100   !text-teal-700',
  'Offer': '!bg-pink-100   !text-pink-700',
  'Unknown': '!bg-gray-100   !text-gray-500',
};

const StageBadge = ({ stage }: { stage: string }) => (
  <Badge className={`capitalize ${STAGE_COLORS[stage] ?? STAGE_COLORS['Unknown']}`}>{stage}</Badge>
);

// ─── Constants ────────────────────────────────────────────────────────────────
const REJECTED_STAGES = [
  'Resume Review', 'Screening', 'L1 Interview', 'L2 Interview', 'HR Round', 'Offer',
];

// NOTE: Rejection Reason Filter and Rejected By Filter were removed per spec.
// Kept filters: Candidate Name, Email, Position, Rejected Stage, Date Range.
const INITIAL_FILTERS = {
  name: '',
  position: '',
  project: '',
  rejectedStage: '',
  fromDate: '',
  toDate: '',
};

// ─── Reusable resume-opening logic ────────────────────────────────────────────
// Reuses the exact same approach as Candidate Details → View Resume:
// decode the base64 resumeFile.data, build a Blob, and open it in a new tab.
// No new resume viewer is created — this mirrors the existing implementation.
function openResumeInNewTab(candidate: RejectedCandidate) {
  const file = candidate.resumeFile;
  if (!file?.data) return;
  try {
    const bytes = atob(file.data);
    const arr = new Uint8Array(bytes.length).map((_, i) => bytes.charCodeAt(i));
    const fileType = file.type || 'application/pdf';
    const blob = new Blob([arr], { type: fileType });
    const url = URL.createObjectURL(blob);
    if (fileType.includes('pdf')) {
      window.open(url, '_blank');
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name || 'resume';
      a.click();
    }
  } catch (err) {
    console.error('[RejectedCandidates] Failed to open resume:', err);
  }
}

// ─── Rejection Reason Modal ───────────────────────────────────────────────────
function RejectionReasonModal({
  candidate,
  open,
  onOpenChange,
}: {
  candidate: RejectedCandidate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!candidate) return null;
  const stage = deriveRejectedStage(candidate);
  const reason = resolveRejectionReason(candidate);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rejection Details</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Candidate Name</Label>
            <p className="text-sm font-semibold text-gray-900">{candidate.candidateName || 'N/A'}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Rejected Stage</Label>
            <div><StageBadge stage={stage} /></div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Rejection Reason</Label>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{reason}</p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Date Range Filter ────────────────────────────────────────────────────────
// Uses react-datepicker for native-feel popup calendars with month/year
// navigation, a Today shortcut, and consistent cross-browser rendering.
// Values are still passed up and stored as DD-MM-YYYY strings (same contract
// as before), so the parent's existing parseDDMMYYYY-based filtering logic
// in filteredCandidates is completely untouched.

interface DateInputProps {
  value?: string;
  onClick?: () => void;
  placeholder?: string;
}

const DateInput = forwardRef<HTMLButtonElement, DateInputProps>(
  ({ value, onClick, placeholder }, ref) => (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      ref={ref}
      className="w-full justify-start font-normal gap-2"
    >
      <CalendarIcon className="h-4 w-4 text-muted-foreground" />
      {value || <span className="text-muted-foreground">{placeholder}</span>}
    </Button>
  )
);
DateInput.displayName = 'DateInput';

// ─── Date Range Filter ────────────────────────────────────────────────────────
function DateRangeFilter({
  fromDate,
  toDate,
  onFromDateChange,
  onToDateChange,
  onClear,
}: {
  fromDate: string;
  toDate: string;
  onFromDateChange: (value: string) => void;
  onToDateChange: (value: string) => void;
  onClear: () => void;
}) {
  const isActive = !!(fromDate || toDate);
  const [rangeError, setRangeError] = useState('');

  const parseStored = (val: string): Date | null => {
    if (!val) return null;
    const parsed = parse(val, 'dd-MM-yyyy', new Date());
    return isValid(parsed) ? parsed : null;
  };

  const fromDateObj = parseStored(fromDate);
  const toDateObj   = parseStored(toDate);

  const maxDate = new Date();

  const handleFromSelect = (date: Date | null) => {
    if (!date) { onFromDateChange(''); return; }
    setRangeError('');
    if (toDateObj && date > toDateObj) {
      setRangeError('To Date was cleared because it was earlier than the new From Date.');
      onToDateChange('');
    }
    onFromDateChange(format(date, 'dd-MM-yyyy'));
  };

  const handleToSelect = (date: Date | null) => {
    if (!date) { onToDateChange(''); return; }
    if (fromDateObj && date < fromDateObj) {
      setRangeError('To Date cannot be earlier than From Date.');
      return;
    }
    setRangeError('');
    onToDateChange(format(date, 'dd-MM-yyyy'));
  };

  const handleClear = () => {
    setRangeError('');
    onClear();
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
        <div className="space-y-1">
          <Label htmlFor="from-date">From Date</Label>
          <DatePicker
            id="from-date"
            selected={fromDateObj}
            onChange={handleFromSelect}
            maxDate={maxDate}
            dateFormat="dd-MM-yyyy"
            todayButton="Today"
            showMonthDropdown
            showYearDropdown
            dropdownMode="select"
            placeholderText="dd-mm-yyyy"
            customInput={<DateInput placeholder="dd-mm-yyyy" />}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="to-date">To Date</Label>
          <DatePicker
            id="to-date"
            selected={toDateObj}
            onChange={handleToSelect}
            minDate={fromDateObj || undefined}
            maxDate={maxDate}
            dateFormat="dd-MM-yyyy"
            todayButton="Today"
            showMonthDropdown
            showYearDropdown
            dropdownMode="select"
            placeholderText="dd-mm-yyyy"
            customInput={<DateInput placeholder="dd-mm-yyyy" />}
          />
        </div>

        <div className="flex h-full items-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClear}
            disabled={!isActive}
            className="w-full"
          >
            Clear Date Filter
          </Button>
        </div>
      </div>

      {rangeError && <p className="text-xs text-red-500">{rangeError}</p>}
    </div>
  );
}
// ─── Main Page ────────────────────────────────────────────────────────────────
export default function RejectedCandidatesPage() {
  const { user, role } = useAuth();
  const router = useRouter();

  const [candidates, setCandidates] = useState<RejectedCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [showDateFilters, setShowDateFilters] = useState(false);
  const [showStageFilters, setShowStageFilters] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  // ── FIX (Issue 2 — wrong picker opening) ───────────────────────────────────
  // No refs, no manual showPicker()/focus()/blur() calls anywhere for these
  // two fields. Native <input type="date"> elements open their own picker
  // on click with zero JavaScript, and React's controlled `value` prop is
  // the only thing driving what each field displays. There is no shared
  // state, no ref, and no programmatic DOM access that could cause one
  // field's interaction to affect the other, or cause Clear Date Filter to
  // touch either picker.

  // ── Rejection Reason modal state ───────────────────────────────────────────
  const [reasonModalOpen, setReasonModalOpen] = useState(false);
  const [reasonModalCandidate, setReasonModalCandidate] = useState<RejectedCandidate | null>(null);

  const openReasonModal = (candidate: RejectedCandidate) => {
    setReasonModalCandidate(candidate);
    setReasonModalOpen(true);
  };

  // ── Fetch all candidates with finalStatus === 'Rejected' ──────────────────
  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'candidates'),
      where('finalStatus', '==', 'Rejected'),
    );

    const unsub = onSnapshot(q, snap => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as RejectedCandidate));
      // Sort newest rejection first
      docs.sort((a, b) => toTimestamp(resolveRejectionDate(b)) - toTimestamp(resolveRejectionDate(a)));
      setCandidates(docs);
      setLoading(false);
    });

    return () => unsub();
  }, [user]);

  // ── Derived option lists for filter dropdowns ─────────────────────────────
  const positionOptions = useMemo(
    () => Array.from(new Set(candidates.map(c => c.candidateDesignation).filter(Boolean))).sort(),
    [candidates]
  );

  const projectOptions = useMemo(
    () =>
      Array.from(
        new Set(
          candidates
            .map(c => (c.projectName ?? '').trim())
            .filter(p => p.length > 0)
        )
      ).sort(),
    [candidates]
  );

  // ── Filter logic ──────────────────────────────────────────────────────────
  const filteredCandidates = useMemo(() => {
    return candidates.filter(c => {
      const stage = deriveRejectedStage(c);

      const nameMatch =
        !filters.name ||
        (c.candidateName ?? '').toLowerCase().includes(filters.name.toLowerCase());

      const positionMatch =
        !filters.position ||
        (c.candidateDesignation ?? '').toLowerCase() === filters.position.toLowerCase();

      const projectMatch =
        !filters.project ||
        (c.projectName ?? '').toLowerCase() === filters.project.toLowerCase();

      const stageMatch =
        !filters.rejectedStage ||
        stage === filters.rejectedStage;

      // Date range — based on rejectionDate, falls back to createdDate.
      // FIX: use parseLocalDateBoundary instead of `new Date(str).setHours(...)`,
      // which parsed the YYYY-MM-DD string as UTC midnight and then mutated it
      // in local time — silently shifting the boundary by the user's UTC offset
      // and causing the range to under/over-include candidates.
      const refTs = toTimestamp(resolveRejectionDate(c));

      const fromMatch = !filters.fromDate || refTs >= parseDDMMYYYY(filters.fromDate, 0, 0, 0, 0);
      const toMatch = !filters.toDate || refTs <= parseDDMMYYYY(filters.toDate, 23, 59, 59, 999);

      return nameMatch && positionMatch && stageMatch && projectMatch && fromMatch && toMatch;
    });
  }, [candidates, filters]);

  const start = page * rowsPerPage;
  const end = start + rowsPerPage;
  const paginated = filteredCandidates.slice(start, end);
  const totalPages = Math.ceil(filteredCandidates.length / rowsPerPage);

  const isFiltered = Object.values(filters).some(v => v !== '');
  const isDateFiltered = !!(filters.fromDate || filters.toDate);
  const isStageFiltered = !!filters.rejectedStage;

  const handleFilterChange = (key: string, value: string) => {
    // "all" / "" sentinel values from <Select> components should behave as "no filter"
    const normalized = value === 'all' ? '' : value;
    setFilters(prev => ({ ...prev, [key]: normalized }));
    setPage(0);
  };

  // ── FIX: Clear All Filters ───────────────────────────────────────────────
  // Resets every filter field back to its initial (empty) value in a single
  // state update, and resets pagination. Previously this button was only
  // rendered when `isFiltered` was true and lived inside the same render
  // pass as the flag it controls — fine for the click itself, but if a
  // person set a stage/date filter and then collapsed that section, there
  // was no way to clear it without re-opening the section, which looked like
  // "Clear doesn't work." Clear All Filters is now ALWAYS visible (not
  // gated behind isFiltered) and clears every field, including stage/date,
  // regardless of whether their sections are expanded.
  const clearAllFilters = () => {
    setFilters({ ...INITIAL_FILTERS });
    setPage(0);
  };

  // ── FIX: Clear Date Filter ───────────────────────────────────────────────
  // Pure state update ONLY. No DOM access, no .blur(), no .focus(), no
  // direct el.value mutation, no ref access at all. Earlier attempts added
  // a manual blur() and direct DOM value clearing as "safety nets" — but
  // touching a native <input type="date"> programmatically (even just to
  // blur it or set .value on the DOM node while it's the active element)
  // can cause some browsers to treat that as continued interaction with the
  // field and reopen its picker. That was the actual cause of "Clear Date
  // Filter opens the From calendar." Removing all DOM interaction and
  // relying purely on React's controlled `value` prop to update the
  // rendered inputs avoids the picker entirely.
  const clearDateFilters = () => {
    setFilters(prev => ({ ...prev, fromDate: '', toDate: '' }));
    setPage(0);
  };

  // ── FIX: Clear Stage Filter ──────────────────────────────────────────────
  // Same fix as above, scoped to the Rejected Stage filter.
  const clearStageFilters = () => {
    setFilters(prev => ({ ...prev, rejectedStage: '' }));
    setPage(0);
  };

  // ── Re-Evaluate navigation ─────────────────────────────────────────────────
  // FIX: the previous route (`/candidates/${id}/re-evaluate`) does not exist,
  // which produced a 404. The actual Candidate Evaluation page supports
  // re-evaluation mode via a `?reEvaluate=<candidateId>` query parameter
  // (see CandidateEvaluation component: `searchParams.get("reEvaluate")`).
  // Routing there loads the existing Evaluation page in Re-Evaluation mode,
  // auto-fetches the candidate, and prefills all previously submitted data.
  //
  // NOTE: update `/candidates/evaluate` below if the Candidate Evaluation
  // page lives at a different path in this app's router.
  const handleReEvaluate = (candidateId: string) => {
    router.push(`/candidates/evaluation?reEvaluate=${candidateId}`);
  };

  return (
    <div className="p-4 md:p-8 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Rejected Candidates</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Candidates rejected at any stage of the recruitment pipeline.
          </p>
        </div>
        <Badge className="!bg-red-100 !text-red-700 text-sm px-3 py-1">
          {filteredCandidates.length} {filteredCandidates.length === 1 ? 'candidate' : 'candidates'}
        </Badge>
      </div>

      {/* Filters Card */}
      <Card>
        <CardContent className="p-4 space-y-4">

          {/* Row 1 — Name, Email, Position + Clear All (always visible) */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
            <div className="space-y-1">
              <Label htmlFor="filter-name">Candidate Name</Label>
              <Input
                id="filter-name"
                placeholder="Search by name…"
                value={filters.name}
                onChange={e => handleFilterChange('name', e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter-position">Position</Label>
              <Select
                value={filters.position || 'all'}
                onValueChange={v => handleFilterChange('position', v)}
              >
                <SelectTrigger id="filter-position"><SelectValue placeholder="All Positions" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Positions</SelectItem>
                  {positionOptions.map(p => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="filter-project">Project</Label>
              <Select
                value={filters.project || 'all'}
                onValueChange={v => handleFilterChange('project', v)}
              >
                <SelectTrigger id="filter-project"><SelectValue placeholder="All Projects" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Projects</SelectItem>
                  {projectOptions.map(p => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex h-full items-end">
              {/*
                FIX: Clear All Filters is now ALWAYS rendered (not gated by
                isFiltered) so it's always reachable, and it's disabled
                instead of hidden when there's nothing to clear. A hidden
                button that reappears/disappears as state changes is what
                made "Clear" look broken or flaky before.
              */}
              <Button
                variant="ghost"
                onClick={clearAllFilters}
                disabled={!isFiltered}
                className="w-full gap-1"
              >
                <XCircle className="h-4 w-4" /> Clear All Filters
              </Button>
            </div>
          </div>

          {/* Toggle — Rejected Stage filter */}
          <div>
            <Button
              variant="ghost"
              size="sm"
              className="text-sm text-muted-foreground gap-1 px-0 hover:bg-transparent"
              onClick={() => setShowStageFilters(prev => !prev)}
            >
              {showStageFilters ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {showStageFilters ? 'Hide stage filter' : 'Filter by stage'}
              {isStageFiltered && (
                <span className="ml-1 bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded-full">Active</span>
              )}
            </Button>

            {showStageFilters && (
              <div className="mt-3 pt-3 border-t">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                  Stage Filter
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                  <div className="space-y-1">
                    <Label>Rejected Stage</Label>
                    <Select
                      value={filters.rejectedStage || 'all'}
                      onValueChange={v => handleFilterChange('rejectedStage', v)}
                    >
                      <SelectTrigger><SelectValue placeholder="Any Stage" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Any Stage</SelectItem>
                        {REJECTED_STAGES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex h-full items-end">
                    {/* FIX: always rendered; disabled when nothing to clear */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearStageFilters}
                      disabled={!isStageFiltered}
                      className="w-full"
                    >
                      Clear Stage Filter
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Toggle — Date Range */}
          <div>
            <Button
              variant="ghost"
              size="sm"
              className="text-sm text-muted-foreground gap-1 px-0 hover:bg-transparent"
              onClick={() => setShowDateFilters(prev => !prev)}
            >
              {showDateFilters ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {showDateFilters ? 'Hide date filter' : 'Filter by rejection date'}
              {isDateFiltered && (
                <span className="ml-1 bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">Active</span>
              )}
            </Button>

            {showDateFilters && (
              <div className="mt-3 pt-3 border-t">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                  Rejection Date Range
                </p>
                <DateRangeFilter
                  fromDate={filters.fromDate}
                  toDate={filters.toDate}
                  onFromDateChange={(value) => handleFilterChange('fromDate', value)}
                  onToDateChange={(value) => handleFilterChange('toDate', value)}
                  onClear={clearDateFilters}
                />
              </div>
            )}
          </div>

        </CardContent>
      </Card>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm border">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">Candidate</TableHead>
                <TableHead>Candidate Created Date</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Rejected Stage</TableHead>
                <TableHead>Rejection Reason</TableHead>
                <TableHead>Resume</TableHead>
                <TableHead>Rejection Date</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-60 text-center text-muted-foreground">
                    Loading rejected candidates…
                  </TableCell>
                </TableRow>
              ) : paginated.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-60 text-center text-gray-500">
                    <Search className="mx-auto h-12 w-12 text-gray-300" />
                    <p className="mt-3 font-medium">No rejected candidates found</p>
                    <p className="mt-1 text-sm text-gray-400">
                      {isFiltered ? 'Try adjusting your filters.' : 'No candidates have been rejected yet.'}
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                paginated.map(candidate => (
                  <TableRow key={candidate.id}>
                    {/* Candidate Name (primary) + Position (secondary) — replaces separate Position column */}
                    <TableCell className="align-top">
                      <Link
                        href={`/candidates/${candidate.id}`}
                        className="font-semibold text-blue-700 hover:text-blue-900 hover:underline"
                      >
                        {candidate.candidateName || 'N/A'}
                      </Link>
                      <div className="text-sm text-muted-foreground">
                        {candidate.candidateDesignation || '—'}
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-sm text-muted-foreground">
                      {formatDate(candidate.createdDate)}
                    </TableCell>
                    <TableCell className="align-top text-sm text-muted-foreground">
                      {candidate.candidateEmail || '—'}
                    </TableCell>
                    <TableCell className="align-top">
                      <StageBadge stage={deriveRejectedStage(candidate)} />
                    </TableCell>
                    {/* Rejection Reason → Eye icon opens modal */}
                    <TableCell className="align-top">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-gray-900"
                        title="View rejection reason"
                        onClick={() => openReasonModal(candidate)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                    {/* Resume → Eye icon opens resume in new tab (reuses Candidate Details logic) */}
                    <TableCell className="align-top">
                      {candidate.resumeFile?.data ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-gray-900"
                          title="View resume"
                          onClick={() => openResumeInNewTab(candidate)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      ) : (
                        <span className="text-xs text-gray-400 inline-flex items-center gap-1">
                          <FileText className="h-3.5 w-3.5" /> N/A
                        </span>
                      )}
                    </TableCell>
                    {/* Rejection Date: rejectionDate → fallback createdDate */}
                    <TableCell className="align-top text-sm text-muted-foreground">
                      {formatDate(resolveRejectionDate(candidate))}
                    </TableCell>
                    <TableCell className="align-top text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 border-blue-200 text-blue-700 hover:bg-blue-50 hover:text-blue-800"
                        onClick={() => handleReEvaluate(candidate.id)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Re-Evaluate
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-end space-x-4 p-4 border-t">
            <div className="text-sm text-gray-600">
              Rows per page:
              <select
                value={rowsPerPage}
                onChange={e => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
                className="mx-2 p-1 border rounded-md"
              >
                {[10, 20, 50].map(size => <option key={size} value={size}>{size}</option>)}
              </select>
            </div>
            <div className="text-sm text-gray-600">
              {`${start + 1}–${Math.min(end, filteredCandidates.length)} of ${filteredCandidates.length}`}
            </div>
            <div className="flex space-x-2">
              <Button variant="outline" onClick={() => setPage(0)} disabled={page === 0}>&lt;&lt;</Button>
              <Button variant="outline" onClick={() => setPage(p => p - 1)} disabled={page === 0}>&lt;</Button>
              <Button variant="outline" onClick={() => setPage(p => p + 1)} disabled={end >= filteredCandidates.length}>&gt;</Button>
              <Button variant="outline" onClick={() => setPage(totalPages - 1)} disabled={end >= filteredCandidates.length}>&gt;&gt;</Button>
            </div>
          </div>
        )}
      </div>

      {/* Rejection Reason Modal */}
      <RejectionReasonModal
        candidate={reasonModalCandidate}
        open={reasonModalOpen}
        onOpenChange={setReasonModalOpen}
      />
    </div>
  );
}