"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { Skeleton } from "@/components/ui/skeleton";

export default function Home() {
  const { user, role, firstLogin, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (user) {
        // Handle mandatory first login password change
        if (firstLogin === true && (role === "agency" || role === "hr" || role === "panel")) {
          router.replace("/change-password");
          return;
        }

        if (role === "admin") {
          router.replace("/admin/dashboard");
        } else if (role === "agency") {
          router.replace("/agency/dashboard");
        } else if (role === "hr") {
          router.replace("/hr/dashboard");
        } else if (role === "panel") {
          router.replace("/panel/dashboard");
        } else {
          router.replace("/login");
        }
      } else {
        router.replace("/login");
      }
    }
  }, [user, role, firstLogin, loading, router]);

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background p-8">
      <div className="space-y-4 w-full max-w-md">
        <Skeleton className="h-12 w-3/4 mx-auto" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
