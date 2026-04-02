'use client';

import { useState, useMemo } from 'react';
import { useCandidate } from '@/hooks/useCandidate';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import Link from 'next/link';
import { CandidateSkeleton } from '@/components/candidate/CandidateSkeleton';
import { getFinalStatusBadge } from '@/components/common/FinalStatusBadge';
import { Candidate } from '@/types/candidate';
import { Timestamp } from 'firebase/firestore';

const formatFirestoreTimestamp = (timestamp: Timestamp | undefined): string => {
    if (!timestamp || typeof timestamp.seconds !== 'number') {
        return 'N/A';
    }
    try {
        const date = new Date(timestamp.seconds * 1000);
        return date.toLocaleDateString('en-CA'); // Format: YYYY-MM-DD
    } catch (error) {
        console.error('Invalid timestamp:', error);
        return 'Invalid Date';
    }
};

const FINAL_STATUSES = ['In Progress', 'Completed', 'Rejected'];

const INITIAL_FILTERS = {
    name: '',
    role: '',
    status: '',
};

export default function CandidateListPage() {
    const { candidates, loading, error } = useCandidate();
    const [filters, setFilters] = useState(INITIAL_FILTERS);
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(10);

    const handleFilterChange = (filterName: string, value: string) => {
        setFilters(prev => ({ ...prev, [filterName]: value }));
        setPage(0);
    };

    const clearFilters = () => {
        setFilters(INITIAL_FILTERS);
        setPage(0);
    };

    const filteredCandidates = useMemo(() => {
        if (!Array.isArray(candidates)) return [];

        // Sort by most recently created first
        const sorted = [...(candidates as Candidate[])].sort((a, b) => {
            const dateA = a.createdDate ? a.createdDate.toMillis() : 0;
            const dateB = b.createdDate ? b.createdDate.toMillis() : 0;
            return dateB - dateA;
        });

        return sorted.filter(candidate => {
            const nameMatch   = !filters.name   || (candidate.candidateName  || '').toLowerCase().includes(filters.name.toLowerCase());
            const roleMatch   = !filters.role   || (candidate.createdByRole  || '').toLowerCase() === filters.role.toLowerCase();
            const statusMatch = !filters.status || (candidate.finalStatus    || '').toLowerCase() === filters.status.toLowerCase();
            return nameMatch && roleMatch && statusMatch;
        });
    }, [candidates, filters]);

    const start = page * rowsPerPage;
    const end = start + rowsPerPage;
    const paginatedCandidates = filteredCandidates.slice(start, end);
    const totalPages = Math.ceil(filteredCandidates.length / rowsPerPage);

    const handleChangePage = (newPage: number) => setPage(newPage);

    const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLSelectElement>) => {
        setRowsPerPage(parseInt(event.target.value, 10));
        setPage(0);
    };

    const isFiltered = Object.values(filters).some(v => v !== '');

    const roles = useMemo(
        () => Array.from(new Set((candidates as Candidate[]).map(c => c.createdByRole).filter(Boolean))),
        [candidates]
    );

    return (
        <div className="p-4 md:p-8 space-y-6">
            <h1 className="text-2xl font-bold">Candidate List</h1>

            {/* Filters */}
            <Card>
                <CardContent className="p-4">
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
                                <SelectTrigger id="filter-role">
                                    <SelectValue placeholder="All Roles" />
                                </SelectTrigger>
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
                                <SelectTrigger id="filter-status">
                                    <SelectValue placeholder="All Statuses" />
                                </SelectTrigger>
                                <SelectContent>
                                    {FINAL_STATUSES.map(status => (
                                        <SelectItem key={status} value={status}>{status}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="flex h-full items-end">
                            {isFiltered && (
                                <Button variant="ghost" onClick={clearFilters} className="w-full">
                                    Clear Filters
                                </Button>
                            )}
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Table */}
            <div className="bg-white rounded-lg shadow-sm border">
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[230px]">Candidate</TableHead>
                                <TableHead className="w-[120px]">Experience</TableHead>
                                <TableHead className="w-[160px]">Location</TableHead>
                                <TableHead className="w-[160px]">Created By</TableHead>
                                <TableHead className="w-[130px]">Created Date</TableHead>
                                <TableHead>Final Status</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <CandidateSkeleton />
                            ) : error ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-60 text-center text-red-500">
                                        {(error as Error).message}
                                    </TableCell>
                                </TableRow>
                            ) : paginatedCandidates.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-60 text-center text-gray-500">
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
                                        {/* Candidate */}
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
                                            <div className="text-sm text-muted-foreground">
                                                {candidate.candidateEmail || '-'}
                                            </div>
                                        </TableCell>

                                        {/* Experience */}
                                        <TableCell className="text-sm text-muted-foreground align-top">
                                            {candidate.experience ? `${candidate.experience} years` : 'N/A'}
                                        </TableCell>

                                        {/* Location */}
                                        <TableCell className="text-sm text-muted-foreground align-top">
                                            {candidate.location || 'N/A'}
                                        </TableCell>

                                        {/* Created By — name + role only, no date */}
                                        <TableCell className="align-top">
                                            <div className="font-medium">
                                                {candidate.createdByName || 'N/A'}
                                            </div>
                                            <div className="text-sm text-muted-foreground capitalize">
                                                {candidate.createdByRole || '-'}
                                            </div>
                                        </TableCell>

                                        {/* Created Date — separate column */}
                                        <TableCell className="text-sm text-muted-foreground align-top">
                                            {formatFirestoreTimestamp(candidate.createdDate)}
                                        </TableCell>

                                        {/* Final Status — use full candidate object, not candidate.FinalStatus */}
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
                                {[5, 10, 25, 50].map(size => (
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