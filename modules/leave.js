ModuleLoader.register({
  id: 'leave',
  label: 'Leave messages',

  render() {
    return `
      <div class="section-title">
        <div>
          <h3>Leave messages</h3>
          <p>Choose where departure messages should be sent.</p>
        </div>
      </div>

      <div class="card form-card">
        <label class="check-row">
          <input type="checkbox" id="leaveEnabled">
          <span>Enable leave messages</span>
        </label>

        <label>Leave channel</label>
        <select id="leaveChannel"></select>

        <label>Leave message</label>
        <textarea id="leaveMessage" rows="4"
          placeholder="Goodbye {user}, we'll miss you!"></textarea>

        <small>
          Available: <code>{user}</code> <code>{mention}</code> <code>{server}</code>
        </small>

        <div class="actions">
          <button class="primary-btn" data-module="leave" data-module-action="save">Save changes</button>
          <span class="status" data-module-status="leave"></span>
        </div>
      </div>`;
  },

  load(config, channels) {
    const data = config.leave || {};

    document.getElementById('leaveEnabled').checked = !!data.enabled;
    document.getElementById('leaveMessage').value =
      data.message || 'Goodbye {user}, we will miss you!';

    const select = document.getElementById('leaveChannel');
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
      enabled: document.getElementById('leaveEnabled').checked,
      channelId: document.getElementById('leaveChannel').value,
      message: document.getElementById('leaveMessage').value.slice(0, 1000)
    };
  }
});