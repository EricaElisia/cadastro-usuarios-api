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

if(resposta.ok){
mensagem.style.color="green"
mensagem.innerText=dados.mensagem

setTimeout(()=>{
window.location.href="dashboard.html"
},1000)

}else{
mensagem.style.color="red"
mensagem.innerText=dados.erro
}

}catch(erro){

mensagem.style.color="red"
mensagem.innerText="Erro ao conectar com servidor"

}

})