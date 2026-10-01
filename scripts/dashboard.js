(() => {
  const $ = id => document.getElementById(id);
  const screens = ['landing', 'loading', 'servers', 'addBot', 'manage', 'error'];

  const state = {
    user: null,
    servers: [],
    current: null,
    channels: [],
    roles: [],
    config: {},
    modules: []
  };

  window.ModuleLoader = {
    registry: new Map(),

    register(module) {
      if (!module || !module.id || !module.label || typeof module.render !== 'function') {
        console.warn('Invalid dashboard module:', module);
        return;
      }
      this.registry.set(module.id, module);
    }
  };

  function show(id) {
    screens.forEach(name => $(name).classList.toggle('hidden', name !== id));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function csrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)csrf=([^;]+)/);
    return match ? match[1] : '';
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken(),
        ...(options.headers || {})
      },
      ...options
    });

    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  async function loadModules() {
    const data = await api('/api/modules');
    for (const src of data.modules || []) {
      if (document.querySelector(`script[data-module-src="${src}"]`)) continue;

      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `/modules/${encodeURIComponent(src)}`;
        script.dataset.moduleSrc = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Could not load module: ${src}`));
        document.body.appendChild(script);
      });
    }

    state.modules = [...ModuleLoader.registry.values()];
  }

  async function init() {
    try {
      const params = new URLSearchParams(location.search);

      const showLoading = params.get('loading') === '1';
      if (showLoading) {
        show('loading');
        history.replaceState({}, '', '/');
      }

      await loadModules();
      state.user = await Auth.load();

      if (params.get('error')) {
        $('errorText').textContent = params.get('error');
        show('error');
        history.replaceState({}, '', '/');
        return;
      }

      if (!state.user) {
        show('landing');
        return;
      }

      await loadServers();
    } catch (error) {
      console.error(error);
      $('errorText').textContent = error.message;
      show('error');
    }
  }

  async function loadServers() {
    const data = await api('/api/servers');
    state.servers = data.servers || [];
    renderServers();
    show('servers');
  }

  function renderServers() {
    const grid = $('serverGrid');

    if (!state.servers.length) {
      grid.innerHTML = `<div class="empty-state"><h2>No manageable servers</h2><p>You need Manage Server permission or ownership.</p></div>`;
      return;
    }

    grid.innerHTML = state.servers.map(server => {
      const icon = server.icon
        ? `https://cdn.discordapp.com/icons/${server.id}/${server.icon}.png?size=128`
        : '';
      const badge = server.botInServer
        ? '<span class="badge">BOT READY</span>'
        : '<span class="badge warn">ADD BOT</span>';

      return `
        <article class="server-card" data-id="${server.id}">
          ${badge}
          ${icon
            ? `<img class="server-icon" src="${icon}" alt="">`
            : `<div class="server-icon">${escapeHtml(server.name.charAt(0))}</div>`}
          <div class="server-name">${escapeHtml(server.name)}</div>
          <div class="server-meta">${server.owner ? 'Owner' : 'Manage Server'} · ${server.botInServer ? 'Ready to configure' : 'Bot not installed'}</div>
        </article>`;
    }).join('');

    grid.querySelectorAll('.server-card').forEach(card => {
      card.addEventListener('click', () => openServer(card.dataset.id));
    });
  }

  async function openServer(id) {
    try {
      const data = await api(`/api/servers/${encodeURIComponent(id)}`);
      state.current = data.server;
      state.channels = data.channels || [];
      state.roles = data.roles || [];
      state.config = data.config || {};

      if (!state.current.botInServer) {
        $('addBotTitle').textContent = state.current.name;
        $('addBotSubtitle').textContent =
          "The bot isn't in this server yet. Add it to unlock configuration.";

        const invite =
          `https://discord.com/oauth2/authorize` +
          `?client_id=${encodeURIComponent(data.clientId || '')}` +
          `&scope=bot%20applications.commands` +
          `&guild_id=${encodeURIComponent(state.current.id)}`;

        $('addBotLink').href = invite;
        show('addBot');
        return;
      }

      $('serverTitle').textContent = state.current.name;
      $('serverSubtitle').textContent =
        `${state.modules.length} module${state.modules.length === 1 ? '' : 's'} available`;

      const warning = $('permissionWarning');
      warning.classList.add('hidden');

      renderModules();
      show('manage');
    } catch (error) {
      alert(error.message);
    }
  }

  function renderModules() {
    const nav = $('moduleNav');
    const content = $('moduleContent');

    nav.innerHTML = state.modules.map((module, index) =>
      `<button class="nav-item ${index === 0 ? 'active' : ''}" data-tab="${escapeHtml(module.id)}">${escapeHtml(module.label)}</button>`
    ).join('');

    content.innerHTML = state.modules.map((module, index) =>
      `<div class="tab-panel ${index === 0 ? 'active' : ''}" id="module-${escapeHtml(module.id)}">${module.render()}</div>`
    ).join('');

    state.modules.forEach(module => {
      if (typeof module.load === 'function') {
        module.load(state.config, state.channels, state.roles, state.current);
      }
    });

    nav.querySelectorAll('.nav-item').forEach(button => {
      button.addEventListener('click', () => activateModule(button.dataset.tab));
    });
  }

  function activateModule(id) {
    document.querySelectorAll('#moduleNav .nav-item').forEach(x => x.classList.toggle('active', x.dataset.tab === id));
    document.querySelectorAll('#moduleContent .tab-panel').forEach(x => x.classList.toggle('active', x.id === `module-${id}`));
  }

  async function saveModule(id) {
    const module = ModuleLoader.registry.get(id);
    if (!module || typeof module.collect !== 'function') return;

    const status = document.querySelector(`[data-module-status="${CSS.escape(id)}"]`);
    if (status) {
      status.className = 'status';
      status.textContent = 'Saving…';
    }

    try {
      const changes = module.collect(state.config, state.channels, state.roles, state.current);
      const data = await api(`/api/servers/${encodeURIComponent(state.current.id)}/config`, {
        method: 'PUT',
        body: JSON.stringify({ module: id, data: changes })
      });

      state.config = data.config || state.config;

      if (status) status.textContent = 'Saved';
      if (typeof module.load === 'function') module.load(state.config, state.channels, state.roles, state.current);
    } catch (error) {
      if (status) {
        status.className = 'status error';
        status.textContent = error.message;
      }
    }
  }

  document.addEventListener('click', event => {
    const save = event.target.closest('[data-module-action="save"]');
    if (save) saveModule(save.dataset.module);
  });

  $('refreshServers').addEventListener('click', loadServers);
  $('backServers').addEventListener('click', loadServers);
  $('addBotBack').addEventListener('click', loadServers);

  init();
})();