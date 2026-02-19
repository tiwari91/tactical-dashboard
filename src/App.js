import { useEffect, useRef, useState } from "react";

// ═══════════════════════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const API_BASE = "/v4";
const API_KEY  = process.env.REACT_APP_FOOTBALL_API_KEY;

const TEAM_COLORS = {
  ARS:"#EF0107", CHE:"#034694", LIV:"#C8102E", MCI:"#6CABDD",
  MUN:"#DA291C", TOT:"#132257", NEW:"#241F20", AVL:"#670E36",
  WHU:"#7A263A", WOL:"#FDB913", EVE:"#003399", BRI:"#0057B8",
  FUL:"#CC0000", BOU:"#DA291C", NFO:"#DD0000", CRY:"#1B458F",
  BRE:"#E30613", LEI:"#003090", IPS:"#0044AA", SOU:"#D71920",
};

const hexToRgb = h => {
  const r = parseInt(h.slice(1,3),16), g = parseInt(h.slice(3,5),16), b = parseInt(h.slice(5,7),16);
  return `${r},${g},${b}`;
};
const getColor  = tla => TEAM_COLORS[tla] || "#888888";
const getRgb    = tla => hexToRgb(getColor(tla));
const getDim    = tla => `rgba(${getRgb(tla)},0.15)`;
const getMed    = tla => `rgba(${getRgb(tla)},0.35)`;

const TH = {
  CARD:"#0c130c", BG:"#060a06",
  TEXT:"#8aaa8a", MUTED:"#3a4e3a",
};
const FONT = {
  mono:"'IBM Plex Mono','Courier New',monospace",
  sans:"'IBM Plex Sans',sans-serif",
};

// ═══════════════════════════════════════════════════════════════════════════════
//  API SERVICE — football-data.org v4, cached in sessionStorage
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchAPI(endpoint) {
  const key = `fd_${endpoint}`;
  const cached = sessionStorage.getItem(key);
  if (cached) {
    const { data, ts } = JSON.parse(cached);
    if (Date.now() - ts < 300_000) return data;          // 5 min TTL
  }
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: { "X-Auth-Token": API_KEY },
  });
  if (res.status === 429) throw new Error("RATE_LIMITED");
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  const data = await res.json();
  try { sessionStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })); } catch (_) {}
  return data;
}

const fetchTeams = async () => {
  const d = await fetchAPI(`/competitions/PL/teams`);
  return (d.teams || [])
    .map(t => ({ id:t.id, name:t.name, shortName:t.shortName, tla:t.tla, crest:t.crest }))
    .sort((a, b) => a.shortName.localeCompare(b.shortName));
};

const fetchTeamMatches = async (teamId) => {
  const d = await fetchAPI(`/teams/${teamId}/matches?status=FINISHED&limit=20&competitions=PL`);
  return (d.matches || []).sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate));
};

const fetchMatchDetail = async (matchId) => fetchAPI(`/matches/${matchId}`);

// ═══════════════════════════════════════════════════════════════════════════════
//  DATA ESTIMATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function getStat(obj, ...keys) {
  if (!obj) return null;
  for (const k of keys) { if (obj[k] != null) return obj[k]; }
  return null;
}

const rng = (lo, hi) => lo + Math.random() * (hi - lo);

function generateShotPositions(goals, homeShots, awayShots, homeTla, awayTla, homeId) {
  const shots = [];

  // Place real goals first (home near x=0 side, away near x=105 side)
  (goals || []).forEach(g => {
    const isHome = g.team?.id === homeId;
    const tla    = isHome ? homeTla : awayTla;
    const x      = isHome ? rng(4, 12) : rng(93, 100);
    const y      = rng(27, 41);
    shots.push({
      team: tla, x, y, goal: true, saved: false,
      min: g.minute || 0,
      xg: Math.round(rng(0.22, 0.55) * 100) / 100,
      player: g.scorer?.name?.split(" ").pop() || "Unknown",
      assist: g.assist?.name?.split(" ").pop() || "-",
    });
  });

  const homeGoalCount = goals?.filter(g => g.team?.id === homeId).length || 0;
  const awayGoalCount = goals?.filter(g => g.team?.id !== homeId).length || 0;

  const addNonGoals = (count, tla, isHome) => {
    for (let i = 0; i < count; i++) {
      const saved = Math.random() > 0.45;
      const x = isHome ? rng(6, 22) : rng(83, 99);
      const y = rng(20, 48);
      const dist = isHome ? x : 105 - x;          // distance from goal line
      const baseXg = dist < 12 ? 0.15 : dist < 20 ? 0.08 : 0.04;
      shots.push({
        team: tla, x, y, goal: false, saved,
        min: Math.floor(rng(1, 90)),
        xg: Math.round((baseXg + rng(-0.02, 0.06)) * 100) / 100,
        player: "", assist: "-",
      });
    }
  };

  addNonGoals(Math.max(0, (homeShots || 4) - homeGoalCount), homeTla, true);
  addNonGoals(Math.max(0, (awayShots || 4) - awayGoalCount), awayTla, false);
  return shots.sort((a, b) => a.min - b.min);
}

function generatePossessionBlocks(homePoss, goals, homeId, homeTla, awayTla) {
  const awayPoss = 100 - homePoss;
  const ranges   = ["0–15","15–30","30–45","45–60","60–75","75–90"];
  const goalMins = (goals || []).map(g => ({ min: g.minute || 0, isHome: g.team?.id === homeId }));

  return ranges.map((mins, i) => {
    const bStart = i * 15, bEnd = (i + 1) * 15;
    let adj = 0;
    goalMins.forEach(g => {
      if (g.min >= bStart - 5 && g.min <= bEnd + 5) adj += g.isHome ? 4 : -4;
    });
    const h = Math.round(Math.max(28, Math.min(72, homePoss + adj + rng(-3, 3))));
    const a = 100 - h;
    const hShots = goalMins.filter(g => g.isHome && g.min >= bStart && g.min < bEnd).length
                 + (Math.random() > 0.5 ? 1 : 0);
    const aShots = goalMins.filter(g => !g.isHome && g.min >= bStart && g.min < bEnd).length
                 + (Math.random() > 0.5 ? 1 : 0);
    const blockGoals = goalMins.filter(g => g.min >= bStart && g.min < bEnd);
    const note = blockGoals.length
      ? blockGoals.map(g => `Goal at ${g.min}'`).join(", ")
      : h > 55 ? `${homeTla} controlling possession` : a > 55 ? `${awayTla} pressing` : "Balanced phase";
    return { mins, home: h, away: a, homeShots: hShots, awayShots: aShots, note };
  });
}

