const API_URL = "http://localhost:3000";

const statusConfig = {
    pendente: {
        elementId: "pendente",
        countId: "count-pendente",
        empty: "Nenhuma tarefa pendente."
    },
    "em andamento": {
        elementId: "andamento",
        countId: "count-em-andamento",
        empty: "Nada em andamento agora."
    },
    concluido: {
        elementId: "concluido",
        countId: "count-concluido",
        empty: "Tarefas concluídas aparecerão aqui."
    }
};

let usuario = null;
let tarefas = [];
let listas = [];
let tarefaParaExcluir = null;
let tarefaEmDetalhe = null;
let quadroAtual = null;

document.addEventListener("DOMContentLoaded", iniciarDashboard);

function iniciarDashboard() {
    const usuarioSalvo = localStorage.getItem("usuario");

    if (!usuarioSalvo) {
        window.location.href = "login.html";
        return;
    }

    usuario = JSON.parse(usuarioSalvo);
    aplicarTema(localStorage.getItem("tema") || "light");
    prepararUsuario();
    prepararEventos();
    definirDataMinima();
    carregarTudo();
}

function prepararUsuario() {
    document.getElementById("boasVindas").textContent = usuario.nome;
    document.getElementById("userInitials").textContent = obterIniciais(usuario.nome);
}

function prepararEventos() {
    document.getElementById("logoutBtn").addEventListener("click", logout);
    document.getElementById("themeToggle").addEventListener("click", alternarTema);
    document.getElementById("searchForm").addEventListener("submit", pesquisarTarefas);
    document.getElementById("advancedFiltersBtn").addEventListener("click", alternarFiltrosAvancados);
    document.getElementById("openTaskModalBtn").addEventListener("click", () => abrirFormularioTarefa());
    document.getElementById("openListModalBtn").addEventListener("click", abrirModalLista);
    document.getElementById("taskForm").addEventListener("submit", salvarTarefa);
    document.getElementById("listForm").addEventListener("submit", salvarLista);
    document.getElementById("boardSettingsForm").addEventListener("submit", salvarConfiguracaoQuadro);
    document.getElementById("deleteBoardBtn").addEventListener("click", excluirQuadroAtual);
    document.getElementById("moveBoardLeftBtn").addEventListener("click", () => moverQuadroAtual("esquerda"));
    document.getElementById("moveBoardRightBtn").addEventListener("click", () => moverQuadroAtual("direita"));
    document.getElementById("confirmDeleteBtn").addEventListener("click", confirmarExclusao);
    document.getElementById("detailsEditBtn").addEventListener("click", editarTarefaEmDetalhe);
    document.getElementById("clearFiltersBtn").addEventListener("click", limparFiltros);

    ["filterKeyword", "filterStatus", "filterPriority", "filterStart", "filterEnd"].forEach((id) => {
        document.getElementById(id).addEventListener("input", debounce(carregarTarefas, 350));
    });

    document.querySelectorAll("input[name='taskDateMode']").forEach((radio) => {
        radio.addEventListener("change", atualizarModoData);
    });
    document.getElementById("taskStartDate").addEventListener("change", atualizarDataFimMinima);

    document.querySelectorAll("[data-close-modal]").forEach((button) => {
        button.addEventListener("click", fecharModais);
    });

    document.querySelectorAll(".modal").forEach((modal) => {
        modal.addEventListener("click", (event) => {
            if (event.target === modal) fecharModais();
        });
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") fecharModais();
    });

    registrarDropZones();
}

function definirDataMinima() {
    document.getElementById("taskStartDate").setAttribute("min", hojeISO());
    document.getElementById("taskEndDate").setAttribute("min", hojeISO());
}

async function carregarTudo() {
    await carregarListas();
    await carregarTarefas();
}

async function carregarTarefas() {
    try {
        const resposta = await fetch(`${API_URL}/tarefas/${usuario.id}${montarQueryFiltros()}`);
        const dados = await resposta.json();

        if (!resposta.ok) {
            mostrarToast(dados.erro || "Erro ao carregar tarefas.", "error");
            return;
        }

        tarefas = dados.map(normalizarTarefa);
        renderizarTarefas();
    } catch (erro) {
        mostrarToast("Não foi possível conectar ao servidor.", "error");
    }
}

