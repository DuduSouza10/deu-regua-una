const appEl = document.getElementById('app');
const navEl = document.getElementById('mainNav');
const accountEl = document.getElementById('accountArea');
const modalRoot = document.getElementById('modalRoot');
const toastRoot = document.getElementById('toastRoot');
const mobileMenu = document.getElementById('mobileMenu');

const state = {
  me: null,
  meta: { cuts: [], ambiences: [], plans: [] },
  compare: new Set(JSON.parse(localStorage.getItem('deu_regua_compare') || '[]')),
  filters: { q:'', distance:'', price:'', service:'', rating:'', ambience:'', sort:'match', lat:'', lng:'' },
  ownerTab: 'overview',
  adminTab: 'shops',
  selectedSlot: null
};

const esc = (v='') => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const money = v => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v)||0);
const dateTime = v => v ? new Intl.DateTimeFormat('pt-BR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v)) : '-';
const shortDate = v => v ? new Intl.DateTimeFormat('pt-BR',{dateStyle:'medium'}).format(new Date(v)) : '-';
const stars = r => `<span class="stars">★</span> ${Number(r||0).toFixed(1)}`;
const statusLabel = s => ({pending:'Pendente',confirmed:'Confirmado',completed:'Concluído',cancelled:'Cancelado'}[s]||s);
const roleLabel = r => ({customer:'Cliente',owner:'Barbearia',admin:'Administrador'}[r]||r);
const isFavShop = id => !!state.me?.profile?.favoriteShopIds?.includes(id);
const isFavBarber = id => !!state.me?.profile?.favoriteBarberIds?.includes(id);
const loader = () => `<div class="page-loader"><span></span><span></span><span></span></div>`;
const empty = (icon,title,text,action='') => `<div class="empty"><div class="emoji">${icon}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;

async function api(url, options={}) {
  const headers = { ...(options.headers||{}) };
  if (options.body && !(options.body instanceof FormData) && typeof options.body !== 'string') {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  const res = await fetch(url,{...options,headers,credentials:'same-origin'});
  let data = {};
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

function toast(message,type='success') {
  const el=document.createElement('div'); el.className=`toast ${type}`; el.textContent=message; toastRoot.appendChild(el);
  setTimeout(()=>el.remove(),3600);
}
function openModal(html,wide=false) { modalRoot.innerHTML=`<div class="modal ${wide?'wide':''}">${html}</div>`; document.body.style.overflow='hidden'; }
function closeModal(){ modalRoot.innerHTML='';document.body.style.overflow='';state.selectedSlot=null; }
function modalShell(title,body){return `<div class="modal-head"><h2>${esc(title)}</h2><button class="modal-close" data-action="close-modal">×</button></div><div class="modal-body">${body}</div>`;}

function saveCompare(){ localStorage.setItem('deu_regua_compare',JSON.stringify([...state.compare])); updateNav(); }
function routeParts(){ return (location.hash.replace(/^#\/?/,'')||'discover').split('/').filter(Boolean); }
function goto(path){ location.hash=`#/${path}`; }

function updateNav(){
  const current=routeParts()[0];
  const links=[['discover','Descobrir'],['compare',`Comparar${state.compare.size?` <span class="count">${state.compare.size}</span>`:''}`],['plans','Planos']];
  if(state.me?.role==='customer') links.push(['appointments','Agendamentos'],['profile','Perfil']);
  if(state.me?.role==='owner') links.push(['owner','Minha barbearia'],['profile','Conta']);
  if(state.me?.role==='admin') links.push(['admin','Admin']);
  navEl.innerHTML=links.map(([r,label])=>`<a class="nav-link ${current===r?'active':''}" href="#/${r}">${label}</a>`).join('');
  if(state.me){
    accountEl.innerHTML=`<a href="#/profile" class="account-chip"><span class="avatar">${esc(state.me.name.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase())}</span><div><strong>${esc(state.me.name.split(' ')[0])}</strong><small>${roleLabel(state.me.role)}</small></div></a><button class="btn sm ghost" data-action="logout">Sair</button>`;
  } else {
    accountEl.innerHTML=`<button class="btn sm ghost" data-action="auth">Entrar</button><button class="btn sm primary" data-action="auth" data-tab="register">Criar conta</button>`;
  }
}

async function init(){
  try{
    const [me,meta]=await Promise.all([api('/api/auth/me'),api('/api/meta')]);
    state.me=me.user; state.meta=meta;
    if(state.me?.role==='customer'){
      state.filters.lat=state.me.profile?.lat ?? '';
      state.filters.lng=state.me.profile?.lng ?? '';
    }
  }catch(e){console.error(e)}
  updateNav(); await renderRoute();
}

async function renderRoute(){
  navEl.classList.remove('open'); updateNav(); window.scrollTo({top:0,behavior:'instant'}); appEl.innerHTML=loader();
  const [route,id]=routeParts();
  try{
    if(route==='discover') return await renderDiscover();
    if(route==='shop'&&id) return await renderShop(id);
    if(route==='barber'&&id) return await renderBarber(id);
    if(route==='compare') return await renderCompare();
    if(route==='appointments') return await renderAppointments();
    if(route==='profile') return await renderProfile();
    if(route==='owner') return await renderOwner();
    if(route==='admin') return await renderAdmin();
    if(route==='plans') return await renderPlans();
    goto('discover');
  }catch(e){
    console.error(e); appEl.innerHTML=`<section class="page narrow">${empty('⚠️','Não foi possível carregar',e.message,'<button class="btn dark" onclick="location.reload()">Tentar novamente</button>')}</section>`;
  }
}

function shopCard(s){
  const dist=s.distanceKm!=null?`${s.distanceKm.toFixed(1)} km`:'distância indisponível';
  const compared=state.compare.has(s.id);
  return `<article class="shop-card">
    <div class="shop-photo"><img src="${esc(s.photo||'/assets/shop-default.svg')}" alt="${esc(s.name)}" onerror="this.src='/assets/shop-default.svg'">${s.featured?'<span class="badge gold">★ Destaque</span>':''}
      <div class="shop-photo-actions"><button class="icon-btn" title="Favoritar" data-action="favorite-shop" data-id="${s.id}">${isFavShop(s.id)?'♥':'♡'}</button></div>
    </div>
    <div class="shop-body">
      <div class="shop-title"><div><h3>${esc(s.name)}</h3><div class="muted">${esc(s.city)}, ${esc(s.state)}</div></div><div class="rating">${stars(s.rating)}</div></div>
      <div class="meta-line"><span>${dist}</span><span>•</span><span>a partir de ${money(s.minPrice)}</span><span>•</span><span>${s.reviewCount} avaliações</span></div>
      <div class="tags">${(s.ambienceStyles||[]).slice(0,3).map(x=>`<span class="tag">${esc(x)}</span>`).join('')}${(s.specialties||[]).slice(0,2).map(x=>`<span class="tag">${esc(x)}</span>`).join('')}</div>
      ${s.matchedBarbers?.length?`<div class="muted" style="font-size:12px">Profissionais: ${s.matchedBarbers.map(b=>esc(b.name)).join(', ')}</div>`:''}
      <div class="shop-actions"><a class="btn dark" href="#/shop/${s.id}">Ver perfil</a><button class="btn light" data-action="toggle-compare" data-id="${s.id}">${compared?'✓ Comparando':'Comparar'}</button></div>
    </div>
  </article>`;
}

async function runSearch(){
  const p=new URLSearchParams(); Object.entries(state.filters).forEach(([k,v])=>{if(v!==''&&v!=null)p.set(k,v)});
  return api(`/api/search?${p}`);
}
async function renderDiscover(){
  const data=await runSearch();
  const averageRating=data.results.length?(data.results.reduce((sum,item)=>sum+Number(item.rating||0),0)/data.results.length).toFixed(1):'—';
  appEl.innerHTML=`<section class="page">
    <div class="hero hero-premium">
      <div class="hero-grid">
        <div class="hero-copy">
          <div class="eyebrow"><span class="eyebrow-dot"></span> Seu estilo, sua escolha</div>
          <h1>Seu próximo corte começa com a <span class="hero-accent">escolha certa.</span></h1>
          <p>Encontre barbearias e profissionais pelo que realmente importa: estilo, distância, preço, avaliação e disponibilidade.</p>
          <div class="hero-actions"><button class="btn primary" data-action="focus-search">Encontrar barbearia</button><button class="btn ghost" data-action="use-location">⌖ Usar minha localização</button></div>
          <div class="hero-trust"><span><strong>${data.results.length}</strong> opções encontradas</span><span>•</span><span>Perfis, portfólio e agenda em um só lugar</span></div>
        </div>
        <div class="hero-visual" aria-hidden="true">
          <div class="hero-brand-orbit hero-brand-orbit-a"></div>
          <div class="hero-brand-orbit hero-brand-orbit-b"></div>
          <div class="hero-logo-shell"><img src="/assets/logo-mark.png" alt=""></div>
          <div class="hero-mini-card hero-mini-rating"><span class="mini-icon">★</span><div><strong>${averageRating}</strong><small>média das avaliações</small></div></div>
          <div class="hero-mini-card hero-mini-booking"><span class="mini-icon">✓</span><div><strong>Agende online</strong><small>sem ligação, sem espera</small></div></div>
        </div>
      </div>
    </div>
    <div class="search-panel-head"><div><span class="kicker">Busca inteligente</span><h2>Encontre exatamente o que você procura</h2></div><span class="search-panel-note">Você pode combinar vários filtros</span></div>
    <form id="searchForm" class="filters">
      <div class="field search-wide"><label>O que você procura?</label><input id="searchQ" name="q" value="${esc(state.filters.q)}" placeholder="Ex.: degradê, João, freestyle, barba..."></div>
      <div class="field"><label>Distância</label><select name="distance"><option value="">Qualquer</option>${[2,5,10,20,50].map(v=>`<option ${String(state.filters.distance)===String(v)?'selected':''} value="${v}">Até ${v} km</option>`).join('')}</select></div>
      <div class="field"><label>Preço máximo</label><select name="price"><option value="">Qualquer</option>${[30,40,50,70,100,150].map(v=>`<option ${String(state.filters.price)===String(v)?'selected':''} value="${v}">Até ${money(v)}</option>`).join('')}</select></div>
      <div class="field"><label>Corte/serviço</label><select name="service"><option value="">Todos</option>${state.meta.cuts.map(v=>`<option ${state.filters.service===v?'selected':''}>${esc(v)}</option>`).join('')}</select></div>
      <div class="field"><label>Avaliação</label><select name="rating"><option value="">Qualquer</option>${[3,4,4.5].map(v=>`<option ${String(state.filters.rating)===String(v)?'selected':''} value="${v}">${v}+ estrelas</option>`).join('')}</select></div>
      <div class="field"><label>Ambiente</label><select name="ambience"><option value="">Todos</option>${state.meta.ambiences.map(v=>`<option ${state.filters.ambience===v?'selected':''}>${esc(v)}</option>`).join('')}</select></div>
      <div class="field"><label>Ordenar</label><select name="sort"><option value="match" ${state.filters.sort==='match'?'selected':''}>Mais compatíveis</option><option value="rating" ${state.filters.sort==='rating'?'selected':''}>Melhor avaliação</option><option value="distance" ${state.filters.sort==='distance'?'selected':''}>Mais perto</option><option value="price" ${state.filters.sort==='price'?'selected':''}>Menor preço</option></select></div>
      <button class="btn dark" type="submit">Buscar</button>
    </form>
    <div class="results-toolbar"><strong>${data.results.length} ${data.results.length===1?'opção encontrada':'opções encontradas'}</strong><span>${data.location.lat!=null?'Distância calculada com sua localização':'Ative a localização para filtrar por distância'}</span></div>
    ${data.results.length?`<div class="results-grid">${data.results.map(shopCard).join('')}</div>`:empty('✂️','Nenhuma combinação encontrada','Tente ampliar a distância, preço ou remover algum filtro.')}
  </section>`;
  document.getElementById('searchForm').addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);for(const [k,v] of fd.entries())state.filters[k]=v;appEl.innerHTML=loader();await renderDiscover();});
}

