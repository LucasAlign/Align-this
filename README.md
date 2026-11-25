# Align-this

Lucas Align's outreach workspace for U.S. foster care and adoption organizations. Track nonprofits, churches, and agencies from first contact through partnership.

## Run locally

With Node.js 24 or newer, run:

```sh
node --env-file-if-exists=.env server/index.js
```

Open http://127.0.0.1:3000. The app creates its database at `data/align.sqlite` and starts with an empty directory. No package installation is required. Back up the SQLite database using SQLite's backup tools if the app is running.

## Outreach

- Use the directory to add organizations, search and filter, or import and export CSVs. CSV import accepts up to 1,000 records with columns `name,type,focus,scope,state` plus optional fields such as `city,website,status,summary`. Import is all-or-nothing.
- Use an organization profile to manage contacts, notes, interactions, signups, and assigned tasks. Interaction notes can suggest a follow-up for the user to review.
- Move an organization to **Partnering** to see it on the map. Click a state to filter the directory. Map history uses the last recorded status and state for each day.
- Use Follow-ups for open and overdue tasks, Signups for intake follow-up, and Reports for state totals and CSV export. Add signups from an organization profile.

## Discovery

Copy `.env.example` to `.env` and set `BRAVE_SEARCH_API_KEY` to enable discovery. Keep the server running with a persistent database volume. Discovery runs once per Eastern calendar day after 6 a.m. by default, using `DISCOVERY_HOUR` for overrides. Each run searches for both foster care and adoption in five states, rotating through all 50 states over ten days. The run log shows completion or failure. A run interrupted by a server restart can be reclaimed after 20 minutes.

The search makes ten Brave Search API requests per run. Results are deduplicated by website domain and saved with source links and discovery dates. Review the suggested name, location, type, and focus before approval. Approval adds the organization as **Unreached**.

## Shared deployment

For access beyond the local machine, configure `ALIGN_USER` and `ALIGN_PASSWORD`, set `HOST` as required, and put the service behind an HTTPS reverse proxy. Set `ALIGN_DATABASE` to a file on a persistent volume. The application uses one shared workspace login.

## Verification and source

Run `node --test server/workflows.test.js`. The organization status labels and interaction follow-up heuristics derive from [Engage](https://github.com/LucasAlign/church-engagement/tree/2d4790c142ef28c8983bc23aed0131ae90b6357a). The map uses Census-derived Albers state boundaries from [US Atlas 3.0.1](https://github.com/topojson/us-atlas/tree/v3.0.1).
