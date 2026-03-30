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
                moverTarefa(tarefa)
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

// 🔹 LOGOUT
function logout(){
    localStorage.removeItem("usuario")
    window.location.href = "login.html"
}