async function renderShop(shopId){
  const q=new URLSearchParams(); if(state.filters.lat!=='')q.set('lat',state.filters.lat);if(state.filters.lng!=='')q.set('lng',state.filters.lng);
  const {shop}=await api(`/api/shops/${shopId}?${q}`);
  appEl.innerHTML=`<section class="page">
    <div class="detail-cover"><img src="${esc(shop.photo||'/assets/shop-default.svg')}" alt="${esc(shop.name)}"><div class="detail-info"><div>${shop.featured?'<span class="badge gold">★ Em destaque</span>':''}<h1>${esc(shop.name)}</h1><p>${esc(shop.description)}</p><div class="meta-line" style="color:#ddd"><span>${stars(shop.rating)} (${shop.reviewCount})</span><span>•</span><span>${shop.distanceKm!=null?`${shop.distanceKm} km • `:''}${esc(shop.address)}, ${esc(shop.city)} - ${esc(shop.state)}</span></div></div><div class="detail-actions"><button class="btn light" data-action="favorite-shop" data-id="${shop.id}">${isFavShop(shop.id)?'♥ Favoritada':'♡ Favoritar'}</button><button class="btn primary" data-action="book" data-shop="${shop.id}">Agendar agora</button></div></div></div>
    <div class="detail-grid"><div>
      <div class="content-card"><div class="section-title"><div><h2>Serviços e preços</h2><p>Escolha o serviço ideal antes de reservar.</p></div></div><div class="list">${shop.services.map(s=>`<div class="list-row"><div><h4>${esc(s.name)}</h4><p>${esc(s.description)} • ${s.duration} min</p><div class="tags" style="margin-top:6px">${(s.styles||[]).map(x=>`<span class="tag">${esc(x)}</span>`).join('')}</div></div><div class="text-right"><div class="price">${money(s.price)}</div><button class="btn sm dark" data-action="book" data-shop="${shop.id}" data-service="${s.id}">Agendar</button></div></div>`).join('')||'<div class="muted">Nenhum serviço cadastrado.</div>'}</div></div>
      <div class="content-card" style="margin-top:16px"><div class="section-title"><div><h2>Profissionais</h2><p>Escolha pelo estilo, portfólio e avaliação.</p></div></div><div class="barber-grid">${shop.barbers.map(b=>`<a class="barber-card" href="#/barber/${b.id}"><img src="${esc(b.photo||'/assets/barber-default.svg')}" alt="${esc(b.name)}"><div><h4>${esc(b.name)}</h4><div class="muted" style="font-size:12px">${stars(b.rating)} • ${b.reviewCount} avaliações</div><div class="tags" style="margin-top:6px">${(b.specialties||[]).slice(0,3).map(x=>`<span class="tag">${esc(x)}</span>`).join('')}</div></div></a>`).join('')||'<div class="muted">Nenhum barbeiro cadastrado.</div>'}</div></div>
      <div class="content-card" style="margin-top:16px"><div class="section-title"><div><h2>Trabalhos reais</h2><p>Portfólio cadastrado pelos profissionais.</p></div></div>${shop.portfolio.length?`<div class="portfolio-grid">${shop.portfolio.map(p=>`<div class="portfolio-item"><img src="${esc(p.imageUrl)}" alt="${esc(p.title)}"><span>${esc(p.title)}</span></div>`).join('')}</div>`:'<div class="muted">Nenhuma foto cadastrada ainda.</div>'}</div>
      <div class="content-card" style="margin-top:16px"><div class="section-title"><div><h2>Avaliações</h2><p>Experiências de clientes após o atendimento.</p></div></div>${shop.reviews.length?shop.reviews.map(r=>`<div class="review"><div class="review-head"><strong>${esc(r.userName)}</strong><span>${stars(r.rating)}</span></div><div class="muted" style="font-size:12px">${shortDate(r.createdAt)}${r.barberName?` • com ${esc(r.barberName)}`:''}</div><p>${esc(r.comment||'Sem comentário.')}</p></div>`).join(''):'<div class="muted">Ainda não há avaliações.</div>'}</div>
    </div><aside class="side-card"><span class="kicker">Informações</span><h3 style="margin:5px 0 12px">${esc(shop.name)}</h3><div class="list"><div><strong>Ambiente</strong><div class="tags" style="margin-top:6px">${(shop.ambienceStyles||[]).map(x=>`<span class="tag">${esc(x)}</span>`).join('')}</div></div><div><strong>Faixa de preço</strong><div class="muted">${money(shop.minPrice)} a ${money(shop.maxPrice)}</div></div><div><strong>Endereço</strong><div class="muted">${esc(shop.address)}<br>${esc(shop.city)} - ${esc(shop.state)} • ${esc(shop.zip)}</div></div><div><strong>Contato</strong><div class="muted">${esc(shop.phone||'Não informado')}</div></div></div><div class="divider"></div><button class="btn primary block" data-action="book" data-shop="${shop.id}">Escolher horário</button><button class="btn light block" style="margin-top:8px" data-action="toggle-compare" data-id="${shop.id}">${state.compare.has(shop.id)?'✓ Na comparação':'Adicionar à comparação'}</button></aside></div>
  </section>`;
}

