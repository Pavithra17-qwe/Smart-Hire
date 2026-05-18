'use server';

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const InputSchema = z.object({
  resumeText:      z.string(),
  jobRole:         z.string(),
  jobDescription:  z.string().optional().default(''),
  questionCount:   z.number().optional().default(5),
});

const QuestionSchema = z.object({
  id:         z.string(),
  question:   z.string(),
  topic:      z.string(),
  difficulty: z.enum(['easy', 'medium', 'hard']),
});

const OutputSchema = z.object({
  questions: z.array(QuestionSchema),
});

export type GenerateQuestionsInput  = z.infer<typeof InputSchema>;
export type GenerateQuestionsOutput = z.infer<typeof OutputSchema>;

export async function generateInterviewQuestions(
  input: GenerateQuestionsInput
): Promise<GenerateQuestionsOutput> {
  return generateQuestionsFlow(input);
}

const generateQuestionsFlow = ai.defineFlow(
  {
    name: 'generateInterviewQuestionsFlow',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
  },
  async (input) => {
    const prompt = `
You are a senior technical interviewer. Based on the candidate's resume and job role below,
generate exactly ${input.questionCount} technical interview questions.

JOB ROLE: ${input.jobRole}
${input.jobDescription ? `JOB DESCRIPTION: ${input.jobDescription}` : ''}

CANDIDATE RESUME:
${input.resumeText}

Rules:
- Questions must be specific to the candidate's skills and experience
- Mix difficulty: 2 easy, 2 medium, 1 hard
- Each question should be answerable verbally in 1-3 minutes
- Focus on practical knowledge, not theory

Return ONLY valid JSON, no markdown, no explanation:
{
  "questions": [
    {
      "id": "q1",
      "question": "...",
      "topic": "...",
      "difficulty": "easy" | "medium" | "hard"
    }
  ]
}`;

    const response = await ai.generate({ prompt });
    const text = response.text.replace(/```json|```/g, '').trim();

    try {
      const parsed = JSON.parse(text);
      return parsed;
    } catch {
      // Fallback generic questions if parsing fails
      return {
        questions: [
          { id: 'q1', question: `Tell me about your experience as a ${input.jobRole}.`, topic: 'General', difficulty: 'easy' },
          { id: 'q2', question: 'What is your biggest technical achievement in your current role?', topic: 'Experience', difficulty: 'easy' },
          { id: 'q3', question: 'Describe a challenging problem you solved and your approach.', topic: 'Problem Solving', difficulty: 'medium' },
          { id: 'q4', question: 'How do you stay updated with the latest technologies in your field?', topic: 'Learning', difficulty: 'medium' },
          { id: 'q5', question: 'Walk me through how you would design a solution for a complex system.', topic: 'System Design', difficulty: 'hard' },
        ],
      };
    }
  }
);