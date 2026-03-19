'use server';
/**
 * @fileOverview An AI agent for analyzing Job Descriptions.
 *
 * - adminJobDescriptionInsight - A function that handles the Job Description analysis process.
 * - AdminJobDescriptionInsightInput - The input type for the adminJobDescriptionInsight function.
 * - AdminJobDescriptionInsightOutput - The return type for the adminJobDescriptionInsight function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const AdminJobDescriptionInsightFlowInputSchema = z.object({
  jdFileName: z.string().describe('The original file name of the Job Description.'),
  jdFileType: z
    .string()
    .describe(
      'The MIME type of the Job Description file (e.g., application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document).'
    ),
  jdFileDataB64: z
    .string()
    .describe('The Base64 encoded content of the Job Description file (without the data URI prefix).'),
});
export type AdminJobDescriptionInsightInput = z.infer<
  typeof AdminJobDescriptionInsightFlowInputSchema
>;

const AdminJobDescriptionInsightOutputSchema = z.object({
  summary: z.string().describe('A concise summary of the job role and its main objectives.'),
  keyRequirements: z.array(z.string()).describe('A list of key requirements for candidates.'),
  responsibilities: z.array(z.string()).describe('A list of primary responsibilities associated with the role.'),
  requiredSkills: z.array(z.string()).describe('A list of required technical and soft skills.'),
});
export type AdminJobDescriptionInsightOutput = z.infer<
  typeof AdminJobDescriptionInsightOutputSchema
>;

// Internal schema for the prompt, includes the constructed data URI
const AdminJobDescriptionInsightPromptInputSchema = z.object({
  jdDataUri: z
    .string()
    .describe(
      "The Job Description file content as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});

export async function adminJobDescriptionInsight(
  input: AdminJobDescriptionInsightInput
): Promise<AdminJobDescriptionInsightOutput> {
  return adminJobDescriptionInsightFlow(input);
}

const adminJobDescriptionInsightPrompt = ai.definePrompt({
  name: 'adminJobDescriptionInsightPrompt',
  input: {schema: AdminJobDescriptionInsightPromptInputSchema},
  output: {schema: AdminJobDescriptionInsightOutputSchema},
  prompt: `You are an expert HR assistant specializing in Job Description analysis.
Your task is to analyze the provided Job Description and extract key information.

Job Description File: {{media url=jdDataUri}}

Please provide the following information based on the JD:
1. A concise summary of the job role and its main objectives.
2. A list of key requirements for candidates.
3. A list of primary responsibilities associated with the role.
4. A list of all required technical and soft skills.

Ensure the output is in the specified JSON format.`,
});

const adminJobDescriptionInsightFlow = ai.defineFlow(
  {
    name: 'adminJobDescriptionInsightFlow',
    inputSchema: AdminJobDescriptionInsightFlowInputSchema,
    outputSchema: AdminJobDescriptionInsightOutputSchema,
  },
  async (input) => {
    // Construct the data URI from the Base64 content and MIME type
    const jdDataUri = `data:${input.jdFileType};base64,${input.jdFileDataB64}`;

    const {output} = await adminJobDescriptionInsightPrompt({jdDataUri});
    return output!;
  }
);
