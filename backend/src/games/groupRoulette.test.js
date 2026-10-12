import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { pool, initDatabase } from "../db.js";
import { getGroupRouletteTableByCode, joinGroupRoulette, leaveGroupRoulette } from "./groupRoulette.js";

let sequence = 0;

async function createUser({ credits = 10, cash = 5, reserved = 2 } = {}) {
  sequence += 1;
  const username = `grtest_${Date.now()}_${sequence}`;
  const result = await pool.query(
    `INSERT INTO users(username,password_hash,play_credits,cash_balance,reserved_balance)
     VALUES($1,'test-hash',$2,$3,$4) RETURNING id`,
    [username, credits, cash, reserved]
  );
  return { id: result.rows[0].id, username };
}

before(async () => {
  await initDatabase();
});

beforeEach(async () => {
  await pool.query("TRUNCATE group_roulette_tables RESTART IDENTITY CASCADE");
  await pool.query("DELETE FROM users WHERE username LIKE 'grtest_%'");
});

after(async () => {
  await pool.end();
});

test("ten paid seats finish exactly one shared round and credit exactly one cash prize", async () => {
  const users = [];
  for (let i = 0; i < 10; i += 1) users.push(await createUser());

  const first = await joinGroupRoulette({ userId: users[0].id, stakeAmount: 10 });
  assert.equal(first.table.status, "waiting");
  assert.equal(first.table.playerCount, 1);

  const duplicate = await joinGroupRoulette({ userId: users[0].id, stakeAmount: 10 });
  assert.equal(duplicate.alreadyJoined, true);
  assert.equal(duplicate.table.id, first.table.id);

  await Promise.all(users.slice(1).map(user =>
    joinGroupRoulette({ userId: user.id, stakeAmount: 10 })
  ));

  const finalTable = await getGroupRouletteTableByCode(first.table.roomCode);
  assert.equal(finalTable.status, "finished");
  assert.equal(finalTable.playerCount, 10);
  assert.equal(finalTable.players.length, 10);
  assert.ok(finalTable.winnerUsername);
  assert.equal(finalTable.prizeAmount, 100);

  const ids = users.map(user => user.id);
  const balances = await pool.query(
    "SELECT id,play_credits,cash_balance,reserved_balance FROM users WHERE id=ANY($1::int[])",
    [ids]
  );
  assert.equal(balances.rows.length, 10);
  for (const row of balances.rows) {
    assert.equal(Number(row.play_credits), 0);
    assert.equal(Number(row.reserved_balance), 2);
    assert.equal(Number(row.cash_balance), row.id === Number((await pool.query(
      "SELECT winner_user_id FROM group_roulette_tables WHERE id=$1", [finalTable.id]
    )).rows[0].winner_user_id) ? 105 : 5);
  }

  const entries = await pool.query(
    "SELECT COUNT(*)::int AS count FROM transactions WHERE user_id=ANY($1::int[]) AND type='group_roulette_entry'",
    [ids]
  );
  const wins = await pool.query(
    "SELECT COUNT(*)::int AS count, COALESCE(SUM(amount),0)::numeric AS amount FROM transactions WHERE user_id=ANY($1::int[]) AND type='group_roulette_win'",
    [ids]
  );
  assert.equal(entries.rows[0].count, 10);
  assert.equal(wins.rows[0].count, 1);
  assert.equal(Number(wins.rows[0].amount), 100);
  const winLedger = await pool.query(
    "SELECT amount,balance_after FROM transactions WHERE type='group_roulette_win' AND user_id=ANY($1::int[])",
    [ids]
  );
  assert.equal(Number(winLedger.rows[0].amount), 100);
  assert.equal(Number(winLedger.rows[0].balance_after), 103);
});

test("leaving a waiting table refunds credits once and removes the empty table", async () => {
  const user = await createUser({ credits: 10 });
  const joined = await joinGroupRoulette({ userId: user.id, stakeAmount: 10 });
  const result = await leaveGroupRoulette({ userId: user.id });

  assert.equal(result.refunded, 10);
  await assert.rejects(() => leaveGroupRoulette({ userId: user.id }), /não tem uma vaga/i);

  const balance = await pool.query("SELECT play_credits FROM users WHERE id=$1", [user.id]);
  assert.equal(Number(balance.rows[0].play_credits), 10);

  const tx = await pool.query(
    "SELECT type,amount FROM transactions WHERE user_id=$1 ORDER BY id",
    [user.id]
  );
  assert.deepEqual(tx.rows.map(row => [row.type, Number(row.amount)]), [
    ["group_roulette_entry", -10],
    ["group_roulette_refund", 10]
  ]);
  const tables = await pool.query("SELECT COUNT(*)::int AS count FROM group_roulette_tables WHERE id=$1", [joined.table.id]);
  assert.equal(tables.rows[0].count, 0);
});

test("insufficient credits do not create a table or charge the player", async () => {
  const user = await createUser({ credits: 2 });
  await assert.rejects(
    () => joinGroupRoulette({ userId: user.id, stakeAmount: 5 }),
    /Créditos insuficientes/i
  );
  const balance = await pool.query("SELECT play_credits FROM users WHERE id=$1", [user.id]);
  const tables = await pool.query("SELECT COUNT(*)::int AS count FROM group_roulette_tables");
  const entries = await pool.query(
    "SELECT COUNT(*)::int AS count FROM transactions WHERE user_id=$1 AND type='group_roulette_entry'",
    [user.id]
  );
  assert.equal(Number(balance.rows[0].play_credits), 2);
  assert.equal(tables.rows[0].count, 0);
  assert.equal(entries.rows[0].count, 0);
});
