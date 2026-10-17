import { createContext, Fragment, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { applyLang, getLang, onLangChange, setLang, type Lang } from './core';
import { dictionaries, type TKey } from './dictionaries';
import { fill, type Vars } from './translate';

export { translate, translateMessage, type Vars } from './translate';

export { LANGUAGES, isLang, type Lang } from './core';
export type { TKey } from './dictionaries';

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TKey, vars?: Vars) => string;
  dir: 'ltr' | 'rtl';
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setState] = useState<Lang>(getLang);
  useEffect(() => {
    applyLang();
    return onLangChange(setState);
  }, []);
  const value = useMemo<I18n>(
    () => ({ lang, setLang, t: (key, vars) => fill(dictionaries[lang][key] ?? dictionaries.en[key] ?? key, vars), dir: lang === 'ar' ? 'rtl' : 'ltr' }),
    [lang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** const { t, lang } = useT(); t('sell.title') */
export function useT(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useT must be used inside <I18nProvider>');
  return ctx;
}

/** Draws its children again from scratch when the language changes, so every text follows. */
export function LangRoot({ children }: { children: ReactNode }) {
  const { lang } = useT();
  return <Fragment key={lang}>{children}</Fragment>;
}
