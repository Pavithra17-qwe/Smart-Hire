"use client";

import { useState, useEffect, useMemo } from "react";
import {
  collection,
  addDoc,
  serverTimestamp,
  query,
  doc,
  updateDoc,
  deleteDoc,
  where,
  orderBy,
  onSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Eye, MoreVertical, XCircle, FileText } from "lucide-react";
import { logActivity } from "@/lib/activity-logger";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase";

const LOCATIONS_OPTIONS = ["Chennai", "Bangalore", "Remote"];
const ROLES_OPTIONS = ["Junior QA", "Senior QA", "DM"];

interface FormData {
  projectName: string;
  location: string;
  otherLocation: string;
  role: string;
  otherRole: string;
  status: string;
  // We store the final download URL (string) — not base64, not File object
  jdFileName: string;
  jdFileType: string;
  jdFileData: string; // Firebase Storage download URL
}

const EMPTY_FORM: FormData = {
  projectName: "",
  location: "",
  otherLocation: "",
  role: "",
  otherRole: "",
  status: "Active",
  jdFileName: "",
  jdFileType: "",
  jdFileData: "",
};

export default function JobRequisitions() {
  const { user, role, name } = useAuth();
  const { toast } = useToast();

  const [requisitions, setRequisitions]         = useState<any[]>([]);
  const [isLoading, setIsLoading]               = useState(false);
  const [isUploading, setIsUploading]           = useState(false); // separate upload spinner
  const [isModalOpen, setIsModalOpen]           = useState(false);
  const [editingId, setEditingId]               = useState<string | null>(null);
  const [page, setPage]                         = useState(0);
  const [rowsPerPage, setRowsPerPage]           = useState(10);
  const [formData, setFormData]                 = useState<FormData>(EMPTY_FORM);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId]     = useState<string | null>(null);
  const [openDropdownId, setOpenDropdownId]     = useState<string | null>(null);

  const [filters, setFilters] = useState({
    projectName: "",
    location: "",
    designation: "",
    status: "",
    createdBy: "",
  });

  // ── Firestore listener ───────────────────────────────────────────────────
  useEffect(() => {
    if (!user || !role) return;
    setIsLoading(true);

    // Agency only sees their own; everyone else sees all
    const q =
      role === "agency"
        ? query(
            collection(db, "job_requisitions"),
            where("createdBy", "==", user.uid),
            orderBy("createdDate", "desc")
          )
        : query(
            collection(db, "job_requisitions"),
            orderBy("createdDate", "desc")
          );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setRequisitions(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setIsLoading(false);
      },
      (err) => {
        console.error("Firestore error:", err);
        setIsLoading(false);
      }
    );
    return () => unsub();
  }, [user, role]);

  // ── Filters ───────────────────────────────────────────────────────────────
  const handleFilterChange = (field: string, value: string) => {
    setFilters((prev) => ({ ...prev, [field]: value === "all" ? "" : value }));
    setPage(0);
  };
  const handleClearFilters = () => {
    setFilters({ projectName: "", location: "", designation: "", status: "", createdBy: "" });
    setPage(0);
  };
  const hasActiveFilters = useMemo(() => Object.values(filters).some(Boolean), [filters]);

  const projectFilterOptions = useMemo(
    () => Array.from(new Set(requisitions.map((r) => r.projectName).filter(Boolean))),
    [requisitions]
  );
  const allDesignations = useMemo(
    () => Array.from(new Set([...ROLES_OPTIONS, ...requisitions.flatMap((r) => r.roles || [])])),
    [requisitions]
  );

  const filteredRequisitions = useMemo(() => {
    return requisitions.filter((req) => {
      const matchProject  = !filters.projectName  || req.projectName === filters.projectName;
      const matchLocation = !filters.location     || req.locations?.includes(filters.location);
      const matchDesig    = !filters.designation  || req.roles?.includes(filters.designation);
      const matchStatus   = !filters.status       || req.status === filters.status;
      const matchCreator  = !filters.createdBy    || req.createdByRole === filters.createdBy;
      return matchProject && matchLocation && matchDesig && matchStatus && matchCreator;
    });
  }, [requisitions, filters]);

  const total = filteredRequisitions.length;
  const paginatedData = filteredRequisitions.slice(page * rowsPerPage, (page + 1) * rowsPerPage);

  // ── Form helpers ──────────────────────────────────────────────────────────
  const resetForm = () => {
    setFormData(EMPTY_FORM);
    setEditingId(null);
  };

  const handleModalOpen = (id: string | null = null) => {
    if (id) {
      const req = requisitions.find((r) => r.id === id);
      if (req) {
        setEditingId(id);
        const loc = req.locations?.[0] || "";
        const rol = req.roles?.[0] || "";
        setFormData({
          projectName:   req.projectName || "",
          location:      LOCATIONS_OPTIONS.includes(loc) ? loc : loc ? "Other" : "",
          otherLocation: LOCATIONS_OPTIONS.includes(loc) ? "" : loc,
          role:          ROLES_OPTIONS.includes(rol) ? rol : rol ? "Others" : "",
          otherRole:     ROLES_OPTIONS.includes(rol) ? "" : rol,
          status:        req.status || "Active",
          jdFileName:    req.jdFileName || "",
          jdFileType:    req.jdFileType || "",
          jdFileData:    req.jdFileData || "", // existing URL
        });
      }
    } else {
      resetForm();
    }
    setIsModalOpen(true);
  };

  const handleModalCancel = () => {
    setIsModalOpen(false);
    resetForm();
  };

  // ── FILE UPLOAD FIX ───────────────────────────────────────────────────────
  // The original code had a nested function that was never called.
  // This version: picks the file → uploads to Firebase Storage → saves download URL.
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Accepted types: pdf, doc, docx
    const allowed = ["application/pdf", "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
    if (!allowed.includes(file.type)) {
      toast({ variant: "destructive", title: "Invalid file", description: "Only PDF and Word documents are allowed." });
      return;
    }

    // Show filename immediately so user gets feedback
    setFormData((prev) => ({ ...prev, jdFileName: file.name, jdFileType: file.type, jdFileData: "" }));
    setIsUploading(true);

    try {
      const storageRef = ref(storage, `jdFiles/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);

      // Save the download URL — this is what we store in Firestore
      setFormData((prev) => ({ ...prev, jdFileData: downloadURL }));
      toast({ title: "File uploaded", description: `${file.name} uploaded successfully.` });
    } catch (err: any) {
      console.error("Upload error:", err);
      toast({ variant: "destructive", title: "Upload failed", description: err.message });
      setFormData((prev) => ({ ...prev, jdFileName: "", jdFileType: "", jdFileData: "" }));
    } finally {
      setIsUploading(false);
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
      // Store file info — jdFileData is a Firebase Storage download URL
      jdFileName:  formData.jdFileName || null,
      jdFileType:  formData.jdFileType || null,
      jdFileData:  formData.jdFileData || null, // URL — viewable from anywhere
    };

    try {
      if (editingId) {
        await updateDoc(doc(db, "job_requisitions", editingId), { ...data, updatedDate: serverTimestamp() });
        toast({ title: "Success", description: "Project updated successfully." });
        if (user && name && role) {
          await logActivity({
            userId: user.uid, userName: name, userRole: role,
            action: "Project Edited", stage: "Setup",
            targetType: "Project", targetId: editingId, targetName: data.projectName,
          });
        }
      } else {
        const fullData = {
          ...data,
          createdBy:     user!.uid,
          createdByRole: role!,
          createdByName: name!,
          createdDate:   serverTimestamp(),
        };
        const newDocRef = await addDoc(collection(db, "job_requisitions"), fullData);
        toast({ title: "Success", description: "Project created successfully." });
        if (user && name && role) {
          await logActivity({
            userId: user.uid, userName: name, userRole: role,
            action: "Project Created", stage: "Setup",
            targetType: "Project", targetId: newDocRef.id, targetName: data.projectName,
          });
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
      toast({ title: "Success", description: "Project deleted successfully." });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to delete project." });
    }
    setIsDeleteDialogOpen(false);
    setDeleteTargetId(null);
  };

  const handleEditAction = (id: string) => {
    setOpenDropdownId(null);
    setTimeout(() => handleModalOpen(id), 50);
  };
  const handleDeleteAction = (id: string) => {
    setOpenDropdownId(null);
    setTimeout(() => { setDeleteTargetId(id); setIsDeleteDialogOpen(true); }, 50);
  };

  // ── View JD — works for both Storage URL and legacy base64 ───────────────
  const handleViewJd = (req: any) => {
    if (!req.jdFileData) return;
    // Firebase Storage URLs start with https:// — open directly
    // Legacy base64 from requirements page — open in iframe
    window.open(req.jdFileData, "_blank");
  };

  return (
    <div className="p-6 sm:p-8 space-y-6 bg-background">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Job Requisitions</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your active hiring projects and JD requirements.</p>
        </div>
        <Button onClick={() => handleModalOpen()} className="gap-2 shrink-0">
          <Plus className="h-4 w-4" /> Create Project
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 flex-grow">
          <Select value={filters.projectName || "all"} onValueChange={v => handleFilterChange("projectName", v)}>
            <SelectTrigger><SelectValue placeholder="All Projects" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {projectFilterOptions.map(p => <SelectItem key={p as string} value={p as string}>{p as string}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={filters.location || "all"} onValueChange={v => handleFilterChange("location", v)}>
            <SelectTrigger><SelectValue placeholder="All Locations" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Locations</SelectItem>
              {LOCATIONS_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={filters.designation || "all"} onValueChange={v => handleFilterChange("designation", v)}>
            <SelectTrigger><SelectValue placeholder="All Designations" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Designations</SelectItem>
              {allDesignations.map(o => <SelectItem key={o as string} value={o as string}>{o as string}</SelectItem>)}
            </SelectContent>
          </Select>

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
              {["Project Name", "Location", "Designation", "Status", "JD", "Created Date", "Created By", "Actions"].map(h => (
                <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {isLoading ? (
              <tr>
                <td colSpan={8} className="text-center py-8">
                  <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                </td>
              </tr>
            ) : paginatedData.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-12 text-sm text-muted-foreground">
                  {hasActiveFilters ? "No projects match your filters." : "No projects yet. Click Create Project to get started."}
                </td>
              </tr>
            ) : paginatedData.map(req => (
              <tr key={req.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap font-medium text-sm">
                  {req.projectName?.trim() || "N/A"}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  {req.locations?.join(", ") || "—"}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  {req.roles?.join(", ") || "—"}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <span className={`px-2.5 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full ${
                    req.status === "Active"
                      ? "bg-blue-100 text-blue-800"
                      : "bg-red-100 text-red-800"
                  }`}>
                    {req.status}
                  </span>
                </td>

                {/* JD column — FIX: show eye icon for any non-empty jdFileData */}
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {req.jdFileData ? (
                    <button
                      onClick={() => handleViewJd(req)}
                      title={req.jdFileName || "View JD"}
                      className="flex items-center gap-1.5 text-primary hover:text-primary/80 transition-colors"
                    >
                      <Eye className="h-5 w-5" />
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
                  {req.createdByRole === "agency"
                    ? req.createdByName || "Agency"
                    : req.createdByRole === "hr"
                    ? req.createdByName || "HR"
                    : "Admin"}
                </td>
                <td className="px-6 py-4 text-right">
                  <DropdownMenu
                    open={openDropdownId === req.id}
                    onOpenChange={open => setOpenDropdownId(open ? req.id : null)}
                  >
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleEditAction(req.id)}>Edit</DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleDeleteAction(req.id)}
                        className="text-red-600 focus:text-red-600 focus:bg-red-50"
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex justify-end items-center gap-3 px-4 py-2">
        <span className="text-sm text-muted-foreground">Rows per page:</span>
        <select
          value={rowsPerPage}
          onChange={e => { setRowsPerPage(Number(e.target.value)); setPage(0); }}
          className="border rounded px-2 py-1 text-sm"
        >
          {[5, 10, 20].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <span className="text-sm text-muted-foreground">
          {total === 0 ? 0 : page * rowsPerPage + 1}–{Math.min((page + 1) * rowsPerPage, total)} of {total}
        </span>
        <div className="flex gap-1">
          {[
            { label: "<<", action: () => setPage(0),                        disabled: page === 0 },
            { label: "<",  action: () => setPage(p => Math.max(p - 1, 0)), disabled: page === 0 },
            { label: ">",  action: () => setPage(p => (p + 1) * rowsPerPage < total ? p + 1 : p), disabled: (page + 1) * rowsPerPage >= total },
            { label: ">>", action: () => setPage(Math.floor((total - 1) / rowsPerPage)),           disabled: (page + 1) * rowsPerPage >= total },
          ].map(btn => (
            <button
              key={btn.label}
              onClick={btn.action}
              disabled={btn.disabled}
              className="px-2 py-1 border rounded text-sm disabled:opacity-40"
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Create / Edit Modal ── */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-[580px] p-0">
          <DialogHeader className="p-6 pb-4">
            <DialogTitle className="text-xl font-bold">
              {editingId ? "Edit Project" : "New Project"}
            </DialogTitle>
            <p className="text-sm text-muted-foreground pt-1">
              Define the role, location, and upload the JD file.
            </p>
          </DialogHeader>

          <div className="px-6 pb-6 space-y-5">
            {/* Project name */}
            <div className="space-y-2">
              <Label htmlFor="projectName">Project Name <span className="text-red-500">*</span></Label>
              <Input
                id="projectName"
                value={formData.projectName}
                onChange={e => setFormData(p => ({ ...p, projectName: e.target.value }))}
                placeholder="e.g., Deloitte Q2 Hiring"
              />
            </div>

            {/* Location */}
            <div className="space-y-2">
              <Label>Location <span className="text-red-500">*</span></Label>
              <div className="p-4 border rounded-md">
                <RadioGroup
                  value={formData.location}
                  onValueChange={v => setFormData(p => ({ ...p, location: v }))}
                  className="grid grid-cols-2 gap-3"
                >
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
                  <Input
                    placeholder="Specify location"
                    value={formData.otherLocation}
                    onChange={e => setFormData(p => ({ ...p, otherLocation: e.target.value }))}
                    className="mt-3"
                  />
                )}
              </div>
            </div>

            {/* Role */}
            <div className="space-y-2">
              <Label>Role <span className="text-red-500">*</span></Label>
              <div className="p-4 border rounded-md">
                <RadioGroup
                  value={formData.role}
                  onValueChange={v => setFormData(p => ({ ...p, role: v }))}
                  className="grid grid-cols-2 gap-3"
                >
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
                  <Input
                    placeholder="Specify role"
                    value={formData.otherRole}
                    onChange={e => setFormData(p => ({ ...p, otherRole: e.target.value }))}
                    className="mt-3"
                  />
                )}
              </div>
            </div>

            {/* JD Upload — FIXED */}
            <div className="space-y-2">
              <Label>Upload JD (PDF / Word)</Label>
              <div className="border rounded-md overflow-hidden">
                {/* File picker row */}
                <div className="flex items-center">
                  <span className="flex-1 text-sm text-muted-foreground px-3 py-2 truncate">
                    {isUploading
                      ? "Uploading…"
                      : formData.jdFileName || "No file chosen"}
                  </span>
                  <Label
                    htmlFor="jdFileInput"
                    className="bg-gray-100 border-l px-4 py-2 text-sm cursor-pointer hover:bg-gray-200 shrink-0 flex items-center gap-1.5"
                  >
                    {isUploading
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <FileText className="h-3.5 w-3.5" />}
                    Choose File
                  </Label>
                  <Input
                    id="jdFileInput"
                    type="file"
                    className="hidden"
                    accept=".pdf,.doc,.docx"
                    onChange={handleFileChange}
                    disabled={isUploading}
                  />
                </div>

                {/* Preview row — shown after successful upload */}
                {formData.jdFileData && !isUploading && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border-t text-xs text-green-700">
                    <Eye className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate flex-1">Uploaded: {formData.jdFileName}</span>
                    <button
                      type="button"
                      onClick={() => window.open(formData.jdFileData, "_blank")}
                      className="underline shrink-0 hover:no-underline"
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData(p => ({ ...p, jdFileName: "", jdFileType: "", jdFileData: "" }))}
                      className="text-red-500 shrink-0 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
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

          <DialogFooter className="px-6 py-4 bg-gray-50 border-t sm:justify-end space-x-2">
            <Button variant="outline" onClick={handleModalCancel} disabled={isLoading || isUploading}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isLoading || isUploading}
              className="bg-[#8A2BE2] hover:bg-[#7f26cc] text-white"
            >
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
          <DialogHeader>
            <DialogTitle>Confirm Deletion</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete this project? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsDeleteDialogOpen(false); setDeleteTargetId(null); }}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}