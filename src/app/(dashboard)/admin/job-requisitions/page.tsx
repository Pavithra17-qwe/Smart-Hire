"use client";

import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import {
  collection, addDoc, serverTimestamp, query, doc,
  updateDoc, deleteDoc, where, orderBy, onSnapshot,getDocs
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Eye, MoreVertical, XCircle, FileText, CheckCircle2, X } from "lucide-react";
import { logActivity } from "@/lib/activity-logger";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

const LOCATIONS_OPTIONS = ["Chennai", "Bangalore", "Remote"];
const ROLES_OPTIONS = ["Junior QA", "Senior QA", "DM"];

interface FormData {
  projectName:   string;
  location:      string;
  otherLocation: string;
  role:          string;
  otherRole:     string;
  status:        string;
  // JD — we store base64 data-URI in Firestore (consistent with requirements collection)
  jdFileName:    string;
  jdFileType:    string;
  jdFileData:    string;  // base64 data-URI  OR  https:// Storage URL
}

const EMPTY_FORM: FormData = {
  projectName: "", location: "", otherLocation: "",
  role: "", otherRole: "", status: "Active",
  jdFileName: "", jdFileType: "", jdFileData: "",
};

/* ─── Shared JD opener — works for base64 AND Firebase Storage URLs ───────── */
function openJDFile(jdFileData: string, jdFileName?: string) {
  if (!jdFileData) return;

  // Firebase Storage https URL — open directly in new tab
  if (jdFileData.startsWith("https://")) {
    window.open(jdFileData, "_blank", "noopener,noreferrer");
    return;
  }

  // Base64 data-URI
  try {
    const [meta, base64] = jdFileData.split(",");
    if (!base64) throw new Error("Invalid base64");
    const mimeMatch = meta.match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : "application/pdf";
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const blob  = new Blob([bytes], { type: mime });
    const url   = URL.createObjectURL(blob);

    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) {
      // Popup blocked — fallback download
      const a = Object.assign(document.createElement("a"), {
        href: url, target: "_blank", download: jdFileName || "JD.pdf",
      });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  } catch (err) {
    console.error("openJDFile error:", err);
    alert("Failed to open file. Please try again.");
  }
}

/* ─── Convert File → base64 data-URI ─────────────────────────────────────── */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

