import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "relative bg-gradient-to-r from-muted via-muted/50 to-muted rounded-md overflow-hidden",
        "before:absolute before:inset-0",
        "before:bg-gradient-to-r before:from-transparent before:via-background/20 before:to-transparent",
        "before:animate-shimmer",
        className
      )}
      style={{
        backgroundSize: '200% 100%',
      }}
      {...props}
    />
  )
}

export { Skeleton }
