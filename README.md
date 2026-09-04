# Kitchen Inventory

A mobile-first shared kitchen assistant. Household members track what is on hand, scan barcodes and receipts to fill it in, shop together with live updates across devices, and cook from what the kitchen already holds.

## Features

- Email/password authentication and shared households
- Add, edit, remove, search, filter, and sort inventory items
- Grams, kilograms, millilitres, litres, pieces, and packages
- Safe mass and volume conversion when changing units
- Shared categories and storage locations
- Out-of-stock tracking, duplicate warnings, and concurrent-edit protection
- One shared grocery list grouped by category
- Linked inventory groceries and flexible free-form entries
- Optional low-stock thresholds that create and resolve grocery entries automatically
- Best-before dates with a “use soon” shelf, filters, and sorting
- Purchase review that can restock an existing item, create a new item, or complete without stocking
- Persistent purchase history with “add again” and clear-history controls
- Responsive phone cards and desktop table
- Supabase Row Level Security and Realtime synchronization
- Installable PWA with an offline application shell
- Seven-day device cache for household data
- Offline inventory and grocery changes with durable queued synchronization
- Conflict review when another member changes the same record first
- On-device barcode scanning with nutrition lookup from Open Food Facts
- An editable nutrition panel and a remembered product cache per household
- Photo and receipt recognition that proposes items for review before anything is added
- Recipes scored by how much of each one the kitchen already holds
- One-tap shopping for the ingredients a recipe is short of
- “Cooked it” that subtracts what a meal used and feeds the low-stock rules
- A weekly meal plan that can shop for every planned recipe at once
- Shared diet tags and an avoid list that rank and flag recipes

## Stack

React, TypeScript, Vite, Tailwind CSS, TanStack Query, Dexie/IndexedDB, Supabase, Workbox, Vitest, Playwright, GitHub Actions, and GitHub Pages. Barcodes are decoded on the device with ZXing WebAssembly, product data comes from Open Food Facts, and image recognition runs in a Supabase Edge Function that calls the Claude API.

## Scanning and recognition

Three ways to fill the inventory, each ending in a confirmation screen you edit before anything is saved:

1. **Barcode.** The rear camera decodes EAN, UPC, Code 128, and ITF codes entirely on the device; no frame is uploaded. Browsers with a native `BarcodeDetector` use it, and everything else lazily loads a self-hosted WebAssembly decoder. Typing the digits by hand always works. Scanning a barcode you already own opens that item instead of creating a duplicate.
2. **Product photo.** A photo of one or more products is recognised into named, sized candidates.
3. **Receipt.** A photo of a receipt is transcribed into its grocery lines, skipping subtotals, taxes, and payment lines.

Barcodes resolve against the household's own cache first, which works offline for anything scanned before, then against Open Food Facts. That database is community-maintained and can be incomplete or wrong, so every field it fills in — including the whole nutrition panel — stays editable, and editing a value records it as the household's own.

Photo and receipt recognition requires the `scan-image` Edge Function. Without it the app says so and the other two routes keep working. The function reads its provider key from a function secret that never reaches the browser, and it claims a daily per-person credit using the caller's own token, so the allowance and household membership are enforced by the database rather than by the function. Recognition only ever proposes lines; text inside an image is treated as data to transcribe, never as an instruction.

Two providers are supported and produce the same result shape, so the app never needs to know which one answered:

| Provider | Secrets required | Default model | Cost |
| --- | --- | --- | --- |
| Google Gemini | `GEMINI_API_KEY` | `gemini-2.5-flash-lite` | Free tier, no card required |
| Anthropic Claude | `ANTHROPIC_API_KEY` **and** `SCAN_PROVIDER=anthropic` | `claude-opus-5` | Paid per scan |

Gemini is the only provider that starts on its own. Anthropic is opt-in and needs `SCAN_PROVIDER=anthropic` as well as its key, so a stray `ANTHROPIC_API_KEY` can never begin billing by accident, and its SDK is not even loaded unless that provider is chosen. `GEMINI_MODEL` and `ANTHROPIC_MODEL` override the model. Note that Google may use **free-tier** inputs and outputs to improve its models, which is worth weighing against receipt photos; Gemini's paid tier and Anthropic's API do not carry that clause.

