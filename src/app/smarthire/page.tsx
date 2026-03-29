
'use client';
import React, { useState, CSSProperties } from 'react';

interface StyleDictionary {
    [key: string]: CSSProperties;
}

const pageStyles: CSSProperties = {
    fontFamily: 'Segoe UI, system-ui, sans-serif',
    backgroundColor: '#F5F6FA',
    display: 'flex',
    minHeight: '100vh',
};

// --- STYLES ---
const styles: StyleDictionary = {
    // Sidebar
    sidebar: {
        width: '220px',
        backgroundColor: '#FFFFFF',
        borderRight: '1px solid #E5E7EB',
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column',
    },
    logo: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '0 8px 24px 8px',
    },
    logoIcon: { color: '#7C3AED', fontSize: '24px', fontWeight: 'bold' },
    logoText: { fontWeight: 'bold', fontSize: '18px', color: '#1F2937' },
    nav: { display: 'flex', flexDirection: 'column', gap: '4px' },
    navItem: {
        padding: '10px 12px',
        borderRadius: '8px',
        fontWeight: '600',
        fontSize: '14px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '10px'
    },
    userProfile: {
        marginTop: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '12px 8px',
        borderTop: '1px solid #F3F4F6'
    },
    userAvatar: {
        width: '36px',
        height: '36px',
        borderRadius: '50%',
        backgroundColor: '#EDE9FE',
        color: '#7C3AED',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 'bold',
    },
    // Main Content
    mainContent: {
        flex: 1,
        padding: '24px 32px',
    },
    // Detail Page Layout
    detailLayout: {
        display: 'flex',
        gap: '24px',
    },
    leftPanel: {
        width: '280px',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
    },
    rightPanel: {
        flex: 1,
    },
    // Cards
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: '14px',
        border: '1.5px solid #E5E7EB',
    },
    // Buttons
    button: {
        borderRadius: '8px',
        padding: '8px 16px',
        fontWeight: '600',
        fontSize: '14px',
        cursor: 'pointer',
        border: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px'
    },
    // Badges
    badge: {
        borderRadius: '9999px',
        padding: '4px 12px',
        fontSize: '12px',
        fontWeight: '600',
    },
};

// --- TYPE DEFINITIONS ---
interface Candidate {
    id: number;
    name: string;
    role: string;
    email: string;
    phone: string;
    avatar: string | null;
    overallStatus: string;
    resumeStatus: string;
    l1Status: string;
    l2Status: string;
    hrStatus: string;
    offerStatus: string;
    resumeFeedback: string;
    l1Date: string | null;
    l1Slot: string | null;
    l1Feedback: string;
    l2Date: string | null;
    l2Slot: string | null;
    l2Feedback: string;
    hrDate: string | null;
    hrSlot: string | null;
    hrFeedback: string;
    joinDate: string | null;
    offerFeedback: string;
}

interface Stage {
    name: string;
    statusField: keyof Candidate;
    feedbackField: keyof Candidate;
    dateField?: keyof Candidate;
    slotField?: keyof Candidate;
}

interface HistoryEntry {
    candidateId: number;
    candidateName: string;
    stage: string;
    action: string;
    timestamp: string;
    feedback: string;
    scheduledDate: string | null;
    timeSlot: string | null;
    joinDate: string | null;
}

// --- SUB-COMPONENTS ---

const ProposeTime: React.FC<{ onPropose: (date: string, slot: string) => void; disabled?: boolean }> = ({ onPropose, disabled }) => {
    const [date, setDate] = useState('');
    const [slot, setSlot] = useState('');

    const handlePropose = () => {
        if (!date || !slot) {
            alert('Please select a date and a time slot.');
            return;
        }
        onPropose(date, slot);
    };

    const timeSlots = [
        "09:00am - 10:00am", "10:00am - 11:00am", "11:00am - 12:00pm",
        "01:00pm - 02:00pm", "02:00pm - 03:00pm", "03:00pm - 04:00pm", "04:00pm - 05:00pm"
    ];

    return (
        <div style={{ backgroundColor: '#F9FAFB', borderRadius: '10px', padding: '16px' }}>
            <p style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '12px' }}>Propose Interview Time</p>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={disabled} style={{
                    ...styles.card,
                    padding: '8px',
                    width: '130px',
                    fontSize: '13px'
                }} />
                <select value={slot} onChange={(e) => setSlot(e.target.value)} disabled={disabled} style={{
                    ...styles.card,
                    padding: '8px',
                    flex: 1,
                    fontSize: '13px'
                }}>
                    <option value="">Select a slot</option>
                    {timeSlots.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button
                    onClick={handlePropose}
                    disabled={disabled}
                    style={{ ...styles.button, backgroundColor: '#7C3AED', color: 'white' }}
                >
                    Propose
                </button>
            </div>
        </div>
    );
};

