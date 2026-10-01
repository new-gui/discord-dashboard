ModuleLoader.register({
  id: 'auditlog',
  label: 'Audit logs',

  render() {
    return `
      <div class="section-title">
        <div>
          <h3>Audit log channel</h3>
          <p>Choose where your bot should send audit log events.</p>
        </div>
      </div>

      <div class="card form-card">
        <label class="check-row">
          <input type="checkbox" id="auditLogEnabled">
          <span>Enable audit logging</span>
        </label>

        <label>Audit log channel</label>
        <select id="auditLogChannel"></select>

        <small>Make sure the bot can view and send messages in this channel.</small>

        <div class="actions">
          <button class="primary-btn" data-module="auditlog" data-module-action="save">Save changes</button>
          <span class="status" data-module-status="auditlog"></span>
        </div>
      </div>`;
  },

  load(config, channels) {
    const data = config.auditlog || {};

    document.getElementById('auditLogEnabled').checked = !!data.enabled;

    const select = document.getElementById('auditLogChannel');
    select.innerHTML =
      '<option value="">Select a channel</option>' +
      channels
        .filter(channel => channel.type === 0)
        .map(channel =>
          `<option value="${escapeHtml(channel.id)}" ${channel.id === data.channelId ? 'selected' : ''}># ${escapeHtml(channel.name)}</option>`
        )
        .join('');
  },

  collect() {
    return {
      enabled: document.getElementById('auditLogEnabled').checked,
      channelId: document.getElementById('auditLogChannel').value
    };
  }
});