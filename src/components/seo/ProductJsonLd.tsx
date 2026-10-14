import { useEffect } from 'react';
import { buildProductSchema, type ProductSchemaInput } from '@/lib/productSchema';

/**
 * Single Product JSON-LD for product detail pages. Only real data is emitted:
 * no fabricated brand, ratings, reviews, shipping or return claims.
 * Offer is omitted when the product has no valid price.
 */
const ProductJsonLd = (props: ProductSchemaInput) => {
  const json = JSON.stringify(buildProductSchema(props)).replace(/</g, '\\u003c');
  useEffect(() => {
    let script = document.querySelector('#product-jsonld') as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = 'product-jsonld';
      script.type = 'application/ld+json';
      document.head.appendChild(script);
    }
    script.textContent = json;
    return () => { document.querySelector('#product-jsonld')?.remove(); };
  }, [json]);
  return null;
};

export default ProductJsonLd;
