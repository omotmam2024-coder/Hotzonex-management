// Texts of the vouchers pages. Keys start with "vouchers.". Every English key must also have Arabic and Kiswahili.

const en = {} as const;

type Keys = Record<keyof typeof en, string>;

const ar = {} satisfies Keys;

const sw = {} satisfies Keys;

export const vouchers = { en, ar, sw };
