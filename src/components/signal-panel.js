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
    orderTypeEl.innerText = signalData.orderType || '--';
    orderTypeEl.className = 'value type-val ' + (signalData.signal === 'BUY' ? 'bull' : (signalData.signal === 'SELL' ? 'bear' : ''));

    // Inject Primary + Alternative Entry Cards
    const cardsContainer = document.getElementById('entry-cards-container');
    if (cardsContainer && signalData.entryOptions && signalData.entryOptions.length > 0) {
      cardsContainer.innerHTML = signalData.entryOptions.map(opt => {
        if (!opt) return '';
        const isBuy = opt.id === 'BUY';
        const isPrimary = opt.style === 'PRIMARY';
        const dirClass = isBuy ? 'bull' : 'bear';
        const strengthBadge = opt.strength === 'STRONG' ? 'badge-strong' :
                              opt.strength === 'HIGH' ? 'badge-high' :
                              opt.strength === 'MEDIUM' ? 'badge-medium' : 'badge-cond';

        let cardClass = isPrimary
          ? (isBuy ? 'card-primary-buy' : 'card-primary-sell')
          : 'card-alt';

        return `
          <div class="entry-card ${cardClass}">
            <div class="card-head">
              <span class="card-dir-badge ${dirClass}">${isPrimary ? (isBuy ? '▲' : '▼') : '↻'} ${opt.label}</span>
              <span class="strength-badge ${strengthBadge}">${opt.strength}</span>
            </div>
            <div class="entry-zone-box">
              <span class="ez-label">${isPrimary ? 'ENTRY ZONE' : 'ENTRY'}</span>
              <span class="ez-val ${dirClass}">$${opt.entryLow ? opt.entryLow.toFixed(0) : '--'} – $${opt.entryHigh ? opt.entryHigh.toFixed(0) : '--'}</span>
            </div>
            <div class="card-body">
              <div class="stat-line"><span>Stop Loss:</span><span class="val bear">$${opt.sl ? opt.sl.toFixed(0) : '--'}</span></div>
              <div class="stat-line"><span>Target 1:</span><span class="val bull">$${opt.tp1 ? opt.tp1.toFixed(0) : '--'}</span></div>
              <div class="stat-line"><span>Target 2:</span><span class="val bull">$${opt.tp2 ? opt.tp2.toFixed(0) : '--'}</span></div>
              <div class="stat-line"><span>R:R Ratio:</span><span class="val">1 : ${opt.rr}</span></div>
            </div>
            <div class="card-note">${opt.note}</div>
            <div class="card-instruction">▶ ${opt.instruction}</div>
          </div>
        `;
      }).join('');
    }

    // Reasoning
    const summary = document.getElementById('signal-summary-text');
    const list = document.getElementById('reasoning-list');
    const setup = signalData.setup;

    if (setup && setup.bias !== 'NEUTRAL') {
      summary.innerText = `Bias: ${setup.bias} (${setup.setupType}) — ${setup.strength}`;
    } else {
      summary.innerText = 'Menunggu konfirmasi arah H1...';
    }

    list.innerHTML = (signalData.reasonings || []).map(r => {
      const isWarn = r.includes('WAIT:') || r.includes('INFO:');
      return `<li class="${isWarn ? 'surge-alert' : ''}">${r}</li>`;
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
      { id: 'H4', role: 'Trend Filter', method: 'EMA', optional: true },
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
            <span class="tf-tag">${tf.id} <small>[${tf.optional ? 'OPSIONAL' : tf.method}]</small></span>
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
