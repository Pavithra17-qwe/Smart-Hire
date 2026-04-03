"use client";

import { useEffect, useState, useMemo } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth"; // adjust to your auth hook
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  Calendar, Clock, CheckCircle2, XCircle,
  ClipboardList, Users, Activity, Loader2,
  CalendarDays, ArrowUpRight, ChevronRight,
  Star, AlertCircle, BarChart3, UserCheck,
  MessageSquare, Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── types ────────────────────────────────────────────────────────────────────
interface Candidate {
  id: string;
  candidateName?: string;
  candidateDesignation?: string;
  finalStatus?: string;
  resumeReviewStatus?: string;
  l1Status?: string; l1ScheduledDate?: string; l1TimeSlot?: string;
  l1InterviewerUid?: string; l1Feedback?: string; l1Result?: string;
  l2Status?: string; l2ScheduledDate?: string; l2TimeSlot?: string;
  l2InterviewerUid?: string; l2Feedback?: string; l2Result?: string;
  aiScore?: number;
  createdAt?: any;
}

interface MonthlyData { month: string; monthNum: number; year: number; conducted: number; selected: number; }

// ─── chart config ─────────────────────────────────────────────────────────────
const trendConfig = {
  conducted: { label: "Conducted", color: "hsl(var(--primary))" },
  selected:  { label: "Selected",  color: "#10B981" },
} satisfies ChartConfig;

function normalize(s: any): string {
  const v = (s || "").toLowerCase().trim();
  if (v === "selected")   return "Selected";
  if (v === "rejected")   return "Rejected";
  if (v === "scheduled")  return "Scheduled";
  if (v === "pending")    return "Pending";
  if (v === "completed")  return "Completed";
  if (v === "accepted")   return "Accepted";
  return s || "Pending";
}

// ─── sub-components ───────────────────────────────────────────────────────────

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
            <span>{highlight ? "Action required" : "View candidates"}</span>
            <ChevronRight className="h-3 w-3" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function InterviewCard({ candidate, round, date, timeSlot, isToday, isPast, candidateId }: {
  candidate: string; round: string; date: string; timeSlot: string;
  isToday: boolean; isPast: boolean; candidateId: string;
}) {
  return (
    <Link href={`/candidates/${candidateId}`} className="block group">
      <div className={cn(
        "p-4 rounded-xl border bg-card hover:bg-muted/30 hover:border-primary/40 transition-all",
        isToday && "border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-950/10",
        isPast  && "border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/10"
      )}>
        <div className="flex items-start justify-between mb-2.5">
          <span className={cn(
            "text-xs font-bold px-2 py-0.5 rounded-md",
            round === "L1 Interview"
              ? "text-indigo-700 bg-indigo-100 dark:text-indigo-300 dark:bg-indigo-950/50"
              : "text-blue-700 bg-blue-100 dark:text-blue-300 dark:bg-blue-950/50"
          )}>
            {round}
          </span>
          {isToday && <Badge className="bg-emerald-500 text-[9px] h-4 px-1.5">TODAY</Badge>}
          {isPast  && <Badge className="bg-amber-500 text-[9px] h-4 px-1.5">PENDING</Badge>}
          {!isToday && !isPast && <Badge variant="outline" className="text-[9px] h-4 px-1.5">Upcoming</Badge>}
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
          <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">{candidate}</p>
        </div>
      </div>
    </Link>
  );
}

