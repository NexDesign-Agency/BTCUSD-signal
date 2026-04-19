import { binance } from './api/binance.js';
import { IndicatorEngine } from './logic/indicators.js';
import { SignalEngine } from './logic/signal-engine.js';
import { ChartComponent } from './components/chart.js';
import { UIManager } from './components/signal-panel.js';
import { SignalStorage } from './storage/history.js';

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
    const initialSig = SignalEngine.calculateSignal(startMap);
    UIManager.updateMatrix(startMap, initialSig.trends);
    UIManager.updateSignal(initialSig);
    
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
  // Chart population
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
  document.querySelectorAll('.ind-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const type = e.target.getAttribute('data-ind');
      const isActive = e.target.classList.toggle('active');
      chartApp.toggleSeries(type, isActive);
      UIManager.log(`${type} indicator ${isActive ? 'enabled' : 'disabled'}.`);
    });
  });

  document.querySelectorAll('.tf-btn').forEach(btn => {
    const btnTfRaw = btn.getAttribute('data-tf'); // H1, H4 etc
    // Normalize to binance format
    const mapping = { 'M5':'5m', 'M15':'15m', 'H1':'1h', 'H4':'4h' };
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

let previousSignal = 'WAIT';
let lastAlertedSignalDirection = null; // Track direction for re-alert control

// Single-play alert: beep + voice ONCE only
function playSignalAlert(signal, confidence, isHedge = false) {
  if (isHedge) {
    playHedgeAlertSound();
    setTimeout(() => playVoiceAlert(`Warning. Hedge signal. Flip to ${signal}. Confidence ${confidence} percent.`), 400);
  } else {
    playAlertSound();
    setTimeout(() => playVoiceAlert(`${signal} Signal Active. Confidence ${confidence} percent.`), 300);
  }
}

function startEngine() {
  binance.onTick((tick) => {
    const tf = tick.interval;
    if (dataMap[tf]) {
      const arr = dataMap[tf];
      const last = arr[arr.length - 1];
      if (tick.time > last.time) {
        arr.push({ time: tick.time, open: tick.open, high: tick.high, low: tick.low, close: tick.close, volume: tick.volume });
      } else {
        arr[arr.length - 1] = { ...arr[arr.length - 1], high: Math.max(last.high, tick.high), low: Math.min(last.low, tick.low), close: tick.close, volume: tick.volume };
      }
      indicatorsMap[tf] = IndicatorEngine.calculate(arr);

      if (tf === activeTF) {
        const ind = indicatorsMap[tf];
        const tickCandle = arr[arr.length - 1];
        const tickVol = { time: tickCandle.time, value: tickCandle.volume, color: tickCandle.close >= tickCandle.open ? 'rgba(0, 255, 65, 0.5)' : 'rgba(255, 7, 58, 0.5)' };
        const tickEma21 = (ind && ind.ema21 !== null) ? { time: tick.time, value: ind.ema21 } : null;
        const tickEma50 = (ind && ind.ema50 !== null) ? { time: tick.time, value: ind.ema50 } : null;
        const tickBB = (ind && ind.bb) ? { upper: { time: tick.time, value: ind.bb.upper }, lower: { time: tick.time, value: ind.bb.lower }, middle: { time: tick.time, value: ind.bb.middle } } : null;
        const tickMacd = (ind && ind.macd) ? { time: tick.time, value: ind.macd.histogram, color: ind.macd.histogram >= 0 ? 'rgba(0, 255, 65, 0.4)' : 'rgba(255, 7, 58, 0.4)' } : null;
        chartApp.updateTick(tickCandle, tickEma21, tickEma50, tickVol, tickBB, tickMacd);
        UIManager.updatePrice(tick.close);
      }
    }

    const signalMap = { 'H4': indicatorsMap['4h'], 'H1': indicatorsMap['1h'], 'M15': indicatorsMap['15m'], 'M5': indicatorsMap['5m'] };
    const sigResult = SignalEngine.calculateSignal(signalMap);
    UIManager.updateSignal(sigResult);
    
    // Update Chart: signal marker when entering new signal
    if (sigResult.signal !== 'WAIT' && previousSignal === 'WAIT') {
      const now = Math.floor(Date.now() / 1000);
      const isHedge = sigResult.hedge !== null;
      chartApp.setMarkers([{
        time: now,
        position: sigResult.signal === 'BUY' ? 'belowBar' : 'aboveBar',
        color: isHedge ? '#ffaa00' : (sigResult.signal === 'BUY' ? '#00ff41' : '#ff073a'),
        shape: sigResult.signal === 'BUY' ? 'arrowUp' : 'arrowDown',
        text: isHedge ? `HEDGE ${sigResult.signal}` : sigResult.signal
      }]);
    }

    // Update Support/Resistance lines on chart
    if (sigResult.pivots) {
      chartApp.updateSRLines(sigResult.pivots.support, sigResult.pivots.resistance);
    }

    // UI Matrix update
    UIManager.updateMatrix(signalMap, sigResult.trends);

    // --- Voice Alert: ONCE per direction change ---
    if (sigResult.signal !== 'WAIT') {
      const isHedge = sigResult.hedge !== null;
      const directionChanged = lastAlertedSignalDirection !== sigResult.signal;

      if (previousSignal === 'WAIT' || directionChanged) {
        // New signal or direction flip → alert ONCE
        playSignalAlert(sigResult.signal, sigResult.confidence, isHedge);
        lastAlertedSignalDirection = sigResult.signal;
        
        if (Notification.permission === 'granted') {
          const title = isHedge ? `⚠️ HEDGE → ${sigResult.signal}!` : `🔥 BTC ${sigResult.signal} SIGNAL!`;
          new Notification(title, {
            body: `Confidence: ${sigResult.confidence}% | ${sigResult.orderType}`,
            icon: '/favicon.ico'
          });
        }
      }

      // Log signal (deduplicated by minute)
      const sigId = `${sigResult.signal}-${Math.floor(Date.now() / 60000)}`;
      if (lastAlertedSignalId !== sigId) {
        lastAlertedSignalId = sigId;
        const primary = sigResult.entryOptions && sigResult.entryOptions[0];
        SignalStorage.addSignal({
          id: sigId, type: sigResult.signal,
          entry: primary ? primary.entryHigh : 0,
          sl: primary ? primary.sl : 0,
          tp1: primary ? primary.tp1 : 0,
          tp2: primary ? primary.tp2 : 0,
          time: Date.now(), status: 'OPEN'
        });
        const prefix = sigResult.hedge ? '⚠️ HEDGE' : '🎯 SIGNAL';
        UIManager.log(`${prefix}: ${sigResult.signal} (${sigResult.confidence}%) — ${sigResult.orderType}`);
      }
    } else {
      lastAlertedSignalDirection = null;
    }

    previousSignal = sigResult.signal;
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
  // Double-beep at higher pitch for urgency
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
    utterance.rate = 1.2; // Slightly faster for urgency
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  } else {
    // Fallback if Speech API not supported
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
