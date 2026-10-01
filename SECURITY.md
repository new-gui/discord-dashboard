# Security Policy

If you find a security issue in this project, please report it privately. Do not open a public GitHub issue, pull request, or discussion for it.

---

## Supported versions

Only the latest commit on the default branch (`main`) receives security fixes. Older commits, forks, and third-party modifications are not supported.

---

## How to report a vulnerability

Send an email to the maintainer address listed in `package.json` with the following information:

- **Summary** — one sentence describing the issue.
- **Type** — what class of vulnerability it is (auth bypass, XSS, CSRF, IDOR, injection, secret exposure, DoS, etc.).
- **Reproduction steps** — as precise as possible. Include HTTP requests, payloads, URLs, or a short script if it helps.
- **Impact** — what an attacker can actually do with this. Be specific. "An attacker can read another user's guild list" is more useful than "information disclosure."
- **Affected version or commit** — the SHA or tag you tested against.
- **Suggested fix** — optional, but appreciated.
- **Your name or handle** — only if you want credit in the changelog. Say so explicitly. If you'd rather stay anonymous, that's fine.

If you want to encrypt the report, ask for a PGP key in your first email and I'll send one.

You'll get an acknowledgement within a few days. If you don't hear back within a week, follow up — email occasionally gets lost.

---

## What happens after you report

1. I confirm the report and reproduce the issue.
2. I assess severity and decide on a fix timeline.
3. I develop and test the fix privately.
4. I release the fix on `main` and note it in the changelog.
5. If you asked for credit, you'll be named in the changelog entry. Otherwise the fix is described without attribution.

Please give me a reasonable window to ship a fix before disclosing publicly. Thirty days is the target for high-severity issues, longer for low-severity ones. If you need to disclose sooner for a good reason, tell me and we'll work something out.

---

## What counts as in scope

- Anything in `server.js` — authentication, session handling, permission checks, CSRF, rate limiting, input validation, secret handling.
- Anything in `scripts/auth.js` or `scripts/dashboard.js` — XSS, DOM injection, unsafe `innerHTML`, CSRF, session handling in the browser.
- Anything in `modules/*.js` — including the ability for a module to write to MongoDB outside its own config namespace.
- The `index.html` and `style.css` — mostly for XSS via CSP bypass or content injection.
- The interaction between the dashboard and MongoDB.
- The interaction between the dashboard and Discord's API.
- Anything in the `/api/*` or `/auth/*` routes.
- Session lifetime, token handling, cookie flags, and OAuth state validation.

## What is out of scope

- Issues that require the attacker to already have full access to the machine running the dashboard.
- Issues that require the attacker to already have valid Discord credentials for a user with `Manage Server` on the target server.
- Self-XSS that requires the user to paste malicious code into their own browser console.
- Missing security headers that don't map to a real attack (I'll still consider adding them, but they're not vulnerabilities).
- Denial of service via legitimate high traffic — the rate limiter is a baseline, not a DDoS shield.
- Anything in a fork that isn't reproducible against the current `main`.
- Reports generated purely by an automated scanner with no working proof of concept.
- "Your dependency X has a CVE" without a demonstrated path from that CVE to actual impact on this project.

---

## What this project stores

Be aware of what a compromise actually exposes:

- **Discord OAuth2 user access tokens** — server-side only. Never sent to the browser. Used to call `/users/@me/guilds` and nothing else.
- **Discord user profile data** — ID, username, global name, avatar hash. Used to render the top bar.
- **Per-guild configuration** — whatever each module saves, keyed by Discord guild ID.
- **Session records** — an opaque session ID, the user's Discord profile, their tokens, and a 7-day TTL.

This project does **not** store:

- Discord passwords.
- Message content.
- Bot tokens on the client side.
- Any personal data beyond what Discord's `identify` and `guilds` scopes return.

---

## What this project does not do

To save you time on reports that won't be actionable:

- It does not run a bot. There is no Discord gateway connection in this codebase.
- It does not read messages. The OAuth scopes it requests cannot read message content, and the bot token is only used for guild metadata lookups.
- It does not expose an API for third parties. The only endpoints are the five listed in the README.
- It does not publish webhooks, sockets, or any other change-notification mechanism.
- It does not do anything on Discord on the user's behalf. There are no write scopes.

If your report involves any of those things, it's about a different project or a fork.

---

## Deployment requirements

If you run this publicly, you take on these obligations:

- Set a strong random `SESSION_SECRET`. The server refuses to start with fewer than 32 characters, but "long enough" is not the same as "random enough." Use `crypto.randomBytes(48).toString('hex')`.
- Never commit `.env`, `config.json`, or any file containing a token or connection string. `.gitignore` covers the defaults — verify before pushing.
- Run behind HTTPS in production and set `NODE_ENV=production` so the session cookie is flagged `Secure`.
- Restrict MongoDB access to your application's IP range. Do not expose the database port publicly.
- Rotate `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_SECRET`, and the MongoDB password immediately if they are ever exposed in logs, screenshots, chat, or git history.
- Keep Node.js and dependencies up to date. `npm audit` is a starting point, not an answer.
- Set `trust proxy` correctly for your host. The default in `server.js` is `1`, which is right for one reverse proxy. If you're behind a CDN plus a proxy, adjust it.

---

## A note on secrets in git history

If you accidentally commit a secret and then remove it, the secret still exists in git history and is publicly recoverable. Removing it in a later commit is not sufficient. You must:

1. Rotate the exposed credential immediately — the old one is gone forever.
2. If the repository is public, consider rewriting history (`git filter-repo`, BFG) to remove the value.

Rotating is the only real fix. History rewriting is cleanup, not remediation.

---

## A note on module trust

Modules run in the browser, in the same origin as the dashboard. A module has the same access as the logged-in user: it can read the CSRF token, call every endpoint the user can call, and render any HTML it likes inside the module panel.

The server-side schema validation in `server.js` limits **what data a module can write to MongoDB**, but it does not sandbox the module itself. Only install modules you have reviewed, or that come from a source you trust. This is by design — a sandbox would add significant complexity for a project whose whole point is "drop a file in a folder and it appears."

If you're building a module and want it reviewed before publishing, open a regular (non-security) issue and I'll take a look.

---

## Thanks

Reports of real, reproducible issues are appreciated whether or not they qualify for a CVE. A clear reproduction and a blunt impact statement are worth more than a scanner dump.