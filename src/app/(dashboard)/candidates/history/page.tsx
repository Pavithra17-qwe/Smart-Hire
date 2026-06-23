'use client';

import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from "next/navigation";
import Link from 'next/link';
import { useCandidate } from '@/hooks/useCandidate';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from "@/components/ui/badge";
import { CandidateSkeleton } from '@/components/candidate/CandidateSkeleton';
import { getFinalStatusBadge } from '@/components/common/FinalStatusBadge';
import { Search, ChevronDown, ChevronUp } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type Status = string | undefined;

const StageStatusBadge = ({ status }: { status: Status }) => {
    const displayStatus = status || 'Pending';
    const normalized = displayStatus.toLowerCase();

    let color = "!bg-gray-100 !text-gray-700";
    if (normalized === "rejected")                                                    color = "!bg-red-100 !text-red-700";
    else if (["accepted", "selected", "completed", "joined"].includes(normalized))   color = "!bg-green-100 !text-green-700";
    else if (normalized === "scheduled")                                              color = "!bg-blue-100 !text-blue-700";
    else if (normalized === "released")                                               color = "!bg-orange-100 !text-orange-700";
    else if (normalized === "in progress")                                            color = "!bg-purple-100 !text-purple-700";
    else if (normalized === "locked")                                                 color = "!bg-gray-100 !text-gray-500";
    else if (normalized === "on hold")                                                color = "!bg-amber-100 !text-amber-700";

    return <Badge className={`capitalize ${color}`}>{displayStatus}</Badge>;
};

const FINAL_STATUSES = ['In Progress', 'Completed', 'Rejected'];

const STAGE_OPTIONS = {
    resumeReview: ['Pending', 'Accepted', 'Rejected', 'On Hold'],
    l1:    ['Pending', 'Scheduled', 'Selected', 'Rejected', 'On Hold'],
    l2:    ['Pending', 'Scheduled', 'Selected', 'Rejected', 'On Hold'],
    hr:    ['Pending', 'Scheduled', 'Selected', 'Rejected', 'On Hold'],
    offer: ['Pending', 'Released', 'Accepted', 'Rejected', 'On Hold'],
};

const INITIAL_FILTERS = {
    name: '', role: '', status: '',
    resumeReview: '', l1: '', l2: '', hr: '', offer: '',
};

// Maps URL stage param → candidate field name
const STAGE_FIELD_MAP: Record<string, string> = {
    resume: "resumeReviewStatus",
    l1:     "l1Status",
    l2:     "l2Status",
    hr:     "hrStatus",
    offer:  "offerStatus",
    final:  "finalStatus",
};

