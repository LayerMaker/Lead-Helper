# Lead Helper

Lead Helper is a mobile-first fieldwork web app for commercial dealership outreach.

It helps you:

- discover new-car dealerships on a map
- group them into workable field clusters
- route through those clusters
- log visit outcomes quickly
- capture business cards and contact media
- generate follow-up emails
- schedule reminders
- create report-style proof of work

## Stack

- React
- Vite
- React Router
- Leaflet / OpenStreetMap
- Turf.js for cluster geometry
- OpenRouter for OCR and optional email generation

## Local Development

Install dependencies:

```bash
npm ci
```

Start the dev server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## Data Commands

Build normalized dealership data:

```bash
npm run data:build
```

Collect London new-car discovery candidates:

```bash
npm run data:collect:london:newcar
```

## Deploy To Render

This app is ready to deploy as a Render static site.

### Recommended setup

1. Create a new GitHub repo from this folder:
   `C:\Users\crock\Documents\Lead-Helper\WebApp\lead-helper-shell`
2. Push this folder as the repo root
3. In Render, create a new Static Site from that GitHub repo
4. Render will detect `render.yaml`
5. Deploy

### Important for React Router

This app uses client-side routing.

Render therefore needs a rewrite rule:

- Source: `/*`
- Destination: `/index.html`
- Action: `Rewrite`

That rule is already defined in `render.yaml`.

### Build settings

If you configure Render manually instead of using the blueprint:

- Build Command: `npm ci && npm run build`
- Publish Directory: `dist`

## Environment Variables

The app can run without build-time secrets because OpenRouter keys can also be entered in-app and stored locally.

Optional build-time variables:

- `VITE_OPENROUTER_API_KEY`
- `VITE_OPENROUTER_OCR_MODEL`
- `VITE_OPENROUTER_EMAIL_MODEL`

## Current Product Status

Working now:

- discovery map
- operational cluster workflow
- route logging
- OCR capture flow
- email generation and handoff
- dashboard reminders
- report generation

Still worth refining after deployment:

- PDF export visual fidelity across browsers
- authenticated Outlook / Graph sending
- backend persistence and multi-device sync
- richer discovery clustering and filtering
