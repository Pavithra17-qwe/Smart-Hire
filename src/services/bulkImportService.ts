/**
 * bulkImportService.ts
 * ─────────────────────────────────────────────────────────────────────────
 * Server-side only. No React/JSX here — this file uses the Firebase Admin
 * SDK and must never be imported into a client component.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { getBaseUrl } from '@/lib/getBaseUrl';
import { adminDb } from '@/lib/firebaseAdmin';
import { Timestamp } from 'firebase-admin/firestore';
import { sendInterviewEmail } from '@/ai/flows/send-interview-email-flow';
import { candidateResumeExtraction } from '@/ai/flows/candidate-resume-extraction-flow';
import { candidateMatchScoring } from '@/ai/flows/candidate-match-scoring-flow';

export const ATS_PASS_THRESHOLD = 80;

export interface ParsedResumeData {
    candidateName: string;
    candidateEmail: string;
    candidatePhone?: string;
    candidateDesignation?: string;
    currentLocation?: string;      // ← NEW
    permanentLocation?: string;    // ← NEW
    isComfortableOnsite?: string;  // ← NEW
    skills?: string[];
    experience?: string;
    currentCtc?: string;
    expectedCtc?: string;
    noticePeriod?: string;
    currentCompany?: string;
}

export interface AtsResult {
    score: number;
    aiModel: string;
    summary?: string;
    hasJdComparison: boolean;
    projectName?: string;
}

export interface HistoryEntry {
    stage: string;
    timestamp: string;
    details?: Record<string, unknown>;
}

export interface ImportedCandidateResult {
    fileName: string;
    status: 'accepted' | 'rejected' | 'pending' | 'failed';
    candidateId?: string;
    candidateName?: string;
    candidateEmail?: string;
    candidatePhone?: string;
    atsScore?: number;
    atsSummary?: string;
    projectName?: string;
    finalStatus?: string;
    reason?: string;
    history: HistoryEntry[];
}

// ─────────────────────────────────────────────────────────────────────────
// Step 1 — Parse resume (unchanged flow, just wired with fileType)
// ─────────────────────────────────────────────────────────────────────────
async function parseResume(fileBuffer: Buffer, fileName: string, fileType: string): Promise<ParsedResumeData> {
    console.log(`[BulkImport] Resume parsing started: ${fileName}`);
    const extracted = await candidateResumeExtraction({
        fileName,
        fileType,
        fileDataB64: fileBuffer.toString('base64'),
    });
    console.log(`[BulkImport] Resume parsed: ${fileName}`);

    return {
        candidateName: extracted.candidateName || fileName.replace(/\.[^.]+$/, ''),
        candidateEmail: extracted.candidateEmail || '',
        candidatePhone: extracted.phoneNumber,
        skills: extracted.skills,
        experience: extracted.experience,
        currentCtc: extracted.currentCtc,
        expectedCtc: extracted.expectedCtc,
        noticePeriod: extracted.noticePeriod,
        currentCompany: extracted.currentCompany,
        currentLocation: extracted.currentLocation,
permanentLocation: extracted.permanentLocation,
isComfortableOnsite: extracted.isComfortableOnsite,
    };
}

// ─────────────────────────────────────────────────────────────────────────
// Fallback score used only when there's no JD to compare against, OR when
// the real AI scoring call itself fails. This is a completeness heuristic,
// NOT an ATS match score — candidates scored this way always go to
// Pending Review (see hasJdComparison in processSingleResume below).
// ─────────────────────────────────────────────────────────────────────────
function calculateResumeQualityScore(parsed: ParsedResumeData, reasonSuffix: string): AtsResult {
    const checks: boolean[] = [
        !!parsed.candidateName,
        !!parsed.candidateEmail,
        !!parsed.candidatePhone,
        !!parsed.experience,
        !!parsed.currentCtc,
        !!parsed.expectedCtc,
        !!parsed.noticePeriod,
        !!parsed.currentCompany,
        !!(parsed.skills && parsed.skills.length > 0),
    ];

    const filled = checks.filter(Boolean).length;
    const score = Math.round((filled / checks.length) * 100);

    return {
        score,
        aiModel: 'heuristic (resume-completeness)',
        summary: reasonSuffix,
        hasJdComparison: false,
    };
}

// ─────────────────────────────────────────────────────────────────────────
// Step 2 — Score against JD using the exact same candidateMatchScoring flow
// (same Gemini prompt) that Single Candidate Upload uses.
// ─────────────────────────────────────────────────────────────────────────
async function calculateAtsScore(
    parsed: ParsedResumeData,
    fileBuffer: Buffer,
    fileType: string,
    jobRequisitionId?: string,
    prefetchedProject?: any 
    
): Promise<AtsResult> {
    if (!jobRequisitionId) {
        return calculateResumeQualityScore(
            parsed,
            'No project selected during import. Candidate requires manual HR review.'
        );
    }

    const reqSnap = await adminDb.collection('job_requisitions').doc(jobRequisitionId).get();
    if (!reqSnap.exists) {
        return calculateResumeQualityScore(
            parsed,
            `Selected job requisition (${jobRequisitionId}) was not found. Candidate requires manual HR review.`
        );
    }


    let project = prefetchedProject;
    if (!project) {
        const reqSnap = await adminDb.collection('job_requisitions').doc(jobRequisitionId).get();
        if (!reqSnap.exists) {
            return calculateResumeQualityScore(
                parsed,
                `Selected job requisition (${jobRequisitionId}) was not found. Candidate requires manual HR review.`
            );
        }
        project = reqSnap.data() as any;
    }
    const projectName: string = project.projectName || '';

    const hasManualText = !!project.jdFileData?.trim() && project.jdFileType === 'manual';
    const hasJdText = !!project.jdText?.trim();
    const hasJdFile = !!project.jdFileDataB64;
    const hasJdFileData = !!project.jdFileData && project.jdFileType !== 'manual';

    if (!hasManualText && !hasJdText && !hasJdFile && !hasJdFileData) {
        return {
            ...calculateResumeQualityScore(
                parsed,
                'No Job Description available for this project. Candidate requires manual HR review.'
            ),
            projectName,
        };
    }

    const resolvedJdText =
        project.jdText?.trim() ||
        (project.jdFileType === 'manual' ? project.jdFileData?.trim() : '') ||
        '';
    const resolvedJdFile =
        project.jdFileDataB64 ||
        (project.jdFileType !== 'manual' ? project.jdFileData : '') ||
        '';
    const resolvedJdType =
        project.jdFileType && project.jdFileType !== 'manual' ? project.jdFileType : 'application/pdf';

    console.log(`[BulkImport] ATS scoring started for ${parsed.candidateEmail} against project ${projectName}`);

    try {
        const result = await candidateMatchScoring({
            jdText: resolvedJdText || undefined,
            jdFileDataB64: resolvedJdFile || undefined,
            jdFileType: resolvedJdFile ? resolvedJdType : undefined,
            resumeFileDataB64: fileBuffer.toString('base64'),
            resumeFileType: fileType,
            candidateProfile: {
                experience: parsed.experience || '',
                currentCtc: parsed.currentCtc || '',
                expectedCtc: parsed.expectedCtc || '',
                noticePeriod: parsed.noticePeriod || '',
            },
        });

        console.log(`[BulkImport] ATS scoring completed for ${parsed.candidateEmail}: ${result.matchScore}`);

        return {
            score: typeof result.matchScore === 'number' ? result.matchScore : 0,
            aiModel: 'gemini (candidateMatchScoringFlow)',
            summary: result.summary,
            hasJdComparison: true,
            projectName,
        };
    } catch (err) {
        // Rule #3: "AI scoring fails" is explicitly a Pending case, NOT Rejected.
        console.error('[BulkImport] ATS scoring failed:', err);
        return {
            ...calculateResumeQualityScore(
                parsed,
                `AI scoring service unavailable (${err instanceof Error ? err.message : 'unknown error'}). Candidate requires manual HR review.`
            ),
            projectName,
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Step 3 — Create the Firestore candidate record (same shape as manual upload)
// ─────────────────────────────────────────────────────────────────────────
async function createNewCandidate(payload: {
    candidateName: string;
    candidateEmail: string;
    candidatePhone?: string;
    candidateDesignation?: string;
    currentLocation?: string;      // ← NEW
  permanentLocation?: string;    // ← NEW
  isComfortableOnsite?: string;  // ← NEW
  resumeFile?: { name: string; type: string; data: string };   // ← NEW
    jobRequisitionId?: string;
    projectName?: string;
    resumeReviewStatus: 'Accepted' | 'Rejected' | 'Pending';
    rejectionReason?: string;
    atsScore: number;
    atsSummary?: string;
    createdBy: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
        const now = Timestamp.now();
        const isAccepted = payload.resumeReviewStatus === 'Accepted';
        const isRejected = payload.resumeReviewStatus === 'Rejected';

        const docRef = await adminDb.collection('candidates').add({
            candidateName: payload.candidateName,
            candidateEmail: payload.candidateEmail,
            candidatePhone: payload.candidatePhone || '',
            candidateDesignation: payload.candidateDesignation || '',
            jobRequisitionId: payload.jobRequisitionId || null,
            projectName: payload.projectName || '—',
            resumeFile: payload.resumeFile || null,   // ← NEW
            resumeReviewStatus: payload.resumeReviewStatus,
            resumeFeedback: isAccepted
                ? 'Auto-accepted via Bulk Import — ATS Score ' + payload.atsScore
                : isRejected
                    ? payload.rejectionReason || 'ATS Score Below Threshold'
                    : payload.atsSummary || 'Pending manual HR review.',

            l1Status: isAccepted ? 'Pending' : 'Locked',
            l2Status: 'Locked',
            l2ManagerStatus: 'Locked',
            hrStatus: 'Locked',
            offerStatus: 'Locked',

            finalStatus: isRejected ? 'Rejected' : 'In Progress',
            ...(isRejected ? { rejectionDate: now } : {}),

            matchScore: payload.atsScore,
            atsScore: payload.atsScore,
            // ── FIX: Candidate List reads `aiScore` for the "AI Resume Score"
            // column — the exact same field the single candidate upload flow
            // writes (`aiScore: matchScore` in CandidateEvaluation). Bulk
            // import was writing `matchScore` and `atsScore` (used by the
            // Bulk Candidate Import page's own table) but never `aiScore`,
            // so bulk-imported candidates always showed "N/A" on Candidate
            // List even though the score was already calculated and saved
            // under a different field name. `atsScore` is left untouched —
            // the Bulk Candidate Import page still reads that field.
            aiScore: payload.atsScore,
            matchSummary: payload.atsSummary || '',

            createdBy: payload.createdBy,
            createdByRole: 'hr',
            createdDate: now,
            lastUpdated: now,

            importSource: 'bulk-import',
        });

        console.log(`[BulkImport] Candidate created: ${docRef.id} (${payload.resumeReviewStatus})`);
        return { success: true, id: docRef.id };
    } catch (err) {
        return {
            success: false,
            error: err instanceof Error ? err.message : 'Failed to create candidate record',
        };
    }
}

/**
 * Writes candidate_history as one doc PER stage, matching the exact stage
 * sequences required:
 *   Accepted: Resume Uploaded → Resume Parsed → ATS Score Generated →
 *             Resume Accepted → Interview Scheduled
 *   Rejected: Resume Uploaded → Resume Parsed → ATS Score Generated →
 *             Resume Rejected
 *   Pending:  Resume Uploaded → Resume Parsed → Pending Manual Review
 */
