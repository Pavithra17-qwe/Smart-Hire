import { Timestamp } from 'firebase/firestore';

export interface Candidate {
  id: string;
  candidateName?: string;
  candidateEmail?: string;
  candidatePhone?: string;
  candidateDesignation?: string;
  resumeUrl?: string;
  createdDate?: Timestamp;
  lastUpdated?: Timestamp;
  resumeStatus?: 'Pending' | 'Accepted' | 'Rejected';
  l1Status?: 'Locked' | 'Pending' | 'Scheduled' | 'Selected' | 'Rejected';
  l2Status?: 'Locked' | 'Pending' | 'Scheduled' | 'Selected' | 'Rejected';
  hrRoundStatus?: 'Locked' | 'Pending' | 'Scheduled' | 'Selected' | 'Rejected';
  offerStatus?: 'Locked' | 'Pending' | 'Released' | 'Accepted' | 'Rejected';
  overallStatus?: string;
  createdByName?: string;
  createdByRole?: string;
  [key: string]: any;
}
