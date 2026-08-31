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

## Stack

React, TypeScript, Vite, Tailwind CSS, TanStack Query, Supabase, Vitest, Playwright, GitHub Actions, and GitHub Pages.

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

Database and browser tests require the local Supabase stack to be running. The browser test creates temporary users and households, exercises inventory and grocery collaboration at desktop and mobile sizes, and removes all synthetic data afterward.
Maintainers can also run `npm run test:hosted` with the three server-side Supabase environment variables documented by the script; it removes all synthetic data in a `finally` block.

## Deployment

1. Create a hosted Supabase project and run `npx supabase db push`.
2. Enable email confirmation and add `https://nicksomitsch.github.io/kitchen/` to the Auth redirect URLs.
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as GitHub Actions repository variables.
4. Set GitHub Pages to use **GitHub Actions** as its source.

Pushing `main` verifies the app and deploys `dist/` to GitHub Pages. The publishable key is designed for browser use; access is enforced by database policies. Never add a Supabase secret or service-role key to this repository.

## Next milestones

Offline/PWA support; barcode and photo recognition; nutrition data; recipe matching and meal planning; optional stores, prices, and shopping routes.
