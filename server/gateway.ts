import { config } from './config.ts';

export interface ChargeRequest {
  reference: string;
  amountCents: number;
  method: { kind: 'bank' | 'card'; label: string };
}

export type ChargeResult =
  | { status: 'succeeded'; feeCents: number; providerId: string }
  | { status: 'failed'; code: string; message: string };

/** What every payment provider adapter must implement. */
export interface PaymentGateway {
  readonly name: string;
  readonly isTest: boolean;
  charge(req: ChargeRequest): Promise<ChargeResult>;
}

/**
 * Test gateway. Never moves money. The cents of the amount pick the outcome:
 *
 *   .02  declined by the card issuer / bank
 *   .05  insufficient funds
 *   .09  provider unavailable (outage / timeout)
 *   anything else succeeds with a $0.00 fee
 */
export const TEST_TRIGGERS = [
  { cents: 2, outcome: 'Declined' },
  { cents: 5, outcome: 'Insufficient funds' },
  { cents: 9, outcome: 'Provider outage' },
] as const;

class TestGateway implements PaymentGateway {
  readonly name = 'test';
  readonly isTest = true;
  private readonly latencyMs: number;

  constructor(latencyMs: number) {
    this.latencyMs = latencyMs;
  }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    await new Promise((r) => setTimeout(r, this.latencyMs));
    switch (req.amountCents % 100) {
      case 2:
        return req.method.kind === 'card'
          ? { status: 'failed', code: 'CARD_DECLINED', message: 'Your card issuer declined this deposit.' }
          : { status: 'failed', code: 'BANK_DECLINED', message: 'Your bank declined this transfer.' };
      case 5:
        return {
          status: 'failed',
          code: 'INSUFFICIENT_FUNDS',
          message: `${req.method.label} doesn't have enough funds for this deposit.`,
        };
      case 9:
        return {
          status: 'failed',
          code: 'PROVIDER_UNAVAILABLE',
          message: "Our payment provider didn't respond in time.",
        };
      default:
        return { status: 'succeeded', feeCents: 0, providerId: `test_${req.reference}` };
    }
  }
}

function createGateway(): PaymentGateway {
  switch (config.paymentGateway) {
    case 'test':
      return new TestGateway(config.testGatewayLatencyMs);
    default:
      throw new Error(`Unknown PAYMENT_GATEWAY "${config.paymentGateway}". Only "test" is available.`);
  }
}

export const gateway = createGateway();
