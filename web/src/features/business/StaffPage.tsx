import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthProvider';
import { PageHeader } from '../../components/PageHeader';
import { Alert, Badge, Button, Card, Checkbox, Field, Select, Spinner, TextInput } from '../../components/ui';
import { friendlyError } from '../../lib/errors';
import { invokeFunction } from '../../lib/functions';
import { translateMessage, useT } from '../../i18n';
import { ROLE_LABELS } from '../../lib/nav';
import { useSites } from '../../hooks/queries';
import type { Role, StaffMember } from '../../lib/types';
import { staffSchema, validate } from '../../lib/validation';

interface StaffForm {
  id: string | null;
  email: string;
  password: string;
  full_name: string;
  role: Role;
  site_id: string;
  is_active: boolean;
}

interface EmailResult {
  email_sent: boolean;
  email_error?: string;
}

/** What the page says after a welcome email was (or was not) sent. */
interface Notice {
  tone: 'success' | 'warning';
  text: string;
}

const NEW_FORM: StaffForm = { id: null, email: '', password: '', full_name: '', role: 'seller', site_id: '', is_active: true };

function StaffEditor({ initial, onClose }: { initial: StaffForm; onClose: (notice?: Notice) => void }) {
  const { t, lang } = useT();
  const sites = useSites();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<StaffForm>(initial);
  const isNew = form.id === null;

  const save = useMutation({
    mutationFn: async () => {
      const v = validate(staffSchema(isNew), form);
      const common = {
        full_name: v.full_name,
        role: v.role,
        site_id: v.site_id || null,
        password: v.password,
      };
      if (isNew) {
        // The new staff member is emailed a welcome in the language the owner is using now.
        const r = await invokeFunction<EmailResult>('create-staff', { action: 'create', email: v.email, lang, ...common });
        return welcomeNotice(t, r, v.email ?? form.email, true);
      }
      await invokeFunction('create-staff', { action: 'update', id: form.id, is_active: form.is_active, ...common });
      return undefined;
    },
    onSuccess: (notice) => {
      void queryClient.invalidateQueries({ queryKey: ['staff'] });
      void queryClient.invalidateQueries({ queryKey: ['staff-options'] });
      void queryClient.invalidateQueries({ queryKey: ['staff-options-full'] });
      void queryClient.invalidateQueries({ queryKey: ['billing-usage'] });
      onClose(notice);
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  const set = <K extends keyof StaffForm>(key: K, value: StaffForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <Card>
      <h2 className="mb-4 text-lg font-bold">{isNew ? t('business.staff.addTitle') : t('business.staff.editTitle', { name: initial.full_name })}</h2>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('business.staff.fullName')}>
            <TextInput value={form.full_name} onChange={(e) => set('full_name', e.target.value)} maxLength={80} />
          </Field>
          <Field label={t('business.staff.email')}>
            <TextInput type="email" value={form.email} onChange={(e) => set('email', e.target.value)} disabled={!isNew} autoComplete="off" dir="ltr" />
          </Field>
          <Field
            label={isNew ? t('business.staff.password') : t('business.staff.newPassword')}
            hint={isNew ? t('business.staff.passwordHint') : t('business.staff.passwordKeep')}
          >
            <TextInput type="password" value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label={t('business.staff.role')}>
            <Select value={form.role} onChange={(e) => set('role', e.target.value as Role)}>
              <option value="seller">{t('business.staff.roleSeller')}</option>
              <option value="manager">{t('business.staff.roleManager')}</option>
              <option value="admin">{t('business.staff.roleAdmin')}</option>
            </Select>
          </Field>
          <Field label={t('common.site')} hint={form.role === 'admin' ? t('business.staff.siteHintAdmin') : undefined}>
            <Select value={form.site_id} onChange={(e) => set('site_id', e.target.value)}>
              <option value="">{form.role === 'admin' ? t('common.allSites') : t('business.staff.chooseSite')}</option>
              {(sites.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {!isNew && <Checkbox label={t('business.staff.active')} checked={form.is_active} onChange={(v) => set('is_active', v)} />}
        {save.error && <Alert tone="error">{friendlyError(save.error)}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? <Spinner /> : null} {isNew ? t('business.staff.create') : t('business.staff.saveChanges')}
          </Button>
          <Button variant="ghost" onClick={() => onClose()}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function welcomeNotice(t: ReturnType<typeof useT>['t'], r: EmailResult, email: string, created: boolean): Notice {
  if (r.email_sent) return { tone: 'success', text: t(created ? 'business.staff.createdEmailed' : 'business.staff.emailed', { email }) };
  const reason = r.email_error ? translateMessage(r.email_error) : '';
  return { tone: 'warning', text: t(created ? 'business.staff.createdNotEmailed' : 'business.staff.notEmailed', { email, reason }) };
}

/** "Send welcome email" on a staff card: the same email as when the account was made. */
function SendWelcome({ member, onDone }: { member: StaffMember; onDone: (notice: Notice) => void }) {
  const { t, lang } = useT();
  const send = useMutation({
    mutationFn: () => invokeFunction<EmailResult>('create-staff', { action: 'welcome', id: member.id, lang }),
    onSuccess: (r) => onDone(welcomeNotice(t, r, member.email, false)),
    onError: (err) => onDone({ tone: 'warning', text: friendlyError(err) }),
  });
  return (
    <Button variant="ghost" onClick={() => send.mutate()} disabled={send.isPending} className="text-sm">
      {send.isPending && <Spinner />} {t('business.staff.sendWelcome')}
    </Button>
  );
}

export function StaffPage() {
  const { t } = useT();
  const { profile } = useAuth();
  const sites = useSites();
  const [editing, setEditing] = useState<StaffForm | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const staff = useQuery({
    queryKey: ['staff'],
    queryFn: async () => (await invokeFunction<{ staff: StaffMember[] }>('create-staff', { action: 'list' })).staff ?? [],
  });

  const siteName = (id: string | null) => (id ? (sites.data?.find((s) => s.id === id)?.name ?? t('common.unknownSite')) : t('common.allSites'));

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('nav.staff')}
        subtitle={t('business.staff.subtitle')}
        actions={
          !editing && (
            <Button onClick={() => setEditing(NEW_FORM)} className="min-h-11">
              {t('business.staff.add')}
            </Button>
          )
        }
      />

      {notice && (
        <Alert tone={notice.tone}>
          <span className="flex flex-wrap items-center justify-between gap-2">
            {notice.text}
            <button type="button" className="text-sm font-semibold underline" onClick={() => setNotice(null)}>
              {t('sales.pay.dismiss')}
            </button>
          </span>
        </Alert>
      )}

      {editing && (
        <StaffEditor
          key={editing.id ?? 'new'}
          initial={editing}
          onClose={(n) => {
            setEditing(null);
            if (n) setNotice(n);
          }}
        />
      )}

      {staff.isLoading && <Spinner className="h-8 w-8 text-brand-600" />}
      {staff.error && <Alert tone="error">{friendlyError(staff.error)}</Alert>}

      <div className="grid gap-3 md:grid-cols-2">
        {(staff.data ?? []).map((m) => (
          <Card key={m.id} className={m.is_active ? '' : 'opacity-60'}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-bold">
                  {m.full_name} {m.id === profile?.id && <span className="font-normal text-slate-500">{t('business.staff.you')}</span>}
                </div>
                <div className="truncate text-sm text-slate-600">{m.email}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge color="blue">{ROLE_LABELS[m.role]}</Badge>
                  <Badge color="gray">{siteName(m.site_id)}</Badge>
                  {!m.is_active && <Badge color="red">{t('business.staff.disabled')}</Badge>}
                </div>
                {m.is_active && m.id !== profile?.id && (
                  <div className="mt-2">
                    <SendWelcome member={m} onDone={setNotice} />
                  </div>
                )}
              </div>
              <Button
                variant="secondary"
                onClick={() =>
                  setEditing({
                    id: m.id,
                    email: m.email,
                    password: '',
                    full_name: m.full_name,
                    role: m.role,
                    site_id: m.site_id ?? '',
                    is_active: m.is_active,
                  })
                }
              >
                {t('common.edit')}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
