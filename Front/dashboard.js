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

    carregarTarefas() // importante
}

// 👇 AGORA FORA DO onload
function adicionarTarefa(){

    const titulo = document.getElementById("titulo").value
    const descricao = document.getElementById("descricao").value
    const data = document.getElementById("data").value
    const prioridade = document.getElementById("prioridade").value

    const usuario = JSON.parse(localStorage.getItem("usuario"))

    if(!titulo){
        alert("Título obrigatório")
        return
    }

    const hoje = new Date().toISOString().split("T")[0]

    if(data && data < hoje){
        alert("Data inválida")
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

function carregarTarefas(){
    fetch("http://localhost:3000/tarefas")
    .then(res => res.json())
    .then(tarefas => {

        document.getElementById("pendente").innerHTML = ""
        document.getElementById("andamento").innerHTML = ""
        document.getElementById("concluido").innerHTML = ""

        tarefas.forEach(tarefa => {
            const div = document.createElement("div")
            div.className = "tarefa"
            div.innerText = tarefa.titulo
            div.onclick = () => {
                console.log("clicou", tarefa)
                moverTarefa(tarefa)
            }

            if(tarefa.status === "pendente"){
                document.getElementById("pendente").appendChild(div)
            }else if(tarefa.status === "andamento"){
                document.getElementById("andamento").appendChild(div)
            }else{
                document.getElementById("concluido").appendChild(div)
            }
        })
    })
}

function moverTarefa(tarefa){

    let novoStatus

    if(tarefa.status === "pendente"){
        novoStatus = "em andamento"
    }else if(tarefa.status === "em andamento"){
        novoStatus = "concluida"
    }else{
        return
    }

    fetch(`http://localhost:3000/tarefas/${tarefa.id_tarefa}`,{
        method:"PUT",
        headers:{
            "Content-Type":"application/json"
        },
        body: JSON.stringify({ status: novoStatus })
    })
    .then(res => res.json())
    .then(() => {
        carregarTarefas()
    })
}