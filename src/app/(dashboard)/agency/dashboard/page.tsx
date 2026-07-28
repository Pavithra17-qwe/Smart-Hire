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
  Users, XCircle, CheckCircle2,
  Loader2, ChevronRight,
  BarChart3, TrendingUp,
  CalendarDays, Clock,
  Activity, UserCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── types ─────────────────────────────────────────────────────────────────
// NOTE ON FIELD MAPPING (mirrors HR Dashboard / Candidate History exactly):
//   Screening Status (AI Screening Round) → l1Status
//   L1 Status (L1 Interview)              → l2Status
//   L2 Status (L2 Interview)              → l2ManagerStatus
// This file intentionally uses the SAME mapping the HR Dashboard and
// Candidate History page use, so stage names / counts always agree.
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
  createdBy?: string;
  createdByEmail?: string;
  jobRequisitionId?: string;
  requirementTitle?: string;
  createdAt?: any;
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

// ── Projects HR/Admin created and explicitly assigned to this agency ───────
// (job_requisitions.assignedAgencies array-contains agencyUid). Distinct from
// `requirements`, which the agency itself creates. A candidate's
// jobRequisitionId may point into either collection, so both must be
// resolvable for the project filter dropdown AND for the access-control
// check below.
interface AssignedJobRequisition {
  id: string;
  projectName?: string;
  status?: string;
  assignedAgencies?: string[];
}

interface MonthlyData { month: string; monthNum: number; year: number; submitted: number; selected: number; }

// ─── Agency status vocabulary — dropdown must show ONLY these 3 (per spec) ──
const STATUS_OPTIONS = ["In Progress", "Completed", "Accepted"] as const;

// ─── helpers ────────────────────────────────────────────────────────────────
// Identical to the HR Dashboard's normalize() — every status string coming
// out of Firestore is passed through this before anything else touches it,
// so "Interview Stage Breakdown" / "Hiring Funnel" counts agree exactly.
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

// ─── stage progression helper (COPIED VERBATIM FROM HR DASHBOARD) ──────────
// Determines a candidate's single current stage so they are counted in
// exactly one bucket across the funnel / stage breakdown, instead of every
// stage they have historically passed through. This must stay byte-for-byte
// identical to the HR Dashboard's version — that's what makes the two
// dashboards agree on every count.
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

