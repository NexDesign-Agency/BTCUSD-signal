export class BinanceConnector {
  constructor() {
    this.symbol = 'BTCUSDT';
    // Binance has 4 alternate base URLs — try each when one is blocked
    this.baseUrls = [
      'https://api.binance.com',
      'https://api1.binance.com',
      'https://api2.binance.com',
      'https://api3.binance.com',
    ];
    this.wsUrl = 'wss://stream.binance.com:9443/ws';
    this.sockets = {};
    this.subscribers = [];
    this.workingBaseUrl = null; // Cache the first URL that works
  }

  onTick(callback) {
    this.subscribers.push(callback);
  }

  // TF map: Binance interval → CryptoCompare aggregate (minutes)
  _ccTfMap(timeframe) {
    return { '5m': 5, '15m': 15, '1h': 60, '4h': 240 }[timeframe] || 60;
  }

  // CryptoCompare fallback — free, no auth, CORS-friendly
  async _getHistoryFromCC(timeframe, limit = 300) {
    const aggMinutes = this._ccTfMap(timeframe);
    const isHourly = aggMinutes >= 60;
    const endpoint = isHourly
      ? `https://min-api.cryptocompare.com/data/v2/histohour?fsym=BTC&tsym=USDT&limit=${limit}&aggregate=${aggMinutes / 60}`
      : `https://min-api.cryptocompare.com/data/v2/histominute?fsym=BTC&tsym=USDT&limit=${limit}&aggregate=${aggMinutes}`;

    const res = await fetch(endpoint);
    if (!res.ok) throw new Error(`CryptoCompare error: ${res.statusText}`);
    const json = await res.json();
    if (json.Response !== 'Success') throw new Error('CryptoCompare returned error');

    return json.Data.Data.map(d => ({
      time: d.time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volumefrom
    })).filter(d => d.close > 0); // Strip empty candles
  }

  async getHistory(timeframe, limit = 300) {
    // 1. Try cached working URL first
    if (this.workingBaseUrl) {
      try {
        const data = await this._fetchBinance(this.workingBaseUrl, timeframe, limit);
        if (data && data.length > 0) return data;
      } catch (_) {
        this.workingBaseUrl = null; // Invalidate cache, try all again
      }
    }

    // 2. Try all Binance base URLs
    for (const base of this.baseUrls) {
      try {
        const data = await this._fetchBinance(base, timeframe, limit);
        if (data && data.length > 0) {
          this.workingBaseUrl = base; // Cache the winner
          console.log(`[Binance] Connected via ${base}`);
          return data;
        }
      } catch (_) {
        // Try next
      }
    }

    // 3. All Binance URLs failed → CryptoCompare fallback
    console.warn(`[Fallback] Binance blocked. Using CryptoCompare for ${timeframe}...`);
    try {
      return await this._getHistoryFromCC(timeframe, limit);
    } catch (err) {
      console.error('[Fallback] CryptoCompare also failed:', err);
      return [];
    }
  }

  async _fetchBinance(baseUrl, timeframe, limit) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout
    try {
      const res = await fetch(
        `${baseUrl}/api/v3/klines?symbol=${this.symbol}&interval=${timeframe}&limit=${limit}`,
        { signal: controller.signal }
      );
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.map(d => ({
        time: Math.floor(d[0] / 1000),
        open: parseFloat(d[1]),
        high: parseFloat(d[2]),
        low: parseFloat(d[3]),
        close: parseFloat(d[4]),
        volume: parseFloat(d[5])
      }));
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }

  startStreaming(timeframes = ['5m', '15m', '1h', '4h']) {
    const streams = timeframes.map(tf => `${this.symbol.toLowerCase()}@kline_${tf}`);
    const socketUrl = `${this.wsUrl}/${streams.join('/')}`;

    const ws = new WebSocket(socketUrl);

    ws.onopen = () => console.log('[WS] Binance stream connected.');

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      const k = msg.k;
      const tick = {
        tf: k.i,
        time: Math.floor(k.t / 1000),
        open: parseFloat(k.o),
        high: parseFloat(k.h),
        low: parseFloat(k.l),
        close: parseFloat(k.c),
        volume: parseFloat(k.v),
        isFinal: k.x,
        interval: k.i
      };
      this.subscribers.forEach(cb => cb(tick));
    };

    ws.onerror = (e) => {
      console.warn('[WS] Binance stream error. Will attempt fallback polling.', e);
      this._startPollingFallback(timeframes);
    };

    ws.onclose = () => {
      console.log('[WS] Binance stream closed, reconnecting in 5s...');
      setTimeout(() => this.startStreaming(timeframes), 5000);
    };

    this.sockets.main = ws;
  }

  // Polling fallback when WebSocket is blocked (every 10s)
  _startPollingFallback(timeframes) {
    if (this._pollingTimer) return; // Already polling
    console.warn('[Polling] WS blocked — switching to 10s polling fallback.');

    this._pollingTimer = setInterval(async () => {
      for (const tf of timeframes) {
        try {
          const data = await this.getHistory(tf, 2); // Fetch last 2 candles
          if (!data || data.length === 0) continue;
          const latest = data[data.length - 1];
          this.subscribers.forEach(cb => cb({
            tf,
            time: latest.time,
            open: latest.open,
            high: latest.high,
            low: latest.low,
            close: latest.close,
            volume: latest.volume,
            isFinal: false,
            interval: tf
          }));
        } catch (_) {}
      }
    }, 10000);
  }
}

export const binance = new BinanceConnector();
