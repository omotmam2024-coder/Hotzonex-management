// Texts of the automatic restock page. Every English key must also have Arabic and Kiswahili.

const en = {
  'nav.restock': 'Auto restock',
  'restock.title': 'Automatic restock',
  'restock.subtitle': 'Keep cards in stock without remembering to make them',
  'restock.rules': 'When a router has fewer cards of a plan than you want to keep, the system makes new cards and puts them on the router by itself. It only works while the router is online, waits 30 minutes between batches, never adds more than 2000 cards a day for one rule, and counts towards your monthly voucher limit. If it cannot add cards, you get an alert.',
  'restock.add': 'New rule',
  'restock.none': 'No automatic restock rules yet. Tap “New rule” to make one.',
  'restock.router': 'Router',
  'restock.plan': 'Plan',
  'restock.choose': 'Choose…',
  'restock.keepMin': 'Keep at least',
  'restock.keepMinHint': 'When fewer cards than this are left, more are made.',
  'restock.addQuantity': 'Cards to add each time',
  'restock.addQuantityHint': 'From 1 to 1000. Pick enough for a few days of selling.',
  'restock.keepMinShort': 'Keep at least',
  'restock.addShort': 'Add each time',
  'restock.lastRun': 'Last restocked',
  'restock.never': 'Not yet',
  'restock.create': 'Create rule',
  'restock.confirmRemove': 'Tap again to remove',
}

export type Keys = Record<keyof typeof en, string>;

export const restock = { en };