function FeedbackRow({ name, designation, round, score, href }: {
  name: string; designation: string; round: string; score?: number; href: string;
}) {
  return (
    <Link href={href} className="flex items-center justify-between py-3 group border-b last:border-0 border-border">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold truncate">{name}</p>
        <p className="text-[11px] text-muted-foreground truncate">{designation}</p>
      </div>
      <div className="flex items-center gap-3 ml-3 shrink-0">
        <Badge variant="outline" className={cn(
          "text-[10px]",
          round === "L1"
            ? "border-indigo-300 text-indigo-700 dark:text-indigo-300"
            : "border-blue-300 text-blue-700 dark:text-blue-300"
        )}>
          {round}
        </Badge>
        {score !== undefined && (
          <div className="flex items-center gap-1">
            <Star className="h-3 w-3 text-amber-400 fill-amber-400" />
            <span className="text-xs font-bold">{score}%</span>
          </div>
        )}
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
          <MessageSquare className="h-3 w-3" /> Feedback
        </Button>
      </div>
    </Link>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export default function PanelDashboard() {
  // Replace useAuth() with however you get the current user uid
  const { user } = useAuth();
  const panelUid = user?.uid ?? "";
  const panelName = user?.displayName ?? "Interviewer";

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading]       = useState(true);
  const [isMounted, setIsMounted]   = useState(false);

  useEffect(() => { setIsMounted(true); }, []);

  useEffect(() => {
    if (!panelUid) return;

    // Fetch ALL candidates, then filter client-side for ones assigned to this panel member
    // (If you store l1InterviewerUid / l2InterviewerUid, you can use a Firestore where clause instead)
    const unsub = onSnapshot(collection(db, "candidates"), snap => {
      const all = snap.docs.map(doc => {
        const r = doc.data();
        return {
          id: doc.id, ...r,
          resumeReviewStatus: normalize(r.resumeReviewStatus),
          l1Status: normalize(r.l1Status),
          l2Status: normalize(r.l2Status),
          createdAt: r.createdAt?.toDate?.() || new Date(),
        } as Candidate;
      });

      // Keep only candidates assigned to this panel user (L1 or L2)
      // Adjust field names to match your Firestore schema
      const mine = all.filter(c =>
        c.l1InterviewerUid === panelUid ||
        c.l2InterviewerUid === panelUid
      );

      // If you don't store interviewer UID per candidate yet, show ALL scheduled/selected:
      // const mine = all.filter(c => ["Scheduled","Selected"].includes(c.l1Status ?? "") || ["Scheduled","Selected"].includes(c.l2Status ?? ""));

      setCandidates(mine);
      setLoading(false);
    });
    return () => unsub();
  }, [panelUid]);

  // ── derived ───────────────────────────────────────────────────────────────
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split("T")[0];

  const stats = useMemo(() => {
    const l1Scheduled  = candidates.filter(c => c.l1Status === "Scheduled").length;
    const l2Scheduled  = candidates.filter(c => c.l2Status === "Scheduled").length;
    const l1Selected   = candidates.filter(c => c.l1Status === "Selected").length;
    const l2Selected   = candidates.filter(c => c.l2Status === "Selected").length;
    const l1Rejected   = candidates.filter(c => c.l1Status === "Rejected").length;
    const l2Rejected   = candidates.filter(c => c.l2Status === "Rejected").length;

    // Candidates scheduled today
    const todayCount = candidates.filter(c =>
      (c.l1Status === "Scheduled" && c.l1ScheduledDate === todayStr) ||
      (c.l2Status === "Scheduled" && c.l2ScheduledDate === todayStr)
    ).length;

    // Pending feedback = Scheduled with no result/feedback yet (past today)
    const pendingFeedback = candidates.filter(c => {
      const l1Past = c.l1Status === "Scheduled" && c.l1ScheduledDate && c.l1ScheduledDate < todayStr && !c.l1Result;
      const l2Past = c.l2Status === "Scheduled" && c.l2ScheduledDate && c.l2ScheduledDate < todayStr && !c.l2Result;
      return l1Past || l2Past;
    }).length;

    return {
      totalAssigned: candidates.length,
      todayCount,
      pendingFeedback,
      totalScheduled: l1Scheduled + l2Scheduled,
      totalSelected:  l1Selected  + l2Selected,
      totalRejected:  l1Rejected  + l2Rejected,
      l1Scheduled, l2Scheduled,
      l1Selected, l2Selected,
      l1Rejected, l2Rejected,
    };
  }, [candidates, todayStr]);

  // ── upcoming interviews (next 7 days incl. today + past pending) ───────────
  const { todayInterviews, upcomingInterviews, pendingFeedbackList } = useMemo(() => {
    const maxDate = new Date(today); maxDate.setDate(today.getDate() + 7);
    const maxStr  = maxDate.toISOString().split("T")[0];

    const todayList: any[]    = [];
    const upcomingList: any[] = [];
    const pendingList: any[]  = [];

    candidates.forEach(c => {
      [
        { label: "L1 Interview", df: "l1ScheduledDate", sf: "l1TimeSlot", st: "l1Status", rf: "l1Result" },
        { label: "L2 Interview", df: "l2ScheduledDate", sf: "l2TimeSlot", st: "l2Status", rf: "l2Result" },
      ].forEach(({ label, df, sf, st, rf }) => {
        const ds  = (c as any)[df];
        const status = (c as any)[st];
        const result = (c as any)[rf];

        if (status !== "Scheduled" || !ds) return;

        const item = {
          id: `${c.id}-${label}`,
          candidateId: c.id,
          candidate: c.candidateName || "Unknown",
          round: label,
          date: ds,
          timeSlot: (c as any)[sf] || "",
          isToday: ds === todayStr,
          isPast: ds < todayStr,
          hasResult: !!result,
        };

        if (ds === todayStr)      todayList.push(item);
        else if (ds < todayStr && !result) pendingList.push(item);
        else if (ds > todayStr && ds <= maxStr) upcomingList.push(item);
      });
    });

    return {
      todayInterviews: todayList,
      upcomingInterviews: upcomingList.sort((a, b) => a.date.localeCompare(b.date)),
      pendingFeedbackList: pendingList.sort((a, b) => b.date.localeCompare(a.date)),
    };
  }, [candidates, todayStr, today]);

  // ── 6-month trend of interviews conducted ─────────────────────────────────
  const trendData = useMemo<MonthlyData[]>(() => {
    const months: MonthlyData[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      months.push({ month: d.toLocaleString("default", { month: "short" }), monthNum: d.getMonth(), year: d.getFullYear(), conducted: 0, selected: 0 });
    }
    candidates.forEach(c => {
      const cDate = c.createdAt instanceof Date ? c.createdAt : new Date();
      const idx = months.findIndex(m => m.monthNum === cDate.getMonth() && m.year === cDate.getFullYear());
      if (idx !== -1) {
        if (c.l1InterviewerUid === panelUid && ["Selected","Rejected"].includes(c.l1Status ?? "")) {
          months[idx].conducted++;
          if (c.l1Status === "Selected") months[idx].selected++;
        }
        if (c.l2InterviewerUid === panelUid && ["Selected","Rejected"].includes(c.l2Status ?? "")) {
          months[idx].conducted++;
          if (c.l2Status === "Selected") months[idx].selected++;
        }
      }
    });
    return months;
  }, [candidates, panelUid]);

  // ── candidates needing feedback (selected but no feedback submitted) ────────
  const needsFeedback = useMemo(() =>
    candidates.filter(c => {
      const l1Done = c.l1InterviewerUid === panelUid && (c.l1Status === "Selected" || c.l1Status === "Rejected") && !c.l1Feedback;
      const l2Done = c.l2InterviewerUid === panelUid && (c.l2Status === "Selected" || c.l2Status === "Rejected") && !c.l2Feedback;
      return l1Done || l2Done;
    }).slice(0, 5)
  , [candidates, panelUid]);

  // ── loading ───────────────────────────────────────────────────────────────
  if (!isMounted || loading) {
    return (
      <div className="h-screen flex items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading Panel Dashboard…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10 w-full overflow-x-hidden">

      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-headline font-bold leading-tight tracking-tight">
            Panel Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Welcome back, <span className="font-semibold text-foreground">{panelName}</span> — your assigned interviews and feedback tasks.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button asChild variant="outline" size="sm">
            <Link href="/candidates/list" className="flex items-center gap-1.5">
              <Eye className="h-4 w-4" /> Candidate List
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/candidates/history" className="flex items-center gap-1.5">
              <ClipboardList className="h-4 w-4" /> History
            </Link>
          </Button>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-3 py-1.5 rounded-full">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse block" />
            Live data
          </div>
        </div>
      </div>

      {/* ── Today's alert banner (if interviews today) ── */}
      {todayInterviews.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/20">
          <div className="h-8 w-8 rounded-lg bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center shrink-0">
            <Calendar className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
              You have {todayInterviews.length} interview{todayInterviews.length > 1 ? "s" : ""} today
            </p>
            <p className="text-[11px] text-emerald-600 dark:text-emerald-500">
              {todayInterviews.map(i => `${i.candidate} (${i.round})`).join(" · ")}
            </p>
          </div>
          <Badge className="bg-emerald-500 shrink-0">{todayInterviews.length} today</Badge>
        </div>
      )}

      {/* ── Pending feedback alert ── */}
      {stats.pendingFeedback > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20">
          <div className="h-8 w-8 rounded-lg bg-amber-100 dark:bg-amber-900 flex items-center justify-center shrink-0">
            <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              {stats.pendingFeedback} interview{stats.pendingFeedback > 1 ? "s" : ""} pending feedback
            </p>
            <p className="text-[11px] text-amber-600 dark:text-amber-500">
              Please submit your feedback so HR can proceed
            </p>
          </div>
        </div>
      )}

      {/* ── ROW 1: Summary stats ── */}
      <div>
        <SectionLabel>My Interview Overview</SectionLabel>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Assigned to Me"  value={stats.totalAssigned}
            icon={Users}            accent="bg-slate-500"
            href="/candidates/history"
            description="Total candidates assigned"
          />
          <StatCard
            title="Today's Interviews" value={stats.todayCount}
            icon={Calendar}             accent="bg-emerald-500"
            href="/candidates/history?status=scheduled"
            description="Scheduled for today"
          />
          <StatCard
            title="Pending Feedback" value={stats.pendingFeedback}
            icon={AlertCircle}         accent="bg-amber-500"
            href="/candidates/history?pending=feedback"
            description="Feedback not submitted"
            highlight={stats.pendingFeedback > 0}
          />
          <StatCard
            title="Selected by Me"  value={stats.totalSelected}
            icon={UserCheck}          accent="bg-indigo-500"
            href="/candidates/history?result=selected"
            description="L1 + L2 combined"
          />
        </div>
      </div>

      {/* ── ROW 2: L1 vs L2 breakdown + trend chart ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Round breakdown (2/5) */}
        <Card className="lg:col-span-2 shadow-sm border">
          <CardHeader className="pb-2 pt-5 px-5">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
                <ClipboardList className="h-4 w-4 text-primary" />
              </div>
              <CardTitle className="text-base font-semibold">Round Breakdown</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5 space-y-4">

            {/* L1 */}
            <div className="space-y-2">
              <div className="px-3 py-1.5 rounded-lg text-center bg-indigo-50 dark:bg-indigo-950/30">
                <p className="text-[10px] font-black uppercase tracking-widest text-foreground/70">L1 Interview</p>
              </div>
              <div className="space-y-1.5">
                {[
                  { label: "Scheduled", count: stats.l1Scheduled, dot: "bg-blue-400",   href: "/candidates/history?round=l1&status=scheduled" },
                  { label: "Selected",  count: stats.l1Selected,  dot: "bg-emerald-500", href: "/candidates/history?round=l1&status=selected" },
                  { label: "Rejected",  count: stats.l1Rejected,  dot: "bg-rose-500",   href: "/candidates/history?round=l1&status=rejected" },
                ].map(item => (
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

            {/* L2 */}
            <div className="space-y-2">
              <div className="px-3 py-1.5 rounded-lg text-center bg-blue-50 dark:bg-blue-950/30">
                <p className="text-[10px] font-black uppercase tracking-widest text-foreground/70">L2 Interview</p>
              </div>
              <div className="space-y-1.5">
                {[
                  { label: "Scheduled", count: stats.l2Scheduled, dot: "bg-sky-400",    href: "/candidates/history?round=l2&status=scheduled" },
                  { label: "Selected",  count: stats.l2Selected,  dot: "bg-emerald-500", href: "/candidates/history?round=l2&status=selected" },
                  { label: "Rejected",  count: stats.l2Rejected,  dot: "bg-rose-500",   href: "/candidates/history?round=l2&status=rejected" },
                ].map(item => (
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

            {/* Pass rate */}
            {(stats.totalSelected + stats.totalRejected) > 0 && (
              <div className="px-3 py-3 rounded-xl bg-muted text-center">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">My Pass Rate</p>
                <p className="text-2xl font-black text-primary mt-1">
                  {Math.round((stats.totalSelected / (stats.totalSelected + stats.totalRejected)) * 100)}%
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {stats.totalSelected} selected / {stats.totalSelected + stats.totalRejected} interviewed
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Interview trend (3/5) */}
        <Card className="lg:col-span-3 shadow-sm border">
          <CardHeader className="pb-2 pt-5 px-5">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
                <BarChart3 className="h-4 w-4 text-primary" />
              </div>
              <CardTitle className="text-base font-semibold">My Interview Activity</CardTitle>
              <span className="ml-auto text-xs text-muted-foreground">Last 6 months</span>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <ChartContainer config={trendConfig} className="h-[280px] w-full">
              <BarChart data={trendData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11 }} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="conducted" name="Conducted" fill="var(--color-conducted)" radius={[3, 3, 0, 0]} barSize={14} />
                <Bar dataKey="selected"  name="Selected"  fill="var(--color-selected)"  radius={[3, 3, 0, 0]} barSize={14} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

      </div>

      {/* ── ROW 3: Today's interviews + Upcoming ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Today */}
        <div>
          <SectionLabel>Today's Interviews</SectionLabel>
          <Card className="shadow-sm border">
            <CardContent className="p-5">
              {todayInterviews.length > 0 ? (
                <div className="grid grid-cols-1 gap-3">
                  {todayInterviews.map(item => (
                    <InterviewCard key={item.id} {...item} />
                  ))}
                </div>
              ) : (
                <div className="h-24 flex flex-col items-center justify-center border-2 border-dashed rounded-xl gap-1.5">
                  <CalendarDays className="h-5 w-5 text-muted-foreground/30" />
                  <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider">
                    No interviews scheduled today
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Upcoming next 7 days */}
        <div>
          <SectionLabel>Upcoming (Next 7 Days)</SectionLabel>
          <Card className="shadow-sm border">
            <CardContent className="p-5">
              {upcomingInterviews.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {upcomingInterviews.slice(0, 4).map(item => (
                    <InterviewCard key={item.id} {...item} />
                  ))}
                </div>
              ) : (
                <div className="h-24 flex flex-col items-center justify-center border-2 border-dashed rounded-xl gap-1.5">
                  <CalendarDays className="h-5 w-5 text-muted-foreground/30" />
                  <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider">
                    No upcoming interviews
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

      </div>

      {/* ── ROW 4: Pending feedback + Recent results ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Pending feedback list */}
        <div>
          <SectionLabel>Pending Feedback</SectionLabel>
          <Card className="shadow-sm border">
            <CardContent className="p-5">
              {pendingFeedbackList.length > 0 ? (
                <div className="divide-y divide-border">
                  {pendingFeedbackList.slice(0, 5).map(item => (
                    <FeedbackRow
                      key={item.id}
                      name={item.candidate}
                      designation={item.round}
                      round={item.round.includes("L1") ? "L1" : "L2"}
                      href={`/candidates/${item.candidateId}`}
                    />
                  ))}
                </div>
              ) : (
                <div className="h-20 flex flex-col items-center justify-center gap-1.5">
                  <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                  <p className="text-xs text-muted-foreground">All feedback submitted — you're up to date!</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent results */}
        <div>
          <SectionLabel>Recent Decisions</SectionLabel>
          <Card className="shadow-sm border">
            <CardContent className="p-5">
              {needsFeedback.length === 0 && candidates.filter(c =>
                (c.l1Status === "Selected" || c.l1Status === "Rejected") ||
                (c.l2Status === "Selected" || c.l2Status === "Rejected")
              ).length === 0 ? (
                <div className="h-20 flex items-center justify-center text-sm text-muted-foreground">
                  No decisions made yet.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {candidates
                    .filter(c =>
                      (c.l1InterviewerUid === panelUid && (c.l1Status === "Selected" || c.l1Status === "Rejected")) ||
                      (c.l2InterviewerUid === panelUid && (c.l2Status === "Selected" || c.l2Status === "Rejected"))
                    )
                    .slice(0, 5)
                    .map(c => {
                      const isL1Done = c.l1InterviewerUid === panelUid && (c.l1Status === "Selected" || c.l1Status === "Rejected");
                      const round  = isL1Done ? "L1" : "L2";
                      const status = isL1Done ? c.l1Status : c.l2Status;
                      return (
                        <Link key={c.id} href={`/candidates/${c.id}`} className="flex items-center justify-between py-3 group border-b last:border-0 border-border">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold truncate">{c.candidateName || "Unknown"}</p>
                            <p className="text-[11px] text-muted-foreground truncate">{c.candidateDesignation}</p>
                          </div>
                          <div className="flex items-center gap-2 ml-3 shrink-0">
                            <Badge variant="outline" className={cn("text-[10px]",
                              round === "L1"
                                ? "border-indigo-300 text-indigo-700 dark:text-indigo-300"
                                : "border-blue-300 text-blue-700 dark:text-blue-300"
                            )}>{round}</Badge>
                            <Badge variant={status === "Selected" ? "default" : "destructive"} className="text-[10px]">
                              {status}
                            </Badge>
                          </div>
                        </Link>
                      );
                    })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

      </div>

    </div>
  );
}