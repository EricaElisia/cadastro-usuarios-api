# API de Cadastro de Usuários

Este projeto foi desenvolvido como parte de um trabalho acadêmico para implementar o requisito funcional **RF01 – Cadastro de Usuário**.

## Tecnologias utilizadas

* Node.js
* Express
* MySQL
* bcrypt
* cors

## Objetivo

Permitir que novos usuários se cadastrem no sistema através de uma API que recebe os dados e armazena no banco de dados.

## Requisito Implementado

### RF01 – Cadastro de Usuário

Permite que um usuário crie uma conta no sistema informando:

* Nome completo
* E-mail
* Senha

### Regras de negócio implementadas

* Todos os campos são obrigatórios
* O e-mail deve possuir formato válido
* O e-mail não pode já estar cadastrado no sistema
* A senha deve possuir no mínimo 8 caracteres
* A senha é armazenada de forma criptografada utilizando bcrypt

## Endpoint da API

### Cadastro de usuário

POST

http://localhost:3000/cadastro

### Exemplo de requisição

```json
{
 "nome": "Nome do usuário",
 "email": "email@email.com",
 "senha": "12345678"
}
```

### Resposta de sucesso

```json
{
 "mensagem": "Usuário cadastrado com sucesso"
}
```

## Banco de dados

Tabela utilizada: **usuarios**

Campos:

* id_usuario
* nome
* email
* senha
* status

## Como executar o projeto

1. Instalar as dependências:

npm install

2. Iniciar o servidor:

node server.js

3. A API estará disponível em:

http://localhost:3000

## Autor

Projeto desenvolvido por **Érica Elisia, Marcos Vinicius, Andressa Pinheiro e Julia Rufino**.


POST
