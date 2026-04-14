const API = 'https://agendare-backend-production.up.railway.app/api';
const FRONTEND_URL = 'https://agendare-frontend-production.up.railway.app';

let usuario = null, token = null;
let pollingInterval = null, ultimaNotifId = 0;
let dataSelecionada = new Date().toISOString().split('T')[0];
let calAtual = new Date();
let profissionais = [], servicos = [];
let tipoParticipante = 'interno';
let visualizacaoAtual = 'proximos'; // padrão ao logar

const DIAS = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const DIAS_COMPLETO = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function corProf(prof) { return prof?.cor_agenda || prof?.cor || '#0d9488'; }

// ── Inicialização ─────────────────────────────────────────
function init() {
  token   = localStorage.getItem('token');
  usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
  if (!token || !usuario) { window.location.href = 'index.html'; return; }
  usuario.id = parseInt(usuario.id);

  document.getElementById('nomeUsuario').textContent = usuario.nome;
  document.getElementById('badgePerfil').textContent =
    usuario.perfil === 'superadmin' ? '⚡ Super Admin' :
    usuario.perfil === 'admin'      ? '👑 Admin'       : '🔍 Analista';

  if (usuario.perfil === 'superadmin') {
    ['agenda','lista','disponibilidade'].forEach(aba => {
      const btn = document.querySelector(`[data-aba="${aba}"]`);
      if (btn) btn.style.display = 'none';
    });
    document.getElementById('sidebarAdmin').style.display = 'none';
    const secao = document.createElement('div');
    secao.className = 'sidebar-section';
    secao.id = 'sidebarSuperAdmin';
    secao.innerHTML = `<div class="sidebar-label">Super Admin</div>
      <button class="sidebar-item active" onclick="mudarAba('empresas')" data-aba="empresas">
        <span class="icon">🏢</span> Empresas</button>`;
    document.getElementById('sidebar').appendChild(secao);
    mudarAba('empresas');
    return;
  }

  if (usuario.perfil === 'admin') document.getElementById('sidebarAdmin').style.display = 'block';

  // Mostrar nome da empresa na topbar
  const badge = document.getElementById('empresaBadge');
  if (badge) {
    const nomeEmp = usuario.empresa_nome || usuario.slug || '—';
    badge.textContent = '🏢 ' + nomeEmp;
    badge.title = nomeEmp;
  }

  montarAbasMobile();
  carregarProfissionaisFiltro().then(() => {
    mudarAba('agenda');
    iniciarPolling();
  });
}

function montarAbasMobile() {
  const abas = [
    { id:'agenda', label:'📅 Agenda' }, { id:'lista', label:'📋 Lista' },
    ...(usuario.perfil === 'admin' ? [{ id:'profissionais', label:'👥 Equipe' }] : []),
    { id:'disponibilidade', label:'🕐 Disponib.' },
  ];
  document.getElementById('mobileTabs').innerHTML = abas.map(a =>
    `<button class="mobile-tab ${a.id==='agenda'?'active':''}" onclick="mudarAba('${a.id}')">${a.label}</button>`).join('');
}

// ── Abas ──────────────────────────────────────────────────
function mudarAba(aba) {
  ['abaAgenda','abaLista','abaServicos','abaProfissionais','abaDisponibilidade','abaConfiguracoes','abaEmpresas']
    .forEach(id => { const el = document.getElementById(id); if(el) el.style.display='none'; });
  const alvo = document.getElementById(`aba${aba.charAt(0).toUpperCase()+aba.slice(1)}`);
  if (alvo) alvo.style.display = 'block';
  document.querySelectorAll('.sidebar-item').forEach(b => b.classList.toggle('active', b.dataset.aba===aba));

  if (aba==='agenda')          { renderMiniCalendarioComBolinhas(); carregarPainelAgenda(); }
  if (aba==='lista')           carregarLista();
  if (aba==='servicos')        carregarServicosAba();
  if (aba==='profissionais')   carregarProfissionaisAba();
  if (aba==='disponibilidade') carregarDisponibilidade();
  if (aba==='configuracoes')   carregarConfiguracoes();
  if (aba==='empresas')        carregarEmpresas();
}

// ── Visualização ──────────────────────────────────────────
// ── FullCalendar instance ─────────────────────────────────
let fcInstance = null;

function mudarVisualizacao(vis) {
  visualizacaoAtual = vis;
  ['proximos','dia','semana','mes'].forEach(v => {
    const btn = document.getElementById(`btnVis${v.charAt(0).toUpperCase()+v.slice(1)}`);
    if (btn) btn.classList.toggle('ativo', v === vis);
  });
  const ehKanban = vis === 'proximos';
  document.getElementById('painelProximos').style.display  = ehKanban ? 'block' : 'none';
  document.getElementById('painelCalendario').style.display = ehKanban ? 'none'  : 'block';

  if (!ehKanban) {
    const viewMap = { dia:'timeGridDay', semana:'timeGridWeek', mes:'dayGridMonth' };
    iniciarOuAtualizarFC(viewMap[vis]);
  }
  carregarPainelAgenda();
}

function iniciarOuAtualizarFC(view) {
  const el = document.getElementById('fcCalendario');
  if (!el) return;
  if (fcInstance) {
    fcInstance.changeView(view);
    fcInstance.refetchEvents();
    return;
  }
  fcInstance = new FullCalendar.Calendar(el, {
    locale: 'pt-br',
    initialView: view,
    headerToolbar: {
      left:   'prev,next today',
      center: 'title',
      right:  'timeGridDay,timeGridWeek,dayGridMonth'
    },
    height: 'auto',
    expandRows: true,
    firstDay: 0,
    nowIndicator: true,
    slotMinTime: '06:00:00',
    slotMaxTime: '22:00:00',
    allDayText: 'Dia todo',
    buttonText: { today:'Hoje', day:'Dia', week:'Semana', month:'Mês' },
    // Sincroniza com os botões do painel quando muda de view dentro do FC
    viewDidMount: function(info) {
      const map = { timeGridDay:'dia', timeGridWeek:'semana', dayGridMonth:'mes' };
      const vis = map[info.view.type];
      if (vis && vis !== visualizacaoAtual) {
        visualizacaoAtual = vis;
        ['proximos','dia','semana','mes'].forEach(v => {
          const btn = document.getElementById(`btnVis${v.charAt(0).toUpperCase()+v.slice(1)}`);
          if (btn) btn.classList.toggle('ativo', v === vis);
        });
      }
    },
    eventClick: function(info) {
      const id = parseInt(info.event.id);
      dataSelecionada = info.event.startStr.split('T')[0];
      abrirVerAgendamento(id);
    },
    dateClick: function(info) {
      dataSelecionada = info.dateStr.split('T')[0];
      abrirNovoAgendamento();
    },
    events: async function(fetchInfo, successCallback, failureCallback) {
      try {
        const profId = document.getElementById('filtroProfissional')?.value || '';
        let url = `${API}/agendamentos?inicio=${fetchInfo.startStr.split('T')[0]}T00:00:00&fim=${fetchInfo.endStr.split('T')[0]}T23:59:59`;
        if (profId) url += `&profissional_id=${profId}`;
        const r = await fetch(url, { headers:{ Authorization:`Bearer ${token}` } });
        const ags = await r.json();
        const agora = new Date();
        const eventos = ags.map(a => {
          const prof = profissionais.find(p => p.id === a.profissional_id);
          const cor  = corProf(prof);
          const atrasado = !['concluido','cancelado'].includes(a.status) && new Date(a.data_fim||a.data_inicio) < agora;
          return {
            id:        a.id,
            title:     a.cliente_nome,
            start:     a.data_inicio,
            end:       a.data_fim || undefined,
            allDay:    a.dia_todo || false,
            color:     atrasado ? '#ef4444' : cor,
            textColor: '#fff',
            extendedProps: { status: a.status, profissional: a.profissional_nome, obs: a.observacoes }
          };
        });
        successCallback(eventos);
      } catch(e) { failureCallback(e); }
    },
    eventDidMount: function(info) {
      const p = info.event.extendedProps;
      info.el.title = `${info.event.title}\n👤 ${p.profissional||'—'}\n📌 ${p.status}${p.obs?'\n💬 '+p.obs:''}`;
    }
  });
  fcInstance.render();
}

function atualizarFullCalendar() {
  if (fcInstance) fcInstance.refetchEvents();
}

async function carregarPainelAgenda() {
  await carregarStatsAgenda();
  await renderMiniCalendarioComBolinhas();
  if (visualizacaoAtual === 'proximos') await carregarKanbanProximos();
  else if (fcInstance) fcInstance.refetchEvents();
}

