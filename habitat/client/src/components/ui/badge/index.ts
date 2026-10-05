import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Badge } from "./Badge.vue"

export const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-accent focus-visible:ring-accent/50 focus-visible:ring-3 aria-invalid:ring-danger/20 aria-invalid:border-danger transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-accent text-accent-foreground [a&]:hover:bg-accent/90",
        secondary:
          "border-transparent bg-surface-raised text-text [a&]:hover:bg-surface-raised/90",
        destructive:
          "border-transparent bg-danger text-background [a&]:hover:bg-danger/90 focus-visible:ring-danger/20",
        outline:
          "text-text [a&]:hover:bg-surface-raised [a&]:hover:text-text",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)
export type BadgeVariants = VariantProps<typeof badgeVariants>
