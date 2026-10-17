// Texts of the routers pages. Keys start with "routers.". Every English key must also have Arabic and Kiswahili.

const en = {} as const;

type Keys = Record<keyof typeof en, string>;

const ar = {} satisfies Keys;

const sw = {} satisfies Keys;

export const routers = { en, ar, sw };
