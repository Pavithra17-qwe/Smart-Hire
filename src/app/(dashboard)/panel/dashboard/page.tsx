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
import { type CarouselApi } from "@/components/ui/carousel";
import {
  Carousel, CarouselContent, CarouselItem,
} from "@/components/ui/carousel";
import { ChevronLeft} from "lucide-react";
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  Calendar, Clock, CheckCircle2, ClipboardList, Users,
  Loader2, CalendarDays, ChevronRight, AlertCircle,
  BarChart3, UserCheck, MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── types ────────────────────────────────────────────────────────────────────
// ============================================================================
// ROUND MAPPING — VERIFIED AGAINST candidate/[id]/page.tsx, NOT ASSUMED
//
// The candidate page has three interview-round cards. Their internal field
// prefixes do NOT line up with their UI titles the way you'd guess:
//
//   UI title            field prefix    candidate_history "stage"   panel-assignable?
//   "Screening Round"    l1*             "L1 Interview"               NO  (AI/HR only —
//                                                                          canHRSchedule's
//                                                                          "Assign Panel
//                                                                          Member" dropdown
//                                                                          never renders for
//                                                                          stageKey==='l1')
//   "L1 Technical Round" l2*             "L2 Interview"               YES (real panel round)
//   "L2 Manager Round"   l2Manager*      "L2 Manager Round"           YES (real panel round)
//
// Only l2* and l2Manager* ever get a panel member assigned (the dropdown only
// renders for stageKey 'l2'/'l2manager'). So the l1* round can never be what a
// panel member means by "my L1 interview" — it's an AI screening step nobody
// gets manually assigned to. The two REAL panel-conducted rounds are l2*
// ("L1 Technical Round") and l2Manager* ("L2 Manager Round").
//
// This dashboard's "L1 Interview" / "L2 Interview" round-breakdown therefore
// map to:
//   Dashboard "L1 Interview"  →  l2* fields        (history stage "L2 Interview")
//   Dashboard "L2 Interview"  →  l2Manager* fields  (history stage "L2 Manager Round")
//
// This was the root cause of "L1 shown as L2": the previous version mapped
// l1*→"L1 Interview" / l2*→"L2 Interview", which displayed the real,
// panel-assigned technical round (l2* data) under the "L2 Interview" label.
// ============================================================================
interface Candidate {
  id: string;
  candidateName?: string;
  candidateDesignation?: string;
  finalStatus?: string;

  // "L1 Technical Round" data — this is Dashboard "L1 Interview"
  l2Status?: string; l2ScheduledDate?: string; l2TimeSlot?: string;
  l2PanelUid?: string; l2PanelEmail?: string; l2PanelName?: string;
  l2InterviewerUid?: string; l2InterviewerEmail?: string; // legacy fallback only
  l2Feedback?: string; l2Result?: string;

  // "L2 Manager Round" data — this is Dashboard "L2 Interview"
  l2ManagerStatus?: string; l2ManagerScheduledDate?: string; l2ManagerTimeSlot?: string;
  l2ManagerPanelUid?: string; l2ManagerPanelEmail?: string; l2ManagerPanelName?: string;
  l2ManagerInterviewerUid?: string; l2ManagerInterviewerEmail?: string; // legacy fallback only
  l2ManagerFeedback?: string; l2ManagerResult?: string;

  createdAt?: any;
}

// One entry per action recorded in the `candidate_history` collection. This
// is the ONLY place "who actually selected/rejected/held this candidate" is
// recorded — candidate docs themselves have no l2SelectedBy-style field, so
// counting "Selected by me" from candidate.l2Status alone would count
// anyone currently assigned, not who actually made the call.
interface HistoryRecord {
  candidateId: string;
  stage: string;
  action: string;
  updatedBy: string;
  updatedAt: Date;
}

interface MonthlyData {
  month: string; monthNum: number; year: number;
  conducted: number; selected: number;
}

const trendConfig = {
  conducted: { label: "Conducted", color: "hsl(var(--primary))" },
  selected:  { label: "Selected",  color: "#10B981" },
} satisfies ChartConfig;

