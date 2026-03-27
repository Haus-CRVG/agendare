 const API = 'https://agendare-production.up.railway.app/api';
//const API = 'http://localhost:3002/api';

let usuario = null, token = null;
let pollingInterval = null, ultimaNotifId = 0;
let dataSelecionada = new Date().toISOString().split('T')[0];
let calAtual = new Date();
let servicos = [], profissionais = [];
let agSlotSelecionado = null;
let tipoParticipante = 'interno';

const DIAS = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const DIAS_COMPLETO = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];

// ── Inicialização ─────────────────────────────────────────
function init() {
  token   = localStorage.getItem('token');
  usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
  if (!token || !usuario) { window.location.href = 'index.html'; return; }
  usuario.id = parseInt(usuario.id);

  document.getElementById('nomeUsuario').textContent = usuario.nome;
  document.getElementById('badgePerfil').textContent =
    usuario.perfil === 'superadmin' ? '⚡ Super Admin' :
    usuario.perfil === 'admin'      ? '👑 Admin'       : '🔧 Profissional';

  // ── SUPER ADMIN: só vê gestão de empresas ──────────────
  if (usuario.perfil === 'superadmin') {
    // Esconde itens do menu que não são do superadmin
    const esconder = ['agenda','lista','disponibilidade'];
    esconder.forEach(aba => {
      const btn = document.querySelector(`[data-aba="${aba}"]`);
      if (btn) btn.style.display = 'none';
    });
    document.getElementById('sidebarAdmin').style.display = 'none';

    // Adiciona seção Empresas no sidebar
    const secao = document.createElement('div');
    secao.className = 'sidebar-section';
    secao.id = 'sidebarSuperAdmin';
    secao.innerHTML = `
      <div class="sidebar-label">Super Admin</div>
      <button class="sidebar-item active" onclick="mudarAba('empresas')" data-aba="empresas">
        <span class="icon">🏢</span> Empresas
      </button>
    `;
    document.getElementById('sidebar').appendChild(secao);

    mudarAba('empresas');
    return;
  }

  // ── ADMIN e PROFISSIONAL ────────────────────────────────
  if (usuario.perfil === 'admin') {
    document.getElementById('sidebarAdmin').style.display = 'block';
  }

  const linkEl = document.getElementById('linkPublico');
  if (linkEl && usuario.slug) {
    linkEl.value = `${window.location.origin.replace(':5500','')}/frontend/agendar.html?empresa=${usuario.slug}`;
  }

  montarAbasMobile();
  carregarServicos();
  carregarProfissionaisFiltro();
  mudarAba('agenda');
  iniciarPolling();
}

function montarAbasMobile() {
  const abas = [
    { id:'agenda', label:'📅 Agenda' },
    { id:'lista',  label:'📋 Lista'  },
    ...(usuario.perfil === 'admin' ? [
      { id:'servicos',      label:'🛠️ Serviços'  },
      { id:'profissionais', label:'👥 Equipe'     },
    ] : []),
    { id:'disponibilidade', label:'🕐 Disponib.' },
  ];
  document.getElementById('mobileTabs').innerHTML = abas.map(a =>
    `<button class="mobile-tab ${a.id==='agenda'?'active':''}" onclick="mudarAba('${a.id}')">${a.label}</button>`
  ).join('');
}

// ── Abas ──────────────────────────────────────────────────
function mudarAba(aba) {
  const todas = ['abaAgenda','abaLista','abaServicos','abaProfissionais',
                 'abaDisponibilidade','abaConfiguracoes','abaEmpresas'];
  todas.forEach(id => { const el = document.getElementById(id); if(el) el.style.display='none'; });

  const alvo = document.getElementById(`aba${aba.charAt(0).toUpperCase()+aba.slice(1)}`);
  if (alvo) alvo.style.display = 'block';

  document.querySelectorAll('.sidebar-item').forEach(b => b.classList.toggle('active', b.dataset.aba===aba));
  document.querySelectorAll('.mobile-tab').forEach(b => {
    const map = { agenda:'📅', lista:'📋', servicos:'🛠️', profissionais:'👥', disponibilidade:'🕐' };
    b.classList.toggle('active', map[aba] && b.textContent.includes(map[aba]));
  });

  if (aba==='agenda')          { renderMiniCalendario(); carregarAgenda(); }
  if (aba==='lista')           carregarLista();
  if (aba==='servicos')        carregarServicosAba();
  if (aba==='profissionais')   carregarProfissionaisAba();
  if (aba==='disponibilidade') carregarDisponibilidade();
  if (aba==='configuracoes')   carregarConfiguracoes();
  if (aba==='empresas')        carregarEmpresas();
}