## Recipes and meal planning

Recipe ranking is deliberately transparent rather than a black box. The headline number is plain ingredient coverage — “7 of 9 ingredients in stock” — measured by matching each ingredient to an inventory item by explicit link or by name, then converting units where they are comparable. Small bonuses only break ties between close matches: using something near its best-before date, a favourite, a recipe under thirty minutes, or a matching diet tag. Anything on the household's avoid list is flagged and sorted last.

“Shop what's missing” adds only the shortfall, scaled to the servings you chose. “Cooked it” subtracts the matched amounts from inventory, which can trigger the low-stock rules and put the items straight back on the grocery list. The weekly planner does the same for every recipe planned in a date range at once.

## Offline behavior

Visit and sign in online once before relying on offline mode. Kitchen then caches the application and the latest household data on that browser for seven days. Inventory and grocery adds, edits, deletes, purchases, repeats, and low-stock changes are stored in an on-device outbox and synchronize when the open app can reach Supabase again.

The header shows connection and synchronization state. Conflicts retain the offline draft and can be resolved from the synchronization panel by keeping the latest server version or reapplying the draft. Account, household, member, category, location, join-code, and bulk history changes require a connection.

Pending commands remain until they synchronize or are discarded. Signing out clears cached household data and warns before discarding unsynchronized changes. Browser storage is scoped by user and household but is not separately encrypted; removing a member cannot erase data already cached on an offline device until that device reconnects.

Barcode scanning works offline for products the household has scanned before, because the product cache and the WebAssembly decoder are both kept on the device after first use. Recipes and the meal plan are readable offline from the same seven-day cache, but saving them, looking up an unknown barcode, and image recognition all need a connection.

## Local setup

Requirements: Node.js 22+, Docker, and the Supabase CLI.

```bash
npm install
npx supabase start
cp .env.example .env.local
```

Copy the local API URL and publishable/anon key shown by `npx supabase status` into `.env.local`, then run:

```bash
npm run dev
```

The site is served under `/kitchen/`. Confirmation messages from the local email service are available at `http://127.0.0.1:54324`.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run test:db
RUN_E2E=1 npm run test:e2e
npm run build
```

Database and browser tests require the local Supabase stack to be running. Playwright builds and serves the production PWA, creates temporary users and households, exercises desktop and mobile collaboration, reloads from the cache while offline, synchronizes queued work, and removes all synthetic data afterward.
Maintainers can also run `npm run test:hosted` with the three server-side Supabase environment variables documented by the script; it removes all synthetic data in a `finally` block.

## Deployment

1. Create a hosted Supabase project and run `npx supabase db push` before deploying the frontend. The offline command migration is additive and preserves the previous RPCs for already-open clients.
2. Enable email confirmation and add `https://nicksomitsch.github.io/kitchen/` to the Auth redirect URLs.
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as GitHub Actions repository variables.
4. Set GitHub Pages to use **GitHub Actions** as its source.
5. Optional, to enable photo and receipt recognition. Set one provider key:

   ```bash
   npx supabase secrets set GEMINI_API_KEY=...
   ```

   ```bash
   npx supabase functions deploy scan-image
   ```

   `SCAN_DAILY_LIMIT` (default 40) tunes the per-person daily allowance, and `SCAN_EFFORT` (`low`, `medium`, or `high`; default `medium`) applies to the Anthropic provider only. Keys live only in the function's environment; never add one to this repository or to a `VITE_` variable.

Pushing `main` verifies the app and deploys `dist/` to GitHub Pages. The generated service worker is scoped to `/kitchen/`, precaches only public application assets, and does not cache authenticated Supabase responses. The publishable key is designed for browser use; access is enforced by database policies. Never add a Supabase secret or service-role key to this repository.

## Next milestones

Purchase prices and spending history; food-waste tracking; grocery grouping by store aisle; CSV and JSON import and export; AI-suggested substitutions and generated recipes.
