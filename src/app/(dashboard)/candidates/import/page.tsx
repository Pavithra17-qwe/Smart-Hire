'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { collection, query, where, orderBy, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { deleteCandidate } from '@/services/candidateService';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Upload, Download, Loader2, Inbox, Trash2, FileSpreadsheet, AlertTriangle, RefreshCw } from 'lucide-react';

interface BulkImportedCandidate {
    id: string;
    candidateName: string;
    candidateEmail: string;
    candidatePhone: string;
    projectName: string;
    atsScore: number;
    resumeReviewStatus: 'Accepted' | 'Rejected' | 'Pending';
    reason: string;
    aiSummary: string;
    // ── Screening Round (l1) fields — same fields used by the Candidate
    // Details page's InterviewStageCard(stageKey='l1') and AIScoreReport. ──
    l1Status: string;
    l1AIStatus: string | null;
    l1InterviewType: string | null;
    l1AIInterviewSentAt: Timestamp | null;
    l1AIScore: number | null;
    createdDate: Timestamp | null;
}

// ── Pagination page-size options (matches Candidate List / Candidate History) ──
const PAGE_SIZE_OPTIONS = [10, 20, 50];

function formatImportedDate(ts: Timestamp | null): string {
    if (!ts) return '-';
    const date = ts.toDate();
    const datePart = new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    }).format(date);
    const timePart = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    }).format(date);
    return `${datePart}, ${timePart}`;
}

function displayProjectName(projectName: string | undefined): string {
    if (!projectName || projectName === '—') return 'No Project';
    return projectName;
}

// Resume Review Status shown to HR: derived from the internal
// resumeReviewStatus field. "Processing" only ever appears live on the
// Upload page's own progress UI — once a candidate document exists here,
// it has already finished processing.
function resumeReviewLabel(status: 'Accepted' | 'Rejected' | 'Pending'): string {
    if (status === 'Pending') return 'Manual Review Required';
    return 'Completed';
}

function ResumeReviewBadge({ status }: { status: 'Accepted' | 'Rejected' | 'Pending' }) {
    const label = resumeReviewLabel(status);
    const color =
        status === 'Pending' ? '!bg-amber-100 !text-amber-700' : '!bg-blue-100 !text-blue-700';
    return <Badge className={color}>{label}</Badge>;
}

// Retained for the "Export ATS Results" file only — no longer rendered
// as a table column (replaced by Screening Round Status per this request).
function finalStatusLabel(resumeReviewStatus: 'Accepted' | 'Rejected' | 'Pending'): string {
    if (resumeReviewStatus === 'Accepted') return 'Qualified';
    if (resumeReviewStatus === 'Rejected') return 'Rejected';
    if (resumeReviewStatus === 'Pending') return 'Pending Review';
    return 'Imported';
}

function AtsScoreBadge({ score }: { score: number }) {
    const color =
        score >= 80
            ? '!bg-green-100 !text-green-700'
            : score >= 60
            ? '!bg-yellow-100 !text-yellow-700'
            : '!bg-red-100 !text-red-700';
    return <Badge className={color}>{score}</Badge>;
}

// ─────────────────────────────────────────────────────────────────────────
// Screening Round Status
// Derived from the same l1Status / l1AIStatus / l1InterviewType fields the
// Candidate Details page's Screening Round card (InterviewStageCard,
// stageKey='l1') and AIScoreReport component already read and write.
// No new data is stored — this is purely a display-label mapping so the
// bulk import list mirrors what HR sees on the Candidate Details page.
// ─────────────────────────────────────────────────────────────────────────
type ScreeningRoundStatus =
    | 'Pending'
    | 'Scheduled'
    | 'Interview Sent'
    | 'Completed'
    | 'Awaiting HR Review'
    | 'Passed'
    | 'Failed'
    | 'Rejected'
    | 'Not Eligible';

