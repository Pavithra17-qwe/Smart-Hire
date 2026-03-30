'use client';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { normalizeStatus } from '@/lib/normalizeStatus';

interface HistoryLog {
    id: string;
    stage: string;
    status: string;
    feedback: string;
    updatedAt: any;
    updatedBy: string; // Assuming we store user name or ID
}

export default function CandidateHistoryPage({ params }: { params: { candidateId: string } }) {
    const { candidateId } = params;
    const [history, setHistory] = useState<HistoryLog[]>([]);
    const [loading, setLoading] = useState(true);
    const router = useRouter();

    useEffect(() => {
        if (!candidateId) return;
        const q = query(
            collection(db, 'candidate_history'), 
            where('candidateId', '==', candidateId),
            orderBy('updatedAt', 'desc')
        );
        const unsub = onSnapshot(q, (snapshot) => {
            const historyLogs: HistoryLog[] = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
            } as HistoryLog));
            setHistory(historyLogs);
            setLoading(false);
        });
        return () => unsub();
    }, [candidateId]);

    if (loading) return <div style={{ fontFamily: 'Segoe UI, system-ui', background: '#F5F6FA', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading History...</div>;

    return (
        <div style={{ fontFamily: 'Segoe UI, system-ui', background: '#F5F6FA', minHeight: '100vh', padding: '24px' }}>
            <div className="max-w-4xl mx-auto">
                <Button onClick={() => router.back()} variant="ghost" className="mb-4">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to Candidate
                </Button>
                <h1 className="text-2xl font-bold mb-6">Candidate History</h1>
                <div className="space-y-6">
                    {history.map(log => {
                        const normalized = normalizeStatus(log.status);
                        return (
                            <div key={log.id} style={{ background: 'white', borderRadius: '12px', padding: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
                                <div className="flex justify-between items-center mb-2">
                                    <h3 className="font-bold text-lg">{log.stage}</h3>
                                    <Badge className={normalized.color}>{normalized.name}</Badge>
                                </div>
                                <p className="text-sm text-gray-600 mb-2">{log.feedback}</p>
                                <p className="text-xs text-gray-400">Updated on {new Date(log.updatedAt.seconds * 1000).toLocaleString()}</p>
                            </div>
                        );
                    })}
                     {history.length === 0 && <p className="text-center text-gray-500">No history found for this candidate.</p>}
                </div>
            </div>
        </div>
    );
}
