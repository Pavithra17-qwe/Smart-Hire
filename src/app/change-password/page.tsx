"use client";

import { useState, useEffect } from "react";
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
    if (firstLogin === false && role) {
      router.replace(ROLE_ROUTES[role] ?? "/dashboard");
    }
  }, [user, firstLogin, role, authLoading, router]);

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 8) {
      toast({ variant: "destructive", title: "Weak Password", description: "Password must be at least 8 characters long." });
      return;
    }
    if (password !== confirmPassword) {
      toast({ variant: "destructive", title: "Password Mismatch", description: "Passwords do not match." });
      return;
    }

    setIsLoading(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error("No authenticated user found.");

      // 1. Update Firebase Auth password
      await updatePassword(currentUser, password);

      // 2. Clear firstLogin flag in Firestore
      await updateDoc(doc(db, "users", currentUser.uid), { firstLogin: false });

      // 3. ── THE FIX ──────────────────────────────────────────────────────
      //    Re-fetch the Firestore doc directly into useAuth context.
      //    onAuthStateChanged never re-fires on a Firestore write, so without
      //    this call useAuth keeps serving firstLogin: true forever and the
      //    dashboard guard bounces the user right back here.
      await refreshUser();
      // ────────────────────────────────────────────────────────────────────

      toast({ title: "Password Updated", description: "Redirecting to your dashboard…" });

      // 4. Navigate — useEffect guard will also fire now that firstLogin is
      //    false in context, but pushing directly here is faster.
      router.replace(ROLE_ROUTES[role ?? ""] ?? "/dashboard");

    } catch (error: any) {
      console.error("Password update error:", error);
      let msg = "Failed to update password. Please try again.";
      if (error.code === "auth/requires-recent-login") {
        msg = "For security, please log out and log back in before changing your password.";
      } else if (error.message) {
        msg = error.message;
      }
      toast({ variant: "destructive", title: "Update Failed", description: msg });
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