async function renderBarber(barberId){
  const {barber,services}=await api(`/api/barbers/${barberId}`);
  const days=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  appEl.innerHTML=`<section class="page narrow"><a href="#/shop/${barber.shop.id}" class="muted">← Voltar para ${esc(barber.shop.name)}</a><div class="panel" style="margin-top:14px"><div style="display:grid;grid-template-columns:180px 1fr;gap:22px;align-items:start"><img src="${esc(barber.photo||'/assets/barber-default.svg')}" style="width:180px;height:180px;border-radius:22px;object-fit:cover" alt="${esc(barber.name)}"><div><span class="kicker">Profissional</span><h1 style="font-size:42px;letter-spacing:-.045em;margin:4px 0">${esc(barber.name)}</h1><div>${stars(barber.rating)} • ${barber.reviewCount} avaliações</div><p class="muted">${esc(barber.bio)}</p><div class="tags">${(barber.specialties||[]).map(x=>`<span class="tag">${esc(x)}</span>`).join('')}</div><div class="inline" style="margin-top:15px"><button class="btn dark" data-action="book" data-shop="${barber.shop.id}" data-barber="${barber.id}">Agendar com ${esc(barber.name.split(' ')[0])}</button><button class="btn light" data-action="favorite-barber" data-id="${barber.id}">${isFavBarber(barber.id)?'♥ Favorito':'♡ Favoritar'}</button></div></div></div>
      <div class="divider"></div><div class="stat-grid"><div class="stat"><small>Horário</small><strong style="font-size:20px">${esc(barber.schedule?.start)}–${esc(barber.schedule?.end)}</strong></div><div class="stat"><small>Dias de atendimento</small><strong style="font-size:16px">${(barber.schedule?.days||[]).map(d=>days[d]).join(', ')}</strong></div><div class="stat"><small>Barbearia</small><strong style="font-size:16px">${esc(barber.shop.name)}</strong></div><div class="stat"><small>Serviços a partir de</small><strong style="font-size:20px">${money(Math.min(...services.map(s=>s.price)))}</strong></div></div>
      <div class="section-title"><div><h2>Portfólio</h2><p>Trabalhos cadastrados por este profissional.</p></div></div>${barber.portfolio.length?`<div class="portfolio-grid">${barber.portfolio.map(p=>`<div class="portfolio-item"><img src="${esc(p.imageUrl)}"><span>${esc(p.title)}</span></div>`).join('')}</div>`:empty('📷','Sem fotos ainda','Este profissional ainda não publicou trabalhos.')}
      <div class="section-title"><div><h2>Avaliações do barbeiro</h2></div></div>${barber.reviews.length?barber.reviews.map(r=>`<div class="review"><div class="review-head"><strong>${esc(r.userName)}</strong><span>${stars(r.rating)}</span></div><p>${esc(r.comment||'Sem comentário.')}</p></div>`).join(''):'<div class="muted">Sem avaliações.</div>'}
    </div></section>`;
}

async function bookingModal(shopId,preBarber='',preService=''){
  if(!state.me){ showAuth('login',()=>bookingModal(shopId,preBarber,preService)); return; }
  if(state.me.role!=='customer'){toast('Agendamentos são feitos por contas de cliente.','error');return;}
  const {shop}=await api(`/api/shops/${shopId}`);
  const minDate=new Date(); minDate.setMinutes(minDate.getMinutes()-minDate.getTimezoneOffset()); const min=minDate.toISOString().slice(0,10);
  openModal(modalShell('Agendar horário',`<form id="bookingForm"><div class="form-grid"><div class="field"><label>Barbeiro</label><select name="barberId" id="bookBarber" required><option value="">Selecione</option>${shop.barbers.map(b=>`<option value="${b.id}" ${preBarber===b.id?'selected':''}>${esc(b.name)} — ${esc((b.specialties||[]).join(', '))}</option>`).join('')}</select></div><div class="field"><label>Serviço</label><select name="serviceId" id="bookService" required><option value="">Selecione</option>${shop.services.map(s=>`<option value="${s.id}" ${preService===s.id?'selected':''}>${esc(s.name)} — ${money(s.price)} (${s.duration} min)</option>`).join('')}</select></div><div class="field span-2"><label>Data</label><input type="date" name="date" id="bookDate" min="${min}" value="${min}" required></div></div><div class="section-title"><div><h3>Horários disponíveis</h3><p id="slotHint">Selecione barbeiro, serviço e data.</p></div></div><div id="slotGrid" class="slot-grid"></div><input type="hidden" name="time" id="bookTime"><div class="form-actions"><button type="button" class="btn light" data-action="close-modal">Cancelar</button><button class="btn primary" type="submit">Confirmar agendamento</button></div></form>`));
  const form=document.getElementById('bookingForm');
  async function loadSlots(){
    const barberId=document.getElementById('bookBarber').value,serviceId=document.getElementById('bookService').value,date=document.getElementById('bookDate').value,grid=document.getElementById('slotGrid'),hint=document.getElementById('slotHint');
    state.selectedSlot=null;document.getElementById('bookTime').value='';grid.innerHTML='';
    if(!barberId||!serviceId||!date){hint.textContent='Selecione barbeiro, serviço e data.';return;}
    hint.textContent='Carregando horários...';
    try{const d=await api(`/api/shops/${shop.id}/slots?barberId=${encodeURIComponent(barberId)}&serviceId=${encodeURIComponent(serviceId)}&date=${date}`);hint.textContent=d.slots.length?`${d.slots.length} horários livres`:'Nenhum horário livre nessa data.';grid.innerHTML=d.slots.map(s=>`<button type="button" class="slot-btn" data-action="select-slot" data-time="${s.time}">${s.time}</button>`).join('');}catch(e){hint.textContent=e.message;}
  }
  ['bookBarber','bookService','bookDate'].forEach(id=>document.getElementById(id).addEventListener('change',loadSlots)); if(preBarber&&preService)loadSlots();
  form.addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(form);const body=Object.fromEntries(fd.entries());body.shopId=shop.id;if(!body.time){toast('Escolha um horário.','error');return;}try{await api('/api/appointments',{method:'POST',body});closeModal();toast('Agendamento criado! A barbearia poderá confirmá-lo.');goto('appointments');}catch(err){toast(err.message,'error');loadSlots();}});
}

async function renderCompare(){
  const ids=[...state.compare];
  if(!ids.length){appEl.innerHTML=`<section class="page"><div class="page-head"><div><h1>Compare barbearias</h1><p>Preço, distância, avaliação, ambiente e profissionais lado a lado.</p></div></div>${empty('⚖️','Sua comparação está vazia','Adicione até 3 barbearias pela tela de descoberta.','<a class="btn dark" href="#/discover">Descobrir barbearias</a>')}</section>`;return;}
  const shops=(await Promise.all(ids.map(async id=>{try{return (await api(`/api/shops/${id}`)).shop}catch{return null}}))).filter(Boolean); if(shops.length!==ids.length){state.compare=new Set(shops.map(s=>s.id));saveCompare();}
  const rows=[
    ['Avaliação',s=>`${stars(s.rating)} (${s.reviewCount})`],['Preço',s=>`${money(s.minPrice)} – ${money(s.maxPrice)}`],['Distância',s=>s.distanceKm!=null?`${s.distanceKm} km`:'Use sua localização'],['Ambiente',s=>(s.ambienceStyles||[]).map(x=>`<span class="tag">${esc(x)}</span>`).join(' ')],['Profissionais',s=>s.barbers.map(b=>esc(b.name)).join('<br>')],['Especialidades',s=>[...new Set(s.barbers.flatMap(b=>b.specialties||[]))].map(x=>`<span class="tag">${esc(x)}</span>`).join(' ')],['Serviços',s=>s.services.slice(0,5).map(x=>`${esc(x.name)} <strong>${money(x.price)}</strong>`).join('<br>')],['Endereço',s=>`${esc(s.address)}<br><span class="muted">${esc(s.city)} - ${esc(s.state)}</span>`]
  ];
  appEl.innerHTML=`<section class="page"><div class="page-head"><div><h1>Compare barbearias</h1><p>Escolha com informação, não no escuro.</p></div><a class="btn light" href="#/discover">+ Adicionar outra</a></div><div class="table-wrap"><table class="compare-table"><thead><tr><th>Critério</th>${shops.map(s=>`<th class="compare-shop"><img src="${esc(s.photo)}"><div class="inline"><strong>${esc(s.name)}</strong><span class="spacer"></span><button class="btn sm ghost" data-action="toggle-compare" data-id="${s.id}">Remover</button></div></th>`).join('')}</tr></thead><tbody>${rows.map(([label,fn])=>`<tr><td><strong>${label}</strong></td>${shops.map(s=>`<td>${fn(s)}</td>`).join('')}</tr>`).join('')}<tr><td><strong>Ação</strong></td>${shops.map(s=>`<td><button class="btn primary block" data-action="book" data-shop="${s.id}">Agendar</button><a class="btn light block" style="margin-top:7px" href="#/shop/${s.id}">Ver perfil</a></td>`).join('')}</tr></tbody></table></div></section>`;
}

