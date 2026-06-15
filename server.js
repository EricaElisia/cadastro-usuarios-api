require("dotenv").config({ quiet: true });

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcrypt");
const path = require("path");
const crypto = require("crypto");
const db = require("./db");

let nodemailer = null;
try {
    nodemailer = require("nodemailer");
} catch (erro) {
    nodemailer = null;
}

const app = express();
const PORT = process.env.PORT || 3000;

const STATUS_VALIDOS = ["pendente", "em andamento", "concluido", "concluida"];
const PRIORIDADES_VALIDAS = ["baixa", "media", "alta"];
const colunasCache = {};
const APP_URL = process.env.APP_URL || "http://localhost:3000";
const allowedOrigins = (process.env.CORS_ORIGIN || APP_URL)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
const RESET_TOKEN_MINUTOS = 15;
const LEMBRETE_CHECK_MS = 60 * 1000;
let verificandoLembretes = false;

app.set("trust proxy", 1);

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'", ...allowedOrigins],
            objectSrc: ["'none'"],
            baseUri: ["'self'"]
        }
    }
}));

app.use(express.json({ limit: "1mb" }));
app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        return callback(new Error("Origem nao permitida pelo CORS."));
    }
}));

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { erro: "Muitas requisicoes. Aguarde um instante." }
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { erro: "Muitas tentativas. Tente novamente em alguns minutos." }
});

app.use(apiLimiter);

function query(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (erro, resultado) => {
            if (erro) {
                reject(erro);
                return;
            }
            resolve(resultado);
        });
    });
}

function normalizarStatus(status) {
    if (status === "concluida") return "concluido";
    if (status === "andamento") return "em andamento";
    return status || "pendente";
}

function statusParaBanco(status) {
    return normalizarStatus(status) === "concluido" ? "concluida" : normalizarStatus(status);
}

function validarData(data) {
    return !data || /^\d{4}-\d{2}-\d{2}$/.test(data);
}

function validarPeriodo(dataInicio, dataFim, horaInicio, horaFim, diaInteiro) {
    if (dataInicio && !validarData(dataInicio)) return "Data de início inválida.";
    if (dataFim && !validarData(dataFim)) return "Data de fim inválida.";

    if (dataInicio && dataFim && dataFim < dataInicio) {
        return "A data de fim não pode ser anterior à data de início.";
    }

    if (!diaInteiro && dataInicio && dataFim && dataInicio === dataFim && horaInicio && horaFim && horaFim < horaInicio) {
        return "A hora de fim não pode ser anterior à hora de início.";
    }

    return "";
}

async function colunaExiste(tabela, coluna) {
    const chave = `${tabela}.${coluna}`;
    if (colunasCache[chave] !== undefined) return colunasCache[chave];

    const resultado = await query(
        `SELECT COUNT(*) AS total
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ?
            AND COLUMN_NAME = ?`,
        [tabela, coluna]
    );

    colunasCache[chave] = resultado[0].total > 0;
    return colunasCache[chave];
}

async function tabelaExiste(tabela) {
    const resultado = await query(
        `SELECT COUNT(*) AS total
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ?`,
        [tabela]
    );
    return resultado[0].total > 0;
}

async function buscarTarefaDoUsuario(idTarefa, idUsuario) {
    const tarefas = await query(
        "SELECT * FROM tarefas WHERE id_tarefa = ? AND id_usuario = ?",
        [idTarefa, idUsuario]
    );
    return tarefas[0];
}

async function montarFiltrosTarefas(idUsuario, filtros) {
    const where = ["id_usuario = ?"];
    const params = [idUsuario];
    const { status, prioridade, data_inicio, data_fim, q, id_lista } = filtros;
    const temDataInicio = await colunaExiste("tarefas", "data_inicio");
    const temDataFim = await colunaExiste("tarefas", "data_fim");
    const temLista = await colunaExiste("tarefas", "id_lista");
    const campoInicio = temDataInicio ? "COALESCE(data_inicio, data_vencimento)" : "data_vencimento";
    const campoFim = temDataFim ? "COALESCE(data_fim, data_vencimento)" : "data_vencimento";

    if (status && status !== "todos") {
        where.push("status = ?");
        params.push(statusParaBanco(status));
    }

    if (prioridade && prioridade !== "todas") {
        where.push("prioridade = ?");
        params.push(prioridade);
    }

    if (data_inicio) {
        where.push(`${campoFim} >= ?`);
        params.push(data_inicio);
    }

    if (data_fim) {
        where.push(`${campoInicio} <= ?`);
        params.push(data_fim);
    }

    if (q) {
        where.push("(titulo LIKE ? OR descricao LIKE ?)");
        params.push(`%${q}%`, `%${q}%`);
    }

    if (temLista && id_lista === "sem_lista") {
        where.push("id_lista IS NULL");
    } else if (temLista && id_lista) {
        where.push("id_lista = ?");
        params.push(id_lista);
    }

    return { where, params };
}

function dadosPeriodo(body) {
    const dataFinal = body.data_fim || body.data || null;
    const diaInteiro = body.dia_inteiro !== false && body.dia_inteiro !== "false" && body.dia_inteiro !== 0;

    return {
        dataInicio: body.data_inicio || null,
        dataFim: dataFinal,
        horaInicio: diaInteiro ? null : body.hora_inicio || null,
        horaFim: diaInteiro ? null : body.hora_fim || null,
        diaInteiro
    };
}

async function aplicarCamposOpcionais(colunas, valores, body) {
    const periodo = dadosPeriodo(body);

    if (await colunaExiste("tarefas", "id_lista")) {
        colunas.push("id_lista");
        valores.push(body.id_lista || null);
    }

    if (await colunaExiste("tarefas", "data_inicio")) {
        colunas.push("data_inicio");
        valores.push(periodo.dataInicio);
    }

    if (await colunaExiste("tarefas", "data_fim")) {
        colunas.push("data_fim");
        valores.push(periodo.dataFim);
    }

    if (await colunaExiste("tarefas", "hora_inicio")) {
        colunas.push("hora_inicio");
        valores.push(periodo.horaInicio);
    }

    if (await colunaExiste("tarefas", "hora_fim")) {
        colunas.push("hora_fim");
        valores.push(periodo.horaFim);
    }

    if (await colunaExiste("tarefas", "dia_inteiro")) {
        colunas.push("dia_inteiro");
        valores.push(periodo.diaInteiro ? 1 : 0);
    }

    if (await colunaExiste("tarefas", "situacao_conclusao")) {
        colunas.push("situacao_conclusao");
        valores.push(body.situacao_conclusao ? body.situacao_conclusao.trim() : null);
    }

    await aplicarCamposLembrete(colunas, valores, body);
}

