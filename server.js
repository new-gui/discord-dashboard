require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DISCORD_API = 'https://discord.com/api/v10';
const MODULES_PATH = path.join(__dirname, 'modules');
const IS_PROD = process.env.NODE_ENV === 'production';

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------
const REQUIRED_ENV = [
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'DISCORD_REDIRECT_URI',
  'SESSION_SECRET',
  'DISCORD_BOT_TOKEN',
  'MONGODB_URI'
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Missing environment variable: ${key}`);
    process.exit(1);
  }
}

if (process.env.SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be at least 32 characters.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
function logEvent(type, fields = {}) {
  try {
    console.log(JSON.stringify({ ts: new Date().toISOString(), type, ...fields }));
  } catch {
    console.log(`[${type}] (unserializable)`);
  }
}

function publicError(err) {
  if (IS_PROD) return 'Request failed.';
  return err?.message || 'Request failed.';
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
let db;

async function connectDB() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  db = client.db(process.env.DB_NAME || 'discord-dashboard');

  await db.collection('sessions').createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 }
  );

  console.log('MongoDB connected');
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: [
          "'self'",
          'data:',
          'https://cdn.discordapp.com',
          'https://media.discordapp.net'
        ],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'no-referrer' }
  })
);

app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth requests. Try again later.' }
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 180,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Slow down.' }
});

app.use('/auth/', authLimiter);
app.use('/api/', apiLimiter);

// CSRF double-submit cookie
function ensureCsrfCookie(req, res) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)csrf=([^;]+)/);
  if (match) return match[1];

  const token = crypto.randomBytes(24).toString('hex');
  const secure = IS_PROD ? '; Secure' : '';
  res.append(
    'Set-Cookie',
    `csrf=${token}; Path=/; SameSite=Lax; Max-Age=604800${secure}`
  );
  return token;
}

app.use((req, res, next) => {
  ensureCsrfCookie(req, res);
  next();
});

function requireCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const cookieMatch = (req.headers.cookie || '').match(/(?:^|;\s*)csrf=([^;]+)/);
  const cookieToken = cookieMatch ? cookieMatch[1] : null;
  const headerToken = req.headers['x-csrf-token'];

  if (!cookieToken || !headerToken) {
    return res.status(403).json({ error: 'Invalid CSRF token.' });
  }

  const a = Buffer.from(String(cookieToken));
  const b = Buffer.from(String(headerToken));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ error: 'Invalid CSRF token.' });
  }

  next();
}

// ---------------------------------------------------------------------------
// Static
// ---------------------------------------------------------------------------
app.use('/scripts', express.static(path.join(__dirname, 'scripts'), { index: false }));
app.use('/modules', express.static(MODULES_PATH, { index: false }));
app.use('/style.css', express.static(path.join(__dirname, 'style.css')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ---------------------------------------------------------------------------
// Sessions (Mongo-backed)
// ---------------------------------------------------------------------------
function randomId() {
  return crypto.randomBytes(32).toString('hex');
}

function sign(value) {
  return crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(value)
    .digest('base64url');
}

function setSessionCookie(res, id) {
  const value = `${id}.${sign(id)}`;
  const secure = IS_PROD ? '; Secure' : '';
  res.append(
    'Set-Cookie',
    `sid=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}`
  );
}

function clearSessionCookie(res) {
  const secure = IS_PROD ? '; Secure' : '';
  res.append(
    'Set-Cookie',
    `sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
  );
}

async function getSession(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)sid=([^;]+)/);
  if (!match) return null;

  const [id, signature] = match[1].split('.');
  if (!id || !signature) return null;

  const expected = sign(id);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const session = await db.collection('sessions').findOne({ _id: id });
  if (!session || session.expiresAt <= Date.now()) {
    if (session) await db.collection('sessions').deleteOne({ _id: id });
    return null;
  }

  return session;
}