function getScreeningRoundStatus(c: BulkImportedCandidate): ScreeningRoundStatus {
    // Screening never starts until the resume itself is accepted.
    if (c.resumeReviewStatus !== 'Accepted' || c.l1Status === 'Locked') {
        return 'Not Eligible';
    }
    if (c.l1Status === 'On Hold') return 'Awaiting HR Review';
    if (c.l1Status === 'Expired') return 'Failed';
    if (c.l1Status === 'Selected') return 'Passed';
    if (c.l1Status === 'Rejected') return 'Failed';
    if (c.l1Status === 'Pending') return 'Pending';

    if (c.l1Status === 'Scheduled' || c.l1Status === 'Rescheduled') {
        // AI/manual interview link exists and has been sent
        if (c.l1AIStatus === 'completed') return 'Awaiting HR Review';
        if ((c.l1InterviewType === 'ai' || c.l1InterviewType === 'manual') && c.l1AIInterviewSentAt) {
            return 'Interview Sent';
        }
        return 'Scheduled';
    }

    return 'Pending';
}

function ScreeningStatusBadge({ status }: { status: ScreeningRoundStatus }) {
    const color: Record<ScreeningRoundStatus, string> = {
        Pending: '!bg-gray-100 !text-gray-700',
        Scheduled: '!bg-blue-100 !text-blue-700',
        'Interview Sent': '!bg-indigo-100 !text-indigo-700',
        Completed: '!bg-cyan-100 !text-cyan-700',
        'Awaiting HR Review': '!bg-amber-100 !text-amber-700',
        Passed: '!bg-green-100 !text-green-700',
        Failed: '!bg-red-100 !text-red-700',
        Rejected: '!bg-red-100 !text-red-700',
        'Not Eligible': '!bg-gray-200 !text-gray-600',
    };
    return <Badge className={color[status]}>{status}</Badge>;
}

// ─────────────────────────────────────────────────────────────────────────
// AI Interview Report — reads the existing l1AIScore field (the same
// "Overall AI Interview Score" already shown on the Candidate Details
// page's AIScoreReport component). No recalculation happens here.
// ─────────────────────────────────────────────────────────────────────────
function AiInterviewReportBadge({ candidate }: { candidate: BulkImportedCandidate }) {
    const eligible = candidate.resumeReviewStatus === 'Accepted' && candidate.l1Status !== 'Locked';

    if (typeof candidate.l1AIScore === 'number' && candidate.l1AIStatus === 'completed') {
        const score = candidate.l1AIScore;
        const color =
            score >= 80
                ? '!bg-green-100 !text-green-700'
                : score >= 60
                ? '!bg-yellow-100 !text-yellow-700'
                : '!bg-red-100 !text-red-700';
        return <Badge className={color}>{score}</Badge>;
    }

    if (!eligible) {
        return <Badge className="!bg-gray-200 !text-gray-600">N/A</Badge>;
    }

    return <Badge className="!bg-gray-100 !text-gray-700">Pending</Badge>;
}

function aiInterviewReportExportValue(candidate: BulkImportedCandidate): string {
    const eligible = candidate.resumeReviewStatus === 'Accepted' && candidate.l1Status !== 'Locked';
    if (typeof candidate.l1AIScore === 'number' && candidate.l1AIStatus === 'completed') {
        return String(candidate.l1AIScore);
    }
    return eligible ? 'Pending' : 'N/A';
}

