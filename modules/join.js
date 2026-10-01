/**
 * Module: Join Setup
 *
 * To add another dashboard module, drop another .js file in /modules.
 * It only needs ModuleLoader.register({ id, label, render, load, collect }).
 */

ModuleLoader.register({
  id: 'join',
  label: 'Join setup',

  render() {
    return `
      <div class="section-title">
        <div>
          <h3>Welcome & join</h3>
          <p>Control what happens when someone joins the server.</p>
        </div>
        <label class="switch">
          <input type="checkbox" id="joinEnabled" data-module="join">
          <span></span>
        </label>
      </div>

      <div class="card form-card">
        <label>Join channel</label>
        <select id="joinChannel" data-module="join"></select>

        <label>Join message</label>
        <textarea id="joinMessage" data-module="join" rows="4" placeholder="Welcome {mention} to {server}!"></textarea>
        <small>Available: <code>{user}</code> <code>{server}</code> <code>{mention}</code></small>

        <label>Ping role <span class="muted">(optional)</span></label>
        <select id="joinPingRole" data-module="join"></select>

        <label class="check-row">
          <input type="checkbox" id="pingOnJoin" data-module="join">
          <span>Ping the selected role when someone joins</span>
        </label>

        <div class="actions">
          <button class="primary-btn" data-module="join" data-module-action="save">Save changes</button>
          <span class="status" data-module-status="join"></span>
        </div>
      </div>`;
  },

  load(config, channels, roles) {
    const join = config.join || {};
    fillSelect('joinChannel', channels.filter(c => c.type === 0), join.channelId || '', 'Select a channel');
    fillSelect('joinPingRole', roles.filter(r => !r.managed), join.pingRoleId || '', "Don't ping a role");

    document.getElementById('joinEnabled').checked = join.enabled !== false;
    document.getElementById('joinMessage').value = join.message || 'Welcome {mention} to {server}!';
    document.getElementById('pingOnJoin').checked = !!join.pingOnJoin;
  },

  collect() {
    return {
      enabled: document.getElementById('joinEnabled').checked,
      channelId: document.getElementById('joinChannel').value,
      message: document.getElementById('joinMessage').value.slice(0, 1000),
      pingRoleId: document.getElementById('joinPingRole').value,
      pingOnJoin: document.getElementById('pingOnJoin').checked
    };
  }
});

function fillSelect(id, items, selected, emptyLabel) {
  const select = document.getElementById(id);
  if (!select) return;
  select.innerHTML =
    `<option value="">${escapeHtml(emptyLabel)}</option>` +
    items.map(item =>
      `<option value="${escapeHtml(item.id)}" ${item.id === selected ? 'selected' : ''}>${escapeHtml(item.name)}</option>`
    ).join('');
}