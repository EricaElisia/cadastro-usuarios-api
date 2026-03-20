const form = document.getElementById("formCadastro")
const mensagem = document.getElementById("mensagem")

form.addEventListener("submit", async (e) => {

e.preventDefault()

const nome = document.getElementById("nome").value
const email = document.getElementById("email").value
const senha = document.getElementById("senha").value
const senha2 = document.getElementById("senha2").value

mensagem.innerText = ""

if(senha !== senha2){
mensagem.style.color = "red"
mensagem.innerText = "As senhas não coincidem"
return
}

try{

const resposta = await fetch("http://localhost:3000/cadastro",{
method: "POST",
headers:{
"Content-Type": "application/json"
},
body: JSON.stringify({ nome, email, senha, senha2 })
})

const dados = await resposta.json()

if(resposta.ok){
mensagem.style.color = "green"
mensagem.innerText = dados.mensagem
form.reset()

setTimeout(()=>{
window.location.href = "login.html"
},1000)

}else{
mensagem.style.color = "red"
mensagem.innerText = dados.erro
}

}catch(erro){

mensagem.style.color = "red"
mensagem.innerText = "Erro ao conectar com servidor"

}

})