async function aplicarSetsOpcionais(sets, params, body) {
    const periodo = dadosPeriodo(body);

    if (await colunaExiste("tarefas", "id_lista")) {
        sets.push("id_lista = ?");
        params.push(body.id_lista || null);
    }

    if (await colunaExiste("tarefas", "data_inicio")) {
        sets.push("data_inicio = ?");
        params.push(periodo.dataInicio);
    }

    if (await colunaExiste("tarefas", "data_fim")) {
        sets.push("data_fim = ?");
        params.push(periodo.dataFim);
    }

    if (await colunaExiste("tarefas", "hora_inicio")) {
        sets.push("hora_inicio = ?");
        params.push(periodo.horaInicio);
    }

    if (await colunaExiste("tarefas", "hora_fim")) {
        sets.push("hora_fim = ?");
        params.push(periodo.horaFim);
    }

    if (await colunaExiste("tarefas", "dia_inteiro")) {
        sets.push("dia_inteiro = ?");
        params.push(periodo.diaInteiro ? 1 : 0);
    }

    if (await colunaExiste("tarefas", "situacao_conclusao")) {
        sets.push("situacao_conclusao = ?");
        params.push(body.situacao_conclusao ? body.situacao_conclusao.trim() : null);
    }

    await aplicarSetsLembrete(sets, params, body);
}

function dadosLembrete(body) {
    const ativo = body.lembrete_ativo === true || body.lembrete_ativo === "true" || body.lembrete_ativo === 1 || body.lembrete_ativo === "1";
    const referencia = body.lembrete_referencia === "inicio" ? "inicio" : "fim";
    const quantidade = Number(body.lembrete_quantidade || 0);
    const unidade = ["minutos", "horas", "dias"].includes(body.lembrete_unidade) ? body.lembrete_unidade : "horas";

    if (!ativo) {
        return { ativo: false, referencia: "fim", quantidade: null, unidade: "horas", minutos: null };
    }

    const multiplicadores = { minutos: 1, horas: 60, dias: 1440 };
    const minutos = Math.round(quantidade * multiplicadores[unidade]);

    return { ativo, referencia, quantidade, unidade, minutos };
}

function validarLembrete(body, periodo) {
    const lembrete = dadosLembrete(body);
    if (!lembrete.ativo) return "";
    if (!Number.isFinite(lembrete.quantidade) || lembrete.quantidade <= 0) return "Informe quanto tempo antes deseja receber o lembrete.";
    if (lembrete.quantidade > 365) return "O tempo do lembrete ficou alto demais.";
    if (lembrete.referencia === "inicio" && !periodo.dataInicio) return "Para lembrar antes do inicio, informe a data de inicio.";
    if (lembrete.referencia === "fim" && !periodo.dataFim) return "Para lembrar antes do fim, informe a data de fim.";
    return "";
}

async function aplicarCamposLembrete(colunas, valores, body) {
    const lembrete = dadosLembrete(body);

    if (await colunaExiste("tarefas", "lembrete_ativo")) {
        colunas.push("lembrete_ativo");
        valores.push(lembrete.ativo ? 1 : 0);
    }

    if (await colunaExiste("tarefas", "lembrete_referencia")) {
        colunas.push("lembrete_referencia");
        valores.push(lembrete.referencia);
    }

    if (await colunaExiste("tarefas", "lembrete_quantidade")) {
        colunas.push("lembrete_quantidade");
        valores.push(lembrete.quantidade);
    }

    if (await colunaExiste("tarefas", "lembrete_unidade")) {
        colunas.push("lembrete_unidade");
        valores.push(lembrete.unidade);
    }

    if (await colunaExiste("tarefas", "lembrete_minutos")) {
        colunas.push("lembrete_minutos");
        valores.push(lembrete.minutos);
    }
}

async function aplicarSetsLembrete(sets, params, body) {
    const lembrete = dadosLembrete(body);

    if (await colunaExiste("tarefas", "lembrete_ativo")) {
        sets.push("lembrete_ativo = ?");
        params.push(lembrete.ativo ? 1 : 0);
    }

    if (await colunaExiste("tarefas", "lembrete_referencia")) {
        sets.push("lembrete_referencia = ?");
        params.push(lembrete.referencia);
    }

    if (await colunaExiste("tarefas", "lembrete_quantidade")) {
        sets.push("lembrete_quantidade = ?");
        params.push(lembrete.quantidade);
    }

    if (await colunaExiste("tarefas", "lembrete_unidade")) {
        sets.push("lembrete_unidade = ?");
        params.push(lembrete.unidade);
    }

    if (await colunaExiste("tarefas", "lembrete_minutos")) {
        sets.push("lembrete_minutos = ?");
        params.push(lembrete.minutos);
    }

    if (await colunaExiste("tarefas", "lembrete_enviado")) {
        sets.push("lembrete_enviado = 0");
    }

    if (await colunaExiste("tarefas", "lembrete_enviado_em")) {
        sets.push("lembrete_enviado_em = NULL");
    }
}

async function colunasLista() {
    if (!(await tabelaExiste("listas"))) {
        return { cor: false, ordem: false };
    }

    return {
        cor: await colunaExiste("listas", "cor"),
        ordem: await colunaExiste("listas", "ordem")
    };
}

async function registrarErro(origem, erro) {
    console.error(origem, erro);

    try {
        if (!(await tabelaExiste("logs_erros"))) return;
        await query(
            "INSERT INTO logs_erros (origem, mensagem, stack) VALUES (?, ?, ?)",
            [origem, erro.message || String(erro), erro.stack || null]
        );
    } catch (falhaLog) {
        console.error("Erro ao gravar log:", falhaLog);
    }
}

async function registrarHistorico(idUsuario, tipo, idTarefa, descricao, extras = {}) {
    try {
        if (!(await tabelaExiste("historico_atividades"))) return;
        const colunas = ["id_usuario", "id_tarefa", "tipo_acao", "descricao"];
        const valores = [idUsuario, idTarefa || null, tipo, descricao];

        if (await colunaExiste("historico_atividades", "situacao")) {
            colunas.push("situacao");
            valores.push(extras.situacao || null);
        }

        if (await colunaExiste("historico_atividades", "tarefa_snapshot")) {
            colunas.push("tarefa_snapshot");
            valores.push(extras.tarefaSnapshot ? JSON.stringify(extras.tarefaSnapshot) : null);
        }

        const placeholders = colunas.map(() => "?").join(", ");
        await query(
            `INSERT INTO historico_atividades (${colunas.join(", ")}) VALUES (${placeholders})`,
            valores
        );
    } catch (erro) {
        await registrarErro("historico_atividades", erro);
    }
}

