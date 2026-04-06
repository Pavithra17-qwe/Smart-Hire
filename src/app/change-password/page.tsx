"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { updatePassword } from "firebase/auth";
import { doc, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  Card, CardContent, CardHeader, CardTitle,
  CardDescription, CardFooter,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Lock, ShieldCheck, Eye, EyeOff } from "lucide-react";

const ROLE_ROUTES: Record<string, string> = {
  admin:  "/admin/dashboard",
  hr:     "/hr/dashboard",
  panel:  "/panel/dashboard",
  agency: "/agency/dashboard",
};

export default function ChangePasswordPage() {
  const { user, role, firstLogin, loading: authLoading, refreshUser } = useAuth();
  const isRedirecting = useRef(false);
  const [password,            setPassword]            = useState("");
  const [confirmPassword,     setConfirmPassword]     = useState("");
  const [showPassword,        setShowPassword]        = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading,           setIsLoading]           = useState(false);

  const { toast } = useToast();
  const router    = useRouter();

  // ── Redirect guard ───────────────────────────────────────────────────────
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace("/login"); return; }
    if (isRedirecting.current) return;
    if (firstLogin === false && role) {
      router.replace(ROLE_ROUTES[role] ?? "/dashboard");
    }
  }, [user, firstLogin, role, authLoading, router]);

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
// ... validation unchanged

setIsLoading(true);
try {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("No authenticated user found.");

  await updatePassword(currentUser, password);
  await updateDoc(doc(db, "users", currentUser.uid), { firstLogin: false });

  // ✅ Lock the guard BEFORE refreshUser triggers a re-render
  isRedirecting.current = true;

  await refreshUser();

  toast({ title: "Password Updated", description: "Redirecting to your dashboard…" });
  router.replace(ROLE_ROUTES[role ?? ""] ?? "/dashboard");

} catch (error: any) {
  // ... error handling unchanged

  // ✅ Release the lock if something went wrong
  isRedirecting.current = false;
} finally {
  setIsLoading(false);
}
};

  // ── States ───────────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user || firstLogin === false) return null;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md shadow-xl border-t-4 border-t-primary">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <ShieldCheck className="w-6 h-6 text-primary" />
          </div>
          <CardTitle className="text-2xl font-headline font-bold">Secure Your Account</CardTitle>
          <CardDescription>
            This is your first login. Please update your temporary password to a secure one to continue.
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleUpdatePassword}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="new-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Min 8 characters"
                  className="pl-10 pr-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                />
                <button type="button" onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm New Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="confirm-password"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Repeat new password"
                  className="pl-10 pr-10"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
                <button type="button" onClick={() => setShowConfirmPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </CardContent>

          <CardFooter>
            <Button type="submit" className="w-full h-11" disabled={isLoading}>
              {isLoading
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating Security...</>
                : "Update Password & Continue"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}