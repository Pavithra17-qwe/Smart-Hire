"use client";

import { useState, useMemo, useEffect } from "react";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, Activity, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, XCircle, Calendar, Loader2 } from "lucide-react";
import { DateRange } from "react-day-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

const ACTION_TYPES = ["Project Created", "Candidate Uploaded", "Interview Scheduled", "Status Updated", "Feedback Provided", "Offer Made", "JD Uploaded", "Candidate moved stage"];
const ROLE_TYPES = ["admin", "hr", "agency", "panel"];

const ACTION_COLORS: Record<string, string> = {
  "Project Created": "bg-blue-500",
  "JD Uploaded": "bg-blue-400",
  "Candidate Uploaded": "bg-green-500",
  "Interview Scheduled": "bg-purple-500",
  "Status Updated": "bg-yellow-500",
  "Feedback Provided": "bg-indigo-500",
  "Offer Made": "bg-pink-500",
  "Candidate moved stage": "bg-teal-500",
};

export default function ActivityLogPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [isMounted, setIsMounted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [filterRole, setFilterRole] = useState("all");
  const [filterAction, setFilterAction] = useState("all");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  useEffect(() => {
    setIsMounted(true);
    const q = query(collection(db, "activity_log"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setLogs(data);
      setIsLoading(false);
    }, (error) => {
      console.error("Error fetching activity logs: ", error);
      setIsLoading(false);
    });
    return () => unsub();
  }, []);

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      const logDate = log.createdAt?.toDate();
      const matchesSearch = log.userName.toLowerCase().includes(searchText.toLowerCase()) || log.targetName.toLowerCase().includes(searchText.toLowerCase());
      const matchesRole = filterRole === "all" || log.userRole === filterRole;
      const matchesAction = filterAction === "all" || log.action === filterAction;
      const matchesDate = !dateRange?.from || !logDate || (logDate >= dateRange.from && (!dateRange.to || logDate <= dateRange.to));
      return matchesSearch && matchesRole && matchesAction && matchesDate;
    });
  }, [logs, searchText, filterRole, filterAction, dateRange]);

  const stats = useMemo(() => {
    return {
      total: logs.length,
      hr: logs.filter(l => l.userRole === 'hr').length,
      agency: logs.filter(l => l.userRole === 'agency').length,
      panel: logs.filter(l => l.userRole === 'panel').length,
    }
  }, [logs]);

  const totalRecords = filteredLogs.length;
  const totalPages = Math.ceil(totalRecords / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const paginatedLogs = filteredLogs.slice(startIndex, startIndex + rowsPerPage);
  
  const hasActiveFilters = searchText !== "" || filterRole !== "all" || filterAction !== "all" || dateRange;

  const handleClearFilters = () => {
    setSearchText("");
    setFilterRole("all");
    setFilterAction("all");
    setDateRange(undefined);
    setCurrentPage(1);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col">
        <h1 className="text-3xl font-headline font-bold text-foreground">Activity Log</h1>
        <p className="text-sm text-muted-foreground mt-1">Track all system-wide actions and updates in one place.</p>
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Total Actions" value={stats.total} />
        <MetricCard title="HR Actions" value={stats.hr} />
        <MetricCard title="Agency Actions" value={stats.agency} />
        <MetricCard title="Panel Actions" value={stats.panel} />
      </div>

      <div className="flex flex-col md:flex-row items-end gap-4 bg-card p-4 rounded-lg shadow-sm border">
        <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-4 w-full">
          <div className="space-y-2">
            <label className="text-sm font-medium">Search</label>
            <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input placeholder="User or target..." className="pl-10 h-10" value={searchText} onChange={e => setSearchText(e.target.value)} /></div>
          </div>
          <div className="space-y-2"><label className="text-sm font-medium">Role</label><Select value={filterRole} onValueChange={setFilterRole}><SelectTrigger className="h-10"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Roles</SelectItem>{ROLE_TYPES.map(r => <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><label className="text-sm font-medium">Action Type</label><Select value={filterAction} onValueChange={setFilterAction}><SelectTrigger className="h-10"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Actions</SelectItem>{ACTION_TYPES.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Date Range</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button id="date" variant="outline" className={cn("w-full justify-start text-left font-normal h-10", !dateRange && "text-muted-foreground")}><Calendar className="mr-2 h-4 w-4" />{dateRange?.from ? (dateRange.to ? (<>{format(dateRange.from, "LLL dd, y")} - {format(dateRange.to, "LLL dd, y")}</>) : (format(dateRange.from, "LLL dd, y"))) : (<span>Pick a date</span>)}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start"><CalendarPicker initialFocus mode="range" defaultMonth={dateRange?.from} selected={dateRange} onSelect={setDateRange} numberOfMonths={2} /></PopoverContent>
            </Popover>
          </div>
        </div>
        {hasActiveFilters && (<Button variant="secondary" size="sm" onClick={handleClearFilters} className="h-10 gap-2"><XCircle className="h-4 w-4" /> Clear</Button>)}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead>User</TableHead><TableHead>Action</TableHead><TableHead>Date & Time</TableHead><TableHead>Stage</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={4} className="text-center h-32"><Loader2 className="h-4 w-4 animate-spin inline-block mr-2" /> Loading logs...</TableCell></TableRow>
              ) : paginatedLogs.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center h-32 text-muted-foreground">No activities found.</TableCell></TableRow>
              ) : (
                paginatedLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="font-bold">{log.userName}</div>
                        <Badge variant="secondary" className="capitalize">{log.userRole}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">{log.targetType}: {log.targetName}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className={cn("w-2 h-2 rounded-full", ACTION_COLORS[log.action] || "bg-gray-400")}></div>
                        <span>{log.action}</span>
                      </div>
                    </TableCell>
                    <TableCell>{isMounted && log.createdAt ? format(log.createdAt.toDate(), "PPpp") : "..."}</TableCell>
                    <TableCell><Badge variant="outline">{log.stage}</Badge></TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          
           <div className="flex items-center justify-between px-6 py-4 border-t">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><span>Rows per page:</span><Select value={String(rowsPerPage)} onValueChange={(v) => { setRowsPerPage(Number(v)); setCurrentPage(1); }}><SelectTrigger className="h-8 w-[70px]"><SelectValue placeholder={rowsPerPage} /></SelectTrigger><SelectContent side="top">{[10, 20, 30, 50].map((pageSize) => (<SelectItem key={pageSize} value={String(pageSize)}>{pageSize}</SelectItem>))}</SelectContent></Select></div>
            <div className="flex items-center gap-6 lg:gap-8">
              <div className="flex w-[120px] items-center justify-center text-sm font-medium">{totalRecords > 0 ? `${startIndex + 1}–${Math.min(startIndex + rowsPerPage, totalRecords)} of ${totalRecords}` : "0 of 0"}</div>
              <div className="flex items-center space-x-2">
                <Button variant="outline" className="h-8 w-8 p-0" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}><ChevronsLeft className="h-4 w-4" /></Button>
                <Button variant="outline" className="h-8 w-8 p-0" onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={currentPage === 1}><ChevronLeft className="h-4 w-4" /></Button>
                <Button variant="outline" className="h-8 w-8 p-0" onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages || totalRecords === 0}><ChevronRight className="h-4 w-4" /></Button>
                <Button variant="outline" className="h-8 w-8 p-0" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages || totalRecords === 0}><ChevronsRight className="h-4 w-4" /></Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ title, value }: { title: string, value: number }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Activity className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}
