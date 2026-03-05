import * as React from 'react'
import { cn } from '../../src/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'min-h-16 w-full rounded-lg border bg-[var(--color-input-bg)] px-3 py-2 text-sm transition-all placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/30 focus-visible:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      style={{
        borderColor: 'var(--color-input-border)',
        color: 'var(--color-text-primary)',
      }}
      {...props}
    />
  )
}

export { Textarea }
