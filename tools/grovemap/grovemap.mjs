#!/usr/bin/env node
// Grovemap — Nibbin codebase cartography.
// Scans the repo for code imports and markdown/html links, emits:
//   tools/grovemap/graph.json        (data)
//   tools/grovemap/grovemap.html     (self-contained interactive map — just open it)
// Zero dependencies. Usage: node tools/grovemap/grovemap.mjs [repoRoot]

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, resolve, extname, basename, sep } from 'node:path';

const ROOT = resolve(process.argv[2] || process.cwd());
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'target', 'vendor', '.next', '.vercel', 'coverage']);
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const DOC_EXT = new Set(['.md']);
const HTML_EXT = new Set(['.html']);
const ALL_EXT = new Set([...CODE_EXT, ...DOC_EXT, ...HTML_EXT, '.rs', '.py', '.css', '.yml', '.yaml', '.json']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') && name !== '.claude' && name !== '.github') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) walk(p, out); }
    else if (ALL_EXT.has(extname(name)) || name === 'CLAUDE.md') out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const rel = (p) => relative(ROOT, p).split(sep).join('/');
const fileSet = new Set(files.map(rel));
const byBase = new Map(); // basename -> [relpaths]
for (const f of fileSet) {
  const b = basename(f).toLowerCase();
  if (!byBase.has(b)) byBase.set(b, []);
  byBase.get(b).push(f);
}

function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null; // external pkg
  const base = spec.startsWith('/') ? ROOT : dirname(join(ROOT, fromFile));
  const target = resolve(base, spec);
  const cands = [target,
    ...[...CODE_EXT].map(e => target + e),
    ...[...CODE_EXT].map(e => join(target, 'index' + e)),
    target + '.md', target + '.html'];
  for (const c of cands) {
    const r = rel(c);
    if (fileSet.has(r)) return r;
  }
  return null;
}

