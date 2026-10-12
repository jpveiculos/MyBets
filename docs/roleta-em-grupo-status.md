# Roleta em Grupo — estado da implementação

Esta implementação está isolada na branch `feature/group-roulette` e no pull request #1. A branch `main` não foi alterada por esta entrega.

## Arquivos principais

- `backend/db/schema.sql`: tabelas para mesas e participantes.
- `backend/src/games/groupRoulette.js`: entrada em mesas, débito de créditos, seleção de vencedor e devolução de créditos ao sair antes do início.
- `backend/src/server.js`: rotas da API da roleta em grupo.
- `backend/frontend/group-roulette.html`: página pública.
- `backend/frontend/group-roulette.css`: estilos responsivos.
- `backend/frontend/group-roulette.js`: interface das mesas e atualização periódica.

## Antes de publicar

- Validar compatibilidade das rotas com a autenticação e o tratamento de erros do servidor.
- Confirmar que as colunas de saldo e o esquema de transações correspondem ao banco usado no ambiente atual.
- Executar testes de concorrência para dez entradas simultâneas, cobrança única, prêmio único e consistência dos resultados.
- Validar a experiência de login, recarga de créditos e próxima rodada.
- Não mesclar nem implantar em produção até esses testes passarem.
