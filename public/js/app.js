/**
 * app.js — Main orchestrator
 *
 * PIPELINE (in order):
 *   1. Try loading Python-generated dashboard_data.json  ← PRIMARY
 *   2. If missing, fall back to live API calls           ← FALLBACK
 *   3. Render all 10 map layers
 *   4. Update KPIs, alert feed, ticker, charts, table
 *   5. Auto-refresh every 30 minutes
 */

'use strict';

/* ── Processing log ──────────────────────────────────────────── */
function plog(msg){
  const el = document.getElementById('proc-log'); if(!el) return;
  const t  = new Date().toISOString().split('T')[1].slice(0,8);
  const cls = msg.includes('✓')?'log-ok':msg.includes('⚠')||msg.includes('ℹ')?'log-warn':'log-run';
  const d = document.createElement('div');
  d.innerHTML = `<span style="color:rgba(0,200,255,.3)">${t}</span> <span class="${cls}">${msg}</span>`;
  el.appendChild(d);
  el.scrollTop = el.scrollHeight;
}
function setLogTag(txt){ const e=document.getElementById('log-tag'); if(e) e.textContent=txt; }

function updateDataStatus(msg, ok){
  document.getElementById('ds-text').textContent = msg;
  const dot = document.querySelector('.ds-dot');
  if(dot){
    dot.style.background = ok ? '#00e676' : '#ffd600';
    dot.style.boxShadow  = `0 0 6px ${dot.style.background}`;
  }
}

/* ════════════════════════════════════════════════════════════════
   MAIN PIPELINE
════════════════════════════════════════════════════════════════ */
async function runPipeline(){
  const btn = document.getElementById('rbtn');
  if(btn){ btn.textContent='↻ LOADING…'; btn.disabled=true; }
  setLogTag('RUNNING');

  CPEC_BUFFER_KM  = +(document.getElementById('buf-sl')?.value || 10);
  FLOOD_THRESHOLD = +(document.getElementById('ltm-sl')?.value || 120);

  try{
    /* STEP 1 — Try Python-generated JSON (primary source) */
    const gotPythonData = await loadPythonData();

    if(!gotPythonData){
      /* STEP 2 — Live API fallback */
      plog('── Running live API fallback pipeline ──');
      await fetchFIRMS();      // A2: NASA FIRMS
      await fetchRainfall();   // A3: GPM IMERG via Open-Meteo
      await fetchDEM();        // B1: SRTM 30m DEM
      await fetchCPECRoads();  // B3: OSM Overpass
      buildGloFAS();           // S1+S2: GloFAS ensemble
      await fetchLandslide();  // S3: LHASA Nowcast
      buildExposure();         // B2+B4: District exposure
    } else {
      /* Python JSON loaded — still fetch roads if not in JSON */
      if(!CPEC_ROADS_GJ){
        await fetchCPECRoads();
      }
      /* Rebuild GloFAS if not in JSON (threshold may have changed) */
      if(!Object.keys(GL).length) buildGloFAS();
      /* Rebuild exposure if empty */
      if(!EX.length) buildExposure();
    }

    /* STEP 3 — Render all 10 map layers */
    plog('── Rendering map layers ──');
    renderAllLayers();

    /* STEP 4 — Update all UI */
    updateKPIs();
    updateAlertFeed();
    updateTicker();
    drawGC();
    drawAllCharts();
    populateTable();
    updateDEMStats();
    updatePopStats();
    updateBrief();

    plog('✓ Dashboard live — auto-refresh in 30 min');
    setLogTag('LIVE');

  } catch(e){
    plog(`⚠ Pipeline error: ${e.message}`);
    setLogTag('ERR');
    console.error(e);
  }

  if(btn){ btn.textContent='↺ REFRESH DATA'; btn.disabled=false; }
  startCountdown();
}

async function reloadAll(){ await runPipeline(); }

