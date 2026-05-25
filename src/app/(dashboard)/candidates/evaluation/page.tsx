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

    console.log('[Evaluation] resolvedJdText length:', resolvedJdText.length);
    console.log('[Evaluation] resolvedJdFile present:', !!resolvedJdFile);
    console.log('[Evaluation] resumeFile type:', resumeFile?.type);

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

  // ── Fetch projects ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!role || !user) { setProjects([]); return; }

    let q: any;

    if (role === "admin" || role === "hr") {
      q = query(
        collection(db, "job_requisitions"),
        where("status", "==", "Active")
      );
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
    }

    if (errors[field]) setErrors(prev => ({ ...prev, [field]: "" }));
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // ── Size guard: 1 MB max ──────────────────────────────────────
    if (file.size > 1 * 1024 * 1024) {
      setErrors(prev => ({
        ...prev,
        resumeFile: `File too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum allowed size is 1 MB.`,
      }));
      e.target.value = '';
      return;
    }

    // ── FIX 3: Block non-PDF/DOCX file types ─────────────────────
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
    // ─────────────────────────────────────────────────────────────

    console.log("📁 File selected:", file.name, file.type, file.size);

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
      currentCompany: "",
    }));

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      console.log("📄 Base64 length:", base64?.length);

      setFormData(prev => ({ ...prev, resumeFile: { name: file.name, type: file.type, data: base64 } }));

      try {
        console.log("🚀 Calling candidateResumeExtraction...");
        const extracted = await candidateResumeExtraction({
          fileName: file.name,
          fileType: file.type,
          fileDataB64: base64,
        });

        console.log("✅ Extracted result:", JSON.stringify(extracted, null, 2));

        setFormData(prev => ({
          ...prev,
          candidateName:  extracted.candidateName  ?? "",
          candidateEmail: extracted.candidateEmail ?? "",
          phoneNumber:    extracted.phoneNumber    ?? "",
          experience:     String(extracted.experience ?? ""),
          currentCtc:     extracted.currentCtc    ?? "",
          expectedCtc:    extracted.expectedCtc   ?? "",
          noticePeriod:   extracted.noticePeriod  ?? "",
          currentCompany: extracted.currentCompany ?? "",
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
      const dupSnap = await getDocs(query(collection(db, "candidates"), where("candidateEmail", "==", emailLower)));
      if (!dupSnap.empty) {
        toast({ variant: "destructive", title: "Duplicate Candidate", description: "A candidate with this email already exists." });
        setIsLoading(false);
        return;
      }

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

      const autoAdvance = selectedProject && matchScore >= 70;

      let l1Token = '';
      let l1Url   = '';

      if (autoAdvance) {
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
        projectName:          selectedProject?.projectName || "—",
        projectLocation:      selectedProject?.location || (selectedProject?.locations || []).join(", ") || formData.location || "—",
        createdDate:          serverTimestamp(),
        createdBy:            user?.uid,
        createdByEmail:       user?.email || '',
        createdByRole:        role,
        resumeReviewStatus:   autoAdvance ? "Accepted" : "Pending",
        l1Status:             autoAdvance ? "Scheduled" : "Locked",
        l2Status:             "Locked",
        hrStatus:             "Locked",
        offerStatus:          "Locked",
        finalStatus:          "In Progress",
        status:               "Submitted",
        ...(autoAdvance && {
          l1InterviewType:       'ai',
          l1ScheduledDate:       new Date().toISOString().split('T')[0],
          l1AIInterviewToken:    l1Token,
          l1AIInterviewUrl:      l1Url,
          l1InterviewerName:     loggedInName || user?.displayName || '',
          l1InterviewerEmail:    user?.email  || '',
          resumeReviewedByEmail: user?.email  || '',
          resumeReviewedByName:  loggedInName || user?.displayName || '',
          resumeFeedback:        `Auto-advanced: AI match score ${matchScore}% ≥ 70%`,
        }),
      };

      if (role === "agency") {
        candidateData.jobRequisitionId = selectedProject?.id || null;
        candidateData.agencyName       = loggedInName;
      } else if (selectedProject) {
        candidateData.jobRequisitionId = selectedProject.id;
      }

      const newDocRef = await addDoc(collection(db, "candidates"), candidateData);

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
          candidateId:     newDocRef.id,
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
            candidateId:       newDocRef.id,
            threadMessageId:   '',
            interviewLink:     l1Url,
          });
        } catch (emailErr) {
          console.error('Auto-advance email failed:', emailErr);
        }

        toast({
          title:       "🚀 Auto-Advanced to L1!",
          description: `Score ${matchScore}% ≥ 70% — AI interview link sent to ${formData.candidateName}.`,
        });
      } else {
        toast({
          title:       matchScore < 70 && selectedProject
            ? `⚠️ Score ${matchScore}% — Sent for HR Review`
            : "✅ Candidate Submitted",
          description: matchScore < 70 && selectedProject
            ? "Score below 70% — HR will review and decide."
            : "Candidate profile created successfully.",
        });
      }

      await addDoc(collection(db, "candidate_history"), {
        candidateId: newDocRef.id,
        ...candidateData,
      });

      if (user && loggedInName && role) {
        await logActivity({
          userId:     user.uid,
          userName:   loggedInName,
          userRole:   role,
          action:     autoAdvance ? "Candidate Auto-Advanced to L1" : "Candidate Uploaded",
          stage:      autoAdvance ? "L1 Interview" : "Sourcing",
          targetType: "Candidate",
          targetId:   newDocRef.id,
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

  const isAgency           = role === "agency";
  const projectAutoFilled  = !!formData.projectId && formData.projectId !== "none";
  const selectedProject = projects.find(p => p.id === formData.projectId);

  const shouldShowFields =
    selectedProject &&
    selectedProject.roles?.length &&
    selectedProject.locations?.length;

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
              {/* FIX 2: Added onDragOver + onDrop for drag and drop support */}
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
              <div className="md:col-span-2 space-y-2">

                {isAgency && (
                  <div className="flex items-start gap-2 p-3 rounded-md bg-blue-50 border border-blue-200 mb-1">
                    <Info className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                    <p className="text-xs text-blue-700">
                      <strong>Only projects assigned to you are shown.</strong> Select a project to auto-fill role
                      and location. If you're not sure, choose "No project / Not sure".
                    </p>
                  </div>
                )}

                {role === "hr" && (
                  <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 border border-amber-200 mb-1">
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
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    handleInputChange("currentLocation", e.target.value)
                  }
                  className={cn({ "border-red-500": errors.currentLocation })}
                />
                {errors.currentLocation && (
                  <p className="text-xs text-red-500">{errors.currentLocation}</p>
                )}
              </div>

              {/* Permanent Location */}
              <div className="space-y-2">
                <Label className="font-bold">Permanent Location</Label>
                <Input
                  value={formData.permanentLocation}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    handleInputChange("permanentLocation", e.target.value)
                  }
                  className={cn({ "border-red-500": errors.permanentLocation })}
                />
                {errors.permanentLocation && (
                  <p className="text-xs text-red-500">{errors.permanentLocation}</p>
                )}
              </div>

              {/* Experience — FIX 1: min="0" to block negative values */}
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

              {/* Current CTC — FIX 1: min="0" to block negative values */}
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

              {/* Expected CTC — FIX 1: min="0" to block negative values */}
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
                  {/* Project Role */}
                  <div className="space-y-2">
                    <Label className="font-bold">Project Role / Designation</Label>
                    <Input
                      value={formData.role}
                      disabled
                      className="bg-muted/30 cursor-not-allowed"
                    />
                  </div>

                  {/* Project Location */}
                  <div className="space-y-2">
                    <Label className="font-bold">Project Location</Label>
                    <Input
                      value={formData.location}
                      disabled
                      className="bg-muted/30 cursor-not-allowed"
                    />
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

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '10px 14px', borderRadius: '8px',
      background: ok ? '#F0FDF4' : '#F9FAFB',
      border: `1px solid ${ok ? '#86EFAC' : '#E5E7EB'}`,
    }}>
      <div style={{
        width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0,
        background: ok ? '#16A34A' : '#E5E7EB',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '11px', color: 'white', fontWeight: 700,
      }}>
        {ok ? '✓' : '?'}
      </div>
      <span style={{ fontSize: '13px', color: ok ? '#16A34A' : '#6B7280', fontWeight: ok ? 600 : 400 }}>
        {label}
      </span>
    </div>
  );
}