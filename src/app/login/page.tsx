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

const roleAreaMap: { [key: string]: string } = {
  admin: 'admin',
  agency: 'agency',
  hr: 'hr',
  panel: 'panel',
};

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  const [emailError, setEmailError] = useState("");
  const [loginError, setLoginError] = useState("");
  
  const [isForgotModalOpen, setIsForgotModalOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [isSendingReset, setIsLoadingSendingReset] = useState(false);

  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get("logout") === "success") {
      toast({
        title: "Success",
        description: "You have been logged out successfully.",
      });
      router.replace("/login");
    }
  }, [searchParams, toast, router]);

  const validateEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError("");
    setLoginError("");

    if (!validateEmail(email)) {
      setEmailError("Enter valid email");
      return;
    }

    setIsLoading(true);
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        if (userData.status === "Inactive") {
          await signOut(auth);
          setLoginError("Your account has been deactivated. Please contact the administrator.");
          setIsLoading(false);
          return;
        }

        toast({
          title: "Success",
          description: "Login successful. Welcome to SmartHire.",
        });

        const role = userData.role;
        if (role && roleAreaMap[role]) {
          router.push(`/${roleAreaMap[role]}/dashboard`);
        } else {
          router.push("/"); // Fallback to a default page
        }
      } else {
        throw new Error("User data not found.");
      }
    } catch (error: any) {
      setLoginError("Invalid email or password");
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!forgotEmail || !validateEmail(forgotEmail)) {
      toast({ variant: "destructive", title: "Invalid Email", description: "Please enter a valid email address." });
      return;
    }

    setIsLoadingSendingReset(true);
    try {
      await sendPasswordResetEmail(auth, forgotEmail);
      toast({ title: "Success!", description: `Instructions have been successfully sent to ${forgotEmail}` });
      setIsForgotModalOpen(false);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: "Something went wrong. Please try again." });
    } finally {
      setIsLoadingSendingReset(false);
    }
  };

  return (
    <div className="min-h-screen flex w-full overflow-hidden bg-background">
      <div className="flex-1 flex flex-col justify-center px-6 sm:px-12 lg:px-20">
        <div className="max-w-md w-full mx-auto space-y-8">
          <div className="space-y-4 text-center">
            <div className="w-20 h-20 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-primary/30">
              <Briefcase className="w-10 h-10 text-primary-foreground" />
            </div>
            <div className="space-y-1">
              <h1 className="text-4xl font-headline font-bold tracking-tight text-foreground">SmartHire</h1>
              <p className="text-lg font-medium text-primary">AI-Powered Recruitment Platform</p>
            </div>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-foreground/80 font-semibold ml-1">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  className={`pl-11 h-12 bg-muted/30 border-muted focus:bg-background transition-all rounded-xl ${emailError ? 'border-destructive ring-destructive/20' : ''}`}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (emailError) setEmailError("");
                  }}
                  required
                />
              </div>
              {emailError && <p className="text-destructive text-sm mt-1 ml-1">{emailError}</p>}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between ml-1">
                <Label htmlFor="password" title="Password" className="text-foreground/80 font-semibold">Password</Label>
              </div>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  className="pl-11 pr-11 h-12 bg-muted/30 border-muted focus:bg-background transition-all rounded-xl"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (loginError) setLoginError("");
                  }}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
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
                {loginError && <p className="text-destructive text-sm mt-1 ml-1">{loginError}</p>}
              </div>
            </div>

            <Button type="submit" className="w-full h-12 text-base font-bold bg-gradient-to-r from-[#6C63FF] to-[#7B72FF] hover:from-[#5A52E0] hover:to-[#6C63FF] text-white shadow-lg shadow-primary/20 transition-all active:scale-[0.98] rounded-xl" disabled={isLoading}>
              {isLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : "Sign In"}
            </Button>
          </form>
        </div>
      </div>

      <div className="hidden lg:flex flex-1 relative bg-gradient-to-br from-[#6C63FF] to-[#7B72FF] items-center justify-center p-12">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(255,255,255,0.15),_transparent)] pointer-events-none" />
        
        <div className="relative z-10 max-w-lg text-center space-y-10 flex flex-col items-center">
          <div className="relative w-full max-w-[420px] aspect-square rounded-xl shadow-2xl overflow-hidden bg-white/10 backdrop-blur-sm border border-white/20 animate-float">
            <Image
              src="/ai-recruitment.png"
              alt="AI Recruitment Illustration"
              fill
              className="object-contain p-8"
              priority
            />
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

      <Dialog open={isForgotModalOpen} onOpenChange={setIsForgotModalOpen}>
        <DialogContent className="sm:max-w-md rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-2xl font-headline font-bold">Reset Password</DialogTitle>
            <DialogDescription className="text-base">
              Enter your email address and we'll send you instructions to reset your password.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-6">
            <div className="space-y-2">
              <Label htmlFor="forgot-email" className="font-semibold">Email Address</Label>
              <Input
                id="forgot-email"
                type="email"
                placeholder="Enter your registered email"
                className="h-11 rounded-lg"
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="flex flex-col sm:flex-row gap-3">
            <Button
              variant="ghost"
              onClick={() => setIsForgotModalOpen(false)}
              className="flex items-center gap-2 font-semibold h-11"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Login
            </Button>
            <Button onClick={handleForgotPassword} disabled={isSendingReset} className="h-11 font-bold flex-1 rounded-lg bg-primary hover:bg-primary/90 text-white">
              {isSendingReset ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send Reset Link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="h-screen w-full flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}>
      <LoginForm />
    </Suspense>
  );
}
