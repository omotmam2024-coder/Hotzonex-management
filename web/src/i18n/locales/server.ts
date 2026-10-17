// Fixed messages the server (database functions and Edge Functions) sends in English. The English
// text must match the server's message exactly: friendlyError() looks it up and shows the chosen
// language. Keys start with "server.". Messages with changing parts (names, numbers) are not here.

const en = {} as const;

type Keys = Record<keyof typeof en, string>;

const ar = {} satisfies Keys;

const sw = {} satisfies Keys;

export const server = { en, ar, sw };
