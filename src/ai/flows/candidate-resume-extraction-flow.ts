'use server';
/**
 * @fileOverview An AI agent for extracting candidate information from resumes.
 *
 * - candidateResumeExtraction - A function that handles the resume analysis process.
 * - CandidateResumeExtractionInput - The input type for the candidateResumeExtraction function.
 * - CandidateResumeExtractionOutput - The return type for the candidateResumeExtraction function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import mammoth from 'mammoth';

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

const CandidateResumeExtractionInputSchema = z.object({
  fileName: z.string().describe('The name of the resume file.'),
  fileType: z.string().describe('The MIME type of the resume file.'),
  fileDataB64: z.string().describe('The Base64 encoded content of the resume file.'),
});
export type CandidateResumeExtractionInput = z.infer<typeof CandidateResumeExtractionInputSchema>;

const CandidateResumeExtractionOutputSchema = z.object({
  candidateName: z.string().optional().describe('Full name of the candidate.'),
  candidateEmail: z.string().optional().describe('Email address of the candidate.'),
  phoneNumber: z.string().optional().describe('10-digit phone number of the candidate.'),
  experience: z.string().optional().describe('Total years of experience (e.g., "5.5").'),
  currentCtc: z.string().optional().describe('Current annual salary (numeric string).'),
  expectedCtc: z.string().optional().describe('Expected annual salary (numeric string).'),
  noticePeriod: z.enum(["Immediate", "15 Days", "30 Days", "60 Days", "90 Days"]).optional().describe('The notice period or availability.'),
  currentCompany: z.string().optional().describe('The name of the candidate\'s current employer.'),
  skills: z.array(z.string()).optional().describe('A list of technical and soft skills identified in the resume.'),
});
export type CandidateResumeExtractionOutput = z.infer<typeof CandidateResumeExtractionOutputSchema>;

export async function candidateResumeExtraction(input: CandidateResumeExtractionInput): Promise<CandidateResumeExtractionOutput> {
  return candidateResumeExtractionFlow(input);
}

const resumePrompt = ai.definePrompt({
  name: 'resumeExtractionPrompt',
  input: {
    schema: z.object({ 
      resumeDataUri: z.string().optional(),
      resumeText: z.string().optional()
    })
  },
  output: {schema: CandidateResumeExtractionOutputSchema},
  prompt: `You are an expert recruitment assistant.
Extract the candidate's professional details from the provided resume.

{{#if resumeDataUri}}
Resume File: {{media url=resumeDataUri}}
{{/if}}

{{#if resumeText}}
Resume Text Content:
"""
{{{resumeText}}}
"""
{{/if}}

Instructions:
- Extract the candidate's full name.
- Extract the email address.
- Extract the phone number (clean it to be exactly 10 digits if possible).
- Extract total years of experience as a decimal number string (e.g., "3.5").
- Extract current and expected CTCs as numeric strings representing annual amounts.
- Map the notice period to one of: "Immediate", "15 Days", "30 Days", "60 Days", "90 Days".
- Extract the candidate's current employer/company.
- Identify all technical and soft skills.

If a piece of information is missing, do not guess; leave the field empty.`,
});

const candidateResumeExtractionFlow = ai.defineFlow(
  {
    name: 'candidateResumeExtractionFlow',
    inputSchema: CandidateResumeExtractionInputSchema,
    outputSchema: CandidateResumeExtractionOutputSchema,
  },
  async (input) => {
    let resumeDataUri: string | undefined;
    let resumeText: string | undefined;

    console.log(`Starting parsing for file: ${input.fileName} (${input.fileType})`);

    // Handle PDF with native media support (Gemini handles PDF)
    if (input.fileType === 'application/pdf') {
      resumeDataUri = `data:${input.fileType};base64,${input.fileDataB64}`;
      console.log('File type is PDF. Passing as media part to AI.');
    } 
    // Handle DOCX with mammoth text extraction
    else if (input.fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const buffer = Buffer.from(input.fileDataB64, 'base64');
      const result = await mammoth.extractRawText({ buffer });
      resumeText = result.value;
      console.log('Extracted Text (Mammoth DOCX):', resumeText.substring(0, 500) + '...');
    } 
    // Handle legacy DOC or others by passing as data URI (Multimodal fallback)
    else {
      resumeDataUri = `data:${input.fileType};base64,${input.fileDataB64}`;
      console.log('File type is legacy DOC or other. Passing as media part to AI.');
    }

    if (!resumeText && !resumeDataUri) {
      throw new Error('Resume could not be parsed. Please upload a text-based resume.');
    }

    const {output} = await withRetry(() =>
      resumePrompt({ resumeDataUri, resumeText })
    );    
    if (!output || Object.keys(output).filter(k => k !== 'skills').every(k => !output[k as keyof typeof output])) {
        // If everything except skills is empty, it might be a parsing failure
        console.warn('AI extraction returned mostly empty results.');
    }

    return output!;
  }
);
