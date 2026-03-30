'use client';

import { useState, useMemo } from 'react';
import { useCandidate } from '@/hooks/useCandidate';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
        console.error("Invalid timestamp:", error);
        return 'Invalid Date';
    }
};

export default function CandidateListPage() {
    const { candidates, loading, error } = useCandidate();
    const [filters, setFilters] = useState({ name: ''});
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(10);

    const handleFilterChange = (filterName: string, value: string) => {
        setFilters(prev => ({ ...prev, [filterName]: value }));
        setPage(0);
    };

    const clearFilters = () => {
        setFilters({ name: ''});
        setPage(0);
    };

    const filteredCandidates = useMemo(() => {
        if (!Array.isArray(candidates)) return [];
        return (candidates as Candidate[]).filter(candidate => {
            const nameMatch = filters.name ? (candidate.candidateName || '').toLowerCase().includes(filters.name.toLowerCase()) : true;
            return nameMatch;
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

    return (
        <div className="p-4 md:p-8 space-y-6">
            <h1 className="text-2xl font-bold">Candidate List</h1>

            <Card>
                <CardContent className="p-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-end">
                        <div className="space-y-1">
                            <Label htmlFor="filter-name">Candidate Name</Label>
                            <Input id="filter-name" placeholder="Search by name..." value={filters.name} onChange={e => handleFilterChange('name', e.target.value)} />
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
                                <TableHead className="w-[150px]">Experience</TableHead>
                                <TableHead className="w-[200px]">Location</TableHead>
                                <TableHead className="w-[200px]">Created By</TableHead>
                                <TableHead>Final Status</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <CandidateSkeleton />
                            ) : error ? (
                                <TableRow><TableCell colSpan={6} className="h-60 text-center text-red-500">{error.message}</TableCell></TableRow>
                            ) : paginatedCandidates.length === 0 ? (
                                <TableRow><TableCell colSpan={6} className="h-60 text-center text-gray-500">
                                    <Search className="mx-auto h-12 w-12 text-gray-300" />
                                    <p className="mt-3 font-medium">No candidates found</p>
                                    <p className="mt-1 text-sm text-gray-400">{isFiltered ? "Try adjusting your filters." : ""}</p>
                                </TableCell></TableRow>
                            ) : (
                                paginatedCandidates.map(candidate => (
                                    <TableRow key={candidate.id}>
                                        <TableCell className="align-top">
                                            <div className="font-bold">{candidate.candidateName || 'N/A'}</div>
                                            <div className="text-sm text-muted-foreground">{candidate.candidateDesignation || '-'}</div>
                                            <div className="text-sm text-muted-foreground">{candidate.candidateEmail || '-'}</div>
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground align-top">
                                            {candidate.experience ? `${candidate.experience} years` : 'N/A'}
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground align-top">
                                            {candidate.location || 'N/A'}
                                        </TableCell>
                                        <TableCell className="align-top">
                                            <div className="font-medium">{candidate.createdByName || 'N/A'}</div>
                                            <div className="text-sm text-muted-foreground capitalize">{candidate.createdByRole || '-'}</div>
                                            <div className="text-sm text-muted-foreground">{formatFirestoreTimestamp(candidate.createdDate)}</div>
                                        </TableCell>
                                        <TableCell className="align-top">{getFinalStatusBadge(candidate.finalStatus)}</TableCell>
                                        <TableCell className="text-right align-top">
                                            <Button asChild variant="ghost" size="sm">
                                                <Link href={`/candidates/${candidate.id}`}>View Details</Link>
                                            </Button>
                                        </TableCell>
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
                                {[5, 10, 25, 50].map(size => (
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