// ── Calendário ────────────────────────────────────────────
function renderMiniCalendario() {
  const nomesMes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const ano = calAtual.getFullYear(), mes = calAtual.getMonth();
  const hoje = new Date().toISOString().split('T')[0];
  const primeiroDia = new Date(ano,mes,1).getDay();
  const ultimoDia  = new Date(ano,mes+1,0).getDate();

  document.getElementById('calMes').textContent = `${nomesMes[mes]} ${ano}`;
  let html = DIAS.map(d => `<div class="cal-header">${d}</div>`).join('');
  html += Array(primeiroDia).fill('<div></div>').join('');
  for (let d=1; d<=ultimoDia; d++) {
    const ds = `${ano}-${String(mes+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    html += `<div class="cal-dia ${ds===dataSelecionada?'selecionado':''} ${ds===hoje?'hoje':''}" onclick="selecionarDia('${ds}')">
      <span class="num">${d}</span></div>`;
  }
  document.getElementById('calendarioGrid').innerHTML = html;
}

function navegarMes(dir) { calAtual.setMonth(calAtual.getMonth()+dir); renderMiniCalendario(); }
function selecionarDia(data) { dataSelecionada=data; renderMiniCalendario(); carregarAgenda(); }

// ── Agenda do Dia ─────────────────────────────────────────
async function carregarAgenda() {
  const profId  = document.getElementById('filtroProfissional')?.value || '';
  const dataFmt = new Date(dataSelecionada+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
  document.getElementById('tituloTimeline').textContent = dataFmt.charAt(0).toUpperCase()+dataFmt.slice(1);
  document.getElementById('subtituloAgenda').textContent = new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});

  try {
    const inicio = dataSelecionada+'T00:00:00';
    const fim    = dataSelecionada+'T23:59:59';
    let url = `${API}/agendamentos?inicio=${inicio}&fim=${fim}`;
    if (profId) url += `&profissional_id=${profId}`;
    const r = await fetch(url, { headers:{ Authorization:`Bearer ${token}` } });
    if (r.status===401) { sair(); return; }
    const ags = await r.json();

    document.getElementById('statsAgenda').innerHTML = `
      <div class="stat-card"><div class="stat-label">Total hoje</div><div class="stat-value">${ags.length}</div></div>
      <div class="stat-card" style="--accent:#10b981"><div class="stat-label">Confirmados</div><div class="stat-value" style="color:#10b981">${ags.filter(a=>a.status==='confirmado').length}</div></div>
      <div class="stat-card" style="--accent:#ef4444"><div class="stat-label">Cancelados</div><div class="stat-value" style="color:#ef4444">${ags.filter(a=>a.status==='cancelado').length}</div></div>
      <div class="stat-card" style="--accent:#0891b2"><div class="stat-label">Concluídos</div><div class="stat-value" style="color:#0891b2">${ags.filter(a=>a.status==='concluido').length}</div></div>`;

    if (!ags.length) {
      document.getElementById('timelineDia').innerHTML = `<p style="color:var(--muted);text-align:center;padding:2rem;">Nenhum agendamento neste dia 🎉</p>`;
      return;
    }
    const statusBadge = { confirmado:'badge-confirmado', pendente:'badge-pendente', cancelado:'badge-cancelado', concluido:'badge-concluido', faltou:'badge-faltou' };
    document.getElementById('timelineDia').innerHTML = ags.map(a => {
      const hora = new Date(a.data_inicio).toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'});
      return `<div class="ag-item" onclick="abrirVerAgendamento(${a.id})">
        <div class="ag-hora">${hora}</div>
        <div class="ag-cor" style="background:${a.servico_cor||'#0d9488'}"></div>
        <div class="ag-info">
          <div class="ag-cliente">${a.cliente_nome}</div>
          <div class="ag-servico">${a.servico_nome||'—'} · ${a.duracao_minutos||60}min</div>
          <div class="ag-prof">👤 ${a.profissional_nome||'—'}</div>
        </div>
        <span class="badge ${statusBadge[a.status]||''}">${a.status}</span>
      </div>`;
    }).join('');
  } catch(err) { console.error(err); }
}

// ── Lista de Agendamentos ─────────────────────────────────
async function carregarLista() {
  const inicio = document.getElementById('filtroInicio').value;
  const fim    = document.getElementById('filtroFim').value;
  const status = document.getElementById('filtroStatus').value;
  const profId = document.getElementById('filtroProf2').value;
  let url = `${API}/agendamentos?`;
  if (inicio) url += `inicio=${inicio}T00:00:00&`;
  if (fim)    url += `fim=${fim}T23:59:59&`;
  if (status) url += `status=${status}&`;
  if (profId) url += `profissional_id=${profId}&`;
  try {
    const r = await fetch(url, { headers:{ Authorization:`Bearer ${token}` } });
    const ags = await r.json();
    const tbody = document.getElementById('tabelaAgendamentos');
    if (!ags.length) { tbody.innerHTML=`<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--muted)">Nenhum agendamento encontrado</td></tr>`; return; }
    const statusBadge = { confirmado:'badge-confirmado', pendente:'badge-pendente', cancelado:'badge-cancelado', concluido:'badge-concluido', faltou:'badge-faltou' };
    tbody.innerHTML = ags.map(a => {
      const dt = new Date(a.data_inicio).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});
      return `<tr>
        <td>${dt}</td>
        <td><strong>${a.cliente_nome}</strong>${a.cliente_telefone?`<br><span style="color:var(--muted);font-size:0.78rem">${a.cliente_telefone}</span>`:''}</td>
        <td>${a.servico_nome||'—'}</td>
        <td>${a.profissional_nome||'—'}</td>
        <td><span class="badge ${statusBadge[a.status]||''}">${a.status}</span></td>
        <td><button class="btn btn-secondary btn-sm" onclick="abrirVerAgendamento(${a.id})">Ver</button></td>
      </tr>`;
    }).join('');
  } catch(err) { console.error(err); }
}

// ── Modal Novo Agendamento ────────────────────────────────
function abrirNovoAgendamento() {
  document.getElementById('agId').value='';
  document.getElementById('agCliente').value='';
  document.getElementById('agEmail').value='';
  document.getElementById('agTelefone').value='';
  document.getElementById('agObs').value='';
  document.getElementById('agData').value=dataSelecionada;
  document.getElementById('slotsWrapper').style.display='none';
  document.getElementById('erroAgendamento').style.display='none';
  document.getElementById('agServico').innerHTML=servicos.map(s=>`<option value="${s.id}">${s.nome}</option>`).join('');
  agSlotSelecionado=null;
  carregarProfissionaisServico();
  document.getElementById('modalAgendamento').classList.add('active');
}
function fecharModalAgendamento() { document.getElementById('modalAgendamento').classList.remove('active'); }

async function carregarProfissionaisServico() {
  const sid = document.getElementById('agServico').value;
  agSlotSelecionado=null;
  document.getElementById('slotsWrapper').style.display='none';
  if (!sid) return;
  try {
    const r = await fetch(`${API}/profissionais?empresa_id=${usuario.empresa_id}&servico_id=${sid}`,{headers:{Authorization:`Bearer ${token}`}});
    const profs = await r.json();
    document.getElementById('agProfissional').innerHTML=profs.map(p=>`<option value="${p.id}">${p.nome}</option>`).join('');
    carregarHorarios();
  } catch(err) { console.error(err); }
}

