
import { TableCell, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';

export const CandidateSkeleton = () => (
    <>
        {[...Array(10)].map((_, i) => (
            <TableRow key={i}>
                <TableCell><Skeleton className="h-5 w-full rounded-md" /></TableCell>
                <TableCell><Skeleton className="h-5 w-full rounded-md" /></TableCell>
                <TableCell><Skeleton className="h-5 w-full rounded-md" /></TableCell>
                <TableCell><Skeleton className="h-5 w-full rounded-md" /></TableCell>
                <TableCell className="text-right"><Skeleton className="h-8 w-24 rounded-md" /></TableCell>
            </TableRow>
        ))}
    </>
);
