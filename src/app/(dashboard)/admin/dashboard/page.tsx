"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { PieChart, Pie, Label, BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell } from "recharts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getDoc, doc } from "firebase/firestore";
import { useSearchParams } from "next/navigation";
import { type CarouselApi } from "@/components/ui/carousel";
import {
  XCircle, Users, CalendarDays, Clock, ArrowUpRight, CheckCircle2,
  TrendingDown, Activity, BarChart3, PieChart as PieIcon,
  Loader2, ShieldCheck,ChevronLeft, ChevronRight, UserCog, Building2,
  Layers, Briefcase, FileText
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Carousel, CarouselContent, CarouselItem,
  CarouselNext, CarouselPrevious,
} from "@/components/ui/carousel";

// ─── ROUTES ───────────────────────────────────────────────────────────────────
const ROUTES = {
  candidateHistory: "/candidates/history",
  userManagement:   "/admin/users",
  jobRequisitions: "/admin/job-requisitions",
  requirements: "/agency/requirements",
};

function buildFilter(base: string, stage: string, status: string) {
  return `${base}?stage=${encodeURIComponent(stage)}&status=${encodeURIComponent(status)}`;
}
function buildRole(base: string, role: string) {
  return `${base}?role=${encodeURIComponent(role)}`;
}
function buildUploader(base: string, uid: string) {
  return `${base}?createdBy=${encodeURIComponent(uid)}`;
}

// ─── CHART CONFIGS ────────────────────────────────────────────────────────────
const pipelineConfig = {
  l1:        { label: "L1 Selected", color: "#6366F1" },
  l2:        { label: "L2 Selected", color: "#3B82F6" },
  hr:        { label: "HR Selected", color: "#F59E0B" },
  completed: { label: "Completed",   color: "#10B981" },
} satisfies ChartConfig;

const trendConfig = {
  evaluations: { label: "Evaluated", color: "hsl(var(--primary))" },
  hires:       { label: "Hires",     color: "#10B981" },
} satisfies ChartConfig;

interface MonthlyData {
  month: string; monthNum: number; year: number;
  evaluations: number; hires: number;
}

function normalizeStatus(s: any): string {
  const v = (s || "").toLowerCase().trim();
  if (v === "accepted")    return "Accepted";
  if (v === "selected")    return "Selected";
  if (v === "rejected")    return "Rejected";
  if (v === "scheduled")   return "Scheduled";
  if (v === "pending")     return "Pending";
  if (v === "locked")      return "Locked";
  if (v === "released")    return "Released";
  if (v === "completed")   return "Completed";
  if (v === "in progress") return "In Progress";
  return s || "Pending";
}

// ─── SUB-COMPONENTS ───────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">{children}</p>
  );
}