// ── Stats ─────────────────────────────────────────────────
async function carregarStatsAgenda() {
  try {
    const hoje = new Date().toISOString().split('T')[0];
    const r = await fetch(`${API}/agendamentos?inicio=${hoje}T00:00:00&fim=${hoje}T23:59:59`, { headers:{ Authorization:`Bearer ${token}` } });
    if (!r.ok) return;
    const ags = await r.json();
    // Conta atrasados: data passada, status não concluído/cancelado
    const agora = new Date();
    let atrasados = 0;
    try {
      const rAll = await fetch(`${API}/agendamentos?inicio=2020-01-01T00:00:00&fim=${hoje}T23:59:59`, { headers:{ Authorization:`Bearer ${token}` } });
      if (rAll.ok) {
        const all = await rAll.json();
        atrasados = all.filter(a => !['concluido','cancelado'].includes(a.status) && new Date(a.data_fim || a.data_inicio) < agora).length;
      }
    } catch {}
    // Atualiza badge de notificação
    const btnNotif = document.getElementById('btnNotif');
    if (btnNotif && atrasados > 0) {
      btnNotif.innerHTML = `🔔<span style="position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;border-radius:999px;font-size:0.6rem;min-width:16px;height:16px;display:flex;align-items:center;justify-content:center;padding:0 3px;font-weight:700">${atrasados}</span>`;
      btnNotif.style.position = 'relative';
    }
    window._agsHoje = ags;
    document.getElementById('statsAgenda').innerHTML = `
      <div class="stat-card" style="cursor:pointer" onclick="abrirDashboardStats('todos')">
        <div class="stat-label">Total hoje</div><div class="stat-value">${ags.length}</div></div>
      <div class="stat-card" style="--accent:#10b981;cursor:pointer" onclick="abrirDashboardStats('confirmado')">
        <div class="stat-label">Confirmados</div><div class="stat-value" style="color:#10b981">${ags.filter(a=>a.status==='confirmado').length}</div></div>
      <div class="stat-card" style="--accent:#ef4444;cursor:pointer" onclick="abrirDashboardStats('cancelado')">
        <div class="stat-label">Cancelados</div><div class="stat-value" style="color:#ef4444">${ags.filter(a=>a.status==='cancelado').length}</div></div>
      <div class="stat-card" style="--accent:#0891b2;cursor:pointer" onclick="abrirDashboardStats('concluido')">
        <div class="stat-label">Concluídos</div><div class="stat-value" style="color:#0891b2">${ags.filter(a=>a.status==='concluido').length}</div></div>
      ${atrasados>0?`<div class="stat-card" style="--accent:#f59e0b;cursor:pointer" onclick="abrirDashboardStats('atrasado')"><div class="stat-label">⚠️ Atrasados</div><div class="stat-value" style="color:#f59e0b">${atrasados}</div></div>`:''}`;
  } catch(err) { console.error(err); }
}

