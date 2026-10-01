/**
 * Module: Self Roles
 *
 * Drop this file in /modules and it is automatically discovered and shown.
 */

ModuleLoader.register({
  id: 'selfRoles',
  label: 'Self roles',

  render() {
    return `
      <div class="section-title">
        <div>
          <h3>Self roles</h3>
          <p>Let members choose roles from a configured list.</p>
        </div>
      </div>

      <div class="card form-card">
        <label>Role picker channel</label>
        <select id="roleChannel" data-module="selfRoles"></select>

        <label>Self-role message</label>
        <textarea id="roleMessage" data-module="selfRoles" rows="3" placeholder="Choose the roles you want below."></textarea>

        <label>Available roles</label>
        <div id="roleList" class="role-list"></div>

        <div class="actions">
          <button class="primary-btn" data-module="selfRoles" data-module-action="save">Save changes</button>
          <span class="status" data-module-status="selfRoles"></span>
        </div>
      </div>`;
  },

  load(config, channels, roles) {
    const selfRoles = config.selfRoles || {};
    fillSelect('roleChannel', channels.filter(c => c.type === 0), selfRoles.channelId || '', 'Select a channel');

    document.getElementById('roleMessage').value =
      selfRoles.message || 'Choose your roles below.';

    const selected = new Set(selfRoles.roleIds || []);
    document.getElementById('roleList').innerHTML =
      roles.filter(role => !role.managed).map(role => `
        <label class="role-option">
          <input type="checkbox" value="${escapeHtml(role.id)}" data-module="selfRoles" ${selected.has(role.id) ? 'checked' : ''}>
          <span>${escapeHtml(role.name)}</span>
        </label>`).join('') ||
      '<span class="muted">No usable roles found.</span>';
  },

  collect() {
    return {
      channelId: document.getElementById('roleChannel').value,
      message: document.getElementById('roleMessage').value.slice(0, 1000),
      roleIds: [...document.querySelectorAll('#roleList input[data-module="selfRoles"]:checked')]
        .map(input => input.value)
        .slice(0, 25)
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