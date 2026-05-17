/**
 * charts.js — All Chart.js visualisations
 * Uses data from data.js state (GL, LS, RG, DEM, EX)
 */

'use strict';

Chart.defaults.color       = 'rgba(200,230,248,.45)';
Chart.defaults.font.family = "'Courier New', monospace";
Chart.defaults.font.size   = 10;

const _CH = {};
function kc(id){ if(_CH[id]){ _CH[id].destroy(); delete _CH[id]; } }

/* ── GloFAS sidebar forecast chart ──────────────────────────── */
function drawGC(){
  kc('gc');
  const k = document.getElementById('reach-sel')?.value || 'tarbela';
  const g = GL[k]; if(!g) return;
  const ctx = document.getElementById('gc').getContext('2d');
  const alertLvl = g.ltm * FLOOD_THRESHOLD / 100;

  const ds = g.ensemble.map((m,i)=>({
    label: i===0?'Ensemble':null, data:m,
    borderColor:'rgba(0,200,255,.15)', backgroundColor:'transparent',
    borderWidth:1, pointRadius:0, tension:.4
  }));
  ds.push({
    label:'Median', data:g.median, borderColor:'#00c8ff',
    backgroundColor: c => {
      const gr = c.chart.ctx.createLinearGradient(0,0,0,160);
      gr.addColorStop(0,'rgba(0,200,255,.22)'); gr.addColorStop(1,'rgba(0,200,255,0)');
      return gr;
    },
    fill:true, borderWidth:2.5, pointRadius:3, pointBackgroundColor:'#00c8ff', tension:.4
  });

  _CH.gc = new Chart(ctx, {
    type:'line', data:{labels:g.dates, datasets:ds},
    options:{
      responsive:true, maintainAspectRatio:false, animation:false,
      plugins:{legend:{display:false}, tooltip:{callbacks:{label:c=>`${c.dataset.label||'Ens'}: ${(c.parsed.y||0).toLocaleString()} m³/s`}}},
      scales:{
        x:{grid:{color:'rgba(255,255,255,.04)'}, ticks:{maxRotation:0, font:{size:9}}},
        y:{grid:{color:'rgba(255,255,255,.04)'}, ticks:{callback:v=>v>=1000?(v/1000).toFixed(1)+'k':v}}
      }
    },
    plugins:[{id:'tl', afterDraw(c){
      const {ctx:cx, chartArea:{top,bottom,right,left}, scales:{y}} = c;
      [[g.ltm,'#00e676','LTM'],[alertLvl,'#ff1744',`Alert ${FLOOD_THRESHOLD}%`]].forEach(([v,col,lbl])=>{
        const yp = y.getPixelForValue(v);
        if(yp<top||yp>bottom) return;
        cx.save(); cx.strokeStyle=col; cx.lineWidth=1.2; cx.setLineDash([5,4]);
        cx.beginPath(); cx.moveTo(left,yp); cx.lineTo(right,yp); cx.stroke();
        cx.fillStyle=col; cx.font="9px 'Courier New'";
        cx.fillText(lbl, right-cx.measureText(lbl).width-2, yp-3);
        cx.restore();
      });
    }}]
  });
}

