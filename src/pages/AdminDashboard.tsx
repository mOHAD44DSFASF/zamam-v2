import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Users, LayoutDashboard, Settings, LogOut, CheckCircle, Clock, Activity, Search, Bell, UserPlus, Trash2, Edit3, BarChart3, TrendingUp, Shield, Globe, Palette, FolderDown, X } from 'lucide-react';
import { TaskCreationModal } from '../components/TaskCreationModal';
import { UserCreationModal } from '../components/UserCreationModal';
import { UserEditModal } from '../components/UserEditModal';
import { useNavigate } from 'react-router-dom';
import zamamIcon from '../assets/ZAMAM/1T.png';
import { auth, db } from '../lib/firebase';
import { onAuthStateChanged, GoogleAuthProvider, linkWithPopup } from 'firebase/auth';
import { doc, getDoc, collection, getDocs, setDoc, addDoc, deleteDoc, onSnapshot, query, updateDoc } from 'firebase/firestore';
import { GoogleDriveService } from '../lib/googleDrive';

const roleMap: Record<string, string> = {
  'Admin': 'مدير عام',
  'DeputyManager': 'نائب المدير',
  'Manager': 'مشرف',
  'Reviewer': 'مراجع',
  'Uploader': 'مسؤول رفع',
  'Creator': 'منتجات'
};

type ActivePage = 'dashboard' | 'team' | 'analytics' | 'settings' | 'workspaces';

