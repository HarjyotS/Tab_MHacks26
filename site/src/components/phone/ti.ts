import type { ThreadItem } from '@/lib/thread'

/** Class for a thread row wrapper; sets the side the pop-in grows from. */
export function tiClass(it: ThreadItem): string {
  return 'ti ti--' + it.type + (it.type === 'msg' ? (it.incoming ? ' ti--in' : ' ti--out') : '')
}