async function renderAppointments(){
  if(!state.me){appEl.innerHTML=`<section class="page narrow">${empty('📅','Entre para ver seus agendamentos','Acesse sua conta de cliente para consultar, cancelar e avaliar atendimentos.','<button class="btn dark" data-action="auth">Entrar</button>')}</section>`;return;}
  if(state.me.role!=='customer'){appEl.innerHTML=`<section class="page narrow">${empty('📅','Área exclusiva de clientes','Use a área da barbearia para gerenciar os atendimentos do estabelecimento.')}</section>`;return;}
  const {appointments}=await api('/api/appointments/mine'); const upcoming=appointments.filter(a=>new Date(a.start)>new Date()&&a.status!=='cancelled'); const history=appointments.filter(a=>!upcoming.includes(a));
  const card=a=>`<div class="booking-card"><div class="booking-head"><div><div class="booking-time">${dateTime(a.start)}</div><strong>${esc(a.shop?.name||'Barbearia')}</strong><div class="muted">${esc(a.service?.name||'Serviço')} com ${esc(a.barber?.name||'Profissional')}</div></div><span class="status ${a.status}">${statusLabel(a.status)}</span></div><div class="inline" style="margin-top:12px"><a class="btn sm light" href="#/shop/${a.shopId}">Ver barbearia</a>${['pending','confirmed'].includes(a.status)&&new Date(a.start)>new Date()?`<button class="btn sm danger" data-action="cancel-appointment" data-id="${a.id}">Cancelar</button>`:''}${a.status==='completed'&&!a.review?`<button class="btn sm primary" data-action="review" data-id="${a.id}" data-shop="${esc(a.shop?.name)}" data-barber="${esc(a.barber?.name)}">Avaliar</button>`:''}${a.review?`<span class="badge green">Avaliado ${'★'.repeat(a.review.rating)}</span>`:''}</div></div>`;
  appEl.innerHTML=`<section class="page narrow"><div class="page-head"><div><h1>Meus agendamentos</h1><p>Acompanhe seus próximos horários e o histórico.</p></div><a class="btn dark" href="#/discover">Novo agendamento</a></div><div class="section-title"><div><h2>Próximos</h2></div></div>${upcoming.length?upcoming.map(card).join(''):empty('🗓️','Nada marcado','Você ainda não tem horários futuros.','<a class="btn dark" href="#/discover">Encontrar barbearia</a>')}<div class="section-title"><div><h2>Histórico</h2></div></div>${history.length?history.map(card).join(''):'<div class="muted">Nenhum atendimento no histórico.</div>'}</section>`;
}

function reviewModal(id,shop,barber){
  openModal(modalShell('Avaliar atendimento',`<p class="muted">Sua avaliação ficará no perfil de <strong>${esc(shop)}</strong> e também do profissional <strong>${esc(barber)}</strong>.</p><form id="reviewForm"><div class="field"><label>Nota</label><select name="rating" required><option value="5">★★★★★ — Excelente</option><option value="4">★★★★☆ — Muito bom</option><option value="3">★★★☆☆ — Bom</option><option value="2">★★☆☆☆ — Regular</option><option value="1">★☆☆☆☆ — Ruim</option></select></div><div class="field" style="margin-top:12px"><label>Comentário</label><textarea name="comment" placeholder="Conte como foi sua experiência..."></textarea></div><div class="form-actions"><button type="button" class="btn light" data-action="close-modal">Cancelar</button><button class="btn primary">Publicar avaliação</button></div></form>`));
  document.getElementById('reviewForm').addEventListener('submit',async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget).entries());body.appointmentId=id;try{await api('/api/reviews',{method:'POST',body});closeModal();toast('Avaliação publicada. Obrigado!');renderAppointments();}catch(err){toast(err.message,'error')}});
}

async function renderProfile(){
  if(!state.me){appEl.innerHTML=`<section class="page narrow">${empty('👤','Sua conta no Deu Régua','Entre ou crie uma conta para salvar preferências, favoritos e agendamentos.','<button class="btn dark" data-action="auth">Entrar ou criar conta</button>')}</section>`;return;}
  let favorites=[];
  if(state.me.role==='customer') favorites=(await Promise.all((state.me.profile?.favoriteShopIds||[]).map(async id=>{try{return (await api(`/api/shops/${id}`)).shop}catch{return null}}))).filter(Boolean);
  const p=state.me.profile||{};
  appEl.innerHTML=`<section class="page narrow"><div class="page-head"><div><h1>Minha conta</h1><p>Gerencie seus dados${state.me.role==='customer'?', localização e preferências':''}.</p></div></div><div class="panel"><form id="profileForm"><div class="form-grid"><div class="field"><label>Nome</label><input name="name" value="${esc(state.me.name)}" required></div><div class="field"><label>Telefone</label><input name="phone" value="${esc(state.me.phone||'')}"></div><div class="field span-2"><label>E-mail</label><input value="${esc(state.me.email)}" disabled><span class="hint">O e-mail de acesso não é alterado por esta tela.</span></div>${state.me.role==='customer'?`<div class="field span-2"><label>Localização</label><div class="inline"><input style="flex:1" name="locationName" value="${esc(p.locationName||'')}" placeholder="Ex.: Belo Horizonte, MG"><button type="button" class="btn light" data-action="use-location">⌖ Capturar localização</button></div></div><input type="hidden" name="lat" value="${esc(p.lat??'')}"><input type="hidden" name="lng" value="${esc(p.lng??'')}"><div class="field"><label>Preço mínimo preferido</label><input type="number" name="priceMin" min="0" step="5" value="${esc(p.priceMin??0)}"></div><div class="field"><label>Preço máximo preferido</label><input type="number" name="priceMax" min="0" step="5" value="${esc(p.priceMax??100)}"></div><div class="field span-2"><label>Cortes/serviços preferidos</label><input name="preferredCuts" value="${esc((p.preferredCuts||[]).join(', '))}" placeholder="Degradê, Freestyle, Barba"></div><div class="field span-2"><label>Ambientes preferidos</label><input name="preferredAmbience" value="${esc((p.preferredAmbience||[]).join(', '))}" placeholder="Moderno, Clássico, Tranquilo"></div>`:''}</div><div class="form-actions"><button class="btn dark">Salvar alterações</button></div></form></div>${state.me.role==='customer'?`<div class="section-title"><div><h2>Barbearias favoritas</h2><p>Seus lugares salvos para encontrar rápido depois.</p></div></div>${favorites.length?`<div class="results-grid" style="grid-template-columns:repeat(2,1fr)">${favorites.map(shopCard).join('')}</div>`:empty('♡','Nenhuma favorita ainda','Favorite barbearias na busca para elas aparecerem aqui.')}`:''}</section>`;
  document.getElementById('profileForm').addEventListener('submit',async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget).entries());try{const d=await api('/api/profile',{method:'PUT',body});state.me=d.user;updateNav();toast('Perfil atualizado.');renderProfile();}catch(err){toast(err.message,'error')}});
}

function ownerSidebar(){const tabs=[['overview','Visão geral'],['appointments','Agenda'],['barbers','Barbeiros'],['services','Serviços'],['portfolio','Portfólio'],['reviews','Avaliações'],['shop','Perfil da barbearia'],['reports','Relatórios'],['plan','Plano']];return `<aside class="sidebar">${tabs.map(([id,label])=>`<button class="side-link ${state.ownerTab===id?'active':''}" data-action="owner-tab" data-tab="${id}">${label}</button>`).join('')}</aside>`;}

async function renderOwner(){
  if(!state.me){appEl.innerHTML=`<section class="page narrow">${empty('💈','Área da barbearia','Entre com uma conta de estabelecimento para cadastrar profissionais, serviços e horários.','<button class="btn dark" data-action="auth">Entrar</button>')}</section>`;return;}
  if(state.me.role!=='owner'){appEl.innerHTML=`<section class="page narrow">${empty('🔒','Acesso restrito','Esta área é destinada às contas de barbearia.')}</section>`;return;}
  const {shop}=await api('/api/owner/shop');
  if(!shop){
    appEl.innerHTML=`<section class="page narrow"><div class="page-head"><div><h1>Cadastre sua barbearia</h1><p>Crie o perfil do estabelecimento para começar a receber agendamentos.</p></div></div><div class="panel"><div class="note">A latitude e longitude permitem calcular distância sem depender de uma API paga de mapas. Você pode copiar as coordenadas do endereço ou usar a localização do navegador estando no local.</div><form id="shopCreateForm" style="margin-top:16px"><div class="form-grid"><div class="field span-2"><label>Nome do estabelecimento</label><input name="name" required></div><div class="field span-2"><label>Descrição</label><textarea name="description"></textarea></div><div class="field span-2"><label>Endereço</label><input name="address"></div><div class="field"><label>Cidade</label><input name="city"></div><div class="field"><label>UF</label><input name="state" maxlength="2"></div><div class="field"><label>CEP</label><input name="zip"></div><div class="field"><label>Telefone</label><input name="phone"></div><div class="field"><label>Latitude</label><input name="lat" type="number" step="any" required></div><div class="field"><label>Longitude</label><input name="lng" type="number" step="any" required></div><div class="field span-2"><label>Estilos do ambiente</label><input name="ambienceStyles" placeholder="Moderno, Clássico, Premium, Street..."></div></div><div class="form-actions"><button type="button" class="btn light" data-action="fill-owner-location">Usar localização atual</button><button class="btn primary">Criar barbearia</button></div></form></div></section>`;
    document.getElementById('shopCreateForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/owner/shop',{method:'POST',body:Object.fromEntries(new FormData(e.currentTarget).entries())});toast('Barbearia cadastrada!');state.ownerTab='overview';renderOwner();}catch(err){toast(err.message,'error')}});return;
  }
  const [appointments,reports]=await Promise.all([api('/api/owner/appointments'),api('/api/owner/reports')]);
  let content='';
  if(state.ownerTab==='overview') content=ownerOverview(shop,appointments.appointments,reports.report);
  if(state.ownerTab==='appointments') content=ownerAppointments(appointments.appointments);
  if(state.ownerTab==='barbers') content=ownerBarbers(shop);
  if(state.ownerTab==='services') content=ownerServices(shop);
  if(state.ownerTab==='portfolio') content=ownerPortfolio(shop);
  if(state.ownerTab==='reviews') content=ownerReviews(shop);
  if(state.ownerTab==='shop') content=ownerShopForm(shop);
  if(state.ownerTab==='reports') content=ownerReports(reports.report);
  if(state.ownerTab==='plan') content=ownerPlan(shop);
  appEl.innerHTML=`<section class="page"><div class="page-head"><div><span class="kicker">Área da barbearia</span><h1>${esc(shop.name)}</h1><p>Gerencie perfil, equipe, agenda e desempenho.</p></div><a class="btn light" href="#/shop/${shop.id}">Ver perfil público ↗</a></div><div class="profile-grid">${ownerSidebar()}<div>${content}</div></div></section>`;
  attachOwnerHandlers(shop);
}

