// app/api/interview/questions/route.ts — JD-SKILL-DRIVEN ROLE DETECTION +
// RETRY-BEFORE-FALLBACK VERSION (+ TOKEN-USAGE OPTIMIZATION)
//
// Enhancement summary (question generation, validation, role detection, and
// fallback logic only — scoring, evaluation, candidate progression, and
// interview recording are untouched, and the existing pipeline shape/response
// contract { questions: string[] } is preserved for backward compatibility):
//
// 1. ROLE DETECTION now looks at the JD's actual extracted skills (Playwright,
//    Selenium, TestNG, REST Assured, etc.) in addition to the job title, so a
//    JD titled "QA Engineer" that clearly requires Playwright/TypeScript is
//    still classified as an Automation QA interview.
//
// 2. VALIDATION is stricter and checks each requirement individually:
//    exactly 5 questions — 2 FIXED common questions (see below), then
//    3 JD questions (1 coding + 2 conceptual for automation roles) — every
//    JD question maps to an extracted skill/responsibility, every coding
//    question maps to an extracted language/tool, and no near-duplicate
//    questions among the JD questions.
//
// 3. On validation failure, the system RE-GENERATES (up to 3 attempts, each
//    one told exactly what failed last time) BEFORE falling back to the
//    fallback builder — the fallback is now a last resort, not the default
//    path on any hiccup.
//
// 4. FALLBACK LOGIC is fully JD-skill-driven — it builds coding and technical
//    questions directly from extracted JD skills/responsibilities, only
//    touching a small generic pool if literally nothing could be extracted
//    from the JD.
//
// 5. Extensive logging at every stage to make it easy to diagnose why generic
//    questions might still be appearing.
//
// ── FIXED COMMON QUESTIONS (this revision) ──────────────────────────────────
// 6. Q1 and Q2 are now FIXED and are no longer AI-generated or resume-grounded.
//    They are always, verbatim, in this order:
//      Q1: "Tell us about yourself, your educational background, and what is
//           your role in the company?"
//      Q2: "Can you walk us through a challenging project you worked on and
//           how you handled it?"
//    Only Q3-Q5 (the JD-based questions) remain AI-generated, based on the
//    candidate's resume, job description, skills, and experience — using the
//    exact same generation/validation/retry/fallback logic as before, just
//    scoped to 3 questions instead of 5. Response shape, scoring logic, and
//    all other behavior are unchanged.
//
// ── TOKEN-USAGE OPTIMIZATION (earlier revision) ─────────────────────────────
// 7. Context is extracted from the FULL raw JD/Resume exactly once. The raw
//    JD/Resume text is no longer resent during question generation — only the
//    already-extracted skills/responsibilities/highlights are sent, on every
//    one of up to 3 generation attempts.
// 8. Callers can pass `cachedContext` (the same shape returned from a prior
//    call's `extractedContext` field) to skip re-extraction entirely for the
//    same JD/Resume — this is a cache hit and costs zero extraction tokens.
// 9. max_tokens for generation reduced from 2000 -> 500 (output is now 3
//    short strings for the JD questions).
// 10. All Groq calls now go through a shared retrying client (lib/groq.ts)
//    that backs off exponentially on 429 and fails fast with a friendly
//    message if the quota wait is long (e.g. daily token limit), instead of
//    crashing with a raw API error or hanging for the full wait window.

import { NextRequest, NextResponse } from 'next/server';
import { callGroqWithRetry, GroqRateLimitError, userFriendlyRateLimitMessage } from '@/lib/groq';

const GROQ_MODEL = 'llama-3.3-70b-versatile';
const MAX_GENERATION_ATTEMPTS = 3;

// ── Question-set shape: 5 total questions ────────────────────────────────
// Q1-Q2 are FIXED (never AI-generated, never resume-grounded dynamically —
// see FIXED_COMMON_QUESTIONS below). Q3-Q5 are the AI-generated JD-based
// questions. For automation QA roles, exactly 1 of the 3 JD questions is
// hands-on coding and the other 2 are conceptual/scenario.
// Order: [Fixed1, Fixed2, JD1, JD2, JD3].
const TOTAL_QUESTIONS = 5;
const COMMON_COUNT = 2;
const JD_COUNT = 3;
const AUTOMATION_CODING_COUNT = 1;
const AUTOMATION_CONCEPTUAL_COUNT = JD_COUNT - AUTOMATION_CODING_COUNT;

