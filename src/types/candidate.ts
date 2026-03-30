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

  // Stage Statuses
  resumeReviewStatus?: 'Pending' | 'Accepted' | 'Rejected';
  l1Status?: 'Locked' | 'Pending' | 'Scheduled' | 'Selected' | 'Rejected';
  l2Status?: 'Locked' | 'Pending' | 'Scheduled' | 'Selected' | 'Rejected';
  hrStatus?: 'Locked' | 'Pending' | 'Scheduled' | 'Selected' | 'Rejected';
  offerStatus?: 'Locked' | 'Pending' | 'Released' | 'Accepted' | 'Rejected';
  finalStatus?: string;

  // Feedback
  resumeFeedback?: string;
  l1Feedback?: string;
  l2Feedback?: string;
  hrFeedback?: string;
  offerFeedback?: string;

  // Scheduling
  l1ScheduledDate?: string;
  l1TimeSlot?: string;
  l2ScheduledDate?: string;
  l2TimeSlot?: string;
  hrScheduledDate?: string;
  hrTimeSlot?: string;

  // Creator Info
  createdByName?: string;
  createdByRole?: string;
  createdBy: string;

  // For indexing and other properties
  [key: string]: any;
}
