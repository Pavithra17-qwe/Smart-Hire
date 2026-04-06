'use client';

/**
 * /app/reset-password/page.tsx
 *
 * FIX SUMMARY:
 * - `setStep('success')` fires immediately after confirmPasswordReset succeeds,
 *   so the user is NEVER stuck on the form regardless of what happens after.
 * - signInWithEmailAndPassword + role lookup are wrapped in their own try/catch
 *   and run AFTER the success screen is shown — failures there still redirect.
 * - Firestore role lookup failure is caught gracefully; falls back to /dashboard.
 */

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  verifyPasswordResetCode,
  confirmPasswordReset,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { Button }    from '@/components/ui/button';
import { Input }     from '@/components/ui/input';
import { Label }     from '@/components/ui/label';
import { useToast }  from '@/hooks/use-toast';
import { Lock, Eye, EyeOff, Loader2, CheckCircle2, XCircle, Briefcase } from 'lucide-react';

const ROLE_ROUTES: Record<string, string> = {
  admin:  '/admin/dashboard',
  hr:     '/hr/dashboard',
  panel:  '/panel/dashboard',
  agency: '/agency/dashboard',
};

// ─────────────────────────────────────────────
// Inner component (needs useSearchParams)
// ─────────────────────────────────────────────
function ResetPasswordForm() {
  const router    = useRouter();
  const params    = useSearchParams();
  const { toast } = useToast();

  const oobCode = params.get('oobCode') || '';

  const [step, setStep]                   = useState<'verifying' | 'form' | 'success' | 'error'>('verifying');
  const [verifiedEmail, setVerifiedEmail] = useState('');
  const [errorMessage, setErrorMessage]   = useState('');

  const [newPassword,     setNewPassword]     = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew,         setShowNew]         = useState(false);
  const [showConfirm,     setShowConfirm]     = useState(false);
  const [isSubmitting,    setIsSubmitting]    = useState(false);
  const [fieldError,      setFieldError]      = useState('');

  // ── Step 1: Verify oobCode on mount ─────────────────────────────────────
  useEffect(() => {
    if (!oobCode) {
      setErrorMessage('No reset code found in the link. Please request a new password reset.');
      setStep('error');
      return;
    }

    verifyPasswordResetCode(auth, oobCode)
      .then(email => {
        setVerifiedEmail(email);
        setStep('form');
      })
      .catch(err => {
        console.error('verifyPasswordResetCode:', err);
        if (err.code === 'auth/expired-action-code') {
          setErrorMessage('This reset link has expired. Please request a new one.');
        } else if (err.code === 'auth/invalid-action-code') {
          setErrorMessage('This reset link is invalid or has already been used.');
        } else {
          setErrorMessage('Something went wrong verifying your reset link. Please try again.');
        }
        setStep('error');
      });
  }, [oobCode]);

  // ── Step 2: Submit new password ──────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError('');

    // ── Client-side validation ──
    if (newPassword.length < 6) {
      setFieldError('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setFieldError('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);

    try {
      // ── 2a: Apply the new password ──
      await confirmPasswordReset(auth, oobCode, newPassword);

      // ── KEY FIX: Show success screen IMMEDIATELY after reset succeeds.
      //    Everything below (sign-in, role lookup, redirect) runs after
      //    the user already sees the success state — so the form can
      //    NEVER stay stuck waiting for a secondary operation. ──
      setStep('success');

      // ── 2b: Sign in + resolve role in the background ──
      const destination = await (async () => {
        try {
          const credential = await signInWithEmailAndPassword(auth, verifiedEmail, newPassword);
          const uid = credential.user.uid;

          // Try users/{uid} first
          const userDoc = await getDoc(doc(db, 'users', uid));
          if (userDoc.exists()) {
            const role = userDoc.data().role;
            return ROLE_ROUTES[role] ?? '/dashboard';
          }

          // Fallback: query by email
          const snap = await getDocs(
            query(collection(db, 'users'), where('email', '==', verifiedEmail))
          );
          if (!snap.empty) {
            const role = snap.docs[0].data().role;
            return ROLE_ROUTES[role] ?? '/dashboard';
          }

          return '/dashboard';
        } catch (signInErr) {
          // Sign-in can fail if Firebase hasn't propagated the new password yet.
          // Log it and fall through — user can sign in manually from /login.
          console.error('Post-reset sign-in error (non-fatal):', signInErr);
          return '/login';
        }
      })();

      // ── 2c: Navigate after a short delay so the success UI is visible ──
      setTimeout(() => router.replace(destination), 1800);

    } catch (err: any) {
      // Only reached if confirmPasswordReset itself failed.
      console.error('confirmPasswordReset error:', err);
      let msg = 'Failed to reset password. Please try again.';
      if (err.code === 'auth/expired-action-code') {
        msg = 'This reset link has expired. Please request a new password reset.';
      } else if (err.code === 'auth/weak-password') {
        msg = 'Password is too weak. Please use at least 6 characters.';
      } else if (err.code === 'auth/invalid-action-code') {
        msg = 'This reset link is invalid or has already been used.';
      }
      setFieldError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-primary/30">
            <Briefcase className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">SmartHire</h1>
        </div>

        <div className="bg-card border rounded-2xl p-8 shadow-sm">

          {/* ── Verifying ── */}
          {step === 'verifying' && (
            <div className="flex flex-col items-center gap-4 py-6">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground text-sm">Verifying your reset link…</p>
            </div>
          )}

          {/* ── Error ── */}
          {step === 'error' && (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <div className="w-14 h-14 rounded-full bg-rose-50 flex items-center justify-center">
                <XCircle className="h-7 w-7 text-rose-500" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">Link invalid or expired</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">{errorMessage}</p>
              <Button
                className="mt-2 w-full rounded-xl"
                onClick={() => router.replace('/login')}
              >
                Back to login
              </Button>
            </div>
          )}

          {/* ── Password form ── */}
          {step === 'form' && (
            <>
              <div className="mb-6">
                <h2 className="text-xl font-bold text-foreground">Set new password</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Creating password for{' '}
                  <span className="font-medium text-foreground">{verifiedEmail}</span>
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">

                {/* New password */}
                <div className="space-y-2">
                  <Label htmlFor="new-password" className="font-semibold text-foreground/80">
                    New password
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="new-password"
                      type={showNew ? 'text' : 'password'}
                      placeholder="At least 6 characters"
                      className="pl-10 pr-10 h-11 rounded-xl bg-muted/30"
                      value={newPassword}
                      onChange={e => { setNewPassword(e.target.value); setFieldError(''); }}
                      required
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowNew(v => !v)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Confirm password */}
                <div className="space-y-2">
                  <Label htmlFor="confirm-password" className="font-semibold text-foreground/80">
                    Confirm password
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="confirm-password"
                      type={showConfirm ? 'text' : 'password'}
                      placeholder="Re-enter your password"
                      className="pl-10 pr-10 h-11 rounded-xl bg-muted/30"
                      value={confirmPassword}
                      onChange={e => { setConfirmPassword(e.target.value); setFieldError(''); }}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(v => !v)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Field error */}
                {fieldError && (
                  <p className="text-sm text-destructive">{fieldError}</p>
                )}

                {/* Submit */}
                <Button
                  type="submit"
                  className="w-full h-11 rounded-xl font-bold bg-gradient-to-r from-[#6C63FF] to-[#7B72FF] hover:from-[#5A52E0] hover:to-[#6C63FF] text-white shadow-md shadow-primary/20"
                  disabled={isSubmitting}
                >
                  {isSubmitting
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Setting password…</>
                    : 'Set new password & sign in'}
                </Button>

              </form>
            </>
          )}

          {/* ── Success ── */}
          {step === 'success' && (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center">
                <CheckCircle2 className="h-7 w-7 text-emerald-500" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">Password set successfully!</h2>
              <p className="text-sm text-muted-foreground">
                Signing you in and redirecting to your dashboard…
              </p>
              <Loader2 className="h-5 w-5 animate-spin text-primary mt-2" />
            </div>
          )}

        </div>

        {/* Back to login — shown on form step only */}
        {step === 'form' && (
          <p className="text-center text-sm text-muted-foreground mt-4">
            Remember your password?{' '}
            <button
              onClick={() => router.replace('/login')}
              className="text-primary font-semibold hover:underline"
            >
              Sign in
            </button>
          </p>
        )}

      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Page export (wrapped in Suspense for useSearchParams)
// ─────────────────────────────────────────────
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    }>
      <ResetPasswordForm />
    </Suspense>
  );
}