function ownerOverview(shop,appointments,report){
  const now=new Date(),today=now.toDateString(),day=now.getDay();
  const todayA=appointments.filter(a=>new Date(a.start).toDateString()===today&&a.status!=='cancelled');
  const pending=appointments.filter(a=>a.status==='pending').length;
  const availability=(shop.barbers||[]).filter(b=>(b.schedule?.days||[]).includes(day)&&b.active!==false).map(b=>{
    const [sh,sm]=(b.schedule?.start||'09:00').split(':').map(Number),[eh,em]=(b.schedule?.end||'19:00').split(':').map(Number);
    let free=0,occupied=0; const pills=[];
    for(let m=sh*60+sm;m<eh*60+em;m+=30){
      const h=Math.floor(m/60),mi=m%60,slotStart=new Date(now.getFullYear(),now.getMonth(),now.getDate(),h,mi),slotEnd=new Date(slotStart.getTime()+30*60000);
      const ap=todayA.find(a=>a.barberId===b.id&&new Date(a.start)<slotEnd&&new Date(a.end)>slotStart);
      if(ap)occupied++; else free++;
      if(pills.length<12)pills.push(`<span class="tag" style="${ap?'background:#f6e3e1;border-color:#eac3bf;color:#7b3029':'background:#e8f5ed;border-color:#c4e2cf;color:#2b6946'}">${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')} ${ap?'ocupado':'livre'}</span>`);
    }
    return `<div class="list-row" style="align-items:flex-start"><div><h4>${esc(b.name)}</h4><p>${esc(b.schedule?.start)}–${esc(b.schedule?.end)} • ${free} intervalos livres • ${occupied} ocupados</p><div class="tags" style="margin-top:8px">${pills.join('')}${free+occupied>12?'<span class="tag">…</span>':''}</div></div></div>`;
  }).join('');
  return `<div class="stat-grid"><div class="stat"><small>Agendamentos hoje</small><strong>${todayA.length}</strong></div><div class="stat"><small>Pendentes de confirmação</small><strong>${pending}</strong></div><div class="stat"><small>Avaliação média</small><strong>${report?.avgRating||0} ★</strong></div><div class="stat"><small>Plano</small><strong style="font-size:20px;text-transform:capitalize">${esc(shop.plan)}</strong></div></div><div class="panel" style="margin-top:16px"><div class="section-title"><div><h2>Agenda de hoje</h2><p>Cliente, serviço, profissional e status em um único lugar.</p></div></div>${todayA.length?todayA.map(a=>`<div class="list-row"><div><h4>${dateTime(a.start)} — ${esc(a.client?.name)}</h4><p>${esc(a.service?.name)} com ${esc(a.barber?.name)}</p></div><span class="status ${a.status}">${statusLabel(a.status)}</span></div>`).join(''):empty('✓','Agenda livre hoje','Nenhum atendimento marcado para hoje.')}<div class="section-title"><div><h3>Disponibilidade por barbeiro</h3><p>Prévia em blocos de 30 minutos: verde livre, vermelho ocupado.</p></div></div>${availability||'<div class="muted">Nenhum barbeiro configurado para trabalhar hoje.</div>'}</div>`;
}
function ownerAppointments(items){return `<div class="panel"><div class="section-title"><div><h2>Gerenciar agendamentos</h2><p>Confirme, conclua ou cancele atendimentos.</p></div></div>${items.length?items.map(a=>`<div class="booking-card"><div class="booking-head"><div><strong>${esc(a.client?.name||'Cliente')}</strong><div class="booking-time">${dateTime(a.start)}</div><div class="muted">${esc(a.service?.name)} • ${esc(a.barber?.name)}</div></div><span class="status ${a.status}">${statusLabel(a.status)}</span></div><div class="inline" style="margin-top:10px"><select class="owner-status" data-id="${a.id}" style="padding:8px;border:1px solid var(--line);border-radius:9px"><option value="pending" ${a.status==='pending'?'selected':''}>Pendente</option><option value="confirmed" ${a.status==='confirmed'?'selected':''}>Confirmado</option><option value="completed" ${a.status==='completed'?'selected':''}>Concluído</option><option value="cancelled" ${a.status==='cancelled'?'selected':''}>Cancelado</option></select></div></div>`).join(''):empty('📅','Sem agendamentos','Os horários reservados pelos clientes aparecerão aqui.')}</div>`;}
function ownerBarbers(shop){return `<div class="panel"><div class="section-title"><div><h2>Barbeiros</h2><p>Perfis individuais, especialidades e agenda semanal.</p></div><button class="btn primary" data-action="add-barber">+ Barbeiro</button></div><div class="list">${shop.barbers.map(b=>`<div class="list-row"><div class="inline"><img src="${esc(b.photo||'/assets/barber-default.svg')}" style="width:54px;height:54px;border-radius:12px;object-fit:cover"><div><h4>${esc(b.name)}</h4><p>${esc((b.specialties||[]).join(' • '))} • ${esc(b.schedule?.start)}–${esc(b.schedule?.end)}</p></div></div><div class="inline"><span class="badge ${b.active?'green':'red'}">${b.active?'Ativo':'Inativo'}</span><button class="btn sm light" data-action="edit-barber" data-id="${b.id}">Editar</button><button class="btn sm danger" data-action="delete-barber" data-id="${b.id}">Excluir</button></div></div>`).join('')||'<div class="muted">Cadastre o primeiro profissional.</div>'}</div></div>`;}
function ownerServices(shop){return `<div class="panel"><div class="section-title"><div><h2>Serviços e preços</h2><p>Defina duração, valor e estilos relacionados.</p></div><button class="btn primary" data-action="add-service">+ Serviço</button></div><div class="list">${shop.services.map(s=>`<div class="list-row"><div><h4>${esc(s.name)}</h4><p>${esc(s.description)} • ${s.duration} min</p><div class="tags" style="margin-top:5px">${(s.styles||[]).map(x=>`<span class="tag">${esc(x)}</span>`).join('')}</div></div><div class="text-right"><div class="price">${money(s.price)}</div><div class="inline"><button class="btn sm light" data-action="edit-service" data-id="${s.id}">Editar</button><button class="btn sm danger" data-action="delete-service" data-id="${s.id}">Excluir</button></div></div></div>`).join('')||'<div class="muted">Cadastre seus serviços.</div>'}</div></div>`;}
function ownerPortfolio(shop){return `<div class="panel"><div class="section-title"><div><h2>Fotos dos trabalhos</h2><p>Ajude o cliente a escolher pelo resultado.</p></div><button class="btn primary" data-action="add-portfolio">+ Foto</button></div>${shop.portfolio.length?`<div class="portfolio-grid">${shop.portfolio.map(p=>`<div class="portfolio-item"><img src="${esc(p.imageUrl)}"><span>${esc(p.title)} <button style="border:0;background:transparent;color:#fff" data-action="delete-portfolio" data-id="${p.id}">×</button></span></div>`).join('')}</div>`:empty('📷','Portfólio vazio','Adicione fotos reais dos trabalhos da equipe.')}</div>`;}
function ownerReviews(shop){return `<div class="panel"><div class="section-title"><div><h2>Avaliações recebidas</h2><p>Feedback da barbearia e de cada profissional após os atendimentos.</p></div></div>${shop.reviews?.length?shop.reviews.map(r=>`<div class="review"><div class="review-head"><strong>${esc(r.userName)}</strong><span>${stars(r.rating)}</span></div><div class="muted" style="font-size:12px">${shortDate(r.createdAt)}${r.barberName?` • profissional: ${esc(r.barberName)}`:''}</div><p>${esc(r.comment||'Sem comentário.')}</p></div>`).join(''):empty('★','Sem avaliações ainda','As avaliações de atendimentos concluídos aparecerão aqui.')}</div>`;}
function ownerShopForm(shop){return `<div class="panel"><div class="section-title"><div><h2>Perfil do estabelecimento</h2><p>Essas informações aparecem para os clientes.</p></div></div><form id="ownerShopForm"><div class="form-grid"><div class="field span-2"><label>Nome</label><input name="name" value="${esc(shop.name)}"></div><div class="field span-2"><label>Descrição</label><textarea name="description">${esc(shop.description)}</textarea></div><div class="field span-2"><label>Endereço</label><input name="address" value="${esc(shop.address)}"></div><div class="field"><label>Cidade</label><input name="city" value="${esc(shop.city)}"></div><div class="field"><label>UF</label><input name="state" value="${esc(shop.state)}" maxlength="2"></div><div class="field"><label>CEP</label><input name="zip" value="${esc(shop.zip)}"></div><div class="field"><label>Telefone</label><input name="phone" value="${esc(shop.phone)}"></div><div class="field"><label>Latitude</label><input name="lat" type="number" step="any" value="${esc(shop.lat)}"></div><div class="field"><label>Longitude</label><input name="lng" type="number" step="any" value="${esc(shop.lng)}"></div><div class="field span-2"><label>Estilos de ambiente</label><input name="ambienceStyles" value="${esc((shop.ambienceStyles||[]).join(', '))}"></div></div><div class="form-actions"><button class="btn dark">Salvar perfil</button></div></form><div class="divider"></div><form id="shopPhotoForm"><div class="field"><label>Foto de capa</label><input type="file" name="image" accept="image/*" required><span class="hint">JPG, PNG, WEBP ou outro formato de imagem, até 5 MB. O arquivo fica no volume /data.</span></div><div class="form-actions"><button class="btn light">Enviar nova capa</button></div></form></div>`;}
function bars(items,labelKey='name'){const max=Math.max(1,...(items||[]).map(x=>x.count));return (items||[]).map(x=>`<div class="bar-line"><span>${esc(x[labelKey])}</span><strong>${x.count}</strong><div class="track"><div class="fill" style="width:${Math.round(x.count/max*100)}%"></div></div></div>`).join('')||'<div class="muted">Sem dados concluídos.</div>';}
function ownerReports(r){if(!r)return empty('📊','Sem relatório','Conclua atendimentos para gerar indicadores.');return `<div class="stat-grid"><div class="stat"><small>Agendamentos</small><strong>${r.totalAppointments}</strong></div><div class="stat"><small>Concluídos</small><strong>${r.completedAppointments}</strong></div><div class="stat"><small>Avaliação média</small><strong>${r.avgRating} ★</strong></div><div class="stat"><small>Novos clientes no mês</small><strong>${r.newClients}</strong></div></div><div class="report-grid" style="margin-top:16px"><div class="report-card"><h4>Serviços mais procurados</h4><div class="bar-list">${bars(r.topServices)}</div></div><div class="report-card"><h4>Horários mais movimentados</h4><div class="bar-list">${bars(r.busyHours,'hour')}</div></div><div class="report-card"><h4>Barbeiros mais procurados</h4><div class="bar-list">${bars(r.topBarbers)}</div></div></div>`;}
function ownerPlan(shop){return `<div class="panel"><div class="section-title"><div><h2>Plano e modelo de negócio</h2><p>Os valores seguem a proposta do escopo; cobrança real não está integrada.</p></div></div><div class="plan-grid">${state.meta.plans.map(p=>`<div class="plan-card ${p.id==='professional'?'featured':''}">${p.id==='professional'?'<span class="badge gold">Mais completo</span>':''}<h3>${esc(p.name)}</h3><div class="plan-price">${p.price?money(p.price):'Grátis'}${p.price?'<small>/mês</small>':''}</div><p class="muted">${esc(p.description)}</p><button class="btn ${shop.plan===p.id?'success':'dark'} block" data-action="select-plan" data-plan="${p.id}">${shop.plan===p.id?'✓ Plano atual':'Selecionar'}</button></div>`).join('')}</div><div class="note" style="margin-top:16px"><strong>Outros modelos previstos no projeto:</strong> divulgação paga para posições de destaque e comissão por agendamento (exemplo de 5%). Neste MVP, o destaque é administrado pelo painel do sistema e não há gateway de pagamento.</div></div>`;}

