'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

export type Role = 'admin' | 'agency' | 'hr' | 'panel' | null;

interface AuthContextType {
  user: User | null;
  role: Role;
  name: string | null;
  firstLogin: boolean | null;
  status: string | null;
  loading: boolean;
  agencyId?: string | null;
  // ── NEW: call this after any Firestore user-doc update to sync local state ──
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ── Shared helper: fetch Firestore user doc and return the parsed fields ──
async function fetchUserData(uid: string) {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return null;
  const d = snap.data();
  return {
    role:       (d.role as Role) ?? null,
    name:       d.name           ?? null,
    firstLogin: d.firstLogin     ?? false,   // undefined → false
    status:     d.status         ?? 'Active',
    agencyId:   d.role === 'agency' ? uid : (d.agencyId ?? null),
  };
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user,       setUser]       = useState<User | null>(null);
  const [role,       setRole]       = useState<Role>(null);
  const [name,       setName]       = useState<string | null>(null);
  const [firstLogin, setFirstLogin] = useState<boolean | null>(null);
  const [status,     setStatus]     = useState<string | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [agencyId,   setAgencyId]   = useState<string | null>(null);

  // ── Apply a fetched data snapshot to all state slices ──
  const applyUserData = useCallback(
    (data: Awaited<ReturnType<typeof fetchUserData>>, currentUser: User) => {
      if (data) {
        setRole(data.role);
        setName(data.name ?? currentUser.displayName);
        setFirstLogin(data.firstLogin);
        setStatus(data.status);
        setAgencyId(data.agencyId);
      } else {
        // Doc doesn't exist — reset role-related fields only
        setRole(null);
        setName(currentUser.displayName);
        setFirstLogin(null);
        setStatus(null);
        setAgencyId(null);
      }
      setUser(currentUser);
    },
    []
  );

  // ── Auth state listener (fires on login / logout only) ──
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        const data = await fetchUserData(currentUser.uid);
        applyUserData(data, currentUser);
      } else {
        // Logged out — reset everything
        setUser(null);
        setRole(null);
        setName(null);
        setFirstLogin(null);
        setStatus(null);
        setAgencyId(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [applyUserData]);

  // ── NEW: manually re-fetch the Firestore doc and sync state ──
  // Call this immediately after any updateDoc() on the user's record
  // so components see the new values without waiting for a re-login.
  const refreshUser = useCallback(async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    const data = await fetchUserData(currentUser.uid);
    applyUserData(data, currentUser);
  }, [applyUserData]);

  return (
    <AuthContext.Provider
      value={{ user, role, name, firstLogin, status, loading, agencyId, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};