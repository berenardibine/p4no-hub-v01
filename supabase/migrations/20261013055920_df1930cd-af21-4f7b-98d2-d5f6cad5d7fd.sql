DROP POLICY IF EXISTS "Users read global notifications" ON public.notifications;
CREATE POLICY "Users read global notifications" ON public.notifications FOR SELECT TO authenticated
  USING (user_id IS NULL AND type IS DISTINCT FROM 'admin');
DROP POLICY IF EXISTS "Users update own notification read" ON public.notifications;
CREATE POLICY "Users update own notification read" ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR (user_id IS NULL AND type IS DISTINCT FROM 'admin'))
  WITH CHECK (user_id = auth.uid() OR (user_id IS NULL AND type IS DISTINCT FROM 'admin'));