// ============================================================================
// BTC Signal Engine v2 — Zone-Based Entry + Hedge Detection
// Philosophy: "Signal at the Zone, Not at the Trend"
// Signal ONLY fires when price is at S/R zone + candle confirmation
// ============================================================================

export const SignalEngine = {

  // =========================================================================
  // LAYER 1: H4/H1 Directional Bias (EMA Alignment)
  // Determines dominant market direction — NOT used to fire signals alone
  // =========================================================================
  evaluateTrendEMA(ind) {
    if (!ind || !ind.ema9 || !ind.ema21 || !ind.ema50) return 'SIDEWAYS';
    const c = ind.price, e9 = ind.ema9, e21 = ind.ema21, e50 = ind.ema50;

    // Strict: ALL three conditions must align
    if (c > e21 && c > e50 && e9 > e21 && e21 > e50) return 'BULLISH';
    if (c < e21 && c < e50 && e9 < e21 && e21 < e50) return 'BEARISH';

    // Weak trend — not enough for a signal
    if (c > e21 && e9 > e21) return 'LEAN_BULL';
    if (c < e21 && e9 < e21) return 'LEAN_BEAR';

    return 'SIDEWAYS';
  },

  // =========================================================================
  // LAYER 2: S/R Zone Map Builder
  // Builds strong S/R zones from multi-TF swing pivots with clustering
  // =========================================================================
  buildZoneMap(h4Ind, h1Ind, currentPrice, atr) {
    const zones = [];

    // Collect swing pivots from H4 (weight: 2) and H1 (weight: 1)
    const h4Pivots = this._extractSwingPivots(h4Ind.highsHistory, h4Ind.lowsHistory, 2);
    const h1Pivots = this._extractSwingPivots(h1Ind.highsHistory, h1Ind.lowsHistory, 1);
    const allPivots = [...h4Pivots, ...h1Pivots];

    if (allPivots.length === 0) return zones;

    // Sort by price
    allPivots.sort((a, b) => a.price - b.price);

    // Cluster pivots within 0.3×ATR into zones
    const clusterThreshold = atr * 0.3;
    let cluster = [allPivots[0]];

    for (let i = 1; i < allPivots.length; i++) {
      const avgPrice = cluster.reduce((s, p) => s + p.price, 0) / cluster.length;
      if (Math.abs(allPivots[i].price - avgPrice) <= clusterThreshold) {
        cluster.push(allPivots[i]);
      } else {
        zones.push(this._clusterToZone(cluster, atr));
        cluster = [allPivots[i]];
      }
    }
    zones.push(this._clusterToZone(cluster, atr));

    // Classify zones relative to current price
    zones.forEach(z => {
      z.type = z.price > currentPrice ? 'RESISTANCE' : 'SUPPORT';
      z.distance = Math.abs(z.price - currentPrice);
      z.distanceATR = z.distance / atr;
    });

    // Sort: nearest zones first
    zones.sort((a, b) => a.distance - b.distance);

    return zones;
  },

  _extractSwingPivots(highs, lows, weight) {
    const pivots = [];
    if (!highs || !lows || highs.length < 5) return pivots;
    const h = highs.slice(-35);
    const l = lows.slice(-35);

    for (let i = 2; i < h.length - 2; i++) {
      // 5-bar swing high
      if (h[i] >= h[i-1] && h[i] >= h[i-2] && h[i] >= h[i+1] && h[i] >= h[i+2]) {
        pivots.push({ price: h[i], type: 'high', weight, recency: i / h.length });
      }
      // 5-bar swing low
      if (l[i] <= l[i-1] && l[i] <= l[i-2] && l[i] <= l[i+1] && l[i] <= l[i+2]) {
        pivots.push({ price: l[i], type: 'low', weight, recency: i / l.length });
      }
    }
    return pivots;
  },

  _clusterToZone(cluster, atr) {
    const avgPrice = cluster.reduce((s, p) => s + p.price, 0) / cluster.length;
    const totalWeight = cluster.reduce((s, p) => s + p.weight, 0);
    const avgRecency = cluster.reduce((s, p) => s + p.recency, 0) / cluster.length;

    // Strength: more touches + more weight + more recent = stronger
    let strength = 'WEAK';
    const score = totalWeight + (avgRecency * 2);
    if (score >= 6) strength = 'STRONG';
    else if (score >= 3) strength = 'MODERATE';

    return {
      price: Math.round(avgPrice * 100) / 100,
      touches: cluster.length,
      totalWeight,
      recency: avgRecency,
      strength,
      zoneHigh: avgPrice + atr * 0.15,
      zoneLow: avgPrice - atr * 0.15,
    };
  },

  // =========================================================================
  // LAYER 3: Zone Proximity Check
  // Is price currently at, approaching, or far from a key zone?
  // =========================================================================
  checkZoneProximity(currentPrice, zones, atr) {
    if (zones.length === 0) return { status: 'NO_ZONE', zone: null, allZones: zones };

    // Find nearest support and resistance zones
    const supports = zones.filter(z => z.type === 'SUPPORT');
    const resistances = zones.filter(z => z.type === 'RESISTANCE');
    const nearestSupport = supports.length > 0 ? supports[0] : null;
    const nearestResistance = resistances.length > 0 ? resistances[0] : null;

    // Check if price is AT a zone (within zone boundaries)
    for (const z of zones) {
      if (currentPrice >= z.zoneLow && currentPrice <= z.zoneHigh) {
        return { status: 'AT_ZONE', zone: z, nearestSupport, nearestResistance, allZones: zones };
      }
    }

    // Check if price is APPROACHING a zone (within 0.5×ATR)
    for (const z of zones) {
      if (z.distanceATR <= 0.5) {
        return { status: 'APPROACHING', zone: z, nearestSupport, nearestResistance, allZones: zones };
      }
    }

    // Price is between zones — no actionable signal
    return { status: 'BETWEEN_ZONES', zone: null, nearestSupport, nearestResistance, allZones: zones };
  },

  // =========================================================================
  // LAYER 4: Candle Rejection Confirmation
  // Detect rejection patterns at zone (engulfing, pin bar, etc.)
  // =========================================================================
  detectRejectionPattern(candles, opensArr, zone) {
    if (!candles || candles.length < 3 || !opensArr || opensArr.length < 3) {
      return { confirmed: false, pattern: 'NONE', strength: 0 };
    }

    const len = candles.length;
    const c1 = candles[len - 1], o1 = opensArr[len - 1];
    const c2 = candles[len - 2], o2 = opensArr[len - 2];

    const body1 = Math.abs(c1 - o1);
    const body2 = Math.abs(c2 - o2);

    if (!zone) return { confirmed: false, pattern: 'NONE', strength: 0 };

    const isAtResistance = zone.type === 'RESISTANCE';
    const isAtSupport = zone.type === 'SUPPORT';

    // --- BEARISH REJECTION (at Resistance) ---
    if (isAtResistance) {
      // Bearish Engulfing: prev green, current red, current body > prev body
      if (c2 > o2 && c1 < o1 && body1 > body2 * 0.8) {
        return { confirmed: true, pattern: 'BEARISH_ENGULFING', strength: 3 };
      }
      // Shooting Star / Pin Bar: long upper wick, small body at bottom
      if (c1 < o1) {
        const upperWick = Math.max(c1, o1); // This needs high data, approximate
        // If last candle is bearish and follows a green candle at resistance
        if (c2 > o2 && body1 > 0) {
          return { confirmed: true, pattern: 'BEARISH_REJECTION', strength: 2 };
        }
      }
      // Two consecutive bearish closes at resistance
      if (c1 < o1 && c2 < o2 && c1 < c2) {
        return { confirmed: true, pattern: 'BEARISH_PRESSURE', strength: 2 };
      }
    }

    // --- BULLISH REJECTION (at Support) ---
    if (isAtSupport) {
      // Bullish Engulfing: prev red, current green, current body > prev body
      if (c2 < o2 && c1 > o1 && body1 > body2 * 0.8) {
        return { confirmed: true, pattern: 'BULLISH_ENGULFING', strength: 3 };
      }
      // Hammer: prev red, current green at support
      if (c2 < o2 && c1 > o1) {
        return { confirmed: true, pattern: 'BULLISH_REJECTION', strength: 2 };
      }
      // Two consecutive bullish closes at support
      if (c1 > o1 && c2 > o2 && c1 > c2) {
        return { confirmed: true, pattern: 'BULLISH_PRESSURE', strength: 2 };
      }
    }

    return { confirmed: false, pattern: 'NONE', strength: 0 };
  },

  // =========================================================================
  // LAYER 5: Breakout / Hedge Detection
  // Detects when S/R zone is broken — triggers HEDGE/FLIP warning
  // Uses H1 CLOSE for confirmation (wick-only = false breakout)
  // =========================================================================
  detectBreakout(h1Ind, nearestSupport, nearestResistance, atr) {
    if (!h1Ind || !h1Ind.closesHistory || h1Ind.closesHistory.length < 3) {
      return { type: 'NONE', level: null, direction: null };
    }

    const closes = h1Ind.closesHistory;
    const latestClose = closes[closes.length - 1];
    const prevClose = closes[closes.length - 2];
    const confirmMargin = atr * 0.2; // Must close beyond zone + margin

    // BREAKDOWN: H1 closes below support with margin
    if (nearestSupport) {
      const breakLevel = nearestSupport.zoneLow - confirmMargin;
      if (latestClose < breakLevel && prevClose >= nearestSupport.zoneLow) {
        return {
          type: 'BREAKDOWN',
          level: nearestSupport.price,
          direction: 'SELL',
          message: `⚠️ SUPPORT $${nearestSupport.price.toFixed(0)} TEMBUS! H1 close di $${latestClose.toFixed(0)}. Pertimbangkan HEDGE → SELL.`
        };
      }
      // Confirmed breakdown (already below for 2+ candles)
      if (latestClose < breakLevel && prevClose < breakLevel) {
        return {
          type: 'BREAKDOWN_CONFIRMED',
          level: nearestSupport.price,
          direction: 'SELL',
          message: `🔴 BREAKDOWN CONFIRMED di $${nearestSupport.price.toFixed(0)}. Bias berubah ke SELL. Close BUY jika masih open.`
        };
      }
    }

    // BREAKOUT: H1 closes above resistance with margin
    if (nearestResistance) {
      const breakLevel = nearestResistance.zoneHigh + confirmMargin;
      if (latestClose > breakLevel && prevClose <= nearestResistance.zoneHigh) {
        return {
          type: 'BREAKOUT',
          level: nearestResistance.price,
          direction: 'BUY',
          message: `⚠️ RESISTANCE $${nearestResistance.price.toFixed(0)} TEMBUS! H1 close di $${latestClose.toFixed(0)}. Pertimbangkan HEDGE → BUY.`
        };
      }
      if (latestClose > breakLevel && prevClose > breakLevel) {
        return {
          type: 'BREAKOUT_CONFIRMED',
          level: nearestResistance.price,
          direction: 'BUY',
          message: `🟢 BREAKOUT CONFIRMED di $${nearestResistance.price.toFixed(0)}. Bias berubah ke BUY. Close SELL jika masih open.`
        };
      }
    }

    return { type: 'NONE', level: null, direction: null };
  },

  // =========================================================================
  // LAYER 6: Market Structure (kept from v1)
  // =========================================================================
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
      if (lastSH > prevSH && lastSL > prevSL) return 'UPTREND (HH+HL)';
      if (lastSH < prevSH && lastSL < prevSL) return 'DOWNTREND (LH+LL)';
      if (lastSH > prevSH && lastSL < prevSL) return 'EXPANSION';
      if (lastSH < prevSH && lastSL > prevSL) return 'CONTRACTION';
    }
    return 'CHOPPY';
  },

  // =========================================================================
  // CONFIDENCE SCORING (Strict — minimum 60 to fire)
  // =========================================================================
  calculateConfidence(params) {
    const { h4Trend, h1Trend, zoneProximity, rejection, breakout, h1Structure, rsiH1, volumeRatio } = params;
    let conf = 0;
    const reasons = [];

    // Zone proximity (most important)
    if (zoneProximity.status === 'AT_ZONE') {
      conf += 25;
      reasons.push('+25 Price di zona S/R');
    } else if (zoneProximity.status === 'APPROACHING') {
      conf += 15;
      reasons.push('+15 Price mendekati zona S/R');
    }

    // H4 + H1 trend alignment
    const h4Base = h4Trend.replace('LEAN_', '');
    const h1Base = h1Trend.replace('LEAN_', '');
    if (h4Base === h1Base && h1Base !== 'SIDEWAYS') {
      conf += 20;
      reasons.push('+20 H4+H1 trend aligned');
    } else if (h1Base !== 'SIDEWAYS') {
      conf += 10;
      reasons.push('+10 H1 trend detected');
    }

    // Candle rejection confirmation
    if (rejection.confirmed) {
      conf += rejection.strength >= 3 ? 20 : 15;
      reasons.push(`+${rejection.strength >= 3 ? 20 : 15} Candle rejection: ${rejection.pattern}`);
    }

    // Market structure
    if (h1Structure.includes('UPTREND') || h1Structure.includes('DOWNTREND')) {
      conf += 15;
      reasons.push('+15 Market structure clear');
    }

    // RSI confluence
    const zone = zoneProximity.zone;
    if (zone) {
      if (zone.type === 'RESISTANCE' && rsiH1 > 60) {
        conf += 10;
        reasons.push('+10 RSI overbought at resistance');
      }
      if (zone.type === 'SUPPORT' && rsiH1 < 40) {
        conf += 10;
        reasons.push('+10 RSI oversold at support');
      }
    }

    // Volume spike
    if (volumeRatio > 1.5) {
      conf += 10;
      reasons.push('+10 Volume spike (>1.5× avg)');
    }

    // Breakout/hedge boost
    if (breakout.type === 'BREAKDOWN_CONFIRMED' || breakout.type === 'BREAKOUT_CONFIRMED') {
      conf += 15;
      reasons.push('+15 Breakout/breakdown confirmed');
    }

    return { score: Math.min(100, conf), reasons };
  },

  // =========================================================================
  // ENTRY OPTIONS BUILDER (Zone-Aware)
  // =========================================================================
  buildEntryOptions(signal, zone, atr, currentPrice, breakout) {
    const entries = [];
    if (!zone && breakout.type === 'NONE') return entries;

    if (signal === 'SELL' && zone) {
      const entryHigh = zone.zoneHigh;
      const entryLow = zone.zoneLow;
      const sl = entryHigh + atr * 0.8;
      const tp1 = entryLow - atr * 1.5;
      const tp2 = entryLow - atr * 3.0;
      const risk = sl - entryHigh;
      const rr = risk > 0 ? ((atr * 3.0) / risk).toFixed(2) : '0';

      entries.push({
        id: 'SELL', style: 'PRIMARY',
        label: 'SELL — Rejection di Resistance',
        entryLow, entryHigh, sl, tp1, tp2, rr,
        strength: zone.strength,
        note: `SELL di zona resistance $${entryLow.toFixed(0)}–$${entryHigh.toFixed(0)}. Zona disentuh ${zone.touches}× (${zone.strength}).`,
        instruction: `Entry SELL di zona $${entryLow.toFixed(0)}–$${entryHigh.toFixed(0)} setelah rejection candle terkonfirmasi. SL di $${sl.toFixed(0)}.`,
        isActive: true
      });
    }

    if (signal === 'BUY' && zone) {
      const entryLow = zone.zoneLow;
      const entryHigh = zone.zoneHigh;
      const sl = entryLow - atr * 0.8;
      const tp1 = entryHigh + atr * 1.5;
      const tp2 = entryHigh + atr * 3.0;
      const risk = entryLow - sl;
      const rr = risk > 0 ? ((atr * 3.0) / risk).toFixed(2) : '0';

      entries.push({
        id: 'BUY', style: 'PRIMARY',
        label: 'BUY — Rejection di Support',
        entryLow, entryHigh, sl, tp1, tp2, rr,
        strength: zone.strength,
        note: `BUY di zona support $${entryLow.toFixed(0)}–$${entryHigh.toFixed(0)}. Zona disentuh ${zone.touches}× (${zone.strength}).`,
        instruction: `Entry BUY di zona $${entryLow.toFixed(0)}–$${entryHigh.toFixed(0)} setelah rejection candle terkonfirmasi. SL di $${sl.toFixed(0)}.`,
        isActive: true
      });
    }

    // HEDGE entry (when breakout detected)
    if (breakout.type !== 'NONE' && breakout.direction) {
      const hedgeDir = breakout.direction;
      const breakLevel = breakout.level;
      const hedgeSl = hedgeDir === 'BUY'
        ? breakLevel - atr * 0.5
        : breakLevel + atr * 0.5;
      const hedgeTp1 = hedgeDir === 'BUY'
        ? breakLevel + atr * 1.5
        : breakLevel - atr * 1.5;
      const hedgeTp2 = hedgeDir === 'BUY'
        ? breakLevel + atr * 3.0
        : breakLevel - atr * 3.0;

      entries.push({
        id: hedgeDir, style: 'HEDGE',
        label: `⚠️ HEDGE — ${breakout.type === 'BREAKDOWN' || breakout.type === 'BREAKDOWN_CONFIRMED' ? 'Breakdown' : 'Breakout'} ${hedgeDir}`,
        entryLow: hedgeDir === 'BUY' ? breakLevel : breakLevel - atr * 0.15,
        entryHigh: hedgeDir === 'BUY' ? breakLevel + atr * 0.15 : breakLevel,
        sl: hedgeSl, tp1: hedgeTp1, tp2: hedgeTp2,
        rr: ((atr * 3.0) / (atr * 0.5)).toFixed(2),
        strength: 'HEDGE',
        note: breakout.message,
        instruction: `HEDGE: ${hedgeDir === 'BUY' ? 'Close SELL, buka BUY' : 'Close BUY, buka SELL'} di $${breakLevel.toFixed(0)}. SL ketat $${hedgeSl.toFixed(0)}.`,
        isActive: true
      });
    }

    return entries;
  },

  // =========================================================================
  // MAIN ENGINE v2
  // =========================================================================
  calculateSignal(indicatorsMap) {
    const indH4 = indicatorsMap['H4'];
    const indH1 = indicatorsMap['H1'];
    const indM15 = indicatorsMap['M15'];
    const indM5 = indicatorsMap['M5'];

    if (!indH4 || !indH1 || !indM15 || !indM5) {
      return {
        signal: 'WAIT', orderType: 'LOADING', confidence: 0,
        reasonings: ['Menunggu Sinkronisasi Data...'],
        entryOptions: [], trends: {}, hedge: null
      };
    }

    const h4Trend = this.evaluateTrendEMA(indH4);
    const h1Trend = this.evaluateTrendEMA(indH1);
    const h1Structure = this.checkMarketStructure(indH1);
    const atrH4 = indH4.atr;
    const currentPrice = indM5.price;

    // --- STEP 1: Build S/R Zone Map ---
    const zones = this.buildZoneMap(indH4, indH1, currentPrice, atrH4);

    // --- STEP 2: Check Zone Proximity ---
    const zoneProximity = this.checkZoneProximity(currentPrice, zones, atrH4);

    // --- STEP 3: Check Candle Rejection at Zone ---
    const rejection = this.detectRejectionPattern(
      indM5.closesHistory, indM5.opensHistory, zoneProximity.zone
    );

    // --- STEP 4: Check Breakout/Hedge ---
    const breakout = this.detectBreakout(
      indH1,
      zoneProximity.nearestSupport,
      zoneProximity.nearestResistance,
      atrH4
    );

    // --- STEP 5: Calculate Confidence ---
    const volumeRatio = indM5.volume / (indM5.smaVol20 || 1);
    const { score: confidence, reasons: confReasons } = this.calculateConfidence({
      h4Trend, h1Trend, zoneProximity, rejection, breakout,
      h1Structure, rsiH1: indH1.rsi, volumeRatio
    });

    // --- STEP 6: Determine Signal ---
    let finalSignal = 'WAIT';
    let orderType = 'SCANNING';

    // HEDGE takes priority
    if (breakout.type !== 'NONE') {
      finalSignal = breakout.direction;
      orderType = `HEDGE → ${breakout.direction}`;
    }
    // Zone-based signal: must be AT or APPROACHING zone + have confirmation + confidence >= 60
    else if ((zoneProximity.status === 'AT_ZONE' || zoneProximity.status === 'APPROACHING') && confidence >= 60) {
      const zone = zoneProximity.zone;
      if (zone.type === 'RESISTANCE') {
        // At resistance: only SELL if trend supports or rejection confirmed
        const trendSupports = h1Trend === 'BEARISH' || h1Trend === 'LEAN_BEAR';
        if (rejection.confirmed || trendSupports) {
          finalSignal = 'SELL';
          orderType = rejection.confirmed ? `SELL REJECTION (${rejection.pattern})` : 'SELL AT RESISTANCE';
        }
      } else if (zone.type === 'SUPPORT') {
        const trendSupports = h1Trend === 'BULLISH' || h1Trend === 'LEAN_BULL';
        if (rejection.confirmed || trendSupports) {
          finalSignal = 'BUY';
          orderType = rejection.confirmed ? `BUY REJECTION (${rejection.pattern})` : 'BUY AT SUPPORT';
        }
      }
    }
    // APPROACHING but no confirmation yet
    else if (zoneProximity.status === 'APPROACHING') {
      orderType = `APPROACHING ${zoneProximity.zone.type}`;
    }
    // Between zones
    else if (zoneProximity.status === 'BETWEEN_ZONES') {
      orderType = 'BETWEEN ZONES';
    }

    // If signal fired but confidence < 60, downgrade to WAIT
    if (finalSignal !== 'WAIT' && confidence < 60 && breakout.type === 'NONE') {
      finalSignal = 'WAIT';
      orderType = `PREP (${confidence}% < 60% min)`;
    }

    // --- Build Entry Options ---
    const entryOptions = this.buildEntryOptions(
      finalSignal, zoneProximity.zone, atrH4, currentPrice, breakout
    );

    // --- Build Reasoning ---
    const reasonings = [];
    reasonings.push(`Bias: H4 ${h4Trend} | H1 ${h1Trend} | Struktur: ${h1Structure}`);

    if (zoneProximity.zone) {
      reasonings.push(`Zone: ${zoneProximity.status} — ${zoneProximity.zone.type} $${zoneProximity.zone.price.toFixed(0)} (${zoneProximity.zone.strength}, ${zoneProximity.zone.touches} touches)`);
    } else {
      reasonings.push('Zone: No nearby S/R zone — TIDAK ADA zona entry yang valid');
    }

    if (rejection.confirmed) {
      reasonings.push(`✅ Rejection: ${rejection.pattern} (strength ${rejection.strength}/3)`);
    } else if (zoneProximity.status === 'AT_ZONE') {
      reasonings.push('⏳ Waiting for rejection candle confirmation...');
    }

    if (breakout.type !== 'NONE') {
      reasonings.push(`🔄 ${breakout.message}`);
    }

    // Confidence breakdown
    confReasons.forEach(r => reasonings.push(r));

    // Build pivot data for chart S/R lines
    const pivots = {
      support: zoneProximity.nearestSupport ? zoneProximity.nearestSupport.price : null,
      resistance: zoneProximity.nearestResistance ? zoneProximity.nearestResistance.price : null
    };

    return {
      signal: finalSignal,
      orderType,
      confidence,
      isPrep: finalSignal === 'WAIT',
      setup: {
        bias: finalSignal !== 'WAIT' ? finalSignal : (h1Trend.includes('BULL') ? 'BUY' : (h1Trend.includes('BEAR') ? 'SELL' : 'NEUTRAL')),
        setupType: orderType,
        strength: confidence >= 80 ? 'STRONG' : (confidence >= 60 ? 'MODERATE' : 'LOW')
      },
      reasonings,
      entryOptions,
      pivots,
      hedge: breakout.type !== 'NONE' ? breakout : null,
      zoneProximity,
      zones: zones.slice(0, 6), // Top 6 nearest zones for UI
      trends: {
        H4: { trend: h4Trend, rsi: indH4.rsi },
        H1: { trend: h1Trend, rsi: indH1.rsi, structure: h1Structure },
        M15: { trend: this.evaluateTrendEMA(indM15), score: 0 },
        M5: { trend: this.evaluateTrendEMA(indM5), score: 0 }
      }
    };
  }
};
