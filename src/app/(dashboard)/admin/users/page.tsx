
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { collection, getDocs, getDoc, query, orderBy, serverTimestamp, setDoc, doc, updateDoc, where } from "firebase/firestore";
import { createUserWithEmailAndPassword, getAuth } from "firebase/auth";
import { initializeApp, deleteApp } from "firebase/app";
import { db, firebaseConfig } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Plus, Loader2, Edit2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, MoreVertical, XCircle, X, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
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
import { cn } from "@/lib/utils";
import { sendNewUserWelcomeEmail } from "@/ai/flows/send-new-user-welcome-email-flow";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

type UserRole = "hr" | "panel" | "agency";

export default function UserManagement() {
  const [users, setUsers] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deactivateId, setDeactivateId] = useState<string | null>(null);
  const [errors, setErrors] = useState<any>({});
  const { toast } = useToast();

  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [filterRole, setFilterRole] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");


  const initialFormData = {
    name: "",
    email: "",
    role: "" as UserRole | "",
    status: "Active",
    phoneNumber: "",
    phoneNumber2: "",
    employeeId: "",
    expertise: "",
    agencyName: "",
    agencyEmail: "",
    commissionPercentage: "",
    website: "",
    address: "",
    additionalContacts: [] as { name: string; email: string; phone: string }[],
  };

  const [formData, setFormData] = useState(initialFormData);

  const fetchUsers = useCallback(async () => {
    setIsDataLoading(true);
    try {
      const usersQuery = query(collection(db, "users"), where("role", "in", ["hr", "panel", "agency", "admin"]));
      const usersSnap = await getDocs(usersQuery);
      const usersData = usersSnap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

      setUsers(usersData);
    } catch (error: any) {
      console.error("Fetch Error:", error);
      toast({ variant: "destructive", title: "Fetch Error", description: "Failed to load user data. A Firestore index may be required." });
    } finally {
      setIsDataLoading(false);
    }
  }, [toast]);


  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const filteredUsers = useMemo(() => {
    return users.filter(user => {
      const roleMatch = filterRole === 'all' || user.role === filterRole;
      const statusMatch = filterStatus === 'all' || user.status === filterStatus;
      return roleMatch && statusMatch;
    });
  }, [users, filterRole, filterStatus]);
  
  const hasActiveFilters = filterRole !== 'all' || filterStatus !== 'all';

  const handleClearFilters = () => {
    setFilterRole('all');
    setFilterStatus('all');
    setCurrentPage(1);
  };


  const totalRecords = filteredUsers.length;
  const totalPages = Math.ceil(totalRecords / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const paginatedUsers = filteredUsers.slice(startIndex, startIndex + rowsPerPage);

  const generateTempPassword = () => Math.random().toString(36).slice(-10);

  const validateForm = () => {
    const newErrors: any = {};
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const nameRegex = /^[a-zA-Z .'-]{2,30}$/;

    if (!formData.role) newErrors.role = "Role is required.";
    
    if (formData.role === 'hr') {
        if (!formData.name.trim() || !nameRegex.test(formData.name.trim())) {
            newErrors.name = "Name must contain only letters and be 2–30 characters long";
        }
        if (!formData.email.trim() || !emailRegex.test(formData.email)) newErrors.email = "Valid email is required.";
        if (!formData.employeeId.trim()) newErrors.employeeId = "Employee ID is required.";
        if (!formData.phoneNumber.trim() || !/^\d{10}$/.test(formData.phoneNumber.trim())) {
            newErrors.phoneNumber = "A 10-digit phone number is required.";
        }
    } else if (formData.role === 'panel') {
        if (!formData.name.trim() || !nameRegex.test(formData.name.trim())) {
             newErrors.name = "Name must contain only letters and be 2–30 characters long";
        }
        if (!formData.email.trim() || !emailRegex.test(formData.email)) newErrors.email = "Valid email is required.";
        if (!formData.phoneNumber.trim() || !/^\d{10}$/.test(formData.phoneNumber.trim())) {
            newErrors.phoneNumber = "A 10-digit phone number is required.";
        }
        if (!formData.expertise.trim()) newErrors.expertise = "Expertise is required.";
        if (!formData.employeeId.trim()) newErrors.employeeId = "Employee ID is required.";
    } else if (formData.role === 'agency') {
        if (!formData.agencyName.trim() || !nameRegex.test(formData.agencyName.trim())) {
            newErrors.agencyName = "Name must contain only letters and be 2–30 characters long";
        }
        if (!formData.agencyEmail.trim() || !emailRegex.test(formData.agencyEmail)) {
            newErrors.agencyEmail = "Valid agency email is required.";
        }
        if (!formData.address.trim()) newErrors.address = "Address is required.";
        if (!formData.phoneNumber.trim() || !/^\d{10}$/.test(formData.phoneNumber.trim())) {
            newErrors.phoneNumber = "Agency phone must be 10 digits.";
        }

        newErrors.additionalContacts = [];
        formData.additionalContacts.forEach((contact, index) => {
          const contactError: any = {};
          if(contact.name && !nameRegex.test(contact.name.trim())) {
            contactError.name = "Name must contain only letters and be 2–30 characters long"
          }
          if (contact.email && !emailRegex.test(contact.email)) contactError.email = "Invalid email format.";
          if (contact.phone && !/^\d{10}$/.test(contact.phone.trim())) contactError.phone = "Must be 10 digits.";
          if (Object.keys(contactError).length > 0) newErrors.additionalContacts[index] = contactError;
        });
        if (newErrors.additionalContacts.every((e:any) => !e)) delete newErrors.additionalContacts;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const resetForm = useCallback(() => {
    setFormData(initialFormData);
    setEditingId(null);
    setErrors({});
  }, [initialFormData]);

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;
    setIsLoading(true);

    try {
      let email: string;
      if (formData.role === 'agency') {
        email = formData.agencyEmail.trim().toLowerCase();
      } else {
        email = formData.email.trim().toLowerCase();
      }

      let userData: any = {
        name: formData.name.trim(),
        role: formData.role,
        status: formData.status,
      };

      if (formData.role === 'hr') {
        userData = { ...userData, name: formData.name.trim(), phoneNumber: formData.phoneNumber, employeeId: formData.employeeId, email: formData.email };
      } else if (formData.role === 'panel') {
        userData = { ...userData, name: formData.name.trim(), phoneNumber: formData.phoneNumber, expertise: formData.expertise, employeeId: formData.employeeId, email: formData.email };
      }

      if (editingId) {
        const userRef = doc(db, "users", editingId);
        const existingUserDoc = await getDoc(userRef);
        const existingUserData = existingUserDoc.data() || {};

        let updatePayload:any = {
            ...existingUserData,
            updatedAt: serverTimestamp()
        };

        if (formData.role === 'agency') {
            updatePayload.agencyName = formData.agencyName;
            updatePayload.name = formData.agencyName;
            updatePayload.agencyEmail = formData.agencyEmail;
            updatePayload.email = formData.agencyEmail; // Auth email
            updatePayload.address = formData.address;
            updatePayload.website = formData.website;
            updatePayload.commissionPercentage = formData.commissionPercentage;
            updatePayload.phoneNumber = formData.phoneNumber;
            updatePayload.phoneNumber2 = formData.phoneNumber2;
            updatePayload.primaryContact = {
                name: formData.agencyName,
                email: formData.agencyEmail,
                phone: formData.phoneNumber
            };
            updatePayload.additionalContacts = formData.additionalContacts.filter(c => c.name || c.email || c.phone);
        } else {
             updatePayload = {...updatePayload, ...userData};
        }

        await updateDoc(userRef, updatePayload);
        toast({ title: "Success", description: "User updated successfully." });

      } else {
        const q = query(collection(db, "users"), where("email", "==", email));
        const querySnap = await getDocs(q);
        if (!querySnap.empty) {
          toast({ variant: "destructive", title: "Email Error", description: "Email is already associated with an account." });
          setIsLoading(false);
          return;
        }

        const secondaryAppName = `create-auth-${Date.now()}`;
        const secondaryApp = initializeApp(firebaseConfig, secondaryAppName);
        try {
          const tempPassword = generateTempPassword();
          const secondaryAuth = getAuth(secondaryApp);
          const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, tempPassword);
          const uid = userCredential.user.uid;

          let dataToSave: any = {
              email: email, 
              role: formData.role,
              status: "Active",
              firstLogin: true,
              createdAt: serverTimestamp(),
          };

          if (formData.role === 'agency') {
             Object.assign(dataToSave, {
              agencyName: formData.agencyName.trim(),
              name: formData.agencyName.trim(),
              agencyEmail: email,
              address: formData.address.trim(),
              website: formData.website.trim(),
              commissionPercentage: formData.commissionPercentage.trim(),
              phoneNumber: formData.phoneNumber.trim(),
              phoneNumber2: formData.phoneNumber2.trim(),
              primaryContact: {
                name: formData.agencyName.trim(),
                email: email,
                phone: formData.phoneNumber.trim(),
              },
              additionalContacts: formData.additionalContacts.filter(c => c.name || c.email || c.phone),
            });
          } else {
            Object.assign(dataToSave, userData);
          }

          await setDoc(doc(db, "users", uid), dataToSave);

          await sendNewUserWelcomeEmail({
            name: formData.role === 'agency' ? formData.agencyName : userData.name,
            email: email,
            role: formData.role.toUpperCase(),
            tempPassword: tempPassword
          });
        } finally {
          await deleteApp(secondaryApp);
        }
        toast({ title: "Success", description: "User created and welcome email sent." });
      }
      setIsModalOpen(false);
      resetForm();
      await fetchUsers();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  const handleEdit = (user: any) => {
    setEditingId(user.id);
    let populatedData = { ...initialFormData, ...user };

    if(user.role === 'agency') {
        populatedData.agencyName = user.agencyName || user.name;
        populatedData.agencyEmail = user.email || ""; // Auth email
        populatedData.phoneNumber = user.primaryContact?.phone || user.phoneNumber;
        populatedData.phoneNumber2 = user.phoneNumber2 || "";
        populatedData.additionalContacts = user.additionalContacts || [];
    }

    setFormData(populatedData);
    setErrors({});
    setIsModalOpen(true);
  };

  const handleDeactivate = async () => {
    if (!deactivateId) return;
    setIsLoading(true);
    try {
      const userToDeactivate = users.find(u => u.id === deactivateId);
      if (!userToDeactivate) throw new Error("User not found.");

      const newStatus = userToDeactivate.status === "Active" ? "Inactive" : "Active";
      await updateDoc(doc(db, "users", deactivateId), { status: newStatus, updatedAt: serverTimestamp() });

      toast({ title: "Success", description: `User status changed to ${newStatus}.` });
      await fetchUsers();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } finally {
      setIsLoading(false);
      setDeactivateId(null);
    }
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData({ ...formData, [field]: value });
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: undefined }));
  };

  const handleRoleChange = (newRole: UserRole | "") => {
    resetForm();
    setFormData({
      ...initialFormData,
      role: newRole,
    });
  };

  const handleAddContact = () => setFormData(p => ({ ...p, additionalContacts: [...p.additionalContacts, { name: "", email: "", phone: "" }]}));
  const handleRemoveContact = (index: number) => setFormData(p => ({ ...p, additionalContacts: p.additionalContacts.filter((_, i) => i !== index)}));

  const handleAdditionalContactChange = (index: number, field: string, value: string) => {
    const val = field === 'phone' ? value.replace(/\D/g, "").slice(0, 10) : value;
    const updated = [...formData.additionalContacts];
    updated[index] = { ...updated[index], [field]: val };
    setFormData(p => ({...p, additionalContacts: updated}));
  };

  const userToDeactivate = useMemo(() => users.find(u => u.id === deactivateId), [users, deactivateId]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pt-2 pb-4">
        <div className="flex flex-col">
          <h1 className="text-3xl font-headline font-bold text-foreground leading-tight tracking-tight">User Management</h1>
          <p className="text-sm text-muted-foreground mt-1">Create, manage, and assign roles to system users.</p>
        </div>
        <Button onClick={() => { resetForm(); setIsModalOpen(true); }} className="gap-2 shrink-0">
          <Plus className="h-4 w-4" /> New User
        </Button>
      </div>

      <div className="flex flex-col md:flex-row items-end gap-4 bg-card p-4 rounded-lg shadow-sm border">
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
          <div className="space-y-2">
            <label className="text-sm font-medium">Role</label>
            <Select onValueChange={setFilterRole} value={filterRole}>
              <SelectTrigger><SelectValue placeholder="All Roles" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                <SelectItem value="hr">HR</SelectItem>
                <SelectItem value="panel">Panel</SelectItem>
                <SelectItem value="agency">Agency</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Status</label>
            <Select onValueChange={setFilterStatus} value={filterStatus}>
              <SelectTrigger><SelectValue placeholder="All Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="Active">Active</SelectItem>
                <SelectItem value="Inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {hasActiveFilters && (
          <Button variant="secondary" size="sm" onClick={handleClearFilters} className="h-10 gap-2">
            <XCircle className="h-4 w-4" /> Clear Filters
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Created Date</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isDataLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center h-32"><Loader2 className="h-4 w-4 animate-spin inline-block mr-2" /> Loading users...</TableCell></TableRow>
              ) : paginatedUsers.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center h-32 text-muted-foreground">No users found.</TableCell></TableRow>
              ) : (
                paginatedUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.agencyName || user.name}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>{user.createdAt?.toDate().toLocaleDateString() || "N/A"}</TableCell>
                    <TableCell><Badge variant="secondary" className="uppercase">{user.role}</Badge></TableCell>
                    <TableCell><Badge variant={user.status === "Active" ? "default" : "destructive"}>{user.status || "Active"}</Badge></TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => handleEdit(user)}>Edit User</DropdownMenuItem>
                          <DropdownMenuItem
                            className={cn(user.status === "Active" ? "text-destructive" : "text-green-600")}
                            onSelect={() => setDeactivateId(user.id)}
                            disabled={user.role === 'admin'}
                          >
                            {user.status === "Active" ? "Deactivate" : "Activate"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between px-6 py-4 border-t">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Rows per page:</span>
              <Select value={String(rowsPerPage)} onValueChange={(v) => { setRowsPerPage(Number(v)); setCurrentPage(1); }}>
                <SelectTrigger className="h-8 w-[70px]"><SelectValue /></SelectTrigger>
                <SelectContent side="top">{[10, 20, 30, 50].map(sz => <SelectItem key={sz} value={String(sz)}>{sz}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-6 lg:gap-8">
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

      <Dialog open={isModalOpen} onOpenChange={(open) => { if (!open) resetForm(); setIsModalOpen(open); }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit User" : "Add New User"}</DialogTitle>
            <DialogDescription>
              {editingId ? "Update the user's details." : "Select a role to begin."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveUser} className="space-y-6 pt-4">
              <div className="space-y-2">
                  <Label>Role</Label>
                  <Select value={formData.role} onValueChange={v => handleRoleChange(v as UserRole)} disabled={!!editingId}>
                      <SelectTrigger className={cn("w-full", errors.role && "border-destructive")}>
                          <SelectValue placeholder="Select a role" />
                      </SelectTrigger>
                      <SelectContent>
                          <SelectItem value="hr">HR</SelectItem>
                          <SelectItem value="panel">Panel</SelectItem>
                          <SelectItem value="agency">Agency</SelectItem>
                      </SelectContent>
                  </Select>
                  {errors.role && <p className="text-destructive text-xs">{errors.role}</p>}
              </div>

            {(editingId || formData.role) && (
              <div className="space-y-6 animate-in fade-in duration-300">

                {formData.role === 'hr' && (
                   <div>
                    <Label className="text-base font-semibold">HR Details</Label>
                    <Separator className="mt-2 mb-4" />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                          <Label>Full Name</Label>
                          <Input value={formData.name} onChange={e => handleInputChange('name', e.target.value)} className={cn(errors.name && "border-destructive")} />
                          {errors.name && <p className="text-destructive text-xs">{errors.name}</p>}
                      </div>
                      <div className="space-y-2">
                          <Label>Email</Label>
                          <Input type="email" disabled={!!editingId} value={formData.email} onChange={e => handleInputChange('email', e.target.value)} className={cn(errors.email && "border-destructive")} />
                          {errors.email && <p className="text-destructive text-xs">{errors.email}</p>}
                      </div>
                      <div className="space-y-2"><Label>Employee ID</Label><Input value={formData.employeeId} onChange={e => handleInputChange('employeeId', e.target.value)} className={cn(errors.employeeId && "border-destructive")} />{errors.employeeId && <p className="text-destructive text-xs">{errors.employeeId}</p>}</div>
                      <div className="space-y-2"><Label>Phone Number</Label><Input value={formData.phoneNumber} onChange={e => handleInputChange('phoneNumber', e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="10 digits" className={cn(errors.phoneNumber && "border-destructive")} />{errors.phoneNumber && <p className="text-destructive text-xs">{errors.phoneNumber}</p>}</div>
                    </div>
                  </div>
                )}
                {formData.role === 'panel' && (
                   <div>
                    <Label className="text-base font-semibold">Panel Member Details</Label>
                    <Separator className="mt-2 mb-4" />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                          <Label>Full Name</Label>
                          <Input value={formData.name} onChange={e => handleInputChange('name', e.target.value)} className={cn(errors.name && "border-destructive")} />
                          {errors.name && <p className="text-destructive text-xs">{errors.name}</p>}
                      </div>
                       <div className="space-y-2">
                          <Label>Email</Label>
                          <Input type="email" disabled={!!editingId} value={formData.email} onChange={e => handleInputChange('email', e.target.value)} className={cn(errors.email && "border-destructive")} />
                          {errors.email && <p className="text-destructive text-xs">{errors.email}</p>}
                      </div>
                      <div className="space-y-2">
                        <Label>Phone Number</Label>
                        <Input value={formData.phoneNumber} onChange={e => handleInputChange('phoneNumber', e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="10 digits" className={cn(errors.phoneNumber && "border-destructive")} />
                        {errors.phoneNumber && <p className="text-destructive text-xs">{errors.phoneNumber}</p>}
                      </div>
                      <div className="space-y-2">
                        <Label>Expertise / Skill</Label>
                        <Input value={formData.expertise} onChange={e => handleInputChange('expertise', e.target.value)} className={cn(errors.expertise && "border-destructive")} />
                        {errors.expertise && <p className="text-destructive text-xs">{errors.expertise}</p>}
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <Label>Employee ID</Label>
                        <Input value={formData.employeeId} onChange={e => handleInputChange('employeeId', e.target.value)} className={cn("max-w-sm", errors.employeeId && "border-destructive")} />
                        {errors.employeeId && <p className="text-destructive text-xs">{errors.employeeId}</p>}
                      </div>
                    </div>
                  </div>
                )}

                {formData.role === 'agency' && (
                  <>
                    <div>
                        <Label className="text-base font-semibold">Agency Details</Label>
                        <Separator className="mt-2 mb-4" />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label>Agency Name</Label>
                              <Input value={formData.agencyName} onChange={e => handleInputChange('agencyName', e.target.value)} className={cn(errors.agencyName && "border-destructive")}/>
                              {errors.agencyName && <p className="text-destructive text-xs">{errors.agencyName}</p>}
                            </div>
                            <div className="space-y-2">
                              <Label>Agency Email</Label>
                              <Input type="email" disabled={!!editingId} value={formData.agencyEmail} onChange={e => handleInputChange('agencyEmail', e.target.value)} className={cn(errors.agencyEmail && "border-destructive")} />
                              {errors.agencyEmail && <p className="text-destructive text-xs">{errors.agencyEmail}</p>}
                            </div>
                            
                            <div className="space-y-2">
                                <Label>Agency Phone Number 1</Label>
                                <Input value={formData.phoneNumber} onChange={e => handleInputChange('phoneNumber', e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="10 digits" className={cn(errors.phoneNumber && "border-destructive")}/>
                                {errors.phoneNumber && <p className="text-destructive text-xs">{errors.phoneNumber}</p>}
                            </div>
                            <div className="space-y-2">
                                <Label>Agency Phone Number 2 (Optional)</Label>
                                <Input value={formData.phoneNumber2} onChange={e => handleInputChange('phoneNumber2', e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="10 digits" />
                            </div>

                            <div className="space-y-2"><Label>Website (Optional)</Label><Input value={formData.website} onChange={e => handleInputChange('website', e.target.value)} /></div>
                            <div className="space-y-2"><Label>Commission % (Optional)</Label><Input type="number" value={formData.commissionPercentage} onChange={e => handleInputChange('commissionPercentage', e.target.value)} /></div>
                            <div className="space-y-2 md:col-span-2"><Label>Address</Label><Input value={formData.address} onChange={e => handleInputChange('address', e.target.value)} className={cn(errors.address && "border-destructive")}/>{errors.address && <p className="text-destructive text-xs">{errors.address}</p>}</div>
                        </div>
                    </div>
                    
                    <Collapsible>
                      <CollapsibleTrigger asChild>
                        <div className="flex items-center justify-between border-t pt-4 cursor-pointer">
                            <Label className="text-base font-semibold">Additional Contacts (Optional)</Label>
                            <Button type="button" variant="ghost" size="sm" className="w-9 p-0"><ChevronDown className="h-4 w-4" /></Button>
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="space-y-4 pt-2">
                        <Separator className="mb-4" />
                        {formData.additionalContacts.map((contact, index) => (
                            <div key={index} className="space-y-3 p-3 border rounded-lg relative">
                                <Button type="button" variant="ghost" size="icon" className="absolute top-1 right-1 h-6 w-6" onClick={() => handleRemoveContact(index)}><X className="h-4 w-4"/></Button>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Name</Label>
                                        <Input value={contact.name} onChange={e => handleAdditionalContactChange(index, 'name', e.target.value)} className={cn(errors.additionalContacts?.[index]?.name && "border-destructive")} />
                                        {errors.additionalContacts?.[index]?.name && <p className="text-destructive text-xs">{errors.additionalContacts[index].name}</p>}
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Email</Label>
                                        <Input type="email" value={contact.email} onChange={e => handleAdditionalContactChange(index, 'email', e.target.value)} className={cn(errors.additionalContacts?.[index]?.email && "border-destructive")} />
                                        {errors.additionalContacts?.[index]?.email && <p className="text-destructive text-xs">{errors.additionalContacts[index].email}</p>}
                                    </div>
                                    <div className="space-y-2 md:col-span-2">
                                        <Label>Phone</Label>
                                        <Input value={contact.phone} onChange={e => handleAdditionalContactChange(index, 'phone', e.target.value)} placeholder="10 digits" className={cn("max-w-sm", errors.additionalContacts?.[index]?.phone && "border-destructive")} />
                                        {errors.additionalContacts?.[index]?.phone && <p className="text-destructive text-xs">{errors.additionalContacts[index].phone}</p>}
                                    </div>
                                </div>
                            </div>
                        ))}
                        <Button type="button" variant="outline" size="sm" onClick={handleAddContact}>Add Another Contact</Button>
                      </CollapsibleContent>
                    </Collapsible>
                  </>
                )}

                {editingId && (<div className="space-y-2 pt-4 border-t"><Label>Status</Label><Select value={formData.status} onValueChange={v => setFormData({ ...formData, status: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Active">Active</SelectItem><SelectItem value="Inactive">Inactive</SelectItem></SelectContent></Select></div>)}

                <DialogFooter className="pt-4">
                    <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>Cancel</Button>
                    <Button type="submit" disabled={isLoading}>{isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : (editingId ? "Update User" : "Create User")}</Button>
                </DialogFooter>
              </div>
            )}
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deactivateId} onOpenChange={o => !o && setDeactivateId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Confirm Status Change</AlertDialogTitle><AlertDialogDescription>Are you sure you want to {userToDeactivate?.status === "Active" ? "deactivate" : "activate"} this user? {userToDeactivate?.status === "Active" ? "Their access will be revoked." : "They will regain access."}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
            <Button variant={userToDeactivate?.status === "Active" ? "destructive" : "default"} onClick={handleDeactivate} disabled={isLoading}>{isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : `Confirm ${userToDeactivate?.status === "Active" ? "Deactivation" : "Activation"}`}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
