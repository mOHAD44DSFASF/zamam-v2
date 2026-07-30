import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, UserPlus, Mail, Lock, User, Shield, ChevronDown, Check } from 'lucide-react';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, collection, getDocs } from 'firebase/firestore';
import { secondaryAuth, db } from '../lib/firebase';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onUserCreated: () => void;
}

export const UserCreationModal: React.FC<Props> = ({ isOpen, onClose, onUserCreated }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('');
  const [roles, setRoles] = useState<any[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      getDocs(collection(db, 'roles')).then(snapshot => {
        const list = snapshot.docs.map(d => ({ id: d.id, name: d.data().name }));
        setRoles(list);
        if (list.length > 0) {
          setRole(list.find(r => r.id === 'Creator')?.id || list[0].id);
        }
      }).catch(err => {
        console.error("Error loading roles in modal:", err);
      });
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    try {
      // 1. Create user in Firebase Auth using secondary app to prevent sign out
      const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
      const user = userCredential.user;

      // 2. Save user profile in Firestore
      await setDoc(doc(db, 'users', user.uid), {
        displayName: name,
        email: email,
        role: role,
        createdAt: new Date().toISOString()
      });

      // 3. Close & Refresh
      onUserCreated();
      onClose();
      setName('');
      setEmail('');
      setPassword('');
      setRole('Creator');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'حدث خطأ أثناء إضافة العضو');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-zamam-navy/40 backdrop-blur-sm font-['Cairo']">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
          className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
          
          <div className="p-6 md:p-8 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 flex-row-reverse">
            <div className="flex items-center gap-4 flex-row-reverse">
              <div className="w-12 h-12 bg-zamam-primary/10 rounded-2xl flex items-center justify-center text-zamam-primary">
                <UserPlus className="w-6 h-6" />
              </div>
              <div className="text-right">
                <h2 className="text-2xl font-black text-meta-textDark">إضافة عضو جديد</h2>
                <p className="text-sm font-bold text-meta-textGray mt-1">قم بإضافة عضو وتحديد صلاحياته</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors"><X className="w-6 h-6 text-gray-500" /></button>
          </div>

          <div className="p-6 md:p-8 overflow-y-auto flex-1 custom-scrollbar">
            {error && <div className="mb-6 bg-red-50 text-red-600 p-4 rounded-2xl text-right text-sm font-bold" dir="rtl">{error}</div>}
            
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="text-sm font-bold text-zamam-textDark block text-right mb-2">اسم العضو</label>
                <div className="relative">
                  <User className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input required type="text" value={name} onChange={e => setName(e.target.value)} className="w-full pr-12 pl-4 py-3.5 bg-gray-50 border-2 border-transparent focus:bg-white focus:border-zamam-primary rounded-2xl transition-all outline-none text-right font-bold text-sm" placeholder="أحمد محمد" />
                </div>
              </div>

              <div>
                <label className="text-sm font-bold text-zamam-textDark block text-right mb-2">البريد الإلكتروني</label>
                <div className="relative">
                  <Mail className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input required type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full pr-12 pl-4 py-3.5 bg-gray-50 border-2 border-transparent focus:bg-white focus:border-zamam-primary rounded-2xl transition-all outline-none text-right font-bold text-sm" placeholder="email@example.com" />
                </div>
              </div>

              <div>
                <label className="text-sm font-bold text-zamam-textDark block text-right mb-2">كلمة المرور المؤقتة</label>
                <div className="relative">
                  <Lock className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input required type="text" value={password} onChange={e => setPassword(e.target.value)} className="w-full pr-12 pl-4 py-3.5 bg-gray-50 border-2 border-transparent focus:bg-white focus:border-zamam-primary rounded-2xl transition-all outline-none text-right font-bold text-sm" placeholder="••••••••" minLength={6} />
                </div>
              </div>

               <div>
                <label className="text-sm font-bold text-zamam-textDark block text-right mb-2">الدور الوظيفي</label>
                <div className="relative">
                  <button 
                    type="button" 
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    className="w-full flex items-center justify-between pr-12 pl-4 py-3.5 bg-gray-50 border-2 border-transparent focus:bg-white focus:border-zamam-primary rounded-2xl transition-all outline-none text-right font-bold text-sm"
                  >
                    <Shield className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <span className="flex-1 text-right block mr-2">{roles.find(r => r.id === role)?.name || 'اختر الدور...'}</span>
                    <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                  </button>
                  
                  <AnimatePresence>
                    {isDropdownOpen && (
                      <motion.div 
                        initial={{ opacity: 0, y: -10 }} 
                        animate={{ opacity: 1, y: 0 }} 
                        exit={{ opacity: 0, y: -10 }}
                        className="absolute z-50 w-full mt-2 bg-white border border-gray-100 rounded-2xl shadow-xl max-h-60 overflow-y-auto"
                      >
                        {roles.map(r => (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => {
                              setRole(r.id);
                              setIsDropdownOpen(false);
                            }}
                            className="w-full px-4 py-3 text-right text-sm font-bold text-gray-700 hover:bg-zamam-light transition-colors flex items-center justify-between flex-row-reverse"
                          >
                            <span>{r.name}</span>
                            {role === r.id && <Check className="w-4 h-4 text-zamam-primary shrink-0" />}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

            </form>
          </div>

          <div className="p-6 md:p-8 border-t border-gray-100 flex justify-end gap-3 bg-gray-50/50">
            <button type="button" onClick={onClose} className="px-6 py-3.5 rounded-2xl font-bold text-gray-500 hover:bg-gray-200 transition-colors">إلغاء</button>
            <button onClick={handleSubmit} disabled={isLoading} className="px-8 py-3.5 rounded-2xl font-black bg-zamam-primary text-white hover:bg-zamam-primary/90 transition-all shadow-lg shadow-zamam-primary/20 disabled:opacity-50 flex items-center gap-2">
              {isLoading ? 'جاري الإضافة...' : 'إضافة العضو'}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

