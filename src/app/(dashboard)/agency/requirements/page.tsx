'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { collection, onSnapshot, query, where, addDoc, serverTimestamp, deleteDoc, doc, updateDoc, getDoc, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, UploadCloud, File as FileIcon, Briefcase, X, Trash2, Edit, MoreVertical, ExternalLink, Plus } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const EXPERIENCE_OPTIONS = [
    '0-6 months',
    '6-12 months',
    '1-2 years',
    '3-4 years',
    '4-5 Years',
    '6+ years',
];

const NOTICE_PERIOD_OPTIONS = [
    'Immediate',
    '0-30 days',
    '31-60 days',
    '60+ days',
];

const RequirementSkeleton = () => (
    <>
        {[...Array(5)].map((_, i) => (
            <TableRow key={i} className="border-b border-gray-100">
                <TableCell className="p-5"><Skeleton className="h-5 w-32 rounded-md" /></TableCell>
                <TableCell className="p-5"><Skeleton className="h-5 w-40 rounded-md" /></TableCell>
                <TableCell className="p-5"><Skeleton className="h-5 w-20 rounded-md" /></TableCell>
                <TableCell className="p-5"><Skeleton className="h-5 w-20 rounded-md" /></TableCell>
                <TableCell className="p-5"><Skeleton className="h-7 w-24 rounded-full" /></TableCell>
                <TableCell className="p-5"><Skeleton className="h-5 w-24 rounded-md" /></TableCell>
                <TableCell className="p-5"><Skeleton className="h-5 w-16 rounded-md" /></TableCell>
                <TableCell className="p-5 text-right"><Skeleton className="h-8 w-8 rounded-full ml-auto" /></TableCell>
            </TableRow>
        ))}
    </>
);

const initialFormState = {
    projectName: '',
    jobRole: '',
    location: '',
    experience: '',
    noticePeriod: '',
    status: 'Active',
};

