import { supabase } from '@/integrations/supabase/client';

/** Permanently delete a product and its Cloudinary images (server-side, owner/admin only). */
export async function deleteProductWithAssets(productId: string): Promise<{ error: Error | null }> {
  const { data, error } = await supabase.functions.invoke('cloudinary-cleanup', {
    body: { action: 'delete_product', productId },
  });
  if (error) return { error };
  if ((data as { error?: string })?.error) return { error: new Error((data as { error: string }).error) };
  return { error: null };
}

/** Remove images that belonged only to an abandoned draft. Images used by any product are kept. */
export async function discardDraftAssets(urls: string[]): Promise<void> {
  const clean = urls.filter(Boolean);
  if (!clean.length) return;
  try {
    await supabase.functions.invoke('cloudinary-cleanup', { body: { action: 'discard_draft', urls: clean } });
  } catch { /* best effort */ }
}
