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
  UIManager.log('Fetching market data from Binance API...');
  
  let successCount = 0;
  for (const tf of tfs) {
    try {
      const data = await binance.getHistory(tf, 300);
      if (data && data.length > 0) {
        dataMap[tf] = data;
        indicatorsMap[tf] = IndicatorEngine.calculate(dataMap[tf]);
        successCount++;
      }
    } catch (e) {
      console.error(`Failed to load ${tf}`, e);
    }
  }

  if (successCount === 0) {
    UIManager.log('CRITICAL ERROR: Failed to fetch market data. Please check your connection.');
  } else {
    UIManager.log('Historical data loaded successfully.');
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

function startEngine() {
  binance.onTick((tick) => {
    // ... logic remains same ...
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
    
    // Update Chart Markers based on Signal history
    const history = SignalStorage.getHistory ? SignalStorage.getHistory() : [];
    const chartMarkers = history.map(s => ({
      time: Math.floor(s.time / 1000),
      position: s.type === 'BUY' ? 'belowBar' : 'aboveBar',
      color: s.type === 'BUY' ? '#00ff41' : '#ff073a',
      shape: s.type === 'BUY' ? 'arrowUp' : 'arrowDown',
      text: s.type
    }));
    chartApp.setMarkers(chartMarkers);

    // UI Matrix update
    UIManager.updateMatrix(signalMap, sigResult.trends);

    // --- Signal Change Detection & Alerts ---
    if (previousSignal === 'WAIT' && sigResult.signal !== 'WAIT') {
      // TRANSITION DETECTED (WAIT -> BUY/SELL)
      playAlertSound(); // Loud Ding
      setTimeout(() => playVoiceAlert(`${sigResult.signal} Signal Active. Confidence ${sigResult.confidence} percent.`), 500);
      
      if (Notification.permission === 'granted') {
        new Notification(`🔥 BTC ${sigResult.signal} SIGNAL!`, {
          body: `Confidence: ${sigResult.confidence}% | Entry: ${sigResult.entry.toFixed(1)}`,
          icon: '/favicon.ico'
        });
      }
    }
    previousSignal = sigResult.signal;

    // Surge Alerts
    if (sigResult.surge !== 'NONE' && sigResult.surge !== lastSurgeType) {
       lastSurgeType = sigResult.surge;
       playVoiceAlert(sigResult.surge === 'BREAKOUT' ? 'Price Breakout' : 'Price Breakdown');
       UIManager.log(`ALERTA: ${sigResult.surge} detected.`);
    } else if (sigResult.surge === 'NONE') {
       lastSurgeType = 'NONE';
    }

    if (sigResult.signal !== 'WAIT') {
       const sigId = `${sigResult.signal}-${Math.floor(Date.now() / 60000)}`;
       if (lastAlertedSignalId !== sigId) {
          lastAlertedSignalId = sigId;
          SignalStorage.addSignal({
            id: sigId, type: sigResult.signal, entry: sigResult.entry, sl: sigResult.sl, 
            tp1: sigResult.tp1, tp2: sigResult.tp2, tp3: sigResult.tp3,
            time: Date.now(), status: 'OPEN'
          });
          UIManager.log(`SIGNAL ACTIVE: ${sigResult.signal} @ ${sigResult.entry.toFixed(1)} (${sigResult.confidence}%)`);
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
