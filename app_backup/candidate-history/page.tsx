'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { collection, onSnapshot, query, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

// --- TYPE DEFINITIONS ---
interface HistoryItem {
    id: string;
    candidateId: string;
    candidateName: string;
    stage: string;
    action: string;
    feedback?: string;
    scheduledDate?: string;
    timeSlot?: string;
    joinDate?: string;
    timestamp: Timestamp;
}

// --- HELPER FUNCTIONS ---
const statusVariant = (action: string | undefined) => {
    const s = action?.toLowerCase() || '';
    if (['accepted', 'selected', 'joined', 'offer-accept'].includes(s)) return 'default';
    if (['rejected', 'offer-reject'].includes(s)) return 'destructive';
    if (['scheduled', 'pending', 'offer sent'].includes(s)) return 'secondary';
    return 'outline';
};

export default function CandidateHistoryPage() {
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const router = useRouter();

    useEffect(() => {
        const q = query(collection(db, 'candidateHistory'), orderBy('timestamp', 'desc'));
        const unsub = onSnapshot(q, (querySnapshot) => {
            const historyData: HistoryItem[] = [];
            querySnapshot.forEach((doc) => {
                historyData.push({ id: doc.id, ...doc.data() } as HistoryItem);
            });
            setHistory(historyData);
            setLoading(false);
        });
        return () => unsub();
    }, []);

    if (loading) {
        return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh', fontFamily: 'Segoe UI, system-ui' }}>Loading history...</div>;
    }

    return (
        <div style={{ fontFamily: 'Segoe UI, system-ui', background: '#F5F6FA', padding: '24px' }}>
            <div className="mb-6">
                <h1 className="text-2xl font-bold">Candidate History</h1>
                <p className="text-gray-500">Full audit trail of all interview actions.</p>
            </div>

            <div style={{ background: 'white', borderRadius: '14px', border: '1.5px solid #E5E7EB' }}>
                {history.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '48px' }} className="text-gray-500">
                        <span style={{ fontSize: '48px' }}>📭</span>
                        <p className="font-semibold mt-4">No activity yet</p>
                        <p className="text-sm">As actions are taken on candidates, they will appear here.</p>
                    </div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 2fr 2fr 1fr', alignItems: 'center', borderBottom: '1.5px solid #E5E7EB', padding: '12px 16px', fontWeight: 'bold' }} className="text-sm text-gray-600">
                         <span>Candidate</span>
                         <span>Stage</span>
                         <span>Status</span>
                         <span>Feedback</span>
                         <span>Date / Time</span>
                         <span>Action</span>
                    </div>
                )}
                {history.map((item: HistoryItem) => (
                    <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 2fr 2fr 1fr', alignItems: 'center', padding: '16px', borderTop: '1px solid #F3F4F6' }} className="text-sm">
                        <span className="font-bold">{item.candidateName}</span>
                        <span>{item.stage}</span>
                        <span><Badge variant={statusVariant(item.action)}>{item.action}</Badge></span>
                        <span className="text-gray-500 truncate pr-4">{item.feedback || 'N/A'}</span>
                        <span className="text-gray-500">
                             {item.scheduledDate ? `${new Date(item.scheduledDate).toLocaleDateString()} · ${item.timeSlot}` : item.joinDate ? `Join: ${new Date(item.joinDate).toLocaleDateString()}` : new Date(item.timestamp.toMillis()).toLocaleString()}
                        </span>
                        <span>
                            <Button size="sm" variant="outline" onClick={() => router.push(`/candidates/${item.candidateId}`)}>View Detail</Button>
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}
