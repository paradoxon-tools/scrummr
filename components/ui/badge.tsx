import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../src/lib/utils'

const badgeVariants = cva('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-tight', {
  variants: {
    variant: {
      default: 'border-[var(--color-border)] bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)]',
      secondary: 'border-[var(--color-border)] bg-transparent text-[var(--color-text-tertiary)]',
      success: 'border-[color:var(--color-success)]/20 bg-[var(--color-success-subtle)] text-[var(--color-success)]',
      warning: 'border-[color:var(--color-warning)]/20 bg-[var(--color-warning-subtle)] text-[var(--color-warning)]',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
})

function Badge({ className, variant, ...props }: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
