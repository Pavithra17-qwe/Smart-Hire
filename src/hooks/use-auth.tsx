"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

export type Role = "admin" | "agency" | "hr" | "panel";

interface AuthContextType {
  user: User | null;
  role: Role | null;
  name?: string;
  loading: boolean;
  agencyId?: string;
  firstLogin?: boolean;
  status?: string;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  role: null,
  loading: true,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [name, setName] = useState<string | undefined>();
  const [agencyId, setAgencyId] = useState<string | undefined>();
  const [firstLogin, setFirstLogin] = useState<boolean | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribeUserDoc: (() => void) | undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        
        // Use onSnapshot to listen for real-time changes to the user profile (like status and firstLogin)
        unsubscribeUserDoc = onSnapshot(doc(db, "users", firebaseUser.uid), (docSnap) => {
          if (docSnap.exists()) {
            const userData = docSnap.data();
            setRole(userData.role);
            setAgencyId(userData.agencyId);
            setName(userData.name);
            setFirstLogin(userData.firstLogin ?? false);
            setStatus(userData.status || "Active");
          } else {
            setRole(null);
            setFirstLogin(false);
            setStatus("Active");
          }
          setLoading(false);
        }, (error) => {
          console.error("Error fetching user profile:", error);
          setLoading(false);
        });
      } else {
        setUser(null);
        setRole(null);
        setAgencyId(undefined);
        setName(undefined);
        setFirstLogin(undefined);
        setStatus(undefined);
        if (unsubscribeUserDoc) unsubscribeUserDoc();
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeUserDoc) unsubscribeUserDoc();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, role, name, loading, agencyId, firstLogin, status }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
