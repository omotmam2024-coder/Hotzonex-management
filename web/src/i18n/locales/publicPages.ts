// Texts of the public pages. Keys start with "public.". Every English key must also have Arabic and Kiswahili.

const en = {} as const;

type Keys = Record<keyof typeof en, string>;

const ar = {} satisfies Keys;

const sw = {} satisfies Keys;

export const publicPages = { en, ar, sw };
