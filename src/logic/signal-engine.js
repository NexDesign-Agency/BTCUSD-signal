export const SignalEngine = {

  // === LAYER 1: H1 Primary Bias (Dominant Trend) ===
  evaluateTrendEMA(ind) {
    if (!ind || !ind.ema9 || !ind.ema21 || !ind.ema50) return 'SIDEWAYS';
    const c = ind.price, e9 = ind.ema9, e21 = ind.ema21, e50 = ind.ema50;
    if (c > e21 && c > e50 && e9 > e21) return 'BULLISH';
    if (c < e21 && c < e50 && e9 < e21) return 'BEARISH';
    return 'SIDEWAYS';
  },

  // === LAYER 2: M15/M5 Price Action Score ===
  evaluateTrendPA(ind) {
    if (!ind || !ind.closesHistory || ind.closesHistory.length < 5) return { trend: 'SIDEWAYS', score: 0 };
    const h = ind.highsHistory, l = ind.lowsHistory, c = ind.closesHistory;
    const o = ind.opensHistory, r = ind.rsi, e9 = ind.ema9;

    let bearScore = 0;
    if ([c[c.length-1] < o[o.length-1], c[c.length-2] < o[o.length-2], c[c.length-3] < o[o.length-3]].filter(x => x).length >= 2) bearScore++;
    if (h[h.length-1] < h[h.length-2] && h[h.length-2] < h[h.length-3]) bearScore++;
    if (l[l.length-1] < l[l.length-2] && l[l.length-2] < l[l.length-3]) bearScore++;
    if (c[c.length-1] < e9) bearScore++;
    if (r < 45) bearScore++;

    let bullScore = 0;
    if ([c[c.length-1] > o[o.length-1], c[c.length-2] > o[o.length-2], c[c.length-3] > o[o.length-3]].filter(x => x).length >= 2) bullScore++;
    if (h[h.length-1] > h[h.length-2] && h[h.length-2] > h[h.length-3]) bullScore++;
    if (l[l.length-1] > l[l.length-2] && l[l.length-2] > l[l.length-3]) bullScore++;
    if (c[c.length-1] > e9) bullScore++;
    if (r > 55) bullScore++;

    if (bearScore >= 3) return { trend: 'BEARISH', score: bearScore };
    if (bullScore >= 3) return { trend: 'BULLISH', score: bullScore };
    return { trend: 'SIDEWAYS', score: Math.max(bearScore, bullScore) };
  },

  // === LAYER 3: H1 Market Structure (Smart Swing Pivot) ===
  checkMarketStructure(ind) {
    if (!ind || !ind.highsHistory || ind.highsHistory.length < 10) return 'NONE';
    const h = ind.highsHistory.slice(-20), l = ind.lowsHistory.slice(-20);
    const swingHighs = [], swingLows = [];
    for (let i = 1; i < h.length - 1; i++) {
      if (h[i] > h[i-1] && h[i] > h[i+1]) swingHighs.push(h[i]);
      if (l[i] < l[i-1] && l[i] < l[i+1]) swingLows.push(l[i]);
    }
    if (swingHighs.length >= 2 && swingLows.length >= 2) {
      const lastSH = swingHighs[swingHighs.length-1], prevSH = swingHighs[swingHighs.length-2];
      const lastSL = swingLows[swingLows.length-1], prevSL = swingLows[swingLows.length-2];
      const hh = lastSH > prevSH, hl = lastSL > prevSL;
      const lh = lastSH < prevSH, ll = lastSL < prevSL;
      if (hh && hl) return 'UPTREND (HH+HL)';
      if (lh && ll) return 'DOWNTREND (LH+LL)';
      if (hh && ll) return 'EXPANSION';
      if (lh && hl) return 'CONTRACTION';
    }
    const mid = Math.floor(h.length / 2);
    const highsUp = Math.max(...h.slice(mid)) > Math.max(...h.slice(0, mid));
    const lowsUp = Math.min(...l.slice(mid)) > Math.min(...l.slice(0, mid));
    if (highsUp && lowsUp) return 'UPTREND (HH+HL)';
    if (!highsUp && !lowsUp) return 'DOWNTREND (LH+LL)';
    return 'CHOPPY';
  },

  // === LAYER 4: Nearest Swing Pivot (for entry zone accuracy) ===
  findNearestPivots(highs, lows, currentPrice, lookback = 25) {
    const h = highs.slice(-lookback), l = lows.slice(-lookback);
    const swingHighs = [], swingLows = [];
    for (let i = 1; i < h.length - 1; i++) {
      if (h[i] > h[i-1] && h[i] > h[i+1]) swingHighs.push(h[i]);
      if (l[i] < l[i-1] && l[i] < l[i+1]) swingLows.push(l[i]);
    }
    if (swingHighs.length === 0) swingHighs.push(Math.max(...h));
    if (swingLows.length === 0) swingLows.push(Math.min(...l));

    const resistances = swingHighs.filter(p => p > currentPrice).sort((a, b) => a - b);
    const supports = swingLows.filter(p => p < currentPrice).sort((a, b) => b - a);
    return {
      nearestResistance: resistances.length > 0 ? resistances[0] : Math.max(...swingHighs),
      nearestSupport: supports.length > 0 ? supports[0] : Math.min(...swingLows)
    };
  },

  // === CORE: Setup Type Resolver ===
  // Menentukan JENIS setup berdasarkan kombinasi H1+M15
  resolveSetupType(h1Trend, m15Trend, m5Trend, rsiM5) {
    // === BIAS SELL ===
    if (h1Trend === 'BEARISH') {
      // Case 1: Full Momentum — semua TF sejalan bearish
      if (m15Trend === 'BEARISH' && m5Trend === 'BEARISH') {
        return { bias: 'SELL', setupType: 'MOMENTUM', strength: 'STRONG', note: 'H1+M15+M5 semua Bearish. Masuk sekarang atau tunggu koreksi kecil.' };
      }
      // Case 2: Retest — M15/M5 bounce ke atas (dead cat / retest resistance)
      if (m15Trend === 'BULLISH' || m5Trend === 'BULLISH') {
        const isM5Overbought = rsiM5 >= 65;
        return {
          bias: 'SELL', setupType: 'RETEST',
          strength: isM5Overbought ? 'HIGH' : 'MEDIUM',
          note: `H1 Bearish dominan. M15/M5 bounce ke atas = RETEST RESISTANCE sebelum lanjut turun. ${isM5Overbought ? 'RSI M5 overbought — konfirmasi rejection candle!' : 'Tunggu M5 mulai berbalik bearish.'}`
        };
      }
      // Case 3: H1 Bearish, M15 Sideways — menunggu momentum konfirmasi
      return { bias: 'SELL', setupType: 'FORMING', strength: 'LOW', note: 'H1 Bearish tapi M15 belum konfirmasi. Tunggu momentum terbentuk di M15.' };
    }

    // === BIAS BUY ===
    if (h1Trend === 'BULLISH') {
      if (m15Trend === 'BULLISH' && m5Trend === 'BULLISH') {
        return { bias: 'BUY', setupType: 'MOMENTUM', strength: 'STRONG', note: 'H1+M15+M5 semua Bullish. Masuk sekarang atau tunggu pullback kecil.' };
      }
      if (m15Trend === 'BEARISH' || m5Trend === 'BEARISH') {
        const isM5Oversold = rsiM5 <= 35;
        return {
          bias: 'BUY', setupType: 'PULLBACK',
          strength: isM5Oversold ? 'HIGH' : 'MEDIUM',
          note: `H1 Bullish dominan. M15/M5 koreksi ke bawah = PULLBACK KE SUPPORT. ${isM5Oversold ? 'RSI M5 oversold — antisipasi reversal candle!' : 'Tunggu M5 mulai berbalik bullish.'}`
        };
      }
      return { bias: 'BUY', setupType: 'FORMING', strength: 'LOW', note: 'H1 Bullish tapi M15 belum konfirmasi. Tunggu momentum terbentuk di M15.' };
    }

    // === NO CLEAR BIAS ===
    return { bias: 'NEUTRAL', setupType: 'WAIT', strength: 'NONE', note: 'H1 belum menunjukkan arah jelas. Tunggu konfirmasi tren utama.' };
  },

  // === ENTRY OPTION GENERATOR (Primary + Alternative) ===
  buildEntryOptions(setup, atrH4, currentPrice, pivotM15, pivotM5, h4Trend) {
    const { bias, setupType, strength, note } = setup;

    // === PRIMARY OPTION (sesuai bias utama) ===
    let primary = null;
    if (bias === 'SELL') {
      const entryZoneHigh = setupType === 'RETEST'
        ? pivotM15.nearestResistance             // Tunggu price naik ke resistance dulu
        : Math.min(currentPrice + atrH4 * 0.3, pivotM15.nearestResistance); // Momentum: entry lebih dekat
      const entryZoneLow = entryZoneHigh - atrH4 * 0.15;
      const sl = entryZoneHigh + atrH4 * (setupType === 'RETEST' ? 0.8 : 1.2);
      const tp1 = entryZoneHigh - atrH4 * 1.5;
      const tp2 = entryZoneHigh - atrH4 * 3.0;
      const rr = (atrH4 * 3.0 / (sl - entryZoneHigh)).toFixed(2);
      const instruction = setupType === 'RETEST'
        ? `Tunggu harga naik ke zona $${entryZoneLow.toFixed(0)}–$${entryZoneHigh.toFixed(0)} lalu cari rejection candle (bearish engulfing/pin bar) di M5 sebelum entry.`
        : `Momentum bearish aktif. Set SELL LIMIT di $${entryZoneHigh.toFixed(0)} atau entry market jika candle M5 konfirmasi.`;
      primary = { id: 'SELL', style: 'PRIMARY', label: `SELL — ${setupType === 'RETEST' ? 'Retest Resistance' : 'Momentum Bearish'}`,
        entryLow: entryZoneLow, entryHigh: entryZoneHigh, sl, tp1, tp2, rr, strength,
        note, instruction, isActive: true };

    } else if (bias === 'BUY') {
      const entryZoneLow = setupType === 'PULLBACK'
        ? pivotM15.nearestSupport
        : Math.max(currentPrice - atrH4 * 0.3, pivotM15.nearestSupport);
      const entryZoneHigh = entryZoneLow + atrH4 * 0.15;
      const sl = entryZoneLow - atrH4 * (setupType === 'PULLBACK' ? 0.8 : 1.2);
      const tp1 = entryZoneLow + atrH4 * 1.5;
      const tp2 = entryZoneLow + atrH4 * 3.0;
      const rr = (atrH4 * 3.0 / (entryZoneLow - sl)).toFixed(2);
      const instruction = setupType === 'PULLBACK'
        ? `Tunggu harga turun ke zona $${entryZoneLow.toFixed(0)}–$${entryZoneHigh.toFixed(0)} lalu cari reversal candle (bullish engulfing/hammer) di M5 sebelum entry.`
        : `Momentum bullish aktif. Set BUY LIMIT di $${entryZoneLow.toFixed(0)} atau entry market jika candle M5 konfirmasi.`;
      primary = { id: 'BUY', style: 'PRIMARY', label: `BUY — ${setupType === 'PULLBACK' ? 'Pullback ke Support' : 'Momentum Bullish'}`,
        entryLow: entryZoneLow, entryHigh: entryZoneHigh, sl, tp1, tp2, rr, strength,
        note, instruction, isActive: true };
    }

    // === ALTERNATIVE OPTION (skenario sebaliknya, lower priority) ===
    let alternative = null;
    if (bias === 'SELL' || bias === 'NEUTRAL') {
      // Alt: BUY jika breakout resistance
      const breakoutLevel = pivotM15.nearestResistance;
      const altSl = breakoutLevel - atrH4 * 0.8;
      const altTp1 = breakoutLevel + atrH4 * 1.5, altTp2 = breakoutLevel + atrH4 * 3.0;
      alternative = { id: 'BUY', style: 'ALTERNATIVE', label: 'BUY — Skenario Alternatif (Breakout)',
        entryLow: breakoutLevel, entryHigh: breakoutLevel + atrH4 * 0.15, sl: altSl, tp1: altTp1, tp2: altTp2,
        rr: (atrH4 * 3.0 / (breakoutLevel - altSl)).toFixed(2), strength: 'CONDITIONAL',
        note: `Hanya aktif jika harga break & close di atas $${breakoutLevel.toFixed(0)} di timeframe H1 dengan volume kuat. Abaikan jika bias SELL masih dominan.`,
        instruction: `Set BUY STOP di $${(breakoutLevel + 50).toFixed(0)} dengan SL $${altSl.toFixed(0)}.`,
        isActive: false };
    } else {
      // Alt: SELL jika breakdown support
      const breakdownLevel = pivotM15.nearestSupport;
      const altSl = breakdownLevel + atrH4 * 0.8;
      const altTp1 = breakdownLevel - atrH4 * 1.5, altTp2 = breakdownLevel - atrH4 * 3.0;
      alternative = { id: 'SELL', style: 'ALTERNATIVE', label: 'SELL — Skenario Alternatif (Breakdown)',
        entryLow: breakdownLevel - atrH4 * 0.15, entryHigh: breakdownLevel, sl: altSl, tp1: altTp1, tp2: altTp2,
        rr: (atrH4 * 3.0 / (altSl - breakdownLevel)).toFixed(2), strength: 'CONDITIONAL',
        note: `Hanya aktif jika harga break & close di bawah $${breakdownLevel.toFixed(0)} dengan volume kuat. Konfirmasi M5 bearish sebelum entry.`,
        instruction: `Set SELL STOP di $${(breakdownLevel - 50).toFixed(0)} dengan SL $${altSl.toFixed(0)}.`,
        isActive: false };
    }

    return [primary, alternative].filter(Boolean);
  },

  // === CONFIDENCE SCORE ===
  calculateConfidence(h4Trend, h1Trend, m15Data, m5Data, h1Structure, rsiH1, setupStrength) {
    let conf = 0;
    if (h1Trend !== 'SIDEWAYS') conf += 25;
    if (h4Trend !== 'SIDEWAYS' && h4Trend === h1Trend) conf += 20;
    if (m15Data.score >= 3) conf += m15Data.score * 3;
    if (h1Structure.includes('UPTREND') || h1Structure.includes('DOWNTREND')) conf += 15;
    if (setupStrength === 'STRONG') conf += 15;
    else if (setupStrength === 'HIGH') conf += 10;
    else if (setupStrength === 'MEDIUM') conf += 5;
    if (h1Trend === 'BULLISH' && rsiH1 > 50 && rsiH1 < 70) conf += 5;
    if (h1Trend === 'BEARISH' && rsiH1 < 50 && rsiH1 > 30) conf += 5;
    return Math.min(100, conf);
  },

  // === MAIN ENGINE ===
  calculateSignal(indicatorsMap) {
    const indH4 = indicatorsMap['H4'];
    const indH1 = indicatorsMap['H1'];
    const indM15 = indicatorsMap['M15'];
    const indM5 = indicatorsMap['M5'];

    if (!indH4 || !indH1 || !indM15 || !indM5) {
      return { signal: 'WAIT', orderType: 'LOADING', confidence: 0, reasonings: ['Menunggu Sinkronisasi Data...'], entryOptions: [], trends: {} };
    }

    const h4Trend = this.evaluateTrendEMA(indH4);
    const h1Trend = this.evaluateTrendEMA(indH1);
    const m15Data = this.evaluateTrendPA(indM15);
    const m5Data = this.evaluateTrendPA(indM5);
    const h1Structure = this.checkMarketStructure(indH1);
    const atrH4 = indH4.atr;
    const currentPrice = indM5.price;

    // Nearest pivots for entry zone
    const pivotM15 = this.findNearestPivots(indM15.highsHistory, indM15.lowsHistory, currentPrice, 30);
    const pivotM5 = this.findNearestPivots(indM5.highsHistory, indM5.lowsHistory, currentPrice, 15);

    // Resolve setup type based on H1 bias + M15 context
    const setup = this.resolveSetupType(h1Trend, m15Data.trend, m5Data.trend, indM5.rsi);
    const confidence = this.calculateConfidence(h4Trend, h1Trend, m15Data, m5Data, h1Structure, indH1.rsi, setup.strength);

    // Generate entry options
    const entryOptions = this.buildEntryOptions(setup, atrH4, currentPrice, pivotM15, pivotM5, h4Trend);

    // Determine final signal
    let finalSignal = 'WAIT';
    if (setup.bias === 'SELL' && setup.strength !== 'NONE') finalSignal = 'SELL';
    else if (setup.bias === 'BUY' && setup.strength !== 'NONE') finalSignal = 'BUY';

    // Build reasoning messages
    const reqs = [];
    reqs.push(`Bias H1: ${h1Trend} | Struktur: ${h1Structure}`);
    reqs.push(`M15: ${m15Data.trend} (${m15Data.score}/5) | M5: ${m5Data.trend} (${m5Data.score}/5)`);
    reqs.push(`Setup: ${setup.setupType} — ${setup.strength}`);
    if (h4Trend !== 'SIDEWAYS' && h4Trend !== h1Trend) {
      reqs.push(`INFO: H4 (${h4Trend}) berbeda dari H1 — pertimbangkan lot lebih kecil.`);
    }
    if (setup.strength === 'LOW' || setup.strength === 'NONE') {
      reqs.push(`WAIT: ${setup.note}`);
    }

    return {
      signal: finalSignal,
      orderType: setup.setupType === 'WAIT' ? 'PREP MODE' : (setup.setupType === 'FORMING' ? 'FORMING...' : `${setup.bias} ${setup.setupType}`),
      confidence,
      isPrep: finalSignal === 'WAIT',
      setup,
      reasonings: reqs,
      entryOptions,
      trends: {
        H4: { trend: h4Trend, rsi: indH4.rsi },
        H1: { trend: h1Trend, rsi: indH1.rsi, structure: h1Structure },
        M15: { trend: m15Data.trend, score: m15Data.score },
        M5: { trend: m5Data.trend, score: m5Data.score }
      }
    };
  }
};
