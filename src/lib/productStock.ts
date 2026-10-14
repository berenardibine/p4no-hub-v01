// Shared stock helpers — one place to decide Sold Out / Unlimited display.
type StockLike = {
  description_structured?: unknown;
  unlimited_quantity?: boolean | null;
  quantity?: number | null;
} | null | undefined;

export function isProductSoldOut(p: StockLike): boolean {
  const ds = p?.description_structured as { sold_out?: boolean } | null | undefined;
  return !!ds?.sold_out;
}

export function isUnlimitedStock(p: StockLike): boolean {
  return !!p?.unlimited_quantity;
}