// ── Calendário com bolinhas ───────────────────────────────
async function renderMiniCalendarioComBolinhas() {
  const ano = calAtual.getFullYear(), mes = calAtual.getMonth();
  const hoje = new Date().toISOString().split('T')[0];
  const primeiroDia = new Date(ano, mes, 1).getDay();
  const ultimoDia  = new Date(ano, mes+1, 0).getDate();
  const ini = `${ano}-${String(mes+1).padStart(2,'0')}-01T00:00:00`;
  const fim = `${ano}-${String(mes+1).padStart(2,'0')}-${String(ultimoDia).padStart(2,'0')}T23:59:59`;
  let agendaMes = [];
  try {
    const r = await fetch(`${API}/agendamentos?inicio=${ini}&fim=${fim}`, { headers:{ Authorization:`Bearer ${token}` } });
    if (r.ok) agendaMes = await r.json();
  } catch {}
  const diaParaCores = {};
  agendaMes.forEach(ag => {
    const dia = new Date(ag.data_inicio).toLocaleDateString('en-CA', { timeZone:'America/Sao_Paulo' });
    if (!diaParaCores[dia]) diaParaCores[dia] = new Set();
    const prof = profissionais.find(p => p.id === ag.profissional_id);
    diaParaCores[dia].add(corProf(prof));
  });
  document.getElementById('calMes').textContent = `${MESES[mes]} ${ano}`;
  let html = DIAS.map(d => `<div class="cal-header">${d}</div>`).join('');
  html += Array(primeiroDia).fill('<div></div>').join('');
  for (let d = 1; d <= ultimoDia; d++) {
    const ds = `${ano}-${String(mes+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const cores = diaParaCores[ds] ? [...diaParaCores[ds]].slice(0,3) : [];
    const bolinhas = cores.map(c => `<span class="cal-dot" style="background:${c}"></span>`).join('');
    html += `<div class="cal-dia ${ds===dataSelecionada?'selecionado':''} ${ds===hoje?'hoje':''}" onclick="selecionarDia('${ds}')">
      <span class="num">${d}</span>${bolinhas?`<div class="cal-dots">${bolinhas}</div>`:''}
    </div>`;
  }
  document.getElementById('calendarioGrid').innerHTML = html;
}

function renderMiniCalendario() { renderMiniCalendarioComBolinhas(); }
function navegarMes(dir) { calAtual.setMonth(calAtual.getMonth()+dir); renderMiniCalendarioComBolinhas(); }
function selecionarDia(data) {
  dataSelecionada = data;
  if (visualizacaoAtual !== 'dia') mudarVisualizacao('dia');
  else { renderMiniCalendarioComBolinhas(); carregarAgenda(); }
}

// ── Kanban: Próximos 5 por colaborador (padrão ao logar) ──
async function carregarKanbanProximos() {
  const agora = new Date().toISOString().split('T')[0];
  const fimFuturo = `${new Date().getFullYear()+2}-12-31T23:59:59`;
  const subtitulo = document.getElementById('subtituloAgenda');
  if (subtitulo) subtitulo.textContent = 'Próximos compromissos — todos os colaboradores';
  const container = document.getElementById('kanbanProximos');
  if (container) container.innerHTML = '<p style="color:var(--muted);padding:1rem">Carregando...</p>';
  try {
    // Garante que profissionais esteja carregado antes de renderizar
    if (!profissionais.length) await carregarProfissionaisFiltro();

    const r = await fetch(`${API}/agendamentos?inicio=${agora}T00:00:00&fim=${fimFuturo}`, { headers:{ Authorization:`Bearer ${token}` } });
    if (r.status === 401) { sair(); return; }
    const ags = await r.json();

    if (!Array.isArray(ags) || !ags.length) {
      if (container) container.innerHTML = '<p style="color:var(--muted);padding:1.5rem;text-align:center">Nenhum compromisso futuro agendado 🎉</p>';
      return;
    }

    // Agrupa por profissional — usa nome do agendamento como fallback
    const grupos = {};
    ags.forEach(a => {
      const pid = String(a.profissional_id || 0);
      const profLocal = profissionais.find(p => String(p.id) === pid);
      const nomeProf = profLocal?.nome || a.profissional_nome || 'Sem responsável';
      if (!grupos[pid]) grupos[pid] = { nome: nomeProf, items: [] };
      if (grupos[pid].items.length < 5) grupos[pid].items.push(a);
    });
    renderKanban('kanbanProximos', grupos);
  } catch(err) {
    console.error('Erro carregarKanbanProximos:', err);
    if (container) container.innerHTML = '<p style="color:var(--muted);padding:1rem">Erro ao carregar compromissos.</p>';
  }
}

// ── Kanban: Semana ────────────────────────────────────────
async function carregarKanbanSemana() {
  const hoje = new Date(dataSelecionada+'T12:00:00');
  const ds = hoje.getDay();
  const ini = new Date(hoje); ini.setDate(hoje.getDate()-ds);
  const fim = new Date(hoje); fim.setDate(hoje.getDate()+(6-ds));
  const iniStr = ini.toISOString().split('T')[0]+'T00:00:00';
  const fimStr = fim.toISOString().split('T')[0]+'T23:59:59';
  const semStr = `${ini.toLocaleDateString('pt-BR',{day:'2-digit',month:'short'})} – ${fim.toLocaleDateString('pt-BR',{day:'2-digit',month:'short'})}`;
  document.getElementById('tituloSemana').textContent = `Semana: ${semStr}`;
  document.getElementById('subtituloAgenda').textContent = 'Kanban semanal — todos os colaboradores';
  try {
    const r = await fetch(`${API}/agendamentos?inicio=${iniStr}&fim=${fimStr}`, { headers:{ Authorization:`Bearer ${token}` } });
    const ags = await r.json();
    const grupos = {};
    ags.forEach(a => {
      const pid = a.profissional_id || 0;
      if (!grupos[pid]) grupos[pid] = { nome: a.profissional_nome||'Sem responsável', items: [] };
      grupos[pid].items.push(a);
    });
    renderKanban('kanbanSemana', grupos);
  } catch(err) { console.error(err); }
}

// ── Kanban: Mês ───────────────────────────────────────────
async function carregarKanbanMes() {
  const ano = calAtual.getFullYear(), mes = calAtual.getMonth();
  const ultimoDia = new Date(ano, mes+1, 0).getDate();
  const ini = `${ano}-${String(mes+1).padStart(2,'0')}-01T00:00:00`;
  const fim = `${ano}-${String(mes+1).padStart(2,'0')}-${String(ultimoDia).padStart(2,'0')}T23:59:59`;
  document.getElementById('tituloMes').textContent = `${MESES[mes]} ${ano}`;
  document.getElementById('subtituloAgenda').textContent = 'Kanban mensal — todos os colaboradores';
  try {
    const r = await fetch(`${API}/agendamentos?inicio=${ini}&fim=${fim}`, { headers:{ Authorization:`Bearer ${token}` } });
    const ags = await r.json();
    const grupos = {};
    ags.forEach(a => {
      const pid = a.profissional_id || 0;
      if (!grupos[pid]) grupos[pid] = { nome: a.profissional_nome||'Sem responsável', items: [] };
      grupos[pid].items.push(a);
    });
    renderKanban('kanbanMes', grupos);
  } catch(err) { console.error(err); }
}

// ── Render Kanban genérico ────────────────────────────────
function renderKanban(containerId, grupos) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!Object.keys(grupos).length) {
    container.innerHTML = `<p style="color:var(--muted);padding:1rem;">Nenhum compromisso neste período.</p>`;
    return;
  }
  const agora = new Date();
  const statusBadge = { confirmado:'badge-confirmado', pendente:'badge-pendente', cancelado:'badge-cancelado', concluido:'badge-concluido', faltou:'badge-faltou' };
  container.innerHTML = Object.entries(grupos).map(([pid, grupo]) => {
    const prof = profissionais.find(p => p.id === parseInt(pid));
    const cor  = corProf(prof);
    const cards = grupo.items.map(a => {
      const ehDiaTodo = a.dia_todo;
      const dtStr = ehDiaTodo
        ? new Date(a.data_inicio).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'2-digit'}) + ' · Dia todo'
        : new Date(a.data_inicio).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});
      const atrasado = !['concluido','cancelado'].includes(a.status) && new Date(a.data_fim||a.data_inicio) < agora;
      // Permissão: admin edita tudo, profissional só o seu
      const podeEditar = usuario.perfil === 'admin' || parseInt(pid) === usuario.id;
      return `<div class="kanban-card" 
        style="border-left-color:${cor};${atrasado?'background:rgba(239,68,68,0.06);':''}${!podeEditar?'cursor:default;opacity:0.8':''}"
        onclick="${podeEditar?`abrirVerAgendamentoKanban(${a.id})`:''}">
        <div class="kanban-card-titulo">${a.cliente_nome}${atrasado?` <span style="color:#ef4444;font-size:0.68rem">⚠️ atrasado</span>`:''}</div>
        <div class="kanban-card-data">📅 ${dtStr}</div>
        ${a.observacoes?`<div class="kanban-card-data" style="margin-top:3px">💬 ${a.observacoes.substring(0,35)}${a.observacoes.length>35?'...':''}</div>`:''}
        <div style="margin-top:4px"><span class="badge ${statusBadge[a.status]||''}" style="font-size:0.68rem">${a.status}</span></div>
      </div>`;
    }).join('');
    return `<div class="kanban-col">
      <div class="kanban-col-header">
        <div class="kanban-col-avatar" style="background:${cor}">${grupo.nome.charAt(0).toUpperCase()}</div>
        <span style="color:var(--text)">${grupo.nome}</span>
        <span style="margin-left:auto;background:var(--surface2);border:1px solid var(--border);border-radius:999px;padding:1px 8px;font-size:0.72rem;color:var(--muted)">${grupo.items.length}</span>
      </div>
      <div class="kanban-col-body">${cards||`<div class="kanban-empty">Nenhum compromisso</div>`}</div>
    </div>`;
  }).join('');
}

// ── Agenda do Dia ─────────────────────────────────────────
async function carregarAgenda() {
  const profId = document.getElementById('filtroProfissional')?.value || '';
  const dataFmt = new Date(dataSelecionada+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
  document.getElementById('tituloTimeline').textContent = dataFmt.charAt(0).toUpperCase()+dataFmt.slice(1);
  document.getElementById('subtituloAgenda').textContent = new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
  try {
    let url = `${API}/agendamentos?inicio=${dataSelecionada}T00:00:00&fim=${dataSelecionada}T23:59:59`;
    if (profId) url += `&profissional_id=${profId}`;
    const r = await fetch(url, { headers:{ Authorization:`Bearer ${token}` } });
    if (r.status===401) { sair(); return; }
    const ags = await r.json();
    const agora = new Date();
    if (!ags.length) {
      document.getElementById('timelineDia').innerHTML = `<p style="color:var(--muted);text-align:center;padding:2rem;">Nenhum compromisso neste dia 🎉</p>`;
      return;
    }
    const statusBadge = { confirmado:'badge-confirmado', pendente:'badge-pendente', cancelado:'badge-cancelado', concluido:'badge-concluido', faltou:'badge-faltou' };
    document.getElementById('timelineDia').innerHTML = ags.map(a => {
      const prof = profissionais.find(p => p.id === a.profissional_id);
      const cor  = corProf(prof);
      const ehDiaTodo = a.dia_todo;
      const hora = ehDiaTodo ? 'Dia todo' : new Date(a.data_inicio).toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'});
      const horaFim = (!ehDiaTodo && a.data_fim) ? new Date(a.data_fim).toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}) : '';
      const atrasado = !['concluido','cancelado'].includes(a.status) && new Date(a.data_fim||a.data_inicio) < agora;
      const podeEditar = usuario.perfil === 'admin' || a.profissional_id === usuario.id;
      return `<div class="ag-item" onclick="${podeEditar?`abrirVerAgendamento(${a.id})`:''}"
        style="${!podeEditar?'cursor:default;opacity:0.85':''}${atrasado?';background:rgba(239,68,68,0.05);border-left:3px solid #ef4444;':''}">
        <div class="ag-hora">${hora}${horaFim?`<br><span style="font-size:0.73rem;color:var(--muted)">${horaFim}</span>`:''}</div>
        <div class="ag-cor" style="background:${cor}"></div>
        <div class="ag-info">
          <div class="ag-cliente">${a.cliente_nome}${atrasado?` <span style="color:#ef4444;font-size:0.72rem">⚠️ atrasado</span>`:''}</div>
          <div class="ag-servico">${a.observacoes?`💬 ${a.observacoes.substring(0,40)}`:'—'}</div>
          <div class="ag-prof"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${cor}"></span> ${a.profissional_nome||'—'}</div>
        </div>
        <span class="badge ${statusBadge[a.status]||''}">${a.status}</span>
      </div>`;
    }).join('');
  } catch(err) { console.error(err); }
}

// ── Lista de Compromissos ─────────────────────────────────
async function carregarLista() {
  const inicio=document.getElementById('filtroInicio').value;
  const fim=document.getElementById('filtroFim').value;
  const status=document.getElementById('filtroStatus').value;
  const profId=document.getElementById('filtroProf2').value;
  let url=`${API}/agendamentos?`;
  if(inicio) url+=`inicio=${inicio}T00:00:00&`;
  if(fim)    url+=`fim=${fim}T23:59:59&`;
  if(status) url+=`status=${status}&`;
  if(profId) url+=`profissional_id=${profId}&`;
  try {
    const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});
    const ags=await r.json();
    const tbody=document.getElementById('tabelaAgendamentos');
    if(!ags.length){tbody.innerHTML=`<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--muted)">Nenhum compromisso encontrado</td></tr>`;return;}
    const agora = new Date();
    const statusBadge={confirmado:'badge-confirmado',pendente:'badge-pendente',cancelado:'badge-cancelado',concluido:'badge-concluido',faltou:'badge-faltou'};
    tbody.innerHTML=ags.map(a=>{
      const prof=profissionais.find(p=>p.id===a.profissional_id);
      const cor=corProf(prof);
      const ehDiaTodo=a.dia_todo;
      const dt=ehDiaTodo
        ?new Date(a.data_inicio).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'2-digit'})+' · Dia todo'
        :new Date(a.data_inicio).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});
      const atrasado = !['concluido','cancelado'].includes(a.status) && new Date(a.data_fim||a.data_inicio) < agora;
      // Profissional pode clicar apenas nos seus
      const podeEditar = usuario.perfil === 'admin' || a.profissional_id === usuario.id;
      return `<tr style="${atrasado?'background:rgba(239,68,68,0.06);':''}">
        <td>${dt}${atrasado?` <span style="color:#ef4444;font-size:0.72rem">⚠️</span>`:''}</td>
        <td><strong>${a.cliente_nome}</strong></td>
        <td><span style="display:inline-flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:50%;background:${cor};display:inline-block"></span>${a.profissional_nome||'—'}</span></td>
        <td>${a.observacoes?a.observacoes.substring(0,30)+(a.observacoes.length>30?'...':''):'—'}</td>
        <td><span class="badge ${statusBadge[a.status]||''}">${a.status}</span></td>
        <td>${podeEditar?`<button class="btn btn-secondary btn-sm" onclick="abrirVerAgendamentoKanban(${a.id})">Ver</button>`:'—'}</td>
      </tr>`;
    }).join('');
  } catch(err){console.error(err);}
}

// ── Abre agendamento a partir do Kanban/Lista ─────────────
async function abrirVerAgendamentoKanban(id) {
  const hoje = new Date();
  const ini = new Date(hoje.getFullYear()-1,0,1).toISOString().split('T')[0]+'T00:00:00';
  const fim = new Date(hoje.getFullYear()+2,11,31).toISOString().split('T')[0]+'T23:59:59';
  try {
    const r = await fetch(`${API}/agendamentos?inicio=${ini}&fim=${fim}`, { headers:{ Authorization:`Bearer ${token}` } });
    const ags = await r.json();
    const ag = ags.find(a => a.id === id);
    if (!ag) return;
    dataSelecionada = new Date(ag.data_inicio).toLocaleDateString('en-CA', { timeZone:'America/Sao_Paulo' });
    abrirVerAgendamento(id);
  } catch(err) { console.error(err); }
}

