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
  resumeReviewStatus?: 'Pending' | 'Accepted' | 'Rejected' | 'Panel Assigned' | 'Panel Reviewed' | 'On Hold';
  l1Status?: 'Locked' | 'Pending' | 'Scheduled' | 'Selected' | 'Rejected' | 'On Hold';
  l2Status?: 'Locked' | 'Pending' | 'Scheduled' | 'Selected' | 'Rejected' | 'On Hold';
  l2ManagerStatus?: 'Locked' | 'Pending' | 'Scheduled' | 'Selected' | 'Rejected' | 'On Hold';
  hrStatus?: 'Locked' | 'Pending' | 'Scheduled' | 'Selected' | 'Rejected' | 'On Hold';
  offerStatus?: 'Locked' | 'Pending' | 'Released' | 'Accepted' | 'Rejected' | 'On Hold';
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