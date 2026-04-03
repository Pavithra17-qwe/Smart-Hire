import { useState, useEffect } from 'react';
import { onSnapshot, FirestoreError } from 'firebase/firestore';
import { useAuth } from '@/hooks/useAuth';
import { getCandidatesQuery } from '@/services/candidateService';
import { Candidate } from '@/types/candidate';

export const useCandidate = () => {
    const { user, role } = useAuth();
    const [candidates, setCandidates] = useState<Candidate[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<FirestoreError | null>(null);

    const canUpdate = role === 'panel' || role === 'hr' || role === 'agency';

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
            const data: Candidate[] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Candidate));
            setCandidates(data);
            setLoading(false);
        }, (err) => {
            setError(err);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [user, role]);

    return { candidates, loading, error, canUpdate, user, role };
};
