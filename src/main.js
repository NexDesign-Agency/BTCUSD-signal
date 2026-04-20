import { binance } from './api/binance.js';
import { IndicatorEngine } from './logic/indicators.js';
import { SignalEngine } from './logic/signal-engine.js';
import { ChartComponent } from './components/chart.js';
import { UIManager } from './components/signal-panel.js';
import { SignalStorage } from './storage/history.js';

// ============================================================================
// main.js v3.1
//
// FIXES:
// [FIX #5] M5 tick: HAPUS analyzeScenarios() dari blok M5 tick.
//          analyzeScenarios() bisa trigger state machine (fire signal).
//          Sekarang M5 tick hanya pakai _lastScenarioResult (cache).
//          State machine HANYA bisa trigger dari M15 candle close.
// ============================================================================

let chartApp = null;
let activeTF = '1h'; // default to 1h

// State
const dataMap = {
  '5m': [],
  '15m': [],
  '1h': [],
  '4h': []
};

const indicatorsMap = {};
let lastAlertedSignalId = null;
let lastSurgeType = 'NONE';

// [FIX #5] Cache hasil analyzeScenarios() terakhir.
// M5 tick hanya baca cache ini — TIDAK re-run analyzeScenarios().
// analyzeScenarios() HANYA dipanggil saat M15 candle close (dan saat bootstrap awal).
let _lastScenarioResult = null;

async function bootstrap() {
  const overlay = document.getElementById('startup-overlay');
  const dashboard = document.getElementById('dashboard-main');
  const btn = document.getElementById('connect-btn');
  const statusEl = document.getElementById('connection-status');

  statusEl.innerText = "Binance API mode (Free & Real-time)";

  btn.addEventListener('click', async () => {
    overlay.classList.remove('active');
    dashboard.style.display = 'flex';

    // Request Audio context permission
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();

    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }

    // Initialize Chart FIRST
    chartApp = new ChartComponent('chart-container');

    await loadInitialData();
    initializeUI();

    // Immediate UI Update before first tick
    const startMap = {
      'H4': indicatorsMap['4h'],
      'H1': indicatorsMap['1h'],
      'M15': indicatorsMap['15m'],
      'M5': indicatorsMap['5m']
    };
    // Boleh panggil analyzeScenarios di bootstrap — bukan dari tick loop
    _lastScenarioResult = SignalEngine.analyzeScenarios(startMap);
    UIManager.updateMatrix(startMap, _lastScenarioResult.trends);
    UIManager.updateScenarios(_lastScenarioResult);
    if (_lastScenarioResult.pivots) {
      chartApp.updateSRLines(
        _lastScenarioResult.pivots.support, _lastScenarioResult.pivots.resistance,
        _lastScenarioResult.pivots.supportLevels, _lastScenarioResult.pivots.resistanceLevels
      );
    }

    startEngine();

    UIManager.log('System initialized. Dashboard launched.');
  });
}


async function loadInitialData() {
  const tfs = ['5m', '15m', '1h', '4h'];
  UIManager.log('Connecting to market data source...');

  let successCount = 0;
  for (const tf of tfs) {
    try {
      const data = await binance.getHistory(tf, 300);
      if (data && data.length > 0) {
        dataMap[tf] = data;
        indicatorsMap[tf] = IndicatorEngine.calculate(dataMap[tf]);
        successCount++;
        UIManager.log(`[OK] ${tf} data loaded (${data.length} candles).`);
      } else {
        UIManager.log(`[WARN] ${tf} returned empty data.`);
      }
    } catch (e) {
      console.error(`Failed to load ${tf}`, e);
      UIManager.log(`[ERR] Failed to load ${tf}: ${e.message}`);
    }
  }

  if (successCount === 0) {
    UIManager.log('CRITICAL: All data sources failed. Check internet connection.');
  } else {
    const src = binance.workingBaseUrl ? 'Binance' : 'CryptoCompare (fallback)';
    UIManager.log(`Historical data loaded via ${src}. ${successCount}/4 TFs ready.`);
  }
}


function prepareVolumeData(data) {
  if (!data) return [];
  return data.map(d => ({
    time: d.time,
    value: d.volume,
    color: d.close >= d.open ? 'rgba(0, 255, 65, 0.5)' : 'rgba(255, 7, 58, 0.5)'
  }));
}

