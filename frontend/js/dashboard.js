const API = 'https://agendare-backend-production.up.railway.app/api';
const FRONTEND_URL = 'https://agendare-frontend-production.up.railway.app';

let usuario = null, token = null;
let pollingInterval = null, ultimaNotifId = 0;
let dataSelecionada = new Date().toISOString().split('T')[0];
let calAtual = new Date();
let profissionais = [], servicos = [];
let tipoParticipante = 'interno';
let visualizacaoAtual = 'proximos';

// Scheduler state
let schedulerData = [];
let schedulerView = 'dia'; // 'dia' | 'semana'
let schedulerDate = new Date();

const DIAS = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const DIAS_COMPLETO = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function corProf(prof) { return prof?.cor_agenda || prof?.cor || '#0d9488'; }

// ── Aplica tema da empresa (cor + imagem de fundo) ────────
function aplicarTemaEmpresa(u) {
  const cor = u.cor_primaria || '#0d9488';
  document.documentElement.style.setProperty('--accent', cor);
  document.documentElement.style.setProperty('--accent-hover', cor + 'cc');
  try {
    const r = parseInt(cor.slice(1,3),16)||13;
    const g = parseInt(cor.slice(3,5),16)||148;
    const b = parseInt(cor.slice(5,7),16)||136;
    document.documentElement.style.setProperty('--accent-soft',   `rgba(${r},${g},${b},0.10)`);
    document.documentElement.style.setProperty('--accent-border', `rgba(${r},${g},${b},0.28)`);
  } catch(e) {}

  // Remove overlay anterior
  const ant = document.getElementById('_fundoOverlay');
  if (ant) ant.remove();

  // Aplica imagem de fundo como marca d'água fixa
  if (u.imagem_fundo_url) {
    const opacidade = ((u.imagem_fundo_opacidade ?? 12)) / 100;
    const overlay = document.createElement('div');
    overlay.id = '_fundoOverlay';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:0', 'pointer-events:none',
      `background-image:url('${u.imagem_fundo_url}')`,
      'background-size:cover', 'background-position:center', 'background-attachment:fixed',
      `opacity:${opacidade}`
    ].join(';');
    document.body.prepend(overlay);
  }
}