const TERMINAL_STATUSES = ["Selected", "Rejected", "On Hold"];

function normalize(s: any): string {
  const v = (s || "").toLowerCase().trim();
  if (v === "selected")  return "Selected";
  if (v === "rejected")  return "Rejected";
  if (v === "scheduled") return "Scheduled";
  if (v === "pending")   return "Pending";
  if (v === "completed") return "Completed";
  if (v === "on hold") return "On Hold";
  return s || "Pending";
}

// Matches the logged-in panel member against an assignment. Primary keys are
// the *Panel* fields (what the scheduling flow actually writes as "who is
// assigned"). Interviewer fields are checked only as a legacy fallback.
function matchesPanelUser(
  panelUidField: string | undefined | null,
  panelEmailField: string | undefined | null,
  interviewerUidField: string | undefined | null,
  interviewerEmailField: string | undefined | null,
  userUid: string,
  userEmail: string
): boolean {
  if (!userUid && !userEmail) return false;
  const uid = userUid?.trim();
  const email = userEmail?.trim().toLowerCase();

  if (panelUidField && uid && panelUidField.trim() === uid) return true;
  if (panelEmailField && email && panelEmailField.trim().toLowerCase() === email) return true;
  if (interviewerUidField && uid && interviewerUidField.trim() === uid) return true;
  if (interviewerEmailField && email && interviewerEmailField.trim().toLowerCase() === email) return true;

  return false;
}

