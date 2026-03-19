
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { collection, addDoc, getDocs, query, orderBy, serverTimestamp, deleteDoc, doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Plus, Loader2, Eye, Edit2, Trash2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, MoreVertical, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { logActivity } from "@/lib/activity-logger";

const STANDARD_LOCATIONS = ["Chennai", "Bangalore", "Remote"];
const LOCATION_OPTIONS = [...STANDARD_LOCATIONS, "Other"];
const ROLES_OPTIONS = ["Junior QA", "Senior QA", "DM", "Others"];

export default function JobRequisitions() {
  const [requisitions, setRequisitions] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [showLocationError, setShowLocationError] = useState(false);
  const [otherLocationError, setOtherLocationError] = useState("");
  const [otherRoleError, setOtherRoleError] = useState("");
  const [jdError, setJdError] = useState("");
  const [projectNameError, setProjectNameError] = useState("");
  const { toast } = useToast();
  const { user, role, name } = useAuth();

  // Filters state
  const [filterProject, setFilterProject] = useState("all");
  const [filterLocation, setFilterLocation] = useState("all");
  const [filterDesignation, setFilterDesignation] = useState("all");
  const [filterCreatedBy, setFilterCreatedBy] = useState("all");

  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const [formData, setFormData] = useState<any>({
    projectName: "",
    locations: [],
    otherLocation: "",
    roles: [],
    otherRole: "",
    status: "Active",
    jdFile: null
  });

  const fetchRequisitions = useCallback(async () => {
    setIsDataLoading(true);
    try {
      const q = query(collection(db, "job_requisitions"), orderBy("createdDate", "desc"));
      const snap = await getDocs(q);
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setRequisitions(data);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Fetch Error", description: "Failed to load job requisitions." });
    } finally {
      setIsDataLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    setIsMounted(true);
    fetchRequisitions();
  }, [fetchRequisitions]);

  // Combined Filtering Logic
  const filteredRequisitions = useMemo(() => {
    return requisitions.filter(req => {
      const matchesProject = filterProject === "all" || req.projectName === filterProject;
      const matchesLocation = filterLocation === "all" || (req.locations || []).includes(filterLocation);
      const matchesDesignation = filterDesignation === "all" || (req.roles || []).includes(filterDesignation);
      const matchesCreatedBy = filterCreatedBy === "all" || req.createdBy === filterCreatedBy;
      return matchesProject && matchesLocation && matchesDesignation && matchesCreatedBy;
    });
  }, [requisitions, filterProject, filterLocation, filterDesignation, filterCreatedBy]);

  // Derive unique options for filters from the base requisitions data
  const projectOptions = useMemo(() => {
    return Array.from(new Set(requisitions.map(r => r.projectName))).sort();
  }, [requisitions]);

  const locationOptions = useMemo(() => {
    const locs = new Set<string>();
    requisitions.forEach(r => {
      (r.locations || []).forEach((l: string) => locs.add(l));
    });
    return Array.from(locs).sort();
  }, [requisitions]);

  const designationOptions = useMemo(() => {
    const roles = new Set<string>();
    requisitions.forEach(r => {
      (r.roles || []).forEach((role: string) => roles.add(role));
    });
    return Array.from(roles).sort();
  }, [requisitions]);

  const hasActiveFilters = filterProject !== "all" || filterLocation !== "all" || filterDesignation !== "all" || filterCreatedBy !== "all";

  const handleClearFilters = () => {
    setFilterProject("all");
    setFilterLocation("all");
    setFilterDesignation("all");
    setFilterCreatedBy("all");
    setCurrentPage(1);
  };

  const totalRecords = filteredRequisitions.length;
  const totalPages = Math.ceil(totalRecords / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const paginatedRequisitions = filteredRequisitions.slice(startIndex, startIndex + rowsPerPage);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setJdError("");
    if (!file) {
      setFormData({ ...formData, jdFile: null });
      return;
    }
    const extension = file.name.split('.').pop()?.toLowerCase();
    const allowedExtensions = ["pdf", "doc", "docx"];
    if (!allowedExtensions.includes(extension || "")) {
      setJdError("Only PDF, DOC, and DOCX files are allowed.");
      e.target.value = "";
      return;
    }
    if (file.size > 1024 * 1024) {
      setJdError("File size must be less than 1MB.");
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      setFormData({ ...formData, jdFile: { name: file.name, type: file.type, data: base64 } });
    };
    reader.readAsDataURL(file);
  };

  const handleRoleToggle = (role: string) => {
    const current = formData.roles || [];
    const updated = current.includes(role) ? current.filter((r: string) => r !== role) : [...current, role];
    setFormData(prev => ({ 
      ...prev, 
      roles: updated,
      otherRole: updated.includes("Others") ? prev.otherRole : "" 
    }));
    if (!updated.includes("Others")) setOtherRoleError("");
  };

  const handleLocationToggle = (location: string) => {
    const current = formData.locations || [];
    const updated = current.includes(location) ? current.filter((l: string) => l !== location) : [...current, location];
    setFormData(prev => ({ 
      ...prev, 
      locations: updated,
      otherLocation: updated.includes("Other") ? prev.otherLocation : "" 
    }));
    if (updated.length > 0) setShowLocationError(false);
    if (!updated.includes("Other")) setOtherLocationError("");
  };

  const resetForm = useCallback(() => {
    setFormData({ projectName: "", locations: [], otherLocation: "", roles: [], otherRole: "", status: "Active", jdFile: null });
    setEditingId(null);
    setShowLocationError(false);
    setOtherLocationError("");
    setOtherRoleError("");
    setJdError("");
    setProjectNameError("");
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setShowLocationError(false);
    setOtherLocationError("");
    setOtherRoleError("");
    setJdError("");
    setProjectNameError("");

    let hasError = false;

    const trimmedName = formData.projectName.trim().toLowerCase();
    const isDuplicate = requisitions.some(req => 
      req.projectName.trim().toLowerCase() === trimmedName && req.id !== editingId
    );

    if (isDuplicate) {
      setProjectNameError("Project Name already exists. Please enter a unique Project Name.");
      hasError = true;
    }

    if (formData.locations.length === 0) { setShowLocationError(true); hasError = true; }
    if (formData.locations.includes("Other") && !formData.otherLocation.trim()) { setOtherLocationError("Please enter a location."); hasError = true; }
    if (formData.roles.includes("Others") && !formData.otherRole.trim()) { setOtherRoleError("Please enter a role."); hasError = true; }
    if (!formData.jdFile) { setJdError("Job Description file is required."); hasError = true; }
    
    if (hasError) return;

    setIsLoading(true);
    try {
      const processedLocations = formData.locations.map((l: string) => l === "Other" ? formData.otherLocation.trim() : l);
      const processedRoles = formData.roles.map((r: string) => r === "Others" ? formData.otherRole.trim() : r);
      
      const data = {
        projectName: formData.projectName.trim(),
        locations: processedLocations,
        roles: processedRoles,
        status: formData.status,
        jdFileName: formData.jdFile?.name || null,
        jdFileType: formData.jdFile?.type || null,
        jdFileData: formData.jdFile?.data || null,
        updatedDate: serverTimestamp()
      };

      if (editingId) {
        await updateDoc(doc(db, "job_requisitions", editingId), data);
        toast({ title: "Success", description: "Project updated successfully." });
        if (formData.jdFile && formData.jdFile.data) {
          await logActivity({
            userId: user!.uid,
            userName: name!,
            userRole: role!,
            action: "JD Uploaded",
            stage: "Setup",
            targetType: "Project",
            targetId: editingId,
            targetName: data.projectName,
          });
        }
      } else {
        const newDocRef = await addDoc(collection(db, "job_requisitions"), { ...data, createdBy: role || "System", createdDate: serverTimestamp() });
        toast({ title: "Success", description: "Project created successfully." });

        await logActivity({
          userId: user!.uid,
          userName: name!,
          userRole: role!,
          action: "Project Created",
          stage: "Setup",
          targetType: "Project",
          targetId: newDocRef.id,
          targetName: data.projectName,
        });

        await logActivity({
            userId: user!.uid,
            userName: name!,
            userRole: role!,
            action: "JD Uploaded",
            stage: "Setup",
            targetType: "Project",
            targetId: newDocRef.id,
            targetName: data.projectName,
        });
      }
      setIsModalOpen(false);
      resetForm();
      await fetchRequisitions();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } finally {
      setIsLoading(false);
      setEditingId(null);
    }
  };

  const openJD = (req: any) => {
    if (!req.jdFileData) { toast({ variant: "destructive", title: "Error", description: "No JD file available." }); return; }
    try {
      const byteCharacters = atob(req.jdFileData);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i);
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: req.jdFileType });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    } catch (e) { toast({ variant: "destructive", title: "Error", description: "Could not open JD file." }); }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setIsLoading(true);
    try {
      await deleteDoc(doc(db, "job_requisitions", deleteId));
      toast({ title: "Success", description: "Project deleted successfully." });
      setDeleteId(null);
      await fetchRequisitions();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } finally {
      setIsLoading(false);
      setDeleteId(null);
    }
  };

  const startEdit = (req: any) => {
    setEditingId(req.id);
    
    // Process locations
    const initialLocations = req.locations || [];
    const standardLocs = initialLocations.filter((l: string) => STANDARD_LOCATIONS.includes(l));
    const customLocs = initialLocations.filter((l: string) => !STANDARD_LOCATIONS.includes(l));
    const mappedLocations = [...standardLocs];
    let otherLocVal = "";
    if (customLocs.length > 0) { mappedLocations.push("Other"); otherLocVal = customLocs[0]; }

    // Process roles
    const initialRoles = req.roles || [];
    const standardRoles = initialRoles.filter((r: string) => ROLES_OPTIONS.includes(r));
    const customRoles = initialRoles.filter((r: string) => !ROLES_OPTIONS.includes(r));
    const mappedRoles = [...standardRoles];
    let otherRoleVal = "";
    if (customRoles.length > 0) { mappedRoles.push("Others"); otherRoleVal = customRoles[0]; }

    setFormData({
      projectName: req.projectName,
      locations: mappedLocations,
      otherLocation: otherLocVal,
      roles: mappedRoles,
      otherRole: otherRoleVal,
      status: req.status || "Active",
      jdFile: req.jdFileData ? { name: req.jdFileName, type: req.jdFileType, data: req.jdFileData } : null
    });
    setIsModalOpen(true);
  };

  const isFormValid = formData.projectName.trim() && (formData.roles || []).length > 0;

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Page Header with Button Aligned Right */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pt-2 pb-4">
          <div className="flex flex-col">
            <h1 className="text-3xl font-headline font-bold text-foreground leading-tight tracking-tight">Job Requisitions</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage your active hiring projects and JD requirements.</p>
          </div>
          <Button onClick={() => { resetForm(); setIsModalOpen(true); }} className="gap-2 shrink-0">
            <Plus className="h-4 w-4" /> Create Project
          </Button>
        </div>

        {/* Filter Section */}
        <div className="flex flex-col md:flex-row items-end gap-4 bg-card p-4 rounded-lg shadow-sm border">
          <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-4 w-full">
            <div className="space-y-2">
              <label className="text-sm font-medium">Project Name</label>
              <Select onValueChange={setFilterProject} value={filterProject}>
                <SelectTrigger><SelectValue placeholder="All Projects" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Projects</SelectItem>
                  {projectOptions.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Location</label>
              <Select onValueChange={setFilterLocation} value={filterLocation}>
                <SelectTrigger><SelectValue placeholder="All Locations" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  {locationOptions.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Designation</label>
              <Select onValueChange={setFilterDesignation} value={filterDesignation}>
                <SelectTrigger><SelectValue placeholder="All Designations" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Designations</SelectItem>
                  {designationOptions.map(role => <SelectItem key={role} value={role}>{role}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Created By</label>
              <Select onValueChange={setFilterCreatedBy} value={filterCreatedBy}>
                <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="hr">HR</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {hasActiveFilters && (
            <Button 
              variant="secondary" 
              size="sm" 
              onClick={handleClearFilters}
              className="h-10 gap-2 text-xs font-semibold"
            >
              <XCircle className="h-4 w-4" />
              Clear Filters
            </Button>
          )}
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project Name</TableHead>
                  <TableHead>Project Location</TableHead>
                  <TableHead className="w-[200px]">Designation</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>JD</TableHead>
                  <TableHead>Created Date</TableHead>
                  <TableHead>Created By</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isDataLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center h-32">
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading projects...
                      </div>
                    </TableCell>
                  </TableRow>
                ) : totalRecords === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center h-32 text-muted-foreground">
                      {hasActiveFilters ? "No job requisitions found matching your filters." : "No projects available."}
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedRequisitions.map((req) => {
                    const displayStatus = (req.status === "Open" || !req.status) ? "Active" : req.status;
                    const roles = req.roles || [];
                    const locations = req.locations || [];
                    
                    const firstTwoLocs = locations.slice(0, 2);
                    const moreLocs = locations.slice(2);
                    
                    const firstTwoRoles = roles.slice(0, 2);
                    const moreRoles = roles.slice(2);

                    return (
                      <TableRow key={req.id}>
                        <TableCell className="font-medium">{req.projectName}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1 items-center max-w-[250px]">
                            {firstTwoLocs.map((l: string) => <Badge key={l} variant="outline">{l}</Badge>)}
                            {moreLocs.length > 0 && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="secondary" className="cursor-pointer">+{moreLocs.length} more</Badge>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  <div className="flex flex-col gap-1 p-1">
                                    {moreLocs.map((l: string) => <span key={l} className="text-xs">{l}</span>)}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1 items-center max-w-[200px]">
                            {firstTwoRoles.map((r: string) => <Badge key={r} variant="secondary">{r}</Badge>)}
                            {moreRoles.length > 0 && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="outline" className="cursor-pointer">+{moreRoles.length} more</Badge>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  <div className="flex flex-col gap-1 p-1">
                                    {moreRoles.map((r: string) => <span key={r} className="text-xs">{r}</span>)}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={displayStatus === "Active" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}>{displayStatus}</Badge>
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => openJD(req)} disabled={!req.jdFileData}><Eye className="h-4 w-4" /></Button>
                        </TableCell>
                        <TableCell>{isMounted && req.createdDate ? req.createdDate.toDate().toLocaleDateString() : "..."}</TableCell>
                        <TableCell className="capitalize">{req.createdBy || "N/A"}</TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu modal={false}>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={(e) => { 
                                e.preventDefault(); 
                                setTimeout(() => startEdit(req), 50); 
                              }}>
                                <Edit2 className="mr-2 h-4 w-4" /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                className="text-destructive" 
                                onSelect={(e) => { 
                                  e.preventDefault(); 
                                  setTimeout(() => setDeleteId(req.id), 50); 
                                }}
                              >
                                <Trash2 className="mr-2 h-4 w-4" /> Delete
                              </DropdownMenuItem>
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
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Rows per page:</span>
                <Select value={String(rowsPerPage)} onValueChange={(v) => { setRowsPerPage(Number(v)); setCurrentPage(1); }}>
                  <SelectTrigger className="h-8 w-[70px]">
                    <SelectValue placeholder={rowsPerPage} />
                  </SelectTrigger>
                  <SelectContent side="top">
                    {[10, 20, 30, 50].map((pageSize) => (
                      <SelectItem key={pageSize} value={String(pageSize)}>
                        {pageSize}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-6 lg:gap-8">
                <div className="flex w-[120px] items-center justify-center text-sm font-medium">
                  {totalRecords > 0 ? `${startIndex + 1}–${Math.min(startIndex + rowsPerPage, totalRecords)} of ${totalRecords}` : "0 of 0"}
                </div>
                <div className="flex items-center space-x-2">
                  <Button variant="outline" className="h-8 w-8 p-0" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}>
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" className="h-8 w-8 p-0" onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={currentPage === 1}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" className="h-8 w-8 p-0" onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages || totalRecords === 0}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" className="h-8 w-8 p-0" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages || totalRecords === 0}>
                    <ChevronsRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Dialog open={isModalOpen} onOpenChange={(open) => { 
          setIsModalOpen(open); 
          if (!open) {
            resetForm();
          }
        }}>
          <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit Project" : "New Project"}</DialogTitle>
              <DialogDescription>Define the role, locations, and shared project details.</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="space-y-2">
                <Label>Project Name</Label>
                <input 
                  type="hidden" 
                  name="dummy" 
                />
                <Input 
                  required 
                  value={formData.projectName} 
                  onChange={e => {
                    setFormData({...formData, projectName: e.target.value});
                    setProjectNameError("");
                  }} 
                  className={cn(projectNameError && "border-destructive focus-visible:ring-destructive")}
                />
                {projectNameError && <p className="text-xs text-destructive mt-1 font-medium">{projectNameError}</p>}
              </div>
              <div className="space-y-2">
                <Label>Location (Multi-select)</Label>
                <div className={cn("grid grid-cols-2 gap-2 p-2 border rounded-md", showLocationError && formData.locations.length === 0 && "border-destructive")}>
                  {LOCATION_OPTIONS.map(loc => (
                    <div key={loc} className="flex items-center space-x-2">
                      <Checkbox id={`loc-${loc}`} checked={(formData.locations || []).includes(loc)} onCheckedChange={() => handleLocationToggle(loc)} />
                      <Label htmlFor={`loc-${loc}`} className="text-sm cursor-pointer">{loc}</Label>
                    </div>
                  ))}
                </div>
                {showLocationError && formData.locations.length === 0 && <p className="text-xs text-destructive mt-1">Location is required.</p>}
              </div>
              {formData.locations.includes("Other") && (
                <div className="space-y-2">
                  <Label>Enter location</Label>
                  <Input placeholder="Enter location" value={formData.otherLocation} onChange={e => { setFormData({...formData, otherLocation: e.target.value}); if (e.target.value.trim()) setOtherLocationError(""); }} className={cn(otherLocationError && "border-destructive")} />
                  {otherLocationError && <p className="text-xs text-destructive mt-1">{otherLocationError}</p>}
                </div>
              )}
              <div className="space-y-2">
                <Label>Role (Multi-select)</Label>
                <div className="grid grid-cols-2 gap-2 p-2 border rounded-md">
                  {ROLES_OPTIONS.map(role => (
                    <div key={role} className="flex items-center space-x-2">
                      <Checkbox id={role} checked={(formData.roles || []).includes(role)} onCheckedChange={() => handleRoleToggle(role)} />
                      <Label htmlFor={role} className="text-sm cursor-pointer">{role}</Label>
                    </div>
                  ))}
                </div>
              </div>
              {formData.roles.includes("Others") && (
                <div className="space-y-2">
                  <Label>Enter Role</Label>
                  <Input 
                    placeholder="Enter role" 
                    value={formData.otherRole} 
                    onChange={e => { 
                      setFormData({...formData, otherRole: e.target.value}); 
                      if (e.target.value.trim()) setOtherRoleError(""); 
                    }} 
                    className={cn(otherRoleError && "border-destructive")} 
                  />
                  {otherRoleError && <p className="text-xs text-destructive mt-1">{otherRoleError}</p>}
                </div>
              )}
              <div className="space-y-2">
                <Label>Upload JD</Label>
                <Input type="file" accept=".pdf,.doc,.docx" onChange={handleFileChange} className={cn(jdError && "border-destructive")} />
                {jdError && <p className="text-xs text-destructive mt-1">{jdError}</p>}
                {formData.jdFile && <p className="text-xs font-medium text-primary">Selected: {formData.jdFile.name}</p>}
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={formData.status} onValueChange={v => setFormData({...formData, status: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="Active">Active</SelectItem><SelectItem value="Inactive">Inactive</SelectItem></SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={isLoading || !isFormValid}>{isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : (editingId ? "Update Project" : "Create Project")}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!deleteId} onOpenChange={(open) => { 
          if(!open) {
            setDeleteId(null);
          }
        }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure you want to delete this Job Requisition?</AlertDialogTitle>
              <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
              <Button variant="destructive" onClick={handleDelete} disabled={isLoading}>{isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : "Delete"}</Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}
