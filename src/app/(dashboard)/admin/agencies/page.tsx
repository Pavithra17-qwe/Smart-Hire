
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { collection, getDocs, getDoc, query, orderBy, serverTimestamp, setDoc, doc, updateDoc, deleteDoc, where } from "firebase/firestore";
import { createUserWithEmailAndPassword, getAuth, signOut } from "firebase/auth";
import { initializeApp, deleteApp } from "firebase/app";
import { db, firebaseConfig } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Plus, Loader2, Edit2, Trash2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, MoreVertical, XCircle, X, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { cn } from "@/lib/utils";
import { sendWelcomeEmail } from "@/ai/flows/send-welcome-email-flow";

export default function AgencyManagement() {
  const [agencies, setAgencies] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [isMounted, setIsMounted] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [errors, setErrors] = useState<any>({});
  const { toast } = useToast();

  const [filterAgencyId, setFilterAgencyId] = useState("all");
  const [filterName, setFilterName] = useState("all");
  const [filterContact, setFilterContact] = useState("all");

  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const initialFormData = {
    agencyName: "",
    address: "",
    website: "",
    commissionPercentage: "",
    status: "Active",
    primaryContact: {
      name: "",
      email: "",
      phone: "",
    },
    additionalContacts: [] as { name: string; email: string; phone: string }[],
  };

  const [formData, setFormData] = useState(initialFormData);

  const fetchAgencies = useCallback(async () => {
    setIsDataLoading(true);
    try {
      const q = query(collection(db, "agencies"), orderBy("createdDate", "desc"));
      const snap = await getDocs(q);
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAgencies(data);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Fetch Error", description: "Failed to load agencies." });
    } finally {
      setIsDataLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    setIsMounted(true);
    fetchAgencies();
  }, [fetchAgencies]);

  const filteredAgencies = useMemo(() => {
    return agencies.filter(agency => {
      const matchesId = filterAgencyId === "all" || agency.agencyId === filterAgencyId;
      const matchesName = filterName === "all" || agency.name === filterName;
      const matchesContact = filterContact === "all" || agency.primaryContact?.name === filterContact;
      return matchesId && matchesName && matchesContact;
    });
  }, [agencies, filterAgencyId, filterName, filterContact]);

  const agencyIdOptions = useMemo(() => {
    return Array.from(new Set(agencies.map(a => a.agencyId))).filter(Boolean).sort();
  }, [agencies]);

  const nameOptions = useMemo(() => {
    return Array.from(new Set(agencies.map(a => a.name))).filter(Boolean).sort();
  }, [agencies]);

  const contactOptions = useMemo(() => {
    return Array.from(new Set(agencies.map(a => a.primaryContact?.name))).filter(Boolean).sort();
  }, [agencies]);

  const hasActiveFilters = filterAgencyId !== "all" || filterName !== "all" || filterContact !== "all";

  const handleClearFilters = () => {
    setFilterAgencyId("all");
    setFilterName("all");
    setFilterContact("all");
    setCurrentPage(1);
  };

  const totalRecords = filteredAgencies.length;
  const totalPages = Math.ceil(totalRecords / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const paginatedAgencies = filteredAgencies.slice(startIndex, startIndex + rowsPerPage);

  const generateAgencyId = async () => {
    const snap = await getDocs(collection(db, "agencies"));
    const count = snap.size + 1;
    return `AGY-${String(count).padStart(4, "0")}`;
  };

  const generateTempPassword = () => {
    return Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-2).toUpperCase();
  };

  const validateForm = () => {
    const newErrors: any = { primaryContact: {}, additionalContacts: [] };
    if (!formData.agencyName.trim()) newErrors.agencyName = "Agency name is required.";
    if (!formData.address.trim()) newErrors.address = "Address is required.";
    if (!formData.primaryContact.name.trim()) newErrors.primaryContact.name = "Name is required.";
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!formData.primaryContact.email.trim() || !emailRegex.test(formData.primaryContact.email)) newErrors.primaryContact.email = "Valid email is required.";
    if (!formData.primaryContact.phone.trim() || !/^\d{10}$/.test(formData.primaryContact.phone.trim())) newErrors.primaryContact.phone = "Valid 10-digit phone required.";
    
    formData.additionalContacts.forEach((contact, index) => {
      const contactError: any = {};
      if (contact.email && !emailRegex.test(contact.email)) contactError.email = "Invalid email format.";
      if (contact.phone && !/^\d{10}$/.test(contact.phone)) contactError.phone = "Must be a 10-digit number.";
      if (Object.keys(contactError).length > 0) newErrors.additionalContacts[index] = contactError;
    });

    if (Object.keys(newErrors.primaryContact).length === 0) delete newErrors.primaryContact;
    if (newErrors.additionalContacts.every((e:any) => !e)) delete newErrors.additionalContacts;

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const resetForm = useCallback(() => {
    setFormData(initialFormData);
    setEditingId(null);
    setErrors({});
  }, []);

  const handleSaveAgency = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;
    setIsLoading(true);

    try {
      const primaryEmail = formData.primaryContact.email.trim().toLowerCase();
      const agencyDataPayload = {
        name: formData.agencyName.trim(),
        address: formData.address.trim(),
        website: formData.website.trim(),
        commissionPercentage: formData.commissionPercentage.trim(),
        primaryContact: {
          name: formData.primaryContact.name.trim(),
          email: primaryEmail,
          phone: formData.primaryContact.phone.trim(),
        },
        additionalContacts: formData.additionalContacts.filter(c => c.name || c.email || c.phone),
        status: formData.status,
      };

      if (editingId) {
        await updateDoc(doc(db, "agencies", editingId), { ...agencyDataPayload, updatedDate: serverTimestamp() });
        await updateDoc(doc(db, "users", editingId), { name: agencyDataPayload.name, status: agencyDataPayload.status });
        toast({ title: "Success", description: "Agency updated successfully." });
      } else {
        const q = query(collection(db, "agencies"), where("primaryContact.email", "==", primaryEmail));
        const querySnap = await getDocs(q);
        
        if (!querySnap.empty) {
          const existingDoc = querySnap.docs[0];
          if (existingDoc.data().status === "Active") {
            toast({ variant: "destructive", title: "Email Error", description: "Email is already associated with an active account." });
            setIsLoading(false); return;
          }
          await updateDoc(doc(db, "agencies", existingDoc.id), { ...agencyDataPayload, updatedDate: serverTimestamp() });
          await updateDoc(doc(db, "users", existingDoc.id), { name: agencyDataPayload.name, status: "Active" });
          toast({ title: "Reactivated", description: "Agency account reactivated successfully." });
        } else {
          const secondaryAppName = `create-auth-${Date.now()}`;
          const secondaryApp = initializeApp(firebaseConfig, secondaryAppName);
          try {
            const secondaryAuth = getAuth(secondaryApp);
            const agencyId = await generateAgencyId();
            const tempPassword = generateTempPassword();
            const userCredential = await createUserWithEmailAndPassword(secondaryAuth, primaryEmail, tempPassword);
            const uid = userCredential.user.uid;
            
            await setDoc(doc(db, "users", uid), { name: agencyDataPayload.name, email: primaryEmail, role: "agency", agencyId, status: "Active", firstLogin: true });
            await setDoc(doc(db, "agencies", uid), { ...agencyDataPayload, agencyId, authUid: uid, createdDate: serverTimestamp() });
            await sendWelcomeEmail({ agencyName: agencyDataPayload.name, agencyEmail: primaryEmail, tempPassword: tempPassword });
            
            await signOut(secondaryAuth);
          } finally { await deleteApp(secondaryApp); }
          toast({ title: "Success", description: "Agency created successfully." });
        }
      }
      setIsModalOpen(false);
      resetForm();
      await fetchAgencies();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  const handleEdit = (agency: any) => {
    setEditingId(agency.id);
    setFormData({ 
      agencyName: agency.name || "",
      address: agency.address || "",
      website: agency.website || "",
      commissionPercentage: agency.commissionPercentage || "",
      status: agency.status || "Active",
      primaryContact: {
        name: agency.primaryContact?.name || agency.contactPerson || "",
        email: agency.primaryContact?.email || agency.email || "",
        phone: agency.primaryContact?.phone || agency.phone || ""
      },
      additionalContacts: agency.additionalContacts || []
    });
    setErrors({});
    setIsModalOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setIsLoading(true);
    try {
      await updateDoc(doc(db, "agencies", deleteId), { status: "Inactive", updatedDate: serverTimestamp() });
      await updateDoc(doc(db, "users", deleteId), { status: "Inactive" });
      toast({ title: "Deactivated", description: "Agency has been marked as inactive and access is revoked." });
      setDeleteId(null);
      await fetchAgencies();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAgencyInfoChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: undefined }));
  };

  const handlePrimaryContactChange = (field: string, value: string) => {
    const val = field === 'phone' ? value.replace(/\D/g, "").slice(0, 10) : value;
    setFormData(prev => ({ ...prev, primaryContact: { ...prev.primaryContact, [field]: val } }));
    setErrors(prev => ({...prev, primaryContact: { ...(prev.primaryContact || {}), [field]: undefined }}));
  };

  const handleAddContact = () => setFormData(p => ({ ...p, additionalContacts: [...p.additionalContacts, { name: "", email: "", phone: "" }]}));
  const handleRemoveContact = (index: number) => setFormData(p => ({ ...p, additionalContacts: p.additionalContacts.filter((_, i) => i !== index)}));
  
  const handleAdditionalContactChange = (index: number, field: string, value: string) => {
    const val = field === 'phone' ? value.replace(/\D/g, "").slice(0, 10) : value;
    const updated = [...formData.additionalContacts];
    updated[index] = { ...updated[index], [field]: val };
    setFormData(p => ({...p, additionalContacts: updated}));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pt-2 pb-4">
        <div className="flex flex-col">
          <h1 className="text-3xl font-headline font-bold text-foreground leading-tight tracking-tight">Agency Management</h1>
          <p className="text-sm text-muted-foreground mt-1">Onboard and manage your recruitment partners.</p>
        </div>
        <Button onClick={() => { resetForm(); setIsModalOpen(true); }} className="gap-2 shrink-0">
          <Plus className="h-4 w-4" /> New Agency
        </Button>
      </div>

      <div className="flex flex-col md:flex-row items-end gap-4 bg-card p-4 rounded-lg shadow-sm border">
        <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
          <div className="space-y-2"><label className="text-sm font-medium">Agency ID</label><Select onValueChange={setFilterAgencyId} value={filterAgencyId}><SelectTrigger><SelectValue placeholder="All Agency IDs" /></SelectTrigger><SelectContent><SelectItem value="all">All Agency IDs</SelectItem>{agencyIdOptions.map(id => <SelectItem key={id} value={id}>{id}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><label className="text-sm font-medium">Agency Name</label><Select onValueChange={setFilterName} value={filterName}><SelectTrigger><SelectValue placeholder="All Agencies" /></SelectTrigger><SelectContent><SelectItem value="all">All Agencies</SelectItem>{nameOptions.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><label className="text-sm font-medium">Contact Person</label><Select onValueChange={setFilterContact} value={filterContact}><SelectTrigger><SelectValue placeholder="All Contacts" /></SelectTrigger><SelectContent><SelectItem value="all">All Contacts</SelectItem>{contactOptions.map(contact => <SelectItem key={contact} value={contact}>{contact}</SelectItem>)}</SelectContent></Select></div>
        </div>
        {hasActiveFilters && (<Button variant="secondary" size="sm" onClick={handleClearFilters} className="h-10 gap-2"><XCircle className="h-4 w-4" /> Clear Filters</Button>)}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead><TableHead>Agency ID</TableHead><TableHead>Agency Name</TableHead>
                <TableHead>Contact Person</TableHead><TableHead>Email</TableHead><TableHead>Phone</TableHead>
                <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isDataLoading ? (<TableRow><TableCell colSpan={8} className="text-center h-32"><Loader2 className="h-4 w-4 animate-spin inline-block mr-2" /> Loading...</TableCell></TableRow>) : paginatedAgencies.length === 0 ? (<TableRow><TableCell colSpan={8} className="text-center h-32 text-muted-foreground">No agencies found.</TableCell></TableRow>) : (
                paginatedAgencies.map((agency) => (
                  <TableRow key={agency.id}>
                    <TableCell>{isMounted && agency.createdDate ? agency.createdDate.toDate().toLocaleDateString() : "..."}</TableCell>
                    <TableCell className="font-mono font-medium">{agency.agencyId}</TableCell>
                    <TableCell className="font-medium">{agency.name}</TableCell>
                    <TableCell>{agency.primaryContact?.name || agency.contactPerson}</TableCell>
                    <TableCell>{agency.primaryContact?.email || agency.email}</TableCell>
                    <TableCell>{agency.primaryContact?.phone || agency.phone}</TableCell>
                    <TableCell><Badge variant={agency.status === "Active" ? "default" : "secondary"}>{agency.status || "Active"}</Badge></TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => handleEdit(agency)}>Edit</DropdownMenuItem>
                          {agency.status === "Active" && (<DropdownMenuItem className="text-destructive" onSelect={() => setDeleteId(agency.id)}>Deactivate</DropdownMenuItem>)}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
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

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingId ? "Edit Agency" : "Add New Agency"}</DialogTitle></DialogHeader>
          <form onSubmit={handleSaveAgency} className="space-y-6 pt-4">
            <div>
                <Label className="text-base font-semibold">Agency Information</Label>
                <Separator className="mt-2 mb-4" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2 md:col-span-2"><Label>Agency Name</Label><Input value={formData.agencyName} onChange={e => handleAgencyInfoChange('agencyName', e.target.value)} className={cn(errors.agencyName && "border-destructive")}/>{errors.agencyName && <p className="text-destructive text-xs">{errors.agencyName}</p>}</div>
                    <div className="space-y-2 md:col-span-2"><Label>Address</Label><Input value={formData.address} onChange={e => handleAgencyInfoChange('address', e.target.value)} className={cn(errors.address && "border-destructive")}/>{errors.address && <p className="text-destructive text-xs">{errors.address}</p>}</div>
                    <div className="space-y-2"><Label>Website (Optional)</Label><Input value={formData.website} onChange={e => handleAgencyInfoChange('website', e.target.value)} /></div>
                    <div className="space-y-2"><Label>Commission % (Optional)</Label><Input type="number" value={formData.commissionPercentage} onChange={e => handleAgencyInfoChange('commissionPercentage', e.target.value)} /></div>
                    {editingId && (<div className="space-y-2"><Label>Status</Label><Select value={formData.status} onValueChange={v => setFormData({...formData, status: v})}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Active">Active</SelectItem><SelectItem value="Inactive">Inactive</SelectItem></SelectContent></Select></div>)}
                </div>
            </div>
            
            <div className="pt-4 border-t">
                <Label className="text-base font-semibold">Primary Contact</Label>
                <Separator className="mt-2 mb-4" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2"><Label>Name</Label><Input value={formData.primaryContact.name} onChange={e => handlePrimaryContactChange('name', e.target.value)} className={cn(errors.primaryContact?.name && "border-destructive")}/>{errors.primaryContact?.name && <p className="text-destructive text-xs">{errors.primaryContact.name}</p>}</div>
                    <div className="space-y-2"><Label>Email</Label><Input type="email" disabled={!!editingId} value={formData.primaryContact.email} onChange={e => handlePrimaryContactChange('email', e.target.value)} className={cn(errors.primaryContact?.email && "border-destructive")}/>{errors.primaryContact?.email && <p className="text-destructive text-xs">{errors.primaryContact.email}</p>}</div>
                    <div className="space-y-2"><Label>Phone Number</Label><Input value={formData.primaryContact.phone} onChange={e => handlePrimaryContactChange('phone', e.target.value)} placeholder="10 digits" className={cn(errors.primaryContact?.phone && "border-destructive")}/>{errors.primaryContact?.phone && <p className="text-destructive text-xs">{errors.primaryContact.phone}</p>}</div>
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
                            <div className="space-y-2"><Label>Name</Label><Input value={contact.name} onChange={e => handleAdditionalContactChange(index, 'name', e.target.value)} /></div>
                            <div className="space-y-2"><Label>Email</Label><Input type="email" value={contact.email} onChange={e => handleAdditionalContactChange(index, 'email', e.target.value)} className={cn(errors.additionalContacts?.[index]?.email && "border-destructive")} />{errors.additionalContacts?.[index]?.email && <p className="text-destructive text-xs">{errors.additionalContacts[index].email}</p>}</div>
                            <div className="space-y-2"><Label>Phone</Label><Input value={contact.phone} onChange={e => handleAdditionalContactChange(index, 'phone', e.target.value)} placeholder="10 digits" className={cn(errors.additionalContacts?.[index]?.phone && "border-destructive")} />{errors.additionalContacts?.[index]?.phone && <p className="text-destructive text-xs">{errors.additionalContacts[index].phone}</p>}</div>
                        </div>
                    </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={handleAddContact}>Add Another Contact</Button>
              </CollapsibleContent>
            </Collapsible>

            <DialogFooter className="!mt-8"><Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>Cancel</Button><Button type="submit" disabled={isLoading}>{isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : (editingId ? "Update" : "Create")}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={o => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate Agency?</AlertDialogTitle>
            <AlertDialogDescription>This will revoke the agency's access to the dashboard. They can be reactivated later if needed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={handleDelete} disabled={isLoading}>{isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : "Deactivate Now"}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
