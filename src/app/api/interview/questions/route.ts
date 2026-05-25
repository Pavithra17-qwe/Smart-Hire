import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { jobRole, experience, candidateName, resumeText, jobDescription } = await req.json();

    const expYears = parseInt(experience) || 0;

    const experienceLevel =
      expYears === 0           ? 'Fresher (0 years)' :
      expYears === 1           ? 'Junior (1 year)' :
      expYears <= 3            ? 'Mid-level (2-3 years)' :
      expYears <= 6            ? 'Senior (4-6 years)' :
                                 'Expert (7+ years)';

    const roleCategory =
      /automat|selenium|cypress|playwright|appium/i.test(jobRole)           ? 'AUTOMATION_TESTER' :
      /manual\s*qa|manual\s*test|quality\s*assur/i.test(jobRole)           ? 'MANUAL_TESTER' :
      /qa|quality|tester/i.test(jobRole)                                    ? 'QA_GENERAL' :
      /react|angular|vue|frontend|front.end|ui\s*dev/i.test(jobRole)       ? 'FRONTEND_DEV' :
      /node|express|backend|back.end|django|flask|spring|laravel/i.test(jobRole) ? 'BACKEND_DEV' :
      /fullstack|full.stack|full\s*stack/i.test(jobRole)                   ? 'FULLSTACK_DEV' :
      /python/i.test(jobRole)                                               ? 'PYTHON_DEV' :
      /java\b/i.test(jobRole)                                              ? 'JAVA_DEV' :
      /data\s*sci|machine\s*learn|ml\s*eng|ai\s*eng/i.test(jobRole)       ? 'DATA_ML' :
      /data\s*eng|etl|pipeline/i.test(jobRole)                             ? 'DATA_ENGINEER' :
      /devops|sre|cloud|aws|azure|gcp|kubernetes|docker/i.test(jobRole)    ? 'DEVOPS' :
      /android|ios|mobile|flutter|react\s*native/i.test(jobRole)           ? 'MOBILE_DEV' :
      /product\s*manag|pm\b/i.test(jobRole)                                ? 'PRODUCT_MANAGER' :
      /business\s*anal|ba\b/i.test(jobRole)                                ? 'BUSINESS_ANALYST' :
      /scrum|agile|project\s*manag/i.test(jobRole)                         ? 'PROJECT_MANAGER' :
                                                                              'GENERAL_TECH';

    // Q5 should be coding only for developer/automation roles
    const needsCodingQ5 =
      roleCategory === 'AUTOMATION_TESTER' ||
      roleCategory === 'FRONTEND_DEV'      ||
      roleCategory === 'BACKEND_DEV'       ||
      roleCategory === 'FULLSTACK_DEV'     ||
      roleCategory === 'PYTHON_DEV'        ||
      roleCategory === 'JAVA_DEV'          ||
      roleCategory === 'MOBILE_DEV'        ||
      roleCategory === 'DATA_ML'           ||
      roleCategory === 'DATA_ENGINEER';

    const q5Instruction = needsCodingQ5
      ? `Q5 — Coding/Technical task: Give a short coding problem directly relevant to ${jobRole} and their experience level.
         For freshers: simple function or basic logic.
         For mid: moderate problem with edge cases.
         For senior: design or optimize something.
         Frame it as: "Here is a coding task — [actual problem]. Please write your solution or explain your approach."
         The question MUST contain the word "write" or "implement" so the coding editor activates.`
      : `Q5 — Scenario/Situational: Give a real-world scenario relevant to ${jobRole}.
         For QA roles: "How would you test [specific feature]?" or "You find a critical bug 30 min before release — what do you do?"
         For PM/BA roles: "A stakeholder keeps changing requirements — how do you handle it?"
         For DevOps: "Production is down at 2am — walk us through your response."
         Do NOT use the words "write", "implement", or "code" in this question.`;

    const experienceGuidance =
      expYears === 0 ? `
      FRESHER RULES — candidate has 0 years experience:
      - Ask only basic conceptual questions. No advanced architecture.
      - Focus on: fundamentals, college projects, internships, theoretical knowledge
      - Tone should be encouraging, not intimidating
      - For dev roles: basic syntax, simple algorithms, what they built in college
      - For QA roles: what is testing, types of testing, basic bug reporting
      - For DevOps: what is CI/CD, basic Linux commands
      ` :
      expYears <= 2 ? `
      JUNIOR RULES — candidate has ${expYears} year(s) experience:
      - Mix of concepts and some practical hands-on questions
      - Ask about real tools they have used from their resume
      - For dev: basic data structures, simple design patterns, APIs
      - For QA: test case writing, basic automation if mentioned in resume, bug lifecycle
      - Reference specific technologies from their resume
      ` :
      expYears <= 5 ? `
      MID-LEVEL RULES — candidate has ${expYears} years experience:
      - Focus on real project experience, problem-solving, tools mastery
      - Ask about specific frameworks/tools mentioned in their resume
      - For dev: system design basics, performance, code review, CI/CD
      - For QA: automation frameworks, test strategy, regression planning, team collaboration
      - Expect them to explain WHY they made decisions, not just WHAT they did
      ` : `
      SENIOR RULES — candidate has ${expYears} years experience:
      - Ask about architecture decisions, team leadership, strategy
      - For dev: system design, scalability, mentoring, technical debt
      - For QA: QA strategy, building frameworks from scratch, managing QA team
      - For DevOps: infrastructure design, disaster recovery, cost optimization
      - Expect opinionated, experience-backed answers
      `;

    const prompt = `You are an expert technical interviewer conducting a real job interview.

CANDIDATE DETAILS:
- Name: ${candidateName || 'the candidate'}
- Role applied for: ${jobRole}
- Experience: ${experienceLevel}
- Role category detected: ${roleCategory}

RESUME:
${resumeText || 'Not provided'}

JOB DESCRIPTION:
${jobDescription || 'Not provided'}

YOUR TASK:
Generate exactly 5 interview questions for this specific candidate.

${experienceGuidance}

QUESTION STRUCTURE (follow this order):
Q1 — Self Introduction: Ask them to introduce themselves. Make it role-specific.
     Example for QA: "Tell us about yourself and your testing journey."
     Example for Dev: "Walk us through your background and the most impactful project you've built."
     Example for Fresher: "Tell us about yourself, your education, and what got you interested in ${jobRole}."

Q2 — Behavioral/Situational: A real situation based on their experience level.
     Fresher: "Tell us about a challenging project or assignment and how you handled it."
     Experienced: "Tell us about a time you disagreed with your team or manager on a technical decision — how did you resolve it?"

Q3 — Role-specific Technical (based on resume + JD):
     Pick a specific technology or concept from their resume or JD and ask a targeted question.
     - QA: test lifecycle, bug reporting, specific tools they listed
     - Dev: specific language/framework from resume, real coding concept
     - DevOps: specific tool from resume (Kubernetes, Terraform, etc.)
     - Data/ML: model evaluation, pipeline design, specific library they know

Q4 — Deeper Technical or Project Deep-dive:
     Ask them to go deeper on something from their resume.
     "In your resume you mentioned [X] — can you explain how you used it and what challenges you faced?"
     Or ask a second technical concept relevant to the role and their experience level.

${q5Instruction}

CRITICAL RULES:
1. Every question must be DIFFERENT from standard generic questions
2. Use details from the resume — mention specific projects, tools, or technologies they listed
3. Questions must match the experience level — do not ask senior-level architecture questions to a fresher
4. For QA/Manual/PM/BA roles: Q5 must NOT be a coding question
5. For Developer/Automation roles: Q5 MUST be a coding task with the word "write" or "implement"
6. Keep each question to 1-2 sentences max — clear and conversational
7. Do NOT number the questions inside the strings
8. Generate questions that feel like a real human interviewer is asking them

Return ONLY a valid JSON array of exactly 5 strings. No explanation, no markdown, no extra text.
Example format: ["question1", "question2", "question3", "question4", "question5"]`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: `You are a strict technical interviewer. 
Generate interview questions that are specific to the candidate's role and experience.
Never give generic questions. Always use resume details.
Output ONLY a valid JSON array of 5 strings. Nothing else.`,
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.8, // slightly higher so questions vary each time
        max_tokens: 1000,
      }),
    });

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || '[]';

    let questions: string[] = [];
    try {
      const match = raw.match(/\[[\s\S]*\]/);
      questions = JSON.parse(match ? match[0] : raw);
      // Validate we got exactly 5 strings
      if (!Array.isArray(questions) || questions.length !== 5) {
        throw new Error('Invalid question count');
      }
    } catch {
      // Fallback questions per role category
      const fallbacks: Record<string, string[]> = {
        AUTOMATION_TESTER: [
          `Tell us about yourself and your automation testing experience.`,
          `Describe a time you had to debug a flaky test — what was the root cause and how did you fix it?`,
          `Walk us through the automation framework you've built or worked with — what design patterns did you use?`,
          `How do you decide what to automate and what to keep as manual testing?`,
          `Write a function that takes a list of product names and returns only those that contain a given keyword — describe your approach.`,
        ],
        MANUAL_TESTER: [
          `Tell us about yourself and your manual testing background.`,
          `Describe the most critical bug you ever found — how did you identify it and what was the impact?`,
          `Walk us through how you would create a test plan for a new feature from scratch.`,
          `What is the difference between regression testing and retesting, and when do you use each?`,
          `You are testing a payment gateway and find a bug 30 minutes before release — what do you do?`,
        ],
        QA_GENERAL: [
          `Tell us about yourself and your QA experience.`,
          `Tell us about the most challenging testing project you worked on and how you handled it.`,
          `Explain the software testing life cycle and where your role fits in.`,
          `How do you prioritize which test cases to run when time is limited?`,
          `A feature passes all your tests but users are still reporting bugs in production — how do you investigate?`,
        ],
        FRONTEND_DEV: [
          `Tell us about yourself and your frontend development experience.`,
          `Describe the most complex UI component you ever built and the technical challenges you faced.`,
          `How do you approach performance optimization in a React application?`,
          `Walk us through how you would architect a large-scale frontend application.`,
          `Write a function that debounces an API call triggered by a search input — explain your approach.`,
        ],
        BACKEND_DEV: [
          `Tell us about yourself and your backend development experience.`,
          `Describe a time you had to scale an API or service — what bottlenecks did you find and how did you solve them?`,
          `How do you design a REST API for a resource with complex relationships?`,
          `Walk us through how you handle database migrations in a production system without downtime.`,
          `Write a function that finds duplicate entries in a large dataset efficiently — describe your approach.`,
        ],
        PYTHON_DEV: [
          `Tell us about yourself and your Python development experience.`,
          `Describe the most complex Python project you've built and the key design decisions you made.`,
          `How do you handle concurrency in Python — when would you use threading vs multiprocessing vs asyncio?`,
          `Walk us through how you structure a Python project for maintainability and testability.`,
          `Write a Python function that reads a CSV file, filters rows where a column value exceeds a threshold, and returns the result as a list of dictionaries.`,
        ],
        DEVOPS: [
          `Tell us about yourself and your DevOps experience.`,
          `Describe a production incident you handled — what was the issue, how did you diagnose it, and what did you change afterward?`,
          `Walk us through a CI/CD pipeline you designed from scratch.`,
          `How do you approach monitoring and alerting for a microservices architecture?`,
          `Your Kubernetes pod keeps crashing with OOMKilled — walk us through how you would investigate and fix it.`,
        ],
        DATA_ML: [
          `Tell us about yourself and your data science or ML experience.`,
          `Describe an end-to-end ML project you built — from data collection to deployment.`,
          `How do you handle class imbalance in a classification problem?`,
          `Walk us through how you would evaluate and compare two different models for the same problem.`,
          `Write a Python function that splits a dataset into train/validation/test sets while maintaining class distribution — explain your approach.`,
        ],
      };

      questions = fallbacks[roleCategory] || [
        `Tell us about yourself and your experience in ${jobRole}.`,
        `Describe the most challenging project you've worked on and how you handled it.`,
        `What is a key technical concept relevant to ${jobRole} that you are confident about — explain it.`,
        `Walk us through how you approach solving a complex problem you haven't seen before.`,
        `Where do you see yourself in 2-3 years and how is this role part of that journey?`,
      ];
    }

    return NextResponse.json({ questions });
  } catch (error) {
    console.error('[questions] Failed:', error);
    return NextResponse.json({ error: 'Failed to generate questions' }, { status: 500 });
  }
}