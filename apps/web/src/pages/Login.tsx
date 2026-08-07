import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Lock, Mail, AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { browserLocalPersistence, browserSessionPersistence, setPersistence, signInWithEmailAndPassword } from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import { auth } from '../lib/firebase';
import { useAuth } from '../auth/auth-context';
import zamamLogo from '../assets/ZAMAM/2-optimized.webp';
import zamamIcon from '../assets/ZAMAM/1T-optimized.webp';

export const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const { refreshSession } = useAuth();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
      await signInWithEmailAndPassword(auth, email, password);
      // Resolve the session (reads sessionViews/{uid}) and let AuthProvider's state settle *before*
      // navigating — otherwise ProtectedRoute reads the still-stale 'anonymous' status from before this
      // sign-in and bounces straight back to /login, which reads as the page silently reprompting.
      await refreshSession();
      const requestedPath = typeof location.state === 'object' && location.state && 'from' in location.state
        ? String(location.state.from)
        : '/workspace';
      navigate(requestedPath, { replace: true });
    } catch (err: unknown) {
      const errorCode = err instanceof FirebaseError ? err.code : 'unknown';
      console.error('Login error:', errorCode);
      if (errorCode === 'auth/user-not-found' || errorCode === 'auth/wrong-password' || errorCode === 'auth/invalid-credential') {
        setError('البريد الإلكتروني أو كلمة المرور غير صحيحة');
      } else if (errorCode === 'auth/too-many-requests') {
        setError('تم تجاوز عدد المحاولات المسموحة. حاول مرة أخرى لاحقاً');
      } else {
        setError('حدث خطأ أثناء تسجيل الدخول. تأكد من الاتصال بالإنترنت');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen min-h-[100dvh] flex items-center justify-center bg-canvas p-3 sm:p-6 md:p-12">
      <div className="w-full max-w-6xl lg:h-[85vh] lg:min-h-[650px] flex flex-col lg:flex-row-reverse rounded-lg overflow-hidden border border-border-subtle bg-surface shadow-float">

        {/* Mobile Header */}
        <div className="lg:hidden bg-sidebar border-b border-border-subtle p-8 text-center">
          <div className="flex items-center gap-4 justify-center mb-5">
            <div className="bg-surface p-3 rounded-lg border border-border-subtle">
              <img src={zamamIcon} alt="ZAMAM Icon" className="h-12 w-auto object-contain" />
            </div>
          </div>
          <h1 className="text-h1 font-extrabold text-text-primary mb-2">زمام | ZAMAM</h1>
          <p className="text-body text-text-secondary font-semibold italic">"حيث يلتقي النظام بالإبداع"</p>
        </div>

        {/* Desktop Branding */}
        <div className="hidden lg:flex w-[42%] bg-sidebar p-16 flex-col justify-between border-l border-border-subtle relative overflow-hidden">
          <div aria-hidden="true" className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-brand-subtle blur-3xl opacity-60" />
          <div className="flex-1 flex items-center justify-center relative z-10">
            <img src={zamamLogo} alt="ZAMAM Logo" className="w-72 h-72 object-contain" />
          </div>

          <div className="relative z-10 text-text-tertiary text-caption text-center font-semibold">
            <p>نظام زمام | ZAMAM System © 2026</p>
          </div>
        </div>

        {/* Login Form */}
        <div className="w-full lg:w-[58%] flex flex-col justify-center p-6 sm:p-10 lg:p-20 bg-surface relative">
          <div className="max-w-md w-full mx-auto">
            <div className="mb-8 lg:mb-10 text-center lg:text-right">
              <h2 className="text-display font-extrabold text-text-primary mb-2">مرحباً بك مجدداً</h2>
              <p className="text-body text-text-secondary">سجل دخولك الآن لمتابعة أعمالك</p>
            </div>

            {/* Error Message */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                role="alert"
                className="bg-danger-subtle border border-danger/30 text-danger px-4 py-3.5 rounded-md mb-6 flex items-center gap-3 flex-row-reverse"
              >
                <AlertCircle className="w-5 h-5 shrink-0" aria-hidden="true" />
                <p className="text-body font-semibold">{error}</p>
              </motion.div>
            )}

            <form onSubmit={handleLogin} className="space-y-5 lg:space-y-6">
              <div className="space-y-2">
                <label htmlFor="login-email" className="text-label font-semibold text-text-secondary block text-right mr-1">البريد الإلكتروني</label>
                <div className="relative group">
                  <Mail className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-tertiary group-focus-within:text-brand-400 transition-colors pointer-events-none" aria-hidden="true" />
                  <input
                    id="login-email" type="email" required dir="ltr"
                    className="w-full pr-12 pl-4 py-3.5 bg-canvas border border-border-strong focus:border-brand-400 rounded-md transition-colors text-text-primary text-right text-body placeholder:text-text-tertiary"
                    placeholder="email@example.com"
                    value={email} onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="login-password" className="text-label font-semibold text-text-secondary block text-right mr-1">كلمة المرور</label>
                <div className="relative group">
                  <Lock className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-tertiary group-focus-within:text-brand-400 transition-colors pointer-events-none" aria-hidden="true" />
                  <input
                    id="login-password" type={showPassword ? "text" : "password"} required
                    className="w-full pr-12 pl-12 py-3.5 bg-canvas border border-border-strong focus:border-brand-400 rounded-md transition-colors text-text-primary text-right text-body placeholder:text-text-tertiary"
                    placeholder="••••••••"
                    value={password} onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 rounded-sm p-1 text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" aria-hidden="true" /> : <Eye className="w-5 h-5" aria-hidden="true" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-body">
                <Link to="/password-reset" className="text-brand-300 hover:text-brand-400 font-semibold transition-colors underline-offset-4 hover:underline">نسيت كلمة المرور؟</Link>
                <label className="flex items-center gap-2.5 cursor-pointer group">
                  <span className="text-text-secondary font-semibold group-hover:text-text-primary transition-colors">تذكرني</span>
                  <input
                    type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)}
                    className="w-4.5 h-4.5 size-[18px] rounded-sm border border-border-strong bg-canvas text-brand-500 accent-brand-500 cursor-pointer transition-all"
                  />
                </label>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3.5 bg-brand-500 hover:bg-brand-400 active:bg-brand-600 active:scale-[0.98] text-text-primary rounded-md font-bold text-body transition-all flex items-center justify-center gap-2.5 disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100 cursor-pointer mt-2"
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                ) : (
                  <>تسجيل الدخول <ArrowLeft className="w-5 h-5" aria-hidden="true" /></>
                )}
              </button>
            </form>

            {/* Mobile Footer */}
            <div className="lg:hidden text-center text-text-tertiary text-caption font-semibold mt-8">
              <p>نظام زمام | ZAMAM System © 2026</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
