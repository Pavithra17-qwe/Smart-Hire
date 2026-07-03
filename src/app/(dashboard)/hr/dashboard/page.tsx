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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, Label,
} from "recharts";
import {
  Carousel, CarouselContent, CarouselItem,
  CarouselNext, CarouselPrevious,
} from "@/components/ui/carousel";
import {
  Users, Briefcase, Calendar, Send, UserCheck,
  BrainCircuit, PlusCircle, Eye, Loader2,
  CheckCircle2, XCircle, Clock, Activity,
  ChevronRight, ArrowUpRight, BarChart3,
  FileText, CalendarDays, TrendingDown, Layers,
  Star, Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { text } from "stream/consumers";
import { DateRangeFilter } from "@/components/shared/DateRangeFilter";
import { parse, isValid } from "date-fns";


// ─── types ────────────────────────────────────────────────────────────────────
interface Candidate {
  id: string;
  candidateName?: string;
  candidateDesignation?: string;
  finalStatus?: string;
  resumeReviewStatus?: string;
  l1Status?: string; l1ScheduledDate?: string; l1TimeSlot?: string;
  l2Status?: string; l2ScheduledDate?: string; l2TimeSlot?: string;
  l2ManagerStatus?: string; l2ManagerScheduledDate?: string; l2ManagerTimeSlot?: string;
  hrStatus?: string; hrScheduledDate?: string; hrTimeSlot?: string;
  offerStatus?: string;
  aiScore?: number;
  createdDate?: any;
  createdAt?: any;
  createdBy?: string;
  jobRequisitionId?: string;
}


interface JobRequisition {
  id: string;
  projectName?: string;
  roles?: string[];
  locations?: string[];
  status?: string;
  createdDate?: any;
  createdAt?: any;
  jdFileName?: string;
}


interface MonthlyTrend {
  month: string; monthNum: number; year: number; total: number; hired: number;
}


// ─── chart config ─────────────────────────────────────────────────────────────
const trendConfig = {
  total: { label: "Added", color: "hsl(var(--primary))" },
  hired: { label: "Hired", color: "#10B981" },
} satisfies ChartConfig;


// ─── sub-components ──────────────────────────────────────────────────────────

function normalize(s: any): string {
  const v = (s || "").toLowerCase().trim();
  if (v === "accepted") return "Accepted";
  if (v === "selected") return "Selected";
  if (v === "rejected") return "Rejected";
  if (v === "scheduled") return "Scheduled";
  if (v === "rescheduled") return "Rescheduled";
  if (v === "pending") return "Pending";
  if (v === "released") return "Released";
  if (v === "completed") return "Completed";
  if (v === "in progress") return "In Progress";
  if (v === "on hold") return "On Hold";
  if (v === "expired") return "Expired";
  return s || "Pending";
}

// ─── stage progression helper ───────────────────────────────────────────────
// Determines a candidate's single current stage so they are counted in
// exactly one bucket across the funnel / stage breakdown, instead of every
// stage they have historically passed through.
//
// NOTE ON FIELD MAPPING: Candidate History (the source of truth for these
// fields) maps display stages to Firestore fields as:
//   Screening Status → l1Status
//   L1 Status        → l2Status
//   L2 Status         → l2ManagerStatus
// This file mirrors that exact mapping so the Dashboard and Candidate
// History page agree on what each candidate's stage statuses mean.
const STAGE_ORDER = ["resume", "screening", "l1", "l2", "hr", "offer"] as const;
type StageKey = typeof STAGE_ORDER[number];

function getCandidateProgress(c: Candidate) {
  const statuses: Record<StageKey, string> = {
    resume: c.resumeReviewStatus || "Pending",
    screening: c.l1Status || "Pending",
    l1: c.l2Status || "Pending",
    l2: c.l2ManagerStatus || "Pending",
    hr: c.hrStatus || "Pending",
    offer: c.offerStatus || "Pending",
  };
  const isPassed: Record<StageKey, (s: string) => boolean> = {
    resume: s => s === "Accepted",
    screening: s => s === "Selected",
    l1: s => s === "Selected",
    l2: s => s === "Selected",
    hr: s => s === "Selected",
    offer: s => s === "Released" || s === "Accepted",
  };

  let lastPassedIdx = -1;
  for (let i = 0; i < STAGE_ORDER.length; i++) {
    if (isPassed[STAGE_ORDER[i]](statuses[STAGE_ORDER[i]])) lastPassedIdx = i;
    else break;
  }

  const currentIdx = Math.min(lastPassedIdx + 1, STAGE_ORDER.length - 1);

  return {
    milestoneKey: lastPassedIdx >= 0 ? STAGE_ORDER[lastPassedIdx] : null,
    currentKey: STAGE_ORDER[currentIdx],
    currentStatus: statuses[STAGE_ORDER[currentIdx]],
  };
}

// ─── trend bucketing helpers (Hiring Trend date filter only) ────────────────
type TrendBucket = { month: string; total: number; hired: number };

function bucketByMonth(candidates: Candidate[], monthsBack: number): TrendBucket[] {
  const buckets: (TrendBucket & { monthNum: number; year: number })[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    buckets.push({ month: d.toLocaleString("default", { month: "short" }), monthNum: d.getMonth(), year: d.getFullYear(), total: 0, hired: 0 });
  }
  candidates.forEach(c => {
    const cDate = c.createdAt instanceof Date ? c.createdAt : new Date();
    const idx = buckets.findIndex(b => b.monthNum === cDate.getMonth() && b.year === cDate.getFullYear());
    if (idx !== -1) { buckets[idx].total++; if (c.finalStatus === "Completed") buckets[idx].hired++; }
  });
  return buckets.filter(b => b.total > 0).map(({ month, total, hired }) => ({ month, total, hired }));
}

function bucketByDay(candidates: Candidate[], daysBack: number): TrendBucket[] {
  const end = new Date(); end.setHours(0, 0, 0, 0);
  const buckets: (TrendBucket & { key: string })[] = [];
  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date(end); d.setDate(end.getDate() - i);
    buckets.push({ key: d.toISOString().split("T")[0], month: d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }), total: 0, hired: 0 });
  }
  candidates.forEach(c => {
    const cDate = c.createdAt instanceof Date ? c.createdAt : new Date();
    const key = new Date(cDate.getFullYear(), cDate.getMonth(), cDate.getDate()).toISOString().split("T")[0];
    const idx = buckets.findIndex(b => b.key === key);
    if (idx !== -1) { buckets[idx].total++; if (c.finalStatus === "Completed") buckets[idx].hired++; }
  });
  return buckets.filter(b => b.total > 0).map(({ month, total, hired }) => ({ month, total, hired }));
}