function init() {
  token   = localStorage.getItem('token');
  usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
  if (!token || !usuario) { window.location.href = 'login.html'; return; }
  usuario.id = parseInt(usuario.id);

  // Aplica tema da empresa imediatamente ao carregar
  aplicarTemaEmpresa(usuario);
  document.getElementById('badgePerfil').textContent =
    usuario.perfil === 'superadmin' ? '⚡ Super Admin' :
    usuario.perfil === 'admin'      ? '👑 Admin'       : '🔍 Analista';

  if (usuario.perfil === 'superadmin') {
    window.location.href = 'superadmin.html';
    return;
  }

  if (usuario.perfil === 'admin') document.getElementById('sidebarAdmin').style.display = 'block';

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
function mudarVisualizacao(vis) {
  visualizacaoAtual = vis;
  ['proximos','dia','semana','mes'].forEach(v => {
    const btn = document.getElementById(`btnVis${v.charAt(0).toUpperCase()+v.slice(1)}`);
    if (btn) btn.classList.toggle('ativo', v === vis);
  });

  const ehKanban = vis === 'proximos';
  const ehMes    = vis === 'mes';
  document.getElementById('painelProximos').style.display   = ehKanban ? 'block' : 'none';
  document.getElementById('painelCalendario').style.display = ehKanban ? 'none'  : 'block';

  if (!ehKanban) {
    schedulerView = ehMes ? 'mes' : (vis === 'semana' ? 'semana' : 'dia');
    schedulerDate = new Date(dataSelecionada + 'T12:00:00');
    renderScheduler();
  }
  carregarPainelAgenda();
}

async function carregarPainelAgenda() {
  await carregarStatsAgenda();
  await renderMiniCalendarioComBolinhas();
  if (visualizacaoAtual === 'proximos') await carregarKanbanProximos();
  else await carregarSchedulerDados();
}

// ══════════════════════════════════════════════════════════
// ── SCHEDULER CUSTOMIZADO (sem dependência externa) ───────
// ══════════════════════════════════════════════════════════

const SCHED_HORA_INI = 6;   // 06:00
const SCHED_HORA_FIM = 24;  // 24:00
const SCHED_SLOT_MIN = 30;  // altura de cada slot em px

function schedulerGetRange() {
  if (schedulerView === 'semana') {
    const d = new Date(schedulerDate);
    const ds = d.getDay();
    const ini = new Date(d); ini.setDate(d.getDate() - ds);
    const fim = new Date(d); fim.setDate(d.getDate() + (6 - ds));
    ini.setHours(0,0,0,0); fim.setHours(23,59,59,999);
    return { ini, fim };
  }
  if (schedulerView === 'mes') {
    const ano = schedulerDate.getFullYear(), mes = schedulerDate.getMonth();
    const ini = new Date(ano, mes, 1, 0, 0, 0);
    const fim = new Date(ano, mes+1, 0, 23, 59, 59);
    return { ini, fim };
  }
  // dia
  const d = new Date(schedulerDate);
  d.setHours(0,0,0,0);
  const f = new Date(schedulerDate);
  f.setHours(23,59,59,999);
  return { ini: d, fim: f };
}

async function carregarSchedulerDados() {
  const { ini, fim } = schedulerGetRange();
  const isoIni = ini.toISOString().split('T')[0] + 'T00:00:00';
  const isoFim = fim.toISOString().split('T')[0] + 'T23:59:59';
  const profId = document.getElementById('filtroProfissional')?.value || '';
  let url = `${API}/agendamentos?inicio=${isoIni}&fim=${isoFim}`;
  if (profId) url += `&profissional_id=${profId}`;
  try {
    const r = await fetch(url, { headers:{ Authorization:`Bearer ${token}` } });
    if (r.status === 401) { sair(); return; }
    schedulerData = await r.json();
    renderScheduler();
  } catch(e) { console.error(e); }
}

function renderScheduler() {
  const el = document.getElementById('painelCalendario');
  if (!el) return;
  if (schedulerView === 'mes') {
    renderSchedulerMes(el);
  } else {
    renderSchedulerGrade(el);
  }
}

// ── Scheduler Grade (Dia / Semana) ────────────────────────
function renderSchedulerGrade(container) {
  const isDia    = schedulerView === 'dia';
  const ehSemana = schedulerView === 'semana';

  // Monta lista de dias a exibir
  let dias = [];
  if (isDia) {
    dias = [new Date(schedulerDate)];
    dias[0].setHours(12,0,0,0);
  } else {
    const d  = new Date(schedulerDate);
    const ds = d.getDay();
    for (let i = 0; i < 7; i++) {
      const x = new Date(d);
      x.setDate(d.getDate() - ds + i);
      x.setHours(12,0,0,0);
      dias.push(x);
    }
  }

  // Monta label do título
  let titulo = '';
  if (isDia) {
    titulo = schedulerDate.toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
    titulo = titulo.charAt(0).toUpperCase() + titulo.slice(1);
  } else {
    const ini = dias[0].toLocaleDateString('pt-BR', { day:'2-digit', month:'short' });
    const fim = dias[6].toLocaleDateString('pt-BR', { day:'2-digit', month:'short' });
    titulo = `Semana: ${ini} – ${fim}`;
  }
  document.getElementById('tituloAgendaPagina').innerHTML = `Agenda <span>${isDia ? 'do Dia' : 'da Semana'}</span>`;
  document.getElementById('subtituloAgenda').textContent = titulo;

  // Horas a exibir
  const totalHoras = SCHED_HORA_FIM - SCHED_HORA_INI;
  const totalSlots = totalHoras * 2; // 30min cada
  const totalAltura = totalSlots * SCHED_SLOT_MIN;

  // Cabeçalho de dias (para semana)
  const hoje = new Date().toLocaleDateString('en-CA');

  let headerCols = '';
  dias.forEach(d => {
    const ds = d.toLocaleDateString('en-CA');
    const ehHoje = ds === hoje;
    const label = isDia ? '' : `<div class="sch-col-header ${ehHoje ? 'sch-hoje' : ''}" onclick="selecionarDiaScheduler('${ds}')">
      <span class="sch-col-dianum ${ehHoje ? 'sch-hoje-num' : ''}">${d.getDate()}</span>
      <span class="sch-col-diasem">${DIAS[d.getDay()]}</span>
    </div>`;
    headerCols += label;
  });

  // Grade de linhas de horário
  let linhasHora = '';
  for (let h = SCHED_HORA_INI; h < SCHED_HORA_FIM; h++) {
    const top1 = (h - SCHED_HORA_INI) * 2 * SCHED_SLOT_MIN;
    const top2 = top1 + SCHED_SLOT_MIN;
    linhasHora += `
      <div class="sch-linha-hora" style="top:${top1}px">
        <span class="sch-hora-label">${String(h).padStart(2,'0')}:00</span>
      </div>
      <div class="sch-linha-meio" style="top:${top2}px"></div>`;
  }

  // Indicador de agora
  const agora = new Date();
  let indicadorAgora = '';
  const hAgora = agora.getHours() + agora.getMinutes() / 60;
  if (hAgora >= SCHED_HORA_INI && hAgora < SCHED_HORA_FIM) {
    const topAgora = (hAgora - SCHED_HORA_INI) * 2 * SCHED_SLOT_MIN;
    indicadorAgora = `<div class="sch-agora" style="top:${topAgora}px"></div>`;
  }

  // Eventos por dia
  let colsDias = '';
  dias.forEach(d => {
    const ds = d.toLocaleDateString('en-CA');
    const ehHoje = ds === hoje;
    const evsDia = schedulerData.filter(a => {
      const dd = new Date(a.data_inicio).toLocaleDateString('en-CA', { timeZone:'America/Sao_Paulo' });
      return dd === ds;
    });

    // Detecta sobreposições e atribui colunas
    const grupos = resolverSobreposicoes(evsDia);

    const eventosHtml = grupos.map(({ ag, col, totalCols }) => {
      const ini = new Date(ag.data_inicio);
      const fim = ag.data_fim ? new Date(ag.data_fim) : new Date(ini.getTime() + 30*60000);
      const hIni = ini.getHours() + ini.getMinutes() / 60;
      const hFim = fim.getHours() + fim.getMinutes() / 60;
      const topPx     = Math.max(0, (hIni - SCHED_HORA_INI) * 2 * SCHED_SLOT_MIN);
      const alturaPx  = Math.max(SCHED_SLOT_MIN, (hFim - hIni) * 2 * SCHED_SLOT_MIN - 2);
      const prof      = profissionais.find(p => p.id === ag.profissional_id);
      const cor       = corProf(prof);
      const atrasado  = !['concluido','cancelado'].includes(ag.status) && fim < agora;
      const ehPeriodo = !!ag.data_fim_periodo || !!ag.evento_pessoal;
      const corFundo  = atrasado ? '#fef2f2' : ehPeriodo ? 'rgba(245,158,11,0.13)' : hexToRgba(cor, 0.12);
      const corBorda  = atrasado ? '#ef4444' : ehPeriodo ? '#f59e0b' : cor;
      const largPct   = (100 / totalCols);
      const leftPct   = col * largPct;
      const podeEditar = usuario.perfil === 'admin' || ag.profissional_id === usuario.id;

      const horaIniStr = ini.toLocaleTimeString('pt-BR', { timeZone:'America/Sao_Paulo', hour:'2-digit', minute:'2-digit' });
      const horaFimStr = fim.toLocaleTimeString('pt-BR', { timeZone:'America/Sao_Paulo', hour:'2-digit', minute:'2-digit' });
      const statusEmoji = { confirmado:'✅', pendente:'⏳', cancelado:'🚫', concluido:'🏁', faltou:'❌' };

      return `<div class="sch-evento"
        style="top:${topPx}px;height:${alturaPx}px;left:${leftPct}%;width:calc(${largPct}% - 4px);
               background:${corFundo};border-left:3px solid ${corBorda};color:${corBorda}"
        title="${ag.cliente_nome} | ${horaIniStr}–${horaFimStr} | ${ag.profissional_nome||'—'}"
        onclick="${podeEditar ? `abrirVerAgendamentoKanban(${ag.id})` : ''}">
        <div class="sch-ev-hora">${horaIniStr}${alturaPx > 45 ? `–${horaFimStr}` : ''}</div>
        <div class="sch-ev-titulo">${ag.cliente_nome}${atrasado ? ' ⚠️' : ''}</div>
        ${alturaPx > 55 ? `<div class="sch-ev-prof">${statusEmoji[ag.status]||''} ${ag.profissional_nome||'—'}</div>` : ''}
      </div>`;
    }).join('');

    // Slots clicáveis para novo agendamento
    let slotsHtml = '';
    for (let s = 0; s < totalSlots; s++) {
      const h  = SCHED_HORA_INI + Math.floor(s / 2);
      const m  = s % 2 === 0 ? '00' : '30';
      slotsHtml += `<div class="sch-slot" style="top:${s*SCHED_SLOT_MIN}px;height:${SCHED_SLOT_MIN}px"
        onclick="novoAgendamentoScheduler('${ds}','${String(h).padStart(2,'0')}:${m}')"></div>`;
    }

    colsDias += `<div class="sch-col-dia ${ehHoje ? 'sch-col-hoje' : ''}" style="position:relative;height:${totalAltura}px">
      ${indicadorAgora}
      ${slotsHtml}
      ${eventosHtml}
    </div>`;
  });

  // Monta HTML do scheduler
  const larguraLabel = 52;
  container.innerHTML = `
    <div class="sch-toolbar">
      <div style="display:flex;gap:0.5rem;align-items:center">
        <button class="btn btn-secondary btn-sm" onclick="schedulerNavegar(-1)">‹ Anterior</button>
        <button class="btn btn-secondary btn-sm" onclick="schedulerHoje()">Hoje</button>
        <button class="btn btn-secondary btn-sm" onclick="schedulerNavegar(1)">Próximo ›</button>
        <span class="sch-toolbar-titulo">${titulo}</span>
      </div>
      <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">
        <label style="font-size:0.82rem;font-weight:600;color:var(--muted)">Profissional</label>
        <select id="filtroProfissional" onchange="carregarSchedulerDados()" style="min-width:180px">
          <option value="">Todos</option>
          ${profissionais.map(p => `<option value="${p.id}">${p.nome}</option>`).join('')}
        </select>
        <button class="btn btn-primary btn-sm" onclick="abrirNovoAgendamento()">+ Novo</button>
      </div>
    </div>

    <div class="sch-wrapper">
      <!-- Coluna de horas -->
      <div class="sch-coluna-horas" style="width:${larguraLabel}px">
        <div class="sch-hora-spacer"></div>
        <div style="position:relative;height:${totalAltura}px">
          ${linhasHora}
        </div>
      </div>

      <!-- Grade de dias -->
      <div class="sch-grade" style="flex:1;overflow-x:auto">
        ${ehSemana ? `<div class="sch-header-dias" style="display:grid;grid-template-columns:repeat(7,1fr)">
          ${headerCols}
        </div>` : ''}
        <div class="sch-dias-container" style="display:grid;grid-template-columns:repeat(${dias.length},1fr);position:relative">
          <!-- Linhas de fundo -->
          <div class="sch-fundo-linhas" style="position:absolute;inset:0;pointer-events:none">
            ${Array.from({length: totalSlots}, (_,s) =>
              `<div style="position:absolute;left:0;right:0;top:${s*SCHED_SLOT_MIN}px;height:1px;background:${s%2===0?'var(--border)':'rgba(0,0,0,0.04)'}"></div>`
            ).join('')}
          </div>
          ${colsDias}
        </div>
      </div>
    </div>`;
}

// ── Scheduler Mês ─────────────────────────────────────────
function renderSchedulerMes(container) {
  const ano = schedulerDate.getFullYear();
  const mes = schedulerDate.getMonth();
  const primeiroDia = new Date(ano, mes, 1).getDay();
  const ultimoDia   = new Date(ano, mes+1, 0).getDate();
  const hoje = new Date().toLocaleDateString('en-CA');

  document.getElementById('tituloAgendaPagina').innerHTML = `Agenda <span>do Mês</span>`;
  document.getElementById('subtituloAgenda').textContent = `${MESES[mes]} ${ano}`;

  const titulo = `${MESES[mes]} ${ano}`;

  // ── Pré-processa eventos de período para a barra contínua ──────────────
  // Normaliza data de um agendamento para string YYYY-MM-DD no fuso SP
  const toDS = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone:'America/Sao_Paulo' });

  // Eventos com período multidia (data_fim_periodo é string YYYY-MM-DD pura)
  const eventosPeriodo = schedulerData.filter(a => a.data_fim_periodo);

  // Monta mapa: ds -> lista de barras de período que cruzam esse dia
  // Cada entrada: { ag, isInicio, isFim, isIntermedio }
  const barrasPorDia = {};
  eventosPeriodo.forEach(a => {
    const dsIni = toDS(a.data_inicio);
    const dsFim = a.data_fim_periodo; // já é YYYY-MM-DD puro
    // Gera todos os dias do período dentro deste mês
    let cur = new Date(dsIni + 'T12:00:00');
    const endDate = new Date(dsFim + 'T12:00:00');
    while (cur <= endDate) {
      const ds = cur.toLocaleDateString('en-CA');
      if (!barrasPorDia[ds]) barrasPorDia[ds] = [];
      barrasPorDia[ds].push({
        ag,
        isInicio: ds === dsIni,
        isFim:    ds === dsFim,
      });
      cur.setDate(cur.getDate() + 1);
    }
  });

  // ── Monta células ──────────────────────────────────────────────────────
  let celulas = DIAS.map(d => `<div class="sch-mes-cabecalho">${d}</div>`).join('');
  for (let i = 0; i < primeiroDia; i++) celulas += `<div class="sch-mes-celula sch-mes-fora"></div>`;

  const agora = new Date();

  for (let d = 1; d <= ultimoDia; d++) {
    const ds = `${ano}-${String(mes+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const ehHoje = ds === hoje;
    const ehSel  = ds === dataSelecionada;
    const diaDaSemana = new Date(ds + 'T12:00:00').getDay(); // 0=dom

    // Eventos normais do dia (excluindo os de período, que viram barra)
    const evsDia = schedulerData.filter(a => {
      if (a.data_fim_periodo) return false; // período vira barra separada
      const dd = toDS(a.data_inicio);
      return dd === ds;
    });

    // Barras de período que passam por este dia
    const barrasHoje = barrasPorDia[ds] || [];
    const barrasHtml = barrasHoje.map(({ ag, isInicio, isFim }) => {
      const prof = profissionais.find(p => p.id === ag.profissional_id);
      const cor  = corProf(prof);
      // Bordas arredondadas só nas pontas
      const borderRadius = isInicio && isFim ? '6px' : isInicio ? '6px 0 0 6px' : isFim ? '0 6px 6px 0' : '0';
      // Margem negativa para a barra sangrar até a borda da célula
      const marginLeft  = isInicio ? '2px' : '-1px';
      const marginRight = isFim    ? '2px' : '-1px';
      const label = isInicio ? `<span style="font-size:0.72rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-left:6px">${ag.cliente_nome}</span>` : '';
      return `<div class="sch-periodo-barra"
        style="background:${cor};border-radius:${borderRadius};margin-left:${marginLeft};margin-right:${marginRight};color:#fff;"
        onclick="event.stopPropagation();abrirVerAgendamentoKanban(${ag.id})"
        title="${ag.cliente_nome}">
        ${label}
      </div>`;
    }).join('');

    // Eventos normais
    const maxVisiveis = 3 - barrasHoje.length;
    const eventosHtml = evsDia.slice(0, Math.max(0, maxVisiveis)).map(a => {
      const prof = profissionais.find(p => p.id === a.profissional_id);
      const cor  = corProf(prof);
      const atrasado = !['concluido','cancelado'].includes(a.status) && new Date(a.data_fim||a.data_inicio) < agora;
      const corUs = atrasado ? '#ef4444' : cor;
      const hora  = a.dia_todo ? 'Dia todo' : new Date(a.data_inicio).toLocaleTimeString('pt-BR', { timeZone:'America/Sao_Paulo', hour:'2-digit', minute:'2-digit' });
      return `<div class="sch-mes-ev" style="background:${hexToRgba(corUs,0.15)};border-left:2px solid ${corUs};color:${corUs}"
        onclick="event.stopPropagation();abrirVerAgendamentoKanban(${a.id})"
        title="${a.cliente_nome} | ${hora}">
        <span class="sch-mes-ev-hora">${hora}</span> ${a.cliente_nome}
      </div>`;
    }).join('');

    const totalVisiveis = barrasHoje.length + Math.min(evsDia.length, Math.max(0, maxVisiveis));
    const totalEventos  = barrasHoje.length + evsDia.length;
    const extra = totalEventos > 3
      ? `<div class="sch-mes-mais" onclick="event.stopPropagation();schedulerVerDia('${ds}')">+${totalEventos - 3} mais</div>`
      : '';

    const ehDiaDePeriodo = barrasHoje.length > 0;

    celulas += `<div class="sch-mes-celula ${ehHoje ? 'sch-mes-hoje' : ''} ${ehSel ? 'sch-mes-selecionado' : ''}"
      onclick="schedulerVerDia('${ds}')">
      <div class="sch-mes-num">${d}</div>
      ${barrasHtml}
      ${eventosHtml}${extra}
    </div>`;
  }

  container.innerHTML = `
    <div class="sch-toolbar">
      <div style="display:flex;gap:0.5rem;align-items:center">
        <button class="btn btn-secondary btn-sm" onclick="schedulerNavegar(-1)">‹ Anterior</button>
        <button class="btn btn-secondary btn-sm" onclick="schedulerHoje()">Hoje</button>
        <button class="btn btn-secondary btn-sm" onclick="schedulerNavegar(1)">Próximo ›</button>
        <span class="sch-toolbar-titulo">${titulo}</span>
      </div>
      <div style="display:flex;gap:0.5rem;align-items:center">
        <label style="font-size:0.82rem;font-weight:600;color:var(--muted)">Profissional</label>
        <select id="filtroProfissional" onchange="carregarSchedulerDados()" style="min-width:180px">
          <option value="">Todos</option>
          ${profissionais.map(p => `<option value="${p.id}">${p.nome}</option>`).join('')}
        </select>
        <button class="btn btn-primary btn-sm" onclick="abrirNovoAgendamento()">+ Novo</button>
      </div>
    </div>
    <div class="sch-mes-grid">${celulas}</div>`;
}

// ── Helpers do Scheduler ──────────────────────────────────
function hexToRgba(hex, alpha) {
  try {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${alpha})`;
  } catch { return `rgba(13,148,136,${alpha})`; }
}