// ── Ver Compromisso ───────────────────────────────────────
async function abrirVerAgendamento(id) {
  try {
    const fimFuturo = `${new Date().getFullYear()+2}-12-31T23:59:59`;
    const r=await fetch(`${API}/agendamentos?inicio=2020-01-01T00:00:00&fim=${fimFuturo}`,{headers:{Authorization:`Bearer ${token}`}});
    const ags=await r.json();
    const ag=ags.find(a=>a.id===id);
    if(!ag){ console.error('Agendamento não encontrado id:', id); return; }
    const prof=profissionais.find(p=>p.id===ag.profissional_id);
    const cor=corProf(prof);
    const ehDiaTodo=ag.dia_todo;
    const dtInicio=new Date(ag.data_inicio).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',weekday:'long',day:'2-digit',month:'long',hour:'2-digit',minute:'2-digit'});
    const dtFim=(!ehDiaTodo&&ag.data_fim)?new Date(ag.data_fim).toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}):'';
    document.getElementById('detalheAgendamento').innerHTML=`
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:1rem;border-top:4px solid ${cor}">
        <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:0.88rem"><span style="color:var(--muted)">Título</span><strong>${ag.cliente_nome}</strong></div>
        <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:0.88rem">
          <span style="color:var(--muted)">Responsável</span>
          <span style="display:flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:50%;background:${cor};display:inline-block"></span>${ag.profissional_nome||'—'}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:5px 0;${ag.observacoes?'border-bottom:1px solid var(--border);':''}font-size:0.88rem">
          <span style="color:var(--muted)">Data/Hora</span>
          <span>${ehDiaTodo?dtInicio.split(',')[0]+' · Dia todo':dtInicio+(dtFim?` até ${dtFim}`:'')}</span>
        </div>
        ${ag.observacoes?`<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:0.82rem;color:var(--muted)">💬 ${ag.observacoes}</div>`:''}
      </div>`;
    document.getElementById('editAgId').value=id;
    document.getElementById('editStatus').value=ag.status;
    document.getElementById('partProfissional').innerHTML=profissionais.filter(p=>p.id!==ag.profissional_id).map(p=>`<option value="${p.id}">${p.nome}</option>`).join('');
    document.getElementById('formParticipante').style.display='none';
    setTipoParticipante('interno');
    await carregarParticipantes(id);
    document.getElementById('modalVerAgendamento').classList.add('active');
  } catch(err){console.error(err);}
}
function fecharModalVer(){document.getElementById('modalVerAgendamento').classList.remove('active');}

async function atualizarStatus() {
  const id=document.getElementById('editAgId').value;
  const status=document.getElementById('editStatus').value;
  try {
    const r=await fetch(`${API}/agendamentos/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({status})});
    if(!r.ok){const d=await r.json();mostrarToast('❌ Erro',d.erro||'Sem permissão');return;}
    fecharModalVer();
    carregarPainelAgenda();
    if(document.getElementById('abaLista').style.display!=='none') carregarLista();
  } catch(err){console.error(err);}
}

// ── Modal Novo Compromisso ────────────────────────────────
function abrirNovoAgendamento() {
  document.getElementById('agId').value='';
  document.getElementById('agTitulo').value='';
  document.getElementById('agObs').value='';
  document.getElementById('agData').value=dataSelecionada;
  const agora=new Date();
  document.getElementById('agHoraInicio').value=`${String(agora.getHours()).padStart(2,'0')}:${agora.getMinutes()<30?'00':'30'}`;
  document.getElementById('agHoraFim').value='';
  document.getElementById('chkDiaTodo').checked=false;
  document.getElementById('chkAddParticipante').checked=false;
  document.getElementById('camposHora').style.display='flex';
  document.getElementById('campoParticipante').style.display='none';
  document.getElementById('agParticipante').innerHTML=profissionais.filter(p=>p.id!==usuario.id).map(p=>`<option value="${p.id}">${p.nome}</option>`).join('');
  document.getElementById('erroAgendamento').style.display='none';
  const _chkExt=document.getElementById('chkConvidarExterno');
  const _campoExt=document.getElementById('campoConvidarExterno');
  if(_chkExt) _chkExt.checked=false;
  if(_campoExt) _campoExt.style.display='none';
  const _emailExt=document.getElementById('emailConvidado');
  if(_emailExt) _emailExt.value='';
  document.getElementById('modalAgendamento').classList.add('active');
}
function fecharModalAgendamento(){document.getElementById('modalAgendamento').classList.remove('active');}
function toggleDiaTodo(chk){document.getElementById('camposHora').style.display=chk.checked?'none':'flex';}
function toggleAddParticipanteNovo(chk){document.getElementById('campoParticipante').style.display=chk.checked?'block':'none';}

async function salvarAgendamento() {
  const titulo=document.getElementById('agTitulo').value.trim();
  const obs=document.getElementById('agObs').value.trim();
  const data=document.getElementById('agData').value;
  const diaTodo=document.getElementById('chkDiaTodo').checked;
  const horaIni=document.getElementById('agHoraInicio').value;
  const horaFim=document.getElementById('agHoraFim').value;
  const addPart=document.getElementById('chkAddParticipante').checked;
  const partId=document.getElementById('agParticipante').value;
  const erro=document.getElementById('erroAgendamento');
  if(!titulo){erro.textContent='Informe o título';erro.style.display='block';return;}
  if(!data){erro.textContent='Informe a data';erro.style.display='block';return;}
  if(!diaTodo&&!horaIni){erro.textContent='Informe o horário de início';erro.style.display='block';return;}
  if(!diaTodo&&!horaFim){erro.textContent='Informe o horário de fim';erro.style.display='block';return;}
  erro.style.display='none';
  document.getElementById('btnAgendar').style.display='none';
  document.getElementById('spinnerAgendar').style.display='inline-block';
  try {
    const data_inicio=diaTodo?`${data}T00:00:00-03:00`:`${data}T${horaIni}:00-03:00`;
    const data_fim=diaTodo?`${data}T23:59:59-03:00`:`${data}T${horaFim}:00-03:00`;
    const emailConvidado = document.getElementById('chkConvidarExterno')?.checked
      ? (document.getElementById('emailConvidado')?.value?.trim() || null) : null;
    const r=await fetch(`${API}/agendamentos`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
      body:JSON.stringify({empresa_id:usuario.empresa_id,profissional_id:usuario.id,cliente_nome:titulo,data_inicio,data_fim,dia_todo:diaTodo,observacoes:obs||null,email_convidado:emailConvidado})});
    const dataResp=await r.json();
    if(!r.ok){erro.textContent=dataResp.erro||'Erro ao salvar';erro.style.display='block';return;}
    if(addPart&&partId) await fetch(`${API}/participantes`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({agendamento_id:dataResp.id,profissional_id:parseInt(partId)})});
    fecharModalAgendamento();
    carregarPainelAgenda();
  } catch{erro.textContent='Erro de conexão';erro.style.display='block';}
  finally{document.getElementById('btnAgendar').style.display='inline';document.getElementById('spinnerAgendar').style.display='none';}
}

