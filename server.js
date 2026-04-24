const express = require("express");
const cors = require("cors");
const db = require("./db");
const bcrypt = require("bcrypt");

const app = express();

app.use(express.json());
app.use(cors());

app.get("/", (req, res) => {
    res.send("API de cadastro funcionando!");
});

// ROTA DE CADASTRO
app.post("/cadastro", async (req, res) => {
    const { nome, email, senha, senha2 } = req.body;

    // Valida campos obrigatórios
    if (!nome || !email || !senha || !senha2) {
        return res.status(400).json({ erro: "Todos os campos são obrigatórios" });
    }

    // Valida formato de email
    const emailRegex = /\S+@\S+\.\S+/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ erro: "Formato de e-mail inválido" });
    }

    // Valida tamanho da senha
    if (senha.length < 8) {
        return res.status(400).json({ erro: "Senha deve ter no mínimo 8 caracteres" });
    }

    if (senha !== senha2) {
        return res.status(400).json({ erro: "Senhas não coincidem" });
    }

    try {
        // Verificar se email já existe
        const verificarEmail = "SELECT * FROM usuarios WHERE email = ?";
        db.query(verificarEmail, [email], async (erro, resultado) => {
            if (erro) {
                return res.status(500).json({ erro: "Erro ao verificar e-mail" });
            }

            if (resultado.length > 0) {
                return res.status(400).json({ erro: "E-mail já cadastrado" });
            }

            // Criptografar senha
            const senhaHash = await bcrypt.hash(senha, 10);

            const sql = "INSERT INTO usuarios (nome, email, senha, status) VALUES (?, ?, ?, 'ativo')";
            db.query(sql, [nome, email, senhaHash], (erro, resultado) => {
                if (erro) {
                    console.error(erro);
                    return res.status(500).json({ erro: "Erro ao cadastrar usuário" });
                }
                res.json({ mensagem: "Usuário cadastrado com sucesso" });
            });
        });
    } catch (erro) {
        res.status(500).json({ erro: "Erro interno do servidor" });
    }
});

// ROTA DE LOGIN
app.post("/login", (req, res) => {
    const { email, senha } = req.body;

    // Valida campos
    if (!email || !senha) {
        return res.status(400).json({ erro: "Preencha todos os campos" });
    }

    const sql = "SELECT * FROM usuarios WHERE email = ?";
    db.query(sql, [email], async (erro, resultado) => {
        if (erro) {
            return res.status(500).json({ erro: "Erro no servidor" });
        }

        if (resultado.length === 0) {
            return res.status(400).json({ erro: "E-mail ou senha inválidos" });
        }

        const usuario = resultado[0];
        const senhaValida = await bcrypt.compare(senha, usuario.senha);

        if (!senhaValida) {
            return res.status(400).json({ erro: "E-mail ou senha inválidos" });
        }

        res.json({
            mensagem: "Login realizado com sucesso",
            usuario: {
                id: usuario.id_usuario, // Verifique o nome do campo
                nome: usuario.nome,
                email: usuario.email
            }
        });
    });
});

// ROTA PARA ADICIONAR TAREFA
app.post("/tarefas", (req, res) => {

    console.log("BODY:", req.body)

    const { titulo, descricao, data, prioridade, status, id_usuario } = req.body;

    if (!titulo) {
        return res.status(400).json({ erro: "Título é obrigatório" });
    }

    // 🔥 VALIDAÇÃO NO BACK (permite hoje)
    if (data) {
        const hoje = new Date().toLocaleDateString('en-CA')

        if (data < hoje) {
            return res.status(400).json({ erro: "Data de vencimento inválida" });
        }
    }

    const sql = `
        INSERT INTO tarefas 
        (titulo, descricao, data_vencimento, prioridade, status, id_usuario)
        VALUES (?, ?, ?, ?, ?, ?)
    `;

    db.query(
        sql,
        [
            titulo,
            descricao || null,
            data || null,
            prioridade || null,
            status || "pendente",
            id_usuario
        ],
        (erro) => {
            if (erro) {
                console.error("ERRO INSERT:", erro)
                return res.status(500).json({ erro: "Erro ao adicionar tarefa" });
            }

            res.json({ mensagem: "Tarefa criada com sucesso" });
        }
    );
});

// ROTA PARA OBTER TAREFAS
app.get("/tarefas/:id_usuario", (req, res) => {
    const { id_usuario } = req.params;

    const sql = "SELECT * FROM tarefas WHERE id_usuario = ?";

    db.query(sql, [id_usuario], (erro, resultado) => {
        if (erro) {
            return res.status(500).json({ erro: "Erro ao obter tarefas" });
        }

        res.json(resultado);
    });
});

// Iniciar o servidor
app.listen(3000, () => {
    console.log("Servidor rodando na porta 3000");
});

