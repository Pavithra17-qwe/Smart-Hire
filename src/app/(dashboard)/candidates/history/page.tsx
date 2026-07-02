'use client';

import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from "next/navigation";
import Link from 'next/link';
import { toast } from 'sonner';
import { useCandidate } from '@/hooks/useCandidate';
import { deleteCandidate } from '@/services/candidateService';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from "@/components/ui/badge";
import { CandidateSkeleton } from '@/components/candidate/CandidateSkeleton';
import { getFinalStatusBadge } from '@/components/common/FinalStatusBadge';
import { Search, ChevronDown, ChevronUp, Trash2, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
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

type Status = string | undefined;

const StageStatusBadge = ({ status }: { status: Status }) => {
    const displayStatus = status || 'Pending';
    const normalized = displayStatus.toLowerCase();

    let color = "!bg-gray-100 !text-gray-700";
    if (normalized === "rejected") color = "!bg-red-100 !text-red-700";
    else if (["accepted", "selected", "completed", "joined"].includes(normalized)) color = "!bg-green-100 !text-green-700";
    else if (normalized === "scheduled") color = "!bg-blue-100 !text-blue-700";
    else if (normalized === "released") color = "!bg-orange-100 !text-orange-700";
    else if (normalized === "in progress") color = "!bg-purple-100 !text-purple-700";
    else if (normalized === "locked") color = "!bg-gray-100 !text-gray-500";
    else if (normalized === "on hold") color = "!bg-amber-100 !text-amber-700";

    return <Badge className={`capitalize ${color}`}>{displayStatus}</Badge>;
};

const FINAL_STATUSES = ['In Progress', 'Completed', 'Rejected'];

const STAGE_OPTIONS = {
    resumeReview: ['Pending', 'Accepted', 'Rejected', 'On Hold'],
    ScreeningStatus: ['Pending', 'Selected', 'Rejected', 'On Hold'],
    // ↓ NEW: Screening Status filter options
    screening: ['Selected', 'Rejected', 'Scheduled', 'On Hold'],
    l1: ['Pending', 'Scheduled', 'Selected', 'Rejected', 'On Hold'],
    l2: ['Pending', 'Scheduled', 'Selected', 'Rejected', 'On Hold'],
    hr: ['Pending', 'Scheduled', 'Selected', 'Rejected', 'On Hold'],
    offer: ['Pending', 'Released', 'Accepted', 'Rejected', 'On Hold'],
};

const INITIAL_FILTERS = {
    name: '', role: '', status: '', project: '',
    resumeReview: '', screening: '',
    l1: '', l2: '', hr: '', offer: '',
};

// Maps URL stage param → candidate field name
const STAGE_FIELD_MAP: Record<string, string> = {
    resume: "resumeReviewStatus",
    screening: "l1Status",
    l1: "l2Status",
    l2: "l2ManagerStatus",
    hr: "hrStatus",
    offer: "offerStatus",
    final: "finalStatus",
};
export default function CandidateHistoryPage() {
    const { candidates, loading, error } = useCandidate();
    // NOTE: useCandidate is backed by Firestore's onSnapshot, which keeps
    // `candidates` live automatically. Once deleteCandidate() below confirms
    // the Firestore delete, the snapshot listener fires on its own and
    // `candidates` updates with no manual state mirroring needed here.
    const [jobRequisitions, setJobRequisitions] = useState<Record<string, string>>({});

    useEffect(() => {
        const unsub = onSnapshot(collection(db, "job_requisitions"), snap => {
            const map: Record<string, string> = {};
            snap.docs.forEach(doc => {
                const data = doc.data();
                if (data.projectName) {
                    map[doc.id] = data.projectName;
                }
            });
            setJobRequisitions(map);
        });

        return () => unsub();
    }, []);
    const searchParams = useSearchParams();

    // ── UI filter state ───────────────────────────────────────────────────────
    const [filters, setFilters] = useState(INITIAL_FILTERS);
    const [showStageFilters, setShowStageFilters] = useState(false);
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(10);

    // ── URL-driven filter state ───────────────────────────────────────────────
    const [urlPanelUid, setUrlPanelUid] = useState<string | null>(null);
    const [urlStage, setUrlStage] = useState<string>("all");
    const [urlStatus, setUrlStatus] = useState<string>("all");
    const [urlCreatedBy, setUrlCreatedBy] = useState<string | null>(null);
    const [urlIds, setUrlIds] = useState<Set<string> | null>(null);
    const [isActiveFilter, setIsActiveFilter] = useState(false);
    const [urlProject, setUrlProject] = useState<string | null>(null);
    const [urlRole, setUrlRole] = useState<string | null>(null);
    const [urlFinalStatus, setUrlFinalStatus] = useState<string | null>(null);

    // ── Delete state ──────────────────────────────────────────────────────────
    // candidateToDelete: the record pending confirmation in the dialog
    // deletingId: the id currently in-flight, used to disable its row's button
    // and guard against duplicate delete requests for the same candidate
    const [candidateToDelete, setCandidateToDelete] = useState<any | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    useEffect(() => {
        const active = searchParams.get("active") === "true";
        const stage = searchParams.get("stage") || "all";
        const status = searchParams.get("status") || "all";
        const createdBy = searchParams.get("createdBy");
        const panelUid = searchParams.get("panelUid");
        const ids = searchParams.get("ids");
        const project = searchParams.get("project");
        const role = searchParams.get("role");
        const finalStatus = searchParams.get("finalStatus");
        setUrlFinalStatus(finalStatus);
        setUrlProject(project);
        setUrlRole(role);

        setIsActiveFilter(active);
        setUrlStage(stage);
        setUrlStatus(status);
        setUrlCreatedBy(createdBy);
        setUrlPanelUid(panelUid);

        if (ids === "__empty__") {
            setUrlIds(new Set());
        } else if (ids && ids.trim().length > 0) {
            const idSet = new Set(ids.split(",").map(s => s.trim()).filter(Boolean));
            setUrlIds(idSet.size > 0 ? idSet : null);
        } else {
            setUrlIds(null);
        }

        if (stage !== "all" || status !== "all") {
            setShowStageFilters(true);
        }
    }, [searchParams]);

    const handleFilterChange = (filterName: string, value: string) => {
        setFilters(prev => ({ ...prev, [filterName]: value }));
        setPage(0);
    };

    const clearFilters = () => {
        setFilters(INITIAL_FILTERS);
        setPage(0);
    };

    const clearStageFilters = () => {
        setFilters(prev => ({ ...prev, resumeReview: '', screening: '', l1: '', l2: '', hr: '', offer: '' }));
        setPage(0);
    };

    // ── Delete handlers ───────────────────────────────────────────────────────
    const handleDeleteClick = (candidate: any) => {
        setCandidateToDelete(candidate);
    };

    const handleCancelDelete = () => {
        setCandidateToDelete(null);
    };

    const handleConfirmDelete = async () => {
        if (!candidateToDelete) return;

        const id = candidateToDelete.id;

        // Guard against duplicate delete requests for the same candidate
        if (deletingId === id) return;

        setDeletingId(id);
        try {
            // Reuses the existing service layer's pattern (success/error object,
            // not a thrown exception — matches createNewCandidate in the same file)
            const result = await deleteCandidate(id);

            if (!result.success) {
                throw new Error(result.error || 'Failed to delete candidate');
            }

            // No manual state update needed here — useCandidate's onSnapshot
            // listener picks up the Firestore deletion automatically and
            // updates `candidates`, which filteredCandidates re-derives from.
            toast.success('Candidate deleted successfully.');
            setCandidateToDelete(null);
        } catch (err) {
            toast.error(
                err instanceof Error ? err.message : 'Failed to delete candidate. Please try again.'
            );
            // Keep the candidate in the table — dialog stays closed but record is untouched
            setCandidateToDelete(null);
        } finally {
            setDeletingId(null);
        }
    };

    // ── Main filter logic ─────────────────────────────────────────────────────
    const filteredCandidates = useMemo(() => {
        if (!Array.isArray(candidates)) return [];

        // ── PRIORITY 1: ids param ─────────────────────────────────────────────
        if (urlIds !== null) {
            return [...candidates]
                .filter(c => urlIds.has(c.id))
                .sort((a, b) => {
                    const dateA = a.createdDate?.toMillis?.() ?? 0;
                    const dateB = b.createdDate?.toMillis?.() ?? 0;
                    return dateB - dateA;
                });
        }

        // ── PRIORITY 2: active filter ─────────────────────────────────────────
       // ── PRIORITY 2: active filter ─────────────────────────────────────────
if (isActiveFilter) {
    return candidates.filter(c => {
        const final = (c.finalStatus ?? "").toLowerCase();
        const activeMatch = final !== "completed" && final !== "rejected";

        let urlProjectMatch = true;
        if (urlProject) {
            urlProjectMatch = jobRequisitions[c.jobRequisitionId ?? ""] === urlProject;
        }

        let urlRoleMatch = true;
        if (urlRole) {
            urlRoleMatch = (c.candidateDesignation ?? "").toLowerCase() === urlRole.toLowerCase();
        }

        return activeMatch && urlProjectMatch && urlRoleMatch;
    });
}

        // ── Sort newest first ─────────────────────────────────────────────────
        const sorted = [...candidates].sort((a, b) => {
            const dateA = a.createdDate?.toMillis?.() ?? 0;
            const dateB = b.createdDate?.toMillis?.() ?? 0;
            return dateB - dateA;
        });

        return sorted.filter(candidate => {

            // ── UI text/dropdown filters ──────────────────────────────────────
            const nameMatch =
                !filters.name ||
                (candidate.candidateName ?? '').toLowerCase().includes(filters.name.toLowerCase());

            const roleMatch =
                !filters.role ||
                (candidate.createdByRole ?? '').toLowerCase() === filters.role.toLowerCase();

            const statusMatch =
                !filters.status ||
                (candidate.finalStatus ?? '').toLowerCase() === filters.status.toLowerCase();

            const rrMatch =
                !filters.resumeReview ||
                (candidate.resumeReviewStatus ?? 'Pending').toLowerCase() === filters.resumeReview.toLowerCase();

            // ── NEW: Screening Status filter — reads from l1Status ────────────
            const screeningMatch =
                !filters.screening ||
                (candidate.l1Status ?? 'Pending').toLowerCase() === filters.screening.toLowerCase();

            // ── L1 filter now reads from l2Status (shifted) ───────────────────
            const l1Match =
                !filters.l1 ||
                (candidate.l2Status ?? 'Pending').toLowerCase() === filters.l1.toLowerCase();

            const l2Match =
                !filters.l2 ||
                (candidate.l2ManagerStatus ?? 'Pending').toLowerCase() === filters.l2.toLowerCase();

            const hrMatch =
                !filters.hr ||
                (candidate.hrStatus ?? 'Pending').toLowerCase() === filters.hr.toLowerCase();

            const offerMatch =
                !filters.offer ||
                (candidate.offerStatus ?? 'Pending').toLowerCase() === filters.offer.toLowerCase();
            const projectMatch =
                !filters.project ||
                jobRequisitions[candidate.jobRequisitionId ?? ""] === filters.project;

            // ── URL stage+status filter ───────────────────────────────────────
            let stageStatusMatch = true;
            if (urlStage !== "all" && urlStatus !== "all") {
                const field = STAGE_FIELD_MAP[urlStage];
                if (field) {
                    stageStatusMatch =
                        (candidate[field] ?? "Pending").toLowerCase() === urlStatus.toLowerCase();
                }
            } else if (urlStage === "all" && urlStatus !== "all") {
                stageStatusMatch =
                    (candidate.finalStatus ?? "").toLowerCase() === urlStatus.toLowerCase();
            }

            // ── panelUid filter ───────────────────────────────────────────────
            let panelMatch = true;
            if (urlPanelUid) {
                panelMatch =
                    candidate.l1InterviewerUid === urlPanelUid ||
                    candidate.l2InterviewerUid === urlPanelUid;
            }

            let urlProjectMatch = true;
            if (urlProject) {
                urlProjectMatch = jobRequisitions[candidate.jobRequisitionId ?? ""] === urlProject;
            }

            // ── URL role filter ───────────────────────────────────────────────
            let urlRoleMatch = true;
            if (urlRole) {
                urlRoleMatch = (candidate.candidateDesignation ?? "").toLowerCase() === urlRole.toLowerCase();
            }

            // ── URL final status filter (Rejected/Hired cards) ──────────────────
            let urlFinalStatusMatch = true;
            if (urlFinalStatus) {
                urlFinalStatusMatch = (candidate.finalStatus ?? "").toLowerCase() === urlFinalStatus.toLowerCase();
            }

            // ── createdBy filter ──────────────────────────────────────────────
            let uploaderMatch = true;
            if (urlCreatedBy && urlCreatedBy !== "all" && urlCreatedBy !== "panel") {
                uploaderMatch = candidate.createdBy === urlCreatedBy;
            }

            return (
                nameMatch &&
                roleMatch &&
                statusMatch &&
                projectMatch &&
                rrMatch &&
                screeningMatch &&
                l1Match &&
                l2Match &&
                hrMatch &&
                offerMatch &&
                stageStatusMatch &&
                panelMatch &&
                uploaderMatch &&
                urlProjectMatch &&
                urlRoleMatch &&
                urlFinalStatusMatch
            );
        });

    }, [
        candidates, filters, isActiveFilter,
        urlIds, urlStage, urlStatus, urlPanelUid, jobRequisitions, urlCreatedBy, urlProject, urlRole, urlFinalStatus,
    ]);

    const start = page * rowsPerPage;
    const end = start + rowsPerPage;
    const paginatedCandidates = filteredCandidates.slice(start, end);
    const totalPages = Math.ceil(filteredCandidates.length / rowsPerPage);

    // If a delete empties the current page (e.g. deleting the last item on the
    // final page), step back a page so the user isn't left looking at a blank page.
    useEffect(() => {
        if (page > 0 && start >= filteredCandidates.length) {
            setPage(Math.max(0, totalPages - 1));
        }
    }, [filteredCandidates.length, page, start, totalPages]);

    const handleChangePage = (newPage: number) => setPage(newPage);
    const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLSelectElement>) => {
        setRowsPerPage(parseInt(event.target.value, 10));
        setPage(0);
    };

    const isFiltered = Object.values(filters).some(v => v !== '');
    const isStageFiltered = [filters.resumeReview, filters.screening, filters.l1, filters.l2, filters.hr, filters.offer].some(v => v !== '');

    const urlFilterLabel = useMemo(() => {
        if (urlIds !== null) return `Showing ${urlIds.size} candidate${urlIds.size !== 1 ? 's' : ''} from dashboard filter`;
        if (urlPanelUid && urlStage !== "all" && urlStatus !== "all")
            return `Filtered: ${urlStage.toUpperCase()} → ${urlStatus} (panel view)`;
        if (urlPanelUid) return "Showing your assigned candidates";
        if (urlCreatedBy) return `Filtered by uploader`;
        if (urlStage !== "all" || urlStatus !== "all")
            return `Stage: ${urlStage !== "all" ? urlStage.toUpperCase() : "All"} · Status: ${urlStatus !== "all" ? urlStatus : "All"}`;
        return null;
    }, [urlIds, urlPanelUid, urlStage, urlStatus, urlCreatedBy]);

    const roles = useMemo(
        () => Array.from(new Set(candidates.map(c => c.createdByRole).filter(Boolean))),
        [candidates]
    );

    // ── Project dropdown options ──────────────────────────────────────────────
    // Derived from each candidate's jobRequisitionId → jobRequisitions name
    // lookup (the same lookup the table's Project column and projectMatch
    // filter already use). Recomputes whenever candidates change (added,
    // deleted, or a candidate's jobRequisitionId/project changes) or when
    // jobRequisitions updates via its own onSnapshot listener, so the list
    // of available projects always reflects current Candidate History data.
    const projectOptions = useMemo(() => {
        const names = candidates
            .map(c => jobRequisitions[c.jobRequisitionId ?? ""])
            .filter((name): name is string => Boolean(name));
        return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
    }, [candidates, jobRequisitions]);

    return (
        <div className="p-4 md:p-8 space-y-6">
            <h1 className="text-2xl font-bold">Candidate History</h1>

            {urlFilterLabel && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/20 text-sm">
                    <span className="h-2 w-2 rounded-full bg-primary inline-block" />
                    <span className="font-medium text-primary">{urlFilterLabel}</span>
                    <span className="text-muted-foreground ml-1">
                        — {filteredCandidates.length} candidate{filteredCandidates.length !== 1 ? 's' : ''} shown
                    </span>
                </div>
            )}

            {/* Main Filters */}
            <Card>
                <CardContent className="p-4 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4 items-end">
                        <div className="space-y-1">
                            <Label htmlFor="filter-name">Candidate Name</Label>
                            <Input
                                id="filter-name"
                                placeholder="Search by name..."
                                value={filters.name}
                                onChange={e => handleFilterChange('name', e.target.value)}
                            />
                        </div>

                        <div className="space-y-1">
                            <Label htmlFor="filter-role">Role</Label>
                            <Select value={filters.role} onValueChange={value => handleFilterChange('role', value)}>
                                <SelectTrigger id="filter-role"><SelectValue placeholder="All Roles" /></SelectTrigger>
                                <SelectContent>
                                    {roles.map(role => (
                                        <SelectItem key={role ?? ''} value={role ?? ''}>{role}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* ── NEW: Project filter — between Role and Final Status ── */}
                        <div className="space-y-1">
                            <Label htmlFor="filter-project">Project</Label>
                            <Select value={filters.project} onValueChange={value => handleFilterChange('project', value)}>
                                <SelectTrigger id="filter-project"><SelectValue placeholder="All Projects" /></SelectTrigger>
                                <SelectContent>
                                    {projectOptions.map(project => (
                                        <SelectItem key={project} value={project}>{project}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-1">
                            <Label htmlFor="filter-status">Final Status</Label>
                            <Select value={filters.status} onValueChange={value => handleFilterChange('status', value)}>
                                <SelectTrigger id="filter-status"><SelectValue placeholder="All Statuses" /></SelectTrigger>
                                <SelectContent>
                                    {FINAL_STATUSES.map(status => (
                                        <SelectItem key={status} value={status}>{status}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="flex h-full items-end gap-2">
                            {isFiltered && (
                                <Button variant="ghost" onClick={clearFilters} className="w-full">
                                    Clear All Filters
                                </Button>
                            )}
                        </div>
                    </div>

                    {/* Toggle Stage Filters */}
                    <div>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-sm text-muted-foreground gap-1 px-0 hover:bg-transparent"
                            onClick={() => setShowStageFilters(prev => !prev)}
                        >
                            {showStageFilters ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            {showStageFilters ? 'Hide stage filters' : 'Filter by stage'}
                            {isStageFiltered && (
                                <span className="ml-1 bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">
                                    Active
                                </span>
                            )}
                        </Button>

                        {showStageFilters && (
                            <div className="mt-3 pt-3 border-t space-y-2">
                                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                                    Stage-Level Filters
                                </p>
                                {/* ↓ Now 7 columns: Resume Review + Screening (NEW) + L1–L2–HR–Offer + Clear */}
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4 items-end">
                                    <div className="space-y-1">
                                        <Label>Resume Review</Label>
                                        <Select value={filters.resumeReview} onValueChange={v => handleFilterChange('resumeReview', v)}>
                                            <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                                            <SelectContent>
                                                {STAGE_OPTIONS.resumeReview.map(s => (
                                                    <SelectItem key={s} value={s}>{s}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    {/* ── NEW: Screening Status filter — immediately after Resume Review ── */}
                                    <div className="space-y-1">
                                        <Label>Screening Status</Label>
                                        <Select value={filters.screening} onValueChange={v => handleFilterChange('screening', v)}>
                                            <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                                            <SelectContent>
                                                {STAGE_OPTIONS.screening.map(s => (
                                                    <SelectItem key={s} value={s}>{s}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="space-y-1">
                                        <Label>L1 Status</Label>
                                        <Select value={filters.l1} onValueChange={v => handleFilterChange('l1', v)}>
                                            <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                                            <SelectContent>
                                                {STAGE_OPTIONS.l1.map(s => (
                                                    <SelectItem key={s} value={s}>{s}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1">
                                        <Label>L2 Status</Label>
                                        <Select value={filters.l2} onValueChange={v => handleFilterChange('l2', v)}>
                                            <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                                            <SelectContent>
                                                {STAGE_OPTIONS.l2.map(s => (
                                                    <SelectItem key={s} value={s}>{s}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1">
                                        <Label>HR Status</Label>
                                        <Select value={filters.hr} onValueChange={v => handleFilterChange('hr', v)}>
                                            <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                                            <SelectContent>
                                                {STAGE_OPTIONS.hr.map(s => (
                                                    <SelectItem key={s} value={s}>{s}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Offer Status</Label>
                                        <Select value={filters.offer} onValueChange={v => handleFilterChange('offer', v)}>
                                            <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                                            <SelectContent>
                                                {STAGE_OPTIONS.offer.map(s => (
                                                    <SelectItem key={s} value={s}>{s}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="flex h-full items-end">
                                        {isStageFiltered && (
                                            <Button variant="ghost" size="sm" onClick={clearStageFilters} className="w-full">
                                                Clear Stage Filters
                                            </Button>
                                        )}
                                    </div>
                                </div>
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
                                <TableHead className="w-[280px]">Candidate</TableHead>
                                <TableHead>Project</TableHead>
                                <TableHead>Resume Review</TableHead>
                                {/* ── NEW column ── */}
                                <TableHead>Screening Status</TableHead>
                                <TableHead>L1 Status</TableHead>
                                <TableHead>L2 Status</TableHead>
                                <TableHead>HR Status</TableHead>
                                <TableHead>Offer Status</TableHead>
                                <TableHead>Final Status</TableHead>
                                {/* ── NEW: Actions column ── */}
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <CandidateSkeleton />
                            ) : error ? (
                                <TableRow>
                                    <TableCell colSpan={10} className="h-60 text-center text-red-500">
                                        {(error as Error).message}
                                    </TableCell>
                                </TableRow>
                            ) : paginatedCandidates.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={10} className="h-60 text-center text-gray-500">
                                        <Search className="mx-auto h-12 w-12 text-gray-300" />
                                        <p className="mt-3 font-medium">No candidates found</p>
                                        <p className="mt-1 text-sm text-gray-400">
                                            {isFiltered ? 'Try adjusting your filters.' : ''}
                                        </p>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                paginatedCandidates.map(candidate => (
                                    <TableRow key={candidate.id}>
                                        <TableCell className="min-w-[280px]">
                                            <Link
                                                href={`/candidates/${candidate.id}`}
                                                className="font-bold text-blue-600 hover:underline"
                                            >
                                                {candidate.candidateName || 'N/A'}
                                            </Link>
                                            <div className="text-sm text-muted-foreground break-words">
                                                {candidate.candidateEmail || '-'}
                                            </div>
                                            <div className="text-sm text-muted-foreground">
                                                {candidate.candidateDesignation || '-'}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            {jobRequisitions[candidate.jobRequisitionId ?? ""] || "-"}
                                        </TableCell>

                                        <TableCell className="align-top">
                                            <StageStatusBadge status={candidate.resumeReviewStatus} />
                                        </TableCell>
                                        {/* ── NEW: Screening Status reads from l1Status ── */}
                                        <TableCell className="align-top">
                                            <StageStatusBadge status={candidate.l1Status} />
                                        </TableCell>
                                        {/* ── L1 Status now reads from l2Status ── */}
                                        <TableCell className="align-top">
                                            <StageStatusBadge status={candidate.l2Status} />
                                        </TableCell>
                                        <TableCell className="align-top">
                                            <StageStatusBadge status={candidate.l2ManagerStatus ?? 'Locked'} />
                                        </TableCell>
                                        <TableCell className="align-top">
                                            <StageStatusBadge status={candidate.hrStatus} />
                                        </TableCell>
                                        <TableCell className="align-top">
                                            <StageStatusBadge status={candidate.offerStatus} />
                                        </TableCell>
                                        <TableCell className="align-top">
                                            {getFinalStatusBadge(candidate)}
                                        </TableCell>
                                        {/* ── NEW: Delete action ── */}
                                        <TableCell className="align-top text-right">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                aria-label="Delete candidate"
                                                disabled={deletingId === candidate.id}
                                                onClick={() => handleDeleteClick(candidate)}
                                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                            >
                                                {deletingId === candidate.id ? (
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                ) : (
                                                    <Trash2 className="h-4 w-4" />
                                                )}
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>

                {/* Pagination — unchanged */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-end space-x-4 p-4">
                        <div className="text-sm text-gray-600">
                            Rows per page:
                            <select
                                value={rowsPerPage}
                                onChange={handleChangeRowsPerPage}
                                className="mx-2 p-1 border rounded-md"
                            >
                                {[10, 20, 50].map(size => (
                                    <option key={size} value={size}>{size}</option>
                                ))}
                            </select>
                        </div>
                        <div className="text-sm text-gray-600">
                            {`${start + 1}–${Math.min(end, filteredCandidates.length)} of ${filteredCandidates.length}`}
                        </div>
                        <div className="flex space-x-2">
                            <Button variant="outline" onClick={() => handleChangePage(0)} disabled={page === 0}>&lt;&lt;</Button>
                            <Button variant="outline" onClick={() => handleChangePage(page - 1)} disabled={page === 0}>&lt;</Button>
                            <Button variant="outline" onClick={() => handleChangePage(page + 1)} disabled={end >= filteredCandidates.length}>&gt;</Button>
                            <Button variant="outline" onClick={() => handleChangePage(totalPages - 1)} disabled={end >= filteredCandidates.length}>&gt;&gt;</Button>
                        </div>
                    </div>
                )}
            </div>

            {/* ── NEW: Delete confirmation dialog ── */}
            <AlertDialog open={!!candidateToDelete} onOpenChange={(open) => !open && handleCancelDelete()}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Candidate</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete this candidate? This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={handleCancelDelete} disabled={!!deletingId}>
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleConfirmDelete}
                            disabled={!!deletingId}
                            className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
                        >
                            {deletingId ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
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