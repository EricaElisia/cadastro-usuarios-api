# Guia rapido de configuracao e publicacao do iNota

## 1. Configuracao local

Crie um arquivo `.env` na raiz do projeto usando o `.env.example` como modelo.

No PowerShell:

```powershell
Copy-Item .env.example .env
```

Depois abra o `.env` e preencha os dados reais:

```env
PORT=3000
APP_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:3000

DB_HOST=localhost
DB_USER=root
DB_PASSWORD=sua_senha_do_mysql
DB_NAME=cad_usuario
DB_PORT=3308

SMTP_USER=seu_email@gmail.com
SMTP_PASS=sua_senha_de_app_google
```

O arquivo `.env` nao deve ir para o GitHub. Ele guarda senhas e configuracoes privadas.

## 2. Como rodar

```powershell
npm.cmd install
npm.cmd start
```

Se o servidor abrir com `Servidor rodando na porta 3000` e `Conectado ao banco MySQL!`, a API esta funcionando.

## 3. Email

O iNota usa Gmail com senha de app. Se o email parar:

- confira se o servidor ainda esta rodando;
- confira se `SMTP_USER` e `SMTP_PASS` estao no `.env`;
- gere uma nova senha de app se a senha antiga foi revogada;
- nunca poste a senha em prints, commits ou mensagens publicas.

## 4. Hospedagem

GitHub Pages hospeda apenas arquivos estaticos, como HTML, CSS e JavaScript. Ele nao roda Node.js, Express, MySQL nem envio de email.

Para colocar o iNota completo online, use:

- um host para o backend Node.js;
- um banco MySQL online;
- variaveis de ambiente no painel da hospedagem;
- `APP_URL` e `CORS_ORIGIN` apontando para a URL real do site.

Planos gratuitos sao bons para demonstracao, mas podem dormir, limitar uso ou mudar regras. Para producao real, o ideal e usar um plano pago simples ou uma plataforma academica/educacional.

## 5. Checklist de seguranca

- Senhas fora do codigo, usando `.env`.
- Senhas dos usuarios com hash.
- CORS limitado a origens conhecidas.
- Rate limit nas rotas de login, cadastro e senha.
- Headers de seguranca com Helmet.
- Banco acessado com queries parametrizadas.

Melhorias futuras recomendadas:

- autenticar requisicoes com sessao segura ou JWT;
- substituir armazenamento de `id_usuario` no frontend por token;
- validar entradas com biblioteca dedicada;
- adicionar testes automatizados;
- criar migrations SQL versionadas;
- ativar HTTPS em producao;
- configurar backup do banco;
- monitorar logs de erro.