async function writeCandidateHistory(
    candidateId: string,
    history: HistoryEntry[],
    createdBy: string
): Promise<void> {
    const batch = adminDb.batch();
    for (const entry of history) {
        const ref = adminDb.collection('candidate_history').doc();
        batch.set(ref, {
            candidateId,
            stage: entry.stage,
            details: entry.details || {},
            updatedBy: createdBy,
            updatedByName: 'Bulk Import',
            updatedByRole: 'hr',
            updatedAt: Timestamp.fromDate(new Date(entry.timestamp)),
        });
    }
    await batch.commit();
    console.log(`[BulkImport] Candidate history updated: ${candidateId} (${history.length} stages)`);
}

// ─────────────────────────────────────────────────────────────────────────
// Step 4 — Post-accept: AI interview creation + email (unchanged behavior)
// ─────────────────────────────────────────────────────────────────────────
async function triggerExistingPostAcceptWorkflow(
    candidateId: string,
    candidate: { candidateName: string; candidateEmail: string; candidateDesignation?: string }
): Promise<void> {
    const token = crypto.randomUUID();
    // const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://smart-hire-six.vercel.app';
    const baseUrl = getBaseUrl();
    const interviewUrl = `${baseUrl}/interview/${token}`;

    const sentAt = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(sentAt.toMillis() + 48 * 60 * 60 * 1000);

    await adminDb.collection('ai_interviews').add({
        token,
        candidateId,
        candidateName: candidate.candidateName || '',
        candidateEmail: candidate.candidateEmail || '',
        jobRole: candidate.candidateDesignation || '',
        status: 'pending',
        createdAt: sentAt,
        expiresAt,
        interviewUrl,
        l1AIInterviewSentAt: sentAt,
    });
    console.log(`[BulkImport] Interview created for candidate ${candidateId}`);

    await adminDb.collection('candidates').doc(candidateId).update({
        l1Status: 'Scheduled',
        l1InterviewType: 'ai',
        l1ScheduledDate: new Date().toISOString().split('T')[0],
        l1AIInterviewToken: token,
        l1AIInterviewUrl: interviewUrl,
        l1AIInterviewSentAt: sentAt,
        lastUpdated: sentAt,
    });

    try {
        await sendInterviewEmail({
            candidateName: candidate.candidateName || '',
            candidateEmail: candidate.candidateEmail || '',
            jobRole: candidate.candidateDesignation || '',
            experience: '',
            location: '',
            interviewerName: 'HR Team',
            interviewerEmail: '',
            interviewDate: new Date().toISOString().split('T')[0],
            interviewTime: '',
            schedulingNotes: `AI interview link: ${interviewUrl}`,
            interviewFeedback: '',
            stage: 'L1 Interview',
            senderRole: 'hr',
            emailType: 'interview_scheduled',
            candidateId,
            threadMessageId: '',
            interviewLink: interviewUrl,
            rescheduleToken: token,
            l1RescheduleUsed: false,
        } as any);
        console.log(`[BulkImport] Interview email sent to ${candidate.candidateEmail}`);
    } catch (err) {
        console.error('[triggerExistingPostAcceptWorkflow] Email failed:', err);
    }
}