async function requireAuth(req, res, next) {
  try {
    const session = await getSession(req);
    if (!session) return res.status(401).json({ error: 'Not authenticated' });
    req.session = session;
    next();
  } catch (error) {
    logEvent('auth.error', { message: error.message });
    res.status(500).json({ error: publicError(error) });
  }
}

function redirectError(res, message) {
  res.redirect(`/?error=${encodeURIComponent(message)}`);
}

// ---------------------------------------------------------------------------
// Discord helpers
// ---------------------------------------------------------------------------
function hasManagePermission(guild) {
  try {
    const permissions = BigInt(guild.permissions || 0);
    const ADMINISTRATOR = 0x8n;
    const MANAGE_GUILD = 0x20n;
    return Boolean(
      guild.owner ||
      (permissions & ADMINISTRATOR) !== 0n ||
      (permissions & MANAGE_GUILD) !== 0n
    );
  } catch {
    return false;
  }
}

async function discordFetch(endpoint, options = {}) {
  const response = await fetch(`${DISCORD_API}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {}

  if (!response.ok) {
    const error = new Error(body.message || `Discord API error ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function oauthFetch(endpoint, params) {
  const response = await fetch(`${DISCORD_API}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error_description || body.message || 'Discord OAuth failed');
  }
  return body;
}

async function userFetch(accessToken, endpoint) {
  const response = await fetch(`${DISCORD_API}${endpoint}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.message || `Discord request failed (${response.status})`);
  }
  return body;
}

async function botIsInGuild(guildId) {
  try {
    await discordFetch(`/guilds/${guildId}`);
    return true;
  } catch {
    return false;
  }
}

// Refresh the user's access token when it's within 60s of expiry.
async function ensureFreshToken(session) {
  if (Date.now() < (session.tokenExpiresAt || 0) - 60_000) {
    return session.accessToken;
  }

  const refreshed = await oauthFetch('/oauth2/token', {
    client_id: process.env.DISCORD_CLIENT_ID,
    client_secret: process.env.DISCORD_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: session.refreshToken
  });

  session.accessToken = refreshed.access_token;
  session.refreshToken = refreshed.refresh_token || session.refreshToken;
  session.tokenExpiresAt = Date.now() + Number(refreshed.expires_in || 604800) * 1000;

  await db.collection('sessions').updateOne(
    { _id: session._id },
    {
      $set: {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        tokenExpiresAt: session.tokenExpiresAt
      }
    }
  );

  return session.accessToken;
}

// Per-session guild cache (stored on the session doc).
async function getCachedGuilds(session) {
  const now = Date.now();
  if (session.guildsCache && session.guildsCache.expiresAt > now) {
    return session.guildsCache.data;
  }

  const accessToken = await ensureFreshToken(session);
  const data = await userFetch(accessToken, '/users/@me/guilds');

  await db.collection('sessions').updateOne(
    { _id: session._id },
    { $set: { guildsCache: { data, expiresAt: now + 5 * 60 * 1000 } } }
  );

  session.guildsCache = { data, expiresAt: now + 5 * 60 * 1000 };
  return data;
}

async function getManageableGuild(req, guildId) {
  const guilds = await getCachedGuilds(req.session);
  const guild = guilds.find(item => item.id === guildId);
  if (!guild || !hasManagePermission(guild)) {
    throw new Error('You do not have permission to manage this server.');
  }
  return guild;
}

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------
function getModuleFiles() {
  if (!fs.existsSync(MODULES_PATH)) fs.mkdirSync(MODULES_PATH, { recursive: true });
  return fs
    .readdirSync(MODULES_PATH, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function moduleExists(name) {
  return getModuleFiles().some(file => path.basename(file, '.js') === name);
}

// ---------------------------------------------------------------------------
// Per-module schema validation
// ---------------------------------------------------------------------------
function isSnowflake(value) {
  return typeof value === 'string' && /^\d{17,20}$/.test(value);
}

function isSnowflakeArray(value, max = 50) {
  return Array.isArray(value) && value.length <= max && value.every(isSnowflake);
}

const MODULE_SCHEMAS = {
  join: {
    enabled: v => typeof v === 'boolean',
    channelId: v => v === '' || isSnowflake(v),
    message: v => typeof v === 'string' && v.length <= 1000,
    pingRoleId: v => v === '' || isSnowflake(v),
    pingOnJoin: v => typeof v === 'boolean'
  },
  leave: {
    enabled: v => typeof v === 'boolean',
    channelId: v => v === '' || isSnowflake(v),
    message: v => typeof v === 'string' && v.length <= 1000
  },
  selfRoles: {
    channelId: v => v === '' || isSnowflake(v),
    message: v => typeof v === 'string' && v.length <= 1000,
    roleIds: v => isSnowflakeArray(v, 25)
  },
  auditlog: {
    enabled: v => typeof v === 'boolean',
    channelId: v => v === '' || isSnowflake(v)
  }
};

function validateModuleData(moduleId, data) {
  const schema = MODULE_SCHEMAS[moduleId];
  if (!schema) throw new Error(`No schema for module: ${moduleId}`);

  const out = {};
  for (const [key, validator] of Object.entries(schema)) {
    if (!(key in data)) continue;
    if (!validator(data[key])) {
      throw new Error(`Invalid value for ${moduleId}.${key}`);
    }
    out[key] = data[key];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get('/api/modules', (req, res) => {
  res.json({ modules: getModuleFiles() });
});

app.get('/auth/discord', (req, res) => {
  const state = randomId();

  // Stash the OAuth state in Mongo with a short TTL.
  db.collection('oauth_states').insertOne({
    _id: state,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000)
  }).catch(err => logEvent('oauth.state.error', { message: err.message }));

  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds',
    state
  });

  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

app.get('/auth/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code || !state) {
      return redirectError(res, 'Invalid or expired Discord authorization.');
    }

    const saved = await db.collection('oauth_states').findOneAndDelete({ _id: state });
    if (!saved || !saved.createdAt || Date.now() - saved.createdAt.getTime() > 10 * 60 * 1000) {
      logEvent('oauth.fail', { reason: 'state', ip: req.ip });
      return redirectError(res, 'Invalid or expired Discord authorization.');
    }

    const token = await oauthFetch('/oauth2/token', {
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.DISCORD_REDIRECT_URI
    });

    const user = await userFetch(token.access_token, '/users/@me');
    const sessionId = randomId();

    await db.collection('sessions').insertOne({
      _id: sessionId,
      user: {
        id: user.id,
        username: user.username,
        global_name: user.global_name || null,
        avatar: user.avatar || null
      },
      accessToken: token.access_token,
      refreshToken: token.refresh_token || null,
      tokenExpiresAt: Date.now() + Number(token.expires_in || 604800) * 1000,
      guildsCache: null,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });

    logEvent('auth.login', { userId: user.id, username: user.username, ip: req.ip });

    setSessionCookie(res, sessionId);
    res.redirect('/?loading=1');
  } catch (error) {
    logEvent('auth.fail', { reason: 'callback', message: error.message, ip: req.ip });
    redirectError(res, 'Discord authorization failed.');
  }
});

app.get('/auth/logout', async (req, res) => {
  try {
    const session = await getSession(req);
    if (session) {
      await db.collection('sessions').deleteOne({ _id: session._id });
      logEvent('auth.logout', { userId: session.user?.id, ip: req.ip });
    }
  } catch (error) {
    logEvent('auth.logout.error', { message: error.message });
  }

  clearSessionCookie(res);
  res.redirect('/');
});

app.get('/api/me', async (req, res) => {
  try {
    const session = await getSession(req);
    res.json({ user: session?.user || null });
  } catch {
    res.json({ user: null });
  }
});

app.get('/api/servers', requireAuth, async (req, res) => {
  try {
    const guilds = await getCachedGuilds(req.session);
    const manageable = guilds.filter(hasManagePermission);

    const servers = await Promise.all(
      manageable.map(async guild => ({
        id: guild.id,
        name: guild.name,
        icon: guild.icon,
        owner: Boolean(guild.owner),
        botInServer: await botIsInGuild(guild.id)
      }))
    );

    servers.sort(
      (a, b) => Number(b.owner) - Number(a.owner) || a.name.localeCompare(b.name)
    );

    res.json({ servers });
  } catch (error) {
    logEvent('api.servers.error', { message: error.message });
    res.status(502).json({ error: publicError(error) });
  }
});

app.get('/api/servers/:id', requireAuth, async (req, res) => {
  try {
    if (!isSnowflake(req.params.id)) {
      return res.status(400).json({ error: 'Invalid server id.' });
    }

    const guild = await getManageableGuild(req, req.params.id);
    const botInServer = await botIsInGuild(guild.id);

    if (!botInServer) {
      return res.json({
        clientId: process.env.DISCORD_CLIENT_ID,
        server: {
          id: guild.id,
          name: guild.name,
          icon: guild.icon,
          owner: Boolean(guild.owner),
          botInServer: false
        },
        channels: [],
        roles: [],
        config: {}
      });
    }

    const [channels, roles, serverDoc] = await Promise.all([
      discordFetch(`/guilds/${guild.id}/channels`),
      discordFetch(`/guilds/${guild.id}/roles`),
      db.collection('servers').findOne({ _id: guild.id })
    ]);

    res.json({
      clientId: process.env.DISCORD_CLIENT_ID,
      server: {
        id: guild.id,
        name: guild.name,
        icon: guild.icon,
        owner: Boolean(guild.owner),
        botInServer: true
      },
      channels: channels
        .filter(channel => channel.type === 0)
        .map(channel => ({ id: channel.id, name: channel.name, type: channel.type })),
      roles: roles.map(role => ({ id: role.id, name: role.name, managed: role.managed })),
      config: serverDoc?.config || {}
    });
  } catch (error) {
    logEvent('api.server.error', { guildId: req.params.id, message: error.message });
    res.status(403).json({ error: publicError(error) });
  }
});

app.put('/api/servers/:id/config', requireAuth, requireCsrf, async (req, res) => {
  try {
    if (!isSnowflake(req.params.id)) {
      return res.status(400).json({ error: 'Invalid server id.' });
    }

    const guild = await getManageableGuild(req, req.params.id);

    if (!(await botIsInGuild(guild.id))) {
      return res.status(400).json({ error: 'The bot is not in this server.' });
    }

    const { module, data } = req.body || {};

    if (typeof module !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(module)) {
      return res.status(400).json({ error: 'Invalid module name.' });
    }

    if (!moduleExists(module)) {
      return res.status(404).json({ error: 'Unknown dashboard module.' });
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return res.status(400).json({ error: 'Invalid module data.' });
    }

    let sanitized;
    try {
      sanitized = validateModuleData(module, data);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    await db.collection('servers').updateOne(
      { _id: guild.id },
      {
        $set: {
          [`config.${module}`]: sanitized,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    logEvent('config.save', {
      userId: req.session.user?.id,
      guildId: guild.id,
      module
    });

    const updated = await db.collection('servers').findOne({ _id: guild.id });
    res.json({ ok: true, config: updated?.config || {} });
  } catch (error) {
    logEvent('config.save.error', {
      guildId: req.params.id,
      message: error.message
    });
    res.status(403).json({ error: publicError(error) });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Central error handler
app.use((err, req, res, next) => {
  logEvent('unhandled.error', { message: err?.message, path: req.path });
  if (res.headersSent) return next(err);
  res.status(500).json({ error: publicError(err) });
});

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------
setInterval(() => {
  const now = new Date();
  db.collection('oauth_states').deleteMany({ expiresAt: { $lte: now } })
    .catch(() => {});
}, 10 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Discord dashboard running on http://localhost:${PORT}`);
      console.log(`Loaded ${getModuleFiles().length} dashboard module(s).`);
    });
  })
  .catch(error => {
    console.error('Failed to start:', error);
    process.exit(1);
  });