// ── Fixed common questions (Q1-Q2) ───────────────────────────────────────
// These are always asked verbatim, in this order, for every interview.
// They are no longer AI-generated or resume-grounded dynamically.
const FIXED_COMMON_QUESTIONS: string[] = [
  'Tell us about yourself, your educational background, and what is your role in the company?',
  'Can you walk us through a challenging project you worked on and how you handled it?',
];

async function callGroq(system: string, user: string, maxTokens: number, temperature = 0.3, label = 'questions') {
  const result = await callGroqWithRetry({
    model: GROQ_MODEL,
    system,
    user,
    maxTokens,
    temperature,
    label,
  });
  return result.text;
}

// ── Stage A: Analyze JD + Resume before writing any questions ───────────────
interface ExtractedContext {
  jdSkills: string[];           // required technologies/languages/tools/frameworks named in JD
  jdResponsibilities: string[]; // key responsibilities/domain areas from JD
  resumeHighlights: string[];   // concrete projects/frameworks/tools/certs/achievements from resume
}

function isValidExtractedContext(val: unknown): val is ExtractedContext {
  if (!val || typeof val !== 'object') return false;
  const v = val as any;
  return (
    Array.isArray(v.jdSkills) &&
    Array.isArray(v.jdResponsibilities) &&
    Array.isArray(v.resumeHighlights)
  );
}

async function extractContext(jobDescription: string, resumeText: string, jobRole: string): Promise<ExtractedContext> {
  const empty: ExtractedContext = { jdSkills: [], jdResponsibilities: [], resumeHighlights: [] };
  if (!jobDescription && !resumeText) return empty;

  const system = `You are a precise technical recruiter. Extract concrete, verifiable facts from a Job Description and Resume. Never invent skills/tools/achievements not explicitly present. Output ONLY valid JSON, no markdown, no explanation.`;

  const user = `JOB DESCRIPTION (for a ${jobRole} role):
${jobDescription ? jobDescription.substring(0, 3000) : 'NOT PROVIDED'}

RESUME:
${resumeText ? resumeText.substring(0, 4000) : 'NOT PROVIDED'}

Return JSON exactly as:
{
  "jdSkills": ["specific technology/language/automation tool/framework explicitly named in the JD", ...],
  "jdResponsibilities": ["specific responsibility or required experience explicitly stated in the JD", ...],
  "resumeHighlights": ["specific project/framework/tool/cert/achievement explicitly stated in the resume, as a short factual sentence", ...]
}
Rules: only items explicitly present in the source text; jdSkills = concrete nouns (languages, tools like Playwright/Selenium/Cypress/Appium/WebDriver/TestNG/JUnit/REST Assured/Postman, and named practices like API Testing/CI-CD/Git/Jenkins/POM/Fixtures/Hooks/Cross-Browser Testing/SQL); jdResponsibilities include experience level; resumeHighlights specific enough to ask a targeted question (e.g. "Built Playwright+TypeScript automation for Project X", not "worked on automation"). Max 15/8/8 items respectively. Empty array if nothing extractable. Return ONLY the JSON object.`;

  try {
    const raw = await callGroq(system, user, 1400, 0.2, 'questions:extractContext');
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw);
    return {
      jdSkills: Array.isArray(parsed.jdSkills) ? parsed.jdSkills.filter(Boolean).map(String) : [],
      jdResponsibilities: Array.isArray(parsed.jdResponsibilities) ? parsed.jdResponsibilities.filter(Boolean).map(String) : [],
      resumeHighlights: Array.isArray(parsed.resumeHighlights) ? parsed.resumeHighlights.filter(Boolean).map(String) : [],
    };
  } catch (e) {
    console.error('[questions][extractContext] Extraction failed, falling back to raw text grounding:', e);
    return empty;
  }
}

// ── Role detection: JD skills + title, not title alone ──────────────────────
const STRONG_AUTOMATION_SIGNALS = /playwright|selenium|cypress|appium|webdriver|testng|junit|rest\s*assured|automation\s*framework|sdet|test\s*automation/i;
const WEAK_AUTOMATION_SIGNALS = /typescript|javascript|\bjava\b|api\s*testing|ci\/cd|postman|\bsql\b|page\s*object\s*model|\bpom\b|fixtures|hooks|cross[- ]browser/i;
const QA_TITLE_OR_JD_HINT = /\bqa\b|quality|test|sdet/i;

interface RoleDetectionResult {
  isAutomationRole: boolean;
  matchedStrongSignals: string[];
  matchedWeakSignals: string[];
  reason: string;
}

