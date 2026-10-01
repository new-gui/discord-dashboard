# Modular Discord Dashboard

A tiny, self-contained dashboard for configuring Discord bots per server.

Log in with Discord, pick a server you manage, toggle some settings. That's it. No frameworks, no build step, no external services beyond Discord and MongoDB.

---

## What this is

A Node.js + Express server that:

- Authenticates users through Discord OAuth2 (`identify guilds` scopes only).
- Lists the servers where the logged-in user has **Manage Server** or **Administrator**.
- Renders a configuration panel for each server.
- Saves each server's settings to MongoDB, keyed by Discord guild ID.

Everything is per-server. Two servers can have completely different settings, and editing one never touches another.

---

## What this is *not*

This project does **not** contain a bot. It does not connect to Discord's gateway. It does not read messages, react to events, or manage members. It cannot send a welcome message, assign a self-role, or post anything to a channel.

**The dashboard only writes configuration to a database.** Nothing acts on that configuration until a separate bot reads it.

There is **no API endpoint** for external services to talk to this dashboard. There is no webhook, no push notification, no socket, no cross-server bridge, no "sync" endpoint, no way for a bot or a script running elsewhere to be notified when a config changes.

If you want a bot to use the settings this dashboard produces, you build the bot yourself and have it read the same MongoDB collection. That's the entire integration contract:

```
Dashboard  →  writes to MongoDB  →  your bot reads from MongoDB
```

That's it. One-directional, one shared database, no HTTP between them. You can see a working example of a matching bot in the `bot/` folder if you want a starting point.

---

## What ships in this repo

```
discord-dashboard/
├── index.html              # single-page shell
├── style.css               # dark theme, no framework
├── server.js               # the entire backend
├── package.json
├── .env.example            # copy to .env, fill in
├── .gitignore
├── SECURITY.md
├── scripts/
│   ├── auth.js             # renders top-bar user area
│   └── dashboard.js        # screens, API calls, module loader
└── modules/
    ├── auditlog.js         # audit log channel picker
    ├── join.js             # join message + channel + ping role
    ├── leave.js            # leave message + channel
    └── selfroles.js        # self-role picker message + role list
```

That's the whole thing. Roughly 1,200 lines including comments.

---

## The module system

Modules are what make this dashboard useful. A module is a single JavaScript file that:

1. Declares an `id`, a `label`, and a `render()` function that returns HTML.
2. Optionally implements `load(config, channels, roles, server)` to populate its UI.
3. Optionally implements `collect(...)` to return the object it wants saved.

You drop it in `modules/`, refresh the dashboard, and it appears. No edits to `index.html`, `dashboard.js`, or `server.js` are required. The dashboard discovers files by listing the directory over `/api/modules` and injecting each one as a `<script>`.

Adding a module takes about thirty seconds:

```js
// modules/automod.js
ModuleLoader.register({
  id: 'automod',
  label: 'Auto moderation',

  render() {
    return `
      <div class="section-title">
        <div>
          <h3>Auto moderation</h3>
          <p>Configure moderation settings.</p>
        </div>
      </div>

      <div class="card form-card">
        <label class="check-row">
          <input type="checkbox" id="automodEnabled">
          <span>Enable automod</span>
        </label>

        <div class="actions">
          <button class="primary-btn" data-module="automod" data-module-action="save">
            Save changes
          </button>
          <span class="status" data-module-status="automod"></span>
        </div>
      </div>`;
  },

  load(config) {
    const data = config.automod || {};
    document.getElementById('automodEnabled').checked = !!data.enabled;
  },

  collect() {
    return {
      enabled: document.getElementById('automodEnabled').checked
    };
  }
});
```

Save it as `modules/automod.js`. Refresh the dashboard. Done.

### How saving works

The dashboard sends a `PUT` request to `/api/servers/:id/config` with:

```json
{
  "module": "automod",
  "data": { "enabled": true }
}
```

The server:

1. Verifies the user is logged in.
2. Verifies the user has permission on that specific server.
3. Verifies the module name matches a real file in `modules/`.
4. Runs the data through a per-module schema validator.
5. Writes it to MongoDB under `servers._id = <guildId>`, `config.automod`.

Nothing else happens. No events are emitted. No external process is notified.

### How loading works

When you open a server, the dashboard calls `GET /api/servers/:id`, which returns the server's channels, roles, and its full `config` object from MongoDB. Each module's `load()` is called with that config. Modules read their own section and populate their UI.

---

## Database shape

One document per Discord server in the `servers` collection:

```json
{
  "_id": "950346765561921556",
  "config": {
    "join":      { "enabled": true,  "channelId": "111", "message": "Welcome {mention}!" },
    "leave":     { "enabled": false, "channelId": "222", "message": "Bye {user}." },
    "selfRoles": { "channelId": "333", "message": "Pick a role.", "roleIds": ["444", "555"] },
    "auditlog":  { "enabled": false, "channelId": "666" }
  },
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

`_id` is the Discord guild ID. `config.<moduleId>` is whatever that module's `collect()` returned, sanitized to match the module's schema.

A server that has never been configured simply has no document. Reading it returns `{}`.

---

## The four built-in modules

| Module | File | What it configures |
|---|---|---|
| **Join setup** | `modules/join.js` | Welcome channel, message template, optional role ping |
| **Leave messages** | `modules/leave.js` | Goodbye channel and message template |
| **Self roles** | `modules/selfroles.js` | A channel, a message, and a list of roles members can pick |
| **Audit logs** | `modules/auditlog.js` | A single channel for audit output |

None of them do anything on their own. They only store settings. A separate bot must read the settings and act on them.

The placeholders `{user}`, `{mention}`, `{server}`, and `{count}` are conventions for bots to interpret. The dashboard just stores the strings. Whether they get substituted, and how, is up to whatever reads the config.

---

## Authentication and permissions

Login uses Discord OAuth2 with two scopes:

- `identify` — to show your username and avatar
- `guilds` — to list servers you can manage

There are no write scopes. The dashboard never modifies anything on Discord on your behalf.

The list of servers shown is filtered by Discord's `permissions` field. You only see servers where:

- You are the owner, **or**
- You have `Administrator`, **or**
- You have `Manage Server`

The server enforces the same check on every API call. The frontend filtering is just cosmetic — even if you hand-crafted a request for a server you don't manage, the server rejects it.

---

## Endpoints (for reference)

The dashboard exposes five endpoints. That's the complete surface.

| Method | Path | Auth | What it does |
|---|---|---|---|
| `GET` | `/api/modules` | no | Lists module filenames |
| `GET` | `/api/me` | no | Returns the current user or `null` |
| `GET` | `/api/servers` | yes | Lists servers you can manage |
| `GET` | `/api/servers/:id` | yes | Returns channels, roles, and config for one server |
| `PUT` | `/api/servers/:id/config` | yes + CSRF | Saves one module's config for one server |

Plus three auth routes:

| Method | Path | What it does |
|---|---|---|
| `GET` | `/auth/discord` | Redirects to Discord OAuth |
| `GET` | `/auth/callback` | Discord redirects back here |
| `GET` | `/auth/logout` | Ends the session |

There is **nothing else**. No public API for third parties. No webhooks. No way for an external process to subscribe to changes. No way for an external process to push settings in.

If you're building a bot and want it to use this dashboard's data, the bot reads MongoDB directly with the same `MONGODB_URI`. That's the only supported integration path.

---

## Running it

Copy `.env.example` to `.env` and fill in:

```env
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=http://localhost:3000/auth/callback
SESSION_SECRET=
DISCORD_BOT_TOKEN=
MONGODB_URI=
DB_NAME=discord-dashboard
PORT=3000
NODE_ENV=development
```

Notes on each:

- **`DISCORD_CLIENT_ID`** and **`DISCORD_CLIENT_SECRET`** come from your Discord application's OAuth2 page.
- **`DISCORD_REDIRECT_URI`** must **exactly** match what you registered in the Discord Developer Portal → OAuth2 → Redirects. A trailing slash mismatch will fail.
- **`SESSION_SECRET`** must be at least 32 characters. Generate one with:
  ```
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
- **`DISCORD_BOT_TOKEN`** is used server-side only, to look up whether your bot is in each server. The browser never sees it.
- **`MONGODB_URI`** can be a local `mongodb://localhost:27017` or an Atlas connection string. If you use Atlas, add your server's IP to Network Access.

Install and start:

```bash
npm install
npm start
```

Open http://localhost:3000.

---

## Deploying

Anywhere Node 18+ runs. Railway, Render, Fly.io, a VPS. Set the same environment variables on the host, update `DISCORD_REDIRECT_URI` in both `.env` and the Discord Developer Portal to your public HTTPS URL, and set `NODE_ENV=production` so the session cookie gets the `Secure` flag.

You need a MongoDB instance the host can reach. Atlas free tier is fine.

---

## How to add your own module

1. Create `modules/yourmodule.js`.
2. Call `ModuleLoader.register({ id, label, render, load, collect })`.
3. Add a matching entry to `MODULE_SCHEMAS` in `server.js` so the server knows what fields to accept and validate.

The `id` in the module file must match the file basename. If your file is `automod.js`, your `id` must be `automod`. Otherwise saving returns `404 Unknown dashboard module`.

The schema entry in `server.js` looks like:

```js
automod: {
  enabled: v => typeof v === 'boolean'
}
```

Only fields listed there are stored. Anything else in the `collect()` output is dropped. This keeps a buggy or malicious module from writing arbitrary data to your database.

---

## Security

The dashboard has been hardened for public release:

- Session cookies are signed, `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- Sessions are stored in MongoDB with a TTL index, so they survive restarts and clean themselves up.
- OAuth state values are single-use and expire in 10 minutes.
- All state-changing requests require a CSRF token.
- Helmet sets a strict Content Security Policy and other headers.
- Rate limiting caps `/auth/*` and `/api/*`.
- Per-module schema validation runs on every save.
- The bot token never leaves the server.
- Errors returned to the browser are generic in production.

See `SECURITY.md` for reporting vulnerabilities.

---

## What this project deliberately does not do

- **No HTTP bridge.** Nothing calls out to a bot. Nothing lets a bot call in.
- **No message content.** The `identify guilds` scopes can't read messages, and the dashboard doesn't ask for more.
- **No bot actions.** Joining, leaving, roles, and messages are the bot's job.
- **No polling endpoint.** There is no `/api/config/changes` or similar. If you want live updates in another process, query MongoDB.
- **No multi-user collaboration.** Every session is independent. Two admins editing the same server will simply overwrite each other's last save, same as any config editor with no locking.
- **No plugin sandbox.** Modules run in the browser, in the same origin as the dashboard. Only install modules you trust, because a malicious module can do anything the logged-in user can do.

---

## Contributing

Any actual, working, secure contributions are welcome.

That means:

- A module that does something real, with a matching schema entry in `server.js`.
- A bug fix that reproduces and resolves an actual issue.
- A security improvement that closes a real hole without breaking anything.
- A dependency update that doesn't introduce new vulnerabilities.

Not that means:

- Cosmetic refactors that change nothing.
- Adding a framework because you prefer it.
- Features that require exposing new endpoints, storing message content, or asking for extra Discord scopes.
- Anything that weakens the security model described above.

Open a pull request with a description of what changed and why. If it's a security fix, see `SECURITY.md` for the private reporting channel first.