'use client';

import React, { useEffect, useRef, useState } from 'react';
import { deleteDoc } from 'firebase/firestore';
import { query, orderBy } from "firebase/firestore";
import {
  collection,
  onSnapshot,
  addDoc,
  serverTimestamp,
  doc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

/* ─────────────────────────────────────────────
   Types — matches your Firestore structure
───────────────────────────────────────────── */
interface Requirement {
  id: string;
  projectName: string;
  jobRole: string;
  location: string;
  experience: string;
  noticePeriod: string;
  status: 'Active' | 'Closed';
  createdAt?: any;
  jdFileData?: string;
  jdFileName?: string;
  jdFileType?: string;
  agencyId?: string;
  agencyName?: string;
  createdBy?: string;
  createdByRole?: string;
}

type FormData = {
  projectName: string;
  jobRole: string;
  location: string;
  experience: string;
  noticePeriod: string;
  status: 'Active' | 'Closed';
};

const EMPTY_FORM: FormData = {
  projectName: '',
  jobRole: '',
  location: '',
  experience: '',
  noticePeriod: '',
  status: 'Active',
};

const NOTICE_PERIOD_OPTIONS = ['Immediate', '0-15 days', '15-30 days', '30-60 days', '60+ days'];
const EXPERIENCE_OPTIONS = [
  '0-1 years',
  '1-2 years',
  '2-3 years',
  '3-5 years',
  '5-8 years',
  '8+ years',
  'Others'   // ✅ ADD HERE
];
/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────── */
function fmtDate(ts: any): string {
  if (!ts) return '-';
  try {
    const d = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  } catch {
    return '-';
  }
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}

function StatusBadge({ status }: { status: string }) {
  const active = status === 'Active';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '3px 14px', borderRadius: 9999, fontSize: 13, fontWeight: 500,
      background: active ? '#dcfce7' : '#fee2e2',
      color: active ? '#15803d' : '#b91c1c',
      border: `1px solid ${active ? '#bbf7d0' : '#fecaca'}`,
    }}>
      {status}
    </span>
  );
}

