import { SignalStorage } from '../storage/history.js';

// ============================================================================
// signal-panel.js v4.0 — CASCADE 3TF Signal Panel
// Panel kanan diganti: renderBuyBreakout → renderCascadeSignal
// Cascade: H1 = filter arah | M15 = konfirmasi | M5 = entry timing
// ============================================================================

export const UIManager = {
  updatePrice(price) {
    const el = document.getElementById('current-price');
    if (!el) return;
    const oldPrice = parseFloat(el.innerText.replace('$', '').replace(',', ''));
    el.innerText = `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (price > oldPrice) el.className = 'current-price-display up';
    else if (price < oldPrice) el.className = 'current-price-display down';
  },

  showBigSignalOverlay(type, price, confidence) {
    const existing = document.getElementById('big-signal-alert');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'big-signal-alert';
    overlay.className = 'signal-overlay';
    
    const isBuy = type === 'BUY';
    const icon = isBuy ? '▲' : '▼';
    const colorClass = isBuy ? 'overlay-buy' : 'overlay-sell';
    
    overlay.innerHTML = `
      <div class="overlay-content ${colorClass}">
        <div class="overlay-icon">${icon}</div>
        <div class="overlay-text">${type} SIGNAL</div>
        <div class="overlay-info">Entry: $${price.toFixed(0)} | Konfidensi: ${confidence}%</div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Play additional high-impact sound effect if needed
    
    setTimeout(() => {
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 1s ease-out';
      setTimeout(() => overlay.remove(), 1000);
    }, 5000);
  },

  updateScenarios(data) {
    if (!data || data.phase === 'LOADING') {
      this._showLoading();
      return;
    }

    const { phase, activeSignal: s, sellScenario, buyScenario, priceContext } = data;

    this._updatePriceContext(priceContext, s, sellScenario);
    this._updateActiveBanner(s);
    this._updateScenarioCards(sellScenario, buyScenario, s, data);

    const stats = SignalStorage.getStats();
    const wr = document.getElementById('stat-winrate');
    const sw = document.getElementById('stat-win');
    const sl = document.getElementById('stat-loss');
    if (wr) wr.innerText = `${stats.rate}%`;
    if (sw) sw.innerText = stats.wins;
    if (sl) sl.innerText = stats.losses;
  },

  _updatePriceContext(ctx, s, sc) {
    const el = document.getElementById('zone-status');
    if (!el || !ctx) return;

    let text = '';
    let cls = 'zone-between';
    const primaryDir = sc ? sc.direction : 'WAIT';

    if (ctx.position === 'AT_RESISTANCE') {
      // Jika kita menyarankan BUY, berada di resistance bukanlah alert merah (mungkin target)
      const isSellSetup = primaryDir === 'SELL';
      cls = isSellSetup ? 'zone-resistance' : 'zone-between';
      const icon = isSellSetup ? '🔴' : '🟡';
      text = `${icon} Price DI ZONA RESISTANCE — $${ctx.current.toFixed(0)}`;
    } else if (ctx.position === 'AT_SUPPORT') {
      // Jika kita menyarankan SELL, berada di support bukanlah alert hijau (mungkin target)
      const isBuySetup = primaryDir === 'BUY';
      cls = isBuySetup ? 'zone-support' : 'zone-between';
      const icon = isBuySetup ? '🟢' : '🟡';
      text = `${icon} Price DI ZONA SUPPORT — $${ctx.current.toFixed(0)}`;
    } else {
      const rText = ctx.nearestR ? `R: $${ctx.nearestR.price.toFixed(0)} (+$${ctx.distToR ? ctx.distToR.toFixed(0) : '?'})` : '';
      const sText = ctx.nearestS ? `S: $${ctx.nearestS.price.toFixed(0)} (-$${ctx.distToS ? ctx.distToS.toFixed(0) : '?'})` : '';
      text = `↔ Di tengah zona — ${sText} | ${rText}`;
      cls = 'zone-between';
    }

    el.innerText = text;
    el.className = `zone-status-display ${cls}`;

    const badge = document.getElementById('final-signal-badge');
    const orderType = document.getElementById('order-type');
    if (!badge) return;

    if (s.phase === 'ACTIVE') {
      badge.className = `signal-badge ${s.signal.toLowerCase()}`;
      badge.innerText = `${s.signal} LOCKED`;
      if (orderType) {
        orderType.innerText = `Candle ${s.m15Count}/4 M15`;
        orderType.className = `value type-val ${s.signal === 'BUY' ? 'bull' : 'bear'}`;
      }
    } else if (s.phase === 'COOLDOWN') {
      badge.className = 'signal-badge wait';
      badge.innerText = 'COOLDOWN';
      if (orderType) {
        orderType.innerText = `Candle ${s.cooldownCount}/${s.exitReason === 'SL_HIT' ? 2 : 1} cooldown`;
        orderType.className = 'value type-val';
      }
    } else {
      badge.className = 'signal-badge wait';
      badge.innerText = 'SCANNING';
      if (orderType) {
        orderType.innerText = ctx.position === 'AT_RESISTANCE'
          ? 'Di zona R — tunggu konfirmasi'
          : ctx.position === 'AT_SUPPORT'
            ? 'Di zona S — tunggu konfirmasi'
            : 'Menunggu harga ke zona';
        orderType.className = 'value type-val';
      }
    }

    const confBar = document.getElementById('conf-bar-fill');
    const confVal = document.getElementById('conf-value');
    if (s.phase === 'ACTIVE') {
      const pct = Math.round((s.m15Count / 4) * 100);
      if (confBar) {
        confBar.style.width = `${pct}%`;
        confBar.style.background = 'linear-gradient(90deg, #ffaa00, #ff8800)';
      }
      if (confVal) confVal.innerText = `Candle ${s.m15Count}/4`;
    } else {
      if (confBar) confBar.style.width = '0%';
      if (confVal) confVal.innerText = s.phase === 'COOLDOWN' ? 'COOLDOWN' : 'SCANNING';
    }
  },

  _updateActiveBanner(s) {
    const container = document.getElementById('signal-summary-text');
    const list = document.getElementById('reasoning-list');
    if (!container) return;

    if (s.phase === 'ACTIVE') {
      const isBuy = s.signal === 'BUY';
      container.innerHTML = `
        <div class="active-signal-banner ${isBuy ? 'bull' : 'bear'}">
          <span class="banner-icon">${isBuy ? '▲' : '▼'}</span>
          <span class="banner-text">${s.signal} SIGNAL AKTIF</span>
          <span class="banner-lock">🔒 ${s.m15Count}/4 M15</span>
        </div>
        <div class="active-levels">
          <span>SL: <strong class="bear">$${s.sl ? s.sl.toFixed(0) : '--'}</strong></span>
          <span>TP1: <strong class="bull">$${s.tp1 ? s.tp1.toFixed(0) : '--'}</strong></span>
          <span>TP2: <strong class="bull">$${s.tp2 ? s.tp2.toFixed(0) : '--'}</strong></span>
        </div>`;
      if (list) list.innerHTML = '<li class="conf-positive">Signal terkunci — tidak akan flip sampai SL/TP kena atau 4 M15 selesai.</li>';
    } else if (s.phase === 'COOLDOWN') {
      const reason = s.exitReason === 'SL_HIT'
        ? '❌ SL Hit — Cooldown aktif (2 M15)'
        : s.exitReason === 'TP1_HIT'
          ? '✅ TP1 Hit — Cooldown aktif (1 M15)'
          : s.exitReason === 'TP2_HIT'
            ? '✅ TP2 Hit — Cooldown aktif (1 M15)'
            : '⏰ Expired — Cooldown aktif (1 M15)';
      container.innerHTML = `<div class="cooldown-banner">${reason}</div>`;
      if (list) list.innerHTML = '<li class="conf-wait">Tunggu cooldown selesai sebelum signal baru bisa muncul.</li>';
    } else {
      container.innerHTML = `<span class="scan-label">⏳ Menunggu harga ke zona S/R + konfirmasi terpenuhi...</span>`;
      if (list) list.innerHTML = '<li class="conf-wait">Sistem aktif memantau. Skenario di bawah akan update saat M15 candle close.</li>';
    }
  },

  _updateScenarioCards(sellScenario, buyScenario, s, data) {
    const container = document.getElementById('entry-cards-container');
    if (!container) return;

    const renderSell = (sc) => {
      if (!sc) return '<div class="entry-card card-waiting"><div class="card-note">Tidak ada zona S/R terdekat.</div></div>';
      const isBuy = sc.direction === 'BUY';
      const dir   = isBuy ? 'BUY' : 'SELL';
      const icon  = isBuy ? '▲' : '▼';
      const valCls = isBuy ? 'bull' : 'bear';
      const cardBase = isBuy ? 'card-primary-buy' : 'card-primary-sell';
      const isLocked = s.phase === 'ACTIVE' && s.signal === dir;
      const isOtherLocked = s.phase === 'ACTIVE' && s.signal !== dir;
      const cardClass = isLocked
        ? `${cardBase} active-locked`
        : isOtherLocked
          ? 'card-dimmed'
          : cardBase;
      const checklist = sc.confirmations.map(c => `
        <li class="check-item ${c.met ? 'met' : 'unmet'}">
          <span class="check-icon">${c.met ? '✅' : '⬜'}</span>
          <span class="check-label">${c.label}</span>
        </li>`).join('');
      const progressPct = Math.round((sc.metCount / sc.confirmations.length) * 100);
      const barColor = progressPct === 100 ? (isBuy ? '#00ff41' : '#ff073a') : '#ffaa00';
      const zoneType = isBuy ? 'Support' : 'Resistance';
      return `
        <div class="entry-card ${cardClass}">
          <div class="card-head">
            <span class="card-dir-badge ${valCls}">${icon} ${dir}${isLocked ? ' 🔒' : ''}</span>
            <span class="card-zone-strength">${sc.touches}× ${zoneType}</span>
          </div>
          <div class="waiting-label">${isLocked ? '✅ Aktif' : sc.waitingFor}</div>
          <div class="conf-progress-bar">
            <div class="conf-progress-fill" style="width:${progressPct}%;background:${barColor}"></div>
          </div>
          <div class="card-confidence">Konfidensi: ${sc.confidence || progressPct}%</div>
          <ul class="confirmation-list">${checklist}</ul>
          <div class="entry-zone-box">
            <span class="ez-label">ZONA</span>
            <span class="ez-val ${valCls}">$${sc.entryLow.toFixed(0)}–$${sc.entryHigh.toFixed(0)}</span>
          </div>
          <div class="card-body">
            <div class="stat-line"><span>SL:</span><span class="val bear">$${sc.sl.toFixed(0)}</span></div>
            <div class="stat-line"><span>TP1:</span><span class="val bull">$${sc.tp1.toFixed(0)}</span></div>
            <div class="stat-line"><span>TP2:</span><span class="val bull">$${sc.tp2.toFixed(0)}</span></div>
            <div class="stat-line"><span>R:R:</span><span class="val">1:${sc.rr} ✅</span></div>
          </div>
        </div>`;
    };

    // =========================================================================
    // CASCADE 3TF SIGNAL PANEL
    // H1 = filter arah | M15 = konfirmasi momentum | M5 = timing entry
    // =========================================================================
    const renderCascadeSignal = () => {
      const trends = (data && data.trends) || {};
      const h1Trend  = (trends.H1  && trends.H1.trend)  || 'SIDEWAYS';
      const m15Trend = (trends.M15 && trends.M15.trend) || 'SIDEWAYS';
      const m5Trend  = (trends.M5  && trends.M5.trend)  || 'SIDEWAYS';
      const h1Rsi    = (trends.H1  && trends.H1.rsi)    || 50;
      const m15Rsi   = (trends.M15 && trends.M15.rsi)   || 50;
      const m5Rsi    = (trends.M5  && trends.M5.rsi)    || 50;

      const h1Bull  = h1Trend.includes('BULL');
      const h1Bear  = h1Trend.includes('BEAR');
      const m15Bull = m15Trend.includes('BULL');
      const m15Bear = m15Trend.includes('BEAR');
      const m5Bull  = m5Trend.includes('BULL');
      const m5Bear  = m5Trend.includes('BEAR');

      const cascadeBuyMet  = [h1Bull, m15Bull, m5Bull].filter(Boolean).length;
      const cascadeSellMet = [h1Bear, m15Bear, m5Bear].filter(Boolean).length;

      const buyConfirmed  = cascadeBuyMet  === 3;
      const sellConfirmed = cascadeSellMet === 3;
      const buyPartial    = !buyConfirmed  && cascadeBuyMet  >= 2;
      const sellPartial   = !sellConfirmed && cascadeSellMet >= 2;

      let signalDir = 'WAIT';
      if (sellConfirmed)     signalDir = 'SELL';
      else if (buyConfirmed) signalDir = 'BUY';
      else if (sellPartial)  signalDir = 'SELL_PARTIAL';
      else if (buyPartial)   signalDir = 'BUY_PARTIAL';

      const isActiveLocked = s.phase === 'ACTIVE';
      const isCooldown     = s.phase === 'COOLDOWN';
      const isSellDir = signalDir === 'SELL' || signalDir === 'SELL_PARTIAL';
      const isBuyDir  = signalDir === 'BUY'  || signalDir === 'BUY_PARTIAL';

      const headerClass = isSellDir ? 'cascade-header-sell'
        : isBuyDir ? 'cascade-header-buy' : 'cascade-header-wait';

      const glowClass = (signalDir === 'BUY_PARTIAL') ? 'glow-buy'
        : (signalDir === 'SELL_PARTIAL') ? 'glow-sell' : '';

      const headerLabel = isActiveLocked
        ? `${s.signal} SIGNAL 🔒 AKTIF`
        : isCooldown       ? '⏳ COOLDOWN'
        : signalDir === 'SELL'         ? '▼ SELL CONFIRMED'
        : signalDir === 'BUY'          ? '▲ BUY CONFIRMED'
        : signalDir === 'SELL_PARTIAL' ? '▼ SELL — TUNGGU M5 <span class="anticipation-badge">⚡ ANTISIPASI</span>'
        : signalDir === 'BUY_PARTIAL'  ? '▲ BUY — TUNGGU M5 <span class="anticipation-badge">⚡ ANTISIPASI</span>'
        : '⏳ SCANNING...';

      const tfRow = (label, role, trend, rsi, gateMet, gateLabel) => {
        const trendClass = trend.includes('BULL') ? 'bull' : trend.includes('BEAR') ? 'bear' : 'neutral';
        return `
          <div class="cascade-tf-row ${gateMet ? 'gate-met' : 'gate-wait'}">
            <div class="cascade-tf-left">
              <span class="cascade-tf-tag">${label}</span>
              <span class="cascade-tf-role">${role}</span>
            </div>
            <div class="cascade-tf-right">
              <span class="cascade-trend ${trendClass}">${trend}</span>
              <span class="cascade-rsi">RSI ${rsi.toFixed ? rsi.toFixed(1) : rsi}</span>
              <span class="cascade-gate">${gateMet ? '✅' : '⬜'} ${gateLabel}</span>
            </div>
          </div>`;
      };

      const h1Gate  = isSellDir ? h1Bear  : (isBuyDir ? h1Bull  : (h1Bull || h1Bear));
      const m15Gate = isSellDir ? m15Bear : (isBuyDir ? m15Bull : (m15Bull || m15Bear));
      const m5Gate  = isSellDir ? m5Bear  : (isBuyDir ? m5Bull  : (m5Bull || m5Bear));
      const h1Label  = isSellDir ? 'Bearish' : 'Bullish';
      const m15Label = isSellDir ? 'Bearish' : 'Bullish';
      const m5Label  = isSellDir ? 'Bearish' : (isBuyDir ? 'Bullish' : 'Arah?');

      const metCount   = isSellDir ? cascadeSellMet : (isBuyDir ? cascadeBuyMet : 0);
      const progressPct = Math.round((metCount / 3) * 100);
      const barColor   = progressPct === 100
        ? (isSellDir ? '#ff073a' : '#00ff41')
        : progressPct >= 66 ? '#ffaa00' : '#444';

      // Entry levels
      let entryLevel = '--', slLevel = '--', tp1Level = '--', tp2Level = '--', rrVal = '--';
      const sc  = sellScenario;
      const bsc = buyScenario;

      if ((signalDir === 'SELL' || (isActiveLocked && s.signal === 'SELL')) && sc && sc.direction !== 'BUY') {
        entryLevel = `$${sc.entryHigh ? sc.entryHigh.toFixed(0) : '--'}–$${sc.entryLow ? sc.entryLow.toFixed(0) : '--'}`;
        slLevel  = sc.sl  ? `$${sc.sl.toFixed(0)}`  : '--';
        tp1Level = sc.tp1 ? `$${sc.tp1.toFixed(0)}` : '--';
        tp2Level = sc.tp2 ? `$${sc.tp2.toFixed(0)}` : '--';
        rrVal    = sc.rr  ? `1:${sc.rr}` : '--';
      } else if ((signalDir === 'BUY' || (isActiveLocked && s.signal === 'BUY'))) {
        // Pilih sumber data: Prioritaskan breakout (bsc) jika sudah aktif, 
        // kalau tidak gunakan skenario utama (sc) jika itu adalah BUY
        const src = (bsc && bsc.state === 'BREAKOUT') ? bsc : (sc && sc.direction === 'BUY' ? sc : null);
        
        if (src) {
          if (src.entryBuyStop) {
            entryLevel = `$${src.entryBuyStop.toFixed(0)}`;
          } else if (src.entryLow && src.entryHigh) {
            entryLevel = `$${src.entryLow.toFixed(0)}–$${src.entryHigh.toFixed(0)}`;
          }
          
          slLevel  = src.sl  ? `$${src.sl.toFixed(0)}`  : '--';
          tp1Level = src.tp1 ? `$${src.tp1.toFixed(0)}` : '--';
          tp2Level = src.tp2 ? `$${src.tp2.toFixed(0)}` : '--';
          rrVal    = src.rr  ? `1:${src.rr}` : '--';
        }
      } else if (isActiveLocked) {
        slLevel  = s.sl  ? `$${s.sl.toFixed(0)}`  : '--';
        tp1Level = s.tp1 ? `$${s.tp1.toFixed(0)}` : '--';
        tp2Level = s.tp2 ? `$${s.tp2.toFixed(0)}` : '--';
      }

      return `
        <div class="entry-card cascade-signal-card ${glowClass}">
          <div class="cascade-signal-header ${headerClass}">
            <span class="cascade-signal-label">${headerLabel}</span>
            <span class="cascade-signal-tf">3TF CASCADE</span>
          </div>

          <div class="cascade-progress-wrap">
            <div class="cascade-progress-bar-bg">
              <div class="cascade-progress-fill" style="width:${progressPct}%;background:${barColor}"></div>
            </div>
            <span class="cascade-progress-label">${metCount}/3 TF Konfirmasi</span>
          </div>

          <div class="cascade-tf-list">
            ${tfRow('H1', 'Filter Arah',   h1Trend,  h1Rsi,  h1Gate,  h1Label)}
            ${tfRow('M15','Konfirmasi',     m15Trend, m15Rsi, m15Gate, m15Label)}
            ${tfRow('M5', 'Entry Timing',   m5Trend,  m5Rsi,  m5Gate,  m5Label)}
          </div>

          <div class="cascade-entry-box">
            <div class="cascade-level-row">
              <span class="cascade-level-label">ENTRY</span>
              <span class="cascade-level-val">${entryLevel}</span>
            </div>
            <div class="cascade-level-row">
              <span class="cascade-level-label">SL</span>
              <span class="cascade-level-val bear">${slLevel}</span>
            </div>
            <div class="cascade-level-row">
              <span class="cascade-level-label">TP1</span>
              <span class="cascade-level-val bull">${tp1Level}</span>
            </div>
            <div class="cascade-level-row">
              <span class="cascade-level-label">TP2</span>
              <span class="cascade-level-val bull">${tp2Level}</span>
            </div>
            <div class="cascade-level-row">
              <span class="cascade-level-label">R:R</span>
              <span class="cascade-level-val ${progressPct === 100 ? 'bull' : ''}">${rrVal}</span>
            </div>
          </div>

          ${progressPct < 100 && !isActiveLocked ? `
          <div class="cascade-waiting-msg">
            ${metCount === 0 ? '⏳ Menunggu sinyal arah dari H1...' :
              metCount === 1 ? '⏳ H1 OK — tunggu konfirmasi M15...' :
              '⏳ H1+M15 OK — tunggu M5 entry timing...'}
          </div>` : ''}

          ${isActiveLocked ? `<div class="cascade-lock-badge ${s.signal === 'BUY' ? 'bull' : 'bear'}">
            🔒 ${s.signal} AKTIF — Candle ${s.m15Count}/4 M15
          </div>` : ''}
        </div>`;
    };

    container.innerHTML = renderSell(sellScenario) + renderCascadeSignal();
  },

  _showLoading() {
    const badge = document.getElementById('final-signal-badge');
    const container = document.getElementById('entry-cards-container');
    if (badge) { badge.className = 'signal-badge wait'; badge.innerText = 'LOADING'; }
    if (container) container.innerHTML = '<div class="entry-card card-waiting"><div class="card-note">Sinkronisasi data semua TF...</div></div>';
  },

  updateMatrix(indicatorsMap, trends) {
    const container = document.getElementById('tf-analysis-matrix');
    if (!container) return;

    const tfs = [
      { id: 'H4', role: 'Trend Filter', method: 'FILTER' },
      { id: 'H1', role: 'Major Structure', method: 'EMA' },
      { id: 'M15', role: 'Signal Confirm', method: 'EMA' },
      { id: 'M5', role: 'Entry Timing', method: 'EMA' }
    ];

    container.innerHTML = tfs.map(tf => {
      const ind = indicatorsMap[tf.id];
      const trendData = trends ? trends[tf.id] : { trend: 'SIDEWAYS', rsi: 50 };
      const trend = trendData ? (trendData.trend || 'SIDEWAYS') : 'SIDEWAYS';
      const trendClass = (trend.includes('BULL') || trend === 'BULLISH')
        ? 'bull-border'
        : (trend.includes('BEAR') || trend === 'BEARISH')
          ? 'bear-border'
          : '';
      if (!ind) return '<div class="analysis-card loading">Loading...</div>';
      const rsiDirClass = ind.rsiDirection === 'Rising' ? 'bull' : 'bear';
      let extraInfo = '';
      if (tf.id === 'H1') extraInfo = `<div class="stat-row"><span>Structure:</span> <span class="highlight">${trendData.structure || '--'}</span></div>`;
      return `
        <div class="analysis-card ${trendClass}">
          <div class="card-header">
            <span class="tf-tag">${tf.id} <small>[${tf.method}]</small></span>
            <span class="tf-role">${tf.role}</span>
          </div>
          <div class="card-body">
            <div class="stat-row"><span>Trend:</span><span class="trend-val ${trend}">${trend}</span></div>
            <div class="stat-row"><span>RSI:</span><span>${ind.rsi.toFixed(1)} <small class="${rsiDirClass}">(${ind.rsiDirection})</small></span></div>
            ${extraInfo}
          </div>
        </div>`;
    }).join('');
  },

  log(msg) {
    const logEl = document.getElementById('alert-console');
    if (!logEl) return;
    const item = document.createElement('div');
    item.className = 'alert-item';
    item.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logEl.prepend(item);
    if (logEl.children.length > 30) logEl.lastChild.remove();
  }
};
