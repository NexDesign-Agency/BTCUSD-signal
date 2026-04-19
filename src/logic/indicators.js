import { EMA, SMA, RSI, MACD, BollingerBands, ATR } from 'technicalindicators';

export const IndicatorEngine = {
  calculate(ohlcv) {
    // ohlcv is an array of objects: { time, open, high, low, close, volume }
    // Sort oldest to newest
    const closes = ohlcv.map(c => c.close);
    const highs = ohlcv.map(c => c.high);
    const lows = ohlcv.map(c => c.low);
    const vols = ohlcv.map(c => c.volume);

    if (closes.length < 50) return null;

    const smaVol20 = SMA.calculate({ period: 20, values: vols });

    const ema9 = EMA.calculate({ period: 9, values: closes });
    const ema21 = EMA.calculate({ period: 21, values: closes });
    const ema50 = EMA.calculate({ period: 50, values: closes });
    
    const rsi14 = RSI.calculate({ period: 14, values: closes });
    
    const macd = MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });

    const bb = BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });
    
    const atr = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });

    const times = ohlcv.map(c => c.time);
    const createSeriesData = (values) => {
      const data = [];
      const offset = closes.length - values.length;
      for (let i = 0; i < values.length; i++) {
        const val = values[i];
        if (val !== null && val !== undefined && !isNaN(val) && val > 0) {
          data.push({ time: times[i + offset], value: val });
        }
      }
      return data;
    };

    const ema21Data = createSeriesData(ema21);
    const ema50Data = createSeriesData(ema50);

    // BB Data logic
    const bbUpperData = [];
    const bbLowerData = [];
    const bbMiddleData = [];
    const bbOffset = closes.length - bb.length;
    bb.forEach((v, i) => {
      bbUpperData.push({ time: times[i + bbOffset], value: v.upper });
      bbLowerData.push({ time: times[i + bbOffset], value: v.lower });
      bbMiddleData.push({ time: times[i + bbOffset], value: v.middle });
    });

    // MACD Histogram logic
    const macdHistData = [];
    const macdOffset = closes.length - macd.length;
    macd.forEach((v, i) => {
      macdHistData.push({ 
        time: times[i + macdOffset], 
        value: v.histogram,
        color: v.histogram >= 0 ? 'rgba(0, 255, 65, 0.4)' : 'rgba(255, 7, 58, 0.4)'
      });
    });

    // Additional Meta Data
    const rsiDirection = rsi14.length > 2 ? 
      (rsi14[rsi14.length - 1] >= rsi14[rsi14.length - 2] ? 'Rising' : 'Falling') : 'Steady';
    
    const currentPrice = closes[closes.length - 1];
    const e21 = ema21[ema21.length-1];
    const e50 = ema50[ema50.length-1];
    let position = 'Between EMAs';
    if (currentPrice > e21 && currentPrice > e50) position = 'Above EMA21/50';
    if (currentPrice < e21 && currentPrice < e50) position = 'Below EMA21/50';

    // Zigzag Pivot Points (connect swing highs to swing lows)
    const zigzagData = [];
    const zigzagLookback = Math.min(ohlcv.length, 200);
    const zStart = ohlcv.length - zigzagLookback;
    for (let i = zStart + 2; i < ohlcv.length - 2; i++) {
      const h = ohlcv[i].high, prevH = ohlcv[i-1].high, prev2H = ohlcv[i-2].high;
      const nextH = ohlcv[i+1].high, next2H = ohlcv[i+2].high;
      const l = ohlcv[i].low, prevL = ohlcv[i-1].low, prev2L = ohlcv[i-2].low;
      const nextL = ohlcv[i+1].low, next2L = ohlcv[i+2].low;
      // 5-bar swing high
      if (h >= prevH && h >= prev2H && h >= nextH && h >= next2H) {
        zigzagData.push({ time: ohlcv[i].time, value: h, type: 'high' });
      }
      // 5-bar swing low
      if (l <= prevL && l <= prev2L && l <= nextL && l <= next2L) {
        zigzagData.push({ time: ohlcv[i].time, value: l, type: 'low' });
      }
    }
    // Sort by time and remove consecutive same-type duplicates
    zigzagData.sort((a, b) => a.time - b.time);
    const filteredZigzag = [];
    for (let i = 0; i < zigzagData.length; i++) {
      if (i === 0 || zigzagData[i].type !== zigzagData[i-1].type) {
        filteredZigzag.push(zigzagData[i]);
      } else {
        // Keep the more extreme value
        const last = filteredZigzag[filteredZigzag.length - 1];
        if (zigzagData[i].type === 'high' && zigzagData[i].value > last.value) {
          filteredZigzag[filteredZigzag.length - 1] = zigzagData[i];
        } else if (zigzagData[i].type === 'low' && zigzagData[i].value < last.value) {
          filteredZigzag[filteredZigzag.length - 1] = zigzagData[i];
        }
      }
    }
    const zigzagSeriesData = filteredZigzag.map(p => ({ time: p.time, value: p.value }));

    // Return the latest values
    return {
      price: currentPrice,
      volume: vols[vols.length - 1],
      smaVol20: smaVol20 && smaVol20.length ? smaVol20[smaVol20.length - 1] : 0,
      ema9: ema9 && ema9.length ? ema9[ema9.length - 1] : null,
      ema21: e21 || null,
      ema50: e50 || null,
      rsi: rsi14 && rsi14.length ? rsi14[rsi14.length - 1] : null,
      rsiDirection,
      rsiHistory: rsi14 ? rsi14.slice(-40) : [],
      closesHistory: closes.slice(-40),
      highsHistory: highs.slice(-40),
      lowsHistory: lows.slice(-40),
      opensHistory: ohlcv.map(o => o.open).slice(-40),
      macd: macd && macd.length ? macd[macd.length - 1] : null,
      bb: bb && bb.length ? bb[bb.length - 1] : null,
      atr: atr && atr.length ? atr[atr.length - 1] : null,
      position,
      ema21Data,
      ema50Data,
      bbUpperData,
      bbLowerData,
      bbMiddleData,
      macdHistData,
      zigzagData: zigzagSeriesData
    };
  }
};
