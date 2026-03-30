'use client';
import React, { useState, useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { normalizeStatus } from '@/lib/normalizeStatus';

interface Requirement {
    id: string;
    title: string;
    clientName: string;
    status: string;
    submissions: number;
}

export default function RequirementsPage() {
    const [requirements, setRequirements] = useState<Requirement[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsub = onSnapshot(collection(db, 'requirements'), (snapshot) => {
            const reqs: Requirement[] = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
            } as Requirement));
            setRequirements(reqs);
            setLoading(false);
        });
        return () => unsub();
    }, []);

    if (loading) return <p>Loading requirements...</p>;

    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-4">Active Requirements</h1>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {requirements.map(req => {
                  const normalized = normalizeStatus(req.status);
                  return (
                    <Card key={req.id}>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <CardTitle className="text-lg font-bold">{req.title}</CardTitle>
                            <Badge className={normalized.color}>{normalized.name}</Badge>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-gray-600">Client: {req.clientName}</p>
                            <p className="text-sm text-gray-600">Submissions: {req.submissions}</p>
                        </CardContent>
                    </Card>
                )})}
            </div>
        </div>
    );
}