function formatarValorData(campo, valor) {
    if (!valor) return null;

    const texto = String(valor);

    if (
        campo === "data_vencimento" ||
        campo === "data_inicio" ||
        campo === "data_fim"
    ) {
        return texto.split("T")[0];
    }

    if (
        campo === "data_conclusao" ||
        campo === "lembrete_enviado_em"
    ) {
        return texto
            .replace("T", " ")
            .replace(".000Z", "");
    }

    return valor;
}

async function prepararSnapshotParaRestaurar(snapshot, idUsuario) {
    const colunas = [];
    const valores = [];

    let idListaRestaurada = null;

    for (const campo of Object.keys(snapshot)) {
        if (campo === "id_tarefa") continue;

        colunas.push(campo);

        let valor = formatarValorData(
            campo,
            snapshot[campo]
        );

        if (campo === "id_usuario") {
            valor = idUsuario;
        }

        if (campo === "id_lista") {
            valor = idListaRestaurada;
        }

        valores.push(valor);
    }

    return {
        colunas,
        valores
    };
}

function tokenHash(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

async function enviarEmailRecuperacao(email, nome, link) {
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;

    if (!nodemailer || !smtpUser || !smtpPass) {
        console.log("Link de redefinição de senha:", link);
        return { enviado: false, modo: "console" };
    }

    const transport = nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: smtpUser,
            pass: smtpPass
        }
    });

    await transport.sendMail({
        from: `"iNota" <${smtpUser}>`,
        to: email,
        subject: "Redefinição de senha - iNota",
        html: `
            <p>Olá, ${nome || "usuário"}.</p>
            <p>Recebemos uma solicitação para redefinir sua senha no iNota.</p>
            <p>Este link é válido por ${RESET_TOKEN_MINUTOS} minutos:</p>
            <p><a href="${link}">${link}</a></p>
            <p>Se você não solicitou isso, ignore este e-mail.</p>
        `
    });

    return { enviado: true, modo: "email" };
}

async function criarTransportEmail() {
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;

    if (!nodemailer || !smtpUser || !smtpPass) return null;

    return nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: smtpUser,
            pass: smtpPass
        }
    });
}

async function enviarEmailLembrete(tarefa) {
    const transport = await criarTransportEmail();
    const destino = tarefa.email;
    const referencia = tarefa.lembrete_referencia === "inicio" ? "comecar" : "terminar";
    const prazo = tarefa.data_referencia ? new Date(tarefa.data_referencia).toLocaleString("pt-BR") : "sem horario definido";

    if (!transport) {
        console.log(`Lembrete de tarefa para ${destino}: "${tarefa.titulo}" perto de ${referencia} em ${prazo}`);
        return { enviado: false, modo: "console" };
    }

    await transport.sendMail({
        from: `"iNota" <${process.env.SMTP_USER}>`,
        to: destino,
        subject: `Lembrete iNota: ${tarefa.titulo}`,
        html: `
            <p>Ola, ${tarefa.nome || "usuario"}.</p>
            <p>Sua tarefa <strong>${tarefa.titulo}</strong> esta perto de ${referencia}.</p>
            <p><strong>Prazo:</strong> ${prazo}</p>
            ${tarefa.descricao ? `<p><strong>Descricao:</strong> ${tarefa.descricao}</p>` : ""}
            <p>Acesse o iNota para acompanhar seu quadro.</p>
        `
    });

    return { enviado: true, modo: "email" };
}

function validarSenha(senha) {
    if (!senha || senha.length < 8) return "A senha precisa ter no minimo 8 caracteres.";
    return "";
}

function validarNome(nome) {
    if (!nome || !nome.trim()) return "Nome e obrigatorio.";
    if (nome.trim().length < 3) return "Nome precisa ter pelo menos 3 caracteres.";
    return "";
}

async function verificarLembretesDeTarefas() {
    if (verificandoLembretes) return;
    verificandoLembretes = true;

    try {
        const colunasNecessarias = [
            "lembrete_ativo",
            "lembrete_referencia",
            "lembrete_minutos",
            "lembrete_enviado"
        ];

        for (const coluna of colunasNecessarias) {
            if (!(await colunaExiste("tarefas", coluna))) {
                verificandoLembretes = false;
                return;
            }
        }

        const temDataInicio = await colunaExiste("tarefas", "data_inicio");
        const temDataFim = await colunaExiste("tarefas", "data_fim");
        const temHoraInicio = await colunaExiste("tarefas", "hora_inicio");
        const temHoraFim = await colunaExiste("tarefas", "hora_fim");

        const dataInicio = temDataInicio ? "data_inicio" : "data_vencimento";
        const dataFim = temDataFim ? "COALESCE(data_fim, data_vencimento)" : "data_vencimento";
        const horaInicio = temHoraInicio ? "COALESCE(hora_inicio, '00:00:00')" : "'00:00:00'";
        const horaFim = temHoraFim ? "COALESCE(hora_fim, '23:59:59')" : "'23:59:59'";
        const dataReferencia = `CASE
            WHEN t.lembrete_referencia = 'inicio'
                THEN STR_TO_DATE(CONCAT(${dataInicio}, ' ', ${horaInicio}), '%Y-%m-%d %H:%i:%s')
            ELSE STR_TO_DATE(CONCAT(${dataFim}, ' ', ${horaFim}), '%Y-%m-%d %H:%i:%s')
        END`;

        const tarefas = await query(
            `SELECT
                t.id_tarefa,
                t.id_usuario,
                t.titulo,
                t.descricao,
                t.lembrete_referencia,
                u.nome,
                u.email,
                ${dataReferencia} AS data_referencia
             FROM tarefas t
             INNER JOIN usuarios u ON u.id_usuario = t.id_usuario
             WHERE t.lembrete_ativo = 1
                AND t.lembrete_enviado = 0
                AND t.status NOT IN ('concluida', 'concluido')
                AND ${dataReferencia} IS NOT NULL
                AND NOW() >= DATE_SUB(${dataReferencia}, INTERVAL t.lembrete_minutos MINUTE)
                AND NOW() <= DATE_ADD(${dataReferencia}, INTERVAL 15 MINUTE)
             ORDER BY data_referencia ASC
             LIMIT 20`
        );

        for (const tarefa of tarefas) {
            try {
                const resultadoEnvio = await enviarEmailLembrete(tarefa);
                if (resultadoEnvio.enviado) {
                    await query(
                        "UPDATE tarefas SET lembrete_enviado = 1, lembrete_enviado_em = NOW() WHERE id_tarefa = ?",
                        [tarefa.id_tarefa]
                    );
                    await registrarHistorico(tarefa.id_usuario, "lembrete", tarefa.id_tarefa, `Lembrete enviado: ${tarefa.titulo}`);
                }
            } catch (erro) {
                await registrarErro(`lembrete-tarefa-${tarefa.id_tarefa}`, erro);
            }
        }
    } catch (erro) {
        await registrarErro("verificar-lembretes", erro);
    } finally {
        verificandoLembretes = false;
    }
}

