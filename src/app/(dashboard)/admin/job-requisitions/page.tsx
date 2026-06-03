"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import {
  collection, addDoc, serverTimestamp, query, doc,
  updateDoc, deleteDoc, where, orderBy, onSnapshot, getDocs
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Eye, MoreVertical, XCircle, Trash2, Code2, AlignLeft, ChevronDown } from "lucide-react";
import { logActivity } from "@/lib/activity-logger";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";

// ─── Constants ────────────────────────────────────────────────────────────────
const LOCATIONS_OPTIONS = ["Chennai", "Bangalore", "Remote"];
const ROLES_OPTIONS = ["Junior QA", "Senior QA", "DM"];
const CODING_LANGUAGES = ["JavaScript", "TypeScript", "Java", "Python", "C#"];

// ─── Types ────────────────────────────────────────────────────────────────────
interface QuestionItem {
  id: string;
  type: "theory" | "coding";
  text: string;
  languages?: string[];
  timerMinutes?: string;
}

interface AgencyUser {
  uid: string;
  displayName?: string;
  email?: string;
  name?: string;
  role: string;
}

interface FormData {
  projectName:      string;
  location:         string;
  otherLocation:    string;
  role:             string;
  otherRole:        string;
  status:           string;
  jdFileName:       string;
  jdFileType:       string;
  jdFileData:       string;
  assignedAgencies: string[];
  questions:        QuestionItem[];
}

