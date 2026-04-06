console.log("JS carregou")
console.log("LOCALSTORAGE:", localStorage.getItem("usuario"))

window.onload = () => {

    const usuarioString = localStorage.getItem("usuario")

    if (!usuarioString) {
        window.location.href = "login.html"
        return
    }

    const usuario = JSON.parse(usuarioString)

    if (!usuario || !usuario.id) {
        window.location.href = "login.html"
        return
    }

    document.getElementById("boasVindas").innerText = "Olá, " + usuario.nome

    // 🔥 define data mínima como hoje (corrigido timezone)
    const hoje = new Date().toLocaleDateString('en-CA')
    document.getElementById("data").setAttribute("min", hoje)

    carregarTarefas()
}

// 🔹 ADICIONAR TAREFA
function adicionarTarefa(){

    console.log("clicou adicionar")

    const titulo = document.getElementById("titulo").value
    const descricao = document.getElementById("descricao").value
    const data = document.getElementById("data").value
    const prioridade = document.getElementById("prioridade").value

    const usuario = JSON.parse(localStorage.getItem("usuario"))

    if(!usuario){
        alert("Faça login novamente")
        return
    }

    if(!titulo){
        alert("Título obrigatório")
        return
    }

    // 🔥 VALIDAÇÃO CORRETA DA DATA (permite hoje)
    const hoje = new Date().toLocaleDateString('en-CA')

    if(data && data < hoje){
        alert("A data de vencimento não pode ser anterior à data atual")
        return
    }

    fetch("http://localhost:3000/tarefas",{
        method:"POST",
        headers:{
            "Content-Type":"application/json"
        },
        body: JSON.stringify({
            titulo,
            descricao,
            data,
            prioridade,
            id_usuario: usuario.id
        })
    })
    .then(res => res.json())
    .then(() => {
        carregarTarefas()
    })
}

// 🔹 CARREGAR TAREFAS
function carregarTarefas(){
    const usuario = JSON.parse(localStorage.getItem("usuario"));

    fetch(`http://localhost:3000/tarefas/${usuario.id}`)
    
    .then(res => res.json())
    .then(tarefas => {

        document.getElementById("pendente").innerHTML = ""
        document.getElementById("andamento").innerHTML = ""
        document.getElementById("concluido").innerHTML = ""

        tarefas.forEach(tarefa => {
            const div = document.createElement("div")
            div.className = "tarefa"
            div.innerText = tarefa.titulo

            let clickTimer

            div.onclick = () => {
            clearTimeout(clickTimer)

            clickTimer = setTimeout(() => {
            moverTarefa(tarefa)
             }, 250)
}

div.ondblclick = () => {
    clearTimeout(clickTimer)
    abrirEdicao(tarefa)
}

            if(tarefa.status === "pendente"){
                document.getElementById("pendente").appendChild(div)

            }else if(tarefa.status === "em andamento"){
                document.getElementById("andamento").appendChild(div)

            }else{
                document.getElementById("concluido").appendChild(div)
            }
        })
    })
}

// 🔹 MOVER TAREFA
function moverTarefa(tarefa){

    let novoStatus

    if(tarefa.status === "pendente"){
        novoStatus = "em andamento"
    }else if(tarefa.status === "em andamento"){
        novoStatus = "concluida"
    }else{
        return
    }

    const usuario = JSON.parse(localStorage.getItem("usuario"));

    fetch(`http://localhost:3000/tarefas/${tarefa.id_tarefa}`,{
        method:"PUT",
        headers:{
            "Content-Type":"application/json"
        },
        body: JSON.stringify({ 
            status: novoStatus,
            id_usuario: usuario.id
        })
    })
    .then(res => res.json())
    .then(() => {
        carregarTarefas()
    })
}

// 🔹 LOGOUT
function logout(){
    localStorage.removeItem("usuario")
    window.location.href = "login.html"
}

function abrirEdicao(tarefa){

const novoTitulo = prompt("Editar título:", tarefa.titulo)
if(novoTitulo === null) return

const novaDescricao = prompt("Editar descrição:", tarefa.descricao || "")
if(novaDescricao === null) return

const novaData = prompt("Editar data (YYYY-MM-DD):", tarefa.data_vencimento || "")
if(novaData === null) return

const novaPrioridade = prompt("Editar prioridade (baixa, media, alta):", tarefa.prioridade || "")
if(novaPrioridade === null) return

const usuario = JSON.parse(localStorage.getItem("usuario"))

fetch(`http://localhost:3000/tarefas/${tarefa.id_tarefa}/editar`,{
method:"PUT",
headers:{
"Content-Type":"application/json"
},
body: JSON.stringify({
titulo: novoTitulo,
descricao: novaDescricao,
data: novaData,
prioridade: novaPrioridade,
id_usuario: usuario.id
})
})
.then(res => res.json())
.then(() => {
carregarTarefas()
})

}