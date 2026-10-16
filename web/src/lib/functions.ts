import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase, supabaseAnonKey, supabaseUrl } from './supabase';
import { friendlyError } from './errors';

/** Calls a Supabase Edge Function and turns its { error } replies into plain thrown messages. */
export async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error instanceof FunctionsHttpError) {
    const payload = (await error.context.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? friendlyError(error));
  }
  if (error) throw new Error(friendlyError(error));
  if (data === null) throw new Error('The server sent an empty reply.');
  return data;
}

/**
 * Calls a public Edge Function (one that needs no login) straight away, without the login library:
 * a customer's page never waits for a login kept in the browser or for another open tab. Gives up
 * after `timeoutMs` with a plain message, so the page can offer "Try again" instead of loading for ever.
 */
export async function callPublicFunction<T>(name: string, body: Record<string, unknown>, timeoutMs = 20_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) throw new Error('The connection is too slow right now. Check your internet and try again.');
    throw new Error(friendlyError(err));
  } finally {
    clearTimeout(timer);
  }
  const payload = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(payload?.error ?? 'Something went wrong. Please try again.');
  if (payload === null) throw new Error('The server sent an empty reply.');
  return payload;
}