/* ════════════════════════════════════════════════════════════════
   KPI UPDATES
════════════════════════════════════════════════════════════════ */
function updateKPIs(){
  st('k-fires', FA.length);
  st('k-fires-c', `${FC.length} in CPEC zone`);

  if(RG.length){
    const mx = RG.reduce((a,b)=>b.rain_mm>a.rain_mm?b:a,{rain_mm:0,anomaly_pct:0});
    st('k-rain', `${mx.rain_mm} mm`);
    st('k-rain-a', `${mx.anomaly_pct>0?'+':''}${mx.anomaly_pct}% vs LTM`);
  }

  const fa = Object.values(GL).filter(g=>['CRITICAL','HIGH'].includes(g.status));
  const cr = Object.values(GL).filter(g=>g.status==='CRITICAL').length;
  st('k-flood', fa.length);
  st('k-flood-s', `${cr} Critical / ${fa.length-cr} High`);

  const lh = LS.filter(l=>['High','Critical'].includes(l.ls_level)).length;
  st('k-ls', lh);
  st('k-ls-s', `${LS.filter(l=>l.ls_level==='Critical').length} Critical`);

  const cpec    = EX.filter(d=>d.cpec_flag==='YES');
  const cpecPop = cpec.reduce((s,d)=>s+d.population,0);
  st('k-pop', fN(cpecPop));
  st('k-pop-s', `${cpec.length} districts`);

  const hr = EX.filter(d=>['High','Critical'].includes(d.risk_level));
  st('k-risk', hr.length);
  st('k-risk-s', `${EX.filter(d=>d.risk_level==='Critical').length} Critical`);

  st('hf1', FA.length);
  st('hf2', fa.length);
  st('hf3', fN(cpecPop));

  st('ms1', FA.filter(f=>f.frp>80).length);
  st('ms2', FC.length);
  st('ms3', LS.filter(l=>l.in_cpec&&['High','Critical'].includes(l.ls_level)).length);
  st('ms4', fN(hr.reduce((s,d)=>s+d.population,0)));
}

/* ════════════════════════════════════════════════════════════════
   ALERT FEED
════════════════════════════════════════════════════════════════ */
function updateAlertFeed(){
  const feed = document.getElementById('alert-feed'); if(!feed) return;
  let html = '';

  Object.values(GL).sort((a,b)=>b.maxPct-a.maxPct).forEach(g=>{
    const cls = g.status==='CRITICAL'?'crit':g.status==='HIGH'?'high':g.status==='WATCH'?'watch':'ok';
    const ic  = g.status==='CRITICAL'?'🔴':g.status==='HIGH'?'🟠':g.status==='WATCH'?'🟡':'🟢';
    html += `<div class="acard ${cls}">
      <div class="acard-name">${ic} ${g.name}</div>
      <div class="acard-meta">Peak ${g.peakDay} &nbsp;·&nbsp; ${g.status}</div>
      <div class="acard-pct">${g.maxPct}%</div>
    </div>`;
  });

  const cf = FC.filter(f=>f.frp>60);
  if(cf.length){
    const mf = Math.max(...cf.map(f=>f.frp)).toFixed(0);
    html += `<div class="acard high">
      <div class="acard-name">🔥 ${cf.length} High-FRP fires in CPEC</div>
      <div class="acard-meta">Max FRP: ${mf} MW</div>
      <div class="acard-pct">${cf.length}</div>
    </div>`;
  }

  const lcc = LS.filter(l=>l.in_cpec&&l.ls_level==='Critical');
  if(lcc.length){
    html += `<div class="acard crit">
      <div class="acard-name">🏔️ ${lcc.length} Critical LS zone(s) in CPEC</div>
      <div class="acard-meta">Max score: ${Math.max(...lcc.map(l=>l.ls_score))}/100</div>
      <div class="acard-pct">${lcc.length}</div>
    </div>`;
  }

  feed.innerHTML = html;
  const tot = Object.values(GL).filter(g=>g.status!=='NORMAL').length;
  st('alert-cnt', `${tot} ACTIVE`);
}

