import { cva } from "class-variance-authority";

export const buttonVariants = cva(
  "inline-flex items-center cursor-pointer justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25 focus-visible:ring-offset-1",
  {
    variants: {
      variant: {
        default:
          "bg-neutral-950 text-white shadow-sm hover:bg-neutral-900 active:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-900/25 focus:ring-offset-1",
        destructive:
          "bg-neutral-800 text-white shadow-sm hover:bg-neutral-700 active:bg-neutral-600 focus:outline-none focus:ring-2 focus:ring-neutral-900/25 focus:ring-offset-1",
        outline:
          "border border-neutral-300 bg-white text-neutral-900 shadow-sm hover:bg-neutral-50 hover:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/25 focus:ring-offset-1",
        secondary:
          "bg-neutral-100 text-neutral-900 shadow-sm hover:bg-neutral-200 focus:outline-none focus:ring-2 focus:ring-neutral-500/30 focus:ring-offset-1",
        ghost:
          "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-500/30 focus:ring-offset-1",
        link: "text-neutral-900 underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-neutral-900/25 focus:ring-offset-1",
      },
      size: {
        // Desktop-density scale: every control in a row shares one height
        // (inputs and select triggers are also h-8).
        default: "h-8 px-3 text-[13px] has-[>svg]:px-2.5",
        sm: "h-7 rounded-md gap-1.5 px-2.5 text-xs has-[>svg]:px-2",
        lg: "h-9 rounded-md px-4 has-[>svg]:px-3",
        icon: "size-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);
