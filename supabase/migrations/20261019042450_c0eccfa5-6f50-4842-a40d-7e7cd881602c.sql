CREATE SCHEMA IF NOT EXISTS product_import_private;
REVOKE ALL ON SCHEMA product_import_private FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA product_import_private TO authenticated,service_role;
ALTER FUNCTION public.seller_product_import(text,uuid,jsonb) SET SCHEMA product_import_private;
REVOKE ALL ON FUNCTION product_import_private.seller_product_import(text,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION product_import_private.seller_product_import(text,uuid,jsonb) TO authenticated;
CREATE FUNCTION public.seller_product_import(p_action text,p_job uuid DEFAULT NULL,p_payload jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=public AS $$ SELECT product_import_private.seller_product_import(p_action,p_job,p_payload); $$;
REVOKE ALL ON FUNCTION public.seller_product_import(text,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.seller_product_import(text,uuid,jsonb) TO authenticated;