const StageCard: React.FC<{ stage: Stage; candidate: Candidate; onAction: (stageName: string, action: string, payload: any) => void; isActive: boolean }> = ({ stage, candidate, onAction, isActive }) => {
    const [feedback, setFeedback] = useState('');
    const [joinDate, setJoinDate] = useState('');

    const stageStatus = candidate[stage.statusField] as string;

    const handleAction = (action: string, payload: any) => {
        onAction(stage.name, action, payload);
    };

    const statusColors: { [key: string]: { bg: string; text: string } } = {
        pending: { bg: '#F3F4F6', text: '#4B5563' },
        accepted: { bg: '#DCFCE7', text: '#16A34A' },
        rejected: { bg: '#FEE2E2', text: '#DC2626' },
        scheduled: { bg: '#DBEAFE', text: '#2563EB' },
        selected: { bg: '#DCFCE7', text: '#16A34A' },
        locked: { bg: '#F3F4F6', text: '#6B7280' },
        'offer-sent': { bg: '#DBEAFE', text: '#1E40AF' },
        joined: { bg: '#D1FAE5', text: '#065F46' },
    };

    const cardStyle: CSSProperties = {
        ...styles.card,
        borderLeft: `3px solid ${isActive ? '#7C3AED' : 'transparent'}`,
        boxShadow: isActive ? '0 2px 10px rgba(124,58,237,0.08)' : 'none',
        opacity: stageStatus === 'locked' ? 0.8 : 1,
    };

    return (
        <div style={cardStyle}>
            <div style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p style={{ fontWeight: 'bold', fontSize: '15px' }}>{stage.name}</p>
                <span style={{ ...styles.badge, backgroundColor: statusColors[stageStatus]?.bg, color: statusColors[stageStatus]?.text }}>
                    {stageStatus}
                </span>
            </div>

            <div style={{ padding: '0 16px 16px 16px' }}>
                {stageStatus === 'pending' && stage.name === 'Resume Review' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <textarea
                            placeholder="Enter feedback (optional)..."
                            value={feedback}
                            onChange={e => setFeedback(e.target.value)}
                            style={{ ...styles.card, padding: '10px', minHeight: '80px', resize: 'vertical' }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                            <button onClick={() => handleAction('reject', { feedback })} style={{ ...styles.button, backgroundColor: '#FEE2E2', color: '#DC2626' }}>✕ Reject</button>
                            <button onClick={() => handleAction('accept', { feedback })} style={{ ...styles.button, backgroundColor: '#DCFCE7', color: '#16A34A' }}>✓ Accept</button>
                        </div>
                    </div>
                )}

                {stageStatus === 'accepted' && ['L1 Interview', 'L2 Interview', 'HR Round'].includes(stage.name) && (
                     <ProposeTime onPropose={(date, slot) => handleAction('propose', { scheduledDate: date, timeSlot: slot })} />
                )}

                {stageStatus === 'scheduled' && stage.dateField && stage.slotField && (
                     <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <p style={{ fontSize: '14px', color: '#374151' }}>
                            Scheduled on: <strong>{new Date(candidate[stage.dateField] as string).toLocaleDateString()}</strong> at <strong>{candidate[stage.slotField] as string}</strong>
                        </p>
                        <textarea
                            placeholder="Enter interview feedback..."
                            value={feedback}
                            onChange={e => setFeedback(e.target.value)}
                            style={{ ...styles.card, padding: '10px', minHeight: '80px', resize: 'vertical' }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                            <button onClick={() => handleAction('reject', { feedback })} style={{ ...styles.button, backgroundColor: '#FEE2E2', color: '#DC2626' }}>✕ Reject</button>
                            <button onClick={() => handleAction('select', { feedback })} style={{ ...styles.button, backgroundColor: '#DCFCE7', color: '#16A34A' }}>✓ Select</button>
                        </div>
                    </div>
                )}

                {stageStatus === 'accepted' && stage.name === 'Offer Stage' && (
                    <div style={{display: 'flex', justifyContent: 'flex-end'}}>
                        <button onClick={() => handleAction('send-offer', {})} style={{ ...styles.button, backgroundColor: '#7C3AED', color: 'white' }}>📨 Send Offer</button>
                    </div>
                )}
                
                {stageStatus === 'offer-sent' && (
                     <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <p style={{ fontSize: '14px', color: '#1E40AF', fontWeight: '600' }}>📨 Offer sent to candidate</p>
                        <input type="date" value={joinDate} onChange={e => setJoinDate(e.target.value)} style={{...styles.card, padding: '8px' }} placeholder="Joining Date"/>
                        <textarea
                            placeholder="Enter feedback..."
                            value={feedback}
                            onChange={e => setFeedback(e.target.value)}
                            style={{ ...styles.card, padding: '10px', minHeight: '60px', resize: 'vertical' }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                             <button onClick={() => handleAction('offer-reject', { feedback })} style={{ ...styles.button, backgroundColor: '#FEE2E2', color: '#DC2626' }}>✕ Mark Rejected</button>
                            <button onClick={() => handleAction('offer-accept', { feedback, joinDate })} style={{ ...styles.button, backgroundColor: '#DCFCE7', color: '#16A34A' }}>✓ Mark Accepted</button>
                        </div>
                    </div>
                )}

                {['accepted', 'rejected', 'selected', 'joined'].includes(stageStatus) && candidate[stage.feedbackField] && (
                     <p style={{ fontStyle: 'italic', color: '#6B7280', fontSize: '14px' }}>Feedback: {candidate[stage.feedbackField] as string}</p>
                )}
                 {stageStatus === 'joined' && candidate.joinDate && (
                      <p style={{ fontWeight: '600', color: '#065F46', fontSize: '14px' }}>🎉 Candidate accepted the offer. Joining on {new Date(candidate.joinDate).toLocaleDateString()}.</p>
                 )}

            </div>
        </div>
    );
};

// --- MAIN COMPONENT ---

export default function SmartHire() {
    const [view, setView] = useState('list'); // 'list', 'details', 'history'
    const [candidates, setCandidates] = useState<Candidate[]>([
        {
            id: 1,
            name: 'Aisiri Achary',
            role: 'Senior Frontend Developer',
            email: 'aisiri@qaoncloud.com',
            phone: '8296550023',
            avatar: null,
            overallStatus: 'In Progress',
            // Stage statuses
            resumeStatus: 'pending',
            l1Status: 'locked',
            l2Status: 'locked',
            hrStatus: 'locked',
            offerStatus: 'locked',
            // Stage data
            resumeFeedback: '',
            l1Date: null, l1Slot: null, l1Feedback: '',
            l2Date: null, l2Slot: null, l2Feedback: '',
            hrDate: null, hrSlot: null, hrFeedback: '',
            joinDate: null, offerFeedback: '',
        }
    ]);
    const [selectedCandidateId, setSelectedCandidateId] = useState<number | null>(null);
    const [history, setHistory] = useState<HistoryEntry[]>([]);

    const handleAction = (stageName: string, action: string, payload: any) => {
        setCandidates(prev => prev.map(c => {
            if (c.id !== selectedCandidateId) return c;

            let updatedCandidate = { ...c };
            const stageDef = STAGE_DEFS.find(s => s.name === stageName);
            if (!stageDef) return c;

            // Update status and data
            const status = stageActionToStatus[action as keyof typeof stageActionToStatus];
            if(status) {
                (updatedCandidate[stageDef.statusField] as any) = status;
            }
            if (payload?.feedback) (updatedCandidate[stageDef.feedbackField] as any) = payload.feedback;
            if (payload?.scheduledDate && stageDef.dateField) (updatedCandidate[stageDef.dateField] as any) = payload.scheduledDate;
            if (payload?.timeSlot && stageDef.slotField) (updatedCandidate[stageDef.slotField] as any) = payload.timeSlot;
            if (payload?.joinDate) updatedCandidate.joinDate = payload.joinDate;

            // Unlock next stage
            if (action === 'accept' || action === 'select') {
                const nextStageIndex = STAGE_DEFS.findIndex(s => s.name === stageName) + 1;
                const nextStage = STAGE_DEFS[nextStageIndex];
                if (nextStage) {
                    (updatedCandidate[nextStage.statusField] as any) = 'pending';
                }
            }
            
            // Log history
            const historyEntry: HistoryEntry = {
                candidateId: c.id,
                candidateName: c.name,
                stage: stageName,
                action,
                timestamp: new Date().toLocaleString(),
                feedback: payload?.feedback || '',
                scheduledDate: payload?.scheduledDate || null,
                timeSlot: payload?.timeSlot || null,
                joinDate: payload?.joinDate || null,
            };
            setHistory(prevHistory => [historyEntry, ...prevHistory]);

            return updatedCandidate;
        }));
    };
    
    const stageActionToStatus = {
        'accept': 'accepted', 'reject': 'rejected', 'propose': 'scheduled', 'select': 'selected',
        'send-offer': 'offer-sent', 'offer-accept': 'joined', 'offer-reject': 'rejected'
    };

    const STAGE_DEFS: Stage[] = [
        { name: 'Resume Review', statusField: 'resumeStatus', feedbackField: 'resumeFeedback' },
        { name: 'L1 Interview', statusField: 'l1Status', feedbackField: 'l1Feedback', dateField: 'l1Date', slotField: 'l1Slot' },
        { name: 'L2 Interview', statusField: 'l2Status', feedbackField: 'l2Feedback', dateField: 'l2Date', slotField: 'l2Slot' },
        { name: 'HR Round', statusField: 'hrStatus', feedbackField: 'hrFeedback', dateField: 'hrDate', slotField: 'hrSlot' },
        { name: 'Offer Stage', statusField: 'offerStatus', feedbackField: 'offerFeedback' },
    ];
    
    const selectedCandidate = candidates.find(c => c.id === selectedCandidateId);
    
    const Sidebar = () => (
        <div style={styles.sidebar}>
            <div style={styles.logo}>
                <span style={styles.logoIcon}>&#9883;</span>
                <span style={styles.logoText}>SmartHire</span>
            </div>
            <nav style={styles.nav}>
                <div onClick={() => setView('dashboard')} style={{ ...styles.navItem, color: view === 'dashboard' ? '#7C3AED' : '#374151', backgroundColor: view === 'dashboard' ? '#F5F3FF' : 'transparent' }}>Dashboard</div>
                <div onClick={() => { setView('list'); setSelectedCandidateId(null); }} style={{ ...styles.navItem, color: view === 'list' ? '#7C3AED' : '#374151', backgroundColor: view === 'list' ? '#F5F3FF' : 'transparent' }}>Candidate List</div>
                <div onClick={() => setView('history')} style={{ ...styles.navItem, color: view === 'history' ? '#7C3AED' : '#374151', backgroundColor: view === 'history' ? '#F5F3FF' : 'transparent' }}>Candidate History</div>
            </nav>
            <div style={styles.userProfile}>
                <div style={styles.userAvatar}>P</div>
                <div>
                    <p style={{ fontWeight: 'bold', fontSize: '14px', margin: 0 }}>Pavithra A</p>
                    <p style={{ fontSize: '12px', color: '#6B7280', margin: 0 }}>INTERVIEWER</p>
                </div>
            </div>
        </div>
    );

    const renderView = () => {
        switch (view) {
            case 'details':
                if (!selectedCandidate) return <p>Candidate not found.</p>;
                return (
                    <div style={styles.detailLayout}>
                        {/* Left Panel */}
                        <div style={styles.leftPanel}>
                            <div style={{ ...styles.card, border: '2px solid #7C3AED', padding: '24px', textAlign: 'center' }}>
                                 <div style={{...styles.userAvatar, width: '80px', height: '80px', margin: '0 auto 16px auto', fontSize: '32px', backgroundColor: '#EDE9FE'}}>&#128100;</div>
                                <p style={{ fontWeight: 'bold', fontSize: '17px', margin: '0 0 4px 0' }}>{selectedCandidate.name}</p>
                                <p style={{ fontSize: '13px', color: '#6B7280', margin: 0 }}>{selectedCandidate.role}</p>
                                <div style={{ marginTop: '16px' }}>
                                    <span style={{ ...styles.badge, backgroundColor: '#EDE9FE', color: '#7C3AED' }}>{selectedCandidate.overallStatus}</span>
                                </div>
                            </div>
                            <div style={styles.card}>
                                <div style={{ padding: '16px', borderBottom: '1.5px solid #E5E7EB' }}>
                                    <p style={{ fontWeight: 'bold', margin: 0 }}>Candidate Details</p>
                                </div>
                                <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    <div>
                                        <p style={{ textTransform: 'uppercase', fontSize: '11px', color: '#6B7280', margin: '0 0 4px 0' }}>Email</p>
                                        <p style={{ fontSize: '14px', margin: 0 }}>{selectedCandidate.email}</p>
                                    </div>
                                    <div>
                                        <p style={{ textTransform: 'uppercase', fontSize: '11px', color: '#6B7280', margin: '0 0 4px 0' }}>Phone</p>
                                        <p style={{ fontSize: '14px', margin: 0 }}>{selectedCandidate.phone}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                        {/* Right Panel */}
                        <div style={styles.rightPanel}>
                             <div style={{ ...styles.card, padding: '24px' }}>
                                <p style={{ fontWeight: 'bold', fontSize: '17px', margin: '0 0 20px 0' }}>📋 Interview Workflow</p>
                                <div style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
                                    {STAGE_DEFS.map(stage => {
                                        const status = selectedCandidate[stage.statusField] as string;
                                        const isActive = status !== 'locked' && !['rejected', 'selected', 'accepted', 'joined'].includes(status);
                                        return <StageCard key={stage.name} stage={stage} candidate={selectedCandidate} onAction={handleAction} isActive={isActive} />;
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                );
            case 'history':
                return (
                     <div style={styles.card}>
                        <div style={{ padding: '16px', borderBottom: '1.5px solid #E5E7EB' }}>
                            <p style={{ fontWeight: 'bold', margin: 0 }}>Candidate History</p>
                        </div>
                        {history.length === 0 ? (
                             <div style={{padding: '48px', textAlign: 'center', color: '#6B7280'}}>
                                 <span style={{fontSize: '48px'}}>📭</span>
                                 <p>No activity yet.</p>
                             </div>
                        ) : (
                             <table style={{width: '100%', borderCollapse: 'collapse'}}>
                                 <thead>
                                     <tr style={{borderBottom: '1.5px solid #E5E7EB', textAlign: 'left'}}>
                                         <th style={{padding: '12px 16px'}}>Candidate</th>
                                         <th style={{padding: '12px 16px'}}>Stage</th>
                                         <th style={{padding: '12px 16px'}}>Action</th>
                                         <th style={{padding: '12px 16px'}}>Timestamp</th>
                                         <th style={{padding: '12px 16px'}}></th>
                                     </tr>
                                 </thead>
                                 <tbody>
                                     {history.map((h, i) => (
                                         <tr key={i} style={{borderBottom: i < history.length -1 ? '1px solid #F3F4F6' : 'none'}}>
                                             <td style={{padding: '12px 16px'}}>{h.candidateName}</td>
                                             <td style={{padding: '12px 16px'}}>{h.stage}</td>
                                             <td style={{padding: '12px 16px'}}><span style={{ ...styles.badge, backgroundColor: '#EDE9FE', color: '#7C3AED' }}>{h.action}</span></td>
                                             <td style={{padding: '12px 16px', fontSize: '13px', color: '#6B7280'}}>{h.timestamp}</td>
                                             <td style={{padding: '12px 16px'}}>
                                                 <button onClick={() => {setSelectedCandidateId(h.candidateId); setView('details')}} style={{...styles.button, padding: '6px 12px', fontSize: '12px'}}>View Detail</button>
                                             </td>
                                         </tr>
                                     ))}
                                 </tbody>
                             </table>
                        )}
                    </div>
                );
            case 'list':
            default:
                return (
                     <div style={styles.card}>
                        <div style={{ padding: '16px', borderBottom: '1.5px solid #E5E7EB' }}>
                            <input type="search" placeholder="Search candidates..." style={{...styles.card, padding: '10px', width: '100%'}}/>
                        </div>
                        <div>
                             {candidates.map(c => (
                                 <div key={c.id} onClick={() => { setSelectedCandidateId(c.id); setView('details'); }} style={{ display: 'flex', alignItems: 'center', padding: '16px', borderBottom: '1px solid #F3F4F6', cursor: 'pointer' }}>
                                     <div style={{...styles.userAvatar, backgroundColor: '#EDE9FE', marginRight: '16px'}}>A</div>
                                     <div style={{flex: 1}}>
                                         <p style={{fontWeight: '600', margin: 0}}>{c.name}</p>
                                         <p style={{fontSize: '14px', color: '#6B7280', margin: 0}}>{c.email}</p>
                                     </div>
                                     <span style={{...styles.badge, backgroundColor: '#DBEAFE', color: '#2563EB', marginRight: '16px'}}>{c.overallStatus}</span>
                                     <span style={{color: '#9CA3AF', fontWeight: 'bold'}}>›</span>
                                 </div>
                             ))}
                        </div>
                    </div>
                );
        }
    };

    return (
        <div style={pageStyles}>
            <Sidebar />
            <main style={styles.mainContent}>
                {renderView()}
            </main>
        </div>
    );
}
