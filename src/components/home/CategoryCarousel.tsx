import { isProductSoldOut } from '@/lib/productStock';
import { useCarouselScroll } from '@/hooks/useCarouselScroll';
import { Button } from '@/components/ui/button';
import { ChevronRight, ChevronLeft, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import FloatingProductCard from './FloatingProductCard';
import { cn } from '@/lib/utils';

interface Product {
  id: string;
  slug?: string | null;
  rental_unit?: string | null;
  title: string;
  price: number;
  images: string[];
  sponsored?: boolean | null;
  admin_posted?: boolean | null;
  currency_symbol?: string | null;
  is_negotiable?: boolean | null;
  discount?: number | null;
  discount_expiry?: string | null;
  location?: string | null;
}

interface CategoryCarouselProps {
  categoryName: string;
  categorySlug: string;
  categoryIcon: string;
  categoryColor: string;
  products: Product[];
  autoScrollInterval?: number;
}

const CategoryCarousel = ({
  categoryName,
  categorySlug,
  categoryIcon,
  categoryColor,
  products,
  autoScrollInterval = 4000,
}: CategoryCarouselProps) => {
  const { scrollRef, handlers, scroll: handleScroll } = useCarouselScroll(autoScrollInterval, products.length);

  if (products.length === 0) return null;

  return (
    <div 
      className="animate-fade-up group"
      {...handlers}
      role="region"
      aria-label={categoryName}
    >
      {/* Header */}
      <div className={cn(
        "flex items-center justify-between px-4 py-3.5 rounded-t-2xl",
        `bg-gradient-to-r ${categoryColor}`
      )}>
        <div className="flex items-center gap-2.5">
          <span className="text-xl drop-shadow-md">{categoryIcon}</span>
          <h3 className="font-bold text-primary-foreground text-base min-w-0 break-words">{categoryName}</h3>
          <span className="text-[10px] font-medium bg-white/25 text-white px-2 py-0.5 rounded-full backdrop-blur-sm">
            {products.length}
          </span>
        </div>
        <Button variant="ghost" size="sm" asChild
          className="flex items-center gap-1 text-white/90 hover:text-white text-xs font-semibold bg-white/15 px-3 py-1.5 rounded-full backdrop-blur-sm hover:bg-white/25 transition-all"
        >
          <Link to={`/category/${categorySlug}`}>View All <ArrowRight className="h-3 w-3" /></Link>
        </Button>
      </div>

      {/* Carousel */}
      <div className="relative bg-card/80 backdrop-blur-sm rounded-b-2xl shadow-lg border border-border/50 p-3">
        {products.length > 2 && (
          <>
            <Button variant="ghost" size="icon-sm"
              aria-label="Previous"
              onClick={() => handleScroll('left')}
              className="absolute left-1 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-background/90 shadow-md flex items-center justify-center hover:bg-background transition-colors opacity-0 group-hover:opacity-100"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon-sm"
              aria-label="Next"
              onClick={() => handleScroll('right')}
              className="absolute right-1 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-background/90 shadow-md flex items-center justify-center hover:bg-background transition-colors opacity-0 group-hover:opacity-100"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </>
        )}

        <div
          ref={scrollRef}
          tabIndex={0}
          aria-label={`${categoryName} products`}
          className="flex gap-2.5 overflow-x-auto scrollbar-hide motion-safe:scroll-smooth px-1"
        >
          {products.map((product) => (
            <div key={product.id} className="w-[155px] shrink-0">
              <FloatingProductCard
                id={product.id} soldOut={isProductSoldOut(product as any)}
                slug={product.slug || undefined}
                title={product.title}
                price={product.price}
                images={product.images}
                rentalUnit={product.rental_unit}
                isSponsored={product.admin_posted ? false : product.sponsored}
                hideSponsored={product.admin_posted}
                currencySymbol={product.currency_symbol}
                isNegotiable={product.is_negotiable}
                discount={product.discount}
                discountExpiry={product.discount_expiry}
                location={product.location}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CategoryCarousel;
