console.log("JS carregou")

let tarefaAtual = null

window.onload = () => {

    const usuarioString = localStorage.getItem("usuario")

    if (!usuarioString) {
        window.location.href = "login.html"
        return
    }

    const usuario = JSON.parse(usuarioString)

    document.getElementById("boasVindas").innerText = "Olá, " + usuario.nome

    const hoje = new Date().toLocaleDateString('en-CA')
    document.getElementById("data").setAttribute("min", hoje)

    carregarTarefas()
    carregarListas()

    // 🔥 COLOCA ESSE BLOCO AQUI
    ["pendente", "andamento", "concluido"].forEach(id => {

        const coluna = document.getElementById(id)

        coluna.addEventListener("dragover", (e) => {
            e.preventDefault()
        })

        coluna.addEventListener("drop", (e) => {
            e.preventDefault()
            moverPorDrag(id)
        })
    })
}

// 🔹 ADICIONAR TAREFA
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

    const hoje = new Date().toLocaleDateString('en-CA')

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
            status: window.statusSelecionado || "pendente",
            id_usuario: usuario.id
})
    })


    .then(res => res.json())
    .then(() => {
        carregarTarefas()

        window.statusSelecionado = null
    })

    if(window.listaSelecionada){
        window.listaSelecionada.appendChild(div)
    }
}


// 🔹 CARREGAR TAREFAS
function carregarTarefas(){
    const usuario = JSON.parse(localStorage.getItem("usuario"))

    fetch(`http://localhost:3000/tarefas/${usuario.id}`)
    .then(res => res.json())
    .then(tarefas => {

        document.getElementById("pendente").innerHTML = ""
        document.getElementById("andamento").innerHTML = ""
        document.getElementById("concluido").innerHTML = ""

        tarefas.forEach(tarefa => {

            const div = document.createElement("div")
            div.className = "tarefa"
            div.draggable = true

            div.addEventListener("dragstart", () => {
                window.tarefaArrastada = tarefa
            })

            const titulo = document.createElement("span")
            titulo.innerText = tarefa.titulo

            const menu = document.createElement("button")
            menu.innerText = "⋮"
            menu.className = "menu-btn"

            menu.onclick = (e) => {
    e.stopPropagation()

    const opcao = prompt("Digite:\n1 - Editar\n2 - Excluir")

    if(opcao == "1"){
        abrirEdicao(tarefa)
    }

    if(opcao == "2"){
        excluirTarefa(tarefa)
    }
}

            div.onclick = () => {
                moverTarefa(tarefa)
            }

            div.appendChild(titulo)
            div.appendChild(menu)

            if(tarefa.status === "pendente"){
                if(window.listaSelecionada){
                    window.listaSelecionada.appendChild(div)
                }else{
                    document.getElementById("pendente").appendChild(div)
                }

            }else if(tarefa.status === "em andamento"){
                document.getElementById("andamento").appendChild(div)

            }else{
                document.getElementById("concluido").appendChild(div)
            }
        })
    })
}

// 🔹 MOVER STATUS
function moverTarefa(tarefa){

    let novoStatus

    if(tarefa.status === "pendente"){
        novoStatus = "em andamento"

    }else if(tarefa.status === "em andamento"){
        novoStatus = "concluida"

    }else{
        return
    }

    const usuario = JSON.parse(localStorage.getItem("usuario"))

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

// 🔹 ABRIR MODAL
function abrirEdicao(tarefa){

    tarefaAtual = tarefa

    document.getElementById("editTitulo").value = tarefa.titulo
    document.getElementById("editDescricao").value = tarefa.descricao || ""
    document.getElementById("editData").value = tarefa.data_vencimento || ""
    document.getElementById("editPrioridade").value = tarefa.prioridade || "baixa"

    document.getElementById("modalEdicao").style.display = "block"
}

// 🔹 FECHAR MODAL
function fecharModal(){
    document.getElementById("modalEdicao").style.display = "none"
}

// 🔹 SALVAR EDIÇÃO
function salvarEdicao(){

    const usuario = JSON.parse(localStorage.getItem("usuario"))

    const titulo = document.getElementById("editTitulo").value
    const descricao = document.getElementById("editDescricao").value
    const data = document.getElementById("editData").value
    const prioridade = document.getElementById("editPrioridade").value

    fetch(`http://localhost:3000/tarefas/${tarefaAtual.id_tarefa}/editar`,{
        method:"PUT",
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
    .then(dados => {

        if(dados.erro){
            alert(dados.erro)
            return
        }

        fecharModal()
        carregarTarefas()
    })
}

function excluirTarefa(tarefa){

    const confirmar = confirm("Tem certeza que deseja excluir?")

    if(!confirmar) return

    const usuario = JSON.parse(localStorage.getItem("usuario"))

    fetch(`http://localhost:3000/tarefas/${tarefa.id_tarefa}`,{
        method:"DELETE",
        headers:{
            "Content-Type":"application/json"
        },
        body: JSON.stringify({
            id_usuario: usuario.id
        })
    })
    .then(res => res.json())
    .then(() => {
        carregarTarefas()
    })
}

function abrirCriacao(status){
    window.statusSelecionado = status
    console.log("Status selecionado:", status)
}

function criarLista(status){

    const nome = prompt("Nome da lista:")

    if(!nome || nome.trim() === ""){
        alert("Nome da lista é obrigatório")
        return
    }

    const usuario = JSON.parse(localStorage.getItem("usuario"))

    fetch("http://localhost:3000/listas", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            nome,
            id_usuario: usuario.id
        })
    })
    .then(res => res.json())
    .then(() => {
        carregarListas()
    })
}

function carregarListas(){

    const usuario = JSON.parse(localStorage.getItem("usuario"))

    fetch(`http://localhost:3000/listas/${usuario.id}`)
    .then(res => res.json())
    .then(listas => {

        const coluna = document.getElementById("pendente")

        coluna.innerHTML = "" // limpa antes

        listas.forEach(lista => {

            const div = document.createElement("div")
            div.className = "lista"

            const titulo = document.createElement("h4")
            titulo.innerText = lista.nome

            div.appendChild(titulo)

            coluna.appendChild(div)
        })
    })
}

function moverParaLista(id_lista){

    const tarefa = window.tarefaArrastada
    const usuario = JSON.parse(localStorage.getItem("usuario"))

    fetch(`http://localhost:3000/tarefas/${tarefa.id_tarefa}/mover`,{
        method:"PUT",
        headers:{
            "Content-Type":"application/json"
        },
        body: JSON.stringify({
            id_lista,
            id_usuario: usuario.id
        })
    })
    .then(() => {
        carregarTarefas()
    })
}
// 🔹 LOGOUT
function logout(){
    localStorage.removeItem("usuario")
    window.location.href = "login.html"
}