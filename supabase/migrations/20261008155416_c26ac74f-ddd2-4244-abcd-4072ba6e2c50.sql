DROP TRIGGER IF EXISTS static_gen_products ON public.products;
DROP TRIGGER IF EXISTS trg_regen_products ON public.products;
DROP TRIGGER IF EXISTS products_cache_invalidate ON public.products;
DROP TRIGGER IF EXISTS trg_invalidate_cache_products ON public.products;
DROP TRIGGER IF EXISTS trg_products_cache_invalidate ON public.products;