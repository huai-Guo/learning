
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
