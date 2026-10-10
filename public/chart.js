/**
 * VT2 Canvas Candlestick & Indicator Chart
 * High-DPI interactive charting component for trading terminals.
 */

export class VT2Chart {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.candles = [];
    this.indicators = null;
    this.hoverIndex = null;
    this.showEma20 = true;
    this.showEma50 = true;
    this.showEma200 = true;
    this.showRsi = true;
    this.showVolume = true;
    this.theme = options.theme || (typeof document !== 'undefined' ? (document.documentElement.getAttribute('data-theme') || 'dark') : 'dark');

    this.padding = { top: 20, right: 70, bottom: 30, left: 10 };
    this.setupEvents();
    this.resize();
  }

  setTheme(theme) {
    this.theme = theme || 'dark';
    this.render();
  }

  setData(candles, indicators = null) {
    this.candles = candles || [];
    this.indicators = indicators;
    this.render();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = Math.max(380, rect.height || 420);

    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.scale(dpr, dpr);

    this.render();
  }

  setupEvents() {
    window.addEventListener('resize', () => this.resize());

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      this.handleHover(x);
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.hoverIndex = null;
      this.render();
    });

    this.canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length > 0) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.touches[0].clientX - rect.left;
        this.handleHover(x);
      }
    });
  }

  handleHover(x) {
    if (this.candles.length === 0) return;
    const chartWidth = this.width - this.padding.left - this.padding.right;
    const candleWidth = chartWidth / this.candles.length;
    const index = Math.floor((x - this.padding.left) / candleWidth);
    if (index >= 0 && index < this.candles.length) {
      this.hoverIndex = index;
      this.render();
    }
  }

  render() {
    const { ctx, width, height, padding, candles } = this;
    if (!ctx || width === 0 || height === 0) return;

    ctx.clearRect(0, 0, width, height);

    const isLight = this.theme === 'light';
    const bgColor = isLight ? '#ffffff' : '#0b0f19';
    const gridColor = isLight ? '#e2e8f0' : '#1e293b';
    const textColor = '#64748b';
    const greenColor = isLight ? '#059669' : '#00e599';
    const redColor = isLight ? '#dc2626' : '#ff3b5c';
    const greenVol = isLight ? 'rgba(5, 150, 105, 0.22)' : 'rgba(0, 229, 153, 0.18)';
    const redVol = isLight ? 'rgba(220, 38, 38, 0.22)' : 'rgba(255, 59, 92, 0.18)';
    const crosshairColor = isLight ? 'rgba(15, 23, 42, 0.35)' : 'rgba(255, 255, 255, 0.4)';
    const tooltipBg = isLight ? '#ffffff' : '#0f172a';
    const tooltipBorder = isLight ? '#cbd5e1' : '#334155';
    const tooltipText = isLight ? '#0f172a' : '#e2e8f0';

    // Terminal canvas background
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);

    if (candles.length === 0) {
      ctx.fillStyle = textColor;
      ctx.font = '14px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Awaiting candle stream...', width / 2, height / 2);
      return;
    }

    // Layout partitioning: Main chart (70%), RSI subplot (30%)
    const mainHeight = height * 0.68;
    const rsiTop = mainHeight + 10;
    const rsiHeight = height - rsiTop - padding.bottom;
    const chartWidth = width - padding.left - padding.right;

    // Price scaling
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    let maxVol = 0;

    for (const c of candles) {
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
      if (c.volume > maxVol) maxVol = c.volume;
    }

    const priceBuffer = (maxPrice - minPrice) * 0.05 || 1;
    minPrice -= priceBuffer;
    maxPrice += priceBuffer;
    const priceRange = maxPrice - minPrice;

    const candleWidth = chartWidth / candles.length;
    const barWidth = Math.max(2, candleWidth * 0.72);

    const getY = (price) => {
      return padding.top + (1 - (price - minPrice) / priceRange) * (mainHeight - padding.top);
    };

    // 1. Grid lines and price axis
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.fillStyle = textColor;
    ctx.font = '11px JetBrains Mono, monospace';
    ctx.textAlign = 'left';

    const gridSteps = 5;
    for (let i = 0; i <= gridSteps; i++) {
      const p = minPrice + (priceRange * (i / gridSteps));
      const y = getY(p);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();

      ctx.fillText(p.toFixed(2), width - padding.right + 8, y + 4);
    }

    // 2. Volume sub-bars in bottom portion of main chart
    if (this.showVolume && maxVol > 0) {
      const volMaxHeight = mainHeight * 0.22;
      for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        const x = padding.left + (i * candleWidth) + (candleWidth / 2);
        const vH = (c.volume / maxVol) * volMaxHeight;
        const vY = mainHeight - vH;

        ctx.fillStyle = c.close >= c.open ? greenVol : redVol;
        ctx.fillRect(x - (barWidth / 2), vY, barWidth, vH);
      }
    }

    // 3. Candlesticks
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const x = padding.left + (i * candleWidth) + (candleWidth / 2);
      const isGreen = c.close >= c.open;
      const color = isGreen ? greenColor : redColor;

      const highY = getY(c.high);
      const lowY = getY(c.low);
      const openY = getY(c.open);
      const closeY = getY(c.close);

      // Wick
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, highY);
      ctx.lineTo(x, lowY);
      ctx.stroke();

      // Body
      const bodyTop = Math.min(openY, closeY);
      const bodyHeight = Math.max(1.5, Math.abs(closeY - openY));

      ctx.fillStyle = color;
      ctx.fillRect(x - (barWidth / 2), bodyTop, barWidth, bodyHeight);
    }

    // 4. Overlays: EMA 20, 50, 200
    if (this.indicators) {
      this.drawLineSeries(this.indicators.ema20, '#38bdf8', getY, candleWidth); // Sky blue EMA 20
      this.drawLineSeries(this.indicators.ema50, '#fbbf24', getY, candleWidth); // Amber EMA 50
      this.drawLineSeries(this.indicators.ema200, '#a855f7', getY, candleWidth); // Purple EMA 200
    }

    // 5. RSI Subplot
    if (this.showRsi) {
      // Subplot boundary
      ctx.strokeStyle = gridColor;
      ctx.strokeRect(padding.left, rsiTop, chartWidth, rsiHeight);

      // 70 and 30 thresholds
      const getRsiY = (v) => rsiTop + (1 - (v / 100)) * rsiHeight;
      ctx.strokeStyle = isLight ? 'rgba(220, 38, 38, 0.4)' : 'rgba(255, 59, 92, 0.35)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(padding.left, getRsiY(70));
      ctx.lineTo(width - padding.right, getRsiY(70));
      ctx.stroke();

      ctx.strokeStyle = isLight ? 'rgba(5, 150, 105, 0.4)' : 'rgba(0, 229, 153, 0.35)';
      ctx.beginPath();
      ctx.moveTo(padding.left, getRsiY(30));
      ctx.lineTo(width - padding.right, getRsiY(30));
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = textColor;
      ctx.fillText('70', width - padding.right + 8, getRsiY(70) + 4);
      ctx.fillText('30', width - padding.right + 8, getRsiY(30) + 4);

      if (this.indicators && this.indicators.rsi14) {
        this.drawLineSeries(this.indicators.rsi14, isLight ? '#7c3aed' : '#c084fc', getRsiY, candleWidth, rsiTop);
      }

      ctx.fillStyle = textColor;
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.fillText('RSI (14)', padding.left + 8, rsiTop + 14);
    }

    // 6. Crosshair and hover tooltip
    if (this.hoverIndex !== null && this.candles[this.hoverIndex]) {
      const c = this.candles[this.hoverIndex];
      const hX = padding.left + (this.hoverIndex * candleWidth) + (candleWidth / 2);
      const hY = getY(c.close);

      ctx.strokeStyle = crosshairColor;
      ctx.setLineDash([4, 4]);

      // Vertical line
      ctx.beginPath();
      ctx.moveTo(hX, padding.top);
      ctx.lineTo(hX, height - padding.bottom);
      ctx.stroke();

      // Horizontal line on main chart
      ctx.beginPath();
      ctx.moveTo(padding.left, hY);
      ctx.lineTo(width - padding.right, hY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Badge at top
      ctx.fillStyle = tooltipBg;
      ctx.strokeStyle = tooltipBorder;
      ctx.fillRect(padding.left + 8, padding.top + 6, 380, 26);
      ctx.strokeRect(padding.left + 8, padding.top + 6, 380, 26);

      ctx.fillStyle = tooltipText;
      ctx.font = '11px JetBrains Mono, monospace';
      const timeStr = new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      ctx.fillText(`T: ${timeStr}  O: ${c.open}  H: ${c.high}  L: ${c.low}  C: ${c.close}  V: ${c.volume}`, padding.left + 16, padding.top + 23);
    }
  }

  drawLineSeries(series, color, getY, candleWidth, minY = 0) {
    if (!series || !Array.isArray(series)) return;
    const { ctx, padding } = this;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    let started = false;
    for (let i = 0; i < series.length; i++) {
      const val = series[i];
      if (val === null || val === undefined) continue;

      const x = padding.left + (i * candleWidth) + (candleWidth / 2);
      const y = getY(val);

      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }
}
