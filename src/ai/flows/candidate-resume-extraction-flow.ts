'use server';

import { z } from 'genkit';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse'; 

const CandidateResumeExtractionInputSchema = z.object({
  fileName: z.string(),
  fileType: z.string(),
  fileDataB64: z.string(),
});
export type CandidateResumeExtractionInput = z.infer<typeof CandidateResumeExtractionInputSchema>;

const CandidateResumeExtractionOutputSchema = z.object({
  candidateName: z.string().optional(),
  candidateEmail: z.string().optional(),
  phoneNumber: z.string().optional(),
  currentLocation: z.string().optional(),        // ← NEW
  permanentLocation: z.string().optional(),       // ← NEW
  candidateDesignation: z.string().optional(),
  experience: z.string().optional(),
  currentCtc: z.string().optional(),
  expectedCtc: z.string().optional(),
  noticePeriod: z.enum(["Immediate", "15 Days", "30 Days", "60 Days", "90 Days"]).optional(),
  isComfortableOnsite: z.enum(["Yes", "No"]).optional(),
  currentCompany: z.string().optional(),
  skills: z.array(z.string()).optional(),
});
export type CandidateResumeExtractionOutput = z.infer<typeof CandidateResumeExtractionOutputSchema>;

function parseResumeText(text: string): CandidateResumeExtractionOutput {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const JOB_TITLE_WORDS = /(?:management|engineer|developer|analyst|manager|consultant|officer|executive|associate|specialist|coordinator|director|lead|architect|designer|summary|objective|profile|experience|education|skills|contact|address|mobile|phone|email|linkedin|github|competencies|testing|agile|result|targeting|professional|dedicated|software|tester|responsibilities|description|title|client|period|tools|areas|key)/i;

  const isNameLike = (l: string) => {
    const words = l.trim().split(/\s+/);
    return (
      words.length >= 2 && words.length <= 4 &&
      words.every(w => /^[A-Za-z]+$/.test(w)) &&
      !/\d/.test(l) &&
      !l.includes('@') && !l.includes('+') &&
      !JOB_TITLE_WORDS.test(l)
    );
  };

  const toTitleCase = (s: string) =>
    s.replace(/\w+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

  const emailMatch = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  const email = emailMatch?.[0] || '';

  const phoneMatch = text.match(/(?:\+91[\s\-]?)?[6-9]\d{9}/);
  const phone = phoneMatch?.[0]?.replace(/\D/g, '').slice(-10) || '';

  const currentLocationMatch = text.match(/current\s*location\s*[:\-]\s*([^\n,]{2,40})/i);
  const currentLocation = currentLocationMatch?.[1]?.trim();

  const permanentLocationMatch = text.match(/permanent\s*location\s*[:\-]\s*([^\n,]{2,40})/i);
  const permanentLocation = permanentLocationMatch?.[1]?.trim();

  // ── moved up: companyMatch must exist before designationMatch references it ──
  const companyMatch =
    text.match(/(?:currently\s*(?:working\s*)?(?:at|with|in)|employer\s*[:\-])\s*([A-Za-z0-9\s&.,]+?)(?:\n|,|\.|\|)/i) ||
    text.match(/([A-Za-z0-9\s&.]+)\s*[\|–\-]\s*(?:present|current)/i);
  const currentCompany = companyMatch?.[1]?.trim() || '';

  // ── designation: try an explicit "Designation:" label first, then fall back
  // to the line immediately preceding a "Present/Current" marker (same pattern
  // companyMatch uses for the employer line) ──
  const directDesignationMatch = text.match(
    /(?:current\s*designation|designation|current\s*role|job\s*title)\s*[:\-]\s*([^\n,]{2,60})/i
  );
  const designationFallbackMatch = !directDesignationMatch && companyMatch
    ? text.match(/^(.*?)(?:\n).*?(?:present|current)/im)
    : null;
  const candidateDesignation =
    (directDesignationMatch?.[1] || designationFallbackMatch?.[1])?.trim();

  const onsiteMatch = text.match(/comfortable\s*(?:working\s*)?onsite\s*[:\-]?\s*(yes|no)/i);
  const isComfortableOnsite: "Yes" | "No" | undefined =
    onsiteMatch ? (onsiteMatch[1].toLowerCase() === 'yes' ? 'Yes' : 'No') : undefined;

  let nameLine = '';
  const nameLabelMatch = text.match(/(?:^|\n)\s*name\s*[:\-]\s*([A-Za-z\s]{3,40}?)(?:\n|$)/im);
  if (nameLabelMatch) nameLine = nameLabelMatch[1].trim();

  if (!nameLine && phone) {
    const rawPhone = phoneMatch?.[0] || '';
    const phoneIndex = text.indexOf(rawPhone);
    if (phoneIndex !== -1) {
      const afterLines = text.substring(phoneIndex, phoneIndex + 200).split('\n').map(l => l.trim()).filter(Boolean);
      nameLine = afterLines.slice(1).find(isNameLike) || '';
    }
  }
  if (!nameLine && email) {
    const emailIndex = text.indexOf(email);
    if (emailIndex !== -1) {
      const nearLines = text.substring(Math.max(0, emailIndex - 50), emailIndex + 300).split('\n').map(l => l.trim()).filter(Boolean);
      nameLine = nearLines.find(isNameLike) || '';
    }
  }
  if (!nameLine) nameLine = lines.find(isNameLike) || '';
  if (!nameLine) nameLine = lines[0] || '';

  const expMatch = text.match(/(\d+\.?\d*)\s*(?:\+\s*)?(?:years?|yrs?)\s*(?:of\s*)?(?:experience|exp)?/i);
  const experience = expMatch?.[1] || '';

  const ctcMatch = text.match(/current\s*ctc\s*[:\-]?\s*([0-9,.]+\s*(?:lpa|lakhs?|lacs?|k)?)/i);
  const currentCtc = ctcMatch?.[1]?.replace(/[^0-9.]/g, '') || '';

  const ectcMatch = text.match(/expected\s*ctc\s*[:\-]?\s*([0-9,.]+\s*(?:lpa|lakhs?|lacs?|k)?)/i);
  const expectedCtc = ectcMatch?.[1]?.replace(/[^0-9.]/g, '') || '';

  let noticePeriod: "Immediate" | "15 Days" | "30 Days" | "60 Days" | "90 Days" | undefined;
  const noticeMatch = text.match(/notice\s*period\s*[:\-]?\s*([^\n,]+)/i);
  if (noticeMatch) {
    const n = noticeMatch[1].toLowerCase();
    if (n.includes('immediate') || n.includes('0')) noticePeriod = 'Immediate';
    else if (n.includes('15')) noticePeriod = '15 Days';
    else if (n.includes('30') || n.includes('one month') || n.includes('1 month')) noticePeriod = '30 Days';
    else if (n.includes('60') || n.includes('two month') || n.includes('2 month')) noticePeriod = '60 Days';
    else if (n.includes('90') || n.includes('three month') || n.includes('3 month')) noticePeriod = '90 Days';
  }

  const skillsMatch = text.match(/skills?\s*[:\-]?\s*([\s\S]{0,500}?)(?:\n\n|\n[A-Z]|experience|education|$)/i);
  let skills: string[] = [];
  if (skillsMatch) {
    skills = skillsMatch[1]
      .split(/[,\n•·\|\/]/)
      .map(s => s.trim())
      .filter(s => s.length > 1 && s.length < 40 && !/^\d+$/.test(s))
      .slice(0, 20);
  }

  return {
    candidateName:  nameLine ? toTitleCase(nameLine) : undefined,
    candidateEmail: email    || undefined,
    phoneNumber:    phone    || undefined,
    experience:     experience || undefined,
    currentLocation:      currentLocation || undefined,
    permanentLocation:    permanentLocation || undefined,
    candidateDesignation: candidateDesignation || undefined,
    currentCtc:     currentCtc || undefined,
    expectedCtc:    expectedCtc || undefined,
    noticePeriod,
    isComfortableOnsite,
    currentCompany: currentCompany || undefined,
    skills:         skills.length > 0 ? skills : undefined,
  };
}

export async function candidateResumeExtraction(
  input: CandidateResumeExtractionInput
): Promise<CandidateResumeExtractionOutput> {
  const buffer = Buffer.from(input.fileDataB64, 'base64');

  const empty: CandidateResumeExtractionOutput = {
    candidateName: undefined, candidateEmail: undefined,
    phoneNumber: undefined, experience: undefined,
    currentLocation: undefined, permanentLocation: undefined,
    candidateDesignation: undefined, isComfortableOnsite: undefined,
    currentCtc: undefined, expectedCtc: undefined,
    noticePeriod: undefined, currentCompany: undefined, skills: undefined,
  };

  let text = '';

  try {
    if (input.fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
      console.log('DOCX text (first 300):', text.substring(0, 300));

    } else if (input.fileType === 'application/pdf') {
      try {
        const data = await pdfParse(buffer);
        text = data.text;
        console.log('PDF text (first 300):', text.substring(0, 300));

        if (!text || text.trim().length < 50) {
          console.warn('Weak PDF extraction - scanned/image PDF');
          return empty;
        }
      } catch (e) {
        console.error('PDF parse failed:', e);
        text = '';
      }

    } else {
      text = buffer.toString('utf-8');
    }

  } catch (err) {
    console.error('Extraction error:', err);
    return empty;
  }

  if (!text.trim()) {
    console.warn('No text extracted!');
    return empty;
  }

  const result = parseResumeText(text);
  console.log('Parsed result:', JSON.stringify(result));
  return result;
}