// app/api/interview/questions/route.ts — COMPLETE FIXED VERSION
// Key fixes:
// 1. Experience parsing handles "4", "4 years", "4+ years", "4-6 years" etc.
// 2. Resume content is deeply analysed — questions reference actual projects/tools
// 3. Experience level strictly enforced — no college questions for experienced candidates
// 4. JD-aligned — questions match what the job actually needs

import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { jobRole, experience, candidateName, resumeText, jobDescription } = await req.json();

    // ── Parse experience robustly ──────────────────────────────────────────
    // Handles: "4", "4 years", "4+ years", "4-6 years", "4.5", "four"
const parseExperience = (exp: string | number): number => {
  if (typeof exp === 'number') return exp;
  if (!exp || exp === 'null' || exp === 'undefined') return 0;
  const s = String(exp).toLowerCase().trim();
  const match = s.match(/(\d+(\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
};

    const expYears = parseExperience(experience);

    // ── Experience tier — strict labels used in prompt ─────────────────────
    const expTier =
      expYears === 0           ? 'FRESHER'    :  // 0 years — ask about education/projects
      expYears <= 1            ? 'JUNIOR'     :  // 1 year
      expYears <= 3            ? 'MID'        :  // 2-3 years
      expYears <= 6            ? 'SENIOR'     :  // 4-6 years
                                 'EXPERT';       // 7+ years

    const expLabel =
      expTier === 'FRESHER' ? '0 years (fresher/graduate)'          :
      expTier === 'JUNIOR'  ? `${expYears} year(s) (junior)`        :
      expTier === 'MID'     ? `${expYears} years (mid-level)`       :
      expTier === 'SENIOR'  ? `${expYears} years (senior)`          :
                              `${expYears} years (expert/lead)`;

    // ── Role category detection ────────────────────────────────────────────
    const roleCategory =
      /automat|selenium|cypress|playwright|appium/i.test(jobRole)            ? 'AUTOMATION_TESTER' :
      /manual\s*qa|manual\s*test|quality\s*assur/i.test(jobRole)            ? 'MANUAL_TESTER'     :
      /qa|quality|tester/i.test(jobRole)                                     ? 'QA_GENERAL'        :
      /react|angular|vue|frontend|front.end|ui\s*dev/i.test(jobRole)        ? 'FRONTEND_DEV'      :
      /node|express|backend|back.end|django|flask|spring|laravel/i.test(jobRole) ? 'BACKEND_DEV'  :
      /fullstack|full.stack|full\s*stack/i.test(jobRole)                    ? 'FULLSTACK_DEV'     :
      /python/i.test(jobRole)                                                ? 'PYTHON_DEV'        :
      /java\b/i.test(jobRole)                                               ? 'JAVA_DEV'          :
      /data\s*sci|machine\s*learn|ml\s*eng|ai\s*eng/i.test(jobRole)        ? 'DATA_ML'           :
      /data\s*eng|etl|pipeline/i.test(jobRole)                              ? 'DATA_ENGINEER'     :
      /devops|sre|cloud|aws|azure|gcp|kubernetes|docker/i.test(jobRole)     ? 'DEVOPS'            :
      /android|ios|mobile|flutter|react\s*native/i.test(jobRole)            ? 'MOBILE_DEV'        :
      /product\s*manag|pm\b/i.test(jobRole)                                 ? 'PRODUCT_MANAGER'   :
      /business\s*anal|ba\b/i.test(jobRole)                                 ? 'BUSINESS_ANALYST'  :
      /scrum|agile|project\s*manag/i.test(jobRole)                          ? 'PROJECT_MANAGER'   :
                                                                               'GENERAL_TECH';

    const isDeveloperRole = [
      'AUTOMATION_TESTER','FRONTEND_DEV','BACKEND_DEV','FULLSTACK_DEV',
      'PYTHON_DEV','JAVA_DEV','MOBILE_DEV','DATA_ML','DATA_ENGINEER',
    ].includes(roleCategory);

    // ── Experience-level question rules ────────────────────────────────────
    // These are injected verbatim into the prompt so the AI cannot ignore them.
    const experienceRules = expTier === 'FRESHER' ? `
EXPERIENCE LEVEL: FRESHER (0 years)
RULES FOR THIS CANDIDATE:
- They have NO professional work experience. Ask about college projects, internships, academic work only.
- Q2: Ask about a college project or assignment challenge — NOT a work situation.
- Q3: Ask basic conceptual fundamentals — definitions, basic differences, simple concepts.
- Q4: Ask what they have learned or built on their own — personal projects, courses, certifications.
- Q5: If coding role, give a very simple beginner function (e.g. reverse a string, find duplicates in array).
- NEVER ask about "production systems", "team conflicts at work", "clients", "release deadlines".
- Tone: encouraging, not intimidating.
` : expTier === 'JUNIOR' ? `
EXPERIENCE LEVEL: JUNIOR (${expYears} year)
RULES FOR THIS CANDIDATE:
- They have limited real work experience. Mix conceptual + practical from their actual job.
- Q2: Ask about a real work situation they faced in their ${expYears} year of experience.
- Q3: Ask about a specific tool/technology they LISTED IN THEIR RESUME — not a generic concept.
- Q4: Ask about a real project from their resume — what they built, their role, challenges.
- Q5: If coding role, give a beginner-to-moderate coding problem relevant to their stack.
- NEVER ask college-level questions. They have real job experience.
- Tone: professional, supportive.
` : expTier === 'MID' ? `
EXPERIENCE LEVEL: MID-LEVEL (${expYears} years)
RULES FOR THIS CANDIDATE:
- They have solid professional experience. Ask about real decisions, tools mastery, team work.
- Q2: Ask about a real professional challenge — disagreement with team, a difficult project, deadline pressure.
- Q3: Ask a SPECIFIC technical question about a tool/framework from their resume — not generic theory.
- Q4: Ask them to go deep on a project from their resume — architecture choices, what they would do differently.
- Q5: If coding role, give a moderate problem — something they would realistically solve at work.
- NEVER ask what is basic definition of X — they know basics. Ask HOW and WHY, not WHAT.
- Tone: direct, professional, peer-level.
` : expTier === 'SENIOR' ? `
EXPERIENCE LEVEL: SENIOR (${expYears} years)
RULES FOR THIS CANDIDATE:
- They are experienced professionals. Ask about architecture, leadership, strategy, trade-offs.
- Q2: Ask about leading a difficult technical situation — conflict, major bug in production, team challenge.
- Q3: Ask about a complex technical decision they made — why did they choose X over Y, what were the trade-offs.
- Q4: Ask about system design or process improvement — how they would architect or improve something.
- Q5: If coding role, give an intermediate-to-advanced problem — optimization, design patterns, real scenario.
- NEVER ask basic conceptual questions like "what is a JOIN" or "what is unit testing".
- Tone: peer-level, challenging, expects detailed experience-backed answers.
` : `
EXPERIENCE LEVEL: EXPERT/LEAD (${expYears} years)
RULES FOR THIS CANDIDATE:
- They are senior experts. Ask about strategy, mentorship, architecture, organisational impact.
- Q2: Ask about leading a team through a major technical challenge or org-level decision.
- Q3: Ask about building or redesigning a system/process from scratch — their approach and decisions.
- Q4: Ask about a technology evaluation they did — why they chose a stack, how they convinced stakeholders.
- Q5: If coding role, give a complex design/architecture problem — system design, not just a function.
- NEVER ask basic or intermediate questions. They should be challenged.
- Tone: executive-level, strategic, expects leadership perspective.
`;

    // ── Q5 instruction based on role + experience ─────────────────────────
    const q5Instruction = isDeveloperRole ? `
Q5 — Coding/Technical Task:
Give a real coding problem matching their ${expLabel} experience level and their tech stack from resume.
The problem MUST be directly relevant to ${jobRole}.
The question MUST contain the word "write" or "implement" to activate the coding editor.
Examples by level:
- FRESHER: "Write a function that takes an array of numbers and returns only the even ones."
- JUNIOR: "Write a function that groups an array of objects by a given key."  
- MID: "Implement a debounce function in JavaScript that limits how often a function fires."
- SENIOR: "Write a solution to find the longest substring without repeating characters and explain the time complexity."
- EXPERT: "Implement a rate limiter class that allows N requests per minute per user ID."
Match the complexity to their ${expTier} level.
` : `
Q5 — Real-World Scenario (NO coding — this is a ${roleCategory} role):
Give a realistic scenario they would face as a ${jobRole} with ${expLabel} experience.
Do NOT use the words "write", "implement", or "code".
Examples:
- MANUAL_TESTER senior: "You are assigned to test a new payment feature with 2 days before release and incomplete requirements — walk us through your approach."
- QA GENERAL mid: "You find a critical regression bug 1 hour before a production deployment — what do you do?"
- PRODUCT_MANAGER: "Two senior engineers disagree on the technical approach for a key feature — how do you resolve it?"
- BUSINESS_ANALYST: "A stakeholder keeps changing requirements after sign-off — how do you handle it?"
Make it specific to ${jobRole} at ${expLabel} level.
`;

    // ── Main prompt ────────────────────────────────────────────────────────
    const prompt = `You are an expert ${jobRole} interviewer with 15 years of hiring experience.
You are interviewing ${candidateName || 'a candidate'} for a ${jobRole} position.

═══════════════════════════════════════════
CANDIDATE RESUME:
${resumeText ? resumeText.substring(0, 3000) : 'Not provided — generate role-appropriate questions'}
═══════════════════════════════════════════

JOB DESCRIPTION:
${jobDescription ? jobDescription.substring(0, 1500) : 'Not provided'}
═══════════════════════════════════════════

CANDIDATE EXPERIENCE: ${expLabel}
ROLE CATEGORY: ${roleCategory}

${experienceRules}

═══════════════════════════════════════════
GENERATE EXACTLY 5 QUESTIONS IN THIS ORDER:
═══════════════════════════════════════════

Q1 — Professional Introduction:
Ask them to introduce themselves in a way that is specific to ${jobRole} at ${expLabel} level.
- FRESHER: "Tell us about yourself, your educational background, and what drew you to ${jobRole}."
- JUNIOR/MID: "Tell us about yourself and walk us through your journey to becoming a ${jobRole}."
- SENIOR/EXPERT: "Walk us through your career journey and the most significant impact you've made as a ${jobRole}."
Use the appropriate version for their ${expTier} level.

Q2 — Behavioral (experience-appropriate):
${expTier === 'FRESHER' 
  ? 'Ask about a challenging college project, assignment, or personal project and how they handled it.' 
  : 'Ask about a REAL PROFESSIONAL situation from their work history — challenge, conflict, achievement.'}
Make it specific to ${jobRole}.

Q3 — Technical (from their RESUME):
${resumeText 
  ? `IMPORTANT: Look at the resume above and pick ONE specific technology, tool, framework, or project they mentioned. Ask a targeted technical question about it that matches their ${expTier} level. Do NOT ask about something not in their resume. Do NOT ask generic questions like "what is an array".`
  : `Ask a technical question relevant to ${jobRole} at ${expTier} level.`}

Q4 — Deep Dive (resume project or advanced technical):
${resumeText
  ? `Pick a specific project or achievement from their resume and ask them to explain their technical decisions, challenges faced, and what they would do differently. Frame it as: "In your resume you mentioned [specific thing from their resume] — [targeted question about it]".`
  : `Ask a deeper technical or architectural question relevant to ${jobRole} at ${expTier} level.`}

${q5Instruction}

═══════════════════════════════════════════
ABSOLUTE RULES — VIOLATING THESE MAKES THE OUTPUT USELESS:
═══════════════════════════════════════════
1. Read the RESUME carefully before writing Q3 and Q4 — reference actual content from it.
2. MATCH DIFFICULTY to ${expTier} level — ${expTier === 'FRESHER' ? 'basic and encouraging' : expTier === 'JUNIOR' ? 'practical and supportive' : expTier === 'MID' ? 'professional and direct' : 'advanced and challenging'}.
3. ${expYears >= 2 ? `NEVER ask about college projects, assignments, or academic work — this candidate has ${expYears} years of PROFESSIONAL experience.` : 'Academic projects and assignments are appropriate since this is a fresher.'}
4. ${expYears >= 4 ? `NEVER ask definition-level questions (what is X, explain Y concept) — a ${expYears}-year professional already knows basics. Ask HOW, WHY, WHEN — not WHAT.` : ''}
5. Each question should be 1-3 sentences — clear and conversational. No bullet points inside questions.
6. Questions must feel like a real interviewer is asking them — natural language, not robotic.
7. For Q3 and Q4: if resume mentions specific tools (e.g. Selenium, React, PostgreSQL, Kubernetes) — USE THOSE TOOLS in your questions. Do not invent tools they didn't list.
8. Do NOT number the questions inside the strings.
9. Do NOT add explanation or commentary — only the 5 question strings.

Return ONLY a valid JSON array of exactly 5 strings. No markdown, no backticks, no explanation.
Format: ["question1", "question2", "question3", "question4", "question5"]`;

    // ── Call Groq ──────────────────────────────────────────────────────────
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role:    'system',
            content: `You are a strict technical interviewer generating personalised interview questions.
CRITICAL: Read the candidate's resume and experience level carefully before generating questions.
Questions must reference actual resume content and match the candidate's experience level exactly.
A 4-year experienced candidate should NEVER get fresher-level questions.
Output ONLY a valid JSON array of exactly 5 strings. Nothing else — no markdown, no explanation.`,
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.4,
        max_tokens:  1200,
      }),
    });

    const data = await response.json();
    const raw  = data?.choices?.[0]?.message?.content || '[]';

    let questions: string[] = [];
    try {
      const match = raw.match(/\[[\s\S]*\]/);
      questions   = JSON.parse(match ? match[0] : raw);
      if (!Array.isArray(questions) || questions.length !== 5) {
        throw new Error('Invalid question count');
      }
      // Validate all are non-empty strings
      questions = questions.map(q => String(q).trim()).filter(q => q.length > 0);
      if (questions.length !== 5) throw new Error('Some questions were empty');
    } catch (parseErr) {
      console.error('[questions] Parse error:', parseErr, 'Raw:', raw.substring(0, 200));

      // ── Fallback questions — experience-appropriate ──────────────────────
      const fallbacks = buildFallbackQuestions(jobRole, roleCategory, expTier, expYears, isDeveloperRole);
      questions = fallbacks;
    }

    console.log(`[questions] Generated for ${candidateName} | ${jobRole} | ${expLabel} | ${roleCategory}`);
    console.log('[questions] Q1:', questions[0]?.substring(0, 80));

    return NextResponse.json({ questions });

  } catch (error) {
    console.error('[questions] Failed:', error);
    return NextResponse.json({ error: 'Failed to generate questions' }, { status: 500 });
  }
}