/* ─────────────────────────────────────────────
   Field Input
───────────────────────────────────────────── */
function FieldInput({ label, value, onChange, placeholder, required }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; required?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={labelText}>
        {label}{required && <span style={{ color: '#ef4444', marginLeft: 2 }}>*</span>}
      </span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={inputStyle}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────
   Modal
───────────────────────────────────────────── */
function RequirementModal({
  open, onClose, editData, onSuccess
}: {
  open: boolean;
  onClose: () => void;
  editData?: Requirement | null;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [customExperience, setCustomExperience] = useState('');
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    if (editData) {
      setForm({
        projectName: editData.projectName || '',
        jobRole: editData.jobRole || '',
        location: editData.location || '',
        experience: editData.experience || '',
        noticePeriod: editData.noticePeriod || '',
        status: editData.status || 'Active',
      });
    } else {
      setForm(EMPTY_FORM);
    }
    setJdFile(null);
    setError('');
  }, [open, editData]);

  if (!open) return null;

  const set = (k: keyof FormData, v: string) => setForm(p => ({ ...p, [k]: v }));

  const handleFile = (file: File | null) => {
    if (file && file.type === 'application/pdf') {
      setJdFile(file);
      setError('');
    } else if (file) {
      setError('Only PDF files are accepted.');
    }
  };

  const handleSubmit = async () => {
    if (
      !form.jobRole.trim() ||
      !form.location.trim() ||
      !(
        form.experience === 'Others'
          ? customExperience.trim()
          : form.experience
      ) ||
      !form.noticePeriod ||
      !form.status
    ) {
      setError('Please fill all required fields.');
      return;
    }
    setError('');
    setSubmitting(true);

    try {
      let jdFileData = editData?.jdFileData || '';
      let jdFileName = editData?.jdFileName || '';
      let jdFileType = editData?.jdFileType || '';

      if (jdFile) {
        jdFileData = await toBase64(jdFile);
        jdFileName = jdFile.name;
        jdFileType = jdFile.type;
      }

      const payload: Record<string, any> = {
        projectName: form.projectName.trim(),
        jobRole: form.jobRole.trim(),
        location: form.location.trim(),
        experience:
  form.experience === 'Others'
    ? customExperience.trim()
    : form.experience,
        noticePeriod: form.noticePeriod,
        status: form.status,
        jdFileData,
        jdFileName,
        jdFileType,
      };

      if (editData) {
        await updateDoc(doc(db, 'requirements', editData.id), payload);
      } else {
        await addDoc(collection(db, 'requirements'), {
          ...payload,
          createdAt: serverTimestamp(),
          createdByRole: 'agency',
        });
      }
      onClose();
      onSuccess();
    } catch (err: any) {
      setError('Failed to save: ' + (err?.message || 'Unknown error'));
    } finally {
      setSubmitting(false);
    }
  };

  const isValid =
  form.jobRole.trim() &&
  form.location.trim() &&
  form.experience.trim() &&
  form.noticePeriod &&
  form.status;

  return (
    <div
      onClick={e => e.target === e.currentTarget && !submitting && onClose()}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div style={{
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 660,
        padding: '32px 36px', boxShadow: '0 24px 64px rgba(0,0,0,0.2)',
        position: 'relative', maxHeight: '90vh', overflowY: 'auto',
      }}>
        {!submitting && (
          <button onClick={onClose} style={{
            position: 'absolute', top: 16, right: 20, background: 'none',
            border: 'none', fontSize: 24, cursor: 'pointer', color: '#9ca3af', lineHeight: 1,
          }}>×</button>
        )}

        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#111827', margin: '0 0 24px' }}>
          {editData ? 'Edit Requirement' : 'New Requirement'}
        </h2>

        {error && (
          <div style={{
            background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
            padding: '10px 14px', marginBottom: 16, color: '#dc2626', fontSize: 13,
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px 24px' }}>
          <FieldInput label="PROJECT NAME" value={form.projectName} onChange={v => set('projectName', v)} placeholder="e.g., Deloitte" />
          <FieldInput label="JOB ROLE" value={form.jobRole} onChange={v => set('jobRole', v)} placeholder="e.g., Dev, QA" required />
          <FieldInput label="LOCATION" value={form.location} onChange={v => set('location', v)} placeholder="e.g., Chennai" required />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
  <span style={labelText}>
    EXPERIENCE <span style={{ color: '#ef4444' }}>*</span>
  </span>

  <select
    value={form.experience}
    onChange={e => set('experience', e.target.value)}
    style={inputStyle}
  >
    <option value="">Select...</option>
    {EXPERIENCE_OPTIONS.map(exp => (
      <option key={exp} value={exp}>
        {exp}
      </option>
    ))}
  </select>

  {/* ✅ Show input when Others selected */}
  {form.experience === 'Others' && (
    <input
      placeholder="Enter experience"
      value={customExperience}
      onChange={e => setCustomExperience(e.target.value)}
      style={inputStyle}
    />
  )}
</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={labelText}>
  NOTICE PERIOD <span style={{ color: '#ef4444' }}>*</span>
</span>
            <select value={form.noticePeriod} onChange={e => set('noticePeriod', e.target.value)} style={inputStyle}>
              <option value="">Select...</option>
              {NOTICE_PERIOD_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={labelText}>
  STATUS <span style={{ color: '#ef4444' }}>*</span>
</span>
            <select value={form.status} onChange={e => set('status', e.target.value as any)} style={inputStyle}>
              <option value="Active">Active</option>
              <option value="Closed">Closed</option>
            </select>
          </div>
        </div>

        {/* JD Upload */}
        <div style={{ marginTop: 20 }}>
          <span style={labelText}>JOB DESCRIPTION</span>
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
            onClick={() => fileRef.current?.click()}
            style={{
              marginTop: 6, border: `2px dashed ${dragOver ? '#6366f1' : '#c7d2fe'}`,
              borderRadius: 12, padding: '32px 16px', textAlign: 'center',
              cursor: 'pointer', background: dragOver ? '#eef2ff' : '#f5f7ff',
              transition: 'all 0.2s',
            }}
          >
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" style={{ margin: '0 auto 10px', display: 'block' }}>
              <path d="M12 16V8M12 8l-3 3M12 8l3 3" stroke="#6366f1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" stroke="#6366f1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {jdFile ? (
              <p style={{ color: '#4f46e5', fontSize: 14, fontWeight: 500, margin: 0 }}>📄 {jdFile.name}</p>
            ) : editData?.jdFileName ? (
              <p style={{ color: '#4f46e5', fontSize: 14, margin: 0 }}>
                Current: {editData.jdFileName} · <span style={{ textDecoration: 'underline' }}>Replace</span>
              </p>
            ) : (
              <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>
                Drag & drop file or{' '}
                <span style={{ color: '#4f46e5', fontWeight: 600, textDecoration: 'underline' }}>click to upload</span>
                <br /><span style={{ fontSize: 12, color: '#9ca3af' }}>PDF only</span>
              </p>
            )}
            <input ref={fileRef} type="file" accept="application/pdf" hidden
              onChange={e => handleFile(e.target.files?.[0] || null)} />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 28 }}>
          <button onClick={onClose} disabled={submitting} style={cancelBtn}>Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !isValid}
            style={{ ...primaryBtn, opacity: submitting || !isValid ? 0.65 : 1, minWidth: 160, justifyContent: 'center' }}
          >
            {submitting ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 15, height: 15, border: '2px solid rgba(255,255,255,0.4)',
                  borderTopColor: '#fff', borderRadius: '50%',
                  animation: 'spin 0.7s linear infinite', display: 'inline-block', flexShrink: 0,
                }} />
                Saving…
              </span>
            ) : editData ? 'Update Requirement' : 'Create Requirement'}
          </button>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Actions Menu — Edit + Mark Closed/Active only
