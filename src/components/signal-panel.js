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

    const isHedge = signalData.hedge !== null && signalData.hedge !== undefined;
    badge.className = 'signal-badge ' + (isHedge ? 'hedge' : signalData.signal.toLowerCase());
    badge.innerText = isHedge ? `HEDGE → ${signalData.signal}` : signalData.signal;

    // Confidence Level
    const confVal = document.getElementById('conf-value');
    const confBar = document.getElementById('conf-bar-fill');
    if (confVal && confBar) {
      confVal.innerText = `${signalData.confidence}%`;
      confBar.style.width = `${signalData.confidence}%`;
      // Color: red < 60, yellow 60-79, green 80+
      if (signalData.confidence >= 80) {
        confBar.style.background = 'linear-gradient(90deg, #00ff41, #00cc33)';
      } else if (signalData.confidence >= 60) {
        confBar.style.background = 'linear-gradient(90deg, #ffaa00, #ff8800)';
      } else {
        confBar.style.background = 'linear-gradient(90deg, #ff073a, #cc0000)';
      }
    }

    // Order Type / Status
    const orderTypeEl = document.getElementById('order-type');
    orderTypeEl.innerText = signalData.orderType || '--';
    orderTypeEl.className = 'value type-val ' + (isHedge ? 'hedge' : (signalData.signal === 'BUY' ? 'bull' : (signalData.signal === 'SELL' ? 'bear' : '')));

    // Zone Proximity Status
    const zoneStatusEl = document.getElementById('zone-status');
    if (zoneStatusEl && signalData.zoneProximity) {
      const zp = signalData.zoneProximity;
      let statusText = '';
      let statusClass = '';
      
      if (zp.status === 'AT_ZONE') {
        statusText = `📍 AT ${zp.zone.type} — $${zp.zone.price.toFixed(0)} (${zp.zone.strength})`;
        statusClass = zp.zone.type === 'SUPPORT' ? 'zone-support' : 'zone-resistance';
      } else if (zp.status === 'APPROACHING') {
        statusText = `→ APPROACHING ${zp.zone.type} — $${zp.zone.price.toFixed(0)}`;
        statusClass = 'zone-approaching';
      } else if (zp.status === 'BETWEEN_ZONES') {
        const sText = zp.nearestSupport ? `S: $${zp.nearestSupport.price.toFixed(0)}` : '';
        const rText = zp.nearestResistance ? `R: $${zp.nearestResistance.price.toFixed(0)}` : '';
        statusText = `↔ Between Zones | ${sText} — ${rText}`;
        statusClass = 'zone-between';
      } else {
        statusText = '⏳ Scanning zones...';
        statusClass = '';
      }
      
      zoneStatusEl.innerText = statusText;
      zoneStatusEl.className = `zone-status-display ${statusClass}`;
    }

    // Inject Primary + Hedge + Alternative Entry Cards
    const cardsContainer = document.getElementById('entry-cards-container');
    if (cardsContainer && signalData.entryOptions && signalData.entryOptions.length > 0) {
      cardsContainer.innerHTML = signalData.entryOptions.map(opt => {
        if (!opt) return '';
        const isBuy = opt.id === 'BUY';
        const isHedgeCard = opt.style === 'HEDGE';
        const isPrimary = opt.style === 'PRIMARY';
        const dirClass = isBuy ? 'bull' : 'bear';

        const strengthBadge = opt.strength === 'STRONG' ? 'badge-strong' :
                              opt.strength === 'MODERATE' ? 'badge-high' :
                              opt.strength === 'HEDGE' ? 'badge-hedge' :
                              opt.strength === 'WEAK' ? 'badge-medium' : 'badge-cond';

        let cardClass = isHedgeCard ? 'card-hedge' :
          isPrimary ? (isBuy ? 'card-primary-buy' : 'card-primary-sell') : 'card-alt';

        const icon = isHedgeCard ? '⚠️' : (isPrimary ? (isBuy ? '▲' : '▼') : '↻');

        return `
          <div class="entry-card ${cardClass}">
            <div class="card-head">
              <span class="card-dir-badge ${isHedgeCard ? 'hedge' : dirClass}">${icon} ${opt.label}</span>
              <span class="strength-badge ${strengthBadge}">${opt.strength}</span>
            </div>
            <div class="entry-zone-box">
              <span class="ez-label">${isHedgeCard ? 'HEDGE ENTRY' : 'ENTRY ZONE'}</span>
              <span class="ez-val ${isHedgeCard ? 'hedge' : dirClass}">$${opt.entryLow ? opt.entryLow.toFixed(0) : '--'} – $${opt.entryHigh ? opt.entryHigh.toFixed(0) : '--'}</span>
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
    } else if (cardsContainer) {
      // No entry options — show zone scanning message
      const zp = signalData.zoneProximity;
      let msg = 'Menunggu harga mendekati zona S/R...';
      if (zp && zp.status === 'BETWEEN_ZONES') {
        msg = 'Harga di antara zona S/R — tidak ada entry yang optimal. Tunggu harga mendekati support atau resistance.';
      }
      cardsContainer.innerHTML = `<div class="entry-card card-waiting"><div class="card-note">${msg}</div></div>`;
    }

    // Reasoning
    const summary = document.getElementById('signal-summary-text');
    const list = document.getElementById('reasoning-list');
    const setup = signalData.setup;

    if (setup && setup.bias !== 'NEUTRAL') {
      summary.innerText = `${signalData.orderType} — Confidence ${signalData.confidence}%`;
    } else {
      summary.innerText = 'Scanning zona S/R... Menunggu harga di area entry.';
    }

    list.innerHTML = (signalData.reasonings || []).map(r => {
      const isPositive = r.startsWith('+') || r.includes('✅');
      const isWarn = r.includes('⚠️') || r.includes('WARNING') || r.includes('HEDGE');
      const isWait = r.includes('⏳') || r.includes('Waiting') || r.includes('No nearby');
      let cls = '';
      if (isWarn) cls = 'surge-alert';
      else if (isPositive) cls = 'conf-positive';
      else if (isWait) cls = 'conf-wait';
      return `<li class="${cls}">${r}</li>`;
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
      { id: 'M15', role: 'Zone Confirm', method: 'EMA' },
      { id: 'M5', role: 'Entry Timing', method: 'EMA' }
    ];

    container.innerHTML = tfs.map(tf => {
      const ind = indicatorsMap[tf.id];
      const trendData = trends ? trends[tf.id] : { trend: 'SIDEWAYS', rsi: 50 };
      const trend = trendData.trend || 'SIDEWAYS';
      // Normalize lean trends for display
      const displayTrend = trend.replace('LEAN_', '');
      const trendClass = displayTrend === 'BULL' || displayTrend === 'BULLISH' ? 'bull-border'
        : (displayTrend === 'BEAR' || displayTrend === 'BEARISH' ? 'bear-border' : '');
      
      if (!ind) return '<div class="analysis-card loading">Loading...</div>';

      const rsiDirClass = ind.rsiDirection === 'Rising' ? 'bull' : 'bear';
      
      let extraInfo = '';
      if (tf.id === 'H1') extraInfo = `<div class="stat-row"><span>Structure:</span> <span class="highlight">${trendData.structure || '--'}</span></div>`;

      return `
        <div class="analysis-card ${trendClass}">
          <div class="card-header">
            <span class="tf-tag">${tf.id} <small>[${tf.optional ? 'FILTER' : tf.method}]</small></span>
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
