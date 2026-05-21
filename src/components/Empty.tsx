import { cn } from '@/lib/utils'

export default function Empty() {
  return (
    <div className={cn('flex h-full items-center justify-center text-sm text-brand-gray')}>暂无内容</div>
  )
}