// ─── chart config ───────────────────────────────────────────────────────────
const trendConfig = {
  submitted: { label: "Submitted", color: "hsl(var(--primary))" },
  selected: { label: "Progressed", color: "#10B981" },
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

function StageCol({
  title, accent, items,
}: {
  title: string; accent: string;
  items: { label: string; count: number; dot: string; href: string }[];
}) {
  return (
    <div className="space-y-2">
      <div className={cn("px-3 py-2 rounded-lg text-center", accent)}>
        <p className="text-[10px] font-black uppercase tracking-widest text-white">{title}</p>
      </div>
      <div className="space-y-1.5">
        {items.map(item => (
          <StageRow key={item.label} label={item.label} count={item.count} dot={item.dot} href={item.href} />
        ))}
      </div>
    </div>
  );
}

// ─── main component ──────────────────────────────────────────────────────────
export default function AgencyDashboard() {
  const { user } = useAuth();
  const router = useRouter();
  const agencyUid = user?.uid ?? "";

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  // HR/Admin-owned projects explicitly assigned to this agency — the
  // second half of the "Agency Project Access → Project ID" rule.
  const [assignedJobReqs, setAssignedJobReqs] = useState<AssignedJobRequisition[]>([]);
  const [filterReqId, setFilterReqId] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => { setIsMounted(true); }, []);

  // ── ACCESS CONTROL LAYER 1: query-level restriction on candidates ────────
  // Firestore itself is asked only for documents this agency submitted
  // (`createdBy === agencyUid`). No other agency's or HR's candidate
  // documents are ever fetched from the backend, so hiding rows in the UI
  // is not what's doing the restricting here — the query is.
  //
  // This layer, and Layer 2 below, are UNCHANGED from before — this fix
  // only touches how counts/labels are DERIVED from the candidates that
  // pass through these two access-control layers, never which candidates
  // are allowed through.
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
    // ── ACCESS CONTROL LAYER 2: project-access restriction ─────────────────
    const assignedJRQuery = query(
      collection(db, "job_requisitions"),
      where("assignedAgencies", "array-contains", agencyUid)
    );

    let candLoaded = false, reqLoaded = false, jrLoaded = false;
    const checkDone = () => { if (candLoaded && reqLoaded && jrLoaded) setLoading(false); };

    const unsub1 = onSnapshot(candQuery, snap => {
      setCandidates(snap.docs.map(doc => {
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
          createdAt: r.createdAt?.toDate?.() || new Date(),
        } as Candidate;
      }));
      candLoaded = true; checkDone();
    });

    const unsub2 = onSnapshot(reqQuery, snap => {
      setRequirements(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Requirement)));
      reqLoaded = true; checkDone();
    });

    const unsub3 = onSnapshot(assignedJRQuery, snap => {
      setAssignedJobReqs(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as AssignedJobRequisition)));
      jrLoaded = true; checkDone();
    });

    return () => { unsub1(); unsub2(); unsub3(); };
  }, [agencyUid]);

  // ── Set of project ids this agency is authorized to see, spanning both
  // collections a candidate's jobRequisitionId could point into ───────────
  const accessibleProjectIds = useMemo(() => {
    const ids = new Set<string>();
    requirements.forEach(r => ids.add(r.id));
    assignedJobReqs.forEach(jr => ids.add(jr.id));
    return ids;
  }, [requirements, assignedJobReqs]);

  // Combined list for the "Filter by Requirement / Project" dropdown —
  // only projects this agency actually has access to.
  const myProjects = useMemo(() => {
    const fromRequirements = requirements.map(r => ({ id: r.id, label: r.title || r.projectName || r.id }));
    const fromAssigned = assignedJobReqs.map(jr => ({ id: jr.id, label: jr.projectName || jr.id }));
    return [...fromRequirements, ...fromAssigned];
  }, [requirements, assignedJobReqs]);

  // ── Candidates this agency created AND whose project (if any) it still
  // has access to. A candidate with no jobRequisitionId is kept — they're
  // still this agency's own submission. This is the layer that protects
  // against a candidate lingering after the agency's project access is
  // revoked, even though createdBy already narrowed the Firestore query. ──
  const scopedCandidates = useMemo(() => {
    return candidates.filter(c => !c.jobRequisitionId || accessibleProjectIds.has(c.jobRequisitionId));
  }, [candidates, accessibleProjectIds]);

  // ── filtered candidates ───────────────────────────────────────────────────
  // This is the ONE list every section below reads from (Stage Breakdown,
  // Hiring Funnel, Submission Trend, Upcoming Interviews, Summary cards,
  // candidate lists) — so the "authorized agency candidates" restriction is
  // applied consistently everywhere, exactly like the acceptance criteria
  // requires.
  const filtered = useMemo(() => {
    return scopedCandidates.filter(c => {
      if (filterReqId !== "all" && c.jobRequisitionId !== filterReqId) return false;
      if (filterStatus !== "all") {
        // Status dropdown is restricted to In Progress / Completed / Accepted.
        // "Accepted" reads from offerStatus (the field that actually carries
        // that value); the other two read finalStatus directly.
        if (filterStatus === "Accepted") {
          if (c.offerStatus !== "Accepted") return false;
        } else if (c.finalStatus !== filterStatus) {
          return false;
        }
      }
      return true;
    });
  }, [scopedCandidates, filterReqId, filterStatus]);

  // ── Per-candidate current-stage progress (SAME derivation as HR Dashboard),
  // computed once over the agency-scoped `filtered` list and reused by both
  // the Stage Breakdown and the Hiring Funnel below. ─────────────────────────
  const progress = useMemo(() => filtered.map(getCandidateProgress), [filtered]);

  // ── stats — mirrors the HR Dashboard's stats block exactly, just scoped
  // to `filtered` (agency-authorized candidates) instead of all candidates ──
  const stats = useMemo(() => {
    const resumeRejected = progress.filter(p => p.currentKey === "resume" && p.currentStatus === "Rejected").length;
    const resumeOnHold = progress.filter(p => p.currentKey === "resume" && p.currentStatus === "On Hold").length;
    const resumePending = progress.filter(p => p.currentKey === "resume" && p.currentStatus === "Pending").length;

    const screeningScheduled = progress.filter(p => p.currentKey === "screening" && p.currentStatus === "Scheduled").length;
    const screeningRescheduled = progress.filter(p => p.currentKey === "screening" && p.currentStatus === "Rescheduled").length;
    const screeningRejected = progress.filter(p => p.currentKey === "screening" && p.currentStatus === "Rejected").length;
    const screeningOnHold = progress.filter(p => p.currentKey === "screening" && p.currentStatus === "On Hold").length;
    const screeningExpired = progress.filter(p => p.currentKey === "screening" && p.currentStatus === "Expired").length;

    const l1Scheduled = progress.filter(p => p.currentKey === "l1" && p.currentStatus === "Scheduled").length;
    const l1Rejected = progress.filter(p => p.currentKey === "l1" && p.currentStatus === "Rejected").length;
    const l1OnHold = progress.filter(p => p.currentKey === "l1" && p.currentStatus === "On Hold").length;
    const l1Pending = progress.filter(p => p.currentKey === "l1" && p.currentStatus === "Pending").length;

    const l2Scheduled = progress.filter(p => p.currentKey === "l2" && p.currentStatus === "Scheduled").length;
    const l2Rejected = progress.filter(p => p.currentKey === "l2" && p.currentStatus === "Rejected").length;
    const l2OnHold = progress.filter(p => p.currentKey === "l2" && p.currentStatus === "On Hold").length;
    const l2Pending = progress.filter(p => p.currentKey === "l2" && p.currentStatus === "Pending").length;

    const hrScheduled = progress.filter(p => p.currentKey === "hr" && p.currentStatus === "Scheduled").length;
    const hrRejected = progress.filter(p => p.currentKey === "hr" && p.currentStatus === "Rejected").length;
    const hrOnHold = progress.filter(p => p.currentKey === "hr" && p.currentStatus === "On Hold").length;
    const hrPending = progress.filter(p => p.currentKey === "hr" && p.currentStatus === "Pending").length;

    const offerPending = progress.filter(p => p.currentKey === "offer" && p.currentStatus === "Pending").length;
    const offerReleasedRaw = progress.filter(p => p.currentKey === "offer" && p.currentStatus === "Released").length;
    const offerAccepted = progress.filter(p => p.currentKey === "offer" && p.currentStatus === "Accepted").length;
    const offerRejected = progress.filter(p => p.currentKey === "offer" && p.currentStatus === "Rejected").length;
    const offerOnHold = progress.filter(p => p.currentKey === "offer" && p.currentStatus === "On Hold").length;

    return {
      total: filtered.length,
      inProgress: filtered.filter(c => c.finalStatus === "In Progress").length,
      completed: filtered.filter(c => c.finalStatus === "Completed").length,
      accepted: filtered.filter(c => c.offerStatus === "Accepted").length,
      hired: filtered.filter(c => c.finalStatus === "Completed").length,
      rejected: filtered.filter(c => c.finalStatus === "Rejected").length,

      // ── Stage Breakdown (current stage only — same derivation as HR) ────
      resumeRejected, resumeOnHold, resumePending,
      screeningScheduled, screeningRescheduled, screeningRejected, screeningOnHold, screeningExpired,
      l1Scheduled, l1Rejected, l1OnHold, l1Pending,
      l2Scheduled, l2Rejected, l2OnHold, l2Pending,
      hrScheduled, hrRejected, hrOnHold, hrPending,
      offerPending, offerReleased: offerReleasedRaw, offerAccepted, offerRejected, offerOnHold,

      // ── Hiring Funnel counts (same combined-field logic as HR Dashboard) ─
      // Resume Reviewed = every candidate who has entered the AI Screening
      // stage, regardless of screening outcome.
      resumeAccepted: screeningScheduled + screeningOnHold + screeningExpired + screeningRescheduled,
      screeningSelected: l1Scheduled + l1OnHold + l1Pending,
      l1Selected: l2Scheduled + l2OnHold + l2Pending,
      l2Selected: hrScheduled + hrOnHold + hrPending,
      hrSelected: offerReleasedRaw + offerOnHold + offerPending,
      offerReleasedFunnel: offerAccepted,
    };
  }, [filtered, progress]);

  // ── Hiring Funnel (was "Pipeline Progress") ─────────────────────────────
  const funnelData = useMemo(() => [
    { name: "Resume Reviewed", value: stats.resumeAccepted, fill: "#6366F1" },
    { name: "Screening Round Selected", value: stats.screeningSelected, fill: "#14B8A6" },
    { name: "L1 Round Selected", value: stats.l1Selected, fill: "#3B82F6" },
    { name: "L2 Round Selected", value: stats.l2Selected, fill: "#F59E0B" },
    { name: "HR Round Selected", value: stats.hrSelected, fill: "#EC4899" },
    { name: "Offer Accepted", value: stats.offerReleasedFunnel, fill: "#8B5CF6" },
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
        if (c.finalStatus === "Completed") {
          months[idx].selected++;
        }
      }
    });
    return months;
  }, [filtered]);

  // ── Upcoming interviews (next 6 days) ────────────────────────────────────
  // FIX: previously used l1ScheduledDate/l1Status and labeled it "L1
  // Interview" — but l1Status is the AI SCREENING field, not the L1
  // technical round. Per the field mapping used everywhere else in this
  // system (HR Dashboard / Candidate History):
  //   l2Status        → the actual L1 Interview round
  //   l2ManagerStatus → the actual L2 Interview round
  // so this now reads the correct field for each label, and pulls the round
  // straight from the actual scheduled-interview record (per-round status +
  // date), not from any single "overall stage" value.
  const upcoming = useMemo(() => {
    const list: any[] = [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split("T")[0];

    const maxDate = new Date(today);
    maxDate.setDate(today.getDate() + 6);
    const maxStr = maxDate.toISOString().split("T")[0];

    filtered.forEach(c => {
      [
        { key: "l1", label: "L1 Interview", df: "l2ScheduledDate", sf: "l2TimeSlot", st: "l2Status" },
        { key: "l2", label: "L2 Interview", df: "l2ManagerScheduledDate", sf: "l2ManagerTimeSlot", st: "l2ManagerStatus" },
        { key: "hr", label: "HR Round", df: "hrScheduledDate", sf: "hrTimeSlot", st: "hrStatus" },
      ].forEach(({ key, label, df, sf, st }) => {
        const ds = (c as any)[df];

        if ((c as any)[st] === "Scheduled" && ds && ds >= todayStr && ds <= maxStr) {
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

  // ── Makes every "View candidates" link respect the currently selected
  // Requirement/Project filter, so e.g. picking "Selenium" and clicking a
  // card only shows Selenium's candidates instead of every candidate.
  //
  // Candidate History filters by PROJECT NAME (?project=...), matched via
  // jobRequisitions[candidate.jobRequisitionId] === urlProject — it has no
  // concept of a requirement id. So we resolve filterReqId (the id) back to
  // its display name from myProjects (the same {id, label} list the
  // dropdown itself renders) before appending it, rather than sending the
  // id itself.
  const selectedProjectName = useMemo(() => {
    if (filterReqId === "all") return null;
    return myProjects.find(p => p.id === filterReqId)?.label ?? null;
  }, [filterReqId, myProjects]);

  const withRequirementFilter = (href: string) => {
    if (!selectedProjectName) return href;
    const separator = href.includes("?") ? "&" : "?";
    return `${href}${separator}project=${encodeURIComponent(selectedProjectName)}`;
  };

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
                  {myProjects.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
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
                  {STATUS_OPTIONS.map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
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
            <span className="font-semibold text-foreground">{scopedCandidates.length}</span> your candidates
          </p>
        )}
      </div>

      {/* ── ROW 1: Stat cards ── */}
      <div>
        <SectionLabel>My Candidate Overview</SectionLabel>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Total Submitted" value={stats.total}
            icon={Users} accent="bg-slate-500"
            href={withRequirementFilter("/candidates/history")} description="Candidates you added"
          />
          <StatCard
            title="In Progress" value={stats.inProgress}
            icon={Activity} accent="bg-blue-500"
            href={withRequirementFilter("/candidates/history?stage=final&status=In%20Progress")}
            description="Currently in pipeline"
          />
          <StatCard
            title="Rejected" value={stats.rejected}
            icon={XCircle} accent="bg-rose-500"
            href={withRequirementFilter("/candidates/history?stage=final&status=Rejected")}
            description="Did not proceed"
          />
          <StatCard
            title="Accepted" value={stats.accepted}
            icon={CheckCircle2} accent="bg-violet-500"
            href={withRequirementFilter("/candidates/history?stage=offer&status=accepted")}
            description="Offer accepted"
          />
        </div>
      </div>

      {/* ── ROW 2: Hiring Funnel + Trend chart ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Hiring Funnel (2/5) — was "Pipeline Progress" */}
        <Card className="lg:col-span-2 shadow-sm border">
          <CardHeader className="pb-2 pt-5 px-5">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
                <TrendingUp className="h-4 w-4 text-primary" />
              </div>
              <CardTitle className="text-base font-semibold">Hiring Funnel</CardTitle>
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
                            <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 18} className="fill-muted-foreground text-[9px] font-bold uppercase tracking-widest">pipeline</tspan>
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
                  <Link href="/candidates/evaluation">Add your first candidate</Link>
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
                <Bar dataKey="submitted" name="Submitted" fill="var(--color-submitted)" radius={[3, 3, 0, 0]} barSize={14} />
                <Bar dataKey="selected" name="Progressed" fill="var(--color-selected)" radius={[3, 3, 0, 0]} barSize={14} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

      </div>

      {/* ── ROW 3: Candidate Stage Breakdown ── */}
      {/* Column order per spec: AI Screening Round | Resume Review |
          L1 Interview | L2 Interview | HR Round | Offer Stage */}
      <div>
        <SectionLabel>Candidate Stage Breakdown</SectionLabel>
        <Card className="shadow-sm border">
          <CardContent className="p-5">
            <div className="overflow-x-auto">
              <div className="grid grid-cols-6 gap-4 min-w-[960px]">

              <StageCol title="Resume Review" accent="bg-blue-500" items={[
                  { label: "Rejected", count: stats.resumeRejected, dot: "bg-rose-500", href: withRequirementFilter("/candidates/history?stage=resume&status=rejected") },
                  { label: "On Hold", count: stats.resumeOnHold, dot: "bg-amber-400", href: withRequirementFilter("/candidates/history?stage=resume&status=on hold") },
                  { label: "Pending", count: stats.resumePending, dot: "bg-slate-400", href: withRequirementFilter("/candidates/history?stage=resume&status=pending") },
                ]} />

                <StageCol title="AI Screening Round" accent="bg-emerald-500" items={[
                  { label: "Scheduled", count: stats.screeningScheduled, dot: "bg-cyan-400", href: withRequirementFilter("/candidates/history?stage=screening&status=scheduled") },
                  { label: "Rejected", count: stats.screeningRejected, dot: "bg-rose-400", href: withRequirementFilter("/candidates/history?stage=screening&status=rejected") },
                  { label: "On Hold", count: stats.screeningOnHold, dot: "bg-amber-400", href: withRequirementFilter("/candidates/history?stage=screening&status=on hold") },
                  { label: "Expired", count: stats.screeningExpired, dot: "bg-stone-400", href: withRequirementFilter("/candidates/history?stage=screening&status=expired") },
                  { label: "Rescheduled", count: stats.screeningRescheduled, dot: "bg-orange-400", href: withRequirementFilter("/candidates/history?stage=screening&status=Rescheduled") },
                ]} />

                <StageCol title="L1 Interview" accent="bg-violet-500" items={[
                  { label: "Scheduled", count: stats.l1Scheduled, dot: "bg-blue-400", href: withRequirementFilter("/candidates/history?stage=l1&status=scheduled") },
                  { label: "Rejected", count: stats.l1Rejected, dot: "bg-rose-400", href: withRequirementFilter("/candidates/history?stage=l1&status=rejected") },
                  { label: "On Hold", count: stats.l1OnHold, dot: "bg-amber-400", href: withRequirementFilter("/candidates/history?stage=l1&status=on hold") },
                  { label: "Pending", count: stats.l1Pending, dot: "bg-slate-300", href: withRequirementFilter("/candidates/history?stage=l1&status=pending") },
                ]} />

                <StageCol title="L2 Interview" accent="bg-orange-500" items={[
                  { label: "Scheduled", count: stats.l2Scheduled, dot: "bg-sky-400", href: withRequirementFilter("/candidates/history?stage=l2&status=scheduled") },
                  { label: "Rejected", count: stats.l2Rejected, dot: "bg-rose-600", href: withRequirementFilter("/candidates/history?stage=l2&status=rejected") },
                  { label: "On Hold", count: stats.l2OnHold, dot: "bg-amber-400", href: withRequirementFilter("/candidates/history?stage=l2&status=on hold") },
                  { label: "Pending", count: stats.l2Pending, dot: "bg-slate-300", href: withRequirementFilter("/candidates/history?stage=l2&status=pending") },
                ]} />

                <StageCol title="HR Round" accent="bg-pink-500" items={[
                  { label: "Scheduled", count: stats.hrScheduled, dot: "bg-amber-300", href: withRequirementFilter("/candidates/history?stage=hr&status=scheduled") },
                  { label: "Rejected", count: stats.hrRejected, dot: "bg-rose-700", href: withRequirementFilter("/candidates/history?stage=hr&status=rejected") },
                  { label: "On Hold", count: stats.hrOnHold, dot: "bg-amber-400", href: withRequirementFilter("/candidates/history?stage=hr&status=on hold") },
                  { label: "Pending", count: stats.hrPending, dot: "bg-slate-300", href: withRequirementFilter("/candidates/history?stage=hr&status=pending") },
                ]} />

                <StageCol title="Offer Stage" accent="bg-teal-500" items={[
                  { label: "Released", count: stats.offerReleased, dot: "bg-purple-500", href: withRequirementFilter("/candidates/history?stage=offer&status=released") },
                  { label: "Accepted", count: stats.offerAccepted, dot: "bg-emerald-500", href: withRequirementFilter("/candidates/history?stage=offer&status=accepted") },
                  { label: "Rejected", count: stats.offerRejected, dot: "bg-rose-500", href: withRequirementFilter("/candidates/history?stage=offer&status=rejected") },
                  { label: "On Hold", count: stats.offerOnHold, dot: "bg-amber-400", href: withRequirementFilter("/candidates/history?stage=offer&status=on hold") },
                  { label: "Pending", count: stats.offerPending, dot: "bg-slate-300", href: withRequirementFilter("/candidates/history?stage=offer&status=pending") },
                ]} />

              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── ROW 4: Upcoming interviews ── */}
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
                              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                <CalendarDays className="h-3 w-3 text-primary shrink-0" />
                                <span>
                                  {item.isToday
                                    ? "Today"
                                    : new Date(item.date + "T00:00:00").toLocaleDateString("en-IN", {
                                        day: "2-digit",
                                        month: "short",
                                        year: "numeric",
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