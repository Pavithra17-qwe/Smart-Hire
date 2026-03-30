'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { doc, onSnapshot, updateDoc, addDoc, collection, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Calendar, Download, Lock } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Candidate } from '@/types/candidate';
import { normalizeStatus } from '@/lib/normalizeStatus';

// --- TYPE DEFINITIONS ---
type Status = 'Pending' | 'Accepted' | 'Rejected' | 'Scheduled' | 'Selected' | 'Offer Sent' | 'Joined' | 'In Progress' | 'Locked' | 'Released';

interface ProposeTimeProps {
    onPropose: (date: string, slot: string) => void;
}

interface StageCardProps {
    title: string;
    status: Status;
    isLocked: boolean;
    scheduledDate?: string;
    timeSlot?: string;
    savedFeedback?: string;
    onAction: (action: string, payload: any) => void;
    isResume?: boolean;
    isOffer?: boolean;
    canUpdate: boolean;
    role: string | null;
}

// --- SUB-COMPONENTS ---

const ProposeTime: React.FC<ProposeTimeProps> = ({ onPropose }) => {
    const [date, setDate] = useState('');
    const [slot, setSlot] = useState('');
    const today = new Date().toISOString().split('T')[0];

    const handlePropose = () => {
        if (!date || !slot) {
            alert('Please pick a date and time slot.');
            return;
        }
        onPropose(date, slot);
    };

    const timeSlots = [
        "09:00am - 10:00am", "10:00am - 11:00am", "11:00am - 12:00pm",
        "01:00pm - 02:00pm", "02:00pm - 03:00pm", "03:00pm - 04:00pm", "04:00pm - 05:00pm"
    ];

    return (
        <div style={{ background: '#F9FAFB', borderRadius: '10px', padding: '14px' }}>
            <p style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '12px' }}>Propose Interview Time</p>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <div style={{ position: 'relative' }}>
                    <Calendar className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <Input type="date" value={date ?? ''} onChange={(e) => setDate(e.target.value)} className="pl-10" style={{ background: 'white', borderRadius: '8px' }} min={today} />
                </div>
                <select value={slot ?? ''} onChange={(e) => setSlot(e.target.value)} style={{ borderRadius: '8px', border: '1px solid #E5E7EB', padding: '9px', background: 'white', flex: 1 }}>
                    <option value="">Select a slot</option>
                    {timeSlots.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <Button onClick={handlePropose} style={{ background: '#7C3AED', color: 'white', fontWeight: 'bold' }}>Propose</Button>
            </div>
        </div>
    );
};