function resolverSobreposicoes(ags) {
  const sorted = [...ags].filter(a => !a.dia_todo).sort((a,b) => new Date(a.data_inicio) - new Date(b.data_inicio));
  const resultado = [];
  const grupos = [];

  sorted.forEach(ag => {
    const ini = new Date(ag.data_inicio).getTime();
    const fim = ag.data_fim ? new Date(ag.data_fim).getTime() : ini + 30*60000;
    let colocado = false;
    for (const grupo of grupos) {
      if (ini >= grupo.fim) {
        grupo.fim = fim;
        grupo.eventos.push(ag);
        colocado = true;
        break;
      }
    }
    if (!colocado) grupos.push({ fim, eventos: [ag] });
  });

  grupos.forEach(grupo => {
    const total = grupo.eventos.length;
    grupo.eventos.forEach((ag, i) => resultado.push({ ag, col: i, totalCols: total }));
  });

  // Dia todo no topo (sem sobreposição)
  ags.filter(a => a.dia_todo).forEach(ag => resultado.push({ ag, col: 0, totalCols: 1 }));

  return resultado;
}

function schedulerNavegar(dir) {
  if (schedulerView === 'dia') {
    schedulerDate.setDate(schedulerDate.getDate() + dir);
  } else if (schedulerView === 'semana') {
    schedulerDate.setDate(schedulerDate.getDate() + dir * 7);
  } else {
    schedulerDate.setMonth(schedulerDate.getMonth() + dir);
  }
  dataSelecionada = schedulerDate.toLocaleDateString('en-CA');
  carregarSchedulerDados();
  renderMiniCalendarioComBolinhas();
}

