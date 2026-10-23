// MTN MoMo Open API, Collections product: Hotzonex asks MoMo to charge a customer's phone
// ("request to pay"); the customer approves on their phone with their PIN; MoMo's status answer
// says whether the money arrived. Each business uses its own MoMo login (momo_accounts).
//
// Only MoMo's own status answer confirms a payment: a callback could be faked, so none is used.

export type MomoEnvironment = 'sandbox' | 'production';

export interface MomoAccount {
  environment: MomoEnvironment;
  /** "sandbox", or the country's production value given by MTN (for example "mtnsouthsudan"). */
  targetEnvironment: string;
  currency: string;
  apiUser: string;
  apiKey: string;
  subscriptionKey: string;
}

export type MomoStatus = 'PENDING' | 'SUCCESSFUL' | 'FAILED';

export interface MomoPayment {
  status: MomoStatus;
  amount: string;
  currency: string;
  /** MoMo's own transaction ID, once paid. */
  financialTransactionId: string | null;
  reason: string | null;
}

/** A MoMo failure with a message that is safe to show. */
export class MomoError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'MomoError';
    this.status = status;
  }
}

const BASE_URL: Record<MomoEnvironment, string> = {
  sandbox: 'https://sandbox.momodeveloper.mtn.com',
  production: 'https://proxy.momoapi.mtn.com',
};

/**
 * The customer's number as MoMo wants it: country code and number, digits only.
 * "0921234567" (South Sudan) → "211921234567"; "+211 92…" → "21192…".
 */
export function momoMsisdn(phone: string): string | null {
  let d = phone.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (/^0\d{9}$/.test(d)) d = `211${d.slice(1)}`;
  return /^\d{9,15}$/.test(d) ? d : null;
}

/** MoMo's failure reasons in words a customer understands. */
export function momoReason(reason: string | null | undefined): string {
  switch (reason) {
    case 'NOT_ENOUGH_FUNDS':
      return 'There was not enough money on the MoMo account.';
    case 'APPROVAL_REJECTED':
    case 'PAYER_DECLINED':
      return 'The payment was declined on the phone.';
    case 'EXPIRED':
    case 'PAYER_NOT_RESPONDING':
      return 'The payment was not approved in time on the phone.';
    case 'PAYER_NOT_FOUND':
    case 'PAYEE_NOT_FOUND':
      return 'This number has no MTN MoMo account.';
    case 'PAYER_LIMIT_REACHED':
      return 'The MoMo account has reached its limit.';
    default:
      return 'MTN MoMo did not complete the payment.';
  }
}

type Fetch = typeof fetch;

export class MomoClient {
  private token: string | null = null;
  private readonly base: string;
  private readonly account: MomoAccount;
  private readonly http: Fetch;
  private readonly timeoutMs: number;

  /** http: tests pass a fake MoMo. */
  constructor(account: MomoAccount, http: Fetch = fetch, timeoutMs = 15_000) {
    this.account = account;
    this.http = http;
    this.timeoutMs = timeoutMs;
    this.base = BASE_URL[account.environment];
  }

  private async call(path: string, init: RequestInit, auth: string): Promise<Response> {
    try {
      return await this.http(`${this.base}${path}`, {
        ...init,
        redirect: 'manual',
        headers: {
          ...(init.headers as Record<string, string> | undefined),
          Authorization: auth,
          'Ocp-Apim-Subscription-Key': this.account.subscriptionKey,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new MomoError(/timeout|abort/i.test(msg) ? 'MTN MoMo did not answer in time.' : 'MTN MoMo could not be reached.');
    }
  }

  /** An access token for this business's MoMo login (kept for this request). */
  async accessToken(): Promise<string> {
    if (this.token) return this.token;
    const basic = `Basic ${btoa(`${this.account.apiUser}:${this.account.apiKey}`)}`;
    const res = await this.call('/collection/token/', { method: 'POST' }, basic);
    const body = (await res.json().catch(() => null)) as { access_token?: string } | null;
    if (res.status === 401 || res.status === 403) throw new MomoError('The MTN MoMo API user, API key or subscription key is wrong.', res.status);
    if (!res.ok || !body?.access_token) throw new MomoError(`MTN MoMo refused the login (HTTP ${res.status}).`, res.status);
    this.token = body.access_token;
    return this.token;
  }

  private async bearer(): Promise<string> {
    return `Bearer ${await this.accessToken()}`;
  }

  /** Asks MoMo to charge the phone. referenceId is ours (a UUID) and names the payment from now on. */
  async requestToPay(p: { referenceId: string; amount: number; msisdn: string; externalId: string; note: string }): Promise<void> {
    const res = await this.call(
      '/collection/v1_0/requesttopay',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Reference-Id': p.referenceId,
          'X-Target-Environment': this.account.targetEnvironment,
        },
        body: JSON.stringify({
          amount: String(p.amount),
          currency: this.account.currency,
          externalId: p.externalId,
          payer: { partyIdType: 'MSISDN', partyId: p.msisdn },
          payerMessage: p.note.slice(0, 160),
          payeeNote: p.note.slice(0, 160),
        }),
      },
      await this.bearer(),
    );
    if (res.status === 202) return;
    const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
    if (res.status === 409) throw new MomoError('This payment was already sent to MTN MoMo.', 409);
    if (body?.code === 'PAYER_NOT_FOUND') throw new MomoError(momoReason('PAYER_NOT_FOUND'), res.status);
    throw new MomoError(`MTN MoMo did not accept the payment (HTTP ${res.status}${body?.code ? `, ${body.code}` : ''}).`, res.status);
  }

  /** MoMo's answer for a payment we asked for. */
  async paymentStatus(referenceId: string): Promise<MomoPayment> {
    const res = await this.call(
      `/collection/v1_0/requesttopay/${encodeURIComponent(referenceId)}`,
      { method: 'GET', headers: { 'X-Target-Environment': this.account.targetEnvironment } },
      await this.bearer(),
    );
    const body = (await res.json().catch(() => null)) as {
      status?: string;
      amount?: string | number;
      currency?: string;
      financialTransactionId?: string;
      reason?: string | { code?: string };
    } | null;
    if (res.status === 404) return { status: 'FAILED', amount: '', currency: '', financialTransactionId: null, reason: 'NOT_FOUND' };
    if (!res.ok || !body?.status) throw new MomoError(`MTN MoMo did not give the payment's status (HTTP ${res.status}).`, res.status);
    const status: MomoStatus = body.status === 'SUCCESSFUL' ? 'SUCCESSFUL' : body.status === 'FAILED' || body.status === 'REJECTED' || body.status === 'TIMEOUT' ? 'FAILED' : 'PENDING';
    const reason = typeof body.reason === 'string' ? body.reason : (body.reason?.code ?? null);
    return {
      status,
      amount: String(body.amount ?? ''),
      currency: body.currency ?? '',
      financialTransactionId: body.financialTransactionId ? String(body.financialTransactionId).slice(0, 80) : null,
      reason,
    };
  }

  /** Checks the login works (an access token), for the settings page's Test button. */
  async test(): Promise<void> {
    await this.accessToken();
  }
}

/** True when MoMo's answer is for exactly the amount and currency asked for. */
export function paidInFull(p: MomoPayment, amount: number, currency: string): boolean {
  return p.status === 'SUCCESSFUL' && Number(p.amount) === amount && p.currency.toUpperCase() === currency.toUpperCase();
}
