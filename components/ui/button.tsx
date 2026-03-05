import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../src/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/60',
  {
    variants: {
      variant: {
        default: 'bg-neutral-950 text-white hover:bg-neutral-800',
        secondary: 'bg-neutral-100 text-neutral-900 hover:bg-neutral-200',
        outline: 'border border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50',
        ghost: 'text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-6',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>

function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }
