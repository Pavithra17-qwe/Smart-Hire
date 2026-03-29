"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { PieChart, Pie, Label, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend, Cell } from "recharts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { 
  Users, 
  CalendarDays, 
  History,
  Clock,
  XCircle,
  ArrowUpRight,
  TrendingDown,
  Activity,
  BarChart3,
  PieChart as PieIcon,
  UserPlus,
  Timer,
  Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";

const pipelineConfig = {
  l1: { label: "L1 Selected", color: "#6366F1" },
  l2: { label: "L2 Selected", color: "#3B82F6" },
  hr: { label: "HR Selected", color: "#F59E0B" },
  completed: { label: "Completed", color: "#10B981" },
} satisfies ChartConfig;

const hiringTrendConfig = {
  evaluations: { label: "Evaluations", color: "hsl(var(--primary))" },
  hires: { label: "Hires", color: "#10B981" },
} satisfies ChartConfig;

interface MonthlyData {
  month: string;
  monthNum: number;
  year: number;
  evaluations: number;
  hires: number;
}

export default function AgencyDashboard() {
  const { agencyId } = useAuth();
  const [candidates, setCandidates] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [filterProject, setFilterProject] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const normalizeStatus = (status: any) => {
    const s = (status || "").toLowerCase();
    if (s === "shedule" || s === "scheduled" || s === "schedule") return "Schedule";
    if (s === "pending") return "Pending";
    if (s === "selected") return "Selected";
    if (s === "rejected") return "Rejected";
    return status || "Pending";
  };

  const formatDisplayTime = (timeStr: string) => {
    if (!timeStr) return "Not set";
    try {
      const [hours, minutes] = timeStr.split(':');
      const h = parseInt(hours);
      const m = parseInt(minutes);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      return `${h12.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${ampm}`;
    } catch (e) {
      return timeStr;
    }
  };

  useEffect(() => {
    if (!agencyId) return;
    const q = query(collection(db, "candidates"), where("agencyId", "==", agencyId));
    const unsubCandidates = onSnapshot(q, (snap) => {
      setCandidates(snap.docs.map(doc => {
        const raw = doc.data();
        return {
          id: doc.id,
          ...raw,
          r1Status: normalizeStatus(raw.r1Status),
          r2Status: normalizeStatus(raw.r2Status),
          hrStatus: normalizeStatus(raw.hrStatus),
          offerStatus: raw.offerStatus || "Offer Pending",
          finalStatus: raw.finalStatus || "In Progress",
          createdDate: raw.createdDate?.toDate() || new Date(),
        };
      }));
    });
    const unsubProjects = onSnapshot(collection(db, "job_requisitions"), (snap) => {
      setProjects(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => {
      unsubCandidates();
      unsubProjects();
    };
  }, [agencyId]);

  const handleClearFilters = () => {
    setFilterProject("all");
    setFilterStatus("all");
  };

  const filtered = useMemo(() => {
    return candidates.filter(c => {
      const projectMatch = filterProject === "all" || c.projectId === filterProject;
      const statusMatch = filterStatus === "all" || c.finalStatus === filterStatus;
      return projectMatch && statusMatch;
    });
  }, [candidates, filterProject, filterStatus]);

  const stats = useMemo(() => {
    const l1SelectedCount = filtered.filter(c => (c.r1Status || "").toLowerCase() === "selected").length;
    const l2SelectedCount = filtered.filter(c => (c.r2Status || "").toLowerCase() === "selected").length;
    const hrSelectedCount = filtered.filter(c => (c.hrStatus || "").toLowerCase() === "selected").length;
    const completedCount = filtered.filter(c => (c.finalStatus || "").toLowerCase() === "completed").length;

    let l1Scheduled = 0, l1Rejected = 0, l1Pending = 0;
    let l2Scheduled = 0, l2Rejected = 0, l2Pending = 0;
    let hrScheduled = 0, hrRejected = 0, hrPending = 0;
    
    let offersPending = 0, offersReleased = 0, offersDeclined = 0;

    filtered.forEach(c => {
      const s1 = (c.r1Status || "").toLowerCase();
      const s2 = (c.r2Status || "").toLowerCase();
      const sH = (c.hrStatus || "").toLowerCase();
      const sO = (c.offerStatus || "").toLowerCase();

      if (s1 === "rejected") l1Rejected++;
      if (s1 === "schedule") l1Scheduled++;
      if (s1 === "pending") l1Pending++;

      if (s2 === "rejected") l2Rejected++;
      if (s2 === "schedule") l2Scheduled++;
      if (s2 === "pending") l2Pending++;

      if (sH === "rejected") hrRejected++;
      if (sH === "schedule") hrScheduled++;
      if (sH === "pending") hrPending++;

      if (sO === "offer pending") offersPending++;
      if (sO === "offer released") offersReleased++;
      if (sO === "offer rejected") offersDeclined++;
    });
    
    return {
      total: filtered.length,
      offersPending,
      offersReleased,
      offersDeclined,
      l1SelectedCount, l2SelectedCount, hrSelectedCount, completedCount,
      l1Scheduled, l1Rejected, l1Pending,
      l2Scheduled, l2Rejected, l2Pending,
      hrScheduled, hrRejected, hrPending
    };
  }, [filtered]);

  const pipelineData = useMemo(() => [
    { name: "L1 Selected", value: stats.l1SelectedCount, fill: "#6366F1" },
    { name: "L2 Selected", value: stats.l2SelectedCount, fill: "#3B82F6" },
    { name: "HR Selected", value: stats.hrSelectedCount, fill: "#F59E0B" },
    { name: "Completed", value: stats.completedCount, fill: "#10B981" },
  ].filter(item => item.value > 0), [stats]);

  const pipelineTotal = useMemo(() => 
    stats.l1SelectedCount + stats.l2SelectedCount + stats.hrSelectedCount + stats.completedCount, 
  [stats]);

  const hiringTrendData = useMemo(() => {
    const last6Months: MonthlyData[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      last6Months.push({
        month: d.toLocaleString('default', { month: 'short' }),
        monthNum: d.getMonth(),
        year: d.getFullYear(),
        evaluations: 0,
        hires: 0
      });
    }
    filtered.forEach(c => {
      const cDate = c.createdDate;
      const monthIdx = last6Months.findIndex(m => m.monthNum === cDate.getMonth() && m.year === cDate.getFullYear());
      if (monthIdx !== -1) {
        last6Months[monthIdx].evaluations++;
        if (c.finalStatus === "Completed") last6Months[monthIdx].hires++;
      }
    });
    return last6Months;
  }, [filtered]);

  const upcomingInterviews = useMemo(() => {
    const interviews: any[] = [];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayStr = today.toISOString().split('T')[0];

    const maxDate = new Date(today);
    maxDate.setDate(today.getDate() + 3);
    const maxDateStr = maxDate.toISOString().split('T')[0];

    filtered.forEach(c => {
      ['r1', 'r2', 'hr'].forEach(round => {
        const dateStr = c[`${round}Date`];
        const status = (c[`${round}Status`] || "").toLowerCase();
        
        if (status === "schedule" && dateStr && dateStr >= todayStr && dateStr <= maxDateStr) {
          interviews.push({
            id: `${c.id}-${round}`,
            candidateName: c.candidateName,
            agencyName: c.agencyName,
            roundLabel: round === 'r1' ? 'L1 Interview' : round === 'r2' ? 'L2 Interview' : 'HR Interview',
            date: dateStr,
            time: c[`${round}Time`],
            isToday: dateStr === todayStr,
            fullDate: new Date(dateStr + 'T' + (c[`${round}Time`] || '00:00'))
          });
        }
      });
    });
    return interviews.sort((a, b) => a.fullDate.getTime() - b.fullDate.getTime());
  }, [filtered]);

  const hasActiveFilters = filterProject !== "all" || filterStatus !== "all";

  if (!isMounted) {
    return <div className="p-8 h-screen w-full flex items-center justify-center text-muted-foreground"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  }

  return (
    <div className="space-y-8 pb-10 w-full overflow-x-hidden dashboard-container">
      <div className="flex flex-col md:flex-row items-end gap-4 bg-card p-5 rounded-xl shadow-sm border">
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-muted-foreground tracking-wider ml-1">Project</label>
            <Select onValueChange={setFilterProject} value={filterProject}>
              <SelectTrigger className="rounded-lg h-11"><SelectValue placeholder="All Projects" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-muted-foreground tracking-wider ml-1">Status</label>
            <Select onValueChange={setFilterStatus} value={filterStatus}>
              <SelectTrigger className="rounded-lg h-11"><SelectValue placeholder="All Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="In Progress">In Progress</SelectItem>
                <SelectItem value="Completed">Completed</SelectItem>
                <SelectItem value="Rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {hasActiveFilters && (
          <Button variant="secondary" size="sm" onClick={handleClearFilters} className="h-11 gap-2 text-xs font-bold rounded-lg px-4">
            <XCircle className="h-4 w-4" /> Clear
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Total Candidates" value={stats.total} icon={Users} color="border-l-slate-400" />
        <MetricCard title="Offer Pending" value={stats.offersPending} icon={Timer} color="border-l-blue-400" />
        <MetricCard title="Offers Released" value={stats.offersReleased} icon={ArrowUpRight} color="border-l-purple-500" />
        <MetricCard title="Offers Rejected" value={stats.offersDeclined} icon={TrendingDown} color="border-l-rose-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <Card className="lg:col-span-5 shadow-md border overflow-hidden">
          <CardHeader className="bg-muted/30 pb-4 border-b">
            <div className="flex items-center gap-2">
              <PieIcon className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg font-headline font-bold">Pipeline Distribution</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-8 flex flex-col items-center">
            {pipelineTotal > 0 ? (
              <ChartContainer config={pipelineConfig} className="mx-auto aspect-square max-h-[250px] w-full">
                <PieChart>
                  <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                  <Pie
                    data={pipelineData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={70}
                    outerRadius={95}
                    strokeWidth={4}
                    stroke="hsl(var(--background))"
                    paddingAngle={4}
                  >
                    {pipelineData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                    <Label
                      content={({ viewBox }) => {
                        if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                          return (
                            <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                              <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-3xl font-black">{pipelineTotal}</tspan>
                              <tspan x={viewBox.cx} y={(viewBox.cy || 0) + 24} className="fill-muted-foreground text-[10px] font-bold uppercase tracking-widest">PIPELINE</tspan>
                            </text>
                          )
                        }
                      }}
                    />
                  </Pie>
                </PieChart>
              </ChartContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm italic text-center px-4">
                No data available for selected filters.
              </div>
            )}
            <div className="mt-8 grid grid-cols-2 gap-y-4 gap-x-8 px-4 w-full max-w-[360px]">
              {pipelineData.map((item) => (
                <div key={item.name} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 truncate">
                    <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: item.fill }} />
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider truncate">{item.name}</span>
                  </div>
                  <span className="text-[11px] font-black tabular-nums">{item.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-7 shadow-md border overflow-hidden">
          <CardHeader className="bg-muted/30 pb-4 border-b">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg font-headline font-bold">Hiring Trend</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-8">
            <ChartContainer config={hiringTrendConfig} className="h-[350px] w-full">
              <BarChart data={hiringTrendData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted))" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 500 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 500 }} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px', fontSize: '12px', fontWeight: 600 }} />
                <Bar dataKey="evaluations" name="Evaluated" fill="var(--color-evaluations)" radius={[4, 4, 0, 0]} barSize={20} />
                <Bar dataKey="hires" name="Hires" fill="var(--color-hires)" radius={[4, 4, 0, 0]} barSize={20} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <Card className="lg:col-span-7 shadow-md border overflow-hidden">
          <CardHeader className="bg-muted/30 pb-4 border-b">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg font-headline font-bold">Interview Distribution</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-4">
                <h4 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest px-1">Scheduled</h4>
                <div className="space-y-3">
                  <StatusPill label="L1 SCHEDULED" count={stats.l1Scheduled} dotColor="bg-primary" />
                  <StatusPill label="L2 SCHEDULED" count={stats.l2Scheduled} dotColor="bg-blue-500" />
                  <StatusPill label="HR SCHEDULED" count={stats.hrScheduled} dotColor="bg-amber-500" />
                </div>
              </div>
              <div className="space-y-4">
                <h4 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest px-1">Rejected</h4>
                <div className="space-y-3">
                  <StatusPill label="L1 REJECTED" count={stats.l1Rejected} dotColor="bg-rose-400" />
                  <StatusPill label="L2 REJECTED" count={stats.l2Rejected} dotColor="bg-rose-600" />
                  <StatusPill label="HR REJECTED" count={stats.hrRejected} dotColor="bg-rose-800" />
                </div>
              </div>
              <div className="space-y-4">
                <h4 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest px-1">Pending Interviews</h4>
                <div className="space-y-3">
                  <StatusPill label="L1 PENDING" count={stats.l1Pending} dotColor="bg-slate-400" />
                  <StatusPill label="L2 PENDING" count={stats.l2Pending} dotColor="bg-slate-400" />
                  <StatusPill label="HR PENDING" count={stats.hrPending} dotColor="bg-slate-400" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="lg:col-span-5 grid grid-cols-2 gap-4 h-full">
          <Link href="/candidates/evaluation" className="block group">
            <Card className="h-full border-2 border-dashed border-primary/20 hover:border-primary/50 transition-all hover:bg-primary/[0.02] cursor-pointer">
              <CardContent className="p-4 flex flex-col items-center justify-center text-center h-full">
                <div className="h-10 w-10 bg-primary/10 rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                  <UserPlus className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-bold text-sm text-foreground">New Evaluation</h3>
                <p className="text-[10px] text-muted-foreground mt-1 leading-tight">Start a new candidate evaluation</p>
              </CardContent>
            </Card>
          </Link>
          <Link href="/candidates/history" className="block group">
            <Card className="h-full border-2 border-dashed border-muted-foreground/20 hover:border-muted-foreground/50 transition-all hover:bg-muted/[0.02] cursor-pointer">
              <CardContent className="p-4 flex flex-col items-center justify-center text-center h-full">
                <div className="h-10 w-10 bg-muted rounded-xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                  <History className="h-5 w-5 text-muted-foreground" />
                </div>
                <h3 className="font-bold text-sm text-foreground">View History</h3>
                <p className="text-[10px] text-muted-foreground mt-1 leading-tight">View all candidate records</p>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>

      <Card className="shadow-md border overflow-hidden upcoming-interviews">
        <CardHeader className="bg-muted/30 pb-4 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg font-headline font-bold">Upcoming Interviews</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground mr-2">Today + Next 3 days</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-8 px-12 relative">
          {upcomingInterviews.length > 0 ? (
            <Carousel
              opts={{
                align: "start",
                slidesToScroll: 1,
              }}
              className="w-full"
            >
              <CarouselContent className="-ml-4">
                {upcomingInterviews.map((item) => (
                  <CarouselItem key={item.id} className="pl-4 basis-full sm:basis-1/2 md:basis-1/3 lg:basis-1/5">
                    <div className="flex flex-col p-4 rounded-xl border bg-card hover:bg-accent/5 transition-colors group h-full">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-bold text-foreground">{item.roundLabel}</span>
                        {item.isToday && <Badge className="bg-emerald-500 hover:bg-emerald-600 text-[10px] h-4">TODAY</Badge>}
                      </div>
                      <div className="flex flex-col gap-1 text-xs text-muted-foreground mt-1 font-medium">
                        <div className="flex items-center gap-2">
                          <CalendarDays className="h-3 w-3 text-primary" />
                          {!item.isToday ? <span>{new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span> : <span>Today</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <Clock className="h-3 w-3 text-primary" />
                          <span>{formatDisplayTime(item.time)}</span>
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t space-y-1">
                        <p className="text-xs font-bold text-primary truncate">Candidate: {item.candidateName}</p>
                        <p className="text-[10px] text-muted-foreground truncate italic">Agency: {item.agencyName || "N/A"}</p>
                      </div>
                    </div>
                  </CarouselItem>
                ))}
              </CarouselContent>
              {upcomingInterviews.length > 5 && (
                <>
                  <CarouselPrevious className="-left-8" />
                  <CarouselNext className="-right-8" />
                </>
              )}
            </Carousel>
          ) : (
            <div className="h-32 flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed rounded-xl mx-4">
              <p className="text-sm font-bold opacity-40 uppercase tracking-widest text-center">No Active Schedules for Today or Next 3 Days</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ title, value, icon: Icon, color }: { title: string; value: number; icon: any; color: string }) {
  return (
    <Card className={cn("shadow-sm border border-l-4 transition-all hover:shadow-md bg-card", color)}>
      <CardContent className="p-5 flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]">{title}</p>
          <p className="text-2xl font-black">{value}</p>
        </div>
        <div className="h-10 w-10 bg-muted/50 rounded-lg flex items-center justify-center text-muted-foreground/50">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function StatusPill({ label, count, dotColor }: { label: string; count: number; dotColor: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2 border rounded-xl bg-card hover:bg-accent/5 transition-colors group">
      <div className="flex items-center gap-2">
        <div className={cn("h-2 w-2 rounded-full", dotColor)} />
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <span className="text-sm font-bold text-foreground">{count}</span>
    </div>
  );
}
