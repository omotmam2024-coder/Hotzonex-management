import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useAuth } from '../../auth/AuthProvider';
import { PageHeader } from '../../components/PageHeader';
import { Alert, Button, Card, Field, Spinner, TextInput } from '../../components/ui';
import { useBusinessSettings } from '../../hooks/useBusinessSettings';
import { useT } from '../../i18n';
import { translate } from '../../i18n/translate';
import { friendlyError } from '../../lib/errors';
import { formatSSP, formatUsd } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { validate } from '../../lib/validation';

const MAX_LOGO_BYTES = 1024 * 1024;
const LOGO_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

const settingsSchema = () =>
  z.object({
    name: z.string().trim().min(1, translate('business.settings.errName')).max(100, translate('business.settings.errNameLong')),
    usdRate: z
      .string()
      .trim()
      .transform((v) => (v === '' ? null : Number(v.replace(/,/g, ''))))
      .refine((v) => v === null || (Number.isFinite(v) && v > 0 && v <= 1_000_000), translate('business.settings.errUsdRate')),
  });

/** The owner's settings: the name and logo printed on cards and the Buy page, and the USD rate. */
export function BusinessSettingsPage() {
  const { t } = useT();
  return (
    <div className="space-y-4">
      <PageHeader title={t('nav.business')} subtitle={t('business.settings.subtitle')} />
      <Card>
        <BusinessSettingsForm />
      </Card>
    </div>
  );
}

/** The settings form (also the first step of the welcome wizard). */
export function BusinessSettingsForm({ onSaved, saveLabel }: { onSaved?: () => void; saveLabel?: string }) {
  const { t } = useT();
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
      if (!ext) throw new Error(t('business.settings.errPictureType'));
      if (file.size > MAX_LOGO_BYTES) throw new Error(t('business.settings.errPictureBig'));
      if (!business) throw new Error(t('business.settings.errNotLoaded'));
      const path = `${business.id}/logo-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('logos').upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw new Error(friendlyError(error));
      return supabase.storage.from('logos').getPublicUrl(path).data.publicUrl;
    },
    onSuccess: (url) => {
      setLogoUrl(url);
      setNotice(t('business.settings.uploaded'));
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const v = validate(settingsSchema(), { name, usdRate });
      const { error } = await supabase.rpc('save_business_settings', { p_name: v.name, p_logo_url: logoUrl || null, p_usd_rate: v.usdRate });
      if (error) throw new Error(friendlyError(error));
    },
    onSuccess: async () => {
      setNotice(t('business.settings.saved'));
      await queryClient.invalidateQueries({ queryKey: ['business-settings'] });
      await reload();
      onSaved?.();
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
      {settings.error && <Alert tone="error">{friendlyError(settings.error)}</Alert>}
      <form onSubmit={submit} className="space-y-5" noValidate>
          <Field label={t('business.settings.name')} hint={t('business.settings.nameHint')}>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoComplete="organization" />
          </Field>

          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">{t('business.settings.logo')}</span>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl bg-slate-100 ring-1 ring-slate-200">
                {logoUrl ? <img src={logoUrl} alt={t('business.settings.logoAlt')} className="h-full w-full object-contain" /> : <span className="text-xs text-slate-500">{t('business.settings.noLogo')}</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onFile} />
                <Button type="button" variant="secondary" onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
                  {upload.isPending && <Spinner />} {logoUrl ? t('business.settings.changePicture') : t('business.settings.uploadPicture')}
                </Button>
                {logoUrl && (
                  <Button type="button" variant="secondary" onClick={() => setLogoUrl('')}>
                    {t('common.remove')}
                  </Button>
                )}
              </div>
            </div>
            <p className="mt-1 text-sm text-slate-600">{t('business.settings.logoHint')}</p>
            {upload.error && <Alert tone="error">{friendlyError(upload.error)}</Alert>}
          </div>

          <Field
            label={t('business.settings.rate')}
            hint={example ? t('business.settings.rateExample', { ssp: formatSSP(1000), usd: example }) : t('business.settings.rateEmpty')}
          >
            <TextInput value={usdRate} onChange={(e) => setUsdRate(e.target.value.replace(/[^0-9.,]/g, '').slice(0, 12))} inputMode="decimal" placeholder={t('business.settings.ratePlaceholder')} dir="ltr" />
          </Field>

          {save.error && <Alert tone="error">{friendlyError(save.error)}</Alert>}
          {notice && <Alert tone="success">{notice}</Alert>}
          <Button type="submit" disabled={save.isPending} className="min-h-12 px-8 text-lg">
            {save.isPending && <Spinner />} {saveLabel ?? t('common.save')}
          </Button>
      </form>
    </div>
  );
}
