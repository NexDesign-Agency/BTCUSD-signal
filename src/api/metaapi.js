import MetaApi from 'metaapi.cloud-sdk';
import { config } from './config.js';

class MetaApiConnector {
  constructor() {
    this.api = new MetaApi(config.token);
    this.connection = null;
    this.account = null;
    this.subscribers = [];
  }

  onTick(callback) {
    this.subscribers.push(callback);
  }

  async connect() {
    try {
      if (!config.token || config.token === 'YOUR_METAAPI_TOKEN') {
        throw new Error("API Token is not configured. Please edit src/api/config.js");
      }
      this.account = await this.api.metatraderAccountApi.getAccount(config.accountId);
      
      if (this.account.state !== 'DEPLOYED') {
        await this.account.deploy();
      }
      
      await this.account.waitConnected();
      this.connection = this.account.getRPCConnection();
      await this.connection.connect();
      await this.connection.waitSynchronized();
      
      console.log('Connected to MT5 MetaApi!');
      return true;
    } catch (e) {
      console.error('MetaApi Connection Error:', e);
      throw e;
    }
  }

  async getHistory(timeframe, maxBars = 100) {
    if (!this.connection) return [];
    try {
      const history = await this.connection.getHistory(config.symbol, timeframe, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), maxBars);
      return history.bars.map(b => ({
        time: Math.floor(b.time.getTime() / 1000), // convert to unix timestamp
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.tickVolume
      }));
    } catch(e) {
      console.error(`Failed to get history for ${timeframe}`, e);
      return [];
    }
  }

  startStreaming() {
    // In a full implementation, you'd use connection.subscribeToMarketData()
    // For simplicity with HTTP RPC fallback, we poll every 5s if WS is not streaming ticks natively
    setInterval(async () => {
      // Simulate real-time stream using the latest M1/M5 close for our update cycle
      const data = await this.getHistory('1m', 1);
      if (data && data.length > 0) {
        const currentTick = data[0];
        this.subscribers.forEach(cb => cb(currentTick));
      }
    }, 5000);
  }
}

export const mt5 = new MetaApiConnector();
