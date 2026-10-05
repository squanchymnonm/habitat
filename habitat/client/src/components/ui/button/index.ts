import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Button } from "./Button.vue"

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-accent focus-visible:ring-accent/50 focus-visible:ring-3 aria-invalid:ring-danger/20 aria-invalid:border-danger",
  {
    variants: {
      // Sin preflight de Tailwind: toda variante declara bg y borde explícitos,
      // si no el <button> hereda la cara/borde nativos del navegador.
      variant: {
        default:
          "border-0 bg-accent text-accent-foreground hover:bg-accent/90",
        destructive:
          "border-0 bg-danger text-background hover:bg-danger/90 focus-visible:ring-danger/20",
        outline:
          "border border-border bg-background shadow-xs hover:bg-surface-raised hover:text-text",
        secondary:
          "border-0 bg-surface-raised text-text hover:bg-surface-raised/80",
        ghost:
          "border-0 bg-transparent hover:bg-surface-raised hover:text-text",
        link: "border-0 bg-transparent text-accent underline-offset-4 hover:underline",
      },
      size: {
        "default": "h-9 px-4 py-2 has-[>svg]:px-3",
        "xs": "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        "sm": "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        "lg": "h-10 rounded-md px-6 has-[>svg]:px-4",
        "icon": "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)
export type ButtonVariants = VariantProps<typeof buttonVariants>