function getFileTypeFromName(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'pdf':
            return 'application/pdf';
        case 'docx':
            return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        case 'doc':
            return 'application/msword';
        default:
            return 'application/octet-stream';
    }
}

function buildReason(
    status: 'accepted' | 'rejected' | 'pending' | 'failed',
    score: number,
    summary?: string
): string {
    switch (status) {
        case 'accepted':
            return `ATS Score ${score}/100 — meets minimum threshold of ${ATS_PASS_THRESHOLD}%.`;
        case 'rejected':
            return `ATS Score Below Threshold (${score}/100). Minimum ATS Required: ${ATS_PASS_THRESHOLD}%.`;
        case 'pending':
            return summary || 'Requires manual HR review.';
        default:
            return summary || 'Failed to process this file.';
    }
}
export async function fetchJobRequisition(jobRequisitionId: string): Promise<any | null> {
    const reqSnap = await adminDb.collection('job_requisitions').doc(jobRequisitionId).get();
    return reqSnap.exists ? reqSnap.data() : null;
}
// ─────────────────────────────────────────────────────────────────────────
// Orchestrator — one resume end to end
// ─────────────────────────────────────────────────────────────────────────
export async function processSingleResume(
    fileBuffer: Buffer,
    fileName: string,
    context: { jobRequisitionId?: string; createdBy: string; project?: any }
): Promise<ImportedCandidateResult> {
    console.log(`[BulkImport] Resume uploaded: ${fileName}`);
    const history: HistoryEntry[] = [
        { stage: 'Resume Uploaded', timestamp: new Date().toISOString() },
    ];

    const fileType = getFileTypeFromName(fileName);

    // ── Store the resume inline as base64, same shape Single Candidate Upload
    // uses (formData.resumeFile: { name, type, data }). Firestore documents
    // cap out at 1MiB total, and base64 inflates size ~33%, so anything close
    // to that raw size is skipped rather than risking a failed write. Single
    // Candidate Upload has this same latent ceiling (it caps uploads at 1MB
    // client-side, which base64-encodes to ~1.37MB — right at the edge of
    // Firestore's document limit). If resumes routinely approach this size,
    // moving to Firebase Storage + storing a URL instead of inline base64 is
    // the real fix; for now this keeps behavior consistent with single upload. ──
    const MAX_INLINE_RESUME_BYTES = 700 * 1024;
    let resumeFile: { name: string; type: string; data: string } | undefined;
    if (fileBuffer.length <= MAX_INLINE_RESUME_BYTES) {
        resumeFile = { name: fileName, type: fileType, data: fileBuffer.toString('base64') };
    } else {
        console.warn(`[BulkImport] Resume too large to store inline (${fileBuffer.length} bytes): ${fileName}`);
    }

    let parsed: ParsedResumeData;
    try {
        parsed = await parseResume(fileBuffer, fileName, fileType);
    } catch (err) {
        return {
            fileName,
            status: 'failed',
            reason: 'Resume parsing failed.',
            history,
        };
    }
    history.push({ stage: 'Resume Parsed', timestamp: new Date().toISOString() });

    if (!parsed.candidateEmail) {
        return {
            fileName,
            status: 'failed',
            reason: 'Email not found in resume.',
            history,
        };
    }

    const ats = await calculateAtsScore(parsed, fileBuffer, fileType, context.jobRequisitionId, context.project);

    // Only record an "ATS Score Generated" stage when a real JD comparison
    // ran — matches the Pending stage list, which omits this step entirely.
    if (ats.hasJdComparison) {
        history.push({
            stage: 'ATS Score Generated',
            timestamp: new Date().toISOString(),
            details: { atsScore: ats.score, aiModel: ats.aiModel },
        });
    }

    const resumeReviewStatus: 'Accepted' | 'Rejected' | 'Pending' =
        !ats.hasJdComparison
            ? 'Pending'
            : ats.score >= ATS_PASS_THRESHOLD
                ? 'Accepted'
                : 'Rejected';

    const statusKey: 'accepted' | 'rejected' | 'pending' =
        resumeReviewStatus === 'Accepted' ? 'accepted' : resumeReviewStatus === 'Rejected' ? 'rejected' : 'pending';

        const reason = buildReason(statusKey, ats.score, ats.summary);

        const createResult = await createNewCandidate({
            candidateName: parsed.candidateName,
            candidateEmail: parsed.candidateEmail,
            candidatePhone: parsed.candidatePhone,
            candidateDesignation: parsed.candidateDesignation,
            currentLocation: parsed.currentLocation,
            permanentLocation: parsed.permanentLocation,
            isComfortableOnsite: parsed.isComfortableOnsite,
            resumeFile,                              // ← NEW
            jobRequisitionId: context.jobRequisitionId,
            projectName: ats.projectName,
            resumeReviewStatus,
            rejectionReason: resumeReviewStatus === 'Rejected' ? reason : undefined,
            atsScore: ats.score,
            atsSummary: ats.summary,
            createdBy: context.createdBy,
        });    

    if (!createResult.success || !createResult.id) {
        return {
            fileName,
            status: 'failed',
            reason: createResult.error || 'Failed to create candidate record',
            history,
        };
    }

    history.push({
        stage:
            resumeReviewStatus === 'Accepted'
                ? 'Resume Accepted'
                : resumeReviewStatus === 'Rejected'
                    ? 'Resume Rejected'
                    : 'Pending Manual Review',
        timestamp: new Date().toISOString(),
    });

    if (resumeReviewStatus === 'Accepted') {
        await triggerExistingPostAcceptWorkflow(createResult.id, {
            candidateName: parsed.candidateName,
            candidateEmail: parsed.candidateEmail,
            candidateDesignation: parsed.candidateDesignation,
        });
        history.push({ stage: 'Interview Scheduled', timestamp: new Date().toISOString() });
    }

    await writeCandidateHistory(createResult.id, history, context.createdBy);

    console.log(`[BulkImport] Import completed for ${fileName}: ${statusKey}`);

    return {
        fileName,
        status: statusKey,
        candidateId: createResult.id,
        candidateName: parsed.candidateName,
        candidateEmail: parsed.candidateEmail,
        candidatePhone: parsed.candidatePhone,
        atsScore: ats.score,
        atsSummary: ats.summary,
        projectName: ats.projectName,
        finalStatus: resumeReviewStatus === 'Rejected' ? 'Rejected' : 'In Progress',
        reason,
        history,
    };
}