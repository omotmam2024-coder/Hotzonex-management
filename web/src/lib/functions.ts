import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';
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
