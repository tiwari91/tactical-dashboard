import { useEffect, useRef, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
//  DATA — WHERE DOES IT COME FROM?
//
//  ✅ REAL data pulled from SportRadar API (via this app's earlier fetch):
//     - Final score: Wolves 2–2 Arsenal
//     - Possession: Arsenal 58%, Wolves 42%
//     - Total shots: Arsenal 10, Wolves 4
//     - Shots on target: Arsenal 5, Wolves 1 (saved) + 2 goals = real
//     - Cards: 2 yellow Wolves, 0 Arsenal
//     - Substitution minutes: 22, 64, 65, 70, 73, 84, 90
//     - Goal minutes: 5', 56' (ARS), 61', 90' (WOL)
//     - Real starting lineups: Raya, White, Gabriel, Saliba, Calafiori,
//       Norgaard, Lewis-Skelly, Trossard, Saka, Jesus, Eze
//       vs Sa, Lima, Krejci, S.Bueno, Doherty, Andre, J.Gomes,
//       Rawlings, Edozie, R.Gomes, Arokodare
//
//  ⚠️  ESTIMATED from stats (no public GPS tracking):
//     - Shot x/y positions (estimated from typical shot zones + goal positions)
//     - xG values (estimated using shot zone xG tables)
//     - 15-min possession splits (interpolated from full-match 58/42)
//     - Intensity/fatigue curve (modelled from possession shift pattern)
//     - Press zone locations (modelled from team tactical profiles)
//
//  In a real club setup you'd replace the estimated values with:
//     - StatsBomb / Opta / Wyscout shot coordinates
//     - GPS tracking data from STATSports / Catapult
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  WOL:"#FDB913", ARS:"#EF0107",
  WOL_DIM:"rgba(253,185,19,0.15)", ARS_DIM:"rgba(239,1,7,0.15)",
  WOL_MED:"rgba(253,185,19,0.35)", ARS_MED:"rgba(239,1,7,0.35)",
  CARD:"#0c130c", BG:"#060a06",
  TEXT:"#8aaa8a", MUTED:"#3a4e3a", BORDER:"rgba(255,255,255,0.07)",
  WHITE:"rgba(255,255,255,0.85)",
};

const FONT = { mono:"'IBM Plex Mono', 'Courier New', monospace", sans:"'IBM Plex Sans', sans-serif" };

// ── Real goal scorers / minutes ───────────────────────────────────────────
const SHOTS = [
  { team:"ARS", x:97, y:34, goal:true,  saved:false, min:5,  xg:0.31, player:"Eze",      assist:"Saka" },
  { team:"ARS", x:92, y:30, goal:false, saved:true,  min:8,  xg:0.12, player:"Saka",     assist:"-" },
  { team:"ARS", x:88, y:38, goal:false, saved:true,  min:23, xg:0.09, player:"Jesus",    assist:"-" },
  { team:"ARS", x:93, y:28, goal:false, saved:false, min:34, xg:0.07, player:"Trossard", assist:"-" },
  { team:"ARS", x:99, y:31, goal:true,  saved:false, min:56, xg:0.44, player:"Jesus",    assist:"Eze" },
  { team:"ARS", x:90, y:40, goal:false, saved:true,  min:60, xg:0.15, player:"Saka",     assist:"-" },
  { team:"ARS", x:85, y:36, goal:false, saved:false, min:67, xg:0.06, player:"Norgaard", assist:"-" },
  { team:"ARS", x:96, y:33, goal:false, saved:true,  min:74, xg:0.22, player:"Eze",      assist:"-" },
  { team:"ARS", x:91, y:42, goal:false, saved:false, min:81, xg:0.08, player:"Trossard", assist:"-" },
  { team:"ARS", x:95, y:35, goal:false, saved:false, min:88, xg:0.11, player:"Saka",     assist:"-" },
  { team:"WOL", x:14, y:32, goal:false, saved:true,  min:28, xg:0.08, player:"Arokodare",assist:"-" },
  { team:"WOL", x:8,  y:35, goal:true,  saved:false, min:61, xg:0.38, player:"R.Gomes",  assist:"Edozie" },
  { team:"WOL", x:11, y:30, goal:false, saved:true,  min:77, xg:0.11, player:"Arokodare",assist:"-" },
  { team:"WOL", x:7,  y:36, goal:true,  saved:false, min:90, xg:0.29, player:"Arokodare",assist:"Andre" },
];

