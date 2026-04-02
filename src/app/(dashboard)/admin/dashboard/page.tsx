"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { PieChart, Pie, Label, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend, Cell } from "recharts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  XCircle, Users, CalendarDays, History, Clock, ArrowUpRight,
  TrendingDown, Activity, BarChart3, PieChart as PieIcon,
  UserPlus, Timer, Loader2, ShieldCheck, Briefcase,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";

// ─────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────
const ROUTES = {
  candidateHistory: "/admin/candidate-history",
  candidateList:    "/admin/candidate-list",
  userManagement:   "/admin/user-management",
};

// ─────────────────────────────────────────────
// STAGE KEY MAP  ← FIX #1: consistent keys
// UI label  →  Firestore field name
// ─────────────────────────────────────────────
const STAGE_FIELD: Record<string, string> = {
  resume: "resumeReviewStatus",
  l1:     "l1Status",
  l2:     "l2Status",
  hr:     "hrStatus",
  offer:  "offerStatus",
  final:  "finalStatus",
};

/**
 * Build a URL that the candidate history / user-management page can read.
 * e.g. buildUrl(ROUTES.candidateHistory, "l1", "Selected")
 *   → /admin/candidate-history?stage=l1Status&status=Selected
 */
function buildUrl(base: string, stageKey: string, status: string): string {
  if (stageKey === "role") return `${base}?role=${encodeURIComponent(status)}`;
  const field = STAGE_FIELD[stageKey] || stageKey;
  return `${base}?stage=${encodeURIComponent(field)}&status=${encodeURIComponent(status)}`;
}

// ─────────────────────────────────────────────
// STATUS NORMALIZER
// ─────────────────────────────────────────────
function normalizeStatus(status: any): string {
  const s = (status || "").toLowerCase().trim();
  if (s === "accepted")    return "Accepted";
  if (s === "selected")    return "Selected";
  if (s === "rejected")    return "Rejected";
  if (s === "scheduled")   return "Scheduled";
  if (s === "pending")     return "Pending";
  if (s === "locked")      return "Locked";
  if (s === "released")    return "Released";
  if (s === "completed")   return "Completed";
  if (s === "in progress") return "In Progress";
  return status || "Pending";
}

// ─────────────────────────────────────────────
// CHART CONFIGS
// ─────────────────────────────────────────────
const pipelineConfig = {
  resumeAccepted: { label: "Resume Accepted", color: "#8B5CF6" },
  l1:             { label: "L1 Selected",     color: "#6366F1" },
  l2:             { label: "L2 Selected",     color: "#3B82F6" },
  hr:             { label: "HR Selected",     color: "#F59E0B" },
  completed:      { label: "Completed",       color: "#10B981" },
} satisfies ChartConfig;

