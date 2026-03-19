
"use client";

import { useState, useEffect, useMemo } from "react";
import { doc, onSnapshot, updateDoc, collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/use-auth";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft, Edit, Save, FileText, BrainCircuit, User, Mail, Phone, Calendar as CalendarIcon, Briefcase, MapPin, ClipboardList, Clock, Lock, AlertCircle, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { format, parseISO, isValid } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { sendInterviewEmail } from "@/ai/flows/send-interview-email-flow";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { logActivity } from "@/lib/activity-logger";

const NOTICE_PERIOD_OPTIONS = ["Immediate", "15 Days", "30 Days", "60 Days", "90 Days"];
const INTERVIEW_ROUNDS = [
  { value: "r1", label: "L1 Round", prefix: "L1" },
  { value: "r2", label: "L2 Round", prefix: "L2" },
  { value: "hr", label: "HR Round", prefix: "HR" },
  { value: "offer", label: "Offer Stage", prefix: "Offer" }
];

const INTERVIEW_STATUSES = ["Schedule", "Selected", "Rejected"];
const OFFER_STATUSES = ["Offer Pending", "Offer Released", "Offer Rejected"];

export default function CandidateDetails() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, role, name: currentUserName } = useAuth();
  const { toast } = useToast();

  const [candidate, setCandidate] = useState<any>(null);
  const [isEditing, setIsEditing] = useState(searchParams.get("edit") === "true");
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [projects, setProjects] = useState<any[]>([]);
  const [agencies, setAgencies] = useState<any[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [today, setToday] = useState("");

  const [formData, setFormData] = useState<any>(null);

  const normalizeStatus = (status: any) => {
    if (status === "Shedule" || status === "Scheduled") return "Schedule";
    return status || "Pending";
  };

  useEffect(() => {
    setToday(new Date().toISOString().split('T')[0]);
    if (!id) return;

    const unsub = onSnapshot(doc(db, "candidates", id as string), (docSnap) => {
      if (docSnap.exists()) {
        const rawData = docSnap.data();
        const data = {
          ...rawData,
          currentCtc: rawData.currentCtc || rawData.ctc || "",
          r1Status: normalizeStatus(rawData.r1Status),
          r2Status: normalizeStatus(rawData.r2Status),
          hrStatus: normalizeStatus(rawData.hrStatus),
          offerStatus: rawData.offerStatus || "Offer Pending",
          finalStatus: rawData.finalStatus || "In Progress",
        };
        setCandidate({ id: docSnap.id, ...data });
        setFormData({ ...data });
      } else {
        toast({ variant: "destructive", title: "Error", description: "Candidate not found." });
        router.push("/candidates/history");
      }
      setIsLoading(false);
    });

    const fetchDropdowns = async () => {
      const projectsSnap = await getDocs(collection(db, "job_requisitions"));
      setProjects(projectsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      const agenciesSnap = await getDocs(collection(db, "agencies"));
      setAgencies(agenciesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    };

    fetchDropdowns();
    return () => unsub();
  }, [id, router, toast]);

  const activeRound = useMemo(() => {
    if (!candidate) return "r1";
    if (candidate.finalStatus === "Rejected") return null;
    if (candidate.r1Status !== "Selected") return "r1";
    if (candidate.r2Status !== "Selected") return "r2";
    if (candidate.hrStatus !== "Selected") return "hr";
    return "offer";
  }, [candidate]);

  const isDirty = useMemo(() => {
    if (!candidate || !formData) return false;
    return JSON.stringify(candidate) !== JSON.stringify(formData);
  }, [candidate, formData]);

  const formatDisplayTime = (timeStr: string) => {
    if (!timeStr) return "Not set";
    try {
      const [hours, minutes] = timeStr.split(':');
      const h = parseInt(hours);
      const m = parseInt(minutes);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      return `${h12.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${ampm}`;
    } catch (e) {
      return timeStr;
    }
  };

  const getStatusBadge = (status: string, prefix?: string) => {
    const s = (status || "").toLowerCase();
    
    // Normalize display text
    let displayStatus = status;
    if (s === "schedule") displayStatus = "Scheduled";
    if (s === "pending") displayStatus = "Pending";

    let label = displayStatus;
    if (prefix && !displayStatus.toLowerCase().includes(prefix.toLowerCase())) {
      label = `${prefix} ${displayStatus}`;
    }

    // Standardized colors matching history page
    let className = "bg-slate-100 text-slate-500 border-slate-200";

    if (s.includes("selected") || s === "completed") {
      className = "bg-emerald-100 text-emerald-700 border-emerald-200";
    } else if (s.includes("rejected") || s.includes("declined")) {
      className = "bg-rose-100 text-rose-700 border-rose-200";
    } else if (s === "schedule" || s === "scheduled") {
      className = "bg-blue-100 text-blue-700 border-blue-200";
    } else if (s === "offer released") {
      className = "bg-purple-100 text-purple-700 border-purple-200";
    }

    return <Badge variant="outline" className={cn(className, "font-bold whitespace-nowrap")}>{label}</Badge>;
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.candidateName) newErrors.candidateName = "Candidate Name is required.";
    if (!formData.candidateEmail) {
      newErrors.candidateEmail = "Candidate Email is required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.candidateEmail)) {
      newErrors.candidateEmail = "Please enter a valid email address.";
    }
    if (!formData.phoneNumber) {
      newErrors.phoneNumber = "Phone Number is required.";
    } else if (formData.phoneNumber.length !== 10) {
      newErrors.phoneNumber = "Please enter a valid 10-digit phone number.";
    }
    if (activeRound) {
      const status = formData[`${activeRound}Status`];
      if (!status || status === "Pending") {
        newErrors[`${activeRound}Status`] = "Please select status.";
      }
      if (status === "Schedule" && activeRound !== "offer") {
        if (!formData[`${activeRound}Date`]) newErrors[`${activeRound}Date`] = "Date is required.";
        if (!formData[`${activeRound}Time`]) newErrors[`${activeRound}Time`] = "Time is required.";
      }
      const feedback = formData[`${activeRound}Feedback`];
      if (status && status !== "Pending") {
        if (!feedback || feedback.trim() === "") {
          newErrors[`${activeRound}Feedback`] = "Feedback is required.";
        }
      }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleUpdate = async () => {
    if (!isDirty) {
      toast({ title: "No changes", description: "No changes detected to update." });
      return;
    }
    if (!validate()) {
      toast({ variant: "destructive", title: "Validation Error", description: "Please complete all mandatory fields." });
      return;
    }
    setIsUpdating(true);
    let agentEmailToNotify = "";
    let isNewSchedule = false;

    try {
      const updatedData = { ...formData };
      let currentDate, currentTime;

      if (activeRound && role === 'admin') {
        const currentStatus = formData[`${activeRound}Status`];
        currentDate = formData[`${activeRound}Date`];
        currentTime = formData[`${activeRound}Time`];
        const prevStatus = candidate[`${activeRound}Status`];
        const prevDate = candidate[`${activeRound}Date`];
        const prevTime = candidate[`${activeRound}Time`];

        isNewSchedule = currentStatus === "Schedule" && (
          prevStatus !== "Schedule" || 
          prevDate !== currentDate || 
          prevTime !== currentTime
        );

        if (isNewSchedule) {
          const q = query(collection(db, "agencies"), where("agencyId", "==", candidate.agencyId));
          const querySnapshot = await getDocs(q);
          if (!querySnapshot.empty) {
            const agencyData = querySnapshot.docs[0].data();
            const agentEmail = agencyData.primaryContact?.email || agencyData.email;
            const agentName = agencyData.primaryContact?.name || agencyData.contactPerson;
            const agencyName = agencyData.name;
            const roundLabels: Record<string, string> = { r1: "L1", r2: "L2", hr: "HR" };
            const roundLabel = roundLabels[activeRound as string] || "Interview";
            if (agentEmail) {
              const emailResponse = await sendInterviewEmail({
                candidateName: formData.candidateName,
                role: formData.role,
                agencyName: agencyName,
                agentName: agentName,
                agentEmail: agentEmail,
                scheduledDate: currentDate,
                scheduledTime: formatDisplayTime(currentTime),
                round: roundLabel,
                adminName: currentUserName || "Admin"
              });
              if (!emailResponse.success) {
                toast({ variant: "destructive", title: "Notification Failed", description: "Could not send interview schedule to the agent. Update aborted." });
                setIsUpdating(false);
                return;
              }
              agentEmailToNotify = agentEmail;
            }
          }
        }
      }
      
      if (activeRound === "r1") {
        if (formData.r1Status === "Selected") {
          updatedData.r2Status = "Pending";
          updatedData.finalStatus = "In Progress";
        } else if (formData.r1Status === "Rejected") {
          updatedData.finalStatus = "Rejected";
        }
      } else if (activeRound === "r2") {
        if (formData.r2Status === "Selected") {
          updatedData.hrStatus = "Pending";
          updatedData.finalStatus = "In Progress";
        } else if (formData.r2Status === "Rejected") {
          updatedData.finalStatus = "Rejected";
        }
      } else if (activeRound === "hr") {
        if (formData.hrStatus === "Selected") {
          updatedData.offerStatus = "Offer Pending";
          updatedData.finalStatus = "In Progress";
        } else if (formData.hrStatus === "Rejected") {
          updatedData.finalStatus = "Rejected";
        }
      } else if (activeRound === "offer") {
        if (formData.offerStatus === "Offer Released") {
          updatedData.finalStatus = "Completed";
        } else if (formData.offerStatus === "Offer Rejected") {
          updatedData.finalStatus = "Rejected";
        } else {
          updatedData.finalStatus = "In Progress";
        }
      }

      await updateDoc(doc(db, "candidates", id as string), updatedData);

      // --- Activity Logging ---
      const logPayloadBase = {
        userId: user!.uid,
        userName: currentUserName!,
        userRole: role!,
        targetType: 'Candidate' as 'Candidate',
        targetId: id as string,
        targetName: formData.candidateName,
      };

      for (const round of ['r1', 'r2', 'hr']) {
        const oldStatus = candidate[`${round}Status`];
        const newStatus = formData[`${round}Status`];
        const oldFeedback = candidate[`${round}Feedback`] || "";
        const newFeedback = formData[`${round}Feedback`] || "";

        if (oldStatus !== newStatus && newStatus !== 'Pending') {
            await logActivity({ ...logPayloadBase, action: "Status Updated", stage: round.toUpperCase(), details: { from: oldStatus, to: newStatus } });
        }
        if (newFeedback && oldFeedback !== newFeedback) {
            await logActivity({ ...logPayloadBase, action: "Feedback Provided", stage: round.toUpperCase() });
        }
        if (oldStatus === 'Pending' && newStatus !== 'Pending') {
            await logActivity({ ...logPayloadBase, action: "Candidate moved stage", stage: round.toUpperCase() });
        }
      }

      if (isNewSchedule && activeRound) {
          await logActivity({ ...logPayloadBase, action: "Interview Scheduled", stage: activeRound.toUpperCase(), details: { date: currentDate, time: currentTime } });
      }
      
      if (candidate.offerStatus !== formData.offerStatus && formData.offerStatus !== 'Offer Pending') {
          await logActivity({ ...logPayloadBase, action: formData.offerStatus === 'Offer Released' ? "Offer Made" : "Status Updated", stage: "Offer", details: { from: candidate.offerStatus, to: formData.offerStatus } });
      }
      // --- End Activity Logging ---

      const successDescription = agentEmailToNotify ? `Candidate updated successfully. Notification sent to ${agentEmailToNotify}.` : "Candidate updated successfully.";
      toast({ title: "Success", description: successDescription });
      setIsEditing(false);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } finally {
      setIsUpdating(false);
    }
  };

  const downloadResume = () => {
    if (!candidate?.resumeFileData) return;
    try {
      const byteCharacters = atob(candidate.resumeFileData);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: candidate.resumeFileType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = candidate.resumeFileName || "resume";
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "Could not open resume." });
    }
  };

  const getMatchBadge = (score: number) => {
    let colorClass = "bg-red-100 text-red-700 border-red-200";
    let label = "Low Match";
    if (score >= 80) {
      colorClass = "bg-green-100 text-green-700 border-green-200";
      label = "Strong Match";
    } else if (score >= 60) {
      colorClass = "bg-yellow-100 text-yellow-700 border-yellow-200";
      label = "Moderate Match";
    }
    return (
      <Badge variant="outline" className={cn(colorClass, "font-bold px-3 py-1 rounded-full")}>
        AI Match: {score}% — {label}
      </Badge>
    );
  };

  const handleInputChange = (field: string, value: any) => {
    setFormData((prev: any) => {
      const next = { ...prev, [field]: value };
      const statusMatch = field.match(/^(r1|r2|hr|offer)Status$/);
      if (statusMatch) {
        const prefix = statusMatch[1];
        if (next[field] !== 'Schedule') {
          next[`${prefix}Date`] = "";
          next[`${prefix}Time`] = "";
        }
        next[`${prefix}Feedback`] = "";
      }
      return next;
    });
    setErrors((prev: any) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  if (isLoading || !candidate) {
    return (
      <div className="h-96 w-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-20">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => router.push("/candidates/history")} className="gap-2">
          <ArrowLeft className="w-4 h-4" /> Back to History
        </Button>
        <div className="flex gap-2">
          {(role === "admin" || role === "hr") && !isEditing && (
            <Button onClick={() => setIsEditing(true)} className="gap-2">
              <Edit className="w-4 h-4" /> Edit Profile & Workflow
            </Button>
          )}
          {isEditing && (
            <>
              <Button variant="outline" onClick={() => {
                setIsEditing(false);
                setFormData({ ...candidate });
                setErrors({});
              }}>Cancel</Button>
              <Button onClick={handleUpdate} disabled={isUpdating || !isDirty} className="gap-2">
                {isUpdating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Update Candidate
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 space-y-6">
          <Card className="border-t-4 border-t-primary shadow-md">
            <CardContent className="pt-6 text-center">
              <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <User className="w-10 h-10 text-primary" />
              </div>
              <h2 className="text-2xl font-headline font-bold">{candidate?.candidateName}</h2>
              <p className="text-muted-foreground">{candidate?.role}</p>
              <div className="mt-4 flex flex-col items-center gap-3">
                <Badge variant={candidate?.finalStatus === "Completed" ? "default" : candidate?.finalStatus === "Rejected" ? "destructive" : "secondary"}>
                  {candidate?.finalStatus}
                </Badge>
                {candidate?.matchScore !== undefined && (
                  <div className="mt-2">
                    {getMatchBadge(candidate.matchScore)}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm border">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <BrainCircuit className="w-5 h-5 text-primary" />
                <CardTitle className="text-lg">AI Match Summary (Based on Resume)</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed text-muted-foreground italic">
                "{candidate?.matchSummary || "No AI analysis available."}"
              </p>
            </CardContent>
          </Card>

          <Card className="shadow-sm border">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" />
                <CardTitle className="text-lg">Resume</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full gap-2" onClick={downloadResume}>
                <FileText className="w-4 h-4" /> View Document
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-8 space-y-6">
          <Card className="shadow-md border-l-4 border-l-blue-500">
            <CardHeader>
              <div className="flex items-center gap-2">
                <ClipboardList className="w-5 h-5 text-blue-500" />
                <CardTitle className="text-xl font-headline">Interview Workflow</CardTitle>
              </div>
              <CardDescription>Manage active round. Save details to advance.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {INTERVIEW_ROUNDS.map(round => {
                  const isLocked = activeRound !== round.value && candidate?.[`${round.value}Status`] === "Pending";
                  const isActive = activeRound === round.value;
                  const status = formData?.[`${round.value}Status`] || "Pending";
                  const dateString = formData?.[`${round.value}Date`];
                  const time = formData?.[`${round.value}Time`];
                  const displayTime = formatDisplayTime(time);

                  return (
                    <div key={round.value} className={cn(
                      "p-4 border rounded-xl space-y-3 transition-all relative overflow-hidden",
                      isActive ? "bg-blue-50/30 border-blue-200 shadow-sm ring-1 ring-blue-100" : "bg-card",
                      isLocked && "opacity-60 bg-muted/30"
                    )}>
                      <div className="flex justify-between items-start w-full gap-4">
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs font-bold uppercase text-muted-foreground tracking-widest">{round.label}</span>
                          {isLocked && <Lock className="w-3 h-3 text-muted-foreground" />}
                        </div>
                        <div className="flex flex-wrap justify-end gap-2 shrink-0">
                          {isActive && <Badge className="text-[10px] h-5 bg-primary text-primary-foreground font-bold">Active</Badge>}
                          {getStatusBadge(status, round.prefix)}
                        </div>
                      </div>

                      {isEditing && isActive ? (
                        <div className="space-y-3 pt-2">
                          <div className="space-y-2">
                            <Label className="text-xs">Status <span className="text-destructive">*</span></Label>
                            <Select
                              value={status === "Pending" ? "" : status}
                              onValueChange={(val) => handleInputChange(`${round.value}Status`, val)}
                            >
                              <SelectTrigger className={cn("h-9 text-sm px-2", errors[`${round.value}Status`] && "border-destructive ring-destructive/20")}>
                                <SelectValue placeholder="Select Status" />
                              </SelectTrigger>
                              <SelectContent>
                                {(round.value === "offer" ? OFFER_STATUSES : INTERVIEW_STATUSES).map((s) => (
                                  <SelectItem key={s} value={s} className="text-sm">
                                    {s}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {errors[`${round.value}Status`] && <p className="text-[10px] text-destructive mt-1 font-medium">{errors[`${round.value}Status`]}</p>}
                          </div>
                          
                          {status !== "Pending" && (
                            <>
                              {status === "Schedule" && round.value !== "offer" && (
                                <div className="grid grid-cols-2 gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                                  <div className="space-y-1">
                                    <Label className="text-[10px]">Date <span className="text-destructive">*</span></Label>
                                    <div className="relative">
                                      <Input 
                                        type="date"
                                        min={today}
                                        className={cn("h-9 text-sm pr-10", errors[`${round.value}Date`] && "border-destructive")}
                                        value={dateString || ""}
                                        onChange={(e) => handleInputChange(`${round.value}Date`, e.target.value)}
                                      />
                                      <CalendarIcon className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                                    </div>
                                    {errors[`${round.value}Date`] && <p className="text-[9px] text-destructive">{errors[`${round.value}Date`]}</p>}
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-[10px]">Time <span className="text-destructive">*</span></Label>
                                    <div className="relative">
                                      <Input 
                                        type="time"
                                        className={cn("h-9 text-sm pr-10", errors[`${round.value}Time`] && "border-destructive")}
                                        value={time || ""}
                                        onChange={(e) => handleInputChange(`${round.value}Time`, e.target.value)}
                                      />
                                      <Clock className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                                    </div>
                                    {errors[`${round.value}Time`] && <p className="text-[9px] text-destructive">{errors[`${round.value}Time`]}</p>}
                                  </div>
                                </div>
                              )}
                              <div className="space-y-1">
                                <Label className="text-[10px]">Feedback <span className="text-destructive">*</span></Label>
                                <div className="animate-in fade-in slide-in-from-top-1 duration-200">
                                  <Textarea 
                                    placeholder="Enter feedback..." 
                                    className={cn("text-sm min-h-[60px]", errors[`${round.value}Feedback`] && "border-destructive ring-destructive/20")}
                                    value={formData?.[`${round.value}Feedback`] || ""} 
                                    onChange={e => handleInputChange(`${round.value}Feedback`, e.target.value)} 
                                  />
                                </div>
                                {errors[`${round.value}Feedback`] && <p className="text-[10px] text-destructive mt-1 font-medium">{errors[`${round.value}Feedback`]}</p>}
                              </div>
                            </>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-1.5 pt-1">
                          {status === "Schedule" && dateString && (
                            <>
                              <div className="flex items-center gap-2 text-sm text-foreground/80 font-bold">
                                <CalendarIcon className="w-3.5 h-3.5 text-blue-500" /> {dateString}
                              </div>
                              <div className="flex items-center gap-2 text-sm text-foreground/80 font-bold">
                                <Clock className="w-3.5 h-3.5 text-blue-500" /> {displayTime}
                              </div>
                            </>
                          )}
                          {formData?.[`${round.value}Feedback`] && (
                            <p className="text-xs italic text-muted-foreground mt-2 border-t pt-2 whitespace-normal break-words overflow-wrap-anywhere max-w-full">
                              {formData[`${round.value}Feedback`]}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
          <Card className="shadow-md">
            <CardHeader><CardTitle className="text-xl font-headline">Professional Background</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                <div className="space-y-2">
                  <Label className="text-muted-foreground flex items-center gap-2 font-bold"><User className="w-3.5 h-3.5" /> Full Name</Label>
                  {isEditing ? <Input value={formData.candidateName} onChange={e => handleInputChange('candidateName', e.target.value)} /> : <p className="font-bold">{candidate.candidateName}</p>}
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground flex items-center gap-2 font-bold"><Mail className="w-3.5 h-3.5" /> Email</Label>
                  {isEditing ? <Input value={formData.candidateEmail} onChange={e => handleInputChange('candidateEmail', e.target.value)} /> : <p className="font-bold">{candidate.candidateEmail}</p>}
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground flex items-center gap-2 font-bold"><Phone className="w-3.5 h-3.5" /> Phone</Label>
                  {isEditing ? <Input value={formData.phoneNumber} onChange={e => handleInputChange('phoneNumber', e.target.value.replace(/\D/g, "").slice(0, 10))} /> : <p className="font-bold">{candidate.phoneNumber}</p>}
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground flex items-center gap-2 font-bold"><CalendarIcon className="w-3.5 h-3.5" /> Experience</Label>
                  {isEditing ? <Input type="number" step="0.1" value={formData.experience} onChange={e => handleInputChange('experience', e.target.value)} /> : <p className="font-bold">{candidate.experience} Years</p>}
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground flex items-center gap-2 font-bold">Current CTC</Label>
                  {isEditing ? <Input type="number" value={formData.currentCtc} onChange={e => handleInputChange('currentCtc', e.target.value)} /> : <p className="font-bold">{candidate.currentCtc || "-"}</p>}
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground flex items-center gap-2 font-bold">Expected CTC</Label>
                  {isEditing ? <Input type="number" value={formData.expectedCtc} onChange={e => handleInputChange('expectedCtc', e.target.value)} /> : <p className="font-bold">{candidate.expectedCtc || "-"}</p>}
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground flex items-center gap-2 font-bold"><CalendarIcon className="w-3.5 h-3.5" /> Notice Period</Label>
                  {isEditing ? (
                    <select className="w-full h-10 px-3 border rounded-md bg-background font-bold" value={formData.noticePeriod} onChange={e => handleInputChange('noticePeriod', e.target.value)}>
                      {NOTICE_PERIOD_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  ) : <p className="font-bold">{candidate.noticePeriod}</p>}
                </div>
                <div className="space-y-3">
                  <Label className="text-muted-foreground flex items-center gap-2 font-bold"><MapPin className="w-3.5 h-3.5" /> Comfortable Onsite?</Label>
                  {isEditing ? (
                    <RadioGroup value={formData.isComfortableOnsite} onValueChange={v => handleInputChange('isComfortableOnsite', v)} className="flex gap-4">
                      <div className="flex items-center space-x-2"><RadioGroupItem value="Yes" id="y" /><Label htmlFor="y">Yes</Label></div>
                      <div className="flex items-center space-x-2"><RadioGroupItem value="No" id="n" /><Label htmlFor="n">No</Label></div>
                    </RadioGroup>
                  ) : <Badge variant={candidate.isComfortableOnsite === "Yes" ? "default" : "secondary"} className="font-bold">{candidate.isComfortableOnsite}</Badge>}
                </div>
              </div>
              {(role === 'hr' || role === 'agency') && (
                <div className="mt-6 space-y-2">
                  <Label className="text-muted-foreground flex items-center gap-2 font-bold">
                    <MessageSquare className="w-3.5 h-3.5" /> Comments
                  </Label>
                  {isEditing ? (
                    <Textarea 
                      value={formData.comments || ''} 
                      onChange={e => handleInputChange('comments', e.target.value)} 
                      placeholder="Add comments..."
                      rows={4}
                    />
                  ) : (
                    <p className="text-sm text-foreground/80 italic bg-muted/50 p-3 rounded-md min-h-[50px] whitespace-pre-wrap">
                      {candidate.comments || "No comments provided."}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