/* ── Bottom-tab charts ───────────────────────────────────────── */
function drawAllCharts(){
  const LC = {Critical:'#ff1744',High:'#ff6d00',Moderate:'#ffd600',Low:'#00e676'};

  /* Landslide scatter */
  kc('ls-sc');
  const lsCtx = document.getElementById('ls-sc')?.getContext('2d');
  if(lsCtx){
    const g = {};
    LS.forEach(p=>{ (g[p.ls_level]=g[p.ls_level]||[]).push({x:p.rain_mm,y:p.ls_score}); });
    _CH['ls-sc'] = new Chart(lsCtx, {
      type:'scatter',
      data:{datasets:Object.entries(g).map(([l,d])=>({label:l,data:d,backgroundColor:(LC[l]||'#0f0')+'bb',pointRadius:8,pointHoverRadius:11}))},
      options:{responsive:true,maintainAspectRatio:false,animation:false,
        plugins:{legend:{position:'bottom',labels:{font:{size:9}}}},
        scales:{
          x:{title:{display:true,text:'Rainfall (mm)',color:'rgba(200,230,248,.35)'},grid:{color:'rgba(255,255,255,.04)'}},
          y:{title:{display:true,text:'Susc. Score',color:'rgba(200,230,248,.35)'},min:0,max:100,grid:{color:'rgba(255,255,255,.04)'}}
        }}
    });
  }

  /* Landslide bar */
  kc('ls-br');
  const lbCtx = document.getElementById('ls-br')?.getContext('2d');
  if(lbCtx){
    const cnt={Low:0,Moderate:0,High:0,Critical:0};
    LS.forEach(p=>cnt[p.ls_level]++);
    _CH['ls-br'] = new Chart(lbCtx, {
      type:'bar',
      data:{labels:Object.keys(cnt),datasets:[{label:'Grid Cells',data:Object.values(cnt),backgroundColor:['#00e676','#ffd600','#ff6d00','#ff1744'],borderRadius:4}]},
      options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:false}},
        scales:{x:{grid:{display:false}},y:{grid:{color:'rgba(255,255,255,.04)'},ticks:{precision:0}}}}
    });
  }

  /* Rainfall bar */
  kc('rn-br');
  const rbCtx = document.getElementById('rn-br')?.getContext('2d');
  if(rbCtx){
    const s = [...RG].sort((a,b)=>b.rain_mm-a.rain_mm);
    _CH['rn-br'] = new Chart(rbCtx, {
      type:'bar',
      data:{labels:s.map(p=>`${p.lat.toFixed(0)}°N ${p.lon.toFixed(0)}°E`),
        datasets:[
          {label:'Today mm',data:s.map(p=>p.rain_mm),backgroundColor:s.map(p=>p.anomaly_pct>=0?'#1565d8':'#ffd600'),borderRadius:3},
          {label:'LTM mm',data:s.map(p=>p.ltm_mm),backgroundColor:'rgba(255,255,255,.08)',borderRadius:3}
        ]},
      options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{position:'bottom',labels:{font:{size:9}}}},
        scales:{x:{ticks:{maxRotation:45,font:{size:8}},grid:{display:false}},y:{grid:{color:'rgba(255,255,255,.04)'}}}}
    });
  }

  /* Rainfall anomaly pie */
  kc('rn-pi');
  const rpCtx = document.getElementById('rn-pi')?.getContext('2d');
  if(rpCtx){
    const a=RG.filter(p=>p.anomaly_pct>20).length,n=RG.filter(p=>Math.abs(p.anomaly_pct)<=20).length,b=RG.filter(p=>p.anomaly_pct<-20).length;
    _CH['rn-pi'] = new Chart(rpCtx, {
      type:'doughnut',
      data:{labels:['>20% Above LTM','±20% LTM','>20% Below LTM'],
        datasets:[{data:[a,n,b],backgroundColor:['#1565d8','#00e676','#ffd600'],borderColor:'#020c1a',borderWidth:2}]},
      options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{position:'bottom',labels:{font:{size:9}}}},cutout:'60%'}
    });
  }

  /* DEM elevation profile */
  kc('dem-pr');
  const dpCtx = document.getElementById('dem-pr')?.getContext('2d');
  if(dpCtx){
    const pts = DEM.filter(d=>d.type==='cpec').sort((a,b)=>a.lat-b.lat);
    _CH['dem-pr'] = new Chart(dpCtx, {
      type:'line',
      data:{labels:pts.map(d=>`${d.lat.toFixed(1)}°N`),
        datasets:[{label:'Elev (m)',data:pts.map(d=>d.elev),borderColor:'#1de9b6',
          backgroundColor:c=>{const gr=c.chart.ctx.createLinearGradient(0,0,0,90);gr.addColorStop(0,'rgba(29,233,182,.25)');gr.addColorStop(1,'rgba(29,233,182,0)');return gr;},
          fill:true,borderWidth:1.8,pointRadius:3,pointBackgroundColor:pts.map(d=>elevCol(d.elev)),tension:.4}]},
      options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:false}},
        scales:{x:{grid:{display:false},ticks:{font:{size:8},maxRotation:0}},
                y:{grid:{color:'rgba(255,255,255,.04)'},ticks:{callback:v=>v.toLocaleString()+'m',font:{size:8}}}}}
    });
  }

  /* Slope distribution donut */
  kc('sl-do');
  const sdCtx = document.getElementById('sl-do')?.getContext('2d');
  if(sdCtx){
    const cnt={High:0,Medium:0,Low:0};
    DEM.forEach(d=>cnt[d.slope_cat]=(cnt[d.slope_cat]||0)+1);
    _CH['sl-do'] = new Chart(sdCtx, {
      type:'doughnut',
      data:{labels:['High Slope','Medium Slope','Low/Flat'],
        datasets:[{data:[cnt.High,cnt.Medium,cnt.Low],backgroundColor:['#ff1744','#ffd600','#00e676'],borderColor:'#020c1a',borderWidth:2}]},
      options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{position:'bottom',labels:{font:{size:9}}}},cutout:'55%'}
    });
  }

  /* Population bar */
  kc('pop-br');
  const pbCtx = document.getElementById('pop-br')?.getContext('2d');
  if(pbCtx){
    const top = [...EX].sort((a,b)=>b.population-a.population).slice(0,12);
    _CH['pop-br'] = new Chart(pbCtx, {
      type:'bar',
      data:{labels:top.map(d=>d.district),
        datasets:[{label:'Population',data:top.map(d=>d.population),
          backgroundColor:top.map(d=>d.cpec_flag==='YES'?'rgba(0,200,255,.65)':'rgba(21,101,216,.65)'),borderRadius:4}]},
      options:{responsive:true,maintainAspectRatio:false,animation:false,
        plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${(c.parsed.y/1e6).toFixed(2)}M`}}},
        scales:{x:{ticks:{font:{size:8},maxRotation:45},grid:{display:false}},
                y:{grid:{color:'rgba(255,255,255,.04)'},ticks:{callback:v=>v>=1e6?(v/1e6).toFixed(1)+'M':v}}}}
    });
  }
}
