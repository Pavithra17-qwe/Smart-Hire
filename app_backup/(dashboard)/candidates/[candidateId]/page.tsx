
'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { doc, onSnapshot, updateDoc, addDoc, collection, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Calendar, Download, Lock } from 'lucide-react';

// --- TYPE DEFINITIONS ---
type Status = 'Pending' | 'Accepted' | 'Rejected' | 'Scheduled' | 'Selected' | 'Offer Sent' | 'Joined' | 'In Progress';

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
    offerSent?: boolean;
    onAction: (action: string, payload: any) => void;
    isResume?: boolean;
    isOffer?: boolean;
    joinDate?: string;
}

interface Candidate {
    id: string;
    candidateName: string;
    candidateEmail: string;
    candidatePhone: string;
    candidateDesignation: string;
    resumeUrl?: string;
    createdByName: string;
    createdByRole: string;
    overallStatus: Status;
    resumeStatus: Status;
    resumeFeedback?: string;
    l1Status: Status;
    l1ScheduledDate?: string;
    l1TimeSlot?: string;
    l1Feedback?: string;
    l2Status: Status;
    l2ScheduledDate?: string;
    l2TimeSlot?: string;
    l2Feedback?: string;
    hrRoundStatus: Status;
    hrScheduledDate?: string;
    hrTimeSlot?: string;
    hrFeedback?: string;
    offerStatus: Status;
    offerSent?: boolean;
    offerFeedback?: string;
    offerJoiningDate?: string;
    lastUpdated: Timestamp;
}

// --- HELPER FUNCTIONS ---
const statusVariant = (status: Status | undefined) => {
    const s = status?.toLowerCase() || '';
    if (['accepted', 'selected', 'joined'].includes(s)) return 'default';
    if (s === 'rejected') return 'destructive';
    if (['scheduled', 'pending', 'offer sent'].includes(s)) return 'secondary';
    return 'outline';
};

// --- SUB-COMPONENTS ---

const ProposeTime: React.FC<ProposeTimeProps> = ({ onPropose }) => {
    const [date, setDate] = useState('');
    const [slot, setSlot] = useState('');

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
                <div style={{ position: 'relative', flex: 1 }}>
                    <Calendar className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="pl-10" style={{ background: 'white', borderRadius: '8px' }}/>
                </div>
                <select value={slot} onChange={(e) => setSlot(e.target.value)} style={{ borderRadius: '8px', border: '1px solid #E5E7EB', padding: '9px', background: 'white', flex: 1 }}>
                    <option value="">Select a slot</option>
                    {timeSlots.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <Button onClick={handlePropose} style={{ background: '#7C3AED', color: 'white', fontWeight: 'bold' }}>Propose</Button>
            </div>
        </div>
    );
};