const StageCard: React.FC<StageCardProps> = ({ title, status, isLocked, scheduledDate, timeSlot, savedFeedback, onAction, isResume = false, isOffer = false, canUpdate, role }) => {
    const [feedback, setFeedback] = useState('');
    const postFeedbackRef = useRef<HTMLTextAreaElement>(null);

    const normalized = normalizeStatus(status);

    const isActive = !isLocked && ['Pending', 'Scheduled', 'Released'].includes(normalized.name);

    const cardStyle = {
        borderRadius: '12px',
        border: `1.5px solid ${isActive ? '#7C3AED' : '#E5E7EB'}`,
        boxShadow: isActive ? '0 2px 10px rgba(124,58,237,0.08)' : 'none',
        background: 'white',
    };

    const canPerformAction = () => {
        if (!canUpdate) return false;
        if (role === 'admin' || role === 'agency') return false;
        if (role === 'panel' && (title === 'HR Round' || title === 'Offer Stage')) return false;
        if (role === 'hr' && (title === 'Resume Review' || title === 'L1 Interview' || title === 'L2 Interview')) return false;
        return true;
    };

    return (
        <div style={cardStyle}>
            <div style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontWeight: 'bold', fontSize: '15px', margin: 0 }}>{title}</h3>
                <Badge className={normalized.color}>{normalized.name}</Badge>
            </div>
            <div style={{ padding: '0 16px 16px 16px' }}>
                {isLocked ? (
                    <div className="flex items-center gap-2 text-gray-500 text-sm">
                        <Lock className="h-4 w-4" />
                        <p>Complete the previous stage to unlock this step.</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {/* Resume Review Stage */}
                        {isResume && (
                            <>
                                {(normalized.name === 'Accepted' || normalized.name === 'Rejected') && <p className={`text-sm ${normalized.name === 'Rejected' ? 'text-red-600' : 'text-gray-600'}`}>{savedFeedback || 'No feedback provided.'}</p>}
                                {canPerformAction() && normalized.name === 'Pending' && (
                                    <>
                                        <Textarea placeholder="Enter feedback (optional)..." value={feedback} onChange={e => setFeedback(e.target.value)} />
                                        <div className="flex justify-end gap-2">
                                            <Button variant="destructive" onClick={() => onAction('reject', { feedback })}>✕ Reject</Button>
                                            <Button variant="default" onClick={() => onAction('accept', { feedback })}>✓ Accept</Button>
                                        </div>
                                    </>
                                )}
                            </>
                        )}

                        {/* Interview Stages (L1, L2, HR) */}
                        {!isResume && !isOffer && (
                             <>
                                {(normalized.name === 'Scheduled' || normalized.name === 'Selected' || normalized.name === 'Rejected') && scheduledDate && (
                                    <p className="text-sm font-semibold">Scheduled on: {new Date(scheduledDate).toLocaleDateString()} at {timeSlot}</p>
                                )}
                                {(normalized.name === 'Selected' || normalized.name === 'Rejected') && (
                                    <p className={`text-sm mt-2 ${normalized.name === 'Rejected' ? 'text-red-600' : 'text-gray-600'}`}>{savedFeedback || 'No feedback provided.'}</p>
                                )}
                                {canPerformAction() && (
                                    <>
                                        {normalized.name === 'Pending' && <ProposeTime onPropose={(date, slot) => onAction('schedule', { scheduledDate: date, timeSlot: slot })} />}
                                        {normalized.name === 'Scheduled' && (
                                            <>
                                                <Textarea placeholder="Enter interview feedback..." ref={postFeedbackRef} />
                                                <div className="flex justify-end gap-2">
                                                    <Button variant="destructive" onClick={() => onAction('reject', { feedback: postFeedbackRef.current?.value || '' })}>✕ Reject</Button>
                                                    <Button variant="default" onClick={() => onAction('select', { feedback: postFeedbackRef.current?.value || '' })}>✓ Select</Button>
                                                </div>
                                            </>
                                        )}
                                    </>
                                )}
                            </>
                        )}

                        {/* Offer Stage */}
                        {isOffer && (
                            <>
                                {normalized.name === 'Released' && <p className="text-sm font-semibold text-blue-600">📨 Offer has been released to the candidate</p>}
                                {(normalized.name === 'Accepted' || normalized.name === 'Rejected') && savedFeedback && (
                                    <p className={`text-sm font-semibold ${normalized.name === 'Accepted' ? 'text-green-600' : 'text-red-600'}`}>
                                        {normalized.name === 'Accepted' ? `🎉 Candidate accepted the offer. ` : ''}
                                        {normalized.name === 'Rejected' ? 'Candidate rejected the offer. ' : ''}
                                        {savedFeedback}
                                    </p>
                                )}
                                {canPerformAction() && (
                                    <>
                                        {normalized.name === 'Pending' && <div className="flex justify-end"><Button onClick={() => onAction('release-offer', {})} style={{ background: '#7C3AED', color: 'white' }}>📨 Offer Released</Button></div>}
                                        {normalized.name === 'Released' && (
                                            <>
                                                <Textarea placeholder="Enter feedback..." ref={postFeedbackRef} />
                                                <div className="flex justify-end gap-2">
                                                    <Button variant="destructive" onClick={() => onAction('offer-reject', { feedback: postFeedbackRef.current?.value || '' })}>✕ Mark Rejected</Button>
                                                    <Button variant="default" onClick={() => onAction('offer-accept', { feedback: postFeedbackRef.current?.value || '' })}>✓ Mark Accepted</Button>
                                                </div>
                                            </>
                                        )}
                                    </>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default function CandidatePage({ params }: { params: { candidateId: string } }) {
    const { candidateId } = params;
    const [candidate, setCandidate] = useState<Candidate | null>(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();
    const { role, user } = useAuth();

    useEffect(() => {
        if (!candidateId) return;
        const unsub = onSnapshot(doc(db, 'candidates', candidateId), (doc) => {
            if (doc.exists()) {
                setCandidate({ id: doc.id, ...doc.data() } as Candidate);
            } else {
                console.log("No such document!");
                setCandidate(null);
            }
            setLoading(false);
        });
        return () => unsub();
    }, [candidateId]);

    const handleAction = async (stage: string, action: string, payload: any) => {
        if (!candidate || !user) return;

        let updateData: Partial<Candidate> = {};
        const historyData = {
            candidateId,
            stage,
            status: '', // Will be set in the switch
            feedback: payload.feedback || '' ,
            scheduledDate: payload.scheduledDate || null,
            timeSlot: payload.timeSlot || null,
            updatedBy: user.uid,
            updatedAt: Timestamp.now(),
        };

        switch (stage) {
            case 'Resume Review':
                if (action === 'accept') {
                    updateData = { resumeReviewStatus: 'Accepted', l1Status: 'Pending' };
                    historyData.status = 'Accepted';
                } else { // reject
                    updateData = { resumeReviewStatus: 'Rejected', finalStatus: 'Rejected', l1Status: 'Locked', l2Status: 'Locked', hrStatus: 'Locked', offerStatus: 'Locked' };
                    historyData.status = 'Rejected';
                }
                break;
            case 'L1 Interview':
                if (action === 'schedule') {
                    updateData = { l1Status: 'Scheduled', l1ScheduledDate: payload.scheduledDate, l1TimeSlot: payload.timeSlot };
                    historyData.status = 'Scheduled';
                } else if (action === 'select') {
                    updateData = { l1Status: 'Selected', l1Feedback: payload.feedback, l2Status: 'Pending' };
                    historyData.status = 'Selected';
                } else { // reject
                    updateData = { l1Status: 'Rejected', l1Feedback: payload.feedback, finalStatus: 'Rejected', l2Status: 'Locked', hrStatus: 'Locked', offerStatus: 'Locked' };
                    historyData.status = 'Rejected';
                }
                break;
            case 'L2 Interview':
                 if (action === 'schedule') {
                    updateData = { l2Status: 'Scheduled', l2ScheduledDate: payload.scheduledDate, l2TimeSlot: payload.timeSlot };
                     historyData.status = 'Scheduled';
                } else if (action === 'select') {
                    updateData = { l2Status: 'Selected', l2Feedback: payload.feedback, hrStatus: 'Pending' };
                    historyData.status = 'Selected';
                } else { // reject
                    updateData = { l2Status: 'Rejected', l2Feedback: payload.feedback, finalStatus: 'Rejected', hrStatus: 'Locked', offerStatus: 'Locked' };
                    historyData.status = 'Rejected';
                }
                break;
            case 'HR Round':
                if (action === 'schedule') {
                    updateData = { hrStatus: 'Scheduled', hrScheduledDate: payload.scheduledDate, hrTimeSlot: payload.timeSlot };
                    historyData.status = 'Scheduled';
                } else if (action === 'select') {
                    updateData = { hrStatus: 'Selected', hrFeedback: payload.feedback, offerStatus: 'Pending' };
                    historyData.status = 'Selected';
                } else { // reject
                    updateData = { hrStatus: 'Rejected', hrFeedback: payload.feedback, finalStatus: 'Rejected', offerStatus: 'Locked' };
                    historyData.status = 'Rejected';
                }
                break;
            case 'Offer Stage':
                if (action === 'release-offer') {
                    updateData = { offerStatus: 'Released' };
                    historyData.status = 'Released';
                } else if (action === 'offer-accept') {
                    updateData = { offerStatus: 'Accepted', offerFeedback: payload.feedback, finalStatus: 'Completed' };
                    historyData.status = 'Accepted';
                } else { // offer-reject
                    updateData = { offerStatus: 'Rejected', offerFeedback: payload.feedback, finalStatus: 'Rejected' };
                    historyData.status = 'Rejected';
                }
                break;
        }

        try {
            await updateDoc(doc(db, 'candidates', candidate.id), { ...updateData, lastUpdated: Timestamp.now() });
            await addDoc(collection(db, 'candidate_history'), historyData);
        } catch (error) {
            console.error("Failed to update candidate or history:", error);
        }
    };

    if (loading) return <div style={{ fontFamily: 'Segoe UI, system-ui', background: '#F5F6FA', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading Candidate...</div>;
    if (!candidate) return <div style={{ fontFamily: 'Segoe UI, system-ui', background: '#F5F6FA', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Candidate not found.</div>;

    const getStatus = (status: Status | undefined): Status => status || 'Pending';

    const resumeReviewStatus = getStatus(candidate.resumeReviewStatus);
    const l1Status = getStatus(candidate.l1Status);
    const l2Status = getStatus(candidate.l2Status);
    const hrStatus = getStatus(candidate.hrStatus);
    const offerStatus = getStatus(candidate.offerStatus);

    const lockedStates = {
        l1: resumeReviewStatus !== 'Accepted',
        l2: l1Status !== 'Selected',
        hr: l2Status !== 'Selected',
        offer: hrStatus !== 'Selected',
    };

    const stageDefs: StageCardProps[] = [
        { title: 'Resume Review', status: resumeReviewStatus, isLocked: false, savedFeedback: candidate.resumeFeedback, onAction: (a, p) => handleAction('Resume Review', a, p), isResume: true, canUpdate: true, role },
        { title: 'L1 Interview', status: l1Status, isLocked: lockedStates.l1, scheduledDate: candidate.l1ScheduledDate, timeSlot: candidate.l1TimeSlot, savedFeedback: candidate.l1Feedback, onAction: (a, p) => handleAction('L1 Interview', a, p), canUpdate: true, role },
        { title: 'L2 Interview', status: l2Status, isLocked: lockedStates.l2, scheduledDate: candidate.l2ScheduledDate, timeSlot: candidate.l2TimeSlot, savedFeedback: candidate.l2Feedback, onAction: (a, p) => handleAction('L2 Interview', a, p), canUpdate: true, role },
        { title: 'HR Round', status: hrStatus, isLocked: lockedStates.hr, scheduledDate: candidate.hrScheduledDate, timeSlot: candidate.hrTimeSlot, savedFeedback: candidate.hrFeedback, onAction: (a, p) => handleAction('HR Round', a, p), canUpdate: true, role },
        { title: 'Offer Stage', status: offerStatus, isLocked: lockedStates.offer, savedFeedback: candidate.offerFeedback, onAction: (a, p) => handleAction('Offer Stage', a, p), isOffer: true, canUpdate: true, role },
    ];

    return (
        <div style={{ fontFamily: 'Segoe UI, system-ui', background: '#F5F6FA', padding: '24px' }}>
             <Button onClick={() => router.back()} variant="ghost" className="mb-4">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to History
            </Button>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '24px' }}>
                {/* Left Column */}
                <div style={{ background: 'white', borderRadius: '14px', border: '1.5px solid #E5E7EB', padding: '24px' }}>
                     <h2 style={{ fontWeight: 'bold', fontSize: '17px', margin: '0 0 20px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>📋 Interview Workflow</h2>
                    <div className="space-y-4">
                        {stageDefs.map(stage => <StageCard key={stage.title} {...stage} />)}
                    </div>
                </div>

                {/* Right Column */}
                <div className="space-y-6">
                    <Card>
                        <CardHeader><CardTitle>Candidate Details</CardTitle></CardHeader>
                        <CardContent className="space-y-2">
                            <p className="font-bold text-lg">{candidate.candidateName}</p>
                            <a href={`mailto:${candidate.candidateEmail}`} className="text-sm text-blue-600">{candidate.candidateEmail}</a>
                            <p className="text-sm">{candidate.candidatePhone}</p>
                            <p className="text-sm text-gray-500">{candidate.candidateDesignation}</p>
                            {candidate.resumeUrl && <Button asChild variant="outline" className="w-full mt-2"><a href={candidate.resumeUrl} target="_blank" rel="noopener noreferrer"><Download className="mr-2 h-4 w-4"/>Download Resume</a></Button>}
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader><CardTitle>Agency Details</CardTitle></CardHeader>
                        <CardContent>
                            <p className="text-sm font-semibold">{candidate.createdByName}</p>
                            <p className="text-sm text-gray-500">{candidate.createdByRole}</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader><CardTitle>Overall Status</CardTitle></CardHeader>
                        <CardContent>
                            <Badge className={normalizeStatus(candidate.finalStatus).color}>{normalizeStatus(candidate.finalStatus).name}</Badge>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
