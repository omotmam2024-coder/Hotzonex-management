// Texts of the plans pages. Keys start with "plans.". Every English key must also have Arabic and Kiswahili.

const en = {
  'plans.subtitle':
    "A plan is what you sell: price, time and speed. Tick the routers that sell it and Hotzonex makes its own profile on them (MikroTicket's profiles are not used).",
  'plans.newButton': '+ New plan',
  'plans.newFor': '+ New plan for {router}',
  'plans.tab.label': 'Plans by router',
  'plans.tab.none': 'Not on a router',
  'plans.tab.text': 'Plans sold on {router}. Each router has its own plans; tick another router in a plan only if it should be sold there too.',
  'plans.tab.empty': '{router} has no plans yet.',
  'plans.tab.emptyAll': 'No plans yet.',
  'plans.newPlan': 'New plan',
  'plans.editTitle': 'Edit {name}',
  'plans.editorIntro':
    "Set the plan and tick the routers that sell it. Hotzonex makes its own user profile on those routers (named hzc-…), separate from MikroTicket's profiles.",

  'plans.field.name': 'Plan name',
  'plans.field.price': 'Price (SSP)',
  'plans.field.time': 'Time allowed',
  'plans.field.timeHint': 'Total connected time (uptime limit on the router)',
  'plans.field.validity': 'Validity after first login',
  'plans.field.validityHint': 'The voucher expires this long after first use, even if time is left',
  'plans.field.noValidity': 'No validity limit',
  'plans.field.speed': 'Speed limit (upload/download)',
  'plans.field.speedHint': 'e.g. 2M/2M or 512k/1M. Empty = no limit',
  'plans.field.devices': 'Devices per code',
  'plans.field.devicesHint': 'How many devices may use one code at the same time',
  'plans.field.data': 'Data limit',
  'plans.field.dataHint': 'Empty = no data limit. 1 GB = 1024 MB; GB can have decimals, e.g. 1.5',
  'plans.field.none': 'none',
  'plans.noLimit': 'no limit',

  'plans.unit.minutes': 'minutes',
  'plans.unit.hours': 'hours',
  'plans.unit.days': 'days',
  'plans.unit.mb': 'MB',
  'plans.unit.gb': 'GB',

  'plans.routersLabel': 'Routers that sell this plan',
  'plans.noRouters': 'No routers yet. Add one on the Routers page.',
  'plans.note.made': 'profile made by Hotzonex',
  'plans.note.own': 'uses its own profile {profile}',
  'plans.note.pending': 'profile is made once the router is connected',
  'plans.note.willMake': 'Hotzonex makes the profile',
  'plans.unticked.made': 'No longer sold here; the profile Hotzonex made is removed from this router (kept while users are on it)',
  'plans.unticked.own': 'No longer sold here; the router keeps its own profile',
  'plans.ownProfileNote':
    'Routers using their own profile keep their own speed and devices per code; the values above apply to profiles Hotzonex makes.',
  'plans.colourLabel': 'Colour (cards and Sell buttons)',
  'plans.colourAria': 'Colour {c}',
  'plans.customColour': 'Custom colour',
  'plans.activeLabel': 'Plan active (can be sold and generated)',
  'plans.savePlan': 'Save plan',

  'plans.saved': '{name} saved.',
  'plans.saved.adding': 'Its profile is being added to {n} router(s).',
  'plans.saved.own': '{n} router(s) use their own matching profile as it is.',
  'plans.saved.removing': 'Its profile is being removed from {n} router(s) (kept there while users are on it).',
  'plans.saved.noLonger': 'No longer sold on {n} router(s); their own profile stays on the router.',
  'plans.saved.updated': 'Profiles made by Hotzonex are updated on the routers within a minute.',
  'plans.err.duplicateRouter': 'A plan with the same name, price and time already exists on one of these routers.',
  'plans.err.duplicateName': 'A plan with this name already exists. Choose another name.',

  'plans.delete.made': 'The profile Hotzonex made is deleted from the routers too (kept while hotspot users are on it).',
  'plans.delete.own': "Routers that use their own profile (e.g. MikroTicket's) keep it; it is just no longer a plan here.",
  'plans.delete.confirm': 'Delete plan {name}? {details}',
  'plans.delete.kept': 'The router(s) keep their own profile.',
  'plans.deleted': '{name} deleted.',
  'plans.delete.routerFailed': 'The router could not delete the profile.',
  'plans.deletedFromRouter': '{name} deleted, and its profile removed from the router.',
  'plans.switchedOff': '{name} is switched off. Its profile is deleted from the router as soon as the router is reachable, then the plan disappears.',

  'plans.off': 'Off',
  'plans.card.valid': 'valid {d}',
  'plans.card.anySpeed': 'any speed',
  'plans.card.noDataLimit': 'no data limit',
  'plans.card.devices': '{n} device(s)',
  'plans.card.noRouter': 'No router: tick one',
  'plans.old.summary': 'Old MikroTicket plans ({n}) — switched off',
  'plans.old.text':
    'These were made from MikroTicket profiles. They are no longer sold in Hotzonex, but kept so past sales and reports keep their names. MikroTicket cards on your routers keep working and their sales are still counted.',
} as const;

export type Keys = Record<keyof typeof en, string>;

export const plans = { en };
