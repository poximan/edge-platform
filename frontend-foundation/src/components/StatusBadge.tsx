import type { HTMLAttributes, ReactNode } from "react";

import styles from "./StatusBadge.module.css";

export type StatusTone = "neutral" | "info" | "warning" | "danger" | "success";

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  tone?: StatusTone;
}

export function StatusBadge({ children, className = "", tone = "neutral", ...props }: StatusBadgeProps) {
  return (
    <span className={`${styles.badge} ${styles[tone]} ${className}`.trim()} {...props}>
      {children}
    </span>
  );
}