function schedulerHoje() {
  schedulerDate = new Date();
  dataSelecionada = schedulerDate.toLocaleDateString('en-CA');
  carregarSchedulerDados();
  renderMiniCalendarioComBolinhas();
}

function selecionarDiaScheduler(ds) {
  dataSelecionada = ds;
  schedulerDate   = new Date(ds + 'T12:00:00');
  schedulerView   = 'dia';
  visualizacaoAtual = 'dia';
  ['proximos','dia','semana','mes'].forEach(v => {
    const btn = document.getElementById(`btnVis${v.charAt(0).toUpperCase()+v.slice(1)}`);
    if (btn) btn.classList.toggle('ativo', v === 'dia');
  });
  carregarSchedulerDados();
  renderMiniCalendarioComBolinhas();
}

function schedulerVerDia(ds) {
  selecionarDiaScheduler(ds);
}

function novoAgendamentoScheduler(ds, hora) {
  dataSelecionada = ds;
  abrirNovoAgendamento();
  setTimeout(() => {
    const hf = document.getElementById('agHoraInicio');
    if (hf) hf.value = hora;
    const hfim = document.getElementById('agHoraFim');
    if (hfim) {
      const [h,m] = hora.split(':').map(Number);
      const fimMin = m + 30 >= 60 ? `${String(h+1).padStart(2,'0')}:00` : `${String(h).padStart(2,'0')}:30`;
      hfim.value = fimMin;
    }
  }, 50);
}

