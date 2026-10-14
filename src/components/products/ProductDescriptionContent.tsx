import { useMemo } from 'react';
import { isHtml, sanitizeHtml } from '@/lib/richText';
import { cn } from '@/lib/utils';

/** Renders a product description: sanitized rich HTML, or legacy plain text. */
const ProductDescriptionContent = ({ text, className }: { text: string; className?: string }) => {
  const html = useMemo(() => (isHtml(text) ? sanitizeHtml(text) : null), [text]);
  if (html !== null) {
    return <div className={cn('product-prose', className)} dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return <p className={cn('text-muted-foreground text-sm leading-relaxed whitespace-pre-line', className)}>{text}</p>;
};

export default ProductDescriptionContent;