async function carregarListas() {
    try {
        const resposta = await fetch(`${API_URL}/listas/${usuario.id}`);
        const dados = await resposta.json();

        if (!resposta.ok) {
            mostrarToast(dados.erro || "Erro ao carregar quadros.", "error");
            listas = [];
        } else {
            listas = dados;
        }

        renderizarColunasCustomizadas();
        atualizarSelectListas();
        registrarDropZones();
    } catch (erro) {
        listas = [];
        renderizarColunasCustomizadas();
        atualizarSelectListas();
    }
}

function renderizarColunasCustomizadas() {
    document.querySelectorAll(".custom-column").forEach((coluna) => coluna.remove());

    const board = document.getElementById("kanbanBoard");

    listas.forEach((lista) => {
        const article = document.createElement("article");
        article.className = "kanban-column custom-column";
        article.dataset.listId = lista.id_lista;
        article.style.setProperty("--column-accent", lista.cor || "#7c3aed");

        article.innerHTML = `
            <header>
                <div>
                    <span class="status-dot custom"></span>
                    <h2>${escaparHtml(lista.nome)}</h2>
                </div>
                <div class="column-tools">
                    <strong id="count-list-${lista.id_lista}">0</strong>
                    <button class="column-menu-btn" type="button" aria-label="Opções do quadro">...</button>
                </div>
            </header>
            <div id="lista-${lista.id_lista}" class="task-list" data-list-id="${lista.id_lista}"></div>
        `;

        article.querySelector(".column-menu-btn").addEventListener("click", () => abrirConfiguracaoQuadro(lista));
        board.appendChild(article);
    });
}

function renderizarTarefas() {
    Object.entries(statusConfig).forEach(([status, config]) => {
        const lista = document.getElementById(config.elementId);
        const tarefasDaColuna = tarefas.filter((tarefa) => !tarefa.id_lista && tarefa.status === status);
        preencherColuna(lista, tarefasDaColuna, config.countId, config.empty);
    });

    listas.forEach((listaCustomizada) => {
        const listaElement = document.getElementById(`lista-${listaCustomizada.id_lista}`);
        const tarefasDaLista = tarefas.filter(
            (tarefa) => String(tarefa.id_lista || "") === String(listaCustomizada.id_lista)
        );

        preencherColuna(
            listaElement,
            tarefasDaLista,
            `count-list-${listaCustomizada.id_lista}`,
            "Arraste tarefas para este quadro."
        );
    });
}

function preencherColuna(elemento, tarefasDaColuna, countId, textoVazio) {
    if (!elemento) return;

    elemento.innerHTML = "";
    document.getElementById(countId).textContent = tarefasDaColuna.length;

    if (tarefasDaColuna.length === 0) {
        elemento.appendChild(criarEstadoVazio(textoVazio));
        return;
    }

    tarefasDaColuna.forEach((tarefa) => elemento.appendChild(criarCardTarefa(tarefa)));
}

function criarCardTarefa(tarefa) {
    const card = document.createElement("article");
    card.className = `task-card ${tarefa.status === "concluido" ? "done" : ""} ${estaVencida(tarefa) ? "overdue" : ""}`;
    card.draggable = true;
    card.dataset.id = tarefa.id_tarefa;

    card.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData("text/plain", tarefa.id_tarefa);
        card.classList.add("dragging");
    });

    card.addEventListener("dragend", () => card.classList.remove("dragging"));

    const top = document.createElement("div");
    top.className = "task-top";

    const title = document.createElement("h3");
    title.className = "task-title";
    title.textContent = tarefa.titulo;

    const actions = document.createElement("div");
    actions.className = "card-actions";
    actions.appendChild(criarBotaoCard("Ver", () => abrirDetalhes(tarefa)));
    actions.appendChild(criarBotaoCard("Editar", () => abrirFormularioTarefa(tarefa)));
    actions.appendChild(criarBotaoCard("Excluir", () => abrirConfirmacaoExclusao(tarefa)));

    top.appendChild(title);
    top.appendChild(actions);
    card.appendChild(top);

    if (tarefa.descricao) {
        const descricao = document.createElement("p");
        descricao.className = "task-description";
        descricao.textContent = tarefa.descricao;
        card.appendChild(descricao);
    }

    const footer = document.createElement("div");
    footer.className = "task-footer";
    footer.appendChild(criarBadgePrioridade(tarefa.prioridade));

    if (tarefa.id_lista) {
        footer.appendChild(criarMeta("Quadro", nomeLista(tarefa.id_lista)));
    }

    if (tarefa.data_inicio || tarefa.data_fim || tarefa.data_vencimento) {
        footer.appendChild(criarBadgePeriodo(tarefa));
    }

    if (tarefa.data_conclusao) {
        footer.appendChild(criarMeta("Concluída", formatarData(tarefa.data_conclusao)));
    }

    card.appendChild(footer);
    return card;
}

