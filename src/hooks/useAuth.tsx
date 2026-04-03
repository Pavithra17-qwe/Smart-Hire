'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [name, setName] = useState<string | null>(null);
  const [firstLogin, setFirstLogin] = useState<boolean | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [agencyId, setAgencyId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        const userDocRef = doc(db, 'users', currentUser.uid);
        const userDoc = await getDoc(userDocRef);
        if (userDoc.exists()) {
          const userData = userDoc.data();
          setRole(userData.role as Role);
          setName(userData.name || currentUser.displayName);
          setFirstLogin(userData.firstLogin || false);
          setStatus(userData.status || 'Active');
          
          // Correctly set agencyId for all roles
          if (userData.role === 'agency') {
            setAgencyId(currentUser.uid);
          } else if (userData.agencyId) {
            setAgencyId(userData.agencyId);
          } else {
            setAgencyId(null);
          }
        } else {
          // Reset state if user doc doesn't exist
          setName(currentUser.displayName);
          setRole(null);
          setFirstLogin(null);
          setStatus(null);
          setAgencyId(null);
        }
        setUser(currentUser);
      } else {
        // Reset all state on logout
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
  }, []);

  return (
    <AuthContext.Provider value={{ user, role, name, firstLogin, status, loading, agencyId }}>
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