async function carregarHorarios() {
  const sid  = document.getElementById('agServico').value;
  const pid  = document.getElementById('agProfissional').value;
  const data = document.getElementById('agData').value;
  agSlotSelecionado=null;
  if (!sid||!pid||!data) { document.getElementById('slotsWrapper').style.display='none'; return; }
  try {
    const r = await fetch(`${API}/agendamentos/horarios-disponiveis?empresa_id=${usuario.empresa_id}&profissional_id=${pid}&servico_id=${sid}&data=${data}`,{headers:{Authorization:`Bearer ${token}`}});
    const { horarios } = await r.json();
    document.getElementById('slotsWrapper').style.display='block';
    document.getElementById('slotsHorario').innerHTML=horarios.length
      ? horarios.map(h=>`<div class="slot" onclick="selecionarSlot(this,'${h.hora}','${h.data_inicio}','${h.data_fim}')">${h.hora}</div>`).join('')
      : '<p style="color:var(--muted);font-size:0.85rem;grid-column:1/-1">Nenhum horário disponível neste dia</p>';
  } catch(err) { console.error(err); }
}

function selecionarSlot(el,hora,ini,fim) {
  document.querySelectorAll('#slotsHorario .slot').forEach(s=>s.classList.remove('selecionado'));
  el.classList.add('selecionado');
  agSlotSelecionado={hora,data_inicio:ini,data_fim:fim};
  document.getElementById('agDataInicio').value=ini;
  document.getElementById('agDataFim').value=fim;
}

async function salvarAgendamento() {
  const cliente=document.getElementById('agCliente').value.trim();
  const email  =document.getElementById('agEmail').value.trim();
  const tel    =document.getElementById('agTelefone').value.trim();
  const obs    =document.getElementById('agObs').value.trim();
  const sid    =document.getElementById('agServico').value;
  const pid    =document.getElementById('agProfissional').value;
  const erro   =document.getElementById('erroAgendamento');
  if (!cliente) { erro.textContent='Informe o nome do cliente'; erro.style.display='block'; return; }
  if (!agSlotSelecionado) { erro.textContent='Selecione um horário'; erro.style.display='block'; return; }
  erro.style.display='none';
  document.getElementById('btnAgendar').style.display='none';
  document.getElementById('spinnerAgendar').style.display='inline-block';
  try {
    const r = await fetch(`${API}/agendamentos`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({empresa_id:usuario.empresa_id,profissional_id:pid,servico_id:sid,
        cliente_nome:cliente,cliente_email:email||null,cliente_telefone:tel||null,
        data_inicio:agSlotSelecionado.data_inicio,data_fim:agSlotSelecionado.data_fim,observacoes:obs||null})
    });
    const data=await r.json();
    if (!r.ok) { erro.textContent=data.erro||'Erro ao agendar'; erro.style.display='block'; return; }
    fecharModalAgendamento();
    carregarAgenda();
  } catch { erro.textContent='Erro de conexão'; erro.style.display='block'; }
  finally { document.getElementById('btnAgendar').style.display='inline'; document.getElementById('spinnerAgendar').style.display='none'; }
}

