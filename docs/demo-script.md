# VT2 Hackathon Demo Video Script

**Competition:** Bitget AI Hackathon S2  
**Track:** Track 1 — Alpha Factory (Open Theme)  
**Project:** VT2 (Verifiable Trading Technology)  
**Target Video Duration:** ~2:30 to 2:45 (Maximum 3:00)  
**Resolution:** 1920x1080 (1080p H.264 MP4)  
**Audio:** Windows Speech Synthesis (WAV, 22050 Hz / AAC)  
**Policy:** Paper trading only. No real orders. Mainnet blocked.

---

## Slide Breakdown & Narration

### Slide 1: Title & Hackathon Intro
- **Slide Type:** Generated Title Slide
- **Estimated Duration:** 7 seconds
- **Title:** VT2: Verifiable Trading Technology
- **Subtitle:** Think. Verify. Trade. — Bitget AI Hackathon S2 (Track 1 Alpha Factory, Open Theme)
- **On-Screen Caption:** "VT2: Verifiable Trading Technology for Tokenized US Equity Perpetuals"
- **Spoken Text:**
  > "Welcome to VT2: Verifiable Trading Technology, built for the Bitget AI Hackathon S2 Alpha Factory track. VT2 is a deterministic, risk-budgeted trading system operating on Bitget tokenized US equity perpetuals in paper-only mode."
- **Footer:** "Paper trading only. No real orders. Mainnet blocked."

---

### Slide 2: Overview & Terminal
- **Slide Type:** Screenshot (`media/overview & terminal.png`)
- **Estimated Duration:** 20 seconds
- **Title:** Overview & Terminal: Live Market Feed & Risk Metrics
- **Visible Elements in Image:**
  - Live Bitget WebSocket badge: `ONLINE (Live)` with 519ms latency
  - Simulated equity: $9,999.85
  - Daily loss gauge: $0.15 used of $200.00 daily loss limit
  - Open positions quota: 1 / 1 max allowed
  - Interactive candlestick chart and live activity feed
  - Top market opportunity badge (COSTUSDT)
- **On-Screen Caption:** "Live Bitget WebSocket feed with sub-second latency, real-time risk gauges, and Kill Switch"
- **Spoken Text:**
  > "The VT2 terminal connects directly to Bitget public WebSocket feeds, showing live ticker data with 519 millisecond latency. The header displays simulated equity of 9,999 dollars, daily loss tracking under our 200 dollar budget, single-position cap, and an immediate Kill Switch."
- **Footer:** "Paper trading only. No real orders. Mainnet blocked."

---

### Slide 3: Market Scanner
- **Slide Type:** Screenshot (`media/Market scanner.png`)
- **Estimated Duration:** 20 seconds
- **Title:** Market Scanner: 24 Tokenized US Equity Perpetuals
- **Visible Elements in Image:**
  - Stocks (US) category active across 24 tokenized equity contracts
  - Qualified setups table: COSTUSDT, AMATUSDT, QCOMUSDT, QQQUSDT with Net R:R 1.5:1
  - Disqualified setups table: SNDKUSDT and RKLBUSDT rejected with explicit reasons (`RSI_OVERBOUGHT`)
  - Volume, spread, 24h change, and ATR indicators
- **On-Screen Caption:** "Multi-factor filtering across 24 tokenized stocks: ATR, volume, spread, and R:R threshold"
- **Spoken Text:**
  > "The Market Scanner evaluates 24 tokenized equity perpetuals using deterministic technical filters. Four contracts currently qualify with net reward-to-risk above 1.5, while disqualified symbols like SanDisk and Rocket Lab are rejected with explicit reasons like RSI overbought."
- **Footer:** "Paper trading only. No real orders. Mainnet blocked."

---

### Slide 4: Automated Trading
- **Slide Type:** Screenshot (`media/automated trading.png`)
- **Estimated Duration:** 20 seconds
- **Title:** Automated Trading: Deterministic Execution Loop
- **Visible Elements in Image:**
  - Bot status badge: `BOT: RUNNING`
  - Daily trades counter: 1 / 3 used
  - Position cap: 1 / 2 positions
  - Emergency Kill Switch button
  - Activity feed with TSLAUSDT auto-entry fill, bracket stop verification, and cycle evaluations
- **On-Screen Caption:** "Autonomous execution loop with strict daily trade quota, position caps, and instant vetoes"
- **Spoken Text:**
  > "The automated trader runs an autonomous 30-second evaluation loop. Here the bot is running, tracking 1 of 3 allowed daily trades. The activity feed documents a simulated market long fill on Tesla, verified stop loss, and continuous safety checks."
- **Footer:** "Paper trading only. No real orders. Mainnet blocked."