const hiringTrendConfig = {
  evaluations: { label: "Evaluations", color: "hsl(var(--primary))" },
  hires:       { label: "Hires",       color: "#10B981"            },
} satisfies ChartConfig;

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────
export default function AdminDashboard() {
  const router = useRouter();
  const [candidates, setCandidates] = useState<any[]>([]);
  const [users,      setUsers]      = useState<any[]>([]);
  const [filterJobRole, setFilterJobRole] = useState("all");
  const [filterStage,   setFilterStage]   = useState("all");
  const [filterStatus,  setFilterStatus]  = useState("all");
  const [isMounted,     setIsMounted]     = useState(false);

  useEffect(() => { setIsMounted(true); }, []);

  // ── Firestore listeners ──
  useEffect(() => {
    const unsubCandidates = onSnapshot(collection(db, "candidates"), snap => {
      setCandidates(snap.docs.map(doc => {
        const raw = doc.data();

        // FIX #2: safe date parsing — don't fall back to new Date() (causes current-month clustering)
        let createdAt: Date | null = null;
        if (raw.createdAt?.toDate)      createdAt = raw.createdAt.toDate();
        else if (raw.lastUpdated?.toDate) createdAt = raw.lastUpdated.toDate();
        else if (raw.createdAt)          createdAt = new Date(raw.createdAt);

        return {
          id: doc.id,
          ...raw,
          resumeReviewStatus: normalizeStatus(raw.resumeReviewStatus),
          l1Status:           normalizeStatus(raw.l1Status),
          l2Status:           normalizeStatus(raw.l2Status),
          hrStatus:           normalizeStatus(raw.hrStatus),
          offerStatus:        normalizeStatus(raw.offerStatus),
          finalStatus:        raw.finalStatus || "In Progress",
          createdAt,   // null if unknown — we skip nulls in hiringTrendData
        };
      }));
    });

    const unsubUsers = onSnapshot(collection(db, "users"), snap => {
      setUsers(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => { unsubCandidates(); unsubUsers(); };
  }, []);

  // ── Filtered candidates ──
  const filtered = useMemo(() => {
    return candidates.filter(c => {
      const roleMatch = filterJobRole === "all" || c.candidateDesignation === filterJobRole;

      let stageMatch = true;
      if (filterStage !== "all" && filterStatus !== "all") {
        stageMatch = c[filterStage] === filterStatus;
      } else if (filterStage !== "all") {
        stageMatch = c[filterStage] !== "Locked";
      } else if (filterStatus !== "all") {
        stageMatch = c.finalStatus === filterStatus;
      }

      return roleMatch && stageMatch;
    });
  }, [candidates, filterJobRole, filterStage, filterStatus]);

  const uniqueRoles = useMemo(() => {
    return [...new Set(candidates.map(c => c.candidateDesignation).filter(Boolean))] as string[];
  }, [candidates]);

  // ── User role counts ──
  const userStats = useMemo(() => ({
    hr:     users.filter(u => (u.role || "").toLowerCase() === "hr").length,
    panel:  users.filter(u => (u.role || "").toLowerCase() === "panel").length,
    agency: users.filter(u => (u.role || "").toLowerCase() === "agency").length,
  }), [users]);

  // ── Stats ──
  const stats = useMemo(() => {
    const count = (field: string, val: string) => filtered.filter(c => c[field] === val).length;
    return {
      total:          filtered.length,
      inProgress:     filtered.filter(c => c.finalStatus === "In Progress").length,
      completed:      count("finalStatus",        "Completed"),
      rejected:       count("finalStatus",        "Rejected"),
      resumeAccepted: count("resumeReviewStatus", "Accepted"),
      resumeRejected: count("resumeReviewStatus", "Rejected"),
      resumePending:  count("resumeReviewStatus", "Pending"),
      l1Selected:     count("l1Status", "Selected"),
      l1Rejected:     count("l1Status", "Rejected"),
      l1Scheduled:    count("l1Status", "Scheduled"),
      l1Pending:      count("l1Status", "Pending"),
      l2Selected:     count("l2Status", "Selected"),
      l2Rejected:     count("l2Status", "Rejected"),
      l2Scheduled:    count("l2Status", "Scheduled"),
      l2Pending:      count("l2Status", "Pending"),
      hrSelected:     count("hrStatus", "Selected"),
      hrRejected:     count("hrStatus", "Rejected"),
      hrScheduled:    count("hrStatus", "Scheduled"),
      hrPending:      count("hrStatus", "Pending"),
      offerPending:   count("offerStatus", "Pending"),
      offerReleased:  count("offerStatus", "Released"),
      offerAccepted:  count("offerStatus", "Accepted"),
      offerRejected:  count("offerStatus", "Rejected"),
    };
  }, [filtered]);

  // FIX #3: Pipeline includes resumeAccepted as entry stage so donut never shows empty
  const pipelineData = useMemo(() => [
    { name: "Resume Accepted", value: stats.resumeAccepted, fill: "#8B5CF6" },
    { name: "L1 Selected",     value: stats.l1Selected,     fill: "#6366F1" },
    { name: "L2 Selected",     value: stats.l2Selected,     fill: "#3B82F6" },
    { name: "HR Selected",     value: stats.hrSelected,     fill: "#F59E0B" },
    { name: "Completed",       value: stats.completed,      fill: "#10B981" },
  ].filter(d => d.value > 0), [stats]);

  const pipelineTotal = pipelineData.reduce((s, d) => s + d.value, 0);

  // FIX #4: skip candidates where createdAt is null so we don't pollute current month
  const hiringTrendData = useMemo(() => {
    const last6 = Array.from({ length: 6 }, (_, i) => {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - (5 - i));
      return {
        month:    d.toLocaleString("default", { month: "short" }),
        monthNum: d.getMonth(),
        year:     d.getFullYear(),
        evaluations: 0,
        hires: 0,
      };
    });

    filtered.forEach(c => {
      if (!c.createdAt) return;   // skip unknown dates
      const idx = last6.findIndex(
        m => m.monthNum === c.createdAt.getMonth() && m.year === c.createdAt.getFullYear()
      );
      if (idx !== -1) {
        last6[idx].evaluations++;
        if (c.finalStatus === "Completed") last6[idx].hires++;
      }
    });
    return last6;
  }, [filtered]);

  // FIX #5: Accept common Firestore field name variants for interview schedule fields
  const upcomingInterviews = useMemo(() => {
    const interviews: any[] = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayStr  = today.toISOString().split("T")[0];
    const maxDate   = new Date(today); maxDate.setDate(today.getDate() + 3);
    const maxStr    = maxDate.toISOString().split("T")[0];

    // Accept either camelCase or snake_case field names
    const getField = (c: any, ...keys: string[]) => {
      for (const k of keys) if (c[k] !== undefined && c[k] !== null && c[k] !== "") return c[k];
      return "";
    };

    filtered.forEach(c => {
      [
        {
          key: "l1", label: "L1 Interview",
          dateField:   ["l1ScheduledDate", "l1_scheduled_date", "l1InterviewDate"],
          slotField:   ["l1TimeSlot",       "l1_time_slot",      "l1Slot"],
          statusField: "l1Status",
        },
        {
          key: "l2", label: "L2 Interview",
          dateField:   ["l2ScheduledDate", "l2_scheduled_date", "l2InterviewDate"],
          slotField:   ["l2TimeSlot",       "l2_time_slot",      "l2Slot"],
          statusField: "l2Status",
        },
        {
          key: "hr", label: "HR Round",
          dateField:   ["hrScheduledDate", "hr_scheduled_date", "hrInterviewDate"],
          slotField:   ["hrTimeSlot",       "hr_time_slot",      "hrSlot"],
          statusField: "hrStatus",
        },
      ].forEach(({ key, label, dateField, slotField, statusField }) => {
        const dateStr = getField(c, ...dateField);
        const status  = c[statusField];
        if (status === "Scheduled" && dateStr && dateStr >= todayStr && dateStr <= maxStr) {
          interviews.push({
            id: `${c.id}-${key}`,
            candidateName: c.candidateName || c.name || "Unknown",
            jobRole:       c.candidateDesignation || c.jobRole || "N/A",
            roundLabel: label, date: dateStr,
            timeSlot: getField(c, ...slotField),
            isToday: dateStr === todayStr,
            candidateId: c.id,
          });
        }
      });
    });
    return interviews.sort((a, b) => a.date.localeCompare(b.date));
  }, [filtered]);

  const hasActiveFilters = filterJobRole !== "all" || filterStage !== "all" || filterStatus !== "all";

  const handleClearFilters = () => { setFilterJobRole("all"); setFilterStage("all"); setFilterStatus("all"); };

  if (!isMounted) {
    return (
      <div className="h-screen w-full flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10 w-full overflow-x-hidden">

      {/* ── PAGE HEADER ── */}
      <div>
        <h1 className="text-2xl font-black tracking-tight">Admin Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">System-wide recruitment overview and analytics.</p>
      </div>

      {/* ── FILTERS ── */}
      <div className="flex flex-col md:flex-row items-end gap-4 bg-card p-4 rounded-xl shadow-sm border">
        <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 w-full">

          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase text-muted-foreground tracking-wider ml-1">Job Role</label>
            <Select onValueChange={setFilterJobRole} value={filterJobRole}>
              <SelectTrigger className="rounded-lg h-10 text-sm">
                <SelectValue placeholder="All Roles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                {uniqueRoles.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase text-muted-foreground tracking-wider ml-1">Stage</label>
            <Select onValueChange={v => { setFilterStage(v); setFilterStatus("all"); }} value={filterStage}>
              <SelectTrigger className="rounded-lg h-10 text-sm">
                <SelectValue placeholder="All Stages" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stages</SelectItem>
                <SelectItem value="resumeReviewStatus">Resume Review</SelectItem>
                <SelectItem value="l1Status">L1 Interview</SelectItem>
                <SelectItem value="l2Status">L2 Interview</SelectItem>
                <SelectItem value="hrStatus">HR Round</SelectItem>
                <SelectItem value="offerStatus">Offer Stage</SelectItem>
                <SelectItem value="finalStatus">Final Status</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase text-muted-foreground tracking-wider ml-1">Status</label>
            <Select onValueChange={setFilterStatus} value={filterStatus}>
              <SelectTrigger className="rounded-lg h-10 text-sm">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {filterStage === "resumeReviewStatus" && <>
                  <SelectItem value="Accepted">Accepted</SelectItem>
                  <SelectItem value="Rejected">Rejected</SelectItem>
                  <SelectItem value="Pending">Pending</SelectItem>
                </>}
                {["l1Status","l2Status","hrStatus"].includes(filterStage) && <>
                  <SelectItem value="Scheduled">Scheduled</SelectItem>
                  <SelectItem value="Selected">Selected</SelectItem>
                  <SelectItem value="Rejected">Rejected</SelectItem>
                  <SelectItem value="Pending">Pending</SelectItem>
                </>}
                {filterStage === "offerStatus" && <>
                  <SelectItem value="Pending">Pending</SelectItem>
                  <SelectItem value="Released">Released</SelectItem>
                  <SelectItem value="Accepted">Accepted</SelectItem>
                  <SelectItem value="Rejected">Rejected</SelectItem>
                </>}
                {(filterStage === "finalStatus" || filterStage === "all") && <>
                  <SelectItem value="In Progress">In Progress</SelectItem>
                  <SelectItem value="Completed">Completed</SelectItem>
                  <SelectItem value="Rejected">Rejected</SelectItem>
                </>}
              </SelectContent>
            </Select>
          </div>

        </div>
        {hasActiveFilters && (
          <Button variant="secondary" size="sm" onClick={handleClearFilters}
            className="h-10 gap-2 text-xs font-bold rounded-lg px-4 shrink-0">
            <XCircle className="h-4 w-4" /> Clear Filters
          </Button>
        )}
      </div>

      {/* ── TOP METRIC CARDS ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard title="Total Candidates" value={stats.total}         icon={Users}        color="border-l-slate-400"   href={ROUTES.candidateHistory} />
        <MetricCard title="In Progress"      value={stats.inProgress}    icon={Activity}     color="border-l-blue-400"    href={buildUrl(ROUTES.candidateHistory, "final", "In Progress")} />
        <MetricCard title="Completed"        value={stats.completed}     icon={ArrowUpRight} color="border-l-emerald-500" href={buildUrl(ROUTES.candidateHistory, "final", "Completed")} />
        <MetricCard title="Rejected"         value={stats.rejected}      icon={TrendingDown} color="border-l-rose-500"    href={buildUrl(ROUTES.candidateHistory, "final", "Rejected")} />
        <MetricCard title="Offer Released"   value={stats.offerReleased} icon={Timer}        color="border-l-purple-500"  href={buildUrl(ROUTES.candidateHistory, "offer", "Released")} />
        <MetricCard title="Offer Accepted"   value={stats.offerAccepted} icon={ShieldCheck}  color="border-l-teal-500"    href={buildUrl(ROUTES.candidateHistory, "offer", "Accepted")} />
      </div>

      {/* ── USER ROLE CARDS ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <UserRoleCard title="HR Users"     count={userStats.hr}     href={buildUrl(ROUTES.userManagement, "role", "hr")}     color="bg-blue-50 border-blue-200"   textColor="text-blue-700"   icon={Users} />
        <UserRoleCard title="Panel Users"  count={userStats.panel}  href={buildUrl(ROUTES.userManagement, "role", "panel")}  color="bg-purple-50 border-purple-200" textColor="text-purple-700" icon={ShieldCheck} />
        <UserRoleCard title="Agency Users" count={userStats.agency} href={buildUrl(ROUTES.userManagement, "role", "agency")} color="bg-amber-50 border-amber-200"  textColor="text-amber-700"  icon={Briefcase} />
      </div>

      {/* ── PIPELINE + HIRING TREND ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

        {/* Pipeline Donut */}
        <Card className="lg:col-span-5 shadow-sm border">
          <CardHeader className="bg-muted/30 pb-3 border-b">
            <div className="flex items-center gap-2">
              <PieIcon className="h-4 w-4 text-primary" />
              <CardTitle className="text-base font-bold">Pipeline Distribution</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-6 flex flex-col items-center">
            {pipelineTotal > 0 ? (
              <ChartContainer config={pipelineConfig} className="mx-auto aspect-square max-h-[220px] w-full">
                <PieChart>
                  <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                  <Pie data={pipelineData} dataKey="value" nameKey="name"
                    innerRadius={60} outerRadius={88} strokeWidth={3}
                    stroke="hsl(var(--background))" paddingAngle={3}>
                    {pipelineData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    <Label content={({ viewBox }) => {
                      if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                        return (
                          <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                            <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-3xl font-black">{pipelineTotal}</tspan>
                            <tspan x={viewBox.cx} y={(viewBox.cy || 0) + 20} className="fill-muted-foreground text-[10px] font-bold uppercase tracking-widest">Pipeline</tspan>
                          </text>
                        );
                      }
                    }} />
                  </Pie>
                </PieChart>
              </ChartContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm italic">
                No pipeline data yet.
              </div>
            )}

            {/* Clickable legend */}
            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2.5 px-2 w-full max-w-[320px]">
              {[
                { name: "Resume OK", fill: "#8B5CF6", value: stats.resumeAccepted, stage: "resume", status: "Accepted" },
                { name: "L1 Selected", fill: "#6366F1", value: stats.l1Selected,  stage: "l1",     status: "Selected" },
                { name: "L2 Selected", fill: "#3B82F6", value: stats.l2Selected,  stage: "l2",     status: "Selected" },
                { name: "HR Selected", fill: "#F59E0B", value: stats.hrSelected,  stage: "hr",     status: "Selected" },
                { name: "Completed",   fill: "#10B981", value: stats.completed,   stage: "final",  status: "Completed" },
              ].map(item => (
                <button key={item.name}
                  onClick={() => router.push(buildUrl(ROUTES.candidateHistory, item.stage, item.status))}
                  className="flex items-center justify-between gap-2 hover:opacity-70 transition-opacity text-left">
                  <div className="flex items-center gap-1.5 truncate">
                    <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: item.fill }} />
                    <span className="text-[10px] font-semibold text-muted-foreground truncate">{item.name}</span>
                  </div>
                  <span className="text-[11px] font-black tabular-nums underline decoration-dotted">{item.value}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Hiring Trend Bar Chart */}
        <Card className="lg:col-span-7 shadow-sm border">
          <CardHeader className="bg-muted/30 pb-3 border-b">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              <CardTitle className="text-base font-bold">Hiring Trend (Last 6 Months)</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <ChartContainer config={hiringTrendConfig} className="h-[300px] w-full">
              <BarChart data={hiringTrendData} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted))" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 500 }} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Legend iconType="circle" wrapperStyle={{ paddingTop: "12px", fontSize: "12px", fontWeight: 600 }} />
                <Bar dataKey="evaluations" name="Evaluated" fill="var(--color-evaluations)" radius={[4,4,0,0]} barSize={16} />
                <Bar dataKey="hires"       name="Hires"     fill="var(--color-hires)"       radius={[4,4,0,0]} barSize={16} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* ── INTERVIEW STAGE BREAKDOWN + OFFER STAGE ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

        {/* Stage Breakdown */}
        <Card className="lg:col-span-8 shadow-sm border">
          <CardHeader className="bg-muted/30 pb-3 border-b">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <CardTitle className="text-base font-bold">Interview Stage Breakdown</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5">

              {/* Resume Review */}
              <StageColumn title="Resume Review">
                <ClickablePill label="Accepted" count={stats.resumeAccepted} dotColor="bg-emerald-500" href={buildUrl(ROUTES.candidateHistory, "resume", "Accepted")} />
                <ClickablePill label="Rejected" count={stats.resumeRejected} dotColor="bg-rose-500"    href={buildUrl(ROUTES.candidateHistory, "resume", "Rejected")} />
                <ClickablePill label="Pending"  count={stats.resumePending}  dotColor="bg-slate-400"   href={buildUrl(ROUTES.candidateHistory, "resume", "Pending")} />
              </StageColumn>

              {/* L1 */}
              <StageColumn title="L1 Interview">
                <ClickablePill label="Selected"  count={stats.l1Selected}  dotColor="bg-indigo-500" href={buildUrl(ROUTES.candidateHistory, "l1", "Selected")} />
                <ClickablePill label="Scheduled" count={stats.l1Scheduled} dotColor="bg-blue-400"   href={buildUrl(ROUTES.candidateHistory, "l1", "Scheduled")} />
                <ClickablePill label="Rejected"  count={stats.l1Rejected}  dotColor="bg-rose-500"   href={buildUrl(ROUTES.candidateHistory, "l1", "Rejected")} />
                <ClickablePill label="Pending"   count={stats.l1Pending}   dotColor="bg-slate-400"  href={buildUrl(ROUTES.candidateHistory, "l1", "Pending")} />
              </StageColumn>

              {/* L2 */}
              <StageColumn title="L2 Interview">
                <ClickablePill label="Selected"  count={stats.l2Selected}  dotColor="bg-indigo-500" href={buildUrl(ROUTES.candidateHistory, "l2", "Selected")} />
                <ClickablePill label="Scheduled" count={stats.l2Scheduled} dotColor="bg-blue-400"   href={buildUrl(ROUTES.candidateHistory, "l2", "Scheduled")} />
                <ClickablePill label="Rejected"  count={stats.l2Rejected}  dotColor="bg-rose-600"   href={buildUrl(ROUTES.candidateHistory, "l2", "Rejected")} />
                <ClickablePill label="Pending"   count={stats.l2Pending}   dotColor="bg-slate-400"  href={buildUrl(ROUTES.candidateHistory, "l2", "Pending")} />
              </StageColumn>

              {/* HR */}
              <StageColumn title="HR Round">
                <ClickablePill label="Selected"  count={stats.hrSelected}  dotColor="bg-amber-500" href={buildUrl(ROUTES.candidateHistory, "hr", "Selected")} />
                <ClickablePill label="Scheduled" count={stats.hrScheduled} dotColor="bg-amber-300" href={buildUrl(ROUTES.candidateHistory, "hr", "Scheduled")} />
                <ClickablePill label="Rejected"  count={stats.hrRejected}  dotColor="bg-rose-700"  href={buildUrl(ROUTES.candidateHistory, "hr", "Rejected")} />
                <ClickablePill label="Pending"   count={stats.hrPending}   dotColor="bg-slate-400" href={buildUrl(ROUTES.candidateHistory, "hr", "Pending")} />
              </StageColumn>

            </div>
          </CardContent>
        </Card>

        {/* Offer Stage + Quick Links */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          <Card className="shadow-sm border flex-1">
            <CardHeader className="bg-muted/30 pb-3 border-b">
              <CardTitle className="text-sm font-bold">Offer Stage</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-2.5">
              <ClickablePill label="Pending"  count={stats.offerPending}  dotColor="bg-slate-400"   href={buildUrl(ROUTES.candidateHistory, "offer", "Pending")} />
              <ClickablePill label="Released" count={stats.offerReleased} dotColor="bg-purple-500"  href={buildUrl(ROUTES.candidateHistory, "offer", "Released")} />
              <ClickablePill label="Accepted" count={stats.offerAccepted} dotColor="bg-emerald-500" href={buildUrl(ROUTES.candidateHistory, "offer", "Accepted")} />
              <ClickablePill label="Rejected" count={stats.offerRejected} dotColor="bg-rose-500"    href={buildUrl(ROUTES.candidateHistory, "offer", "Rejected")} />
            </CardContent>
          </Card>

          {/* Quick links */}
          <div className="grid grid-cols-2 gap-3">
            <QuickLink href={ROUTES.candidateList}    icon={UserPlus} label="Candidate List" primary />
            <QuickLink href={ROUTES.candidateHistory} icon={History}  label="History" />
          </div>
        </div>
      </div>

      {/* ── UPCOMING INTERVIEWS ── */}
      <Card className="shadow-sm border">
        <CardHeader className="bg-muted/30 pb-3 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-primary" />
              <CardTitle className="text-base font-bold">Upcoming Interviews</CardTitle>
            </div>
            <span className="text-xs text-muted-foreground font-medium">Today + Next 3 days</span>
          </div>
        </CardHeader>
        <CardContent className="pt-6 px-8 relative">
          {upcomingInterviews.length > 0 ? (
            <Carousel opts={{ align: "start" }} className="w-full">
              <CarouselContent className="-ml-3">
                {upcomingInterviews.map(item => (
                  <CarouselItem key={item.id} className="pl-3 basis-full sm:basis-1/2 md:basis-1/3 xl:basis-1/4">
                    <Link href={`${ROUTES.candidateHistory}/${item.candidateId}`} className="block h-full">
                      <div className="flex flex-col p-4 rounded-xl border bg-card hover:bg-accent/5 hover:border-primary/30 transition-all h-full">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-bold">{item.roundLabel}</span>
                          {item.isToday && (
                            <Badge className="bg-emerald-500 hover:bg-emerald-600 text-[10px] h-4 px-1.5">TODAY</Badge>
                          )}
                        </div>
                        <div className="flex flex-col gap-1 text-xs text-muted-foreground font-medium">
                          <div className="flex items-center gap-1.5">
                            <CalendarDays className="h-3 w-3 text-primary shrink-0" />
                            <span>{item.isToday ? "Today" : new Date(item.date + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span>
                          </div>
                          {item.timeSlot && (
                            <div className="flex items-center gap-1.5">
                              <Clock className="h-3 w-3 text-primary shrink-0" />
                              <span>{item.timeSlot}</span>
                            </div>
                          )}
                        </div>
                        <div className="mt-3 pt-3 border-t">
                          <p className="text-xs font-bold text-primary truncate">{item.candidateName}</p>
                          <p className="text-[10px] text-muted-foreground italic truncate mt-0.5">{item.jobRole}</p>
                        </div>
                      </div>
                    </Link>
                  </CarouselItem>
                ))}
              </CarouselContent>
              {upcomingInterviews.length > 4 && (
                <>
                  <CarouselPrevious className="-left-5 h-7 w-7" />
                  <CarouselNext className="-right-5 h-7 w-7" />
                </>
              )}
            </Carousel>
          ) : (
            <div className="h-24 flex items-center justify-center border-2 border-dashed rounded-xl">
              <p className="text-sm text-muted-foreground font-semibold">No scheduled interviews in the next 3 days</p>
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}

// ─────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────

function MetricCard({ title, value, icon: Icon, color, href }: {
  title: string; value: number; icon: any; color: string; href: string;
}) {
  return (
    <Link href={href} className="block group">
      <Card className={cn("shadow-sm border-l-4 transition-all hover:shadow-md hover:-translate-y-0.5 cursor-pointer", color)}>
        <CardContent className="p-4 flex items-center justify-between">
          <div>
            <p className="text-[9px] font-black text-muted-foreground uppercase tracking-[0.12em] leading-tight">{title}</p>
            <p className="text-2xl font-black mt-1 group-hover:text-primary transition-colors">{value}</p>
          </div>
          <div className="h-9 w-9 bg-muted/50 rounded-lg flex items-center justify-center text-muted-foreground/50 group-hover:bg-primary/10 group-hover:text-primary transition-all">
            <Icon className="h-4 w-4" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function UserRoleCard({ title, count, color, textColor, icon: Icon, href }: {
  title: string; count: number; color: string; textColor: string; icon: any; href: string;
}) {
  return (
    <Link href={href} className="block group">
      <div className={cn("flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5", color)}>
        <div className="flex items-center gap-3">
          <Icon className={cn("h-4 w-4", textColor)} />
          <span className={cn("text-sm font-bold", textColor)}>{title}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={cn("text-2xl font-black", textColor)}>{count}</span>
          <ArrowUpRight className={cn("h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity", textColor)} />
        </div>
      </div>
    </Link>
  );
}

function StageColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <h4 className="text-[9px] font-black text-muted-foreground uppercase tracking-widest pb-1 border-b">{title}</h4>
      {children}
    </div>
  );
}

function ClickablePill({ label, count, dotColor, href }: {
  label: string; count: number; dotColor: string; href: string;
}) {
  return (
    <Link href={href} className="block group">
      <div className="flex items-center justify-between px-3 py-2 border rounded-lg bg-card hover:bg-accent/5 hover:border-primary/30 transition-all cursor-pointer">
        <div className="flex items-center gap-2">
          <div className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotColor)} />
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide group-hover:text-foreground transition-colors">{label}</span>
        </div>
        <span className="text-sm font-black group-hover:text-primary transition-colors tabular-nums">{count}</span>
      </div>
    </Link>
  );
}

function QuickLink({ href, icon: Icon, label, primary }: {
  href: string; icon: any; label: string; primary?: boolean;
}) {
  return (
    <Link href={href} className="block group">
      <Card className={cn(
        "border-2 border-dashed transition-all cursor-pointer",
        primary
          ? "border-primary/20 hover:border-primary/50 hover:bg-primary/[0.02]"
          : "border-muted-foreground/20 hover:border-muted-foreground/40"
      )}>
        <CardContent className="p-4 flex flex-col items-center justify-center text-center gap-2">
          <div className={cn(
            "h-8 w-8 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform",
            primary ? "bg-primary/10" : "bg-muted"
          )}>
            <Icon className={cn("h-4 w-4", primary ? "text-primary" : "text-muted-foreground")} />
          </div>
          <h3 className="font-bold text-xs leading-tight">{label}</h3>
        </CardContent>
      </Card>
    </Link>
  );
}