function iniciarVerificadorDeLembretes() {
    setTimeout(verificarLembretesDeTarefas, 3000);
    setInterval(verificarLembretesDeTarefas, LEMBRETE_CHECK_MS);
}

app.get("/", (req, res) => {
    res.json({ mensagem: "API do iNota funcionando!" });
});

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        app: "iNota",
        timestamp: new Date().toISOString()
    });
});

app.use(express.static(path.join(__dirname, "Front")));

app.post("/cadastro", authLimiter, async (req, res) => {
    const { nome, email, senha, senha2 } = req.body;

    if (!nome || !email || !senha || !senha2) {
        return res.status(400).json({ erro: "Todos os campos são obrigatórios." });
    }

    if (!/\S+@\S+\.\S+/.test(email)) {
        return res.status(400).json({ erro: "Informe um e-mail válido." });
    }

    if (senha.length < 8) {
        return res.status(400).json({ erro: "A senha precisa ter no mínimo 8 caracteres." });
    }

    if (senha !== senha2) {
        return res.status(400).json({ erro: "As senhas não coincidem." });
    }

    try {
        const usuarios = await query("SELECT id_usuario FROM usuarios WHERE email = ?", [
            email.trim().toLowerCase()
        ]);

        if (usuarios.length > 0) {
            return res.status(400).json({ erro: "Este e-mail já está cadastrado." });
        }

        const senhaHash = await bcrypt.hash(senha, 10);
        await query(
            "INSERT INTO usuarios (nome, email, senha, status) VALUES (?, ?, ?, 'ativo')",
            [nome.trim(), email.trim().toLowerCase(), senhaHash]
        );

        res.status(201).json({ mensagem: "Usuário cadastrado com sucesso." });
    } catch (erro) {
        console.error("Erro no cadastro:", erro);
        res.status(500).json({ erro: "Erro interno ao cadastrar usuário." });
    }
});

app.post("/login", authLimiter, async (req, res) => {
    const { email, senha } = req.body;

    if (!email || !senha) {
        return res.status(400).json({ erro: "Preencha e-mail e senha." });
    }

    try {
        const usuarios = await query("SELECT * FROM usuarios WHERE email = ?", [
            email.trim().toLowerCase()
        ]);

        if (usuarios.length === 0) {
            return res.status(400).json({ erro: "E-mail ou senha inválidos." });
        }

        const usuario = usuarios[0];
        const senhaValida = await bcrypt.compare(senha, usuario.senha);

        if (!senhaValida) {
            return res.status(400).json({ erro: "E-mail ou senha inválidos." });
        }

        res.json({
            mensagem: "Login realizado com sucesso.",
            usuario: {
                id: usuario.id_usuario,
                nome: usuario.nome,
                email: usuario.email
            }
        });
    } catch (erro) {
        console.error("Erro no login:", erro);
        res.status(500).json({ erro: "Erro interno ao fazer login." });
    }
});

app.post("/recuperar-senha", authLimiter, async (req, res) => {
    const { email } = req.body;
    const respostaGenerica = {
        mensagem: "Se o e-mail estiver cadastrado, enviaremos um link valido por 15 minutos."
    };

    if (!email || !/\S+@\S+\.\S+/.test(email)) {
        return res.json(respostaGenerica);
    }

    try {
        const usuarios = await query("SELECT id_usuario, nome, email FROM usuarios WHERE email = ?", [
            email.trim().toLowerCase()
        ]);

        if (usuarios.length === 0) {
            return res.json(respostaGenerica);
        }

        if (!(await tabelaExiste("recuperacao_senhas"))) {
            return res.status(500).json({ erro: "Tabela de recuperacao de senha ausente. Rode o SQL informado." });
        }

        const usuario = usuarios[0];
        const token = crypto.randomBytes(32).toString("hex");
        const hash = tokenHash(token);
        const link = `${APP_URL}/redefinir-senha.html?token=${token}`;

        await query(
            "INSERT INTO recuperacao_senhas (id_usuario, token_hash, expira_em) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))",
            [usuario.id_usuario, hash, RESET_TOKEN_MINUTOS]
        );

        await enviarEmailRecuperacao(usuario.email, usuario.nome, link);
        res.json(respostaGenerica);
    } catch (erro) {
        await registrarErro("recuperar-senha", erro);
        res.status(500).json({ erro: "Nao foi possivel solicitar a recuperacao agora." });
    }
});

app.post("/redefinir-senha", authLimiter, async (req, res) => {
    const { token, senha, senha2 } = req.body;
    const erroSenha = validarSenha(senha);

    if (!token) return res.status(400).json({ erro: "Token ausente." });
    if (erroSenha) return res.status(400).json({ erro: erroSenha });
    if (senha !== senha2) return res.status(400).json({ erro: "As senhas nao coincidem." });

    try {
        if (!(await tabelaExiste("recuperacao_senhas"))) {
            return res.status(500).json({ erro: "Tabela de recuperacao de senha ausente. Rode o SQL informado." });
        }

        const registros = await query(
            `SELECT r.*, u.email
             FROM recuperacao_senhas r
             INNER JOIN usuarios u ON u.id_usuario = r.id_usuario
             WHERE r.token_hash = ? AND r.usado = 0 AND r.expira_em >= NOW()
             LIMIT 1`,
            [tokenHash(token)]
        );

        if (registros.length === 0) {
            return res.status(400).json({ erro: "Link invalido ou expirado. Solicite uma nova recuperacao." });
        }

        const registro = registros[0];
        const senhaHash = await bcrypt.hash(senha, 10);

        await query("UPDATE usuarios SET senha = ? WHERE id_usuario = ?", [senhaHash, registro.id_usuario]);
        await query(
            "UPDATE recuperacao_senhas SET usado = 1, usado_em = NOW() WHERE id_recuperacao = ?",
            [registro.id_recuperacao]
        );

        res.json({ mensagem: "Senha redefinida com sucesso. Voce ja pode entrar." });
    } catch (erro) {
        await registrarErro("redefinir-senha", erro);
        res.status(500).json({ erro: "Nao foi possivel redefinir a senha agora." });
    }
});

