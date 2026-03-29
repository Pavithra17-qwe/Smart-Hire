
import { Badge } from '@/components/ui/badge';
import { DocumentData } from 'firebase/firestore';

export const getFinalStatusBadge = (candidate: DocumentData): React.ReactElement => {
    const finalStatus = candidate.finalStatus;

    if (finalStatus === 'Completed') {
        return <Badge variant="success">Completed</Badge>;
    }

    if (finalStatus === 'Rejected') {
        return <Badge variant="destructive">Rejected</Badge>;
    }
    
    return <Badge variant="default">In Progress</Badge>;
};
