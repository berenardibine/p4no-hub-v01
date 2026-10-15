ALTER TABLE public.reward_tasks
  ADD COLUMN IF NOT EXISTS reward_usdt numeric(18,2),
  ADD COLUMN IF NOT EXISTS max_participants integer,
  ADD COLUMN IF NOT EXISTS approved_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS usdt_balance numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS usdt_pending numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS usdt_lifetime numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS usdt_withdrawn numeric(18,2) NOT NULL DEFAULT 0;
ALTER TABLE public.wallets ADD CONSTRAINT wallets_usdt_nonneg CHECK (usdt_balance >= 0 AND usdt_pending >= 0);
ALTER TABLE public.wallet_ledger ADD COLUMN IF NOT EXISTS usdt_amount numeric(18,2);
ALTER TABLE public.withdrawals
  ADD COLUMN IF NOT EXISTS usdt_amount numeric(18,2),
  ADD COLUMN IF NOT EXISTS destination text,
  ADD COLUMN IF NOT EXISTS network text;
CREATE UNIQUE INDEX IF NOT EXISTS wallet_ledger_usdt_once
  ON public.wallet_ledger(kind, reference_id) WHERE usdt_amount IS NOT NULL AND reference_id IS NOT NULL;

DROP POLICY IF EXISTS "Users update own wallet" ON public.wallets;
DROP POLICY IF EXISTS "Users insert own wallet" ON public.wallets;