app.get("/usuarios/:id/perfil", async (req, res) => {
    try {
        const usuarios = await query(
            "SELECT id_usuario AS id, nome, email FROM usuarios WHERE id_usuario = ?",
            [req.params.id]
        );

        if (usuarios.length === 0) return res.status(404).json({ erro: "Usuario nao encontrado." });
        res.json(usuarios[0]);
    } catch (erro) {
        await registrarErro("perfil-get", erro);
        res.status(500).json({ erro: "Erro ao carregar perfil." });
    }
});

app.put("/usuarios/:id/perfil", async (req, res) => {
    const { nome, senha, senha2 } = req.body;
    const erroNome = validarNome(nome);

    if (erroNome) return res.status(400).json({ erro: erroNome });
    if (senha || senha2) {
        const erroSenha = validarSenha(senha);
        if (erroSenha) return res.status(400).json({ erro: erroSenha });
        if (senha !== senha2) return res.status(400).json({ erro: "As senhas nao coincidem." });
    }

    try {
        const usuarios = await query("SELECT id_usuario, email FROM usuarios WHERE id_usuario = ?", [req.params.id]);
        if (usuarios.length === 0) return res.status(404).json({ erro: "Usuario nao encontrado." });

        if (senha) {
            const senhaHash = await bcrypt.hash(senha, 10);
            await query("UPDATE usuarios SET nome = ?, senha = ? WHERE id_usuario = ?", [
                nome.trim(),
                senhaHash,
                req.params.id
            ]);
        } else {
            await query("UPDATE usuarios SET nome = ? WHERE id_usuario = ?", [nome.trim(), req.params.id]);
        }

        res.json({
            mensagem: "Perfil atualizado com sucesso.",
            usuario: { id: Number(req.params.id), nome: nome.trim(), email: usuarios[0].email }
        });
    } catch (erro) {
        await registrarErro("perfil-put", erro);
        res.status(500).json({ erro: "Erro ao atualizar perfil." });
    }
});

app.get("/notificacoes/:id_usuario", async (req, res) => {
    const { id_usuario } = req.params;

    try {
        const temDataFim = await colunaExiste("tarefas", "data_fim");
        const temHoraFim = await colunaExiste("tarefas", "hora_fim");
        const campoData = temDataFim ? "COALESCE(data_fim, data_vencimento)" : "data_vencimento";
        const campoDataHora = temHoraFim
            ? `STR_TO_DATE(CONCAT(${campoData}, ' ', COALESCE(hora_fim, '23:59:59')), '%Y-%m-%d %H:%i:%s')`
            : `STR_TO_DATE(CONCAT(${campoData}, ' 23:59:59'), '%Y-%m-%d %H:%i:%s')`;

        const tarefas = await query(
            `SELECT id_tarefa, titulo, ${campoData} AS data_prazo
             FROM tarefas
             WHERE id_usuario = ?
                AND status NOT IN ('concluida', 'concluido')
                AND ${campoData} IS NOT NULL
                AND ${campoDataHora} BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 24 HOUR)
             ORDER BY ${campoDataHora} ASC`,
            [id_usuario]
        );

        res.json(tarefas);
    } catch (erro) {
        await registrarErro("notificacoes", erro);
        res.status(500).json({ erro: "Erro ao carregar notificacoes." });
    }
});

app.get("/historico/:id_usuario", async (req, res) => {
    const { id_usuario } = req.params;
    const pagina = Math.max(Number(req.query.pagina || 1), 1);
    const porPagina = Math.min(Math.max(Number(req.query.por_pagina || 10), 1), 30);
    const offset = (pagina - 1) * porPagina;

    try {
        if (!(await tabelaExiste("historico_atividades"))) {
            return res.json({ itens: [], paginacao: { pagina, por_pagina: porPagina, total: 0, total_paginas: 0 } });
        }

        const temSituacao = await colunaExiste("historico_atividades", "situacao");
        const temSnapshot = await colunaExiste("historico_atividades", "tarefa_snapshot");
        const temRestauradoEm = await colunaExiste("historico_atividades", "restaurado_em");
        const colunasExtras = [
            temSituacao ? "situacao" : "NULL AS situacao",
            temSnapshot ? "tarefa_snapshot" : "NULL AS tarefa_snapshot",
            temRestauradoEm ? "restaurado_em" : "NULL AS restaurado_em"
        ].join(", ");

        const totalResultado = await query(
            "SELECT COUNT(*) AS total FROM historico_atividades WHERE id_usuario = ?",
            [id_usuario]
        );

        const historico = await query(
            `SELECT id_historico, id_tarefa, tipo_acao, descricao, criado_em, ${colunasExtras}
             FROM historico_atividades
             WHERE id_usuario = ?
             ORDER BY criado_em DESC
             LIMIT ? OFFSET ?`,
            [id_usuario, porPagina, offset]
        );

        const total = totalResultado[0].total;
        res.json({
            itens: historico,
            paginacao: {
                pagina,
                por_pagina: porPagina,
                total,
                total_paginas: Math.ceil(total / porPagina)
            }
        });
    } catch (erro) {
        await registrarErro("historico-get", erro);
        res.status(500).json({ erro: "Erro ao carregar historico." });
    }
});

app.put("/historico/:id/situacao", async (req, res) => {
    const { id } = req.params;
    const { id_usuario, situacao } = req.body;

    if (!id_usuario) return res.status(400).json({ erro: "Usuário não informado." });

    try {
        if (!(await colunaExiste("historico_atividades", "situacao"))) {
            return res.status(400).json({ erro: "Rode o SQL de atualização para salvar situações no histórico." });
        }

        const historico = await query(
            "SELECT id_historico FROM historico_atividades WHERE id_historico = ? AND id_usuario = ?",
            [id, id_usuario]
        );
        if (historico.length === 0) return res.status(404).json({ erro: "Registro de histórico não encontrado." });

        await query(
            "UPDATE historico_atividades SET situacao = ? WHERE id_historico = ? AND id_usuario = ?",
            [situacao ? situacao.trim() : null, id, id_usuario]
        );

        res.json({ mensagem: "Situação salva no histórico." });
    } catch (erro) {
        await registrarErro("historico-situacao", erro);
        res.status(500).json({ erro: "Erro ao salvar situação." });
    }
});