function criarBotaoCard(texto, acao) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = texto;
    button.addEventListener("click", acao);
    return button;
}

function criarBadgePrioridade(prioridade) {
    const badge = document.createElement("span");
    const valor = prioridade || "baixa";
    badge.className = `badge ${valor}`;
    badge.textContent = `Prioridade ${formatarPrioridade(valor)}`;
    return badge;
}

function criarBadgePeriodo(tarefa) {
    const badge = document.createElement("span");
    badge.className = `date-badge ${estaVencida(tarefa) ? "overdue" : ""}`;
    const inicio = tarefa.data_inicio ? formatarData(tarefa.data_inicio) : "";
    const fim = tarefa.data_fim || tarefa.data_vencimento;
    const fimFormatado = fim ? formatarData(fim) : "";
    const horario = tarefa.dia_inteiro ? "dia inteiro" : formatarHorario(tarefa);

    if (inicio && fimFormatado && inicio !== fimFormatado) {
        badge.textContent = `${inicio} até ${fimFormatado}${horario ? ` · ${horario}` : ""}`;
    } else if (fimFormatado) {
        badge.textContent = estaVencida(tarefa)
            ? `Vencida em ${fimFormatado}${horario ? ` · ${horario}` : ""}`
            : `Vence em ${fimFormatado}${horario ? ` · ${horario}` : ""}`;
    } else {
        badge.textContent = inicio ? `Inicia em ${inicio}${horario ? ` · ${horario}` : ""}` : "Sem prazo";
    }

    return badge;
}

function criarEstadoVazio(texto) {
    const div = document.createElement("div");
    div.className = "empty-state";
    div.textContent = texto;
    return div;
}

function abrirFormularioTarefa(tarefa = null) {
    const form = document.getElementById("taskForm");
    const modalTitle = document.getElementById("taskModalTitle");
    const startInput = document.getElementById("taskStartDate");
    const endInput = document.getElementById("taskEndDate");

    form.reset();
    atualizarSelectListas();
    startInput.setAttribute("min", tarefa && tarefa.data_inicio < hojeISO() ? tarefa.data_inicio : hojeISO());
    endInput.setAttribute("min", tarefa && tarefa.data_fim < hojeISO() ? tarefa.data_fim : hojeISO());
    document.getElementById("taskFormMessage").textContent = "";
    document.getElementById("taskId").value = tarefa ? tarefa.id_tarefa : "";
    document.getElementById("taskTitulo").value = tarefa ? tarefa.titulo : "";
    document.getElementById("taskDescricao").value = tarefa ? tarefa.descricao || "" : "";
    startInput.value = tarefa ? tarefa.data_inicio || "" : "";
    endInput.value = tarefa ? tarefa.data_fim || tarefa.data_vencimento || "" : "";
    atualizarDataFimMinima();
    document.getElementById("taskStartTime").value = tarefa ? tarefa.hora_inicio || "" : "";
    document.getElementById("taskEndTime").value = tarefa ? tarefa.hora_fim || "" : "";
    document.getElementById(tarefa && !tarefa.dia_inteiro ? "taskWithTime" : "taskAllDay").checked = true;
    atualizarModoData();
    document.getElementById("taskPrioridade").value = tarefa ? tarefa.prioridade || "baixa" : "baixa";
    document.getElementById("taskStatus").value = tarefa ? tarefa.status : "pendente";
    document.getElementById("taskList").value = tarefa ? tarefa.id_lista || "" : "";
    modalTitle.textContent = tarefa ? "Editar tarefa" : "Nova tarefa";

    abrirModal("taskModal");
    setTimeout(() => document.getElementById("taskTitulo").focus(), 80);
}

