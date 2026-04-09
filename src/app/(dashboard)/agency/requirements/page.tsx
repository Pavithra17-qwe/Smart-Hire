'use client';

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { query, orderBy, where } from 'firebase/firestore';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface JobRequisition {
  id: string;
  projectName: string;
  locations: string[];
  roles: string[];
  status: string;
  createdDate?: any;
  createdByName?: string;
  createdByRole?: string;
  jdFileData?: string;
  jdFileName?: string;
  jdFileType?: string;
  assignedAgencies?: string[];
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */
function fmtDate(ts: any): string {
  if (!ts) return '—';
  try {
    const d = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
    return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
  } catch { return '—'; }
}

function openJDFile(jdFileData: string, jdFileName?: string) {
  if (!jdFileData) return;

  // Plain text JD (manually entered)
  if (!jdFileData.startsWith('data:') && !jdFileData.startsWith('https://')) {
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(
        `<pre style="font-family:sans-serif;padding:24px;white-space:pre-wrap;max-width:800px;margin:auto;">${jdFileData}</pre>`
      );
      win.document.title = jdFileName || 'Job Description';
    }
    return;
  }

  if (jdFileData.startsWith('https://')) {
    window.open(jdFileData, '_blank', 'noopener,noreferrer');
    return;
  }

  try {
    const [meta, base64] = jdFileData.split(',');
    if (!base64) throw new Error('Invalid base64');
    const mimeMatch = meta.match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'application/pdf';
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const blob  = new Blob([bytes], { type: mime });
    const url   = URL.createObjectURL(blob);
    const win   = window.open(url, '_blank', 'noopener,noreferrer');
    if (!win) {
      const a = Object.assign(document.createElement('a'), {
        href: url, target: '_blank', download: jdFileName || 'JD.pdf',
      });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  } catch (err) {
    console.error('openJDFile error:', err);
    alert('Failed to open file. Please try again.');
  }
}

/* ─── Sub-components ──────────────────────────────────────────────────────── */
function StatusBadge({ status }: { status: string }) {
  const active = status === 'Active';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '3px 12px',
      borderRadius: 9999, fontSize: 12, fontWeight: 600,
      background: active ? '#dcfce7' : '#fee2e2',
      color: active ? '#15803d' : '#b91c1c',
      border: `1px solid ${active ? '#bbf7d0' : '#fecaca'}`,
    }}>{status}</span>
  );
}

function EyeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" fill="none"
      stroke="#6366f1" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

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

function TableRow({ req, isLast }: { req: JobRequisition; isLast: boolean }) {
  const [hov, setHov] = useState(false);
  const hasJD = !!(req.jdFileData && req.jdFileData.length > 5);

  return (
    <tr
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        borderBottom: isLast ? 'none' : '1px solid #f3f4f6',
        background: hov ? '#fafbff' : '#fff',
        transition: 'background 0.15s',
      }}
    >
      <td style={tdStyle}>
        <span style={{ fontWeight: 600, color: '#111827' }}>{req.projectName || '—'}</span>
      </td>
      <td style={tdStyle}>{req.locations?.join(', ') || '—'}</td>
      <td style={tdStyle}>{req.roles?.join(', ') || '—'}</td>
      <td style={tdStyle}><StatusBadge status={req.status || 'Active'} /></td>
      <td style={tdStyle}>
        {hasJD ? (
          <button
            onClick={() => openJDFile(req.jdFileData!, req.jdFileName)}
            title={req.jdFileName || 'View JD'}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 4,
              display: 'flex', alignItems: 'center', gap: 6,
              color: '#6366f1', fontSize: 13, fontWeight: 500,
            }}
          >
            <EyeIcon />
            <span style={{
              maxWidth: 90, overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {req.jdFileName || 'View'}
            </span>
          </button>
        ) : (
          <span style={{ color: '#d1d5db', fontSize: 12 }}>No file</span>
        )}
      </td>
      <td style={tdStyle}>{fmtDate(req.createdDate)}</td>
      <td style={tdStyle}>{req.createdByName || req.createdByRole || '—'}</td>
    </tr>
  );
}

