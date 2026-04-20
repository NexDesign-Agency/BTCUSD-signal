// ============================================================================
// BTC Signal Engine v3.1 — Scenario-Based Entry System
// Philosophy: "Have a plan FIRST, then wait for price to come to you."
// Always computes 2 scenarios (SELL at R, BUY breakout above R).
// Signal only FIRES when: price AT zone + RSI gate + candle confirmation.
// State machine prevents flip-flopping completely.
//
// FIXES v3.1:
// [FIX #1] nearestR filter: z.price → z.zoneLow > currentPrice
// [FIX #2] resistanceAbove filter: removed loose -atr*0.5 offset → z.zoneLow > currentPrice
// [FIX #3] entryBuyStop: from lastM15Close+buffer → brokenZone.zoneHigh+buffer (always ABOVE zone)
// [FIX #4] isAtZone: replaced fragile zoneProximity cross-check → direct price vs zoneLow/zoneHigh
// ============================================================================

export const SignalEngine = {

  // =========================================================================
  // STATE MACHINE — Signal lock, SL/TP detection, cooldown
  // =========================================================================
  _scenarioState: {
    phase: 'SCANNING',   // 'SCANNING' | 'ACTIVE' | 'COOLDOWN'
    signal: 'WAIT',      // 'BUY' | 'SELL' | 'WAIT'
    sl: null,
    tp1: null,
    tp2: null,
    entryZonePrice: null,
    lockedTime: 0,
    m15Count: 0,         // M15 candles elapsed since signal lock
    cooldownCount: 0,    // M15 candles elapsed in cooldown
    exitReason: null,    // 'SL_HIT' | 'TP1_HIT' | 'TP2_HIT' | 'EXPIRED'
  },

  // Zone cache — recalculate only when candle closes, not every tick
  _zoneCache: {
    zones: [],
    lastH4Close: 0,
    lastH1Close: 0
  },

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
    // --- ZONE CACHING: only rebuild when a candle actually closes ---
    const h4Close = h4Ind.closesHistory[h4Ind.closesHistory.length - 1];
    const h1Close = h1Ind.closesHistory[h1Ind.closesHistory.length - 1];
    const cacheValid = (
      this._zoneCache.zones.length > 0 &&
      this._zoneCache.lastH4Close === h4Close &&
      this._zoneCache.lastH1Close === h1Close
    );

    if (cacheValid) {
      const cached = this._zoneCache.zones.map(z => ({ ...z }));
      cached.forEach(z => {
        z.distance = Math.abs(z.price - currentPrice);
        z.distanceATR = z.distance / atr;
      });
      cached.sort((a, b) => a.distance - b.distance);
      return cached;
    }

    // --- FRESH BUILD ---
    const zones = [];

    const h4Pivots = this._extractSwingPivots(h4Ind.highsHistory, h4Ind.lowsHistory, 2);
    const h1Pivots = this._extractSwingPivots(h1Ind.highsHistory, h1Ind.lowsHistory, 1);
    const allPivots = [...h4Pivots, ...h1Pivots];

    if (allPivots.length === 0) return zones;

    allPivots.sort((a, b) => a.price - b.price);

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

    zones.forEach(z => {
      if (z.dominantType === 'high') {
        z.type = 'RESISTANCE';
      } else if (z.dominantType === 'low') {
        z.type = 'SUPPORT';
      } else {
        z.type = z.price > currentPrice ? 'RESISTANCE' : 'SUPPORT';
      }
      z.distance = Math.abs(z.price - currentPrice);
      z.distanceATR = z.distance / atr;
    });

    zones.sort((a, b) => a.distance - b.distance);

    this._zoneCache = {
      zones: zones.map(z => ({ ...z })),
      lastH4Close: h4Close,
      lastH1Close: h1Close
    };

    return zones;
  },

  _extractSwingPivots(highs, lows, weight) {
    const pivots = [];
    if (!highs || !lows || highs.length < 5) return pivots;
    const lookback = Math.min(highs.length, 150);
    const h = highs.slice(-lookback);
    const l = lows.slice(-lookback);

    for (let i = 2; i < h.length - 2; i++) {
      if (h[i] >= h[i - 1] && h[i] >= h[i - 2] && h[i] >= h[i + 1] && h[i] >= h[i + 2]) {
        pivots.push({ price: h[i], type: 'high', weight, recency: i / (h.length - 1) });
      }
      if (l[i] <= l[i - 1] && l[i] <= l[i - 2] && l[i] <= l[i + 1] && l[i] <= l[i + 2]) {
        pivots.push({ price: l[i], type: 'low', weight, recency: i / (l.length - 1) });
      }
    }
    return pivots;
  },

  _clusterToZone(cluster, atr) {
    const avgPrice = cluster.reduce((s, p) => s + p.price, 0) / cluster.length;
    const totalWeight = cluster.reduce((s, p) => s + p.weight, 0);
    const avgRecency = cluster.reduce((s, p) => s + p.recency, 0) / cluster.length;

    const highCount = cluster.filter(p => p.type === 'high').length;
    const lowCount = cluster.filter(p => p.type === 'low').length;
    const dominantType = highCount > lowCount ? 'high' : (lowCount > highCount ? 'low' : 'mixed');

    let strength = 'WEAK';
    const touchScore = Math.min(cluster.length * 1.5, 6);
    const weightScore = totalWeight * 0.5;
    const recencyScore = avgRecency * 3;
    const score = touchScore + weightScore + recencyScore;
    if (score >= 8) strength = 'STRONG';
    else if (score >= 4) strength = 'MODERATE';

    return {
      price: Math.round(avgPrice * 100) / 100,
      touches: cluster.length,
      totalWeight,
      recency: avgRecency,
      strength,
      dominantType,
      zoneHigh: avgPrice + atr * 0.15,
      zoneLow: avgPrice - atr * 0.15,
    };
  },

  // =========================================================================
  // LAYER 3: Zone Proximity Check
  // =========================================================================
  checkZoneProximity(currentPrice, zones, atr) {
    if (zones.length === 0) return { status: 'NO_ZONE', zone: null, allZones: zones };

    const supports = zones.filter(z => z.type === 'SUPPORT');
    const resistances = zones.filter(z => z.type === 'RESISTANCE');
    const nearestSupport = supports.length > 0 ? supports[0] : null;
    const nearestResistance = resistances.length > 0 ? resistances[0] : null;

    for (const z of zones) {
      if (currentPrice >= z.zoneLow && currentPrice <= z.zoneHigh) {
        return { status: 'AT_ZONE', zone: z, nearestSupport, nearestResistance, allZones: zones };
      }
    }

    for (const z of zones) {
      if (z.distanceATR <= 0.5) {
        return { status: 'APPROACHING', zone: z, nearestSupport, nearestResistance, allZones: zones };
      }
    }

    return { status: 'BETWEEN_ZONES', zone: null, nearestSupport, nearestResistance, allZones: zones };
  },

  // =========================================================================
  // LAYER 4: Candle Rejection Confirmation
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

    if (isAtResistance) {
      if (c2 > o2 && c1 < o1 && body1 > body2 * 0.8) {
        return { confirmed: true, pattern: 'BEARISH_ENGULFING', strength: 3 };
      }
      if (c1 < o1) {
        if (c2 > o2 && body1 > 0) {
          return { confirmed: true, pattern: 'BEARISH_REJECTION', strength: 2 };
        }
      }
      if (c1 < o1 && c2 < o2 && c1 < c2) {
        return { confirmed: true, pattern: 'BEARISH_PRESSURE', strength: 2 };
      }
    }

    if (isAtSupport) {
      if (c2 < o2 && c1 > o1 && body1 > body2 * 0.8) {
        return { confirmed: true, pattern: 'BULLISH_ENGULFING', strength: 3 };
      }
      if (c2 < o2 && c1 > o1) {
        return { confirmed: true, pattern: 'BULLISH_REJECTION', strength: 2 };
      }
      if (c1 > o1 && c2 > o2 && c1 > c2) {
        return { confirmed: true, pattern: 'BULLISH_PRESSURE', strength: 2 };
      }
    }

    return { confirmed: false, pattern: 'NONE', strength: 0 };
  },

  // =========================================================================
  // LAYER 5: Breakout / Hedge Detection
  // =========================================================================
  detectBreakout(h1Ind, nearestSupport, nearestResistance, atr) {
    if (!h1Ind || !h1Ind.closesHistory || h1Ind.closesHistory.length < 3) {
      return { type: 'NONE', level: null, direction: null };
    }

    const closes = h1Ind.closesHistory;
    const latestClose = closes[closes.length - 1];
    const prevClose = closes[closes.length - 2];
    const confirmMargin = atr * 0.2;

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
      if (latestClose < breakLevel && prevClose < breakLevel) {
        return {
          type: 'BREAKDOWN_CONFIRMED',
          level: nearestSupport.price,
          direction: 'SELL',
          message: `🔴 BREAKDOWN CONFIRMED di $${nearestSupport.price.toFixed(0)}. Bias berubah ke SELL. Close BUY jika masih open.`
        };
      }
    }

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
  // LAYER 6: Market Structure
  // =========================================================================
  checkMarketStructure(ind) {
    if (!ind || !ind.highsHistory || ind.highsHistory.length < 10) return 'NONE';
    const h = ind.highsHistory.slice(-20), l = ind.lowsHistory.slice(-20);
    const swingHighs = [], swingLows = [];
    for (let i = 1; i < h.length - 1; i++) {
      if (h[i] > h[i - 1] && h[i] > h[i + 1]) swingHighs.push(h[i]);
      if (l[i] < l[i - 1] && l[i] < l[i + 1]) swingLows.push(l[i]);
    }
    if (swingHighs.length >= 2 && swingLows.length >= 2) {
      const lastSH = swingHighs[swingHighs.length - 1], prevSH = swingHighs[swingHighs.length - 2];
      const lastSL = swingLows[swingLows.length - 1], prevSL = swingLows[swingLows.length - 2];
      if (lastSH > prevSH && lastSL > prevSL) return 'UPTREND (HH+HL)';
      if (lastSH < prevSH && lastSL < prevSL) return 'DOWNTREND (LH+LL)';
      if (lastSH > prevSH && lastSL < prevSL) return 'EXPANSION';
      if (lastSH < prevSH && lastSL > prevSL) return 'CONTRACTION';
    }
    return 'CHOPPY';
  },

  // =========================================================================
  // CONFIDENCE SCORING
  // =========================================================================
  calculateConfidence(params) {
    const { h4Trend, h1Trend, zoneProximity, rejection, breakout, h1Structure, rsiH1, volumeRatio } = params;
    let conf = 0;
    const reasons = [];

    if (zoneProximity.status === 'AT_ZONE') {
      conf += 25; reasons.push('+25 Price di zona S/R');
    } else if (zoneProximity.status === 'APPROACHING') {
      conf += 15; reasons.push('+15 Price mendekati zona S/R');
    }

    const h4Base = h4Trend.replace('LEAN_', '');
    const h1Base = h1Trend.replace('LEAN_', '');
    if (h4Base === h1Base && h1Base !== 'SIDEWAYS') {
      conf += 20; reasons.push('+20 H4+H1 trend aligned');
    } else if (h1Base !== 'SIDEWAYS') {
      conf += 10; reasons.push('+10 H1 trend detected');
    }

    if (rejection.confirmed) {
      conf += rejection.strength >= 3 ? 20 : 15;
      reasons.push(`+${rejection.strength >= 3 ? 20 : 15} Candle rejection: ${rejection.pattern}`);
    }

    if (h1Structure.includes('UPTREND') || h1Structure.includes('DOWNTREND')) {
      conf += 15; reasons.push('+15 Market structure clear');
    }

    const zone = zoneProximity.zone;
    if (zone) {
      if (zone.type === 'RESISTANCE' && rsiH1 > 60) {
        conf += 10; reasons.push('+10 RSI overbought at resistance');
      }
      if (zone.type === 'SUPPORT' && rsiH1 < 40) {
        conf += 10; reasons.push('+10 RSI oversold at support');
      }
    }

    if (volumeRatio > 1.5) {
      conf += 10; reasons.push('+10 Volume spike (>1.5× avg)');
    }

    if (breakout.type === 'BREAKDOWN_CONFIRMED' || breakout.type === 'BREAKOUT_CONFIRMED') {
      conf += 15; reasons.push('+15 Breakout/breakdown confirmed');
    }

    return { score: Math.min(100, conf), reasons };
  },

  // =========================================================================
  // ENTRY OPTIONS BUILDER (Zone-Aware)
  // =========================================================================
  buildEntryOptions(signal, zone, atr, currentPrice, breakout) {
    const entries = [];
    if (!zone && breakout.type === 'NONE') return entries;

    const minSLBuffer = Math.max(atr * 0.8, currentPrice * 0.005);

    if (signal === 'SELL' && zone) {
      const entryHigh = zone.zoneHigh;
      const entryLow = zone.zoneLow;
      const sl = entryHigh + minSLBuffer;
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
      const sl = entryLow - minSLBuffer;
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
  // MAIN ENGINE v2 (calculateSignal — unchanged, used by legacy callers)
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

    const zones = this.buildZoneMap(indH4, indH1, currentPrice, atrH4);
    const zoneProximity = this.checkZoneProximity(currentPrice, zones, atrH4);

    const rejectionSource = indM15.closesHistory.length >= 3 ? indM15 : indM5;
    const rejection = this.detectRejectionPattern(
      rejectionSource.closesHistory, rejectionSource.opensHistory, zoneProximity.zone
    );

    const breakout = this.detectBreakout(
      indH1,
      zoneProximity.nearestSupport,
      zoneProximity.nearestResistance,
      atrH4
    );

    const volumeRatio = indM5.volume / (indM5.smaVol20 || 1);
    const { score: confidence, reasons: confReasons } = this.calculateConfidence({
      h4Trend, h1Trend, zoneProximity, rejection, breakout,
      h1Structure, rsiH1: indH1.rsi, volumeRatio
    });

    let finalSignal = 'WAIT';
    let orderType = 'SCANNING';

    if (breakout.type !== 'NONE') {
      finalSignal = breakout.direction;
      orderType = `HEDGE → ${breakout.direction}`;
    } else if ((zoneProximity.status === 'AT_ZONE' || zoneProximity.status === 'APPROACHING') && confidence >= 60) {
      const zone = zoneProximity.zone;
      if (zone.type === 'RESISTANCE') {
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
    } else if (zoneProximity.status === 'APPROACHING') {
      orderType = `APPROACHING ${zoneProximity.zone.type}`;
    } else if (zoneProximity.status === 'BETWEEN_ZONES') {
      orderType = 'BETWEEN ZONES';
    }

    if (finalSignal !== 'WAIT' && confidence < 60 && breakout.type === 'NONE') {
      finalSignal = 'WAIT';
      orderType = `PREP (${confidence}% < 60% min)`;
    }

    const entryOptions = this.buildEntryOptions(
      finalSignal, zoneProximity.zone, atrH4, currentPrice, breakout
    );

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
    confReasons.forEach(r => reasonings.push(r));

    const supportZones = zones.filter(z => z.type === 'SUPPORT').sort((a, b) => a.distance - b.distance).slice(0, 3);
    const resistanceZones = zones.filter(z => z.type === 'RESISTANCE').sort((a, b) => a.distance - b.distance).slice(0, 3);
    const pivots = {
      support: zoneProximity.nearestSupport ? zoneProximity.nearestSupport.price : null,
      resistance: zoneProximity.nearestResistance ? zoneProximity.nearestResistance.price : null,
      supportLevels: supportZones.map(z => ({ price: z.price, strength: z.strength, touches: z.touches })),
      resistanceLevels: resistanceZones.map(z => ({ price: z.price, strength: z.strength, touches: z.touches }))
    };

    return {
      signal: finalSignal, orderType, confidence, pivots,
      hedge: breakout.type !== 'NONE' ? breakout : null,
      zoneProximity, zones: zones.slice(0, 6),
      trends: {
        H4: { trend: h4Trend, rsi: indH4.rsi },
        H1: { trend: h1Trend, rsi: indH1.rsi, structure: h1Structure },
        M15: { trend: this.evaluateTrendEMA(indM15), score: 0 },
        M5: { trend: this.evaluateTrendEMA(indM5), score: 0 }
      }
    };
  },

  // =========================================================================
  // REAL-TIME SL/TP CHECK — called every WebSocket tick
  // =========================================================================
  checkSLTP(currentPrice) {
    const s = this._scenarioState;
    if (s.phase !== 'ACTIVE' || s.signal === 'WAIT') return null;

    if (s.signal === 'BUY') {
      if (s.tp2 && currentPrice >= s.tp2) {
        s.phase = 'COOLDOWN'; s.cooldownCount = 0; s.exitReason = 'TP2_HIT';
        return { event: 'TP2_HIT', signal: 'BUY', price: currentPrice, level: s.tp2 };
      }
      if (s.tp1 && currentPrice >= s.tp1) {
        s.phase = 'COOLDOWN'; s.cooldownCount = 0; s.exitReason = 'TP1_HIT';
        return { event: 'TP1_HIT', signal: 'BUY', price: currentPrice, level: s.tp1 };
      }
      if (s.sl && currentPrice <= s.sl) {
        s.phase = 'COOLDOWN'; s.cooldownCount = 0; s.exitReason = 'SL_HIT';
        return { event: 'SL_HIT', signal: 'BUY', price: currentPrice, level: s.sl };
      }
    }

    if (s.signal === 'SELL') {
      if (s.tp2 && currentPrice <= s.tp2) {
        s.phase = 'COOLDOWN'; s.cooldownCount = 0; s.exitReason = 'TP2_HIT';
        return { event: 'TP2_HIT', signal: 'SELL', price: currentPrice, level: s.tp2 };
      }
      if (s.tp1 && currentPrice <= s.tp1) {
        s.phase = 'COOLDOWN'; s.cooldownCount = 0; s.exitReason = 'TP1_HIT';
        return { event: 'TP1_HIT', signal: 'SELL', price: currentPrice, level: s.tp1 };
      }
      if (s.sl && currentPrice >= s.sl) {
        s.phase = 'COOLDOWN'; s.cooldownCount = 0; s.exitReason = 'SL_HIT';
        return { event: 'SL_HIT', signal: 'SELL', price: currentPrice, level: s.sl };
      }
    }
    return null;
  },

  // =========================================================================
  // M15 CANDLE CLOSE TICK — advance state machine counters
  // =========================================================================
  onM15CandleClose() {
    const s = this._scenarioState;
    if (s.phase === 'ACTIVE') {
      s.m15Count++;
      if (s.m15Count >= 4) {
        s.phase = 'COOLDOWN'; s.cooldownCount = 0; s.exitReason = 'EXPIRED';
        return { event: 'EXPIRED', signal: s.signal };
      }
    } else if (s.phase === 'COOLDOWN') {
      s.cooldownCount++;
      const required = s.exitReason === 'SL_HIT' ? 2 : 1;
      if (s.cooldownCount >= required) {
        const prevSignal = s.signal; const prevReason = s.exitReason;
        s.phase = 'SCANNING'; s.signal = 'WAIT';
        s.sl = null; s.tp1 = null; s.tp2 = null; s.entryZonePrice = null;
        s.m15Count = 0; s.cooldownCount = 0; s.exitReason = null; s.lockedTime = 0;
        return { event: 'SCANNING_RESUMED', prevSignal, prevReason };
      }
    }
    return null;
  },

  // =========================================================================
  // SCENARIO BUILDER: SELL
  // =========================================================================
  _buildSellScenario(resistance, currentPrice, indH1, indM15, indM5, atr, zoneProximity, rejectionM15) {
    const minSLBuffer = Math.max(atr * 0.8, currentPrice * 0.005);
    const entryHigh = resistance.zoneHigh;
    const entryLow = resistance.zoneLow;
    const sl = entryHigh + minSLBuffer;
    const tp1 = resistance.price - atr * 1.5;
    const tp2 = resistance.price - atr * 3.0;
    const risk = sl - entryHigh;
    const rr = risk > 0 ? ((entryHigh - tp1) / risk).toFixed(1) : '0';

    // [FIX #4] isAtZone: direct price check against this specific zone's bounds
    // Replaces the old cross-check via zoneProximity which could reference a different zone
    const isAtZone = currentPrice >= resistance.zoneLow && currentPrice <= resistance.zoneHigh;

    const priceGate = {
      label: `Price di zona R: $${entryLow.toFixed(0)}–$${entryHigh.toFixed(0)}`,
      met: isAtZone,
      current: `$${currentPrice.toFixed(0)}`
    };

    // RSI H1: > 45 dan berbalik turun
    // Fallback ke kalkulasi manual jika rsiDirection tidak tersedia
    const rsiDir = indH1.rsiDirection ||
      (indH1.prevRsi !== undefined && indH1.prevRsi > indH1.rsi ? 'Falling' : 'Rising');
    const rsiH1Gate = {
      label: `RSI H1 > 45 & berbalik turun`,
      met: indH1.rsi > 45 && rsiDir === 'Falling',
      current: `RSI H1: ${indH1.rsi ? indH1.rsi.toFixed(1) : '--'} (${rsiDir})`
    };

    // RSI M5: 45–72 = ada momentum retest tapi belum overbought ekstrem
    const rsiM5Gate = {
      label: `RSI M5 antara 45–72 (momentum cukup)`,
      met: indM5.rsi > 45 && indM5.rsi < 72,
      current: `RSI M5: ${indM5.rsi ? indM5.rsi.toFixed(1) : '--'}`
    };

    // Candle rejection di M15: hanya valid kalau price sudah di zona DAN candle bearish terkonfirmasi
    const candleGate = {
      label: `Bearish candle M15 (engulfing/rejection)`,
      met: isAtZone && rejectionM15.confirmed && rejectionM15.pattern.includes('BEARISH'),
      current: rejectionM15.confirmed ? rejectionM15.pattern : 'Menunggu konfirmasi candle'
    };

    const confirmations = [priceGate, rsiH1Gate, rsiM5Gate, candleGate];
    const metCount = confirmations.filter(c => c.met).length;
    const confidence = Math.round((metCount / confirmations.length) * 100);
    // readyToFire: price harus di zona + minimal 3 dari 4 konfirmasi terpenuhi
    const readyToFire = priceGate.met && metCount >= 3;

    const distToZone = currentPrice < entryLow
      ? (entryLow - currentPrice).toFixed(0)
      : 0;
    const waitingFor = isAtZone
      ? (readyToFire
        ? '✅ Semua konfirmasi terpenuhi!'
        : `Tunggu: ${confirmations.filter(c => !c.met).map(c => c.label).join(', ')}`)
      : `Tunggu harga naik ke $${entryLow.toFixed(0)} (+$${distToZone})`;

    return {
      direction: 'SELL',
      zone: resistance,
      entryLow, entryHigh, sl, tp1, tp2, rr,
      confirmations, metCount, confidence, readyToFire, waitingFor, isAtZone,
      strength: resistance.strength,
      touches: resistance.touches
    };
  },

  // =========================================================================
  // SCENARIO BUILDER: BUY AT SUPPORT
  // Mirror dari _buildSellScenario, tapi arah BUY dan zona Support
  // =========================================================================
  _buildBuyAtSupportScenario(support, currentPrice, indH1, indM15, indM5, atr, zoneProximity, rejectionM15) {
    const minSLBuffer = Math.max(atr * 0.8, currentPrice * 0.005);
    const entryLow  = support.zoneLow;
    const entryHigh = support.zoneHigh;
    const sl  = entryLow - minSLBuffer;
    const tp1 = support.price + atr * 1.5;
    const tp2 = support.price + atr * 3.0;
    const risk = entryLow - sl;
    const rr  = risk > 0 ? ((tp1 - entryLow) / risk).toFixed(1) : '0';

    const isAtZone = currentPrice >= support.zoneLow && currentPrice <= support.zoneHigh;

    const priceGate = {
      label: `Price di zona S: $${entryLow.toFixed(0)}–$${entryHigh.toFixed(0)}`,
      met: isAtZone,
      current: `$${currentPrice.toFixed(0)}`
    };

    const rsiDir = indH1.rsiDirection ||
      (indH1.prevRsi !== undefined && indH1.prevRsi < indH1.rsi ? 'Rising' : 'Falling');
    const rsiH1Gate = {
      label: `RSI H1 < 55 & berbalik naik`,
      met: indH1.rsi < 55 && rsiDir === 'Rising',
      current: `RSI H1: ${indH1.rsi ? indH1.rsi.toFixed(1) : '--'} (${rsiDir})`
    };

    const rsiM5Gate = {
      label: `RSI M5 antara 28–55 (momentum cukup)`,
      met: indM5.rsi > 28 && indM5.rsi < 55,
      current: `RSI M5: ${indM5.rsi ? indM5.rsi.toFixed(1) : '--'}`
    };

    const candleGate = {
      label: `Bullish candle M15 (engulfing/rejection)`,
      met: isAtZone && rejectionM15.confirmed && rejectionM15.pattern.includes('BULLISH'),
      current: rejectionM15.confirmed ? rejectionM15.pattern : 'Menunggu konfirmasi candle'
    };

    const confirmations = [priceGate, rsiH1Gate, rsiM5Gate, candleGate];
    const metCount = confirmations.filter(c => c.met).length;
    const confidence = Math.round((metCount / confirmations.length) * 100);
    const readyToFire = priceGate.met && metCount >= 3;

    const distToZone = currentPrice > entryHigh
      ? (currentPrice - entryHigh).toFixed(0)
      : 0;
    const waitingFor = isAtZone
      ? (readyToFire
        ? '✅ Semua konfirmasi terpenuhi!'
        : `Tunggu: ${confirmations.filter(c => !c.met).map(c => c.label).join(', ')}`)
      : `Tunggu harga turun ke $${entryHigh.toFixed(0)} (-$${distToZone})`;

    return {
      direction: 'BUY',
      zone: support,
      entryLow, entryHigh, sl, tp1, tp2, rr,
      confirmations, metCount, confidence, readyToFire, waitingFor, isAtZone,
      strength: support.strength,
      touches: support.touches
    };
  },

  // BUY hanya disarankan ketika candle body M15 close DI ATAS resistance zone.
  // Kalau belum breakout → tampilkan "WAITING FOR BREAKOUT".
  // Kalau breakout confirmed → saran BUY STOP (di atas zona) + BUY LIMIT (retest).
  //
  // [FIX #2] resistanceAbove: filter ketat z.zoneLow > currentPrice
  //          (dulu pakai z.price > currentPrice - atr*0.5 → bisa ikutkan zona di bawah harga)
  // [FIX #3] entryBuyStop: dari brokenZone.zoneHigh + buffer
  //          (dulu dari lastM15Close + buffer → bisa di tengah/bawah zona)
  // =========================================================================
  _buildBreakoutBuyScenario(zones, currentPrice, indH1, indM15, indM5, atr) {
    const lastM15Close = indM15.closesHistory && indM15.closesHistory.length > 0
      ? indM15.closesHistory[indM15.closesHistory.length - 1]
      : null;

    // [FIX #2] Hanya ambil resistance yang SELURUH zonanya di atas harga saat ini
    // z.zoneLow > currentPrice memastikan harga belum masuk ke dalam zona manapun
    const resistanceAbove = zones
      .filter(z => z.type === 'RESISTANCE' && z.zoneLow > currentPrice)
      .sort((a, b) => a.price - b.price); // ascending = nearest above first

    // Watch zone = resistance terdekat di atas harga
    const watchZone = resistanceAbove[0] || null;

    // Breakout confirmed = candle body M15 terakhir close DI ATAS batas atas zona
    const breakoutConfirmed = !!(lastM15Close && watchZone && lastM15Close > watchZone.zoneHigh);
    const brokenZone = breakoutConfirmed ? watchZone : null;

    if (!brokenZone) {
      // Belum breakout — tampilkan zona yang ditunggu
      const distToBreakout = watchZone
        ? Math.max(0, watchZone.zoneHigh - currentPrice).toFixed(0)
        : '--';
      return {
        direction: 'BUY_BREAKOUT',
        state: 'WAITING',
        watchZone,
        readyToFire: false,
        waitingFor: watchZone
          ? `Tunggu M15 close di atas $${watchZone.zoneHigh.toFixed(0)} (+$${distToBreakout})`
          : 'Tidak ada resistance di atas harga',
        confirmations: [
          { label: `M15 close di atas R: $${watchZone ? watchZone.zoneHigh.toFixed(0) : '--'}`, met: false },
          { label: 'RSI M5 > 50 (momentum naik)', met: indM5.rsi > 50 },
          { label: 'RSI H1 > 45', met: indH1.rsi > 45 },
        ],
        entryBuyStop: null, entryRetestLow: null, entryRetestHigh: null,
        sl: null, tp1: null, tp2: null, rr: '--',
        metCount: [indM5.rsi > 50, indH1.rsi > 45].filter(Boolean).length,
        strength: watchZone ? watchZone.strength : '--',
        touches: watchZone ? watchZone.touches : 0,
      };
    }

    // --- BREAKOUT CONFIRMED ---

    // [FIX #3] BUY STOP selalu di ATAS zona yang ditembus, bukan dari lastM15Close
    // Ini menjamin entry hanya terjadi ketika harga sudah benar-benar di atas resistance
    const breakoutBuffer = Math.max(atr * 0.12, currentPrice * 0.001);
    const entryBuyStop = brokenZone.zoneHigh + breakoutBuffer;

    // BUY LIMIT (retest): old resistance → new support
    // Entry di antara zoneLow - buffer hingga zoneHigh (zona flip S/R)
    const retestBuffer = atr * 0.3;
    const entryRetestHigh = brokenZone.zoneHigh;
    const entryRetestLow = brokenZone.zoneLow - retestBuffer;

    // SL: di bawah zona yang ditembus (zona flip sekarang jadi support)
    const slBuffer = Math.max(atr * 0.8, currentPrice * 0.005);
    const sl = brokenZone.zoneLow - slBuffer;

    // TP1: next resistance di atas zona yang ditembus
    const nextR = resistanceAbove.find(r => r.price > brokenZone.price + atr * 0.5);
    const tp1 = nextR ? nextR.price : entryBuyStop + atr * 1.5;
    const tp2 = entryBuyStop + atr * 3.0;

    const riskBuyStop = entryBuyStop - sl;
    const rr = riskBuyStop > 0 ? ((tp1 - entryBuyStop) / riskBuyStop).toFixed(1) : '0';

    const confirmations = [
      { label: `✅ M15 close di atas R $${brokenZone.zoneHigh.toFixed(0)}`, met: true },
      { label: 'RSI M5 > 50 (momentum naik)', met: indM5.rsi > 50 },
      { label: 'RSI H1 > 45', met: indH1.rsi > 45 },
    ];
    const metCount = confirmations.filter(c => c.met).length;
    const readyToFire = metCount >= 2;

    return {
      direction: 'BUY_BREAKOUT',
      state: 'BREAKOUT',
      brokenZone,
      entryBuyStop,       // Selalu di atas zoneHigh — FIX #3
      entryRetestLow,
      entryRetestHigh,
      sl, tp1, tp2, rr,
      confirmations, metCount, readyToFire,
      confidence: Math.round((metCount / confirmations.length) * 100),
      waitingFor: '🚀 BREAKOUT TERKONFIRMASI!',
      strength: brokenZone.strength,
      touches: brokenZone.touches,
    };
  },

  _buildPriceContext(currentPrice, nearestS, nearestR, zoneProximity) {
    let position = 'BETWEEN_ZONES';
    if (zoneProximity.status === 'AT_ZONE' && zoneProximity.zone)
      position = zoneProximity.zone.type === 'RESISTANCE' ? 'AT_RESISTANCE' : 'AT_SUPPORT';
    return {
      current: currentPrice,
      position,
      distToR: nearestR ? nearestR.price - currentPrice : null,
      distToS: nearestS ? currentPrice - nearestS.price : null,
      nearestR: nearestR ? { price: nearestR.price, strength: nearestR.strength } : null,
      nearestS: nearestS ? { price: nearestS.price, strength: nearestS.strength } : null,
    };
  },

  // =========================================================================
  // MAIN v3 — analyzeScenarios() — called per M15 candle close
  // =========================================================================
  analyzeScenarios(indicatorsMap) {
    const indH4 = indicatorsMap['H4'];
    const indH1 = indicatorsMap['H1'];
    const indM15 = indicatorsMap['M15'];
    const indM5 = indicatorsMap['M5'];

    if (!indH4 || !indH1 || !indM15 || !indM5) {
      return {
        phase: 'LOADING', sellScenario: null, buyScenario: null,
        priceContext: null, pivots: {}, trends: {},
        activeSignal: { ...this._scenarioState }
      };
    }

    const atrH4 = indH4.atr;
    const currentPrice = indM5.price;
    const h4Trend = this.evaluateTrendEMA(indH4);
    const h1Trend = this.evaluateTrendEMA(indH1);
    const h1Structure = this.checkMarketStructure(indH1);

    const zones = this.buildZoneMap(indH4, indH1, currentPrice, atrH4);
    const zoneProximity = this.checkZoneProximity(currentPrice, zones, atrH4);
    const rejectionM15 = this.detectRejectionPattern(
      indM15.closesHistory, indM15.opensHistory, zoneProximity.zone
    );

    // [FIX #1] nearestR: gunakan z.zoneLow > currentPrice agar zona yang sudah ditembus
    // (atau sedang disentuh dari bawah) tidak ikut sebagai resistance target SELL
    const nearestR = zones
      .filter(z => z.type === 'RESISTANCE' && z.zoneLow > currentPrice)
      .sort((a, b) => a.price - b.price)[0] || null;

    // nearestS: gunakan z.zoneHigh < currentPrice agar zona yang sudah ditembus dari atas
    // tidak ikut sebagai support target BUY
    const nearestS = zones
      .filter(z => z.type === 'SUPPORT' && z.zoneHigh < currentPrice)
      .sort((a, b) => b.price - a.price)[0] || null;

    // Bangun kedua skenario
    const rawSellScenario = nearestR
      ? this._buildSellScenario(nearestR, currentPrice, indH1, indM15, indM5, atrH4, zoneProximity, rejectionM15)
      : null;

    const rawBuyScenario = nearestS
      ? this._buildBuyAtSupportScenario(nearestS, currentPrice, indH1, indM15, indM5, atrH4, zoneProximity, rejectionM15)
      : null;

    // Pilih scenario kiri berdasarkan H1 trend
    // BULL → BUY at Support | BEAR → SELL at Resistance | SIDEWAYS → pilih zona terdekat
    const h1Base = h1Trend.replace('LEAN_', '');
    let sellScenario;
    if (h1Base === 'BULL') {
      sellScenario = rawBuyScenario || rawSellScenario;
    } else if (h1Base === 'BEAR') {
      sellScenario = rawSellScenario || rawBuyScenario;
    } else {
      const distR = nearestR ? Math.abs(nearestR.price - currentPrice) : Infinity;
      const distS = nearestS ? Math.abs(nearestS.price - currentPrice) : Infinity;
      sellScenario = distS < distR ? (rawBuyScenario || rawSellScenario) : (rawSellScenario || rawBuyScenario);
    }

    const buyScenario = this._buildBreakoutBuyScenario(
      zones, currentPrice, indH1, indM15, indM5, atrH4
    );

    const priceContext = this._buildPriceContext(currentPrice, nearestS, nearestR, zoneProximity);

    // Fire signal jika state SCANNING — patuhi arah trend
    const s = this._scenarioState;
    if (s.phase === 'SCANNING') {
      if (sellScenario && sellScenario.readyToFire) {
        s.phase = 'ACTIVE'; s.signal = sellScenario.direction;
        s.sl = sellScenario.sl; s.tp1 = sellScenario.tp1; s.tp2 = sellScenario.tp2;
        s.entryZonePrice = sellScenario.zone ? sellScenario.zone.price : currentPrice;
        s.m15Count = 0; s.lockedTime = Date.now();
      } else if (buyScenario && buyScenario.readyToFire && buyScenario.state === 'BREAKOUT') {
        s.phase = 'ACTIVE'; s.signal = 'BUY';
        s.sl = buyScenario.sl; s.tp1 = buyScenario.tp1; s.tp2 = buyScenario.tp2;
        s.entryZonePrice = buyScenario.entryBuyStop; s.m15Count = 0; s.lockedTime = Date.now();
      }
    }

    const supportZones = zones
      .filter(z => z.type === 'SUPPORT')
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3);
    const resistanceZones = zones
      .filter(z => z.type === 'RESISTANCE')
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3);

    return {
      phase: s.phase,
      activeSignal: { ...s },
      sellScenario,
      buyScenario,
      priceContext,
      pivots: {
        support: nearestS ? nearestS.price : null,
        resistance: nearestR ? nearestR.price : null,
        supportLevels: supportZones.map(z => ({ price: z.price, strength: z.strength, touches: z.touches })),
        resistanceLevels: resistanceZones.map(z => ({ price: z.price, strength: z.strength, touches: z.touches }))
      },
      zones: zones.slice(0, 6),
      trends: {
        H4: { trend: h4Trend, rsi: indH4.rsi },
        H1: { trend: h1Trend, rsi: indH1.rsi, structure: h1Structure },
        M15: { trend: this.evaluateTrendEMA(indM15), rsi: indM15.rsi },
        M5: { trend: this.evaluateTrendEMA(indM5), rsi: indM5.rsi }
      }
    };
  }
};