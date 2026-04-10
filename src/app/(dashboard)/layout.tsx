'use client';

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { useAuth, Role } from "@/hooks/useAuth";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";

const roleAreaMap: Record<Exclude<Role, null>, string> = {
  admin:  "admin",
  agency: "agency",
  hr:     "hr",
  panel:  "panel",
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, role, firstLogin, status, loading } = useAuth();
  const { dismiss, toast } = useToast();
  const router   = useRouter();
  const pathname = usePathname();

  // ── KEY FIX ──────────────────────────────────────────────────────────────
  // Track the PREVIOUS pathname. When the user just completed /change-password
  // and lands on the dashboard, there's a brief window where useAuth still
  // holds firstLogin: true (onAuthStateChanged hasn't re-fired because only
  // Firestore changed, not the Auth user).
  //
  // We suppress the firstLogin redirect for ONE render cycle when the user
  // just navigated AWAY from /change-password — giving refreshUser() time
  // to propagate the updated value into context.
  const prevPathname    = useRef<string>(pathname);
  const justLeftChangePw = useRef<boolean>(false);

  useEffect(() => {
    // Detect the moment we navigate away from /change-password
    if (prevPathname.current === "/change-password" && pathname !== "/change-password") {
      justLeftChangePw.current = true;
      // Auto-clear the flag after a short grace period so normal guards resume
      const t = setTimeout(() => { justLeftChangePw.current = false; }, 3000);
      return () => clearTimeout(t);
    }
    prevPathname.current = pathname;
  }, [pathname]);
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (loading) return;

    if (!user) {
      router.push("/login");
      return;
    }

    // Deactivated account
    if (status === "Inactive") {
      signOut(auth).then(() => {
        toast({
          variant: "destructive",
          title: "Access Denied",
          description: "Your account has been deactivated. Please contact the administrator.",
        });
        router.replace("/login");
      });
      return;
    }

    // ── Mandatory first-login password change ──────────────────────────────
    // SKIP this redirect if the user JUST came from /change-password —
    // they already completed the flow; useAuth is momentarily stale.
    if (
      firstLogin === true &&
      !justLeftChangePw.current &&
      (role === "agency" || role === "hr" || role === "panel")
    ) {
      if (pathname !== "/change-password") {
        router.replace("/change-password");
      }
      return;
    }

    // Once firstLogin is false, make sure we're not stuck on change-password
    if (firstLogin === false && pathname === "/change-password") {
      router.replace(role ? `/${roleAreaMap[role]}/dashboard` : "/login");
      return;
    }

    // ── RBAC: redirect to correct area ────────────────────────────────────
    const currentArea  = pathname.split("/")[1];
    const sharedAreas  = ["candidates", "change-password"];
    const isHrOnAdminJR = role === "hr" && pathname.startsWith("/admin/job-requisitions");

    if (
      role &&
      !sharedAreas.includes(currentArea) &&
      currentArea !== roleAreaMap[role] &&
      !isHrOnAdminJR
    ) {
      router.replace(`/${roleAreaMap[role]}/dashboard`);
    }
  }, [user, role, firstLogin, status, loading, router, pathname, toast]);

  // Dismiss stale toasts on navigation
  useEffect(() => {
    if (!loading && user) dismiss();
  }, [pathname, loading, user, dismiss]);

  // Show spinner while loading or deactivated
  if (loading || !user || status === "Inactive") {
    return (
      <div className="h-screen w-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Prevent content flash for wrong-role pages
  const currentArea  = pathname.split("/")[1];
  const sharedAreas  = ["candidates", "change-password"];
  const isHrOnAdminJR = role === "hr" && pathname.startsWith("/admin/job-requisitions");

  if (
    role &&
    !sharedAreas.includes(currentArea) &&
    currentArea !== roleAreaMap[role] &&
    !isHrOnAdminJR
  ) {
    return null;
  }

  return (
    <DashboardLayout>
    {children}
  </DashboardLayout>
  );}