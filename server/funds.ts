import { Router } from 'express';
import { currentUser, requireUser } from './auth.ts';
import { config } from './config.ts';
import { db } from './db.ts';
import { TEST_TRIGGERS, gateway } from './gateway.ts';
import { HttpError, str } from './http.ts';
import {
  accountStatusFor,
  balanceFor,
  enforceTransferDeadlines,
  pendingTransferFor,
  insertTransaction,
  methodLabelsFor,
  methodsFor,
  summaryFor,
  transactionBySeq,
  transactionsFor,
  type MethodRow,
} from './ledger.ts';

export const fundsRouter = Router();
fundsRouter.use(requireUser, (_req, res, next) => {
  // Admins have no funds of their own; they use /api/admin.
  if (currentUser(res).role !== 'client') return next(new HttpError(403, 'FORBIDDEN', 'Client accounts only.'));
  next();
});

/** Throws if the client may not move money right now. */
export function assertCanMoveMoney(userId: number) {
  enforceTransferDeadlines(userId);
  if (accountStatusFor(userId).status === 'suspended') {
    throw new HttpError(403, 'ACCOUNT_SUSPENDED', 'Your account is suspended. Contact support to reactivate it.');
  }
  const pending = pendingTransferFor(userId);
  if (pending) {
    throw new HttpError(
      409,
      'PENDING_TRANSFER',
      `Adding and withdrawing funds are paused until transfer ${pending.reference} is received.`,
    );
  }
}

fundsRouter.get('/overview', (_req, res) => {
  const user = currentUser(res);
  enforceTransferDeadlines(user.id);
  const { summary, totalCount } = summaryFor(user.id);
  res.json({
    user,
    account: accountStatusFor(user.id),
    pendingTransfer: pendingTransferFor(user.id),
    gateway: { name: gateway.name, isTest: gateway.isTest, triggers: gateway.isTest ? TEST_TRIGGERS : [] },
    balance: { ...balanceFor(user.id), asOf: new Date().toISOString() },
    summary,
    methods: methodsFor(user.id),
    methodLabels: methodLabelsFor(user.id),
    transactions: transactionsFor(user.id),
    totalCount,
  });
});

fundsRouter.post('/deposits', async (req, res) => {
  const user = currentUser(res);
  assertCanMoveMoney(user.id);
  const amountCents = req.body?.amountCents;
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new HttpError(400, 'VALIDATION', 'Enter an amount greater than $0.00.');
  }
  if (amountCents > config.maxDepositCents) {
    throw new HttpError(400, 'AMOUNT_LIMIT_EXCEEDED', 'The most you can add in one deposit is $1,000,000.00.');
  }
  const methodId = str(req.body?.methodId, 'methodId', 64);
  const method = db
    .prepare(
      'SELECT id, kind, label, long_label FROM payment_methods WHERE id = ? AND user_id = ? AND removed_at IS NULL',
    )
    .get(methodId, user.id) as MethodRow | undefined;
  if (!method) throw new HttpError(404, 'METHOD_NOT_FOUND', 'That payment method is not linked to your account.');

  // 1. Record the deposit as Pending before talking to the provider.
  const { seq, reference } = insertTransaction({
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
    db.prepare("UPDATE transactions SET status = 'Completed' WHERE seq = ?").run(seq);
  } else {
    db.prepare("UPDATE transactions SET status = 'Failed', error_code = ? WHERE seq = ?").run(result.code, seq);
  }
  const transaction = transactionBySeq(seq);

  res.status(201).json(
    result.status === 'succeeded'
      ? { ok: true, transaction, feeCents: result.feeCents }
      : { ok: false, transaction, errorCode: result.code, errorMessage: result.message },
  );
});