function detectAutomationRole(jobRole: string, jobDescription: string, context: ExtractedContext): RoleDetectionResult {
  const combinedText = [
    jobRole || '',
    jobDescription || '',
    context.jdSkills.join(' '),
    context.jdResponsibilities.join(' '),
  ].join(' ').toLowerCase();

  const strongMatches = combinedText.match(new RegExp(STRONG_AUTOMATION_SIGNALS, 'gi')) || [];
  const weakMatches = combinedText.match(new RegExp(WEAK_AUTOMATION_SIGNALS, 'gi')) || [];
  const hasTitleOrJdHint = QA_TITLE_OR_JD_HINT.test(jobRole || '') || QA_TITLE_OR_JD_HINT.test((jobDescription || '').substring(0, 500));

  const strongMatch = strongMatches.length > 0;
  const weakMatch = weakMatches.length > 0;

  const isAutomationRole = strongMatch || (weakMatch && hasTitleOrJdHint);

  const reason = strongMatch
    ? `Strong automation signal(s) found in JD/title: ${[...new Set(strongMatches)].join(', ')}`
    : (weakMatch && hasTitleOrJdHint)
      ? `Weak automation signal(s) [${[...new Set(weakMatches)].join(', ')}] found alongside a QA/test hint in title or JD`
      : 'No sufficient automation signals found — treating as non-automation role';

  return {
    isAutomationRole,
    matchedStrongSignals: [...new Set(strongMatches)],
    matchedWeakSignals: [...new Set(weakMatches)],
    reason,
  };
}

