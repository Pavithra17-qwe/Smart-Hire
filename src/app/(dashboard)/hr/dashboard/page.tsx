"use client";

import { useEffect, useState, useMemo } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, Label,
} from "recharts";
import {
  Users, Briefcase, Calendar, Send, UserCheck,
  BrainCircuit, PlusCircle, Eye, Loader2,
  CheckCircle2, XCircle, Clock, Activity,
  ChevronRight, ArrowUpRight, BarChart3,
  FileText, CalendarDays,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── types ───────────────────────────────────────────────────────────────────
interface Candidate {
  id: string;
  candidateName?: string;
  candidateDesignation?: string;
  finalStatus?: string;
  resumeReviewStatus?: string;
  l1Status?: string; l1ScheduledDate?: string; l1TimeSlot?: string;
  l2Status?: string; l2ScheduledDate?: string; l2TimeSlot?: string;
  hrStatus?: string;  hrScheduledDate?: string; hrTimeSlot?: string;
  offerStatus?: string;
  aiScore?: number;
  createdDate?: any;
  createdAt?: any;
  createdBy?: string;
  jobRequisitionId?: string;
}

interface MonthlyTrend { month: string; monthNum: number; year: number; total: number; hired: number; }

// ─── chart config ────────────────────────────────────────────────────────────
const trendConfig = {
  total:  { label: "Added",  color: "hsl(var(--primary))" },
  hired:  { label: "Hired",  color: "#10B981" },
} satisfies ChartConfig;

const FUNNEL_COLORS = ["#6366F1", "#3B82F6", "#F59E0B", "#10B981", "#8B5CF6"];

function normalize(s: any): string {
  const v = (s || "").toLowerCase().trim();
  if (v === "accepted")   return "Accepted";
  if (v === "selected")   return "Selected";
  if (v === "rejected")   return "Rejected";
  if (v === "scheduled")  return "Scheduled";
  if (v === "pending")    return "Pending";
  if (v === "released")   return "Released";
  if (v === "completed")  return "Completed";
  if (v === "in progress")return "In Progress";
  return s || "Pending";
}

// ─── sub-components ──────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-3">
      {children}
    </p>
  );
}

