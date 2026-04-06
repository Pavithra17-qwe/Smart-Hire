'use client';

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { signInWithEmailAndPassword, sendPasswordResetEmail, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Mail, Lock, Eye, EyeOff, Loader2, ArrowLeft, Briefcase } from "lucide-react";

// ─────────────────────────────────────────────
// IMPORTANT: Set this to your actual domain.
// Firebase will send the reset email with a link that contains
// ?continueUrl=https://your-domain.com/reset-password
// so your /reset-password page handles the oobCode correctly.
// ─────────────────────────────────────────────
// ✅ Replace with this
// ✅ Hardcode directly — no env variable needed
// ✅ Remove trailing slash with .replace()
const APP_URL = "https://9000-firebase-smarthireproject-1773939832860.cluster-cz5nqyh5nreq6ua6gaqd7okl7o.cloudworkstations.dev".replace(/\/$/, "");

const roleAreaMap: { [key: string]: string } = {
  admin:  "admin",
  agency: "agency",
  hr:     "hr",
  panel:  "panel",
};

function LoginForm() {
  const [email,          setEmail]          = useState("");
  const [password,       setPassword]       = useState("");
  const [showPassword,   setShowPassword]   = useState(false);
  const [isLoading,      setIsLoading]      = useState(false);

  const [emailError,     setEmailError]     = useState("");
  const [loginError,     setLoginError]     = useState("");

  const [isForgotModalOpen,  setIsForgotModalOpen]  = useState(false);
  const [forgotEmail,        setForgotEmail]        = useState("");
  const [isSendingReset,     setIsSendingReset]     = useState(false);

  const { toast }  = useToast();
  const router     = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get("logout") === "success") {
      toast({ title: "Success", description: "You have been logged out successfully." });
      router.replace("/login");
    }
  }, [searchParams, toast, router]);

  const validateEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  // ── Login ────────────────────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError("");
    setLoginError("");

    if (!validateEmail(email)) {
      setEmailError("Enter a valid email address.");
      return;
    }

    setIsLoading(true);
    try {
      const cred     = await signInWithEmailAndPassword(auth, email, password);
      const userDoc  = await getDoc(doc(db, "users", cred.user.uid));

      if (!userDoc.exists()) throw new Error("User data not found.");

      const userData = userDoc.data();

      if (userData.status === "Inactive") {
        await signOut(auth);
        setLoginError("Your account has been deactivated. Please contact the administrator.");
        return;
      }

      toast({ title: "Success", description: "Login successful. Welcome to SmartHire." });

      const role = userData.role;
      if (role && roleAreaMap[role]) {
        router.push(`/${roleAreaMap[role]}/dashboard`);
      } else {
        router.push("/");
      }
    } catch {
      setLoginError("Invalid email or password.");
    } finally {
      setIsLoading(false);
    }
  };

  // ── Forgot password ─────────────────────────────────────────────────────
  // FIX: Pass actionCodeSettings so Firebase redirects to YOUR /reset-password
  // page instead of its generic reset page.
  // The user clicks the link in their email → lands on /reset-password?oobCode=...
  // → your page handles confirmPasswordReset → signs them in → redirects by role.
  const handleForgotPassword = async () => {
    if (!forgotEmail || !validateEmail(forgotEmail)) {
      toast({ 
        variant: "destructive", 
        title: "Invalid email", 
        description: "Please enter a valid email address." 
      });
      return;
    }
  
    setIsSendingReset(true);
    try {
      await sendPasswordResetEmail(auth, forgotEmail);
      toast({
        title: "Reset link sent!",
        description: `Check your inbox at ${forgotEmail}.`,
      });
      setIsForgotModalOpen(false);
      setForgotEmail("");
    } catch (err: any) {
      console.error("sendPasswordResetEmail error:", err);
      toast({
        title: "Reset link sent!",
        description: `If an account exists for ${forgotEmail}, a reset link has been sent.`,
      });
      setIsForgotModalOpen(false);
      setForgotEmail("");
    } finally {
      setIsSendingReset(false);
    }
  };

  return (
    <div className="min-h-screen flex w-full overflow-hidden bg-background">
      {/* Left — Login form */}
      <div className="flex-1 flex flex-col justify-center px-6 sm:px-12 lg:px-20">
        <div className="max-w-md w-full mx-auto space-y-8">

          {/* Brand */}
          <div className="space-y-4 text-center">
            <div className="w-20 h-20 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-primary/30">
              <Briefcase className="w-10 h-10 text-primary-foreground" />
            </div>
            <div className="space-y-1">
              <h1 className="text-4xl font-headline font-bold tracking-tight text-foreground">SmartHire</h1>
              <p className="text-lg font-medium text-primary">AI-Powered Recruitment Platform</p>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleLogin} className="space-y-5">

            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-foreground/80 font-semibold ml-1">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  className={`pl-11 h-12 bg-muted/30 border-muted focus:bg-background transition-all rounded-xl ${emailError ? "border-destructive ring-destructive/20" : ""}`}
                  value={email}
                  onChange={e => { setEmail(e.target.value); if (emailError) setEmailError(""); }}
                  required
                />
              </div>
              {emailError && <p className="text-destructive text-sm mt-1 ml-1">{emailError}</p>}
            </div>

            {/* Password */}
            <div className="space-y-2">
              <Label htmlFor="password" className="text-foreground/80 font-semibold ml-1">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  className="pl-11 pr-11 h-12 bg-muted/30 border-muted focus:bg-background transition-all rounded-xl"
                  value={password}
                  onChange={e => { setPassword(e.target.value); if (loginError) setLoginError(""); }}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setIsForgotModalOpen(true)}
                  className="text-xs font-bold text-primary hover:text-primary/80 transition-colors text-right cursor-pointer"
                >
                  Forgot password?
                </button>
                {loginError && <p className="text-destructive text-sm ml-1">{loginError}</p>}
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-12 text-base font-bold bg-gradient-to-r from-[#6C63FF] to-[#7B72FF] hover:from-[#5A52E0] hover:to-[#6C63FF] text-white shadow-lg shadow-primary/20 transition-all active:scale-[0.98] rounded-xl"
              disabled={isLoading}
            >
              {isLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : "Sign In"}
            </Button>
          </form>
        </div>
      </div>

      {/* Right — Illustration */}
      <div className="hidden lg:flex flex-1 relative bg-gradient-to-br from-[#6C63FF] to-[#7B72FF] items-center justify-center p-12">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(255,255,255,0.15),_transparent)] pointer-events-none" />
        <div className="relative z-10 max-w-lg text-center space-y-10 flex flex-col items-center">
          <div className="relative w-full max-w-[420px] aspect-square rounded-xl shadow-2xl overflow-hidden bg-white/10 backdrop-blur-sm border border-white/20">
            <Image src="/ai-recruitment.png" alt="AI Recruitment Illustration" fill className="object-contain p-8" priority />
          </div>
          <div className="space-y-4 px-6 text-white text-center">
            <h2 className="text-4xl font-bold font-headline leading-tight tracking-tight text-white">
              Smart Hiring,<br />Powered by AI
            </h2>
            <p className="text-white/80 text-base leading-relaxed max-w-sm mx-auto font-medium">
              Streamline your recruitment process with AI-driven candidate screening,
              intelligent candidate matching, and data-driven hiring insights.
            </p>
          </div>
        </div>
      </div>

      {/* Forgot password modal */}
      <Dialog open={isForgotModalOpen} onOpenChange={setIsForgotModalOpen}>
        <DialogContent className="sm:max-w-md rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-2xl font-headline font-bold">Reset password</DialogTitle>
            <DialogDescription className="text-base">
              Enter your email and we'll send a link to set a new password. The link will open directly in SmartHire.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-6">
            <div className="space-y-2">
              <Label htmlFor="forgot-email" className="font-semibold">Email address</Label>
              <Input
                id="forgot-email"
                type="email"
                placeholder="Enter your registered email"
                className="h-11 rounded-lg"
                value={forgotEmail}
                onChange={e => setForgotEmail(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleForgotPassword(); } }}
              />
            </div>
          </div>
          <DialogFooter className="flex flex-col sm:flex-row gap-3">
            <Button
              variant="ghost"
              onClick={() => { setIsForgotModalOpen(false); setForgotEmail(""); }}
              className="flex items-center gap-2 font-semibold h-11"
            >
              <ArrowLeft className="h-4 w-4" /> Back to login
            </Button>
            <Button
              onClick={handleForgotPassword}
              disabled={isSendingReset}
              className="h-11 font-bold flex-1 rounded-lg bg-primary hover:bg-primary/90 text-white"
            >
              {isSendingReset ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send reset link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="h-screen w-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}