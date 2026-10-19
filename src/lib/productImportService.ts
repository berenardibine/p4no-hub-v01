import { supabase } from '@/integrations/supabase/client';
import { processImage } from '@/lib/imageProcessor';
import { uploadToCloudinary, optimizeCloudinaryUrl } from '@/lib/cloudinary';
import { validImageURL, type ImportProduct } from '@/lib/productImport';

export type ImportResult = { row_number: number; status: 'queued' | 'success' | 'failed' | 'skipped'; error?: string | null; product_id?: string | null };
export async function importAction<T>(action: string, job: string | null, payload: unknown): Promise<T> {
  const { data, error } = await supabase.rpc('seller_product_import', { p_action: action, p_job: job ?? undefined, p_payload: payload as never });
  if (error) throw error;
  return data as T;
}

export async function processImportImages(data: ImportProduct): Promise<ImportProduct> {
  const images: string[] = [];
  for (const url of data.images) {
    if (!validImageURL(url)) throw new Error('Invalid image URL.');
    if (/^https:\/\/res\.cloudinary\.com\/ddwrviw3v\/image\/upload\//.test(url)) { images.push(optimizeCloudinaryUrl(url)); continue; }
    // Download in the browser, not on a privileged server. No credentials; reject redirects.
    const response = await fetch(url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('Image download failed. Use an accessible HTTPS JPG, PNG or WEBP URL.');
    const type = response.headers.get('content-type')?.split(';')[0];
    if (!type || !['image/jpeg', 'image/png', 'image/webp'].includes(type)) throw new Error('Image must be JPG, PNG or WEBP.');
    if (Number(response.headers.get('content-length')) > 2 * 1024 * 1024) throw new Error('Image exceeds 2MB.');
    const reader = response.body?.getReader(); if (!reader) throw new Error('Image download unavailable.');
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('Image exceeds 2MB.'); }
      chunks.push(value);
    }
    const file = new Blob(chunks as BlobPart[], { type });
    const processed = await processImage(file, { productName: data.title, addWatermark: true, maxSizeKB: 100, maxDimension: 1024 });
    const uploaded = await uploadToCloudinary(new File([processed.blob], processed.filename, { type: processed.blob.type }), 'products');
    images.push(optimizeCloudinaryUrl(uploaded.secure_url));
  }
  return { ...data, images };
}