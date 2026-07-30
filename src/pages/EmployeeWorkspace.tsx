import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, Clock, FolderDown, LogOut, Trash2, Activity, Paperclip, Upload, Globe, Link, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, collection, query, updateDoc, onSnapshot, arrayUnion } from 'firebase/firestore';
import { R2Service } from '../lib/r2Service';

export const EmployeeWorkspace: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'active' | 'archive'>('active');
  const navigate = useNavigate();

  const [tasks, setTasks] = useState<any[]>([]);

  const [userName, setUserName] = useState('...');
  const [userRole, setUserRole] = useState('...');

  // Toast Notification State
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  
  // Link Attachment State
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [linkTaskId, setLinkTaskId] = useState('');
  const [linkName, setLinkName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
  };

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  React.useEffect(() => {
    let unsubscribeTasks: () => void;

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUserName(user.displayName || user.email?.split('@')[0] || 'مستخدم');
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        let currentUserRole = 'موظف';
        
        if (userDoc.exists()) {
          const data = userDoc.data();
          if (data.displayName) setUserName(data.displayName);
          currentUserRole = data.role || 'موظف';
          setUserRole(currentUserRole);
        }

        const tasksQuery = query(collection(db, 'tasks'));
        unsubscribeTasks = onSnapshot(tasksQuery, (snapshot) => {
          const allTasks = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
          const filtered = allTasks.filter((t: any) => {
            if (activeTab === 'archive') return t.status === 'Completed';
            if (t.status === 'Completed') return false;
            if (currentUserRole === 'Admin' || currentUserRole === 'المدير العام' || currentUserRole === 'DeputyManager' || currentUserRole === 'نائب المدير') {
              return true;
            }
            const currentStageData = t.pipeline?.find((p: any) => p.stage === t.currentStage);
            if (!currentStageData) return false;
            const isAssignedToMe = currentStageData.assigneeId === user.uid;
            const isMyRoleUnassigned = !currentStageData.assigneeId && currentStageData.role === currentUserRole;
            return isAssignedToMe || isMyRoleUnassigned;
          });
          setTasks(filtered);
        });
      } else {
        navigate('/');
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeTasks) unsubscribeTasks();
    };
  }, [navigate, activeTab]);

  const handleMarkDone = async (task: any) => {
    // Check if file upload is required and missing
    if (task.requiresFileUpload && (!task.attachments || task.attachments.length === 0) && !task.fileLink) {
      showToast("عذراً، هذه المهمة تتطلب إرفاق ملفات العمل أو رابط أولاً قبل إتمامها.", "error");
      return;
    }

    try {
      const nextStage = task.currentStage + 1;
      const isLastStage = nextStage > (task.pipeline?.length || 0);

      const taskRef = doc(db, 'tasks', task.id);
      
      if (isLastStage) {
        await updateDoc(taskRef, {
          status: 'Completed',
          completedAt: new Date().toISOString()
        });
        showToast("تهانينا! تم إنجاز المهمة بالكامل بنجاح 🎉", "success");
      } else {
        await updateDoc(taskRef, {
          currentStage: nextStage,
          status: 'In Progress'
        });
        showToast("تم إرسال المهمة للمرحلة التالية بنجاح 👍", "success");
      }
    } catch (error) {
      console.error("Error updating task:", error);
      showToast("حدث خطأ أثناء تحديث المهمة", "error");
    }
  };

  const [uploading, setUploading] = useState<string | null>(null);

  const deleteAttachment = async (taskId: string, fileUrl: string) => {
    if (!window.confirm("هل أنت متأكد من حذف هذا المرفق لتوفير مساحة؟")) return;
    try {
      const taskRef = doc(db, 'tasks', taskId);
      const taskSnap = await getDoc(taskRef);
      if (taskSnap.exists()) {
        const currentAttachments = taskSnap.data().attachments || [];
        const updated = currentAttachments.filter((f: any) => f.url !== fileUrl);
        await updateDoc(taskRef, { attachments: updated });
        showToast("تم حذف المرفق بنجاح ✅");
      }
    } catch (error) {
      console.error(error);
      showToast("حدث خطأ أثناء الحذف", "error");
    }
  };

  const handleFileUpload = async (taskId: string, files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    setUploading(taskId);
    try {
      const uploadPromises = Array.from(files).map(async (file) => {
        const uploadResult = await R2Service.uploadFile(file, taskId);
        if (!uploadResult.success || !uploadResult.url) {
          throw new Error(`Failed to upload ${file.name}`);
        }
        return { name: file.name, url: uploadResult.url, type: file.type };
      });

      const uploadedFiles = await Promise.all(uploadPromises);
      
      const taskRef = doc(db, 'tasks', taskId);
      await updateDoc(taskRef, {
        attachments: arrayUnion(...uploadedFiles)
      });

      showToast("تم رفع الملفات بنجاح إلى سحابة ZAMAM ✅", "success");
    } catch (error: any) {
      console.error("Upload error detail:", error);
      showToast("حدث خطأ أثناء الرفع. يرجى التحقق من إعدادات الـ Worker.", "error");
    } finally {
      setUploading(null);
    }
  };

  const handleAddLink = async () => {
    if (!linkUrl.trim()) return;
    try {
      const taskRef = doc(db, 'tasks', linkTaskId);
      await updateDoc(taskRef, {
        attachments: arrayUnion({
          name: linkName.trim() || 'رابط Google Drive',
          url: linkUrl.trim(),
          type: 'link'
        })
      });
      showToast("تمت إضافة الرابط بنجاح! 🔗", "success");
      setIsLinkModalOpen(false);
      setLinkName('');
      setLinkUrl('');
    } catch (err) {
      console.error("Error adding link attachment:", err);
      showToast("حدث خطأ أثناء إضافة الرابط", "error");
    }
  };

  return (
    <div className="min-h-screen bg-zamam-light flex flex-col font-['Cairo'] text-right">
      <header className="bg-white border-b border-gray-100 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-row-reverse items-center justify-between py-4">
            <div className="flex items-center gap-4 flex-row-reverse">
              <div className="w-12 h-12 bg-gradient-to-br from-zamam-primary to-zamam-navy rounded-2xl flex items-center justify-center text-white font-black text-xl shadow-lg shadow-zamam-primary/20">
                {userName.charAt(0)}
              </div>
              <div>
                <h1 className="text-xl font-black text-meta-textDark">مرحباً، {userName}</h1>
                <p className="text-xs font-bold text-meta-textGray">{userRole}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-row-reverse">
              {(userRole === 'Admin' || userRole === 'المدير العام') && (
                <button onClick={() => navigate('/admin')} className="px-5 py-2.5 bg-zamam-primary/10 text-zamam-primary rounded-xl font-black text-sm hover:bg-zamam-primary/20 transition-all">لوحة الإدارة</button>
              )}
              <button onClick={() => navigate('/')} className="p-2.5 bg-red-50 text-red-500 rounded-xl hover:bg-red-500 hover:text-white transition-all">
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
          <div className="hidden md:flex gap-8 border-b border-transparent justify-end">
            <button className={`py-4 text-sm font-black border-b-2 transition-all ${activeTab === 'active' ? 'border-zamam-primary text-zamam-primary' : 'border-transparent text-meta-textGray hover:text-zamam-textDark'}`} onClick={() => setActiveTab('active')}>المهام النشطة</button>
            <button className={`py-4 text-sm font-black border-b-2 transition-all ${activeTab === 'archive' ? 'border-zamam-primary text-zamam-primary' : 'border-transparent text-meta-textGray hover:text-zamam-textDark'}`} onClick={() => setActiveTab('archive')}>الأرشيف</button>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <AnimatePresence mode="wait">
          {activeTab === 'active' ? (
            <motion.div key="active" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {tasks.filter(t => t.status !== 'Completed').map((task) => (
                <div key={task.id} className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-gray-100 flex flex-col hover:shadow-2xl transition-all duration-300 group">
                  <div className="mb-6">
                    <div className="flex justify-between items-start mb-6 flex-row-reverse">
                      <span className={`px-4 py-1.5 rounded-xl text-[11px] font-black ${task.priority === 'High' || task.priority === 'عالية' ? 'bg-red-50 text-red-600' : 'bg-orange-50 text-orange-600'}`}>{task.priority === 'High' || task.priority === 'عالية' ? '🔥 عالية' : '⚡ متوسطة'}</span>
                      <div className="p-3 bg-gray-50 rounded-2xl group-hover:bg-zamam-primary/10 transition-colors"><Activity className="w-6 h-6 text-zamam-primary" /></div>
                    </div>
                    <div className="flex items-center gap-2 mb-1 flex-row-reverse">
                      <p className="text-[10px] font-black px-2 py-0.5 bg-gray-100 rounded text-gray-500">{task.id.slice(-5).toUpperCase()}</p>
                      <p className="text-xs text-zamam-primary font-bold">
                        {(() => {
                          const currentStageData = task.pipeline?.find((p: any) => p.stage === task.currentStage);
                          return currentStageData?.action ? `الإجراء المطلوب: ${currentStageData.action}` : `المرحلة ${task.currentStage}`;
                        })()}
                      </p>
                    </div>
                    <h3 className="text-xl font-black text-meta-textDark mb-3">{task.title}</h3>
                    <p className="text-sm font-bold text-meta-textGray leading-relaxed line-clamp-3">{task.description}</p>
                  </div>
                  
                  {/* Google Drive Link Section */}
                  <div className="mb-4">
                    {task.fileLink ? (
                      <a href={task.fileLink} target="_blank" rel="noopener noreferrer" className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-zamam-primary text-white rounded-[1.5rem] font-black hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-zamam-primary/20 text-sm">
                        <FolderDown className="w-5 h-5" /> مجلد Google Drive للمهمة
                      </a>
                    ) : (
                      <div className="w-full p-4 bg-gray-50 text-gray-400 rounded-[1.5rem] text-center font-bold text-xs border-2 border-dashed border-gray-100">لا يوجد رابط مجلد Drive</div>
                    )}
                  </div>

                  {/* Attachments Section */}
                  <div className="mb-6 border-t border-gray-50 pt-4 flex-1">
                    <h4 className="text-sm font-bold text-meta-textDark mb-3 text-right flex items-center justify-end gap-1">
                      <span>الملفات والمرفقات</span>
                      <Paperclip className="w-4 h-4 text-zamam-primary" />
                    </h4>
                    
                    {/* List of uploaded attachments */}
                    {task.attachments && task.attachments.length > 0 ? (
                      <div className="space-y-2 mb-4 max-h-[150px] overflow-y-auto custom-scrollbar">
                        {task.attachments.map((file: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between bg-gray-50 p-2.5 rounded-xl border border-gray-100 text-xs flex-row-reverse">
                            <a href={file.url} target="_blank" rel="noopener noreferrer" className="text-zamam-primary hover:underline font-bold truncate flex-1 text-right max-w-[180px] flex items-center justify-end gap-1">
                              <span>{file.name}</span>
                              {file.type === 'link' ? (
                                <Globe className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                              ) : (
                                <Paperclip className="w-3.5 h-3.5 text-zamam-primary shrink-0" />
                              )}
                            </a>
                            <button 
                              onClick={() => deleteAttachment(task.id, file.url)}
                              className="text-red-500 hover:bg-red-50 p-1.5 rounded-lg transition-colors"
                              title="حذف الملف"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 text-center py-2 font-bold">لا توجد ملفات مرفوعة بعد</p>
                    )}

                    <div className="space-y-2">
                      {/* File Upload Input */}
                      <label className={`flex items-center justify-center gap-2 p-3 border-2 border-dashed rounded-2xl cursor-pointer transition-all ${
                        uploading === task.id ? 'bg-gray-50 border-gray-200 cursor-not-allowed' : 'bg-zamam-primary/5 border-zamam-primary/20 hover:bg-zamam-primary/10'
                      }`}>
                        <Upload className="w-4 h-4 text-zamam-primary" />
                        <span className="text-xs font-black text-zamam-primary">
                          {uploading === task.id ? 'جاري الرفع...' : '+ رفع ملفات جديدة'}
                        </span>
                        <input 
                          type="file" 
                          multiple 
                          className="hidden" 
                          disabled={uploading === task.id} 
                          onChange={(e) => handleFileUpload(task.id, e.target.files)} 
                        />
                      </label>

                      {/* Add Link Input */}
                      <button 
                        type="button"
                        onClick={() => {
                          setLinkTaskId(task.id);
                          setIsLinkModalOpen(true);
                        }}
                        className="w-full flex items-center justify-center gap-2 p-3 border-2 border-dashed bg-blue-50/30 border-blue-200 hover:bg-blue-50 rounded-2xl cursor-pointer transition-all text-xs font-black text-blue-600"
                      >
                        <Link className="w-4 h-4 text-blue-500" />
                        <span>+ إرفاق رابط (درايف / خارجي)</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-auto pt-6 border-t border-gray-50 flex-row-reverse">
                    <button onClick={() => handleMarkDone(task)} className="bg-green-500 text-white px-6 py-3 rounded-2xl font-black hover:bg-green-600 transition-all flex items-center shadow-lg shadow-green-500/20 active:scale-95 text-sm"><CheckCircle className="w-4 h-4 ml-1.5" /> إتمام المهمة</button>
                    <div className="text-[11px] font-bold text-meta-textGray flex items-center">{new Date(task.createdAt?.seconds * 1000 || Date.now()).toLocaleDateString('ar-EG')}<Clock className="w-3.5 h-3.5 ml-1.5" /></div>
                  </div>
                </div>
              ))}
              {tasks.filter(t => t.status !== 'Completed').length === 0 && (
                <div className="col-span-full py-20 text-center bg-white rounded-[2.5rem] border border-gray-100 shadow-sm">
                  <div className="w-24 h-24 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle className="w-12 h-12 text-green-500" />
                  </div>
                  <h3 className="text-xl font-bold text-meta-textDark mb-2">أنت منجز جداً!</h3>
                  <p className="text-meta-textGray font-bold">لا توجد مهام نشطة حالياً بانتظارك.</p>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div key="archive" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {tasks.filter(t => t.status === 'Completed').map((task) => (
                <div key={task.id} className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-gray-100 flex flex-col opacity-80 hover:opacity-100 transition-all duration-300 group">
                  <div className="mb-6">
                    <div className="flex justify-between items-start mb-6 flex-row-reverse">
                      <span className="px-4 py-1.5 rounded-xl text-[11px] font-black bg-green-50 text-green-700">🟢 مكتملة</span>
                      <div className="p-3 bg-gray-50 rounded-2xl"><CheckCircle className="w-6 h-6 text-green-500" /></div>
                    </div>
                    <div className="flex items-center gap-2 mb-1 flex-row-reverse">
                      <p className="text-[10px] font-black px-2 py-0.5 bg-gray-100 rounded text-gray-500">{task.id.slice(-5).toUpperCase()}</p>
                    </div>
                    <h3 className="text-xl font-black text-meta-textDark mb-3">{task.title}</h3>
                    <p className="text-sm font-bold text-meta-textGray leading-relaxed line-clamp-3">{task.description}</p>
                  </div>
                  
                  {/* Google Drive Link Section */}
                  <div className="mb-4">
                    {task.fileLink ? (
                      <a href={task.fileLink} target="_blank" rel="noopener noreferrer" className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gray-100 text-meta-textDark rounded-[1.5rem] font-bold hover:bg-gray-200 transition-all text-sm border border-gray-200">
                        <FolderDown className="w-5 h-5 text-zamam-primary" /> مجلد Google Drive للمهمة
                      </a>
                    ) : (
                      <div className="w-full p-4 bg-gray-50 text-gray-400 rounded-[1.5rem] text-center font-bold text-xs border-2 border-dashed border-gray-100">لا يوجد رابط مجلد Drive</div>
                    )}
                  </div>

                  {/* Attachments Section */}
                  {task.attachments && task.attachments.length > 0 && (
                    <div className="mb-6 border-t border-gray-50 pt-4 flex-1">
                      <h4 className="text-sm font-bold text-meta-textDark mb-3 text-right flex items-center justify-end gap-1">
                        <span>الملفات المرفقة</span>
                        <Paperclip className="w-4 h-4 text-zamam-primary" />
                      </h4>
                      <div className="space-y-2 max-h-[150px] overflow-y-auto custom-scrollbar">
                        {task.attachments.map((file: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between bg-gray-50 p-2.5 rounded-xl border border-gray-100 text-xs flex-row-reverse">
                            <a href={file.url} target="_blank" rel="noopener noreferrer" className="text-zamam-primary hover:underline font-bold truncate text-right flex-1 flex items-center justify-end gap-1">
                              <span>{file.name}</span>
                              {file.type === 'link' ? (
                                <Globe className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                              ) : (
                                <Paperclip className="w-3.5 h-3.5 text-zamam-primary shrink-0" />
                              )}
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-auto pt-6 border-t border-gray-50 flex-row-reverse">
                    <span className="px-4 py-2 bg-green-50 text-green-700 rounded-xl text-xs font-black">مكتملة بالكامل</span>
                    <div className="text-[11px] font-bold text-meta-textGray flex items-center">
                      {task.completedAt ? new Date(task.completedAt).toLocaleDateString('ar-EG') : (task.createdAt?.seconds ? new Date(task.createdAt.seconds * 1000).toLocaleDateString('ar-EG') : new Date().toLocaleDateString('ar-EG'))}
                      <Clock className="w-3.5 h-3.5 ml-1.5" />
                    </div>
                  </div>
                </div>
              ))}
              {tasks.filter(t => t.status === 'Completed').length === 0 && (
                <div className="col-span-full py-20 text-center bg-white rounded-[2.5rem] border border-gray-100 shadow-sm">
                  <h3 className="text-xl font-bold text-meta-textDark mb-2">الأرشيف فارغ</h3>
                  <p className="text-meta-textGray font-bold">لا توجد مهام مكتملة في الأرشيف حالياً.</p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>
      <footer className="py-10 text-center text-meta-textGray text-[10px] font-bold opacity-50 pb-28 md:pb-10">
        <p>نظام زمام | ZAMAM System © 2026</p>
      </footer>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: -50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            className={`fixed top-6 left-1/2 -translate-x-1/2 z-50 px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 font-bold text-sm text-right ${
              toast.type === 'success' ? 'bg-green-600 text-white shadow-green-600/20' : 
              toast.type === 'error' ? 'bg-red-600 text-white shadow-red-600/20' : 
              'bg-zamam-navy text-white shadow-zamam-navy/20'
            }`}
            style={{ minWidth: '300px' }}
          >
            <span className="flex-1">{toast.message}</span>
            <button onClick={() => setToast(null)} className="text-white/80 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Link Attachment Modal */}
      <AnimatePresence>
        {isLinkModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zamam-navy/40 backdrop-blur-sm font-['Cairo']">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.95 }} 
              className="bg-white w-full max-w-md rounded-[2rem] shadow-2xl p-6 md:p-8 text-right relative overflow-hidden"
            >
              <button onClick={() => setIsLinkModalOpen(false)} className="absolute left-6 top-6 text-gray-400 hover:text-gray-600 transition-colors">
                <X className="w-6 h-6" />
              </button>
              <h3 className="text-2xl font-black text-meta-textDark mb-2">إرفاق رابط للمهمة</h3>
              <p className="text-sm font-bold text-meta-textGray mb-6">أضف رابط Google Drive أو أي رابط خارجي لإثبات العمل.</p>
              
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-zamam-textDark block mb-1">اسم الرابط (اختياري)</label>
                  <input 
                    type="text" 
                    placeholder="مثال: ملف العمل النهائي" 
                    value={linkName}
                    onChange={(e) => setLinkName(e.target.value)}
                    className="w-full px-4 py-3 bg-gray-50 border-2 border-transparent focus:bg-white focus:border-zamam-primary rounded-xl outline-none text-right font-bold text-sm"
                  />
                </div>
                
                <div>
                  <label className="text-xs font-bold text-zamam-textDark block mb-1">عنوان الرابط (URL)</label>
                  <input 
                    type="url" 
                    placeholder="https://drive.google.com/..." 
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    className="w-full px-4 py-3 bg-gray-50 border-2 border-transparent focus:bg-white focus:border-zamam-primary rounded-xl outline-none text-left font-bold text-sm"
                    dir="ltr"
                    required
                  />
                </div>
                
                <button 
                  onClick={handleAddLink}
                  className="w-full py-3.5 bg-zamam-primary text-white font-black rounded-2xl hover:bg-zamam-primary/90 transition-all shadow-lg shadow-zamam-primary/20"
                >
                  إضافة المرفق
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40 flex justify-around items-center px-1 py-2 shadow-[0_-4px_20px_rgba(0,0,0,0.08)]" style={{ paddingBottom: 'env(safe-area-inset-bottom, 8px)' }}>
        <button onClick={() => setActiveTab('active')}
          className={`flex flex-col items-center gap-1 p-1 rounded-2xl min-w-[60px] transition-all ${activeTab === 'active' ? 'text-zamam-primary font-black scale-105' : 'text-gray-400 font-bold'}`}>
          <Clock className="w-5 h-5" />
          <span className="text-[10px] leading-tight">المهام النشطة</span>
        </button>
        <button onClick={() => setActiveTab('archive')}
          className={`flex flex-col items-center gap-1 p-1 rounded-2xl min-w-[60px] transition-all ${activeTab === 'archive' ? 'text-zamam-primary font-black scale-105' : 'text-gray-400 font-bold'}`}>
          <CheckCircle className="w-5 h-5" />
          <span className="text-[10px] leading-tight">الأرشيف</span>
        </button>
        <button onClick={() => { auth.signOut(); navigate('/'); }} className="flex flex-col items-center gap-1 p-1 rounded-2xl min-w-[60px] text-red-500 font-bold">
          <LogOut className="w-5 h-5" />
          <span className="text-[10px] leading-tight">خروج</span>
        </button>
      </nav>
    </div>
  );
};
