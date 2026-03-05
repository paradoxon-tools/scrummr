import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../src/lib/utils'

const badgeVariants = cva('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', {
  variants: {
    variant: {
      default: 'border-neutral-200 bg-neutral-100 text-neutral-800',
      secondary: 'border-neutral-300 bg-white text-neutral-700',
      success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      warning: 'border-amber-200 bg-amber-50 text-amber-700',
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
