import Papa from 'papaparse';

export const IMPORT_LIMITS = { bytes: 2 * 1024 * 1024, rows: 1000, batch: 20, images: 2 };
export const IMPORT_FIELDS = ['title', 'description', 'price', 'currency', 'category', 'sku', 'quantity', 'images', 'brand', 'condition'] as const;
export type ImportField = typeof IMPORT_FIELDS[number];
export type ImportMapping = Partial<Record<ImportField, string>>;
export type SourceRow = Record<string, unknown>;
export interface ImportProduct { title: string; description: string; price: string; currency: string; category: string; sku: string; quantity: string; images: string[]; brand: string; condition: string }
export interface ImportContext { categories: { id: string; name: string; slug: string }[]; currencies: string[]; defaultCurrency: string }
export interface CheckedImportRow { row_number: number; data: ImportProduct; errors: string[]; duplicate?: 'file' | 'sku' | 'possible' }
export interface InventoryFeedAdapter { parse(file: File): Promise<SourceRow[]> }

const aliases: Record<ImportField, string[]> = {
  title: ['title', 'product_name', 'name'], description: ['description', 'product_description'], price: ['price', 'unit_price'],
  currency: ['currency', 'currency_code'], category: ['category', 'category_id', 'category_name'], sku: ['sku', 'product_sku'],
  quantity: ['quantity', 'stock_quantity', 'inventory', 'stock'], images: ['images', 'image_url', 'image_urls'], brand: ['brand'], condition: ['condition'],
};
const normalizeHeader = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, '_');
export function autoMap(headers: string[]): ImportMapping {
  return Object.fromEntries(IMPORT_FIELDS.map(f => [f, headers.find(h => aliases[f].includes(normalizeHeader(h))) || '']));
}
function checkRows(rows: unknown): SourceRow[] {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > IMPORT_LIMITS.rows) throw new Error('Use 1 to 1,000 product rows.');
  if (rows.some(r => !r || typeof r !== 'object' || Array.isArray(r))) throw new Error('Each product must be a JSON object.');
  return rows as SourceRow[];
}
export function parseJSON(text: string): SourceRow[] {
  try { return checkRows(JSON.parse(text.replace(/^\uFEFF/, ''))); }
  catch (e) { if (e instanceof SyntaxError) throw new Error('Malformed JSON. Upload an array of product objects.'); throw e; }
}
export function parseCSV(text: string): SourceRow[] {
  const parsed = Papa.parse<SourceRow>(text.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: 'greedy' });
  if (parsed.errors.length) throw new Error(`CSV error: ${parsed.errors[0].message}`);
  if (new Set(parsed.meta.fields?.map(normalizeHeader)).size !== parsed.meta.fields?.length || parsed.meta.renamedHeaders) throw new Error('CSV headers must be unique.');
  return checkRows(parsed.data);
}
export const fileInventoryAdapter: InventoryFeedAdapter = {
  async parse(file) {
    if (file.size > IMPORT_LIMITS.bytes) throw new Error('File exceeds 2MB. Split it into smaller files.');
    if (!/\.(csv|json)$/i.test(file.name)) throw new Error('Choose a CSV or JSON file.');
    if (/\.json$/i.test(file.name)) return parseJSON(await file.text());
    // Papa's worker keeps CSV parsing off the main thread when supported.
    return new Promise((resolve, reject) => Papa.parse<SourceRow>(file, {
      header: true, skipEmptyLines: 'greedy', worker: true,
      complete: result => {
        try {
          if (result.errors.length) throw new Error(`CSV error: ${result.errors[0].message}`);
          if (result.meta.renamedHeaders || new Set(result.meta.fields?.map(normalizeHeader)).size !== result.meta.fields?.length) throw new Error('CSV headers must be unique.');
          resolve(checkRows(result.data));
        } catch (e) { reject(e); }
      }, error: reject,
    }));
  },
};
export function validImageURL(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && value.length <= 2048 && !/\s/.test(value)
      && !/^(localhost|.*\.local|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(u.hostname);
  } catch { return false; }
}
export function mapRow(row: SourceRow, mapping: ImportMapping, defaultCurrency: string): ImportProduct {
  const get = (f: ImportField) => row[mapping[f] || ''];
  const text = (f: ImportField) => get(f) == null ? '' : String(get(f)).trim();
  const images = get('images');
  return {
    title: text('title'), description: text('description'), price: text('price'), currency: (text('currency') || defaultCurrency).toUpperCase(),
    category: text('category'), sku: text('sku'), quantity: text('quantity') || '1',
    images: (Array.isArray(images) ? images : text('images').split(/[|;,\n]/)).map(String).map(s => s.trim()).filter(Boolean),
    brand: text('brand'), condition: text('condition').toLowerCase(),
  };
}
export function validateProduct(data: ImportProduct, context: ImportContext): string[] {
  const errors: string[] = [];
  if (!data.title || data.title.length > 200) errors.push('Title required (maximum 200 characters).');
  if (!data.description || data.description.length > 50000 || data.description.replace(/<[^>]*>/g, '').split(/\s+/).filter(Boolean).length > 800) errors.push('Description required (maximum 800 words).');
  if (!/^\d+(\.\d{1,6})?$/.test(data.price) || Number(data.price) <= 0 || Number(data.price) > 1e12) errors.push('Price must be positive, with up to 6 decimal places.');
  if (!/^\d+$/.test(data.quantity) || Number(data.quantity) > 2147483647) errors.push('Stock must be a nonnegative integer.');
  if (!context.currencies.includes(data.currency)) errors.push(`Unsupported currency: ${data.currency}.`);
  if (!context.categories.some(c => [c.id, c.slug, c.name].some(v => v.toLowerCase() === data.category.toLowerCase()))) errors.push('Choose an existing category.');
  if (data.images.length < 1 || data.images.length > 2 || data.images.some(u => !validImageURL(u))) errors.push('One or two valid HTTPS image URLs required.');
  if (data.sku.length > 100 || data.brand.length > 100) errors.push('SKU and brand maximum 100 characters.');
  if (data.condition && !['new', 'used', 'refurbished'].includes(data.condition)) errors.push('Condition must be new, used or refurbished.');
  return errors;
}
export function reviewRows(rows: SourceRow[], mapping: ImportMapping, context: ImportContext): CheckedImportRow[] {
  const skus = new Set<string>(); const titles = new Set<string>();
  return rows.map((row, index) => {
    const data = mapRow(row, mapping, context); const sku = data.sku.toLowerCase(); const title = data.title.toLowerCase();
    const duplicate = (sku && skus.has(sku)) || titles.has(title) ? 'file' as const : undefined;
    if (sku) skus.add(sku); titles.add(title);
    return { row_number: index + 1, data, errors: validateProduct(data, context), duplicate };
  });
}
export function downloadImportFile(filename: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type: filename.endsWith('.csv') ? 'text/csv' : 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}