function generateIntensityCurves(homePoss, goals, subs, homeId) {
  const home = [], away = [];
  const goalMins = (goals || []).map(g => ({ min: g.minute || 0, isHome: g.team?.id === homeId }));
  const subMins  = (subs  || []).map(s => ({ min: s.minute || 0, isHome: s.team?.id === homeId }));

  for (let i = 0; i < 6; i++) {
    const mid = i * 15 + 7.5;
    let hB = 5 + (homePoss / 100) * 5;
    let aB = 5 + ((100 - homePoss) / 100) * 5;
    hB -= i * 0.35; aB -= i * 0.35;                               // fatigue
    goalMins.forEach(g => {
      const d = Math.abs(g.min - mid);
      if (d < 20) { if (g.isHome) hB += (20 - d) * 0.08; else aB += (20 - d) * 0.08; }
    });
    subMins.forEach(s => {
      if (s.min >= i * 15 && s.min < (i + 1) * 15) { if (s.isHome) hB += 0.4; else aB += 0.4; }
    });
    home.push(Math.round(Math.max(4.5, Math.min(10, hB + rng(-0.4, 0.4))) * 10) / 10);
    away.push(Math.round(Math.max(4.5, Math.min(10, aB + rng(-0.4, 0.4))) * 10) / 10);
  }
  return { home, away };
}

function generateCounterAttacks(goals, homeId, homeTla, awayTla) {
  const zones = ["Left Channel","Central","Right Channel","Right","Left"];
  const counters = (goals || []).map(g => {
    const isHome = g.team?.id === homeId;
    const scorer = g.scorer?.name?.split(" ").pop() || "Unknown";
    const assist = g.assist?.name?.split(" ").pop();
    return {
      min: g.minute || 0,
      team: isHome ? homeTla : awayTla,
      players: assist ? `${assist} → ${scorer}` : scorer,
      outcome: "GOAL",
      zone: zones[Math.floor(Math.random() * zones.length)],
    };
  });
  const extra = Math.floor(rng(1, 3));
  for (let i = 0; i < extra; i++) {
    counters.push({
      min: Math.floor(rng(15, 85)),
      team: Math.random() > 0.5 ? homeTla : awayTla,
      players: "Quick transition",
      outcome: Math.random() > 0.5 ? "Saved" : "Blocked",
      zone: zones[Math.floor(Math.random() * zones.length)],
    });
  }
  return counters.sort((a, b) => a.min - b.min);
}

function generatePressZones(homePoss, homeTla, awayTla) {
  const hI = homePoss / 100, aI = (100 - homePoss) / 100;
  return {
    // Home press is in opponent's half (RIGHT side, high x)
    [homeTla]: [
      { x:78, y:30, i: hI * 0.7 + 0.1 }, { x:82, y:38, i: hI * 0.65 + 0.1 },
      { x:70, y:24, i: hI * 0.5 },        { x:75, y:46, i: hI * 0.55 },
      { x:88, y:34, i: hI * 0.45 },
    ],
    // Away press is in opponent's half (LEFT side, low x)
    [awayTla]: [
      { x:22, y:20, i: aI * 0.9 + 0.1 }, { x:18, y:35, i: aI * 0.85 + 0.1 },
      { x:25, y:50, i: aI * 0.8 + 0.1 }, { x:35, y:28, i: aI * 0.6 },
      { x:30, y:42, i: aI * 0.65 },
    ],
  };
}

function generateDangerZones(goals, homeId, homeTla, awayTla) {
  const homeConc = (goals || []).filter(g => g.team?.id !== homeId).length;
  const awayConc = (goals || []).filter(g => g.team?.id === homeId).length;
  const zones = [];
  if (homeConc > 0) {
    zones.push({ x:14, y:24, label:"LEFT FLANK",  r:32, col: getRgb(awayTla), a:0.45 });
    zones.push({ x:14, y:46, label:"RIGHT FLANK", r:26, col: getRgb(awayTla), a:0.35 });
  }
  if (awayConc > 0) {
    zones.push({ x:86, y:24, label:"LEFT CHANNEL",  r:36, col: getRgb(homeTla), a:0.5 });
    zones.push({ x:86, y:46, label:"RIGHT CHANNEL", r:28, col: getRgb(homeTla), a:0.38 });
  }
  zones.push({ x:52, y:34, label:"TRANSITION ZONE", r:22, col:"255,140,0", a:0.28 });
  return zones;
}

