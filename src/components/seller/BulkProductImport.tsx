import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Download, RefreshCw, FileUp, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/hooks/useAuth';
import { useCategories } from '@/hooks/useCategories';
import { useCountries } from '@/hooks/useCountries';
import { supabase } from '@/integrations/supabase/client';
import { IMPORT_FIELDS, IMPORT_LIMITS, autoMap, fileInventoryAdapter, reviewRows, validateProduct, downloadImportFile, type SourceRow, type ImportMapping, type CheckedImportRow, type ImportProduct } from '@/lib/productImport';
import { importAction, processImportImages, type ImportResult } from '@/lib/productImportService';

type Job = { id: string; filename: string; created_at: string; total_rows: number; status: string };
type StoredRow = ImportResult & { source: ImportProduct; job_id: string };
const example = { title: 'Example product', description: 'Describe your product here.', price: '25.50', currency: 'RWF', category: 'Replace with your category', sku: 'EXAMPLE-001', quantity: '10', images: ['https://example.com/product.jpg'], brand: '', condition: 'new' };

export default function BulkProductImport({ shopId, onImported }: { shopId?: string; onImported: () => void }) {
  const { user, profile } = useAuth();
  const { categories, error: categoryError } = useCategories();
  const { countries } = useCountries();
  const [rows, setRows] = useState<SourceRow[]>([]);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [filename, setFilename] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [progress, setProgress] = useState(0);
  const [reviewed, setReviewed] = useState<CheckedImportRow[] | null>(null);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [history, setHistory] = useState<Job[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyMore, setHistoryMore] = useState(false);
  const [mode, setMode] = useState('skip');
  const [previewPage, setPreviewPage] = useState(0);
  const requestKey = useRef(crypto.randomUUID());
  const running = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const context = useMemo(() => ({ categories, currencies: Array.from(new Set(countries.filter(c => c.is_active).map(c => c.currency_code).filter((v): v is string => !!v))), defaultCurrency: profile?.currency_code || 'RWF' }), [categories, countries, profile?.currency_code]);
  const headers = useMemo(() => Array.from(new Set(rows.flatMap(r => Object.keys(r)))), [rows]);
  const preview = useMemo(() => reviewRows(rows, mapping, context), [rows, mapping, context]);
  const valid = reviewed?.filter(r => !r.errors.length) || [];

  const loadHistory = async (page = historyPage) => {
    if (!user) return;
    setHistoryLoading(true);
    const { data, error: e } = await supabase.from('product_import_jobs').select('id,filename,created_at,total_rows,status').eq('seller_id', user.id).order('created_at', { ascending: false }).range(page * 20, page * 20 + 20);
    if (e) setError(`Could not load import history: ${e.message}`);
    else { setHistory((data || []).slice(0, 20)); setHistoryMore((data || []).length > 20); setHistoryPage(page); }
    setHistoryLoading(false);
  };
  useEffect(() => { void loadHistory(0); }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (running.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const selectFile = async (file?: File) => {
    if (!file || running.current) return;
    setBusy(true); setError(''); setStage('Reading file');
    try {
      const parsed = await fileInventoryAdapter.parse(file);
      setRows(parsed); setMapping(autoMap(Array.from(new Set(parsed.flatMap(r => Object.keys(r)))))); setFilename(file.name);
      setReviewed(null); setResults([]); setJobId(null); setPreviewPage(0); setProgress(0); requestKey.current = crypto.randomUUID();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read file.'); }
    finally { setBusy(false); setStage(''); }
  };
  const review = async () => {
    setBusy(true); setError('');
    try {
      if (!categories.length || !context.currencies.length) throw new Error('Categories and currencies are not available. Try again.');
      const checked = reviewRows(rows, mapping, context);
      const duplicates = await importAction<{ row_number: number; kind: 'sku' | 'possible' }[]>('duplicates', null, { rows: checked.map(r => ({ row_number: r.row_number, title: r.data.title, sku: r.data.sku })) });
      setReviewed(checked.map(r => ({ ...r, duplicate: duplicates.find(d => d.row_number === r.row_number)?.kind || r.duplicate })));
      setResults([]);
    } catch (e) { setError(e instanceof Error ? e.message : String((e as { message?: string }).message || 'Review failed.')); }
    finally { setBusy(false); }
  };
  const run = async (retry = false) => {
    if (running.current || !reviewed || !user) return;
    running.current = true; setBusy(true); setError(''); setProgress(0);
    try {
      let id = jobId;
      if (!id) {
        if (!shopId) throw new Error('Create a shop with a cover image first.');
        const created = await importAction<{ id: string }>('create', null, { shop_id: shopId, request_key: requestKey.current, filename, duplicate_mode: mode, rows: reviewed.map(r => ({ ...r.data, validation_error: r.errors.join(' ') || undefined })) });
        id = created.id; setJobId(id);
      }
      const terminal = new Set(results.filter(r => r.status === 'success' || r.status === 'skipped').map(r => r.row_number));
      const eligible = reviewed.filter(r => !r.errors.length && !terminal.has(r.row_number) && (!retry || results.find(s => s.row_number === r.row_number)?.status === 'failed' || !results.find(s => s.row_number === r.row_number)));
      const next = [...results]; let done = 0;
      // Persist each processed row immediately. This avoids holding an uncommitted batch of uploaded assets.
      for (const row of eligible) {
        setStage(`Processing row ${row.row_number} of ${reviewed.length}`);
        let data = row.data; let imageError = '';
        try { data = await processImportImages(data); row.data = data; }
        catch (e) { imageError = `Image processing failed: ${e instanceof Error ? e.message : 'Check URL and browser access.'}`; }
        const saved = await importAction<ImportResult[]>('batch', id, { rows: [{ row_number: row.row_number, data, image_error: imageError }] });
        for (const result of saved) { const index = next.findIndex(r => r.row_number === result.row_number); if (index >= 0) next[index] = result; else next.push(result); }
        setResults([...next]); done++; setProgress(Math.round(done / Math.max(eligible.length, 1) * 100));
      }
      // Read durable results, including invalid rows and any successful uncertain request.
      await openJob(id, false); onImported(); await loadHistory(0); setProgress(100); setStage('Import results saved');
    } catch (e) { setError(`${(e as { message?: string }).message || 'Import interrupted.'} Your saved rows remain in Import history. Resume without duplicating successful rows.`); setStage('Import interrupted'); await loadHistory(0); }
    finally { running.current = false; setBusy(false); }
  };
  const openJob = async (id: string, clearError = true) => {
    if (clearError) setError('');
    const { data, error: e } = await supabase.from('product_import_rows').select('job_id,row_number,source,status,error,product_id').eq('job_id', id).order('row_number').limit(IMPORT_LIMITS.rows);
    if (e) { setError(`Could not load import: ${e.message}`); return; }
    const stored = (data || []) as unknown as StoredRow[];
    const job = history.find(j => j.id === id);
    setJobId(id); if (job) setFilename(job.filename);
    setReviewed(stored.map(r => ({ row_number: r.row_number, data: r.source, errors: validateProduct(r.source, context) })));
    setResults(stored); setPreviewPage(0); setRows([]);
  };
  const changeRow = (number: number, data: ImportProduct) => {
    setReviewed(prev => prev?.map(r => r.row_number === number ? { ...r, data, errors: validateProduct(data, context) } : r) || null);
  };
  const report = () => downloadImportFile('import-report.json', { filename, job_id: jobId, results, rows: reviewed?.filter(r => r.errors.length || results.find(s => s.row_number === r.row_number)?.status === 'failed').map(r => ({ row_number: r.row_number, ...r.data, errors: r.errors, import_error: results.find(s => s.row_number === r.row_number)?.error })) });
  const display = reviewed || preview;
  const failures = results.filter(r => r.status === 'failed').length;
  const successes = results.filter(r => r.status === 'success').length;
  const skipped = results.filter(r => r.status === 'skipped').length;

  return <section className="mx-auto max-w-5xl space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Bulk Product Import</h2><Button variant="outline" disabled={busy} onClick={() => { setRows([]); setReviewed(null); setResults([]); setJobId(null); setFilename(''); setStage(''); }}>New import</Button></div>
    {(error || categoryError) && <div role="alert" className="border border-destructive rounded-lg p-3 text-sm text-destructive">{error || categoryError}</div>}
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => downloadImportFile('product-template.csv', 'title,description,price,currency,category,sku,quantity,images,brand,condition\n"Example product","Describe your product here.",25.50,RWF,"Replace with your category",EXAMPLE-001,10,https://example.com/product.jpg,,new\n')}><Download />CSV template</Button>
      <Button variant="outline" onClick={() => downloadImportFile('product-example.json', [{ ...example, currency: context.defaultCurrency, category: categories[0]?.slug || example.category }])}><Download />JSON example</Button>
    </div>
    <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void selectFile(e.dataTransfer.files[0]); }} className="border-2 border-dashed rounded-lg p-6 text-center space-y-3">
      <FileUp className="h-8 w-8 text-primary mx-auto" /><p className="font-medium">{filename || 'Drop CSV or JSON here'}</p>
      <p className="text-sm text-muted-foreground">Maximum 2MB · 1,000 rows · 2 images per product</p>
      <Input ref={input} type="file" accept=".csv,.json" aria-label="Product import file" className="hidden" disabled={busy} onChange={e => { void selectFile(e.target.files?.[0]); e.target.value = ''; }} />
      <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}><Upload />Choose file</Button>
    </div>
    {!!rows.length && <div className="space-y-4"><h3 className="font-semibold">Match fields</h3><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{IMPORT_FIELDS.map(field => <div key={field} className="space-y-1"><Label htmlFor={`map-${field}`} className="capitalize">{field === 'quantity' ? 'Stock quantity' : field}</Label><Select value={mapping[field] || '__none'} disabled={busy} onValueChange={v => { setMapping(m => ({ ...m, [field]: v === '__none' ? '' : v })); setReviewed(null); }}><SelectTrigger id={`map-${field}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none">Not supplied</SelectItem>{headers.filter(Boolean).map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent></Select></div>)}</div><Button disabled={busy || !context.currencies.length || !categories.length} onClick={review}>Validate and check duplicates</Button></div>}
    {!!display.length && <div className="space-y-4">
      <div className="flex flex-wrap gap-4 text-sm"><span>{display.length} total rows</span><span>{display.filter(r => !r.errors.length).length} valid</span><span className="text-destructive">{display.filter(r => r.errors.length).length} invalid</span><span>{display.filter(r => r.duplicate).length} possible duplicates</span></div>
      <div className="overflow-x-auto border rounded-lg"><table className="w-full text-sm min-w-[620px]"><thead className="bg-muted"><tr>{['Row', 'Product', 'Price', 'Currency', 'Stock', 'Result'].map(h => <th key={h} className="p-3 text-left font-medium">{h}</th>)}</tr></thead><tbody>{display.slice(previewPage * 20, (previewPage + 1) * 20).map(r => <tr key={r.row_number} className="border-t"><td className="p-3">{r.row_number}</td><td className="p-3 max-w-64 break-words">{r.data.title || 'Missing title'}</td><td className="p-3">{r.data.price}</td><td className="p-3">{r.data.currency}</td><td className="p-3">{r.data.quantity}</td><td className="p-3 max-w-80 break-words">{r.errors.join(' ') || results.find(s => s.row_number === r.row_number)?.error || results.find(s => s.row_number === r.row_number)?.status || (r.duplicate ? `${r.duplicate} duplicate` : 'Ready')}</td></tr>)}</tbody></table></div>
      <div className="flex items-center justify-between gap-2"><Button variant="outline" disabled={!previewPage} onClick={() => setPreviewPage(p => p - 1)}>Previous</Button><span className="text-sm">Page {previewPage + 1} of {Math.ceil(display.length / 20)}</span><Button variant="outline" disabled={(previewPage + 1) * 20 >= display.length} onClick={() => setPreviewPage(p => p + 1)}>Next</Button></div>
      {reviewed && !jobId && <div className="space-y-3 border-t pt-4"><Label htmlFor="duplicate-mode">Duplicate handling</Label><Select value={mode} onValueChange={setMode}><SelectTrigger id="duplicate-mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="skip">Skip SKU and possible title duplicates</SelectItem><SelectItem value="update">Update only matching owned SKU; skip title matches</SelectItem><SelectItem value="keep">Keep possible title matches; skip matching SKU</SelectItem></SelectContent></Select><p className="text-sm text-muted-foreground">{valid.length} valid products will enter pending review. Existing products updated by SKU return to pending review.</p><Button disabled={busy || !valid.length || !shopId} onClick={() => void run()}><CheckCircle2 />Confirm import of {valid.length} valid rows</Button></div>}
      {(busy || stage) && <div role="status" className="space-y-2"><p className="text-sm">{stage}</p><Progress value={progress} /></div>}
      {!!results.length && <div className="space-y-3 border-t pt-4"><p className="font-medium">{successes} successful · {skipped} skipped · {failures} failed</p><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={report}><Download />Download report</Button><Button disabled={busy || !reviewed?.some(r => !r.errors.length && !results.some(s => s.row_number === r.row_number && ['success', 'skipped'].includes(s.status)))} onClick={() => void run(true)}><RefreshCw />Retry eligible rows</Button></div>
        {reviewed?.filter(r => results.find(s => s.row_number === r.row_number)?.status === 'failed').slice(previewPage * 20, (previewPage + 1) * 20).map(r => <details key={r.row_number} className="border rounded-lg p-3"><summary className="cursor-pointer text-sm font-medium">Fix row {r.row_number}: {r.data.title}</summary><div className="grid sm:grid-cols-2 gap-3 pt-3">{IMPORT_FIELDS.map(f => <div key={f}><Label htmlFor={`row-${r.row_number}-${f}`} className="capitalize">{f}</Label><Input id={`row-${r.row_number}-${f}`} disabled={busy} value={f === 'images' ? r.data.images.join('|') : r.data[f]} onChange={e => changeRow(r.row_number, { ...r.data, [f]: f === 'images' ? e.target.value.split('|').map(v => v.trim()).filter(Boolean) : e.target.value })} /></div>)}</div></details>)}
      </div>}
    </div>}
    <div className="border-t pt-6 space-y-3"><div className="flex items-center justify-between"><h3 className="font-semibold">Import history</h3><Button variant="ghost" size="icon" aria-label="Refresh import history" disabled={busy} onClick={() => void loadHistory()}><RefreshCw /></Button></div>{historyLoading ? <p className="text-sm text-muted-foreground">Loading import history…</p> : !history.length ? <p className="text-sm text-muted-foreground">No imports yet.</p> : history.map(j => <div key={j.id} className="border rounded-lg p-3 flex flex-wrap justify-between gap-3"><div className="min-w-0"><p className="font-medium break-all">{j.filename}</p><p className="text-xs text-muted-foreground">{new Date(j.created_at).toLocaleString()} · {j.total_rows} rows · {j.status}</p></div><Button variant="outline" disabled={busy} onClick={() => void openJob(j.id)}>View results / resume</Button></div>)}<div className="flex gap-2"><Button variant="outline" disabled={busy || !historyPage} onClick={() => void loadHistory(historyPage - 1)}>Newer</Button><Button variant="outline" disabled={busy || !historyMore} onClick={() => void loadHistory(historyPage + 1)}>Older</Button></div></div>
  </section>;
}