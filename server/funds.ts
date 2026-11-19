import { Router } from 'express';
import { currentUser, requireUser } from './auth.js';
import { config } from './config.js';
import { get, run, tx } from './db.js';
import { TEST_TRIGGERS, gateway } from './gateway.js';
import { HttpError, str } from './http.js';
import {
  accountStatusFor,
  balanceFor,
  enforceTransferDeadlines,
  insertTransaction,
  methodLabelsFor,
  methodsFor,
  pendingTransferFor,
  summaryFor,
  transactionBySeq,
  transactionsFor,
  type MethodRow,
} from './ledger.js';

export const fundsRouter = Router();
fundsRouter.use(requireUser, (_req, res, next) => {
  // Admins have no funds of their own; they use /api/admin.
  if (currentUser(res).role !== 'client') return next(new HttpError(403, 'FORBIDDEN', 'Client accounts only.'));
  next();
});

/** Throws if the client may not move money right now. */
export async function assertCanMoveMoney(userId: number) {
  await enforceTransferDeadlines(userId);
  if ((await accountStatusFor(userId)).status === 'suspended') {
    throw new HttpError(403, 'ACCOUNT_SUSPENDED', 'Your account is suspended. Contact support to reactivate it.');
  }
  const pending = await pendingTransferFor(userId);
  if (pending) {
    throw new HttpError(
      409,
      'PENDING_TRANSFER',
      pending.direction === 'in'
        ? `Adding and withdrawing funds are paused until transfer ${pending.reference} is received.`
        : `Adding and withdrawing funds are paused until withdrawal ${pending.reference} is completed.`,
    );
  }
}

fundsRouter.get('/overview', async (_req, res) => {
  const user = currentUser(res);
  await enforceTransferDeadlines(user.id);
  const [{ summary, totalCount }, account, pendingTransfer, balance, methods, methodLabels, transactions] = await Promise.all([
    summaryFor(user.id),
    accountStatusFor(user.id),
    pendingTransferFor(user.id),
    balanceFor(user.id),
    methodsFor(user.id),
    methodLabelsFor(user.id),
    transactionsFor(user.id),
  ]);
  res.json({
    user,
    account,
    pendingTransfer,
    gateway: { name: gateway.name, isTest: gateway.isTest, triggers: gateway.isTest ? TEST_TRIGGERS : [] },
    balance: { ...balance, asOf: new Date().toISOString() },
    summary,
    methods,
    methodLabels,
    transactions,
    totalCount,
  });
});

fundsRouter.post('/deposits', async (req, res) => {
  const user = currentUser(res);
  await assertCanMoveMoney(user.id);
  const amountCents = req.body?.amountCents;
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new HttpError(400, 'VALIDATION', 'Enter an amount greater than $0.00.');
  }
  if (amountCents > config.maxDepositCents) {
    throw new HttpError(400, 'AMOUNT_LIMIT_EXCEEDED', 'The most you can add in one deposit is $1,000,000.00.');
  }
  const methodId = str(req.body?.methodId, 'methodId', 64);
  const method = await get<MethodRow>(
    'SELECT id, kind, label, long_label FROM payment_methods WHERE id = ? AND user_id = ? AND removed_at IS NULL',
    [methodId, user.id],
  );
  if (!method) throw new HttpError(404, 'METHOD_NOT_FOUND', 'That payment method is not linked to your account.');

  // 1. Record the deposit as Pending before talking to the provider.
  const { seq, reference } = await insertTransaction({
    userId: user.id,
    type: 'Deposit',
    status: 'Pending',
    amountCents,
    methodId: method.id,
  });

  // 2. Charge through the gateway.
  let result;
  try {
    result = await gateway.charge({ reference, amountCents, method: { kind: method.kind, label: method.label } });
  } catch (err) {
    console.error('Gateway error', err);
    result = { status: 'failed' as const, code: 'PROVIDER_ERROR', message: "Our payment provider couldn't process this deposit." };
  }

  // 3. Settle. Failed deposits never touch the balance.
  if (result.status === 'succeeded') {
    await run("UPDATE transactions SET status = 'Completed' WHERE seq = ?", [seq]);
  } else {
    await run("UPDATE transactions SET status = 'Failed', error_code = ? WHERE seq = ?", [result.code, seq]);
  }
  const transaction = await transactionBySeq(seq);

  res.status(201).json(
    result.status === 'succeeded'
      ? { ok: true, transaction, feeCents: result.feeCents }
      : { ok: false, transaction, errorCode: result.code, errorMessage: result.message },
  );
});

/**
 * Requests a wire withdrawal to one of the client's linked bank accounts.
 * The amount is held immediately and the request goes Pending with a 12-hour
 * deadline; an admin marks it Completed once the wire is sent (or Failed to
 * release the hold). If neither happens in time, it fails and the account is
 * suspended, the same rule as pending deposits.
 */
fundsRouter.post('/withdrawals', async (req, res) => {
  const user = currentUser(res);
  await assertCanMoveMoney(user.id);
  const amountCents = req.body?.amountCents;
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new HttpError(400, 'VALIDATION', 'Enter an amount greater than $0.00.');
  }
  const methodId = str(req.body?.methodId, 'methodId', 64);
  const method = await get<MethodRow>(
    "SELECT id, kind, label, long_label FROM payment_methods WHERE id = ? AND user_id = ? AND removed_at IS NULL AND kind = 'bank'",
    [methodId, user.id],
  );
  if (!method) throw new HttpError(404, 'METHOD_NOT_FOUND', 'Choose one of your linked bank accounts.');

  const { seq } = await tx(async (t) => {
    // Checked inside the write transaction so two requests can't both spend the same balance.
    const { availableCents } = await balanceFor(user.id, t);
    if (amountCents > availableCents) {
      throw new HttpError(400, 'INSUFFICIENT_BALANCE', "You can't withdraw more than your available balance.");
    }
    if (await pendingTransferFor(user.id, t)) {
      throw new HttpError(409, 'PENDING_TRANSFER', 'Another transaction is already pending.');
    }
    return insertTransaction({ userId: user.id, type: 'Withdrawal', status: 'Pending', amountCents, methodId: method.id }, t);
  });

  res.status(201).json({ transaction: await transactionBySeq(seq), pendingTransfer: await pendingTransferFor(user.id) });
});
