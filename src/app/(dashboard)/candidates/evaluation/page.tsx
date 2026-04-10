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

  // PATH 1: JD-based AI scoring
  if (project?.jdFileData && project?.jdFileType) {
    try {
      toast({ title: "🤖 AI Scoring", description: "Comparing resume against Job Description…" });
      const result = await candidateMatchScoring({
        jdFileDataB64:     project.jdFileData,
        jdFileType:        project.jdFileType,
        resumeFileDataB64: resumeFile.data,
        resumeFileType:    resumeFile.type,
      });
      const score   = typeof result.matchScore === "number" ? result.matchScore : 0;
      const summary = result.summary?.trim() || generateScoreSummary(score, formData, project, "jd");
      return { matchScore: score, matchSummary: summary };
    } catch (err) {
      console.error("❌ JD-based AI scoring failed:", err);
    }
  }

  // PATH 2: field-based scoring
  toast({ title: "🤖 AI Scoring", description: "No JD available — scoring based on candidate profile…" });

  let score = 40;
  const reasons: string[] = [];
  const gaps: string[]    = [];

  const exp         = parseFloat(formData.experience);
  const requiredExp = parseFloat(project?.experience || project?.minExperience || "0");
  if (!isNaN(exp)) {
    if (requiredExp > 0) {
      if (exp >= requiredExp) { score += 15; reasons.push(`Experience (${exp} yrs) meets requirement (${requiredExp}+ yrs)`); }
      else                    { gaps.push(`Experience (${exp} yrs) is below required ${requiredExp} yrs`); }
    } else { score += 10; reasons.push(`${exp} years of experience noted`); }
  } else { gaps.push("Experience not specified"); }

  const candidateRole = (formData.candidateDesignation || "").toLowerCase();
  const projectRole   = (formData.role || project?.jobRole || "").toLowerCase();
  if (candidateRole && projectRole && candidateRole.split(" ").some((w: string) => projectRole.includes(w))) {
    score += 15; reasons.push(`Designation "${formData.candidateDesignation}" aligns with role "${formData.role || project?.jobRole}"`);
  } else if (projectRole) { gaps.push(`Designation may not align with required role "${formData.role || project?.jobRole}"`); }

  const candidateLoc = (formData.candidateLocation || "").toLowerCase();
  const projectLoc   = (formData.location || project?.location || "").toLowerCase();
  if (candidateLoc && projectLoc && (candidateLoc.includes(projectLoc) || projectLoc.includes(candidateLoc))) {
    score += 10; reasons.push(`Location match: ${formData.candidateLocation}`);
  } else if (projectLoc && candidateLoc) {
    gaps.push(`Location mismatch: candidate in "${formData.candidateLocation}", role requires "${formData.location || project?.location}"`);
  }

  if (formData.noticePeriod) {
    if (formData.noticePeriod === "Immediate" || formData.noticePeriod === "0-15 days") { score += 10; reasons.push(`Notice period is ${formData.noticePeriod} — quick availability`); }
    else { score += 5; reasons.push(`Notice period: ${formData.noticePeriod}`); }
  } else { gaps.push("Notice period not specified"); }

  if (formData.isComfortableOnsite === "Yes") { score += 5; reasons.push("Comfortable working onsite"); }

  return {
    matchScore:   Math.min(Math.max(score, 10), 95),
    matchSummary: generateScoreSummary(Math.min(Math.max(score, 10), 95), formData, project, "field", reasons, gaps),
  };
}

