# Lead Helper Deployment

Lead Helper deploys on Render from the `WebApp/lead-helper-shell` app.

Render service name in `render.yaml`:

`lead-helper`

## Local Secret

Do not commit the Render deploy hook URL.

Store it locally in the gitignored `.env.local` file:

```text
RENDER_LEAD_HELPER_DEPLOY_HOOK=https://api.render.com/deploy/...
```

Alternatively, store it as a Windows environment variable:

```powershell
setx RENDER_LEAD_HELPER_DEPLOY_HOOK "https://api.render.com/deploy/..."
```

Open a new terminal after running `setx`, because existing terminals do not automatically receive the updated environment.

## Deploy Commands

From this directory:

```powershell
npm run deploy:render
```

Trigger a deploy for the current git commit:

```powershell
npm run deploy:render:current
```

Run lint, build, then deploy current commit:

```powershell
npm run ship:render
```

`ship:render` currently runs the production build before triggering Render. Run `npm run lint` separately when you want the stricter React/ESLint gate.

## Field Workflow

For Telegram/Hermes/Codex work:

1. Make the requested change.
2. Run `npm run build`. Run `npm run lint` too when the existing lint baseline is clean or the user asks for a stricter check.
3. Commit and push to the branch Render reads.
4. Trigger Render with `npm run deploy:render:current`.
5. Report the commit SHA and deploy trigger status back to the user.

Only deploy after the user explicitly says to deploy, ship, publish, or push live.
