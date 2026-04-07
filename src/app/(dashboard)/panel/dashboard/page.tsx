"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSearchParams } from "next/navigation";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  Calendar, Clock, CheckCircle2, ClipboardList, Users,
  Loader2, CalendarDays, ChevronRight, AlertCircle,
  BarChart3, UserCheck, MessageSquare, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── types ────────────────────────────────────────────────────────────────────
interface Candidate {
  id: string;
  candidateName?: string;
  candidateDesignation?: string;
  finalStatus?: string;
  l1Status?: string; l1ScheduledDate?: string; l1TimeSlot?: string;
  l1InterviewerUid?: string; l1Feedback?: string; l1Result?: string;
  l2Status?: string; l2ScheduledDate?: string; l2TimeSlot?: string;
  l2InterviewerUid?: string; l2Feedback?: string; l2Result?: string;
  createdAt?: any;
}

interface MonthlyData {
  month: string; monthNum: number; year: number;
  conducted: number; selected: number;
}

const trendConfig = {
  conducted: { label: "Conducted", color: "hsl(var(--primary))" },
  selected:  { label: "Selected",  color: "#10B981" },
} satisfies ChartConfig;

function normalize(s: any): string {
  const v = (s || "").toLowerCase().trim();
  if (v === "selected")  return "Selected";
  if (v === "rejected")  return "Rejected";
  if (v === "scheduled") return "Scheduled";
  if (v === "pending")   return "Pending";
  if (v === "completed") return "Completed";
  return s || "Pending";
}

// ─── URL builder for candidate history with filters ───────────────────────────
// Navigates to the candidate history page pre-filtered so only matching
// candidates appear. All params are explicit so the history page can read them.
const HISTORY_BASE = "/candidates/history";

function buildHistoryUrl(params: Record<string, string>) {
  const p = new URLSearchParams(params);
  return `${HISTORY_BASE}?${p.toString()}`;
}

// ─── sub-components ───────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-3">
      {children}
    </p>
  );
}