function attachOwnerHandlers(shop){
  document.querySelectorAll('.owner-status').forEach(sel=>sel.addEventListener('change',async e=>{try{await api(`/api/owner/appointments/${e.target.dataset.id}/status`,{method:'PATCH',body:{status:e.target.value}});toast('Status atualizado.');renderOwner();}catch(err){toast(err.message,'error')}}));
  const f=document.getElementById('ownerShopForm'); if(f)f.addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/owner/shop',{method:'PUT',body:Object.fromEntries(new FormData(e.currentTarget).entries())});toast('Perfil atualizado.');renderOwner();}catch(err){toast(err.message,'error')}});
  const pf=document.getElementById('shopPhotoForm'); if(pf)pf.addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/owner/shop-photo',{method:'POST',body:new FormData(e.currentTarget)});toast('Foto de capa atualizada.');renderOwner();}catch(err){toast(err.message,'error')}});
}

function barberModal(existing=null){
  const days=existing?.schedule?.days||[1,2,3,4,5,6]; const dayNames=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  openModal(modalShell(existing?'Editar barbeiro':'Novo barbeiro',`<form id="barberForm"><div class="form-grid"><div class="field span-2"><label>Nome</label><input name="name" value="${esc(existing?.name||'')}" required></div><div class="field span-2"><label>Bio</label><textarea name="bio">${esc(existing?.bio||'')}</textarea></div><div class="field span-2"><label>Especialidades</label><input name="specialties" value="${esc((existing?.specialties||[]).join(', '))}" placeholder="Degradê, Freestyle, Barba..."></div><div class="field span-2"><label>URL da foto (opcional)</label><input name="photo" value="${esc(existing?.photo||'')}"></div><div class="field"><label>Início</label><input type="time" name="start" value="${esc(existing?.schedule?.start||'09:00')}" required></div><div class="field"><label>Fim</label><input type="time" name="end" value="${esc(existing?.schedule?.end||'19:00')}" required></div><div class="field span-2"><label>Dias de trabalho</label><div class="checkbox-grid">${dayNames.map((n,i)=>`<label class="check-pill"><input type="checkbox" name="days" value="${i}" ${days.includes(i)?'checked':''}><span>${n}</span></label>`).join('')}</div></div></div><div class="form-actions"><button type="button" class="btn light" data-action="close-modal">Cancelar</button><button class="btn primary">Salvar</button></div></form>`));
  document.getElementById('barberForm').addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.currentTarget),body=Object.fromEntries([...fd.entries()].filter(([k])=>k!=='days'));body.days=fd.getAll('days').map(Number);try{await api(existing?`/api/owner/barbers/${existing.id}`:'/api/owner/barbers',{method:existing?'PUT':'POST',body});closeModal();toast('Barbeiro salvo.');renderOwner();}catch(err){toast(err.message,'error')}});
}
function serviceModal(existing=null){openModal(modalShell(existing?'Editar serviço':'Novo serviço',`<form id="serviceForm"><div class="form-grid"><div class="field span-2"><label>Nome</label><input name="name" value="${esc(existing?.name||'')}" required></div><div class="field span-2"><label>Descrição</label><textarea name="description">${esc(existing?.description||'')}</textarea></div><div class="field"><label>Preço</label><input name="price" type="number" min="0" step="0.01" value="${esc(existing?.price??'')}" required></div><div class="field"><label>Duração (min)</label><input name="duration" type="number" min="15" step="5" value="${esc(existing?.duration??30)}" required></div><div class="field span-2"><label>Estilos/cortes relacionados</label><input name="styles" value="${esc((existing?.styles||[]).join(', '))}" placeholder="Degradê, Social, Barba..."></div></div><div class="form-actions"><button type="button" class="btn light" data-action="close-modal">Cancelar</button><button class="btn primary">Salvar</button></div></form>`));document.getElementById('serviceForm').addEventListener('submit',async e=>{e.preventDefault();try{await api(existing?`/api/owner/services/${existing.id}`:'/api/owner/services',{method:existing?'PUT':'POST',body:Object.fromEntries(new FormData(e.currentTarget).entries())});closeModal();toast('Serviço salvo.');renderOwner();}catch(err){toast(err.message,'error')}});}
function portfolioModal(shop){openModal(modalShell('Adicionar trabalho',`<form id="portfolioForm"><div class="form-grid"><div class="field span-2"><label>Barbeiro</label><select name="barberId" required><option value="">Selecione</option>${shop.barbers.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></div><div class="field span-2"><label>Título</label><input name="title" placeholder="Ex.: Degradê baixo"></div><div class="field span-2"><label>Estilos</label><input name="styles" placeholder="Degradê, Freestyle"></div><div class="field span-2"><label>Imagem</label><input type="file" name="image" accept="image/*" required><span class="hint">A imagem será salva no volume persistente do Railway.</span></div></div><div class="form-actions"><button type="button" class="btn light" data-action="close-modal">Cancelar</button><button class="btn primary">Enviar foto</button></div></form>`));document.getElementById('portfolioForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/owner/portfolio',{method:'POST',body:new FormData(e.currentTarget)});closeModal();toast('Foto adicionada ao portfólio.');renderOwner();}catch(err){toast(err.message,'error')}});}