function initializeUI() {
  const data = dataMap[activeTF];
  if (!data || data.length === 0) return;

  const ind = indicatorsMap[activeTF];
  const volData = prepareVolumeData(data);

  const bbData = ind ? {
    upper: ind.bbUpperData,
    lower: ind.bbLowerData,
    middle: ind.bbMiddleData
  } : null;

  chartApp.setData(data, ind?.ema21Data, ind?.ema50Data, volData, bbData, ind?.macdHistData);

  // Wire up AUTO FIT
  document.getElementById('btn-autofit').addEventListener('click', () => {
    chartApp.fitChart();
    UIManager.log('Chart view reset to Auto-Fit.');
  });

  // Wire up INDICATOR Toggles
  let entryVisible = true;
  let srVisible = false; // S/R zone lines (tombol S/R) — terpisah dari ENTRY

  // On init: hide all indicators since buttons start as inactive
  chartApp.toggleSeries('MA', false);
  chartApp.toggleSeries('BB', false);
  chartApp.toggleSeries('VOL', false);
  chartApp.toggleSeries('MACD', false);

  document.querySelectorAll('.ind-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const type = e.target.getAttribute('data-ind');

      // ── ENTRY button: toggle entry projection lines (SL/TP/zona entry) ──
      if (type === 'ENTRY') {
        entryVisible = e.target.classList.toggle('active');
        // ENTRY toggle tidak mempengaruhi srVisible (S/R zona umum)
        if (entryVisible) {
          chartApp.srVisible = true;
          if (_lastScenarioResult) {
            chartApp.updateEntryProjections(
              _lastScenarioResult.sellScenario,
              _lastScenarioResult.buyScenario
            );
          }
        } else {
          chartApp._clearEntryProjections();
        }
        UIManager.log(`ENTRY projection lines ${entryVisible ? 'enabled' : 'hidden'}.`);
        return;
      }

      // ── S/R button: toggle Support/Resistance zone lines ──
      if (type === 'SR') {
        srVisible = e.target.classList.toggle('active');
        if (srVisible) {
          chartApp.srVisible = true;
          if (_lastScenarioResult && _lastScenarioResult.pivots) {
            chartApp.updateSRLines(
              _lastScenarioResult.pivots.support,
              _lastScenarioResult.pivots.resistance,
              _lastScenarioResult.pivots.supportLevels,
              _lastScenarioResult.pivots.resistanceLevels
            );
          }
        } else {
          // Hapus hanya S/R zone lines, jangan hapus entry projections
          chartApp.supportLines.forEach(l => chartApp.candleSeries.removePriceLine(l));
          chartApp.supportLines = [];
          chartApp.resistanceLines.forEach(l => chartApp.candleSeries.removePriceLine(l));
          chartApp.resistanceLines = [];
        }
        UIManager.log(`S/R zone lines ${srVisible ? 'enabled' : 'hidden'}.`);
        return;
      }

      // ── Other indicator buttons (MA, BB, VOL, MACD) ──
      const isActive = e.target.classList.toggle('active');
      chartApp.toggleSeries(type, isActive);
      UIManager.log(`${type} indicator ${isActive ? 'enabled' : 'disabled'}.`);
    });
  });

  window._entryVisible = () => entryVisible;
  window._srVisible    = () => srVisible;

  document.querySelectorAll('.tf-btn').forEach(btn => {
    const btnTfRaw = btn.getAttribute('data-tf');
    const mapping = { 'M5': '5m', 'M15': '15m', 'H1': '1h', 'H4': '4h' };
    const mappedTf = mapping[btnTfRaw];

    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      activeTF = mappedTf;
      const newInd = indicatorsMap[activeTF];
      const newVolData = prepareVolumeData(dataMap[activeTF]);
      const newBBData = newInd ? {
        upper: newInd.bbUpperData,
        lower: newInd.bbLowerData,
        middle: newInd.bbMiddleData
      } : null;
      chartApp.setData(dataMap[activeTF], newInd?.ema21Data, newInd?.ema50Data, newVolData, newBBData, newInd?.macdHistData);
    });
  });
}

let previousPhase = 'SCANNING';
let lastM15Time = 0;
let lastAlertedSignal = null;

