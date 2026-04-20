import { createChart } from 'lightweight-charts';

export class ChartComponent {
  constructor(containerId) {
    const container = document.getElementById(containerId);
    this.chart = createChart(container, {
      layout: {
        background: { type: 'solid', color: '#131722' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: 'rgba(42, 46, 57, 0.5)' },
        horzLines: { color: 'rgba(42, 46, 57, 0.5)' },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: 'rgba(197, 203, 206, 0.8)' },
      timeScale: { borderColor: 'rgba(197, 203, 206, 0.8)', timeVisible: true },
    });

    this.candleSeries = this.chart.addCandlestickSeries({
      upColor: '#00ff41', downColor: '#ff073a',
      borderVisible: false,
      wickUpColor: '#00ff41', wickDownColor: '#ff073a',
    });

    this.ema21Series = this.chart.addLineSeries({ color: '#f39c12', lineWidth: 2 });
    this.ema50Series = this.chart.addLineSeries({ color: '#3498db', lineWidth: 2 });

    this.volumeSeries = this.chart.addHistogramSeries({
      color: '#26a69a',
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });

    this.macdSeries = this.chart.addHistogramSeries({
      color: 'rgba(255, 255, 255, 0.2)',
      priceFormat: { type: 'volume' },
      priceScaleId: 'macd',
    });

    this.bbUpperSeries  = this.chart.addLineSeries({ color: 'rgba(255,255,255,0.2)', lineWidth: 1, lineStyle: 2 });
    this.bbLowerSeries  = this.chart.addLineSeries({ color: 'rgba(255,255,255,0.2)', lineWidth: 1, lineStyle: 2 });
    this.bbMiddleSeries = this.chart.addLineSeries({ color: 'rgba(255,255,255,0.1)', lineWidth: 1 });

    this.chart.priceScale('').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    this.chart.priceScale('macd').applyOptions({ scaleMargins: { top: 0.7, bottom: 0.1 }, visible: false });

    this.supportLines    = [];
    this.resistanceLines = [];
    this.srVisible = true;

    new ResizeObserver(entries => {
      if (entries.length === 0 || entries[0].target !== container) return;
      const newRect = entries[0].contentRect;
      this.chart.applyOptions({ height: newRect.height, width: newRect.width });
    }).observe(container);
  }

  setData(data, ema21Data, ema50Data, volumeData, bbData, macdData) {
    this.candleSeries.setData(data);
    if (ema21Data)   this.ema21Series.setData(ema21Data);
    if (ema50Data)   this.ema50Series.setData(ema50Data);
    if (volumeData)  this.volumeSeries.setData(volumeData);
    if (macdData)    this.macdSeries.setData(macdData);
    if (bbData) {
      this.bbUpperSeries.setData(bbData.upper);
      this.bbLowerSeries.setData(bbData.lower);
      this.bbMiddleSeries.setData(bbData.middle);
    }
  }

  setMarkers(markers) { this.candleSeries.setMarkers(markers); }

  updateSRLines(supportPrice, resistancePrice, supportLevels, resistanceLevels) {
    if (!this.srVisible) return;

    this.supportLines.forEach(l => this.candleSeries.removePriceLine(l));
    this.supportLines = [];
    this.resistanceLines.forEach(l => this.candleSeries.removePriceLine(l));
    this.resistanceLines = [];

    const rLevels = (resistanceLevels && resistanceLevels.length > 0) ? resistanceLevels
      : (resistancePrice && resistancePrice > 0 ? [{ price: resistancePrice, strength: '?', touches: 0 }] : []);

    rLevels.forEach((level, idx) => {
      if (idx >= 3 || !level.price || level.price <= 0) return;
      const alpha = idx === 0 ? 1.0 : idx === 1 ? 0.6 : 0.3;
      const style = idx === 0 ? 0 : idx === 1 ? 2 : 3;
      const width = idx === 0 ? 2 : 1;
      const line = this.candleSeries.createPriceLine({
        price: level.price,
        color: `rgba(255, 7, 58, ${alpha})`,
        lineWidth: width, lineStyle: style,
        axisLabelVisible: true,
        title: `ZONA SELL ${idx + 1} ${Math.round(level.price)}`,
      });
      this.resistanceLines.push(line);
    });

    const sLevels = (supportLevels && supportLevels.length > 0) ? supportLevels
      : (supportPrice && supportPrice > 0 ? [{ price: supportPrice, strength: '?', touches: 0 }] : []);

    sLevels.forEach((level, idx) => {
      if (idx >= 3 || !level.price || level.price <= 0) return;
      const alpha = idx === 0 ? 1.0 : idx === 1 ? 0.55 : 0.28;
      const style = idx === 0 ? 0 : idx === 1 ? 2 : 3;
      const width = idx === 0 ? 2 : 1;
      const line = this.candleSeries.createPriceLine({
        price: level.price,
        color: `rgba(0, 255, 65, ${alpha})`,
        lineWidth: width, lineStyle: style,
        axisLabelVisible: true,
        title: `ZONA BUY ${idx + 1} ${Math.round(level.price)}`,
      });
      this.supportLines.push(line);
    });
  }

