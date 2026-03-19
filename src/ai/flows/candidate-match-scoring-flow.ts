'use server';
/**
 * @fileOverview An AI agent for scoring candidate resumes against job descriptions.
 *
 * - candidateMatchScoring - A function that handles the scoring process.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import mammoth from 'mammoth';

const CandidateMatchScoringInputSchema = z.object({
  jdFileDataB64: z.string().describe('Base64 JD content'),
  jdFileType: z.string().describe('MIME type of JD'),
  resumeFileDataB64: z.string().describe('Base64 Resume content'),
  resumeFileType: z.string().describe('MIME type of Resume'),
});
export type CandidateMatchScoringInput = z.infer<typeof CandidateMatchScoringInputSchema>;

const CandidateMatchScoringOutputSchema = z.object({
  matchScore: z.number().min(0).max(100).describe('Match score between 0 and 100'),
  summary: z.string().describe('A short explanation of the score'),
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
  output: {schema: CandidateMatchScoringOutputSchema},
  prompt: `Compare the candidate resume with the job description and calculate a match score.

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

Evaluate the following criteria:
- Skill match
- Experience match
- Role relevance
- Keyword similarity

Return a JSON object with:
- "matchScore": a number from 0 to 100.
- "summary": a short explanation (max 2 sentences) of why this score was given.`,
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

    // Extract JD
    if (input.jdFileType === 'application/pdf') {
      jdDataUri = `data:${input.jdFileType};base64,${input.jdFileDataB64}`;
    } else {
      jdText = await extractText(input.jdFileDataB64, input.jdFileType);
      if (!jdText) jdDataUri = `data:${input.jdFileType};base64,${input.jdFileDataB64}`;
    }

    // Extract Resume
    if (input.resumeFileType === 'application/pdf') {
      resumeDataUri = `data:${input.resumeFileType};base64,${input.resumeFileDataB64}`;
    } else {
      resumeText = await extractText(input.resumeFileDataB64, input.resumeFileType);
      if (!resumeText) resumeDataUri = `data:${input.resumeFileType};base64,${input.resumeFileDataB64}`;
    }

    const {output} = await scoringPrompt({ jdText, jdDataUri, resumeText, resumeDataUri });
    return output!;
  }
);
