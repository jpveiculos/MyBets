import crypto from "node:crypto";
import { pool } from "./db.js";
import { addDepositCredits } from "./finance.js";

const API_URL = "https://api.mercadopago.com";
const ACCESS_TOKEN = String(process.env.MERCADOPAGO_ACCESS_TOKEN || "").trim();
const WEBHOOK_SECRET = String(process.env.MERCADOPAGO_WEBHOOK_SECRET || "").trim();
const PUBLIC_BASE_URL = String(
  process.env.PUBLIC_BASE_URL ||
  process.env.URL_BASE_PUBLICA ||
  process.env["URL_BASE_PÚBLICA"] ||
  "https://mybets.app.br"
).replace(/\/$/, "");

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error("Valor financeiro inválido.");
  return Math.round(n * 100) / 100;
}

function assertConfigured() {
  if (!ACCESS_TOKEN) {
    throw new Error("Mercado Pago ainda não está configurado no servidor.");
  }
}

async function mpRequest(path, options = {}) {
  assertConfigured();
  const response = await fetch(API_URL + path, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.message || body?.error || "Mercado Pago recusou a operação.";
    throw new Error(`Mercado Pago: ${detail}`);
  }
  return body;
}

function verifyWebhookSignature({ signature, requestId, dataId }) {
  if (!WEBHOOK_SECRET) throw new Error("MERCADOPAGO_WEBHOOK_SECRET não configurado.");
  if (!signature || !requestId || !dataId) return false;

  let ts = "";
  const receivedSignatures = [];
  for (const part of String(signature).split(",")) {
    const [key, ...rest] = part.split("=");
    const value = rest.join("=").trim();
    if (key?.trim() === "ts") ts = value;
    if (key?.trim() === "v1" && value) receivedSignatures.push(value);
  }
  if (!ts || receivedSignatures.length === 0) return false;

  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${ts};`;
  const expected = crypto.createHmac("sha256", WEBHOOK_SECRET).update(manifest).digest("hex");
  return receivedSignatures.some(received => {
    const a = Buffer.from(received, "utf8");
    const b = Buffer.from(expected, "utf8");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

export async function createMercadoPagoDeposit({ userId, amount }) {
  const value = money(amount);
  if (value <= 0) throw new Error("O valor do depósito deve ser maior que zero.");

  const userResult = await pool.query(
    "SELECT id,username FROM users WHERE id=$1 AND COALESCE(is_deleted,FALSE)=FALSE",
    [userId]
  );
  const user = userResult.rows[0];
  if (!user) throw new Error("Usuário não encontrado.");

  const depositResult = await pool.query(
    `INSERT INTO deposits
      (user_id, amount, status, payment_method, payment_provider, player_note)
     VALUES ($1,$2,'pending','mercadopago','mercadopago',$3)
     RETURNING id,user_id,amount,status,payment_provider,created_at`,
    [userId, value, `Mercado Pago • ${user.username}`]
  );
  const deposit = depositResult.rows[0];
  const externalReference = `mybets_deposit_${deposit.id}`;

  try {
    const order = await mpRequest("/v1/orders", {
      method: "POST",
      headers: {
        "X-Idempotency-Key": crypto.randomUUID()
      },
      body: JSON.stringify({
        type: "online",
        processing_mode: "manual",
        total_amount: value.toFixed(2),
        external_reference: externalReference,
        description: `Créditos MyBets #${deposit.id}`,
        items: [{
          external_code: `MYBETS-CREDITS-${deposit.id}`,
          title: "Créditos para jogar",
          description: `Créditos MyBets #${deposit.id}`,
          quantity: 1,
          unit_price: value.toFixed(2)
        }],
        config: {
          online: {
            success_url: `${PUBLIC_BASE_URL}/dashboard.html?payment=approved&deposit=${deposit.id}`,
            failure_url: `${PUBLIC_BASE_URL}/dashboard.html?payment=failed&deposit=${deposit.id}`,
            pending_url: `${PUBLIC_BASE_URL}/dashboard.html?payment=pending&deposit=${deposit.id}`,
            auto_return: "approved"
          }
        }
      })
    });

    if (!order?.id || !order?.checkout_url) {
      throw new Error("O Mercado Pago não retornou uma URL de checkout válida.");
    }

    await pool.query(
      `UPDATE deposits
          SET mercadopago_order_id=$1,
              mercadopago_checkout_url=$2,
              mercadopago_status=$3,
              mercadopago_status_detail=$4,
              mercadopago_updated_at=CURRENT_TIMESTAMP,
              updated_at=CURRENT_TIMESTAMP
        WHERE id=$5`,
      [String(order.id), String(order.checkout_url), order.status || "created",
       order.status_detail || "created", deposit.id]
    );

    return {
      id: deposit.id,
      amount: value,
      status: "pending",
      checkoutUrl: order.checkout_url,
      orderId: order.id
    };
  } catch (error) {
    await pool.query(
      `UPDATE deposits
          SET status='failed',
              admin_note=$1,
              updated_at=CURRENT_TIMESTAMP
        WHERE id=$2 AND status='pending'`,
      [String(error.message || "Falha ao criar cobrança no Mercado Pago."), deposit.id]
    );
    throw error;
  }
}