async function salvarTarefa(event) {
    event.preventDefault();

    const id = document.getElementById("taskId").value;
    const titulo = document.getElementById("taskTitulo").value.trim();
    const descricao = document.getElementById("taskDescricao").value.trim();
    const data_inicio = document.getElementById("taskStartDate").value;
    const data_fim = document.getElementById("taskEndDate").value;
    const dia_inteiro = document.getElementById("taskAllDay").checked;
    const hora_inicio = dia_inteiro ? "" : document.getElementById("taskStartTime").value;
    const hora_fim = dia_inteiro ? "" : document.getElementById("taskEndTime").value;
    const prioridade = document.getElementById("taskPrioridade").value;
    const status = document.getElementById("taskStatus").value;
    const id_lista = document.getElementById("taskList").value || null;
    const mensagem = document.getElementById("taskFormMessage");

    if (!titulo) {
        mensagem.textContent = "Informe um título para a tarefa.";
        return;
    }

    const erroPeriodo = validarPeriodo(data_inicio, data_fim, hora_inicio, hora_fim, dia_inteiro);
    if (erroPeriodo) {
        mensagem.textContent = erroPeriodo;
        return;
    }

    try {
        const resposta = await fetch(`${API_URL}/tarefas${id ? `/${id}` : ""}`, {
            method: id ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                titulo,
                descricao,
                data: data_fim,
                data_inicio,
                data_fim,
                hora_inicio,
                hora_fim,
                dia_inteiro,
                prioridade,
                status,
                id_lista,
                id_usuario: usuario.id
            })
        });

        const dados = await resposta.json();

        if (!resposta.ok) {
            mensagem.textContent = dados.erro || "Não foi possível salvar a tarefa.";
            return;
        }

        fecharModais();
        mostrarToast(dados.mensagem || "Tarefa salva com sucesso.", "success");
        await carregarTarefas();
    } catch (erro) {
        mensagem.textContent = "Não foi possível conectar ao servidor.";
    }
}

async function atualizarStatusPorDrop(event, destino) {
    const id = event.dataTransfer.getData("text/plain");
    const tarefa = tarefas.find((item) => String(item.id_tarefa) === String(id));

    if (!tarefa) return;

    const estadoAnterior = { status: tarefa.status, id_lista: tarefa.id_lista || null };
    const novoStatus = destino.status || tarefa.status;
    const novaLista = destino.id_lista || null;

    if (tarefa.status === novoStatus && String(tarefa.id_lista || "") === String(novaLista || "")) return;

    tarefa.status = novoStatus;
    tarefa.id_lista = novaLista;
    if (novoStatus === "concluido" && !tarefa.data_conclusao) tarefa.data_conclusao = new Date().toISOString();
    if (novoStatus !== "concluido") tarefa.data_conclusao = null;
    renderizarTarefas();

    try {
        const resposta = await fetch(`${API_URL}/tarefas/${id}/status`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                status: novoStatus,
                id_lista: novaLista,
                id_usuario: usuario.id
            })
        });

        const dados = await resposta.json();

        if (!resposta.ok) {
            tarefa.status = estadoAnterior.status;
            tarefa.id_lista = estadoAnterior.id_lista;
            renderizarTarefas();
            mostrarToast(dados.erro || "Não foi possível mover a tarefa.", "error");
            return;
        }

        mostrarToast(novoStatus === "concluido" ? "Tarefa concluída." : "Tarefa movida.", "success");
        await carregarTarefas();
    } catch (erro) {
        tarefa.status = estadoAnterior.status;
        tarefa.id_lista = estadoAnterior.id_lista;
        renderizarTarefas();
        mostrarToast("Não foi possível conectar ao servidor.", "error");
    }
}

function registrarDropZones() {
    document.querySelectorAll(".task-list").forEach((lista) => {
        if (lista.dataset.dropReady === "true") return;
        lista.dataset.dropReady = "true";

        const coluna = lista.closest(".kanban-column");

        lista.addEventListener("dragover", (event) => {
            event.preventDefault();
            coluna.classList.add("drag-over");
        });

        lista.addEventListener("dragleave", () => coluna.classList.remove("drag-over"));

        lista.addEventListener("drop", (event) => {
            event.preventDefault();
            coluna.classList.remove("drag-over");
            atualizarStatusPorDrop(event, {
                status: lista.dataset.status,
                id_lista: lista.dataset.listId
            });
        });
    });
}

