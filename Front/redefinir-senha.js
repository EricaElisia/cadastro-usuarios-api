const API_URL = "http://localhost:3000";

const form = document.getElementById("resetForm");
const mensagem = document.getElementById("mensagem");
const token = new URLSearchParams(window.location.search).get("token");

function mostrarMensagem(texto, tipo) {
    mensagem.textContent = texto;
    mensagem.className = `form-message ${tipo}`;
}

if (!token) {
    mostrarMensagem("Link invalido ou sem token. Solicite uma nova recuperacao.", "error");
    form.querySelector("button[type='submit']").disabled = true;
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const senha = document.getElementById("senha").value;
    const senha2 = document.getElementById("senha2").value;
    const submitButton = form.querySelector("button[type='submit']");

    if (senha.length < 8) {
        mostrarMensagem("A senha precisa ter no minimo 8 caracteres.", "error");
        return;
    }

    if (senha !== senha2) {
        mostrarMensagem("As senhas nao coincidem.", "error");
        return;
    }

    try {
        submitButton.disabled = true;
        submitButton.textContent = "Salvando...";
        mostrarMensagem("", "");

        const resposta = await fetch(`${API_URL}/redefinir-senha`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, senha, senha2 })
        });
        const dados = await resposta.json();

        if (!resposta.ok) {
            mostrarMensagem(dados.erro || "Nao foi possivel redefinir a senha.", "error");
            return;
        }

        mostrarMensagem(dados.mensagem, "success");
        setTimeout(() => {
            window.location.href = "login.html";
        }, 1800);
    } catch (erro) {
        mostrarMensagem("Nao foi possivel conectar ao servidor.", "error");
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = "Redefinir senha";
    }
});