async function getOrder(orderId) {
  return mpRequest(`/v1/orders/${encodeURIComponent(orderId)}`, { method: "GET" });
}

async function creditApprovedDeposit({ order, deposit }) {
  const paid = money(order.total_paid_amount ?? order.total_amount);
  const expected = money(deposit.amount);

  if (paid < expected) {
    throw new Error("O valor confirmado pelo Mercado Pago é inferior ao valor do depósito.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const locked = await client.query(
      "SELECT * FROM deposits WHERE id=$1 FOR UPDATE",
      [deposit.id]
    );
    const current = locked.rows[0];
    if (!current) throw new Error("Depósito não encontrado.");

    if (current.status === "approved") {
      await client.query("COMMIT");
      return { alreadyApproved: true, depositId: current.id };
    }

    if (current.status !== "pending") {
      await client.query("ROLLBACK");
      return { ignored: true, depositId: current.id, status: current.status };
    }

    const creditState = await addDepositCredits({
      client,
      userId: current.user_id,
      amount: expected,
      referenceId: current.id
    });

    await client.query(
      `UPDATE deposits
          SET status='approved',
              approved_amount=$1,
              mercadopago_status=$2,
              mercadopago_status_detail=$3,
              mercadopago_paid_amount=$4,
              mercadopago_updated_at=CURRENT_TIMESTAMP,
              approved_at=CURRENT_TIMESTAMP,
              updated_at=CURRENT_TIMESTAMP
        WHERE id=$5`,
      [expected, order.status || "processed", order.status_detail || "accredited",
       paid, current.id]
    );

    await client.query(
      `INSERT INTO audit_logs(actor_type,actor_id,action,target_type,target_id,details)
       VALUES('system',NULL,'mercadopago_deposit_approved','deposit',$1,$2)`,
      [current.id, JSON.stringify({
        orderId: order.id,
        externalReference: order.external_reference,
        paidAmount: paid,
        depositAmount: expected,
        bonusPercent: creditState.bonusPercent,
        creditsAdded: creditState.creditsAdded
      })]
    );

    await client.query("COMMIT");
    return {
      approved: true,
      depositId: current.id,
      creditsAdded: creditState.creditsAdded,
      newPlayCredits: creditState.newPlayCredits
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function handleMercadoPagoWebhook({ signature, requestId, dataId }) {
  const valid = verifyWebhookSignature({ signature, requestId, dataId });
  if (!valid) {
    const error = new Error("Assinatura do webhook do Mercado Pago inválida.");
    error.statusCode = 401;
    throw error;
  }

  const orderId = String(dataId || "").trim();
  if (!orderId) return { ignored: true };

  const order = await getOrder(orderId);
  const reference = String(order?.external_reference || "");
  const match = reference.match(/^mybets_deposit_(\d+)$/);
  if (!match) return { ignored: true };

  const depositId = Number(match[1]);
  const depositResult = await pool.query(
    "SELECT * FROM deposits WHERE id=$1 AND mercadopago_order_id=$2 LIMIT 1",
    [depositId, orderId]
  );
  const deposit = depositResult.rows[0];
  if (!deposit) return { ignored: true };

  await pool.query(
    `UPDATE deposits
        SET mercadopago_status=$1,
            mercadopago_status_detail=$2,
            mercadopago_paid_amount=$3,
            mercadopago_updated_at=CURRENT_TIMESTAMP,
            updated_at=CURRENT_TIMESTAMP
      WHERE id=$4`,
    [order.status || null, order.status_detail || null,
     money(order.total_paid_amount || 0), deposit.id]
  );

  if (order.status === "processed" && order.status_detail === "accredited") {
    return await creditApprovedDeposit({ order, deposit });
  }

  if (["failed","canceled","expired","refunded"].includes(order.status)) {
    await pool.query(
      `UPDATE deposits SET status=$1,updated_at=CURRENT_TIMESTAMP
        WHERE id=$2 AND status='pending'`,
      [order.status === "refunded" ? "refunded" : "rejected", deposit.id]
    );
  }

  return { received: true, orderStatus: order.status, orderStatusDetail: order.status_detail };
}

export function isMercadoPagoConfigured() {
  return Boolean(ACCESS_TOKEN && WEBHOOK_SECRET);
}