export default function BulkCandidateImportPage() {
    const router = useRouter();
    const [candidates, setCandidates] = useState<BulkImportedCandidate[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // ── NEW: surfaces onSnapshot failures (e.g. Firestore Security Rules
    // denying read access, or a missing composite index for the
    // `where('importSource', ...) + orderBy('createdDate', ...)` query)
    // instead of silently leaving `candidates` as [] forever. This was the
    // actual root cause of "No bulk candidate imports found" persisting
    // through every refresh — the query was failing on every mount and the
    // failure was only ever logged to the console, never shown to the user
    // or retried. ──
    const [loadError, setLoadError] = useState<string | null>(null);
    const [retryKey, setRetryKey] = useState(0);

    // Selection for export
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    // Delete confirmation state
    const [deleteTarget, setDeleteTarget] = useState<BulkImportedCandidate | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    // ── Pagination state (mirrors Candidate List / Candidate History) ──────
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);

    useEffect(() => {
        setIsLoading(true);
        setLoadError(null);

        const q = query(
            collection(db, 'candidates'),
            where('importSource', '==', 'bulk-import'),
            orderBy('createdDate', 'desc')
        );

        const unsub = onSnapshot(
            q,
            snap => {
                setCandidates(
                    snap.docs.map(d => {
                        const data = d.data() as any;
                        return {
                            id: d.id,
                            candidateName: data.candidateName || '',
                            candidateEmail: data.candidateEmail || '',
                            candidatePhone: data.candidatePhone || '',
                            projectName: data.projectName || '',
                            atsScore: typeof data.atsScore === 'number' ? data.atsScore : 0,
                            resumeReviewStatus: data.resumeReviewStatus || 'Pending',
                            reason: data.resumeFeedback || '',
                            aiSummary: data.matchSummary || '',
                            l1Status: data.l1Status || 'Locked',
                            l1AIStatus: data.l1AIStatus || null,
                            l1InterviewType: data.l1InterviewType || null,
                            l1AIInterviewSentAt: data.l1AIInterviewSentAt || null,
                            l1AIScore: typeof data.l1AIScore === 'number' ? data.l1AIScore : null,
                            createdDate: data.createdDate || null,
                        };
                    })
                );
                setLoadError(null);
                setIsLoading(false);
            },
            err => {
                // ── CHANGED: was previously console.error-only, which left the
                // page silently stuck on the empty state with no way to tell
                // whether data genuinely didn't exist or the query itself was
                // failing (permission-denied / missing composite index are the
                // two most common causes). Now the real Firestore error message
                // is surfaced in the UI and via toast, and a Retry action is
                // available instead of requiring a hard reload. ──
                console.error('[BulkImportList] Failed to load imported candidates:', err);
                setLoadError(err?.message || 'Failed to load imported candidates.');
                toast.error('Failed to load imported candidates. See the error below for details.');
                setIsLoading(false);
            }
        );

        return () => unsub();
    }, [retryKey]);

    // ── Keep currentPage in range whenever the dataset or page size changes ──
    // (e.g. after a delete, a new bulk upload arrives via onSnapshot, or the
    // page size dropdown is changed).
    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(candidates.length / pageSize));
        setCurrentPage(prev => (prev > maxPage ? maxPage : prev));
    }, [candidates.length, pageSize]);

    const allSelected = candidates.length > 0 && candidates.every(c => selectedIds.has(c.id));

    const toggleSelectAll = () => {
        setSelectedIds(allSelected ? new Set() : new Set(candidates.map(c => c.id)));
    };

    const toggleSelectRow = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const exportAtsResults = () => {
        if (candidates.length === 0) {
            toast.error('No imported candidates to export.');
            return;
        }
        // If nothing is checked, export all currently loaded candidates
        // (same "export everything by default" behavior as Export Screening
        // Results). If some rows are checked, export just those.
        const selected = selectedIds.size > 0
            ? candidates.filter(c => selectedIds.has(c.id))
            : candidates;
        const header =
            'Candidate Name,Email,Project,ATS Score,Resume Review Status,Final Status,Reason,AI Summary,Imported Date\n';
        const rows = selected
            .map(c => {
                const escape = (val: string) => (val || '').replace(/"/g, '""');
                const importedDateCell = `="${escape(formatImportedDate(c.createdDate))}"`.replace(/"/g, '""');
                return `"${escape(c.candidateName)}","${escape(c.candidateEmail)}","${escape(
                    displayProjectName(c.projectName)
                )}","${c.atsScore}","${escape(resumeReviewLabel(c.resumeReviewStatus))}","${escape(
                    finalStatusLabel(c.resumeReviewStatus)
                )}","${escape(c.reason)}","${escape(c.aiSummary)}","${importedDateCell}"`;
            })
            .join('\n');
        downloadCsv(header + rows, 'bulk-import-ats-results.csv');
        setSelectedIds(new Set());
    };

    // ── Export Screening Results — real .xlsx via SheetJS (dynamic import
    // to avoid bloating the initial bundle since this page is the only
    // consumer). Exports ALL currently loaded candidates (i.e. respects
    // whatever filtering/sorting state governs `candidates`, independent of
    // which page is currently visible on screen). ──
    const exportScreeningResults = async () => {
        if (candidates.length === 0) {
            toast.error('No imported candidates to export.');
            return;
        }
        try {
            const XLSX = await import('xlsx');
            const rows = candidates.map(c => ({
                'Candidate Name': c.candidateName || '-',
                Email: c.candidateEmail || '-',
                Project: displayProjectName(c.projectName),
                'AI Interview Report': aiInterviewReportExportValue(c),
                'Screening Status': getScreeningRoundStatus(c),
            }));
            const worksheet = XLSX.utils.json_to_sheet(rows);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Screening Results');

            const today = new Date();
            const y = today.getFullYear();
            const m = String(today.getMonth() + 1).padStart(2, '0');
            const d = String(today.getDate()).padStart(2, '0');
            XLSX.writeFile(workbook, `Screening_Results_${y}_${m}_${d}.xlsx`);
        } catch (err) {
            console.error('[ExportScreeningResults] Failed:', err);
            toast.error('Failed to export screening results.');
        }
    };

    const handleDeleteCandidate = async () => {
        if (!deleteTarget) return;
        // Guard against a missing/undefined id ever reaching the service call.
        if (!deleteTarget.id) {
            toast.error('Failed to delete candidate. Please try again.');
            setDeleteTarget(null);
            return;
        }
        setIsDeleting(true);
        try {
            // Reuses the exact same service function Candidate History calls
            // successfully (deleteCandidate from candidateService), rather than
            // a raw fetch to /api/candidates/{id} — both pages' candidates live
            // in the same Firestore `candidates` collection, so this is the
            // proven, working delete path rather than a second, unverified one.
            const result = await deleteCandidate(deleteTarget.id);

            if (!result.success) {
                throw new Error(result.error || 'Failed to delete candidate. Please try again.');
            }

            // Optimistically drop the row from local state immediately so the
            // table updates without waiting on onSnapshot's round-trip. The
            // onSnapshot listener above will also reconcile once Firestore's
            // change propagates, matching Candidate History's approach.
            setCandidates(prev => prev.filter(c => c.id !== deleteTarget.id));
            setSelectedIds(prev => {
                const next = new Set(prev);
                next.delete(deleteTarget.id);
                return next;
            });
            toast.success('Candidate deleted successfully.');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to delete candidate. Please try again.');
        } finally {
            setIsDeleting(false);
            setDeleteTarget(null);
        }
    };

    // ── Pagination derived values ───────────────────────────────────────────
    const totalRecords = candidates.length;
    const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
    const paginatedCandidates = candidates.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    const rangeStart = totalRecords === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const rangeEnd = Math.min(currentPage * pageSize, totalRecords);

    const goToPage = (page: number) => {
        setCurrentPage(Math.min(Math.max(1, page), totalPages));
    };

    return (
        <div className="p-4 md:p-8 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-bold">Bulk Candidate Import</h1>
                    <Button onClick={() => router.push('/candidates/import/upload')}>
                        <Upload className="h-4 w-4 mr-2" />
                        Bulk Upload
                    </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={exportAtsResults}>
                        <Download className="h-4 w-4 mr-2" />
                        Export ATS Results
                    </Button>
                    <Button variant="outline" onClick={exportScreeningResults}>
                        <FileSpreadsheet className="h-4 w-4 mr-2" />
                        Export Screening Results
                    </Button>
                </div>
            </div>

            {/* ── NEW: error banner — only shown when the Firestore query itself
                 failed (permission-denied / missing index / network), as opposed
                 to genuinely having zero records. Distinguishing these two states
                 was the missing piece; previously both looked identical to the
                 user ("No bulk candidate imports found"). ── */}
            {loadError && (
                <Card className="border-red-200 bg-red-50">
                    <CardContent className="pt-6 flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
                        <div className="flex-1 space-y-1">
                            <p className="text-sm font-medium text-red-800">Couldn't load imported candidates.</p>
                            <p className="text-xs text-red-700 break-all">{loadError}</p>
                            <p className="text-xs text-red-700">
                                This is usually a Firestore Security Rules or missing composite index issue,
                                not missing data — check the browser console for a direct link to create the
                                index if one is required.
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            className="border-red-300 text-red-700 hover:bg-red-100"
                            onClick={() => setRetryKey(k => k + 1)}
                        >
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Retry
                        </Button>
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardContent className="pt-6">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-16 text-muted-foreground">
                            <Loader2 className="h-6 w-6 animate-spin mr-2" />
                            Loading imported candidates...
                        </div>
                    ) : candidates.length === 0 && !loadError ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
                            <Inbox className="h-10 w-10 text-muted-foreground" />
                            <p className="font-medium">No bulk candidate imports found.</p>
                            <p className="text-sm text-muted-foreground">
                                Click <span className="font-medium">Bulk Upload</span> to import resumes and generate ATS scores.
                            </p>
                            <Button className="mt-3" onClick={() => router.push('/candidates/import/upload')}>
                                <Upload className="h-4 w-4 mr-2" />
                                Bulk Upload
                            </Button>
                        </div>
                    ) : candidates.length === 0 && loadError ? (
                        // Query failed — the error banner above already explains why.
                        // Avoid also showing the misleading "No imports found" empty
                        // state, which is what made this bug so hard to notice.
                        null
                    ) : (
                        <>
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-10">
                                                <Checkbox
                                                    checked={allSelected}
                                                    onCheckedChange={toggleSelectAll}
                                                    aria-label="Select all"
                                                />
                                            </TableHead>
                                            <TableHead>Candidate Name</TableHead>
                                            <TableHead>Email</TableHead>
                                            <TableHead>Project</TableHead>
                                            <TableHead>ATS Score</TableHead>
                                            <TableHead>AI Interview Report</TableHead>
                                            <TableHead>Resume Review Status</TableHead>
                                            <TableHead>Screening Round Status</TableHead>
                                            <TableHead>Imported Date</TableHead>
                                            <TableHead className="text-right">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {paginatedCandidates.map(c => (
                                            <TableRow key={c.id}>
                                                <TableCell>
                                                    <Checkbox
                                                        checked={selectedIds.has(c.id)}
                                                        onCheckedChange={() => toggleSelectRow(c.id)}
                                                        aria-label={`Select ${c.candidateName}`}
                                                    />
                                                </TableCell>
                                                <TableCell className="font-medium">
                                                    <Link
                                                        href={`/candidates/${c.id}`}
                                                        className="text-primary underline-offset-2 hover:underline"
                                                    >
                                                        {c.candidateName || '-'}
                                                    </Link>
                                                </TableCell>
                                                <TableCell>{c.candidateEmail || '-'}</TableCell>
                                                <TableCell>{displayProjectName(c.projectName)}</TableCell>
                                                <TableCell>
                                                    <AtsScoreBadge score={c.atsScore} />
                                                </TableCell>
                                                <TableCell>
                                                    <AiInterviewReportBadge candidate={c} />
                                                </TableCell>
                                                <TableCell>
                                                    <ResumeReviewBadge status={c.resumeReviewStatus} />
                                                </TableCell>
                                                <TableCell>
                                                    <ScreeningStatusBadge status={getScreeningRoundStatus(c)} />
                                                </TableCell>
                                                <TableCell className="text-muted-foreground">
                                                    {formatImportedDate(c.createdDate)}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => setDeleteTarget(c)}
                                                        aria-label={`Delete ${c.candidateName}`}
                                                    >
                                                        <Trash2 className="h-4 w-4 text-red-600" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>

                            {/* ── Pagination controls — mirrors Candidate History's pagination
                                 exactly (layout, classes, button set, and text format) so the
                                 two pages are visually and behaviorally identical. ── */}
                            {totalPages > 1 && (
                                <div className="flex items-center justify-end space-x-4 p-4">
                                    <div className="text-sm text-gray-600">
                                        Rows per page:
                                        <select
                                            value={pageSize}
                                            onChange={e => {
                                                setPageSize(Number(e.target.value));
                                                setCurrentPage(1);
                                            }}
                                            className="mx-2 p-1 border rounded-md"
                                        >
                                            {PAGE_SIZE_OPTIONS.map(size => (
                                                <option key={size} value={size}>{size}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="text-sm text-gray-600">
                                        {`${rangeStart}–${rangeEnd} of ${totalRecords}`}
                                    </div>
                                    <div className="flex space-x-2">
                                        <Button variant="outline" onClick={() => goToPage(1)} disabled={currentPage === 1}>&lt;&lt;</Button>
                                        <Button variant="outline" onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1}>&lt;</Button>
                                        <Button variant="outline" onClick={() => goToPage(currentPage + 1)} disabled={currentPage === totalPages}>&gt;</Button>
                                        <Button variant="outline" onClick={() => goToPage(totalPages)} disabled={currentPage === totalPages}>&gt;&gt;</Button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </CardContent>
            </Card>

            <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Candidate?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to permanently delete this candidate?
                            <br />
                            <br />
                            This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteCandidate} disabled={isDeleting}>
                            {isDeleting ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Deleting...
                                </>
                            ) : (
                                'Delete'
                            )}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

function downloadCsv(csvContent: string, fileName: string) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}