  toggleSR(visible) {
    this.srVisible = visible;
    if (!visible) {
      this.supportLines.forEach(l => this.candleSeries.removePriceLine(l));
      this.supportLines = [];
      this.resistanceLines.forEach(l => this.candleSeries.removePriceLine(l));
      this.resistanceLines = [];
      this._clearEntryProjections();
    }
  }

  _clearEntryProjections() {
    if (!this._entryLines) this._entryLines = [];
    this._entryLines.forEach(line => {
      try { this.candleSeries.removePriceLine(line); } catch (_) {}
    });
    this._entryLines = [];
  }

  updateEntryProjections(sellScenario, buyScenario) {
    if (!this._entryLines) this._entryLines = [];
    this._clearEntryProjections();
    if (!this.srVisible) return;

    const add = (price, color, label, lineWidth = 1, lineStyle = 2) => {
      if (!price || price <= 0) return;
      const line = this.candleSeries.createPriceLine({
        price, color, lineWidth, lineStyle,
        axisLabelVisible: true, title: label,
      });
      this._entryLines.push(line);
    };

    // ── SELL — entry zone band only (SL/TP di panel kanan, bukan chart)
    if (sellScenario && sellScenario.entryLow) {
      const state = sellScenario.isAtZone ? 'AT ZONE' : 'WAITING';
      add(sellScenario.entryHigh, 'rgba(255,7,58,0.9)', `▼ SELL ENTRY ${state}`, 2, 0);
      add(sellScenario.entryLow,  'rgba(255,7,58,0.5)', `▼ SELL FLOOR`, 1, 2);
    }

    // ── BUY — watch zone atau breakout entry only (SL/TP di panel kanan)
    if (buyScenario) {
      if (buyScenario.state === 'WAITING' && buyScenario.watchZone) {
        add(buyScenario.watchZone.zoneHigh, 'rgba(255,170,0,0.85)', `⏳ BREAKOUT @$${Math.round(buyScenario.watchZone.zoneHigh)}`, 1, 2);
        add(buyScenario.watchZone.zoneLow,  'rgba(255,170,0,0.4)',  `⏳ WATCH ZONE`, 1, 3);
      } else if (buyScenario.state === 'BREAKOUT' && buyScenario.entryBuyStop) {
        add(buyScenario.entryBuyStop,    '#00ff41',            `▲ BUY STOP $${Math.round(buyScenario.entryBuyStop)}`, 2, 0);
        add(buyScenario.entryRetestHigh, 'rgba(0,255,65,0.5)', `▲ RETEST HI`, 1, 2);
        add(buyScenario.entryRetestLow,  'rgba(0,255,65,0.3)', `▲ RETEST LO`, 1, 3);
      }
    }
  }

  updateTick(tick, ema21Tick, ema50Tick, volumeTick, bbTick, macdTick) {
    this.candleSeries.update(tick);
    if (ema21Tick)  this.ema21Series.update(ema21Tick);
    if (ema50Tick)  this.ema50Series.update(ema50Tick);
    if (volumeTick) this.volumeSeries.update(volumeTick);
    if (macdTick)   this.macdSeries.update(macdTick);
    if (bbTick) {
      this.bbUpperSeries.update(bbTick.upper);
      this.bbLowerSeries.update(bbTick.lower);
      this.bbMiddleSeries.update(bbTick.middle);
    }
  }

  fitChart() {
    this.chart.timeScale().fitContent();
    this.chart.priceScale('right').applyOptions({ autoScale: true });
  }

  toggleSeries(type, visible) {
    switch (type) {
      case 'MA':   this.ema21Series.applyOptions({ visible }); this.ema50Series.applyOptions({ visible }); break;
      case 'BB':   this.bbUpperSeries.applyOptions({ visible }); this.bbLowerSeries.applyOptions({ visible }); this.bbMiddleSeries.applyOptions({ visible }); break;
      case 'VOL':  this.volumeSeries.applyOptions({ visible }); break;
      case 'MACD': this.macdSeries.applyOptions({ visible }); break;
      case 'SR':   this.toggleSR(visible); break;
    }
  }
}