// ── Duplicate / near-duplicate detection ────────────────────────────────────
function normalizeWords(q: string): Set<string> {
  const stopwords = new Set(['the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'is', 'are', 'you', 'your', 'how', 'what', 'do', 'did', 'with', 'this', 'that', 'about', 'us', 'tell', 'walk', 'describe']);
  return new Set(
    q.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopwords.has(w))
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function findNearDuplicatePairs(questions: string[], threshold = 0.55): Array<[number, number]> {
  const wordSets = questions.map(normalizeWords);
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < wordSets.length; i++) {
    for (let j = i + 1; j < wordSets.length; j++) {
      if (jaccardSimilarity(wordSets[i], wordSets[j]) >= threshold) {
        pairs.push([i, j]);
      }
    }
  }
  return pairs;
}

// ── Skill-reference check (used by validation) ──────────────────────────────
function questionReferencesAny(question: string, terms: string[]): boolean {
  if (terms.length === 0) return true; // nothing to validate against — treat as pass
  const ql = question.toLowerCase();
  return terms.some(term => {
    const tl = term.toLowerCase();
    if (ql.includes(tl)) return true;
    const words = tl.split(/\s+/).filter(w => w.length > 3);
    return words.some(w => ql.includes(w));
  });
}

// ── Validation ────────────────────────────────────────────────────────────
// NOTE: `questions` here is only the AI-generated JD question set (Q3-Q5).
// Q1-Q2 are fixed (see FIXED_COMMON_QUESTIONS) and are no longer part of AI
// generation or this validation step.
interface ValidationResult {
  valid: boolean;
  reasons: string[];
  codingCount: number;
  duplicatePairs: Array<[number, number]>;
}

function validateQuestions(
  questions: string[],
  context: ExtractedContext,
  isAutomationRole: boolean,
): ValidationResult {
  const reasons: string[] = [];

  if (!Array.isArray(questions) || questions.length !== JD_COUNT) {
    reasons.push(`Expected exactly ${JD_COUNT} questions, got ${questions?.length ?? 0}`);
    return { valid: false, reasons, codingCount: 0, duplicatePairs: [] };
  }

  const jd = questions;

  const codingCount = jd.filter(q => /\b(write|implement)\b/i.test(q)).length;

  if (isAutomationRole) {
    if (codingCount !== AUTOMATION_CODING_COUNT) {
      reasons.push(`Expected exactly ${AUTOMATION_CODING_COUNT} coding question(s) among the ${JD_COUNT} JD questions, found ${codingCount}`);
    }
    const conceptualCount = jd.length - codingCount;
    if (conceptualCount !== AUTOMATION_CONCEPTUAL_COUNT) {
      reasons.push(`Expected exactly ${AUTOMATION_CONCEPTUAL_COUNT} conceptual/scenario JD question(s), found ${conceptualCount}`);
    }
    // Every coding question must reference an extracted skill (language/tool)
    if (context.jdSkills.length > 0) {
      const codingQs = jd.filter(q => /\b(write|implement)\b/i.test(q));
      codingQs.forEach((q, idx) => {
        if (!questionReferencesAny(q, context.jdSkills)) {
          reasons.push(`Coding question "${q.substring(0, 60)}..." does not reference any extracted JD skill/tool`);
        }
      });
    }
  }

  // Every JD question must reference at least one extracted skill or responsibility
  if (context.jdSkills.length > 0 || context.jdResponsibilities.length > 0) {
    const groundingTerms = [...context.jdSkills, ...context.jdResponsibilities];
    jd.forEach((q, idx) => {
      if (!questionReferencesAny(q, groundingTerms)) {
        reasons.push(`JD question #${idx + 1} ("${q.substring(0, 60)}...") does not reference any extracted JD skill/responsibility`);
      }
    });
  }

  const duplicatePairs = findNearDuplicatePairs(questions);
  if (duplicatePairs.length > 0) {
    reasons.push(`Near-duplicate questions detected at positions: ${duplicatePairs.map(p => `(${p[0] + 1},${p[1] + 1})`).join(', ')}`);
  }

  return { valid: reasons.length === 0, reasons, codingCount, duplicatePairs };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { jobRole, experience, candidateName, resumeText, jobDescription } = body;

    // ── MANUAL QUESTIONS BYPASS ─────────────────────────────────────────────
    // If the recruiter/admin has manually fed in interview questions for this
    // candidate, use those AS-IS and skip the entire AI pipeline (Stage A
    // extraction, role detection, Stage B generation, validation/retries, and
    // the fallback builder). No Groq calls are made in this path.
    //
    // Accepts either field name to match whatever the upstream "manual
    // questions" UI/form is sending: `manualQuestions`, `customQuestions`, or
    // `questionsOverride`. If your manual-entry feature uses a different field
    // name, add it to this list.
    const rawManualQuestions =
      body.manualQuestions ?? body.customQuestions ?? body.questionsOverride ?? null;

    const isManualMode =
      body.isManual === true ||
      body.useManualQuestions === true ||
      body.questionSource === 'manual' ||
      Array.isArray(rawManualQuestions);

    if (isManualMode) {
      if (!Array.isArray(rawManualQuestions) || rawManualQuestions.length === 0) {
        console.warn('[questions][manual] Manual mode was flagged but no valid question array was provided — cannot bypass AI generation without questions.');
        return NextResponse.json(
          { error: 'Manual question mode was indicated but no questions were provided.' },
          { status: 400 }
        );
      }

      const manualQuestions = rawManualQuestions
        .map((q: unknown) => String(q).trim())
        .filter((q: string) => q.length > 0);

      if (manualQuestions.length === 0) {
        console.warn('[questions][manual] Manual questions array was provided but contained no usable strings.');
        return NextResponse.json(
          { error: 'Manual questions were provided but none were valid non-empty strings.' },
          { status: 400 }
        );
      }

      console.log(`[questions][manual] Manual questions detected for ${candidateName || 'candidate'} | ${jobRole} — bypassing AI extraction/generation entirely.`);
      console.log('[questions][manual] Manual Questions Used:', manualQuestions);
      console.log('[questions][manual] Whether Fallback Was Used: N/A (manual mode)');

      return NextResponse.json({ questions: manualQuestions });
    }

    // ── Parse experience robustly ──────────────────────────────────────────
    const parseExperience = (exp: string | number): number => {
      if (typeof exp === 'number') return exp;
      if (!exp || exp === 'null' || exp === 'undefined') return 0;
      const s = String(exp).toLowerCase().trim();
      const match = s.match(/(\d+(\.\d+)?)/);
      return match ? parseFloat(match[1]) : 0;
    };

    const expYears = parseExperience(experience);

    // ── Experience tiers per spec: 0-1 Basic, 2-3 Practical, 4-6 Intermediate, 7+ Advanced ──
    const expTier =
      expYears <= 1 ? 'BASIC' :
      expYears <= 3 ? 'PRACTICAL' :
      expYears <= 6 ? 'INTERMEDIATE' :
                       'ADVANCED';

    const expLabel =
      expTier === 'BASIC'        ? `${expYears} year(s) (0-1 yrs, basic level)` :
      expTier === 'PRACTICAL'    ? `${expYears} years (2-3 yrs, practical level)` :
      expTier === 'INTERMEDIATE' ? `${expYears} years (4-6 yrs, intermediate level)` :
                                    `${expYears} years (7+ yrs, advanced level)`;

    // ── Stage A: Analyze JD + Resume BEFORE generating any questions or detecting role ──
    // TOKEN OPTIMIZATION: if the caller already has an extracted context for
    // this exact JD/Resume (e.g. cached from a prior call in the same
    // interview flow), reuse it — this is a cache hit and skips the
    // extraction call (and its ~1400 max_tokens) entirely.
    const suppliedCachedContext = body.cachedContext;
    let context: ExtractedContext;
    let contextCacheHit = false;

    if (isValidExtractedContext(suppliedCachedContext)) {
      context = suppliedCachedContext;
      contextCacheHit = true;
      console.log('[questions][stageA] Cache HIT — reusing supplied cachedContext, skipping extraction call.');
    } else {
      console.log('[questions][stageA] Cache MISS — no valid cachedContext supplied, running extraction.');
      context = await extractContext(jobDescription, resumeText, jobRole);
    }
    console.log('[questions][stageA] Extracted JD Skills:', context.jdSkills);
    console.log('[questions][stageA] Extracted JD Responsibilities:', context.jdResponsibilities);
    console.log('[questions][stageA] Extracted Resume Highlights:', context.resumeHighlights);

    // ── Role detection using JD skills + title, not title alone ────────────
    const roleDetection = detectAutomationRole(jobRole, jobDescription, context);
    const isAutomationRole = roleDetection.isAutomationRole;
    console.log('[questions][roleDetection] Job Role:', jobRole);
    console.log('[questions][roleDetection] Automation Role Detection Result:', isAutomationRole, '| Reason:', roleDetection.reason);

    // Secondary role category — used only for fallback flavor text on non-automation roles
    const roleCategory = isAutomationRole ? 'AUTOMATION_TESTER' :
      /manual\s*qa|manual\s*test|quality\s*assur/i.test(jobRole)            ? 'MANUAL_TESTER'     :
      /qa|quality|tester/i.test(jobRole)                                     ? 'QA_GENERAL'        :
      /react|angular|vue|frontend|front.end|ui\s*dev/i.test(jobRole)        ? 'FRONTEND_DEV'      :
      /node|express|backend|back.end|django|flask|spring|laravel/i.test(jobRole) ? 'BACKEND_DEV'  :
      /fullstack|full.stack|full\s*stack/i.test(jobRole)                    ? 'FULLSTACK_DEV'     :
      /python/i.test(jobRole)                                                ? 'PYTHON_DEV'        :
      /java\b/i.test(jobRole)                                               ? 'JAVA_DEV'          :
      /devops|sre|cloud|aws|azure|gcp|kubernetes|docker/i.test(jobRole)     ? 'DEVOPS'            :
                                                                               'GENERAL_TECH';
    console.log('[questions][roleDetection] Detected Role Category:', roleCategory);

    // ── Difficulty guidance per experience tier ─────────────────────────────
    const difficultyGuidance = expTier === 'BASIC' ? `
DIFFICULTY: BASIC (${expYears} yr, 0-1 yrs). Fundamentals/definitions OK, mixed with simple practical understanding. Coding = beginner-level. Tone: encouraging.
` : expTier === 'PRACTICAL' ? `
DIFFICULTY: PRACTICAL (${expYears} yrs, 2-3 yrs). Practical hands-on questions, not just definitions. Coding = beginner-to-moderate. Tone: professional, supportive.
` : expTier === 'INTERMEDIATE' ? `
DIFFICULTY: INTERMEDIATE (${expYears} yrs, 4-6 yrs). Scenario-based, implementation-level — ask HOW/WHY not WHAT. NEVER ask fresher/basic/definition questions. Coding = moderate, realistic work-level. Tone: direct, peer-level.
` : `
DIFFICULTY: ADVANCED (${expYears} yrs, 7+ yrs). Architecture, framework design, scalability, trade-offs, mentorship. NEVER ask basic/intermediate questions. Coding = complex design/architecture problems. Tone: executive/peer-level.
`;

    // ── Grounding blocks built from Stage A extraction ──────────────────────
    // TOKEN OPTIMIZATION: only the extracted, already-condensed context is
    // sent to the generation call — the raw JD/Resume text is intentionally
    // NOT included here anymore (it was previously resent in full on every
    // one of up to 3 attempts; see extractContext() above for the one place
    // the raw text is actually used).
    const hasExtractedJdSkills = context.jdSkills.length > 0;

    const jdSkillsBlock = hasExtractedJdSkills
      ? `JD SKILLS (use ONLY these): ${context.jdSkills.join(', ')}`
      : `No skills extracted from JD — base JD questions on the job title "${jobRole}" and standard responsibilities, kept as concrete as possible.`;

    const jdResponsibilitiesBlock = context.jdResponsibilities.length > 0
      ? `JD RESPONSIBILITIES/EXPERIENCE: ${context.jdResponsibilities.join('; ')}`
      : '';

    // ── JD question block instructions (3 questions) ───────────────────────
    const jdQuestionsInstruction = isAutomationRole ? `
JD QUESTIONS (${JD_COUNT}) — AUTOMATION QA RULE APPLIES (${roleDetection.reason}):
- EXACTLY ${AUTOMATION_CODING_COUNT} hands-on CODING question: text must contain "Write" or "Implement", must name a tool from JD SKILLS (e.g. "Write a Playwright script to automate a login flow.", "Implement a Page Object Model using Playwright and TypeScript."). Never ask a conceptual version ("What is Playwright?") as the coding question.
- EXACTLY ${AUTOMATION_CONCEPTUAL_COUNT} TECHNICAL/SCENARIO questions mapped to JD SKILLS/RESPONSIBILITIES (framework design, debugging, API testing, CI/CD, test strategy, POM, fixtures/hooks, cross-browser). No code required in these.
` : `
JD QUESTIONS (${JD_COUNT}): each must reference a skill/technology/responsibility from JD SKILLS/RESPONSIBILITIES above. Avoid generic phrasing unless it's the most natural way to probe an extracted skill.
`;

    // ── STAGE B: Generate the 3 JD questions (Q3-Q5) using the extracted context ──
    // Q1-Q2 are fixed (FIXED_COMMON_QUESTIONS) and are prepended after this
    // generation step completes — they are never part of the AI prompt.
    function buildPrompt(previousFailureFeedback?: string): string {
      return `Expert ${jobRole} interviewer (15 yrs) interviewing ${candidateName || 'a candidate'}.
Ground every question in the extracted facts below — do not invent skills or resume content.

${jdSkillsBlock}
${jdResponsibilitiesBlock}

CANDIDATE EXPERIENCE: ${expLabel}
ROLE CATEGORY: ${roleCategory}
AUTOMATION QA RULE APPLIES: ${isAutomationRole ? 'YES' : 'NO'}
${difficultyGuidance}
${previousFailureFeedback ? `PREVIOUS ATTEMPT FAILED — FIX:\n${previousFailureFeedback}\n` : ''}
GENERATE EXACTLY ${JD_COUNT} QUESTIONS (these are Q3-Q5 of the interview; Q1-Q2 are fixed and are NOT part of this generation):
${jdQuestionsInstruction}
RULES:
1. Exactly ${JD_COUNT} unique questions, no theme repeated in different words.
2. Order: [JD1, JD2, JD3].
3. ${isAutomationRole ? `Within the ${JD_COUNT} JD questions: exactly ${AUTOMATION_CODING_COUNT} coding ("Write"/"Implement" + named JD skill), ${AUTOMATION_CONCEPTUAL_COUNT} technical/scenario (no code), all mapped to extracted context.` : `All ${JD_COUNT} JD questions reference an extracted skill/responsibility.`}
4. Match DIFFICULTY strictly for every question — for ${expLabel}, ${expTier === 'INTERMEDIATE' || expTier === 'ADVANCED' ? 'never ask fresher/basic/definitional questions' : 'stay foundational but specific'}.
5. No vague questions (e.g. "What is your experience with testing?") — always anchor to an extracted skill/highlight.
6. Professional, 1-3 sentences, no bullets/numbering/commentary inside a question string.

Return ONLY a JSON array of exactly ${JD_COUNT} strings, no markdown/backticks/explanation.
Format: ["jd1","jd2","jd3"]`;
    }

    const system = `Strict technical interviewer generating the ${JD_COUNT} JD-based screening questions (Q3-Q5) from already-extracted, verified JD facts. The first ${COMMON_COUNT} interview questions (Q1-Q2) are fixed and are NOT part of this generation. Never invent skills/tools/resume content. Output EXACTLY ${JD_COUNT} JD-based questions. If AUTOMATION QA RULE APPLIES=YES, exactly ${AUTOMATION_CODING_COUNT} of the ${JD_COUNT} JD questions is hands-on coding ("Write"/"Implement" + a real extracted JD skill) and the remaining ${AUTOMATION_CONCEPTUAL_COUNT} are technical/scenario with no code, mapped to extracted skills/responsibilities. No two questions probe the same theme. Output ONLY a valid JSON array of exactly ${JD_COUNT} strings.`;

    // ── Generate with retry-before-fallback ─────────────────────────────────
    // `questions` here accumulates the 3 AI-generated JD questions only.
    // FIXED_COMMON_QUESTIONS is prepended once, after this block resolves
    // (via either successful generation or the fallback builder).
    let questions: string[] = [];
    let usedFallback = false;
    let fallbackReason = '';
    let lastValidation: ValidationResult | null = null;
    let previousFailureFeedback: string | undefined = undefined;
    let rateLimited = false;
    let rateLimitMessage = '';

    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
      try {
        // TOKEN OPTIMIZATION: max_tokens reduced from 2000 -> 500. The output
        // is now only 3 short question strings in a JSON array.
        const raw = await callGroq(system, buildPrompt(previousFailureFeedback), 500, attempt === 1 ? 0.4 : 0.55, `questions:generate:attempt${attempt}`);
        const match = raw.match(/\[[\s\S]*\]/);
        let candidateQuestions: string[] = JSON.parse(match ? match[0] : raw);

        if (!Array.isArray(candidateQuestions)) throw new Error('Model output was not an array');
        candidateQuestions = candidateQuestions.map(q => String(q).trim()).filter(q => q.length > 0);

        const validation = validateQuestions(candidateQuestions, context, isAutomationRole);
        lastValidation = validation;

        console.log(`[questions][attempt ${attempt}] Generated Questions:`, candidateQuestions);
        console.log(`[questions][attempt ${attempt}] Number of Coding Questions:`, validation.codingCount);
        console.log(`[questions][attempt ${attempt}] Validation Result:`, validation.valid ? 'PASS' : 'FAIL', validation.reasons);

        if (validation.valid) {
          questions = candidateQuestions;
          break;
        } else {
          previousFailureFeedback = validation.reasons.map((r, i) => `${i + 1}. ${r}`).join('\n');
          if (attempt === MAX_GENERATION_ATTEMPTS) {
            fallbackReason = `Validation failed after ${MAX_GENERATION_ATTEMPTS} attempts: ${validation.reasons.join(' | ')}`;
          }
        }
      } catch (err) {
        if (err instanceof GroqRateLimitError) {
          // Rate limit (e.g. daily token quota) — don't burn remaining
          // attempts hammering a limit that won't clear; go straight to
          // fallback (no more Groq calls) and surface a friendly message.
          console.error(`[questions][attempt ${attempt}] Rate limited:`, err.message);
          rateLimited = true;
          rateLimitMessage = userFriendlyRateLimitMessage(err);
          fallbackReason = `Rate limited by Groq: ${err.message}`;
          break;
        }
        console.error(`[questions][attempt ${attempt}] Generation/parsing error:`, err);
        previousFailureFeedback = `Previous attempt produced invalid/unparseable JSON output. Ensure the response is ONLY a valid JSON array of exactly ${JD_COUNT} strings.`;
        if (attempt === MAX_GENERATION_ATTEMPTS) {
          fallbackReason = `Generation/parsing failed after ${MAX_GENERATION_ATTEMPTS} attempts: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    }

    if (questions.length !== JD_COUNT) {
      usedFallback = true;
      console.warn('[questions] Falling back to JD-skill-driven fallback builder. Reason:', fallbackReason);
      questions = buildFallbackQuestions(jobRole, roleCategory, expTier, expYears, isAutomationRole, context);
    }

    // Prepend the fixed Q1-Q2 questions — these are never AI-generated and
    // are not part of the generation/validation/fallback logic above.
    questions = [...FIXED_COMMON_QUESTIONS, ...questions];

    console.log('[questions][summary] Candidate:', candidateName, '| Role:', jobRole, '| Experience:', expLabel, '| Role Category:', roleCategory);
    console.log('[questions][summary] Automation Role Detection Result:', isAutomationRole);
    console.log('[questions][summary] Context Cache:', contextCacheHit ? 'HIT' : 'MISS');
    console.log('[questions][summary] Whether Fallback Was Used:', usedFallback);
    if (usedFallback) console.log('[questions][summary] Reason For Fallback:', fallbackReason);
    console.log('[questions][summary] Final Questions:', questions);

    // extractedContext is returned so the caller can cache it (e.g. store on
    // the interview/candidate doc) and pass it back as `cachedContext` on
    // subsequent calls for this same JD/Resume — including to the scoring
    // route — to avoid paying for re-extraction or resending raw JD/Resume text.
    return NextResponse.json({
      questions,
      extractedContext: context,
      ...(rateLimited ? { warning: rateLimitMessage } : {}),
    });

  } catch (error) {
    if (error instanceof GroqRateLimitError) {
      console.error('[questions] Rate limited:', error.message);
      return NextResponse.json(
        { error: userFriendlyRateLimitMessage(error) },
        { status: 429 }
      );
    }
    console.error('[questions] Failed:', error);
    return NextResponse.json({ error: 'Failed to generate questions' }, { status: 500 });
  }
}

// ─── Fallback questions — JD-skill-driven, used only after all retries fail ───
// Returns only the 3 AI-scoped JD questions (Q3-Q5). Q1-Q2 are fixed
// (FIXED_COMMON_QUESTIONS) and are prepended by the caller after this
// function returns — this function no longer builds or grounds common
// questions in the resume.
function buildFallbackQuestions(
  jobRole: string,
  roleCategory: string,
  expTier: string,
  expYears: number,
  isAutomationRole: boolean,
  context: ExtractedContext,
): string[] {

  // ── JD questions (3) ────────────────────────────────────────────────────
  const skills = context.jdSkills;
  const resps = context.jdResponsibilities;
  const skillAt = (i: number) => skills.length > 0 ? skills[i % skills.length] : null;
  const respAt = (i: number) => resps.length > 0 ? resps[i % resps.length] : null;

  // Only used if literally nothing was extracted from the JD.
  const lastResortGenericPool = [
    `Walk us through the most technically challenging ${jobRole} problem you've solved and how you approached it.`,
    `What tools or technologies from this job description are you most confident with, and why?`,
    `Describe how you'd approach a key responsibility of this ${jobRole} role.`,
  ];

  const conceptualTemplates = [
    (s: string) => `How have you used ${s} in a real project, and what challenges have you run into with it?`,
    (s: string) => `Walk us through how you would debug a failing test that uses ${s}.`,
    (s: string) => `How would you design a test strategy that incorporates ${s} for this role's responsibilities?`,
  ];

  let conceptualPool: string[] = [];
  if (skills.length > 0) {
    for (let i = 0; i < AUTOMATION_CONCEPTUAL_COUNT + 1; i++) {
      conceptualPool.push(conceptualTemplates[i % conceptualTemplates.length](skillAt(i)!));
    }
  } else if (resps.length > 0) {
    for (let i = 0; i < AUTOMATION_CONCEPTUAL_COUNT + 1; i++) {
      conceptualPool.push(`Walk us through how you'd approach this responsibility from the JD: ${respAt(i)}.`);
    }
  } else {
    conceptualPool = [...lastResortGenericPool];
  }

  // Coding question — only meaningful when we have extracted JD skills.
  const codingTemplateByTier: Record<string, (a: string) => string> = {
    BASIC: (a) => `Write a simple ${a} script to automate a basic login flow.`,
    PRACTICAL: (a) => `Write a ${a} script to automate a login flow and validate a successful redirect.`,
    INTERMEDIATE: (a) => `Implement a Page Object Model using ${a} for a multi-page login and dashboard flow.`,
    ADVANCED: (a) => `Implement a reusable automation framework structure using ${a} that supports cross-browser execution and CI/CD integration.`,
  };

  let jdQuestions: string[];
  if (isAutomationRole) {
    const toolA = skillAt(0) ?? 'Playwright';
    const codingBuilder = codingTemplateByTier[expTier] ?? codingTemplateByTier['PRACTICAL'];
    const coding = codingBuilder(toolA);
    const conceptual = conceptualPool.slice(0, AUTOMATION_CONCEPTUAL_COUNT);
    jdQuestions = [coding, ...conceptual];
  } else {
    jdQuestions = conceptualPool.slice(0, JD_COUNT);
  }

  let genericIdx = 0;
  while (jdQuestions.length < JD_COUNT) {
    jdQuestions.push(lastResortGenericPool[genericIdx % lastResortGenericPool.length]);
    genericIdx++;
  }
  jdQuestions = jdQuestions.slice(0, JD_COUNT);

  console.log('[questions][fallback] Built fallback JD questions (Q3-Q5):', jdQuestions);

  return jdQuestions;
}