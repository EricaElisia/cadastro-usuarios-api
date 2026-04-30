const express = require("express");
const cors = require("cors");
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
const PORT = 3000;

const STATUS_VALIDOS = ["pendente", "em andamento", "concluido", "concluida"];
const PRIORIDADES_VALIDAS = ["baixa", "media", "alta"];
const colunasCache = {};
const APP_URL = process.env.APP_URL || "http://localhost:3000";
const RESET_TOKEN_MINUTOS = 15;

app.use(express.json());
app.use(cors());

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

async function registrarHistorico(idUsuario, tipo, idTarefa, descricao) {
    try {
        if (!(await tabelaExiste("historico_atividades"))) return;
        await query(
            "INSERT INTO historico_atividades (id_usuario, id_tarefa, tipo_acao, descricao) VALUES (?, ?, ?, ?)",
            [idUsuario, idTarefa || null, tipo, descricao]
        );
    } catch (erro) {
        await registrarErro("historico_atividades", erro);
    }
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

function validarSenha(senha) {
    if (!senha || senha.length < 8) return "A senha precisa ter no minimo 8 caracteres.";
    return "";
}

function validarNome(nome) {
    if (!nome || !nome.trim()) return "Nome e obrigatorio.";
    if (nome.trim().length < 3) return "Nome precisa ter pelo menos 3 caracteres.";
    return "";
}

app.get("/", (req, res) => {
    res.json({ mensagem: "API do iNota funcionando!" });
});

app.use(express.static(path.join(__dirname, "Front")));

app.post("/cadastro", async (req, res) => {
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

app.post("/login", async (req, res) => {
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

app.post("/recuperar-senha", async (req, res) => {
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

app.post("/redefinir-senha", async (req, res) => {
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

    try {
        if (!(await tabelaExiste("historico_atividades"))) return res.json([]);

        const historico = await query(
            `SELECT id_historico, id_tarefa, tipo_acao, descricao, criado_em
             FROM historico_atividades
             WHERE id_usuario = ?
             ORDER BY criado_em DESC
             LIMIT 80`,
            [id_usuario]
        );

        res.json(historico);
    } catch (erro) {
        await registrarErro("historico-get", erro);
        res.status(500).json({ erro: "Erro ao carregar historico." });
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
            concluiuAgora ? `Tarefa concluida: ${titulo.trim()}` : `Tarefa editada: ${titulo.trim()}`
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
            concluiuAgora ? `Tarefa concluida: ${tarefa.titulo}` : `Status alterado para ${statusNormalizado}: ${tarefa.titulo}`
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

        await query("DELETE FROM tarefas WHERE id_tarefa = ? AND id_usuario = ?", [id, idUsuario]);
        await registrarHistorico(idUsuario, "exclusao", null, `Tarefa excluida: ${tarefa.titulo}`);
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
});
