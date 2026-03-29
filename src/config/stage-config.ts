export type StageKey = 'resume' | 'l1' | 'l2' | 'hr' | 'offer';

export const STAGE_CONFIG: Record<StageKey, { title: string; editableBy: string[] }> = {
    resume: {
        title: 'Resume Screening',
        editableBy: ['admin', 'hr'], // Only admin and HR can screen resumes
    },
    l1: {
        title: 'L1 Interview',
        // REQUIREMENT 4: Use ONLY 'panel' since normalization handles 'interviewer'
        editableBy: ['admin', 'panel', 'hr'],
    },
    l2: {
        title: 'L2 Interview',
        editableBy: ['admin', 'panel', 'hr'],
    },
    hr: {
        title: 'HR Round',
        editableBy: ['admin', 'hr'],
    },
    offer: {
        title: 'Offer',
        editableBy: ['admin', 'hr'],
    },
};
