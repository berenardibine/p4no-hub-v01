// Product description editor — reuses the project's existing TipTap stack.
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import {
  Bold, Italic, Underline as UnderlineIcon, Heading1, Heading2, Heading3, List, ListOrdered,
  Link as LinkIcon, Table as TableIcon, Pilcrow, Undo2, Redo2, Rows3, Columns3, Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { plainToHtml } from '@/lib/richText';

const Btn = ({ active, onClick, title, children }: { active?: boolean; onClick: () => void; title: string; children: React.ReactNode }) => (
  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} title={title} aria-label={title}
    className={cn('h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground',
      active && 'bg-primary text-primary-foreground hover:bg-primary')}>
    {children}
  </button>
);

const InsertTable = ({ editor }: { editor: Editor }) => {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const clamp = (n: number) => Math.max(1, Math.min(20, n || 1));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" title="Insert Table" aria-label="Insert Table"
          className="h-8 px-2 inline-flex items-center gap-1 rounded-md hover:bg-accent text-muted-foreground text-xs font-medium">
          <TableIcon className="h-4 w-4" /> Table
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 space-y-3" align="start">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="tbl-rows" className="text-xs">Rows</Label>
            <Input id="tbl-rows" type="number" min={1} max={20} value={rows} onChange={(e) => setRows(clamp(+e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tbl-cols" className="text-xs">Columns</Label>
            <Input id="tbl-cols" type="number" min={1} max={10} value={cols} onChange={(e) => setCols(Math.min(10, clamp(+e.target.value)))} />
          </div>
        </div>
        <Button type="button" size="sm" className="w-full" onClick={() => {
          editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
          setOpen(false);
        }}>Insert Table</Button>
      </PopoverContent>
    </Popover>
  );
};

const Toolbar = ({ editor }: { editor: Editor }) => {
  const addLink = () => {
    const prev = editor.getAttributes('link').href;
    const url = window.prompt('Link URL', prev || 'https://');
    if (url === null) return;
    if (url === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
  };
  const inTable = editor.isActive('table');
  return (
    <div className="flex flex-wrap items-center gap-0.5 p-1.5 border-b border-border sticky top-0 bg-background z-10 rounded-t-xl">
      <Btn active={editor.isActive('paragraph')} onClick={() => editor.chain().focus().setParagraph().run()} title="Paragraph"><Pilcrow className="h-4 w-4" /></Btn>
      <Btn active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1"><Heading1 className="h-4 w-4" /></Btn>
      <Btn active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2"><Heading2 className="h-4 w-4" /></Btn>
      <Btn active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Heading 3"><Heading3 className="h-4 w-4" /></Btn>
      <span className="w-px h-5 bg-border mx-1" />
      <Btn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold"><Bold className="h-4 w-4" /></Btn>
      <Btn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic"><Italic className="h-4 w-4" /></Btn>
      <Btn active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline"><UnderlineIcon className="h-4 w-4" /></Btn>
      <Btn active={editor.isActive('link')} onClick={addLink} title="Link"><LinkIcon className="h-4 w-4" /></Btn>
      <span className="w-px h-5 bg-border mx-1" />
      <Btn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list"><List className="h-4 w-4" /></Btn>
      <Btn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list"><ListOrdered className="h-4 w-4" /></Btn>
      <InsertTable editor={editor} />
      {inTable && (
        <>
          <Btn onClick={() => editor.chain().focus().addRowAfter().run()} title="Add row"><Rows3 className="h-4 w-4" /></Btn>
          <Btn onClick={() => editor.chain().focus().addColumnAfter().run()} title="Add column"><Columns3 className="h-4 w-4" /></Btn>
          <Btn onClick={() => editor.chain().focus().deleteTable().run()} title="Delete table"><Trash2 className="h-4 w-4" /></Btn>
        </>
      )}
      <span className="w-px h-5 bg-border mx-1" />
      <Btn onClick={() => editor.chain().focus().undo().run()} title="Undo"><Undo2 className="h-4 w-4" /></Btn>
      <Btn onClick={() => editor.chain().focus().redo().run()} title="Redo"><Redo2 className="h-4 w-4" /></Btn>
    </div>
  );
};

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

const ProductDescriptionEditor = ({ value, onChange, placeholder }: Props) => {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
        link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } },
      }),
      Placeholder.configure({ placeholder: placeholder || 'Describe your product…' }),
      Table.configure({ resizable: false }),
      TableRow, TableCell, TableHeader,
    ],
    content: plainToHtml(value),
    onUpdate: ({ editor }) => onChange(editor.isEmpty ? '' : editor.getHTML()),
    editorProps: {
      attributes: {
        // Grows with content; no fixed-height inner scroll box.
        class: 'product-prose min-h-[180px] focus:outline-none px-3 py-3',
      },
    },
  });

  // Re-sync when value is replaced externally (draft restore, AI enhance).
  const lastExternal = useRef(value);
  useEffect(() => {
    if (!editor || value === lastExternal.current) return;
    lastExternal.current = value;
    if (value !== editor.getHTML()) editor.commands.setContent(plainToHtml(value), { emitUpdate: false });
  }, [value, editor]);
  useEffect(() => {
    if (!editor) return;
    const h = () => { lastExternal.current = editor.isEmpty ? '' : editor.getHTML(); };
    editor.on('update', h);
    return () => { editor.off('update', h); };
  }, [editor]);

  if (!editor) return <div className="min-h-[220px] rounded-xl border border-input bg-background" />;
  return (
    <div className="rounded-xl border border-input bg-background">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
};

export default ProductDescriptionEditor;