function StatCard({
  title, value, icon: Icon, accent, href, description,
}: { title: string; value: number; icon: any; accent: string; href: string; description: string }) {
  return (
    <Link href={href} className="block group">
      <Card className="shadow-sm border hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer overflow-hidden">
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider leading-tight">
                {title}
              </p>
              <p className="text-3xl font-black mt-1.5 group-hover:text-primary transition-colors">
                {value}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
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

function StageCol({
  title, accent, items,
}: {
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
                <span className="text-[11px] font-semibold text-muted-foreground group-hover:text-foreground transition-colors">
                  {item.label}
                </span>
              </div>
              <span className="text-sm font-black group-hover:text-primary transition-colors">{item.count}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function UpcomingCard({
  name, role, stage, date, timeSlot, isToday, href,
}: { name: string; role: string; stage: string; date: string; timeSlot: string; isToday: boolean; href: string }) {
  return (
    <Link href={href} className="block group">
      <div className="p-4 rounded-xl border bg-card hover:bg-muted/30 hover:border-primary/40 transition-all">
        <div className="flex items-start justify-between mb-2.5">
          <span className="text-xs font-bold text-primary bg-primary/8 px-2 py-0.5 rounded-md">
            {stage}
          </span>
          {isToday
            ? <Badge className="bg-emerald-500 text-[9px] h-4 px-1.5">TODAY</Badge>
            : <Badge variant="outline" className="text-[9px] h-4 px-1.5">Upcoming</Badge>}
        </div>
        <div className="space-y-1 mb-3">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <CalendarDays className="h-3 w-3 text-primary shrink-0" />
            <span>
              {isToday ? "Today" : new Date(date + "T00:00:00").toLocaleDateString("en-IN", {
                day: "2-digit", month: "short", year: "numeric",
              })}
            </span>
          </div>
          {timeSlot && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3 text-primary shrink-0" />
              <span>{timeSlot}</span>
            </div>
          )}
        </div>
        <div className="pt-2.5 border-t">
          <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">{name}</p>
          <p className="text-[11px] text-muted-foreground truncate">{role}</p>
        </div>
      </div>
    </Link>
  );
}

// ─── main ─────────────────────────────────────────────────────────────────────

export default function HRDashboard() {
  const router = useRouter();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading]       = useState(true);
  const [isMounted, setIsMounted]   = useState(false);

  useEffect(() => { setIsMounted(true); }, []);

  useEffect(() => {
    const q = query(collection(db, "candidates"), orderBy("createdDate", "desc"));
    const unsub = onSnapshot(q, snap => {
      setCandidates(
        snap.docs.map(doc => {
          const r = doc.data();
          return {
            id: doc.id, ...r,
            resumeReviewStatus: normalize(r.resumeReviewStatus),
            l1Status:  normalize(r.l1Status),
            l2Status:  normalize(r.l2Status),
            hrStatus:  normalize(r.hrStatus),
            offerStatus: normalize(r.offerStatus),
            finalStatus: r.finalStatus || "In Progress",
            createdAt: r.createdAt?.toDate?.() || r.createdDate?.toDate?.() || new Date(),
          } as Candidate;
        })
      );
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // ── derived stats ──────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:        candidates.length,
    inProgress:   candidates.filter(c => {
      const f = (c.finalStatus ?? "").toLowerCase();
      return f !== "completed" && f !== "rejected";
    }).length,
    hired:        candidates.filter(c => c.finalStatus === "Completed").length,
    rejected:     candidates.filter(c => c.finalStatus === "Rejected").length,

    resumeAccepted: candidates.filter(c => c.resumeReviewStatus === "Accepted").length,
    resumeRejected: candidates.filter(c => c.resumeReviewStatus === "Rejected").length,
    resumePending:  candidates.filter(c => c.resumeReviewStatus === "Pending").length,

    l1Selected:  candidates.filter(c => c.l1Status === "Selected").length,
    l1Scheduled: candidates.filter(c => c.l1Status === "Scheduled").length,
    l1Rejected:  candidates.filter(c => c.l1Status === "Rejected").length,
    l1Pending:   candidates.filter(c => c.l1Status === "Pending").length,

    l2Selected:  candidates.filter(c => c.l2Status === "Selected").length,
    l2Scheduled: candidates.filter(c => c.l2Status === "Scheduled").length,
    l2Rejected:  candidates.filter(c => c.l2Status === "Rejected").length,
    l2Pending:   candidates.filter(c => c.l2Status === "Pending").length,

    hrSelected:  candidates.filter(c => c.hrStatus === "Selected").length,
    hrScheduled: candidates.filter(c => c.hrStatus === "Scheduled").length,
    hrRejected:  candidates.filter(c => c.hrStatus === "Rejected").length,
    hrPending:   candidates.filter(c => c.hrStatus === "Pending").length,

    offerPending:  candidates.filter(c => c.offerStatus === "Pending").length,
    offerReleased: candidates.filter(c => c.offerStatus === "Released").length,
    offerAccepted: candidates.filter(c => c.offerStatus === "Accepted").length,
    offerRejected: candidates.filter(c => c.offerStatus === "Rejected").length,
  }), [candidates]);

  // ── funnel data for donut ─────────────────────────────────────────────────
  const funnelData = useMemo(() => [
    { name: "Resume Accepted", value: stats.resumeAccepted, fill: "#6366F1" },
    { name: "L1 Selected",     value: stats.l1Selected,     fill: "#3B82F6" },
    { name: "L2 Selected",     value: stats.l2Selected,     fill: "#F59E0B" },
    { name: "HR Selected",     value: stats.hrSelected,     fill: "#10B981" },
    { name: "Offer Released",  value: stats.offerReleased,  fill: "#8B5CF6" },
  ].filter(d => d.value > 0), [stats]);

  const funnelTotal = funnelData.reduce((s, d) => s + d.value, 0);

  // ── 6-month trend ─────────────────────────────────────────────────────────
  const trendData = useMemo<MonthlyTrend[]>(() => {
    const months: MonthlyTrend[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      months.push({ month: d.toLocaleString("default", { month: "short" }), monthNum: d.getMonth(), year: d.getFullYear(), total: 0, hired: 0 });
    }
    candidates.forEach(c => {
      const cDate = c.createdAt instanceof Date ? c.createdAt : new Date();
      const idx = months.findIndex(m => m.monthNum === cDate.getMonth() && m.year === cDate.getFullYear());
      if (idx !== -1) { months[idx].total++; if (c.finalStatus === "Completed") months[idx].hired++; }
    });
    return months;
  }, [candidates]);

  // ── recent 5 candidates ───────────────────────────────────────────────────
  const recent = candidates.slice(0, 5);

  // ── upcoming interviews (next 3 days) ────────────────────────────────────
  const upcoming = useMemo(() => {
    const list: any[] = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split("T")[0];
    const max = new Date(today); max.setDate(today.getDate() + 3);
    const maxStr = max.toISOString().split("T")[0];
    candidates.forEach(c => {
      [
        { label: "L1 Interview", df: "l1ScheduledDate", sf: "l1TimeSlot", st: "l1Status" },
        { label: "L2 Interview", df: "l2ScheduledDate", sf: "l2TimeSlot", st: "l2Status" },
        { label: "HR Round",     df: "hrScheduledDate", sf: "hrTimeSlot", st: "hrStatus" },
      ].forEach(({ label, df, sf, st }) => {
        const ds = (c as any)[df];
        if ((c as any)[st] === "Scheduled" && ds && ds >= todayStr && ds <= maxStr) {
          list.push({ id: `${c.id}-${label}`, candidateId: c.id, name: c.candidateName || "Unknown", role: c.candidateDesignation || "N/A", stage: label, date: ds, timeSlot: (c as any)[sf] || "", isToday: ds === todayStr });
        }
      });
    });
    return list.sort((a, b) => a.date.localeCompare(b.date));
  }, [candidates]);

  // ── AI insights ───────────────────────────────────────────────────────────
  const aiInsights = useMemo(() => {
    const scored = candidates.filter(c => typeof c.aiScore === "number" && (c.aiScore ?? 0) > 0);
    const avg = scored.length ? Math.round(scored.reduce((s, c) => s + (c.aiScore ?? 0), 0) / scored.length) : 0;
    const top = [...scored].sort((a, b) => (b.aiScore ?? 0) - (a.aiScore ?? 0)).slice(0, 3);
    return { avg, top };
  }, [candidates]);

  // ── loading ───────────────────────────────────────────────────────────────
  if (!isMounted || loading) {
    return (
      <div className="h-screen flex items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading HR Dashboard…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10 w-full overflow-x-hidden">

    
      {/* ── ROW 1: Summary stats ── */}
      <div>
        <SectionLabel>Candidate Overview</SectionLabel>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard title="Total Candidates" value={stats.total}       icon={Users}        accent="bg-slate-500"   href="/candidates/history"                    description="All candidates" />
          <StatCard title="Active Pipeline"  value={stats.inProgress}  icon={Activity}     accent="bg-blue-500"   href="/candidates/history?active=true"         description="In review or interview" />
          <StatCard title="Offers Released"  value={stats.offerReleased} icon={Send}        accent="bg-violet-500"  href="/candidates/history?stage=offer&status=released" description="Awaiting response" />
          <StatCard title="Hired"            value={stats.hired}        icon={UserCheck}    accent="bg-emerald-500" href="/candidates/history?stage=final&status=completed" description="Offer accepted" />
        </div>
      </div>

      {/* ── ROW 2: Donut + Trend chart ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Hiring funnel donut (2/5) */}
        <Card className="lg:col-span-2 shadow-sm border">
          <CardHeader className="pb-2 pt-5 px-5">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
                <Briefcase className="h-4 w-4 text-primary" />
              </div>
              <CardTitle className="text-base font-semibold">Hiring Funnel</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            {funnelTotal > 0 ? (
              <>
                <div className="flex items-center justify-center">
                  <ChartContainer config={{} as ChartConfig} className="aspect-square max-h-[190px] w-full">
                    <PieChart>
                      <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                      <Pie data={funnelData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={78} strokeWidth={3} stroke="hsl(var(--background))" paddingAngle={3}>
                        {funnelData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                        <Label content={({ viewBox }) => {
                          if (viewBox && "cx" in viewBox && "cy" in viewBox) return (
                            <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                              <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-2xl font-black">{funnelTotal}</tspan>
                              <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 18} className="fill-muted-foreground text-[9px] font-bold uppercase tracking-widest">pipeline</tspan>
                            </text>
                          );
                        }} />
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                </div>
                <div className="mt-2 space-y-1.5">
                  {funnelData.map(d => (
                    <div key={d.name} className="flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-muted/50 transition-colors">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full" style={{ backgroundColor: d.fill }} />
                        <span className="text-xs font-medium text-muted-foreground">{d.name}</span>
                      </div>
                      <span className="text-sm font-bold">{d.value}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">No data yet</div>
            )}
          </CardContent>
        </Card>

        {/* Trend bar chart (3/5) */}
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
                <Bar dataKey="total" name="Added" fill="var(--color-total)" radius={[3, 3, 0, 0]} barSize={14} />
                <Bar dataKey="hired" name="Hired" fill="var(--color-hired)" radius={[3, 3, 0, 0]} barSize={14} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

      </div>

      {/* ── ROW 3: Stage breakdown ── */}
      <div>
        <SectionLabel>Interview Stage Breakdown</SectionLabel>
        <Card className="shadow-sm border">
          <CardContent className="p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <StageCol title="Resume Review" accent="bg-slate-100 dark:bg-slate-800" items={[
                { label: "Accepted", count: stats.resumeAccepted, dot: "bg-emerald-500", href: "/candidates/history?stage=resume&status=accepted" },
                { label: "Rejected", count: stats.resumeRejected, dot: "bg-rose-500",    href: "/candidates/history?stage=resume&status=rejected" },
                { label: "Pending",  count: stats.resumePending,  dot: "bg-slate-400",   href: "/candidates/history?stage=resume&status=pending" },
              ]} />
              <StageCol title="L1 Interview" accent="bg-indigo-50 dark:bg-indigo-950/30" items={[
                { label: "Selected",  count: stats.l1Selected,  dot: "bg-indigo-500", href: "/candidates/history?stage=l1&status=selected" },
                { label: "Scheduled", count: stats.l1Scheduled, dot: "bg-blue-400",   href: "/candidates/history?stage=l1&status=scheduled" },
                { label: "Rejected",  count: stats.l1Rejected,  dot: "bg-rose-400",   href: "/candidates/history?stage=l1&status=rejected" },
                { label: "Pending",   count: stats.l1Pending,   dot: "bg-slate-300",  href: "/candidates/history?stage=l1&status=pending" },
              ]} />
              <StageCol title="L2 Interview" accent="bg-blue-50 dark:bg-blue-950/30" items={[
                { label: "Selected",  count: stats.l2Selected,  dot: "bg-blue-500",   href: "/candidates/history?stage=l2&status=selected" },
                { label: "Scheduled", count: stats.l2Scheduled, dot: "bg-sky-400",    href: "/candidates/history?stage=l2&status=scheduled" },
                { label: "Rejected",  count: stats.l2Rejected,  dot: "bg-rose-600",   href: "/candidates/history?stage=l2&status=rejected" },
                { label: "Pending",   count: stats.l2Pending,   dot: "bg-slate-300",  href: "/candidates/history?stage=l2&status=pending" },
              ]} />
              <StageCol title="HR Round" accent="bg-amber-50 dark:bg-amber-950/30" items={[
                { label: "Selected",  count: stats.hrSelected,  dot: "bg-amber-500", href: "/candidates/history?stage=hr&status=selected" },
                { label: "Scheduled", count: stats.hrScheduled, dot: "bg-amber-300", href: "/candidates/history?stage=hr&status=scheduled" },
                { label: "Rejected",  count: stats.hrRejected,  dot: "bg-rose-700",  href: "/candidates/history?stage=hr&status=rejected" },
                { label: "Pending",   count: stats.hrPending,   dot: "bg-slate-300", href: "/candidates/history?stage=hr&status=pending" },
              ]} />
              <StageCol title="Offer Stage" accent="bg-emerald-50 dark:bg-emerald-950/30" items={[
                { label: "Released", count: stats.offerReleased, dot: "bg-purple-500",  href: "/candidates/history?stage=offer&status=released" },
                { label: "Accepted", count: stats.offerAccepted, dot: "bg-emerald-500", href: "/candidates/history?stage=offer&status=accepted" },
                { label: "Rejected", count: stats.offerRejected, dot: "bg-rose-500",    href: "/candidates/history?stage=offer&status=rejected" },
                { label: "Pending",  count: stats.offerPending,  dot: "bg-slate-300",   href: "/candidates/history?stage=offer&status=pending" },
              ]} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── ROW 4: Recent candidates + AI Insights ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Recent candidates table (2/3) */}
        <Card className="lg:col-span-2 shadow-sm border">
          <CardHeader className="pb-3 pt-5 px-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Users className="h-4 w-4 text-primary" />
                </div>
                <CardTitle className="text-base font-semibold">Recent Candidates</CardTitle>
              </div>
              <Button asChild variant="ghost" size="sm" className="text-xs">
                <Link href="/candidates/list" className="flex items-center gap-1">
                  View all <ArrowUpRight className="h-3 w-3" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            {recent.length === 0 ? (
              <div className="h-20 flex items-center justify-center text-sm text-muted-foreground">
                No candidates yet.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {recent.map(c => (
                  <div key={c.id} className="flex items-center justify-between py-3 group">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{c.candidateName}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{c.candidateDesignation}</p>
                    </div>
                    <div className="flex items-center gap-3 ml-3 shrink-0">
                      <Badge
                        variant={c.finalStatus === "Rejected" ? "destructive" : c.finalStatus === "Completed" ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {c.finalStatus || "In Progress"}
                      </Badge>
                      <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                        <Link href={`/candidates/${c.id}`}>View</Link>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* AI Insights (1/3) */}
        <Card className="shadow-sm border">
          <CardHeader className="pb-3 pt-5 px-5">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
                <BrainCircuit className="h-4 w-4 text-primary" />
              </div>
              <CardTitle className="text-base font-semibold">AI Evaluation</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5 space-y-4">
            <div className="text-center p-4 bg-muted rounded-xl">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">Avg. AI Match Score</p>
              <p className="text-4xl font-black text-primary mt-1">{aiInsights.avg}%</p>
            </div>
            <div>
              <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Top Matches</p>
              <div className="space-y-2">
                {aiInsights.top.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">No AI-scored candidates yet.</p>
                ) : aiInsights.top.map(c => (
                  <Link href={`/candidates/${c.id}`} key={c.id}
                    className="flex items-center justify-between p-2.5 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-950/40 transition-colors group"
                  >
                    <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300 truncate">{c.candidateName}</p>
                    <Badge className="bg-emerald-200 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-200 shrink-0 ml-2">
                      {c.aiScore}%
                    </Badge>
                  </Link>
                ))}
              </div>
            </div>
            <Button asChild variant="outline" size="sm" className="w-full text-xs">
              <Link href="/candidates/evaluation" className="flex items-center justify-center gap-1.5">
                <FileText className="h-3.5 w-3.5" /> Run Evaluation
              </Link>
            </Button>
          </CardContent>
        </Card>

      </div>

      {/* ── ROW 5: Upcoming interviews ── */}
      <div>
        <SectionLabel>Upcoming Interviews</SectionLabel>
        <Card className="shadow-sm border">
          <CardContent className="p-5">
            {upcoming.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {upcoming.slice(0, 8).map(item => (
                  <UpcomingCard
                    key={item.id}
                    name={item.name}
                    role={item.role}
                    stage={item.stage}
                    date={item.date}
                    timeSlot={item.timeSlot}
                    isToday={item.isToday}
                    href={`/candidates/${item.candidateId}`}
                  />
                ))}
              </div>
            ) : (
              <div className="h-24 flex flex-col items-center justify-center border-2 border-dashed rounded-xl gap-1.5">
                <CalendarDays className="h-5 w-5 text-muted-foreground/30" />
                <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider">
                  No interviews scheduled in the next 3 days
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  );
}