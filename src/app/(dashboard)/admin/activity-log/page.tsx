"use client";

import { useState, useMemo, useEffect } from "react";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Search, Activity, ChevronLeft, ChevronRight,
  ChevronsLeft, ChevronsRight, XCircle, Loader2,
  Users, UserCheck, Briefcase, ClipboardList, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

type Stage = "Candidate" | "Resume Review" | "L1" | "L2" | "HR" | "Offer" | "Job" | "User";

// ─── Action types — must match Firestore exactly ──────────────────────────────

const ACTION_TYPES: { label: string; stage: Stage }[] = [
  { label: "Candidate Uploaded",       stage: "Candidate"     },
  { label: "Candidate Created",        stage: "Candidate"     },
  { label: "Resume Review Accepted",   stage: "Resume Review" },
  { label: "Resume Review Rejected",   stage: "Resume Review" },
  { label: "L1 Interview Scheduled",   stage: "L1"            },
  { label: "L1 Selected",              stage: "L1"            },
  { label: "L1 Rejected",              stage: "L1"            },
  { label: "L2 Interview Scheduled",   stage: "L2"            },
  { label: "L2 Selected",              stage: "L2"            },
  { label: "L2 Rejected",              stage: "L2"            },
  { label: "HR Interview Scheduled",   stage: "HR"            },
  { label: "HR Selected",              stage: "HR"            },
  { label: "HR Rejected",              stage: "HR"            },
  { label: "Offer Released",           stage: "Offer"         },
  { label: "Offer Accepted",           stage: "Offer"         },
  { label: "Offer Rejected",           stage: "Offer"         },
  { label: "Job Requisition Created",  stage: "Job"           },
  { label: "User Created",             stage: "User"          },
  { label: "User Updated",             stage: "User"          },
];

const ACTION_TO_STAGE: Record<string, Stage> = Object.fromEntries(
  ACTION_TYPES.map(a => [a.label, a.stage])
);

const ROLES = ["admin", "hr", "agency", "panel"] as const;

// Month options for the date filter dropdown
const MONTHS = [
  { label: "January",   value: "01" },
  { label: "February",  value: "02" },
  { label: "March",     value: "03" },
  { label: "April",     value: "04" },
  { label: "May",       value: "05" },
  { label: "June",      value: "06" },
  { label: "July",      value: "07" },
  { label: "August",    value: "08" },
  { label: "September", value: "09" },
  { label: "October",   value: "10" },
  { label: "November",  value: "11" },
  { label: "December",  value: "12" },
];

// Build year options: current year and 2 years back
const THIS_YEAR = new Date().getFullYear();
const YEARS = [THIS_YEAR, THIS_YEAR - 1, THIS_YEAR - 2].map(y => String(y));

// ─── Colour maps ──────────────────────────────────────────────────────────────

const ACTION_DOT: Record<string, string> = {
  "Candidate Uploaded":      "bg-green-500",
  "Candidate Created":       "bg-green-500",
  "Resume Review Accepted":  "bg-green-400",
  "Resume Review Rejected":  "bg-red-400",
  "L1 Interview Scheduled":  "bg-blue-300",
  "L1 Selected":             "bg-green-500",
  "L1 Rejected":             "bg-red-500",
  "L2 Interview Scheduled":  "bg-blue-400",
  "L2 Selected":             "bg-green-500",
  "L2 Rejected":             "bg-red-500",
  "HR Interview Scheduled":  "bg-purple-400",
  "HR Selected":             "bg-green-500",
  "HR Rejected":             "bg-red-500",
  "Offer Released":          "bg-orange-400",
  "Offer Accepted":          "bg-green-600",
  "Offer Rejected":          "bg-red-600",
  "Job Requisition Created": "bg-blue-600",
  "User Created":            "bg-teal-500",
  "User Updated":            "bg-teal-400",
};

