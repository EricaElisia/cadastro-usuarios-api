const form = document.getElementById("formLogin")
const mensagem = document.getElementById("mensagem")

form.addEventListener("submit", async (e) => {

e.preventDefault()

const email = document.getElementById("email").value
const senha = document.getElementById("senha").value

try{

const resposta = await fetch("http://localhost:3000/login",{
method:"POST",
headers:{
"Content-Type":"application/json"
},
body:JSON.stringify({email,senha})
})

const dados = await resposta.json()

console.log("RESPOSTA:", dados)

if(resposta.ok && dados.usuario){

console.log("SALVANDO:", dados.usuario)

localStorage.setItem("usuario", JSON.stringify(dados.usuario))

console.log("LOCALSTORAGE:", localStorage.getItem("usuario"))

mensagem.style.color="green"
mensagem.innerText=dados.mensagem

window.location.href="dashboard.html"

}else{

mensagem.style.color="red"
mensagem.innerText=dados.erro

}

}catch(erro){

mensagem.style.color="red"
mensagem.innerText="Erro ao conectar com servidor"

}

})