export default function JobRequisitions() {
  const { user, role, name } = useAuth();
  const { toast } = useToast();
  const searchParams = useSearchParams();

  const [requisitions,       setRequisitions]       = useState<any[]>([]);
  const [isLoading,          setIsLoading]          = useState(false);
  // FIX: separate state for file processing (reading base64), not "uploading to server"
  const [isProcessingFile,   setIsProcessingFile]   = useState(false);
  const [isModalOpen,        setIsModalOpen]        = useState(false);
  const [editingId,          setEditingId]          = useState<string | null>(null);
  const [page,               setPage]               = useState(0);
  const [rowsPerPage,        setRowsPerPage]        = useState(10);
  const [formData,           setFormData]           = useState<FormData>(EMPTY_FORM);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteTargetId,     setDeleteTargetId]     = useState<string | null>(null);
  const [openDropdownId,     setOpenDropdownId]     = useState<string | null>(null);

  const [filters, setFilters] = useState({
    projectName: "", location: "", designation: "", status: "", createdBy: "",
  });

  // ── Firestore real-time listener ─────────────────────────────────────────
  useEffect(() => {
    if (!user || !role) return;
    setIsLoading(true);

    const q = role === "agency"
      ? query(collection(db, "job_requisitions"), where("createdBy", "==", user.uid), orderBy("createdDate", "desc"))
      : query(collection(db, "job_requisitions"), orderBy("createdDate", "desc"));

    const unsub = onSnapshot(q,
      snap => { setRequisitions(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setIsLoading(false); },
      err  => { console.error("Firestore:", err); setIsLoading(false); }
    );
    return () => unsub();
  }, [user, role]);

  useEffect(() => {
    const pn = searchParams.get("projectName");
    if (pn) {
      setFilters(prev => ({ ...prev, projectName: decodeURIComponent(pn) }));
    }
  }, [searchParams]);

  // ── Filters ───────────────────────────────────────────────────────────────
  const handleFilterChange = (field: string, value: string) => {
    setFilters(p => ({ ...p, [field]: value === "all" ? "" : value }));
    setPage(0);
  };
  const handleClearFilters = () => {
    setFilters({ projectName: "", location: "", designation: "", status: "", createdBy: "" });
    setPage(0);
  };
  const hasActiveFilters = useMemo(() => Object.values(filters).some(Boolean), [filters]);

  const projectOptions   = useMemo(() => [...new Set(requisitions.map(r => r.projectName).filter(Boolean))], [requisitions]);
  const designationOpts  = useMemo(() => [...new Set([...ROLES_OPTIONS, ...requisitions.flatMap(r => r.roles || [])])], [requisitions]);

  const filteredReqs = useMemo(() => requisitions.filter(req =>
    (!filters.projectName  || req.projectName === filters.projectName) &&
    (!filters.location     || req.locations?.includes(filters.location)) &&
    (!filters.designation  || req.roles?.includes(filters.designation)) &&
    (!filters.status       || req.status === filters.status) &&
    (!filters.createdBy    || req.createdByRole === filters.createdBy)
  ), [requisitions, filters]);

  const total      = filteredReqs.length;
  const paginated  = filteredReqs.slice(page * rowsPerPage, (page + 1) * rowsPerPage);

  // ── Form helpers ──────────────────────────────────────────────────────────
  const resetForm = () => { setFormData(EMPTY_FORM); setEditingId(null); };

  const handleModalOpen = (id: string | null = null) => {
    if (id) {
      const req = requisitions.find(r => r.id === id);
      if (req) {
        setEditingId(id);
        const loc = req.locations?.[0] || "";
        const rol = req.roles?.[0]     || "";
        setFormData({
          projectName:   req.projectName || "",
          location:      LOCATIONS_OPTIONS.includes(loc) ? loc : loc ? "Other" : "",
          otherLocation: LOCATIONS_OPTIONS.includes(loc) ? "" : loc,
          role:          ROLES_OPTIONS.includes(rol) ? rol : rol ? "Others" : "",
          otherRole:     ROLES_OPTIONS.includes(rol) ? "" : rol,
          status:        req.status     || "Active",
          jdFileName:    req.jdFileName || "",
          jdFileType:    req.jdFileType || "",
          jdFileData:    req.jdFileData || "",
        });
      }
    } else {
      resetForm();
    }
    setIsModalOpen(true);
  };

  const handleModalCancel = () => { setIsModalOpen(false); resetForm(); };

  // ── FIX: File handler — reads to base64 locally, NO external upload ──────
  // This is instant and never "gets stuck loading".
  // The base64 is stored directly in Firestore (same as requirements collection).
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowed = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (!allowed.includes(file.type)) {
      toast({ variant: "destructive", title: "Invalid file", description: "Only PDF and Word documents are allowed." });
      return;
    }

    // Show filename immediately
    setFormData(p => ({ ...p, jdFileName: file.name, jdFileType: file.type, jdFileData: "" }));
    setIsProcessingFile(true);

    try {
      // FIX: Read file as base64 — this is synchronous and never hangs
      const base64 = await fileToBase64(file);
      setFormData(p => ({ ...p, jdFileData: base64 }));
      toast({ title: "File ready", description: `${file.name} loaded successfully.` });
    } catch (err: any) {
      toast({ variant: "destructive", title: "File error", description: err.message });
      setFormData(p => ({ ...p, jdFileName: "", jdFileType: "", jdFileData: "" }));
    } finally {
      setIsProcessingFile(false);
      // Reset input so same file can be re-selected
      e.target.value = "";
    }
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    const finalLocation = formData.location === "Other" ? formData.otherLocation.trim() : formData.location;
    const finalRole     = formData.role === "Others"    ? formData.otherRole.trim()     : formData.role;

    if (!formData.projectName.trim() || !finalLocation || !finalRole) {
      toast({ variant: "destructive", title: "Validation Error", description: "Project Name, Location, and Role are required." });
      return;
    }

    setIsLoading(true);
    const data: any = {
      projectName: formData.projectName.trim(),
      locations:   [finalLocation],
      roles:       [finalRole],
      status:      formData.status,
      // Store base64 directly — consistent with requirements collection, no Storage needed
      jdFileName:  formData.jdFileName || null,
      jdFileType:  formData.jdFileType || null,
      jdFileData:  formData.jdFileData || null,
    };

    try {
      if (!editingId) {
        const dupProjectSnap = await getDocs(
          query(
            collection(db, "job_requisitions"),
            where("projectName", "==", data.projectName)
          )
        );
        if (!dupProjectSnap.empty) {
          toast({
            variant: "destructive",
            title: "Duplicate Project",
            description: `A project named "${data.projectName}" already exists.`,
          });
          setIsLoading(false);
          return;
        }
      }
      if (editingId) {
        await updateDoc(doc(db, "job_requisitions", editingId), { ...data, updatedDate: serverTimestamp() });
        toast({ title: "Success", description: "Project updated successfully." });
        if (user && name && role) {
          await logActivity({ userId: user.uid, userName: name, userRole: role,
            action: "Project Edited", stage: "Setup", targetType: "Project",
            targetId: editingId, targetName: data.projectName });
        }
      } else {
        const ref = await addDoc(collection(db, "job_requisitions"), {
          ...data, createdBy: user!.uid, createdByRole: role!, createdByName: name!, createdDate: serverTimestamp(),
        });
        toast({ title: "Success", description: "Project created successfully." });
        if (user && name && role) {
          await logActivity({ userId: user.uid, userName: name, userRole: role,
            action: "Project Created", stage: "Setup", targetType: "Project",
            targetId: ref.id, targetName: data.projectName });
        }
      }
      setIsModalOpen(false);
      resetForm();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    } finally {
      setIsLoading(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteTargetId) return;
    try {
      await deleteDoc(doc(db, "job_requisitions", deleteTargetId));
      toast({ title: "Success", description: "Project deleted." });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to delete." });
    }
    setIsDeleteDialogOpen(false);
    setDeleteTargetId(null);
  };

  const handleEditAction   = (id: string) => { setOpenDropdownId(null); setTimeout(() => handleModalOpen(id), 50); };
  const handleDeleteAction = (id: string) => { setOpenDropdownId(null); setTimeout(() => { setDeleteTargetId(id); setIsDeleteDialogOpen(true); }, 50); };

  return (
    <div className="p-6 sm:p-8 space-y-6 bg-background">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Job Requisitions</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your active hiring projects and JD requirements.</p>
        </div>
        <Button onClick={() => handleModalOpen()} className="gap-2 shrink-0">
          <Plus className="h-4 w-4" /> Create Project
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 flex-grow">
          {[
            { field: "projectName", placeholder: "All Projects",     options: projectOptions as string[] },
            { field: "location",    placeholder: "All Locations",    options: LOCATIONS_OPTIONS },
            { field: "designation", placeholder: "All Designations", options: designationOpts as string[] },
          ].map(({ field, placeholder, options }) => (
            <Select key={field} value={(filters as any)[field] || "all"} onValueChange={v => handleFilterChange(field, v)}>
              <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{placeholder}</SelectItem>
                {options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          ))}
          <Select value={filters.status || "all"} onValueChange={v => handleFilterChange("status", v)}>
            <SelectTrigger><SelectValue placeholder="All Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="Active">Active</SelectItem>
              <SelectItem value="Inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.createdBy || "all"} onValueChange={v => handleFilterChange("createdBy", v)}>
            <SelectTrigger><SelectValue placeholder="All Creators" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Creators</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="hr">HR</SelectItem>
              <SelectItem value="agency">Agency</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {hasActiveFilters && (
          <Button variant="ghost" onClick={handleClearFilters} className="h-10 gap-2 text-sm font-semibold border">
            <XCircle className="h-4 w-4" /> Clear Filters
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {["Project Name","Location","Designation","Status","JD","Created Date","Created By","Actions"].map(h => (
                <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {isLoading ? (
              <tr><td colSpan={8} className="text-center py-8">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
              </td></tr>
            ) : paginated.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-12 text-sm text-muted-foreground">
                {hasActiveFilters ? "No projects match your filters." : "No projects yet. Click Create Project to get started."}
              </td></tr>
            ) : paginated.map(req => (
              <tr key={req.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap font-medium text-sm">{req.projectName || "—"}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{req.locations?.join(", ") || "—"}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{req.roles?.join(", ") || "—"}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <span className={`px-2.5 py-0.5 inline-flex text-xs font-semibold rounded-full ${
                    req.status === "Active" ? "bg-blue-100 text-blue-800" : "bg-red-100 text-red-800"
                  }`}>{req.status}</span>
                </td>

                {/* ── JD column FIX ── */}
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {req.jdFileData && req.jdFileData.length > 10 ? (
                    // FIX: onClick calls openJDFile directly — no navigation, no refresh needed
                    <button
                      type="button"
                      onClick={() => openJDFile(req.jdFileData, req.jdFileName)}
                      title={req.jdFileName || "View JD"}
                      className="flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 transition-colors"
                    >
                      <Eye className="h-4 w-4" />
                      <span className="text-xs hidden sm:inline truncate max-w-[80px]">
                        {req.jdFileName || "View"}
                      </span>
                    </button>
                  ) : (
                    <span className="text-gray-400 text-xs">No file</span>
                  )}
                </td>

                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  {req.createdDate?.toDate?.().toLocaleDateString("en-IN") || "—"}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  {req.createdByName || req.createdByRole || "—"}
                </td>
                <td className="px-6 py-4 text-right">
                  <DropdownMenu open={openDropdownId === req.id} onOpenChange={o => setOpenDropdownId(o ? req.id : null)}>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleEditAction(req.id)}>Edit</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleDeleteAction(req.id)}
                        className="text-red-600 focus:text-red-600 focus:bg-red-50">Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex justify-end items-center gap-3 px-2">
        <span className="text-sm text-muted-foreground">Rows per page:</span>
        <select value={rowsPerPage} onChange={e => { setRowsPerPage(Number(e.target.value)); setPage(0); }}
          className="border rounded px-2 py-1 text-sm">
          {[5,10,20].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <span className="text-sm text-muted-foreground">
          {total === 0 ? 0 : page * rowsPerPage + 1}–{Math.min((page+1)*rowsPerPage, total)} of {total}
        </span>
        <div className="flex gap-1">
          {[
            { l:"<<", a:() => setPage(0),                           d: page === 0 },
            { l:"<",  a:() => setPage(p => Math.max(p-1,0)),        d: page === 0 },
            { l:">",  a:() => setPage(p => (p+1)*rowsPerPage < total ? p+1 : p), d: (page+1)*rowsPerPage >= total },
            { l:">>", a:() => setPage(Math.floor((total-1)/rowsPerPage)),          d: (page+1)*rowsPerPage >= total },
          ].map(b => (
            <button key={b.l} onClick={b.a} disabled={b.d}
              className="w-8 h-8 border rounded text-sm disabled:opacity-40 disabled:cursor-not-allowed">{b.l}</button>
          ))}
        </div>
      </div>

      {/* ── Create / Edit Modal ── */}
      <Dialog open={isModalOpen} onOpenChange={open => { if (!open) handleModalCancel(); }}>
        <DialogContent className="sm:max-w-[580px] p-0">
          <DialogHeader className="p-6 pb-4">
            <DialogTitle className="text-xl font-bold">
              {editingId ? "Edit Project" : "New Project"}
            </DialogTitle>
            <p className="text-sm text-muted-foreground pt-1">
              Define the role, location, and upload the JD file.
            </p>
          </DialogHeader>

          <div className="px-6 pb-6 space-y-5 max-h-[60vh] overflow-y-auto">
            {/* Project Name */}
            <div className="space-y-2">
              <Label>Project Name <span className="text-red-500">*</span></Label>
              <Input value={formData.projectName}
                onChange={e => setFormData(p => ({ ...p, projectName: e.target.value }))}
                placeholder="e.g., Deloitte Q2 Hiring" />
            </div>

            {/* Location */}
            <div className="space-y-2">
              <Label>Location <span className="text-red-500">*</span></Label>
              <div className="p-4 border rounded-md">
                <RadioGroup value={formData.location}
                  onValueChange={v => setFormData(p => ({ ...p, location: v }))}
                  className="grid grid-cols-2 gap-3">
                  {LOCATIONS_OPTIONS.map(loc => (
                    <div key={loc} className="flex items-center space-x-2">
                      <RadioGroupItem value={loc} id={`loc-${loc}`} />
                      <Label htmlFor={`loc-${loc}`} className="font-normal cursor-pointer">{loc}</Label>
                    </div>
                  ))}
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="Other" id="loc-other" />
                    <Label htmlFor="loc-other" className="font-normal cursor-pointer">Other</Label>
                  </div>
                </RadioGroup>
                {formData.location === "Other" && (
                  <Input placeholder="Specify location" value={formData.otherLocation}
                    onChange={e => setFormData(p => ({ ...p, otherLocation: e.target.value }))} className="mt-3" />
                )}
              </div>
            </div>

            {/* Role */}
            <div className="space-y-2">
              <Label>Role <span className="text-red-500">*</span></Label>
              <div className="p-4 border rounded-md">
                <RadioGroup value={formData.role}
                  onValueChange={v => setFormData(p => ({ ...p, role: v }))}
                  className="grid grid-cols-2 gap-3">
                  {ROLES_OPTIONS.map(r => (
                    <div key={r} className="flex items-center space-x-2">
                      <RadioGroupItem value={r} id={`role-${r}`} />
                      <Label htmlFor={`role-${r}`} className="font-normal cursor-pointer">{r}</Label>
                    </div>
                  ))}
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="Others" id="role-others" />
                    <Label htmlFor="role-others" className="font-normal cursor-pointer">Others</Label>
                  </div>
                </RadioGroup>
                {formData.role === "Others" && (
                  <Input placeholder="Specify role" value={formData.otherRole}
                    onChange={e => setFormData(p => ({ ...p, otherRole: e.target.value }))} className="mt-3" />
                )}
              </div>
            </div>

            {/* ── JD Upload FIX ── */}
            <div className="space-y-2">
              <Label>Upload JD (PDF / Word)</Label>
              <div className="border rounded-md overflow-hidden">
                {/* Picker row */}
                <div className="flex items-center">
                  <span className="flex-1 text-sm text-muted-foreground px-3 py-2 truncate">
                    {isProcessingFile ? "Reading file…" : formData.jdFileName || "No file chosen"}
                  </span>
                  <Label htmlFor="jdFileInput"
                    className="bg-gray-100 border-l px-4 py-2 text-sm cursor-pointer hover:bg-gray-200 shrink-0 flex items-center gap-1.5">
                    {isProcessingFile
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <FileText className="h-3.5 w-3.5" />}
                    Choose File
                  </Label>
                  <Input id="jdFileInput" type="file" className="hidden"
                    accept=".pdf,.doc,.docx" onChange={handleFileChange} disabled={isProcessingFile} />
                </div>

                {/* ── FIX: Preview row shown immediately — no refresh needed ── */}
                {formData.jdFileData && !isProcessingFile && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border-t text-xs text-green-700">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate flex-1">Ready: {formData.jdFileName}</span>
                    <button type="button"
                      onClick={() => openJDFile(formData.jdFileData, formData.jdFileName)}
                      className="underline shrink-0 hover:no-underline flex items-center gap-1">
                      <Eye className="h-3 w-3" /> Preview
                    </button>
                    <button type="button"
                      onClick={() => setFormData(p => ({ ...p, jdFileName: "", jdFileType: "", jdFileData: "" }))}
                      className="text-red-500 hover:text-red-700 shrink-0">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                File is stored securely. The eye icon will open it immediately after saving.
              </p>
            </div>

            {/* Status */}
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={formData.status} onValueChange={v => setFormData(p => ({ ...p, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="px-6 py-4 bg-gray-50 border-t sm:justify-end gap-2">
            <Button variant="outline" onClick={handleModalCancel} disabled={isLoading || isProcessingFile}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isLoading || isProcessingFile}
              className="bg-[#8A2BE2] hover:bg-[#7f26cc] text-white">
              {isLoading
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…</>
                : editingId ? "Update Project" : "Create Project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Confirm Deletion</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Are you sure? This cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsDeleteDialogOpen(false); setDeleteTargetId(null); }}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}