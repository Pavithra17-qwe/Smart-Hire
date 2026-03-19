"use client";

import { useState, useEffect } from "react";
import { collection, onSnapshot, query, where, deleteDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Search, Trash2, Eye, MoreVertical, XCircle, Calendar, Clock, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import NextLink from "next/link";
import { cn } from "@/lib/utils";

const STATUS_OPTIONS = ["In Progress", "Completed", "Rejected"];
const ROLE_OPTIONS = ["Junior QA", "Senior QA", "ADM", "DM"];

export default function CandidateHistory() {
  const { role, agencyId: loggedInAgencyId } = useAuth();
  const [candidates, setCandidates] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [agencies, setAgencies] = useState<any[]>([]);
  const [isMounted, setIsMounted] = useState(false);
  
  const [searchText, setSearchText] = useState("");
  const [filterProject, setFilterProject] = useState("all");
  const [filterAgency, setFilterAgency] = useState("all");
  const [filterRole, setFilterRole] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const { toast } = useToast();

  const normalizeStatus = (status: any) => {
    if (status === "Shedule" || status === "Scheduled") return "Schedule";
    if (status === "Pending") return "Pending";
    return status || "Pending";
  };

  useEffect(() => {
    setIsMounted(true);
    let q = collection(db, "candidates");
    if (role === "agency" && loggedInAgencyId) {
      q = query(q, where("agencyId", "==", loggedInAgencyId));
    }
    const unsub = onSnapshot(q, (snap) => {
      let data = snap.docs.map(doc => {
        const raw = doc.data();
        return {
          id: doc.id,
          ...raw,
          r1Status: normalizeStatus(raw.r1Status),
          r2Status: normalizeStatus(raw.r2Status),
          hrStatus: normalizeStatus(raw.hrStatus),
          offerStatus: raw.offerStatus || "Pending",
          finalStatus: raw.finalStatus || "In Progress",
        };
      });
      // Sort by Date descending
      data.sort((a, b) => (b.createdDate?.seconds || 0) - (a.createdDate?.seconds || 0));
      setCandidates(data);
    });
    const unsubProjects = onSnapshot(collection(db, "job_requisitions"), (snap) => {
      setProjects(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    if (role === "admin") {
      const unsubAgencies = onSnapshot(collection(db, "agencies"), (snap) => {
        setAgencies(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      });
      return () => { unsub(); unsubProjects(); unsubAgencies(); };
    }
    return () => { unsub(); unsubProjects(); };
  }, [role, loggedInAgencyId]);

  const handleClearFilters = () => {
    setSearchText(""); setFilterProject("all"); setFilterAgency("all"); setFilterRole("all"); setFilterStatus("all"); setCurrentPage(1);
  };

  const filteredCandidates = candidates.filter(c => {
    const matchesSearch = (c.candidateName || "").toLowerCase().includes(searchText.toLowerCase());
    const matchesProject = filterProject === "all" || c.projectId === filterProject;
    const matchesAgency = filterAgency === "all" || c.agencyId === filterAgency;
    const matchesRole = filterRole === "all" || c.role === filterRole;
    const matchesStatus = filterStatus === "all" || c.finalStatus === filterStatus;
    return matchesSearch && matchesProject && matchesAgency && matchesRole && matchesStatus;
  });

  const totalRecords = filteredCandidates.length;
  const totalPages = Math.ceil(totalRecords / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const paginatedCandidates = filteredCandidates.slice(startIndex, startIndex + rowsPerPage);

  const handleDelete = async () => {
    if (!deleteId) return;
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, "candidates", deleteId));
      toast({ title: "Success", description: "Candidate deleted successfully." });
      setDeleteId(null);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: "Failed to delete candidate record." });
    } finally { setIsDeleting(false); }
  };

  const getStatusBadge = (status: string, prefix?: string, date?: string, time?: string) => {
    const s = (status || "").toLowerCase();
    
    // Normalize display text
    let displayStatus = status;
    if (s === "schedule") displayStatus = "Scheduled";
    if (s === "pending") displayStatus = "Pending";

    let label = displayStatus;
    if (prefix && !displayStatus.toLowerCase().includes(prefix.toLowerCase())) {
      label = `${prefix} ${displayStatus}`;
    }

    if (prefix === "Offer" && s === "pending") {
      label = "Offer Pending";
    }

    // Standardized colors
    let className = "bg-slate-100 text-slate-500 border-slate-200";

    if (s.includes("selected") || s === "completed") {
      className = "bg-emerald-100 text-emerald-700 border-emerald-200";
    } else if (s.includes("rejected") || s.includes("declined")) {
      className = "bg-rose-100 text-rose-700 border-rose-200";
    } else if (s === "schedule" || s === "scheduled") {
      className = "bg-blue-100 text-blue-700 border-blue-200";
    } else if (s === "offer released") {
      className = "bg-purple-100 text-purple-700 border-purple-200";
    }

    const isScheduled = (s === "schedule" || s === "scheduled") && date;
    if (isScheduled) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className={cn(className, "cursor-help font-bold px-2 py-0.5 whitespace-nowrap")}>
                {label}
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="p-2 space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold"><Calendar className="w-3 h-3" /> {date}</div>
              <div className="flex items-center gap-2 text-xs font-bold"><Clock className="w-3 h-3" /> {time}</div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    return <Badge variant="outline" className={cn(className, "font-bold px-2 py-0.5 whitespace-nowrap")}>{label}</Badge>;
  };

  const hasActiveFilters = searchText !== "" || filterProject !== "all" || filterAgency !== "all" || filterRole !== "all" || filterStatus !== "all";
  const adminGridCols = role === "admin" ? "md:grid-cols-4" : "md:grid-cols-3";

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div className="flex flex-col">
          <h1 className="text-3xl font-headline font-bold text-foreground leading-tight tracking-tight">Candidate History</h1>
          <p className="text-sm text-muted-foreground mt-1">Comprehensive log of all candidate evaluation statuses.</p>
        </div>
        <div className="relative w-[280px]"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input placeholder="Search candidates..." className="pl-10 h-10" value={searchText} onChange={e => { setSearchText(e.target.value); setCurrentPage(1); }} /></div>
      </div>
      <div className="flex flex-col md:flex-row items-end gap-4 bg-card p-4 rounded-lg shadow-sm border">
        <div className={cn("flex-1 grid grid-cols-1 gap-4 w-full", adminGridCols)}>
          <div className="space-y-2"><label className="text-sm font-medium">Project</label><Select value={filterProject} onValueChange={v => { setFilterProject(v); setCurrentPage(1); }}><SelectTrigger><SelectValue placeholder="All Projects" /></SelectTrigger><SelectContent><SelectItem value="all">All Projects</SelectItem>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.projectName}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><label className="text-sm font-medium">Role</label><Select value={filterRole} onValueChange={v => { setFilterRole(v); setCurrentPage(1); }}><SelectTrigger><SelectValue placeholder="All Roles" /></SelectTrigger><SelectContent><SelectItem value="all">All Roles</SelectItem>{ROLE_OPTIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select></div>
          {role === "admin" && (<div className="space-y-2"><label className="text-sm font-medium">Agency</label><Select value={filterAgency} onValueChange={v => { setFilterAgency(v); setCurrentPage(1); }}><SelectTrigger><SelectValue placeholder="All Agencies" /></SelectTrigger><SelectContent><SelectItem value="all">All Agencies</SelectItem>{agencies.map(a => <SelectItem key={a.id} value={a.agencyId}>{a.name}</SelectItem>)}</SelectContent></Select></div>)}
          <div className="space-y-2"><label className="text-sm font-medium">Status</label><Select value={filterStatus} onValueChange={v => { setFilterStatus(v); setCurrentPage(1); }}><SelectTrigger><SelectValue placeholder="All Status" /></SelectTrigger><SelectContent><SelectItem value="all">All Status</SelectItem>{STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
        </div>
        {hasActiveFilters && (<Button variant="secondary" size="sm" onClick={handleClearFilters} className="h-10 gap-2"><XCircle className="h-4 w-4" /> Clear</Button>)}
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Candidate</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Agency</TableHead>
                <TableHead>L1 Round</TableHead>
                <TableHead>L2 Round</TableHead>
                <TableHead>HR Round</TableHead>
                <TableHead>Offer Stage</TableHead>
                <TableHead>Final Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedCandidates.length === 0 ? (<TableRow><TableCell colSpan={10} className="text-center h-32 text-muted-foreground italic">No candidates found.</TableCell></TableRow>) : (
                paginatedCandidates.map((c) => {
                  const isL1Rejected = c.r1Status === "Rejected";
                  const isL2Rejected = c.r2Status === "Rejected";
                  const isHRRejected = c.hrStatus === "Rejected";

                  return (
                    <TableRow key={c.id}>
                      <TableCell className="text-sm">
                        {isMounted && c.createdDate ? c.createdDate.toDate().toLocaleDateString('en-US') : "..."}
                      </TableCell>
                      <TableCell><div className="flex flex-col"><span className="font-bold text-foreground">{c.candidateName}</span><span className="text-[10px] text-muted-foreground uppercase font-black">{c.role}</span></div></TableCell>
                      <TableCell className="text-sm">{c.projectName}</TableCell>
                      <TableCell className="text-sm">{c.agencyName}</TableCell>
                      <TableCell>{getStatusBadge(c.r1Status, "L1", c.r1Date, c.r1Time)}</TableCell>
                      <TableCell>
                        {isL1Rejected ? <span className="text-muted-foreground font-bold px-4">—</span> : getStatusBadge(c.r2Status, "L2", c.r2Date, c.r2Time)}
                      </TableCell>
                      <TableCell>
                        {(isL1Rejected || isL2Rejected) ? <span className="text-muted-foreground font-bold px-4">—</span> : getStatusBadge(c.hrStatus, "HR", c.hrDate, c.hrTime)}
                      </TableCell>
                      <TableCell>
                        {(isL1Rejected || isL2Rejected || isHRRejected) ? <span className="text-muted-foreground font-bold px-4">—</span> : getStatusBadge(c.offerStatus, "Offer")}
                      </TableCell>
                      <TableCell>{getStatusBadge(c.finalStatus)}</TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild><NextLink href={`/candidates/${c.id}`} className="flex items-center gap-2"><Eye className="h-4 w-4" /> View Details</NextLink></DropdownMenuItem>
                            {role === "admin" && (<DropdownMenuItem className="gap-2 text-destructive" onSelect={(e) => { e.preventDefault(); setDeleteId(c.id); }}><Trash2 className="h-4 w-4" /> Delete</DropdownMenuItem>)}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between px-6 py-4 border-t">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><span>Rows:</span><Select value={String(rowsPerPage)} onValueChange={(v) => { setRowsPerPage(Number(v)); setCurrentPage(1); }}><SelectTrigger className="h-8 w-[70px]"><SelectValue /></SelectTrigger><SelectContent side="top">{[10, 20, 30, 50].map(sz => <SelectItem key={sz} value={String(sz)}>{sz}</SelectItem>)}</SelectContent></Select></div>
            <div className="flex items-center gap-4">
              <div className="text-sm font-medium">{totalRecords > 0 ? `${startIndex + 1}–${Math.min(startIndex + rowsPerPage, totalRecords)} of ${totalRecords}` : "0 of 0"}</div>
              <div className="flex space-x-1">
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}><ChevronsLeft className="h-4 w-4" /></Button>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={currentPage === 1}><ChevronLeft className="h-4 w-4" /></Button>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages || totalRecords === 0}><ChevronRight className="h-4 w-4" /></Button>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages || totalRecords === 0}><ChevronsRight className="h-4 w-4" /></Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      <AlertDialog open={!!deleteId} onOpenChange={o => !o && setDeleteId(null)}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete Candidate</AlertDialogTitle><AlertDialogDescription>This action cannot be undone and will permanently remove the record.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel><Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>{isDeleting ? <Loader2 className="animate-spin h-4 w-4" /> : "Delete Record"}</Button></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