// ─── Fallback questions — used only if Groq parsing fails ─────────────────────
function buildFallbackQuestions(
  jobRole: string,
  roleCategory: string,
  expTier: string,
  expYears: number,
  isDeveloperRole: boolean,
): string[] {

  const introQ =
    expTier === 'FRESHER'
      ? `Tell us about yourself, your educational background, and what drew you to ${jobRole}.`
      : expTier === 'JUNIOR'
      ? `Tell us about yourself and walk us through your experience as a ${jobRole} so far.`
      : `Walk us through your career as a ${jobRole} and the most significant technical contribution you've made.`;

  const behavioralQ =
    expTier === 'FRESHER'
      ? `Tell us about a challenging academic project or assignment you worked on and how you approached it.`
      : expTier === 'JUNIOR'
      ? `Describe a difficult situation you encountered in your first year of work and how you resolved it.`
      : expTier === 'MID'
      ? `Tell us about a time you disagreed with a technical decision at work — how did you handle it and what was the outcome?`
      : `Describe a situation where you had to make a critical technical decision under pressure — what was your process and what did you learn?`;

  const technicalQ: Record<string, Record<string, string>> = {
    AUTOMATION_TESTER: {
      FRESHER: `What is Selenium WebDriver and how does it interact with a browser — explain what you've learned so far.`,
      JUNIOR:  `Walk us through an automation test you wrote — what framework did you use and how did you structure it?`,
      MID:     `How do you design a Page Object Model framework from scratch, and what are the trade-offs compared to other patterns?`,
      SENIOR:  `How do you approach building a scalable automation framework that supports multiple browsers, environments, and parallel execution?`,
      EXPERT:  `How do you design a QA automation strategy for a microservices architecture — what do you automate at unit, integration, and E2E levels?`,
    },
    MANUAL_TESTER: {
      FRESHER: `What are the different types of software testing and when would you use each one?`,
      JUNIOR:  `Walk us through how you write a test case for a login feature — what would you cover?`,
      MID:     `How do you approach testing a new feature with incomplete or ambiguous requirements?`,
      SENIOR:  `How do you build and maintain a regression test suite for a rapidly changing product?`,
      EXPERT:  `How do you design and implement a QA strategy for a product with 50+ engineers and multiple release trains?`,
    },
    FRONTEND_DEV: {
      FRESHER: `What is the difference between state and props in React, and when would you use each?`,
      JUNIOR:  `Walk us through a React component you built — how did you manage state and handle side effects?`,
      MID:     `How do you approach performance optimization in a React application that is rendering slowly?`,
      SENIOR:  `How do you architect a large-scale frontend application for scalability, maintainability, and team collaboration?`,
      EXPERT:  `How do you design a micro-frontend architecture — what are the trade-offs and how do you handle shared state?`,
    },
    BACKEND_DEV: {
      FRESHER: `What is a REST API and what are the main HTTP methods — explain with an example.`,
      JUNIOR:  `Walk us through an API endpoint you built — how did you handle validation, errors, and database queries?`,
      MID:     `How do you design a REST API for a resource with complex relationships and ensure it scales?`,
      SENIOR:  `How do you handle database migrations and schema changes in a production system with zero downtime?`,
      EXPERT:  `How do you design a distributed system that needs to be highly available and eventually consistent?`,
    },
    QA_GENERAL: {
      FRESHER: `What is the difference between functional and non-functional testing — give examples of each.`,
      JUNIOR:  `Walk us through the bug lifecycle — from discovery to closure — in a project you worked on.`,
      MID:     `How do you prioritise which test cases to run when you have limited time before a release?`,
      SENIOR:  `How do you build a test strategy from scratch for a product you've never seen before?`,
      EXPERT:  `How do you align QA strategy with business goals and communicate quality metrics to non-technical stakeholders?`,
    },
    PYTHON_DEV: {
      FRESHER: `What is the difference between a list and a tuple in Python, and when would you use each?`,
      JUNIOR:  `Walk us through a Python script or tool you built — what problem did it solve and how did you structure it?`,
      MID:     `How do you handle concurrency in Python — when would you use threading, multiprocessing, or asyncio?`,
      SENIOR:  `How do you design a Python service for high throughput and low latency — what are your go-to patterns?`,
      EXPERT:  `How do you architect a Python-based data pipeline that needs to process millions of records reliably?`,
    },
    DEVOPS: {
      FRESHER: `What is CI/CD and why is it important — explain the concept in your own words.`,
      JUNIOR:  `Walk us through a CI/CD pipeline you worked with — what tools were used and what did each stage do?`,
      MID:     `How do you approach monitoring and alerting for a production system — what tools and metrics do you use?`,
      SENIOR:  `How do you design a zero-downtime deployment strategy for a containerised application on Kubernetes?`,
      EXPERT:  `How do you design the infrastructure and DevOps culture for a company scaling from 10 to 200 engineers?`,
    },
  };

  const tier = expTier as keyof typeof technicalQ['AUTOMATION_TESTER'];
  const techQ = technicalQ[roleCategory]?.[tier]
    ?? `Walk us through the most technically challenging ${jobRole} problem you have solved and how you approached it.`;

  const deepDiveQ =
    expTier === 'FRESHER'
      ? `What personal projects or self-learning have you done related to ${jobRole} outside of your coursework?`
      : expTier === 'JUNIOR'
      ? `Looking back at a project you worked on in your first year, what would you do differently now?`
      : expTier === 'MID'
      ? `Walk us through the most complex project in your resume — what was your specific contribution and what was the hardest part?`
      : `Tell us about a time you led a technical initiative or architectural change — how did you get buy-in and what was the outcome?`;

  const codingQ: Record<string, string> = {
    FRESHER: `Write a function that takes an array of numbers and returns only the unique values — explain your approach.`,
    JUNIOR:  `Write a function that groups an array of objects by a given key and returns an object with the grouped results.`,
    MID:     `Write a function that implements a simple cache with a maximum size — when full, it should remove the least recently used item.`,
    SENIOR:  `Write a solution for the longest substring without repeating characters and explain the time and space complexity.`,
    EXPERT:  `Implement a rate limiter class that allows at most N requests per minute per user ID — explain your design decisions.`,
  };

  const scenarioQ: Record<string, Record<string, string>> = {
    MANUAL_TESTER: {
      FRESHER: `You are asked to test a login feature with no test cases written yet — how do you decide what to test?`,
      JUNIOR:  `You find a critical bug 2 hours before a production release — what do you do?`,
      MID:     `You are assigned to test a complex payment flow with incomplete requirements and 3 days to release — walk us through your approach.`,
      SENIOR:  `Your team is under pressure to skip regression testing to meet a deadline — how do you handle this conversation with management?`,
      EXPERT:  `You join a company where QA is an afterthought and production bugs are frequent — how do you transform the QA culture?`,
    },
    QA_GENERAL: {
      FRESHER: `A bug you reported was marked "not a bug" by the developer — how do you handle this?`,
      JUNIOR:  `You are the only tester on a 5-person team and need to test a major feature in 2 days — how do you prioritise?`,
      MID:     `You find a critical regression 30 minutes before a release — what is your process?`,
      SENIOR:  `How do you convince leadership to invest in test automation when there is no current budget or buy-in?`,
      EXPERT:  `How do you design a quality strategy for a company moving from monolith to microservices?`,
    },
  };

  const q5 = isDeveloperRole
    ? (codingQ[expTier] ?? codingQ['MID'])
    : (scenarioQ[roleCategory]?.[expTier] ?? scenarioQ['QA_GENERAL']?.[expTier]
        ?? `You are facing a critical deadline and a major issue has just come up in your ${jobRole} work — walk us through how you handle it.`);

  return [introQ, behavioralQ, techQ, deepDiveQ, q5];
}