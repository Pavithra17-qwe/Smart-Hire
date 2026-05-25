'use server';

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse'; // ← NEW IMPORT

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 5000): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const isQuotaError =
        err?.message?.includes('RESOURCE_EXHAUSTED') ||
        err?.message?.includes('Too Many Requests');
      if (isQuotaError && i < retries - 1) {
        console.warn(`Quota hit, retrying in ${delayMs * (i + 1)}ms...`);
        await new Promise(res => setTimeout(res, delayMs * (i + 1)));
      } else {
        throw err;
      }
    }
  }
  throw new Error('Max retries exceeded');
}

const CandidateMatchScoringInputSchema = z.object({
  jdFileDataB64: z.string().optional(),
  jdFileType: z.string().optional(),
  jdText: z.string().optional(),
  resumeFileDataB64: z.string(),
  resumeFileType: z.string(),
  candidateProfile: z.object({
    experience:          z.string().optional(),
    currentCtc:          z.string().optional(),
    expectedCtc:         z.string().optional(),
    noticePeriod:        z.string().optional(),
    currentLocation:     z.string().optional(),
    isComfortableOnsite: z.string().optional(),
    designation:         z.string().optional(),
  }).optional(),
});
export type CandidateMatchScoringInput = z.infer<typeof CandidateMatchScoringInputSchema>;

const CandidateMatchScoringOutputSchema = z.object({
  matchScore: z.number().min(0).max(100).describe('Match score between 0 and 100'),
  summary: z.string().describe('Detailed explanation of the score'),
});
export type CandidateMatchScoringOutput = z.infer<typeof CandidateMatchScoringOutputSchema>;

// ── UPDATED: now handles both DOCX and PDF ──────────────────────────────────
async function extractText(b64: string, mime: string): Promise<string> {
  try {
    const buffer = Buffer.from(b64, 'base64');

    if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const result = await mammoth.extractRawText({ buffer });
      return result.value || '';
    }

    if (mime === 'application/pdf') {
      const data = await pdfParse(buffer);
      return data.text || '';
    }

  } catch (err) {
    console.error('[extractText] Failed:', err);
  }
  return '';
}

export async function candidateMatchScoring(
  input: CandidateMatchScoringInput
): Promise<CandidateMatchScoringOutput> {
  return candidateMatchScoringFlow(input);
}