// ── Participantes ─────────────────────────────────────────
function toggleAddParticipante(){const form=document.getElementById('formParticipante');form.style.display=form.style.display==='none'?'block':'none';document.getElementById('erroParticipante').style.display='none';}
function setTipoParticipante(tipo){
  tipoParticipante=tipo;
  document.getElementById('campoInterno').style.display=tipo==='interno'?'block':'none';
  document.getElementById('campoExterno').style.display=tipo==='externo'?'block':'none';
  ['btnTipoInterno','btnTipoExterno'].forEach(id=>{
    const el=document.getElementById(id),ativo=(id==='btnTipoInterno'&&tipo==='interno')||(id==='btnTipoExterno'&&tipo==='externo');
    el.style.background=ativo?'var(--accent)':'';el.style.color=ativo?'#fff':'';el.style.borderColor=ativo?'var(--accent)':'';
  });
}
async function carregarParticipantes(agId){
  try{const r=await fetch(`${API}/participantes/${agId}`,{headers:{Authorization:`Bearer ${token}`}});const lista=await r.json();const el=document.getElementById('listaParticipantes');
    if(!lista.length){el.innerHTML=`<p style="color:var(--muted);font-size:0.82rem;text-align:center;padding:0.5rem">Nenhum participante adicionado.</p>`;return;}
    const si={pendente:'⏳',confirmado:'✅',cancelado:'❌'};
    el.innerHTML=lista.map(p=>`<div style="display:flex;align-items:center;gap:0.75rem;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:0.6rem 0.9rem;">
      <span>${p.profissional_id?'👤':'🌐'}</span>
      <div style="flex:1"><div style="font-weight:600;font-size:0.85rem">${p.profissional_nome||p.nome_externo||'—'}</div>
        ${(p.profissional_email||p.email_externo)?`<div style="font-size:0.75rem;color:var(--muted)">${p.profissional_email||p.email_externo}</div>`:''}</div>
      <span title="${p.status}">${si[p.status]||'⏳'}</span>
      <button onclick="removerParticipante(${p.id},${p.agendamento_id})" style="background:none;border:none;color:var(--muted);cursor:pointer;padding:2px 4px">✕</button>
    </div>`).join('');
  }catch(err){console.error(err);}
}
async function adicionarParticipante(){
  const agId=document.getElementById('editAgId').value,erro=document.getElementById('erroParticipante');erro.style.display='none';
  let body={agendamento_id:parseInt(agId)};
  if(tipoParticipante==='interno'){const pid=document.getElementById('partProfissional').value;if(!pid){erro.textContent='Selecione um analista';erro.style.display='block';return;}body.profissional_id=parseInt(pid);}
  else{const nome=document.getElementById('partNome').value.trim(),email=document.getElementById('partEmail').value.trim();if(!nome||!email){erro.textContent='Nome e e-mail são obrigatórios';erro.style.display='block';return;}body.nome_externo=nome;body.email_externo=email;}
  try{const r=await fetch(`${API}/participantes`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body)});const d=await r.json();
    if(!r.ok){erro.textContent=d.erro||'Erro ao adicionar';erro.style.display='block';return;}
    document.getElementById('formParticipante').style.display='none';document.getElementById('partNome').value='';document.getElementById('partEmail').value='';
    await carregarParticipantes(agId);mostrarToast('✅ Convite enviado!','O participante receberá um e-mail com o convite.');
  }catch{erro.textContent='Erro de conexão';erro.style.display='block';}
}
async function removerParticipante(id,agId){if(!confirm('Remover este participante?'))return;try{await fetch(`${API}/participantes/${id}`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`}});await carregarParticipantes(agId);}catch(err){console.error(err);}}

// ── Profissionais / Analistas ─────────────────────────────
async function carregarProfissionaisFiltro(){
  try{const r=await fetch(`${API}/profissionais?empresa_id=${usuario.empresa_id}`,{headers:{Authorization:`Bearer ${token}`}});profissionais=await r.json();
    const opts='<option value="">Todos</option>'+profissionais.map(p=>`<option value="${p.id}">${p.nome}</option>`).join('');
    const fp=document.getElementById('filtroProfissional');if(fp)fp.innerHTML=opts;
    const fp2=document.getElementById('filtroProf2');if(fp2)fp2.innerHTML=opts;
  }catch(err){console.error(err);}
}
async function carregarProfissionaisAba(){
  await carregarProfissionaisFiltro();
  document.getElementById('listaProfissionais').innerHTML=profissionais.map(p=>{
    const cor=corProf(p);
    return `<div class="card"><div class="card-body" style="display:flex;flex-direction:column;align-items:center;text-align:center;gap:0.75rem;">
      <div style="width:56px;height:56px;border-radius:50%;background:${cor};display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:1.3rem;">${p.nome.charAt(0).toUpperCase()}</div>
      <div><div style="font-weight:700;color:var(--text)">${p.nome}</div><div style="font-size:0.78rem;color:var(--muted)">${p.email}</div>
        <span class="badge ${p.perfil==='admin'?'badge-confirmado':'badge-pendente'}" style="margin-top:4px">${p.perfil==='admin'?'👑 Admin':'🔍 Analista'}</span></div>
      ${usuario.perfil==='admin'?`<button class="btn btn-secondary btn-sm" onclick="editarProfissional(${p.id})" style="width:100%">✏️ Editar</button>`:''}
    </div></div>`;
  }).join('')||'<p style="color:var(--muted)">Nenhum analista cadastrado</p>';
}
function abrirNovoProfissional(){document.getElementById('profId').value='';document.getElementById('tituloProfissionalModal').textContent='👤 Novo Analista';document.getElementById('btnProfText').textContent='Cadastrar';document.getElementById('labelSenhaProf').innerHTML='Senha <span style="color:var(--accent)">*</span>';['profNome','profEmail','profTelefone','profSenha'].forEach(id=>document.getElementById(id).value='');document.getElementById('profPerfil').value='profissional';document.getElementById('profCor').value='#0d9488';document.getElementById('erroProfissional').style.display='none';document.getElementById('modalProfissional').classList.add('active');}
function editarProfissional(id){const p=profissionais.find(x=>x.id===id);if(!p)return;document.getElementById('profId').value=p.id;document.getElementById('tituloProfissionalModal').textContent='✏️ Editar Analista';document.getElementById('btnProfText').textContent='Salvar';document.getElementById('labelSenhaProf').textContent='Nova senha (deixe em branco para manter)';document.getElementById('profNome').value=p.nome;document.getElementById('profEmail').value=p.email;document.getElementById('profTelefone').value=p.telefone||'';document.getElementById('profSenha').value='';document.getElementById('profPerfil').value=p.perfil;document.getElementById('profCor').value=corProf(p);document.getElementById('erroProfissional').style.display='none';document.getElementById('modalProfissional').classList.add('active');}
function fecharModalProfissional(){document.getElementById('modalProfissional').classList.remove('active');}
async function salvarProfissional(){
  const id=document.getElementById('profId').value,nome=document.getElementById('profNome').value.trim(),email=document.getElementById('profEmail').value.trim(),tel=document.getElementById('profTelefone').value.trim(),senha=document.getElementById('profSenha').value,perf=document.getElementById('profPerfil').value,cor=document.getElementById('profCor').value,erro=document.getElementById('erroProfissional');
  if(!nome||!email){erro.textContent='Nome e e-mail são obrigatórios';erro.style.display='block';return;}
  if(!id&&!senha){erro.textContent='Senha é obrigatória para novo analista';erro.style.display='block';return;}
  erro.style.display='none';
  try{const body={nome,email,telefone:tel||null,perfil:perf,cor_agenda:cor};if(senha)body.senha=senha;
    const r=await fetch(id?`${API}/profissionais/${id}`:`${API}/profissionais`,{method:id?'PATCH':'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
    const data=await r.json();if(!r.ok){erro.textContent=data.erro||'Erro ao salvar';erro.style.display='block';return;}
    fecharModalProfissional();carregarProfissionaisAba();mostrarToast('✅ Analista salvo!',`${nome} foi ${id?'atualizado':'cadastrado'} com sucesso.`);
  }catch{erro.textContent='Erro de conexão';erro.style.display='block';}
}

// ── Disponibilidade ───────────────────────────────────────
let disponibilidadeAtual=[];
async function carregarDisponibilidade(){try{const r=await fetch(`${API}/profissionais/${usuario.id}/disponibilidade`,{headers:{Authorization:`Bearer ${token}`}});disponibilidadeAtual=await r.json();renderDisponibilidade();}catch(err){console.error(err);}}
function renderDisponibilidade(){document.getElementById('formDisponibilidade').innerHTML=DIAS_COMPLETO.map((dia,idx)=>{const d=disponibilidadeAtual.find(x=>x.dia_semana===idx);return `<div style="display:flex;align-items:center;gap:1rem;padding:0.75rem 0;border-bottom:1px solid var(--border);flex-wrap:wrap;"><label style="display:flex;align-items:center;gap:8px;min-width:140px;cursor:pointer;"><input type="checkbox" id="disp_ativo_${idx}" ${d?.ativo!==false&&d?'checked':''} style="accent-color:var(--accent);width:16px;height:16px;" /><span style="font-weight:500">${dia}</span></label><div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;"><input type="time" id="disp_ini_${idx}" value="${d?.hora_inicio||'08:00'}" style="width:110px;" /><span style="color:var(--muted)">até</span><input type="time" id="disp_fim_${idx}" value="${d?.hora_fim||'18:00'}" style="width:110px;" /></div></div>`;}).join('');}
async function salvarDisponibilidade(){const disp=DIAS_COMPLETO.map((_,idx)=>({dia_semana:idx,ativo:document.getElementById(`disp_ativo_${idx}`)?.checked||false,hora_inicio:document.getElementById(`disp_ini_${idx}`)?.value||'08:00',hora_fim:document.getElementById(`disp_fim_${idx}`)?.value||'18:00'}));try{const r=await fetch(`${API}/profissionais/${usuario.id}/disponibilidade`,{method:'PUT',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({disponibilidade:disp})});if(r.ok)mostrarToast('✅ Disponibilidade salva!','Suas configurações foram atualizadas.');}catch(err){console.error(err);}}

// ── Configurações ─────────────────────────────────────────
async function carregarConfiguracoes(){
  try{
    const r=await fetch(`${API}/empresas/minha`,{headers:{Authorization:`Bearer ${token}`}});
    const emp=await r.json();
    const linkEl=document.getElementById('linkPublico');
    // Usa sempre a URL do Railway, não o IP local
    if(linkEl) linkEl.value=`${FRONTEND_URL}/agendar.html?empresa=${emp.slug}`;
  }catch(err){console.error(err);}
}
function copiarLink(){const link=document.getElementById('linkPublico');if(!link)return;navigator.clipboard.writeText(link.value).then(()=>{const conf=document.getElementById('linkCopiado');if(conf){conf.style.display='block';setTimeout(()=>conf.style.display='none',2500);}mostrarToast('🔗 Link copiado!','Compartilhe com seus clientes.');});}

// ── Perfil ────────────────────────────────────────────────
function abrirPerfil(){document.getElementById('perfilInfo').innerHTML=`<div><strong>Nome:</strong> ${usuario.nome}</div><div><strong>E-mail:</strong> ${usuario.email}</div><div><strong>Perfil:</strong> ${usuario.perfil==='admin'?'👑 Administrador':usuario.perfil==='superadmin'?'⚡ Super Admin':'🔍 Analista'}</div>`;document.getElementById('erroPerfil').style.display='none';document.getElementById('sucessoPerfil').style.display='none';document.getElementById('novaSenhaP').value='';document.getElementById('confirmarSenhaP').value='';document.getElementById('modalPerfil').classList.add('active');}
function fecharPerfil(){document.getElementById('modalPerfil').classList.remove('active');}
async function trocarSenha(){const nova=document.getElementById('novaSenhaP').value.trim(),conf=document.getElementById('confirmarSenhaP').value.trim(),erro=document.getElementById('erroPerfil'),suc=document.getElementById('sucessoPerfil');erro.style.display='none';suc.style.display='none';if(!nova||!conf){erro.textContent='Preencha os dois campos';erro.style.display='block';return;}if(nova!==conf){erro.textContent='As senhas não conferem';erro.style.display='block';return;}if(nova.length<6){erro.textContent='Mínimo de 6 caracteres';erro.style.display='block';return;}try{const r=await fetch(`${API}/profissionais/${usuario.id}/senha`,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({senha:nova})});if(r.ok){suc.textContent='✅ Senha alterada!';suc.style.display='block';}else{const d=await r.json();erro.textContent=d.erro||'Erro';erro.style.display='block';}}catch{erro.textContent='Erro de conexão';erro.style.display='block';}}

// ── Empresas (superadmin) ─────────────────────────────────
let _todasEmpresasSA=[];
async function carregarEmpresas(){try{const r=await fetch(`${API}/empresas`,{headers:{Authorization:`Bearer ${token}`}});const emps=await r.json();_todasEmpresasSA=emps||[];renderEmpresasSA(_todasEmpresasSA);}catch(err){console.error(err);}}
function filtrarEmpresasSA(){const q=document.getElementById('pesquisaEmpresas').value.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'');if(!q){renderEmpresasSA(_todasEmpresasSA);return;}const qd=q.replace(/\D/g,'');renderEmpresasSA(_todasEmpresasSA.filter(e=>{const n=(e.nome_fantasia||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');const c=(e.cnpj||'').replace(/\D/g,'');return n.includes(q)||(qd&&c.includes(qd));}));}
function renderEmpresasSA(emps){const tbody=document.getElementById('tabelaEmpresas');if(!emps.length){tbody.innerHTML='<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--muted)">Nenhuma empresa encontrada.</td></tr>';return;}tbody.innerHTML=emps.map(e=>`<tr style="cursor:pointer" onclick="toggleUsuariosSA(${e.id},'${(e.nome_fantasia||'').replace(/'/g,"\\'")}',this)"><td><strong>${e.nome_fantasia}</strong></td><td style="font-size:0.82rem;color:var(--muted)">${e.cnpj}</td><td>${e.email||'—'}</td><td><code style="background:var(--surface2);padding:2px 6px;border-radius:4px;font-size:0.78rem">${e.slug||'—'}</code></td><td><span class="badge ${e.status==='ativo'?'badge-confirmado':'badge-cancelado'}">${e.status}</span></td><td onclick="event.stopPropagation()" style="display:flex;gap:0.4rem"><button class="btn btn-secondary btn-sm" onclick="abrirVerEmpresa(${e.id},'${e.status}')">✏️ Editar</button><button class="btn btn-secondary btn-sm" onclick="copiarLinkEmpresa('${e.slug}')">🔗 Link</button></td></tr><tr id="usersRow_${e.id}" style="display:none"><td colspan="6" style="padding:0"><div id="usersPanel_${e.id}" style="padding:1rem;background:var(--surface2);border-top:1px solid var(--border)"><span style="color:var(--muted);font-size:0.85rem">Carregando usuários...</span></div></td></tr>`).join('');}
async function toggleUsuariosSA(id,nome,tr){const row=document.getElementById(`usersRow_${id}`);const panel=document.getElementById(`usersPanel_${id}`);if(row.style.display!=='none'){row.style.display='none';return;}// Fecha outros abertos
document.querySelectorAll('[id^="usersRow_"]').forEach(r=>r.style.display='none');row.style.display='table-row';panel.innerHTML='<span style="color:var(--muted);font-size:0.85rem">Carregando usuários...</span>';try{const r=await fetch(`${API}/empresas/${id}/usuarios`,{headers:{Authorization:`Bearer ${token}`}});const users=await r.json();if(!users.length){panel.innerHTML='<p style="color:var(--muted);font-size:0.85rem;margin:0">Nenhum usuário cadastrado.</p>';return;}panel.innerHTML=`<p style="font-size:0.78rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.75rem">👥 Usuários de ${nome}</p><table style="width:100%;border-collapse:collapse"><thead><tr style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em"><th style="text-align:left;padding:4px 8px">Nome</th><th style="text-align:left;padding:4px 8px">E-mail</th><th style="text-align:left;padding:4px 8px">Perfil</th><th style="text-align:left;padding:4px 8px">Status</th></tr></thead><tbody>${users.map(u=>`<tr style="font-size:0.85rem;border-top:1px solid var(--border)"><td style="padding:6px 8px">${u.nome}</td><td style="padding:6px 8px;color:var(--muted)">${u.email}</td><td style="padding:6px 8px"><span class="badge ${u.perfil==='admin'?'badge-confirmado':'badge-pendente'}">${u.perfil==='admin'?'👑 Admin':'🔧 Analista'}</span></td><td style="padding:6px 8px">${u.ativo?'<span style="color:var(--accent)">✅ Ativo</span>':'<span style="color:var(--error)">❌ Inativo</span>'}</td></tr>`).join('')}</tbody></table>`;}catch{panel.innerHTML='<p style="color:var(--error);font-size:0.85rem;margin:0">Erro ao carregar usuários.</p>';}}
function abrirNovaEmpresa(){document.getElementById('empId').value='';document.getElementById('tituloModalEmpresa').textContent='🏢 Nova Empresa';document.getElementById('btnEmpresaText').textContent='Criar Empresa';document.getElementById('secaoAdmin').style.display='block';['empNome','empCnpj','empEmail','empTelefone','empSlug','empAdminNome','empAdminEmail','empAdminSenha'].forEach(id=>document.getElementById(id).value='');document.getElementById('empCor').value='#0d9488';document.getElementById('slugPreview').textContent='slug';document.getElementById('erroEmpresa').style.display='none';document.getElementById('modalEmpresa').classList.add('active');document.getElementById('empSlug').oninput=function(){document.getElementById('slugPreview').textContent=this.value||'slug';};}
function fecharModalEmpresa(){document.getElementById('modalEmpresa').classList.remove('active');}
function abrirVerEmpresa(id,status){document.getElementById('editEmpresaId').value=id;document.getElementById('editEmpresaStatus').value=status;document.getElementById('detalheEmpresa').innerHTML=`<p style="color:var(--muted);font-size:0.88rem">Atualize o status da empresa abaixo.</p>`;document.getElementById('modalVerEmpresa').classList.add('active');}
function fecharModalVerEmpresa(){document.getElementById('modalVerEmpresa').classList.remove('active');}
async function atualizarEmpresa(){const id=document.getElementById('editEmpresaId').value,status=document.getElementById('editEmpresaStatus').value;try{const r=await fetch(`${API}/empresas/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({status})});if(!r.ok){const d=await r.json();mostrarToast('❌ Erro',d.erro);return;}fecharModalVerEmpresa();carregarEmpresas();mostrarToast('✅ Empresa atualizada!','Status alterado com sucesso.');}catch{mostrarToast('❌ Erro de conexão','Tente novamente.');}}
async function salvarEmpresa(){const nome=document.getElementById('empNome').value.trim(),cnpj=document.getElementById('empCnpj').value.trim(),slug=document.getElementById('empSlug').value.trim(),adminNome=document.getElementById('empAdminNome').value.trim(),adminEmail=document.getElementById('empAdminEmail').value.trim(),adminSenha=document.getElementById('empAdminSenha').value,erro=document.getElementById('erroEmpresa');if(!nome||!cnpj||!slug){erro.textContent='Nome, CNPJ e slug são obrigatórios';erro.style.display='block';return;}if(!adminNome||!adminEmail||!adminSenha){erro.textContent='Preencha os dados do administrador';erro.style.display='block';return;}if(adminSenha.length<6){erro.textContent='A senha deve ter no mínimo 6 caracteres';erro.style.display='block';return;}erro.style.display='none';document.getElementById('btnEmpresaText').style.display='none';document.getElementById('spinnerEmpresa').style.display='inline-block';try{const r=await fetch(`${API}/empresas`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({nome_fantasia:nome,cnpj,email:document.getElementById('empEmail').value,telefone:document.getElementById('empTelefone').value,slug,cor_primaria:document.getElementById('empCor').value,admin_nome:adminNome,admin_email:adminEmail,admin_senha:adminSenha})});const data=await r.json();if(!r.ok){erro.textContent=data.erro||'Erro ao criar empresa';erro.style.display='block';return;}fecharModalEmpresa();carregarEmpresas();mostrarToast('✅ Empresa criada!',`${nome} foi cadastrada.`);}catch{erro.textContent='Erro de conexão';erro.style.display='block';}finally{document.getElementById('btnEmpresaText').style.display='inline';document.getElementById('spinnerEmpresa').style.display='none';}}
function copiarLinkEmpresa(slug){navigator.clipboard.writeText(`${FRONTEND_URL}/agendar.html?empresa=${slug}`).then(()=>mostrarToast('🔗 Link copiado!',`${FRONTEND_URL}/agendar.html?empresa=${slug}`));}

// ── Notificações ──────────────────────────────────────────
function iniciarPolling(){verificarNotificacoes();pollingInterval=setInterval(verificarNotificacoes,30000);}
async function verificarNotificacoes(){
  try{
    const r=await fetch(`${API}/notificacoes`,{headers:{Authorization:`Bearer ${token}`}});
    if(r.status===401){sair();return;}
    const notifs=await r.json();
    const novas=notifs.filter(n=>n.id>ultimaNotifId);
    novas.forEach(n=>mostrarToast(n.titulo,n.mensagem,n.id));
    if(novas.length) ultimaNotifId=Math.max(...novas.map(n=>n.id));
    // Badge de notificações do sistema (não atraso, isso é feito nas stats)
    const btnNotif=document.getElementById('btnNotif');
    if(btnNotif&&notifs.length>0&&!btnNotif.innerHTML.includes('badge')) {
      btnNotif.innerHTML=`🔔<span style="position:absolute;top:-4px;right:-4px;background:#0d9488;color:#fff;border-radius:999px;font-size:0.6rem;min-width:16px;height:16px;display:flex;align-items:center;justify-content:center;padding:0 3px;font-weight:700">${notifs.length}</span>`;
      btnNotif.style.position='relative';
    } else if(btnNotif&&notifs.length===0) {
      btnNotif.innerHTML='🔔';
    }
  }catch{}
}
function abrirNotificacoes(){verificarNotificacoes();}
function mostrarToast(titulo,mensagem,id){const c=document.getElementById('toastContainer');const t=document.createElement('div');t.className='toast';t.innerHTML=`<div class="toast-header"><span>🔔</span><strong class="toast-title">${titulo}</strong><button class="toast-close" onclick="fecharToast(this,${id||0})">✕</button></div><div class="toast-body">${mensagem}</div>`;c.appendChild(t);requestAnimationFrame(()=>t.classList.add('toast-show'));setTimeout(()=>fecharToast(t.querySelector('.toast-close'),id||0),7000);}
async function fecharToast(btn,id){const t=btn.closest('.toast');if(!t)return;t.classList.remove('toast-show');t.classList.add('toast-hide');setTimeout(()=>t.remove(),300);if(id){try{await fetch(`${API}/notificacoes/${id}/lida`,{method:'PATCH',headers:{Authorization:`Bearer ${token}`}});}catch{}}}

// ── Auth ──────────────────────────────────────────────────
function sair(){if(pollingInterval)clearInterval(pollingInterval);localStorage.clear();window.location.href='index.html';}
function logoff(){if(pollingInterval)clearInterval(pollingInterval);const cnpj=localStorage.getItem('cnpj_salvo');localStorage.removeItem('token');localStorage.removeItem('usuario');if(cnpj)localStorage.setItem('cnpj_salvo',cnpj);window.location.href='index.html';}


// ── Voltar ao início ──────────────────────────────────────
function voltarInicio() {
  mudarAba('agenda');
  mudarVisualizacao('proximos');
}

// ── Painel de Notificações (Atrasados) ────────────────────
let painelNotifAberto = false;

function togglePainelNotificacoes() {
  painelNotifAberto = !painelNotifAberto;
  const painel = document.getElementById('painelNotificacoes');
  if (painelNotifAberto) {
    painel.classList.add('active');
    carregarAtrasadosNoPanel();
    // fecha ao clicar fora
    setTimeout(() => document.addEventListener('click', fecharPainelFora, { once: true }), 100);
  } else {
    painel.classList.remove('active');
  }
}

function fecharPainelFora(e) {
  const painel = document.getElementById('painelNotificacoes');
  const btn = document.getElementById('btnNotif');
  if (!painel.contains(e.target) && !btn.contains(e.target)) {
    painel.classList.remove('active');
    painelNotifAberto = false;
  }
}

function fecharPainelNotificacoes() {
  document.getElementById('painelNotificacoes').classList.remove('active');
  painelNotifAberto = false;
}

async function carregarAtrasadosNoPanel() {
  const body = document.getElementById('painelNotifBody');
  body.innerHTML = '<div class="notif-empty">Buscando...</div>';
  try {
    const agora = new Date();
    const hoje = agora.toISOString().split('T')[0];
    const r = await fetch(`${API}/agendamentos?inicio=2020-01-01T00:00:00&fim=${hoje}T23:59:59`, { headers:{ Authorization:`Bearer ${token}` } });
    const ags = await r.json();
    const atrasados = ags.filter(a => !['concluido','cancelado'].includes(a.status) && new Date(a.data_fim||a.data_inicio) < agora);
    if (!atrasados.length) {
      body.innerHTML = '<div class="notif-empty">✅ Você não tem compromissos em atraso!</div>';
      return;
    }
    body.innerHTML = atrasados.map(a => {
      const dt = a.dia_todo
        ? new Date(a.data_inicio).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'2-digit'}) + ' · Dia todo'
        : new Date(a.data_inicio).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});
      return `<div class="notif-item" onclick="abrirVerAgendamentoKanban(${a.id});fecharPainelNotificacoes();" style="cursor:pointer">
        <div class="notif-item-titulo">⚠️ ${a.cliente_nome}</div>
        <div class="notif-item-data">👤 ${a.profissional_nome||'—'} · 📅 ${dt}</div>
      </div>`;
    }).join('');
  } catch(err) {
    body.innerHTML = '<div class="notif-empty">Erro ao carregar.</div>';
  }
}

// ── Bloco de Notas ────────────────────────────────────────
function abrirNotas() {
  const chave = `notas_${usuario.id}`;
  const salvo = localStorage.getItem(chave) || '';
  document.getElementById('notasTexto').value = salvo;
  document.getElementById('modalNotas').classList.add('active');
}
function fecharNotas() { document.getElementById('modalNotas').classList.remove('active'); }
function salvarNotas() {
  const chave = `notas_${usuario.id}`;
  localStorage.setItem(chave, document.getElementById('notasTexto').value);
  fecharNotas();
  mostrarToast('📝 Anotações salvas!', 'Suas anotações foram salvas localmente.');
}

// ── Atualizar Status com Observação ──────────────────────
let _statusPendente = null;

function pedirObsStatus() {
  const status = document.getElementById('editStatus').value;
  _statusPendente = status;
  const titulo = status === 'concluido' ? '🏁 Concluído — O que foi feito?' :
                 status === 'cancelado' ? '🚫 Cancelado — Qual o motivo?' :
                 '📝 Observação';
  const subtitulo = status === 'concluido'
    ? 'Descreva brevemente o que foi realizado.'
    : status === 'cancelado'
    ? 'Informe o motivo do cancelamento.'
    : 'Adicione uma observação opcional.';
  document.getElementById('tituloObsStatus').textContent = titulo;
  document.getElementById('subtituloObsStatus').textContent = subtitulo;
  document.getElementById('obsStatusTexto').value = '';
  document.getElementById('modalVerAgendamento').classList.remove('active');
  document.getElementById('modalObsStatus').classList.add('active');
}
function fecharObsStatus() {
  document.getElementById('modalObsStatus').classList.remove('active');
  document.getElementById('modalVerAgendamento').classList.add('active');
  _statusPendente = null;
}
async function confirmarAtualizarStatus() {
  const id = document.getElementById('editAgId').value;
  const obs = document.getElementById('obsStatusTexto').value.trim();
  const status = _statusPendente;
  if (!status) return;
  try {
    const r = await fetch(`${API}/agendamentos/${id}`, {
      method:'PATCH',
      headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`},
      body: JSON.stringify({ status, observacoes: obs || undefined })
    });
    if (!r.ok) { const d=await r.json(); mostrarToast('❌ Erro', d.erro||'Sem permissão'); return; }
    document.getElementById('modalObsStatus').classList.remove('active');
    _statusPendente = null;
    carregarPainelAgenda();
    if (document.getElementById('abaLista').style.display!=='none') carregarLista();
    mostrarToast('✅ Status atualizado!', `Compromisso marcado como ${status}.`);
  } catch(err) { console.error(err); }
}

// ── Aba Serviços ──────────────────────────────────────────
async function carregarServicosAba() {
  const tbody = document.getElementById('tabelaServicos');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--muted)">Carregando...</td></tr>';
  await carregarCheckboxesProfissionais();
  try {
    const r = await fetch(`${API}/servicos?empresa_id=${usuario.empresa_id}`, { headers:{ Authorization:`Bearer ${token}` } });
    const servs = await r.json();
    if (!Array.isArray(servs) || !servs.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--muted)">Nenhum serviço. Adicione o primeiro acima!</td></tr>';
      return;
    }
    tbody.innerHTML = servs.map(s => `
      <tr>
        <td><strong>${s.nome}</strong></td>
        <td style="color:var(--muted)">${s.descricao||'—'}</td>
        <td>${s.duracao_minutos ? s.duracao_minutos+' min' : '—'}</td>
        <td>
          <div style="display:flex;gap:6px">
            <button class="btn btn-secondary btn-sm" onclick="editarServico(${s.id})">✏️ Editar</button>
            <button class="btn btn-secondary btn-sm" style="color:var(--error)" onclick="excluirServico(${s.id})">🗑️</button>
          </div>
        </td>
      </tr>`).join('');
  } catch(err) { console.error(err); tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--muted)">Erro ao carregar.</td></tr>'; }
}

async function carregarCheckboxesProfissionais(profsSelecionados = []) {
  const container = document.getElementById('servicoProfissionaisCheck');
  if (!container) return;
  try {
    const r = await fetch(`${API}/profissionais?empresa_id=${usuario.empresa_id}`, { headers:{ Authorization:`Bearer ${token}` } });
    const profs = await r.json();
    if (!Array.isArray(profs) || !profs.length) {
      container.innerHTML = '<span style="color:var(--muted);font-size:0.82rem">Nenhum profissional cadastrado.</span>';
      return;
    }
    container.innerHTML = profs.map(p => `
      <label style="display:flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:0.88rem;transition:background 0.15s"
        onmouseover="this.style.background='rgba(13,148,136,0.06)'" onmouseout="this.style.background=''">
        <input type="checkbox" id="profCheck_${p.id}" value="${p.id}"
          style="accent-color:var(--accent);width:16px;height:16px;cursor:pointer"
          ${profsSelecionados.includes(p.id) ? 'checked' : ''} />
        <span style="font-weight:500">${p.nome}</span>
        <span style="color:var(--muted);font-size:0.75rem;margin-left:auto">${p.perfil === 'admin' ? '👑 Admin' : '👤 Prof.'}</span>
      </label>`).join('');
  } catch(err) { container.innerHTML = '<span style="color:var(--muted);font-size:0.82rem">Erro ao carregar profissionais.</span>'; }
}

function getProfissionaisSelecionados() {
  const checks = document.querySelectorAll('#servicoProfissionaisCheck input[type=checkbox]:checked');
  return Array.from(checks).map(c => parseInt(c.value));
}

async function salvarServico() {
  const id = document.getElementById('servicoId')?.value;
  const nome = document.getElementById('servicoNome').value.trim();
  const descricao = document.getElementById('servicoDescricao').value.trim();
  const duracao = parseInt(document.getElementById('servicoDuracao').value) || null;
  const profissionaisIds = getProfissionaisSelecionados();
  const erro = document.getElementById('erroServico');
  if (!nome) { erro.textContent='Nome obrigatório'; erro.style.display='block'; return; }
  erro.style.display='none';
  const method = id ? 'PATCH' : 'POST';
  const url = id ? `${API}/servicos/${id}` : `${API}/servicos`;
  try {
    const r = await fetch(url, {
      method,
      headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`},
      body: JSON.stringify({ nome, descricao: descricao||null, duracao_minutos: duracao, empresa_id: usuario.empresa_id, profissionais_ids: profissionaisIds })
    });
    if (!r.ok) { const d=await r.json(); erro.textContent=d.erro||'Erro ao salvar'; erro.style.display='block'; return; }
    const servicoSalvo = await r.json();
    const sid = servicoSalvo?.id || parseInt(id);
    if (sid) await sincronizarProfissionaisServico(sid, profissionaisIds);
    document.getElementById('servicoNome').value='';
    document.getElementById('servicoDescricao').value='';
    document.getElementById('servicoDuracao').value='';
    if(document.getElementById('servicoId')) document.getElementById('servicoId').value='';
    document.getElementById('btnSalvarServico').textContent='Salvar Serviço';
    document.querySelectorAll('#servicoProfissionaisCheck input[type=checkbox]').forEach(c => c.checked = false);
    carregarServicosAba();
    mostrarToast('✅ Serviço salvo!', nome);
  } catch(err) { console.error(err); erro.textContent='Erro de conexão'; erro.style.display='block'; }
}

async function sincronizarProfissionaisServico(servicoId, profissionaisIds) {
  try {
    const r = await fetch(`${API}/servicos/${servicoId}/profissionais`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ profissionais_ids: profissionaisIds })
    });
    if (r.ok) return;
  } catch {}
  // Fallback: insere/remove individualmente
  try {
    const rAtual = await fetch(`${API}/profissionais?empresa_id=${usuario.empresa_id}&servico_id=${servicoId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const atuais = rAtual.ok ? await rAtual.json() : [];
    const idsAtuais = Array.isArray(atuais) ? atuais.map(p => p.id) : [];
    for (const pid of profissionaisIds) {
      if (!idsAtuais.includes(pid)) {
        await fetch(`${API}/profissional-servicos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ profissional_id: pid, servico_id: servicoId })
        });
      }
    }
    for (const pid of idsAtuais) {
      if (!profissionaisIds.includes(pid)) {
        await fetch(`${API}/profissional-servicos?profissional_id=${pid}&servico_id=${servicoId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` }
        });
      }
    }
  } catch(err) { console.warn('Não foi possível sincronizar profissionais:', err); }
}

async function editarServico(id) {
  try {
    const r = await fetch(`${API}/servicos/${id}`, { headers:{ Authorization:`Bearer ${token}` } });
    let s = r.ok ? await r.json() : null;
    if (!s) { mostrarToast('⚠️', 'Não foi possível carregar serviço'); return; }
    document.getElementById('servicoId').value = s.id;
    document.getElementById('servicoNome').value = s.nome || '';
    document.getElementById('servicoDescricao').value = s.descricao || '';
    document.getElementById('servicoDuracao').value = s.duracao_minutos || '';
    document.getElementById('btnSalvarServico').textContent = 'Atualizar Serviço';
    document.getElementById('erroServico').style.display='none';
    const rProfs = await fetch(`${API}/profissionais?empresa_id=${usuario.empresa_id}&servico_id=${id}`, {
      headers:{ Authorization:`Bearer ${token}` }
    });
    const profsVinculados = rProfs.ok ? await rProfs.json() : [];
    const idsVinculados = Array.isArray(profsVinculados) ? profsVinculados.map(p => p.id) : [];
    await carregarCheckboxesProfissionais(idsVinculados);
    document.getElementById('servicoNome').focus();
    document.getElementById('servicoNome').scrollIntoView({ behavior:'smooth', block:'center' });
  } catch(err) { console.error(err); mostrarToast('❌ Erro', 'Erro ao carregar serviço'); }
}

async function excluirServico(id) {
  if (!confirm('Excluir este serviço?')) return;
  try {
    const r = await fetch(`${API}/servicos/${id}`, { method:'DELETE', headers:{ Authorization:`Bearer ${token}` } });
    if (!r.ok) { const d=await r.json(); mostrarToast('❌ Erro', d.erro||'Não foi possível excluir'); return; }
    carregarServicosAba();
  } catch(err) { mostrarToast('❌ Erro', 'Erro de conexão'); }
}

// ── Dashboard Stats — modal ao clicar nos cards ───────────
async function abrirDashboardStats(filtro) {
  let lista = window._agsHoje || [];
  if (filtro === 'atrasado') {
    const hoje = new Date().toISOString().split('T')[0];
    try {
      const r = await fetch(`${API}/agendamentos?inicio=2020-01-01T00:00:00&fim=${hoje}T23:59:59`, { headers:{ Authorization:`Bearer ${token}` }});
      const all = await r.json();
      const agora = new Date();
      lista = all.filter(a => !['concluido','cancelado'].includes(a.status) && new Date(a.data_fim||a.data_inicio) < agora);
    } catch { lista = []; }
  } else if (filtro !== 'todos') {
    lista = lista.filter(a => a.status === filtro);
  }

  const titulos = { todos:'📋 Todos os compromissos de hoje', confirmado:'✅ Confirmados hoje',
    cancelado:'❌ Cancelados hoje', concluido:'🏁 Concluídos hoje', atrasado:'⚠️ Compromissos atrasados' };
  const statusBadge = { confirmado:'badge-confirmado', pendente:'badge-pendente',
    cancelado:'badge-cancelado', concluido:'badge-concluido', faltou:'badge-faltou' };

  document.getElementById('dashboardStatsTitle').textContent = titulos[filtro]||'Compromissos';
  document.getElementById('dashboardStatsBody').innerHTML = lista.length
    ? `<table style="width:100%;border-collapse:collapse">
        <thead><tr style="font-size:0.75rem;color:var(--muted);text-transform:uppercase">
          <th style="text-align:left;padding:6px 8px">Data/Hora</th>
          <th style="text-align:left;padding:6px 8px">Título</th>
          <th style="text-align:left;padding:6px 8px">Responsável</th>
          <th style="text-align:left;padding:6px 8px">Status</th>
          <th></th>
        </tr></thead>
        <tbody>${lista.map(a => {
          const dt = new Date(a.data_inicio).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
          return '<tr>' +
            '<td style="padding:6px 8px;font-size:0.85rem">'+dt+'</td>' +
            '<td style="padding:6px 8px"><strong>'+a.cliente_nome+'</strong></td>' +
            '<td style="padding:6px 8px;color:var(--muted)">'+( a.profissional_nome||'—')+'</td>' +
            '<td style="padding:6px 8px"><span class="badge '+(statusBadge[a.status]||'')+'">'+a.status+'</span></td>' +
            '<td style="padding:6px 8px"><button class="btn btn-secondary btn-sm" onclick="fecharDashboardStats();abrirVerAgendamento('+a.id+')">Ver</button></td>' +
            '</tr>';
        }).join('')}</tbody>
      </table>`
    : '<p style="color:var(--muted);text-align:center;padding:2rem">Nenhum compromisso nesta categoria.</p>';

  document.getElementById('modalDashboardStats').classList.add('active');
}

function fecharDashboardStats() {
  document.getElementById('modalDashboardStats').classList.remove('active');
}

function toggleConvidarExterno(chk) {
  const campo = document.getElementById('campoConvidarExterno');
  if (campo) campo.style.display = chk.checked ? 'block' : 'none';
}

init();
