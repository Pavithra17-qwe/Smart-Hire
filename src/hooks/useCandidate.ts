
import { useState, useEffect } from 'react';
import { onSnapshot, FirestoreError } from 'firebase/firestore';
import { useAuth } from '@/hooks/use-auth';
import { getCandidatesQuery } from '@/services/candidateService';

// Define a more specific type for a candidate
interface Candidate {
    id: string;
    // Add other expected properties of a candidate here
    [key: string]: any; // Allow for other properties
}

export const useCandidate = () => {
    const { user, role } = useAuth();
    const [candidates, setCandidates] = useState<Candidate[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<FirestoreError | null>(null);

    useEffect(() => {
        if (!user || !role) {
            setLoading(true);
            return;
        }

        const q = getCandidatesQuery(role, user.uid);

        if (!q) {
            setCandidates([]);
            setLoading(false);
            return;
        }

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data: Candidate[] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setCandidates(data);
            setLoading(false);
        }, (err) => {
            setError(err);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [user, role]);

    return { candidates, loading, error };
};
