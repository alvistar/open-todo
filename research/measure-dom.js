((rootSel, maxN)=>{
  const root=document.querySelector(rootSel); if(!root) return JSON.stringify({error:'no root '+rootSel});
  const out=[]; const skip=new Set(['SCRIPT','STYLE','SVG','PATH','USE','G']);
  const walk=(e,depth)=>{
    if(out.length>=maxN) return;
    if(skip.has(e.tagName)) return;
    const r=e.getBoundingClientRect(); if((r.width===0||r.height===0)&&e.children.length===0) return;
    const c=getComputedStyle(e);
    if(c.display==='none'||c.visibility==='hidden') return;
    const own=Array.from(e.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).filter(Boolean).join(' ').slice(0,40);
    const hasSvg=!!e.querySelector(':scope>svg');
    out.push({d:depth,t:e.tagName.toLowerCase(),tid:e.getAttribute('data-testid')||undefined,role:e.getAttribute('role')||undefined,aria:(e.getAttribute('aria-label')||'').slice(0,40)||undefined,txt:own||undefined,svg:hasSvg||undefined,
      x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),
      p:c.padding!=='0px'?c.padding:undefined,m:c.margin!=='0px'?c.margin:undefined,g:c.gap!=='normal'?c.gap:undefined,
      disp:c.display,fd:c.display.includes('flex')?c.flexDirection+'/'+c.alignItems+'/'+c.justifyContent:undefined,
      f:own?c.fontSize+'/'+c.lineHeight+' '+c.fontWeight:undefined,col:own?c.color:undefined,
      bg:c.backgroundColor!=='rgba(0, 0, 0, 0)'?c.backgroundColor:undefined,
      br:c.borderRadius!=='0px'?c.borderRadius:undefined,
      bd:(c.borderTopWidth!=='0px'||c.borderBottomWidth!=='0px'||c.borderLeftWidth!=='0px'||c.borderRightWidth!=='0px')?c.borderWidth+' '+c.borderStyle+' '+c.borderColor:undefined,
      pos:c.position!=='static'?c.position:undefined});
    for(const ch of e.children) walk(ch,depth+1);
  };
  walk(root,0); return JSON.stringify(out);
})