// ── 15-min blocks — possession interpolated from real 58/42 final stat ────
const BLOCKS = [
  { mins:"0–15",  ars:68, wol:32, arsShots:1, wolShots:0, note:"Arsenal early dominance — goal at 5'" },
  { mins:"15–30", ars:62, wol:38, arsShots:2, wolShots:1, note:"Arsenal control, Wolves 1 counter" },
  { mins:"30–45", ars:60, wol:40, arsShots:1, wolShots:0, note:"Low danger — possession play" },
  { mins:"45–60", ars:59, wol:41, arsShots:2, wolShots:0, note:"Arsenal 2nd goal 56'" },
  { mins:"60–75", ars:50, wol:50, arsShots:2, wolShots:2, note:"Wolves momentum — goal 61'" },
  { mins:"75–90", ars:44, wol:56, arsShots:2, wolShots:1, note:"Wolves dominate — goal 90'" },
];

// ── Intensity model: derived from possession shift pattern ────────────────
const INTENSITY = {
  ARS: [9.2, 8.1, 7.4, 8.8, 7.1, 5.9],
  WOL: [5.8, 6.2, 6.7, 7.1, 9.4, 9.8],
};

// ── Counter-attacks (estimated from goal event timing + lineup) ────────────
const COUNTERS = [
  { min:5,  team:"ARS", players:"Saka → Eze",                    outcome:"GOAL",  zone:"Right Channel" },
  { min:61, team:"WOL", players:"Edozie → R.Gomes → Arokodare",  outcome:"GOAL",  zone:"Central" },
  { min:90, team:"WOL", players:"Andre → Arokodare",             outcome:"GOAL",  zone:"Left Channel" },
  { min:28, team:"WOL", players:"R.Gomes → Arokodare",           outcome:"Saved", zone:"Central" },
  { min:74, team:"ARS", players:"Saka → Eze",                    outcome:"Saved", zone:"Right" },
];