// ── Ver Agendamento ───────────────────────────────────────
async function abrirVerAgendamento(id) {
  try {
    const inicio = dataSelecionada+'T00:00:00';
    const fim    = dataSelecionada+'T23:59:59';
    const r = await fetch(`${API}/agendamentos?inicio=${inicio}&fim=${fim}`,{headers:{Authorization:`Bearer ${token}`}});
    const ags = await r.json();
    const ag  = ags.find(a=>a.id===id);
    if (!ag) return;

    const dt = new Date(ag.data_inicio).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',weekday:'long',day:'2-digit',month:'long',hour:'2-digit',minute:'2-digit'});
    document.getElementById('detalheAgendamento').innerHTML = `
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:1rem;">
        <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:0.88rem"><span style="color:var(--muted)">Cliente</span><strong>${ag.cliente_nome}</strong></div>
        ${ag.cliente_telefone?`<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:0.88rem"><span style="color:var(--muted)">Telefone</span><span>${ag.cliente_telefone}</span></div>`:''}
        ${ag.cliente_email?`<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:0.88rem"><span style="color:var(--muted)">E-mail</span><span>${ag.cliente_email}</span></div>`:''}
        <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:0.88rem"><span style="color:var(--muted)">Serviço</span><span>${ag.servico_nome}</span></div>
        <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:0.88rem"><span style="color:var(--muted)">Profissional</span><span>${ag.profissional_nome}</span></div>
        <div style="display:flex;justify-content:space-between;padding:5px 0;font-size:0.88rem;text-transform:capitalize"><span style="color:var(--muted)">Data/Hora</span><span>${dt}</span></div>
        ${ag.observacoes?`<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:0.82rem;color:var(--muted)">💬 ${ag.observacoes}</div>`:''}
      </div>`;

    document.getElementById('editAgId').value=id;
    document.getElementById('editStatus').value=ag.status;
    document.getElementById('partProfissional').innerHTML=profissionais.map(p=>`<option value="${p.id}">${p.nome}</option>`).join('');
    document.getElementById('formParticipante').style.display='none';
    setTipoParticipante('interno');
    await carregarParticipantes(id);
    document.getElementById('modalVerAgendamento').classList.add('active');
  } catch(err) { console.error(err); }
}
function fecharModalVer() { document.getElementById('modalVerAgendamento').classList.remove('active'); }

async function atualizarStatus() {
  const id=document.getElementById('editAgId').value;
  const status=document.getElementById('editStatus').value;
  try {
    await fetch(`${API}/agendamentos/${id}`,{
      method:'PATCH',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
      body:JSON.stringify({status})
    });
    fecharModalVer();
    carregarAgenda();
    if (document.getElementById('abaLista').style.display!=='none') carregarLista();
  } catch(err) { console.error(err); }
}

// ── Participantes ─────────────────────────────────────────
function toggleAddParticipante() {
  const form = document.getElementById('formParticipante');
  form.style.display = form.style.display==='none' ? 'block' : 'none';
  document.getElementById('erroParticipante').style.display='none';
}

function setTipoParticipante(tipo) {
  tipoParticipante=tipo;
  document.getElementById('campoInterno').style.display  = tipo==='interno'?'block':'none';
  document.getElementById('campoExterno').style.display  = tipo==='externo'?'block':'none';
  document.getElementById('btnTipoInterno').style.background  = tipo==='interno'?'var(--accent)':'';
  document.getElementById('btnTipoInterno').style.color       = tipo==='interno'?'#fff':'';
  document.getElementById('btnTipoInterno').style.borderColor = tipo==='interno'?'var(--accent)':'';
  document.getElementById('btnTipoExterno').style.background  = tipo==='externo'?'var(--accent)':'';
  document.getElementById('btnTipoExterno').style.color       = tipo==='externo'?'#fff':'';
  document.getElementById('btnTipoExterno').style.borderColor = tipo==='externo'?'var(--accent)':'';
}

async function carregarParticipantes(agId) {
  try {
    const r = await fetch(`${API}/participantes/${agId}`,{headers:{Authorization:`Bearer ${token}`}});
    const lista = await r.json();
    const el = document.getElementById('listaParticipantes');
    if (!lista.length) {
      el.innerHTML=`<p style="color:var(--muted);font-size:0.82rem;text-align:center;padding:0.5rem">Nenhum participante adicionado.</p>`;
      return;
    }
    const statusIcon={pendente:'⏳',confirmado:'✅',cancelado:'❌'};
    el.innerHTML=lista.map(p=>{
      const nome  = p.profissional_nome||p.nome_externo||'—';
      const email = p.profissional_email||p.email_externo||'';
      const tipo  = p.profissional_id?'👤':'🌐';
      return `<div style="display:flex;align-items:center;gap:0.75rem;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:0.6rem 0.9rem;">
        <span style="font-size:1rem">${tipo}</span>
        <div style="flex:1"><div style="font-weight:600;font-size:0.85rem">${nome}</div>
          ${email?`<div style="font-size:0.75rem;color:var(--muted)">${email}</div>`:''}</div>
        <span title="${p.status}" style="font-size:1.1rem">${statusIcon[p.status]||'⏳'}</span>
        <button onclick="removerParticipante(${p.id},${p.agendamento_id})"
          style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.9rem;padding:2px 4px" title="Remover">✕</button>
      </div>`;
    }).join('');
  } catch(err) { console.error(err); }
}

async function adicionarParticipante() {
  const agId=document.getElementById('editAgId').value;
  const erro=document.getElementById('erroParticipante');
  erro.style.display='none';
  let body={agendamento_id:parseInt(agId)};
  if (tipoParticipante==='interno') {
    const pid=document.getElementById('partProfissional').value;
    if (!pid) { erro.textContent='Selecione um profissional'; erro.style.display='block'; return; }
    body.profissional_id=parseInt(pid);
  } else {
    const nome  = document.getElementById('partNome').value.trim();
    const email = document.getElementById('partEmail').value.trim();
    if (!nome||!email) { erro.textContent='Nome e e-mail são obrigatórios'; erro.style.display='block'; return; }
    body.nome_externo=nome; body.email_externo=email;
  }
  try {
    const r=await fetch(`${API}/participantes`,{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
      body:JSON.stringify(body)
    });
    const d=await r.json();
    if (!r.ok) { erro.textContent=d.erro||'Erro ao adicionar'; erro.style.display='block'; return; }
    document.getElementById('formParticipante').style.display='none';
    document.getElementById('partNome').value='';
    document.getElementById('partEmail').value='';
    await carregarParticipantes(agId);
    mostrarToast('✅ Convite enviado!','O participante receberá um e-mail com o convite.');
  } catch { erro.textContent='Erro de conexão'; erro.style.display='block'; }
}

async function removerParticipante(id,agId) {
  if (!confirm('Remover este participante?')) return;
  try {
    await fetch(`${API}/participantes/${id}`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`}});
    await carregarParticipantes(agId);
  } catch(err) { console.error(err); }
}

// ── Serviços ──────────────────────────────────────────────
async function carregarServicos() {
  try {
    const r=await fetch(`${API}/servicos?empresa_id=${usuario.empresa_id}`,{headers:{Authorization:`Bearer ${token}`}});
    servicos=await r.json();
  } catch(err) { console.error(err); }
}

async function carregarServicosAba() {
  await carregarServicos();
  document.getElementById('listaServicos').innerHTML=servicos.map(s=>`
    <div class="card">
      <div class="card-body" style="display:flex;gap:12px;align-items:flex-start;">
        <div style="width:12px;height:48px;border-radius:999px;background:${s.cor||'#0d9488'};flex-shrink:0;margin-top:4px;"></div>
        <div style="flex:1">
          <div style="font-weight:700;color:var(--text);margin-bottom:4px;">${s.nome}</div>
          ${s.descricao?`<div style="font-size:0.8rem;color:var(--muted);margin-bottom:6px;">${s.descricao}</div>`:''}
          <div style="display:flex;gap:12px;font-size:0.78rem;color:var(--muted)">
            <span>⏱ ${s.duracao_minutos}min</span>
            ${s.preco?`<span>💰 R$ ${parseFloat(s.preco).toFixed(2).replace('.',',')}</span>`:''}
          </div>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="editarServico(${s.id})">✏️</button>
      </div>
    </div>`).join('')||'<p style="color:var(--muted)">Nenhum serviço cadastrado</p>';
}

