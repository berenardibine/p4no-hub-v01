CREATE OR REPLACE FUNCTION public.cascade_category_slug()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug AND OLD.slug IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.categories WHERE slug = NEW.slug AND id <> NEW.id) THEN
      RAISE EXCEPTION 'Category slug % already in use', NEW.slug;
    END IF;
    UPDATE public.products SET category = NEW.slug WHERE category = OLD.slug;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_categories_slug_cascade ON public.categories;
CREATE TRIGGER trg_categories_slug_cascade AFTER UPDATE OF slug ON public.categories
FOR EACH ROW EXECUTE FUNCTION public.cascade_category_slug();