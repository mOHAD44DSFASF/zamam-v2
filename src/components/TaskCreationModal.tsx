import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Priority, PipelineStage } from '../types';
import { PlusCircle, X, ArrowLeft, CheckCircle } from 'lucide-react';
import { R2Service } from '../lib/r2Service';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';

interface TaskCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (taskData: any) => void;
  teamMembers: any[];
}

export const TaskCreationModal: React.FC<TaskCreationModalProps> = ({ isOpen, onClose, onSubmit, teamMembers }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('Medium');

  const [requiresFileUpload, setRequiresFileUpload] = useState(false);
  const [requiresAdminApproval, setRequiresAdminApproval] = useState(false);
  
  // Dynamic pipeline states
  const [pipeline, setPipeline] = useState<PipelineStage[]>([
    { stage: 1, assigneeId: '', role: '', status: 'Pending', action: 'عمل ملف جديد' }
  ]);

  const [roles, setRoles] = useState<any[]>([]);
  const [workspaces, setWorkspaces] = useState<any[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');

  useEffect(() => {
    if (isOpen) {
      // Fetch roles
      getDocs(collection(db, 'roles')).then(snapshot => {
        const list = snapshot.docs.map(d => ({ id: d.id, name: d.data().name }));
        setRoles(list);
        if (list.length > 0) {
          setPipeline(prev => prev.map(p => p.role === '' ? { ...p, role: list.find(r => r.id === 'Creator')?.id || list[0].id } : p));
        }
      }).catch(err => {
        console.error("Error loading roles in TaskCreationModal:", err);
      });
      // Fetch workspaces
      getDocs(collection(db, 'workspaces')).then(snapshot => {
        setWorkspaces(snapshot.docs.map(d => ({ id: d.id, name: d.data().name } as any)));
      }).catch(err => {
        console.error("Error loading workspaces in TaskCreationModal:", err);
      });
    }
  }, [isOpen]);

  const dynamicRoleMap = React.useMemo(() => {
    const map: Record<string, string> = {};
    roles.forEach(r => {
      map[r.id] = r.name;
    });
    return map;
  }, [roles]);

  const availableRoles = React.useMemo(() => {
    return roles.map(r => r.id);
  }, [roles]);

  const handleAddStage = () => {
    const defaultRole = roles.find(r => r.id === 'Reviewer')?.id || roles[0]?.id || '';
    setPipeline([
      ...pipeline, 
      { stage: pipeline.length + 1, assigneeId: '', role: defaultRole, status: 'Pending', action: 'مراجعة' }
    ]);
  };

  const handleUpdateStage = (index: number, field: keyof PipelineStage, value: any) => {
    const updated = [...pipeline];
    updated[index] = { ...updated[index], [field]: value };
    setPipeline(updated);
  };

  const handleRemoveStage = (index: number) => {
    const updated = pipeline.filter((_, i) => i !== index).map((p, i) => ({ ...p, stage: i + 1 }));
    setPipeline(updated);
  };

  const [uploading, setUploading] = useState(false);
  const [attachments, setAttachments] = useState<any[]>([]);

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const uploadPromises = Array.from(files).map(async (file) => {
        const uploadResult = await R2Service.uploadFile(file, "temp_uploads");
        if (!uploadResult.success || !uploadResult.url) {
          throw new Error(`Failed to upload ${file.name}`);
        }
        return { name: file.name, url: uploadResult.url, type: file.type };
      });
      const results = await Promise.all(uploadPromises);
      setAttachments([...attachments, ...results]);
    } catch (error) {
      console.error(error);
      alert("حدث خطأ أثناء الرفع إلى سحابة Cloudflare R2. يرجى التحقق من إعدادات الـ Worker.");
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      title,
      description,
      priority,
      requiresAdminApproval,
      requiresFileUpload,
      pipeline,
      fileLink: '',
      attachments,
      currentStage: 1,
      status: 'Pending',
      createdAt: new Date(),
      workspaceId: workspaceId || null
    });
    // Reset states
    setTitle('');
    setDescription('');
    setPriority('Medium');
    setRequiresAdminApproval(false);
    setRequiresFileUpload(false);
    setAttachments([]);
    setWorkspaceId('');
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-zamam-navy/40 backdrop-blur-sm z-40"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl bg-white rounded-[2.5rem] shadow-2xl z-50 overflow-hidden flex flex-col max-h-[90vh] text-right font-['Cairo']"
          >
            <div className="flex items-center justify-between p-6 md:p-8 border-b border-gray-100 bg-gray-50/50 flex-row-reverse">
              <h2 className="text-2xl font-black text-zamam-textDark">إنشاء مهمة جديدة</h2>
              <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
                <X className="w-6 h-6 text-gray-500" />
              </button>
            </div>

            <div className="p-6 md:p-8 overflow-y-auto custom-scrollbar">
              <form id="task-form" onSubmit={handleSubmit} className="space-y-6">
                
                {/* Basic Info */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-bold text-zamam-textDark mb-2">عنوان المهمة</label>
                    <input 
                      type="text" required
                      className="w-full px-4 py-3.5 bg-gray-50 border-2 border-transparent focus:border-zamam-primary focus:bg-white rounded-2xl transition-all outline-none text-right font-bold text-sm"
                      placeholder="مثال: تصميم بوست انستقرام"
                      value={title} onChange={(e) => setTitle(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-zamam-textDark mb-2">الوصف</label>
                    <textarea 
                      rows={3}
                      className="w-full px-4 py-3.5 bg-gray-50 border-2 border-transparent focus:border-zamam-primary focus:bg-white rounded-2xl transition-all outline-none resize-none text-right font-bold text-sm"
                      placeholder="أضف تفاصيل وتعليمات المهمة..."
                      value={description} onChange={(e) => setDescription(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-zamam-textDark mb-2 text-right">الأولوية</label>
                    <div className="flex gap-4 flex-row-reverse">
                      {[
                        { id: 'High', label: '🔥 عالية' },
                        { id: 'Medium', label: '⚡ متوسطة' },
                        { id: 'Low', label: '🟢 منخفضة' }
                      ].map((p) => (
                        <label key={p.id} className="flex-1">
                          <input type="radio" name="priority" className="peer hidden" 
                            checked={priority === p.id} onChange={() => setPriority(p.id as Priority)} />
                          <div className={`text-center py-3.5 rounded-2xl border-2 cursor-pointer transition-all font-bold text-sm ${
                            priority === p.id ? 'border-zamam-primary bg-zamam-primary/5 text-zamam-primary' : 'border-gray-100 text-zamam-textGray hover:bg-gray-50'
                          }`}>
                            {p.label}
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-zamam-textDark mb-2 text-right">مساحة العمل (اختياري)</label>
                    <select 
                      value={workspaceId} 
                      onChange={(e) => setWorkspaceId(e.target.value)}
                      className="w-full px-4 py-3.5 bg-gray-50 border-2 border-transparent focus:border-zamam-primary focus:bg-white rounded-2xl transition-all outline-none text-right font-bold text-sm appearance-none"
                      dir="rtl"
                    >
                      <option value="">لا ينتمي لمساحة عمل معينة (عام)</option>
                      {workspaces.map(w => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-zamam-textDark mb-2">إرفاق ملفات توضيحية (اختياري)</label>
                    <div className="space-y-3">
                      {attachments.map((file, idx) => (
                        <div key={idx} className="flex items-center justify-between bg-green-50 p-3 rounded-xl border border-green-100 flex-row-reverse">
                          <span className="text-xs font-bold text-green-700 truncate flex-1 text-right">{file.name}</span>
                          <CheckCircle className="w-4 h-4 text-green-500" />
                        </div>
                      ))}
                      <label className={`flex items-center justify-center gap-2 p-4 border-2 border-dashed rounded-2xl cursor-pointer transition-all ${uploading ? 'bg-gray-50 border-gray-200' : 'bg-zamam-primary/5 border-zamam-primary/20 hover:bg-zamam-primary/10'}`}>
                        <span className="text-sm font-bold text-zamam-primary">{uploading ? 'جاري الرفع...' : '+ إضافة ملفات للمهمة'}</span>
                        <input type="file" multiple className="hidden" disabled={uploading} onChange={(e) => handleFileUpload(e.target.files)} />
                      </label>
                    </div>
                  </div>
                </div>

                <hr className="border-gray-100" />

                {/* Workflow Setup */}
                <div>
                  <div className="flex items-center justify-between mb-4 flex-row-reverse">
                    <h3 className="text-lg font-black text-zamam-textDark">إعداد سير العمل (محرك التوجيه)</h3>
                    <button type="button" onClick={handleAddStage} className="text-sm text-zamam-primary flex items-center font-bold hover:underline flex-row-reverse">
                      <PlusCircle className="w-4 h-4 ml-1" /> إضافة مرحلة
                    </button>
                  </div>
                  
                  <div className="space-y-3">
                    {pipeline.map((stage, index) => (
                      <div key={index} className="flex items-center gap-3 bg-gray-50 p-4 rounded-2xl border border-gray-100 flex-row-reverse">
                        <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-zamam-primary text-white font-black text-sm shrink-0">
                          {stage.stage}
                        </div>
                        
                        <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3 flex-row-reverse">
                          <select 
                            className="px-4 py-2.5 bg-white rounded-xl border border-gray-200 text-sm font-bold outline-none focus:border-zamam-primary text-right appearance-none"
                            value={stage.role}
                            onChange={(e) => handleUpdateStage(index, 'role', e.target.value)}
                          >
                            {availableRoles.map(r => <option key={r} value={r}>{dynamicRoleMap[r] || r}</option>)}
                          </select>
                          
                          <select 
                            className="px-4 py-2.5 bg-white rounded-xl border border-gray-200 text-sm font-bold outline-none focus:border-zamam-primary text-right appearance-none"
                            value={stage.assigneeId || ''}
                            onChange={(e) => handleUpdateStage(index, 'assigneeId', e.target.value)}
                          >
                            <option value="">أي {dynamicRoleMap[stage.role] || stage.role} متاح</option>
                            {teamMembers?.filter(u => u.rawRole === stage.role || u.rawRole === 'Admin').map(u => (
                              <option key={u.id} value={u.id}>{u.name}</option>
                            ))}
                          </select>

                          <div>
                            <select 
                              className="w-full px-4 py-2.5 bg-white rounded-xl border border-gray-200 text-sm font-bold outline-none focus:border-zamam-primary text-right appearance-none"
                              value={["تنسيق", "عمل ملف جديد", "مراجعة", "رفع"].includes(stage.action || "") ? (stage.action || "") : (stage.action ? "custom" : "")}
                              onChange={(e) => {
                                const val = e.target.value;
                                handleUpdateStage(index, 'action', val === 'custom' ? '' : val);
                              }}
                            >
                              <option value="">اختر الإجراء...</option>
                              <option value="عمل ملف جديد">عمل ملف جديد</option>
                              <option value="تنسيق">تنسيق</option>
                              <option value="مراجعة">مراجعة</option>
                              <option value="رفع">رفع</option>
                              <option value="custom">مسمى مخصص...</option>
                            </select>
                            
                            {!["تنسيق", "عمل ملف جديد", "مراجعة", "رفع"].includes(stage.action || "") && (
                              <input 
                                type="text" 
                                placeholder="اكتب الإجراء المخصص..." 
                                value={stage.action || ""} 
                                onChange={(e) => handleUpdateStage(index, 'action', e.target.value)}
                                className="mt-2 px-4 py-2 w-full bg-white rounded-xl border border-gray-200 text-sm font-bold outline-none focus:border-zamam-primary text-right"
                              />
                            )}
                          </div>
                        </div>

                        {pipeline.length > 1 && (
                          <button type="button" onClick={() => handleRemoveStage(index)} className="text-red-500 hover:bg-red-50 p-2 rounded-full transition-colors">
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl flex-row-reverse">
                  <span className="text-sm font-bold text-zamam-textDark">يتطلب موافقة المدير قبل الانتقال للمرحلة التالية؟</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" checked={requiresAdminApproval} onChange={(e) => setRequiresAdminApproval(e.target.checked)} />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-zamam-primary"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl flex-row-reverse">
                  <span className="text-sm font-bold text-zamam-textDark">إلزامية إرفاق رابط العمل لإتمام المهمة؟</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" checked={requiresFileUpload} onChange={(e) => setRequiresFileUpload(e.target.checked)} />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-zamam-primary"></div>
                  </label>
                </div>

              </form>
            </div>

            <div className="p-6 md:p-8 border-t border-gray-100 bg-gray-50/50 flex justify-end gap-3 flex-row-reverse">
              <button form="task-form" type="submit" className="px-8 py-3.5 rounded-2xl font-black bg-zamam-primary text-white hover:bg-zamam-primary/90 transition-all shadow-lg shadow-zamam-primary/20 flex items-center gap-2">
                إنشاء وتوجيه <ArrowLeft className="w-5 h-5 ml-1" />
              </button>
              <button type="button" onClick={onClose} className="px-6 py-3.5 rounded-2xl font-bold text-gray-500 hover:bg-gray-200 transition-colors">إلغاء</button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
