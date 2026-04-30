const API_URL = "http://localhost:3000";

const form = document.getElementById("recoverForm");
const mensagem = document.getElementById("mensagem");

function mostrarMensagem(texto, tipo) {
    mensagem.textContent = texto;
    mensagem.className = `form-message ${tipo}`;
}

form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = document.getElementById("email").value.trim();
    const submitButton = form.querySelector("button[type='submit']");

    if (!email) {
        mostrarMensagem("Informe o e-mail cadastrado.", "error");
        return;
    }

    try {
        submitButton.disabled = true;
        submitButton.textContent = "Enviando...";
        mostrarMensagem("", "");

        const resposta = await fetch(`${API_URL}/recuperar-senha`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email })
        });
        const dados = await resposta.json();

        if (!resposta.ok) {
            mostrarMensagem(dados.erro || "Nao foi possivel solicitar a recuperacao.", "error");
            return;
        }

        mostrarMensagem(dados.mensagem, "success");
    } catch (erro) {
        mostrarMensagem("Nao foi possivel conectar ao servidor.", "error");
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = "Enviar link";
    }
});