// ══════════════════════════════════════════════════════════
// ── Stats ─────────────────────────────────────────────────
async function carregarStatsAgenda() {
  try {
    const hoje = new Date().toISOString().split('T')[0];
    const r = await fetch(`${API}/agendamentos?inicio=${hoje}T00:00:00&fim=${hoje}T23:59:59`, { headers:{ Authorization:`Bearer ${token}` } });
    if (!r.ok) return;
    const ags = await r.json();
    const agora = new Date();
    let atrasados = 0;
    try {
      const rAll = await fetch(`${API}/agendamentos?inicio=2020-01-01T00:00:00&fim=${hoje}T23:59:59`, { headers:{ Authorization:`Bearer ${token}` } });
      if (rAll.ok) {
        const all = await rAll.json();
        atrasados = all.filter(a => !['concluido','cancelado'].includes(a.status) && new Date(a.data_fim || a.data_inicio) < agora).length;
      }
    } catch {}
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

// ── Mini Calendário com Bolinhas ──────────────────────────
async function renderMiniCalendarioComBolinhas() {
  const elMes = document.getElementById('calMes');
  const elGrid = document.getElementById('calendarioGrid');
  if (!elMes || !elGrid) return;

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

  elMes.textContent = `${MESES[mes]} ${ano}`;
  let html = DIAS.map(d => `<div class="cal-header">${d}</div>`).join('');
  html += Array(primeiroDia).fill('<div></div>').join('');

  for (let d = 1; d <= ultimoDia; d++) {
    const ds = `${ano}-${String(mes+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const cores = diaParaCores[ds] ? [...diaParaCores[ds]].slice(0,3) : [];
    const bolinhas = cores.map(c => `<span class="cal-dot" style="background:${c}"></span>`).join('');
    html += `<div class="cal-dia ${ds===dataSelecionada?'selecionado':''} ${ds===hoje?'hoje':''}" onclick="selecionarDia('${ds}')">
      <span class="num">${d}</span>${bolinhas ? `<div class="cal-dots">${bolinhas}</div>` : ''}
    </div>`;
  }
  elGrid.innerHTML = html;
}

function renderMiniCalendario() { renderMiniCalendarioComBolinhas(); }
function navegarMes(dir) { calAtual.setMonth(calAtual.getMonth()+dir); renderMiniCalendarioComBolinhas(); }
function selecionarDia(data) {
  dataSelecionada = data;
  schedulerDate   = new Date(data + 'T12:00:00');
  if (visualizacaoAtual !== 'dia') mudarVisualizacao('dia');
  else { renderMiniCalendarioComBolinhas(); carregarSchedulerDados(); }
}

// ── Kanban: Próximos ──────────────────────────────────────
async function carregarKanbanProximos() {
  const agora = new Date().toISOString().split('T')[0];
  const fimFuturo = `${new Date().getFullYear()+2}-12-31T23:59:59`;
  const subtitulo = document.getElementById('subtituloAgenda');
  if (subtitulo) subtitulo.textContent = 'Próximos compromissos — todos os colaboradores';
  const container = document.getElementById('kanbanProximos');
  if (container) container.innerHTML = '<p style="color:var(--muted);padding:1rem">Carregando...</p>';
  try {
    if (!profissionais.length) await carregarProfissionaisFiltro();
    const r = await fetch(`${API}/agendamentos?inicio=${agora}T00:00:00&fim=${fimFuturo}`, { headers:{ Authorization:`Bearer ${token}` } });
    if (r.status === 401) { sair(); return; }
    const ags = await r.json();
    if (!Array.isArray(ags) || !ags.length) {
      if (container) container.innerHTML = '<p style="color:var(--muted);padding:1.5rem;text-align:center">Nenhum compromisso futuro agendado 🎉</p>';
      return;
    }
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
  // Resetar campos de período/evento pessoal
  const _dataFim=document.getElementById('agDataFim');
  if(_dataFim) _dataFim.value='';
  const _chkPess=document.getElementById('chkEventoPessoal');
  if(_chkPess){ _chkPess.checked=false; }
  const _campoPess=document.getElementById('campoEventoPessoal');
  if(_campoPess) _campoPess.style.display='none';
  const _tipoEv=document.getElementById('agTipoEventoPessoal');
  if(_tipoEv) _tipoEv.value='';
  // Resetar toggle visual do "Dia Todo"
  const _track=document.getElementById('toggleDiaTodoTrack');
  const _thumb=document.getElementById('toggleDiaTodoThumb');
  if(_track) _track.style.background='#d1d5db';
  if(_thumb) _thumb.style.transform='translateX(0)';
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

  // Campos novos: data fim de período, evento pessoal, tipo
  const dataFimInput   = document.getElementById('agDataFim')?.value || null;
  const eventoPessoal  = document.getElementById('chkEventoPessoal')?.checked || false;
  const tipoEvento     = document.getElementById('agTipoEventoPessoal')?.value || null;

  if(!titulo){erro.textContent='Informe o título';erro.style.display='block';return;}
  if(!data){erro.textContent='Informe a data';erro.style.display='block';return;}
  if(dataFimInput && dataFimInput < data){erro.textContent='A data fim não pode ser anterior à data início';erro.style.display='block';return;}
  if(!diaTodo&&!horaIni){erro.textContent='Informe o horário de início';erro.style.display='block';return;}
  if(!diaTodo&&!horaFim){erro.textContent='Informe o horário de fim';erro.style.display='block';return;}
  erro.style.display='none';
  document.getElementById('btnAgendar').style.display='none';
  document.getElementById('spinnerAgendar').style.display='inline-block';
  try {
    // Usa offset real do browser para evitar bug de "dia anterior"
    const tzOffset = -new Date().getTimezoneOffset();
    const tzSign   = tzOffset >= 0 ? '+' : '-';
    const tzHH     = String(Math.floor(Math.abs(tzOffset)/60)).padStart(2,'0');
    const tzMM     = String(Math.abs(tzOffset)%60).padStart(2,'0');
    const tz       = `${tzSign}${tzHH}:${tzMM}`;

    const data_inicio = diaTodo ? `${data}T00:00:00${tz}` : `${data}T${horaIni}:00${tz}`;
    // Se tem dataFim de período: usa ela como data_fim, senão comportamento original
    const dataFimReal = dataFimInput || data;
    const data_fim    = diaTodo ? `${dataFimReal}T23:59:59${tz}` : `${data}T${horaFim}:00${tz}`;

    const emailConvidado = document.getElementById('chkConvidarExterno')?.checked
      ? (document.getElementById('emailConvidado')?.value?.trim() || null) : null;

    const payload = {
      empresa_id:usuario.empresa_id,
      profissional_id:usuario.id,
      cliente_nome:titulo,
      data_inicio,
      data_fim,
      dia_todo:diaTodo,
      observacoes:obs||null,
      email_convidado:emailConvidado,
      // Campos de período pessoal
      evento_pessoal: eventoPessoal || null,
      tipo_evento: tipoEvento || null,
      data_fim_periodo: (dataFimInput && dataFimInput !== data) ? dataFimInput : null
    };

    const r=await fetch(`${API}/agendamentos`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
      body:JSON.stringify(payload)});
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
    if(linkEl) linkEl.value=`${FRONTEND_URL}/agendar.html?empresa=${emp.slug}`;
  }catch(err){console.error(err);}
}
function copiarLink(){const link=document.getElementById('linkPublico');if(!link)return;navigator.clipboard.writeText(link.value).then(()=>{const conf=document.getElementById('linkCopiado');if(conf){conf.style.display='block';setTimeout(()=>conf.style.display='none',2500);}mostrarToast('🔗 Link copiado!','Compartilhe com seus clientes.');});}

// ── Perfil ────────────────────────────────────────────────
function abrirPerfil(){
  const u=usuario;
  document.getElementById('perfilInfo').innerHTML=`
    <div><strong>Nome:</strong> ${u.nome}</div>
    <div><strong>E-mail:</strong> ${u.email}</div>
    <div><strong>Perfil:</strong> ${u.perfil==='admin'?'👑 Administrador':'🔍 Analista'}</div>`;
  document.getElementById('novaSenhaP').value='';document.getElementById('confirmarSenhaP').value='';
  document.getElementById('erroPerfil').style.display='none';document.getElementById('sucessoPerfil').style.display='none';
  document.getElementById('modalPerfil').classList.add('active');
}
function fecharPerfil(){document.getElementById('modalPerfil').classList.remove('active');}
async function trocarSenha(){
  const nova=document.getElementById('novaSenhaP').value,confirmar=document.getElementById('confirmarSenhaP').value;
  const erro=document.getElementById('erroPerfil'),suc=document.getElementById('sucessoPerfil');
  erro.style.display='none';suc.style.display='none';
  if(!nova){erro.textContent='Informe a nova senha';erro.style.display='block';return;}
  if(nova!==confirmar){erro.textContent='As senhas não coincidem';erro.style.display='block';return;}
  if(nova.length<6){erro.textContent='Mínimo 6 caracteres';erro.style.display='block';return;}
  try{const r=await fetch(`${API}/profissionais/${usuario.id}`,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({senha:nova})});
    if(!r.ok){const d=await r.json();erro.textContent=d.erro||'Erro ao salvar';erro.style.display='block';return;}
    suc.textContent='✅ Senha alterada com sucesso!';suc.style.display='block';
    document.getElementById('novaSenhaP').value='';document.getElementById('confirmarSenhaP').value='';
  }catch{erro.textContent='Erro de conexão';erro.style.display='block';}
}

// ── Toast ─────────────────────────────────────────────────
function mostrarToast(titulo, msg) {
  const c = document.getElementById('toastContainer');
  if (!c) return;
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<strong>${titulo}</strong>${msg ? `<div style="font-size:0.82rem;margin-top:2px;opacity:0.85">${msg}</div>` : ''}`;
  c.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3500);
}

// ── Notificações ──────────────────────────────────────────
function iniciarPolling(){pollingInterval=setInterval(verificarNovasNotifs,30000);}
async function verificarNovasNotifs(){
  try{const hoje=new Date().toISOString().split('T')[0];
    const r=await fetch(`${API}/agendamentos?inicio=${hoje}T00:00:00&fim=${hoje}T23:59:59`,{headers:{Authorization:`Bearer ${token}`}});
    if(!r.ok)return;const ags=await r.json();
    const novos=ags.filter(a=>a.id>ultimaNotifId&&a.status==='confirmado');
    if(novos.length&&ultimaNotifId>0)novos.forEach(a=>mostrarToast('🔔 Novo agendamento!',`${a.cliente_nome} — ${new Date(a.data_inicio).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`));
    if(ags.length)ultimaNotifId=Math.max(...ags.map(a=>a.id));
  }catch{}
}
function togglePainelNotificacoes(){const p=document.getElementById('painelNotificacoes');if(!p)return;const ativo=p.classList.toggle('active');if(ativo)carregarPainelAtrasados();}
function fecharPainelNotificacoes(){document.getElementById('painelNotificacoes')?.classList.remove('active');}
async function carregarPainelAtrasados(){
  const el=document.getElementById('painelNotifBody');if(!el)return;el.innerHTML='<div class="notif-empty">Carregando...</div>';
  try{const hoje=new Date().toISOString().split('T')[0];const agora=new Date();
    const r=await fetch(`${API}/agendamentos?inicio=2020-01-01T00:00:00&fim=${hoje}T23:59:59`,{headers:{Authorization:`Bearer ${token}`}});
    const all=await r.json();const atrasados=all.filter(a=>!['concluido','cancelado'].includes(a.status)&&new Date(a.data_fim||a.data_inicio)<agora);
    if(!atrasados.length){el.innerHTML='<div class="notif-empty">Nenhum compromisso atrasado 🎉</div>';return;}
    el.innerHTML=atrasados.map(a=>{
      const dt=new Date(a.data_inicio).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
      return `<div class="notif-item" onclick="fecharPainelNotificacoes();abrirVerAgendamento(${a.id})">
        <div style="font-weight:600;font-size:0.85rem">${a.cliente_nome}</div>
        <div style="font-size:0.75rem;color:var(--muted)">${dt} · ${a.profissional_nome||'—'}</div>
        <span class="badge badge-faltou" style="font-size:0.68rem;margin-top:3px">${a.status}</span>
      </div>`;
    }).join('');
  }catch{el.innerHTML='<div class="notif-empty">Erro ao carregar.</div>';}
}

// ── Obs Status ────────────────────────────────────────────
let _statusPendente = null;
function pedirObsStatus(){
  const status=document.getElementById('editStatus').value;
  const labels={concluido:'🏁 Concluído',cancelado:'🚫 Cancelado',faltou:'❌ Faltou',confirmado:'✅ Confirmado'};
  _statusPendente=status;
  document.getElementById('tituloObsStatus').textContent=`Mudar para: ${labels[status]||status}`;
  document.getElementById('subtituloObsStatus').textContent='Adicione uma observação antes de salvar (opcional).';
  document.getElementById('obsStatusTexto').value='';
  document.getElementById('modalObsStatus').classList.add('active');
}
function fecharObsStatus(){document.getElementById('modalObsStatus').classList.remove('active');_statusPendente=null;}
async function confirmarAtualizarStatus(){
  const obs=document.getElementById('obsStatusTexto').value.trim();
  const id=document.getElementById('editAgId').value;
  const status=_statusPendente||document.getElementById('editStatus').value;
  try{
    const body={status};if(obs)body.observacoes=obs;
    const r=await fetch(`${API}/agendamentos/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
    if(!r.ok){const d=await r.json();mostrarToast('❌ Erro',d.erro||'Sem permissão');return;}
    fecharObsStatus();fecharModalVer();
    carregarPainelAgenda();
    if(document.getElementById('abaLista').style.display!=='none') carregarLista();
    mostrarToast('✅ Status atualizado!', `Compromisso marcado como ${status}.`);
  } catch(err) { console.error(err); }
}

// ── Notas ─────────────────────────────────────────────────
function abrirNotas(){
  const chave=`notas_${usuario.id}`;
  document.getElementById('notasTexto').value=localStorage.getItem(chave)||'';
  document.getElementById('modalNotas').classList.add('active');
}
function fecharNotas(){document.getElementById('modalNotas').classList.remove('active');}
function salvarNotas(){
  const chave=`notas_${usuario.id}`;
  localStorage.setItem(chave,document.getElementById('notasTexto').value);
  fecharNotas();mostrarToast('📝 Anotações salvas!','');
}

// ── Logoff / Sair ─────────────────────────────────────────
function logoff(){localStorage.removeItem('token');localStorage.removeItem('usuario');window.location.href='login.html';}
function sair(){localStorage.clear();window.location.href='login.html';}
function voltarInicio(){mudarAba('agenda');}

// ── Empresas (superadmin) ─────────────────────────────────
let todasEmpresas=[];
async function carregarEmpresas(){
  const tbody=document.getElementById('tabelaEmpresas');
  if(!tbody)return;
  tbody.innerHTML='<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--muted)">Carregando...</td></tr>';
  try{const r=await fetch(`${API}/empresas`,{headers:{Authorization:`Bearer ${token}`}});todasEmpresas=await r.json();renderEmpresas(todasEmpresas);}
  catch(err){tbody.innerHTML='<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--muted)">Erro ao carregar.</td></tr>';}
}
function filtrarEmpresasSA(){
  const q=document.getElementById('pesquisaEmpresas').value.toLowerCase();
  renderEmpresas(todasEmpresas.filter(e=>(e.nome_fantasia||e.nome||'').toLowerCase().includes(q)||e.cnpj?.includes(q)));
}
function renderEmpresas(lista){
  const tbody=document.getElementById('tabelaEmpresas');
  if(!lista.length){tbody.innerHTML='<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--muted)">Nenhuma empresa encontrada.</td></tr>';return;}
  const statusBadge={ativo:'badge-confirmado',suspenso:'badge-pendente',cancelado:'badge-cancelado'};
  tbody.innerHTML=lista.map(e=>{
    const cor=e.cor_primaria||'#0d9488';
    const nome=e.nome_fantasia||e.nome||'—';
    return `<tr>
      <td><strong>${nome}</strong></td>
      <td>${e.cnpj||'—'}</td>
      <td>${e.email||'—'}</td>
      <td><code style="font-size:0.78rem">${e.slug||'—'}</code></td>
      <td><span class="badge ${statusBadge[e.status]||''}">${e.status||'ativo'}</span></td>
      <td><div style="display:flex;gap:4px">
        <button class="btn btn-secondary btn-sm" onclick="verEmpresa(${e.id})">✏️</button>
        <button class="btn btn-secondary btn-sm" onclick="verUsuariosSA(${e.id},'${nome.replace(/'/g,"\\'")}')">👥</button>
      </div></td>
    </tr>`;
  }).join('');
}

// ── Preview helpers ───────────────────────────────────────
function _aplicarCorPreviewDash(cor, ids) {
  try {
    const r=parseInt(cor.slice(1,3),16), g=parseInt(cor.slice(3,5),16), b=parseInt(cor.slice(5,7),16);
    const soft=`rgba(${r},${g},${b},0.09)`, borda=`rgba(${r},${g},${b},0.28)`, soft2=`rgba(${r},${g},${b},0.18)`;
    const el=id=>document.getElementById(id);
    if(el(ids.topbar))  el(ids.topbar).style.background=cor;
    if(el(ids.sidebar)) { el(ids.sidebar).style.background=soft; el(ids.sidebar).style.borderRightColor=borda; }
    if(el(ids.item))    el(ids.item).style.background=cor;
    if(el(ids.accent))  el(ids.accent).style.color=cor;
    if(el(ids.chip))    { el(ids.chip).style.background=soft2; el(ids.chip).style.color=cor; }
    if(el(ids.prev))    { el(ids.prev).style.background=cor; el(ids.prev).style.boxShadow=`0 0 0 3px ${cor}44`; }
  } catch(e){}
}
function atualizarPreviewCor(cor) {
  _aplicarCorPreviewDash(cor, {topbar:'previewTopbar',sidebar:'previewSidebar',item:'previewSidebarItem',accent:'previewAccentText',chip:'previewStatCard',prev:'previewCor'});
}
function atualizarPreviewCorEdit(cor) {
  _aplicarCorPreviewDash(cor, {topbar:'editLpTopbar',sidebar:'editLpSidebar',item:'editLpItem',accent:'editLpAccent',chip:'editLpChip',prev:'previewCorEdit'});
}
function atualizarPreviewFundo(url) {
  const el=document.getElementById('previewFundoImg'); if(!el)return;
  const ok=url&&url.startsWith('http'); el.style.display=ok?'block':'none'; if(ok)el.style.backgroundImage=`url('${url}')`;
}
function atualizarPreviewFundoEdit(url) {
  const el=document.getElementById('editLpFundo'); if(!el)return;
  const ok=url&&url.startsWith('http'); el.style.display=ok?'block':'none'; if(ok)el.style.backgroundImage=`url('${url}')`;
}
function atualizarOpacidadePreview(val) {
  document.getElementById('empOpacidadeVal').textContent=val+'%';
  document.getElementById('empOpacidadeHidden').value=val;
  const el=document.getElementById('previewFundoImg'); if(el) el.style.opacity=val/100;
}

function abrirNovaEmpresa(){
  document.getElementById('empId').value='';
  document.getElementById('tituloModalEmpresa').textContent='🏢 Nova Empresa';
  document.getElementById('btnEmpresaText').textContent='Criar Empresa';
  ['empNome','empCnpj','empEmail','empTelefone','empSlug','empAdminNome','empAdminEmail','empAdminSenha'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('empCor').value='#0d9488';
  ['empFundoUrl','empVencimento'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const op=document.getElementById('empOpacidade'); if(op)op.value=12;
  const oh=document.getElementById('empOpacidadeHidden'); if(oh)oh.value=12;
  const ov=document.getElementById('empOpacidadeVal'); if(ov)ov.textContent='12%';
  document.getElementById('secaoAdmin').style.display='block';
  document.getElementById('erroEmpresa').style.display='none';
  document.getElementById('slugPreview').textContent='slug';
  atualizarPreviewCor('#0d9488');
  atualizarPreviewFundo('');
  document.getElementById('modalEmpresa').classList.add('active');
}
function fecharModalEmpresa(){document.getElementById('modalEmpresa').classList.remove('active');}

async function salvarEmpresa(){
  const id=document.getElementById('empId').value;
  const nome=document.getElementById('empNome').value.trim();
  const cnpj=document.getElementById('empCnpj').value.replace(/\D/g,'');
  const email=document.getElementById('empEmail').value.trim();
  const tel=document.getElementById('empTelefone').value.trim();
  const slug=document.getElementById('empSlug').value.trim();
  const cor=document.getElementById('empCor').value;
  const fundo=document.getElementById('empFundoUrl')?.value?.trim()||null;
  const op=parseInt(document.getElementById('empOpacidadeHidden')?.value||'12');
  const venc=document.getElementById('empVencimento')?.value||null;
  const erro=document.getElementById('erroEmpresa');
  if(!nome||!cnpj||!slug){erro.textContent='Nome, CNPJ e Slug são obrigatórios';erro.style.display='block';return;}
  document.getElementById('spinnerEmpresa').style.display='inline-block';erro.style.display='none';
  try{
    if(!id){
      const adminNome=document.getElementById('empAdminNome').value.trim();
      const adminEmail=document.getElementById('empAdminEmail').value.trim();
      const adminSenha=document.getElementById('empAdminSenha').value;
      if(!adminNome||!adminEmail||!adminSenha){erro.textContent='Dados do administrador são obrigatórios';erro.style.display='block';return;}
      const r=await fetch(`${API}/empresas`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
        body:JSON.stringify({nome_fantasia:nome,cnpj,email:email||null,telefone:tel||null,slug,cor_primaria:cor,
          imagem_fundo_url:fundo,imagem_fundo_opacidade:op,vencimento:venc,
          admin_nome:adminNome,admin_email:adminEmail,admin_senha:adminSenha})});
      const d=await r.json();if(!r.ok){erro.textContent=d.erro||'Erro ao criar';erro.style.display='block';return;}
    } else {
      const r=await fetch(`${API}/empresas/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
        body:JSON.stringify({nome_fantasia:nome,email:email||null,telefone:tel||null,slug,cor_primaria:cor,
          imagem_fundo_url:fundo,imagem_fundo_opacidade:op,vencimento:venc})});
      if(!r.ok){const d=await r.json();erro.textContent=d.erro||'Erro ao salvar';erro.style.display='block';return;}
    }
    fecharModalEmpresa();carregarEmpresas();mostrarToast('✅ Empresa salva!',nome);
  }catch{erro.textContent='Erro de conexão';erro.style.display='block';}
  finally{document.getElementById('spinnerEmpresa').style.display='none';}
}

