# ⚽ Tactical Intel Dashboard
**Wolves 2–2 Arsenal — 18 Feb 2026**

A real analyst-grade football tactical dashboard built with React.

---

## 📊 About the Data

### ✅ REAL data (from SportRadar API)
- Final score, possession %, total shots, cards
- Exact goal minutes: 5', 56' (Arsenal), 61', 90' (Wolves)
- Real starting lineups (all 22 players)
- Substitution minutes

### ⚠️ Estimated from stats
- Shot x/y positions (from typical shot zone models)
- xG values (from shot zone probability tables)
- 15-min possession splits (interpolated from 58/42 final)
- Player intensity/fatigue curve (modelled from possession pattern)
- Press zone positions (from tactical profiles)

---

## 🚀 How to Run Locally

### Step 1 — Install Node.js
Download from https://nodejs.org (choose "LTS" version)
Check it installed: open Terminal and run:
```
node --version
```
You should see something like `v18.x.x`

### Step 2 — Download this project
Unzip the project folder somewhere on your computer, e.g. your Desktop.

### Step 3 — Open Terminal in the project folder
**Mac:** Right-click the folder → "Open Terminal at Folder"
**Windows:** Inside the folder, click the address bar, type `cmd`, press Enter

### Step 4 — Install dependencies
```
npm install
```
Wait ~1 minute. This downloads React and all libraries.

### Step 5 — Start the app
```
npm start
```
Your browser will open automatically at http://localhost:3000
The dashboard is now running!

---

## 🔧 Customising

### Change the match data
All match data is at the top of `src/App.js`:
- `SHOTS` — add/edit shot events
- `BLOCKS` — change 15-min possession numbers
- `INTENSITY` — change the fatigue curve values
- `INSIGHTS` — update the tactical text

### Change teams/colours
Find the `C` object near the top of `App.js`:
```js
const C = {
  WOL: "#FDB913",   // Wolves gold
  ARS: "#EF0107",   // Arsenal red
  ...
}
```
Replace with any team's hex colour.

---

Built with React + Canvas API. No external chart libraries needed.
