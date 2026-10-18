import { LANGUAGES, useT } from '../i18n';

/**
 * English / العربية / Kiswahili, saved on this device. `tone="dark"` for the menu (white on blue),
 * `tone="light"` for public pages (login, sign-up, Buy page).
 */
export function LanguageSwitch({ tone = 'dark', bare = false }: { tone?: 'dark' | 'light'; bare?: boolean }) {
  const { lang, setLang, t } = useT();
  const box = bare ? '' : tone === 'dark' ? 'bg-white/[0.06] p-1' : 'bg-slate-100 p-1 ring-1 ring-slate-200';
  const on = tone === 'dark' ? 'bg-white/15 text-white' : 'bg-white text-slate-900 shadow-sm';
  const off = tone === 'dark' ? 'text-white/60 hover:bg-white/10 hover:text-white' : 'text-slate-600 hover:bg-white/70';
  return (
    <div className={`grid grid-cols-3 gap-1 rounded-xl ${box}`} role="radiogroup" aria-label={t('lang.label')}>
      {LANGUAGES.map((l) => (
        <button
          key={l.key}
          type="button"
          role="radio"
          lang={l.key}
          aria-checked={lang === l.key}
          onClick={() => setLang(l.key)}
          className={`${bare ? 'min-h-10' : 'min-h-11'} rounded-lg px-2 text-xs font-semibold ${lang === l.key ? on : off}`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
