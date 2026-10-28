import type { HTMLAttributes, ReactNode } from "react";

import styles from "./Card.module.css";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  padding?: "normal" | "compact" | "none";
}

export function Card({ children, className = "", padding = "normal", ...props }: CardProps) {
  return (
    <section {...props} className={`${styles.card} ${className}`.trim()} data-sc-card="" data-sc-padding={padding}>
      {children}
    </section>
  );
}
