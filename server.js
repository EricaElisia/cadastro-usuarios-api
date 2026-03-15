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

    const { nome, email, senha } = req.body;

    // valida campos obrigatórios
    if (!nome || !email || !senha) {
        return res.status(400).json({ erro: "Todos os campos são obrigatórios" });
    }

    // valida formato de email
    const emailRegex = /\S+@\S+\.\S+/;

    if (!emailRegex.test(email)) {
        return res.status(400).json({ erro: "Formato de e-mail inválido" });
    }

    // valida tamanho da senha
    if (senha.length < 8) {
        return res.status(400).json({ erro: "Senha deve ter no mínimo 8 caracteres" });
    }

    try {

        // verificar se email já existe
        const verificarEmail = "SELECT * FROM usuarios WHERE email = ?";

        db.query(verificarEmail, [email], async (erro, resultado) => {

            if (erro) {
                return res.status(500).json({ erro: "Erro ao verificar e-mail" });
            }

            if (resultado.length > 0) {
                return res.status(400).json({ erro: "E-mail já cadastrado" });
            }

            // criptografar senha
            const senhaHash = await bcrypt.hash(senha, 10);

            const sql = "INSERT INTO usuarios (nome, email, senha, status) VALUES (?, ?, ?, 'ativo')";

            db.query(sql, [nome, email, senhaHash], (erro, resultado) => {

                if (erro) {
                    return res.status(500).json({ erro: "Erro ao cadastrar usuário" });
                }

                res.json({ mensagem: "Usuário cadastrado com sucesso" });

            });

        });

    } catch (erro) {
        res.status(500).json({ erro: "Erro interno do servidor" });
    }

});


app.listen(3000, () => {
    console.log("Servidor rodando na porta 3000");
});