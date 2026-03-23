console.log("JS carregou")

window.onload = () => {

const usuario = localStorage.getItem("usuario")

if(!usuario || usuario === "undefined"){
window.location.href="login.html"
}

const dadosUsuario = JSON.parse(usuario)

if(dadosUsuario){
document.getElementById("boasVindas").innerText = "Olá, " + dadosUsuario.nome
}

function adicionarTarefa(){

const titulo = document.getElementById("titulo").value

if(!titulo) return

const tarefa = document.createElement("div")
tarefa.className="tarefa"
tarefa.innerText=titulo

tarefa.onclick=()=>{
moverTarefa(tarefa)
}

document.getElementById("pendente").appendChild(tarefa)

document.getElementById("titulo").value=""
}

function moverTarefa(tarefa){

if(tarefa.parentElement.id==="pendente"){
document.getElementById("andamento").appendChild(tarefa)
}else if(tarefa.parentElement.id==="andamento"){
document.getElementById("concluido").appendChild(tarefa)
}

}

window.logout = function(){
localStorage.removeItem("usuario")
window.location.href="login.html"
}

}