CREATE OR REPLACE FUNCTION public.review_task_submission(_id uuid, _status text, _notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _s RECORD; _t RECORD; _wid uuid; _amt numeric(18,2);
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'admin only'; END IF;
  IF _status NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'invalid status'; END IF;
  SELECT * INTO _s FROM public.task_submissions WHERE id=_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'submission not found'; END IF;
  IF _s.status = 'approved' THEN RETURN jsonb_build_object('ok',true,'already',true,'credited',0); END IF;
  IF _s.user_id = auth.uid() THEN RAISE EXCEPTION 'cannot review your own submission'; END IF;
  IF _status = 'rejected' THEN
    UPDATE public.task_submissions SET status='rejected', admin_notes=_notes, reviewed_by=auth.uid(), reviewed_at=now(), updated_at=now() WHERE id=_id;
    RETURN jsonb_build_object('ok',true,'credited',0);
  END IF;
  SELECT * INTO _t FROM public.reward_tasks WHERE id=_s.task_id FOR UPDATE;
  IF _t.max_participants IS NOT NULL AND _t.approved_count >= _t.max_participants THEN
    RAISE EXCEPTION 'Task limit reached';
  END IF;
  _amt := COALESCE(_t.reward_usdt, 0);
  UPDATE public.task_submissions SET status='approved', admin_notes=_notes, reviewed_by=auth.uid(), reviewed_at=now(), updated_at=now() WHERE id=_id;
  UPDATE public.reward_tasks SET approved_count = approved_count + 1,
    is_active = CASE WHEN max_participants IS NOT NULL AND approved_count + 1 >= max_participants THEN false ELSE is_active END
   WHERE id=_t.id;
  IF _amt > 0 THEN
    PERFORM public.ensure_growth_bootstrap(_s.user_id);
    SELECT id INTO _wid FROM public.wallets WHERE user_id=_s.user_id FOR UPDATE;
    IF _wid IS NULL THEN INSERT INTO public.wallets(user_id) VALUES (_s.user_id) RETURNING id INTO _wid; END IF;
    INSERT INTO public.wallet_ledger(wallet_id,user_id,direction,bucket,points,usd_equiv,usdt_amount,kind,reference_id,reference_type,description,status)
    VALUES(_wid,_s.user_id,'credit','action',0,_amt,_amt,'task_reward_usdt',_id,'task_submission','Task reward: '||_t.title,'completed');
    UPDATE public.wallets SET usdt_balance=usdt_balance+_amt, usdt_lifetime=usdt_lifetime+_amt, updated_at=now() WHERE id=_wid;
  END IF;
  RETURN jsonb_build_object('ok',true,'credited',_amt);
END $$;

CREATE OR REPLACE FUNCTION public.usdt_withdrawal_create(_amount numeric, _pay_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _p RECORD; _w RECORD; _id uuid; _amt numeric(18,2);
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _amount IS NULL OR _amount <> round(_amount,2) THEN RAISE EXCEPTION 'Use at most 2 decimals'; END IF;
  _amt := _amount;
  IF _amt < 1 THEN RAISE EXCEPTION 'Minimum withdrawal is 1 USDT'; END IF;
  IF _pay_id IS NULL OR btrim(_pay_id) !~ '^[0-9]{6,12}$' THEN RAISE EXCEPTION 'Enter a valid Binance Pay ID (6-12 digits)'; END IF;
  SELECT * INTO _p FROM public.profiles WHERE id=_uid;
  IF NOT COALESCE(_p.identity_verified,false) THEN RAISE EXCEPTION 'Identity not verified'; END IF;
  IF _p.phone_number IS NULL THEN RAISE EXCEPTION 'Phone not verified'; END IF;
  SELECT * INTO _w FROM public.wallets WHERE user_id=_uid FOR UPDATE;
  IF NOT FOUND OR _w.usdt_balance < _amt THEN RAISE EXCEPTION 'Insufficient USDT balance'; END IF;
  IF EXISTS (SELECT 1 FROM public.withdrawals WHERE user_id=_uid AND status IN ('pending','approved')) THEN
    RAISE EXCEPTION 'You have a pending withdrawal'; END IF;
  UPDATE public.wallets SET usdt_balance=usdt_balance-_amt, usdt_pending=usdt_pending+_amt, updated_at=now() WHERE id=_w.id;
  INSERT INTO public.withdrawals(user_id,points,usd_amount,usdt_amount,method,destination,network,payload,country,status)
  VALUES(_uid,0,_amt,_amt,'binance',btrim(_pay_id),'Binance Pay (internal USDT transfer)',jsonb_build_object('pay_id',btrim(_pay_id)),COALESCE(_p.country_code,_p.country),'pending')
  RETURNING id INTO _id;
  INSERT INTO public.wallet_ledger(wallet_id,user_id,direction,bucket,points,usd_equiv,usdt_amount,kind,reference_id,reference_type,description,status)
  VALUES(_w.id,_uid,'debit','withdrawal_hold',0,_amt,_amt,'usdt_withdrawal_hold',_id,'withdrawal','Withdrawal hold (Binance)','pending');
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.withdrawal_mark_paid(_id uuid, _reference text DEFAULT NULL::text, _note text DEFAULT NULL::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _w RECORD; _wallet RECORD;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'admin only'; END IF;
  SELECT * INTO _w FROM public.withdrawals WHERE id=_id FOR UPDATE;
  IF _w.status NOT IN ('pending','approved') THEN RAISE EXCEPTION 'invalid state'; END IF;
  SELECT * INTO _wallet FROM public.wallets WHERE user_id=_w.user_id FOR UPDATE;
  IF _w.usdt_amount IS NOT NULL THEN
    UPDATE public.wallets SET usdt_pending=usdt_pending-_w.usdt_amount, usdt_withdrawn=usdt_withdrawn+_w.usdt_amount, updated_at=now() WHERE id=_wallet.id;
    INSERT INTO public.wallet_ledger(wallet_id,user_id,direction,bucket,points,usd_equiv,usdt_amount,kind,reference_id,reference_type,description,status)
    VALUES(_wallet.id,_w.user_id,'debit','withdrawal',0,_w.usdt_amount,_w.usdt_amount,'usdt_withdrawal_paid',_w.id,'withdrawal','Paid manually via Binance Pay','completed');
  ELSE
    UPDATE public.wallets SET pending_balance = pending_balance - _w.points, total_withdrawn = total_withdrawn + _w.points, updated_at = now() WHERE id=_wallet.id;
    INSERT INTO public.wallet_ledger(wallet_id, user_id, direction, bucket, points, usd_equiv, kind, reference_id, reference_type, description, status)
    VALUES(_wallet.id, _w.user_id, 'debit', 'withdrawal', _w.points, _w.usd_amount, 'withdrawal', _w.id, 'withdrawal', COALESCE('Paid via '||_w.method,'Withdrawal paid'), 'completed');
  END IF;
  UPDATE public.withdrawals SET status='paid', paid_at=now(), paid_reference=_reference, admin_note=COALESCE(_note, admin_note), updated_at=now() WHERE id=_id;
END $function$;

CREATE OR REPLACE FUNCTION public.withdrawal_reject(_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _w RECORD; _wallet RECORD;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'admin only'; END IF;
  SELECT * INTO _w FROM public.withdrawals WHERE id=_id FOR UPDATE;
  IF _w.status NOT IN ('pending','approved') THEN RAISE EXCEPTION 'invalid state'; END IF;
  SELECT * INTO _wallet FROM public.wallets WHERE user_id=_w.user_id FOR UPDATE;
  IF _w.usdt_amount IS NOT NULL THEN
    UPDATE public.wallets SET usdt_balance=usdt_balance+_w.usdt_amount, usdt_pending=usdt_pending-_w.usdt_amount, updated_at=now() WHERE id=_wallet.id;
    INSERT INTO public.wallet_ledger(wallet_id,user_id,direction,bucket,points,usd_equiv,usdt_amount,kind,reference_id,reference_type,description,status)
    VALUES(_wallet.id,_w.user_id,'credit','withdrawal_refund',0,_w.usdt_amount,_w.usdt_amount,'usdt_withdrawal_refund',_w.id,'withdrawal','Withdrawal rejected — refund','completed');
  ELSE
    UPDATE public.wallets SET balance = balance + _w.points, pending_balance = pending_balance - _w.points, updated_at=now() WHERE id=_wallet.id;
    INSERT INTO public.wallet_ledger(wallet_id, user_id, direction, bucket, points, usd_equiv, kind, reference_id, reference_type, description)
    VALUES(_wallet.id, _w.user_id, 'credit', 'withdrawal_refund', _w.points, _w.usd_amount, 'withdrawal_refund', _w.id, 'withdrawal', 'Withdrawal rejected — refund');
  END IF;
  UPDATE public.withdrawals SET status='rejected', rejection_reason=_reason, reviewed_by=auth.uid(), updated_at=now() WHERE id=_id;
END $function$;

REVOKE EXECUTE ON FUNCTION public.review_task_submission(uuid,text,text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.usdt_withdrawal_create(numeric,text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.review_task_submission(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.usdt_withdrawal_create(numeric,text) TO authenticated;