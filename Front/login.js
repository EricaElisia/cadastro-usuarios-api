const API_URL = "http://localhost:3000";

const form = document.getElementById("formLogin");
const mensagem = document.getElementById("mensagem");

function mostrarMensagem(texto, tipo) {
    mensagem.textContent = texto;
    mensagem.className = `form-message ${tipo}`;
}

const mensagemSessao = sessionStorage.getItem("loginMessage");
if (mensagemSessao) {
    mostrarMensagem(mensagemSessao, "error");
    sessionStorage.removeItem("loginMessage");
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const submitButton = form.querySelector("button[type='submit']");
    const email = document.getElementById("email").value.trim();
    const senha = document.getElementById("senha").value;

    if (!email || !senha) {
        mostrarMensagem("Informe e-mail e senha para entrar.", "error");
        return;
    }

    try {
        submitButton.disabled = true;
        submitButton.textContent = "Entrando...";
        mostrarMensagem("", "");

        const resposta = await fetch(`${API_URL}/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, senha })
        });

        const dados = await resposta.json();

        if (!resposta.ok || !dados.usuario) {
            mostrarMensagem(dados.erro || "Não foi possível fazer login.", "error");
            return;
        }

        localStorage.setItem("usuario", JSON.stringify(dados.usuario));
        localStorage.setItem("ultimaAtividade", String(Date.now()));
        mostrarMensagem(dados.mensagem || "Login realizado com sucesso.", "success");
        window.location.href = "dashboard.html";
    } catch (erro) {
        mostrarMensagem("Não foi possível conectar ao servidor.", "error");
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = "Entrar";
    }
});
