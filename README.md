# Kitchen Inventory

A mobile-first shared kitchen inventory and grocery list. Household members can track what is on hand, automatically surface low-stock items, and shop together with live updates across devices.

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
- Purchase review that can restock an existing item, create a new item, or complete without stocking
- Persistent purchase history with “add again” and clear-history controls
- Responsive phone cards and desktop table
- Supabase Row Level Security and Realtime synchronization
- Installable PWA with an offline application shell
- Seven-day device cache for household data
- Offline inventory and grocery changes with durable queued synchronization
- Conflict review when another member changes the same record first

## Stack

React, TypeScript, Vite, Tailwind CSS, TanStack Query, Dexie/IndexedDB, Supabase, Workbox, Vitest, Playwright, GitHub Actions, and GitHub Pages.

## Offline behavior

Visit and sign in online once before relying on offline mode. Kitchen then caches the application and the latest household data on that browser for seven days. Inventory and grocery adds, edits, deletes, purchases, repeats, and low-stock changes are stored in an on-device outbox and synchronize when the open app can reach Supabase again.

The header shows connection and synchronization state. Conflicts retain the offline draft and can be resolved from the synchronization panel by keeping the latest server version or reapplying the draft. Account, household, member, category, location, join-code, and bulk history changes require a connection.

Pending commands remain until they synchronize or are discarded. Signing out clears cached household data and warns before discarding unsynchronized changes. Browser storage is scoped by user and household but is not separately encrypted; removing a member cannot erase data already cached on an offline device until that device reconnects.

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

Pushing `main` verifies the app and deploys `dist/` to GitHub Pages. The generated service worker is scoped to `/kitchen/`, precaches only public application assets, and does not cache authenticated Supabase responses. The publishable key is designed for browser use; access is enforced by database policies. Never add a Supabase secret or service-role key to this repository.

## Next milestones

Barcode and photo recognition; nutrition data; recipe matching and meal planning; optional stores, prices, and shopping routes.