app.put("/tarefas/:id", (req, res) => {
    const { status, id_usuario } = req.body;
    const { id } = req.params;

    if (!status) {
        return res.status(400).json({ erro: "Status é obrigatório" });
    }

    // 🔍 BUSCAR TAREFA
    const buscar = "SELECT * FROM tarefas WHERE id_tarefa = ?";

    db.query(buscar, [id], (erro, resultado) => {
        if (erro) {
            return res.status(500).json({ erro: "Erro ao buscar tarefa" });
        }

        if (resultado.length === 0) {
            return res.status(404).json({ erro: "Tarefa não encontrada" });
        }

        const tarefa = resultado[0];

        // 🔒 VALIDA DONO
        if (tarefa.id_usuario !== id_usuario) {
            return res.status(403).json({ erro: "Sem permissão" });
        }

        // 🔄 ATUALIZA STATUS
        const sql = "UPDATE tarefas SET status = ? WHERE id_tarefa = ?";

        db.query(sql, [status, id], (erro, resultado) => {
            if (erro) {
                return res.status(500).json({ erro: "Erro ao atualizar status" });
            }

            res.json({ mensagem: "Status atualizado com sucesso" });
        });
    });
});

app.put("/tarefas/:id/editar", (req, res) => {
    const { id } = req.params;
    const { titulo, descricao, data, prioridade, id_usuario } = req.body;

    if (!titulo) {
        return res.status(400).json({ erro: "Título é obrigatório" });
    }

    if (data) {
        const hoje = new Date().toLocaleDateString('en-CA');
        if (data < hoje) {
            return res.status(400).json({ erro: "Data inválida" });
        }
    }

    const buscar = "SELECT * FROM tarefas WHERE id_tarefa = ?";

    db.query(buscar, [id], (erro, resultado) => {
        if (erro) {
            return res.status(500).json({ erro: "Erro ao buscar tarefa" });
        }

        if (resultado.length === 0) {
            return res.status(404).json({ erro: "Tarefa não encontrada" });
        }

        const tarefa = resultado[0];

        // 🔒 VERIFICA DONO
        if (tarefa.id_usuario !== id_usuario) {
            return res.status(403).json({ erro: "Sem permissão" });
        }

        const sql = `
            UPDATE tarefas 
            SET titulo = ?, descricao = ?, data_vencimento = ?, prioridade = ?
            WHERE id_tarefa = ?
        `;

        db.query(
            sql,
            [
                titulo,
                descricao || null,
                data || null,
                prioridade || null,
                id
            ],
            (erro) => {
                if (erro) {
                    return res.status(500).json({ erro: "Erro ao atualizar tarefa" });
                }

                res.json({ mensagem: "Tarefa atualizada com sucesso" });
            }
        );
    });
});

app.delete("/tarefas/:id", (req, res) => {

    const { id } = req.params
    const { id_usuario } = req.body

    const buscar = "SELECT * FROM tarefas WHERE id_tarefa = ?"

    db.query(buscar, [id], (erro, resultado) => {

        if (erro) {
            return res.status(500).json({ erro: "Erro ao buscar tarefa" })
        }

        if (resultado.length === 0) {
            return res.status(404).json({ erro: "Tarefa não encontrada" })
        }

        const tarefa = resultado[0]

        // 🔒 VERIFICA SE É DONO
        if (tarefa.id_usuario !== id_usuario) {
            return res.status(403).json({ erro: "Sem permissão" })
        }

        const sql = "DELETE FROM tarefas WHERE id_tarefa = ?"

        db.query(sql, [id], (erro) => {

            if (erro) {
                return res.status(500).json({ erro: "Erro ao excluir tarefa" })
            }

            res.json({ mensagem: "Tarefa excluída com sucesso" })
        })
    })
})

app.post("/listas", (req, res) => {
    const { nome, id_usuario } = req.body;

    if (!nome) {
        return res.status(400).json({ erro: "Nome da lista é obrigatório" });
    }

    const sql = "INSERT INTO listas (nome, id_usuario) VALUES (?, ?)";

    db.query(sql, [nome, id_usuario], (erro) => {
        if (erro) {
            return res.status(500).json({ erro: "Erro ao criar lista" });
        }

        res.json({ mensagem: "Lista criada com sucesso" });
    });
});

app.get("/listas/:id_usuario", (req, res) => {
    const { id_usuario } = req.params;

    const sql = "SELECT * FROM listas WHERE id_usuario = ?";

    db.query(sql, [id_usuario], (erro, resultado) => {
        if (erro) {
            return res.status(500).json({ erro: "Erro ao buscar listas" });
        }

        res.json(resultado);
    });
});

app.put("/tarefas/:id/mover", (req, res) => {
    const { id } = req.params;
    const { id_lista, id_usuario } = req.body;

    const buscar = "SELECT * FROM tarefas WHERE id_tarefa = ?";

    db.query(buscar, [id], (erro, resultado) => {
        if (erro) return res.status(500).json({ erro: "Erro ao buscar tarefa" });

        if (resultado.length === 0) {
            return res.status(404).json({ erro: "Tarefa não encontrada" });
        }

        const tarefa = resultado[0];

        if (tarefa.id_usuario !== id_usuario) {
            return res.status(403).json({ erro: "Sem permissão" });
        }

        const sql = "UPDATE tarefas SET id_lista = ? WHERE id_tarefa = ?";

        db.query(sql, [id_lista, id], (erro) => {
            if (erro) {
                return res.status(500).json({ erro: "Erro ao mover tarefa" });
            }

            res.json({ mensagem: "Tarefa movida de lista" });
        });
    });
});