export default function RequirementsManagementPage() {
    const { toast } = useToast();
    const { user } = useAuth();
    const [requirements, setRequirements] = useState<any[] | undefined>(undefined);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    
    // State Management
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingRequirement, setEditingRequirement] = useState<any | null>(null);
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [deletingRequirement, setDeletingRequirement] = useState<any | null>(null);
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [formData, setFormData] = useState(initialFormState);
    const [jdFile, setJdFile] = useState<File | null>(null);
    const [jdFileName, setJdFileName] = useState<string | null>(null);

    // Filters
    const [filterStatus, setFilterStatus] = useState('all');
    const [filterRole, setFilterRole] = useState('all');
    const [filterExperience, setFilterExperience] = useState('all');
    const [filterNoticePeriod, setFilterNoticePeriod] = useState('all');

    // Firestore listener
    useEffect(() => {
        if (!user) {
            setRequirements([]);
            return;
        }

        const q = query(collection(db, 'requirements'), where('agencyId', '==', user.uid), orderBy('createdAt', 'desc'));
        
        const unsubscribe = onSnapshot(q, 
            (snapshot) => {
                const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setRequirements(data);
                setError(null);
            },
            (err) => {
                console.error('Firestore Error:', err);
                setError('Failed to load requirements. Please ensure the required Firestore index is created.');
                toast({ title: 'Error', description: 'Failed to load requirements. A database index is required.', variant: 'destructive' });
            }
        );
        
        return () => unsubscribe();
    }, [user, toast]);

    const resetState = useCallback(() => {
        setFormData(initialFormState);
        setJdFile(null);
        setJdFileName(null);
        setEditingRequirement(null);
        setDeletingRequirement(null);
        setOpenMenuId(null);
    }, []);

    useEffect(() => {
        if (!isModalOpen && !isDeleteConfirmOpen) {
            const timer = setTimeout(() => {
                resetState();
                document.body.style.pointerEvents = 'auto';
            }, 150);
            return () => clearTimeout(timer);
        }
    }, [isModalOpen, isDeleteConfirmOpen, resetState]);


    const handleFormChange = (field: string, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleNewRequirementClick = () => {
        resetState();
        setIsModalOpen(true);
    };

    const handleEditClick = (req: any) => {
        setOpenMenuId(null);
        setEditingRequirement(req);
        setFormData({
            projectName: req.projectName === 'N/A' ? '' : req.projectName || '',
            jobRole: req.jobRole || '',
            location: req.location || '',
            experience: req.experience || '',
            noticePeriod: req.noticePeriod || '',
            status: req.status || 'Active',
        });
        setJdFileName(req.jdFileName || null);
        setJdFile(null);
        setIsModalOpen(true);
    };
    
    const handleDeleteClick = (req: any) => {
        setOpenMenuId(null);
        setDeletingRequirement(req);
        setIsDeleteConfirmOpen(true);
    };

    const onDrop = useCallback((acceptedFiles: File[]) => {
        const file = acceptedFiles[0];
        if (file) {
            if (file.size > 10 * 1024 * 1024) {
                toast({ title: 'File Too Large', description: 'Please upload a file smaller than 10MB.', variant: 'destructive' });
                return;
            }
            setJdFile(file);
            setJdFileName(file.name);
        }
    }, [toast]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: { 'application/pdf': ['.pdf'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'], 'application/msword': ['.doc'] }, multiple: false });

    const uniqueJobRoles = useMemo(() => {
        if (!requirements) return [];
        const roles = new Set(requirements.map(r => r.jobRole).filter(Boolean));
        return ['all', ...Array.from(roles)];
    }, [requirements]);

    const filteredRequirements = useMemo(() => {
        if (!requirements) return [];
        return requirements.filter(req => 
            (filterStatus === 'all' || req.status === filterStatus) &&
            (filterRole === 'all' || req.jobRole === filterRole) &&
            (filterExperience === 'all' || req.experience === filterExperience) &&
            (filterNoticePeriod === 'all' || req.noticePeriod === filterNoticePeriod)
        );
    }, [requirements, filterStatus, filterRole, filterExperience, filterNoticePeriod]);
    
    const hasActiveFilters = useMemo(() => {
        return filterStatus !== 'all' || filterRole !== 'all' || filterExperience !== 'all' || filterNoticePeriod !== 'all';
    }, [filterStatus, filterRole, filterExperience, filterNoticePeriod]);

    const clearFilters = () => {
        setFilterStatus('all');
        setFilterRole('all');
        setFilterExperience('all');
        setFilterNoticePeriod('all');
    };

    const getStatusBadge = (status: string) => {
        const styles = { 'Active': 'bg-green-100 text-green-700', 'Inactive': 'bg-gray-100 text-gray-500' };
        return <Badge className={`rounded-full px-3 py-1 text-xs font-semibold hover:bg-opacity-90 ${styles[status as keyof typeof styles] || 'bg-gray-100 text-gray-500'}`}>{status}</Badge>;
    };

    const handleViewJd = (base64Data: string, fileType: string) => {
        try {
            if (!base64Data || !fileType) {
                toast({ title: 'Error', description: 'No Job Description available to view.', variant: 'destructive' });
                return;
            }
            const base64WithoutPrefix = base64Data.split(',')[1];
            const byteCharacters = atob(base64WithoutPrefix);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: fileType });
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
        } catch (error) {
            console.error('Error opening JD:', error);
            toast({ title: 'Error', description: 'Could not open the Job Description.', variant: 'destructive' });
        }
    };
    
    const handleSubmit = async () => {
        if (!formData.jobRole || !formData.location || !formData.experience || !formData.noticePeriod) {
            toast({ title: 'Missing Fields', description: 'Please fill all required fields.', variant: 'destructive' });
            return;
        }
        if (!user?.uid) {
            toast({ title: 'Error', description: 'User information is not available.', variant: 'destructive' });
            return;
        }

        setIsSubmitting(true);
        try {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            const agencyName = userDoc.exists() ? (userDoc.data().name || userDoc.data().displayName || "") : "";

            let finalJdData: {
                jdFileData: string | null;
                jdFileName: string | null;
                jdFileType: string | null;
            } = {
                jdFileData: null,
                jdFileName: null,
                jdFileType: null,
            };
            
            if (jdFile) {
                const getBase64 = (file: File) => new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.readAsDataURL(file);
                    reader.onload = () => resolve(reader.result as string);
                    reader.onerror = error => reject(error);
                });
                finalJdData.jdFileData = await getBase64(jdFile);
                finalJdData.jdFileName = jdFile.name;
                finalJdData.jdFileType = jdFile.type;
            } 
            else if (editingRequirement && jdFileName) {
                finalJdData.jdFileData = editingRequirement.jdFileData;
                finalJdData.jdFileName = editingRequirement.jdFileName;
                finalJdData.jdFileType = editingRequirement.jdFileType;
            }

            const requirementData = {
                ...formData,
                projectName: formData.projectName.trim() || 'N/A',
                ...finalJdData,
                createdBy: user.uid,
                createdByRole: 'agency',
                agencyId: user.uid,
                agencyName,
            };

            if (editingRequirement) {
                await updateDoc(doc(db, "requirements", editingRequirement.id), requirementData);
                toast({ title: "Success", description: "Requirement updated successfully." });
            } else {
                await addDoc(collection(db, "requirements"), {
                    ...requirementData,
                    createdAt: serverTimestamp(),
                });
                toast({ title: "Success", description: "New requirement created." });
            }

            setIsModalOpen(false);
        } catch (error) {
            console.error("Error submitting requirement: ", error);
            toast({ title: "Error", description: "Failed to save requirement.", variant: "destructive" });
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const handleConfirmDelete = async () => {
        if (!deletingRequirement) return;
        try {
            await deleteDoc(doc(db, 'requirements', deletingRequirement.id));
            toast({ title: 'Success', description: 'Requirement deleted.' });
        } catch (error) {
            console.error('Error deleting requirement: ', error);
            toast({ title: 'Error', description: 'Failed to delete requirement.', variant: 'destructive' });
        } finally {
            setIsDeleteConfirmOpen(false);
        }
    };

    const formInputClass = 'rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent';
    const formLabelClass = 'text-xs font-medium text-gray-500 uppercase tracking-wide mb-1 block';

    return (
        <div className="bg-[#f1f5f9] min-h-screen p-4 sm:p-6 lg:p-8">
            <div className="max-w-7xl mx-auto space-y-6">
                <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Requirements</h1>
                        <p className="text-sm text-gray-500 mt-1">View and manage your job requirements.</p>
                    </div>
                    <Button onClick={handleNewRequirementClick} className="bg-indigo-600 hover:bg-indigo-700 text-white"><Plus className="mr-2 h-4 w-4" />New Requirement</Button>
                </header>

                <div className="bg-white rounded-2xl shadow-sm p-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-center">
                        <Select value={filterStatus} onValueChange={setFilterStatus}><SelectTrigger className={formInputClass}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Status</SelectItem><SelectItem value="Active">Active</SelectItem><SelectItem value="Inactive">Inactive</SelectItem></SelectContent></Select>
                        <Select value={filterRole} onValueChange={setFilterRole}><SelectTrigger className={formInputClass}><SelectValue /></SelectTrigger><SelectContent>{uniqueJobRoles.map(role => <SelectItem key={role} value={role}>{role === 'all' ? 'All Roles' : role}</SelectItem>)}</SelectContent></Select>
                        <Select value={filterExperience} onValueChange={setFilterExperience}><SelectTrigger className={formInputClass}><SelectValue placeholder="All Experience" /></SelectTrigger><SelectContent><SelectItem value="all">All Experience</SelectItem>{EXPERIENCE_OPTIONS.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}</SelectContent></Select>
                        <Select value={filterNoticePeriod} onValueChange={setFilterNoticePeriod}><SelectTrigger className={formInputClass}><SelectValue placeholder="All Notice Periods" /></SelectTrigger><SelectContent><SelectItem value="all">All Notice Periods</SelectItem>{NOTICE_PERIOD_OPTIONS.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}</SelectContent></Select>
                        {hasActiveFilters && (
                            <Button onClick={clearFilters} variant="ghost" className="text-sm text-indigo-600 hover:text-indigo-700 justify-self-start lg:justify-self-center">
                                Clear Filters
                            </Button>
                        )}
                    </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader className="bg-gray-50">
                                <TableRow>{['Project Name', 'Job Role', 'Experience', 'Notice Period', 'Status', 'Created Date', 'JD', 'Actions'].map(h => <TableHead key={h} className="py-3 px-5 text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</TableHead>)}</TableRow>
                            </TableHeader>
                            <TableBody>
                                {requirements === undefined ? <RequirementSkeleton /> :
                                error ? <TableRow><TableCell colSpan={8} className="h-60 text-center text-red-500">{error}</TableCell></TableRow> :
                                requirements.length === 0 ? <TableRow><TableCell colSpan={8} className="h-60 text-center"><Briefcase className="mx-auto h-12 w-12 text-gray-300" /><p className="mt-3 font-medium text-sm text-gray-500">No requirements found</p><p className="mt-1 text-xs text-gray-400">Create one to get started.</p></TableCell></TableRow> :
                                filteredRequirements.map(req => (
                                    <TableRow key={req.id} className="border-b hover:bg-gray-50 text-sm">
                                        <TableCell className="p-5 font-medium">{req.projectName || 'N/A'}</TableCell>
                                        <TableCell className="p-5">{req.jobRole}</TableCell>
                                        <TableCell className="p-5">{req.experience}</TableCell>
                                        <TableCell className="p-5">{req.noticePeriod}</TableCell>
                                        <TableCell className="p-5">{getStatusBadge(req.status)}</TableCell>
                                        <TableCell className="p-5">{req.createdAt?.toDate().toLocaleDateString()}</TableCell>
                                        <TableCell className="p-5">{req.jdFileData ? <a onClick={() => handleViewJd(req.jdFileData, req.jdFileType)} className="cursor-pointer font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1.5">View <ExternalLink className="h-4 w-4" /></a> : 'N/A'}</TableCell>
                                        <TableCell className="p-5 text-right">
                                            <DropdownMenu onOpenChange={(isOpen) => setOpenMenuId(isOpen ? req.id : null)} open={openMenuId === req.id}>
                                                <DropdownMenuTrigger asChild><Button variant="ghost" className="h-8 w-8 p-0 rounded-full"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onSelect={() => handleEditClick(req)}><Edit className="mr-2 h-4 w-4"/>Edit</DropdownMenuItem>
                                                    <DropdownMenuItem onSelect={() => handleDeleteClick(req)} className="text-red-600 focus:text-red-600 focus:bg-red-50"><Trash2 className="mr-2 h-4 w-4"/>Delete</DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </div>
            </div>

            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogContent className="sm:max-w-[600px]">
                    <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
                        <DialogHeader>
                            <DialogTitle>{editingRequirement ? 'Edit Requirement' : 'New Requirement'}</DialogTitle>
                            <DialogDescription>Fill in the details below to {editingRequirement ? 'update the' : 'create a new'} requirement.</DialogDescription>
                        </DialogHeader>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-6">
                            <div><label className={formLabelClass}>Project Name</label><input value={formData.projectName} onChange={e => handleFormChange('projectName', e.target.value)} className={formInputClass} /></div>
                            <div><label className={formLabelClass}>Job Role</label><input value={formData.jobRole} onChange={e => handleFormChange('jobRole', e.target.value)} required className={formInputClass} /></div>
                            <div><label className={formLabelClass}>Location</label><input value={formData.location} onChange={e => handleFormChange('location', e.target.value)} required className={formInputClass} /></div>
                            <div><label className={formLabelClass}>Experience</label><Select value={formData.experience} onValueChange={v => handleFormChange('experience', v)} required><SelectTrigger className={formInputClass}><SelectValue placeholder="Select..." /></SelectTrigger><SelectContent>{EXPERIENCE_OPTIONS.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}</SelectContent></Select></div>
                            <div><label className={formLabelClass}>Notice Period</label><Select value={formData.noticePeriod} onValueChange={v => handleFormChange('noticePeriod', v)} required><SelectTrigger className={formInputClass}><SelectValue placeholder="Select..." /></SelectTrigger><SelectContent>{NOTICE_PERIOD_OPTIONS.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}</SelectContent></Select></div>
                            <div><label className={formLabelClass}>Status</label><Select value={formData.status} onValueChange={v => handleFormChange('status', v)}><SelectTrigger className={formInputClass}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Active">Active</SelectItem><SelectItem value="Inactive">Inactive</SelectItem></SelectContent></Select></div>
                            <div className="md:col-span-2">
                                <label className={formLabelClass}>Job Description</label>
                                <div {...getRootProps()} className={`mt-1 border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${isDragActive ? 'border-indigo-400 bg-indigo-50/60' : 'border-indigo-200 bg-indigo-50/40'}`}>
                                    <input {...getInputProps()} />
                                    {jdFileName ? (
                                        <div className="flex items-center justify-between text-sm"><div className="flex items-center gap-2 font-medium"><FileIcon className="h-5 w-5 text-indigo-500"/>{jdFileName}</div><Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setJdFile(null); setJdFileName(null); }}><X className="h-4 w-4"/></Button></div>
                                    ) : (
                                        <div className="flex flex-col items-center gap-1 text-gray-500"><UploadCloud className="h-8 w-8 text-indigo-400" /><p className="text-sm">Drag & drop or <span className="font-semibold text-indigo-600">click to upload</span></p></div>
                                    )}
                                </div>
                            </div>
                        </div>
                        <DialogFooter>
                            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                            <Button type="submit" disabled={isSubmitting || !formData.jobRole || !formData.location || !formData.experience || !formData.noticePeriod} className="bg-indigo-600 hover:bg-indigo-700 text-white">{isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {editingRequirement ? 'Save Changes' : 'Create'}</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader><DialogTitle>Delete Requirement</DialogTitle><DialogDescription>Are you sure you want to delete this requirement? This action cannot be undone.</DialogDescription></DialogHeader>
                    <DialogFooter className="sm:justify-end gap-2 mt-4">
                        <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                        <Button type="button" variant="destructive" onClick={handleConfirmDelete} className="bg-red-600">Delete</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
