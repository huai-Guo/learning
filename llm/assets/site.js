
document.querySelectorAll('.reveal').forEach(el=>{
  const io=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting)e.target.classList.add('show')}),{threshold:.08});
  io.observe(el);
});
const sections=[...document.querySelectorAll('section[id]')];
const links=[...document.querySelectorAll('.sidenav a')];
if(sections.length&&links.length){
  const spy=new IntersectionObserver(entries=>{
    entries.forEach(e=>{
      if(e.isIntersecting){
        links.forEach(a=>a.classList.toggle('active',a.getAttribute('href')==='#'+e.target.id));
      }
    })
  },{rootMargin:'-25% 0px -65% 0px'});
  sections.forEach(s=>spy.observe(s));
}

document.querySelectorAll('[data-attention-demo]').forEach(function(demo){
  var tokens=Array.from(demo.querySelectorAll('[data-att-token]'));
  var rows=Array.from(demo.querySelectorAll('[data-att-row]'));
  var caption=demo.querySelector('[data-att-caption]');
  function activate(token){
    tokens.forEach(function(t){t.classList.toggle('active',t===token);});
    var weights=(token.dataset.weights||'').split(',').map(Number);
    var max=Math.max.apply(null,weights);
    rows.forEach(function(row,i){
      var v=weights[i]||0;
      row.querySelector('.fill').style.width=Math.round(v*100)+'%';
      row.querySelector('[data-value]').textContent=v.toFixed(2);
      row.classList.toggle('hot',v===max);
    });
    if(caption) caption.innerHTML='当前 Query：<strong>'+token.textContent+'</strong>。横条越长，表示它对对应 Key 的注意力权重越高。';
  }
  tokens.forEach(function(t){t.addEventListener('click',function(){activate(t);});});
  if(tokens.length) activate(tokens.find(function(t){return t.classList.contains('active');})||tokens[0]);
});

document.querySelectorAll('[data-kv-demo]').forEach(function(demo){
  var seq=(demo.dataset.tokens||'我,爱,北京,天安门').split(',');
  var slots=demo.querySelector('[data-kv-slots]');
  var explain=demo.querySelector('[data-kv-explain]');
  var meter=demo.querySelector('[data-kv-meter]');
  var next=demo.querySelector('[data-kv-next]');
  var reset=demo.querySelector('[data-kv-reset]');
  var step=0;
  function render(){
    slots.innerHTML='';
    seq.slice(0,step).forEach(function(tok,i){
      var el=document.createElement('div');
      el.className='kv-slot '+(i===step-1?'new':'cached');
      el.innerHTML=tok+'<small>'+(i===step-1?'新算 K/V':'复用 K/V')+'</small>';
      slots.appendChild(el);
    });
    meter.style.width=Math.round(step/seq.length*100)+'%';
    if(step===0) explain.innerHTML='点击“下一步”，观察每生成一个 token 时，<strong>旧 K/V 被复用，只有新 token 的 K/V 被追加</strong>。';
    else explain.innerHTML='Step '+step+'：历史 '+Math.max(step-1,0)+' 个 token 的 K/V 直接从 Cache 读取；只为 <strong>'+seq[step-1]+'</strong> 新增一份 K/V。';
  }
  if(next) next.addEventListener('click',function(){step=Math.min(step+1,seq.length);render();if(step===seq.length)next.textContent='已到最后一步';});
  if(reset) reset.addEventListener('click',function(){step=0;if(next)next.textContent='下一步';render();});
  render();
});

document.querySelectorAll('[data-moe-demo]').forEach(function(demo){
  var tokens=Array.from(demo.querySelectorAll('[data-moe-token]'));
  var experts=Array.from(demo.querySelectorAll('[data-expert]'));
  var loads=Array.from(demo.querySelectorAll('[data-load]'));
  var status=demo.querySelector('[data-moe-caption]');
  var routes=tokens.map(function(t){return (t.dataset.route||'0').split(',').map(Number);});
  var counts=new Array(experts.length).fill(0),idx=0,timer=null;
  function show(i){
    tokens.forEach(function(t,k){t.classList.toggle('active',k===i);});
    experts.forEach(function(e){e.classList.remove('active');});
    routes[i].forEach(function(r){if(experts[r]){experts[r].classList.add('active');counts[r]++;}});
    var max=Math.max.apply(null,[1].concat(counts));
    loads.forEach(function(l,k){l.style.width=Math.round(counts[k]/max*100)+'%';});
    experts.forEach(function(e,k){e.classList.toggle('load-high',counts[k]===max&&max>2);});
    var names=routes[i].map(function(r){return experts[r]?experts[r].dataset.name:'Expert '+r;}).join(' + ');
    if(status)status.innerHTML='Token <strong>'+tokens[i].textContent+'</strong> 被 Router 送到 <strong>'+names+'</strong>。';
    var router=demo.querySelector('.router');if(router){router.classList.remove('pulse');void router.offsetWidth;router.classList.add('pulse');}
  }
  var play=demo.querySelector('[data-moe-play]');
  if(play)play.addEventListener('click',function(){
    if(timer){clearInterval(timer);timer=null;play.textContent='自动播放';}
    else{show(idx);idx=(idx+1)%tokens.length;timer=setInterval(function(){show(idx);idx=(idx+1)%tokens.length;},1300);play.textContent='暂停';}
  });
  tokens.forEach(function(t,i){t.addEventListener('click',function(){show(i);});});
  if(tokens.length)show(0);
});