function toDateOnlyStr(value: any): string {
  if (!value) return "";
  if (typeof value === "object" && typeof value.toDate === "function") {
    const d = value.toDate();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  if (typeof value === "string") {
    return value.slice(0, 10);
  }
  return "";
}

function hasFeedback(resultField?: string, feedbackField?: string): boolean {
  return !!(resultField && resultField.trim()) || !!(feedbackField && feedbackField.trim());
}

// ─── Round configs ──────────────────────────────────────────────────────────
// Single source of truth for the L1/L2 field mapping described above. Every
// piece of UI (Round Breakdown counts+links, Upcoming Interviews) is driven
// from these two configs so L1 and L2 are always handled independently and
// identically to each other.
type RoundConfig = {
  label: "L1 Interview" | "L2 Interview";
  historyStage: string;
  statusField: keyof Candidate;
  dateField: keyof Candidate;
  slotField: keyof Candidate;
  panelUidField: keyof Candidate;
  panelEmailField: keyof Candidate;
  interviewerUidField: keyof Candidate;
  interviewerEmailField: keyof Candidate;
  feedbackField: keyof Candidate;
  resultField: keyof Candidate;
};

const ROUND_L1: RoundConfig = {
  label: "L1 Interview",
  historyStage: "L2 Interview", // internal history stage name for the "L1 Technical Round" card
  statusField: "l2Status", dateField: "l2ScheduledDate", slotField: "l2TimeSlot",
  panelUidField: "l2PanelUid", panelEmailField: "l2PanelEmail",
  interviewerUidField: "l2InterviewerUid", interviewerEmailField: "l2InterviewerEmail",
  feedbackField: "l2Feedback", resultField: "l2Result",
};

const ROUND_L2: RoundConfig = {
  label: "L2 Interview",
  historyStage: "L2 Manager Round",
  statusField: "l2ManagerStatus", dateField: "l2ManagerScheduledDate", slotField: "l2ManagerTimeSlot",
  panelUidField: "l2ManagerPanelUid", panelEmailField: "l2ManagerPanelEmail",
  interviewerUidField: "l2ManagerInterviewerUid", interviewerEmailField: "l2ManagerInterviewerEmail",
  feedbackField: "l2ManagerFeedback", resultField: "l2ManagerResult",
};

const SELECT_ACTIONS = ["panel-select", "ai-select"];
const REJECT_ACTIONS = ["panel-reject", "ai-reject"];
const HOLD_ACTIONS   = ["hold"];

// ─── URL builder for candidate history with filters ───────────────────────────
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

// ─── main component ───────────────────────────────────────────────────────────
export default function PanelDashboard() {
  const { user } = useAuth();
  const panelUid   = user?.uid ?? "";
  const panelEmail = user?.email ?? "";
  const router    = useRouter();

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [historyRecords, setHistoryRecords] = useState<HistoryRecord[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [isMounted,  setIsMounted]  = useState(false);

  const [panelCarouselApi, setPanelCarouselApi] = useState<CarouselApi>();
  const [panelCanScrollPrev, setPanelCanScrollPrev] = useState(false);
  const [panelCanScrollNext, setPanelCanScrollNext] = useState(true);

  useEffect(() => {
    if (!panelCarouselApi) return;
    const update = () => {
      setPanelCanScrollPrev(panelCarouselApi.canScrollPrev());
      setPanelCanScrollNext(panelCarouselApi.canScrollNext());
    };
    update();
    panelCarouselApi.on("select", update);
    return () => { panelCarouselApi.off("select", update); };
  }, [panelCarouselApi]);

  useEffect(() => { setIsMounted(true); }, []);

  useEffect(() => {
    if (!panelUid) return;
    const unsub = onSnapshot(collection(db, "candidates"), snap => {
      const all = snap.docs.map(doc => {
        const r = doc.data();
        return {
          id: doc.id, ...r,
          l2Status: normalize(r.l2Status),
          l2ManagerStatus: normalize(r.l2ManagerStatus),
          createdAt: r.createdAt?.toDate?.() || new Date(),
        } as Candidate;
      });
      setCandidates(all);
      setLoading(false);
    });
    return () => unsub();
  }, [panelUid]);

  // NEW: subscribe to candidate_history — the only place "who actually
  // selected/rejected/put on hold" is recorded (see HistoryRecord comment).
  useEffect(() => {
    if (!panelUid) return;
    const unsub = onSnapshot(collection(db, "candidate_history"), snap => {
      const records: HistoryRecord[] = snap.docs.map(d => {
        const r = d.data();
        const updatedAt =
          r.updatedAt?.toDate ? r.updatedAt.toDate() :
          r.updatedAt instanceof Date ? r.updatedAt : new Date(0);
        return {
          candidateId: r.candidateId || "",
          stage: r.stage || "",
          action: r.action || "",
          updatedBy: r.updatedBy || "",
          updatedAt,
        };
      });
      setHistoryRecords(records);
    });
    return () => unsub();
  }, [panelUid]);

  const today    = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = toDateOnlyStr(today);

  // ── Group history by candidate+stage for fast "who last did X" lookups ──
  const historyByCandidateStage = useMemo(() => {
    const map = new Map<string, HistoryRecord[]>();
    historyRecords.forEach(h => {
      const key = `${h.candidateId}|${h.stage}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(h);
    });
    return map;
  }, [historyRecords]);

  function getLastActionUid(candidateId: string, stage: string, actions: string[]): string | undefined {
    const list = historyByCandidateStage.get(`${candidateId}|${stage}`);
    if (!list) return undefined;
    let latest: HistoryRecord | undefined;
    for (const h of list) {
      if (!actions.includes(h.action)) continue;
      if (!latest || h.updatedAt.getTime() > latest.updatedAt.getTime()) latest = h;
    }
    return latest?.updatedBy;
  }

  // ── Round Breakdown: compute exact ID lists per round/status ─────────────
  // Scheduled  → assignment (Panel fields) + status === "Scheduled".
  // Selected   → status === "Selected" AND the most recent select-type action
  //              in candidate_history for this candidate+round was performed
  //              by the logged-in panel member.
  // Rejected   → same, for reject-type actions.
  // On Hold    → same, for hold actions.
  // L1 and L2 are computed from completely independent field sets (ROUND_L1
  // vs ROUND_L2) — L1 status/actions never influence L2 counts or vice versa.
  function computeRoundIds(round: RoundConfig) {
    const scheduled: string[] = [];
    const selected: string[] = [];
    const rejected: string[] = [];
    const onHold: string[] = [];

    candidates.forEach(c => {
      const status = (c as any)[round.statusField];
      const panelUidVal = (c as any)[round.panelUidField];
      const panelEmailVal = (c as any)[round.panelEmailField];
      const interviewerUidVal = (c as any)[round.interviewerUidField];
      const interviewerEmailVal = (c as any)[round.interviewerEmailField];

      const assignedToMe = matchesPanelUser(
        panelUidVal, panelEmailVal, interviewerUidVal, interviewerEmailVal, panelUid, panelEmail
      );

      if (assignedToMe && status === "Scheduled") scheduled.push(c.id);

      if (status === "Selected") {
        const actor = getLastActionUid(c.id, round.historyStage, SELECT_ACTIONS);
        if (actor && actor === panelUid) selected.push(c.id);
      }
      if (status === "Rejected") {
        const actor = getLastActionUid(c.id, round.historyStage, REJECT_ACTIONS);
        if (actor && actor === panelUid) rejected.push(c.id);
      }
      if (status === "On Hold") {
        const actor = getLastActionUid(c.id, round.historyStage, HOLD_ACTIONS);
        if (actor && actor === panelUid) onHold.push(c.id);
      }
    });

    return { scheduled, selected, rejected, onHold };
  }

  const l1RoundIds = useMemo(
    () => computeRoundIds(ROUND_L1),
    [candidates, historyByCandidateStage, panelUid, panelEmail]
  );
  const l2RoundIds = useMemo(
    () => computeRoundIds(ROUND_L2),
    [candidates, historyByCandidateStage, panelUid, panelEmail]
  );

  // ═══════════════════════════════════════════════════════════════════════
  // NOTE: The four cards below (Assigned to Me / Today's Interviews /
  // Pending Feedback / Selected by Me) are UNCHANGED from the previous fix
  // and still use the old l1*/l2* (Screening/Technical) definition of
  // "assigned," per this request's scope ("fix only Upcoming Interviews and
  // Round Breakdown"). This means they are no longer using the same L1/L2
  // definition as Round Breakdown above, which now correctly uses
  // l2*/l2Manager*. Flagging this clearly — happy to bring these in line
  // with the corrected mapping in a follow-up if you'd like them consistent.
  // ═══════════════════════════════════════════════════════════════════════
  const myAssigned = useMemo(() =>
    candidates.filter(c =>
      matchesPanelUser((c as any).l1PanelUid, (c as any).l1PanelEmail, (c as any).l1InterviewerUid, (c as any).l1InterviewerEmail, panelUid, panelEmail) ||
      matchesPanelUser(c.l2PanelUid, c.l2PanelEmail, c.l2InterviewerUid, c.l2InterviewerEmail, panelUid, panelEmail)
    ),
  [candidates, panelUid, panelEmail]);

  const myAssignedIds = useMemo(() => myAssigned.map(c => c.id), [myAssigned]);

  const selectedIds = useMemo(() =>
    myAssigned
      .filter(c =>
        (matchesPanelUser((c as any).l1PanelUid, (c as any).l1PanelEmail, (c as any).l1InterviewerUid, (c as any).l1InterviewerEmail, panelUid, panelEmail) && (c as any).l1Status === "Selected") ||
        (matchesPanelUser(c.l2PanelUid, c.l2PanelEmail, c.l2InterviewerUid, c.l2InterviewerEmail, panelUid, panelEmail) && c.l2Status === "Selected")
      )
      .map(c => c.id),
  [myAssigned, panelUid, panelEmail]);

  const pendingFeedbackIds = useMemo(() =>
    myAssigned
      .filter(c => {
        const l1Date = toDateOnlyStr((c as any).l1ScheduledDate);
        const l1Past =
          matchesPanelUser((c as any).l1PanelUid, (c as any).l1PanelEmail, (c as any).l1InterviewerUid, (c as any).l1InterviewerEmail, panelUid, panelEmail) &&
          !!l1Date && l1Date < todayStr &&
          !TERMINAL_STATUSES.includes((c as any).l1Status ?? "") &&
          !hasFeedback((c as any).l1Result, (c as any).l1Feedback);

        const l2Date = toDateOnlyStr(c.l2ScheduledDate);
        const l2Past =
          matchesPanelUser(c.l2PanelUid, c.l2PanelEmail, c.l2InterviewerUid, c.l2InterviewerEmail, panelUid, panelEmail) &&
          !!l2Date && l2Date < todayStr &&
          !TERMINAL_STATUSES.includes(c.l2Status ?? "") &&
          !hasFeedback(c.l2Result, c.l2Feedback);

        return l1Past || l2Past;
      })
      .map(c => c.id),
  [myAssigned, todayStr, panelUid, panelEmail]);

  const todayIds = useMemo(() =>
    myAssigned
      .filter(c =>
        (matchesPanelUser((c as any).l1PanelUid, (c as any).l1PanelEmail, (c as any).l1InterviewerUid, (c as any).l1InterviewerEmail, panelUid, panelEmail) && (c as any).l1Status === "Scheduled" && toDateOnlyStr((c as any).l1ScheduledDate) === todayStr) ||
        (matchesPanelUser(c.l2PanelUid, c.l2PanelEmail, c.l2InterviewerUid, c.l2InterviewerEmail, panelUid, panelEmail) && c.l2Status === "Scheduled" && toDateOnlyStr(c.l2ScheduledDate) === todayStr)
      )
      .map(c => c.id),
  [myAssigned, todayStr, panelUid, panelEmail]);

  const stats = useMemo(() => ({
    totalAssigned:   myAssigned.length,
    todayCount:      todayIds.length,
    pendingFeedback: pendingFeedbackIds.length,
    totalSelected:   selectedIds.length,
  }), [myAssigned, todayIds, pendingFeedbackIds, selectedIds]);

  // ── Upcoming Interviews / Pending Feedback list ───────────────────────────
  // FIXED: now driven by ROUND_L1 (l2* fields) and ROUND_L2 (l2Manager*
  // fields) — the actual panel-assignable rounds — with labels matching
  // exactly what Round Breakdown uses, so a round can never be mislabeled.
  const { upcomingInterviews, pendingFeedbackList } = useMemo(() => {
    const maxDate = new Date(today);
    maxDate.setDate(today.getDate() + 6);
    maxDate.setHours(23, 59, 59, 999);
    const maxStr = toDateOnlyStr(maxDate);

    const upcomingList: any[] = [], pendingList: any[] = [];

    candidates.forEach(c => {
      [ROUND_L1, ROUND_L2].forEach(round => {
        const ds       = toDateOnlyStr((c as any)[round.dateField]);
        const status   = (c as any)[round.statusField];
        const result   = (c as any)[round.resultField];
        const feedback = (c as any)[round.feedbackField];
        const panelUidVal   = (c as any)[round.panelUidField];
        const panelEmailVal = (c as any)[round.panelEmailField];
        const interviewerUidVal   = (c as any)[round.interviewerUidField];
        const interviewerEmailVal = (c as any)[round.interviewerEmailField];

        const assignedToMe = matchesPanelUser(
          panelUidVal, panelEmailVal, interviewerUidVal, interviewerEmailVal, panelUid, panelEmail
        );
        if (!assignedToMe || !ds || status !== "Scheduled") return;

        const item = {
          id: `${c.id}-${round.label}`,
          candidateId: c.id,
          candidate: c.candidateName || "Unknown",
          round: round.label, // "L1 Interview" or "L2 Interview" — matches Round Breakdown exactly
          date: ds,
          timeSlot: (c as any)[round.slotField] || "",
          isToday: ds === todayStr,
          isPast: ds < todayStr,
          hasResult: hasFeedback(result, feedback),
        };

        if (ds < todayStr && !item.hasResult) {
          pendingList.push(item);
        } else if (ds >= todayStr && ds <= maxStr) {
          upcomingList.push(item);
        }
      });
    });

    return {
      upcomingInterviews:  upcomingList.sort((a, b) => a.date.localeCompare(b.date)),
      pendingFeedbackList: pendingList.sort((a, b) => b.date.localeCompare(a.date)),
    };
  }, [candidates, todayStr, panelUid, panelEmail]);

  // ── Trend chart (unrelated to this fix — left as-is) ──────────────────────
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
      if (matchesPanelUser((c as any).l1PanelUid, (c as any).l1PanelEmail, (c as any).l1InterviewerUid, (c as any).l1InterviewerEmail, panelUid, panelEmail) && ["Selected", "Rejected"].includes((c as any).l1Status ?? "")) {
        months[idx].conducted++;
        if ((c as any).l1Status === "Selected") months[idx].selected++;
      }
      if (matchesPanelUser(c.l2PanelUid, c.l2PanelEmail, c.l2InterviewerUid, c.l2InterviewerEmail, panelUid, panelEmail) && ["Selected", "Rejected"].includes(c.l2Status ?? "")) {
        months[idx].conducted++;
        if (c.l2Status === "Selected") months[idx].selected++;
      }
    });
    return months;
  }, [candidates, panelUid, panelEmail]);

  if (!isMounted || loading) return (
    <div className="h-screen flex items-center justify-center gap-3">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">Loading Panel Dashboard…</p>
    </div>
  );

  return (

<div className="w-full overflow-x-auto min-h-screen">
<div className="min-w-[800px] space-y-6 pb-10">
  

    {/* Live indicator */}
      <div className="flex items-center justify-end">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-3 py-1.5 rounded-full">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse block" />
          Live data
        </div>
      </div>

      {/* ── ROW 1: Summary Stats (unrelated to this fix) ── */}
      <div>
        <SectionLabel>My Interview Overview</SectionLabel>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Assigned to Me"
            value={stats.totalAssigned}
            icon={Users}
            accent="bg-slate-500"
            href={buildHistoryUrl({ panelUid, ids: myAssignedIds.length > 0 ? myAssignedIds.join(",") : "__empty__" })}
            description="Total candidates assigned"
          />
          <StatCard
            title="Today's Interviews"
            value={stats.todayCount}
            icon={Calendar}
            accent="bg-emerald-500"
            href={buildHistoryUrl({ panelUid, ids: todayIds.length > 0 ? todayIds.join(",") : "__empty__" })}
            description="Scheduled for today"
          />
          <StatCard
            title="Pending Feedback"
            value={stats.pendingFeedback}
            icon={AlertCircle}
            accent="bg-amber-500"
            href={buildHistoryUrl({ panelUid, ids: pendingFeedbackIds.length > 0 ? pendingFeedbackIds.join(",") : "__empty__" })}
            description="Feedback not submitted"
            highlight={stats.pendingFeedback > 0}
          />
          <StatCard
            title="Selected by Me"
            value={stats.totalSelected}
            icon={UserCheck}
            accent="bg-indigo-500"
            href={buildHistoryUrl({ panelUid, ids: selectedIds.length > 0 ? selectedIds.join(",") : "__empty__" })}
            description="L1 + L2 combined"
          />
        </div>
      </div>


      {/* ── ROW 2: Round Breakdown + Trend Chart ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* FIXED: Round Breakdown now uses l1RoundIds / l2RoundIds — the
            corrected L1 (l2* fields) / L2 (l2Manager* fields) mapping, with
            Selected/Rejected/On Hold verified against candidate_history so
            only the panel member who actually made the call is counted.
            Every link below passes the exact ids array used for the count,
            so count and Candidate History list can never disagree. */}
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
                    label: "Scheduled", count: l1RoundIds.scheduled.length, dot: "bg-blue-400",
                    href: buildHistoryUrl({ panelUid, round: "L1 Interview", status: "Scheduled", ids: l1RoundIds.scheduled.length > 0 ? l1RoundIds.scheduled.join(",") : "__empty__" }),
                  },
                  {
                    label: "Selected",  count: l1RoundIds.selected.length,  dot: "bg-emerald-500",
                    href: buildHistoryUrl({ panelUid, round: "L1 Interview", status: "Selected", ids: l1RoundIds.selected.length > 0 ? l1RoundIds.selected.join(",") : "__empty__" }),
                  },
                  {
                    label: "Rejected",  count: l1RoundIds.rejected.length,  dot: "bg-rose-500",
                    href: buildHistoryUrl({ panelUid, round: "L1 Interview", status: "Rejected", ids: l1RoundIds.rejected.length > 0 ? l1RoundIds.rejected.join(",") : "__empty__" }),
                  },
                  {
                    label: "On Hold",   count: l1RoundIds.onHold.length,    dot: "bg-amber-400",
                    href: buildHistoryUrl({ panelUid, round: "L1 Interview", status: "On Hold", ids: l1RoundIds.onHold.length > 0 ? l1RoundIds.onHold.join(",") : "__empty__" }),
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
                    label: "Scheduled", count: l2RoundIds.scheduled.length, dot: "bg-sky-400",
                    href: buildHistoryUrl({ panelUid, round: "L2 Interview", status: "Scheduled", ids: l2RoundIds.scheduled.length > 0 ? l2RoundIds.scheduled.join(",") : "__empty__" }),
                  },
                  {
                    label: "Selected",  count: l2RoundIds.selected.length,  dot: "bg-emerald-500",
                    href: buildHistoryUrl({ panelUid, round: "L2 Interview", status: "Selected", ids: l2RoundIds.selected.length > 0 ? l2RoundIds.selected.join(",") : "__empty__" }),
                  },
                  {
                    label: "Rejected",  count: l2RoundIds.rejected.length,  dot: "bg-rose-500",
                    href: buildHistoryUrl({ panelUid, round: "L2 Interview", status: "Rejected", ids: l2RoundIds.rejected.length > 0 ? l2RoundIds.rejected.join(",") : "__empty__" }),
                  },
                  {
                    label: "On Hold",   count: l2RoundIds.onHold.length,    dot: "bg-amber-400",
                    href: buildHistoryUrl({ panelUid, round: "L2 Interview", status: "On Hold", ids: l2RoundIds.onHold.length > 0 ? l2RoundIds.onHold.join(",") : "__empty__" }),
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
          </CardContent>
        </Card>

        {/* Trend chart (unrelated to this fix) */}
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

    {/* ── ROW 4: Upcoming Interviews — Next 6 Days ── */}
    <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
            Upcoming Interviews (Next 6 Days)
          </p>
          {upcomingInterviews.length > 1 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => panelCarouselApi?.scrollPrev()}
                disabled={!panelCanScrollPrev}
                className="h-7 w-7 rounded-full border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => panelCarouselApi?.scrollNext()}
                disabled={!panelCanScrollNext}
                className="h-7 w-7 rounded-full border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
        <Card className="shadow-sm border">
          <CardContent className="pt-5 px-4 pb-5">
            {upcomingInterviews.length > 0 ? (
              <Carousel
                setApi={setPanelCarouselApi}
                opts={{ align: "start", loop: false, slidesToScroll: 1 }}
                className="w-full"
              >
                <CarouselContent className="-ml-3">
                  {upcomingInterviews.map(item => (
                    <CarouselItem key={item.id} className="pl-3 basis-1/4">
                      <Link href={`/candidates/${item.candidateId}`} className="block h-full">
                        <div className="h-full p-4 rounded-xl border bg-card hover:bg-muted/30 hover:border-primary/40 transition-all group cursor-pointer">
                          <div className="flex items-start justify-between mb-2.5">
                            <span className={cn(
                              "text-xs font-bold px-2 py-0.5 rounded-md",
                              item.round === "L1 Interview"
                                ? "text-indigo-700 bg-indigo-100 dark:text-indigo-300 dark:bg-indigo-950/50"
                                : "text-blue-700 bg-blue-100 dark:text-blue-300 dark:bg-blue-950/50"
                            )}>
                              {item.round}
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
                              {item.candidate}
                            </p>
                            <p className="text-[11px] text-muted-foreground truncate">
                              Click to manage interview →
                            </p>
                          </div>
                        </div>
                      </Link>
                    </CarouselItem>
                  ))}
                </CarouselContent>
              </Carousel>
            ) : (
              <div className="h-24 flex flex-col items-center justify-center border-2 border-dashed rounded-xl gap-1.5">
                <CalendarDays className="h-5 w-5 text-muted-foreground/30" />
                <p className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider">
                  No upcoming interviews in the next 6 days
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