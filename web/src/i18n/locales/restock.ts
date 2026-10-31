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

type Keys = Record<keyof typeof en, string>;

const ar = {
  'nav.restock': 'إعادة التخزين التلقائية',
  'restock.title': 'إعادة التخزين التلقائية',
  'restock.subtitle': 'حافظ على وجود بطاقات في المخزون دون أن تتذكر إنشاءها',
  'restock.rules': 'عندما يقل عدد بطاقات باقة معينة على الراوتر عما تريد الاحتفاظ به، ينشئ النظام بطاقات جديدة ويضعها على الراوتر تلقائياً. يعمل فقط والراوتر متصل، وينتظر 30 دقيقة بين الدفعات، ولا يضيف أكثر من 2000 بطاقة في اليوم للقاعدة الواحدة، ويُحتسب من حد القسائم الشهري. إذا تعذّرت الإضافة تصلك تنبيهات.',
  'restock.add': 'قاعدة جديدة',
  'restock.none': 'لا توجد قواعد إعادة تخزين تلقائية بعد. اضغط «قاعدة جديدة» لإنشاء واحدة.',
  'restock.router': 'الراوتر',
  'restock.plan': 'الباقة',
  'restock.choose': 'اختر…',
  'restock.keepMin': 'الاحتفاظ بما لا يقل عن',
  'restock.keepMinHint': 'عندما يبقى عدد أقل من هذا من البطاقات يُنشأ المزيد.',
  'restock.addQuantity': 'عدد البطاقات المضافة في كل مرة',
  'restock.addQuantityHint': 'من 1 إلى 1000. اختر ما يكفي لعدة أيام من البيع.',
  'restock.keepMinShort': 'الحد الأدنى',
  'restock.addShort': 'تُضاف كل مرة',
  'restock.lastRun': 'آخر تخزين',
  'restock.never': 'لم يحدث بعد',
  'restock.create': 'إنشاء القاعدة',
  'restock.confirmRemove': 'اضغط مرة أخرى للحذف',
} satisfies Keys;

const sw = {
  'nav.restock': 'Kujaza vocha kiotomatiki',
  'restock.title': 'Kujaza vocha kiotomatiki',
  'restock.subtitle': 'Weka vocha kwenye hisa bila kukumbuka kuzitengeneza',
  'restock.rules': 'Router ikiwa na vocha chache za kifurushi kuliko unavyotaka kuweka, mfumo hutengeneza vocha mpya na kuziweka kwenye router wenyewe. Hufanya kazi router ikiwa mtandaoni tu, husubiri dakika 30 kati ya makundi, haongezi zaidi ya vocha 2000 kwa siku kwa kanuni moja, na huhesabiwa kwenye kikomo chako cha vocha cha mwezi. Ikishindwa kuongeza, unapata taarifa.',
  'restock.add': 'Kanuni mpya',
  'restock.none': 'Bado hakuna kanuni za kujaza vocha kiotomatiki. Gusa “Kanuni mpya” kutengeneza.',
  'restock.router': 'Router',
  'restock.plan': 'Kifurushi',
  'restock.choose': 'Chagua…',
  'restock.keepMin': 'Weka angalau',
  'restock.keepMinHint': 'Vocha zikibaki chini ya idadi hii, nyingine hutengenezwa.',
  'restock.addQuantity': 'Vocha za kuongeza kila mara',
  'restock.addQuantityHint': 'Kuanzia 1 hadi 1000. Chagua za kutosha kwa siku kadhaa za mauzo.',
  'restock.keepMinShort': 'Angalau',
  'restock.addShort': 'Huongezwa kila mara',
  'restock.lastRun': 'Ilijazwa mwisho',
  'restock.never': 'Bado',
  'restock.create': 'Tengeneza kanuni',
  'restock.confirmRemove': 'Gusa tena kuondoa',
} satisfies Keys;

export const restock = { en, ar, sw };
