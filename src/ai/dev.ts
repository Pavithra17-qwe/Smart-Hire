import { config } from 'dotenv';
config();

import '@/ai/flows/admin-job-description-insight-flow.ts';
import '@/ai/flows/candidate-resume-extraction-flow.ts';
import '@/ai/flows/candidate-match-scoring-flow.ts';
import '@/ai/flows/send-interview-email-flow.ts';
import '@/ai/flows/send-welcome-email-flow.ts';
import '@/ai/flows/send-new-user-welcome-email-flow.ts';