async function verEmpresa(id){
  const e=todasEmpresas.find(x=>x.id===id);if(!e)return;
  const nome=e.nome_fantasia||e.nome||'—';
  document.getElementById('detalheEmpresa').innerHTML=`
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:0.85rem;font-size:0.85rem;line-height:1.8">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.3rem 1rem">
        <div><span style="color:var(--muted);font-size:0.72rem">Nome</span><div style="font-weight:700">${nome}</div></div>
        <div><span style="color:var(--muted);font-size:0.72rem">CNPJ</span><div>${e.cnpj||'—'}</div></div>
        <div><span style="color:var(--muted);font-size:0.72rem">E-mail</span><div>${e.email||'—'}</div></div>
        <div><span style="color:var(--muted);font-size:0.72rem">Slug</span><code style="font-size:0.78rem">${e.slug||'—'}</code></div>
      </div>
    </div>`;
  document.getElementById('editEmpresaStatus').value=e.status||'ativo';
  document.getElementById('editEmpresaId').value=id;

  const cor=e.cor_primaria||'#0d9488';
  document.getElementById('editEmpresaCor').value=cor;
  atualizarPreviewCorEdit(cor);

  const fundo=e.imagem_fundo_url||'';
  document.getElementById('editEmpresaFundo').value=fundo;
  atualizarPreviewFundoEdit(fundo);

  document.getElementById('modalVerEmpresa').classList.add('active');
}
function fecharModalVerEmpresa(){document.getElementById('modalVerEmpresa').classList.remove('active');}
async function atualizarEmpresa(){
  const id=document.getElementById('editEmpresaId').value;
  const status=document.getElementById('editEmpresaStatus').value;
  const cor=document.getElementById('editEmpresaCor').value;
  const fundo=document.getElementById('editEmpresaFundo').value.trim()||null;
  try{
    const r=await fetch(`${API}/empresas/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
      body:JSON.stringify({status,cor_primaria:cor,imagem_fundo_url:fundo})});
    if(!r.ok){const d=await r.json();mostrarToast('❌ Erro',d.erro||'Erro');return;}
    fecharModalVerEmpresa();carregarEmpresas();mostrarToast('✅ Empresa atualizada!','Cor e configurações salvas.');
  }catch{mostrarToast('❌ Erro','Erro de conexão');}
}

async function verUsuariosSA(empresaId,nomeEmpresa){
  document.getElementById('tituloEmpresaUsuariosSA').textContent=nomeEmpresa;
  document.getElementById('listaUsuariosSA').innerHTML='<p style="color:var(--muted)">Carregando...</p>';
  document.getElementById('modalUsuariosSA').classList.add('active');
  try{const r=await fetch(`${API}/profissionais?empresa_id=${empresaId}`,{headers:{Authorization:`Bearer ${token}`}});
    const lista=await r.json();
    const badgePerfil={admin:'badge-confirmado',profissional:'badge-pendente'};
    document.getElementById('listaUsuariosSA').innerHTML=lista.map(p=>`
      <div style="display:flex;align-items:center;gap:0.75rem;padding:0.6rem 0;border-bottom:1px solid var(--border)">
        <div style="width:32px;height:32px;border-radius:50%;background:${corProf(p)};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700">${p.nome.charAt(0)}</div>
        <div><div style="font-weight:600">${p.nome}</div><div style="font-size:0.75rem;color:var(--muted)">${p.email}</div></div>
        <span class="badge ${badgePerfil[p.perfil]||''}" style="margin-left:auto">${p.perfil==='admin'?'👑 Admin':'🔍 Analista'}</span>
      </div>`).join('')||'<p style="color:var(--muted)">Nenhum usuário.</p>';
  }catch{document.getElementById('listaUsuariosSA').innerHTML='<p style="color:var(--muted)">Erro ao carregar.</p>';}
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
      body: JSON.stringify({ nome, descricao: descricao||null, duracao_minutos: duracao, empresa_id: usuario.empresa_id, profissionais: profissionaisIds, profissionais_ids: profissionaisIds })
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
      body: JSON.stringify({ profissionais: profissionaisIds, profissionais_ids: profissionaisIds })
    });
    if (r.ok) return;
  } catch {}
  try {
    const rAtual = await fetch(`${API}/profissionais?empresa_id=${usuario.empresa_id}&servico_id=${servicoId}`, { headers: { Authorization: `Bearer ${token}` } });
    const atuais = rAtual.ok ? await rAtual.json() : [];
    const idsAtuais = Array.isArray(atuais) ? atuais.map(p => p.id) : [];
    for (const pid of profissionaisIds) {
      if (!idsAtuais.includes(pid)) {
        await fetch(`${API}/profissional-servicos`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ profissional_id: pid, servico_id: servicoId }) });
      }
    }
    for (const pid of idsAtuais) {
      if (!profissionaisIds.includes(pid)) {
        await fetch(`${API}/profissional-servicos?profissional_id=${pid}&servico_id=${servicoId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
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
    const rProfs = await fetch(`${API}/profissionais?empresa_id=${usuario.empresa_id}&servico_id=${id}`, { headers:{ Authorization:`Bearer ${token}` } });
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

// ── Dashboard Stats ───────────────────────────────────────
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
  const statusBadge = { confirmado:'badge-confirmado', pendente:'badge-pendente', cancelado:'badge-cancelado', concluido:'badge-concluido', faltou:'badge-faltou' };
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
            '<td style="padding:6px 8px;color:var(--muted)">'+(a.profissional_nome||'—')+'</td>' +
            '<td style="padding:6px 8px"><span class="badge '+(statusBadge[a.status]||'')+'">'+a.status+'</span></td>' +
            '<td style="padding:6px 8px"><button class="btn btn-secondary btn-sm" onclick="fecharDashboardStats();abrirVerAgendamento('+a.id+')">Ver</button></td>' +
            '</tr>';
        }).join('')}</tbody>
      </table>`
    : '<p style="color:var(--muted);text-align:center;padding:2rem">Nenhum compromisso nesta categoria.</p>';
  document.getElementById('modalDashboardStats').classList.add('active');
}
function fecharDashboardStats() { document.getElementById('modalDashboardStats').classList.remove('active'); }

function toggleConvidarExterno(chk) {
  const campo = document.getElementById('campoConvidarExterno');
  if (campo) campo.style.display = chk.checked ? 'block' : 'none';
}

init();