function StatCard({ title, value, icon: Icon, accent, href }: {
  title: string; value: number; icon: any; accent: string; href: string;
}) {
  return (
    <Link href={href} className="block group">
      <Card className="shadow-sm border hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer overflow-hidden">
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider leading-tight">{title}</p>
              <p className="text-3xl font-black mt-1.5 group-hover:text-primary transition-colors">{value}</p>
            </div>
            <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center text-white shrink-0", accent)}>
              <Icon className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-center gap-1 mt-3 text-[11px] text-muted-foreground group-hover:text-primary transition-colors">
            <span>View candidates</span>
            <ChevronRight className="h-3 w-3" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function StageCol({ title, accent, items }: {
  title: string; accent: string;
  items: { label: string; count: number; dot: string; href: string }[];
}) {
  return (
    <div className="space-y-2">
      <div className={cn("px-3 py-1.5 rounded-lg text-center", accent)}>
        <p className="text-[10px] font-black uppercase tracking-widest text-foreground/70">{title}</p>
      </div>
      <div className="space-y-1.5">
        {items.map(item => (
          <Link key={item.label} href={item.href} className="block group">
            <div className="flex items-center justify-between px-3 py-2 rounded-lg border bg-card hover:bg-muted/50 hover:border-primary/30 transition-all">
              <div className="flex items-center gap-2">
                <div className={cn("h-2 w-2 rounded-full shrink-0", item.dot)} />
                <span className="text-[11px] font-semibold text-muted-foreground group-hover:text-foreground transition-colors">{item.label}</span>
              </div>
              <span className="text-sm font-black group-hover:text-primary transition-colors">{item.count}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function fmtDate(date: any) {
  if (!date) return "—";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function StatusPill({ status, color }: { status: string; color?: string }) {
  return (
    <span className={cn(
      "text-[10px] font-semibold px-2 py-0.5 rounded",
      color || "bg-slate-100 text-slate-600"
    )}>
      {status || "—"}
    </span>
  );
}

// ─── HELPER: Clean role label for display ─────────────────────────────────────
// Converts raw createdByRole values into readable labels
function getRoleLabel(role: string): string {
  if (!role) return "—";
  const r = role.toLowerCase();
  if (r === "admin")          return "Admin";
  if (r === "hr")             return "HR";
  if (r === "agency")         return "Agency";
  if (r === "panel")          return "Panel";
  // These raw source values should never reach the UI, but handle gracefully
  if (r === "job_requisition") return "Job Requisition";
  if (r === "requirement")     return "Requirement";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const router = useRouter();
  const [candidates, setCandidates] = useState<any[]>([]);
  const [users,      setUsers]      = useState<any[]>([]);
  const [jobRequisitions, setJobRequisitions] = useState<any[]>([]);
  const [requirements,    setRequirements]    = useState<any[]>([]);
  const [projectEntries,  setProjectEntries]  = useState<any[]>([]);
  const [filterRole,   setFilterRole]   = useState("all");
  const [filterStage,  setFilterStage]  = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [isMounted, setIsMounted] = useState(false);
  const [carouselApi, setCarouselApi] = useState<CarouselApi>();
const [canScrollPrev, setCanScrollPrev] = useState(false);
 const [canScrollNext, setCanScrollNext] = useState(true);

  
  const [creatorMap, setCreatorMap] = useState<Record<string, string>>({});

  useEffect(() => {
      if (!carouselApi) return;
       const update = () => {
         setCanScrollPrev(carouselApi.canScrollPrev());
         setCanScrollNext(carouselApi.canScrollNext());
      };
      update();
      carouselApi.on("select", update);
       return () => { carouselApi.off("select", update); };
     }, [carouselApi]);
  

  useEffect(() => {
    const fetchNames = async () => {
      const map: Record<string, string> = {};
      for (const r of [...jobRequisitions, ...requirements]) {
        if (r.createdBy && !map[r.createdBy]) {
          const snap = await getDoc(doc(db, "users", r.createdBy));
          if (snap.exists()) {
            const data = snap.data();
            map[r.createdBy] =
              data.name ||
              data.displayName ||
              data.companyName ||
              "N/A";
          }
        }
      }
      setCreatorMap(map);
    };
    fetchNames();
  }, [jobRequisitions, requirements]);

  useEffect(() => { setIsMounted(true); }, []);

  useEffect(() => {
    const unsub1 = onSnapshot(collection(db, "job_requisitions"), (snap) => {
      const data = snap.docs.map(doc => ({
        id: doc.id, ...doc.data(), source: "job_requisition",
      }));
      setJobRequisitions(data);
    });
    const unsub2 = onSnapshot(collection(db, "requirements"), (snap) => {
      const data = snap.docs.map(doc => ({
        id: doc.id, ...doc.data(), source: "requirement",
      }));
      setRequirements(data);
    });
    return () => { unsub1(); unsub2(); };
  }, []);

  useEffect(() => {
    const combined = [
      ...jobRequisitions.map(r => ({
        id: r.id,
        projectName:   r.projectName || "—",
        roles:         (r.roles || []).join(", "),
        location:      (r.locations || []).join(", "),
        // ── FIX 1: Use the actual user role (admin/hr), NOT the source collection name ──
        createdByName: creatorMap[r.createdBy] || r.createdByName || "—",
        createdByRole: r.createdByRole || "admin",   // ← "admin" or "hr" — clean value
        createdAt:     r.createdDate?.toDate?.() || r.createdAt?.toDate?.() || null,
        status:        r.status || "Active",
        statusColor:
        r.status === "Inactive"
          ? "bg-slate-100 text-slate-500"
          : "bg-emerald-100 text-emerald-600",
                  source:        "job_requisition",
        createdBy:     r.createdBy,
        jdFileData: r.jdFileData || null,
jdFileName: r.jdFileName || null,
jdFileType: r.jdFileType || null,
      })),

      ...requirements.map(r => {
        const user = users.find(u => u.id === r.createdBy);
      
        return {
          id: r.id,
          projectName: r.projectName || "—",
          roles: r.jobRole || "—",
          location: r.location || "—",
          createdBy: r.createdBy,
      
          createdByName:
            creatorMap[r.createdBy] ||
            user?.displayName ||
            user?.name ||
            user?.companyName ||
            "—",
      
          createdByRole:
            r.createdByRole ||
            user?.role ||
            "agency",
      
          createdAt: r.createdAt?.toDate?.() || null,
          status: r.status || "Active",
      
          statusColor:
            r.status === "Inactive"
              ? "bg-slate-100 text-slate-500"
              : "bg-emerald-100 text-emerald-600",
      
          source: "requirement",
      
          // ✅ ADD THIS (MAIN FIX)
          jdFileData: r.jdFileData || null,
          jdFileName: r.jdFileName || null,
          jdFileType: r.jdFileType || null,
        };
      })
    ];

    // Sort newest first
    combined.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Remove duplicates by projectName + createdBy key
    const uniqueMap = new Map();
    combined.forEach(item => {
      const key = item.projectName + "_" + item.createdBy;
      if (!uniqueMap.has(key)) uniqueMap.set(key, item);
    });

    setProjectEntries(Array.from(uniqueMap.values()));
  }, [jobRequisitions, requirements, users, creatorMap]);

  const recentProjects = [...projectEntries]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "candidates"), snap => {
      setCandidates(snap.docs.map(doc => {
        const r = doc.data();
        return {
          id: doc.id, ...r,
          resumeReviewStatus: normalizeStatus(r.resumeReviewStatus),
          l1Status:    normalizeStatus(r.l1Status),
          l2Status:    normalizeStatus(r.l2Status),
          hrStatus:    normalizeStatus(r.hrStatus),
          offerStatus: normalizeStatus(r.offerStatus),
          finalStatus: r.finalStatus || "In Progress",
          createdAt:   r.createdAt?.toDate?.() || r.lastUpdated?.toDate?.() || new Date(),
          l1InterviewerUid: r.l1InterviewerUid || r.l1PanelUid || null,
          l2InterviewerUid: r.l2InterviewerUid || r.l2PanelUid || null,
        };
      }));
    });
    const u2 = onSnapshot(collection(db, "users"), snap => {
      setUsers(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => { u1(); u2(); };
  }, []);

  const filtered = useMemo(() => {
    const stageMap: Record<string, string> = {
      resume: "resumeReviewStatus", l1: "l1Status", l2: "l2Status",
      hr: "hrStatus", offer: "offerStatus", final: "finalStatus",
    };
    return candidates.filter(c => {
      if (filterRole === "hr" || filterRole === "agency") {
        const uploader = users.find(u => u.id === c.createdBy);
        if (!uploader || (uploader.role || "").toLowerCase() !== filterRole) return false;
      } else if (filterRole === "panel") {
        const panelUids = users.filter(u => (u.role||"").toLowerCase()==="panel").map(u => u.id);
        if (!panelUids.includes(c.l1InterviewerUid) && !panelUids.includes(c.l2InterviewerUid)) return false;
      }
      if (filterStage !== "all" && filterStatus !== "all") {
        const field = stageMap[filterStage];
        if (field && c[field] !== filterStatus) return false;
      } else if (filterStage === "all" && filterStatus !== "all") {
        if (c.finalStatus !== filterStatus) return false;
      }
      return true;
    });
  }, [candidates, users, filterRole, filterStage, filterStatus]);

  const userCounts = useMemo(() => ({
    hr:     users.filter(u => (u.role||"").toLowerCase()==="hr").length,
    panel:  users.filter(u => (u.role||"").toLowerCase()==="panel").length,
    agency: users.filter(u => (u.role||"").toLowerCase()==="agency").length,
  }), [users]);

  const hrBreakdown = useMemo(() =>
    users.filter(u => (u.role||"").toLowerCase()==="hr")
      .map(u => ({ id:u.id, name:u.displayName||u.name||u.email||"Unknown", count:filtered.filter(c=>c.createdBy===u.id).length }))
      .sort((a,b) => b.count-a.count),
  [users, candidates]);

  const agencyBreakdown = useMemo(() =>
    users.filter(u => (u.role||"").toLowerCase()==="agency")
      .map(u => ({ id:u.id, name:u.displayName||u.name||u.email||"Unknown", count:filtered.filter(c=>c.createdBy===u.id).length }))
      .sort((a,b) => b.count-a.count),
  [users, candidates]);

  const panelBreakdown = useMemo(() =>
    users.filter(u => (u.role||"").toLowerCase()==="panel")
      .map(u => ({ id:u.id, name:u.displayName||u.name||u.email||"Unknown", count:filtered.filter(c=>c.l1InterviewerUid===u.id||c.l2InterviewerUid===u.id).length }))
      .sort((a,b) => b.count-a.count),
  [users, candidates]);

  const stats = useMemo(() => ({
    total: filtered.length,
    inProgress: filtered.filter(c => { const f=(c.finalStatus??"").toLowerCase(); return f!=="completed"&&f!=="rejected"; }).length,
    completed: filtered.filter(c => c.finalStatus==="Completed").length,
    rejected:  filtered.filter(c => c.finalStatus==="Rejected").length,
    resumeAccepted: filtered.filter(c => c.resumeReviewStatus==="Accepted").length,
    resumeRejected: filtered.filter(c => c.resumeReviewStatus==="Rejected").length,
    resumePending:  filtered.filter(c => c.resumeReviewStatus==="Pending").length,
    l1Selected:  filtered.filter(c => c.l1Status==="Selected").length,
    l1Scheduled: filtered.filter(c => c.l1Status==="Scheduled").length,
    l1Rejected:  filtered.filter(c => c.l1Status==="Rejected").length,
    l1Pending:   filtered.filter(c => c.l1Status==="Pending").length,
    l2Selected:  filtered.filter(c => c.l2Status==="Selected").length,
    l2Scheduled: filtered.filter(c => c.l2Status==="Scheduled").length,
    l2Rejected:  filtered.filter(c => c.l2Status==="Rejected").length,
    l2Pending:   filtered.filter(c => c.l2Status==="Pending").length,
    hrSelected:  filtered.filter(c => c.hrStatus==="Selected").length,
    hrScheduled: filtered.filter(c => c.hrStatus==="Scheduled").length,
    hrRejected:  filtered.filter(c => c.hrStatus==="Rejected").length,
    hrPending:   filtered.filter(c => c.hrStatus==="Pending").length,
    offerPending:  filtered.filter(c => c.offerStatus==="Pending").length,
    offerReleased: filtered.filter(c => c.offerStatus==="Released").length,
    offerAccepted: filtered.filter(c => c.offerStatus==="Accepted").length,
    offerRejected: filtered.filter(c => c.offerStatus==="Rejected").length,
  }), [filtered]);

  const pipelineData = useMemo(() => [
    { name:"L1 Selected", value:stats.l1Selected, fill:"#6366F1", stage:"l1",    status:"Selected" },
    { name:"L2 Selected", value:stats.l2Selected, fill:"#3B82F6", stage:"l2",    status:"Selected" },
    { name:"HR Selected", value:stats.hrSelected, fill:"#F59E0B", stage:"hr",    status:"Selected" },
    { name:"Completed",   value:stats.completed,  fill:"#10B981", stage:"final", status:"Completed" },
  ].filter(d => d.value > 0), [stats]);
  const pipelineTotal = pipelineData.reduce((s,d) => s+d.value, 0);

  const trendData = useMemo(() => {
    const last6: MonthlyData[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth()-i);
      last6.push({ month:d.toLocaleString("default",{month:"short"}), monthNum:d.getMonth(), year:d.getFullYear(), evaluations:0, hires:0 });
    }
    filtered.forEach(c => {
      const cDate = c.createdAt instanceof Date ? c.createdAt : new Date();
      const idx = last6.findIndex(m => m.monthNum===cDate.getMonth() && m.year===cDate.getFullYear());
      if (idx !== -1) { last6[idx].evaluations++; if (c.finalStatus==="Completed") last6[idx].hires++; }
    });
    return last6;
  }, [filtered]);

  const upcoming = useMemo(() => {
    const list: any[] = [];
  
    const now = new Date();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
  
    const maxDate = new Date(today);
    maxDate.setDate(today.getDate() + 6);
    maxDate.setHours(23, 59, 59, 999); // ← FIX: include full day 6
  
    filtered.forEach(c => {
      [
        { key: "l1", label: "L1 Interview", df: "l1ScheduledDate", sf: "l1TimeSlot", st: "l1Status" },
        { key: "l2", label: "L2 Interview", df: "l2ScheduledDate", sf: "l2TimeSlot", st: "l2Status" },
        { key: "hr", label: "HR Round",     df: "hrScheduledDate", sf: "hrTimeSlot", st: "hrStatus" },
      ].forEach(({ key, label, df, sf, st }) => {
  
        const dateStr = c[df];
        if (!dateStr) return;                        // no date → skip
        if (c[st] !== "Scheduled") return;           // only Scheduled → keep this check
  
        const eventDate = new Date(dateStr + "T00:00:00");
        if (isNaN(eventDate.getTime())) return;      // invalid date → skip
  
        // Must be today or within next 6 days (inclusive)
        if (eventDate < today || eventDate > maxDate) return;
  
        // For TODAY — skip only if the time slot has already ended
        const todayStr = today.toISOString().split("T")[0];
        if (dateStr === todayStr && c[sf]) {
          const endPart = c[sf].split("-")[1]?.trim();
          if (endPart) {
            const eventEnd = new Date(`${dateStr} ${endPart}`);
            if (!isNaN(eventEnd.getTime()) && eventEnd < now) return;
          }
        }
  
        list.push({
          id:            `${c.id}-${key}`,
          candidateName: c.candidateName || "Unknown",
          jobRole:       c.candidateDesignation || "—",
          roundLabel:    label,
          date:          dateStr,
          timeSlot:      c[sf] || "",
          isToday:       dateStr === today.toISOString().split("T")[0],
          candidateId:   c.id,
        });
      });
    });
  
    return list.sort((a, b) => a.date.localeCompare(b.date));
  }, [filtered]);
  const hasFilters = filterRole!=="all" || filterStage!=="all" || filterStatus!=="all";

  if (!isMounted) return (
    <div className="h-screen flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );

  return (
<div className="space-y-6 pb-10 w-full overflow-x-auto min-w-[800px]">
          {/* Live indicator */}
      <div className="flex items-center justify-end">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-3 py-1.5 rounded-full">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse block" />
          Live data
        </div>
      </div>
    

      {/* FILTERS */}
      <div className="bg-card border rounded-xl p-4 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-3 items-end">
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Uploaded / Handled by</label>
              <Select onValueChange={v=>{setFilterRole(v);}} value={filterRole}>
                <SelectTrigger className="h-10 text-sm rounded-lg"><SelectValue placeholder="All Roles" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  <SelectItem value="hr">HR (uploaded by HR)</SelectItem>
                  <SelectItem value="agency">Agency (uploaded by Agency)</SelectItem>
                  <SelectItem value="panel">Panel (handled L1 / L2)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Stage</label>
              <Select onValueChange={v=>{setFilterStage(v);setFilterStatus("all");}} value={filterStage}>
                <SelectTrigger className="h-10 text-sm rounded-lg"><SelectValue placeholder="All Stages" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Stages</SelectItem>
                  <SelectItem value="resume">Resume Review</SelectItem>
                  <SelectItem value="l1">L1 Interview</SelectItem>
                  <SelectItem value="l2">L2 Interview</SelectItem>
                  <SelectItem value="hr">HR Round</SelectItem>
                  <SelectItem value="offer">Offer Stage</SelectItem>
                  <SelectItem value="final">Final Status</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Status</label>
              <Select onValueChange={setFilterStatus} value={filterStatus}>
                <SelectTrigger className="h-10 text-sm rounded-lg"><SelectValue placeholder="All Statuses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {filterStage==="resume" && <><SelectItem value="Accepted">Accepted</SelectItem><SelectItem value="Rejected">Rejected</SelectItem><SelectItem value="Pending">Pending</SelectItem></>}
                  {(filterStage==="l1"||filterStage==="l2"||filterStage==="hr") && <><SelectItem value="Scheduled">Scheduled</SelectItem><SelectItem value="Selected">Selected</SelectItem><SelectItem value="Rejected">Rejected</SelectItem><SelectItem value="Pending">Pending</SelectItem></>}
                  {filterStage==="offer" && <><SelectItem value="Pending">Pending</SelectItem><SelectItem value="Released">Released</SelectItem><SelectItem value="Accepted">Accepted</SelectItem><SelectItem value="Rejected">Rejected</SelectItem></>}
                  {(filterStage==="final"||filterStage==="all") && <><SelectItem value="In Progress">In Progress</SelectItem><SelectItem value="Completed">Completed</SelectItem><SelectItem value="Rejected">Rejected</SelectItem></>}
                </SelectContent>
              </Select>
            </div>
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={()=>{setFilterRole("all");setFilterStage("all");setFilterStatus("all");}} className="h-10 gap-1.5 text-xs rounded-lg border shrink-0">
              <XCircle className="h-3.5 w-3.5" /> Clear filters
            </Button>
          )}
        </div>
        {hasFilters && (
          <p className="text-[11px] text-muted-foreground mt-2 pt-2 border-t">
            Showing <span className="font-semibold text-foreground">{filtered.length}</span> of <span className="font-semibold text-foreground">{candidates.length}</span> total candidates
            {filterRole!=="all" && <span> · Role: <span className="font-semibold capitalize">{filterRole}</span></span>}
            {filterStage!=="all" && <span> · Stage: <span className="font-semibold capitalize">{filterStage}</span></span>}
            {filterStatus!=="all" && <span> · Status: <span className="font-semibold">{filterStatus}</span></span>}
          </p>
        )}
      </div>

      {/* ROW 1: CANDIDATE OVERVIEW */}
      <div>
        <SectionLabel>Candidate Overview</SectionLabel>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Total Candidates" value={stats.total}      icon={Users}        accent="bg-slate-500"   href={ROUTES.candidateHistory} />
          <StatCard title="Active Pipeline"   value={stats.inProgress} icon={Activity}     accent="bg-blue-500"   href={`${ROUTES.candidateHistory}?active=true`} />
          <StatCard title="Hired"             value={stats.completed}  icon={CheckCircle2} accent="bg-emerald-500" href={buildFilter(ROUTES.candidateHistory,"final","Completed")} />
          <StatCard title="Rejected"          value={stats.rejected}   icon={TrendingDown} accent="bg-rose-500"    href={buildFilter(ROUTES.candidateHistory,"final","Rejected")} />
        </div>
      </div>

      {/* ROW 2: PROJECTS & REQUIREMENTS + TREND */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

        {/* Projects & Requirements card */}
        <Card className="shadow-sm border flex flex-col h-full">
          <CardHeader className="pb-3 border-b shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-indigo-50 flex items-center justify-center">
                  <Layers className="h-4 w-4 text-indigo-600" />
                </div>
                <CardTitle className="text-sm font-bold">Projects & Requirements</CardTitle>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-semibold">{jobRequisitions.length} JR</span>
                <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 font-semibold">{requirements.length} REQ</span>
              </div>
            </div>
            {/* Source legend */}
            <div className="flex items-center gap-3 mt-2">
              <div className="flex items-center gap-1">
                <div className="h-2 w-2 rounded-full bg-blue-500" />
                <span className="text-[10px] text-muted-foreground font-medium">Job Requisition (Admin/HR)</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="h-2 w-2 rounded-full bg-amber-500" />
                <span className="text-[10px] text-muted-foreground font-medium">Requirement (Agency)</span>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {projectEntries.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2">
                <FileText className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground font-medium">No projects or requirements yet.</p>
              </div>
            ) : (
              <div className="p-3">
                {recentProjects.map(entry => (
                  <div
                    key={`${entry.source}-${entry.id}`}
                    className="grid grid-cols-4 gap-4 items-center border-b py-3 text-sm"
                  >
                    {/* 1️⃣ Project + Role */}
                    <div>
                      <p
                        onClick={() => router.push(`/admin/job-requisitions?projectName=${encodeURIComponent(entry.projectName)}`)}
                        className="font-semibold text-blue-600 cursor-pointer hover:underline truncate"
                      >
                        {entry.projectName?.trim() ? entry.projectName : entry.roles || "—"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{entry.roles || "—"}</p>
                    </div>

                    {/* ── FIX 1: Created By — name on top, clean role label below ── */}
                    {/* Shows e.g. "Pavithra A" on top, "HR" or "Agency" below        */}
                    {/* Previously showed the raw source ("job_requisition") as role   */}
                    <div>
                      <p className="font-medium text-sm truncate">{entry.createdByName || "—"}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                        {getRoleLabel(entry.createdByRole)}
                      </p>
                    </div>

                    {/* 3️⃣ Created Date */}
                    <div className="text-muted-foreground text-xs">
                      {fmtDate(entry.createdAt)}
                    </div>

                    {/* 4️⃣ Status */}
                    <div>
                      <StatusPill status={entry.status} color={entry.statusColor} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="px-4 py-2 text-center">
              <button
                onClick={() => router.push("/admin/job-requisitions")}
                className="text-sm font-semibold text-blue-600 hover:underline"
              >
                + View More
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Hiring Trend */}
        <Card className="shadow-sm border h-full">
          <CardHeader className="pb-2 pt-5 px-5">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
                <BarChart3 className="h-4 w-4 text-primary" />
              </div>
              <CardTitle className="text-base font-semibold">Hiring Trend</CardTitle>
              <span className="ml-auto text-xs text-muted-foreground">Last 6 months</span>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <ChartContainer config={trendConfig} className="h-[270px] w-full">
              <BarChart data={trendData} margin={{top:5,right:10,left:-10,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fontSize:11}} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={{fontSize:11}} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="evaluations" name="Evaluated" fill="var(--color-evaluations)" radius={[3,3,0,0]} barSize={15} />
                <Bar dataKey="hires"       name="Hires"     fill="var(--color-hires)"       radius={[3,3,0,0]} barSize={15} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* ROW 3: USER MANAGEMENT */}
      <div>
        <SectionLabel>User Management</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

          {/* HR Users */}
          <Card className="border bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-blue-100 dark:bg-blue-900 flex items-center justify-center"><UserCog className="h-4 w-4 text-blue-600" /></div>
                  <div><p className="text-sm font-bold text-blue-700 dark:text-blue-400">HR Users</p><p className="text-[10px] text-blue-500">Upload candidates</p></div>
                </div>
                <button onClick={()=>router.push(buildRole(ROUTES.userManagement,"hr"))} className="flex items-center gap-1 hover:opacity-80 transition-opacity">
                  <span className="text-2xl font-black text-blue-700 dark:text-blue-400">{userCounts.hr}</span>
                  <ArrowUpRight className="h-4 w-4 text-blue-500" />
                </button>
              </div>
              {hrBreakdown.length > 0 ? (
                <div className="space-y-1 pt-2 border-t border-blue-200 dark:border-blue-800">
                  {hrBreakdown.slice(0,3).map(hr => (
                    <button key={hr.id} onClick={()=>router.push(buildUploader(ROUTES.candidateHistory,hr.id))}
                      className="w-full flex items-center justify-between text-[11px] py-1 px-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors">
                      <span className="truncate text-muted-foreground max-w-[150px] text-left">{hr.name}</span>
                      <span className="font-bold text-blue-600 shrink-0 ml-2">{hr.count} candidates</span>
                    </button>
                  ))}
                  {hrBreakdown.length > 3 && (
                    <button onClick={()=>router.push(buildRole(ROUTES.userManagement,"hr"))} className="w-full text-center text-[10px] text-blue-500 hover:text-blue-700 pt-1 font-semibold">
                      +{hrBreakdown.length-3} more — View all HR users
                    </button>
                  )}
                </div>
              ) : <p className="text-[11px] text-muted-foreground pt-2 border-t border-blue-200">No HR users yet.</p>}
            </CardContent>
          </Card>

          {/* Panel Users */}
          <Card className="border bg-violet-50 dark:bg-violet-950/20 border-violet-200 dark:border-violet-800">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-violet-100 dark:bg-violet-900 flex items-center justify-center"><ShieldCheck className="h-4 w-4 text-violet-600" /></div>
                  <div><p className="text-sm font-bold text-violet-700 dark:text-violet-400">Panel Users</p><p className="text-[10px] text-violet-500">Handle L1 & L2</p></div>
                </div>
                <button onClick={()=>router.push(buildRole(ROUTES.userManagement,"panel"))} className="flex items-center gap-1 hover:opacity-80 transition-opacity">
                  <span className="text-2xl font-black text-violet-700 dark:text-violet-400">{userCounts.panel}</span>
                  <ArrowUpRight className="h-4 w-4 text-violet-500" />
                </button>
              </div>
              {panelBreakdown.length > 0 ? (
                <div className="space-y-1 pt-2 border-t border-violet-200 dark:border-violet-800">
                  {panelBreakdown.slice(0,3).map(panel => (
                    <button key={panel.id} onClick={()=>router.push(`${ROUTES.candidateHistory}?panelUid=${encodeURIComponent(panel.id)}`)}
                      className="w-full flex items-center justify-between text-[11px] py-1 px-1 rounded hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors">
                      <span className="truncate text-muted-foreground max-w-[150px] text-left">{panel.name}</span>
                      <span className="font-bold text-violet-600 shrink-0 ml-2">{panel.count} candidates</span>
                    </button>
                  ))}
                  {panelBreakdown.length > 3 && (
                    <button onClick={()=>router.push(buildRole(ROUTES.userManagement,"panel"))} className="w-full text-center text-[10px] text-violet-500 hover:text-violet-700 pt-1 font-semibold">
                      +{panelBreakdown.length-3} more — View all panel users
                    </button>
                  )}
                </div>
              ) : (
                <div className="pt-2 border-t border-violet-200 dark:border-violet-800 space-y-1">
                  <p className="text-[11px] text-muted-foreground">Handle L1 & L2 interview rounds</p>
                  <p className="text-[11px] text-muted-foreground"><span className="font-semibold text-violet-600">{stats.l1Scheduled + stats.l2Scheduled}</span> interviews scheduled</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Agency Users */}
          <Card className="border bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-amber-100 dark:bg-amber-900 flex items-center justify-center"><Building2 className="h-4 w-4 text-amber-600" /></div>
                  <div><p className="text-sm font-bold text-amber-700 dark:text-amber-400">Agency Users</p><p className="text-[10px] text-amber-500">Submit candidates</p></div>
                </div>
                <button onClick={()=>router.push(buildRole(ROUTES.userManagement,"agency"))} className="flex items-center gap-1 hover:opacity-80 transition-opacity">
                  <span className="text-2xl font-black text-amber-700 dark:text-amber-400">{userCounts.agency}</span>
                  <ArrowUpRight className="h-4 w-4 text-amber-500" />
                </button>
              </div>
              {agencyBreakdown.length > 0 ? (
                <div className="space-y-1 pt-2 border-t border-amber-200 dark:border-amber-800">
                  {agencyBreakdown.slice(0,3).map(agency => (
                    <button key={agency.id} onClick={()=>router.push(buildUploader(ROUTES.candidateHistory,agency.id))}
                      className="w-full flex items-center justify-between text-[11px] py-1 px-1 rounded hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors">
                      <span className="truncate text-muted-foreground max-w-[150px] text-left">{agency.name}</span>
                      <span className="font-bold text-amber-600 shrink-0 ml-2">{agency.count} candidates</span>
                    </button>
                  ))}
                  {agencyBreakdown.length > 3 && (
                    <button onClick={()=>router.push(buildRole(ROUTES.userManagement,"agency"))} className="w-full text-center text-[10px] text-amber-500 hover:text-amber-700 pt-1 font-semibold">
                      +{agencyBreakdown.length-3} more — View all agency users
                    </button>
                  )}
                </div>
              ) : <p className="text-[11px] text-muted-foreground pt-2 border-t border-amber-200">No agency users yet.</p>}
            </CardContent>
          </Card>

        </div>
      </div>

      {/* ROW 4: STAGE BREAKDOWN — with horizontal scroll on smaller screens */}
      <div>
        <SectionLabel>Interview Stage Breakdown</SectionLabel>
        <Card className="shadow-sm border">
          <CardContent className="p-5">
            {/* ── FIX 2: Horizontal scrollbar — wraps the 5-column grid so it
                doesn't squash on small screens. Scroll appears automatically   ── */}
            <div className="overflow-x-auto">
              <div className="grid grid-cols-5 gap-4 min-w-[700px]">
                <StageCol title="Resume Review" accent="bg-slate-100 dark:bg-slate-800" items={[
                  {label:"Accepted",count:stats.resumeAccepted,dot:"bg-emerald-500",href:buildFilter(ROUTES.candidateHistory,"resume","Accepted")},
                  {label:"Rejected",count:stats.resumeRejected,dot:"bg-rose-500",   href:buildFilter(ROUTES.candidateHistory,"resume","Rejected")},
                  {label:"Pending", count:stats.resumePending, dot:"bg-slate-400",  href:buildFilter(ROUTES.candidateHistory,"resume","Pending")},
                ]} />
                <StageCol title="L1 Interview" accent="bg-indigo-50 dark:bg-indigo-950/30" items={[
                  {label:"Selected", count:stats.l1Selected, dot:"bg-indigo-500",href:buildFilter(ROUTES.candidateHistory,"l1","Selected")},
                  {label:"Scheduled",count:stats.l1Scheduled,dot:"bg-blue-400", href:buildFilter(ROUTES.candidateHistory,"l1","Scheduled")},
                  {label:"Rejected", count:stats.l1Rejected, dot:"bg-rose-400", href:buildFilter(ROUTES.candidateHistory,"l1","Rejected")},
                  {label:"Pending",  count:stats.l1Pending,  dot:"bg-slate-300",href:buildFilter(ROUTES.candidateHistory,"l1","Pending")},
                ]} />
                <StageCol title="L2 Interview" accent="bg-blue-50 dark:bg-blue-950/30" items={[
                  {label:"Selected", count:stats.l2Selected, dot:"bg-indigo-500",href:buildFilter(ROUTES.candidateHistory,"l2","Selected")},
                  {label:"Scheduled",count:stats.l2Scheduled,dot:"bg-blue-400", href:buildFilter(ROUTES.candidateHistory,"l2","Scheduled")},
                  {label:"Rejected", count:stats.l2Rejected, dot:"bg-rose-600", href:buildFilter(ROUTES.candidateHistory,"l2","Rejected")},
                  {label:"Pending",  count:stats.l2Pending,  dot:"bg-slate-300",href:buildFilter(ROUTES.candidateHistory,"l2","Pending")},
                ]} />
                <StageCol title="HR Round" accent="bg-amber-50 dark:bg-amber-950/30" items={[
                  {label:"Selected", count:stats.hrSelected, dot:"bg-amber-500",href:buildFilter(ROUTES.candidateHistory,"hr","Selected")},
                  {label:"Scheduled",count:stats.hrScheduled,dot:"bg-amber-300",href:buildFilter(ROUTES.candidateHistory,"hr","Scheduled")},
                  {label:"Rejected", count:stats.hrRejected, dot:"bg-rose-700", href:buildFilter(ROUTES.candidateHistory,"hr","Rejected")},
                  {label:"Pending",  count:stats.hrPending,  dot:"bg-slate-300",href:buildFilter(ROUTES.candidateHistory,"hr","Pending")},
                ]} />
                <StageCol title="Offer Stage" accent="bg-emerald-50 dark:bg-emerald-950/30" items={[
                  {label:"Released",count:stats.offerReleased,dot:"bg-purple-500", href:buildFilter(ROUTES.candidateHistory,"offer","Released")},
                  {label:"Accepted",count:stats.offerAccepted,dot:"bg-emerald-500",href:buildFilter(ROUTES.candidateHistory,"offer","Accepted")},
                  {label:"Rejected",count:stats.offerRejected,dot:"bg-rose-500",   href:buildFilter(ROUTES.candidateHistory,"offer","Rejected")},
                  {label:"Pending", count:stats.offerPending, dot:"bg-slate-300",  href:buildFilter(ROUTES.candidateHistory,"offer","Pending")},
                ]} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ROW 5: UPCOMING INTERVIEWS */}
<div>
  <div className="flex items-center justify-between mb-3">
    <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
      Upcoming Interviews (Next 6 Days)
    </p>
    {upcoming.length > 1 && (
      <div className="flex items-center gap-2">
        <button
          onClick={() => carouselApi?.scrollPrev()}
          disabled={!canScrollPrev}
          className="h-7 w-7 rounded-full border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-all"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          onClick={() => carouselApi?.scrollNext()}
          disabled={!canScrollNext}
          className="h-7 w-7 rounded-full border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-all"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    )}
  </div>

  <Card className="shadow-sm border">
    <CardContent className="pt-5 px-4 pb-5">
      {upcoming.length > 0 ? (
        <Carousel
          setApi={setCarouselApi}
          opts={{ align: "start", loop: false }}
          className="w-full"
        >
          <CarouselContent className="-ml-3">
            {upcoming.map(item => (
              <CarouselItem
                key={item.id}
                className="pl-3 basis-full sm:basis-1/2 md:basis-1/3 lg:basis-1/4"
              >
                <Link href={`/candidates/${item.candidateId}`} className="block h-full">
                  <div className="h-full p-4 rounded-xl border bg-card hover:bg-muted/30 hover:border-primary/40 transition-all group cursor-pointer">
                    <div className="flex items-start justify-between mb-2.5">
                      <span className="text-xs font-bold text-primary bg-primary/8 px-2 py-0.5 rounded-md">
                        {item.roundLabel}
                      </span>
                      {item.isToday
                        ? <Badge className="bg-emerald-500 text-[9px] h-4 px-1.5">TODAY</Badge>
                        : <Badge variant="outline" className="text-[9px] h-4 px-1.5">Upcoming</Badge>}
                    </div>
                    <div className="space-y-1 mb-3">
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <CalendarDays className="h-3 w-3 text-primary shrink-0" />
                        <span>
                          {item.isToday
                            ? "Today"
                            : new Date(item.date + "T00:00:00").toLocaleDateString("en-IN", {
                                day: "2-digit", month: "short", year: "numeric",
                              })}
                        </span>
                      </div>
                      {item.timeSlot && (
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <Clock className="h-3 w-3 text-primary shrink-0" />
                          <span>{item.timeSlot}</span>
                        </div>
                      )}
                    </div>
                    <div className="pt-2.5 border-t">
                      <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">
                        {item.candidateName}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">{item.jobRole}</p>
                    </div>
                  </div>
                </Link>
              </CarouselItem>
            ))}
          </CarouselContent>
          {/* No CarouselPrevious / CarouselNext here — arrows are in the header above */}
        </Carousel>
      ) : (
        <div className="h-24 flex flex-col items-center justify-center border-2 border-dashed rounded-xl gap-1.5">
          <CalendarDays className="h-5 w-5 text-muted-foreground/30" />
          <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider">
            No scheduled interviews in the next 6 days
          </p>
        </div>
      )}
    </CardContent>
  </Card>
</div>
</div> 
  );
}
  