import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { PageHeader } from '../components/PageHeader';
import { Alert, Badge, Button, Card, Checkbox, Field, Select, Spinner, TextInput } from '../components/ui';
import { friendlyError } from '../lib/errors';
import { invokeFunction } from '../lib/functions';
import { ROLE_LABELS } from '../lib/nav';
import { useSites } from '../lib/queries';
import type { Role, StaffMember } from '../lib/types';

interface StaffForm {
  id: string | null;
  email: string;
  password: string;
  full_name: string;
  role: Role;
  site_id: string;
  is_active: boolean;
}

const NEW_FORM: StaffForm = { id: null, email: '', password: '', full_name: '', role: 'seller', site_id: '', is_active: true };

function StaffEditor({ initial, onClose }: { initial: StaffForm; onClose: () => void }) {
  const sites = useSites();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<StaffForm>(initial);
  const isNew = form.id === null;

  const save = useMutation({
    mutationFn: async () => {
      if (!form.full_name.trim()) throw new Error('Full name is required.');
      if (isNew && !form.email.trim()) throw new Error('Email is required.');
      if ((isNew || form.password) && form.password.length < 8) throw new Error('Password must be at least 8 characters.');
      if (form.role !== 'admin' && !form.site_id) throw new Error('Managers and sellers must belong to a site.');
      const common = {
        full_name: form.full_name.trim(),
        role: form.role,
        site_id: form.site_id || null,
        password: form.password,
      };
      if (isNew) await invokeFunction('create-staff', { action: 'create', email: form.email.trim(), ...common });
      else await invokeFunction('create-staff', { action: 'update', id: form.id, is_active: form.is_active, ...common });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['staff'] });
      onClose();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  const set = <K extends keyof StaffForm>(key: K, value: StaffForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <Card>
      <h2 className="mb-4 text-lg font-bold">{isNew ? 'Add staff member' : `Edit ${initial.full_name}`}</h2>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name">
            <TextInput value={form.full_name} onChange={(e) => set('full_name', e.target.value)} maxLength={80} />
          </Field>
          <Field label="Email (login)">
            <TextInput type="email" value={form.email} onChange={(e) => set('email', e.target.value)} disabled={!isNew} autoComplete="off" />
          </Field>
          <Field label={isNew ? 'Password' : 'New password'} hint={isNew ? 'At least 8 characters' : 'Leave blank to keep the current password'}>
            <TextInput type="password" value={form.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Role">
            <Select value={form.role} onChange={(e) => set('role', e.target.value as Role)}>
              <option value="seller">Seller — sells and prints receipts</option>
              <option value="manager">Manager — runs one site</option>
              <option value="admin">Admin — everything</option>
            </Select>
          </Field>
          <Field label="Site" hint={form.role === 'admin' ? 'Admins can leave this empty to see all sites' : undefined}>
            <Select value={form.site_id} onChange={(e) => set('site_id', e.target.value)}>
              <option value="">{form.role === 'admin' ? 'All sites' : 'Choose a site…'}</option>
              {(sites.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {!isNew && <Checkbox label="Account active (can log in)" checked={form.is_active} onChange={(v) => set('is_active', v)} />}
        {save.error && <Alert tone="error">{save.error.message}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? <Spinner /> : null} {isNew ? 'Create account' : 'Save changes'}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function StaffPage() {
  const { profile } = useAuth();
  const sites = useSites();
  const [editing, setEditing] = useState<StaffForm | null>(null);
  const staff = useQuery({
    queryKey: ['staff'],
    queryFn: async () => (await invokeFunction<{ staff: StaffMember[] }>('create-staff', { action: 'list' })).staff ?? [],
  });

  const siteName = (id: string | null) => (id ? (sites.data?.find((s) => s.id === id)?.name ?? 'Unknown site') : 'All sites');

  return (
    <div className="space-y-4">
      <PageHeader
        title="Staff"
        subtitle="Logins for admins, managers and sellers"
        actions={
          !editing && (
            <Button onClick={() => setEditing(NEW_FORM)} className="min-h-11">
              + Add staff
            </Button>
          )
        }
      />

      {editing && <StaffEditor key={editing.id ?? 'new'} initial={editing} onClose={() => setEditing(null)} />}

      {staff.isLoading && <Spinner className="h-8 w-8 text-brand-600" />}
      {staff.error && <Alert tone="error">{friendlyError(staff.error)}</Alert>}

      <div className="grid gap-3 md:grid-cols-2">
        {(staff.data ?? []).map((m) => (
          <Card key={m.id} className={m.is_active ? '' : 'opacity-60'}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-bold">
                  {m.full_name} {m.id === profile?.id && <span className="font-normal text-slate-500">(you)</span>}
                </div>
                <div className="truncate text-sm text-slate-600">{m.email}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge color="blue">{ROLE_LABELS[m.role]}</Badge>
                  <Badge color="gray">{siteName(m.site_id)}</Badge>
                  {!m.is_active && <Badge color="red">Disabled</Badge>}
                </div>
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
                Edit
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
