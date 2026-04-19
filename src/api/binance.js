export class BinanceConnector {
  constructor() {
    this.symbol = 'BTCUSDT';
    this.baseUrl = 'https://api.binance.com';
    this.wsUrl = 'wss://stream.binance.com:9443/ws';
    this.sockets = {};
    this.subscribers = [];
  }

  onTick(callback) {
    this.subscribers.push(callback);
  }

  async getHistory(timeframe, limit = 300) {
    // Binance TFs: 5m, 15m, 1h, 4h
    try {
      const response = await fetch(`${this.baseUrl}/api/v3/klines?symbol=${this.symbol}&interval=${timeframe}&limit=${limit}`);
      if (!response.ok) throw new Error(`Binance API Error: ${response.statusText}`);
      const data = await response.json();
      return data.map(d => ({
      time: Math.floor(d[0] / 1000),
      open: parseFloat(d[1]),
      high: parseFloat(d[2]),
      low: parseFloat(d[3]),
      close: parseFloat(d[4]),
      volume: parseFloat(d[5])
    }));
    } catch (err) {
      console.error('Binance Connector Error:', err);
      return [];
    }
  }

  startStreaming(timeframes = ['5m', '15m', '1h', '4h']) {
    // We listen to the 1m stream for the "master" price update, and others for matrix
    const streams = timeframes.map(tf => `${this.symbol.toLowerCase()}@kline_${tf}`);
    const socketUrl = `${this.wsUrl}/${streams.join('/')}`;
    
    const ws = new WebSocket(socketUrl);
    
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      const k = msg.k;
      const tick = {
        tf: msg.s === this.symbol ? msg.e.split('_')[1] : null, // Not exactly msg.e, Binance format is slightly different
        time: Math.floor(k.t / 1000),
        open: parseFloat(k.o),
        high: parseFloat(k.h),
        low: parseFloat(k.l),
        close: parseFloat(k.c),
        volume: parseFloat(k.v),
        isFinal: k.x,
        interval: k.i
      };

      // Notify subscribers
      this.subscribers.forEach(cb => cb(tick));
    };

    ws.onclose = () => {
      console.log('Binance WS closed, reconnecting...');
      setTimeout(() => this.startStreaming(timeframes), 5000);
    };

    this.sockets.main = ws;
  }
}

export const binance = new BinanceConnector();