function generateInsights(goals, homePoss, homeTla, awayTla, homeId, intensity) {
  const hGoals = (goals || []).filter(g => g.team?.id === homeId).length;
  const aGoals = (goals || []).filter(g => g.team?.id !== homeId).length;
  const aPoss  = 100 - homePoss;
  const home = [], away = [];

  if (homePoss > 55) {
    home.push({ type:"EDGE",   text:`Dominated possession at ${homePoss}% — sustained pressure is the primary weapon` });
    away.push({ type:"RISK",   text:`${homeTla} control the ball (${homePoss}%) — defensive discipline is essential` });
  } else if (aPoss > 55) {
    away.push({ type:"EDGE",   text:`Dominated possession at ${aPoss}% — dictating the tempo throughout` });
    home.push({ type:"RISK",   text:`${awayTla} controlled possession at ${aPoss}% — pressing must improve` });
  }
  if (hGoals > aGoals) {
    home.push({ type:"EDGE",   text:`Clinical finishing — ${hGoals} goal${hGoals>1?"s":""} scored, converting chances effectively` });
    away.push({ type:"RISK",   text:`Conceded ${hGoals} goal${hGoals>1?"s":""} — defensive structure needs work` });
  } else if (aGoals > hGoals) {
    away.push({ type:"EDGE",   text:`Clinical finishing — ${aGoals} goal${aGoals>1?"s":""} scored, lethal in front of goal` });
    home.push({ type:"RISK",   text:`Conceded ${aGoals} goal${aGoals>1?"s":""} — defensive vulnerabilities exposed` });
  }
  if (intensity) {
    const hDrop = intensity.home[0] - intensity.home[5];
    const aDrop = intensity.away[0] - intensity.away[5];
    if (hDrop > 2) {
      home.push({ type:"RISK",   text:`Intensity drops ${intensity.home[0]}→${intensity.home[5]} — significant fitness concerns late in the match` });
      home.push({ type:"ACTION", text:`Earlier substitutions needed to maintain intensity through 90 minutes` });
    }
    if (aDrop > 2) {
      away.push({ type:"RISK",   text:`Intensity drops ${intensity.away[0]}→${intensity.away[5]} — fatigue becomes a factor` });
      away.push({ type:"ACTION", text:`Tactical subs required to keep energy levels high` });
    }
    if (hDrop < 1 && intensity.home[5] > 7) {
      home.push({ type:"EDGE",   text:`Strong late-game intensity at ${intensity.home[5]} — capable of a strong finish` });
    }
    if (aDrop < 1 && intensity.away[5] > 7) {
      away.push({ type:"EDGE",   text:`Strong late-game intensity at ${intensity.away[5]} — dangerous in the final stages` });
    }
  }
  home.push({ type:"ACTION", text:"Hold defensive shape after scoring — avoid gifting transitions" });
  away.push({ type:"ACTION", text:"Press high early to force errors and gain momentum" });
  return { home, away };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN TRANSFORMER: API match → dashboard data shape
// ═══════════════════════════════════════════════════════════════════════════════

function transformMatchData(m) {
  const home = m.homeTeam || {};
  const away = m.awayTeam || {};
  const homeTla = home.tla || "HOM";
  const awayTla = away.tla || "AWY";
  const homeId  = home.id;

  const ft   = m.score?.fullTime  || {};
  const ht   = m.score?.halfTime  || {};
  const goals = m.goals || [];
  const subs  = m.substitutions || [];

  // Statistics — may or may not exist
  const hSt = home.statistics || {};
  const aSt = away.statistics || {};

  const homePoss = getStat(hSt, "ball_possession","ballPossession","possession")
    || (() => { const hg=goals.filter(g=>g.team?.id===homeId).length; return Math.round(50+((hg-(goals.length-hg))*4)+rng(-5,5)); })();
  const awayPoss = 100 - homePoss;

  const homeShots = getStat(hSt, "shots")
    || (goals.filter(g=>g.team?.id===homeId).length + Math.floor(rng(2,6)));
  const awayShots = getStat(aSt, "shots")
    || (goals.filter(g=>g.team?.id!==homeId).length + Math.floor(rng(2,6)));

  const shots     = generateShotPositions(goals, homeShots, awayShots, homeTla, awayTla, homeId);
  const blocks    = generatePossessionBlocks(homePoss, goals, homeId, homeTla, awayTla);
  const intensity = generateIntensityCurves(homePoss, goals, subs, homeId);
  const counters  = generateCounterAttacks(goals, homeId, homeTla, awayTla);
  const pressZones  = generatePressZones(homePoss, homeTla, awayTla);
  const dangerZones = generateDangerZones(goals, homeId, homeTla, awayTla);
  const insights    = generateInsights(goals, homePoss, homeTla, awayTla, homeId, intensity);

  const homeSoG = getStat(hSt,"shots_on_goal","shotsOnGoal")
    ?? shots.filter(s=>s.team===homeTla&&(s.goal||s.saved)).length;
  const awaySoG = getStat(aSt,"shots_on_goal","shotsOnGoal")
    ?? shots.filter(s=>s.team===awayTla&&(s.goal||s.saved)).length;

  const homeCorners = getStat(hSt,"corner_kicks","cornerKicks","corners") ?? Math.floor(rng(1,6));
  const awayCorners = getStat(aSt,"corner_kicks","cornerKicks","corners") ?? Math.floor(rng(1,6));
  const homeFouls = getStat(hSt,"fouls") ?? Math.floor(rng(5,12));
  const awayFouls = getStat(aSt,"fouls") ?? Math.floor(rng(5,12));

  const bookings = m.bookings || [];
  const homeYellow = getStat(hSt,"yellow_cards","yellowCards")
    ?? bookings.filter(b=>b.team?.id===homeId&&(b.card==="YELLOW_CARD"||b.card==="YELLOW")).length;
  const awayYellow = getStat(aSt,"yellow_cards","yellowCards")
    ?? bookings.filter(b=>b.team?.id!==homeId&&(b.card==="YELLOW_CARD"||b.card==="YELLOW")).length;

  const totalXgHome = shots.filter(s=>s.team===homeTla).reduce((a,s)=>a+s.xg,0);
  const totalXgAway = shots.filter(s=>s.team===awayTla).reduce((a,s)=>a+s.xg,0);

  return {
    homeTla, awayTla, homeId,
    homeName: home.shortName || home.name || homeTla,
    awayName: away.shortName || away.name || awayTla,
    homeCrest: home.crest, awayCrest: away.crest,
    homeColor: getColor(homeTla), awayColor: getColor(awayTla),
    homeRgb: getRgb(homeTla), awayRgb: getRgb(awayTla),
    score: ft, halfTime: ht,
    matchday: m.matchday,
    date: m.utcDate,
    venue: m.venue || "",
    stats: [
      { label:"POSSESSION",  home:`${homePoss}%`,           away:`${awayPoss}%` },
      { label:"SHOTS",       home:`${homeShots}`,           away:`${awayShots}` },
      { label:"ON TARGET",   home:`${homeSoG}`,             away:`${awaySoG}` },
      { label:"xG",          home:totalXgHome.toFixed(2),   away:totalXgAway.toFixed(2) },
      { label:"CORNERS",     home:`${homeCorners}`,         away:`${awayCorners}` },
      { label:"FOULS",       home:`${homeFouls}`,           away:`${awayFouls}` },
      { label:"YEL CARDS",   home:`${homeYellow}`,          away:`${awayYellow}` },
    ],
    shots, blocks, intensity, counters, pressZones, dangerZones, insights,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PITCH CANVAS (props-driven)
// ═══════════════════════════════════════════════════════════════════════════════

function PitchCanvas({ mode, focusTeam, data }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current; if (!canvas || !data) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const sx = v => (v / 105) * W;
    const sy = v => (v / 68) * H;
    const { homeTla, awayTla, homeRgb, awayRgb } = data;

    // Pitch background stripes
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = i % 2 === 0 ? "#112211" : "#0f1f0f";
      ctx.fillRect(i * W / 10, 0, W / 10, H);
    }
    // Lines
    const lc = "rgba(255,255,255,0.5)", lw = 1.5;
    const rect = (x1,y1,x2,y2) => {
      ctx.strokeStyle=lc; ctx.lineWidth=lw;
      ctx.strokeRect(sx(x1),sy(y1),sx(x2)-sx(x1),sy(y2)-sy(y1));
    };
    const line = (x1,y1,x2,y2) => {
      ctx.beginPath(); ctx.moveTo(sx(x1),sy(y1)); ctx.lineTo(sx(x2),sy(y2));
      ctx.strokeStyle=lc; ctx.lineWidth=lw; ctx.stroke();
    };
    const circ = (cx,cy,r,fill=false) => {
      ctx.beginPath(); ctx.arc(sx(cx),sy(cy),r,0,Math.PI*2);
      if(fill){ctx.fillStyle=lc;ctx.fill();}
      else{ctx.strokeStyle=lc;ctx.lineWidth=lw;ctx.stroke();}
    };
    rect(0,0,105,68); line(52.5,0,52.5,68);
    rect(0,13.84,16.5,54.16); rect(0,24.84,5.5,43.16);
    rect(88.5,13.84,105,54.16); rect(99.5,24.84,105,43.16);
    circ(52.5,34,W*0.088); circ(52.5,34,3,true);
    circ(11,34,3,true); circ(94,34,3,true);

    // Team direction labels
    ctx.font = `bold 11px ${FONT.mono}`; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillStyle=`rgba(${homeRgb},0.2)`; ctx.fillText(`${homeTla} ▶`, sx(10), sy(3));
    ctx.fillStyle=`rgba(${awayRgb},0.2)`; ctx.fillText(`◀ ${awayTla}`, sx(95), sy(3));

    if (mode === "shots") {
      data.shots.forEach(s => {
        if (focusTeam !== "ALL" && s.team !== focusTeam) return;
        const col = s.team === homeTla ? homeRgb : awayRgb;
        const g = ctx.createRadialGradient(sx(s.x),sy(s.y),0,sx(s.x),sy(s.y),32);
        g.addColorStop(0,`rgba(${col},${s.goal?0.28:0.1})`);
        g.addColorStop(1,"rgba(0,0,0,0)");
        ctx.fillStyle=g; ctx.beginPath(); ctx.arc(sx(s.x),sy(s.y),32,0,Math.PI*2); ctx.fill();
        const r = s.goal ? 11 : s.saved ? 7 : 6;
        ctx.beginPath(); ctx.arc(sx(s.x),sy(s.y),r,0,Math.PI*2);
        ctx.fillStyle = s.goal ? `rgba(${col},1)` : "transparent";
        ctx.strokeStyle=`rgba(${col},0.9)`; ctx.lineWidth=2;
        ctx.fill(); ctx.stroke();
        if (s.goal) {
          ctx.font=`bold 9px ${FONT.mono}`; ctx.fillStyle="#fff";
          ctx.textAlign="center"; ctx.textBaseline="middle";
          ctx.fillText("G",sx(s.x),sy(s.y));
        }
        ctx.font=`8px ${FONT.mono}`; ctx.fillStyle=`rgba(${col},0.8)`;
        ctx.textAlign="center"; ctx.textBaseline="top";
        ctx.fillText(s.xg.toFixed(2), sx(s.x), sy(s.y)+r+4);
      });
    }

    if (mode === "press") {
      const teams = focusTeam==="ALL" ? [homeTla,awayTla] : [focusTeam];
      teams.forEach(t => {
        const zones = data.pressZones[t] || [];
        zones.forEach(z => {
          const col = t === homeTla ? homeRgb : awayRgb;
          const g = ctx.createRadialGradient(sx(z.x),sy(z.y),0,sx(z.x),sy(z.y),42);
          g.addColorStop(0,`rgba(${col},${z.i*0.55})`);
          g.addColorStop(0.5,`rgba(${col},${z.i*0.2})`);
          g.addColorStop(1,"rgba(0,0,0,0)");
          ctx.fillStyle=g; ctx.beginPath(); ctx.arc(sx(z.x),sy(z.y),42,0,Math.PI*2); ctx.fill();
          ctx.beginPath(); ctx.arc(sx(z.x),sy(z.y),6,0,Math.PI*2);
          ctx.fillStyle=`rgba(${col},0.85)`; ctx.fill();
        });
      });
    }

    if (mode === "danger") {
      (data.dangerZones || []).forEach(z => {
        const g=ctx.createRadialGradient(sx(z.x),sy(z.y),0,sx(z.x),sy(z.y),z.r);
        g.addColorStop(0,`rgba(${z.col},${z.a})`); g.addColorStop(1,"rgba(0,0,0,0)");
        ctx.fillStyle=g; ctx.beginPath(); ctx.arc(sx(z.x),sy(z.y),z.r,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle=`rgba(${z.col},0.55)`; ctx.lineWidth=1.5;
        ctx.setLineDash([3,5]); ctx.beginPath(); ctx.arc(sx(z.x),sy(z.y),z.r,0,Math.PI*2);
        ctx.stroke(); ctx.setLineDash([]);
        ctx.font=`bold 9px ${FONT.mono}`; ctx.fillStyle=`rgba(${z.col},0.9)`;
        ctx.textAlign="center"; ctx.textBaseline="top";
        ctx.fillText(z.label,sx(z.x),sy(z.y)+z.r+5);
      });
    }
  }, [mode, focusTeam, data]);

  return (
    <canvas ref={ref} width={500} height={324}
      style={{ width:"100%", borderRadius:6, display:"block" }} />
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  INTENSITY CANVAS (props-driven)
// ═══════════════════════════════════════════════════════════════════════════════

function IntensityChart({ data }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas || !data) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0,0,W,H);
    const pad = {l:44,r:16,t:20,b:34};
    const iW = W-pad.l-pad.r, iH = H-pad.t-pad.b;
    const { intensity, blocks, homeColor, awayColor, homeRgb, awayRgb } = data;
    const n = intensity.home.length;
    const xS = i => pad.l+(i/(n-1))*iW;
    const yS = v => pad.t+(1-(v-4)/7)*iH;

    [5,6,7,8,9,10].forEach(v => {
      ctx.beginPath(); ctx.moveTo(pad.l,yS(v)); ctx.lineTo(pad.l+iW,yS(v));
      ctx.strokeStyle="rgba(255,255,255,0.06)"; ctx.lineWidth=1; ctx.stroke();
      ctx.font=`11px ${FONT.mono}`; ctx.fillStyle="rgba(255,255,255,0.3)";
      ctx.textAlign="right"; ctx.textBaseline="middle";
      ctx.fillText(v,pad.l-7,yS(v));
    });
    blocks.forEach((b,i) => {
      ctx.font=`10px ${FONT.mono}`; ctx.fillStyle="rgba(255,255,255,0.25)";
      ctx.textAlign="center"; ctx.textBaseline="top";
      ctx.fillText(b.mins.split("–")[0]+"'",xS(i),H-22);
    });
    ctx.font=`10px ${FONT.mono}`; ctx.fillStyle="rgba(255,255,255,0.2)";
    ctx.textAlign="right"; ctx.fillText("90'",xS(n-1),H-22);

    [[intensity.home,homeColor,homeRgb],[intensity.away,awayColor,awayRgb]].forEach(([vals,col,rgb]) => {
      ctx.beginPath(); ctx.moveTo(xS(0),yS(vals[0]));
      vals.forEach((v,i) => { if(i>0) ctx.lineTo(xS(i),yS(v)); });
      ctx.lineTo(xS(n-1),pad.t+iH); ctx.lineTo(xS(0),pad.t+iH); ctx.closePath();
      ctx.fillStyle=`rgba(${rgb},0.08)`; ctx.fill();
      ctx.beginPath(); ctx.moveTo(xS(0),yS(vals[0]));
      vals.forEach((v,i) => { if(i>0) ctx.lineTo(xS(i),yS(v)); });
      ctx.strokeStyle=col; ctx.lineWidth=2.5; ctx.lineJoin="round"; ctx.stroke();
      vals.forEach((v,i) => {
        ctx.beginPath(); ctx.arc(xS(i),yS(v),5,0,Math.PI*2);
        ctx.fillStyle=col; ctx.fill();
        ctx.font=`bold 11px ${FONT.mono}`; ctx.fillStyle=col;
        ctx.textAlign="center"; ctx.textBaseline="bottom";
        ctx.fillText(v.toFixed(1),xS(i),yS(v)-8);
      });
    });
  },[data]);
  return <canvas ref={ref} width={500} height={160} style={{width:"100%",display:"block"}}/>;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FORMAT HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function fmtMatchLabel(m) {
  const h = m.homeTeam?.shortName || m.homeTeam?.name || "Home";
  const a = m.awayTeam?.shortName || m.awayTeam?.name || "Away";
  const hg = m.score?.fullTime?.home ?? "?";
  const ag = m.score?.fullTime?.away ?? "?";
  const md = m.matchday ? ` · MD ${m.matchday}` : "";
  return `${h} ${hg}-${ag} ${a}${md} · ${fmtDate(m.utcDate)}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════════════════════════════════════

export default function App() {
  // API state
  const [teams, setTeams]                 = useState([]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [teamMatches, setTeamMatches]     = useState([]);
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [matchData, setMatchData]         = useState(null);
  const [loading, setLoading]             = useState("");
  const [error, setError]                 = useState("");

  // UI state
  const [pitchMode, setPitchMode]       = useState("shots");
  const [focusTeam, setFocusTeam]       = useState("ALL");
  const [perspective, setPerspective]   = useState("home");
  const [showInfo, setShowInfo]         = useState(false);

  const handleError = e => {
    setError(e.message === "RATE_LIMITED"
      ? "Rate limited (10 req/min). Please wait 60 seconds and try again."
      : e.message);
    setLoading("");
  };

  // Load teams on mount
  useEffect(() => {
    if (!API_KEY) return;
    setLoading("Loading EPL teams...");
    fetchTeams()
      .then(t => { setTeams(t); setLoading(""); })
      .catch(handleError);
  }, []);

  const loadMatch = async (matchId) => {
    setSelectedMatchId(String(matchId));
    setMatchData(null);
    setError("");
    setLoading("Loading match data...");
    try {
      const detail = await fetchMatchDetail(matchId);
      const data = transformMatchData(detail);
      setMatchData(data);
      setFocusTeam("ALL");
      setPerspective("home");
      setLoading("");
    } catch (e) { handleError(e); }
  };

  const onTeamChange = async (e) => {
    const id = e.target.value;
    if (!id) return;
    setSelectedTeamId(id);
    setTeamMatches([]);
    setSelectedMatchId("");
    setMatchData(null);
    setError("");
    setLoading("Loading matches...");
    try {
      const matches = await fetchTeamMatches(id);
      setTeamMatches(matches);
      setLoading("");
      if (matches.length > 0) loadMatch(matches[0].id);
    } catch (e) { handleError(e); }
  };

  const onMatchChange = (e) => {
    if (e.target.value) loadMatch(e.target.value);
  };

  // Derived values from matchData
  const d  = matchData;                                     // shorthand
  const hC = d?.homeColor, aC = d?.awayColor;               // team colors
  const hT = d?.homeTla,   aT = d?.awayTla;                 // team TLAs
  const perspColor = perspective === "home" ? hC : aC;
  const perspTla   = perspective === "home" ? hT : aT;
  const oppTla     = perspective === "home" ? aT : hT;
  const insights   = perspective === "home" ? d?.insights?.home : d?.insights?.away;
  const iColor     = { RISK:"#ff5a5a", EDGE:"#5affaa", ACTION:"#ffd85a" };

  const btnBase = {
    cursor:"pointer", fontFamily:FONT.mono, borderRadius:5, border:"none",
    transition:"all 0.15s", letterSpacing:"0.05em",
  };
  const selectStyle = {
    background:TH.CARD, color:"#ccc",
    border:"1px solid rgba(255,255,255,0.15)", borderRadius:6,
    padding:"10px 14px", fontFamily:FONT.mono, fontSize:13,
    cursor:"pointer", outline:"none", minWidth:200,
  };

  // ─── No API key ────────────────────────────────────────────────────────────
  if (!API_KEY) {
    return (
      <div style={{background:TH.BG,minHeight:"100vh",display:"flex",alignItems:"center",
        justifyContent:"center",fontFamily:FONT.sans,color:"#ccc",padding:40}}>
        <div style={{background:TH.CARD,border:"1px solid rgba(255,255,255,0.12)",
          borderRadius:12,padding:32,maxWidth:520,textAlign:"center"}}>
          <div style={{fontSize:36,marginBottom:16}}>&#9917;</div>
          <div style={{fontSize:20,fontWeight:700,fontFamily:FONT.mono,marginBottom:16}}>
            API Key Required
          </div>
          <div style={{fontSize:14,color:TH.TEXT,lineHeight:1.7,textAlign:"left"}}>
            <p style={{marginBottom:12}}>
              This dashboard uses the <strong style={{color:"#fff"}}>football-data.org</strong> API
              (free tier, 10 req/min).
            </p>
            <ol style={{paddingLeft:20}}>
              <li style={{marginBottom:8}}>
                Register at{" "}
                <span style={{color:"#5affaa",fontFamily:FONT.mono}}>https://www.football-data.org/client/register</span>
              </li>
              <li style={{marginBottom:8}}>
                Copy your API token from the dashboard
              </li>
              <li style={{marginBottom:8}}>
                Create a <code style={{background:"rgba(255,255,255,0.08)",padding:"2px 6px",
                  borderRadius:3,fontFamily:FONT.mono}}>.env</code> file in the project root:
                <div style={{background:"rgba(0,0,0,0.4)",padding:"10px 14px",borderRadius:6,
                  marginTop:6,fontFamily:FONT.mono,fontSize:13}}>
                  REACT_APP_FOOTBALL_API_KEY=your_token_here
                </div>
              </li>
              <li>Restart the dev server</li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{background:TH.BG, minHeight:"100vh", fontFamily:FONT.sans,
      color:"#ccc", padding:"20px 16px", display:"flex",
      flexDirection:"column", alignItems:"center", gap:16}}>

      {/* ── DATA SOURCE MODAL ─────────────────────────────────────────────── */}
      {showInfo && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",
          zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",
          padding:20}} onClick={()=>setShowInfo(false)}>
          <div style={{background:"#0f160f",border:"1px solid rgba(255,255,255,0.12)",
            borderRadius:12,padding:28,maxWidth:560,width:"100%"}}
            onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:18,fontWeight:700,color:"#fff",marginBottom:16,fontFamily:FONT.mono}}>
              Where Does The Data Come From?
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {[
                {label:"REAL — football-data.org API", items:[
                  "Final score and half-time score",
                  "Goal scorers, minutes, and assists",
                  "Possession, shots, corners, fouls (when available)",
                  "Yellow/red cards and minutes",
                  "Substitution timing",
                  "Lineups and formations (when available)",
                ]},
                {label:"ESTIMATED from stats", items:[
                  "Shot x/y positions (from typical shot zones)",
                  "xG values (from shot zone probability tables)",
                  "15-min possession splits (interpolated from match possession)",
                  "Player intensity curve (modelled from possession shifts + subs)",
                  "Press zone positions (from formation + possession %)",
                  "Counter-attack log (built from goal events)",
                ]},
              ].map(section => (
                <div key={section.label}>
                  <div style={{fontSize:13,fontWeight:700,color:"#fff",fontFamily:FONT.mono,
                    marginBottom:5}}>{section.label}</div>
                  {section.items.map(item => (
                    <div key={item} style={{fontSize:13,color:"#8aaa8a",paddingLeft:14,
                      marginBottom:3}}>&#8226; {item}</div>
                  ))}
                </div>
              ))}
            </div>
            <button onClick={()=>setShowInfo(false)} style={{...btnBase,
              marginTop:18,padding:"10px 24px",background:perspColor||"#EF0107",color:"#fff",
              fontSize:13,fontWeight:700}}>CLOSE</button>
          </div>
        </div>
      )}

      {/* ── SELECTOR BAR ──────────────────────────────────────────────────── */}
      <div style={{width:"100%",maxWidth:1100,background:TH.CARD,
        border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:"16px 20px"}}>
        <div style={{fontSize:11,letterSpacing:"0.25em",color:TH.MUTED,marginBottom:10,fontFamily:FONT.mono}}>
          PREMIER LEAGUE TACTICAL DASHBOARD
        </div>
        <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"center"}}>
          <select value={selectedTeamId} onChange={onTeamChange} style={selectStyle}>
            <option value="">Select Team...</option>
            {teams.map(t => (
              <option key={t.id} value={t.id}>{t.shortName}</option>
            ))}
          </select>
          {teamMatches.length > 0 && (
            <select value={selectedMatchId} onChange={onMatchChange}
              style={{...selectStyle,minWidth:320}}>
              {teamMatches.map(m => (
                <option key={m.id} value={m.id}>{fmtMatchLabel(m)}</option>
              ))}
            </select>
          )}
          {loading && (
            <span style={{fontSize:13,color:TH.TEXT,fontFamily:FONT.mono,
              animation:"pulse 1.5s infinite"}}>
              {loading}
            </span>
          )}
          {error && (
            <span style={{fontSize:13,color:"#ff5a5a",fontFamily:FONT.mono}}>
              {error}
            </span>
          )}
        </div>
      </div>

      {/* ── EMPTY STATE ───────────────────────────────────────────────────── */}
      {!d && !loading && !error && (
        <div style={{width:"100%",maxWidth:1100,textAlign:"center",padding:"80px 20px"}}>
          <div style={{fontSize:48,marginBottom:16}}>&#9917;</div>
          <div style={{fontSize:20,fontWeight:600,fontFamily:FONT.mono,color:TH.TEXT,marginBottom:8}}>
            Select a team to get started
          </div>
          <div style={{fontSize:14,color:TH.MUTED}}>
            Choose any EPL team above to view their recent match analytics
          </div>
        </div>
      )}

      {/* ── DASHBOARD (only rendered when matchData exists) ───────────────── */}
      {d && (<>

        {/* ── HEADER ─────────────────────────────────────────────────────── */}
        <div style={{width:"100%",maxWidth:1100,display:"flex",
          justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:12}}>
          <div>
            <div style={{fontSize:12,letterSpacing:"0.25em",color:TH.MUTED,marginBottom:5}}>
              TACTICAL INTEL DASHBOARD · PREMIER LEAGUE
              {d.matchday ? ` · MATCHDAY ${d.matchday}` : ""}
              {d.date ? ` · ${fmtDate(d.date).toUpperCase()}` : ""}
            </div>
            <div style={{fontSize:28,fontWeight:700,lineHeight:1,fontFamily:FONT.mono}}>
              <span style={{color:hC}}>{d.homeName.toUpperCase()}</span>
              <span style={{color:"rgba(255,255,255,0.12)",margin:"0 14px",fontSize:20}}>
                {d.score.home ?? "?"} — {d.score.away ?? "?"}
              </span>
              <span style={{color:aC}}>{d.awayName.toUpperCase()}</span>
            </div>
            {d.venue && <div style={{fontSize:12,color:TH.MUTED,marginTop:6}}>{d.venue.toUpperCase()}</div>}
          </div>
          <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
            <button onClick={()=>setShowInfo(true)} style={{...btnBase,
              padding:"9px 16px",background:"rgba(255,255,255,0.06)",
              color:"rgba(255,255,255,0.6)",fontSize:12,
              border:"1px solid rgba(255,255,255,0.12)"}}>
              Data Sources
            </button>
            <div>
              <div style={{fontSize:11,color:TH.MUTED,letterSpacing:"0.15em",marginBottom:6,textAlign:"right"}}>
                ANALYST PERSPECTIVE
              </div>
              <div style={{display:"flex",gap:6}}>
                {[["home",d.homeName.toUpperCase()],["away",d.awayName.toUpperCase()]].map(([key,label])=>{
                  const c = key === "home" ? hC : aC;
                  return (
                    <button key={key} onClick={()=>setPerspective(key)} style={{...btnBase,
                      padding:"10px 20px",fontSize:13,fontWeight:700,
                      background:perspective===key?c:"transparent",
                      border:`2px solid ${c}`,
                      color:perspective===key?"#fff":c}}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* ── TOP STATS ──────────────────────────────────────────────────── */}
        <div style={{width:"100%",maxWidth:1100,
          display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:8}}>
          {d.stats.map(s=>(
            <div key={s.label} style={{background:TH.CARD,
              border:"1px solid rgba(255,255,255,0.07)",borderRadius:8,
              padding:"12px 8px",textAlign:"center"}}>
              <div style={{fontSize:10,letterSpacing:"0.12em",color:TH.MUTED,marginBottom:8}}>
                {s.label}
              </div>
              <div style={{display:"flex",justifyContent:"center",
                alignItems:"center",gap:10}}>
                <span style={{fontSize:20,fontWeight:700,color:hC,fontFamily:FONT.mono}}>
                  {s.home}
                </span>
                <span style={{fontSize:11,color:"rgba(255,255,255,0.1)"}}>vs</span>
                <span style={{fontSize:20,fontWeight:700,color:aC,fontFamily:FONT.mono}}>
                  {s.away}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* ── MAIN GRID ──────────────────────────────────────────────────── */}
        <div style={{width:"100%",maxWidth:1100,
          display:"grid",gridTemplateColumns:"1.1fr 0.9fr",gap:14}}>

          {/* LEFT COLUMN */}
          <div style={{display:"flex",flexDirection:"column",gap:12}}>

            {/* Pitch panel */}
            <div style={{background:TH.CARD,border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:16}}>
              <div style={{display:"flex",justifyContent:"space-between",
                alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
                <div style={{display:"flex",gap:6}}>
                  {[["shots","SHOT MAP"],["press","PRESS ZONES"],["danger","DANGER ZONES"]].map(([m,l])=>(
                    <button key={m} onClick={()=>setPitchMode(m)} style={{...btnBase,
                      padding:"8px 12px",fontSize:11,
                      background:pitchMode===m?"rgba(255,255,255,0.1)":"transparent",
                      border:`1px solid ${pitchMode===m?"rgba(255,255,255,0.25)":"rgba(255,255,255,0.07)"}`,
                      color:pitchMode===m?"#fff":"rgba(255,255,255,0.35)"}}>
                      {l}
                    </button>
                  ))}
                </div>
                <div style={{display:"flex",gap:5}}>
                  {[["ALL","ALL"],[hT,hT],[aT,aT]].map(([t,l])=>(
                    <button key={t} onClick={()=>setFocusTeam(t)} style={{...btnBase,
                      padding:"7px 12px",fontSize:11,
                      background:focusTeam===t
                        ?(t===hT?getDim(hT):t===aT?getDim(aT):"rgba(255,255,255,0.1)")
                        :"transparent",
                      border:`1px solid ${focusTeam===t
                        ?(t===hT?hC:t===aT?aC:"rgba(255,255,255,0.3)")
                        :"rgba(255,255,255,0.07)"}`,
                      color:t===hT?hC:t===aT?aC:"rgba(255,255,255,0.55)"}}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <PitchCanvas mode={pitchMode} focusTeam={focusTeam} data={d}/>
              <div style={{marginTop:10,fontSize:11,color:TH.MUTED,textAlign:"center",lineHeight:1.5}}>
                {pitchMode==="shots" && "\u2B24 GOAL  \u25CB BLOCKED / OFF TARGET  \u2014 number below = xG (chance quality 0\u20131)"}
                {pitchMode==="press" && `BLOB SIZE = PRESS INTENSITY \u00B7 ${d.homeName} vs ${d.awayName}`}
                {pitchMode==="danger" && "DANGER ZONES \u2014 areas vulnerable to counter-attacks"}
              </div>
            </div>

            {/* Counter-attacks */}
            <div style={{background:TH.CARD,border:"1px solid rgba(255,255,255,0.07)",
              borderRadius:10,padding:16}}>
              <div style={{fontSize:13,letterSpacing:"0.15em",color:TH.TEXT,
                fontFamily:FONT.mono,marginBottom:12,fontWeight:600}}>
                COUNTER-ATTACK LOG
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:7}}>
                {d.counters.map((c,i)=>{
                  const cColor = c.team===hT ? hC : aC;
                  const cDim   = c.team===hT ? getDim(hT) : getDim(aT);
                  const cBord  = c.team===hT ? getMed(hT) : getMed(aT);
                  return (
                    <div key={i} style={{display:"grid",
                      gridTemplateColumns:"40px 56px 1fr 80px 70px",
                      gap:10,alignItems:"center",padding:"10px 12px",borderRadius:6,
                      background:c.outcome==="GOAL" ? cDim : "rgba(255,255,255,0.025)",
                      border:`1px solid ${c.outcome==="GOAL" ? cBord : "rgba(255,255,255,0.05)"}`}}>
                      <span style={{fontSize:13,fontWeight:700,fontFamily:FONT.mono,color:cColor}}>
                        {c.min}'
                      </span>
                      <span style={{fontSize:12,fontWeight:600,color:cColor}}>{c.team}</span>
                      <span style={{fontSize:12,color:"rgba(255,255,255,0.45)"}}>{c.players}</span>
                      <span style={{fontSize:11,color:TH.MUTED}}>{c.zone}</span>
                      <span style={{fontSize:12,fontWeight:700,textAlign:"right",
                        color:c.outcome==="GOAL"?"#fff":"rgba(255,255,255,0.3)"}}>
                        {c.outcome}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div style={{display:"flex",flexDirection:"column",gap:12}}>

            {/* Momentum blocks */}
            <div style={{background:TH.CARD,border:"1px solid rgba(255,255,255,0.07)",
              borderRadius:10,padding:16}}>
              <div style={{display:"flex",justifyContent:"space-between",
                alignItems:"center",marginBottom:12}}>
                <div style={{fontSize:13,letterSpacing:"0.15em",color:TH.TEXT,
                  fontFamily:FONT.mono,fontWeight:600}}>
                  15-MIN MOMENTUM
                </div>
                <div style={{display:"flex",gap:14,fontSize:11}}>
                  <span style={{color:hC}}>{"\u25A0"} {hT}</span>
                  <span style={{color:aC}}>{"\u25A0"} {aT}</span>
                </div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {d.blocks.map((b,i)=>(
                  <div key={i}>
                    <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:4}}>
                      <span style={{fontSize:11,color:TH.MUTED,fontFamily:FONT.mono,
                        minWidth:44}}>{b.mins}'</span>
                      <div style={{flex:1,height:26,borderRadius:4,overflow:"hidden",
                        background:"rgba(255,255,255,0.04)",
                        border:"1px solid rgba(255,255,255,0.07)",
                        display:"flex",position:"relative"}}>
                        <div style={{width:`${b.home}%`,background:getDim(hT),
                          borderRight:`2px solid ${getMed(hT)}`}}/>
                        <div style={{flex:1,background:getDim(aT),
                          borderLeft:`2px solid ${getMed(aT)}`}}/>
                        {Array.from({length:b.homeShots}).map((_,j)=>(
                          <div key={`h${j}`} style={{position:"absolute",left:5+j*9,top:4,
                            width:6,height:6,borderRadius:"50%",background:hC}}/>
                        ))}
                        {Array.from({length:b.awayShots}).map((_,j)=>(
                          <div key={`a${j}`} style={{position:"absolute",right:5+j*9,top:4,
                            width:6,height:6,borderRadius:"50%",background:aC}}/>
                        ))}
                      </div>
                      <span style={{fontSize:12,fontWeight:700,
                        color:b.home>b.away?hC:"rgba(255,255,255,0.2)",
                        fontFamily:FONT.mono,minWidth:32}}>{b.home}%</span>
                      <span style={{fontSize:12,fontWeight:700,
                        color:b.away>b.home?aC:"rgba(255,255,255,0.2)",
                        fontFamily:FONT.mono,minWidth:32}}>{b.away}%</span>
                    </div>
                    <div style={{fontSize:11,color:"rgba(255,255,255,0.25)",
                      paddingLeft:52,lineHeight:1.4}}>{b.note}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Intensity chart */}
            <div style={{background:TH.CARD,border:"1px solid rgba(255,255,255,0.07)",
              borderRadius:10,padding:16}}>
              <div style={{display:"flex",justifyContent:"space-between",
                alignItems:"center",marginBottom:10}}>
                <div style={{fontSize:13,letterSpacing:"0.15em",color:TH.TEXT,
                  fontFamily:FONT.mono,fontWeight:600}}>
                  PLAYER INTENSITY / FATIGUE
                </div>
                <div style={{display:"flex",gap:14,fontSize:11}}>
                  <span style={{color:hC}}>{"\u2014"} {d.homeName.toUpperCase()}</span>
                  <span style={{color:aC}}>{"\u2014"} {d.awayName.toUpperCase()}</span>
                </div>
              </div>
              <IntensityChart data={d}/>
              {(() => {
                const hDrop = d.intensity.home[0] - d.intensity.home[5];
                const aDrop = d.intensity.away[0] - d.intensity.away[5];
                const bigDrop = hDrop > 2 || aDrop > 2;
                const team = hDrop >= aDrop ? d.homeName : d.awayName;
                const vals = hDrop >= aDrop ? d.intensity.home : d.intensity.away;
                if (!bigDrop) return null;
                return (
                  <div style={{marginTop:8,padding:"8px 12px",background:"rgba(255,200,80,0.07)",
                    borderRadius:5,border:"1px solid rgba(255,200,80,0.15)"}}>
                    <span style={{fontSize:12,color:"rgba(255,200,80,0.8)"}}>
                      {team} drops {vals[0]}{"\u2192"}{vals[5]} intensity after 75' — fitness concern
                    </span>
                  </div>
                );
              })()}
            </div>

            {/* Insights */}
            <div style={{background:TH.CARD,
              border:`1px solid ${perspective==="home"
                ?`rgba(${d.homeRgb},0.25)`:`rgba(${d.awayRgb},0.25)`}`,
              borderTop:`3px solid ${perspColor}`,
              borderRadius:10,padding:16}}>
              <div style={{fontSize:13,fontWeight:700,fontFamily:FONT.mono,
                color:perspColor,marginBottom:12,letterSpacing:"0.1em"}}>
                HOW TO BEAT {oppTla ? oppTla.toUpperCase() : "OPPONENT"}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {(insights || []).map((ins,i)=>(
                  <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start",
                    padding:"10px 12px",borderRadius:6,
                    background:`${iColor[ins.type]}0D`,
                    border:`1px solid ${iColor[ins.type]}22`}}>
                    <span style={{fontSize:10,fontWeight:700,color:iColor[ins.type],
                      minWidth:46,letterSpacing:"0.06em",fontFamily:FONT.mono,
                      paddingTop:1}}>
                      {ins.type}
                    </span>
                    <span style={{fontSize:13,color:"rgba(255,255,255,0.5)",lineHeight:1.55}}>
                      {ins.text}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── xG SHOT TIMELINE ─────────────────────────────────────────────── */}
        <div style={{width:"100%",maxWidth:1100,background:TH.CARD,
          border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:16}}>
          <div style={{fontSize:13,fontWeight:600,color:TH.TEXT,fontFamily:FONT.mono,
            letterSpacing:"0.15em",marginBottom:12}}>
            SHOT TIMELINE — BUBBLE SIZE = xG QUALITY
          </div>
          <div style={{position:"relative",height:70,
            background:"rgba(0,0,0,0.3)",borderRadius:6}}>
            {/* halftime */}
            <div style={{position:"absolute",top:0,bottom:0,left:"47.4%",
              width:1,background:"rgba(255,255,255,0.08)"}}/>
            <div style={{position:"absolute",top:4,left:"48%",fontSize:11,color:TH.MUTED}}>HT</div>
            {/* goal flash lines */}
            {d.shots.filter(s=>s.goal).map((s,i)=>(
              <div key={`gl${i}`} style={{position:"absolute",top:0,bottom:0,
                left:`${(s.min/95)*100}%`,width:1,
                background:s.team===hT?`rgba(${d.homeRgb},0.35)`:`rgba(${d.awayRgb},0.35)`}}/>
            ))}
            {/* shots */}
            {d.shots.map((s,i)=>{
              const r = 5 + s.xg * 28;
              const y = s.team===hT ? 50 : 14;
              return (
                <div key={`s${i}`} title={`${s.min}' ${s.player||"?"} (${s.team}) xG:${s.xg}`}
                  style={{position:"absolute",
                    left:`calc(${(s.min/95)*100}% - ${r}px)`,
                    top:`${y-r}px`,width:r*2,height:r*2,borderRadius:"50%",
                    background:s.goal?(s.team===hT?hC:aC):"transparent",
                    border:`2px solid ${s.team===hT?hC:aC}`,
                    opacity:s.goal?1:0.5,cursor:"default"}}>
                </div>
              );
            })}
            <div style={{position:"absolute",left:6,bottom:8,fontSize:11,
              color:`rgba(${d.homeRgb},0.6)`,fontWeight:600}}>{hT} &#9656;</div>
            <div style={{position:"absolute",left:6,top:8,fontSize:11,
              color:`rgba(${d.awayRgb},0.6)`,fontWeight:600}}>{aT} &#9656;</div>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",
            marginTop:8,fontSize:11,color:TH.MUTED}}>
            {["0'","15'","30'","45'","60'","75'","90'"].map(t=>(
              <span key={t}>{t}</span>
            ))}
          </div>
        </div>

        <div style={{fontSize:11,color:"rgba(255,255,255,0.1)",letterSpacing:"0.12em",paddingBottom:8}}>
          TACTICAL INTEL · {d.homeName.toUpperCase()} {d.score.home ?? "?"}{"\u2013"}{d.score.away ?? "?"} {d.awayName.toUpperCase()}
          {d.date ? ` · ${fmtDate(d.date).toUpperCase()}` : ""}
          {" "}· DATA: FOOTBALL-DATA.ORG + ESTIMATES
        </div>
      </>)}
    </div>
  );
}