/* ════════════════════════════════════════════════════════════════
   SCROLLING TICKER
════════════════════════════════════════════════════════════════ */
function updateTicker(){
  const track = document.getElementById('ticker-track'); if(!track) return;
  const items = [];

  Object.values(GL).sort((a,b)=>b.maxPct-a.maxPct).forEach(g=>{
    const cl = g.status==='CRITICAL'?'t-crit':g.status==='HIGH'?'t-high':g.status==='WATCH'?'t-watch':'t-ok';
    const ic = g.status==='CRITICAL'?'🔴':g.status==='HIGH'?'🟠':g.status==='WATCH'?'🟡':'🟢';
    items.push(`<div class="t-item"><span class="${cl}">${ic} FLOOD | ${g.name} — ${g.maxPct}% of LTM | Peak: ${g.peakDay} | ${g.status}</span></div>`);
  });

  if(FC.length){
    const mf = Math.max(...FC.map(f=>f.frp)).toFixed(0);
    items.push(`<div class="t-item"><span class="t-high">🔥 FIRE | ${FC.length} hotspot(s) in CPEC ${CPEC_BUFFER_KM}km buffer — Max FRP: ${mf} MW</span></div>`);
  }

  const lcc = LS.filter(l=>l.in_cpec&&l.ls_level==='Critical');
  if(lcc.length) items.push(`<div class="t-item"><span class="t-crit">🏔️ LANDSLIDE | ${lcc.length} Critical zone(s) in CPEC corridor</span></div>`);

  EX.filter(d=>d.risk_level==='Critical').slice(0,4).forEach(d=>
    items.push(`<div class="t-item"><span class="t-crit">⚠️ CRITICAL DISTRICT | ${d.district} (${d.province}) — Risk: ${d.risk_score}/100 — Pop: ${fN(d.population)}</span></div>`));

  const hrRain = RG.filter(r=>r.rain_mm>20&&r.anomaly_pct>30);
  if(hrRain.length) items.push(`<div class="t-item"><span class="t-high">🌧️ RAINFALL | ${hrRain.length} cell(s) exceed 20mm/day with +30% anomaly vs ERA5 LTM</span></div>`);

  if(!items.length) items.push(`<div class="t-item"><span class="t-ok">● All hazard levels within normal bounds</span></div>`);

  track.innerHTML = [...items,...items].join('');
  track.style.animationDuration = `${Math.max(22, items.length*9)}s`;
}

/* ════════════════════════════════════════════════════════════════
   EXPOSURE TABLE
════════════════════════════════════════════════════════════════ */
function populateTable(){
  const tb = document.getElementById('exp-tbody'); if(!tb) return;
  tb.innerHTML = [...EX].sort((a,b)=>b.risk_score-a.risk_score).map(d=>{
    const bc = d.risk_level==='Critical'?'bc':d.risk_level==='High'?'bh':d.risk_level==='Moderate'?'bm':'bl';
    const cp = d.cpec_flag==='YES'?`<span class="bdg bp">CPEC</span>`:'—';
    return `<tr>
      <td>${d.district}</td><td>${d.province}</td><td>${d.population.toLocaleString()}</td>
      <td>${cp}</td><td>${d.rain_mm}</td><td>${d.anomaly_pct>0?'+':''}${d.anomaly_pct}%</td>
      <td>${d.fire_count}</td><td>${d.fires_in_buffer}</td><td>${d.slope_cat}</td>
      <td>${d.elev_m}m</td><td>${d.flood_status}</td><td>${d.landslide_level}</td>
      <td>${d.risk_score}</td><td><span class="bdg ${bc}">${d.risk_level}</span></td>
    </tr>`;
  }).join('');
}

/* DEM stats */
function updateDEMStats(){
  const e = DEM.map(d=>d.elev); if(!e.length) return;
  st('dem-min',  Math.min(...e).toLocaleString()+'m');
  st('dem-max',  Math.max(...e).toLocaleString()+'m');
  st('dem-mean', Math.round(e.reduce((a,b)=>a+b,0)/e.length).toLocaleString()+'m');
  st('dem-hi',   `${DEM.filter(d=>d.slope_cat==='High').length}/${e.length}`);
}

/* Population stats */
function updatePopStats(){
  const cpec    = EX.filter(d=>d.cpec_flag==='YES');
  const atRisk  = cpec.filter(d=>['Critical','High'].includes(d.risk_level));
  const cpecPop = cpec.reduce((s,d)=>s+d.population,0);
  const riskPop = atRisk.reduce((s,d)=>s+d.population,0);
  st('pop-tot',  fN(cpecPop));
  st('pop-risk', fN(riskPop));
  st('pop-dist', cpec.length);
}