function resolveLoose(name) {
  // wikilinks / backtick mentions: exact relpath, else unique basename match
  const n = name.replace(/^\.\//, '');
  if (fileSet.has(n)) return n;
  const hits = byBase.get(basename(n).toLowerCase());
  return hits && hits.length === 1 ? hits[0] : null;
}

const edges = new Map(); // "a -> b" => kind
function addEdge(a, b, kind) {
  if (!a || !b || a === b) return;
  const k = a + '\u0000' + b;
  if (!edges.has(k)) edges.set(k, kind);
}

const IMPORT_RE = /(?:import\s+[^'"]*from\s*|import\s*\(\s*|require\s*\(\s*|export\s+[^'"]*from\s*)['"]([^'"]+)['"]/g;
const MDLINK_RE = /\[[^\]]*\]\(([^)#?\s]+)[^)]*\)/g;
const WIKI_RE = /\[\[([^\]|#]+)/g;
const TICK_RE = /`([\w./-]+\.(?:md|ts|tsx|js|mjs|html|rs|py|yml|json))`/g;
const SRC_RE = /(?:src|href)=["']([^"':]+)["']/g;

for (const f of files) {
  const r = rel(f);
  const ext = extname(f);
  let text;
  try { text = readFileSync(f, 'utf8'); } catch { continue; }
  let m;
  if (CODE_EXT.has(ext)) {
    while ((m = IMPORT_RE.exec(text))) addEdge(r, resolveImport(r, m[1]), 'import');
  }
  if (DOC_EXT.has(ext) || r === 'CLAUDE.md') {
    while ((m = MDLINK_RE.exec(text))) {
      const t = m[1].startsWith('.') || !m[1].includes('//') ? resolveImport(r, m[1].startsWith('.') ? m[1] : './' + m[1]) || resolveLoose(m[1]) : null;
      addEdge(r, t, 'link');
    }
    while ((m = WIKI_RE.exec(text))) addEdge(r, resolveLoose(m[1].trim()), 'link');
    while ((m = TICK_RE.exec(text))) addEdge(r, resolveLoose(m[1]), 'mention');
  }
  if (HTML_EXT.has(ext)) {
    while ((m = SRC_RE.exec(text))) {
      if (!m[1].startsWith('http') && !m[1].startsWith('#')) addEdge(r, resolveImport(r, m[1].startsWith('.') ? m[1] : './' + m[1]), 'link');
    }
  }
}

const groupOf = (p) => (p.includes('/') ? p.split('/')[0] : 'root');
const degree = new Map();
for (const k of edges.keys()) {
  const [a, b] = k.split('\u0000');
  degree.set(a, (degree.get(a) || 0) + 1);
  degree.set(b, (degree.get(b) || 0) + 1);
}
const nodes = [...fileSet].sort().map(p => ({ id: p, group: groupOf(p), deg: degree.get(p) || 0 }));
const links = [...edges.entries()].map(([k, kind]) => { const [source, target] = k.split('\u0000'); return { source, target, kind }; });
const graph = { generated: new Date().toISOString(), root: basename(ROOT), nodes, links };

const outDir = join(ROOT, 'tools', 'grovemap');
writeFileSync(join(outDir, 'graph.json'), JSON.stringify(graph, null, 1));

const TEMPLATE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Grovemap — __ROOT__</title>
<style>
:root{--paper:#F5F6F2;--ink:#23291A;--soft:#5A6248;--line:#D6DAC8;--card:#fff;
--moss:#5B7C2E;--teal:#3E7C74;--honey:#D9A21B;--coral:#E2603A;--plum:#7B5BD6;--sky:#5B8BD6;--rose:#C75A85;--slate:#6B7261;}
*{margin:0;box-sizing:border-box}body{font-family:'Archivo',-apple-system,sans-serif;background:var(--paper);color:var(--ink);overflow:hidden}
#side{position:fixed;left:0;top:0;bottom:0;width:280px;background:var(--card);border-right:1px solid var(--line);padding:18px;overflow-y:auto;z-index:2}
#side h1{font-size:18px;font-weight:900}#side .sub{font-family:ui-monospace,monospace;font-size:10.5px;color:var(--soft);margin:4px 0 14px}
#q{width:100%;padding:9px 11px;border:1.5px solid var(--line);border-radius:6px;font-family:ui-monospace,monospace;font-size:12px;background:#FCFDF9}
#q:focus{outline:none;border-color:var(--moss)}
.lg{margin-top:14px}.lg div{display:flex;align-items:center;gap:8px;font-family:ui-monospace,monospace;font-size:11px;color:var(--soft);padding:4px 0;cursor:pointer}
.lg i{width:11px;height:11px;border-radius:50%}.lg .off{opacity:.3}
#info{margin-top:14px;border-top:1px dashed var(--line);padding-top:12px;font-family:ui-monospace,monospace;font-size:11px;color:var(--soft);min-height:80px;word-break:break-all}
#info b{color:var(--ink)}
.btns{display:flex;gap:8px;margin-top:12px}
.btns button{flex:1;font-family:ui-monospace,monospace;font-size:11px;font-weight:600;padding:8px;border:1px solid var(--ink);background:var(--ink);color:var(--paper);border-radius:5px;cursor:pointer}
.btns button.ghost{background:none;color:var(--ink)}
#c{position:fixed;left:280px;top:0;right:0;bottom:0;cursor:grab}
#tip{position:fixed;pointer-events:none;background:var(--ink);color:var(--paper);font-family:ui-monospace,monospace;font-size:11px;padding:5px 9px;border-radius:5px;display:none;z-index:3;max-width:380px}
@media(max-width:720px){#side{width:200px}#c{left:200px}}
</style></head><body>
<div id="side">
  <h1>🌿 Grovemap</h1><div class="sub" id="meta"></div>
  <input id="q" placeholder="search files…">
  <div class="lg" id="legend"></div>
  <div class="btns"><button id="fit" class="ghost">Fit</button><button id="shake">Re-layout</button></div>
  <div id="info">Hover a node. Click to focus its neighborhood. Drag nodes, drag canvas to pan, scroll to zoom.</div>
</div>
<canvas id="c"></canvas><div id="tip"></div>
<script>
const G = __GRAPH__;
const PAL = ['#5B7C2E','#3E7C74','#D9A21B','#E2603A','#7B5BD6','#5B8BD6','#C75A85','#6B7261'];
const groups=[...new Set(G.nodes.map(n=>n.group))].sort();
const gcolor=Object.fromEntries(groups.map((g,i)=>[g,PAL[i%PAL.length]]));
const hidden=new Set();
const N=G.nodes.map((n,i)=>({...n,i,x:(Math.random()-0.5)*900,y:(Math.random()-0.5)*900,vx:0,vy:0,r:5+Math.min(11,Math.sqrt(n.deg)*2.4)}));
const idx=Object.fromEntries(N.map(n=>[n.id,n]));
const L=G.links.map(l=>({a:idx[l.source],b:idx[l.target],kind:l.kind})).filter(l=>l.a&&l.b);
const adj=new Map(); N.forEach(n=>adj.set(n.i,new Set()));
L.forEach(l=>{adj.get(l.a.i).add(l.b.i);adj.get(l.b.i).add(l.a.i);});
document.getElementById('meta').textContent=G.root+' · '+N.length+' files · '+L.length+' links · '+G.generated.slice(0,10);
const leg=document.getElementById('legend');
groups.forEach(g=>{const d=document.createElement('div');d.innerHTML='<i style="background:'+gcolor[g]+'"></i>'+g+' ('+G.nodes.filter(n=>n.group===g).length+')';
d.onclick=()=>{hidden.has(g)?hidden.delete(g):hidden.add(g);d.classList.toggle('off');};leg.appendChild(d);});
const cv=document.getElementById('c'),ctx=cv.getContext('2d'),tip=document.getElementById('tip'),info=document.getElementById('info');
let W2,H2,dpr=window.devicePixelRatio||1,tx=0,ty=0,scale=1,hot=null,focus=null,query='';
function size(){W2=cv.clientWidth;H2=cv.clientHeight;cv.width=W2*dpr;cv.height=H2*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);}
window.addEventListener('resize',size);size();
let alpha=1;
function tick(){
  if(alpha>0.003){
    for(let a=0;a<N.length;a++){const na=N[a];if(hidden.has(na.group))continue;
      for(let b=a+1;b<N.length;b++){const nb=N[b];if(hidden.has(nb.group))continue;
        let dx=na.x-nb.x,dy=na.y-nb.y,d2=dx*dx+dy*dy+0.01;if(d2>90000)continue;
        const f=1400/d2;dx*=f;dy*=f;na.vx+=dx;na.vy+=dy;nb.vx-=dx;nb.vy-=dy;}}
    for(const l of L){if(hidden.has(l.a.group)||hidden.has(l.b.group))continue;
      const dx=l.b.x-l.a.x,dy=l.b.y-l.a.y,d=Math.sqrt(dx*dx+dy*dy)+0.01,f=(d-90)*0.012/d;
      l.a.vx+=dx*f;l.a.vy+=dy*f;l.b.vx-=dx*f;l.b.vy-=dy*f;}
    for(const n of N){n.vx-=n.x*0.0016;n.vy-=n.y*0.0016;
      if(n!==drag){n.x+=n.vx*alpha;n.y+=n.vy*alpha;}n.vx*=0.84;n.vy*=0.84;}
    alpha*=0.995;}
  draw();requestAnimationFrame(tick);}
function draw(){
  ctx.clearRect(0,0,W2,H2);ctx.save();ctx.translate(W2/2+tx,H2/2+ty);ctx.scale(scale,scale);
  const focusSet=focus!=null?new Set([focus,...adj.get(focus)]):null;
  for(const l of L){if(hidden.has(l.a.group)||hidden.has(l.b.group))continue;
    const dim=focusSet&&!(focusSet.has(l.a.i)&&focusSet.has(l.b.i));
    ctx.strokeStyle=dim?'rgba(90,98,72,0.06)':(l.kind==='import'?'rgba(91,124,46,0.35)':'rgba(90,98,72,0.22)');
    ctx.lineWidth=l.kind==='import'?1.2:0.8;
    ctx.beginPath();ctx.moveTo(l.a.x,l.a.y);ctx.lineTo(l.b.x,l.b.y);ctx.stroke();}
  for(const n of N){if(hidden.has(n.group))continue;
    const matched=query&&n.id.toLowerCase().includes(query);
    const dim=(focusSet&&!focusSet.has(n.i))||(query&&!matched);
    ctx.globalAlpha=dim?0.12:1;
    ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,7);ctx.fillStyle=gcolor[n.group];ctx.fill();
    ctx.strokeStyle='#fff';ctx.lineWidth=1.4;ctx.stroke();
    if(n===hot||matched||(focusSet&&focusSet.has(n.i)&&scale>0.6)){
      ctx.fillStyle='#23291A';ctx.font='10px ui-monospace,monospace';
      ctx.fillText(n.id.split('/').pop(),n.x+n.r+3,n.y+3);}
    ctx.globalAlpha=1;}
  ctx.restore();}
function pick(mx,my){const x=(mx-W2/2-tx)/scale,y=(my-H2/2-ty)/scale;
  let best=null,bd=1e9;for(const n of N){if(hidden.has(n.group))continue;
    const d=(n.x-x)**2+(n.y-y)**2;if(d<bd&&d<(n.r+6)**2){bd=d;best=n;}}return best;}
let drag=null,panning=false,px=0,py=0;
cv.addEventListener('mousedown',e=>{const n=pick(e.offsetX,e.offsetY);
  if(n){drag=n;alpha=Math.max(alpha,0.3);}else{panning=true;}px=e.offsetX;py=e.offsetY;cv.style.cursor='grabbing';});
window.addEventListener('mousemove',e=>{const r=cv.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;
  if(drag){drag.x=(mx-W2/2-tx)/scale;drag.y=(my-H2/2-ty)/scale;alpha=Math.max(alpha,0.25);}
  else if(panning){tx+=mx-px;ty+=my-py;px=mx;py=my;}
  else{hot=pick(mx,my);
    if(hot){tip.style.display='block';tip.style.left=(e.clientX+12)+'px';tip.style.top=(e.clientY+12)+'px';
      tip.textContent=hot.id+'  ·  '+hot.deg+' links';}else tip.style.display='none';}});
window.addEventListener('mouseup',()=>{drag=null;panning=false;cv.style.cursor='grab';});
cv.addEventListener('click',e=>{const n=pick(e.offsetX,e.offsetY);
  if(n){focus=(focus===n.i)?null:n.i;
    const nb=[...adj.get(n.i)].map(i=>N[i].id.split('/').pop()).slice(0,14).join(', ');
    info.innerHTML='<b>'+n.id+'</b><br>'+n.deg+' links · group '+n.group+(nb?'<br><br>connects: '+nb:'');}
  else{focus=null;info.textContent='Hover a node. Click to focus its neighborhood.';}});
cv.addEventListener('wheel',e=>{e.preventDefault();const f=e.deltaY<0?1.12:0.89;scale=Math.min(5,Math.max(0.15,scale*f));},{passive:false});
document.getElementById('q').addEventListener('input',e=>{query=e.target.value.toLowerCase();});
document.getElementById('shake').onclick=()=>{for(const n of N){n.x+= (Math.random()-0.5)*60;n.y+=(Math.random()-0.5)*60;}alpha=1;};
document.getElementById('fit').onclick=()=>{tx=0;ty=0;
  let mx=0;for(const n of N){mx=Math.max(mx,Math.abs(n.x),Math.abs(n.y));}
  scale=Math.min(2,(Math.min(W2,H2)/2-40)/(mx+40));};
tick();setTimeout(()=>document.getElementById('fit').click(),1400);
</script></body></html>`;

writeFileSync(join(outDir, 'grovemap.html'),
  TEMPLATE.replace('__ROOT__', basename(ROOT)).replace('__GRAPH__', JSON.stringify(graph)));

console.log(`Grovemap: ${nodes.length} files, ${links.length} links → tools/grovemap/grovemap.html`);