export const AdminDashboard: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activePage, setActivePage] = useState<ActivePage>('dashboard');
  const [userName, setUserName] = useState('...');
  const [userRole, setUserRole] = useState('المدير العام');
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [isDriveConnected, setIsDriveConnected] = useState(false);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [userToEdit, setUserToEdit] = useState<any>(null);
  const [alertMessage, setAlertMessage] = useState<{title: string, message: string} | null>(null);
  const [roles, setRoles] = useState<any[]>([]);
  const [workspaces, setWorkspaces] = useState<any[]>([]);
  const [dashboardViewMode, setDashboardViewMode] = useState<'tasks' | 'performance'>('tasks');
  const [isRolesModalOpen, setIsRolesModalOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);
  const [editingWorkspace, setEditingWorkspace] = useState<any>(null);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [selectedSupervisors, setSelectedSupervisors] = useState<string[]>([]);
  const navigate = useNavigate();

  const fetchRoles = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'roles'));
      let list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any));
      if (list.length === 0) {
        const defaults = [
          { id: 'Admin', name: 'المدير العام', isSystem: true },
          { id: 'DeputyManager', name: 'نائب المدير', isSystem: true },
          { id: 'Creator', name: 'منتجات', isSystem: false },
          { id: 'Uploader', name: 'مسؤول سلة', isSystem: false }
        ];
        for (const r of defaults) {
          await setDoc(doc(db, 'roles', r.id), { name: r.name, isSystem: r.isSystem });
        }
        list = defaults;
      }
      setRoles(list);
      return list;
    } catch (error) {
      console.error("Error fetching roles:", error);
      return [];
    }
  };

  const getRoleName = (roleId: string, currentRoles = roles) => {
    return currentRoles.find((r: any) => r.id === roleId)?.name || roleId;
  };

  React.useEffect(() => {
    let unsubscribeTasks: () => void;
    let unsubscribeWorkspaces: () => void;
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUserName(user.displayName || user.email?.split('@')[0] || 'Admin');
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          if (data.displayName) setUserName(data.displayName);
          setUserRole(data.role || 'Admin');
        }
        // Fetch settings
        try {
          const settingsDoc = await getDoc(doc(db, 'settings', 'general'));
          if (settingsDoc.exists()) {
            setIsDriveConnected(!!settingsDoc.data().isDriveConnected);
          }
        } catch (err) {
          console.error("Error fetching general settings:", err);
        }
        
        // Fetch workspaces live
        try {
          const workspacesQuery = query(collection(db, 'workspaces'));
          unsubscribeWorkspaces = onSnapshot(workspacesQuery, (snapshot) => {
            setWorkspaces(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any)));
          });
        } catch (err) {
          console.error("Error setting workspaces listener:", err);
        }
        
        // Fetch roles and then team members
        const currentRoles = await fetchRoles();

        // Fetch team members
        try {
          const snapshot = await getDocs(collection(db, 'users'));
          const members = snapshot.docs
            .filter(d => d.data().isDeleted !== true)
            .map(d => ({
              id: d.id,
              name: d.data().displayName || d.data().email?.split('@')[0] || 'مستخدم',
              email: d.data().email,
              role: currentRoles.find((r: any) => r.id === d.data().role)?.name || d.data().role || 'منتجات',
              rawRole: d.data().role || 'Creator',
              tasks: 0,
              status: 'متصل'
            }));
          
          // Fetch tasks live
          const tasksQuery = query(collection(db, 'tasks'));
          unsubscribeTasks = onSnapshot(tasksQuery, (snapshot) => {
            const allTasks = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            setTasks(allTasks);

            // Update member counts whenever tasks change
            setTeamMembers(prev => prev.map(m => ({
              ...m,
              tasks: allTasks.filter((t: any) => {
                const currentStage = t.pipeline?.find((p: any) => p.stage === t.currentStage);
                return currentStage?.assigneeId === m.id;
              }).length
            })));
          });
          setTeamMembers(members);
        } catch (err) {
          console.error("Error fetching data:", err);
        }
    } else {
      navigate('/');
    }
  });

    return () => {
      unsubscribeAuth();
      if (unsubscribeTasks) unsubscribeTasks();
      if (unsubscribeWorkspaces) unsubscribeWorkspaces();
    };
  }, [navigate]);

  const sidebarItems = React.useMemo(() => {
    const items = [
      { icon: LayoutDashboard, label: 'لوحة التحكم', key: 'dashboard' as ActivePage },
      { icon: Users, label: 'إدارة الفريق', key: 'team' as ActivePage },
      { icon: Globe, label: 'مساحات العمل', key: 'workspaces' as ActivePage },
    ];
    if (userRole !== 'Manager') {
      items.push(
        { icon: Activity, label: 'تحليل الأداء', key: 'analytics' as ActivePage },
        { icon: Settings, label: 'الإعدادات العامة', key: 'settings' as ActivePage }
      );
    }
    return items;
  }, [userRole]);

  const filteredWorkspaces = React.useMemo(() => {
    if (userRole === 'Admin' || userRole === 'DeputyManager') {
      return workspaces;
    }
    return workspaces.filter(w => w.supervisors?.includes(auth.currentUser?.uid || ''));
  }, [workspaces, userRole]);

  const filteredWorkspaceIds = React.useMemo(() => {
    return filteredWorkspaces.map(w => w.id);
  }, [filteredWorkspaces]);

  const filteredTasks = React.useMemo(() => {
    if (userRole === 'Admin' || userRole === 'DeputyManager') {
      return tasks;
    }
    return tasks.filter(t => filteredWorkspaceIds.includes(t.workspaceId));
  }, [tasks, filteredWorkspaceIds, userRole]);

  const filteredTeamMembers = React.useMemo(() => {
    if (userRole === 'Admin' || userRole === 'DeputyManager') {
      return teamMembers;
    }
    const memberIds = new Set<string>();
    filteredWorkspaces.forEach(w => {
      w.members?.forEach((mId: string) => memberIds.add(mId));
      w.supervisors?.forEach((sId: string) => memberIds.add(sId));
    });
    return teamMembers.filter(m => memberIds.has(m.id));
  }, [teamMembers, filteredWorkspaces, userRole]);

  const connectDrive = async () => {
    if (isDriveConnected) {
      setIsDriveConnected(false);
      await setDoc(doc(db, 'settings', 'general'), { isDriveConnected: false }, { merge: true });
      return;
    }
    
    if (!auth.currentUser) return;

    try {
      const provider = new GoogleAuthProvider();
      provider.addScope('https://www.googleapis.com/auth/drive.file');
      await linkWithPopup(auth.currentUser!, provider);
      setIsDriveConnected(true);
      await setDoc(doc(db, 'settings', 'general'), { isDriveConnected: true }, { merge: true });
      setAlertMessage({ title: 'تم الربط', message: 'تم ربط حساب Google Drive بنجاح.' });
    } catch (error: any) {
      console.error("Drive connection error:", error);
      if (error.code === 'auth/credential-already-in-use') {
        alert("⚠️ عذراً، هذا الحساب مرتبط بالفعل بمستخدم آخر في النظام. يرجى استخدام حساب Google مختلف.");
      } else if (error.code === 'auth/operation-not-allowed') {
         setAlertMessage({
           title: 'تنبيه من Firebase', 
           message: 'الرجاء تفعيل تسجيل الدخول بواسطة Google من لوحة تحكم Firebase (Authentication > Sign-in method) لكي يعمل الربط فعلياً. سيتم تفعيل الزر الآن شكلياً للحفظ في قاعدة البيانات.'
         });
         setIsDriveConnected(true);
         await setDoc(doc(db, 'settings', 'general'), { isDriveConnected: true }, { merge: true });
      } else if (error.code === 'auth/credential-already-in-use') {
         setAlertMessage({ title: 'مربوط مسبقاً', message: 'حساب جوجل هذا مربوط بالفعل.' });
         setIsDriveConnected(true);
         await setDoc(doc(db, 'settings', 'general'), { isDriveConnected: true }, { merge: true });
      } else {
         setAlertMessage({ title: 'حدث خطأ', message: error.message });
      }
    }
  };

  const deleteTask = async (taskId: string) => {
    try {
      const taskRef = doc(db, 'tasks', taskId);
      await deleteDoc(taskRef);
      setAlertMessage({ title: 'تم الحذف', message: 'تمت إزالة المهمة من النظام بنجاح.' });
    } catch (error: any) {
      console.error("Delete error:", error);
      alert("عذراً، فشل الحذف. تأكد من اتصالك بالإنترنت.");
    }
  };

  const deleteTeamMember = async (userId: string, name: string) => {
    if (!window.confirm(`⚠️ هل أنت متأكد من إيقاف وتعطيل العضو "${name}" نهائياً؟`)) return;
    try {
      await updateDoc(doc(db, 'users', userId), { isDeleted: true });
      setTeamMembers(prev => prev.filter(m => m.id !== userId));
      setAlertMessage({ title: 'تم إيقاف الحساب', message: `تم تعطيل حساب العضو "${name}" وإزالته من قوائم الفريق النشط بنجاح.` });
    } catch (error: any) {
      console.error("Delete user error:", error);
      alert("عذراً، فشل تعطيل الحساب. تأكد من اتصالك بالإنترنت.");
    }
  };

  const handleSaveWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspaceName.trim()) return;
    try {
      const data = {
        name: newWorkspaceName,
        members: selectedMembers,
        supervisors: selectedSupervisors,
        updatedAt: new Date(),
      };
      if (editingWorkspace) {
        await updateDoc(doc(db, 'workspaces', editingWorkspace.id), data);
        setAlertMessage({ title: 'تم التعديل', message: 'تم تحديث بيانات مساحة العمل بنجاح.' });
      } else {
        await addDoc(collection(db, 'workspaces'), {
          ...data,
          createdAt: new Date(),
          createdBy: auth.currentUser?.uid || '',
        });
        setAlertMessage({ title: 'تم الإنشاء', message: 'تم إنشاء مساحة العمل بنجاح.' });
      }
      // Reset form
      setNewWorkspaceName('');
      setSelectedMembers([]);
      setSelectedSupervisors([]);
      setEditingWorkspace(null);
      setIsWorkspaceModalOpen(false);
    } catch (err: any) {
      console.error(err);
      alert("حدث خطأ أثناء حفظ مساحة العمل.");
    }
  };

  const deleteWorkspace = async (workspaceId: string, name: string) => {
    if (!window.confirm(`⚠️ هل أنت متأكد من حذف مساحة العمل "${name}" نهائياً؟`)) return;
    try {
      await deleteDoc(doc(db, 'workspaces', workspaceId));
      setAlertMessage({ title: 'تم الحذف', message: `تم حذف مساحة العمل "${name}" بنجاح.` });
    } catch (err: any) {
      console.error(err);
      alert("عذراً، فشل حذف مساحة العمل.");
    }
  };

  const getAssigneeName = (task: any) => {
    const currentStage = task.pipeline?.find((p: any) => p.stage === task.currentStage);
    if (!currentStage) return 'غير محدد';
    if (!currentStage.assigneeId) return `أي ${roleMap[currentStage.role] || currentStage.role} متاح`;
    const member = teamMembers.find(m => m.id === currentStage.assigneeId);
    return member ? member.name : 'موظف غير معروف';
  };

  // ─────────────────────────────────────────
  // Dashboard View
  // ─────────────────────────────────────────
  const getDaysPending = (createdAt: any) => {
    if (!createdAt) return 'اليوم';
    const dateObj = createdAt.seconds ? new Date(createdAt.seconds * 1000) : new Date(createdAt);
    const diffTime = Math.abs(Date.now() - dateObj.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'اليوم';
    if (diffDays === 1) return 'منذ يوم';
    if (diffDays === 2) return 'منذ يومين';
    return `منذ ${diffDays} أيام`;
  };

  const getMemberMonthlyStats = (memberId: string) => {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0,0,0,0);
    
    const memberTasks = filteredTasks.filter(t => {
      const isAssigned = t.pipeline?.some((p: any) => p.assigneeId === memberId);
      if (!isAssigned) return false;
      
      const taskDate = t.createdAt?.seconds ? new Date(t.createdAt.seconds * 1000) : new Date(t.createdAt);
      return taskDate >= startOfMonth;
    });
    
    const completed = memberTasks.filter(t => t.status === 'Completed').length;
    return { total: memberTasks.length, completed };
  };

  // ─────────────────────────────────────────
  // Dashboard View
  // ─────────────────────────────────────────
  const DashboardView = () => (
    <>
      <header className="flex flex-col lg:flex-row-reverse lg:items-center justify-between mb-10 gap-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-black text-meta-textDark">مرحباً بك مجدداً، أستاذ {userName}</h1>
          <p className="text-meta-textGray text-lg mt-2">إليك ملخص سريع لأداء الوكالة والمهام الحالية.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-meta-blue text-white px-8 py-4 rounded-2xl font-black text-lg shadow-xl shadow-meta-blue/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3"
        >
          <Plus className="w-6 h-6" /> إنشاء مهمة جديدة
        </button>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
        {[
          { title: 'المهام النشطة', value: filteredTasks.filter(t => t.status !== 'Completed').length.toString(), icon: Activity, color: 'text-zamam-primary', bg: 'bg-teal-50' },
          { title: 'بانتظار الموافقة', value: filteredTasks.filter(t => t.status === 'PendingReview').length.toString(), icon: Clock, color: 'text-orange-500', bg: 'bg-orange-50' },
          { title: 'اكتملت اليوم', value: filteredTasks.filter(t => t.status === 'Completed' && t.completedAt && new Date(t.completedAt).toDateString() === new Date().toDateString()).length.toString(), icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-50' },
          { title: 'أعضاء الفريق', value: filteredTeamMembers.length.toString(), icon: Users, color: 'text-purple-500', bg: 'bg-purple-50' },
        ].map((kpi, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm hover:shadow-md transition-all group">
            <div className="flex justify-between items-start mb-6 flex-row-reverse">
              <div className={`p-4 rounded-2xl ${kpi.bg} group-hover:scale-110 transition-transform`}>
                <kpi.icon className={`w-7 h-7 ${kpi.color}`} />
              </div>
            </div>
            <h3 className="text-4xl font-black text-meta-textDark mb-2">{kpi.value}</h3>
            <p className="text-sm font-bold text-meta-textGray">{kpi.title}</p>
          </motion.div>
        ))}
      </div>

      {/* Dashboard Mode Switcher */}
      <div className="flex bg-white p-1.5 rounded-2xl shadow-sm border border-gray-100 max-w-md mb-8 flex-row-reverse">
        <button 
          onClick={() => setDashboardViewMode('tasks')}
          className={`flex-1 py-3 text-sm font-black rounded-xl transition-all ${
            dashboardViewMode === 'tasks' ? 'bg-zamam-primary text-white shadow-lg shadow-zamam-primary/20' : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          🗂️ المهام النشطة
        </button>
        <button 
          onClick={() => setDashboardViewMode('performance')}
          className={`flex-1 py-3 text-sm font-black rounded-xl transition-all ${
            dashboardViewMode === 'performance' ? 'bg-zamam-primary text-white shadow-lg shadow-zamam-primary/20' : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          📊 أداء الأعضاء هذا الشهر
        </button>
      </div>

      <AnimatePresence mode="wait">
        {dashboardViewMode === 'tasks' ? (
          <motion.div 
            key="tasks-view"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden"
          >
            <div className="p-8 border-b border-gray-50 flex justify-between items-center flex-row-reverse">
              <h2 className="text-2xl font-black text-meta-textDark">آخر المهام</h2>
              <button className="text-zamam-primary font-bold hover:underline underline-offset-4">عرض الكل</button>
            </div>
            <div className="divide-y divide-gray-50">
              {filteredTasks.length > 0 ? filteredTasks.map((task, i) => (
                <div key={task.id} className="flex flex-col sm:flex-row-reverse sm:items-center sm:justify-between p-6 hover:bg-gray-50/50 transition-colors gap-4 sm:gap-0">
                  <div className="flex items-center gap-4 flex-row-reverse text-right">
                    <div className="w-10 h-10 rounded-2xl bg-zamam-primary/10 text-zamam-primary flex items-center justify-center font-black text-sm shrink-0">{i+1}</div>
                    <div>
                      <h3 className="font-black text-meta-textDark text-lg">{task.title}</h3>
                      <p className="text-xs font-bold text-meta-textGray mt-1 flex flex-wrap gap-2 items-center flex-row-reverse">
                        <span>المسند إلى: <span className="text-zamam-primary font-black">{getAssigneeName(task)}</span></span>
                        <span className="text-gray-300">•</span>
                        <span>الأولوية: <span className="font-black">{task.priority === 'High' ? 'عالية' : task.priority === 'Medium' ? 'متوسطة' : 'منخفضة'}</span></span>
                        <span className="text-gray-300">•</span>
                        <span className="px-2 py-0.5 bg-orange-50 text-orange-600 rounded-lg text-[10px] font-black">{getDaysPending(task.createdAt)}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-row-reverse justify-end sm:justify-start w-full sm:w-auto shrink-0">
                    <span className={`px-4 py-2 rounded-xl text-xs font-black ${task.status === 'Completed' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                      {task.status === 'Completed' ? 'مكتملة' : 'قيد التنفيذ'}
                    </span>
                    <button 
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (window.confirm("⚠️ هل أنت متأكد من حذف هذه المهمة نهائياً؟")) {
                          deleteTask(task.id);
                        }
                      }} 
                      className="flex items-center gap-2 px-4 py-2 bg-red-50 hover:bg-red-500 hover:text-white rounded-2xl text-red-600 transition-all font-black text-sm group shadow-sm"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>حذف المهمة</span>
                    </button>
                  </div>
                </div>
              )) : (
                <div className="p-20 text-center text-meta-textGray font-bold bg-gray-50 rounded-[2.5rem] border-2 border-dashed border-gray-200">
                  <Clock className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                  لا توجد مهام نشطة حالياً. ابدأ بإضافة مهمة جديدة!
                </div>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div 
            key="performance-view"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {filteredTeamMembers.map((member) => {
              const stats = getMemberMonthlyStats(member.id);
              const percent = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
              return (
                <div key={member.id} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm text-right flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-3 flex-row-reverse mb-6">
                      <div className="w-10 h-10 rounded-2xl bg-zamam-primary/10 text-zamam-primary flex items-center justify-center font-black text-sm uppercase shrink-0">{member.name.charAt(0)}</div>
                      <div className="text-right">
                        <h4 className="font-black text-meta-textDark text-base leading-tight">{member.name}</h4>
                        <p className="text-[10px] font-black text-zamam-primary mt-1">{member.role}</p>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="flex justify-between text-xs font-bold text-meta-textGray flex-row-reverse">
                        <span>المهام المنجزة هذا الشهر</span>
                        <span className="font-black text-meta-textDark">{stats.completed} من {stats.total}</span>
                      </div>
                      <div className="w-full bg-gray-50 h-2.5 rounded-full overflow-hidden">
                        <div className="bg-green-500 h-full rounded-full transition-all duration-500" style={{ width: `${percent}%` }} />
                      </div>
                    </div>
                  </div>
                  <p className="text-[10px] font-black text-green-600 text-left mt-4">{percent}% نسبة الإنجاز</p>
                </div>
              );
            })}
            {filteredTeamMembers.length === 0 && (
              <div className="col-span-full p-20 text-center text-meta-textGray font-bold bg-white rounded-[2.5rem] border border-gray-100">
                لا يوجد أعضاء فريق مسجلين حالياً.
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );

  // ─────────────────────────────────────────
  // Team Management View
  // ─────────────────────────────────────────
  const TeamView = () => (
    <>
      <header className="flex flex-col lg:flex-row-reverse lg:items-center justify-between mb-10 gap-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-black text-meta-textDark">إدارة الفريق</h1>
          <p className="text-meta-textGray text-lg mt-2">أضف أو عدّل بيانات أعضاء فريق العمل وأدوارهم.</p>
        </div>
        <button 
          onClick={() => setIsUserModalOpen(true)}
          className="bg-zamam-primary text-white px-8 py-4 rounded-2xl font-black text-lg shadow-xl shadow-zamam-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3"
        >
          <UserPlus className="w-6 h-6" /> إضافة عضو جديد
        </button>
      </header>

      <div className="bg-white rounded-[2rem] md:rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden">
        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-gray-50/50 text-meta-textGray text-sm">
                <th className="p-6 font-black">العضو</th>
                <th className="p-6 font-black">الدور الوظيفي</th>
                <th className="p-6 font-black">البريد الإلكتروني</th>
                <th className="p-6 font-black">المهام</th>
                <th className="p-6 font-black">الحالة</th>
                <th className="p-6 font-black">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredTeamMembers.map((user, i) => (
                <tr key={user.id || i} className="hover:bg-gray-50/50 transition-colors">
                  <td className="p-6">
                    <div className="flex items-center gap-4 justify-end">
                      <p className="font-black text-lg text-meta-textDark">{user.name}</p>
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-zamam-primary to-zamam-navy text-white flex items-center justify-center font-black text-xl shadow-sm">{user.name.charAt(0)}</div>
                    </div>
                  </td>
                  <td className="p-6"><span className="px-4 py-2 bg-zamam-light/50 rounded-xl text-zamam-textDark font-bold text-xs border border-zamam-primary/10">{user.role}</span></td>
                  <td className="p-6 text-meta-textGray font-bold text-sm">{user.email}</td>
                  <td className="p-6 font-black text-lg">{user.tasks}</td>
                  <td className="p-6">
                    <span className={`flex items-center gap-2 text-xs font-black justify-end ${user.status === 'متصل' ? 'text-green-600' : 'text-gray-400'}`}>
                      {user.status}
                      <span className={`w-3 h-3 rounded-full ${user.status === 'متصل' ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`}></span>
                    </span>
                  </td>
                  <td className="p-6">
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => setUserToEdit(user)} className="p-2 hover:bg-teal-50 rounded-xl text-zamam-primary transition-colors"><Edit3 className="w-4 h-4" /></button>
                      <button onClick={() => deleteTeamMember(user.id, user.name)} className="p-2 hover:bg-red-50 rounded-xl text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards */}
        <div className="md:hidden divide-y divide-gray-100">
          {filteredTeamMembers.map((user, i) => (
            <div key={user.id || i} className="p-5">
              <div className="flex items-center gap-4 justify-end mb-4">
                <div className="flex-1 text-right">
                  <p className="font-black text-lg text-meta-textDark">{user.name}</p>
                  <p className="text-xs font-bold text-meta-textGray">{user.email}</p>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-zamam-primary to-zamam-navy text-white flex items-center justify-center font-black text-xl shrink-0">{user.name.charAt(0)}</div>
              </div>
              <div className="flex items-center justify-between flex-row-reverse">
                <div className="flex items-center gap-3 flex-row-reverse">
                  <span className="px-3 py-1.5 bg-zamam-light/50 rounded-lg text-zamam-textDark font-bold text-xs border border-zamam-primary/10">{user.role}</span>
                  <span className={`flex items-center gap-1.5 text-xs font-bold ${user.status === 'متصل' ? 'text-green-600' : 'text-gray-400'}`}>
                    <span className={`w-2 h-2 rounded-full ${user.status === 'متصل' ? 'bg-green-500' : 'bg-gray-300'}`}></span>
                    {user.status}
                  </span>
                  <span className="text-xs font-bold text-meta-textGray">{user.tasks} مهام</span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setUserToEdit(user)} className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-teal-50 rounded-xl text-zamam-primary"><Edit3 className="w-5 h-5" /></button>
                  <button onClick={() => deleteTeamMember(user.id, user.name)} className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-red-50 rounded-xl text-red-500"><Trash2 className="w-5 h-5" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );

  // ─────────────────────────────────────────
  // Analytics View
  // ─────────────────────────────────────────
  const AnalyticsView = () => (
    <>
      <header className="mb-10">
        <h1 className="text-3xl md:text-4xl font-black text-meta-textDark">تحليل الأداء</h1>
        <p className="text-meta-textGray text-lg mt-2">تتبع أداء الفريق والإنتاجية بشكل تفصيلي.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        {[
          { title: 'معدل الإنجاز', value: tasks.length > 0 ? Math.round((tasks.filter(t => t.status === 'Completed').length / tasks.length) * 100) + '%' : '0%', icon: TrendingUp, color: 'text-green-500', bg: 'bg-green-50', desc: 'استناداً للمهام الحالية' },
          { title: 'متوسط وقت المهمة', value: '0 يوم', icon: Clock, color: 'text-orange-500', bg: 'bg-orange-50', desc: 'لا توجد بيانات كافية' },
          { title: 'مهام هذا الشهر', value: tasks.length.toString(), icon: BarChart3, color: 'text-zamam-primary', bg: 'bg-teal-50', desc: 'إجمالي المهام المسجلة' },
        ].map((stat, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm">
            <div className={`p-4 rounded-2xl ${stat.bg} w-fit mb-6`}>
              <stat.icon className={`w-7 h-7 ${stat.color}`} />
            </div>
            <h3 className="text-4xl font-black text-meta-textDark mb-2">{stat.value}</h3>
            <p className="font-bold text-meta-textDark mb-1">{stat.title}</p>
            <p className="text-sm text-green-500 font-bold">↑ {stat.desc}</p>
          </motion.div>
        ))}
      </div>

      {/* Per-member performance */}
      <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm p-8">
        <h2 className="text-2xl font-black text-meta-textDark mb-8">أداء الأعضاء</h2>
        <div className="space-y-6">
          {teamMembers.length > 0 ? teamMembers.map((member, i) => {
            const memberTasks = tasks.filter((t: any) => {
              const currentStage = t.pipeline?.find((p: any) => p.stage === t.currentStage);
              return currentStage?.assigneeId === member.id;
            });
            const completedCount = memberTasks.filter(t => t.status === 'Completed').length;
            const totalCount = memberTasks.length;
            const percentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

            return (
              <div key={member.id} className="flex items-center gap-6 flex-row-reverse">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-zamam-primary to-zamam-navy text-white flex items-center justify-center font-black text-lg shrink-0">{member.name.charAt(0)}</div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-2 flex-row-reverse">
                    <p className="font-black text-meta-textDark">{member.name}</p>
                    <p className="text-sm font-bold text-meta-textGray">{completedCount} / {totalCount} مهمة</p>
                  </div>
                  <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${percentage}%` }} transition={{ duration: 1, delay: i * 0.1 }} className="h-full bg-gradient-to-l from-zamam-primary to-zamam-teal rounded-full" />
                  </div>
                </div>
                <span className="text-lg font-black text-zamam-primary shrink-0">{percentage}%</span>
              </div>
            );
          }) : (
            <div className="text-center text-zamam-textGray font-bold">لا يوجد أعضاء مضافين بعد</div>
          )}
        </div>
      </div>
    </>
  );

  // ─────────────────────────────────────────
  // Settings View
  // ─────────────────────────────────────────
  const SettingsView = () => (
    <>
      <header className="mb-10">
        <h1 className="text-3xl md:text-4xl font-black text-meta-textDark">الإعدادات العامة</h1>
        <p className="text-meta-textGray text-lg mt-2">تخصيص إعدادات النظام والتكاملات الخارجية.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {[
          { id: 'security', icon: Shield, title: 'إعدادات الأمان', desc: 'إدارة كلمات المرور والصلاحيات وعمليات التحقق.', color: 'text-red-500', bg: 'bg-red-50' },
          { id: 'drive', icon: Globe, title: isDriveConnected ? 'Google Drive (متصل)' : 'ربط Google Drive', desc: 'تفعيل الإنشاء التلقائي للمجلدات عند إنشاء مهمة.', color: isDriveConnected ? 'text-green-500' : 'text-zamam-primary', bg: isDriveConnected ? 'bg-green-50' : 'bg-teal-50' },
          { id: 'roles', icon: Users, title: 'إدارة أدوار الفريق', desc: 'إضافة وتعديل وحذف الأدوار الوظيفية المخصصة في النظام.', color: 'text-blue-500', bg: 'bg-blue-50' },
          { id: 'notifications', icon: Bell, title: 'إعدادات الإشعارات', desc: 'التحكم في إشعارات البريد والتطبيق للفريق.', color: 'text-orange-500', bg: 'bg-orange-50' },
          { id: 'ui', icon: Palette, title: 'تخصيص الواجهة', desc: 'تغيير الألوان والشعارات ونمط العرض.', color: 'text-purple-500', bg: 'bg-purple-50' },
        ].map((setting, i) => (
          <motion.div 
            key={i} 
            initial={{ opacity: 0, y: 20 }} 
            animate={{ opacity: 1, y: 0 }} 
            transition={{ delay: i * 0.1 }} 
            onClick={() => {
              if (setting.id === 'drive') {
                connectDrive();
              } else if (setting.id === 'roles') {
                setIsRolesModalOpen(true);
              } else {
                setAlertMessage({ title: setting.title, message: 'هذه الإعدادات سيتم تفعيلها في التحديث القادم.' });
              }
            }}
            className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm hover:shadow-md transition-all cursor-pointer group"
          >
            <div className="flex items-start gap-5 flex-row-reverse">
              <div className={`p-4 rounded-2xl ${setting.bg} group-hover:scale-110 transition-transform shrink-0`}>
                <setting.icon className={`w-7 h-7 ${setting.color}`} />
              </div>
              <div className="text-right flex-1">
                <h3 className="text-xl font-black text-meta-textDark mb-2 group-hover:text-meta-blue transition-colors">{setting.title}</h3>
                <p className="text-meta-textGray font-bold text-sm leading-relaxed">{setting.desc}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm p-8 mt-8">
        <h2 className="text-2xl font-black text-meta-textDark mb-6">معلومات النظام</h2>
        <div className="space-y-4 text-right">
          {[
            { label: 'إصدار النظام', value: 'v0.1' },
            { label: 'المطور', value: 'Mahmoud Walid' },
            { label: 'آخر تحديث', value: '18 يوليو 2026' },
            { label: 'حالة Firebase', value: 'مفعّل ✅' },
            { label: 'حالة Google Drive', value: isDriveConnected ? 'مفعّل ✅' : 'غير مفعّل' },
          ].map((info, i) => (
            <div key={i} className="flex items-center justify-between py-4 border-b border-gray-50 last:border-0 flex-row-reverse">
              <span className="font-black text-meta-textDark">{info.label}</span>
              <span className="font-bold text-meta-textGray text-sm bg-gray-50 px-4 py-2 rounded-xl">{info.value}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );

  // ─────────────────────────────────────────
  // Workspaces View
  // ─────────────────────────────────────────
  const WorkspacesView = () => {
    return (
      <>
        <header className="flex flex-col lg:flex-row-reverse lg:items-center justify-between mb-10 gap-6">
          <div>
            <h1 className="text-3xl md:text-4xl font-black text-meta-textDark">مساحات العمل</h1>
            <p className="text-meta-textGray text-lg mt-2">إدارة وتنظيم فرق العمل والمهام المشتركة.</p>
          </div>
          {userRole !== 'Manager' && (
            <button 
              onClick={() => {
                setEditingWorkspace(null);
                setNewWorkspaceName('');
                setSelectedMembers([]);
                setSelectedSupervisors([]);
                setIsWorkspaceModalOpen(true);
              }}
              className="bg-zamam-primary text-white px-8 py-4 rounded-2xl font-black text-lg shadow-xl shadow-zamam-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3"
            >
              <Plus className="w-6 h-6" /> إنشاء مساحة عمل
            </button>
          )}
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredWorkspaces.map((w) => {
            const wTasks = filteredTasks.filter(t => t.workspaceId === w.id);
            const activeWTasks = wTasks.filter(t => t.status !== 'Completed').length;
            const completedWTasks = wTasks.filter(t => t.status === 'Completed').length;
            
            // Map supervisor names
            const supervisorNames = w.supervisors
              ?.map((id: string) => teamMembers.find(m => m.id === id)?.name)
              .filter(Boolean)
              .join('، ') || 'لا يوجد مشرفين';

            return (
              <div key={w.id} className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-gray-100 shadow-sm text-right flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-start flex-row-reverse mb-6">
                    <h3 className="text-2xl font-black text-meta-textDark">{w.name}</h3>
                    {userRole !== 'Manager' && (
                      <div className="flex items-center gap-1">
                        <button 
                          onClick={() => {
                            setEditingWorkspace(w);
                            setNewWorkspaceName(w.name);
                            setSelectedMembers(w.members || []);
                            setSelectedSupervisors(w.supervisors || []);
                            setIsWorkspaceModalOpen(true);
                          }}
                          className="p-2 hover:bg-teal-50 rounded-xl text-zamam-primary transition-colors"
                        >
                          <Edit3 className="w-5 h-5" />
                        </button>
                        <button 
                          onClick={() => deleteWorkspace(w.id, w.name)}
                          className="p-2 hover:bg-red-50 rounded-xl text-red-500 transition-colors"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="space-y-4 mb-8">
                    <div className="flex justify-between text-sm flex-row-reverse">
                      <span className="font-black text-meta-textGray">المشرفين:</span>
                      <span className="font-bold text-meta-textDark">{supervisorNames}</span>
                    </div>

                    <div className="flex justify-between text-sm flex-row-reverse">
                      <span className="font-black text-meta-textGray">الأعضاء:</span>
                      <span className="font-bold text-meta-textDark">{(w.members?.length || 0) + (w.supervisors?.length || 0)} أعضاء</span>
                    </div>

                    <div className="flex justify-between text-sm flex-row-reverse">
                      <span className="font-black text-meta-textGray">حالة المهام:</span>
                      <span className="font-bold text-meta-textDark">{activeWTasks} نشطة / {completedWTasks} منجزة</span>
                    </div>
                  </div>
                </div>

                <div className="pt-6 border-t border-gray-50 flex items-center justify-between flex-row-reverse">
                  <span className="text-[10px] font-bold text-meta-textGray">
                    أنشئت بتاريخ: {w.createdAt?.seconds ? new Date(w.createdAt.seconds * 1000).toLocaleDateString('ar-EG') : new Date().toLocaleDateString('ar-EG')}
                  </span>
                  <div className="w-8 h-8 rounded-full bg-zamam-primary/10 text-zamam-primary flex items-center justify-center font-bold text-xs">
                    <Globe className="w-4 h-4" />
                  </div>
                </div>
              </div>
            );
          })}

          {filteredWorkspaces.length === 0 && (
            <div className="col-span-full py-20 text-center bg-white rounded-[2.5rem] border border-gray-100 shadow-sm">
              <Globe className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-meta-textDark mb-2">لا توجد مساحات عمل</h3>
              <p className="text-meta-textGray font-bold text-sm">مساحات العمل تساعدك في تنظيم الفرق وتعيين المشرفين لمتابعة المهام.</p>
            </div>
          )}
        </div>
      </>
    );
  };

  // ─────────────────────────────────────────
  // Render the active page
  // ─────────────────────────────────────────
  const renderPage = () => {
    switch (activePage) {
      case 'dashboard': return <DashboardView />;
      case 'team': return <TeamView />;
      case 'workspaces': return <WorkspacesView />;
      case 'analytics': 
        if (userRole === 'Manager') return <DashboardView />;
        return <AnalyticsView />;
      case 'settings': 
        if (userRole === 'Manager') return <DashboardView />;
        return <SettingsView />;
    }
  };

  return (
    <div className="min-h-screen min-h-[100dvh] bg-[#F8FAFC] flex flex-col md:flex-row-reverse font-['Cairo']">
      
      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40 flex justify-around items-center px-1 py-2 shadow-[0_-4px_20px_rgba(0,0,0,0.08)]" style={{ paddingBottom: 'env(safe-area-inset-bottom, 8px)' }}>
        {sidebarItems.map((item, i) => (
          <button key={i} onClick={() => setActivePage(item.key)}
            className={`flex flex-col items-center gap-1 p-1 rounded-2xl min-w-[45px] transition-all ${activePage === item.key ? 'text-zamam-primary' : 'text-gray-400'}`}>
            <item.icon className="w-5 h-5" />
            <span className="text-[9px] font-bold leading-tight">{item.label}</span>
          </button>
        ))}
        <button onClick={() => navigate('/workspace')} className="flex flex-col items-center gap-1 p-1 rounded-2xl min-w-[45px] text-gray-400 hover:text-zamam-primary">
          <FolderDown className="w-5 h-5" />
          <span className="text-[9px] font-bold leading-tight">مساحتي</span>
        </button>
        <button onClick={() => { auth.signOut(); navigate('/'); }} className="flex flex-col items-center gap-1 p-1 rounded-2xl min-w-[45px] text-red-400">
          <LogOut className="w-5 h-5" />
          <span className="text-[9px] font-bold leading-tight">خروج</span>
        </button>
      </nav>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-72 bg-white border-l border-gray-200 flex-col relative z-30">
        <div className="flex p-8 border-b border-gray-100 items-center gap-4 justify-end">
          <div className="text-right">
            <h1 className="font-black text-xl text-zamam-textDark leading-tight">زمام | ZAMAM</h1>
            <p className="text-xs font-bold text-zamam-primary">{getRoleName(userRole)} - {userName}</p>
          </div>
          <div className="p-2 bg-zamam-light rounded-xl">
            <img src={zamamIcon} alt="ZAMAM" className="w-10 h-10 object-contain" />
          </div>
        </div>
        <div className="flex-1 flex flex-col p-4 gap-2">
          {sidebarItems.map((item, i) => (
            <button key={i} onClick={() => setActivePage(item.key)}
              className={`flex items-center gap-4 p-4 rounded-2xl transition-all font-bold justify-end group ${activePage === item.key ? 'bg-zamam-primary text-white shadow-lg shadow-zamam-primary/20' : 'text-zamam-textGray hover:bg-zamam-light hover:text-zamam-textDark'}`}>
              <span>{item.label}</span>
              <item.icon className={`w-5 h-5 shrink-0 ${activePage === item.key ? 'text-white' : 'group-hover:text-zamam-primary'}`} />
            </button>
          ))}
        </div>
        <div className="p-6 border-t border-gray-100 space-y-2">
          <button onClick={() => navigate('/workspace')} className="flex items-center gap-4 p-4 w-full text-zamam-textGray hover:bg-zamam-light hover:text-zamam-primary rounded-2xl transition-all font-bold justify-end group">
            <span>مساحتي الخاصة</span>
            <FolderDown className="w-5 h-5 group-hover:text-zamam-primary" />
          </button>
          <button onClick={() => { auth.signOut(); navigate('/'); }} className="flex items-center gap-4 p-4 w-full text-red-500 hover:bg-red-50 rounded-2xl transition-all font-black justify-end">
            <span>تسجيل الخروج</span>
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-4 sm:p-6 md:p-10 pb-28 md:pb-10 min-h-screen md:h-screen overflow-y-auto text-right">
        
        {/* Top Bar */}
        <div className="flex items-center justify-between mb-6 md:mb-10 bg-white p-3 md:p-4 rounded-2xl md:rounded-3xl shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 md:gap-4">
            <button className="p-2 md:p-3 bg-gray-50 rounded-xl md:rounded-2xl hover:bg-gray-100 relative">
              <Bell className="w-5 h-5 text-gray-500" />
              <span className="absolute top-2 right-2 md:top-3 md:right-3 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
            </button>
            <div className="w-9 h-9 md:w-10 md:h-10 rounded-xl md:rounded-2xl bg-zamam-primary text-white flex items-center justify-center font-bold text-sm uppercase">{userName.charAt(0)}</div>
          </div>
          <div className="relative flex-1 max-w-md mr-3 md:mr-0">
            <Search className="absolute right-3 md:right-4 top-1/2 -translate-y-1/2 w-4 md:w-5 h-4 md:h-5 text-gray-400" />
            <input type="text" placeholder="ابحث..." className="w-full pr-10 md:pr-12 pl-4 py-2.5 md:py-3 bg-gray-50 border-none rounded-xl md:rounded-2xl outline-none text-sm font-bold" />
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={activePage} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -15 }} transition={{ duration: 0.25 }}>
            {renderPage()}
          </motion.div>
        </AnimatePresence>

        <footer className="mt-12 md:mt-16 py-6 md:py-10 text-center border-t border-gray-100 flex flex-col gap-1 items-center justify-center text-gray-400 font-bold text-xs md:text-sm">
          <p>نظام زمام | ZAMAM System © 2026</p>
        </footer>
      </main>

      <TaskCreationModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        teamMembers={teamMembers}
        onSubmit={async (data) => {
          try {
             let finalData = { ...data };
             if (isDriveConnected) {
               const folderResult = await GoogleDriveService.createFolder(data.title);
               if (folderResult.success && folderResult.folderUrl) {
                 finalData.fileLink = folderResult.folderUrl;
                 finalData.driveFolderId = folderResult.folderId;
               }
             }
             await addDoc(collection(db, 'tasks'), finalData);
             setIsModalOpen(false);
             // Re-fetch tasks
             const tasksSnapshot = await getDocs(collection(db, 'tasks'));
             setTasks(tasksSnapshot.docs.map(d => ({ id: d.id, ...d.data() })));
             setAlertMessage({ title: 'تمت الإضافة بنجاح', message: 'تم إنشاء المهمة وإضافتها للنظام وتوجيهها للموظف المعني بنجاح.' });
          } catch(err: any) {
             console.error(err);
             setAlertMessage({ title: 'خطأ', message: 'حدث خطأ أثناء إنشاء المهمة.' });
          }
        }} 
      />
      
      {isUserModalOpen && (
        <UserCreationModal 
          isOpen={isUserModalOpen} 
          onClose={() => setIsUserModalOpen(false)} 
          onUserCreated={() => {
            // Re-fetch users
            getDocs(collection(db, 'users')).then(snapshot => {
              const members = snapshot.docs
                .filter(d => d.data().isDeleted !== true)
                .map(d => ({
                  id: d.id,
                  name: d.data().displayName || d.data().email?.split('@')[0] || 'مستخدم',
                  email: d.data().email,
                  role: getRoleName(d.data().role),
                  rawRole: d.data().role || 'Creator',
                  tasks: 0,
                  status: 'متصل'
                }));
              setTeamMembers(members);
            });
          }} 
        />
      )}
      
      {userToEdit && (
        <UserEditModal 
          isOpen={!!userToEdit} 
          onClose={() => setUserToEdit(null)} 
          userToEdit={userToEdit}
          onUserEdited={() => {
            // Re-fetch users
            getDocs(collection(db, 'users')).then(snapshot => {
              const members = snapshot.docs
                .filter(d => d.data().isDeleted !== true)
                .map(d => ({
                  id: d.id,
                  name: d.data().displayName || d.data().email?.split('@')[0] || 'مستخدم',
                  email: d.data().email,
                  role: getRoleName(d.data().role),
                  rawRole: d.data().role || 'Creator',
                  tasks: 0,
                  status: 'متصل'
                }));
              setTeamMembers(members);
            });
          }} 
        />
      )}

      {isRolesModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zamam-navy/40 backdrop-blur-sm font-['Cairo']">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }} 
            animate={{ opacity: 1, scale: 1 }} 
            exit={{ opacity: 0, scale: 0.95 }} 
            className="bg-white w-full max-w-md rounded-[2rem] shadow-2xl p-6 md:p-8 text-right relative overflow-hidden"
          >
            <button onClick={() => setIsRolesModalOpen(false)} className="absolute left-6 top-6 text-gray-400 hover:text-gray-600 transition-colors">
              <X className="w-6 h-6" />
            </button>
            <h3 className="text-2xl font-black text-meta-textDark mb-6">إدارة أدوار الفريق</h3>
            
            <div className="flex gap-2 mb-6 flex-row-reverse">
              <input 
                type="text" 
                placeholder="اسم الدور الجديد..." 
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
                className="flex-1 px-4 py-3 bg-gray-50 border-2 border-transparent focus:bg-white focus:border-zamam-primary rounded-xl outline-none text-right font-bold text-sm"
              />
              <button 
                onClick={async () => {
                  if (!newRoleName.trim()) return;
                  const roleId = `custom_role_${Date.now()}`;
                  try {
                    await setDoc(doc(db, 'roles', roleId), { name: newRoleName, isSystem: false });
                    setNewRoleName('');
                    const list = await fetchRoles();
                    
                    const rMap: Record<string, string> = {};
                    list.forEach((r: any) => {
                      rMap[r.id] = r.name;
                    });
                    setTeamMembers(prev => prev.map(m => ({
                      ...m,
                      role: rMap[m.rawRole] || m.rawRole
                    })));

                    setAlertMessage({ title: 'نجاح', message: 'تمت إضافة الدور الجديد بنجاح.' });
                  } catch (err) {
                    console.error("Error creating role:", err);
                    setAlertMessage({ title: 'خطأ', message: 'فشل إنشاء الدور.' });
                  }
                }}
                className="px-5 py-3 bg-zamam-primary text-white font-bold rounded-xl hover:bg-zamam-primary/95 transition-all text-sm shrink-0 flex items-center gap-1"
              >
                <Plus className="w-4 h-4" /> إضافة
              </button>
            </div>
            
            <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
              {roles.map((role) => (
                <div key={role.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100 flex-row-reverse">
                  <span className="font-bold text-meta-textDark text-sm">{role.name}</span>
                  {!role.isSystem ? (
                    <button 
                      onClick={async () => {
                        try {
                          await deleteDoc(doc(db, 'roles', role.id));
                          const list = await fetchRoles();
                          
                          const rMap: Record<string, string> = {};
                          list.forEach((r: any) => {
                            rMap[r.id] = r.name;
                          });
                          setTeamMembers(prev => prev.map(m => ({
                            ...m,
                            role: rMap[m.rawRole] || m.rawRole
                          })));

                          setAlertMessage({ title: 'نجاح', message: 'تم حذف الدور بنجاح.' });
                        } catch (err) {
                          console.error("Error deleting role:", err);
                          setAlertMessage({ title: 'خطأ', message: 'فشل حذف الدور.' });
                        }
                      }}
                      className="text-red-500 hover:bg-red-50 p-2 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  ) : (
                    <span className="text-xs font-bold text-gray-400 bg-gray-100 px-2.5 py-1 rounded-md">أساسي</span>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      )}

      {/* Workspace Creation/Edit Modal */}
      <AnimatePresence>
        {isWorkspaceModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zamam-navy/40 backdrop-blur-sm font-['Cairo']">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.95 }} 
              className="bg-white w-full max-w-md rounded-[2rem] shadow-2xl p-6 md:p-8 text-right relative overflow-hidden flex flex-col max-h-[90vh]"
            >
              <button 
                onClick={() => {
                  setIsWorkspaceModalOpen(false);
                  setEditingWorkspace(null);
                  setNewWorkspaceName('');
                  setSelectedMembers([]);
                  setSelectedSupervisors([]);
                }} 
                className="absolute left-6 top-6 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
              <h3 className="text-2xl font-black text-meta-textDark mb-2">
                {editingWorkspace ? 'تعديل مساحة العمل' : 'إنشاء مساحة عمل جديدة'}
              </h3>
              <p className="text-sm font-bold text-meta-textGray mb-6">قم بتنظيم فريق عملك وتعيين المشرفين.</p>

              <form onSubmit={handleSaveWorkspace} className="space-y-4 flex-1 overflow-y-auto pr-1">
                <div>
                  <label className="block text-xs font-bold text-zamam-textDark text-right mb-1">اسم مساحة العمل</label>
                  <input 
                    type="text" required
                    placeholder="مثال: فريق عمل نافس"
                    value={newWorkspaceName}
                    onChange={(e) => setNewWorkspaceName(e.target.value)}
                    className="w-full px-4 py-3 bg-gray-50 border-2 border-transparent focus:bg-white focus:border-zamam-primary rounded-xl outline-none text-right font-bold text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-zamam-textDark text-right mb-1">تعيين المشرفين (المسؤولين عن المتابعة)</label>
                  <div className="max-h-36 overflow-y-auto space-y-2 border border-gray-100 rounded-xl p-3 text-right custom-scrollbar">
                    {teamMembers.map(member => (
                      <label key={member.id} className="flex items-center gap-2 justify-end cursor-pointer">
                        <span className="text-xs font-bold text-meta-textDark">{member.name} ({member.role})</span>
                        <input 
                          type="checkbox"
                          checked={selectedSupervisors.includes(member.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedSupervisors([...selectedSupervisors, member.id]);
                            } else {
                              setSelectedSupervisors(selectedSupervisors.filter(id => id !== member.id));
                            }
                          }}
                          className="rounded border-gray-300 text-zamam-primary focus:ring-zamam-primary"
                        />
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-zamam-textDark text-right mb-1">تعيين الأعضاء (فريق العمل)</label>
                  <div className="max-h-36 overflow-y-auto space-y-2 border border-gray-100 rounded-xl p-3 text-right custom-scrollbar">
                    {teamMembers.map(member => (
                      <label key={member.id} className="flex items-center gap-2 justify-end cursor-pointer">
                        <span className="text-xs font-bold text-meta-textDark">{member.name} ({member.role})</span>
                        <input 
                          type="checkbox"
                          checked={selectedMembers.includes(member.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedMembers([...selectedMembers, member.id]);
                            } else {
                              setSelectedMembers(selectedMembers.filter(id => id !== member.id));
                            }
                          }}
                          className="rounded border-gray-300 text-zamam-primary focus:ring-zamam-primary"
                        />
                      </label>
                    ))}
                  </div>
                </div>

                <button 
                  type="submit"
                  className="w-full py-3.5 mt-4 bg-zamam-primary text-white font-black rounded-2xl hover:bg-zamam-primary/90 transition-colors shadow-lg shadow-zamam-primary/20"
                >
                  {editingWorkspace ? 'حفظ التعديلات' : 'إنشاء مساحة العمل'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Settings Alert Modal */}
      <AnimatePresence>
        {alertMessage && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zamam-navy/40 backdrop-blur-sm font-['Cairo']">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white w-full max-w-sm rounded-[2rem] shadow-2xl p-8 text-center relative overflow-hidden">
              <div className="w-16 h-16 bg-zamam-light rounded-full flex items-center justify-center mx-auto mb-6 text-zamam-primary">
                <Bell className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-black text-meta-textDark mb-3">{alertMessage.title}</h3>
              <p className="text-sm font-bold text-meta-textGray leading-relaxed mb-8">{alertMessage.message}</p>
              <button onClick={() => setAlertMessage(null)} className="w-full py-3.5 bg-zamam-primary text-white font-black rounded-2xl hover:bg-zamam-primary/90 transition-colors shadow-lg shadow-zamam-primary/20">
                حسناً، فهمت
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
