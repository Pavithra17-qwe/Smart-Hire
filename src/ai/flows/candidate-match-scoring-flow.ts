'use server';

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import mammoth from 'mammoth';

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
});
export type CandidateMatchScoringInput = z.infer<typeof CandidateMatchScoringInputSchema>;

const CandidateMatchScoringOutputSchema = z.object({
  matchScore: z.number().min(0).max(100).describe('Match score between 0 and 100'),
  summary: z.string().describe('Detailed explanation of the score'),
});
export type CandidateMatchScoringOutput = z.infer<typeof CandidateMatchScoringOutputSchema>;

async function extractText(b64: string, mime: string): Promise<string> {
  try {
    const buffer = Buffer.from(b64, 'base64');
    if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const result = await mammoth.extractRawText({ buffer });
      return result.value || '';
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
    const MAX_TEXT_LENGTH = 12000;

    // ── JD: plain text path ───────────────────────────────────────────────────
    // This handles both project.jdText AND project.jdFileData with type "manual"
    // Both arrive here via the jdText input field after the evaluation page resolves them
    if (input.jdText && input.jdText.trim().length > 10) {
      jdText = input.jdText.trim().slice(0, MAX_TEXT_LENGTH);
      console.log('[Scoring] JD is plain text, length:', jdText.length);
    }

    // ── JD: uploaded file path ────────────────────────────────────────────────
    if (!jdText && !jdDataUri && input.jdFileDataB64 && input.jdFileType) {
      if (input.jdFileType === 'application/pdf') {
        jdDataUri = `data:${input.jdFileType};base64,${input.jdFileDataB64}`;
        console.log('[Scoring] JD loaded as PDF');
      } else {
        const extracted = await extractText(input.jdFileDataB64, input.jdFileType);
        if (extracted.trim().length > 10) {
          jdText = extracted.trim();
          console.log('[Scoring] JD extracted from DOCX, length:', jdText.length);
        } else {
          jdDataUri = `data:${input.jdFileType};base64,${input.jdFileDataB64}`;
        }
      }
    }

    // ── Resume ────────────────────────────────────────────────────────────────
    console.log('[Scoring] resumeFileType:', input.resumeFileType);

    if (input.resumeFileType === 'application/pdf') {
      resumeDataUri = `data:${input.resumeFileType};base64,${input.resumeFileDataB64}`;
      console.log('[Scoring] Resume loaded as PDF');
    } else {
      const extracted = await extractText(input.resumeFileDataB64, input.resumeFileType);
      if (extracted.trim().length > 10) {
        resumeText = extracted.trim();
        console.log('[Scoring] Resume extracted from DOCX, length:', resumeText.length);
      } else {
        resumeDataUri = `data:${input.resumeFileType};base64,${input.resumeFileDataB64}`;
      }
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

    // ── Build prompt (plain parts, no Handlebars) ─────────────────────────────
    const promptParts: any[] = [];

    promptParts.push({
      text: `You are an expert recruiter and talent evaluator. Compare the candidate resume with the job description below and give a precise match score.

Evaluate based on:
1. Skill Match (40%) - technical and soft skills alignment
2. Experience Match (25%) - years and type of experience vs requirements
3. Role Relevance (20%) - relevance of past roles to this position
4. Keyword and Domain Alignment (15%) - tools, certifications, industry terms

Return ONLY a valid JSON object with exactly these two keys:
{
  "matchScore": <number from 0 to 100>,
  "summary": "<detailed explanation covering: overall rationale, strengths, gaps, and recommendation>"
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