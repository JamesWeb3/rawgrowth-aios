"use client"

import { memo, type ComponentProps } from "react"
import { Streamdown } from "streamdown"

import { cn } from "@/lib/utils"

type ResponseProps = ComponentProps<typeof Streamdown>

export const Response = memo(
  ({ className, ...props }: ResponseProps) => (
    <Streamdown
      // Trust links from our own agent — skip Streamdown's "leaving the site"
      // confirmation modal so things like the Calendly URL open directly.
      linkSafety={{ enabled: false }}
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        "[&_a]:underline [&_a]:underline-offset-2 [&_a]:text-[#0CBF6A]",
        className
      )}
      {...props}
    />
  ),
  (prevProps, nextProps) => prevProps.children === nextProps.children
)

Response.displayName = "Response"
