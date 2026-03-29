"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, addDoc, serverTimestamp, query, doc, updateDoc, getDocs, deleteDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Eye, MoreVertical, X, XCircle } from "lucide-react";
import { logActivity } from "@/lib/activity-logger";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

const LOCATIONS_OPTIONS = ["Chennai", "Bangalore", "Remote"];
const ROLES_OPTIONS = ["Junior QA", "Senior QA", "DM"];

interface FormData {
  projectName: string;
  location: string;
  otherLocation: string;
  role: string;
  otherRole: string;
  status: string;
  jdFile: { name: string; type: string; data: string } | null;
}

export default function JobRequisitions() {
  const { user, role, name } = useAuth();
  const { toast } = useToast();

  const [requisitions, setRequisitions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>({
    projectName: "",
    location: "",
    otherLocation: "",
    role: "",
    otherRole: "",
    status: "Active",
    jdFile: null,
  });
  const [filters, setFilters] = useState({
    projectName: "",
    location: "",
    designation: "",
    status: "",
    createdBy: "",
  });
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  const fetchRequisitions = async () => {
    setIsLoading(true);
    try {
      const q = query(collection(db, "job_requisitions"), where("createdByRole", "in", ["admin", "hr"]));
      const querySnapshot = await getDocs(q);
      const data = querySnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
      setRequisitions(data);
    } catch (error) {
      console.error("Error fetching requisitions: ", error);
      toast({ variant: "destructive", title: "Error", description: "Failed to fetch job requisitions." });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRequisitions();
  }, []);

  const handleFilterChange = (field: string, value: string) => {
    setFilters(prev => ({ ...prev, [field]: value === 'all' ? '' : value }));
  };

  const handleClearFilters = () => {
    setFilters({
      projectName: "",
      location: "",
      designation: "",
      status: "",
      createdBy: "",
    });
  };

  const hasActiveFilters = useMemo(() => {
    return Object.values(filters).some(value => !!value);
  }, [filters]);

  const projectFilterOptions = useMemo(() => Array.from(new Set(requisitions.map(r => r.projectName).filter(Boolean))), [requisitions]);
  
  const allDesignations = useMemo(() => {
    return Array.from(new Set([...ROLES_OPTIONS, ...requisitions.flatMap(r => r.roles || [])]));
  }, [requisitions]);

  const filteredRequisitions = useMemo(() => {
    return requisitions.filter(req => {
      const matchProjectName = !filters.projectName || req.projectName === filters.projectName;
      const matchLocation = !filters.location || req.locations?.includes(filters.location);
      const matchDesignation = !filters.designation || req.roles?.includes(filters.designation);
      const matchStatus = !filters.status || req.status === filters.status;
      const matchCreatedBy = !filters.createdBy || req.createdByRole === filters.createdBy;
      return matchProjectName && matchLocation && matchDesignation && matchStatus && matchCreatedBy;
    });
  }, [requisitions, filters]);

  const resetForm = () => {
    setFormData({
      projectName: "",
      location: "",
      otherLocation: "",
      role: "",
      otherRole: "",
      status: "Active",
      jdFile: null,
    });
    setEditingId(null);
  };

  const handleModalOpen = (id: string | null = null) => {
    if (id) {
      const req = requisitions.find(r => r.id === id);
      if (req) {
        setEditingId(id);
        const initialLocation = req.locations?.[0] || "";
        const isOtherLocation = initialLocation && !LOCATIONS_OPTIONS.includes(initialLocation);
        
        const initialRole = req.roles?.[0] || "";
        const isOtherRole = initialRole && !allDesignations.includes(initialRole);

        setFormData({
          projectName: req.projectName,
          location: isOtherLocation ? "Other" : initialLocation,
          otherLocation: isOtherLocation ? initialLocation : "",
          role: isOtherRole ? "Others" : initialRole,
          otherRole: isOtherRole ? initialRole : "",
          status: req.status || "Active",
          jdFile: req.jdFileData ? { name: req.jdFileName, type: req.jdFileType, data: req.jdFileData } : null
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setFormData(prev => ({ ...prev, jdFile: { name: file.name, type: file.type, data: (reader.result as string).split(",")[1] } }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async () => {
    if (!formData.projectName.trim() || (!formData.location && !formData.otherLocation.trim()) || (!formData.role && !formData.otherRole.trim())) {
      toast({ variant: "destructive", title: "Validation Error", description: "Project Name, Location, and Role are required." });
      return;
    }

    setIsLoading(true);

    const finalLocation = formData.location === 'Other' ? formData.otherLocation.trim() : formData.location;
    const finalRole = formData.role === 'Others' ? formData.otherRole.trim() : formData.role;

    if (!finalLocation || !finalRole) {
        toast({ variant: "destructive", title: "Validation Error", description: "Please specify location and role." });
        setIsLoading(false);
        return;
    }

    const data: any = {
      projectName: formData.projectName,
      locations: [finalLocation].filter(Boolean),
      roles: [finalRole].filter(Boolean),
      status: formData.status,
      jdFileName: formData.jdFile?.name || null,
      jdFileType: formData.jdFile?.type || null,
      jdFileData: formData.jdFile?.data || null,
    };

    try {
      if (editingId) {
        await updateDoc(doc(db, "job_requisitions", editingId), data);
        toast({ title: "Success", description: "Project updated successfully." });
        if (user && name && role) {
          await logActivity({ userId: user.uid, userName: name, userRole: role, action: "Project Edited", stage: "Setup", targetType: "Project", targetId: editingId, targetName: data.projectName });
        }
      } else {
        const fullData = { ...data, createdBy: user!.uid, createdByRole: role!, createdByName: name!, createdDate: serverTimestamp() };
        const newDocRef = await addDoc(collection(db, "job_requisitions"), fullData);
        toast({ title: "Success", description: "Project created successfully." });
        if (user && name && role) {
          await logActivity({ userId: user.uid, userName: name, userRole: role, action: "Project Created", stage: "Setup", targetType: "Project", targetId: newDocRef.id, targetName: data.projectName });
        }
      }
      setIsModalOpen(false);
      await fetchRequisitions();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (deleteTargetId) {
      try {
        await deleteDoc(doc(db, "job_requisitions", deleteTargetId));
        toast({ title: "Success", description: "Project deleted successfully." });
        await fetchRequisitions();
      } catch (error) {
        toast({ variant: "destructive", title: "Error", description: "Failed to delete project." });
      }
    }
    setIsDeleteDialogOpen(false);
    setDeleteTargetId(null);
  };

  const handleRequestDelete = (id: string) => {
    setDeleteTargetId(id);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteCancel = () => {
    setIsDeleteDialogOpen(false);
    setDeleteTargetId(null);
  };
  
  const handleViewJd = (requisition: any) => {
    if (!requisition.jdFileData || !requisition.jdFileType) return;

    try {
      const byteCharacters = atob(requisition.jdFileData);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: requisition.jdFileType });
      const fileURL = URL.createObjectURL(blob);
      window.open(fileURL, '_blank');
    } catch (error) {
      console.error("Error opening JD:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Could not open the JD file.",
      });
    }
  };

  const handleEditAction = (id: string) => {
    setOpenDropdownId(null);
    setTimeout(() => {
      handleModalOpen(id);
    }, 50);
  };

  const handleDeleteAction = (id: string) => {
    setOpenDropdownId(null);
    setTimeout(() => {
      handleRequestDelete(id);
    }, 50);
  };

  const otherRoles = ["Junior Developer", "Senior Developer", "Others"];


  return (
    <div className="p-6 sm:p-8 space-y-6 bg-background">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Job Requisitions</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your active hiring projects and JD requirements.</p>
        </div>
        <Button onClick={() => handleModalOpen()} className="gap-2 shrink-0">
          <Plus className="h-4 w-4" /> Create Project
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4 flex-grow">
          <Select value={filters.projectName} onValueChange={v => handleFilterChange('projectName', v)}>
            <SelectTrigger><SelectValue placeholder="All Projects" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {projectFilterOptions.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.location} onValueChange={v => handleFilterChange('location', v)}>
            <SelectTrigger><SelectValue placeholder="All Locations" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Locations</SelectItem>
              {LOCATIONS_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.designation} onValueChange={v => handleFilterChange('designation', v)}>
            <SelectTrigger><SelectValue placeholder="All Designations" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Designations</SelectItem>
              {allDesignations.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.status} onValueChange={v => handleFilterChange('status', v)}>
            <SelectTrigger><SelectValue placeholder="All Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="Active">Active</SelectItem>
              <SelectItem value="Inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.createdBy} onValueChange={v => handleFilterChange('createdBy', v)}>
            <SelectTrigger><SelectValue placeholder="All Creators" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Creators</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="hr">HR</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            onClick={handleClearFilters}
            className="h-10 gap-2 text-sm font-semibold"
          >
            <XCircle className="h-4 w-4" />
            Clear Filters
          </Button>
        )}
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Project Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Project Location</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Designation</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">JD</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created Date</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created By</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {isLoading ? (
              <tr><td colSpan={8} className="text-center py-8"><Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" /></td></tr>
            ) : filteredRequisitions.map(req => (
              <tr key={req.id}>
                <td className="px-6 py-4 whitespace-nowrap font-medium text-sm">{req.projectName}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">{req.locations?.join(", ")}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">{req.roles?.join(", ")}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <span className={`px-2.5 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full ${req.status === 'Active' ? 'bg-blue-100 text-blue-800' : 'bg-red-100 text-red-800'}`}>
                    {req.status}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">{req.jdFileData ? <Eye className="text-gray-500 h-5 w-5 cursor-pointer" onClick={(e) => { e.stopPropagation(); handleViewJd(req); }} /> : "N/A"}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">{req.createdDate?.toDate().toLocaleDateString()}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">{req.createdByRole === 'admin' ? 'Admin' : req.createdByRole === 'hr' ? 'Hr' : req.createdByRole || 'N/A'}</td>
                <td className="px-6 py-4 text-right">
                  <DropdownMenu open={openDropdownId === req.id} onOpenChange={(isOpen) => setOpenDropdownId(isOpen ? req.id : null)}>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4"/></Button></DropdownMenuTrigger>
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

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-[580px] p-0">
           <DialogHeader className="p-6 pb-4">
             <div className="flex justify-between items-start">
              <div>
                <DialogTitle className="text-xl font-bold">New Project</DialogTitle>
                <p className="text-sm text-muted-foreground pt-1">Define the role, locations, and shared project details.</p>
              </div>
             </div>
          </DialogHeader>
          <div className="px-6 pb-6 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="projectName">Project Name</Label>
              <Input id="projectName" value={formData.projectName} onChange={e => setFormData(prev => ({...prev, projectName: e.target.value}))} className="w-full focus-visible:ring-1 focus-visible:ring-primary" />
            </div>
            <div className="space-y-2">
              <Label>Location (Multi-select)</Label>
              <div className="p-4 border rounded-md">
                  <RadioGroup value={formData.location} onValueChange={v => setFormData(p => ({...p, location: v}))} className="grid grid-cols-2 gap-4">
                    {LOCATIONS_OPTIONS.map(loc => (
                      <div key={loc} className="flex items-center space-x-2">
                        <RadioGroupItem value={loc} id={`loc-${loc}`} />
                        <Label htmlFor={`loc-${loc}`} className="font-normal">{loc}</Label>
                      </div>
                    ))}
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="Other" id="loc-other" />
                      <Label htmlFor="loc-other" className="font-normal">Other</Label>
                    </div>
                  </RadioGroup>
                  {formData.location === "Other" && (
                    <Input placeholder="Specify other location" value={formData.otherLocation} onChange={e => setFormData(prev => ({...prev, otherLocation: e.target.value}))} className="mt-3"/>
                  )}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Role (Multi-select)</Label>
               <div className="p-4 border rounded-md">
                  <RadioGroup value={formData.role} onValueChange={v => setFormData(p => ({...p, role: v}))} className="grid grid-cols-2 gap-4">
                    {ROLES_OPTIONS.map(r => (
                      <div key={r} className="flex items-center space-x-2">
                        <RadioGroupItem value={r} id={`role-${r}`} />
                        <Label htmlFor={`role-${r}`} className="font-normal">{r}</Label>
                      </div>
                    ))}
                     <div className="flex items-center space-x-2">
                      <RadioGroupItem value="Others" id="role-others" />
                      <Label htmlFor="role-others" className="font-normal">Others</Label>
                    </div>
                  </RadioGroup>
                  {formData.role === "Others" && (
                     <Input placeholder="Specify other role" value={formData.otherRole} onChange={e => setFormData(prev => ({...prev, otherRole: e.target.value}))} className="mt-3" />
                  )}
              </div>
            </div>
            <div className="space-y-2">
                <Label htmlFor="jdFile">Upload JD</Label>
                 <div className="flex items-center justify-between border rounded-md">
                   <span className="text-sm text-muted-foreground px-3 py-2">{formData.jdFile?.name || "No file chosen"}</span>
                    <Input id="jdFile" type="file" className="hidden" onChange={handleFileChange} accept=".pdf,.doc,.docx"/>
                    <Label htmlFor="jdFile" className="bg-gray-100 border-l px-4 py-2 text-sm cursor-pointer hover:bg-gray-200">
                      Choose File
                    </Label>
                </div>
            </div>
            <div className="space-y-2">
                <Label>Status</Label>
                <Select value={formData.status} onValueChange={val => setFormData(prev => ({...prev, status: val}))}>
                    <SelectTrigger><SelectValue/></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="Active">Active</SelectItem>
                        <SelectItem value="Inactive">Inactive</SelectItem>
                    </SelectContent>
                </Select>
            </div>
          </div>
          <DialogFooter className="px-6 py-4 bg-gray-50 border-t sm:justify-end space-x-2">
            <Button variant="outline" onClick={handleModalCancel}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={isLoading} className="bg-[#8A2BE2] hover:bg-[#7f26cc] text-white">
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : (editingId ? "Create Project" : "Create Project")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Deletion</DialogTitle>
          </DialogHeader>
          <p>Are you sure you want to delete this project? This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={handleDeleteCancel}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
