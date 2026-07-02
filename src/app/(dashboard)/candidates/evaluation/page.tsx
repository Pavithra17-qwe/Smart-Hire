'use client';


import { useState, useEffect } from "react";
import {
  collection, addDoc, onSnapshot, serverTimestamp,
  query, where, getDocs, doc, getDoc, updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, UserPlus, Upload, FileCheck, Sparkles, Info,
  Bot, ClipboardList, Code2, AlignLeft, RotateCcw, AlertCircle,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { candidateResumeExtraction } from "@/ai/flows/candidate-resume-extraction-flow";
import { candidateMatchScoring } from "@/ai/flows/candidate-match-scoring-flow";
import { Textarea } from "@/components/ui/textarea";
import { logActivity } from "@/lib/activity-logger";


// ─── Types ─────────────────────────────────────────────────────────────────────
type InterviewMode = "ai" | "manual";


interface ProjectQuestion {
  type: "theory" | "coding";
  text: string;
  languages?: string[];
  timerMinutes?: number;
}


// ─── Constants ─────────────────────────────────────────────────────────────────
const NOTICE_PERIOD_OPTIONS = ["Immediate", "0-15 days", "15-30 days", "30-60 days", "60+ days"];
const emailRegex = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
const phoneRegex = /^[6-9]\d{9}$/;


// ─── AI Scoring helper (unchanged) ────────────────────────────────────────────
async function computeMatchScore(
  resumeFile: { data: string; type: string } | null,
  project: any,
  formData: any,
  role: string | null,
  toast: any
): Promise<{ matchScore: number; matchSummary: string }> {
  if (!resumeFile?.data) {
    return { matchScore: 0, matchSummary: "No resume uploaded — AI scoring could not be performed." };
  }
  if (!project) {
    return { matchScore: 0, matchSummary: "No project selected — AI scoring requires a Job Requisition." };
  }


  try {
    const hasManualText = !!project.jdFileData?.trim() && project.jdFileType === 'manual';
    const hasJdText     = !!project.jdText?.trim();
    const hasJdFile     = !!project.jdFileDataB64;
    const hasJdFileData = !!project.jdFileData && project.jdFileType !== 'manual';


    if (!hasManualText && !hasJdText && !hasJdFile && !hasJdFileData) {
      return {
        matchScore: 0,
        matchSummary: "This project has no Job Description. Please add a JD to the project before scoring.",
      };
    }


    toast({ title: "🤖 AI Scoring", description: "Analyzing resume against job requirements…" });


    const resolvedJdText =
      project.jdText?.trim() ||
      (project.jdFileType === 'manual' ? project.jdFileData?.trim() : '') ||
      '';


    const resolvedJdFile =
      project.jdFileDataB64 ||
      (project.jdFileType !== 'manual' ? project.jdFileData : '') ||
      '';


    const resolvedJdType =
      project.jdFileType && project.jdFileType !== 'manual'
        ? project.jdFileType
        : 'application/pdf';


    const result = await candidateMatchScoring({
      jdText:            resolvedJdText || undefined,
      jdFileDataB64:     resolvedJdFile || undefined,
      jdFileType:        resolvedJdFile ? resolvedJdType : undefined,
      resumeFileDataB64: resumeFile.data,
      resumeFileType:    resumeFile.type,
      candidateProfile: {
        experience:          formData.experience          || '',
        currentCtc:          formData.currentCtc          || '',
        expectedCtc:         formData.expectedCtc         || '',
        noticePeriod:        formData.noticePeriod        || '',
        currentLocation:     formData.currentLocation     || '',
        isComfortableOnsite: formData.isComfortableOnsite || '',
        designation:         formData.candidateDesignation || '',
      },
    });


    const score   = typeof result.matchScore === "number" ? result.matchScore : 0;
    const summary = result.summary?.trim() || `Match score: ${score}%`;


    return { matchScore: score, matchSummary: summary };
  } catch (err) {
    console.error("❌ AI scoring failed:", err);
    return { matchScore: 0, matchSummary:
      "AI scoring could not be completed because the resume or JD content exceeded the supported size limit." };
  }
}


// ─── Interview mode toggle (unchanged) ────────────────────────────────────────
function InterviewModeToggle({
  value,
  onChange,
}: {
  value: InterviewMode;
  onChange: (v: InterviewMode) => void;
}) {
  return (
    <div className="flex rounded-lg border overflow-hidden">
      <button
        type="button"
        onClick={() => onChange("ai")}
        className={cn(
          "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors",
          value === "ai"
            ? "bg-primary text-primary-foreground"
            : "bg-background text-muted-foreground hover:bg-muted"
        )}
      >
        <Bot className="h-4 w-4" />
        AI Interview
      </button>
      <button
        type="button"
        onClick={() => onChange("manual")}
        className={cn(
          "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-l",
          value === "manual"
            ? "bg-primary text-primary-foreground"
            : "bg-background text-muted-foreground hover:bg-muted"
        )}
      >
        <ClipboardList className="h-4 w-4" />
        Manual Interview
      </button>
    </div>
  );
}


// ─── Project questions preview (unchanged) ────────────────────────────────────
function ProjectQuestionsPreview({ questions }: { questions: ProjectQuestion[] }) {
  if (!questions || questions.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground text-center">
        No interview questions defined for this project.
      </div>
    );
  }


  const theoryQs = questions.filter(q => q.type === "theory");
  const codingQs = questions.filter(q => q.type === "coding");


  return (
    <div className="rounded-md border bg-muted/30 divide-y">
      <div className="px-4 py-2.5 flex items-center gap-2">
        <ClipboardList className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold">Interview Questions for this Project</span>
        <span className="ml-auto text-xs text-muted-foreground">{questions.length} question{questions.length !== 1 ? "s" : ""}</span>
      </div>
      <div className="px-4 py-3 space-y-3">
        {theoryQs.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              <AlignLeft className="h-3 w-3" /> Theory
            </div>
            {theoryQs.map((q, i) => (
              <div key={i} className="flex gap-2.5 text-sm">
                <span className="shrink-0 font-mono text-xs text-muted-foreground mt-0.5">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>{q.text}</span>
              </div>
            ))}
          </div>
        )}
        {codingQs.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              <Code2 className="h-3 w-3 text-blue-500" /> Coding
            </div>
            {codingQs.map((q, i) => (
              <div key={i} className="rounded-md bg-blue-50 border border-blue-200 p-3 space-y-1.5">
                <div className="flex gap-2.5 text-sm">
                  <span className="shrink-0 font-mono text-xs text-muted-foreground mt-0.5">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>{q.text}</span>
                </div>
                <div className="flex flex-wrap gap-3 pl-7 text-xs text-blue-700">
                  {q.languages && q.languages.length > 0 && (
                    <span>
                      Languages:{" "}
                      {q.languages.map((l, li) => (
                        <span key={l} className="font-medium">
                          {l}{li < q.languages!.length - 1 ? ", " : ""}
                        </span>
                      ))}
                    </span>
                  )}
                  {q.timerMinutes != null && (
                    <span>Timer: <span className="font-medium">{q.timerMinutes} min</span></span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// RE-EVALUATION BANNER — rendered only when isReEvaluation === true
// ─────────────────────────────────────────────────────────────────────────────
function ReEvaluationBanner({ candidate }: { candidate: any }) {
  function deriveRejectedStage(c: any): string {
    if ((c.resumeReviewStatus ?? '').toLowerCase() === 'rejected') return 'Resume Review';
    if ((c.l1Status           ?? '').toLowerCase() === 'rejected') return 'Screening';
    if ((c.l2Status           ?? '').toLowerCase() === 'rejected') return 'L1 Interview';
    if ((c.hrStatus           ?? '').toLowerCase() === 'rejected') return 'L2 Interview';
    if ((c.offerStatus        ?? '').toLowerCase() === 'rejected') return 'HR Round';
    if ((c.newOfferStatus     ?? '').toLowerCase() === 'rejected') return 'Offer';
    return c.rejectedStage || 'a previous stage';
  }


  return (
    <div className="space-y-2 mb-2">
      {/* Primary mode banner */}
      <div className="flex items-start gap-3 rounded-lg border border-blue-300 bg-blue-50 px-4 py-3">
        <RotateCcw className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-blue-800">
            Re-Evaluation Mode – Candidate previously rejected and currently under review.
          </p>
          <p className="text-xs text-blue-600 mt-0.5">
            All previously submitted information has been prefilled. Update any fields if needed,
            then submit to return this candidate to the active pipeline.
          </p>
        </div>
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// All original CandidateEvaluation code is preserved verbatim below.
// Re-evaluation additions are clearly marked with: // ── RE-EVAL EXTENSION ──
// ─────────────────────────────────────────────────────────────────────────────
export default function CandidateEvaluation() {
  const { user, role, name: loggedInName } = useAuth();
  const [projects, setProjects]             = useState<any[]>([]);
  const [isLoading, setIsLoading]           = useState(false);
  const [isLoadingExtracting, setIsLoadingExtracting] = useState(false);
  const [errors, setErrors]                 = useState<Record<string, string>>({});
  const { toast }                           = useToast();
  const router                              = useRouter();


  // ── NEW: interview mode state ───────────────────────────────────────────────
  const [interviewMode, setInterviewMode] = useState<InterviewMode>("ai");


  const [formData, setFormData] = useState({
    candidateName:        "",
    candidateEmail:       "",
    phoneNumber:          "",
    currentLocation:      "",
    permanentLocation:    "",
    experience:           "",
    candidateDesignation: "",
    currentCtc:           "",
    expectedCtc:          "",
    projectId:            "",
    role:                 "",
    location:             "",
    noticePeriod:         "",
    isComfortableOnsite:  "",
    comments:             "",
    resumeFile:           null as { name: string; type: string; data: string } | null,
  });


  // ── RE-EVAL EXTENSION: detect ?reEvaluate=<candidateId> query param ─────────
  const searchParams                                = useSearchParams();
  const reEvalCandidateId                           = searchParams.get("reEvaluate");
  const isReEvaluation                              = !!reEvalCandidateId;
  const [reEvalCandidate,   setReEvalCandidate]     = useState<any>(null);
  const [reEvalLoading,     setReEvalLoading]       = useState(isReEvaluation);
  const [reEvalNotFound,    setReEvalNotFound]      = useState(false);


  // ── RE-EVAL EXTENSION: fetch + prefill when in re-evaluation mode ────────────
  useEffect(() => {
    if (!isReEvaluation || !reEvalCandidateId) return;


    (async () => {
      try {
        const snap = await getDoc(doc(db, "candidates", reEvalCandidateId));
        if (!snap.exists()) { setReEvalNotFound(true); setReEvalLoading(false); return; }


        const data = snap.data();
        setReEvalCandidate({ id: snap.id, ...data });


        // Prefill all form fields from the stored candidate document
        setFormData({
          candidateName:        data.candidateName        ?? "",
          candidateEmail:       data.candidateEmail       ?? "",
          phoneNumber:          data.phoneNumber          ?? "",
          currentLocation:      data.currentLocation      ?? "",
          permanentLocation:    data.permanentLocation    ?? "",
          experience:           String(data.experience    ?? ""),
          candidateDesignation: data.candidateDesignation ?? "",
          currentCtc:           String(data.currentCtc   ?? ""),
          expectedCtc:          String(data.expectedCtc  ?? ""),
          projectId:            data.jobRequisitionId     ?? data.projectId ?? "",
          role:                 data.role                 ?? "",
          location:             data.projectLocation      ?? data.location  ?? "",
          noticePeriod:         data.noticePeriod         ?? "",
          isComfortableOnsite:  data.isComfortableOnsite  ?? "",
          comments:             data.comments             ?? "",
          // Prefill resume if stored on the candidate doc
          resumeFile: data.resumeFile
            ? data.resumeFile
            : data.resumeData
              ? { name: data.resumeName ?? "resume", type: data.resumeType ?? "application/pdf", data: data.resumeData }
              : null,
        });


        // ── RE-EVAL EXTENSION: log "Re-Evaluation Started" audit event ─────────
        await addDoc(collection(db, "candidate_history"), {
          candidateId:      snap.id,
          event:            "Re-Evaluation Started",
          stage:            "Sourcing",
          performedByUid:   "",   // populated after auth resolves — see submit
          performedByName:  "",
          performedByEmail: "",
          timestamp:        serverTimestamp(),
          note:             "Candidate opened for re-evaluation from the Rejected Candidates module.",
        });


      } catch (err) {
        console.error("Failed to load candidate for re-evaluation:", err);
        toast({ variant: "destructive", title: "Error", description: "Could not load candidate data." });
      } finally {
        setReEvalLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reEvalCandidateId]);
  // ── END RE-EVAL EXTENSION ───────────────────────────────────────────────────


  // ── Fetch projects ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!role || !user) { setProjects([]); return; }


    let q: any;
    if (role === "admin" || role === "hr") {
      q = query(collection(db, "job_requisitions"), where("status", "==", "Active"));
    } else if (role === "agency") {
      q = query(
        collection(db, "job_requisitions"),
        where("status", "==", "Active"),
        where("assignedAgencies", "array-contains", user.uid)
      );
    }
    if (!q) return;


    const unsub = onSnapshot(q, (snap: any) => {
      setProjects(snap.docs.map((d: any) => ({ ...d.data(), id: d.id })));
    });
    return () => unsub();
  }, [role, user]);


  // ── Input change handler ────────────────────────────────────────────────────
  const handleInputChange = (field: string, value: string) => {
    let processed = value;
    if (field === "phoneNumber") processed = value.replace(/[^0-9]/g, "").slice(0, 10);


    setFormData(prev => ({ ...prev, [field]: processed }));


    if (field === "projectId") {
      const project = projects.find((p: any) => p.id === value);
      if (project && value && value !== "none") {
        setFormData(prev => ({
          ...prev,
          projectId: value,
          role:      (project.roles || []).join(", ") || project.jobRole || "",
          location:  (project.locations || []).join(", ") || project.location || "",
        }));
      } else {
        setFormData(prev => ({ ...prev, projectId: value === "none" ? "none" : "", role: "", location: "" }));
      }
      // Reset to AI mode whenever the project changes
      setInterviewMode("ai");
    }


    if (errors[field]) setErrors(prev => ({ ...prev, [field]: "" }));
  };


  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;


    if (file.size > 1 * 1024 * 1024) {
      setErrors(prev => ({
        ...prev,
        resumeFile: `File too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum allowed size is 1 MB.`,
      }));
      e.target.value = '';
      return;
    }


    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (!allowedTypes.includes(file.type)) {
      setErrors(prev => ({
        ...prev,
        resumeFile: 'Invalid file type. Only PDF and DOCX files are accepted.',
      }));
      e.target.value = '';
      return;
    }


    setErrors(prev => ({ ...prev, resumeFile: "" }));
    setIsLoadingExtracting(true);


    setFormData(prev => ({
      ...prev,
      resumeFile:     { name: file.name, type: file.type, data: "" },
      candidateName:  "",
      candidateEmail: "",
      phoneNumber:    "",
      experience:     "",
      currentCtc:     "",
      expectedCtc:    "",
      noticePeriod:   "",
    }));


    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      setFormData(prev => ({ ...prev, resumeFile: { name: file.name, type: file.type, data: base64 } }));


      try {
        const extracted = await candidateResumeExtraction({
          fileName: file.name,
          fileType: file.type,
          fileDataB64: base64,
        });


        setFormData(prev => ({
          ...prev,
          candidateName:  extracted.candidateName  ?? "",
          candidateEmail: extracted.candidateEmail ?? "",
          phoneNumber:    extracted.phoneNumber    ?? "",
          experience:     String(extracted.experience ?? ""),
          currentCtc:     extracted.currentCtc    ?? "",
          expectedCtc:    extracted.expectedCtc   ?? "",
          noticePeriod:   extracted.noticePeriod  ?? "",
          currentLocation:   "",
          permanentLocation: "",
        }));


        toast({ title: "Resume Parsed", description: "Details auto-filled from resume." });
      } catch (err) {
        console.error("❌ Extraction error:", err);
        toast({ variant: "destructive", title: "Extraction Failed", description: String(err) });
      } finally {
        setIsLoadingExtracting(false);
      }
    };
    reader.readAsDataURL(file);
  };


  // ── Validation ────────────────────────────────────────────────────────────
  const validateForm = () => {
    const e: Record<string, string> = {};
    if (!formData.candidateName.trim())        e.candidateName        = "Candidate name is required.";
    if (!formData.candidateEmail.trim() || !emailRegex.test(formData.candidateEmail))
                                               e.candidateEmail       = "A valid email is required.";
    if (!formData.phoneNumber.trim() || !phoneRegex.test(formData.phoneNumber))
                                               e.phoneNumber          = "A valid 10-digit Indian phone number is required.";
    if (!formData.currentLocation.trim())   e.currentLocation   = "Current location is required.";
    if (!formData.permanentLocation.trim()) e.permanentLocation = "Permanent location is required.";
    if (!formData.experience)                  e.experience           = "Experience is required.";
    if (!formData.candidateDesignation.trim()) e.candidateDesignation = "Candidate designation is required.";
    if (!formData.currentCtc)                  e.currentCtc           = "Current CTC is required.";
    if (!formData.expectedCtc)                 e.expectedCtc          = "Expected CTC is required.";
    if (!formData.noticePeriod)                e.noticePeriod         = "Notice period is required.";
    if (!formData.isComfortableOnsite)         e.isComfortableOnsite  = "This field is required.";
    if (!formData.resumeFile)                  e.resumeFile           = "Resume is mandatory.";
    return e;
  };


  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (isLoadingExtracting) {
      toast({ title: "Please wait", description: "Resume is still being extracted…" });
      return;
    }
    const formErrors = validateForm();
    if (Object.keys(formErrors).length > 0) { setErrors(formErrors); return; }


    setIsLoading(true);
    try {
      const emailLower = formData.candidateEmail.trim().toLowerCase();


      // ── RE-EVAL EXTENSION: skip duplicate email check for re-evaluation ──────
      if (!isReEvaluation) {
        const dupSnap = await getDocs(query(collection(db, "candidates"), where("candidateEmail", "==", emailLower)));
        if (!dupSnap.empty) {
          toast({ variant: "destructive", title: "Duplicate Candidate", description: "A candidate with this email already exists." });
          setIsLoading(false);
          return;
        }
      }
      // ── END RE-EVAL EXTENSION ────────────────────────────────────────────────


      const selectedProject =
        formData.projectId && formData.projectId !== "none"
          ? projects.find(p => p.id === formData.projectId) || null
          : null;


      let matchScore = 0;
      let matchSummary = "No project selected — AI scoring skipped.";


      if (selectedProject) {
        const result = await computeMatchScore(
          formData.resumeFile,
          selectedProject,
          formData,
          role,
          toast
        );
        matchScore   = result.matchScore;
        matchSummary = result.matchSummary;
        toast({ title: "✅ AI Scoring Complete", description: `Match score: ${matchScore}%` });
      } else {
        toast({ title: "ℹ️ Scoring Skipped", description: "Project not selected — AI scoring not performed." });
      }


      // ── Auto-advance only applies in AI mode ──────────────────────────────
      const autoAdvance = interviewMode === "ai" && selectedProject && matchScore >= 80;


      // ✅ NEW — generate a token/url for manual mode too
      const isManualWithProject = interviewMode === "manual" && !!selectedProject;


      let l1Token = '';
      let l1Url   = '';


      // ✅ CHANGED — was only inside autoAdvance, now also covers manual mode
      if (autoAdvance || isManualWithProject) {
        l1Token = globalThis.crypto.randomUUID();
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
        l1Url   = `${baseUrl}/interview/${l1Token}`;
      }


      const { projectId, ...rest } = formData;


      const candidateData: any = {
        ...rest,
        candidateEmail:       emailLower,
        candidateDesignation: formData.candidateDesignation.trim() || "N/A",
        matchScore,
        matchSummary,
        aiScore:              matchScore,
        interviewMode,
        projectName:          selectedProject?.projectName || "—",
        projectQuestions:     selectedProject?.questions || [],
        projectLocation:      selectedProject?.location || (selectedProject?.locations || []).join(", ") || formData.location || "—",
        createdDate:          serverTimestamp(),
        createdBy:            user?.uid,
        createdByEmail:       user?.email || '',
        createdByRole:        role,


        // ✅ CHANGED — manual mode gets Scheduled too, not Locked
        resumeReviewStatus: (autoAdvance || isManualWithProject) ? "Accepted" : "Pending",
        l1Status:           autoAdvance
                              ? "Scheduled"
                              : isManualWithProject
                                ? "Scheduled"
                                : "Locked",
        l2Status:           "Locked",
        hrStatus:           "Locked",
        offerStatus:        "Locked",
        finalStatus:        "In Progress",
        status:             "Submitted",


        // ✅ CHANGED — autoAdvance fields (same as before)
        ...(autoAdvance && {
          l1InterviewType:       'ai',
          l1ScheduledDate:       new Date().toISOString().split('T')[0],
          l1AIInterviewToken:    l1Token,
          l1AIInterviewUrl:      l1Url,
          l1InterviewerName:     loggedInName || user?.displayName || '',
          l1InterviewerEmail:    user?.email  || '',
          resumeReviewedByEmail: user?.email  || '',
          resumeReviewedByName:  loggedInName || user?.displayName || '',
          resumeFeedback:        `Auto-advanced: AI match score ${matchScore}% ≥ 80%`,
        }),


        // ✅ NEW — manual mode fields stored on candidate doc
        ...(isManualWithProject && {
          l1InterviewType:       'manual',
          l1ScheduledDate:       new Date().toISOString().split('T')[0],
          l1AIInterviewToken:    l1Token,
          l1AIInterviewUrl:      l1Url,
          l1AIInterviewSentAt:   new Date(),
          l1InterviewerName:     loggedInName || user?.displayName || '',
          l1InterviewerEmail:    user?.email  || '',
          resumeReviewedByEmail: user?.email  || '',
          resumeReviewedByName:  loggedInName || user?.displayName || '',
          resumeFeedback:        `Auto-accepted: Manual interview mode selected`,
        }),
      };


      if (role === "agency") {
        candidateData.jobRequisitionId = selectedProject?.id || null;
        candidateData.agencyName       = loggedInName;
      } else if (selectedProject) {
        candidateData.jobRequisitionId = selectedProject.id;
      }


      // ── RE-EVAL EXTENSION: update existing doc instead of creating new one ───
      let savedCandidateId: string;


      if (isReEvaluation && reEvalCandidateId) {
        // Update the existing candidate document in-place (preserves ID + history)
        const reEvalUpdateFields = {
          ...candidateData,
          // Clear rejection metadata
          rejectedStage:      null,
          rejectionReason:    null,
          rejectionDate:      null,
          rejectedByName:     null,
          rejectedByEmail:    null,
          rejectedByUid:      null,
          // Audit fields
          reEvaluatedAt:      serverTimestamp(),
          reEvaluatedByUid:   user?.uid    || '',
          reEvaluatedByName:  loggedInName || '',
          reEvaluatedByEmail: user?.email  || '',
        };
        await updateDoc(doc(db, "candidates", reEvalCandidateId), reEvalUpdateFields);
        savedCandidateId = reEvalCandidateId;
      } else {
        // ── ORIGINAL PATH: create a new candidate document (unchanged) ─────────
        const newDocRef = await addDoc(collection(db, "candidates"), candidateData);
        savedCandidateId = newDocRef.id;
      }
      // ── END RE-EVAL EXTENSION ────────────────────────────────────────────────


      // ── AI mode: create ai_interviews doc + send email (UNCHANGED) ─────────
      if (autoAdvance && l1Token) {
        const resumeText = [
          `Name: ${formData.candidateName}`,
          `Role: ${formData.candidateDesignation}`,
          `Experience: ${formData.experience} years`,
          `Notice Period: ${formData.noticePeriod || ''}`,
        ].filter(Boolean).join('\n');


        const jobDescription =
          selectedProject?.jdText?.trim() ||
          (selectedProject?.jdFileType === 'manual' ? selectedProject?.jdFileData?.trim() : '') ||
          `Role: ${formData.candidateDesignation}`;


        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);


        await addDoc(collection(db, 'ai_interviews'), {
          token:           l1Token,
          candidateId:     savedCandidateId,
          candidateName:   formData.candidateName,
          candidateEmail:  emailLower,
          jobRole:         formData.candidateDesignation,
          resumeText,
          jobDescription,
          scheduledByUid:  user?.uid    || '',
          scheduledByName: loggedInName || '',
          status:          'pending',
          createdAt:       serverTimestamp(),
          expiresAt,
          interviewUrl:    l1Url,
          interviewMode:      'ai',
          projectQuestions:   selectedProject?.questions || [],
        });


        try {
          const { sendInterviewEmail } = await import('@/ai/flows/send-interview-email-flow');
          await sendInterviewEmail({
            candidateName:     formData.candidateName,
            candidateEmail:    emailLower,
            jobRole:           formData.candidateDesignation,
            experience:        String(formData.experience || ''),
            location:          formData.currentLocation || '',
            interviewerName:   loggedInName || '',
            interviewerEmail:  user?.email  || '',
            interviewDate:     new Date().toISOString().split('T')[0],
            interviewTime:     '',
            schedulingNotes:   `Your AI interview link: ${l1Url}\n\nPlease complete within 48 hours.`,
            interviewFeedback: '',
            stage:             'L1 Interview',
            senderRole:        'hr',
            emailType:         'interview_scheduled',
            candidateId:       savedCandidateId,
            threadMessageId:   '',
            interviewLink:     l1Url,
          });
        } catch (emailErr) {
          console.error('Auto-advance email failed:', emailErr);
        }


        toast({
          title:       "🚀 Auto-Advanced to L1!",
          description: `Score ${matchScore}% ≥ 80% — AI interview link sent to ${formData.candidateName}.`,
        });
      }


      // ✅ NEW BLOCK — Manual mode: create ai_interviews doc with project questions
      else if (isManualWithProject && l1Token) {
        const resumeText = [
          `Name: ${formData.candidateName}`,
          `Role: ${formData.candidateDesignation}`,
          `Experience: ${formData.experience} years`,
          `Notice Period: ${formData.noticePeriod || ''}`,
        ].filter(Boolean).join('\n');


        const jobDescription =
          selectedProject?.jdText?.trim() ||
          (selectedProject?.jdFileType === 'manual' ? selectedProject?.jdFileData?.trim() : '') ||
          `Role: ${formData.candidateDesignation}`;


        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);


        await addDoc(collection(db, 'ai_interviews'), {
          token:            l1Token,
          candidateId:      savedCandidateId,
          candidateName:    formData.candidateName,
          candidateEmail:   emailLower,
          jobRole:          formData.candidateDesignation,
          resumeText,
          jobDescription,
          scheduledByUid:   user?.uid    || '',
          scheduledByName:  loggedInName || '',
          status:           'pending',
          createdAt:        serverTimestamp(),
          expiresAt,
          interviewUrl:     l1Url,
          interviewMode:    'manual',
          projectQuestions: selectedProject?.questions || [],
        });


        try {
          const { sendInterviewEmail } = await import('@/ai/flows/send-interview-email-flow');
          await sendInterviewEmail({
            candidateName:     formData.candidateName,
            candidateEmail:    emailLower,
            jobRole:           formData.candidateDesignation,
            experience:        String(formData.experience || ''),
            location:          formData.currentLocation || '',
            interviewerName:   loggedInName || '',
            interviewerEmail:  user?.email  || '',
            interviewDate:     new Date().toISOString().split('T')[0],
            interviewTime:     '',
            schedulingNotes:   `AI interview link: ${l1Url}\n\nPlease complete within 48 hours.`,
            interviewFeedback: '',
            stage:             'L1 Interview',
            senderRole:        'hr',
            emailType:         'interview_scheduled',
            candidateId:       savedCandidateId,
            threadMessageId:   '',
            interviewLink:     l1Url,
          });
        } catch (emailErr) {
          console.error('Manual interview email failed:', emailErr);
        }


        toast({
          title:       "✅ Candidate Submitted (Manual Interview)",
          description: `Interview link sent to ${formData.candidateName}.`,
        });
      }


      // ✅ CHANGED — remaining else (AI mode, score < 80, no project) — same as before
      else {
        toast({
          title: matchScore < 80 && selectedProject
            ? `⚠️ Score ${matchScore}% — Sent for HR Review`
            : isReEvaluation
              ? "✅ Candidate Re-Submitted"
              : "✅ Candidate Submitted",
          description: matchScore < 80 && selectedProject
            ? "Score below 80% — HR will review and decide."
            : isReEvaluation
              ? `${formData.candidateName} has been returned to the active pipeline.`
              : "Candidate profile created successfully.",
        });
      }


      // ── Candidate history event ───────────────────────────────────────────
      await addDoc(collection(db, "candidate_history"), {
        candidateId: savedCandidateId,
        // ── RE-EVAL EXTENSION: record re-submission event ─────────────────────
        ...(isReEvaluation
          ? {
              event:            "Re-Evaluation Submitted",
              previousStatus:   "Rejected",
              newStatus:        "In Progress",
              stage:            "Sourcing",
              performedByUid:   user?.uid    || '',
              performedByName:  loggedInName || '',
              performedByEmail: user?.email  || '',
              timestamp:        serverTimestamp(),
              note: `Candidate re-evaluated and returned to active pipeline by ${loggedInName || user?.email}.`,
            }
          : {
              // ── ORIGINAL PATH: unchanged history write ──────────────────────
              ...candidateData,
            }
        ),
      });


      if (user && loggedInName && role) {
        await logActivity({
          userId:     user.uid,
          userName:   loggedInName,
          userRole:   role,
          action:     isReEvaluation
            ? "Re-Evaluation Submitted"
            : autoAdvance
              ? "Candidate Auto-Advanced to L1"
              : interviewMode === "manual"
                ? "Candidate Uploaded (Manual Interview)"
                : "Candidate Uploaded",
          stage:      autoAdvance ? "L1 Interview" : "Sourcing",
          targetType: "Candidate",
          targetId:   savedCandidateId,
          targetName: candidateData.candidateName,
        });
      }


      router.push("/candidates/history");
    } catch (error: any) {
      console.error("Submission Error:", error);
      toast({ variant: "destructive", title: "Submission Failed", description: error.message });
    } finally {
      setIsLoading(false);
    }
  };


  // ── Derived values ────────────────────────────────────────────────────────
  const isAgency          = role === "agency";
  const selectedProject   = projects.find(p => p.id === formData.projectId);
  const projectSelected   = !!selectedProject;


  const shouldShowFields =
    selectedProject &&
    selectedProject.roles?.length &&
    selectedProject.locations?.length;


  // Parse questions from the selected project
  const projectQuestions: ProjectQuestion[] = (() => {
    if (!selectedProject?.questions) return [];
    return (selectedProject.questions as any[]).map((q: any) => ({
      type:         q.type ?? "theory",
      text:         q.text ?? "",
      languages:    q.languages,
      timerMinutes: q.timerMinutes,
    }));
  })();


  // ── RE-EVAL EXTENSION: loading / not-found guards ────────────────────────
  if (isReEvaluation && reEvalLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }


  if (isReEvaluation && reEvalNotFound) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <AlertCircle className="h-12 w-12 text-red-400" />
        <p className="text-lg font-semibold">Candidate not found</p>
        <Button variant="outline" onClick={() => router.push("/candidates/rejected")}>
          Back to Rejected Candidates
        </Button>
      </div>
    );
  }
  // ── END RE-EVAL EXTENSION ────────────────────────────────────────────────


  return (
    <div className="max-w-3xl mx-auto py-8">
      {/*
       * ── RE-EVAL EXTENSION: card border colour changes in re-evaluation mode ──
       * border-t-primary  → new candidate (original)
       * border-t-blue-500 → re-evaluation mode
       * This is the ONLY visual change to the card; all inner content is unchanged.
       */}
      <Card className={cn("shadow-lg border-t-4", isReEvaluation ? "border-t-blue-500" : "border-t-primary")}>
        <CardHeader>
          <div className="flex items-center gap-3 mb-2">
            {/* ── RE-EVAL EXTENSION: swap icon + title in re-evaluation mode ── */}
            {isReEvaluation
              ? <RotateCcw className="w-6 h-6 text-blue-600" />
              : <UserPlus  className="w-6 h-6 text-primary"  />
            }
            <CardTitle className="text-2xl font-bold">
              {isReEvaluation ? "Re-Evaluate Candidate" : "New Candidate Profile"}
            </CardTitle>
          </div>
          <CardDescription>
            {isReEvaluation
              ? "Review and update the candidate's information before re-submitting to the active pipeline."
              : "Upload a resume to auto-fill details and run AI match scoring."
            }
          </CardDescription>


          {/* ── RE-EVAL EXTENSION: banner injected below description ─────────── */}
          {isReEvaluation && <ReEvaluationBanner candidate={reEvalCandidate} />}
          {/* ── END RE-EVAL EXTENSION ─────────────────────────────────────────── */}
        </CardHeader>


        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-8">


            {/* ── Resume Upload ──────────────────────────────────────────── */}
            <div className="space-y-2">
              <Label className="font-bold flex items-center gap-2">
                Upload Resume <Sparkles className="w-4 h-4 text-primary" />
              </Label>
              <label
                className={cn(
                  "flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-lg cursor-pointer transition-colors",
                  errors.resumeFile    ? "border-red-500" : "",
                  formData.resumeFile  ? "bg-green-50/50 border-green-200" : "bg-muted/50 border-border hover:bg-muted"
                )}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) {
                    const syntheticEvent = {
                      target: { files: [file], value: '' },
                    } as unknown as React.ChangeEvent<HTMLInputElement>;
                    handleFileChange(syntheticEvent);
                  }
                }}
              >
                <div className="flex flex-col items-center justify-center pt-5 pb-6 px-4 text-center">
                  {isLoadingExtracting
                    ? <Loader2 className="w-10 h-10 text-primary animate-spin" />
                    : formData.resumeFile
                      ? <FileCheck className="w-10 h-10 text-green-600" />
                      : <Upload className="w-10 h-10 text-muted-foreground mb-2" />
                  }
                  <p className="text-sm text-muted-foreground font-medium">
                    {isLoadingExtracting
                      ? "Extracting details from resume…"
                      : formData.resumeFile
                        ? formData.resumeFile.name
                        : "Click to upload or drag and drop (PDF / DOCX)"
                    }
                  </p>
                </div>
                <input type="file" className="hidden" accept=".pdf,.docx" onChange={handleFileChange} disabled={isLoadingExtracting} />
              </label>
              {errors.resumeFile && <p className="text-xs text-red-500">{errors.resumeFile}</p>}
            </div>


            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-6">


              {/* ── Project selection ──────────────────────────────────── */}
              <div className="md:col-span-2 space-y-3">


                {isAgency && (
                  <div className="flex items-start gap-2 p-3 rounded-md bg-blue-50 border border-blue-200">
                    <Info className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                    <p className="text-xs text-blue-700">
                      <strong>Only projects assigned to you are shown.</strong> Select a project to auto-fill role
                      and location. If you're not sure, choose "No project / Not sure".
                    </p>
                  </div>
                )}


                {role === "hr" && (
                  <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 border border-amber-200">
                    <Info className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                    <p className="text-xs text-amber-700">
                      All active projects (created by Admin or HR) are available for selection.
                    </p>
                  </div>
                )}


                <Label htmlFor="project" className="font-bold">
                  Client Project
                  <span className="text-muted-foreground font-normal text-xs ml-1">(optional)</span>
                </Label>


                <Select
                  value={formData.projectId}
                  onValueChange={(v: string) => handleInputChange("projectId", v)}
                >
                  <SelectTrigger id="project" className={cn({ "border-red-500": errors.projectId })}>
                    <SelectValue placeholder="Select a project (optional)…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No project / Not sure</SelectItem>
                    {projects.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.projectName}
                      </SelectItem>
                    ))}
                    {projects.length === 0 && (
                      <div className="px-4 py-2 text-sm text-muted-foreground">
                        {isAgency
                          ? "No projects assigned to you yet. Contact Admin / HR."
                          : "No active projects available."}
                      </div>
                    )}
                  </SelectContent>
                </Select>
                {errors.projectId && <p className="text-xs text-red-500">{errors.projectId}</p>}


                {/* ── Interview mode toggle — only shown when a project is selected ── */}
                {projectSelected && (
                  <div className="space-y-2 pt-1">
                    <Label className="font-bold text-sm">Interview Mode</Label>
                    <InterviewModeToggle value={interviewMode} onChange={setInterviewMode} />
                    <p className="text-xs text-muted-foreground">
                      {interviewMode === "ai"
                        ? "Candidates scoring ≥ 80% will receive an AI interview link automatically."
                        : "The interviewer will conduct the session using the questions defined in this project."}
                    </p>
                  </div>
                )}


                {/* ── Manual mode: show project questions ──────────────────── */}
                {projectSelected && interviewMode === "manual" && (
                  <ProjectQuestionsPreview questions={projectQuestions} />
                )}
              </div>


              <div className="md:col-span-2"><hr /></div>


              {/* Candidate Name */}
              <div className="space-y-2">
                <Label className="font-bold">Candidate Name</Label>
                <Input
                  value={formData.candidateName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleInputChange("candidateName", e.target.value)}
                  className={cn({ "border-red-500": errors.candidateName })}
                />
                {errors.candidateName && <p className="text-xs text-red-500">{errors.candidateName}</p>}
              </div>


              {/* Candidate Email */}
              <div className="space-y-2">
                <Label className="font-bold">Candidate Email</Label>
                <Input
                  type="email"
                  value={formData.candidateEmail}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleInputChange("candidateEmail", e.target.value)}
                  className={cn({ "border-red-500": errors.candidateEmail })}
                />
                {errors.candidateEmail && <p className="text-xs text-red-500">{errors.candidateEmail}</p>}
              </div>


              {/* Phone */}
              <div className="space-y-2">
                <Label className="font-bold">Phone Number</Label>
                <Input
                  value={formData.phoneNumber}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleInputChange("phoneNumber", e.target.value)}
                  maxLength={10}
                  className={cn({ "border-red-500": errors.phoneNumber })}
                />
                {errors.phoneNumber && <p className="text-xs text-red-500">{errors.phoneNumber}</p>}
              </div>


              {/* Current Location */}
              <div className="space-y-2">
                <Label className="font-bold">Current Location</Label>
                <Input
                  value={formData.currentLocation}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleInputChange("currentLocation", e.target.value)}
                  className={cn({ "border-red-500": errors.currentLocation })}
                />
                {errors.currentLocation && <p className="text-xs text-red-500">{errors.currentLocation}</p>}
              </div>


              {/* Permanent Location */}
              <div className="space-y-2">
                <Label className="font-bold">Permanent Location</Label>
                <Input
                  value={formData.permanentLocation}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleInputChange("permanentLocation", e.target.value)}
                  className={cn({ "border-red-500": errors.permanentLocation })}
                />
                {errors.permanentLocation && <p className="text-xs text-red-500">{errors.permanentLocation}</p>}
              </div>


              {/* Experience */}
              <div className="space-y-2">
                <Label className="font-bold">Experience (Years)</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  value={formData.experience}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleInputChange("experience", e.target.value)}
                  className={cn({ "border-red-500": errors.experience })}
                />
                {errors.experience && <p className="text-xs text-red-500">{errors.experience}</p>}
              </div>


              {/* Designation */}
              <div className="space-y-2">
                <Label className="font-bold">Candidate Designation</Label>
                <Input
                  value={formData.candidateDesignation}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleInputChange("candidateDesignation", e.target.value)}
                  className={cn({ "border-red-500": errors.candidateDesignation })}
                />
                {errors.candidateDesignation && <p className="text-xs text-red-500">{errors.candidateDesignation}</p>}
              </div>


              {/* Current CTC */}
              <div className="space-y-2">
                <Label className="font-bold">Current CTC</Label>
                <Input
                  type="number"
                  min="0"
                  value={formData.currentCtc}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleInputChange("currentCtc", e.target.value)}
                  className={cn({ "border-red-500": errors.currentCtc })}
                />
                {errors.currentCtc && <p className="text-xs text-red-500">{errors.currentCtc}</p>}
              </div>


              {/* Expected CTC */}
              <div className="space-y-2">
                <Label className="font-bold">Expected CTC</Label>
                <Input
                  type="number"
                  min="0"
                  value={formData.expectedCtc}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleInputChange("expectedCtc", e.target.value)}
                  className={cn({ "border-red-500": errors.expectedCtc })}
                />
                {errors.expectedCtc && <p className="text-xs text-red-500">{errors.expectedCtc}</p>}
              </div>


              {shouldShowFields && (
                <>
                  <div className="space-y-2">
                    <Label className="font-bold">Project Role / Designation</Label>
                    <Input value={formData.role} disabled className="bg-muted/30 cursor-not-allowed" />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">Project Location</Label>
                    <Input value={formData.location} disabled className="bg-muted/30 cursor-not-allowed" />
                  </div>
                </>
              )}


              {/* Notice Period */}
              <div className="space-y-2">
                <Label className="font-bold">Notice Period</Label>
                <Select
                  value={formData.noticePeriod}
                  onValueChange={(v: string) => handleInputChange("noticePeriod", v)}
                >
                  <SelectTrigger className={cn({ "border-red-500": errors.noticePeriod })}>
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {NOTICE_PERIOD_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
                {errors.noticePeriod && <p className="text-xs text-red-500">{errors.noticePeriod}</p>}
              </div>


              {/* Onsite comfort */}
              <div className="space-y-3">
                <Label className={cn("font-bold", { "text-red-500": errors.isComfortableOnsite })}>
                  Comfortable working onsite?
                </Label>
                <RadioGroup
                  value={formData.isComfortableOnsite}
                  onValueChange={(v: string) => handleInputChange("isComfortableOnsite", v)}
                  className="flex items-center gap-6 pt-2"
                >
                  <div className="flex items-center space-x-2"><RadioGroupItem value="Yes" id="yes" /><Label htmlFor="yes">Yes</Label></div>
                  <div className="flex items-center space-x-2"><RadioGroupItem value="No"  id="no"  /><Label htmlFor="no">No</Label></div>
                </RadioGroup>
                {errors.isComfortableOnsite && <p className="text-xs text-red-500">{errors.isComfortableOnsite}</p>}
              </div>


              {/* Comments */}
              <div className="md:col-span-2 space-y-2">
                <Label className="font-bold">Comments</Label>
                <Textarea
                  value={formData.comments}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => handleInputChange("comments", e.target.value)}
                />
              </div>
            </div>


            {/*
             * ── RE-EVAL EXTENSION: Cancel button added in re-evaluation mode ──
             * Submit button text/label changes; underlying handler is unchanged.
             */}
            <div className={cn("flex gap-3", !isReEvaluation && "block")}>
              {isReEvaluation && (
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => router.push("/candidates/rejected")}
                  disabled={isLoading || isLoadingExtracting}
                >
                  Cancel
                </Button>
              )}
              <Button
                type="submit"
                className={cn(
                  "h-12 text-lg",
                  isReEvaluation ? "flex-1 bg-blue-600 hover:bg-blue-700 gap-2" : "w-full",
                )}
                disabled={isLoading || isLoadingExtracting}
              >
                {isLoading
                  ? <><Loader2 className="animate-spin mr-2 h-5 w-5" /> {isReEvaluation ? "Re-Submitting…" : "Submitting & Scoring…"}</>
                  : isReEvaluation
                    ? <><RotateCcw className="h-5 w-5" /> Re-Submit to Active Pipeline</>
                    : "Submit Candidate"
                }
              </Button>
            </div>
            {/* ── END RE-EVAL EXTENSION ───────────────────────────────────────── */}


          </form>
        </CardContent>
      </Card>
    </div>
  );
}