const EMPTY_FORM: FormData = {
  projectName: "", location: "", otherLocation: "",
  role: "", otherRole: "", status: "Active",
  jdFileName: "", jdFileType: "text", jdFileData: "",
  assignedAgencies: [],
  questions: [{ id: crypto.randomUUID(), type: "theory", text: "" }],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildQuestionsPayload(questions: QuestionItem[]) {
  return questions
    .filter((q) => q.text.trim())
    .map((q) => ({
      type: q.type,
      text: q.text.trim(),
      ...(q.type === "coding"
        ? {
            languages: q.languages ?? ["JavaScript"],
            timerMinutes: parseInt(q.timerMinutes ?? "") || 30,
          }
        : {}),
    }));
}

function restoreQuestionsFromDoc(doc: any): QuestionItem[] {
  if (Array.isArray(doc.questions) && doc.questions.length > 0) {
    if (typeof doc.questions[0] === "object" && "type" in doc.questions[0]) {
      return doc.questions.map((q: any) => ({
        id: crypto.randomUUID(),
        type: q.type ?? "theory",
        text: q.text ?? "",
        languages: q.languages,
        timerMinutes: q.timerMinutes != null ? String(q.timerMinutes) : undefined,
      }));
    }
    // Legacy: plain string array → theory items
    return doc.questions.map((text: string) => ({
      id: crypto.randomUUID(),
      type: "theory" as const,
      text,
    }));
  }
  return [{ id: crypto.randomUUID(), type: "theory", text: "" }];
}

function openJDFile(jdFileData: string, jdFileName?: string) {
  if (!jdFileData) return;
  if (jdFileData.startsWith("https://")) {
    window.open(jdFileData, "_blank", "noopener,noreferrer");
    return;
  }
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

// ─── CodingCard ───────────────────────────────────────────────────────────────
function CodingCard({ item, onChange }: { item: QuestionItem; onChange: (patch: Partial<QuestionItem>) => void }) {
  const toggleLang = (lang: string) => {
    const langs = item.languages ?? ["JavaScript"];
    onChange({
      languages: langs.includes(lang) ? langs.filter(l => l !== lang) : [...langs, lang],
    });
  };

  return (
    <div className="space-y-3 rounded-md bg-blue-50 border border-blue-200 p-4">
      <textarea
        className="w-full text-sm bg-white border rounded-md px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
        rows={3}
        placeholder="Describe the coding challenge…"
        value={item.text}
        onChange={e => onChange({ text: e.target.value })}
      />
      <div className="space-y-1.5">
        <span className="text-xs font-medium text-blue-700">Allowed Languages</span>
        <div className="flex flex-wrap gap-2">
          {CODING_LANGUAGES.map(lang => {
            const selected = (item.languages ?? ["JavaScript"]).includes(lang);
            return (
              <label key={lang} className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs cursor-pointer transition-colors ${
                selected ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
              }`}>
                <input type="checkbox" className="hidden" checked={selected} onChange={() => toggleLang(lang)} />
                {lang}
              </label>
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-blue-700 w-24 shrink-0">Timer (minutes)</span>
        <input
          type="number" min={5} max={120}
          className="w-24 text-sm bg-white border rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
          placeholder="30"
          value={item.timerMinutes ?? ""}
          onChange={e => onChange({ timerMinutes: e.target.value })}
        />
      </div>
    </div>
  );
}

// ─── QuestionBuilder ──────────────────────────────────────────────────────────
function QuestionBuilder({ formData, setFormData }: { formData: FormData; setFormData: React.Dispatch<React.SetStateAction<FormData>> }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const canAdd = formData.questions.length < 10;

  const addQuestion = (type: "theory" | "coding") => {
    setDropdownOpen(false);
    if (!canAdd) return;
    const newItem: QuestionItem = {
      id: crypto.randomUUID(),
      type,
      text: "",
      ...(type === "coding" ? { languages: ["JavaScript"], timerMinutes: "" } : {}),
    };
    setFormData(p => ({ ...p, questions: [...p.questions, newItem] }));
  };

  const updateQuestion = (id: string, patch: Partial<QuestionItem>) => {
    setFormData(p => ({ ...p, questions: p.questions.map(q => q.id === id ? { ...q, ...patch } : q) }));
  };

  const removeQuestion = (id: string) => {
    if (formData.questions.length <= 1) return;
    setFormData(p => ({ ...p, questions: p.questions.filter(q => q.id !== id) }));
  };

  const theoryCount = formData.questions.filter(q => q.type === "theory").length;
  const codingCount = formData.questions.filter(q => q.type === "coding").length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-semibold">Interview Questions</Label>
          <span className="text-xs text-muted-foreground font-normal">({formData.questions.length}/10)</span>
        </div>

        <div className="relative" ref={dropdownRef}>
          <Button
            type="button" variant="outline" size="sm"
            disabled={!canAdd}
            onClick={() => setDropdownOpen(o => !o)}
            className="h-8 text-xs gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Question
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>

          {dropdownOpen && (
            <div className="absolute right-0 mt-1 w-48 rounded-md border bg-white shadow-lg z-50 py-1">
              <button
                type="button"
                onClick={() => addQuestion("theory")}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-gray-50 transition-colors"
              >
                <AlignLeft className="h-3.5 w-3.5 text-gray-500" />
                Theory Question
              </button>
              <button
                type="button"
                onClick={() => addQuestion("coding")}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-gray-50 transition-colors"
              >
                <Code2 className="h-3.5 w-3.5 text-blue-500" />
                Coding Question
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Question list */}
      <div className="space-y-3">
        {formData.questions.map((q, idx) => (
          <div key={q.id} className="flex items-start gap-2">
            <span className="mt-2.5 text-xs font-mono text-muted-foreground w-5 shrink-0">Q{idx + 1}</span>
            <div className="flex-1 min-w-0">
              {q.type === "theory" ? (
                <Input
                  value={q.text}
                  onChange={e => updateQuestion(q.id, { text: e.target.value })}
                  placeholder={`Theory question ${idx + 1}…`}
                  className="text-sm"
                />
              ) : (
                <CodingCard item={q} onChange={patch => updateQuestion(q.id, patch)} />
              )}
            </div>
            {formData.questions.length > 1 && (
              <Button
                type="button" variant="ghost" size="icon"
                onClick={() => removeQuestion(q.id)}
                className="h-9 w-9 shrink-0 mt-0.5 text-muted-foreground hover:text-red-500"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))}
      </div>

      {/* Summary pills */}
      {(theoryCount > 0 || codingCount > 0) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {theoryCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-700 text-xs font-medium">
              <AlignLeft className="h-3 w-3" />{theoryCount} theory
            </span>
          )}
          {codingCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
              <Code2 className="h-3 w-3" />{codingCount} coding
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function JobRequisitions() {
  const { user, role, name } = useAuth();
  const { toast } = useToast();
  const searchParams = useSearchParams();

  const [requisitions,       setRequisitions]       = useState<any[]>([]);
  const [agencyUsers,        setAgencyUsers]        = useState<AgencyUser[]>([]);
  const [isLoading,          setIsLoading]          = useState(false);
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

  // ── Fetch agency users ────────────────────────────────────────────────────
  useEffect(() => {
    if (!user || (role !== "admin" && role !== "hr")) return;
    const q = query(collection(db, "users"), where("role", "==", "agency"));
    const unsub = onSnapshot(q, snap => {
      setAgencyUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as AgencyUser)));
    });
    return () => unsub();
  }, [user, role]);

  // ── Firestore listener ────────────────────────────────────────────────────
  useEffect(() => {
    if (!user || !role) return;
    setIsLoading(true);
    const q = role === "agency"
      ? query(collection(db, "job_requisitions"), where("assignedAgencies", "array-contains", user.uid), orderBy("createdDate", "desc"))
      : query(collection(db, "job_requisitions"), orderBy("createdDate", "desc"));
    const unsub = onSnapshot(q,
      snap => { setRequisitions(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setIsLoading(false); },
      err  => { console.error("Firestore:", err); setIsLoading(false); }
    );
    return () => unsub();
  }, [user, role]);

  useEffect(() => {
    const pn = searchParams.get("projectName");
    if (pn) setFilters(prev => ({ ...prev, projectName: decodeURIComponent(pn) }));
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

  const projectOptions  = useMemo(() => [...new Set(requisitions.map(r => r.projectName).filter(Boolean))], [requisitions]);
  const designationOpts = useMemo(() => [...new Set([...ROLES_OPTIONS, ...requisitions.flatMap(r => r.roles || [])])], [requisitions]);

  const filteredReqs = useMemo(() => requisitions.filter(req =>
    (!filters.projectName || req.projectName === filters.projectName) &&
    (!filters.location    || req.locations?.includes(filters.location)) &&
    (!filters.designation || req.roles?.includes(filters.designation)) &&
    (!filters.status      || req.status === filters.status) &&
    (!filters.createdBy   || req.createdByRole === filters.createdBy)
  ), [requisitions, filters]);

  const total     = filteredReqs.length;
  const paginated = filteredReqs.slice(page * rowsPerPage, (page + 1) * rowsPerPage);

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
          projectName:      req.projectName      || "",
          location:         LOCATIONS_OPTIONS.includes(loc) ? loc : loc ? "Other" : "",
          otherLocation:    LOCATIONS_OPTIONS.includes(loc) ? "" : loc,
          role:             ROLES_OPTIONS.includes(rol) ? rol : rol ? "Others" : "",
          otherRole:        ROLES_OPTIONS.includes(rol) ? "" : rol,
          status:           req.status           || "Active",
          jdFileName:       req.jdFileName       || "",
          jdFileType:       req.jdFileType === "manual" ? "manual" : "text",
          jdFileData:       req.jdFileData       || "",
          assignedAgencies: req.assignedAgencies || [],
          questions:        restoreQuestionsFromDoc(req),
        });
      }
    } else {
      resetForm();
    }
    setIsModalOpen(true);
  };

  const handleModalCancel = () => { setIsModalOpen(false); resetForm(); };

  const toggleAgency = (uid: string) => {
    setFormData(p => ({
      ...p,
      assignedAgencies: p.assignedAgencies.includes(uid)
        ? p.assignedAgencies.filter(id => id !== uid)
        : [...p.assignedAgencies, uid],
    }));
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    const finalLocation = formData.location === "Other"  ? formData.otherLocation.trim() : formData.location;
    const finalRole     = formData.role     === "Others" ? formData.otherRole.trim()     : formData.role;

    if (!formData.projectName.trim() || !finalLocation || !finalRole) {
      toast({ variant: "destructive", title: "Validation Error", description: "Project Name, Location, and Role are required." });
      return;
    }

    const data: any = {
      projectName:      formData.projectName.trim(),
      locations:        [finalLocation],
      roles:            [finalRole],
      status:           formData.status,
      jdFileName:       formData.jdFileName  || null,
      jdFileType:       formData.jdFileType  || null,
      jdFileData:       formData.jdFileData  || null,
      assignedAgencies: formData.assignedAgencies,
      questions:        buildQuestionsPayload(formData.questions),
    };

    setIsLoading(true);
    try {
      if (!editingId) {
        const dupSnap = await getDocs(
          query(collection(db, "job_requisitions"), where("projectName", "==", data.projectName))
        );
        if (!dupSnap.empty) {
          toast({ variant: "destructive", title: "Duplicate Project", description: `A project named "${data.projectName}" already exists.` });
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
          ...data, createdBy: user!.uid, createdByRole: role!, createdByName: name!,
          createdDate: serverTimestamp(),
        });
        toast({ title: "Success", description: "Client Project created successfully." });
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

  const isAdminOrHR = role === "admin" || role === "hr";

  return (
    <div className="p-6 sm:p-8 space-y-6 bg-background">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Client Requirements</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your active hiring projects and JD requirements.</p>
        </div>
        <Button onClick={() => handleModalOpen()} className="gap-2 shrink-0">
          <Plus className="h-4 w-4" /> Create Client Project
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
              {["Project Name", "Location", "Designation", "Status", "Questions", "JD", "Assigned Agencies", "Created Date", "Created By", "Actions"].map(h => (
                <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {isLoading ? (
              <tr><td colSpan={10} className="text-center py-8">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
              </td></tr>
            ) : paginated.length === 0 ? (
              <tr><td colSpan={10} className="text-center py-12 text-sm text-muted-foreground">
                {hasActiveFilters ? "No projects match your filters." : "No projects yet. Click Create Client Project to get started."}
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

                {/* Questions summary */}
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  {(() => {
                    const items: any[] = req.questions ?? [];
                    const theory = items.filter(q => q.type === "theory" || typeof q === "string").length;
                    const coding = items.filter(q => q.type === "coding").length;
                    if (!theory && !coding) return <span className="text-gray-400 text-xs">None</span>;
                    return (
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        {theory > 0 && <span className="font-medium">{theory}T</span>}
                        {coding > 0 && <span className="text-blue-600 font-medium">{coding}C</span>}
                      </span>
                    );
                  })()}
                </td>

                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {req.jdFileData && req.jdFileData.trim() !== "" ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (!req.jdFileData) return;
                        if (req.jdFileType === "manual" || req.jdFileType === "text") {
                          const newWindow = window.open("", "_blank");
                          if (newWindow) {
                            newWindow.document.write(`<html><head><title>${req.jdFileName || "Job Description"}</title></head><body style="padding:20px;font-family:Arial;"><div style="white-space:pre-wrap;word-break:break-word;">${req.jdFileData}</div></body></html>`);
                            newWindow.document.close();
                          }
                        } else {
                          openJDFile(req.jdFileData, req.jdFileName);
                        }
                      }}
                      className="text-indigo-600 hover:text-indigo-800"
                      title="View JD"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                  ) : (
                    <span className="text-gray-400 text-xs">No JD</span>
                  )}
                </td>

                <td className="px-6 py-4 text-sm text-gray-600 max-w-[200px]">
                  {req.assignedAgencies?.length ? (
                    <div className="flex flex-wrap gap-1">
                      {(req.assignedAgencies as string[]).map((uid: string) => {
                        const a = agencyUsers.find(ag => ag.uid === uid);
                        const label = a ? (a.name || a.displayName || a.email || uid) : uid;
                        return (
                          <span key={uid} className="px-2 py-0.5 bg-purple-100 text-purple-800 text-xs rounded-full font-medium">{label}</span>
                        );
                      })}
                    </div>
                  ) : (
                    <span className="text-gray-400 text-xs">None</span>
                  )}
                </td>

                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  {req.createdDate?.toDate?.().toLocaleDateString("en-IN") || "—"}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <div className="flex flex-col">
                    <span className="text-gray-900 font-medium">{req.createdByName || "—"}</span>
                    <span className="text-xs text-gray-500">{req.createdByRole || ""}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-right">
                  <DropdownMenu open={openDropdownId === req.id} onOpenChange={o => setOpenDropdownId(o ? req.id : null)}>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleEditAction(req.id)}>Edit</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleDeleteAction(req.id)} className="text-red-600 focus:text-red-600 focus:bg-red-50">Delete</DropdownMenuItem>
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
          {[5, 10, 20].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <span className="text-sm text-muted-foreground">
          {total === 0 ? 0 : page * rowsPerPage + 1}–{Math.min((page + 1) * rowsPerPage, total)} of {total}
        </span>
        <div className="flex gap-1">
          {[
            { l: "<<", a: () => setPage(0),                                               d: page === 0 },
            { l: "<",  a: () => setPage(p => Math.max(p - 1, 0)),                         d: page === 0 },
            { l: ">",  a: () => setPage(p => (p + 1) * rowsPerPage < total ? p + 1 : p),  d: (page + 1) * rowsPerPage >= total },
            { l: ">>", a: () => setPage(Math.floor((total - 1) / rowsPerPage)),            d: (page + 1) * rowsPerPage >= total },
          ].map(b => (
            <button key={b.l} onClick={b.a} disabled={b.d}
              className="w-8 h-8 border rounded text-sm disabled:opacity-40 disabled:cursor-not-allowed">{b.l}</button>
          ))}
        </div>
      </div>

      {/* Create / Edit Modal */}
      <Dialog open={isModalOpen} onOpenChange={open => { if (!open) handleModalCancel(); }}>
        <DialogContent className="sm:max-w-[620px] p-0">
          <DialogHeader className="p-6 pb-4">
            <DialogTitle className="text-xl font-bold">
              {editingId ? "Edit Project" : "New Client Project"}
            </DialogTitle>
            <p className="text-sm text-muted-foreground pt-1">
              Define the role, location, assign agencies, upload the JD, and set interview questions.
            </p>
          </DialogHeader>

          <div className="px-6 pb-6 space-y-5 max-h-[68vh] overflow-y-auto">

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

            {/* Assign Agencies */}
            {isAdminOrHR && (
              <div className="space-y-2">
                <Label>Assign Agencies</Label>
                <div className="border rounded-md p-4 space-y-3 max-h-44 overflow-y-auto">
                  {agencyUsers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No agency users found.</p>
                  ) : agencyUsers.map(agency => {
                    const label = agency.name || agency.displayName || agency.email || agency.uid;
                    return (
                      <div key={agency.uid} className="flex items-center space-x-3">
                        <Checkbox id={`agency-${agency.uid}`}
                          checked={formData.assignedAgencies.includes(agency.uid)}
                          onCheckedChange={() => toggleAgency(agency.uid)} />
                        <Label htmlFor={`agency-${agency.uid}`} className="font-normal cursor-pointer text-sm">{label}</Label>
                      </div>
                    );
                  })}
                </div>
                {formData.assignedAgencies.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {formData.assignedAgencies.length} agenc{formData.assignedAgencies.length === 1 ? "y" : "ies"} selected
                  </p>
                )}
              </div>
            )}

            {/* JD */}
            <div className="space-y-3">
              <Label>Job Description (JD)</Label>
              <RadioGroup
                value={formData.jdFileType || "text"}
                onValueChange={v => setFormData(p => ({ ...p, jdFileType: v, jdFileData: "", jdFileName: "" }))}
                className="flex gap-6"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="text" id="jd-text" />
                  <Label htmlFor="jd-text">Upload Text File</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="manual" id="jd-manual" />
                  <Label htmlFor="jd-manual">Enter Manually</Label>
                </div>
              </RadioGroup>
              {formData.jdFileType === "text" && (
                <Input type="file" accept=".txt" onChange={async e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const text = await file.text();
                  setFormData(p => ({ ...p, jdFileName: file.name, jdFileData: text, jdFileType: "text" }));
                }} />
              )}
              {formData.jdFileName && <p className="text-xs text-muted-foreground">Uploaded: {formData.jdFileName}</p>}
              {formData.jdFileType === "manual" && (
                <Textarea className="w-full" rows={6} placeholder="Enter Job Description here..."
                  value={formData.jdFileData}
                  onChange={e => setFormData(p => ({ ...p, jdFileData: e.target.value }))} />
              )}
            </div>

            {/* Question Builder */}
            <div className="border-t pt-4">
              <QuestionBuilder formData={formData} setFormData={setFormData} />
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
            <Button variant="outline" onClick={handleModalCancel} disabled={isLoading || isProcessingFile}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={isLoading || isProcessingFile} className="bg-[#8A2BE2] hover:bg-[#7f26cc] text-white">
              {isLoading
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…</>
                : editingId ? "Update Project" : "Create Client Project"}
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