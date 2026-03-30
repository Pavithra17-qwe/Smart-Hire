'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useCandidate } from '@/hooks/useCandidate';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from "@/components/ui/badge";
import { CandidateSkeleton } from '@/components/candidate/CandidateSkeleton';
import { getFinalStatusBadge } from '@/components/common/FinalStatusBadge';
import { Candidate } from '@/types/candidate';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type Status = 'Pending' | 'Accepted' | 'Rejected' | 'Scheduled' | 'Selected' | 'Offer Sent' | 'Joined' | 'In Progress' | 'Locked' | 'Released' | string | undefined;

const StageStatusBadge = ({ status }: { status: Status }) => {
    const displayStatus = status || 'Pending';
    const normalized = displayStatus.toLowerCase();

    let color = "!bg-gray-100 !text-gray-700"; // Default for Pending

    if (normalized === "rejected") {
        color = "!bg-red-100 !text-red-700";
    } else if ([ "accepted", "selected", "completed", "joined"].includes(normalized)) {
        color = "!bg-green-100 !text-green-700";
    } else if (normalized === "scheduled") {
        color = "!bg-blue-100 !text-blue-700";
    } else if (normalized === "released") {
        color = "!bg-orange-100 !text-orange-700";
    } else if (normalized === "in progress") {
        color = "!bg-purple-100 !text-purple-700";
    } else if (normalized === "locked") {
        color = "!bg-gray-100 !text-gray-500";
    }

    return <Badge className={`capitalize ${color}`}>{displayStatus}</Badge>;
};


export default function CandidateHistoryPage() {
    const { candidates, loading, error } = useCandidate();
    const [filters, setFilters] = useState({ name: '', role: '', status: '' });
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(10);

    const handleFilterChange = (filterName: string, value: string) => {
        setFilters(prev => ({ ...prev, [filterName]: value }));
        setPage(0);
    };

    const clearFilters = () => {
        setFilters({ name: '', role: '', status: '' });
        setPage(0);
    };

    const filteredCandidates = useMemo(() => {
        if (!Array.isArray(candidates)) return [];
        const sorted = [...candidates].sort((a, b) => {
            const dateA = a.createdDate ? a.createdDate.toMillis() : 0;
            const dateB = b.createdDate ? b.createdDate.toMillis() : 0;
            return dateB - dateA; // Sort by most recent
        });

        return sorted.filter(candidate => {
            const nameMatch = filters.name ? (candidate.candidateName || '').toLowerCase().includes(filters.name.toLowerCase()) : true;
            const roleMatch = filters.role ? (candidate.createdByRole || '').toLowerCase() === filters.role.toLowerCase() : true;
            const statusMatch = filters.status ? (candidate.finalStatus || '').toLowerCase() === filters.status.toLowerCase() : true;
            return nameMatch && roleMatch && statusMatch;
        });
    }, [candidates, filters]);

    const start = page * rowsPerPage;
    const end = start + rowsPerPage;
    const paginatedCandidates = filteredCandidates.slice(start, end);

    const handleChangePage = (newPage: number) => {
        setPage(newPage);
    };

    const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLSelectElement>) => {
        setRowsPerPage(parseInt(event.target.value, 10));
        setPage(0);
    };

    const totalPages = Math.ceil(filteredCandidates.length / rowsPerPage);
    const isFiltered = Object.values(filters).some(v => v !== '');
    const roles = useMemo(() => Array.from(new Set(candidates.map(c => c.createdByRole).filter(Boolean))), [candidates]);
    const statuses = useMemo(() => Array.from(new Set(candidates.map(c => c.finalStatus).filter(Boolean))), [candidates]);

    return (
        <div className="p-4 md:p-8 space-y-6">
            <h1 className="text-2xl font-bold">Candidate History</h1>

            <Card>
                <CardContent className="p-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                        <div className="space-y-1">
                            <Label htmlFor="filter-name">Candidate Name</Label>
                            <Input id="filter-name" placeholder="Search by name..." value={filters.name ?? ''} onChange={e => handleFilterChange('name', e.target.value)} />
                        </div>
                         <div className="space-y-1">
                            <Label htmlFor="filter-role">Role</Label>
                            <Select value={filters.role ?? ''} onValueChange={value => handleFilterChange('role', value)}>
                                <SelectTrigger id="filter-role"><SelectValue placeholder="All Roles" /></SelectTrigger>
                                <SelectContent>
                                    {roles.map(role => <SelectItem key={role ?? ''} value={role ?? ''}>{role}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="filter-status">Status</Label>
                             <Select value={filters.status ?? ''} onValueChange={value => handleFilterChange('status', value)}>
                                <SelectTrigger id="filter-status"><SelectValue placeholder="All Statuses" /></SelectTrigger>
                                <SelectContent>
                                    {statuses.map(status => <SelectItem key={status ?? ''} value={status ?? ''}>{status}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex h-full items-end">
                           {isFiltered && <Button variant="ghost" onClick={clearFilters} className="w-full">Clear Filters</Button>}
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div className="bg-white rounded-lg shadow-sm border">
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[250px]">Candidate</TableHead>
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
                                <TableRow><TableCell colSpan={7} className="h-60 text-center text-red-500">{(error as Error).message}</TableCell></TableRow>
                            ) : paginatedCandidates.length === 0 ? (
                                <TableRow><TableCell colSpan={7} className="h-60 text-center text-gray-500">
                                    <Search className="mx-auto h-12 w-12 text-gray-300" />
                                    <p className="mt-3 font-medium">No candidates found</p>
                                    <p className="mt-1 text-sm text-gray-400">{isFiltered ? "Try adjusting your filters." : ""}</p>
                                </TableCell></TableRow>
                            ) : (
                                paginatedCandidates.map(candidate => (
                                    <TableRow key={candidate.id}>
                                        <TableCell className="align-top">
                                            <Link href={`/candidates/${candidate.id}`} className="font-bold text-blue-600 hover:underline">{candidate.candidateName || 'N/A'}</Link>
                                            <div className="text-sm text-muted-foreground">{candidate.candidateDesignation || '-'}</div>
                                        </TableCell>
                                        <TableCell className="align-top"><StageStatusBadge status={candidate.resumeReviewStatus} /></TableCell>
                                        <TableCell className="align-top"><StageStatusBadge status={candidate.l1Status} /></TableCell>
                                        <TableCell className="align-top"><StageStatusBadge status={candidate.l2Status} /></TableCell>
                                        <TableCell className="align-top"><StageStatusBadge status={candidate.hrStatus} /></TableCell>
                                        <TableCell className="align-top"><StageStatusBadge status={candidate.offerStatus} /></TableCell>
                                        <TableCell className="align-top">{getFinalStatusBadge(candidate)}</TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
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
                                    <option key={size} value={size}>
                                        {size}
                                    </option>
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
