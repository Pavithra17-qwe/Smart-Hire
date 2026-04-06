'use client';

import { useState, useEffect } from "react";
import { collection, addDoc, onSnapshot, serverTimestamp, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { Loader2, UserPlus, Upload, FileCheck, Sparkles, Info } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { candidateResumeExtraction } from "@/ai/flows/candidate-resume-extraction-flow";
import { candidateMatchScoring } from "@/ai/flows/candidate-match-scoring-flow";
import { Textarea } from "@/components/ui/textarea";
import { logActivity } from "@/lib/activity-logger";

const NOTICE_PERIOD_OPTIONS = ["Immediate", "0-15 days", "15-30 days", "30-60 days", "60+ days"];
const emailRegex = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
const phoneRegex = /^[6-9]\d{9}$/;

// ─── AI SCORING LOGIC ────────────────────────────────────────────────────────
// This function computes the match score + a detailed human-readable summary.
// Priority order:
//   1. JD file available → use AI JD-vs-resume scoring (most accurate)
//   2. No JD file but project metadata exists → keyword/field-based scoring
//   3. Agency with no project info → resume field-based scoring only
async function computeMatchScore(
  resumeFile: { data: string; type: string } | null,
  project: any,
  formData: any,
  role: string | null,
  toast: any
): Promise<{ matchScore: number; matchSummary: string }> {
  // No resume → cannot score
  if (!resumeFile?.data) {
    return { matchScore: 0, matchSummary: "No resume uploaded — AI scoring could not be performed." };
  }

  // ── PATH 1: JD-based AI scoring ──────────────────────────────────────────
  if (project?.jdFileData && project?.jdFileType) {
    try {
      toast({ title: "🤖 AI Scoring", description: "Comparing resume against Job Description…" });
      const result = await candidateMatchScoring({
        jdFileDataB64:    project.jdFileData,
        jdFileType:       project.jdFileType,
        resumeFileDataB64: resumeFile.data,
        resumeFileType:   resumeFile.type,
      });

      const score   = typeof result.matchScore === "number" ? result.matchScore : 0;
      const summary = result.summary?.trim() || generateScoreSummary(score, formData, project, "jd");

      return { matchScore: score, matchSummary: summary };
    } catch (err) {
      console.error("❌ JD-based AI scoring failed:", err);
      // Fall through to field-based scoring instead of giving a fake fixed score
    }
  }

  // ── PATH 2: No JD → field-based scoring with real explanation ─────────────
  toast({ title: "🤖 AI Scoring", description: "No JD available — scoring based on candidate profile…" });

  let score = 40; // base
  const reasons: string[] = [];
  const gaps: string[]    = [];

  // Experience
  const exp = parseFloat(formData.experience);
  const requiredExp = parseFloat(project?.experience || project?.minExperience || "0");
  if (!isNaN(exp)) {
    if (requiredExp > 0) {
      if (exp >= requiredExp) {
        score += 15;
        reasons.push(`Experience (${exp} yrs) meets requirement (${requiredExp}+ yrs)`);
      } else {
        gaps.push(`Experience (${exp} yrs) is below required ${requiredExp} yrs`);
      }
    } else {
      score += 10;
      reasons.push(`${exp} years of experience noted`);
    }
  } else {
    gaps.push("Experience not specified");
  }

  // Role / Designation match
  const candidateRole = (formData.candidateDesignation || "").toLowerCase();
  const projectRole   = (formData.role || project?.jobRole || "").toLowerCase();
  if (candidateRole && projectRole && candidateRole.split(" ").some((w: string) => projectRole.includes(w))) {
    score += 15;
    reasons.push(`Designation "${formData.candidateDesignation}" aligns with role "${formData.role || project?.jobRole}"`);
  } else if (projectRole) {
    gaps.push(`Designation may not align with required role "${formData.role || project?.jobRole}"`);
  }

  // Location match
  const candidateLoc = (formData.candidateLocation || "").toLowerCase();
  const projectLoc   = (formData.location || project?.location || "").toLowerCase();
  if (candidateLoc && projectLoc && (candidateLoc.includes(projectLoc) || projectLoc.includes(candidateLoc))) {
    score += 10;
    reasons.push(`Location match: ${formData.candidateLocation}`);
  } else if (projectLoc && candidateLoc) {
    gaps.push(`Location mismatch: candidate in "${formData.candidateLocation}", role requires "${formData.location || project?.location}"`);
  }

  // Notice period
  if (formData.noticePeriod) {
    if (formData.noticePeriod === "Immediate" || formData.noticePeriod === "0-15 days") {
      score += 10;
      reasons.push(`Notice period is ${formData.noticePeriod} — quick availability`);
    } else {
      score += 5;
      reasons.push(`Notice period: ${formData.noticePeriod}`);
    }
  } else {
    gaps.push("Notice period not specified");
  }

  // Onsite comfort
  if (formData.isComfortableOnsite === "Yes") {
    score += 5;
    reasons.push("Comfortable working onsite");
  }

  const finalScore  = Math.min(Math.max(score, 10), 95);
  const summary     = generateScoreSummary(finalScore, formData, project, "field", reasons, gaps);

  return { matchScore: finalScore, matchSummary: summary };
}

// ─── SCORE SUMMARY GENERATOR ─────────────────────────────────────────────────
// Produces a human-readable explanation of WHY the score is what it is.
function generateScoreSummary(
  score: number,
  formData: any,
  project: any,
  mode: "jd" | "field",
  reasons: string[] = [],
  gaps: string[]    = []
): string {
  let header = "";

  if (score === 0) {
    header = "Score: 0% — The resume could not be matched. This may happen if the resume file is unreadable or the content does not relate to the job requirements at all. Please verify the uploaded file.";
  } else if (score <= 30) {
    header = `Score: ${score}% — Very low match. The candidate's profile has significant gaps compared to what the role requires.`;
  } else if (score <= 50) {
    header = `Score: ${score}% — Below average match. The candidate meets only a few requirements and may need upskilling for this role.`;
  } else if (score <= 65) {
    header = `Score: ${score}% — Moderate match. The candidate meets some key criteria but has gaps in certain areas. Further evaluation is recommended.`;
  } else if (score <= 80) {
    header = `Score: ${score}% — Good match. The candidate meets most requirements with minor gaps. Recommended for interview.`;
  } else {
    header = `Score: ${score}% — Strong match. The candidate closely aligns with the role requirements and is highly recommended.`;
  }

  const parts: string[] = [header];

  if (mode === "jd") {
    parts.push("This score was generated by comparing the candidate's resume against the uploaded Job Description using AI analysis.");
  } else {
    parts.push("This score was generated based on candidate profile fields (no JD was available for this project).");
  }

  if (reasons.length > 0) {
    parts.push("✅ Strengths: " + reasons.join(" • "));
  }

  if (gaps.length > 0) {
    parts.push("⚠️ Gaps: " + gaps.join(" • "));
  }

  return parts.join("\n\n");
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
export default function CandidateEvaluation() {
  const { user, role, name: loggedInName } = useAuth();
  const [projects, setProjects]             = useState<any[]>([]);
  const [isLoading, setIsLoading]           = useState(false);
  const [isLoadingExtracting, setIsLoadingExtracting] = useState(false);
  const [errors, setErrors]                 = useState<Record<string, string>>({});
  const { toast }                           = useToast();
  const router                              = useRouter();

  const [hrProjectFilter, setHrProjectFilter] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    candidateName:        "",
    candidateEmail:       "",
    phoneNumber:          "",
    candidateLocation:    "",
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

  // ── Fetch projects ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!role || !user) { setProjects([]); return; }

    let q: any;

    if (role === "admin") {
      q = query(collection(db, "job_requisitions"), where("status", "==", "Active"));

    } else if (role === "hr") {
      if (!hrProjectFilter) { setProjects([]); return; }
      const base = query(collection(db, "job_requisitions"), where("status", "==", "Active"));
      if (hrProjectFilter === "admin")  q = query(base, where("createdByRole", "==", "admin"));
      else if (hrProjectFilter === "my") q = query(base, where("createdBy",     "==", user.uid));
      else                               q = query(base, where("createdByRole", "==", "hr"));

    } else if (role === "agency") {
      // Agency fetches their requirements
      q = query(collection(db, "requirements"), where("createdBy", "==", user.uid));
    }

    if (!q) return;

    const unsub = onSnapshot(q, (snap: any) => {
      setProjects(snap.docs.map((d: any) => ({ ...d.data(), id: d.id, isReq: role === "agency" })));
    });
    return () => unsub();
  }, [role, user, hrProjectFilter]);

  // ── Input change handler ────────────────────────────────────────────────────
  const handleInputChange = (field: string, value: string) => {
    let processed = value;
    if (field === "phoneNumber") processed = value.replace(/[^0-9]/g, "").slice(0, 10);

    setFormData(prev => ({ ...prev, [field]: processed }));

    // Auto-fill role + location when project is selected
    if (field === "projectId") {
      const project = projects.find((p: any) => p.id === value);
            if (role === "hr" && project) {
        setFormData(prev => ({
          ...prev,
          projectId: value,
          role:     (project.roles || []).join(", "),
          location: (project.locations || []).join(", "),
        }));
      } else if (role === "agency" && project) {
        setFormData(prev => ({
          ...prev,
          projectId: value,
          role:     project.jobRole || "",
          location: project.location || "",
        }));
      } else if (!value) {
        setFormData(prev => ({ ...prev, projectId: "", role: "", location: "" }));
      }
    }

    if (errors[field]) setErrors(prev => ({ ...prev, [field]: "" }));
  };

  // ── Resume upload + extraction ─────────────────────────────────────────────
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrors(prev => ({ ...prev, resumeFile: "" }));
    setIsLoadingExtracting(true);

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      setFormData(prev => ({ ...prev, resumeFile: { name: file.name, type: file.type, data: base64 } }));
      try {
        const extracted = await candidateResumeExtraction({ fileName: file.name, fileType: file.type, fileDataB64: base64 });
        if (extracted) {
          setFormData(prev => ({ ...prev, ...extracted, experience: String(extracted.experience || "") }));
          toast({ title: "Resume Parsed", description: "Details auto-filled from resume." });
        }
      } catch {
        toast({ variant: "destructive", title: "Extraction Failed", description: "Fill details manually." });
      } finally {
        setIsLoadingExtracting(false);
      }
    };
    reader.readAsDataURL(file);
  };

  // ── Validation ────────────────────────────────────────────────────────────
  const validateForm = () => {
    const e: Record<string, string> = {};
    if (!formData.candidateName.trim())   e.candidateName   = "Candidate name is required.";
    if (!formData.candidateEmail.trim() || !emailRegex.test(formData.candidateEmail))
      e.candidateEmail = "A valid email is required.";
    if (!formData.phoneNumber.trim() || !phoneRegex.test(formData.phoneNumber))
      e.phoneNumber = "A valid 10-digit Indian phone number is required.";
    if (!formData.candidateLocation.trim()) e.candidateLocation = "Candidate location is required.";
    if (!formData.experience)               e.experience        = "Experience is required.";
    if (!formData.candidateDesignation.trim()) e.candidateDesignation = "Candidate designation is required.";
    if (!formData.currentCtc)               e.currentCtc        = "Current CTC is required.";
    if (!formData.expectedCtc)              e.expectedCtc       = "Expected CTC is required.";
    if (!formData.noticePeriod)             e.noticePeriod      = "Notice period is required.";
    if (!formData.isComfortableOnsite)      e.isComfortableOnsite = "This field is required.";
    if (!formData.resumeFile)               e.resumeFile        = "Resume is mandatory.";

    // Project is required for HR/Admin; optional for Agency
    if (role !== "agency" && !formData.projectId) {
      e.projectId = "Project is mandatory.";
    }

    // Role + Location: only mandatory if NOT hr-auto-filled AND agency has project selected
    const isHrAutoFilled = role === "hr" && !!formData.projectId;
    if (!isHrAutoFilled && role !== "agency") {
      if (!formData.role)     e.role     = "Designation is required.";
      if (!formData.location) e.location = "Location is required.";
    }

    return e;
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const formErrors = validateForm();
    if (Object.keys(formErrors).length > 0) { setErrors(formErrors); return; }

    setIsLoading(true);
    try {
      // Duplicate email check
      const emailLower = formData.candidateEmail.trim().toLowerCase();
      const dupSnap = await getDocs(query(collection(db, "candidates"), where("candidateEmail", "==", emailLower)));
      if (!dupSnap.empty) {
        toast({ variant: "destructive", title: "Duplicate Candidate", description: "A candidate with this email already exists." });
        setIsLoading(false);
        return;
      }

      // Find selected project (may be null for agency with no project)
      const selectedProject = projects.find(p => p.id === formData.projectId) || null;

      // ── AI Scoring ────────────────────────────────────────────────────────
      const { matchScore, matchSummary } = await computeMatchScore(
        formData.resumeFile,
        selectedProject,
        formData,
        role,
        toast
      );

      toast({
        title: "✅ AI Scoring Complete",
        description: `Match score: ${matchScore}%`,
      });

      // ── Build candidate document ──────────────────────────────────────────
      const { projectId, ...rest } = formData;

      const candidateData: any = {
        ...rest,
        candidateEmail:       emailLower,
        candidateDesignation: formData.candidateDesignation.trim() || "N/A",
        matchScore,
        matchSummary,
        // aiScore is the field used by the HR Dashboard AI Evaluation widget
        aiScore:              matchScore,
        projectName:          selectedProject?.projectName || "—",
        projectLocation:      selectedProject?.location || formData.location || "—",
        createdDate:          serverTimestamp(),
        createdBy:            user?.uid,
        createdByRole:        role,
        resumeReviewStatus:   "Pending",
        l1Status:             "Locked",
        l2Status:             "Locked",
        hrStatus:             "Locked",
        offerStatus:          "Locked",
        finalStatus:          "In Progress",
        status:               "Submitted",
      };

      if (role === "agency") {
        candidateData.requirementId = selectedProject?.id || null;
        candidateData.agencyName    = loggedInName;
      } else if (selectedProject) {
        candidateData.jobRequisitionId = selectedProject.id;
      }

      const newDocRef = await addDoc(collection(db, "candidates"), candidateData);

      await addDoc(collection(db, "candidate_history"), {
        candidateId: newDocRef.id,
        ...candidateData,
      });

      if (user && loggedInName && role) {
        await logActivity({
          userId:     user.uid,
          userName:   loggedInName,
          userRole:   role,
          action:     "Candidate Uploaded",
          stage:      "Sourcing",
          targetType: "Candidate",
          targetId:   newDocRef.id,
          targetName: candidateData.candidateName,
        });
      }

      toast({ title: "Success", description: "Candidate profile created successfully." });
      router.push("/candidates/history");
    } catch (error: any) {
      console.error("Submission Error:", error);
      toast({ variant: "destructive", title: "Submission Failed", description: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  const isHrProjectSelected = role === "hr" && !!formData.projectId;
  const isAgency            = role === "agency";

  return (
    <div className="max-w-3xl mx-auto py-8">
      <Card className="shadow-lg border-t-4 border-t-primary">
        <CardHeader>
          <div className="flex items-center gap-3 mb-2">
            <UserPlus className="w-6 h-6 text-primary" />
            <CardTitle className="text-2xl font-bold">New Candidate Profile</CardTitle>
          </div>
          <CardDescription>
            Upload a resume to auto-fill details and run AI match scoring.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-8">

            {/* ── Resume Upload ─────────────────────────────────────────── */}
            <div className="space-y-2">
              <Label className="font-bold flex items-center gap-2">
                Upload Resume <Sparkles className="w-4 h-4 text-primary" />
              </Label>
              <label className={cn(
                "flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-lg cursor-pointer transition-colors",
                errors.resumeFile   ? "border-red-500" : "",
                formData.resumeFile ? "bg-green-50/50 border-green-200" : "bg-muted/50 border-border hover:bg-muted"
              )}>
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
              <div className="md:col-span-2 space-y-2">
                {role === "hr" && (
                  <div className="mb-3 p-3 rounded-md bg-muted/50">
                    <Label className="font-bold text-sm">Filter Projects By</Label>
                    <RadioGroup
                      value={hrProjectFilter || ""}
                      onValueChange={setHrProjectFilter}
                      className="flex items-center gap-4 mt-2"
                    >
                      <div className="flex items-center space-x-2"><RadioGroupItem value="my" id="my" /><Label htmlFor="my">My Projects</Label></div>
                      <div className="flex items-center space-x-2"><RadioGroupItem value="all_hr" id="all_hr" /><Label htmlFor="all_hr">All HR Projects</Label></div>
                      <div className="flex items-center space-x-2"><RadioGroupItem value="admin" id="admin" /><Label htmlFor="admin">Admin Projects</Label></div>
                    </RadioGroup>
                  </div>
                )}

                {/* Agency notice — project is optional */}
                {isAgency && (
                  <div className="flex items-start gap-2 p-3 rounded-md bg-blue-50 border border-blue-200 mb-2">
                    <Info className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                    <p className="text-xs text-blue-700">
                      <strong>Project selection is optional for Agency.</strong> If you know the project, select it to auto-fill role and location. If not, the AI will score based on candidate profile fields.
                    </p>
                  </div>
                )}

                <Label htmlFor="project" className="font-bold">
                  Job Requisition / Project {isAgency && <span className="text-muted-foreground font-normal text-xs ml-1">(optional)</span>}
                </Label>
                <Select
                  value={formData.projectId}
                  onValueChange={(v: string) => handleInputChange("projectId", v)}
                                    disabled={role === "hr" && !hrProjectFilter}
                >
                  <SelectTrigger id="project" className={cn({ "border-red-500": errors.projectId })}>
                    <SelectValue placeholder={
                      role === "hr" && !hrProjectFilter
                        ? "Select a filter above first"
                        : isAgency
                          ? "Select your project (optional)…"
                          : "Select a project…"
                    } />
                  </SelectTrigger>
                  <SelectContent>
                    {isAgency && (
                      <SelectItem value="none">No project / Not sure</SelectItem>
                    )}
                    {projects
                      .filter(p => {
                        if (isAgency) {
                          const name = (p.projectName || "").toLowerCase().trim();
                          return name && name !== "n/a";
                        }
                        return true;
                      })
                      .map((p: any) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.projectName}
                          {!isAgency && ` (${p.createdByName || p.createdByRole || ""})`}
                        </SelectItem>
                      ))
                    }
                    {projects.length === 0 && (
                      <div className="px-4 py-2 text-sm text-muted-foreground">No projects available.</div>
                    )}
                  </SelectContent>
                </Select>
                {errors.projectId && <p className="text-xs text-red-500">{errors.projectId}</p>}
              </div>

              <div className="md:col-span-2"><hr /></div>

              {/* Candidate Name */}
              <div className="space-y-2">
                <Label className="font-bold">Candidate Name</Label>
                <Input value={formData.candidateName} onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
  handleInputChange("candidateName", e.target.value)
} className={cn({ "border-red-500": errors.candidateName })} />
                {errors.candidateName && <p className="text-xs text-red-500">{errors.candidateName}</p>}
              </div>

              {/* Candidate Email */}
              <div className="space-y-2">
                <Label className="font-bold">Candidate Email</Label>
                <Input type="email" value={formData.candidateEmail} onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
  handleInputChange("candidateEmail", e.target.value)
} className={cn({ "border-red-500": errors.candidateEmail })} />
                {errors.candidateEmail && <p className="text-xs text-red-500">{errors.candidateEmail}</p>}
              </div>

              {/* Phone */}
              <div className="space-y-2">
                <Label className="font-bold">Phone Number</Label>
                <Input value={formData.phoneNumber} onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
  handleInputChange("phoneNumber", e.target.value)
} maxLength={10} className={cn({ "border-red-500": errors.phoneNumber })} />
                {errors.phoneNumber && <p className="text-xs text-red-500">{errors.phoneNumber}</p>}
              </div>

              {/* Candidate Location */}
              <div className="space-y-2">
                <Label className="font-bold">Candidate Location</Label>
                <Input value={formData.candidateLocation} onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
  handleInputChange("candidateLocation", e.target.value)
} className={cn({ "border-red-500": errors.candidateLocation })} />
                {errors.candidateLocation && <p className="text-xs text-red-500">{errors.candidateLocation}</p>}
              </div>

              {/* Experience */}
              <div className="space-y-2">
                <Label className="font-bold">Experience (Years)</Label>
                <Input type="number" step="0.1" value={formData.experience}onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
  handleInputChange("experience", e.target.value)
} className={cn({ "border-red-500": errors.experience })} />
                {errors.experience && <p className="text-xs text-red-500">{errors.experience}</p>}
              </div>

              {/* Designation */}
              <div className="space-y-2">
                <Label className="font-bold">Candidate Designation</Label>
                <Input value={formData.candidateDesignation} onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
  handleInputChange("candidateDesignation", e.target.value)
} className={cn({ "border-red-500": errors.candidateDesignation })} />
                {errors.candidateDesignation && <p className="text-xs text-red-500">{errors.candidateDesignation}</p>}
              </div>

              {/* Current CTC */}
              <div className="space-y-2">
                <Label className="font-bold">Current CTC</Label>
                <Input type="number" value={formData.currentCtc} onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
  handleInputChange("currentCtc", e.target.value)
} className={cn({ "border-red-500": errors.currentCtc })} />
                {errors.currentCtc && <p className="text-xs text-red-500">{errors.currentCtc}</p>}
              </div>

              {/* Expected CTC */}
              <div className="space-y-2">
                <Label className="font-bold">Expected CTC</Label>
                <Input type="number" value={formData.expectedCtc}onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
  handleInputChange("expectedCtc", e.target.value)
} className={cn({ "border-red-500": errors.expectedCtc })} />
                {errors.expectedCtc && <p className="text-xs text-red-500">{errors.expectedCtc}</p>}
              </div>

              {/* Project Role (auto-filled for HR / editable for Agency with no project) */}
              <div className="space-y-2">
                <Label className="font-bold">
                  Project Role / Designation
                  {isAgency && !formData.projectId && (
                    <span className="text-muted-foreground font-normal text-xs ml-1">(enter manually)</span>
                  )}
                </Label>
                <Input
                  value={formData.role}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    handleInputChange("role", e.target.value)
                  }
                                    disabled={isHrProjectSelected || (isAgency && !!formData.projectId && formData.projectId !== "none")}
                  placeholder={isAgency && !formData.projectId ? "e.g. React Developer" : ""}
                  className={cn({
                    "border-red-500": errors.role,
                    "bg-muted/30 cursor-not-allowed": isHrProjectSelected || (isAgency && !!formData.projectId && formData.projectId !== "none"),
                  })}
                />
                {errors.role && <p className="text-xs text-red-500">{errors.role}</p>}
              </div>

              {/* Project Location */}
              <div className="space-y-2">
                <Label className="font-bold">
                  Project Location
                  {isAgency && !formData.projectId && (
                    <span className="text-muted-foreground font-normal text-xs ml-1">(enter manually)</span>
                  )}
                </Label>
                <Input
                  value={formData.location}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    handleInputChange("location", e.target.value)
                  }
                                    disabled={isHrProjectSelected || (isAgency && !!formData.projectId && formData.projectId !== "none")}
                  placeholder={isAgency && !formData.projectId ? "e.g. Chennai, Remote" : ""}
                  className={cn({
                    "border-red-500": errors.location,
                    "bg-muted/30 cursor-not-allowed": isHrProjectSelected || (isAgency && !!formData.projectId && formData.projectId !== "none"),
                  })}
                />
                {errors.location && <p className="text-xs text-red-500">{errors.location}</p>}
              </div>

              {/* Notice Period */}
              <div className="space-y-2">
                <Label className="font-bold">Notice Period</Label>
                <Select value={formData.noticePeriod} onValueChange={(v: string) => handleInputChange("noticePeriod", v)}>
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
                <Textarea value={formData.comments}onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
  handleInputChange("comments", e.target.value)
} />
              </div>
            </div>

            <Button type="submit" className="w-full h-12 text-lg" disabled={isLoading || isLoadingExtracting}>
              {isLoading
                ? <><Loader2 className="animate-spin mr-2 h-5 w-5" /> Submitting & Scoring…</>
                : "Submit Candidate"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}