function bucketByDateRange(candidates: Candidate[], fromStr: string, toStr: string): TrendBucket[] {
  const from = new Date(fromStr + "T00:00:00");
  const to = new Date(toStr + "T00:00:00");
  const spanDays = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;

  const inRange = candidates.filter(c => {
    const cDate = c.createdAt instanceof Date ? c.createdAt : new Date();
    const cDay = new Date(cDate.getFullYear(), cDate.getMonth(), cDate.getDate());
    return cDay >= from && cDay <= to;
  });

  if (spanDays <= 31) {
    const buckets: (TrendBucket & { key: string })[] = [];
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      buckets.push({ key: d.toISOString().split("T")[0], month: d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }), total: 0, hired: 0 });
    }
    inRange.forEach(c => {
      const cDate = c.createdAt instanceof Date ? c.createdAt : new Date();
      const key = new Date(cDate.getFullYear(), cDate.getMonth(), cDate.getDate()).toISOString().split("T")[0];
      const idx = buckets.findIndex(b => b.key === key);
      if (idx !== -1) { buckets[idx].total++; if (c.finalStatus === "Completed") buckets[idx].hired++; }
    });
    return buckets.filter(b => b.total > 0).map(({ month, total, hired }) => ({ month, total, hired }));
  }

  const buckets: (TrendBucket & { monthNum: number; year: number })[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  const last = new Date(to.getFullYear(), to.getMonth(), 1);
  while (cursor <= last) {
    buckets.push({ month: cursor.toLocaleString("default", { month: "short", year: "2-digit" }), monthNum: cursor.getMonth(), year: cursor.getFullYear(), total: 0, hired: 0 });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  inRange.forEach(c => {
    const cDate = c.createdAt instanceof Date ? c.createdAt : new Date();
    const idx = buckets.findIndex(b => b.monthNum === cDate.getMonth() && b.year === cDate.getFullYear());
    if (idx !== -1) { buckets[idx].total++; if (c.finalStatus === "Completed") buckets[idx].hired++; }
  });
  return buckets.filter(b => b.total > 0).map(({ month, total, hired }) => ({ month, total, hired }));
}

function computeTrendChartData(
  candidates: Candidate[],
  range: "1w" | "1m" | "6m" | "custom",
  appliedCustomRange: { from: string; to: string } | null
): TrendBucket[] {
  if (range === "1w") return bucketByDay(candidates, 7);
  if (range === "1m") return bucketByDay(candidates, 30);
  if (range === "6m") return bucketByMonth(candidates, 6);
  if (range === "custom" && appliedCustomRange) return bucketByDateRange(candidates, appliedCustomRange.from, appliedCustomRange.to);
  return [];
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-3">
      {children}
    </p>
  );
}