app.post("/historico/:id/restaurar", async (req, res) => {
    const { id } = req.params;
    const { id_usuario } = req.body;

    if (!id_usuario) return res.status(400).json({ erro: "Usuário não informado." });

    try {
        if (!(await colunaExiste("historico_atividades", "tarefa_snapshot"))) {
            return res.status(400).json({ erro: "Rode o SQL de atualização para restaurar tarefas excluídas." });
        }

        const temRestauradoEm = await colunaExiste("historico_atividades", "restaurado_em");
        const restauradoSelect = temRestauradoEm ? "restaurado_em" : "NULL AS restaurado_em";
        const registros = await query(
            `SELECT id_historico, tipo_acao, descricao, tarefa_snapshot, ${restauradoSelect}
             FROM historico_atividades
             WHERE id_historico = ? AND id_usuario = ?`,
            [id, id_usuario]
        );

        if (registros.length === 0) return res.status(404).json({ erro: "Registro de histórico não encontrado." });

        const registro = registros[0];
        if (registro.tipo_acao !== "exclusao") return res.status(400).json({ erro: "Apenas tarefas excluídas podem ser restauradas." });
        if (registro.restaurado_em) return res.status(400).json({ erro: "Essa tarefa já foi restaurada." });
        if (!registro.tarefa_snapshot) return res.status(400).json({ erro: "Este histórico não possui dados suficientes para restaurar." });



        console.log("TIPO:", typeof registro.tarefa_snapshot);
        console.log("SNAPSHOT:", registro.tarefa_snapshot);

        let snapshot;

        if (typeof registro.tarefa_snapshot === "string") {
            snapshot = JSON.parse(registro.tarefa_snapshot);
        } else {
            snapshot = registro.tarefa_snapshot;
        }


        const { colunas, valores } = await prepararSnapshotParaRestaurar(snapshot, id_usuario);
        const placeholders = colunas.map(() => "?").join(", ");
        const resultado = await query(
            `INSERT INTO tarefas (${colunas.join(", ")}) VALUES (${placeholders})`,
            valores
        );

        if (temRestauradoEm) {
            await query("UPDATE historico_atividades SET restaurado_em = NOW() WHERE id_historico = ?", [id]);
        }

        await registrarHistorico(id_usuario, "restauracao", resultado.insertId, `Tarefa restaurada: ${snapshot.titulo || "sem título"}`);
        res.json({ mensagem: "Tarefa restaurada com sucesso.", id_tarefa: resultado.insertId });
    } catch (erro) {
        await registrarErro("historico-restaurar", erro);
        res.status(500).json({ erro: "Erro ao restaurar tarefa." });
    }
});

app.post("/tarefas", async (req, res) => {
    const { titulo, descricao, prioridade, status, id_usuario } = req.body;
    const periodo = dadosPeriodo(req.body);
    const statusNormalizado = normalizarStatus(status);
    const prioridadeNormalizada = prioridade || "baixa";

    if (!id_usuario) return res.status(400).json({ erro: "Usuário não informado." });
    if (!titulo || !titulo.trim()) return res.status(400).json({ erro: "Título é obrigatório." });
    if (!STATUS_VALIDOS.includes(statusNormalizado)) return res.status(400).json({ erro: "Status inválido." });
    if (!PRIORIDADES_VALIDAS.includes(prioridadeNormalizada)) return res.status(400).json({ erro: "Prioridade inválida." });

    const erroPeriodo = validarPeriodo(
        periodo.dataInicio,
        periodo.dataFim,
        periodo.horaInicio,
        periodo.horaFim,
        periodo.diaInteiro
    );
    if (erroPeriodo) return res.status(400).json({ erro: erroPeriodo });

    const erroLembrete = validarLembrete(req.body, periodo);
    if (erroLembrete) return res.status(400).json({ erro: erroLembrete });

    try {
        const colunas = ["titulo", "descricao", "data_vencimento", "prioridade", "status", "id_usuario"];
        const valores = [
            titulo.trim(),
            descricao ? descricao.trim() : null,
            periodo.dataFim,
            prioridadeNormalizada,
            statusParaBanco(statusNormalizado),
            id_usuario
        ];

        await aplicarCamposOpcionais(colunas, valores, req.body);

        const placeholders = colunas.map(() => "?").join(", ");
        const resultado = await query(
            `INSERT INTO tarefas (${colunas.join(", ")}) VALUES (${placeholders})`,
            valores
        );

        const tarefas = await query("SELECT * FROM tarefas WHERE id_tarefa = ?", [resultado.insertId]);
        await registrarHistorico(id_usuario, "criacao", resultado.insertId, `Tarefa criada: ${titulo.trim()}`);
        res.status(201).json({ mensagem: "Tarefa criada com sucesso.", tarefa: tarefas[0] });
    } catch (erro) {
        await registrarErro("tarefas-post", erro);
        res.status(500).json({ erro: "Erro ao criar tarefa." });
    }
});

app.get("/tarefas/:id_usuario", async (req, res) => {
    const { id_usuario } = req.params;

    try {
        const { where, params } = await montarFiltrosTarefas(id_usuario, req.query);
        const temDataFim = await colunaExiste("tarefas", "data_fim");
        const ordemPrazo = temDataFim
            ? "COALESCE(data_fim, data_vencimento, '9999-12-31')"
            : "COALESCE(data_vencimento, '9999-12-31')";
        const tarefas = await query(
            `SELECT *
             FROM tarefas
             WHERE ${where.join(" AND ")}
             ORDER BY
                FIELD(status, 'pendente', 'em andamento', 'concluido', 'concluida'),
                ${ordemPrazo},
                id_tarefa DESC`,
            params
        );

        res.json(tarefas);
    } catch (erro) {
        console.error("Erro ao listar tarefas:", erro);
        res.status(500).json({ erro: "Erro ao obter tarefas." });
    }
});

