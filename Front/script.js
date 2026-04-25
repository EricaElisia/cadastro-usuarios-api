const API_URL = "http://localhost:3000";

const form = document.getElementById("formCadastro");
const mensagem = document.getElementById("mensagem");

function mostrarMensagem(texto, tipo) {
    mensagem.textContent = texto;
    mensagem.className = `form-message ${tipo}`;
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const submitButton = form.querySelector("button[type='submit']");
    const nome = document.getElementById("nome").value.trim();
    const email = document.getElementById("email").value.trim();
    const senha = document.getElementById("senha").value;
    const senha2 = document.getElementById("senha2").value;

    if (!nome || !email || !senha || !senha2) {
        mostrarMensagem("Preencha todos os campos para continuar.", "error");
        return;
    }

    if (senha.length < 8) {
        mostrarMensagem("A senha precisa ter no mínimo 8 caracteres.", "error");
        return;
    }

    if (senha !== senha2) {
        mostrarMensagem("As senhas não coincidem.", "error");
        return;
    }

    try {
        submitButton.disabled = true;
        submitButton.textContent = "Cadastrando...";
        mostrarMensagem("", "");

        const resposta = await fetch(`${API_URL}/cadastro`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nome, email, senha, senha2 })
        });

        const dados = await resposta.json();

        if (!resposta.ok) {
            mostrarMensagem(dados.erro || "Não foi possível cadastrar.", "error");
            return;
        }

        mostrarMensagem(dados.mensagem || "Cadastro realizado com sucesso.", "success");
        form.reset();

        setTimeout(() => {
            window.location.href = "login.html";
        }, 900);
    } catch (erro) {
        mostrarMensagem("Não foi possível conectar ao servidor.", "error");
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = "Cadastrar";
    }
});