export default function CandidateHistoryPage() {
    const { candidates, loading, error } = useCandidate();
    const searchParams = useSearchParams();

    // ── UI filter state ───────────────────────────────────────────────────────
    const [filters,          setFilters]          = useState(INITIAL_FILTERS);
    const [showStageFilters, setShowStageFilters] = useState(false);
    const [page,             setPage]             = useState(0);
    const [rowsPerPage,      setRowsPerPage]      = useState(10);

    // ── URL-driven filter state ───────────────────────────────────────────────
    // These are set once on mount from query params sent by the dashboard cards.
    const [urlPanelUid,   setUrlPanelUid]   = useState<string | null>(null);
    const [urlStage,      setUrlStage]      = useState<string>("all");
    const [urlStatus,     setUrlStatus]     = useState<string>("all");
    const [urlCreatedBy,  setUrlCreatedBy]  = useState<string | null>(null);
    // ── ids: comma-separated list of candidate IDs passed by dashboard stat cards
    // When present, ONLY these candidates are shown (exact match, no other filtering needed)
    const [urlIds,        setUrlIds]        = useState<Set<string> | null>(null);
    const [isActiveFilter, setIsActiveFilter] = useState(false);

    useEffect(() => {
        const active      = searchParams.get("active") === "true";
        const stage       = searchParams.get("stage")      || "all";
        const status      = searchParams.get("status")     || "all";
        const createdBy   = searchParams.get("createdBy");
        const panelUid    = searchParams.get("panelUid");
        const ids         = searchParams.get("ids");        // ← NEW: comma-separated candidate IDs

        setIsActiveFilter(active);
        setUrlStage(stage);
        setUrlStatus(status);
        setUrlCreatedBy(createdBy);
        setUrlPanelUid(panelUid);

        // If ids param is provided, build a Set for O(1) lookup.
        // "__empty__" is a sentinel meaning "zero results" — used when the
        // dashboard card count is 0 (e.g. Today's Interviews = 0). Without it,
        // an empty ids="" string would fall through and show all candidates.
        if (ids === "__empty__") {
            setUrlIds(new Set()); // empty Set → zero rows shown
        } else if (ids && ids.trim().length > 0) {
            const idSet = new Set(ids.split(",").map(s => s.trim()).filter(Boolean));
            setUrlIds(idSet.size > 0 ? idSet : null);
        } else {
            setUrlIds(null);
        }

        // Auto-expand stage filters if coming from a dashboard stage link
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
        setFilters(prev => ({ ...prev, resumeReview: '', l1: '', l2: '', hr: '', offer: '' }));
        setPage(0);
    };

    // ── Main filter logic ─────────────────────────────────────────────────────
    const filteredCandidates = useMemo(() => {
        if (!Array.isArray(candidates)) return [];

        // ── PRIORITY 1: ids param — show ONLY these exact candidates ──────────
        // urlIds is a Set of IDs. An empty Set means zero results (e.g. Today = 0).
        // null means no ids param was passed — fall through to other filters.
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
        if (isActiveFilter) {
            return candidates.filter(c => {
                const final = (c.finalStatus ?? "").toLowerCase();
                return final !== "completed" && final !== "rejected";
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

            const l1Match =
                !filters.l1 ||
                (candidate.l1Status ?? 'Pending').toLowerCase() === filters.l1.toLowerCase();

            const l2Match =
                !filters.l2 ||
                (candidate.l2Status ?? 'Pending').toLowerCase() === filters.l2.toLowerCase();

            const hrMatch =
                !filters.hr ||
                (candidate.hrStatus ?? 'Pending').toLowerCase() === filters.hr.toLowerCase();

            const offerMatch =
                !filters.offer ||
                (candidate.offerStatus ?? 'Pending').toLowerCase() === filters.offer.toLowerCase();

            // ── URL stage+status filter (from admin/panel dashboard clicks) ───
            // Applies when no ids param is present
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

            // ── panelUid filter: show only candidates this panel member handles ──
            // Works independently and stacks with stage+status filter above
            let panelMatch = true;
            if (urlPanelUid) {
                panelMatch =
                    candidate.l1InterviewerUid === urlPanelUid ||
                    candidate.l2InterviewerUid === urlPanelUid;
            }

            // ── createdBy filter (HR / Agency uploader) ───────────────────────
            let uploaderMatch = true;
            if (urlCreatedBy && urlCreatedBy !== "all" && urlCreatedBy !== "panel") {
                uploaderMatch = candidate.createdBy === urlCreatedBy;
            }

            return (
                nameMatch    &&
                roleMatch    &&
                statusMatch  &&
                rrMatch      &&
                l1Match      &&
                l2Match      &&
                hrMatch      &&
                offerMatch   &&
                stageStatusMatch &&
                panelMatch   &&
                uploaderMatch
            );
        });

    }, [
        candidates, filters, isActiveFilter,
        urlIds, urlStage, urlStatus, urlPanelUid, urlCreatedBy,
    ]);

    const start  = page * rowsPerPage;
    const end    = start + rowsPerPage;
    const paginatedCandidates = filteredCandidates.slice(start, end);
    const totalPages = Math.ceil(filteredCandidates.length / rowsPerPage);

    const handleChangePage = (newPage: number) => setPage(newPage);
    const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLSelectElement>) => {
        setRowsPerPage(parseInt(event.target.value, 10));
        setPage(0);
    };

    const isFiltered       = Object.values(filters).some(v => v !== '');
    const isStageFiltered  = [filters.resumeReview, filters.l1, filters.l2, filters.hr, filters.offer].some(v => v !== '');

    // Label shown when a URL-driven filter is active (from dashboard card clicks)
    const urlFilterLabel = useMemo(() => {
        if (urlIds !== null)         return `Showing ${urlIds.size} candidate${urlIds.size !== 1 ? 's' : ''} from dashboard filter`;
        if (urlPanelUid && urlStage !== "all" && urlStatus !== "all")
            return `Filtered: ${urlStage.toUpperCase()} → ${urlStatus} (panel view)`;
        if (urlPanelUid)             return "Showing your assigned candidates";
        if (urlCreatedBy)            return `Filtered by uploader`;
        if (urlStage !== "all" || urlStatus !== "all")
            return `Stage: ${urlStage !== "all" ? urlStage.toUpperCase() : "All"} · Status: ${urlStatus !== "all" ? urlStatus : "All"}`;
        return null;
    }, [urlIds, urlPanelUid, urlStage, urlStatus, urlCreatedBy]);

    const roles = useMemo(
        () => Array.from(new Set(candidates.map(c => c.createdByRole).filter(Boolean))),
        [candidates]
    );

    return (
        <div className="p-4 md:p-8 space-y-6">
            <h1 className="text-2xl font-bold">Candidate History</h1>

            {/* URL filter badge — shown when navigated from dashboard */}
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
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
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
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 items-end">
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
                                <TableHead className="w-[220px]">Candidate</TableHead>
                                <TableHead>Resume Review</TableHead>
                                <TableHead>L1 Status</TableHead>
                                <TableHead>L2 Status</TableHead>
                                <TableHead>HR Status</TableHead>
                                <TableHead>Offer Status</TableHead>
                                <TableHead>Final Status</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <CandidateSkeleton />
                            ) : error ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="h-60 text-center text-red-500">
                                        {(error as Error).message}
                                    </TableCell>
                                </TableRow>
                            ) : paginatedCandidates.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="h-60 text-center text-gray-500">
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
                                        <TableCell className="align-top">
                                            <Link
                                                href={`/candidates/${candidate.id}`}
                                                className="font-bold text-blue-600 hover:underline"
                                            >
                                                {candidate.candidateName || 'N/A'}
                                            </Link>
                                            <div className="text-sm text-muted-foreground">
                                                {candidate.candidateDesignation || '-'}
                                            </div>
                                        </TableCell>
                                        <TableCell className="align-top">
                                            <StageStatusBadge status={candidate.resumeReviewStatus} />
                                        </TableCell>
                                        <TableCell className="align-top">
                                            <StageStatusBadge status={candidate.l1Status} />
                                        </TableCell>
                                        <TableCell className="align-top">
                                            <StageStatusBadge status={candidate.l2Status} />
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
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>

                {/* Pagination */}
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
        </div>
    );
}