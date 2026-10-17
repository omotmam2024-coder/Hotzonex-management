// Texts of the expenses pages. Keys start with "expenses.". Every English key must also have Arabic and Kiswahili.

const en = {} as const;

type Keys = Record<keyof typeof en, string>;

const ar = {} satisfies Keys;

const sw = {} satisfies Keys;

export const expenses = { en, ar, sw };
