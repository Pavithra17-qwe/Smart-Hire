'use server';
/**
 * @fileOverview An AI agent for scoring candidate resumes against job descriptions.
 *
 * - candidateMatchScoring - A function that handles the scoring process.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import mammoth from 'mammoth';

// Paste this ABOVE candidateMatchScoringFlow
async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 5000): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const isQuotaError = err?.message?.includes('RESOURCE_EXHAUSTED') ||
                           err?.message?.includes('Too Many Requests');
      if (isQuotaError && i < retries - 1) {
        console.warn(`⚠️ Quota hit, retrying in ${delayMs * (i + 1)}ms...`);
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
  jdText: z.string().optional(),   // ✅ ADD THIS
  resumeFileDataB64: z.string(),
  resumeFileType: z.string(),
});
export type CandidateMatchScoringInput = z.infer<typeof CandidateMatchScoringInputSchema>;

const CandidateMatchScoringOutputSchema = z.object({
  matchScore: z.number().min(0).max(100).describe('Match score between 0 and 100'),
  summary: z.string().describe('Detailed explanation of the score with strengths, gaps and recommendation'),
});
export type CandidateMatchScoringOutput = z.infer<typeof CandidateMatchScoringOutputSchema>;

// Helper to extract text from Base64 files
async function extractText(b64: string, mime: string): Promise<string> {
  const buffer = Buffer.from(b64, 'base64');
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  // For PDFs and others, we'll let the multimodal model handle it via Data URI in the prompt if possible,
  // but for "text comparison" logic, we'll return the raw text if we can extract it.
  // Gemini 1.5 Flash can handle PDF URIs directly, so we'll return an empty string for PDF and handle it in prompt.
  return ''; 
}
const scoringPrompt = ai.definePrompt({
  name: 'candidateMatchScoringPrompt',
  input: {
    schema: z.object({
      jdText: z.string().optional(),
      jdDataUri: z.string().optional(),
      resumeText: z.string().optional(),
      resumeDataUri: z.string().optional(),
    })
  },
  output: { schema: CandidateMatchScoringOutputSchema },
  prompt: `You are an expert recruiter and talent evaluator. Compare the candidate resume with the job description and calculate a precise match score.

Job Description:
{{#if jdText}}
"""
{{{jdText}}}
"""
{{/if}}
{{#if jdDataUri}}
JD File: {{media url=jdDataUri}}
{{/if}}

Candidate Resume:
{{#if resumeText}}
"""
{{{resumeText}}}
"""
{{/if}}
{{#if resumeDataUri}}
Resume File: {{media url=resumeDataUri}}
{{/if}}

Evaluate and score based on these criteria (with weightage):
1. **Skill Match (40%)** - How well do the candidate's technical and soft skills align?
2. **Experience Match (25%)** - Does the years and type of experience match requirements?
3. **Role Relevance (20%)** - How relevant are past roles/designations to this position?
4. **Keyword & Domain Alignment (15%)** - Industry terms, tools, certifications match?

Return a JSON object with:
- "matchScore": a number from 0 to 100 (weighted average of above criteria).
- "summary": a detailed multi-paragraph explanation covering:
  * Overall score rationale
  * Strengths: what the candidate matches well
  * Gaps: what is missing or misaligned
  * Recommendation: whether to shortlist, consider, or skip`,
});

export async function candidateMatchScoring(input: CandidateMatchScoringInput): Promise<CandidateMatchScoringOutput> {
  return candidateMatchScoringFlow(input);
}
const candidateMatchScoringFlow = ai.defineFlow(
  {
    name: 'candidateMatchScoringFlow',
    inputSchema: CandidateMatchScoringInputSchema,
    outputSchema: CandidateMatchScoringOutputSchema,
  },
  async (input) => {
    let jdText = '';
    let jdDataUri = '';
    let resumeText = '';
    let resumeDataUri = '';

    // ── JD Handling ──────────────────────────────────────────────────────────
    if (input.jdText) {
      // Check if it's actually base64 (Firestore sometimes stores file data here)
      const isBase64 = /^[A-Za-z0-9+/=]{100,}$/.test(input.jdText.replace(/\s/g, ''));
      
      if (isBase64) {
        // Treat as PDF base64 — pass as media URI
        jdDataUri = `data:application/pdf;base64,${input.jdText}`;
      } else {
        // It's real plain text
        jdText = input.jdText;
      }
    } else if (input.jdFileType === 'application/pdf' && input.jdFileDataB64) {
      jdDataUri = `data:${input.jdFileType};base64,${input.jdFileDataB64}`;
    } else if (input.jdFileDataB64 && input.jdFileType) {
      jdText = await extractText(input.jdFileDataB64, input.jdFileType);
      if (!jdText) {
        jdDataUri = `data:${input.jdFileType};base64,${input.jdFileDataB64}`;
      }
    }

    // ── Resume Handling ──────────────────────────────────────────────────────
    if (input.resumeFileType === 'application/pdf') {
      resumeDataUri = `data:${input.resumeFileType};base64,${input.resumeFileDataB64}`;
    } else {
      resumeText = await extractText(input.resumeFileDataB64, input.resumeFileType);
      if (!resumeText) resumeDataUri = `data:${input.resumeFileType};base64,${input.resumeFileDataB64}`;
    }

    // ── Guard: if neither JD source is available, return 0 ──────────────────
    if (!jdText && !jdDataUri) {
      return {
        matchScore: 0,
        summary: 'No Job Description content found in the selected project. Please ensure the project has a JD uploaded or entered as text.',
      };
    }

    const { output } = await scoringPrompt({ jdText, jdDataUri, resumeText, resumeDataUri });
    
    if (!output) {
      return {
        matchScore: 0,
        summary: 'AI scoring returned no output. Please try again.',
      };
    }

    return output;
  }
);