const candidateMatchScoringFlow = ai.defineFlow(
  {
    name: 'candidateMatchScoringFlow',
    inputSchema: CandidateMatchScoringInputSchema,
    outputSchema: CandidateMatchScoringOutputSchema,
  },
  async (input) => {

    let jdText: string | undefined;
    let jdDataUri: string | undefined;
    let resumeText: string | undefined;
    let resumeDataUri: string | undefined;
    const MAX_TEXT_LENGTH = 12000; // ← keeps token count safe

    // ── JD: plain text path ───────────────────────────────────────────────────
    if (input.jdText && input.jdText.trim().length > 10) {
      jdText = input.jdText.trim().slice(0, MAX_TEXT_LENGTH);
      console.log('[Scoring] JD is plain text, length:', jdText.length);
    }

    // ── JD: uploaded file path (PDF or DOCX) ─────────────────────────────────
    if (!jdText && !jdDataUri && input.jdFileDataB64 && input.jdFileType) {
      // ← UPDATED: extract text from PDF too, don't send raw base64
      const extracted = await extractText(input.jdFileDataB64, input.jdFileType);
      if (extracted.trim().length > 10) {
        jdText = extracted.trim().slice(0, MAX_TEXT_LENGTH);
        console.log('[Scoring] JD extracted from file, length:', jdText.length);
      } else {
        // Only fall back to dataUri if text extraction completely failed (e.g. scanned PDF)
        jdDataUri = `data:${input.jdFileType};base64,${input.jdFileDataB64}`;
        console.log('[Scoring] JD fallback to dataUri');
      }
    }

    // ── Resume: extract text first, never send raw PDF base64 ────────────────
    // ← THIS IS THE KEY FIX — old code was sending full PDF as base64 = 35k tokens
    console.log('[Scoring] resumeFileType:', input.resumeFileType);

    const extractedResume = await extractText(input.resumeFileDataB64, input.resumeFileType);

    if (extractedResume.trim().length > 10) {
      resumeText = extractedResume.trim().slice(0, MAX_TEXT_LENGTH);
      console.log('[Scoring] Resume extracted as text, length:', resumeText.length);
    } else {
      // Only fall back to dataUri if text extraction completely failed (scanned PDF)
      resumeDataUri = `data:${input.resumeFileType};base64,${input.resumeFileDataB64}`;
      console.log('[Scoring] Resume fallback to dataUri (scanned PDF?)');
    }

    // ── Guard ─────────────────────────────────────────────────────────────────
    const hasJD     = (jdText !== undefined && jdText.length > 10) || !!jdDataUri;
    const hasResume = (resumeText !== undefined && resumeText.length > 10) || !!resumeDataUri;

    console.log('[Scoring] hasJD:', hasJD, '| hasResume:', hasResume);

    if (!hasJD) {
      console.error('[Scoring] No JD found - returning 0');
      return {
        matchScore: 0,
        summary: 'No Job Description was found. Please ensure the project has a JD entered as text or uploaded as a file.',
      };
    }

    if (!hasResume) {
      console.error('[Scoring] No resume found - returning 0');
      return {
        matchScore: 0,
        summary: 'The resume could not be read. Please re-upload the resume and try again.',
      };
    }

    // ── Candidate profile summary ─────────────────────────────────────────────
    const profile = input.candidateProfile;
    const profileText = profile ? `
--- CANDIDATE PROFILE (manually entered) ---
Experience:           ${profile.experience          || 'Not specified'} years
Current CTC:          ${profile.currentCtc          || 'Not specified'} LPA
Expected CTC:         ${profile.expectedCtc         || 'Not specified'} LPA
Notice Period:        ${profile.noticePeriod        || 'Not specified'}
Current Location:     ${profile.currentLocation     || 'Not specified'}
Comfortable Onsite:   ${profile.isComfortableOnsite || 'Not specified'}
Applied Designation:  ${profile.designation         || 'Not specified'}
` : '';

    // ── Build prompt ──────────────────────────────────────────────────────────
    const promptParts: any[] = [];

    promptParts.push({
      text: `You are an expert recruiter and talent evaluator. Evaluate the candidate holistically using three sources: the Job Description, the candidate's resume, and the manually entered profile data.
    
    Scoring breakdown:
    1. Skill Match (35%)        — technical and soft skills from the resume vs JD requirements
    2. Experience Match (20%)   — years and quality of experience vs JD requirements
    3. Role Relevance (15%)     — past roles and projects vs the target position
    4. Keyword Alignment (10%)  — tools, certifications, domain terms
    5. Profile Fit (20%)        — evaluate ALL of these from the candidate profile data:
       • Does their Expected CTC seem reasonable for this role?
       • Is their notice period acceptable (Immediate/15 days = positive, 60-90 days = slight penalty)?
       • Does their current location match the job location or are they open to relocation?
       • Are they comfortable working onsite if the role requires it?
       • Does their designation/title match the applied role level?
    
    Return ONLY a valid JSON object with exactly these two keys:
    {
      "matchScore": <number from 0 to 100>,
      "summary": "<detailed explanation covering: skill strengths, experience fit, profile data assessment (CTC, notice period, location, onsite comfort), gaps, and final recommendation>"
    }
    
    No text before or after the JSON. No markdown. No code fences.
    
    --- JOB DESCRIPTION ---
    `,
    });

    if (jdText) {
      promptParts.push({ text: jdText });
    } else if (jdDataUri) {
      promptParts.push({ media: { url: jdDataUri } });
    }

    promptParts.push({ text: '\n\n--- CANDIDATE RESUME ---\n' });

    if (resumeText) {
      promptParts.push({ text: resumeText });
    } else if (resumeDataUri) {
      promptParts.push({ media: { url: resumeDataUri } });
    }

    if (profileText) {
      promptParts.push({ text: profileText });
    }

    // ── Call Gemini ───────────────────────────────────────────────────────────
    try {
      console.log('[Scoring] Calling Gemini...');

      const response = await withRetry(() =>
        ai.generate({
          output: { schema: CandidateMatchScoringOutputSchema },
          prompt: promptParts,
        })
      );

      const output = response.output;

      if (!output) {
        console.error('[Scoring] Gemini returned no output');
        return {
          matchScore: 0,
          summary: 'The AI returned an empty response. Please try submitting again.',
        };
      }

      console.log('[Scoring] Score received:', output.matchScore);
      return output;

    } catch (err: any) {
      console.error('[Scoring] Gemini call failed:', err?.message ?? err);
      return {
        matchScore: 0,
        summary: `AI scoring failed: ${err?.message ?? 'Unknown error'}. Please try again.`,
      };
    }
  }
);