async function atualizarTarefa(req, res) {
    const { id } = req.params;
    const { titulo, descricao, prioridade, status, id_usuario } = req.body;
    const periodo = dadosPeriodo(req.body);
    const prioridadeNormalizada = prioridade || "baixa";

    if (!id_usuario) return res.status(400).json({ erro: "Usuário não informado." });

    if (!titulo && status && Object.keys(req.body).every((campo) => ["status", "id_usuario"].includes(campo))) {
        req.params.id = id;
        return atualizarStatus(req, res);
    }

    if (!titulo || !titulo.trim()) return res.status(400).json({ erro: "Título é obrigatório." });
    if (!PRIORIDADES_VALIDAS.includes(prioridadeNormalizada)) return res.status(400).json({ erro: "Prioridade inválida." });

    const erroPeriodo = validarPeriodo(
        periodo.dataInicio,
        periodo.dataFim,
        periodo.horaInicio,
        periodo.horaFim,
        periodo.diaInteiro
    );
    if (erroPeriodo) return res.status(400).json({ erro: erroPeriodo });

    const erroLembrete = validarLembrete(req.body, periodo);
    if (erroLembrete) return res.status(400).json({ erro: erroLembrete });

    try {
        const tarefa = await buscarTarefaDoUsuario(id, id_usuario);
        if (!tarefa) return res.status(404).json({ erro: "Tarefa não encontrada para este usuário." });

        const statusNormalizado = status ? normalizarStatus(status) : normalizarStatus(tarefa.status);
        if (!STATUS_VALIDOS.includes(statusNormalizado)) return res.status(400).json({ erro: "Status inválido." });

        const sets = [
            "titulo = ?",
            "descricao = ?",
            "data_vencimento = ?",
            "prioridade = ?",
            "status = ?"
        ];
        const params = [
            titulo.trim(),
            descricao ? descricao.trim() : null,
            periodo.dataFim,
            prioridadeNormalizada,
            statusParaBanco(statusNormalizado)
        ];

        await aplicarSetsOpcionais(sets, params, req.body);

        if (await colunaExiste("tarefas", "data_conclusao")) {
            sets.push("data_conclusao = CASE WHEN ? = 'concluido' THEN COALESCE(data_conclusao, NOW()) ELSE NULL END");
            params.push(statusNormalizado);
        }

        params.push(id, id_usuario);

        await query(
            `UPDATE tarefas SET ${sets.join(", ")} WHERE id_tarefa = ? AND id_usuario = ?`,
            params
        );

        const atualizadas = await query("SELECT * FROM tarefas WHERE id_tarefa = ?", [id]);
        const concluiuAgora = statusNormalizado === "concluido" && normalizarStatus(tarefa.status) !== "concluido";
        await registrarHistorico(
            id_usuario,
            concluiuAgora ? "conclusao" : "edicao",
            id,
            concluiuAgora ? `Tarefa concluida em ${new Date().toLocaleString("pt-BR")}: ${titulo.trim()}` : `Tarefa editada: ${titulo.trim()}`,
            concluiuAgora ? { situacao: req.body.situacao_conclusao || null } : {}
        );
        res.json({ mensagem: "Tarefa atualizada com sucesso.", tarefa: atualizadas[0] });
    } catch (erro) {
        await registrarErro("tarefas-put", erro);
        res.status(500).json({ erro: "Erro ao atualizar tarefa." });
    }
}

app.put("/tarefas/:id", atualizarTarefa);
app.put("/tarefas/:id/editar", atualizarTarefa);

async function atualizarStatus(req, res) {
    const { id } = req.params;
    const { status, id_usuario, id_lista } = req.body;
    const statusNormalizado = normalizarStatus(status);

    if (!id_usuario) return res.status(400).json({ erro: "Usuário não informado." });
    if (!STATUS_VALIDOS.includes(statusNormalizado)) return res.status(400).json({ erro: "Status inválido." });

    try {
        const tarefa = await buscarTarefaDoUsuario(id, id_usuario);
        if (!tarefa) return res.status(404).json({ erro: "Tarefa não encontrada para este usuário." });

        const sets = ["status = ?"];
        const params = [statusParaBanco(statusNormalizado)];

        if ((await colunaExiste("tarefas", "id_lista")) && id_lista !== undefined) {
            sets.push("id_lista = ?");
            params.push(id_lista || null);
        }

        if (await colunaExiste("tarefas", "data_conclusao")) {
            sets.push("data_conclusao = CASE WHEN ? = 'concluido' THEN COALESCE(data_conclusao, NOW()) ELSE NULL END");
            params.push(statusNormalizado);
        }

        params.push(id, id_usuario);

        await query(
            `UPDATE tarefas SET ${sets.join(", ")} WHERE id_tarefa = ? AND id_usuario = ?`,
            params
        );

        const concluiuAgora = statusNormalizado === "concluido" && normalizarStatus(tarefa.status) !== "concluido";
        await registrarHistorico(
            id_usuario,
            concluiuAgora ? "conclusao" : "status",
            id,
            concluiuAgora ? `Tarefa concluida em ${new Date().toLocaleString("pt-BR")}: ${tarefa.titulo}` : `Status alterado para ${statusNormalizado}: ${tarefa.titulo}`,
            concluiuAgora ? { situacao: req.body.situacao_conclusao || null } : {}
        );
        res.json({ mensagem: "Status atualizado com sucesso." });
    } catch (erro) {
        await registrarErro("tarefas-status", erro);
        res.status(500).json({ erro: "Erro ao atualizar status." });
    }
}

app.patch("/tarefas/:id/status", atualizarStatus);

app.delete("/tarefas/:id", async (req, res) => {
    const { id } = req.params;
    const idUsuario = req.body.id_usuario || req.query.id_usuario;

    if (!idUsuario) return res.status(400).json({ erro: "Usuário não informado." });

    try {
        const tarefa = await buscarTarefaDoUsuario(id, idUsuario);
        if (!tarefa) return res.status(404).json({ erro: "Tarefa não encontrada para este usuário." });

        await registrarHistorico(idUsuario, "exclusao", id, `Tarefa excluida: ${tarefa.titulo}`, { tarefaSnapshot: tarefa });
        await query("DELETE FROM tarefas WHERE id_tarefa = ? AND id_usuario = ?", [id, idUsuario]);
        res.json({ mensagem: "Tarefa excluída com sucesso." });
    } catch (erro) {
        await registrarErro("tarefas-delete", erro);
        res.status(500).json({ erro: "Erro ao excluir tarefa." });
    }
});