function abrirNovoServico() {
  document.getElementById('servicoId').value='';
  document.getElementById('servicoModalTitle').textContent='🛠️ Novo Serviço';
  ['servicoNome','servicoDesc','servicoPreco'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('servicoDuracao').value='60';
  document.getElementById('servicoCor').value='#0d9488';
  document.getElementById('erroServico').style.display='none';
  document.getElementById('modalServico').classList.add('active');
}
function fecharModalServico() { document.getElementById('modalServico').classList.remove('active'); }

function editarServico(id) {
  const s=servicos.find(sv=>sv.id===id);
  if (!s) return;
  document.getElementById('servicoId').value=s.id;
  document.getElementById('servicoModalTitle').textContent='✏️ Editar Serviço';
  document.getElementById('servicoNome').value=s.nome;
  document.getElementById('servicoDesc').value=s.descricao||'';
  document.getElementById('servicoDuracao').value=s.duracao_minutos;
  document.getElementById('servicoPreco').value=s.preco||'';
  document.getElementById('servicoCor').value=s.cor||'#0d9488';
  document.getElementById('erroServico').style.display='none';
  document.getElementById('modalServico').classList.add('active');
}

async function salvarServico() {
  const id   =document.getElementById('servicoId').value;
  const nome =document.getElementById('servicoNome').value.trim();
  const desc =document.getElementById('servicoDesc').value.trim();
  const dur  =document.getElementById('servicoDuracao').value;
  const preco=document.getElementById('servicoPreco').value;
  const cor  =document.getElementById('servicoCor').value;
  const erro =document.getElementById('erroServico');
  if (!nome||!dur) { erro.textContent='Nome e duração são obrigatórios'; erro.style.display='block'; return; }
  erro.style.display='none';
  try {
    const method=id?'PATCH':'POST';
    const url   =id?`${API}/servicos/${id}`:`${API}/servicos`;
    const r=await fetch(url,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
      body:JSON.stringify({nome,descricao:desc||null,duracao_minutos:parseInt(dur),preco:preco||null,cor})});
    const data=await r.json();
    if (!r.ok) { erro.textContent=data.erro||'Erro ao salvar'; erro.style.display='block'; return; }
    fecharModalServico();
    carregarServicosAba();
    carregarServicos();
  } catch { erro.textContent='Erro de conexão'; erro.style.display='block'; }
}

// ── Profissionais ─────────────────────────────────────────
async function carregarProfissionaisFiltro() {
  try {
    const r=await fetch(`${API}/profissionais?empresa_id=${usuario.empresa_id}`,{headers:{Authorization:`Bearer ${token}`}});
    profissionais=await r.json();
    const opts='<option value="">Todos</option>'+profissionais.map(p=>`<option value="${p.id}">${p.nome}</option>`).join('');
    const fp=document.getElementById('filtroProfissional'); if(fp) fp.innerHTML=opts;
    const fp2=document.getElementById('filtroProf2'); if(fp2) fp2.innerHTML=opts;
  } catch(err) { console.error(err); }
}

async function carregarProfissionaisAba() {
  await carregarProfissionaisFiltro();
  document.getElementById('listaProfissionais').innerHTML=profissionais.map(p=>`
    <div class="card">
      <div class="card-body" style="display:flex;flex-direction:column;align-items:center;text-align:center;gap:0.75rem;">
        <div style="width:56px;height:56px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:1.3rem;">${p.nome.charAt(0).toUpperCase()}</div>
        <div>
          <div style="font-weight:700;color:var(--text)">${p.nome}</div>
          <div style="font-size:0.78rem;color:var(--muted)">${p.email}</div>
          <span class="badge ${p.perfil==='admin'?'badge-confirmado':'badge-pendente'}" style="margin-top:4px">${p.perfil==='admin'?'👑 Admin':'🔧 Profissional'}</span>
        </div>
      </div>
    </div>`).join('')||'<p style="color:var(--muted)">Nenhum profissional cadastrado</p>';
}

