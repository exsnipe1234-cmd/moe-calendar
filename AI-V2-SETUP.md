# Music Delight AI v2 setup

The website files are ready, but the Supabase Edge Function must also be replaced because the original backend only understands "add".

## Deploy in Supabase Dashboard

1. Open Supabase → Edge Functions → `calendar-ai`.
2. Replace the function with `supabase/functions/calendar-ai/index.ts` from this package.
3. Confirm the secret `OPENAI_API_KEY` still exists under Edge Function secrets.
4. Deploy the function.
5. Upload the website files to GitHub and wait for GitHub Pages to deploy.
6. Hard refresh the calendar with Ctrl+Shift+R.

## Suggested tests

- `Show Gerald lessons in August`
- `Who is free tomorrow?`
- `Find teacher conflicts this month`
- `Move Gerald's Compassvale lesson tomorrow to 3pm`
- `Change Joel to Wero next Friday`
- `Delete all Joel lessons in August`

Every add, update and delete action requires confirmation in the website before the database changes.
