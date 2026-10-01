(() => {
  const $ = id => document.getElementById(id);

  window.Auth = {
    user: null,

    async load() {
      const response = await fetch('/api/me', { credentials: 'same-origin' });
      if (!response.ok) return null;
      const data = await response.json();
      this.user = data.user || null;
      this.render();
      return this.user;
    },

    render() {
      const area = $('userArea');
      if (!area) return;

      if (!this.user) {
        area.innerHTML = '<a class="secondary-btn" href="/auth/discord">Log in</a>';
        return;
      }

      const avatar = this.user.avatar
        ? `https://cdn.discordapp.com/avatars/${this.user.id}/${this.user.avatar}.png?size=64`
        : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(this.user.id) % 5n)}.png`;

      area.innerHTML = `
        <div class="user-pill">
          <img class="avatar" src="${escapeHtml(avatar)}" alt="">
          <span class="user-name">${escapeHtml(this.user.global_name || this.user.username)}</span>
          <a class="logout" href="/auth/logout">Log out</a>
        </div>`;
    }
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
    }[c]));
  }

  window.escapeHtml = escapeHtml;
})();