/* ─── Main Page ───────────────────────────────────────────────────────────── */
export default function RequirementsPage() {
  const { user, role } = useAuth();
  const searchParams   = useSearchParams();

  const [requisitions,  setRequisitions]  = useState<JobRequisition[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [projectFilter, setProjectFilter] = useState('');
  const [statusFilter,  setStatusFilter]  = useState('');
  const [roleFilter,    setRoleFilter]    = useState('');
  const [page,          setPage]          = useState(0);
  const [rowsPerPage,   setRowsPerPage]   = useState(10);

  // Pre-fill project filter from URL ?projectName=...
  useEffect(() => {
    const pn = searchParams.get('projectName');
    if (pn) setProjectFilter(decodeURIComponent(pn));
  }, [searchParams]);

  // ── Firestore listener ────────────────────────────────────────────────────
  // Agency  → only projects where assignedAgencies contains their UID
  // Admin/HR → all projects
  useEffect(() => {
    if (!user || !role) return;
    setLoading(true);

    const q = role === 'agency'
      ? query(
          collection(db, 'job_requisitions'),
          where('assignedAgencies', 'array-contains', user.uid),
          orderBy('createdDate', 'desc')
        )
      : query(collection(db, 'job_requisitions'), orderBy('createdDate', 'desc'));

    const unsub = onSnapshot(
      q,
      snap => {
        setRequisitions(snap.docs.map(d => ({ id: d.id, ...d.data() } as JobRequisition)));
        setLoading(false);
      },
      err => { console.error('requirements listener:', err); setLoading(false); }
    );
    return () => unsub();
  }, [user, role]);

  // ── Filter options derived from fetched data ──────────────────────────────
  const projectOptions = [...new Set(requisitions.map(r => r.projectName).filter(Boolean))];
  const roleOptions    = [...new Set(requisitions.flatMap(r => r.roles ?? []).filter(Boolean))];

  const hasFilter = !!(projectFilter || statusFilter || roleFilter);
  const clearFilters = () => { setProjectFilter(''); setStatusFilter(''); setRoleFilter(''); setPage(0); };

  const filtered = requisitions.filter(r =>
    (!projectFilter || r.projectName        === projectFilter) &&
    (!statusFilter  || r.status             === statusFilter) &&
    (!roleFilter    || r.roles?.includes(roleFilter))
  );

  const total     = filtered.length;
  const paginated = filtered.slice(page * rowsPerPage, (page + 1) * rowsPerPage);

  return (
    <div style={{
      padding: '32px 40px', fontFamily: 'Inter, system-ui, sans-serif',
      minHeight: '100vh', background: '#f8f9fc',
    }}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: '#111827', margin: 0 }}>Requirements</h1>
        <p style={{ color: '#6b7280', fontSize: 14, marginTop: 4 }}>
          {role === 'agency'
            ? 'Projects assigned to you by Admin / HR — read only.'
            : 'All client project requirements.'}
        </p>
      </div>

      {/* ── Agency info banner ────────────────────────────────────────────── */}
      {role === 'agency' && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '9px 16px', background: '#EEF2FF',
          border: '1px solid #C7D2FE', borderRadius: 10,
          marginBottom: 20, fontSize: 13, color: '#4338CA',
        }}>
          <span>📋</span>
          <span>
            You have <strong>{requisitions.length}</strong> assigned
            project{requisitions.length !== 1 ? 's' : ''}.
            Projects are managed by Admin / HR.
          </span>
        </div>
      )}

      {/* ── URL project filter banner ─────────────────────────────────────── */}
      {projectFilter && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
          background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 10,
          marginBottom: 16, fontSize: 13, color: '#4338CA',
        }}>
          <span>🔍 Showing: <strong>{projectFilter}</strong></span>
          <button onClick={() => setProjectFilter('')} style={{
            marginLeft: 'auto', background: 'none', border: 'none',
            cursor: 'pointer', color: '#6366F1', fontWeight: 600, fontSize: 13,
          }}>✕ Clear</button>
        </div>
      )}

      {/* ── Filters ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <FilterSelect
          label="All Projects"
          value={projectFilter}
          onChange={v => { setProjectFilter(v); setPage(0); }}
          options={projectOptions}
        />
        <FilterSelect
          label="All Roles"
          value={roleFilter}
          onChange={v => { setRoleFilter(v); setPage(0); }}
          options={roleOptions}
        />
        <FilterSelect
          label="All Statuses"
          value={statusFilter}
          onChange={v => { setStatusFilter(v); setPage(0); }}
          options={['Active', 'Inactive']}
        />
        {hasFilter && (
          <button onClick={clearFilters} style={{
            background: 'none', border: '1.5px solid #e5e7eb', borderRadius: 8,
            padding: '8px 14px', fontSize: 13, color: '#6b7280', cursor: 'pointer',
            fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6,
          }}>✕ Clear Filters</button>
        )}
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <div style={{
        background: '#fff', borderRadius: 14, border: '1px solid #e5e7eb',
        overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
      }}>
        {loading ? (
          <div style={{ padding: 60, textAlign: 'center', color: '#9ca3af' }}>
            <div style={{
              width: 28, height: 28, border: '3px solid #e5e7eb',
              borderTopColor: '#6366f1', borderRadius: '50%',
              animation: 'spin 0.7s linear infinite', margin: '0 auto 12px',
            }} />
            Loading requirements…
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#fafafa', borderBottom: '1px solid #f0f0f0' }}>
                {['PROJECT NAME', 'LOCATION', 'ROLE / DESIGNATION', 'STATUS', 'JD', 'CREATED DATE', 'CREATED BY'].map(h => (
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
                  <td colSpan={7}>
                    <div style={{ padding: '60px 20px', textAlign: 'center' }}>
                      <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
                      <p style={{ color: '#6b7280', fontSize: 15, fontWeight: 500, margin: 0 }}>
                        {hasFilter
                          ? 'No requirements match your filters.'
                          : role === 'agency'
                            ? 'No projects have been assigned to you yet.'
                            : 'No requirements found.'}
                      </p>
                      {role === 'agency' && !hasFilter && (
                        <p style={{ color: '#9ca3af', fontSize: 13, marginTop: 6 }}>
                          Contact your Admin or HR to get projects assigned to you.
                        </p>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                paginated.map((req, i) => (
                  <TableRow
                    key={req.id}
                    req={req}
                    isLast={i === paginated.length - 1}
                  />
                ))
              )}
            </tbody>
          </table>
        )}

        {/* ── Pagination ────────────────────────────────────────────────── */}
        {filtered.length > 0 && (
          <div style={{
            display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
            gap: 12, padding: '14px 20px', borderTop: '1px solid #f3f4f6',
          }}>
            <span style={{ fontSize: 13, color: '#6b7280' }}>Rows per page:</span>
            <select
              value={rowsPerPage}
              onChange={e => { setRowsPerPage(Number(e.target.value)); setPage(0); }}
              style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 8px', fontSize: 13 }}
            >
              {[5, 10, 20].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <span style={{ fontSize: 13, color: '#6b7280' }}>
              {page * rowsPerPage + 1}–{Math.min((page + 1) * rowsPerPage, total)} of {total}
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              {[
                { label: '<<', action: () => setPage(0),                                               disabled: page === 0 },
                { label: '<',  action: () => setPage(p => Math.max(p - 1, 0)),                         disabled: page === 0 },
                { label: '>',  action: () => setPage(p => (p + 1) * rowsPerPage < total ? p + 1 : p),  disabled: (page + 1) * rowsPerPage >= total },
                { label: '>>', action: () => setPage(Math.floor((total - 1) / rowsPerPage)),            disabled: (page + 1) * rowsPerPage >= total },
              ].map(btn => (
                <button
                  key={btn.label}
                  onClick={btn.action}
                  disabled={btn.disabled}
                  style={paginationBtn(btn.disabled)}
                >{btn.label}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ─── Styles ──────────────────────────────────────────────────────────────── */
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
  width: 32, height: 32, border: '1px solid #e5e7eb', borderRadius: 8,
  background: disabled ? '#f3f4f6' : '#fff', color: disabled ? '#9ca3af' : '#374151',
  cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex',
  alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 500,
});