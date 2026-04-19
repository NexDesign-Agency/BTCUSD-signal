import { SignalStorage } from '../storage/history.js';

export const UIManager = {
  updatePrice(price) {
    const el = document.getElementById('current-price');
    if (!el) return;
    const oldPrice = parseFloat(el.innerText);
    el.innerText = `$${price.toFixed(2)}`;
    if (price > oldPrice) {
      el.className = 'current-price-display up';
    } else if (price < oldPrice) {
      el.className = 'current-price-display down';
    }
  },

  updateSignal(signalData) {
    const badge = document.getElementById('final-signal-badge');
    const panel = document.querySelector('.final-signal-panel');
    if (!badge || !panel) return;

    badge.className = 'signal-badge ' + signalData.signal.toLowerCase();
    badge.innerText = signalData.signal;

    // Confidence Level
    const confVal = document.getElementById('conf-value');
    const confBar = document.getElementById('conf-bar-fill');
    if (confVal && confBar) {
      confVal.innerText = `${signalData.confidence}%`;
      confBar.style.width = `${signalData.confidence}%`;
    }

    // Pending Order Details
    const orderTypeEl = document.getElementById('order-type');
    orderTypeEl.innerText = signalData.orderType;
    
    // Toggle Prep Mode Visuals
    const fields = document.querySelectorAll('.order-details .field');
    fields.forEach(f => {
      if (signalData.isPrep) {
        f.classList.add('is-prep');
      } else {
        f.classList.remove('is-prep');
      }
    });

    document.getElementById('pred-entry').innerText = signalData.entry ? `$ ${signalData.entry.toFixed(1)}` : '$ --';
    document.getElementById('pred-sl').innerText = signalData.sl ? `$ ${signalData.sl.toFixed(1)}` : (signalData.isPrep ? '---' : '$ --');
    document.getElementById('pred-tp1').innerText = signalData.tp1 ? `$ ${signalData.tp1.toFixed(1)}` : (signalData.isPrep ? '---' : '$ --');
    document.getElementById('pred-tp2').innerText = signalData.tp2 ? `$ ${signalData.tp2.toFixed(1)}` : (signalData.isPrep ? '---' : '$ --');
    document.getElementById('pred-tp3').innerText = signalData.tp3 ? `$ ${signalData.tp3.toFixed(1)}` : (signalData.isPrep ? '---' : '$ --');
    document.getElementById('pred-rr').innerText = signalData.rr ? `1 : ${signalData.rr}` : '1 : --';

    // Highlight Order Type
    const typeEl = document.getElementById('order-type');
    typeEl.className = 'value type-val ' + (signalData.signal === 'BUY' ? 'bull' : (signalData.signal === 'SELL' ? 'bear' : ''));

    // Reasoning
    const summary = document.getElementById('signal-summary-text');
    const list = document.getElementById('reasoning-list');
    
    if (signalData.signal === 'WAIT') {
      summary.innerText = signalData.reasonings.length > 0 ? signalData.reasonings[0] : 'Menunggu konfirmasi teknikal...';
    } else {
      summary.innerText = `Eksekusi ${signalData.orderType} Siap!`;
    }

    list.innerHTML = (signalData.reasonings || []).map(r => {
      const isPriority = r.includes('WAIT:') || r.includes('PERINGATAN');
      return `<li class="${isPriority ? 'surge-alert' : ''}">${r}</li>`;
    }).join('');

    // Update Stats
    const stats = SignalStorage.getStats();
    document.getElementById('stat-winrate').innerText = `${stats.rate}%`;
    document.getElementById('stat-win').innerText = stats.wins;
    document.getElementById('stat-loss').innerText = stats.losses;
  },

  updateMatrix(indicatorsMap, trends) {
    const container = document.getElementById('tf-analysis-matrix');
    if (!container) return;

    const tfs = [
      { id: 'H4', role: 'Trend Filter', method: 'EMA' },
      { id: 'H1', role: 'Major Structure', method: 'EMA' },
      { id: 'M15', role: 'Confirmation', method: 'PA' },
      { id: 'M5', role: 'Precise Timing', method: 'PA' }
    ];

    container.innerHTML = tfs.map(tf => {
      const ind = indicatorsMap[tf.id];
      const trendData = trends ? trends[tf.id] : { trend: 'SIDEWAYS', rsi: 50 };
      const trend = trendData.trend || 'SIDEWAYS';
      const trendClass = trend === 'BULLISH' ? 'bull-border' : (trend === 'BEARISH' ? 'bear-border' : '');
      
      if (!ind) return '<div class="analysis-card loading">Loading...</div>';

      const rsiDirClass = ind.rsiDirection === 'Rising' ? 'bull' : 'bear';
      
      let extraInfo = '';
      if (tf.id === 'H1') extraInfo = `<div class="stat-row"><span>Structure:</span> <span class="highlight">${trendData.structure || '--'}</span></div>`;
      if (tf.method === 'PA') extraInfo = `<div class="stat-row"><span>PA Score:</span> <span class="highlight">${trendData.score || 0}/5</span></div>`;

      return `
        <div class="analysis-card ${trendClass}">
          <div class="card-header">
            <span class="tf-tag">${tf.id} <small>[${tf.method}]</small></span>
            <span class="tf-role">${tf.role}</span>
          </div>
          <div class="card-body">
            <div class="stat-row">
              <span>Trend:</span>
              <span class="trend-val ${trend}">${trend}</span>
            </div>
            <div class="stat-row">
              <span>RSI:</span>
              <span>${ind.rsi.toFixed(1)} <small class="${rsiDirClass}">(${ind.rsiDirection})</small></span>
            </div>
            ${extraInfo}
          </div>
        </div>
      `;
    }).join('');
  },

  log(msg) {
    const console = document.getElementById('alert-console');
    if (!console) return;
    const item = document.createElement('div');
    item.className = 'alert-item';
    item.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
    console.prepend(item);
    if (console.children.length > 20) console.lastChild.remove();
  }
};