───────────────────────────────────────────── */
function ActionsMenu({ req, onEdit }: { req: Requirement; onEdit: (r: Requirement) => void }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this requirement?')) return;
  
    await deleteDoc(doc(db, 'requirements', req.id));
    setOpen(false);
  };
  return (
    <div ref={menuRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 20, color: '#9ca3af', padding: '4px 8px', borderRadius: 6, lineHeight: 1,
        }}
      >⋮</button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '100%', background: '#fff',
          border: '1px solid #e5e7eb', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 30, minWidth: 160, overflow: 'hidden',
        }}>
          <MenuBtn label="Edit" onClick={() => { onEdit(req); setOpen(false); }} />
          <MenuBtn
         label="Delete"
         onClick={handleDelete}
       />
        </div>
      )}
    </div>
  );
}

function MenuBtn({ label, onClick }: {label: string; onClick: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        padding: '10px 16px', textAlign: 'left',
        background: hov ? '#f9fafb' : 'none', border: 'none',
        cursor: 'pointer', fontSize: 13, color: '#374151', fontWeight: 500,
      }}
    >
      <span>{label}</span>
    </button>
  );
}

/* ─────────────────────────────────────────────
   Filter Select
───────────────────────────────────────────── */
function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: string[];
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={filterSelectStyle}>
      <option value="">{label}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

/* ─────────────────────────────────────────────
   Table Row
───────────────────────────────────────────── */
function TableRow({ req, isLast, onEdit }: { req: Requirement; isLast: boolean; onEdit: (r: Requirement) => void }) {
  const [hov, setHov] = useState(false);

  const openJD = () => {
    if (req.jdFileData) {
      const win = window.open();
      if (win) {
        win.document.write(
          `<iframe src="${req.jdFileData}" width="100%" height="100%" style="border:none;position:fixed;inset:0;"></iframe>`
        );
      }
    }
  };

  return (
    <tr
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        borderBottom: isLast ? 'none' : '1px solid #f3f4f6',
        background: hov ? '#fafbff' : '#fff', transition: 'background 0.15s',
      }}
    >
      <td style={tdStyle}><span style={{ fontWeight: 500, color: '#111827' }}>{req.projectName || 'N/A'}</span></td>
      <td style={tdStyle}>{req.jobRole || '-'}</td>
      <td style={tdStyle}>{req.experience || '-'}</td>
      <td style={tdStyle}>{req.noticePeriod || '-'}</td>
      <td style={tdStyle}><StatusBadge status={req.status || 'Active'} /></td>
      <td style={tdStyle}>{fmtDate(req.createdAt)}</td>
      <td style={tdStyle}>
      {req.jdFileData ? (
  <button
    onClick={openJD}
    style={{
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: 4,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      fill="none"
      stroke="#6b7280"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  </button>
) : 'N/A'}
      </td>
      <td style={tdStyle}><ActionsMenu req={req} onEdit={onEdit} /></td>
    </tr>
  );
}

