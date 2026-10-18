# Homepage discovery implementation and validation

## Root causes

- New Arrivals, the top category carousels, and Explore Products reused the same IDs independently.
- Category sections rendered once near the top and again inside the dynamic feed.
- After exhaustion, the homepage appended literal copies of the existing feed instead of creating a new shuffled cycle.
- Pagination sliced a full `products/all` download in the browser; generation capped that list at the newest 1,000 products.
- Both horizontal carousel implementations reset to zero and resumed shortly after touch. Keyboard focus and reduced-motion preferences were ignored.
- The callback-ref observer did not reliably clean itself up.

## Strategy

- Generate a small `products/discovery/index` and 40-card pages with the existing static generator. Generation reads active products in deterministic ID order through bounded, keyset-paginated DB queries, without the old 1,000-product limit. Explicit sold-out products are excluded using the existing stock convention.
- Shuffle page order once per mounted feed cycle and shuffle each page deterministically. Stable product IDs share one seen set across New Arrivals and the discovery/category sections. Promotional featured, popular, boosted and best-deal sections remain independently curated.
- New Arrivals retains its existing bounded latest-product source. Its IDs are reserved before paginated discovery begins.
- Infinite scrolling fetches the next page only. A failed page remains retryable and does not advance the cycle. After exhaustion, **Explore again** starts a fresh shuffled cycle and appends content rather than moving the main page to the top.
- Category sections own their product cards; general groups exclude those cards. One category appears near the top, with remaining categories distributed among groups. Rare categories are reserved for their own section rather than consumed by a general group. Category identity uses stable IDs and matching supports existing assigned slug/name/ID values.
- Existing manifest events reconcile visited pages and update eligibility/metadata without resetting the entire feed. No new polling or Realtime subscription.
- Carousels share horizontal movement logic. Automatic movement stops at the end, pauses on hover/focus, permanently stops after manual pointer/touch/wheel interaction, respects reduced motion, and does not animate offscreen rails. No duplicated cards for animation.
- Category navigation uses actual links and lists all existing categories; category links do not depend on reaching a scroll trigger.

## Changed files

- `src/lib/homeDiscovery.ts` — cycle state, shuffle, eligibility, membership helpers.
- `src/lib/productCache.ts` — discovery index/page CDN helpers.
- `src/hooks/useDynamicHomeFeed.tsx` — shared paged feed and progressive category allocation.
- `src/pages/Index.tsx` — remove copied repeat loop and duplicate top category rendering; observer cleanup, retry and next-cycle controls.
- `src/hooks/useCarouselScroll.ts` — shared interaction-aware horizontal movement.
- `src/components/home/AutoScrollCarousel.tsx` and `CategoryCarousel.tsx` — shared movement, keyboard focus, navigation links and preserved product enrichments.
- `src/components/home/HomeCategoriesGrid.tsx` — real category links, all categories retained.
- `supabase/functions/static-generate/index.ts` — bounded static discovery pages, full catalog generation and required listing metadata.
- `supabase/functions/_shared/depGraph.ts` — explicit discovery dependency for product/category/seller/shop changes.
- `src/test/homeDiscovery.test.ts`, `dynamicHomeFeed.test.tsx`, `carouselScroll.test.tsx` — focused rule/regression tests.
- `package.json` and Bun lockfile — restored dependencies required by existing tests.
- `AGENTS.md`, `roadmap.md` — architecture and completion tracking.

No database tables, migrations, RLS policies, product mutations, checkout logic, or financial functions changed.

## Deployment and data efficiency

- Deployed `static-generate` and `static-worker` successfully.
- Ran one administrative product-generation request to seed the new discovery pages; it succeeded and published seven pages plus the index. Scrolling never invokes generation.
- Existing CDN guard, browser/IndexedDB caching, manifest versioning, single-flight deduplication and unchanged-payload upload skipping remain in use.
- Real browser checks fetched the index and all seven bounded discovery pages, with **no `products/all.json` request**.
- Full product records accumulate only as users actually browse; the seen set retains IDs for the current cycle. There is no initial full-catalog browser download. Generation-side DB work is still catalog-wide for relevant changes; this is not an incremental generation redesign. No claim of measured bandwidth or egress savings is made.

## Tests actually performed

- Database read: 249 active products; 242 available under the existing explicit sold-out flag.
- Automated tests: **18 passed** across cycle rules, eligibility/country filtering, stable shuffle, new-page reconciliation, shared section IDs, rare categories, failed-page retry, manifest-change reconciliation, horizontal end behavior, touch/focus/reduced-motion pauses, short-carousel fallback, and existing USDT tests.
- Real public homepage flow at **1280×1800** and **390×844**: scrolled through all seven pages; **242 cards and 242 unique IDs** on both sizes, matching the database availability count.
- Verified five populated category sections (including one-product categories) appear at different page depths, without repeating categories. Checked every category-section card against the actual generated category assignment.
- Verified no horizontal page overflow and no page runtime exceptions during discovery.
- Verified automatic horizontal movement, unchanged vertical scroll during focused pause, and manual movement remaining unchanged afterward.
- Opened actual product cards on desktop/mobile: detail URLs resolved and the expected product titles appeared. Screenshots confirmed preserved product details.
- Verified the next-cycle button appends content and does not send the page to the top.
- Latest harness result: **build OK**, including type checking.

## Limitations / unverified cases

- An existing unrelated SEO regression test fails: `productSchema.test.ts` expects `Frw` to normalize to `RWF`, but the current schema returns `FRW`. The other four SEO tests pass. Left unchanged to keep this implementation focused.
- Product changes were exercised with mocked manifest/page data, not destructive mutations of live products.
- No signed-in checkout, cart purchase, Google crawler/rich-results audit, production load test, real-device performance measurement, or physical touchscreen drag test was performed.
- The new frontend still needs normal app publishing to reach the public site; only the two existing Edge Functions and discovery static payloads were deployed here.