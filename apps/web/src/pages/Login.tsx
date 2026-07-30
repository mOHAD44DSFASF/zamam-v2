import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Lock, Mail, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { browserLocalPersistence, browserSessionPersistence, setPersistence, signInWithEmailAndPassword } from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import { auth } from '../lib/firebase';
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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
      await signInWithEmailAndPassword(auth, email, password);
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
    <div className="min-h-screen min-h-[100dvh] flex items-center justify-center bg-zamam-light p-3 sm:p-6 md:p-12 font-['Cairo']">
      <div className="w-full max-w-6xl lg:h-[85vh] lg:min-h-[650px] flex flex-col lg:flex-row-reverse rounded-3xl lg:rounded-[2.5rem] overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.12)] bg-white">
        
        {/* Mobile Header */}
        <div className="lg:hidden bg-white border-b border-gray-100 p-8 text-center">
          <div className="flex items-center gap-4 justify-center mb-5">
            <div className="bg-zamam-light p-3 rounded-2xl border border-zamam-gray/50">
              <img src={zamamIcon} alt="ZAMAM Icon" className="h-12 w-auto object-contain" />
            </div>
          </div>
          <h1 className="text-2xl font-extrabold text-zamam-textDark mb-2">زمام | ZAMAM</h1>
          <p className="text-zamam-textGray text-base font-bold italic">"حيث يلتقي النظام بالإبداع"</p>
        </div>

        {/* Desktop Branding */}
        <div className="hidden lg:flex w-[45%] bg-white p-16 flex-col justify-between border-l border-gray-100">
          <div className="flex-1 flex items-center justify-center">
            <img src={zamamLogo} alt="ZAMAM Logo" className="w-80 h-80 object-contain" />
          </div>

          <div className="relative z-20 text-zamam-textGray text-sm text-center font-bold">
            <p>نظام زمام | ZAMAM System © 2026</p>
          </div>
        </div>

        {/* Login Form */}
        <div className="w-full lg:w-[55%] flex flex-col justify-center p-6 sm:p-10 lg:p-24 bg-white relative">
          <div className="max-w-md w-full mx-auto">
            <div className="mb-8 lg:mb-12 text-center lg:text-right">
              <h2 className="text-3xl lg:text-4xl font-black text-zamam-textDark mb-3">مرحباً بك مجدداً</h2>
              <p className="text-zamam-textGray text-base lg:text-lg">سجل دخولك الآن لمتابعة أعمالك</p>
            </div>

            {/* Error Message */}
            {error && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-red-50 border border-red-200 text-red-700 px-5 py-4 rounded-2xl mb-6 flex items-center gap-3 flex-row-reverse"
              >
                <AlertCircle className="w-5 h-5 shrink-0" />
                <p className="text-sm font-bold">{error}</p>
              </motion.div>
            )}

            <form onSubmit={handleLogin} className="space-y-5 lg:space-y-8">
              <div className="space-y-2">
                <label htmlFor="login-email" className="text-sm font-bold text-zamam-textDark block text-right mr-1">البريد الإلكتروني</label>
                <div className="relative group">
                  <Mail className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zamam-textGray group-focus-within:text-zamam-primary transition-colors" />
                  <input 
                    id="login-email" type="email" required
                    className="w-full pr-14 pl-6 py-3.5 lg:py-4 bg-zamam-light/50 border-2 border-transparent focus:border-zamam-primary/30 focus:bg-white rounded-2xl transition-all outline-none text-zamam-textDark text-right text-base lg:text-lg placeholder:text-gray-300"
                    placeholder="email@example.com"
                    value={email} onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="login-password" className="text-sm font-bold text-zamam-textDark block text-right mr-1">كلمة المرور</label>
                <div className="relative group">
                  <Lock className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zamam-textGray group-focus-within:text-zamam-primary transition-colors" />
                  <input 
                    id="login-password" type={showPassword ? "text" : "password"} required
                    className="w-full pr-14 pl-12 py-3.5 lg:py-4 bg-zamam-light/50 border-2 border-transparent focus:border-zamam-primary/30 focus:bg-white rounded-2xl transition-all outline-none text-zamam-textDark text-right text-base lg:text-lg placeholder:text-gray-300"
                    placeholder="••••••••"
                    value={password} onChange={(e) => setPassword(e.target.value)}
                  />
                  <button 
                    type="button"
                    aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-zamam-textGray hover:text-zamam-primary transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-sm font-bold">
                <Link to="/password-reset" className="text-zamam-primary hover:text-zamam-primaryHover transition-colors underline-offset-4 hover:underline">نسيت كلمة المرور؟</Link>
                <label className="flex items-center gap-3 cursor-pointer group">
                  <span className="text-zamam-textGray group-hover:text-zamam-textDark transition-colors">تذكرني</span>
                  <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} className="w-5 h-5 rounded-lg border-2 border-zamam-gray text-zamam-primary focus:ring-zamam-primary cursor-pointer transition-all" />
                </label>
              </div>

              <button
                type="submit" 
                disabled={isLoading}
                className="w-full py-3.5 lg:py-4 bg-gradient-to-l from-[#1B5E5A] to-[#1A2744] text-white rounded-2xl font-black text-lg lg:text-xl hover:opacity-90 shadow-[0_10px_20px_rgba(27,94,90,0.3)] hover:shadow-[0_15px_30px_rgba(27,94,90,0.4)] transition-all active:scale-[0.97] flex items-center justify-center gap-3 disabled:opacity-70 disabled:cursor-not-allowed mt-2"
              >
                {isLoading ? (
                  <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} className="w-6 h-6 border-3 border-white border-t-transparent rounded-full" />
                ) : (
                  <>تسجيل الدخول <ArrowLeft className="w-6 h-6" /></>
                )}
              </button>
            </form>

            {/* Mobile Footer */}
            <div className="lg:hidden text-center text-zamam-textGray text-xs font-bold mt-8">
              <p>نظام زمام | ZAMAM System © 2026</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