---

### Slide 5: Positions & Orders
- **Slide Type:** Screenshot (`media/positions & order.png`)
- **Estimated Duration:** 20 seconds
- **Title:** Positions & Orders: Real-Time Mark & Protective Controls
- **Visible Elements in Image:**
  - Active paper position: `paper-pos-8fe9e8bd` TSLAUSDT LONG at $383.7367
  - Mark price, quantity (0.26 TSLA), margin $19.95, unrealised PnL +$0.00
  - Protective simulation test controls (+1.2% spike, -0.8% drop)
  - Sentiment monitor: `SUPPORTIVE` (Bullish score 0.68)
- **On-Screen Caption:** "Active simulated position tracking with live mark price, bracket orders, and scenario injection"
- **Spoken Text:**
  > "The Positions tab tracks the active paper position on Tesla with real-time mark pricing, unrealised P and L, and bracket orders. Protective simulation controls allow testing sudden market spikes or drops, alongside live sentiment monitoring."
- **Footer:** "Paper trading only. No real orders. Mainnet blocked."

---

### Slide 6: Settings & Risk Engine
- **Slide Type:** Screenshot (`media/settings & risk.png`)
- **Estimated Duration:** 20 seconds
- **Title:** Settings & Risk Engine: Frozen Hard Boundaries
- **Visible Elements in Image:**
  - Trade allocation: 10%
  - Risk per trade: 0.005 (0.5% max risk)
  - Daily loss limit: 0.02 (2.0%)
  - Max concurrent positions: 1
  - Max consecutive losses: 3
  - Cooldown period: 30 minutes
  - Minimum Net R:R: 1.5, RVOL threshold: 1.5
- **On-Screen Caption:** "Strict risk budgeting: 0.5% risk per trade, 2% daily loss limit, 3-loss pause, 30m cooldown"
- **Spoken Text:**
  > "The Risk Engine enforces hard mathematical limits: half a percent risk per trade, a 2 percent daily loss cap, single position concurrency, and a 30-minute cooldown after 3 consecutive losses. Parameters are deterministic and cannot be bypassed."
- **Footer:** "Paper trading only. No real orders. Mainnet blocked."

---

### Slide 7: Alpha Factory Result
- **Slide Type:** Generated Backtest Metrics & Analysis Slide
- **Estimated Duration:** 35 seconds
- **Title:** Alpha Factory Backtest: Verifiable Out-of-Sample Performance
- **Exact Data from `reports/alpha-factory/metrics.json`:**
  - Total Trades: 287 | Win Rate: 41.11% | Profit Factor: 0.70
  - Net P&L: -$2,818.83 (-28.25% return on $10,000 starting equity)
  - In-Sample (IS): -$2,360.18 (-23.13%, 246 trades, Sharpe -4.15)
  - Out-of-Sample (OOS): -$458.65 (-6.66%, 41 trades, Sharpe -6.51)
  - Total Trading Friction Paid: $3,430.65 ($2,223.72 fees + $889.52 slippage + $317.42 funding)
  - SPY Buy-and-Hold Benchmark: +4.97% return (Max DD 5.21%)
  - Turnover: 258.47x portfolio equity
- **On-Screen Caption:** "Honest Alpha Factory Backtest: -28.25% return due to $3,430 friction drag across 287 trades"
- **Spoken Text:**
  > "Here is our honest Alpha Factory backtest across 287 trades. The strategy recorded a negative 28.25 percent return and Sharpe of minus 4.46, underperforming the S and P 500 benchmark. Traded friction was the dominant driver: over 3,400 dollars in fees and slippage from 258 times turnover erased gross edge. This rigorous, unfabricated reporting proves why real execution costs matter."
- **Footer:** "Paper trading only. No real orders. Mainnet blocked."

---

### Slide 8: Summary & Close
- **Slide Type:** Generated Closing Slide
- **Estimated Duration:** 12 seconds
- **Title:** Verifiable Trading Technology
- **Links & Resources:**
  - GitHub: `https://github.com/Solking-crpto/vt2-trading-bot`
  - Hosted Read-Only Demo: `https://vt2-trading-bot.vercel.app`
  - Deterministic Execution Engine + SQLite Audit Journal
- **On-Screen Caption:** "No language model makes trading decisions. Rules do. AI coding assistants helped build it."
- **Spoken Text:**
  > "VT2 proves verifiable, execution-aware systems with zero fabricated claims. Explore the full open-source codebase on GitHub and test the hosted read-only demo. Remember: No language model makes trading decisions. Rules do. AI coding assistants helped build it."
- **Footer:** "Paper trading only. No real orders. Mainnet blocked."
