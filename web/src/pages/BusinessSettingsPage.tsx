import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useAuth } from '../auth/AuthProvider';
import { PageHeader } from '../components/PageHeader';
import { Alert, Button, Card, Field, Spinner, TextInput } from '../components/ui';
import { useBusinessSettings } from '../lib/business';
import { friendlyError } from '../lib/errors';
import { formatSSP, formatUsd } from '../lib/format';
import { supabase } from '../lib/supabase';
import { validate } from '../lib/validation';

const MAX_LOGO_BYTES = 1024 * 1024;
const LOGO_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

const settingsSchema = z.object({
  name: z.string().trim().min(1, 'Type the business name.').max(100, 'The business name is too long (max 100 characters).'),
  usdRate: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : Number(v.replace(/,/g, ''))))
    .refine((v) => v === null || (Number.isFinite(v) && v > 0 && v <= 1_000_000), 'Type how many SSP make 1 USD (for example 4500), or leave it empty.'),
});

/** The owner's settings: the name and logo printed on cards and the Buy page, and the USD rate. */
export function BusinessSettingsPage() {
  const { business, reload } = useAuth();
  const settings = useBusinessSettings();
  const queryClient = useQueryClient();
  const [name, setName] = useState(business?.name ?? '');
  const [logoUrl, setLogoUrl] = useState(business?.logo_url ?? '');
  const [usdRate, setUsdRate] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (settings.data?.usdRate) setUsdRate(String(settings.data.usdRate));
  }, [settings.data?.usdRate]);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const ext = LOGO_TYPES[file.type];
      if (!ext) throw new Error('Choose a PNG, JPG or WebP picture.');
      if (file.size > MAX_LOGO_BYTES) throw new Error('The picture is too big: use one under 1 MB.');
      if (!business) throw new Error('Your business is not loaded yet.');
      const path = `${business.id}/logo-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('logos').upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw new Error(/bucket not found/i.test(error.message) ? 'Logo uploads need the database update of 16 October (migration 20261016180000).' : friendlyError(error));
      return supabase.storage.from('logos').getPublicUrl(path).data.publicUrl;
    },
    onSuccess: (url) => {
      setLogoUrl(url);
      setNotice('Picture uploaded. Tap Save to use it.');
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const v = validate(settingsSchema, { name, usdRate });
      const { error } = await supabase.rpc('save_business_settings', { p_name: v.name, p_logo_url: logoUrl || null, p_usd_rate: v.usdRate });
      if (error?.code === 'PGRST202') throw new Error('Business settings need the database update of 16 October (migration 20261016180000).');
      if (error) throw new Error(friendlyError(error));
    },
    onSuccess: async () => {
      setNotice('Saved. Printed cards, receipts and the Buy page now use these settings.');
      await queryClient.invalidateQueries({ queryKey: ['business-settings'] });
      await reload();
    },
  });

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    setNotice(null);
    if (file) upload.mutate(file);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setNotice(null);
    save.mutate();
  }

  const rateNumber = Number(usdRate.replace(/,/g, ''));
  const example = usdRate && rateNumber > 0 ? formatUsd(1000, rateNumber) : '';

  return (
    <div className="space-y-4">
      <PageHeader title="Business settings" subtitle="Your name and logo on cards, receipts and the Buy page, and the dollar rate" />
      {settings.data?.needsUpdate && (
        <Alert tone="warning">These settings need the database update of 16 October (migration 20261016180000). Ask Hotzonex Cloud to apply it.</Alert>
      )}
      <Card>
        <form onSubmit={submit} className="space-y-5" noValidate>
          <Field label="Business name" hint="Shown on printed cards and on your Buy page.">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoComplete="organization" />
          </Field>

          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">Logo</span>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl bg-slate-100 ring-1 ring-slate-200">
                {logoUrl ? <img src={logoUrl} alt="Your logo" className="h-full w-full object-contain" /> : <span className="text-xs text-slate-500">No logo</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onFile} />
                <Button type="button" variant="secondary" onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
                  {upload.isPending && <Spinner />} {logoUrl ? 'Change picture' : 'Upload picture'}
                </Button>
                {logoUrl && (
                  <Button type="button" variant="secondary" onClick={() => setLogoUrl('')}>
                    Remove
                  </Button>
                )}
              </div>
            </div>
            <p className="mt-1 text-sm text-slate-600">PNG, JPG or WebP, under 1 MB. A square picture prints best.</p>
            {upload.error && <Alert tone="error">{friendlyError(upload.error)}</Alert>}
          </div>

          <Field label="Dollar rate: SSP for 1 USD (optional)" hint={example ? `Example: ${formatSSP(1000)} shows as ${example}.` : 'Leave empty to show SSP only.'}>
            <TextInput value={usdRate} onChange={(e) => setUsdRate(e.target.value.replace(/[^0-9.,]/g, '').slice(0, 12))} inputMode="decimal" placeholder="e.g. 4500" />
          </Field>

          {save.error && <Alert tone="error">{friendlyError(save.error)}</Alert>}
          {notice && <Alert tone="success">{notice}</Alert>}
          <Button type="submit" disabled={save.isPending} className="min-h-12 px-8 text-lg">
            {save.isPending && <Spinner />} Save
          </Button>
        </form>
      </Card>
    </div>
  );
}
