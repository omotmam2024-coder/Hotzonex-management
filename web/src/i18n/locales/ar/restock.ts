// Arabic texts for locales/restock.ts (same keys). Loaded only when this language is chosen.
import type { Keys } from '../restock';

export const restock = {
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