app.post("/listas", async (req, res) => {
    const { nome, id_usuario, cor } = req.body;

    if (!id_usuario) return res.status(400).json({ erro: "Usuário não informado." });
    if (!nome || !nome.trim()) return res.status(400).json({ erro: "Nome do quadro é obrigatório." });

    try {
        if (!(await tabelaExiste("listas"))) {
            return res.status(500).json({ erro: "A tabela de quadros ainda não existe. Rode o SQL informado no projeto." });
        }

        const extras = await colunasLista();
        const colunas = ["nome", "id_usuario"];
        const valores = [nome.trim(), id_usuario];

        if (extras.cor) {
            colunas.push("cor");
            valores.push(cor || "#7c3aed");
        }

        if (extras.ordem) {
            const ordem = await query("SELECT COALESCE(MAX(ordem), 0) + 1 AS proxima FROM listas WHERE id_usuario = ?", [id_usuario]);
            colunas.push("ordem");
            valores.push(ordem[0].proxima);
        }

        const placeholders = colunas.map(() => "?").join(", ");
        const resultado = await query(
            `INSERT INTO listas (${colunas.join(", ")}) VALUES (${placeholders})`,
            valores
        );

        res.status(201).json({
            mensagem: "Quadro criado com sucesso.",
            lista: { id_lista: resultado.insertId, nome: nome.trim(), id_usuario, cor: cor || "#7c3aed" }
        });
    } catch (erro) {
        console.error("Erro ao criar quadro:", erro);
        res.status(500).json({ erro: "Erro ao criar quadro." });
    }
});

app.get("/listas/:id_usuario", async (req, res) => {
    const { id_usuario } = req.params;

    try {
        if (!(await tabelaExiste("listas"))) return res.json([]);

        const extras = await colunasLista();
        const orderBy = extras.ordem ? "ordem ASC, id_lista ASC" : "id_lista ASC";
        const listas = await query(`SELECT * FROM listas WHERE id_usuario = ? ORDER BY ${orderBy}`, [id_usuario]);

        res.json(listas);
    } catch (erro) {
        console.error("Erro ao buscar quadros:", erro);
        res.status(500).json({ erro: "Erro ao buscar quadros." });
    }
});

app.put("/listas/:id", async (req, res) => {
    const { id } = req.params;
    const { nome, cor, id_usuario } = req.body;

    if (!id_usuario) return res.status(400).json({ erro: "Usuário não informado." });
    if (!nome || !nome.trim()) return res.status(400).json({ erro: "Nome do quadro é obrigatório." });

    try {
        const lista = await query("SELECT * FROM listas WHERE id_lista = ? AND id_usuario = ?", [id, id_usuario]);
        if (lista.length === 0) return res.status(404).json({ erro: "Quadro não encontrado." });

        const extras = await colunasLista();
        const sets = ["nome = ?"];
        const params = [nome.trim()];

        if (extras.cor) {
            sets.push("cor = ?");
            params.push(cor || "#7c3aed");
        }

        params.push(id, id_usuario);
        await query(`UPDATE listas SET ${sets.join(", ")} WHERE id_lista = ? AND id_usuario = ?`, params);

        res.json({ mensagem: "Quadro atualizado com sucesso." });
    } catch (erro) {
        console.error("Erro ao atualizar quadro:", erro);
        res.status(500).json({ erro: "Erro ao atualizar quadro." });
    }
});

app.patch("/listas/:id/mover", async (req, res) => {
    const { id } = req.params;
    const { direcao, id_usuario } = req.body;

    if (!id_usuario) return res.status(400).json({ erro: "Usuário não informado." });
    if (!["esquerda", "direita"].includes(direcao)) return res.status(400).json({ erro: "Direção inválida." });

    try {
        const extras = await colunasLista();
        if (!extras.ordem) return res.json({ mensagem: "Ordem visual mantida. Rode o SQL para persistir reordenação." });

        const listas = await query(
            "SELECT id_lista, ordem FROM listas WHERE id_usuario = ? ORDER BY ordem ASC, id_lista ASC",
            [id_usuario]
        );
        const atualIndex = listas.findIndex((lista) => String(lista.id_lista) === String(id));
        const alvoIndex = direcao === "esquerda" ? atualIndex - 1 : atualIndex + 1;

        if (atualIndex < 0) return res.status(404).json({ erro: "Quadro não encontrado." });
        if (alvoIndex < 0 || alvoIndex >= listas.length) return res.json({ mensagem: "Quadro já está no limite." });

        const atual = listas[atualIndex];
        const alvo = listas[alvoIndex];

        await query("UPDATE listas SET ordem = ? WHERE id_lista = ? AND id_usuario = ?", [alvo.ordem, atual.id_lista, id_usuario]);
        await query("UPDATE listas SET ordem = ? WHERE id_lista = ? AND id_usuario = ?", [atual.ordem, alvo.id_lista, id_usuario]);

        res.json({ mensagem: "Quadro movido com sucesso." });
    } catch (erro) {
        console.error("Erro ao mover quadro:", erro);
        res.status(500).json({ erro: "Erro ao mover quadro." });
    }
});

app.delete("/listas/:id", async (req, res) => {
    const { id } = req.params;
    const idUsuario = req.body.id_usuario || req.query.id_usuario;

    if (!idUsuario) return res.status(400).json({ erro: "Usuário não informado." });

    try {
        const lista = await query("SELECT * FROM listas WHERE id_lista = ? AND id_usuario = ?", [id, idUsuario]);
        if (lista.length === 0) return res.status(404).json({ erro: "Quadro não encontrado." });

        if (await colunaExiste("tarefas", "id_lista")) {
            await query("UPDATE tarefas SET id_lista = NULL WHERE id_lista = ? AND id_usuario = ?", [id, idUsuario]);
        }

        await query("DELETE FROM listas WHERE id_lista = ? AND id_usuario = ?", [id, idUsuario]);
        res.json({ mensagem: "Quadro excluído. As tarefas voltaram para as colunas padrão." });
    } catch (erro) {
        console.error("Erro ao excluir quadro:", erro);
        res.status(500).json({ erro: "Erro ao excluir quadro." });
    }
});

app.put("/tarefas/:id/mover", async (req, res) => {
    const { id } = req.params;
    const { id_lista, id_usuario } = req.body;

    if (!id_usuario) return res.status(400).json({ erro: "Usuário não informado." });

    try {
        const tarefa = await buscarTarefaDoUsuario(id, id_usuario);
        if (!tarefa) return res.status(404).json({ erro: "Tarefa não encontrada para este usuário." });

        await query(
            "UPDATE tarefas SET id_lista = ? WHERE id_tarefa = ? AND id_usuario = ?",
            [id_lista || null, id, id_usuario]
        );

        res.json({ mensagem: "Tarefa movida de quadro." });
    } catch (erro) {
        console.error("Erro ao mover tarefa:", erro);
        res.status(500).json({ erro: "Erro ao mover tarefa." });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    iniciarVerificadorDeLembretes();
});
