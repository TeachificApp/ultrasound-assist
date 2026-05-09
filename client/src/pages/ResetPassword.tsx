/**
 * ResetPassword.tsx — Set a new password after clicking the reset link
 * URL: /reset-password?token=xxx
 */
import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Loader2, Heart, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const LOGO = import.meta.env.VITE_APP_LOGO as string;

export default function ResetPassword() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [done, setDone] = useState(false);

  const resetMutation = trpc.auth.resetPassword.useMutation({
    onSuccess: () => {
      setDone(true);
      setTimeout(() => { window.location.href = "/login"; }, 3000);
    },
    onError: (err) => {
      toast.error(err.message || "Password reset failed");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (!token) {
      toast.error("Invalid reset link. Please request a new one.");
      return;
    }
    resetMutation.mutate({ token, newPassword: password });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white p-6">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-10">
          <img src={LOGO || "https://pub-1f4b81c70d1f49cb8817cc2abbb92288.r2.dev/aaus_logo_ring_01cc7ccd.webp"} alt="All About Ultrasound™" className="w-10 h-10 object-contain" />
          <div className="text-xl font-black" style={{ fontFamily: "Merriweather, serif", color: "#0e1e2e" }}>All About Ultrasound™</div>
        </div>

        {done ? (
          <div className="text-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6" style={{ background: "#f0fbfc" }}>
              <CheckCircle2 className="w-8 h-8" style={{ color: "#189aa1" }} />
            </div>
            <h2 className="text-2xl font-black mb-3" style={{ fontFamily: "Merriweather, serif", color: "#0e1e2e" }}>Password updated!</h2>
            <p className="text-gray-500 text-sm mb-6">Your password has been changed. Redirecting you to sign in…</p>
            <Link href="/login">
              <Button className="w-full font-semibold text-white" style={{ background: "#189aa1" }}>Sign In</Button>
            </Link>
          </div>
        ) : (
          <>
            <h2 className="text-2xl font-black mb-2" style={{ fontFamily: "Merriweather, serif", color: "#0e1e2e" }}>Set new password</h2>
            <p className="text-sm text-gray-500 mb-8">Choose a strong password for your All About Ultrasound™ account.</p>

            {!token && (
              <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                This reset link is invalid or has expired. Please{" "}
                <Link href="/forgot-password" className="underline font-medium">request a new one</Link>.
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-sm font-medium text-gray-700">New password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    className="h-11 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirmPassword" className="text-sm font-medium text-gray-700">Confirm new password</Label>
                <Input
                  id="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Repeat your new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="h-11"
                />
              </div>

              <Button
                type="submit"
                disabled={resetMutation.isPending || !password || !confirmPassword || !token}
                className="w-full h-11 font-semibold text-white"
                style={{ background: "linear-gradient(135deg, #189aa1 0%, #0e7a80 100%)" }}
              >
                {resetMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Updating password…</>
                ) : "Update Password"}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <Link href="/login" className="text-sm hover:underline" style={{ color: "#189aa1" }}>Back to Sign In</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
