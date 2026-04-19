export const SignalEngine = {
  // === 1. Trend Detection Logic ===
  
  // H4 & H1: EMA Cross Logic
  evaluateTrendEMA(ind) {
    if (!ind || !ind.ema9 || !ind.ema21 || !ind.ema50) return 'SIDEWAYS';
    const c = ind.price;
    const e9 = ind.ema9;
    const e21 = ind.ema21;
    const e50 = ind.ema50;

    if (c > e21 && c > e50 && e9 > e21) return 'BULLISH';
    if (c < e21 && c < e50 && e9 < e21) return 'BEARISH';
    return 'SIDEWAYS';
  },

  // M15 & M5: Price Action Score Logic
  evaluateTrendPA(ind) {
    if (!ind || !ind.closesHistory || ind.closesHistory.length < 5) return { trend: 'SIDEWAYS', score: 0 };
    
    const h = ind.highsHistory;
    const l = ind.lowsHistory;
    const c = ind.closesHistory;
    const o = ind.opensHistory;
    const r = ind.rsi;
    const e9 = ind.ema9;

    let bearScore = 0;
    // 1. Min 2 of 3 candle bearish
    const last3Bear = [c[c.length-1] < o[o.length-1], c[c.length-2] < o[o.length-2], c[c.length-3] < o[o.length-3]].filter(x => x).length >= 2;
    if (last3Bear) bearScore++;
    // 2. Lower High
    if (h[h.length-1] < h[h.length-2] && h[h.length-2] < h[h.length-3]) bearScore++;
    // 3. Lower Low
    if (l[l.length-1] < l[l.length-2] && l[l.length-2] < l[l.length-3]) bearScore++;
    // 4. Close < EMA9
    if (c[c.length-1] < e9) bearScore++;
    // 5. RSI < 45
    if (r < 45) bearScore++;

    let bullScore = 0;
    // 1. Min 2 of 3 candle bullish
    const last3Bull = [c[c.length-1] > o[o.length-1], c[c.length-2] > o[o.length-2], c[c.length-3] > o[o.length-3]].filter(x => x).length >= 2;
    if (last3Bull) bullScore++;
    // 2. Higher High
    if (h[h.length-1] > h[h.length-2] && h[h.length-2] > h[h.length-3]) bullScore++;
    // 3. Higher Low
    if (l[l.length-1] > l[l.length-2] && l[l.length-2] > l[l.length-3]) bullScore++;
    // 4. Close > EMA9
    if (c[c.length-1] > e9) bullScore++;
    // 5. RSI > 55
    if (r > 55) bullScore++;

    if (bearScore >= 3) return { trend: 'BEARISH', score: bearScore };
    if (bullScore >= 3) return { trend: 'BULLISH', score: bullScore };
    return { trend: 'SIDEWAYS', score: Math.max(bearScore, bullScore) };
  },

  // Market Structure Detection (10 candles)
  checkMarketStructure(ind) {
    if (!ind || !ind.highsHistory || ind.highsHistory.length < 10) return 'NONE';
    const h = ind.highsHistory.slice(-10);
    const l = ind.lowsHistory.slice(-10);
    
    // Find swings (simplified)
    const hh = h[h.length-1] > h[h.length-2] && h[h.length-2] > h[h.length-3];
    const hl = l[l.length-1] > l[l.length-2] && l[l.length-2] > l[l.length-3];
    const lh = h[h.length-1] < h[h.length-2] && h[h.length-2] < h[h.length-3];
    const ll = l[l.length-1] < l[l.length-2] && l[l.length-2] < l[l.length-3];

    if (hh && hl) return 'UPTREND (HH+HL)';
    if (lh && ll) return 'DOWNTREND (LH+LL)';
    return 'CHOPPY';
  },

  // Confidence Calculation Logic
  calculateConfidence(h4Trend, h1Trend, m15Data, m5Data, h1Structure, rsiH1) {
    let conf = 0;
    
    // 1. Trend Filter H4/H1 (40%)
    if (h1Trend !== 'SIDEWAYS') conf += 20;
    if (h4Trend !== 'SIDEWAYS' && h4Trend === h1Trend) conf += 20;

    // 2. PA Score M15/M5 (30%)
    if (m15Data.score >= 3) conf += (m15Data.score * 3); // Max 15%
    if (m5Data.score >= 3) conf += (m5Data.score * 3);   // Max 15%

    // 3. Structure Valid (20%)
    if (h1Structure.includes('HH') || h1Structure.includes('LH')) conf += 20;

    // 4. RSI Condition (10%)
    if (h1Trend === 'BULLISH' && rsiH1 > 50 && rsiH1 < 70) conf += 10;
    if (h1Trend === 'BEARISH' && rsiH1 < 50 && rsiH1 > 30) conf += 10;

    return Math.min(100, conf);
  },

  // === 2. Main Signal Engine ===
  
  calculateSignal(indicatorsMap) {
    const indH4 = indicatorsMap['H4'];
    const indH1 = indicatorsMap['H1'];
    const indM15 = indicatorsMap['M15'];
    const indM5 = indicatorsMap['M5'];

    if (!indH4 || !indH1 || !indM15 || !indM5) return { signal: 'WAIT', reasonings: ['Menunggu Sinkronisasi Data...'] };

    // Trends & Scores
    const h4Trend = this.evaluateTrendEMA(indH4);
    const h1Trend = this.evaluateTrendEMA(indH1);
    const m15Data = this.evaluateTrendPA(indM15);
    const m5Data = this.evaluateTrendPA(indM5);
    const h1Structure = this.checkMarketStructure(indH1);

    const atrH4 = indH4.atr;
    let finalSignal = 'WAIT';
    let entry = 0, sl = 0, tp = [0,0,0], rr = 0, orderType = 'LIMIT';
    let reqs = [];

    // --- Potential Entry Analysis (Prep Mode) ---
    const resistanceM15 = Math.max(...indM15.highsHistory.slice(-20));
    const supportM15 = Math.min(...indM15.lowsHistory.slice(-20));
    const potentialEntry = (h1Trend === 'BEARISH' || h1Trend === 'SIDEWAYS') ? resistanceM15 : supportM15;

    // Confidence Calculation
    const confidence = this.calculateConfidence(h4Trend, h1Trend, m15Data, m5Data, h1Structure, indH1.rsi);

    // --- SELL RULES ---
    const sellValid = (h4Trend !== 'BULLISH') && 
                      (h1Trend === 'BEARISH') && 
                      (m15Data.trend === 'BEARISH') && 
                      (m5Data.trend === 'BEARISH') && 
                      (h1Structure.includes('LH+LL')) && 
                      (indH1.rsi < 50);

    // --- BUY RULES ---
    const buyValid = (h4Trend !== 'BEARISH') && 
                     (h1Trend === 'BULLISH') && 
                     (m15Data.trend === 'BULLISH') && 
                     (m5Data.trend === 'BULLISH') && 
                     (h1Structure.includes('HH+HL')) && 
                     (indH1.rsi > 50);

    if (sellValid) {
      if (indH1.rsi < 30) {
        reqs.push('WAIT: RSI H1 Oversold (<30). Menanti pullback > 35.');
      } else {
        finalSignal = 'SELL';
        entry = resistanceM15;
        sl = entry + (atrH4 * 1.5);
        tp[0] = entry - (atrH4 * 1.5);
        tp[1] = entry - (atrH4 * 3.0);
        tp[2] = entry - (atrH4 * 4.5);
        rr = (entry - tp[1]) / (sl - entry);
      }
    } else if (buyValid) {
      if (indH1.rsi > 70) {
        reqs.push('WAIT: RSI H1 Overbought (>70). Menanti koreksi < 65.');
      } else {
        finalSignal = 'BUY';
        entry = supportM15;
        sl = entry - (atrH4 * 1.5);
        tp[0] = entry + (atrH4 * 1.5);
        tp[1] = entry + (atrH4 * 3.0);
        tp[2] = entry + (atrH4 * 4.5);
        rr = (tp[1] - entry) / (entry - sl);
      }
    } else {
      // Explain why WAIT
      if (h1Trend !== (sellValid ? 'BEARISH' : 'BULLISH')) reqs.push(`Confirm H1 Trend ${h1Trend || '...'}`);
      if (m15Data.trend === 'SIDEWAYS') reqs.push('M15 PA: Masih Sideways / No Momentum');
      if (!h1Structure.includes('HH') && !h1Structure.includes('LH')) reqs.push('Market Structure Belum Valid');
    }

    // Final Order Type & RR Check
    if (finalSignal !== 'WAIT' && rr < 1.5) {
      finalSignal = 'WAIT';
      reqs.push(`WAIT: Risk/Reward (${rr.toFixed(1)}) terlalu rendah.`);
    }

    if (finalSignal !== 'WAIT') {
      const dist = Math.abs(indM5.price - entry);
      orderType = dist > (atrH4 * 0.5) ? 'LIMIT' : 'STOP';
      reqs.push(`${finalSignal} Rule Set Confirmed`);
    }

    return { 
      signal: finalSignal, 
      orderType: finalSignal !== 'WAIT' ? `${finalSignal} ${orderType}` : 'WAIT (PREP MODE)',
      entry: finalSignal !== 'WAIT' ? entry : potentialEntry, // Always show something!
      sl, 
      tp1: tp[0], tp2: tp[1], tp3: tp[2],
      rr: rr.toFixed(2),
      confidence,
      isPrep: finalSignal === 'WAIT',
      reasonings: reqs,
      trends: { 
        H4: { trend: h4Trend, rsi: indH4.rsi }, 
        H1: { trend: h1Trend, rsi: indH1.rsi, structure: h1Structure }, 
        M15: { trend: m15Data.trend, score: m15Data.score }, 
        M5: { trend: m5Data.trend, score: m5Data.score }
      } 
    };
  }
};
