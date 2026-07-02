/**
 * stampRejection.ts
 *
 * A single helper that stamps all required rejection metadata onto a candidate
 * document when they are marked Rejected at any stage.
 *
 * USAGE — call this from any existing place where you set finalStatus = 'Rejected',
 * for example inside your stage action handlers (resume review, L1, L2, HR, offer):
 *
 *   import { stampRejection } from '@/lib/stampRejection';
 *
 *   await stampRejection({
 *     candidateId:    candidate.id,
 *     stage:          'L1 Interview',       // the display stage label
 *     reason:         'Technical mismatch', // free-text or dropdown value
 *     performedByUid:  user.uid,
 *     performedByName: loggedInName,
 *     performedByEmail: user.email,
 *   });
 *
 * This does NOT modify any existing rejection logic — it only adds the metadata
 * fields required by the Rejected Candidates module.
 */

import { doc, updateDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface StampRejectionParams {
  candidateId:       string;
  stage:             string;   // e.g. 'Resume Review' | 'Screening' | 'L1 Interview' | ...
  reason?:           string;   // rejection reason (optional but recommended)
  performedByUid?:   string;
  performedByName?:  string;
  performedByEmail?: string;
}

export async function stampRejection({
  candidateId,
  stage,
  reason,
  performedByUid,
  performedByName,
  performedByEmail,
}: StampRejectionParams): Promise<void> {
  const now = new Date().toISOString();

  // 1. Write rejection metadata to the candidate document
  await updateDoc(doc(db, 'candidates', candidateId), {
    finalStatus:     'Rejected',
    rejectedStage:   stage,
    rejectionReason: reason    ?? null,
    rejectionDate:   serverTimestamp(),
    rejectedByUid:   performedByUid   ?? null,
    rejectedByName:  performedByName  ?? null,
    rejectedByEmail: performedByEmail ?? null,
  });

  // 2. Append an audit event to candidate_history
  await addDoc(collection(db, 'candidate_history'), {
    candidateId,
    event:            'Candidate Rejected',
    stage,
    rejectionReason:  reason ?? null,
    performedByUid:   performedByUid   ?? '',
    performedByName:  performedByName  ?? '',
    performedByEmail: performedByEmail ?? '',
    timestamp:        serverTimestamp(),
    note: `Candidate rejected at ${stage}${reason ? ` — Reason: ${reason}` : ''}.`,
  });
}