function StatCard({
  title, value, icon: Icon, accent, href, description,
}: {
  title: string; value: number; icon: any; accent: string; href: string; description: string;
}) {
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
      <div className={cn("px-3 py-2.5 rounded-lg text-center", accent)}>
        <p className="text-[10px] font-black uppercase tracking-widest text-white">{title}</p>
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


// ─── main ──────────────────────────────────────────────────────────────────────
export default function HRDashboard() {
  const router = useRouter();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [jobRequisitions, setJobRequisitions] = useState<JobRequisition[]>([]);
  const [loading, setLoading] = useState(true);
  const [isMounted, setIsMounted] = useState(false);


  // ── Filters ──────────────────────────────────────────────────────────────────
  const [filterStage, setFilterStage] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterDesignation, setFilterDesignation] = useState("all");
  const [filterProject, setFilterProject] = useState("all");

  // ── Hiring Trend date range filter ────────────────────────────────────────
  const [trendRange, setTrendRange] = useState<"1w" | "1m" | "6m" | "custom">("6m");
  const [trendCustomFrom, setTrendCustomFrom] = useState(""); // dd-MM-yyyy, matches shared DateRangeFilter contract
  const [trendCustomTo, setTrendCustomTo] = useState("");     // dd-MM-yyyy
  const [appliedCustomRange, setAppliedCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [isTrendLoading, setIsTrendLoading] = useState(false);
  const [trendChartData, setTrendChartData] = useState<{ month: string; total: number; hired: number }[]>([]);
  const todayStr = new Date().toISOString().split("T")[0];

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
            l1Status: normalize(r.l1Status),
            l2Status: normalize(r.l2Status),
            l2ManagerStatus: normalize(r.l2ManagerStatus),
            hrStatus: normalize(r.hrStatus),
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


  useEffect(() => {
    const unsub = onSnapshot(collection(db, "job_requisitions"), snap => {
      setJobRequisitions(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as JobRequisition)));
    });
    return () => unsub();
  }, []);


  // ── Unique designations for filter ───────────────────────────────────────────
  const designations = useMemo(() => {
    const set = new Set<string>();
    candidates.forEach(c => { if (c.candidateDesignation) set.add(c.candidateDesignation); });
    return Array.from(set).sort();
  }, [candidates]);


  // ── Unique projects for filter ───────────────────────────────────────────────
  const projects = useMemo(() => {
    const set = new Set<string>();
    jobRequisitions.forEach(jr => { if (jr.projectName) set.add(jr.projectName); });
    return Array.from(set).sort();
  }, [jobRequisitions]);


  // ── Map jobRequisitionId -> projectName for fast lookup ──────────────────────
  const jrProjectMap = useMemo(() => {
    const map = new Map<string, string>();
    jobRequisitions.forEach(jr => { if (jr.projectName) map.set(jr.id, jr.projectName); });
    return map;
  }, [jobRequisitions]);


  // ── Filtered candidates ───────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const stageMap: Record<string, string> = {
      resume: "resumeReviewStatus", screening: "l1Status", l1: "l2Status", l2: "l2ManagerStatus",
      hr: "hrStatus", offer: "offerStatus", final: "finalStatus",
    };
    return candidates.filter(c => {
      if (filterDesignation !== "all" && c.candidateDesignation !== filterDesignation) return false;
      if (filterProject !== "all") {
        const candidateProject = c.jobRequisitionId ? jrProjectMap.get(c.jobRequisitionId) : undefined;
        if (candidateProject !== filterProject) return false;
      }

      if (filterStage !== "all" && filterStatus !== "all") {
        // Stage + specific Status both selected: match the exact field value.
        const field = stageMap[filterStage];
        if (field && (c as any)[field] !== filterStatus) return false;
      } else if (filterStage !== "all" && filterStatus === "all") {
        // Stage selected, Status = "All Statuses": restrict to candidates
        // whose CURRENT active stage is this one (any status), matching
        // the same logic the Interview Stage Breakdown / Hiring Funnel use.
        if (filterStage === "final") {
          // no-op: "final" stage with all statuses means no extra restriction
        } else {
          const progress = getCandidateProgress(c);
          if (progress.currentKey !== filterStage) return false;
        }
      } else if (filterStage === "all" && filterStatus !== "all") {
        if (c.finalStatus !== filterStatus) return false;
      }

      return true;
    });
  }, [candidates, filterStage, filterStatus, filterDesignation, filterProject, jrProjectMap]);

  useEffect(() => {
    if (trendRange === "custom" && !appliedCustomRange) {
      setTrendChartData([]);
      setIsTrendLoading(false);
      return;
    }
    setIsTrendLoading(true);
    const timer = setTimeout(() => {
      setTrendChartData(computeTrendChartData(filtered, trendRange, appliedCustomRange));
      setIsTrendLoading(false);
    }, 200);
    return () => clearTimeout(timer);
  }, [filtered, trendRange, appliedCustomRange]);

  const hasFilters = filterStage !== "all" || filterStatus !== "all" || filterDesignation !== "all" || filterProject !== "all";
  const buildCandidateLink = (stage?: string, status?: string, finalStatus?: string) => {
    const params = new URLSearchParams();
    // When no explicit stage/status override is passed, fall back to the
    // currently selected dashboard Interview Stage / Status filters, so
    // Total Candidates / In Progress / Rejected / Hired all carry them too.
    const effStage = stage ?? (filterStage !== "all" ? filterStage : undefined);
    const effStatus = status ?? (filterStatus !== "all" ? filterStatus : undefined);
    if (effStage) params.set("stage", effStage);
    if (effStatus) params.set("status", effStatus);
    if (filterProject !== "all") params.set("project", filterProject);
    if (filterDesignation !== "all") params.set("role", filterDesignation);
    if (finalStatus) params.set("finalStatus", finalStatus);
    const qs = params.toString();
    return `/candidates/history${qs ? `?${qs}` : ""}`;
  };

  // ── Converts the shared DateRangeFilter's dd-MM-yyyy strings to the
  // YYYY-MM-DD format bucketByDateRange already expects — a pure format
  // bridge, not new business logic. bucketByDateRange itself is untouched.
  const ddmmyyyyToISO = (val: string): string | null => {
    if (!val) return null;
    const parsed = parse(val, "dd-MM-yyyy", new Date());
    if (!isValid(parsed)) return null;
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  // ── Auto-apply: as soon as both dates are valid, refresh the chart.
  // No Apply button — the chart updates the moment a valid range exists.
  useEffect(() => {
    if (trendRange !== "custom") return;
    const fromISO = ddmmyyyyToISO(trendCustomFrom);
    const toISO = ddmmyyyyToISO(trendCustomTo);
    if (!fromISO || !toISO || fromISO > toISO) {
      setAppliedCustomRange(null);
      return;
    }
    setAppliedCustomRange({ from: fromISO, to: toISO });
  }, [trendCustomFrom, trendCustomTo, trendRange]);

  // ── Clear: resets both dates, clears the applied range, and falls back
  // to the default Last 6 Months view.
  const handleClearTrendCustomRange = () => {
    setTrendCustomFrom("");
    setTrendCustomTo("");
    setAppliedCustomRange(null);
    setTrendRange("6m");
  };

  // ── Derived stats from filtered ───────────────────────────────────────────
  // ── Derived stats from filtered ───────────────────────────────────────────
  const stats = useMemo(() => {
    const progress = filtered.map(getCandidateProgress);

    // ── Interview Stage Breakdown (current stage only) ──────────────────
    const resumeCurrentAccepted = progress.filter(p => p.currentKey === "resume" && p.currentStatus === "Accepted").length;
    const resumeRejected = progress.filter(p => p.currentKey === "resume" && p.currentStatus === "Rejected").length;
    const resumeOnHold = progress.filter(p => p.currentKey === "resume" && p.currentStatus === "On Hold").length;
    const resumePending = progress.filter(p => p.currentKey === "resume" && p.currentStatus === "Pending").length;

    const screeningCurrentSelected = progress.filter(p => p.currentKey === "screening" && p.currentStatus === "Selected").length;
    const screeningScheduled = progress.filter(p => p.currentKey === "screening" && p.currentStatus === "Scheduled").length;
    const screeningRescheduled = progress.filter(p => p.currentKey === "screening" && p.currentStatus === "Rescheduled").length;
    const screeningRejected = progress.filter(p => p.currentKey === "screening" && p.currentStatus === "Rejected").length;
    const screeningOnHold = progress.filter(p => p.currentKey === "screening" && p.currentStatus === "On Hold").length;
    const screeningExpired = progress.filter(p => p.currentKey === "screening" && p.currentStatus === "Expired").length;
    const screeningPending = progress.filter(p => p.currentKey === "screening" && p.currentStatus === "Pending").length;

    const l1CurrentSelected = progress.filter(p => p.currentKey === "l1" && p.currentStatus === "Selected").length;
    const l1Scheduled = progress.filter(p => p.currentKey === "l1" && p.currentStatus === "Scheduled").length;
    const l1Rejected = progress.filter(p => p.currentKey === "l1" && p.currentStatus === "Rejected").length;
    const l1OnHold = progress.filter(p => p.currentKey === "l1" && p.currentStatus === "On Hold").length;
    const l1Pending = progress.filter(p => p.currentKey === "l1" && p.currentStatus === "Pending").length;

    const l2CurrentSelected = progress.filter(p => p.currentKey === "l2" && p.currentStatus === "Selected").length;
    const l2Scheduled = progress.filter(p => p.currentKey === "l2" && p.currentStatus === "Scheduled").length;
    const l2Rejected = progress.filter(p => p.currentKey === "l2" && p.currentStatus === "Rejected").length;
    const l2OnHold = progress.filter(p => p.currentKey === "l2" && p.currentStatus === "On Hold").length;
    const l2Pending = progress.filter(p => p.currentKey === "l2" && p.currentStatus === "Pending").length;

    const hrCurrentSelected = progress.filter(p => p.currentKey === "hr" && p.currentStatus === "Selected").length;
    const hrScheduled = progress.filter(p => p.currentKey === "hr" && p.currentStatus === "Scheduled").length;
    const hrRejected = progress.filter(p => p.currentKey === "hr" && p.currentStatus === "Rejected").length;
    const hrOnHold = progress.filter(p => p.currentKey === "hr" && p.currentStatus === "On Hold").length;
    const hrPending = progress.filter(p => p.currentKey === "hr" && p.currentStatus === "Pending").length;

    // Offer stage is terminal and always reflects the live offerStatus field directly.
    const offerPending = progress.filter(p => p.currentKey === "offer" && p.currentStatus === "Pending").length;
    const offerReleasedRaw = progress.filter(p => p.currentKey === "offer" && p.currentStatus === "Released").length;
    const offerAccepted = progress.filter(p => p.currentKey === "offer" && p.currentStatus === "Accepted").length;
    const offerRejected = progress.filter(p => p.currentKey === "offer" && p.currentStatus === "Rejected").length;
    const offerOnHold = progress.filter(p => p.currentKey === "offer" && p.currentStatus === "On Hold").length;

    return {
      total: filtered.length,
      inProgress: filtered.filter(c => { const f = (c.finalStatus ?? "").toLowerCase(); return f !== "completed" && f !== "rejected"; }).length,
      hired: filtered.filter(c => c.finalStatus === "Completed").length,
      rejected: filtered.filter(c => c.finalStatus === "Rejected").length,

      // ── Hiring Funnel counts ──────────────────────────────────────────
      // Resume Reviewed = every candidate who has entered the AI Screening
      // stage, regardless of screening outcome: Scheduled + On Hold +
      // Expired + Rescheduled (excludes Rejected/Pending — those haven't
      // meaningfully "entered" screening from a funnel perspective).
      resumeAccepted: screeningScheduled + screeningOnHold + screeningExpired + screeningRescheduled,
      screeningSelected: l1Scheduled + l1OnHold + l1Pending,
      l1Selected: l2Scheduled + l2OnHold + l2Pending,
      l2Selected: hrScheduled + hrOnHold + hrPending,
      hrSelected: offerReleasedRaw + offerOnHold + offerPending,
      offerReleasedFunnel: offerAccepted,

      // ── Interview Stage Breakdown (current stage only) ──────────────────
      resumeCurrentAccepted, resumeRejected, resumeOnHold, resumePending,
      screeningCurrentSelected, screeningScheduled, screeningRescheduled, screeningRejected, screeningOnHold, screeningExpired, screeningPending,
      l1CurrentSelected, l1Scheduled, l1Rejected, l1OnHold, l1Pending,
      l2CurrentSelected, l2Scheduled, l2Rejected, l2OnHold, l2Pending,
      hrCurrentSelected, hrScheduled, hrRejected, hrOnHold, hrPending,
      offerPending, offerReleased: offerReleasedRaw, offerAccepted, offerRejected, offerOnHold,
    };
  }, [filtered]);

  // ── Funnel donut ──────────────────────────────────────────────────────────
  // ── Funnel donut ──────────────────────────────────────────────────────────
  const funnelData = useMemo(() => {
    const stageLabelMap: Record<string, string> = {
      resume: "Resume Reviewed",
      screening: "Screening Round Selected",
      l1: "L1 Round Selected",
      l2: "L2 Round Selected",
      hr: "HR Round Selected",
      offer: "Offer Accepted",
    };
    const stageColorMap: Record<string, string> = {
      resume: "#6366F1",
      screening: "#14B8A6",
      l1: "#3B82F6",
      l2: "#F59E0B",
      hr: "#EC4899",
      offer: "#8B5CF6",
    };

    if (filterStage !== "all" && stageLabelMap[filterStage]) {
      // A specific stage is selected: `filtered` is already scoped to
      // candidates currently in that stage (plus Project/Role/Status),
      // so the funnel shows a single slice representing that exact count.
      return [
        { name: stageLabelMap[filterStage], value: filtered.length, fill: stageColorMap[filterStage] },
      ].filter(d => d.value > 0);
    }

    return [
      { name: "Resume Reviewed", value: stats.resumeAccepted, fill: "#6366F1" },
      { name: "Screening Round Selected", value: stats.screeningSelected, fill: "#14B8A6" },
      { name: "L1 Round Selected", value: stats.l1Selected, fill: "#3B82F6" },
      { name: "L2 Round Selected", value: stats.l2Selected, fill: "#F59E0B" },
      { name: "HR Round Selected", value: stats.hrSelected, fill: "#EC4899" },
      { name: "Offer Accepted", value: stats.offerReleasedFunnel, fill: "#8B5CF6" },
    ].filter(d => d.value > 0);
  }, [stats, filterStage, filtered]);


  const funnelTotal = funnelData.reduce((s, d) => s + d.value, 0);
  // ── Recent 5 candidates ───────────────────────────────────────────────────
  const recent = filtered.slice(0, 5);


  // ── Upcoming interviews (next 3 days) ────────────────────────────────────
  const upcoming = useMemo(() => {
    const list: any[] = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split("T")[0];
    const max = new Date(today); max.setDate(today.getDate() + 6);
    const maxStr = max.toISOString().split("T")[0];
    filtered.forEach(c => {
      [
        { label: "L1 Interview", df: "l2ScheduledDate", sf: "l2TimeSlot", st: "l2Status" },
        { label: "L2 Interview", df: "l2ManagerScheduledDate", sf: "l2ManagerTimeSlot", st: "l2ManagerStatus" },
        { label: "HR Round", df: "hrScheduledDate", sf: "hrTimeSlot", st: "hrStatus" },
      ].forEach(({ label, df, sf, st }) => {
        const ds = (c as any)[df];
        if ((c as any)[st] === "Scheduled" && ds && ds >= todayStr && ds <= maxStr) {
          list.push({
            id: `${c.id}-${label}`, candidateId: c.id,
            name: c.candidateName || "Unknown",
            role: c.candidateDesignation || "N/A",
            stage: label, date: ds,
            timeSlot: (c as any)[sf] || "",
            isToday: ds === todayStr,
          });
        }
      });
    });
    return list.sort((a, b) => a.date.localeCompare(b.date));
  }, [filtered]);


  // ── AI insights ───────────────────────────────────────────────────────────
  const aiInsights = useMemo(() => {
    const scored = candidates.filter(c => typeof c.aiScore === "number" && (c.aiScore ?? 0) > 0);
    const avg = scored.length
      ? Math.round(scored.reduce((s, c) => s + (c.aiScore ?? 0), 0) / scored.length)
      : 0;
    const top = [...scored].sort((a, b) => (b.aiScore ?? 0) - (a.aiScore ?? 0)).slice(0, 3);
    return { avg, top, scoredCount: scored.length, total: candidates.length };
  }, [candidates]);


  // ── Recent job requisitions ───────────────────────────────────────────────
  const recentJRs = useMemo(() =>
    [...jobRequisitions]
      .sort((a, b) => {
        const ta = a.createdAt?.toDate?.()?.getTime?.() ?? a.createdDate?.toDate?.()?.getTime?.() ?? 0;
        const tb = b.createdAt?.toDate?.()?.getTime?.() ?? b.createdDate?.toDate?.()?.getTime?.() ?? 0;
        return tb - ta;
      })
      .slice(0, 4),
    [jobRequisitions]);


  if (!isMounted || loading) {
    return (
      <div className="h-screen flex items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading HR Dashboard…</p>
      </div>
    );
  }


  return (
    <div className="space-y-6 pb-10 w-full">
      {/* ── FILTERS ── */}
      <div className="bg-card border rounded-xl p-4 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-3 items-end">
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-start">
            {/* Project filter */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1 h-4">
                <Briefcase className="h-3 w-3" /> Project
              </label>
              <Select value={filterProject} onValueChange={setFilterProject}>
                <SelectTrigger className="h-10 text-sm rounded-lg">
                  <SelectValue placeholder="All Projects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Projects</SelectItem>
                  {projects.map(p => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>


            {/* Designation filter */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1 h-4">
                <Filter className="h-3 w-3" /> Job Role / Designation
              </label>
              <Select value={filterDesignation} onValueChange={setFilterDesignation}>
                <SelectTrigger className="h-10 text-sm rounded-lg">
                  <SelectValue placeholder="All Roles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  {designations.map(d => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Status filter */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1 h-4">
                Status
              </label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="h-10 text-sm rounded-lg">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="In Progress">In Progress</SelectItem>
                  <SelectItem value="Completed">Completed</SelectItem>
                  <SelectItem value="Rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>


          {hasFilters && (
            <Button
              variant="ghost" size="sm"
              onClick={() => { setFilterStage("all"); setFilterStatus("all"); setFilterDesignation("all"); setFilterProject("all"); }}
              className="h-10 gap-1.5 text-xs rounded-lg border shrink-0"
            >
              <XCircle className="h-3.5 w-3.5" /> Clear Filters
            </Button>
          )}
        </div>



      </div>


      {/* ── ROW 1: Summary stats ── */}
      <div>
        <SectionLabel>Candidate Overview</SectionLabel>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Total Candidates" value={stats.total} icon={Users} accent="bg-slate-500" href={buildCandidateLink()} description="All candidates" />
          <StatCard title="InProgress" value={stats.inProgress} icon={Activity} accent="bg-blue-500" href={`${buildCandidateLink()}${buildCandidateLink().includes("?") ? "&" : "?"}active=true`} description="In review or interview" />
          <StatCard
            title="Rejected"
            value={stats.rejected}
            icon={XCircle}
            accent="bg-rose-500"
            href={buildCandidateLink(undefined, undefined, "Rejected")}
            description="Did not proceed"
          />
          <StatCard title="Hired" value={stats.hired} icon={UserCheck} accent="bg-emerald-500" href={buildCandidateLink(undefined, undefined, "Completed")} description="Offer accepted" />
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
                      <Pie
                        data={funnelData} dataKey="value" nameKey="name"
                        innerRadius={55} outerRadius={78} strokeWidth={3}
                        stroke="hsl(var(--background))" paddingAngle={3}
                      >
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
        <Card className="lg:col-span-3 shadow-sm border flex flex-col">
          <CardHeader className="pb-2 pt-5 px-5">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
                  <BarChart3 className="h-4 w-4 text-primary" />
                </div>
                <CardTitle className="text-base font-semibold">Hiring Trend</CardTitle>
                <div className="ml-auto">
                  <Select
                    value={trendRange}
                    onValueChange={(v) => {
                      setTrendRange(v as typeof trendRange);
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs rounded-lg w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1w">Last 1 Week</SelectItem>
                      <SelectItem value="1m">Last 1 Month</SelectItem>
                      <SelectItem value="6m">Last 6 Months</SelectItem>
                      <SelectItem value="custom">Custom Range</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {trendRange === "custom" && (
                <DateRangeFilter
                  fromDate={trendCustomFrom}
                  toDate={trendCustomTo}
                  onFromDateChange={setTrendCustomFrom}
                  onToDateChange={setTrendCustomTo}
                  onClear={handleClearTrendCustomRange}
                  showLabels={false}
                  clearLabel="Clear"
                />
              )}
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5 flex-1 flex flex-col justify-center">
            {isTrendLoading ? (
              <div className="h-[300px] flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <p className="text-xs">Loading trend…</p>
              </div>
            ) : trendChartData.length > 0 ? (
              <ChartContainer config={trendConfig} className="h-[300px] w-full">
                <BarChart data={trendChartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} dy={8} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11 }} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="total" name="Added" fill="var(--color-total)" radius={[3, 3, 0, 0]} barSize={14} />
                  <Bar dataKey="hired" name="Hired" fill="var(--color-hired)" radius={[3, 3, 0, 0]} barSize={14} />
                </BarChart>
              </ChartContainer>
            ) : trendRange === "custom" && !appliedCustomRange ? (
              <div className="h-[300px] flex flex-col items-center justify-center gap-2 text-center">
                <CalendarDays className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground font-medium">Select a From and To date to view the trend.</p>
              </div>
            ) : (
              <div className="h-[300px] flex flex-col items-center justify-center gap-2 text-center">
                <BarChart3 className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground font-medium">No data available for the selected date range.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>


      {/* ── ROW 3: Stage breakdown ── */}
      <div>
        <SectionLabel>Interview Stage Breakdown</SectionLabel>
        <Card className="shadow-sm border">
          <CardContent className="p-5">
            <div className="overflow-x-auto">
              <div className="grid grid-cols-6 gap-4 min-w-[840px]">
                <StageCol title="AI Resume Review" accent="bg-blue-500" items={[
                  { label: "Rejected", count: stats.resumeRejected, dot: "bg-rose-500", href: buildCandidateLink("resume", "rejected") },
                  { label: "On Hold", count: stats.resumeOnHold, dot: "bg-amber-400", href: buildCandidateLink("resume", "on hold") },
                  { label: "Pending", count: stats.resumePending, dot: "bg-slate-400", href: buildCandidateLink("resume", "pending") },
                ]} />
                <StageCol title="AI Screening" accent="bg-emerald-500" items={[
                  { label: "Scheduled", count: stats.screeningScheduled, dot: "bg-cyan-400", href: buildCandidateLink("screening", "scheduled") },
                  { label: "Rejected", count: stats.screeningRejected, dot: "bg-rose-400", href: buildCandidateLink("screening", "rejected") },
                  { label: "On Hold", count: stats.screeningOnHold, dot: "bg-amber-400", href: buildCandidateLink("screening", "on hold") },
                  { label: "Expired", count: stats.screeningExpired, dot: "bg-stone-400", href: buildCandidateLink("screening", "expired") },
                  { label: "Rescheduled", count: stats.screeningRescheduled, dot: "bg-orange-400", href: buildCandidateLink("screening", "Rescheduled") },
                ]} />
                <StageCol title="L1 Interview" accent="bg-violet-500" items={[
                  { label: "Scheduled", count: stats.l1Scheduled, dot: "bg-blue-400", href: buildCandidateLink("l1", "scheduled") },
                  { label: "Rejected", count: stats.l1Rejected, dot: "bg-rose-400", href: buildCandidateLink("l1", "rejected") },
                  { label: "On Hold", count: stats.l1OnHold, dot: "bg-amber-400", href: buildCandidateLink("l1", "on hold") },
                  { label: "Pending", count: stats.l1Pending, dot: "bg-slate-300", href: buildCandidateLink("l1", "pending") },
                ]} />
                <StageCol title="L2 Interview" accent="bg-orange-500" items={[
                  { label: "Scheduled", count: stats.l2Scheduled, dot: "bg-sky-400", href: buildCandidateLink("l2", "scheduled") },
                  { label: "Rejected", count: stats.l2Rejected, dot: "bg-rose-600", href: buildCandidateLink("l2", "rejected") },
                  { label: "On Hold", count: stats.l2OnHold, dot: "bg-amber-400", href: buildCandidateLink("l2", "on hold") },
                  { label: "Pending", count: stats.l2Pending, dot: "bg-slate-300", href: buildCandidateLink("l2", "pending") },
                ]} />
                <StageCol title="HR Round" accent="bg-pink-500" items={[
                  { label: "Scheduled", count: stats.hrScheduled, dot: "bg-amber-300", href: buildCandidateLink("hr", "scheduled") },
                  { label: "Rejected", count: stats.hrRejected, dot: "bg-rose-700", href: buildCandidateLink("hr", "rejected") },
                  { label: "On Hold", count: stats.hrOnHold, dot: "bg-amber-400", href: buildCandidateLink("hr", "on hold") },
                  { label: "Pending", count: stats.hrPending, dot: "bg-slate-300", href: buildCandidateLink("hr", "pending") },
                ]} />
                <StageCol title="Offer Stage" accent="bg-teal-500" items={[
                  { label: "Released", count: stats.offerReleased, dot: "bg-purple-500", href: buildCandidateLink("offer", "released") },
                  { label: "Accepted", count: stats.offerAccepted, dot: "bg-emerald-500", href: buildCandidateLink("offer", "accepted") },
                  { label: "Rejected", count: stats.offerRejected, dot: "bg-rose-500", href: buildCandidateLink("offer", "rejected") },
                  { label: "On Hold", count: stats.offerOnHold, dot: "bg-amber-400", href: buildCandidateLink("offer", "on hold") },
                  { label: "Pending", count: stats.offerPending, dot: "bg-slate-300", href: buildCandidateLink("offer", "pending") },
                ]} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>




      {/* ── ROW 5: Upcoming interviews (Carousel) ── */}
      <div>
        <SectionLabel>Upcoming Interviews (Next 6 Days)</SectionLabel>
        <Card className="shadow-sm border">
          <CardContent className="pt-5 px-3 pb-5">
            {upcoming.length > 0 ? (
              <Carousel opts={{ align: "start" }} className="w-full">
                <CarouselContent className="-ml-3 flex">
                  {upcoming.map(item => (
                    <CarouselItem key={item.id} className="pl-3 basis-full sm:basis-1/2 lg:basis-1/4 xl:basis-1/5">
                      <Link href={`/candidates/${item.candidateId}`} className="block h-full">
                        <div className="h-full p-4 rounded-xl border bg-card hover:bg-muted/30 hover:border-primary/40 transition-all group cursor-pointer">
                          <div className="flex items-start justify-between mb-2.5">
                            <span className="text-xs font-bold text-primary bg-primary/8 px-2 py-0.5 rounded-md">
                              {item.stage}
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
                                {item.isToday ? "Today" : new Date(item.date + "T00:00:00").toLocaleDateString("en-IN", {
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
                            <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">{item.name}</p>
                            <p className="text-[11px] text-muted-foreground truncate">{item.role}</p>
                          </div>
                        </div>
                      </Link>
                    </CarouselItem>
                  ))}
                </CarouselContent>
                {upcoming.length > 4 && (
                  <div className="flex justify-end gap-2 mt-3 pr-1">
                    <CarouselPrevious className="static translate-y-0 h-8 w-8" />
                    <CarouselNext className="static translate-y-0 h-8 w-8" />
                  </div>
                )}
              </Carousel>
            ) : (
              <div className="h-24 flex flex-col items-center justify-center border-2 border-dashed rounded-xl gap-1.5">
                <CalendarDays className="h-5 w-5 text-muted-foreground/30" />
                <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider">
                  No interviews scheduled in the next 6 days
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}