async function renderAdmin(){
  if(!state.me||state.me.role!=='admin'){appEl.innerHTML=`<section class="page narrow">${empty('🛡️','Área administrativa','Apenas administradores do sistema podem acessar esta tela.','<button class="btn dark" data-action="auth">Entrar</button>')}</section>`;return;}
  const [ov,users,shops,appointments,reviews]=await Promise.all([api('/api/admin/overview'),api('/api/admin/users'),api('/api/admin/shops'),api('/api/admin/appointments'),api('/api/admin/reviews')]);
  let content='';
  if(state.adminTab==='users') content=`<div class="panel"><div class="section-title"><div><h2>Usuários</h2><p>Gerenciamento de contas do sistema.</p></div></div><div class="table-wrap"><table class="admin-table"><thead><tr><th>Nome</th><th>E-mail</th><th>Tipo</th><th>Status</th><th>Ação</th></tr></thead><tbody>${users.users.map(u=>`<tr><td><strong>${esc(u.name)}</strong></td><td>${esc(u.email)}</td><td>${roleLabel(u.role)}</td><td><span class="badge ${u.active!==false?'green':'red'}">${u.active!==false?'Ativo':'Suspenso'}</span></td><td>${u.id===state.me.id?'<span class="muted">Conta atual</span>':`<button class="btn sm ${u.active!==false?'danger':'success'}" data-action="admin-user" data-id="${u.id}" data-active="${u.active===false}">${u.active!==false?'Suspender':'Ativar'}</button>`}</td></tr>`).join('')}</tbody></table></div></div>`;
  else if(state.adminTab==='appointments') content=`<div class="panel"><div class="section-title"><div><h2>Agendamentos</h2><p>Visão global e correção de status pelo sistema.</p></div></div><div class="table-wrap"><table class="admin-table"><thead><tr><th>Data</th><th>Cliente</th><th>Barbearia</th><th>Serviço / profissional</th><th>Status</th></tr></thead><tbody>${appointments.appointments.map(a=>`<tr><td>${dateTime(a.start)}</td><td>${esc(a.client?.name||'Cliente')}</td><td>${esc(a.shop?.name||'-')}</td><td>${esc(a.service?.name||'-')}<br><span class="muted">${esc(a.barber?.name||'-')}</span></td><td><select class="admin-appt-status" data-id="${a.id}" style="padding:7px;border:1px solid var(--line);border-radius:8px"><option value="pending" ${a.status==='pending'?'selected':''}>Pendente</option><option value="confirmed" ${a.status==='confirmed'?'selected':''}>Confirmado</option><option value="completed" ${a.status==='completed'?'selected':''}>Concluído</option><option value="cancelled" ${a.status==='cancelled'?'selected':''}>Cancelado</option></select></td></tr>`).join('')}</tbody></table></div></div>`;
  else if(state.adminTab==='reviews') content=`<div class="panel"><div class="section-title"><div><h2>Avaliações</h2><p>Moderação das avaliações publicadas no sistema.</p></div></div>${reviews.reviews.length?reviews.reviews.map(r=>`<div class="review"><div class="review-head"><div><strong>${esc(r.userName)}</strong> <span class="muted">em ${esc(r.shopName)}</span></div><span>${stars(r.rating)}</span></div><div class="muted" style="font-size:12px">Profissional: ${esc(r.barberName)} • ${shortDate(r.createdAt)}</div><p>${esc(r.comment||'Sem comentário.')}</p><button class="btn sm danger" data-action="admin-delete-review" data-id="${r.id}">Remover avaliação</button></div>`).join(''):empty('★','Sem avaliações','Não há avaliações para moderar.')}</div>`;
  else content=`<div class="panel"><div class="section-title"><div><h2>Barbearias</h2><p>Controle de disponibilidade e posições de destaque.</p></div></div><div class="table-wrap"><table class="admin-table"><thead><tr><th>Estabelecimento</th><th>Plano</th><th>Avaliação</th><th>Status</th><th>Destaque</th><th>Ações</th></tr></thead><tbody>${shops.shops.map(s=>`<tr><td><strong>${esc(s.name)}</strong><br><span class="muted">${esc(s.city)} - ${esc(s.state)}</span></td><td>${esc(s.plan)}</td><td>${stars(s.rating)}</td><td><span class="badge ${s.active!==false?'green':'red'}">${s.active!==false?'Ativa':'Suspensa'}</span></td><td>${s.featured?'★ Sim':'Não'}</td><td><div class="inline"><button class="btn sm ${s.active!==false?'danger':'success'}" data-action="admin-shop-active" data-id="${s.id}" data-active="${s.active===false}">${s.active!==false?'Suspender':'Ativar'}</button><button class="btn sm light" data-action="admin-shop-feature" data-id="${s.id}" data-featured="${!s.featured}">${s.featured?'Remover destaque':'Destacar'}</button></div></td></tr>`).join('')}</tbody></table></div></div>`;
  appEl.innerHTML=`<section class="page"><div class="page-head"><div><span class="kicker">Sistema</span><h1>Administração</h1><p>Gerenciamento de usuários, barbearias, agendamentos e avaliações.</p></div></div><div class="stat-grid"><div class="stat"><small>Usuários</small><strong>${ov.overview.users}</strong></div><div class="stat"><small>Barbearias ativas</small><strong>${ov.overview.activeShops}</strong></div><div class="stat"><small>Agendamentos</small><strong>${ov.overview.appointments}</strong></div><div class="stat"><small>Avaliações</small><strong>${ov.overview.reviews}</strong></div></div><div class="tabbar" style="margin-top:18px"><button class="tab ${state.adminTab==='shops'?'active':''}" data-action="admin-tab" data-tab="shops">Barbearias</button><button class="tab ${state.adminTab==='users'?'active':''}" data-action="admin-tab" data-tab="users">Usuários</button><button class="tab ${state.adminTab==='appointments'?'active':''}" data-action="admin-tab" data-tab="appointments">Agendamentos</button><button class="tab ${state.adminTab==='reviews'?'active':''}" data-action="admin-tab" data-tab="reviews">Avaliações</button></div>${content}</section>`;
  document.querySelectorAll('.admin-appt-status').forEach(sel=>sel.addEventListener('change',async e=>{try{await api(`/api/admin/appointments/${e.target.dataset.id}/status`,{method:'PATCH',body:{status:e.target.value}});toast('Status atualizado.');renderAdmin();}catch(err){toast(err.message,'error')}}));
}

async function renderPlans(){
  appEl.innerHTML=`<section class="page"><div class="page-head"><div><span class="kicker">Modelo de negócio</span><h1>Planos para barbearias</h1><p>Cadastro gratuito, assinatura e possibilidades de divulgação em destaque.</p></div>${state.me?.role==='owner'?'<a class="btn dark" href="#/owner">Gerenciar meu plano</a>':'<button class="btn dark" data-action="auth" data-tab="register">Cadastrar estabelecimento</button>'}</div><div class="plan-grid">${state.meta.plans.map(p=>`<div class="plan-card ${p.id==='professional'?'featured':''}">${p.id==='professional'?'<span class="badge gold">Profissional</span>':''}<h3>${esc(p.name)}</h3><div class="plan-price">${p.price?money(p.price):'Grátis'}${p.price?'<small>/mês</small>':''}</div><p>${esc(p.description)}</p><ul>${p.id==='freemium'?'<li>Perfil padronizado</li><li>Serviços e profissionais</li><li>Recebimento de agendamentos</li>':p.id==='basic'?'<li>Tudo do Freemium</li><li>Gestão completa da agenda</li><li>Portfólio e avaliações</li>':'<li>Tudo do Básico</li><li>Relatórios do estabelecimento</li><li>Recursos avançados de divulgação</li>'}</ul></div>`).join('')}</div><div class="panel" style="margin-top:18px"><h2>Outros modelos previstos</h2><div class="form-grid"><div class="note"><strong>Divulgação</strong><br>A barbearia pode pagar para aparecer em posições de destaque.</div><div class="note"><strong>Comissão — a decidir</strong><br>Exemplo do escopo: 5% por agendamento. O MVP não executa cobrança financeira.</div></div></div></section>`;
}

