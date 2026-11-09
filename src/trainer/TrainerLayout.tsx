import type { ReactNode } from 'react'
import './trainer.css'

/** Places the board and side panel; children are the board then the panel. */
export function TrainerLayout({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <main className={className ? `trainer-layout ${className}` : 'trainer-layout'}>{children}</main>
  )
}