const StageCard: React.FC<StageCardProps> = ({ title, status, isLocked, scheduledDate, timeSlot, savedFeedback, offerSent, onAction, isResume = false, isOffer = false, joinDate: initialJoinDate }) => {
    const [feedback, setFeedback] = useState('');
    const [postFeedback, setPostFeedback] = useState('');
    const [joinDate, setJoinDate] = useState(initialJoinDate || '');

    const isActive = !isLocked && ['Pending', 'Accepted', 'Scheduled', 'Offer Sent'].includes(status);

    const cardStyle = {
        borderRadius: '12px',
        border: `1.5px solid ${isActive ? '#7C3AED' : '#E5E7EB'}`,
        boxShadow: isActive ? '0 2px 10px rgba(124,58,237,0.08)' : 'none',
        background: 'white',
    };

    return (
        <div style={cardStyle}>
            <div style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontWeight: 'bold', fontSize: '15px', margin: 0 }}>{title}</h3>
                <Badge variant={statusVariant(status)}>{status}</Badge>
            </div>
            <div style={{ padding: '0 16px 16px 16px' }}>
                {isLocked ? (
                    <div className="flex items-center gap-2 text-gray-500 text-sm">
                        <Lock className="h-4 w-4" />
                        <p>Complete the previous stage to unlock this step.</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {isResume && status === 'Pending' && (
                            <>
                                <Textarea placeholder="Enter feedback (optional)..." value={feedback} onChange={e => setFeedback(e.target.value)} />
                                <div className="flex justify-end gap-2">
                                    <Button variant="destructive" onClick={() => onAction('reject', { feedback })}>✕ Reject</Button>
                                    <Button variant="default" onClick={() => onAction('accept', { feedback })}>✓ Accept</Button>
                                </div>
                            </>
                        )}
                        {(isResume && (status === 'Accepted' || status === 'Rejected')) && <p className={`text-sm ${status === 'Rejected' ? 'text-red-600' : 'text-gray-600'}`}>{savedFeedback || 'No feedback provided.'}</p>}

                        {!isResume && !isOffer && (
                            <>
                                {status === 'Accepted' && <ProposeTime onPropose={(date, slot) => onAction('schedule', { scheduledDate: date, timeSlot: slot })} />}
                                {status === 'Scheduled' && scheduledDate && (
                                    <>
                                        <p className="text-sm font-semibold">Scheduled on: {new Date(scheduledDate).toLocaleDateString()} at {timeSlot}</p>
                                        <Textarea placeholder="Enter interview feedback..." value={postFeedback} onChange={e => setPostFeedback(e.target.value)} />
                                        <div className="flex justify-end gap-2">
                                            <Button variant="destructive" onClick={() => onAction('reject', { feedback: postFeedback })}>✕ Reject</Button>
                                            <Button variant="default" onClick={() => onAction('select', { feedback: postFeedback })}>✓ Select</Button>
                                        </div>
                                    </>
                                )}
                                {(status === 'Selected' || status === 'Rejected') && (
                                    <div className={`text-sm ${status === 'Rejected' ? 'text-red-600' : 'text-gray-600'}`}>
                                        {scheduledDate && <p className="font-semibold">Scheduled on: {new Date(scheduledDate).toLocaleDateString()} at {timeSlot}</p>}
                                        <p>{savedFeedback || 'No feedback provided.'}</p>
                                    </div>
                                )}
                            </>
                        )}

                        {isOffer && (
                            <>
                                {status === 'Accepted' && !offerSent && <div className="flex justify-end"><Button onClick={() => onAction('send-offer', {})} style={{ background: '#7C3AED', color: 'white' }}>📨 Send Offer</Button></div>}
                                {status === 'Offer Sent' && (
                                    <>
                                        <p className="text-sm font-semibold text-blue-600">📨 Offer sent to candidate</p>
                                        <Input type="date" value={joinDate} onChange={e => setJoinDate(e.target.value)} placeholder="Joining Date" />
                                        <Textarea placeholder="Enter feedback..." value={postFeedback} onChange={e => setPostFeedback(e.target.value)} />
                                        <div className="flex justify-end gap-2">
                                            <Button variant="destructive" onClick={() => onAction('offer-reject', { feedback: postFeedback, joinDate })}>✕ Mark Rejected</Button>
                                            <Button variant="default" onClick={() => onAction('offer-accept', { feedback: postFeedback, joinDate })}>✓ Mark Accepted</Button>
                                        </div>
                                    </>
                                )}
                                {(status === 'Joined' || status === 'Rejected') && savedFeedback && (
                                    <p className={`text-sm font-semibold ${status === 'Joined' ? 'text-green-600' : 'text-red-600'}`}>
                                        {status === 'Joined' && joinDate ? `🎉 Candidate accepted the offer. Joining on ${new Date(joinDate).toLocaleDateString()}. ` : ''}
                                        {status === 'Rejected' ? 'Candidate rejected the offer. ' : ''}
                                        {savedFeedback}
                                    </p>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default function CandidatePage({ params }: any) {
    const { candidateId } = params;
    const [candidate, setCandidate] = useState<Candidate | null>(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();

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
        if (!candidate) return;

        let updateData: Partial<Candidate> = {};
        const historyData = {
            candidateId,
            candidateName: candidate.candidateName,
            stage,
            action: action.charAt(0).toUpperCase() + action.slice(1).replace('-', ' '),
            feedback: payload.feedback || '' ,
            scheduledDate: payload.scheduledDate || null,
            timeSlot: payload.timeSlot || null,
            joinDate: payload.joinDate || null,
            timestamp: Timestamp.now(),
        };

        switch (stage) {
            case 'Resume Review':
                if (action === 'accept') {
                    updateData = { resumeStatus: 'Accepted', resumeFeedback: payload.feedback, l1Status: 'Accepted', overallStatus: 'In Progress' };
                } else { // reject
                    updateData = { resumeStatus: 'Rejected', resumeFeedback: payload.feedback, overallStatus: 'Rejected' };
                }
                break;
            case 'L1 Interview':
                if (action === 'schedule') {
                    updateData = { l1Status: 'Scheduled', l1ScheduledDate: payload.scheduledDate, l1TimeSlot: payload.timeSlot };
                } else if (action === 'select') {
                    updateData = { l1Status: 'Selected', l1Feedback: payload.feedback, l2Status: 'Accepted' };
                } else { // reject
                    updateData = { l1Status: 'Rejected', l1Feedback: payload.feedback, overallStatus: 'Rejected' };
                }
                break;
            case 'L2 Interview':
                 if (action === 'schedule') {
                    updateData = { l2Status: 'Scheduled', l2ScheduledDate: payload.scheduledDate, l2TimeSlot: payload.timeSlot };
                } else if (action === 'select') {
                    updateData = { l2Status: 'Selected', l2Feedback: payload.feedback, hrRoundStatus: 'Accepted' };
                } else { // reject
                    updateData = { l2Status: 'Rejected', l2Feedback: payload.feedback, overallStatus: 'Rejected' };
                }
                break;
            case 'HR Round':
                if (action === 'schedule') {
                    updateData = { hrRoundStatus: 'Scheduled', hrScheduledDate: payload.scheduledDate, hrTimeSlot: payload.timeSlot };
                } else if (action === 'select') {
                    updateData = { hrRoundStatus: 'Selected', hrFeedback: payload.feedback, offerStatus: 'Accepted' };
                } else { // reject
                    updateData = { hrRoundStatus: 'Rejected', hrFeedback: payload.feedback, overallStatus: 'Rejected' };
                }
                break;
            case 'Offer Stage':
                if (action === 'send-offer') {
                    updateData = { offerStatus: 'Offer Sent', offerSent: true };
                } else if (action === 'offer-accept') {
                    updateData = { offerStatus: 'Joined', offerFeedback: payload.feedback, offerJoiningDate: payload.joinDate, overallStatus: 'Joined' };
                } else { // offer-reject
                    updateData = { offerStatus: 'Rejected', offerFeedback: payload.feedback, overallStatus: 'Rejected' };
                }
                break;
        }

        try {
            await updateDoc(doc(db, 'candidates', candidate.id), { ...updateData, lastUpdated: Timestamp.now() });
            await addDoc(collection(db, 'candidateHistory'), historyData);
        } catch (error) {
            console.error("Failed to update candidate or history:", error);
        }
    };

    if (loading) return <div style={{ fontFamily: 'Segoe UI, system-ui', background: '#F5F6FA', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading Candidate...</div>;
    if (!candidate) return <div style={{ fontFamily: 'Segoe UI, system-ui', background: '#F5F6FA', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Candidate not found.</div>;

    const lockedStates = {
        l1: !['Accepted', 'Scheduled', 'Selected', 'Rejected'].includes(candidate.l1Status),
        l2: !['Accepted', 'Scheduled', 'Selected', 'Rejected'].includes(candidate.l2Status),
        hr: !['Accepted', 'Scheduled', 'Selected', 'Rejected'].includes(candidate.hrRoundStatus),
        offer: !['Accepted', 'Offer Sent', 'Joined', 'Rejected'].includes(candidate.offerStatus),
    };

    const stageDefs: StageCardProps[] = [
        { title: 'Resume Review', status: candidate.resumeStatus, isLocked: false, savedFeedback: candidate.resumeFeedback, onAction: (a, p) => handleAction('Resume Review', a, p), isResume: true },
        { title: 'L1 Interview', status: candidate.l1Status, isLocked: lockedStates.l1, scheduledDate: candidate.l1ScheduledDate, timeSlot: candidate.l1TimeSlot, savedFeedback: candidate.l1Feedback, onAction: (a, p) => handleAction('L1 Interview', a, p) },
        { title: 'L2 Interview', status: candidate.l2Status, isLocked: lockedStates.l2, scheduledDate: candidate.l2ScheduledDate, timeSlot: candidate.l2TimeSlot, savedFeedback: candidate.l2Feedback, onAction: (a, p) => handleAction('L2 Interview', a, p) },
        { title: 'HR Round', status: candidate.hrRoundStatus, isLocked: lockedStates.hr, scheduledDate: candidate.hrScheduledDate, timeSlot: candidate.hrTimeSlot, savedFeedback: candidate.hrFeedback, onAction: (a, p) => handleAction('HR Round', a, p) },
        { title: 'Offer Stage', status: candidate.offerStatus, isLocked: lockedStates.offer, offerSent: candidate.offerSent, savedFeedback: candidate.offerFeedback, onAction: (a, p) => handleAction('Offer Stage', a, p), isOffer: true, joinDate: candidate.offerJoiningDate },
    ];

    return (
        <div style={{ fontFamily: 'Segoe UI, system-ui', background: '#F5F6FA', padding: '24px' }}>
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
                            <Badge variant={statusVariant(candidate.overallStatus)}>{candidate.overallStatus}</Badge>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