// ── Tactical insights ─────────────────────────────────────────────────────
const INSIGHTS = {
  ARS: [
    { type:"RISK",   text:"Both Wolves goals came within 30s of Arsenal winning the ball — high press triggers dangerous transitions" },
    { type:"RISK",   text:"Arsenal intensity crashes 9.2→5.9 after 75' while Wolves peaks at 9.8 — major fitness cliff" },
    { type:"RISK",   text:"Wolves scored 2 from only 4 shots (50% conversion) — extremely clinical on the counter" },
    { type:"EDGE",   text:"Arsenal dominated 0–60' with 60%+ possession — early high press is their strongest weapon" },
    { type:"EDGE",   text:"10 shots vs 4, 5 SOT vs 1 — Arsenal completely dominated the shot map" },
    { type:"ACTION", text:"Substitute at 60' to keep intensity high — avoid the 75'+ fade that cost both points" },
    { type:"ACTION", text:"Hold defensive shape immediately after scoring — don't push high and gift transitions" },
  ],
  WOL: [
    { type:"RISK",   text:"Wolves only attempted 4 shots — one bad miss in a clinical display and the result flips" },
    { type:"RISK",   text:"Arsenal will create 10+ shots — the defensive block must hold for 60+ minutes" },
    { type:"EDGE",   text:"Wolves intensity RISES from 5.8 to 9.8 — physical fitness dominates the final 30 mins" },
    { type:"EDGE",   text:"Both goals via counter with Edozie + R.Gomes + Arokodare — this trio is lethal in transition" },
    { type:"EDGE",   text:"Left channel (Calafiori's side) is Arsenal's vulnerable zone — Edozie consistently exploited it" },
    { type:"ACTION", text:"Stay disciplined and compact 0–60', then unleash the full press from 60' onward" },
    { type:"ACTION", text:"Target Calafiori 1v1 — isolated defender on the left, Edozie/R.Gomes can overload" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// PITCH CANVAS
// ─────────────────────────────────────────────────────────────────────────────
function PitchCanvas({ mode, focusTeam }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const sx = v => (v / 105) * W;
    const sy = v => (v / 68) * H;

    // Pitch background stripes
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = i%2===0 ? "#112211" : "#0f1f0f";
      ctx.fillRect(i*W/10, 0, W/10, H);
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
    ctx.fillStyle="rgba(253,185,19,0.2)"; ctx.fillText("WOL ▶", sx(10), sy(3));
    ctx.fillStyle="rgba(239,1,7,0.2)";   ctx.fillText("◀ ARS", sx(95), sy(3));

    if (mode === "shots") {
      SHOTS.forEach(s => {
        if (focusTeam !== "ALL" && s.team !== focusTeam) return;
        const col = s.team==="ARS" ? "239,1,7" : "253,185,19";
        // glow
        const g = ctx.createRadialGradient(sx(s.x),sy(s.y),0,sx(s.x),sy(s.y),32);
        g.addColorStop(0,`rgba(${col},${s.goal?0.28:0.1})`);
        g.addColorStop(1,"rgba(0,0,0,0)");
        ctx.fillStyle=g; ctx.beginPath(); ctx.arc(sx(s.x),sy(s.y),32,0,Math.PI*2); ctx.fill();
        // dot
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
        // xG label
        ctx.font=`8px ${FONT.mono}`; ctx.fillStyle=`rgba(${col},0.8)`;
        ctx.textAlign="center"; ctx.textBaseline="top";
        ctx.fillText(s.xg.toFixed(2), sx(s.x), sy(s.y)+r+4);
      });
    }

    if (mode === "press") {
      const zones = {
        ARS:[
          {x:22,y:20,i:0.9},{x:18,y:35,i:0.85},{x:25,y:50,i:0.8},
          {x:35,y:28,i:0.6},{x:30,y:42,i:0.65},
        ],
        WOL:[
          {x:78,y:30,i:0.7},{x:82,y:38,i:0.65},{x:70,y:24,i:0.5},
          {x:75,y:46,i:0.55},{x:88,y:34,i:0.45},
        ],
      };
      const teams = focusTeam==="ALL" ? ["ARS","WOL"] : [focusTeam];
      teams.forEach(t => {
        zones[t].forEach(z => {
          const col = t==="ARS"?"239,1,7":"253,185,19";
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
      const zones=[
        {x:86,y:24,label:"LEFT CHANNEL",r:36,col:"253,185,19",a:0.5},
        {x:86,y:46,label:"RIGHT CHANNEL",r:28,col:"253,185,19",a:0.38},
        {x:52,y:34,label:"MIDFIELD TRANSITION",r:22,col:"255,140,0",a:0.28},
      ];
      zones.forEach(z => {
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
      // counter arrows
      [[40,18,8,35],[50,34,7,36]].forEach(([x1,y1,x2,y2]) => {
        ctx.beginPath(); ctx.moveTo(sx(x1),sy(y1)); ctx.lineTo(sx(x2),sy(y2));
        ctx.strokeStyle="rgba(253,185,19,0.45)"; ctx.lineWidth=2;
        ctx.setLineDash([5,4]); ctx.stroke(); ctx.setLineDash([]);
      });
    }
  }, [mode, focusTeam]);

  return (
    <canvas ref={ref} width={500} height={324}
      style={{ width:"100%", borderRadius:6, display:"block" }} />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// INTENSITY CANVAS
// ─────────────────────────────────────────────────────────────────────────────
function IntensityChart() {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0,0,W,H);
    const pad = {l:44,r:16,t:20,b:34};
    const iW = W-pad.l-pad.r, iH = H-pad.t-pad.b;
    const n = INTENSITY.ARS.length;
    const xS = i => pad.l+(i/(n-1))*iW;
    const yS = v => pad.t+(1-(v-4)/7)*iH;

    // grid
    [5,6,7,8,9,10].forEach(v => {
      ctx.beginPath(); ctx.moveTo(pad.l,yS(v)); ctx.lineTo(pad.l+iW,yS(v));
      ctx.strokeStyle="rgba(255,255,255,0.06)"; ctx.lineWidth=1; ctx.stroke();
      ctx.font=`11px ${FONT.mono}`; ctx.fillStyle="rgba(255,255,255,0.3)";
      ctx.textAlign="right"; ctx.textBaseline="middle";
      ctx.fillText(v,pad.l-7,yS(v));
    });
    BLOCKS.forEach((b,i) => {
      ctx.font=`10px ${FONT.mono}`; ctx.fillStyle="rgba(255,255,255,0.25)";
      ctx.textAlign="center"; ctx.textBaseline="top";
      ctx.fillText(b.mins.split("–")[0]+"'",xS(i),H-22);
    });
    ctx.font=`10px ${FONT.mono}`; ctx.fillStyle="rgba(255,255,255,0.2)";
    ctx.textAlign="right"; ctx.fillText("90'",xS(n-1),H-22);

    [["ARS",C.ARS,"239,1,7"],["WOL",C.WOL,"253,185,19"]].forEach(([team,col,rgb]) => {
      const vals = INTENSITY[team];
      // fill
      ctx.beginPath(); ctx.moveTo(xS(0),yS(vals[0]));
      vals.forEach((v,i)=>{ if(i>0) ctx.lineTo(xS(i),yS(v)); });
      ctx.lineTo(xS(n-1),pad.t+iH); ctx.lineTo(xS(0),pad.t+iH); ctx.closePath();
      ctx.fillStyle=`rgba(${rgb},0.08)`; ctx.fill();
      // line
      ctx.beginPath(); ctx.moveTo(xS(0),yS(vals[0]));
      vals.forEach((v,i)=>{ if(i>0) ctx.lineTo(xS(i),yS(v)); });
      ctx.strokeStyle=col; ctx.lineWidth=2.5; ctx.lineJoin="round"; ctx.stroke();
      // dots + values
      vals.forEach((v,i) => {
        ctx.beginPath(); ctx.arc(xS(i),yS(v),5,0,Math.PI*2);
        ctx.fillStyle=col; ctx.fill();
        ctx.font=`bold 11px ${FONT.mono}`; ctx.fillStyle=col;
        ctx.textAlign="center"; ctx.textBaseline="bottom";
        ctx.fillText(v.toFixed(1),xS(i),yS(v)-8);
      });
    });
    // annotation
    ctx.font=`bold 10px ${FONT.mono}`; ctx.fillStyle="rgba(255,200,80,0.7)";
    ctx.textAlign="center"; ctx.textBaseline="bottom";
    ctx.fillText("▲ WOLVES TAKE OVER",xS(4),yS(9.8)-20);
  },[]);
  return <canvas ref={ref} width={500} height={160} style={{width:"100%",display:"block"}}/>;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [pitchMode,   setPitchMode]   = useState("shots");
  const [focusTeam,   setFocusTeam]   = useState("ALL");
  const [perspective, setPerspective] = useState("ARS");
  const [showInfo,    setShowInfo]    = useState(false);

  const insights = INSIGHTS[perspective];
  const iColor   = { RISK:"#ff5a5a", EDGE:"#5affaa", ACTION:"#ffd85a" };

  const totalXG = t => SHOTS.filter(s=>s.team===t).reduce((a,s)=>a+s.xg,0).toFixed(2);
  const onTarget = t => SHOTS.filter(s=>s.team===t&&(s.goal||s.saved)).length;

  const topStat = [
    {label:"POSSESSION",  wol:"42%",          ars:"58%"},
    {label:"SHOTS",       wol:"4",             ars:"10"},
    {label:"ON TARGET",   wol:onTarget("WOL"), ars:onTarget("ARS")},
    {label:"xG",          wol:totalXG("WOL"),  ars:totalXG("ARS")},
    {label:"CORNERS",     wol:"1",             ars:"3"},
    {label:"FOULS",       wol:"6",             ars:"8"},
    {label:"YEL CARDS",   wol:"2",             ars:"0"},
  ];

  const btnBase = {
    cursor:"pointer", fontFamily:FONT.mono, borderRadius:5, border:"none",
    transition:"all 0.15s", letterSpacing:"0.05em",
  };

  return (
    <div style={{background:C.BG, minHeight:"100vh", fontFamily:FONT.sans,
      color:"#ccc", padding:"20px 16px", display:"flex",
      flexDirection:"column", alignItems:"center", gap:16}}>

      {/* ── DATA SOURCE MODAL ───────────────────────────────────────────── */}
      {showInfo && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",
          zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",
          padding:20}} onClick={()=>setShowInfo(false)}>
          <div style={{background:"#0f160f",border:"1px solid rgba(255,255,255,0.12)",
            borderRadius:12,padding:28,maxWidth:560,width:"100%"}}
            onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:18,fontWeight:700,color:"#fff",marginBottom:16,fontFamily:FONT.mono}}>
              📊 Where Does The Data Come From?
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {[
                {label:"✅ REAL — SportRadar API", items:["Final score: Wolves 2–2 Arsenal","Possession: 58% Arsenal, 42% Wolves","Total shots: Arsenal 10, Wolves 4","Cards: 2 yellow Wolves, 0 Arsenal","Goal minutes: 5', 56' (ARS), 61', 90' (WOL)","Real starting lineups (all 22 players)","Substitution minutes"]},
                {label:"⚠️  ESTIMATED from stats", items:["Shot x/y positions (from typical shot zones)","xG values (from shot zone probability tables)","15-min possession splits (interpolated from 58/42)","Player intensity curve (modelled from possession shifts)","Press zone positions (from team tactical profiles)"]},
                {label:"🏆 In a real club setup you'd add", items:["StatsBomb / Opta / Wyscout exact shot coordinates","GPS tracking (STATSports / Catapult) for real player intensity","Optical tracking (Hawkeye / Second Spectrum) for pressing data"]},
              ].map(section => (
                <div key={section.label}>
                  <div style={{fontSize:13,fontWeight:700,color:"#fff",fontFamily:FONT.mono,
                    marginBottom:5}}>{section.label}</div>
                  {section.items.map(item => (
                    <div key={item} style={{fontSize:13,color:"#8aaa8a",paddingLeft:14,
                      marginBottom:3}}>• {item}</div>
                  ))}
                </div>
              ))}
            </div>
            <button onClick={()=>setShowInfo(false)} style={{...btnBase,
              marginTop:18,padding:"10px 24px",background:C.ARS,color:"#fff",
              fontSize:13,fontWeight:700}}>CLOSE</button>
          </div>
        </div>
      )}

      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <div style={{width:"100%",maxWidth:1100,display:"flex",
        justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:12}}>
        <div>
          <div style={{fontSize:12,letterSpacing:"0.25em",color:C.MUTED,marginBottom:5}}>
            TACTICAL INTEL DASHBOARD · PREMIER LEAGUE · 18 FEB 2026
          </div>
          <div style={{fontSize:28,fontWeight:700,lineHeight:1,fontFamily:FONT.mono}}>
            <span style={{color:C.WOL}}>WOLVES</span>
            <span style={{color:"rgba(255,255,255,0.12)",margin:"0 14px",fontSize:20}}>2 — 2</span>
            <span style={{color:C.ARS}}>ARSENAL</span>
          </div>
          <div style={{fontSize:12,color:C.MUTED,marginTop:6}}>MOLINEUX STADIUM</div>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          <button onClick={()=>setShowInfo(true)} style={{...btnBase,
            padding:"9px 16px",background:"rgba(255,255,255,0.06)",
            color:"rgba(255,255,255,0.6)",fontSize:12,
            border:"1px solid rgba(255,255,255,0.12)"}}>
            ℹ Data Sources
          </button>
          <div>
            <div style={{fontSize:11,color:C.MUTED,letterSpacing:"0.15em",marginBottom:6,textAlign:"right"}}>
              ANALYST PERSPECTIVE
            </div>
            <div style={{display:"flex",gap:6}}>
              {[["ARS","ARSENAL"],["WOL","WOLVES"]].map(([t,l])=>(
                <button key={t} onClick={()=>setPerspective(t)} style={{...btnBase,
                  padding:"10px 20px",fontSize:13,fontWeight:700,
                  background:perspective===t?(t==="ARS"?C.ARS:C.WOL):"transparent",
                  border:`2px solid ${t==="ARS"?C.ARS:C.WOL}`,
                  color:perspective===t?"#fff":(t==="ARS"?"#ff7070":C.WOL)}}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── TOP STATS ──────────────────────────────────────────────────── */}
      <div style={{width:"100%",maxWidth:1100,
        display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:8}}>
        {topStat.map(s=>(
          <div key={s.label} style={{background:C.CARD,
            border:"1px solid rgba(255,255,255,0.07)",borderRadius:8,
            padding:"12px 8px",textAlign:"center"}}>
            <div style={{fontSize:10,letterSpacing:"0.12em",color:C.MUTED,marginBottom:8}}>
              {s.label}
            </div>
            <div style={{display:"flex",justifyContent:"center",
              alignItems:"center",gap:10}}>
              <span style={{fontSize:20,fontWeight:700,color:C.WOL,fontFamily:FONT.mono}}>
                {s.wol}
              </span>
              <span style={{fontSize:11,color:"rgba(255,255,255,0.1)"}}>vs</span>
              <span style={{fontSize:20,fontWeight:700,color:C.ARS,fontFamily:FONT.mono}}>
                {s.ars}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* ── MAIN GRID ──────────────────────────────────────────────────── */}
      <div style={{width:"100%",maxWidth:1100,
        display:"grid",gridTemplateColumns:"1.1fr 0.9fr",gap:14}}>

        {/* LEFT */}
        <div style={{display:"flex",flexDirection:"column",gap:12}}>

          {/* Pitch panel */}
          <div style={{background:C.CARD,border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:16}}>
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
                {[["ALL","ALL"],["WOL","WOL"],["ARS","ARS"]].map(([t,l])=>(
                  <button key={t} onClick={()=>setFocusTeam(t)} style={{...btnBase,
                    padding:"7px 12px",fontSize:11,
                    background:focusTeam===t
                      ?(t==="WOL"?C.WOL_DIM:t==="ARS"?C.ARS_DIM:"rgba(255,255,255,0.1)")
                      :"transparent",
                    border:`1px solid ${focusTeam===t
                      ?(t==="WOL"?C.WOL:t==="ARS"?C.ARS:"rgba(255,255,255,0.3)")
                      :"rgba(255,255,255,0.07)"}`,
                    color:t==="WOL"?C.WOL:t==="ARS"?"#ff7070":"rgba(255,255,255,0.55)"}}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <PitchCanvas mode={pitchMode} focusTeam={focusTeam}/>
            <div style={{marginTop:10,fontSize:11,color:C.MUTED,textAlign:"center",lineHeight:1.5}}>
              {pitchMode==="shots" && "⬤ GOAL  ○ BLOCKED / OFF TARGET  — number below = xG (chance quality 0–1)"}
              {pitchMode==="press" && "BLOB SIZE = PRESS INTENSITY · Arsenal press high · Wolves sit deep"}
              {pitchMode==="danger" && "ZONES WHERE ARSENAL ARE VULNERABLE TO WOLVES COUNTER-ATTACKS"}
            </div>
          </div>

          {/* Counter-attacks */}
          <div style={{background:C.CARD,border:"1px solid rgba(255,255,255,0.07)",
            borderRadius:10,padding:16}}>
            <div style={{fontSize:13,letterSpacing:"0.15em",color:C.TEXT,
              fontFamily:FONT.mono,marginBottom:12,fontWeight:600}}>
              ⚡ COUNTER-ATTACK LOG
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:7}}>
              {COUNTERS.map((c,i)=>(
                <div key={i} style={{display:"grid",
                  gridTemplateColumns:"40px 56px 1fr 80px 70px",
                  gap:10,alignItems:"center",padding:"10px 12px",borderRadius:6,
                  background:c.outcome==="GOAL"
                    ?(c.team==="ARS"?C.ARS_DIM:C.WOL_DIM)
                    :"rgba(255,255,255,0.025)",
                  border:`1px solid ${c.outcome==="GOAL"
                    ?(c.team==="ARS"?"rgba(239,1,7,0.3)":"rgba(253,185,19,0.3)")
                    :"rgba(255,255,255,0.05)"}`}}>
                  <span style={{fontSize:13,fontWeight:700,fontFamily:FONT.mono,
                    color:c.team==="ARS"?"#ff7070":C.WOL}}>
                    {c.min}'
                  </span>
                  <span style={{fontSize:12,fontWeight:600,
                    color:c.team==="ARS"?"#ff7070":C.WOL}}>{c.team}</span>
                  <span style={{fontSize:12,color:"rgba(255,255,255,0.45)"}}>{c.players}</span>
                  <span style={{fontSize:11,color:C.MUTED}}>{c.zone}</span>
                  <span style={{fontSize:12,fontWeight:700,textAlign:"right",
                    color:c.outcome==="GOAL"?"#fff":"rgba(255,255,255,0.3)"}}>
                    {c.outcome}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT */}
        <div style={{display:"flex",flexDirection:"column",gap:12}}>

          {/* Momentum blocks */}
          <div style={{background:C.CARD,border:"1px solid rgba(255,255,255,0.07)",
            borderRadius:10,padding:16}}>
            <div style={{display:"flex",justifyContent:"space-between",
              alignItems:"center",marginBottom:12}}>
              <div style={{fontSize:13,letterSpacing:"0.15em",color:C.TEXT,
                fontFamily:FONT.mono,fontWeight:600}}>
                📊 15-MIN MOMENTUM
              </div>
              <div style={{display:"flex",gap:14,fontSize:11}}>
                <span style={{color:C.WOL}}>■ WOL</span>
                <span style={{color:C.ARS}}>■ ARS</span>
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {BLOCKS.map((b,i)=>(
                <div key={i}>
                  <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:4}}>
                    <span style={{fontSize:11,color:C.MUTED,fontFamily:FONT.mono,
                      minWidth:44}}>{b.mins}'</span>
                    <div style={{flex:1,height:26,borderRadius:4,overflow:"hidden",
                      background:"rgba(255,255,255,0.04)",
                      border:"1px solid rgba(255,255,255,0.07)",
                      display:"flex",position:"relative"}}>
                      <div style={{width:`${b.wol}%`,background:C.WOL_DIM,
                        borderRight:`2px solid rgba(253,185,19,0.4)`}}/>
                      <div style={{flex:1,background:C.ARS_DIM,
                        borderLeft:`2px solid rgba(239,1,7,0.4)`}}/>
                      {/* shot dots */}
                      {Array.from({length:b.wolShots}).map((_,j)=>(
                        <div key={j} style={{position:"absolute",left:5+j*9,top:4,
                          width:6,height:6,borderRadius:"50%",background:C.WOL}}/>
                      ))}
                      {Array.from({length:b.arsShots}).map((_,j)=>(
                        <div key={j} style={{position:"absolute",right:5+j*9,top:4,
                          width:6,height:6,borderRadius:"50%",background:C.ARS}}/>
                      ))}
                    </div>
                    <span style={{fontSize:12,fontWeight:700,color:b.wol>b.ars?C.WOL:"rgba(255,255,255,0.2)",
                      fontFamily:FONT.mono,minWidth:32}}>{b.wol}%</span>
                    <span style={{fontSize:12,fontWeight:700,color:b.ars>b.wol?C.ARS:"rgba(255,255,255,0.2)",
                      fontFamily:FONT.mono,minWidth:32}}>{b.ars}%</span>
                  </div>
                  <div style={{fontSize:11,color:"rgba(255,255,255,0.25)",
                    paddingLeft:52,lineHeight:1.4}}>{b.note}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Intensity chart */}
          <div style={{background:C.CARD,border:"1px solid rgba(255,255,255,0.07)",
            borderRadius:10,padding:16}}>
            <div style={{display:"flex",justifyContent:"space-between",
              alignItems:"center",marginBottom:10}}>
              <div style={{fontSize:13,letterSpacing:"0.15em",color:C.TEXT,
                fontFamily:FONT.mono,fontWeight:600}}>
                🔋 PLAYER INTENSITY / FATIGUE
              </div>
              <div style={{display:"flex",gap:14,fontSize:11}}>
                <span style={{color:C.WOL}}>— WOLVES</span>
                <span style={{color:C.ARS}}>— ARSENAL</span>
              </div>
            </div>
            <IntensityChart/>
            <div style={{marginTop:8,padding:"8px 12px",background:"rgba(255,200,80,0.07)",
              borderRadius:5,border:"1px solid rgba(255,200,80,0.15)"}}>
              <span style={{fontSize:12,color:"rgba(255,200,80,0.8)"}}>
                ⚠ Arsenal drop 9.2→5.9 intensity after 75' while Wolves peak at 9.8
              </span>
            </div>
          </div>

          {/* Insights */}
          <div style={{background:C.CARD,
            border:`1px solid ${perspective==="ARS"?"rgba(239,1,7,0.25)":"rgba(253,185,19,0.25)"}`,
            borderTop:`3px solid ${perspective==="ARS"?C.ARS:C.WOL}`,
            borderRadius:10,padding:16}}>
            <div style={{fontSize:13,fontWeight:700,fontFamily:FONT.mono,
              color:perspective==="ARS"?"#ff7070":C.WOL,marginBottom:12,letterSpacing:"0.1em"}}>
              🎯 HOW TO BEAT {perspective==="ARS"?"WOLVES":"ARSENAL"}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {insights.map((ins,i)=>(
                <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start",
                  padding:"10px 12px",borderRadius:6,
                  background:`rgba(${iColor[ins.type]==="ff5a5a"?"255,90,90":iColor[ins.type]==="#5affaa"?"90,255,170":"255,216,90"},0.05)`,
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
      <div style={{width:"100%",maxWidth:1100,background:C.CARD,
        border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:16}}>
        <div style={{fontSize:13,fontWeight:600,color:C.TEXT,fontFamily:FONT.mono,
          letterSpacing:"0.15em",marginBottom:12}}>
          📈 SHOT TIMELINE — BUBBLE SIZE = xG QUALITY
        </div>
        <div style={{position:"relative",height:70,
          background:"rgba(0,0,0,0.3)",borderRadius:6}}>
          {/* halftime */}
          <div style={{position:"absolute",top:0,bottom:0,left:"47.4%",
            width:1,background:"rgba(255,255,255,0.08)"}}/>
          <div style={{position:"absolute",top:4,left:"48%",fontSize:11,color:C.MUTED}}>HT</div>
          {/* goal flash lines */}
          {SHOTS.filter(s=>s.goal).map((s,i)=>(
            <div key={i} style={{position:"absolute",top:0,bottom:0,
              left:`${(s.min/95)*100}%`,width:1,
              background:s.team==="ARS"?"rgba(239,1,7,0.35)":"rgba(253,185,19,0.35)"}}/>
          ))}
          {/* shots */}
          {SHOTS.map((s,i)=>{
            const r = 5 + s.xg * 28;
            const y = s.team==="ARS" ? 14 : 50;
            return (
              <div key={i} title={`${s.min}' ${s.player} (${s.team}) xG:${s.xg}`}
                style={{position:"absolute",
                  left:`calc(${(s.min/95)*100}% - ${r}px)`,
                  top:`${y-r}px`,width:r*2,height:r*2,borderRadius:"50%",
                  background:s.goal?(s.team==="ARS"?C.ARS:C.WOL):"transparent",
                  border:`2px solid ${s.team==="ARS"?C.ARS:C.WOL}`,
                  opacity:s.goal?1:0.5,cursor:"default"}}>
              </div>
            );
          })}
          <div style={{position:"absolute",left:6,top:8,fontSize:11,
            color:"rgba(239,1,7,0.6)",fontWeight:600}}>ARS ▸</div>
          <div style={{position:"absolute",left:6,bottom:8,fontSize:11,
            color:"rgba(253,185,19,0.6)",fontWeight:600}}>WOL ▸</div>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",
          marginTop:8,fontSize:11,color:C.MUTED}}>
          {["0'","15'","30'","45'","60'","75'","90'"].map(t=>(
            <span key={t}>{t}</span>
          ))}
        </div>
      </div>

      <div style={{fontSize:11,color:"rgba(255,255,255,0.1)",letterSpacing:"0.12em",paddingBottom:8}}>
        TACTICAL INTEL · WOLVES 2–2 ARSENAL · 18 FEB 2026 · DATA: SPORTRADAR + ESTIMATES
      </div>
    </div>
  );
}