function StatCard({
  title, value, icon: Icon, accent, href, description, highlight,
}: {
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

function InterviewCard({
  candidate, round, date, timeSlot, isToday, isPast, candidateId,
}: {
  candidate: string; round: string; date: string; timeSlot: string;
  isToday: boolean; isPast: boolean; candidateId: string;
}) {
  return (
    <Link href={`/panel/candidates/history/${candidateId}`} className="block group">
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
          <p className="text-[10px] text-muted-foreground mt-0.5">Click to manage interview →</p>
        </div>
      </div>
    </Link>
  );
}

// ─── main component ───────────────────────────────────────────────────────────
export default function PanelDashboard() {
  const { user } = useAuth();
  const panelUid  = user?.uid ?? "";
  const router    = useRouter();

  const searchParams = useSearchParams();
const candidateId = searchParams.get("candidateId");

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const filteredCandidates = candidates.filter(c => {
    if (candidateId) return c.id === candidateId;
    return true;
  });
  const [loading,    setLoading]    = useState(true);
  const [isMounted,  setIsMounted]  = useState(false);

  // ── FILTERS (mirrors admin dashboard pattern) ─────────────────────────────
  const [filterStage,  setFilterStage]  = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  useEffect(() => { setIsMounted(true); }, []);

  useEffect(() => {
    if (!panelUid) return;
    const unsub = onSnapshot(collection(db, "candidates"), snap => {
      const all = snap.docs.map(doc => {
        const r = doc.data();
        return {
          id: doc.id, ...r,
          l1Status: normalize(r.l1Status),
          l2Status: normalize(r.l2Status),
          createdAt: r.createdAt?.toDate?.() || new Date(),
        } as Candidate;
      });
      // Only keep candidates assigned to this panel member
      setCandidates(all.filter(c =>
        c.l1InterviewerUid === panelUid || c.l2InterviewerUid === panelUid
      ));
      setLoading(false);
    });
    return () => unsub();
  }, [panelUid]);

  const today    = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split("T")[0];

  // ── Apply stage/status filter to assigned candidates ──────────────────────
  // This mirrors what admin does: filter the local list and update counts live.
  const filtered = useMemo(() => {
    if (filterStage === "all" && filterStatus === "all") return candidates;

    const stageFieldMap: Record<string, "l1Status" | "l2Status"> = {
      l1: "l1Status",
      l2: "l2Status",
    };

    return candidates.filter(c => {
      if (filterStage !== "all" && filterStatus !== "all") {
        const field = stageFieldMap[filterStage];
        if (!field) return false;
        return c[field] === filterStatus;
      }
      // Stage only — include candidates participating in that stage
      if (filterStage !== "all") {
        const field = stageFieldMap[filterStage];
        return field ? c[field] !== undefined : false;
      }
      // Status only — match either round's status
      if (filterStatus !== "all") {
        return c.l1Status === filterStatus || c.l2Status === filterStatus;
      }
      return true;
    });
  }, [candidates, filterStage, filterStatus]);

  const hasFilters = filterStage !== "all" || filterStatus !== "all";

  // ── Stats (computed from filtered set) ────────────────────────────────────
  const stats = useMemo(() => {
    const l1Scheduled = filtered.filter(c => c.l1Status === "Scheduled").length;
    const l2Scheduled = filtered.filter(c => c.l2Status === "Scheduled").length;
    const l1Selected  = filtered.filter(c => c.l1Status === "Selected").length;
    const l2Selected  = filtered.filter(c => c.l2Status === "Selected").length;
    const l1Rejected  = filtered.filter(c => c.l1Status === "Rejected").length;
    const l2Rejected  = filtered.filter(c => c.l2Status === "Rejected").length;

    const todayCount = filtered.filter(c =>
      (c.l1Status === "Scheduled" && c.l1ScheduledDate === todayStr) ||
      (c.l2Status === "Scheduled" && c.l2ScheduledDate === todayStr)
    ).length;

    const pendingFeedback = filtered.filter(c => {
      const l1Past = c.l1Status === "Scheduled" && c.l1ScheduledDate && c.l1ScheduledDate < todayStr && !c.l1Result;
      const l2Past = c.l2Status === "Scheduled" && c.l2ScheduledDate && c.l2ScheduledDate < todayStr && !c.l2Result;
      return l1Past || l2Past;
    }).length;

    return {
      totalAssigned: filtered.length,
      todayCount,
      pendingFeedback,
      totalScheduled: l1Scheduled + l2Scheduled,
      totalSelected:  l1Selected  + l2Selected,
      totalRejected:  l1Rejected  + l2Rejected,
      l1Scheduled, l2Scheduled,
      l1Selected,  l2Selected,
      l1Rejected,  l2Rejected,
    };
  }, [filtered, todayStr]);



  

  // ── Interview lists (from filtered set) ───────────────────────────────────
  const { todayInterviews, upcomingInterviews, pendingFeedbackList } = useMemo(() => {
    const maxDate = new Date(today); maxDate.setDate(today.getDate() + 7);
    const maxStr  = maxDate.toISOString().split("T")[0];

    const todayList: any[] = [], upcomingList: any[] = [], pendingList: any[] = [];

    filtered.forEach(c => {
      [
        { label: "L1 Interview", df: "l1ScheduledDate", sf: "l1TimeSlot", st: "l1Status", rf: "l1Result" },
        { label: "L2 Interview", df: "l2ScheduledDate", sf: "l2TimeSlot", st: "l2Status", rf: "l2Result" },
      ].forEach(({ label, df, sf, st, rf }) => {
        const ds     = (c as any)[df];
        const status = (c as any)[st];
        const result = (c as any)[rf];
        if (status !== "Scheduled" || !ds) return;

        const item = {
          id: `${c.id}-${label}`, candidateId: c.id,
          candidate: c.candidateName || "Unknown",
          round: label, date: ds, timeSlot: (c as any)[sf] || "",
          isToday: ds === todayStr, isPast: ds < todayStr, hasResult: !!result,
        };

        if      (ds === todayStr)               todayList.push(item);
        else if (ds < todayStr && !result)      pendingList.push(item);
        else if (ds > todayStr && ds <= maxStr) upcomingList.push(item);
      });
    });

    return {
      todayInterviews:     todayList,
      upcomingInterviews:  upcomingList.sort((a, b) => a.date.localeCompare(b.date)),
      pendingFeedbackList: pendingList.sort((a, b) => b.date.localeCompare(a.date)),
    };
  }, [filtered, todayStr]);

  // ── Recent decisions (from filtered set) ──────────────────────────────────
  const recentDecisions = useMemo(() =>
    filtered.filter(c =>
      (c.l1InterviewerUid === panelUid && ["Selected", "Rejected"].includes(c.l1Status ?? "")) ||
      (c.l2InterviewerUid === panelUid && ["Selected", "Rejected"].includes(c.l2Status ?? ""))
    ).slice(0, 5),
  [filtered, panelUid]);

  // ── Trend chart (always from full assigned list, not filtered) ────────────
  const trendData = useMemo<MonthlyData[]>(() => {
    const months: MonthlyData[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      months.push({ month: d.toLocaleString("default", { month: "short" }), monthNum: d.getMonth(), year: d.getFullYear(), conducted: 0, selected: 0 });
    }
    candidates.forEach(c => {
      const cDate = c.createdAt instanceof Date ? c.createdAt : new Date();
      const idx = months.findIndex(m => m.monthNum === cDate.getMonth() && m.year === cDate.getFullYear());
      if (idx === -1) return;
      if (c.l1InterviewerUid === panelUid && ["Selected", "Rejected"].includes(c.l1Status ?? "")) {
        months[idx].conducted++;
        if (c.l1Status === "Selected") months[idx].selected++;
      }
      if (c.l2InterviewerUid === panelUid && ["Selected", "Rejected"].includes(c.l2Status ?? "")) {
        months[idx].conducted++;
        if (c.l2Status === "Selected") months[idx].selected++;
      }
    });
    return months;
  }, [candidates, panelUid]);

  if (!isMounted || loading) return (
    <div className="h-screen flex items-center justify-center gap-3">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">Loading Panel Dashboard…</p>
    </div>
  );

  return (
    <div className="space-y-6 pb-10 w-full overflow-x-hidden">

      {/* Live indicator */}
      <div className="flex items-center justify-end">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-3 py-1.5 rounded-full">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse block" />
          Live data
        </div>
      </div>

      {/* ── FILTERS ── */}
      {/* Mirrors admin dashboard: stage + status dropdowns, live count badge, clear button */}
      <div className="bg-card border rounded-xl p-4 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-3 items-end">
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">

            {/* Stage filter */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Interview Stage
              </label>
              <Select
                value={filterStage}
                onValueChange={v => { setFilterStage(v); setFilterStatus("all"); }}
              >
                <SelectTrigger className="h-10 text-sm rounded-lg">
                  <SelectValue placeholder="All Stages" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Stages</SelectItem>
                  <SelectItem value="l1">L1 Interview</SelectItem>
                  <SelectItem value="l2">L2 Interview</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Status filter */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Status
              </label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-10 text-sm rounded-lg">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="Scheduled">Scheduled</SelectItem>
                  <SelectItem value="Selected">Selected</SelectItem>
                  <SelectItem value="Rejected">Rejected</SelectItem>
                  <SelectItem value="Pending">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {hasFilters && (
            <Button
              variant="ghost" size="sm"
              onClick={() => { setFilterStage("all"); setFilterStatus("all"); }}
              className="h-10 gap-1.5 text-xs rounded-lg border shrink-0"
            >
              <XCircle className="h-3.5 w-3.5" /> Clear filters
            </Button>
          )}
        </div>

        {/* Live count summary */}
        {hasFilters && (
          <p className="text-[11px] text-muted-foreground mt-2 pt-2 border-t">
            Showing{" "}
            <span className="font-semibold text-foreground">{filtered.length}</span>
            {" "}of{" "}
            <span className="font-semibold text-foreground">{candidates.length}</span>
            {" "}assigned candidates
            {filterStage !== "all" && (
              <span> · Stage: <span className="font-semibold capitalize">{filterStage.toUpperCase()}</span></span>
            )}
            {filterStatus !== "all" && (
              <span> · Status: <span className="font-semibold">{filterStatus}</span></span>
            )}
          </p>
        )}
      </div>

      {/* Today's alert banner */}
      {todayInterviews.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/20">
          <div className="h-8 w-8 rounded-lg bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center shrink-0">
            <Calendar className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
              You have {todayInterviews.length} interview{todayInterviews.length > 1 ? "s" : ""} today
            </p>
            <p className="text-[11px] text-emerald-600 dark:text-emerald-500 truncate">
              {todayInterviews.map(i => `${i.candidate} (${i.round})`).join(" · ")}
            </p>
          </div>
          <Badge className="bg-emerald-500 shrink-0">{todayInterviews.length} today</Badge>
        </div>
      )}

      {/* Pending feedback alert */}
      {stats.pendingFeedback > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20">
          <div className="h-8 w-8 rounded-lg bg-amber-100 dark:bg-amber-900 flex items-center justify-center shrink-0">
            <AlertCircle className="h-4 w-4 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              {stats.pendingFeedback} interview{stats.pendingFeedback > 1 ? "s" : ""} pending feedback
            </p>
            <p className="text-[11px] text-amber-600">Please submit feedback so HR can proceed</p>
          </div>
        </div>
      )}

      {/* ── ROW 1: Summary Stats ── */}
      {/* Each card href passes panelUid + the relevant filter so history page shows ONLY those N candidates */}
      <div>
        <SectionLabel>My Interview Overview</SectionLabel>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">

          {/* Total assigned — history filtered to panelUid only */}
          <StatCard
            title="Assigned to Me"
            value={stats.totalAssigned}
            icon={Users}
            accent="bg-slate-500"
            href={buildHistoryUrl({ panelUid })}
            description="Total candidates assigned"
          />

          {/* Today — history filtered to panelUid + today's scheduled */}
          <StatCard
            title="Today's Interviews"
            value={stats.todayCount}
            icon={Calendar}
            accent="bg-emerald-500"
            href={buildHistoryUrl({ panelUid, scheduledDate: todayStr })}
            description="Scheduled for today"
          />

          {/* Pending feedback — history filtered to panelUid + pending */}
          <StatCard
            title="Pending Feedback"
            value={stats.pendingFeedback}
            icon={AlertCircle}
            accent="bg-amber-500"
            href={buildHistoryUrl({ panelUid, pendingFeedback: "true" })}
            description="Feedback not submitted"
            highlight={stats.pendingFeedback > 0}
          />

          {/* Selected — history filtered to panelUid + selected across rounds */}
          <StatCard
            title="Selected by Me"
            value={stats.totalSelected}
            icon={UserCheck}
            accent="bg-indigo-500"
            href={buildHistoryUrl({ panelUid, status: "Selected" })}
            description="L1 + L2 combined"
          />
        </div>
      </div>

      {/* ── ROW 2: Round Breakdown + Trend Chart ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Round breakdown — all hrefs pass panelUid so history shows only this panel's candidates */}
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
                  {
                    label: "Scheduled", count: stats.l1Scheduled, dot: "bg-blue-400",
                    href: buildHistoryUrl({ panelUid, stage: "l1", status: "Scheduled" }),
                  },
                  {
                    label: "Selected",  count: stats.l1Selected,  dot: "bg-emerald-500",
                    href: buildHistoryUrl({ panelUid, stage: "l1", status: "Selected" }),
                  },
                  {
                    label: "Rejected",  count: stats.l1Rejected,  dot: "bg-rose-500",
                    href: buildHistoryUrl({ panelUid, stage: "l1", status: "Rejected" }),
                  },
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
                  {
                    label: "Scheduled", count: stats.l2Scheduled, dot: "bg-sky-400",
                    href: buildHistoryUrl({ panelUid, stage: "l2", status: "Scheduled" }),
                  },
                  {
                    label: "Selected",  count: stats.l2Selected,  dot: "bg-emerald-500",
                    href: buildHistoryUrl({ panelUid, stage: "l2", status: "Selected" }),
                  },
                  {
                    label: "Rejected",  count: stats.l2Rejected,  dot: "bg-rose-500",
                    href: buildHistoryUrl({ panelUid, stage: "l2", status: "Rejected" }),
                  },
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
                  {stats.totalSelected} selected / {stats.totalSelected + stats.totalRejected} evaluated
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Trend chart */}
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

      {/* ── ROW 3: Today + Upcoming ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

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
                    No interviews today
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

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

      {/* ── ROW 4: Pending Feedback + Recent Decisions ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        <div>
          <SectionLabel>Pending Feedback</SectionLabel>
          <Card className="shadow-sm border">
            <CardContent className="p-5">
              {pendingFeedbackList.length > 0 ? (
                <div className="divide-y divide-border">
                  {pendingFeedbackList.slice(0, 5).map(item => (
                    // ── FIX: Clicking candidate name goes to the candidate detail page ──
                    <Link
                      key={item.id}
                      href={buildHistoryUrl({
                        panelUid,
                        candidateId: item.candidateId,
                      })}                      className="flex items-center justify-between py-3 group"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">
                          {item.candidate}
                        </p>
                        <p className="text-[11px] text-muted-foreground">{item.round}</p>
                        <p className="text-[10px] text-amber-600 mt-0.5">
                          Interview was on{" "}
                          {new Date(item.date + "T00:00:00").toLocaleDateString("en-IN", {
                            day: "2-digit", month: "short",
                          })}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 ml-3 shrink-0">
                        <Badge className="bg-amber-500 text-[10px]">Pending</Badge>
                        <MessageSquare className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                      </div>
                    </Link>
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

        <div>
          <SectionLabel>Recent Decisions</SectionLabel>
          <Card className="shadow-sm border">
            <CardContent className="p-5">
              {recentDecisions.length === 0 ? (
                <div className="h-20 flex items-center justify-center text-sm text-muted-foreground">
                  No decisions made yet.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {recentDecisions.map(c => {
                    const isL1   = c.l1InterviewerUid === panelUid && ["Selected", "Rejected"].includes(c.l1Status ?? "");
                    const round  = isL1 ? "L1" : "L2";
                    const status = isL1 ? c.l1Status : c.l2Status;
                    return (
                      // ── FIX: Links directly to the candidate's detail page ──
                      <Link
                        key={c.id}
                        href={buildHistoryUrl({
                          panelUid,
                          candidateId: c.id,
                        })}                        className="flex items-center justify-between py-3 group"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">
                            {c.candidateName || "Unknown"}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {c.candidateDesignation}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 ml-3 shrink-0">
                          <Badge variant="outline" className={cn("text-[10px]",
                            round === "L1"
                              ? "border-indigo-300 text-indigo-700 dark:text-indigo-300"
                              : "border-blue-300 text-blue-700 dark:text-blue-300"
                          )}>{round}</Badge>
                          <Badge
                            variant={status === "Selected" ? "default" : "destructive"}
                            className="text-[10px]"
                          >
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