/* ─────────────────────────────────────────────
   Main Page
───────────────────────────────────────────── */
export default function RequirementsPage() {
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Requirement | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const [statusFilter, setStatusFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [expFilter, setExpFilter] = useState('');
  const [noticeFilter, setNoticeFilter] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  useEffect(() => {
    const unsub = onSnapshot(
  query(
    collection(db, 'requirements'),
    orderBy('createdAt', 'desc') // ✅ latest first
  ),
      snap => {
        setRequirements(snap.docs.map(d => ({ id: d.id, ...d.data() } as Requirement)));
        setLoading(false);
      },
      err => { console.error('Firestore error:', err); setLoading(false); }
    );
    return () => unsub();
  }, []);

  const hasFilter = !!(statusFilter || roleFilter || expFilter || noticeFilter);
  const clearFilters = () => { setStatusFilter(''); setRoleFilter(''); setExpFilter(''); setNoticeFilter(''); };

  const openNew = () => { setEditTarget(null); setModalOpen(true); };
  const openEdit = (r: Requirement) => { setEditTarget(r); setModalOpen(true); };
  const closeModal = () => { setModalOpen(false); setEditTarget(null); };

  const uniqueRoles = [...new Set(requirements.map(r => r.jobRole).filter(Boolean))];
  const uniqueExp = [...new Set(requirements.map(r => r.experience).filter(Boolean))];

  const filtered = requirements.filter(r =>
    (!statusFilter || r.status === statusFilter) &&
    (!roleFilter || r.jobRole === roleFilter) &&
    (!expFilter || r.experience === expFilter) &&
    (!noticeFilter || r.noticePeriod === noticeFilter)
  );
  const total = filtered.length;

  const paginatedData = filtered.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage
  );
  return (
    <div style={{ padding: '32px 40px', fontFamily: 'Inter, system-ui, sans-serif', minHeight: '100vh', background: '#f8f9fc' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: '#111827', margin: 0 }}>Requirements</h1>
          <p style={{ color: '#6b7280', fontSize: 14, marginTop: 4 }}>View and manage your job requirements.</p>
        </div>
        <button onClick={openNew} style={primaryBtn}>
          <span style={{ fontSize: 18, marginRight: 6 }}>+</span> New Requirement
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <FilterSelect label="All Statuses" value={statusFilter} onChange={setStatusFilter} options={['Active', 'Closed']} />
        <FilterSelect label="All Roles" value={roleFilter} onChange={setRoleFilter} options={uniqueRoles} />
        <FilterSelect label="All Experience" value={expFilter} onChange={setExpFilter} options={uniqueExp} />
        <FilterSelect label="All Notice Periods" value={noticeFilter} onChange={setNoticeFilter} options={NOTICE_PERIOD_OPTIONS} />

        {hasFilter && (
          <button onClick={clearFilters} style={{
            background: 'none', border: '1.5px solid #e5e7eb', borderRadius: 8,
            padding: '8px 14px', fontSize: 13, color: '#6b7280', cursor: 'pointer',
            fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6,
          }}>
            ✕ Clear Filters
          </button>
        )}
      </div>

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e5e7eb', overflow: 'visible', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
        {loading ? (
          <div style={{ padding: 60, textAlign: 'center', color: '#9ca3af' }}>
            <div style={{
              width: 28, height: 28, border: '3px solid #e5e7eb', borderTopColor: '#6366f1',
              borderRadius: '50%', animation: 'spin 0.7s linear infinite', margin: '0 auto 12px',
            }} />
            Loading requirements…
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#fafafa', borderBottom: '1px solid #f0f0f0' }}>
                {['PROJECT NAME', 'JOB ROLE', 'EXPERIENCE', 'NOTICE PERIOD', 'STATUS', 'CREATED DATE', 'JD', 'ACTIONS'].map(h => (
                  <th key={h} style={{
                    padding: '13px 20px', textAlign: 'left',
                    fontSize: 11, fontWeight: 600, color: '#9ca3af', letterSpacing: '0.06em',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div style={{ padding: '60px 20px', textAlign: 'center' }}>
                      <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
                      <p style={{ color: '#6b7280', fontSize: 15, fontWeight: 500, margin: 0 }}>
                        {hasFilter ? 'No requirements match your filters.' : 'No requirements created yet.'}
                      </p>
                      {!hasFilter && (
                        <p style={{ color: '#9ca3af', fontSize: 13, marginTop: 6 }}>
                          Click <strong>+ New Requirement</strong> to get started.
                        </p>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedData.map((req, i) => (
                                    <TableRow key={req.id} req={req}  isLast={i === paginatedData.length - 1} onEdit={openEdit} />
                ))
              )}
            </tbody>
          </table>
        )}
       <div style={{
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'center',
  gap: 12,
  padding: '14px 20px'
}}>

  {/* Rows per page */}
  <span style={{ fontSize: 13 }}>Rows per page:</span>
  <select
    value={rowsPerPage}
    onChange={(e) => {
      setRowsPerPage(Number(e.target.value));
      setPage(0);
    }}
    style={{
      border: '1px solid #e5e7eb',
      borderRadius: 6,
      padding: '4px 8px'
    }}
  >
    {[5, 10, 20].map(n => (
      <option key={n} value={n}>{n}</option>
    ))}
  </select>

  {/* Range text */}
  <span style={{ fontSize: 13 }}>
    {total === 0 ? 0 : page * rowsPerPage + 1}–
    {Math.min((page + 1) * rowsPerPage, total)} of {total}
  </span>

  {/* Arrow buttons */}
  <div style={{ display: 'flex', gap: 6 }}>

    <button
      onClick={() => setPage(0)}
      disabled={page === 0}
      style={paginationBtn(page === 0)}
    >
      {'<<'}
    </button>

    <button
      onClick={() => setPage(prev => Math.max(prev - 1, 0))}
      disabled={page === 0}
      style={paginationBtn(page === 0)}
    >
      {'<'}
    </button>

    <button
      onClick={() =>
        setPage(prev =>
          (prev + 1) * rowsPerPage < total ? prev + 1 : prev
        )
      }
      disabled={(page + 1) * rowsPerPage >= total}
      style={paginationBtn((page + 1) * rowsPerPage >= total)}
    >
      {'>'}
    </button>

    <button
      onClick={() =>
        setPage(Math.floor((total - 1) / rowsPerPage))
      }
      disabled={(page + 1) * rowsPerPage >= total}
      style={paginationBtn((page + 1) * rowsPerPage >= total)}
    >
      {'>>'}
    </button>

  </div>
</div>
      </div>

      <RequirementModal 
      
  open={modalOpen} 
  onClose={closeModal} 
  editData={editTarget}
  onSuccess={() => setShowSuccess(true)}
  
/>
{showSuccess && (
  <div style={{
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  }}>
    <div style={{
      background: '#fff',
      padding: '30px 40px',
      borderRadius: 12,
      textAlign: 'center',
      boxShadow: '0 10px 30px rgba(0,0,0,0.2)'
    }}>
      
      <div style={{
        background: '#dcfce7',
        borderRadius: '50%',
        padding: 10,
        display: 'inline-block',
        marginBottom: 10
      }}>
        ✔
      </div>

      <h3 style={{ margin: 0 }}>Success</h3>
      <p style={{ color: '#6b7280' }}>
        Requirement saved successfully!
      </p>

      <button
        onClick={() => setShowSuccess(false)}
        style={{
          marginTop: 10,
          padding: '8px 16px',
          background: '#4f46e5',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer'
        }}
      >
        OK
      </button>

    </div>
  </div>
)}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Shared Styles
───────────────────────────────────────────── */
const labelText: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: '#6b7280',
  letterSpacing: '0.07em', textTransform: 'uppercase',
};

const inputStyle: React.CSSProperties = {
  padding: '10px 14px', border: '1.5px solid #e5e7eb', borderRadius: 10,
  fontSize: 14, outline: 'none', background: '#f9fafc', color: '#111827',
  width: '100%', boxSizing: 'border-box',
};

const primaryBtn: React.CSSProperties = {
  background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 10,
  padding: '10px 22px', fontWeight: 600, fontSize: 14, cursor: 'pointer',
  display: 'flex', alignItems: 'center', gap: 4,
  boxShadow: '0 2px 8px rgba(79,70,229,0.3)',
};

const cancelBtn: React.CSSProperties = {
  background: '#fff', color: '#374151', border: '1.5px solid #e5e7eb',
  borderRadius: 10, padding: '10px 22px', fontWeight: 600, fontSize: 14, cursor: 'pointer',
};

const filterSelectStyle: React.CSSProperties = {
  padding: '9px 32px 9px 14px', border: '1.5px solid #e5e7eb', borderRadius: 10,
  fontSize: 13, background: '#fff', color: '#374151', cursor: 'pointer',
  outline: 'none', minWidth: 150, appearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
};

const tdStyle: React.CSSProperties = {
  padding: '14px 20px', fontSize: 14, color: '#374151', verticalAlign: 'middle',
};

const paginationBtn = (disabled: boolean): React.CSSProperties => ({
  width: 32,
  height: 32,
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  background: disabled ? '#f3f4f6' : '#fff',
  color: disabled ? '#9ca3af' : '#374151',
  cursor: disabled ? 'not-allowed' : 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 14,
  fontWeight: 500,
});