'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, UploadCloud, FileArchive, Loader2, X, Check } from 'lucide-react';

interface JobRequisitionOption {
    id: string;
    projectName: string;
    department?: string;
    location?: string;
}

const ACCEPTED_EXTENSIONS = ['.zip', '.pdf', '.doc', '.docx'];

function isAcceptedFile(file: File): boolean {
    const lower = file.name.toLowerCase();
    return ACCEPTED_EXTENSIONS.some(ext => lower.endsWith(ext));
}

const STAGES = [
    'Uploading resumes...',
    'Extracting candidate information...',
    'Calculating ATS scores...',
    'Saving imported candidates...',
];

export default function BulkUploadPage() {
    const router = useRouter();
    const { user, role } = useAuth();

    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [isImporting, setIsImporting] = useState(false);

    const [processed, setProcessed] = useState(0);
    const [total, setTotal] = useState(0);

    const [jobRequisitions, setJobRequisitions] = useState<JobRequisitionOption[]>([]);
    const [selectedProjectId, setSelectedProjectId] = useState<string>('');

    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!role || !user) {
            setJobRequisitions([]);
            return;
        }

        let q: any;
        if (role === 'admin' || role === 'hr') {
            q = query(collection(db, 'job_requisitions'), where('status', '==', 'Active'));
        } else if (role === 'agency') {
            q = query(
                collection(db, 'job_requisitions'),
                where('status', '==', 'Active'),
                where('assignedAgencies', 'array-contains', user.uid)
            );
        }
        if (!q) return;

        const unsub = onSnapshot(q, (snap: any) => {
            setJobRequisitions(
                snap.docs.map((d: any) => {
                    const data = d.data();
                    return {
                        id: d.id,
                        projectName: data.projectName || 'Untitled Project',
                        department: data.department,
                        location: data.location || (data.locations || []).join(', '),
                    };
                })
            );
        });
        return () => unsub();
    }, [role, user]);

    const handleFilesChosen = (fileList: FileList | File[]) => {
        const files = Array.from(fileList).filter(isAcceptedFile);
        if (files.length === 0) {
            toast.error('Please select a .zip, .pdf, .doc, or .docx file.');
            return;
        }
        setSelectedFiles(prev => [...prev, ...files]);
    };

    const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files?.length) {
            handleFilesChosen(e.dataTransfer.files);
        }
    }, []);

    const removeSelectedFile = (index: number) => {
        setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    };

    // Approximate phase indicator derived from progress percentage. The
    // backend processes uploading/extraction/scoring/saving per-file, not
    // as discrete global phases, so this is a UX approximation — the
    // underlying import logic itself is unchanged.
    const currentStageIndex =
        total === 0
            ? 0
            : Math.min(STAGES.length - 1, Math.floor((processed / total) * STAGES.length));

    const handleImport = async () => {
        if (selectedFiles.length === 0) {
            toast.error('Please select at least one file to import.');
            return;
        }
        if (!selectedProjectId) {
            toast.error('Please select a project before importing.');
            return;
        }
    

        setProcessed(0);
        setTotal(0);
        setIsImporting(true);

        try {
            const formData = new FormData();
            selectedFiles.forEach(file => formData.append('files', file));
            formData.append('createdBy', user?.uid || 'bulk-import');
            if (selectedProjectId) {
                formData.append('jobRequisitionId', selectedProjectId);
            }

            const response = await fetch('/api/candidates/bulk-import', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok || !response.body) {
                throw new Error('Import request failed.');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;
                    const event = JSON.parse(line);

                    if (event.type === 'start') {
                        setTotal(event.total);
                    } else if (event.type === 'progress') {
                        setProcessed(event.processed);
                    } else if (event.type === 'done') {
                        // no-op here — handled after the stream fully drains below
                    }
                }
            }

            toast.success('Import completed.');
            // Redirect back to the landing page — its onSnapshot listener
            // picks up the newly created candidate docs automatically.
            router.push('/candidates/import');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Import failed. Please try again.');
            setIsImporting(false);
        }
    };

    return (
        <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-6">
            <Button variant="ghost" size="sm" onClick={() => router.push('/candidates/import')} className="-ml-2">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Bulk Candidate Import
            </Button>

            <Card>
                <CardHeader>
                    <CardTitle className="text-xl">Bulk Upload Resumes</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div
                        onDragOver={e => {
                            e.preventDefault();
                            setIsDragging(true);
                        }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={handleDrop}
                        onClick={() => !isImporting && fileInputRef.current?.click()}
                        className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg p-10 text-center transition-colors ${
                            isImporting ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
                        } ${isDragging ? 'border-primary bg-primary/5' : 'border-gray-300 hover:border-gray-400'}`}
                    >
                        <UploadCloud className="h-10 w-10 text-gray-400" />
                        <p className="font-medium">Drag &amp; Drop Resume Files Here</p>
                        <p className="text-sm text-muted-foreground">Supports: ZIP containing PDFs/DOCs</p>
                        <p className="text-sm text-muted-foreground">OR</p>
                        <Button type="button" variant="secondary" size="sm" disabled={isImporting}>
                            Browse Files
                        </Button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            accept=".zip,.pdf,.doc,.docx"
                            className="hidden"
                            onChange={e => e.target.files && handleFilesChosen(e.target.files)}
                            disabled={isImporting}
                        />
                    </div>

                    <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                            <FileArchive className="h-4 w-4" /> resumes.zip
                        </span>
                        <span>· PDF</span>
                        <span>· DOC</span>
                        <span>· DOCX</span>
                    </div>

                    {selectedFiles.length > 0 && (
                        <div className="space-y-1 border rounded-md p-3">
                            {selectedFiles.map((file, idx) => (
                                <div key={`${file.name}-${idx}`} className="flex items-center justify-between text-sm">
                                    <span className="truncate">{file.name}</span>
                                    <button
                                        type="button"
                                        onClick={() => removeSelectedFile(idx)}
                                        className="text-muted-foreground hover:text-red-600"
                                        aria-label={`Remove ${file.name}`}
                                        disabled={isImporting}
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

<div className="space-y-1.5">
    <label className="text-sm font-medium">
        Project <span className="text-red-600">*</span>
    </label>
    <Select value={selectedProjectId} onValueChange={setSelectedProjectId} disabled={isImporting}>
        <SelectTrigger className="w-full md:w-96">
            <SelectValue placeholder="Select a project" />
        </SelectTrigger>
        <SelectContent>
            {jobRequisitions.map(req => (
                <SelectItem key={req.id} value={req.id}>
                    {req.projectName}
                    {req.department ? ` · ${req.department}` : ''}
                    {req.location ? ` · ${req.location}` : ''}
                </SelectItem>
            ))}
            {jobRequisitions.length === 0 && (
                <div className="px-4 py-2 text-sm text-muted-foreground">
                    No active projects available.
                </div>
            )}
        </SelectContent>
    </Select>
    <p className="text-xs text-muted-foreground">
        A project is required so candidates can be scored against its Job Description.
    </p>
</div>

                    <Button
    onClick={handleImport}
    disabled={isImporting || selectedFiles.length === 0 || !selectedProjectId}
    className="w-full"
>
                        {isImporting ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Importing...
                            </>
                        ) : (
                            'Import Candidates'
                        )}
                    </Button>
                </CardContent>
            </Card>

            {isImporting && (
                <Card>
                    <CardContent className="pt-6 space-y-3">
                        <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-primary transition-all"
                                style={{ width: `${total > 0 ? Math.round((processed / total) * 100) : 5}%` }}
                            />
                        </div>
                        <div className="space-y-2">
                            {STAGES.map((stage, idx) => (
                                <div
                                    key={stage}
                                    className={`flex items-center gap-2 text-sm ${
                                        idx < currentStageIndex
                                            ? 'text-green-600'
                                            : idx === currentStageIndex
                                            ? 'text-foreground font-medium'
                                            : 'text-muted-foreground'
                                    }`}
                                >
                                    {idx < currentStageIndex ? (
                                        <Check className="h-4 w-4" />
                                    ) : idx === currentStageIndex ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <span className="h-4 w-4 inline-block" />
                                    )}
                                    {stage}
                                </div>
                            ))}
                        </div>
                        {total > 0 && (
                            <p className="text-xs text-muted-foreground">
                                {processed} / {total} files processed
                            </p>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}