ALTER TABLE public.products ADD COLUMN IF NOT EXISTS sku text;
CREATE UNIQUE INDEX IF NOT EXISTS products_seller_sku_unique ON public.products(seller_id, lower(trim(sku))) WHERE sku IS NOT NULL AND trim(sku) <> '';
CREATE TABLE public.product_import_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid NOT NULL REFERENCES public.profiles(id), shop_id uuid NOT NULL REFERENCES public.shops(id), request_key uuid NOT NULL, filename text NOT NULL, total_rows integer NOT NULL, status text NOT NULL DEFAULT 'queued', duplicate_mode text NOT NULL DEFAULT 'skip', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(seller_id,request_key)
);
GRANT SELECT ON public.product_import_jobs TO authenticated;
GRANT ALL ON public.product_import_jobs TO service_role;
ALTER TABLE public.product_import_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY import_jobs_owner_read ON public.product_import_jobs FOR SELECT TO authenticated USING (seller_id=auth.uid());
CREATE TABLE public.product_import_rows (
 job_id uuid NOT NULL REFERENCES public.product_import_jobs(id) ON DELETE CASCADE, row_number integer NOT NULL, source jsonb NOT NULL, status text NOT NULL DEFAULT 'queued', product_id uuid REFERENCES public.products(id) ON DELETE SET NULL, error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(job_id,row_number)
);
GRANT SELECT ON public.product_import_rows TO authenticated;
GRANT ALL ON public.product_import_rows TO service_role;
ALTER TABLE public.product_import_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY import_rows_owner_read ON public.product_import_rows FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.product_import_jobs j WHERE j.id=job_id AND j.seller_id=auth.uid()));
CREATE OR REPLACE FUNCTION public.touch_product_import() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
CREATE TRIGGER import_jobs_touch BEFORE UPDATE ON public.product_import_jobs FOR EACH ROW EXECUTE FUNCTION public.touch_product_import();
CREATE TRIGGER import_rows_touch BEFORE UPDATE ON public.product_import_rows FOR EACH ROW EXECUTE FUNCTION public.touch_product_import();
CREATE OR REPLACE FUNCTION public.seller_product_import(p_action text, p_job uuid DEFAULT NULL, p_payload jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 uid uuid:=auth.uid(); prof public.profiles%ROWTYPE; shop public.shops%ROWTYPE; job public.product_import_jobs%ROWTYPE; rr public.product_import_rows%ROWTYPE;
 entry jsonb; d jsonb; results jsonb:='[]'; jid uuid; pid uuid; matched uuid; cat text; curr text; sym text; imgs text[]; title_value text; sku_value text; amount numeric; qty integer; n integer; err text; mode text; needs_verification boolean;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
 SELECT * INTO prof FROM public.profiles WHERE id=uid;
 IF NOT FOUND OR prof.user_type IS DISTINCT FROM 'seller' OR coalesce(prof.status,'') IN ('blocked','banned') THEN RAISE EXCEPTION 'Active seller account required'; END IF;
 IF octet_length(p_payload::text)>2097152 THEN RAISE EXCEPTION 'Request exceeds 2MB'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('product-import:'||uid::text,0));
 IF p_action='duplicates' THEN
  IF jsonb_typeof(p_payload->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'rows')>1000 THEN RAISE EXCEPTION 'Maximum 1000 rows'; END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(p_payload->'rows') LOOP
   sku_value:=nullif(trim(entry->>'sku'),''); title_value:=trim(entry->>'title');
   SELECT id INTO matched FROM public.products WHERE seller_id=uid AND ((sku_value IS NOT NULL AND lower(trim(sku))=lower(sku_value)) OR lower(trim(title))=lower(title_value)) ORDER BY (sku_value IS NOT NULL AND lower(trim(sku))=lower(sku_value)) DESC NULLS LAST,id LIMIT 1;
   IF matched IS NOT NULL THEN results:=results||jsonb_build_array(jsonb_build_object('row_number',entry->'row_number','product_id',matched,'kind',CASE WHEN EXISTS(SELECT 1 FROM public.products WHERE id=matched AND sku_value IS NOT NULL AND lower(trim(sku))=lower(sku_value)) THEN 'sku' ELSE 'possible' END)); END IF;
  END LOOP;
  RETURN results;
 END IF;
 IF p_action='create' THEN
  SELECT * INTO job FROM public.product_import_jobs WHERE seller_id=uid AND request_key=(p_payload->>'request_key')::uuid;
  IF FOUND THEN RETURN jsonb_build_object('id',job.id); END IF;
  IF (SELECT count(*) FROM public.product_import_jobs WHERE seller_id=uid AND created_at>now()-interval '1 hour')>=10 THEN RAISE EXCEPTION 'Import limit reached: 10 files per hour'; END IF;
  IF jsonb_typeof(p_payload->'rows') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Rows must be an array'; END IF;
  n:=jsonb_array_length(p_payload->'rows');
  IF n<1 OR n>1000 THEN RAISE EXCEPTION 'Use 1 to 1000 rows'; END IF;
  mode:=coalesce(p_payload->>'duplicate_mode','skip');
  IF mode NOT IN ('skip','update','keep') THEN RAISE EXCEPTION 'Invalid duplicate choice'; END IF;
  SELECT * INTO shop FROM public.shops WHERE id=(p_payload->>'shop_id')::uuid AND seller_id=uid;
  IF NOT FOUND OR nullif(shop.cover_image_url,'') IS NULL THEN RAISE EXCEPTION 'Owned shop with a cover image required'; END IF;
  SELECT coalesce(value='true'::jsonb OR value='"true"'::jsonb,false) INTO needs_verification FROM public.admin_settings WHERE key='require_identity_verification';
  IF coalesce(needs_verification,false) AND prof.identity_verified IS DISTINCT FROM true THEN RAISE EXCEPTION 'Identity verification required'; END IF;
  IF length(coalesce(p_payload->>'filename','')) NOT BETWEEN 1 AND 255 THEN RAISE EXCEPTION 'Invalid filename'; END IF;
  INSERT INTO public.product_import_jobs(seller_id,shop_id,request_key,filename,total_rows,duplicate_mode) VALUES(uid,shop.id,(p_payload->>'request_key')::uuid,p_payload->>'filename',n,mode) RETURNING id INTO jid;
  INSERT INTO public.product_import_rows(job_id,row_number,source,status,error) SELECT jid,ordinality::integer,value,CASE WHEN nullif(value->>'validation_error','') IS NULL THEN 'queued' ELSE 'failed' END,nullif(value->>'validation_error','') FROM jsonb_array_elements(p_payload->'rows') WITH ORDINALITY;
  RETURN jsonb_build_object('id',jid);
 END IF;
 IF p_action IS DISTINCT FROM 'batch' THEN RAISE EXCEPTION 'Unknown import action'; END IF;
 SELECT * INTO job FROM public.product_import_jobs WHERE id=p_job AND seller_id=uid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Import not found'; END IF;
 SELECT * INTO shop FROM public.shops WHERE id=job.shop_id AND seller_id=uid;
 IF NOT FOUND OR nullif(shop.cover_image_url,'') IS NULL THEN RAISE EXCEPTION 'Owned shop with cover required'; END IF;
 SELECT coalesce(value='true'::jsonb OR value='"true"'::jsonb,false) INTO needs_verification FROM public.admin_settings WHERE key='require_identity_verification';
 IF coalesce(needs_verification,false) AND prof.identity_verified IS DISTINCT FROM true THEN RAISE EXCEPTION 'Identity verification required'; END IF;
 IF jsonb_typeof(p_payload->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'rows') NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Batch must contain 1 to 20 rows'; END IF;
 UPDATE public.product_import_jobs SET status='processing' WHERE id=job.id;
 FOR entry IN SELECT value FROM jsonb_array_elements(p_payload->'rows') LOOP
  SELECT * INTO rr FROM public.product_import_rows WHERE job_id=job.id AND row_number=(entry->>'row_number')::integer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown import row'; END IF;
  IF rr.status IN ('success','skipped') THEN results:=results||jsonb_build_array(jsonb_build_object('row_number',rr.row_number,'status',rr.status,'product_id',rr.product_id)); CONTINUE; END IF;
  d:=coalesce(entry->'data',rr.source); pid:=NULL; matched:=NULL;
  BEGIN
   title_value:=trim(d->>'title'); sku_value:=nullif(trim(d->>'sku'),'');
   IF length(coalesce(title_value,'')) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Title required (maximum 200 characters)'; END IF;
   IF length(coalesce(d->>'description','')) NOT BETWEEN 1 AND 50000 OR cardinality(regexp_split_to_array(trim(regexp_replace(d->>'description','<[^>]*>','','g')),'\s+'))>800 THEN RAISE EXCEPTION 'Description required (maximum 800 words)'; END IF;
   IF coalesce(d->>'price','') !~ '^[0-9]+(\.[0-9]{1,6})?$' THEN RAISE EXCEPTION 'Invalid price'; END IF;
   amount:=(d->>'price')::numeric; IF amount<=0 OR amount>1000000000000 THEN RAISE EXCEPTION 'Price must be positive and at most 1000000000000'; END IF;
   IF coalesce(d->>'quantity','') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Stock must be a nonnegative integer'; END IF;
   qty:=(d->>'quantity')::integer;
   SELECT slug INTO cat FROM public.categories WHERE lower(d->>'category') IN (lower(slug),lower(name),lower(id::text)) ORDER BY id LIMIT 1;
   IF cat IS NULL THEN RAISE EXCEPTION 'Unknown category'; END IF;
   curr:=upper(coalesce(nullif(trim(d->>'currency'),''),prof.currency_code,'RWF'));
   SELECT currency_symbol INTO sym FROM public.countries WHERE is_active=true AND upper(currency_code)=curr ORDER BY id LIMIT 1;
   IF NOT FOUND THEN RAISE EXCEPTION 'Unsupported currency: %',curr; END IF;
   IF length(coalesce(sku_value,''))>100 OR length(coalesce(d->>'brand',''))>100 THEN RAISE EXCEPTION 'SKU/brand maximum 100 characters'; END IF;
   IF nullif(d->>'condition','') IS NOT NULL AND d->>'condition' NOT IN ('new','used','refurbished') THEN RAISE EXCEPTION 'Condition must be new, used or refurbished'; END IF;
   IF jsonb_typeof(d->'images') IS DISTINCT FROM 'array' OR jsonb_array_length(d->'images') NOT BETWEEN 1 AND 2 THEN RAISE EXCEPTION 'One or two images required'; END IF;
   SELECT array_agg(value) INTO imgs FROM jsonb_array_elements_text(d->'images');
   IF EXISTS(SELECT 1 FROM unnest(imgs) u WHERE u !~ '^https://res\.cloudinary\.com/ddwrviw3v/image/upload/[^[:space:]]+$' OR length(u)>2048) THEN RAISE EXCEPTION 'Images must finish processing in the configured Cloudinary account'; END IF;
   IF nullif(entry->>'image_error','') IS NOT NULL THEN RAISE EXCEPTION '%',left(entry->>'image_error',500); END IF;
   SELECT id INTO matched FROM public.products WHERE seller_id=uid AND sku_value IS NOT NULL AND lower(trim(sku))=lower(sku_value) ORDER BY id LIMIT 1 FOR UPDATE;
   IF matched IS NULL AND job.duplicate_mode<>'keep' THEN SELECT id INTO matched FROM public.products WHERE seller_id=uid AND lower(trim(title))=lower(title_value) ORDER BY id LIMIT 1 FOR UPDATE; END IF;
   IF matched IS NOT NULL AND (job.duplicate_mode<>'update' OR sku_value IS NULL OR NOT EXISTS(SELECT 1 FROM public.products WHERE id=matched AND lower(trim(sku))=lower(sku_value))) THEN
    UPDATE public.product_import_rows SET status='skipped',product_id=matched,error='Duplicate skipped',source=d WHERE job_id=job.id AND row_number=rr.row_number;
    results:=results||jsonb_build_array(jsonb_build_object('row_number',rr.row_number,'status','skipped','product_id',matched)); CONTINUE;
   END IF;
   IF matched IS NOT NULL THEN
    UPDATE public.products SET title=title_value,description=d->>'description',price=amount,quantity=qty,category=cat,currency_code=curr,currency_symbol=sym,images=imgs,sku=sku_value,status='pending',description_structured=coalesce(description_structured,'{}'::jsonb)||jsonb_build_object('sold_out',qty=0,'import_attributes',jsonb_build_object('brand',d->>'brand','condition',d->>'condition')) WHERE id=matched AND seller_id=uid RETURNING id INTO pid;
   ELSE
    pid:=gen_random_uuid();
    INSERT INTO public.products(id,seller_id,shop_id,title,description,price,quantity,minimum_quantity,images,category,status,sku,currency_code,currency_symbol,country,location_id,contact_whatsapp,contact_call,lat,lng,slug,description_structured) VALUES(pid,uid,shop.id,title_value,d->>'description',amount,qty,1,imgs,cat,'pending',sku_value,curr,sym,prof.country,prof.sector_id,prof.whatsapp_number,prof.call_number,prof.lat,prof.lng,'import-'||pid::text,jsonb_build_object('sold_out',qty=0,'import_attributes',jsonb_build_object('brand',d->>'brand','condition',d->>'condition')));
   END IF;
   UPDATE public.product_import_rows SET status='success',product_id=pid,error=NULL,source=d WHERE job_id=job.id AND row_number=rr.row_number;
   results:=results||jsonb_build_array(jsonb_build_object('row_number',rr.row_number,'status','success','product_id',pid));
  EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS err=MESSAGE_TEXT;
   UPDATE public.product_import_rows SET status='failed',source=d,error=left(err,1000) WHERE job_id=job.id AND row_number=rr.row_number;
   results:=results||jsonb_build_array(jsonb_build_object('row_number',rr.row_number,'status','failed','error',left(err,1000)));
  END;
 END LOOP;
 UPDATE public.product_import_jobs SET status=CASE WHEN EXISTS(SELECT 1 FROM public.product_import_rows WHERE job_id=job.id AND status='queued') THEN 'processing' WHEN EXISTS(SELECT 1 FROM public.product_import_rows WHERE job_id=job.id AND status='failed') THEN 'failed' ELSE 'completed' END WHERE id=job.id;
 RETURN results;
END $$;
REVOKE ALL ON FUNCTION public.seller_product_import(text,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.seller_product_import(text,uuid,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.touch_product_import() FROM PUBLIC,anon,authenticated;
