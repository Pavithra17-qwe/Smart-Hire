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
import {
  XCircle, Users, CalendarDays, Clock, ArrowUpRight, CheckCircle2,
  TrendingDown, Activity, BarChart3, PieChart as PieIcon,
  Loader2, ShieldCheck, ChevronRight, UserCog, Building2,
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

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const router = useRouter();
  const [candidates, setCandidates] = useState<any[]>([]);
  const [users,      setUsers]      = useState<any[]>([]);
  const [filterRole,   setFilterRole]   = useState("all"); // "all" | "hr" | "agency" | "panel"
  const [filterStage,  setFilterStage]  = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => { setIsMounted(true); }, []);

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
          // These fields identify which panel member handled each round
          // Adjust field names to match your Firestore schema
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

  // ── Filtered candidates ───────────────────────────────────────────────────
  // Filter logic:
  // - filterRole = "hr" or "agency" → filter by who uploaded (createdBy)
  // - filterRole = "panel" → filter by candidates that panel handled (l1/l2InterviewerUid)
  // - filterStage + filterStatus → filter by that stage's status field
  const filtered = useMemo(() => {
    const stageMap: Record<string, string> = {
      resume: "resumeReviewStatus",
      l1: "l1Status", l2: "l2Status",
      hr: "hrStatus", offer: "offerStatus",
      final: "finalStatus",
    };

    return candidates.filter(c => {
      // Role filter
      if (filterRole === "hr" || filterRole === "agency") {
        const uploader = users.find(u => u.id === c.createdBy);
        if (!uploader || (uploader.role || "").toLowerCase() !== filterRole) return false;
      } else if (filterRole === "panel") {
        // Panel: candidate must have been handled in L1 or L2 by a panel member
        const panelUids = users
          .filter(u => (u.role || "").toLowerCase() === "panel")
          .map(u => u.id);
        const handledByPanel =
          panelUids.includes(c.l1InterviewerUid) ||
          panelUids.includes(c.l2InterviewerUid);
        if (!handledByPanel) return false;
      }

      // Stage + Status filter
      if (filterStage !== "all" && filterStatus !== "all") {
        const field = stageMap[filterStage];
        if (field && c[field] !== filterStatus) return false;
      } else if (filterStage === "all" && filterStatus !== "all") {
        if (c.finalStatus !== filterStatus) return false;
      }

      return true;
    });
  }, [candidates, users, filterRole, filterStage, filterStatus]);

  // ── User role counts ──────────────────────────────────────────────────────
  const userCounts = useMemo(() => ({
    hr:     users.filter(u => (u.role || "").toLowerCase() === "hr").length,
    panel:  users.filter(u => (u.role || "").toLowerCase() === "panel").length,
    agency: users.filter(u => (u.role || "").toLowerCase() === "agency").length,
  }), [users]);

  // ── HR breakdown: each HR user + candidate count ──────────────────────────
  const hrBreakdown = useMemo(() => {
    return users
      .filter(u => (u.role || "").toLowerCase() === "hr")
      .map(u => ({
        id:    u.id,
        name:  u.displayName || u.name || u.email || "Unknown",
        count: candidates.filter(c => c.createdBy === u.id).length,
      }))
      .sort((a, b) => b.count - a.count);
  }, [users, candidates]);

  // ── Agency breakdown ──────────────────────────────────────────────────────
  const agencyBreakdown = useMemo(() => {
    return users
      .filter(u => (u.role || "").toLowerCase() === "agency")
      .map(u => ({
        id:    u.id,
        name:  u.displayName || u.name || u.email || "Unknown",
        count: candidates.filter(c => c.createdBy === u.id).length,
      }))
      .sort((a, b) => b.count - a.count);
  }, [users, candidates]);

  // ── Panel breakdown: candidates handled (L1 or L2) by each panel member ──
  const panelBreakdown = useMemo(() => {
    return users
      .filter(u => (u.role || "").toLowerCase() === "panel")
      .map(u => ({
        id:    u.id,
        name:  u.displayName || u.name || u.email || "Unknown",
        // Count unique candidates where this panel member handled L1 or L2
        count: candidates.filter(c =>
          c.l1InterviewerUid === u.id || c.l2InterviewerUid === u.id
        ).length,
      }))
      .sort((a, b) => b.count - a.count);
  }, [users, candidates]);

  // ── Candidate stats (always from filtered) ────────────────────────────────
  const stats = useMemo(() => ({
    total: filtered.length,
    inProgress: candidates.filter(c => {
      const f = (c.finalStatus ?? "").toLowerCase();
      return f !== "completed" && f !== "rejected";
    }).length,
    completed:  candidates.filter(c => c.finalStatus === "Completed").length,
    rejected:   candidates.filter(c => c.finalStatus === "Rejected").length,

    resumeAccepted: filtered.filter(c => c.resumeReviewStatus === "Accepted").length,
    resumeRejected: filtered.filter(c => c.resumeReviewStatus === "Rejected").length,
    resumePending:  filtered.filter(c => c.resumeReviewStatus === "Pending").length,

    l1Selected:  filtered.filter(c => c.l1Status === "Selected").length,
    l1Scheduled: filtered.filter(c => c.l1Status === "Scheduled").length,
    l1Rejected:  filtered.filter(c => c.l1Status === "Rejected").length,
    l1Pending:   filtered.filter(c => c.l1Status === "Pending").length,

    l2Selected:  filtered.filter(c => c.l2Status === "Selected").length,
    l2Scheduled: filtered.filter(c => c.l2Status === "Scheduled").length,
    l2Rejected:  filtered.filter(c => c.l2Status === "Rejected").length,
    l2Pending:   filtered.filter(c => c.l2Status === "Pending").length,

    hrSelected:  filtered.filter(c => c.hrStatus === "Selected").length,
    hrScheduled: filtered.filter(c => c.hrStatus === "Scheduled").length,
    hrRejected:  filtered.filter(c => c.hrStatus === "Rejected").length,
    hrPending:   filtered.filter(c => c.hrStatus === "Pending").length,

    offerPending:  filtered.filter(c => c.offerStatus === "Pending").length,
    offerReleased: filtered.filter(c => c.offerStatus === "Released").length,
    offerAccepted: filtered.filter(c => c.offerStatus === "Accepted").length,
    offerRejected: filtered.filter(c => c.offerStatus === "Rejected").length,
  }), [candidates, filtered]);

  // ── Pipeline donut ────────────────────────────────────────────────────────
  const pipelineData = useMemo(() => [
    { name: "L1 Selected", value: stats.l1Selected,  fill: "#6366F1", stage: "l1",    status: "Selected" },
    { name: "L2 Selected", value: stats.l2Selected,  fill: "#3B82F6", stage: "l2",    status: "Selected" },
    { name: "HR Selected", value: stats.hrSelected,  fill: "#F59E0B", stage: "hr",    status: "Selected" },
    { name: "Completed",   value: stats.completed,   fill: "#10B981", stage: "final", status: "Completed" },
  ].filter(d => d.value > 0), [stats]);
  const pipelineTotal = pipelineData.reduce((s, d) => s + d.value, 0);

  // ── 6-month trend ─────────────────────────────────────────────────────────
  const trendData = useMemo(() => {
    const last6: MonthlyData[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      last6.push({ month: d.toLocaleString("default", { month: "short" }), monthNum: d.getMonth(), year: d.getFullYear(), evaluations: 0, hires: 0 });
    }
    filtered.forEach(c => {
      const cDate = c.createdAt instanceof Date ? c.createdAt : new Date();
      const idx = last6.findIndex(m => m.monthNum === cDate.getMonth() && m.year === cDate.getFullYear());
      if (idx !== -1) {
        last6[idx].evaluations++;
        if (c.finalStatus === "Completed") last6[idx].hires++;
      }
    });
    return last6;
  }, [filtered]);

  // ── Upcoming interviews (next 3 days) — FIX: check all scheduled candidates ─
  const upcoming = useMemo(() => {
    const list: any[] = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split("T")[0];
    const maxDate  = new Date(today); maxDate.setDate(today.getDate() + 3);
    const maxStr   = maxDate.toISOString().split("T")[0];

    // Use filtered (respects active role/stage/status filters)
    filtered.forEach(c => {
      [
        { key: "l1", label: "L1 Interview", df: "l1ScheduledDate", sf: "l1TimeSlot", st: "l1Status" },
        { key: "l2", label: "L2 Interview", df: "l2ScheduledDate", sf: "l2TimeSlot", st: "l2Status" },
        { key: "hr", label: "HR Round",     df: "hrScheduledDate", sf: "hrTimeSlot", st: "hrStatus" },
      ].forEach(({ key, label, df, sf, st }) => {
        const ds = c[df];
        // FIX: only check Scheduled status for upcoming; include date range check
        if (c[st] === "Scheduled" && ds && ds >= todayStr && ds <= maxStr) {
          list.push({
            id:            `${c.id}-${key}`,
            candidateName: c.candidateName || "Unknown Candidate",
            // FIX: show designation/role — try multiple field names
            jobRole:       c.candidateDesignation || c.designation || c.jobTitle || c.role || c.position || "—",
            roundLabel:    label,
            date:          ds,
            timeSlot:      c[sf] || "",
            isToday:       ds === todayStr,
            candidateId:   c.id,
          });
        }
      });
    });
    return list.sort((a, b) => a.date.localeCompare(b.date));
  }, [filtered]);

  const hasFilters = filterRole !== "all" || filterStage !== "all" || filterStatus !== "all";

  if (!isMounted) return (
    <div className="h-screen flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );

  return (
    <div className="space-y-6 pb-10 w-full overflow-x-hidden">

      {/* ── Live indicator ── */}
      <div className="flex items-center justify-end">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-3 py-1.5 rounded-full">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse block" />
          Live data
        </div>
      </div>

      {/* ══════════════════════════════
          FILTERS
          - Role: All / HR (uploader) / Agency (uploader) / Panel (handled L1/L2)
          - Stage: which pipeline stage to inspect
          - Status: status value within that stage
      ══════════════════════════════ */}
      <div className="bg-card border rounded-xl p-4 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-3 items-end">
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">

            {/* Role filter */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Uploaded / Handled by
              </label>
              <Select onValueChange={v => { setFilterRole(v); }} value={filterRole}>
                <SelectTrigger className="h-10 text-sm rounded-lg"><SelectValue placeholder="All Roles" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  <SelectItem value="hr">HR (uploaded by HR)</SelectItem>
                  <SelectItem value="agency">Agency (uploaded by Agency)</SelectItem>
                  <SelectItem value="panel">Panel (handled L1 / L2)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Stage filter */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Stage</label>
              <Select onValueChange={v => { setFilterStage(v); setFilterStatus("all"); }} value={filterStage}>
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

            {/* Status filter — options change based on selected stage */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Status</label>
              <Select onValueChange={setFilterStatus} value={filterStatus}>
                <SelectTrigger className="h-10 text-sm rounded-lg"><SelectValue placeholder="All Statuses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {filterStage === "resume" && (
                    <>
                      <SelectItem value="Accepted">Accepted</SelectItem>
                      <SelectItem value="Rejected">Rejected</SelectItem>
                      <SelectItem value="Pending">Pending</SelectItem>
                    </>
                  )}
                  {(filterStage === "l1" || filterStage === "l2" || filterStage === "hr") && (
                    <>
                      <SelectItem value="Scheduled">Scheduled</SelectItem>
                      <SelectItem value="Selected">Selected</SelectItem>
                      <SelectItem value="Rejected">Rejected</SelectItem>
                      <SelectItem value="Pending">Pending</SelectItem>
                    </>
                  )}
                  {filterStage === "offer" && (
                    <>
                      <SelectItem value="Pending">Pending</SelectItem>
                      <SelectItem value="Released">Released</SelectItem>
                      <SelectItem value="Accepted">Accepted</SelectItem>
                      <SelectItem value="Rejected">Rejected</SelectItem>
                    </>
                  )}
                  {(filterStage === "final" || filterStage === "all") && (
                    <>
                      <SelectItem value="In Progress">In Progress</SelectItem>
                      <SelectItem value="Completed">Completed</SelectItem>
                      <SelectItem value="Rejected">Rejected</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>

          </div>

          {hasFilters && (
            <Button
              variant="ghost" size="sm"
              onClick={() => { setFilterRole("all"); setFilterStage("all"); setFilterStatus("all"); }}
              className="h-10 gap-1.5 text-xs rounded-lg border shrink-0"
            >
              <XCircle className="h-3.5 w-3.5" /> Clear filters
            </Button>
          )}
        </div>

        {/* Show filtered count hint */}
        {hasFilters && (
          <p className="text-[11px] text-muted-foreground mt-2 pt-2 border-t">
            Showing <span className="font-semibold text-foreground">{filtered.length}</span> of{" "}
            <span className="font-semibold text-foreground">{candidates.length}</span> total candidates
            {filterRole !== "all" && <span> · Role: <span className="font-semibold capitalize">{filterRole}</span></span>}
            {filterStage !== "all" && <span> · Stage: <span className="font-semibold capitalize">{filterStage}</span></span>}
            {filterStatus !== "all" && <span> · Status: <span className="font-semibold">{filterStatus}</span></span>}
          </p>
        )}
      </div>

      {/* ══════════════════════════════
          ROW 1: CANDIDATE OVERVIEW
      ══════════════════════════════ */}
      <div>
        <SectionLabel>Candidate Overview</SectionLabel>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Total Candidates" value={stats.total}      icon={Users}        accent="bg-slate-500"   href={ROUTES.candidateHistory} />
          <StatCard title="Active Pipeline"   value={stats.inProgress} icon={Activity}     accent="bg-blue-500"   href={`${ROUTES.candidateHistory}?active=true`} />
          <StatCard title="Hired"             value={stats.completed}  icon={CheckCircle2} accent="bg-emerald-500" href={buildFilter(ROUTES.candidateHistory, "final", "Completed")} />
          <StatCard title="Rejected"          value={stats.rejected}   icon={TrendingDown} accent="bg-rose-500"    href={buildFilter(ROUTES.candidateHistory, "final", "Rejected")} />
        </div>
      </div>

      {/* ══════════════════════════════
          ROW 2: USER MANAGEMENT — HR / Panel / Agency
          - Show 3 users each with count on the right
          - +N more → navigate to /users?role=...
          - Arrow icon → navigate to /users?role=...
          - Each user row → navigate to candidate history filtered by that user
      ══════════════════════════════ */}
      <div>
        <SectionLabel>User Management</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

          {/* ── HR Users ── */}
          <Card className="border bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
            <CardContent className="p-4">
              {/* Header row */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                    <UserCog className="h-4 w-4 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-blue-700 dark:text-blue-400">HR Users</p>
                    <p className="text-[10px] text-blue-500">Upload candidates</p>
                  </div>
                </div>
                {/* Count + arrow → navigate to user management filtered by HR */}
                <button
                  onClick={() => router.push(buildRole(ROUTES.userManagement, "hr"))}
                  className="flex items-center gap-1 hover:opacity-80 transition-opacity"
                >
                  <span className="text-2xl font-black text-blue-700 dark:text-blue-400">{userCounts.hr}</span>
                  <ArrowUpRight className="h-4 w-4 text-blue-500" />
                </button>
              </div>

              {/* Top 3 HR users */}
              {hrBreakdown.length > 0 ? (
                <div className="space-y-1 pt-2 border-t border-blue-200 dark:border-blue-800">
                  {hrBreakdown.slice(0, 3).map(hr => (
                    <button
                      key={hr.id}
                      onClick={() => router.push(buildUploader(ROUTES.candidateHistory, hr.id))}
                      className="w-full flex items-center justify-between text-[11px] py-1 px-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                    >
                      <span className="truncate text-muted-foreground hover:text-blue-700 dark:hover:text-blue-300 max-w-[150px] text-left">{hr.name}</span>
                      <span className="font-bold text-blue-600 shrink-0 ml-2">{hr.count} candidates</span>
                    </button>
                  ))}
                  {hrBreakdown.length > 3 && (
                    <button
                      onClick={() => router.push(buildRole(ROUTES.userManagement, "hr"))}
                      className="w-full text-center text-[10px] text-blue-500 hover:text-blue-700 pt-1 font-semibold"
                    >
                      +{hrBreakdown.length - 3} more — View all HR users
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground pt-2 border-t border-blue-200">No HR users yet.</p>
              )}
            </CardContent>
          </Card>

          {/* ── Panel Users ── */}
          <Card className="border bg-violet-50 dark:bg-violet-950/20 border-violet-200 dark:border-violet-800">
            <CardContent className="p-4">
              {/* Header row */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-violet-100 dark:bg-violet-900 flex items-center justify-center">
                    <ShieldCheck className="h-4 w-4 text-violet-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-violet-700 dark:text-violet-400">Panel Users</p>
                    <p className="text-[10px] text-violet-500">Handle L1 & L2</p>
                  </div>
                </div>
                {/* Count + arrow → navigate to user management filtered by panel */}
                <button
                  onClick={() => router.push(buildRole(ROUTES.userManagement, "panel"))}
                  className="flex items-center gap-1 hover:opacity-80 transition-opacity"
                >
                  <span className="text-2xl font-black text-violet-700 dark:text-violet-400">{userCounts.panel}</span>
                  <ArrowUpRight className="h-4 w-4 text-violet-500" />
                </button>
              </div>

              {/* Top 3 Panel users — show candidates HANDLED (not uploaded) */}
              {panelBreakdown.length > 0 ? (
                <div className="space-y-1 pt-2 border-t border-violet-200 dark:border-violet-800">
                  {panelBreakdown.slice(0, 3).map(panel => (
                    <button
                      key={panel.id}
                      // Click → show candidates where this panel member was interviewer
                      onClick={() => router.push(`${ROUTES.candidateHistory}?panelUid=${encodeURIComponent(panel.id)}`)}
                      className="w-full flex items-center justify-between text-[11px] py-1 px-1 rounded hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors"
                    >
                      <span className="truncate text-muted-foreground hover:text-violet-700 dark:hover:text-violet-300 max-w-[150px] text-left">{panel.name}</span>
                      <span className="font-bold text-violet-600 shrink-0 ml-2">{panel.count} candidates</span>
                    </button>
                  ))}
                  {panelBreakdown.length > 3 && (
                    <button
                      onClick={() => router.push(buildRole(ROUTES.userManagement, "panel"))}
                      className="w-full text-center text-[10px] text-violet-500 hover:text-violet-700 pt-1 font-semibold"
                    >
                      +{panelBreakdown.length - 3} more — View all panel users
                    </button>
                  )}
                </div>
              ) : (
                <div className="pt-2 border-t border-violet-200 dark:border-violet-800 space-y-1">
                  <p className="text-[11px] text-muted-foreground">Handle L1 & L2 interview rounds</p>
                  <p className="text-[11px] text-muted-foreground">
                    <span className="font-semibold text-violet-600">{stats.l1Scheduled + stats.l2Scheduled}</span> interviews scheduled
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Agency Users ── */}
          <Card className="border bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
            <CardContent className="p-4">
              {/* Header row */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-amber-100 dark:bg-amber-900 flex items-center justify-center">
                    <Building2 className="h-4 w-4 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-amber-700 dark:text-amber-400">Agency Users</p>
                    <p className="text-[10px] text-amber-500">Submit candidates</p>
                  </div>
                </div>
                {/* Count + arrow → navigate to user management filtered by agency */}
                <button
                  onClick={() => router.push(buildRole(ROUTES.userManagement, "agency"))}
                  className="flex items-center gap-1 hover:opacity-80 transition-opacity"
                >
                  <span className="text-2xl font-black text-amber-700 dark:text-amber-400">{userCounts.agency}</span>
                  <ArrowUpRight className="h-4 w-4 text-amber-500" />
                </button>
              </div>

              {/* Top 3 agency users */}
              {agencyBreakdown.length > 0 ? (
                <div className="space-y-1 pt-2 border-t border-amber-200 dark:border-amber-800">
                  {agencyBreakdown.slice(0, 3).map(agency => (
                    <button
                      key={agency.id}
                      onClick={() => router.push(buildUploader(ROUTES.candidateHistory, agency.id))}
                      className="w-full flex items-center justify-between text-[11px] py-1 px-1 rounded hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                    >
                      <span className="truncate text-muted-foreground hover:text-amber-700 dark:hover:text-amber-300 max-w-[150px] text-left">{agency.name}</span>
                      <span className="font-bold text-amber-600 shrink-0 ml-2">{agency.count} candidates</span>
                    </button>
                  ))}
                  {agencyBreakdown.length > 3 && (
                    <button
                      onClick={() => router.push(buildRole(ROUTES.userManagement, "agency"))}
                      className="w-full text-center text-[10px] text-amber-500 hover:text-amber-700 pt-1 font-semibold"
                    >
                      +{agencyBreakdown.length - 3} more — View all agency users
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground pt-2 border-t border-amber-200">No agency users yet.</p>
              )}
            </CardContent>
          </Card>

        </div>
      </div>

      {/* ══════════════════════════════
          ROW 3: PIPELINE DONUT + TREND
      ══════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Funnel donut (2/5) */}
        <Card className="lg:col-span-2 shadow-sm border">
          <CardHeader className="pb-2 pt-5 px-5">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
                <PieIcon className="h-4 w-4 text-primary" />
              </div>
              <CardTitle className="text-base font-semibold">Hiring Funnel</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            {pipelineTotal > 0 ? (
              <>
                <ChartContainer config={pipelineConfig} className="mx-auto aspect-square max-h-[190px] w-full">
                  <PieChart>
                    <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                    <Pie data={pipelineData} dataKey="value" nameKey="name"
                      innerRadius={55} outerRadius={78} strokeWidth={3}
                      stroke="hsl(var(--background))" paddingAngle={3}>
                      {pipelineData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                      <Label content={({ viewBox }) => {
                        if (viewBox && "cx" in viewBox && "cy" in viewBox) return (
                          <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                            <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-2xl font-black">{pipelineTotal}</tspan>
                            <tspan x={viewBox.cx} y={(viewBox.cy || 0) + 18} className="fill-muted-foreground text-[9px] font-bold uppercase tracking-widest">pipeline</tspan>
                          </text>
                        );
                      }} />
                    </Pie>
                  </PieChart>
                </ChartContainer>
                <div className="mt-3 space-y-1.5">
                  {pipelineData.map(d => (
                    <button key={d.name}
                      onClick={() => router.push(buildFilter(ROUTES.candidateHistory, d.stage, d.status))}
                      className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-muted/50 transition-colors group">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full" style={{ backgroundColor: d.fill }} />
                        <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground">{d.name}</span>
                      </div>
                      <span className="text-sm font-bold group-hover:text-primary">{d.value}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">No pipeline data</div>
            )}
          </CardContent>
        </Card>

        {/* Trend bar (3/5) */}
        <Card className="lg:col-span-3 shadow-sm border">
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
              <BarChart data={trendData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11 }} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="evaluations" name="Evaluated" fill="var(--color-evaluations)" radius={[3,3,0,0]} barSize={15} />
                <Bar dataKey="hires"       name="Hires"     fill="var(--color-hires)"       radius={[3,3,0,0]} barSize={15} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

      </div>

      {/* ══════════════════════════════
          ROW 4: STAGE BREAKDOWN
      ══════════════════════════════ */}
      <div>
        <SectionLabel>Interview Stage Breakdown</SectionLabel>
        <Card className="shadow-sm border">
          <CardContent className="p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <StageCol title="Resume Review" accent="bg-slate-100 dark:bg-slate-800" items={[
                { label:"Accepted", count:stats.resumeAccepted, dot:"bg-emerald-500", href:buildFilter(ROUTES.candidateHistory,"resume","Accepted") },
                { label:"Rejected", count:stats.resumeRejected, dot:"bg-rose-500",    href:buildFilter(ROUTES.candidateHistory,"resume","Rejected") },
                { label:"Pending",  count:stats.resumePending,  dot:"bg-slate-400",   href:buildFilter(ROUTES.candidateHistory,"resume","Pending") },
              ]} />
              <StageCol title="L1 Interview" accent="bg-indigo-50 dark:bg-indigo-950/30" items={[
                { label:"Selected",  count:stats.l1Selected,  dot:"bg-indigo-500", href:buildFilter(ROUTES.candidateHistory,"l1","Selected") },
                { label:"Scheduled", count:stats.l1Scheduled, dot:"bg-blue-400",   href:buildFilter(ROUTES.candidateHistory,"l1","Scheduled") },
                { label:"Rejected",  count:stats.l1Rejected,  dot:"bg-rose-400",   href:buildFilter(ROUTES.candidateHistory,"l1","Rejected") },
                { label:"Pending",   count:stats.l1Pending,   dot:"bg-slate-300",  href:buildFilter(ROUTES.candidateHistory,"l1","Pending") },
              ]} />
              <StageCol title="L2 Interview" accent="bg-blue-50 dark:bg-blue-950/30" items={[
                { label:"Selected",  count:stats.l2Selected,  dot:"bg-indigo-500", href:buildFilter(ROUTES.candidateHistory,"l2","Selected") },
                { label:"Scheduled", count:stats.l2Scheduled, dot:"bg-blue-400",   href:buildFilter(ROUTES.candidateHistory,"l2","Scheduled") },
                { label:"Rejected",  count:stats.l2Rejected,  dot:"bg-rose-600",   href:buildFilter(ROUTES.candidateHistory,"l2","Rejected") },
                { label:"Pending",   count:stats.l2Pending,   dot:"bg-slate-300",  href:buildFilter(ROUTES.candidateHistory,"l2","Pending") },
              ]} />
              <StageCol title="HR Round" accent="bg-amber-50 dark:bg-amber-950/30" items={[
                { label:"Selected",  count:stats.hrSelected,  dot:"bg-amber-500", href:buildFilter(ROUTES.candidateHistory,"hr","Selected") },
                { label:"Scheduled", count:stats.hrScheduled, dot:"bg-amber-300", href:buildFilter(ROUTES.candidateHistory,"hr","Scheduled") },
                { label:"Rejected",  count:stats.hrRejected,  dot:"bg-rose-700",  href:buildFilter(ROUTES.candidateHistory,"hr","Rejected") },
                { label:"Pending",   count:stats.hrPending,   dot:"bg-slate-300", href:buildFilter(ROUTES.candidateHistory,"hr","Pending") },
              ]} />
              <StageCol title="Offer Stage" accent="bg-emerald-50 dark:bg-emerald-950/30" items={[
                { label:"Released", count:stats.offerReleased, dot:"bg-purple-500",  href:buildFilter(ROUTES.candidateHistory,"offer","Released") },
                { label:"Accepted", count:stats.offerAccepted, dot:"bg-emerald-500", href:buildFilter(ROUTES.candidateHistory,"offer","Accepted") },
                { label:"Rejected", count:stats.offerRejected, dot:"bg-rose-500",    href:buildFilter(ROUTES.candidateHistory,"offer","Rejected") },
                { label:"Pending",  count:stats.offerPending,  dot:"bg-slate-300",   href:buildFilter(ROUTES.candidateHistory,"offer","Pending") },
              ]} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ══════════════════════════════
          ROW 5: UPCOMING INTERVIEWS
          FIX: show designation below name, fix N/A issue
      ══════════════════════════════ */}
      <div>
        <SectionLabel>Upcoming Interviews (Next 3 Days)</SectionLabel>
        <Card className="shadow-sm border">
          <CardContent className="pt-5 px-8 pb-5 relative">
            {upcoming.length > 0 ? (
              <Carousel opts={{ align: "start" }} className="w-full">
                <CarouselContent className="-ml-3">
                  {upcoming.map(item => (
                    <CarouselItem key={item.id} className="pl-3 basis-full sm:basis-1/2 md:basis-1/3 lg:basis-1/4">
                      <Link href={`/candidates/${item.candidateId}`} className="block h-full">
                        <div className="h-full p-4 rounded-xl border bg-card hover:bg-muted/30 hover:border-primary/40 transition-all group cursor-pointer">
                          <div className="flex items-start justify-between mb-2.5">
                            <span className="text-xs font-bold text-primary bg-primary/8 px-2 py-0.5 rounded-md">
                              {item.roundLabel}
                            </span>
                            {item.isToday
                              ? <Badge className="bg-emerald-500 text-[9px] h-4 px-1.5">TODAY</Badge>
                              : <Badge variant="outline" className="text-[9px] h-4 px-1.5">Upcoming</Badge>
                            }
                          </div>
                          <div className="space-y-1 mb-3">
                            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                              <CalendarDays className="h-3 w-3 text-primary shrink-0" />
                              <span>
                                {item.isToday
                                  ? "Today"
                                  : new Date(item.date + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
                                }
                              </span>
                            </div>
                            {item.timeSlot && (
                              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                <Clock className="h-3 w-3 text-primary shrink-0" />
                                <span>{item.timeSlot}</span>
                              </div>
                            )}
                          </div>
                          {/* FIX: name + designation — fallback chain so it never shows N/A */}
                          <div className="pt-2.5 border-t">
                            <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">
                              {item.candidateName}
                            </p>
                            <p className="text-[11px] text-muted-foreground truncate">
                              {item.jobRole}
                            </p>
                          </div>
                        </div>
                      </Link>
                    </CarouselItem>
                  ))}
                </CarouselContent>
                {upcoming.length > 4 && (
                  <>
                    <CarouselPrevious className="-left-5" />
                    <CarouselNext className="-right-5" />
                  </>
                )}
              </Carousel>
            ) : (
              <div className="h-24 flex flex-col items-center justify-center border-2 border-dashed rounded-xl gap-1.5">
                <CalendarDays className="h-5 w-5 text-muted-foreground/30" />
                <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider">
                  No scheduled interviews in the next 3 days
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  );
}