import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { jobRole, experience, candidateName, resumeText, jobDescription } = await req.json();

    const isFresher = !experience || parseInt(experience) <= 1;
    

    // Detect if this is an automation/developer role
    const isAutomationRole = /automat|selenium|cypress|playwright|appium|developer|engineer|script/i.test(jobRole);
    const isManualRole     = /manual|qa|quality|tester/i.test(jobRole) && !isAutomationRole;
    
    const prompt = `You are an AI interviewer for a ${jobRole} position.
    
    Candidate: ${candidateName || 'the candidate'}
    Experience: ${experience || '0'} years
    Resume: ${resumeText || 'Not provided'}
    Job Description: ${jobDescription || 'Not provided'}
    
    ${isAutomationRole
      ? `This is an AUTOMATION TESTER / DEVELOPER role. Generate exactly these 5 types of questions:
    1. Self introduction — ask them to introduce themselves and their automation experience
    2. Tough situation — ask about a time they handled a difficult bug, deadline, or conflict
    3. Project experience — ask about their most complex automation project and the framework used
    4. Technical question — ask a specific technical question about automation tools relevant to ${jobRole} (e.g. Selenium, Cypress, Playwright, API testing)
    5. Coding assessment — give a simple coding problem relevant to ${jobRole} (e.g. write a test case, write a function to validate something). Frame it as: "Here is a coding task: [problem statement]. Please describe your approach or write pseudocode."
    `
      : isManualRole
      ? `This is a MANUAL TESTING role. Generate exactly these 5 types of questions:
    1. Self introduction — ask them to introduce themselves and their testing background
    2. Tough situation — ask about a time they found a critical bug or handled a tough situation
    3. Project experience — ask about their most challenging manual testing project
    4. Technical QA question — ask a specific manual testing concept (test cases, STLC, bug lifecycle, regression testing)
    5. Scenario-based QA question — give a real scenario and ask how they would test it (e.g. "How would you test a login page?" or "You find a bug one hour before release — what do you do?")
    `
      : isFresher
      ? `This is a FRESHER candidate (0-1 year). Generate questions covering:
    1. Self introduction and why they chose this field
    2. College projects, internship, or personal projects they built
    3. One technical concept they are confident about relevant to ${jobRole}
    4. A challenge they faced in college or a project and how they solved it
    5. Where they see themselves in 2 years and how they are working toward it
    `
      : `This is an EXPERIENCED candidate (${experience} years). Generate questions covering:
    1. Walk through their experience and most impactful project
    2. A technically complex problem they solved and their approach
    3. How they handle disagreement with team or manager on a technical decision
    4. A time a project went wrong and what they did about it
    5. Why they are looking to move from their current role and what they want next
    `}
    
    Rules:
    - Generate exactly 5 questions in the order above
    - Question 1 must always be the self-introduction
    - Use details from the resume and job description to make questions specific
    - Keep each question clear and conversational — one or two sentences max
    - For the coding question (automation roles only), include the actual problem in the question text
    
    Return ONLY a JSON array of 5 strings. No other text. No numbering inside the strings.
    Example: ["Tell me about yourself", "question 2", "question 3", "question 4", "question 5"]`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      }),
    });

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || '[]';

    let questions: string[] = [];
    try {
      const match = raw.match(/\[[\s\S]*\]/);
      questions = JSON.parse(match ? match[0] : raw);
    } catch {
      questions = isAutomationRole ? [
        `Tell us about yourself and your automation testing experience.`,
        'Describe a time you faced a difficult bug or deadline and how you handled it.',
        `What automation framework have you worked with most and how did you use it in a project?`,
        `What is the difference between implicit and explicit wait in Selenium?`,
        'Write a simple test case to verify a login function — describe your approach step by step.',
      ] : isManualRole ? [
        `Tell us about yourself and your manual testing background.`,
        'Describe a time you found a critical bug or handled a tough testing situation.',
        `Walk us through your most challenging manual testing project.`,
        'What is the difference between regression testing and retesting?',
        'How would you test a payment page end to end — walk us through your approach.',
      ] : [
        `Tell us about yourself and why you chose ${jobRole}.`,
        'Describe a project or challenge and how you handled it.',
        `Explain a key technical skill you have related to ${jobRole}.`,
        'How do you approach solving a difficult problem?',
        `Why do you want to work as a ${jobRole}?`,
      ];
    }

    return NextResponse.json({ questions });
  } catch (error) {
    console.error('[questions] Failed:', error);
    return NextResponse.json({ error: 'Failed to generate questions' }, { status: 500 });
  }
}