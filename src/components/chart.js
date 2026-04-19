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
      crosshair: {
        mode: 1, // Magnet
      },
      rightPriceScale: {
        borderColor: 'rgba(197, 203, 206, 0.8)',
      },
      timeScale: {
        borderColor: 'rgba(197, 203, 206, 0.8)',
        timeVisible: true,
      },
    });

    this.candleSeries = this.chart.addCandlestickSeries({
      upColor: '#00ff41',
      downColor: '#ff073a',
      borderVisible: false,
      wickUpColor: '#00ff41',
      wickDownColor: '#ff073a',
    });

    this.ema21Series = this.chart.addLineSeries({
      color: '#f39c12',
      lineWidth: 2,
    });
    
    this.ema50Series = this.chart.addLineSeries({
      color: '#3498db',
      lineWidth: 2,
    });

    this.volumeSeries = this.chart.addHistogramSeries({
      color: '#26a69a',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '', // set as an overlay
    });

    this.macdSeries = this.chart.addHistogramSeries({
      color: 'rgba(255, 255, 255, 0.2)',
      priceFormat: { type: 'volume' },
      priceScaleId: 'macd',
    });

    this.bbUpperSeries = this.chart.addLineSeries({ color: 'rgba(255, 255, 255, 0.2)', lineWidth: 1, lineStyle: 2 });
    this.bbLowerSeries = this.chart.addLineSeries({ color: 'rgba(255, 255, 255, 0.2)', lineWidth: 1, lineStyle: 2 });
    this.bbMiddleSeries = this.chart.addLineSeries({ color: 'rgba(255, 255, 255, 0.1)', lineWidth: 1 });

    this.chart.priceScale('').applyOptions({
      scaleMargins: {
        top: 0.8, // volume at bottom
        bottom: 0,
      },
    });

    this.chart.priceScale('macd').applyOptions({
      scaleMargins: {
        top: 0.7, // macd slightly above volume
        bottom: 0.1,
      },
      visible: false, // hide the scale
    });

    // Resize handler
    new ResizeObserver(entries => {
      if (entries.length === 0 || entries[0].target !== container) return;
      const newRect = entries[0].contentRect;
      this.chart.applyOptions({ height: newRect.height, width: newRect.width });
    }).observe(container);
  }

  setData(data, ema21Data, ema50Data, volumeData, bbData, macdData) {
    this.candleSeries.setData(data);
    if (ema21Data) this.ema21Series.setData(ema21Data);
    if (ema50Data) this.ema50Series.setData(ema50Data);
    if (volumeData) this.volumeSeries.setData(volumeData);
    if (macdData) this.macdSeries.setData(macdData);
    
    if (bbData) {
      this.bbUpperSeries.setData(bbData.upper);
      this.bbLowerSeries.setData(bbData.lower);
      this.bbMiddleSeries.setData(bbData.middle);
    }
  }

  setMarkers(markers) {
    // markers: [{ time, position, color, shape, text }]
    this.candleSeries.setMarkers(markers);
  }

  updateTick(tick, ema21Tick, ema50Tick, volumeTick, bbTick, macdTick) {
    // tick format: { time, open, high, low, close }
    this.candleSeries.update(tick);
    if (ema21Tick) this.ema21Series.update(ema21Tick);
    if (ema50Tick) this.ema50Series.update(ema50Tick);
    if (volumeTick) this.volumeSeries.update(volumeTick);
    if (macdTick) this.macdSeries.update(macdTick);

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
      case 'MA':
        this.ema21Series.applyOptions({ visible });
        this.ema50Series.applyOptions({ visible });
        break;
      case 'BB':
        this.bbUpperSeries.applyOptions({ visible });
        this.bbLowerSeries.applyOptions({ visible });
        this.bbMiddleSeries.applyOptions({ visible });
        break;
      case 'VOL':
        this.volumeSeries.applyOptions({ visible });
        break;
      case 'MACD':
        this.macdSeries.applyOptions({ visible });
        break;
    }
  }
}
