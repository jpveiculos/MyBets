# Roleta em Grupo — estado da implementação

A implementação permanece isolada na branch `feature/group-roulette` e no pull request #1. A branch `main` e o ambiente de produção do Railway não foram alterados.

## Arquivos principais

- `backend/db/schema.sql`: tabelas e índices das mesas e participantes.
- `backend/src/games/groupRoulette.js`: matchmaking, entradas, débitos, seleção de vencedor, prêmio e devolução.
- `backend/src/server.js`: rotas da API e página `/mesas`.
- `backend/frontend/group-roulette.html`, `.css`, `.js`: interface responsiva e atualização periódica.
- `backend/src/games/groupRoulette.test.js`: testes de integração usando PostgreSQL descartável no CI.

## Validações automatizadas

O workflow `.github/workflows/code-checks.yml` executa a verificação de sintaxe e testes com PostgreSQL 16. Os testes cobrem:

- Dez vagas por rodada e criação automática de outra mesa para o 11º participante.
- Uma cobrança por usuário, mesmo em requisição repetida.
- Um único prêmio creditado ao saldo em dinheiro, mantendo créditos de jogo e saldo reservado separados.
- Devolução de créditos ao sair de uma mesa ainda aguardando.
- Rejeição de entrada sem créditos suficientes, sem criar mesa nem lançar cobrança.
- Aprovação de saque do saldo em dinheiro mesmo quando ainda existem créditos de jogo.

## Antes da publicação

- Confirmar que o workflow terminou com sucesso para o commit mais recente.
- Fazer revisão final da navegação/login e do uso das telas financeiras existentes.
- Não fazer depósito real nem alterar credenciais de pagamento para testar a roleta.
- Mesclar e implantar somente depois de a validação final passar.
