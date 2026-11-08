/*
 * Adapted from shadcn/ui's Badge (https://ui.shadcn.com, MIT License, Copyright (c) 2023
 * shadcn; notice in THIRD_PARTY_NOTICES.md), set in the design values' names, with a
 * `category` variant that takes the nearest category's own look.
 */
import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils.ts';

export const badgeVariants = cva(
  'type-caption inline-flex w-fit shrink-0 items-center gap-1 rounded-chip px-2 py-0.5 font-semibold [&_svg]:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground',
        secondary: 'bg-secondary text-secondary-foreground',
        outline: 'border border-border text-foreground',
        live: 'bg-live text-live-foreground',
        notice: 'bg-notice text-notice-foreground',
        category: 'bg-cat-soft text-cat-soft-ink',
        poster: 'bg-cat-fill text-cat-ink',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export type BadgeProps = React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
