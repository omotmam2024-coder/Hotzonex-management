// Texts of the sales pages. Keys start with "sales.". Every English key must also have Arabic and Kiswahili.

const en = {} as const;

type Keys = Record<keyof typeof en, string>;

const ar = {} satisfies Keys;

const sw = {} satisfies Keys;

export const sales = { en, ar, sw };