function abrirNovoProfissional() {
  ['profNome','profEmail','profTelefone','profSenha'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('profPerfil').value='profissional';
  document.getElementById('checkServicos').innerHTML=servicos.map(s=>
    `<label style="display:flex;align-items:center;gap:6px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:5px 10px;cursor:pointer;font-size:0.82rem;">
      <input type="checkbox" value="${s.id}" style="accent-color:var(--accent);" /> ${s.nome}
    </label>`).join('');
  document.getElementById('erroProfissional').style.display='none';
  document.getElementById('modalProfissional').classList.add('active');
}
function fecharModalProfissional() { document.getElementById('modalProfissional').classList.remove('active'); }

async function salvarProfissional() {
  const nome  =document.getElementById('profNome').value.trim();
  const email =document.getElementById('profEmail').value.trim();
  const tel   =document.getElementById('profTelefone').value.trim();
  const senha =document.getElementById('profSenha').value;
  const perf  =document.getElementById('profPerfil').value;
  const servs =[...document.querySelectorAll('#checkServicos input:checked')].map(c=>parseInt(c.value));
  const erro  =document.getElementById('erroProfissional');
  if (!nome||!email||!senha) { erro.textContent='Nome, e-mail e senha são obrigatórios'; erro.style.display='block'; return; }
  erro.style.display='none';
  try {
    const r=await fetch(`${API}/profissionais`,{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
      body:JSON.stringify({nome,email,telefone:tel||null,senha,perfil:perf,servicos:servs})
    });
    const data=await r.json();
    if (!r.ok) { erro.textContent=data.erro||'Erro ao cadastrar'; erro.style.display='block'; return; }
    fecharModalProfissional();
    carregarProfissionaisAba();
  } catch { erro.textContent='Erro de conexão'; erro.style.display='block'; }
}

// ── Disponibilidade ───────────────────────────────────────
let disponibilidadeAtual=[];
async function carregarDisponibilidade() {
  try {
    const r=await fetch(`${API}/profissionais/${usuario.id}/disponibilidade`,{headers:{Authorization:`Bearer ${token}`}});
    disponibilidadeAtual=await r.json();
    renderDisponibilidade();
  } catch(err) { console.error(err); }
}

function renderDisponibilidade() {
  document.getElementById('formDisponibilidade').innerHTML=DIAS_COMPLETO.map((dia,idx)=>{
    const d=disponibilidadeAtual.find(x=>x.dia_semana===idx);
    return `<div style="display:flex;align-items:center;gap:1rem;padding:0.75rem 0;border-bottom:1px solid var(--border);flex-wrap:wrap;">
      <label style="display:flex;align-items:center;gap:8px;min-width:140px;cursor:pointer;">
        <input type="checkbox" id="disp_ativo_${idx}" ${d?.ativo!==false&&d?'checked':''} style="accent-color:var(--accent);width:16px;height:16px;" />
        <span style="font-weight:500">${dia}</span>
      </label>
      <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
        <input type="time" id="disp_ini_${idx}" value="${d?.hora_inicio||'08:00'}" style="width:110px;" />
        <span style="color:var(--muted)">até</span>
        <input type="time" id="disp_fim_${idx}" value="${d?.hora_fim||'18:00'}" style="width:110px;" />
      </div>
    </div>`;
  }).join('');
}

async function salvarDisponibilidade() {
  const disp=DIAS_COMPLETO.map((_,idx)=>({
    dia_semana:idx,
    ativo:document.getElementById(`disp_ativo_${idx}`)?.checked||false,
    hora_inicio:document.getElementById(`disp_ini_${idx}`)?.value||'08:00',
    hora_fim:document.getElementById(`disp_fim_${idx}`)?.value||'18:00',
  }));
  try {
    const r=await fetch(`${API}/profissionais/${usuario.id}/disponibilidade`,{
      method:'PUT',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
      body:JSON.stringify({disponibilidade:disp})
    });
    if (r.ok) mostrarToast('✅ Disponibilidade salva!','Suas configurações foram atualizadas.');
  } catch(err) { console.error(err); }
}

// ── Configurações ─────────────────────────────────────────
async function carregarConfiguracoes() {
  try {
    const r=await fetch(`${API}/empresas/minha`,{headers:{Authorization:`Bearer ${token}`}});
    const emp=await r.json();
    const linkEl=document.getElementById('linkPublico');
    if (linkEl) linkEl.value=`${window.location.origin.replace(':5500','')}/frontend/agendar.html?empresa=${emp.slug}`;
  } catch(err) { console.error(err); }
}

function copiarLink() {
  const link=document.getElementById('linkPublico');
  if (!link) return;
  navigator.clipboard.writeText(link.value).then(()=>{
    const conf=document.getElementById('linkCopiado');
    if (conf) { conf.style.display='block'; setTimeout(()=>conf.style.display='none',2500); }
    mostrarToast('🔗 Link copiado!','Compartilhe com seus clientes.');
  });
}

// ── Perfil ────────────────────────────────────────────────
function abrirPerfil() {
  document.getElementById('perfilInfo').innerHTML=`<div><strong>Nome:</strong> ${usuario.nome}</div><div><strong>E-mail:</strong> ${usuario.email}</div><div><strong>Perfil:</strong> ${usuario.perfil==='admin'?'👑 Administrador':usuario.perfil==='superadmin'?'⚡ Super Admin':'🔧 Profissional'}</div>`;
  document.getElementById('erroPerfil').style.display='none';
  document.getElementById('sucessoPerfil').style.display='none';
  document.getElementById('novaSenhaP').value='';
  document.getElementById('confirmarSenhaP').value='';
  document.getElementById('modalPerfil').classList.add('active');
}
function fecharPerfil() { document.getElementById('modalPerfil').classList.remove('active'); }

async function trocarSenha() {
  const nova=document.getElementById('novaSenhaP').value.trim();
  const conf=document.getElementById('confirmarSenhaP').value.trim();
  const erro=document.getElementById('erroPerfil'), suc=document.getElementById('sucessoPerfil');
  erro.style.display='none'; suc.style.display='none';
  if (!nova||!conf) { erro.textContent='Preencha os dois campos'; erro.style.display='block'; return; }
  if (nova!==conf)  { erro.textContent='As senhas não conferem'; erro.style.display='block'; return; }
  if (nova.length<6){ erro.textContent='Mínimo de 6 caracteres'; erro.style.display='block'; return; }
  try {
    const r=await fetch(`${API}/profissionais/${usuario.id}/senha`,{
      method:'PATCH',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
      body:JSON.stringify({senha:nova})
    });
    if (r.ok) { suc.textContent='✅ Senha alterada!'; suc.style.display='block'; }
    else { const d=await r.json(); erro.textContent=d.erro||'Erro'; erro.style.display='block'; }
  } catch { erro.textContent='Erro de conexão'; erro.style.display='block'; }
}

// ── EMPRESAS (superadmin) ─────────────────────────────────
async function carregarEmpresas() {
  try {
    const r=await fetch(`${API}/empresas`,{headers:{Authorization:`Bearer ${token}`}});
    const emps=await r.json();
    const tbody=document.getElementById('tabelaEmpresas');
    if (!emps.length) {
      tbody.innerHTML='<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--muted)">Nenhuma empresa cadastrada. Clique em "+ Nova Empresa" para começar.</td></tr>';
      return;
    }
    tbody.innerHTML=emps.map(e=>`
      <tr>
        <td><strong>${e.nome_fantasia}</strong></td>
        <td style="font-size:0.82rem;color:var(--muted)">${e.cnpj}</td>
        <td>${e.email||'—'}</td>
        <td><code style="background:var(--surface2);padding:2px 6px;border-radius:4px;font-size:0.78rem">${e.slug||'—'}</code></td>
        <td><span class="badge ${e.status==='ativo'?'badge-confirmado':'badge-cancelado'}">${e.status}</span></td>
        <td style="display:flex;gap:0.4rem">
          <button class="btn btn-secondary btn-sm" onclick="abrirVerEmpresa(${e.id})">✏️ Editar</button>
          <button class="btn btn-secondary btn-sm" onclick="copiarLinkEmpresa('${e.slug}')">🔗 Link</button>
        </td>
      </tr>`).join('');
  } catch(err) { console.error(err); }
}

function abrirNovaEmpresa() {
  document.getElementById('empId').value='';
  document.getElementById('tituloModalEmpresa').textContent='🏢 Nova Empresa';
  document.getElementById('btnEmpresaText').textContent='Criar Empresa';
  document.getElementById('secaoAdmin').style.display='block';
  ['empNome','empCnpj','empEmail','empTelefone','empSlug',
   'empAdminNome','empAdminEmail','empAdminSenha'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('empCor').value='#0d9488';
  document.getElementById('slugPreview').textContent='slug';
  document.getElementById('erroEmpresa').style.display='none';
  document.getElementById('modalEmpresa').classList.add('active');

  // Preview do slug em tempo real
  document.getElementById('empSlug').oninput=function(){
    document.getElementById('slugPreview').textContent=this.value||'slug';
  };
}
function fecharModalEmpresa() { document.getElementById('modalEmpresa').classList.remove('active'); }

let _empresaAtual = null;

async function abrirVerEmpresa(id) {
  document.getElementById('editEmpresaId').value = id;
  document.getElementById('erroEditEmpresa').style.display = 'none';
  setTabEmpresa('dados');

  // Busca dados da empresa
  try {
    const r = await fetch(`${API}/empresas/${id}`, { headers:{ Authorization:`Bearer ${token}` } });
    const emp = await r.json();
    _empresaAtual = emp;

    document.getElementById('editEmpNome').value      = emp.nome_fantasia || '';
    document.getElementById('editEmpCnpj').value      = emp.cnpj || '';
    document.getElementById('editEmpEmail').value     = emp.email || '';
    document.getElementById('editEmpTelefone').value  = emp.telefone || '';
    document.getElementById('editEmpSlug').value      = emp.slug || '';
    document.getElementById('editEmpCor').value       = emp.cor_primaria || '#0d9488';
    document.getElementById('editEmpVencimento').value = emp.vencimento ? emp.vencimento.split('T')[0] : '';
    document.getElementById('editEmpresaStatus').value = emp.status || 'ativo';
  } catch { mostrarToast('❌ Erro','Não foi possível carregar os dados.'); return; }

  document.getElementById('modalVerEmpresa').classList.add('active');
}

function fecharModalVerEmpresa() {
  document.getElementById('modalVerEmpresa').classList.remove('active');
  _empresaAtual = null;
}

function setTabEmpresa(tab) {
  ['dados','status','usuarios'].forEach(t => {
    const btn = document.getElementById(`tab${t.charAt(0).toUpperCase()+t.slice(1)}`);
    const conteudo = document.getElementById(`tabConteudo${t.charAt(0).toUpperCase()+t.slice(1)}`);
    const ativo = t === tab;
    if (btn) {
      btn.style.background = ativo ? 'var(--surface)' : 'none';
      btn.style.color      = ativo ? 'var(--text)'    : 'var(--muted)';
      btn.style.boxShadow  = ativo ? 'var(--shadow)'  : 'none';
    }
    if (conteudo) conteudo.style.display = ativo ? 'block' : 'none';
  });
  if (tab === 'usuarios') carregarUsuariosEmpresa();
}

async function carregarUsuariosEmpresa() {
  const id = document.getElementById('editEmpresaId').value;
  try {
    const r = await fetch(`${API}/empresas/${id}/usuarios`, { headers:{ Authorization:`Bearer ${token}` } });
    const lista = await r.json();
    const el = document.getElementById('listaUsuariosEmpresa');
    if (!lista.length) {
      el.innerHTML = '<p style="color:var(--muted);font-size:0.85rem">Nenhum usuário cadastrado.</p>';
      return;
    }
    el.innerHTML = lista.map(u => `
      <div style="display:flex;align-items:center;gap:0.75rem;padding:0.6rem 0.75rem;
           background:var(--surface2);border:1px solid var(--border);border-radius:8px;margin-bottom:0.4rem">
        <div style="flex:1">
          <div style="font-weight:600;font-size:0.85rem">${u.nome}</div>
          <div style="font-size:0.75rem;color:var(--muted)">${u.email}</div>
        </div>
        <span class="badge ${u.perfil==='admin'?'badge-confirmado':'badge-pendente'}" style="font-size:0.7rem">
          ${u.perfil==='admin'?'👑 Admin':'🔧 Profissional'}
        </span>
        <span class="badge ${u.ativo?'badge-confirmado':'badge-cancelado'}" style="font-size:0.7rem">
          ${u.ativo?'Ativo':'Inativo'}
        </span>
      </div>`).join('');
  } catch { console.error('Erro ao carregar usuários'); }
}

async function adicionarUsuarioEmpresa() {
  const empId = document.getElementById('editEmpresaId').value;
  const nome  = document.getElementById('novoUserNome').value.trim();
  const email = document.getElementById('novoUserEmail').value.trim();
  const senha = document.getElementById('novoUserSenha').value;
  const perfil= document.getElementById('novoUserPerfil').value;
  const erro  = document.getElementById('erroNovoUser');
  erro.style.display = 'none';

  if (!nome || !email || !senha) { erro.textContent='Nome, e-mail e senha são obrigatórios'; erro.style.display='block'; return; }
  if (senha.length < 6) { erro.textContent='Senha deve ter no mínimo 6 caracteres'; erro.style.display='block'; return; }

  try {
    const r = await fetch(`${API}/empresas/${empId}/usuarios`, {
      method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`},
      body: JSON.stringify({ nome, email, senha, perfil })
    });
    const d = await r.json();
    if (!r.ok) { erro.textContent=d.erro||'Erro ao adicionar'; erro.style.display='block'; return; }
    ['novoUserNome','novoUserEmail','novoUserSenha'].forEach(id => document.getElementById(id).value='');
    await carregarUsuariosEmpresa();
    mostrarToast('✅ Usuário adicionado!', `${nome} foi cadastrado com sucesso.`);
  } catch { erro.textContent='Erro de conexão'; erro.style.display='block'; }
}

async function salvarEdicaoEmpresa() {
  const id     = document.getElementById('editEmpresaId').value;
  const nome   = document.getElementById('editEmpNome').value.trim();
  const slug   = document.getElementById('editEmpSlug').value.trim();
  const erro   = document.getElementById('erroEditEmpresa');
  erro.style.display = 'none';

  if (!nome || !slug) { erro.textContent='Nome e slug são obrigatórios'; erro.style.display='block'; return; }

  try {
    const r = await fetch(`${API}/empresas/${id}`, {
      method:'PATCH', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`},
      body: JSON.stringify({
        nome_fantasia: nome,
        cnpj:         document.getElementById('editEmpCnpj').value,
        email:        document.getElementById('editEmpEmail').value,
        telefone:     document.getElementById('editEmpTelefone').value,
        slug:         slug.toLowerCase().replace(/\s+/g,'-'),
        cor_primaria: document.getElementById('editEmpCor').value,
        vencimento:   document.getElementById('editEmpVencimento').value || null,
        status:       document.getElementById('editEmpresaStatus').value,
      })
    });
    const d = await r.json();
    if (!r.ok) { erro.textContent=d.erro||'Erro ao salvar'; erro.style.display='block'; return; }
    fecharModalVerEmpresa();
    carregarEmpresas();
    mostrarToast('✅ Empresa atualizada!','Dados salvos com sucesso.');
  } catch { erro.textContent='Erro de conexão'; erro.style.display='block'; }
}

async function salvarEmpresa() {
  const nome       =document.getElementById('empNome').value.trim();
  const cnpj       =document.getElementById('empCnpj').value.trim();
  const slug       =document.getElementById('empSlug').value.trim();
  const adminNome  =document.getElementById('empAdminNome').value.trim();
  const adminEmail =document.getElementById('empAdminEmail').value.trim();
  const adminSenha =document.getElementById('empAdminSenha').value;
  const erro       =document.getElementById('erroEmpresa');

  if (!nome||!cnpj||!slug) { erro.textContent='Nome, CNPJ e slug são obrigatórios'; erro.style.display='block'; return; }
  if (!adminNome||!adminEmail||!adminSenha) { erro.textContent='Preencha os dados do administrador'; erro.style.display='block'; return; }
  if (adminSenha.length<6) { erro.textContent='A senha deve ter no mínimo 6 caracteres'; erro.style.display='block'; return; }
  erro.style.display='none';

  document.getElementById('btnEmpresaText').style.display='none';
  document.getElementById('spinnerEmpresa').style.display='inline-block';

  try {
    const r=await fetch(`${API}/empresas`,{
      method:'POST',
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
      body:JSON.stringify({
        nome_fantasia:nome, cnpj,
        email:   document.getElementById('empEmail').value,
        telefone:document.getElementById('empTelefone').value,
        slug, cor_primaria:document.getElementById('empCor').value,
        admin_nome:adminNome, admin_email:adminEmail, admin_senha:adminSenha
      })
    });
    const data=await r.json();
    if (!r.ok) { erro.textContent=data.erro||'Erro ao criar empresa'; erro.style.display='block'; return; }
    fecharModalEmpresa();
    carregarEmpresas();
    mostrarToast('✅ Empresa criada!',`${nome} foi cadastrada. O admin pode logar com o CNPJ.`);
  } catch { erro.textContent='Erro de conexão'; erro.style.display='block'; }
  finally {
    document.getElementById('btnEmpresaText').style.display='inline';
    document.getElementById('spinnerEmpresa').style.display='none';
  }
}

function copiarLinkEmpresa(slug) {
  const url=`${window.location.origin.replace(':5500','')}/frontend/agendar.html?empresa=${slug}`;
  navigator.clipboard.writeText(url).then(()=>mostrarToast('🔗 Link copiado!',url));
}

// ── Notificações ──────────────────────────────────────────
function iniciarPolling() {
  verificarNotificacoes();
  pollingInterval=setInterval(verificarNotificacoes,30000);
}
async function verificarNotificacoes() {
  try {
    const r=await fetch(`${API}/notificacoes`,{headers:{Authorization:`Bearer ${token}`}});
    if (r.status===401) { sair(); return; }
    const notifs=await r.json();
    const novas=notifs.filter(n=>n.id>ultimaNotifId);
    novas.forEach(n=>mostrarToast(n.titulo,n.mensagem,n.id));
    if (novas.length) ultimaNotifId=Math.max(...novas.map(n=>n.id));
    const btn=document.getElementById('btnNotif');
    if (btn) btn.textContent=notifs.length?`🔔 ${notifs.length}`:'🔔';
  } catch {}
}
function abrirNotificacoes() { verificarNotificacoes(); }

function mostrarToast(titulo,mensagem,id) {
  const c=document.getElementById('toastContainer');
  const t=document.createElement('div');
  t.className='toast';
  t.innerHTML=`<div class="toast-header"><span>🔔</span><strong class="toast-title">${titulo}</strong><button class="toast-close" onclick="fecharToast(this,${id||0})">✕</button></div><div class="toast-body">${mensagem}</div>`;
  c.appendChild(t);
  requestAnimationFrame(()=>t.classList.add('toast-show'));
  setTimeout(()=>fecharToast(t.querySelector('.toast-close'),id||0),7000);
}
async function fecharToast(btn,id) {
  const t=btn.closest('.toast');
  if (!t) return;
  t.classList.remove('toast-show'); t.classList.add('toast-hide');
  setTimeout(()=>t.remove(),300);
  if (id) { try { await fetch(`${API}/notificacoes/${id}/lida`,{method:'PATCH',headers:{Authorization:`Bearer ${token}`}}); } catch {} }
}

// ── Auth ──────────────────────────────────────────────────
function sair() {
  if (pollingInterval) clearInterval(pollingInterval);
  localStorage.clear();
  window.location.href='index.html';
}
function logoff() {
  if (pollingInterval) clearInterval(pollingInterval);
  const cnpj=localStorage.getItem('cnpj_salvo');
  localStorage.removeItem('token');
  localStorage.removeItem('usuario');
  if (cnpj) localStorage.setItem('cnpj_salvo',cnpj);
  window.location.href='index.html';
}

init();
