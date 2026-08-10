import type { ReactNode } from "react";

import styles from "./AppShell.module.css";

export interface AppShellLink {
  href: string;
  label: string;
}

export interface AppShellProps {
  children: ReactNode;
  productName: string;
  sectionName?: string;
  links?: AppShellLink[];
}

export function AppShell({ children, links = [], productName, sectionName = "Comunicaciones" }: AppShellProps) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <a className={styles.identity} href="/" aria-label="Volver al menú de productos">
          <span className={styles.section}>{sectionName}</span>
          <strong>{productName}</strong>
        </a>
        <nav className={styles.navigation} aria-label="Navegación global">
          {links.map((link) => (
            <a href={link.href} key={link.href}>{link.label}</a>
          ))}
          <a href="/">Productos</a>
          <a href="/logout">Salir</a>
        </nav>
      </header>
      {children}
    </div>
  );
}
