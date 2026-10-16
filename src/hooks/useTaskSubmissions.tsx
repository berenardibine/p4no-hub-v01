import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export interface TaskSubmission {
  id: string;
  user_id: string;
  task_id: string;
  status: string;
  proof_text: string | null;
  proof_image: string | null;
  admin_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RewardTask {
  id: string;
  title: string;
  description: string;
  reward_points: number;
  reward_coins: number;
  reward_usdt?: number | string | null;
  max_participants?: number | null;
  approved_count?: number;
  task_type: string;
  requirement_count: number;
  icon: string | null;
  color: string | null;
  expires_at: string | null;
  is_active: boolean;
  category: string | null;
  requires_evidence: boolean;
  evidence_type: string | null;
  external_link: string | null;
  difficulty: string | null;
  reward_type: string | null;
  text_hint: string | null;
}

export const useTaskSubmissions = () => {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<RewardTask[]>([]);
  const [submissions, setSubmissions] = useState<TaskSubmission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTasks();
    if (user) fetchSubmissions();
  }, [user]);

  const fetchTasks = async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from('reward_tasks')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    setTasks(data || []);
    setLoading(false);
  };

  const fetchSubmissions = async () => {
    if (!user) return;
    const { data } = await (supabase as any)
      .from('task_submissions')
      .select('*')
      .eq('user_id', user.id);
    setSubmissions(data || []);
  };

  const getSubmission = (taskId: string) => {
    return submissions.find(s => s.task_id === taskId);
  };

  const submitTask = async (taskId: string, proofText?: string, proofImage?: string) => {
    if (!user) return;
    const { error } = await (supabase as any)
      .from('task_submissions')
      .insert({
        user_id: user.id,
        task_id: taskId,
        status: 'pending',
        proof_text: proofText || null,
        proof_image: proofImage || null,
      });
    if (error) throw error;
    await fetchSubmissions();
  };

  return { tasks, submissions, loading, getSubmission, submitTask, refetch: () => { fetchTasks(); fetchSubmissions(); } };
};

// Admin hook for managing all submissions
export const useAdminTaskSubmissions = () => {
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [tasks, setTasks] = useState<RewardTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    const [subsRes, tasksRes] = await Promise.all([
      (supabase as any).from('task_submissions').select('*, profiles:task_submissions_user_id_profiles_fkey(full_name, email, profile_image)').order('created_at', { ascending: false }),
      (supabase as any).from('reward_tasks').select('*').order('created_at', { ascending: false }),
    ]);
    setSubmissions(subsRes.data || []);
    setTasks(tasksRes.data || []);
    setLoading(false);
  };

  const reviewSubmission = async (submissionId: string, status: 'approved' | 'rejected', adminNotes: string, userId: string, taskId: string) => {
    // Server-side, atomic and idempotent: credits USDT once, enforces people limit.
    const { data: res, error: rpcErr } = await (supabase as any).rpc('review_task_submission', {
      _id: submissionId, _status: status, _notes: adminNotes || null,
    });
    if (rpcErr) throw rpcErr;
    if (res?.already) { await fetchAll(); return; }
    const credited = Number(res?.credited || 0).toFixed(2);

    // Send notification
    await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        title: status === 'approved' ? 'Task Approved! 🎉' : 'Task Rejected',
        message: status === 'approved'
          ? `Your task submission was approved! ${credited} USDT added to your wallet.`
          : `Your task submission was rejected. Reason: ${adminNotes || 'No reason provided.'}`,
        type: status === 'approved' ? 'reward' : 'warning',
      });

    await fetchAll();
  };

  const createTask = async (task: Partial<RewardTask>) => {
    const { error } = await (supabase as any)
      .from('reward_tasks')
      .insert(task);
    if (error) throw error;
    await fetchAll();
  };

  const updateTask = async (taskId: string, updates: Partial<RewardTask>) => {
    const { error } = await (supabase as any)
      .from('reward_tasks')
      .update(updates)
      .eq('id', taskId);
    if (error) throw error;
    await fetchAll();
  };

  const deleteTask = async (taskId: string) => {
    await (supabase as any)
      .from('reward_tasks')
      .delete()
      .eq('id', taskId);
    await fetchAll();
  };

  return { submissions, tasks, loading, reviewSubmission, createTask, updateTask, deleteTask, refetch: fetchAll };
};