function showAuth(tab='login',after=null){
  const render=(mode)=>{openModal(modalShell(mode==='login'?'Entrar no Deu Régua':'Criar sua conta',`<div class="auth-tabs"><button class="auth-tab ${mode==='login'?'active':''}" data-auth-tab="login">Entrar</button><button class="auth-tab ${mode==='register'?'active':''}" data-auth-tab="register">Criar conta</button></div>${mode==='login'?`<form id="authForm"><div class="field"><label>E-mail</label><input name="email" type="email" required></div><div class="field" style="margin-top:11px"><label>Senha</label><input name="password" type="password" required></div><div class="form-actions"><button class="btn primary block">Entrar</button></div></form><div class="demo-box"><strong>Contas demo:</strong><br>Cliente: cliente@deuregua.app / demo123<br>Barbearia: barbearia@deuregua.app / demo123<br>Admin: admin@deuregua.app / demo123</div>`:`<form id="authForm"><div class="form-grid"><div class="field span-2"><label>Quero usar como</label><select name="role"><option value="customer">Cliente — procurar e agendar</option><option value="owner">Barbearia — divulgar e gerenciar agenda</option></select></div><div class="field span-2"><label>Nome</label><input name="name" required></div><div class="field"><label>E-mail</label><input name="email" type="email" required></div><div class="field"><label>Telefone</label><input name="phone"></div><div class="field span-2"><label>Senha</label><input name="password" type="password" minlength="6" required></div></div><div class="form-actions"><button class="btn primary block">Criar conta</button></div></form>`}`));
    document.querySelectorAll('[data-auth-tab]').forEach(b=>b.addEventListener('click',()=>render(b.dataset.authTab)));
    document.getElementById('authForm').addEventListener('submit',async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget).entries());try{const d=await api(mode==='login'?'/api/auth/login':'/api/auth/register',{method:'POST',body});state.me=d.user;closeModal();updateNav();toast(mode==='login'?'Bem-vindo de volta!':'Conta criada com sucesso!');if(after)after();else if(state.me.role==='owner')goto('owner');else if(state.me.role==='admin')goto('admin');else renderRoute();}catch(err){toast(err.message,'error')}});
  }; render(tab);
}

async function useLocation(){
  if(!navigator.geolocation){toast('Seu navegador não oferece geolocalização.','error');return;}
  toast('Solicitando sua localização...');
  navigator.geolocation.getCurrentPosition(async pos=>{
    const lat=Number(pos.coords.latitude.toFixed(6)),lng=Number(pos.coords.longitude.toFixed(6));state.filters.lat=lat;state.filters.lng=lng;
    const pf=document.getElementById('profileForm'); if(pf){pf.elements.lat.value=lat;pf.elements.lng.value=lng;if(!pf.elements.locationName.value)pf.elements.locationName.value='Localização atual';}
    const sf=document.getElementById('shopCreateForm'); if(sf){sf.elements.lat.value=lat;sf.elements.lng.value=lng;}
    if(state.me?.role==='customer'){try{const d=await api('/api/profile',{method:'PUT',body:{lat,lng,locationName:state.me.profile?.locationName||'Localização atual'}});state.me=d.user;}catch(_){} }
    toast('Localização atualizada.'); if(routeParts()[0]==='discover')renderDiscover();
  },err=>toast(err.code===1?'Permissão de localização negada.':'Não foi possível obter sua localização.','error'),{enableHighAccuracy:true,timeout:10000,maximumAge:60000});
}

appEl.addEventListener('click',async e=>{
  const el=e.target.closest('[data-action]'); if(!el)return; const a=el.dataset.action;
  try{
    if(a==='auth')showAuth(el.dataset.tab||'login');
    if(a==='focus-search')document.getElementById('searchQ')?.focus();
    if(a==='use-location'||a==='fill-owner-location')useLocation();
    if(a==='toggle-compare'){const id=el.dataset.id;if(state.compare.has(id))state.compare.delete(id);else{if(state.compare.size>=3){toast('Você pode comparar no máximo 3 barbearias.','error');return;}state.compare.add(id);}saveCompare();toast(state.compare.has(id)?'Adicionada à comparação.':'Removida da comparação.');routeParts()[0]==='compare'?renderCompare():renderRoute();}
    if(a==='favorite-shop'){if(!state.me){showAuth();return;}if(state.me.role!=='customer'){toast('Favoritos são recursos da conta de cliente.','error');return;}const d=await api('/api/favorites/toggle',{method:'POST',body:{type:'shop',id:el.dataset.id}});state.me=d.user;toast(d.active?'Barbearia favoritada.':'Barbearia removida dos favoritos.');renderRoute();}
    if(a==='favorite-barber'){if(!state.me){showAuth();return;}const d=await api('/api/favorites/toggle',{method:'POST',body:{type:'barber',id:el.dataset.id}});state.me=d.user;toast(d.active?'Barbeiro favoritado.':'Barbeiro removido dos favoritos.');renderRoute();}
    if(a==='book')bookingModal(el.dataset.shop,el.dataset.barber||'',el.dataset.service||'');
    if(a==='cancel-appointment'){if(confirm('Cancelar este agendamento?')){await api(`/api/appointments/${el.dataset.id}/cancel`,{method:'PATCH'});toast('Agendamento cancelado.');renderAppointments();}}
    if(a==='review')reviewModal(el.dataset.id,el.dataset.shop,el.dataset.barber);
    if(a==='owner-tab'){state.ownerTab=el.dataset.tab;renderOwner();}
    if(a==='add-barber')barberModal();
    if(a==='edit-barber'){const {shop}=await api('/api/owner/shop');barberModal(shop.barbers.find(b=>b.id===el.dataset.id));}
    if(a==='delete-barber'){if(confirm('Excluir este barbeiro?')){await api(`/api/owner/barbers/${el.dataset.id}`,{method:'DELETE'});toast('Barbeiro excluído.');renderOwner();}}
    if(a==='add-service')serviceModal();
    if(a==='edit-service'){const {shop}=await api('/api/owner/shop');serviceModal(shop.services.find(s=>s.id===el.dataset.id));}
    if(a==='delete-service'){if(confirm('Excluir este serviço?')){await api(`/api/owner/services/${el.dataset.id}`,{method:'DELETE'});toast('Serviço excluído.');renderOwner();}}
    if(a==='add-portfolio'){const {shop}=await api('/api/owner/shop');portfolioModal(shop);}
    if(a==='delete-portfolio'){if(confirm('Remover esta foto?')){await api(`/api/owner/portfolio/${el.dataset.id}`,{method:'DELETE'});toast('Foto removida.');renderOwner();}}
    if(a==='select-plan'){await api('/api/owner/plan',{method:'PUT',body:{plan:el.dataset.plan}});toast('Plano selecionado.');renderOwner();}
    if(a==='admin-tab'){state.adminTab=el.dataset.tab;renderAdmin();}
    if(a==='admin-user'){await api(`/api/admin/users/${el.dataset.id}`,{method:'PATCH',body:{active:el.dataset.active==='true'}});toast('Usuário atualizado.');renderAdmin();}
    if(a==='admin-shop-active'){await api(`/api/admin/shops/${el.dataset.id}`,{method:'PATCH',body:{active:el.dataset.active==='true'}});toast('Barbearia atualizada.');renderAdmin();}
    if(a==='admin-shop-feature'){await api(`/api/admin/shops/${el.dataset.id}`,{method:'PATCH',body:{featured:el.dataset.featured==='true'}});toast('Destaque atualizado.');renderAdmin();}
    if(a==='admin-delete-review'){if(confirm('Remover esta avaliação?')){await api(`/api/admin/reviews/${el.dataset.id}`,{method:'DELETE'});toast('Avaliação removida.');renderAdmin();}}
  }catch(err){toast(err.message,'error');}
});

modalRoot.addEventListener('click',e=>{
  if(e.target===modalRoot||e.target.closest('[data-action="close-modal"]'))closeModal();
  const slot=e.target.closest('[data-action="select-slot"]');if(slot){modalRoot.querySelectorAll('.slot-btn').forEach(x=>x.classList.remove('selected'));slot.classList.add('selected');state.selectedSlot=slot.dataset.time;const input=document.getElementById('bookTime');if(input)input.value=slot.dataset.time;}
});
accountEl.addEventListener('click',async e=>{const el=e.target.closest('[data-action]');if(!el)return;if(el.dataset.action==='auth')showAuth(el.dataset.tab||'login');if(el.dataset.action==='logout'){await api('/api/auth/logout',{method:'POST'});state.me=null;toast('Sessão encerrada.');updateNav();goto('discover');}});
mobileMenu.addEventListener('click',()=>navEl.classList.toggle('open'));
window.addEventListener('hashchange',renderRoute);
window.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});

init();
