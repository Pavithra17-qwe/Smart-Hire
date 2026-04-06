'use client';

import { useState, useEffect } from "react";
import { collection, addDoc, onSnapshot, serverTimestamp, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getDocs } from "firebase/firestore";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { Loader2, UserPlus, Upload, FileCheck, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { candidateResumeExtraction } from "@/ai/flows/candidate-resume-extraction-flow";
import { candidateMatchScoring } from "@/ai/flows/candidate-match-scoring-flow";
import { Textarea } from "@/components/ui/textarea";
import { logActivity } from "@/lib/activity-logger";

const NOTICE_PERIOD_OPTIONS = ["Immediate", "0-15 days", "15-30 days", "30-60 days", "60+ days"];
const emailRegex = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
const phoneRegex = /^[6-9]\d{9}$/;

export default function CandidateEvaluation() {
  const { user, role, name: loggedInName } = useAuth();
  const [projects, setProjects] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingExtracting, setIsLoadingExtracting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { toast } = useToast();
  const router = useRouter();

  const [hrProjectFilter, setHrProjectFilter] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    candidateName: "",
    candidateEmail: "",
    phoneNumber: "",
    candidateLocation: "",
    experience: "",
    candidateDesignation: "",
    currentCtc: "",
    expectedCtc: "",
    projectId: "",
    role: "",
    location: "",
    noticePeriod: "",
    isComfortableOnsite: "",
    comments: "",
    resumeFile: null as { name: string; type: string; data: string } | null,
  });

  useEffect(() => {
  if (!role || !user) {
    setProjects([]);
    return;
  }

  let unsub: (() => void) | undefined;
  let q;

  if (role === 'admin') {
    q = query(collection(db, "job_requisitions"), where("status", "==", "Active"));

  } else if (role === 'hr') {
    if (!hrProjectFilter) {
      setProjects([]);
      return; 
    }

    const baseQuery = query(collection(db, "job_requisitions"), where("status", "==", "Active"));

    if (hrProjectFilter === 'admin') {
      q = query(baseQuery, where("createdByRole", "==", "admin"));
    } else if (hrProjectFilter === 'my') {
      q = query(baseQuery, where("createdBy", "==", user.uid));
    } else {
      q = query(baseQuery, where("createdByRole", "==", "hr"));
    }

  } else if (role === 'agency') {
    // ✅ FIX ONLY HERE
    if (!user?.uid) return;

    q = query(
      collection(db, "requirements"),
      where("createdBy", "==", user.uid)
    );

    console.log("Agency UID:", user.uid);
  }

  if (q) {
    unsub = onSnapshot(q, (snap) => {
      console.log("Fetched projects:", snap.docs.map(d => d.data())); // DEBUG
      setProjects(snap.docs.map(d => ({
        ...d.data(),
        id: d.id,
        isReq: role === 'agency'
      })));
    });
  }

  return () => {
    if (unsub) unsub();
  };

// ✅ IMPORTANT: conditionally depend on hrProjectFilter
}, [role, user, role === 'hr' ? hrProjectFilter : null]);

  const handleInputChange = (field: string, value: string) => {
    let processedValue = value;
    if (field === 'phoneNumber') {
      processedValue = value.replace(/[^0-9]/g, '').slice(0, 10);
    }
    setFormData((prev) => ({ ...prev, [field]: processedValue }));

    if (field === 'projectId') {
      const project = projects.find(p => p.id === value);
    
      // ✅ HR AUTO-FILL (existing)
      if (role === 'hr' && project) {
        const newRole = project.roles ? project.roles.join(', ') : '';
        const newLocation = project.locations ? project.locations.join(', ') : '';
    
        setFormData((prev) => ({
          ...prev,
          role: newRole,
          location: newLocation
        }));
      }
    
      // ✅ AGENCY AUTO-FILL (ADD THIS)
      else if (role === 'agency' && project) {
        setFormData((prev) => ({
          ...prev,
          role: project.jobRole || '',
          location: project.location || ''
        }));
      }
    
      // reset when cleared
      else if (!value) {
        setFormData((prev) => ({
          ...prev,
          role: '',
          location: ''
        }));
      }
    }

    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: "" }));
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrors(prev => ({ ...prev, resumeFile: ""}));

    setIsLoadingExtracting(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      setFormData((prev) => ({ ...prev, resumeFile: { name: file.name, type: file.type, data: base64 } }));
      try {
        const extractedData = await candidateResumeExtraction({ fileName: file.name, fileType: file.type, fileDataB64: base64 });
        if (extractedData) {
          setFormData((prev) => ({ ...prev, ...extractedData, experience: String(extractedData.experience || '') }));
          toast({ title: "Resume Parsed", description: "Extracted details have been auto-filled." });
        }
      } catch (error) {
        toast({ variant: "destructive", title: "Extraction Failed", description: "Unable to extract details from resume. Please fill manually." });
      } finally {
        setIsLoadingExtracting(false);
      }
    };
    reader.readAsDataURL(file);
  };
  
  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.candidateName.trim()) newErrors.candidateName = "Candidate name is required.";
    if (!formData.candidateEmail.trim() || !emailRegex.test(formData.candidateEmail)) newErrors.candidateEmail = "A valid email is required.";
    if (!formData.phoneNumber.trim() || !phoneRegex.test(formData.phoneNumber)) newErrors.phoneNumber = "A valid 10-digit Indian phone number is required.";
    if (!formData.candidateLocation.trim()) newErrors.candidateLocation = "Candidate location is required.";
    if (!formData.experience) newErrors.experience = "Experience is required.";
    if (!formData.candidateDesignation.trim()) newErrors.candidateDesignation = "Candidate designation is required.";
    if (!formData.currentCtc) newErrors.currentCtc = "Current CTC is required.";
    if (!formData.expectedCtc) newErrors.expectedCtc = "Expected CTC is required.";
    if (!formData.projectId) newErrors.projectId = "Project is mandatory.";
    if (!formData.noticePeriod) newErrors.noticePeriod = "Notice period is required.";
    if (!formData.isComfortableOnsite) newErrors.isComfortableOnsite = "This field is required.";
    if (!formData.resumeFile) newErrors.resumeFile = "Resume is mandatory.";
    
    if (!(role === 'hr' && formData.projectId)) {
        if (!formData.role) newErrors.role = "Designation is required.";
        if (!formData.location) newErrors.location = "Location is required.";
    }

    return newErrors;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const formErrors = validateForm();
    if (Object.keys(formErrors).length > 0) {
      setErrors(formErrors);
      return;
    }

    setIsLoading(true);

    try {
      const selectedSource = projects.find(p => p.id === formData.projectId);
      if (!selectedSource) throw new Error("Selected project not found.");
      // ✅ DUPLICATE CANDIDATE EMAIL CHECK
const candidateEmailLower = formData.candidateEmail.trim().toLowerCase();
const dupCandidateSnap = await getDocs(
  query(collection(db, "candidates"), where("candidateEmail", "==", candidateEmailLower))
);
if (!dupCandidateSnap.empty) {
  toast({
    variant: "destructive",
    title: "Duplicate Candidate",
    description: "A candidate with this email already exists in the system.",
  });
  setIsLoading(false);
  return;
}
      
      // ✅ 👉 PASTE NEW AI LOGIC HERE
      let matchScore = null;
      let matchSummary = "Not scored.";
      
      if (formData.resumeFile?.data) {
        try {
          console.log("JD DATA LENGTH:", selectedSource.jdFileData?.length);
console.log("RESUME DATA LENGTH:", formData.resumeFile?.data?.length);
          if (
            selectedSource.jdFileData &&
            selectedSource.jdFileType
          )
           {
            toast({ title: 'AI Scoring Started (JD Based)' });
      
            const result = await candidateMatchScoring({
              jdFileDataB64: selectedSource.jdFileData,
              jdFileType: selectedSource.jdFileType,
              resumeFileDataB64: formData.resumeFile.data,
              resumeFileType: formData.resumeFile.type
            });
      
            matchScore = result.matchScore;
            matchSummary = result.summary;
          } else {
            toast({ title: 'AI Scoring Started (Basic Matching)' });
      
            let score = 50;
      
            if (formData.experience) score += 10;
            if (formData.role) score += 10;
            if (formData.location) score += 10;
            if (formData.noticePeriod === "Immediate") score += 10;
      
            matchScore = Math.min(score, 95);
            let summaryPoints: string[] = [];

            if (formData.experience) {
              summaryPoints.push("Experience matches requirement");
            }
            
            if (formData.role) {
              summaryPoints.push("Role is relevant");
            }
            
            if (formData.location) {
              summaryPoints.push("Location is suitable");
            }
            
            if (formData.noticePeriod === "Immediate") {
              summaryPoints.push("Immediate joiner");
            }
            
            if (summaryPoints.length === 0) {
              matchSummary = "Basic profile match";
            } else {
              matchSummary = summaryPoints.join(" • ");
            }
          }
      
          toast({
            title: 'AI Scoring Complete',
            description: `Match score: ${matchScore}%`
          });
      
        } catch (err) {
          console.error("AI ERROR:", err);

// ✅ fallback score
matchScore = 60;
matchSummary = "Fallback score generated";

toast({
  variant: 'destructive',
  title: 'AI Failed - Using fallback score',
});
        }
      }

      const { projectId, ...restFormData } = formData;

      const candidateData: any = {
        ...restFormData,
        candidateDesignation: formData.candidateDesignation.trim() || "N/A",
        matchScore,
        matchSummary,
        projectName: selectedSource.projectName,
        projectLocation: selectedSource.location || "N/A",
        createdDate: serverTimestamp(),
        createdBy: user?.uid,
        createdByRole: role,
        status: "Submitted"
      };
      
      if (role === 'agency') {
        candidateData.requirementId = selectedSource.id;
        candidateData.agencyName = loggedInName;
      } else {
        candidateData.jobRequisitionId = selectedSource.id;
      }

      const historyCollection = collection(db, "candidate_history");
      const newDocRef = await addDoc(collection(db, "candidates"), candidateData);

      await addDoc(historyCollection, {
        candidateId: newDocRef.id,
        ...candidateData
      });

      if (user && loggedInName && role) {
        await logActivity({
            userId: user.uid,
            userName: loggedInName,
            userRole: role,
            action: "Candidate Uploaded",
            stage: "Sourcing",
            targetType: "Candidate",
            targetId: newDocRef.id,
            targetName: candidateData.candidateName
        });
      }

      toast({ title: "Success", description: "Candidate profile created successfully" });
      router.push("/candidates/history");

    } catch (error: any) {
      console.error("Submission Error: ", error);
      toast({ variant: "destructive", title: "Submission Failed", description: error.message });
    } finally {
      setIsLoading(false);
    }
  };
  
  const isHrProjectSelected = role === 'hr' && !!formData.projectId;

  return (
    <div className="max-w-3xl mx-auto py-8">
      <Card className="shadow-lg border-t-4 border-t-primary">
        <CardHeader>
          <div className="flex items-center gap-3 mb-2">
            <UserPlus className="w-6 h-6 text-primary" />
            <CardTitle className="text-2xl font-bold">New Candidate Profile</CardTitle>
          </div>
          <CardDescription>Start by uploading a resume to auto-fill the evaluation form.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-8">
            <div className="space-y-2">
              <Label className="font-bold flex items-center gap-2">Upload Resume <Sparkles className="w-4 h-4 text-primary" /></Label>
              <div className="flex items-center justify-center w-full">
                <label className={cn("flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-lg cursor-pointer", {"border-red-500": errors.resumeFile, "bg-green-50/50 border-green-200": formData.resumeFile, "bg-muted/50 border-border hover:bg-muted": !formData.resumeFile})}>
                  <div className="flex flex-col items-center justify-center pt-5 pb-6 px-4 text-center">
                    {isLoadingExtracting ? <Loader2 className="w-10 h-10 text-primary animate-spin" /> : formData.resumeFile ? <FileCheck className="w-10 h-10 text-green-600" /> : <Upload className={cn("w-10 h-10 text-muted-foreground mb-2")} />}
                    <p className={cn("text-sm text-muted-foreground font-medium")}>{formData.resumeFile ? formData.resumeFile.name : 'Click to upload or drag and drop'}</p>
                  </div>
                  <input type="file" className="hidden" accept=".pdf,.docx" onChange={handleFileChange} disabled={isLoadingExtracting} />
                </label>
              </div>
              {errors.resumeFile && <p className="text-xs text-red-500 mt-2">{errors.resumeFile}</p>}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-8">
              <div className="md:col-span-2 space-y-2">
                
                {role === 'hr' && (
                  <div className="mb-4 p-3 rounded-md bg-muted/50">
                    <Label className="font-bold text-sm">Filter Projects</Label>
                    <RadioGroup value={hrProjectFilter || ""} onValueChange={setHrProjectFilter} className="flex items-center gap-4 mt-2">
                      <div className="flex items-center space-x-2"><RadioGroupItem value="my" id="my" /><Label htmlFor="my">My Projects</Label></div>
                      <div className="flex items-center space-x-2"><RadioGroupItem value="all_hr" id="all_hr" /><Label htmlFor="all_hr">All HR Projects</Label></div>
                      <div className="flex items-center space-x-2"><RadioGroupItem value="admin" id="admin" /><Label htmlFor="admin">Admin Projects</Label></div>
                    </RadioGroup>
                  </div>
                )}

                <Label htmlFor="project" className="font-bold">Job Requisition (Project)</Label>
                <Select value={formData.projectId} onValueChange={v => handleInputChange('projectId', v)} disabled={role === 'hr' && !hrProjectFilter}>
                  <SelectTrigger id="project" className={cn({"border-red-500": errors.projectId})}>
                     <SelectValue placeholder={role === 'hr' && !hrProjectFilter ? "Select a filter above to see projects" : "Select a project..."} />
                  </SelectTrigger>
                  <SelectContent>
  {projects.length > 0 ? (
    projects
      .filter(p => {
        // ✅ Only for agency
        if (role === 'agency') {
          const name = (p.projectName || "").toLowerCase().trim();
          return name && name !== "n/a";
        }
        return true;
      })
      .map(p => (
        <SelectItem key={p.id} value={p.id}>
          {p.projectName}
          {role !== 'agency' && ` (${p.createdByName || p.createdByRole})`}
        </SelectItem>
      ))
  ) : (
    (role === 'hr' && hrProjectFilter) || role === 'admin' || role === 'agency' ? (
      <div className="px-4 py-2 text-sm text-muted-foreground">
        No projects available.
      </div>
    ) : null
  )}
</SelectContent>
                </Select>
                {errors.projectId && <p className="text-xs text-red-500 mt-1">{errors.projectId}</p>}
              </div>

              <div className="md:col-span-2"><hr /></div>

              {/* Row 1 */}
              <div className="space-y-2"><Label className="font-bold">Candidate Name</Label><Input value={formData.candidateName} onChange={e => handleInputChange('candidateName', e.target.value)} className={cn({"border-red-500": errors.candidateName})} />{errors.candidateName && <p className="text-xs text-red-500 mt-1">{errors.candidateName}</p>}</div>
              <div className="space-y-2"><Label className="font-bold">Candidate Email</Label><Input type="email" value={formData.candidateEmail} onChange={e => handleInputChange('candidateEmail', e.target.value)} className={cn({"border-red-500": errors.candidateEmail})} />{errors.candidateEmail && <p className="text-xs text-red-500 mt-1">{errors.candidateEmail}</p>}</div>

              {/* Row 2 */}
              <div className="space-y-2"><Label className="font-bold">Phone Number</Label><Input value={formData.phoneNumber} onChange={e => handleInputChange('phoneNumber', e.target.value)} maxLength={10} className={cn({"border-red-500": errors.phoneNumber})} />{errors.phoneNumber && <p className="text-xs text-red-500 mt-1">{errors.phoneNumber}</p>}</div>
              <div className="space-y-2"><Label className="font-bold">Candidate Location</Label><Input value={formData.candidateLocation} onChange={e => handleInputChange('candidateLocation', e.target.value)} className={cn({"border-red-500": errors.candidateLocation})} />{errors.candidateLocation && <p className="text-xs text-red-500 mt-1">{errors.candidateLocation}</p>}</div>

              {/* Row 3 */}
              <div className="space-y-2"><Label className="font-bold">Experience (Years)</Label><Input type="number" step="0.1" value={formData.experience} onChange={e => handleInputChange('experience', e.target.value)} className={cn({"border-red-500": errors.experience})} />{errors.experience && <p className="text-xs text-red-500 mt-1">{errors.experience}</p>}</div>
              <div className="space-y-2"><Label className="font-bold">Candidate Designation</Label><Input value={formData.candidateDesignation} onChange={e => handleInputChange('candidateDesignation', e.target.value)} className={cn({"border-red-500": errors.candidateDesignation})} />{errors.candidateDesignation && <p className="text-xs text-red-500 mt-1">{errors.candidateDesignation}</p>}</div>

              {/* Row 4 */}
              <div className="space-y-2"><Label className="font-bold">Current CTC</Label><Input type="number" value={formData.currentCtc} onChange={e => handleInputChange('currentCtc', e.target.value)} className={cn({"border-red-500": errors.currentCtc})} />{errors.currentCtc && <p className="text-xs text-red-500 mt-1">{errors.currentCtc}</p>}</div>
              <div className="space-y-2"><Label className="font-bold">Expected CTC</Label><Input type="number" value={formData.expectedCtc} onChange={e => handleInputChange('expectedCtc', e.target.value)} className={cn({"border-red-500": errors.expectedCtc})} />{errors.expectedCtc && <p className="text-xs text-red-500 mt-1">{errors.expectedCtc}</p>}</div>

              {/* Row 5 */}
              <div className="space-y-2"><Label className="font-bold">Project Designation</Label><Input value={formData.role} onChange={e => handleInputChange('role', e.target.value)} disabled={role === 'agency' || isHrProjectSelected}   className={cn({"border-red-500": errors.role, 'bg-muted/30 cursor-not-allowed': isHrProjectSelected})} />{errors.role && <p className="text-xs text-red-500 mt-1">{errors.role}</p>}</div>
              <div className="space-y-2"><Label className="font-bold">Project Location</Label><Input value={formData.location} onChange={e => handleInputChange('location', e.target.value)} disabled={role === 'agency' || isHrProjectSelected}   className={cn({"border-red-500": errors.location, 'bg-muted/30 cursor-not-allowed': isHrProjectSelected})} />{errors.location && <p className="text-xs text-red-500 mt-1">{errors.location}</p>}</div>

              {/* Row 6 */}
              <div className="space-y-2"><Label className="font-bold">Notice Period</Label><Select value={formData.noticePeriod} onValueChange={v => handleInputChange('noticePeriod', v)}><SelectTrigger className={cn({"border-red-500": errors.noticePeriod})}><SelectValue placeholder="Select..." /></SelectTrigger><SelectContent>{NOTICE_PERIOD_OPTIONS.map(opt => (<SelectItem key={opt} value={opt}>{opt}</SelectItem>))}</SelectContent></Select>{errors.noticePeriod && <p className="text-xs text-red-500 mt-1">{errors.noticePeriod}</p>}</div>
              <div className="space-y-3"><Label className={cn("font-bold", {"text-red-500": errors.isComfortableOnsite})}>Comfortable working onsite?</Label><RadioGroup value={formData.isComfortableOnsite} onValueChange={v => handleInputChange('isComfortableOnsite', v)} className="flex items-center gap-6 pt-2"><div className="flex items-center space-x-2"><RadioGroupItem value="Yes" id="y" /><Label htmlFor="y">Yes</Label></div><div className="flex items-center space-x-2"><RadioGroupItem value="No" id="n" /><Label htmlFor="n">No</Label></div></RadioGroup>{errors.isComfortableOnsite && <p className="text-xs text-red-500 mt-1">{errors.isComfortableOnsite}</p>}</div>

              {/* Row 7 */}
              <div className="md:col-span-2 space-y-2"><Label className="font-bold">Comments</Label><Textarea value={formData.comments} onChange={e => handleInputChange('comments', e.target.value)} /></div>
            </div>

            <Button type="submit" className="w-full h-12 text-lg" disabled={isLoading || isLoadingExtracting}>
              {isLoading ? <Loader2 className="animate-spin" /> : 'Submit Candidate'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