const STAGE_CLS: Record<Stage, string> = {
  "Candidate":     "bg-green-50  text-green-700  border-green-200",
  "Resume Review": "bg-yellow-50 text-yellow-700 border-yellow-200",
  "L1":            "bg-blue-50   text-blue-700   border-blue-200",
  "L2":            "bg-indigo-50 text-indigo-700 border-indigo-200",
  "HR":            "bg-purple-50 text-purple-700 border-purple-200",
  "Offer":         "bg-orange-50 text-orange-700 border-orange-200",
  "Job":           "bg-gray-50   text-gray-700   border-gray-200",
  "User":          "bg-teal-50   text-teal-700   border-teal-200",
};

const ROLE_CLS: Record<string, string> = {
  admin:  "bg-gray-100   text-gray-700   border-gray-300",
  hr:     "bg-blue-100   text-blue-700   border-blue-200",
  agency: "bg-purple-100 text-purple-700 border-purple-200",
  panel:  "bg-indigo-100 text-indigo-700 border-indigo-200",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getStage    = (a: string): Stage => ACTION_TO_STAGE[a] ?? "Candidate";
const getDot      = (a: string)        => ACTION_DOT[a]      ?? "bg-gray-400";
const getStageCls = (s: Stage)         => STAGE_CLS[s]       ?? "bg-gray-50 text-gray-600 border-gray-200";
const getRoleCls  = (r: string)        => ROLE_CLS[r?.toLowerCase()] ?? "bg-gray-100 text-gray-700 border-gray-300";
const isCandidate = (s: Stage)         => ["Candidate","Resume Review","L1","L2","HR","Offer"].includes(s);

const INITIAL = { search: "", role: "all", action: "all", month: "all", year: "all" };

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ActivityLogPage() {
  const [logs,    setLogs]    = useState<any[]>([]);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [f,       setF]       = useState(INITIAL);
  const [page,    setPage]    = useState(1);
  const [perPage, setPerPage] = useState(10);

  // single setter — resets page to 1 on every filter change
  const set = (key: keyof typeof INITIAL, val: string) =>
    setF(prev => ({ ...prev, [key]: val }));

  // ── Firestore listener ────────────────────────────────────────────────────
  useEffect(() => {
    setMounted(true);
    const q = query(collection(db, "activity_log"), orderBy("createdAt", "desc"));
    return onSnapshot(q,
      snap => { setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); },
      err  => { console.error(err); setLoading(false); }
    );
  }, []);

  // ── Stats (always from full logs, not filtered) ────────────────────────────
  const stats = useMemo(() => ({
    total:  logs.length,
    hr:     logs.filter(l => l.userRole?.toLowerCase() === "hr").length,
    agency: logs.filter(l => l.userRole?.toLowerCase() === "agency").length,
    panel:  logs.filter(l => l.userRole?.toLowerCase() === "panel").length,
  }), [logs]);

  // ── Filter ────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = f.search.toLowerCase().trim();

    return logs.filter(log => {
      const logDate: Date | undefined = log.createdAt?.toDate?.();
      const logMonth = logDate ? String(logDate.getMonth() + 1).padStart(2, "0") : "";
      const logYear  = logDate ? String(logDate.getFullYear()) : "";

      const okSearch =
        !q ||
        (log.userName      || "").toLowerCase().includes(q) ||
        (log.candidateName || "").toLowerCase().includes(q) ||
        (log.targetName    || "").toLowerCase().includes(q);

      const okRole   = f.role   === "all" || (log.userRole || "").toLowerCase() === f.role;
      const okAction = f.action === "all" || (log.action   || "")               === f.action;
      const okMonth  = f.month  === "all" || logMonth === f.month;
      const okYear   = f.year   === "all" || logYear  === f.year;

      return okSearch && okRole && okAction && okMonth && okYear;
    });
  }, [logs, f]);

  // ── Pagination ────────────────────────────────────────────────────────────
  const total      = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  // clamp page when filters shrink results
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * perPage;
  const pageRows = filtered.slice(startIdx, startIdx + perPage);

  const hasFilters = Object.keys(INITIAL).some(k => f[k as keyof typeof INITIAL] !== INITIAL[k as keyof typeof INITIAL]);

  const clearAll = () => { setF({ ...INITIAL }); setPage(1); };

  const fmtDate = (ts: any) => {
    if (!mounted || !ts) return "—";
    try { return format(ts.toDate(), "dd MMM yyyy, hh:mm a"); }
    catch { return "—"; }
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-6 space-y-4">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Activity Log</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Every action taken across the hiring pipeline — in real time.
        </p>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard title="Total Actions"  value={stats.total}  accent="border-l-gray-400"   icon={<Activity  className="h-4 w-4 text-gray-400"   />} />
        <MetricCard title="HR Actions"     value={stats.hr}     accent="border-l-blue-400"   icon={<UserCheck className="h-4 w-4 text-blue-500"   />} />
        <MetricCard title="Agency Actions" value={stats.agency} accent="border-l-purple-400" icon={<Briefcase className="h-4 w-4 text-purple-500" />} />
        <MetricCard title="Panel Actions"  value={stats.panel}  accent="border-l-indigo-400" icon={<Users     className="h-4 w-4 text-indigo-500" />} />
      </div>

      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      <Card className="shadow-sm">
        <CardContent className="p-3">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">

            {/* Search */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Search</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="User or candidate..."
                  className="pl-8 h-8 text-sm"
                  value={f.search}
                  onChange={e => set("search", e.target.value)}
                />
              </div>
            </div>

            {/* Role */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Role</label>
              <Select value={f.role} onValueChange={v => set("role", v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All Roles" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  {ROLES.map(r => (
                    <SelectItem key={r} value={r}>
                      {r.charAt(0).toUpperCase() + r.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Action Type */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Action Type</label>
              <Select value={f.action} onValueChange={v => set("action", v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All Actions" /></SelectTrigger>
                <SelectContent className="max-h-72 overflow-y-auto">
                  <SelectItem value="all">All Actions</SelectItem>
                  {(["Candidate","Resume Review","L1","L2","HR","Offer","Job","User"] as Stage[]).map(stage => {
                    const acts = ACTION_TYPES.filter(a => a.stage === stage);
                    if (!acts.length) return null;
                    return (
                      <div key={stage}>
                        <p className="px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider bg-muted/50">
                          {stage}
                        </p>
                        {acts.map(a => (
                          <SelectItem key={a.label} value={a.label} className="pl-5 text-sm">
                            {a.label}
                          </SelectItem>
                        ))}
                      </div>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            {/* Month */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Month</label>
              <Select value={f.month} onValueChange={v => set("month", v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All Months" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Months</SelectItem>
                  {MONTHS.map(m => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Year */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Year</label>
              <Select value={f.year} onValueChange={v => set("year", v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All Years" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Years</SelectItem>
                  {YEARS.map(y => (
                    <SelectItem key={y} value={y}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Active filter chips + clear */}
          {hasFilters && (
            <div className="mt-3 pt-2.5 border-t flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                {f.search  !== ""    && <Chip label={`"${f.search}"`}  onRemove={() => set("search", "")}   />}
                {f.role    !== "all" && <Chip label={f.role}           onRemove={() => set("role",   "all")} />}
                {f.action  !== "all" && <Chip label={f.action}         onRemove={() => set("action", "all")} />}
                {f.month   !== "all" && <Chip label={MONTHS.find(m => m.value === f.month)?.label ?? f.month} onRemove={() => set("month", "all")} />}
                {f.year    !== "all" && <Chip label={f.year}           onRemove={() => set("year",  "all")} />}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">{total}</span> result{total !== 1 ? "s" : ""}
                </span>
                <Button variant="ghost" size="sm" onClick={clearAll}
                  className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2">
                  <XCircle className="h-3.5 w-3.5" /> Clear all
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Table ────────────────────────────────────────────────────────────── */}
      <div className="rounded-lg border shadow-sm overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50 hover:bg-gray-50">
                <TableHead className="h-9 px-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider w-[155px]">User</TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider w-[150px]">Candidate</TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider w-[105px]">Stage</TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Action</TableHead>
                <TableHead className="h-9 px-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider w-[155px]">Date & Time</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-28 text-center">
                    <Loader2 className="h-4 w-4 animate-spin inline-block mr-1.5 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Loading…</span>
                  </TableCell>
                </TableRow>
              ) : pageRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-28 text-center text-muted-foreground">
                    <ClipboardList className="mx-auto h-7 w-7 text-gray-300 mb-1.5" />
                    <p className="text-sm">No activities found</p>
                    {hasFilters && (
                      <button onClick={clearAll} className="text-xs text-blue-600 hover:underline mt-1">
                        Clear filters
                      </button>
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map((log, idx) => {
                  const stage    = getStage(log.action);
                  const candName = log.candidateName || log.targetName;
                  const candId   = log.candidateId   || log.targetId;
                  const showLink = isCandidate(stage) && !!candId;

                  return (
                    <TableRow
                      key={log.id}
                      className={cn(
                        "border-b last:border-0 hover:bg-blue-50/20 transition-colors",
                        idx % 2 !== 0 && "bg-gray-50/30"
                      )}
                    >
                      {/* User */}
                      <TableCell className="px-3 py-2 align-middle">
                        <div className="text-sm font-medium leading-snug">{log.userName || "N/A"}</div>
                        <span className={cn(
                          "inline-block text-[10px] px-1.5 py-px rounded-full capitalize font-semibold border mt-0.5",
                          getRoleCls(log.userRole)
                        )}>
                          {log.userRole || "—"}
                        </span>
                      </TableCell>

                      {/* Candidate */}
                      <TableCell className="px-3 py-2 align-middle">
                        {showLink ? (
                          <Link
                            href={`/candidates/${candId}`}
                            className="group inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline hover:text-blue-800"
                          >
                            {candName}
                            <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 flex-shrink-0" />
                          </Link>
                        ) : (
                          <span className="text-sm">{candName || "—"}</span>
                        )}
                        {log.targetType && (
                          <div className="text-[10px] text-muted-foreground capitalize mt-0.5">{log.targetType}</div>
                        )}
                      </TableCell>

                      {/* Stage */}
                      <TableCell className="px-3 py-2 align-middle">
                        <span className={cn(
                          "inline-block text-[10px] px-2 py-px rounded-full border font-semibold whitespace-nowrap",
                          getStageCls(stage)
                        )}>
                          {stage}
                        </span>
                      </TableCell>

                      {/* Action */}
                      <TableCell className="px-3 py-2 align-middle">
                        <div className="flex items-center gap-1.5">
                          <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", getDot(log.action))} />
                          <span className="text-sm">{log.action || "—"}</span>
                        </div>
                        {log.remarks && (
                          <p className="text-[10px] text-muted-foreground mt-0.5 ml-3 italic line-clamp-1">"{log.remarks}"</p>
                        )}
                      </TableCell>

                      {/* Date & Time */}
                      <TableCell className="px-3 py-2 align-middle text-sm text-muted-foreground whitespace-nowrap">
                        {fmtDate(log.createdAt)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-3 py-2 border-t bg-gray-50/60 flex-wrap gap-2">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span>Rows:</span>
            <select
              value={perPage}
              onChange={e => { setPerPage(Number(e.target.value)); setPage(1); }}
              className="border rounded px-1 py-0.5 text-sm bg-white"
            >
              {[10, 20, 30, 50].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {total > 0
                ? `${startIdx + 1}–${Math.min(startIdx + perPage, total)} of ${total}`
                : "0 results"}
            </span>
            <div className="flex items-center gap-0.5">
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setPage(1)} disabled={safePage === 1}>
                <ChevronsLeft className="h-3.5 w-3.5" />
              </Button>
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="text-sm px-2 font-medium">{safePage} / {totalPages}</span>
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setPage(totalPages)} disabled={safePage >= totalPages}>
                <ChevronsRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Active filter chip ───────────────────────────────────────────────────────

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 text-xs px-2 py-0.5 rounded-full font-medium">
      {label}
      <button onClick={onRemove} className="hover:text-blue-900 leading-none">×</button>
    </span>
  );
}

// ─── Metric card ──────────────────────────────────────────────────────────────

function MetricCard({ title, value, icon, accent }: {
  title: string; value: number; icon: React.ReactNode; accent: string;
}) {
  return (
    <Card className={cn("border-l-4 shadow-sm", accent)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3 px-4">
        <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent className="pb-3 px-4">
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}