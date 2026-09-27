# MyBets

Projeto da plataforma MyBets.

## Estrutura
- Roleta
- My Tiger
- Conta do jogador com créditos para jogar e saldo para saque
- Depósitos automáticos via Mercado Pago
- Saques via Pix com análise administrativa
- Histórico de transações e apostas
- Área administrativa
- PostgreSQL

## Financeiro
Os créditos para jogar são separados do saldo disponível para saque. Os depósitos são processados automaticamente pelo Mercado Pago e os créditos são liberados após a confirmação do pagamento.

## Desenvolvimento
- Backend: Node.js + Express
- Banco: PostgreSQL
- Frontend: HTML, CSS e JavaScript
- Node.js: 20 ou superior

Para verificar a sintaxe do projeto:

```bash
npm run check
```