/* Policy brief */
function updateBrief(){
  const now  = new Date().toUTCString();
  const fa   = Object.values(GL).filter(g=>g.at_risk);
  const hr   = EX.filter(e=>['Critical','High'].includes(e.risk_level));
  const mx   = RG.length ? RG.reduce((a,b)=>b.rain_mm>a.rain_mm?b:a,{rain_mm:0,anomaly_pct:0}) : {rain_mm:0,anomaly_pct:0};
  const lsh  = LS.filter(l=>['High','Critical'].includes(l.ls_level)).length;
  const cpecPop = EX.filter(d=>d.cpec_flag==='YES').reduce((s,d)=>s+d.population,0);

  const brief = `MULTI-HAZARD EARLY WARNING BULLETIN
Indus Basin & CPEC Corridor — Pakistan
Generated: ${now}
Supervisor: Ms. Aasaia Wahab — Dept. of Earth & Environmental Sciences
Team: Saim Noor · Areesha Anjum · M. Atteq Ur Rehman Khan · M. Nisar Yasin · Faizan Ahmad

━━━ SUMMARY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Fire hotspots (NASA FIRMS NRT): ${FA.length} | In CPEC ${CPEC_BUFFER_KM}km zone: ${FC.length}
• Max observed rainfall: ${mx.rain_mm} mm/day (${mx.anomaly_pct>0?'+':''}${mx.anomaly_pct}% vs ERA5 LTM)
• Indus reaches ≥ ${FLOOD_THRESHOLD}% of LTM discharge: ${fa.length}
• High/Critical landslide zones: ${lsh}
• High/Critical risk districts: ${hr.length}
• CPEC corridor population exposed: ~${(cpecPop/1e6).toFixed(1)}M

━━━ GLOFAS FLOOD STATUS (7-Day) ━━━━━━━━━━━━━━━━
${Object.values(GL).map(g=>{
  const ic=g.status==='CRITICAL'?'🔴':g.status==='HIGH'?'🟠':g.status==='WATCH'?'🟡':'🟢';
  return `${ic} ${g.name}: ${g.maxPct}% LTM | Peak: ${g.peakDay} | ${g.status}`;
}).join('\n')}

━━━ HIGH-RISK DISTRICTS (Top 8) ━━━━━━━━━━━━━━━
${hr.slice(0,8).map((d,i)=>`${i+1}. ${d.district} (${d.province}) | Risk: ${d.risk_score}/100 [${d.risk_level}] | Pop: ${fN(d.population)}`).join('\n')}

━━━ RECOMMENDED ACTIONS ━━━━━━━━━━━━━━━━━━━━━━━
1. Activate emergency protocols for all CRITICAL-status Indus reaches.
2. Issue public advisories for ${hr.length} High/Critical risk districts.
3. Pre-position response teams in northern CPEC landslide zones.
4. Monitor GPM IMERG every 30 minutes for threshold breaches.
5. Alert NDMA and provincial PDMAs for coordinated response.

Data Sources: NASA FIRMS · GPM/Open-Meteo ERA5 · GloFAS · WorldPop 2020 · SRTM 30m · OSM Overpass
Backend: Python generate_data.py (Google Colab) → public/dashboard_data.json`;

  st('brief-text', brief);
  window._brief = brief;
}

/* ════════════════════════════════════════════════════════════════
   TAB SWITCHER
════════════════════════════════════════════════════════════════ */
function openTab(id, btn){
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  const p = document.getElementById('tab-'+id);
  if(p) p.classList.add('active');
  if(btn) btn.classList.add('active');
}

/* ════════════════════════════════════════════════════════════════
   AUTO-REFRESH COUNTDOWN (30 minutes)
════════════════════════════════════════════════════════════════ */
let _cds = 1800, _cdt = null;
function startCountdown(){
  clearInterval(_cdt); _cds = 1800;
  _cdt = setInterval(()=>{
    _cds--;
    const m = String(Math.floor(_cds/60)).padStart(2,'0');
    const s = String(_cds%60).padStart(2,'0');
    st('cd',  `${m}:${s}`);
    st('mcd', `${m}:${s}`);
    if(_cds <= 0){ _cds=1800; runPipeline(); }
  }, 1000);
}

/* ════════════════════════════════════════════════════════════════
   UTC CLOCK
════════════════════════════════════════════════════════════════ */
function startClock(){
  const tick = () => {
    const n=new Date(), p=x=>String(x).padStart(2,'0');
    st('clk',  `${p(n.getUTCHours())}:${p(n.getUTCMinutes())}:${p(n.getUTCSeconds())}`);
    st('clkd', n.toUTCString().split(' ').slice(1,4).join(' ')+' UTC');
  };
  tick(); setInterval(tick,1000);
}

/* ════════════════════════════════════════════════════════════════
   BOOT
════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', ()=>{
  startClock();
  initMap();
  runPipeline();
});