function handleSLTPEvent(ev, price) {
  const icon = ev.event.includes('TP') ? '✅' : '❌';
  const rrLabel = ev.event === 'TP2_HIT' ? 'TP2' : ev.event === 'TP1_HIT' ? 'TP1' : 'SL';
  const msg = ev.event === 'SL_HIT'
    ? `SL Hit — Signal ${ev.signal} Closed ❌ @ $${price.toFixed(0)}`
    : `${rrLabel} Hit — Signal ${ev.signal} Profit ✅ @ $${price.toFixed(0)}`;
  UIManager.log(`⚡ ${msg}`);
  playAlertSound();
  setTimeout(() => playVoiceAlert(msg), 300);
  if (Notification.permission === 'granted') {
    new Notification(`${icon} ${rrLabel} Hit!`, { body: msg, icon: '/favicon.ico' });
  }
}

function handleM15Event(ev) {
  if (ev.event === 'EXPIRED') {
    UIManager.log(`⏰ Signal ${ev.signal} Expired — 4 M15 candles passed. Resuming scan.`);
  } else if (ev.event === 'SCANNING_RESUMED') {
    UIManager.log(`🔄 Cooldown selesai. Scanning zona baru...`);
  }
}

function startEngine() {
  binance.onTick((tick) => {
    const tf = tick.interval;

    // ── CHART & DATA UPDATE (every tick) ──────────────────────────────────
    if (dataMap[tf]) {
      const arr = dataMap[tf];
      const last = arr[arr.length - 1];
      if (tick.time > last.time) {
        arr.push({ time: tick.time, open: tick.open, high: tick.high, low: tick.low, close: tick.close, volume: tick.volume });
      } else {
        arr[arr.length - 1] = {
          ...arr[arr.length - 1],
          high: Math.max(last.high, tick.high),
          low: Math.min(last.low, tick.low),
          close: tick.close,
          volume: tick.volume
        };
      }
      indicatorsMap[tf] = IndicatorEngine.calculate(arr);

      if (tf === activeTF) {
        const ind = indicatorsMap[tf];
        const tickCandle = arr[arr.length - 1];
        const tickVol = {
          time: tickCandle.time,
          value: tickCandle.volume,
          color: tickCandle.close >= tickCandle.open ? 'rgba(0, 255, 65, 0.5)' : 'rgba(255, 7, 58, 0.5)'
        };
        const tickEma21 = (ind && ind.ema21 !== null) ? { time: tick.time, value: ind.ema21 } : null;
        const tickEma50 = (ind && ind.ema50 !== null) ? { time: tick.time, value: ind.ema50 } : null;
        const tickBB = (ind && ind.bb) ? {
          upper: { time: tick.time, value: ind.bb.upper },
          lower: { time: tick.time, value: ind.bb.lower },
          middle: { time: tick.time, value: ind.bb.middle }
        } : null;
        const tickMacd = (ind && ind.macd) ? {
          time: tick.time,
          value: ind.macd.histogram,
          color: ind.macd.histogram >= 0 ? 'rgba(0, 255, 65, 0.4)' : 'rgba(255, 7, 58, 0.4)'
        } : null;
        chartApp.updateTick(tickCandle, tickEma21, tickEma50, tickVol, tickBB, tickMacd);
        UIManager.updatePrice(tick.close);
      }
    }

    // ── REAL-TIME SL/TP CHECK (every tick, only when signal ACTIVE) ───────
    const slTpEvent = SignalEngine.checkSLTP(tick.close);
    if (slTpEvent) handleSLTPEvent(slTpEvent, tick.close);

    // ── M15 CANDLE CLOSE → SATU-SATUNYA tempat analyzeScenarios() dipanggil ──
    // [FIX #5] analyzeScenarios() HANYA di sini. State machine fire signal
    //          tidak bisa terjadi dari tick M5 maupun tick lainnya.
    const isM15Close = tf === '15m' && tick.time > lastM15Time;
    if (isM15Close) {
      lastM15Time = tick.time;

      // Advance state machine counters (expired / cooldown)
      const m15Ev = SignalEngine.onM15CandleClose();
      if (m15Ev) handleM15Event(m15Ev);

      // Build scenarios & cache hasilnya
      const signalMap = {
        'H4': indicatorsMap['4h'],
        'H1': indicatorsMap['1h'],
        'M15': indicatorsMap['15m'],
        'M5': indicatorsMap['5m']
      };
      _lastScenarioResult = SignalEngine.analyzeScenarios(signalMap);

      // Update UI
      UIManager.updateScenarios(_lastScenarioResult);
      UIManager.updateMatrix(signalMap, _lastScenarioResult.trends);

      // Chart lines — mutually exclusive:
      // ENTRY ON  → hanya entry projection (SL/TP/zona entry) sesuai panel kanan
      // ENTRY OFF → hanya S/R zone map umum (ZONA SELL 1, ZONA BUY 1, dll)
      const isEntryOn = typeof window._entryVisible === 'function' ? window._entryVisible() : true;
      if (isEntryOn) {
        // Clear general S/R zones, draw entry-specific projection only
        chartApp.updateSRLines(null, null, [], []);
        chartApp.updateEntryProjections(
          _lastScenarioResult.sellScenario,
          _lastScenarioResult.buyScenario
        );
      } else {
        // Show general S/R zone map only
        chartApp.updateEntryProjections(null, null); // clear projections
        if (_lastScenarioResult.pivots) {
          chartApp.updateSRLines(
            _lastScenarioResult.pivots.support,
            _lastScenarioResult.pivots.resistance,
            _lastScenarioResult.pivots.supportLevels,
            _lastScenarioResult.pivots.resistanceLevels
          );
        }
      }

      // Fire alert ONCE when signal menjadi ACTIVE
      const s = _lastScenarioResult.activeSignal;
      if (s.phase === 'ACTIVE' && lastAlertedSignal !== s.lockedTime) {
        lastAlertedSignal = s.lockedTime;
        playAlertSound();
        setTimeout(() => playVoiceAlert(`${s.signal} Signal Active. Price reached zone. All confirmations met.`), 300);
        if (Notification.permission === 'granted') {
          new Notification(`🔥 BTC ${s.signal} SIGNAL!`, {
            body: `Zone reached + confirmations met | SL: $${s.sl ? s.sl.toFixed(0) : '--'} | TP1: $${s.tp1 ? s.tp1.toFixed(0) : '--'}`,
            icon: '/favicon.ico'
          });
        }
        UIManager.log(`🎯 SIGNAL FIRED: ${s.signal} — locked 4 M15 candles. SL: $${s.sl ? s.sl.toFixed(0) : '--'}`);
        SignalStorage.addSignal({
          id: `${s.signal}-${s.lockedTime}`,
          type: s.signal,
          entry: s.entryZonePrice,
          sl: s.sl,
          tp1: s.tp1,
          tp2: s.tp2,
          time: Date.now(),
          status: 'OPEN'
        });
      }

      previousPhase = s.phase;
    }

    // ── M5 TICK: update panel via cache ──
    if (tf === '5m' && _lastScenarioResult) {
      UIManager.updateScenarios(_lastScenarioResult);
      // Only sync entry projection lines per-tick (S/R map rebuilt on M15 close only)
      const entryOn = typeof window._entryVisible === 'function' ? window._entryVisible() : true;
      if (entryOn) {
        chartApp.updateEntryProjections(
          _lastScenarioResult.sellScenario,
          _lastScenarioResult.buyScenario
        );
      }
    }

  });

  binance.startStreaming(['5m', '15m', '1h', '4h']);
}

function playAlertSound() {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1200, audioCtx.currentTime);
  gain.gain.setValueAtTime(0, audioCtx.currentTime);
  gain.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
  osc.start(audioCtx.currentTime);
  osc.stop(audioCtx.currentTime + 0.5);
}

function playHedgeAlertSound() {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  [0, 0.3].forEach(offset => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'square';
    osc.frequency.setValueAtTime(1600, audioCtx.currentTime + offset);
    gain.gain.setValueAtTime(0, audioCtx.currentTime + offset);
    gain.gain.linearRampToValueAtTime(0.4, audioCtx.currentTime + offset + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + offset + 0.2);
    osc.start(audioCtx.currentTime + offset);
    osc.stop(audioCtx.currentTime + offset + 0.2);
  });
}

function playVoiceAlert(text) {
  if ('speechSynthesis' in window) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.2;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  } else {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
  }
}

document.addEventListener('DOMContentLoaded', bootstrap);
