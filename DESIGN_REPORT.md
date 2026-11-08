# Local design update

Implemented directly in C:\Users\Admin\Documents\restro, not in the cloud.

## Changes
- Premium customer homepage: cinematic Indian-food hero, warm saffron calls to action, live featured-dish carousel, photographed category navigation, responsive dish cards, veg/non-veg badges, search, chef-note customization, sticky delivery bag, booking banner and restaurant-details footer.
- Staff entrance with food imagery, serif display typography and consistent Lucide icons; polished 15-table floor, thumbnail ordering, kitchen Kanban counts/empty states/timers, counter/admin headings, refined glass panels and printable receipt typography.
- Seven licensed Pexels photos plus a hero crop, locally optimized as WebP (about 906 KiB total). Lazy loading and responsive next/image output; no image hotlinks. Photos are explicitly representative, not actual restaurant dishes. Full sources/photographers/license: CREDITS.md.
- Keyboard focus indicators, reduced-motion support and mobile layouts. No menu prices, order APIs, payment-provider configuration or real restaurant records changed.
- Node engines >=20.19. Uses this PC's private Node 22.21.1 through run-restro.cmd; other applications are unaffected.
- Next.js and matching eslint-config-next patched from 15.5.4 to 15.5.29 after an audit found inherited critical Next.js advisories.

## Backup
restro-pre-design-20261108.zip contains the original src, package.json, package-lock.json and README before edits. Stop Restro before restoring. The database was not replaced.

## Verification
- Typecheck: passed.
- ESLint: passed.
- Automated tests: 11 passed (9 service/RBAC/payment/aggregator regressions, 2 image mapping tests).
- Production build: passed using Next.js 15.5.29 and Node 22.21.1.
- Tests use the isolated app database restro_design_test. Existing restro_db orders and other databases are not truncated by tests. Default npm test expects restro_test; use scripts/verify-design.ps1 for the isolated design test database.
- Live browser results and screenshots: screenshots/verification.json and screenshots/*.png.

## Remaining inherited security work
The updated dependency audit still reports 12 advisories (8 moderate, 2 high, 2 critical). Critical entries are in development test tooling (vitest/tinypool); runtime/transitive advisories also remain, including sharp/postcss. See design-audit.json. Do not expose this demo to the internet until dependencies and demo credentials/provider settings have been reviewed. No forced breaking framework or test-runner upgrades were applied as part of this visual redesign.

## Running
Double-click run-restro.cmd, then open http://localhost:3847. Staff entrance: /staff. Staff roles and permissions remain unchanged. Logs: restro.out.log and restro.err.log (these also contain historical entries). No trading-desk processes or ports 8741/8742 were changed.

Final live browser verification passed: /, /staff, /waiter, /kitchen, /billing, /admin, /book and /account all returned 200; all eight local image assets and the Next image optimizer returned 200. All four staff demo roles signed in. Exactly 15 table tiles were present. Customer dish-to-cart interaction passed. No browser page/console errors and no horizontal overflow at 390px mobile width. Screenshots captured with local headless Chrome through Playwright.

Billing layout refinement: the counter now shows all 15 tables in a compact grid (rather than a long vertical list), with an editorial bill-preview empty state. Existing payment, split, discount and parcel actions are unchanged. Browser sign-ins create normal session/audit entries; existing menu prices, orders and payment records were not modified by visual tests.
