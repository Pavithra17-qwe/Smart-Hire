"use client";

import { useEffect, useState, useMemo } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Carousel, CarouselContent, CarouselItem,
  CarouselNext, CarouselPrevious,
} from "@/components/ui/carousel";
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ChartContainer, ChartTooltip, ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, Label,
} from "recharts";
import {
  Users, Send, XCircle, CheckCircle2,
  Loader2, ChevronRight,
  BarChart3, TrendingUp, PlusCircle,
  ClipboardList, ArrowUpRight, Activity,
  UserCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── types ─────────────────────────────────────────────────────────────────
interface Candidate {
  id: string;
  candidateName?: string;
  candidateDesignation?: string;
  finalStatus?: string;
  resumeReviewStatus?: string;
  l1Status?: string;
  l2Status?: string;
  hrStatus?: string;
  offerStatus?: string;
  aiScore?: number;
  createdBy?: string;
  jobRequisitionId?: string;
  requirementTitle?: string;
  createdAt?: any;
  l1ScheduledDate?: string;
  l2ScheduledDate?: string;
}

interface Requirement {
  id: string;
  title?: string;
  projectName?: string;
  jobRole?: string;
  experienceRequired?: string;
  status?: string;
  createdBy?: string;
}

interface MonthlyData { month: string; monthNum: number; year: number; submitted: number; selected: number; }

// ─── helpers ────────────────────────────────────────────────────────────────
function normalize(s: any): string {
  const v = (s || "").toLowerCase().trim();
  if (v === "accepted")    return "Accepted";
  if (v === "selected")    return "Selected";
  if (v === "rejected")    return "Rejected";
  if (v === "scheduled")   return "Scheduled";
  if (v === "pending")     return "Pending";
  if (v === "released")    return "Released";
  if (v === "completed")   return "Completed";
  if (v === "in progress") return "In Progress";
  return s || "Pending";
}

function getStageLabel(c: Candidate): string {
  if (c.offerStatus && c.offerStatus !== "Pending")  return `Offer — ${c.offerStatus}`;
  if (c.hrStatus    && c.hrStatus    !== "Pending")  return `HR — ${c.hrStatus}`;
  if (c.l2Status    && c.l2Status    !== "Pending")  return `L2 — ${c.l2Status}`;
  if (c.l1Status    && c.l1Status    !== "Pending")  return `L1 — ${c.l1Status}`;
  if (c.resumeReviewStatus)                          return `Resume — ${c.resumeReviewStatus}`;
  return "Submitted";
}

// ─── chart config ───────────────────────────────────────────────────────────
const trendConfig = {
  submitted: { label: "Submitted",  color: "hsl(var(--primary))" },
  selected:  { label: "Progressed", color: "#10B981" },
} satisfies ChartConfig;

// ─── sub-components ─────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-3">
      {children}
    </p>
  );
}

