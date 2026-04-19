const STORAGE_KEY = 'btc_signal_history';

export const SignalStorage = {
  getHistory() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Failed to parse history', e);
      return [];
    }
  },

  addSignal(signalObj) {
    // signalObj: { id, type: 'BUY'|'SELL', entry, sl, tp1, time, status: 'OPEN' }
    const history = this.getHistory();
    // Keep max 50 signals
    history.unshift(signalObj);
    if (history.length > 50) history.pop();
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    return history;
  },

  updateSignalStatus(id, newStatus) {
    const history = this.getHistory();
    const idx = history.findIndex(s => s.id === id);
    if (idx > -1) {
      history[idx].status = newStatus;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    }
  },

  getStats() {
    const history = this.getHistory();
    const wins = history.filter(s => s.status === 'WIN').length;
    const losses = history.filter(s => s.status === 'LOSS').length;
    const open = history.filter(s => s.status === 'OPEN').length;
    const total = wins + losses;
    const rate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
    return { rate, wins, losses, open };
  },

  renderHistory(containerId) {
    const history = this.getHistory();
    const container = document.getElementById(containerId);
    if (!container) return;

    if (history.length === 0) {
      container.innerHTML = '<div class="empty-state">No signals yet...</div>';
      return;
    }

    container.innerHTML = history.map(item => `
      <div class="hist-item ${item.type.toLowerCase()}">
        <div>
          <strong>${item.type}</strong> @ ${item.entry.toFixed(2)}
          <br/><span style="color:var(--text-secondary);font-size:0.75rem">${new Date(item.time).toLocaleTimeString()}</span>
        </div>
        <div style="text-align:right">
          <span style="color:${item.status === 'WIN' ? 'var(--neon-green)' : item.status === 'LOSS' ? 'var(--signal-red)' : 'var(--wait-gray)'}">
            ${item.status}
          </span>
        </div>
      </div>
    `).join('');
  }
};
