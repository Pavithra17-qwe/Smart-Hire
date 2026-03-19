
"use client";

import { useState, useEffect } from "react";
import { collection, addDoc, onSnapshot, serverTimestamp, query, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const NOTICE_PERIOD_OPTIONS = ["Immediate", "15 Days", "30 Days", "60 Days", "90 Days"];

export default function CandidateEvaluation() {
  const { user, role, agencyId: loggedInAgencyId, name: loggedInName } = useAuth();
  const [projects, setProjects] = useState<any[]>([]);
  const [agencies, setAgencies] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingExtracting, setIsLoadingExtracting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { toast } = useToast();
  const router = useRouter();

  const [formData, setFormData] = useState({
    candidateName: "",
    candidateEmail: "",
    phoneNumber: "",
    projectId: "",
    agencyId: "",
    role: "",
    experience: "",
    currentCtc: "",
    expectedCtc: "",
    noticePeriod: "",
    isComfortableOnsite: "",
    comments: "",
    resumeFile: null as { name: string; type: string; data: string } | null,
  });

  useEffect(() => {
    if (role === "agency" && loggedInAgencyId) {
      setFormData(prev => ({ ...prev, agencyId: loggedInAgencyId }));
    }
  }, [role, loggedInAgencyId]);

  useEffect(() => {
    const unsubProjects = onSnapshot(collection(db, "job_requisitions"), (snap) => {
      const allProjects = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setProjects(allProjects.filter((p: any) => p.status === "Active" || p.status === "Open" || !p.status));
    });

    if (role === "admin") {
      const unsubAgencies = onSnapshot(collection(db, "agencies"), (snap) => {
        const allAgencies = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setAgencies(allAgencies.filter((a: any) => a.status === "Active" || !a.status));
      });
      return () => { unsubProjects(); unsubAgencies(); };
    } else if (role === "agency" && loggedInAgencyId) {
      const fetchCurrentAgency = async () => {
        const q = query(collection(db, "agencies"), where("agencyId", "==", loggedInAgencyId));
        const snap = await getDocs(q);
        if (!snap.empty) {
            setAgencies(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        }
      };
      fetchCurrentAgency();
    }
    
    return () => unsubProjects();
  }, [role, loggedInAgencyId]);

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => {
      const next = { ...prev, [field]: value };
      if (field === "projectId") {
        next.role = "";
      }
      return next;
    });
    if (errors[field]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setErrors({});
      const allowedTypes = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword"];
      if (!allowedTypes.includes(file.type)) {
        toast({ variant: "destructive", title: "Invalid Format", description: "Please upload a PDF, DOC, or DOCX file." });
        e.target.value = "";
        return;
      }
      if (file.size > 1024 * 1024) {
        toast({ variant: "destructive", title: "File too large", description: "File size must be less than 1MB" });
        e.target.value = "";
        return;
      }
      setIsLoadingExtracting(true);
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(",")[1];
        setFormData(prev => ({ ...prev, resumeFile: { name: file.name, type: file.type, data: base64 } }));
        try {
          const extractedData = await candidateResumeExtraction({ fileName: file.name, fileType: file.type, fileDataB64: base64 });
          if (extractedData) {
            setFormData(prev => ({
              ...prev,
              candidateName: extractedData.candidateName || prev.candidateName,
              candidateEmail: extractedData.candidateEmail || prev.candidateEmail,
              phoneNumber: extractedData.phoneNumber || prev.phoneNumber,
              experience: extractedData.experience || prev.experience,
              currentCtc: extractedData.currentCtc || prev.currentCtc,
              expectedCtc: extractedData.expectedCtc || prev.expectedCtc,
              noticePeriod: extractedData.noticePeriod || prev.noticePeriod,
            }));
            toast({ title: "Resume Parsed Successfully", className: "bg-green-50 border-green-200", description: "Extracted details have been filled into the form." });
          }
        } catch (error: any) {
          toast({ variant: "destructive", title: "Extraction Failed", description: "Could not parse resume automatically." });
        } finally {
          setIsLoadingExtracting(false);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const selectedProject = projects.find(p => p.id === formData.projectId);
  const selectedAgency = agencies.find(a => a.agencyId === formData.agencyId) || (role === "agency" ? { name: loggedInName, agencyId: loggedInAgencyId } : null);

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.candidateName) newErrors.candidateName = "Required";
    if (!formData.candidateEmail) newErrors.candidateEmail = "Required";
    if (!formData.phoneNumber || formData.phoneNumber.length !== 10) newErrors.phoneNumber = "Invalid phone";
    if (!formData.projectId) newErrors.projectId = "Required";
    if (!formData.role) newErrors.role = "Required";
    if (!formData.agencyId) newErrors.agencyId = "Required";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) {
      toast({ variant: "destructive", title: "Validation Error", description: "Please fill all mandatory fields." });
      return;
    }
    setIsLoading(true);
    try {
      const q = query(collection(db, "candidates"), where("candidateName", "==", formData.candidateName), where("role", "==", formData.role));
      const querySnapshot = await getDocs(q);
      if (!querySnapshot.empty) {
        toast({ variant: "destructive", title: "Duplicate Candidate", description: "Candidate already exists with the same name and role." });
        setIsLoading(false);
        return;
      }
      let matchScore = 0, matchSummary = "No scoring data available.";
      if (selectedProject?.jdFileData && formData.resumeFile?.data) {
        try {
          const result = await candidateMatchScoring({ jdFileDataB64: selectedProject.jdFileData, jdFileType: selectedProject.jdFileType, resumeFileDataB64: formData.resumeFile.data, resumeFileType: formData.resumeFile.type });
          matchScore = result.matchScore;
          matchSummary = result.summary;
        } catch (err) { console.error("AI Scoring failed", err); }
      }
      const candidateData = {
        candidateName: formData.candidateName,
        candidateEmail: formData.candidateEmail,
        phoneNumber: formData.phoneNumber,
        projectId: formData.projectId,
        projectName: selectedProject?.projectName || "Unknown Project",
        projectLocations: selectedProject?.locations || [],
        role: formData.role,
        agencyId: formData.agencyId,
        agencyName: selectedAgency?.name || "Agency",
        experience: formData.experience,
        currentCtc: formData.currentCtc,
        expectedCtc: formData.expectedCtc,
        noticePeriod: formData.noticePeriod,
        isComfortableOnsite: formData.isComfortableOnsite,
        comments: formData.comments,
        resumeFileName: formData.resumeFile?.name || "",
        resumeFileType: formData.resumeFile?.type || "",
        resumeFileData: formData.resumeFile?.data || "",
        matchScore,
        matchSummary,
        r1Status: "Pending",
        r2Status: "Pending",
        hrStatus: "Pending",
        offerStatus: "Offer Pending",
        finalStatus: "In Progress",
        createdDate: serverTimestamp(),
        createdBy: user?.uid
      };
      const newDocRef = await addDoc(collection(db, "candidates"), candidateData);

      await logActivity({
        userId: user!.uid,
        userName: loggedInName!,
        userRole: role!,
        action: "Candidate Uploaded",
        stage: "Sourcing",
        targetType: "Candidate",
        targetId: newDocRef.id,
        targetName: candidateData.candidateName,
      });

      toast({ title: "Success", description: "Candidate profile created successfully" });
      router.push("/candidates/history");
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message || "Failed to add candidate." });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto py-8">
      <Card className="shadow-lg border-t-4 border-t-primary">
        <CardHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-primary/10 rounded-lg"><UserPlus className="w-6 h-6 text-primary" /></div>
            <CardTitle className="text-2xl font-headline font-bold tracking-tight">New Candidate Profile</CardTitle>
          </div>
          <CardDescription>Start by uploading a resume to auto-fill the evaluation form.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label className="flex items-center gap-2 font-bold text-foreground">1. Upload Resume (Max 1MB) <Sparkles className="w-4 h-4 text-primary animate-pulse" /></Label>
              <div className="flex items-center justify-center w-full">
                <label className={cn("flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-lg cursor-pointer transition-colors", formData.resumeFile ? "bg-green-50/50 border-green-200" : "bg-muted/50 border-border hover:bg-muted")}>
                  <div className="flex flex-col items-center justify-center pt-5 pb-6 px-4 text-center">
                    {isLoadingExtracting ? (
                      <div className="flex flex-col items-center gap-2"><Loader2 className="w-10 h-10 text-primary animate-spin" /><p className="text-sm font-medium text-primary">AI is parsing your document...</p></div>
                    ) : formData.resumeFile ? (
                      <div className="flex flex-col items-center gap-2"><FileCheck className="w-10 h-10 text-green-600" /><p className="text-sm font-medium text-green-600 line-clamp-1">{formData.resumeFile.name}</p></div>
                    ) : (
                      <><Upload className="w-10 h-10 text-muted-foreground mb-2" /><p className="text-sm text-muted-foreground font-medium">Click to upload or drag and drop</p></>
                    )}
                  </div>
                  <input type="file" className="hidden" accept=".pdf,.doc,.docx" onChange={handleFileChange} disabled={isLoadingExtracting} />
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-6">
              <div className="space-y-2">
                <Label className="font-bold">Candidate Name</Label>
                <Input value={formData.candidateName} onChange={e => handleInputChange('candidateName', e.target.value)} placeholder="Full Name" className={cn(errors.candidateName && "border-destructive")} />
                {errors.candidateName && <p className="text-xs text-destructive">{errors.candidateName}</p>}
              </div>
              <div className="space-y-2">
                <Label className="font-bold">Candidate Email</Label>
                <Input type="email" value={formData.candidateEmail} onChange={e => handleInputChange('candidateEmail', e.target.value)} placeholder="email@example.com" className={cn(errors.candidateEmail && "border-destructive")} />
                {errors.candidateEmail && <p className="text-xs text-destructive">{errors.candidateEmail}</p>}
              </div>
              <div className="space-y-2">
                <Label className="font-bold">Phone Number</Label>
                <Input value={formData.phoneNumber} onChange={e => handleInputChange('phoneNumber', e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="10 digit number" className={cn(errors.phoneNumber && "border-destructive")} />
                {errors.phoneNumber && <p className="text-xs text-destructive">{errors.phoneNumber}</p>}
              </div>
              <div className="space-y-2">
                <Label className="font-bold">Experience (Years)</Label>
                <Input type="number" step="0.1" value={formData.experience} onChange={e => handleInputChange('experience', e.target.value)} placeholder="e.g. 5.5" />
              </div>

              <div className="space-y-2">
                <Label className="font-bold">Current CTC</Label>
                <Input type="number" value={formData.currentCtc} onChange={e => handleInputChange('currentCtc', e.target.value)} placeholder="Enter Current CTC" />
              </div>
              <div className="space-y-2">
                <Label className="font-bold">Expected CTC</Label>
                <Input type="number" value={formData.expectedCtc} onChange={e => handleInputChange('expectedCtc', e.target.value)} placeholder="Enter Expected CTC" />
              </div>

              <div className="space-y-2">
                <Label className="font-bold">Notice Period</Label>
                <Select value={formData.noticePeriod} onValueChange={v => handleInputChange('noticePeriod', v)}>
                  <SelectTrigger><SelectValue placeholder="Select Availability" /></SelectTrigger>
                  <SelectContent>{NOTICE_PERIOD_OPTIONS.map(opt => (<SelectItem key={opt} value={opt}>{opt}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="font-bold">Hiring Project</Label>
                <Select value={formData.projectId} onValueChange={v => handleInputChange('projectId', v)}>
                  <SelectTrigger className={cn(errors.projectId && "border-destructive")}>
                    <SelectValue placeholder="Select Project" />
                  </SelectTrigger>
                  <SelectContent>{projects.map(p => (<SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>))}</SelectContent>
                </Select>
                {errors.projectId && <p className="text-xs text-destructive">{errors.projectId}</p>}
              </div>

              <div className="space-y-2">
                <Label className="font-bold">Designation</Label>
                <Select value={formData.role} onValueChange={v => handleInputChange('role', v)} disabled={!selectedProject}>
                  <SelectTrigger className={cn(errors.role && "border-destructive")}>
                    <SelectValue placeholder={selectedProject ? "Select Role" : "Select Project first"} />
                  </SelectTrigger>
                  <SelectContent>{(selectedProject?.roles || []).map((r: string) => (<SelectItem key={r} value={r}>{r}</SelectItem>))}</SelectContent>
                </Select>
                {errors.role && <p className="text-xs text-destructive">{errors.role}</p>}
              </div>
              <div className="space-y-2">
                <Label className="font-bold">Project Location</Label>
                <Input 
                  readOnly 
                  value={selectedProject?.locations?.join(", ") || ""} 
                  placeholder="Auto-filled from project" 
                  className="bg-muted/30 cursor-not-allowed font-medium"
                />
              </div>

              <div className="space-y-2">
                <Label className="font-bold">Sourcing Agency</Label>
                <Select 
                  value={formData.agencyId} 
                  onValueChange={v => handleInputChange('agencyId', v)}
                  disabled={role === "agency"}
                >
                  <SelectTrigger className={cn(errors.agencyId && "border-destructive")}>
                    <SelectValue placeholder="Select Sourcing Agency" />
                  </SelectTrigger>
                  <SelectContent>
                    {agencies.map(a => (
                      <SelectItem key={a.agencyId} value={a.agencyId}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.agencyId && <p className="text-xs text-destructive">{errors.agencyId}</p>}
              </div>
              <div className="space-y-3">
                <Label className="font-bold">Are you comfortable working onsite?</Label>
                <RadioGroup value={formData.isComfortableOnsite} onValueChange={v => handleInputChange('isComfortableOnsite', v)} className="flex items-center gap-6 pt-1">
                  <div className="flex items-center space-x-2"><RadioGroupItem value="Yes" id="y" /><Label htmlFor="y" className="cursor-pointer">Yes</Label></div>
                  <div className="flex items-center space-x-2"><RadioGroupItem value="No" id="n" /><Label htmlFor="n" className="cursor-pointer">No</Label></div>
                </RadioGroup>
              </div>
            </div>

            {(role === 'hr' || role === 'agency') && (
              <div className="space-y-2 pt-4">
                  <Label className="font-bold">Comments (Optional)</Label>
                  <Textarea
                      value={formData.comments}
                      onChange={e => handleInputChange('comments', e.target.value)}
                      placeholder="Add any additional comments or feedback here..."
                      rows={4}
                  />
              </div>
            )}

            <Button type="submit" className="w-full h-12 text-lg font-bold shadow-lg shadow-primary/20 transition-all active:scale-[0.98]" disabled={isLoading || isLoadingExtracting || !formData.resumeFile}>
              {isLoading ? (<><Loader2 className="mr-2 h-5 w-5 animate-spin" />Processing...</>) : ("Submit Candidate")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
