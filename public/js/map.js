/**
 * map.js — Leaflet map initialisation and all 10 layer renderers
 * Data comes from data.js state variables (FA, FC, RG, GL, LS, EX, DEM)
 */

'use strict';

let MAP, LYRS = {};

/* ── Init ────────────────────────────────────────────────────── */
function initMap(){
  MAP = L.map('map', {
    zoomControl: true, attributionControl: false,
    minZoom: 4, maxZoom: 14, center: [30, 69], zoom: 5
  });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    {maxZoom:18, subdomains:'abcd'}).addTo(MAP);
  // Pakistan centred — full country bounds
  MAP.fitBounds([[23.5,60.5],[37.5,77.5]]);
  setTimeout(()=>{ MAP.invalidateSize(true); MAP.fitBounds([[23.5,60.5],[37.5,77.5]]); }, 300);
  setTimeout(()=>{ MAP.invalidateSize(true); }, 800);
}

function setLyr(key, lyr){
  if(LYRS[key]) MAP.removeLayer(LYRS[key]);
  LYRS[key] = lyr;
  const chk = document.getElementById('lyr-'+key);
  if(!chk || chk.checked) lyr.addTo(MAP);
}
function toggleLyr(key){
  const chk = document.getElementById('lyr-'+key);
  if(!LYRS[key]) return;
  chk.checked ? LYRS[key].addTo(MAP) : MAP.removeLayer(LYRS[key]);
}

/* ── Popup helper ────────────────────────────────────────────── */
function pu(title, rows){
  return `<div class="pu-t">${title}</div>`
    + rows.map(([k,v])=>`<div class="pu-r"><span class="pu-k">${k}</span><span class="pu-v">${v}</span></div>`).join('');
}