function abrirDetalhes(tarefa) {
    tarefaEmDetalhe = tarefa;
    document.getElementById("detailsTitle").textContent = tarefa.titulo;
    document.getElementById("detailsDescription").textContent =
        tarefa.descricao || "Sem descrição cadastrada.";

    const meta = document.getElementById("detailsMeta");
    meta.innerHTML = "";
    meta.appendChild(criarBadgePrioridade(tarefa.prioridade));
    meta.appendChild(criarMeta("Status", formatarStatus(tarefa.status)));

    if (tarefa.id_lista) {
        meta.appendChild(criarMeta("Quadro", nomeLista(tarefa.id_lista)));
    }

    if (tarefa.data_inicio || tarefa.data_fim || tarefa.data_vencimento) {
        meta.appendChild(criarBadgePeriodo(tarefa));
    }

    if (tarefa.data_conclusao) {
        meta.appendChild(criarMeta("Concluída", formatarData(tarefa.data_conclusao)));
    }

    abrirModal("detailsModal");
}

function criarMeta(rotulo, valor) {
    const span = document.createElement("span");
    span.className = "date-badge";
    span.textContent = `${rotulo}: ${valor}`;
    return span;
}

function editarTarefaEmDetalhe() {
    if (!tarefaEmDetalhe) return;
    fecharModais();
    abrirFormularioTarefa(tarefaEmDetalhe);
}

function abrirConfirmacaoExclusao(tarefa) {
    tarefaParaExcluir = tarefa;
    document.getElementById("deleteTitle").textContent = `Excluir "${tarefa.titulo}"?`;
    abrirModal("deleteModal");
}

async function confirmarExclusao() {
    if (!tarefaParaExcluir) return;

    try {
        const resposta = await fetch(`${API_URL}/tarefas/${tarefaParaExcluir.id_tarefa}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id_usuario: usuario.id })
        });

        const dados = await resposta.json();

        if (!resposta.ok) {
            mostrarToast(dados.erro || "Não foi possível excluir a tarefa.", "error");
            return;
        }

        fecharModais();
        mostrarToast(dados.mensagem || "Tarefa excluída.", "success");
        tarefaParaExcluir = null;
        await carregarTarefas();
    } catch (erro) {
        mostrarToast("Não foi possível conectar ao servidor.", "error");
    }
}

function abrirModalLista() {
    document.getElementById("listForm").reset();
    document.getElementById("listFormMessage").textContent = "";
    abrirModal("listModal");
    setTimeout(() => document.getElementById("listName").focus(), 80);
}

async function salvarLista(event) {
    event.preventDefault();

    const nome = document.getElementById("listName").value.trim();
    const mensagem = document.getElementById("listFormMessage");

    if (!nome) {
        mensagem.textContent = "Informe um nome para o quadro.";
        return;
    }

    try {
        const resposta = await fetch(`${API_URL}/listas`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nome, cor: "#7c3aed", id_usuario: usuario.id })
        });

        const dados = await resposta.json();

        if (!resposta.ok) {
            mensagem.textContent = dados.erro || "Não foi possível criar o quadro.";
            return;
        }

        fecharModais();
        mostrarToast(dados.mensagem || "Quadro criado.", "success");
        await carregarTudo();
    } catch (erro) {
        mensagem.textContent = "Não foi possível conectar ao servidor.";
    }
}

function abrirConfiguracaoQuadro(lista) {
    quadroAtual = lista;
    document.getElementById("boardId").value = lista.id_lista;
    document.getElementById("boardName").value = lista.nome;
    document.getElementById("boardColor").value = lista.cor || "#7c3aed";
    document.getElementById("boardSettingsMessage").textContent = "";
    abrirModal("boardSettingsModal");
}

async function salvarConfiguracaoQuadro(event) {
    event.preventDefault();

    if (!quadroAtual) return;

    const nome = document.getElementById("boardName").value.trim();
    const cor = document.getElementById("boardColor").value;
    const mensagem = document.getElementById("boardSettingsMessage");

    if (!nome) {
        mensagem.textContent = "Informe um nome para o quadro.";
        return;
    }

    try {
        const resposta = await fetch(`${API_URL}/listas/${quadroAtual.id_lista}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nome, cor, id_usuario: usuario.id })
        });
        const dados = await resposta.json();

        if (!resposta.ok) {
            mensagem.textContent = dados.erro || "Não foi possível atualizar o quadro.";
            return;
        }

        fecharModais();
        mostrarToast(dados.mensagem || "Quadro atualizado.", "success");
        await carregarTudo();
    } catch (erro) {
        mensagem.textContent = "Não foi possível conectar ao servidor.";
    }
}

