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
- Node / Express production server
- Leaflet / OpenStreetMap
- Turf.js for cluster geometry
- OpenRouter for server-side OCR and optional email generation

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

Preview the production build locally without the secure API proxy:

```bash
npm run preview
```

Run the production server locally:

```bash
npm run build
npm start
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

This app is ready to deploy as a Render Web Service.

### Recommended setup

1. Create a new GitHub repo from this folder:
   `C:\Users\crock\Documents\Lead-Helper\WebApp\lead-helper-shell`
2. Push this folder as the repo root
3. In Render, create a new Web Service from that GitHub repo
4. Render will detect `render.yaml`
5. Add the `OPENROUTER_API_KEY` environment variable before using OCR or AI email generation
6. Deploy

### Build settings

If you configure Render manually instead of using the blueprint:

- Build Command: `npm ci && npm run build`
- Start Command: `npm start`

## Environment Variables

OpenRouter is called through the Node server so the API key is not exposed to the phone/browser.

Required runtime variable for OCR and AI email generation:

- `OPENROUTER_API_KEY`

Optional runtime variables:

- `OPENROUTER_OCR_MODEL`
- `OPENROUTER_EMAIL_MODEL`

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
