# Tactical Intel Dashboard

Premier League tactical analytics dashboard built with React. Select any EPL team, pick a match, and view a full tactical breakdown — shot maps, possession momentum, intensity curves, press zones, and AI-generated tactical insights.

## Features

- **Team & Match Selector** — all 20 EPL teams, last 20 finished matches per team
- **Shot Map** — estimated shot positions on a canvas pitch with xG values
- **Press Zones & Danger Zones** — modelled from possession and formation data
- **15-Min Momentum Blocks** — possession splits interpolated per 15-min period
- **Intensity / Fatigue Curves** — modelled from possession shifts and substitution timing
- **Counter-Attack Log** — built from goal events and assist chains
- **Tactical Insights** — auto-generated per-team analysis (risks, edges, actions)
- **xG Shot Timeline** — bubble chart of all shots across 90 minutes
- **Dynamic Team Colors** — colors update based on the teams playing

## Data Sources

| Data | Source |
|------|--------|
| Score, goals, assists, cards, subs | football-data.org API (real) |
| Possession, shots, corners, fouls | football-data.org API (when available) |
| Lineups, formations | football-data.org API (when available) |
| Shot x/y positions, xG values | Estimated from shot zone models |
| 15-min possession splits | Interpolated from final possession % |
| Intensity/fatigue curves | Modelled from possession + substitutions |
| Press zones, danger zones | Modelled from possession dominance |

## Setup

1. Get a free API key from [football-data.org](https://www.football-data.org/client/register) (10 req/min)
2. Create a `.env` file in the project root:
   ```
   REACT_APP_FOOTBALL_API_KEY=your_token_here
   ```
3. Install and run:
   ```
   npm install
   npm start
   ```

## Tech Stack

- React 18 (CRA)
- Canvas API for pitch and chart visualizations
- football-data.org v4 API (free tier)
- No external chart libraries
