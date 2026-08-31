# Kitchen Inventory

A personal, mobile-first web app for knowing what is in the kitchen, planning the next grocery trip, and finding recipes that use what is already available.

## Planned features

- Add, edit, remove, search, filter, and sort inventory items
- Track quantities and units such as g, kg, ml, l, pieces, and packages
- Store nutrition data, categories, locations, expiry dates, and low-stock levels
- Build a grocery list manually or from low-stock items and recipes
- Scan barcodes or photos to prefill product and nutrition details before confirmation
- Recommend recipes by ingredient coverage, expiry priority, preferences, and available time
- Install as a PWA and keep the grocery list usable on mobile

## Proposed stack

- React, TypeScript, and Vite for the frontend
- Tailwind CSS for styling
- Supabase for Postgres data, authentication, image storage, and secure server-side functions
- Open Food Facts for barcode and nutrition lookups
- GitHub Actions and GitHub Pages for frontend deployment
- Vitest and Playwright for testing

GitHub Pages serves only the static frontend. Secrets and image-analysis requests must run through a backend function and must never be embedded in browser code.

## Suggested delivery order

1. Inventory CRUD, search, sorting, filters, and unit handling
2. Grocery list, low-stock rules, and quick inventory adjustments
3. Authentication, cloud sync, export, and offline-friendly PWA support
4. Barcode lookup, then photo or receipt recognition with a review step
5. Recipe matching, expiry-aware suggestions, and meal planning

## Status

Planning stage. The first milestone is a small inventory and grocery-list MVP.

## Development

Setup and local-development commands will be added when the application is scaffolded.