async function moverQuadroAtual(direcao) {
    if (!quadroAtual) return;

    try {
        const resposta = await fetch(`${API_URL}/listas/${quadroAtual.id_lista}/mover`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ direcao, id_usuario: usuario.id })
        });
        const dados = await resposta.json();

        if (!resposta.ok) {
            mostrarToast(dados.erro || "Não foi possível mover o quadro.", "error");
            return;
        }

        mostrarToast(dados.mensagem || "Quadro movido.", "success");
        await carregarTudo();
    } catch (erro) {
        mostrarToast("Não foi possível conectar ao servidor.", "error");
    }
}

async function excluirQuadroAtual() {
    if (!quadroAtual) return;

    const mensagem = document.getElementById("boardSettingsMessage");
    mensagem.textContent = "";

    try {
        const resposta = await fetch(`${API_URL}/listas/${quadroAtual.id_lista}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id_usuario: usuario.id })
        });
        const dados = await resposta.json();

        if (!resposta.ok) {
            mensagem.textContent = dados.erro || "Não foi possível excluir o quadro.";
            return;
        }

        fecharModais();
        mostrarToast(dados.mensagem || "Quadro excluído.", "success");
        quadroAtual = null;
        await carregarTudo();
    } catch (erro) {
        mensagem.textContent = "Não foi possível conectar ao servidor.";
    }
}

function atualizarSelectListas() {
    const select = document.getElementById("taskList");
    select.innerHTML = '<option value="">Quadro padrão por status</option>';

    listas.forEach((lista) => {
        const option = document.createElement("option");
        option.value = lista.id_lista;
        option.textContent = lista.nome;
        select.appendChild(option);
    });
}

function montarQueryFiltros() {
    const params = new URLSearchParams();
    const filtros = {
        q: document.getElementById("filterKeyword").value.trim(),
        status: document.getElementById("filterStatus").value,
        prioridade: document.getElementById("filterPriority").value,
        data_inicio: document.getElementById("filterStart").value,
        data_fim: document.getElementById("filterEnd").value
    };

    Object.entries(filtros).forEach(([key, value]) => {
        if (value) params.set(key, value);
    });

    const query = params.toString();
    return query ? `?${query}` : "";
}

function pesquisarTarefas(event) {
    event.preventDefault();
    carregarTarefas();
}

function alternarFiltrosAvancados() {
    const filtros = document.getElementById("advancedFilters");
    filtros.hidden = !filtros.hidden;
}

function limparFiltros() {
    document.getElementById("filterKeyword").value = "";
    document.getElementById("filterStatus").value = "todos";
    document.getElementById("filterPriority").value = "todas";
    document.getElementById("filterStart").value = "";
    document.getElementById("filterEnd").value = "";
    carregarTarefas();
}

function atualizarModoData() {
    const diaInteiro = document.getElementById("taskAllDay").checked;
    const timeFields = document.getElementById("timeFields");
    timeFields.hidden = diaInteiro;

    if (diaInteiro) {
        document.getElementById("taskStartTime").value = "";
        document.getElementById("taskEndTime").value = "";
    }
}

function atualizarDataFimMinima() {
    const inicio = document.getElementById("taskStartDate").value;
    document.getElementById("taskEndDate").setAttribute("min", inicio || hojeISO());
}

function abrirModal(id) {
    const modal = document.getElementById(id);
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
}

function fecharModais() {
    document.querySelectorAll(".modal.open").forEach((modal) => {
        modal.classList.remove("open");
        modal.setAttribute("aria-hidden", "true");
    });
}

function mostrarToast(texto, tipo = "success") {
    const toast = document.createElement("div");
    toast.className = `toast ${tipo}`;
    toast.textContent = texto;
    document.getElementById("toastArea").appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3200);
}

function aplicarTema(tema) {
    document.body.dataset.theme = tema;
    localStorage.setItem("tema", tema);

    const toggle = document.getElementById("themeToggle");
    if (!toggle) return;

    toggle.querySelector("strong").textContent = tema === "dark" ? "Escuro" : "Claro";
}

function alternarTema() {
    aplicarTema(document.body.dataset.theme === "dark" ? "light" : "dark");
}

function normalizarTarefa(tarefa) {
    return {
        ...tarefa,
        status: normalizarStatus(tarefa.status),
        prioridade: tarefa.prioridade || "baixa",
        id_lista: tarefa.id_lista || null,
        data_inicio: tarefa.data_inicio ? String(tarefa.data_inicio).slice(0, 10) : "",
        data_fim: tarefa.data_fim ? String(tarefa.data_fim).slice(0, 10) : "",
        hora_inicio: tarefa.hora_inicio ? String(tarefa.hora_inicio).slice(0, 5) : "",
        hora_fim: tarefa.hora_fim ? String(tarefa.hora_fim).slice(0, 5) : "",
        dia_inteiro: tarefa.dia_inteiro === undefined || tarefa.dia_inteiro === null ? true : Boolean(Number(tarefa.dia_inteiro)),
        data_vencimento: tarefa.data_vencimento ? String(tarefa.data_vencimento).slice(0, 10) : "",
        data_conclusao: tarefa.data_conclusao ? String(tarefa.data_conclusao).slice(0, 10) : ""
    };
}

function normalizarStatus(status) {
    if (status === "concluida") return "concluido";
    if (status === "andamento") return "em andamento";
    return status || "pendente";
}

function formatarStatus(status) {
    const labels = {
        pendente: "Pendente",
        "em andamento": "Em andamento",
        concluido: "Concluído"
    };

    return labels[normalizarStatus(status)] || status;
}

function formatarPrioridade(prioridade) {
    const labels = {
        baixa: "baixa",
        media: "média",
        alta: "alta"
    };

    return labels[prioridade] || "baixa";
}

function formatarData(data) {
    if (!data) return "";
    const [ano, mes, dia] = String(data).slice(0, 10).split("-");
    return `${dia}/${mes}/${ano}`;
}

function estaVencida(tarefa) {
    const fim = tarefa.data_fim || tarefa.data_vencimento;
    if (!fim || tarefa.status === "concluido") return false;
    return fim < hojeISO();
}

function validarPeriodo(dataInicio, dataFim, horaInicio, horaFim, diaInteiro) {
    if (dataInicio && dataFim && dataFim < dataInicio) {
        return "A data de fim não pode ser anterior à data de início.";
    }

    if (!diaInteiro && dataInicio && dataFim && dataInicio === dataFim && horaInicio && horaFim && horaFim < horaInicio) {
        return "A hora de fim não pode ser anterior à hora de início.";
    }

    return "";
}

function formatarHorario(tarefa) {
    if (!tarefa.hora_inicio && !tarefa.hora_fim) return "";
    if (tarefa.hora_inicio && tarefa.hora_fim) return `${tarefa.hora_inicio} às ${tarefa.hora_fim}`;
    if (tarefa.hora_inicio) return `a partir de ${tarefa.hora_inicio}`;
    return `até ${tarefa.hora_fim}`;
}

function nomeLista(idLista) {
    const lista = listas.find((item) => String(item.id_lista) === String(idLista));
    return lista ? lista.nome : "Quadro personalizado";
}

function obterIniciais(nome) {
    return nome
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((parte) => parte[0])
        .join("")
        .toUpperCase();
}

function hojeISO() {
    return new Date().toLocaleDateString("en-CA");
}

function debounce(funcao, delay) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => funcao(...args), delay);
    };
}

function escaparHtml(texto) {
    const div = document.createElement("div");
    div.textContent = texto;
    return div.innerHTML;
}

function logout() {
    localStorage.removeItem("usuario");
    window.location.href = "login.html";
}