function StatCard({ title, value, icon: Icon, accent, href, description, highlight }: {
  title: string; value: number | string; icon: any; accent: string;
  href: string; description: string; highlight?: boolean;
}) {
  return (
    <Link href={href} className="block group">
      <Card className={cn(
        "shadow-sm border hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer overflow-hidden",
        highlight && "border-amber-300 dark:border-amber-700"
      )}>
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider leading-tight">
                {title}
              </p>
              <p className={cn(
                "text-3xl font-black mt-1.5 transition-colors",
                highlight ? "text-amber-600 dark:text-amber-400" : "group-hover:text-primary"
              )}>
                {value}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
            </div>
            <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center text-white shrink-0", accent)}>
              <Icon className="h-4 w-4" />
            </div>
          </div>
          <div className={cn(
            "flex items-center gap-1 mt-3 text-[11px] transition-colors",
            highlight ? "text-amber-500" : "text-muted-foreground group-hover:text-primary"
          )}>
            <span>View candidates</span>
            <ChevronRight className="h-3 w-3" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function StageRow({ label, count, dot, href }: { label: string; count: number; dot: string; href: string }) {
  return (
    <Link href={href} className="block group">
      <div className="flex items-center justify-between px-3 py-2 rounded-lg border bg-card hover:bg-muted/50 hover:border-primary/30 transition-all">
        <div className="flex items-center gap-2">
          <div className={cn("h-2 w-2 rounded-full shrink-0", dot)} />
          <span className="text-[11px] font-semibold text-muted-foreground group-hover:text-foreground transition-colors">{label}</span>
        </div>
        <span className="text-sm font-black group-hover:text-primary transition-colors">{count}</span>
      </div>
    </Link>
  );
}

// ─── main component ──────────────────────────────────────────────────────────
export default function AgencyDashboard() {
  const { user } = useAuth();
  const router = useRouter();
  const agencyUid  = user?.uid ?? "";

  const [candidates,   setCandidates]   = useState<Candidate[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [filterReqId,  setFilterReqId]  = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [loading,      setLoading]      = useState(true);
  const [isMounted,    setIsMounted]    = useState(false);

  useEffect(() => { setIsMounted(true); }, []);

  useEffect(() => {
    if (!agencyUid) return;

    const candQuery = query(
      collection(db, "candidates"),
      where("createdBy", "==", agencyUid)
    );
    const reqQuery = query(
      collection(db, "requirements"),
      where("createdBy", "==", agencyUid)
    );

    let candLoaded = false, reqLoaded = false;
    const checkDone = () => { if (candLoaded && reqLoaded) setLoading(false); };

    const unsub1 = onSnapshot(candQuery, snap => {
      setCandidates(snap.docs.map(doc => {
        const r = doc.data();
        return {
          id: doc.id, ...r,
          resumeReviewStatus: normalize(r.resumeReviewStatus),
          l1Status:    normalize(r.l1Status),
          l2Status:    normalize(r.l2Status),
          hrStatus:    normalize(r.hrStatus),
          offerStatus: normalize(r.offerStatus),
          finalStatus: r.finalStatus || "In Progress",
          createdAt:   r.createdAt?.toDate?.() || new Date(),
        } as Candidate;
      }));
      candLoaded = true; checkDone();
    });

    const unsub2 = onSnapshot(reqQuery, snap => {
      setRequirements(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Requirement)));
      reqLoaded = true; checkDone();
    });

    return () => { unsub1(); unsub2(); };
  }, [agencyUid]);

  // ── filtered candidates ───────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return candidates.filter(c => {
      if (filterReqId !== "all" && c.jobRequisitionId !== filterReqId) return false;
      if (filterStatus !== "all") {
        const stage = getStageLabel(c).toLowerCase();
        if (!stage.includes(filterStatus.toLowerCase())) return false;
      }
      return true;
    });
  }, [candidates, filterReqId, filterStatus]);

  // ── stats ─────────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:          filtered.length,
    inProgress:     filtered.filter(c => {
      const f = (c.finalStatus ?? "").toLowerCase();
      return f !== "completed" && f !== "rejected";
    }).length,
    resumePending:  filtered.filter(c => c.resumeReviewStatus === "Pending").length,
    resumeAccepted: filtered.filter(c => c.resumeReviewStatus === "Accepted").length,
    resumeRejected: filtered.filter(c => c.resumeReviewStatus === "Rejected").length,
    l1Scheduled:    filtered.filter(c => c.l1Status === "Scheduled").length,
    l1Selected:     filtered.filter(c => c.l1Status === "Selected").length,
    l1Rejected:     filtered.filter(c => c.l1Status === "Rejected").length,
    l2Scheduled:    filtered.filter(c => c.l2Status === "Scheduled").length,
    l2Selected:     filtered.filter(c => c.l2Status === "Selected").length,
    l2Rejected:     filtered.filter(c => c.l2Status === "Rejected").length,
    offerPending:   filtered.filter(c => c.offerStatus === "Pending").length,
    offerReleased:  filtered.filter(c => c.offerStatus === "Released").length,
    offerAccepted:  filtered.filter(c => c.offerStatus === "Accepted").length,
    offerRejected:  filtered.filter(c => c.offerStatus === "Rejected").length,
    hired:          filtered.filter(c => c.finalStatus === "Completed").length,
    rejected:       filtered.filter(c => c.finalStatus === "Rejected").length,
  }), [filtered]);

  // ── funnel donut ──────────────────────────────────────────────────────────
  const funnelData = useMemo(() => [
    { name: "Resume Accepted", value: stats.resumeAccepted, fill: "#6366F1" },
    { name: "L1 Selected",     value: stats.l1Selected,     fill: "#3B82F6" },
    { name: "L2 Selected",     value: stats.l2Selected,     fill: "#F59E0B" },
    { name: "Offer Released",  value: stats.offerReleased,  fill: "#10B981" },
    { name: "Hired",           value: stats.hired,          fill: "#8B5CF6" },
  ].filter(d => d.value > 0), [stats]);
  const funnelTotal = funnelData.reduce((s, d) => s + d.value, 0);

  // ── 6-month trend ─────────────────────────────────────────────────────────
  const trendData = useMemo<MonthlyData[]>(() => {
    const months: MonthlyData[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      months.push({ month: d.toLocaleString("default", { month: "short" }), monthNum: d.getMonth(), year: d.getFullYear(), submitted: 0, selected: 0 });
    }
    filtered.forEach(c => {
      const cDate = c.createdAt instanceof Date ? c.createdAt : new Date();
      const idx = months.findIndex(m => m.monthNum === cDate.getMonth() && m.year === cDate.getFullYear());
      if (idx !== -1) {
        months[idx].submitted++;
        if (c.l1Status === "Selected" || c.l2Status === "Selected" || c.finalStatus === "Completed") {
          months[idx].selected++;
        }
      }
    });
    return months;
  }, [filtered]);

  // ── recent 6 candidates ───────────────────────────────────────────────────
  const recent = useMemo(() =>
    [...filtered]
      .sort((a, b) => {
        const da = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
        const db2 = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
        return db2 - da;
      })
      .slice(0, 6),
  [filtered]);
  const upcoming = useMemo(() => {
    const list: any[] = [];
  
    const today = new Date();
    today.setHours(0,0,0,0);
  
    const todayStr = today.toISOString().split("T")[0];
  
    const maxDate = new Date(today);
    maxDate.setDate(today.getDate() + 6); // ✅ 6 days
  
    const maxStr = maxDate.toISOString().split("T")[0];
  
    filtered.forEach(c => {
      [
        { key:"l1", label:"L1 Interview", df:"l1ScheduledDate", sf:"l1TimeSlot", st:"l1Status" },
        { key:"l2", label:"L2 Interview", df:"l2ScheduledDate", sf:"l2TimeSlot", st:"l2Status" },
        { key:"hr", label:"HR Round",     df:"hrScheduledDate", sf:"hrTimeSlot", st:"hrStatus" }
      ].forEach(({ key, label, df, sf, st }) => {
        const ds = (c as any)[df];
  
        if (c[st as keyof Candidate] === "Scheduled" && ds && ds >= todayStr && ds <= maxStr) {
          list.push({
            id: `${c.id}-${key}`,
            candidateName: c.candidateName || "Unknown Candidate",
            jobRole: c.candidateDesignation || "—",
            roundLabel: label,
            date: ds,
            timeSlot: (c as any)[sf] || "",
            isToday: ds === todayStr,
            candidateId: c.id,
          });
        }
      });
    });
  
    return list.sort((a, b) => a.date.localeCompare(b.date));
  }, [filtered]);
  // ── pass rate ─────────────────────────────────────────────────────────────
  const passRate = useMemo(() => {
    const decided = stats.hired + stats.rejected;
    return decided > 0 ? Math.round((stats.hired / decided) * 100) : 0;
  }, [stats]);

  if (!isMounted || loading) {
    return (
      <div className="h-screen flex items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading Agency Dashboard…</p>
      </div>
    );
  }

  const hasFilters = filterReqId !== "all" || filterStatus !== "all";

  return (
    <div className="space-y-6 pb-10 w-full overflow-x-hidden">

      {/* ── Filters ── */}
      <div className="bg-card border rounded-xl p-4 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-3 items-end">
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Filter by Requirement
              </label>
              <Select value={filterReqId} onValueChange={setFilterReqId}>
                <SelectTrigger className="h-10 text-sm rounded-lg">
                  <SelectValue placeholder="All Requirements" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Requirements</SelectItem>
                  {requirements.map(r => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.title || r.projectName || r.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Filter by Status
              </label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-10 text-sm rounded-lg">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">Resume Pending</SelectItem>
                  <SelectItem value="accepted">Resume Accepted</SelectItem>
                  <SelectItem value="scheduled">Interview Scheduled</SelectItem>
                  <SelectItem value="selected">Selected</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="released">Offer Released</SelectItem>
                  <SelectItem value="completed">Hired</SelectItem>
                </SelectContent>
              </Select>
            </div>

          </div>

          {hasFilters && (
            <Button variant="ghost" size="sm"
              onClick={() => { setFilterReqId("all"); setFilterStatus("all"); }}
              className="h-10 gap-1.5 text-xs rounded-lg border shrink-0"
            >
              <XCircle className="h-3.5 w-3.5" /> Clear
            </Button>
          )}
        </div>
        {hasFilters && (
          <p className="text-[11px] text-muted-foreground mt-2">
            Showing <span className="font-semibold text-foreground">{filtered.length}</span> of{" "}
            <span className="font-semibold text-foreground">{candidates.length}</span> your candidates
          </p>
        )}
      </div>

      {/* ── ROW 1: Stat cards ── */}
      <div>
        <SectionLabel>My Candidate Overview</SectionLabel>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard
            title="Total Submitted"  value={stats.total}
            icon={Users}             accent="bg-slate-500"
            href="/candidates/list"  description="Candidates you added"
          />
          <StatCard
            title="Active Pipeline"  value={stats.inProgress}
            icon={Activity}          accent="bg-blue-500"
            href="/candidates/history?active=true"
            description="In review or interview"
          />
          <StatCard
            title="Offer Released"   value={stats.offerReleased}
            icon={Send}              accent="bg-violet-500"
            href="/candidates/history?stage=offer&status=released"
            description="Awaiting acceptance"
          />
          <StatCard
            title="Hired"            value={stats.hired}
            icon={UserCheck}         accent="bg-emerald-500"
            href="/candidates/history?stage=final&status=completed"
            description="Successfully placed"
          />
          <StatCard
            title="Rejected"         value={stats.rejected}
            icon={XCircle}           accent="bg-rose-500"
            href="/candidates/history?stage=final&status=rejected"
            description="Did not progress"
          />
        </div>
      </div>

      {/* ── ROW 2: Pipeline donut + Trend chart ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Donut (2/5) */}
        <Card className="lg:col-span-2 shadow-sm border">
          <CardHeader className="pb-2 pt-5 px-5">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
                <TrendingUp className="h-4 w-4 text-primary" />
              </div>
              <CardTitle className="text-base font-semibold">Pipeline Progress</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            {funnelTotal > 0 ? (
              <>
                <ChartContainer config={{} as ChartConfig} className="mx-auto aspect-square max-h-[180px] w-full">
                  <PieChart>
                    <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                    <Pie data={funnelData} dataKey="value" nameKey="name"
                      innerRadius={52} outerRadius={74} strokeWidth={3}
                      stroke="hsl(var(--background))" paddingAngle={3}>
                      {funnelData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                      <Label content={({ viewBox }) => {
                        if (viewBox && "cx" in viewBox && "cy" in viewBox) return (
                          <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                            <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-2xl font-black">{funnelTotal}</tspan>
                            <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 18} className="fill-muted-foreground text-[9px] font-bold uppercase tracking-widest">active</tspan>
                          </text>
                        );
                      }} />
                    </Pie>
                  </PieChart>
                </ChartContainer>
                <div className="mt-2 space-y-1.5">
                  {funnelData.map(d => (
                    <div key={d.name} className="flex items-center justify-between px-2 py-1 rounded-lg hover:bg-muted/50">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full" style={{ backgroundColor: d.fill }} />
                        <span className="text-[11px] font-medium text-muted-foreground">{d.name}</span>
                      </div>
                      <span className="text-sm font-bold">{d.value}</span>
                    </div>
                  ))}
                </div>
                
              </>
            ) : (
              <div className="h-48 flex flex-col items-center justify-center gap-2">
                <Users className="h-8 w-8 text-muted-foreground/20" />
                <p className="text-sm text-muted-foreground">No candidates yet</p>
                <Button asChild size="sm" variant="outline">
                  <Link href="/candidates/add">Add your first candidate</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Trend (3/5) */}
        <Card className="lg:col-span-3 shadow-sm border">
          <CardHeader className="pb-2 pt-5 px-5">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
                <BarChart3 className="h-4 w-4 text-primary" />
              </div>
              <CardTitle className="text-base font-semibold">Submission Trend</CardTitle>
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
                <Bar dataKey="submitted" name="Submitted"  fill="var(--color-submitted)" radius={[3, 3, 0, 0]} barSize={14} />
                <Bar dataKey="selected"  name="Progressed" fill="var(--color-selected)"  radius={[3, 3, 0, 0]} barSize={14} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

      </div>

      {/* ── ROW 3: Stage breakdown ── */}
      <div>
        <SectionLabel>Candidate Stage Breakdown</SectionLabel>
        <Card className="shadow-sm border">
          <CardContent className="p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">

              <div className="space-y-2">
                <div className="px-3 py-1.5 rounded-lg text-center bg-slate-100 dark:bg-slate-800">
                  <p className="text-[10px] font-black uppercase tracking-widest text-foreground/70">Resume Review</p>
                </div>
                <div className="space-y-1.5">
                  <StageRow label="Accepted" count={stats.resumeAccepted} dot="bg-emerald-500" href="/candidates/history?stage=resume&status=accepted" />
                  <StageRow label="Rejected" count={stats.resumeRejected} dot="bg-rose-500"    href="/candidates/history?stage=resume&status=rejected" />
                  <StageRow label="Pending"  count={stats.resumePending}  dot="bg-slate-400"   href="/candidates/history?stage=resume&status=pending" />
                </div>
              </div>

              <div className="space-y-2">
                <div className="px-3 py-1.5 rounded-lg text-center bg-indigo-50 dark:bg-indigo-950/30">
                  <p className="text-[10px] font-black uppercase tracking-widest text-foreground/70">L1 Interview</p>
                </div>
                <div className="space-y-1.5">
                  <StageRow label="Scheduled" count={stats.l1Scheduled} dot="bg-blue-400"   href="/candidates/history?stage=l1&status=scheduled" />
                  <StageRow label="Selected"  count={stats.l1Selected}  dot="bg-indigo-500" href="/candidates/history?stage=l1&status=selected" />
                  <StageRow label="Rejected"  count={stats.l1Rejected}  dot="bg-rose-400"   href="/candidates/history?stage=l1&status=rejected" />
                </div>
              </div>

              <div className="space-y-2">
                <div className="px-3 py-1.5 rounded-lg text-center bg-blue-50 dark:bg-blue-950/30">
                  <p className="text-[10px] font-black uppercase tracking-widest text-foreground/70">L2 Interview</p>
                </div>
                <div className="space-y-1.5">
                  <StageRow label="Scheduled" count={stats.l2Scheduled} dot="bg-sky-400"  href="/candidates/history?stage=l2&status=scheduled" />
                  <StageRow label="Selected"  count={stats.l2Selected}  dot="bg-blue-500" href="/candidates/history?stage=l2&status=selected" />
                  <StageRow label="Rejected"  count={stats.l2Rejected}  dot="bg-rose-600" href="/candidates/history?stage=l2&status=rejected" />
                </div>
              </div>

              <div className="space-y-2">
                <div className="px-3 py-1.5 rounded-lg text-center bg-amber-50 dark:bg-amber-950/30">
                  <p className="text-[10px] font-black uppercase tracking-widest text-foreground/70">HR Round</p>
                </div>
                <div className="space-y-1.5">
                  <StageRow label="Scheduled" count={filtered.filter(c => c.hrStatus === "Scheduled").length} dot="bg-amber-300" href="/candidates/history?stage=hr&status=scheduled" />
                  <StageRow label="Selected"  count={filtered.filter(c => c.hrStatus === "Selected").length}  dot="bg-amber-500" href="/candidates/history?stage=hr&status=selected" />
                  <StageRow label="Rejected"  count={filtered.filter(c => c.hrStatus === "Rejected").length}  dot="bg-rose-700"  href="/candidates/history?stage=hr&status=rejected" />
                </div>
              </div>

              <div className="space-y-2">
                <div className="px-3 py-1.5 rounded-lg text-center bg-emerald-50 dark:bg-emerald-950/30">
                  <p className="text-[10px] font-black uppercase tracking-widest text-foreground/70">Offer Stage</p>
                </div>
                <div className="space-y-1.5">
                  <StageRow label="Released" count={stats.offerReleased} dot="bg-purple-500"  href="/candidates/history?stage=offer&status=released" />
                  <StageRow label="Accepted" count={stats.offerAccepted} dot="bg-emerald-500" href="/candidates/history?stage=offer&status=accepted" />
                  <StageRow label="Rejected" count={stats.offerRejected} dot="bg-rose-500"    href="/candidates/history?stage=offer&status=rejected" />
                </div>
              </div>

            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── ROW 4: Recent candidates + Requirements summary ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="w-full col-span-full">
  <SectionLabel>Upcoming Interviews (Next 6 Days)</SectionLabel>

  <Card className="shadow-sm border">
    <CardContent className="pt-5 px-4 pb-5">

      {upcoming.length > 0 ? (
        <Carousel opts={{ align: "start" }} className="w-full">

          <CarouselContent className="-ml-3 flex">
            {upcoming.map(item => (
              <CarouselItem
                key={item.id}
                className="pl-3 basis-full sm:basis-1/2 md:basis-1/3 lg:basis-1/4"
              >
                <Link href={`/candidates/${item.candidateId}`} className="block h-full">

                  <div className="h-full p-4 rounded-xl border bg-card hover:bg-muted/30 hover:border-primary/40 transition-all group cursor-pointer">

                    {/* Header */}
                    <div className="flex items-start justify-between mb-2.5">
                      <span className="text-xs font-bold text-primary bg-primary/8 px-2 py-0.5 rounded-md">
                        {item.roundLabel}
                      </span>

                      {item.isToday ? (
                        <Badge className="bg-emerald-500 text-[9px] h-4 px-1.5">
                          TODAY
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[9px] h-4 px-1.5">
                          Upcoming
                        </Badge>
                      )}
                    </div>

                    {/* Date + Time */}
                    <div className="space-y-1 mb-3">
                      <div className="text-[11px] text-muted-foreground">
                        {item.isToday
                          ? "Today"
                          : new Date(item.date).toLocaleDateString("en-IN", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })}
                      </div>

                      {item.timeSlot && (
                        <div className="text-[11px] text-muted-foreground">
                          {item.timeSlot}
                        </div>
                      )}
                    </div>

                    {/* Candidate */}
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
            <div className="flex justify-end gap-2 mb-3">
              <CarouselPrevious className="static translate-y-0" />
              <CarouselNext className="static translate-y-0" />
            </div>
          )}

        </Carousel>
      ) : (
        <div className="h-24 flex flex-col items-center justify-center border-2 border-dashed rounded-xl gap-1.5">
          <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider">
            No scheduled interviews in the next 6 days
          </p>
        </div>
      )}

    </CardContent>
  </Card>
</div>
      </div>

    </div>
  );
}