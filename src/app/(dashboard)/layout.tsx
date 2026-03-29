'use client';

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { useAuth, Role } from "@/hooks/use-auth";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";

const roleAreaMap: Record<Exclude<Role, null>, string> = {
  admin: "admin",
  agency: "agency",
  hr: "hr",
  panel: "panel",
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, role, firstLogin, status, loading } = useAuth();
  const { dismiss, toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.push("/login");
        return;
      }

      // Check if user has been deactivated
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

      // Mandatory Password Change Redirection
      if (firstLogin === true && (role === "agency" || role === "hr" || role === "panel")) {
        if (pathname !== "/change-password") {
          router.replace("/change-password");
        }
        return;
      }

      if (firstLogin === false && pathname === "/change-password") {
        router.replace(role ? `/${roleAreaMap[role]}/dashboard` : "/login");
        return;
      }

      // Role-Based Access Control (RBAC) Redirects
      const currentArea = pathname.split("/")[1];
      const sharedAreas = ["candidates", "change-password"];

      // Allow HR to access admin job requisitions
      const isHrOnAdminJobRequisitions = role === 'hr' && pathname.startsWith('/admin/job-requisitions');
      
      if (role && !sharedAreas.includes(currentArea) && currentArea !== roleAreaMap[role] && !isHrOnAdminJobRequisitions) {
        router.replace(`/${roleAreaMap[role]}/dashboard`);
      }
    }
  }, [user, role, firstLogin, status, loading, router, pathname, toast]);

  // Clear any existing toasts when navigating dashboard
  useEffect(() => {
    if (!loading && user) {
      dismiss();
    }
  }, [pathname, loading, user, dismiss]);

  if (loading || !user || status === "Inactive") {
    return (
      <div className="h-screen w-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Final check before rendering to prevent content flash
  const currentArea = pathname.split("/")[1];
  const sharedAreas = ["candidates", "change-password"];
  
  const isHrOnAdminJobRequisitions = role === 'hr' && pathname.startsWith('/admin/job-requisitions');
  
  if (role && !sharedAreas.includes(currentArea) && currentArea !== roleAreaMap[role] && !isHrOnAdminJobRequisitions) {
    return null;
  }

  return <DashboardLayout>{children}</DashboardLayout>;
}
