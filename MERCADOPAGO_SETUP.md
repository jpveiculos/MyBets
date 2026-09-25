# Mercado Pago — depósitos automáticos

## Variáveis do servidor

Configure no ambiente de produção (Render/Railway/etc.):

- `MERCADOPAGO_ACCESS_TOKEN`: Access Token de produção da aplicação Mercado Pago.
- `MERCADOPAGO_WEBHOOK_SECRET`: chave secreta gerada ao configurar Webhooks.
- `PUBLIC_BASE_URL`: URL pública do MyBets, por exemplo `https://mybets.app.br`.

Nunca coloque o Access Token ou a chave secreta no frontend, no `.env.example` preenchido ou no repositório.

## Webhook

No painel de desenvolvedor do Mercado Pago, configure uma notificação Webhook para o evento **Order (Mercado Pago)** apontando para:

```
https://mybets.app.br/api/webhooks/mercadopago
```

A integração valida o header `x-signature` antes de consultar ou creditar qualquer depósito.

## Fluxo

1. O jogador informa o valor.
2. O backend cria um registro de depósito e uma Order do Mercado Pago.
3. O jogador é redirecionado para o `checkout_url`.
4. O Mercado Pago envia o Webhook quando a Order é atualizada.
5. O backend consulta a Order diretamente no Mercado Pago.
6. Somente `status=processed` e `status_detail=accredited` liberam os créditos.
7. O depósito é bloqueado por linha/registro durante a confirmação, evitando crédito duplicado em Webhooks repetidos.
8. O valor efetivamente confirmado é registrado, e o bônus configurado em `site_settings.deposit_bonus_percent` é aplicado pela mesma rotina de créditos já usada pelo MyBets.

## Teste

Use primeiro as credenciais de teste do Mercado Pago. Crie uma Order de teste, configure o Webhook de teste e confirme que:

- o checkout abre;
- o pagamento altera a Order;
- o Webhook chega ao MyBets;
- o depósito muda para aprovado;
- os créditos aparecem na conta;
- um Webhook repetido não adiciona créditos novamente.

Antes de produção, confirme que a conta e a operação do MyBets estão habilitadas para o uso pretendido pelo Mercado Pago e cumprem as regras aplicáveis.