function generateScoreSummary(
  score: number, formData: any, project: any,
  mode: "jd" | "field", reasons: string[] = [], gaps: string[] = []
): string {
  let header = "";
  if      (score === 0)  header = "Score: 0% — The resume could not be matched.";
  else if (score <= 30)  header = `Score: ${score}% — Very low match.`;
  else if (score <= 50)  header = `Score: ${score}% — Below average match.`;
  else if (score <= 65)  header = `Score: ${score}% — Moderate match. Further evaluation recommended.`;
  else if (score <= 80)  header = `Score: ${score}% — Good match. Recommended for interview.`;
  else                   header = `Score: ${score}% — Strong match. Highly recommended.`;

  const parts = [
    header,
    mode === "jd"
      ? "Score generated by comparing resume against the uploaded Job Description using AI analysis."
      : "Score generated based on candidate profile fields (no JD available for this project).",
  ];
  if (reasons.length) parts.push("✅ Strengths: " + reasons.join(" • "));
  if (gaps.length)    parts.push("⚠️ Gaps: " + gaps.join(" • "));
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
  // HR    → ALL active job_requisitions (admin + hr created, no filter)
  // Admin → ALL active job_requisitions
  // Agency→ ONLY job_requisitions where assignedAgencies contains their UID
  useEffect(() => {
    if (!role || !user) { setProjects([]); return; }

    let q: any;

    if (role === "admin" || role === "hr") {
      // Both admin and HR see every active project regardless of who created it
      q = query(
        collection(db, "job_requisitions"),
        where("status", "==", "Active")
      );
    } else if (role === "agency") {
      // Agency only sees projects that have been explicitly assigned to them
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

    // Auto-fill role + location when project is selected
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
    if (!formData.candidateName.trim())        e.candidateName        = "Candidate name is required.";
    if (!formData.candidateEmail.trim() || !emailRegex.test(formData.candidateEmail))
                                               e.candidateEmail       = "A valid email is required.";
    if (!formData.phoneNumber.trim() || !phoneRegex.test(formData.phoneNumber))
                                               e.phoneNumber          = "A valid 10-digit Indian phone number is required.";
    if (!formData.candidateLocation.trim())    e.candidateLocation    = "Candidate location is required.";
    if (!formData.experience)                  e.experience           = "Experience is required.";
    if (!formData.candidateDesignation.trim()) e.candidateDesignation = "Candidate designation is required.";
    if (!formData.currentCtc)                  e.currentCtc           = "Current CTC is required.";
    if (!formData.expectedCtc)                 e.expectedCtc          = "Expected CTC is required.";
    if (!formData.noticePeriod)                e.noticePeriod         = "Notice period is required.";
    if (!formData.isComfortableOnsite)         e.isComfortableOnsite  = "This field is required.";
    if (!formData.resumeFile)                  e.resumeFile           = "Resume is mandatory.";

    // Project required for HR/Admin; optional for Agency
    if ((role === "admin" || role === "hr") && !formData.projectId) {
      e.projectId = "Project is mandatory.";
    }

    // Role + Location mandatory when project is not auto-filling them
    const projectAutoFilled = !!formData.projectId && formData.projectId !== "none";
    if (!projectAutoFilled) {
      if (!formData.role)     e.role     = "Role / Designation is required.";
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
      const emailLower = formData.candidateEmail.trim().toLowerCase();
      const dupSnap = await getDocs(query(collection(db, "candidates"), where("candidateEmail", "==", emailLower)));
      if (!dupSnap.empty) {
        toast({ variant: "destructive", title: "Duplicate Candidate", description: "A candidate with this email already exists." });
        setIsLoading(false);
        return;
      }

      const selectedProject = projects.find(p => p.id === formData.projectId) || null;

      const { matchScore, matchSummary } = await computeMatchScore(
        formData.resumeFile,
        selectedProject,
        formData,
        role,
        toast
      );

      toast({ title: "✅ AI Scoring Complete", description: `Match score: ${matchScore}%` });

      const { projectId, ...rest } = formData;

      const candidateData: any = {
        ...rest,
        candidateEmail:       emailLower,
        candidateDesignation: formData.candidateDesignation.trim() || "N/A",
        matchScore,
        matchSummary,
        aiScore:              matchScore,
        projectName:          selectedProject?.projectName || "—",
        projectLocation:      selectedProject?.location || (selectedProject?.locations || []).join(", ") || formData.location || "—",
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
        candidateData.jobRequisitionId = selectedProject?.id || null;
        candidateData.agencyName       = loggedInName;
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

  const isAgency           = role === "agency";
  const projectAutoFilled  = !!formData.projectId && formData.projectId !== "none";

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
                errors.resumeFile    ? "border-red-500" : "",
                formData.resumeFile  ? "bg-green-50/50 border-green-200" : "bg-muted/50 border-border hover:bg-muted"
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

                {/* Agency notice */}
                {isAgency && (
                  <div className="flex items-start gap-2 p-3 rounded-md bg-blue-50 border border-blue-200 mb-1">
                    <Info className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                    <p className="text-xs text-blue-700">
                      <strong>Only projects assigned to you are shown.</strong> Select a project to auto-fill role
                      and location. If you're not sure, choose "No project / Not sure".
                    </p>
                  </div>
                )}

                {/* HR notice */}
                {role === "hr" && (
                  <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 border border-amber-200 mb-1">
                    <Info className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                    <p className="text-xs text-amber-700">
                      All active projects (created by Admin or HR) are available for selection.
                    </p>
                  </div>
                )}

                <Label htmlFor="project" className="font-bold">
                  Job Requisition / Project
                  {isAgency && (
                    <span className="text-muted-foreground font-normal text-xs ml-1">(optional)</span>
                  )}
                </Label>

                <Select
                  value={formData.projectId}
                  onValueChange={(v: string) => handleInputChange("projectId", v)}
                >
                  <SelectTrigger id="project" className={cn({ "border-red-500": errors.projectId })}>
                    <SelectValue placeholder={
                      isAgency ? "Select your assigned project (optional)…" : "Select a project…"
                    } />
                  </SelectTrigger>
                  <SelectContent>
                    {/* Agency gets an explicit "no project" option */}
                    {isAgency && (
                      <SelectItem value="none">No project / Not sure</SelectItem>
                    )}
                    {projects.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.projectName}
                        {!isAgency && (
                          <span className="text-muted-foreground text-xs ml-1">
                            ({p.createdByName || p.createdByRole || ""})
                          </span>
                        )}
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

              {/* Candidate Location */}
              <div className="space-y-2">
                <Label className="font-bold">Candidate Location</Label>
                <Input
                  value={formData.candidateLocation}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleInputChange("candidateLocation", e.target.value)}
                  className={cn({ "border-red-500": errors.candidateLocation })}
                />
                {errors.candidateLocation && <p className="text-xs text-red-500">{errors.candidateLocation}</p>}
              </div>

              {/* Experience */}
              <div className="space-y-2">
                <Label className="font-bold">Experience (Years)</Label>
                <Input
                  type="number"
                  step="0.1"
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
                  value={formData.expectedCtc}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleInputChange("expectedCtc", e.target.value)}
                  className={cn({ "border-red-500": errors.expectedCtc })}
                />
                {errors.expectedCtc && <p className="text-xs text-red-500">{errors.expectedCtc}</p>}
              </div>

              {/* Project Role — auto-filled when project selected, editable otherwise */}
              <div className="space-y-2">
                <Label className="font-bold">
                  Project Role / Designation
                  {!projectAutoFilled && (
                    <span className="text-muted-foreground font-normal text-xs ml-1">(enter manually)</span>
                  )}
                </Label>
                <Input
                  value={formData.role}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleInputChange("role", e.target.value)}
                  disabled={projectAutoFilled}
                  placeholder={!projectAutoFilled ? "e.g. React Developer" : ""}
                  className={cn({
                    "border-red-500":          errors.role,
                    "bg-muted/30 cursor-not-allowed": projectAutoFilled,
                  })}
                />
                {errors.role && <p className="text-xs text-red-500">{errors.role}</p>}
              </div>

              {/* Project Location — auto-filled when project selected, editable otherwise */}
              <div className="space-y-2">
                <Label className="font-bold">
                  Project Location
                  {!projectAutoFilled && (
                    <span className="text-muted-foreground font-normal text-xs ml-1">(enter manually)</span>
                  )}
                </Label>
                <Input
                  value={formData.location}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleInputChange("location", e.target.value)}
                  disabled={projectAutoFilled}
                  placeholder={!projectAutoFilled ? "e.g. Chennai, Remote" : ""}
                  className={cn({
                    "border-red-500":          errors.location,
                    "bg-muted/30 cursor-not-allowed": projectAutoFilled,
                  })}
                />
                {errors.location && <p className="text-xs text-red-500">{errors.location}</p>}
              </div>

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