/* ════════════════════════════════════════════════════════════════
   RENDER ALL 10 LAYERS
════════════════════════════════════════════════════════════════ */
function renderAllLayers(){

  /* 1 ── CPEC Roads (from Overpass / Python fallback) */
  const cg = L.layerGroup();
  if(CPEC_ROADS_GJ){
    CPEC_ROADS_GJ.features.forEach(f=>{
      const coords = f.geometry.coordinates.map(([lo,la])=>[la,lo]);
      L.polyline(coords, {color:'#ff8c00', weight:3.2, opacity:.9,
        dashArray: f.properties.ref ? null : '10 5'})
        .bindTooltip(pu(`🛣️ ${f.properties.name||'CPEC Route'}`,[
          ['Ref',f.properties.ref||'—'],['Highway',f.properties.highway||'—']]))
        .addTo(cg);
    });
  } else {
    L.polyline(CPEC_COORDS.map(([lo,la])=>[la,lo]),
      {color:'#ff8c00',weight:3,opacity:.9,dashArray:'10 5'})
      .bindTooltip('CPEC Main Corridor').addTo(cg);
  }
  setLyr('cpec', cg);

  /* 2 ── CPEC Buffer */
  const lons = CPEC_COORDS.map(c=>c[0]), lats = CPEC_COORDS.map(c=>c[1]);
  const off = CPEC_BUFFER_KM / 111;
  setLyr('buffer', L.geoJSON({type:'Feature',geometry:{type:'Polygon',coordinates:[[[
    Math.min(...lons)-off, Math.min(...lats)-off],[Math.max(...lons)+off, Math.min(...lats)-off],
    [Math.max(...lons)+off, Math.max(...lats)+off],[Math.min(...lons)-off, Math.max(...lats)+off],
    [Math.min(...lons)-off, Math.min(...lats)-off]]]}},
    {style:{color:'#ff8c00',weight:1,fillColor:'#ff8c00',fillOpacity:.08,dashArray:'4 3'}})
    .bindTooltip(`CPEC ${CPEC_BUFFER_KM}km Buffer Zone`));

  /* 3 ── District Risk Choropleth */
  const dg = L.layerGroup();
  EX.forEach(d=>{
    const col = RC[d.risk_level]||'#00e676';
    L.circleMarker([d.lat,d.lon], {radius:14, fillColor:col,
      color:d.cpec_flag==='YES'?'#00c8ff':'#1a2540',
      weight:d.cpec_flag==='YES'?2:.7, fillOpacity:.52})
      .bindPopup(pu(`${d.district}`,[
        ['Province',d.province],['Population',d.population.toLocaleString()],
        ['CPEC',d.cpec_flag==='YES'?'✅ Yes':'—'],
        ['Rain',`${d.rain_mm}mm (${d.anomaly_pct>0?'+':''}${d.anomaly_pct}%)`],
        ['Fires',`${d.fire_count} (${d.fires_in_buffer} in buffer)`],
        ['Elevation',`${d.elev_m}m | ${d.slope_cat} slope`],
        ['Flood',`${d.flood_status} (${d.flood_pct_ltm}% LTM)`],
        ['Landslide',`${d.landslide_level} (${d.landslide_score}/100)`],
        ['Risk Score',`<b>${d.risk_score}/100 — ${d.risk_level}</b>`]
      ])).addTo(dg);
  });
  setLyr('dist', dg);

  /* 4 ── Fire Hotspots (all Pakistan, CPEC-zone highlighted) */
  const fg = L.layerGroup();
  FA.forEach(f=>{
    const ib = inBuf(f.lat,f.lon);
    L.circleMarker([f.lat,f.lon], {
      radius:Math.max(4,Math.min(17,f.frp/6)),
      fillColor:ib?'#ff1744':'#ff8c00',
      color:ib?'#fff':'transparent', weight:ib?1.5:0, fillOpacity:ib?.9:.72})
      .bindPopup(pu(`🔥 ${ib?'⚠️ CPEC ZONE — ':''}Fire Hotspot`,[
        ['FRP',`${f.frp.toFixed(1)} MW`],['Date',f.acq_date],
        ['Satellite',f.satellite],['Source',f.source],
        ['In CPEC Buffer',ib?'⚠️ YES':'No']
      ])).addTo(fg);
  });
  setLyr('fires', fg);

  /* 5 ── GPM IMERG Rainfall Grid */
  const rg = L.layerGroup();
  RG.forEach(pt=>{
    const al = Math.min(.78, Math.max(.1, pt.rain_mm/28));
    const col = pt.anomaly_pct>=20?'#1565d8':pt.anomaly_pct>=0?'#4488dd':pt.anomaly_pct>=-20?'#ffd600':'#ff6d00';
    L.circleMarker([pt.lat,pt.lon], {radius:12+Math.min(8,pt.rain_mm*.35),
      fillColor:col, color:col, weight:.4, fillOpacity:al})
      .bindPopup(pu('🌧️ GPM IMERG Rainfall',[
        ['Today',`${pt.rain_mm} mm/day`],['ERA5 LTM',`${pt.ltm_mm} mm/day`],
        ['Anomaly',`${pt.anomaly_pct>0?'+':''}${pt.anomaly_pct}%`],
        ['Intensity',pt.intensity],['In CPEC Buffer',inBuf(pt.lat,pt.lon)?'⚠️ YES':'No']
      ])).addTo(rg);
  });
  setLyr('rain', rg);

  /* 6 ── LHASA Landslide Susceptibility */
  const lsg = L.layerGroup();
  LS.forEach(pt=>{
    const col = {Critical:'#a10e0e',High:'#cf4a00',Moderate:'#9a6700',Low:'#1f6b38'}[pt.ls_level]||'#1f6b38';
    const rad = pt.ls_level==='Critical'?14:pt.ls_level==='High'?11:8;
    L.circleMarker([pt.lat,pt.lon], {radius:rad, fillColor:col, color:'#fff', weight:.4, fillOpacity:.74})
      .bindPopup(pu('🏔️ Landslide — LHASA Nowcast',[
        ['Level',`<b>${pt.ls_level}</b>`],['Score',`${pt.ls_score}/100`],
        ['Slope',`${pt.slope_cat} (${pt.elev}m)`],
        ['Rain',`${pt.rain_mm}mm | Score ${pt.rain_score}`],
        ['In CPEC',pt.in_cpec?'⚠️ YES':'No']
      ])).addTo(lsg);
  });
  setLyr('ls', lsg);

  /* 7 ── GloFAS River Reaches */
  const gg = L.layerGroup();
  Object.values(GL).forEach(g=>{
    const col = SC[g.status]||'#00e676';
    const rad = g.status==='CRITICAL'?18:g.status==='HIGH'?14:g.status==='WATCH'?10:7;
    const ic = g.status==='CRITICAL'?'🔴':g.status==='HIGH'?'🟠':g.status==='WATCH'?'🟡':'🟢';
    L.circleMarker([g.lat,g.lon], {radius:rad, fillColor:col, color:'#e8f4fc', weight:2, fillOpacity:.88})
      .bindPopup(pu(`${ic} ${g.name}`,[
        ['Status',`<b>${g.status}</b>`],
        ['Peak Discharge',`${g.maxPct}% of LTM on ${g.peakDay}`],
        ['LTM Baseline',`${g.ltm.toLocaleString()} m³/s`],
        ['7-day %LTM',`${g.pctLTM.join('% → ')}%`]
      ])).addTo(gg);
  });
  setLyr('glofas', gg);

  /* 8 ── Indus River */
  setLyr('river', L.polyline(INDUS_COORDS.map(([lo,la])=>[la,lo]),
    {color:'#00c8ff', weight:2.8, opacity:.75})
    .bindTooltip('Indus River — Main Stem'));

  /* 9 ── WorldPop Density */
  const pg = L.layerGroup();
  EX.forEach(d=>{
    const rad = Math.max(5, Math.min(20, d.population/700000));
    L.circleMarker([d.lat,d.lon], {radius:rad, fillColor:popCol(d.population),
      color:'#020c1a', weight:.5, fillOpacity:.68})
      .bindPopup(pu(`👥 WorldPop 2020 — ${d.district}`,[
        ['Population',d.population.toLocaleString()],
        ['Province',d.province],
        ['CPEC',d.cpec_flag==='YES'?'✅ YES':'No'],
        ['Risk Level',d.risk_level]
      ])).addTo(pg);
  });
  setLyr('pop', pg);

  /* 10 ── SRTM DEM Elevation */
  const dg2 = L.layerGroup();
  DEM.forEach(dp=>{
    L.circleMarker([dp.lat,dp.lon], {radius:5, fillColor:elevCol(dp.elev),
      color:'transparent', weight:0, fillOpacity:.55})
      .bindPopup(pu('📐 SRTM 30m DEM',[
        ['Elevation',`${dp.elev} m ASL`],
        ['Slope Zone',dp.slope_cat],
        ['Type',dp.type==='cpec'?'CPEC corridor':'District centroid']
      ])).addTo(dg2);
  });
  setLyr('dem', dg2);

  /* Re-center Pakistan after rendering */
  setTimeout(()=>{ MAP.invalidateSize(true); MAP.fitBounds([[23.5,60.5],[37.5,77.5]]); }, 150);
}
