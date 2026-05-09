# Migrating Manus CDN assets to R2

Run the dry run first:

```bash
node scripts/migrate-manus-cdn-to-r2.mjs --dry-run
```

The live migration needs these variables in the shell running the command:

```bash
BUILT_IN_FORGE_API_URL=...
BUILT_IN_FORGE_API_KEY=...
```

Safe options:

1. Restart the Cloud Agent after adding the variables in Cursor Cloud environment settings. Existing running agents do not receive newly added environment variables.
2. Create a local, untracked `.env.local` file in the workspace:

```bash
BUILT_IN_FORGE_API_URL=https://...
BUILT_IN_FORGE_API_KEY=...
```

`.env.local` is gitignored and is loaded by the migration script. Do not commit or paste real secret values into PRs, issues, or chat.

Then run:

```bash
node scripts/migrate-manus-cdn-to-r2.mjs
```
